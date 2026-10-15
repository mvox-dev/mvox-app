// The agenda page's derived view: the type filter, location suggestions and panel rows.
import { pickableWorks } from '$lib/repertoire/repertoireActions';
import { collectSources, buildWorkRows } from '$lib/repertoire/workRows';
import {
	agendaFilterChipsOf,
	filterAgendaItems,
	locationSuggestionsOf,
	type AgendaTypeFilter
} from '$lib/agenda/agendaFilter';
import type { AgendaLoadState } from './agendaLoad';
import type { AgendaPanelState } from './agendaRepertoireQueues';

export function createAgendaPageView(ag: AgendaLoadState, panel: AgendaPanelState) {
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

	const panelWorkRowSources = $derived(collectSources(ag.panelWorks, ag.panelEditions, ag.panelCopies));
	const panelWorkRows = $derived(
		buildWorkRows({ source: 'repertoire', items: ag.panelRepertoire }, panelWorkRowSources)
	);
	const panelPickableWorksList = $derived(pickableWorks(ag.panelWorks, ag.panelRepertoire));

	$effect(() => {
		if (ag.panelRepertoireLoading || !ag.panelRepertoireItemsOk || !ag.panelWorksSourcesOk) return;
		panel.pickableWorksVisible = panelPickableWorksList.length > 0;
	});

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
		}
	};
}

export type AgendaPageView = ReturnType<typeof createAgendaPageView>;
