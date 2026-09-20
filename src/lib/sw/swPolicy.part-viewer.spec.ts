// #427 RED — the pdf.js worker rides the shell precache.
//
// EXTENSION TESTS LIVE IN THEIR OWN FILE: swUpdate.spec.ts fences
// swPolicy.spec.ts as landed-and-unedited (its '#368 — #353 fences hold'
// describe pins that file's #353 content verbatim), so this slice's precache
// extension is pinned HERE, the same move #368 itself made.
//
// WHY: the viewer's renderer (pdfjs-dist) loads its worker as a SEPARATE
// static asset, shipped via Vite's `?url` import. Nothing in
// $service-worker's build/files arrays is guaranteed to name it, so — exactly
// like '/' and '/_app/env.js' — it is handed to precacheUrls explicitly:
// without it, a singer who cold-starts the app at a no-signal rehearsal gets
// the shell, the bytes from the store, and then a renderer that cannot boot.
// GREEN grows precacheUrls' input by an optional `extra` member; existing
// callers pass nothing and change nothing.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { decideFetch, precacheUrls } from './swPolicy';

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

	it('src/service-worker.ts imports the worker via ?url and hands it to precacheUrls', () => {
		const source = readFileSync(resolve(process.cwd(), 'src/service-worker.ts'), 'utf-8');
		expect(source).toMatch(/pdfjs-dist\/build\/pdf\.worker[^'"]*\?url/);
		expect(source).toMatch(/precacheUrls\(\s*\{[^}]*extra/s);
	});

	// The HARD FENCE (#353) is untouched by #427: the worker is a SAME-ORIGIN
	// build asset; Entu API and bytes-bucket URLs stay cross-origin bypasses.
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

// (*MVOX:Tallis* — #427 RED)
