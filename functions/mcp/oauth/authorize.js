// GET /oauth/authorize — the front door of our own OAuth authorization
// server. Resolves the caller's identity (a CIMD https:// URL, or one of
// our own virtual clients from register.js), then redirects the user to
// Cognito's REAL Hosted UI to actually log in — we complete that leg
// ourselves (see callback.js), the external caller never talks to Cognito
// directly. See the plan/commit history for why: Cognito access tokens
// can't carry an `aud` claim identifying our MCP resource, and have no
// concept of CIMD; both are solved by us owning the whole protocol layer.
const crypto = require('crypto')
const store = require('./store')

// Only real-world CIMD issuer known today (Claude Code's CIMD document
// lives at https://claude.ai/oauth/claude-code-client-metadata). Adding a
// new trusted host is a one-line env var change, not a code change.
const CIMD_ALLOWED_HOSTS = (process.env.CIMD_ALLOWED_HOSTS || 'claude.ai').split(',').map((h) => h.trim())
const CIMD_FETCH_TIMEOUT_MS = 3000
const CIMD_MAX_RESPONSE_BYTES = 64 * 1024

function isCimdClientId(clientId) {
  return typeof clientId === 'string' && clientId.startsWith('https://')
}

function badRequest(message) {
  return { statusCode: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'invalid_request', error_description: message }) }
}

// Cheapest checks first, before ever issuing the fetch — SSRF defense in
// depth. The host allow-list is the primary mitigation (we only ever fetch
// a fixed, small set of trusted external hosts); the self-referential
// client_id check below is the spec-mandated anti-spoofing check, not this.
async function fetchCimdDocument(clientId) {
  let url
  try {
    url = new URL(clientId)
  } catch {
    return null
  }
  if (url.protocol !== 'https:') return null
  if (url.pathname === '' || url.pathname === '/') return null
  if (!CIMD_ALLOWED_HOSTS.includes(url.hostname)) return null

  let res
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(CIMD_FETCH_TIMEOUT_MS) })
  } catch {
    return null
  }
  if (!res.ok) return null

  const text = await res.text()
  if (text.length > CIMD_MAX_RESPONSE_BYTES) return null

  let doc
  try {
    doc = JSON.parse(text)
  } catch {
    return null
  }

  // Spec-mandated: the document must assert its own URL as client_id —
  // this is what actually proves the document is controlled by whoever
  // owns that URL, not the host allow-list (which is only SSRF defense).
  if (doc.client_id !== clientId) return null
  if (!Array.isArray(doc.redirect_uris)) return null

  return doc
}

async function resolveClient(clientId, redirectUri) {
  if (isCimdClientId(clientId)) {
    const doc = await fetchCimdDocument(clientId)
    if (!doc) return { error: 'CIMD document could not be fetched or validated' }
    if (!doc.redirect_uris.includes(redirectUri)) return { error: 'redirect_uri not listed in the client metadata document' }
    return { clientId, redirectUris: doc.redirect_uris }
  }

  const client = await store.getClient(clientId)
  if (!client) return { error: 'Unknown client_id' }
  if (!client.redirectUris.includes(redirectUri)) return { error: 'redirect_uri not registered for this client' }
  return { clientId, redirectUris: client.redirectUris }
}

exports.handler = async (event) => {
  const q = event.queryStringParameters || {}
  const { client_id: clientId, redirect_uri: redirectUri, response_type: responseType, code_challenge: codeChallenge, code_challenge_method: codeChallengeMethod, state, scope } = q

  if (!clientId || !redirectUri) return badRequest('client_id and redirect_uri are required')
  if (responseType !== 'code') return badRequest('response_type must be "code"')
  if (!codeChallenge || codeChallengeMethod !== 'S256') return badRequest('PKCE with code_challenge_method=S256 is required')

  // Everything up to here can't safely redirect back to the caller — we
  // haven't validated redirect_uri is legitimate yet, so a validation
  // failure returns a direct error response, never a redirect (classic
  // open-redirect prevention: never redirect to an unvalidated URL).
  const resolved = await resolveClient(clientId, redirectUri)
  if (resolved.error) return badRequest(resolved.error)

  const sessionId = crypto.randomBytes(24).toString('base64url')
  const ourCodeVerifier = crypto.randomBytes(32).toString('base64url')
  const ourCodeChallenge = crypto.createHash('sha256').update(ourCodeVerifier).digest('base64url')

  await store.putSession({
    sessionId,
    originalClientId: clientId,
    originalRedirectUri: redirectUri,
    originalState: state || null,
    originalCodeChallenge: codeChallenge,
    scope: scope || '',
    ourCodeVerifier,
  })

  const host = event.headers?.host || event.headers?.Host || event.requestContext?.domainName
  const ourCallbackUrl = `https://${host}/oauth/callback`
  const cognitoAuthorizeUrl = new URL(`https://${process.env.MCP_HOSTED_UI_DOMAIN}/oauth2/authorize`)
  cognitoAuthorizeUrl.searchParams.set('client_id', process.env.COGNITO_MCP_CLIENT_ID)
  cognitoAuthorizeUrl.searchParams.set('response_type', 'code')
  cognitoAuthorizeUrl.searchParams.set('scope', 'openid email')
  cognitoAuthorizeUrl.searchParams.set('redirect_uri', ourCallbackUrl)
  cognitoAuthorizeUrl.searchParams.set('code_challenge', ourCodeChallenge)
  cognitoAuthorizeUrl.searchParams.set('code_challenge_method', 'S256')
  cognitoAuthorizeUrl.searchParams.set('state', sessionId)

  return { statusCode: 302, headers: { Location: cognitoAuthorizeUrl.toString() } }
}
