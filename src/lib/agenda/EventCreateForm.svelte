<!-- #508 — [+ Event] dialog, mounted only while open, so its roster/section/series
	prefetch runs once at construction. `surfaceCreatedEvent` and the row-watcher
	stay in the page — they must outlive this form's own close. -->
<script lang="ts">
	import { alreadyReported, reportProblem } from '$lib/problems/reportProblem';
	import FormError from '$lib/components/FormError.svelte';
	import { tick, untrack } from 'svelte';
	import { m } from '$lib/paraglide/messages.js';
	import FormActions from '$lib/components/FormActions.svelte';
	import type { Collective } from '$lib/collectives/types';
	import { cfgFor } from '$lib/entu/cfg';
	import { formKeydown } from '$lib/a11y/formKeys';
	import ConductorChips from '$lib/agenda/ConductorChips.svelte';
	import EventCreateFormFields from '$lib/agenda/EventCreateFormFields.svelte';
	import { createEvent, type CreateEventInput } from '$lib/entity/entityCreate';
	import { resolveDbEntityOrLog } from '$lib/collective/resolveDbEntityOrLog';
	import {
		tallinnHHMM,
		formatTime,
		timeFormatStore,
		tallinnLocalToUtcIso,
		tallinnDayKey
	} from '$lib/preferences/timeFormat';
	import {
		listSeriesOptionsForSeason,
		getSeriesDefaults,
		type SeriesDefaults,
		type SeriesOption
	} from '$lib/seasons/seasonManage';
	import type { RosterRow } from '$lib/roster/rosterData';
	import type { SectionNode } from '$lib/sections/sectionData';
	import type { Season } from '$lib/seasons/types';
	import { writesAvailable } from '$lib/net/online';

	interface Props {
		selected: Collective | null;
		manageableSeasonId: string | null;
		seasons: Season[];
		agendaTypeFilter: string;
		agendaFilterBucketOf: (eventType: string | undefined) => string;
		rosterPartial: boolean;
		sectionsReadFailed: boolean;
		locationSuggestionsId: string;
		submitting: boolean;
		status: string;
		getRoster: (cfg: { db: string; token: string }) => Promise<RosterRow[]>;
		getSections: (cfg: { db: string; token: string }) => Promise<SectionNode[]>;
		rosterPickerOptions: (excludeIds: readonly string[]) => Array<{ id: string; label: string }>;
		pickerPromptText: (optionCount: number, addPrompt: string) => string;
		loadForSelected: (opts?: { keepSeasonManage?: boolean }) => void;
		refreshSeasonManageLists: (cfg: { db: string; token: string }, seasonId: string) => void;
		dismiss: () => void;
		onclose: () => void;
		restoreEventCreateFocus: () => void;
		surfaceCreatedEvent: (eventId: string) => void;
	}

	let {
		selected,
		manageableSeasonId,
		seasons,
		agendaTypeFilter,
		agendaFilterBucketOf,
		rosterPartial,
		sectionsReadFailed,
		locationSuggestionsId,
		submitting = $bindable(false),
		status = $bindable(''),
		getRoster,
		getSections,
		rosterPickerOptions,
		pickerPromptText,
		loadForSelected,
		refreshSeasonManageLists,
		dismiss,
		onclose,
		restoreEventCreateFocus,
		surfaceCreatedEvent
	}: Props = $props();

	const isOffline = $derived(!$writesAvailable);

	function eventCreateDerivedDuration(
		startIso: string,
		endLocal: string
	): number | 'range' | undefined {
		if (!endLocal) return undefined;
		const endIso = tallinnLocalToUtcIso(endLocal);
		if (!endIso) return 'range';
		const startMs = new Date(startIso).getTime();
		const endMs = new Date(endIso).getTime();
		const minutes = Math.round((endMs - startMs) / 60_000);
		if (!Number.isFinite(minutes)) return 'range';
		return minutes <= 0 ? 'range' : minutes;
	}

	type EventCreateErrorField = 'type' | 'season' | 'datetime' | 'name' | 'end' | null;

	function eventCreateStatusFmt(at: Date): string {
		return `${tallinnDayKey(at)} ${formatTime(tallinnHHMM(at), $timeFormatStore)}`;
	}

	let eventCreateSeasonId = $state(untrack(() => manageableSeasonId) ?? '');
	let eventCreateSeriesId = $state('');
	let eventCreateSeriesOptions = $state<SeriesOption[]>([]);
	let eventCreateSeriesDefaults = $state<SeriesDefaults | null>(null);
	let eventCreateType = $state('');
	let eventCreateName = $state('');
	let eventCreateDate = $state('');
	let eventCreateTime = $state('');
	const eventCreateDatetime = $derived(
		eventCreateDate && eventCreateTime ? `${eventCreateDate}T${eventCreateTime}` : ''
	);
	let eventCreateEndDate = $state('');
	let eventCreateEndTime = $state('');
	let eventCreateEndTouched = $state(false);
	const eventCreateEndDatetime = $derived(
		eventCreateEndDate && eventCreateEndTime ? `${eventCreateEndDate}T${eventCreateEndTime}` : ''
	);
	let eventCreateLocation = $state('');
	let eventCreateDescription = $state('');
	let eventCreateCapacity = $state('');
	let eventCreateConductors = $state<Array<{ id: string; name: string }>>([]);
	let eventCreateError = $state<(() => string) | null>(null);
	let eventCreateErrorField = $state<EventCreateErrorField>(null);
	let eventCreateLoadId = 0;

	function setEventCreateError(msg: () => string, field: EventCreateErrorField): void {
		eventCreateError = msg;
		eventCreateErrorField = field;
	}

	function clearEventCreateError(): void {
		eventCreateError = null;
		eventCreateErrorField = null;
	}


	function loadEventCreateSeriesOptions(cfg: { db: string; token: string }, seasonId: string): void {
		const thisLoad = eventCreateLoadId;
		const stale = () => thisLoad !== eventCreateLoadId || eventCreateSeasonId !== seasonId;
		listSeriesOptionsForSeason(cfg, seasonId)
			.then((options) => {
				if (stale()) return;
				eventCreateSeriesOptions = options;
			})
			.catch((e) => {
				if (stale()) return;
				reportProblem({ area: 'agenda', action: 'loading the series options', error: e });
				eventCreateSeriesOptions = [];
			});
	}

	untrack(() => {
		const initialCfg = selected ? cfgFor(selected.db) : null;
		if (!initialCfg) return;
		getRoster(initialCfg).catch(alreadyReported);
		getSections(initialCfg).catch(alreadyReported);
		if (eventCreateSeasonId) loadEventCreateSeriesOptions(initialCfg, eventCreateSeasonId);
	});

	function onEventCreateFormKeydown(event: KeyboardEvent): void {
		formKeydown(event, { close: dismiss, submit: () => void submitEventCreate() });
	}

	function handleEventCreateSeasonChange(newSeasonId: string): void {
		clearEventCreateError();
		eventCreateSeasonId = newSeasonId;
		eventCreateSeriesId = '';
		eventCreateSeriesDefaults = null;
		eventCreateSeriesOptions = [];
		if (!newSeasonId) return;
		const current = selected;
		if (!current) return;
		loadEventCreateSeriesOptions(cfgFor(current.db), newSeasonId);
	}

	function handleEventCreateSeriesChange(newSeriesId: string): void {
		clearEventCreateError();
		eventCreateSeriesId = newSeriesId;
		if (!newSeriesId) {
			eventCreateSeriesDefaults = null;
			return;
		}
		const current = selected;
		if (!current) return;
		const cfg = cfgFor(current.db);
		const thisLoad = eventCreateLoadId;
		const stale = () => thisLoad !== eventCreateLoadId || eventCreateSeriesId !== newSeriesId;
		getSeriesDefaults(cfg, newSeriesId)
			.then((defaults) => {
				if (stale()) return;
				eventCreateSeriesDefaults = defaults;
			})
			.catch((e) => {
				if (stale()) return;
				reportProblem({ area: 'agenda', action: 'loading the series defaults', error: e });
				eventCreateSeriesDefaults = null;
			});
	}

	function eventCreateNumberOrUndefined(raw: string): number | undefined {
		const trimmed = raw.trim();
		if (!trimmed) return undefined;
		const n = Number(trimmed);
		return Number.isFinite(n) ? n : undefined;
	}

	async function submitEventCreate(): Promise<void> {
		if (submitting) return;
		if (isOffline) return;

		clearEventCreateError();
		status = '';

		const panelSeasonId = manageableSeasonId;

		const seasonId = eventCreateSeasonId;
		if (!seasonId) {
			setEventCreateError(m.event_create_season_required, 'season');
			return;
		}
		const typeValue = eventCreateType;
		if (!typeValue) {
			setEventCreateError(m.event_create_type_required, 'type');
			return;
		}
		if (!eventCreateDatetime) {
			setEventCreateError(m.event_create_datetime_required, 'datetime');
			return;
		}
		const startDatetime = tallinnLocalToUtcIso(eventCreateDatetime);
		if (!startDatetime) {
			setEventCreateError(m.event_create_datetime_required, 'datetime');
			return;
		}
		const derivedDuration = eventCreateDerivedDuration(startDatetime, eventCreateEndDatetime);
		if (derivedDuration === 'range') {
			setEventCreateError(m.event_end_before_start, 'end');
			return;
		}
		const durationValue = derivedDuration;
		const trimmedName = eventCreateName.trim();
		if (!eventCreateSeriesId && !trimmedName) {
			setEventCreateError(m.event_create_name_required, 'name');
			return;
		}

		const current = selected;
		if (!current) {
			console.error('agenda: event create submitted with no selected collective');
			setEventCreateError(m.event_create_failed, null);
			return;
		}
		const cfg = cfgFor(current.db);

		submitting = true;
		try {
			const dbEntityId = await resolveDbEntityOrLog(
				cfg,
				{ area: 'agenda', action: 'event create' },
				current.personId
			);
			if (!dbEntityId) {
				setEventCreateError(m.event_create_failed, null);
				return;
			}

			const capacityValue = eventCreateNumberOrUndefined(eventCreateCapacity);
			const trimmedLocation = eventCreateLocation.trim();
			const trimmedDescription = eventCreateDescription.trim();

			const input: CreateEventInput = {
				dbEntityId,
				extraParentIds: [seasonId],
				eventType: typeValue,
				startDatetime,
				...(trimmedName ? { name: trimmedName } : {}),
				...(eventCreateSeriesId ? { seriesId: eventCreateSeriesId } : {}),
				...(durationValue !== undefined ? { durationMinutes: durationValue } : {}),
				...(trimmedLocation ? { location: trimmedLocation } : {}),
				...(trimmedDescription ? { description: trimmedDescription } : {}),
				...(eventCreateConductors.length > 0
					? { conductorRefs: eventCreateConductors.map((c) => c.id) }
					: {}),
				...(capacityValue !== undefined ? { capacity: capacityValue } : {})
			};

			let newEventId: string;
			try {
				newEventId = await createEvent(cfg, input);
			} catch (e) {
				console.error('agenda: event create failed', e);
				setEventCreateError(m.event_create_failed, null);
				return;
			}

			const panel = mounted;
			const showableUnderFilter =
				agendaTypeFilter === 'all' || agendaFilterBucketOf(typeValue) === agendaTypeFilter;
			const createdName = trimmedName || eventCreateSeriesDefaults?.name || typeValue;
			const createdWhen = eventCreateStatusFmt(new Date(startDatetime));
			status = showableUnderFilter
				? m.event_created({ name: createdName, when: createdWhen })
				: m.event_created_hidden_by_filter({ name: createdName, when: createdWhen });
			onclose();
			loadForSelected({ keepSeasonManage: panel });
			if (panel && panelSeasonId === seasonId) {
				refreshSeasonManageLists(cfg, panelSeasonId);
			}

			if (panel && showableUnderFilter) {
				surfaceCreatedEvent(newEventId);
			}
			if (panel) restoreEventCreateFocus();
		} finally {
			submitting = false;
		}
	}

	let mounted = true;
	$effect(() => () => {
		mounted = false;
	});
</script>

<div
	data-testid="event-create-form"
	role="dialog"
	aria-label={m.event_create_form_label()}
	tabindex="-1"
	class="mb-3 flex flex-col gap-1.5 border-b border-dashed border-ink-5 pb-3"
	onkeydown={onEventCreateFormKeydown}
>
	{#if isOffline}
		<p data-testid="event-create-write-unavailable" class="text-xs text-ink-2">
			{m.write_unavailable_no_signal()}
		</p>
	{/if}
	<EventCreateFormFields
		{seasons}
		{locationSuggestionsId}
		{eventCreateErrorField}
		{eventCreateSeasonId}
		{eventCreateSeriesId}
		{eventCreateSeriesOptions}
		{eventCreateSeriesDefaults}
		bind:eventCreateType
		bind:eventCreateName
		bind:eventCreateDate
		bind:eventCreateTime
		bind:eventCreateEndDate
		bind:eventCreateEndTime
		bind:eventCreateEndTouched
		bind:eventCreateLocation
		bind:eventCreateDescription
		bind:eventCreateCapacity
		{clearEventCreateError}
		{handleEventCreateSeasonChange}
		{handleEventCreateSeriesChange}
	/>

	<ConductorChips
		bind:conductors={eventCreateConductors}
		testid="event-create-conductor"
		fieldTestid="event-create-conductors-field"
		label={m.event_create_conductor_label()}
		partial={rosterPartial}
		orderFallback={sectionsReadFailed}
		{rosterPickerOptions}
		prompt={(n) => pickerPromptText(n, m.event_create_conductor_placeholder())}
	/>

	{#if eventCreateError}
		<FormError id="event-create-error" data-testid="event-create-error">
			{eventCreateError()}
		</FormError>
	{/if}

	<FormActions
		testid="event-create"
		submitLabel={m.event_create_submit()}
		cancelLabel={m.roster_cancel()}
		{submitting}
		{isOffline}
		onsubmit={() => void submitEventCreate()}
		oncancel={dismiss}
	/>
</div>
