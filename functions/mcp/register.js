const { nanoid } = require('nanoid')
const { CognitoIdentityProviderClient, CreateUserPoolClientCommand } = require('@aws-sdk/client-cognito-identity-provider')
const db = require('../../shared/db')
const { logUsageEvent } = require('../../shared/usageLog')

// RFC 7591 Dynamic Client Registration, fronting Cognito (which has no
// native DCR support) with CreateUserPoolClient. Public and unauthenticated
// by design — DCR has to be reachable before a client has any credentials —
// which is exactly why this file guards harder than anything else in this
// codebase: every successful call permanently provisions a real AWS
// resource, and Cognito hard-caps app clients at 1,000 per user pool.
// Exhausting that breaks OAuth for every user, not just this one — an
// availability guardrail, not a cost one.

const USER_POOL_ID = process.env.COGNITO_USER_POOL_ID
const MAX_REDIRECT_URIS = 5
// Well under Cognito's 1,000/pool ceiling — a durable backstop the per-IP
// throttle below can't provide on its own (that one resets per warm
// container; this one is atomic and global).
const MAX_TOTAL_REGISTRATIONS = 400
const COUNTER_KEY = { pk: 'MCPDCR#counter', sk: 'META' }

const cognito = new CognitoIdentityProviderClient({ region: process.env.AWS_REGION || 'us-east-1' })

// Per-IP soft throttle — in-memory, resets per warm Lambda container. Same
// pattern and same honest limitation as the-gooners-world-api's agentChat
// rate limit: not globally distributed, but a real first layer above the
// DynamoDB-backed hard ceiling.
const WINDOW_MS = 60 * 60 * 1000
const MAX_PER_IP_PER_WINDOW = 5
const ipHits = new Map()

function isThrottled(ip) {
  const now = Date.now()
  const hits = (ipHits.get(ip) || []).filter((t) => now - t < WINDOW_MS)
  hits.push(now)
  ipHits.set(ip, hits)
  return hits.length > MAX_PER_IP_PER_WINDOW
}

function isValidRedirectUri(uri) {
  if (typeof uri !== 'string') return false
  let parsed
  try {
    parsed = new URL(uri)
  } catch {
    return false
  }
  // Native-app redirects legitimately use http://127.0.0.1 loopback or a
  // custom scheme (e.g. a desktop app's own URI scheme) — only exclude
  // schemes that could turn this into an XSS/injection vector.
  return !['javascript:', 'data:', 'vbscript:'].includes(parsed.protocol)
}

// Access-Control-Allow-Origin matches wellKnown.js/authServerMetadata.js —
// without it, a browser-context caller (as opposed to a server-to-server or
// Electron-main-process one) could have this POST succeed server-side (a
// real Cognito client gets created either way) while being blocked from
// ever reading the client_id back out of the response body.
function respond(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify(body),
  }
}

exports.handler = async (event) => {
  const sourceIp = event.requestContext?.http?.sourceIp || 'unknown'

  if (isThrottled(sourceIp)) {
    return respond(429, { error: 'too_many_requests', error_description: 'Too many registration attempts. Try again later.' })
  }

  let body
  try {
    body = JSON.parse(event.body || '{}')
  } catch {
    return respond(400, { error: 'invalid_client_metadata', error_description: 'Invalid JSON body' })
  }

  const redirectUris = body.redirect_uris
  if (!Array.isArray(redirectUris) || redirectUris.length === 0) {
    return respond(400, { error: 'invalid_redirect_uri', error_description: 'redirect_uris must be a non-empty array' })
  }
  if (redirectUris.length > MAX_REDIRECT_URIS) {
    return respond(400, { error: 'invalid_redirect_uri', error_description: `redirect_uris exceeds the maximum of ${MAX_REDIRECT_URIS}` })
  }
  if (!redirectUris.every(isValidRedirectUri)) {
    return respond(400, { error: 'invalid_redirect_uri', error_description: 'One or more redirect_uris is not a valid absolute URI' })
  }

  // Hard global ceiling — atomic conditional increment, same shape as this
  // repo's other cooldown guards (see functions/plan/generate.js). Everything
  // else about the requested client (scope, auth method, grant types) is
  // ignored on purpose and forced to our own safe values below — never
  // trust the request body for those.
  try {
    await db.updateIf(COUNTER_KEY.pk, COUNTER_KEY.sk, {
      UpdateExpression: 'SET #c = if_not_exists(#c, :zero) + :one',
      ConditionExpression: 'attribute_not_exists(#c) OR #c < :max',
      ExpressionAttributeNames: { '#c': 'count' },
      ExpressionAttributeValues: { ':zero': 0, ':one': 1, ':max': MAX_TOTAL_REGISTRATIONS },
    })
  } catch (e) {
    if (e.name === 'ConditionalCheckFailedException') {
      return respond(429, { error: 'too_many_requests', error_description: 'Registration is temporarily unavailable.' })
    }
    throw e
  }

  const clientName = (typeof body.client_name === 'string' && body.client_name.trim().slice(0, 100)) || 'mcp-client'
  const suffixedName = `${clientName}-${nanoid(8)}`

  let created
  try {
    created = await cognito.send(
      new CreateUserPoolClientCommand({
        UserPoolId: USER_POOL_ID,
        ClientName: suffixedName,
        GenerateSecret: false,
        AllowedOAuthFlows: ['code'],
        AllowedOAuthFlowsUserPoolClient: true,
        // Cognito requires "openid" whenever "email" is requested — see
        // serverless.yml's TripPlannerMcpClient comment.
        AllowedOAuthScopes: ['openid', 'email'],
        SupportedIdentityProviders: ['COGNITO'],
        CallbackURLs: redirectUris,
        ExplicitAuthFlows: ['ALLOW_REFRESH_TOKEN_AUTH'],
      })
    )
  } catch (e) {
    console.log(JSON.stringify({ mcpClientRegistrationFailed: true, error: e.message, sourceIp }))
    return respond(503, { error: 'server_error', error_description: 'Could not register a client right now.' })
  }

  const clientId = created.UserPoolClient.ClientId
  const now = new Date()

  await db.put({
    pk: `MCPCLIENT#${clientId}`,
    sk: 'META',
    clientId,
    clientName: suffixedName,
    redirectUris,
    createdAt: now.toISOString(),
    sourceIp,
  })

  logUsageEvent('mcp_client_registered', { clientId })

  return respond(201, {
    client_id: clientId,
    client_id_issued_at: Math.floor(now.getTime() / 1000),
    redirect_uris: redirectUris,
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
    scope: 'openid email',
  })
}
