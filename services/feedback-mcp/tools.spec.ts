// The three tools over a mock Entu: what each returns, what gets logged, and how bad args fail.
import { describe, expect, it, vi } from 'vitest';
import { EntuReader } from './src/entu.ts';
import { callTool, type Ctx } from './src/tools.ts';

const ID_A = 'a00000000000000000000001';
const ID_B = 'b00000000000000000000001';
const SHOT = 'c00000000000000000000001';
const SECRET_TEXT = 'Synthetic complaint about the tenor page';
const dbs = [
	{ db: 'mvox_a', label: 'A', key: 'key-a' },
	{ db: 'mvox_b', label: 'B', key: 'key-b' }
];
const str = (s: string) => [{ _id: 'f'.repeat(24), string: s }];

const entity = (id: string, over: Record<string, unknown> = {}) => ({
	_id: id,
	_type: [{ string: 'feedback' }],
	name: str('/event 2026-10-01'),
	description: str(SECRET_TEXT),
	_created: [{ datetime: '2026-10-01T10:00:00.000Z' }],
	...over
});

type World = {
	a?: Record<string, unknown>[];
	b?: Record<string, unknown>[];
	shot?: Uint8Array<ArrayBuffer>;
	failB?: boolean;
	shotStatus?: number;
};

function ctx(
	world: World = {},
	resize = vi.fn(async (png: Uint8Array, _maxBytes: number) => png.slice(0, 4))
) {
	const a = world.a ?? [entity(ID_A)];
	const b = world.b ?? [entity(ID_B, { _created: [{ datetime: '2026-10-02T10:00:00.000Z' }] })];
	const fetchImpl = (async (input: RequestInfo | URL) => {
		const url = String(input);
		const json = (body: unknown) => new Response(JSON.stringify(body));
		if (world.failB && url.endsWith('db=mvox_b')) return new Response('{}', { status: 403 });
		if (url.includes('/auth?db=')) return json({ token: 't' });
		const list = url.includes('/mvox_a/') ? a : b;
		if (url.includes('/entity?')) return json({ entities: list });
		const one = list.find((e) => url.includes(`/entity/${String(e._id)}`));
		if (one) return json({ entity: one });
		if (url.includes(`/property/${SHOT}`)) return json({ url: 'https://files.example/shot' });
		if (url === 'https://files.example/shot') {
			return new Response(world.shot ?? new Uint8Array(), { status: world.shotStatus ?? 200 });
		}
		return new Response('{}', { status: 404 });
	}) as typeof fetch;
	const lines: string[] = [];
	const c: Ctx = {
		reader: new EntuReader(dbs, fetchImpl),
		dbs,
		team: 'po-team',
		log: (line) => lines.push(line),
		resize
	};
	return { c, lines, resize };
}

const textOf = (r: { content: { type: string; text?: string }[] }) =>
	JSON.parse(r.content[0].text ?? '') as Record<string, unknown>;

describe('callTool', () => {
	it('list returns summaries across dbs', async () => {
		const { c } = ctx();
		const res = await callTool(c, 'list_feedback', {});
		expect(res.isError).toBeUndefined();
		expect(res.content).toHaveLength(1);
		const body = textOf(res);
		expect(body.errors).toEqual([]);
		expect(body.reports).toEqual([
			{
				db: 'mvox_b',
				id: ID_B,
				created: '2026-10-02T10:00:00.000Z',
				page: '/event',
				kind: 'singer',
				firstError: null,
				appVersion: null,
				untriaged: true
			},
			{
				db: 'mvox_a',
				id: ID_A,
				created: '2026-10-01T10:00:00.000Z',
				page: '/event',
				kind: 'singer',
				firstError: null,
				appVersion: null,
				untriaged: true
			}
		]);
		expect(JSON.stringify(body)).not.toContain(SECRET_TEXT);
	});

	it('list filters by db', async () => {
		const { c } = ctx();
		const body = textOf(await callTool(c, 'list_feedback', { db: 'mvox_a' }));
		expect((body.reports as { id: string }[]).map((r) => r.id)).toEqual([ID_A]);
	});

	it('get returns report then image', async () => {
		const shot = new Uint8Array([137, 80, 78, 71]);
		const { c, resize } = ctx({ a: [entity(ID_A, { screenshot: [{ _id: SHOT }] })], shot });
		const res = await callTool(c, 'get_feedback', { db: 'mvox_a', id: ID_A });
		expect(res.isError).toBeUndefined();
		expect(res.content).toHaveLength(2);
		const body = textOf(res);
		expect(body.id).toBe(ID_A);
		expect(body.screenshotFileId).toBe(SHOT);
		expect(body.description).toEqual({ user_submitted: SECRET_TEXT });
		expect(res.content[1]).toEqual({
			type: 'image',
			data: Buffer.from(shot).toString('base64'),
			mimeType: 'image/png'
		});
		expect(resize).not.toHaveBeenCalled();
	});

	it('no screenshot returns text only', async () => {
		const { c } = ctx();
		const res = await callTool(c, 'get_feedback', { db: 'mvox_a', id: ID_A });
		expect(res.isError).toBeUndefined();
		expect(res.content).toHaveLength(1);
		expect(res.content[0].type).toBe('text');
	});

	it('screenshot over 1 MB is resized', async () => {
		const shot = new Uint8Array(1048577);
		const { c, resize } = ctx({ a: [entity(ID_A, { screenshot: [{ _id: SHOT }] })], shot });
		const res = await callTool(c, 'get_feedback', { db: 'mvox_a', id: ID_A });
		expect(resize).toHaveBeenCalledTimes(1);
		const [png, maxBytes] = resize.mock.calls[0];
		expect(png.length).toBe(1048577);
		expect(maxBytes).toBe(1048576);
		const data = Buffer.from(shot.slice(0, 4)).toString('base64');
		expect(res.content[1]).toMatchObject({ type: 'image', data });
	});

	it('a screenshot that cannot be shrunk returns the report, a note and isError', async () => {
		const shot = new Uint8Array(1048577);
		const resize = vi.fn(async () => {
			throw new Error('sharp missing');
		});
		const { c } = ctx({ a: [entity(ID_A, { screenshot: [{ _id: SHOT }] })], shot }, resize);
		const res = await callTool(c, 'get_feedback', { db: 'mvox_a', id: ID_A });
		expect(res.isError).toBe(true);
		expect(res.content).toHaveLength(2);
		expect(textOf(res).id).toBe(ID_A);
		expect(res.content[1]).toEqual({ type: 'text', text: 'screenshot not returned: sharp missing' });
	});

	it('a screenshot that cannot be fetched returns the report, a note and isError', async () => {
		const { c, resize } = ctx({
			a: [entity(ID_A, { screenshot: [{ _id: SHOT }] })],
			shot: new Uint8Array([1]),
			shotStatus: 403
		});
		const res = await callTool(c, 'get_feedback', { db: 'mvox_a', id: ID_A });
		expect(res.isError).toBe(true);
		expect(res.content).toHaveLength(2);
		expect(textOf(res).id).toBe(ID_A);
		expect(res.content[1]).toEqual({
			type: 'text',
			text: 'screenshot not returned: fetchBytes: HTTP 403'
		});
		expect(resize).not.toHaveBeenCalled();
	});

	it('description over 10000 chars is truncated with marker', async () => {
		const long = 'x'.repeat(10050);
		const { c } = ctx({ a: [entity(ID_A, { description: str(long) })] });
		const body = textOf(await callTool(c, 'get_feedback', { db: 'mvox_a', id: ID_A }));
		expect(body.description).toEqual({ user_submitted: `${'x'.repeat(10000)}[truncated]` });
	});

	it('count groups by the asked key', async () => {
		const meta = (detail: string) =>
			str(JSON.stringify({ problems: [{ action: 'save', detail }] }));
		const a = [
			entity(ID_A, { metadata: meta('TypeError: a') }),
			entity('a00000000000000000000002', { metadata: meta('TypeError: b') })
		];
		const { c } = ctx({ a });
		const body = textOf(await callTool(c, 'count_feedback', { by: 'firstError' }));
		expect(body).toEqual({
			by: 'firstError',
			total: 3,
			groups: [
				{ value: 'TypeError', count: 2 },
				{ value: '(none)', count: 1 }
			],
			errors: []
		});
	});

	it('every call logs team, tool and args but no description text', async () => {
		const { c, lines } = ctx();
		await callTool(c, 'get_feedback', { db: 'mvox_a', id: ID_A });
		await callTool(c, 'list_feedback', { kind: 'singer' });
		expect(lines).toHaveLength(2);
		expect(lines[0]).toMatch(/^\d{4}-\d{2}-\d{2}T\S+Z po-team get_feedback /);
		expect(lines[0]).toContain(ID_A);
		expect(lines[1]).toContain('list_feedback {"kind":"singer"}');
		for (const line of lines) expect(line).not.toContain(SECRET_TEXT);
	});

	it('bad args give isError, not a throw', async () => {
		const { c, lines } = ctx();
		const bad: [string, unknown][] = [
			['get_feedback', { db: '../x', id: ID_A }],
			['get_feedback', { db: 'mvox_a', id: 'abc?x=1' }],
			['get_feedback', { db: 'mvox_a' }],
			['list_feedback', { kind: 'robot' }],
			['list_feedback', { since: 'yesterday' }],
			['list_feedback', { untriaged: 'yes' }],
			['list_feedback', { surprise: 1 }],
			['list_feedback', 'not an object'],
			['count_feedback', { by: 'senderName' }],
			['nope', {}]
		];
		for (const [name, args] of bad) {
			const res = await callTool(c, name, args);
			expect(res.isError, `${name} ${JSON.stringify(args)}`).toBe(true);
			expect(res.content[0].type).toBe('text');
		}
		expect(lines).toHaveLength(bad.length);
	});

	it('a failing db is named in list and count results', async () => {
		const { c } = ctx({ failB: true });
		const errors = [{ db: 'mvox_b', message: 'mvox_b: auth failed: HTTP 403' }];
		const list = textOf(await callTool(c, 'list_feedback', {}));
		expect(list.errors).toEqual(errors);
		expect((list.reports as { id: string }[]).map((r) => r.id)).toEqual([ID_A]);
		const count = textOf(await callTool(c, 'count_feedback', { by: 'action' }));
		expect(count.errors).toEqual(errors);
	});
});
