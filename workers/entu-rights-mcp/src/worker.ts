// #318 — thin CF Worker fetch handler over the pure protocol functions. The
// deploy entry (src/index.ts, GREEN-of-activation) imports the GITIGNORED
// generated bundle and calls createWorker(bundle); these tests inject a
// bundle built from the real doc so they never depend on the generated file
// existing. Activation is PO-gated — no wrangler execution in this pipeline
// (runbook only).
//
// REVIEW fix round (findings comment 5642106513): branch on method and
// message shape BEFORE dispatch, matching the Streamable HTTP transport a
// real MCP client actually speaks —
// - notification (parsed JSON-RPC message with no `id` member, e.g.
//   notifications/initialized) → 202, empty body, never dispatched, never
//   an error (JSON-RPC forbids replying to a notification).
// - GET with `Accept: text/event-stream` → 405: an explicit decline of the
//   optional SSE stream, not a silent 200 of the health JSON under the
//   wrong content type. Plain GET keeps the health JSON.
// - DELETE → 405 (no session to delete; declared, not a fallthrough parse
//   error).
// - OPTIONS → 204 with CORS headers, so a browser-based client's preflight
//   succeeds — and, because a preflight in front of a non-CORS response buys
//   the browser nothing, EVERY response goes out through `respond()`, which
//   merges CORS_HEADERS in. There is no return path here that skips it.
//   The allow-headers list must name `MCP-Protocol-Version`: the MCP
//   lifecycle spec requires an HTTP client to send that header on every
//   request after `initialize`, so allowing only `Content-Type` makes the
//   browser block every post-initialize request. `Mcp-Session-Id` is listed
//   too — this server is sessionless, but a client that echoes one back
//   would otherwise fail preflight over a header we simply ignore.
import type { RulesBundle } from './types';
import { handleJsonRpcMessage } from './protocol';

export interface RightsWorker {
	fetch(request: Request): Promise<Response> | Response;
}

const JSON_HEADERS = { 'content-type': 'application/json' };
const ALLOW_HEADERS = { Allow: 'GET, POST, OPTIONS' };
const CORS_HEADERS = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
	'Access-Control-Allow-Headers': 'Content-Type, MCP-Protocol-Version, Mcp-Session-Id'
};

/**
 * The one exit from `fetch`. CORS headers belong on every response, not only
 * on the preflight: a browser that is allowed to send the request but then
 * reads a reply with no `Access-Control-Allow-Origin` still gets the reply
 * withheld from the caller.
 */
const respond = (body: BodyInit | null, status: number, headers: Record<string, string> = {}) =>
	new Response(body, { status, headers: { ...CORS_HEADERS, ...headers } });

const isRecord = (x: unknown): x is Record<string, unknown> =>
	typeof x === 'object' && x !== null && !Array.isArray(x);

/**
 * A JSON-RPC notification is a well-formed request-shaped message with no
 * `id` member at all — distinct from `id: null`, which is a (discouraged
 * but valid) request expecting a reply. Per spec, a server MUST NOT reply
 * to a notification.
 */
const isNotification = (message: unknown): boolean =>
	isRecord(message) &&
	message.jsonrpc === '2.0' &&
	typeof message.method === 'string' &&
	!Object.prototype.hasOwnProperty.call(message, 'id');

/**
 * OPTIONS → 204 + CORS (preflight). DELETE → 405 (declared, not a
 * fallthrough parse error). GET → health shape carrying sourceCommit +
 * sourceCommitDate, UNLESS the client asks for the optional SSE stream
 * (`Accept: text/event-stream`), which this server declines with 405. POST
 * → JSON-RPC dispatch: body parse failure → JSON-RPC error -32700; a
 * notification → 202 empty body, never dispatched.
 */
export function createWorker(bundle: RulesBundle): RightsWorker {
	return {
		async fetch(request: Request): Promise<Response> {
			if (request.method === 'OPTIONS') {
				return respond(null, 204);
			}

			if (request.method === 'DELETE') {
				return respond(null, 405, ALLOW_HEADERS);
			}

			if (request.method === 'GET') {
				const accept = request.headers.get('accept') ?? '';
				if (accept.includes('text/event-stream')) {
					return respond(null, 405, ALLOW_HEADERS);
				}
				return respond(
					JSON.stringify({
						server: 'entu-rights-mcp',
						rules: bundle.rules.length,
						sourceCommit: bundle.sourceCommit,
						sourceCommitDate: bundle.sourceCommitDate
					}),
					200,
					JSON_HEADERS
				);
			}

			if (request.method !== 'POST') {
				return respond(null, 405, ALLOW_HEADERS);
			}

			let message: unknown;
			try {
				message = await request.json();
			} catch {
				return respond(
					JSON.stringify({
						jsonrpc: '2.0',
						id: null,
						error: { code: -32700, message: 'Parse error' }
					}),
					200,
					JSON_HEADERS
				);
			}

			if (isNotification(message)) {
				return respond(null, 202);
			}

			const response = handleJsonRpcMessage(bundle, message);
			return respond(JSON.stringify(response), 200, JSON_HEADERS);
		}
	};
}
