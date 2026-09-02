// Invokes an existing handler module in-process with a synthetic
// API-Gateway-v2-shaped event, so MCP tools reuse the exact same code path
// (and guardrails) as the real HTTP routes without any handler changes.
async function callHandler(handlerModule, { pathParameters, queryStringParameters, body, headers } = {}) {
  const event = {
    headers: headers || {},
    pathParameters: pathParameters || {},
    queryStringParameters: queryStringParameters || null,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    requestContext: {},
  }

  const response = await handlerModule.handler(event)
  const statusCode = response?.statusCode ?? 500

  let parsed = null
  if (response?.body) {
    try {
      parsed = JSON.parse(response.body)
    } catch {
      parsed = response.body
    }
  }

  if (statusCode >= 400) {
    const message = (parsed && parsed.error) || `Request failed with status ${statusCode}`
    const error = new Error(message)
    error.statusCode = statusCode
    throw error
  }

  return parsed
}

module.exports = { callHandler }
