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

  const { trip, members, plans, approvals } = await getTripAggregate(tripId)
  if (!trip) return err(404, 'Trip not found')

  const isMember = members.some((m) => m.userId === userId)
  if (!isMember) return err(403, 'Not a member of this trip')

  if (!plans.length) {
    return err(400, 'This trip has no itinerary yet — generate one before finalizing')
  }

  const latestVersion = Math.max(...plans.map((p) => p.version))
  const isOwner = trip.ownerId === userId

  if (!isOwner) {
    const approvedUserIds = new Set(
      approvals.filter((a) => a.planVersion === latestVersion).map((a) => a.userId)
    )
    const missing = members.filter((m) => !approvedUserIds.has(m.userId))
    if (missing.length > 0) {
      return err(
        403,
        `${members.length - missing.length} of ${members.length} members have approved plan v${latestVersion} — the trip owner can override, or wait for everyone to approve`
      )
    }
  }

  const updatedTrip = {
    ...trip,
    status: 'finalized',
    finalizedAt: new Date().toISOString(),
    finalizedBy: userId,
    finalizedVersion: latestVersion,
  }

  await db.put(updatedTrip)

  return ok(200, { trip: updatedTrip })
}
