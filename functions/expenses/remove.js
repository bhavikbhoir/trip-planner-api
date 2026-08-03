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
  const expenseId = event.pathParameters?.expenseId
  if (!tripId || !expenseId) return err(400, 'tripId and expenseId are required')

  const member = await db.get(`TRIP#${tripId}`, `MEMBER#${userId}`)
  if (!member) return err(403, 'Not a member of this trip')

  const expense = await db.get(`TRIP#${tripId}`, `EXPENSE#${expenseId}`)
  if (!expense) return err(404, 'Expense not found')

  await db.del(`TRIP#${tripId}`, `EXPENSE#${expenseId}`)

  return ok(200, { deleted: true, expenseId })
}
