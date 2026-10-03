// loadFeedback reads one feedback entity for FeedbackView.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { serialize, type StrokeData } from '$lib/strokes/strokes';
import { json, testCfg } from '$lib/testing/entuFetchKit';

vi.mock('$lib/entu-config', async () =>
	(await import('$lib/testing/routeMocks')).entuConfigModule()
);

import { loadFeedback } from './feedbackData';

const API = 'https://api.entu-test.invalid/';
const cfg = testCfg('sampledb');
const FB_ID = 'feedback-1';
const PROP_ID = 'screenshot-prop-1';
const SIGNED = 'https://s3.example.invalid/bucket/screenshot?sig=abc';
const STROKES: StrokeData = { v: 1, strokes: [{ pen: 'red', w: 0.004, pts: [0.1, 0.2, 0.3, 0.4] }] };

function entityBody(overrides: Record<string, unknown> = {}) {
	return {
		entity: {
			_id: FB_ID,
			screenshot: [{ _id: PROP_ID, filename: 'screenshot.png', filesize: 11, filetype: 'image/png' }],
			doodle_layer: [{ _id: 'dl-1', string: serialize(STROKES) }],
			description: [{ _id: 'd-1', string: 'Button is broken.' }],
			...overrides
		}
	};
}

function makeFetch(entity: Response = json(entityBody()), sign: Response = json({ url: SIGNED })) {
	return vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
		const url = String(input);
		if (url.startsWith(`${API}sampledb/entity/${FB_ID}`)) return entity;
		if (url === `${API}sampledb/property/${PROP_ID}`) return sign;
		throw new Error(`unexpected request: ${url}`);
	});
}

afterEach(() => {
	vi.restoreAllMocks();
});

describe('#395 loadFeedback — reads one feedback', () => {
	it('reads exactly the three fields, then signs the screenshot — two requests', async () => {
		const fetchImpl = makeFetch();
		await loadFeedback(cfg, FB_ID, fetchImpl);
		const urls = fetchImpl.mock.calls.map(([u]) => new URL(String(u)));
		expect(urls).toHaveLength(2);
		expect(urls[0].pathname).toBe(`/sampledb/entity/${FB_ID}`);
		expect(new Set(urls[0].searchParams.get('props')?.split(','))).toEqual(
			new Set(['screenshot', 'doodle_layer', 'description'])
		);
		expect(urls[1].pathname).toBe(`/sampledb/property/${PROP_ID}`);
	});

	it('returns the id, the signed screenshot url, the PARSED strokes and the description', async () => {
		const result = await loadFeedback(cfg, FB_ID, makeFetch());
		expect(result).toEqual({
			id: FB_ID,
			screenshotUrl: SIGNED,
			strokes: STROKES,
			description: 'Button is broken.'
		});
	});

	it('an ABSENT description reads as an empty string, it does not reject', async () => {
		const result = await loadFeedback(cfg, FB_ID, makeFetch(json(entityBody({ description: undefined }))));
		expect(result).toEqual({ id: FB_ID, screenshotUrl: SIGNED, strokes: STROKES, description: '' });
	});
});

describe('#395 loadFeedback — fails loudly', () => {
	it('a non-2xx read rejects', async () => {
		await expect(loadFeedback(cfg, FB_ID, makeFetch(json({}, 404)))).rejects.toThrow();
	});

	it('no screenshot property rejects', async () => {
		await expect(loadFeedback(cfg, FB_ID, makeFetch(json(entityBody({ screenshot: undefined }))))).rejects.toThrow();
	});

	it('a missing doodle_layer rejects', async () => {
		await expect(loadFeedback(cfg, FB_ID, makeFetch(json(entityBody({ doodle_layer: undefined }))))).rejects.toThrow();
	});

	it('a corrupt doodle_layer rejects (parse, no silent repair)', async () => {
		await expect(
			loadFeedback(cfg, FB_ID, makeFetch(json(entityBody({ doodle_layer: [{ _id: 'x', string: '{"v":2}' }] }))))
		).rejects.toThrow();
	});

	it('a signing failure rejects', async () => {
		await expect(loadFeedback(cfg, FB_ID, makeFetch(undefined, json({}, 403)))).rejects.toThrow();
	});
});

// (*MVOX:Tallis*)
