<script lang="ts">
	import { tick, untrack } from 'svelte';
	import { authStore } from '$lib/auth/session';
	import DeleteTrigger from '$lib/components/DeleteTrigger.svelte';
	// #220 — the AM/PM preference reaches every displayed clock time through
	// this ONE shared formatter (timeFormat.no-hardcoded-render.spec.ts pins
	// that no other file may keep its own 24h-rendering Intl formatter).
	import {
		tallinnHHMM,
		formatTime,
		timeFormatStore,
		tallinnLocalToUtcIso,
		isoDateFormatter
	} from '$lib/preferences/timeFormat';
	import { collectiveState, selectedCollectiveStore, pickerModeStore } from '$lib/collectives/store';
	import { loadFullAgenda } from '$lib/agenda/agendaData';
	import type { AgendaItem } from '$lib/agenda/types';
	import { getToken } from '$lib/auth/storage';
	import {
		findMyMemberId,
		listMyRsvps,
		rsvpsByEventId,
		type MyRsvp,
		type RsvpByEventId,
		type RsvpStatus
	} from '$lib/rsvp/rsvpData';
	import { createRsvpChangeQueue, type RsvpEntry } from '$lib/rsvp/rsvpChangeQueue';
	import { computeConductorEventIds, isConductor, resetConductor } from '$lib/attendance/conductorStore';
	import { completionGateStore } from '$lib/profile/completionGate';
	import { loadRoster } from '$lib/roster/rosterData';
	import type { RosterRow } from '$lib/roster/rosterData';
	// #255 done-when 3 — the season summary's history-keeps-its-subject fix
	// reads the inactive roster ALONGSIDE the active one (see
	// `handleExpandSeasonSummary` below).
	import { loadInactiveRoster } from '$lib/roster/memberLifecycle';
	import {
		listAttendance,
		listMyAttendance,
		listAllRsvpsForEvent,
		attendanceByMemberId,
		type AttendanceStatus,
		type EventAttendance,
		type MyAttendance
	} from '$lib/attendance/attendanceData';
	import { createAttendanceChangeQueue } from '$lib/attendance/attendanceChangeQueue';
	import { deriveAttendanceRate, deriveAllMemberRates, type MemberAttendanceRate } from '$lib/attendance/attendanceSummary';
	import { loadWorksByEventId, collectSources, buildWorkRows } from '$lib/repertoire/workRows';
	// #262 — the agenda's compact schedule-times line: the SAME bulk-read
	// producer the event-detail page uses, mirroring `loadWorksByEventId`'s own
	// seam (one GET per visible event id, upcoming AND recent — no per-row
	// refetch storm, no family left out per Gama's ruling 5558026158).
	import { listScheduleItemsByEventId, type ScheduleItem } from '$lib/schedule/scheduleData';
	import { signFileUrl } from '$lib/repertoire/fileUrls';
	import { workLabel } from '$lib/repertoire/workLabel';
	import type {
		ManageRightsState,
		PickerOption,
		RepertoireStatus,
		WorkRow,
		WorksManage
	} from '$lib/repertoire/types';
	import { listRepertoireItems, type RepertoireItem } from '$lib/repertoire/repertoireData';
	import {
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
	import {
		listWorks,
		listEditions,
		listAllEditions,
		listAllCopies,
		type Copy,
		type Edition,
		type Work
	} from '$lib/library/libraryData';
	import { unresolvedEditionWorkIds } from '$lib/repertoire/editionUnknown';
	import RepertoireElement, {
		ADD_PROGRAMME_KEY,
		ADD_WORK_KEY
	} from '$lib/components/agenda/RepertoireElement.svelte';
	import { isAuthExpiredError } from '$lib/entu/request';
	import SessionExpiredNotice from '$lib/components/auth/SessionExpiredNotice.svelte';
	import TimeSelect from '$lib/components/TimeSelect.svelte';
	import { m } from '$lib/paraglide/messages.js';
	import { getLocale } from '$lib/paraglide/runtime.js';
	import DeskSurface from '$lib/components/DeskSurface.svelte';
	import AgendaList from '$lib/components/agenda/AgendaList.svelte';
	// #247 — the month overview sibling, rendered instead of AgendaList when
	// the view-mode toggle is set to 'month'; the day-list branch above stays
	// byte-unchanged.
	import AgendaMonthView from '$lib/components/agenda/AgendaMonthView.svelte';
	import { agendaViewStore, setAgendaView } from '$lib/preferences/agendaView';
	import { rovingNextIndex } from '$lib/a11y/roving';
	import SeasonSummary from '$lib/components/attendance/SeasonSummary.svelte';
	// #209 (PO standing rule 1) — the three conductor pickers are NATIVE
	// <select> elements, fed in ROSTER ORDER (Gama ruling 3) by the SAME
	// `rosterOrder` helper the roster page's own grouping runs through.
	import { listSections, rosterOrder, type SectionNode } from '$lib/sections/sectionData';
	import type { AttendancePanel } from '$lib/attendance/types';
	import type { Season } from '$lib/seasons/types';
	import { createEvent, createEventSeries, createSeason } from '$lib/entity/entityCreate';
	import type { CreateEventInput, CreateEventSeriesInput } from '$lib/entity/entityCreate';
	import {
		generateEventDates,
		generateIntervalDates,
		type RepeatPattern
	} from '$lib/events/recurrence';
	import { resolveDatabaseEntityId } from '$lib/collective/databaseEntity';
	import {
		listEventSeriesForSeason,
		updateSeasonField,
		addSeasonConductor,
		removeSeasonConductor as apiRemoveSeasonConductor,
		getSeriesDefaults,
		deleteEventSeries as apiDeleteEventSeries,
		countSeriesOccurrences as apiCountSeriesOccurrences,
		countSeasonScope as apiCountSeasonScope,
		deleteSeason as apiDeleteSeason
	} from '$lib/seasons/seasonManage';
	import type {
		SeasonEditableField,
		SeriesDefaults,
		SeriesListItem
	} from '$lib/seasons/seasonManage';
	// #197 review F3/F5 — the delete-refusal discriminators live in their OWN
	// module (see `deleteErrors.ts`'s header): the page's integration specs
	// `vi.mock` `$lib/seasons/seasonManage` wholesale, so importing these from
	// there would hand the page `undefined` under test.
	// #313 — `isEventCascadePartial` left with `onSeasonManageEventDelete`: the
	// panel's own cascades (series/season) never surface that error RAW at the
	// top level (deleteEventSeries/deleteSeason always wrap a child's
	// EventCascadePartialError inside their OWN tagged error — see
	// seasonManage.ts), so the 'partial-event' branch was unreachable dead code
	// the moment the standalone-event delete left.
	import {
		isDeleteForbidden,
		isSeriesCascadePartial,
		isSeasonCascadePartial
	} from '$lib/seasons/deleteErrors';
	// #199 — the canonical, localized event-type picker shared by the series and
	// event creation forms (replaces the free-text input / prior-type
	// Autocomplete this page used to build the type field from).
	import { CANONICAL_EVENT_TYPES, eventTypeLabel } from '$lib/events/eventTypeLabels';
	// #214 — the SAME #211 color scheme the row badges use, reused verbatim on
	// the active filter chip (never a second hand-typed copy).
	import { eventTypeBadgeClass } from '$lib/events/eventTypeStyles';

	// Auth + collective reflection, same as the walking skeleton. T5: once a
	// collective is resolved, this IS the post-login home — the agenda renders
	// directly here, no redirect/route change needed.
	const auth = $derived($authStore);
	const collectives = $derived($collectiveState);
	const selected = $derived($selectedCollectiveStore);
	const pickerMode = $derived($pickerModeStore);

	let agendaItems = $state<AgendaItem[]>([]);
	let agendaLoading = $state(true);
	let agendaError = $state(false);
	// #107 — a 401-driven rejection (session_expired) is a DIFFERENT failure class
	// than a generic data-loading error: the entuFetch layer already cleared the
	// stale session and fired the sign-in redirect, so this just needs to say why.
	let sessionExpired = $state(false);

	// #12 — the singer's own member id (needed for the write path) and existing
	// rsvps (seeds each row's initial answer). Resolved alongside the agenda, same
	// requestId guard, same collective. A read failure here fails safe (disabled
	// control / unanswered rows) rather than blocking the agenda itself — RSVP
	// data is supplementary, not load-bearing for the page.
	let memberId = $state<string | null>(null);
	// Membership as an explicit 3-state, kept SEPARATE from memberId. `memberId`
	// alone was ambiguous: null meant BOTH "still looking up / lookup failed" AND
	// "confirmed non-member", so a real member was flashed (and, on a rejected
	// lookup, PERMANENTLY shown) the "Only members can RSVP" hint. Rules:
	//   'loading'    — unresolved: still in flight, OR the lookup rejected. Control
	//                  disabled, NO non-member hint (fail-safe — never a false claim).
	//   'member'     — resolved to an active member id. Control enabled.
	//   'non-member' — resolved, no active membership. Control disabled + hint.
	// Only 'non-member' (a genuine resolution) ever shows the hint.
	let membership = $state<'loading' | 'member' | 'non-member'>('loading');
	let rsvpByEventId = $state<RsvpByEventId>({});
	// #321 — true when the singer's OWN listMyRsvps read came back truncated
	// (server count > raw entities.length on that same request): the answer
	// set behind rsvpByEventId is then incomplete, and an event this page shows
	// as "unanswered" may actually have a real answer beyond the cap.
	let rsvpPartial = $state(false);
	// Events whose last write REJECTED — threaded into AgendaList so that row shows
	// an inline save-failed error (otherwise the optimistic value just snapped back
	// silently). Cleared when a fresh write for the event starts (setPending true).
	let failedEventIds = $state<Set<string>>(new Set());
	// #15 — events with an RSVP write in flight; threaded into AgendaList so the
	// WHOLE control for that event disables (all 4 buttons), not just the tapped
	// button. This is what makes a second tap on the same event structurally
	// impossible — see rsvpChangeQueue.ts for why that's the actual fix (the old
	// inline handleRsvpChange's whole-map optimistic-set/revert let a second tap
	// fire against the '__optimistic__' placeholder and get the event stuck).
	let pendingEventIds = $state<Set<string>>(new Set());
	// #326 — events whose last write RECONCILED successfully; threaded into
	// AgendaList so that row's RsvpControl carries the saved cue. Cleared the
	// moment a NEW write starts for the event (setPending true, below) — the
	// cue always describes the LATEST write, never a stale one — and on a
	// failed write (revert), so saved and saveFailed never show together.
	let savedEventIds = $state<Set<string>>(new Set());

	// #85 TA.4 — my own attendance across every past event, loaded ONCE per
	// member resolution (not per-event) alongside the memberId lookup. Powers
	// both each Recent row's badge (via myAttendanceByEventId below) and my
	// own season line in the SeasonSummary (deriveAttendanceRate).
	let myAttendance = $state<MyAttendance[]>([]);
	// #321 — true when the singer's OWN listMyAttendance read came back
	// truncated. Same rationale as `rsvpPartial` above, the member-lifetime twin.
	let attendancePartial = $state(false);

	// #83 — the agenda's 'Recent' section: ALL past events of the CURRENT season.
	// Loaded as part of loadFullAgenda (one fetch pass for upcoming + recent —
	// F1+F2 fix: no duplicate listSeasons/listEvents calls, no N+1 conductor
	// reads). `conductorEventIds` is computed PURELY from the already-loaded data
	// (season.conductors + event.conductors on each AgendaItem).
	let recentItems = $state<AgendaItem[]>([]);
	let conductorEventIds = $state<Set<string>>(new Set());

	// #214 — event type filter chips above the agenda. Gama's ruling
	// (2026-09-02, all three comments): the chip set is derived from the
	// event types PRESENT in the rendered agenda (recent + upcoming, every
	// season it spans) — not the canonical 8, not "current season" literally.
	// Single-select toggle with an explicit 'All' chip; the filter applies to
	// the WHOLE agenda (Recent included).
	type AgendaFilterBucket = (typeof CANONICAL_EVENT_TYPES)[number];
	type AgendaTypeFilter = 'all' | AgendaFilterBucket;
	let agendaTypeFilter = $state<AgendaTypeFilter>('all');
	const CANONICAL_EVENT_TYPE_SET = new Set<string>(CANONICAL_EVENT_TYPES);
	// Free-text or empty `event_type` values, and the canonical 'other' type
	// itself, all group under the SAME 'other' filter bucket (ruling 3) — the
	// row badge keeps showing the raw string; only FILTERING groups them.
	function agendaFilterBucketOf(eventType: string | undefined): AgendaFilterBucket {
		const type = eventType ?? '';
		if (type !== 'other' && CANONICAL_EVENT_TYPE_SET.has(type)) return type as AgendaFilterBucket;
		return 'other';
	}
	// The chips actually rendered: canonical order, only buckets present
	// somewhere in the WHOLE agenda (recent counts toward derivation too).
	const agendaFilterChips = $derived.by(() => {
		const present = new Set<AgendaFilterBucket>();
		for (const it of agendaItems) present.add(agendaFilterBucketOf(it.eventType));
		for (const it of recentItems) present.add(agendaFilterBucketOf(it.eventType));
		return CANONICAL_EVENT_TYPES.filter((type) => present.has(type));
	});
	const filteredAgendaItems = $derived(
		agendaTypeFilter === 'all'
			? agendaItems
			: agendaItems.filter((it) => agendaFilterBucketOf(it.eventType) === agendaTypeFilter)
	);
	const filteredRecentItems = $derived(
		agendaTypeFilter === 'all'
			? recentItems
			: recentItems.filter((it) => agendaFilterBucketOf(it.eventType) === agendaTypeFilter)
	);
	// #214 review F1 — the pressed affordance must NOT be carried by the hue
	// alone. `eventTypeBadgeClass` maps social/other (and every free-text type,
	// which all bucket into 'other') to the quiet DEFAULT_CLASS
	// 'text-ink-2 border-ink-4' — the exact classes an INACTIVE chip carries,
	// so tapping those chips changed nothing on screen while the All chip
	// simultaneously lost its fill: a shortened agenda under no visibly
	// selected chip. #211's map stays the single hue source (never a second
	// hand-typed color map); the pressed state adds a scheme-INDEPENDENT
	// weight + ring on top, which reads for a hued and a quiet type alike and
	// collides with no utility family used by the base or hue classes.
	const CHIP_PRESSED_CLASS = 'font-semibold ring-1 ring-ink';
	function agendaTypeChipClass(type: AgendaFilterBucket): string {
		return agendaTypeFilter === type
			? `${eventTypeBadgeClass(type)} ${CHIP_PRESSED_CLASS}`
			: 'border-ink-4 text-ink-2';
	}
	// Tap the active chip again -> back to 'all'; tap a different one -> that
	// one becomes active; the explicit All chip always clears the filter.
	function selectAgendaTypeFilter(value: AgendaTypeFilter) {
		agendaTypeFilter = agendaTypeFilter === value ? 'all' : value;
	}

	// #312 — view toggle roving tabindex. Radiogroup semantics (arrow moves
	// AND selects), same shape as roster's handleViewModeKeydown
	// (roster/+page.svelte:683-695): a LOCAL wrapper around the shared
	// rovingNextIndex index math (src/lib/a11y/roving.ts), not a call into
	// roster's own handler — roving.ts's header comment states every group
	// hand-writes its own membership/activate/focus wrapper by design.
	// `agendaViewStore` already models single selection, so there is no
	// separate roving $state to keep in sync — the checked segment IS the
	// tab stop.
	function handleAgendaViewKeydown(e: KeyboardEvent): void {
		const group = e.currentTarget as HTMLElement;
		const segments = Array.from(group.querySelectorAll<HTMLButtonElement>('button'));
		const idx = segments.indexOf(e.target as HTMLButtonElement);
		if (idx < 0) return;
		const next = rovingNextIndex(e.key, idx, segments.length);
		if (next < 0) return;
		e.preventDefault();
		const view = segments[next].dataset.agendaView as 'list' | 'month' | undefined;
		if (!view) return;
		setAgendaView(view);
		segments[next].focus();
	}

	// Gama ruling 1, consequence 2 — if the active type disappears from the
	// list (its last event went away), the chip vanishes from
	// `agendaFilterChips` above; this is what actually resets the filter so
	// the user is never left staring at an empty list under a filter chip
	// that is no longer even on screen.
	$effect(() => {
		if (agendaTypeFilter !== 'all' && !agendaFilterChips.includes(agendaTypeFilter)) {
			agendaTypeFilter = 'all';
		}
	});

	// #248 — location suggestions for the two agenda-page create forms
	// (series + event). ONE shared derivation, no new fetch: the corpus is
	// whatever the page already holds in memory (recentItems + agendaItems).
	// Deduped, blanks dropped. Ordering: most-recently-used first — recentItems
	// is already reverse-chronological (recentEvents in conductorLogic.ts) and
	// agendaItems is chronological-ascending (soonest upcoming), so walking
	// recent-then-upcoming and keeping first-seen surfaces the venue actually
	// used most recently at the top, which is the most useful default for a
	// "suggest previously used venues" affordance. The SET is what #248 pins;
	// this ordering is the free choice the issue leaves to engineering.
	const LOCATION_SUGGESTIONS_ID = 'agenda-location-suggestions';
	const locationSuggestions = $derived.by(() => {
		const seen = new Set<string>();
		const out: string[] = [];
		for (const it of recentItems) {
			if (it.location && !seen.has(it.location)) {
				seen.add(it.location);
				out.push(it.location);
			}
		}
		for (const it of agendaItems) {
			if (it.location && !seen.has(it.location)) {
				seen.add(it.location);
				out.push(it.location);
			}
		}
		return out;
	});

	// #90 TR.2 — the works view model per event id (upcoming AND recent rows),
	// resolved once the agenda itself has loaded (it needs the event ids and the
	// current season). Same supplementary-data posture as rsvpByEventId: a
	// failure here leaves every row work-free rather than breaking the agenda.
	let worksByEventId = $state<Record<string, WorkRow[]>>({});
	// #262 — the schedule_item bulk read per event id (upcoming AND recent),
	// mirroring `worksByEventId`'s own seam exactly. Supplementary data: a
	// failure leaves every row schedule-free rather than breaking the agenda.
	let scheduleByEventId = $state<Record<string, ScheduleItem[]>>({});
	// A PDF whose click-time signing rejected — surfaced inline rather than
	// leaving the member staring at a tab that never navigated.
	let pdfError = $state(false);

	// #91 TR.3 — repertoire/programme MANAGEMENT. Everything below is what makes
	// the write layer reachable: without it `manageRights` never left its
	// 'not-editor' default and every control in RepertoireElement was dead code
	// in the running app, however green its unit tests were.
	//
	// Rights are read per entity (repertoire is a child of the SEASON, a
	// programme a child of the EVENT — different `_editor` grants), so the
	// resolution is one GET for the season plus one per agenda event, fanned out
	// concurrently. That is the same O(N) shape the works load already pays for
	// its per-event program_item reads; it is not free, and it is why the works
	// load waits for it (the manage read keeps retired/dropped rows, so it must
	// know the answer before it fetches — see includeInactive below).
	let currentSeasonId = $state<string | null>(null);
	let seasonManageRights = $state<ManageRightsState>('not-editor');
	// #167 — the ADMIN's season pick (`manageableSeason`), DELIBERATELY separate
	// from `currentSeasonId`/`seasonManageRights` above: those answer "which
	// season is CURRENT" (viewer semantics — Recent scoping, season repertoire),
	// and stay null for a just-created FUTURE-dated season. Event/series
	// creation gate on THIS pair instead — the season an admin manages defaults
	// to current-if-running, else the soonest not-yet-started season (see
	// agendaData's `manageableSeasonId` doc). Mirrors currentSeasonId/
	// seasonManageRights exactly whenever a live season is current — it diverges
	// in the future-only case (the whole point of #167) and when the current
	// season has LAPSED with a later one waiting (review F1).
	let manageableSeasonId = $state<string | null>(null);
	let manageableSeasonRights = $state<ManageRightsState>('not-editor');
	/**
	 * #277 — per-season rights, keyed by season id, for EVERY candidate season
	 * in the per-season entry-point set (`manageableSeasonEntries` below) — not
	 * just the one `manageableSeasonId` happens to be pointing at. Populated at
	 * load time by the SAME `manageRightsFrom` call the single-season
	 * derivation above already makes, one call per candidate; promoted
	 * uniformly by the database-entity-rights fallback (see the
	 * `loadFullAgenda().then()` callback) since db-entity rights are
	 * season-independent (ER-7).
	 */
	let manageableSeasonRightsById = $state<Record<string, ManageRightsState>>({});
	// #132/T2 review F3 — the season-CREATION gate's own rights signal, DELIBERATELY
	// separate from `seasonManageRights`. That one answers "may I manage the CURRENT
	// season's repertoire", so it is fail-closed 'not-editor' whenever no season is
	// running — and the two states where no season is running (a brand-new
	// collective; a season that lapsed) are precisely the states where creating one
	// is the whole point of #132. See `deriveSeasonCreateRights`.
	let seasonCreateRights = $state<ManageRightsState>('not-editor');
	let eventManageRights = $state<Record<string, ManageRightsState>>({});
	// #132/T2 — the FULL season list `loadFullAgenda` already fetches (it calls
	// listSeasons internally and today throws the list away after picking the
	// current one) — no extra fetch. Consumed by several page-level surfaces.
	// Anchors below are grep targets, NOT line numbers: this file is edited
	// often and any `:NNNN` pointer here silently rots into a wrong-code
	// pointer for the next reader. The consumers are the event-create season
	// <select> (`data-testid="event-create-season"`), the zero-season
	// onboarding banner gate (`seasons.length === 0`, guarding
	// `data-testid="agenda-onboarding"`), and the two manageable-season field
	// lookups (`seasonManageDeleteName`, and the `seasonManageFieldsLoaded`
	// initial-field-value block inside `openSeasonManagePanel`). The SAME list
	// also reaches `deriveSeasonCreateRights` as `fullSeasons`, straight off
	// the agenda result at the `deriveSeasonCreateRights(` call site, for its
	// lapsed / no-current-season fallback.
	// #261 (PO:Gama reopen, 2026-09-07) — it no longer powers any "an upcoming
	// season already exists" suppression on the season-create entry point; that
	// gate is gone.
	let seasons = $state<Season[]>([]);
	// The season's repertoire_items — the exclusion set for the "Add work"
	// picker. Read separately from the agenda rows because a fully programmed
	// agenda produces NO repertoire rows at all, and the picker would then
	// happily offer works that already have a repertoire_item.
	let seasonRepertoire = $state<RepertoireItem[]>([]);
	let libraryWorks = $state<Work[]>([]);
	let libraryEditions = $state<Edition[]>([]);
	/**
	 * #321 (PO ruling 2026-09-11) — the two library reads behind the repertoire
	 * PICKERS came back truncated. Both selects are closed sets: a work the
	 * "Add work" list does not offer cannot be added to the repertoire, and an
	 * edition the "Add to programme" list does not offer cannot go on tonight's
	 * programme — the gap reads as "it isn't in the library", not as a short
	 * list. This site previously carried the "out of the RED-pinned scope"
	 * narrowing, which the ruling rejects.
	 *
	 * One flag per FEED, never one for both: a truncated edition read says
	 * nothing about the works list, and a shared flag would put a false claim in
	 * the other picker. Assigned on every settle, cleared where the arrays they
	 * describe are.
	 */
	let libraryWorksPartial = $state(false);
	let libraryEditionsPartial = $state(false);
	/**
	 * #329 (review) — the scoped half of the truncation fix. When
	 * `libraryEditionsPartial` is true, every repertoire row the collective-wide
	 * read could not settle (no matched option, or a pin it could not name) gets
	 * ONE `listEditions(workId)` — scoped to that work, its own reachable cap —
	 * and the answer lands here, keyed by work id. Merged into
	 * `editionOptionsByRowId` below, with the key set handed to
	 * RepertoireElement as `editionsResolvedWorkIds`: a work in here is a stated
	 * fact again (named pin, or a genuine known-absence when the scoped list is
	 * empty), a work not in here stays honestly unknown.
	 *
	 * `scopedEditionWorkIdsRequested` is deliberately NOT $state: it is the
	 * dispatch guard (one request per work per collective), not something any
	 * render reads. A FAILED scoped read stays in it and out of the map — the
	 * row keeps the unknown wording, which is exactly what a read that did not
	 * answer leaves us knowing.
	 */
	let scopedEditionsByWorkId = $state<Record<string, PickerOption[]>>({});
	let scopedEditionWorkIdsRequested = new Set<string>();
	// #288 — is the `libraryWorks`/`libraryEditions` fetch (loadManagePickers)
	// currently in flight? `resetManagement()` blanks those two synchronously on
	// EVERY `loadForSelected` (including same-collective refreshes: season
	// create, event create, series bulk, convert resume, agenda retry — see the
	// #288 research), and the refill is async, so `.length === 0` alone cannot
	// tell "not back yet" apart from "confirmed empty". This distinguishes them.
	let libraryPickersLoading = $state(false);
	// #311 — the SECOND signal `pickableWorksVisible`'s sticky effect needs:
	// `!libraryPickersLoading` alone cannot tell a settle that SUCCEEDED apart
	// from one that FAILED — `loadManagePickers`' catch clears the loading
	// flag too, exactly as its `.then()` does. True only for the duration
	// between a `.then()` writing real data and the NEXT `resetManagement()`
	// (which flips it back false in the same synchronous pass that blanks
	// `libraryWorks`/`seasonRepertoire`, mirroring how it handles
	// `libraryPickersLoading` itself); the catch also sets it false
	// explicitly, so a failed settle is never mistaken for one that landed.
	let libraryPickersLoadSucceeded = $state(false);
	// #288 review F1 — the SECOND async source the visibility decision reads.
	// `pickableEditionsByEventId` iterates `worksByEventId` — both its per-event
	// KEYS and each event's already-programmed exclusion set come from there —
	// and `loadForSelected` blanks THAT synchronously too, while its refill
	// rides a SEPARATE read (`loadWorksByEventId`, dispatched after
	// `loadManagePickers`). So gating the sticky effect on
	// `libraryPickersLoading` alone did not close the vanish window, it MOVED
	// it: whenever the picker reads settle before the row read — the likelier
	// ordering, 3 GETs against 4+ including the per-event program_item fanout —
	// the effect ran over a still-empty `worksByEventId`, wrote `{}` and wiped
	// every sticky entry for the whole remaining duration of the row load. Both
	// flags gate the effect; each is cleared only by the settle of the read that
	// owns it (under that read's own staleness ticket).
	let worksRowsLoading = $state(false);
	// #288 — "Add to programme" visibility, per event id, held STICKY across a
	// same-collective reload: re-decided only once BOTH `libraryPickersLoading`
	// and `worksRowsLoading` go false again, so an already-visible control does
	// not vanish and reappear
	// while its source is mid-refetch (Mihkel's #272 rule — no options once
	// loading has COMPLETED, not no options right now — stays intact: an entry
	// still resolves to hidden once loading settles empty). A never-yet-shown
	// event id (first render, or a genuinely different collective's event ids)
	// simply has no entry yet, which RepertoireElement's own fallback treats as
	// its original `pickableEditions.length > 0` — false while nothing has ever
	// loaded, exactly the "first render is unaffected" half of the ruling.
	let pickableEditionsVisibleByEventId = $state<Record<string, boolean>>({});
	// #311 — "Add work" visibility, the sibling of the above but a single
	// SCALAR: `pickableWorksList`'s only two inputs, `libraryWorks` and
	// `seasonRepertoire`, both settle under `loadManagePickers`' one
	// Promise.all — no second per-event source to gate on, so this needs only
	// `libraryPickersLoading`'s own settle, not a `worksRowsLoading` twin.
	// `undefined` = not yet decided; RepertoireElement's own #311 default
	// (render) applies, matching "first render is unaffected".
	let pickableWorksVisible = $state<boolean | undefined>(undefined);
	// Write-queue keys in flight: row ids (and the ADD_* sentinels) the controls
	// disable on — the #15 double-tap guard.
	let managePendingKeys = $state<Set<string>>(new Set());
	// The last management write REJECTED (its optimistic change already rolled
	// back). Surfaced inline: a value that silently snaps back reads as a bug.
	let manageError = $state(false);

	// #234 — the season-manage panel's OWN repertoire section. Deliberately
	// SEPARATE state from `seasonRepertoire`/`worksByEventId`/`managePendingKeys`
	// above: those are all `currentSeasonId`-scoped (the viewer's "current
	// season"), while the panel manages `manageableSeasonId` (PO ruling on the
	// issue — #167's admin pick, which diverges from `currentSeasonId` for a
	// future-only season or a lapsed-current one). Reusing the currentSeasonId
	// plumbing verbatim would list/write the WRONG season whenever the two
	// diverge.
	//
	// #234 review F1 — the works/editions join sources are panel-local TOO, not
	// borrowed from `libraryWorks`/`libraryEditions`. Those two are only ever
	// filled by `loadManagePickers`, whose gate (`loadWorksAndManagement`) is
	// `seasonManageRights === 'editor'` (currentSeasonId-scoped) OR an event
	// editor — never `manageableSeasonRights`. In the FUTURE-ONLY season case —
	// the exact state the PO ruling names as the reason for the panel scoping —
	// `currentSeason()` is null, so `seasonManageRights` is 'not-editor', and a
	// season with no events yet leaves `eventManageRights` empty: the pickers
	// were never fetched, the add-work select rendered with only its prompt, and
	// the rows lost their composer/edition labels. The panel already owns its own
	// reads, so it owns these; nothing else consumes them.
	let panelRepertoire = $state<RepertoireItem[]>([]);
	let panelWorks = $state<Work[]>([]);
	let panelEditions = $state<Edition[]>([]);
	/** #321 (PO ruling 2026-09-11) — the panel's OWN `listWorks` read, behind its
	 *  own "Add work" select (this section exists because the panel's season can
	 *  diverge from the agenda's — see the state block doc). Same closed set,
	 *  same false absence. `panelEditions`/`panelCopies` get no flag: there they
	 *  feed row LABELS, not options, and a label that cannot be resolved
	 *  degrades to blank rather than hiding anything pickable (the reason
	 *  workRows.ts states for staying out). */
	let panelWorksPartial = $state(false);
	let panelCopies = $state<Copy[]>([]);
	let panelPendingKeys = $state<Set<string>>(new Set());
	// #234 review F4 — a FAILED panel read renders as an empty repertoire
	// section, indistinguishable from a season with nothing in it. Surfaced the
	// way this panel's sibling lists already surface theirs
	// (`seasonManageSeriesError`/`seasonManageEventsError` → the shared
	// `season_manage_list_load_error` line): fail loudly, never silently degrade.
	// Covers BOTH panel reads — the season's repertoire and the works/editions/
	// copies join sources — since either coming back empty misreads as "nothing
	// here" (no rows, or rows with no labels and an empty add-work select).
	let panelRepertoireError = $state(false);
	// #324 — `panelQueue`'s own failure/saved signals, distinct from the READ
	// failure above (`panelRepertoireError`/`season_manage_list_load_error`):
	// a rejected WRITE must not masquerade as a failed list load. Scoped to
	// the panel, distinct from the agenda-side `manageError` this same page
	// already carries for its OWN (untouched) `repertoireQueue`.
	let panelManageError = $state(false);
	// #324/#267 shape — persistent sr-only role="status" region
	// (profile-roster-names-status idiom): mounted blank, text set
	// imperatively on a successful settle, cleared at the START of the next
	// attempt (never on a timer).
	let panelManageStatus = $state('');
	// #311 — `loadPanelRepertoire` had NO loading signal at all before this
	// (research-311: zero grep hits), so the panel's Add Work control had
	// nothing sticky to key hiding off. True before either of its two reads
	// dispatches, false only once BOTH have settled (success or catch) —
	// see `loadPanelRepertoire` for how the two independent promises join.
	let panelRepertoireLoading = $state(false);
	// #311 — per-read success signals, the panel's version of the main flow's
	// `libraryPickersLoadSucceeded`: `panelPickableWorksVisible`'s sticky
	// effect may only recompute once BOTH of `panelPickableWorksList`'s
	// inputs (`panelWorks`, `panelRepertoire`) come from a settle that
	// SUCCEEDED — `!panelRepertoireLoading` alone cannot tell that apart from
	// a settle that FAILED (both clear it), and `loadPanelRepertoire`'s two
	// reads are independent promises, so each needs its OWN flag rather than
	// one shared boolean. Also flipped by `refreshPanelRepertoire` (the
	// #234-sync re-read `panelRepertoire` alone gets after a write on either
	// surface) — its catch deliberately does NOT flip this false: "keep the
	// previous rows" there means keep the previous answer here too.
	let panelRepertoireItemsOk = $state(false);
	let panelWorksSourcesOk = $state(false);
	// #311 — the panel's own `pickableWorksVisible` override, the sibling of
	// the main flow's page-level scalar. `undefined` = not yet decided or a
	// failed first load; RepertoireElement's own #311 default (render)
	// applies, which is also what keeps the select visible beside
	// `panelRepertoireError`'s banner.
	let panelPickableWorksVisible = $state<boolean | undefined>(undefined);
	/**
	 * #277 review 2 F1 — the season `panelRepertoire`'s rows were read for, set
	 * where they are read (`loadPanelRepertoire`) and cleared with them
	 * (`resetSeasonManage`). What `refreshPanelRepertoire` re-reads, INSTEAD of
	 * re-deriving the season from `manageableSeasonId` at settle time: that id is
	 * blank for the whole length of every `{ keepSeasonManage: true }` reload
	 * (`resetManagement()` blanks it), so a panel-side repertoire write settling
	 * inside one bailed on the blank and skipped its reconcile entirely, leaving
	 * the section on pre-write rows — the same live-compare defect #277 review F1
	 * took out of `loadPanelRepertoire`. Surviving a close/reopen is deliberate:
	 * `closeSeasonManagePanel` keeps `panelRepertoire`, so it keeps this too, and
	 * only the panel-lifetime teardown drops both. Plain state, nothing renders
	 * off it.
	 */
	let panelRepertoireSeasonId: string | null = null;

	// #85 TA.4 — the season summary's expand state (conductor-only) + the
	// full-roster rates it reveals. Loaded lazily on first expand (most visits
	// never open it): one roster read + one listAttendance read per past event,
	// cached for the collective's current load (reset on every fresh collective
	// selection, same as rosterCache/attendanceFailedByEvent below).
	let seasonSummaryExpanded = $state(false);
	let seasonMemberRates = $state<MemberAttendanceRate[]>([]);
	let seasonRatesLoaded = $state(false);
	// F2 fix: explicit loading/error states for the roster rate expansion. The
	// previous code's .catch() silently set seasonMemberRates = [] while leaving
	// seasonSummaryExpanded true — an expanded block with zero rows,
	// indistinguishable from "the roster is empty". Now a failed or in-flight
	// load surfaces as a distinct state via SeasonSummary.
	let seasonRatesLoading = $state(false);
	let seasonRatesError = $state(false);
	/**
	 * #321 (PO ruling 2026-09-11, second pass) — either member read behind the
	 * rate table came back PARTIAL. This was left log-only on the reasoning that
	 * a per-member percentage roll-up is not an option surface and so falls
	 * outside the reachability test; the PO's correction is that the test
	 * EXTENDED the display-list criterion to option-lists rather than replacing
	 * it, and a read surface that silently drops singers is the original defect
	 * this issue was filed about.
	 *
	 * It is also a particularly bad place to drop rows quietly: the table invites
	 * comparison between named people, so a missing singer is absent from a
	 * comparison others are being judged in. ONE flag for both reads (active and
	 * archived) because the reader needs the same thing to know either way, and
	 * cleared exactly where `seasonMemberRates` is.
	 */
	let seasonRatesPartial = $state(false);

	// #84 TA.3 — the "Take attendance" inline panel. `attendanceItem` is the
	// recent AgendaItem currently expanded (null = collapsed / nothing open).
	// Data (roster + attendance + rsvp comparison) is loaded on demand when the
	// conductor opens the panel — not pre-fetched with the agenda, since most
	// visits never open it.
	let attendanceItem = $state<AgendaItem | null>(null);
	let attendanceLoading = $state(false);
	let attendanceError = $state(false);
	let attendanceRoster = $state<RosterRow[]>([]);
	let attendanceMap = $state<Record<string, { attendanceId: string; status: AttendanceStatus }>>({});
	let attendanceRsvpMap = $state<Record<string, { rsvpId: string; status: string }>>({});
	// #15-shaped guard, per member id (see attendanceChangeQueue.ts doc).
	let attendancePendingMemberIds = $state<Set<string>>(new Set());
	let attendanceFailedMemberIds = $state<Set<string>>(new Set());
	// #327 — members whose last write for the CURRENTLY OPEN event RECONCILED
	// successfully; mirrors #326's savedEventIds shape, scoped to the open
	// panel (see attendanceQueue's callbacks below, which only touch this when
	// `eventId === attendanceItem?.id` — the same per-(event,member) granularity
	// the pending/failed sets already have). Reset on every panel open, which is
	// what keeps the cue from leaking onto a different event's panel — the read
	// path (open + load) never touches it, only a write settling does.
	let attendanceSavedMemberIds = $state<Set<string>>(new Set());
	// Per-event failed map: stores failed member IDs per event so that a write
	// failure on a non-current event is not lost — when the conductor reopens that
	// event later, the failures surface. (#84 review Finding 4)
	let attendanceFailedByEvent = $state<Map<string, Set<string>>>(new Map());
	let attendanceRequestId = 0;
	// Roster cache: keyed by collective db, avoids 1+N roster reads on every
	// panel open for the same collective. Cleared on collective switch. (#84
	// review Finding 5)
	// Finding 3 fix: TTL of 5 minutes — a member added or deactivated mid-session
	// is picked up on the next panel open after the TTL expires (previously the
	// cache was keyed by db alone and cleared only on collective switch).
	const ROSTER_CACHE_TTL_MS = 5 * 60 * 1000;
	// #321 (PO ruling 2026-09-11) — `truncated` rides IN the cache entry rather
	// than beside it: a cache HIT is another picker open on the SAME read, and it
	// must state exactly what the read that filled the cache found. One lifetime,
	// one owner.
	let rosterCache = $state<{
		db: string;
		roster: RosterRow[];
		truncated: boolean;
		fetchedAt: number;
	} | null>(null);
	// #132/T3 — the season-manage panel's ONE source of member names (conductor
	// chips + the conductor picker's option list, #209 a native <select>).
	// Mirrored off every `getRoster` resolution (cache hit or fresh fetch)
	// rather than fetched separately, so the panel never pays its own 1+N
	// roster fan-out.
	let rosterRows = $state<RosterRow[]>([]);
	/**
	 * #209 review F1 — an EMPTY option list is not ONE state but four: the read
	 * has not finished, the read FAILED, this collective has no members at all,
	 * and "everyone eligible is already picked". Only the last of those may say
	 * `picker_everyone_added`; the other three said it too when the exhausted
	 * state was keyed on `options.length === 0` alone, so a cold-cache form open
	 * (a 1+N fan-out long) and — permanently — a failed roster read both claimed
	 * every member had already been added. These two flags, owned by the two
	 * read funnels below, are what `pickerPromptText` tells them apart with.
	 *
	 * In-flight is a COUNT, not a boolean: two forms can warm the same cache at
	 * once (agenda + panel), and the first settle must not clear a read that is
	 * still running.
	 */
	let rosterReadsInFlight = $state(0);
	let rosterReadFailed = $state(false);
	/**
	 * #321 (PO ruling 2026-09-11) — the member read behind this page's
	 * roster-fed pickers came back PARTIAL. A closed-set picker's options are the
	 * whole reachable world, so a missing one reads as "that person is not a
	 * member" rather than as a short list; the three conductor pickers and the
	 * attendance panel therefore say so inside themselves, where the eyes are.
	 *
	 * ONE flag for the page because there is one read behind all of them
	 * (`getRoster`'s cache). Assigned on every resolution — cache hit included,
	 * off the entry's own `truncated` — and cleared wherever `rosterRows` is, so
	 * the claim never outlives the rows it describes or crosses a switch.
	 */
	let rosterPartial = $state(false);
	/** The SECTION read behind roster ORDER failed. The picker stays usable —
	 *  `rosterOrder` degrades to the roster's own name order — but says so
	 *  rather than presenting a silently different order as the roster's
	 *  (#209 review F2: one posture, both surfaces). */
	let sectionsReadFailed = $state(false);
	const rosterPickerLoading = $derived(rosterReadsInFlight > 0);

	/**
	 * The ONE way this page reads the roster: cache-first, keyed by the db the
	 * read is for, TTL-bounded. `loadRoster` is `listActiveMembers` + one profile
	 * GET per member — 1+N requests (~117 for a 116-member collective), so every
	 * caller that goes around this helper pays the whole fan-out again.
	 *
	 * #132/T2 review F1 — extracted from `openAttendancePanel` (it was the only
	 * cached path) so the season-create form shares it: opening the form after the
	 * attendance panel had already loaded the roster used to re-fetch all of it.
	 */
	function getRoster(cfg: { db: string; token: string }): Promise<RosterRow[]> {
		const cacheValid =
			rosterCache &&
			rosterCache.db === cfg.db &&
			Date.now() - rosterCache.fetchedAt < ROSTER_CACHE_TTL_MS;
		if (cacheValid) {
			rosterRows = rosterCache!.roster;
			rosterReadFailed = false;
			// #321 — the cached rows carry the cached read's truncation with them.
			rosterPartial = rosterCache!.truncated;
			return Promise.resolve(rosterCache!.roster);
		}
		rosterReadsInFlight += 1;
		rosterReadFailed = false;
		return loadRoster(cfg)
			.then((read) => {
				// Keyed by the db the fetch was FOR — a collective switch mid-flight
				// leaves a cache entry the (now different) selected db never matches.
				rosterCache = {
					db: cfg.db,
					roster: read.items,
					truncated: read.truncated,
					fetchedAt: Date.now()
				};
				rosterRows = read.items;
				rosterPartial = read.truncated;
				return read.items;
			})
			.catch((e: unknown) => {
				// Re-thrown: every caller keeps its own `.catch` (and the panel its
				// `.finally`). The flag exists so the PICKER can say "unavailable"
				// instead of "everyone is already added" (#209 review F1).
				rosterReadFailed = true;
				// #321 — a failed read says nothing about completeness: the picker's
				// "unavailable" caption is the whole story, and a truncation claim from
				// an earlier attempt must not stand beside it.
				rosterPartial = false;
				throw e;
			})
			.finally(() => {
				rosterReadsInFlight -= 1;
			});
	}

	// #209 — the section tree behind ROSTER ORDER (Gama ruling 3), cached the
	// same shape as `getRoster` above and shared by all three conductor pickers
	// (season-manage panel, season-create form, event-create form).
	let sectionsCache = $state<{ db: string; sections: SectionNode[]; fetchedAt: number } | null>(
		null
	);
	let rosterSections = $state<SectionNode[]>([]);

	function getSections(cfg: { db: string; token: string }): Promise<SectionNode[]> {
		const cacheValid =
			sectionsCache &&
			sectionsCache.db === cfg.db &&
			Date.now() - sectionsCache.fetchedAt < ROSTER_CACHE_TTL_MS;
		if (cacheValid) {
			rosterSections = sectionsCache!.sections;
			sectionsReadFailed = false;
			return Promise.resolve(sectionsCache!.sections);
		}
		rosterReadsInFlight += 1;
		sectionsReadFailed = false;
		return listSections(cfg)
			.then((sections) => {
				sectionsCache = { db: cfg.db, sections, fetchedAt: Date.now() };
				rosterSections = sections;
				return sections;
			})
			.catch((e: unknown) => {
				sectionsReadFailed = true;
				throw e;
			})
			.finally(() => {
				rosterReadsInFlight -= 1;
			});
	}

	/** #209 — every roster row NOT excluded, in ROSTER ORDER (Gama ruling 3):
	 *  section (this collective's tree order), then position within section,
	 *  Unassigned last, multi-section people deduped to their first position.
	 *  Built off the SAME `rosterRows`/`rosterSections` every picker site
	 *  shares. */
	function rosterPickerOptions(
		excludeIds: readonly string[]
	): Array<{ id: string; label: string }> {
		return rosterOrder(rosterRows, rosterSections)
			.filter((row) => !excludeIds.includes(row.personId))
			.map((row) => ({ id: row.personId, label: row.name }));
	}

	/** #209 review F1 — the prompt option's text for a person picker. With
	 *  people to offer it is the site's own add-prompt; with NONE it must say
	 *  WHICH empty this is. `picker_everyone_added` is reserved for the one
	 *  case that has actually been established: the roster resolved, it had
	 *  rows, and every one of them is already picked. */
	function pickerPromptText(optionCount: number, addPrompt: string): string {
		if (optionCount > 0) return addPrompt;
		if (rosterReadFailed) return m.picker_roster_unavailable();
		if (rosterPickerLoading) return m.picker_roster_loading();
		if (rosterRows.length === 0) return m.picker_no_members();
		return m.picker_everyone_added();
	}

	// Load the selected collective's upcoming agenda; reload on every collective
	// switch. `requestId` guards against a slow earlier fetch clobbering a later
	// one if the user switches collectives before the first load resolves — the
	// same guard covers a stale rejection (M2 fix below), not just a stale resolve.
	let requestId = 0;
	/**
	 * A SECOND, finer generation counter, for `worksByEventId` alone (#167 review
	 * round 2, F1). `requestId` only changes on a collective switch, so it cannot
	 * order two works reads issued WITHIN one agenda load — and there are exactly
	 * such a pair: `loadWorksAndManagement` fires the filtered read immediately,
	 * then the database-entity rights probe may come back 'editor' and
	 * `upgradeRepertoireManagement` fires the UNFILTERED one. Both settled under
	 * the same `requestId`, so the assignment was pure last-writer-wins; the
	 * filtered read is a 4-collection JOIN plus one program_item read per event
	 * (~45 requests on a 40-event season) racing a two-GET probe, so on a large
	 * season it can easily land last and silently drop every retired/inactive
	 * repertoire row — taking with it the only toggle that brings them back.
	 *
	 * Every site that issues a works read takes a ticket here and only assigns if
	 * its ticket is still the newest, so the LATEST-ISSUED read wins regardless of
	 * completion order.
	 */
	let worksLoadId = 0;
	// #262 — the SAME per-read ticket idiom, for the schedule bulk read. Its
	// own counter (not reusing `worksLoadId`): a schedule read and a works
	// read issued in the same agenda load are independent races, and
	// conflating their tickets would let one's staleness rule wrongly gate
	// the other.
	let scheduleLoadId = 0;
	/**
	 * `keepSeasonManage` (#132/T4 review F2): this reload is a SAME-COLLECTIVE
	 * refresh after a write made from inside the season-manage panel, not a
	 * collective switch. The panel (and the roster its conductor chips read
	 * names from) must survive it — otherwise the panel the editor is standing
	 * in vanishes mid-task, and the list refresh that follows writes into a
	 * panel nobody can see. NEVER pass it for a genuine selection change: the
	 * teardown is what stops the previous collective's series/events from
	 * surviving into the new one.
	 */
	function loadForSelected(opts: { keepSeasonManage?: boolean } = {}) {
		const keepSeasonManage = opts.keepSeasonManage === true;
		// #277 review F1 — the season the OPEN panel is holding, captured HERE
		// because `resetManagement()` below blanks `manageableSeasonId` for the
		// whole round trip. A panel-preserving reload deliberately skips
		// `resetSeasonManage` and leaves the panel on screen with ITS season's
		// fields, rows and armed state — so the success handler must give that
		// season back, not the automatic pick (`manageableSeasonId = mSeasonId`
		// silently repointed the OPEN panel, and the next field edit then wrote
		// to a season the operator was not looking at). `null` on every other
		// path: a genuine switch, or a reload with no panel open, has nothing to
		// hold and takes the automatic pick as before.
		const heldSeasonId = keepSeasonManage && seasonManageOpen ? manageableSeasonId : null;
		const current = selected;
		if (!current) {
			agendaItems = [];
			agendaLoading = false;
			agendaError = false;
			memberId = null;
			membership = 'loading';
			rsvpByEventId = {};
			rsvpPartial = false;
			failedEventIds = new Set();
			savedEventIds = new Set();
			recentItems = [];
			conductorEventIds = new Set();
			// #214 — no collective, no agenda, no filter to be stale.
			agendaTypeFilter = 'all';
			worksByEventId = {};
			scheduleByEventId = {};
			pdfError = false;
			resetManagement();
			// #288 — deselection: no agenda load follows, so nothing else would
			// ever flip `resetManagement`'s two loading flags back off.
			libraryPickersLoading = false;
			worksRowsLoading = false;
			resetConductor();
			closeAttendancePanel();
			rosterCache = null;
			rosterRows = [];
			// #321 — the claim goes with the rows: a truncation found in the
			// collective being left must never caption the next one's pickers.
			rosterPartial = false;
			sectionsCache = null;
			rosterSections = [];
			// #209 review F1/F2 — the readiness flags belong to the collective whose
			// roster they describe: a failure in the PREVIOUS one must not caption
			// the next one's picker.
			rosterReadFailed = false;
			sectionsReadFailed = false;
			resetSeasonManage();
			attendanceFailedByEvent = new Map();
			myAttendance = [];
			attendancePartial = false;
			seasonSummaryExpanded = false;
			seasonMemberRates = [];
			seasonRatesLoaded = false;
			seasonRatesLoading = false;
			seasonRatesError = false;
			// #321 — the claim goes with the rows it described, so a truncation
			// found in the collective being left never captions the next one's table.
			seasonRatesPartial = false;
			seasons = [];
			closeSeasonCreateForm();
			closeEventCreateForm();
			// #132/T6 review F3 — the series form is the third creation surface and
			// belongs to the collective it was opened in: its `seriesCreateSeasonId`
			// is an id in the PREVIOUS db. Left alive it would submit against the
			// new db's cfg. `closeSeriesCreateForm` UNMOUNTS it and nothing else
			// (#138 review F1): the per-db resume records are untouched by any
			// switch, and `restoreSeriesCreateRun` re-opens the owning db's own run
			// when it is selected again.
			closeSeriesCreateForm();
			return;
		}
		const thisRequest = ++requestId;
		// A fresh collective selection closes any open attendance panel — its data
		// (roster + attendance + rsvp) belongs to the PREVIOUS collective.
		closeAttendancePanel();
		agendaLoading = true;
		agendaError = false;
		sessionExpired = false;
		// Fresh selection -> membership is unresolved again (not carried over as a
		// stale member/non-member), and no event has a failed write yet.
		memberId = null;
		membership = 'loading';
		failedEventIds = new Set();
		// #326 — a saved cue belongs to the collective whose write earned it, so
		// this drops every cue ALREADY EARNED at switch time (pin 7), including
		// one sitting on an event id the next collective happens to reuse.
		//
		// What it does NOT reach is a write still IN FLIGHT. This page's queue
		// callbacks carry no per-write generation guard (event/[id] discriminates
		// with `isCurrentWrite`, because it collapses the per-event state into
		// scalars and has to); here `reconcile` adds to `savedEventIds`
		// unconditionally, so a write started in collective A that settles after
		// the switch re-adds its eventId afterwards. That is the same pre-existing
		// gap `rsvpByEventId` already has on this path, not one #326 introduced,
		// and it is unreachable while Entu event ids are unique across dbs. Fixing
		// it means a switch-scoped write epoch stamped in `setPending`, checked in
		// `reconcile`/`revert` — deliberately its own change, not this slice's.
		// (`requestId` cannot serve as that epoch: it also bumps on
		// same-collective `keepSeasonManage` refreshes, which would swallow the
		// cue for a perfectly good write.)
		savedEventIds = new Set();
		worksByEventId = {};
		scheduleByEventId = {};
		pdfError = false;
		resetManagement();
		if (!keepSeasonManage) {
			// #214 — a genuine collective switch (this is the same "not
			// keepSeasonManage = a real switch, not a same-collective creation
			// refresh" signal the roster/season-manage resets right below already
			// key off) never carries a filter over from the collective the user
			// just left.
			agendaTypeFilter = 'all';
			// The roster ride-along is deliberate: the panel's conductor chips
			// resolve their names off `rosterRows`, and nothing re-fetches it while
			// the panel merely stays open — wiping it would turn every chip into
			// "unknown member" for a refresh that changed no collective.
			rosterCache = null;
			rosterRows = [];
			// #321 — the claim goes with the rows: a truncation found in the
			// collective being left must never caption the next one's pickers.
			rosterPartial = false;
			sectionsCache = null;
			rosterSections = [];
			// #209 review F1/F2 — the readiness flags belong to the collective whose
			// roster they describe: a failure in the PREVIOUS one must not caption
			// the next one's picker.
			rosterReadFailed = false;
			sectionsReadFailed = false;
			resetSeasonManage();
			// #132/T6 review F3 — the series form lives INSIDE the panel this branch
			// tears down, and `resetSeasonManage` does not touch its state: the panel
			// closed but `seriesCreateOpen`/`seriesCreateSeasonId` survived into the
			// next collective, so re-opening the gear re-rendered the previous
			// collective's form verbatim (and a submit would have sent a
			// cross-database parent reference, or resumed POSTing against the old db's
			// series id).
			//
			// #138 review F1 — this is an UNMOUNT, never a forget: the previous db's
			// resume record (if any) stays in `seriesCreateResumeByDb` under its own
			// key, and the agenda load below re-opens THIS db's own stopped run via
			// `restoreSeriesCreateRun`.
			//
			// Deliberately INSIDE this branch, not unconditional: the bulk-failure
			// path calls `loadForSelected({ keepSeasonManage: true })` and depends on
			// the open form surviving that call.
			closeSeriesCreateForm();
		}
		attendanceFailedByEvent = new Map();
		myAttendance = [];
		// #321 review F1 — the two person-lifetime truncation flags share ONE
		// lifecycle: both describe the collective whose read produced them, so
		// both die here, unconditionally, before the new reads are issued. Only
		// `attendancePartial` was reset; `rsvpPartial` was cleared solely in the
		// no-collective branch above, so a switch from a collective whose
		// `listMyRsvps` truncated to one whose does not left the notice standing
		// over B's loading agenda until B's read resolved — a false claim about
		// B's data (the #287/#296/#299 stale-state class). `rsvpByEventId`
		// itself is NOT reset here: AgendaList renders a skeleton while
		// `agendaLoading`, so A's rows are never on screen during the switch,
		// and the .then/.catch pair below replaces the map either way.
		rsvpPartial = false;
		attendancePartial = false;
		seasonSummaryExpanded = false;
		seasonMemberRates = [];
		seasonRatesLoaded = false;
		seasonRatesLoading = false;
		seasonRatesError = false;
		// #321 — the claim goes with the rows it described, so a truncation
		// found in the collective being left never captions the next one's table.
		seasonRatesPartial = false;
		seasons = [];
		closeSeasonCreateForm();
		closeEventCreateForm();

		const personId = current.personId;

		// #83 fix (F1+F2) — ONE combined load replaces the old loadAgenda() +
		// loadRecentEvents() pair. Seasons and events are fetched once;
		// conductor data rides on the already-fetched props (no separate reads).
		loadFullAgenda()
			.then(
				({
					upcoming,
					recent,
					seasonId,
					seasonConductors,
					seasonOwners,
					seasonEditors,
					seasons: fullSeasons,
					// #167 review F4 — REQUIRED, never defaulted: the producer always
					// emits these, and a default would silently restore the #167 bug
					// (controls gated on a field nobody sets) instead of failing.
					manageableSeasonId: mSeasonId,
					manageableSeasonOwners: mOwners,
					manageableSeasonEditors: mEditors
				}) => {
					if (thisRequest !== requestId) return; // superseded by a newer selection
					agendaItems = upcoming;
					agendaLoading = false;
					recentItems = recent;
					// #132/T2 — the full season list, for the page-level consumers listed
					// on the `seasons` declaration above. No extra fetch.
					seasons = fullSeasons;

					// #90 TR.2 / #91 TR.3 — the Works element on every row, plus the
					// management surface on top of it. Resolved HERE (not in a parallel
					// branch above) because it needs the event ids and the current
					// season id the agenda load just produced. Supplementary: a
					// rejection leaves rows work-free, it never fails the agenda.
					const worksCfg = { db: current.db, token: getToken() ?? '' };
					const events = [...upcoming, ...recent];
					const eventIds = events.map((item) => item.id);
					currentSeasonId = seasonId;
					// #91 review F1 — rights are PURE COMPUTATION on the season/event
					// reads that already happened (they now carry `_owner`/`_editor`).
					// The old shape fired one rights GET per agenda event — up to ~500
					// concurrent requests, for every member including plain singers who
					// will never see a control — and held the works load hostage to
					// them, because `includeInactive` depended on the answer.
					seasonManageRights =
						seasonId === null
							? 'not-editor'
							: manageRightsFrom(seasonOwners, seasonEditors, personId);
					// #277 — the per-season entry-point candidate set: every NOT-LAPSED
					// season in `fullSeasons`, union the automatic pick (`mSeasonId`)
					// itself so the existing lapsed-only-collective fallback (#167)
					// keeps its one entry even though it fails the not-lapsed test
					// below. `conductorLogic.ts` is untouched — this is a page-local,
					// per-season generalisation of the SAME lapsed comparison
					// `manageableSeason` already makes for its single pick.
					const nowDateOnly = new Date().toISOString().slice(0, 10);
					const candidateSeasons = fullSeasons.filter(
						(s) => s.id === mSeasonId || s.endDate === '' || s.endDate >= nowDateOnly
					);
					// Rights are `manageRightsFrom` again, this time against EACH
					// candidate's OWN owners/editors — never carried over from another
					// season (criterion 4: rights are re-derived per season).
					const nextManageableRightsById: Record<string, ManageRightsState> = {};
					for (const s of candidateSeasons) {
						nextManageableRightsById[s.id] = manageRightsFrom(s.owners, s.editors, personId);
					}
					manageableSeasonRightsById = nextManageableRightsById;
					// #167 — the ADMIN's season: the automatic pick (current-if-running,
					// else the soonest future one), NOT the viewer's current season. This
					// is what lets event/series creation controls survive creating a
					// season that has not started yet.
					//
					// #277 review F1 — with ONE exception, which is the whole point of
					// `keepSeasonManage`: a reload that keeps the panel open keeps the
					// season that panel is managing (`heldSeasonId`), and re-derives its
					// rights from THIS reload's own per-season answers — never
					// overwriting the id, which repointed the open panel at the automatic
					// pick while its fields, rows and label still described the season
					// the operator opened. The held season is kept only while the reload
					// still admits it as a candidate; if it is gone (deleted elsewhere,
					// or lapsed out of the set) the panel has no subject left, so the
					// automatic pick takes over behind a FULL teardown — no field, row or
					// armed delete of the vanished season may survive under another
					// season's heading.
					const keptSeasonId =
						heldSeasonId !== null && candidateSeasons.some((s) => s.id === heldSeasonId)
							? heldSeasonId
							: null;
					// The teardown is `resetSeasonManage` — see its `panelRepertoire`
					// block, which names this branch as its ONE `keepSeasonManage`
					// caller.
					if (keptSeasonId !== null) {
						manageableSeasonId = keptSeasonId;
						manageableSeasonRights = nextManageableRightsById[keptSeasonId] ?? 'not-editor';
					} else {
						if (heldSeasonId !== null) {
							resetSeasonManage();
							// The series form belongs to the season it was opened in (the
							// `openSeasonManagePanelFor` twin, #132/T6 review F3): the panel
							// that hosts it just went, so unmount it rather than leave a
							// form whose `seriesCreateSeasonId` names a season this page no
							// longer manages. UNMOUNT only — `restoreSeriesCreateRun` below
							// still decides what happens to any resume record.
							closeSeriesCreateForm();
						}
						manageableSeasonId = mSeasonId;
						manageableSeasonRights =
							mSeasonId === null ? 'not-editor' : manageRightsFrom(mOwners, mEditors, personId);
					}
					// #138 review F2 — the first moment THIS db's own season data is on
					// hand, which is what `restoreSeriesCreateRun` needs to re-open the
					// panel + form for a run that stopped here before the viewer left.
					// Without it, returning to such a collective shows a silently dead
					// set of create buttons (blocked by the surviving resume record) and
					// no way out of it.
					restoreSeriesCreateRun();
					// #132/T2 review F3 — the season-CREATE gate needs its OWN rights
					// signal. `seasonManageRights` is about managing the CURRENT season's
					// repertoire, so it is 'not-editor' whenever no season is running —
					// which is exactly when a season most needs creating (a collective
					// with none yet; a season that lapsed yesterday). See
					// `deriveSeasonCreateRights` for the ladder.
					seasonCreateRights = deriveSeasonCreateRights(
						seasonId,
						seasonOwners,
						seasonEditors,
						fullSeasons,
						personId
					);
					eventManageRights = Object.fromEntries(
						events.map((item) => [item.id, manageRightsFrom(item.owners, item.editors, personId)])
					);
					loadWorksAndManagement(worksCfg, eventIds, seasonId, thisRequest);
					loadScheduleItems(worksCfg, eventIds, thisRequest);
					// ── the DATABASE-entity rights fallback (#167 review F2/F3) ────
					//
					// Rights props live in the private bucket (#91): a viewer with no
					// grant ON THE SEASON reads NO `_owner`/`_editor` at all — the same
					// empty answer whether they are a plain singer or the database's
					// `_owner` whose grant simply never got copied onto the season (the
					// Mihkel case, #167 cause 2). Where the page's own reads carry no
					// visible answer, the database entity is asked instead — ONCE per
					// (db, person) (`loadDatabaseEntityRights` memoises), and its one
					// answer feeds EVERY signal that was left unanswered, so the page
					// cannot render "you may create events here" next to "you may not
					// manage this season's repertoire" for the same person.
					//
					// Fail-closed throughout: only an explicit 'editor' opens anything;
					// 'not-editor', 'error' and a rejection all leave the gates shut.
					const currentRightsInvisible =
						seasonId !== null && seasonOwners.length === 0 && seasonEditors.length === 0;
					// Step 3 of `deriveSeasonCreateRights`' ladder: no current season
					// AND no season at all to borrow rights from — the brand-new
					// collective, where the FIRST season must be creatable in-app.
					const noSeasonToBorrowFrom = seasonId === null && fullSeasons.length === 0;
					// #277 — every CANDIDATE season whose own owners/editors came back
					// empty. The automatic pick's own invisible-rights case (#167's
					// `manageableRightsInvisible`) is exactly ONE instance of this:
					// `manageableSeason` returns an element OF `fullSeasons`, so
					// `mOwners`/`mEditors` ARE that season's own arrays and `mSeasonId`
					// is always itself a candidate. Generalised to the whole per-season
					// entry set so the probe's promotion below can reach every one of
					// them, not only the season the automatic pick happened to land on.
					const invisibleCandidateSeasons = candidateSeasons.filter(
						(s) => s.owners.length === 0 && s.editors.length === 0
					);
					// `currentRightsInvisible` is a trigger in its OWN right (#167 review
					// round 2, F2), not merely a consequence to act on inside the branch.
					// The manageable and the current season are DIFFERENT entities
					// whenever the current one has lapsed (review F1), and they were
					// created at different moments — so the newer one can carry the
					// viewer's `_owner`/`_editor` while the older one carries none. Gating
					// the probe on the manageable season alone then produced exactly the
					// contradiction this block exists to prevent: [+ Event] and the gear
					// rendered against a dead repertoire surface for the current season.
					if (
						invisibleCandidateSeasons.length > 0 ||
						currentRightsInvisible ||
						noSeasonToBorrowFrom
					) {
						loadDatabaseEntityRights(worksCfg, personId).then((state) => {
							if (thisRequest !== requestId) return;
							if (state !== 'editor') return;
							// #277 — this promotion is COLLECTIVE-LEVEL, not season-specific:
							// the database entity's own `_owner`/`_editor` is a rights layer
							// separate from (and additive to) any one season's own
							// direct/inherited grant (ER-7,
							// docs/architecture/entu-rights-and-visibility-model.md) — so
							// ONE 'editor' answer here promotes EVERY candidate season whose
							// own rights came back invisible, not just the
							// automatically-picked one.
							if (invisibleCandidateSeasons.length > 0) {
								manageableSeasonRightsById = {
									...manageableSeasonRightsById,
									...Object.fromEntries(
										invisibleCandidateSeasons.map(
											(s) => [s.id, 'editor'] as [string, ManageRightsState]
										)
									)
								};
							}
							// Rights on the database entity are rights over the whole
							// collective — every gate whose own read came back blank.
							// #277 review F1 — read off the map this promotion just wrote,
							// keyed to the season actually IN PLAY: a panel-preserving reload
							// keeps the OPERATOR's season, which need not be `mSeasonId`, so
							// promoting `mSeasonId`'s answer onto it would light (or leave
							// dark) the wrong season's controls. Fail-closed as before: only
							// an 'editor' answer in the map opens anything.
							if (
								manageableSeasonId !== null &&
								manageableSeasonRightsById[manageableSeasonId] === 'editor'
							) {
								manageableSeasonRights = 'editor';
							}
							seasonCreateRights = 'editor';
							if (currentRightsInvisible && seasonManageRights !== 'editor') {
								seasonManageRights = 'editor';
								// `loadWorksAndManagement` has already run under the
								// 'not-editor' answer: no pickers, no season repertoire, and
								// the works read filtered to active rows. Re-run exactly
								// those three (`refreshWorksAfterWrite`'s work) now that the
								// answer has changed.
								upgradeRepertoireManagement(worksCfg, eventIds, seasonId, thisRequest);
							}
						});
					}
					// Conductor event IDs: pure computation on already-loaded data (no IO).
					const ids = computeConductorEventIds(personId, seasonConductors, recent);
					conductorEventIds = ids;
					// F3 fix — wire isConductor from the broader signal: a season conductor
					// IS a conductor even before any past events exist this season (the
					// per-event Set gates rows; this store is the coarser "is a conductor
					// at all" signal for TA.3).
					isConductor.set(
						ids.size > 0 || seasonConductors.includes(personId) ? 'conductor' : 'not-conductor'
					);
				}
			)
			.catch((err) => {
				// M2 fix: without this catch, a rejected load left agendaLoading
				// stuck at true forever — permanent skeleton, no error, no recovery.
				if (thisRequest !== requestId) return;
				agendaLoading = false;
				// #107 — a session-expired rejection is truthfully a DIFFERENT state
				// than "couldn't load": a Retry against a dead token can never
				// succeed, so it must not render alongside/instead of the generic
				// error+retry affordance.
				if (isAuthExpiredError(err)) {
					sessionExpired = true;
				} else {
					agendaError = true;
				}
				recentItems = [];
				conductorEventIds = new Set();
				worksByEventId = {};
				scheduleByEventId = {};
				resetManagement();
				// #288 review F1 — the agenda load FAILED, so neither the picker read
				// nor the row read is ever dispatched for this cycle and nothing else
				// would flip `resetManagement`'s two loading flags back off. Leaving
				// them true froze the sticky visibility map for the rest of the page's
				// life: a Retry that succeeded then re-derived rows and pickers that
				// the effect was no longer allowed to read. Blank-and-settled is the
				// truth here, and the effect resolving over it is correct.
				libraryPickersLoading = false;
				worksRowsLoading = false;
				resetConductor();
				resetSeasonManage();
				seasons = [];
			});

		findMyMemberId({ db: current.db, token: getToken() ?? '' }, personId)
			.then((id) => {
				if (thisRequest !== requestId) return;
				// A genuine resolution: an id -> member; null -> CONFIRMED non-member.
				memberId = id;
				membership = id ? 'member' : 'non-member';
				// #85 TA.4 — my own attendance, ONE call keyed by my member id (not
				// per-event). A non-member/failed lookup simply has no records.
				if (id) {
					listMyAttendance({ db: current.db, token: getToken() ?? '' }, id)
						.then((result) => {
							if (thisRequest !== requestId) return;
							myAttendance = result.items;
							// #321 — the member's OWN attendance-lifetime read; a truncated
							// page means the "my attendance" line and its season-summary
							// rate are both incomplete. Notice: attendance-partial-notice.
							attendancePartial = result.truncated;
						})
						.catch(() => {
							if (thisRequest !== requestId) return;
							myAttendance = [];
							attendancePartial = false;
						});
				} else {
					myAttendance = [];
					attendancePartial = false;
				}
			})
			.catch(() => {
				if (thisRequest !== requestId) return;
				// Lookup FAILED — do NOT assert non-member. Stay unresolved (disabled,
				// no false hint) and fail safe.
				memberId = null;
				membership = 'loading';
			});

		listMyRsvps({ db: current.db, token: getToken() ?? '' }, personId)
			.then((result) => {
				if (thisRequest !== requestId) return;
				rsvpByEventId = rsvpsByEventId(result.items);
				// #321 — the singer's OWN rsvp-lifetime read; a truncated page means an
				// event this agenda shows as "unanswered" may have a real answer beyond
				// the cap. Notice: rsvp-partial-notice.
				rsvpPartial = result.truncated;
			})
			.catch(() => {
				if (thisRequest !== requestId) return;
				rsvpByEventId = {};
				rsvpPartial = false;
			});
	}

	// #15 — the write-orchestration itself (per-event pending guard, coalescing-
	// free disable, per-event optimistic/reconcile/revert) lives in
	// rsvpChangeQueue.ts; created once for the page's lifetime. Every callback
	// here touches ONLY the one event it's given — no whole-map operation, which
	// is exactly what let the old inline handleRsvpChange's failure-revert
	// clobber a different event's concurrent, still-in-flight state (#15 root
	// cause #2). Reassign (not mutate) rsvpByEventId/pendingEventIds per Svelte 5
	// runes.
	const rsvpQueue = createRsvpChangeQueue({
		setOptimistic(eventId, entry) {
			const next = { ...rsvpByEventId };
			if (entry) next[eventId] = entry;
			else delete next[eventId];
			rsvpByEventId = next;
		},
		setPending(eventId, isPending) {
			const next = new Set(pendingEventIds);
			if (isPending) next.add(eventId);
			else next.delete(eventId);
			pendingEventIds = next;
			// A fresh write starting for this event clears any stale failure marker
			// from a previous attempt — the user is trying again.
			if (isPending && failedEventIds.has(eventId)) {
				const cleared = new Set(failedEventIds);
				cleared.delete(eventId);
				failedEventIds = cleared;
			}
			// #326 — and any stale SAVED cue from a previous, now-superseded write:
			// the cue always describes the latest write, never a settled earlier one.
			if (isPending && savedEventIds.has(eventId)) {
				const cleared = new Set(savedEventIds);
				cleared.delete(eventId);
				savedEventIds = cleared;
			}
		},
		reconcile(eventId, entry) {
			const next = { ...rsvpByEventId };
			if (entry) next[eventId] = entry;
			else delete next[eventId];
			rsvpByEventId = next;
			// #326 — the write settled: this event's row earns the saved cue. A
			// reconciled NULL (a cleared answer) announces too — it renders
			// identically to never-answered, so the cue is the only distinguisher.
			const saved = new Set(savedEventIds);
			saved.add(eventId);
			savedEventIds = saved;
		},
		revert(eventId, before) {
			const next = { ...rsvpByEventId };
			if (before) next[eventId] = before;
			else delete next[eventId];
			rsvpByEventId = next;
			// The write failed — mark this event so its row surfaces an inline error
			// (the value just reverted, otherwise the answer would snap back silently).
			const failed = new Set(failedEventIds);
			failed.add(eventId);
			failedEventIds = failed;
			// #326 — failure and saved are mutually exclusive: a stale saved cue
			// (already cleared by setPending at this attempt's start in practice)
			// must not survive a failed write either way.
			if (savedEventIds.has(eventId)) {
				const cleared = new Set(savedEventIds);
				cleared.delete(eventId);
				savedEventIds = cleared;
			}
		}
	});

	// The onrsvpchange handler: resolves cfg/personId/the current pre-tap value
	// for this event, then hands off to the queue. All the optimistic-set /
	// pending / reconcile / revert mechanics live in the callbacks above — this
	// is just the adapter from AgendaList's callback shape to the queue's.
	function handleRsvpChange(item: AgendaItem, newStatus: RsvpStatus | null) {
		if (!selected) return;
		const cfg = { db: selected.db, token: getToken() ?? '' };
		const personId = selected.personId;

		const current: RsvpEntry | undefined = rsvpByEventId[item.id];
		const existing: MyRsvp | null = current
			? { rsvpId: current.rsvpId, eventId: item.id, status: current.status }
			: null;

		rsvpQueue.request({ cfg, personId, memberId, eventId: item.id, existing, newStatus });
	}

	// #90 TR.2 — the PDF download, signed AT CLICK TIME. Entu's signed S3 url is
	// valid for 60 seconds (entu-www src/api/files/index.md), so it can never be
	// resolved at agenda load and parked in an href; RepertoireElement hands up
	// the file property id instead and this signs it now.
	//
	// The blank tab is opened SYNCHRONOUSLY, inside the click's user-gesture
	// window — a window.open() issued after the signing await is swallowed by
	// popup blockers. If the blocker took it anyway (tab === null) we navigate
	// the current tab rather than silently dropping the download.
	function handlePdfClick(fileId: string) {
		if (!selected) return;
		const cfg = { db: selected.db, token: getToken() ?? '' };
		pdfError = false;
		const tab = window.open('', '_blank');
		if (tab) tab.opener = null;
		signFileUrl(cfg, fileId)
			.then((url) => {
				if (tab) tab.location.href = url;
				else window.location.href = url;
			})
			.catch(() => {
				tab?.close();
				pdfError = true;
			});
	}


	// ── #91 TR.3 — repertoire / programme management ──────────────────────────
	//
	// The wiring the branch was missing. Shape mirrors the RSVP and attendance
	// precedents: the page owns the reads, the rights, the optimistic local
	// mutation and its inverse; repertoireActions owns the wire calls; the queue
	// owns the pending guard and the settle path; RepertoireElement only renders
	// controls and forwards taps.

	function resetManagement() {
		currentSeasonId = null;
		seasonManageRights = 'not-editor';
		manageableSeasonId = null;
		manageableSeasonRights = 'not-editor';
		manageableSeasonRightsById = {};
		seasonCreateRights = 'not-editor';
		eventManageRights = {};
		seasonRepertoire = [];
		libraryWorks = [];
		libraryEditions = [];
		// #321 — the claims go with the lists they describe.
		libraryWorksPartial = false;
		libraryEditionsPartial = false;
		// #329 review — the scoped per-work answers belong to the collective they
		// were read from, and so does the "already asked" guard: dropping only the
		// map would leave the guard vetoing every re-read after a switch.
		scopedEditionsByWorkId = {};
		scopedEditionWorkIdsRequested = new Set<string>();
		// #288 — flips true in the SAME synchronous pass that blanks the two
		// arrays above, so the `pickableEditionsVisibleByEventId` effect never
		// observes them blanked while still reading `libraryPickersLoading` as
		// its own stale (pre-reload) `false` — which would make it recompute
		// the sticky map off a momentarily-empty picker source and wipe every
		// entry. `loadWorksAndManagement` is what flips it back once it knows
		// whether a fetch is even coming (rights-gated: someone with no manage
		// rights anywhere never calls `loadManagePickers`, so nothing else
		// would ever flip this back).
		libraryPickersLoading = true;
		// #311 — same synchronous pass: the sticky `pickableWorksVisible` effect
		// must not treat this reload's now-blanked `libraryWorks`/
		// `seasonRepertoire` as a genuine settle before the fetch it is about
		// to dispatch (or, on the deselect/agenda-failure paths, EVER dispatch)
		// has had its own say.
		libraryPickersLoadSucceeded = false;
		// #288 review F1 — the row source's twin, flipped in the same synchronous
		// pass for the same reason. Every caller that reaches `resetManagement`
		// has just blanked `worksByEventId` (the deselect path, the main
		// `loadForSelected` body, the agenda-load rejection), and the refill —
		// where one comes at all — is `loadWorksByEventId`, which settles
		// independently of the pickers. Cleared by whichever works read holds the
		// newest `worksLoadId` ticket when it settles, or explicitly by the two
		// paths above where no works read follows at all.
		worksRowsLoading = true;
		managePendingKeys = new Set();
		manageError = false;
		// #234 review 2 F1 — the panel's own repertoire state is NOT reset here.
		// `resetManagement` runs on EVERY `loadForSelected`, including the
		// panel-preserving `{ keepSeasonManage: true }` reloads, and the section is
		// only ever (re)loaded on a panel OPEN: clearing it here blanked the section
		// (reading as "this season has no repertoire") and emptied the add-work
		// select after any panel-side create/delete refresh. It lives in
		// `resetSeasonManage` instead — the panel-LIFETIME reset, which the genuine
		// collective switch still runs.
	}

	type ManageCfg = { db: string; token: string };

	/**
	 * #132/T2 review F3 — "may this viewer create a season here?", answered without
	 * requiring a season to be CURRENT. Ladder, most-specific first:
	 *
	 *   1. a season IS current → its own `_owner`/`_editor` (the #91 derivation)
	 *   2. no current season but the collective HAS seasons → the most recent one's
	 *      rights (they ride along on the list read — zero extra fetch). This is the
	 *      admin who let the season lapse before opening the next one.
	 *   3. no seasons at all → nothing on this page carries rights, so the caller
	 *      falls back to the ORGANIZATION entity (see loadOrgSeasonCreateRights).
	 *      This is the brand-new collective, where the FIRST season has to be
	 *      creatable in-app or #132 has no point at all.
	 *
	 * Fail-closed throughout: absent rights props still mean 'not-editor'.
	 */
	function deriveSeasonCreateRights(
		seasonId: string | null,
		seasonOwners: string[],
		seasonEditors: string[],
		allSeasons: Season[],
		personId: string
	): ManageRightsState {
		if (seasonId !== null) return manageRightsFrom(seasonOwners, seasonEditors, personId);
		// `listSeasons` sorts ascending by startDate, but deriving a RIGHTS gate from
		// a caller's sort order is exactly the kind of silent coupling that breaks
		// quietly — pick the max explicitly.
		const latest = allSeasons.reduce<Season | null>(
			(best, s) => (best === null || s.startDate > best.startDate ? s : best),
			null
		);
		if (!latest) return 'not-editor';
		return manageRightsFrom(latest.owners, latest.editors, personId);
	}

	/**
	 * The in-flight/settled database-entity rights answers, keyed by db + person
	 * (#167 review F3). The probe is a GET PAIR — `resolveDatabaseEntityId`
	 * (uncached by design) then one `entity/{id}?props=_owner,_editor` — and its
	 * trigger, "the season read shows no visible rights", is the NORMAL read for
	 * every non-granted member (#91's rights buckets). Without this memo every
	 * plain singer paid that pair on every agenda load and every collective
	 * switch, for an answer that cannot change between two loads of the same
	 * page; with it, at most one pair per (collective, person) per page life.
	 * The promise itself is cached, so two loads racing share ONE round-trip.
	 */
	const databaseEntityRightsByDbPerson = new Map<string, Promise<ManageRightsState>>();

	/**
	 * "May this person manage things in this collective?", answered by the
	 * DATABASE entity itself (#161, collective = database) — the only entity that
	 * can answer when the page's own season/event reads show no rights at all.
	 * ONE probe feeding every caller, so the season-create gate, the
	 * season-manage gate and the event/series-create gate cannot disagree.
	 *
	 * Never throws: a failed lookup resolves to 'error' (NOT 'not-editor' — a
	 * blip must not read as a verdict), which callers treat as no grant. A
	 * failure is deliberately NOT memoised, so the next load retries.
	 */
	function loadDatabaseEntityRights(cfg: ManageCfg, personId: string): Promise<ManageRightsState> {
		const key = `${cfg.db}::${personId}`;
		const cached = databaseEntityRightsByDbPerson.get(key);
		if (cached) return cached;
		const probe = resolveDatabaseEntityId(cfg)
			.then((dbEntityId) =>
				dbEntityId === null
					? // No database entity readable — an ANSWER ("this reader cannot see
						// the collective entity"), not a failure: nothing to grant on.
						Promise.resolve<ManageRightsState>('not-editor')
					: resolveManageRights(cfg, dbEntityId, personId)
			)
			.catch((e): ManageRightsState => {
				console.error('agenda: resolving database entity rights failed', e);
				return 'error';
			})
			.then((state) => {
				if (state === 'error') databaseEntityRightsByDbPerson.delete(key);
				return state;
			});
		databaseEntityRightsByDbPerson.set(key, probe);
		return probe;
	}

	/**
	 * The repertoire-management reads `loadWorksAndManagement` skipped because,
	 * at the moment it ran, `seasonManageRights` was still 'not-editor' (#167
	 * review F2 — the database-entity answer arrives later). Exactly the three
	 * reads `refreshWorksAfterWrite` does for a rights-holder: the pickers, the
	 * season repertoire (via `loadManagePickers`) and the UNFILTERED works read.
	 */
	function upgradeRepertoireManagement(
		cfg: ManageCfg,
		eventIds: string[],
		seasonId: string | null,
		thisRequest: number
	) {
		loadManagePickers(cfg, seasonId, thisRequest);
		const thisWorksLoad = ++worksLoadId;
		// #288 review F1 — this dispatch takes the newest `worksLoadId` ticket, so
		// the first load's settle will no longer clear `worksRowsLoading`: this one
		// owns the flag from here on, and must both raise it (the rows are being
		// replaced under the upgraded rights) and clear it on either outcome.
		worksRowsLoading = true;
		loadWorksByEventId(cfg, eventIds, seasonId, fetch, { includeInactive: true })
			.then((byEvent) => {
				if (thisRequest !== requestId || thisWorksLoad !== worksLoadId) return;
				worksByEventId = mergePendingRows(byEvent);
				worksRowsLoading = false;
			})
			.catch(() => {
				/* keep the filtered rows the first load produced */
				if (thisRequest !== requestId || thisWorksLoad !== worksLoadId) return;
				worksRowsLoading = false;
			});
	}

	/**
	 * The works load, and (for a rights-holder) the picker sources.
	 *
	 * Rights are already known by the time this runs — the caller derived them
	 * from `_owner`/`_editor` on the season and event reads the agenda load
	 * already made (#91 review F1). That matters twice over: no per-entity rights
	 * fanout, and no serialization — `includeInactive` is known at the same
	 * instant `seasonId` is, so the read-only agenda's Works elements appear as
	 * early as they did before management existed.
	 *
	 * A rights-holder reads the repertoire UNFILTERED (`includeInactive`): the
	 * member-facing active/learning filter is what made the status toggle one-way
	 * — set a work to retired and its row (with it the only toggle that could
	 * bring it back) vanished, while `pickableWorks` refuses to re-offer a work
	 * that already has a repertoire_item.
	 */
	function loadWorksAndManagement(
		cfg: ManageCfg,
		eventIds: string[],
		seasonId: string | null,
		thisRequest: number
	) {
		const canManage =
			seasonManageRights === 'editor' ||
			Object.values(eventManageRights).some((right) => right === 'editor');
		if (canManage) {
			loadManagePickers(cfg, seasonId, thisRequest);
		} else {
			// #288 — nothing else will ever flip `resetManagement`'s synchronous
			// `libraryPickersLoading = true` back off for this cycle: without
			// this, a viewer with no manage rights anywhere would freeze the
			// sticky visibility map (harmlessly for them — the control never
			// renders without rights — but permanently, and wrongly, for
			// anyone who gains rights later without a full page reload).
			libraryPickersLoading = false;
		}

		const thisWorksLoad = ++worksLoadId;
		// #288 review F1 — already true from `resetManagement`; re-asserted here so
		// the raise sits next to the read that owns it and survives any future
		// caller that reaches this function without the reset.
		worksRowsLoading = true;
		loadWorksByEventId(cfg, eventIds, seasonId, fetch, {
			includeInactive: seasonManageRights === 'editor'
		})
			.then((byEvent) => {
				if (thisRequest !== requestId || thisWorksLoad !== worksLoadId) return;
				worksByEventId = byEvent;
				worksRowsLoading = false;
			})
			.catch(() => {
				if (thisRequest !== requestId || thisWorksLoad !== worksLoadId) return;
				worksByEventId = {};
				worksRowsLoading = false;
			});
	}

	/**
	 * #262 — the schedule_item bulk read for the agenda's compact times line
	 * (Gama's amendment + row-family ruling 5558026158): ONE
	 * `listScheduleItemsByEventId` pass over every VISIBLE event id — upcoming
	 * AND recent, exactly like `loadWorksAndManagement`'s own `eventIds` — under
	 * its own load-id ticket composed with the shared `requestId` (the same
	 * `worksLoadId` idiom, its own counter so this read's staleness rule never
	 * gates the unrelated works read racing it). Supplementary: a rejection
	 * leaves every row schedule-free rather than failing the agenda.
	 */
	function loadScheduleItems(cfg: ManageCfg, eventIds: string[], thisRequest: number) {
		const thisScheduleLoad = ++scheduleLoadId;
		listScheduleItemsByEventId(cfg, eventIds, fetch)
			.then((byEvent) => {
				if (thisRequest !== requestId || thisScheduleLoad !== scheduleLoadId) return;
				scheduleByEventId = byEvent;
			})
			.catch(() => {
				if (thisRequest !== requestId || thisScheduleLoad !== scheduleLoadId) return;
				scheduleByEventId = {};
			});
	}

	/** The picker sources — only fetched for someone who can actually write. */
	function loadManagePickers(cfg: ManageCfg, seasonId: string | null, thisRequest: number) {
		// #288 — flips true for the WINDOW this specific fetch is in flight;
		// `pickableEditionsVisibleByEventId`'s own effect (below, near its
		// declaration) re-decides visibility only once this goes false again AND
		// `worksRowsLoading` — the row source's twin flag — has too (#288 review
		// F1: this read is one of TWO the decision depends on).
		libraryPickersLoading = true;
		Promise.all([
			listWorks(cfg),
			listAllEditions(cfg),
			seasonId === null ? Promise.resolve<RepertoireItem[]>([]) : listRepertoireItems(cfg, seasonId)
		])
			.then(([worksRead, editionsRead, repertoire]) => {
				if (thisRequest !== requestId) return;
				// #321 (PO ruling 2026-09-11) — each picker states its OWN feed's
				// truncation; "an option is missing from the picker" is exactly the
				// false absence the ruling names, not a lesser degradation.
				libraryWorks = worksRead.items;
				libraryEditions = editionsRead.items;
				libraryWorksPartial = worksRead.truncated;
				libraryEditionsPartial = editionsRead.truncated;
				seasonRepertoire = repertoire;
				libraryPickersLoading = false;
				// #311 — the ONE place this flips true: a load that reached here
				// completed SUCCESSFULLY. The sticky effect (below, near
				// `pickableWorksList`) reads this alongside `libraryPickersLoading`
				// before it will recompute `pickableWorksVisible`.
				libraryPickersLoadSucceeded = true;
			})
			.catch(() => {
				if (thisRequest !== requestId) return;
				// Empty pickers, not a broken page: the row controls still work.
				libraryWorks = [];
				libraryEditions = [];
				// #321 — a failed read says nothing about completeness, and there are
				// no options left for a claim to be about.
				libraryWorksPartial = false;
				libraryEditionsPartial = false;
				seasonRepertoire = [];
				libraryPickersLoading = false;
				// #311 — explicit, not just inherited from `resetManagement`'s reset:
				// a failed settle is never mistaken for one that landed, so the
				// sticky effect leaves `pickableWorksVisible` exactly where the last
				// SUCCESSFUL load put it — the catch's own "Empty pickers, not a
				// broken page" choice stands instead of being silently inverted by
				// a naive `!loading` gate.
				libraryPickersLoadSucceeded = false;
			});
	}

	/** The pending-key a reorder of `eventId`'s programme runs under. Keyed on the
	 *  EVENT, not the moved row (#91 review F4): a move is a RENUMBER — the plan
	 *  can rewrite any row's ordinal — so a per-row key is finer than the write's
	 *  blast radius and lets a second move start a concurrent write to a row the
	 *  first one is already writing. */
	const reorderKey = (eventId: string) => `move:${eventId}`;

	/**
	 * A refetch is authoritative for everything EXCEPT the keys with a write
	 * still in flight — for those, the server has not seen the change yet, so its
	 * answer is stale by construction. Merge it UNDER the live rows for those
	 * keys, exactly as the attendance panel does for pending members (#77 F2).
	 *
	 * Without this, settling write B refetched over the optimistic value of
	 * still-in-flight write A: A's badge snapped back to its old value while A's
	 * own control was still disabled, then flipped again when A landed — the
	 * editor watched her change get undone and silently re-applied.
	 *
	 * A pending row with NO live counterpart was optimistically REMOVED (a delete
	 * in flight); it stays removed rather than being resurrected by the stale
	 * response.
	 */
	function mergePendingRows(byEvent: Record<string, WorkRow[]>): Record<string, WorkRow[]> {
		const merged: Record<string, WorkRow[]> = {};
		for (const [eventId, rows] of Object.entries(byEvent)) {
			const reorderPending = repertoireQueue.isPending(reorderKey(eventId));
			const live = worksByEventId[eventId] ?? [];
			const out: WorkRow[] = [];
			for (const row of rows) {
				// The queue is the authority on what is in flight — not the display
				// set, which also carries the reorder's marks.
				const pending =
					repertoireQueue.isPending(row.id) || (reorderPending && row.kind === 'program');
				if (!pending) {
					out.push(row);
					continue;
				}
				const liveRow = live.find((r) => r.id === row.id);
				if (liveRow) out.push(liveRow);
			}
			merged[eventId] = out;
		}
		return merged;
	}

	/** Re-read what a settled write changed. The rows are a JOIN over four
	 *  collections (works + editions + copies + one program_item read per event),
	 *  so this is expensive — see the queue's `reconcile` for when it is actually
	 *  worth paying. A create's server-assigned id exists nowhere else, and a
	 *  FAILED write needs the truth on screen rather than a stale local fiction. */
	function refreshWorksAfterWrite() {
		if (!selected) return;
		const cfg = { db: selected.db, token: getToken() ?? '' };
		const eventIds = [...agendaItems, ...recentItems].map((item) => item.id);
		const seasonId = currentSeasonId;
		const thisRequest = requestId;
		const thisWorksLoad = ++worksLoadId;
		loadWorksByEventId(cfg, eventIds, seasonId, fetch, {
			includeInactive: seasonManageRights === 'editor'
		})
			.then((byEvent) => {
				if (thisRequest !== requestId || thisWorksLoad !== worksLoadId) return;
				worksByEventId = mergePendingRows(byEvent);
				// #288 review F1 — this re-read does NOT raise `worksRowsLoading` (it
				// blanks nothing: the optimistic rows stay on screen throughout, so
				// there is no empty window to hold the sticky map across). But it DOES
				// take the newest `worksLoadId` ticket, which silences an in-flight
				// reload's own settle — so if one was mid-flight, this settle is the
				// only one left that can hand the flag back.
				worksRowsLoading = false;
			})
			.catch(() => {
				/* keep the optimistic rows; the next load reconciles */
				if (thisRequest !== requestId || thisWorksLoad !== worksLoadId) return;
				worksRowsLoading = false;
			});
		if (seasonId !== null && seasonManageRights === 'editor') {
			listRepertoireItems(cfg, seasonId)
				.then((items) => {
					if (thisRequest !== requestId) return;
					seasonRepertoire = items;
				})
				.catch(() => {
					/* the picker keeps its previous exclusion set */
				});
		}
	}

	// Extra keys a write should ALSO show as pending. A reorder renumbers a whole
	// programme, so every row in it must disable — the queue guards one key, this
	// maps that key onto every row the write can touch.
	const managePendingMarks = new Map<string, string[]>();

	const repertoireQueue = createRepertoireWriteQueue({
		setPending(key, pending) {
			const next = new Set(managePendingKeys);
			for (const mark of [key, ...(managePendingMarks.get(key) ?? [])]) {
				if (pending) next.add(mark);
				else next.delete(mark);
			}
			managePendingKeys = next;
			// A fresh attempt clears the previous failure — she is trying again.
			if (pending) manageError = false;
		},
		reconcile(key) {
			managePendingMarks.delete(key);
			// #234 review 2 F2 — the agenda fallback line and the panel section are
			// two views of the SAME season's repertoire_items whenever the panel's
			// season is the current one. This queue owns the AGENDA side, so it must
			// push into the panel the way `panelQueue` already pushes into the agenda
			// (`refreshWorksAfterWrite`); before #234 both fallback surfaces shared
			// one `seasonRepertoire` and the question could not arise.
			syncPanelRepertoireAfterAgendaWrite();
			// #91 review F3 — only a CREATE needs the server. Its entity id is
			// assigned there and there is no optimistic row to keep; every other
			// write kind (status / pin / ordinal / delete) already holds the
			// authoritative value locally, so a refetch buys nothing and costs the
			// whole four-collection join plus one program_item read per agenda event
			// — ~45 requests per tap on a 40-event season. The next natural agenda
			// load reconciles those.
			if (key === ADD_WORK_KEY || key === ADD_PROGRAMME_KEY) refreshWorksAfterWrite();
		},
		revert(key) {
			// The optimistic mutation has ALREADY been rolled back by the request's
			// own `rollback` hook (queue contract) — this surfaces the failure.
			managePendingMarks.delete(key);
			manageError = true;
			// #234 review 2 F2 — same reason as `reconcile`, and for the same reason
			// the refetch below exists: a failed write leaves the server's truth
			// unknown to BOTH surfaces, not just this one.
			syncPanelRepertoireAfterAgendaWrite();
			// #91 review F5 — and then shows the TRUTH. None of these writes is
			// atomic: `reorderProgramItems` writes program_items sequentially and
			// throws on the first rejection, so earlier writes already landed; each
			// update is itself a GET → POST → DELETE triple. Rolling the UI back
			// without refetching leaves the screen showing an order (or a status)
			// the server does not have, with no way for the editor to notice.
			// mergePendingRows keeps any OTHER in-flight write's optimistic value.
			refreshWorksAfterWrite();
		}
	});

	// ── optimistic row mutations ──────────────────────────────────────────────
	// Every one of these is PER ITEM, never a whole-map set/restore: two writes
	// on different keys can be in flight at once, and a snapshot-and-restore
	// rollback would wipe the other one's optimistic value (#15's root cause #2).

	function mapRows(update: (rows: WorkRow[], eventId: string) => WorkRow[]) {
		const next: Record<string, WorkRow[]> = {};
		for (const [eventId, rows] of Object.entries(worksByEventId)) {
			next[eventId] = update(rows, eventId);
		}
		worksByEventId = next;
	}

	/** A repertoire_item is a child of the SEASON, so the same row can be showing
	 *  on every event that falls back to it — patch them all. */
	function patchRow(itemId: string, patch: Partial<WorkRow>) {
		mapRows((rows) => rows.map((row) => (row.id === itemId ? { ...row, ...patch } : row)));
	}

	function findRow(itemId: string): WorkRow | undefined {
		for (const rows of Object.values(worksByEventId)) {
			const hit = rows.find((row) => row.id === itemId);
			if (hit) return hit;
		}
		return undefined;
	}

	/** Where a row sits right now, per event — enough to put it back exactly if
	 *  the delete fails. */
	function snapshotRow(itemId: string, onlyEventId?: string) {
		const snapshot: Array<{ eventId: string; index: number; row: WorkRow }> = [];
		for (const [eventId, rows] of Object.entries(worksByEventId)) {
			if (onlyEventId !== undefined && eventId !== onlyEventId) continue;
			const index = rows.findIndex((row) => row.id === itemId);
			if (index >= 0) snapshot.push({ eventId, index, row: rows[index] });
		}
		return snapshot;
	}

	function restoreRow(snapshot: Array<{ eventId: string; index: number; row: WorkRow }>) {
		const next = { ...worksByEventId };
		for (const { eventId, index, row } of snapshot) {
			const rows = [...(next[eventId] ?? [])];
			if (rows.some((r) => r.id === row.id)) continue;
			rows.splice(Math.min(index, rows.length), 0, row);
			next[eventId] = rows;
		}
		worksByEventId = next;
	}

	function dropRow(itemId: string, onlyEventId?: string) {
		mapRows((rows, eventId) =>
			onlyEventId !== undefined && eventId !== onlyEventId
				? rows
				: rows.filter((row) => row.id !== itemId)
		);
	}

	function setOrdinals(eventId: string, ordinalById: Map<string, number>) {
		mapRows((rows, id) =>
			id === eventId
				? rows.map((row) =>
						ordinalById.has(row.id) ? { ...row, ordinal: ordinalById.get(row.id)! } : row
					)
				: rows
		);
	}

	// ── handlers (what a tap actually does) ───────────────────────────────────

	function manageCfg(): ManageCfg | null {
		if (!selected) return null;
		return { db: selected.db, token: getToken() ?? '' };
	}

	/** Add a work to the season repertoire. NO optimistic row: the new
	 *  repertoire_item's id is assigned by the server, and a row keyed on a
	 *  placeholder id is exactly the '__optimistic__' trap #15 was about. The
	 *  control disables while the create is in flight and the refetch brings the
	 *  real row. */
	function handleAddWork(workId: string) {
		const cfg = manageCfg();
		const seasonId = currentSeasonId;
		if (!cfg || seasonId === null) return;
		repertoireQueue.request(ADD_WORK_KEY, async () => {
			await createRepertoireItem(cfg, { seasonId, workId });
		});
	}

	function handleStatusChange(itemId: string, status: RepertoireStatus) {
		const cfg = manageCfg();
		const row = findRow(itemId);
		if (!cfg || !row || row.kind !== 'repertoire') return;
		const before = row.status;
		repertoireQueue.request(
			itemId,
			() => updateRepertoireStatus(cfg, itemId, status),
			{
				apply: () => patchRow(itemId, { status }),
				rollback: () => patchRow(itemId, { status: before })
			}
		);
	}

	function handlePinEdition(itemId: string, editionId: string) {
		const cfg = manageCfg();
		const row = findRow(itemId);
		if (!cfg || !row || row.kind !== 'repertoire') return;
		const before = { editionId: row.editionId, editionName: row.editionName };
		const editionName = libraryEditions.find((e) => e.id === editionId)?.name ?? '';
		repertoireQueue.request(
			itemId,
			() => pinEdition(cfg, itemId, editionId),
			{
				// The pinned edition's file/links only arrive with the refetch; the
				// name is what the row shows on tap.
				apply: () => patchRow(itemId, { editionId, editionName }),
				rollback: () => patchRow(itemId, before)
			}
		);
	}

	/**
	 * Remove. WHICH delete this is comes from the row's own `kind`, never from
	 * the surface it was tapped on: an event with no program_items renders the
	 * SEASON repertoire as fallback, so a programme row can be carrying a
	 * repertoire_item id — deleting that as a program_item would destroy the
	 * whole collective's season entry. A row whose kind we cannot read is not
	 * deleted at all.
	 */
	function handleRemoveItem(eventId: string, itemId: string) {
		const cfg = manageCfg();
		const row = worksByEventId[eventId]?.find((r) => r.id === itemId);
		if (!cfg || !row) return;
		if (row.kind === 'program') {
			const snapshot = snapshotRow(itemId, eventId);
			repertoireQueue.request(itemId, () => deleteProgramItem(cfg, itemId), {
				apply: () => dropRow(itemId, eventId),
				rollback: () => restoreRow(snapshot)
			});
			return;
		}
		// repertoire_item — a child of the season, so it leaves every event that
		// was falling back to it. `seasonRepertoire` is the "Add work" exclusion
		// set, so it moves with the row: without the refetch that used to follow
		// every settle (#91 review F3), a removed work would otherwise stay
		// unpickable until the next agenda load.
		const snapshot = snapshotRow(itemId);
		const repertoireBefore = seasonRepertoire;
		repertoireQueue.request(itemId, () => deleteRepertoireItem(cfg, itemId), {
			apply: () => {
				dropRow(itemId);
				seasonRepertoire = seasonRepertoire.filter((item) => item.id !== itemId);
			},
			rollback: () => {
				restoreRow(snapshot);
				seasonRepertoire = repertoireBefore;
			}
		});
	}

	// ── #234 — the season-manage panel's repertoire section (manageableSeasonId
	//    scoped, PO ruling) ──────────────────────────────────────────────────
	// Its own write queue rather than sharing `repertoireQueue`: the two ADD
	// controls (this section's and the agenda fallback's) would otherwise
	// collide on the SAME sentinel key (`ADD_WORK_KEY` is a module-level
	// constant), wrongly disabling one surface's add button while the other's
	// create is in flight. Row-id keys (status/remove) cannot collide (Entu ids
	// are globally unique), but a dedicated queue keeps the whole section's
	// pending/settle wiring in one place.
	//
	// The sentinel is passed DOWN as RepertoireElement's `addWorkKey` (review
	// F3): the component watches that prop, so a key the component never sees
	// leaves the section's select/button permanently enabled — no pending
	// feedback and a dead re-entry guard.
	const PANEL_ADD_WORK_KEY = '__panel_add_work__';

	/** Re-read the panel's own season's repertoire — the authoritative refetch
	 *  a create's server-assigned id needs, and what a failed write reverts to. */
	function refreshPanelRepertoire(): void {
		const cfg = manageCfg();
		// The season the rows on screen were READ for, not `manageableSeasonId` —
		// see `panelRepertoireSeasonId` for why the live id cannot answer this.
		const seasonId = panelRepertoireSeasonId;
		if (!cfg || seasonId === null) return;
		const thisRequest = requestId;
		// #277 review 2 F1 — the season-switch ticket in place of the live
		// `manageableSeasonId !== seasonId` compare this shipped with, for the
		// reason argued at `loadPanelRepertoire`'s own reads: a blank id is a reload
		// in progress, never a switch, so the compare dropped every re-read that
		// resolved inside one; the generation says which it actually was.
		const thisSwitch = seasonManageSwitchGeneration;
		listRepertoireItems(cfg, seasonId)
			.then((items) => {
				if (thisRequest !== requestId || thisSwitch !== seasonManageSwitchGeneration) return;
				panelRepertoire = items;
				// #311 — this re-read is its own successful settle of the SAME
				// input `panelPickableWorksVisible`'s sticky effect watches; a
				// direct-add on the agenda side that leaves nothing left to pick
				// must re-decide visibility here too, not just on the panel's own
				// initial `loadPanelRepertoire`.
				panelRepertoireItemsOk = true;
			})
			.catch(() => {
				/* keep the previous rows; the next open retries */
			});
	}

	/**
	 * #234 review 2 F2 — the OTHER direction of the sync. `panelQueue` already
	 * calls `refreshWorksAfterWrite` so a panel-side write reaches the agenda's
	 * fallback works rows; this is what an AGENDA-side repertoire write owes the
	 * panel section, which holds its own copy of the same rows.
	 *
	 * Without it, with both surfaces open on the same season (the aligned case —
	 * `manageableSeasonId === currentSeasonId`) an agenda-side remove left the
	 * row standing in the panel, whose remove button then DELETEd an already-gone
	 * repertoire_item; and an agenda-side add left the work still offered by
	 * `panelPickableWorksList` (derived from the stale `panelRepertoire`), so a
	 * second Add created a DUPLICATE repertoire_item for the season.
	 *
	 * Cheap enough to run on every settle rather than classify the key: one
	 * `listRepertoireItems` read, only while the panel is open on the very season
	 * the agenda write touched.
	 */
	function syncPanelRepertoireAfterAgendaWrite(): void {
		if (!seasonManageOpen) return;
		if (manageableSeasonId === null || manageableSeasonId !== currentSeasonId) return;
		refreshPanelRepertoire();
	}

	const panelQueue = createRepertoireWriteQueue({
		setPending(key, pending) {
			const next = new Set(panelPendingKeys);
			if (pending) next.add(key);
			else next.delete(key);
			panelPendingKeys = next;
			// A fresh attempt clears the previous failure/saved cue — same rule
			// as the agenda-side queue's own `manageError` above.
			if (pending) {
				panelManageError = false;
				panelManageStatus = '';
			}
		},
		// #234 SYNC — a repertoire_item is a child of the SEASON, so the same row
		// can be showing on an unprogrammed event's fallback works line too.
		// `refreshWorksAfterWrite` (unchanged, existing) re-reads that surface;
		// calling it here is the sync hook, not a change to the per-event
		// handlers themselves.
		reconcile() {
			refreshPanelRepertoire();
			refreshWorksAfterWrite();
			// #324 — the settle itself must say so.
			panelManageStatus = m.repertoire_manage_saved();
		},
		revert() {
			refreshPanelRepertoire();
			refreshWorksAfterWrite();
			// #324 — the panel had NO failure signal at all before this; the
			// agenda-side queue's own `manageError` is the precedent this matches.
			panelManageError = true;
		}
	});

	/** Add a work to the PANEL's season. No optimistic row (create's id is
	 *  server-assigned) — mirrors `handleAddWork`'s reasoning exactly. */
	function handlePanelAddWork(workId: string) {
		const cfg = manageCfg();
		const seasonId = manageableSeasonId;
		if (!cfg || seasonId === null) return;
		panelQueue.request(PANEL_ADD_WORK_KEY, async () => {
			await createRepertoireItem(cfg, { seasonId, workId });
		});
	}

	/**
	 * #277 review 2 F1 — the rollback of a panel repertoire write is a
	 * resolve-writer like `confirmSeasonFieldEdit`'s catch, and needs the same
	 * capture-compare: `createRepertoireWriteQueue` runs `hooks.rollback` on
	 * rejection with no guard of its own, and both rollbacks below restore values
	 * captured from the season that was open at CLICK time. A reject arriving
	 * after the admin switched seasons painted those rows under the new season's
	 * heading — live remove/status controls writing against the OTHER season's
	 * repertoire_item ids — until the following re-read happened to wash them out.
	 * `apply` needs no guard: it runs synchronously inside `request`, before any
	 * switch can intervene. Nor does `handlePanelAddWork`, which has no hooks at
	 * all — its only settle effect is the queue's `reconcile`/`revert`, and those
	 * re-read whatever season `panelRepertoireSeasonId` names.
	 */
	function handlePanelStatusChange(itemId: string, status: RepertoireStatus) {
		const cfg = manageCfg();
		if (!cfg) return;
		const before = panelRepertoire.find((item) => item.id === itemId)?.status;
		if (before === undefined) return;
		const thisSwitch = seasonManageSwitchGeneration;
		panelQueue.request(itemId, () => updateRepertoireStatus(cfg, itemId, status), {
			apply: () => {
				panelRepertoire = panelRepertoire.map((item) =>
					item.id === itemId ? { ...item, status } : item
				);
			},
			rollback: () => {
				if (thisSwitch !== seasonManageSwitchGeneration) return;
				panelRepertoire = panelRepertoire.map((item) =>
					item.id === itemId ? { ...item, status: before } : item
				);
			}
		});
	}

	function handlePanelRemoveItem(itemId: string) {
		const cfg = manageCfg();
		if (!cfg) return;
		const before = panelRepertoire;
		const thisSwitch = seasonManageSwitchGeneration;
		panelQueue.request(itemId, () => deleteRepertoireItem(cfg, itemId), {
			apply: () => {
				panelRepertoire = panelRepertoire.filter((item) => item.id !== itemId);
			},
			rollback: () => {
				if (thisSwitch !== seasonManageSwitchGeneration) return;
				panelRepertoire = before;
			}
		});
	}

	/**
	 * Reorder. BOTH sides of the move are written: setting only the moved item's
	 * ordinal leaves it tied with its neighbour, and listProgramItems' numeric
	 * sort is a no-op for equal keys — the move would visibly do nothing and
	 * repeated moves would pile up duplicate ordinals. planProgramMove returns
	 * the full set of ordinal writes.
	 *
	 * Keyed on the EVENT and marking EVERY row in the programme (#91 review F4).
	 * A move is a renumber whose blast radius is the whole programme, so a
	 * per-row key was finer than the write it guarded: moving B then immediately
	 * moving C issued a SECOND concurrent ordinal write to a row the first move
	 * was already writing (last-write-wins, order undefined), and the first
	 * settle then cleared that row's pending mark — with no reference counting —
	 * re-enabling its buttons mid-write. With one key per programme the queue's
	 * own `if (pending.has(key)) return` makes the second move a no-op while the
	 * first runs, and the whole programme visibly disables, which is the honest
	 * UI anyway.
	 */
	function handleMoveItem(eventId: string, itemId: string, direction: 'up' | 'down') {
		const cfg = manageCfg();
		if (!cfg) return;
		const rows = worksByEventId[eventId] ?? [];
		const items = rows
			.filter((row) => row.kind === 'program')
			.map((row) => ({ id: row.id, ordinal: row.ordinal ?? 0 }));
		const plan = planProgramMove(items, itemId, direction);
		if (plan.length === 0) return; // boundary row, or not in this programme

		const key = reorderKey(eventId);
		managePendingMarks.set(
			key,
			items.map((item) => item.id)
		);
		const before = new Map(
			plan.map((entry) => [entry.id, items.find((i) => i.id === entry.id)?.ordinal ?? 0])
		);
		const after = new Map(plan.map((entry) => [entry.id, entry.ordinal]));
		repertoireQueue.request(key, () => reorderProgramItems(cfg, plan), {
			apply: () => setOrdinals(eventId, after),
			rollback: () => setOrdinals(eventId, before)
		});
	}

	/** Add to tonight's programme. Like "add work", no optimistic row — the
	 *  program_item id comes from the server. One programme add at a time across
	 *  the agenda (ADD_PROGRAMME_KEY is what the controls disable on). */
	function handleAddProgramItem(eventId: string, editionId: string, ordinal: number) {
		const cfg = manageCfg();
		if (!cfg) return;
		repertoireQueue.request(ADD_PROGRAMME_KEY, async () => {
			await createProgramItem(cfg, { eventId, editionId, ordinal });
		});
	}

	// ── derived picker sources ────────────────────────────────────────────────

	// #321/#329 — the pin-edition picker (`work-edition-picker`) is a THIRD
	// closed set over `libraryEditions`, joined here per work. Under a TRUNCATED
	// `listAllEditions` read that join proves nothing about a work it has no row
	// for, so #329 (and its review) splits the row's state three ways:
	//   • matched, or a pin the join can name → a stated FACT, untouched;
	//   • not settled by the join → UNKNOWN wording, the picker stays open, and
	//     this page reads `listEditions(workId)` SCOPED for that one work (the
	//     effect below);
	//   • that scoped read settled COMPLETE → a fact again, whichever way it
	//     came out; truncated against its own cap, it settles nothing.
	// A complete read issues no scoped reads at all: it already IS the fact.
	const editionsByWorkId = $derived.by(() => {
		const map = new Map<string, Edition[]>();
		for (const edition of libraryEditions) {
			const workId = edition.workId ?? '';
			if (workId === '') continue;
			const list = map.get(workId);
			if (list) list.push(edition);
			else map.set(workId, [edition]);
		}
		return map;
	});

	function editionLabel(edition: Edition): string {
		return edition.name || edition.publisher || edition.id;
	}

	/** Per repertoire ROW: the editions of that row's work ("pin edition"). A row
	 *  whose work has no editions gets no entry here — RepertoireElement then
	 *  decides what that means (#329): known-absent hides the control when
	 *  `libraryEditionsPartial` is false; when true the row is UNKNOWN and the
	 *  control stays open while the scoped read below settles it.
	 *  A work with a SCOPED answer uses it verbatim, in preference to the
	 *  collective-wide join: it is the complete list for that one work. */
	const editionOptionsByRowId = $derived.by(() => {
		const out: Record<string, PickerOption[]> = {};
		for (const rows of Object.values(worksByEventId)) {
			for (const row of rows) {
				if (row.kind !== 'repertoire' || row.workId === '' || out[row.id]) continue;
				const options =
					scopedEditionsByWorkId[row.workId] ??
					(editionsByWorkId.get(row.workId) ?? []).map((edition) => ({
						id: edition.id,
						label: editionLabel(edition)
					}));
				if (options.length > 0) out[row.id] = options;
			}
		}
		return out;
	});

	/** The works the scoped read has answered for — a fact again either way. */
	const editionsResolvedWorkIds = $derived(new Set(Object.keys(scopedEditionsByWorkId)));

	/** #329 review — the works still in the unknown state: every one of them owes
	 *  the reader ONE scoped `listEditions` read. Empty under a complete edition
	 *  read, so this costs nothing in the ordinary case. */
	const unknownEditionWorkIds = $derived(
		unresolvedEditionWorkIds(
			Object.values(worksByEventId).flat(),
			editionOptionsByRowId,
			libraryEditionsPartial,
			editionsResolvedWorkIds
		)
	);

	// #329 review — turn "unknown" into a fact. Opening the picker was only half
	// the ruling; without this read its option list would be empty BY
	// CONSTRUCTION and the control could resolve nothing. One request per work
	// (`scopedEditionWorkIdsRequested` is the guard, not a render input), scoped
	// to that work's own children, so it carries a reachable cap where the
	// collective-wide read has none. A failure is left alone: the row keeps the
	// unknown wording rather than acquiring a negative from a read that failed —
	// and so is a read that comes back TRUNCATED against its own cap: recording
	// its rows would make the row a stated fact off the same evidence #329
	// refuses, one layer down.
	// The dispatch set is bounded by the RENDERED repertoire rows, never the
	// library: one request per distinct unknown work, deduped by the requested-
	// set guard above; a later surface that renders more rows joins this
	// dispatch at that same bound (PO ruling, #329 comment 5635111998).
	$effect(() => {
		const workIds = unknownEditionWorkIds;
		if (workIds.length === 0) return;
		const cfg = manageCfg();
		if (!cfg) return;
		const thisRequest = requestId;
		for (const workId of workIds) {
			if (scopedEditionWorkIdsRequested.has(workId)) continue;
			scopedEditionWorkIdsRequested.add(workId);
			listEditions(cfg, workId)
				.then((read) => {
					if (thisRequest !== requestId) return;
					if (read.truncated) return; // partial: unknown stands, same as a failure
					scopedEditionsByWorkId = {
						...scopedEditionsByWorkId,
						[workId]: read.items.map((edition) => ({
							id: edition.id,
							label: editionLabel(edition)
						}))
					};
				})
				.catch(() => {
					// Unknown stands. A read that did not answer is not an absence.
				});
		}
	});

	/** Per EVENT: editions not already on that event's programme, labelled
	 *  "Work - Composer — Edition" (#204) so the picker reads as music rather
	 *  than as ids. */
	const pickableEditionsByEventId = $derived.by(() => {
		const workById = new Map(libraryWorks.map((work) => [work.id, work]));
		const all: PickerOption[] = libraryEditions.map((edition) => {
			const work = workById.get(edition.workId ?? '');
			// Guard on the composed label, not on `work`: a work that exists but
			// carries no usable name/composer yields '' and must not prefix the
			// edition with a dangling " — ".
			const prefix = work === undefined ? '' : workLabel(work);
			return {
				id: edition.id,
				label: prefix === '' ? editionLabel(edition) : `${prefix} — ${editionLabel(edition)}`
			};
		});
		const out: Record<string, PickerOption[]> = {};
		for (const [eventId, rows] of Object.entries(worksByEventId)) {
			const programmed = new Set(
				rows.filter((row) => row.kind === 'program').map((row) => row.editionId)
			);
			out[eventId] = all.filter((option) => !programmed.has(option.id));
		}
		return out;
	});

	// #288 — the STICKY half of `pickableEditionsVisibleByEventId`: re-decide an
	// event's visibility only once BOTH of `pickableEditionsByEventId`'s async
	// sources have settled — never off `pickableEditionsByEventId` alone, which
	// recomputes to `{}` the instant a reload's synchronous reset blanks either
	// of them. `libraryPickersLoading` covers `libraryWorks`/`libraryEditions`
	// (the option list); `worksRowsLoading` covers `worksByEventId` (the per-
	// event KEYS and each event's already-programmed exclusion set). Gating on
	// only one of the two does not close the window, it MOVES it to whichever
	// read settles second — see the `worksRowsLoading` declaration (#288 review
	// F1) for the ordering that made that visible.
	//
	// While either is loading, this leaves every existing entry exactly as it
	// was — an already-visible control stays visible through the window; an
	// event id with no entry yet (never shown) stays absent, which
	// RepertoireElement's own fallback reads as hidden. The reads are all
	// reactive, so the moment the second one settles the effect runs once over
	// two complete sources and writes the real answer.
	$effect(() => {
		if (libraryPickersLoading || worksRowsLoading) return;
		const next: Record<string, boolean> = {};
		for (const [eventId, options] of Object.entries(pickableEditionsByEventId)) {
			next[eventId] = options.length > 0;
		}
		pickableEditionsVisibleByEventId = next;
	});

	const pickableWorksList = $derived(pickableWorks(libraryWorks, seasonRepertoire));

	// #311 — the STICKY half of `pickableWorksVisible`. Gated on BOTH
	// `libraryPickersLoading` (skip mid-load, exactly like the sibling effect
	// above) AND `libraryPickersLoadSucceeded` (skip a settle that FAILED —
	// the trap a `!libraryPickersLoading`-only gate falls into, since the
	// catch clears that flag too). Reactive on `pickableWorksList` itself, not
	// just the load's own settle, so a write that changes `seasonRepertoire`
	// without a full reload — `refreshWorksAfterWrite`'s re-read after a
	// direct Add, or #234's panel→agenda sync — re-decides visibility too,
	// the same way the picker's OPTIONS list already does.
	$effect(() => {
		if (libraryPickersLoading || !libraryPickersLoadSucceeded) return;
		pickableWorksVisible = pickableWorksList.length > 0;
	});

	// #234 — the panel's own row-building, joined against the panel's OWN
	// works/editions/copies reads (review F1: `libraryWorks`/`libraryEditions`
	// are never loaded in the future-only-season case this section exists for —
	// see the state block's doc). `buildWorkRows`/`collectSources` are the exact
	// pure functions `loadWorksByEventId` uses — no parallel row-shaping logic.
	const panelWorkRowSources = $derived(collectSources(panelWorks, panelEditions, panelCopies));
	const panelWorkRows = $derived(
		buildWorkRows({ source: 'repertoire', items: panelRepertoire }, panelWorkRowSources)
	);
	/** "Add work" exclusion set — the PANEL season's repertoire, not
	 *  `seasonRepertoire` (currentSeasonId-scoped): the divergence case is the
	 *  whole reason this section has its own state (see the state block doc). */
	const panelPickableWorksList = $derived(pickableWorks(panelWorks, panelRepertoire));

	// #311 — the STICKY half of `panelPickableWorksVisible`, the panel's
	// version of the main flow's effect just below `pickableWorksList`. Gated
	// on BOTH per-read success flags (never `!panelRepertoireLoading` alone —
	// that also clears on a failed settle) and reactive on
	// `panelPickableWorksList`, so `refreshPanelRepertoire`'s post-write
	// re-read (the #234 agenda→panel sync) re-decides visibility too, not
	// only `loadPanelRepertoire`'s own initial settle.
	$effect(() => {
		if (panelRepertoireLoading || !panelRepertoireItemsOk || !panelWorksSourcesOk) return;
		panelPickableWorksVisible = panelPickableWorksList.length > 0;
	});

	/** Absent entirely for a reader with no rights anywhere — AgendaList then
	 *  renders exactly the read-only agenda it rendered before TR.3. */
	const worksManage = $derived.by<WorksManage | undefined>(() => {
		const anyEventRight = Object.values(eventManageRights).some((right) => right === 'editor');
		if (seasonManageRights !== 'editor' && !anyEventRight) return undefined;
		return {
			seasonRights: seasonManageRights,
			eventRightsByEventId: eventManageRights,
			pickableWorksList,
			pickableWorksVisible,
			pickableWorksPartial: libraryWorksPartial,
			pickableEditionsPartial: libraryEditionsPartial,
			pickableEditionsByEventId,
			pickableEditionsVisibleByEventId,
			editionOptionsByRowId,
			editionsResolvedWorkIds,
			pendingKeys: managePendingKeys,
			onaddwork: handleAddWork,
			onstatuschange: handleStatusChange,
			onpinedition: handlePinEdition,
			onremoveitem: handleRemoveItem,
			onmoveitem: handleMoveItem,
			onaddprogramitem: handleAddProgramItem
		};
	});

	// #84 TA.3 — open/close the inline "Take attendance" panel and load its data
	// on demand. `attendanceRequestId` guards a slow load from clobbering a
	// later open/close/re-open, same shape as `requestId` above.
	function openAttendancePanel(item: AgendaItem) {
		if (!selected) return;
		// Finding 4 hardening: re-check conductor gate locally — the AgendaList
		// render condition is the primary gate, but keeping the invariant here
		// avoids relying solely on a remote Entu rights rejection.
		if (!conductorEventIds.has(item.id)) return;
		attendanceItem = item;
		attendanceLoading = true;
		attendanceError = false;
		attendanceRoster = [];
		attendanceMap = {};
		attendanceRsvpMap = {};
		// Finding 3 fix: restore pending members from the queue's live state for
		// THIS event, so that reopening the same event while a write is in flight
		// correctly shows the toggle as disabled (not enabled-but-swallowed).
		attendancePendingMemberIds = attendanceQueue.pendingMembersForEvent(item.id);
		// Finding 4 fix: restore any failures recorded for this event from the
		// per-event map (a write that failed while the panel was on another event
		// is surfaced when the conductor returns to it).
		attendanceFailedMemberIds = new Set(attendanceFailedByEvent.get(item.id) ?? []);
		// #327 — a saved cue reports a write, never a read: a fresh open (or
		// reopen) starts with no cue at all, even for an event id that already
		// carried one earlier in the session.
		attendanceSavedMemberIds = new Set();

		const cfg = { db: selected.db, token: getToken() ?? '' };
		const thisRequest = ++attendanceRequestId;

		// Finding 5 fix: use cached roster if available and fresh for this
		// collective, otherwise load and cache. Avoids 1+N reads per panel open.
		// Finding 3 fix: TTL-based invalidation so mid-session roster changes
		// (member added/deactivated) surface within ROSTER_CACHE_TTL_MS.
		const rosterPromise = getRoster(cfg);

		// Snapshot the request-time instant so the .then can detect whether any
		// write settled between request issue and list resolve (Finding 2 fix).
		const requestIssuedAt = Date.now();
		Promise.all([rosterPromise, listAttendance(cfg, item.id), listAllRsvpsForEvent(cfg, item.id)])
			.then(([roster, records, rsvps]) => {
				if (thisRequest !== attendanceRequestId) return; // superseded
				attendanceRoster = roster;
				// Finding 2 fix: a stale list response must NOT overwrite members whose
				// write settled (reconciled/reverted) between request issue and list
				// resolve. Skip members currently pending OR already reconciled since
				// thisRequest was issued — merge the server's map UNDER the live map
				// for those members, not over it.
				const pendingMembers = attendanceQueue.pendingMembersForEvent(item.id);
				const serverMap = attendanceByMemberId(records);
				const merged = { ...serverMap };
				// For every member that has an in-flight write OR already has a live
				// value from a reconcile/revert that fired after the list was requested,
				// keep the live value instead of the (stale) server value.
				for (const mid of pendingMembers) {
					if (mid in attendanceMap) merged[mid] = attendanceMap[mid];
					else delete merged[mid];
				}
				// Also preserve any member whose value was reconciled into the live map
				// after this request was issued — detected by the member being present
				// in the live map with a different attendanceId than the server returned.
				for (const mid of Object.keys(attendanceMap)) {
					if (pendingMembers.has(mid)) continue; // already handled
					const liveEntry = attendanceMap[mid];
					const serverEntry = serverMap[mid];
					// A reconciled write that the server hasn't seen yet: the live entry
					// exists but the server either has no record or has a stale id.
					if (liveEntry && (!serverEntry || serverEntry.attendanceId !== liveEntry.attendanceId)) {
						merged[mid] = liveEntry;
					}
				}
				attendanceMap = merged;
				const rsvpMap: Record<string, { rsvpId: string; status: string }> = {};
				for (const r of rsvps) rsvpMap[r.memberId] = { rsvpId: r.rsvpId, status: r.status };
				attendanceRsvpMap = rsvpMap;
				attendanceLoading = false;
			})
			.catch(() => {
				if (thisRequest !== attendanceRequestId) return;
				attendanceLoading = false;
				attendanceError = true;
			});
	}

	function closeAttendancePanel() {
		// #113 fix-forward — `closeAttendancePanel` is called from INSIDE the
		// `selected`-tracking $effect below (via `loadForSelected`'s cleanup
		// path). Reading `attendanceItem` here without `untrack` would make
		// `attendanceItem` itself a dependency of THAT effect — the effect would
		// then re-run (and re-close the panel) the instant `openAttendancePanel`
		// sets `attendanceItem`, closing a panel the very click that opened it.
		const closedItemId = untrack(() => attendanceItem?.id);
		attendanceRequestId++; // invalidate any in-flight load
		attendanceItem = null;
		attendanceLoading = false;
		attendanceError = false;
		if (closedItemId) {
			tick().then(() => {
				document
					.querySelector<HTMLElement>(
						`[data-testid="agenda-recent-row-${closedItemId}"] [data-testid="take-attendance-btn"]`
					)
					?.focus();
			});
		}
	}

	// Same #15 shape as rsvpQueue above, keyed by an eventId:memberId composite
	// instead of event id alone (attendanceChangeQueue.ts doc). Created ONCE for
	// the page lifetime — NOT per panel open.
	//
	// #77 fix-forward (cross-event bleed) — every callback receives `eventId` as
	// its first argument and checks it against `attendanceItem?.id`, THE LIVE
	// CURRENTLY-OPEN EVENT, read fresh at callback-fire time. This replaced a
	// "generation" guard (attendanceQueueGen vs attendanceRequestId) that looked
	// right but was a no-op in practice: both variables were re-synced to the
	// same value on every panel open, so by the time a stale write's callback
	// fired, the comparison always read as "current" — it never actually caught
	// a write that belonged to a previously-open event. Comparing against the
	// live `attendanceItem.id` instead has no such window: a write for event A
	// that resolves after the panel has moved to event B fails the check
	// (`eventId !== attendanceItem.id`) and no-ops, full stop.
	//
	// Duplicate writes on same-event reopen are fixed on the queue side (see
	// attendanceChangeQueue.ts): the pending Set there is now keyed by
	// `eventId:memberId`, so there is no `reset()` call here to (mis)wipe
	// in-flight state for the SAME event on every open — reopening the same
	// event while a write is in flight for it still blocks a duplicate tap.
	const attendanceQueue = createAttendanceChangeQueue({
		setOptimistic(eventId, memberId, entry) {
			if (eventId !== attendanceItem?.id) return;
			const next = { ...attendanceMap };
			if (entry) next[memberId] = entry;
			else delete next[memberId];
			attendanceMap = next;
		},
		setPending(eventId, memberId, isPending) {
			// Clear the per-event failure on fresh write regardless of which event
			// is currently open (symmetric with the revert always-write above).
			if (isPending) {
				const eventFailed = attendanceFailedByEvent.get(eventId);
				if (eventFailed?.has(memberId)) {
					const cleared = new Set(eventFailed);
					cleared.delete(memberId);
					const nextMap = new Map(attendanceFailedByEvent);
					if (cleared.size === 0) nextMap.delete(eventId);
					else nextMap.set(eventId, cleared);
					attendanceFailedByEvent = nextMap;
				}
			}
			if (eventId !== attendanceItem?.id) return;
			const next = new Set(attendancePendingMemberIds);
			if (isPending) next.add(memberId);
			else next.delete(memberId);
			attendancePendingMemberIds = next;
			if (isPending && attendanceFailedMemberIds.has(memberId)) {
				const cleared = new Set(attendanceFailedMemberIds);
				cleared.delete(memberId);
				attendanceFailedMemberIds = cleared;
			}
			// #327 — and any stale SAVED cue from a previous, now-superseded write:
			// the cue always describes the latest write, never a settled earlier one.
			if (isPending && attendanceSavedMemberIds.has(memberId)) {
				const cleared = new Set(attendanceSavedMemberIds);
				cleared.delete(memberId);
				attendanceSavedMemberIds = cleared;
			}
		},
		reconcile(eventId, targetMemberId, entry) {
			// #85 F1 fix: a successful attendance write invalidates the season
			// summary cache so the next expand re-fetches fresh rates. Also patch
			// myAttendance inline when the write was for the singer's own member id
			// — her Recent-row badge should reflect the change immediately.
			seasonRatesLoaded = false;
			if (targetMemberId === memberId) {
				if (entry) {
					// Upsert: replace existing record for this event or append.
					const idx = myAttendance.findIndex((a) => a.eventId === eventId);
					const record = { attendanceId: entry.attendanceId, eventId, status: entry.status };
					if (idx >= 0) {
						const next = [...myAttendance];
						next[idx] = record;
						myAttendance = next;
					} else {
						myAttendance = [...myAttendance, record];
					}
				} else {
					// Deletion: remove the record for this event.
					myAttendance = myAttendance.filter((a) => a.eventId !== eventId);
				}
			}

			if (eventId !== attendanceItem?.id) return;
			const next = { ...attendanceMap };
			if (entry) next[targetMemberId] = entry;
			else delete next[targetMemberId];
			attendanceMap = next;
			// #327 — the write settled: this member's row earns the saved cue. A
			// reconciled NULL (a cleared record) announces too — it renders
			// identically to never-marked, so the cue is the only distinguisher.
			const saved = new Set(attendanceSavedMemberIds);
			saved.add(targetMemberId);
			attendanceSavedMemberIds = saved;
		},
		revert(eventId, targetMemberId, before) {
			// #85 F1 fix: a failed write also invalidates the season summary cache
			// — the optimistic update may have already been visible if the summary
			// was expanded, so stale cached rates must not persist.
			seasonRatesLoaded = false;

			// Finding 4 fix: ALWAYS record the failure in the per-event map, even
			// when the conductor has moved to a different event. This way the
			// failure surfaces when she reopens this event later.
			const eventFailed = new Set(attendanceFailedByEvent.get(eventId) ?? []);
			eventFailed.add(targetMemberId);
			const nextMap = new Map(attendanceFailedByEvent);
			nextMap.set(eventId, eventFailed);
			attendanceFailedByEvent = nextMap;

			// #85 F1 fix: revert myAttendance for the singer's own member id when
			// her attendance write failed — the optimistic value must not stick.
			if (targetMemberId === memberId) {
				if (before) {
					const idx = myAttendance.findIndex((a) => a.eventId === eventId);
					const record = { attendanceId: before.attendanceId, eventId, status: before.status };
					if (idx >= 0) {
						const next = [...myAttendance];
						next[idx] = record;
						myAttendance = next;
					} else {
						myAttendance = [...myAttendance, record];
					}
				} else {
					myAttendance = myAttendance.filter((a) => a.eventId !== eventId);
				}
			}

			// Only update the live panel state if this event is still open.
			if (eventId !== attendanceItem?.id) return;
			const next = { ...attendanceMap };
			if (before) next[targetMemberId] = before;
			else delete next[targetMemberId];
			attendanceMap = next;
			const failed = new Set(attendanceFailedMemberIds);
			failed.add(targetMemberId);
			attendanceFailedMemberIds = failed;
			// #327 — failure and saved are mutually exclusive: a stale saved cue
			// (already cleared by setPending at this attempt's start in practice)
			// must not survive a failed write either way.
			if (attendanceSavedMemberIds.has(targetMemberId)) {
				const cleared = new Set(attendanceSavedMemberIds);
				cleared.delete(targetMemberId);
				attendanceSavedMemberIds = cleared;
			}
		}
	});

	function handleAttendanceToggle(memberId: string, newStatus: AttendanceStatus | null) {
		if (!selected || !attendanceItem) return;
		const cfg = { db: selected.db, token: getToken() ?? '' };
		const current = attendanceMap[memberId];
		const existing: EventAttendance | null = current
			? { attendanceId: current.attendanceId, memberId, status: current.status }
			: null;
		attendanceQueue.request({ cfg, eventId: attendanceItem.id, memberId, existing, newStatus });
	}

	// #87 fix — everything AttendanceSurface needs, bundled into ONE prop
	// (mirrors `worksManage` above) so AgendaList can render the panel INLINE
	// as a child of the recent row that opened it, instead of the page
	// rendering it itself below the whole agenda. `undefined` when no panel is
	// open — AgendaList then renders nothing extra on any row.
	const attendancePanel = $derived.by<AttendancePanel | undefined>(() => {
		if (!attendanceItem) return undefined;
		return {
			item: attendanceItem,
			members: attendanceRoster,
			attendanceByMemberId: attendanceMap,
			rsvpByMemberId: attendanceRsvpMap,
			loading: attendanceLoading,
			error: attendanceError,
			pendingMemberIds: attendancePendingMemberIds,
			failedMemberIds: attendanceFailedMemberIds,
			savedMemberIds: attendanceSavedMemberIds,
			// #321 — `getRoster` is what fills `attendanceRoster`, so the panel
			// states exactly what that read found.
			membersPartial: rosterPartial,
			ontoggle: handleAttendanceToggle,
			onclose: closeAttendancePanel
		};
	});

	// #85 TA.4 — my own attendance per RECENT event id (absent = badge renders
	// 'not-recorded' — see AgendaList's badgeStatus fallback), and my season
	// rate (late counts as attended; total is the season's past-event count,
	// not my record count — a past event with no record for me still counts
	// toward the total, just not toward `attended`).
	const myAttendanceByEventId = $derived.by(() => {
		const map: Record<string, AttendanceStatus> = {};
		for (const a of myAttendance) map[a.eventId] = a.status;
		return map;
	});
	// F1 fix: filter myAttendance to only records whose eventId appears in
	// recentItems (the current season's PAST events). Without this, records from
	// previous seasons inflate `attended` while `total` stays at this season's
	// past-event count — "Attended 31 of 2 events".
	const mySeasonAttendance = $derived((() => {
		const recentIds = new Set(recentItems.map((i) => i.id));
		return myAttendance.filter((a) => recentIds.has(a.eventId));
	})());
	// #194/#202 review F1 — the denominator is EVERY past event of the season,
	// not just rehearsals. Before #194 `recentItems` was rehearsals-only (the
	// data layer filtered `event_type.string=rehearsal`), so the old wording
	// "Attended {n} of {total} rehearsals" was true by construction; it is not
	// any more. Rather than re-filter here on a free-text `event_type` (Estonian
	// choirs type 'proov' — exactly the string #194 stopped trusting), the rate
	// covers the whole calendar and `attendance_season_rate` was reworded to
	// event-neutral in all four locales. Attendance is taken per EVENT, so an
	// event-shaped denominator is also the one the records actually live on.
	const mySeasonRate = $derived(deriveAttendanceRate(mySeasonAttendance, recentItems.length));

	// #85 TA.4 — open/close the conductor's full-roster expansion, loading the
	// per-member rates lazily on first expand (one roster read + one
	// listAttendance read per past event — mirrors openAttendancePanel's
	// on-demand load, since most visits never open this either).
	function handleExpandSeasonSummary() {
		if (!selected) return;
		if (seasonSummaryExpanded) {
			seasonSummaryExpanded = false;
			return;
		}
		seasonSummaryExpanded = true;
		if (seasonRatesLoaded) return; // already loaded for this collective's current load
		const cfg = { db: selected.db, token: getToken() ?? '' };
		const events = recentItems;
		const thisRequestSnapshot = requestId; // guard against a collective switch mid-load
		seasonRatesLoading = true;
		seasonRatesError = false;
		// #255 done-when 3 — `loadInactiveRoster` runs ALONGSIDE `loadRoster`, not
		// instead of it: a deactivated member's history must keep its subject on
		// this surface (the reason deactivate beat delete), so her row is unioned
		// in below rather than silently dropping the moment she is deactivated.
		// A failed inactive read fails the WHOLE surface loud (Promise.all, not
		// allSettled) — the alternative (fall back to active-only) would render a
		// roster-only list as if it were complete, exactly the silent regression
		// this fix exists to close.
		Promise.all([
			loadRoster(cfg),
			loadInactiveRoster(cfg),
			Promise.all(events.map((event) => listAttendance(cfg, event.id)))
		])
			.then(([rosterRead, inactiveRead, perEventRecords]) => {
				if (thisRequestSnapshot !== requestId) return;
				// #321 (PO ruling 2026-09-11, second pass) — the rate table SAYS it.
				// Either read short-changes the same thing: a singer with no row here
				// is missing from a comparison the others are being judged in.
				seasonRatesPartial = rosterRead.truncated || inactiveRead.truncated;
				seasonMemberRates = deriveAllMemberRates(
					perEventRecords.flat(),
					rosterRead.items,
					events.length,
					inactiveRead.items
				);
				seasonRatesLoaded = true;
				seasonRatesLoading = false;
			})
			.catch(() => {
				if (thisRequestSnapshot !== requestId) return;
				seasonRatesLoading = false;
				seasonRatesError = true;
				seasonMemberRates = [];
				// A failed read says nothing about completeness — the error slot is the
				// whole statement, and there are no rows left for a claim to be about.
				seasonRatesPartial = false;
			});
	}

	// #132/T2 — page-level "+ Season" entry point + inline creation form. The
	// collective admin needs an in-app way to open the NEXT season before the
	// current one runs out; today that's only possible in Entu's admin UI.
	//
	// Rights gate, and ONLY a rights gate: `seasonCreateRights` (derived from the
	// CURRENT season's `_owner`/`_editor` with a lapsed/no-current-season
	// fallback, fail-closed — see #91 and `deriveSeasonCreateRights`).
	// #261 (PO:Gama reopen, 2026-09-07) — the former existence gate ("no UPCOMING
	// season already exists") is REMOVED: the ruling puts [+ Season] above the
	// existing season cards, so it stays visible when an upcoming season exists.
	// See the render-site comment on `season-create` for the full rationale.
	let seasonCreateOpen = $state(false);
	let seasonCreateName = $state('');
	let seasonCreateStartDate = $state('');
	let seasonCreateEndDate = $state('');
	// Chosen conductors, in pick order — the native <select> (#209) resets to
	// its prompt after each pick (multi-add readiness), so THIS is what
	// renders the chips and what `conductorRefs` is built from on submit.
	let seasonCreateConductors = $state<Array<{ id: string; name: string }>>([]);
	let seasonCreateError = $state<(() => string) | null>(null);
	/**
	 * #132/T2 review F2 — WHICH field the current error is about. One visible
	 * `role="alert"` paragraph is right, but `aria-invalid`/`aria-describedby` are
	 * per-field: hanging them off the name input unconditionally told a screen
	 * reader that a perfectly good name was invalid whenever the DATES were wrong,
	 * and sent the viewer to the one field that needed no fixing. `null` = the
	 * error belongs to the form as a whole (a failed write), no field flagged.
	 */
	let seasonCreateErrorField = $state<'name' | 'dates' | null>(null);
	// #132/T2 review F1 — the in-flight guard. `submitSeasonCreate` awaits TWO
	// round-trips (resolveDatabaseEntityId, then createSeason) before the form unmounts, and
	// a season create is NOT idempotent: three clicks in that window used to produce
	// three real season entities that the admin then has to delete by hand in Entu.
	let seasonCreateSubmitting = $state(false);
	// Announced result, same "invisible success" discipline as the roster
	// page's page-level create (#124) — a live region mounted from first
	// render, so only a CHANGE to its text is announced.
	let seasonCreateStatus = $state('');
	let seasonCreateNameInput = $state<HTMLInputElement | null>(null);
	// #209 — the conductor native-select's source: roster people not already
	// chips, in ROSTER ORDER. `getRoster`/`getSections` (fired once when the
	// form opens — no per-keystroke fetch, there is nothing to type) warm the
	// shared cache this reads.
	const seasonConductorOptions = $derived(
		rosterPickerOptions(seasonCreateConductors.map((c) => c.id))
	);

	const showSeasonCreate = $derived(seasonCreateRights === 'editor');

	function openSeasonCreateForm(): void {
		// #132/T6 review F1 — a form with a write on the wire, or a series run that
		// stopped partway and still owes occurrences, is never torn down from
		// underneath it (see `createEntryPointsBlocked`). The entry points are
		// `disabled` on the same flag, so this is the belt under that brace.
		if (createEntryPointsBlocked) return;
		// #132/T6 — mutual exclusion: only one creation form is ever open at a
		// time. The season-MANAGE panel is not a creation form (it coexists —
		// see `closeSeasonManagePanel` is deliberately NOT called here), but the
		// other two creation surfaces must yield. #313 removed the fourth
		// (the panel's conversion form, relocated to the event page).
		closeEventCreateForm();
		closeSeriesCreateForm();
		seasonCreateName = '';
		seasonCreateStartDate = '';
		seasonCreateEndDate = '';
		seasonCreateConductors = [];
		clearSeasonCreateError();
		seasonCreateStatus = '';
		seasonCreateSubmitting = false;
		seasonCreateOpen = true;

		const current = selected;
		if (!current) return;
		// F1 — through the shared cache, not a fresh 1+N fan-out per form open.
		// #209 — options are now a $derived off the shared rosterRows/rosterSections
		// (below), so this fetch only needs to WARM the cache; the render reads it.
		const cfg = { db: current.db, token: getToken() ?? '' };
		getRoster(cfg).catch((e) => {
			// Supplementary — the conductor field is simply option-less on a
			// failed read; the name/dates path (the point of the form) stays live.
			console.error('agenda: loading the roster for the conductor picker failed', e);
		});
		getSections(cfg).catch((e) => {
			console.error('agenda: loading the section tree for the conductor picker failed', e);
		});
	}

	function closeSeasonCreateForm(): void {
		seasonCreateOpen = false;
		seasonCreateName = '';
		seasonCreateStartDate = '';
		seasonCreateEndDate = '';
		seasonCreateConductors = [];
		clearSeasonCreateError();
	}

	/**
	 * #132/T2 review F6 — an error that outlives the edit that fixed it is a lie:
	 * the field kept `aria-invalid`/`aria-describedby` pointing at "Season name is
	 * required." while holding a perfectly good name. Editing ANY field clears it;
	 * the next submit is what re-decides.
	 */
	function clearSeasonCreateError(): void {
		seasonCreateError = null;
		seasonCreateErrorField = null;
	}

	/** Message + the field it belongs to, always set together (review F2). */
	function setSeasonCreateError(msg: () => string, field: 'name' | 'dates' | null): void {
		seasonCreateError = msg;
		seasonCreateErrorField = field;
	}

	// Escape ANYWHERE in the form dismisses it without writing — bound on the
	// form's own root so it catches the bubbled keydown from any control inside.
	//
	// #209 — the conductor field used to be the #132/T2 Autocomplete, which
	// LAYERED Escape (its own open dropdown consumed the first keystroke via
	// stopPropagation, so it took two Escapes to leave with the dropdown open).
	// A native <select> owns its popup itself — the browser closes it before
	// the page ever sees the key — so that layering retired with the
	// component: one Escape, from any field including this one, dismisses the
	// form.
	function onSeasonFormKeydown(event: KeyboardEvent): void {
		if (event.key === 'Escape') dismissSeasonCreateForm();
	}

	/**
	 * #132/T6 review F2 — Cancel/Escape is REFUSED while the create is on the
	 * wire, the invariant `dismissSeriesCreateForm` already holds for the series
	 * form: a form with a write in flight is never torn down from underneath it.
	 * Without this, a mid-flight cancel unmounted the form, and the later failure
	 * wrote its message into `seasonCreateError` — state that renders ONLY inside
	 * `{#if seasonCreateOpen}`. A failed create became completely silent: no
	 * error, no announcement, no trace. (On the success path the entity is
	 * created anyway, contradicting the apparent cancel.)
	 *
	 * NOT folded into `closeSeasonCreateForm`: the SUCCESS path calls that while
	 * `seasonCreateSubmitting` is still true (the flag is released in `finally`),
	 * and a guard there would stop the form closing at all.
	 */
	function dismissSeasonCreateForm(): void {
		if (seasonCreateSubmitting) return;
		closeSeasonCreateForm();
	}

	function onSeasonCreateNameKeydown(event: KeyboardEvent): void {
		if (event.key !== 'Enter') return;
		event.preventDefault();
		void submitSeasonCreate();
	}

	function onSeasonConductorSelect(selection: { id: string | null; label: string }): void {
		// #209 — the native <select>'s change handler already guards the ''
		// prompt value, so `id` is always non-null here in practice, but stay
		// fail-closed rather than trust that wiring silently.
		if (!selection.id) return;
		if (seasonCreateConductors.some((c) => c.id === selection.id)) return; // no duplicate chips
		seasonCreateConductors = [...seasonCreateConductors, { id: selection.id, name: selection.label }];
	}

	function removeSeasonConductor(id: string): void {
		seasonCreateConductors = seasonCreateConductors.filter((c) => c.id !== id);
	}

	async function submitSeasonCreate(): Promise<void> {
		// F1 — re-entry guard FIRST: a second click while the first write is still
		// in flight is a duplicate season, not a retry. The button is disabled too;
		// this is the layer that also covers Enter-on-the-name-input.
		if (seasonCreateSubmitting) return;

		// A fresh attempt owns both the error slot and the status slot.
		clearSeasonCreateError();
		seasonCreateStatus = '';

		const name = seasonCreateName.trim();
		if (!name) {
			setSeasonCreateError(m.season_name_required, 'name');
			return;
		}
		// Validation BEFORE the write (T1 validates too, but a thrown-and-caught
		// write is not a validation UX). F4 — MISSING dates and an INVERTED range
		// are different mistakes and must not share one message: telling someone
		// her end date precedes her start date when she has entered neither sends
		// her looking at the wrong field.
		if (!seasonCreateStartDate || !seasonCreateEndDate) {
			setSeasonCreateError(m.season_dates_required, 'dates');
			return;
		}
		if (seasonCreateEndDate < seasonCreateStartDate) {
			setSeasonCreateError(m.season_date_range_invalid, 'dates');
			return;
		}

		const current = selected;
		if (!current) {
			console.error('agenda: season create submitted with no selected collective');
			setSeasonCreateError(m.season_create_failed, null);
			return;
		}
		const cfg = { db: current.db, token: getToken() ?? '' };

		// Everything past here is asynchronous — the window the guard exists for.
		seasonCreateSubmitting = true;
		try {
			let dbEntityId: string | null;
			try {
				dbEntityId = await resolveDatabaseEntityId(cfg);
			} catch (e) {
				console.error('agenda: resolving the database entity for season create failed', e);
				setSeasonCreateError(m.season_create_failed, null);
				return;
			}
			if (!dbEntityId) {
				console.error('agenda: season create with no resolvable database entity', current.personId);
				setSeasonCreateError(m.season_create_failed, null);
				return;
			}

			try {
				await createSeason(cfg, {
					name,
					dbEntityId,
					startDate: seasonCreateStartDate,
					endDate: seasonCreateEndDate,
					conductorRefs: seasonCreateConductors.map((c) => c.id)
				});
			} catch (e) {
				console.error('agenda: season create failed', name, e);
				setSeasonCreateError(m.season_create_failed, null);
				return;
			}

			seasonCreateStatus = m.season_created({ name });
			closeSeasonCreateForm();
			// The write just changed the world this page reads — refresh for real
			// rather than guess the new season's shape.
			loadForSelected();
		} finally {
			// Released on EVERY path (success, failure, early return) — a stuck
			// `true` would leave the form permanently unsubmittable.
			seasonCreateSubmitting = false;
		}
	}

	// Auto-focus the name input the instant the inline form appears, same
	// discipline as SectionPicker's create form.
	$effect(() => {
		if (seasonCreateOpen && seasonCreateNameInput) seasonCreateNameInput.focus();
	});

	// ── #132/T3, reworked #261 — the season CARD + inline panel ────────────────
	//
	// Rights gate: `manageableSeasonRights` AND a manageable season
	// (`manageableSeasonId`) — #167: the admin's pick (current-if-running, else
	// the soonest future season), NOT the viewer's `currentSeasonId`/
	// `seasonManageRights` (those stay scoped to season REPERTOIRE, which has
	// nothing to manage before a season starts). The gate is deliberately
	// independent of T2's `showSeasonCreate` (a lapsed season's editor may
	// still CREATE the next one, but there is nothing to MANAGE — see
	// `deriveSeasonCreateRights`'s doc for why the two gates read different
	// rights signals).
	//
	// Local truth, not a re-derivation of `seasons` on every open: the panel's
	// field state is seeded ONCE from `seasons` (loaded with the agenda — zero
	// extra fetch) the FIRST time it opens for a given season, then every edit
	// mutates it directly. This is what makes a saved rename survive close +
	// reopen without a second save or a full agenda refetch (spec's close/
	// reopen persistence contract).
	// #261 (Mihkel ruling 2026-09-06) — renamed from `showSeasonManageGear`: the
	// gear is REMOVED ("gear not needed"); this same derivation now gates the
	// whole season CARD (collapsed expand buttons + opened title row).
	//
	// #277 — the per-season entry-point SET: every candidate season (see the
	// `manageableSeasonRightsById` population in the load callback) this
	// viewer holds editor rights on, in `seasons`' own order (current-first).
	// A season absent from `manageableSeasonRightsById` (never a candidate, or
	// a lapsed one nobody's automatic pick lands on) is filtered out for free
	// — `undefined !== 'editor'`. `manageableSeasonId`/`manageableSeasonRights`
	// still name WHICH one is open or is the switch's target; this is the
	// broader set the card's collapsed entries iterate over.
	const manageableSeasonEntries = $derived(
		seasons.filter((s) => manageableSeasonRightsById[s.id] === 'editor')
	);
	// With exactly one entry this is byte-identical to the pre-#277 gate
	// (`manageableSeasonId !== null && manageableSeasonRights === 'editor'`) —
	// the one entry IS that season, admitted by the same rights check.
	const showSeasonCard = $derived(manageableSeasonEntries.length > 0);

	let seasonManageOpen = $state(false);
	let seasonManageName = $state('');
	let seasonManageStartDate = $state('');
	let seasonManageEndDate = $state('');
	let seasonManageConductorIds = $state<string[]>([]);
	let seasonManageFieldsLoaded = $state(false);
	let seasonManageSeries = $state<SeriesListItem[]>([]);
	/** A FAILED series read is a state of its own, never an empty list (#132/T3
	 *  review F2). `seasonManageSeries = []` in a catch is indistinguishable
	 *  from "this season genuinely has no series" — and [+ Series] sits
	 *  directly under the list, so the silent-empty shape invites the editor to
	 *  re-create series that already exist but failed to load. Fail loudly
	 *  (house rule). #313 removed this list's standalone-event sibling
	 *  (`seasonManageEvents`/`seasonManageEventsError`) along with the panel's
	 *  event rows — events are managed on their own page now. */
	let seasonManageSeriesError = $state(false);
	/** #321 review F1 — the panel's series read is a reachable bound (the
	 *  season-wide event read behind each row's occurrence tally), and it was
	 *  only `console.warn`ed: an admin stood in this panel reading an
	 *  under-reported count with nothing on screen saying so. Panel-level, not
	 *  per-row — the truncation can be in either half of
	 *  `listEventSeriesForSeason`'s pair (the series list itself, or the events
	 *  grouped into the counts), and the notice states the one fact both produce.
	 *
	 *  Lifetime follows `seasonManageSeries` exactly, because it is a claim about
	 *  those rows: ASSIGNED from every settled read (so a complete read clears it
	 *  with no separate reset), deliberately NOT cleared ahead of a re-read (the
	 *  rows stay on screen across a reload, so the claim about them must too),
	 *  and torn down in `resetSeasonManage` — the one backbone every close,
	 *  season switch and collective switch already routes through. */
	let seasonManagePartial = $state(false);
	/** #197 — a failed series/event DELETE surfaces an inline slot (per-attempt,
	 *  not sticky: cleared at the START of every delete tap, not just on
	 *  success, so a second try — success or failure — always reflects the
	 *  latest attempt). The row that failed to delete STAYS in its list; this
	 *  state only controls the error slot.
	 *
	 *  #197 review F5 — `list` says WHICH sub-panel renders the message: the
	 *  slot lives under the list that failed, never a shared one another list's
	 *  delete could print under (role="alert" still announces it either way, so
	 *  the damage of getting it wrong is visual, not SR-blocking). #313 removed
	 *  the 'events' member (and the 'partial-event' reason it alone produced)
	 *  along with the standalone-event rows and their delete.
	 *
	 *  #197 review F3 — `reason` distinguishes the ONE refusal the panel's own
	 *  rights gate cannot predict. The gate is `_owner` OR `_editor` on the
	 *  SEASON (`manageRightsFrom`), which every POST on this panel satisfies;
	 *  Entu's DELETE additionally requires `_owner` on the TARGET entity, so a
	 *  season editor who did not create the series gets a 403 forever and must
	 *  not be told to "try again". `partial` is the series cascade that stopped
	 *  part-way (see `deleteEventSeries`' contract). */
	let seasonManageDeleteError = $state<{
		list: 'series' | 'season';
		reason: 'write' | 'forbidden' | 'partial' | 'partial-season';
		deleted?: number;
		total?: number;
	} | null>(null);
	/** #197 review F2 — the two-step inline confirm, the same idiom the roster's
	 *  section delete uses (#110 review F4): a bare `×` firing an IRREVERSIBLE,
	 *  undo-less delete on a mobile-shaped panel is one mis-tap from destroying
	 *  a season's whole rehearsal series. Holds the id of the row currently
	 *  showing confirm/cancel instead of its `×` — only ever one at a time, and
	 *  arming one disarms the other. */
	let seasonManageDeleteArmed = $state<string | null>(null);
	/** #197 review 2nd pass F2 — the LIVE occurrence count of the armed series,
	 *  re-read from the server when the row arms, or `null` while that read is in
	 *  flight (and if it fails). The confirm quotes a number only when this holds
	 *  one: the panel list derives its per-series counts client-side from ONE
	 *  season-wide `limit=500` event read, so on a big season, or after an
	 *  occurrence was created since that read, the figure it shows is not the
	 *  figure the cascade will destroy — and this is the one control in the app
	 *  that destroys an unbounded set of entities with no undo. */
	let seasonManageArmedSeriesCount = $state<number | null>(null);
	/** #217 — the armed key `seasonManageDeleteArmed`/`seasonManageDeletePendingId`
	 *  take when the SEASON itself (not a row) is armed/pending: the season
	 *  control shares the ONE-armed-context slot every series/event row already
	 *  uses, so arming the season disarms a row and vice versa. Never collides
	 *  with a real entity id. */
	const SEASON_DELETE_ROW_ID = '__season__';
	/** #236 — the season's display name for the header-row trashcan and its
	 *  confirm/cancel pair, valid whether or not the panel has EVER been
	 *  opened. `seasonManageName` itself is only seeded by `openSeasonManagePanel`
	 *  (`seasonManageFieldsLoaded` gate), so a season whose panel has never
	 *  opened would otherwise announce the delete with an empty name — the
	 *  delete is now reachable from the collapsed card, so that gap is live,
	 *  not theoretical. Falls back to the season list `loadForSelected` already
	 *  fetched (zero extra fetch); once the panel HAS loaded its fields, this
	 *  is byte-identical to `seasonManageName` (same source, no drift). */
	const seasonManageDeleteName = $derived(
		seasonManageFieldsLoaded
			? seasonManageName
			: (seasons.find((s) => s.id === manageableSeasonId)?.name ?? '')
	);
	/** #217 — the season's LIVE delete scope (`countSeasonScope`'s result),
	 *  re-read when the season × arms, the season-level analogue of
	 *  `seasonManageArmedSeriesCount`. `null` while that read is in flight, or
	 *  if it fails — the confirm quotes no scope rather than a stale or
	 *  half-true one. */
	let seasonManageDeleteScope = $state<{
		series: number;
		events: number;
		repertoireItems: number;
	} | null>(null);
	/** #197 review F5 — the id whose DELETE is on the wire. Disables that row's
	 *  confirm button (and marks it `aria-busy`), so a double-tap cannot fire
	 *  two DELETEs for the same entity. */
	let seasonManageDeletePendingId = $state<string | null>(null);
	/** #197 review F5 — the visually-hidden success announcement (WCAG 4.1.3).
	 *  A successful delete otherwise just removes a row with nothing said, the
	 *  same gap `roster-section-remove-status` exists to close. */
	let seasonManageDeleteStatus = $state('');
	/** #216/#217/#236 — the ONE progress counter shared by the series cascade
	 *  and the season cascade that wraps it, rendered at CARD level (Gama's
	 *  #236 G2 ruling — a season cascade can now start from the collapsed
	 *  card, and a counter shut inside the panel would be invisible there).
	 *  `null` when no cascade is running. */
	let seasonManageDeleteProgress = $state<{ current: number; total: number } | null>(null);
	/** #217 — bumped by every `resetSeasonManage` (a collective switch, or the
	 *  agenda's own failure path), and captured by each cascade attempt at the
	 *  moment it starts. An `onProgress` tick checks its captured value against
	 *  the CURRENT one before touching `seasonManageDeleteProgress`: a tick from
	 *  a cascade whose collective the operator has since left must not paint a
	 *  stale counter over whatever is on screen now. Plain state, not `$state`
	 *  — nothing renders off it directly. */
	let seasonManageDeleteGeneration = 0;
	/**
	 * #277 — a SECOND, sibling generation counter, in the same capture-compare
	 * shape as `requestId`/`worksLoadId`/`scheduleLoadId` (top of file) but
	 * deliberately its OWN ticket, not a reuse of theirs: those bump on a
	 * COLLECTIVE switch, and this bumps on a SEASON switch — an independent
	 * race a collective-scoped ticket cannot order. Bumped by
	 * `resetSeasonManage` (the switch's one reset backbone — see
	 * `openSeasonManagePanelFor`), so every genuine switch bumps it exactly
	 * once. The panel's unguarded resolve-writers (`confirmSeasonFieldEdit`,
	 * the conductor add/remove handlers) capture it alongside `manageableSeasonId`
	 * and re-check it before touching state on resolve/reject: a write issued
	 * for the season just left must not land on the season now open.
	 */
	let seasonManageSwitchGeneration = 0;

	/** Build the `onProgress` sink threaded into `deleteEventSeries`/
	 *  `deleteSeason` for ONE delete attempt, bound to the generation captured
	 *  when that attempt started (#217 — see `seasonManageDeleteGeneration`'s
	 *  doc for why a late tick must be dropped rather than acted on). */
	function makeSeasonManageDeleteProgress(
		generation: number
	): (current: number, total: number) => void {
		return (current, total) => {
			if (generation !== seasonManageDeleteGeneration) return;
			seasonManageDeleteProgress = { current, total };
		};
	}
	// #313 — the #196 standalone-event → series conversion form (state,
	// handlers, markup) RELOCATED to the event page
	// (src/routes/event/[id]/+page.svelte, `event-detail-convert`): the panel's
	// per-row entry point (`season-manage-event-convert-<id>`) went with the
	// standalone-event rows it opened under. Nothing conversion-related is left
	// on this page — see that file's own doc comments for the (unchanged)
	// contract.
	/** A failed conductor add/remove reverts the optimistic chip — and, without
	 *  this, said nothing (#132/T3 review F1). Same contract the three text/date
	 *  fields already keep: a silently snapped-back value reads as a bug. */
	let seasonManageConductorError = $state(false);
	/** #325 — true while a conductor add/remove write is in flight. Guards the
	 *  select AND every chip's remove button, and the handlers themselves check
	 *  it (a `disabled` attribute alone is a double-tap guard, not a state
	 *  signal — `fireEvent`/a racing tap reaches the listener regardless). The
	 *  criterion this closes is DUPLICATE/LOST-REMOVE, not ER-6: the conductor
	 *  write is a plain multi-value property POST/GET-find-DELETE
	 *  (addSeasonConductor/removeSeasonConductor, seasonManage.ts), not a
	 *  direct rights-tier grant, so Entu's replacement rule never reaches it. A
	 *  duplicate POST would append a second conductor value; a remove racing a
	 *  re-add can delete the value the re-add just wrote. */
	let seasonManageConductorPending = $state(false);
	/** #325/#267 shape — persistent role="status" region, mounted blank, text
	 *  set imperatively on a successful settle, cleared at the START of the
	 *  next attempt (never on a timer) — same idiom as `panelManageStatus`. */
	let seasonManageConductorStatus = $state('');
	/** True while the panel's roster read is in flight — the conductor chips
	 *  need it to tell "name not here YET" from "name will NEVER arrive"
	 *  (#132/T3 review F4). */
	let seasonManageRosterLoading = $state(false);
	/** The dialog itself — focus moves INTO the panel on open (#132/T3 review
	 *  F1) and back to the closed season's own expand button on close (#261 —
	 *  the gear was the old anchor). */
	let seasonManagePanelEl = $state<HTMLDivElement | null>(null);
	/** #277 — the CARD container, replacing the single `seasonManageExpandEl`
	 *  binding: with one collapsed entry PER manageable season, "the expand
	 *  button to refocus on close" is no longer a single fixed element — it is
	 *  whichever entry matches `manageableSeasonId` at that moment, found by
	 *  its `data-season-manage-id` attribute (see `closeSeasonManagePanel`).
	 *  The expand button for the season being closed UNMOUNTS while its panel
	 *  is open and REMOUNTS the moment it closes, so that lookup waits a
	 *  `tick()` first, same as before. */
	let seasonCardEl = $state<HTMLDivElement | null>(null);

	// Per-field inline edit — the event/[id] pattern (beginFieldEdit /
	// confirmFieldEdit / Escape-cancels), scoped to the three editable season
	// fields. Keyboard dismissal hands focus back to the DIALOG (not the pencil,
	// as event/[id]'s TE.5 does): the pencil is `disabled` for the duration of a
	// pending write, so focusing it after an Enter-commit would silently no-op —
	// the panel, always mounted and `tabindex="-1"`, is the stable landing that
	// keeps the layered Escape working (#132/T3 review F1).
	let seasonEditingField = $state<SeasonEditableField | null>(null);
	let seasonEditDraft = $state('');
	/** Per-field inline error KIND — 'save' (the write failed) vs 'range' (the
	 *  edit was refused before any write, #132/T3 review F3). The kind picks the
	 *  message: a rejected date range must name the actual mistake. */
	let seasonEditErrors = $state<Partial<Record<SeasonEditableField, 'save' | 'range'>>>({});
	let seasonEditPending = $state<Partial<Record<SeasonEditableField, boolean>>>({});

	/** Every conductor id → display name, off the ALREADY-cached roster
	 *  (`rosterRows`, warmed by `loadManagePickers` for anyone who can manage
	 *  anything — see `getRoster`). Ids are never shown as UI (house rule). */
	const seasonManageConductorNameById = $derived.by(() => {
		const map = new Map<string, string>();
		for (const row of rosterRows) map.set(row.personId, row.name);
		return map;
	});

	/** A conductor chip's visible text AND its remove button's accessible name.
	 *  NEVER the raw person id (#132/T3 review F4): the roster read can fail, and
	 *  a conductor who has left the collective is not on the roster at all — both
	 *  would otherwise park an entity id in the UI permanently, not just for the
	 *  load flash. Unresolved-yet reads as loading; unresolvable reads as an
	 *  unknown member. */
	function seasonConductorLabel(personId: string): string {
		const name = seasonManageConductorNameById.get(personId);
		if (name) return name;
		return seasonManageRosterLoading
			? m.season_manage_conductor_loading()
			: m.season_manage_conductor_unknown();
	}

	/** #209 — the conductor native-select's source: roster members not ALREADY
	 *  a conductor of this season, in ROSTER ORDER (Gama ruling 3). */
	const seasonManageConductorOptions = $derived(
		rosterPickerOptions(seasonManageConductorIds)
	);

	/** Season bounds are date-ONLY (`yyyy-mm-dd`) and NUMERIC/TABULAR text — #207
	 *  rule 7 (PO standing rule, Gama's 2026-09-02 rulings): they render as the
	 *  ISO calendar date itself, `YYYY-MM-DD` (en-CA gives ISO date format). Still
	 *  UTC-anchored — the same guard that keeps a date-only value from sliding to
	 *  the previous day in a negative offset, now the identity for an ISO input. */
	const seasonDateFmt = isoDateFormatter('UTC');

	/** The displayable form of a season bound, or '' when the bound is unset —
	 *  `Intl.DateTimeFormat.format` THROWS `RangeError: Invalid time value` on an
	 *  Invalid Date (the trap #101 F1 already paid for on event/[id]), and a
	 *  season with no dates set IS representable data (Entu's `mandatory` is a UI
	 *  hint). The caller renders the unset case as its own branch. */
	function formatSeasonDate(isoDate: string): string {
		if (!isoDate) return '';
		const at = new Date(isoDate);
		if (Number.isNaN(at.getTime())) return '';
		return seasonDateFmt.format(at);
	}

	/**
	 * Tear the season-management panel (and everything rendered inside it) down.
	 *
	 * #313 — the #196 review F2 guard that used to stand here ("refused while a
	 * conversion run is unfinished, unless the caller says the run itself is
	 * being dropped") went with `eventConvertResume`/`dropConvertRun`: the
	 * conversion state that guard protected no longer lives on this page at
	 * all, so this reset is unconditional again.
	 */
	function resetSeasonManage(): void {
		seasonManageOpen = false;
		seasonManageFieldsLoaded = false;
		seasonManageName = '';
		seasonManageStartDate = '';
		seasonManageEndDate = '';
		seasonManageConductorIds = [];
		seasonManageSeries = [];
		seasonManageSeriesError = false;
		// #321 review F1 — with the rows goes the claim about them: a truncation
		// detected for the season/collective being left must never be on screen
		// over the next one's list.
		seasonManagePartial = false;
		seasonManageDeleteError = null;
		seasonManageDeleteArmed = null;
		seasonManageArmedSeriesCount = null;
		seasonManageDeleteScope = null;
		seasonManageDeletePendingId = null;
		seasonManageDeleteStatus = '';
		seasonManageDeleteProgress = null;
		// #217 — a fresh generation so any tick still in flight from a cascade
		// this reset just walked away from (a collective switch mid-cascade) is
		// silently dropped instead of resurrecting the counter it just cleared.
		seasonManageDeleteGeneration += 1;
		// #277 — likewise a fresh SEASON-switch generation: this reset IS the
		// switch's backbone (see `openSeasonManagePanelFor`), so every genuine
		// switch (and every collective-switch/agenda-failure teardown that
		// already called this) bumps it exactly once, dropping any
		// field-edit/conductor-add resolve still in flight for whatever season
		// was open a moment ago.
		seasonManageSwitchGeneration += 1;
		seasonManageConductorError = false;
		// #325 — the switch clears an in-flight conductor write's VISIBLE
		// trace too: the new panel starts clean, and the generation bump just
		// above is what stops the old write's late settle from re-raising
		// either flag on it (see onSeasonManageConductorSelect/…Remove).
		seasonManageConductorPending = false;
		seasonManageConductorStatus = '';
		seasonManageRosterLoading = false;
		seasonEditingField = null;
		seasonEditDraft = '';
		seasonEditErrors = {};
		seasonEditPending = {};
		// #234 review 2 F1 — the panel's repertoire section belongs to the PANEL's
		// lifetime, exactly like the series list three lines up, so it is cleared
		// where it is.
		//
		// #277 review 2 F2 — the callers that reach it, corrected: a genuine
		// collective switch, the agenda-failure path, and (new in #277) a SEASON
		// switch, `openSeasonManagePanelFor`'s one reset backbone. Plus exactly one
		// `{ keepSeasonManage: true }` reload — the `heldSeasonId`/`keptSeasonId`
		// block in `loadForSelected`, where the held season is no longer among the
		// reload's candidates: the panel has no subject left, so it takes a full
		// teardown rather than keeping the vanished season's rows under the
		// automatic pick's heading. Every OTHER panel-preserving reload skips this
		// function entirely and keeps the section it is showing.
		panelRepertoire = [];
		// #277 review 2 F1 — with the rows, the season they were read for: a write
		// settling after this teardown has nothing left to refresh.
		panelRepertoireSeasonId = null;
		panelWorks = [];
		panelWorksPartial = false;
		panelEditions = [];
		panelCopies = [];
		panelPendingKeys = new Set();
		panelRepertoireError = false;
		// #324 review F1 — the WRITE cues belong to the panel's subject just as
		// the READ failure one line up does (the agenda's own `resetManagement`
		// clears its `manageError` the same way): a rejected write on the season
		// being left must never stand over the next season's rows, and the
		// sr-only region must not still read "saved" from the old season.
		panelManageError = false;
		panelManageStatus = '';
		// #311 — reached only where the rows above are, so the panel's next open
		// starts undecided rather than carrying a stale collective's answer.
		panelRepertoireLoading = false;
		panelRepertoireItemsOk = false;
		panelWorksSourcesOk = false;
		panelPickableWorksVisible = undefined;
	}

	/**
	 * #234 — the panel's own repertoire section, scoped to the PANEL's season
	 * (`manageableSeasonId`, not `currentSeasonId` — see the state block's doc).
	 *
	 * Review F1: works/editions/copies are read HERE too, not borrowed from
	 * `loadManagePickers`' `libraryWorks`/`libraryEditions` — those are gated on
	 * the currentSeasonId-scoped `seasonManageRights`, which is 'not-editor' in
	 * exactly the future-only-season case the panel-scoping exists for.
	 * `listAllCopies` is the Borrow-link lookup (`WorkRow.canBorrow`), which
	 * nothing else on this page reads.
	 *
	 * Review 2 F1 — extracted from `openSeasonManagePanel` so the panel-preserving
	 * refresh (`refreshSeasonManageLists`) can re-run it: the panel now SURVIVES
	 * `loadForSelected({ keepSeasonManage: true })`, and a reload that leaves the
	 * section untouched would leave it describing the world as it was before the
	 * write that triggered the reload.
	 */
	function loadPanelRepertoire(cfg: ManageCfg, seasonId: string): void {
		const thisRequest = requestId;
		// #277 review F1 — the SEASON-switch ticket, captured alongside
		// `thisRequest`. See the comment above the first read for why the live
		// `manageableSeasonId` compare this replaces could not do the job.
		const thisSwitch = seasonManageSwitchGeneration;
		// #277 review 2 F1 — the section's subject, recorded where it is read so a
		// later `refreshPanelRepertoire` (whose caller is a write settle, possibly
		// mid-reload) knows which season the rows on screen belong to.
		panelRepertoireSeasonId = seasonId;
		panelRepertoireError = false;
		// #311 — true for the WINDOW both reads below are in flight; the two
		// booleans track each read's own settle (success or catch) so the flag
		// only goes false once NEITHER is still pending — mirrors
		// `loadManagePickers`' single-Promise.all `libraryPickersLoading`, split
		// across this function's two independent promises instead of one.
		panelRepertoireLoading = true;
		// #311 — invalidate any previous answer BEFORE either read dispatches,
		// same synchronous-pass reasoning as `resetManagement`'s
		// `libraryPickersLoadSucceeded = false`: neither read has had its say
		// on THIS settle yet.
		panelRepertoireItemsOk = false;
		panelWorksSourcesOk = false;
		let itemsSettled = false;
		let sourcesSettled = false;
		const maybeStopLoading = () => {
			if (itemsSettled && sourcesSettled) panelRepertoireLoading = false;
		};
		// #277 — a season SWITCH is not a collective switch, so
		// `thisRequest`/`requestId` alone does not catch a still-in-flight read
		// from the season just left. The ticket for it is
		// `seasonManageSwitchGeneration`, bumped by the switch's own
		// `resetSeasonManage`.
		//
		// #277 review F1 — NOT a live `manageableSeasonId !== seasonId` compare
		// (what this shipped as): `resetManagement()` blanks `manageableSeasonId`
		// for the whole length of every `{ keepSeasonManage: true }` reload, so a
		// panel refresh issued right after one — `refreshAfterSeasonManageDelete`,
		// the series-create paths — was dropped outright whenever its own read
		// resolved before the agenda load did, leaving the section on its stale
		// rows with `panelRepertoireLoading` stuck true. A blank id is a reload in
		// progress, never a switch; the generation says which it was.
		listRepertoireItems(cfg, seasonId)
			.then((items) => {
				if (thisRequest !== requestId || thisSwitch !== seasonManageSwitchGeneration) return;
				panelRepertoire = items;
				panelRepertoireItemsOk = true;
			})
			.catch((e) => {
				if (thisRequest !== requestId || thisSwitch !== seasonManageSwitchGeneration) return;
				console.error('agenda: loading the season-manage repertoire failed', e);
				panelRepertoire = [];
				panelRepertoireError = true;
			})
			.finally(() => {
				if (thisRequest !== requestId || thisSwitch !== seasonManageSwitchGeneration) return;
				itemsSettled = true;
				maybeStopLoading();
			});
		// One settle for the three join sources: any of them missing degrades the
		// SAME section the same way (unlabelled rows and/or an add-work select
		// with nothing in it), so they share one error surface rather than
		// half-rendering.
		Promise.all([listWorks(cfg), listAllEditions(cfg), listAllCopies(cfg)])
			.then(([worksRead, editionsRead, copiesRead]) => {
				if (thisRequest !== requestId || thisSwitch !== seasonManageSwitchGeneration) return;
				// #321 (PO ruling 2026-09-11) — the panel's add-work select states its
				// own feed's truncation, same as the agenda's pickers above.
				panelWorks = worksRead.items;
				panelEditions = editionsRead.items;
				panelCopies = copiesRead.items;
				panelWorksPartial = worksRead.truncated;
				panelWorksSourcesOk = true;
			})
			.catch((e) => {
				if (thisRequest !== requestId || thisSwitch !== seasonManageSwitchGeneration) return;
				console.error('agenda: loading the season-manage repertoire sources failed', e);
				panelWorks = [];
				panelEditions = [];
				panelCopies = [];
				panelWorksPartial = false;
				panelRepertoireError = true;
			})
			.finally(() => {
				if (thisRequest !== requestId || thisSwitch !== seasonManageSwitchGeneration) return;
				sourcesSettled = true;
				maybeStopLoading();
			});
	}

	function openSeasonManagePanel(): void {
		// #167 — the panel manages the MANAGEABLE season (current-if-running,
		// else the soonest future one), not `currentSeasonId`: a just-created
		// future season has no current status yet but is exactly what the panel
		// exists to populate.
		if (!selected || manageableSeasonId === null) return;
		seasonManageOpen = true;
		seasonEditingField = null;
		if (!seasonManageFieldsLoaded) {
			// Ride the season list the agenda load already fetched — zero extra
			// fetch, and pinned as the source for the initial field values.
			const season = seasons.find((s) => s.id === manageableSeasonId);
			seasonManageName = season?.name ?? '';
			seasonManageStartDate = season?.startDate ?? '';
			seasonManageEndDate = season?.endDate ?? '';
			seasonManageConductorIds = season?.conductors ?? [];
			seasonManageFieldsLoaded = true;
		}
		const cfg = { db: selected.db, token: getToken() ?? '' };
		const seasonId = manageableSeasonId;
		// #132/T3 review F4 — the page-wide collective-switch guard, which this
		// panel's three reads were the ONLY async assignments on this page to skip.
		// `loadForSelected` calls `resetSeasonManage()` on a new selection, but a
		// read still in flight for the OLD db resolves AFTERWARDS and repopulates
		// the cleared arrays; the panel is closed at that moment, so nothing is on
		// screen — and the stale rows then survive into the NEXT open and render
		// the previous collective's series until the new fetches land.
		const thisRequest = requestId;
		// #277 — the SEASON-switch ticket for the series read below (see
		// `loadPanelRepertoire`, which captures it for the same reason).
		const thisSwitch = seasonManageSwitchGeneration;
		seasonManageSeriesError = false;
		// #132/T2 review F1's cache-first `getRoster` — same lazy-on-open posture
		// as the season-CREATE form (never a roster read on the plain agenda
		// visit): the conductor chips/native select are the FIRST thing in this
		// panel to need names, so the fetch fires here, not earlier.
		seasonManageRosterLoading = true;
		getRoster(cfg)
			.catch((e) => {
				console.error('agenda: loading the roster for season management failed', e);
			})
			.finally(() => {
				if (thisRequest !== requestId) return;
				// Settled either way: a chip with no name is "unknown", not "loading",
				// the moment the read is done (#132/T3 review F4).
				seasonManageRosterLoading = false;
			});
		// #209 — the section tree behind the conductor picker's ROSTER ORDER.
		getSections(cfg).catch((e) => {
			console.error('agenda: loading the section tree for season management failed', e);
		});
		// #277 — same rationale as `loadPanelRepertoire` below: a season switch
		// does not touch `requestId`, so a series read still in flight for the
		// season just left must be told apart from one still describing the season
		// now open — by the switch generation, which a panel-preserving reload
		// (unlike `manageableSeasonId`) never disturbs.
		listEventSeriesForSeason(cfg, seasonId)
			.then((result) => {
				if (thisRequest !== requestId || thisSwitch !== seasonManageSwitchGeneration) return;
				seasonManageSeries = result.items;
				// #321 review F1 — the panel now SAYS it, in the same notice markup
				// every other partial surface uses (season-manage-partial-notice, above
				// the list). Assigned, not conditionally set: a complete read is what
				// takes a previous open's notice back down.
				seasonManagePartial = result.truncated;
			})
			.catch((e) => {
				if (thisRequest !== requestId || thisSwitch !== seasonManageSwitchGeneration) return;
				console.error('agenda: loading the season\'s event series failed', e);
				seasonManageSeries = [];
				seasonManageSeriesError = true;
				// A failed read says nothing about completeness — the claim goes with
				// the rows it was about, leaving the error slot as the only statement.
				seasonManagePartial = false;
			});
		// #313 — the panel no longer lists standalone events at all (they are
		// managed on their own page); the `listEventsForSeason` read this list
		// fired went with the rows it fed.
		loadPanelRepertoire(cfg, seasonId);
	}

	/**
	 * #277 — every per-season collapsed entry's click handler: open the panel
	 * for `seasonId`, switching to it first if it is not already the season in
	 * play. A switch is a FULL teardown of the previous season's panel state
	 * (`resetSeasonManage` — the exact same backbone a genuine close/collective
	 * switch already uses, reused rather than duplicated) followed by a fresh
	 * `openSeasonManagePanel` for the new one: nothing of the season being left
	 * survives (criterion 3), and rights are re-pointed from the already-computed
	 * per-season map, never carried over (criterion 4).
	 *
	 * Reopening the season ALREADY open/in-play (`seasonId === manageableSeasonId`
	 * — the single-manageable-season case, always) skips the reset branch
	 * entirely and degrades to plain `openSeasonManagePanel()`, preserving the
	 * existing close/reopen-without-refetch persistence contract untouched
	 * (criterion 5: byte-identical when only one season is manageable).
	 *
	 * #277 review F2 — a switch is exactly the panel teardown
	 * `closeSeasonManagePanel` REFUSES while a series run is unfinished, so it
	 * carries the same refusal, and it takes the series form down with the panel
	 * the way a collective switch does. Both halves are argued at their line.
	 */
	function openSeasonManagePanelFor(seasonId: string): void {
		if (seasonId !== manageableSeasonId) {
			// #277 review F2 — the same `seriesRunUnfinished` refusal
			// `closeSeasonManagePanel` (#135) and `seasonCardCollapseDisabled` carry:
			// a switch unmounts the form together with the panel that hosts it, and
			// the resume record is keyed to the season it was opened for — so a
			// switch mid-run would take away the only explanation on screen for why
			// every create entry point is dead, and then let the next agenda load
			// REAP that record (`restoreSeriesCreateRun` compares it against
			// `manageableSeasonId`), abandoning the occurrences the stopped run
			// still owes. The other seasons' entries render DISABLED under this
			// same condition, so this is never an enabled control that no-ops.
			if (seriesRunUnfinished) return;
			resetSeasonManage();
			// #277 review F2 — the series form belongs to the SEASON it was opened
			// in exactly as it belongs to the db it was opened in (#132/T6 review
			// F3, `loadForSelected`'s collective-switch twin): `resetSeasonManage`
			// deliberately does not touch its state, and `seriesCreateSeasonId` is
			// captured at open and read at submit — so a form left mounted under the
			// new season's heading would have created the series, and every
			// occurrence, under the season just left.
			closeSeriesCreateForm();
			manageableSeasonId = seasonId;
			manageableSeasonRights = manageableSeasonRightsById[seasonId] ?? 'not-editor';
		}
		openSeasonManagePanel();
	}

	function closeSeasonManagePanel(): void {
		// #132/T6 review F1, same root cause as the `open*Form` guards: the SERIES
		// form is rendered INSIDE this panel, so dismissing the panel unmounts it —
		// the very teardown `dismissSeriesCreateForm` refuses while a bulk run is
		// on the wire.
		//
		// #135 — widened from `seriesCreateSubmitting` to `seriesRunUnfinished`.
		// The narrower flag left the STOPPED-but-idle window unguarded: a run that
		// stops partway sets `seriesCreateResume` and releases `seriesCreateSubmitting`
		// in its `finally`, so the close button re-enabled and a click unmounted the
		// panel — with it the ONLY visible explanation ("2 remaining of 3") for why
		// every other entry point stayed disabled. The resume record itself survives
		// (this function never touches it), so the entry points stayed correctly
		// blocked, but re-opening the gear was the only way to see why — the season
		// and event forms live at page level and survive the panel either way, so
		// widening this costs nothing on their account.
		//
		// #313 — the conversion-form guard that used to stand here left with the
		// form itself, which no longer lives inside this panel.
		if (seriesRunUnfinished) return;
		seasonManageOpen = false;
		seasonEditingField = null;
		// #197 review F2 — a delete armed but never confirmed must not still be
		// armed on the next open: the panel comes back with a "Delete?" button
		// exactly where the × was, one tap from a destroy the operator walked away
		// from. The error slot goes with it (per-attempt, never carried over).
		seasonManageDeleteArmed = null;
		seasonManageArmedSeriesCount = null;
		seasonManageDeleteScope = null;
		seasonManageDeleteError = null;
		// The dialog held focus (see the $effect below); dismissing it unmounts
		// the focused element, so hand focus back to the control that opened it
		// rather than dropping the keyboard user at <body> — the same debt every
		// self-unmounting control on this page pays (#113 TU.5, #99 F1/F3).
		// #261 — the landing spot is the collapsed card's OWN expand control
		// (the gear was the old anchor); that button does not exist yet on
		// this tick (`seasonManageOpen` just went false, but Svelte has not
		// re-rendered), so the focus call waits for the DOM to catch up —
		// same `tick()` shape as `refocusSeasonManagePanel` below.
		// #277 — looked up by `data-season-manage-id` rather than a single
		// bound element: the season just closed is the one THIS close call
		// belongs to (`manageableSeasonId`), never whichever OTHER manageable
		// season's entry happens to also be on screen.
		const closedSeasonId = manageableSeasonId;
		tick().then(() => {
			seasonCardEl
				?.querySelector<HTMLButtonElement>(
					`[data-testid="season-card-expand"][data-season-manage-id="${closedSeasonId}"]`
				)
				?.focus();
		});
	}

	/** Focus moves INTO the dialog the moment it opens (#132/T3 review F1). Without
	 *  this the panel's own Escape handler is unreachable in a real browser: #222
	 *  renders the panel as a SIBLING of the toolbar header row inside the shared
	 *  agenda-admin-card, so a keypress at the still-focused gear never enters the
	 *  panel's subtree and never bubbles to `onkeydown`. It is also what
	 *  `role="dialog"` promises a screen-reader user. Same shape as the
	 *  season-CREATE form's focus effect above; both deps are stable while the
	 *  panel is open, so this runs once per open and never steals focus back. */
	$effect(() => {
		if (seasonManageOpen && seasonManagePanelEl) seasonManagePanelEl.focus();
	});

	/** Returns focus to the dialog after a KEYBOARD dismissal of a field editor —
	 *  the editor's input is about to unmount, and an unfocused dialog cannot hear
	 *  the next Escape. `tick()` because the input is still mounted on this tick
	 *  (event/[id]'s `restorePencilFocus` shape). A BLUR dismissal never calls
	 *  this: the viewer already chose where focus goes (#105 review F2). */
	function refocusSeasonManagePanel(): void {
		tick().then(() => seasonManagePanelEl?.focus());
	}

	/** Escape on the PANEL ITSELF dismisses it. Layered under a field edit's
	 *  own Escape handler (`handleSeasonFieldKeydown`), which stops propagation
	 *  while an edit is open — the WAI-APG two-Escapes-to-leave shape. (#209
	 *  retired the same shape's OTHER instance, the conductor field's — a
	 *  native <select> owns its own popup, so that layer no longer exists.) */
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
		if (seasonEditPending[field]) return; // a write for this field is already in flight
		clearSeasonFieldError(field);
		seasonEditDraft = seasonFieldValue(field);
		seasonEditingField = field;
	}

	function cancelSeasonFieldEdit(): void {
		seasonEditingField = null;
		seasonEditDraft = '';
	}

	/** Enter/blur confirm: optimistic apply + immediate write, eventFieldEdit's
	 *  replace-semantics choreography underneath (`updateSeasonField`). A
	 *  failed write reverts to `before` and surfaces the field's inline error —
	 *  a silently snapped-back value reads as a bug (house rule). An empty or
	 *  UNCHANGED draft degrades to a plain cancel: no wire call at all. */
	function confirmSeasonFieldEdit(field: SeasonEditableField): void {
		if (!selected || manageableSeasonId === null || seasonEditingField !== field) return;
		const before = seasonFieldValue(field);
		const value = seasonEditDraft.trim();
		seasonEditingField = null;
		if (value === '' || value === before) return;

		// The SAME range rule `submitSeasonCreate` enforces on the create form
		// (#132/T3 review F3): editing one bound past the other would otherwise
		// admit an inverted season through the very UI that guards it on create —
		// and the agenda's current-season derivation reads those bounds. Refused
		// BEFORE any write, so the old value simply stands.
		if (seasonDateRangeInverted(field, value)) {
			seasonEditErrors = { ...seasonEditErrors, [field]: 'range' };
			return;
		}

		const cfg = { db: selected.db, token: getToken() ?? '' };
		const seasonId = manageableSeasonId;
		// #277 — captured alongside `seasonId`: a SWITCH away from THIS season
		// bumps `seasonManageSwitchGeneration` (via `resetSeasonManage`), so a
		// save that resolves or rejects AFTER the admin has moved on to another
		// season's panel touches nothing there. This function was previously an
		// unguarded resolve-writer — its `.then()`/`.catch()` had no re-check at
		// all before this issue.
		const thisSeasonManage = seasonManageSwitchGeneration;
		clearSeasonFieldError(field);
		seasonEditPending = { ...seasonEditPending, [field]: true };
		applySeasonFieldLocally(field, value); // optimistic — the panel is the truth it renders
		updateSeasonField(cfg, seasonId, field, value)
			.then(() => {
				if (thisSeasonManage !== seasonManageSwitchGeneration) return;
				seasonEditPending = { ...seasonEditPending, [field]: false };
			})
			.catch((e) => {
				if (thisSeasonManage !== seasonManageSwitchGeneration) return;
				console.error('agenda: season field save failed', field, e);
				seasonEditPending = { ...seasonEditPending, [field]: false };
				applySeasonFieldLocally(field, before);
				seasonEditErrors = { ...seasonEditErrors, [field]: 'save' };
			});
	}

	/** True when `value` would put this season's bounds out of order against the
	 *  OTHER (unedited) bound. ISO `yyyy-mm-dd` compares lexicographically, the
	 *  same comparison `submitSeasonCreate` uses. A missing counterpart bound is
	 *  nothing to contradict — the edit passes. */
	function seasonDateRangeInverted(field: SeasonEditableField, value: string): boolean {
		if (field === 'start_date') return seasonManageEndDate !== '' && value > seasonManageEndDate;
		if (field === 'end_date') return seasonManageStartDate !== '' && value < seasonManageStartDate;
		return false;
	}

	/** The message a field's inline error slot shows — a refused range names the
	 *  actual mistake rather than the generic save failure (#132/T3 review F3). */
	function seasonFieldErrorText(field: SeasonEditableField): string {
		return seasonEditErrors[field] === 'range'
			? m.season_date_range_invalid()
			: m.season_manage_save_error();
	}

	function handleSeasonFieldKeydown(event: KeyboardEvent, field: SeasonEditableField): void {
		if (event.key === 'Escape') {
			event.preventDefault();
			// Layering (#132/T2 review F2 shape): this Escape belongs to the FIELD
			// edit, not the panel — stop it here so the panel's own Escape handler
			// never sees it.
			event.stopPropagation();
			cancelSeasonFieldEdit();
			// …and the NEXT Escape belongs to the panel, which can only hear it
			// while it holds focus (#132/T3 review F1).
			refocusSeasonManagePanel();
		} else if (event.key === 'Enter') {
			event.preventDefault();
			confirmSeasonFieldEdit(field);
			refocusSeasonManagePanel();
		}
	}

	/** Svelte action: focus the element the instant it mounts — every edit
	 *  input activates focus INTO itself, same discipline as event/[id]'s
	 *  `focusOnMount`. */
	function focusSeasonInputOnMount(node: HTMLElement): void {
		node.focus();
	}

	function onSeasonManageConductorSelect(selection: { id: string | null; label: string }): void {
		// #325 — the pending flag is the WIRE-level guard, checked here before
		// anything else: `disabled` on the select is a double-tap guard, not a
		// state signal, so a racing pick must be refused by the handler itself,
		// not merely by the attribute. See seasonManageConductorPending's doc
		// for the duplicate/lost-remove race this closes.
		if (seasonManageConductorPending) return;
		if (!selection.id || !selected || manageableSeasonId === null) return;
		const personId = selection.id;
		if (seasonManageConductorIds.includes(personId)) return; // no duplicate chips
		const cfg = { db: selected.db, token: getToken() ?? '' };
		const seasonId = manageableSeasonId;
		// #277 — same capture-compare guard as `confirmSeasonFieldEdit` above;
		// this add was likewise an unguarded resolve-writer before this issue.
		const thisSeasonManage = seasonManageSwitchGeneration;
		seasonManageConductorError = false; // this attempt starts clean
		seasonManageConductorStatus = ''; // …and so does the saved cue
		seasonManageConductorPending = true;
		seasonManageConductorIds = [...seasonManageConductorIds, personId]; // optimistic
		addSeasonConductor(cfg, seasonId, personId)
			.then(() => {
				// #325 — a switch mid-flight must neither re-raise pending nor
				// announce saved onto whatever season is open now.
				if (thisSeasonManage !== seasonManageSwitchGeneration) return;
				seasonManageConductorPending = false;
				seasonManageConductorStatus = m.season_manage_conductor_saved();
			})
			.catch((e) => {
				if (thisSeasonManage !== seasonManageSwitchGeneration) return;
				console.error('agenda: add season conductor failed', personId, e);
				seasonManageConductorIds = seasonManageConductorIds.filter((id) => id !== personId);
				// …and SAY so: the revert alone is a chip that appears and vanishes
				// (#132/T3 review F1).
				seasonManageConductorError = true;
				seasonManageConductorPending = false;
			});
	}

	function onSeasonManageConductorRemove(personId: string): void {
		// #325 — same wire-level refusal as the select above.
		if (seasonManageConductorPending) return;
		if (!selected || manageableSeasonId === null) return;
		const cfg = { db: selected.db, token: getToken() ?? '' };
		const seasonId = manageableSeasonId;
		// #277 — same capture-compare guard; this remove was likewise unguarded.
		const thisSeasonManage = seasonManageSwitchGeneration;
		const before = seasonManageConductorIds;
		seasonManageConductorError = false;
		seasonManageConductorStatus = '';
		seasonManageConductorPending = true;
		seasonManageConductorIds = seasonManageConductorIds.filter((id) => id !== personId); // optimistic
		apiRemoveSeasonConductor(cfg, seasonId, personId)
			.then(() => {
				if (thisSeasonManage !== seasonManageSwitchGeneration) return;
				seasonManageConductorPending = false;
				seasonManageConductorStatus = m.season_manage_conductor_saved();
			})
			.catch((e) => {
				if (thisSeasonManage !== seasonManageSwitchGeneration) return;
				console.error('agenda: remove season conductor failed', personId, e);
				seasonManageConductorIds = before;
				seasonManageConductorError = true;
				seasonManageConductorPending = false;
			});
	}

	// ── #132/T4 — event CREATION: two entry points, one inline form ───────────

	/** Tallinn IANA timezone — same TE.4 wall-clock convention as
	 *  event/[id]/+page.svelte's editor (and AgendaList's display). Used
	 *  locally for the display formatters below; the offset/local→UTC
	 *  conversion itself now lives once in $lib/preferences/timeFormat (#230). */
	const EVENT_CREATE_TZ = 'Europe/Tallinn';

	/** #243 — the end pair replaces the duration number input: `endLocal` is the
	 *  end composite's 'YYYY-MM-DDTHH:MM' Tallinn wall clock (or '' while either
	 *  part is missing). `undefined` when there is nothing to derive (blank end
	 *  = "inherit from series", the old blank number input's meaning); `'range'`
	 *  when the resulting span is zero or negative (end at or before start);
	 *  otherwise the REAL elapsed minutes from two INDEPENDENT UTC conversions
	 *  (start and end each converted on their own via `tallinnLocalToUtcIso`,
	 *  then subtracted) — DST-safe, never wall-clock arithmetic. Same
	 *  convention as event/[id]'s duration_minutes end editor.
	 *
	 *  `undefined` is reserved STRICTLY for the genuinely blank composite. A
	 *  FILLED end that cannot be converted (unparseable local, or a start that
	 *  yields no finite span) refuses with `'range'` instead — the submit path
	 *  reads `undefined` as "inherit from series" and writes no durationMinutes
	 *  key at all, so returning it here would silently DROP an end the viewer
	 *  filled in. Unreachable through the native date input plus TimeSelect, and
	 *  kept loud anyway (review #243 F4). */
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

	// #213 removed the page-level [+ Event]; its own rights gate (the same
	// `manageableSeasonId`/`manageableSeasonRights` formula as the gear) is
	// gone with it — the season card IS that entry point now (#261: `showSeasonCard`).

	/** The event-create fields a validation message can belong to; `null` = a
	 *  form-wide failure (no org, a failed write) that names no single box. */
	type EventCreateErrorField = 'type' | 'season' | 'datetime' | 'name' | 'end' | null;

	/** The created event's start, Tallinn wall clock, for the success
	 *  announcement — #207 rule 7 (PO standing rule, Gama's 2026-09-02
	 *  rulings): the date part is NUMERIC/TABULAR text, so it renders as the
	 *  ISO calendar date `YYYY-MM-DD` (en-CA gives ISO date format) and is
	 *  UNTOUCHED by #220; the time part now flows through the ONE shared
	 *  formatter ($lib/preferences/timeFormat), 24h unless the viewer set
	 *  AM/PM. Composed as two formatters — a single combined Intl format
	 *  would insert a locale comma between date and time instead of the
	 *  required plain space. */
	const eventCreateStatusDateFmt = isoDateFormatter(EVENT_CREATE_TZ);
	function eventCreateStatusFmt(at: Date): string {
		return `${eventCreateStatusDateFmt.format(at)} ${formatTime(tallinnHHMM(at), $timeFormatStore)}`;
	}

	let eventCreateOpen = $state(false);
	// Which entry point opened the form — #213: always 'panel' now (the
	// page-level open is gone); kept as a type so a successful create still
	// knows to refresh the panel's two lists.
	let eventCreateOrigin = $state<'panel' | null>(null);
	let eventCreateSeasonId = $state('');
	let eventCreateSeriesId = $state('');
	let eventCreateSeriesOptions = $state<SeriesListItem[]>([]);
	// The selected series' inherited name/duration/location/description —
	// rendered as a muted "From series: …" secondary LINE under each field
	// (#208 Gama ruling), never copied into a value or a placeholder: what
	// this shows is exactly what the read-side merge (`listEvents`,
	// `loadEventDetail`) would show for an untouched occurrence.
	let eventCreateSeriesDefaults = $state<SeriesDefaults | null>(null);
	// #199 — the canonical, localized <select> (CANONICAL_EVENT_TYPES); replaces
	// the free-text Autocomplete built over prior `listEventTypes` values.
	// #242 ruling — starts empty: no preselected type, one explicit choice.
	// An untouched submit is refused (see the validation below); all three
	// sites that assign this state (here, open-form, close-form) must agree.
	let eventCreateType = $state('');
	let eventCreateName = $state('');
	// #207 rule 5 — the composite's two constituent parts. `eventCreateDatetime`
	// stays the SAME canonical 'YYYY-MM-DDTHH:MM' string every downstream reader
	// (validation, tallinnLocalToUtcIso) already expects, now DERIVED from the
	// two parts rather than typed directly — '' while either part is missing,
	// mirroring $lib/testing/timeControls' readDateTime contract (a half-filled
	// composite must never surface a malformed datetime).
	let eventCreateDate = $state('');
	let eventCreateTime = $state('');
	const eventCreateDatetime = $derived(
		eventCreateDate && eventCreateTime ? `${eventCreateDate}T${eventCreateTime}` : ''
	);
	// #243 — the end pair replaces the duration number input. `eventCreateEndDate`
	// mirrors `eventCreateDate` (the start date) until the viewer touches the end
	// date input directly, at which point `eventCreateEndTouched` latches and the
	// mirror stops following (Done-when 4: the common same-day case costs one
	// interaction, the multi-day case exactly one extra date pick).
	// `eventCreateEndDatetime` is DERIVED, same shape as `eventCreateDatetime`
	// above — '' while either part is missing, never a malformed string.
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
	/** Which field the message belongs to — always set WITH the message, the T2
	 *  review F2 shape: a form-wide "try again" that names no field is a dead end
	 *  for anyone who cannot see which box is empty. `null` = form-wide. */
	let eventCreateErrorField = $state<EventCreateErrorField>(null);
	/**
	 * #132/T4 review (2nd pass) F3 — the open form's IDENTITY, for the three
	 * async reads it fires. Every other async assignment on this page carries an
	 * in-flight guard; these had none, so a reply belonging to a form that has
	 * since been closed (or reopened) still landed in its state.
	 *
	 * Bumped ONLY on open/close, deliberately: the type-options read is
	 * season-independent, so bumping on a season change would drop a perfectly
	 * good type list just because the viewer picked her season quickly. The two
	 * season-/series-scoped reads pair this token with a VALUE check against the
	 * current selection instead (see their guards) — that is the race the review
	 * names: a `listEventSeriesForSeason` for the PREVIOUS season resolving after
	 * the switch and offering its series under the newly selected season, which
	 * then rides along as a cross-season `event_series` parent on the new event.
	 */
	let eventCreateLoadId = 0;
	let eventCreateSubmitting = $state(false);
	/** #132/T4 review F3 — the announced result. Mounted from first render (a
	 *  live region announces only CHANGES), same "invisible success" discipline
	 *  as `seasonCreateStatus` / #124: the form simply vanishing is the exact
	 *  signal Cancel gives, and an event created into a NON-current season
	 *  changes nothing visible on this page at all. */
	let eventCreateStatus = $state('');
	let eventCreateNameInput = $state<HTMLInputElement | null>(null);

	function setEventCreateError(msg: () => string, field: EventCreateErrorField): void {
		eventCreateError = msg;
		eventCreateErrorField = field;
	}

	/** T2 review F6's rule, applied here: an error that outlives the edit which
	 *  fixed it is a lie. Any edit to any field clears it; the next submit
	 *  re-decides. */
	function clearEventCreateError(): void {
		eventCreateError = null;
		eventCreateErrorField = null;
	}

	/** `aria-describedby` for a field that currently owns the error message. */
	function eventCreateDescribedBy(field: EventCreateErrorField): string | undefined {
		return eventCreateErrorField === field ? 'event-create-error' : undefined;
	}

	function eventCreateInvalid(field: EventCreateErrorField): true | undefined {
		return eventCreateErrorField === field ? true : undefined;
	}

	/** The series options for a CHOSEN season — shared by the initial
	 *  panel-prefilled open and every subsequent season-select change.
	 *
	 *  Guarded twice (review F3): the form must still be the same one, AND the
	 *  season this list belongs to must still be the selected one. Without the
	 *  second half, switching season A → B while A's read is in flight repopulates
	 *  the select with A's series under B — pick one and the created event carries
	 *  a cross-season `event_series` parent no reader can make sense of. */
	function loadEventCreateSeriesOptions(cfg: ManageCfg, seasonId: string): void {
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

	/** Opened from T3's panel [+ Event] (`origin: 'panel'`) — #213 removed the
	 *  page-level [+ Event]; this is the only entry point left. The panel's
	 *  own season is pre-filled and its series already offered. */
	function openEventCreateForm(origin: 'panel'): void {
		// #132/T6 review F1 — see `openSeasonCreateForm`. The panel's [+ Event]
		// is the entry point that made this reachable: it renders regardless of
		// which other form is open, so a mid-generation click used to unmount the
		// series form (and its resume state) while the bulk loop kept POSTing.
		if (createEntryPointsBlocked) return;
		// #132/T6 — mutual exclusion (see `openSeasonCreateForm`'s doc). The
		// season-manage panel survives — a panel-born open needs it to prefill
		// season/series and a panel-born create's post-submit refresh needs it
		// to still be there.
		closeSeasonCreateForm();
		closeSeriesCreateForm();
		eventCreateLoadId += 1; // review F3 — a new form; nothing the last one asked for belongs here
		eventCreateOrigin = origin;
		// #298 — a fresh open owns the status slot too, same discipline as
		// `openSeasonCreateForm`'s `seasonCreateStatus = ''` right below: a
		// stale "Event X created" must not sit visible over a form the viewer
		// re-opened to do something else.
		eventCreateStatus = '';
		const prefillSeasonId = manageableSeasonId ?? '';
		eventCreateSeasonId = prefillSeasonId;
		eventCreateSeriesId = '';
		eventCreateSeriesOptions = [];
		eventCreateSeriesDefaults = null;
		eventCreateType = '';
		eventCreateName = '';
		eventCreateDate = '';
		eventCreateTime = '';
		eventCreateEndDate = '';
		eventCreateEndTime = '';
		eventCreateEndTouched = false;
		eventCreateLocation = '';
		eventCreateDescription = '';
		eventCreateCapacity = '';
		eventCreateConductors = [];
		clearEventCreateError();
		eventCreateSubmitting = false;
		eventCreateOpen = true;

		const current = selected;
		if (!current) return;
		const cfg = { db: current.db, token: getToken() ?? '' };
		// Lazy, form-open-only reads — never on the plain agenda visit.
		getRoster(cfg).catch((e) => {
			console.error('agenda: loading the roster for the event conductor picker failed', e);
		});
		// #209 — the section tree behind the conductor picker's ROSTER ORDER.
		getSections(cfg).catch((e) => {
			console.error('agenda: loading the section tree for the event conductor picker failed', e);
		});
		if (prefillSeasonId) loadEventCreateSeriesOptions(cfg, prefillSeasonId);
	}

	function closeEventCreateForm(): void {
		eventCreateLoadId += 1; // review F3 — replies to a form that is gone land nowhere
		eventCreateOpen = false;
		eventCreateOrigin = null;
		eventCreateSeasonId = '';
		eventCreateSeriesId = '';
		eventCreateSeriesOptions = [];
		eventCreateSeriesDefaults = null;
		eventCreateType = '';
		eventCreateName = '';
		eventCreateDate = '';
		eventCreateTime = '';
		eventCreateEndDate = '';
		eventCreateEndTime = '';
		eventCreateEndTouched = false;
		eventCreateLocation = '';
		eventCreateDescription = '';
		eventCreateCapacity = '';
		eventCreateConductors = [];
		clearEventCreateError();
	}

	/**
	 * The form is self-unmounting, and the element that had focus goes with it —
	 * without this the keyboard user lands at <body> (#113 TU.5, #99 F1/F3, the
	 * same debt `closeSeasonManagePanel` pays). Since #213 removed the page-level
	 * [+ Event], every open is PANEL-born and the only landing spot left is the
	 * still-open panel itself, so `origin` is 'panel' or nothing. `tick()`
	 * because the panel is re-measured only on the NEXT tick. NOT folded into
	 * `closeEventCreateForm` — that also runs on a collective switch, where
	 * stealing focus would be wrong.
	 */
	function restoreEventCreateFocus(origin: 'panel' | null): void {
		tick().then(() => {
			if (origin === 'panel') seasonManagePanelEl?.focus();
		});
	}

	// #244 — the id of a just-created event whose agenda row this page is
	// waiting to see ACTUALLY rendered, so it can collapse the season panel off
	// it and mark it. Set only on the panel-born success path (see
	// `submitEventCreate`); the post-create `loadForSelected` reload it waits
	// on is a `.then()` chain the caller does not await, so the row is not in
	// `filteredAgendaItems`/`filteredRecentItems` at the moment of the create.
	//
	// #244 review F1/F3 — the COLLAPSE lives here, not in `submitEventCreate`,
	// and it is decided from the rendered row rather than from the created
	// event's type. Both halves of that are load-bearing:
	//
	//   * FOCUS. `loadForSelected({ keepSeasonManage: true })` runs
	//     `resetManagement()` SYNCHRONOUSLY, blanking `manageableSeasonId` /
	//     `manageableSeasonRights` for the whole `loadFullAgenda()` round trip
	//     — so `showSeasonCard` is false for its duration. Collapsing inside
	//     that window makes BOTH disjuncts of
	//     `{#if showSeasonCard || seasonManageOpen}` false, the entire
	//     `agenda-admin-card` unmounts, and `closeSeasonManagePanel`'s own
	//     `tick()` focus finds no `season-card-expand` to land on: focus drops
	//     to <body> and is never recovered. Waiting for the row means the
	//     reload has landed, the rights are back, and the collapsed card the
	//     close focuses actually mounts.
	//
	//   * TRUTH. The filter admitting the created type is not the same claim
	//     as "the row will be listed": `listFullAgenda` builds `upcoming` from
	//     FUTURE events and `recent` from the CURRENT season only (returning
	//     `recent: []` outright when no season is current), so a past-dated
	//     create in a non-current season lands in neither list. Collapsing on
	//     that prediction removes the last thing on screen — the exact
	//     regression the amendment (issuecomment-5594475154) exists to
	//     prevent. Observed-and-then-collapse cannot make that mistake.
	let pendingSurfaceEventId = $state<string | null>(null);
	let pendingSurfaceGiveUpTimer: ReturnType<typeof setTimeout> | null = null;
	/** Bounded give-up. A reload that never lists the row must not leave the
	 *  arming live: a LATER reload or filter change would otherwise fire a
	 *  stale "just created" scroll-and-highlight long after the fact. */
	const SURFACE_GIVE_UP_MS = 10000;
	// The transient mark on that row, and its own clear timer. DECORATIVE
	// ONLY — `event-create-status` (sr-only) already announces the create to
	// assistive tech (#132/T4 review F3) — so it carries no new copy and
	// needs no i18n key. It clears on a timeout rather than lingering: a
	// highlight that never times out is a different bug.
	let justCreatedEventId = $state<string | null>(null);
	let justCreatedEventMarkTimer: ReturnType<typeof setTimeout> | null = null;
	const JUST_CREATED_MARK_MS = 3000;

	function surfaceCreatedEvent(eventId: string): void {
		if (pendingSurfaceGiveUpTimer !== null) clearTimeout(pendingSurfaceGiveUpTimer);
		pendingSurfaceEventId = eventId;
		pendingSurfaceGiveUpTimer = setTimeout(() => {
			pendingSurfaceGiveUpTimer = null;
			// Gave up: the row never showed. The panel stays exactly as it is —
			// open, and still holding the focus `restoreEventCreateFocus` put on
			// it synchronously at the end of the create — so there is nothing to
			// recover here and nothing worth stealing back from wherever the
			// viewer has moved in the meantime.
			pendingSurfaceEventId = null;
		}, SURFACE_GIVE_UP_MS);
	}

	$effect(() => {
		const id = pendingSurfaceEventId;
		if (!id) return;
		// #244 review F2 — WHICH rows exist, and under which testid, depends on
		// the view: `agendaViewStore` is a PERSISTED preference, so month mode
		// is an ordinary state a viewer can be sitting in, not an edge. Month
		// mode renders `filteredAgendaItems` ONLY (Gama's #247 scope ruling —
		// no Recent section exists there), so a create that lands in `recent`
		// genuinely is not on screen in that view and must not be treated as
		// surfaced.
		const monthMode = $agendaViewStore === 'month';
		// Fires again every time the agenda's own state changes; a miss just
		// means the reload has not landed yet (or never will — the give-up
		// timer above owns that end).
		const present = monthMode
			? filteredAgendaItems.some((it) => it.id === id)
			: filteredAgendaItems.some((it) => it.id === id) ||
				filteredRecentItems.some((it) => it.id === id);
		if (!present) return;
		pendingSurfaceEventId = null;
		if (pendingSurfaceGiveUpTimer !== null) {
			clearTimeout(pendingSurfaceGiveUpTimer);
			pendingSurfaceGiveUpTimer = null;
		}
		// The row is up: collapse the panel off it. The mid-run refusal
		// (`seriesRunUnfinished`, #135) lives in EXACTLY ONE place — routing the
		// auto-collapse through it, instead
		// of assigning `seasonManageOpen` directly, inherits that refusal
		// rather than re-deriving it: a run still unfinished leaves
		// `seasonManageOpen` untouched and this call is a no-op, with focus
		// staying on the still-open panel. (Arming only ever happens from the
		// panel-born success path, so there is no case where this fires with
		// no panel to close; if the viewer collapsed it by hand meanwhile, the
		// call re-lands focus where it already is.)
		closeSeasonManagePanel();
		// AttendanceSurface.svelte:89-97's shape: the row is addressed by its
		// existing testid (+page.svelte already does this cross-component at
		// `closeAttendancePanel`, above) rather than a new prop/ref, and the
		// scroll waits a `tick()` for THIS render — the collapse included — to
		// land.
		tick().then(() => {
			document
				.querySelector<HTMLElement>(
					monthMode
						? `[data-testid="agenda-month-row-${id}"]`
						: `[data-testid="agenda-row-${id}"], [data-testid="agenda-recent-row-${id}"]`
				)
				?.scrollIntoView({ block: 'center', behavior: 'smooth' });
		});
		if (justCreatedEventMarkTimer !== null) clearTimeout(justCreatedEventMarkTimer);
		justCreatedEventId = id;
		justCreatedEventMarkTimer = setTimeout(() => {
			justCreatedEventId = null;
			justCreatedEventMarkTimer = null;
		}, JUST_CREATED_MARK_MS);
	});

	/** Cancel / Escape: dismiss WITHOUT writing, and give focus somewhere real.
	 *
	 *  #132/T6 review F2 — refused while the create is on the wire, for the same
	 *  reason `dismissSeasonCreateForm` is: `eventCreateError` renders only inside
	 *  `{#if eventCreateOpen}`, so tearing the form down mid-flight turns a failed
	 *  create into a silent one. The guard sits HERE and not in
	 *  `closeEventCreateForm` — the success path calls that while the flag is
	 *  still true. */
	function dismissEventCreateForm(): void {
		if (eventCreateSubmitting) return;
		const origin = eventCreateOrigin;
		closeEventCreateForm();
		restoreEventCreateFocus(origin);
	}

	function onEventCreateFormKeydown(event: KeyboardEvent): void {
		if (event.key === 'Escape') dismissEventCreateForm();
	}

	/** A season change invalidates whatever series was picked for the OLD
	 *  season — series ids are season-scoped, so a stale one would either 404
	 *  or (worse) point at some other season's series. */
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
		// A series carries the name (v4E makes it mandatory on event_series), so
		// picking one can retire a pending "needs a name" refusal.
		clearEventCreateError();
		eventCreateSeriesId = newSeriesId;
		if (!newSeriesId) {
			eventCreateSeriesDefaults = null;
			return;
		}
		const current = selected;
		if (!current) return;
		const cfg = { db: current.db, token: getToken() ?? '' };
		// Same double guard as the series list (review F3). Preview-only, but a
		// late reply for a since-abandoned series also mis-names the success
		// announcement, which reads `eventCreateSeriesDefaults?.name`.
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
		if (eventCreateConductors.some((c) => c.id === selection.id)) return; // no duplicate chips
		eventCreateConductors = [...eventCreateConductors, { id: selection.id, name: selection.label }];
	}

	function removeEventCreateConductor(id: string): void {
		eventCreateConductors = eventCreateConductors.filter((c) => c.id !== id);
	}

	/** #209 — the conductor native-select's source: roster members not already
	 *  picked, in ROSTER ORDER (Gama ruling 3). Off the SAME cached
	 *  `rosterRows`/`rosterSections` the season-manage panel populates —
	 *  `getRoster`/`getSections` above are the one cache each, so opening this
	 *  form after the panel (or vice versa) never pays a second fan-out. */
	const eventCreateConductorOptions = $derived(
		rosterPickerOptions(eventCreateConductors.map((c) => c.id))
	);

	/** '' (blank) → not sent; a non-blank, non-finite typed value (a bare '-'
	 *  or stray text a number input still lets through) also drops rather than
	 *  reaching `createEvent` as `NaN`. */
	function eventCreateNumberOrUndefined(raw: string): number | undefined {
		const trimmed = raw.trim();
		if (!trimmed) return undefined;
		const n = Number(trimmed);
		return Number.isFinite(n) ? n : undefined;
	}

	/** Re-reads the panel's series list after a PANEL-born create — the new
	 *  occurrence must land in the counts the panel already shows. Mirrors
	 *  `openSeasonManagePanel`'s reads, minus the roster/open-state
	 *  parts (this is a refresh, not a (re)open). #313 removed this function's
	 *  standalone-event sibling read along with the panel's event rows.
	 *
	 *  #234 review 2 F1 — the repertoire section rides along. Its state used to be
	 *  wiped by `resetManagement` on every reload and rebuilt only by the next
	 *  panel OPEN; now that it survives a `{ keepSeasonManage: true }` reload it
	 *  needs the same re-read the list gets, so the whole panel reconciles at one
	 *  seam instead of one section quietly showing pre-write truth. Every caller
	 *  passes the PANEL's own season (each one guards that), so this is always
	 *  the section's own season. */
	function refreshSeasonManageLists(cfg: ManageCfg, seasonId: string): void {
		const thisRequest = requestId;
		// #277 review F1 — the season-switch ticket, same capture-compare as the
		// panel's own reads: a switch between this refresh and its settle must not
		// let the season just left repaint the rows of the season now open.
		const thisSwitch = seasonManageSwitchGeneration;
		loadPanelRepertoire(cfg, seasonId);
		listEventSeriesForSeason(cfg, seasonId)
			.then((result) => {
				if (thisRequest !== requestId || thisSwitch !== seasonManageSwitchGeneration) return;
				seasonManageSeries = result.items;
				seasonManageSeriesError = false;
				// #321 review F1 — a refresh re-reads the same bounded pair, so it
				// re-derives the notice for the rows it just replaced (a create that
				// pushes the read over its cap raises it; one that does not, clears it).
				seasonManagePartial = result.truncated;
			})
			.catch((e) => {
				if (thisRequest !== requestId || thisSwitch !== seasonManageSwitchGeneration) return;
				console.error('agenda: refreshing the season\'s event series after an event create failed', e);
				seasonManageSeriesError = true;
			});
	}

	// #197 — per-row DELETE for the season-manage panel's series list. The
	// `seasonManageDeleteError` slot is reset at the START of every
	// attempt so a second try, success or failure, always reflects the latest
	// tap. A failed delete leaves the row exactly where it was — no optimistic
	// removal (unlike the conductor chip above, there is nothing cheap to revert
	// TO once a row is gone from the list).
	//
	// #197 review F2 — every delete is TWO taps: `armSeasonManageDelete` swaps
	// the row's `×` for confirm/cancel, and only the confirm calls the write.

	/** Arm a row's two-step confirm, moving focus onto the confirm button that
	 *  replaces the `×` (the arming click unmounts the focused element — WCAG
	 *  2.4.3, the roster's `armRemove` shape verbatim). A fresh attempt owns the
	 *  error slot. */
	async function armSeasonManageDelete(rowId: string, confirmTestid: string): Promise<void> {
		seasonManageDeleteError = null;
		seasonManageDeleteArmed = rowId;
		seasonManageArmedSeriesCount = null;
		seasonManageDeleteScope = null;
		await tick();
		document.querySelector<HTMLElement>(`[data-testid="${confirmTestid}"]`)?.focus();
	}

	/**
	 * Arm a SERIES row, and re-read how many occurrences that series actually
	 * holds right now (#197 review 2nd pass F2). Until that read lands the
	 * confirm quotes no number at all: the panel's own `eventCount` comes from a
	 * season-wide capped list read grouped client-side, so it under-reports a
	 * season past 500 events and knows nothing of an occurrence created since —
	 * and this confirm is the last thing an operator sees before an irreversible
	 * cascade. A failed count read leaves the count-free confirm standing rather
	 * than promising a stale figure; the delete itself still counts for real.
	 */
	async function armSeasonManageSeriesDelete(series: SeriesListItem): Promise<void> {
		const cfg = selected ? { db: selected.db, token: getToken() ?? '' } : null;
		await armSeasonManageDelete(series.id, `season-manage-series-delete-confirm-${series.id}`);
		if (!cfg) return;
		try {
			const live = await apiCountSeriesOccurrences(cfg, series.id);
			// The list row is stale too — correct it, so the row's "Events: N" and
			// the confirm never show two different numbers.
			seasonManageSeries = seasonManageSeries.map((row) =>
				row.id === series.id ? { ...row, eventCount: live } : row
			);
			if (seasonManageDeleteArmed === series.id) seasonManageArmedSeriesCount = live;
		} catch (e) {
			console.error('agenda: live occurrence count for the delete confirm failed', series.id, e);
		}
	}

	/** Disarm, handing focus back to the `×` that comes back. */
	async function disarmSeasonManageDelete(disarmTestid: string): Promise<void> {
		seasonManageDeleteArmed = null;
		seasonManageArmedSeriesCount = null;
		seasonManageDeleteScope = null;
		await tick();
		document.querySelector<HTMLElement>(`[data-testid="${disarmTestid}"]`)?.focus();
	}

	/**
	 * Arm the SEASON's own delete, and re-read its live scope (#217) — the
	 * season-level analogue of `armSeasonManageSeriesDelete`. Until that read
	 * lands (or if it fails) the confirm quotes no scope at all, rather than a
	 * number the write never checked.
	 *
	 * The landing check is generation-guarded as well as armed-guarded (review
	 * F2): `SEASON_DELETE_ROW_ID` is a CONSTANT, not an entity id, so "the
	 * season × is armed" reads true again the moment the operator arms a
	 * DIFFERENT collective's season — and a scope read still in flight from the
	 * one they left would otherwise paint its numbers into a confirm whose
	 * cascade never checked them. `resetSeasonManage` bumps the generation on
	 * every switch, exactly as it does for the cascade's own progress ticks.
	 */
	async function armSeasonManageSeasonDelete(): Promise<void> {
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

	/** The failed-delete slot's shape, from whatever the write layer rejected
	 *  with (#197 review F3/F5). Duck-typed discriminators, never `instanceof`
	 *  — the rejection crosses a mocked module boundary in the page's specs. */
	function seasonManageDeleteFailure(
		list: 'series' | 'season',
		reason: unknown
	): NonNullable<typeof seasonManageDeleteError> {
		if (isDeleteForbidden(reason)) return { list, reason: 'forbidden' };
		// #217 — the season cascade's OWN partial shape, told apart from a
		// child series' (a season failure can wrap one of those in its own
		// `failure` chain, but `isDeleteForbidden`/the check above already
		// unwrapped a 403; anything else that reaches here for a season list is
		// the season's own story, never a child's).
		if (list === 'season' && isSeasonCascadePartial(reason)) {
			const partial = reason as { deletedCount?: number; totalCount?: number };
			return {
				list,
				reason: 'partial-season',
				deleted: partial.deletedCount ?? 0,
				total: partial.totalCount ?? 0
			};
		}
		// #313 — this used to also recognise `isEventCascadePartial(reason)`
		// (the standalone-event delete's own partial shape, reason
		// 'partial-event'). Removed as dead code, not merely unreachable: the
		// series/season cascades below ALWAYS wrap a failing occurrence's
		// EventCascadePartialError inside their OWN SeriesCascadePartialError /
		// SeasonCascadePartialError (seasonManage.ts, `deleteEventSeries`/
		// `deleteSeason`), so a RAW EventCascadePartialError could only ever
		// reach here from `onSeasonManageEventDelete`'s own direct `deleteEvent`
		// call — which left with the standalone-event rows.
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

	/** The copy for a failed delete. `forbidden` deliberately does NOT invite a
	 *  retry — the same caller will be refused every time (#197 review F3). */
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

	/**
	 * #197 review F4 — a successful delete just changed the world this page
	 * reads, so the page re-reads it, exactly as the CREATE path does. The local
	 * splice above is only the instant feedback: without the refresh the same
	 * screen contradicted itself — the deleted standalone event kept its
	 * <AgendaList> card directly below the panel, and a deleted series' now-gone
	 * occurrences kept their agenda rows, until a manual reload.
	 * `keepSeasonManage: true` is the panel-preserving reload (see
	 * `loadForSelected`), and `refreshSeasonManageLists` re-reads the panel's own
	 * two lists under the requestId the reload just bumped.
	 */
	function refreshAfterSeasonManageDelete(cfg: ManageCfg): void {
		const panelSeasonId = manageableSeasonId;
		loadForSelected({ keepSeasonManage: true });
		if (panelSeasonId !== null) refreshSeasonManageLists(cfg, panelSeasonId);
	}

	function onSeasonManageSeriesDelete(series: SeriesListItem): void {
		if (!selected) return;
		if (seasonManageDeletePendingId !== null) return; // one delete on the wire at a time
		const cfg = { db: selected.db, token: getToken() ?? '' };
		seasonManageDeleteError = null;
		seasonManageDeleteProgress = null;
		seasonManageDeletePendingId = series.id;
		const generation = seasonManageDeleteGeneration;
		apiDeleteEventSeries(cfg, series.id, undefined, {
			onProgress: makeSeasonManageDeleteProgress(generation)
		})
			.then((deletedOccurrences) => {
				// #277 review F3 — the guard its season-delete twin
				// (`onSeasonManageSeasonDelete`) already carries, for the same reason:
				// `resetSeasonManage` bumps the generation on every switch, so a
				// cascade whose season (or collective) the operator has since left
				// must not announce itself, splice the season now open, or fire that
				// season's agenda reload. The captured generation reached only the
				// progress sink before this.
				if (generation !== seasonManageDeleteGeneration) return;
				seasonManageDeleteArmed = null;
				seasonManageArmedSeriesCount = null;
				seasonManageSeries = seasonManageSeries.filter((row) => row.id !== series.id);
				// The cascade took the occurrences with it — say so, by name and
				// count. #197 review 2nd pass F2: the count is the CASCADE's own
				// return value, never the row's client-derived `eventCount`, which
				// was read at a different moment by a different (capped) query.
				seasonManageDeleteStatus =
					deletedOccurrences > 0
						? m.season_manage_series_deleted({ name: series.name, count: deletedOccurrences })
						: m.season_manage_deleted({ name: series.name });
				refreshAfterSeasonManageDelete(cfg);
			})
			.catch((e) => {
				console.error('agenda: deleting event series failed', series.id, e);
				// Symmetric guard (#277 review F3): a stale failure must not paint an
				// error slot belonging to the season the operator moved to.
				if (generation !== seasonManageDeleteGeneration) return;
				seasonManageDeleteError = seasonManageDeleteFailure('series', e);
			})
			.finally(() => {
				seasonManageDeletePendingId = null;
				if (generation === seasonManageDeleteGeneration) seasonManageDeleteProgress = null;
			});
	}

	/**
	 * Delete the SEASON itself — #217 (folds #216). The confirm has already
	 * quoted the live scope (`armSeasonManageSeasonDelete`); this call is what
	 * actually runs the cascade. On success the panel's whole subject is gone,
	 * so the reload is the PLAIN `loadForSelected()` (never `keepSeasonManage`
	 * — a kept panel would be managing a season that no longer exists), which
	 * tears the panel down and recomputes the next manageable season. The
	 * success announcement is set AFTER that reload: `loadForSelected`'s own
	 * teardown (`resetSeasonManage`) blanks `seasonManageDeleteStatus` first,
	 * and this line runs synchronously after it returns, so the announcement
	 * survives into the still-mounted (panel-independent) status region.
	 */
	function onSeasonManageSeasonDelete(): void {
		if (!selected || manageableSeasonId === null) return;
		if (seasonManageDeletePendingId !== null) return;
		const cfg = { db: selected.db, token: getToken() ?? '' };
		const seasonId = manageableSeasonId;
		// #236 — captured from `seasonManageDeleteName`, not the raw
		// `seasonManageName` state: the delete can now run before the panel has
		// ever opened, when only the fallback source holds a name at all.
		const seasonName = seasonManageDeleteName;
		seasonManageDeleteError = null;
		seasonManageDeleteProgress = null;
		seasonManageDeletePendingId = SEASON_DELETE_ROW_ID;
		const generation = seasonManageDeleteGeneration;
		apiDeleteSeason(cfg, seasonId, undefined, {
			onProgress: makeSeasonManageDeleteProgress(generation)
		})
			.then(() => {
				// #217 review F3 — the same generation guard the progress sink and
				// the `finally` below already carry: if the operator switched
				// collective mid-cascade, `resetSeasonManage` has bumped the
				// generation and this run belongs to a screen that is gone. Landing
				// it anyway would reload the NEW collective's agenda (tearing down
				// its just-loaded panel) and announce a season the operator has left
				// behind.
				if (generation !== seasonManageDeleteGeneration) return;
				loadForSelected();
				// Its own key, not the series/event rows' `season_manage_deleted`
				// (#217 review F3): the two are byte-identical only in en/et/uk —
				// lv agrees the participle with the noun's gender ("sezona … ir
				// dzēsta" vs "notikums … ir dzēsts"), so one shared key would
				// mis-decline half of its uses.
				seasonManageDeleteStatus = m.season_delete_success({ name: seasonName });
			})
			.catch((e) => {
				console.error('agenda: deleting season failed', seasonId, e);
				// Symmetric guard: a stale failure must not paint an error slot in
				// the collective the operator moved to.
				if (generation !== seasonManageDeleteGeneration) return;
				seasonManageDeleteError = seasonManageDeleteFailure('season', e);
			})
			.finally(() => {
				seasonManageDeletePendingId = null;
				if (generation === seasonManageDeleteGeneration) seasonManageDeleteProgress = null;
			});
	}

	// #313 — the #196 standalone-event delete (`onSeasonManageEventDelete`) and
	// the whole conversion wiring (`tallinnWallClockParts` through
	// `submitEventConvert`) RELOCATED to the event page
	// (src/routes/event/[id]/+page.svelte): the panel's per-row entry points
	// they served are removed. See that file for the unchanged contract.

	/**
	 * Submit: `createEvent` is the ONE create seam (T1) — org from
	 * `resolveDatabaseEntityId`, the chosen season in `extraParentIds`, the chosen
	 * series (if any) in its own named `seriesId`. Only EXPLICITLY-SET fields
	 * reach the call: an untouched inherited field (name/duration/location)
	 * stays blank/absent here, never a frozen copy of the series default —
	 * `createEvent` itself is what tracks the series on the read side.
	 *
	 * An incomplete submit is refused BEFORE any fetch, each refusal naming its
	 * own field (#132/T4 review F1): season (an event with no season parent is
	 * invisible to every agenda read — `listEvents` selects on it), type,
	 * start, and — for a STANDALONE event only — a name.
	 */
	async function submitEventCreate(): Promise<void> {
		if (eventCreateSubmitting) return; // #132/T2 review F1 shape — no duplicate creates in flight

		// A fresh attempt owns both the error slot and the status slot.
		clearEventCreateError();
		eventCreateStatus = '';

		// #132/T4 review (2nd pass) F2 — the panel is scoped to ITS OWN season,
		// while the form's season select is only PREFILLED from it and stays fully
		// editable. Captured up front because the success path's `loadForSelected`
		// blanks `manageableSeasonId` (via `resetManagement`) before the refresh
		// runs. #167 — the panel's season is now the MANAGEABLE one, not
		// `currentSeasonId`.
		const panelSeasonId = manageableSeasonId;

		// ── validation BEFORE any fetch (#132/T4 review F1) ──────────────────
		// `createEvent` validates too, but a thrown-and-caught write is not a
		// validation UX: it surfaces as the generic "Couldn't create the event.
		// Try again.", which names no field and blames a network that was never
		// asked. Each refusal below names its own box, T2's discipline.
		const seasonId = eventCreateSeasonId;
		if (!seasonId) {
			setEventCreateError(m.event_create_season_required, 'season');
			return;
		}
		// #242 ruling — the picker starts on the '' placeholder and the user must
		// make one explicit choice; this is the reachable refusal #199 built as a
		// defensive floor before the picker could ever be blank.
		const typeValue = eventCreateType;
		if (!typeValue) {
			setEventCreateError(m.event_create_type_required, 'type');
			return;
		}
		if (!eventCreateDatetime) {
			setEventCreateError(m.event_create_datetime_required, 'datetime');
			return;
		}
		// TE.4 convention, exactly: the viewer types a TALLINN wall clock, the
		// wire carries the UTC instant. '' means unparseable — refused here
		// rather than sent as an empty start (which every agenda read sorts on).
		const startDatetime = tallinnLocalToUtcIso(eventCreateDatetime);
		if (!startDatetime) {
			setEventCreateError(m.event_create_datetime_required, 'datetime');
			return;
		}
		// #243 — the end pair replaces the duration number input; derived BEFORE
		// any fetch, same discipline as every other validation on this form. A
		// blank end (date+time not both filled) is the "inherit from series"
		// state — `durationValue` stays undefined and no key reaches the wire.
		const derivedDuration = eventCreateDerivedDuration(startDatetime, eventCreateEndDatetime);
		if (derivedDuration === 'range') {
			setEventCreateError(m.event_end_before_start, 'end');
			return;
		}
		const durationValue = derivedDuration;
		const trimmedName = eventCreateName.trim();
		// A SERIES occurrence inherits its name from the series (the read-side
		// merge), so a blank name there is the normal, correct shape. A
		// standalone event has nothing to inherit from — an unnamed one renders
		// as a blank row everywhere.
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

		eventCreateSubmitting = true;
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
				// #244 — the return value used to be discarded; it is the new
				// event's entity id, and both the row-surfacing and the
				// filter-admits-the-type check below need it.
				newEventId = await createEvent(cfg, input);
			} catch (e) {
				console.error('agenda: event create failed', e);
				setEventCreateError(m.event_create_failed, null);
				return;
			}

			const origin = eventCreateOrigin;
			// #298 — moved ABOVE the status write: the announcement's WORDING
			// depends on this outcome (below), so it must be known before the
			// status is set, not after. Reads only — `agendaTypeFilter` stays a
			// five-writer variable (declaration / the user's own chip / a
			// vanished chip / collective switch / no-agenda); this create path
			// still never narrows it to fit a new event.
			const showableUnderFilter =
				agendaTypeFilter === 'all' || agendaFilterBucketOf(typeValue) === agendaTypeFilter;
			// #132/T4 review F3 — say what happened BEFORE the form unmounts. An
			// own name wins; a series occurrence has none of its own, so the
			// inherited series name (or, failing that, the type) names it.
			// #244 / #298 Done-when #6 — when the active filter would hide the
			// new event from the list the viewer is looking at, plain
			// "created" is a lie of omission: say BOTH halves, created AND why
			// it will not appear.
			const createdName = trimmedName || eventCreateSeriesDefaults?.name || typeValue;
			const createdWhen = eventCreateStatusFmt(new Date(startDatetime));
			eventCreateStatus = showableUnderFilter
				? m.event_created({ name: createdName, when: createdWhen })
				: m.event_created_hidden_by_filter({ name: createdName, when: createdWhen });
			closeEventCreateForm();
			// The write just changed the world this page reads — refresh for real
			// (same discipline as season create). `loadForSelected` bumps
			// `requestId`, so the panel refresh below (guarded by the SAME id)
			// must run AFTER it, not before.
			//
			// #132/T4 review F2 — a PANEL-born create keeps its panel: the default
			// reload tears the panel down (`resetSeasonManage`), which both
			// discarded the refresh below and dropped focus at <body>. The new
			// occurrence must land in the counts the panel is STILL showing.
			loadForSelected({ keepSeasonManage: origin === 'panel' });
			// …the PANEL's season, not the form's (2nd-pass F2). If the viewer
			// switched the select away, the panel still shows its own season and
			// nothing it lists changed — refreshing with the form's `seasonId`
			// would swap the OTHER season's rows in under the panel's heading.
			if (origin === 'panel' && panelSeasonId === seasonId) {
				refreshSeasonManageLists(cfg, panelSeasonId);
			}

			// #244 (amended by issuecomment-5594475154) — the panel gets out of
			// the way only when there is a result to uncover. That is decided in
			// two stages:
			//
			//   1. the cheap early-out: `showableUnderFilter`, computed above
			//      (now also driving the announcement's wording, #298).
			//   2. the actual decision, later and elsewhere: `surfaceCreatedEvent`
			//      arms a watcher that collapses the panel when the created row
			//      is OBSERVED on the agenda. See its declaration for why a
			//      synchronous collapse here both dropped focus at <body> for
			//      the length of the reload and could collapse over nothing at
			//      all (#244 review F1/F3).
			if (origin === 'panel' && showableUnderFilter) {
				surfaceCreatedEvent(newEventId);
			}
			// The panel is still open on EVERY path at this instant — the
			// collapse, if it comes at all, comes later — so it remains the
			// deliberate focus target now, and the reload window is never spent
			// with focus at <body>. When the collapse does land,
			// `closeSeasonManagePanel()` hands focus on to the collapsed card's
			// own `season-card-expand` control (#261).
			restoreEventCreateFocus(origin);
		} finally {
			// Released on every path — a stuck `true` would leave the form
			// permanently unsubmittable.
			eventCreateSubmitting = false;
		}
	}

	// Auto-focus the name input the instant the inline form appears, same
	// discipline as the season-create form above.
	$effect(() => {
		if (eventCreateOpen && eventCreateNameInput) eventCreateNameInput.focus();
	});

	// ── #132/T5 — event SERIES creation + the bulk occurrence generator ────────
	//
	// Reachable ONLY from T3's panel [+ Series] stub (`season-manage-add-series`)
	// — there is no page-level entry point the way event-create has two. The
	// template fields (name/type/duration/location/description) plus the
	// ALWAYS-collected schedule fields (v4E requires interval_days/start_time/
	// start_date/end_date on event_series, so the sketch's "optional recurrence"
	// can only mean optional GENERATION — see the RED spec's header). #240 —
	// generation is always on: the form always shows the live preview and
	// submit always runs a serial bulk `createEvent` per occurrence.

	/** The series-create fields a validation message can belong to; `null` = a
	 *  form-wide failure (no org, a failed write) that names no single box. */
	type SeriesCreateErrorField =
		| 'name'
		| 'type'
		| 'time'
		| 'duration'
		| 'day'
		| 'from'
		| 'until'
		| null;

	let seriesCreateOpen = $state(false);
	// Captured at OPEN, not re-read from `manageableSeasonId` at submit — the form
	// has no season picker of its own (unlike event-create's), so its season is
	// fixed to whichever season the panel was managing when [+ Series] was
	// clicked.
	let seriesCreateSeasonId = $state('');
	let seriesCreateName = $state('');
	// #194/#202 review F3 — the 'rehearsal' default STAYS. #199 turned the box
	// itself into the canonical, localized <select> (CANONICAL_EVENT_TYPES,
	// schema order); 'rehearsal' remains its pre-selected option, the workflow's
	// own default for a new series.
	let seriesCreateType = $state('rehearsal');
	let seriesCreateDuration = $state('');
	let seriesCreateLocation = $state('');
	let seriesCreateDescription = $state('');
	let seriesCreateRepeat = $state<RepeatPattern>('weekly');
	/** '' = no day chosen — the SELECT's own placeholder value, not a parsed 0. */
	let seriesCreateDay = $state('');
	let seriesCreateTime = $state('');
	let seriesCreateFrom = $state('');
	let seriesCreateUntil = $state('');
	/** #215 — the ONLY skip mechanism now: toggled by tapping a candidate-date
	 *  chip in the preview grid. No separate input/Add/removable-chip UI. */
	let seriesCreateSkipDates = $state<string[]>([]);
	/**
	 * #241 — how many of `seriesCreateGridDates` (chronological) the grid
	 * currently DRAWS; `series-create-show-next` / `series-create-show-all`
	 * raise it. A VIEW-only counter: toggling a chip's skip state never
	 * touches it (skips live in `seriesCreateSkipDates`, an entirely
	 * different set — see the reset effect below for why a plain length
	 * comparison cannot drive this).
	 */
	let seriesCreateRevealedCount = $state(50);
	let seriesCreateSubmitting = $state(false);
	/**
	 * #138 review 2 — WHICH db the in-flight run belongs to (null when nothing is
	 * submitting). `seriesCreateSubmitting` is global while the resume records
	 * are per-db, and `restoreSeriesCreateRun` needs to tell "a run is on the
	 * wire in the collective I am arriving at" (leave it alone) from "a run is
	 * still finishing in the collective just LEFT" (irrelevant here — every
	 * remaining write in it is behind its own `dbChanged()` check and touches
	 * only `seriesCreateResumeByDb[runDb]`, never form state). Mirrors the
	 * submit-local `runDb` pin; set and cleared with `seriesCreateSubmitting`.
	 */
	let seriesRunDb = $state<string | null>(null);
	let seriesCreateError = $state<(() => string) | null>(null);
	/** Which box a refusal belongs to — the T4 shape (`EventCreateErrorField`),
	 *  applied here so a screen reader hears WHICH field was rejected when the
	 *  viewer tabs back into it, not just a disembodied alert (#132/T5 review
	 *  F4). `null` = form-wide (no org, a failed write) and names no box. */
	let seriesCreateErrorField = $state<SeriesCreateErrorField>(null);
	/** Non-null while the bulk loop is running — `current` is the occurrence
	 *  IN FLIGHT (1-based), not the completed count (the RED spec pins "current
	 *  1 of 3 while the FIRST POST is in flight"). */
	let seriesCreateProgress = $state<{ current: number; total: number } | null>(null);
	/**
	 * Everything the series form needs to RE-RENDER a run that stopped in a db
	 * the viewer has since left (#138 review F2). Pinned at submit — never
	 * re-read from the live form afterwards: the switch's own teardown unmounts
	 * the form, and `openSeriesCreateForm` blanks every one of these fields, so
	 * a snapshot is the only thing that can still describe the run on return.
	 */
	type SeriesCreateFormSnapshot = {
		seasonId: string;
		name: string;
		type: string;
		duration: string;
		location: string;
		description: string;
		repeat: RepeatPattern;
		day: string;
		time: string;
		from: string;
		until: string;
		skipDates: string[];
	};

	type SeriesResumeEntry = {
		seriesId: string;
		remaining: string[];
		total: number;
		form: SeriesCreateFormSnapshot;
	};

	/**
	 * #138 — KEYED BY DB. Set when a bulk run STOPPED partway (an occurrence
	 * failed, OR the viewer switched collectives mid-generation): the series is
	 * already on the wire and `remaining` are the occurrences that never landed.
	 * A re-submit RESUMES from here instead of creating a second series and
	 * re-POSTing the occurrences that already succeeded.
	 *
	 * Was a single unkeyed slot: a collective switch mid-generation nulled it
	 * (via `closeSeriesCreateForm`) along with the form, so the OLD collective's
	 * still-owed occurrences left no in-app record — returning to it and
	 * re-submitting created a SECOND series under the same season and re-POSTed
	 * the occurrences that already landed.
	 *
	 * #138 review F1 — keying alone did NOT fix that. `closeSeriesCreateForm`
	 * still cleared "the currently selected db", and during a switch `selected`
	 * has ALREADY moved to the db being switched TO — so returning to the
	 * collective that owns a stopped run deleted exactly that db's entry, the
	 * only direction #138 is about. UNMOUNTING the form and FORGETTING a run are
	 * now separate acts: `closeSeriesCreateForm` only unmounts, and an entry is
	 * cleared at the three points that genuinely mean "this run is done or
	 * abandoned" — a clean finish, `dismissSeriesCreateForm` (Cancel/Escape),
	 * and closing out with generation switched off.
	 */
	let seriesCreateResumeByDb = $state<Record<string, SeriesResumeEntry>>({});

	/** The CURRENT collective's own entry (or null) — every reader below wants
	 *  THIS, never the raw map. Re-derives on every collective switch, so a
	 *  return to a db with a stopped run re-surfaces its lock automatically. */
	const seriesCreateResume = $derived(selected ? (seriesCreateResumeByDb[selected.db] ?? null) : null);

	/** Write helper — touches ONLY `db`'s entry. */
	function setSeriesCreateResume(db: string, entry: SeriesResumeEntry): void {
		seriesCreateResumeByDb = { ...seriesCreateResumeByDb, [db]: entry };
	}

	/** Clear helper — touches ONLY `db`'s entry, never another collective's. A
	 *  no-op (no reassignment) when `db` has nothing recorded, so the explicit
	 *  close-out callers don't fire a reactive update for collectives that never
	 *  had a run. */
	function clearSeriesCreateResume(db: string): void {
		if (!(db in seriesCreateResumeByDb)) return;
		const next = { ...seriesCreateResumeByDb };
		delete next[db];
		seriesCreateResumeByDb = next;
	}

	/** The CURRENT collective's entry, forgotten. The operator-facing exits
	 *  (Cancel/Escape, generation switched off) and the clean-finish path go
	 *  through here; a collective switch never does. */
	function clearSeriesCreateResumeForSelected(): void {
		if (selected) clearSeriesCreateResume(selected.db);
	}

	let seriesCreateNameInput = $state<HTMLInputElement | null>(null);

	/**
	 * #132/T6 review F1 — the in-flight floor under the mutual exclusion below.
	 *
	 * Each creation form already refuses its OWN dismissal while its write is on
	 * the wire (`dismissSeriesCreateForm`, and the submit guards). T6's mutual
	 * exclusion then added a second, un-guarded way to unmount a form: opening
	 * ANOTHER one. That is worst for the series form, whose generation run is
	 * many serial POSTs wide — unmounting it mid-run leaves the loop POSTing
	 * events the viewer believes she cancelled, and throws away
	 * `seriesCreateResume` (the only record of what a stopped run still owes).
	 *
	 * So: while ANY create is in flight, no creation form opens and no entry
	 * point is clickable. Declared here (after all three flags) so the guard
	 * reads as one fact; the `open*` functions that consume it run long after
	 * module init, so the forward reference is only textual.
	 */
	const anyCreateSubmitting = $derived(
		seasonCreateSubmitting || eventCreateSubmitting || seriesCreateSubmitting
	);

	/**
	 * #132/T6 review F1 (follow-up) — the guard above was pinned to the wrong
	 * window.
	 *
	 * `anyCreateSubmitting` is true only while a write is literally on the wire.
	 * But a bulk generation run that STOPS partway sets `seriesCreateResume` and
	 * then releases `seriesCreateSubmitting` in its `finally` — so the state the
	 * guard exists to protect (a stopped run that still owes occurrences) is
	 * precisely the state in which the guard is FALSE. In that window every other
	 * entry point went live again, and each of them calls
	 * `closeSeriesCreateForm()`, which nulls `seriesCreateResume` and unmounts the
	 * form. There is then no way back: re-opening [+ Series] resets the resume, so
	 * the next submit creates a SECOND series under the same season and re-POSTs
	 * the occurrences that already landed.
	 *
	 * So the predicate the entry points gate on is "the series form still owes
	 * work", not "a write is in flight". The operator keeps an explicit exit:
	 * `dismissSeriesCreateForm` (Cancel/Escape) is unguarded while nothing is
	 * submitting, so cancelling the stopped run frees every other entry point.
	 *
	 * #138 update — `openSeriesCreateForm` / `season-manage-add-series` USED to
	 * stay on the narrower `anyCreateSubmitting` on the theory that "a non-null
	 * resume implies the series form is already open, so this button is never
	 * rendered while one is outstanding." Keying `seriesCreateResumeByDb` by db
	 * broke that: a collective switch away and back leaves `seriesCreateOpen`
	 * false (the switch unmounted the form) while THIS db's resume entry
	 * survives and re-surfaces via `seriesCreateResume` — exactly the "button
	 * visible, resume non-null" state the old comment assumed couldn't happen.
	 * Both now gate on `createEntryPointsBlocked` too, so returning to a
	 * collective with a still-owed run cannot spawn a second series for it. The
	 * blocked state is never a dead end: `restoreSeriesCreateRun` re-opens the
	 * form on that same return, so Submit (finish) and Cancel (abandon) are on
	 * screen with the "N remaining of M" notice that explains the lock.
	 */
	const seriesRunUnfinished = $derived(seriesCreateSubmitting || seriesCreateResume !== null);
	/** What every OTHER entry point gates on: an in-flight write anywhere, or a
	 *  stopped series run whose remainder is still recorded in the open form.
	 *  #313 — the event-conversion run this used to OR in
	 *  (`eventConvertRunUnfinished`) relocated to the event page with the rest
	 *  of that flow. */
	const createEntryPointsBlocked = $derived(anyCreateSubmitting || seriesRunUnfinished);

	/** #213 Gama ruling (1), retargeted #261 — the title-row COLLAPSE control
	 *  (the gear's successor as the only close control left) renders DISABLED
	 *  while a bulk run is unfinished, following the `createEntryPointsBlocked`
	 *  precedent, so the panel cannot be silently discarded mid-run: an
	 *  enabled no-op would lie about the refusal `closeSeasonManagePanel`
	 *  already enforces. Narrower than `createEntryPointsBlocked` on purpose —
	 *  a merely in-flight season/event create (`anyCreateSubmitting`) does not
	 *  disable it, only an unfinished series/conversion run does.
	 *
	 *  #213 review F2 — the refusal covers the CLOSE direction ONLY, hence the
	 *  `seasonManageOpen` conjunct: the collapse control only exists in the
	 *  opened state anyway, but the conjunct also documents that a stopped
	 *  series run can outlive the panel, closing it with `seriesRunUnfinished`
	 *  still true — the COLLAPSED expand control (season-card-expand) is never
	 *  gated on this, it stays live so the admin surface is never entirely dead
	 *  (#138 review F2, #135). */
	const seasonCardCollapseDisabled = $derived(seasonManageOpen && seriesRunUnfinished);

	// #261 (stated choice) — role="toolbar" and the #156 roving tabindex
	// pattern retire with the gear: at 1–2 plain buttons (the title-row
	// collapse control plus either the idle trashcan or its armed
	// confirm/cancel pair) the roving-toolbar pattern is degenerate. Every
	// admin button is a natural tab stop now (no explicit tabindex).

	function setSeriesCreateError(msg: () => string, field: SeriesCreateErrorField): void {
		seriesCreateError = msg;
		seriesCreateErrorField = field;
	}

	function clearSeriesCreateError(): void {
		seriesCreateError = null;
		seriesCreateErrorField = null;
	}

	/** `aria-describedby` for the field that currently owns the message. */
	function seriesCreateDescribedBy(field: SeriesCreateErrorField): string | undefined {
		return seriesCreateErrorField === field ? 'series-create-error' : undefined;
	}

	function seriesCreateInvalid(field: SeriesCreateErrorField): true | undefined {
		return seriesCreateErrorField === field ? true : undefined;
	}

	/**
	 * #132/T5 review F5 — while a stopped run is resumable, the template and
	 * recurrence boxes are INERT: submit skips `createEventSeries` (the series is
	 * already on the wire) and writes exactly `resume.remaining`, so an edit to
	 * name/type/duration/location/description/recurrence would be silently
	 * discarded. Disabling them makes the form read as "finish this run" rather
	 * than "edit and re-submit". The GENERATE checkbox stays live — turning it
	 * off is the documented way to close out a stopped run without writing the
	 * rest.
	 */
	const seriesCreateLocked = $derived(seriesCreateResume !== null);

	/**
	 * Whether the day-of-week picker is a REAL input for the chosen pattern.
	 * `generateEventDates` IGNORES `dayOfWeek` for 'daily' (recurrence.ts:91) —
	 * so demanding a day there would gate generation behind a field that has no
	 * effect on the output. Daily → no day needed, and the select is not rendered
	 * at all (an inert control presented as required is the bug, not the label).
	 */
	const seriesCreateDayApplies = $derived(seriesCreateRepeat !== 'daily');
	/** The dayOfWeek the generator gets — 0 is a harmless filler for 'daily',
	 *  which never reads it. */
	const seriesCreateDayOfWeek = $derived(seriesCreateDay === '' ? 0 : Number(seriesCreateDay));

	/**
	 * The live preview's source — the REAL `generateEventDates` (T5's own pinned
	 * point: the preview must be the actual generator, not a lookalike),
	 * recomputed on every param change via `$derived`. `null` (no render) unless
	 * time/from/until are set — plus a day WHEN THE PATTERN USES ONE. An
	 * incomplete recurrence has nothing determinate to preview yet.
	 *
	 * #215 — this is now the SKIP-APPLIED set: it feeds the live count line and
	 * the submit-disabled gate (Gama ruling 2 — all chips toggled off means this
	 * comes back `[]`), never the grid itself.
	 */
	const seriesCreatePreviewDates = $derived.by(() => {
		if (seriesCreateDayApplies && seriesCreateDay === '') return null;
		if (!seriesCreateTime || !seriesCreateFrom || !seriesCreateUntil) {
			return null;
		}
		return generateEventDates({
			repeat: seriesCreateRepeat,
			dayOfWeek: seriesCreateDayOfWeek,
			timeOfDay: seriesCreateTime,
			from: seriesCreateFrom,
			until: seriesCreateUntil,
			skipDates: seriesCreateSkipDates
		});
	});

	/**
	 * #215 — every CANDIDATE occurrence, ignoring `seriesCreateSkipDates`
	 * entirely: the chip grid renders this set (skipped chips stay rendered,
	 * merely struck), never the skip-applied one above. Same gating as
	 * `seriesCreatePreviewDates` (`null` unless the recurrence is complete) so
	 * the two stay in lockstep on when a preview exists at all — they differ
	 * only in which dates they list.
	 */
	const seriesCreateCandidateDates = $derived.by(() => {
		if (seriesCreateDayApplies && seriesCreateDay === '') return null;
		if (!seriesCreateTime || !seriesCreateFrom || !seriesCreateUntil) {
			return null;
		}
		return generateEventDates({
			repeat: seriesCreateRepeat,
			dayOfWeek: seriesCreateDayOfWeek,
			timeOfDay: seriesCreateTime,
			from: seriesCreateFrom,
			until: seriesCreateUntil,
			skipDates: []
		});
	});

	/**
	 * The dates the GRID actually renders — #132/T5 review F3, carried over by
	 * #215. After a stopped run the chips must describe exactly what a
	 * re-submit will create (`seriesCreateResume.remaining`), locked and all —
	 * never the full recomputed candidate set, which could disagree with the
	 * resume notice sitting right above it.
	 */
	const seriesCreateGridDates = $derived.by(() => {
		if (seriesCreateCandidateDates === null) return null;
		return seriesCreateResume ? seriesCreateResume.remaining : seriesCreateCandidateDates;
	});

	/**
	 * #241 — reset the reveal to the first 50 whenever the GENERATED set
	 * changes. Keyed off `seriesCreateGridDates` ITSELF (object identity),
	 * never its `.length`: a `$derived.by` block returns a fresh array on
	 * every recompute, so re-reading the array here re-runs this effect on
	 * ANY param change that reshapes the candidate set — including a
	 * time-only edit that keeps the same calendar days (same length, brand
	 * new array) and would slip past a length-keyed reset undetected. A bare
	 * `$state` counter with no reset at all would fail the same way, only
	 * silently: it would keep pointing at stale positions in a set that no
	 * longer exists.
	 */
	$effect(() => {
		void seriesCreateGridDates;
		seriesCreateRevealedCount = 50;
	});

	/** #241 — the dates the grid actually DRAWS this render: `seriesCreateGridDates`
	 *  capped at `seriesCreateRevealedCount`, chronological order preserved. The
	 *  month grouping below runs over THIS set, not the full one, so a heading
	 *  only ever appears once one of its dates is shown. */
	const seriesCreateVisibleGridDates = $derived.by(() => {
		if (seriesCreateGridDates === null) return null;
		return seriesCreateGridDates.slice(0, seriesCreateRevealedCount);
	});

	/** #241 — how many GRID (pre-skip) dates remain undrawn — drives both the
	 *  next-batch size and whether either reveal control renders at all. */
	const seriesCreateHiddenCount = $derived(
		seriesCreateGridDates === null
			? 0
			: Math.max(0, seriesCreateGridDates.length - seriesCreateRevealedCount)
	);

	/** #241 — `series-create-show-next`'s `{count}`: the ACTUAL size of the next
	 *  batch (never a bare 50 once fewer than 50 remain). */
	const seriesCreateNextBatchSize = $derived(Math.min(50, seriesCreateHiddenCount));

	/**
	 * #241 review F1 — `series-create-show-all`'s `{count}`: the size of the set
	 * the button actually REVEALS, which is not one fixed expression.
	 *
	 * Normally that is the count line's own skip-applied total (issue point 2's
	 * ONE source: the two numbers on screen must be the same number, and the
	 * grid's extra struck-through chips are not events the submit will create).
	 *
	 * Under a resumable stopped run the count line is SUPPRESSED and the grid
	 * switches to `seriesCreateResume.remaining`, while
	 * `seriesCreatePreviewDates` keeps re-generating the full candidate set off
	 * the restored form fields — so borrowing its total there would advertise
	 * "show all 153 events" over a button that reveals 133 chips, contradicting
	 * the resume notice's own `remaining` directly below. Skips would make it a
	 * third unrelated number again (the chips ignore them while resuming). The
	 * number that applies once a run is resumable is the remainder, so read the
	 * grid set itself.
	 */
	const seriesCreateShowAllCount = $derived(
		seriesCreateResume
			? (seriesCreateGridDates?.length ?? 0)
			: (seriesCreatePreviewDates?.length ?? 0)
	);

	/** #241 — reveal everything at once. */
	function revealSeriesCreateNext(): void {
		seriesCreateRevealedCount += 50;
	}
	function revealSeriesCreateAll(): void {
		if (seriesCreateGridDates === null) return;
		seriesCreateRevealedCount = seriesCreateGridDates.length;
	}

	/**
	 * #215 Gama ruling (2) — every candidate toggled OFF BY HAND leaves nothing
	 * to submit; the count line already reads the 0 form, this wires that into
	 * the button. Deliberately NOT the same trigger as "the recurrence itself
	 * yields zero candidates" (Mondays over a Tue–Sun range): that case must
	 * still let submit run so `submitSeriesCreate`'s own check can refuse it
	 * with `series_create_no_dates` — a DIFFERENT message than the 0-count
	 * line, per Gama's ruling. So this only engages once there is at least one
	 * CANDIDATE (`seriesCreateCandidateDates.length > 0`) and toggling has
	 * emptied the active set.
	 *
	 * Never true while a stopped run is resumable — the remainder there is
	 * never empty (an empty remainder would already have closed the form out)
	 * and submit must stay live to finish it.
	 */
	const seriesCreateNothingToSubmit = $derived(
		!seriesCreateResume &&
			seriesCreateCandidateDates !== null &&
			seriesCreateCandidateDates.length > 0 &&
			seriesCreatePreviewDates !== null &&
			seriesCreatePreviewDates.length === 0
	);

	/** `date` (a `generateEventDates` 'YYYY-MM-DDTHH:MM' local string) as an ISO
	 *  calendar day — the chip's own testid/text shape (#215 — used to be the
	 *  preview row's).
	 *  #141 — a plain slice, never a `Date` readback: `generateEventDates`
	 *  itself now emits the local string directly (see recurrence.ts's module
	 *  doc) precisely so no caller reconstructs a `Date` at the occurrence's
	 *  hour and risks the DST spring-forward normalization. */
	function seriesCreateIsoDay(date: string): string {
		return date.slice(0, 10);
	}

	/** #215 — `seriesCreateVisibleGridDates` grouped by calendar month
	 *  (`YYYY-MM`), preserving ascending order (the generator already emits
	 *  ascending, so a simple run-length grouping suffices — no sort). Each
	 *  group carries the display-only month heading's key alongside its own
	 *  dates so the grid can render `<h4>` + chips per month without
	 *  re-scanning the full list per group (`$derived`, not a template-level
	 *  filter). #241 — grouping the VISIBLE (capped) set rather than the full
	 *  one is what makes a heading appear IFF one of its dates is currently
	 *  shown; a month straddling the reveal boundary still gets exactly one
	 *  heading, since both halves come from the same ascending run. */
	const seriesCreateMonthGroups = $derived.by(() => {
		if (seriesCreateVisibleGridDates === null) return null;
		const groups: { month: string; dates: string[] }[] = [];
		for (const date of seriesCreateVisibleGridDates) {
			const month = seriesCreateIsoDay(date).slice(0, 7);
			const current = groups[groups.length - 1];
			if (current && current.month === month) {
				current.dates.push(date);
			} else {
				groups.push({ month, dates: [date] });
			}
		}
		return groups;
	});

	/** `month` ('YYYY-MM') as a LOCALIZED month name (Intl, app locale) — the
	 *  display-only heading's text. Never the raw machine form the testid
	 *  already carries (#215 review pin). */
	function seriesCreateMonthLabel(month: string): string {
		const [year, monthNum] = month.split('-').map(Number);
		return new Intl.DateTimeFormat(getLocale(), { month: 'long', year: 'numeric' }).format(
			new Date(year, monthNum - 1, 1)
		);
	}

	/** Opened ONLY from inside the panel — `manageableSeasonId` is always the
	 *  panel's own season while it is open, so there is nothing to guard here
	 *  T4's two-entry-point form needs (no season switch is possible). */
	function openSeriesCreateForm(): void {
		if (manageableSeasonId === null) return;
		// #132/T6 review F1 — see `openSeasonCreateForm`.
		// #138 — widened from `anyCreateSubmitting` to `createEntryPointsBlocked`
		// (see that flag's doc): the CURRENT db can carry a stopped run's resume
		// entry even while `seriesCreateOpen` is false (a switch away and back
		// unmounts the form without discarding the per-db record), so this must
		// refuse to blank a run THIS db still owes.
		if (createEntryPointsBlocked) return;
		// #132/T6 — mutual exclusion (see `openSeasonCreateForm`'s doc). Reachable
		// only from inside the panel, which stays open — it is management, not a
		// creation form.
		closeSeasonCreateForm();
		closeEventCreateForm();
		seriesCreateSeasonId = manageableSeasonId;
		seriesCreateName = '';
		seriesCreateType = 'rehearsal';
		seriesCreateDuration = '';
		seriesCreateLocation = '';
		seriesCreateDescription = '';
		seriesCreateRepeat = 'weekly';
		seriesCreateDay = '';
		seriesCreateTime = '';
		// Sketch D's pin: from/until default to the SEASON's own dates. Ride the
		// panel's ALREADY-seeded field state (`openSeasonManagePanel` sets it from
		// the `seasons` list the agenda load fetched) — zero extra fetch, and the
		// panel is always open before this form can be reached.
		seriesCreateFrom = seasonManageStartDate;
		seriesCreateUntil = seasonManageEndDate;
		seriesCreateSkipDates = [];
		seriesCreateProgress = null;
		// #138 review F1 — NO resume clear here. `createEntryPointsBlocked` above
		// already refuses this whole function whenever the CURRENT db has an
		// outstanding entry, so a clear could only ever be a no-op or a way to
		// silently drop a run this db still owes.
		clearSeriesCreateError();
		seriesCreateSubmitting = false;
		seriesCreateOpen = true;
	}

	/**
	 * UNMOUNTS the form. Nothing more.
	 *
	 * #138 review F1 — this used to also forget the current db's resume record,
	 * and that is what kept #138 reproducible: `loadForSelected`'s switch
	 * teardown calls this, and DURING a switch `selected` already names the db
	 * being switched TO. Returning to the collective that owns a stopped run
	 * therefore deleted exactly that db's entry — the one direction the whole
	 * feature exists for. Forgetting a run is now always an explicit act by a
	 * caller that means it (`clearSeriesCreateResumeForSelected`).
	 */
	function closeSeriesCreateForm(): void {
		seriesCreateOpen = false;
		seriesCreateProgress = null;
		clearSeriesCreateError();
	}

	/**
	 * #138 review F2 — RE-SURFACE a stopped run when its collective is selected
	 * again, rather than only locking that collective's creation UI out.
	 *
	 * With F1 fixed the resume record survives a round trip, and that alone is a
	 * deadlock: `createEntryPointsBlocked` is true from the surviving entry, so
	 * `openSeriesCreateForm` refuses and [+ Series] is disabled — while
	 * `seriesCreateOpen` is false, because the switch unmounted the form. The
	 * only in-form escape (`dismissSeriesCreateForm`) is then unreachable and
	 * nothing on screen explains why every create button is dead. So the return
	 * re-opens the panel and the form from the run's own snapshot: the resume
	 * notice, the resume-scoped preview rows, Submit (finish it) and Cancel
	 * (abandon it) are all back, and no new copy is needed.
	 *
	 * Called from the agenda load's success handler — that is the first moment
	 * `manageableSeasonId` and `seasons` describe the db being returned to, and
	 * `openSeasonManagePanel` needs both.
	 */
	function restoreSeriesCreateRun(): void {
		const current = selected;
		if (!current) return;
		// Already on screen (the failure path's own `loadForSelected({ keepSeasonManage })`
		// lands here too) — never re-seed a form the operator is looking at.
		//
		// #138 review 2 — the second half is keyed to the RUN'S db, not to the
		// bare global flag. Unqualified it dropped the arriving collective's
		// restore whenever ANY collective happened to be mid-run: viewer leaves
		// org-a with an occurrence POST still on the wire, org-b's agenda load
		// resolves first and returns here, then org-a's POST lands and the
		// `finally` releases the flag — with nobody left to re-attempt the
		// restore (this function has exactly one call site, and org-b's load has
		// already run). org-b was then locked out of every create entry point by
		// its own surviving record, with no form on screen and no copy saying
		// why, self-healing only on a further collective switch. A run still
		// finishing in a db the viewer has LEFT cannot touch form state, so it is
		// no reason to withhold the form of the db she is now IN.
		if (seriesCreateOpen || (seriesCreateSubmitting && seriesRunDb === current.db)) return;
		const entry = seriesCreateResumeByDb[current.db];
		if (!entry) return;
		if (manageableSeasonId !== entry.form.seasonId) {
			// The run's season is no longer this collective's MANAGEABLE one, so
			// the panel that owns the form cannot be opened for it and neither can
			// the [+ Series] button that would duplicate it. Keeping the record
			// would freeze the season/event entry points forever with nothing on
			// screen to explain it, so reap it — loudly (house rule), never
			// silently.
			console.warn(
				'agenda: dropping a series resume record whose season is no longer manageable',
				current.db,
				entry.form.seasonId
			);
			clearSeriesCreateResume(current.db);
			return;
		}
		if (!seasonManageOpen) openSeasonManagePanel();
		const form = entry.form;
		seriesCreateSeasonId = form.seasonId;
		seriesCreateName = form.name;
		seriesCreateType = form.type;
		seriesCreateDuration = form.duration;
		seriesCreateLocation = form.location;
		seriesCreateDescription = form.description;
		seriesCreateRepeat = form.repeat;
		seriesCreateDay = form.day;
		seriesCreateTime = form.time;
		seriesCreateFrom = form.from;
		seriesCreateUntil = form.until;
		seriesCreateSkipDates = [...form.skipDates];
		seriesCreateProgress = null;
		clearSeriesCreateError();
		seriesCreateOpen = true;
	}

	/** The form is self-unmounting; hand focus back to the still-open panel
	 *  (its ONLY possible origin) — same debt `restoreEventCreateFocus` pays. */
	function restoreSeriesCreateFocus(): void {
		tick().then(() => seasonManagePanelEl?.focus());
	}

	/** Dismissal is REFUSED while a run is in flight. A bulk run is many serial
	 *  POSTs wide (13 Mondays over a season), so unmounting the form mid-run
	 *  would leave the loop POSTing events the viewer believes she cancelled —
	 *  and a later failure would write its error into state nothing renders.
	 *  Same guard the submit button already carries. */
	function dismissSeriesCreateForm(): void {
		if (seriesCreateSubmitting) return;
		// #138 review F1 — Cancel/Escape IS the documented operator exit from a
		// stopped run (it is what frees every other entry point again), so it is
		// one of the two places that may forget what the run still owed.
		clearSeriesCreateResumeForSelected();
		closeSeriesCreateForm();
		restoreSeriesCreateFocus();
	}

	function onSeriesCreateFormKeydown(event: KeyboardEvent): void {
		if (event.key !== 'Escape') return;
		event.preventDefault();
		// Layering (`handleSeasonFieldKeydown`'s #132/T2 review F2 shape): this
		// form sits INSIDE the season-manage panel, whose own Escape handler
		// closes the panel. Without stopping propagation one Escape would dismiss
		// both — and while a run is in flight it would tear the panel down around
		// a still-POSTing loop. The next Escape reaches the panel because
		// `restoreSeriesCreateFocus` hands focus back to it.
		event.stopPropagation();
		dismissSeriesCreateForm();
	}

	/** #215 — the chip IS the skip mechanism: tapping a candidate date toggles
	 *  it in/out of `seriesCreateSkipDates`. Inert while `seriesCreateLocked`
	 *  (a resumable run's remainder is frozen with the rest of the form) — the
	 *  chips there are also `disabled`, but the handler no-ops defensively
	 *  rather than trust that alone. */
	function toggleSeriesCreateSkipDate(iso: string): void {
		if (seriesCreateLocked) return;
		seriesCreateSkipDates = seriesCreateSkipDates.includes(iso)
			? seriesCreateSkipDates.filter((d) => d !== iso)
			: [...seriesCreateSkipDates, iso].sort();
	}

	/**
	 * Submit: ONE path — `createEventSeries` (T1) is the ONE seam for the series
	 * itself (org from `resolveDatabaseEntityId`, the panel's season in
	 * `extraParentIds`), and the occurrences ALWAYS follow: one `createEvent` per
	 * `generateEventDates` date, STRICTLY SERIAL, ascending (Entu rate/ordering
	 * — #132/T5's pinned contract). #240 retired the generate toggle, so there is
	 * no state of this form that produces a childless series; an empty occurrence
	 * set is a REFUSAL, not a series-only outcome. Validation runs BEFORE any
	 * fetch, each refusal naming its own field (the T4 discipline this form
	 * inherits) — a refused submit must never leave a half-made series behind.
	 * When `seriesCreateResume` is set (a previous run stopped partway) the
	 * series is NOT re-created: the run picks up at the occurrence that failed.
	 */
	async function submitSeriesCreate(): Promise<void> {
		if (seriesCreateSubmitting) return;
		clearSeriesCreateError();

		const resume = seriesCreateResume;
		const seasonId = seriesCreateSeasonId;
		const name = seriesCreateName.trim();
		if (!name) {
			setSeriesCreateError(m.series_create_name_required, 'name');
			return;
		}
		// #132/T5 review F2 — NO silent `|| 'rehearsal'` fallback. `event_type` is
		// the event's own displayed discriminator (every reader takes the event's
		// value, never the series' — #194/#202), so a viewer who cleared the box
		// (to type 'concert', or deliberately) would get a rehearsal series with no
		// message and no way to see the mistake until the agenda is wrong. Refuse
		// the blank, the way T4's sibling form on this page does.
		// (Pre-#194 the reason read "the discriminator `listRehearsals` filters
		// on"; that filter is gone, the refusal stands on the display reason.)
		const typeValue = seriesCreateType.trim();
		if (!typeValue) {
			setSeriesCreateError(m.series_create_type_required, 'type');
			return;
		}
		const time = seriesCreateTime;
		if (!time) {
			setSeriesCreateError(m.series_create_time_required, 'time');
			return;
		}
		const durationValue = Number(seriesCreateDuration);
		if (!seriesCreateDuration.trim() || !Number.isFinite(durationValue)) {
			setSeriesCreateError(m.series_create_duration_required, 'duration');
			return;
		}
		// from/until are pre-filled from the season but are freely editable (and
		// the season's own dates may be blank) — an invalid range must be named
		// HERE, not discovered inside `createEventSeries`'s `requireDateRange`
		// after an org round-trip has already been spent on it.
		if (!seriesCreateFrom) {
			setSeriesCreateError(m.series_create_from_required, 'from');
			return;
		}
		if (!seriesCreateUntil) {
			setSeriesCreateError(m.series_create_until_required, 'until');
			return;
		}
		if (seriesCreateUntil < seriesCreateFrom) {
			setSeriesCreateError(m.series_create_until_before_from, 'until');
			return;
		}
		// 'daily' ignores dayOfWeek entirely, so only the day-using patterns may
		// demand one.
		if (seriesCreateDayApplies && seriesCreateDay === '') {
			setSeriesCreateError(m.series_create_day_required, 'day');
			return;
		}

		// The occurrence set is computed BEFORE any write: a recurrence that
		// yields nothing (Mondays over a Tue–Sun range) must be REFUSED, not
		// reported as a silent success with a childless series behind it.
		const dates: string[] =
			resume?.remaining ??
			generateEventDates({
				repeat: seriesCreateRepeat,
				dayOfWeek: seriesCreateDayOfWeek,
				timeOfDay: time,
				from: seriesCreateFrom,
				until: seriesCreateUntil,
				skipDates: seriesCreateSkipDates
			});
		if (dates.length === 0) {
			setSeriesCreateError(m.series_create_no_dates, null);
			return;
		}
		// On a resume run `total` stays the ORIGINAL occurrence count so every
		// progress/failure count keeps describing the whole series, not just the
		// tail. Hoisted above the first `dbChanged()` checkpoint: a switch that
		// stops the run there must record the same numbers a later stop would.
		const total = resume?.total ?? dates.length;

		const current = selected;
		if (!current || !seasonId) {
			console.error('agenda: series create submitted with no selected collective/season');
			setSeriesCreateError(m.series_create_failed, null);
			return;
		}
		const cfg = { db: current.db, token: getToken() ?? '' };
		// Captured up front (T4's F2 discipline): the bulk success path's
		// `loadForSelected` re-derives `manageableSeasonId` from the reload, so
		// this is what the post-write refresh compares against (#167 — the
		// panel's season is the MANAGEABLE one, not `currentSeasonId`).
		const panelSeasonId = manageableSeasonId;
		// #137 — the run's OWN db, pinned at submit. `selected` is a live
		// `$derived` off the collective-picker store: a switch mid-run re-points
		// it at the new collective, but `cfg` (and every closed-over id in this
		// function) still describes the OLD one. Every write below — including
		// each serial POST inside the bulk loop — checks the CURRENT `selected`
		// against this pinned value before touching state or the wire, so a
		// switch mid-generation stops the loop from POSTing further occurrences
		// into the OLD db and never writes this run's outcome into the NEW
		// collective's (unrelated) form state.
		const runDb = cfg.db;
		/** True once the viewer has switched away from `runDb` — checked before
		 *  every write below (state OR wire) so a switch mid-run stops the run
		 *  where it stands rather than finishing into state/collective nothing on
		 *  screen still refers to. */
		const dbChanged = (): boolean => selected?.db !== runDb;
		/**
		 * #138 review F2 — the form as submitted, pinned before the first await.
		 * Read live at a stop site it would be worthless: `openSeriesCreateForm`
		 * blanks every one of these the next time [+ Series] is clicked, so the
		 * record of a run parked under another db would decay into whatever the
		 * viewer typed next. A resume run keeps the ORIGINAL snapshot (the boxes
		 * are inert while resumable, so nothing can have changed).
		 */
		const runForm: SeriesCreateFormSnapshot = resume?.form ?? {
			seasonId,
			name,
			type: typeValue,
			duration: seriesCreateDuration,
			location: seriesCreateLocation,
			description: seriesCreateDescription,
			repeat: seriesCreateRepeat,
			day: seriesCreateDay,
			time,
			from: seriesCreateFrom,
			until: seriesCreateUntil,
			skipDates: [...seriesCreateSkipDates]
		};
		/** What `runDb` still owes from `index` onward, recorded under ITS OWN key
		 *  — never the currently-selected one, which a mid-run switch has already
		 *  moved on. */
		const recordStop = (seriesId: string, index: number): void => {
			setSeriesCreateResume(runDb, {
				seriesId,
				remaining: dates.slice(index),
				total,
				form: runForm
			});
		};

		seriesCreateSubmitting = true;
		// #138 review 2 — the module-level twin of `runDb`, so `restoreSeriesCreateRun`
		// can tell whose run is on the wire. Released with the flag in the `finally`.
		seriesRunDb = runDb;
		try {
			let dbEntityId: string | null;
			try {
				dbEntityId = await resolveDatabaseEntityId(cfg);
			} catch (e) {
				console.error('agenda: resolving the database entity for series create failed', e);
				// #137 — the org read straddled a switch: the refusal belongs to a form
				// that is gone, and since #138 review 2 the screen may already be
				// showing ANOTHER collective's restored run. Diagnose, write nothing.
				if (!dbChanged()) setSeriesCreateError(m.series_create_failed, null);
				return;
			}
			if (!dbEntityId) {
				console.error('agenda: series create with no resolvable database entity', current.personId);
				if (!dbChanged()) setSeriesCreateError(m.series_create_failed, null);
				return;
			}
			// #137 — the org read crossed an await; a collective switch in that
			// window means this run's form is already gone (the switch's own
			// `closeSeriesCreateForm` saw to that). Stop here: no series POST, no
			// state write into whatever the new collective is now showing.
			if (dbChanged()) return;

			const intervalDays =
				seriesCreateRepeat === 'daily' ? 1 : seriesCreateRepeat === 'biweekly' ? 14 : 7;
			const trimmedLocation = seriesCreateLocation.trim();
			const trimmedDescription = seriesCreateDescription.trim();

			// #132/T5 review F1 — `start_date` / `end_date` are the FIRST and LAST
			// OCCURRENCE (entityCreate.ts's own contract), not the generator's
			// search range. The day of week is NOT stored on the series (only
			// interval_days + start_time), so `start_date` is the ONLY place a
			// later reader — an extend/regenerate feature, a report — can recover
			// which weekday the cadence lands on. With the season defaults
			// (2026-09-01 is a Tuesday) a weekly-MONDAY series would otherwise
			// persist a Tuesday start_date and describe a schedule it never had.
			// (On a RESUME run `dates` is only the tail, but `seriesInput` is never
			// sent then — the series already exists.)
			//
			// #240 — unconditional: the empty-occurrence refusal above returns
			// before this point, so `dates` is always non-empty here. The old
			// `dates.length > 0 ? … : seriesCreateFrom/Until` fallback to the raw
			// operator range belonged to the retired generate-OFF branch, and that
			// verbatim-range wire shape is exactly what #240 takes off the wire.
			const startDate = seriesCreateIsoDay(dates[0]);
			const endDate = seriesCreateIsoDay(dates[dates.length - 1]);

			const seriesInput: CreateEventSeriesInput = {
				name,
				dbEntityId,
				extraParentIds: [seasonId],
				eventType: typeValue,
				intervalDays,
				startTime: time,
				durationMinutes: durationValue,
				startDate,
				endDate,
				...(trimmedLocation ? { defaultLocation: trimmedLocation } : {}),
				...(trimmedDescription ? { defaultDescription: trimmedDescription } : {})
			};

			let seriesId: string;
			if (resume) {
				// A previous run already put this series on the wire — re-creating
				// it would leave a duplicate behind for every retry.
				seriesId = resume.seriesId;
			} else {
				try {
					seriesId = await createEventSeries(cfg, seriesInput);
				} catch (e) {
					console.error('agenda: series create failed', e);
					// #137 / #138 review 2 — same crossing as the org read above: a
					// failure discovered after the switch must not paint its alert onto
					// whatever collective's form is on screen now.
					if (!dbChanged()) setSeriesCreateError(m.series_create_failed, null);
					return;
				}
			}
			// #137 — same crossing, this time around the series-creation POST
			// (skipped entirely on a resume, but still an await on a fresh run).
			if (dbChanged()) {
				// #138 — the series LANDED in `runDb` and the viewer left before a
				// single occurrence followed. That is a stopped run owing everything,
				// and the record is the only thing standing between a return visit
				// and a duplicate series.
				recordStop(seriesId, 0);
				return;
			}

			const alreadyCreated = total - dates.length;
			let created = alreadyCreated;
			for (let i = 0; i < dates.length; i += 1) {
				// #137 — checked FIRST, every iteration: a collective switch between
				// occurrences must stop the loop from POSTing further events into the
				// db it just left. `selected` is live (`$derived`), so this sees a
				// mid-run switch the very next iteration — no separate cancellation
				// wiring needed.
				//
				// #138 — this is the switch-stop the issue is actually named after,
				// and it must RECORD, not just stop. Breaking out silently left the
				// partial series in `runDb` with no in-app record of what it owed, so
				// a return visit and a re-submit created a SECOND series under the
				// same season and re-POSTed the occurrences that had landed. The
				// record is keyed by `runDb` — never by `selected`, which the switch
				// has already moved on — so it survives the return trip
				// (`restoreSeriesCreateRun` re-opens it) instead of being torn down
				// with the form.
				if (dbChanged()) {
					recordStop(seriesId, i);
					break;
				}
				// Set BEFORE the await — the spec pins "current 1 of 3 while the
				// FIRST POST is in flight", not after it resolves.
				seriesCreateProgress = { current: created + 1, total };
				// #141 — `dates[i]` IS the 'YYYY-MM-DDTHH:MM' Tallinn wall-clock string
				// already (generateEventDates emits it directly), fed straight to the
				// UTC converter with no intermediate Date-readback step.
				const startDatetime = tallinnLocalToUtcIso(dates[i]);
				try {
					await createEvent(cfg, {
						dbEntityId,
						seriesId,
						extraParentIds: [seasonId],
						eventType: typeValue,
						startDatetime
					});
					created += 1;
				} catch (e) {
					// #137 — the failing POST's own await can itself straddle a
					// switch; a failure discovered AFTER the viewer has left this db
					// writes nothing VISIBLE (not the error, not a reload) into a
					// form/collective the viewer is no longer looking at. #138 — the
					// per-db record is the exception: it is not on screen anywhere,
					// and `runDb` owes these occurrences whether or not the viewer is
					// still standing in it.
					if (dbChanged()) {
						recordStop(seriesId, i);
						return;
					}
					// STOP at the failure — no further createEvent calls, and no
					// rollback of the series or of events 1..N-1 (nothing here may
					// DELETE). Instead: remember exactly where the run stopped so a
					// re-submit RESUMES rather than duplicating, and re-read both
					// the agenda and the panel's lists so the occurrences that DID
					// land become visible before the operator decides.
					console.error('agenda: bulk event create failed', e);
					seriesCreateProgress = null;
					// #138 — keyed under `runDb` (pinned at submit, confirmed == the
					// current db by the `dbChanged()` check just above), not a blanket
					// slot: a later switch away no longer discards what THIS db's run
					// still owes.
					recordStop(seriesId, i);
					setSeriesCreateError(() => m.series_create_bulk_failed({ created, total }), null);
					loadForSelected({ keepSeasonManage: true });
					if (panelSeasonId === seasonId) {
						refreshSeasonManageLists(cfg, seasonId);
					}
					return;
				}
			}
			// #137 — the loop's LAST successful iteration can itself straddle a
			// switch (the `break` above only catches the NEXT iteration, not the
			// one already in flight when the switch lands) — one more check before
			// the success path's writes.
			if (dbChanged()) {
				// #138 — reached only when every occurrence LANDED and the viewer
				// left afterwards: `runDb` owes nothing. A resume record from the run
				// this one just finished must not survive, or the return visit would
				// re-POST occurrences that already exist. (A `break` never lands here
				// with an unrecorded remainder — it has already recorded its own.)
				if (created >= total) clearSeriesCreateResume(runDb);
				return;
			}
			seriesCreateProgress = null;
			// #138 review F1 — `closeSeriesCreateForm` only UNMOUNTS now. A clean
			// finish is one of the three places that may forget the run, and it does
			// so under `runDb` (== `selected.db`, just confirmed by `dbChanged()`).
			clearSeriesCreateResume(runDb);
			closeSeriesCreateForm();
			// The generated occurrences just landed on the agenda — `loadForSelected`
			// keeps the panel open (`keepSeasonManage`) the same way event-create's
			// bulk-adjacent write does; the panel's own two lists still need their
			// own explicit re-read (`loadForSelected` does not touch them).
			loadForSelected({ keepSeasonManage: true });
			if (panelSeasonId === seasonId) {
				refreshSeasonManageLists(cfg, seasonId);
			}
			restoreSeriesCreateFocus();
		} finally {
			seriesCreateSubmitting = false;
			seriesRunDb = null;
		}
	}

	$effect(() => {
		if (seriesCreateOpen && seriesCreateNameInput) seriesCreateNameInput.focus();
	});

	// T4.8/#28 — fold the completion gate into the ONE membership value AgendaList
	// already consumes (RECON A: S1, the enabled RSVP control, is the whole member-
	// display set). An incomplete member is a MEMBER, not a non-member — she must
	// NEVER see the S2 "Only members can RSVP" hint; present her as 'loading'
	// (disabled, no hint) until the gate resolves 'complete'. No new prop; no
	// AgendaList/RsvpControl change. Effect B in +layout.svelte redirects her to
	// /profile; this is the belt-and-suspenders that S1 never lights during the
	// redirect's in-flight tick.
	const gatedMembership = $derived(
		membership === 'member' && $completionGateStore !== 'complete' ? 'loading' : membership
	);

	// #138 review — this effect must react to EXACTLY ONE thing: a genuine
	// collective switch (`selected` changing). `loadForSelected()`'s body reads
	// a lot of OTHER reactive state along the way — left untracked, `$effect`
	// would treat every one of those as an implicit retrigger condition too, and
	// the body WRITES most of them. That is a feedback loop waiting for its first
	// shared read: a write to some tracked-by-accident piece of state reruns
	// `loadForSelected()` with the default (non-keepSeasonManage) options, whose
	// teardown branch tears the season-manage panel down under whoever was
	// standing in it. `untrack` scopes the call to depend on nothing but the
	// explicit `selected` read below.
	$effect(() => {
		selected;
		// #298 — a genuine collective switch (or a deselection) makes any
		// surviving create announcement untrue: this effect is the ONE site
		// that fires only on a real context change, unlike `loadForSelected()`
		// itself, which also runs right after a SAME-collective create success
		// (see `submitSeasonCreate`/`submitEventCreate`) — clearing inside that
		// function would erase the message the create just wrote. No timer:
		// this fires on the context change, never on a clock.
		seasonCreateStatus = '';
		eventCreateStatus = '';
		untrack(() => loadForSelected());
	});

	function retryAgenda() {
		// #313 — the conversion-run guard this used to key off
		// (`eventConvertRunUnfinished`) relocated with the rest of that flow; a
		// retry is a plain reload again.
		loadForSelected();
	}
</script>

{#if auth.status === 'authenticated'}
	{#if collectives.status === 'ready' && selected}
		<DeskSurface>
			<div class="mx-auto flex min-h-screen w-full max-w-md flex-col gap-2 px-4 py-6">
				<!-- #248 -- shared suggestion source for series-create-location and
				     event-create-location (native <datalist>, no custom dropdown). -->
				<datalist id={LOCATION_SUGGESTIONS_ID}>
					{#each locationSuggestions as loc (loc)}
						<option value={loc}></option>
					{/each}
				</datalist>
				<header class="flex items-center justify-between pb-2">
					<p class="font-display text-xl text-ink" data-testid="selected-collective">{selected.name}</p>
					<nav class="flex items-center gap-3 text-xs text-ink-3">
						{#if pickerMode === 'picker'}
							<a class="underline" href="/collectives">{m.agenda_switch_collective()}</a>
						{/if}
					</nav>
				</header>
				<div class="rounded-lg bg-paper p-4">
					{#if sessionExpired}
						<SessionExpiredNotice centered />
					{:else if agendaError}
						<div data-testid="agenda-error" class="flex flex-col items-center gap-3 py-10 text-center">
							<p class="text-sm text-ink-2">{m.agenda_load_error()}</p>
							<button
								type="button"
								class="rounded-md border border-ink px-4 py-2 text-sm text-ink hover:bg-ink hover:text-paper"
								data-testid="agenda-retry"
								onclick={retryAgenda}
							>
								{m.agenda_retry()}
							</button>
						</div>
					{:else}
						<!-- #321 — the singer's own answer/attendance set may be PARTIAL (the
						     person-lifetime rsvp/attendance reads are reachable bounds, per
						     research-321 inv). Rendered here, above everything else in this
						     branch, so it holds regardless of whether the agenda list itself
						     is empty — completeness of MY answers is not a property of which
						     events are upcoming. Persistent + visible (never sr-only): a
						     standing fact sighted users must see too, not a transient toast. -->
						{#if rsvpPartial}
							<p
								data-testid="rsvp-partial-notice"
								role="status"
								class="mb-3 rounded-md border border-dashed border-ink-4 p-2 text-sm text-ink-2"
							>
								{m.rsvp_partial_notice()}
							</p>
						{/if}
						{#if attendancePartial}
							<p
								data-testid="attendance-partial-notice"
								role="status"
								class="mb-3 rounded-md border border-dashed border-ink-4 p-2 text-sm text-ink-2"
							>
								{m.attendance_partial_notice()}
							</p>
						{/if}
						<!-- #201 — a fresh collective's agenda is otherwise a blank page: the
						     working flow (season → event series → events are generated) is
						     only discoverable via the runbook. Gated on the SAME three
						     conditions the rest of this branch already tracks — never over
						     the skeleton (`!agendaLoading`), only while there is truly
						     nothing yet (`seasons.length === 0` — a lapsed season means the
						     flow is already known), and only for someone who can actually act
						     on it (`seasonCreateRights === 'editor'`, fail-closed like every
						     other gate on this page).
						     #261 (Mihkel ruling 2026-09-06) — the banner's OWN create button
						     (agenda-onboarding-cta) is RETIRED: with zero seasons the
						     standalone [+ Season] below (season-create) is the only control
						     an admin needs, so a second button here would be a redundant
						     door onto the same `openSeasonCreateForm`. The explanatory steps
						     stay; only the second button goes.
						     #201 review F1 — `!seasonCreateOpen` still guards the banner
						     (unchanged): none of the other three gated values change when the
						     form opens, so without it the banner stayed mounted directly
						     above an open form — misleadingly telling an editor already mid-
						     create to "start with a season". `createEntryPointsBlocked` does
						     NOT cover this: it is `anyCreateSubmitting || seriesRunUnfinished`,
						     true only during a write or an unfinished series run, never while
						     a form merely sits open. -->
						{#if !agendaLoading && seasons.length === 0 && seasonCreateRights === 'editor' && !seasonCreateOpen}
							<div
								data-testid="agenda-onboarding"
								class="mb-3 flex flex-col gap-2 rounded-md border border-dashed border-ink-4 p-3"
							>
								<ol class="flex flex-col gap-1 text-sm text-ink-2">
									<li>{m.agenda_onboarding_step_season()}</li>
									<li>{m.agenda_onboarding_step_series()}</li>
									<li>{m.agenda_onboarding_step_events()}</li>
								</ol>
							</div>
						{/if}
						<!-- #261 (Mihkel ruling 2026-09-06, verbatim) — "'+ Hooaeg' … stands
						     above [the season cards]… if there are [seasons], then these
						     season cards are below this control." [+ Season] LEAVES the
						     card and stands here, above it, as its own page-level control.
						     REOPENED #261 (PO:Gama, 2026-09-07) — the gate previously also
						     required `!hasUpcomingSeason` (an onboarding-affordance holdover
						     from #132/T2: don't prompt for a season when one is already
						     coming). That rationale does not survive the move above the
						     cards: the ruling explicitly puts this control above EXISTING
						     season cards, so it must stay visible whenever an upcoming
						     season exists too. The gate is now `seasonCreateRights ===
						     'editor'` alone; `seasonCreateOpen` still hides the trigger while
						     the form is open. With zero seasons + an editor this is still the
						     ONLY control on the surface (the onboarding banner's own CTA is
						     retired, above). -->
						{#if showSeasonCreate && !seasonCreateOpen}
							<button
								type="button"
								data-testid="season-create"
								disabled={createEntryPointsBlocked}
								class="mb-3 flex w-fit min-h-11 items-center rounded-md border border-ink px-3 py-1.5 text-xs tracking-wide text-ink uppercase hover:bg-ink hover:text-paper disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-ink"
								onclick={openSeasonCreateForm}
							>
								{m.season_create()}
							</button>
						{/if}
						<!-- #149/#213/#222, reworked #261 — the season-manage panel keeps
						     its ONE bordered card (agenda-admin-card): #222's "one card,
						     never two stacked frames" ruling stands, only the header
						     reshapes per #261's verbatim ruling:
						       "collapsed season card displays only the name and unfolds on
						       click (whole card). opened season card can be collapsed back
						       by clicking on its title row. opened season card also
						       features the right-aligned red trashcan on title row. gear
						       not needed."
						     COLLAPSED: the whole card is ONE native <button>
						     (season-card-expand) — the #205 whole-field precedent, not a
						     glyph at the edge. OPENED: the title row is a plain flex div
						     (role="toolbar" + the #156 roving tabindex RETIRE with the gear
						     — stated choice: 1–2 plain buttons is a degenerate arity for
						     that pattern) holding the collapse control
						     (season-card-collapse, carrying the season name — clicking it
						     folds the card back) plus the red trashcan, right-aligned
						     (ml-auto, the gear's old slot) — or, armed, the confirm/cancel
						     pair ADJACENT to the name (PO reading 2: arming never replaces
						     the identity row, never reachable while collapsed — the #236
						     collapsed-arming design is REVERSED). The panel renders as this
						     row's SIBLING inside the same card (never inside the collapse
						     button — a button cannot contain a dialog).
						     Rights gate: `showSeasonCard` (renamed from
						     `showSeasonManageGear` — the gear it once named is gone, but
						     the derivation is byte-identical) OR `seasonManageOpen` — the
						     latter disjunct is LOAD-BEARING, not belt-and-braces: a
						     `loadForSelected({ keepSeasonManage: true })` reload blanks
						     `manageableSeasonRights` (and `seasonCreateRights`)
						     SYNCHRONOUSLY for the whole `loadFullAgenda()` round-trip, and a
						     rights-only gate would unmount the open panel mid-refresh and
						     remount it on the other side — exactly what every
						     `keepSeasonManage: true` caller exists to prevent (`$state`
						     survives a remount; DOM focus, scroll and caret do not). -->
						{#if showSeasonCard || seasonManageOpen}
							<div
								data-testid="agenda-admin-card"
								bind:this={seasonCardEl}
								class="mb-3 rounded-md border border-ink-4 p-1.5"
							>
								<!-- #277 — ONE collapsed entry per season in `manageableSeasonEntries`,
								     in the page's own `seasons` order (current-first), EXCLUDING
								     whichever one is currently open (that season renders its EXPANDED
								     face below instead). With exactly one manageable season this loop
								     has exactly one iteration and — while closed — renders that one
								     entry; the markup inside is otherwise UNCHANGED from the pre-#277
								     single-card shape (criterion 5: byte-identical single-season DOM).
								     Clicking a DIFFERENT season's entry than the one open IS the
								     switch (`openSeasonManagePanelFor`); clicking THIS season's own
								     entry after a plain collapse is a no-op reopen (fields survive,
								     no refetch — same contract as before #277). -->
								{#each manageableSeasonEntries as ms (ms.id)}
									{#if !seasonManageOpen || ms.id !== manageableSeasonId}
										<!-- #261 ruling, collapsed face: the season NAME and NOTHING
										     else — no trashcan, no gear, no plus, no describing words.
										     The WHOLE card is the click target (the #205 whole-field
										     precedent: a real full-width native button, not a glyph at
										     the edge). Focus lands here on close (below).

										     #261 review F3 — the name keeps its HEADING. On main it was
										     an <h2> (#238: "title the card by its season name"); folding
										     it into the button must not cost the agenda's only admin
										     heading, or a screen-reader user navigating by H/rotor can no
										     longer find this card in either state. The WAI-APG Accordion
										     header is a heading WRAPPING the button, so the button stays
										     the whole-card target and the outline is restored for free.

										     #261 review F1 — NO `aria-label` on this button. An
										     aria-label SUPERSEDES the element's own contents, so the
										     accessible name became "Open season card" with the visible
										     "2026/2027" nowhere inside it: WCAG 2.1 AA 2.5.3 (Label in
										     Name) fails and voice control cannot say "click 2026/2027".
										     Same fix as #205 review F1 three sections down: the verb
										     rides INSIDE as an sr-only span, the visible name follows,
										     and AT hears "<action> <name>". `season-manage-label` stays
										     on the NAME span alone so the dialog's `aria-labelledby`
										     still resolves to the bare season name.

										     #261 review F2 — the card now SAYS it is a target: `group` +
										     a hover tint (`hover:bg-ink-5`, the SectionPicker/roster
										     hoverable-target token) + an aria-hidden disclosure triangle
										     that darkens on hover, the ✎ treatment of the #205 fields.
										     The ruling bars describing WORDS on the collapsed face, not
										     state indicators — and with the gear gone this card is the
										     ONLY way into season management (#261 finding 2). -->
										<!-- #277 review F2 — an entry that would SWITCH the panel is
										     disabled while a series run is unfinished, the same
										     condition `seasonCardCollapseDisabled` disables the collapse
										     control under and `openSeasonManagePanelFor` refuses on: the
										     switch performs the very teardown that refusal exists for,
										     and an enabled control that no-ops lies about it. Never the
										     season already in play (its own entry is a plain reopen),
										     so the single-manageable-season card is untouched — one
										     entry, always `ms.id === manageableSeasonId`, never
										     disabled.
										     #277 review F4 — the in-play season's entry is labelled
										     from the PANEL's live value (`seasonManageDeleteName`,
										     which prefers `seasonManageName` once the fields are
										     loaded), not from the `seasons` list: collapsing keeps the
										     panel's fields (the reopen-without-refetch contract) while
										     `applySeasonFieldLocally` never touches `seasons`, so a
										     rename followed by a collapse showed the OLD name here
										     while the panel's own delete confirm quoted the new one.
										     Every OTHER entry has no panel state of its own and reads
										     the list, as before. -->
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
									<!-- #261 ruling, opened face: the title row. A plain flex
									     div — role="toolbar" and the #156 roving tabindex retire
									     with the gear (stated choice: 1–2 plain buttons is a
									     degenerate arity for that pattern; every button here is a
									     natural tab stop). Escape at ANY member (the collapse
									     control or the trashcan/armed pair) routes through the
									     EXISTING `onSeasonManagePanelKeydown` UNMODIFIED — no new
									     disarm branch: `closeSeasonManagePanel()` already clears
									     the armed state and returns focus to the collapsed card's
									     OWN expand control (#197 review F2, retargeted #261 — the
									     gear was the old anchor). Bound on each BUTTON individually
									     (not the wrapping div — a11y: a static element must not
									     carry a keyboard listener). -->
									<div class="flex flex-wrap items-center gap-2">
										{#if showSeasonCard}
											<!-- #236/#238/#261 — the collapse control CARRIES the
											     season's own identity: `season-manage-label` (the
											     panel's `aria-labelledby` target) lives INSIDE it, on
											     its own inner span, so the one visible name both titles
											     the dialog and drives the toggle. Inherits the gear's
											     mid-run close refusal (`seasonCardCollapseDisabled`).
											     #261 review F1/F2/F3, mirroring the collapsed face
											     above: the <h2> WRAPS the button (Accordion header
											     shape — the trashcan stays the h2's SIBLING inside this
											     row, so `ml-auto` right-alignment is untouched); the
											     collapse verb rides inside as an sr-only span instead
											     of an accname-superseding `aria-label`, so AT hears
											     "Close season card 2026/2027"; and `group` + the hover
											     tint + the ▾ disclosure triangle say the title row is
											     clickable.
											     #261 review round 2 F1 — the collapse target SPANS the
											     title row, matching the collapsed face's `w-full`
											     whole-card target: same card, two states, ONE target
											     size (the #205 review round 3 F3 rule — activators of
											     different widths read as different kinds of control).
											     The heading absorbs the row's free space (`min-w-0
											     flex-1`) and the button fills it (`w-full`), so
											     everything from the left edge up to the trashcan is
											     live instead of only the name's own width. The
											     trashcan's `ml-auto` stays harmless — it is still the
											     row's LAST item at the right edge — and the row still
											     wraps at 375px for the long lv/uk locales. -->
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
											<!-- #217/#236, retargeted #261 — the season's OWN delete,
											     right-aligned on the title row (ml-auto, the gear's old
											     slot): the same two-step confirm idiom every row
											     carries, on the ONE `seasonManageDeleteArmed` slot
											     (arming the season disarms an armed row and vice versa).
											     PO reading 2 — armed, the confirm/cancel pair renders
											     ADJACENT to the collapse control on this SAME row, never
											     replacing it, and reachable ONLY here (opened) — the
											     #236 collapsed-arming design is REVERSED. -->
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
													disabled={seasonManageDeletePendingId !== null}
													aria-busy={seasonManageDeletePendingId === SEASON_DELETE_ROW_ID}
													class="ml-auto flex min-h-11 items-center px-1 text-xs text-red-700 underline disabled:opacity-50"
													onclick={onSeasonManageSeasonDelete}
													onkeydown={onSeasonManagePanelKeydown}
												>
													<!-- #217 review F1 — the VISIBLE text carries the scope too, not
													     just the aria-label. Same ternary shape as the series row's rule:
													     while the scope read is in flight (or if it failed) the button
													     falls back to the scope-free short copy rather than quoting a
													     number the cascade never checked. -->
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
												<!-- #217 review F3 — the panel's most destructive control gets its
												     OWN message key rather than borrowing the EVENT row's — #236
												     keeps testid AND aria-label byte-identical, only the location and
												     the glyph change. #236 (Mihkel, Q1: "red trashcan maybe? lets try
												     red trashcan icon everywhere") — a red trashcan glyph replaces the
												     old ×; colour is the EXISTING `text-red-700` destructive token the
												     confirm half already used, no new palette.
												     #238 — the 🗑 emoji resolved to the platform colour-emoji font,
												     which ignores CSS `color`, so it painted grey instead of red.
												     Replaced with `TrashIcon`, a reusable inline-SVG on
												     currentColor (src/lib/components/icons/TrashIcon.svelte) — the
												     #237 icon-sweep trial instance. #261 — the gear this glyph once
												     sat beside is gone; the trashcan keeps its own slot (ml-auto)
												     unchanged.
												     #237 — MIGRATED onto the shared DeleteTrigger unit: this was
												     one of the two pre-existing TrashIcon sites, and the "defined
												     once" contract forces it onto the shared unit rather than
												     leaving a second definition standing. -->
												<DeleteTrigger
													data-testid="season-manage-delete-season"
													aria-label={m.season_manage_season_delete({ name: seasonManageDeleteName })}
													class="ml-auto"
													onclick={() => void armSeasonManageSeasonDelete()}
													onkeydown={onSeasonManagePanelKeydown}
												/>
											{/if}
										{/if}
									</div>
								{/if}
							<!-- #217/#216/#236 — the ONE cascade progress counter, at CARD
							     level (Gama's #236 G2 ruling): a season cascade can now start
							     from the collapsed card, and a counter shut inside the panel
							     would be invisible there. Renders for BOTH a series delete and
							     a season delete — a season cascade IS a series cascade
							     (repeated) plus standalone events and repertoire items, so
							     there is no separate "season slot" needed. role="status"
							     mirrors the `series-create-progress` idiom verbatim. -->
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
							<!-- #236 G2 ruling (scope amendment) — ONLY the season-target
							     branch of the shared error slot moves to card level: that
							     target has no row of its own, and it is the only cascade that
							     can now run collapsed. The 'series' branch stays under the
							     series list (below) and the 'events' branch stays under the
							     events list, unchanged — #197 review F5 stays intact. -->
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
									<!-- #213 — the internal close × is gone; the gear (in the
									     toolbar) is the sole close control now, carrying the same
									     refusal guard that button used to.
									     #236 — the panel's OWN header row (the `<h2>` title and the
									     season's delete) is gone entirely: both are promoted into
									     the card's header row above, which is the panel's
									     `aria-labelledby` target too — one authored string names the
									     label, the gear AND the dialog (#222's authored-once
									     pattern), so the phrase renders exactly once whether the
									     panel is open or not. -->

									<!-- name -->
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
										<!-- #205 whole-field shape (admin/+page.svelte:513-540 reference): ONE
										     native <button> wraps pencil AND value so the whole field area is
										     the click/tab activator, not just the ✎ glyph. `min-h-11 w-full` —
										     `min-h-11` alone collapses the tap target back to the glyph (#165
										     review F3). The button's accessible name is computed from its own
										     text content: the sr-only action label plus the visible value (the
										     ✎ is aria-hidden), so AT hears "<action> <value>".
										     #205 review F1 — NO `aria-labelledby` on the button. `aria-labelledby`
										     SUPERSEDES an element's own contents in the accname algorithm, so
										     pointing it at the value span alone silently dropped the sr-only
										     action verb: AT computed a bare "Season 2026" with nothing saying the
										     control opens an editor — a strict regression on the pre-#205
										     aria-label, which carried the whole "edit the season name" phrase
										     from `season_manage_edit_name_label`. Content-derived naming (both children
										     inside the button, the ✎ aria-hidden) is the whole point of this
										     shape and is what the admin reference relies on too. -->
										<div class="font-display text-lg text-ink">
											<button
												type="button"
												data-testid="season-edit-btn-name"
												disabled={seasonEditPending.name === true}
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

								<!-- dates. The VISIBLE label is not decoration (#132/T3 review F3):
								     the action label rides inside the activator only, so without the
								     <p> above neither a sighted nor a screen-reader user reading the two
								     values side by side can tell start from end — and an unset bound
								     would render as a bare, unexplained ✎. -->
								<!-- #205 review round 3 F3 — `min-w-0 flex-1` on BOTH date columns.
								     Their activators carry `w-full`, but a flex ITEM defaults to
								     `flex: 0 1 auto`, so that `w-full` resolved against a content-sized
								     column: each date's activation region ended wherever its formatted
								     value happened to end, while the name activator directly above
								     spanned the panel. Three activators in one panel with three
								     different widths read as three different kinds of control. Equal
								     flex basis makes `w-full` mean the same thing in all three;
								     `min-w-0` keeps a long formatted date from forcing its column past
								     its share. -->
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
											<!-- #151 — text-base, not text-xs: this value is REPLACED in place
											     by the date input above, which renders at the 16px control
											     default (#130), so at text-xs it jumped 12px -> 16px -> 12px
											     across an edit. Same for end_date below. #205 whole-field shape
											     (see the name field above for the full rationale, including why
											     there is no `aria-labelledby` here).
											     #205 review F5 — child order is sr-only, ✎, value: pencil LEADING,
											     the admin reference order. All three activators in this one panel
											     must agree or the ✎ visibly jumps from the left of the name to the
											     right of the two dates directly beneath it. -->
											<button
												type="button"
												data-testid="season-edit-btn-start_date"
												disabled={seasonEditPending.start_date === true}
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
											<!-- #205 whole-field shape (see name field above for rationale;
											     sr-only, ✎, value — pencil leading, review F5). -->
											<button
												type="button"
												data-testid="season-edit-btn-end_date"
												disabled={seasonEditPending.end_date === true}
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

								<!-- conductors -->
								<div>
									<p class="text-xs tracking-wide text-ink-2 uppercase">
										{m.season_manage_conductors_label()}
									</p>
									{#if seasonManageConductorIds.length > 0}
										<ul class="mt-1 flex flex-wrap gap-1.5">
											{#each seasonManageConductorIds as personId (personId)}
												<!-- #132/T6 review F2 — the chip's × is an ICON-ONLY admin control:
												     44x44 (min-h-11/min-w-11), and the li drops its own vertical
												     padding so the chip is exactly as tall as the hit area it now
												     reserves rather than 44px PLUS padding. -->
												<li
													data-testid="season-manage-conductor-{personId}"
													class="flex items-center gap-1 border border-ink-5 px-1.5 text-xs text-ink"
												>
													{seasonConductorLabel(personId)}
													<!-- #237 SWEEP FENCE — DO NOT convert this to the shared
													     DeleteTrigger. The red-trashcan sweep covered Table A
													     (destroy) only; this chip is Table B (unlink), and the PO
													     ruling in #237 is that unlink is not destroy: a red trashcan
													     beside a person's NAME reads as "delete this person", not
													     "drop them from this season's conductor list". So the control
													     keeps its × and its muted tone deliberately — a decision, not
													     an oversight for the next sweep to tidy up. The same ruling
													     holds for the two sibling chips on this page
													     (season-create-conductor-remove, event-create-conductor-remove).
													     The negative fences that fail if a later sweep "finishes the
													     job" live in src/trashcan-sweep.spec.ts, section 3. -->
													<button
														type="button"
														data-testid="season-manage-conductor-remove-{personId}"
														aria-label={m.season_conductor_remove({
															name: seasonConductorLabel(personId)
														})}
														disabled={seasonManageConductorPending}
														class="flex min-h-11 min-w-11 items-center justify-center text-ink-2 hover:text-ink disabled:opacity-50"
														onclick={() => onSeasonManageConductorRemove(personId)}
													>
														&times;
													</button>
												</li>
											{/each}
										</ul>
									{/if}
									<div class="mt-1.5">
										<!-- #209 (PO standing rule 1) — native <select>. Prompt option
										     (value '') is `disabled selected hidden` (Gama ruling 1);
										     everyone-added stays MOUNTED-but-disabled with the shared
										     exhausted-state prompt (Gama ruling 2), never hidden. -->
										<select
											data-testid="season-manage-conductor-select"
											aria-label={m.season_conductor_label()}
											disabled={seasonManageConductorOptions.length === 0 ||
												seasonManageConductorPending}
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
										<!-- #321 (PO ruling 2026-09-11) — the member read behind these options
										     was partial, so a person absent from the list reads as "not a member".
										     Stated in the picker's own caveat slot (the one the order note below
										     already uses) rather than as a trailing option inside the list, for a
										     reason specific to THIS control: it goes `disabled` the moment its
										     options run out, and the exhausted prompt it then shows — "everyone is
										     already added" — is the truncation's most misleading face. A notice
										     inside a dropdown that cannot be opened would be unreachable exactly
										     when it matters most; the library's always-open pickers carry theirs
										     as a trailing option instead. -->
										{#if rosterPartial}
											<p data-testid="season-manage-conductor-partial-notice" role="status" class="text-xs text-ink-2">
												{m.picker_partial_members_notice()}
											</p>
										{/if}
										<!-- #209 review F2 — the SECTION read behind roster order failed: the
										     picker still works off the roster's own name order, and says so
										     rather than passing a different order off as the roster's. -->
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
									<!-- #325 — the caveat-slot paragraph shape #321 already uses
									     beside this select (partial-notice/order-note above), so a
									     write in flight is VISIBLE, not merely a disabled control
									     (docs/qa/autosave-field-inventory.md: `disabled` alone is a
									     double-tap guard, not a state signal). -->
									{#if seasonManageConductorPending}
										<p
											data-testid="season-manage-conductor-pending-notice"
											role="status"
											class="text-xs text-ink-2"
										>
											{m.season_manage_conductor_saving()}
										</p>
									{/if}
									<!-- #325/#267 shape — persistent role="status" region, mounted
									     blank from first render (a live region announces only
									     CHANGES to its contents) so a settle is distinguishable from
									     silence even when nothing failed. -->
									<div
										data-testid="season-manage-conductor-status"
										role="status"
										aria-live="polite"
										class="sr-only"
									>
										{seasonManageConductorStatus}
									</div>
								</div>

								<!-- event series -->
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
										<div
											data-testid="series-create-form"
											role="dialog"
											aria-label={m.series_create_form_label()}
											tabindex="-1"
											class="mt-1 flex flex-col gap-1.5 border-b border-dashed border-ink-5 pb-3"
											onkeydown={onSeriesCreateFormKeydown}
										>
											<!-- Every box below carries `disabled={seriesCreateLocked}`: once a
											     run has stopped partway, submit finishes THAT run and edits here
											     would be silently discarded (review F5).
											     #239 — four native <fieldset>/<legend> groups (PO ruling,
											     2026-09-04): general / location / schedule / preview. Every
											     control now carries a VISIBLE <label> that IS its accessible
											     name — the old aria-labels are dropped so the name has exactly
											     one author (the #205 review F1 trap). -->
											<fieldset class="flex min-w-0 flex-col gap-1.5 border-0 p-0">
												<legend class="mb-0.5 text-xs tracking-wide text-ink-2 uppercase">
													{m.series_create_group_general_label()}
												</legend>
												<label class="flex w-full flex-col gap-0.5">
													<span class="text-xs text-ink-2">{m.series_create_name_label()}</span>
													<input
														type="text"
														data-testid="series-create-name"
														bind:this={seriesCreateNameInput}
														aria-invalid={seriesCreateInvalid('name')}
														aria-describedby={seriesCreateDescribedBy('name')}
														placeholder={m.series_create_name_placeholder()}
														disabled={seriesCreateLocked}
														value={seriesCreateName}
														oninput={(e) => {
															seriesCreateName = (e.currentTarget as HTMLInputElement).value;
															clearSeriesCreateError();
														}}
														class="w-full border border-ink-5 bg-paper px-1.5 py-1 text-ink disabled:opacity-50"
													/>
												</label>
												<!-- #199 review F4 — same reasoning as event-create-type: a
												     never-blank <select> has no placeholder to name itself
												     with, so the visible name is a wrapping <label>. -->
												<label class="flex w-full flex-col gap-0.5">
													<span data-testid="series-create-type-label" class="text-xs text-ink-2">
														{m.series_create_type_label()}
													</span>
													<select
														data-testid="series-create-type"
														aria-invalid={seriesCreateInvalid('type')}
														aria-describedby={seriesCreateDescribedBy('type')}
														disabled={seriesCreateLocked}
														value={seriesCreateType}
														onchange={(e) => {
															seriesCreateType = (e.currentTarget as HTMLSelectElement).value;
															clearSeriesCreateError();
														}}
														class="w-full border border-ink-5 bg-paper px-1.5 py-1 text-ink disabled:opacity-50"
													>
														{#each CANONICAL_EVENT_TYPES as type (type)}
															<option value={type}>{eventTypeLabel(type)}</option>
														{/each}
													</select>
												</label>
												<label class="flex w-full flex-col gap-0.5">
													<span class="text-xs text-ink-2">
														{m.series_create_description_label()}
													</span>
													<textarea
														data-testid="series-create-description"
														placeholder={m.series_create_description_placeholder()}
														disabled={seriesCreateLocked}
														value={seriesCreateDescription}
														oninput={(e) =>
															(seriesCreateDescription = (
																e.currentTarget as HTMLTextAreaElement
															).value)}
														class="w-full border border-ink-5 bg-paper px-1.5 py-1 text-ink disabled:opacity-50"
													></textarea>
												</label>
											</fieldset>

											<fieldset class="flex min-w-0 flex-col gap-1.5 border-0 p-0">
												<legend class="mb-0.5 text-xs tracking-wide text-ink-2 uppercase">
													{m.series_create_group_location_label()}
												</legend>
												<label class="flex w-full flex-col gap-0.5">
													<span class="text-xs text-ink-2">
														{m.series_create_duration_label()}
													</span>
													<input
														type="number"
														data-testid="series-create-duration"
														aria-invalid={seriesCreateInvalid('duration')}
														aria-describedby={seriesCreateDescribedBy('duration')}
														placeholder={m.series_create_duration_placeholder()}
														disabled={seriesCreateLocked}
														value={seriesCreateDuration}
														oninput={(e) => {
															seriesCreateDuration = (e.currentTarget as HTMLInputElement).value;
															clearSeriesCreateError();
														}}
														class="w-full border border-ink-5 bg-paper px-1.5 py-1 text-ink disabled:opacity-50"
													/>
												</label>
												<label class="flex w-full flex-col gap-0.5">
													<span class="text-xs text-ink-2">
														{m.series_create_location_label()}
													</span>
													<input
														type="text"
														data-testid="series-create-location"
														list={LOCATION_SUGGESTIONS_ID}
														placeholder={m.series_create_location_placeholder()}
														disabled={seriesCreateLocked}
														value={seriesCreateLocation}
														oninput={(e) =>
															(seriesCreateLocation = (e.currentTarget as HTMLInputElement).value)}
														class="w-full border border-ink-5 bg-paper px-1.5 py-1 text-ink disabled:opacity-50"
													/>
												</label>
											</fieldset>

											<fieldset class="flex min-w-0 flex-col gap-1.5 border-0 p-0">
												<legend class="mb-0.5 text-xs tracking-wide text-ink-2 uppercase">
													{m.series_create_group_schedule_label()}
												</legend>
												<div class="flex gap-2">
													<label class="flex min-w-0 flex-1 flex-col gap-0.5">
														<span class="text-xs text-ink-2">
															{m.series_create_repeat_label()}
														</span>
														<select
															data-testid="series-create-repeat"
															disabled={seriesCreateLocked}
															value={seriesCreateRepeat}
															onchange={(e) =>
																(seriesCreateRepeat = (e.currentTarget as HTMLSelectElement)
																	.value as RepeatPattern)}
															class="w-full border border-ink-5 bg-paper px-1.5 py-1 text-ink disabled:opacity-50"
														>
															<option value="weekly">{m.series_create_repeat_weekly()}</option>
															<option value="biweekly">{m.series_create_repeat_biweekly()}</option>
															<option value="daily">{m.series_create_repeat_daily()}</option>
														</select>
													</label>
													<!-- Daily ignores the day of week entirely (recurrence.ts) — an
													     inert control must not be shown, let alone demanded. -->
													{#if seriesCreateDayApplies}
														<label class="flex min-w-0 flex-1 flex-col gap-0.5">
															<span class="text-xs text-ink-2">
																{m.series_create_day_label()}
															</span>
															<select
																data-testid="series-create-day"
																aria-invalid={seriesCreateInvalid('day')}
																aria-describedby={seriesCreateDescribedBy('day')}
																disabled={seriesCreateLocked}
																value={seriesCreateDay}
																onchange={(e) => {
																	seriesCreateDay = (e.currentTarget as HTMLSelectElement).value;
																	clearSeriesCreateError();
																}}
																class="w-full border border-ink-5 bg-paper px-1.5 py-1 text-ink disabled:opacity-50"
															>
																<option value="">{m.series_create_day_placeholder()}</option>
																<!-- #207 rule 6 — Monday-first DISPLAY order (1,2,3,4,5,6,0).
																     VALUES stay JS getDay() numbers, untouched — only the
																     rendering order changes. -->
																<option value="1">{m.series_create_day_1()}</option>
																<option value="2">{m.series_create_day_2()}</option>
																<option value="3">{m.series_create_day_3()}</option>
																<option value="4">{m.series_create_day_4()}</option>
																<option value="5">{m.series_create_day_5()}</option>
																<option value="6">{m.series_create_day_6()}</option>
																<option value="0">{m.series_create_day_0()}</option>
															</select>
														</label>
													{/if}
												</div>

												<!-- #207 rule 5 — the TimeSelect composite replaces the native
												     type="time" input (whose rendering followed browser locale):
												     24h by default, 5-minute resolution BY CONSTRUCTION of the
												     minute options, AM/PM via the profile preference. The wrapper
												     keeps the surface testid and, as a NAMED role="group", carries
												     the accessible name the old input's aria-label carried; the
												     aria-invalid/describedby wiring goes DOWN onto the selects
												     themselves, where a screen reader actually announces it
												     (#207 review F2). #239 — the group's name now comes from a
												     VISIBLE sibling label (aria-labelledby), not an aria-label:
												     the per-select aria-labels on the hour/minute PARTS are
												     untouched (TimeSelect.spec.ts owns their contract). -->
												<div class="flex flex-col gap-0.5">
													<span id="series-create-time-label" class="text-xs text-ink-2">
														{m.series_create_time_label()}
													</span>
													<div
														data-testid="series-create-time"
														role="group"
														aria-labelledby="series-create-time-label"
														class="flex gap-2"
													>
														<TimeSelect
															prefix="series-create-time"
															value={seriesCreateTime}
															disabled={seriesCreateLocked}
															invalid={seriesCreateInvalid('time')}
															describedBy={seriesCreateDescribedBy('time')}
															onchange={(v) => {
																seriesCreateTime = v;
																clearSeriesCreateError();
															}}
														/>
													</div>
												</div>

												<div class="flex gap-2">
													<label class="flex min-w-0 flex-1 flex-col gap-0.5">
														<span class="text-xs text-ink-2">{m.series_create_from_label()}</span>
														<input
															type="date"
															data-testid="series-create-from"
															aria-invalid={seriesCreateInvalid('from')}
															aria-describedby={seriesCreateDescribedBy('from')}
															disabled={seriesCreateLocked}
															value={seriesCreateFrom}
															oninput={(e) => {
																seriesCreateFrom = (e.currentTarget as HTMLInputElement).value;
																clearSeriesCreateError();
															}}
															class="w-full border border-ink-5 bg-paper px-1.5 py-1 text-ink disabled:opacity-50"
														/>
													</label>
													<label class="flex min-w-0 flex-1 flex-col gap-0.5">
														<span class="text-xs text-ink-2">{m.series_create_until_label()}</span>
														<input
															type="date"
															data-testid="series-create-until"
															aria-invalid={seriesCreateInvalid('until')}
															aria-describedby={seriesCreateDescribedBy('until')}
															disabled={seriesCreateLocked}
															value={seriesCreateUntil}
															oninput={(e) => {
																seriesCreateUntil = (e.currentTarget as HTMLInputElement).value;
																clearSeriesCreateError();
															}}
															class="w-full border border-ink-5 bg-paper px-1.5 py-1 text-ink disabled:opacity-50"
														/>
													</label>
												</div>
											</fieldset>

											<fieldset class="flex min-w-0 flex-col gap-1.5 border-0 p-0">
												<legend class="mb-0.5 text-xs tracking-wide text-ink-2 uppercase">
													{m.series_create_group_preview_label()}
												</legend>
												{#if seriesCreateMonthGroups !== null}
												<!-- #215 — the preview lists EVERY candidate date as a native
												     toggle chip; tapping one skips it (struck + muted, still
												     rendered) instead of routing through a separate skip input.
												     Gama ruling (1): wrapping grid, NO inner scroll region — a
												     90-date daily season stays flat, grouped by month under a
												     display-only heading. -->
												<div data-testid="series-create-preview" class="text-xs text-ink-2">
													<p class="tracking-wide uppercase">
														{m.series_create_preview_label()}
													</p>
													<!-- The count says up front what submit will do.
													     Suppressed once a stopped run is resumable: submit would then
													     create only the remainder, and the resume notice below is the
													     number that applies. -->
													{#if !seriesCreateResume && seriesCreatePreviewDates !== null}
														<p data-testid="series-create-preview-count" class="text-ink">
															{seriesCreatePreviewDates.length === 1
																? m.series_create_preview_count_one()
																: m.series_create_preview_count_other({
																		count: seriesCreatePreviewDates.length
																	})}
														</p>
													{/if}
													<div class="flex flex-col gap-2">
														{#each seriesCreateMonthGroups as group (group.month)}
															<div class="flex flex-col gap-1.5">
																<h4
																	data-testid="series-create-month-{group.month}"
																	class="text-xs tracking-wide text-ink-2 uppercase"
																>
																	{seriesCreateMonthLabel(group.month)}
																</h4>
																<div class="flex flex-wrap gap-1.5">
																	{#each group.dates as date (date)}
																		{@const iso = seriesCreateIsoDay(date)}
																		{@const skipped =
																			!seriesCreateResume && seriesCreateSkipDates.includes(iso)}
																		<button
																			type="button"
																			data-testid="series-create-date-{iso}"
																			aria-pressed={skipped ? 'false' : 'true'}
																			aria-label={skipped
																				? m.series_create_date_skipped({ date: iso })
																				: undefined}
																			disabled={seriesCreateLocked}
																			class="flex min-h-11 min-w-11 items-center justify-center border border-ink-5 px-1.5 text-xs disabled:opacity-50 {skipped
																				? 'text-ink-2 line-through'
																				: 'text-ink'}"
																			onclick={() => toggleSeriesCreateSkipDate(iso)}
																		>
																			{iso}
																		</button>
																	{/each}
																</div>
															</div>
														{/each}
													</div>
													<!-- #241 — the display cap: at most 50 chips draw at a time.
													     Both controls are VIEW-only (never touch skip state) and
													     leave once everything is shown; show-next's {count} is the
													     actual next-batch size off the pre-skip GRID set, show-all's
													     is the count line's own skip-applied total — one source —
													     falling back to the grid's own length once the count line is
													     suppressed by a resumable run (review F1). -->
													{#if seriesCreateHiddenCount > 0}
														<div class="flex gap-2">
															<button
																type="button"
																data-testid="series-create-show-next"
																class="flex min-h-11 items-center border border-ink-5 px-2 py-1 text-xs text-ink hover:bg-ink hover:text-paper"
																onclick={revealSeriesCreateNext}
															>
																{m.series_create_show_next_label({ count: seriesCreateNextBatchSize })}
															</button>
															<button
																type="button"
																data-testid="series-create-show-all"
																class="flex min-h-11 items-center border border-ink-5 px-2 py-1 text-xs text-ink hover:bg-ink hover:text-paper"
																onclick={revealSeriesCreateAll}
															>
																{m.series_create_show_all_label({
																	count: seriesCreateShowAllCount
																})}
															</button>
														</div>
													{/if}
												</div>
											{/if}

											{#if seriesCreateResume}
												<p data-testid="series-create-resume" class="text-xs text-ink-2">
													{m.series_create_resume_notice({
														remaining: seriesCreateResume.remaining.length,
														total: seriesCreateResume.total
													})}
												</p>
											{/if}

											{#if seriesCreateProgress}
												<p data-testid="series-create-progress" role="status" class="text-xs text-ink-2">
													{m.series_create_progress({
														current: seriesCreateProgress.current,
														total: seriesCreateProgress.total
													})}
												</p>
											{/if}

											{#if seriesCreateError}
												<p
													id="series-create-error"
													data-testid="series-create-error"
													role="alert"
													class="text-xs text-red-700"
												>
													{seriesCreateError()}
												</p>
											{/if}

											<div class="flex gap-2">
												<button
													type="button"
													data-testid="series-create-submit"
													disabled={seriesCreateSubmitting || seriesCreateNothingToSubmit}
													aria-busy={seriesCreateSubmitting}
													class="flex min-h-11 items-center border border-ink px-2 py-1 text-xs text-ink hover:bg-ink hover:text-paper disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-ink"
													onclick={() => void submitSeriesCreate()}
												>
													{m.series_create_submit()}
												</button>
												<button
													type="button"
													data-testid="series-create-cancel"
													disabled={seriesCreateSubmitting}
													class="flex min-h-11 items-center px-2 py-1 text-xs text-ink-2 hover:text-ink disabled:opacity-50 disabled:hover:text-ink-2"
													onclick={dismissSeriesCreateForm}
												>
													{m.roster_cancel()}
												</button>
											</div>
											</fieldset>
										</div>
									{/if}
									<!-- #321 review F1 — the panel's own partial notice, directly
									     above the rows it is about (the same slot the load-error line
									     occupies, for the same reason: a statement about THIS list sits
									     against THIS list). Deliberately the SAME markup the /library,
									     /roster and rsvp/attendance notices use — visible <p>,
									     role="status", dashed border, own testid, copy through i18n:
									     one pattern for one meaning, never a second visual language.
									     Persistent and never sr-only (a truncated list is a standing
									     fact, not a transient toast), absent from the DOM once the read
									     is complete. `resetSeasonManage` is what keeps it from
									     surviving a season or collective switch. The one deviation is
									     `text-xs` for `text-sm`: this panel's every line (heading, rows,
									     counts, the error slot below) is xs, and the page-level notices'
									     sm would render this one LARGER than the section it sits in. -->
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
												<!-- The count is a SENTENCE, not a bare glyph: an unlabelled
												     number announces as "Monday rehearsals 12" (#132/T3 review
												     F2). Parameterised, count-safe copy — this pipeline has no
												     ICU plural support (probed: ICU plural syntax compiles to
												     garbage, and the messageFormat plugin's match shape flattens
												     into separate keys), so a label form carries every count in
												     all four locales. Real plural categories ride with the
												     standing YELLOW-128.1 pluralization work. -->
												<span class="text-ink-2"
													>{m.season_manage_series_event_count({ count: series.eventCount })}</span
												>
												<!-- #197 — icon-only admin control, same 44x44 hit area as the
												     conductor chip's × above. Deleting a series CASCADES to its
												     occurrences (see seasonManage.ts's module contract for why
												     refusing is not an option here), so #197 review F2 puts the
												     roster's two-step inline confirm in front of it and F2 again
												     puts the occurrence COUNT in the confirm label: the operator
												     must see what the delete takes with it.
												     #197 review 2nd pass F2 — that count is the LIVE one the arming
												     click re-read (`seasonManageArmedSeriesCount`), not the list's
												     client-side tally; while the read is in flight (or if it fails)
												     the confirm quotes no number rather than a number the cascade
												     never checks.
												     #313 — this used to also sit behind `{#if eventConvertOpenId
												     === null}`: the open convert form (now relocated to the event
												     page) used to unmount every row's delete control while it was
												     open, the same `{#if !seriesCreateOpen}`/`{#if !eventCreateOpen}`
												     mutual-exclusion precedent the panel's opener buttons use. No
												     convert form lives in this panel any more, so the wrapper left
												     with it. -->
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
														disabled={seasonManageDeletePendingId !== null}
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
													<!-- #237 — joins the shared red-trashcan unit; the old
													     muted × leaves for TrashIcon + the destructive red pair. -->
													<DeleteTrigger
														data-testid="season-manage-series-delete-{series.id}"
														aria-label={m.season_manage_series_delete({ name: series.name })}
														onclick={() => void armSeasonManageSeriesDelete(series)}
													/>
												{/if}
											</div>
										</div>
									{/each}
									<!-- #236 G2 — the progress counter that used to render here
									     moved to CARD level (above the panel, both states) since a
									     season cascade can now start collapsed. -->
									{#if seasonManageDeleteError?.list === 'series'}
										<!-- #197 review F5 — under the list that actually failed. The
										     shared slot used to render below the standalone-EVENTS
										     list, so a failed SERIES delete printed its message
										     visually detached from the row it was about.
										     #236 G2 (scope amendment) — the SEASON branch moved to
										     card level (above); this slot now carries ONLY the
										     'series' case, unchanged in every other respect. -->
										<p
											data-testid="season-manage-delete-error"
											role="alert"
											class="mt-1 text-xs text-red-700"
										>
											{seasonManageDeleteErrorText(seasonManageDeleteError)}
										</p>
									{/if}
								</div>

								<!-- #313 — [+ Event] SURVIVES the standalone-event LIST'S removal:
								     creating an event from the panel is not the same affordance as
								     listing them, and #313's ask ("we dont need to list events")
								     never touched creation. Same `!eventCreateOpen`/
								     `createEntryPointsBlocked` gating as before. -->
								{#if !eventCreateOpen}
									<button
										type="button"
										data-testid="season-manage-add-event"
										disabled={createEntryPointsBlocked}
										class="flex min-h-11 items-center text-xs text-ink underline disabled:opacity-50"
										onclick={() => openEventCreateForm('panel')}
									>
										{m.season_manage_add_event()}
									</button>
								{/if}

								<!-- season repertoire (#234 — Mihkel live-gate: "I cant see the
								     programme management on season management card." Scoped to
								     THIS panel's season (manageableSeasonId), per Gama's PO ruling
								     on the issue — NOT the currentSeasonId-scoped `seasonRepertoire`/
								     `pickableWorksList`/`handleAddWork` the per-event works lines use
								     (those stay untouched — #234 Done-when 3, the fallback entry
								     point for an event editor without season rights). Rights reuse
								     `manageableSeasonRights`, the panel's own gate — the panel is
								     unreachable without it, so no separate rights check is needed
								     here. -->
								<div data-testid="season-manage-repertoire">
									<p class="text-xs tracking-wide text-ink-2 uppercase">
										{m.season_manage_repertoire_label()}
									</p>
									<!-- Review F4 — a failed panel read says so, exactly as the
									     series/events lists above do: an empty section otherwise
									     reads as "this season has no repertoire". -->
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
										addWorkKey={PANEL_ADD_WORK_KEY}
										expanded={true}
										onpdfclick={handlePdfClick}
										onaddwork={handlePanelAddWork}
										onstatuschange={handlePanelStatusChange}
										onremoveitem={handlePanelRemoveItem}
									/>
									<!-- #324 — a panel management write that failed. Its optimistic
									     change is already rolled back by the time this renders;
									     without the message the value would just snap back and read
									     as a bug (the agenda-side queue's own `manageError` idiom,
									     propagated to this section). DISTINCT node from
									     `season-manage-repertoire-error` above: a rejected WRITE is
									     never a failed list load. -->
									{#if panelManageError}
										<p
											data-testid="repertoire-manage-error"
											role="alert"
											class="mt-1 text-xs text-red-700"
										>
											{m.repertoire_manage_error()}
										</p>
									{/if}
									<!-- #324/#267 shape — persistent sr-only role="status" region,
									     mounted from first render (a live region announces only
									     CHANGES to its contents) so a settle is distinguishable from
									     silence even when nothing failed. -->
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
						<!-- #197 review F5 — the delete RESULT, same contract as
						     `roster-section-remove-status` (WCAG 4.1.3): mounted from the
						     page's first render (a live region announces only CHANGES to its
						     contents) and visually hidden, because a sighted user watched the
						     row/panel vanish. Only SUCCESS lands here; a refused delete is a
						     role="alert" under the list it belongs to.
						     #217 — deliberately OUTSIDE `{#if seasonManageOpen}`: a season
						     delete closes the panel on success, and a live region that
						     unmounts with it announces nothing (the same #132/T3 review F1
						     debt every self-unmounting control on this page pays). Row-level
						     (series/event) deletes leave the panel open either way, so moving
						     this out costs them nothing. -->
						<div
							data-testid="season-manage-delete-status"
							role="status"
							aria-live="polite"
							class="sr-only"
						>
							{seasonManageDeleteStatus}
						</div>
						<!-- #132/T2 — page-level [+ Season] creation form. The trigger button
						     now lives in the #149 admin toolbar above; this block is the
						     form only. The status region is mounted from first render (a
						     live region announces only CHANGES to its contents).
						     #298 — visibility comes from styling on content presence, never
						     from `{#if}` (a live region inserted already-populated is not
						     announced): `sr-only` toggles off the SAME state the text binds
						     to, on this SAME node. `mb-2` is static (present whether or not
						     `sr-only` is) — harmless while out-of-flow, and gives the newly
						     visible line breathing room from the form/cards below instead of
						     landing flush against them. -->
						<div
							data-testid="season-create-status"
							role="status"
							aria-live="polite"
							class="mb-2 text-xs text-ink-2"
							class:sr-only={!seasonCreateStatus}
						>
							{seasonCreateStatus}
						</div>
						{#if showSeasonCreate}
							{#if seasonCreateOpen}
								<div
									data-testid="season-create-form"
									role="dialog"
									aria-label={m.season_create_form_label()}
									tabindex="-1"
									class="mb-3 flex flex-col gap-1.5 border-b border-dashed border-ink-5 pb-3"
									onkeydown={onSeasonFormKeydown}
								>
									<input
										type="text"
										data-testid="season-create-name"
										bind:this={seasonCreateNameInput}
										aria-label={m.season_name_label()}
										placeholder={m.season_name_label()}
										aria-invalid={seasonCreateErrorField === 'name' ? true : undefined}
										aria-describedby={seasonCreateErrorField === 'name'
											? 'season-create-error'
											: undefined}
										value={seasonCreateName}
										oninput={(e) => {
											seasonCreateName = (e.currentTarget as HTMLInputElement).value;
											clearSeasonCreateError();
										}}
										onkeydown={onSeasonCreateNameKeydown}
										class="w-full border border-ink-5 bg-paper px-1.5 py-1 text-ink"
									/>
									<!-- F7 — `min-w-0` on BOTH: a flex item's default `min-width: auto`
									     floors it at its intrinsic content width, and a native date
									     control's intrinsic width is wide enough that the pair cannot
									     shrink into a 320px viewport's ~256px of usable form width. -->
									<div class="flex gap-2">
										<input
											type="date"
											data-testid="season-create-start"
											aria-label={m.season_start_date_label()}
											aria-invalid={seasonCreateErrorField === 'dates' ? true : undefined}
											aria-describedby={seasonCreateErrorField === 'dates'
												? 'season-create-error'
												: undefined}
											value={seasonCreateStartDate}
											oninput={(e) => {
												seasonCreateStartDate = (e.currentTarget as HTMLInputElement).value;
												clearSeasonCreateError();
											}}
											class="min-w-0 flex-1 border border-ink-5 bg-paper px-1.5 py-1 text-ink"
										/>
										<input
											type="date"
											data-testid="season-create-end"
											aria-label={m.season_end_date_label()}
											aria-invalid={seasonCreateErrorField === 'dates' ? true : undefined}
											aria-describedby={seasonCreateErrorField === 'dates'
												? 'season-create-error'
												: undefined}
											value={seasonCreateEndDate}
											oninput={(e) => {
												seasonCreateEndDate = (e.currentTarget as HTMLInputElement).value;
												clearSeasonCreateError();
											}}
											class="min-w-0 flex-1 border border-ink-5 bg-paper px-1.5 py-1 text-ink"
										/>
									</div>
									<!-- #209 (PO standing rule 1) — native <select>. Prompt option
									     (value '') is `disabled selected hidden` (Gama ruling 1);
									     everyone-picked stays MOUNTED-but-disabled with the shared
									     exhausted-state prompt (Gama ruling 2), never hidden. -->
									<select
										data-testid="season-create-conductor-select"
										aria-label={m.season_conductor_label()}
										disabled={seasonConductorOptions.length === 0}
										value=""
										onchange={(e) => {
											const target = e.currentTarget as HTMLSelectElement;
											const personId = target.value;
											target.value = '';
											if (!personId) return;
											const label =
												seasonConductorOptions.find((o) => o.id === personId)?.label ?? '';
											onSeasonConductorSelect({ id: personId, label });
										}}
										class="w-full border border-ink-5 bg-paper px-1.5 py-1 text-ink disabled:opacity-50"
									>
										<option value="" disabled selected hidden>
											{pickerPromptText(
												seasonConductorOptions.length,
												m.season_conductor_placeholder()
											)}
										</option>
										{#each seasonConductorOptions as option (option.id)}
											<option value={option.id}>{option.label}</option>
										{/each}
									</select>
									<!-- #321 (PO ruling 2026-09-11) — the member read behind these options
									     was partial, so a person absent from the list reads as "not a member".
									     Stated in the picker's own caveat slot (the one the order note below
									     already uses) rather than as a trailing option inside the list, for a
									     reason specific to THIS control: it goes `disabled` the moment its
									     options run out, and the exhausted prompt it then shows — "everyone is
									     already added" — is the truncation's most misleading face. A notice
									     inside a dropdown that cannot be opened would be unreachable exactly
									     when it matters most; the library's always-open pickers carry theirs
									     as a trailing option instead. -->
									{#if rosterPartial}
										<p data-testid="season-create-conductor-partial-notice" role="status" class="text-xs text-ink-2">
											{m.picker_partial_members_notice()}
										</p>
									{/if}
									<!-- #209 review F2 — the SECTION read behind roster order failed: the
									     picker still works off the roster's own name order, and says so
									     rather than passing a different order off as the roster's. -->
									{#if sectionsReadFailed}
										<p data-testid="season-create-conductor-order-note" class="text-xs text-ink-2">
											{m.picker_order_fallback()}
										</p>
									{/if}
									{#if seasonCreateConductors.length > 0}
										<ul class="flex flex-wrap gap-1.5">
											{#each seasonCreateConductors as conductor (conductor.id)}
												<!-- #132/T6 review F2 — icon-only, so 44x44 (see the panel chip). -->
												<li
													data-testid="season-create-conductor-{conductor.id}"
													class="flex items-center gap-1 border border-ink-5 px-1.5 text-xs text-ink"
												>
													{conductor.name}
													<button
														type="button"
														data-testid="season-create-conductor-remove-{conductor.id}"
														aria-label={m.season_conductor_remove({ name: conductor.name })}
														class="flex min-h-11 min-w-11 items-center justify-center text-ink-2 hover:text-ink"
														onclick={() => removeSeasonConductor(conductor.id)}
													>
														&times;
													</button>
												</li>
											{/each}
										</ul>
									{/if}
									{#if seasonCreateError}
										<p
											id="season-create-error"
											role="alert"
											data-testid="season-create-error"
											class="text-xs text-red-700"
										>
											{seasonCreateError()}
										</p>
									{/if}
									<div class="flex gap-2">
										<button
											type="button"
											data-testid="season-create-submit"
											disabled={seasonCreateSubmitting}
											aria-busy={seasonCreateSubmitting}
											class="flex min-h-11 items-center border border-ink px-2 py-1 text-xs text-ink hover:bg-ink hover:text-paper disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-ink"
											onclick={() => void submitSeasonCreate()}
										>
											{m.season_create_submit()}
										</button>
										<button
											type="button"
											data-testid="season-create-cancel"
											disabled={seasonCreateSubmitting}
											class="flex min-h-11 items-center px-2 py-1 text-xs text-ink-2 hover:text-ink disabled:opacity-50 disabled:hover:text-ink-2"
											onclick={dismissSeasonCreateForm}
										>
											{m.roster_cancel()}
										</button>
									</div>
								</div>
							{/if}
						{/if}
						<!-- #132/T4 — the page-level [+ Event] creation form. The trigger
						     button now lives in the #149 admin toolbar above; this block is
						     the form only. -->
						<!-- #132/T4 review F3 — mounted from FIRST render, like
						     `season-create-status`: a live region inserted already-populated
						     is generally not announced; only a change to a present one is.
						     #298 — same visibility mechanism as `season-create-status`: a
						     reactive `sr-only` toggle on this SAME node, off the SAME state
						     the text binds to, never an `{#if}`. `mb-2` gives the visible
						     line space before the event form/season cards below. -->
						<div
							data-testid="event-create-status"
							role="status"
							aria-live="polite"
							class="mb-2 text-xs text-ink-2"
							class:sr-only={!eventCreateStatus}
						>
							{eventCreateStatus}
						</div>
						{#if eventCreateOpen}
							<div
								data-testid="event-create-form"
								role="dialog"
								aria-label={m.event_create_form_label()}
								tabindex="-1"
								class="mb-3 flex flex-col gap-1.5 border-b border-dashed border-ink-5 pb-3"
								onkeydown={onEventCreateFormKeydown}
							>
								<!-- #199 — the canonical, localized picker: same shape as
								     series-create-type.
								     #242 ruling — empty start, one explicit choice: a leading ''
								     option (labeled by event_create_type_placeholder, same idiom
								     as the season select's placeholder) is the initial selection
								     and is refused on submit. The wrapping <label> still gives
								     the select a VISIBLE name (review F4), independent of whether
								     a placeholder option exists. -->
								<label class="flex w-full flex-col gap-0.5">
									<span data-testid="event-create-type-label" class="text-xs text-ink-2">
										{m.event_create_type_label()}
									</span>
									<!-- #205 F1 / #249 — the wrapping <label> above already names
									     this select; a same-key aria-label is a redundant second
									     name (the single-name rule the house has settled on). -->
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

								<!-- #196 — the "wasted a standalone event, wanted it recurring"
								     dead-end this hint heads off (Joosep, Crede pilot): visible only
								     while the series select still reads "" (standalone). A standalone
								     event created anyway is not lost either — #313 moved the convert
								     control to the EVENT PAGE (event-detail-convert), so the hint below
									     now points there, not at this panel. -->
								{#if eventCreateSeriesId === ''}
									<p data-testid="event-create-series-hint" class="text-xs text-ink-2">
										{m.event_create_series_hint()}
									</p>
								{/if}

								<!-- #208 (Gama ruling) — the placeholder stays the STATIC descriptive
								     hint at all times; a series selection never writes into it (and
								     never into .value — an own '' would shadow the inherited default
								     in the read-side ?? merge). The inherited value, when the series
								     provides one, renders instead as a muted "From series: …" line
								     directly under the field (event-create-name-inherited below) —
								     presentation only, so what gets sent on submit is unaffected. -->
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

								<!-- #207 rule 5 / #239 idiom / #243 (Gama's on-issue addition,
								     binding) — a composite: the native date input stays (Gama
								     ruling — native date pickers are kept), paired with the
								     TimeSelect hour/minute composite instead of the datetime-local
								     input's browser-locale time half. The group's accessible name
								     comes from a VISIBLE sibling <span> via aria-labelledby, NOT an
								     aria-label on the wrapper (#205 F1 trap) — the date input inside
								     keeps its own date-specific aria-label naming its PART.
								     aria-invalid/describedby goes DOWN onto the real controls, where
								     a screen reader actually announces it (#207 review F2). -->
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
												// #243 — the end date MIRRORS the start date until the viewer
												// touches the end date directly (Done-when 4): the common
												// same-day camp costs one interaction, not two.
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

								<!-- #243 — the end pair REPLACES the duration number input: nobody
								     thinks of a camp as 2 880 minutes. duration_minutes is DERIVED
								     on submit from two INDEPENDENT UTC conversions (DST-safe — see
								     `eventCreateDerivedDuration`); a blank end TIME is exactly the
								     "inherit from series" state the old blank number input meant. -->
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
										list={LOCATION_SUGGESTIONS_ID}
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
									<!-- #209 (PO standing rule 1) — native <select>. Prompt option
									     (value '') is `disabled selected hidden` (Gama ruling 1);
									     everyone-picked stays MOUNTED-but-disabled with the shared
									     exhausted-state prompt (Gama ruling 2), never hidden. -->
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
									<!-- #321 (PO ruling 2026-09-11) — the member read behind these options
									     was partial, so a person absent from the list reads as "not a member".
									     Stated in the picker's own caveat slot (the one the order note below
									     already uses) rather than as a trailing option inside the list, for a
									     reason specific to THIS control: it goes `disabled` the moment its
									     options run out, and the exhausted prompt it then shows — "everyone is
									     already added" — is the truncation's most misleading face. A notice
									     inside a dropdown that cannot be opened would be unreachable exactly
									     when it matters most; the library's always-open pickers carry theirs
									     as a trailing option instead. -->
									{#if rosterPartial}
										<p data-testid="event-create-conductor-partial-notice" role="status" class="text-xs text-ink-2">
											{m.picker_partial_members_notice()}
										</p>
									{/if}
									<!-- #209 review F2 — the SECTION read behind roster order failed: the
									     picker still works off the roster's own name order, and says so
									     rather than passing a different order off as the roster's. -->
									{#if sectionsReadFailed}
										<p data-testid="event-create-conductor-order-note" class="text-xs text-ink-2">
											{m.picker_order_fallback()}
										</p>
									{/if}
								</div>
								{#if eventCreateConductors.length > 0}
									<ul class="flex flex-wrap gap-1.5">
										{#each eventCreateConductors as conductor (conductor.id)}
											<!-- #132/T6 review F2 — icon-only, so 44x44 (see the panel chip). -->
											<li
												data-testid="event-create-conductor-{conductor.id}"
												class="flex items-center gap-1 border border-ink-5 px-1.5 text-xs text-ink"
											>
												{conductor.name}
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
										disabled={eventCreateSubmitting}
										aria-busy={eventCreateSubmitting}
										class="flex min-h-11 items-center border border-ink px-2 py-1 text-xs text-ink hover:bg-ink hover:text-paper disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-ink"
										onclick={() => void submitEventCreate()}
									>
										{m.event_create_submit()}
									</button>
									<button
										type="button"
										data-testid="event-create-cancel"
										disabled={eventCreateSubmitting}
										class="flex min-h-11 items-center px-2 py-1 text-xs text-ink-2 hover:text-ink disabled:opacity-50 disabled:hover:text-ink-2"
										onclick={dismissEventCreateForm}
									>
										{m.roster_cancel()}
									</button>
								</div>
							</div>
						{/if}
						<!-- #214 — event type filter chips, above the WHOLE agenda (Recent
						     section included). Hidden entirely when the agenda has no
						     events at all (nothing to filter). Native role="group" of
						     native buttons per standing rules 1/2 — no hand-rolled widget. -->
						{#if agendaFilterChips.length > 0}
							<div class="flex flex-wrap items-center justify-between gap-2 pb-3">
								<div
									role="group"
									aria-label={m.agenda_filter_group_label()}
									class="flex flex-wrap gap-2"
								>
									<button
										type="button"
										data-testid="agenda-filter-all"
										aria-pressed={agendaTypeFilter === 'all' ? 'true' : 'false'}
										class="rounded-full border px-2 py-0.5 font-mono text-[9px] tracking-wide uppercase {agendaTypeFilter ===
										'all'
											? 'border-ink bg-ink text-paper'
											: 'border-ink-4 text-ink-2'}"
										onclick={() => selectAgendaTypeFilter('all')}
									>
										{m.agenda_filter_all()}
									</button>
									{#each agendaFilterChips as type (type)}
										<button
											type="button"
											data-testid="agenda-filter-{type}"
											aria-pressed={agendaTypeFilter === type ? 'true' : 'false'}
											class="rounded-full border px-2 py-0.5 font-mono text-[9px] tracking-wide uppercase {agendaTypeChipClass(
												type
											)}"
											onclick={() => selectAgendaTypeFilter(type)}
										>
											{eventTypeLabel(type)}
										</button>
									{/each}
								</div>
								<!-- #247/#312 — the Nimekiri|Kuu view toggle, sitting WITH the
								     chips (Ruled 2026-09-06, item 9): day list is the default, the
								     choice persists per-device via the #207-shaped agendaView
								     preference store. #312 reshapes the two independently-rounded
								     chips into ONE segmented pill: the container carries the
								     border+rounding (the LanguageSelector/RsvpControl/
								     AttendanceSurface flush idiom — inline-flex overflow-hidden
								     rounded-* border, segment border-r last:border-r-0), and the
								     semantics become role="radiogroup"/role="radio"/aria-checked
								     with roving tabindex, same house pattern as roster's
								     roster-view-modes (#156): arrows both MOVE and SELECT via
								     handleAgendaViewKeydown. aria-pressed is GONE — pressed-state on
								     role="radio" is an invalid ARIA mix, the same trap
								     page.sections-a11y.spec.ts caught on role="option". -->
								<div
									data-testid="agenda-view-toggle"
									role="radiogroup"
									tabindex="-1"
									aria-label={m.agenda_view_toggle_label()}
									class="inline-flex overflow-hidden rounded-md border border-ink-4"
									onkeydown={handleAgendaViewKeydown}
								>
									<button
										type="button"
										data-testid="agenda-view-list"
										data-agenda-view="list"
										role="radio"
										aria-checked={$agendaViewStore === 'list' ? 'true' : 'false'}
										tabindex={$agendaViewStore === 'list' ? 0 : -1}
										class="border-r border-ink-4 px-2 py-0.5 font-mono text-[9px] tracking-wide uppercase last:border-r-0 {$agendaViewStore ===
										'list'
											? 'bg-ink text-paper'
											: 'text-ink-2'}"
										onclick={() => setAgendaView('list')}
									>
										{m.agenda_view_list()}
									</button>
									<button
										type="button"
										data-testid="agenda-view-month"
										data-agenda-view="month"
										role="radio"
										aria-checked={$agendaViewStore === 'month' ? 'true' : 'false'}
										tabindex={$agendaViewStore === 'month' ? 0 : -1}
										class="border-r border-ink-4 px-2 py-0.5 font-mono text-[9px] tracking-wide uppercase last:border-r-0 {$agendaViewStore ===
										'month'
											? 'bg-ink text-paper'
											: 'text-ink-2'}"
										onclick={() => setAgendaView('month')}
									>
										{m.agenda_view_month()}
									</button>
								</div>
							</div>
						{/if}
						<!-- #214 — a filter yielding zero upcoming rows is a DIFFERENT truth
						     than "no upcoming events": the collective HAS events, the filter
						     hid them. Declared here (a plain value, not a child of
						     <AgendaList>) so it can be handed to the `emptyState` prop only
						     when a filter is actually active — Svelte only picks up a
						     `{#snippet}` block placed directly inside a component's own tags
						     as that prop; nesting it in an `{#if}` there would silently make
						     it stray "children" content instead of ever reaching the prop. -->
						{#snippet agendaFilterEmptyState()}
							<div data-testid="agenda-filter-empty" class="flex min-h-[30vh] items-center justify-center">
								<p class="font-display text-xl text-ink-2">{m.agenda_filter_empty()}</p>
							</div>
						{/snippet}
						<!-- #214 review F3 — the Recent list's own filtered-empty line. It is
						     handed over ONLY when the collective actually has recent events
						     and the filter hid all of them: without it AgendaList drops the
						     whole Recent section, taking #85's season summary (a whole-season
						     figure, computed from the UNFILTERED recentItems) off screen for
						     any type with no past events yet. With no recent events at all,
						     the prop stays undefined and the section stays absent as before. -->
						{#snippet agendaRecentFilterEmptyState()}
							<p data-testid="agenda-recent-filter-empty" class="py-2 text-sm text-ink-2">
								{m.agenda_filter_recent_empty()}
							</p>
						{/snippet}
						<!-- #247 — the day list stays the untouched default branch; month
						     mode is a wholly separate sibling component consuming
						     `filteredAgendaItems` ONLY (Gama's scope ruling: upcoming
						     only, `recentItems` never reaches month mode). -->
						{#if $agendaViewStore === 'list'}
							<AgendaList
								items={filteredAgendaItems}
								loading={agendaLoading}
								{rsvpByEventId}
								membership={gatedMembership}
								{pendingEventIds}
								{failedEventIds}
								{savedEventIds}
								recentItems={filteredRecentItems}
								{conductorEventIds}
								{myAttendanceByEventId}
								{worksByEventId}
								{worksManage}
								scheduleItemsByEventId={scheduleByEventId}
								{attendancePanel}
								{justCreatedEventId}
								emptyState={agendaTypeFilter !== 'all' ? agendaFilterEmptyState : undefined}
								recentEmptyState={agendaTypeFilter !== 'all' && recentItems.length > 0
									? agendaRecentFilterEmptyState
									: undefined}
								onpdfclick={handlePdfClick}
								onrsvpchange={handleRsvpChange}
								ontakeattendance={openAttendancePanel}
							>
								{#snippet seasonSummary()}
									<SeasonSummary
										myRate={mySeasonRate}
										canExpand={$isConductor === 'conductor'}
										expanded={seasonSummaryExpanded}
										memberRates={seasonMemberRates}
										membersPartial={seasonRatesPartial}
										loading={seasonRatesLoading}
										error={seasonRatesError}
										onexpand={handleExpandSeasonSummary}
									/>
								{/snippet}
							</AgendaList>
						{:else}
							<!-- #214 applies to BOTH views: the same snippet, handed over under
							     the identical `agendaTypeFilter !== 'all'` condition as the day
							     list's. Without it, a chip that empties the upcoming set in
							     month mode showed "no upcoming events" — the wrong-truth
							     conflation #214 exists to prevent. (No recentEmptyState twin:
							     month mode consumes upcoming ONLY, per Gama's #247 scope
							     ruling — there is no Recent section here to keep on screen.) -->
							<AgendaMonthView
								items={filteredAgendaItems}
								loading={agendaLoading}
								{justCreatedEventId}
								emptyState={agendaTypeFilter !== 'all' ? agendaFilterEmptyState : undefined}
							/>
						{/if}
						{#if pdfError}
							<p data-testid="repertoire-pdf-error" class="pt-2 text-xs text-red-700" role="alert">
								{m.repertoire_pdf_error()}
							</p>
						{/if}
						<!-- #91 — a management write that failed. Its optimistic change is
						     already rolled back by the time this renders, so without the
						     message the value would just snap back and read as a bug. -->
						{#if manageError}
							<p data-testid="repertoire-manage-error" class="pt-2 text-xs text-red-700" role="alert">
								{m.repertoire_manage_error()}
							</p>
						{/if}
					{/if}
				</div>
			</div>
		</DeskSurface>
	{:else}
		<main class="flex min-h-screen flex-col items-center justify-center gap-4 bg-paper text-ink">
			<p class="text-sm text-ink" data-testid="auth-status">{m.agenda_signed_in()}</p>
			{#if collectives.status === 'none'}
				<a class="text-sm underline" href="/collectives">{m.agenda_collectives_none()}</a>
			{:else if collectives.status === 'error'}
				<a class="text-sm underline" href="/collectives">{m.agenda_collectives_error_retry()}</a>
			{:else}
				<p class="text-sm text-ink">{m.agenda_collectives_loading()}</p>
			{/if}
		</main>
	{/if}
{/if}
