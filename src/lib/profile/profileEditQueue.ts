import { applyProfileSave, ProfileSaveError } from './applyProfileSave';
import type { EntuCfg } from '$lib/seasons/entuSeasons';
import type { Level } from './profileData';

// T4.6/#26 — the honest-round-trip orchestrator for profile saves, keyed by
// visibility Level. Mirrors `rsvpChangeQueue` (the #15 double-tap fix): it owns
// only the in-flight `pending` set and touches NO Svelte state — everything else
// lives with the caller, reached exclusively through per-level callbacks. Unit-
// testable with no DOM.
//
// AC2 (no "ready" without a server confirmation): `setPending(level,true)` fires
// synchronously on dispatch; `reconcile` (the "saved" flip) fires ONLY in `.then`,
// after `applyProfileSave` resolves with the server-confirmed profile id. A failure
// surfaces via `markFailed` and NEVER a silent stuck-pending.
//
// Two concurrent-save guards (the #15 lesson): (a) PRIMARY — the caller disables the
// level's inputs+button while pending (via `setPending`); (b) BACKSTOP — this
// module early-returns a duplicate in-flight `request` for the same level.
//
// Generation guard (the YELLOW-RSVP.1 residual RSVP left unfixed): both settle
// handlers re-check `getGeneration()` against the value captured at dispatch and
// no-op their UI callbacks if the collective/context changed meanwhile — while
// STILL freeing the `pending` slot — so a stale settle can never bleed one
// collective's write onto another's display, and never leaves a stuck-pending.
//
// `reset()` clears the in-flight `pending` set outright — the caller invokes it on a
// collective switch (the page is not remounted on a same-route switch, so a stale
// request from the old collective would otherwise keep its level's backstop closed
// and silently swallow a fresh same-level save in the new collective). A stale
// request that settles after a reset still no-ops its UI via the generation guard and
// its `pending.delete` is a harmless no-op on the already-cleared key.

export interface ProfileEditCallbacks {
	/** Mark/unmark this level's save as in flight — the caller disables the level's control. */
	setPending(level: Level, pending: boolean): void;
	/** SUCCESS: the server-confirmed real id + the confirmed fields; clears any failed mark. */
	reconcile(level: Level, profileId: string, fields: { name: string; email: string }): void;
	/** PARTIAL: the shell was created but the fields were NOT confirmed — record the id so a
	 *  retry UPDATES the shell instead of creating a duplicate. */
	recordCreatedId(level: Level, profileId: string): void;
	/** FAIL: surface an inline error for this level. The caller KEEPS the draft (preserve-on-error). */
	markFailed(level: Level): void;
}

export interface RequestInput {
	cfg: EntuCfg;
	personId: string;
	level: Level;
	/** null → first save into this level; set → re-edit an existing entity. */
	existingId: string | null;
	fields: { name: string; email: string };
}

export interface ProfileEditQueue {
	request(input: RequestInput): void;
	/** Clear the in-flight `pending` set — called on a collective switch so a stale
	 *  request's level does not keep its backstop closed and swallow a fresh save. */
	reset(): void;
}

export function createProfileEditQueue(
	cb: ProfileEditCallbacks,
	getGeneration: () => number
): ProfileEditQueue {
	// The only mutable state this module owns: which levels currently have a write in
	// flight. Everything else lives with the caller, reached through the per-level
	// callbacks. Mirrors rsvpChangeQueue's `pending` set.
	const pending = new Set<Level>();

	return {
		request(input) {
			const { cfg, personId, level, existingId, fields } = input;

			// Backstop against a concurrent save for the same level — the primary guard
			// is the caller disabling the level's control while pending (via setPending).
			if (pending.has(level)) return;

			// Capture the generation at dispatch; the settle handlers no-op their UI
			// callbacks if it changed meanwhile (collective switch) — no cross-collective
			// display bleed. RSVP guarded only reads; this guards the write settle too.
			const gen = getGeneration();
			pending.add(level);
			cb.setPending(level, true); // synchronous — nothing reaches "saved" here.

			applyProfileSave({ cfg, personId, level, existingId, fields })
				.then((res) => {
					pending.delete(level); // free the slot BEFORE the guard — never stuck-pending.
					if (getGeneration() !== gen) return;
					cb.setPending(level, false);
					// "saved" flips ONLY here — after the server-confirmed profile id.
					cb.reconcile(level, res.profileId, fields);
				})
				.catch((e: unknown) => {
					pending.delete(level);
					if (getGeneration() !== gen) return;
					cb.setPending(level, false);
					// Partial failure: the shell WAS created — record its id so a retry
					// updates it (no duplicate entity), then surface the failure.
					if (e instanceof ProfileSaveError && e.createdProfileId) {
						cb.recordCreatedId(level, e.createdProfileId);
					}
					cb.markFailed(level);
				});
		},
		reset() {
			// Release every in-flight level slot. A stale request already dispatched will
			// still settle, but its generation-guarded settle no-ops the UI and its
			// `pending.delete` is a no-op on the now-absent key.
			pending.clear();
		}
	};
}

// (*MVOX:Tallis* — orchestrator + AC2 spec)
// (*MVOX:Josquin* — GREEN implementation)
