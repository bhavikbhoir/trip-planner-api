// Builds the one-shot prompt used to summarize a draft before carrying it
// into a new conversation (see functions/drafts/create.js's sourceDraftId
// handling). Kept separate from the conversational system prompt so this
// shape can be tested without mocking Bedrock, and so it's obviously a
// single throwaway call rather than part of the ongoing chat.
function buildHandoffPrompt(messages) {
  const transcript = messages.map((m) => `${m.role === 'user' ? 'Traveler' : 'Compass'}: ${m.content}`).join('\n')

  return `Here's a trip-planning conversation. Summarize it in 3-5 short bullet points covering what's actually been decided or ruled out so far — destinations discussed, dates, constraints, preferences. Not a recap of the back-and-forth, just what a new conversation would need to know to pick up where this left off.

${transcript}`
}

module.exports = { buildHandoffPrompt }
