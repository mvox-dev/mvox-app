import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EntuCfg } from '$lib/seasons/entuSeasons';

// T4.6/#26 — the create-vs-update dispatcher. Mock the data layer at its boundary
// (createOwnProfile / saveProfileFields); ProfileSaveError comes from the module
// under test itself. RED: applyProfileSave is a stub throwing 'not implemented'.

const { createOwnProfileMock, saveProfileFieldsMock } = vi.hoisted(() => ({
	createOwnProfileMock: vi.fn(),
	saveProfileFieldsMock: vi.fn()
}));
vi.mock('./profileData', () => ({
	createOwnProfile: createOwnProfileMock,
	saveProfileFields: saveProfileFieldsMock
}));

import { applyProfileSave, ProfileSaveError } from './applyProfileSave';

const cfg: EntuCfg = { db: 'testdb', token: 'jwt' };
const fields = { name: 'Ada', email: 'ada@example.com' };

beforeEach(() => {
	createOwnProfileMock.mockReset();
	saveProfileFieldsMock.mockReset();
});

describe('applyProfileSave — first save into a level (existingId === null)', () => {
	it('creates the shell via createOwnProfile THEN writes the fields, returning the new id', async () => {
		createOwnProfileMock.mockResolvedValue('new-prof-1');
		saveProfileFieldsMock.mockResolvedValue(undefined);

		const res = await applyProfileSave({ cfg, personId: 'person-p', level: 'public', existingId: null, fields });

		expect(createOwnProfileMock).toHaveBeenCalledTimes(1);
		// self-create funnel: (cfg, personId, level, ...) — never an ownerIds argument
		const [cfgArg, personArg, levelArg] = createOwnProfileMock.mock.calls[0];
		expect(cfgArg).toEqual(cfg);
		expect(personArg).toBe('person-p');
		expect(levelArg).toBe('public');

		expect(saveProfileFieldsMock).toHaveBeenCalledTimes(1);
		expect(saveProfileFieldsMock.mock.calls[0][1]).toBe('new-prof-1'); // fields written against the created id
		expect(saveProfileFieldsMock.mock.calls[0][2]).toEqual(fields);

		expect(res).toEqual({ profileId: 'new-prof-1' });
	});

	it('create then field-write ORDER: createOwnProfile resolves before saveProfileFields is called', async () => {
		const calls: string[] = [];
		createOwnProfileMock.mockImplementation(async () => {
			calls.push('create');
			return 'new-prof-1';
		});
		saveProfileFieldsMock.mockImplementation(async () => {
			calls.push('fields');
		});
		await applyProfileSave({ cfg, personId: 'person-p', level: 'domain', existingId: null, fields });
		expect(calls).toEqual(['create', 'fields']);
	});

	it('PARTIAL failure: shell created but field write rejects → throws ProfileSaveError carrying the created id', async () => {
		createOwnProfileMock.mockResolvedValue('new-prof-9');
		saveProfileFieldsMock.mockRejectedValue(new Error('save failed: 500'));

		const err = await applyProfileSave({ cfg, personId: 'person-p', level: 'private', existingId: null, fields }).catch(
			(e) => e
		);
		expect(err).toBeInstanceOf(ProfileSaveError);
		expect((err as ProfileSaveError).createdProfileId).toBe('new-prof-9');
	});

	it('create itself rejects → propagates the create error (no createdProfileId), and never attempts the field write', async () => {
		createOwnProfileMock.mockRejectedValue(new Error('createProfile failed: 403'));

		const err = await applyProfileSave({ cfg, personId: 'person-p', level: 'public', existingId: null, fields }).catch(
			(e) => e
		);
		// It must actually reach the create step (distinguishes real behaviour from a
		// stub that throws before dispatching) and surface THAT error, not a partial one.
		expect(createOwnProfileMock).toHaveBeenCalledTimes(1);
		expect((err as Error).message).toMatch(/403/);
		expect((err as ProfileSaveError).createdProfileId).toBeUndefined();
		expect(saveProfileFieldsMock).not.toHaveBeenCalled();
	});
});

describe('applyProfileSave — re-edit an existing level (existingId set)', () => {
	it('updates via saveProfileFields ONLY — createOwnProfile is NOT called — and returns the existing id', async () => {
		saveProfileFieldsMock.mockResolvedValue(undefined);

		const res = await applyProfileSave({
			cfg,
			personId: 'person-p',
			level: 'domain',
			existingId: 'existing-prof-3',
			fields
		});

		expect(createOwnProfileMock).not.toHaveBeenCalled();
		expect(saveProfileFieldsMock).toHaveBeenCalledTimes(1);
		expect(saveProfileFieldsMock.mock.calls[0][1]).toBe('existing-prof-3');
		expect(res).toEqual({ profileId: 'existing-prof-3' });
	});

	it('propagates a re-edit field-write failure (fail-loud, never swallowed)', async () => {
		saveProfileFieldsMock.mockRejectedValue(new Error('save failed: 500'));
		await expect(
			applyProfileSave({ cfg, personId: 'person-p', level: 'domain', existingId: 'existing-prof-3', fields })
		).rejects.toThrow(/500/);
	});
});
