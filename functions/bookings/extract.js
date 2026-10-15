const { extractUserId } = require('../../shared/auth')
const { ok, err } = require('../../shared/response')
const db = require('../../shared/db')
const { invokeClaude } = require('../../shared/bedrock')

// base64 is ~33% larger than raw; 13.3 MB base64 ≈ 10 MB raw image — same
// cap personal-planner-api's budget-ingest uses for uploaded documents.
const MAX_BASE64_LENGTH = 13_300_000
const ALLOWED_MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic']

const EXTRACT_BOOKING_TOOL = {
  name: 'extract_booking',
  description: 'Extract structured booking details visible in an uploaded confirmation image (hotel, car rental, or other reservation).',
  input_schema: {
    type: 'object',
    properties: {
      type: { type: 'string', enum: ['hotel', 'car', 'other'], description: 'Best guess at booking type from the document' },
      name: { type: 'string', description: 'Hotel name, car rental company, or venue name' },
      location: { type: 'string', description: 'City or address, if shown' },
      startDate: { type: 'string', description: 'Check-in/pickup/start date, as YYYY-MM-DD' },
      startTime: { type: 'string', description: 'Check-in/pickup/start time, 24-hour HH:mm — omit if no time is shown' },
      endDate: { type: 'string', description: 'Check-out/dropoff/end date, as YYYY-MM-DD' },
      endTime: { type: 'string', description: 'Check-out/dropoff/end time, 24-hour HH:mm — omit if no time is shown' },
      confirmation: { type: 'string', description: 'Confirmation or booking reference number, if shown' },
      cost: { type: 'number', description: 'Total cost as a plain number (no currency symbol), if shown' },
      breakfastIncluded: { type: 'boolean', description: 'Only set for a hotel booking, and only if breakfast-included is explicitly stated' },
    },
    required: ['type', 'name'],
  },
}

// Reads a photo/screenshot of a booking confirmation via Bedrock and returns
// structured fields for the caller to pre-fill into the same manual booking
// form — never saved directly, same "review before you trust it" posture as
// any AI-assisted data entry in this app. Modeled on personal-planner-api's
// budget-ingest (base64 upload -> Bedrock -> structured fields), using this
// repo's own invokeClaude + forced tool-call helper instead of budget-ingest's
// regex-extracted free text, since that's the established local pattern
// (see functions/advisor/generate.js).
exports.handler = async (event) => {
  let userId
  try {
    userId = await extractUserId(event)
  } catch (e) {
    return err(e.statusCode || 401, e.message || 'Unauthorized')
  }

  const tripId = event.pathParameters?.tripId
  if (!tripId) return err(400, 'tripId is required')

  const member = await db.get(`TRIP#${tripId}`, `MEMBER#${userId}`)
  if (!member) return err(403, 'Not a member of this trip')

  let body
  try {
    body = JSON.parse(event.body || '{}')
  } catch {
    return err(400, 'Invalid JSON body')
  }

  const { content, mediaType } = body
  if (!content) return err(400, 'content (base64 image) is required')
  if (!ALLOWED_MEDIA_TYPES.includes(mediaType)) {
    return err(400, `mediaType must be one of ${ALLOWED_MEDIA_TYPES.join(', ')}`)
  }
  if (content.length > MAX_BASE64_LENGTH) return err(413, 'Image too large — maximum 10 MB')

  let extracted
  try {
    extracted = await invokeClaude({
      prompt:
        'This image is a booking confirmation (hotel, car rental, or similar). Call extract_booking with ' +
        'whichever fields you can actually read — leave a field out entirely rather than guessing at it.',
      model: 'haiku',
      maxTokens: 500,
      image: { mediaType, base64: content },
      tools: [EXTRACT_BOOKING_TOOL],
      toolChoice: { type: 'tool', name: 'extract_booking' },
    })
  } catch (e) {
    return err(502, `Could not read that image: ${e.message}`)
  }

  return ok(200, { extracted })
}
