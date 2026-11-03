const db = require('../../shared/db')
const { extractUserId } = require('../../shared/auth')
const { ok, err } = require('../../shared/response')

const TRAVEL_STYLES = ['solo', 'couple', 'family', 'friends']
const INTERESTS = ['Hiking & nature', 'Museums & culture', 'Beaches', 'Nightlife', 'Shopping']

// Lets Compass (and eventually the trip Preferences wizard) skip asking
// what it can already know about someone — where they're usually
// traveling from, who they usually travel with, what they're into. All
// fields are optional and independently nullable; a partial update only
// touches the keys actually sent, so clearing one doesn't wipe the others.
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

  if (body.travelStyle != null && !TRAVEL_STYLES.includes(body.travelStyle)) {
    return err(400, `travelStyle must be one of: ${TRAVEL_STYLES.join(', ')}`)
  }
  if (body.interests != null) {
    if (!Array.isArray(body.interests) || body.interests.some((i) => !INTERESTS.includes(i))) {
      return err(400, `interests must be an array drawn from: ${INTERESTS.join(', ')}`)
    }
  }
  if (body.homeBase != null && typeof body.homeBase !== 'string') {
    return err(400, 'homeBase must be a string')
  }

  const existing = await db.get(`USER#${userId}`, 'PROFILE')
  const travelProfile = { ...existing?.travelProfile }
  if (body.homeBase !== undefined) travelProfile.homeBase = body.homeBase || null
  if (body.travelStyle !== undefined) travelProfile.travelStyle = body.travelStyle || null
  if (body.interests !== undefined) travelProfile.interests = body.interests

  await db.put({
    ...existing,
    pk: `USER#${userId}`,
    sk: 'PROFILE',
    travelProfile,
    updatedAt: new Date().toISOString(),
  })

  return ok(200, { travelProfile })
}
