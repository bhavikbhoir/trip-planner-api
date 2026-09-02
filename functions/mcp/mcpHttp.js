/**
 * MANIFEST — Remote MCP Server (Streamable HTTP, stateless)
 *
 * Exposes trip-planner-api's existing handlers as MCP tools by invoking them
 * in-process with a synthetic API-Gateway event (see callHandler.js) —
 * every handler's own guardrails (the 30s AI-endpoint cooldown, the
 * transactWrite mutual-exclusivity in events/{markDone,skip,swap}.js, the
 * cascade-delete in trips/deleteTrip.js, the SES no-op guard) run unchanged,
 * because it's the same code, just not reached via API Gateway this time.
 *
 * Auth: this route sits behind its own `cognitoJwtMcp` HTTP API authorizer
 * (see serverless.yml), scoped to only the dedicated MCP OAuth app client's
 * audience — a token minted here can never authorize a raw REST route. The
 * Authorization header is forwarded as-is into each invoked handler, which
 * re-verifies it itself via shared/auth.js (defense in depth, independent
 * of what API Gateway already checked).
 *
 * No response cache here (unlike the-gooners-world-api's public MCP server)
 * — every tool call returns per-user private data, and a warm-container
 * cache keyed only on tool name + args would leak one user's data into the
 * next request that happens to land on the same warm Lambda.
 */

const { TOOLS, TOOLS_BY_NAME } = require('./tools')

const PROTOCOL_VERSION = '2025-03-26'
const SERVER_INFO = { name: 'manifest-trip-planner', version: '1.0.0' }

function rpcError(id, code, message) {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message } }
}

async function handleRpc(msg, authHeader) {
  const { id, method, params } = msg || {}
  const isNotification = id === undefined || id === null

  try {
    switch (method) {
      case 'initialize':
        return {
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: params?.protocolVersion || PROTOCOL_VERSION,
            capabilities: { tools: {} },
            serverInfo: SERVER_INFO,
          },
        }

      // Notifications — acknowledged with no response body.
      case 'notifications/initialized':
      case 'notifications/cancelled':
        return null

      case 'ping':
        return { jsonrpc: '2.0', id, result: {} }

      case 'tools/list':
        return {
          jsonrpc: '2.0',
          id,
          result: {
            tools: TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })),
          },
        }

      case 'tools/call': {
        const tool = TOOLS_BY_NAME[params?.name]
        if (!tool) return rpcError(id, -32602, `Unknown tool: ${params?.name}`)

        try {
          const data = await tool.invoke(params.arguments || {}, authHeader)
          return {
            jsonrpc: '2.0',
            id,
            result: { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] },
          }
        } catch (toolErr) {
          // Surfaced as a tool-level error (isError), not a transport-level
          // JSON-RPC error — lets the calling model see and react to e.g.
          // "Not a member of this trip" or the plan-generate cooldown
          // message instead of the call just failing opaquely.
          return {
            jsonrpc: '2.0',
            id,
            result: { content: [{ type: 'text', text: toolErr.message }], isError: true },
          }
        }
      }

      default:
        return isNotification ? null : rpcError(id, -32601, `Method not found: ${method}`)
    }
  } catch (err) {
    return isNotification ? null : rpcError(id, -32603, err.message)
  }
}

exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, mcp-session-id, mcp-protocol-version',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  }

  if (event.requestContext?.http?.method === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' }
  }

  const authHeader = event.headers?.authorization || event.headers?.Authorization

  let payload
  try {
    payload = JSON.parse(event.body || '{}')
  } catch {
    return { statusCode: 200, headers, body: JSON.stringify(rpcError(null, -32700, 'Parse error')) }
  }

  // JSON-RPC allows a single message or a batch (array).
  if (Array.isArray(payload)) {
    const responses = (await Promise.all(payload.map((m) => handleRpc(m, authHeader)))).filter(Boolean)
    if (responses.length === 0) return { statusCode: 202, headers, body: '' }
    return { statusCode: 200, headers, body: JSON.stringify(responses) }
  }

  const response = await handleRpc(payload, authHeader)
  if (response === null) return { statusCode: 202, headers, body: '' }
  return { statusCode: 200, headers, body: JSON.stringify(response) }
}
