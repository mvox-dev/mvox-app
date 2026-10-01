// The agenda's one repertoire write queue, shared by the season card and the manage panel.
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

	const fromPanel = new Set<string>();

	const repertoireQueue = deps.createRepertoireWriteQueue({
		setPending(key, pending) {
			ag.managePendingKeys = repertoirePending.setPending(ag.managePendingKeys, key, pending);
			panel.pendingKeys = repertoirePending.setPending(panel.pendingKeys, key, pending);
			if (!pending) return;
			if (fromPanel.has(key)) {
				panel.manageError = false;
				panel.manageStatus = '';
			} else {
				ag.manageError = false;
				ag.manageStatus = '';
			}
		},
		reconcile(key) {
			const panelWrite = fromPanel.delete(key);
			if (!repertoirePending.settle(key)) return;
			if (panelWrite) {
				refreshPanelRepertoire();
				deps.refreshWorksAfterWrite();
				panel.manageStatus = m.repertoire_manage_saved();
				return;
			}
			syncPanelRepertoireAfterAgendaWrite();
			if (key === ADD_WORK_KEY || key === ADD_PROGRAMME_KEY) deps.refreshWorksAfterWrite();
			ag.manageStatus = m.repertoire_manage_saved();
		},
		revert(key) {
			const panelWrite = fromPanel.delete(key);
			if (!repertoirePending.settle(key)) return;
			if (panelWrite) {
				refreshPanelRepertoire();
				panel.manageError = true;
			} else {
				ag.manageError = true;
				syncPanelRepertoireAfterAgendaWrite();
			}
			deps.refreshWorksAfterWrite();
		}
	});

	/** Rolls back only while both the write's collective and the panel's season are unchanged. */
	function request(
		surface: 'card' | 'panel',
		key: string,
		write: () => Promise<void>,
		hooks?: { apply?: () => void; rollback?: () => void }
	): void {
		if (repertoireQueue.isPending(key)) return;
		if (surface === 'panel') fromPanel.add(key);
		const thisSwitch = deps.switchGeneration();
		repertoireQueue.request(key, write, {
			apply: hooks?.apply,
			rollback: () => {
				if (!repertoirePending.isCurrent(key) || thisSwitch !== deps.switchGeneration()) return;
				hooks?.rollback?.();
			}
		});
	}

	function manageCfg(): EntuCfg | null {
		const selected = deps.selected();
		if (!selected) return null;
		return cfgFor(selected.db);
	}

	const rowHandlers = createRepertoireRowHandlers({
		queue: {
			request: (key, write, hooks) => request('card', key, write, hooks),
			isPending: (key) => repertoireQueue.isPending(key)
		},
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

	function handlePanelAddWork(workId: string) {
		if (deps.isOffline()) return;
		const cfg = manageCfg();
		const seasonId = ag.manageableSeasonId;
		if (!cfg || seasonId === null) return;
		request('panel', PANEL_ADD_WORK_KEY, async () => {
			await actions.createRepertoireItem(cfg, { seasonId, workId });
		});
	}

	function handlePanelStatusChange(itemId: string, status: RepertoireStatus) {
		if (deps.isOffline()) return;
		const cfg = manageCfg();
		if (!cfg) return;
		const before = ag.panelRepertoire.find((item) => item.id === itemId)?.status;
		if (before === undefined) return;
		request('panel', itemId, () => actions.updateRepertoireStatus(cfg, itemId, status), {
			apply: () => {
				ag.panelRepertoire = ag.panelRepertoire.map((item) =>
					item.id === itemId ? { ...item, status } : item
				);
			},
			rollback: () => {
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
		const repertoireBefore = ag.seasonRepertoire;
		request('panel', itemId, () => actions.deleteRepertoireItem(cfg, itemId), {
			apply: () => {
				ag.panelRepertoire = ag.panelRepertoire.filter((item) => item.id !== itemId);
				ag.seasonRepertoire = ag.seasonRepertoire.filter((item) => item.id !== itemId);
			},
			rollback: () => {
				ag.panelRepertoire = before;
				ag.seasonRepertoire = repertoireBefore;
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
