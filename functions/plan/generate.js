const db = require('../../shared/db')
const { extractUserId } = require('../../shared/auth')
const { ok, err } = require('../../shared/response')
const { getTripAggregate } = require('../../shared/tripAggregate')
const { getWeather } = require('../../shared/weather')
const { invokeClaude } = require('../../shared/bedrock')

const ICON_ENUM = ['plane', 'hotel', 'car', 'food', 'activity', 'other']
const GENERATE_COOLDOWN_MS = 30 * 1000

function buildPrompt({ trip, members, logistics, bookings, weather, suggestions }) {
  const preferenceLines = members
    .map((m) => {
      const p = m.preferences || {}
      const companions = (m.companions || [])
        .map((c) => `${c.name} (age ${c.age})`)
        .join(', ')
      return [
        `- Traveler ${m.userId}${m.role === 'owner' ? ' (trip owner)' : ''}:`,
        p.food?.length ? `  food: ${p.food.join(', ')}` : null,
        p.activities?.length ? `  activities: ${p.activities.join(', ')}` : null,
        p.budgetPace?.length ? `  budget/pace: ${p.budgetPace.join(', ')}` : null,
        p.groupDynamics?.length ? `  group dynamics: ${p.groupDynamics.join(', ')}` : null,
        p.dislikes ? `  dislikes/avoid: ${p.dislikes}` : null,
        p.mustDo ? `  must-do: ${p.mustDo}` : null,
        companions ? `  bringing: ${companions} — factor their ages into pacing and activity difficulty` : null,
      ]
        .filter(Boolean)
        .join('\n')
    })
    .join('\n')

  const logisticsLines = logistics
    .map((l) => {
      const parts = []
      if (l.arrival) parts.push(`arrives ${l.arrival.datetime || ''} (${l.arrival.flight || 'flight TBD'})`)
      if (l.departure) parts.push(`departs ${l.departure.datetime || ''} (${l.departure.flight || 'flight TBD'})`)
      return `- ${l.userId}: ${parts.join('; ')}`
    })
    .join('\n')

  const bookingLines = bookings
    .map((b) => `- ${b.type}: ${b.name}${b.location ? ` @ ${b.location}` : ''}, ${b.startDatetime} to ${b.endDatetime}`)
    .join('\n')

  const weatherLine = weather
    ? `Current conditions in ${weather.city}: ${weather.temperature}°F, ${weather.condition}. Use this as loose seasonal context, not a per-day forecast.`
    : 'Weather data unavailable — do not reference specific conditions.'

  const suggestionLines = (suggestions || [])
    .filter((s) => s.status === 'open')
    .map((s) => `- ${s.text}`)
    .join('\n')

  return `You are planning a group trip itinerary.

TRIP: ${trip.name} — ${trip.destination}, ${trip.startDate} to ${trip.endDate}

TRAVELER PREFERENCES:
${preferenceLines || '(no preferences submitted yet — use sensible general-audience defaults)'}

ARRIVAL/DEPARTURE LOGISTICS (hard anchors — do not schedule group activities before the last arrival or after the earliest departure):
${logisticsLines || '(none provided)'}

FIXED BOOKINGS (treat as anchors on the relevant days — e.g. hotel check-in/out times, car pickup/dropoff windows):
${bookingLines || '(none provided)'}

WEATHER: ${weatherLine}

GROUP FEEDBACK TO INCORPORATE (the group has explicitly asked for these changes — work them into the plan):
${suggestionLines || '(none)'}

TASK: Produce a day-by-day itinerary from ${trip.startDate} to ${trip.endDate} that respects every anchor above, reflects the aggregated preferences (including companion ages), and incorporates the group feedback above where reasonable. For each event, include your best-effort approximate "lat"/"lng" decimal coordinates for a rough map view (these are estimates for a casual map pin, not authoritative geocoding) — omit both if the event has no single meaningful location (e.g. a travel/arrival event, or a free/rest block).

Respond with ONLY valid JSON, no markdown fences, no commentary, in this exact shape:
{
  "days": [
    {
      "date": "YYYY-MM-DD",
      "events": [
        { "time": "H:MMa/p", "title": "string", "icon": "${ICON_ENUM.join('|')}", "note": "string or omit", "lat": number or omit, "lng": number or omit }
      ]
    }
  ]
}`
}

function parsePlanJSON(text) {
  const cleaned = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
  const parsed = JSON.parse(cleaned)
  if (!Array.isArray(parsed.days)) throw new Error('Response missing "days" array')
  return parsed
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

  const { trip, members, logistics, bookings, plans, suggestions } = await getTripAggregate(tripId)
  if (!trip) return err(404, 'Trip not found')

  const isMember = members.some((m) => m.userId === userId)
  if (!isMember) return err(403, 'Not a member of this trip')

  // Bedrock costs real money per call — this is a hard rate limit, not a UI nicety.
  // Atomic conditional write closes the race window a naive get-then-check-then-put
  // would leave open for two near-simultaneous requests.
  const now = new Date()
  const cutoff = new Date(now.getTime() - GENERATE_COOLDOWN_MS).toISOString()
  try {
    await db.updateIf(`TRIP#${tripId}`, 'META', {
      UpdateExpression: 'SET lastGeneratedAt = :now',
      ConditionExpression: 'attribute_not_exists(lastGeneratedAt) OR lastGeneratedAt < :cutoff',
      ExpressionAttributeValues: { ':now': now.toISOString(), ':cutoff': cutoff },
    })
  } catch (e) {
    if (e.name === 'ConditionalCheckFailedException') {
      return err(429, 'Please wait a few seconds before regenerating.')
    }
    throw e
  }

  const weather = await getWeather(trip.destination)
  const prompt = buildPrompt({ trip, members, logistics, bookings, weather, suggestions })

  let text
  try {
    text = await invokeClaude({ prompt, model: 'sonnet', maxTokens: 3000 })
  } catch (e) {
    return err(502, `AI generation failed: ${e.message}`)
  }

  let planBody
  try {
    planBody = parsePlanJSON(text)
  } catch (e) {
    return err(502, `AI returned unparseable itinerary JSON: ${e.message}. Raw response: ${text.slice(0, 500)}`)
  }

  const version = plans.length + 1
  const planItem = {
    pk: `TRIP#${tripId}`,
    sk: `PLAN#${version}`,
    tripId,
    version,
    days: planBody.days,
    generatedAt: new Date().toISOString(),
    generatedBy: userId,
  }

  await db.put(planItem)

  const openSuggestions = (suggestions || []).filter((s) => s.status === 'open')
  if (openSuggestions.length) {
    try {
      await Promise.all(
        openSuggestions.map((s) =>
          db.put({ ...s, status: 'resolved', resolvedAt: new Date().toISOString(), resolvedInVersion: version })
        )
      )
    } catch {
      // Best-effort — the plan itself was already saved successfully above;
      // a failure here just leaves those suggestions marked 'open' for next time.
    }
  }

  return ok(201, { plan: planItem })
}
