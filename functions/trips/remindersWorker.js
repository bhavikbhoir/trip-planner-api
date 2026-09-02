const db = require('../../shared/db')
const { sendEmail } = require('../../shared/ses')
const { getUserEmail } = require('../../shared/cognitoEmail')
const { createUnsubscribeToken } = require('../../shared/unsubscribeToken')
const { tripReminderEmail } = require('../../shared/emailTemplates')
const { logUsageEvent } = require('../../shared/usageLog')

const APP_BASE_URL = process.env.APP_BASE_URL
const API_BASE_URL = process.env.API_BASE_URL
const MAILING_ADDRESS = process.env.SES_MAILING_ADDRESS

// Send the reminder once a trip is within this many days of starting — not
// "exactly N days before," since a single missed/failed daily run would
// then skip the trip entirely. The window plus the existence-based
// REMINDER# marker below together guarantee "at most once, sent sometime
// in the window," which is what actually matters here.
const REMINDER_WINDOW_DAYS = 3

function daysUntil(dateIso, todayIso) {
  return Math.round((new Date(`${dateIso}T00:00:00Z`) - new Date(`${todayIso}T00:00:00Z`)) / 86400000)
}

// EventBridge-scheduled (no httpApi event — see serverless.yml) — runs once
// a day, no caller, no auth to check.
exports.handler = async () => {
  if (!APP_BASE_URL || !API_BASE_URL) {
    console.log(JSON.stringify({ remindersSkipped: true, reason: 'APP_BASE_URL/API_BASE_URL not configured' }))
    return
  }

  const today = new Date().toISOString().slice(0, 10)
  const trips = await db.scan({ FilterExpression: 'sk = :meta', ExpressionAttributeValues: { ':meta': 'META' } })

  const due = trips.filter((t) => {
    if (t.completedAt || !t.startDate) return false
    const d = daysUntil(t.startDate, today)
    return d >= 0 && d <= REMINDER_WINDOW_DAYS
  })

  let sentCount = 0
  for (const trip of due) {
    const already = await db.get(`TRIP#${trip.tripId}`, 'REMINDER#trip_starting')
    if (already) continue

    const members = await db.query({
      KeyConditionExpression: 'pk = :p AND begins_with(sk, :m)',
      ExpressionAttributeValues: { ':p': `TRIP#${trip.tripId}`, ':m': 'MEMBER#' },
    })

    const tripUrl = `${APP_BASE_URL.replace(/\/$/, '')}/trip/${trip.tripId}/itinerary`
    await Promise.all(
      members.map(async (member) => {
        const profile = await db.get(`USER#${member.userId}`, 'PROFILE')
        if (!profile?.emailPrefs?.tripReminders) return
        const email = await getUserEmail(member.userId)
        if (!email) return
        const unsubscribeUrl = `${API_BASE_URL.replace(/\/$/, '')}/unsubscribe?token=${createUnsubscribeToken(member.userId, 'tripReminders')}`
        const { subject, html, text } = tripReminderEmail({
          tripName: trip.name,
          startDate: trip.startDate,
          daysUntil: daysUntil(trip.startDate, today),
          tripUrl,
          unsubscribeUrl,
          mailingAddress: MAILING_ADDRESS,
        })
        await sendEmail({ to: email, subject, html, text })
      })
    )

    await db.put({
      pk: `TRIP#${trip.tripId}`,
      sk: 'REMINDER#trip_starting',
      tripId: trip.tripId,
      sentAt: new Date().toISOString(),
    })
    sentCount++
  }

  logUsageEvent('trip_reminders_sent', { tripsChecked: trips.length, tripsDue: due.length, tripsSent: sentCount })
}
