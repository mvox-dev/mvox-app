// #395 slice 2/2 RED — loadFeedback: read ONE feedback for FeedbackView.
//
// CONTRACT (GREEN implements src/lib/feedback/feedbackData.ts):
//
//   loadFeedback(cfg, feedbackId, fetchImpl?) → Promise<{
//     id: string; screenshotUrl: string; strokes: StrokeData; description: string
//   }>
//
//   1. GET entity/{feedbackId}?props=screenshot,doodle_layer,description via
//      entuFetch — only the three fields; no reference `.string` is ever read
//      (a reference `.string` bakes PII; `.reference` only, and only for rights).
//   2. GET property/{screenshotPropertyId} — the signed download url, via the
//      existing signFileUrl ($lib/repertoire/fileUrls), minted at read time.
//
//   strokes = parse(doodle_layer[0].string) (#394 strokes.ts);
//   description = description[0].string ?? '' — OPTIONAL on the type (review
//   round F1: an absent one is a screenshot-plus-ink feedback, not a broken
//   record, and the house pattern for optional text props is `?? ''`).
//   FAIL LOUDLY: non-2xx read, no screenshot property, missing or corrupt
//   doodle_layer, or a signing failure → reject.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EntuCfg } from '$lib/seasons/entuSeasons';
import { serialize, type StrokeData } from '$lib/strokes/strokes';

vi.mock('$lib/entu-config', () => ({ ENTU_API_BASE: 'https://api.entu-test.invalid/' }));

import { loadFeedback } from './feedbackData';

const API = 'https://api.entu-test.invalid/';
const cfg: EntuCfg = { db: 'sampledb', token: 'jwt' };
const FB_ID = 'feedback-1';
const PROP_ID = 'screenshot-prop-1';
const SIGNED = 'https://s3.example.invalid/bucket/screenshot?sig=abc';
const STROKES: StrokeData = { v: 1, strokes: [{ pen: 'red', w: 0.004, pts: [0.1, 0.2, 0.3, 0.4] }] };

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status });
}

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

	// REVIEW ROUND (#395, F1): `description` is OPTIONAL on the type
	// (mvox-schema-extensions.ts `feedback` — no `mandatory` on the field), so a
	// screenshot-plus-ink-and-no-words feedback is a schema-valid record. It
	// reads as '' — a throw here made such a submission permanently unviewable.
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
