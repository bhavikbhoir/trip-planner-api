const { test, describe } = require('node:test')
const assert = require('node:assert/strict')

process.env.UNSUBSCRIBE_SECRET = 'test-secret'
const { createUnsubscribeToken, verifyUnsubscribeToken } = require('./unsubscribeToken')

describe('unsubscribeToken', () => {
  test('round-trips a valid token', () => {
    const token = createUnsubscribeToken('user-123', 'tripReminders')
    const decoded = verifyUnsubscribeToken(token)
    assert.deepEqual(decoded, { userId: 'user-123', pref: 'tripReminders' })
  })

  test('rejects a tampered token', () => {
    const token = createUnsubscribeToken('user-123', 'tripReminders')
    const tampered = token.slice(0, -2) + 'xx'
    assert.equal(verifyUnsubscribeToken(tampered), null)
  })

  test('rejects garbage input', () => {
    assert.equal(verifyUnsubscribeToken('not-a-real-token'), null)
    assert.equal(verifyUnsubscribeToken(''), null)
    assert.equal(verifyUnsubscribeToken(undefined), null)
  })

  test('a token signed for one user does not verify for another', () => {
    const token = createUnsubscribeToken('user-123', 'tripReminders')
    const decoded = verifyUnsubscribeToken(token)
    assert.notEqual(decoded.userId, 'user-456')
  })
})
