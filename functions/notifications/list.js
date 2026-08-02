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

  const items = await db.query({
    IndexName: 'GSI2',
    KeyConditionExpression: 'GSI2pk = :u',
    ExpressionAttributeValues: { ':u': `USER#${userId}` },
    ScanIndexForward: false,
    Limit: 50,
  })

  const notifications = items.map((i) => ({
    notificationId: i.sk.replace('NOTIFICATION#', ''),
    tripId: i.tripId,
    tripName: i.tripName,
    type: i.type,
    actorDisplayName: i.actorDisplayName,
    createdAt: i.createdAt,
    read: i.read,
  }))

  const unreadCount = notifications.filter((n) => !n.read).length

  return ok(200, { notifications, unreadCount })
}
