const { nanoid } = require('nanoid')
const db = require('../../shared/db')
const { extractUserId } = require('../../shared/auth')
const { ok, err } = require('../../shared/response')
const { getTripAggregate } = require('../../shared/tripAggregate')

exports.handler = async (event) => {
  let userId
  try {
    userId = await extractUserId(event)
  } catch (e) {
    return err(e.statusCode || 401, e.message || 'Unauthorized')
  }

  const tripId = event.pathParameters?.tripId
  if (!tripId) return err(400, 'tripId is required')

  const { trip, members } = await getTripAggregate(tripId)
  if (!trip) return err(404, 'Trip not found')

  const isMember = members.some((m) => m.userId === userId)
  if (!isMember) return err(403, 'Not a member of this trip')

  let body
  try {
    body = JSON.parse(event.body || '{}')
  } catch {
    return err(400, 'Invalid JSON body')
  }

  const { description, amount, paidBy, splitBetween } = body
  if (!description || typeof description !== 'string') return err(400, 'description is required')
  if (typeof amount !== 'number' || amount <= 0) return err(400, 'amount must be a positive number')

  const memberIds = new Set(members.map((m) => m.userId))
  const payer = paidBy || userId
  if (!memberIds.has(payer)) return err(400, 'paidBy must be a member of this trip')

  // Defaults to splitting evenly across every current member — the common
  // case ("we all split dinner"). A caller can narrow it (e.g. two of four
  // people went on the optional excursion) by passing an explicit list.
  const split = Array.isArray(splitBetween) && splitBetween.length ? splitBetween : [...memberIds]
  const invalidSplit = split.find((id) => !memberIds.has(id))
  if (invalidSplit) return err(400, `splitBetween includes a non-member: ${invalidSplit}`)

  const expenseId = nanoid(10)
  const expense = {
    pk: `TRIP#${tripId}`,
    sk: `EXPENSE#${expenseId}`,
    tripId,
    expenseId,
    description,
    amount,
    paidBy: payer,
    splitBetween: split,
    addedBy: userId,
    createdAt: new Date().toISOString(),
  }

  await db.put(expense)

  return ok(201, { expense })
}
