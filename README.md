# trip-planner-api

Serverless backend for MANIFEST, a collaborative AI group trip planner.

## Stack

- AWS Lambda (Node 20) via Serverless Framework v3
- API Gateway HTTP API with a native Cognito JWT authorizer
- DynamoDB single table (`trip-planner-{stage}`), GSI1 for "my trips" lookups
- AWS Cognito User Pool for auth (provisioned by this stack)

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
permission to create Cognito, DynamoDB, Lambda, API Gateway, and IAM
resources.

```bash
npm run deploy:dev
npm run deploy:prod
```

After the first deploy, note the CloudFormation stack outputs `UserPoolId`,
`UserPoolClientId`, and `HttpApiUrl` — the frontend needs all three
(`VITE_COGNITO_USER_POOL_ID`, `VITE_COGNITO_CLIENT_ID`, `VITE_API_BASE`).

## Endpoints

All behind the Cognito JWT authorizer (`Authorization: Bearer <access token>`).

| Method | Path                          | Purpose                                          |
|--------|-------------------------------|---------------------------------------------------|
| POST   | /trips                        | create a trip                                    |
| GET    | /trips                        | list the caller's trips                          |
| GET    | /trips/{tripId}                | get one trip + members + logistics + bookings   |
| POST   | /trips/{tripId}/join            | join an existing trip                           |
| PATCH  | /trips/{tripId}/members/me       | update the caller's preferences + companions   |
| PUT    | /trips/{tripId}/logistics/me     | set the caller's arrival/departure logistics   |
| POST   | /trips/{tripId}/bookings         | add a manual booking (hotel/car/other)         |
| DELETE | /trips/{tripId}/bookings/{bookingId} | remove a booking (any trip member)         |

`PATCH /members/me` body: `{ preferences?: {...}, companions?: [{ name, age }] }` — partial update, merges into existing preferences.

`PUT /logistics/me` body: `{ arrival?: { flight, datetime }, departure?: { flight, datetime } }`.

`POST /bookings` body: `{ type: 'hotel'|'car'|'other', name, location?, startDatetime, endDatetime, confirmation?, cost? }`.

## Data model

Single table, PK `pk` / SK `sk`, GSI1 (`GSI1pk`/`GSI1sk`) for the per-user
"my trips" access pattern.

| Item      | pk              | sk                  |
|-----------|-----------------|----------------------|
| Trip      | TRIP#\<tripId\>  | META                |
| Member    | TRIP#\<tripId\>  | MEMBER#\<userId\>    |
| Logistics | TRIP#\<tripId\>  | LOGISTICS#\<userId\> |
| Booking   | TRIP#\<tripId\>  | BOOKING#\<bookingId\>|

Member items also carry `GSI1pk=USER#<userId>`, `GSI1sk=TRIP#<tripId>`, plus
`preferences` (food/activities/budgetPace/groupDynamics/dislikes/mustDo) and
`companions: [{ name, age }]` for +1s who aren't app users (kids, partners,
parents) — surfaced to the AI for pacing/suggestion context.

## CI/CD

`.github/workflows/deploy.yml` — push to `master` auto-deploys to the `dev`
stage; deploying `prod` is a manual `workflow_dispatch` run (choose the stage
in the Actions UI), mirroring `the-gooners-world-api`'s pipeline. Nothing
deploys on pull requests, only on an actual push to `master` (i.e. after a
merge).

Required GitHub Actions secrets (repo Settings → Secrets and variables →
Actions):

| Secret                  | Description                                      |
|--------------------------|---------------------------------------------------|
| `AWS_ACCESS_KEY_ID`      | IAM user/role with deploy permissions            |
| `AWS_SECRET_ACCESS_KEY`  | matching secret key                              |

No other secrets needed — the weather API key lives in Secrets Manager
(`trip-planner/weather-api-key`) and is read directly by the Lambda via IAM,
not injected through CI.

## Status

Phase 1+2+3 backend — trips, membership, preferences/companions, logistics,
and manual bookings. AI itinerary generation, advisor tips, and
suggestions/approvals land in later phases (see the project plan).
