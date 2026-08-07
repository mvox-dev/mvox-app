import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetTypeIdCache, type EntuCfg } from '$lib/seasons/entuSeasons';
import {
	buildPlan,
	enumerateTargets,
	migrateOneGroup,
	deletePersonField,
	renderPlan,
	MigrationLedger,
	type LedgerEntry,
	type MigrationGroup,
	type TargetPerson
} from './t4-10-plan';

// ════════════════════════════════════════════════════════════════════════════
// T4.10 migration (#30) — RED. The engine in `t4-10-plan.ts` is a stub throwing
// 'not implemented', so every assertion below FAILS until GREEN. Specs mirror the
// repo idiom (profileData.spec.ts): inject `fetchImpl = vi.fn()` routing by URL
// substring + `init.method`; a `json(body,status)` helper wrapping `new Response`;
// assert on the request WIRE, never by spying siblings. Zero network — all mocked.
//
// NO agent runs this against live polyphony; this file only proves the built script.
// ════════════════════════════════════════════════════════════════════════════

const cfg: EntuCfg = { db: 'testdb', token: 'jwt' };

// The 3 real persons (RECON A §1). db-root/PO is private (both fields); Mihkel's
// OAuth person is domain (both fields); Test User is domain (name only).
const PO = '69bcfd8e9c031ab8e6ce8079';
const OAUTH = '6a2fc05e4cd971291c5d5ddc';
const TESTUSER = '6a097dcc90c8df7a1cc7d6dd';

// #30 exclusion — PO (db-root) is excluded from the migration entirely (see
// `enumerateTargets` describe block below), so it is no longer a fixture that
// `buildPlan` needs to receive in practice. The private→domain name-promotion +
// email-tier-preservation logic the engine RETAINS is still real for any future
// private-tier person, so its coverage moves to a synthetic id — not PO — to avoid
// implying PO still flows through the pipeline.
const SYNTHETIC_PRIVATE = 'synthetic-private-1';

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), { status });
}

beforeEach(() => {
	resetTypeIdCache();
});

// ── A tiny in-memory Entu, faithful enough that the REAL imported data layer
// (createProfile/saveProfileFields/listMyProfiles) drives the happy path end-to-end.
// Routes by method + URL. Optional `fail` injects a single-operation failure so the
// per-record engine's fail-loud branches can be exercised in isolation.
type PersonValues = { name?: Array<{ _id: string; string: string }>; email?: Array<{ _id: string; string: string }> };
type LiveMockOpts = {
	persons: Record<string, PersonValues>;
	fail?: {
		create?: number; // create POST → this status
		createNoId?: boolean; // create POST → 200 with no _id (apparent-success trap)
		valuePost?: number; // saveProfileFields value POST → this status
		verifyMissing?: boolean; // populated profile reads back WITHOUT the value → verify-profile fails
		delete?: number; // person property DELETE → this status
		deleteNoop?: boolean; // DELETE returns 200 but the value PERSISTS on the person → readback-person fails
	};
};

function makeLiveMock(opts: LiveMockOpts) {
	// Deep-clone the seed so a DELETE mutating the person store can't leak across tests.
	const persons: Record<string, PersonValues> = JSON.parse(JSON.stringify(opts.persons));
	const profiles: Array<{ _id: string; _parent: string; _sharing: string; name?: string; email?: string }> = [];
	let seq = 0;
	const fail = opts.fail ?? {};

	function parseSeg(url: string, seg: 'entity' | 'property'): string | null {
		const m = url.match(new RegExp(`/${seg}/([^/?]+)`));
		return m ? m[1] : null;
	}
	function parseParent(url: string): string {
		return decodeURIComponent(url.match(/_parent\.reference=([^&]+)/)?.[1] ?? '');
	}

	return vi.fn().mockImplementation((url: string, init?: RequestInit) => {
		const method = (init?.method ?? 'GET').toUpperCase();

		// resolveTypeId(cfg,'profile') — the funnel marker.
		if (method === 'GET' && url.includes('_type.string=entity')) {
			return Promise.resolve(json({ entities: [{ _id: 'profile-type-id' }] }));
		}

		// listMyProfiles — read the created profiles under a parent (verify-profile read-back).
		if (method === 'GET' && url.includes('_type.string=profile')) {
			const parent = parseParent(url);
			const ents = profiles
				.filter((p) => p._parent === parent)
				.map((p) => ({
					_id: p._id,
					name: p.name != null ? [{ string: p.name }] : undefined,
					email: p.email != null ? [{ string: p.email }] : undefined,
					_sharing: [{ string: p._sharing }]
				}));
			return Promise.resolve(json({ entities: ents }));
		}

		// DELETE property/{id} — remove the value from its person (unless a failure is injected).
		const propId = parseSeg(url, 'property');
		if (method === 'DELETE' && propId) {
			if (fail.delete) return Promise.resolve(json({}, fail.delete));
			if (!fail.deleteNoop) {
				for (const pv of Object.values(persons)) {
					if (pv.name) pv.name = pv.name.filter((v) => v._id !== propId);
					if (pv.email) pv.email = pv.email.filter((v) => v._id !== propId);
				}
			}
			return Promise.resolve(json({}));
		}

		const entId = parseSeg(url, 'entity');

		// POST entity/{id} — saveProfileFields writing name/email into the profile shell.
		if (method === 'POST' && entId) {
			if (fail.valuePost) return Promise.resolve(json({}, fail.valuePost));
			const prof = profiles.find((p) => p._id === entId);
			if (prof && !fail.verifyMissing) {
				const body = JSON.parse(String(init!.body)) as Array<{ type: string; string?: string }>;
				for (const p of body) {
					if (p.type === 'name') prof.name = p.string;
					if (p.type === 'email') prof.email = p.string;
				}
			}
			return Promise.resolve(json({ _id: entId }));
		}

		// POST entity (no id) — createProfile shell create.
		if (method === 'POST' && /\/entity(\?|$)/.test(url)) {
			if (fail.create) return Promise.resolve(json({}, fail.create));
			if (fail.createNoId) return Promise.resolve(json({})); // 200, no _id
			const body = JSON.parse(String(init!.body)) as Array<{ type: string; reference?: string; string?: string }>;
			const id = `new-prof-${++seq}`;
			profiles.push({
				_id: id,
				_parent: body.find((p) => p.type === '_parent')?.reference ?? '',
				_sharing: body.find((p) => p.type === '_sharing')?.string ?? ''
			});
			return Promise.resolve(json({ _id: id }));
		}

		// GET entity/{id}?props=name,email — a person (delete-lookup / person read-back) or a profile shell (saveProfileFields lookup).
		if (method === 'GET' && entId) {
			if (persons[entId]) return Promise.resolve(json({ entity: { _id: entId, ...persons[entId] } }));
			const prof = profiles.find((p) => p._id === entId);
			return Promise.resolve(json({ entity: { _id: entId, ...(prof ?? {}) } }));
		}

		throw new Error(`unrouted mock request: ${method} ${url}`);
	});
}

const deleteCalls = (m: ReturnType<typeof vi.fn>) =>
	(m.mock.calls as Array<[string, RequestInit?]>).filter(([, init]) => (init?.method ?? '').toUpperCase() === 'DELETE');

// ════════════════════════════════════════════════════════════════════════════
// buildPlan — PURE. The 3 known persons → exactly 4 groups (name→domain always;
// email→source tier; same-tier fields share one profile).
// ════════════════════════════════════════════════════════════════════════════

describe('buildPlan — pure grouping into profile creates', () => {
	// PO is intentionally NOT a fixture here (#30 exclusion — see enumerateTargets
	// below); the private-tier split/promotion logic is exercised via a synthetic
	// private person instead, since it stays live engine behavior for any future
	// private-tier person even though PO himself never reaches buildPlan.
	const targets: TargetPerson[] = [
		{ personId: SYNTHETIC_PRIVATE, name: 'Mihkel Putrinš', email: 'mitselek@gmail.com', sourceTier: 'private' },
		{ personId: OAUTH, name: 'Mihkel Putrinš', email: 'mihkel.putrinsh@gmail.com', sourceTier: 'domain' },
		{ personId: TESTUSER, name: 'Test User', sourceTier: 'domain' }
	];

	it('yields exactly 4 groups (4 profile creates) for the 3 real persons', () => {
		expect(buildPlan(targets)).toHaveLength(4);
	});

	it('a private-tier person (both fields) splits into a domain{name} group + a private{email} group', () => {
		const groups = buildPlan(targets).filter((g) => g.personId === SYNTHETIC_PRIVATE);
		expect(groups).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ personId: SYNTHETIC_PRIVATE, tier: 'domain', fields: { name: 'Mihkel Putrinš' }, ownerIds: [SYNTHETIC_PRIVATE] }),
				expect.objectContaining({ personId: SYNTHETIC_PRIVATE, tier: 'private', fields: { email: 'mitselek@gmail.com' }, ownerIds: [SYNTHETIC_PRIVATE] })
			])
		);
		expect(groups).toHaveLength(2);
	});

	it('OAUTH (domain, both fields) collapses name+email into ONE domain group', () => {
		const groups = buildPlan(targets).filter((g) => g.personId === OAUTH);
		expect(groups).toHaveLength(1);
		expect(groups[0]).toEqual(
			expect.objectContaining({
				personId: OAUTH,
				tier: 'domain',
				fields: { name: 'Mihkel Putrinš', email: 'mihkel.putrinsh@gmail.com' },
				ownerIds: [OAUTH]
			})
		);
	});

	it('Test User (domain, name only) → ONE domain group with name only', () => {
		const groups = buildPlan(targets).filter((g) => g.personId === TESTUSER);
		expect(groups).toEqual([
			expect.objectContaining({ personId: TESTUSER, tier: 'domain', fields: { name: 'Test User' }, ownerIds: [TESTUSER] })
		]);
	});

	it('name ALWAYS targets domain (even for a private-tier person) — the T4.8 gate reads only the domain profile', () => {
		const nameGroups = buildPlan(targets).filter((g) => 'name' in g.fields);
		expect(nameGroups.every((g) => g.tier === 'domain')).toBe(true);
	});

	it('email PRESERVES its source tier: private → private, domain → domain (move-not-copy never re-exposes)', () => {
		const groups = buildPlan(targets);
		const privateEmail = groups.find((g) => g.personId === SYNTHETIC_PRIVATE && 'email' in g.fields);
		const oauthEmail = groups.find((g) => g.personId === OAUTH && 'email' in g.fields);
		expect(privateEmail?.tier).toBe('private');
		expect(oauthEmail?.tier).toBe('domain');
	});

	it('ownerIds is always [personId] — the member owns her own profile', () => {
		for (const g of buildPlan(targets)) expect(g.ownerIds).toEqual([g.personId]);
	});
});

// ════════════════════════════════════════════════════════════════════════════
// enumerateTargets — synthetic-exclusion + one-page guard + drift tripwire.
// ════════════════════════════════════════════════════════════════════════════

describe('enumerateTargets — synthetic-exclusion + guards (READ-ONLY)', () => {
	// A census page: 128 public-tier synthetic singers + the 3 real persons.
	function censusPage(reals: Array<{ _id: string; sharing: string; name?: string; email?: string }>) {
		const synthetic = Array.from({ length: 128 }, (_, i) => ({
			_id: `synthetic-${i}`,
			name: [{ string: `Singer ${i}` }],
			_sharing: [{ string: 'public' }]
		}));
		const realEntities = reals.map((r) => ({
			_id: r._id,
			name: r.name != null ? [{ string: r.name }] : undefined,
			email: r.email != null ? [{ string: r.email }] : undefined,
			_sharing: [{ string: r.sharing }]
		}));
		const entities = [...synthetic, ...realEntities];
		return { entities, count: entities.length };
	}

	const REAL_TRIO = [
		{ _id: PO, sharing: 'private', name: 'Mihkel Putrinš', email: 'mitselek@gmail.com' },
		{ _id: OAUTH, sharing: 'domain', name: 'Mihkel Putrinš', email: 'mihkel.putrinsh@gmail.com' },
		{ _id: TESTUSER, sharing: 'domain', name: 'Test User' }
	];

	function pageMock(page: unknown) {
		return vi.fn().mockResolvedValue(json(page));
	}

	it('excludes the 128 synthetic public-tier singers AND the excluded db-root/PO person; the remaining 2 real persons proceed WITHOUT a drift HALT (#30 exclusion)', async () => {
		const targets = await enumerateTargets(cfg, pageMock(censusPage(REAL_TRIO)));
		expect(targets.map((t) => t.personId).sort()).toEqual([OAUTH, TESTUSER].sort());
		expect(targets.some((t) => t.personId === PO)).toBe(false);
		expect(targets.some((t) => t.personId.startsWith('synthetic-'))).toBe(false);
		expect(targets).toHaveLength(2);
	});

	it('carries each remaining real person source tier + values off the props projection (no ?name.string= filter)', async () => {
		const targets = await enumerateTargets(cfg, pageMock(censusPage(REAL_TRIO)));
		expect(targets.find((t) => t.personId === OAUTH)).toEqual(
			expect.objectContaining({ personId: OAUTH, sourceTier: 'domain', name: 'Mihkel Putrinš', email: 'mihkel.putrinsh@gmail.com' })
		);
		expect(targets.find((t) => t.personId === TESTUSER)).toEqual(
			expect.objectContaining({ personId: TESTUSER, sourceTier: 'domain', name: 'Test User' })
		);
	});

	// ── #30 exclusion mechanism invariants ────────────────────────────────────────
	// PO (db-root/PO, `69bcfd8e9c031ab8e6ce8079`) is EXCLUDED from the migration by
	// design (private, structurally different from real members) — but the selector
	// is `_sharing !== 'public'`, not EXPECTED_TARGET_IDS (a drift tripwire only), so
	// PO still passes the selector and must be filtered separately, BEFORE the drift
	// check (else shrinking EXPECTED_TARGET_IDS alone would make the drift guard HALT
	// the whole run on PO as "unexpected"). Hard-coding the PO id here rather than
	// importing a not-yet-existent EXCLUDED_TARGET_IDS — RED must fail on the
	// assertions, not on a missing export.

	it('does NOT weaken the drift tripwire into "ignore anything unexpected": an unexpected 4th non-public person (neither expected nor excluded) still HALTs', async () => {
		const UNEXPECTED = '6bffffff00000000000000f';
		const page = censusPage([...REAL_TRIO, { _id: UNEXPECTED, sharing: 'domain', name: 'Someone New' }]);
		const mock = pageMock(page);
		await expect(enumerateTargets(cfg, mock)).rejects.toThrow(new RegExp(`drift|${UNEXPECTED}|unexpected`, 'i'));
		expect(deleteCalls(mock)).toEqual([]);
	});

	it('HALTs (stale exclusion) when the excluded db-root/PO person is entirely absent from the live non-public set — refuse rather than silently proceed', async () => {
		const page = censusPage([
			{ _id: OAUTH, sharing: 'domain', name: 'Mihkel Putrinš', email: 'mihkel.putrinsh@gmail.com' },
			{ _id: TESTUSER, sharing: 'domain', name: 'Test User' }
		]);
		await expect(enumerateTargets(cfg, pageMock(page))).rejects.toThrow(new RegExp(PO));
	});

	it('HALTs (stale exclusion) when the excluded db-root/PO person IS present but its tier is no longer private — the exclusion assumption no longer holds', async () => {
		const page = censusPage([
			{ _id: PO, sharing: 'domain', name: 'Mihkel Putrinš', email: 'mitselek@gmail.com' },
			{ _id: OAUTH, sharing: 'domain', name: 'Mihkel Putrinš', email: 'mihkel.putrinsh@gmail.com' },
			{ _id: TESTUSER, sharing: 'domain', name: 'Test User' }
		]);
		await expect(enumerateTargets(cfg, pageMock(page))).rejects.toThrow(new RegExp(PO));
	});

	it('the enumeration query is a READ — issues no POST and no DELETE', async () => {
		const mock = pageMock(censusPage(REAL_TRIO));
		await enumerateTargets(cfg, mock);
		const mutating = (mock.mock.calls as Array<[string, RequestInit?]>).filter(([, init]) =>
			['POST', 'DELETE', 'PUT'].includes((init?.method ?? 'GET').toUpperCase())
		);
		expect(mutating).toEqual([]);
	});

	it('HALTs when the page is truncated (count !== entities.length), naming both numbers', async () => {
		const page = censusPage(REAL_TRIO);
		const truncated = { entities: page.entities, count: page.count + 5 };
		await expect(enumerateTargets(cfg, pageMock(truncated))).rejects.toThrow(/\b131\b[\s\S]*\b136\b|\b136\b[\s\S]*\b131\b/);
	});

	it('HALTs (drift) when a synthetic drifts OFF public into the real set — zero writes', async () => {
		const drifted = censusPage([...REAL_TRIO, { _id: 'synthetic-rogue', sharing: 'domain', name: 'Rogue' }]);
		const mock = pageMock(drifted);
		await expect(enumerateTargets(cfg, mock)).rejects.toThrow(/drift|synthetic-rogue|expected/i);
		expect(deleteCalls(mock)).toEqual([]);
	});

	it('HALTs (drift) when a real person id goes MISSING from the filtered set', async () => {
		const missing = censusPage(REAL_TRIO.filter((r) => r._id !== TESTUSER));
		await expect(enumerateTargets(cfg, pageMock(missing))).rejects.toThrow(new RegExp(TESTUSER));
	});

	it('HALTs (zero writes) when a real person carries MULTIPLE name values — copy-one/delete-all would silently destroy the rest', async () => {
		// OAUTH (not PO) carries the violation: PO is excluded from migration BEFORE
		// this guard runs (#30 exclusion, filtered out of `reals` pre-drift-check), so a
		// multi-valued PO would never reach it — the guard must still catch a genuinely
		// in-scope person. PO stays present+single-valued here as ordinary census noise.
		const page = {
			entities: [
				{ _id: PO, _sharing: [{ string: 'private' }], name: [{ string: 'Mihkel Putrinš' }], email: [{ string: 'mitselek@gmail.com' }] },
				{ _id: OAUTH, _sharing: [{ string: 'domain' }], name: [{ string: 'Mihkel Putrinš' }, { string: 'M. Putrinš' }], email: [{ string: 'mihkel.putrinsh@gmail.com' }] },
				{ _id: TESTUSER, _sharing: [{ string: 'domain' }], name: [{ string: 'Test User' }] }
			],
			count: 3
		};
		const mock = pageMock(page);
		await expect(enumerateTargets(cfg, mock)).rejects.toThrow(new RegExp(`${OAUTH}[\\s\\S]*name|multi|value\\[0\\]`, 'i'));
		expect(deleteCalls(mock)).toEqual([]);
	});
});

// ════════════════════════════════════════════════════════════════════════════
// migrateOneGroup — the per-record move engine. Create-before-delete + dual
// read-back; ledger (never throws for a per-record failure).
// ════════════════════════════════════════════════════════════════════════════

describe('migrateOneGroup — happy path (move, per record)', () => {
	const group: MigrationGroup = {
		personId: OAUTH,
		tier: 'domain',
		fields: { name: 'Mihkel Putrinš', email: 'mihkel.putrinsh@gmail.com' },
		ownerIds: [OAUTH]
	};
	function seedMock() {
		return makeLiveMock({
			persons: {
				[OAUTH]: {
					name: [{ _id: 'val-name-oauth', string: 'Mihkel Putrinš' }],
					email: [{ _id: 'val-email-oauth', string: 'mihkel.putrinsh@gmail.com' }]
				}
			}
		});
	}

	it('returns a `moved` entry per field, each proven by profile-present AND person-absent read-back', async () => {
		const entries = await migrateOneGroup(cfg, group, seedMock());
		expect(entries).toHaveLength(2);
		for (const field of ['name', 'email'] as const) {
			const e = entries.find((x) => x.field === field)!;
			expect(e).toMatchObject({ personId: OAUTH, field, status: 'moved', targetTier: 'domain' });
			expect(e.profileId).toBeTruthy();
		}
	});

	it('creates the profile via createProfile with _inheritrights:false + _sharing:domain + one _owner per ownerId', async () => {
		const mock = seedMock();
		await migrateOneGroup(cfg, group, mock);
		const createPost = (mock.mock.calls as Array<[string, RequestInit?]>).find(
			([url, init]) => (init?.method ?? '').toUpperCase() === 'POST' && /\/entity$/.test(url.split('?')[0])
		);
		expect(createPost).toBeDefined();
		const body = JSON.parse(String(createPost![1]!.body)) as Array<{ type: string; reference?: string; string?: string; boolean?: boolean }>;
		expect(body).toEqual(
			expect.arrayContaining([
				{ type: '_type', reference: 'profile-type-id' },
				{ type: '_parent', reference: OAUTH },
				{ type: '_inheritrights', boolean: false },
				{ type: '_sharing', string: 'domain' },
				{ type: '_owner', reference: OAUTH }
			])
		);
		expect(body.filter((p) => p.type === '_owner')).toHaveLength(1);
	});

	it('ORDERING: the person DELETE never fires before the create + value POST (create-before-delete)', async () => {
		const mock = seedMock();
		await migrateOneGroup(cfg, group, mock);
		const calls = mock.mock.calls as Array<[string, RequestInit?]>;
		const firstDelete = calls.findIndex(([, init]) => (init?.method ?? '').toUpperCase() === 'DELETE');
		const createIdx = calls.findIndex(([url, init]) => (init?.method ?? '').toUpperCase() === 'POST' && /\/entity$/.test(url.split('?')[0]));
		const valuePostIdx = calls.findIndex(([url, init]) => (init?.method ?? '').toUpperCase() === 'POST' && /\/entity\/[^/?]+/.test(url));
		expect(firstDelete).toBeGreaterThan(createIdx);
		expect(firstDelete).toBeGreaterThan(valuePostIdx);
	});
});

describe('migrateOneGroup — fail-loud, per record, no silent success', () => {
	const group: MigrationGroup = { personId: TESTUSER, tier: 'domain', fields: { name: 'Test User' }, ownerIds: [TESTUSER] };
	const seed = { persons: { [TESTUSER]: { name: [{ _id: 'val-name-tu', string: 'Test User' }] } } } as const;

	it('WRITE fail (create POST non-2xx): entry is `failed`/phase:create, names the person, and NO person DELETE is issued', async () => {
		const mock = makeLiveMock({ ...seed, fail: { create: 403 } });
		const entries = await migrateOneGroup(cfg, group, mock);
		const e = entries.find((x) => x.field === 'name')!;
		expect(e.status).toBe('failed');
		expect(e.phase).toBe('create');
		expect(e.personId).toBe(TESTUSER);
		expect(deleteCalls(mock)).toEqual([]); // the person value must stay intact
	});

	it('2xx-no-_id trap (createProfile own guard fires through the script): `failed`/phase:create, no DELETE', async () => {
		const mock = makeLiveMock({ ...seed, fail: { createNoId: true } });
		const entries = await migrateOneGroup(cfg, group, mock);
		expect(entries.find((x) => x.field === 'name')).toMatchObject({ status: 'failed', phase: 'create' });
		expect(deleteCalls(mock)).toEqual([]);
	});

	it('WRITE-VALUE fail (saveProfileFields POST non-2xx): `failed`/phase:write-value, profileId set (orphan shell), no DELETE', async () => {
		const mock = makeLiveMock({ ...seed, fail: { valuePost: 500 } });
		const entries = await migrateOneGroup(cfg, group, mock);
		const e = entries.find((x) => x.field === 'name')!;
		expect(e.status).toBe('failed');
		expect(e.phase).toBe('write-value');
		expect(e.profileId).toBeTruthy();
		expect(deleteCalls(mock)).toEqual([]);
	});

	it('VERIFY-PROFILE fail (read-back does NOT show the value): `failed`/phase:verify-profile, NO DELETE — never delete against an unproven write', async () => {
		const mock = makeLiveMock({ ...seed, fail: { verifyMissing: true } });
		const entries = await migrateOneGroup(cfg, group, mock);
		expect(entries.find((x) => x.field === 'name')).toMatchObject({ status: 'failed', phase: 'verify-profile' });
		expect(deleteCalls(mock)).toEqual([]);
	});

	it('DELETE fail = DUPLICATE-HAZARD: create+populate+verify OK then person DELETE non-2xx → `duplicate-hazard`, named, repairHint says BOTH, carries profileId+valueId', async () => {
		const mock = makeLiveMock({ ...seed, fail: { delete: 500 } });
		const entries = await migrateOneGroup(cfg, group, mock);
		const e = entries.find((x) => x.field === 'name')!;
		expect(e.status).toBe('duplicate-hazard');
		expect(e.phase).toBe('delete-person');
		expect(e.personId).toBe(TESTUSER);
		expect(e.profileId).toBeTruthy();
		expect(e.valueId).toBe('val-name-tu');
		expect(e.repairHint).toMatch(/BOTH/i);
	});

	it('READBACK-PERSON fail (DELETE 2xx but the value PERSISTS): `failed`/phase:readback-person (completion proven by read, not exit code)', async () => {
		const mock = makeLiveMock({ ...seed, fail: { deleteNoop: true } });
		const entries = await migrateOneGroup(cfg, group, mock);
		expect(entries.find((x) => x.field === 'name')).toMatchObject({ status: 'failed', phase: 'readback-person' });
	});
});

// ── The createProfile funnel — structural proof the create runs through the
// imported sole-path helper, NOT a hand-rolled POST (a resolveTypeId GET precedes it).
describe('migrateOneGroup — funnels every create through createProfile (no hand-rolled create)', () => {
	it('a resolveTypeId GET (_type.string=entity & name.string=profile) precedes the create POST', async () => {
		const mock = makeLiveMock({ persons: { [TESTUSER]: { name: [{ _id: 'val-name-tu', string: 'Test User' }] } } });
		await migrateOneGroup(cfg, { personId: TESTUSER, tier: 'domain', fields: { name: 'Test User' }, ownerIds: [TESTUSER] }, mock);
		const calls = mock.mock.calls as Array<[string, RequestInit?]>;
		const typeIdx = calls.findIndex(([url, init]) => (init?.method ?? 'GET').toUpperCase() === 'GET' && url.includes('_type.string=entity') && url.includes('name.string=profile'));
		const createIdx = calls.findIndex(([url, init]) => (init?.method ?? '').toUpperCase() === 'POST' && /\/entity$/.test(url.split('?')[0]));
		expect(typeIdx).toBeGreaterThanOrEqual(0);
		expect(createIdx).toBeGreaterThan(typeIdx);
	});
});

// ── deletePersonField — delete-only (must NOT reuse saveProfileFields, which re-adds).
describe('deletePersonField — deletes person values without re-adding them', () => {
	it('DELETEs each value id then issues NO POST back to the person (delete-only)', async () => {
		const mock = makeLiveMock({ persons: { [OAUTH]: { name: [{ _id: 'val-name-oauth', string: 'Mihkel Putrinš' }] } } });
		const deleted = await deletePersonField(cfg, OAUTH, 'name', mock);
		expect(deleted).toEqual(['val-name-oauth']);
		const postsToPerson = (mock.mock.calls as Array<[string, RequestInit?]>).filter(
			([url, init]) => (init?.method ?? '').toUpperCase() === 'POST' && url.includes(`/entity/${OAUTH}`)
		);
		expect(postsToPerson).toEqual([]);
	});

	it('REFUSES to delete when the person carries >1 value for the field (only value[0] was migrated) — throws, issues no DELETE', async () => {
		const mock = makeLiveMock({
			persons: {
				[OAUTH]: {
					name: [
						{ _id: 'val-name-a', string: 'Mihkel Putrinš' },
						{ _id: 'val-name-b', string: 'M. Putrinš' }
					]
				}
			}
		});
		await expect(deletePersonField(cfg, OAUTH, 'name', mock)).rejects.toThrow(/val-name-a[\s\S]*val-name-b|refuse to delete|value\[0\]/i);
		expect(deleteCalls(mock)).toEqual([]);
	});
});

// ════════════════════════════════════════════════════════════════════════════
// renderPlan — the dry-run surface. PURE: describes the moves, writes NOTHING.
// ════════════════════════════════════════════════════════════════════════════

describe('renderPlan — dry-run describes the plan and masks email, writing nothing', () => {
	const groups: MigrationGroup[] = [
		{ personId: PO, tier: 'domain', fields: { name: 'Mihkel Putrinš' }, ownerIds: [PO] },
		{ personId: PO, tier: 'private', fields: { email: 'mitselek@gmail.com' }, ownerIds: [PO] }
	];

	it('names each planned create with its tier + parent + ownerIds', () => {
		const out = renderPlan(groups);
		expect(out).toContain(PO);
		expect(out).toMatch(/domain/);
		expect(out).toMatch(/private/);
	});

	it('MASKS the raw email address (never prints the full local-part in the plan)', () => {
		const out = renderPlan(groups);
		expect(out).not.toContain('mitselek@gmail.com');
	});
});

// ════════════════════════════════════════════════════════════════════════════
// MigrationLedger — per-record reporting; NO aggregate "done" masks a failure.
// ════════════════════════════════════════════════════════════════════════════

describe('MigrationLedger — loud per-record reporting, non-zero on any non-moved', () => {
	const moved: LedgerEntry = { personId: OAUTH, field: 'name', sourceTier: 'domain', targetTier: 'domain', profileId: 'new-prof-1', status: 'moved' };
	const hazard: LedgerEntry = {
		personId: TESTUSER,
		field: 'name',
		sourceTier: 'domain',
		targetTier: 'domain',
		profileId: 'new-prof-2',
		valueId: 'val-name-tu',
		status: 'duplicate-hazard',
		phase: 'delete-person',
		repairHint: 'DUPLICATE — name in BOTH profile new-prof-2 and person 6a097dcc90c8df7a1cc7d6dd'
	};

	it('hasFailures() is false when every entry moved, true once any entry is not moved', () => {
		const clean = new MigrationLedger();
		clean.record(moved);
		expect(clean.hasFailures()).toBe(false);

		const dirty = new MigrationLedger();
		dirty.record(moved);
		dirty.record(hazard);
		expect(dirty.hasFailures()).toBe(true);
	});

	it('printReport names each non-moved record (id + field + phase + repairHint) and prints no aggregate "done" when there are failures', () => {
		const log = vi.spyOn(console, 'log').mockImplementation(() => {});
		const err = vi.spyOn(console, 'error').mockImplementation(() => {});
		const ledger = new MigrationLedger();
		ledger.record(moved);
		ledger.record(hazard);
		ledger.printReport();
		const printed = [...log.mock.calls, ...err.mock.calls].flat().join('\n');
		expect(printed).toMatch(new RegExp(TESTUSER));
		expect(printed).toMatch(/duplicate-hazard|BOTH/i);
		expect(printed).not.toMatch(/^\s*done\.?\s*$/im);
		log.mockRestore();
		err.mockRestore();
	});
});

// (*MVOX:Byrd* — RED)
