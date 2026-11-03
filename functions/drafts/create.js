const { nanoid } = require('nanoid')
const db = require('../../shared/db')
const { extractUserId } = require('../../shared/auth')
const { ok, err } = require('../../shared/response')
const { logUsageEvent } = require('../../shared/usageLog')

// A draft is scoped to the person planning, not to a trip — there's no
// trip yet, that's the whole point. Keyed under their own partition so it
// never shows up for anyone else until it's finalized into a real trip.
exports.handler = async (event) => {
  let userId
  try {
    userId = await extractUserId(event)
  } catch (e) {
    return err(e.statusCode || 401, e.message || 'Unauthorized')
  }

  const draftId = nanoid(10)
  const now = new Date().toISOString()
  const draft = {
    pk: `USER#${userId}`,
    sk: `DRAFT#${draftId}`,
    draftId,
    ownerId: userId,
    messages: [],
    status: 'active',
    createdAt: now,
    updatedAt: now,
  }

  await db.put(draft)

  logUsageEvent('draft_created', { draftId })

  return ok(201, { draft })
}
