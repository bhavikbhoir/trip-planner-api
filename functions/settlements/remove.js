const db = require('../../shared/db')
const { extractUserId } = require('../../shared/auth')
const { ok, err } = require('../../shared/response')

// Undo a "mark as paid" — any member can undo, same open-collaboration
// stance as the rest of the app. Balances are always re-derived from
// expenses + settlements (never a stored running total), so deleting this
// record is the entire undo; nothing else needs adjusting.
exports.handler = async (event) => {
  let userId
  try {
    userId = await extractUserId(event)
  } catch (e) {
    return err(e.statusCode || 401, e.message || 'Unauthorized')
  }

  const tripId = event.pathParameters?.tripId
  const settlementId = event.pathParameters?.settlementId
  if (!tripId || !settlementId) return err(400, 'tripId and settlementId are required')

  const member = await db.get(`TRIP#${tripId}`, `MEMBER#${userId}`)
  if (!member) return err(403, 'Not a member of this trip')

  const settlement = await db.get(`TRIP#${tripId}`, `SETTLEMENT#${settlementId}`)
  if (!settlement) return err(404, 'Settlement not found')

  await db.del(`TRIP#${tripId}`, `SETTLEMENT#${settlementId}`)

  return ok(200, { deleted: true, settlementId })
}
