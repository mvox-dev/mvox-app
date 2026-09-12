// #343 RED — openFileBytes: the read-through seam between the click handlers
// and the byte store. Default node env; the store is the in-memory fake
// (its own contract lives in byteStore.spec.ts), signFileUrl is module-mocked
// (its wire contract lives in fileUrls.spec.ts), the byte GET rides an
// explicit fetchImpl (the house seam — networkGuard forbids the default).
//
// Pinned contract:
//   - HIT: no signing, no network — stored bytes come back as a `blob:` URL.
//   - MISS: signFileUrl at CALL time (the 60s rule), fetch the bytes, compute
//     SHA-256 (the #333 hash-pin hook — crypto.subtle, recorded as stored
//     metadata; NO comparison logic), put under the identity ARGUMENT, return
//     a `blob:` URL. The signed URL is used once and never persisted.
//   - IDENTITY AT REQUEST-ISSUE: the identity is an explicit parameter
//     captured by the caller in the click handler. A fetch issued under A
//     that settles after the app switched to B stores under A, NEVER B — this
//     module has no access to "current" identity at settle time by
//     construction (source pin below). The consumer-side half (late tab
//     navigation suppressed) is pinned in the page wiring specs.
//   - OBJECT-URL DISPOSAL (review): a live `blob:` URL pins a full copy of
//     the score in page memory, so every open revokes the URL the previous
//     open of that SAME fileId returned (one live blob per distinct file, not
//     per click), and every open hands back a `release()` for the caller that
//     decides not to pass the URL on.
//   - PASSTHROUGH FRESHNESS (third review round): the paths that hand back a
//     signed URL instead of a blob hand back one still inside its 60s window —
//     an open that burned the window on a stalled fetch re-signs first.
//   - STALENESS IS STRUCTURAL: a replaced file arrives as a NEW file-property
//     _id (probe ledger scripts/migrations/seed-results/
//     probe-343-file-replace-identity-live-2026-09-12T07-56-06-582Z.json), so
//     a new fileId is simply a different key — fresh fetch, old row untouched.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { signFileUrlMock } = vi.hoisted(() => ({ signFileUrlMock: vi.fn() }));
vi.mock('$lib/repertoire/fileUrls', () => ({ signFileUrl: signFileUrlMock }));

import { openFileBytes } from './openFileBytes';
import { BYTE_STORE_CAP_BYTES } from './byteStore';
import { createFakeByteStore, type FakeByteStore } from '$lib/testing/byteStoreFakes';

const CFG = { db: 'polyphony', token: 'jwt-abc' };
const A = { db: 'polyphony', personId: 'person-a' };

const PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]); // "%PDF-1.7"
const SIGNED_URL = 'https://s3.example/signed-abc?X-Amz-Signature=deadbeef&X-Amz-Expires=60';

async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', bytes);
	return Array.from(new Uint8Array(digest))
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');
}

function pdfResponse(): Response {
	return new Response(PDF_BYTES.slice(), {
		status: 200,
		headers: { 'content-type': 'application/pdf' }
	});
}

let store: FakeByteStore;

beforeEach(() => {
	signFileUrlMock.mockReset();
	store = createFakeByteStore();
});

describe('openFileBytes — read-through', () => {
	it('opening twice signs ONCE and fetches ONCE — the second open serves stored bytes; both are blob: URLs', async () => {
		signFileUrlMock.mockResolvedValue(SIGNED_URL);
		const fetchImpl = vi.fn().mockResolvedValue(pdfResponse());

		const first = await openFileBytes(CFG, A, 'file-1', store, fetchImpl as unknown as typeof fetch);
		const second = await openFileBytes(CFG, A, 'file-1', store, fetchImpl as unknown as typeof fetch);

		expect(first.url).toMatch(/^blob:/);
		expect(second.url).toMatch(/^blob:/);
		expect(signFileUrlMock).toHaveBeenCalledTimes(1);
		expect(fetchImpl).toHaveBeenCalledTimes(1);
	});

	it('the miss path: signs at call time with the given cfg + fileId + fetchImpl, then GETs the signed URL', async () => {
		signFileUrlMock.mockResolvedValue(SIGNED_URL);
		const fetchImpl = vi.fn().mockResolvedValue(pdfResponse());

		await openFileBytes(CFG, A, 'file-1', store, fetchImpl as unknown as typeof fetch);

		expect(signFileUrlMock.mock.calls[0].slice(0, 2)).toEqual([CFG, 'file-1']);
		expect(signFileUrlMock.mock.calls[0][2]).toBe(fetchImpl);
		expect(String(fetchImpl.mock.calls[0][0])).toBe(SIGNED_URL);
	});

	it('OFFLINE: a part already in the store opens with the network down — fetch rejecting is never consulted on a hit', async () => {
		store.seed(A, 'file-1', {
			bytes: PDF_BYTES.slice().buffer,
			filetype: 'application/pdf',
			sha256: await sha256Hex(PDF_BYTES)
		});
		signFileUrlMock.mockRejectedValue(new Error('network down'));
		const fetchImpl = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));

		const opened = await openFileBytes(CFG, A, 'file-1', store, fetchImpl as unknown as typeof fetch);

		expect(opened.url).toMatch(/^blob:/);
		expect(signFileUrlMock).not.toHaveBeenCalled();
		expect(fetchImpl).not.toHaveBeenCalled();
	});

	it('what put() receives is bytes + filetype + sha256 — the signed URL string appears NOWHERE in it (asserted, not assumed)', async () => {
		signFileUrlMock.mockResolvedValue(SIGNED_URL);
		const fetchImpl = vi.fn().mockResolvedValue(pdfResponse());

		await openFileBytes(CFG, A, 'file-1', store, fetchImpl as unknown as typeof fetch);

		expect(store.puts.length).toBe(1);
		const put = store.puts[0];
		expect(Object.keys(put.data).sort()).toEqual(['bytes', 'filetype', 'sha256']);
		expect(put.data.filetype).toBe('application/pdf');
		const scan = JSON.stringify({ ...put, data: { ...put.data, bytes: undefined } });
		expect(scan).not.toContain('s3.example');
		expect(scan).not.toMatch(/X-Amz/i);
		expect(scan).not.toMatch(/https?:/i);
	});

	it('the stored sha256 IS the SHA-256 of the fetched bytes — computed, not copied from anywhere', async () => {
		signFileUrlMock.mockResolvedValue(SIGNED_URL);
		const fetchImpl = vi.fn().mockResolvedValue(pdfResponse());

		await openFileBytes(CFG, A, 'file-1', store, fetchImpl as unknown as typeof fetch);

		expect(store.puts[0].data.sha256).toBe(await sha256Hex(PDF_BYTES));
		expect(new Uint8Array(store.puts[0].data.bytes)).toEqual(PDF_BYTES);
	});

	it('STALENESS IS STRUCTURAL: a replace shows up as a NEW fileId — fresh fetch under the new key, old key not re-requested', async () => {
		signFileUrlMock.mockResolvedValueOnce('https://s3.example/signed-old?X-Amz-Expires=60');
		signFileUrlMock.mockResolvedValueOnce('https://s3.example/signed-new?X-Amz-Expires=60');
		const fetchImpl = vi.fn().mockResolvedValue(pdfResponse());

		await openFileBytes(CFG, A, 'file-old', store, fetchImpl as unknown as typeof fetch);
		fetchImpl.mockClear();
		fetchImpl.mockResolvedValue(pdfResponse());

		// The entity read now carries a new file _id (the replace shape).
		await openFileBytes(CFG, A, 'file-new', store, fetchImpl as unknown as typeof fetch);

		expect(signFileUrlMock).toHaveBeenCalledTimes(2);
		expect(signFileUrlMock.mock.calls[1].slice(0, 2)).toEqual([CFG, 'file-new']);
		expect(String(fetchImpl.mock.calls[0][0])).toContain('signed-new');
		// Both rows exist under their own keys; nobody validated or touched the old one.
		expect(store.heldFor(A.db, A.personId).sort()).toEqual(['file-new', 'file-old']);
	});
});

// #343 review — every open mints a `blob:` URL, and a live object URL pins a
// full copy of the score in page memory. The module head states the policy;
// this suite is what holds it. Each test uses its own fileIds: the
// one-live-url-per-fileId latch is module state and outlives a single `it`.
describe('openFileBytes — object-URL disposal', () => {
	let revokeSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		signFileUrlMock.mockResolvedValue(SIGNED_URL);
		revokeSpy = vi.spyOn(URL, 'revokeObjectURL');
	});

	afterEach(() => {
		revokeSpy.mockRestore();
	});

	it('re-opening the SAME file revokes the URL the previous open handed out — one live blob per file, not per click', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(pdfResponse());

		const first = await openFileBytes(CFG, A, 'file-same', store, fetchImpl as unknown as typeof fetch);
		expect(revokeSpy).not.toHaveBeenCalled();

		fetchImpl.mockResolvedValue(pdfResponse());
		const second = await openFileBytes(CFG, A, 'file-same', store, fetchImpl as unknown as typeof fetch);

		expect(revokeSpy.mock.calls).toEqual([[first.url]]);
		expect(second.url).not.toBe(first.url);
	});

	it('opening DIFFERENT files revokes nothing — the bound is one live URL per distinct file', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(pdfResponse());

		await openFileBytes(CFG, A, 'file-alto', store, fetchImpl as unknown as typeof fetch);
		fetchImpl.mockResolvedValue(pdfResponse());
		await openFileBytes(CFG, A, 'file-tenor', store, fetchImpl as unknown as typeof fetch);

		expect(revokeSpy).not.toHaveBeenCalled();
	});

	it('release() revokes the URL it came with — what a caller that will not hand the URL over must call', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(pdfResponse());

		const opened = await openFileBytes(CFG, A, 'file-released', store, fetchImpl as unknown as typeof fetch);
		opened.release();

		expect(revokeSpy.mock.calls).toEqual([[opened.url]]);
	});

	it('releasing a SUPERSEDED open does not cost the current one its disposal — the newer URL is still revoked on the next open', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(pdfResponse());

		const first = await openFileBytes(CFG, A, 'file-latch', store, fetchImpl as unknown as typeof fetch);
		const second = await openFileBytes(CFG, A, 'file-latch', store, fetchImpl as unknown as typeof fetch);
		// Late, redundant release of the one already superseded (revokes again —
		// revoking twice is a no-op — and must NOT clear `second`'s latch).
		first.release();
		revokeSpy.mockClear();

		await openFileBytes(CFG, A, 'file-latch', store, fetchImpl as unknown as typeof fetch);

		expect(revokeSpy.mock.calls).toEqual([[second.url]]);
	});
});

describe('openFileBytes — identity discipline', () => {
	it('null identity REJECTS before any network: no signing call, no fetch, nothing stored', async () => {
		const fetchImpl = vi.fn();

		await expect(
			openFileBytes(CFG, null, 'file-1', store, fetchImpl as unknown as typeof fetch)
		).rejects.toThrow(/identity/i);

		expect(signFileUrlMock).not.toHaveBeenCalled();
		expect(fetchImpl).not.toHaveBeenCalled();
		expect(store.puts).toEqual([]);
	});

	it('LATE SETTLE stores under the identity captured at ISSUE time — the argument, not any ambient current identity', async () => {
		signFileUrlMock.mockResolvedValue(SIGNED_URL);
		let releaseFetch!: (r: Response) => void;
		const fetchImpl = vi.fn().mockReturnValue(new Promise<Response>((r) => (releaseFetch = r)));

		const inFlight = openFileBytes(CFG, A, 'file-1', store, fetchImpl as unknown as typeof fetch);
		// The app has meanwhile switched to another identity. This module can
		// not see that — and must not be able to (source pin below).
		releaseFetch(pdfResponse());
		await inFlight;

		expect(store.puts.length).toBe(1);
		expect(store.puts[0].identity).toEqual(A);
		expect(store.heldFor('polyphony', 'person-a')).toEqual(['file-1']);
		expect(store.heldFor('crede', 'person-a')).toEqual([]);
	});

	it('source pin: this module NEVER consults collective/auth state — identity is an argument or nothing', () => {
		const source = readFileSync(
			fileURLToPath(new URL('./openFileBytes.ts', import.meta.url)),
			'utf-8'
		);
		expect(source).not.toMatch(/selectedCollective/);
		expect(source).not.toMatch(/authStore|\$lib\/auth/);
		// No ETag logic here either (comment-level statement lives in byteStore.ts).
		expect(source).not.toMatch(/headers\.get\(\s*['"`]etag/i);
	});
});

describe('openFileBytes — failure surfaces (rendered by the pages, raised here)', () => {
	it('a non-OK byte response is a loud failure, not stored garbage', async () => {
		signFileUrlMock.mockResolvedValue(SIGNED_URL);
		const fetchImpl = vi
			.fn()
			.mockResolvedValue(new Response('AccessDenied', { status: 403 }));

		await expect(
			openFileBytes(CFG, A, 'file-1', store, fetchImpl as unknown as typeof fetch)
		).rejects.toThrow(/403/);
		expect(store.puts).toEqual([]);
	});
});

// #343 fix-round — Gama's 1(b) ruling: the byte fetch rejecting no longer
// closes the door. It falls back to the signed URL already in hand (the
// exact pre-#343 path, not CORS-subject), reported as a distinct `reason` so
// nothing downstream mistakes a fallback for a cache hit.
describe('openFileBytes — fetch-reject fallback (#343 fix-round, Gama 1(b))', () => {
	it('a rejecting byte fetch resolves with the SIGNED URL itself, reason "fallback-navigation" — nothing stored, no throw', async () => {
		signFileUrlMock.mockResolvedValue(SIGNED_URL);
		const fetchImpl = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));

		const opened = await openFileBytes(CFG, A, 'file-1', store, fetchImpl as unknown as typeof fetch);

		expect(opened.url).toBe(SIGNED_URL);
		expect(opened.reason).toBe('fallback-navigation');
		expect(store.puts).toEqual([]);
	});

	it('release() on a fallback open is a harmless no-op — nothing was minted to revoke', async () => {
		signFileUrlMock.mockResolvedValue(SIGNED_URL);
		const fetchImpl = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
		const revokeSpy = vi.spyOn(URL, 'revokeObjectURL');

		const opened = await openFileBytes(CFG, A, 'file-1', store, fetchImpl as unknown as typeof fetch);
		expect(() => opened.release()).not.toThrow();

		expect(revokeSpy).not.toHaveBeenCalled();
		revokeSpy.mockRestore();
	});
});

// #343 fix-round — finding 2 + Gama's preference: decide from content-length
// BEFORE buffering, so an over-cap file never pays the buffer→Blob memory
// cost just to be refused.
describe('openFileBytes — cap decided before buffering (#343 fix-round, finding 2)', () => {
	it('content-length over the cap: no arrayBuffer() call, nothing stored, the SIGNED URL is handed back, reason "network-uncached" — distinguishable from a fetch-reject fallback', async () => {
		signFileUrlMock.mockResolvedValue(SIGNED_URL);
		const overCapLength = String(BYTE_STORE_CAP_BYTES + 1);
		const res = new Response(PDF_BYTES.slice(), {
			status: 200,
			headers: { 'content-type': 'application/pdf', 'content-length': overCapLength }
		});
		const arrayBufferSpy = vi.spyOn(res, 'arrayBuffer');
		const fetchImpl = vi.fn().mockResolvedValue(res);

		const opened = await openFileBytes(CFG, A, 'file-1', store, fetchImpl as unknown as typeof fetch);

		expect(arrayBufferSpy).not.toHaveBeenCalled();
		expect(store.puts).toEqual([]);
		expect(opened.url).toBe(SIGNED_URL);
		expect(opened.reason).toBe('network-uncached');
		expect(opened.reason).not.toBe('fallback-navigation');
	});

	it('content-length AT the cap (not over) still buffers and stores normally', async () => {
		signFileUrlMock.mockResolvedValue(SIGNED_URL);
		const res = new Response(PDF_BYTES.slice(), {
			status: 200,
			headers: { 'content-type': 'application/pdf', 'content-length': String(BYTE_STORE_CAP_BYTES) }
		});
		const fetchImpl = vi.fn().mockResolvedValue(res);

		const opened = await openFileBytes(CFG, A, 'file-1', store, fetchImpl as unknown as typeof fetch);

		expect(opened.reason).toBe('network-stored');
		expect(store.puts.length).toBe(1);
	});

	it('BELT — content-length absent/lying: buffering proceeds, the store\'s own cap throw (byteStore.ts) is caught, and the blob still delivers from the bytes already in hand, reason "network-uncached"', async () => {
		signFileUrlMock.mockResolvedValue(SIGNED_URL);
		const fetchImpl = vi.fn().mockResolvedValue(pdfResponse()); // no content-length header
		store.put = vi.fn().mockRejectedValue(new Error('byteStore: record exceeds the cap'));

		const opened = await openFileBytes(CFG, A, 'file-1', store, fetchImpl as unknown as typeof fetch);

		expect(opened.url).toMatch(/^blob:/);
		expect(opened.reason).toBe('network-uncached');
	});
});

// #343 second review round — the rule is that the cache INFRASTRUCTURE, not
// just cache policy, can never gate an open. Each `it` below is a way the
// cache side can fail on a device that could otherwise open the file fine;
// none of them may reach the page handlers' `.catch` (which closes the tab and
// raises the error surface).
describe('openFileBytes — the cache is never a gate (#343 second review round)', () => {
	it('a store READ that rejects (blocked site data, absent indexedDB, VersionError) degrades to a MISS — signs, fetches, and still opens', async () => {
		signFileUrlMock.mockResolvedValue(SIGNED_URL);
		store.get = vi.fn().mockRejectedValue(new DOMException('db blocked', 'VersionError'));
		const fetchImpl = vi.fn().mockResolvedValue(pdfResponse());

		const opened = await openFileBytes(CFG, A, 'file-deadread', store, fetchImpl as unknown as typeof fetch);

		expect(opened.url).toMatch(/^blob:/);
		expect(opened.reason).toBe('network-stored');
		expect(signFileUrlMock).toHaveBeenCalledTimes(1);
		expect(fetchImpl).toHaveBeenCalledTimes(1);
	});

	it('a store dead for BOTH read and write still opens the file — reported truthfully as "network-uncached", never as a hit', async () => {
		signFileUrlMock.mockResolvedValue(SIGNED_URL);
		const dead = new DOMException('db blocked', 'InvalidStateError');
		store.get = vi.fn().mockRejectedValue(dead);
		store.put = vi.fn().mockRejectedValue(dead);
		const fetchImpl = vi.fn().mockResolvedValue(pdfResponse());

		const opened = await openFileBytes(CFG, A, 'file-deadstore', store, fetchImpl as unknown as typeof fetch);

		expect(opened.url).toMatch(/^blob:/);
		expect(opened.reason).toBe('network-uncached');
		expect(opened.reason).not.toBe('cache');
	});

	it('NON-SECURE ORIGIN: crypto.subtle absent, so the digest cannot be computed — the bytes already in hand still deliver as a blob, reason "network-uncached", nothing stored', async () => {
		signFileUrlMock.mockResolvedValue(SIGNED_URL);
		const fetchImpl = vi.fn().mockResolvedValue(pdfResponse());
		// What a plain-http LAN/tailnet origin looks like: SubtleCrypto is
		// secure-context-only, so `crypto.subtle` is undefined there.
		vi.stubGlobal('crypto', {});

		try {
			const opened = await openFileBytes(CFG, A, 'file-nosubtle', store, fetchImpl as unknown as typeof fetch);
			expect(opened.url).toMatch(/^blob:/);
			expect(opened.reason).toBe('network-uncached');
		} finally {
			vi.unstubAllGlobals();
		}

		expect(store.puts).toEqual([]);
	});

	it('a BODY READ that rejects mid-stream hands back the signed URL still in hand, reason "fallback-navigation" — not a throw, not a discarded delivery', async () => {
		signFileUrlMock.mockResolvedValue(SIGNED_URL);
		const res = pdfResponse();
		vi.spyOn(res, 'arrayBuffer').mockRejectedValue(new TypeError('network error'));
		const fetchImpl = vi.fn().mockResolvedValue(res);

		const opened = await openFileBytes(CFG, A, 'file-bodydrop', store, fetchImpl as unknown as typeof fetch);

		expect(opened.url).toBe(SIGNED_URL);
		expect(opened.reason).toBe('fallback-navigation');
		expect(store.puts).toEqual([]);
	});
});

// #343 third review round, finding 2 — the three paths that hand the caller a
// signed URL instead of a blob may only hand over one that is still inside its
// 60s window. `fetch` has no default timeout, so a stalled rehearsal-hall
// connection can reject after MINUTES; handing over the expired URL then makes
// the open RESOLVE (the caller's error surface never fires) onto S3's raw
// AccessDenied XML. The clock is driven explicitly here — a controlled
// Date.now, not real elapsed time, so the pin is deterministic.
describe('openFileBytes — passthrough freshness (#343 third round, finding 2)', () => {
	const FRESH_URL = 'https://s3.example/signed-RESIGNED?X-Amz-Expires=60';
	let clock: number;
	let nowSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		clock = 1_700_000_000_000;
		nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => clock);
	});

	afterEach(() => {
		nowSpy.mockRestore();
	});

	it('a byte fetch that rejects only after the window burned re-signs FIRST — the caller never gets the expired URL', async () => {
		signFileUrlMock.mockResolvedValueOnce(SIGNED_URL).mockResolvedValueOnce(FRESH_URL);
		const fetchImpl = vi.fn().mockImplementation(async () => {
			clock += 90_000; // the stall: no fetch timeout exists to cut this short
			throw new TypeError('Failed to fetch');
		});

		const opened = await openFileBytes(CFG, A, 'file-1', store, fetchImpl as unknown as typeof fetch);

		expect(opened.url).toBe(FRESH_URL);
		expect(opened.url).not.toBe(SIGNED_URL);
		expect(opened.reason).toBe('fallback-navigation');
		expect(signFileUrlMock).toHaveBeenCalledTimes(2);
		expect(signFileUrlMock.mock.calls[1].slice(0, 2)).toEqual([CFG, 'file-1']);
	});

	it('a byte fetch that rejects FAST costs no extra signing call — the common degraded path is unchanged', async () => {
		signFileUrlMock.mockResolvedValueOnce(SIGNED_URL).mockResolvedValueOnce(FRESH_URL);
		const fetchImpl = vi.fn().mockImplementation(async () => {
			clock += 20; // the CORS TypeError case: immediate
			throw new TypeError('Failed to fetch');
		});

		const opened = await openFileBytes(CFG, A, 'file-1', store, fetchImpl as unknown as typeof fetch);

		expect(opened.url).toBe(SIGNED_URL);
		expect(signFileUrlMock).toHaveBeenCalledTimes(1);
	});

	it('a BODY READ that stalls past the window re-signs too — the slowest passthrough of the three', async () => {
		signFileUrlMock.mockResolvedValueOnce(SIGNED_URL).mockResolvedValueOnce(FRESH_URL);
		const res = pdfResponse();
		vi.spyOn(res, 'arrayBuffer').mockImplementation(async () => {
			clock += 120_000;
			throw new TypeError('network error');
		});
		const fetchImpl = vi.fn().mockResolvedValue(res);

		const opened = await openFileBytes(CFG, A, 'file-1', store, fetchImpl as unknown as typeof fetch);

		expect(opened.url).toBe(FRESH_URL);
		expect(opened.reason).toBe('fallback-navigation');
		expect(store.puts).toEqual([]);
	});

	it('an over-cap SKIP on a slow connection re-signs as well — the cap path hands over the same kind of URL', async () => {
		signFileUrlMock.mockResolvedValueOnce(SIGNED_URL).mockResolvedValueOnce(FRESH_URL);
		const fetchImpl = vi.fn().mockImplementation(async () => {
			clock += 75_000;
			return new Response(PDF_BYTES.slice(), {
				status: 200,
				headers: {
					'content-type': 'application/pdf',
					'content-length': String(BYTE_STORE_CAP_BYTES + 1)
				}
			});
		});

		const opened = await openFileBytes(CFG, A, 'file-1', store, fetchImpl as unknown as typeof fetch);

		expect(opened.url).toBe(FRESH_URL);
		expect(opened.reason).toBe('network-uncached');
	});

	it('a re-sign that itself fails is LOUD — better the page error surface than a tab full of AccessDenied XML', async () => {
		signFileUrlMock
			.mockResolvedValueOnce(SIGNED_URL)
			.mockRejectedValueOnce(new Error('signFileUrl: file file-1 signing failed: 401'));
		const fetchImpl = vi.fn().mockImplementation(async () => {
			clock += 90_000;
			throw new TypeError('Failed to fetch');
		});

		await expect(
			openFileBytes(CFG, A, 'file-1', store, fetchImpl as unknown as typeof fetch)
		).rejects.toThrow(/signing failed/);
		expect(store.puts).toEqual([]);
	});
});

describe('openFileBytes — delivery reason on the happy paths (#343 fix-round, ruling condition 1)', () => {
	it('a store HIT reports "cache" — a network MISS that stores reports "network-stored"; the two are distinct', async () => {
		signFileUrlMock.mockResolvedValue(SIGNED_URL);
		const fetchImpl = vi.fn().mockResolvedValue(pdfResponse());

		const miss = await openFileBytes(CFG, A, 'file-1', store, fetchImpl as unknown as typeof fetch);
		expect(miss.reason).toBe('network-stored');

		const hit = await openFileBytes(CFG, A, 'file-1', store, fetchImpl as unknown as typeof fetch);
		expect(hit.reason).toBe('cache');
		expect(hit.reason).not.toBe(miss.reason);
	});
});

// (*MVOX:Tallis*)
