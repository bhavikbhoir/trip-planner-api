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

  const draftId = event.pathParameters?.draftId
  if (!draftId) return err(400, 'draftId is required')

  const draft = await db.get(`USER#${userId}`, `DRAFT#${draftId}`)
  if (!draft) return err(404, 'Draft not found')

  return ok(200, { draft })
}
