const db = require('../../shared/db')
const { extractUserId } = require('../../shared/auth')
const { ok, err } = require('../../shared/response')
const { getTripAggregate } = require('../../shared/tripAggregate')

const GENERATE_COOLDOWN_MS = 30 * 1000
const WORKER_FUNCTION_NAME = process.env.GENERATE_WORKER_FUNCTION_NAME

// Fast trigger only — the actual Bedrock call lives in generateWorker.js,
// invoked async (fire-and-forget) below. This handler must return well within
// API Gateway HTTP API's hard 29s synchronous-integration ceiling; the worker
// isn't bound by that since it's invoked directly, not through API Gateway.
exports.handler = async (event) => {
  let userId
  try {
    userId = await extractUserId(event)
  } catch (e) {
    return err(e.statusCode || 401, e.message || 'Unauthorized')
  }

  const tripId = event.pathParameters?.tripId
  if (!tripId) return err(400, 'tripId is required')

  const { trip, members } = await getTripAggregate(tripId)
  if (!trip) return err(404, 'Trip not found')

  const isMember = members.some((m) => m.userId === userId)
  if (!isMember) return err(403, 'Not a member of this trip')

  // Bedrock costs real money per call — this is a hard rate limit, not a UI nicety.
  // Atomic conditional write closes the race window a naive get-then-check-then-put
  // would leave open for two near-simultaneous requests. Also clears any stale
  // lastGenerationError from a prior failed attempt so a fresh try starts clean.
  const now = new Date()
  const cutoff = new Date(now.getTime() - GENERATE_COOLDOWN_MS).toISOString()
  try {
    await db.updateIf(`TRIP#${tripId}`, 'META', {
      UpdateExpression: 'SET lastGeneratedAt = :now REMOVE lastGenerationError',
      ConditionExpression: 'attribute_not_exists(lastGeneratedAt) OR lastGeneratedAt < :cutoff',
      ExpressionAttributeValues: { ':now': now.toISOString(), ':cutoff': cutoff },
    })
  } catch (e) {
    if (e.name === 'ConditionalCheckFailedException') {
      return err(429, 'Please wait a few seconds before regenerating.')
    }
    throw e
  }

  try {
    const { LambdaClient, InvokeCommand } = await import('@aws-sdk/client-lambda')
    const lambda = new LambdaClient({ region: process.env.AWS_REGION || 'us-east-1' })
    await lambda.send(
      new InvokeCommand({
        FunctionName: WORKER_FUNCTION_NAME,
        InvocationType: 'Event',
        Payload: JSON.stringify({ tripId, userId }),
      })
    )
  } catch (e) {
    // The invoke call itself failed to dispatch (e.g. IAM/config issue) — this is
    // distinct from the worker failing later, which this handler never sees.
    return err(502, `Could not start itinerary generation: ${e.message}`)
  }

  return ok(202, { triggered: true })
}
