// DynamoDB-backed storage for our own OAuth authorization server (see
// authorize.js/callback.js/token.js/register.js). Reuses shared/db.js's
// table/client rather than opening a new connection. No native DynamoDB TTL
// wired up for v1 — short-lived rows are small and harmless if they linger;
// callers are responsible for checking `createdAt` against their own
// expiry window, this module only does storage + atomic single-use consume.
const { DeleteCommand } = require('@aws-sdk/lib-dynamodb')
const db = require('../../../shared/db')

async function putClient({ clientId, redirectUris, clientName, source }) {
  const item = { pk: `OAUTHCLIENT#${clientId}`, sk: 'META', clientId, redirectUris, clientName, source, createdAt: new Date().toISOString() }
  await db.put(item)
  return item
}

function getClient(clientId) {
  return db.get(`OAUTHCLIENT#${clientId}`, 'META')
}

async function putSession(session) {
  const item = { pk: `OAUTHSESSION#${session.sessionId}`, sk: 'META', ...session, createdAt: new Date().toISOString() }
  await db.put(item)
  return item
}

// Atomic single-use consume: ReturnValues ALL_OLD means only the request that
// actually deletes the still-existing item gets its data back — a replayed
// or concurrent second call sees no Attributes and must be rejected. Used
// for sessions, codes, and refresh tokens alike, since all three are
// meant to be usable exactly once.
async function takeItem(pk) {
  const res = await db.doc.send(new DeleteCommand({ TableName: db.TABLE_NAME, Key: { pk, sk: 'META' }, ReturnValues: 'ALL_OLD' }))
  return res.Attributes || null
}

const takeSession = (sessionId) => takeItem(`OAUTHSESSION#${sessionId}`)

async function putCode(code) {
  const item = { pk: `OAUTHCODE#${code.code}`, sk: 'META', ...code, createdAt: new Date().toISOString() }
  await db.put(item)
  return item
}

const takeCode = (code) => takeItem(`OAUTHCODE#${code}`)

async function putRefreshToken(token) {
  const item = { pk: `OAUTHREFRESH#${token.refreshToken}`, sk: 'META', ...token, createdAt: new Date().toISOString() }
  await db.put(item)
  return item
}

const takeRefreshToken = (refreshToken) => takeItem(`OAUTHREFRESH#${refreshToken}`)

module.exports = {
  putClient,
  getClient,
  putSession,
  takeSession,
  putCode,
  takeCode,
  putRefreshToken,
  takeRefreshToken,
}
