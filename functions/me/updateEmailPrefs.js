const db = require('../../shared/db')
const { extractUserId } = require('../../shared/auth')
const { ok, err } = require('../../shared/response')

const VALID_KEYS = ['tripReminders', 'activityNotifications']

// Both prefs default false (see functions/me/get.js) — opt-in, not opt-out.
// Partial body: only the keys present are changed, everything else
// (including the other pref and theme) is preserved via read-merge-write.
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

  const updates = {}
  for (const key of VALID_KEYS) {
    if (key in body) {
      if (typeof body[key] !== 'boolean') return err(400, `${key} must be a boolean`)
      updates[key] = body[key]
    }
  }
  if (Object.keys(updates).length === 0) {
    return err(400, `Provide at least one of: ${VALID_KEYS.join(', ')}`)
  }

  const existing = await db.get(`USER#${userId}`, 'PROFILE')
  const emailPrefs = { ...(existing?.emailPrefs || {}), ...updates }
  await db.put({ ...existing, pk: `USER#${userId}`, sk: 'PROFILE', emailPrefs, updatedAt: new Date().toISOString() })

  return ok(200, { emailPrefs: { tripReminders: emailPrefs.tripReminders || false, activityNotifications: emailPrefs.activityNotifications || false } })
}
