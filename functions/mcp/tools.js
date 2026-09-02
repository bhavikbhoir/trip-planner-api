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

  // ── Batch 2 — collaboration writes ──────────────────────────────────

  {
    name: 'join_trip',
    description: 'Join a trip as a member. Safe to call again if already a member (returns alreadyMember: true).',
    inputSchema: {
      type: 'object',
      properties: { tripId: { type: 'string' }, displayName: { type: 'string' } },
      required: ['tripId'],
    },
    invoke: (args, authHeader) =>
      callHandler(require('../trips/join'), {
        pathParameters: { tripId: args.tripId },
        body: { displayName: args.displayName },
        headers: { Authorization: authHeader },
      }),
  },
  {
    name: 'set_my_logistics',
    description:
      "Set the caller's own arrival/departure/transport info for a trip. At least one of arrival, departure, or transportMode is required.",
    inputSchema: {
      type: 'object',
      properties: {
        tripId: { type: 'string' },
        arrival: { type: 'string', description: 'ISO datetime' },
        departure: { type: 'string', description: 'ISO datetime' },
        transportMode: { type: 'string', enum: ['driving', 'need_ride', 'not_driving'] },
        seatsAvailable: { type: 'number' },
      },
      required: ['tripId'],
    },
    invoke: (args, authHeader) =>
      callHandler(require('../logistics/upsert'), {
        pathParameters: { tripId: args.tripId },
        body: {
          arrival: args.arrival,
          departure: args.departure,
          transportMode: args.transportMode,
          seatsAvailable: args.seatsAvailable,
        },
        headers: { Authorization: authHeader },
      }),
  },
  {
    name: 'add_booking',
    description: 'Add a hotel, car, or other booking to a trip. Any member can add.',
    inputSchema: {
      type: 'object',
      properties: {
        tripId: { type: 'string' },
        type: { type: 'string', enum: ['hotel', 'car', 'other'] },
        name: { type: 'string' },
        location: { type: 'string' },
        startDatetime: { type: 'string', description: 'ISO datetime' },
        endDatetime: { type: 'string', description: 'ISO datetime' },
        confirmation: { type: 'string' },
        cost: { type: 'number' },
        referenceLink: { type: 'string', description: 'Must start with http:// or https://' },
      },
      required: ['tripId', 'type', 'name', 'startDatetime', 'endDatetime'],
    },
    invoke: (args, authHeader) =>
      callHandler(require('../bookings/create'), {
        pathParameters: { tripId: args.tripId },
        body: {
          type: args.type,
          name: args.name,
          location: args.location,
          startDatetime: args.startDatetime,
          endDatetime: args.endDatetime,
          confirmation: args.confirmation,
          cost: args.cost,
          referenceLink: args.referenceLink,
        },
        headers: { Authorization: authHeader },
      }),
  },
  {
    name: 'update_booking',
    description: 'Replace an existing booking (full replace, not partial — send every field). Any member can edit.',
    inputSchema: {
      type: 'object',
      properties: {
        tripId: { type: 'string' },
        bookingId: { type: 'string' },
        type: { type: 'string', enum: ['hotel', 'car', 'other'] },
        name: { type: 'string' },
        location: { type: 'string' },
        startDatetime: { type: 'string', description: 'ISO datetime' },
        endDatetime: { type: 'string', description: 'ISO datetime' },
        confirmation: { type: 'string' },
        cost: { type: 'number' },
        referenceLink: { type: 'string', description: 'Must start with http:// or https://' },
      },
      required: ['tripId', 'bookingId', 'type', 'name', 'startDatetime', 'endDatetime'],
    },
    invoke: (args, authHeader) =>
      callHandler(require('../bookings/update'), {
        pathParameters: { tripId: args.tripId, bookingId: args.bookingId },
        body: {
          type: args.type,
          name: args.name,
          location: args.location,
          startDatetime: args.startDatetime,
          endDatetime: args.endDatetime,
          confirmation: args.confirmation,
          cost: args.cost,
          referenceLink: args.referenceLink,
        },
        headers: { Authorization: authHeader },
      }),
  },
  {
    name: 'remove_booking',
    description: 'Delete a booking from a trip. Any member can delete.',
    inputSchema: {
      type: 'object',
      properties: { tripId: { type: 'string' }, bookingId: { type: 'string' } },
      required: ['tripId', 'bookingId'],
    },
    invoke: (args, authHeader) =>
      callHandler(require('../bookings/remove'), {
        pathParameters: { tripId: args.tripId, bookingId: args.bookingId },
        headers: { Authorization: authHeader },
      }),
  },
  {
    name: 'log_expense',
    description:
      'Log a shared expense. Defaults to splitting evenly across every current member unless splitBetween is given; defaults paidBy to the caller.',
    inputSchema: {
      type: 'object',
      properties: {
        tripId: { type: 'string' },
        description: { type: 'string' },
        amount: { type: 'number', description: 'Positive number' },
        paidBy: { type: 'string', description: 'Member userId who paid; defaults to the caller' },
        splitBetween: { type: 'array', items: { type: 'string' }, description: 'Member userIds; defaults to all members' },
      },
      required: ['tripId', 'description', 'amount'],
    },
    invoke: (args, authHeader) =>
      callHandler(require('../expenses/create'), {
        pathParameters: { tripId: args.tripId },
        body: { description: args.description, amount: args.amount, paidBy: args.paidBy, splitBetween: args.splitBetween },
        headers: { Authorization: authHeader },
      }),
  },
  {
    name: 'remove_expense',
    description: 'Delete a logged expense from a trip.',
    inputSchema: {
      type: 'object',
      properties: { tripId: { type: 'string' }, expenseId: { type: 'string' } },
      required: ['tripId', 'expenseId'],
    },
    invoke: (args, authHeader) =>
      callHandler(require('../expenses/remove'), {
        pathParameters: { tripId: args.tripId, expenseId: args.expenseId },
        headers: { Authorization: authHeader },
      }),
  },
  {
    name: 'add_suggestion',
    description: 'Suggest a change to the itinerary. Notifies other trip members.',
    inputSchema: {
      type: 'object',
      properties: {
        tripId: { type: 'string' },
        text: { type: 'string' },
        targetPlanVersion: { type: 'number' },
      },
      required: ['tripId', 'text'],
    },
    invoke: (args, authHeader) =>
      callHandler(require('../suggestions/create'), {
        pathParameters: { tripId: args.tripId },
        body: { text: args.text, targetPlanVersion: args.targetPlanVersion },
        headers: { Authorization: authHeader },
      }),
  },
  {
    name: 'remove_suggestion',
    description: 'Dismiss/delete a suggestion.',
    inputSchema: {
      type: 'object',
      properties: { tripId: { type: 'string' }, suggestionId: { type: 'string' } },
      required: ['tripId', 'suggestionId'],
    },
    invoke: (args, authHeader) =>
      callHandler(require('../suggestions/remove'), {
        pathParameters: { tripId: args.tripId, suggestionId: args.suggestionId },
        headers: { Authorization: authHeader },
      }),
  },
  {
    name: 'approve_plan',
    description: "Record the caller's approval of a specific itinerary plan version.",
    inputSchema: {
      type: 'object',
      properties: { tripId: { type: 'string' }, planVersion: { type: 'number' } },
      required: ['tripId', 'planVersion'],
    },
    invoke: (args, authHeader) =>
      callHandler(require('../approvals/upsert'), {
        pathParameters: { tripId: args.tripId },
        body: { planVersion: args.planVersion },
        headers: { Authorization: authHeader },
      }),
  },
  {
    name: 'mark_event_done',
    description: 'Mark an itinerary event as done. Mutually exclusive with skipped/swapped.',
    inputSchema: {
      type: 'object',
      properties: { tripId: { type: 'string' }, eventId: { type: 'string' } },
      required: ['tripId', 'eventId'],
    },
    invoke: (args, authHeader) =>
      callHandler(require('../events/markDone'), {
        pathParameters: { tripId: args.tripId, eventId: args.eventId },
        headers: { Authorization: authHeader },
      }),
  },
  {
    name: 'unmark_event_done',
    description: 'Undo a done marking on an itinerary event.',
    inputSchema: {
      type: 'object',
      properties: { tripId: { type: 'string' }, eventId: { type: 'string' } },
      required: ['tripId', 'eventId'],
    },
    invoke: (args, authHeader) =>
      callHandler(require('../events/unmarkDone'), {
        pathParameters: { tripId: args.tripId, eventId: args.eventId },
        headers: { Authorization: authHeader },
      }),
  },
  {
    name: 'skip_event',
    description: 'Mark an itinerary event as skipped, with an optional note. Mutually exclusive with done/swapped.',
    inputSchema: {
      type: 'object',
      properties: { tripId: { type: 'string' }, eventId: { type: 'string' }, note: { type: 'string' } },
      required: ['tripId', 'eventId'],
    },
    invoke: (args, authHeader) =>
      callHandler(require('../events/skip'), {
        pathParameters: { tripId: args.tripId, eventId: args.eventId },
        body: { note: args.note },
        headers: { Authorization: authHeader },
      }),
  },
  {
    name: 'unskip_event',
    description: 'Undo a skip marking on an itinerary event.',
    inputSchema: {
      type: 'object',
      properties: { tripId: { type: 'string' }, eventId: { type: 'string' } },
      required: ['tripId', 'eventId'],
    },
    invoke: (args, authHeader) =>
      callHandler(require('../events/unskip'), {
        pathParameters: { tripId: args.tripId, eventId: args.eventId },
        headers: { Authorization: authHeader },
      }),
  },
  {
    name: 'swap_event',
    description:
      "Mark an itinerary event as swapped for something else the group did instead, with an optional note. Mutually exclusive with done/skipped.",
    inputSchema: {
      type: 'object',
      properties: { tripId: { type: 'string' }, eventId: { type: 'string' }, note: { type: 'string' } },
      required: ['tripId', 'eventId'],
    },
    invoke: (args, authHeader) =>
      callHandler(require('../events/swap'), {
        pathParameters: { tripId: args.tripId, eventId: args.eventId },
        body: { note: args.note },
        headers: { Authorization: authHeader },
      }),
  },
  {
    name: 'unswap_event',
    description: 'Undo a swap marking on an itinerary event.',
    inputSchema: {
      type: 'object',
      properties: { tripId: { type: 'string' }, eventId: { type: 'string' } },
      required: ['tripId', 'eventId'],
    },
    invoke: (args, authHeader) =>
      callHandler(require('../events/unswap'), {
        pathParameters: { tripId: args.tripId, eventId: args.eventId },
        headers: { Authorization: authHeader },
      }),
  },
  {
    name: 'pick_event_option',
    description:
      "Choose a restaurant alternative for a meal event. chosenIndex 0 is the AI's original pick, 1+ are alternatives.",
    inputSchema: {
      type: 'object',
      properties: {
        tripId: { type: 'string' },
        eventId: { type: 'string' },
        chosenIndex: { type: 'integer', minimum: 0 },
        planVersion: { type: 'integer' },
      },
      required: ['tripId', 'eventId', 'chosenIndex', 'planVersion'],
    },
    invoke: (args, authHeader) =>
      callHandler(require('../events/pick'), {
        pathParameters: { tripId: args.tripId, eventId: args.eventId },
        body: { chosenIndex: args.chosenIndex, planVersion: args.planVersion },
        headers: { Authorization: authHeader },
      }),
  },
  {
    name: 'unpick_event_option',
    description: "Revert a meal event to the AI's original pick.",
    inputSchema: {
      type: 'object',
      properties: { tripId: { type: 'string' }, eventId: { type: 'string' } },
      required: ['tripId', 'eventId'],
    },
    invoke: (args, authHeader) =>
      callHandler(require('../events/unpick'), {
        pathParameters: { tripId: args.tripId, eventId: args.eventId },
        headers: { Authorization: authHeader },
      }),
  },
  {
    name: 'update_my_membership',
    description: "Update the caller's display name, preferences, or companions for a specific trip.",
    inputSchema: {
      type: 'object',
      properties: {
        tripId: { type: 'string' },
        displayName: { type: 'string' },
        preferences: { type: 'object', description: 'Merged into existing preferences' },
        companions: { type: 'array', items: { type: 'object' }, description: '[{ name, age }]' },
      },
      required: ['tripId'],
    },
    invoke: (args, authHeader) =>
      callHandler(require('../members/updateMe'), {
        pathParameters: { tripId: args.tripId },
        body: { displayName: args.displayName, preferences: args.preferences, companions: args.companions },
        headers: { Authorization: authHeader },
      }),
  },
  {
    name: 'update_my_display_name',
    description: 'Update the caller\'s display name account-wide — syncs to every trip they currently belong to.',
    inputSchema: {
      type: 'object',
      properties: { displayName: { type: 'string' } },
      required: ['displayName'],
    },
    invoke: (args, authHeader) =>
      callHandler(require('../members/updateDisplayName'), {
        body: { displayName: args.displayName },
        headers: { Authorization: authHeader },
      }),
  },
  {
    name: 'leave_trip',
    description: "Leave a trip. The trip owner can't leave — they must delete the trip instead.",
    inputSchema: {
      type: 'object',
      properties: { tripId: { type: 'string' } },
      required: ['tripId'],
    },
    invoke: (args, authHeader) =>
      callHandler(require('../members/leave'), {
        pathParameters: { tripId: args.tripId },
        headers: { Authorization: authHeader },
      }),
  },
  {
    name: 'get_me',
    description: "The caller's account-level preferences: theme and email notification settings.",
    inputSchema: { type: 'object', properties: {}, required: [] },
    invoke: (args, authHeader) =>
      callHandler(require('../me/get'), { headers: { Authorization: authHeader } }),
  },
  {
    name: 'update_my_theme',
    description: "Update the caller's account-level theme preference.",
    inputSchema: {
      type: 'object',
      properties: { theme: { type: 'string', enum: ['light', 'dark'] } },
      required: ['theme'],
    },
    invoke: (args, authHeader) =>
      callHandler(require('../me/updateTheme'), {
        body: { theme: args.theme },
        headers: { Authorization: authHeader },
      }),
  },
  {
    name: 'update_my_email_prefs',
    description:
      'Update the caller\'s email notification preferences (trip reminders, activity emails). Both default off; only the keys provided are changed.',
    inputSchema: {
      type: 'object',
      properties: {
        tripReminders: { type: 'boolean' },
        activityNotifications: { type: 'boolean' },
      },
      required: [],
    },
    invoke: (args, authHeader) =>
      callHandler(require('../me/updateEmailPrefs'), {
        body: { tripReminders: args.tripReminders, activityNotifications: args.activityNotifications },
        headers: { Authorization: authHeader },
      }),
  },

  // ── Batch 3 — AI-driven and destructive ─────────────────────────────
  // Ship-last on purpose: these are where the app's real guardrails live
  // (cooldowns, cost, owner-only gates, cascade deletes) — calling the real
  // handler in-process (not reimplementing) means every one of those still
  // applies exactly as it does through the REST API.

  {
    name: 'create_trip',
    description: 'Create a new trip. The caller becomes its owner.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        destination: { type: 'string' },
        startDate: { type: 'string', description: 'YYYY-MM-DD' },
        endDate: { type: 'string', description: 'YYYY-MM-DD' },
        displayName: { type: 'string', description: "Caller's display name on this trip" },
        tripType: { type: 'string', enum: ['business', 'leisure', 'friends', 'family', 'date'] },
      },
      required: ['name', 'destination', 'startDate', 'endDate'],
    },
    invoke: (args, authHeader) =>
      callHandler(require('../trips/create'), {
        body: {
          name: args.name,
          destination: args.destination,
          startDate: args.startDate,
          endDate: args.endDate,
          displayName: args.displayName,
          tripType: args.tripType,
        },
        headers: { Authorization: authHeader },
      }),
  },
  {
    name: 'update_trip',
    description:
      "Edit a trip's name, destination, or dates (full replace of these fields — send all of them). Owner-only.",
    inputSchema: {
      type: 'object',
      properties: {
        tripId: { type: 'string' },
        name: { type: 'string' },
        destination: { type: 'string' },
        startDate: { type: 'string', description: 'YYYY-MM-DD' },
        endDate: { type: 'string', description: 'YYYY-MM-DD' },
        tripType: { type: 'string', enum: ['business', 'leisure', 'friends', 'family', 'date'] },
      },
      required: ['tripId', 'name', 'destination', 'startDate', 'endDate'],
    },
    invoke: (args, authHeader) =>
      callHandler(require('../trips/update'), {
        pathParameters: { tripId: args.tripId },
        body: {
          name: args.name,
          destination: args.destination,
          startDate: args.startDate,
          endDate: args.endDate,
          tripType: args.tripType,
        },
        headers: { Authorization: authHeader },
      }),
  },
  {
    name: 'preview_trip',
    description:
      "Minimal public preview of a trip (name, destination, member count) — works even if the caller hasn't joined yet, e.g. to check an invite link before joining.",
    inputSchema: {
      type: 'object',
      properties: { tripId: { type: 'string' } },
      required: ['tripId'],
    },
    invoke: (args, authHeader) =>
      callHandler(require('../trips/preview'), {
        pathParameters: { tripId: args.tripId },
        headers: { Authorization: authHeader },
      }),
  },
  {
    name: 'generate_plan',
    description:
      'Trigger AI itinerary generation for a trip (async — returns triggered: true immediately, the plan appears on get_trip/get_today shortly after). Costs real money per call and is rate-limited to once per 30 seconds per trip; a call within that window returns an error, which is expected, not a failure to retry immediately.',
    inputSchema: {
      type: 'object',
      properties: { tripId: { type: 'string' } },
      required: ['tripId'],
    },
    invoke: (args, authHeader) =>
      callHandler(require('../plan/generate'), {
        pathParameters: { tripId: args.tripId },
        headers: { Authorization: authHeader },
      }),
  },
  {
    name: 'generate_advisor_tips',
    description:
      "Generate fresh AI advisor tips for a trip (hotel area, arrival gaps, departure timing, coverage gaps) — replaces the trip's existing tips. Calls Bedrock; rate-limited to once per 30 seconds per trip.",
    inputSchema: {
      type: 'object',
      properties: { tripId: { type: 'string' } },
      required: ['tripId'],
    },
    invoke: (args, authHeader) =>
      callHandler(require('../advisor/generate'), {
        pathParameters: { tripId: args.tripId },
        headers: { Authorization: authHeader },
      }),
  },
  {
    name: 'dismiss_tip',
    description: 'Dismiss/delete a single advisor tip.',
    inputSchema: {
      type: 'object',
      properties: { tripId: { type: 'string' }, tipId: { type: 'string' } },
      required: ['tripId', 'tipId'],
    },
    invoke: (args, authHeader) =>
      callHandler(require('../advisor/dismiss'), {
        pathParameters: { tripId: args.tripId, tipId: args.tipId },
        headers: { Authorization: authHeader },
      }),
  },
  {
    name: 'finalize_trip',
    description:
      "Lock in the trip's current itinerary version. Requires either every member to have approved that version, or the caller to be the trip owner (who can override).",
    inputSchema: {
      type: 'object',
      properties: { tripId: { type: 'string' } },
      required: ['tripId'],
    },
    invoke: (args, authHeader) =>
      callHandler(require('../trips/finalize'), {
        pathParameters: { tripId: args.tripId },
        headers: { Authorization: authHeader },
      }),
  },
  {
    name: 'complete_trip',
    description: 'Mark a trip complete (unlocks the post-trip recap). Any member can do this.',
    inputSchema: {
      type: 'object',
      properties: { tripId: { type: 'string' } },
      required: ['tripId'],
    },
    invoke: (args, authHeader) =>
      callHandler(require('../trips/complete'), {
        pathParameters: { tripId: args.tripId },
        headers: { Authorization: authHeader },
      }),
  },
  {
    name: 'uncomplete_trip',
    description: 'Reopen a trip that was marked complete.',
    inputSchema: {
      type: 'object',
      properties: { tripId: { type: 'string' } },
      required: ['tripId'],
    },
    invoke: (args, authHeader) =>
      callHandler(require('../trips/uncomplete'), {
        pathParameters: { tripId: args.tripId },
        headers: { Authorization: authHeader },
      }),
  },
  {
    name: 'post_trip_feedback',
    description: "Submit (or overwrite) the caller's own post-trip mood + comment feedback.",
    inputSchema: {
      type: 'object',
      properties: {
        tripId: { type: 'string' },
        mood: { type: 'string', enum: ['loved_it', 'good', 'mixed', 'rough'] },
        comment: { type: 'string' },
      },
      required: ['tripId', 'mood'],
    },
    invoke: (args, authHeader) =>
      callHandler(require('../feedback/upsert'), {
        pathParameters: { tripId: args.tripId },
        body: { mood: args.mood, comment: args.comment },
        headers: { Authorization: authHeader },
      }),
  },
  {
    name: 'delete_trip',
    description: 'Permanently delete a trip and everything on it (members, bookings, expenses, plans, feedback). Owner-only. Cannot be undone.',
    inputSchema: {
      type: 'object',
      properties: { tripId: { type: 'string' } },
      required: ['tripId'],
    },
    invoke: (args, authHeader) =>
      callHandler(require('../trips/deleteTrip'), {
        pathParameters: { tripId: args.tripId },
        headers: { Authorization: authHeader },
      }),
  },
  {
    name: 'mark_notifications_read',
    description: "Mark all of the caller's currently-unread notifications as read.",
    inputSchema: { type: 'object', properties: {}, required: [] },
    invoke: (args, authHeader) =>
      callHandler(require('../notifications/markRead'), { headers: { Authorization: authHeader } }),
  },
]

const TOOLS_BY_NAME = Object.fromEntries(TOOLS.map((t) => [t.name, t]))

module.exports = { TOOLS, TOOLS_BY_NAME }
