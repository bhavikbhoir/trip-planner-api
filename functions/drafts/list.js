const db = require('../../shared/db')
const { extractUserId } = require('../../shared/auth')
const { ok, err } = require('../../shared/response')

exports.handler = async (event) => {
  let userId
  try {
    userId = await extractUserId(event)
  } catch (e) {
    return err(e.statusCode || 401, e.message || 'Unauthorized')
  }

  const items = await db.query({
    KeyConditionExpression: 'pk = :p AND begins_with(sk, :s)',
    ExpressionAttributeValues: { ':p': `USER#${userId}`, ':s': 'DRAFT#' },
  })

  // The list view only needs enough to label each draft, not the full
  // conversation — leave that for GET /drafts/:id when one is opened.
  const drafts = items
    .slice()
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
    .map(({ draftId, status, messages, createdAt, updatedAt }) => ({
      draftId,
      status,
      messageCount: messages.length,
      lastMessage: messages[messages.length - 1]?.content || null,
      createdAt,
      updatedAt,
    }))

  return ok(200, { drafts })
}
