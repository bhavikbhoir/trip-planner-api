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

  const { planVersion } = body
  if (!planVersion || typeof planVersion !== 'number') {
    return err(400, 'planVersion (number) is required')
  }

  const approvalItem = {
    pk: `TRIP#${tripId}`,
    sk: `APPROVAL#${userId}#${planVersion}`,
    tripId,
    userId,
    planVersion,
    approved: true,
    approvedAt: new Date().toISOString(),
  }

  await db.put(approvalItem)

  return ok(200, { approval: approvalItem })
}
