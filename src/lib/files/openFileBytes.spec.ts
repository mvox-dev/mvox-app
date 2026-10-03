// openFileBytes: the read-through seam between click handlers and the byte store.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/repertoire/fileUrls', async () =>
	(await import('$lib/testing/mocks/files')).fileUrlsModule()
);

import { openFileBytes } from './openFileBytes';
import { BYTE_STORE_CAP_BYTES } from './byteStore';
import { createFakeByteStore, type FakeByteStore } from '$lib/testing/byteStoreFakes';
import { testCfg } from '$lib/testing/entuFetchKit';
import { signFileUrlMock } from '$lib/testing/mocks/files';

const CFG = testCfg('sampledb', 'jwt-abc');
const A = { db: 'sampledb', personId: 'person-a' };

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

		await openFileBytes(CFG, A, 'file-new', store, fetchImpl as unknown as typeof fetch);

		expect(signFileUrlMock).toHaveBeenCalledTimes(2);
		expect(signFileUrlMock.mock.calls[1].slice(0, 2)).toEqual([CFG, 'file-new']);
		expect(String(fetchImpl.mock.calls[0][0])).toContain('signed-new');
		expect(store.heldFor(A.db, A.personId).sort()).toEqual(['file-new', 'file-old']);
	});
});

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
		releaseFetch(pdfResponse());
		await inFlight;

		expect(store.puts.length).toBe(1);
		expect(store.puts[0].identity).toEqual(A);
		expect(store.heldFor('sampledb', 'person-a')).toEqual(['file-1']);
		expect(store.heldFor('crede', 'person-a')).toEqual([]);
	});

	it('source pin: this module NEVER consults collective/auth state — identity is an argument or nothing', () => {
		const source = readFileSync(
			fileURLToPath(new URL('./openFileBytes.ts', import.meta.url)),
			'utf-8'
		);
		expect(source).not.toMatch(/selectedCollective/);
		expect(source).not.toMatch(/authStore|\$lib\/auth/);
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
