const { nanoid } = require('nanoid')
const db = require('../../shared/db')
const { extractUserId } = require('../../shared/auth')
const { ok, err } = require('../../shared/response')
const { getTripAggregate } = require('../../shared/tripAggregate')
const { logUsageEvent } = require('../../shared/usageLog')
const { normalizeShares } = require('../../shared/expenseShares')

// Turns a booking's cost into a tracked expense — description/amount come
// from the booking itself, the caller only picks paidBy/splitBetween (same
// shape as logging any other expense). Both writes land in one transaction
// so a booking never ends up "converted" without the expense actually
// existing, or vice versa. A booking can only be converted once — the
// explicit action is meant to be a deliberate, one-time "also track this in
// the shared ledger," not a repeatable action that could double-count it.
exports.handler = async (event) => {
  let userId
  try {
    userId = await extractUserId(event)
  } catch (e) {
    return err(e.statusCode || 401, e.message || 'Unauthorized')
  }

  const tripId = event.pathParameters?.tripId
  const bookingId = event.pathParameters?.bookingId
  if (!tripId || !bookingId) return err(400, 'tripId and bookingId are required')

  const { trip, members } = await getTripAggregate(tripId)
  if (!trip) return err(404, 'Trip not found')

  const isMember = members.some((m) => m.userId === userId)
  if (!isMember) return err(403, 'Not a member of this trip')

  const booking = await db.get(`TRIP#${tripId}`, `BOOKING#${bookingId}`)
  if (!booking) return err(404, 'Booking not found')
  if (booking.convertedExpenseId) return err(409, 'This booking has already been added to expenses')
  if (booking.cost == null) return err(400, 'This booking has no cost to convert')

  let body
  try {
    body = JSON.parse(event.body || '{}')
  } catch {
    return err(400, 'Invalid JSON body')
  }

  const memberIds = new Set(members.map((m) => m.userId))
  const payer = body.paidBy || userId
  if (!memberIds.has(payer)) return err(400, 'paidBy must be a member of this trip')

  // Same default as logging any other expense — split evenly across
  // everyone unless the caller narrows it.
  const split = Array.isArray(body.splitBetween) && body.splitBetween.length ? body.splitBetween : [...memberIds]
  const invalidSplit = split.find((id) => !memberIds.has(id))
  if (invalidSplit) return err(400, `splitBetween includes a non-member: ${invalidSplit}`)

  let normalizedShares
  try {
    normalizedShares = normalizeShares(body.shares, split)
  } catch (e) {
    return err(400, e.message)
  }

  const expenseId = nanoid(10)
  const expense = {
    pk: `TRIP#${tripId}`,
    sk: `EXPENSE#${expenseId}`,
    tripId,
    expenseId,
    description: booking.name,
    amount: booking.cost,
    paidBy: payer,
    splitBetween: split,
    shares: normalizedShares,
    addedBy: userId,
    sourceBookingId: bookingId,
    createdAt: new Date().toISOString(),
  }
  const updatedBooking = { ...booking, convertedExpenseId: expenseId }

  await db.transactWrite([
    { Put: { TableName: db.TABLE_NAME, Item: expense } },
    { Put: { TableName: db.TABLE_NAME, Item: updatedBooking } },
  ])

  logUsageEvent('expense_created', { tripId })

  return ok(201, { expense, booking: updatedBooking })
}
