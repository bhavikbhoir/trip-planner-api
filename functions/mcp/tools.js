// MCP tool registry. Each entry wraps an existing handler — the `invoke`
// function only maps MCP tool arguments onto that handler's path/query/body
// shape via callHandler(); no business logic lives here.
//
// Batch 1 (read-only) — proves the OAuth + reuse plumbing end-to-end before
// any write tools are added. Batches 2/3 (collaboration writes, then
// AI/destructive) follow the same pattern, appended below.
const { callHandler } = require('./callHandler')

const TOOLS = [
  {
    name: 'list_my_trips',
    description: 'List all trips the caller is a member of.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    invoke: (args, authHeader) =>
      callHandler(require('../trips/list'), { headers: { Authorization: authHeader } }),
  },
  {
    name: 'get_trip',
    description:
      'Full trip details: members, logistics, bookings, itinerary plan, suggestions, approvals, event statuses, expenses, advisor tips, feedback.',
    inputSchema: {
      type: 'object',
      properties: { tripId: { type: 'string' } },
      required: ['tripId'],
    },
    invoke: (args, authHeader) =>
      callHandler(require('../trips/get'), {
        pathParameters: { tripId: args.tripId },
        headers: { Authorization: authHeader },
      }),
  },
  {
    name: 'get_today',
    description:
      "Today's itinerary for a trip: ordered events with done/skipped/swapped status, plus bookings active on that date. Defaults to today's date if not given.",
    inputSchema: {
      type: 'object',
      properties: {
        tripId: { type: 'string' },
        date: { type: 'string', description: 'YYYY-MM-DD, defaults to today' },
      },
      required: ['tripId'],
    },
    invoke: (args, authHeader) =>
      callHandler(require('../trips/today'), {
        pathParameters: { tripId: args.tripId },
        queryStringParameters: args.date ? { date: args.date } : null,
        headers: { Authorization: authHeader },
      }),
  },
  {
    name: 'list_notifications',
    description: "The caller's notification feed across all trips (most recent 50), with unread count.",
    inputSchema: { type: 'object', properties: {}, required: [] },
    invoke: (args, authHeader) =>
      callHandler(require('../notifications/list'), { headers: { Authorization: authHeader } }),
  },
  {
    name: 'get_weather',
    description: "Current weather conditions at a trip's destination.",
    inputSchema: {
      type: 'object',
      properties: { tripId: { type: 'string' } },
      required: ['tripId'],
    },
    invoke: (args, authHeader) =>
      callHandler(require('../weather/get'), {
        pathParameters: { tripId: args.tripId },
        headers: { Authorization: authHeader },
      }),
  },
]

const TOOLS_BY_NAME = Object.fromEntries(TOOLS.map((t) => [t.name, t]))

module.exports = { TOOLS, TOOLS_BY_NAME }
