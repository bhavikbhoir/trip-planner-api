const REGION = process.env.AWS_REGION || 'us-east-1'

const MODEL_IDS = {
  sonnet: 'us.anthropic.claude-sonnet-4-6',
  haiku: 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
}

async function invokeClaude({ prompt, model = 'sonnet', maxTokens = 500 }) {
  const { BedrockRuntimeClient, InvokeModelCommand } = await import('@aws-sdk/client-bedrock-runtime')
  const client = new BedrockRuntimeClient({ region: REGION })

  const res = await client.send(
    new InvokeModelCommand({
      modelId: MODEL_IDS[model] || MODEL_IDS.sonnet,
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify({
        anthropic_version: 'bedrock-2023-05-31',
        max_tokens: maxTokens,
        messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
      }),
    })
  )

  const body = JSON.parse(new TextDecoder().decode(res.body))
  return body.content?.[0]?.text || ''
}

module.exports = { invokeClaude, MODEL_IDS }
