# trip-planner-api

Serverless backend for MANIFEST, a collaborative AI group trip planner.

## Stack

- AWS Lambda (Node 20) via Serverless Framework v3
- API Gateway HTTP API with a native Cognito JWT authorizer
- DynamoDB single table (`trip-planner-{stage}`), GSI1 for "my trips" lookups, GSI2 for notifications
- AWS Cognito User Pool for auth (provisioned by this stack)
- AWS Bedrock (Claude Sonnet for itinerary generation, Claude Haiku for advisor tips)
- OpenStreetMap Overpass API (real opening-hours/parking grounding) and OSRM (real driving routes) — both free, public instances, no key
- OpenWeatherMap (current conditions), key in Secrets Manager

## Local development

```bash
npm install
npm run offline
# API on http://localhost:3000
```

`serverless-offline` emulates the Lambda/HTTP layer but not Cognito or
DynamoDB. To exercise auth end-to-end locally, point requests at a deployed
dev-stage Cognito User Pool (see Deploy below).

## Deploy

Requires AWS credentials configured (`aws configure` or env vars) with
permission to create Cognito, DynamoDB, Lambda, API Gateway, IAM, SNS, and
CloudWatch resources.

```bash
npm run deploy:dev
npm run deploy:prod
```

After the first deploy, note the CloudFormation stack outputs `UserPoolId`,
`UserPoolClientId`, and `HttpApiUrl` — the frontend needs all three
(`VITE_COGNITO_USER_POOL_ID`, `VITE_COGNITO_CLIENT_ID`, `VITE_API_BASE`).

A CloudWatch Alarm watches `generateWorker` for errors and notifies via SNS
email — the first deploy triggers an AWS "Subscription Confirmation" email
that has to be clicked once before alerts actually deliver.

## Tests

```bash
npm run test   # node's built-in test runner — no extra dependency
```

Unit tests for the pure logic modules: the eval harness's own assertion
functions (`eval/assertions.js`) and the day-of view's time parsing and
booking-date-range logic (`functions/trips/today.js`). Runs in CI on every
push, before the eval dry-run and deploy steps.

## Prompt eval harness

```bash
npm run eval       # free — builds and prints each fixture's real prompt, no Bedrock call
npm run eval:live  # calls real Bedrock, runs structural assertions against the response
```

Targets the specific regression classes this project has actually shipped:
generic "Traveler N" labels standing in for real member names, and events
scheduled before a hard arrival anchor (with exemptions for logistics events
like hotel check-in and named early-arriver solo activities, which are
legitimate). `npm run eval` (dry-run) runs in CI on every push as a free
sanity check that prompt-building itself hasn't broken; `eval:live` costs a
small real amount and is manual-only.

## Endpoints

All behind the Cognito JWT authorizer (`Authorization: Bearer <access token>`) unless noted.

**Trips**
| Method | Path | Purpose |
|--------|------|---------|
| POST | `/trips` | create a trip |
| GET | `/trips` | list the caller's trips |
| GET | `/trips/{tripId}` | get one trip + members + logistics + bookings + plans + suggestions + approvals + expenses + tips |
| GET | `/trips/{tripId}/preview` | membership-optional trip preview (name/destination/member count) for the join-invite flow |
| GET | `/trips/{tripId}/today` | today's events + active bookings, for the day-of view |
| POST | `/trips/{tripId}/join` | join an existing trip |
| POST | `/trips/{tripId}/finalize` | owner-only (or all-approved) — lock in the current plan |
| DELETE | `/trips/{tripId}` | owner-only — cascading delete of the entire trip aggregate |

**Membership & logistics**
| Method | Path | Purpose |
|--------|------|---------|
| PATCH | `/trips/{tripId}/members/me` | update the caller's preferences + companions + display name |
| DELETE | `/trips/{tripId}/members/me` | leave a trip (owners must delete the trip instead) |
| PUT | `/trips/{tripId}/logistics/me` | set the caller's arrival/departure + transport mode |
| PATCH | `/me/displayName` | update display name across every trip the caller already belongs to (Cognito's own `name` attribute is updated client-side; this syncs the cached copy on each `MEMBER#` item) |

**Bookings & expenses**
| Method | Path | Purpose |
|--------|------|---------|
| POST | `/trips/{tripId}/bookings` | add a manual booking (hotel/car/other) |
| DELETE | `/trips/{tripId}/bookings/{bookingId}` | remove a booking |
| POST | `/trips/{tripId}/expenses` | log an expense, split across chosen members (defaults to everyone) |
| DELETE | `/trips/{tripId}/expenses/{expenseId}` | remove an expense |

**Itinerary generation**
| Method | Path | Purpose |
|--------|------|---------|
| POST | `/trips/{tripId}/plan/generate` | trigger AI generation (async — 202, poll `GET /trips/{tripId}` for the new plan version); 30s cooldown |
| GET | `/trips/{tripId}/weather` | current conditions for the destination |
| PUT | `/trips/{tripId}/events/{eventId}/done` | mark an itinerary event done (day-of view) |
| DELETE | `/trips/{tripId}/events/{eventId}/done` | unmark it |

**Collaboration**
| Method | Path | Purpose |
|--------|------|---------|
| POST | `/trips/{tripId}/suggestions` | suggest a change for the next plan version |
| DELETE | `/trips/{tripId}/suggestions/{suggestionId}` | dismiss a suggestion |
| PUT | `/trips/{tripId}/approvals/me` | approve a plan version |
| POST | `/trips/{tripId}/advisor/generate` | generate Haiku-powered contextual tips (hotel fit, arrival gaps, tight departures, coverage gaps); 30s cooldown |
| DELETE | `/trips/{tripId}/advisor/{tipId}` | dismiss a tip |

**Notifications**
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/notifications` | the caller's notifications (member joined, suggestion added, plan regenerated) |
| POST | `/notifications/mark-read` | mark all unread as read |

Body shapes are documented inline in each handler under `functions/`.

## Data model

Single table, PK `pk` / SK `sk`. GSI1 (`GSI1pk`/`GSI1sk`) for the per-user
"my trips" access pattern; GSI2 (`GSI2pk`/`GSI2sk`) for the per-user
notifications feed.

| Item | pk | sk |
|------|-----|-----|
| Trip | `TRIP#<tripId>` | `META` |
| Member | `TRIP#<tripId>` | `MEMBER#<userId>` |
| Logistics | `TRIP#<tripId>` | `LOGISTICS#<userId>` |
| Booking | `TRIP#<tripId>` | `BOOKING#<bookingId>` |
| Expense | `TRIP#<tripId>` | `EXPENSE#<expenseId>` |
| Plan version | `TRIP#<tripId>` | `PLAN#<version>` |
| Suggestion | `TRIP#<tripId>` | `SUGGESTION#<suggestionId>` |
| Approval | `TRIP#<tripId>` | `APPROVAL#<userId>#<planVersion>` |
| Advisor tip | `TRIP#<tripId>` | `TIP#<tipId>` |
| Event completion | `TRIP#<tripId>` | `DONE#<eventId>` |
| Notification | `TRIP#<tripId>` | `NOTIFICATION#<notificationId>` |

Member items also carry `GSI1pk=USER#<userId>`, `GSI1sk=TRIP#<tripId>`, plus
`preferences` (food/activities/budgetPace/groupDynamics/dislikes/mustDo) and
`companions: [{ name, age }]` for +1s who aren't app users (kids, partners,
parents) — surfaced to the AI for pacing/suggestion context.

Plan events carry a server-assigned `eventId` (stable across regenerations),
plus optional `openingHours`/`nearbyParking` (real OpenStreetMap data,
`shared/overpass.js`), `travelFromPrevious` (real OSRM driving route + a
labeled straight-line walking estimate, `shared/osrm.js`), and
`transitEstimate` (AI-generated, only when plausible, always phrased as an
estimate to verify).

## Reliability & cost guardrails

- **Rate limits**: both AI-calling endpoints (`plan/generate`, `advisor/generate`) have an atomic 30s per-trip cooldown (DynamoDB conditional write) — Bedrock costs real money per call.
- **IAM**: `bedrock:InvokeModel` is scoped to the exact two models actually called (`shared/bedrock.js` `MODEL_IDS`), not every foundation model in every region.
- **DynamoDB**: point-in-time recovery and deletion protection are both on — a bad `serverless remove` or stack deletion can no longer destroy trip data.
- **Alerting**: a CloudWatch Alarm on `generateWorker` errors notifies via SNS email (see Deploy above).
- **Budget**: an AWS Budget alerts at 50% of a $5/month cap.
- **Usage signal**: `shared/usageLog.js` writes a structured log line at key lifecycle points (trip created/finalized, plan generated, member joined, suggestion added, expense logged, advisor tips generated) — queryable via CloudWatch Logs Insights, no separate analytics service.

## CI/CD

`.github/workflows/deploy.yml` — push to `master` runs a syntax check across
every function, the eval harness in dry-run mode (free), and a CloudFormation
template compile check, then auto-deploys to the `dev` stage. Deploying
`prod` is a manual `workflow_dispatch` run (choose the stage in the Actions
UI). Nothing deploys on pull requests, only on an actual push to `master`.

Required GitHub Actions secrets (repo Settings → Secrets and variables →
Actions):

| Secret | Description |
|--------|-------------|
| `AWS_ACCESS_KEY_ID` | IAM user/role with deploy permissions |
| `AWS_SECRET_ACCESS_KEY` | matching secret key |

No other secrets needed — the weather API key lives in Secrets Manager
(`trip-planner/weather-api-key`) and is read directly by the Lambda via IAM,
not injected through CI.

## Status

Full collaborative loop is live: trip creation, preferences/companions,
logistics, manual bookings, AI itinerary generation (forced tool-use output,
grounded in real OpenStreetMap opening-hours/parking and real OSRM driving
routes), suggestions/approvals/finalize, a day-of view with per-event
completion tracking, expense tracking with debt-simplified settle-up,
Haiku-powered advisor tips, and notifications. A starter unit test suite
covers the pure logic modules; most of the codebase is still Lambda handlers
exercised only by the eval harness and manual testing — broader handler-level
test coverage is the next real gap.
