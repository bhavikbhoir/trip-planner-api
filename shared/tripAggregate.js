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
  const suggestions = items.filter((i) => i.sk.startsWith('SUGGESTION#'))
  const approvals = items.filter((i) => i.sk.startsWith('APPROVAL#'))
  const eventCompletions = items.filter((i) => i.sk.startsWith('DONE#'))
  const eventSkips = items.filter((i) => i.sk.startsWith('SKIPPED#'))
  const eventSwaps = items.filter((i) => i.sk.startsWith('SWAPPED#'))
  const picks = items.filter((i) => i.sk.startsWith('PICK#'))
  const expenses = items.filter((i) => i.sk.startsWith('EXPENSE#'))
  const tips = items.filter((i) => i.sk.startsWith('TIP#'))
  const feedback = items.filter((i) => i.sk.startsWith('FEEDBACK#'))

  return {
    trip,
    members,
    logistics,
    bookings,
    plans,
    suggestions,
    approvals,
    eventCompletions,
    eventSkips,
    eventSwaps,
    picks,
    expenses,
    tips,
    feedback,
  }
}

module.exports = { getTripAggregate }
