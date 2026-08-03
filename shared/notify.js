const { nanoid } = require('nanoid')
const db = require('./db')

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
}

module.exports = { notifyMembers }
