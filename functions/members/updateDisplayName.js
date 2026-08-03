const db = require('../../shared/db')
const { extractUserId } = require('../../shared/auth')
const { ok, err } = require('../../shared/response')

// User-scoped, not trip-scoped — mirrors /notifications. Cognito's `name`
// attribute is updated client-side (Amplify), which is the source of truth
// for *new* trips going forward; this syncs the cached displayName already
// sitting on every MEMBER# item for trips the user already belongs to, so a
// name change is actually visible somewhere instead of silently doing nothing.
exports.handler = async (event) => {
  let userId
  try {
    userId = await extractUserId(event)
  } catch (e) {
    return err(e.statusCode || 401, e.message || 'Unauthorized')
  }

  let body
  try {
    body = JSON.parse(event.body || '{}')
  } catch {
    return err(400, 'Invalid JSON body')
  }

  const displayName = typeof body.displayName === 'string' ? body.displayName.trim() : ''
  if (!displayName) return err(400, 'displayName is required')

  const memberships = await db.query({
    IndexName: 'GSI1',
    KeyConditionExpression: 'GSI1pk = :u',
    ExpressionAttributeValues: { ':u': `USER#${userId}` },
  })

  await Promise.all(memberships.map((m) => db.put({ ...m, displayName })))

  return ok(200, { displayName, tripsUpdated: memberships.length })
}
