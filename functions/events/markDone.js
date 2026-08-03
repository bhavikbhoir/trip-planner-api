const db = require('../../shared/db')
const { extractUserId } = require('../../shared/auth')
const { ok, err } = require('../../shared/response')

// Completion is existence-based, same as approvals — a DONE#<eventId> item
// present means done, absent means not. No separate boolean field to drift
// out of sync with the item's own existence.
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

  const item = {
    pk: `TRIP#${tripId}`,
    sk: `DONE#${eventId}`,
    tripId,
    eventId,
    doneBy: userId,
    doneAt: new Date().toISOString(),
  }

  await db.put(item)

  return ok(200, { done: true, eventId })
}
