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
  const bookingId = event.pathParameters?.bookingId
  if (!tripId || !bookingId) return err(400, 'tripId and bookingId are required')

  const member = await db.get(`TRIP#${tripId}`, `MEMBER#${userId}`)
  if (!member) return err(403, 'Not a member of this trip')

  const booking = await db.get(`TRIP#${tripId}`, `BOOKING#${bookingId}`)
  if (!booking) return err(404, 'Booking not found')

  await db.del(`TRIP#${tripId}`, `BOOKING#${bookingId}`)

  return ok(200, { deleted: true, bookingId })
}
