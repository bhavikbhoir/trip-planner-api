const db = require('../../shared/db')
const { extractUserId } = require('../../shared/auth')
const { ok, err } = require('../../shared/response')
const { getTripAggregate } = require('../../shared/tripAggregate')

exports.handler = async (event) => {
  let userId
  try {
    userId = await extractUserId(event)
  } catch (e) {
    return err(e.statusCode || 401, e.message || 'Unauthorized')
  }

  const tripId = event.pathParameters?.tripId
  if (!tripId) return err(400, 'tripId is required')

  const { trip, members, logistics, bookings, plans, suggestions, approvals, eventCompletions, expenses } = await getTripAggregate(tripId)
  if (!trip) return err(404, 'Trip not found')

  if (trip.ownerId !== userId) {
    return err(403, 'Only the trip owner can delete this trip.')
  }

  const allItems = [trip, ...members, ...logistics, ...bookings, ...plans, ...suggestions, ...approvals, ...eventCompletions, ...expenses]
  await Promise.all(allItems.map((item) => db.del(item.pk, item.sk)))

  return ok(200, { deleted: true, tripId })
}
