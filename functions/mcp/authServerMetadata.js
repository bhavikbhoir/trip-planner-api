// OAuth Authorization Server Metadata (RFC 8414 / OIDC Discovery), served
// at both well-known paths (clients check either). We are now the real
// authorization server — not a metadata-only front for Cognito — so every
// field here is self-consistent by construction, all derived from the one
// MCP_ISSUER env var (which is also what's configured as the cognitoJwtMcp
// authorizer's issuerUrl in serverless.yml, and what tokens.js signs our
// own JWTs with as `iss`). Deriving from env var rather than the request's
// Host header (unlike wellKnown.js) is deliberate here: this value MUST be
// byte-identical to the authorizer's fixed deploy-time config, and API
// Gateway's JWT authorizer silently fails to be created at all — no error,
// routes just stop existing — if the issuer doesn't serve a well-formed
// discovery document, so this is not a place to risk any drift.
//
// Why we became the real authorization server instead of just proxying
// Cognito's: Cognito access tokens can't carry an `aud` claim identifying
// our MCP resource (confirmed — Cognito only allows an added `aud` to
// equal the app client ID, and only on a paid feature tier), which a first
// live DCR test against Claude Desktop's real client is best explained by
// (login succeeded, but /mcp was never called — consistent with Claude's
// own audience-mismatch check silently rejecting the token). Cognito also
// has no concept of CIMD (`client_id` as a URL) at all. Owning the whole
// protocol layer (functions/mcp/oauth/*) fixes both at once, using Cognito
// purely as the backend login/identity check.
exports.handler = async () => {
  const issuer = process.env.MCP_ISSUER

  const body = {
    issuer,
    authorization_endpoint: `${issuer}/oauth/authorize`,
    token_endpoint: `${issuer}/oauth/token`,
    registration_endpoint: `${issuer}/register`,
    jwks_uri: `${issuer}/oauth/jwks.json`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    token_endpoint_auth_methods_supported: ['none'],
    code_challenge_methods_supported: ['S256'],
    client_id_metadata_document_supported: true,
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify(body),
  }
}
