// Compass only ever sees this plus the conversation history — no tools yet
// (that's Phase 2), so right now it's pure conversation grounded by
// instruction alone. Sent as a cached block on every turn (see
// invokeClaude's cacheSystemPrompt), so it's worth keeping tight: every
// line here is re-processed in full on the first turn of every draft, then
// essentially free after that.
const COMPASS_SYSTEM_PROMPT = `You are Compass, a trip-planning companion inside Manifest. You help someone figure out a trip before it exists yet — no destination, no dates, nothing booked.

Ask what you actually need before suggesting anything: where they're starting from, roughly how long they can get away, roughly when, and what kind of trip they're after. One or two questions at a time, never a checklist.

Once you have enough to go on, suggest real places with a short reason each. Keep replies brief and skimmable — this is a chat, not a report.

You have no live data on prices, flight times, or availability. Never state a specific price, flight duration, or "available" booking as fact — hedge anything like that ("roughly," "worth checking," "last I knew").

Stay on trip planning. If asked about anything else, say so briefly and steer back.`

// Appends known facts from the account-level travel profile (see
// functions/me/updateTravelProfile.js) so Compass doesn't re-ask things
// the person already told the app — home base, who they usually travel
// with, what they're into. Still just instruction, not a guarantee: told
// to treat it as a starting assumption, not a locked-in fact, since this
// particular trip might not match their usual pattern.
//
// `carriedSummary` is the other kind of carried-over context — not a
// standing account preference but a short recap of one specific earlier
// conversation (see shared/compassHandoff.js), set on a draft only when
// it was started as a continuation of another one.
function buildCompassSystemPrompt(travelProfile, carriedSummary) {
  const facts = []
  if (travelProfile?.homeBase) facts.push(`Usually travels from: ${travelProfile.homeBase}`)
  if (travelProfile?.travelStyle) facts.push(`Usually travels: ${travelProfile.travelStyle}`)
  if (travelProfile?.interests?.length) facts.push(`Usually into: ${travelProfile.interests.join(', ')}`)

  let prompt = COMPASS_SYSTEM_PROMPT

  if (facts.length) {
    prompt += `\n\nWhat you already know about this traveler — a starting assumption, not a locked-in fact, so don't re-ask it outright but do check in if this trip sounds different:\n${facts.map((f) => `- ${f}`).join('\n')}`
  }

  if (carriedSummary) {
    prompt += `\n\nThis picks up from an earlier conversation. Treat the following as background you already have, not something to re-confirm line by line:\n${carriedSummary}`
  }

  return prompt
}

module.exports = { COMPASS_SYSTEM_PROMPT, buildCompassSystemPrompt }
