// OAuth Authorization Server Metadata (RFC 8414), served at both the OAuth
// and OIDC well-known paths (clients check either). Advertises OUR OWN
// origin as issuer, not Cognito's real one — that's deliberate, not a bug:
// a client only discovers registration_endpoint by fetching
// {issuer}/.well-known/oauth-authorization-server, and Cognito's own
// (real-issuer-hosted) copy of that document is immutable by us, with no
// registration_endpoint at all. Pointing clients at our own copy instead
// lets us add one, while authorization_endpoint/token_endpoint below still
// point straight at Cognito's real Hosted UI — we don't proxy the actual
// auth/token exchange, only host this one metadata document ourselves.
//
// Nuance that turned out to matter in practice: tokens Cognito issues still
// carry the *real* Cognito issuer in `iss`, not this document's `issuer`
// field. Our own token validation (the cognitoJwtMcp authorizer +
// shared/auth.js) checks against the real issuer directly and never reads
// this document, so it's unaffected either way. But a first live test
// against Claude Desktop's DCR flow failed silently client-side (no /mcp
// call ever made, per CloudWatch) — consistent with its OAuth client
// validating an ID token's issuer against this document and rejecting the
// mismatch before ever using the token. Fix: don't request the "openid"
// scope anywhere (see TripPlannerMcpClient / register.js) — no ID token
// means nothing for a client to cross-validate against `issuer` at all.
exports.handler = async (event) => {
  const region = process.env.AWS_REGION || 'us-east-1'
  const host = event.headers?.host || event.headers?.Host || event.requestContext?.domainName
  const hostedUiDomain = process.env.MCP_HOSTED_UI_DOMAIN

  const body = {
    issuer: `https://${host}`,
    authorization_endpoint: `https://${hostedUiDomain}/oauth2/authorize`,
    token_endpoint: `https://${hostedUiDomain}/oauth2/token`,
    registration_endpoint: `https://${host}/register`,
    jwks_uri: `https://cognito-idp.${region}.amazonaws.com/${process.env.COGNITO_USER_POOL_ID}/.well-known/jwks.json`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    token_endpoint_auth_methods_supported: ['none'],
    code_challenge_methods_supported: ['S256'],
    scopes_supported: ['email'],
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify(body),
  }
}
