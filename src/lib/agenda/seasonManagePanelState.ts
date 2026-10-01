import type { SeasonEditableField, SeriesListItem } from '$lib/seasons/seasonManage';
import type { SeasonManageDeleteError, SeasonManageDeleteSlot } from './seasonManageDelete';

export function createSeasonManagePanelState() {
	return {
		seasonManageName: '',
		seasonManageStartDate: '',
		seasonManageEndDate: '',
		seasonManageConductorIds: [] as string[],
		seasonManageFieldsLoaded: false,
		seasonManageSeries: [] as SeriesListItem[],
		seasonManageSeriesError: false,
		seasonManagePartial: false,
		seasonManageDeleteError: null as SeasonManageDeleteError | null,
		seasonManageDeleteArmed: null as string | null,
		seasonManageArmedSeriesCount: null as number | null,
		seasonManageDeleteScope: null as {
			series: number;
			events: number;
			repertoireItems: number;
		} | null,
		seasonManageDeletePendingId: null as string | null,
		seasonManageDeleteStatus: '',
		seasonManageDeleteProgress: null as { current: number; total: number } | null,
		seasonManageDeleteGeneration: 0,
		seasonManageConductorError: false,
		seasonManageConductorPending: false,
		seasonManageConductorStatus: '',
		seasonManageRosterLoading: false,
		seasonEditingField: null as SeasonEditableField | null,
		seasonEditDraft: '',
		seasonEditErrors: {} as Partial<Record<SeasonEditableField, 'save' | 'range'>>,
		seasonEditHeldOffline: false,
		seasonEditPending: {} as Partial<Record<SeasonEditableField, boolean>>,
		seasonEditStatus: ''
	};
}

export type SeasonManagePanelState = ReturnType<typeof createSeasonManagePanelState>;

// The offline hold survives a reset; the delete generation moves on, so a late reply is dropped.
export function resetSeasonManagePanelState(sm: SeasonManagePanelState): void {
	Object.assign(sm, createSeasonManagePanelState(), {
		seasonEditHeldOffline: sm.seasonEditHeldOffline,
		seasonManageDeleteGeneration: sm.seasonManageDeleteGeneration + 1
	});
}

export function seasonManageDeleteSlotFor(
	state: () => SeasonManagePanelState
): SeasonManageDeleteSlot {
	return {
		get pendingId() {
			return state().seasonManageDeletePendingId;
		},
		set pendingId(v) {
			state().seasonManageDeletePendingId = v;
		},
		get error() {
			return state().seasonManageDeleteError;
		},
		set error(v) {
			state().seasonManageDeleteError = v;
		},
		get progress() {
			return state().seasonManageDeleteProgress;
		},
		set progress(v) {
			state().seasonManageDeleteProgress = v;
		},
		get generation() {
			return state().seasonManageDeleteGeneration;
		}
	};
}
