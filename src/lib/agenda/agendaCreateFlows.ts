// The agenda's season, event and series create entry points: which form is open, and when.
import type { AgendaLoadState } from '$lib/agenda/agendaLoad';
import { clearSeriesCreateResume, type SeriesResumeEntry } from '$lib/agenda/seriesCreateResume';

export function createCreateFlowState() {
	return {
		seasonCreateOpen: false,
		seasonCreateSubmitting: false,
		seasonCreateStatus: '',
		eventCreateOpen: false,
		eventCreateSubmitting: false,
		eventCreateStatus: '',
		seriesCreateOpen: false,
		seriesCreateSubmitting: false,
		seriesRunDb: null as string | null,
		seriesCreateResumeByDb: {} as Record<string, SeriesResumeEntry>
	};
}

export type CreateFlowState = ReturnType<typeof createCreateFlowState>;

export interface CreateFlowDeps {
	selected: () => { db: string } | null | undefined;
	entryPointsBlocked: () => boolean;
	seasonManageOpen: () => boolean;
	openSeasonManagePanel: () => void;
}

export function createAgendaCreateFlows(
	ag: AgendaLoadState,
	flow: CreateFlowState,
	deps: CreateFlowDeps
) {
	function openSeasonCreateForm(): void {
		if (deps.entryPointsBlocked()) return;
		flow.eventCreateOpen = false;
		flow.seriesCreateOpen = false;
		flow.seasonCreateStatus = '';
		flow.seasonCreateSubmitting = false;
		flow.seasonCreateOpen = true;
	}

	function closeSeasonCreateForm(): void {
		flow.seasonCreateOpen = false;
	}

	function dismissSeasonCreateForm(): void {
		if (flow.seasonCreateSubmitting) return;
		closeSeasonCreateForm();
	}

	function openEventCreateForm(): void {
		if (deps.entryPointsBlocked()) return;
		closeSeasonCreateForm();
		flow.seriesCreateOpen = false;
		flow.eventCreateStatus = '';
		flow.eventCreateOpen = true;
	}

	function openSeriesCreateForm(): void {
		if (ag.manageableSeasonId === null) return;
		if (deps.entryPointsBlocked()) return;
		closeSeasonCreateForm();
		flow.eventCreateOpen = false;
		flow.seriesCreateOpen = true;
	}

	// SeriesCreateForm restores its fields on every mount; this only clears a
	// season-mismatched record and flips the flag that mounts it.
	function restoreSeriesCreateRun(): void {
		const current = deps.selected();
		if (!current) return;
		if (flow.seriesCreateOpen || (flow.seriesCreateSubmitting && flow.seriesRunDb === current.db)) {
			return;
		}
		const entry = flow.seriesCreateResumeByDb[current.db];
		if (!entry) return;
		if (ag.manageableSeasonId !== entry.form.seasonId) {
			console.warn(
				'agenda: dropping a series resume record whose season is no longer manageable',
				current.db,
				entry.form.seasonId
			);
			flow.seriesCreateResumeByDb = clearSeriesCreateResume(flow.seriesCreateResumeByDb, current.db);
			return;
		}
		if (!deps.seasonManageOpen()) deps.openSeasonManagePanel();
		flow.seriesCreateOpen = true;
	}

	return {
		openSeasonCreateForm,
		closeSeasonCreateForm,
		dismissSeasonCreateForm,
		openEventCreateForm,
		openSeriesCreateForm,
		restoreSeriesCreateRun
	};
}
