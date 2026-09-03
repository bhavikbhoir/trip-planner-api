// Public half of the keypair that functions/mcp/oauth/token.js signs our own
// MCP access/refresh tokens with (private half lives in Secrets Manager as
// trip-planner/mcp-oauth-signing-key). Not secret — safe as a checked-in
// constant, and it must stay in sync with that private key by construction
// (generated together, once). Rotate by generating a new pair and replacing
// both this file and the secret together, not independently.
const JWKS = {
  keys: [
    {
      kty: 'RSA',
      n: '3WSH8SNv4MJWBWfT2cj5657DNTZLL29c0Rg8D5dajvxay2aW9v0sLx-1owRHhQ9JLWyILCxbrQMp_9VFT2qM77WBpjKyLl7k3_KjipQtYsDNZuRGOP_qy2mKfdAgIsDg1OH99wWmQ2NLGICFg8Ss43gt8paNVkhRONqfWCf5D-R_rxix3OiXIMyCL8AznLX01nbRfWjwR__sMvwC7rlLQ86UAKg447NoMnfevYIACdxEOBGyIhhTfCX562W1V7XD7yqaVWKl_WiQBevSqlb0J3GfiabVfb-d6_dzBZK-KH_hlWKmHLqcOkOJ02-qtaLGDO-Vx4FAiP2kg694--pQRw',
      e: 'AQAB',
      kid: '82dfc3ac5aff3136',
      use: 'sig',
      alg: 'RS256',
    },
  ],
}

exports.handler = async () => ({
  statusCode: 200,
  headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  body: JSON.stringify(JWKS),
})
