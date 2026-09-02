// Pure builders — no AWS calls, no env reads — so subject/body content is
// unit-testable without mocking SES. Every template shares one footer
// (mailing address + a one-click, no-login unsubscribe link) since both are
// CAN-SPAM requirements on every message, not just some of them.

const PREF_LABEL = { activityNotifications: 'activity emails', tripReminders: 'trip reminder emails' }

function wrap({ bodyHtml, bodyText, unsubscribeUrl, mailingAddress, prefLabel }) {
  const html = `<div style="font-family:-apple-system,Helvetica,Arial,sans-serif;max-width:480px;margin:0 auto;color:#1a1a1a;line-height:1.5;">
${bodyHtml}
<hr style="border:none;border-top:1px solid #e5e5e5;margin:24px 0;" />
<p style="font-size:12px;color:#888;">
Manifest — ${mailingAddress}<br />
<a href="${unsubscribeUrl}" style="color:#888;">Turn off ${prefLabel}</a>
</p>
</div>`
  const text = `${bodyText}\n\n---\nManifest — ${mailingAddress}\nTurn off ${prefLabel}: ${unsubscribeUrl}`
  return { html, text }
}

function memberJoinedEmail({ actorDisplayName, tripName, tripUrl, unsubscribeUrl, mailingAddress }) {
  const who = actorDisplayName || 'Someone'
  const subject = `${who} joined ${tripName}`
  const bodyHtml = `<p>${who} just joined <strong>${tripName}</strong> on Manifest.</p><p><a href="${tripUrl}">View the trip →</a></p>`
  const bodyText = `${who} just joined ${tripName} on Manifest.\n${tripUrl}`
  return { subject, ...wrap({ bodyHtml, bodyText, unsubscribeUrl, mailingAddress, prefLabel: PREF_LABEL.activityNotifications }) }
}

function suggestionAddedEmail({ actorDisplayName, tripName, tripUrl, unsubscribeUrl, mailingAddress }) {
  const who = actorDisplayName || 'Someone'
  const subject = `${who} suggested a change to ${tripName}`
  const bodyHtml = `<p>${who} suggested a change to the plan for <strong>${tripName}</strong>.</p><p><a href="${tripUrl}">See the suggestion →</a></p>`
  const bodyText = `${who} suggested a change to the plan for ${tripName}.\n${tripUrl}`
  return { subject, ...wrap({ bodyHtml, bodyText, unsubscribeUrl, mailingAddress, prefLabel: PREF_LABEL.activityNotifications }) }
}

function planGeneratedEmail({ tripName, tripUrl, unsubscribeUrl, mailingAddress }) {
  const subject = `A new itinerary is ready for ${tripName}`
  const bodyHtml = `<p>A new AI-generated itinerary is ready for <strong>${tripName}</strong>.</p><p><a href="${tripUrl}">Check it out →</a></p>`
  const bodyText = `A new AI-generated itinerary is ready for ${tripName}.\n${tripUrl}`
  return { subject, ...wrap({ bodyHtml, bodyText, unsubscribeUrl, mailingAddress, prefLabel: PREF_LABEL.activityNotifications }) }
}

function tripReminderEmail({ tripName, startDate, daysUntil, tripUrl, unsubscribeUrl, mailingAddress }) {
  const when = daysUntil <= 0 ? 'today' : daysUntil === 1 ? 'tomorrow' : `in ${daysUntil} days`
  const subject = `${tripName} starts ${when}`
  const bodyHtml = `<p><strong>${tripName}</strong> starts ${when} (${startDate}). Check your checklist and make sure everyone's logistics are set.</p><p><a href="${tripUrl}">Open the trip →</a></p>`
  const bodyText = `${tripName} starts ${when} (${startDate}). Check your checklist and logistics.\n${tripUrl}`
  return { subject, ...wrap({ bodyHtml, bodyText, unsubscribeUrl, mailingAddress, prefLabel: PREF_LABEL.tripReminders }) }
}

const ACTIVITY_TEMPLATES = {
  member_joined: memberJoinedEmail,
  suggestion_added: suggestionAddedEmail,
  plan_generated: planGeneratedEmail,
}

module.exports = { memberJoinedEmail, suggestionAddedEmail, planGeneratedEmail, tripReminderEmail, ACTIVITY_TEMPLATES }
