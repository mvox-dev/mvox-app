// prefetchNextEventParts: fetch the next event's parts while the app is open.
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
import { testCfg } from '$lib/testing/entuFetchKit';

const CFG = testCfg('sampledb', 'jwt-abc');
const A = { db: 'sampledb', personId: 'person-a' };

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
		expect(heldSpy).toHaveBeenCalledTimes(1);
		expect(heldSpy).toHaveBeenCalledWith(A.db, A.personId);
		expect(getSpy).not.toHaveBeenCalled();
		expect(adapter.touchLog).toEqual([]);
		expect(adapter.putLog.length).toBe(putsAfterSeeding);
		expect(
			adapter.rows().map((r) => ({ fileId: r.fileId, openedAt: r.record.openedAt }))
		).toEqual([
			{ fileId: 'file-1', openedAt: 1000 },
			{ fileId: 'file-2', openedAt: 2000 }
		]);
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

		expect(results).toEqual([{ fileId: 'file-1', outcome: 'network-stored' }]);
		expect(signFileUrlMock).toHaveBeenCalledTimes(1);
		expect(signFileUrlMock.mock.calls[0].slice(0, 2)).toEqual([CFG, 'file-1']);
		expect(fetchImpl).toHaveBeenCalledTimes(1);
		expect(store.puts.map((p) => ({ identity: p.identity, fileId: p.fileId }))).toEqual([
			{ identity: A, fileId: 'file-1' }
		]);
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
