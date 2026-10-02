// Visibility moves: write order and whole-pair bodies per entity.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EntuCfg } from '$lib/seasons/entuSeasons';
import type { MyProfile } from './profileData';
import { deferred, testCfg } from '$lib/testing/entuFetchKit';

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

const cfg = testCfg('testdb');

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

		const settled = applyFieldMove(nameWiden(), (ph) => phases.push(ph)).then(
			(r) => ({ ok: true as const, r }),
			(e) => ({ ok: false as const, e })
		);
		await Promise.resolve();
		await Promise.resolve();

		expect(createOwnProfileMock).toHaveBeenCalledTimes(1);
		expect(saveProfileFieldsMock).toHaveBeenCalledTimes(1);
		expect(phases).not.toContain('created');

		dstAdd.resolve();
		await settled;

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

describe('applyFieldMove — whole-pair writes preserve the sibling field', () => {
	it('target ABSENT: add-to-new carries {name:value, email:""}; delete-from-old carries {name:"", email:srcSibling}', async () => {
		createOwnProfileMock.mockResolvedValue('pub-new');
		saveProfileFieldsMock.mockResolvedValue(undefined);

		await applyFieldMove(nameWiden(), () => {});

		expect(saveProfileFieldsMock.mock.calls[0][1]).toBe('pub-new');
		expect(saveProfileFieldsMock.mock.calls[0][2]).toEqual({ name: 'Ada', email: '' });
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
		expect(saveProfileFieldsMock.mock.calls[0][1]).toBe('pub-existing');
		expect(saveProfileFieldsMock.mock.calls[0][2]).toEqual({ name: 'Ada', email: 'pub@x.io' });
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
		expect(phases).toContain('created');
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
		expect(saveProfileFieldsMock).toHaveBeenCalledTimes(1);
		expect(saveProfileFieldsMock.mock.calls[0][1]).toBe('shell-1');
	});
});

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
