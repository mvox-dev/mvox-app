import { applyProfileSave, ProfileSaveError, type ApplyProfileSaveInput } from './applyProfileSave';
import type { Level } from './profileData';

// Saves per Level (#26): "saved" waits for the server; a stale-generation settle touches no UI.

export interface ProfileEditCallbacks {
	setPending(level: Level, pending: boolean): void;
	reconcile(level: Level, profileId: string, fields: { name: string; email: string }): void;
	// A partial save: the shell exists, so a retry updates it instead of making a duplicate.
	recordCreatedId(level: Level, profileId: string): void;
	markFailed(level: Level): void;
}

export interface ProfileEditQueue {
	request(input: ApplyProfileSaveInput): void;
	// On a collective switch: a stale level slot would otherwise swallow a fresh same-level save.
	reset(): void;
}

export function createProfileEditQueue(
	cb: ProfileEditCallbacks,
	getGeneration: () => number
): ProfileEditQueue {
	const pending = new Set<Level>();

	return {
		request(input) {
			const { cfg, personId, level, existingId, fields } = input;

			// A backstop: the caller also disables the level's control while pending.
			if (pending.has(level)) return;

			const gen = getGeneration();
			pending.add(level);
			cb.setPending(level, true);

			applyProfileSave({ cfg, personId, level, existingId, fields })
				.then((res) => {
					pending.delete(level); // freed before the guard, so no level sticks pending
					if (getGeneration() !== gen) return;
					cb.setPending(level, false);
					cb.reconcile(level, res.profileId, fields);
				})
				.catch((e: unknown) => {
					pending.delete(level);
					if (getGeneration() !== gen) return;
					cb.setPending(level, false);
					if (e instanceof ProfileSaveError && e.createdProfileId) {
						cb.recordCreatedId(level, e.createdProfileId);
					}
					cb.markFailed(level);
				});
		},
		reset() {
			pending.clear();
		}
	};
}

// (*MVOX:Tallis* — orchestrator + AC2 spec)
// (*MVOX:Josquin* — GREEN implementation)
