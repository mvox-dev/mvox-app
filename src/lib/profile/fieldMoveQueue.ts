import type { FieldKey, FieldMoveInput, FieldMoveResult, DuplicateRepairInput, FieldMoveError } from './fieldMove';
import { applyFieldMove, applyDuplicateRepair } from './fieldMove';
import type { Level } from './profileData';

// T4.7/#27 — the honest-round-trip orchestrator for visibility MOVES. NOT an in-place
// extension of `profileEditQueue` (which is Level-keyed, one-op-per-level, single-
// `.then` reconcile — a move is TWO ops across TWO entities and does not fit). It
// reuses the same discipline knobs:
//   - server-confirmed-only settle: no icon reaches a settled state on dispatch; the
//     dst icon lights only when step-1 (create) server-confirms, the src icon goes
//     inactive only when step-2 (delete) server-confirms (two-phase honest round trip).
//   - fail-loud + preserve: a rejected move surfaces via `onMoveFailed` (its
//     `err.phase` drives banner-vs-icon) and NEVER a silent stuck state.
//   - generation guard: a settle after a collective switch no-ops the UI but STILL
//     frees the single-flight lock (never wedged) — the `profileEditQueue.ts:87` lesson.
//   - SINGLE-FLIGHT: at most one move/repair in flight, period. A move touches TWO
//     entities and `saveProfileFields` is a non-atomic whole-pair rewrite, so
//     serialize-by-entity is insufficient (a source/other-target collision slips
//     through). Single-flight is provably clobber-proof given 2 fields × 3 levels.

export interface FieldMoveCallbacks {
	/** Toggle the in-transport (spinner) state on one field's icon at one level. */
	setTransport(field: FieldKey, level: Level, on: boolean): void;
	/** Step 1 server-confirmed: the value now lives at `toLevel` (that icon is lit/active). */
	onCreateConfirmed(field: FieldKey, toLevel: Level): void;
	/** Step 2 server-confirmed: the value left the source; the move is DONE. */
	onMoveConfirmed(field: FieldKey, result: FieldMoveResult): void;
	/** The move FAILED — `err.phase` distinguishes a create failure (icon) from a
	 *  delete failure (a live-duplicate banner: the AC3 privacy repair). */
	onMoveFailed(field: FieldKey, err: FieldMoveError | Error): void;
	/** A duplicate repair completed — the field is now single-held (banner clears). */
	onRepairConfirmed(field: FieldKey): void;
	/** A duplicate repair FAILED — keep the banner (preserve-on-error), surface the error. */
	onRepairFailed(field: FieldKey, err: Error): void;
}

export interface FieldMoveQueue {
	move(req: FieldMoveInput): void;
	repair(req: DuplicateRepairInput): void;
	/** Release the single-flight lock — called on a collective switch so a stale
	 *  in-flight move does not wedge the next collective's moves. */
	reset(): void;
}

export function createFieldMoveQueue(
	cb: FieldMoveCallbacks,
	getGeneration: () => number
): FieldMoveQueue {
	// SINGLE-FLIGHT: at most one move/repair in flight. `inFlight` is ALWAYS freed in the
	// settle handler BEFORE the generation guard runs — a stale settle must never wedge
	// the lock (the profileEditQueue.ts:87 lesson).
	let inFlight = false;

	return {
		move(req: FieldMoveInput) {
			if (inFlight) return; // busy — single-flight backstop
			inFlight = true;
			const gen = getGeneration();
			// Dispatch: the TARGET icon goes in-transport. Nothing is settled on dispatch.
			cb.setTransport(req.field, req.toLevel, true);
			applyFieldMove(req, (phase, _id) => {
				// Per-step server confirmation. Guard against a collective switch mid-move —
				// a stale step callback must not touch the new collective's UI.
				if (getGeneration() !== gen) return;
				if (phase === 'created') {
					// Step 1 confirmed: dst spinner off + lit, THEN src spinner on.
					cb.setTransport(req.field, req.toLevel, false);
					cb.onCreateConfirmed(req.field, req.toLevel);
					cb.setTransport(req.field, req.fromLevel, true);
				}
				// 'deleted' → handled in .then (the move is fully done there).
			})
				.then((result) => {
					inFlight = false;
					if (getGeneration() !== gen) return;
					cb.setTransport(req.field, req.fromLevel, false); // src spinner off
					cb.onMoveConfirmed(req.field, result);
				})
				.catch((err: FieldMoveError | Error) => {
					inFlight = false;
					if (getGeneration() !== gen) return;
					// Fail-loud + never-stuck: clear BOTH transports, surface the phase-tagged error.
					cb.setTransport(req.field, req.toLevel, false);
					cb.setTransport(req.field, req.fromLevel, false);
					cb.onMoveFailed(req.field, err);
				});
		},
		repair(req: DuplicateRepairInput) {
			if (inFlight) return; // single-flight covers repairs too
			inFlight = true;
			const gen = getGeneration();
			applyDuplicateRepair(req)
				.then(() => {
					inFlight = false;
					if (getGeneration() !== gen) return;
					cb.onRepairConfirmed(req.field); // the delete landed → banner clears
				})
				.catch((err: Error) => {
					inFlight = false;
					if (getGeneration() !== gen) return;
					cb.onRepairFailed(req.field, err); // preserve-on-error: banner KEPT
				});
		},
		reset() {
			// Release the single-flight lock so a stale in-flight op does not wedge the next
			// collective's moves (its own settle still no-ops its UI via the generation guard).
			inFlight = false;
		}
	};
}

// (*MVOX:Tallis* — RED specs) (*MVOX:Josquin* — GREEN implementation)
