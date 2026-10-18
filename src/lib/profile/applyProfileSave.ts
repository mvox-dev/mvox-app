import type { EntuCfg } from '$lib/seasons/entuSeasons';
import { createOwnProfile, saveProfileFields, type Level } from './profileData';
import { assertDomainNamePersisted } from './completionGate';

// A first save is two calls, shell then fields. A failure once the shell exists throws a
// ProfileSaveError carrying its id, so a retry updates the shell instead of making a duplicate.

export class ProfileSaveError extends Error {
	readonly createdProfileId?: string;
	constructor(message: string, createdProfileId?: string) {
		super(message);
		this.name = 'ProfileSaveError';
		this.createdProfileId = createdProfileId;
	}
}

export interface ApplyProfileSaveInput {
	cfg: EntuCfg;
	personId: string;
	level: Level;
	existingId: string | null; // null: the first save into this level
	fields: { name: string; email: string };
}

export interface ApplyProfileSaveResult {
	profileId: string;
}

export async function applyProfileSave(
	input: ApplyProfileSaveInput,
	fetchImpl: typeof fetch = fetch
): Promise<ApplyProfileSaveResult> {
	const { cfg, personId, level, existingId, fields } = input;

	if (existingId === null) {
		const profileId = await createOwnProfile(cfg, personId, level, fetchImpl);
		try {
			await saveProfileFields(cfg, profileId, fields, fetchImpl);
		} catch {
			throw new ProfileSaveError('profile field save failed after create', profileId);
		}
		// The read-back can fail once the shell exists too: carry the id, or a retry duplicates it.
		try {
			await assertDomainNameIfCompletion(cfg, personId, level, fields, fetchImpl);
		} catch (e) {
			throw new ProfileSaveError(e instanceof Error ? e.message : String(e), profileId);
		}
		return { profileId };
	}

	await saveProfileFields(cfg, existingId, fields, fetchImpl);
	await assertDomainNameIfCompletion(cfg, personId, level, fields, fetchImpl);
	return { profileId: existingId };
}

async function assertDomainNameIfCompletion(
	cfg: EntuCfg,
	personId: string,
	level: Level,
	fields: { name: string; email: string },
	fetchImpl: typeof fetch
): Promise<void> {
	// Trimmed like hasDomainName: a whitespace-only name is still incomplete, not a failed save.
	if (level === 'domain' && fields.name.trim() !== '') {
		await assertDomainNamePersisted(cfg, personId, fetchImpl);
	}
}

// (*MVOX:Tallis* — dispatcher spec)
// (*MVOX:Josquin* — GREEN implementation)
