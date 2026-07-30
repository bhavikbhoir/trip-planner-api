const db = require('./db')

async function getTripAggregate(tripId) {
  const items = await db.query({
    KeyConditionExpression: 'pk = :p',
    ExpressionAttributeValues: { ':p': `TRIP#${tripId}` },
  })

  const trip = items.find((i) => i.sk === 'META')
  const members = items.filter((i) => i.sk.startsWith('MEMBER#'))
  const logistics = items.filter((i) => i.sk.startsWith('LOGISTICS#'))
  const bookings = items.filter((i) => i.sk.startsWith('BOOKING#'))
  const plans = items
    .filter((i) => i.sk.startsWith('PLAN#'))
    .sort((a, b) => a.version - b.version)

  return { trip, members, logistics, bookings, plans }
}

module.exports = { getTripAggregate }
