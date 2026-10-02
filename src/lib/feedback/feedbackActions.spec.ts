// createFeedback: type lookup, entity create, screenshot upload, cleanup on any failure.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetTypeIdCache } from '$lib/seasons/entuSeasons';
import { serialize, type StrokeData } from '$lib/strokes/strokes';
import { json, testCfg } from '$lib/testing/entuFetchKit';

vi.mock('$lib/entu-config', () => ({ ENTU_API_BASE: 'https://api.entu-test.invalid/' }));

import { createFeedback } from './feedbackActions';

const API = 'https://api.entu-test.invalid/';
const cfg = testCfg('sampledb', 'member-own-jwt');
const MEMBER_ID = 'member-42';
const TYPE_ID = 'type-feedback-1';
const NEW_ID = 'feedback-new-1';
const PROP_ID = 'screenshot-prop-1';
const PAGE_PATH = '/events/6a7cc04e23dc1d97bb8f203b';
const DESCRIPTION = 'The save button does nothing on my phone.';

const STROKES: StrokeData = {
	v: 1,
	strokes: [
		{ pen: 'red', w: 0.004, pts: [0.1, 0.1, 0.5, 0.5] },
		{ pen: 'black', w: 0.004, pts: [0.2, 0.8, 0.9, 0.8], p: [0.5, 0.7] }
	]
};

const SCREENSHOT_BYTES = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
function screenshotBlob(): Blob {
	return new Blob([SCREENSHOT_BYTES], { type: 'image/png' });
}

const UPLOAD = {
	url: 'https://s3.example.invalid/bucket/screenshot?signature=sig-1',
	method: 'PUT',
	headers: {
		ACL: 'private',
		'Content-Disposition': 'inline;filename="screenshot.png"',
		'Content-Length': SCREENSHOT_BYTES.length,
		'Content-Type': 'image/png'
	}
};

type Leg = 'type' | 'create' | 'meta' | 'put' | 'delete';
type Routes = Partial<Record<Leg, Response | Error>>;

function legOf(url: string, method: string): Leg {
	if (method === 'GET' && url.includes('_type.string=entity')) return 'type';
	if (method === 'POST' && url === `${API}sampledb/entity`) return 'create';
	if (method === 'POST' && url === `${API}sampledb/entity/${NEW_ID}`) return 'meta';
	if (method === 'PUT') return 'put';
	if (method === 'DELETE') return 'delete';
	throw new Error(`unexpected request: ${method} ${url}`);
}

function defaultFor(leg: Leg): Response {
	switch (leg) {
		case 'type':
			return json({ entities: [{ _id: TYPE_ID }] });
		case 'create':
			return json({ _id: NEW_ID });
		case 'meta':
			return json({
				_id: NEW_ID,
				properties: [
					{
						_id: PROP_ID,
						type: 'screenshot',
						filename: 'screenshot.png',
						filesize: SCREENSHOT_BYTES.length,
						filetype: 'image/png',
						upload: UPLOAD
					}
				]
			});
		case 'put':
			return new Response('', { status: 200 });
		case 'delete':
			return json({ deleted: true });
	}
}

function makeFetch(routes: Routes = {}) {
	return vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
		const leg = legOf(String(input), init?.method ?? 'GET');
		const r = routes[leg] ?? defaultFor(leg);
		if (r instanceof Error) throw r;
		return r;
	});
}

function input() {
	return { screenshot: screenshotBlob(), strokes: STROKES, description: DESCRIPTION, pagePath: PAGE_PATH };
}

beforeEach(() => {
	resetTypeIdCache();
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(new Date('2026-09-29T10:15:00Z'));
});

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

describe('#395 createFeedback — the happy path issues exactly the expected requests, in order', () => {
	it('resolves the type, creates the entity, posts the screenshot metadata, PUTs the bytes — and nothing else', async () => {
		const fetchImpl = makeFetch();
		const id = await createFeedback(cfg, MEMBER_ID, input(), fetchImpl);

		expect(id).toBe(NEW_ID);
		const calls = fetchImpl.mock.calls.map(([u, i]) => [i?.method ?? 'GET', String(u)]);
		expect(calls).toEqual([
			['GET', `${API}sampledb/entity?_type.string=entity&name.string=feedback&props=_id&limit=1`],
			['POST', `${API}sampledb/entity`],
			['POST', `${API}sampledb/entity/${NEW_ID}`],
			['PUT', UPLOAD.url]
		]);
	});

	it('the create POST body is EXACTLY _type ref + _parent member + name (no rights fields, #699) + description + serialized doodle_layer', async () => {
		const fetchImpl = makeFetch();
		await createFeedback(cfg, MEMBER_ID, input(), fetchImpl);

		const [, createInit] = fetchImpl.mock.calls[1];
		expect(JSON.parse(String(createInit?.body))).toEqual([
			{ type: '_type', reference: TYPE_ID },
			{ type: '_parent', reference: MEMBER_ID },
			{ type: 'name', string: `${PAGE_PATH} 2026-09-29` },
			{ type: 'description', string: DESCRIPTION },
			{ type: 'doodle_layer', string: serialize(STROKES) }
		]);
	});

	it('the name never carries the description text (name ruling, Gama 2026-09-29)', async () => {
		const fetchImpl = makeFetch();
		await createFeedback(cfg, MEMBER_ID, input(), fetchImpl);
		const body = JSON.parse(String(fetchImpl.mock.calls[1][1]?.body)) as Array<{ type: string; string?: string }>;
		const name = body.find((p) => p.type === 'name')?.string ?? '';
		expect(name).not.toContain('save button');
	});

	it("every Entu request carries the member's own token (creator kind 'self')", async () => {
		const fetchImpl = makeFetch();
		await createFeedback(cfg, MEMBER_ID, input(), fetchImpl);
		for (const [u, init] of fetchImpl.mock.calls.slice(0, 3)) {
			expect(String(u).startsWith(API)).toBe(true);
			expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer member-own-jwt');
		}
	});

	it('the metadata POST names the `screenshot` property with the blob size and type', async () => {
		const fetchImpl = makeFetch();
		await createFeedback(cfg, MEMBER_ID, input(), fetchImpl);
		const [, metaInit] = fetchImpl.mock.calls[2];
		expect(JSON.parse(String(metaInit?.body))).toEqual([
			{ type: 'screenshot', filename: 'screenshot.png', filesize: SCREENSHOT_BYTES.length, filetype: 'image/png' }
		]);
	});

	it('the PUT goes to the signed url with EXACTLY the returned headers and the screenshot bytes', async () => {
		const fetchImpl = makeFetch();
		const blob = screenshotBlob();
		await createFeedback(cfg, MEMBER_ID, { ...input(), screenshot: blob }, fetchImpl);
		const [url, putInit] = fetchImpl.mock.calls[3];
		expect(String(url)).toBe(UPLOAD.url);
		expect(putInit?.method).toBe('PUT');
		expect(putInit?.headers).toEqual(UPLOAD.headers);
		expect(putInit?.body).toBe(blob);
	});
});

describe('#395 createFeedback — any failed step rejects (fail loudly, no partial success)', () => {
	it('type resolution failure rejects and nothing is created', async () => {
		const fetchImpl = makeFetch({ type: json({ entities: [] }) });
		await expect(createFeedback(cfg, MEMBER_ID, input(), fetchImpl)).rejects.toThrow();
		expect(fetchImpl.mock.calls.some(([, i]) => i?.method === 'POST')).toBe(false);
	});

	it('a non-2xx create rejects and no upload is attempted', async () => {
		const fetchImpl = makeFetch({ create: json({ error: 'forbidden' }, 403) });
		await expect(createFeedback(cfg, MEMBER_ID, input(), fetchImpl)).rejects.toThrow(/403/);
		expect(fetchImpl).toHaveBeenCalledTimes(2);
	});

	it('a 2xx create without _id rejects (apparent-success trap)', async () => {
		const fetchImpl = makeFetch({ create: json({}) });
		await expect(createFeedback(cfg, MEMBER_ID, input(), fetchImpl)).rejects.toThrow();
		expect(fetchImpl).toHaveBeenCalledTimes(2);
	});

	it('a non-2xx metadata POST rejects', async () => {
		const fetchImpl = makeFetch({ meta: json({ error: 'nope' }, 500) });
		await expect(createFeedback(cfg, MEMBER_ID, input(), fetchImpl)).rejects.toThrow();
		expect(fetchImpl.mock.calls.some(([, i]) => i?.method === 'PUT')).toBe(false);
	});

	it('a metadata envelope with no usable upload object rejects', async () => {
		const fetchImpl = makeFetch({ meta: json({ _id: NEW_ID, properties: { screenshot: [] } }) });
		await expect(createFeedback(cfg, MEMBER_ID, input(), fetchImpl)).rejects.toThrow();
	});

	it('a non-2xx PUT rejects, after DELETEing the phantom screenshot property', async () => {
		const fetchImpl = makeFetch({ put: new Response('denied', { status: 403 }) });
		await expect(createFeedback(cfg, MEMBER_ID, input(), fetchImpl)).rejects.toThrow();
		const del = fetchImpl.mock.calls.find(([, i]) => i?.method === 'DELETE');
		expect(del && String(del[0])).toBe(`${API}sampledb/property/${PROP_ID}`);
	});

	it('a network error on the PUT rejects', async () => {
		const fetchImpl = makeFetch({ put: new TypeError('network down') });
		await expect(createFeedback(cfg, MEMBER_ID, input(), fetchImpl)).rejects.toThrow();
	});
});

describe('#395 createFeedback — a failure after the create DELETEs the half-built entity', () => {
	function entityDeletes(fetchImpl: ReturnType<typeof makeFetch>): string[] {
		return fetchImpl.mock.calls
			.filter(([, i]) => i?.method === 'DELETE')
			.map(([u]) => String(u))
			.filter((u) => u === `${API}sampledb/entity/${NEW_ID}`);
	}

	it('a non-2xx metadata POST deletes the new feedback entity', async () => {
		const fetchImpl = makeFetch({ meta: json({ error: 'nope' }, 500) });
		await expect(createFeedback(cfg, MEMBER_ID, input(), fetchImpl)).rejects.toThrow();
		expect(entityDeletes(fetchImpl)).toEqual([`${API}sampledb/entity/${NEW_ID}`]);
	});

	it('a metadata envelope with no usable upload object deletes the new feedback entity', async () => {
		const fetchImpl = makeFetch({ meta: json({ _id: NEW_ID, properties: { screenshot: [] } }) });
		await expect(createFeedback(cfg, MEMBER_ID, input(), fetchImpl)).rejects.toThrow();
		expect(entityDeletes(fetchImpl)).toEqual([`${API}sampledb/entity/${NEW_ID}`]);
	});

	it('a non-2xx PUT deletes the phantom property AND the new feedback entity, in that order', async () => {
		const fetchImpl = makeFetch({ put: new Response('denied', { status: 403 }) });
		await expect(createFeedback(cfg, MEMBER_ID, input(), fetchImpl)).rejects.toThrow();
		const deletes = fetchImpl.mock.calls.filter(([, i]) => i?.method === 'DELETE').map(([u]) => String(u));
		expect(deletes).toEqual([`${API}sampledb/property/${PROP_ID}`, `${API}sampledb/entity/${NEW_ID}`]);
	});

	it('a network error on the PUT deletes the new feedback entity too', async () => {
		const fetchImpl = makeFetch({ put: new TypeError('network down') });
		await expect(createFeedback(cfg, MEMBER_ID, input(), fetchImpl)).rejects.toThrow();
		expect(entityDeletes(fetchImpl)).toEqual([`${API}sampledb/entity/${NEW_ID}`]);
	});

	it('a failing cleanup never masks the real error', async () => {
		const fetchImpl = makeFetch({
			put: new Response('denied', { status: 403 }),
			delete: new TypeError('cleanup connection lost')
		});
		await expect(createFeedback(cfg, MEMBER_ID, input(), fetchImpl)).rejects.toThrow(/screenshot upload failed/);
	});
});

describe('#395 createFeedback — an empty description is OMITTED, not posted empty', () => {
	it('the create body carries no `description` entry at all', async () => {
		const fetchImpl = makeFetch();
		await createFeedback(cfg, MEMBER_ID, { ...input(), description: '' }, fetchImpl);
		expect(JSON.parse(String(fetchImpl.mock.calls[1][1]?.body))).toEqual([
			{ type: '_type', reference: TYPE_ID },
			{ type: '_parent', reference: MEMBER_ID },
			{ type: 'name', string: `${PAGE_PATH} 2026-09-29` },
			{ type: 'doodle_layer', string: serialize(STROKES) }
		]);
	});
});

// (*MVOX:Tallis*)
