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

  const trip = await db.get(`TRIP#${tripId}`, 'META')
  if (!trip) return err(404, 'Trip not found')

  const existing = await db.get(`TRIP#${tripId}`, `MEMBER#${userId}`)
  if (existing) return ok(200, { trip, alreadyMember: true })

  const now = new Date().toISOString()
  const memberItem = {
    pk: `TRIP#${tripId}`,
    sk: `MEMBER#${userId}`,
    tripId,
    userId,
    role: 'member',
    joinedAt: now,
    GSI1pk: `USER#${userId}`,
    GSI1sk: `TRIP#${tripId}`,
  }

  await db.put(memberItem)

  return ok(200, { trip, member: memberItem })
}
