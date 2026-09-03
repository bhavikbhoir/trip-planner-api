const { nanoid } = require('nanoid')
const db = require('../../shared/db')
const { logUsageEvent } = require('../../shared/usageLog')
const store = require('./oauth/store')

// RFC 7591 Dynamic Client Registration. Public and unauthenticated by
// design — DCR has to be reachable before a client has any credentials.
//
// Unlike the first version of this file, this no longer touches Cognito at
// all: registering a client just writes a DynamoDB row (see
// functions/mcp/oauth/store.js) that functions/mcp/oauth/authorize.js looks
// up later. No real AWS resource gets created per registration anymore, so
// Cognito's 1,000-app-client-per-pool quota is no longer a concern here —
// the guardrails below are now generic public-write-endpoint abuse/cost
// protection, not quota protection specifically.

const MAX_REDIRECT_URIS = 5
const MAX_TOTAL_REGISTRATIONS = 2000
const COUNTER_KEY = { pk: 'OAUTHDCR#counter', sk: 'META' }

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
  const clientId = nanoid()
  const now = new Date()

  await store.putClient({ clientId, redirectUris, clientName, source: 'dcr' })
  logUsageEvent('mcp_client_registered', { clientId })

  return respond(201, {
    client_id: clientId,
    client_id_issued_at: Math.floor(now.getTime() / 1000),
    redirect_uris: redirectUris,
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
  })
}
