const { extractUserId } = require('../../shared/auth')
const { ok, err } = require('../../shared/response')
const { getTripAggregate } = require('../../shared/tripAggregate')

// The day-of view has one job: what's happening today, in order, nothing
// else. It reuses the latest generated plan and any bookings whose window
// covers the date — no new item types, no separate "day-of" data model.
function bookingCoversDate(booking, date) {
  const start = (booking.startDatetime || '').slice(0, 10)
  const end = (booking.endDatetime || booking.startDatetime || '').slice(0, 10)
  if (!start) return false
  return date >= start && date <= (end || start)
}

// Event times are stored as "H:MMa/p" (e.g. "9:40a", "10:00a", "6:00p") per
// the itinerary tool schema — a plain string sort puts "10:00a" before
// "9:40a", so this parses to minutes-since-midnight for a real chronological
// sort instead.
function timeToMinutes(time) {
  const match = /^(\d{1,2}):(\d{2})\s*([ap])/i.exec((time || '').trim())
  if (!match) return Number.MAX_SAFE_INTEGER
  let hour = parseInt(match[1], 10) % 12
  if (match[3].toLowerCase() === 'p') hour += 12
  return hour * 60 + parseInt(match[2], 10)
}

exports.handler = async (event) => {
  let userId
  try {
    userId = await extractUserId(event)
  } catch (e) {
    return err(e.statusCode || 401, e.message || 'Unauthorized')
  }

  const tripId = event.pathParameters?.tripId
  if (!tripId) return err(400, 'tripId is required')

  const { trip, members, bookings, plans, eventCompletions } = await getTripAggregate(tripId)
  if (!trip) return err(404, 'Trip not found')

  const isMember = members.some((m) => m.userId === userId)
  if (!isMember) return err(403, 'Not a member of this trip')

  // "Today" is genuinely ambiguous across timezones (destination vs viewer),
  // so the client passes its own local date; this only falls back to the
  // server's UTC date if the client omits it.
  const date = event.queryStringParameters?.date || new Date().toISOString().slice(0, 10)

  const doneEventIds = new Set((eventCompletions || []).map((c) => c.eventId))
  const latestPlan = plans.length ? plans.reduce((a, b) => (b.version > a.version ? b : a)) : null
  const day = latestPlan?.days?.find((d) => d.date === date) || null
  const events = (day?.events || [])
    .slice()
    .sort((a, b) => timeToMinutes(a.time) - timeToMinutes(b.time))
    .map((ev) => ({ ...ev, done: doneEventIds.has(ev.eventId) }))

  const activeBookings = bookings.filter((b) => bookingCoversDate(b, date))

  return ok(200, {
    date,
    tripStatus: trip.status,
    planVersion: latestPlan?.version || null,
    events,
    bookings: activeBookings,
  })
}
