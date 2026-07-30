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

  const memberships = await db.query({
    IndexName: 'GSI1',
    KeyConditionExpression: 'GSI1pk = :u',
    ExpressionAttributeValues: { ':u': `USER#${userId}` },
  })

  if (!memberships.length) return ok(200, { trips: [] })

  const keys = memberships.map((m) => ({ pk: m.pk, sk: 'META' }))
  const trips = await db.batchGet(keys)
  trips.sort((a, b) => (a.startDate < b.startDate ? -1 : 1))

  return ok(200, { trips })
}
