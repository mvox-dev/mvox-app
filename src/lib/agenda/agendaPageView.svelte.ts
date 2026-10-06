// The agenda page's derived view: the type filter, edition and work pickers, and panel rows.
import { listEditions } from '$lib/library/libraryData';
import { pickableWorks } from '$lib/repertoire/repertoireActions';
import { collectSources, buildWorkRows } from '$lib/repertoire/workRows';
import { unresolvedEditionWorkIds } from '$lib/repertoire/editionUnknown';
import {
	editionsByWorkId as editionsByWorkIdOf,
	editionOptionsByRowId as editionOptionsByRowIdOf,
	readScopedEditions
} from '$lib/repertoire/editionOptions';
import {
	pickableEditionsByEventIdOf,
	visibleByEventId,
	worksManageOf
} from '$lib/agenda/agendaWorksManage';
import {
	agendaFilterChipsOf,
	filterAgendaItems,
	locationSuggestionsOf,
	type AgendaTypeFilter
} from '$lib/agenda/agendaFilter';
import type { EntuCfg } from '$lib/seasons/entuSeasons';
import type { AgendaLoadState, LoadCounters } from './agendaLoad';
import type { AgendaPanelState } from './agendaRepertoireQueues';

type RowHandlers = Parameters<typeof worksManageOf>[1];

export function createAgendaPageView(
	ag: AgendaLoadState,
	seq: LoadCounters,
	panel: AgendaPanelState,
	deps: { rowHandlers: RowHandlers; manageCfg: () => EntuCfg | null | undefined }
) {
	const agendaFilterChips = $derived(agendaFilterChipsOf(ag.agendaItems, ag.recentItems));
	const filteredAgendaItems = $derived(filterAgendaItems(ag.agendaItems, ag.agendaTypeFilter));
	const filteredRecentItems = $derived(filterAgendaItems(ag.recentItems, ag.agendaTypeFilter));
	function selectAgendaTypeFilter(value: AgendaTypeFilter) {
		ag.agendaTypeFilter = value;
	}

	$effect(() => {
		if (ag.agendaTypeFilter !== 'all' && !agendaFilterChips.includes(ag.agendaTypeFilter)) {
			ag.agendaTypeFilter = 'all';
		}
	});

	const locationSuggestions = $derived(locationSuggestionsOf(ag.recentItems, ag.agendaItems));

	let pickableEditionsVisibleByEventId = $state<Record<string, boolean>>({});
	let pickableWorksVisible = $state<boolean | undefined>(undefined);

	const editionsByWorkId = $derived(editionsByWorkIdOf(ag.libraryEditions));
	const editionOptionsByRowId = $derived(
		editionOptionsByRowIdOf(
			Object.values(ag.worksByEventId).flat(),
			ag.scopedEditionsByWorkId,
			editionsByWorkId
		)
	);
	const editionsResolvedWorkIds = $derived(new Set(Object.keys(ag.scopedEditionsByWorkId)));
	const unknownEditionWorkIds = $derived(
		unresolvedEditionWorkIds(
			Object.values(ag.worksByEventId).flat(),
			editionOptionsByRowId,
			ag.libraryEditionsPartial,
			editionsResolvedWorkIds
		)
	);

	$effect(() => {
		const workIds = unknownEditionWorkIds;
		if (workIds.length === 0) return;
		const cfg = deps.manageCfg();
		if (!cfg) return;
		const thisRequest = seq.requestId;
		readScopedEditions(
			workIds,
			seq.scopedEditionWorkIdsRequested,
			(workId) => listEditions(cfg, workId),
			() => thisRequest === seq.requestId,
			(workId, options) => {
				ag.scopedEditionsByWorkId = { ...ag.scopedEditionsByWorkId, [workId]: options };
			}
		);
	});

	const pickableEditionsByEventId = $derived(
		pickableEditionsByEventIdOf(ag.libraryWorks, ag.libraryEditions, ag.worksByEventId)
	);

	$effect(() => {
		if (ag.libraryPickersLoading || ag.worksRowsLoading) return;
		pickableEditionsVisibleByEventId = visibleByEventId(pickableEditionsByEventId);
	});

	const pickableWorksList = $derived(pickableWorks(ag.libraryWorks, ag.seasonRepertoire));

	$effect(() => {
		if (ag.libraryPickersLoading || !ag.libraryPickersLoadSucceeded) return;
		pickableWorksVisible = pickableWorksList.length > 0;
	});

	const panelWorkRowSources = $derived(collectSources(ag.panelWorks, ag.panelEditions, ag.panelCopies));
	const panelWorkRows = $derived(
		buildWorkRows({ source: 'repertoire', items: ag.panelRepertoire }, panelWorkRowSources)
	);
	const panelPickableWorksList = $derived(pickableWorks(ag.panelWorks, ag.panelRepertoire));

	$effect(() => {
		if (ag.panelRepertoireLoading || !ag.panelRepertoireItemsOk || !ag.panelWorksSourcesOk) return;
		panel.pickableWorksVisible = panelPickableWorksList.length > 0;
	});

	const worksManage = $derived(
		worksManageOf(ag, deps.rowHandlers, {
			pickableWorksList,
			pickableWorksVisible,
			pickableEditionsByEventId,
			pickableEditionsVisibleByEventId,
			editionOptionsByRowId,
			editionsResolvedWorkIds
		})
	);

	return {
		get agendaFilterChips() {
			return agendaFilterChips;
		},
		get filteredAgendaItems() {
			return filteredAgendaItems;
		},
		get filteredRecentItems() {
			return filteredRecentItems;
		},
		selectAgendaTypeFilter,
		get locationSuggestions() {
			return locationSuggestions;
		},
		get panelWorkRows() {
			return panelWorkRows;
		},
		get panelPickableWorksList() {
			return panelPickableWorksList;
		},
		get worksManage() {
			return worksManage;
		}
	};
}

export type AgendaPageView = ReturnType<typeof createAgendaPageView>;
