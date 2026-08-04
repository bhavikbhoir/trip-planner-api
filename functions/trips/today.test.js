const { test, describe } = require('node:test')
const assert = require('node:assert/strict')
const { bookingCoversDate, timeToMinutes } = require('./today')

describe('timeToMinutes', () => {
  test('sorts "9:40a" before "10:00a" chronologically, not lexically', () => {
    assert.ok(timeToMinutes('9:40a') < timeToMinutes('10:00a'))
  })

  test('parses PM times with the 12-hour offset', () => {
    assert.equal(timeToMinutes('6:00p'), 18 * 60)
  })

  test('sorts unparseable times last, not first', () => {
    assert.equal(timeToMinutes('garbage'), Number.MAX_SAFE_INTEGER)
  })
})

describe('bookingCoversDate', () => {
  test('covers a date strictly between start and end', () => {
    const booking = { startDatetime: '2026-11-14T15:00:00', endDatetime: '2026-11-21T11:00:00' }
    assert.equal(bookingCoversDate(booking, '2026-11-17'), true)
  })

  test('covers the exact start and end dates (inclusive)', () => {
    const booking = { startDatetime: '2026-11-14T15:00:00', endDatetime: '2026-11-21T11:00:00' }
    assert.equal(bookingCoversDate(booking, '2026-11-14'), true)
    assert.equal(bookingCoversDate(booking, '2026-11-21'), true)
  })

  test('excludes a date outside the booking window', () => {
    const booking = { startDatetime: '2026-11-14T15:00:00', endDatetime: '2026-11-21T11:00:00' }
    assert.equal(bookingCoversDate(booking, '2026-11-22'), false)
  })

  test('treats a missing endDatetime as a single-day booking', () => {
    const booking = { startDatetime: '2026-08-21T09:00:00' }
    assert.equal(bookingCoversDate(booking, '2026-08-21'), true)
    assert.equal(bookingCoversDate(booking, '2026-08-22'), false)
  })

  test('returns false when startDatetime is missing entirely', () => {
    assert.equal(bookingCoversDate({}, '2026-08-21'), false)
  })
})
