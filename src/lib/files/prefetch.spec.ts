// #409 RED — prefetchNextEventParts: the opportunistic-while-open byte
// prefetch for the next event's parts (epic #334's standing constraint:
// every byte fetch runs on HER OWN key, while the app is open — never in the
// background while away; the no-wake-hooks half of that constraint is pinned
// in page.works-wiring.spec.ts, this file pins the fetch mechanics).
//
// Pinned contract — prefetchNextEventParts(cfg, identity, fileIds, store,
// fetchImpl, isCurrent) resolves to per-file results `{ fileId, outcome }`:
//   - HELD PARTS ARE SKIPPED, and the skip is decided from ONE
//     store.heldFileIds(db, personId) call — keys only, so a prefetch NEVER
//     counts as an open (mirrors byteStore.presence.spec.ts:76's trap: no
//     adapter.touch, no re-put, no stamp moved, no get()). outcome: 'held'.
//   - MISSING PARTS go through openFileBytes — the ONE read-through seam —
//     SEQUENTIALLY: the next part's signFileUrl happens only after the
//     previous part's put resolved. No parallel S3 storms on app open.
//     outcome: openFileBytes' own delivery reason ('network-stored' etc.).
//   - EVERY MINTED BLOB URL IS RELEASED: nothing consumes a prefetched URL
//     (there is no tab), and openFileBytes' OBJECT-URL OWNERSHIP rule 2 says
//     an unconsumed URL is its caller's leak. release() per open, always.
//   - IDENTITY: `isCurrent` is consulted at each settle; the moment it
//     answers false the walk STOPS — no further part is signed, nothing is
//     ever put under an identity the fetch was not issued for (openFileBytes
//     already stores under the ISSUING identity by construction).
//   - NEVER THROWS: a failed part (signing rejected) is a RESULT
//     (outcome: 'failed'), not a raise, and the walk continues; a byte fetch
//     that rejects resolves through openFileBytes as 'fallback-navigation'
//     (nothing stored) and the walk continues. A null identity resolves []
//     — the page guards identity, but a race must degrade silently, not
//     take the load chain down.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { signFileUrlMock } = vi.hoisted(() => ({ signFileUrlMock: vi.fn() }));
vi.mock('$lib/repertoire/fileUrls', () => ({ signFileUrl: signFileUrlMock }));

import { prefetchNextEventParts } from './prefetch';
import { createByteStore } from './byteStore';
import {
	createFakeAdapter,
	createFakeByteStore,
	type FakeAdapter,
	type FakeByteStore
} from '$lib/testing/byteStoreFakes';

const CFG = { db: 'polyphony', token: 'jwt-abc' };
const A = { db: 'polyphony', personId: 'person-a' };

const PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]); // "%PDF-1.7"

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

/** Signs per-file distinct urls and answers bytes for them — the happy path. */
function happySigning() {
	signFileUrlMock.mockImplementation(
		async (_cfg: unknown, fileId: string) => `https://s3.example/signed-${fileId}`
	);
	return vi.fn(async (_input: RequestInfo | URL) => pdfResponse());
}

let store: FakeByteStore;

beforeEach(() => {
	signFileUrlMock.mockReset();
	store = createFakeByteStore();
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe('#409 — prefetchNextEventParts: missing parts are fetched and stored', () => {
	it('a missing part is signed, fetched and stored — full-shape put under the given identity, and the minted blob URL is RELEASED', async () => {
		const fetchImpl = happySigning();
		const createSpy = vi.spyOn(URL, 'createObjectURL');
		const revokeSpy = vi.spyOn(URL, 'revokeObjectURL');

		const results = await prefetchNextEventParts(
			CFG,
			A,
			['file-1'],
			store,
			fetchImpl as unknown as typeof fetch,
			() => true
		);

		expect(results).toEqual([{ fileId: 'file-1', outcome: 'network-stored' }]);
		expect(signFileUrlMock).toHaveBeenCalledTimes(1);
		expect(signFileUrlMock.mock.calls[0].slice(0, 2)).toEqual([CFG, 'file-1']);
		expect(fetchImpl).toHaveBeenCalledTimes(1);
		expect(String(fetchImpl.mock.calls[0][0])).toBe('https://s3.example/signed-file-1');
		// Full shape on puts — not a contains-check (the partial-assertions law).
		expect(
			store.puts.map((p) => ({
				identity: p.identity,
				fileId: p.fileId,
				filetype: p.data.filetype,
				sha256: p.data.sha256,
				bytes: Array.from(new Uint8Array(p.data.bytes))
			}))
		).toEqual([
			{
				identity: A,
				fileId: 'file-1',
				filetype: 'application/pdf',
				sha256: await sha256Hex(PDF_BYTES),
				bytes: Array.from(PDF_BYTES)
			}
		]);
		// Nothing consumes a prefetched URL — every mint is released here.
		expect(createSpy).toHaveBeenCalledTimes(1);
		expect(revokeSpy).toHaveBeenCalledWith(String(createSpy.mock.results[0]!.value));
	});

	it('all minted URLs are released, one per fetched part — no blob URL survives the prefetch', async () => {
		const fetchImpl = happySigning();
		const createSpy = vi.spyOn(URL, 'createObjectURL');
		const revokeSpy = vi.spyOn(URL, 'revokeObjectURL');

		await prefetchNextEventParts(
			CFG,
			A,
			['file-1', 'file-2', 'file-3'],
			store,
			fetchImpl as unknown as typeof fetch,
			() => true
		);

		expect(createSpy).toHaveBeenCalledTimes(3);
		const minted = createSpy.mock.results.map((r) => String(r.value));
		for (const url of minted) {
			expect(revokeSpy).toHaveBeenCalledWith(url);
		}
	});
});

describe('#409 — held parts are skipped, and a prefetch NEVER counts as an open', () => {
	it('every part already held: heldFileIds read ONCE, no get(), no touch, no re-put, no stamp moved, no network (the presence-spec trap, mirrored)', async () => {
		// The REAL policy core over the fake adapter — the same harness
		// byteStore.presence.spec.ts:76 uses, so any recency movement is a
		// changed number, not a race.
		const adapter: FakeAdapter = createFakeAdapter();
		await adapter.put(A.db, A.personId, 'file-1', {
			bytes: PDF_BYTES.slice().buffer,
			filetype: 'application/pdf',
			sha256: 'sha-1',
			size: 8,
			openedAt: 1000
		});
		await adapter.put(A.db, A.personId, 'file-2', {
			bytes: PDF_BYTES.slice().buffer,
			filetype: 'application/pdf',
			sha256: 'sha-2',
			size: 8,
			openedAt: 2000
		});
		const putsAfterSeeding = adapter.putLog.length;
		const realStore = createByteStore(adapter, { capBytes: 1000 });
		const getSpy = vi.spyOn(realStore, 'get');
		const heldSpy = vi.spyOn(realStore, 'heldFileIds');
		const fetchImpl = vi.fn();

		const results = await prefetchNextEventParts(
			CFG,
			A,
			['file-1', 'file-2'],
			realStore,
			fetchImpl as unknown as typeof fetch,
			() => true
		);

		expect(results).toEqual([
			{ fileId: 'file-1', outcome: 'held' },
			{ fileId: 'file-2', outcome: 'held' }
		]);
		// ONE keys-only presence read decided both skips.
		expect(heldSpy).toHaveBeenCalledTimes(1);
		expect(heldSpy).toHaveBeenCalledWith(A.db, A.personId);
		// The trap: no per-row get() (a get counts as an open), no touch, no
		// re-put, every seeded stamp exactly as seeded.
		expect(getSpy).not.toHaveBeenCalled();
		expect(adapter.touchLog).toEqual([]);
		expect(adapter.putLog.length).toBe(putsAfterSeeding);
		expect(
			adapter.rows().map((r) => ({ fileId: r.fileId, openedAt: r.record.openedAt }))
		).toEqual([
			{ fileId: 'file-1', openedAt: 1000 },
			{ fileId: 'file-2', openedAt: 2000 }
		]);
		// And no network at all.
		expect(signFileUrlMock).not.toHaveBeenCalled();
		expect(fetchImpl).not.toHaveBeenCalled();
	});

	it('mixed set: held parts answer "held" with no signing, missing parts are fetched — results in input order', async () => {
		store.seed(A, 'file-held', {
			bytes: PDF_BYTES.slice().buffer,
			filetype: 'application/pdf',
			sha256: 'sha-held'
		});
		const fetchImpl = happySigning();

		const results = await prefetchNextEventParts(
			CFG,
			A,
			['file-held', 'file-missing'],
			store,
			fetchImpl as unknown as typeof fetch,
			() => true
		);

		expect(results).toEqual([
			{ fileId: 'file-held', outcome: 'held' },
			{ fileId: 'file-missing', outcome: 'network-stored' }
		]);
		expect(signFileUrlMock).toHaveBeenCalledTimes(1);
		expect(signFileUrlMock.mock.calls[0].slice(0, 2)).toEqual([CFG, 'file-missing']);
		expect(store.puts.map((p) => p.fileId)).toEqual(['file-missing']);
	});
});

describe('#409 — sequential, never a parallel S3 storm', () => {
	it('with three missing parts, the second sign happens only after the first put resolved — exact call-log order', async () => {
		const log: string[] = [];
		signFileUrlMock.mockImplementation(async (_cfg: unknown, fileId: string) => {
			log.push(`sign:${fileId}`);
			return `https://s3.example/signed-${fileId}`;
		});
		const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
			log.push(`fetch:${String(input).replace('https://s3.example/signed-', '')}`);
			return pdfResponse();
		});
		const realPut = store.put.bind(store);
		vi.spyOn(store, 'put').mockImplementation(async (identity, fileId, data) => {
			await realPut(identity, fileId, data);
			log.push(`put:${fileId}`);
		});

		await prefetchNextEventParts(
			CFG,
			A,
			['file-1', 'file-2', 'file-3'],
			store,
			fetchImpl as unknown as typeof fetch,
			() => true
		);

		// The FULL interleaving, pinned exactly: a parallel launch would front-
		// load every sign before any put; sequential walks sign→fetch→put per
		// part, in input order.
		expect(log).toEqual([
			'sign:file-1',
			'fetch:file-1',
			'put:file-1',
			'sign:file-2',
			'fetch:file-2',
			'put:file-2',
			'sign:file-3',
			'fetch:file-3',
			'put:file-3'
		]);
	});
});

describe('#409 — collective switch mid-prefetch', () => {
	it('identity goes stale after part 1: parts 2..n are NEVER signed, nothing more is put, and part 1’s minted URL is still released', async () => {
		let current = true;
		const fetchImpl = happySigning();
		const realPut = store.put.bind(store);
		vi.spyOn(store, 'put').mockImplementation(async (identity, fileId, data) => {
			await realPut(identity, fileId, data);
			// The singer switches collectives exactly as part 1's write lands.
			current = false;
		});
		const createSpy = vi.spyOn(URL, 'createObjectURL');
		const revokeSpy = vi.spyOn(URL, 'revokeObjectURL');

		const results = await prefetchNextEventParts(
			CFG,
			A,
			['file-1', 'file-2', 'file-3'],
			store,
			fetchImpl as unknown as typeof fetch,
			() => current
		);

		// Part 1 was issued while current and stores under the ISSUING identity
		// (openFileBytes' own law) — truthfully reported. The walk then STOPS.
		expect(results).toEqual([{ fileId: 'file-1', outcome: 'network-stored' }]);
		expect(signFileUrlMock).toHaveBeenCalledTimes(1);
		expect(signFileUrlMock.mock.calls[0].slice(0, 2)).toEqual([CFG, 'file-1']);
		expect(fetchImpl).toHaveBeenCalledTimes(1);
		expect(store.puts.map((p) => ({ identity: p.identity, fileId: p.fileId }))).toEqual([
			{ identity: A, fileId: 'file-1' }
		]);
		// The stale settle's minted URL is not left pinning a copy of the score.
		expect(createSpy).toHaveBeenCalledTimes(1);
		expect(revokeSpy).toHaveBeenCalledWith(String(createSpy.mock.results[0]!.value));
	});
});

describe('#409 — a failed part is a result, never a raise', () => {
	it('a part whose signing rejects surfaces as outcome "failed" and the walk CONTINUES — later parts still fetched, nothing thrown', async () => {
		signFileUrlMock.mockImplementation(async (_cfg: unknown, fileId: string) => {
			if (fileId === 'file-2') throw new Error('403');
			return `https://s3.example/signed-${fileId}`;
		});
		const fetchImpl = vi.fn(async (_input: RequestInfo | URL) => pdfResponse());

		const results = await prefetchNextEventParts(
			CFG,
			A,
			['file-1', 'file-2', 'file-3'],
			store,
			fetchImpl as unknown as typeof fetch,
			() => true
		);

		expect(results).toEqual([
			{ fileId: 'file-1', outcome: 'network-stored' },
			{ fileId: 'file-2', outcome: 'failed' },
			{ fileId: 'file-3', outcome: 'network-stored' }
		]);
		expect(store.puts.map((p) => p.fileId)).toEqual(['file-1', 'file-3']);
	});

	it('a byte fetch that rejects resolves through openFileBytes as "fallback-navigation" — recorded verbatim, nothing stored for it, walk continues', async () => {
		signFileUrlMock.mockImplementation(
			async (_cfg: unknown, fileId: string) => `https://s3.example/signed-${fileId}`
		);
		const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
			if (String(input).endsWith('file-2')) throw new TypeError('Failed to fetch');
			return pdfResponse();
		});

		const results = await prefetchNextEventParts(
			CFG,
			A,
			['file-1', 'file-2', 'file-3'],
			store,
			fetchImpl as unknown as typeof fetch,
			() => true
		);

		expect(results).toEqual([
			{ fileId: 'file-1', outcome: 'network-stored' },
			{ fileId: 'file-2', outcome: 'fallback-navigation' },
			{ fileId: 'file-3', outcome: 'network-stored' }
		]);
		// A fallback delivers a signed URL to a CLICKING caller; a prefetch has
		// no caller to deliver to — the one thing that matters is that nothing
		// half-fetched reached the store.
		expect(store.puts.map((p) => p.fileId)).toEqual(['file-1', 'file-3']);
	});
});

describe('#409 — degenerate inputs degrade silently', () => {
	it('a null identity resolves [] with no signing and no fetch — never a throw out of the load chain', async () => {
		const fetchImpl = vi.fn();

		const results = await prefetchNextEventParts(
			CFG,
			null,
			['file-1'],
			store,
			fetchImpl as unknown as typeof fetch,
			() => true
		);

		expect(results).toEqual([]);
		expect(signFileUrlMock).not.toHaveBeenCalled();
		expect(fetchImpl).not.toHaveBeenCalled();
	});

	it('an empty fileIds list resolves [] with no network', async () => {
		const fetchImpl = vi.fn();

		const results = await prefetchNextEventParts(
			CFG,
			A,
			[],
			store,
			fetchImpl as unknown as typeof fetch,
			() => true
		);

		expect(results).toEqual([]);
		expect(signFileUrlMock).not.toHaveBeenCalled();
		expect(fetchImpl).not.toHaveBeenCalled();
	});
});

// (*MVOX:Tallis*)
