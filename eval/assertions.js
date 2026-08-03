// Structural checks against a real generated plan, targeting the specific
// prompt-regression bug classes this project has actually hit: generic
// "Traveler N" labels standing in for real names, and events scheduled
// before a hard arrival anchor. Each assertion returns { pass, message }
// rather than throwing, so eval/run.js can collect every failure in one
// pass instead of stopping at the first one.

// Mirrors functions/trips/today.js's time parser — event times are "H:MMa/p".
function timeToMinutes(time) {
  const match = /^(\d{1,2}):(\d{2})\s*([ap])/i.exec((time || '').trim())
  if (!match) return null
  let hour = parseInt(match[1], 10) % 12
  if (match[3].toLowerCase() === 'p') hour += 12
  return hour * 60 + parseInt(match[2], 10)
}

function assertValidSchema(plan) {
  if (!plan || !Array.isArray(plan.days)) {
    return { pass: false, message: 'plan.days is not an array' }
  }
  for (const day of plan.days) {
    if (!day.date || !Array.isArray(day.events)) {
      return { pass: false, message: `day missing "date" or "events" array: ${JSON.stringify(day).slice(0, 120)}` }
    }
    for (const ev of day.events) {
      if (!ev.time || !ev.title || !ev.icon) {
        return { pass: false, message: `event missing required field(s): ${JSON.stringify(ev).slice(0, 120)}` }
      }
    }
  }
  return { pass: true, message: 'schema OK' }
}

// The original bug: buildPrompt() used raw userId instead of displayName in
// two places, so the model normalized everyone into "Traveler 1/2/3".
function assertNoGenericLabels(plan) {
  const offenders = []
  for (const day of plan.days) {
    for (const ev of day.events) {
      const text = `${ev.title} ${ev.note || ''}`
      if (/traveler\s*\d/i.test(text)) offenders.push(`${day.date} "${ev.title}"`)
    }
  }
  return offenders.length
    ? { pass: false, message: `generic "Traveler N" label found in: ${offenders.join(', ')}` }
    : { pass: true, message: 'no generic labels' }
}

// Hard anchor: buildPrompt() explicitly instructs the model not to schedule
// *group* activities before the last arrival — it does not forbid an
// already-arrived member from having their own solo time while waiting
// (a real, live eval run caught this: "Renata: Coffee & explore..." before
// Diego's later arrival is correct, sensible planning, not a violation).
// So this only flags events that read as involving the whole group:
//   - "plane"/"car" events are the arrivals themselves, not activities.
//   - "hotel" is exempt — check-in/out is logistics one person can handle,
//     not a "let's all do this together" activity (the prompt's own FIXED
//     BOOKINGS section already treats hotel timing as its own anchor type).
//   - Any event whose title/note names a specific member is treated as an
//     individual attribution, not a group activity, and exempted.
function assertNoEventsBeforeArrival(plan, lastArrivalDatetime, memberNames = []) {
  if (!lastArrivalDatetime) return { pass: true, message: 'no arrival anchor to check' }
  const arrival = new Date(lastArrivalDatetime)
  const arrivalDate = lastArrivalDatetime.slice(0, 10)
  const arrivalMinutes = arrival.getHours() * 60 + arrival.getMinutes()
  const nameRe = memberNames.length ? new RegExp(memberNames.map((n) => n.split(' ')[0]).join('|'), 'i') : null

  const violations = []
  for (const day of plan.days) {
    if (day.date !== arrivalDate) continue
    for (const ev of day.events) {
      if (ev.icon === 'plane' || ev.icon === 'car' || ev.icon === 'hotel') continue
      if (nameRe && nameRe.test(`${ev.title} ${ev.note || ''}`)) continue
      const mins = timeToMinutes(ev.time)
      if (mins != null && mins < arrivalMinutes) {
        violations.push(`${ev.time} "${ev.title}" (before ${lastArrivalDatetime})`)
      }
    }
  }
  return violations.length
    ? { pass: false, message: `group event(s) scheduled before last arrival: ${violations.join(', ')}` }
    : { pass: true, message: 'no group events before last arrival' }
}

module.exports = { assertValidSchema, assertNoGenericLabels, assertNoEventsBeforeArrival, timeToMinutes }
