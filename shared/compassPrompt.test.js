const { test, describe } = require('node:test')
const assert = require('node:assert/strict')
const { COMPASS_SYSTEM_PROMPT, buildCompassSystemPrompt } = require('./compassPrompt')

describe('buildCompassSystemPrompt', () => {
  test('returns the base prompt unchanged when there is no profile', () => {
    assert.equal(buildCompassSystemPrompt(null), COMPASS_SYSTEM_PROMPT)
    assert.equal(buildCompassSystemPrompt(undefined), COMPASS_SYSTEM_PROMPT)
  })

  test('returns the base prompt unchanged when the profile has nothing set', () => {
    assert.equal(buildCompassSystemPrompt({ homeBase: null, travelStyle: null, interests: [] }), COMPASS_SYSTEM_PROMPT)
  })

  test('appends only the facts that are actually set', () => {
    const result = buildCompassSystemPrompt({ homeBase: 'Chicago, IL', travelStyle: null, interests: [] })
    assert.ok(result.includes('Usually travels from: Chicago, IL'))
    assert.ok(!result.includes('Usually travels:'))
    assert.ok(!result.includes('Usually into:'))
  })

  test('appends every fact when the profile is fully filled out', () => {
    const result = buildCompassSystemPrompt({
      homeBase: 'Chicago, IL',
      travelStyle: 'family',
      interests: ['Beaches', 'Hiking & nature'],
    })
    assert.ok(result.includes('Usually travels from: Chicago, IL'))
    assert.ok(result.includes('Usually travels: family'))
    assert.ok(result.includes('Usually into: Beaches, Hiking & nature'))
    assert.ok(result.startsWith(COMPASS_SYSTEM_PROMPT))
  })

  test('appends a carried-over summary when the draft continues another conversation', () => {
    const result = buildCompassSystemPrompt(null, '- Looking at Portugal or Spain\n- 4 days in December')
    assert.ok(result.includes('This picks up from an earlier conversation'))
    assert.ok(result.includes('- Looking at Portugal or Spain'))
    assert.ok(result.startsWith(COMPASS_SYSTEM_PROMPT))
  })

  test('includes both profile facts and a carried-over summary when both are set', () => {
    const result = buildCompassSystemPrompt({ homeBase: 'Chicago, IL' }, '- Wants a beach trip')
    assert.ok(result.includes('Usually travels from: Chicago, IL'))
    assert.ok(result.includes('This picks up from an earlier conversation'))
    assert.ok(result.includes('- Wants a beach trip'))
  })

  test('leaves the prompt unchanged when carriedSummary is empty', () => {
    assert.equal(buildCompassSystemPrompt(null, null), COMPASS_SYSTEM_PROMPT)
    assert.equal(buildCompassSystemPrompt(null, ''), COMPASS_SYSTEM_PROMPT)
  })
})
