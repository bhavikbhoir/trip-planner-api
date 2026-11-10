const db = require('../../shared/db')
const { extractUserId } = require('../../shared/auth')
const { ok, err } = require('../../shared/response')
const { invokeClaude } = require('../../shared/bedrock')
const { logUsageEvent } = require('../../shared/usageLog')
const { buildCompassSystemPrompt } = require('../../shared/compassPrompt')

// A cap on user turns, not total messages — keeps a single draft from
// running up an unbounded Bedrock bill, and doubles as a loop guardrail.
// Once hit, the fix is a new draft, not a bigger limit.
const MAX_USER_TURNS = 24

exports.handler = async (event) => {
  let userId
  try {
    userId = await extractUserId(event)
  } catch (e) {
    return err(e.statusCode || 401, e.message || 'Unauthorized')
  }

  const draftId = event.pathParameters?.draftId
  if (!draftId) return err(400, 'draftId is required')

  const draft = await db.get(`USER#${userId}`, `DRAFT#${draftId}`)
  if (!draft) return err(404, 'Draft not found')
  if (draft.status !== 'active') return err(409, 'This draft is no longer active')

  let body
  try {
    body = JSON.parse(event.body || '{}')
  } catch {
    return err(400, 'Invalid JSON body')
  }

  const content = (body.content || '').trim()
  if (!content) return err(400, 'content is required')

  const userTurns = draft.messages.filter((m) => m.role === 'user').length
  if (userTurns >= MAX_USER_TURNS) {
    return err(400, "This conversation's gotten long — start a new one to keep going.")
  }

  // Built in memory and only persisted once the model actually replies, so
  // a failed call leaves the stored draft exactly as it was — nothing
  // half-written. The caller's own message stays in their input box to
  // retry, it just never makes it into history on a failure.
  const candidateMessages = [
    ...draft.messages.map((m) => ({ role: m.role, content: m.content })),
    { role: 'user', content },
  ]

  // Best-effort — if this lookup fails for some reason, Compass just
  // doesn't personalize the prompt this turn rather than failing the
  // whole request over a non-essential read.
  let travelProfile = null
  try {
    const profile = await db.get(`USER#${userId}`, 'PROFILE')
    travelProfile = profile?.travelProfile || null
  } catch {
    travelProfile = null
  }

  let reply
  try {
    reply = await invokeClaude({
      messages: candidateMessages,
      system: buildCompassSystemPrompt(travelProfile, draft.carriedSummary),
      cacheSystemPrompt: true,
      model: 'haiku',
      maxTokens: 300,
    })
  } catch (e) {
    return err(502, e.message || "Compass couldn't reply just now — try again.")
  }

  const now = new Date().toISOString()
  draft.messages = [...draft.messages, { role: 'user', content, ts: now }, { role: 'assistant', content: reply, ts: now }]
  draft.updatedAt = now

  await db.put(draft)

  logUsageEvent('draft_message_sent', { draftId })

  return ok(200, { draft })
}
