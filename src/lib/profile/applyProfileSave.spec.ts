import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EntuCfg } from '$lib/seasons/entuSeasons';

// T4.6/#26 — the create-vs-update dispatcher. Mock the data layer at its boundary
// (createOwnProfile / saveProfileFields); ProfileSaveError comes from the module
// under test itself. RED: applyProfileSave is a stub throwing 'not implemented'.

const { createOwnProfileMock, saveProfileFieldsMock, assertDomainNamePersistedMock } = vi.hoisted(() => ({
	createOwnProfileMock: vi.fn(),
	saveProfileFieldsMock: vi.fn(),
	assertDomainNamePersistedMock: vi.fn()
}));
vi.mock('./profileData', () => ({
	createOwnProfile: createOwnProfileMock,
	saveProfileFields: saveProfileFieldsMock
}));
// T4.8/#28 — Case 2 write-path post-condition. applyProfileSave (GREEN) calls this
// after a DOMAIN name-save reports success; it re-reads and throws on a success-but-
// nameless inconsistency. Mocked here at the module boundary. Inert in RED (the
// current applyProfileSave does not import it yet) → the existing tests stay green.
vi.mock('./completionGate', () => ({
	assertDomainNamePersisted: assertDomainNamePersistedMock
}));

import { applyProfileSave, ProfileSaveError } from './applyProfileSave';

const cfg: EntuCfg = { db: 'testdb', token: 'jwt' };
const fields = { name: 'Ada', email: 'ada@example.com' };

beforeEach(() => {
	createOwnProfileMock.mockReset();
	saveProfileFieldsMock.mockReset();
	assertDomainNamePersistedMock.mockReset();
	assertDomainNamePersistedMock.mockResolvedValue(undefined); // default: read-back confirms the name
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

describe('applyProfileSave — T4.8/#28 Case 2 domain-name post-condition (write path, fail loud)', () => {
	it('a DOMAIN save with a name asserts the name persisted (read-back) after the write reports success', async () => {
		createOwnProfileMock.mockResolvedValue('dp-1');
		saveProfileFieldsMock.mockResolvedValue(undefined);

		const res = await applyProfileSave({
			cfg,
			personId: 'person-p',
			level: 'domain',
			existingId: null,
			fields: { name: 'Ann', email: '' }
		});

		expect(res).toEqual({ profileId: 'dp-1' });
		// The post-condition fired against the member's own person (cfg + personId).
		expect(assertDomainNamePersistedMock).toHaveBeenCalledTimes(1);
		expect(assertDomainNamePersistedMock.mock.calls[0][0]).toEqual(cfg);
		expect(assertDomainNamePersistedMock.mock.calls[0][1]).toBe('person-p');
	});

	it('CASE 2: the write reports success but read-back shows no name → the inconsistency propagates (fail loud, NOT a silent empty row)', async () => {
		createOwnProfileMock.mockResolvedValue('dp-1');
		saveProfileFieldsMock.mockResolvedValue(undefined);
		assertDomainNamePersistedMock.mockRejectedValue(
			new Error('completion gate: domain profile for person person-p reported a successful name save but read-back returned no domain name')
		);

		await expect(
			applyProfileSave({ cfg, personId: 'person-p', level: 'domain', existingId: null, fields: { name: 'Ann', email: '' } })
		).rejects.toThrow(/read-back returned no domain name/);
	});

	it('FIRST-SAVE + post-condition read-back FAILS (transient blip) → throws ProfileSaveError CARRYING the created id, so a retry updates the shell (no duplicate domain profile)', async () => {
		// The shell was already created AND the name genuinely persisted; only the
		// read-back transiently failed. The created id must survive so the queue records
		// it and a retry UPDATES the shell rather than re-entering the create branch.
		createOwnProfileMock.mockResolvedValue('dp-1');
		saveProfileFieldsMock.mockResolvedValue(undefined);
		assertDomainNamePersistedMock.mockRejectedValue(new Error('listMyProfiles failed: 503'));

		const err = await applyProfileSave({
			cfg,
			personId: 'person-p',
			level: 'domain',
			existingId: null,
			fields: { name: 'Ann', email: '' }
		}).catch((e) => e);

		expect(err).toBeInstanceOf(ProfileSaveError);
		expect((err as ProfileSaveError).createdProfileId).toBe('dp-1');
		expect((err as Error).message).toMatch(/503/); // the original cause still surfaces loud
	});

	it('FIRST-SAVE + a GENUINE inconsistency (2xx read-back, no name) → still ProfileSaveError carrying the id (loud + no duplicate on retry)', async () => {
		createOwnProfileMock.mockResolvedValue('dp-1');
		saveProfileFieldsMock.mockResolvedValue(undefined);
		assertDomainNamePersistedMock.mockRejectedValue(
			new Error('completion gate: domain profile for person person-p reported a successful name save but read-back returned no domain name')
		);

		const err = await applyProfileSave({
			cfg,
			personId: 'person-p',
			level: 'domain',
			existingId: null,
			fields: { name: 'Ann', email: '' }
		}).catch((e) => e);

		expect(err).toBeInstanceOf(ProfileSaveError);
		expect((err as ProfileSaveError).createdProfileId).toBe('dp-1');
		expect((err as Error).message).toMatch(/read-back returned no domain name/);
	});

	it('a domain save with a WHITESPACE-ONLY name (trimmed empty → Case 1) does NOT run the post-condition', async () => {
		saveProfileFieldsMock.mockResolvedValue(undefined);

		await applyProfileSave({
			cfg,
			personId: 'person-p',
			level: 'domain',
			existingId: 'existing-prof-3',
			fields: { name: '   ', email: 'ann@example.com' }
		});

		expect(assertDomainNamePersistedMock).not.toHaveBeenCalled();
	});

	it('a domain save with an EMPTY name (still Case 1) does NOT run the post-condition', async () => {
		saveProfileFieldsMock.mockResolvedValue(undefined);

		await applyProfileSave({
			cfg,
			personId: 'person-p',
			level: 'domain',
			existingId: 'existing-prof-3',
			fields: { name: '', email: 'ann@example.com' }
		});

		expect(assertDomainNamePersistedMock).not.toHaveBeenCalled();
	});

	it('a NON-domain (public) save does NOT run the post-condition (the gate mandates the name at the domain tier only)', async () => {
		createOwnProfileMock.mockResolvedValue('pp-1');
		saveProfileFieldsMock.mockResolvedValue(undefined);

		await applyProfileSave({
			cfg,
			personId: 'person-p',
			level: 'public',
			existingId: null,
			fields: { name: 'Ann', email: '' }
		});

		expect(assertDomainNamePersistedMock).not.toHaveBeenCalled();
	});
});
