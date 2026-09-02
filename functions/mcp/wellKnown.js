// RFC 9728 OAuth Protected Resource Metadata — lets an MCP client discover
// which authorization server issues tokens for /mcp before it has one.
// Cognito serves the actual Authorization Server Metadata (RFC 8414) + JWKS
// automatically once the Hosted UI domain exists; this is the one piece of
// discovery metadata we have to host ourselves.
exports.handler = async (event) => {
  const region = process.env.AWS_REGION || 'us-east-1'
  const issuer = `https://cognito-idp.${region}.amazonaws.com/${process.env.COGNITO_USER_POOL_ID}`
  // Derived from the request rather than API_BASE_URL — that var is unset in
  // this deployment (no .env/CI secret configures it), which would otherwise
  // silently produce a relative "undefined/mcp" resource instead of the
  // absolute URI RFC 9728 requires.
  const host = event.headers?.host || event.headers?.Host || event.requestContext?.domainName

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify({
      resource: `https://${host}/mcp`,
      authorization_servers: [issuer],
    }),
  }
}
