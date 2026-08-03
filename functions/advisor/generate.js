const { nanoid } = require('nanoid')
const db = require('../../shared/db')
const { extractUserId } = require('../../shared/auth')
const { ok, err } = require('../../shared/response')
const { getTripAggregate } = require('../../shared/tripAggregate')
const { invokeClaude } = require('../../shared/bedrock')

// Separate from full itinerary generation on purpose: cheap, fast, Haiku
// calls the model was never actually wired up for anywhere in this codebase
// until now. Runs synchronously in the request/response cycle (unlike plan
// generation's async trigger+worker split) — Haiku on a short tip list
// comfortably finishes well inside API Gateway's 29s ceiling.
const CATEGORIES = ['hotel_area', 'arrival_gap', 'departure_timing', 'coverage_gap']

const TIPS_TOOL = {
  name: 'propose_tips',
  description: 'Propose a short list of contextual, trip-specific planning tips.',
  input_schema: {
    type: 'object',
    properties: {
      tips: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            category: { type: 'string', enum: CATEGORIES },
            text: { type: 'string', description: 'One or two sentences, specific to this trip — not generic travel advice.' },
          },
          required: ['category', 'text'],
        },
      },
    },
    required: ['tips'],
  },
}

function summarizePlan(plan) {
  if (!plan) return '(no itinerary generated yet)'
  return plan.days
    .map((d) => `${d.date}: ${d.events.map((e) => `${e.time} ${e.title}`).join('; ')}`)
    .join('\n')
}

function buildPrompt({ trip, members, logistics, bookings, latestPlan }) {
  const nameById = new Map(members.map((m) => [m.userId, m.displayName || 'A traveler']))
  const nameFor = (userId) => nameById.get(userId) || 'A traveler'

  const preferenceLines = members
    .map((m) => {
      const p = m.preferences || {}
      const parts = [p.activities?.length && `activities: ${p.activities.join(', ')}`, p.budgetPace?.length && `budget/pace: ${p.budgetPace.join(', ')}`]
        .filter(Boolean)
        .join('; ')
      return parts ? `- ${nameFor(m.userId)}: ${parts}` : null
    })
    .filter(Boolean)
    .join('\n')

  const logisticsLines = logistics
    .map((l) => {
      const parts = []
      if (l.arrival?.datetime) parts.push(`arrives ${l.arrival.datetime}`)
      if (l.departure?.datetime) parts.push(`departs ${l.departure.datetime}`)
      return parts.length ? `- ${nameFor(l.userId)}: ${parts.join('; ')}` : null
    })
    .filter(Boolean)
    .join('\n')

  const bookingLines = bookings.map((b) => `- ${b.type}: ${b.name}${b.location ? ` @ ${b.location}` : ''}`).join('\n')

  return `You are a trip-planning advisor. Review this trip's details and produce up to 4 short, genuinely useful tips. Skip a category entirely if there's nothing meaningful to say for it — do not pad the list to hit a count.

TRIP: ${trip.name} — ${trip.destination}, ${trip.startDate} to ${trip.endDate}

PREFERENCES:
${preferenceLines || '(none submitted)'}

ARRIVAL/DEPARTURE LOGISTICS:
${logisticsLines || '(none provided)'}

BOOKINGS:
${bookingLines || '(none)'}

CURRENT ITINERARY:
${summarizePlan(latestPlan)}

Categories, and when to use them:
- hotel_area: only if lodging is missing or clearly mismatched against where planned activities cluster.
- arrival_gap: only if members land at meaningfully different times — note what early arrivers could do, or flag if the itinerary starts before the last arrival.
- departure_timing: only if there's a real risk — the last planned activity runs close to a departure time.
- coverage_gap: only if the itinerary clearly neglects something multiple people asked for in preferences.

Each tip must reference this trip's actual data (a name, a time, a place) — a tip that could apply to any trip is not useful enough to include. Call propose_tips with the result, even if that means an empty or short list.`
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

  const { trip, members, logistics, bookings, plans, tips: existingTips } = await getTripAggregate(tripId)
  if (!trip) return err(404, 'Trip not found')

  const isMember = members.some((m) => m.userId === userId)
  if (!isMember) return err(403, 'Not a member of this trip')

  const latestPlan = plans.length ? plans.reduce((a, b) => (b.version > a.version ? b : a)) : null
  const prompt = buildPrompt({ trip, members, logistics, bookings, latestPlan })

  let proposed
  try {
    const toolInput = await invokeClaude({
      prompt,
      model: 'haiku',
      maxTokens: 1000,
      tools: [TIPS_TOOL],
      toolChoice: { type: 'tool', name: 'propose_tips' },
    })
    proposed = Array.isArray(toolInput?.tips) ? toolInput.tips : []
  } catch (e) {
    return err(502, `Advisor generation failed: ${e.message}`)
  }

  // Each call replaces the prior batch rather than accumulating — a stale
  // tip (e.g. "arrival gap" after logistics changed) shouldn't linger
  // alongside a fresh one making the same call moot.
  await Promise.all((existingTips || []).map((t) => db.del(t.pk, t.sk)))

  const newTips = proposed
    .filter((t) => CATEGORIES.includes(t.category) && t.text)
    .map((t) => {
      const tipId = nanoid(10)
      return {
        pk: `TRIP#${tripId}`,
        sk: `TIP#${tipId}`,
        tripId,
        tipId,
        category: t.category,
        text: t.text,
        createdAt: new Date().toISOString(),
      }
    })

  await Promise.all(newTips.map((t) => db.put(t)))

  return ok(200, { tips: newTips })
}
