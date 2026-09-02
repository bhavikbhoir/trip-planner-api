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
// Nuance worth knowing: tokens Cognito issues still carry the *real*
// Cognito issuer in `iss`, not this document's `issuer` field. Our own
// token validation (the cognitoJwtMcp authorizer + shared/auth.js) checks
// against the real issuer directly and never reads this document, so it's
// unaffected. Whether a given MCP client cross-validates issuer-vs-metadata
// strictly enough to care is implementation-dependent — verified against a
// real client (Claude Desktop's own DCR flow), not assumed from spec text.
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
    scopes_supported: ['openid', 'email'],
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify(body),
  }
}
