// One stdin line in, at most one stdout line out; a failing message never stops the next one.
import { describe, expect, it } from 'vitest';
import { EntuReader } from './src/entu.ts';
import { answerLine } from './src/stdio.ts';
import type { Ctx } from './src/tools.ts';

const dbs = [{ db: 'mvox_a', label: 'A', key: 'key-a' }];
const fetchImpl = (async () => new Response('{}', { status: 500 })) as typeof fetch;
const ctx = (log: (line: string) => void = () => {}): Ctx => ({
	reader: new EntuReader(dbs, fetchImpl),
	dbs,
	team: 'mvox',
	log,
	resize: async (png) => png,
	compose: async (png) => png
});
const call = (id: number) =>
	JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name: 'list_feedback' } });

describe('answerLine', () => {
	it('answers a request with one JSON line', async () => {
		const out = await answerLine(ctx(), '{"jsonrpc":"2.0","id":1,"method":"tools/list"}');
		expect(JSON.parse(out ?? '')).toMatchObject({ id: 1, result: { tools: expect.any(Array) } });
	});

	it('blank lines and notifications get nothing', async () => {
		expect(await answerLine(ctx(), '  ')).toBeNull();
		expect(await answerLine(ctx(), '{"jsonrpc":"2.0","method":"notifications/x"}')).toBeNull();
	});

	it('bad JSON is -32700', async () => {
		expect(JSON.parse((await answerLine(ctx(), 'not json')) ?? '')).toEqual({
			jsonrpc: '2.0',
			id: null,
			error: { code: -32700, message: 'Parse error' }
		});
	});

	it('a message that throws is -32603 for its id, and the next one still answers', async () => {
		let calls = 0;
		const c = ctx(() => {
			calls++;
			if (calls === 1) throw new Error('disk full');
		});
		const first = JSON.parse((await answerLine(c, call(7))) ?? '');
		expect(first).toEqual({
			jsonrpc: '2.0',
			id: 7,
			error: { code: -32603, message: 'Internal error: disk full' }
		});
		const second = JSON.parse((await answerLine(c, call(8))) ?? '');
		expect(second).toMatchObject({ id: 8, result: { content: expect.any(Array) } });
	});
});
