// Representative trip aggregates for the eval harness (eval/run.js) — shaped
// exactly like what getTripAggregate() + generateWorker.js's handler would
// assemble, so buildPrompt() can be called on these directly without a real
// DynamoDB-backed trip. Each fixture targets a different real bug class this
// project has actually hit: generic labels instead of real names, hard
// anchors (arrivals) being violated, and the "no preferences yet" fallback
// path silently breaking.

const smallGroup = {
  trip: {
    name: 'Long Weekend in Lisbon',
    destination: 'Lisbon, Portugal',
    startDate: '2026-09-11',
    endDate: '2026-09-14',
    tripType: 'friends',
  },
  members: [
    {
      userId: 'u1',
      displayName: 'Renata',
      role: 'owner',
      preferences: { activities: ['Museums & culture', 'Cafes & coffee'], budgetPace: ['Mid-range', 'Relaxed pace'] },
      companions: [],
    },
    {
      userId: 'u2',
      displayName: 'Diego',
      role: 'member',
      preferences: { food: ['Local street food'], activities: ['Nightlife'], budgetPace: ['Splurge'] },
      companions: [],
    },
  ],
  logistics: [
    { userId: 'u1', arrival: { datetime: '2026-09-11T10:00:00', flight: 'TP 123' }, departure: { datetime: '2026-09-14T18:00:00', flight: 'TP 456' } },
    { userId: 'u2', arrival: { datetime: '2026-09-11T15:30:00', flight: 'LH 789' }, departure: { datetime: '2026-09-14T18:00:00', flight: 'TP 456' } },
  ],
  bookings: [],
  weather: { city: 'Lisbon', temperature: 75, condition: 'clear sky' },
  suggestions: [],
  latestPlan: null,
}

const largeGroupWithKids = {
  trip: {
    name: 'Family Reunion — Orlando',
    destination: 'Orlando, Florida',
    startDate: '2026-12-20',
    endDate: '2026-12-24',
    tripType: 'family',
  },
  members: [
    { userId: 'u1', displayName: 'Marcus', role: 'owner', preferences: { activities: ['Theme parks'], budgetPace: ['Mid-range'] }, companions: [{ name: 'Ava', age: 6 }] },
    { userId: 'u2', displayName: 'Priya', role: 'member', preferences: { food: ['Vegetarian-friendly'], groupDynamics: ['Traveling with kids'] }, companions: [{ name: 'Kabir', age: 3 }] },
    { userId: 'u3', displayName: 'Grandma Linda', role: 'member', preferences: { budgetPace: ['Relaxed pace'], groupDynamics: ['Limited mobility'] }, companions: [] },
    { userId: 'u4', displayName: 'Tomas', role: 'member', preferences: {}, companions: [] },
  ],
  logistics: [
    { userId: 'u1', arrival: { datetime: '2026-12-20T09:00:00', flight: 'AA 100' }, departure: { datetime: '2026-12-24T20:00:00', flight: 'AA 101' } },
    { userId: 'u2', arrival: { datetime: '2026-12-20T09:00:00', flight: 'AA 100' }, departure: { datetime: '2026-12-24T20:00:00', flight: 'AA 101' } },
    { userId: 'u3', arrival: { datetime: '2026-12-20T14:45:00', flight: 'DL 200' }, departure: { datetime: '2026-12-24T20:00:00', flight: 'AA 101' } },
    { userId: 'u4', arrival: { datetime: '2026-12-21T08:00:00', flight: 'UA 300' }, transportMode: 'driving', departure: { datetime: '2026-12-24T11:00:00' } },
  ],
  bookings: [{ type: 'hotel', name: 'Lakeview Family Resort', location: 'Orlando, FL', startDatetime: '2026-12-20T16:00:00', endDatetime: '2026-12-24T11:00:00' }],
  weather: { city: 'Orlando', temperature: 72, condition: 'sunny' },
  suggestions: [{ text: 'Grandma Linda needs shorter walking distances between attractions', status: 'open' }],
  latestPlan: null,
}

const noPreferencesYet = {
  trip: {
    name: 'Quick Business Trip — Chicago',
    destination: 'Chicago, Illinois',
    startDate: '2026-10-05',
    endDate: '2026-10-07',
    tripType: 'business',
  },
  members: [
    { userId: 'u1', displayName: 'Sana', role: 'owner', preferences: null, companions: [] },
    { userId: 'u2', displayName: 'Wei', role: 'member', preferences: null, companions: [] },
  ],
  logistics: [{ userId: 'u1', arrival: { datetime: '2026-10-05T13:00:00', flight: 'UA 55' }, departure: { datetime: '2026-10-07T17:00:00', flight: 'UA 56' } }],
  bookings: [],
  weather: null,
  suggestions: [],
  latestPlan: null,
}

module.exports = { fixtures: { smallGroup, largeGroupWithKids, noPreferencesYet } }
