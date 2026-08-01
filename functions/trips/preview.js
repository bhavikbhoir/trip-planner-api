const { extractUserId } = require('../../shared/auth')
const { ok, err } = require('../../shared/response')
const { getTripAggregate } = require('../../shared/tripAggregate')

// Deliberately membership-optional (unlike trips/get.js) — this exists so an
// invite link can show "You're invited to X" before the visitor has joined.
// Returns only the minimum needed for that preview, never full trip data.
exports.handler = async (event) => {
  try {
    await extractUserId(event)
  } catch (e) {
    return err(e.statusCode || 401, e.message || 'Unauthorized')
  }

  const tripId = event.pathParameters?.tripId
  if (!tripId) return err(400, 'tripId is required')

  const { trip, members } = await getTripAggregate(tripId)
  if (!trip) return err(404, 'Trip not found')

  return ok(200, { name: trip.name, destination: trip.destination, memberCount: members.length })
}
