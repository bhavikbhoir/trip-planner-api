const { nanoid } = require('nanoid')
const db = require('../../shared/db')
const { extractUserId } = require('../../shared/auth')
const { ok, err } = require('../../shared/response')
const { logUsageEvent } = require('../../shared/usageLog')
const { invokeClaude } = require('../../shared/bedrock')
const { buildHandoffPrompt } = require('../../shared/compassHandoff')

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

  let body
  try {
    body = JSON.parse(event.body || '{}')
  } catch {
    body = {}
  }

  // Optional: carry a short summary forward from another draft instead of
  // starting from nothing — used when a conversation's hit its turn cap
  // or someone just wants to branch off without re-explaining themselves.
  // Best-effort end to end: a missing/foreign source draft, or a failed
  // summarization call, just means a plain fresh draft, not a failed
  // request — carrying context over is a nice-to-have, not the point of
  // this endpoint.
  let carriedSummary = null
  let sourceDraftId = null
  if (body.sourceDraftId) {
    try {
      const source = await db.get(`USER#${userId}`, `DRAFT#${body.sourceDraftId}`)
      if (source?.messages?.length) {
        carriedSummary = await invokeClaude({
          prompt: buildHandoffPrompt(source.messages),
          model: 'haiku',
          maxTokens: 220,
        })
        sourceDraftId = body.sourceDraftId
      }
    } catch {
      carriedSummary = null
      sourceDraftId = null
    }
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
    carriedSummary,
    sourceDraftId,
    createdAt: now,
    updatedAt: now,
  }

  await db.put(draft)

  logUsageEvent('draft_created', { draftId, continued: !!sourceDraftId })

  return ok(201, { draft })
}
