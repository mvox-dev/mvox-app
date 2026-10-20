// The Entu client only reads: every request is a GET, and a revoked key fails one db, not all.
import { describe, expect, it } from 'vitest';
import { EntuReader } from './src/entu.ts';

const ID = '0123456789abcdef01234567';
const FILE_ID = 'abcdefabcdefabcdefabcdef';
const FEEDBACK = [{ string: 'feedback' }];
const dbs = [
	{ db: 'mvox_a', label: 'A', key: 'key-a' },
	{ db: 'mvox_b', label: 'B', key: 'key-b' }
];

type Call = { url: string; init: RequestInit | undefined };
type Route = (url: string, n: number) => Response | undefined;

const json = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const entities = (n: number, from = 0) =>
	Array.from({ length: n }, (_, i) => ({ _id: (from + i).toString(16).padStart(24, '0') }));

// Answers auth with a token, then defers to `route`; records every call.
function recorder(route: Route = () => undefined) {
	const calls: Call[] = [];
	const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = String(input);
		calls.push({ url, init });
		const answer = route(url, calls.length);
		if (answer) return answer;
		if (url.includes('/auth?db=')) return json({ token: `tok-${url.split('db=')[1]}` });
		if (url.includes('/entity?')) return json({ entities: entities(2), count: 2 });
		if (url.includes(`/entity/${ID}`)) return json({ entity: { _id: ID, _type: FEEDBACK } });
		if (url.includes(`/property/${FILE_ID}`)) return json({ url: 'https://files.example/s.png' });
		if (url === 'https://files.example/s.png') return new Response(new Uint8Array([1, 2, 3]));
		return json({}, 404);
	}) as typeof fetch;
	const auths = () => calls.filter((c) => c.url.includes('/auth?db='));
	const lists = () => calls.filter((c) => c.url.includes('/entity?'));
	return { calls, fetchImpl, auths, lists };
}

describe('EntuReader', () => {
	it('every request is GET', async () => {
		const r = recorder();
		const reader = new EntuReader(dbs, r.fetchImpl);
		await reader.listFeedback('mvox_a');
		await reader.getFeedback('mvox_a', ID);
		const url = await reader.signFile('mvox_a', FILE_ID);
		expect(await reader.fetchBytes(url)).toEqual(new Uint8Array([1, 2, 3]));
		await reader.listAll();
		expect(r.calls.length).toBeGreaterThanOrEqual(7);
		for (const c of r.calls) {
			expect([undefined, 'GET'], c.url).toContain(c.init?.method);
			expect(c.init?.body, c.url).toBeUndefined();
		}
	});

	it('sends the key to auth and the token to reads', async () => {
		const r = recorder();
		await new EntuReader(dbs, r.fetchImpl).listFeedback('mvox_a');
		const header = (c: Call) => new Headers(c.init?.headers).get('authorization');
		expect(r.calls[0].url).toBe('https://api.entu.app/auth?db=mvox_a');
		expect(header(r.calls[0])).toBe('Bearer key-a');
		expect(r.calls[1].url).toBe(
			'https://api.entu.app/mvox_a/entity?_type.string=feedback' +
				'&props=name,description,metadata,doodle_layer,screenshot,issue_url,_parent,_created' +
				'&limit=100&skip=0'
		);
		expect(header(r.calls[1])).toBe('Bearer tok-mvox_a');
	});

	it('pages until a short page', async () => {
		const r = recorder((url) => {
			if (url.includes('skip=0')) return json({ entities: entities(100), count: 103 });
			if (url.includes('skip=100')) return json({ entities: entities(3, 100), count: 103 });
		});
		const list = await new EntuReader(dbs, r.fetchImpl).listFeedback('mvox_a');
		expect(list).toHaveLength(103);
		expect(r.lists().map((c) => new URL(c.url).searchParams.get('skip'))).toEqual(['0', '100']);
	});

	it('401 re-auths once', async () => {
		const once = recorder((url, n) =>
			url.includes('/entity?') && n === 2 ? json({}, 401) : undefined
		);
		const list = await new EntuReader(dbs, once.fetchImpl).listFeedback('mvox_a');
		expect(list).toHaveLength(2);
		expect(once.auths()).toHaveLength(2);
		expect(once.lists()).toHaveLength(2);

		const always = recorder((url) => (url.includes('/entity?') ? json({}, 401) : undefined));
		await expect(new EntuReader(dbs, always.fetchImpl).listFeedback('mvox_a')).rejects.toThrow(
			/401/
		);
		expect(always.auths()).toHaveLength(2);
		expect(always.lists()).toHaveLength(2);
	});

	it('a failing db is reported, others still list', async () => {
		const r = recorder((url) => (url.endsWith('/auth?db=mvox_b') ? json({}, 403) : undefined));
		const { results, errors } = await new EntuReader(dbs, r.fetchImpl).listAll();
		expect(results.map((x) => x.db)).toEqual(['mvox_a']);
		expect(results[0].entities).toHaveLength(2);
		expect(errors).toHaveLength(1);
		expect(errors[0].db).toBe('mvox_b');
		expect(errors[0].message).toMatch(/403/);
	});

	it('token cached per db', async () => {
		const r = recorder();
		const reader = new EntuReader(dbs, r.fetchImpl);
		await reader.listFeedback('mvox_a');
		await reader.listFeedback('mvox_a');
		expect(r.auths()).toHaveLength(1);
		await reader.listFeedback('mvox_b');
		expect(r.auths()).toHaveLength(2);
	});

	it('rejects an unlisted db or bad id before any fetch', async () => {
		const r = recorder();
		const reader = new EntuReader(dbs, r.fetchImpl);
		await expect(reader.listFeedback('../x')).rejects.toThrow(/unknown db/);
		await expect(reader.getFeedback('mvox_a', 'abc?x=1')).rejects.toThrow(/bad id/);
		await expect(reader.signFile('mvox_a', '../../auth')).rejects.toThrow(/bad id/);
		await expect(reader.fetchBytes('http://files.example/s.png')).rejects.toThrow(/https/);
		expect(r.calls).toEqual([]);
	});

	it('getFeedback returns the entity and signFile its url', async () => {
		const r = recorder();
		const reader = new EntuReader(dbs, r.fetchImpl);
		expect(await reader.getFeedback('mvox_a', ID)).toEqual({ _id: ID, _type: FEEDBACK });
		expect(r.calls[1].url).toMatch(new RegExp(`^https://api.entu.app/mvox_a/entity/${ID}\\?props=`));
		expect(await reader.signFile('mvox_a', FILE_ID)).toBe('https://files.example/s.png');
		expect(r.calls[2].url).toBe(`https://api.entu.app/mvox_a/property/${FILE_ID}`);
	});

	it('getFeedback refuses an entity that is not a feedback', async () => {
		const r = recorder((url) =>
			url.includes(`/entity/${ID}`)
				? json({ entity: { _id: ID, _type: [{ string: 'person' }], name: [{ string: 'X' }] } })
				: undefined
		);
		await expect(new EntuReader(dbs, r.fetchImpl).getFeedback('mvox_a', ID)).rejects.toThrow(
			/no feedback/
		);
	});
});
