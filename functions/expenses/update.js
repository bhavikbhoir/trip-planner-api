const db = require('../../shared/db')
const { extractUserId } = require('../../shared/auth')
const { ok, err } = require('../../shared/response')
const { getTripAggregate } = require('../../shared/tripAggregate')
const { normalizeShares } = require('../../shared/expenseShares')

// Any trip member can edit any expense — same open-collaboration stance as
// create/delete. Preserves addedBy/createdAt/sourceBookingId; overwrites the
// editable fields. Full replace (not partial) since the edit form always
// sends the complete expense.
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

  const { trip, members } = await getTripAggregate(tripId)
  if (!trip) return err(404, 'Trip not found')

  const isMember = members.some((m) => m.userId === userId)
  if (!isMember) return err(403, 'Not a member of this trip')

  const existing = await db.get(`TRIP#${tripId}`, `EXPENSE#${expenseId}`)
  if (!existing) return err(404, 'Expense not found')

  let body
  try {
    body = JSON.parse(event.body || '{}')
  } catch {
    return err(400, 'Invalid JSON body')
  }

  const { description, amount, paidBy, splitBetween, shares } = body
  if (!description || typeof description !== 'string') return err(400, 'description is required')
  if (typeof amount !== 'number' || amount <= 0) return err(400, 'amount must be a positive number')

  const memberIds = new Set(members.map((m) => m.userId))
  const payer = paidBy || existing.paidBy
  if (!memberIds.has(payer)) return err(400, 'paidBy must be a member of this trip')

  const split = Array.isArray(splitBetween) && splitBetween.length ? splitBetween : existing.splitBetween
  const invalidSplit = split.find((id) => !memberIds.has(id))
  if (invalidSplit) return err(400, `splitBetween includes a non-member: ${invalidSplit}`)

  let normalizedShares
  try {
    normalizedShares = normalizeShares(shares, split)
  } catch (e) {
    return err(400, e.message)
  }

  const expense = {
    ...existing,
    description,
    amount,
    paidBy: payer,
    splitBetween: split,
    shares: normalizedShares,
    updatedBy: userId,
    updatedAt: new Date().toISOString(),
  }

  await db.put(expense)

  return ok(200, { expense })
}
