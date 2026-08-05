const db = require('../../shared/db')
const { extractUserId } = require('../../shared/auth')
const { ok, err } = require('../../shared/response')

// Account-level preferences that don't belong on a per-trip MEMBER# item
// (displayName is trip-scoped and cached there; theme isn't tied to any
// trip at all) live on their own USER#<userId>/PROFILE item instead.
exports.handler = async (event) => {
  let userId
  try {
    userId = await extractUserId(event)
  } catch (e) {
    return err(e.statusCode || 401, e.message || 'Unauthorized')
  }

  const profile = await db.get(`USER#${userId}`, 'PROFILE')
  return ok(200, { theme: profile?.theme || null })
}
