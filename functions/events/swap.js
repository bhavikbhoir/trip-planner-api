const db = require('../../shared/db')
const { extractUserId } = require('../../shared/auth')
const { ok, err } = require('../../shared/response')

// "Swapped" = the group did something different instead of the suggested
// event — note is where "what did we do different" (the user's own framing)
// actually gets captured, surfaced later on the trip recap.
exports.handler = async (event) => {
  let userId
  try {
    userId = await extractUserId(event)
  } catch (e) {
    return err(e.statusCode || 401, e.message || 'Unauthorized')
  }

  const tripId = event.pathParameters?.tripId
  const eventId = event.pathParameters?.eventId
  if (!tripId || !eventId) return err(400, 'tripId and eventId are required')

  const member = await db.get(`TRIP#${tripId}`, `MEMBER#${userId}`)
  if (!member) return err(403, 'Not a member of this trip')

  let note
  try {
    const body = event.body ? JSON.parse(event.body) : {}
    note = typeof body.note === 'string' ? body.note.trim().slice(0, 500) || undefined : undefined
  } catch {
    return err(400, 'Invalid JSON body')
  }

  const pk = `TRIP#${tripId}`
  const item = { pk, sk: `SWAPPED#${eventId}`, tripId, eventId, swappedBy: userId, swappedAt: new Date().toISOString(), note }

  await db.transactWrite([
    { Put: { TableName: db.TABLE_NAME, Item: item } },
    { Delete: { TableName: db.TABLE_NAME, Key: { pk, sk: `DONE#${eventId}` } } },
    { Delete: { TableName: db.TABLE_NAME, Key: { pk, sk: `SKIPPED#${eventId}` } } },
  ])

  return ok(200, { status: 'swapped', eventId, note: note || null })
}
