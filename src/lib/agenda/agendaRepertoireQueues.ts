// The agenda's two repertoire write queues: the season card's rows and the manage panel's list.
import { get } from 'svelte/store';
import { m } from '$lib/paraglide/messages.js';
import { cfgFor } from '$lib/entu/cfg';
import { selectedCollectiveIdentityStore, sameCollectiveIdentity } from '$lib/collectives/store';
import { ADD_PROGRAMME_KEY, ADD_WORK_KEY } from '$lib/agenda/RepertoireElement.svelte';
import type { AgendaLoadState, LoadCounters } from '$lib/agenda/agendaLoad';
import type { EntuCfg } from '$lib/seasons/entuSeasons';
import type { RepertoireStatus } from '$lib/repertoire/types';
import type * as RepertoireActions from '$lib/repertoire/repertoireActions';
import type * as RepertoireData from '$lib/repertoire/repertoireData';
import {
	createRepertoireRowHandlers,
	type RepertoireRowActions,
	type RepertoireRowStore
} from '$lib/repertoire/repertoireRowHandlers';
import { createPendingMarks } from '$lib/repertoire/repertoirePending';
import { withItem } from '$lib/collections/immutable';

export const PANEL_ADD_WORK_KEY = '__panel_add_work__';

export function createAgendaPanelState() {
	return {
		pendingKeys: new Set() as Set<string>,
		manageError: false,
		manageStatus: '',
		pickableWorksVisible: undefined as boolean | undefined
	};
}

export type AgendaPanelState = ReturnType<typeof createAgendaPanelState>;

export interface AgendaRepertoireDeps {
	selected: () => { db: string } | null | undefined;
	isOffline: () => boolean;
	seasonManageOpen: () => boolean;
	switchGeneration: () => number;
	refreshWorksAfterWrite: () => void;
	rows: RepertoireRowStore;
	actions: RepertoireRowActions;
	createRepertoireWriteQueue: typeof RepertoireActions.createRepertoireWriteQueue;
	listRepertoireItems: typeof RepertoireData.listRepertoireItems;
}

export function createAgendaRepertoireQueues(
	ag: AgendaLoadState,
	seq: LoadCounters,
	panel: AgendaPanelState,
	deps: AgendaRepertoireDeps
) {
	const { actions } = deps;

	const repertoirePending = createPendingMarks(
		() => get(selectedCollectiveIdentityStore),
		sameCollectiveIdentity
	);

	const repertoireQueue = deps.createRepertoireWriteQueue({
		setPending(key, pending) {
			ag.managePendingKeys = repertoirePending.setPending(ag.managePendingKeys, key, pending);
			if (pending) ag.manageError = false;
		},
		reconcile(key) {
			if (!repertoirePending.settle(key)) return;
			syncPanelRepertoireAfterAgendaWrite();
			if (key === ADD_WORK_KEY || key === ADD_PROGRAMME_KEY) deps.refreshWorksAfterWrite();
		},
		revert(key) {
			if (!repertoirePending.settle(key)) return;
			ag.manageError = true;
			syncPanelRepertoireAfterAgendaWrite();
			deps.refreshWorksAfterWrite();
		}
	});

	function manageCfg(): EntuCfg | null {
		const selected = deps.selected();
		if (!selected) return null;
		return cfgFor(selected.db);
	}

	const rowHandlers = createRepertoireRowHandlers({
		queue: repertoireQueue,
		actions,
		rows: deps.rows,
		cfg: manageCfg,
		isOffline: deps.isOffline,
		seasonId: () => ag.currentSeasonId,
		editions: () => ag.libraryEditions,
		seasonRepertoire: {
			get: () => ag.seasonRepertoire,
			set: (items) => (ag.seasonRepertoire = items)
		},
		pending: repertoirePending
	});

	function refreshPanelRepertoire(): void {
		const cfg = manageCfg();
		const seasonId = seq.panelRepertoireSeasonId;
		if (!cfg || seasonId === null) return;
		const thisRequest = seq.requestId;
		const thisSwitch = deps.switchGeneration();
		deps
			.listRepertoireItems(cfg, seasonId)
			.then((items) => {
				if (thisRequest !== seq.requestId || thisSwitch !== deps.switchGeneration()) return;
				ag.panelRepertoire = items;
				ag.panelRepertoireItemsOk = true;
			})
			.catch(() => {
			});
	}

	function syncPanelRepertoireAfterAgendaWrite(): void {
		if (!deps.seasonManageOpen()) return;
		if (ag.manageableSeasonId === null || ag.manageableSeasonId !== ag.currentSeasonId) return;
		refreshPanelRepertoire();
	}

	const panelQueue = deps.createRepertoireWriteQueue({
		setPending(key, pending) {
			panel.pendingKeys = withItem(panel.pendingKeys, key, pending);
			if (pending) {
				panel.manageError = false;
				panel.manageStatus = '';
			}
		},
		reconcile() {
			refreshPanelRepertoire();
			deps.refreshWorksAfterWrite();
			panel.manageStatus = m.repertoire_manage_saved();
		},
		revert() {
			refreshPanelRepertoire();
			deps.refreshWorksAfterWrite();
			panel.manageError = true;
		}
	});

	function handlePanelAddWork(workId: string) {
		if (deps.isOffline()) return;
		const cfg = manageCfg();
		const seasonId = ag.manageableSeasonId;
		if (!cfg || seasonId === null) return;
		panelQueue.request(PANEL_ADD_WORK_KEY, async () => {
			await actions.createRepertoireItem(cfg, { seasonId, workId });
		});
	}

	function handlePanelStatusChange(itemId: string, status: RepertoireStatus) {
		if (deps.isOffline()) return;
		const cfg = manageCfg();
		if (!cfg) return;
		const before = ag.panelRepertoire.find((item) => item.id === itemId)?.status;
		if (before === undefined) return;
		const thisSwitch = deps.switchGeneration();
		panelQueue.request(itemId, () => actions.updateRepertoireStatus(cfg, itemId, status), {
			apply: () => {
				ag.panelRepertoire = ag.panelRepertoire.map((item) =>
					item.id === itemId ? { ...item, status } : item
				);
			},
			rollback: () => {
				if (thisSwitch !== deps.switchGeneration()) return;
				ag.panelRepertoire = ag.panelRepertoire.map((item) =>
					item.id === itemId ? { ...item, status: before } : item
				);
			}
		});
	}

	function handlePanelRemoveItem(itemId: string) {
		if (deps.isOffline()) return;
		const cfg = manageCfg();
		if (!cfg) return;
		const before = ag.panelRepertoire;
		const thisSwitch = deps.switchGeneration();
		panelQueue.request(itemId, () => actions.deleteRepertoireItem(cfg, itemId), {
			apply: () => {
				ag.panelRepertoire = ag.panelRepertoire.filter((item) => item.id !== itemId);
			},
			rollback: () => {
				if (thisSwitch !== deps.switchGeneration()) return;
				ag.panelRepertoire = before;
			}
		});
	}

	return {
		repertoireQueue,
		rowHandlers,
		manageCfg,
		handlePanelAddWork,
		handlePanelStatusChange,
		handlePanelRemoveItem
	};
}
