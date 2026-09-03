const jwksClient = require('jwks-rsa')
const jwt = require('jsonwebtoken')

const USER_POOL_ID = process.env.COGNITO_USER_POOL_ID
const CLIENT_ID = process.env.COGNITO_CLIENT_ID
const REGION = process.env.AWS_REGION || 'us-east-1'
const COGNITO_ISSUER = `https://cognito-idp.${REGION}.amazonaws.com/${USER_POOL_ID}`

// Accepts tokens from any of our own web-app Cognito client(s) — a comma-
// separated allow-list, falling back to CLIENT_ID alone for local/offline
// dev that hasn't set the new var. Only applies to the Cognito branch below;
// our own MCP tokens (see the MCP_ISSUER branch) never carry a Cognito
// client_id, and don't need this check — the client was already resolved
// once, legitimately, at functions/mcp/oauth/authorize.js.
const ALLOWED_CLIENT_IDS = (process.env.COGNITO_ALLOWED_CLIENT_IDS || CLIENT_ID || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)

const cognitoJwks = jwksClient({
  jwksUri: `${COGNITO_ISSUER}/.well-known/jwks.json`,
  cache: true,
  cacheMaxEntries: 5,
  cacheMaxAge: 600000,
})

// functions/mcp/oauth/token.js mints our own tokens (Cognito access tokens
// can't carry an `aud` identifying our MCP resource — see that file's
// comment) — this repo is both the issuer and, here, the verifier.
const mcpJwks = jwksClient({
  jwksUri: `${process.env.MCP_ISSUER}/oauth/jwks.json`,
  cache: true,
  cacheMaxEntries: 5,
  cacheMaxAge: 600000,
})

function getKeyFrom(jwks) {
  return (header, callback) => {
    jwks.getSigningKey(header.kid, (err, key) => {
      if (err) return callback(err)
      callback(null, key.getPublicKey())
    })
  }
}

const getCognitoKey = getKeyFrom(cognitoJwks)
const getMcpKey = getKeyFrom(mcpJwks)

function verify(token, getKey, options) {
  return new Promise((resolve, reject) => {
    jwt.verify(token, getKey, options, (err, decoded) => {
      if (err) return reject(err)
      resolve(decoded)
    })
  })
}

function validateJWT(event) {
  return new Promise(async (resolve, reject) => {
    const authHeader = event.headers?.Authorization || event.headers?.authorization
    if (!authHeader?.startsWith('Bearer ')) {
      return reject({ statusCode: 401, code: 'UNAUTHORIZED', message: 'Missing or invalid Authorization header' })
    }

    const token = authHeader.slice(7)

    // Peek at the issuer (unverified) purely to pick which JWKS/issuer to
    // verify against next — the actual trust decision still happens in the
    // jwt.verify() call below, which checks signature + issuer + audience
    // together and rejects on any mismatch.
    const unverified = jwt.decode(token) || {}

    try {
      let decoded
      if (unverified.iss === process.env.MCP_ISSUER) {
        decoded = await verify(token, getMcpKey, { issuer: process.env.MCP_ISSUER, audience: process.env.MCP_RESOURCE_URL })
        if (decoded.token_use !== 'access') throw new Error('not an access token')
      } else {
        decoded = await verify(token, getCognitoKey, { issuer: COGNITO_ISSUER })
        if (decoded.token_use !== 'access' || !ALLOWED_CLIENT_IDS.includes(decoded.client_id)) {
          throw new Error('not an access token for an allowed client')
        }
      }
      resolve(decoded.sub)
    } catch {
      reject({ statusCode: 401, code: 'UNAUTHORIZED', message: 'Invalid or expired token' })
    }
  })
}

// API Gateway's native JWT authorizer is the primary gate (see serverless.yml);
// this is defense-in-depth plus the only way to read the caller's sub in a handler.
function extractUserId(event) {
  return validateJWT(event)
}

module.exports = { validateJWT, extractUserId }
