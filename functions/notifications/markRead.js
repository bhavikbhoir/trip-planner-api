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
    FilterExpression: '#r = :false',
    ExpressionAttributeNames: { '#r': 'read' },
    ExpressionAttributeValues: { ':u': `USER#${userId}`, ':false': false },
  })

  await Promise.all(
    items.map((i) =>
      db.updateIf(i.pk, i.sk, {
        UpdateExpression: 'SET #r = :true',
        ExpressionAttributeNames: { '#r': 'read' },
        ExpressionAttributeValues: { ':true': true },
      })
    )
  )

  return ok(200, { markedRead: items.length })
}
