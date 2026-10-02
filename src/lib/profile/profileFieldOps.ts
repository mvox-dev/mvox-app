// The profile page's field state and its save, move, repair and resolve handlers.
import { tick } from 'svelte';
import { m } from '$lib/paraglide/messages.js';
import {
	applyConflictResolution,
	FieldMoveError,
	type DuplicateRepairPlan,
	type FieldKey
} from '$lib/profile/fieldMove';
import { createFieldMoveQueue } from '$lib/profile/fieldMoveQueue';
import { createProfileEditQueue } from '$lib/profile/profileEditQueue';
import { createAutosave } from '$lib/profile/autosave';
import { withItem } from '$lib/collections/immutable';
import type { FieldResolution, Level, MyProfile } from '$lib/profile/profileData';
import type { EntuCfg } from '$lib/seasons/entuSeasons';

export const FIELDS: readonly FieldKey[] = ['name', 'email'];
const otherField = (f: FieldKey): FieldKey => (f === 'name' ? 'email' : 'name');

// Confirmed state stays per-entity (the backend model is per-entity).
export function emptyConfirmed(): Record<Level, { id: string | null; name: string; email: string }> {
	return {
		public: { id: null, name: '', email: '' },
		domain: { id: null, name: '', email: '' },
		private: { id: null, name: '', email: '' }
	};
}

export function createProfileFieldState() {
	return {
		draft: { name: '', email: '' } as { name: string; email: string },
		confirmed: emptyConfirmed(),
		savingFields: new Set() as Set<FieldKey>,
		failedFields: new Set() as Set<FieldKey>,
		pendingLevels: new Set() as Set<Level>,
		loadedProfiles: [] as MyProfile[],
		transport: { name: null, email: null } as Record<FieldKey, Level | null>,
		moveFailed: new Set() as Set<FieldKey>,
		repairWorking: new Set() as Set<FieldKey>,
		repairFailed: new Set() as Set<FieldKey>,
		// #257 — set on repair success, cleared at the start of the next attempt, never a timer.
		repairStatus: '',
		busy: false
	};
}

export type ProfileFieldState = ReturnType<typeof createProfileFieldState>;

export interface ProfileFieldDeps {
	isOffline: () => boolean;
	writesInFlight: () => boolean;
	resFor: (f: FieldKey) => FieldResolution;
	planFor: (f: FieldKey) => DuplicateRepairPlan | undefined;
	activeLevelFor: (f: FieldKey) => Level;
	activeContext: () => { cfg: EntuCfg; personId: string } | null;
	generation: () => number;
	loadForSelected: () => Promise<void>;
	refreshCompletionGate: () => void;
}

export function createProfileFieldOps(pf: ProfileFieldState, deps: ProfileFieldDeps) {
	const { isOffline, writesInFlight, resFor, planFor, activeLevelFor, activeContext } = deps;
	let pendingMoveTo: Record<FieldKey, Level | null> = { name: null, email: null };

	function isDirty(field: FieldKey): boolean {
		const level = activeLevelFor(field);
		return pf.draft[field] !== pf.confirmed[level][field];
	}

	// #160 — the tier picker reads holders off `loadedProfiles`, not `confirmed`, so every
	// settle mirrors onto it what a reload's `profilesByLevel` would produce.
	function upsertLoadedProfile(level: Level, id: string, name: string, email: string): void {
		pf.loadedProfiles = [
			...pf.loadedProfiles.filter((p) => p._sharing !== level),
			{ _id: id, name, email, _sharing: level }
		];
	}

	const queue = createProfileEditQueue(
		{
			setPending(level, isPending) {
				pf.pendingLevels = withItem(pf.pendingLevels, level, isPending);
			},
			reconcile(level, profileId, fields) {
				// Read before the mirror below: a save that clears a field drops its only holder,
				// and reading after would leave its `savingFields` marker set forever.
				const affected = FIELDS.filter((f) => activeLevelFor(f) === level);
				pf.confirmed = {
					...pf.confirmed,
					[level]: { id: profileId, name: fields.name, email: fields.email }
				};
				upsertLoadedProfile(level, profileId, fields.name, fields.email);
				for (const f of affected) {
					pf.savingFields = withItem(pf.savingFields, f, false);
					pf.failedFields = withItem(pf.failedFields, f, false);
				}
				if (level === 'domain') {
					deps.refreshCompletionGate();
				}
			},
			recordCreatedId(level, profileId) {
				pf.confirmed = { ...pf.confirmed, [level]: { ...pf.confirmed[level], id: profileId } };
				// #160 — an empty shell is no holder, but mirroring it lets a later move into
				// this tier reuse it instead of creating a second entity at the same level.
				const c = pf.confirmed[level];
				upsertLoadedProfile(level, profileId, c.name, c.email);
			},
			markFailed(level) {
				for (const f of FIELDS) {
					if (activeLevelFor(f) === level) {
						pf.savingFields = withItem(pf.savingFields, f, false);
						pf.failedFields = withItem(pf.failedFields, f, true);
					}
				}
			}
		},
		deps.generation
	);

	const moveQueue = createFieldMoveQueue(
		{
			setTransport(field, level, on) {
				pf.transport = { ...pf.transport, [field]: on ? level : null };
			},
			onCreateConfirmed() {},
			onMoveConfirmed(field) {
				pf.busy = false;
				pf.moveFailed = withItem(pf.moveFailed, field, false);
				void deps.loadForSelected();
				if (field === 'name') deps.refreshCompletionGate();
			},
			onMoveFailed(field, err) {
				pf.busy = false;
				if (err instanceof FieldMoveError && err.phase === 'delete') {
					void deps.loadForSelected();
				} else {
					if (err instanceof FieldMoveError && err.createdTargetId) {
						const id = err.createdTargetId;
						const toLevel = pendingMoveTo[field];
						if (toLevel && !pf.loadedProfiles.some((p) => p._id === id)) {
							pf.loadedProfiles = [
								...pf.loadedProfiles,
								{ _id: id, name: '', email: '', _sharing: toLevel }
							];
						}
					}
					pf.moveFailed = withItem(pf.moveFailed, field, true);
				}
			},
			onRepairConfirmed(field) {
				pf.busy = false;
				pf.repairWorking = withItem(pf.repairWorking, field, false);
				pf.repairFailed = withItem(pf.repairFailed, field, false);
				// #257 — after the reload, whose reset would wipe it, and only if no switch
				// happened meanwhile: the reload resolves even when superseded.
				const reload = deps.loadForSelected();
				const g = deps.generation();
				void reload.then(() => {
					if (g !== deps.generation()) return;
					pf.repairStatus = m.profile_repair_done();
				});
			},
			onRepairFailed(field) {
				pf.busy = false;
				pf.repairWorking = withItem(pf.repairWorking, field, false);
				pf.repairFailed = withItem(pf.repairFailed, field, true);
			}
		},
		deps.generation
	);

	// The autosave onSave callback — dispatches through the existing queue.
	function onAutosave(field: FieldKey): void {
		// Offline: first, before the throw and the saving flips. The draft is kept as typed.
		if (isOffline()) return;
		if (!isDirty(field)) return;
		const activeLevel = activeLevelFor(field);

		// Name-private guard (loud failure, never silent return).
		if (field === 'name' && activeLevel === 'private') {
			throw new Error('name-private guard: name cannot be saved at private level');
		}

		const ctx = activeContext();
		if (!ctx) return;
		// The sibling value comes from the target entity's confirmed value, never the draft.
		const fields = {
			name: field === 'name' ? pf.draft.name : pf.confirmed[activeLevel].name,
			email: field === 'email' ? pf.draft.email : pf.confirmed[activeLevel].email
		};

		pf.savingFields = withItem(pf.savingFields, field, true);
		pf.failedFields = withItem(pf.failedFields, field, false);
		queue.request({
			cfg: ctx.cfg,
			personId: ctx.personId,
			level: activeLevel,
			existingId: pf.confirmed[activeLevel].id,
			fields
		});
	}

	const autosaveCtrl = createAutosave({ idleMs: 2_000, onSave: onAutosave });

	function onmove(field: FieldKey, toLevel: Level) {
		// Offline: before the name-private throw and before any pending/failed flip.
		if (isOffline()) return;
		if (writesInFlight()) return;

		// Name-private guard (loud failure on the move path).
		if (field === 'name' && toLevel === 'private') {
			throw new Error('name-private guard: name cannot be moved to private level');
		}

		const res = resFor(field);
		if (res.holders.length !== 1) return;
		const from = res.holders[0];
		if (from.level === toLevel) return;
		const ctx = activeContext();
		if (!ctx) return;
		const src = pf.loadedProfiles.find((p) => p._id === from.id);
		if (!src) return;
		const dst = pf.loadedProfiles.find((p) => p._sharing === toLevel) ?? null;
		const other = otherField(field);
		pendingMoveTo = { ...pendingMoveTo, [field]: toLevel };
		pf.moveFailed = withItem(pf.moveFailed, field, false);
		pf.busy = true;
		moveQueue.move({
			cfg: ctx.cfg,
			personId: ctx.personId,
			field,
			fromLevel: from.level,
			toLevel,
			value: res.value,
			srcId: from.id,
			dstId: dst ? dst._id : null,
			srcSibling: src[other],
			dstSibling: dst ? dst[other] : ''
		});
	}

	function onrepair(field: FieldKey) {
		if (isOffline()) return;
		if (writesInFlight()) return;
		const plan = planFor(field);
		if (!plan) return;
		const ctx = activeContext();
		if (!ctx) return;
		pf.repairFailed = withItem(pf.repairFailed, field, false);
		pf.repairWorking = withItem(pf.repairWorking, field, true);
		// #257 — cleared at the start, so a failed retry shows no stale confirmation.
		pf.repairStatus = '';
		pf.busy = true;
		moveQueue.repair({ cfg: ctx.cfg, field, clear: plan.clear });
	}

	// #131 — a second tap on a previewed conflict tier converges every other holder onto
	// its value, then reloads; repair detection picks up the same-value duplicate.
	function handleResolve(field: FieldKey, level: Level) {
		if (isOffline()) return;
		if (writesInFlight()) return;
		const res = resFor(field);
		const other = otherField(field);
		const chosenValue = pf.confirmed[level][field];
		const sync = res.holders
			.filter((h) => h.level !== level)
			.map((h) => ({ id: h.id, sibling: pf.confirmed[h.level][other] }));
		const ctx = activeContext();
		if (!ctx) return;
		pf.busy = true;
		applyConflictResolution({ cfg: ctx.cfg, field, value: chosenValue, sync })
			.then(async () => {
				pf.busy = false;
				// Deferred a tick, so synchronous caller setup lands before the reload reads.
				await tick();
				deps.loadForSelected();
			})
			.catch((e) => {
				pf.busy = false;
				console.error('profile: conflict resolution failed', e);
			});
	}

	function handleValueChange(field: FieldKey, value: string) {
		pf.draft = { ...pf.draft, [field]: value };
		// Offline the keystroke is kept but no timer is armed, and a leftover one is cancelled.
		if (isOffline()) {
			autosaveCtrl.cancel(field);
			return;
		}
		autosaveCtrl.keystroke(field);
	}

	function handleBlur(field: FieldKey) {
		autosaveCtrl.blur(field);
	}

	// #205 — Escape kills the pending timer. If a mid-edit autosave already landed, the
	// reverted draft is now dirty against it, so the pre-edit value is written back.
	function handleCancel(field: FieldKey) {
		autosaveCtrl.cancel(field);
		if (!writesInFlight() && isDirty(field)) onAutosave(field);
	}

	function handleVisibilityChange(field: FieldKey, toLevel: Level) {
		// Save first; the cross-queue lock holds the move until the save settles.
		autosaveCtrl.visibilityChange(field);
		onmove(field, toLevel);
	}

	function reset(): void {
		pendingMoveTo = { name: null, email: null };
		autosaveCtrl.destroy();
		queue.reset();
		moveQueue.reset();
	}

	return {
		reset,
		onrepair,
		handleResolve,
		handleValueChange,
		handleBlur,
		handleCancel,
		handleVisibilityChange
	};
}
