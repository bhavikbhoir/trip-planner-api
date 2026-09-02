const db = require('../../shared/db')
const { verifyUnsubscribeToken } = require('../../shared/unsubscribeToken')

const VALID_KEYS = ['tripReminders', 'activityNotifications']
const PREF_LABEL = { tripReminders: 'trip reminder emails', activityNotifications: 'activity emails' }

function htmlResponse(statusCode, message) {
  const body = `<!doctype html><html><head><meta charset="utf-8" /><title>Manifest</title>
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>body{font-family:-apple-system,Helvetica,Arial,sans-serif;background:#0f1115;color:#f2f2f2;display:grid;place-items:center;min-height:100vh;margin:0;}
.card{max-width:420px;padding:32px;text-align:center;}
h1{font-size:1.1rem;}
p{color:#aaa;font-size:0.9rem;}</style></head>
<body><div class="card"><h1>${message}</h1><p>Manifest</p></div></body></html>`
  return { statusCode, headers: { 'Content-Type': 'text/html; charset=utf-8' }, body }
}

// Deliberately public — no cognitoJwt authorizer (see serverless.yml) and no
// login required. CAN-SPAM requires opt-out to work without an account, and
// this is the link every notification/reminder email actually points at.
exports.handler = async (event) => {
  const token = event.queryStringParameters?.token
  const decoded = token ? verifyUnsubscribeToken(token) : null
  if (!decoded || !VALID_KEYS.includes(decoded.pref)) {
    return htmlResponse(400, 'This unsubscribe link is invalid or has expired.')
  }

  const { userId, pref } = decoded
  const existing = await db.get(`USER#${userId}`, 'PROFILE')
  const emailPrefs = { ...(existing?.emailPrefs || {}), [pref]: false }
  await db.put({ ...existing, pk: `USER#${userId}`, sk: 'PROFILE', emailPrefs, updatedAt: new Date().toISOString() })

  return htmlResponse(200, `You're unsubscribed from ${PREF_LABEL[pref]}.`)
}
