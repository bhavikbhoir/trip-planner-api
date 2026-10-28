const { nanoid } = require('nanoid')
const db = require('../../shared/db')
const { extractUserId } = require('../../shared/auth')
const { ok, err } = require('../../shared/response')
const { getTripAggregate } = require('../../shared/tripAggregate')

const VALID_METHODS = ['cash', 'online']

// Records that a "settle up" debt was actually paid outside the app — the
// debt itself (an expense split) never changes; this is a separate ledger
// entry that nets against it. computeBalances (frontend) and any future
// server-side balance computation both fold settlements in the same way:
// the payer's balance moves toward zero, the receiver's does too. Deleting
// a settlement (remove.js) is the undo — balances are always re-derived
// from expenses + settlements, never stored as a running total, so removing
// one just makes it as if the payment never happened.
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

  const { fromUserId, toUserId, amount, method } = body
  const memberIds = new Set(members.map((m) => m.userId))
  if (!fromUserId || !memberIds.has(fromUserId)) return err(400, 'fromUserId must be a member of this trip')
  if (!toUserId || !memberIds.has(toUserId)) return err(400, 'toUserId must be a member of this trip')
  if (fromUserId === toUserId) return err(400, 'fromUserId and toUserId must be different members')
  if (typeof amount !== 'number' || amount <= 0) return err(400, 'amount must be a positive number')
  if (!VALID_METHODS.includes(method)) return err(400, `method must be one of ${VALID_METHODS.join(', ')}`)

  const settlementId = nanoid(10)
  const settlement = {
    pk: `TRIP#${tripId}`,
    sk: `SETTLEMENT#${settlementId}`,
    tripId,
    settlementId,
    fromUserId,
    toUserId,
    amount,
    method,
    markedBy: userId,
    markedAt: new Date().toISOString(),
  }

  await db.put(settlement)

  return ok(201, { settlement })
}
