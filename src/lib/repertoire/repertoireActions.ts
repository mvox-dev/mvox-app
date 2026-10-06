import { entuFetch } from '$lib/entu/request';
import { reportProblem } from '$lib/problems/reportProblem';
import { referenceIds } from '$lib/entu/references';
import { replaceEntityProperty } from '$lib/entu/replaceProperty';
import { resolveTypeId, type EntuCfg } from '$lib/seasons/entuSeasons';
import type { Work } from '$lib/library/libraryData';
import type { RepertoireItem } from './repertoireData';
import type { ManageRightsState, RepertoireStatus } from './types';

export type { RepertoireStatus } from './types';

export interface CreateRepertoireItemInput {
	seasonId: string;
	workId: string;
	status?: RepertoireStatus;
}

export async function createRepertoireItem(
	cfg: EntuCfg,
	input: CreateRepertoireItemInput,
	fetchImpl: typeof fetch = fetch
): Promise<string> {
	const typeId = await resolveTypeId(cfg, 'repertoire_item', fetchImpl);
	const status = input.status ?? 'active';
	// `_sharing` inherited from the season parent (itself inherited from the
	// org) via Entu's create-time copy — #133.
	const props = [
		{ type: '_type', reference: typeId },
		{ type: '_parent', reference: input.seasonId },
		{ type: 'work', reference: input.workId },
		{ type: 'status', string: status }
	];
	const res = await entuFetch(
		cfg.db,
		'entity',
		cfg.token,
		{ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(props) },
		fetchImpl
	);
	if (!res.ok) throw new Error(`createRepertoireItem failed: ${res.status}`);
	const body = (await res.json()) as { _id: string };
	return body._id;
}

export async function updateRepertoireStatus(
	cfg: EntuCfg,
	itemId: string,
	status: RepertoireStatus,
	fetchImpl: typeof fetch = fetch
): Promise<void> {
	await replaceEntityProperty(cfg, itemId, { type: 'status', string: status }, fetchImpl, 'updateRepertoireStatus');
}

export async function pinEdition(
	cfg: EntuCfg,
	itemId: string,
	editionId: string,
	fetchImpl: typeof fetch = fetch
): Promise<void> {
	await replaceEntityProperty(cfg, itemId, { type: 'edition', reference: editionId }, fetchImpl, 'pinEdition');
}

/** Delete a repertoire_item entity ("Remove" — #91). The work itself is untouched. */
export async function deleteRepertoireItem(
	cfg: EntuCfg,
	itemId: string,
	fetchImpl: typeof fetch = fetch
): Promise<void> {
	const res = await entuFetch(cfg.db, `entity/${itemId}`, cfg.token, { method: 'DELETE' }, fetchImpl);
	if (!res.ok) throw new Error(`deleteRepertoireItem failed: ${res.status}`);
}

export interface CreateProgramItemInput {
	eventId: string;
	editionId: string;
	ordinal: number;
}

export async function createProgramItem(
	cfg: EntuCfg,
	input: CreateProgramItemInput,
	fetchImpl: typeof fetch = fetch
): Promise<string> {
	const typeId = await resolveTypeId(cfg, 'program_item', fetchImpl);
	const props = [
		{ type: '_type', reference: typeId },
		{ type: '_parent', reference: input.eventId },
		{ type: 'edition', reference: input.editionId },
		{ type: 'ordinal', number: input.ordinal }
	];
	const res = await entuFetch(
		cfg.db,
		'entity',
		cfg.token,
		{ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(props) },
		fetchImpl
	);
	if (!res.ok) throw new Error(`createProgramItem failed: ${res.status}`);
	const body = (await res.json()) as { _id: string };
	return body._id;
}

export async function updateProgramItemOrdinal(
	cfg: EntuCfg,
	itemId: string,
	ordinal: number,
	fetchImpl: typeof fetch = fetch
): Promise<void> {
	await replaceEntityProperty(
		cfg,
		itemId,
		{ type: 'ordinal', number: ordinal },
		fetchImpl,
		'updateProgramItemOrdinal'
	);
}

/** One program_item's position, as read off the rendered programme. */
export interface ProgramOrdinal {
	id: string;
	ordinal: number;
}

export function planProgramMove(
	items: ProgramOrdinal[],
	itemId: string,
	direction: 'up' | 'down'
): ProgramOrdinal[] {
	// Display order — the same stable sort the renderer uses, so "the row above"
	// here is the row the editor actually saw above.
	const ordered = [...items].sort((a, b) => a.ordinal - b.ordinal);
	const from = ordered.findIndex((item) => item.id === itemId);
	if (from === -1) return [];
	const to = direction === 'up' ? from - 1 : from + 1;
	if (to < 0 || to >= ordered.length) return [];

	const moved = [...ordered];
	const [item] = moved.splice(from, 1);
	moved.splice(to, 0, item);

	const current = new Map(items.map((i) => [i.id, i.ordinal]));
	return moved
		.map((entry, index) => ({ id: entry.id, ordinal: index }))
		.filter((entry) => current.get(entry.id) !== entry.ordinal);
}

export async function reorderProgramItems(
	cfg: EntuCfg,
	writes: ProgramOrdinal[],
	fetchImpl: typeof fetch = fetch
): Promise<void> {
	for (const write of writes) {
		await updateProgramItemOrdinal(cfg, write.id, write.ordinal, fetchImpl);
	}
}

export async function deleteProgramItem(
	cfg: EntuCfg,
	itemId: string,
	fetchImpl: typeof fetch = fetch
): Promise<void> {
	const res = await entuFetch(cfg.db, `entity/${itemId}`, cfg.token, { method: 'DELETE' }, fetchImpl);
	if (!res.ok) throw new Error(`deleteProgramItem failed: ${res.status}`);
}

// Defined next to the view model (repertoire/types.ts) for the same reason as
// RepertoireStatus — the renderer names it without importing the write layer.
export type { ManageRightsState } from './types';

export function manageRightsFrom(
	owners: readonly string[],
	editors: readonly string[],
	personId: string
): ManageRightsState {
	return owners.includes(personId) || editors.includes(personId) ? 'editor' : 'not-editor';
}

export async function resolveManageRights(
	cfg: EntuCfg,
	entityId: string,
	personId: string,
	fetchImpl: typeof fetch = fetch
): Promise<ManageRightsState> {
	try {
		const res = await entuFetch(
			cfg.db,
			`entity/${entityId}?props=_owner,_editor`,
			cfg.token,
			{},
			fetchImpl
		);
		if (!res.ok) {
			reportRightsReadFailure(entityId, new Error(`HTTP ${res.status}`));
			return 'error';
		}
		const body = (await res.json()) as {
			entity?: {
				_owner?: Array<{ reference?: string }>;
				_editor?: Array<{ reference?: string }>;
			};
		};
		const entity = body.entity ?? {};
		const owners = referenceIds(entity._owner);
		const editors = referenceIds(entity._editor);
		return manageRightsFrom(owners, editors, personId);
	} catch (e) {
		reportRightsReadFailure(entityId, e);
		return 'error';
	}
}

function reportRightsReadFailure(entityId: string, error: unknown): void {
	reportProblem({ area: 'rights', action: `reading the rights on ${entityId}`, error });
}

export function canMarkAttendance(
	event: { owners: readonly string[]; editors: readonly string[] },
	personId: string
): boolean {
	return manageRightsFrom(event.owners, event.editors, personId) === 'editor';
}

export function canDeleteSeries(
	series: { ownerIds?: readonly string[] },
	personId: string
): boolean {
	// `ownerIds` missing reads exactly like `[]` (absence IS no grant) — a
	// pre-#400 fixture/caller that predates this field must fail closed the
	// same way a live read with the private bucket withheld does, never throw.
	return manageRightsFrom(series.ownerIds ?? [], [], personId) === 'editor';
}

export function pickableWorks(works: Work[], repertoire: RepertoireItem[]): Work[] {
	const presentWorkIds = new Set(repertoire.map((item) => item.workId));
	return works.filter((work) => !presentWorkIds.has(work.id));
}

export interface RepertoireWriteQueueCallbacks {
	/** Mark/unmark `key` as having a write in flight, synchronously. */
	setPending(key: string, pending: boolean): void;
	/** The write for `key` settled successfully — the optimistic value (if any)
	 *  is now real; refresh against the server. */
	reconcile(key: string): void;
	/** The write for `key` failed. Fires AFTER the request's own `rollback`, so
	 *  the local state is already back to its pre-tap value by the time this
	 *  runs — this is the place to surface the failure, not to undo it. */
	revert(key: string): void;
}

export interface OptimisticHooks {
	/** Applied SYNCHRONOUSLY before the write is fired — the row must change on
	 *  tap, not after a round-trip. */
	apply?: () => void;
	/** Undo of `apply`, run on rejection before `revert(key)`. Supply it
	 *  whenever `apply` is supplied; without it a failed write leaves a lie on
	 *  screen. */
	rollback?: () => void;
}

export interface RepertoireWriteQueue {
	/** Fire `write` immediately for `key`, unless `key` already has a write in
	 *  flight (defensive backstop — the primary guard is the UI disabling the
	 *  control for a pending key). `hooks.apply` runs synchronously first. */
	request(key: string, write: () => Promise<void>, hooks?: OptimisticHooks): void;
	isPending(key: string): boolean;
}

export function createRepertoireWriteQueue(callbacks: RepertoireWriteQueueCallbacks): RepertoireWriteQueue {
	const pending = new Set<string>();

	return {
		request(key, write, hooks) {
			if (pending.has(key)) return;

			pending.add(key);
			callbacks.setPending(key, true);
			// Before the write, not after: the row changes on tap.
			hooks?.apply?.();

			write()
				.then(() => {
					pending.delete(key);
					callbacks.setPending(key, false);
					callbacks.reconcile(key);
				})
				.catch(() => {
					pending.delete(key);
					callbacks.setPending(key, false);
					// Undo the optimistic mutation FIRST, so `revert` observes (and the
					// user sees) the pre-tap state, not the lie.
					hooks?.rollback?.();
					callbacks.revert(key);
				});
		},
		isPending(key) {
			return pending.has(key);
		}
	};
}

// (*MVOX:Josquin*)
