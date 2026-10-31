// JSON-RPC handling: the same shapes as entu-rights-mcp, plus null for notifications.
import { describe, expect, it } from 'vitest';
import { EntuReader } from './src/entu.ts';
import { handleMessage, SERVER_NAME } from './src/protocol.ts';
import type { Ctx } from './src/tools.ts';

const dbs = [{ db: 'mvox_a', label: 'A', key: 'key-a' }];
const fetchImpl = (async () => new Response('{}', { status: 500 })) as typeof fetch;
const ctx = (): Ctx => ({
	reader: new EntuReader(dbs, fetchImpl),
	dbs,
	team: 'mvox',
	log: () => {},
	resize: async (png) => png,
	compose: async (png) => png
});
const rpc = (method: string, params?: unknown, id: number | string = 1) => ({
	jsonrpc: '2.0' as const,
	id,
	method,
	...(params === undefined ? {} : { params })
});

describe('handleMessage', () => {
	it('initialize advertises tools', async () => {
		const res = await handleMessage(ctx(), rpc('initialize', { protocolVersion: '2025-06-18' }));
		const result = res?.result as {
			protocolVersion: string;
			capabilities: Record<string, unknown>;
			serverInfo: { name: string };
		};
		expect(res?.id).toBe(1);
		expect(SERVER_NAME).toBe('mvox-feedback');
		expect(result.serverInfo.name).toBe('mvox-feedback');
		expect(typeof result.protocolVersion).toBe('string');
		expect(Object.keys(result.capabilities)).toEqual(['tools']);
	});

	it('tools/list has three tools', async () => {
		const res = await handleMessage(ctx(), rpc('tools/list'));
		const tools = (res?.result as { tools: { name: string; inputSchema: unknown }[] }).tools;
		expect(tools.map((t) => t.name)).toEqual(['list_feedback', 'get_feedback', 'count_feedback']);
		for (const t of tools) expect(t.inputSchema).toMatchObject({ type: 'object' });
	});

	it('tools/call routes to the tool', async () => {
		const res = await handleMessage(
			ctx(),
			rpc('tools/call', { name: 'get_feedback', arguments: { db: '../x', id: 'x' } }, 'q')
		);
		expect(res?.id).toBe('q');
		expect(res?.result).toMatchObject({ isError: true });
	});

	it('tools/call with an unknown tool is -32602', async () => {
		const res = await handleMessage(ctx(), rpc('tools/call', { name: 'write_feedback' }));
		expect(res?.error?.code).toBe(-32602);
	});

	it('unknown method -32601', async () => {
		const res = await handleMessage(ctx(), rpc('resources/list'));
		expect(res?.error?.code).toBe(-32601);
	});

	it('malformed message -32600', async () => {
		expect((await handleMessage(ctx(), { id: 3 }))?.error).toMatchObject({ code: -32600 });
		expect((await handleMessage(ctx(), 'x'))?.error).toMatchObject({ code: -32600 });
		expect((await handleMessage(ctx(), 'x'))?.id).toBeNull();
	});

	it('notifications get no response', async () => {
		const msg = { jsonrpc: '2.0', method: 'notifications/initialized' };
		expect(await handleMessage(ctx(), msg)).toBeNull();
	});
});
