<script lang="ts">
	import { page } from '$app/state';
	import { m } from '$lib/paraglide/messages.js';
	import AsOfLine from '$lib/components/offline/AsOfLine.svelte';
	import { createRouteLoadMachine, type RouteLoadStatus } from '$lib/loading/routeLoad';
	import { cfgFor } from '$lib/entu/cfg';
	import { selectedCollectiveStore } from '$lib/collectives/store';
	import { EventDetailLoadError, type EventDetail } from '$lib/events/eventDetail';
	// Two load/refresh pairs: loadEventPageDetail/loadEventPageWorkRows store
	// AND serve the mounted screen; the refresh* twins only store, for the
	// post-write re-read — same cache contract as the agenda's.
	import { loadEventPageDetail, refreshEventPageDetail, loadEventPageWorkRows } from '$lib/events/eventPageData';
	import { resetServedFromCache, servedFromCache } from '$lib/entu/readCache';
	import { listSeriesOptionsForSeason } from '$lib/seasons/seasonManage';
	import { findMyMemberId } from '$lib/rsvp/rsvpData';
	import { loadMembership } from '$lib/rsvp/membershipLoad';
	import { listAttendance, attendanceByMemberId } from '$lib/attendance/attendanceData';
	import { canMarkAttendance, manageRightsFrom } from '$lib/repertoire/repertoireActions';
	import { manageRightsOrNone } from '$lib/repertoire/manageRights';
	import { readManagePickers } from '$lib/repertoire/managePickers';
	import { reportProblem } from '$lib/problems/reportProblem';
	import { getAppByteStore } from '$lib/files/appByteStore';
	import type { EditableEventField } from '$lib/events/eventFieldEdit';
	import SessionExpiredNotice from '$lib/components/auth/SessionExpiredNotice.svelte';
	import { listScheduleItems } from '$lib/schedule/scheduleData';
	import { writesAvailable } from '$lib/net/online';
	import { isPastDetail } from '$lib/events/eventTime';
	import {
		createEventEditState,
		createEventPageState,
		createEventSeriesState,
		resetEventPageState,
		resetEventSeriesState
	} from '$lib/events/eventPageState';
	import { createEventActions } from '$lib/events/eventActions';
	import EventConvertForm from '$lib/events/EventConvertForm.svelte';
	import EventFieldEdit from '$lib/events/EventFieldEdit.svelte';
	import EventSeriesPicker from '$lib/events/EventSeriesPicker.svelte';
	import EventScheduleSection from '$lib/events/EventScheduleSection.svelte';
	import EventRsvpSection from '$lib/events/EventRsvpSection.svelte';
	import EventWorksSection from '$lib/events/EventWorksSection.svelte';
	import EventAttendanceSection from '$lib/events/EventAttendanceSection.svelte';
	import EventDangerZone from '$lib/events/EventDangerZone.svelte';
	import type { EntuCfg } from '$lib/seasons/entuSeasons';

	const selected = $derived($selectedCollectiveStore);
	const eventId = $derived(page.params.id ?? '');
	const isOffline = $derived(!$writesAvailable);

	type Status = RouteLoadStatus | 'not-available';

	let status = $state<Status>('loading');
	let detail = $state<EventDetail | null>(null);

	const ev = $state(createEventPageState());
	const edit = $state(createEventEditState());

	const series = $state(createEventSeriesState());

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

	const routeLoad = createRouteLoadMachine({
		name: 'event detail',
		selected: () => selected,
		setStatus: (s) => {
			status = s;
		},
		reset: ({ selected: current }) => {
			detail = null;
			resetEventPageState(ev);
			resetEventSeriesState(series);
			if (current && eventId) resetServedFromCache();
		},
		onNoCollective: () => resetEventSeriesState(series),
		async load({ cfg, selected: current, g, isCurrent }) {
			const id = eventId;
			if (!id) {
				status = 'no-collective';
				resetEventSeriesState(series);
				return;
			}
			try {
				const loaded = await loadEventPageDetail(cfg, id);
				if (!isCurrent()) return;
				detail = loaded;
				status = 'ready';
				loadMembership(
					findMyMemberId(cfg, current.personId),
					() => g === routeLoad.generation,
					ev
				);
				loadComposeSurfaces(cfg, loaded, current.personId, g);
			} catch (e) {
				if (!(e instanceof EventDetailLoadError && e.unavailable)) throw e;
				if (!isCurrent()) return;
				console.error('event detail: load failed', e);
				status = 'not-available';
			}
		}
	});

	$effect(() => {
		void selected;
		void eventId;
		void routeLoad.loadForSelected();
	});

	function loadComposeSurfaces(cfg: EntuCfg, loaded: EventDetail, personId: string, g: number): void {
		const sid = loaded.seasonId;
		ev.seasonId = sid;
		const seasonRights = manageRightsOrNone(
			sid,
			loaded.seasonOwnerIds,
			loaded.seasonEditorIds,
			personId
		);
		ev.seasonManageRights = seasonRights;
		const eventEditor = manageRightsFrom(loaded.ownerIds, loaded.editorIds, personId) === 'editor';

		if (eventEditor && sid !== null) loadSeriesOptions(cfg, sid, g);

		loadEventPageWorkRows(cfg, [loaded.id], sid, fetch, {
			includeInactive: seasonRights === 'editor'
		})
			.then((byEvent) => {
				if (g !== routeLoad.generation) return;
				ev.workRows = byEvent[loaded.id] ?? [];
			})
			.catch((e) => {
				if (g !== routeLoad.generation) return;
				reportProblem({ area: 'event', action: 'loading the work rows', error: e });
				ev.workRows = [];
			});

		refreshPresence(cfg.db, personId, () => g === routeLoad.generation);

		if (seasonRights === 'editor' || eventEditor) loadManagePickers(cfg, sid, g);

		listScheduleItems(cfg, loaded.id, fetch)
			.then((rows) => {
				if (g !== routeLoad.generation) return;
				ev.scheduleRows = rows;
				ev.scheduleLoaded = true;
			})
			.catch((e) => {
				console.error('event detail: schedule load failed', e);
				if (g !== routeLoad.generation) return;
				ev.scheduleRows = [];
				ev.scheduleLoaded = true;
			});

		if (isPastDetail(loaded)) {
			listAttendance(cfg, loaded.id)
				.then((records) => {
					if (g !== routeLoad.generation) return;
					ev.attendanceMap = attendanceByMemberId(records);
				})
				.catch((e) => {
					console.error('event detail: attendance load failed', e);
					if (g !== routeLoad.generation) return;
					ev.attendanceMap = {};
				});
		}
	}

	function loadSeriesOptions(cfg: EntuCfg, sid: string, g: number): void {
		listSeriesOptionsForSeason(cfg, sid, fetch)
			.then((list) => {
				if (g !== routeLoad.generation) return;
				series.options = list;
				series.optionsLoaded = true;
			})
			.catch((e) => {
				console.error('event detail: series options load failed', e);
				if (g !== routeLoad.generation) return;
				series.options = [];
				series.optionsLoaded = true;
			});
	}

	async function refreshEventDetail(evId: string, g: number): Promise<void> {
		if (!selected) return;
		try {
			const cfg = cfgFor(selected.db);
			const refreshed = await refreshEventPageDetail(cfg, evId);
			if (g !== routeLoad.generation) return;
			detail = refreshed;
		} catch (err) {
			if (g !== routeLoad.generation) return;
			console.error('event detail: post-series-write refresh failed', evId, err);
		}
	}

	function loadManagePickers(cfg: EntuCfg, sid: string | null, g: number): void {
		void readManagePickers(cfg, sid).then((read) => {
			if (g !== routeLoad.generation) return;
			Object.assign(ev, read.pickers);
			ev.libraryPickersLoading = false;
			ev.libraryPickersLoadSucceeded = read.complete;
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

	const actions = createEventActions();
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
					onclick={() => routeLoad.loadForSelected()}
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
				{#if isEditor && detail.seasonId !== null && series.optionsLoaded}
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
						<EventSeriesPicker
							{detail}
							{selected}
							{series}
							{isOffline}
							generation={() => routeLoad.generation}
							{actions}
							refreshDetail={(evId, g) => refreshEventDetail(evId, g)}
						/>
					</div>
				{/if}
				<EventConvertForm
					{detail}
					{selected}
					{canConvert}
					{isOffline}
					generation={() => routeLoad.generation}
					{actions}
					refreshDetail={(evId, g) => refreshEventDetail(evId, g)}
				/>
				<EventFieldEdit
					{detail}
					{selected}
					{edit}
					{isEditor}
					{isOffline}
					generation={() => routeLoad.generation}
					{actions}
					patchDetail={(field, value) => patchDetail(field, value)}
				/>
				<EventScheduleSection
					{detail}
					{selected}
					{ev}
					{isEditor}
					{isOffline}
					generation={() => routeLoad.generation}
					{actions}
				/>
				<EventRsvpSection
					{detail}
					{selected}
					{ev}
					{isOffline}
					generation={() => routeLoad.generation}
					{actions}
				/>
				<EventWorksSection
					{detail}
					{selected}
					{ev}
					{isEditor}
					{isOffline}
					generation={() => routeLoad.generation}
					{actions}
				/>
				<EventAttendanceSection
					{detail}
					{selected}
					{ev}
					{isOffline}
					{canMarkAttendanceForEvent}
					generation={() => routeLoad.generation}
					{actions}
				/>
				<EventDangerZone {detail} {selected} {isEditor} {isOffline} {actions} />
			</div>
		{/if}
	</div>
</main>
