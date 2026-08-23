const db = require('../../shared/db')
const { extractUserId } = require('../../shared/auth')
const { ok, err } = require('../../shared/response')
const { getTripAggregate } = require('../../shared/tripAggregate')
const { logUsageEvent } = require('../../shared/usageLog')

// Marking a trip complete is deliberately open to any member, unlike
// finalize (which gates on approvals) — closing out a trip that already
// happened isn't a plan decision, it's just recording reality. completedAt
// is explicit and persisted rather than derived from endDate so a trip can
// be closed early (plans changed) or reopened without the recap numbers
// silently shifting as today's date moves.
exports.handler = async (event) => {
  let userId
  try {
    userId = await extractUserId(event)
  } catch (e) {
    return err(e.statusCode || 401, e.message || 'Unauthorized')
  }

  const tripId = event.pathParameters?.tripId
  if (!tripId) return err(400, 'tripId is required')

  const { trip, members } = await getTripAggregate(tripId)
  if (!trip) return err(404, 'Trip not found')

  const isMember = members.some((m) => m.userId === userId)
  if (!isMember) return err(403, 'Not a member of this trip')

  const updatedTrip = { ...trip, completedAt: new Date().toISOString(), completedBy: userId }
  await db.put(updatedTrip)
  logUsageEvent('trip_completed', { tripId, memberCount: members.length })

  return ok(200, { trip: updatedTrip })
}
