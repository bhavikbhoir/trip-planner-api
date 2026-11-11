const { test, describe } = require('node:test')
const assert = require('node:assert/strict')
const { buildHandoffPrompt } = require('./compassHandoff')

describe('buildHandoffPrompt', () => {
  test('labels each turn by who said it', () => {
    const result = buildHandoffPrompt([
      { role: 'user', content: 'Thinking about Portugal in December' },
      { role: 'assistant', content: 'How long have you got?' },
    ])
    assert.ok(result.includes('Traveler: Thinking about Portugal in December'))
    assert.ok(result.includes('Compass: How long have you got?'))
  })

  test('keeps turns in their original order', () => {
    const result = buildHandoffPrompt([
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'second' },
      { role: 'user', content: 'third' },
    ])
    const firstIdx = result.indexOf('first')
    const secondIdx = result.indexOf('second')
    const thirdIdx = result.indexOf('third')
    assert.ok(firstIdx < secondIdx && secondIdx < thirdIdx)
  })

  test('asks for a short bullet summary, not a full recap', () => {
    const result = buildHandoffPrompt([{ role: 'user', content: 'hi' }])
    assert.ok(result.includes('3-5 short bullet points'))
  })
})
