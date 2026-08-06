import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetTypeIdCache, type EntuCfg } from '$lib/seasons/entuSeasons';
import { createProfile, type CreateProfileInput } from './profileData';

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

// (*MVOX:Tallis*)
