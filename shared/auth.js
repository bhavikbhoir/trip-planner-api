const jwksClient = require('jwks-rsa')
const jwt = require('jsonwebtoken')

const USER_POOL_ID = process.env.COGNITO_USER_POOL_ID
const CLIENT_ID = process.env.COGNITO_CLIENT_ID
const REGION = process.env.AWS_REGION || 'us-east-1'

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
      if (decoded.token_use !== 'access' || decoded.client_id !== CLIENT_ID) {
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
