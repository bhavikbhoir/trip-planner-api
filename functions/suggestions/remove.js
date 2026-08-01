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
  const suggestionId = event.pathParameters?.suggestionId
  if (!tripId || !suggestionId) return err(400, 'tripId and suggestionId are required')

  const member = await db.get(`TRIP#${tripId}`, `MEMBER#${userId}`)
  if (!member) return err(403, 'Not a member of this trip')

  const suggestion = await db.get(`TRIP#${tripId}`, `SUGGESTION#${suggestionId}`)
  if (!suggestion) return err(404, 'Suggestion not found')

  await db.del(`TRIP#${tripId}`, `SUGGESTION#${suggestionId}`)

  return ok(200, { deleted: true, suggestionId })
}
