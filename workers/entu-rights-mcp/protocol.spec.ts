// #318 RED — minimal MCP over JSON-RPC 2.0 (initialize, tools/list,
// tools/call) as pure functions, plus the thin CF Worker fetch entry.
//
// NO @modelcontextprotocol/sdk, no runtime dependencies (fences.spec.ts pins
// package.json). The Worker tests here are the INTEGRATION layer: tools/call
// travels through the real fetch handler over a bundle built from the real
// doc — the same surface src/index.ts (GREEN) wires the generated bundle
// into — so the tools cannot pass in isolation without being reachable from
// the deployed entry. Activation itself is PO-gated: no wrangler execution
// anywhere in this suite.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildBundle } from './src/generate';
import { parseRightsDoc } from './src/parse';
import { handleJsonRpcMessage, SERVER_NAME } from './src/protocol';
import { rightsRule, rightsRules, TOOL_DEFINITIONS } from './src/tools';
import { createWorker } from './src/worker';

const DOC_PATH = resolve(
	__dirname,
	'../../docs/architecture/entu-rights-and-visibility-model.md'
);
const doc = readFileSync(DOC_PATH, 'utf-8');
const FAKE_SHA = 'deadbeefcafe0123456789abcdef0123456789ab';
const FAKE_DATE = '2026-09-12T00:00:00Z';
const bundle = () => buildBundle(doc, FAKE_SHA, FAKE_DATE);

const rpc = (method: string, params?: unknown, id: number | string = 1) => ({
	jsonrpc: '2.0' as const,
	id,
	method,
	...(params === undefined ? {} : { params })
});

describe('initialize', () => {
	it('returns protocolVersion, serverInfo and a tools capability — the server advertises tools, and only tools', () => {
		const res = handleJsonRpcMessage(
			bundle(),
			rpc('initialize', {
				protocolVersion: '2025-06-18',
				capabilities: {},
				clientInfo: { name: 'spec', version: '0.0.0' }
			})
		);
		expect(res.jsonrpc).toBe('2.0');
		expect(res.id).toBe(1);
		expect(res.error).toBeUndefined();
		const result = res.result as {
			protocolVersion: string;
			capabilities: Record<string, unknown>;
			serverInfo: { name: string; version: string };
		};
		expect(typeof result.protocolVersion).toBe('string');
		expect(result.serverInfo.name).toBe(SERVER_NAME);
		expect(result.serverInfo.name).toBe('entu-rights-mcp');
		expect(result.capabilities.tools, 'tools capability missing').toBeDefined();
		expect(Object.keys(result.capabilities), 'tools is the ONLY capability — no resources, no prompts, no per-question answering surface').toEqual(['tools']);
	});
});

describe('tools/list', () => {
	it('lists exactly the two tool definitions, matching TOOL_DEFINITIONS', () => {
		const res = handleJsonRpcMessage(bundle(), rpc('tools/list', {}, 2));
		expect(res.error).toBeUndefined();
		const result = res.result as { tools: typeof TOOL_DEFINITIONS };
		expect(result.tools).toEqual(TOOL_DEFINITIONS);
		expect(result.tools).toHaveLength(2);
		expect(result.tools.map((t) => t.name)).toEqual(['rights_rule', 'rights_rules']);
	});
});

describe('tools/call routes to the handlers', () => {
	it('rights_rule: the JSON-RPC result IS the tool handler result (toEqual — routing adds nothing, drops nothing)', () => {
		const b = bundle();
		const res = handleJsonRpcMessage(
			b,
			rpc('tools/call', { name: 'rights_rule', arguments: { id: 'ER-13' } }, 3)
		);
		expect(res.error).toBeUndefined();
		expect(res.result).toEqual(rightsRule(b, { id: 'ER-13' }));
	});

	it('rights_rules: same routing contract', () => {
		const b = bundle();
		const res = handleJsonRpcMessage(
			b,
			rpc('tools/call', { name: 'rights_rules', arguments: { topic: 'read boundary' } }, 4)
		);
		expect(res.error).toBeUndefined();
		expect(res.result).toEqual(rightsRules(b, { topic: 'read boundary' }));
	});

	it('an unknown-id tool call is a tool-error RESULT riding a JSON-RPC success — not a protocol error', () => {
		const res = handleJsonRpcMessage(
			bundle(),
			rpc('tools/call', { name: 'rights_rule', arguments: { id: 'ER-999' } }, 5)
		);
		expect(res.error).toBeUndefined();
		expect((res.result as { isError?: boolean }).isError).toBe(true);
	});

	it('an unknown TOOL name is a protocol error: -32602 Invalid params', () => {
		const res = handleJsonRpcMessage(
			bundle(),
			rpc('tools/call', { name: 'rights_answer', arguments: { question: 'why?' } }, 6)
		);
		expect(res.result).toBeUndefined();
		expect(res.error?.code).toBe(-32602);
	});
});

describe('JSON-RPC error codes', () => {
	it('unknown method → -32601 Method not found', () => {
		const res = handleJsonRpcMessage(bundle(), rpc('resources/list', {}, 7));
		expect(res.result).toBeUndefined();
		expect(res.error?.code).toBe(-32601);
	});

	it('malformed message (no jsonrpc/method) → -32600 Invalid Request', () => {
		const res = handleJsonRpcMessage(bundle(), { id: 8 });
		expect(res.error?.code).toBe(-32600);
	});

	it('non-object message → -32600 Invalid Request', () => {
		const res = handleJsonRpcMessage(bundle(), 'rights_rule ER-13');
		expect(res.error?.code).toBe(-32600);
	});

	it('the request id is echoed, string ids included', () => {
		const res = handleJsonRpcMessage(bundle(), rpc('tools/list', {}, 'req-abc'));
		expect(res.id).toBe('req-abc');
	});
});

describe('Worker fetch entry (integration: the deploy surface)', () => {
	const worker = () => createWorker(bundle());

	it('GET → 200 JSON health shape carrying the stamp', async () => {
		const res = await worker().fetch(new Request('https://rights.mvox.eu/', { method: 'GET' }));
		expect(res.status).toBe(200);
		expect(res.headers.get('content-type')).toContain('application/json');
		expect(res.headers.get('access-control-allow-origin')).toBe('*');
		const body = (await res.json()) as { sourceCommit: string; sourceCommitDate: string };
		expect(body.sourceCommit).toBe(FAKE_SHA);
		expect(body.sourceCommitDate).toBe(FAKE_DATE);
	});

	it('POST initialize → JSON-RPC result through the wire', async () => {
		const res = await worker().fetch(
			new Request('https://rights.mvox.eu/', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(
					rpc('initialize', {
						protocolVersion: '2025-06-18',
						capabilities: {},
						clientInfo: { name: 'spec', version: '0.0.0' }
					})
				)
			})
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { jsonrpc: string; id: number; result?: { serverInfo?: { name: string } } };
		expect(body.jsonrpc).toBe('2.0');
		expect(body.id).toBe(1);
		expect(body.result?.serverInfo?.name).toBe('entu-rights-mcp');
	});

	it('POST tools/call rights_rule ER-13 end-to-end: the verbatim rule text and the stamp arrive over the wire', async () => {
		const er13 = parseRightsDoc(doc).rules.find((r) => r.id === 'ER-13');
		const res = await worker().fetch(
			new Request('https://rights.mvox.eu/', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(rpc('tools/call', { name: 'rights_rule', arguments: { id: 'ER-13' } }, 9))
			})
		);
		expect(res.status).toBe(200);
		expect(res.headers.get('access-control-allow-origin')).toBe('*');
		const body = (await res.json()) as {
			result?: { structuredContent?: { text?: string; sourceCommit?: string; sourceCommitDate?: string } };
		};
		expect(body.result?.structuredContent?.text).toBe(er13?.text);
		expect(body.result?.structuredContent?.sourceCommit).toBe(FAKE_SHA);
		expect(body.result?.structuredContent?.sourceCommitDate).toBe(FAKE_DATE);
	});

	it('POST with a body that is not JSON → JSON-RPC -32700 Parse error (a response, not a crash)', async () => {
		const res = await worker().fetch(
			new Request('https://rights.mvox.eu/', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: '{nope'
			})
		);
		const body = (await res.json()) as { error?: { code: number } };
		expect(body.error?.code).toBe(-32700);
	});

	it('GET with Accept: text/event-stream → 405, explicit decline of the optional SSE stream (plain GET keeps the health JSON)', async () => {
		const res = await worker().fetch(
			new Request('https://rights.mvox.eu/', {
				method: 'GET',
				headers: { accept: 'text/event-stream' }
			})
		);
		expect(res.status).toBe(405);
	});

	it('DELETE → 405 (declared, not a fallthrough parse error)', async () => {
		const res = await worker().fetch(new Request('https://rights.mvox.eu/', { method: 'DELETE' }));
		expect(res.status).toBe(405);
	});

	// A realistic preflight, not a bare OPTIONS: the MCP lifecycle spec makes
	// `MCP-Protocol-Version` mandatory on every HTTP request after initialize,
	// so a real browser client asks for it by name. Asserting that each
	// REQUESTED header comes back in the allow-list (rather than pinning a
	// literal string) is what fails if the list ever narrows again.
	it('OPTIONS → 204 and the preflight allows every header a real MCP client asks for', async () => {
		const requested = 'content-type, mcp-protocol-version';
		const res = await worker().fetch(
			new Request('https://rights.mvox.eu/', {
				method: 'OPTIONS',
				headers: {
					origin: 'https://example.test',
					'access-control-request-method': 'POST',
					'access-control-request-headers': requested
				}
			})
		);
		expect(res.status).toBe(204);
		expect(res.headers.get('access-control-allow-origin')).toBe('*');

		const allowedMethods = (res.headers.get('access-control-allow-methods') ?? '')
			.split(',')
			.map((m) => m.trim().toUpperCase());
		expect(allowedMethods).toContain('POST');

		const allowedHeaders = (res.headers.get('access-control-allow-headers') ?? '')
			.split(',')
			.map((h) => h.trim().toLowerCase());
		for (const header of requested.split(',').map((h) => h.trim().toLowerCase())) {
			expect(allowedHeaders).toContain(header);
		}
	});

	// A preflight in front of a non-CORS response buys the browser nothing:
	// the request goes out, the reply is withheld from the caller. So every
	// branch of the handler — not only OPTIONS — must carry the headers.
	it('EVERY response carries CORS, not just the preflight', async () => {
		const url = 'https://rights.mvox.eu/';
		const post = (body: string) =>
			worker().fetch(
				new Request(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body })
			);

		const responses: [string, Response][] = [
			['OPTIONS preflight', await worker().fetch(new Request(url, { method: 'OPTIONS' }))],
			['GET health', await worker().fetch(new Request(url, { method: 'GET' }))],
			[
				'GET SSE decline',
				await worker().fetch(
					new Request(url, { method: 'GET', headers: { accept: 'text/event-stream' } })
				)
			],
			['DELETE 405', await worker().fetch(new Request(url, { method: 'DELETE' }))],
			['PUT 405', await worker().fetch(new Request(url, { method: 'PUT' }))],
			['POST parse error', await post('{nope')],
			['POST notification 202', await post(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }))],
			[
				'POST tools/call',
				await post(JSON.stringify(rpc('tools/call', { name: 'rights_rule', arguments: { id: 'ER-13' } }, 11)))
			],
			['POST tools/list', await post(JSON.stringify(rpc('tools/list', {}, 12)))]
		];

		for (const [label, res] of responses) {
			expect(`${label}: ${res.headers.get('access-control-allow-origin')}`).toBe(`${label}: *`);
			expect(`${label}: ${res.headers.get('access-control-allow-methods')}`).toBe(
				`${label}: GET, POST, OPTIONS`
			);
			expect(`${label}: ${res.headers.get('access-control-allow-headers')}`).toBe(
				`${label}: Content-Type, MCP-Protocol-Version, Mcp-Session-Id`
			);
		}
	});

	it('the full real-client sequence: initialize → notifications/initialized (202, empty, never dispatched) → tools/list → tools/call', async () => {
		const w = worker();
		const post = (body: unknown) =>
			w.fetch(
				new Request('https://rights.mvox.eu/', {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify(body)
				})
			);

		const initRes = await post(
			rpc('initialize', {
				protocolVersion: '2025-06-18',
				capabilities: {},
				clientInfo: { name: 'spec', version: '0.0.0' }
			})
		);
		expect(initRes.status).toBe(200);
		const initBody = (await initRes.json()) as { result?: { serverInfo?: { name: string } } };
		expect(initBody.result?.serverInfo?.name).toBe('entu-rights-mcp');

		// A notification has no `id` member at all — not `id: null`.
		const notifyRes = await post({ jsonrpc: '2.0', method: 'notifications/initialized' });
		expect(notifyRes.status).toBe(202);
		const notifyText = await notifyRes.text();
		expect(notifyText).toBe('');

		const listRes = await post(rpc('tools/list', {}, 2));
		expect(listRes.status).toBe(200);
		const listBody = (await listRes.json()) as { result?: { tools?: unknown[] } };
		expect(listBody.result?.tools).toHaveLength(2);

		const callRes = await post(
			rpc('tools/call', { name: 'rights_rule', arguments: { id: 'ER-13' } }, 3)
		);
		expect(callRes.status).toBe(200);
		const callBody = (await callRes.json()) as {
			result?: { structuredContent?: { sourceCommit?: string } };
		};
		expect(callBody.result?.structuredContent?.sourceCommit).toBe(FAKE_SHA);
	});
});
