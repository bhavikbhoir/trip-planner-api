const REGION = process.env.AWS_REGION || 'us-east-1'

const MODEL_IDS = {
  sonnet: 'us.anthropic.claude-sonnet-4-6',
  haiku: 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
}

// When `tools` + `toolChoice` are passed, the model is forced to respond via
// a tool call instead of freeform text — the response is the tool's parsed
// `input` object, not a string. This replaces "ask nicely for JSON and hope"
// with a schema-conformant response, so callers no longer need to strip
// markdown fences or recover from truncated/malformed JSON text.
async function invokeClaude({ prompt, model = 'sonnet', maxTokens = 500, tools, toolChoice }) {
  const { BedrockRuntimeClient, InvokeModelCommand } = await import('@aws-sdk/client-bedrock-runtime')
  const client = new BedrockRuntimeClient({ region: REGION })

  const requestBody = {
    anthropic_version: 'bedrock-2023-05-31',
    max_tokens: maxTokens,
    messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
  }
  if (tools) requestBody.tools = tools
  if (toolChoice) requestBody.tool_choice = toolChoice

  const res = await client.send(
    new InvokeModelCommand({
      modelId: MODEL_IDS[model] || MODEL_IDS.sonnet,
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify(requestBody),
    })
  )

  const body = JSON.parse(new TextDecoder().decode(res.body))

  if (toolChoice) {
    const toolUse = body.content?.find((block) => block.type === 'tool_use')
    if (!toolUse) {
      throw new Error(`Model did not return the expected tool call (stop_reason: ${body.stop_reason || 'unknown'})`)
    }
    // A tool_use block can still be present but incomplete — Bedrock hit
    // max_tokens mid-JSON, so `input` is whatever was parseable of a
    // truncated object (often missing required fields entirely). Without
    // this check that surfaces deep inside the caller as something like
    // "Tool call missing 'days' array" — technically true, but it hides the
    // real cause (the response was cut off, not malformed).
    if (body.stop_reason === 'max_tokens') {
      throw new Error(`Response truncated at max_tokens (${maxTokens}) — the request needs a higher token budget`)
    }
    return toolUse.input
  }

  return body.content?.[0]?.text || ''
}

module.exports = { invokeClaude, MODEL_IDS }
