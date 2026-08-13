import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EntuCfg } from '$lib/seasons/entuSeasons';
import type { MyProfile } from './profileData';

// T4.7/#27 — the visibility-MOVE dispatch layer. Mock the T4.6 data primitives at
// their module boundary (createOwnProfile / saveProfileFields), asserting on the
// ORDER + the per-entity whole-pair bodies (RECON B §4 conventions). RED: applyFieldMove
// / applyDuplicateRepair / planLoadedDuplicateRepairs are stubs throwing
// 'not implemented', so these fail on assertions until GREEN.

const { createOwnProfileMock, saveProfileFieldsMock } = vi.hoisted(() => ({
	createOwnProfileMock: vi.fn(),
	saveProfileFieldsMock: vi.fn()
}));
vi.mock('./profileData', () => ({
	createOwnProfile: createOwnProfileMock,
	saveProfileFields: saveProfileFieldsMock
}));

import {
	applyFieldMove,
	applyDuplicateRepair,
	applyConflictResolution,
	planLoadedDuplicateRepairs,
	FieldMoveError,
	type FieldMoveInput
} from './fieldMove';

const cfg: EntuCfg = { db: 'testdb', token: 'jwt' };

/** A promise whose settlement the test controls — "the write is still in flight". */
function deferred<T>() {
	let resolve!: (v: T) => void;
	let reject!: (e: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

/** Move `name` domain→public, target absent (must be lazily created). */
function nameWiden(overrides: Partial<FieldMoveInput> = {}): FieldMoveInput {
	return {
		cfg,
		personId: 'person-p',
		field: 'name',
		fromLevel: 'domain',
		toLevel: 'public',
		value: 'Ada',
		srcId: 'dom-src',
		dstId: null,
		srcSibling: 'dom@x.io', // the source domain entity's email, preserved on delete
		dstSibling: '',
		...overrides
	};
}

beforeEach(() => {
	createOwnProfileMock.mockReset();
	saveProfileFieldsMock.mockReset();
});

// ── AC1 — create-before-delete ORDER (the load-bearing safety) ──────────────────

describe('applyFieldMove — AC1 create-before-delete ordering', () => {
	it('target ABSENT: createOwnProfile → add-to-new → onPhase(created) → delete-from-old → onPhase(deleted), in THAT order', async () => {
		const calls: string[] = [];
		createOwnProfileMock.mockImplementation(async (_cfg: EntuCfg, _person: string, level: string) => {
			calls.push(`createOwnProfile:${level}`);
			return 'pub-new';
		});
		saveProfileFieldsMock.mockImplementation(async (_cfg: EntuCfg, id: string) => {
			calls.push(`save:${id}`);
		});
		const onPhase = (phase: string, id: string) => calls.push(`phase:${phase}:${id}`);

		const res = await applyFieldMove(nameWiden(), onPhase);

		expect(calls).toEqual([
			'createOwnProfile:public',
			'save:pub-new', // add value to the NEW entity FIRST
			'phase:created:pub-new', // step-1 server-confirmed
			'save:dom-src', // delete from the OLD entity SECOND
			'phase:deleted:pub-new' // step-2 server-confirmed
		]);
		expect(res).toEqual({
			field: 'name',
			fromLevel: 'domain',
			toLevel: 'public',
			targetId: 'pub-new',
			sourceId: 'dom-src'
		});
	});

	it('the delete-from-old is NOT issued until the create-in-new is SERVER-CONFIRMED', async () => {
		createOwnProfileMock.mockResolvedValue('pub-new');
		const dstAdd = deferred<void>();
		saveProfileFieldsMock
			.mockImplementationOnce(() => dstAdd.promise) // add-to-new: held in flight
			.mockImplementationOnce(() => Promise.resolve()); // delete-from-old
		const phases: string[] = [];

		// Attach the rejection handler synchronously so a RED stub's early rejection is
		// never an unhandled rejection (in GREEN this settles to the FieldMoveResult).
		const settled = applyFieldMove(nameWiden(), (ph) => phases.push(ph)).then(
			(r) => ({ ok: true as const, r }),
			(e) => ({ ok: false as const, e })
		);
		// Let the microtasks up to the pending add-to-new run.
		await Promise.resolve();
		await Promise.resolve();

		// The create side has dispatched exactly ONE write (add-to-new) and NOTHING is
		// confirmed yet — the delete-from-old must not have been issued.
		expect(createOwnProfileMock).toHaveBeenCalledTimes(1);
		expect(saveProfileFieldsMock).toHaveBeenCalledTimes(1);
		expect(phases).not.toContain('created');

		dstAdd.resolve();
		await settled;

		// Only NOW is the second write (delete-from-old) issued, after 'created'.
		expect(saveProfileFieldsMock).toHaveBeenCalledTimes(2);
		expect(phases).toEqual(['created', 'deleted']);
	});

	it('ordering is direction-agnostic: a TIGHTENING (public→private) still creates-in-new first, deletes-from-old second', async () => {
		const calls: string[] = [];
		createOwnProfileMock.mockImplementation(async (_cfg: EntuCfg, _person: string, level: string) => {
			calls.push(`createOwnProfile:${level}`);
			return 'pri-new';
		});
		saveProfileFieldsMock.mockImplementation(async (_cfg: EntuCfg, id: string) => calls.push(`save:${id}`));

		await applyFieldMove(
			nameWiden({ fromLevel: 'public', toLevel: 'private', srcId: 'pub-src' }),
			() => {}
		);

		expect(calls).toEqual(['createOwnProfile:private', 'save:pri-new', 'save:pub-src']);
	});
});

// ── Whole-pair bodies + target-exists branch ────────────────────────────────────

describe('applyFieldMove — whole-pair writes preserve the sibling field', () => {
	it('target ABSENT: add-to-new carries {name:value, email:""}; delete-from-old carries {name:"", email:srcSibling}', async () => {
		createOwnProfileMock.mockResolvedValue('pub-new');
		saveProfileFieldsMock.mockResolvedValue(undefined);

		await applyFieldMove(nameWiden(), () => {});

		// add-to-new (first saveProfileFields): the moved field set, sibling empty (new shell).
		expect(saveProfileFieldsMock.mock.calls[0][1]).toBe('pub-new');
		expect(saveProfileFieldsMock.mock.calls[0][2]).toEqual({ name: 'Ada', email: '' });
		// delete-from-old (second): the moved field '' (net delete), the source sibling preserved.
		expect(saveProfileFieldsMock.mock.calls[1][1]).toBe('dom-src');
		expect(saveProfileFieldsMock.mock.calls[1][2]).toEqual({ name: '', email: 'dom@x.io' });
	});

	it('target EXISTS (dstId set): NO createOwnProfile; add-to-new preserves the target sibling', async () => {
		saveProfileFieldsMock.mockResolvedValue(undefined);

		await applyFieldMove(
			nameWiden({ dstId: 'pub-existing', dstSibling: 'pub@x.io' }),
			() => {}
		);

		expect(createOwnProfileMock).not.toHaveBeenCalled();
		// add-to-new writes to the EXISTING target, keeping its email.
		expect(saveProfileFieldsMock.mock.calls[0][1]).toBe('pub-existing');
		expect(saveProfileFieldsMock.mock.calls[0][2]).toEqual({ name: 'Ada', email: 'pub@x.io' });
		// delete-from-old still clears name on the source, keeping its email.
		expect(saveProfileFieldsMock.mock.calls[1][1]).toBe('dom-src');
		expect(saveProfileFieldsMock.mock.calls[1][2]).toEqual({ name: '', email: 'dom@x.io' });
	});

	it('moving EMAIL preserves NAME as the sibling on both entities', async () => {
		saveProfileFieldsMock.mockResolvedValue(undefined);

		await applyFieldMove(
			{
				cfg,
				personId: 'person-p',
				field: 'email',
				fromLevel: 'private',
				toLevel: 'domain',
				value: 'ada@x.io',
				srcId: 'pri-src',
				dstId: 'dom-existing',
				srcSibling: 'Ada-private-name',
				dstSibling: 'Ada-domain-name'
			},
			() => {}
		);

		expect(saveProfileFieldsMock.mock.calls[0][2]).toEqual({ email: 'ada@x.io', name: 'Ada-domain-name' });
		expect(saveProfileFieldsMock.mock.calls[1][2]).toEqual({ email: '', name: 'Ada-private-name' });
	});
});

// ── Interruption model — loss-safe: a crash leaves a DETECTABLE duplicate, never a loss ─

describe('applyFieldMove — interruption is loss-safe (create-before-delete)', () => {
	it('delete-from-old REJECTS after create confirmed → throws FieldMoveError(phase:"delete"); value is now in BOTH entities (a detectable duplicate, not a loss)', async () => {
		createOwnProfileMock.mockResolvedValue('pub-new');
		saveProfileFieldsMock
			.mockResolvedValueOnce(undefined) // add-to-new SUCCEEDS → value now in the new entity
			.mockRejectedValueOnce(new Error('saveProfileFields delete failed: 500')); // delete-from-old FAILS
		const phases: string[] = [];

		const err = await applyFieldMove(nameWiden(), (ph) => phases.push(ph)).catch((e) => e);

		expect(err).toBeInstanceOf(FieldMoveError);
		expect((err as FieldMoveError).phase).toBe('delete');
		// The create WAS confirmed (value written to the new entity) …
		expect(phases).toContain('created');
		// … and the delete WAS attempted against the source — so the value survives in
		// BOTH the new AND the old entity: a duplicate, never a loss.
		expect(saveProfileFieldsMock).toHaveBeenCalledTimes(2);
		expect(saveProfileFieldsMock.mock.calls[0][1]).toBe('pub-new');
		expect(saveProfileFieldsMock.mock.calls[1][1]).toBe('dom-src');
	});

	it('add-to-new REJECTS after the shell was minted → FieldMoveError(phase:"create") carrying createdTargetId; delete-from-old is NEVER issued (value stays only in the source)', async () => {
		createOwnProfileMock.mockResolvedValue('shell-1'); // shell minted
		saveProfileFieldsMock.mockRejectedValueOnce(new Error('saveProfileFields save failed: 500')); // field-write fails

		const err = await applyFieldMove(nameWiden(), () => {}).catch((e) => e);

		expect(err).toBeInstanceOf(FieldMoveError);
		expect((err as FieldMoveError).phase).toBe('create');
		expect((err as FieldMoveError).createdTargetId).toBe('shell-1'); // retry updates the shell, no dup
		// The delete-from-old must NOT have run — only the failed add-to-new was attempted.
		expect(saveProfileFieldsMock).toHaveBeenCalledTimes(1);
		expect(saveProfileFieldsMock.mock.calls[0][1]).toBe('shell-1');
	});
});

// ── applyDuplicateRepair — completes the DELETE that the interrupted move didn't ──

describe('applyDuplicateRepair — completes the interrupted delete (AC3 privacy repair)', () => {
	it('clears the field on each given entity via saveProfileFields({field:"", sibling preserved}) and returns the cleared ids', async () => {
		saveProfileFieldsMock.mockResolvedValue(undefined);

		const res = await applyDuplicateRepair({
			cfg,
			field: 'name',
			clear: [
				{ id: 'pub-wider', sibling: 'pub@x.io' },
				{ id: 'dom-wider', sibling: 'dom@x.io' }
			]
		});

		expect(saveProfileFieldsMock).toHaveBeenCalledTimes(2);
		expect(saveProfileFieldsMock.mock.calls[0][1]).toBe('pub-wider');
		expect(saveProfileFieldsMock.mock.calls[0][2]).toEqual({ name: '', email: 'pub@x.io' });
		expect(saveProfileFieldsMock.mock.calls[1][1]).toBe('dom-wider');
		expect(saveProfileFieldsMock.mock.calls[1][2]).toEqual({ name: '', email: 'dom@x.io' });
		expect(res).toEqual({ field: 'name', clearedIds: ['pub-wider', 'dom-wider'] });
	});

	it('fails loud — the first clear failure propagates (never a partial silent success)', async () => {
		saveProfileFieldsMock.mockRejectedValueOnce(new Error('saveProfileFields save failed: 403'));
		await expect(
			applyDuplicateRepair({ cfg, field: 'email', clear: [{ id: 'pub-wider', sibling: 'Ada' }] })
		).rejects.toThrow(/403/);
	});
});

// ── planLoadedDuplicateRepairs — DETECT + PLAN at load (AC3), privacy-safe direction ─

describe('planLoadedDuplicateRepairs — detect interrupted moves at load, plan a privacy-safe repair (AC3)', () => {
	const P = (id: string, sharing: MyProfile['_sharing'], name: string, email: string): MyProfile => ({
		_id: id,
		_sharing: sharing,
		name,
		email
	});

	it('name present on domain AND public → ONE plan: keep the narrowest (domain), clear the wider (public), preserving its sibling', () => {
		const plans = planLoadedDuplicateRepairs([
			P('prof-dom', 'domain', 'Ada', 'dom@x.io'),
			P('prof-pub', 'public', 'Ada', 'pub@x.io')
		]);
		expect(plans).toHaveLength(1);
		expect(plans[0]).toEqual({
			field: 'name',
			narrowLevel: 'domain',
			narrowId: 'prof-dom',
			widerLevels: ['public'],
			clear: [{ id: 'prof-pub', sibling: 'pub@x.io' }] // sibling = the wider entity's EMAIL
		});
	});

	it('no field is duplicated → an EMPTY plan list (a single-held field is a legitimate state)', () => {
		const plans = planLoadedDuplicateRepairs([
			P('prof-dom', 'domain', 'Ada', ''),
			P('prof-pub', 'public', '', 'ada@x.io')
		]);
		expect(plans).toEqual([]);
	});

	it('BOTH fields duplicated → a plan per field', () => {
		const plans = planLoadedDuplicateRepairs([
			P('prof-pri', 'private', 'Ada', 'ada@x.io'),
			P('prof-dom', 'domain', 'Ada', 'ada@x.io')
		]);
		expect(plans.map((p) => p.field).sort()).toEqual(['email', 'name']);
		// Narrowest (private) is kept for both; the domain copy is cleared.
		for (const plan of plans) {
			expect(plan.narrowLevel).toBe('private');
			expect(plan.narrowId).toBe('prof-pri');
			expect(plan.widerLevels).toEqual(['domain']);
			expect(plan.clear.map((c) => c.id)).toEqual(['prof-dom']);
		}
	});

	it('three-level duplicate → keep private, clear BOTH domain and public (all holders wider than the narrowest)', () => {
		const plans = planLoadedDuplicateRepairs([
			P('prof-pri', 'private', 'Ada', ''),
			P('prof-dom', 'domain', 'Ada', ''),
			P('prof-pub', 'public', 'Ada', '')
		]);
		expect(plans).toHaveLength(1);
		expect(plans[0].narrowLevel).toBe('private');
		expect(plans[0].widerLevels).toEqual(['domain', 'public']);
		expect(plans[0].clear.map((c) => c.id)).toEqual(['prof-dom', 'prof-pub']);
	});
});

// ── applyConflictResolution — #131 browse-then-confirm: sync every OTHER
// holder to the previewed (second-tapped) tier's value ────────────────────
// Distinct from applyDuplicateRepair: a conflict is DIFFERENT legitimate
// values across tiers (not an interrupted move) — resolving it WRITES the
// chosen value onto every other holder rather than clearing them to ''. No
// entity is deleted; every existing holder keeps its own row, now converged
// on the same value (which planLoadedDuplicateRepairs then sees as a
// same-value duplicate — the pre-existing collapse-to-one-entity path).

describe('applyConflictResolution — sync every other holder to the previewed value (#131)', () => {
	it('writes the chosen value onto each given entity via saveProfileFields({field: value, sibling preserved}) and returns the synced ids', async () => {
		saveProfileFieldsMock.mockResolvedValue(undefined);

		const res = await applyConflictResolution({
			cfg,
			field: 'name',
			value: 'Annie',
			sync: [{ id: 'prof-dom', sibling: 'dom@x.io' }]
		});

		expect(saveProfileFieldsMock).toHaveBeenCalledTimes(1);
		expect(saveProfileFieldsMock.mock.calls[0][1]).toBe('prof-dom');
		expect(saveProfileFieldsMock.mock.calls[0][2]).toEqual({ name: 'Annie', email: 'dom@x.io' });
		expect(res).toEqual({ field: 'name', syncedIds: ['prof-dom'] });
	});

	it('syncs multiple holders in order, each with its OWN preserved sibling', async () => {
		saveProfileFieldsMock.mockResolvedValue(undefined);

		const res = await applyConflictResolution({
			cfg,
			field: 'name',
			value: 'Annie',
			sync: [
				{ id: 'prof-pri', sibling: 'pri@x.io' },
				{ id: 'prof-dom', sibling: 'dom@x.io' }
			]
		});

		expect(saveProfileFieldsMock).toHaveBeenCalledTimes(2);
		expect(saveProfileFieldsMock.mock.calls[0][1]).toBe('prof-pri');
		expect(saveProfileFieldsMock.mock.calls[0][2]).toEqual({ name: 'Annie', email: 'pri@x.io' });
		expect(saveProfileFieldsMock.mock.calls[1][1]).toBe('prof-dom');
		expect(saveProfileFieldsMock.mock.calls[1][2]).toEqual({ name: 'Annie', email: 'dom@x.io' });
		expect(res).toEqual({ field: 'name', syncedIds: ['prof-pri', 'prof-dom'] });
	});

	it('an empty sync list is a no-op — no write, empty syncedIds', async () => {
		const res = await applyConflictResolution({ cfg, field: 'email', value: 'a@x.io', sync: [] });
		expect(saveProfileFieldsMock).not.toHaveBeenCalled();
		expect(res).toEqual({ field: 'email', syncedIds: [] });
	});

	it('fails loud — the first sync failure propagates (never a partial silent success)', async () => {
		saveProfileFieldsMock.mockRejectedValueOnce(new Error('saveProfileFields save failed: 403'));
		await expect(
			applyConflictResolution({
				cfg,
				field: 'name',
				value: 'Annie',
				sync: [{ id: 'prof-dom', sibling: 'dom@x.io' }]
			})
		).rejects.toThrow(/403/);
	});
});
