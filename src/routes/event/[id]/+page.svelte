<script lang="ts">
	// Same load-on-effect/requestId-guard shape as roster and the agenda: a stale
	// load can never clobber a newer route-param combination. No getToken()-missing
	// gate here: the token threads straight through to Entu, the real authority.
	import { tick } from 'svelte';
	import { page } from '$app/state';
	import { m } from '$lib/paraglide/messages.js';
	import AsOfLine from '$lib/components/offline/AsOfLine.svelte';
	import { getToken } from '$lib/auth/storage';
	import { cfgFor } from '$lib/entu/cfg';
	import { selectedCollectiveStore } from '$lib/collectives/store';
	import {
		EventDetailLoadError,
		type EventDetail,
		type EventInheritedField
	} from '$lib/events/eventDetail';
	// Two load/refresh pairs: loadEventPageDetail/loadEventPageWorkRows store
	// AND serve the mounted screen; the refresh* twins only store, for the
	// post-write re-read — same cache contract as the agenda's.
	import { loadEventPageDetail, refreshEventPageDetail, loadEventPageWorkRows } from '$lib/events/eventPageData';
	import { resetServedFromCache, servedFromCache } from '$lib/entu/readCache';
	import { reassignEventSeries, unassignEventSeries } from '$lib/events/eventSeriesActions';
	import { convertEventToSeries } from '$lib/events/eventConvert';
	import { createEvent } from '$lib/entity/entityCreate';
	// deleteEvent is imported directly (not re-exported elsewhere) so the
	// event-delete spec's partial vi.mock('$lib/seasons/seasonManage', ...),
	// which replaces only deleteEvent, still resolves the rest for real.
	import {
		deleteEvent,
		listSeriesOptionsForSeason,
		getSeriesDefaults,
		type SeriesOption,
		type SeriesDefaults
	} from '$lib/seasons/seasonManage';
	import { findMyMemberId, findMyRsvpForEvent } from '$lib/rsvp/rsvpData';
	import { createRsvpChangeQueue } from '$lib/rsvp/rsvpChangeQueue';
	import {
		listAllRsvpsForEvent,
		listAttendance,
		attendanceByMemberId
	} from '$lib/attendance/attendanceData';
	import { createAttendanceChangeQueue } from '$lib/attendance/attendanceChangeQueue';
	import { loadRosterIncludingArchived } from '$lib/roster/memberLifecycle';
	import { listRepertoireItems, type RepertoireItem } from '$lib/repertoire/repertoireData';
	import {
		canMarkAttendance,
		createProgramItem,
		createRepertoireItem,
		createRepertoireWriteQueue,
		deleteProgramItem,
		deleteRepertoireItem,
		manageRightsFrom,
		pickableWorks,
		pinEdition,
		planProgramMove,
		reorderProgramItems,
		resolveManageRights,
		updateRepertoireStatus
	} from '$lib/repertoire/repertoireActions';
	import { listWorks, listEditions, listAllEditions } from '$lib/library/libraryData';
	import type { ManageRightsState } from '$lib/repertoire/types';
	import { getAppByteStore } from '$lib/files/appByteStore';
	import { updateEventField, type EditableEventField } from '$lib/events/eventFieldEdit';
	import { isAuthExpiredError } from '$lib/entu/request';
	import SessionExpiredNotice from '$lib/components/auth/SessionExpiredNotice.svelte';
	import {
		listScheduleItems,
		createScheduleItem,
		updateScheduleItemField,
		removeScheduleItem
	} from '$lib/schedule/scheduleData';
	import { writesAvailable } from '$lib/net/online';
	import { isPastDetail } from '$lib/events/eventTime';
	import {
		createEventEditState,
		createEventPageState,
		resetEventPageState,
		type EventActions
	} from '$lib/events/eventPageState';
	import EventConvertForm from '$lib/events/EventConvertForm.svelte';
	import EventFieldEdit from '$lib/events/EventFieldEdit.svelte';
	import EventScheduleSection from '$lib/events/EventScheduleSection.svelte';
	import EventRsvpSection from '$lib/events/EventRsvpSection.svelte';
	import EventWorksSection from '$lib/events/EventWorksSection.svelte';
	import EventAttendanceSection from '$lib/events/EventAttendanceSection.svelte';
	import EventDangerZone from '$lib/events/EventDangerZone.svelte';
	import type { EntuCfg } from '$lib/seasons/entuSeasons';

	const selected = $derived($selectedCollectiveStore);
	const eventId = $derived(page.params.id ?? '');
	const isOffline = $derived(!$writesAvailable);

	type Status =
		| 'loading'
		| 'no-collective'
		| 'load-error'
		| 'not-available'
		| 'session-expired'
		| 'ready';

	let generation = 0;

	let status = $state<Status>('loading');
	let detail = $state<EventDetail | null>(null);

	const ev = $state(createEventPageState());
	const edit = $state(createEventEditState());

	let seriesOptions = $state<SeriesOption[]>([]);
	let seriesOptionsLoaded = $state(false);
	let seriesArmedTarget = $state<{ id: string } | null>(null);
	let seriesPreviewDefaults = $state<SeriesDefaults | null>(null);
	let seriesPending = $state(false);
	let seriesError = $state<string | null>(null);
	let seriesStatus = $state('');

	let presenceSeq = 0;
	function refreshPresence(db: string, personId: string, isCurrent: () => boolean): void {
		const seq = ++presenceSeq;
		try {
			getAppByteStore()
				.heldFileIds(db, personId)
				.then((ids) => {
					if (seq !== presenceSeq || !isCurrent()) return;
					ev.heldFileIds = new Set(ids);
				})
				.catch((e) => {
					console.error('event detail: file presence read failed', e);
				});
		} catch (e) {
			console.error('event detail: file presence read failed', e);
		}
	}

	const isEditor = $derived(
		detail !== null &&
			selected !== null &&
			manageRightsFrom(detail.ownerIds, detail.editorIds, selected.personId) === 'editor'
	);

	const isOwnerTier = $derived(
		detail !== null && selected !== null && detail.ownerIds.includes(selected.personId)
	);

	const seriesUnassignGated = $derived(
		detail !== null && !isOwnerTier && detail.seriesId !== null
	);

	const canConvert = $derived(
		detail !== null && isEditor && detail.seriesId === null && detail.seasonId !== null
	);

	const canMarkAttendanceForEvent = $derived(
		detail !== null &&
			selected !== null &&
			canMarkAttendance(
				{ owners: detail.ownerIds, editors: detail.editorIds },
				selected.personId
			)
	);

	async function loadForSelected(): Promise<void> {
		const current = selected;
		const id = eventId;
		const g = ++generation;
		if (!current || !id) {
			status = 'no-collective';
			detail = null;
			resetEventPageState(ev);
			resetSeriesState();
			return;
		}
		status = 'loading';
		detail = null;
		resetEventPageState(ev);
		resetServedFromCache();
		try {
			const cfg = cfgFor(current.db);
			const loaded = await loadEventPageDetail(cfg, id);
			if (g !== generation) return;
			detail = loaded;
			status = 'ready';
			loadMembership(cfg, current.personId, g);
			loadComposeSurfaces(cfg, loaded, current.personId, g);
		} catch (e) {
			if (g !== generation) return;
			if (isAuthExpiredError(e)) {
				status = 'session-expired';
				detail = null;
				return;
			}
			console.error('event detail: load failed', e);
			status = e instanceof EventDetailLoadError && e.unavailable ? 'not-available' : 'load-error';
			detail = null;
		}
	}

	function loadMembership(cfg: EntuCfg, personId: string, g: number): void {
		findMyMemberId(cfg, personId)
			.then((id) => {
				if (g !== generation) return;
				ev.memberId = id;
				ev.membership = id ? 'member' : 'non-member';
			})
			.catch(() => {
				if (g !== generation) return;
				ev.memberId = null;
				ev.membership = 'loading';
			});
	}

	function resetSeriesState(): void {
		seriesOptions = [];
		seriesOptionsLoaded = false;
		seriesArmedTarget = null;
		seriesPreviewDefaults = null;
		seriesPending = false;
		seriesError = null;
		seriesStatus = '';
	}

	$effect(() => {
		void selected;
		void eventId;
		loadForSelected().catch((e) => {
			if (isAuthExpiredError(e)) {
				status = 'session-expired';
				return;
			}
			console.error('event detail: load failed', e);
			status = 'load-error';
		});
	});

	function loadComposeSurfaces(cfg: EntuCfg, loaded: EventDetail, personId: string, g: number): void {
		const sid = loaded.seasonId;
		ev.seasonId = sid;
		const seasonRights: ManageRightsState =
			sid === null
				? 'not-editor'
				: manageRightsFrom(loaded.seasonOwnerIds, loaded.seasonEditorIds, personId);
		ev.seasonManageRights = seasonRights;
		const eventEditor = manageRightsFrom(loaded.ownerIds, loaded.editorIds, personId) === 'editor';

		if (eventEditor && sid !== null) loadSeriesOptions(cfg, sid, g);

		loadEventPageWorkRows(cfg, [loaded.id], sid, fetch, {
			includeInactive: seasonRights === 'editor'
		})
			.then((byEvent) => {
				if (g !== generation) return;
				ev.workRows = byEvent[loaded.id] ?? [];
			})
			.catch(() => {
				if (g !== generation) return;
				ev.workRows = [];
			});

		refreshPresence(cfg.db, personId, () => g === generation);

		if (seasonRights === 'editor' || eventEditor) loadManagePickers(cfg, sid, g);

		listScheduleItems(cfg, loaded.id, fetch)
			.then((rows) => {
				if (g !== generation) return;
				ev.scheduleRows = rows;
				ev.scheduleLoaded = true;
			})
			.catch((e) => {
				console.error('event detail: schedule load failed', e);
				if (g !== generation) return;
				ev.scheduleRows = [];
				ev.scheduleLoaded = true;
			});

		if (isPastDetail(loaded)) {
			listAttendance(cfg, loaded.id)
				.then((records) => {
					if (g !== generation) return;
					ev.attendanceMap = attendanceByMemberId(records);
				})
				.catch((e) => {
					console.error('event detail: attendance load failed', e);
					if (g !== generation) return;
					ev.attendanceMap = {};
				});
		}
	}

	function loadSeriesOptions(cfg: EntuCfg, sid: string, g: number): void {
		listSeriesOptionsForSeason(cfg, sid, fetch)
			.then((list) => {
				if (g !== generation) return;
				seriesOptions = list;
				seriesOptionsLoaded = true;
			})
			.catch((e) => {
				console.error('event detail: series options load failed', e);
				if (g !== generation) return;
				seriesOptions = [];
				seriesOptionsLoaded = true;
			});
	}

	function seriesFieldLabel(field: EventInheritedField): string {
		switch (field) {
			case 'name':
				return m.event_detail_series_field_name();
			case 'durationMinutes':
				return m.event_detail_series_field_duration();
			case 'location':
				return m.event_detail_series_field_location();
			case 'description':
				return m.event_detail_series_field_description();
		}
	}

	function seriesFieldBecomes(field: EventInheritedField, defaults: SeriesDefaults): string {
		switch (field) {
			case 'name':
				return defaults.name;
			case 'durationMinutes':
				return defaults.durationMinutes !== null ? String(defaults.durationMinutes) : '';
			case 'location':
				return defaults.defaultLocation;
			case 'description':
				return defaults.defaultDescription;
		}
	}

	async function onSeriesSelectChange(e: Event): Promise<void> {
		const selectEl = e.currentTarget as HTMLSelectElement;
		const newId = selectEl.value;
		if (!detail || !selected) return;
		if (isOffline) return;
		const previousId = detail.seriesId ?? '';
		seriesError = null;
		seriesStatus = '';
		if (newId === previousId) {
			seriesArmedTarget = null;
			seriesPreviewDefaults = null;
			return;
		}
		if (detail.inheritedFields.length === 0) {
			await commitSeriesChange(newId, selectEl);
			return;
		}
		seriesArmedTarget = { id: newId };
		seriesPreviewDefaults = null;
		if (newId === '') return;
		const cfg = cfgFor(selected.db);
		try {
			const defaults = await getSeriesDefaults(cfg, newId);
			if (seriesArmedTarget?.id !== newId) return;
			seriesPreviewDefaults = defaults;
		} catch (err) {
			console.error('event detail: series preview load failed', err);
			if (seriesArmedTarget?.id !== newId) return;
			seriesArmedTarget = null;
			selectEl.value = previousId;
			seriesError = m.event_detail_series_save_error();
		}
	}

	async function cancelSeriesChange(): Promise<void> {
		if (!detail) return;
		seriesArmedTarget = null;
		seriesPreviewDefaults = null;
		seriesError = null;
		await tick();
		const selectEl = document.querySelector<HTMLSelectElement>('[data-testid="event-series-select"]');
		if (selectEl) selectEl.value = detail.seriesId ?? '';
		selectEl?.focus();
	}

	async function confirmSeriesChange(): Promise<void> {
		if (!seriesArmedTarget || seriesPending) return;
		const selectEl = document.querySelector<HTMLSelectElement>('[data-testid="event-series-select"]');
		await commitSeriesChange(seriesArmedTarget.id, selectEl);
	}

	async function commitSeriesChange(newId: string, selectEl: HTMLSelectElement | null): Promise<void> {
		if (!detail || !selected) return;
		if (isOffline) return;
		const g = generation;
		const evId = detail.id;
		const previousId = detail.seriesId ?? '';
		seriesPending = true;
		seriesError = null;
		seriesStatus = '';
		const cfg = cfgFor(selected.db);
		try {
			if (newId === '') {
				await unassignEventSeries(cfg, evId);
			} else {
				await reassignEventSeries(cfg, evId, newId);
			}
			if (g !== generation) return;
			seriesArmedTarget = null;
			seriesPreviewDefaults = null;
			await refreshEventDetail(evId, g);
			if (g !== generation) return;
			seriesPending = false;
			seriesStatus = m.event_detail_series_saved();
		} catch (err) {
			if (g !== generation) return;
			console.error('event detail: series write failed', evId, err);
			seriesArmedTarget = null;
			seriesPreviewDefaults = null;
			seriesPending = false;
			seriesError = m.event_detail_series_save_error();
			if (selectEl) selectEl.value = previousId;
		}
	}

	async function refreshEventDetail(evId: string, g: number): Promise<void> {
		if (!selected) return;
		try {
			const cfg = cfgFor(selected.db);
			const refreshed = await refreshEventPageDetail(cfg, evId);
			if (g !== generation) return;
			detail = refreshed;
		} catch (err) {
			if (g !== generation) return;
			console.error('event detail: post-series-write refresh failed', evId, err);
		}
	}

	function loadManagePickers(cfg: EntuCfg, sid: string | null, g: number): void {
		Promise.all([
			listWorks(cfg),
			listAllEditions(cfg),
			sid === null ? Promise.resolve<RepertoireItem[]>([]) : listRepertoireItems(cfg, sid)
		])
			.then(([worksRead, editionsRead, repertoire]) => {
				if (g !== generation) return;
				ev.libraryWorks = worksRead.items;
				ev.libraryEditions = editionsRead.items;
				ev.libraryWorksPartial = worksRead.truncated;
				ev.libraryEditionsPartial = editionsRead.truncated;
				ev.seasonRepertoire = repertoire;
				ev.libraryPickersLoading = false;
				ev.libraryPickersLoadSucceeded = true;
			})
			.catch(() => {
				if (g !== generation) return;
				ev.libraryWorks = [];
				ev.libraryEditions = [];
				ev.libraryWorksPartial = false;
				ev.libraryEditionsPartial = false;
				ev.seasonRepertoire = [];
				ev.libraryPickersLoading = false;
				ev.libraryPickersLoadSucceeded = false;
			});
	}

	function patchDetail(field: EditableEventField, value: string | number): void {
		if (!detail) return;
		switch (field) {
			case 'event_name':
				detail = { ...detail, name: value as string };
				break;
			case 'start_datetime':
				detail = { ...detail, startDatetime: value as string };
				break;
			case 'duration_minutes':
				detail = { ...detail, durationMinutes: value as number };
				break;
			case 'location':
				detail = { ...detail, location: value as string };
				break;
			case 'description':
				detail = { ...detail, description: value as string };
				break;
			case 'event_type':
				detail = { ...detail, eventType: value as string };
				break;
		}
	}

	const actions: EventActions = {
		deleteEvent: (...a) => deleteEvent(...a),
		convertEventToSeries: (...a) => convertEventToSeries(...a),
		createEvent: (...a) => createEvent(...a),
		findMyMemberId: (...a) => findMyMemberId(...a),
		findMyRsvpForEvent: (...a) => findMyRsvpForEvent(...a),
		createRsvpChangeQueue: (...a) => createRsvpChangeQueue(...a),
		listAllRsvpsForEvent: (...a) => listAllRsvpsForEvent(...a),
		listAttendance: (...a) => listAttendance(...a),
		attendanceByMemberId: (...a) => attendanceByMemberId(...a),
		createAttendanceChangeQueue: (...a) => createAttendanceChangeQueue(...a),
		loadRosterIncludingArchived: (...a) => loadRosterIncludingArchived(...a),
		listRepertoireItems: (...a) => listRepertoireItems(...a),
		resolveManageRights: (...a) => resolveManageRights(...a),
		createRepertoireWriteQueue: (...a) => createRepertoireWriteQueue(...a),
		createProgramItem: (...a) => createProgramItem(...a),
		createRepertoireItem: (...a) => createRepertoireItem(...a),
		deleteProgramItem: (...a) => deleteProgramItem(...a),
		deleteRepertoireItem: (...a) => deleteRepertoireItem(...a),
		pickableWorks: (...a) => pickableWorks(...a),
		pinEdition: (...a) => pinEdition(...a),
		planProgramMove: (...a) => planProgramMove(...a),
		reorderProgramItems: (...a) => reorderProgramItems(...a),
		updateRepertoireStatus: (...a) => updateRepertoireStatus(...a),
		listEditions: (...a) => listEditions(...a),
		listScheduleItems: (...a) => listScheduleItems(...a),
		createScheduleItem: (...a) => createScheduleItem(...a),
		updateScheduleItemField: (...a) => updateScheduleItemField(...a),
		removeScheduleItem: (...a) => removeScheduleItem(...a),
		updateEventField: (...a) => updateEventField(...a)
	};
</script>

<main class="min-h-screen bg-paper px-6 py-10 text-ink">
	<div class="mx-auto flex w-full max-w-md flex-col gap-4">
		<a
			data-testid="event-detail-back"
			href="/"
			class="flex w-fit items-baseline gap-1 text-xs text-ink-2 underline"
		>
			<span aria-hidden="true">←</span>
			<span>{m.event_detail_back()}</span>
		</a>

		{#if status === 'loading'}
			<div
				data-testid="event-detail-skeleton"
				class="flex animate-pulse flex-col gap-2"
				aria-hidden="true"
			>
				<div class="h-6 w-2/3 rounded bg-ink-5"></div>
				<div class="h-4 w-1/2 rounded bg-ink-5"></div>
				<div class="h-4 w-1/3 rounded bg-ink-5"></div>
			</div>
		{:else if status === 'session-expired'}
			<SessionExpiredNotice />
		{:else if status === 'load-error'}
			<div data-testid="event-detail-load-error" role="alert" class="flex flex-col gap-2">
				<p class="text-sm text-red-700">{m.event_detail_load_error()}</p>
				<button
					type="button"
					data-testid="event-detail-retry"
					class="self-start rounded-md border border-ink px-4 py-2 text-sm hover:bg-ink hover:text-paper"
					onclick={() => loadForSelected()}
				>
					{m.event_detail_retry()}
				</button>
			</div>
		{:else if status === 'not-available'}
			<p data-testid="event-detail-not-available" role="alert" class="text-sm">
				{m.event_detail_not_in_collective()}
			</p>
		{:else if status === 'no-collective'}
			<p data-testid="event-detail-no-collective" class="text-sm">
				{m.event_detail_no_collective()}
			</p>
		{:else if detail}
			<div class="flex flex-col gap-1.5">
				{#if $servedFromCache}
					<AsOfLine readAt={$servedFromCache} testid="event-detail-as-of" class="mb-1" />
				{/if}
				{#if isEditor && detail.seasonId !== null && seriesOptionsLoaded}
					<div class="flex flex-col gap-1 border-b border-dashed border-ink-5 pb-2">
						<label for="event-series-select" class="text-xs text-ink-2">
							{m.event_detail_series_label()}
						</label>
						{#if isOffline}
							<p
								data-testid="event-series-write-unavailable"
								role="status"
								class="text-xs text-ink-2"
							>
								{m.write_unavailable_no_signal()}
							</p>
						{/if}
						<select
							id="event-series-select"
							data-testid="event-series-select"
							value={detail.seriesId ?? ''}
							disabled={seriesPending || isOffline}
							onchange={(e) => void onSeriesSelectChange(e)}
							class="w-fit border border-ink-5 bg-paper px-1.5 py-1 text-ink disabled:opacity-50"
						>
							{#if !seriesUnassignGated}
								<option value="">{m.event_detail_series_none()}</option>
							{/if}
							{#each seriesOptions as series (series.id)}
								<option value={series.id}>{series.name}</option>
							{/each}
						</select>
						{#if seriesUnassignGated}
							<p data-testid="event-series-rights-note" class="text-xs text-ink-3">
								{m.event_detail_series_rights_note()}
							</p>
						{/if}
						{#if detail.inheritedFields.length > 0}
							<p class="flex flex-wrap items-baseline gap-x-1 text-xs text-ink-3">
								<span>{m.event_detail_series_inherited_label()}</span>
								{#if detail.inheritedFields.includes('name')}
									<span data-testid="event-series-inherited-name"
										>{m.event_detail_series_field_name()}</span
									>
								{/if}
								{#if detail.inheritedFields.includes('durationMinutes')}
									<span data-testid="event-series-inherited-duration"
										>{m.event_detail_series_field_duration()}</span
									>
								{/if}
								{#if detail.inheritedFields.includes('location')}
									<span data-testid="event-series-inherited-location"
										>{m.event_detail_series_field_location()}</span
									>
								{/if}
								{#if detail.inheritedFields.includes('description')}
									<span data-testid="event-series-inherited-description"
										>{m.event_detail_series_field_description()}</span
									>
								{/if}
							</p>
						{/if}
						{#if seriesArmedTarget && detail.inheritedFields.length > 0 && (seriesArmedTarget.id === '' || seriesPreviewDefaults)}
							<div
								data-testid="event-series-confirm"
								class="flex flex-col gap-1.5 border border-ink-5 bg-paper p-2 text-xs"
							>
								<ul class="flex flex-col gap-0.5">
									{#each detail.inheritedFields as field (field)}
										<li>
											{seriesFieldLabel(field)}{#if seriesArmedTarget.id !== ''}:
												{seriesFieldBecomes(field, seriesPreviewDefaults!)}{/if}
										</li>
									{/each}
									{#if seriesArmedTarget.id === '' && detail.inheritedFields.includes('name')}
										<li class="text-red-700">
											{m.event_detail_series_unassign_name_empty()}
										</li>
									{/if}
								</ul>
								<div class="flex gap-2">
									<button
										type="button"
										data-testid="event-series-confirm-apply"
										disabled={seriesPending || isOffline}
										aria-busy={seriesPending}
										class="flex min-h-11 items-center border border-ink px-2 py-1 text-xs text-ink hover:bg-ink hover:text-paper disabled:opacity-50"
										onclick={() => void confirmSeriesChange()}
									>
										{m.event_detail_series_confirm_apply()}
									</button>
									<button
										type="button"
										data-testid="event-series-confirm-cancel"
										disabled={seriesPending}
										class="flex min-h-11 items-center px-2 py-1 text-xs text-ink-2 hover:text-ink disabled:opacity-50"
										onclick={() => void cancelSeriesChange()}
									>
										{m.event_detail_series_confirm_cancel()}
									</button>
								</div>
							</div>
						{/if}
						{#if seriesStatus}
							<p
								data-testid="event-series-status"
								role="status"
								aria-live="polite"
								class="text-xs text-ink-3"
							>
								{seriesStatus}
							</p>
						{/if}
						{#if seriesError}
							<p data-testid="event-series-error" role="alert" class="text-xs text-red-700">
								{seriesError}
							</p>
						{/if}
					</div>
				{/if}
				<EventConvertForm
					{detail}
					{selected}
					{canConvert}
					{isOffline}
					generation={() => generation}
					{actions}
					refreshDetail={(evId, g) => refreshEventDetail(evId, g)}
				/>
				<EventFieldEdit
					{detail}
					{selected}
					{edit}
					{isEditor}
					{isOffline}
					generation={() => generation}
					{actions}
					patchDetail={(field, value) => patchDetail(field, value)}
				/>
				<EventScheduleSection
					{detail}
					{selected}
					{ev}
					{isEditor}
					{isOffline}
					generation={() => generation}
					{actions}
				/>
				<EventRsvpSection
					{detail}
					{selected}
					{ev}
					{isOffline}
					generation={() => generation}
					{actions}
				/>
				<EventWorksSection
					{detail}
					{selected}
					{ev}
					{isEditor}
					{isOffline}
					generation={() => generation}
					{actions}
				/>
				<EventAttendanceSection
					{detail}
					{selected}
					{ev}
					{isOffline}
					{canMarkAttendanceForEvent}
					generation={() => generation}
					{actions}
				/>
				<EventDangerZone {detail} {selected} {isEditor} {isOffline} {actions} />
			</div>
		{/if}
	</div>
</main>
