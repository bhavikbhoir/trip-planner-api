// GET /oauth/callback — Cognito redirects here after the user logs in (this
// is the CallbackURL registered on TripPlannerMcpClient). Completes OUR
// leg of the Cognito exchange, then hands the caller our OWN short-lived
// authorization code and redirects back to THEIR real redirect_uri.
const jwt = require('jsonwebtoken')
const store = require('./store')
const { randomToken } = require('./tokens')

function errorPage(message) {
  return { statusCode: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'server_error', error_description: message }) }
}

exports.handler = async (event) => {
  const q = event.queryStringParameters || {}
  const { code, state: sessionId, error: upstreamError } = q

  if (!sessionId) return errorPage('Missing state')

  // Atomic single-use consume — a replayed callback (Cognito wouldn't
  // normally redirect twice, but a resent/reloaded browser request could)
  // finds nothing the second time and is rejected, rather than minting a
  // second authorization code for the same login.
  const session = await store.takeSession(sessionId)
  if (!session) return errorPage('Unknown or already-used session')

  const redirectWithError = (err, description) => {
    const url = new URL(session.originalRedirectUri)
    url.searchParams.set('error', err)
    if (description) url.searchParams.set('error_description', description)
    if (session.originalState) url.searchParams.set('state', session.originalState)
    return { statusCode: 302, headers: { Location: url.toString() } }
  }

  if (upstreamError) return redirectWithError(upstreamError, q.error_description)
  if (!code) return redirectWithError('server_error', 'Cognito did not return a code')

  const host = event.headers?.host || event.headers?.Host || event.requestContext?.domainName
  const ourCallbackUrl = `https://${host}/oauth/callback`

  let tokenRes
  try {
    tokenRes = await fetch(`https://${process.env.MCP_HOSTED_UI_DOMAIN}/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: process.env.COGNITO_MCP_CLIENT_ID,
        code,
        redirect_uri: ourCallbackUrl,
        code_verifier: session.ourCodeVerifier,
      }),
    })
  } catch {
    return redirectWithError('server_error', 'Could not reach the identity provider')
  }

  if (!tokenRes.ok) return redirectWithError('server_error', 'Identity provider rejected the login')

  const tokens = await tokenRes.json()
  // Decoded, not re-verified — this came straight from Cognito's token
  // endpoint over a direct server-to-server TLS connection we just made
  // ourselves, using our own client credentials; there's no untrusted
  // party between us and Cognito on this leg to forge it.
  const claims = jwt.decode(tokens.access_token)
  if (!claims?.sub) return redirectWithError('server_error', 'Identity provider response was missing a subject')

  const ourCode = randomToken()
  await store.putCode({
    code: ourCode,
    sub: claims.sub,
    clientId: session.originalClientId,
    redirectUri: session.originalRedirectUri,
    codeChallenge: session.originalCodeChallenge,
    scope: session.scope,
  })

  const redirectUrl = new URL(session.originalRedirectUri)
  redirectUrl.searchParams.set('code', ourCode)
  if (session.originalState) redirectUrl.searchParams.set('state', session.originalState)

  return { statusCode: 302, headers: { Location: redirectUrl.toString() } }
}
