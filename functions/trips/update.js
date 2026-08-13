const db = require('../../shared/db')
const { extractUserId } = require('../../shared/auth')
const { ok, err } = require('../../shared/response')

const VALID_TRIP_TYPES = ['business', 'leisure', 'friends', 'family', 'date']

// Owner-only, unlike bookings/expenses. Name/destination/dates are the
// trip's identity — changing dates in particular can silently strand
// existing logistics/plan content outside the new range, so this stays
// gated the same way finalize/delete already are, rather than open to
// every member like the smaller logistics items.
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
  if (trip.ownerId !== userId) return err(403, 'Only the trip owner can edit trip details')

  let body
  try {
    body = JSON.parse(event.body || '{}')
  } catch {
    return err(400, 'Invalid JSON body')
  }

  const { name, destination, startDate, endDate, tripType } = body
  if (!name || !destination || !startDate || !endDate) {
    return err(400, 'name, destination, startDate, endDate are required')
  }
  if (tripType !== undefined && tripType !== null && !VALID_TRIP_TYPES.includes(tripType)) {
    return err(400, `tripType must be one of ${VALID_TRIP_TYPES.join(', ')}`)
  }

  const updated = {
    ...trip,
    name,
    destination,
    startDate,
    endDate,
    tripType: tripType !== undefined ? tripType || null : trip.tripType,
    updatedAt: new Date().toISOString(),
  }

  await db.put(updated)

  return ok(200, { trip: updated })
}
