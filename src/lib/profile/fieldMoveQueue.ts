import type { FieldKey, FieldMoveInput, FieldMoveResult, DuplicateRepairInput } from './fieldMove';
import { applyFieldMove, applyDuplicateRepair, FieldMoveError } from './fieldMove';
import type { Level } from './profileData';
import { reportProblem } from '$lib/problems/reportProblem';
import { writeOwner } from '$lib/problems/writeOwner';

// Visibility moves (#27): two writes on two entities, so at most one move or repair is in
// flight, each icon settles only on its server confirmation, and a settle after a collective
// switch frees the lock but touches no UI.

export interface FieldMoveCallbacks {
	setTransport(field: FieldKey, level: Level, on: boolean): void;
	onCreateConfirmed(field: FieldKey, toLevel: Level): void;
	onMoveConfirmed(field: FieldKey, result: FieldMoveResult): void;
	onMoveFailed(field: FieldKey, err: FieldMoveError | Error): void;
	onRepairConfirmed(field: FieldKey): void;
	onRepairFailed(field: FieldKey, err: Error): void;
}

export interface FieldMoveQueue {
	move(req: FieldMoveInput): void;
	repair(req: DuplicateRepairInput): void;
	reset(): void;
}

function moveStep(err: unknown): string {
	const deleting = err instanceof FieldMoveError && err.phase === 'delete';
	return `moving a profile field: ${deleting ? 'clearing it at the old level' : 'adding it at the new level'}`;
}

export function createFieldMoveQueue(
	cb: FieldMoveCallbacks,
	getGeneration: () => number
): FieldMoveQueue {
	let inFlight = false;

	return {
		move(req: FieldMoveInput) {
			if (inFlight) return;
			inFlight = true;
			const gen = getGeneration();
			const owner = writeOwner(req.cfg);
			cb.setTransport(req.field, req.toLevel, true);
			applyFieldMove(req, (phase) => {
				if (getGeneration() !== gen) return;
				if (phase === 'created') {
					cb.setTransport(req.field, req.toLevel, false);
					cb.onCreateConfirmed(req.field, req.toLevel);
					cb.setTransport(req.field, req.fromLevel, true);
				}
			})
				.then((result) => {
					inFlight = false;
					if (getGeneration() !== gen) return;
					cb.setTransport(req.field, req.fromLevel, false);
					cb.onMoveConfirmed(req.field, result);
				})
				.catch((err: FieldMoveError | Error) => {
					inFlight = false;
					reportProblem({ area: 'profile', action: moveStep(err), error: err, owner });
					if (getGeneration() !== gen) return;
					cb.setTransport(req.field, req.toLevel, false);
					cb.setTransport(req.field, req.fromLevel, false);
					cb.onMoveFailed(req.field, err);
				});
		},
		repair(req: DuplicateRepairInput) {
			if (inFlight) return;
			inFlight = true;
			const gen = getGeneration();
			const owner = writeOwner(req.cfg);
			applyDuplicateRepair(req)
				.then(() => {
					inFlight = false;
					if (getGeneration() !== gen) return;
					cb.onRepairConfirmed(req.field);
				})
				.catch((err: Error) => {
					inFlight = false;
					const action = 'repairing a profile field held at two levels';
					reportProblem({ area: 'profile', action, error: err, owner });
					if (getGeneration() !== gen) return;
					cb.onRepairFailed(req.field, err);
				});
		},
		reset() {
			inFlight = false;
		}
	};
}

// (*MVOX:Tallis* — RED specs) (*MVOX:Josquin* — GREEN implementation)
