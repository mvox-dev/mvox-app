// The repertoire row handlers shared by the agenda and the event page's works section.
import type { EntuCfg } from '$lib/seasons/entuSeasons';
import type { Edition } from '$lib/library/libraryData';
import type { RepertoireItem } from '$lib/repertoire/repertoireData';
import type { RepertoireStatus, WorkRow } from '$lib/repertoire/types';
import { reorderKey } from '$lib/repertoire/workRowOps';
import type { PendingMarks } from '$lib/repertoire/repertoirePending';
import {
	ADD_PROGRAMME_KEY,
	ADD_WORK_KEY
} from '$lib/agenda/RepertoireElement.svelte';
import type {
	createProgramItem,
	createRepertoireItem,
	deleteProgramItem,
	deleteRepertoireItem,
	pinEdition,
	planProgramMove,
	RepertoireWriteQueue,
	reorderProgramItems,
	updateRepertoireStatus
} from '$lib/repertoire/repertoireActions';

export interface RepertoireRowActions {
	createRepertoireItem: typeof createRepertoireItem;
	updateRepertoireStatus: typeof updateRepertoireStatus;
	pinEdition: typeof pinEdition;
	deleteProgramItem: typeof deleteProgramItem;
	deleteRepertoireItem: typeof deleteRepertoireItem;
	planProgramMove: typeof planProgramMove;
	reorderProgramItems: typeof reorderProgramItems;
	createProgramItem: typeof createProgramItem;
}

export interface RepertoireRowStore {
	list(eventId: string): WorkRow[];
	find(itemId: string): WorkRow | undefined;
	patch(itemId: string, patch: Partial<WorkRow>): void;
	drop(itemId: string, onlyEventId?: string): void;
	/** Returns the undo of a later `drop`. */
	snapshot(itemId: string, onlyEventId?: string): () => void;
	setOrdinals(eventId: string, ordinalById: Map<string, number>): void;
}

export interface RepertoireRowDeps {
	queue: RepertoireWriteQueue;
	actions: RepertoireRowActions;
	rows: RepertoireRowStore;
	cfg(): EntuCfg | null;
	isOffline(): boolean;
	seasonId(): string | null;
	editions(): readonly Edition[];
	seasonRepertoire: { get(): RepertoireItem[]; set(items: RepertoireItem[]): void };
	pending: PendingMarks;
}

export function createRepertoireRowHandlers(deps: RepertoireRowDeps) {
	const { queue, rows } = deps;

	function request(
		key: string,
		write: () => Promise<void>,
		apply: () => void,
		rollback: () => void
	): void {
		queue.request(key, write, {
			apply,
			rollback: () => {
				if (deps.pending.isCurrent(key)) rollback();
			}
		});
	}

	function addWork(workId: string): void {
		if (deps.isOffline()) return;
		const cfg = deps.cfg();
		const seasonId = deps.seasonId();
		if (!cfg || seasonId === null) return;
		queue.request(ADD_WORK_KEY, async () => {
			await deps.actions.createRepertoireItem(cfg, { seasonId, workId });
		});
	}

	function statusChange(itemId: string, status: RepertoireStatus): void {
		if (deps.isOffline()) return;
		const cfg = deps.cfg();
		const row = rows.find(itemId);
		if (!cfg || !row || row.kind !== 'repertoire') return;
		const before = row.status;
		request(
			itemId,
			() => deps.actions.updateRepertoireStatus(cfg, itemId, status),
			() => rows.patch(itemId, { status }),
			() => rows.patch(itemId, { status: before })
		);
	}

	function pinEdition(itemId: string, editionId: string): void {
		if (deps.isOffline()) return;
		const cfg = deps.cfg();
		const row = rows.find(itemId);
		if (!cfg || !row || row.kind !== 'repertoire') return;
		const before = { editionId: row.editionId, editionName: row.editionName };
		const editionName = deps.editions().find((e) => e.id === editionId)?.name ?? '';
		request(
			itemId,
			() => deps.actions.pinEdition(cfg, itemId, editionId),
			() => rows.patch(itemId, { editionId, editionName }),
			() => rows.patch(itemId, before)
		);
	}

	function removeItem(eventId: string, itemId: string): void {
		if (deps.isOffline()) return;
		const cfg = deps.cfg();
		const row = rows.list(eventId).find((r) => r.id === itemId);
		if (!cfg || !row) return;
		if (row.kind === 'program') {
			const restore = rows.snapshot(itemId, eventId);
			request(
				itemId,
				() => deps.actions.deleteProgramItem(cfg, itemId),
				() => rows.drop(itemId, eventId),
				restore
			);
			return;
		}
		const restore = rows.snapshot(itemId);
		const repertoireBefore = deps.seasonRepertoire.get();
		request(
			itemId,
			() => deps.actions.deleteRepertoireItem(cfg, itemId),
			() => {
				rows.drop(itemId);
				deps.seasonRepertoire.set(deps.seasonRepertoire.get().filter((item) => item.id !== itemId));
			},
			() => {
				restore();
				deps.seasonRepertoire.set(repertoireBefore);
			}
		);
	}

	function move(eventId: string, itemId: string, direction: 'up' | 'down'): void {
		if (deps.isOffline()) return;
		const cfg = deps.cfg();
		if (!cfg) return;
		const items = rows
			.list(eventId)
			.filter((row) => row.kind === 'program')
			.map((row) => ({ id: row.id, ordinal: row.ordinal ?? 0 }));
		const plan = deps.actions.planProgramMove(items, itemId, direction);
		if (plan.length === 0) return;
		const key = reorderKey(eventId);
		deps.pending.mark(
			key,
			items.map((item) => item.id)
		);
		const before = new Map(
			plan.map((entry) => [entry.id, items.find((i) => i.id === entry.id)?.ordinal ?? 0])
		);
		const after = new Map(plan.map((entry) => [entry.id, entry.ordinal]));
		request(
			key,
			() => deps.actions.reorderProgramItems(cfg, plan),
			() => rows.setOrdinals(eventId, after),
			() => rows.setOrdinals(eventId, before)
		);
	}

	function addProgramItem(eventId: string, editionId: string, ordinal: number): void {
		if (deps.isOffline()) return;
		const cfg = deps.cfg();
		if (!cfg) return;
		queue.request(ADD_PROGRAMME_KEY, async () => {
			await deps.actions.createProgramItem(cfg, { eventId, editionId, ordinal });
		});
	}

	return { addWork, statusChange, pinEdition, removeItem, move, addProgramItem };
}
