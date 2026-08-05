const db = require('../../shared/db')
const { extractUserId } = require('../../shared/auth')
const { ok, err } = require('../../shared/response')

const VALID = ['light', 'dark']

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
    return err(400, 'Invalid JSON body')
  }

  if (!VALID.includes(body.theme)) return err(400, `theme must be one of: ${VALID.join(', ')}`)

  await db.put({ pk: `USER#${userId}`, sk: 'PROFILE', theme: body.theme, updatedAt: new Date().toISOString() })

  return ok(200, { theme: body.theme })
}
