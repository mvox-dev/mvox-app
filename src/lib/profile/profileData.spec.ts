import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetTypeIdCache, type EntuCfg } from '$lib/seasons/entuSeasons';
import {
	createProfile,
	createOwnProfile,
	listMyProfiles,
	profilesByLevel,
	saveProfileFields,
	type CreateProfileInput,
	type Level,
	type MyProfile
} from './profileData';

const cfg: EntuCfg = { db: 'testdb', token: 'jwt' };

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), { status });
}

beforeEach(() => {
	resetTypeIdCache();
});

// ── Type-level contract (T4.4 AC1 — "cannot be called without"; verified by
// `pnpm check`, NOT by vitest — esbuild strips types at test-run time, so these
// only fail the CI type-check, exactly as the issue asks for) ──────────────────
//
// If any line below starts reporting "Unused '@ts-expect-error' directive" under
// `pnpm check`, the type contract has regressed (a field became optional, or
// `_inheritrights` widened from the literal `false` to `boolean`) — THAT report
// is the RED signal for this block, not a vitest assertion.

describe('CreateProfileInput — non-omittable contract', () => {
	it('documents the compile-time proofs below; the real assertions are the `@ts-expect-error` directives in this file, checked by `pnpm check`', () => {
		expect(typeof createProfile).toBe('function');
	});
});

// @ts-expect-error — omitting `_inheritrights` must not typecheck (T4.4 AC1)
const _omitsInheritRights: CreateProfileInput = { personId: 'p', _sharing: 'private' };
void _omitsInheritRights;

// @ts-expect-error — omitting `_sharing` must not typecheck (T4.4 AC1)
const _omitsSharing: CreateProfileInput = { personId: 'p', _inheritrights: false };
void _omitsSharing;

// @ts-expect-error — `_inheritrights: true` must not typecheck; the field is the
// literal `false`, not `boolean` — there is no valid `true` value for a profile
// create (T4.4 AC1)
const _wrongInheritRightsValue: CreateProfileInput = { personId: 'p', _inheritrights: true, _sharing: 'private' };
void _wrongInheritRightsValue;

// @ts-expect-error — `_sharing` is not a free-form string; Entu only accepts
// public/domain/private (entu-api utils/entity.js:198-201)
const _invalidSharingValue: CreateProfileInput = { personId: 'p', _inheritrights: false, _sharing: 'everyone' };
void _invalidSharingValue;

// Forward guard: the fully correct shape DOES typecheck (no ts-expect-error) —
// proves the contract rejects bad shapes without also rejecting the good one.
const _validShape: CreateProfileInput = {
	personId: 'p',
	_inheritrights: false,
	_sharing: 'private'
};
void _validShape;

// ── Runtime defense-in-depth (T4.4 AC1 — for callers who bypass TS: `as any`,
// data reconstructed from JSON, a `.js` caller with no type checking at all) ───
// Each test asserts on the REJECTION MESSAGE, not just "it throws" — the stub
// throws unconditionally ("not implemented"), so a bare `.rejects.toThrow()`
// would pass vacuously for the wrong reason. Matching a message naming the
// violated field only passes once GREEN adds the actual guard.

describe('createProfile — runtime guard (defense-in-depth against non-TS callers)', () => {
	it('rejects when _inheritrights is not exactly false, even if a caller bypasses the type system', async () => {
		const fetchImpl = vi.fn();
		const bypassed = {
			personId: 'person-p',
			_inheritrights: true,
			_sharing: 'private'
		} as unknown as CreateProfileInput;
		await expect(createProfile(cfg, bypassed, fetchImpl)).rejects.toThrow(/_inheritrights/i);
		expect(fetchImpl).not.toHaveBeenCalled();
	});

	it('rejects when _sharing is absent, even if a caller bypasses the type system', async () => {
		const fetchImpl = vi.fn();
		const bypassed = {
			personId: 'person-p',
			_inheritrights: false
		} as unknown as CreateProfileInput;
		await expect(createProfile(cfg, bypassed, fetchImpl)).rejects.toThrow(/_sharing/i);
		expect(fetchImpl).not.toHaveBeenCalled();
	});
});

// ── Wire shape (valid input) ────────────────────────────────────────────────────

describe('createProfile — wire shape', () => {
	/** Type-resolution GET (`_type.string=entity&name.string=profile`) + entity-create POST. */
	function makeFetchMock(resolvedTypeId = 'profile-type-id', createResponse: unknown = { _id: 'new-profile-1' }) {
		return vi.fn().mockImplementation((url: string) => {
			if (url.includes('_type.string=entity')) {
				return Promise.resolve(json({ entities: [{ _id: resolvedTypeId }] }));
			}
			return Promise.resolve(json(createResponse));
		});
	}

	function createCallBody(fetchImpl: ReturnType<typeof makeFetchMock>) {
		const calls = fetchImpl.mock.calls as Array<[string, RequestInit?]>;
		const call = calls.find(([url]) => !url.includes('_type.string=entity'));
		expect(call).toBeDefined(); // guard: fails loudly if createProfile never issued the create POST
		return JSON.parse(String(call![1]!.body)) as Array<{
			type: string;
			reference?: string;
			string?: string;
			boolean?: boolean;
		}>;
	}

	it('resolves the type id by name=profile before creating', async () => {
		const fetchImpl = makeFetchMock('profile-type-42');
		await createProfile(cfg, { personId: 'person-p', _inheritrights: false, _sharing: 'private' }, fetchImpl);
		expect(fetchImpl).toHaveBeenCalled();
		const typeCall = (fetchImpl.mock.calls as Array<[string]>).find(([url]) => url.includes('_type.string=entity'));
		expect(typeCall).toBeDefined();
		expect(String(typeCall![0])).toContain('name.string=profile');
	});

	it('POST body carries _type (resolved reference), _parent=personId, _inheritrights:false, and the caller\'s own _sharing', async () => {
		const fetchImpl = makeFetchMock('profile-type-42');
		await createProfile(cfg, { personId: 'person-p', _inheritrights: false, _sharing: 'domain' }, fetchImpl);
		const body = createCallBody(fetchImpl);
		expect(body).toEqual(
			expect.arrayContaining([
				{ type: '_type', reference: 'profile-type-42' },
				{ type: '_parent', reference: 'person-p' },
				{ type: '_inheritrights', boolean: false },
				{ type: '_sharing', string: 'domain' }
			])
		);
	});

	it('with ownerIds: POST body carries one _owner reference prop per id', async () => {
		const fetchImpl = makeFetchMock();
		await createProfile(
			cfg,
			{ personId: 'person-p', _inheritrights: false, _sharing: 'private', ownerIds: ['member-a', 'member-b'] },
			fetchImpl
		);
		const body = createCallBody(fetchImpl);
		const ownerProps = body.filter((p) => p.type === '_owner');
		expect(ownerProps).toEqual(
			expect.arrayContaining([
				{ type: '_owner', reference: 'member-a' },
				{ type: '_owner', reference: 'member-b' }
			])
		);
		expect(ownerProps).toHaveLength(2);
	});

	it('without ownerIds (member self-create): POST body carries NO _owner prop at all — the creator becomes owner via Entu itself, not this function', async () => {
		const fetchImpl = makeFetchMock();
		await createProfile(cfg, { personId: 'person-p', _inheritrights: false, _sharing: 'private' }, fetchImpl);
		const body = createCallBody(fetchImpl);
		expect(body.some((p) => p.type === '_owner')).toBe(false);
	});

	it('returns the created profile _id', async () => {
		const fetchImpl = makeFetchMock('profile-type-id', { _id: 'new-profile-99' });
		const id = await createProfile(cfg, { personId: 'person-p', _inheritrights: false, _sharing: 'private' }, fetchImpl);
		expect(id).toBe('new-profile-99');
	});
});

// ── Fail loudly (T4.4 AC3 — epic #21 standing rule: a failed create must never
// surface as, or be mistaken for, a completed state) ────────────────────────────

describe('createProfile — fails loudly, never a silent success', () => {
	it('rejects on a non-2xx create response, with the status surfaced in the error', async () => {
		const fetchImpl = vi.fn().mockImplementation((url: string) => {
			if (url.includes('_type.string=entity')) {
				return Promise.resolve(json({ entities: [{ _id: 'profile-type-id' }] }));
			}
			return Promise.resolve(json({}, 403));
		});
		await expect(
			createProfile(cfg, { personId: 'person-p', _inheritrights: false, _sharing: 'private' }, fetchImpl)
		).rejects.toThrow(/403/);
	});

	it('rejects on a non-2xx type-resolution response, with the status surfaced', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(json({}, 500));
		await expect(
			createProfile(cfg, { personId: 'person-p', _inheritrights: false, _sharing: 'private' }, fetchImpl)
		).rejects.toThrow(/500/);
	});

	it('rejects when Entu answers 2xx but the body carries no _id — an apparent-success trap, not a genuine completed create', async () => {
		const fetchImpl = vi.fn().mockImplementation((url: string) => {
			if (url.includes('_type.string=entity')) {
				return Promise.resolve(json({ entities: [{ _id: 'profile-type-id' }] }));
			}
			return Promise.resolve(json({})); // 200 OK, empty body — no _id
		});
		await expect(
			createProfile(cfg, { personId: 'person-p', _inheritrights: false, _sharing: 'private' }, fetchImpl)
		).rejects.toThrow(/_id/i);
	});
});

// ════════════════════════════════════════════════════════════════════════════
// T4.6/#26 — profile EDIT data layer (createOwnProfile / listMyProfiles /
// profilesByLevel / saveProfileFields). RED: the impls are stubs throwing
// 'not implemented', so these fail on assertions until Josquin's GREEN.
// ════════════════════════════════════════════════════════════════════════════

// ── createOwnProfile — the member self-create wrapper (AC1/AC3) ─────────────────
// It must funnel through createProfile: same wire shape, member-owned (NO ownerIds
// — Entu auto-adds the caller as _owner). Asserted on the wire, not by spying the
// sibling, so the "goes through the T4.4 path" guarantee is verified end-to-end.

describe('createOwnProfile — member self-create funnels through createProfile', () => {
	/** Type-resolution GET (`_type.string=entity&name.string=profile`) + entity-create POST. */
	function makeFetchMock(resolvedTypeId = 'profile-type-id', createResponse: unknown = { _id: 'new-profile-1' }) {
		return vi.fn().mockImplementation((url: string) => {
			if (url.includes('_type.string=entity')) {
				return Promise.resolve(json({ entities: [{ _id: resolvedTypeId }] }));
			}
			return Promise.resolve(json(createResponse));
		});
	}

	function createCallBody(fetchImpl: ReturnType<typeof makeFetchMock>) {
		const calls = fetchImpl.mock.calls as Array<[string, RequestInit?]>;
		const call = calls.find(([url]) => !url.includes('_type.string=entity'));
		expect(call).toBeDefined();
		return JSON.parse(String(call![1]!.body)) as Array<{
			type: string;
			reference?: string;
			string?: string;
			boolean?: boolean;
		}>;
	}

	for (const level of ['public', 'domain', 'private'] as const) {
		it(`creates the ${level} profile with _inheritrights:false + _sharing:${level} + _parent=personId, and NO _owner (self-create)`, async () => {
			const fetchImpl = makeFetchMock('profile-type-77');
			const id = await createOwnProfile(cfg, 'person-p', level, fetchImpl);
			expect(id).toBe('new-profile-1');

			const body = createCallBody(fetchImpl);
			expect(body).toEqual(
				expect.arrayContaining([
					{ type: '_type', reference: 'profile-type-77' },
					{ type: '_parent', reference: 'person-p' },
					{ type: '_inheritrights', boolean: false },
					{ type: '_sharing', string: level }
				])
			);
			// Member self-create: the creator IS the owner via Entu itself — this call
			// must send NO explicit _owner prop (the T4.10 admin path is the one that does).
			expect(body.some((p) => p.type === '_owner')).toBe(false);
		});
	}

	it('fails loud when the create response is non-2xx (surfaces the status)', async () => {
		const fetchImpl = vi.fn().mockImplementation((url: string) => {
			if (url.includes('_type.string=entity')) {
				return Promise.resolve(json({ entities: [{ _id: 'profile-type-id' }] }));
			}
			return Promise.resolve(json({}, 403));
		});
		await expect(createOwnProfile(cfg, 'person-p', 'domain', fetchImpl)).rejects.toThrow(/403/);
	});

	it('fails loud on the 2xx-no-_id apparent-success trap (inherited from createProfile)', async () => {
		const fetchImpl = vi.fn().mockImplementation((url: string) => {
			if (url.includes('_type.string=entity')) {
				return Promise.resolve(json({ entities: [{ _id: 'profile-type-id' }] }));
			}
			return Promise.resolve(json({})); // 200, no _id
		});
		await expect(createOwnProfile(cfg, 'person-p', 'private', fetchImpl)).rejects.toThrow(/_id/i);
	});
});

// ── listMyProfiles — read the member's up-to-three profile entities ─────────────

describe('listMyProfiles — read + project name/email/_sharing', () => {
	function firstUrl(fetchImpl: ReturnType<typeof vi.fn>): string {
		return String((fetchImpl.mock.calls as Array<[string]>)[0][0]);
	}

	it('queries profile entities parented under the person, projecting name,email,_sharing with an explicit limit', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(json({ entities: [] }));
		await listMyProfiles(cfg, 'person-p', fetchImpl);
		const url = firstUrl(fetchImpl);
		expect(url).toContain('_type.string=profile');
		expect(url).toContain('_parent.reference=person-p');
		expect(url).toContain('props=name,email,_sharing');
		expect(url).toMatch(/limit=\d+/);
		// The field is _sharing (underscore) everywhere — a bare `sharing` projection
		// silently returns empty values. Guard against a regression to the wrong name.
		expect(url).not.toMatch(/props=[^&]*(?<!_)sharing/);
	});

	it('maps each entity via the ?.[0]?.string unwrap; a missing name/email becomes an empty string', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(
			json({
				entities: [
					{ _id: 'prof-pub', name: [{ string: 'Ada' }], email: [{ string: 'ada@example.com' }], _sharing: [{ string: 'public' }] },
					{ _id: 'prof-dom', _sharing: [{ string: 'domain' }] } // no name/email values
				]
			})
		);
		const out = await listMyProfiles(cfg, 'person-p', fetchImpl);
		expect(out).toEqual([
			{ _id: 'prof-pub', name: 'Ada', email: 'ada@example.com', _sharing: 'public' },
			{ _id: 'prof-dom', name: '', email: '', _sharing: 'domain' }
		]);
	});

	it('fails loud on a non-2xx read (surfaces the status)', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(json({}, 500));
		await expect(listMyProfiles(cfg, 'person-p', fetchImpl)).rejects.toThrow(/listMyProfiles failed: 500/);
	});

	it('fails loud (does NOT silently drop) an entity carrying an unknown _sharing value', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(
			json({ entities: [{ _id: 'prof-x', name: [{ string: 'X' }], _sharing: [{ string: 'everyone' }] }] })
		);
		await expect(listMyProfiles(cfg, 'person-p', fetchImpl)).rejects.toThrow(/everyone|_sharing/i);
	});
});

// ── profilesByLevel — pure index (a level with no entity is absent) ─────────────

describe('profilesByLevel — pure index by visibility level', () => {
	const pub: MyProfile = { _id: 'prof-pub', name: 'Ada', email: 'ada@x.io', _sharing: 'public' };
	const dom: MyProfile = { _id: 'prof-dom', name: 'Ada M.', email: '', _sharing: 'domain' };

	it('indexes each profile under its own level', () => {
		const by = profilesByLevel([pub, dom]);
		expect(by.public).toEqual(pub);
		expect(by.domain).toEqual(dom);
	});

	it('a level with no entity is ABSENT (never defaulted to an empty entity)', () => {
		const by = profilesByLevel([pub]);
		expect(by.domain).toBeUndefined();
		expect(by.private).toBeUndefined();
	});

	it('the anomalous duplicate-level case is last-wins (should not occur pre-T4.7)', () => {
		const dom2: MyProfile = { _id: 'prof-dom-2', name: 'Later', email: '', _sharing: 'domain' };
		const by = profilesByLevel([dom, dom2]);
		expect(by.domain).toEqual(dom2);
	});
});

// ── saveProfileFields — replace name/email on an EXISTING entity (re-edit path) ──
// POST entity/{id} only ADDS, so a real value CHANGE is GET current value-ids →
// DELETE each stale value → POST the new value (the updateRsvpStatus pattern). It
// must NEVER send _type/_parent/_inheritrights/_sharing (not a create; keeps the
// sole-create-path guard's literal out of its wire).

describe('saveProfileFields — property-swap update, never a create', () => {
	/** Route by method + url: GET the entity, DELETE property/{id}, POST entity/{id}. */
	function makeFetchMock(
		existingValues: { name?: Array<{ _id: string; string: string }>; email?: Array<{ _id: string; string: string }> } = {}
	) {
		return vi.fn().mockImplementation((url: string, init?: RequestInit) => {
			const method = (init?.method ?? 'GET').toUpperCase();
			if (method === 'GET') {
				return Promise.resolve(json({ entity: { _id: 'prof-1', ...existingValues } }));
			}
			return Promise.resolve(json({ _id: 'prof-1' }));
		});
	}

	function bodyOfPostToEntity(fetchImpl: ReturnType<typeof vi.fn>) {
		const calls = fetchImpl.mock.calls as Array<[string, RequestInit?]>;
		const post = calls.find(
			([url, init]) => (init?.method ?? '').toUpperCase() === 'POST' && /entity\/prof-1(\?|$)/.test(url)
		);
		expect(post).toBeDefined();
		return JSON.parse(String(post![1]!.body)) as Array<{ type: string; string?: string; reference?: string }>;
	}

	it('GETs the entity projecting name,email before writing', async () => {
		const fetchImpl = makeFetchMock();
		await saveProfileFields(cfg, 'prof-1', { name: 'Ada', email: 'ada@x.io' }, fetchImpl);
		const getCall = (fetchImpl.mock.calls as Array<[string, RequestInit?]>).find(
			([url, init]) => (init?.method ?? 'GET').toUpperCase() === 'GET'
		);
		expect(getCall).toBeDefined();
		expect(String(getCall![0])).toContain('entity/prof-1');
		expect(String(getCall![0])).toContain('props=name,email');
	});

	it('on a FRESH shell (GET returns no values) issues NO DELETE and one POST adding name+email', async () => {
		const fetchImpl = makeFetchMock({}); // no existing values
		await saveProfileFields(cfg, 'prof-1', { name: 'Ada', email: 'ada@x.io' }, fetchImpl);

		const deletes = (fetchImpl.mock.calls as Array<[string, RequestInit?]>).filter(
			([, init]) => (init?.method ?? '').toUpperCase() === 'DELETE'
		);
		expect(deletes).toHaveLength(0);

		const body = bodyOfPostToEntity(fetchImpl);
		expect(body).toEqual(
			expect.arrayContaining([
				{ type: 'name', string: 'Ada' },
				{ type: 'email', string: 'ada@x.io' }
			])
		);
	});

	it('on an EXISTING entity DELETEs each stale name/email value before POSTing the new ones', async () => {
		const fetchImpl = makeFetchMock({
			name: [{ _id: 'val-name-old', string: 'Old' }],
			email: [{ _id: 'val-email-old', string: 'old@x.io' }]
		});
		await saveProfileFields(cfg, 'prof-1', { name: 'Ada', email: 'ada@x.io' }, fetchImpl);

		const deleteUrls = (fetchImpl.mock.calls as Array<[string, RequestInit?]>)
			.filter(([, init]) => (init?.method ?? '').toUpperCase() === 'DELETE')
			.map(([url]) => String(url));
		expect(deleteUrls).toEqual(
			expect.arrayContaining([expect.stringContaining('property/val-name-old'), expect.stringContaining('property/val-email-old')])
		);
		expect(deleteUrls).toHaveLength(2);
	});

	it('omits an empty-string field from the POST', async () => {
		const fetchImpl = makeFetchMock();
		await saveProfileFields(cfg, 'prof-1', { name: 'Ada', email: '' }, fetchImpl);
		const body = bodyOfPostToEntity(fetchImpl);
		expect(body.some((p) => p.type === 'name')).toBe(true);
		expect(body.some((p) => p.type === 'email')).toBe(false);
	});

	it('NEVER sends _type/_parent/_inheritrights/_sharing — it edits fields, it does not create', async () => {
		const fetchImpl = makeFetchMock({ name: [{ _id: 'val-name-old', string: 'Old' }] });
		await saveProfileFields(cfg, 'prof-1', { name: 'Ada', email: 'ada@x.io' }, fetchImpl);
		const body = bodyOfPostToEntity(fetchImpl);
		for (const forbidden of ['_type', '_parent', '_inheritrights', '_sharing']) {
			expect(body.some((p) => p.type === forbidden)).toBe(false);
		}
	});

	it('fails loud when the entity GET is non-2xx', async () => {
		const fetchImpl = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
			const method = (init?.method ?? 'GET').toUpperCase();
			if (method === 'GET') return Promise.resolve(json({}, 404));
			return Promise.resolve(json({ _id: 'prof-1' }));
		});
		await expect(saveProfileFields(cfg, 'prof-1', { name: 'Ada', email: 'ada@x.io' }, fetchImpl)).rejects.toThrow(/404/);
	});

	it('fails loud when a property DELETE is non-2xx', async () => {
		const fetchImpl = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
			const method = (init?.method ?? 'GET').toUpperCase();
			if (method === 'GET') {
				return Promise.resolve(json({ entity: { _id: 'prof-1', name: [{ _id: 'val-name-old', string: 'Old' }] } }));
			}
			if (method === 'DELETE') return Promise.resolve(json({}, 500));
			return Promise.resolve(json({ _id: 'prof-1' }));
		});
		await expect(saveProfileFields(cfg, 'prof-1', { name: 'Ada', email: 'ada@x.io' }, fetchImpl)).rejects.toThrow(/500/);
	});

	it('fails loud when the POST is non-2xx', async () => {
		const fetchImpl = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
			const method = (init?.method ?? 'GET').toUpperCase();
			if (method === 'GET') return Promise.resolve(json({ entity: { _id: 'prof-1' } }));
			if (method === 'POST') return Promise.resolve(json({}, 403));
			return Promise.resolve(json({ _id: 'prof-1' }));
		});
		await expect(saveProfileFields(cfg, 'prof-1', { name: 'Ada', email: 'ada@x.io' }, fetchImpl)).rejects.toThrow(/403/);
	});
});

// keep `Level` referenced for the type-checker even though the runtime blocks above
// use string literals directly.
const _levelWitness: Level = 'domain';
void _levelWitness;

// (*MVOX:Tallis*)
