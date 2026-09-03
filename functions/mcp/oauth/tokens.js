// Mints and verifies OUR OWN MCP OAuth tokens — the whole reason this
// subsystem exists is that Cognito's real tokens can't carry an `aud` claim
// identifying our MCP resource (confirmed: Cognito only allows an added
// `aud` to equal the app client ID, and only on a paid feature tier we're
// not on). Signing key fetch mirrors shared/weather.js's Secrets Manager
// pattern (module-level cache, one fetch per warm container).
const crypto = require('crypto')
const jwt = require('jsonwebtoken')
const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager')

const secretsClient = new SecretsManagerClient({ region: process.env.AWS_REGION || 'us-east-1' })
const SECRET_NAME = process.env.MCP_OAUTH_SIGNING_KEY_SECRET_NAME || 'trip-planner/mcp-oauth-signing-key'
// Must match the "kid" baked into functions/mcp/oauth/jwks.js's public JWKS —
// generated together as one pair; rotate both together, never independently.
const KID = '82dfc3ac5aff3136'
const ACCESS_TOKEN_TTL_SECONDS = 60 * 60

let cachedPrivateKey = null

async function getPrivateKey() {
  if (cachedPrivateKey) return cachedPrivateKey
  const res = await secretsClient.send(new GetSecretValueCommand({ SecretId: SECRET_NAME }))
  cachedPrivateKey = res.SecretString
  return cachedPrivateKey
}

function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url')
}

async function mintAccessToken({ sub, clientId, scope }) {
  const privateKey = await getPrivateKey()
  const issuer = process.env.MCP_ISSUER
  const resource = process.env.MCP_RESOURCE_URL
  return jwt.sign(
    { client_id: clientId, scope: scope || '', token_use: 'access' },
    privateKey,
    {
      algorithm: 'RS256',
      keyid: KID,
      issuer,
      audience: resource,
      subject: sub,
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
    }
  )
}

module.exports = {
  randomToken,
  mintAccessToken,
  ACCESS_TOKEN_TTL_SECONDS,
}
