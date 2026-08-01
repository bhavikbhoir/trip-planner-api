const { nanoid } = require('nanoid')
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

  const member = await db.get(`TRIP#${tripId}`, `MEMBER#${userId}`)
  if (!member) return err(403, 'Not a member of this trip')

  let body
  try {
    body = JSON.parse(event.body || '{}')
  } catch {
    return err(400, 'Invalid JSON body')
  }

  const { text, targetPlanVersion } = body
  if (!text || typeof text !== 'string') {
    return err(400, 'text is required')
  }

  const suggestionId = nanoid(10)
  const suggestionItem = {
    pk: `TRIP#${tripId}`,
    sk: `SUGGESTION#${suggestionId}`,
    tripId,
    suggestionId,
    text,
    targetPlanVersion: targetPlanVersion ?? null,
    authorId: userId,
    status: 'open',
    createdAt: new Date().toISOString(),
  }

  await db.put(suggestionItem)

  return ok(201, { suggestion: suggestionItem })
}
