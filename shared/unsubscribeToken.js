const crypto = require('crypto')

// Deliberately no expiry — CAN-SPAM's opt-out mechanism has to keep working
// for as long as the recipient might want it, not for some arbitrary window.
// UNSUBSCRIBE_SECRET must be set in any real deployment; the fallback here
// exists only so this module (and anything that imports it) still works
// under `serverless offline`/tests without a .env file — a token signed
// with the fallback is guessable, so treat it as dev-only, never trust it
// to gate anything more sensitive than "which email checkbox is on."
const SECRET = process.env.UNSUBSCRIBE_SECRET || 'dev-only-unsubscribe-secret'

function sign(payload) {
  return crypto.createHmac('sha256', SECRET).update(payload).digest('base64url')
}

function createUnsubscribeToken(userId, pref) {
  const payload = `${userId}:${pref}`
  return Buffer.from(`${payload}:${sign(payload)}`).toString('base64url')
}

// Returns { userId, pref } if the token is well-formed and its signature
// checks out, otherwise null — callers should treat null as "reject."
function verifyUnsubscribeToken(token) {
  let decoded
  try {
    decoded = Buffer.from(String(token), 'base64url').toString('utf8')
  } catch {
    return null
  }
  const parts = decoded.split(':')
  if (parts.length !== 3) return null
  const [userId, pref, sig] = parts
  const expected = sign(`${userId}:${pref}`)
  const sigBuf = Buffer.from(sig)
  const expectedBuf = Buffer.from(expected)
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) return null
  return { userId, pref }
}

module.exports = { createUnsubscribeToken, verifyUnsubscribeToken }
