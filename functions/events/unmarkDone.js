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
  const eventId = event.pathParameters?.eventId
  if (!tripId || !eventId) return err(400, 'tripId and eventId are required')

  const member = await db.get(`TRIP#${tripId}`, `MEMBER#${userId}`)
  if (!member) return err(403, 'Not a member of this trip')

  await db.del(`TRIP#${tripId}`, `DONE#${eventId}`)

  return ok(200, { done: false, eventId })
}
