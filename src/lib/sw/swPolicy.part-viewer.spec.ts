// The pdf.js worker rides the shell precache: no $service-worker array is sure to name it.
import { describe, expect, it } from 'vitest';
import { decideFetch, precacheUrls, splitPrecache } from './swPolicy';

const ORIGIN = 'https://mvox.eu';

function get(url: string, mode = 'no-cors') {
	return { url, method: 'GET', mode };
}

describe('#427 — the pdf.js worker rides the shell precache (a cold offline start must still render a part)', () => {
	it('extra assets land in the list between files and the two hand-added urls — full shape', () => {
		const build = ['/_app/immutable/entry/start.abc123.js'];
		const files = ['/robots.txt'];
		const worker = '/_app/immutable/assets/pdf.worker.C0ffee.mjs';
		expect(precacheUrls({ build, files, extra: [worker] })).toEqual([
			...build,
			...files,
			worker,
			'/',
			'/_app/env.js'
		]);
	});

	// addAll rejects a duplicate request, which fails the install; the build already names the worker.
	it('an extra asset ALREADY named by build appears exactly ONCE — a duplicate would fail cache.addAll and wedge the install', () => {
		const worker = '/_app/immutable/assets/pdf.worker.C0ffee.mjs';
		const build = ['/_app/immutable/entry/start.abc123.js', worker];
		const files = ['/robots.txt'];
		const list = precacheUrls({ build, files, extra: [worker] });
		expect(list).toEqual([
			'/_app/immutable/entry/start.abc123.js',
			worker,
			'/robots.txt',
			'/',
			'/_app/env.js'
		]);
		expect(list.filter((u) => u === worker)).toEqual([worker]);
		expect(new Set(list).size).toBe(list.length);
	});

	// The worker is a same-origin build asset; Entu API and bytes-bucket URLs still bypass.
	it('precaching the worker does not soften the fence — a signed bytes URL still bypasses', () => {
		const worker = '/_app/immutable/assets/pdf.worker.C0ffee.mjs';
		const ctx = { origin: ORIGIN, precached: ['/', '/_app/env.js', worker] };
		expect(decideFetch(get(`${ORIGIN}${worker}`), ctx)).toEqual({ kind: 'cache-first' });
		expect(
			decideFetch(
				get(
					'https://entu-files.fra1.digitaloceanspaces.com/sampledb/file.pdf?X-Amz-Signature=deadbeef'
				),
				ctx
			)
		).toEqual({ kind: 'bypass' });
	});
});

describe('#427 review round 3, finding 2 — the install list splits: a heavy asset may miss, the app still installs', () => {
	const WORKER = '/_app/immutable/assets/pdf.worker.C0ffee.mjs';
	const ENTRY = '/_app/immutable/entry/start.abc123.js';
	const NODE = '/_app/immutable/nodes/14.d00d.js';

	it('splits into the core the app cannot start without and the per-route tail — full shape, order preserved', () => {
		const list = precacheUrls({ build: [ENTRY, NODE], files: ['/robots.txt'], extra: [WORKER] });
		expect(splitPrecache(list)).toEqual({
			required: [ENTRY, '/robots.txt', '/', '/_app/env.js'],
			optional: [NODE, WORKER]
		});
	});

	it("'/' and '/_app/env.js' are ALWAYS required — a cold offline navigation dies before any app code runs without them", () => {
		const { required, optional } = splitPrecache([WORKER, '/', '/_app/env.js']);
		expect(required).toEqual(['/', '/_app/env.js']);
		expect(optional).toEqual([WORKER]);
	});

	it('every url lands in exactly one half — nothing is dropped and nothing is precached twice', () => {
		const list = precacheUrls({ build: [ENTRY, NODE], files: ['/robots.txt'], extra: [WORKER] });
		const { required, optional } = splitPrecache(list);
		expect([...required, ...optional].sort()).toEqual([...list].sort());
		expect(new Set([...required, ...optional]).size).toBe(list.length);
	});
});

// (*MVOX:Tallis* — #427 RED; *MVOX:Josquin*)
