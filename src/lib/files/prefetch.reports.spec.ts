// prefetchNextEventParts: a part that ends not stored sends one report with the reason (#944).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const reportProblem = vi.hoisted(() => vi.fn());
vi.mock('$lib/problems/reportProblem', () => ({ reportProblem, alreadyReported: () => {} }));
vi.mock('$lib/repertoire/fileUrls', async () =>
	(await import('$lib/testing/mocks/files')).fileUrlsModule()
);

import { prefetchNextEventParts } from './prefetch';
import { BYTE_STORE_CAP_BYTES } from './byteStore';
import { createFakeByteStore, type FakeByteStore } from '$lib/testing/byteStoreFakes';
import { testCfg } from '$lib/testing/entuFetchKit';
import { signFileUrlMock } from '$lib/testing/mocks/files';

const CFG = testCfg('sampledb', 'jwt-abc');
const A = { db: 'sampledb', personId: 'person-a' };
const PRELOADING = { area: 'files', action: 'preloading a part for the next rehearsal' };

const PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]);

function pdfResponse(headers: Record<string, string> = {}): Response {
	return new Response(PDF_BYTES.slice(), {
		status: 200,
		headers: { 'content-type': 'application/pdf', ...headers }
	});
}

let store: FakeByteStore;

beforeEach(() => {
	reportProblem.mockReset();
	signFileUrlMock.mockReset();
	signFileUrlMock.mockImplementation(
		async (_cfg: unknown, fileId: string) => `https://s3.example/signed-${fileId}`
	);
	store = createFakeByteStore();
});

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

function run(fileIds: string[], fetchImpl: (url: string) => Promise<Response>, isCurrent = () => true) {
	const impl = vi.fn(async (input: RequestInfo | URL) => fetchImpl(String(input)));
	return prefetchNextEventParts(CFG, A, fileIds, store, impl as unknown as typeof fetch, isCurrent);
}

function reportedErrors(): unknown[] {
	return reportProblem.mock.calls.map(([problem]) => {
		expect(problem).toMatchObject(PRELOADING);
		return problem.error;
	});
}

function onlyMessage(): string {
	const errors = reportedErrors();
	expect(errors).toHaveLength(1);
	expect(errors[0]).toBeInstanceOf(Error);
	return (errors[0] as Error).message;
}

describe('#944 — one report per part that ends not stored, naming why', () => {
	it('over the size cap: the report says the part is too large to store', async () => {
		const over = String(BYTE_STORE_CAP_BYTES + 1);
		await run(['cap-1'], async () => pdfResponse({ 'content-length': over }));

		expect(onlyMessage()).toMatch(/too large to store/);
	});

	it('no digest on a plain-http address: the report says this address cannot check files', async () => {
		vi.stubGlobal('crypto', {});
		await run(['nodigest-1'], async () => pdfResponse());

		expect(onlyMessage()).toMatch(/this address cannot check files/);
	});

	it('a byte fetch that throws: the report carries the thrown error', async () => {
		const blocked = new TypeError('Failed to fetch');
		await run(['fetchthrow-1'], async () => {
			throw blocked;
		});

		expect(reportedErrors()).toEqual([blocked]);
	});

	it('a body read that throws: the report carries the thrown error', async () => {
		const dropped = new TypeError('network error');
		await run(['bodythrow-1'], async () => {
			const res = pdfResponse();
			vi.spyOn(res, 'arrayBuffer').mockRejectedValue(dropped);
			return res;
		});

		expect(reportedErrors()).toEqual([dropped]);
	});

	it('a signing failure: the report carries the signing error, and the walk goes on', async () => {
		const denied = new Error('403');
		signFileUrlMock.mockImplementation(async (_cfg: unknown, fileId: string) => {
			if (fileId === 'sign-1') throw denied;
			return `https://s3.example/signed-${fileId}`;
		});

		const results = await run(['sign-1', 'sign-ok'], async () => pdfResponse());

		expect(reportedErrors()).toEqual([denied]);
		expect(results.map((r) => r.outcome)).toEqual(['failed', 'network-stored']);
	});

	it('a non-OK byte fetch: the report carries the status', async () => {
		await run(['status-1'], async () => new Response('denied', { status: 403 }));

		expect(onlyMessage()).toMatch(/403/);
	});
});

describe('#944 — what sends no preload report', () => {
	it('a failed save sends exactly one report in total: the save report, not a second one', async () => {
		const full = new DOMException('quota', 'QuotaExceededError');
		store.put = vi.fn().mockRejectedValue(full);

		await run(['save-1'], async () => pdfResponse());

		expect(reportProblem.mock.calls).toEqual([
			[{ area: 'files', action: 'saving a part on this device', error: full }]
		]);
	});

	it('held and stored parts send nothing', async () => {
		store.seed(A, 'held-1', {
			bytes: PDF_BYTES.slice().buffer,
			filetype: 'application/pdf',
			sha256: 'sha-held'
		});

		const results = await run(['held-1', 'stored-1'], async () => pdfResponse());

		expect(results.map((r) => r.outcome)).toEqual(['held', 'network-stored']);
		expect(reportProblem).not.toHaveBeenCalled();
	});

	it('a part that fails after the walk was stopped (collective switch) sends nothing', async () => {
		let current = true;
		await run(
			['stopped-1', 'stopped-2'],
			async () => {
				current = false;
				throw new TypeError('Failed to fetch');
			},
			() => current
		);

		expect(reportProblem).not.toHaveBeenCalled();
	});
});

describe('#944 — once per part, per reason, per app session', () => {
	it('the same failure on a second visit sends no second report', async () => {
		const blocked = async () => {
			throw new TypeError('Failed to fetch');
		};
		await run(['again-1'], blocked);
		await run(['again-1'], blocked);

		expect(reportProblem).toHaveBeenCalledTimes(1);
	});

	it('a different reason for the same part sends again', async () => {
		await run(['changed-1'], async () => {
			throw new TypeError('Failed to fetch');
		});
		const over = String(BYTE_STORE_CAP_BYTES + 1);
		await run(['changed-1'], async () => pdfResponse({ 'content-length': over }));

		expect(reportProblem).toHaveBeenCalledTimes(2);
		expect((reportedErrors()[1] as Error).message).toMatch(/too large to store/);
	});
});

// (*MVOX:Josquin*)
