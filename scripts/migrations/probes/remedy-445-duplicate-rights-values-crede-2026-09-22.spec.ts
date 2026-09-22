// mvox-app#445 — REMEDY spec. Mihkel: "go for cleanup" (11:16Z). One
// entity, one known duplicate-value shape (see the script header for the
// full diagnosis). networkGuard.setup.ts stands behind every spec: the
// whole wire is a fake fetch, every request asserted full-shape with
// toEqual.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EntuCfg } from '$lib/seasons/entuSeasons';

const writeLedgerMock = vi.fn(() => 'scripts/migrations/seed-results/crede-instance/remedy-445-fake.json');

vi.mock('../lib/ledger-writer', async (importOriginal) => {
	const actual = await importOriginal<typeof import('../lib/ledger-writer')>();
	return {
		...actual,
		writeLedger: (...args: unknown[]) => writeLedgerMock(...(args as [unknown]))
	};
});

import {
	runRemedy445,
	ENTITY_ID,
	KEEP_SHARING_ID,
	KEEP_INHERIT_ID,
	DELETE_SHARING_ID,
	DELETE_INHERIT_ID
} from './remedy-445-duplicate-rights-values-crede-2026-09-22';

const cfg: EntuCfg = { db: 'mvox_crede', token: 'jwt' };
const BASE = 'https://api.entu-test.invalid/mvox_crede';
const LIVE_AUTH = 'Mihkel, team console, https://github.com/mvox-dev/mvox-app/issues/445#issuecomment-fake';
const READ_URL = `${BASE}/entity/${ENTITY_ID}?props=_sharing,_inheritrights`;
const NO_DELAY = 0;
const noSleep = async (): Promise<void> => {};

function json(body: unknown, status = 200): Promise<Response> {
	return Promise.resolve(new Response(JSON.stringify(body), { status }));
}

type LoggedRequest = { url: string; method: string };

/** `readSequence` supplies the entity read response for each call to READ_URL, in order — call 1 is step 1's assertion read, call 2 (live only) is the post-delete read-back, call 3 is the delayed recheck. Deletes always succeed unless `deleteFails` names the id. */
function makeWire(opts: { readSequence: unknown[]; deleteFails?: string }): { fetchImpl: typeof fetch; requests: LoggedRequest[] } {
	const requests: LoggedRequest[] = [];
	let readCall = 0;
	const fetchImpl = vi.fn((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
		const url = String(input);
		const method = init?.method ?? 'GET';
		requests.push({ url, method });

		if (method === 'GET' && url === READ_URL) {
			const body = opts.readSequence[readCall] ?? opts.readSequence.at(-1);
			readCall += 1;
			return json(body);
		}
		const deleteMatch = url.match(new RegExp(`^${BASE}/property/([\\w-]+)$`));
		if (method === 'DELETE' && deleteMatch) {
			const id = deleteMatch[1];
			if (opts.deleteFails === id) return json({ error: 'delete failed' }, 500);
			return json({ deleted: true });
		}
		return json({ error: `unrouted request: ${method} ${url}` }, 500);
	}) as typeof fetch;
	return { fetchImpl, requests };
}

const DUPLICATE_STATE = {
	entity: {
		_id: ENTITY_ID,
		_sharing: [
			{ _id: KEEP_SHARING_ID, string: 'domain' },
			{ _id: DELETE_SHARING_ID, string: 'domain' }
		],
		_inheritrights: [
			{ _id: KEEP_INHERIT_ID, boolean: true },
			{ _id: DELETE_INHERIT_ID, boolean: true }
		]
	}
};

const CLEANED_STATE = {
	entity: {
		_id: ENTITY_ID,
		_sharing: [{ _id: KEEP_SHARING_ID, string: 'domain' }],
		_inheritrights: [{ _id: KEEP_INHERIT_ID, boolean: true }]
	}
};

beforeEach(() => {
	writeLedgerMock.mockClear();
});

describe('runRemedy445 — gate ordering', () => {
	it('a live run with no authorizedBy throws before any fetch call', async () => {
		const { fetchImpl, requests } = makeWire({ readSequence: [] });
		await expect(runRemedy445(cfg, false, fetchImpl, undefined)).rejects.toThrow(/authorizedBy/);
		expect(requests).toEqual([]);
	});
});

describe('runRemedy445 — step 1: exact-state assertion', () => {
	it('aborts before any write when the observed value ids are not exactly the known duplicate pair', async () => {
		const unexpected = { entity: { _id: ENTITY_ID, _sharing: [{ _id: 'some-other-id', string: 'domain' }], _inheritrights: [] } };
		const { fetchImpl, requests } = makeWire({ readSequence: [unexpected] });
		await expect(runRemedy445(cfg, true, fetchImpl, undefined)).rejects.toThrow(/does not hold exactly the expected duplicate value ids/);
		expect(requests).toEqual([{ url: READ_URL, method: 'GET' }]);
		expect(writeLedgerMock.mock.calls[0][0]).toMatchObject({ payload: expect.objectContaining({ outcome: 'aborted-state-mismatch' }) });
	});

	it('a dry run matching the expected state prints the plan and issues zero writes', async () => {
		const { fetchImpl, requests } = makeWire({ readSequence: [DUPLICATE_STATE] });
		const result = await runRemedy445(cfg, true, fetchImpl);
		expect(result.outcome).toBe('dry-run');
		expect(requests).toEqual([{ url: READ_URL, method: 'GET' }]);
	});
});

describe('runRemedy445 — live cleanup', () => {
	it('deletes exactly the two 11:11Z ids, keeps the 10:42Z pair, verifies by read-back, then recheck', async () => {
		const { fetchImpl, requests } = makeWire({ readSequence: [DUPLICATE_STATE, CLEANED_STATE, CLEANED_STATE] });
		const result = await runRemedy445(cfg, false, fetchImpl, LIVE_AUTH, NO_DELAY, noSleep);

		expect(result.outcome).toBe('cleaned');
		expect(requests).toEqual([
			{ url: READ_URL, method: 'GET' },
			{ url: `${BASE}/property/${DELETE_SHARING_ID}`, method: 'DELETE' },
			{ url: `${BASE}/property/${DELETE_INHERIT_ID}`, method: 'DELETE' },
			{ url: READ_URL, method: 'GET' },
			{ url: READ_URL, method: 'GET' }
		]);

		const payload = writeLedgerMock.mock.calls.at(-1)?.[0]?.payload;
		expect(payload.deletedIds).toEqual([DELETE_SHARING_ID, DELETE_INHERIT_ID]);
		expect(payload.postRunRecheck.stillCorrect).toBe(true);
	});

	it('a DELETE failure throws before any read-back', async () => {
		const { fetchImpl } = makeWire({ readSequence: [DUPLICATE_STATE], deleteFails: DELETE_SHARING_ID });
		await expect(runRemedy445(cfg, false, fetchImpl, LIVE_AUTH, NO_DELAY, noSleep)).rejects.toThrow(/DELETE property.*failed/);
	});

	it('a read-back not showing exactly the kept pair aborts with a diagnostic ledger', async () => {
		const stillDuplicate = DUPLICATE_STATE; // simulates the delete not having taken effect
		const { fetchImpl } = makeWire({ readSequence: [DUPLICATE_STATE, stillDuplicate] });
		await expect(runRemedy445(cfg, false, fetchImpl, LIVE_AUTH, NO_DELAY, noSleep)).rejects.toThrow(/read-back after delete did not show exactly the kept pair/);
		expect(writeLedgerMock.mock.calls.at(-1)?.[0]).toMatchObject({ payload: expect.objectContaining({ outcome: 'aborted-readback-mismatch' }) });
	});

	it('the delayed recheck catches a post-cleanup reversion', async () => {
		const { fetchImpl } = makeWire({ readSequence: [DUPLICATE_STATE, CLEANED_STATE, DUPLICATE_STATE] });
		const result = await runRemedy445(cfg, false, fetchImpl, LIVE_AUTH, NO_DELAY, noSleep);
		expect(result.outcome).toBe('cleaned'); // the write+readback succeeded; the recheck result is informational, not a throw
		const payload = writeLedgerMock.mock.calls.at(-1)?.[0]?.payload;
		expect(payload.postRunRecheck.stillCorrect).toBe(false);
	});
});

describe('runRemedy445 — ledger authorization threading', () => {
	it('threads the recorded authorizer through to writeLedger on a live run', async () => {
		const { fetchImpl } = makeWire({ readSequence: [DUPLICATE_STATE, CLEANED_STATE, CLEANED_STATE] });
		await runRemedy445(cfg, false, fetchImpl, LIVE_AUTH, NO_DELAY, noSleep);
		expect(writeLedgerMock.mock.calls[0][0]).toMatchObject({ authorizedBy: LIVE_AUTH, dryRun: false });
	});
});
