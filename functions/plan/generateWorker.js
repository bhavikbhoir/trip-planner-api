const { nanoid } = require('nanoid')
const db = require('../../shared/db')
const { getTripAggregate } = require('../../shared/tripAggregate')
const { getWeather } = require('../../shared/weather')
const { invokeClaude } = require('../../shared/bedrock')
const { notifyMembers } = require('../../shared/notify')
const { findLocationContexts } = require('../../shared/overpass')
const { getLegOptions } = require('../../shared/osrm')
const { logUsageEvent } = require('../../shared/usageLog')

const ICON_ENUM = ['plane', 'hotel', 'car', 'food', 'activity', 'other']

// Forcing the response through this tool (via tool_choice) replaces the old
// "respond with ONLY valid JSON, no markdown fences" text instruction — the
// model can no longer hand back a truncated string or fenced code block,
// since tool_use.input arrives already parsed and schema-conformant.
const ITINERARY_TOOL = {
  name: 'propose_itinerary',
  description: 'Propose or revise the day-by-day trip itinerary.',
  input_schema: {
    type: 'object',
    properties: {
      days: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            date: { type: 'string', description: 'YYYY-MM-DD' },
            events: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  time: { type: 'string', description: 'e.g. "9:40a", "6:00p"' },
                  title: { type: 'string' },
                  icon: { type: 'string', enum: ICON_ENUM },
                  note: { type: 'string', description: 'Optional — omit if not useful' },
                  lat: { type: 'number', description: 'Optional — omit if the event has no single meaningful location' },
                  lng: { type: 'number', description: 'Optional — omit if the event has no single meaningful location' },
                  costPerPerson: { type: 'number', description: 'Optional — whole-number USD estimate, omit if no inherent per-person cost' },
                  timeToSpend: { type: 'string', description: 'Optional — e.g. "1-1.5 hrs", omit for quick logistics events' },
                  transitEstimate: {
                    type: 'string',
                    description:
                      'Optional. ONLY include if public transit is a genuinely plausible way to reach this stop from the previous one (a real subway/bus/train system you know exists at this destination). Must read as an estimate, not a fact — e.g. "Bus ~15-20 min, verify route/schedule locally" — never a specific line number or timetable you are not certain of. Omit entirely rather than guessing for destinations without known transit.',
                  },
                },
                required: ['time', 'title', 'icon'],
              },
            },
          },
          required: ['date', 'events'],
        },
      },
    },
    required: ['days'],
  },
}

function summarizePlan(plan) {
  // Deliberately compact (time/title/icon/cost/duration only, no notes/lat/lng)
  // — this exists so the model has the current itinerary as a baseline to
  // revise, not to re-supply every detail it already generated once;
  // keeping it terse leaves the output token budget for the actual
  // response. Cost and duration are included so a revision doesn't
  // silently drop estimates already made for unaffected events.
  return plan.days
    .map((d) => {
      const lines = d.events
        .map((e) => {
          const cost = e.costPerPerson != null ? ` ~$${e.costPerPerson}/person` : ''
          const duration = e.timeToSpend ? ` (${e.timeToSpend})` : ''
          return `  ${e.time} ${e.title} [${e.icon}]${duration}${cost}`
        })
        .join('\n')
      return `${d.date}:\n${lines}`
    })
    .join('\n')
}

const TRIP_TYPE_GUIDANCE = {
  business: 'This is a business trip — respect likely work hours, keep evenings lower-key, and don\'t assume everyone wants to socialize non-stop.',
  date: 'This is a date trip — favor intimate, small-scale venues and avoid large, crowded group-activity suggestions.',
  family: 'This is a family trip — plan as multi-generational and kid-friendly by default (gentler pacing, fewer late nights) even where explicit companion ages aren\'t given.',
  friends: 'This is a friends trip — feel free to be social and flexible; a packed schedule and nightlife are welcome here.',
  leisure: 'This is a general leisure trip — no particular skew, use sensible relaxed defaults.',
}

function buildPrompt({ trip, members, logistics, bookings, weather, suggestions, latestPlan }) {
  // Members carry displayName directly; logistics items only have a userId,
  // so cross-reference through this map — without it (the original bug),
  // the prompt only ever saw raw Cognito user ids, and Claude normalized
  // them into generic "Traveler 1/2/3" labels since it never knew anyone's
  // actual name.
  const nameById = new Map(members.map((m) => [m.userId, m.displayName || 'A traveler']))
  const nameFor = (userId) => nameById.get(userId) || 'A traveler'

  const preferenceLines = members
    .map((m) => {
      const p = m.preferences || {}
      const companions = (m.companions || [])
        .map((c) => `${c.name} (age ${c.age})`)
        .join(', ')
      return [
        `- ${nameFor(m.userId)}${m.role === 'owner' ? ' (trip owner)' : ''}:`,
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
      const driving = l.transportMode === 'driving'
      const parts = []
      if (l.arrival) {
        parts.push(
          driving
            ? `driving, planning to arrive by ${l.arrival.datetime || ''}`
            : `arrives ${l.arrival.datetime || ''} (${l.arrival.flight || 'flight TBD'})`
        )
      }
      if (l.departure) {
        parts.push(
          driving
            ? `needs to leave by ${l.departure.datetime || ''}`
            : `departs ${l.departure.datetime || ''} (${l.departure.flight || 'flight TBD'})`
        )
      }
      return `- ${nameFor(l.userId)}: ${parts.join('; ')}`
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

  const tripTypeLine = trip.tripType && TRIP_TYPE_GUIDANCE[trip.tripType] ? `\n${TRIP_TYPE_GUIDANCE[trip.tripType]}` : ''

  return `You are planning a group trip itinerary.

TRIP: ${trip.name} — ${trip.destination}, ${trip.startDate} to ${trip.endDate}${tripTypeLine}

TRAVELER PREFERENCES:
${preferenceLines || '(no preferences submitted yet — use sensible general-audience defaults)'}

ARRIVAL/DEPARTURE LOGISTICS (hard anchors — do not schedule group activities before the last arrival or after the earliest departure):
${logisticsLines || '(none provided)'}

FIXED BOOKINGS (treat as anchors on the relevant days — e.g. hotel check-in/out times, car pickup/dropoff windows):
${bookingLines || '(none provided)'}

WEATHER: ${weatherLine}

GROUP FEEDBACK TO INCORPORATE (the group has explicitly asked for these changes — work them into the plan):
${suggestionLines || '(none)'}
${
  latestPlan
    ? `
CURRENT ITINERARY (v${latestPlan.version}) — this is the plan as it stands today:
${summarizePlan(latestPlan)}
`
    : ''
}
TASK: ${
    latestPlan
      ? `Revise the CURRENT ITINERARY above to incorporate the group feedback and any preference/logistics changes reflected elsewhere in this prompt. Keep what's already working — do not regenerate the whole trip from scratch or restructure days that aren't affected by the feedback, unless a hard anchor (arrival/departure/booking) genuinely requires it.`
      : `Produce a day-by-day itinerary from ${trip.startDate} to ${trip.endDate}.`
  } Respect every anchor above, reflect the aggregated preferences (including companion ages), and incorporate the group feedback above where reasonable. When an event involves a specific traveler (e.g. an arrival/departure), refer to them by the actual name given above (e.g. "Shrija arrives") — never invent generic labels like "Traveler 1" or "Traveler 3 (trip owner)". For each event, include your best-effort approximate "lat"/"lng" decimal coordinates for a rough map view (these are estimates for a casual map pin, not authoritative geocoding) — omit both if the event has no single meaningful location (e.g. a travel/arrival event, or a free/rest block). For any event with a real per-person cost (museum/attraction tickets, restaurant meals, tours, etc.), include your best-effort approximate "costPerPerson" as a whole-number USD estimate (e.g. a $25 ticket, a $18 meal) so the group can judge affordability at a glance — omit it for events with no inherent per-person cost (arrivals, free activities, rest blocks, transit). Include a "timeToSpend" duration estimate (e.g. "1–1.5 hrs") on events where that's meaningful (activities, meals, attractions) — omit it for quick logistics events (arrivals, short transit hops). For any car-based travel segment (a driving member's logistics, or a long drive between stops) and generally across a full day, build in natural rest/coffee/freshen-up breaks every couple of hours rather than scheduling back-to-back activities with no downtime — insert these as their own short events when they're a real planning consideration, not on every single transition. Where genuinely useful, weave extra practical guidance into an event's "note" — expected wait times (e.g. a popular restaurant at peak hours), the best time/spot for photos, or typical opening/closing hours — but only where it adds real value, not as boilerplate on every event, and phrase hours/wait-time claims as general guidance to verify locally rather than as confirmed facts. Real walking-estimate and driving-route distances between consecutive stops are computed separately and shown alongside your plan — you don't need to estimate those yourself. Only use "transitEstimate" when public transit is a genuinely plausible way to cover that specific gap at this destination (a system you're confident actually exists there), and always phrase it as something to verify, never as a confirmed schedule. If you ever suggest a movie/cinema activity, do not invent a specific showtime as if it's confirmed — note that showtimes should be checked directly with the venue, since this planner has no access to real showtime data.

Call the propose_itinerary tool with the full itinerary — do not respond with plain text.`
}

function validatePlan(planBody) {
  if (!planBody || !Array.isArray(planBody.days)) {
    throw new Error('Tool call missing "days" array')
  }
  return planBody
}

// The model has no reason to invent stable identifiers for events (and
// regenerating the same day would produce different ones if it did) — so
// eventIds are assigned here, server-side, once, at save time. This gives
// per-event features (checklists, and later comments/wait-time overrides)
// something durable to key off, without touching the generation prompt.
function assignEventIds(planBody) {
  for (const day of planBody.days) {
    for (const ev of day.events) {
      ev.eventId = nanoid(8)
    }
  }
  return planBody
}

// Grounds the model's hedged hours/parking guesses in real OpenStreetMap
// data where available. Lookups run sequentially (see shared/overpass.js —
// the public instance appears to throttle concurrent connections from the
// same client), and individual queries have been observed taking up to ~9s
// on the live instance, so this is capped at 5 locations (~50s worst case)
// to leave headroom in generateWorker's 180s budget alongside the Bedrock
// call itself. Best effort throughout — a slow/unavailable Overpass instance
// just means the model's own hedged note text (which already tells the user
// to verify locally) stands unchanged, not a failed generation.
const MAX_LOCATION_LOOKUPS = 5

function collectLocatedEvents(planBody) {
  const located = []
  for (const day of planBody.days) {
    for (const ev of day.events) {
      if ((ev.icon === 'food' || ev.icon === 'activity') && ev.lat != null && ev.lng != null) {
        located.push(ev)
        if (located.length >= MAX_LOCATION_LOOKUPS) return located
      }
    }
  }
  return located
}

async function enrichWithLocationContext(planBody, hasDriver) {
  try {
    const located = collectLocatedEvents(planBody)
    if (!located.length) return
    const contexts = await findLocationContexts(located.map((ev) => ({ lat: ev.lat, lng: ev.lng })))
    located.forEach((ev, i) => {
      const ctx = contexts[i]
      if (ctx.openingHours) {
        ev.openingHours = `${ctx.openingHours.hours} — OpenStreetMap listing for "${ctx.openingHours.name}" nearby, verify it's the right venue`
      }
      if (hasDriver && ctx.parking) {
        ev.nearbyParking = ctx.parking.name
      }
    })
  } catch (e) {
    console.warn('Location-context enrichment failed, continuing without it', e.message)
  }
}

// Real driving routes + straight-line walking estimates between consecutive
// located stops (shared/osrm.js) — the model is told in the prompt not to
// bother estimating these itself. Capped at 6 legs; unlike the Overpass
// phase above, OSRM's public instance was verified to handle a handful of
// concurrent requests fine, so this runs with limited parallelism rather
// than strictly sequentially.
const MAX_TRAVEL_LEGS = 6
const TRAVEL_LEG_CONCURRENCY = 3

function collectTravelLegs(planBody) {
  const legs = []
  for (const day of planBody.days) {
    const located = day.events.filter((ev) => ev.lat != null && ev.lng != null)
    for (let i = 1; i < located.length; i++) {
      legs.push({ from: located[i - 1], to: located[i] })
      if (legs.length >= MAX_TRAVEL_LEGS) return legs
    }
  }
  return legs
}

async function enrichWithTravelLegs(planBody) {
  try {
    const legs = collectTravelLegs(planBody)
    if (!legs.length) return
    let next = 0
    async function worker() {
      while (next < legs.length) {
        const leg = legs[next++]
        const options = await getLegOptions(leg.from.lat, leg.from.lng, leg.to.lat, leg.to.lng)
        leg.to.travelFromPrevious = options
      }
    }
    await Promise.all(Array.from({ length: Math.min(TRAVEL_LEG_CONCURRENCY, legs.length) }, worker))
  } catch (e) {
    console.warn('Travel-leg enrichment failed, continuing without it', e.message)
  }
}

// Best-effort — records the failure onto the Trip META item so the frontend
// can surface it via polling, since nothing is listening on an HTTP response
// for this handler (it's invoked async by generate.js, not through API Gateway).
async function recordError(tripId, message) {
  try {
    await db.updateIf(`TRIP#${tripId}`, 'META', {
      UpdateExpression: 'SET lastGenerationError = :e',
      ExpressionAttributeValues: { ':e': { message, at: new Date().toISOString() } },
    })
  } catch (e) {
    console.error('Failed to record generation error', tripId, e.message)
  }
}

exports.handler = async (event) => {
  const { tripId, userId } = event

  try {
    const { trip, members, logistics, bookings, plans, suggestions } = await getTripAggregate(tripId)
    if (!trip) {
      await recordError(tripId, 'Trip not found')
      return
    }

    const weather = await getWeather(trip.destination)
    const latestPlan = plans.length ? plans.reduce((a, b) => (b.version > a.version ? b : a)) : null
    const prompt = buildPrompt({ trip, members, logistics, bookings, weather, suggestions, latestPlan })

    let planBody
    try {
      // 3000 was too low for a real multi-day itinerary once event notes grew
      // detailed — Bedrock would hit the cap mid-string. 8000 stays under
      // Sonnet's 8192 output ceiling with real headroom. Forcing the
      // response through ITINERARY_TOOL means a truncated response now
      // fails as an incomplete tool call rather than unparseable text.
      const toolInput = await invokeClaude({
        prompt,
        model: 'sonnet',
        maxTokens: 8000,
        tools: [ITINERARY_TOOL],
        toolChoice: { type: 'tool', name: 'propose_itinerary' },
      })
      planBody = assignEventIds(validatePlan(toolInput))
    } catch (e) {
      await recordError(tripId, `AI generation failed: ${e.message}`)
      return
    }

    await enrichWithLocationContext(planBody, logistics.some((l) => l.transportMode === 'driving'))
    await enrichWithTravelLegs(planBody)

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

    logUsageEvent('plan_generated', { tripId, version, isRevision: !!latestPlan })

    // A fresh version resets what "approved" means for everyone but whoever
    // just triggered this — they're already looking at the result. Best-effort:
    // the plan itself is already saved above, so a notification failure here
    // shouldn't surface as a generation failure.
    try {
      await notifyMembers({
        tripId,
        tripName: trip.name,
        recipients: members.filter((m) => m.userId !== userId).map((m) => m.userId),
        type: 'plan_generated',
        actorId: userId,
        actorDisplayName: members.find((m) => m.userId === userId)?.displayName || null,
      })
    } catch (e) {
      console.error('Failed to notify members of new plan', tripId, e.message)
    }

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
  } catch (e) {
    await recordError(tripId, e.message || 'Unexpected error during generation')
  }
}

// Exported alongside the handler for eval/run.js — lets the eval harness
// build the exact real prompt and call the exact real tool schema against
// fixture trip data, without needing a real DynamoDB-backed trip to do it.
exports.buildPrompt = buildPrompt
exports.ITINERARY_TOOL = ITINERARY_TOOL
