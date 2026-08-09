const db = require('../../shared/db')
const { extractUserId } = require('../../shared/auth')
const { ok, err } = require('../../shared/response')

const VALID_TYPES = ['hotel', 'car', 'other']

// Any trip member can edit any booking — same open-collaboration stance as
// create/delete. Preserves the original addedBy/createdAt; overwrites the
// editable fields. Full replace (not partial) since the edit form always
// sends the complete booking.
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

  const member = await db.get(`TRIP#${tripId}`, `MEMBER#${userId}`)
  if (!member) return err(403, 'Not a member of this trip')

  const existing = await db.get(`TRIP#${tripId}`, `BOOKING#${bookingId}`)
  if (!existing) return err(404, 'Booking not found')

  let body
  try {
    body = JSON.parse(event.body || '{}')
  } catch {
    return err(400, 'Invalid JSON body')
  }

  const { type, name, location, startDatetime, endDatetime, confirmation, cost, referenceLink } = body
  if (!VALID_TYPES.includes(type)) {
    return err(400, `type must be one of ${VALID_TYPES.join(', ')}`)
  }
  if (!name || !startDatetime || !endDatetime) {
    return err(400, 'name, startDatetime, endDatetime are required')
  }
  if (referenceLink && !/^https?:\/\//i.test(referenceLink)) {
    return err(400, 'referenceLink must start with http:// or https://')
  }

  const bookingItem = {
    pk: `TRIP#${tripId}`,
    sk: `BOOKING#${bookingId}`,
    tripId,
    bookingId,
    type,
    name,
    location: location || null,
    startDatetime,
    endDatetime,
    confirmation: confirmation || null,
    cost: cost ?? null,
    referenceLink: referenceLink || null,
    addedBy: existing.addedBy,
    createdAt: existing.createdAt,
    updatedBy: userId,
    updatedAt: new Date().toISOString(),
  }

  await db.put(bookingItem)

  return ok(200, { booking: bookingItem })
}
