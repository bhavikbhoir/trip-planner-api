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
- AWS SES (activity/reminder emails) — optional, see Email setup below

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

## Email setup (optional — required before any email actually sends)

Everything email-related (activity notifications, trip reminders,
`functions/me/unsubscribe.js`) is already built and deployed with every
other endpoint, but `shared/ses.js` safely no-ops — logs what it would have
sent instead of sending — until both `SES_FROM_EMAIL` and
`SES_MAILING_ADDRESS` are set. That's deliberate: these are manual,
account-owner-only steps that can't be scripted or done on your behalf, and
skipping them shouldn't be able to accidentally email a real user a
non-compliant message.

1. **Get a sending identity verified in SES.** Two options:
   - **Fastest — verify a single email address** (e.g. your own): SES
     console → Verified identities → Create identity → Email address. You'll
     get a confirmation email to click. Works immediately, including in
     sandbox mode, but mail visibly comes "from" that one address and skips
     DKIM/domain-reputation benefits.
   - **More durable — verify a domain you own**: buy one if you don't have
     one yet (~$12/yr from any registrar), add it in SES console → Verified
     identities → Create identity → Domain, then add the DKIM CNAME records
     SES gives you at your DNS provider. Firebase Hosting's own
     `*.web.app` domain can't be used here — you need DNS control, which a
     Firebase Hosting subdomain doesn't give you.
2. **Request SES production access.** New accounts start in the SES
   sandbox, which can only email verified addresses. SES console → Account
   dashboard → Request production access — describe the use case (trip
   reminders/activity notifications for an invited group of users, low
   volume, opt-in, one-click unsubscribe already implemented) and expected
   volume. Usually reviewed within ~24h, not guaranteed.
3. **Set the env vars** (`.env.example` in this repo has the full list) and
   redeploy:
   - `SES_FROM_EMAIL` — the verified address or `notifications@yourdomain.com`
   - `SES_MAILING_ADDRESS` — a real postal address (CAN-SPAM requires one in
     every email's footer; a home address works legally but consider a
     virtual mailbox/registered-agent address if that's a concern)
   - `UNSUBSCRIBE_SECRET` — any long random string, e.g. `openssl rand -hex 32`
   - `APP_BASE_URL` — the deployed frontend URL
   - `API_BASE_URL` — this stack's own `HttpApiUrl` output (grab it after
     the first deploy, same as the frontend env vars above)
4. Redeploy (`npm run deploy:dev` / `:prod`). From then on, `notifyMembers()`
   and the daily reminder cron actually send.

Nothing else needs to change — the IAM policy, EventBridge schedule, and
both new endpoints are already live regardless of whether SES is configured.

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
| GET | `/trips/{tripId}` | get one trip + members + logistics + bookings + plans + suggestions + approvals + event completions/skips/swaps + picks + expenses + tips + feedback |
| PUT | `/trips/{tripId}` | owner-only — edit name/destination/dates/tripType |
| GET | `/trips/{tripId}/preview` | membership-optional trip preview (name/destination/member count) for the join-invite flow |
| GET | `/trips/{tripId}/today` | today's events (with done/skipped/swapped status + note) + active bookings, for the day-of view |
| POST | `/trips/{tripId}/join` | join an existing trip |
| POST | `/trips/{tripId}/finalize` | owner-only (or all-approved) — lock in the current plan |
| POST | `/trips/{tripId}/complete` | any member — mark the trip complete (sets `completedAt`), no approval gate |
| DELETE | `/trips/{tripId}/complete` | any member — reopen a completed trip (clears `completedAt`) |
| DELETE | `/trips/{tripId}` | owner-only — cascading delete of the entire trip aggregate |

**Membership & logistics**
| Method | Path | Purpose |
|--------|------|---------|
| PATCH | `/trips/{tripId}/members/me` | update the caller's preferences + companions + display name |
| DELETE | `/trips/{tripId}/members/me` | leave a trip (owners must delete the trip instead) |
| PUT | `/trips/{tripId}/logistics/me` | set the caller's arrival/departure + transport mode |
| PATCH | `/me/displayName` | update display name across every trip the caller already belongs to (Cognito's own `name` attribute is updated client-side; this syncs the cached copy on each `MEMBER#` item) |
| GET | `/me` | account-level preferences — `{ theme, emailPrefs: { tripReminders, activityNotifications } }` |
| PATCH | `/me/theme` | set the caller's saved theme (`light`/`dark`), synced across devices |
| PATCH | `/me/email-prefs` | set one or both email preferences — body `{ tripReminders?, activityNotifications? }`, both default `false` (opt-in) |
| GET | `/unsubscribe` | public, no auth — one-click opt-out from an email link; query `?token=` (signed, see `shared/unsubscribeToken.js`); returns an HTML confirmation page |

**Bookings & expenses**
| Method | Path | Purpose |
|--------|------|---------|
| POST | `/trips/{tripId}/bookings` | add a manual booking (hotel/car/other) |
| PUT | `/trips/{tripId}/bookings/{bookingId}` | edit a booking (any member) |
| DELETE | `/trips/{tripId}/bookings/{bookingId}` | remove a booking |
| POST | `/trips/{tripId}/expenses` | log an expense, split across chosen members (defaults to everyone) |
| DELETE | `/trips/{tripId}/expenses/{expenseId}` | remove an expense |

**Itinerary generation**
| Method | Path | Purpose |
|--------|------|---------|
| POST | `/trips/{tripId}/plan/generate` | trigger AI generation (async — 202, poll `GET /trips/{tripId}` for the new plan version); 30s cooldown |
| GET | `/trips/{tripId}/weather` | current conditions for the destination |
| PUT | `/trips/{tripId}/events/{eventId}/done` | mark an itinerary event done (day-of view); clears any skip/swap on the same event |
| DELETE | `/trips/{tripId}/events/{eventId}/done` | unmark it |
| PUT | `/trips/{tripId}/events/{eventId}/skip` | mark an event skipped — body `{ note? }`; clears any done/swap on the same event |
| DELETE | `/trips/{tripId}/events/{eventId}/skip` | clear the skip |
| PUT | `/trips/{tripId}/events/{eventId}/swap` | mark that the group did something else instead — body `{ note? }`; clears any done/skip on the same event |
| DELETE | `/trips/{tripId}/events/{eventId}/swap` | clear the swap |
| PUT | `/trips/{tripId}/events/{eventId}/pick` | choose a restaurant alternative for a meal event — body `{ chosenIndex, planVersion }`, index into `[default, ...alternatives]` |
| DELETE | `/trips/{tripId}/events/{eventId}/pick` | revert the meal to the AI's original pick |

**Collaboration**
| Method | Path | Purpose |
|--------|------|---------|
| POST | `/trips/{tripId}/suggestions` | suggest a change for the next plan version |
| DELETE | `/trips/{tripId}/suggestions/{suggestionId}` | dismiss a suggestion |
| PUT | `/trips/{tripId}/approvals/me` | approve a plan version |
| POST | `/trips/{tripId}/advisor/generate` | generate Haiku-powered contextual tips (hotel fit, arrival gaps, tight departures, coverage gaps); 30s cooldown |
| DELETE | `/trips/{tripId}/advisor/{tipId}` | dismiss a tip |

**Post-trip**
| Method | Path | Purpose |
|--------|------|---------|
| PUT | `/trips/{tripId}/feedback/me` | submit/overwrite the caller's own post-trip feedback — body `{ mood, comment? }`, `mood` one of `loved_it`/`good`/`mixed`/`rough` |

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
| Event skip | `TRIP#<tripId>` | `SKIPPED#<eventId>` |
| Event swap | `TRIP#<tripId>` | `SWAPPED#<eventId>` |
| Meal pick | `TRIP#<tripId>` | `PICK#<eventId>` |
| Post-trip feedback | `TRIP#<tripId>` | `FEEDBACK#<userId>` |
| Reminder-sent marker | `TRIP#<tripId>` | `REMINDER#trip_starting` |
| Notification | `TRIP#<tripId>` | `NOTIFICATION#<notificationId>` |
| User profile | `USER#<userId>` | `PROFILE` |

`REMINDER#trip_starting` is an internal send-once marker (see
`functions/trips/remindersWorker.js`), not display data — it's intentionally
not part of `getTripAggregate()`, but is still cleaned up on trip delete.
The User profile item now also carries `emailPrefs: { tripReminders,
activityNotifications }` alongside `theme` — both default `false`.

An event is at most one of done/skipped/swapped at a time — existence-based,
like everything else in this table, and kept mutually exclusive via a single
`transactWrite` per status change (`functions/events/{markDone,skip,swap}.js`)
rather than a separate status field that could drift out of sync with which
item(s) actually exist.

The Trip item also gets an explicit, persisted `completedAt` (+`completedBy`)
once a member marks the trip complete via `POST /trips/{tripId}/complete` —
deliberately separate from `status` (`planning`/`finalized`, whether the
*plan* is locked): a trip's real-world completion and its plan's lock state
are independent facts, so a trip can be e.g. "planning + completed" (dates
passed without ever finalizing) just as validly as "finalized + completed."
Trip phase (upcoming/in-progress/completed) is otherwise derived client-side
from dates, never stored — `completedAt` is the one explicit override, so a
trip can be closed early or reopened without recap numbers silently shifting
as today's date moves.

The user profile item is the one account-level (not trip-scoped) item in the
table — currently just holds `theme`. `displayName` intentionally isn't here;
it's cached per-`MEMBER#` item instead (see `PATCH /me/displayName` above),
which predates this item and wasn't worth migrating just to centralize it.

Member items also carry `GSI1pk=USER#<userId>`, `GSI1sk=TRIP#<tripId>`, plus
`preferences` (food/activities/budgetPace/groupDynamics/dislikes/mustDo) and
`companions: [{ name, age }]` for +1s who aren't app users (kids, partners,
parents) — surfaced to the AI for pacing/suggestion context.

Plan events carry a server-assigned `eventId` (freshly minted per generation
by `assignEventIds`, so a regeneration's events are all new ids), plus
optional `openingHours`/`nearbyParking` (real OpenStreetMap data,
`shared/overpass.js`), `travelFromPrevious` (real OSRM driving route + a
labeled straight-line walking estimate, `shared/osrm.js`), and
`transitEstimate` (AI-generated, only when plausible, always phrased as an
estimate to verify). Restaurant/meal events (icon `food`) also carry an
`alternatives` array — 1-2 swappable venues the group can pick between
(`PICK#<eventId>` records the choice). Because picks are keyed on `eventId`
and tagged with `planVersion`, and regeneration mints new ids + bumps the
version, an old pick simply never matches the new plan — meal picks start
clean on each regeneration with no cleanup job.

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
done/skipped/swapped status tracking (with optional notes), expense tracking
with debt-simplified settle-up, Haiku-powered advisor tips, notifications,
and a post-trip lifecycle (mark complete/reopen, a recap of what actually
happened vs. what was planned, per-member mood feedback). Email
(activity-notification emails + a daily trip-starting-soon reminder, both
opt-in, one-click unsubscribe, CAN-SPAM footer) is fully built and deployed
but stays a safe no-op until SES setup is complete — see Email setup above.
A starter unit test suite covers the pure logic modules; most of the
codebase is still Lambda handlers exercised only by the eval harness and
manual testing — broader handler-level test coverage is the next real gap.
