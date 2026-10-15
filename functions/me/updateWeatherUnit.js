const db = require('../../shared/db')
const { extractUserId } = require('../../shared/auth')
const { ok, err } = require('../../shared/response')

const VALID = ['imperial', 'metric']

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

  if (!VALID.includes(body.weatherUnit)) return err(400, `weatherUnit must be one of: ${VALID.join(', ')}`)

  // Read-merge-write, not a blind put — PROFILE also carries theme/emailPrefs
  // (see updateTheme.js/updateEmailPrefs.js), and a full-item put here would
  // silently wipe those out the next time someone just changes units.
  const existing = await db.get(`USER#${userId}`, 'PROFILE')
  await db.put({
    ...existing,
    pk: `USER#${userId}`,
    sk: 'PROFILE',
    weatherUnit: body.weatherUnit,
    updatedAt: new Date().toISOString(),
  })

  return ok(200, { weatherUnit: body.weatherUnit })
}
