import type { EntuCfg } from '$lib/seasons/entuSeasons';
import { createOwnProfile, saveProfileFields, type Level } from './profileData';
import { assertDomainNamePersisted } from './completionGate';

// T4.6/#26 — the write-dispatch half of the profile edit round trip. Kept
// framework-agnostic (touches no Svelte state) so it is unit-testable without a
// live component tree, exactly like `rsvpOptimistic.applyRsvpChange`.
//
// A FIRST save into a level is two wire calls because the frozen `createProfile`
// signature makes only the shell (`_sharing`, no name/email): create the shell,
// then POST the fields. If the shell create succeeds but the field write fails, we
// throw a `ProfileSaveError` CARRYING the created shell's id, so a retry UPDATES the
// existing shell instead of minting a duplicate entity (the honest partial-failure
// window). A re-edit (existingId set) is a single `saveProfileFields`, no create.
//
// REJECTS on any underlying failure — propagates, never swallows — so the
// orchestrator's fail-loud path (surface error, keep draft) always fires.

/**
 * A profile save failed. When `createdProfileId` is set, the level's shell entity
 * WAS created (only the field write failed) — a retry must UPDATE that id, never
 * create again.
 */
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
	/** null → first save into this level (create shell + fields); set → re-edit (update only). */
	existingId: string | null;
	fields: { name: string; email: string };
}

export interface ApplyProfileSaveResult {
	profileId: string;
}

/**
 * Dispatch one profile save:
 *   - `existingId === null` → `createOwnProfile` (shell) then `saveProfileFields`
 *     (fields). A field-write failure after a successful create throws
 *     `ProfileSaveError` with the created shell id attached.
 *   - `existingId` set → `saveProfileFields` only; `createOwnProfile` is NOT called.
 */
export async function applyProfileSave(
	input: ApplyProfileSaveInput,
	fetchImpl: typeof fetch = fetch
): Promise<ApplyProfileSaveResult> {
	const { cfg, personId, level, existingId, fields } = input;

	if (existingId === null) {
		// First save: create the shell (funnels through createProfile — fails loud on
		// non-2xx AND the 2xx-no-_id trap), THEN write the fields. If the shell was
		// created but the field write fails, throw a ProfileSaveError carrying the id
		// so a retry UPDATES the shell rather than minting a duplicate.
		const profileId = await createOwnProfile(cfg, personId, level, fetchImpl);
		try {
			await saveProfileFields(cfg, profileId, fields, fetchImpl);
		} catch {
			throw new ProfileSaveError('profile field save failed after create', profileId);
		}
		// T4.8/#28 Case 2 — the completion write is the ONLY birthplace of a post-gate
		// nameless domain profile. AFTER the domain name-save reports success, re-read
		// and require the name persisted; a success-but-nameless read-back throws loud
		// (assertDomainNamePersisted). The shell WAS already created above, so a read-back
		// failure here — a transient blip OR a genuine DomainNameInconsistencyError — must
		// still CARRY the created id: otherwise a retry re-enters this first-save branch
		// (existingId still null) and mints a DUPLICATE domain profile, defeating the whole
		// createdProfileId honest-partial window on the exact path this gate targets. Rewrap
		// as a ProfileSaveError so the queue records the id (retry UPDATES the shell) while
		// the original message still surfaces loud through failedLevels.
		try {
			await assertDomainNameIfCompletion(cfg, personId, level, fields, fetchImpl);
		} catch (e) {
			throw new ProfileSaveError(e instanceof Error ? e.message : String(e), profileId);
		}
		return { profileId };
	}

	// Re-edit: update the existing entity's fields only — no create.
	await saveProfileFields(cfg, existingId, fields, fetchImpl);
	await assertDomainNameIfCompletion(cfg, personId, level, fields, fetchImpl);
	return { profileId: existingId };
}

/**
 * T4.8/#28 Case 2 write-path post-condition. Fires ONLY for a domain name-save
 * (`level === 'domain' && fields.name !== ''`) — a non-domain save or an empty-name
 * (still Case 1) domain save is untouched. Re-reads and throws
 * `DomainNameInconsistencyError` if the name did not persist (fail loud, never a
 * silent empty row).
 */
async function assertDomainNameIfCompletion(
	cfg: EntuCfg,
	personId: string,
	level: Level,
	fields: { name: string; email: string },
	fetchImpl: typeof fetch
): Promise<void> {
	// TRIM the guard to match hasDomainName's predicate: a whitespace-only name is Case 1
	// (does not satisfy the gate), so it must NOT trigger the Case 2 post-condition — else
	// the read-back (which also trims) would report 'incomplete' and throw a spurious
	// DomainNameInconsistencyError for a legitimately-incomplete save.
	if (level === 'domain' && fields.name.trim() !== '') {
		await assertDomainNamePersisted(cfg, personId, fetchImpl);
	}
}

// (*MVOX:Tallis* — dispatcher spec)
// (*MVOX:Josquin* — GREEN implementation)
