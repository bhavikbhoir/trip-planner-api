const { nanoid } = require('nanoid')
const db = require('../../shared/db')
const { extractUserId } = require('../../shared/auth')
const { ok, err } = require('../../shared/response')

const VALID_TYPES = ['hotel', 'car', 'other']

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

  const { type, name, location, startDatetime, endDatetime, confirmation, cost, referenceLink } = body
  if (!VALID_TYPES.includes(type)) {
    return err(400, `type must be one of ${VALID_TYPES.join(', ')}`)
  }
  if (!name || !startDatetime || !endDatetime) {
    return err(400, 'name, startDatetime, endDatetime are required')
  }

  const bookingId = nanoid(10)
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
    // Free-form reference (Booking.com/Airbnb/PDF confirmation/etc.) — not validated
    // as a strict URL, just stored as given so a screenshot host link works too.
    referenceLink: referenceLink || null,
    addedBy: userId,
    createdAt: new Date().toISOString(),
  }

  await db.put(bookingItem)

  return ok(201, { booking: bookingItem })
}
