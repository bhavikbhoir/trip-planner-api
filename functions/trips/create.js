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

  let body
  try {
    body = JSON.parse(event.body || '{}')
  } catch {
    return err(400, 'Invalid JSON body')
  }

  const { name, destination, startDate, endDate, displayName } = body
  if (!name || !destination || !startDate || !endDate) {
    return err(400, 'name, destination, startDate, endDate are required')
  }

  const tripId = nanoid(10)
  const now = new Date().toISOString()

  const tripItem = {
    pk: `TRIP#${tripId}`,
    sk: 'META',
    tripId,
    name,
    destination,
    startDate,
    endDate,
    ownerId: userId,
    status: 'planning',
    createdAt: now,
  }

  const memberItem = {
    pk: `TRIP#${tripId}`,
    sk: `MEMBER#${userId}`,
    tripId,
    userId,
    displayName: displayName || null,
    role: 'owner',
    joinedAt: now,
    GSI1pk: `USER#${userId}`,
    GSI1sk: `TRIP#${tripId}`,
  }

  await db.transactWrite([
    { Put: { TableName: db.TABLE_NAME, Item: tripItem } },
    { Put: { TableName: db.TABLE_NAME, Item: memberItem } },
  ])

  return ok(201, { trip: tripItem })
}
