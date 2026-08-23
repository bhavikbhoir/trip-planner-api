const db = require('../../shared/db')
const { extractUserId } = require('../../shared/auth')
const { ok, err } = require('../../shared/response')
const { logUsageEvent } = require('../../shared/usageLog')

const VALID_MOODS = ['loved_it', 'good', 'mixed', 'rough']

// Per-member, PUT-only (no separate create/delete) — mirrors approvals/me:
// re-submitting just overwrites your own prior feedback rather than needing
// an edit endpoint.
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
    body = event.body ? JSON.parse(event.body) : {}
  } catch {
    return err(400, 'Invalid JSON body')
  }

  const { mood, comment } = body
  if (!VALID_MOODS.includes(mood)) return err(400, `mood must be one of: ${VALID_MOODS.join(', ')}`)

  const item = {
    pk: `TRIP#${tripId}`,
    sk: `FEEDBACK#${userId}`,
    tripId,
    userId,
    mood,
    comment: typeof comment === 'string' ? comment.trim().slice(0, 1000) || undefined : undefined,
    submittedAt: new Date().toISOString(),
  }

  await db.put(item)
  logUsageEvent('trip_feedback_submitted', { tripId, mood })

  return ok(200, { feedback: item })
}
