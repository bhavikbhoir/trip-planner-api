const db = require('../../shared/db')
const { extractUserId } = require('../../shared/auth')
const { ok, err } = require('../../shared/response')
const { notifyMembers } = require('../../shared/notify')

exports.handler = async (event) => {
  let userId
  try {
    userId = await extractUserId(event)
  } catch (e) {
    return err(e.statusCode || 401, e.message || 'Unauthorized')
  }

  const tripId = event.pathParameters?.tripId
  if (!tripId) return err(400, 'tripId is required')

  let body
  try {
    body = JSON.parse(event.body || '{}')
  } catch {
    return err(400, 'Invalid JSON body')
  }

  const trip = await db.get(`TRIP#${tripId}`, 'META')
  if (!trip) return err(404, 'Trip not found')

  const existing = await db.get(`TRIP#${tripId}`, `MEMBER#${userId}`)
  if (existing) return ok(200, { trip, alreadyMember: true })

  // Existing members to notify — queried before this join is written, so the
  // joiner never notifies themselves.
  const existingMembers = await db.query({
    KeyConditionExpression: 'pk = :p AND begins_with(sk, :m)',
    ExpressionAttributeValues: { ':p': `TRIP#${tripId}`, ':m': 'MEMBER#' },
  })

  const now = new Date().toISOString()
  const memberItem = {
    pk: `TRIP#${tripId}`,
    sk: `MEMBER#${userId}`,
    tripId,
    userId,
    displayName: body.displayName || null,
    role: 'member',
    joinedAt: now,
    GSI1pk: `USER#${userId}`,
    GSI1sk: `TRIP#${tripId}`,
  }

  await db.put(memberItem)

  await notifyMembers({
    tripId,
    tripName: trip.name,
    recipients: existingMembers.map((m) => m.userId),
    type: 'member_joined',
    actorId: userId,
    actorDisplayName: body.displayName || null,
  })

  return ok(200, { trip, member: memberItem })
}
