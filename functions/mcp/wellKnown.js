// RFC 9728 OAuth Protected Resource Metadata — lets an MCP client discover
// which authorization server issues tokens for /mcp before it has one.
// Cognito serves the actual Authorization Server Metadata (RFC 8414) + JWKS
// automatically once the Hosted UI domain exists; this is the one piece of
// discovery metadata we have to host ourselves.
exports.handler = async () => {
  const region = process.env.AWS_REGION || 'us-east-1'
  const issuer = `https://cognito-idp.${region}.amazonaws.com/${process.env.COGNITO_USER_POOL_ID}`

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify({
      resource: `${process.env.API_BASE_URL}/mcp`,
      authorization_servers: [issuer],
    }),
  }
}
