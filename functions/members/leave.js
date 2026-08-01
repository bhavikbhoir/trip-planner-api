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

  const member = await db.get(`TRIP#${tripId}`, `MEMBER#${userId}`)
  if (!member) return err(403, 'Not a member of this trip')

  if (trip.ownerId === userId) {
    return err(403, "Trip owners can't leave — delete the trip instead.")
  }

  // Past suggestions/approvals are left in place as a historical record —
  // deliberately not cascaded on leave.
  await db.del(`TRIP#${tripId}`, `MEMBER#${userId}`)
  await db.del(`TRIP#${tripId}`, `LOGISTICS#${userId}`)

  return ok(200, { left: true, tripId })
}
