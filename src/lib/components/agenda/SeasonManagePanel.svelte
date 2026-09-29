<!-- #508 — season card + season-manage panel. The page keeps what it shares (open flag,
	panel element, switch generation, panel repertoire) and passes it in. -->
<script lang="ts">
	import { tick, type ComponentProps } from 'svelte';
	import { m } from '$lib/paraglide/messages.js';
	import type { Collective } from '$lib/collectives/types';
	import { getToken } from '$lib/auth/storage';
	import DeleteTrigger from '$lib/components/DeleteTrigger.svelte';
	import PersonName from '$lib/components/PersonName.svelte';
	import RepertoireElement from '$lib/components/agenda/RepertoireElement.svelte';
	import SeriesCreateForm from '$lib/components/agenda/SeriesCreateForm.svelte';
	import { isoDateFormatter } from '$lib/preferences/timeFormat';
	import type { RosterRow } from '$lib/roster/rosterData';
	import type { SectionNode } from '$lib/sections/sectionData';
	import type { Season } from '$lib/seasons/types';
	import type { ManageRightsState } from '$lib/repertoire/types';
	import type * as RepertoireActions from '$lib/repertoire/repertoireActions';
	import type { SeriesResumeEntry } from '$lib/agenda/seriesCreateResume';
	import type * as SeasonManage from '$lib/seasons/seasonManage';
	import type { SeasonEditableField, SeriesListItem } from '$lib/seasons/seasonManage';
	// deleteErrors.ts's discriminators live in their own module so the page's
	// specs can `vi.mock` seasonManage wholesale without breaking them; the
	// 'partial-event' case is dead here since the standalone-event delete left.
	import {
		isDeleteForbidden,
		isSeriesCascadePartial,
		isSeasonCascadePartial
	} from '$lib/seasons/deleteErrors';

	type Cfg = { db: string; token: string };
	type RepertoireProps = ComponentProps<typeof RepertoireElement>;

	interface Props {
		selected: Collective | null;
		seasons: Season[];
		manageableSeasonId: string | null;
		manageableSeasonRights: ManageRightsState;
		manageableSeasonRightsById: Record<string, ManageRightsState>;
		seasonManageOpen: boolean;
		seasonManagePanelEl: HTMLDivElement | null;
		seriesCreateOpen: boolean;
		seriesCreateSubmitting: boolean;
		seriesCreateResumeByDb: Record<string, SeriesResumeEntry>;
		seriesRunDb: string | null;
		seriesRunUnfinished: boolean;
		seasonCardCollapseDisabled: boolean;
		createEntryPointsBlocked: boolean;
		eventCreateOpen: boolean;
		rosterRows: RosterRow[];
		rosterPartial: boolean;
		sectionsReadFailed: boolean;
		locationSuggestionsId: string;
		heldFileIds: RepertoireProps['heldFileIds'];
		panelWorkRows: RepertoireProps['rows'];
		panelPickableWorksList: RepertoireProps['pickableWorksList'];
		panelPickableWorksVisible: RepertoireProps['pickableWorksVisible'];
		panelWorksPartial: boolean;
		panelPendingKeys: Set<string>;
		panelAddWorkKey: string;
		panelRepertoireError: boolean;
		panelManageError: boolean;
		panelManageStatus: string;
		currentRequestId: () => number;
		switchGeneration: () => number;
		getRoster: (cfg: Cfg) => Promise<RosterRow[]>;
		getSections: (cfg: Cfg) => Promise<SectionNode[]>;
		rosterPickerOptions: (excludeIds: readonly string[]) => Array<{ id: string; label: string }>;
		pickerPromptText: (optionCount: number, addPrompt: string) => string;
		loadForSelected: (opts?: { keepSeasonManage?: boolean }) => void;
		loadPanelRepertoire: (cfg: Cfg, seasonId: string) => void;
		resetSeasonManage: () => void;
		openEventCreateForm: () => void;
		openSeriesCreateForm: () => void;
		handlePdfClick: (fileId: string) => void;
		handlePanelAddWork: (workId: string) => void;
		handlePanelStatusChange: NonNullable<RepertoireProps['onstatuschange']>;
		handlePanelRemoveItem: (itemId: string) => void;
		isOffline: boolean;
		writeUnavailableText: string;
		listEventSeriesForSeason: typeof SeasonManage.listEventSeriesForSeason;
		updateSeasonField: typeof SeasonManage.updateSeasonField;
		addSeasonConductor: typeof SeasonManage.addSeasonConductor;
		apiRemoveSeasonConductor: typeof SeasonManage.removeSeasonConductor;
		apiDeleteEventSeries: typeof SeasonManage.deleteEventSeries;
		apiCountSeriesOccurrences: typeof SeasonManage.countSeriesOccurrences;
		apiCountSeasonScope: typeof SeasonManage.countSeasonScope;
		apiDeleteSeason: typeof SeasonManage.deleteSeason;
		canDeleteSeries: typeof RepertoireActions.canDeleteSeries;
	}

	let {
		selected,
		seasons,
		manageableSeasonId = $bindable(),
		manageableSeasonRights = $bindable(),
		manageableSeasonRightsById,
		seasonManageOpen = $bindable(),
		seasonManagePanelEl = $bindable(),
		seriesCreateOpen = $bindable(),
		seriesCreateSubmitting = $bindable(),
		seriesCreateResumeByDb = $bindable(),
		seriesRunDb = $bindable(),
		seriesRunUnfinished,
		seasonCardCollapseDisabled,
		createEntryPointsBlocked,
		eventCreateOpen,
		rosterRows,
		rosterPartial,
		sectionsReadFailed,
		locationSuggestionsId,
		heldFileIds,
		panelWorkRows,
		panelPickableWorksList,
		panelPickableWorksVisible,
		panelWorksPartial,
		panelPendingKeys,
		panelAddWorkKey,
		panelRepertoireError,
		panelManageError,
		panelManageStatus,
		currentRequestId,
		switchGeneration,
		getRoster,
		getSections,
		rosterPickerOptions,
		pickerPromptText,
		loadForSelected,
		loadPanelRepertoire,
		resetSeasonManage,
		openEventCreateForm,
		openSeriesCreateForm,
		handlePdfClick,
		handlePanelAddWork,
		handlePanelStatusChange,
		handlePanelRemoveItem,
		isOffline,
		writeUnavailableText,
		listEventSeriesForSeason,
		updateSeasonField,
		addSeasonConductor,
		apiRemoveSeasonConductor,
		apiDeleteEventSeries,
		apiCountSeriesOccurrences,
		apiCountSeasonScope,
		apiDeleteSeason,
		canDeleteSeries
	}: Props = $props();

	const manageableSeasonEntries = $derived(
		seasons.filter((s) => manageableSeasonRightsById[s.id] === 'editor')
	);
	const showSeasonCard = $derived(manageableSeasonEntries.length > 0);

	let seasonManageName = $state('');
	let seasonManageStartDate = $state('');
	let seasonManageEndDate = $state('');
	let seasonManageConductorIds = $state<string[]>([]);
	let seasonManageFieldsLoaded = $state(false);
	let seasonManageSeries = $state<SeriesListItem[]>([]);
	let seasonManageSeriesError = $state(false);
	let seasonManagePartial = $state(false);
	let seasonManageDeleteError = $state<{
		list: 'series' | 'season';
		reason: 'write' | 'forbidden' | 'partial' | 'partial-season';
		deleted?: number;
		total?: number;
	} | null>(null);
	let seasonManageDeleteArmed = $state<string | null>(null);
	let seasonManageArmedSeriesCount = $state<number | null>(null);
	const SEASON_DELETE_ROW_ID = '__season__';
	const seasonManageDeleteName = $derived(
		seasonManageFieldsLoaded
			? seasonManageName
			: (seasons.find((s) => s.id === manageableSeasonId)?.name ?? '')
	);
	let seasonManageDeleteScope = $state<{
		series: number;
		events: number;
		repertoireItems: number;
	} | null>(null);
	let seasonManageDeletePendingId = $state<string | null>(null);
	let seasonManageDeleteStatus = $state('');
	let seasonManageDeleteProgress = $state<{ current: number; total: number } | null>(null);
	let seasonManageDeleteGeneration = 0;

	function makeSeasonManageDeleteProgress(
		generation: number
	): (current: number, total: number) => void {
		return (current, total) => {
			if (generation !== seasonManageDeleteGeneration) return;
			seasonManageDeleteProgress = { current, total };
		};
	}
	let seasonManageConductorError = $state(false);
	let seasonManageConductorPending = $state(false);
	let seasonManageConductorStatus = $state('');
	let seasonManageRosterLoading = $state(false);
	let seasonCardEl = $state<HTMLDivElement | null>(null);

	let seasonEditingField = $state<SeasonEditableField | null>(null);
	let seasonEditDraft = $state('');
	let seasonEditErrors = $state<Partial<Record<SeasonEditableField, 'save' | 'range'>>>({});
	let seasonEditHeldOffline = $state(false);
	$effect(() => {
		if (!isOffline) seasonEditHeldOffline = false;
	});
	let seasonEditPending = $state<Partial<Record<SeasonEditableField, boolean>>>({});
	let seasonEditStatus = $state('');

	const seasonManageConductorNameById = $derived.by(() => {
		const map = new Map<string, string>();
		for (const row of rosterRows) map.set(row.personId, row.name);
		return map;
	});

	function seasonConductorLabel(personId: string): string {
		const name = seasonManageConductorNameById.get(personId);
		if (name) return name;
		return seasonManageRosterLoading
			? m.season_manage_conductor_loading()
			: m.season_manage_conductor_unknown();
	}

	const seasonManageConductorOptions = $derived(
		rosterPickerOptions(seasonManageConductorIds)
	);

	const seasonManageConductorEntries = $derived(
		(() => {
			const seen = new Map<string, number>();
			return seasonManageConductorIds.map((personId) => {
				const occurrence = seen.get(personId) ?? 0;
				seen.set(personId, occurrence + 1);
				return { key: `${personId}#${occurrence}`, personId };
			});
		})()
	);

	const seasonDateFmt = isoDateFormatter('UTC');

	function formatSeasonDate(isoDate: string): string {
		if (!isoDate) return '';
		const at = new Date(isoDate);
		if (Number.isNaN(at.getTime())) return '';
		return seasonDateFmt.format(at);
	}

	export function resetPanelState(): void {
		seasonManageFieldsLoaded = false;
		seasonManageName = '';
		seasonManageStartDate = '';
		seasonManageEndDate = '';
		seasonManageConductorIds = [];
		seasonManageSeries = [];
		seasonManageSeriesError = false;
		seasonManagePartial = false;
		seasonManageDeleteError = null;
		seasonManageDeleteArmed = null;
		seasonManageArmedSeriesCount = null;
		seasonManageDeleteScope = null;
		seasonManageDeletePendingId = null;
		seasonManageDeleteStatus = '';
		seasonManageDeleteProgress = null;
		seasonManageDeleteGeneration += 1;
		seasonManageConductorError = false;
		seasonManageConductorPending = false;
		seasonManageConductorStatus = '';
		seasonManageRosterLoading = false;
		seasonEditingField = null;
		seasonEditDraft = '';
		seasonEditErrors = {};
		seasonEditPending = {};
		seasonEditStatus = '';
	}

	export function openSeasonManagePanel(): void {
		if (!selected || manageableSeasonId === null) return;
		seasonManageOpen = true;
		seasonEditingField = null;
		if (!seasonManageFieldsLoaded) {
			const season = seasons.find((s) => s.id === manageableSeasonId);
			seasonManageName = season?.name ?? '';
			seasonManageStartDate = season?.startDate ?? '';
			seasonManageEndDate = season?.endDate ?? '';
			seasonManageConductorIds = season?.conductors ?? [];
			seasonManageFieldsLoaded = true;
		}
		const cfg = { db: selected.db, token: getToken() ?? '' };
		const seasonId = manageableSeasonId;
		const thisRequest = currentRequestId();
		const thisSwitch = switchGeneration();
		seasonManageSeriesError = false;
		seasonManageRosterLoading = true;
		getRoster(cfg)
			.catch((e) => {
				console.error('agenda: loading the roster for season management failed', e);
			})
			.finally(() => {
				if (thisRequest !== currentRequestId()) return;
				seasonManageRosterLoading = false;
			});
		getSections(cfg).catch((e) => {
			console.error('agenda: loading the section tree for season management failed', e);
		});
		listEventSeriesForSeason(cfg, seasonId)
			.then((result) => {
				if (thisRequest !== currentRequestId() || thisSwitch !== switchGeneration()) return;
				seasonManageSeries = result.items;
				seasonManagePartial = result.truncated;
			})
			.catch((e) => {
				if (thisRequest !== currentRequestId() || thisSwitch !== switchGeneration()) return;
				console.error('agenda: loading the season\'s event series failed', e);
				seasonManageSeries = [];
				seasonManageSeriesError = true;
				seasonManagePartial = false;
			});
		loadPanelRepertoire(cfg, seasonId);
	}

	function openSeasonManagePanelFor(seasonId: string): void {
		if (seasonId !== manageableSeasonId) {
			if (seriesRunUnfinished) return;
			resetSeasonManage();
			seriesCreateOpen = false;
			manageableSeasonId = seasonId;
			manageableSeasonRights = manageableSeasonRightsById[seasonId] ?? 'not-editor';
		}
		openSeasonManagePanel();
	}

	export function closeSeasonManagePanel(): void {
		if (seriesRunUnfinished) return;
		seasonManageOpen = false;
		seasonEditingField = null;
		seasonManageDeleteArmed = null;
		seasonManageArmedSeriesCount = null;
		seasonManageDeleteScope = null;
		seasonManageDeleteError = null;
		const closedSeasonId = manageableSeasonId;
		tick().then(() => {
			seasonCardEl
				?.querySelector<HTMLButtonElement>(
					`[data-testid="season-card-expand"][data-season-manage-id="${closedSeasonId}"]`
				)
				?.focus();
		});
	}

	$effect(() => {
		if (seasonManageOpen && seasonManagePanelEl) seasonManagePanelEl.focus();
	});

	function refocusSeasonManagePanel(): void {
		tick().then(() => seasonManagePanelEl?.focus());
	}

	function onSeasonManagePanelKeydown(event: KeyboardEvent): void {
		if (event.key === 'Escape') closeSeasonManagePanel();
	}

	function seasonFieldValue(field: SeasonEditableField): string {
		switch (field) {
			case 'name':
				return seasonManageName;
			case 'start_date':
				return seasonManageStartDate;
			case 'end_date':
				return seasonManageEndDate;
		}
	}

	function applySeasonFieldLocally(field: SeasonEditableField, value: string): void {
		switch (field) {
			case 'name':
				seasonManageName = value;
				break;
			case 'start_date':
				seasonManageStartDate = value;
				break;
			case 'end_date':
				seasonManageEndDate = value;
				break;
		}
	}

	function clearSeasonFieldError(field: SeasonEditableField): void {
		const next = { ...seasonEditErrors };
		delete next[field];
		seasonEditErrors = next;
	}

	function beginSeasonFieldEdit(field: SeasonEditableField): void {
		if (seasonEditPending[field] || isOffline) return;
		clearSeasonFieldError(field);
		seasonEditHeldOffline = false;
		seasonEditDraft = seasonFieldValue(field);
		seasonEditingField = field;
	}

	function cancelSeasonFieldEdit(): void {
		seasonEditingField = null;
		seasonEditDraft = '';
		seasonEditHeldOffline = false;
	}

	function confirmSeasonFieldEdit(field: SeasonEditableField): void {
		if (!selected || manageableSeasonId === null || seasonEditingField !== field) return;
		if (isOffline) {
			clearSeasonFieldError(field);
			seasonEditHeldOffline = true;
			return;
		}
		const before = seasonFieldValue(field);
		const value = seasonEditDraft.trim();
		seasonEditingField = null;
		if (value === '' || value === before) return;

		if (seasonDateRangeInverted(field, value)) {
			seasonEditStatus = '';
			seasonEditErrors = { ...seasonEditErrors, [field]: 'range' };
			return;
		}

		const cfg = { db: selected.db, token: getToken() ?? '' };
		const seasonId = manageableSeasonId;
		const thisSeasonManage = switchGeneration();
		clearSeasonFieldError(field);
		seasonEditStatus = '';
		seasonEditPending = { ...seasonEditPending, [field]: true };
		applySeasonFieldLocally(field, value);
		updateSeasonField(cfg, seasonId, field, value)
			.then(() => {
				if (thisSeasonManage !== switchGeneration()) return;
				seasonEditPending = { ...seasonEditPending, [field]: false };
				seasonEditStatus = m.season_manage_saved();
			})
			.catch((e) => {
				if (thisSeasonManage !== switchGeneration()) return;
				console.error('agenda: season field save failed', field, e);
				seasonEditPending = { ...seasonEditPending, [field]: false };
				applySeasonFieldLocally(field, before);
				seasonEditErrors = { ...seasonEditErrors, [field]: 'save' };
			});
	}

	function seasonDateRangeInverted(field: SeasonEditableField, value: string): boolean {
		if (field === 'start_date') return seasonManageEndDate !== '' && value > seasonManageEndDate;
		if (field === 'end_date') return seasonManageStartDate !== '' && value < seasonManageStartDate;
		return false;
	}

	function seasonFieldErrorText(field: SeasonEditableField): string {
		return seasonEditErrors[field] === 'range'
			? m.season_date_range_invalid()
			: m.season_manage_save_error();
	}

	function handleSeasonFieldKeydown(event: KeyboardEvent, field: SeasonEditableField): void {
		if (event.key === 'Escape') {
			event.preventDefault();
			event.stopPropagation();
			cancelSeasonFieldEdit();
			refocusSeasonManagePanel();
		} else if (event.key === 'Enter') {
			event.preventDefault();
			confirmSeasonFieldEdit(field);
			refocusSeasonManagePanel();
		}
	}

	function focusSeasonInputOnMount(node: HTMLElement): void {
		node.focus();
	}

	function onSeasonManageConductorSelect(selection: { id: string | null; label: string }): void {
		if (seasonManageConductorPending || isOffline) return;
		if (!selection.id || !selected || manageableSeasonId === null) return;
		const personId = selection.id;
		if (seasonManageConductorIds.includes(personId)) return;
		const cfg = { db: selected.db, token: getToken() ?? '' };
		const seasonId = manageableSeasonId;
		const thisSeasonManage = switchGeneration();
		seasonManageConductorError = false;
		seasonManageConductorStatus = '';
		seasonManageConductorPending = true;
		seasonManageConductorIds = [...seasonManageConductorIds, personId];
		addSeasonConductor(cfg, seasonId, personId)
			.then(() => {
				if (thisSeasonManage !== switchGeneration()) return;
				seasonManageConductorPending = false;
				seasonManageConductorStatus = m.season_manage_conductor_saved();
			})
			.catch((e) => {
				if (thisSeasonManage !== switchGeneration()) return;
				console.error('agenda: add season conductor failed', personId, e);
				seasonManageConductorIds = seasonManageConductorIds.filter((id) => id !== personId);
				seasonManageConductorError = true;
				seasonManageConductorPending = false;
			});
	}

	function onSeasonManageConductorRemove(personId: string, index: number): void {
		if (seasonManageConductorPending || isOffline) return;
		if (!selected || manageableSeasonId === null) return;
		const cfg = { db: selected.db, token: getToken() ?? '' };
		const seasonId = manageableSeasonId;
		const thisSeasonManage = switchGeneration();
		const before = seasonManageConductorIds;
		seasonManageConductorError = false;
		seasonManageConductorStatus = '';
		seasonManageConductorPending = true;
		seasonManageConductorIds = [
			...seasonManageConductorIds.slice(0, index),
			...seasonManageConductorIds.slice(index + 1)
		];
		apiRemoveSeasonConductor(cfg, seasonId, personId)
			.then(() => {
				if (thisSeasonManage !== switchGeneration()) return;
				seasonManageConductorPending = false;
				seasonManageConductorStatus = m.season_manage_conductor_saved();
			})
			.catch((e) => {
				if (thisSeasonManage !== switchGeneration()) return;
				console.error('agenda: remove season conductor failed', personId, e);
				seasonManageConductorIds = before;
				seasonManageConductorError = true;
				seasonManageConductorPending = false;
			});
	}

	export function refreshSeasonManageLists(cfg: Cfg, seasonId: string): void {
		const thisRequest = currentRequestId();
		const thisSwitch = switchGeneration();
		loadPanelRepertoire(cfg, seasonId);
		listEventSeriesForSeason(cfg, seasonId)
			.then((result) => {
				if (thisRequest !== currentRequestId() || thisSwitch !== switchGeneration()) return;
				seasonManageSeries = result.items;
				seasonManageSeriesError = false;
				seasonManagePartial = result.truncated;
			})
			.catch((e) => {
				if (thisRequest !== currentRequestId() || thisSwitch !== switchGeneration()) return;
				console.error('agenda: refreshing the season\'s event series after an event create failed', e);
				seasonManageSeriesError = true;
			});
	}

	async function armSeasonManageDelete(rowId: string, confirmTestid: string): Promise<void> {
		seasonManageDeleteError = null;
		seasonManageDeleteArmed = rowId;
		seasonManageArmedSeriesCount = null;
		seasonManageDeleteScope = null;
		await tick();
		document.querySelector<HTMLElement>(`[data-testid="${confirmTestid}"]`)?.focus();
	}

	async function armSeasonManageSeriesDelete(series: SeriesListItem): Promise<void> {
		if (isOffline) return;
		const cfg = selected ? { db: selected.db, token: getToken() ?? '' } : null;
		await armSeasonManageDelete(series.id, `season-manage-series-delete-confirm-${series.id}`);
		if (!cfg) return;
		try {
			const live = await apiCountSeriesOccurrences(cfg, series.id);
			seasonManageSeries = seasonManageSeries.map((row) =>
				row.id === series.id ? { ...row, eventCount: live } : row
			);
			if (seasonManageDeleteArmed === series.id) seasonManageArmedSeriesCount = live;
		} catch (e) {
			console.error('agenda: live occurrence count for the delete confirm failed', series.id, e);
		}
	}

	async function disarmSeasonManageDelete(disarmTestid: string): Promise<void> {
		seasonManageDeleteArmed = null;
		seasonManageArmedSeriesCount = null;
		seasonManageDeleteScope = null;
		await tick();
		document.querySelector<HTMLElement>(`[data-testid="${disarmTestid}"]`)?.focus();
	}

	async function armSeasonManageSeasonDelete(): Promise<void> {
		if (isOffline) return;
		const cfg = selected ? { db: selected.db, token: getToken() ?? '' } : null;
		const seasonId = manageableSeasonId;
		const generation = seasonManageDeleteGeneration;
		await armSeasonManageDelete(SEASON_DELETE_ROW_ID, 'season-manage-delete-season-confirm');
		if (!cfg || seasonId === null) return;
		try {
			const scope = await apiCountSeasonScope(cfg, seasonId);
			if (
				generation === seasonManageDeleteGeneration &&
				seasonManageDeleteArmed === SEASON_DELETE_ROW_ID
			) {
				seasonManageDeleteScope = scope;
			}
		} catch (e) {
			console.error('agenda: live season scope for the delete confirm failed', seasonId, e);
		}
	}

	function seasonManageDeleteFailure(
		list: 'series' | 'season',
		reason: unknown
	): NonNullable<typeof seasonManageDeleteError> {
		if (isDeleteForbidden(reason)) return { list, reason: 'forbidden' };
		if (list === 'season' && isSeasonCascadePartial(reason)) {
			const partial = reason as { deletedCount?: number; totalCount?: number };
			return {
				list,
				reason: 'partial-season',
				deleted: partial.deletedCount ?? 0,
				total: partial.totalCount ?? 0
			};
		}
		if (isSeriesCascadePartial(reason)) {
			const partial = reason as { deletedCount?: number; totalCount?: number };
			return {
				list,
				reason: 'partial',
				deleted: partial.deletedCount ?? 0,
				total: partial.totalCount ?? 0
			};
		}
		return { list, reason: 'write' };
	}

	function seasonManageDeleteErrorText(
		failure: NonNullable<typeof seasonManageDeleteError>
	): string {
		switch (failure.reason) {
			case 'forbidden':
				return m.season_manage_delete_forbidden();
			case 'partial':
				return m.season_manage_delete_partial({
					deleted: failure.deleted ?? 0,
					total: failure.total ?? 0
				});
			case 'partial-season':
				return m.season_manage_season_delete_partial({
					deleted: failure.deleted ?? 0,
					total: failure.total ?? 0
				});
			default:
				return m.season_manage_delete_error();
		}
	}

	function refreshAfterSeasonManageDelete(cfg: Cfg): void {
		const panelSeasonId = manageableSeasonId;
		loadForSelected({ keepSeasonManage: true });
		if (panelSeasonId !== null) refreshSeasonManageLists(cfg, panelSeasonId);
	}

	function onSeasonManageSeriesDelete(series: SeriesListItem): void {
		if (!selected) return;
		if (seasonManageDeletePendingId !== null) return;
		if (isOffline) return;
		const cfg = { db: selected.db, token: getToken() ?? '' };
		seasonManageDeleteError = null;
		seasonManageDeleteProgress = null;
		seasonManageDeletePendingId = series.id;
		const generation = seasonManageDeleteGeneration;
		apiDeleteEventSeries(cfg, series.id, undefined, {
			onProgress: makeSeasonManageDeleteProgress(generation)
		})
			.then((deletedOccurrences) => {
				if (generation !== seasonManageDeleteGeneration) return;
				seasonManageDeleteArmed = null;
				seasonManageArmedSeriesCount = null;
				seasonManageSeries = seasonManageSeries.filter((row) => row.id !== series.id);
				seasonManageDeleteStatus =
					deletedOccurrences > 0
						? m.season_manage_series_deleted({ name: series.name, count: deletedOccurrences })
						: m.season_manage_deleted({ name: series.name });
				refreshAfterSeasonManageDelete(cfg);
			})
			.catch((e) => {
				console.error('agenda: deleting event series failed', series.id, e);
				if (generation !== seasonManageDeleteGeneration) return;
				seasonManageDeleteError = seasonManageDeleteFailure('series', e);
			})
			.finally(() => {
				seasonManageDeletePendingId = null;
				if (generation === seasonManageDeleteGeneration) seasonManageDeleteProgress = null;
			});
	}

	function onSeasonManageSeasonDelete(): void {
		if (!selected || manageableSeasonId === null) return;
		if (seasonManageDeletePendingId !== null) return;
		if (isOffline) return;
		const cfg = { db: selected.db, token: getToken() ?? '' };
		const seasonId = manageableSeasonId;
		const seasonName = seasonManageDeleteName;
		seasonManageDeleteError = null;
		seasonManageDeleteProgress = null;
		seasonManageDeletePendingId = SEASON_DELETE_ROW_ID;
		const generation = seasonManageDeleteGeneration;
		apiDeleteSeason(cfg, seasonId, undefined, {
			onProgress: makeSeasonManageDeleteProgress(generation)
		})
			.then(() => {
				if (generation !== seasonManageDeleteGeneration) return;
				loadForSelected();
				seasonManageDeleteStatus = m.season_delete_success({ name: seasonName });
			})
			.catch((e) => {
				console.error('agenda: deleting season failed', seasonId, e);
				if (generation !== seasonManageDeleteGeneration) return;
				seasonManageDeleteError = seasonManageDeleteFailure('season', e);
			})
			.finally(() => {
				seasonManageDeletePendingId = null;
				if (generation === seasonManageDeleteGeneration) seasonManageDeleteProgress = null;
			});
	}
</script>

	{#if showSeasonCard || seasonManageOpen}
		<div
			data-testid="agenda-admin-card"
			bind:this={seasonCardEl}
			class="mb-3 rounded-md border border-ink-4 p-1.5"
		>
			{#each manageableSeasonEntries as ms (ms.id)}
				{#if !seasonManageOpen || ms.id !== manageableSeasonId}
					<h2>
						<button
							type="button"
							data-testid="season-card-expand"
							data-season-manage-id={ms.id}
							aria-expanded="false"
							disabled={seriesRunUnfinished && ms.id !== manageableSeasonId}
							class="group flex w-full min-h-11 items-center gap-2 rounded-sm px-1.5 text-left font-display text-lg text-ink hover:bg-ink-5 disabled:opacity-50 disabled:hover:bg-transparent"
							onclick={() => openSeasonManagePanelFor(ms.id)}
						>
							<span class="sr-only">{m.season_manage_expand_label()}</span>
							<span aria-hidden="true" class="text-xs text-ink-3 group-hover:text-ink"
								>▸</span
							>
							<span>{ms.id === manageableSeasonId ? seasonManageDeleteName : ms.name}</span>
						</button>
					</h2>
				{/if}
			{/each}
			{#if seasonManageOpen}
				<div class="flex flex-wrap items-center gap-2">
					{#if showSeasonCard}
						<h2 class="flex min-w-0 flex-1">
							<button
								type="button"
								data-testid="season-card-collapse"
								aria-expanded="true"
								aria-controls="season-manage-panel"
								disabled={seasonCardCollapseDisabled}
								class="group flex w-full min-h-11 items-center gap-2 rounded-sm px-1.5 text-left font-display text-lg text-ink hover:bg-ink-5 disabled:opacity-50 disabled:hover:bg-transparent"
								onclick={closeSeasonManagePanel}
								onkeydown={onSeasonManagePanelKeydown}
							>
								<span class="sr-only">{m.season_manage_collapse_label()}</span>
								<span aria-hidden="true" class="text-xs text-ink-3 group-hover:text-ink"
									>▾</span
								>
								<span id="season-manage-label" data-testid="season-manage-label">
									{seasonManageDeleteName}
								</span>
							</button>
						</h2>
						{#if seasonManageDeleteArmed === SEASON_DELETE_ROW_ID}
							<button
								type="button"
								data-testid="season-manage-delete-season-confirm"
								aria-label={seasonManageDeleteScope !== null
									? m.season_delete_confirm_scope({
											name: seasonManageDeleteName,
											series: seasonManageDeleteScope.series,
											events: seasonManageDeleteScope.events,
											repertoire: seasonManageDeleteScope.repertoireItems
										})
									: m.season_manage_delete_confirm({ name: seasonManageDeleteName })}
								disabled={seasonManageDeletePendingId !== null || isOffline}
								aria-busy={seasonManageDeletePendingId === SEASON_DELETE_ROW_ID}
								class="ml-auto flex min-h-11 items-center px-1 text-xs text-red-700 underline disabled:opacity-50"
								onclick={onSeasonManageSeasonDelete}
								onkeydown={onSeasonManagePanelKeydown}
							>
								{seasonManageDeleteScope !== null
									? m.season_delete_confirm_scope_short({
											series: seasonManageDeleteScope.series,
											events: seasonManageDeleteScope.events,
											repertoire: seasonManageDeleteScope.repertoireItems
										})
									: m.season_manage_delete_confirm_short()}
							</button>
							<button
								type="button"
								data-testid="season-manage-delete-season-cancel"
								aria-label={m.season_manage_delete_cancel({ name: seasonManageDeleteName })}
								disabled={seasonManageDeletePendingId !== null}
								class="flex min-h-11 items-center px-1 text-xs text-ink-2 underline hover:text-ink disabled:opacity-50"
								onclick={() => void disarmSeasonManageDelete('season-manage-delete-season')}
								onkeydown={onSeasonManagePanelKeydown}
							>
								{m.season_manage_delete_cancel_short()}
							</button>
						{:else}
							<DeleteTrigger
								data-testid="season-manage-delete-season"
								aria-label={m.season_manage_season_delete({ name: seasonManageDeleteName })}
								class="ml-auto"
								disabled={isOffline}
								onclick={() => void armSeasonManageSeasonDelete()}
								onkeydown={onSeasonManagePanelKeydown}
							/>
						{/if}
					{/if}
				</div>
			{/if}
		{#if seasonManageDeleteProgress !== null}
			<p
				data-testid="season-manage-delete-progress"
				role="status"
				class="mt-1 text-xs text-ink-2"
			>
				{m.season_manage_delete_progress({
					current: seasonManageDeleteProgress.current,
					total: seasonManageDeleteProgress.total
				})}
			</p>
		{/if}
		{#if seasonManageDeleteError?.list === 'season'}
			<p
				data-testid="season-manage-delete-error"
				role="alert"
				class="mt-1 text-xs text-red-700"
			>
				{seasonManageDeleteErrorText(seasonManageDeleteError)}
			</p>
		{/if}
		{#if seasonManageOpen}
			<div
				id="season-manage-panel"
				data-testid="season-manage-panel"
				bind:this={seasonManagePanelEl}
				role="dialog"
				aria-labelledby="season-manage-label"
				tabindex="-1"
				class="mt-3 flex flex-col gap-3 p-3"
				onkeydown={onSeasonManagePanelKeydown}
			>

				{#if isOffline}
					<p data-testid="season-manage-write-unavailable" class="text-xs text-ink-2">
						{writeUnavailableText}
					</p>
				{/if}
				{#if seasonEditHeldOffline}
					<p
						data-testid="season-edit-held-offline"
						role="alert"
						class="text-xs text-ink-2"
					>
						{m.write_held_no_signal()}
					</p>
				{/if}

				<div>
				{#if seasonEditingField === 'name'}
					<input
						type="text"
						data-testid="season-edit-input-name"
						aria-label={m.season_manage_name_label()}
						value={seasonEditDraft}
						use:focusSeasonInputOnMount
						oninput={(e) => (seasonEditDraft = (e.currentTarget as HTMLInputElement).value)}
						onblur={() => confirmSeasonFieldEdit('name')}
						onkeydown={(e) => handleSeasonFieldKeydown(e, 'name')}
						class="w-full border-b border-ink bg-transparent font-display text-lg text-ink"
					/>
				{:else}
					<div class="font-display text-lg text-ink">
						<button
							type="button"
							data-testid="season-edit-btn-name"
							disabled={seasonEditPending.name === true || isOffline}
							class="group flex min-h-11 w-full appearance-none items-center gap-2 border-0 bg-transparent p-0 text-left font-display text-lg text-ink disabled:opacity-40"
							onclick={() => beginSeasonFieldEdit('name')}
						>
							<span class="sr-only">{m.season_manage_edit_name_label()}</span>
							<span aria-hidden="true" class="text-xs text-ink-3 group-hover:text-ink"
								>✎</span
							>
							<span data-testid="season-manage-name">{seasonManageName}</span>
						</button>
					</div>
				{/if}
				{#if seasonEditErrors.name}
					<p data-testid="season-edit-error-name" role="alert" class="text-xs text-red-700">
						{seasonFieldErrorText('name')}
					</p>
				{/if}
			</div>

			<div class="flex gap-4">
				<div class="min-w-0 flex-1">
					<p class="text-xs tracking-wide text-ink-2 uppercase">
						{m.season_manage_start_date_label()}
					</p>
					{#if seasonEditingField === 'start_date'}
						<input
							type="date"
							data-testid="season-edit-input-start_date"
							aria-label={m.season_manage_start_date_label()}
							value={seasonEditDraft}
							use:focusSeasonInputOnMount
							oninput={(e) => (seasonEditDraft = (e.currentTarget as HTMLInputElement).value)}
							onblur={() => confirmSeasonFieldEdit('start_date')}
							onkeydown={(e) => handleSeasonFieldKeydown(e, 'start_date')}
							class="border-b border-ink bg-transparent text-ink"
						/>
					{:else}
						<button
							type="button"
							data-testid="season-edit-btn-start_date"
							disabled={seasonEditPending.start_date === true || isOffline}
							class="group flex min-h-11 w-full appearance-none items-center gap-1 border-0 bg-transparent p-0 text-left disabled:opacity-40"
							onclick={() => beginSeasonFieldEdit('start_date')}
						>
							<span class="sr-only">{m.season_manage_edit_start_date_label()}</span>
							<span aria-hidden="true" class="text-xs text-ink-3 group-hover:text-ink"
								>✎</span
							>
							<span data-testid="season-manage-start_date" class="text-base text-ink-2">
								{#if seasonManageStartDate}
									{formatSeasonDate(seasonManageStartDate)}
								{:else}
									{m.season_manage_date_unset()}
								{/if}
							</span>
						</button>
					{/if}
					{#if seasonEditErrors.start_date}
						<p
							data-testid="season-edit-error-start_date"
							role="alert"
							class="text-xs text-red-700"
						>
							{seasonFieldErrorText('start_date')}
						</p>
					{/if}
				</div>
				<div class="min-w-0 flex-1">
					<p class="text-xs tracking-wide text-ink-2 uppercase">
						{m.season_manage_end_date_label()}
					</p>
					{#if seasonEditingField === 'end_date'}
						<input
							type="date"
							data-testid="season-edit-input-end_date"
							aria-label={m.season_manage_end_date_label()}
							value={seasonEditDraft}
							use:focusSeasonInputOnMount
							oninput={(e) => (seasonEditDraft = (e.currentTarget as HTMLInputElement).value)}
							onblur={() => confirmSeasonFieldEdit('end_date')}
							onkeydown={(e) => handleSeasonFieldKeydown(e, 'end_date')}
							class="border-b border-ink bg-transparent text-ink"
						/>
					{:else}
						<button
							type="button"
							data-testid="season-edit-btn-end_date"
							disabled={seasonEditPending.end_date === true || isOffline}
							class="group flex min-h-11 w-full appearance-none items-center gap-1 border-0 bg-transparent p-0 text-left disabled:opacity-40"
							onclick={() => beginSeasonFieldEdit('end_date')}
						>
							<span class="sr-only">{m.season_manage_edit_end_date_label()}</span>
							<span aria-hidden="true" class="text-xs text-ink-3 group-hover:text-ink"
								>✎</span
							>
							<span data-testid="season-manage-end_date" class="text-base text-ink-2">
								{#if seasonManageEndDate}
									{formatSeasonDate(seasonManageEndDate)}
								{:else}
									{m.season_manage_date_unset()}
								{/if}
							</span>
						</button>
					{/if}
					{#if seasonEditErrors.end_date}
						<p
							data-testid="season-edit-error-end_date"
							role="alert"
							class="text-xs text-red-700"
						>
							{seasonFieldErrorText('end_date')}
						</p>
					{/if}
				</div>
			</div>

			<div
				data-testid="season-edit-status"
				role="status"
				aria-live="polite"
				class="sr-only"
			>
				{seasonEditStatus}
			</div>

			<div>
				<p class="text-xs tracking-wide text-ink-2 uppercase">
					{m.season_manage_conductors_label()}
				</p>
				{#if seasonManageConductorEntries.length > 0}
					<ul class="mt-1 flex flex-wrap gap-1.5">
						{#each seasonManageConductorEntries as { key, personId }, entryIndex (key)}
							<li
								data-testid="season-manage-conductor-{personId}"
								data-conductor-key={key}
								class="flex items-center gap-1 border border-ink-5 px-1.5 text-xs text-ink"
							>
								<PersonName name={seasonConductorLabel(personId)} />
								<!-- #237: unlink is not destroy — this chip keeps its × and muted
								     tone on purpose; DeleteTrigger is for Table A only. -->
								<button
									type="button"
									data-testid="season-manage-conductor-remove-{personId}"
									aria-label={m.season_conductor_remove({
										name: seasonConductorLabel(personId)
									})}
									disabled={seasonManageConductorPending || isOffline}
									class="flex min-h-11 min-w-11 items-center justify-center text-ink-2 hover:text-ink disabled:opacity-50"
									onclick={() => onSeasonManageConductorRemove(personId, entryIndex)}
								>
									&times;
								</button>
							</li>
						{/each}
					</ul>
				{/if}
				<div class="mt-1.5">
					<select
						data-testid="season-manage-conductor-select"
						aria-label={m.season_conductor_label()}
						disabled={seasonManageConductorOptions.length === 0 ||
							seasonManageConductorPending ||
							isOffline}
						value=""
						onchange={(e) => {
							const target = e.currentTarget as HTMLSelectElement;
							const personId = target.value;
							target.value = '';
							if (!personId) return;
							const label =
								seasonManageConductorOptions.find((o) => o.id === personId)
									?.label ?? '';
							onSeasonManageConductorSelect({ id: personId, label });
						}}
						class="w-full border border-ink-5 bg-paper px-1.5 py-1 text-ink disabled:opacity-50"
					>
						<option value="" disabled selected hidden>
							{pickerPromptText(
								seasonManageConductorOptions.length,
								m.season_conductor_placeholder()
							)}
						</option>
						{#each seasonManageConductorOptions as option (option.id)}
							<option value={option.id}>{option.label}</option>
						{/each}
					</select>
					{#if rosterPartial}
						<p data-testid="season-manage-conductor-partial-notice" role="status" class="text-xs text-ink-2">
							{m.picker_partial_members_notice()}
						</p>
					{/if}
					{#if sectionsReadFailed}
						<p
							data-testid="season-manage-conductor-order-note"
							class="text-xs text-ink-2"
						>
							{m.picker_order_fallback()}
						</p>
					{/if}
				</div>
				{#if seasonManageConductorError}
					<p
						data-testid="season-manage-conductor-error"
						role="alert"
						class="text-xs text-red-700"
					>
						{m.season_manage_save_error()}
					</p>
				{/if}
				{#if seasonManageConductorPending}
					<p
						data-testid="season-manage-conductor-pending-notice"
						role="status"
						class="text-xs text-ink-2"
					>
						{m.season_manage_conductor_saving()}
					</p>
				{/if}
				<div
					data-testid="season-manage-conductor-status"
					role="status"
					aria-live="polite"
					class="sr-only"
				>
					{seasonManageConductorStatus}
				</div>
			</div>

			<div>
				<div class="flex items-center justify-between">
					<p class="text-xs tracking-wide text-ink-2 uppercase">
						{m.season_manage_series_label()}
					</p>
					{#if !seriesCreateOpen}
						<button
							type="button"
							data-testid="season-manage-add-series"
							disabled={createEntryPointsBlocked}
							class="flex min-h-11 items-center text-xs text-ink underline disabled:opacity-50"
							onclick={openSeriesCreateForm}
						>
							{m.season_manage_add_series()}
						</button>
					{/if}
				</div>
				{#if seriesCreateOpen}
					<SeriesCreateForm
						{selected}
						{manageableSeasonId}
						{seasonManageStartDate}
						{seasonManageEndDate}
						{seasonManagePanelEl}
						{locationSuggestionsId}
						bind:submitting={seriesCreateSubmitting}
						bind:resumeByDb={seriesCreateResumeByDb}
						bind:seriesRunDb
						onclose={() => (seriesCreateOpen = false)}
						{loadForSelected}
						{refreshSeasonManageLists}
					/>
				{/if}
				{#if seasonManagePartial}
					<p
						data-testid="season-manage-partial-notice"
						role="status"
						class="mt-1 rounded-md border border-dashed border-ink-4 p-2 text-xs text-ink-2"
					>
						{m.season_manage_partial_notice()}
					</p>
				{/if}
				{#if seasonManageSeriesError}
					<p
						data-testid="season-manage-series-error"
						role="alert"
						class="mt-1 text-xs text-red-700"
					>
						{m.season_manage_list_load_error()}
					</p>
				{/if}
				{#each seasonManageSeries as series (series.id)}
					<div
						data-testid="season-manage-series-{series.id}"
						class="mt-1 flex items-center justify-between text-xs text-ink"
					>
						<span>{series.name}</span>
						<div class="flex items-center gap-1">
							<span class="text-ink-2"
								>{m.season_manage_series_event_count({ count: series.eventCount })}</span
							>
							{#if selected && canDeleteSeries(series, selected.personId)}
							{#if seasonManageDeleteArmed === series.id}
								<button
									type="button"
									data-testid="season-manage-series-delete-confirm-{series.id}"
									aria-label={seasonManageArmedSeriesCount !== null &&
									seasonManageArmedSeriesCount > 0
										? m.season_manage_series_delete_confirm({
												name: series.name,
												count: seasonManageArmedSeriesCount
											})
										: m.season_manage_delete_confirm({ name: series.name })}
									disabled={seasonManageDeletePendingId !== null || isOffline}
									aria-busy={seasonManageDeletePendingId === series.id}
									class="flex min-h-11 items-center px-1 text-xs text-red-700 underline disabled:opacity-50"
									onclick={() => onSeasonManageSeriesDelete(series)}
								>
									{seasonManageArmedSeriesCount !== null &&
									seasonManageArmedSeriesCount > 0
										? m.season_manage_series_delete_confirm_short({
												count: seasonManageArmedSeriesCount
											})
										: m.season_manage_delete_confirm_short()}
								</button>
								<button
									type="button"
									data-testid="season-manage-series-delete-cancel-{series.id}"
									aria-label={m.season_manage_delete_cancel({ name: series.name })}
									disabled={seasonManageDeletePendingId !== null}
									class="flex min-h-11 items-center px-1 text-xs text-ink-2 underline hover:text-ink disabled:opacity-50"
									onclick={() =>
										void disarmSeasonManageDelete(
											`season-manage-series-delete-${series.id}`
										)}
								>
									{m.season_manage_delete_cancel_short()}
								</button>
							{:else}
								<DeleteTrigger
									data-testid="season-manage-series-delete-{series.id}"
									aria-label={m.season_manage_series_delete({ name: series.name })}
									disabled={isOffline}
									onclick={() => void armSeasonManageSeriesDelete(series)}
								/>
							{/if}
							{/if}
						</div>
					</div>
				{/each}
				{#if seasonManageDeleteError?.list === 'series'}
					<p
						data-testid="season-manage-delete-error"
						role="alert"
						class="mt-1 text-xs text-red-700"
					>
						{seasonManageDeleteErrorText(seasonManageDeleteError)}
					</p>
				{/if}
			</div>

			{#if !eventCreateOpen}
				<button
					type="button"
					data-testid="season-manage-add-event"
					disabled={createEntryPointsBlocked}
					class="flex min-h-11 items-center text-xs text-ink underline disabled:opacity-50"
					onclick={openEventCreateForm}
				>
					{m.season_manage_add_event()}
				</button>
			{/if}

			<div data-testid="season-manage-repertoire">
				<p class="text-xs tracking-wide text-ink-2 uppercase">
					{m.season_manage_repertoire_label()}
				</p>
				{#if panelRepertoireError}
					<p
						data-testid="season-manage-repertoire-error"
						role="alert"
						class="mt-1 text-xs text-red-700"
					>
						{m.season_manage_list_load_error()}
					</p>
				{/if}
				<RepertoireElement
					rows={panelWorkRows}
					context="repertoire"
					seasonRights={manageableSeasonRights}
					pickableWorksList={panelPickableWorksList}
					pickableWorksVisible={panelPickableWorksVisible}
					pickableWorksPartial={panelWorksPartial}
					pendingKeys={panelPendingKeys}
					addWorkKey={panelAddWorkKey}
					expanded={true}
					onpdfclick={handlePdfClick}
					{heldFileIds}
					onaddwork={handlePanelAddWork}
					onstatuschange={handlePanelStatusChange}
					onremoveitem={handlePanelRemoveItem}
				/>
				{#if panelManageError}
					<p
						data-testid="repertoire-manage-error"
						role="alert"
						class="mt-1 text-xs text-red-700"
					>
						{m.repertoire_manage_error()}
					</p>
				{/if}
				<div
					data-testid="repertoire-manage-status"
					role="status"
					aria-live="polite"
					class="sr-only"
				>
					{panelManageStatus}
				</div>
			</div>
		</div>
		{/if}
	</div>
{/if}
	<div
		data-testid="season-manage-delete-status"
		role="status"
		aria-live="polite"
		class="sr-only"
	>
		{seasonManageDeleteStatus}
	</div>
