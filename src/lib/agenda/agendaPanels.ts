import { untrack } from 'svelte';
import { cfgFor } from '$lib/entu/cfg';
import { deriveAllMemberRates } from '$lib/attendance/attendanceSummary';
import { focusAfterRender } from '$lib/a11y/focusable';
import type { AgendaItem } from '$lib/agenda/types';
import type { RosterRow } from '$lib/roster/rosterData';
import type { EntuCfg } from '$lib/seasons/entuSeasons';
import type { AgendaLoadDeps, AgendaLoadState, LoadCounters } from '$lib/agenda/agendaLoad';

export function createAgendaPanels(
	ag: AgendaLoadState,
	seq: LoadCounters,
	deps: AgendaLoadDeps,
	getRoster: (cfg: { db: string; token: string }) => Promise<RosterRow[]>
) {
	const {
		listAttendance,
		listAllRsvpsForEvent,
		attendanceByMemberId,
		loadActiveAndArchivedRosters,
		listRepertoireItems,
		listWorks,
		listAllEditions,
		listAllCopies
	} = deps;

	function openAttendancePanel(item: AgendaItem) {
		const selected = deps.selected();
		if (!selected) return;
		if (!ag.attendanceEventIds.has(item.id)) return;
		ag.attendanceItem = item;
		ag.attendanceLoading = true;
		ag.attendanceError = false;
		ag.attendanceRoster = [];
		ag.attendanceMap = {};
		ag.attendanceRsvpMap = {};
		ag.attendancePendingMemberIds = deps.pendingMembersForEvent(item.id);
		ag.attendanceFailedMemberIds = new Set(ag.attendanceFailedByEvent.get(item.id) ?? []);
		ag.attendanceSavedMemberIds = new Set();

		const cfg = cfgFor(selected.db);
		const thisRequest = ++seq.attendanceRequestId;

		const rosterPromise = getRoster(cfg);

		const requestIssuedAt = Date.now();
		Promise.all([rosterPromise, listAttendance(cfg, item.id), listAllRsvpsForEvent(cfg, item.id)])
			.then(([roster, records, rsvps]) => {
				if (thisRequest !== seq.attendanceRequestId) return;
				ag.attendanceRoster = roster;
				const pendingMembers = deps.pendingMembersForEvent(item.id);
				const serverMap = attendanceByMemberId(records);
				const merged = { ...serverMap };
				for (const mid of pendingMembers) {
					if (mid in ag.attendanceMap) merged[mid] = ag.attendanceMap[mid];
					else delete merged[mid];
				}
				for (const mid of Object.keys(ag.attendanceMap)) {
					if (pendingMembers.has(mid)) continue;
					const liveEntry = ag.attendanceMap[mid];
					const serverEntry = serverMap[mid];
					if (liveEntry && (!serverEntry || serverEntry.attendanceId !== liveEntry.attendanceId)) {
						merged[mid] = liveEntry;
					}
				}
				ag.attendanceMap = merged;
				const rsvpMap: Record<string, { rsvpId: string; status: string }> = {};
				for (const r of rsvps) rsvpMap[r.memberId] = { rsvpId: r.rsvpId, status: r.status };
				ag.attendanceRsvpMap = rsvpMap;
				ag.attendanceLoading = false;
			})
			.catch(() => {
				if (thisRequest !== seq.attendanceRequestId) return;
				ag.attendanceLoading = false;
				ag.attendanceError = true;
			});
	}

	function closeAttendancePanel() {
		const closedItemId = untrack(() => ag.attendanceItem?.id);
		seq.attendanceRequestId++;
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

	function handleExpandSeasonSummary() {
		const selected = deps.selected();
		if (!selected) return;
		if (ag.seasonSummaryExpanded) {
			ag.seasonSummaryExpanded = false;
			return;
		}
		ag.seasonSummaryExpanded = true;
		if (ag.seasonRatesLoaded) return;
		const cfg = cfgFor(selected.db);
		const events = ag.recentItems;
		const thisRequestSnapshot = seq.requestId;
		ag.seasonRatesLoading = true;
		ag.seasonRatesError = false;
		Promise.all([
			loadActiveAndArchivedRosters(cfg),
			Promise.all(events.map((event) => listAttendance(cfg, event.id)))
		])
			.then(([rosters, perEventRecords]) => {
				if (thisRequestSnapshot !== seq.requestId) return;
				const rosterRead = rosters.active;
				const inactiveRead = rosters.inactive;
				ag.seasonRatesPartial = rosterRead.truncated || inactiveRead.truncated;
				ag.seasonMemberRates = deriveAllMemberRates(
					perEventRecords.flat(),
					rosterRead.items,
					events.length,
					inactiveRead.items
				);
				ag.seasonRatesLoaded = true;
				ag.seasonRatesLoading = false;
			})
			.catch(() => {
				if (thisRequestSnapshot !== seq.requestId) return;
				ag.seasonRatesLoading = false;
				ag.seasonRatesError = true;
				ag.seasonMemberRates = [];
				ag.seasonRatesPartial = false;
			});
	}

	function loadPanelRepertoire(cfg: EntuCfg, seasonId: string): void {
		const thisRequest = seq.requestId;
		const thisSwitch = deps.seasonManageSwitchGeneration();
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
		listRepertoireItems(cfg, seasonId)
			.then((items) => {
				if (thisRequest !== seq.requestId || thisSwitch !== deps.seasonManageSwitchGeneration()) return;
				ag.panelRepertoire = items;
				ag.panelRepertoireItemsOk = true;
			})
			.catch((e) => {
				if (thisRequest !== seq.requestId || thisSwitch !== deps.seasonManageSwitchGeneration()) return;
				console.error('agenda: loading the season-manage repertoire failed', e);
				ag.panelRepertoire = [];
				ag.panelRepertoireError = true;
			})
			.finally(() => {
				if (thisRequest !== seq.requestId || thisSwitch !== deps.seasonManageSwitchGeneration()) return;
				itemsSettled = true;
				maybeStopLoading();
			});
		Promise.all([listWorks(cfg), listAllEditions(cfg), listAllCopies(cfg)])
			.then(([worksRead, editionsRead, copiesRead]) => {
				if (thisRequest !== seq.requestId || thisSwitch !== deps.seasonManageSwitchGeneration()) return;
				ag.panelWorks = worksRead.items;
				ag.panelEditions = editionsRead.items;
				ag.panelCopies = copiesRead.items;
				ag.panelWorksPartial = worksRead.truncated;
				ag.panelWorksSourcesOk = true;
			})
			.catch((e) => {
				if (thisRequest !== seq.requestId || thisSwitch !== deps.seasonManageSwitchGeneration()) return;
				console.error('agenda: loading the season-manage repertoire sources failed', e);
				ag.panelWorks = [];
				ag.panelEditions = [];
				ag.panelCopies = [];
				ag.panelWorksPartial = false;
				ag.panelRepertoireError = true;
			})
			.finally(() => {
				if (thisRequest !== seq.requestId || thisSwitch !== deps.seasonManageSwitchGeneration()) return;
				sourcesSettled = true;
				maybeStopLoading();
			});
	}

	return {
		openAttendancePanel,
		closeAttendancePanel,
		handleExpandSeasonSummary,
		loadPanelRepertoire
	};
}
