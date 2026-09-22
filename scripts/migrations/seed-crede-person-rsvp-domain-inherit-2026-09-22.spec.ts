// Data job from Mihkel (2026-09-22), relayed by team-lead: every `person`
// and every `rsvp` entity on crede gets `_sharing: domain` and
// `_inheritrights: true`. Pins the engine's contract — see the header
// comment in seed-crede-person-rsvp-domain-inherit-2026-09-22.ts for the
// docs quoted and the DELETE-then-POST replace-semantics rationale.
//
// networkGuard.setup.ts stands behind every spec: nothing here can reach a
// live db; the whole wire is a fake fetch and every request asserted
// full-shape with toEqual (partial assertions hide bugs — feedback_partial_
// assertions_hide_bugs).

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EntuCfg } from '$lib/seasons/entuSeasons';

const writeLedgerMock = vi.fn(() => 'scripts/migrations/seed-results/crede-instance/seed-crede-domain-inherit-fake.json');

// Only `writeLedger` is replaced; `assertLiveRunAuthorized` stays the real
// export so the gate is exercised against running code, not assumed.
vi.mock('./lib/ledger-writer', async (importOriginal) => {
	const actual = await importOriginal<typeof import('./lib/ledger-writer')>();
	return {
		...actual,
		writeLedger: (...args: unknown[]) => writeLedgerMock(...(args as [unknown]))
	};
});

import { runSeedCredeDomainInherit } from './seed-crede-person-rsvp-domain-inherit-2026-09-22';

type CredeRunnerCfg = EntuCfg & { userId: string };

const RUNNER_ID = 'runner-person-1';
const cfg: CredeRunnerCfg = { db: 'mvox_crede', token: 'jwt', userId: RUNNER_ID };
const BASE = 'https://api.entu-test.invalid/mvox_crede';

const LIVE_AUTH = 'Mihkel, team console, https://github.com/mvox-dev/mvox-app/issues/424#issuecomment-fake';

function personCensusUrl(): string {
	return `${BASE}/entity?_type.string=person&props=_sharing,_inheritrights,_owner,_editor&limit=10000`;
}
function rsvpCensusUrl(): string {
	return `${BASE}/entity?_type.string=rsvp&props=_sharing,_inheritrights,_owner,_editor&limit=10000`;
}

type CensusEntity = {
	_id: string;
	_sharing?: Array<{ _id: string; string?: string }>;
	_inheritrights?: Array<{ _id: string; boolean?: boolean }>;
	_owner?: string[];
	_editor?: string[];
};

function json(body: unknown, status = 200): Promise<Response> {
	return Promise.resolve(new Response(JSON.stringify(body), { status }));
}

type LoggedRequest = { url: string; method: string; body: unknown };

function toCensusEntity(e: CensusEntity): unknown {
	const refs = (ids: string[] | undefined, tier: string) =>
		ids?.length ? ids.map((id, i) => ({ _id: `r-${e._id}-${tier}-${i}`, reference: id })) : undefined;
	return { _id: e._id, _sharing: e._sharing, _inheritrights: e._inheritrights, _owner: refs(e._owner, 'owner'), _editor: refs(e._editor, 'editor') };
}

/**
 * Fake wire, routed by exact URL + method. `persons`/`rsvps` seed the two
 * censuses; `readbackOverrides` lets a test make the post-write read-back
 * lie for one entity (canary failure); `deleteFailsFor` makes one DELETE
 * 500.
 */
function makeWire(
	persons: CensusEntity[],
	rsvps: CensusEntity[],
	overrides: {
		personCountOverride?: number;
		rsvpCountOverride?: number;
		readbackOverrides?: Record<string, { sharing?: string; inheritCount?: number }>;
		deleteFailsFor?: string;
	} = {}
): { fetchImpl: typeof fetch; requests: LoggedRequest[] } {
	const requests: LoggedRequest[] = [];
	// State the fake db reflects, mutated by DELETE/POST — starts from the
	// census fixtures, keyed by entity id.
	const state = new Map<string, { sharing?: string; inherit?: boolean }>();
	for (const e of [...persons, ...rsvps]) {
		state.set(e._id, { sharing: e._sharing?.[0]?.string, inherit: e._inheritrights?.[0]?.boolean });
	}
	const deletedIds = new Set<string>();

	const fetchImpl = vi.fn((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
		const url = String(input);
		const method = init?.method ?? 'GET';
		const parsedBody = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
		requests.push({ url, method, body: parsedBody });

		if (method === 'GET' && url === personCensusUrl()) {
			return json({ count: overrides.personCountOverride ?? persons.length, entities: persons.map(toCensusEntity) });
		}
		if (method === 'GET' && url === rsvpCensusUrl()) {
			return json({ count: overrides.rsvpCountOverride ?? rsvps.length, entities: rsvps.map(toCensusEntity) });
		}

		const deleteMatch = url.match(new RegExp(`^${BASE}/property/(.+)$`));
		if (method === 'DELETE' && deleteMatch) {
			const propId = deleteMatch[1];
			if (overrides.deleteFailsFor && propId.includes(overrides.deleteFailsFor)) {
				return json({ error: 'delete failed' }, 500);
			}
			deletedIds.add(propId);
			return json({ deleted: true });
		}

		const postMatch = url.match(new RegExp(`^${BASE}/entity/([\\w-]+)$`));
		if (method === 'POST' && postMatch) {
			const id = postMatch[1];
			const entry = state.get(id) ?? {};
			const write = (parsedBody as Array<{ type: string; string?: string; boolean?: boolean }>)?.[0];
			if (write?.type === '_sharing') entry.sharing = write.string;
			if (write?.type === '_inheritrights') entry.inherit = write.boolean;
			state.set(id, entry);
			return json({ properties: [{ _id: `p-${id}-${write?.type}-new`, type: write?.type }] });
		}

		const readbackMatch = url.match(new RegExp(`^${BASE}/entity/([\\w-]+)\\?props=_sharing,_inheritrights$`));
		if (method === 'GET' && readbackMatch) {
			const id = readbackMatch[1];
			const override = overrides.readbackOverrides?.[id];
			const entry = state.get(id) ?? {};
			const sharingStr = override?.sharing ?? entry.sharing;
			const inheritCount = override?.inheritCount ?? (entry.inherit !== undefined ? 1 : 0);
			return json({
				entity: {
					_id: id,
					_sharing: sharingStr !== undefined ? [{ _id: `p-${id}-sh`, string: sharingStr }] : [],
					_inheritrights: inheritCount === 2 ? [{ _id: `p-${id}-in-a`, boolean: entry.inherit }, { _id: `p-${id}-in-b`, boolean: entry.inherit }] : entry.inherit !== undefined ? [{ _id: `p-${id}-in`, boolean: entry.inherit }] : []
				}
			});
		}

		return json({ error: `unrouted request: ${method} ${url}` }, 500);
	}) as typeof fetch;

	return { fetchImpl, requests };
}

beforeEach(() => {
	writeLedgerMock.mockClear();
});

describe('runSeedCredeDomainInherit — import safety + gate ordering', () => {
	it('a live run with no authorizedBy throws before any fetch call', async () => {
		const { fetchImpl, requests } = makeWire([], []);
		await expect(runSeedCredeDomainInherit(cfg, false, fetchImpl, undefined)).rejects.toThrow(/authorizedBy/);
		expect(requests).toEqual([]);
	});
});

describe('runSeedCredeDomainInherit — census', () => {
	it('hard-throws when the person census count disagrees with entities.length', async () => {
		const { fetchImpl } = makeWire([{ _id: 'pe-1' }], [], { personCountOverride: 5 });
		await expect(runSeedCredeDomainInherit(cfg, true, fetchImpl)).rejects.toThrow(/census truncated for 'person'/);
	});

	it("hard-throws when the rsvp census count disagrees with entities.length", async () => {
		const { fetchImpl } = makeWire([], [{ _id: 'rs-1' }], { rsvpCountOverride: 5 });
		await expect(runSeedCredeDomainInherit(cfg, true, fetchImpl)).rejects.toThrow(/census truncated for 'rsvp'/);
	});
});

describe('runSeedCredeDomainInherit — classification', () => {
	it('classifies alreadyDomain/needsSharing and alreadyInherit/needsInherit across absent, private, and false prior values', async () => {
		const persons: CensusEntity[] = [
			// already fully compliant
			{ _id: 'pe-domain-inherit', _sharing: [{ _id: 's1', string: 'domain' }], _inheritrights: [{ _id: 'i1', boolean: true }], _owner: [RUNNER_ID] },
			// both absent — needs both
			{ _id: 'pe-absent-absent', _owner: [RUNNER_ID] },
			// private + false — needs both, prior values present
			{ _id: 'pe-private-false', _sharing: [{ _id: 's2', string: 'private' }], _inheritrights: [{ _id: 'i2', boolean: false }], _owner: [RUNNER_ID] },
			// sharing already domain, inherit still false
			{ _id: 'pe-domain-false', _sharing: [{ _id: 's3', string: 'domain' }], _inheritrights: [{ _id: 'i3', boolean: false }], _owner: [RUNNER_ID] }
		];
		const rsvps: CensusEntity[] = [{ _id: 'rs-public', _sharing: [{ _id: 's4', string: 'public' }], _owner: [RUNNER_ID] }];
		const { fetchImpl } = makeWire(persons, rsvps);

		const result = await runSeedCredeDomainInherit(cfg, true, fetchImpl);

		expect(result.counts.person).toEqual({
			total: 4,
			alreadyDomain: 2,
			needsSharing: 2,
			alreadyInherit: 1,
			needsInherit: 3,
			toWrite: 3,
			failed: 0,
			wouldWrite: 3
		});
		expect(result.counts.rsvp).toEqual({
			total: 1,
			alreadyDomain: 0,
			needsSharing: 1,
			alreadyInherit: 0,
			needsInherit: 1,
			toWrite: 1,
			failed: 0,
			wouldWrite: 1
		});
	});

	it('a dry run issues ONLY the two census GETs — zero POSTs, zero DELETEs', async () => {
		const persons: CensusEntity[] = [{ _id: 'pe-1', _owner: [RUNNER_ID] }];
		const { fetchImpl, requests } = makeWire(persons, []);
		await runSeedCredeDomainInherit(cfg, true, fetchImpl);
		expect(requests).toEqual([
			{ url: personCensusUrl(), method: 'GET', body: null },
			{ url: rsvpCensusUrl(), method: 'GET', body: null }
		]);
	});
});

describe('runSeedCredeDomainInherit — multi-value abort', () => {
	it('stops before any write, dry and live alike, when an entity holds more than one _sharing or _inheritrights value', async () => {
		const persons: CensusEntity[] = [
			{ _id: 'pe-clean', _owner: [RUNNER_ID] },
			{
				_id: 'pe-multi',
				_sharing: undefined,
				_owner: [RUNNER_ID],
				_inheritrights: undefined
			}
		];
		// force a double _sharing value directly via toCensusEntity's pass-through
		(persons[1] as CensusEntity)._sharing = [
			{ _id: 's-a', string: 'private' },
			{ _id: 's-b', string: 'public' }
		];
		const { fetchImpl, requests } = makeWire(persons, []);

		await expect(runSeedCredeDomainInherit(cfg, true, fetchImpl, undefined)).rejects.toThrow(/more than one _sharing\/_inheritrights value/);
		// only the two censuses — no POST/DELETE issued
		expect(requests.filter((r) => r.method !== 'GET')).toEqual([]);
		expect(writeLedgerMock).toHaveBeenCalledTimes(1);
		expect(writeLedgerMock.mock.calls[0][0]).toMatchObject({ payload: expect.objectContaining({ outcome: 'aborted-multi-value' }) });
	});
});

describe('runSeedCredeDomainInherit — ER-11 rights preflight (_owner only, never _editor)', () => {
	it('aborts before any write when the runner is absent from _owner, even on a dry run, and even when _editor is present', async () => {
		const persons: CensusEntity[] = [{ _id: 'pe-no-owner', _editor: [RUNNER_ID] }]; // editor, NOT owner
		const { fetchImpl, requests } = makeWire(persons, []);

		await expect(runSeedCredeDomainInherit(cfg, true, fetchImpl, undefined)).rejects.toThrow(/rights preflight failed for 1 entity/);
		expect(requests.filter((r) => r.method !== 'GET')).toEqual([]);
		expect(writeLedgerMock.mock.calls[0][0]).toMatchObject({
			payload: expect.objectContaining({ outcome: 'aborted-rights', noRights: [{ id: 'pe-no-owner', type: 'person' }] })
		});
	});

	it('does NOT abort for an entity already compliant, even with no _owner — nothing needs writing to it', async () => {
		const persons: CensusEntity[] = [{ _id: 'pe-compliant-no-owner', _sharing: [{ _id: 's1', string: 'domain' }], _inheritrights: [{ _id: 'i1', boolean: true }] }];
		const { fetchImpl } = makeWire(persons, []);
		const result = await runSeedCredeDomainInherit(cfg, true, fetchImpl);
		expect(result.counts.person.toWrite).toBe(0);
	});
});

describe('runSeedCredeDomainInherit — live write', () => {
	it('DELETEs a prior _sharing value then POSTs domain; POSTs _inheritrights with no DELETE when absent; single combined read-back', async () => {
		const persons: CensusEntity[] = [{ _id: 'pe-w1', _sharing: [{ _id: 'old-sh', string: 'private' }], _owner: [RUNNER_ID] }]; // inherit absent
		const { fetchImpl, requests } = makeWire(persons, []);

		const result = await runSeedCredeDomainInherit(cfg, false, fetchImpl, LIVE_AUTH);

		expect(result.counts.person).toEqual({
			total: 1,
			alreadyDomain: 0,
			needsSharing: 1,
			alreadyInherit: 0,
			needsInherit: 1,
			toWrite: 1,
			failed: 0,
			written: 1
		});
		const censusUrls = new Set([personCensusUrl(), rsvpCensusUrl()]);
		const mutating = requests.filter((r) => !censusUrls.has(r.url));
		expect(mutating).toEqual([
			{ url: `${BASE}/property/old-sh`, method: 'DELETE', body: null },
			{ url: `${BASE}/entity/pe-w1`, method: 'POST', body: [{ type: '_sharing', string: 'domain' }] },
			// no DELETE for _inheritrights — it was absent, nothing to delete
			{ url: `${BASE}/entity/pe-w1`, method: 'POST', body: [{ type: '_inheritrights', boolean: true }] },
			{ url: `${BASE}/entity/pe-w1?props=_sharing,_inheritrights`, method: 'GET', body: null }
		]);
	});

	it('a read-back mismatch on _sharing records the entity failed, writes the ledger, and throws', async () => {
		const persons: CensusEntity[] = [{ _id: 'pe-bad', _owner: [RUNNER_ID] }];
		const { fetchImpl } = makeWire(persons, [], { readbackOverrides: { 'pe-bad': { sharing: 'private' } } });

		await expect(runSeedCredeDomainInherit(cfg, false, fetchImpl, LIVE_AUTH)).rejects.toThrow(/READ-BACK _sharing mismatch/);
		expect(writeLedgerMock.mock.calls.at(-1)?.[0]).toMatchObject({ payload: expect.objectContaining({ failedIds: ['pe-bad'] }) });
	});

	it('a read-back reporting TWO _inheritrights values fails the same way', async () => {
		const persons: CensusEntity[] = [{ _id: 'pe-doubled', _owner: [RUNNER_ID] }];
		const { fetchImpl } = makeWire(persons, [], { readbackOverrides: { 'pe-doubled': { inheritCount: 2 } } });

		await expect(runSeedCredeDomainInherit(cfg, false, fetchImpl, LIVE_AUTH)).rejects.toThrow(/READ-BACK _inheritrights mismatch/);
	});
});

describe('runSeedCredeDomainInherit — rerun posture', () => {
	it('a re-run over an already-fully-compliant estate writes zero and reports rerun:true', async () => {
		const persons: CensusEntity[] = [{ _id: 'pe-done', _sharing: [{ _id: 's1', string: 'domain' }], _inheritrights: [{ _id: 'i1', boolean: true }], _owner: [RUNNER_ID] }];
		const { fetchImpl } = makeWire(persons, []);
		const result = await runSeedCredeDomainInherit(cfg, true, fetchImpl);
		expect(result.rerun).toBe(true);
		expect(result.counts.person.wouldWrite).toBe(0);
	});

	it('an empty estate (zero persons, zero rsvps) is NOT a healthy rerun', async () => {
		const { fetchImpl } = makeWire([], []);
		const result = await runSeedCredeDomainInherit(cfg, true, fetchImpl);
		expect(result.rerun).toBe(false);
	});
});

describe('runSeedCredeDomainInherit — ledger authorization threading', () => {
	it('a dry run records the reserved sentinel as authorizedBy', async () => {
		const { fetchImpl } = makeWire([{ _id: 'pe-1', _owner: [RUNNER_ID] }], []);
		await runSeedCredeDomainInherit(cfg, true, fetchImpl, undefined);
		expect(writeLedgerMock.mock.calls[0][0]).toMatchObject({ authorizedBy: undefined, dryRun: true, sensitive: true });
	});

	it('a live run threads the recorded authorizer through to writeLedger', async () => {
		const persons: CensusEntity[] = [{ _id: 'pe-1', _sharing: [{ _id: 's1', string: 'domain' }], _inheritrights: [{ _id: 'i1', boolean: true }] }];
		const { fetchImpl } = makeWire(persons, []);
		await runSeedCredeDomainInherit(cfg, false, fetchImpl, LIVE_AUTH);
		expect(writeLedgerMock.mock.calls[0][0]).toMatchObject({ authorizedBy: LIVE_AUTH, dryRun: false });
	});
});
