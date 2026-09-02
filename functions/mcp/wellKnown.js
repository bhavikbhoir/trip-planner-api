// RFC 9728 OAuth Protected Resource Metadata — lets an MCP client discover
// which authorization server issues tokens for /mcp before it has one.
//
// authorization_servers points at OUR OWN origin, not Cognito's real issuer
// — deliberate, see functions/mcp/authServerMetadata.js's comment for why:
// Cognito's own (real-issuer-hosted) metadata document is immutable by us
// and has no registration_endpoint, so clients are routed to our own copy
// instead, which does.
exports.handler = async (event) => {
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
      authorization_servers: [`https://${host}`],
    }),
  }
}
