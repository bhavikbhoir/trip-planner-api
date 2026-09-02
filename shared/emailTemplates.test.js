const { test, describe } = require('node:test')
const assert = require('node:assert/strict')
const { memberJoinedEmail, suggestionAddedEmail, planGeneratedEmail, tripReminderEmail, ACTIVITY_TEMPLATES } = require('./emailTemplates')

const base = {
  actorDisplayName: 'Priya',
  tripName: 'Bali w/ Crew',
  tripUrl: 'https://example.com/trip/abc/itinerary',
  unsubscribeUrl: 'https://api.example.com/unsubscribe?token=xyz',
  mailingAddress: '123 Main St, Anytown, ST 00000',
}

describe('emailTemplates', () => {
  test('every template includes the mailing address and unsubscribe link (CAN-SPAM)', () => {
    for (const build of [memberJoinedEmail, suggestionAddedEmail, planGeneratedEmail]) {
      const { html, text } = build(base)
      assert.ok(html.includes(base.mailingAddress))
      assert.ok(html.includes(base.unsubscribeUrl))
      assert.ok(text.includes(base.mailingAddress))
      assert.ok(text.includes(base.unsubscribeUrl))
    }
  })

  test('memberJoinedEmail names the actor and trip', () => {
    const { subject, html } = memberJoinedEmail(base)
    assert.ok(subject.includes('Priya'))
    assert.ok(subject.includes('Bali w/ Crew'))
    assert.ok(html.includes(base.tripUrl))
  })

  test('memberJoinedEmail falls back gracefully with no actor name', () => {
    const { subject } = memberJoinedEmail({ ...base, actorDisplayName: null })
    assert.ok(subject.startsWith('Someone joined'))
  })

  test('suggestionAddedEmail and planGeneratedEmail produce distinct, non-empty subjects', () => {
    const s = suggestionAddedEmail(base)
    const p = planGeneratedEmail(base)
    assert.ok(s.subject.length > 0 && p.subject.length > 0)
    assert.notEqual(s.subject, p.subject)
  })

  test('tripReminderEmail phrases the countdown correctly', () => {
    assert.ok(tripReminderEmail({ ...base, startDate: '2026-11-14', daysUntil: 0 }).subject.includes('today'))
    assert.ok(tripReminderEmail({ ...base, startDate: '2026-11-14', daysUntil: 1 }).subject.includes('tomorrow'))
    assert.ok(tripReminderEmail({ ...base, startDate: '2026-11-14', daysUntil: 3 }).subject.includes('in 3 days'))
  })

  test('ACTIVITY_TEMPLATES maps every notifyMembers() type to a builder', () => {
    assert.deepEqual(Object.keys(ACTIVITY_TEMPLATES).sort(), ['member_joined', 'plan_generated', 'suggestion_added'])
  })
})
