// OAuth Authorization Server Metadata (RFC 8414), served at both the OAuth
// and OIDC well-known paths (clients check either). Hosted at OUR OWN
// origin, not Cognito's real one — that's deliberate: a client only
// discovers registration_endpoint by fetching
// {issuer}/.well-known/oauth-authorization-server, per the
// authorization_servers value we advertise in wellKnown.js, and Cognito's
// own (real-issuer-hosted) copy of that document is immutable by us, with
// no registration_endpoint at all. Hosting our own copy instead lets us add
// one, while authorization_endpoint/token_endpoint below still point
// straight at Cognito's real Hosted UI — we don't proxy the actual
// auth/token exchange, only host this one metadata document ourselves.
//
// The `issuer` field itself, though, is the REAL Cognito issuer — not our
// origin. Tried the opposite first (our own origin, matching where this
// document is fetched from, closer to RFC 8414's letter) and a live test
// against Claude Desktop's DCR flow failed silently client-side (DCR itself
// succeeded, but /mcp was never called per CloudWatch) — consistent with
// its OAuth client validating the ID token's issuer against this document
// and rejecting the mismatch before ever using the token. Cognito also
// turns out to require the "openid" scope wherever "email" is requested
// (confirmed by a failed deploy), so an ID token can't be avoided by
// dropping scopes either. Matching the real issuer here — even though it
// disagrees with the URL this document was fetched from — is the value
// that actually gets cross-checked against a real token's `iss`, which
// matters more in practice than same-origin purity for a single-tenant
// resource server like this one.
exports.handler = async (event) => {
  const region = process.env.AWS_REGION || 'us-east-1'
  const host = event.headers?.host || event.headers?.Host || event.requestContext?.domainName
  const hostedUiDomain = process.env.MCP_HOSTED_UI_DOMAIN
  const realIssuer = `https://cognito-idp.${region}.amazonaws.com/${process.env.COGNITO_USER_POOL_ID}`

  const body = {
    issuer: realIssuer,
    authorization_endpoint: `https://${hostedUiDomain}/oauth2/authorize`,
    token_endpoint: `https://${hostedUiDomain}/oauth2/token`,
    registration_endpoint: `https://${host}/register`,
    jwks_uri: `${realIssuer}/.well-known/jwks.json`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    token_endpoint_auth_methods_supported: ['none'],
    code_challenge_methods_supported: ['S256'],
    scopes_supported: ['openid', 'email'],
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify(body),
  }
}
