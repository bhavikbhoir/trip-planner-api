// POST /oauth/token — mints our own tokens. Must accept
// application/x-www-form-urlencoded (RFC 6749 §4.1.3, and Claude's docs
// call this out explicitly — some frameworks default to JSON-only body
// parsing and silently 415 here).
const crypto = require('crypto')
const store = require('./store')
const { randomToken, mintAccessToken, ACCESS_TOKEN_TTL_SECONDS } = require('./tokens')

const CODE_TTL_MS = 60 * 1000

function tokenError(statusCode, error, description) {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error, error_description: description }) }
}

function parseBody(event) {
  const raw = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString('utf8') : event.body || ''
  return Object.fromEntries(new URLSearchParams(raw))
}

async function issueTokenResponse({ sub, clientId, scope }) {
  const accessToken = await mintAccessToken({ sub, clientId, scope })
  const refreshToken = randomToken()
  await store.putRefreshToken({ refreshToken, sub, clientId, scope })

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify({
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: ACCESS_TOKEN_TTL_SECONDS,
      refresh_token: refreshToken,
      scope: scope || undefined,
    }),
  }
}

async function handleAuthorizationCode(body) {
  const { code, redirect_uri: redirectUri, client_id: clientId, code_verifier: codeVerifier } = body
  if (!code || !redirectUri || !codeVerifier) return tokenError(400, 'invalid_request', 'code, redirect_uri, and code_verifier are required')

  // Atomic single-use consume — a retried or replayed exchange of the same
  // code finds nothing the second time.
  const stored = await store.takeCode(code)
  if (!stored) return tokenError(400, 'invalid_grant', 'Unknown, expired, or already-used code')

  if (Date.now() - new Date(stored.createdAt).getTime() > CODE_TTL_MS) {
    return tokenError(400, 'invalid_grant', 'Code has expired')
  }
  if (stored.redirectUri !== redirectUri) return tokenError(400, 'invalid_grant', 'redirect_uri does not match the authorization request')
  if (clientId && stored.clientId !== clientId) return tokenError(400, 'invalid_grant', 'client_id does not match the authorization request')

  const computedChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url')
  if (computedChallenge !== stored.codeChallenge) return tokenError(400, 'invalid_grant', 'PKCE verification failed')

  return issueTokenResponse({ sub: stored.sub, clientId: stored.clientId, scope: stored.scope })
}

async function handleRefreshToken(body) {
  const { refresh_token: refreshToken } = body
  if (!refreshToken) return tokenError(400, 'invalid_request', 'refresh_token is required')

  // Rotation: the old token is gone the instant we read it, regardless of
  // what happens next — a stolen-and-reused-later refresh token can never
  // succeed once the legitimate client has rotated past it.
  const stored = await store.takeRefreshToken(refreshToken)
  if (!stored) return tokenError(400, 'invalid_grant', 'Unknown or already-used refresh token')

  return issueTokenResponse({ sub: stored.sub, clientId: stored.clientId, scope: stored.scope })
}

exports.handler = async (event) => {
  const body = parseBody(event)

  switch (body.grant_type) {
    case 'authorization_code':
      return handleAuthorizationCode(body)
    case 'refresh_token':
      return handleRefreshToken(body)
    default:
      return tokenError(400, 'unsupported_grant_type', 'Only authorization_code and refresh_token are supported')
  }
}
