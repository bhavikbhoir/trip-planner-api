const { test, describe } = require('node:test')
const assert = require('node:assert/strict')
const { timeToMinutes, assertValidSchema, assertNoGenericLabels, assertNoEventsBeforeArrival } = require('./assertions')

describe('timeToMinutes', () => {
  test('parses AM/PM event times to minutes since midnight', () => {
    assert.equal(timeToMinutes('9:40a'), 9 * 60 + 40)
    assert.equal(timeToMinutes('12:00p'), 12 * 60)
    assert.equal(timeToMinutes('12:00a'), 0)
    assert.equal(timeToMinutes('6:00p'), 18 * 60)
  })

  test('returns null for unparseable input', () => {
    assert.equal(timeToMinutes('not a time'), null)
    assert.equal(timeToMinutes(''), null)
    assert.equal(timeToMinutes(undefined), null)
  })
})

describe('assertValidSchema', () => {
  test('passes a well-formed plan', () => {
    const plan = { days: [{ date: '2026-11-14', events: [{ time: '9:00a', title: 'Breakfast', icon: 'food' }] }] }
    assert.equal(assertValidSchema(plan).pass, true)
  })

  test('fails when plan.days is missing', () => {
    assert.equal(assertValidSchema({}).pass, false)
  })

  test('fails when an event is missing a required field', () => {
    const plan = { days: [{ date: '2026-11-14', events: [{ time: '9:00a', title: 'Breakfast' }] }] }
    assert.equal(assertValidSchema(plan).pass, false)
  })
})

describe('assertNoGenericLabels', () => {
  test('passes when events use real names', () => {
    const plan = { days: [{ date: '2026-11-14', events: [{ title: 'Sam arrives', note: '' }] }] }
    assert.equal(assertNoGenericLabels(plan).pass, true)
  })

  test('flags a generic "Traveler N" label', () => {
    const plan = { days: [{ date: '2026-11-14', events: [{ title: 'Traveler 2 arrives', note: '' }] }] }
    assert.equal(assertNoGenericLabels(plan).pass, false)
  })
})

describe('assertNoEventsBeforeArrival', () => {
  const arrival = '2026-11-14T13:15:00'

  test('passes with no arrival anchor to check against', () => {
    assert.equal(assertNoEventsBeforeArrival({ days: [] }, null).pass, true)
  })

  test('flags a nameless group activity scheduled before the last arrival', () => {
    const plan = { days: [{ date: '2026-11-14', events: [{ time: '9:00a', title: 'Group breakfast', icon: 'food' }] }] }
    const result = assertNoEventsBeforeArrival(plan, arrival, ['Sam', 'Priya'])
    assert.equal(result.pass, false)
  })

  test('exempts an early arriver\'s own solo activity, named by the model', () => {
    const plan = {
      days: [{ date: '2026-11-14', events: [{ time: '9:00a', title: 'Sam: coffee while waiting', icon: 'food' }] }],
    }
    const result = assertNoEventsBeforeArrival(plan, arrival, ['Sam', 'Priya'])
    assert.equal(result.pass, true)
  })

  test('exempts hotel check-in as logistics, not a group activity', () => {
    const plan = { days: [{ date: '2026-11-14', events: [{ time: '9:00a', title: 'Check in to hotel', icon: 'hotel' }] }] }
    const result = assertNoEventsBeforeArrival(plan, arrival, ['Sam', 'Priya'])
    assert.equal(result.pass, true)
  })

  test('exempts arrival events themselves (plane/car icons)', () => {
    const plan = { days: [{ date: '2026-11-14', events: [{ time: '9:00a', title: 'Priya arrives', icon: 'plane' }] }] }
    const result = assertNoEventsBeforeArrival(plan, arrival, ['Sam', 'Priya'])
    assert.equal(result.pass, true)
  })

  test('ignores events on a different day entirely', () => {
    const plan = { days: [{ date: '2026-11-15', events: [{ time: '9:00a', title: 'Group breakfast', icon: 'food' }] }] }
    const result = assertNoEventsBeforeArrival(plan, arrival, ['Sam', 'Priya'])
    assert.equal(result.pass, true)
  })
})
