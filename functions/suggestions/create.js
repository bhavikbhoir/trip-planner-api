const { nanoid } = require('nanoid')
const db = require('../../shared/db')
const { extractUserId } = require('../../shared/auth')
const { ok, err } = require('../../shared/response')
const { notifyMembers } = require('../../shared/notify')
const { logUsageEvent } = require('../../shared/usageLog')

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

  logUsageEvent('suggestion_added', { tripId })

  const otherMembers = await db.query({
    KeyConditionExpression: 'pk = :p AND begins_with(sk, :m)',
    ExpressionAttributeValues: { ':p': `TRIP#${tripId}`, ':m': 'MEMBER#' },
  })

  await notifyMembers({
    tripId,
    tripName: trip.name,
    recipients: otherMembers.filter((m) => m.userId !== userId).map((m) => m.userId),
    type: 'suggestion_added',
    actorId: userId,
    actorDisplayName: member.displayName || null,
  })

  return ok(201, { suggestion: suggestionItem })
}
