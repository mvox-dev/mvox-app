// The agenda's repertoire write queue, behind the season-manage panel.
import { get } from 'svelte/store';
import { m } from '$lib/paraglide/messages.js';
import { cfgFor } from '$lib/entu/cfg';
import { selectedCollectiveIdentityStore, sameCollectiveIdentity } from '$lib/collectives/store';
import type { AgendaLoadState, LoadCounters } from '$lib/agenda/agendaLoad';
import { isPanelReadStale } from '$lib/agenda/agendaPanels';
import type { EntuCfg } from '$lib/seasons/entuSeasons';
import type { RepertoireStatus } from '$lib/repertoire/types';
import type * as RepertoireActions from '$lib/repertoire/repertoireActions';
import type * as RepertoireData from '$lib/repertoire/repertoireData';
import type { RepertoireRowActions } from '$lib/repertoire/repertoireRowHandlers';
import { createPendingMarks } from '$lib/repertoire/repertoirePending';
import { reportProblem } from '$lib/problems/reportProblem';

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

export function resetPanelRepertoire(
	ag: AgendaLoadState,
	seq: LoadCounters,
	panel: AgendaPanelState
): void {
	ag.panelRepertoire = [];
	seq.panelRepertoireSeasonId = null;
	ag.panelWorks = [];
	ag.panelWorksPartial = false;
	ag.panelEditions = [];
	ag.panelCopies = [];
	panel.pendingKeys = new Set();
	ag.panelRepertoireError = false;
	panel.manageError = false;
	panel.manageStatus = '';
	ag.panelRepertoireLoading = false;
	ag.panelRepertoireItemsOk = false;
	ag.panelWorksSourcesOk = false;
	panel.pickableWorksVisible = undefined;
}

export interface AgendaRepertoireDeps {
	selected: () => { db: string } | null | undefined;
	isOffline: () => boolean;
	switchGeneration: () => number;
	refreshWorksAfterWrite: () => void;
	actions: Pick<
		RepertoireRowActions,
		'createRepertoireItem' | 'updateRepertoireStatus' | 'deleteRepertoireItem'
	>;
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
			panel.pendingKeys = repertoirePending.setPending(panel.pendingKeys, key, pending);
			if (!pending) return;
			panel.manageError = false;
			panel.manageStatus = '';
		},
		reconcile(key) {
			if (!repertoirePending.settle(key)) return;
			refreshPanelRepertoire();
			deps.refreshWorksAfterWrite();
			panel.manageStatus = m.repertoire_manage_saved();
		},
		revert(key) {
			if (!repertoirePending.settle(key)) return;
			refreshPanelRepertoire();
			panel.manageError = true;
			deps.refreshWorksAfterWrite();
		}
	});

	/** Rolls back only while both the write's collective and the panel's season are unchanged. */
	function request(
		key: string,
		write: () => Promise<void>,
		hooks?: { apply?: () => void; rollback?: () => void }
	): void {
		if (repertoireQueue.isPending(key)) return;
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

	function refreshPanelRepertoire(): void {
		const cfg = manageCfg();
		const seasonId = seq.panelRepertoireSeasonId;
		if (!cfg || seasonId === null) return;
		const thisRequest = seq.requestId;
		const thisSwitch = deps.switchGeneration();
		deps
			.listRepertoireItems(cfg, seasonId)
			.then((items) => {
				if (isPanelReadStale(seq, thisRequest, thisSwitch, deps.switchGeneration())) return;
				ag.panelRepertoire = items;
				ag.panelRepertoireItemsOk = true;
			})
			.catch((e) => {
				if (isPanelReadStale(seq, thisRequest, thisSwitch, deps.switchGeneration())) return;
				const action = 're-reading the season-manage repertoire';
				reportProblem({ area: 'agenda', action, error: e });
			});
	}

	function handlePanelAddWork(workId: string) {
		if (deps.isOffline()) return;
		const cfg = manageCfg();
		const seasonId = ag.manageableSeasonId;
		if (!cfg || seasonId === null) return;
		request(PANEL_ADD_WORK_KEY, async () => {
			await actions.createRepertoireItem(cfg, { seasonId, workId });
		});
	}

	function handlePanelStatusChange(itemId: string, status: RepertoireStatus) {
		if (deps.isOffline()) return;
		const cfg = manageCfg();
		if (!cfg) return;
		const before = ag.panelRepertoire.find((item) => item.id === itemId)?.status;
		if (before === undefined) return;
		request(itemId, () => actions.updateRepertoireStatus(cfg, itemId, status), {
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
		request(itemId, () => actions.deleteRepertoireItem(cfg, itemId), {
			apply: () => {
				ag.panelRepertoire = ag.panelRepertoire.filter((item) => item.id !== itemId);
			},
			rollback: () => {
				ag.panelRepertoire = before;
			}
		});
	}

	return {
		repertoireQueue,
		handlePanelAddWork,
		handlePanelStatusChange,
		handlePanelRemoveItem
	};
}
