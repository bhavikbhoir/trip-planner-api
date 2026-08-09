const db = require('../../shared/db')
const { extractUserId } = require('../../shared/auth')
const { ok, err } = require('../../shared/response')

// Which restaurant alternative the group chose for a meal event. Existence-
// based like DONE#, but carries the chosen index and the plan version it was
// made against. Regeneration assigns fresh eventIds *and* bumps the version,
// so a pick from an older version simply never matches an event in the new
// plan — "start clean each regeneration" falls out for free, no cleanup job.
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

  let body
  try {
    body = JSON.parse(event.body || '{}')
  } catch {
    return err(400, 'Invalid JSON body')
  }

  // chosenIndex indexes the combined option list [default, ...alternatives],
  // so 0 is the AI's original pick and 1+ are the alternatives.
  if (!Number.isInteger(body.chosenIndex) || body.chosenIndex < 0) {
    return err(400, 'chosenIndex must be a non-negative integer')
  }
  if (!Number.isInteger(body.planVersion)) {
    return err(400, 'planVersion is required')
  }

  const item = {
    pk: `TRIP#${tripId}`,
    sk: `PICK#${eventId}`,
    tripId,
    eventId,
    chosenIndex: body.chosenIndex,
    planVersion: body.planVersion,
    pickedBy: userId,
    pickedAt: new Date().toISOString(),
  }

  await db.put(item)

  return ok(200, { pick: item })
}
