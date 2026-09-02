const { nanoid } = require('nanoid')
const db = require('./db')
const { sendEmail } = require('./ses')
const { getUserEmail } = require('./cognitoEmail')
const { createUnsubscribeToken } = require('./unsubscribeToken')
const { ACTIVITY_TEMPLATES } = require('./emailTemplates')

const APP_BASE_URL = process.env.APP_BASE_URL
const API_BASE_URL = process.env.API_BASE_URL
const MAILING_ADDRESS = process.env.SES_MAILING_ADDRESS

// Fans out one NOTIFICATION# item per recipient onto GSI2 (USER#<id> ->
// NOTIFICATION#<createdAt>#<id>), which functions/notifications/list.js
// queries. `recipients` should already exclude whoever triggered the event —
// callers don't get notified about their own action.
async function notifyMembers({ tripId, tripName, recipients, type, actorId, actorDisplayName }) {
  const now = new Date().toISOString()
  await Promise.all(
    recipients.map((recipientId) => {
      const notifId = nanoid(10)
      return db.put({
        pk: `TRIP#${tripId}`,
        sk: `NOTIFICATION#${notifId}`,
        GSI2pk: `USER#${recipientId}`,
        GSI2sk: `NOTIFICATION#${now}#${notifId}`,
        tripId,
        tripName,
        type,
        actorId,
        actorDisplayName,
        createdAt: now,
        read: false,
      })
    })
  )

  // Email is a best-effort side-effect of the same event, run after the
  // in-app notification write above (the part that actually matters) has
  // already succeeded — a lookup or send failure here never propagates.
  await Promise.all(recipients.map((recipientId) => maybeEmailActivity({ recipientId, tripId, tripName, type, actorDisplayName })))
}

async function maybeEmailActivity({ recipientId, tripId, tripName, type, actorDisplayName }) {
  const template = ACTIVITY_TEMPLATES[type]
  if (!template || !APP_BASE_URL || !API_BASE_URL) return
  try {
    const profile = await db.get(`USER#${recipientId}`, 'PROFILE')
    if (!profile?.emailPrefs?.activityNotifications) return
    const email = await getUserEmail(recipientId)
    if (!email) return
    const tripUrl = `${APP_BASE_URL.replace(/\/$/, '')}/trip/${tripId}/itinerary`
    const unsubscribeUrl = `${API_BASE_URL.replace(/\/$/, '')}/unsubscribe?token=${createUnsubscribeToken(recipientId, 'activityNotifications')}`
    const { subject, html, text } = template({ actorDisplayName, tripName, tripUrl, unsubscribeUrl, mailingAddress: MAILING_ADDRESS })
    await sendEmail({ to: email, subject, html, text })
  } catch (e) {
    console.log(JSON.stringify({ activityEmailFailed: true, recipientId, tripId, type, error: e.message }))
  }
}

module.exports = { notifyMembers }
