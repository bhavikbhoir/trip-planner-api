const jwksClient = require('jwks-rsa')
const jwt = require('jsonwebtoken')

const USER_POOL_ID = process.env.COGNITO_USER_POOL_ID
const CLIENT_ID = process.env.COGNITO_CLIENT_ID
const REGION = process.env.AWS_REGION || 'us-east-1'

// Accepts tokens from any of our own app clients (web + MCP) — a comma-
// separated allow-list instead of a single CLIENT_ID, so a token minted by
// the MCP OAuth client (see serverless.yml's TripPlannerMcpClient) passes
// this re-check too. Falls back to CLIENT_ID alone for local/offline dev
// that hasn't set the new var. API Gateway's per-route authorizer is still
// the primary gate (mcp's authorizer only accepts the MCP client's audience,
// the web routes' authorizer only accepts the web client's) — this allow-
// list only affects this defense-in-depth re-check, not which route a given
// token can reach.
const ALLOWED_CLIENT_IDS = (process.env.COGNITO_ALLOWED_CLIENT_IDS || CLIENT_ID || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)

const client = jwksClient({
  jwksUri: `https://cognito-idp.${REGION}.amazonaws.com/${USER_POOL_ID}/.well-known/jwks.json`,
  cache: true,
  cacheMaxEntries: 5,
  cacheMaxAge: 600000,
})

function getKey(header, callback) {
  client.getSigningKey(header.kid, (err, key) => {
    if (err) return callback(err)
    callback(null, key.getPublicKey())
  })
}

function validateJWT(event) {
  return new Promise((resolve, reject) => {
    const authHeader = event.headers?.Authorization || event.headers?.authorization
    if (!authHeader?.startsWith('Bearer ')) {
      return reject({ statusCode: 401, code: 'UNAUTHORIZED', message: 'Missing or invalid Authorization header' })
    }

    const token = authHeader.slice(7)
    const issuer = `https://cognito-idp.${REGION}.amazonaws.com/${USER_POOL_ID}`

    jwt.verify(token, getKey, { issuer }, (err, decoded) => {
      if (err) {
        return reject({ statusCode: 401, code: 'UNAUTHORIZED', message: 'Invalid or expired token' })
      }
      if (decoded.token_use !== 'access' || !ALLOWED_CLIENT_IDS.includes(decoded.client_id)) {
        return reject({ statusCode: 401, code: 'UNAUTHORIZED', message: 'Invalid or expired token' })
      }
      resolve(decoded.sub)
    })
  })
}

// API Gateway's native JWT authorizer is the primary gate (see serverless.yml);
// this is defense-in-depth plus the only way to read the caller's sub in a handler.
function extractUserId(event) {
  return validateJWT(event)
}

module.exports = { validateJWT, extractUserId }
