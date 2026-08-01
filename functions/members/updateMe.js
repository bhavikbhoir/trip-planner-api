const db = require('../../shared/db')
const { extractUserId } = require('../../shared/auth')
const { ok, err } = require('../../shared/response')

exports.handler = async (event) => {
  let userId
  try {
    userId = await extractUserId(event)
  } catch (e) {
    return err(e.statusCode || 401, e.message || 'Unauthorized')
  }

  const tripId = event.pathParameters?.tripId
  if (!tripId) return err(400, 'tripId is required')

  let body
  try {
    body = JSON.parse(event.body || '{}')
  } catch {
    return err(400, 'Invalid JSON body')
  }

  const member = await db.get(`TRIP#${tripId}`, `MEMBER#${userId}`)
  if (!member) return err(403, 'Not a member of this trip')

  if (body.companions && !Array.isArray(body.companions)) {
    return err(400, 'companions must be an array of { name, age }')
  }

  const updated = {
    ...member,
    displayName: body.displayName !== undefined ? body.displayName : member.displayName || null,
    preferences: { ...(member.preferences || {}), ...(body.preferences || {}) },
    companions: body.companions !== undefined ? body.companions : member.companions || [],
    updatedAt: new Date().toISOString(),
  }

  await db.put(updated)

  return ok(200, { member: updated })
}
