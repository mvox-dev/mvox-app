import { untrack } from 'svelte';
import { cfgFor, type EntuCfg } from '$lib/entu/cfg';
import { focusAfterRender } from '$lib/a11y/focusable';
import type { AgendaItem } from '$lib/agenda/types';
import { createAttendancePanelLoad, failedMarksFor } from '$lib/attendance/attendancePanelLoad';
import { reportProblem } from '$lib/problems/reportProblem';
import type { AgendaLoadDeps, AgendaLoadState, LoadCounters } from '$lib/agenda/agendaLoad';

export function isPanelReadStale(
	isRequestCurrent: () => boolean,
	isSwitchCurrent: () => boolean
): boolean {
	return !isRequestCurrent() || !isSwitchCurrent();
}

export function createAgendaPanels(ag: AgendaLoadState, seq: LoadCounters, deps: AgendaLoadDeps) {
	const {
		listRepertoireItems,
		listWorks,
		listAllEditions,
		listAllCopies
	} = deps;
	const attendanceLoad = createAttendancePanelLoad({ ...deps, label: 'agenda' });

	function openAttendancePanel(item: AgendaItem) {
		const selected = deps.selected();
		if (!selected) return;
		if (!ag.attendanceEventIds.has(item.id)) return;
		ag.attendanceItem = item;
		ag.attendanceLoading = true;
		ag.attendanceError = false;
		ag.attendanceRoster = [];
		ag.attendanceRosterPartial = false;
		ag.attendanceMap = deps.pendingEntriesForEvent(item.id);
		ag.attendanceRsvpMap = {};
		ag.attendancePendingMemberIds = deps.pendingMembersForEvent(item.id);
		ag.attendanceFailedMemberIds = failedMarksFor(ag.attendanceFailedByEvent, item.id);
		ag.attendanceSavedMemberIds = new Set();
		void attendanceLoad.open(cfgFor(selected.db), item.id, {
			isCurrent: () => true,
			liveAttendance: () => ag.attendanceMap,
			loaded(read) {
				ag.attendanceRoster = read.roster;
				ag.attendanceRosterPartial = read.rosterPartial;
				ag.attendanceMap = read.attendance;
				ag.attendanceRsvpMap = read.rsvps;
				ag.attendanceLoading = false;
			},
			failed() {
				ag.attendanceLoading = false;
				ag.attendanceError = true;
			}
		});
	}

	function closeAttendancePanel() {
		const closedItemId = untrack(() => ag.attendanceItem?.id);
		attendanceLoad.cancel();
		ag.attendanceItem = null;
		ag.attendanceLoading = false;
		ag.attendanceError = false;
		if (closedItemId) {
			void focusAfterRender(() =>
				document.querySelector<HTMLElement>(
					`[data-testid="agenda-recent-row-${closedItemId}"] [data-testid="take-attendance-btn"]`
				)
			);
		}
	}

	function loadPanelRepertoire(cfg: EntuCfg, seasonId: string): Promise<void> {
		const isRequestCurrent = seq.request.whileCurrent();
		const isSwitchCurrent = deps.seasonManageSwitchCurrent();
		const stale = () =>
			isPanelReadStale(isRequestCurrent, isSwitchCurrent);
		seq.panelRepertoireSeasonId = seasonId;
		ag.panelRepertoireError = false;
		ag.panelRepertoireLoading = true;
		ag.panelRepertoireItemsOk = false;
		ag.panelWorksSourcesOk = false;
		let itemsSettled = false;
		let sourcesSettled = false;
		const maybeStopLoading = () => {
			if (itemsSettled && sourcesSettled) ag.panelRepertoireLoading = false;
		};
		const itemsChain = listRepertoireItems(cfg, seasonId)
			.then((items) => {
				if (stale()) return;
				ag.panelRepertoire = items;
				ag.panelRepertoireItemsOk = true;
			})
			.catch((e) => {
				if (stale()) return;
				reportProblem({ area: 'agenda', action: 'loading the season-manage repertoire', error: e });
				ag.panelRepertoire = [];
				ag.panelRepertoireError = true;
			})
			.finally(() => {
				if (stale()) return;
				itemsSettled = true;
				maybeStopLoading();
			});
		const sourcesChain = Promise.all([listWorks(cfg), listAllEditions(cfg), listAllCopies(cfg)])
			.then(([worksRead, editionsRead, copiesRead]) => {
				if (stale()) return;
				ag.panelWorks = worksRead.items;
				ag.panelEditions = editionsRead.items;
				ag.panelCopies = copiesRead.items;
				ag.panelWorksPartial = worksRead.truncated;
				ag.panelWorksSourcesOk = true;
			})
			.catch((e) => {
				if (stale()) return;
				reportProblem({
					area: 'agenda',
					action: 'loading the season-manage repertoire sources',
					error: e
				});
				ag.panelWorks = [];
				ag.panelEditions = [];
				ag.panelCopies = [];
				ag.panelWorksPartial = false;
				ag.panelRepertoireError = true;
			})
			.finally(() => {
				if (stale()) return;
				sourcesSettled = true;
				maybeStopLoading();
			});
		return Promise.all([itemsChain, sourcesChain]).then(() => {});
	}

	return {
		openAttendancePanel,
		closeAttendancePanel,
		loadPanelRepertoire
	};
}
