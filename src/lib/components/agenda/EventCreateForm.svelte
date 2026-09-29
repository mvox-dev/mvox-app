<!-- #508 — [+ Event] dialog, moved out of +page.svelte's season-manage markup.
	Mounted only while open (the page renders it inside `{#if eventCreateOpen}`):
	the roster/section/series-option prefetch that `openEventCreateForm` used to
	kick off now runs once at construction instead. `surfaceCreatedEvent` and
	the row-watcher stay in the page — they must outlive this form's own close. -->
<script lang="ts">
	import { tick, untrack } from 'svelte';
	import { m } from '$lib/paraglide/messages.js';
	import type { Collective } from '$lib/collectives/types';
	import { getToken } from '$lib/auth/storage';
	import TimeSelect from '$lib/components/TimeSelect.svelte';
	import PersonName from '$lib/components/PersonName.svelte';
	import { CANONICAL_EVENT_TYPES, eventTypeLabel } from '$lib/events/eventTypeLabels';
	import { createEvent, type CreateEventInput } from '$lib/entity/entityCreate';
	import { resolveDatabaseEntityId } from '$lib/collective/databaseEntity';
	import {
		tallinnHHMM,
		formatTime,
		timeFormatStore,
		tallinnLocalToUtcIso,
		isoDateFormatter
	} from '$lib/preferences/timeFormat';
	import {
		listEventSeriesForSeason,
		getSeriesDefaults,
		type SeriesDefaults,
		type SeriesListItem
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

	const EVENT_CREATE_TZ = 'Europe/Tallinn';

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

	const eventCreateStatusDateFmt = isoDateFormatter(EVENT_CREATE_TZ);
	function eventCreateStatusFmt(at: Date): string {
		return `${eventCreateStatusDateFmt.format(at)} ${formatTime(tallinnHHMM(at), $timeFormatStore)}`;
	}

	let eventCreateSeasonId = $state(untrack(() => manageableSeasonId) ?? '');
	let eventCreateSeriesId = $state('');
	let eventCreateSeriesOptions = $state<SeriesListItem[]>([]);
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
	let eventCreateNameInput = $state<HTMLInputElement | null>(null);

	function setEventCreateError(msg: () => string, field: EventCreateErrorField): void {
		eventCreateError = msg;
		eventCreateErrorField = field;
	}

	function clearEventCreateError(): void {
		eventCreateError = null;
		eventCreateErrorField = null;
	}

	function eventCreateDescribedBy(field: EventCreateErrorField): string | undefined {
		return eventCreateErrorField === field ? 'event-create-error' : undefined;
	}

	function eventCreateInvalid(field: EventCreateErrorField): true | undefined {
		return eventCreateErrorField === field ? true : undefined;
	}

	function loadEventCreateSeriesOptions(cfg: { db: string; token: string }, seasonId: string): void {
		const thisLoad = eventCreateLoadId;
		const stale = () => thisLoad !== eventCreateLoadId || eventCreateSeasonId !== seasonId;
		listEventSeriesForSeason(cfg, seasonId)
			.then((result) => {
				if (stale()) return;
				eventCreateSeriesOptions = result.items;
			})
			.catch((e) => {
				if (stale()) return;
				console.error('agenda: loading series options for event create failed', e);
				eventCreateSeriesOptions = [];
			});
	}

	untrack(() => {
		const initialCfg = selected ? { db: selected.db, token: getToken() ?? '' } : null;
		if (!initialCfg) return;
		getRoster(initialCfg).catch((e) => {
			console.error('agenda: loading the roster for the event conductor picker failed', e);
		});
		getSections(initialCfg).catch((e) => {
			console.error('agenda: loading the section tree for the event conductor picker failed', e);
		});
		if (eventCreateSeasonId) loadEventCreateSeriesOptions(initialCfg, eventCreateSeasonId);
	});

	function onEventCreateFormKeydown(event: KeyboardEvent): void {
		if (event.key === 'Escape') dismiss();
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
		loadEventCreateSeriesOptions({ db: current.db, token: getToken() ?? '' }, newSeasonId);
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
		const cfg = { db: current.db, token: getToken() ?? '' };
		const thisLoad = eventCreateLoadId;
		const stale = () => thisLoad !== eventCreateLoadId || eventCreateSeriesId !== newSeriesId;
		getSeriesDefaults(cfg, newSeriesId)
			.then((defaults) => {
				if (stale()) return;
				eventCreateSeriesDefaults = defaults;
			})
			.catch((e) => {
				if (stale()) return;
				console.error('agenda: loading series defaults for event create failed', e);
				eventCreateSeriesDefaults = null;
			});
	}

	function handleEventCreateConductorSelect(selection: { id: string | null; label: string }): void {
		if (!selection.id) return;
		if (eventCreateConductors.some((c) => c.id === selection.id)) return;
		eventCreateConductors = [...eventCreateConductors, { id: selection.id, name: selection.label }];
	}

	function removeEventCreateConductor(id: string): void {
		eventCreateConductors = eventCreateConductors.filter((c) => c.id !== id);
	}

	const eventCreateConductorOptions = $derived(
		rosterPickerOptions(eventCreateConductors.map((c) => c.id))
	);

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
		const cfg = { db: current.db, token: getToken() ?? '' };

		submitting = true;
		try {
			let dbEntityId: string | null;
			try {
				dbEntityId = await resolveDatabaseEntityId(cfg);
			} catch (e) {
				console.error('agenda: resolving the database entity for event create failed', e);
				setEventCreateError(m.event_create_failed, null);
				return;
			}
			if (!dbEntityId) {
				console.error('agenda: event create with no resolvable database entity', current.personId);
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

			const showableUnderFilter =
				agendaTypeFilter === 'all' || agendaFilterBucketOf(typeValue) === agendaTypeFilter;
			const createdName = trimmedName || eventCreateSeriesDefaults?.name || typeValue;
			const createdWhen = eventCreateStatusFmt(new Date(startDatetime));
			status = showableUnderFilter
				? m.event_created({ name: createdName, when: createdWhen })
				: m.event_created_hidden_by_filter({ name: createdName, when: createdWhen });
			onclose();
			loadForSelected({ keepSeasonManage: true });
			if (panelSeasonId === seasonId) {
				refreshSeasonManageLists(cfg, panelSeasonId);
			}

			if (showableUnderFilter) {
				surfaceCreatedEvent(newEventId);
			}
			restoreEventCreateFocus();
		} finally {
			submitting = false;
		}
	}

	$effect(() => {
		eventCreateNameInput?.focus();
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
	<label class="flex w-full flex-col gap-0.5">
		<span data-testid="event-create-type-label" class="text-xs text-ink-2">
			{m.event_create_type_label()}
		</span>
		<select
			data-testid="event-create-type"
			aria-invalid={eventCreateInvalid('type')}
			aria-describedby={eventCreateDescribedBy('type')}
			value={eventCreateType}
			onchange={(e) => {
				eventCreateType = (e.currentTarget as HTMLSelectElement).value;
				clearEventCreateError();
			}}
			class="w-full border border-ink-5 bg-paper px-1.5 py-1 text-ink"
		>
			<option value="">{m.event_create_type_placeholder()}</option>
			{#each CANONICAL_EVENT_TYPES as type (type)}
				<option value={type}>{eventTypeLabel(type)}</option>
			{/each}
		</select>
	</label>

	<label class="flex w-full flex-col gap-0.5">
		<span class="text-xs text-ink-2">{m.event_create_season_label()}</span>
		<select
			data-testid="event-create-season"
			aria-invalid={eventCreateInvalid('season')}
			aria-describedby={eventCreateDescribedBy('season')}
			value={eventCreateSeasonId}
			onchange={(e) =>
				handleEventCreateSeasonChange((e.currentTarget as HTMLSelectElement).value)}
			class="w-full border border-ink-5 bg-paper px-1.5 py-1 text-ink"
		>
			<option value="">{m.event_create_season_placeholder()}</option>
			{#each seasons as season (season.id)}
				<option value={season.id}>{season.name}</option>
			{/each}
		</select>
	</label>

	<label class="flex w-full flex-col gap-0.5">
		<span class="text-xs text-ink-2">{m.event_create_series_label()}</span>
		<select
			data-testid="event-create-series"
			value={eventCreateSeriesId}
			disabled={eventCreateSeasonId === ''}
			onchange={(e) =>
				handleEventCreateSeriesChange((e.currentTarget as HTMLSelectElement).value)}
			class="w-full border border-ink-5 bg-paper px-1.5 py-1 text-ink disabled:opacity-50"
		>
			<option value="">{m.event_create_series_none()}</option>
			{#each eventCreateSeriesOptions as series (series.id)}
				<option value={series.id}>{series.name}</option>
			{/each}
		</select>
	</label>

	{#if eventCreateSeriesId === ''}
		<p data-testid="event-create-series-hint" class="text-xs text-ink-2">
			{m.event_create_series_hint()}
		</p>
	{/if}

	<label class="flex w-full flex-col gap-0.5">
		<span class="text-xs text-ink-2">{m.event_create_name_label()}</span>
		<input
			type="text"
			data-testid="event-create-name"
			bind:this={eventCreateNameInput}
			aria-invalid={eventCreateInvalid('name')}
			aria-describedby={eventCreateDescribedBy('name')}
			placeholder={m.event_create_name_placeholder()}
			value={eventCreateName}
			oninput={(e) => {
				eventCreateName = (e.currentTarget as HTMLInputElement).value;
				clearEventCreateError();
			}}
			class="w-full border border-ink-5 bg-paper px-1.5 py-1 text-ink"
		/>
	</label>
	{#if eventCreateSeriesDefaults?.name}
		<p data-testid="event-create-name-inherited" class="text-xs text-ink-2">
			{m.event_create_inherited_from_series({ value: eventCreateSeriesDefaults.name })}
		</p>
	{/if}

	<div class="flex flex-col gap-0.5">
		<span id="event-create-start-label" class="text-xs text-ink-2">
			{m.event_create_start_label()}
		</span>
		<div
			data-testid="event-create-datetime"
			role="group"
			aria-labelledby="event-create-start-label"
			class="flex flex-wrap gap-2"
		>
			<input
				type="date"
				data-testid="event-create-datetime-date"
				aria-label={m.time_select_date_label()}
				aria-invalid={eventCreateInvalid('datetime')}
				aria-describedby={eventCreateDescribedBy('datetime')}
				value={eventCreateDate}
				oninput={(e) => {
					eventCreateDate = (e.currentTarget as HTMLInputElement).value;
					if (!eventCreateEndTouched) eventCreateEndDate = eventCreateDate;
					clearEventCreateError();
				}}
				class="min-w-0 flex-1 border border-ink-5 bg-paper px-1.5 py-1 text-ink"
			/>
			<TimeSelect
				prefix="event-create-datetime"
				value={eventCreateTime}
				invalid={eventCreateInvalid('datetime')}
				describedBy={eventCreateDescribedBy('datetime')}
				onchange={(v) => {
					eventCreateTime = v;
					clearEventCreateError();
				}}
			/>
		</div>
	</div>

	<div class="flex flex-col gap-0.5">
		<span id="event-create-end-label" class="text-xs text-ink-2">
			{m.event_create_end_label()}
		</span>
		<div
			data-testid="event-create-end"
			role="group"
			aria-labelledby="event-create-end-label"
			class="flex flex-wrap gap-2"
		>
			<input
				type="date"
				data-testid="event-create-end-date"
				aria-label={m.time_select_date_label()}
				aria-invalid={eventCreateInvalid('end')}
				aria-describedby={eventCreateDescribedBy('end')}
				value={eventCreateEndDate}
				oninput={(e) => {
					eventCreateEndDate = (e.currentTarget as HTMLInputElement).value;
					eventCreateEndTouched = true;
					clearEventCreateError();
				}}
				class="min-w-0 flex-1 border border-ink-5 bg-paper px-1.5 py-1 text-ink"
			/>
			<TimeSelect
				prefix="event-create-end"
				value={eventCreateEndTime}
				invalid={eventCreateInvalid('end')}
				describedBy={eventCreateDescribedBy('end')}
				onchange={(v) => {
					eventCreateEndTime = v;
					clearEventCreateError();
				}}
			/>
		</div>
	</div>
	{#if eventCreateSeriesDefaults && eventCreateSeriesDefaults.durationMinutes !== null}
		<p data-testid="event-create-duration-inherited" class="text-xs text-ink-2">
			{m.event_create_inherited_from_series({
				value: m.agenda_duration_min({
					minutes: eventCreateSeriesDefaults.durationMinutes
				})
			})}
		</p>
	{/if}

	<label class="flex w-full flex-col gap-0.5">
		<span class="text-xs text-ink-2">{m.event_create_capacity_label()}</span>
		<input
			type="number"
			data-testid="event-create-capacity"
			placeholder={m.event_create_capacity_placeholder()}
			value={eventCreateCapacity}
			oninput={(e) =>
				(eventCreateCapacity = (e.currentTarget as HTMLInputElement).value)}
			class="w-full border border-ink-5 bg-paper px-1.5 py-1 text-ink"
		/>
	</label>

	<label class="flex w-full flex-col gap-0.5">
		<span class="text-xs text-ink-2">{m.event_create_location_label()}</span>
		<input
			type="text"
			data-testid="event-create-location"
			list={locationSuggestionsId}
			placeholder={m.event_create_location_placeholder()}
			value={eventCreateLocation}
			oninput={(e) =>
				(eventCreateLocation = (e.currentTarget as HTMLInputElement).value)}
			class="w-full border border-ink-5 bg-paper px-1.5 py-1 text-ink"
		/>
	</label>
	{#if eventCreateSeriesDefaults?.defaultLocation}
		<p data-testid="event-create-location-inherited" class="text-xs text-ink-2">
			{m.event_create_inherited_from_series({
				value: eventCreateSeriesDefaults.defaultLocation
			})}
		</p>
	{/if}

	<label class="flex w-full flex-col gap-0.5">
		<span class="text-xs text-ink-2">{m.event_create_description_label()}</span>
		<textarea
			data-testid="event-create-description"
			placeholder={m.event_create_description_placeholder()}
			value={eventCreateDescription}
			oninput={(e) =>
				(eventCreateDescription = (e.currentTarget as HTMLTextAreaElement).value)}
			class="w-full border border-ink-5 bg-paper px-1.5 py-1 text-ink"
		></textarea>
	</label>
	{#if eventCreateSeriesDefaults?.defaultDescription}
		<p data-testid="event-create-description-inherited" class="text-xs text-ink-2">
			{m.event_create_inherited_from_series({
				value: eventCreateSeriesDefaults.defaultDescription
			})}
		</p>
	{/if}

	<div data-testid="event-create-conductors-field">
		<label class="flex w-full flex-col gap-0.5">
			<span class="text-xs text-ink-2">{m.event_create_conductor_label()}</span>
			<select
				data-testid="event-create-conductor-select"
				disabled={eventCreateConductorOptions.length === 0}
				value=""
				onchange={(e) => {
					const target = e.currentTarget as HTMLSelectElement;
					const personId = target.value;
					target.value = '';
					if (!personId) return;
					const label =
						eventCreateConductorOptions.find((o) => o.id === personId)?.label ??
						'';
					handleEventCreateConductorSelect({ id: personId, label });
				}}
				class="w-full border border-ink-5 bg-paper px-1.5 py-1 text-ink disabled:opacity-50"
			>
				<option value="" disabled selected hidden>
					{pickerPromptText(
						eventCreateConductorOptions.length,
						m.event_create_conductor_placeholder()
					)}
				</option>
				{#each eventCreateConductorOptions as option (option.id)}
					<option value={option.id}>{option.label}</option>
				{/each}
		</select>
		</label>
		{#if rosterPartial}
			<p data-testid="event-create-conductor-partial-notice" role="status" class="text-xs text-ink-2">
				{m.picker_partial_members_notice()}
			</p>
		{/if}
		{#if sectionsReadFailed}
			<p data-testid="event-create-conductor-order-note" class="text-xs text-ink-2">
				{m.picker_order_fallback()}
			</p>
		{/if}
	</div>
	{#if eventCreateConductors.length > 0}
		<ul class="flex flex-wrap gap-1.5">
			{#each eventCreateConductors as conductor (conductor.id)}
				<li
					data-testid="event-create-conductor-{conductor.id}"
					class="flex items-center gap-1 border border-ink-5 px-1.5 text-xs text-ink"
				>
					<PersonName name={conductor.name} />
					<button
						type="button"
						data-testid="event-create-conductor-remove-{conductor.id}"
						aria-label={m.season_conductor_remove({ name: conductor.name })}
						class="flex min-h-11 min-w-11 items-center justify-center text-ink-2 hover:text-ink"
						onclick={() => removeEventCreateConductor(conductor.id)}
					>
						&times;
					</button>
				</li>
			{/each}
		</ul>
	{/if}

	{#if eventCreateError}
		<p
			id="event-create-error"
			data-testid="event-create-error"
			role="alert"
			class="text-xs text-red-700"
		>
			{eventCreateError()}
		</p>
	{/if}

	<div class="flex gap-2">
		<button
			type="button"
			data-testid="event-create-submit"
			disabled={submitting || isOffline}
			aria-busy={submitting}
			class="flex min-h-11 items-center border border-ink px-2 py-1 text-xs text-ink hover:bg-ink hover:text-paper disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-ink"
			onclick={() => void submitEventCreate()}
		>
			{m.event_create_submit()}
		</button>
		<button
			type="button"
			data-testid="event-create-cancel"
			disabled={submitting}
			class="flex min-h-11 items-center px-2 py-1 text-xs text-ink-2 hover:text-ink disabled:opacity-50 disabled:hover:text-ink-2"
			onclick={dismiss}
		>
			{m.roster_cancel()}
		</button>
	</div>
</div>
