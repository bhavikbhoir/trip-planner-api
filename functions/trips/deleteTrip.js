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

  const { trip, members, logistics, bookings, plans, suggestions, approvals, eventCompletions, eventSkips, eventSwaps, picks, expenses, tips, feedback } =
    await getTripAggregate(tripId)
  if (!trip) return err(404, 'Trip not found')

  if (trip.ownerId !== userId) {
    return err(403, 'Only the trip owner can delete this trip.')
  }

  const allItems = [
    trip,
    ...members,
    ...logistics,
    ...bookings,
    ...plans,
    ...suggestions,
    ...approvals,
    ...eventCompletions,
    ...eventSkips,
    ...eventSwaps,
    ...picks,
    ...expenses,
    ...tips,
    ...feedback,
  ]
  await Promise.all(allItems.map((item) => db.del(item.pk, item.sk)))
  // Not surfaced anywhere in the aggregate (it's an internal send-once
  // marker, not display data — see functions/trips/remindersWorker.js), so
  // it isn't in allItems above; deleting a key that was never written is a
  // harmless no-op, so this is safe to always attempt.
  await db.del(`TRIP#${tripId}`, 'REMINDER#trip_starting')

  return ok(200, { deleted: true, tripId })
}
