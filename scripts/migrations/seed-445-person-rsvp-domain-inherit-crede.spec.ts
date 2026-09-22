// mvox-app#445 — every `person` and every `rsvp` entity on crede gets
// `_sharing: domain` and `_inheritrights: true`. Pins the engine's
// contract — see the header comment in
// seed-445-person-rsvp-domain-inherit-crede.ts for the docs quoted and the
// DELETE-then-POST replace-semantics rationale.
//
// networkGuard.setup.ts stands behind every spec: nothing here can reach a
// live db; the whole wire is a fake fetch and every request asserted
// full-shape with toEqual (partial assertions hide bugs —
// feedback_partial_assertions_hide_bugs).

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EntuCfg } from '$lib/seasons/entuSeasons';

const writeLedgerMock = vi.fn(() => 'scripts/migrations/seed-results/crede-instance/seed-445-fake.json');

// Only `writeLedger` is replaced; `assertLiveRunAuthorized` stays the real
// export so the gate is exercised against running code, not assumed.
vi.mock('./lib/ledger-writer', async (importOriginal) => {
	const actual = await importOriginal<typeof import('./lib/ledger-writer')>();
	return {
		...actual,
		writeLedger: (...args: unknown[]) => writeLedgerMock(...(args as [unknown]))
	};
});

import { runSeed445 } from './seed-445-person-rsvp-domain-inherit-crede';

type CredeRunnerCfg = EntuCfg & { userId: string };

const RUNNER_ID = 'runner-person-1';
const cfg: CredeRunnerCfg = { db: 'mvox_crede', token: 'jwt', userId: RUNNER_ID };
const BASE = 'https://api.entu-test.invalid/mvox_crede';
const LIVE_AUTH = 'Mihkel, team console, https://github.com/mvox-dev/mvox-app/issues/445#issuecomment-fake';
/** #445 (team-lead, 2nd round) — the postRunRecheck delay, made instant for every spec run. */
const NO_DELAY = 0;
const noSleep = async (): Promise<void> => {};

const ENTITY_META = 'meta-entity-type';
const PROPERTY_META = 'meta-property-type';
const PERSON_TYPE = 'type-person';
const RSVP_TYPE = 'type-rsvp';

const URLS = {
	entityMeta: `${BASE}/entity?_type.string=entity&name.string=entity&props=_id&limit=1`,
	propertyMeta: `${BASE}/entity?_type.string=entity&name.string=property&props=_id&limit=1`,
	personType: `${BASE}/entity?_type.reference=${ENTITY_META}&name.string=person&props=_id&limit=1`,
	rsvpType: `${BASE}/entity?_type.reference=${ENTITY_META}&name.string=rsvp&props=_id&limit=1`,
	personCap: `${BASE}/entity/${PERSON_TYPE}?props=_sharing`,
	rsvpCap: `${BASE}/entity/${RSVP_TYPE}?props=_sharing`,
	personPropDefs: `${BASE}/entity?_type.reference=${PROPERTY_META}&_parent.reference=${PERSON_TYPE}&props=name,_sharing&limit=500`,
	rsvpPropDefs: `${BASE}/entity?_type.reference=${PROPERTY_META}&_parent.reference=${RSVP_TYPE}&props=name,_sharing&limit=500`,
	personCensus: `${BASE}/entity?_type.string=person&props=_sharing,_inheritrights,_owner,_editor&limit=10000`,
	rsvpCensus: `${BASE}/entity?_type.string=rsvp&props=_sharing,_inheritrights,_owner,_editor,_parent&limit=10000`,
	profileCensus: `${BASE}/entity?_type.string=profile&props=_id&limit=10000`
};

type CensusEntity = {
	_id: string;
	_sharing?: Array<{ _id: string; string?: string }>;
	_inheritrights?: Array<{ _id: string; boolean?: boolean }>;
	_owner?: string[];
	_editor?: string[];
	_parent?: string;
};

function json(body: unknown, status = 200): Promise<Response> {
	return Promise.resolve(new Response(JSON.stringify(body), { status }));
}

type LoggedRequest = { url: string; method: string; body: unknown };

function toCensusEntity(e: CensusEntity, includeParent: boolean): unknown {
	const refs = (ids: string[] | undefined, tier: string) => (ids?.length ? ids.map((id, i) => ({ _id: `r-${e._id}-${tier}-${i}`, reference: id })) : undefined);
	return {
		_id: e._id,
		_sharing: e._sharing,
		_inheritrights: e._inheritrights,
		_owner: refs(e._owner, 'owner'),
		_editor: refs(e._editor, 'editor'),
		...(includeParent ? { _parent: e._parent ? [{ _id: `r-${e._id}-parent`, reference: e._parent }] : undefined } : {})
	};
}

interface WireOptions {
	persons?: CensusEntity[];
	rsvps?: CensusEntity[];
	profileIds?: string[];
	personCountOverride?: number;
	rsvpCountOverride?: number;
	profileCountOverride?: number;
	personCap?: string; // sharing string, or undefined for absent
	rsvpCap?: string;
	personPropDefs?: Array<{ name: string; sharing?: string }>;
	rsvpPropDefs?: Array<{ name: string; sharing?: string }>;
	readbackOverrides?: Record<string, { sharing?: string; inheritCount?: number; sharingCount?: number }>;
	/** #445 (team-lead, 2nd round) — overrides applied ONLY from the SECOND call to `entity/{id}?props=_sharing,_inheritrights` onward for a given id (the in-loop read-back is the first; the delayed postRunRecheck is the second) — the tool to reproduce "passed read-back, reverted moments later." Also covers the self-heal re-read (3rd round): the 2nd call is answered by this override, and so is the 3rd (postRunRecheck) unless it differs. */
	recheckOverrides?: Record<string, { sharing?: string; inheritCount?: number; sharingCount?: number }>;
	/** #445 — controls the diagnostic `GET /property/{id}` probe response, keyed by the property id the POST response returned. */
	propertyProbeOverrides?: Record<string, { status?: number; body?: unknown }>;
}

function makeWire(opts: WireOptions = {}): { fetchImpl: typeof fetch; requests: LoggedRequest[] } {
	const persons = opts.persons ?? [];
	const rsvps = opts.rsvps ?? [];
	const profileIds = opts.profileIds ?? [];
	const requests: LoggedRequest[] = [];
	const state = new Map<string, { sharing?: string; inherit?: boolean }>();
	const readbackCallCounts = new Map<string, number>();
	for (const e of [...persons, ...rsvps]) {
		state.set(e._id, { sharing: e._sharing?.[0]?.string, inherit: e._inheritrights?.[0]?.boolean });
	}

	const fetchImpl = vi.fn((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
		const url = String(input);
		const method = init?.method ?? 'GET';
		const parsedBody = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
		requests.push({ url, method, body: parsedBody });

		if (method === 'GET' && url === URLS.entityMeta) return json({ entities: [{ _id: ENTITY_META }] });
		if (method === 'GET' && url === URLS.propertyMeta) return json({ entities: [{ _id: PROPERTY_META }] });
		if (method === 'GET' && url === URLS.personType) return json({ entities: [{ _id: PERSON_TYPE }] });
		if (method === 'GET' && url === URLS.rsvpType) return json({ entities: [{ _id: RSVP_TYPE }] });
		if (method === 'GET' && url === URLS.personCap) return json({ entity: { _sharing: opts.personCap ? [{ _id: 'cap-p', string: opts.personCap }] : [] } });
		if (method === 'GET' && url === URLS.rsvpCap) return json({ entity: { _sharing: opts.rsvpCap ? [{ _id: 'cap-r', string: opts.rsvpCap }] : [] } });
		if (method === 'GET' && url === URLS.personPropDefs) {
			return json({ entities: (opts.personPropDefs ?? []).map((p) => ({ name: [{ string: p.name }], _sharing: p.sharing ? [{ string: p.sharing }] : [] })) });
		}
		if (method === 'GET' && url === URLS.rsvpPropDefs) {
			return json({ entities: (opts.rsvpPropDefs ?? []).map((p) => ({ name: [{ string: p.name }], _sharing: p.sharing ? [{ string: p.sharing }] : [] })) });
		}
		if (method === 'GET' && url === URLS.personCensus) {
			return json({ count: opts.personCountOverride ?? persons.length, entities: persons.map((p) => toCensusEntity(p, false)) });
		}
		if (method === 'GET' && url === URLS.rsvpCensus) {
			return json({ count: opts.rsvpCountOverride ?? rsvps.length, entities: rsvps.map((r) => toCensusEntity(r, true)) });
		}
		if (method === 'GET' && url === URLS.profileCensus) {
			return json({ count: opts.profileCountOverride ?? profileIds.length, entities: profileIds.map((id) => ({ _id: id })) });
		}

		const deleteMatch = url.match(new RegExp(`^${BASE}/property/(.+)$`));
		if (method === 'DELETE' && deleteMatch) return json({ deleted: true });

		const propertyGetMatch = url.match(new RegExp(`^${BASE}/property/([\\w-]+)$`));
		if (method === 'GET' && propertyGetMatch) {
			const propId = propertyGetMatch[1];
			const override = opts.propertyProbeOverrides?.[propId];
			if (override) return json(override.body ?? {}, override.status ?? 200);
			return json({ error: 'not found' }, 404);
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
			const callNumber = (readbackCallCounts.get(id) ?? 0) + 1;
			readbackCallCounts.set(id, callNumber);
			const override = callNumber >= 2 && opts.recheckOverrides?.[id] ? opts.recheckOverrides[id] : opts.readbackOverrides?.[id];
			const entry = state.get(id) ?? {};
			// 'in' checks, not `??`: an override explicitly setting `sharing:
			// undefined` (the "reverted to absent" shape) must NOT fall
			// through to the unchanged state value.
			const sharingStr = override && 'sharing' in override ? override.sharing : entry.sharing;
			const inheritCount = override && 'inheritCount' in override ? override.inheritCount : entry.inherit !== undefined ? 1 : 0;
			const sharingCount = override && 'sharingCount' in override ? override.sharingCount : sharingStr !== undefined ? 1 : 0;
			return json({
				entity: {
					_id: id,
					_sharing:
						sharingCount === 0
							? []
							: sharingCount === 2
								? [{ _id: `p-${id}-sh-a`, string: sharingStr }, { _id: `p-${id}-sh-b`, string: sharingStr }]
								: [{ _id: `p-${id}-sh`, string: sharingStr }],
					_inheritrights:
						inheritCount === 0
							? []
							: inheritCount === 2
								? [{ _id: `p-${id}-in-a`, boolean: entry.inherit }, { _id: `p-${id}-in-b`, boolean: entry.inherit }]
								: [{ _id: `p-${id}-in`, boolean: entry.inherit }]
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

describe('runSeed445 — gate ordering', () => {
	it('a live run with no authorizedBy throws before any fetch call', async () => {
		const { fetchImpl, requests } = makeWire();
		await expect(runSeed445(cfg, false, fetchImpl, undefined)).rejects.toThrow(/authorizedBy/);
		expect(requests).toEqual([]);
	});
});

describe('runSeed445 — census + schema-metadata reads', () => {
	it('hard-throws when the person census count disagrees with entities.length', async () => {
		const { fetchImpl } = makeWire({ persons: [{ _id: 'pe-1', _owner: [RUNNER_ID] }], personCountOverride: 5 });
		await expect(runSeed445(cfg, true, fetchImpl)).rejects.toThrow(/census truncated for 'person'/);
	});

	it('hard-throws when the rsvp census count disagrees with entities.length', async () => {
		const { fetchImpl } = makeWire({ rsvps: [{ _id: 'rs-1', _owner: [RUNNER_ID] }], rsvpCountOverride: 5 });
		await expect(runSeed445(cfg, true, fetchImpl)).rejects.toThrow(/census truncated for 'rsvp'/);
	});

	it('hard-throws when the profile census count disagrees with entities.length', async () => {
		const { fetchImpl } = makeWire({ profileIds: ['pr-1'], profileCountOverride: 5 });
		await expect(runSeed445(cfg, true, fetchImpl)).rejects.toThrow(/profile census truncated/);
	});

	it('reads type-def cap and prop-def visibility per type, correctly filtered and sorted', async () => {
		const { fetchImpl } = makeWire({
			personCap: 'domain',
			personPropDefs: [
				{ name: 'email', sharing: 'private' },
				{ name: 'name', sharing: 'domain' },
				{ name: 'photo', sharing: 'public' }
			],
			rsvpCap: undefined, // absent — blocks projection regardless of prop-def tiers
			rsvpPropDefs: [{ name: 'status', sharing: 'domain' }]
		});
		const result = await runSeed445(cfg, true, fetchImpl);
		expect(result.visibility.person).toEqual({ typeCap: 'domain', capBlocksProjection: false, domainVisiblePropDefNames: ['name', 'photo'] });
		expect(result.visibility.rsvp).toEqual({ typeCap: 'absent', capBlocksProjection: true, domainVisiblePropDefNames: [] });
	});
});

describe('runSeed445 — classification', () => {
	it('classifies alreadyDomain/needsSharing (with fromTier breakdown) and alreadyInherit/needsInherit', async () => {
		// All four rsvps share ONE parent person ('pe-1', itself already
		// compliant so it never enters the write plan) — this exercises the
		// fromTier breakdown across private/public/absent WITHOUT tripping
		// the moving-set scope fence (which is exercised on its own below).
		const persons: CensusEntity[] = [{ _id: 'pe-1', _sharing: [{ _id: 's0', string: 'domain' }], _inheritrights: [{ _id: 'i0', boolean: true }], _owner: [RUNNER_ID] }];
		const rsvps: CensusEntity[] = [
			{ _id: 'rs-domain-inherit', _sharing: [{ _id: 's1', string: 'domain' }], _inheritrights: [{ _id: 'i1', boolean: true }], _owner: [RUNNER_ID], _parent: 'pe-1' },
			{ _id: 'rs-absent-absent', _owner: [RUNNER_ID], _parent: 'pe-1' },
			{ _id: 'rs-private-false', _sharing: [{ _id: 's2', string: 'private' }], _inheritrights: [{ _id: 'i2', boolean: false }], _owner: [RUNNER_ID], _parent: 'pe-1' },
			{ _id: 'rs-public-false', _sharing: [{ _id: 's3', string: 'public' }], _inheritrights: [{ _id: 'i3', boolean: false }], _owner: [RUNNER_ID], _parent: 'pe-1' }
		];
		const { fetchImpl } = makeWire({ persons, rsvps });
		const result = await runSeed445(cfg, true, fetchImpl);

		expect(result.counts.rsvp).toEqual({
			total: 4,
			alreadyDomain: 1,
			needsSharing: 3,
			fromPrivate: 1,
			fromPublic: 1,
			fromAbsent: 1,
			alreadyInherit: 1,
			needsInherit: 3,
			toWrite: 3,
			failed: 0,
			wouldWrite: 3
		});
		expect(result.widerThanExpected).toBe(false);
		expect(result.movingPersonIdentityCount).toBe(1);
	});

	it('a dry run issues ONLY read-only GETs — zero POSTs, zero DELETEs', async () => {
		const { fetchImpl, requests } = makeWire({ persons: [{ _id: 'pe-1', _owner: [RUNNER_ID] }] });
		await runSeed445(cfg, true, fetchImpl);
		expect(requests.every((r) => r.method === 'GET')).toBe(true);
	});
});

describe('runSeed445 — multi-value abort', () => {
	it('stops before any write when an entity holds more than one _sharing or _inheritrights value', async () => {
		const persons: CensusEntity[] = [
			{ _id: 'pe-clean', _owner: [RUNNER_ID] },
			{ _id: 'pe-multi', _owner: [RUNNER_ID] }
		];
		(persons[1] as CensusEntity)._sharing = [{ _id: 's-a', string: 'private' }, { _id: 's-b', string: 'public' }];
		const { fetchImpl, requests } = makeWire({ persons });

		await expect(runSeed445(cfg, true, fetchImpl, undefined)).rejects.toThrow(/more than one _sharing\/_inheritrights value/);
		expect(requests.some((r) => r.method !== 'GET')).toBe(false);
		expect(writeLedgerMock.mock.calls[0][0]).toMatchObject({ payload: expect.objectContaining({ outcome: 'aborted-multi-value' }) });
	});
});

describe('runSeed445 — scope fence: profile overlap', () => {
	it('aborts before any write if a would-write id also appears in the profile census', async () => {
		const { fetchImpl } = makeWire({
			persons: [{ _id: 'pe-1', _owner: [RUNNER_ID] }],
			profileIds: ['pe-1']
		});
		await expect(runSeed445(cfg, true, fetchImpl, undefined)).rejects.toThrow(/ALSO profile ids/);
		expect(writeLedgerMock.mock.calls[0][0]).toMatchObject({ payload: expect.objectContaining({ outcome: 'aborted-profile-overlap', profileOverlap: ['pe-1'] }) });
	});

	it('does not abort when profile ids are disjoint from the write plan', async () => {
		const { fetchImpl } = makeWire({ persons: [{ _id: 'pe-1', _owner: [RUNNER_ID] }], profileIds: ['pr-unrelated'] });
		const result = await runSeed445(cfg, true, fetchImpl);
		expect(result.counts.person.toWrite).toBe(1);
	});
});

describe('runSeed445 — scope fence: moving-set expectation (Mihkel: only his own person + rsvps)', () => {
	it('does NOT abort when the moving set is exactly one person plus that person\'s own rsvps', async () => {
		const { fetchImpl } = makeWire({
			persons: [{ _id: 'pe-1', _owner: [RUNNER_ID] }],
			rsvps: [
				{ _id: 'rs-1', _owner: [RUNNER_ID], _parent: 'pe-1' },
				{ _id: 'rs-2', _owner: [RUNNER_ID], _parent: 'pe-1' }
			]
		});
		const result = await runSeed445(cfg, true, fetchImpl);
		expect(result.widerThanExpected).toBe(false);
		expect(result.movingPersonIdentityCount).toBe(1);
		expect(result.movingSet).toEqual([
			{ id: 'pe-1', type: 'person', fromSharing: 'absent' },
			{ id: 'rs-1', type: 'rsvp', fromSharing: 'absent' },
			{ id: 'rs-2', type: 'rsvp', fromSharing: 'absent' }
		]);
	});

	it('aborts before any write when a moving rsvp belongs to a DIFFERENT person than the one moving', async () => {
		const { fetchImpl, requests } = makeWire({
			persons: [{ _id: 'pe-1', _owner: [RUNNER_ID] }],
			rsvps: [{ _id: 'rs-other', _owner: [RUNNER_ID], _parent: 'pe-someone-else' }]
		});
		await expect(runSeed445(cfg, true, fetchImpl, undefined)).rejects.toThrow(/spans 2 distinct person identities/);
		expect(requests.some((r) => r.method !== 'GET')).toBe(false);
		expect(writeLedgerMock.mock.calls[0][0]).toMatchObject({ payload: expect.objectContaining({ outcome: 'aborted-wider-than-expected', widerThanExpected: true }) });
	});

	it('aborts when TWO different persons both need the move, even with no rsvps at all', async () => {
		const { fetchImpl } = makeWire({
			persons: [
				{ _id: 'pe-1', _owner: [RUNNER_ID] },
				{ _id: 'pe-2', _owner: [RUNNER_ID] }
			]
		});
		await expect(runSeed445(cfg, true, fetchImpl, undefined)).rejects.toThrow(/spans 2 distinct person identities/);
	});
});

describe('runSeed445 — ER-11 rights preflight (_owner only, never _editor)', () => {
	it('aborts before any write when the runner is absent from _owner, even with _editor present', async () => {
		const { fetchImpl, requests } = makeWire({ persons: [{ _id: 'pe-no-owner', _editor: [RUNNER_ID] }] });
		await expect(runSeed445(cfg, true, fetchImpl, undefined)).rejects.toThrow(/rights preflight failed for 1 entity/);
		expect(requests.some((r) => r.method !== 'GET')).toBe(false);
		expect(writeLedgerMock.mock.calls[0][0]).toMatchObject({
			payload: expect.objectContaining({ outcome: 'aborted-rights', noRights: [{ id: 'pe-no-owner', type: 'person' }] })
		});
	});
});

describe('runSeed445 — live write', () => {
	it('DELETEs a prior _sharing value then POSTs domain; POSTs _inheritrights with no DELETE when absent; single combined read-back', async () => {
		const { fetchImpl, requests } = makeWire({
			persons: [{ _id: 'pe-w1', _sharing: [{ _id: 'old-sh', string: 'private' }], _owner: [RUNNER_ID] }]
		});
		const result = await runSeed445(cfg, false, fetchImpl, LIVE_AUTH, NO_DELAY, noSleep);

		expect(result.counts.person.written).toBe(1);
		const mutating = requests.filter((r) => r.method !== 'GET' || /\?props=_sharing,_inheritrights$/.test(r.url));
		expect(mutating).toEqual([
			{ url: `${BASE}/property/old-sh`, method: 'DELETE', body: null },
			{ url: `${BASE}/entity/pe-w1`, method: 'POST', body: [{ type: '_sharing', string: 'domain' }] },
			{ url: `${BASE}/entity/pe-w1`, method: 'POST', body: [{ type: '_inheritrights', boolean: true }] },
			{ url: `${BASE}/entity/pe-w1?props=_sharing,_inheritrights`, method: 'GET', body: null },
			// #445 (team-lead, 2nd round) — the post-run delayed recheck reads
			// the same written row a second time, same URL shape.
			{ url: `${BASE}/entity/pe-w1?props=_sharing,_inheritrights`, method: 'GET', body: null }
		]);

		expect(result.postRunRecheck).toEqual([{ id: 'pe-w1', status: 200, _sharing: [{ _id: 'p-pe-w1-sh', string: 'domain' }], _inheritrights: [{ _id: 'p-pe-w1-in', boolean: true }], stillCorrect: true }]);
	});

	it("records every written row's returned property ids in the ledger", async () => {
		const { fetchImpl } = makeWire({
			persons: [{ _id: 'pe-w2', _sharing: [{ _id: 'old-sh2', string: 'private' }], _owner: [RUNNER_ID] }]
		});
		await runSeed445(cfg, false, fetchImpl, LIVE_AUTH, NO_DELAY, noSleep);
		const payload = writeLedgerMock.mock.calls.at(-1)?.[0]?.payload;
		expect(payload.writtenPropertyIds).toEqual([{ id: 'pe-w2', sharingPropertyId: 'p-pe-w2-_sharing-new', inheritPropertyId: 'p-pe-w2-_inheritrights-new' }]);
	});

	it('the delayed recheck catches a row that PASSED its own read-back and reverted moments later — the exact live shape (6a9c3d37...292)', async () => {
		const { fetchImpl } = makeWire({
			persons: [{ _id: 'pe-reverts', _owner: [RUNNER_ID] }],
			// recheckOverrides apply from the SECOND read-back call onward —
			// the in-loop read-back (call 1) sees the write succeed; the
			// delayed postRunRecheck (call 2) sees it gone, same as the live
			// anomaly on 6a9c3d37...292.
			recheckOverrides: { 'pe-reverts': { sharing: undefined, inheritCount: 0 } }
		});
		const result = await runSeed445(cfg, false, fetchImpl, LIVE_AUTH, NO_DELAY, noSleep);

		// the write itself succeeded — the in-loop read-back was clean
		expect(result.counts.person.written).toBe(1);
		expect(result.counts.person.failed).toBe(0);
		// but the delayed recheck caught the reversion, dated by this run
		expect(result.postRunRecheck).toEqual([{ id: 'pe-reverts', status: 200, _sharing: [], _inheritrights: [], stillCorrect: false }]);
	});

	it('a read-back mismatch on _sharing records the entity failed, writes the ledger, and throws', async () => {
		const { fetchImpl } = makeWire({
			persons: [{ _id: 'pe-bad', _owner: [RUNNER_ID] }],
			readbackOverrides: { 'pe-bad': { sharing: 'private' } }
		});
		await expect(runSeed445(cfg, false, fetchImpl, LIVE_AUTH, NO_DELAY, noSleep)).rejects.toThrow(/READ-BACK _sharing mismatch/);
		expect(writeLedgerMock.mock.calls.at(-1)?.[0]).toMatchObject({ payload: expect.objectContaining({ failedIds: ['pe-bad'] }) });
	});
});

describe('runSeed445 — hidden pre-existing value self-heal (#445, 3rd round: 6a9c3d37...292 / 6a9c3d38...729b shape)', () => {
	it('a duplicate found at read-back self-heals: deletes THIS RUN\'S own posted id, converges to the hidden pre-existing value, classifies pre-existing-hidden, no duplicate left', async () => {
		const { fetchImpl, requests } = makeWire({
			persons: [{ _id: 'pe-hidden', _owner: [RUNNER_ID] }],
			// call 1 (in-loop read-back): _sharing shows TWO values — this
			// run's own fresh POST landed beside a hidden pre-existing one.
			readbackOverrides: { 'pe-hidden': { sharingCount: 2 } },
			// call 2+ (self-heal re-read, then postRunRecheck): back to one
			// correct value, as if the self-heal delete converged it.
			recheckOverrides: { 'pe-hidden': { sharingCount: 1, sharing: 'domain' } }
		});
		const result = await runSeed445(cfg, false, fetchImpl, LIVE_AUTH, NO_DELAY, noSleep);

		expect(result.counts.person.written).toBe(1);
		expect(result.counts.person.failed).toBe(0);
		expect(result.counts.person.preExistingHidden).toBe(1);

		// the self-heal DELETE targets the id THIS RUN'S OWN POST returned
		expect(requests).toContainEqual({ url: `${BASE}/property/p-pe-hidden-_sharing-new`, method: 'DELETE', body: null });

		const payload = writeLedgerMock.mock.calls.at(-1)?.[0]?.payload;
		expect(payload.preExistingHiddenIds).toEqual(['pe-hidden']);
		expect(payload.writtenIds).toEqual(['pe-hidden']);
	});

	it('self-heal deletes the run\'s own id but a WRONG value remains — aborts, never guesses', async () => {
		const { fetchImpl } = makeWire({
			persons: [{ _id: 'pe-wrong-hidden', _owner: [RUNNER_ID] }],
			readbackOverrides: { 'pe-wrong-hidden': { sharingCount: 2 } },
			// after self-heal, the remaining value is present but WRONG
			// (private, not domain) — must abort, not accept it.
			recheckOverrides: { 'pe-wrong-hidden': { sharingCount: 1, sharing: 'private' } }
		});
		await expect(runSeed445(cfg, false, fetchImpl, LIVE_AUTH, NO_DELAY, noSleep)).rejects.toThrow(/READ-BACK _sharing mismatch/);

		const payload = writeLedgerMock.mock.calls.at(-1)?.[0]?.payload;
		expect(payload.failedIds).toEqual(['pe-wrong-hidden']);
		const diag = payload.failureDiagnostics[0];
		expect(diag.sharingSelfHealDelete).toMatchObject({ propertyId: 'p-pe-wrong-hidden-_sharing-new', status: 200 });
	});

	it('self-heal deletes the run\'s own id but the property is STILL multiple — aborts, never guesses', async () => {
		const { fetchImpl } = makeWire({
			persons: [{ _id: 'pe-still-multi', _owner: [RUNNER_ID] }],
			readbackOverrides: { 'pe-still-multi': { sharingCount: 2 } },
			// after self-heal, still two values (a THIRD one existed) — abort.
			recheckOverrides: { 'pe-still-multi': { sharingCount: 2, sharing: 'domain' } }
		});
		await expect(runSeed445(cfg, false, fetchImpl, LIVE_AUTH, NO_DELAY, noSleep)).rejects.toThrow(/READ-BACK _sharing mismatch/);
	});
});

describe('runSeed445 — failure diagnostics (#445, closes the ledger gap: a 2xx POST followed by an empty read-back)', () => {
	it('records the request bodies, POST status+body (incl. the returned property _id), and the read-back status+body', async () => {
		const { fetchImpl } = makeWire({
			persons: [{ _id: 'pe-bad', _owner: [RUNNER_ID] }],
			readbackOverrides: { 'pe-bad': { sharing: 'private' } }
		});
		await expect(runSeed445(cfg, false, fetchImpl, LIVE_AUTH, NO_DELAY, noSleep)).rejects.toThrow(/READ-BACK _sharing mismatch/);

		const payload = writeLedgerMock.mock.calls.at(-1)?.[0]?.payload;
		expect(payload.failureDiagnostics).toEqual([
			{
				entityId: 'pe-bad',
				sharingPost: {
					requestBody: [{ type: '_sharing', string: 'domain' }],
					status: 200,
					body: { properties: [{ _id: 'p-pe-bad-_sharing-new', type: '_sharing' }] }
				},
				inheritPost: {
					requestBody: [{ type: '_inheritrights', boolean: true }],
					status: 200,
					body: { properties: [{ _id: 'p-pe-bad-_inheritrights-new', type: '_inheritrights' }] }
				},
				readback: {
					status: 200,
					body: { entity: { _id: 'pe-bad', _sharing: [{ _id: 'p-pe-bad-sh', string: 'private' }], _inheritrights: [{ _id: 'p-pe-bad-in', boolean: true }] } }
				},
				sharingPropertyProbe: { propertyId: 'p-pe-bad-_sharing-new', status: 404, body: { error: 'not found' } },
				inheritPropertyProbe: { propertyId: 'p-pe-bad-_inheritrights-new', status: 404, body: { error: 'not found' } }
			}
		]);
	});

	it('when the property probe finds the value present after all, its body is recorded verbatim — the exact "2xx POST, nothing persisted at read-back, but IS there moments later" shape', async () => {
		const { fetchImpl } = makeWire({
			persons: [{ _id: 'pe-ghost', _owner: [RUNNER_ID] }],
			readbackOverrides: { 'pe-ghost': { sharing: 'private' } },
			propertyProbeOverrides: {
				'p-pe-ghost-_sharing-new': {
					status: 200,
					body: { _id: 'p-pe-ghost-_sharing-new', type: '_sharing', string: 'domain', entity: 'pe-ghost', created: { at: '2026-09-22T10:42:48.000Z', by: RUNNER_ID } }
				}
			}
		});
		await expect(runSeed445(cfg, false, fetchImpl, LIVE_AUTH, NO_DELAY, noSleep)).rejects.toThrow(/READ-BACK _sharing mismatch/);

		const payload = writeLedgerMock.mock.calls.at(-1)?.[0]?.payload;
		expect(payload.failureDiagnostics[0].sharingPropertyProbe).toEqual({
			propertyId: 'p-pe-ghost-_sharing-new',
			status: 200,
			body: { _id: 'p-pe-ghost-_sharing-new', type: '_sharing', string: 'domain', entity: 'pe-ghost', created: { at: '2026-09-22T10:42:48.000Z', by: RUNNER_ID } }
		});
	});
});

describe('runSeed445 — rerun posture', () => {
	it('a re-run over an already-fully-compliant estate writes zero and reports rerun:true', async () => {
		const { fetchImpl } = makeWire({
			persons: [{ _id: 'pe-done', _sharing: [{ _id: 's1', string: 'domain' }], _inheritrights: [{ _id: 'i1', boolean: true }], _owner: [RUNNER_ID] }]
		});
		const result = await runSeed445(cfg, true, fetchImpl);
		expect(result.rerun).toBe(true);
		expect(result.counts.person.wouldWrite).toBe(0);
	});

	it('an empty estate is NOT a healthy rerun', async () => {
		const { fetchImpl } = makeWire();
		const result = await runSeed445(cfg, true, fetchImpl);
		expect(result.rerun).toBe(false);
	});
});

describe('runSeed445 — ledger authorization threading', () => {
	it('a live run threads the recorded authorizer through to writeLedger', async () => {
		const { fetchImpl } = makeWire({
			persons: [{ _id: 'pe-1', _sharing: [{ _id: 's1', string: 'domain' }], _inheritrights: [{ _id: 'i1', boolean: true }] }]
		});
		await runSeed445(cfg, false, fetchImpl, LIVE_AUTH, NO_DELAY, noSleep);
		expect(writeLedgerMock.mock.calls[0][0]).toMatchObject({ authorizedBy: LIVE_AUTH, dryRun: false });
	});
});
