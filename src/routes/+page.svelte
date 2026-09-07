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
		listAllEditions,
		listAllCopies,
		type Copy,
		type Edition,
		type Work
	} from '$lib/library/libraryData';
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
	import { convertEventToSeries, type ConvertEventToSeriesInput } from '$lib/events/eventConvert';
	import { resolveDatabaseEntityId } from '$lib/collective/databaseEntity';
	import {
		listEventSeriesForSeason,
		listEventsForSeason,
		updateSeasonField,
		addSeasonConductor,
		removeSeasonConductor as apiRemoveSeasonConductor,
		getSeriesDefaults,
		deleteEvent as apiDeleteEvent,
		deleteEventSeries as apiDeleteEventSeries,
		countSeriesOccurrences as apiCountSeriesOccurrences,
		countSeasonScope as apiCountSeasonScope,
		deleteSeason as apiDeleteSeason
	} from '$lib/seasons/seasonManage';
	import type {
		SeasonEditableField,
		SeriesDefaults,
		SeriesListItem,
		StandaloneEvent
	} from '$lib/seasons/seasonManage';
	// #197 review F3/F5 — the delete-refusal discriminators live in their OWN
	// module (see `deleteErrors.ts`'s header): the page's integration specs
	// `vi.mock` `$lib/seasons/seasonManage` wholesale, so importing these from
	// there would hand the page `undefined` under test.
	import {
		isDeleteForbidden,
		isEventCascadePartial,
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

	// #85 TA.4 — my own attendance across every past event, loaded ONCE per
	// member resolution (not per-event) alongside the memberId lookup. Powers
	// both each Recent row's badge (via myAttendanceByEventId below) and my
	// own season line in the SeasonSummary (deriveAttendanceRate).
	let myAttendance = $state<MyAttendance[]>([]);

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
	// current one). Powers ONLY the season-creation "an upcoming season already
	// exists" gate below — no extra fetch.
	let seasons = $state<Season[]>([]);
	// The season's repertoire_items — the exclusion set for the "Add work"
	// picker. Read separately from the agenda rows because a fully programmed
	// agenda produces NO repertoire rows at all, and the picker would then
	// happily offer works that already have a repertoire_item.
	let seasonRepertoire = $state<RepertoireItem[]>([]);
	let libraryWorks = $state<Work[]>([]);
	let libraryEditions = $state<Edition[]>([]);
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
	let rosterCache = $state<{ db: string; roster: RosterRow[]; fetchedAt: number } | null>(null);
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
			return Promise.resolve(rosterCache!.roster);
		}
		rosterReadsInFlight += 1;
		rosterReadFailed = false;
		return loadRoster(cfg)
			.then((roster) => {
				// Keyed by the db the fetch was FOR — a collective switch mid-flight
				// leaves a cache entry the (now different) selected db never matches.
				rosterCache = { db: cfg.db, roster, fetchedAt: Date.now() };
				rosterRows = roster;
				return roster;
			})
			.catch((e: unknown) => {
				// Re-thrown: every caller keeps its own `.catch` (and the panel its
				// `.finally`). The flag exists so the PICKER can say "unavailable"
				// instead of "everyone is already added" (#209 review F1).
				rosterReadFailed = true;
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
		const current = selected;
		if (!current) {
			agendaItems = [];
			agendaLoading = false;
			agendaError = false;
			memberId = null;
			membership = 'loading';
			rsvpByEventId = {};
			failedEventIds = new Set();
			recentItems = [];
			conductorEventIds = new Set();
			// #214 — no collective, no agenda, no filter to be stale.
			agendaTypeFilter = 'all';
			worksByEventId = {};
			scheduleByEventId = {};
			pdfError = false;
			resetManagement();
			resetConductor();
			closeAttendancePanel();
			rosterCache = null;
			rosterRows = [];
			sectionsCache = null;
			rosterSections = [];
			// #209 review F1/F2 — the readiness flags belong to the collective whose
			// roster they describe: a failure in the PREVIOUS one must not caption
			// the next one's picker.
			rosterReadFailed = false;
			sectionsReadFailed = false;
			// #196 review F2 — a genuine collective switch (deselection) DOES drop an
			// unfinished conversion run: its resume record names ids in a db that is no
			// longer selected. `EventConvertResume` documents exactly this.
			resetSeasonManage({ dropConvertRun: true });
			attendanceFailedByEvent = new Map();
			myAttendance = [];
			seasonSummaryExpanded = false;
			seasonMemberRates = [];
			seasonRatesLoaded = false;
			seasonRatesLoading = false;
			seasonRatesError = false;
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
			sectionsCache = null;
			rosterSections = [];
			// #209 review F1/F2 — the readiness flags belong to the collective whose
			// roster they describe: a failure in the PREVIOUS one must not caption
			// the next one's picker.
			rosterReadFailed = false;
			sectionsReadFailed = false;
			// #196 review F2 — see the deselection branch: a switch to a DIFFERENT
			// collective drops the run record with the rest of the panel. Retries of the
			// SAME collective never reach here — `retryAgenda` keeps the panel while a
			// run is unfinished.
			resetSeasonManage({ dropConvertRun: true });
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
		seasonSummaryExpanded = false;
		seasonMemberRates = [];
		seasonRatesLoaded = false;
		seasonRatesLoading = false;
		seasonRatesError = false;
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
					// #132/T2 — the full season list, for the season-creation entry point's
					// "an upcoming season already exists" gate. No extra fetch.
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
					// #167 — the ADMIN's rights, mirroring the derivation above but keyed
					// on the MANAGEABLE season (current-if-running, else the soonest future
					// one) rather than the viewer's current season. This is what lets
					// event/series creation controls survive creating a season that has
					// not started yet.
					manageableSeasonId = mSeasonId;
					manageableSeasonRights =
						mSeasonId === null ? 'not-editor' : manageRightsFrom(mOwners, mEditors, personId);
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
					const manageableRightsInvisible =
						mSeasonId !== null && mOwners.length === 0 && mEditors.length === 0;
					const currentRightsInvisible =
						seasonId !== null && seasonOwners.length === 0 && seasonEditors.length === 0;
					// Step 3 of `deriveSeasonCreateRights`' ladder: no current season
					// AND no season at all to borrow rights from — the brand-new
					// collective, where the FIRST season must be creatable in-app.
					const noSeasonToBorrowFrom = seasonId === null && fullSeasons.length === 0;
					// `currentRightsInvisible` is a trigger in its OWN right (#167 review
					// round 2, F2), not merely a consequence to act on inside the branch.
					// The manageable and the current season are DIFFERENT entities
					// whenever the current one has lapsed (review F1), and they were
					// created at different moments — so the newer one can carry the
					// viewer's `_owner`/`_editor` while the older one carries none. Gating
					// the probe on the manageable season alone then produced exactly the
					// contradiction this block exists to prevent: [+ Event] and the gear
					// rendered against a dead repertoire surface for the current season.
					if (manageableRightsInvisible || currentRightsInvisible || noSeasonToBorrowFrom) {
						loadDatabaseEntityRights(worksCfg, personId).then((state) => {
							if (thisRequest !== requestId) return;
							if (state !== 'editor') return;
							// Rights on the database entity are rights over the whole
							// collective — every gate whose own read came back blank.
							if (manageableRightsInvisible) manageableSeasonRights = 'editor';
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
				resetConductor();
				// #196 review F2 — NO `dropConvertRun`: this is the SAME collective and
				// a transient read failure, often the very flakiness that stopped an
				// occurrence run. `resetSeasonManage` no-ops while that run is
				// unfinished, so the resume record, the notice and the form survive.
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
						.then((records) => {
							if (thisRequest !== requestId) return;
							myAttendance = records;
						})
						.catch(() => {
							if (thisRequest !== requestId) return;
							myAttendance = [];
						});
				} else {
					myAttendance = [];
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
			.then((rsvps) => {
				if (thisRequest !== requestId) return;
				rsvpByEventId = rsvpsByEventId(rsvps);
			})
			.catch(() => {
				if (thisRequest !== requestId) return;
				rsvpByEventId = {};
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
		},
		reconcile(eventId, entry) {
			const next = { ...rsvpByEventId };
			if (entry) next[eventId] = entry;
			else delete next[eventId];
			rsvpByEventId = next;
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
		seasonCreateRights = 'not-editor';
		eventManageRights = {};
		seasonRepertoire = [];
		libraryWorks = [];
		libraryEditions = [];
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
		loadWorksByEventId(cfg, eventIds, seasonId, fetch, { includeInactive: true })
			.then((byEvent) => {
				if (thisRequest !== requestId || thisWorksLoad !== worksLoadId) return;
				worksByEventId = mergePendingRows(byEvent);
			})
			.catch(() => {
				/* keep the filtered rows the first load produced */
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
		if (canManage) loadManagePickers(cfg, seasonId, thisRequest);

		const thisWorksLoad = ++worksLoadId;
		loadWorksByEventId(cfg, eventIds, seasonId, fetch, {
			includeInactive: seasonManageRights === 'editor'
		})
			.then((byEvent) => {
				if (thisRequest !== requestId || thisWorksLoad !== worksLoadId) return;
				worksByEventId = byEvent;
			})
			.catch(() => {
				if (thisRequest !== requestId || thisWorksLoad !== worksLoadId) return;
				worksByEventId = {};
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
		Promise.all([
			listWorks(cfg),
			listAllEditions(cfg),
			seasonId === null ? Promise.resolve<RepertoireItem[]>([]) : listRepertoireItems(cfg, seasonId)
		])
			.then(([works, editions, repertoire]) => {
				if (thisRequest !== requestId) return;
				libraryWorks = works;
				libraryEditions = editions;
				seasonRepertoire = repertoire;
			})
			.catch(() => {
				if (thisRequest !== requestId) return;
				// Empty pickers, not a broken page: the row controls still work.
				libraryWorks = [];
				libraryEditions = [];
				seasonRepertoire = [];
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
			})
			.catch(() => {
				/* keep the optimistic rows; the next load reconciles */
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
		if (!cfg || manageableSeasonId === null) return;
		const seasonId = manageableSeasonId;
		const thisRequest = requestId;
		listRepertoireItems(cfg, seasonId)
			.then((items) => {
				if (thisRequest !== requestId || manageableSeasonId !== seasonId) return;
				panelRepertoire = items;
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
		},
		// #234 SYNC — a repertoire_item is a child of the SEASON, so the same row
		// can be showing on an unprogrammed event's fallback works line too.
		// `refreshWorksAfterWrite` (unchanged, existing) re-reads that surface;
		// calling it here is the sync hook, not a change to the per-event
		// handlers themselves.
		reconcile() {
			refreshPanelRepertoire();
			refreshWorksAfterWrite();
		},
		revert() {
			refreshPanelRepertoire();
			refreshWorksAfterWrite();
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

	function handlePanelStatusChange(itemId: string, status: RepertoireStatus) {
		const cfg = manageCfg();
		if (!cfg) return;
		const before = panelRepertoire.find((item) => item.id === itemId)?.status;
		if (before === undefined) return;
		panelQueue.request(itemId, () => updateRepertoireStatus(cfg, itemId, status), {
			apply: () => {
				panelRepertoire = panelRepertoire.map((item) =>
					item.id === itemId ? { ...item, status } : item
				);
			},
			rollback: () => {
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
		panelQueue.request(itemId, () => deleteRepertoireItem(cfg, itemId), {
			apply: () => {
				panelRepertoire = panelRepertoire.filter((item) => item.id !== itemId);
			},
			rollback: () => {
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
	 *  whose work has no editions gets no entry, which hides the control. */
	const editionOptionsByRowId = $derived.by(() => {
		const out: Record<string, PickerOption[]> = {};
		for (const rows of Object.values(worksByEventId)) {
			for (const row of rows) {
				if (row.kind !== 'repertoire' || row.workId === '' || out[row.id]) continue;
				const options = (editionsByWorkId.get(row.workId) ?? []).map((edition) => ({
					id: edition.id,
					label: editionLabel(edition)
				}));
				if (options.length > 0) out[row.id] = options;
			}
		}
		return out;
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

	const pickableWorksList = $derived(pickableWorks(libraryWorks, seasonRepertoire));

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

	/** Absent entirely for a reader with no rights anywhere — AgendaList then
	 *  renders exactly the read-only agenda it rendered before TR.3. */
	const worksManage = $derived.by<WorksManage | undefined>(() => {
		const anyEventRight = Object.values(eventManageRights).some((right) => right === 'editor');
		if (seasonManageRights !== 'editor' && !anyEventRight) return undefined;
		return {
			seasonRights: seasonManageRights,
			eventRightsByEventId: eventManageRights,
			pickableWorksList,
			pickableEditionsByEventId,
			editionOptionsByRowId,
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
			.then(([roster, inactiveRoster, perEventRecords]) => {
				if (thisRequestSnapshot !== requestId) return;
				seasonMemberRates = deriveAllMemberRates(
					perEventRecords.flat(),
					roster,
					events.length,
					inactiveRoster
				);
				seasonRatesLoaded = true;
				seasonRatesLoading = false;
			})
			.catch(() => {
				if (thisRequestSnapshot !== requestId) return;
				seasonRatesLoading = false;
				seasonRatesError = true;
				seasonMemberRates = [];
			});
	}

	// #132/T2 — page-level "+ Season" entry point + inline creation form. The
	// collective admin needs an in-app way to open the NEXT season before the
	// current one runs out; today that's only possible in Entu's admin UI.
	//
	// Rights gate: `seasonManageRights` (already derived above from the CURRENT
	// season's `_owner`/`_editor`, fail-closed — see #91). Existence gate: no
	// UPCOMING season already exists — `seasons` (loaded alongside the agenda,
	// no extra fetch) has none whose `startDate` is strictly after today (the
	// CURRENT/running season never counts as upcoming).
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

	const hasUpcomingSeason = $derived.by(() => {
		const todayIso = new Date().toISOString().slice(0, 10);
		return seasons.some((s) => s.startDate > todayIso);
	});
	const showSeasonCreate = $derived(seasonCreateRights === 'editor' && !hasUpcomingSeason);

	function openSeasonCreateForm(): void {
		// #132/T6 review F1 — a form with a write on the wire, or a series run that
		// stopped partway and still owes occurrences, is never torn down from
		// underneath it (see `createEntryPointsBlocked`). The entry points are
		// `disabled` on the same flag, so this is the belt under that brace.
		if (createEntryPointsBlocked) return;
		// #132/T6 — mutual exclusion: only one creation form is ever open at a
		// time. The season-MANAGE panel is not a creation form (it coexists —
		// see `closeSeasonManagePanel` is deliberately NOT called here), but the
		// other two creation surfaces must yield. #196 review F4 — so must the
		// panel's conversion form, the fourth one (it can only be open with no run
		// outstanding: `createEntryPointsBlocked` above covers that case).
		closeEventCreateForm();
		closeSeriesCreateForm();
		closeEventConvertForm();
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
	// whole season CARD (collapsed expand button + opened title row). Unchanged
	// shape, new name for what it gates.
	const showSeasonCard = $derived(
		manageableSeasonId !== null && manageableSeasonRights === 'editor'
	);

	let seasonManageOpen = $state(false);
	let seasonManageName = $state('');
	let seasonManageStartDate = $state('');
	let seasonManageEndDate = $state('');
	let seasonManageConductorIds = $state<string[]>([]);
	let seasonManageFieldsLoaded = $state(false);
	let seasonManageSeries = $state<SeriesListItem[]>([]);
	let seasonManageEvents = $state<StandaloneEvent[]>([]);
	/** A FAILED series / standalone-event read is a state of its own, never an
	 *  empty list (#132/T3 review F2). `seasonManageSeries = []` in a catch is
	 *  indistinguishable from "this season genuinely has no series" — and the
	 *  [+ Series] / [+ Event] buttons sit directly under those lists, so the
	 *  silent-empty shape invites the editor to re-create series that already
	 *  exist but failed to load. Fail loudly (house rule). */
	let seasonManageSeriesError = $state(false);
	let seasonManageEventsError = $state(false);
	/** #197 — a failed series/event DELETE surfaces an inline slot (per-attempt,
	 *  not sticky: cleared at the START of every delete tap, not just on
	 *  success, so a second try — success or failure — always reflects the
	 *  latest attempt). The row that failed to delete STAYS in its list; this
	 *  state only controls the error slot.
	 *
	 *  #197 review F5 — `list` says WHICH sub-panel renders the message. One
	 *  shared slot lived under the standalone-EVENTS list, so a failed SERIES
	 *  delete printed "Couldn't delete" below a list that had nothing to do with
	 *  it (role="alert" still announced it, so the damage was visual, not
	 *  SR-blocking).
	 *
	 *  #197 review F3 — `reason` distinguishes the ONE refusal the panel's own
	 *  rights gate cannot predict. The gate is `_owner` OR `_editor` on the
	 *  SEASON (`manageRightsFrom`), which every POST on this panel satisfies;
	 *  Entu's DELETE additionally requires `_owner` on the TARGET entity, so a
	 *  season editor who did not create the series gets a 403 forever and must
	 *  not be told to "try again". `partial` is the series cascade that stopped
	 *  part-way (see `deleteEventSeries`' contract). */
	let seasonManageDeleteError = $state<{
		list: 'series' | 'events' | 'season';
		reason: 'write' | 'forbidden' | 'partial' | 'partial-event' | 'partial-season';
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
	// #196 — the standalone-event → series conversion form, inline under the
	// panel's own event row (`season-manage-event-convert-<id>` opens it). One
	// slot for the whole panel — only one row's form is ever open, the same
	// posture `seasonManageDeleteArmed` takes for the delete confirm.
	let eventConvertOpenId = $state<string | null>(null);
	let eventConvertIntervalDays = $state('7');
	let eventConvertDuration = $state('');
	let eventConvertEndDate = $state('');
	let eventConvertSubmitting = $state(false);
	/** Already the localized message (a failure's `{step}` / a count already
	 *  filled in) — not a raw error, so the render side stays a plain string
	 *  print. */
	let eventConvertError = $state<string | null>(null);
	/** Which box a refusal belongs to — the series form's `SeriesCreateErrorField`
	 *  shape (#196 review F2). `null` = form-wide (a failed write, an event with
	 *  no start) and names no box. */
	type EventConvertErrorField = 'interval' | 'duration' | 'end' | null;
	let eventConvertErrorField = $state<EventConvertErrorField>(null);
	/** Non-null while the occurrence loop runs — `current` is the occurrence IN
	 *  FLIGHT (1-based), the series form's own convention. */
	let eventConvertProgress = $state<{ current: number; total: number } | null>(null);
	/**
	 * #196 review F1 — what a STOPPED occurrence run still owes. The conversion
	 * itself already landed (the series exists and the event is linked to it), so
	 * a re-submit must never re-convert: it picks up at the occurrence that
	 * failed. Everything the resumed loop needs travels in here, because the
	 * conversion that produced it does not run again.
	 *
	 * Single-slot, NOT keyed by db the way `seriesCreateResumeByDb` is (#138): a
	 * collective switch stops the loop (`dbChanged()`) and `resetSeasonManage`
	 * drops the record with the rest of the panel's state — but ONLY on a switch,
	 * `dropConvertRun` in hand (#196 review F2). A run interrupted that way leaves
	 * a series with fewer occurrences than asked for — visible on the agenda, and
	 * re-addable once a series can be extended — never a duplicate series.
	 * Carrying it across collectives is #138's whole machinery and is deliberately
	 * not rebuilt here. Every OTHER caller of `resetSeasonManage` (the agenda
	 * load's failure path) leaves this record, the form and the notice alone: they
	 * are the only way an unfinished run can still be finished.
	 */
	type EventConvertResume = {
		/** The row the form belongs to — a resume is only ever offered for it. */
		eventId: string;
		seriesId: string;
		dbEntityId: string;
		/** The converted event's own type, which every occurrence must carry. */
		eventType: string;
		/** 'YYYY-MM-DDTHH:MM' Tallinn wall-clock occurrences not yet written. */
		remaining: string[];
		/** The ORIGINAL occurrence count, so every count keeps describing the run. */
		total: number;
	};
	let eventConvertResume = $state<EventConvertResume | null>(null);
	/** The conversion form's own dialog element — focus moves into it on open and
	 *  its Escape handler is what keeps the panel's own from firing (#196 review
	 *  F3), the `series-create-form` contract verbatim. */
	let eventConvertFormEl = $state<HTMLDivElement | null>(null);
	/** A failed conductor add/remove reverts the optimistic chip — and, without
	 *  this, said nothing (#132/T3 review F1). Same contract the three text/date
	 *  fields already keep: a silently snapped-back value reads as a bug. */
	let seasonManageConductorError = $state(false);
	/** True while the panel's roster read is in flight — the conductor chips
	 *  need it to tell "name not here YET" from "name will NEVER arrive"
	 *  (#132/T3 review F4). */
	let seasonManageRosterLoading = $state(false);
	/** The dialog itself, and the collapsed card's own expand control — focus
	 *  moves INTO the panel on open (#132/T3 review F1) and back to the
	 *  expand button on close (#261 — the gear was the old anchor; the
	 *  expand button UNMOUNTS while the panel is open and REMOUNTS the moment
	 *  it closes, so `closeSeasonManagePanel` waits a `tick()` before reading
	 *  this binding). */
	let seasonManagePanelEl = $state<HTMLDivElement | null>(null);
	let seasonManageExpandEl = $state<HTMLButtonElement | null>(null);

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
	 * #196 review F2 — REFUSED while a conversion run is unfinished, unless the
	 * caller says the run itself is being dropped. `eventConvertResume` is the
	 * ONLY record of what a stopped occurrence run still owes, and the converted
	 * event has already left the standalone list, so losing it leaves a series
	 * short of occurrences with no in-app way to finish it — the exact teardown
	 * `closeSeasonManagePanel` already refuses for the same reason. This function
	 * is not called only on a deliberate exit: the agenda load's `.catch` calls it
	 * too, so a flaky read (the very flakiness that stopped the run) silently ate
	 * the record. `dropConvertRun` is passed by the genuine collective-SWITCH
	 * paths, where the record belongs to a db that is no longer selected and
	 * `EventConvertResume`'s doc comment says it goes.
	 *
	 * `eventConvertSubmitting` is deliberately NOT reset here on any path — only
	 * `submitEventConvert`'s own `finally` releases it. Clearing it from outside
	 * unblocked `createEntryPointsBlocked` under a live loop, letting another
	 * creation form open over POSTs still on the wire.
	 */
	function resetSeasonManage(opts: { dropConvertRun?: boolean } = {}): void {
		if (eventConvertRunUnfinished && opts.dropConvertRun !== true) return;
		seasonManageOpen = false;
		seasonManageFieldsLoaded = false;
		seasonManageName = '';
		seasonManageStartDate = '';
		seasonManageEndDate = '';
		seasonManageConductorIds = [];
		seasonManageSeries = [];
		seasonManageEvents = [];
		seasonManageSeriesError = false;
		seasonManageEventsError = false;
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
		eventConvertOpenId = null;
		eventConvertIntervalDays = '7';
		eventConvertDuration = '';
		eventConvertEndDate = '';
		eventConvertError = null;
		eventConvertErrorField = null;
		eventConvertProgress = null;
		eventConvertResume = null;
		seasonManageConductorError = false;
		seasonManageRosterLoading = false;
		seasonEditingField = null;
		seasonEditDraft = '';
		seasonEditErrors = {};
		seasonEditPending = {};
		// #234 review 2 F1 — the panel's repertoire section belongs to the PANEL's
		// lifetime, exactly like the series/events lists three lines up, so it is
		// cleared where they are. Reached only on a genuine collective switch (both
		// `loadForSelected` teardowns, with `dropConvertRun: true`) and on the
		// agenda-failure path — never on a `{ keepSeasonManage: true }` reload, which
		// deliberately keeps the panel and everything it is showing.
		panelRepertoire = [];
		panelWorks = [];
		panelEditions = [];
		panelCopies = [];
		panelPendingKeys = new Set();
		panelRepertoireError = false;
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
		panelRepertoireError = false;
		listRepertoireItems(cfg, seasonId)
			.then((items) => {
				if (thisRequest !== requestId) return;
				panelRepertoire = items;
			})
			.catch((e) => {
				if (thisRequest !== requestId) return;
				console.error('agenda: loading the season-manage repertoire failed', e);
				panelRepertoire = [];
				panelRepertoireError = true;
			});
		// One settle for the three join sources: any of them missing degrades the
		// SAME section the same way (unlabelled rows and/or an add-work select
		// with nothing in it), so they share one error surface rather than
		// half-rendering.
		Promise.all([listWorks(cfg), listAllEditions(cfg), listAllCopies(cfg)])
			.then(([works, editions, copies]) => {
				if (thisRequest !== requestId) return;
				panelWorks = works;
				panelEditions = editions;
				panelCopies = copies;
			})
			.catch((e) => {
				if (thisRequest !== requestId) return;
				console.error('agenda: loading the season-manage repertoire sources failed', e);
				panelWorks = [];
				panelEditions = [];
				panelCopies = [];
				panelRepertoireError = true;
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
		seasonManageSeriesError = false;
		seasonManageEventsError = false;
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
		listEventSeriesForSeason(cfg, seasonId)
			.then((list) => {
				if (thisRequest !== requestId) return;
				seasonManageSeries = list;
			})
			.catch((e) => {
				if (thisRequest !== requestId) return;
				console.error('agenda: loading the season\'s event series failed', e);
				seasonManageSeries = [];
				seasonManageSeriesError = true;
			});
		listEventsForSeason(cfg, seasonId)
			.then((list) => {
				if (thisRequest !== requestId) return;
				seasonManageEvents = list;
			})
			.catch((e) => {
				if (thisRequest !== requestId) return;
				console.error('agenda: loading the season\'s standalone events failed', e);
				seasonManageEvents = [];
				seasonManageEventsError = true;
			});
		loadPanelRepertoire(cfg, seasonId);
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
		// #196 review F1/F3 — the CONVERSION form lives inside this panel too, and
		// its occurrence loop is the same many-serial-POSTs shape. Tearing the panel
		// down around a run in flight (or around a stopped one whose "N of M" notice
		// and Submit/Cancel are the only way to finish or abandon it) is the same
		// bug, so it is refused the same way. Cancel inside the form is the exit.
		if (seriesRunUnfinished || eventConvertRunUnfinished) return;
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
		tick().then(() => seasonManageExpandEl?.focus());
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
		clearSeasonFieldError(field);
		seasonEditPending = { ...seasonEditPending, [field]: true };
		applySeasonFieldLocally(field, value); // optimistic — the panel is the truth it renders
		updateSeasonField(cfg, seasonId, field, value)
			.then(() => {
				seasonEditPending = { ...seasonEditPending, [field]: false };
			})
			.catch((e) => {
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
		if (!selection.id || !selected || manageableSeasonId === null) return;
		const personId = selection.id;
		if (seasonManageConductorIds.includes(personId)) return; // no duplicate chips
		const cfg = { db: selected.db, token: getToken() ?? '' };
		const seasonId = manageableSeasonId;
		seasonManageConductorError = false; // this attempt starts clean
		seasonManageConductorIds = [...seasonManageConductorIds, personId]; // optimistic
		addSeasonConductor(cfg, seasonId, personId).catch((e) => {
			console.error('agenda: add season conductor failed', personId, e);
			seasonManageConductorIds = seasonManageConductorIds.filter((id) => id !== personId);
			// …and SAY so: the revert alone is a chip that appears and vanishes
			// (#132/T3 review F1).
			seasonManageConductorError = true;
		});
	}

	function onSeasonManageConductorRemove(personId: string): void {
		if (!selected || manageableSeasonId === null) return;
		const cfg = { db: selected.db, token: getToken() ?? '' };
		const seasonId = manageableSeasonId;
		const before = seasonManageConductorIds;
		seasonManageConductorError = false;
		seasonManageConductorIds = seasonManageConductorIds.filter((id) => id !== personId); // optimistic
		apiRemoveSeasonConductor(cfg, seasonId, personId).catch((e) => {
			console.error('agenda: remove season conductor failed', personId, e);
			seasonManageConductorIds = before;
			seasonManageConductorError = true;
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
			.then((list) => {
				if (stale()) return;
				eventCreateSeriesOptions = list;
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
		// #196 review F4 — the panel's conversion form is a creation surface too.
		closeEventConvertForm();
		eventCreateLoadId += 1; // review F3 — a new form; nothing the last one asked for belongs here
		eventCreateOrigin = origin;
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

	/** Re-reads the panel's lists after a PANEL-born create — the new
	 *  occurrence must land in the counts the panel already shows. Mirrors
	 *  `openSeasonManagePanel`'s reads, minus the roster/open-state
	 *  parts (this is a refresh, not a (re)open).
	 *
	 *  #234 review 2 F1 — the repertoire section rides along. Its state used to be
	 *  wiped by `resetManagement` on every reload and rebuilt only by the next
	 *  panel OPEN; now that it survives a `{ keepSeasonManage: true }` reload it
	 *  needs the same re-read the two lists get, so the whole panel reconciles at
	 *  one seam instead of one section quietly showing pre-write truth. Every
	 *  caller passes the PANEL's own season (each one guards that), so this is
	 *  always the section's own season. */
	function refreshSeasonManageLists(cfg: ManageCfg, seasonId: string): void {
		const thisRequest = requestId;
		loadPanelRepertoire(cfg, seasonId);
		listEventSeriesForSeason(cfg, seasonId)
			.then((list) => {
				if (thisRequest !== requestId) return;
				seasonManageSeries = list;
				seasonManageSeriesError = false;
			})
			.catch((e) => {
				if (thisRequest !== requestId) return;
				console.error('agenda: refreshing the season\'s event series after an event create failed', e);
				seasonManageSeriesError = true;
			});
		listEventsForSeason(cfg, seasonId)
			.then((list) => {
				if (thisRequest !== requestId) return;
				seasonManageEvents = list;
				seasonManageEventsError = false;
			})
			.catch((e) => {
				if (thisRequest !== requestId) return;
				console.error(
					"agenda: refreshing the season's standalone events after an event create failed",
					e
				);
				seasonManageEventsError = true;
			});
	}

	// #197 — per-row DELETE for the season-manage panel's series/standalone-event
	// lists. The `seasonManageDeleteError` slot is reset at the START of every
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
		list: 'series' | 'events' | 'season',
		reason: unknown
	): NonNullable<typeof seasonManageDeleteError> {
		if (isDeleteForbidden(reason)) return { list, reason: 'forbidden' };
		// #217 — the season cascade's OWN partial shape, told apart from its
		// series/event children's (a season failure can wrap either of those in
		// its own `failure` chain, but `isDeleteForbidden`/the checks above
		// already unwrapped a 403; anything else that reaches here for a season
		// list is the season's own story, never a child's).
		if (list === 'season' && isSeasonCascadePartial(reason)) {
			const partial = reason as { deletedCount?: number; totalCount?: number };
			return {
				list,
				reason: 'partial-season',
				deleted: partial.deletedCount ?? 0,
				total: partial.totalCount ?? 0
			};
		}
		// Both cascades report how far they got; only the NOUN differs — the
		// series one counts occurrence events, the event one counts the event's
		// own attendance/programme rows (#197 review 2nd pass F1).
		if (isSeriesCascadePartial(reason) || isEventCascadePartial(reason)) {
			const partial = reason as { deletedCount?: number; totalCount?: number };
			return {
				list,
				reason: isSeriesCascadePartial(reason) ? 'partial' : 'partial-event',
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
			case 'partial-event':
				return m.season_manage_event_delete_partial({
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

	function onSeasonManageEventDelete(event: StandaloneEvent): void {
		if (!selected) return;
		if (seasonManageDeletePendingId !== null) return;
		const cfg = { db: selected.db, token: getToken() ?? '' };
		seasonManageDeleteError = null;
		seasonManageDeletePendingId = event.id;
		apiDeleteEvent(cfg, event.id)
			.then(() => {
				seasonManageDeleteArmed = null;
				seasonManageArmedSeriesCount = null;
				seasonManageEvents = seasonManageEvents.filter((row) => row.id !== event.id);
				seasonManageDeleteStatus = m.season_manage_deleted({ name: event.name });
				refreshAfterSeasonManageDelete(cfg);
			})
			.catch((e) => {
				console.error('agenda: deleting standalone event failed', event.id, e);
				seasonManageDeleteError = seasonManageDeleteFailure('events', e);
			})
			.finally(() => {
				seasonManageDeletePendingId = null;
			});
	}

	// #196 — standalone event → series conversion, panel-side wiring around the
	// data layer in `$lib/events/eventConvert`.

	/** The Tallinn wall-clock date + time a UTC instant reads as (the INVERSE of
	 *  `tallinnLocalToUtcIso` above) — the series' `startTime`/`startDate` are
	 *  derived from the EVENT's own `startDatetime`, not re-typed by the
	 *  operator: TE.4's convention applied the other direction. A single
	 *  `Intl.DateTimeFormat` pass suffices here (unlike the local→UTC direction,
	 *  there is no ambiguity to resolve with a second pass). '' / '' on an
	 *  unparseable instant. */
	function tallinnWallClockParts(isoUtc: string): { date: string; time: string } {
		const instant = new Date(isoUtc);
		if (Number.isNaN(instant.getTime())) return { date: '', time: '' };
		const parts = new Intl.DateTimeFormat('en-US', {
			timeZone: EVENT_CREATE_TZ,
			hourCycle: 'h23',
			year: 'numeric',
			month: '2-digit',
			day: '2-digit',
			hour: '2-digit',
			minute: '2-digit'
		}).formatToParts(instant);
		const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
		return { date: `${get('year')}-${get('month')}-${get('day')}`, time: `${get('hour')}:${get('minute')}` };
	}

	/** Opens the inline conversion form under the given standalone event's row —
	 *  one slot for the whole panel, so opening a new one silently replaces
	 *  whichever other row's form was open (there is only ever one at a time in
	 *  the UI, nothing to lose). Interval defaults to 7 (weekly, the common
	 *  case); duration/end-date start blank — the operator supplies those, the
	 *  start itself comes from the event.
	 *
	 *  #196 review F4 — this is a CREATION entry point like the other three and
	 *  keeps their two disciplines: it refuses while `createEntryPointsBlocked`
	 *  (any create on the wire, or a stopped run that still owes occurrences —
	 *  including this form's own), and it closes the other creation forms so only
	 *  one is ever open at a time. Without the first, a conversion could start
	 *  mid-bulk-run; without the second, two creation forms sat open together. */
	function openEventConvertForm(event: StandaloneEvent): void {
		if (createEntryPointsBlocked) return;
		closeSeasonCreateForm();
		closeEventCreateForm();
		closeSeriesCreateForm();
		// #212 — one action context at a time: an armed delete (event row OR
		// series row — the two share this one flag) dies with every other row's
		// buttons the moment the form opens. A direct reset, not
		// `disarmSeasonManageDelete`: that helper also hands focus back to the
		// `×` it restores, which is wrong here — focus is about to move INTO
		// the conversion dialog (the `$effect` below), never back to a control
		// this open is about to unmount.
		seasonManageDeleteArmed = null;
		seasonManageArmedSeriesCount = null;
		eventConvertOpenId = event.id;
		eventConvertIntervalDays = '7';
		eventConvertDuration = '';
		eventConvertEndDate = '';
		eventConvertProgress = null;
		clearEventConvertError();
	}

	/**
	 * Unmounts the form AND forgets whatever a stopped run still owed.
	 *
	 * Unlike `closeSeriesCreateForm` (which had to split those two acts for
	 * #138's cross-collective resume), the two are safe to keep together here
	 * because a live `eventConvertResume` blocks every other entry point AND the
	 * panel's own close: the only callers that can reach this with a record
	 * outstanding are the operator's own exits (Cancel/Escape) and the clean
	 * finish. That is also why there is no `restoreEventConvertRun` twin — a
	 * record can never outlive the form that renders it.
	 */
	function closeEventConvertForm(): void {
		eventConvertOpenId = null;
		eventConvertProgress = null;
		eventConvertResume = null;
		clearEventConvertError();
	}

	function setEventConvertError(message: string, field: EventConvertErrorField): void {
		eventConvertError = message;
		eventConvertErrorField = field;
	}

	function clearEventConvertError(): void {
		eventConvertError = null;
		eventConvertErrorField = null;
	}

	/** `aria-describedby` for the field that currently owns the message. */
	function eventConvertDescribedBy(field: EventConvertErrorField): string | undefined {
		return eventConvertErrorField === field ? 'event-convert-error' : undefined;
	}

	function eventConvertInvalid(field: EventConvertErrorField): true | undefined {
		return eventConvertErrorField === field ? true : undefined;
	}

	/** While a stopped run is resumable the recurrence boxes are INERT: submit
	 *  finishes THAT run (the series is already on the wire, its `interval_days` /
	 *  `end_date` already written), so an edit here would be silently discarded —
	 *  `seriesCreateLocked`'s reasoning, verbatim. */
	const eventConvertLocked = $derived(eventConvertResume !== null);

	/** Hands focus back to the ⟳ that opened the form — it is still on screen
	 *  whenever the form is dismissed rather than finished (a finished conversion
	 *  takes the whole row away, and lands focus on the panel instead). */
	function restoreEventConvertFocus(eventId: string): void {
		tick().then(() =>
			document
				.querySelector<HTMLElement>(`[data-testid="season-manage-event-convert-${eventId}"]`)
				?.focus()
		);
	}

	/** Cancel/Escape — the operator's explicit exit, and the one place a stopped
	 *  run may be ABANDONED (which frees every other entry point again). Refused
	 *  while a write is on the wire, exactly as `dismissSeriesCreateForm` is. */
	function dismissEventConvertForm(): void {
		if (eventConvertSubmitting) return;
		const openId = eventConvertOpenId;
		closeEventConvertForm();
		if (openId) restoreEventConvertFocus(openId);
	}

	/**
	 * #196 review F3 — the form is a `role="dialog"` INSIDE the season-manage
	 * panel, whose own Escape closes the panel. Without stopping propagation one
	 * Escape dismissed BOTH — and `closeSeasonManagePanel` resets the conversion
	 * state, so it could fire with a conversion still on the wire. The next
	 * Escape reaches the panel because focus goes back to the ⟳ inside it: the
	 * WAI-APG two-Escapes layering `onSeriesCreateFormKeydown` documents.
	 */
	function onEventConvertFormKeydown(event: KeyboardEvent): void {
		if (event.key !== 'Escape') return;
		event.preventDefault();
		event.stopPropagation();
		dismissEventConvertForm();
	}

	/** Focus moves INTO the dialog the moment it opens — what `role="dialog"`
	 *  promises a screen-reader user, and what makes the Escape handler above
	 *  reachable at all (the ⟳ that opened it is a SIBLING of the form, so a
	 *  keypress there never enters the form's subtree). The panel's own focus
	 *  effect, one level down. */
	$effect(() => {
		if (eventConvertOpenId && eventConvertFormEl) eventConvertFormEl.focus();
	});

	/** The failed step, duck-typed off whatever `convertEventToSeries` rejected
	 *  with (`EventConvertError#step`) — never `instanceof`, the same posture
	 *  `seasonManageDeleteFailure` takes, and required here too: the page specs
	 *  mock `$lib/events/eventConvert` at the module boundary, so a rejection
	 *  built by hand in a test (`Object.assign(new Error(...), { step })`) must
	 *  be recognised exactly like the real class.
	 *
	 *  #196 review F3 — the fallback is 'unknown', NOT 'read-event'. Naming the
	 *  choreography's first step for a rejection that carries no step told the
	 *  operator a step had failed that never ran (the same defect review F2 fixed
	 *  at the data layer, re-introduced by the caller's own default). The
	 *  pre-conversion failures that used to land here now name their own stage —
	 *  see `EVENT_CONVERT_RESOLVE_STEP`. */
	function eventConvertStepOf(e: unknown): string {
		if (e && typeof e === 'object' && 'step' in e) {
			const step = (e as { step?: unknown }).step;
			if (typeof step === 'string' && step) return step;
		}
		return 'unknown';
	}

	/** #196 review F3 — the collective lookup runs BEFORE `convertEventToSeries`,
	 *  so its failures belong to no conversion step. They get their own label
	 *  rather than borrowing one; a reader following the message lands on the org
	 *  lookup, which is where the failure actually is. */
	const EVENT_CONVERT_RESOLVE_STEP = 'resolve-collective';

	/** #196 review F1 — WHY a pre-write refusal happened, when the step alone
	 *  cannot say it. `convertEventToSeries` refuses an event with no name and an
	 *  event with no event_type in the same 'read-event' step, and both are
	 *  permanent properties of the data — a retry never fixes either, so the
	 *  retryable "Couldn't convert the event (read-event). Try again." is the
	 *  wrong thing to say. Duck-typed for the same reason `eventConvertStepOf`
	 *  is: the page specs mock the module at its boundary. */
	function eventConvertRefusalMessage(e: unknown): string | null {
		if (!e || typeof e !== 'object' || !('reason' in e)) return null;
		const reason = (e as { reason?: unknown }).reason;
		if (reason === 'missing-name') return m.event_convert_missing_name();
		if (reason === 'missing-event-type') return m.event_convert_missing_type();
		return null;
	}

	/**
	 * Submit — the WHOLE conversion, which is two acts, not one (#196 review F1).
	 *
	 *   1. `convertEventToSeries` makes the event the first occurrence of a new
	 *      series carrying the typed cadence: the event/season ids the panel
	 *      already holds, the collective's database entity id
	 *      (`resolveDatabaseEntityId`, never guessed), and the event's OWN start
	 *      as a Tallinn wall clock (`tallinnWallClockParts`).
	 *   2. the FURTHER occurrences are written — one serial `createEvent` per
	 *      `generateIntervalDates` date after the event's own, the series-create
	 *      bulk loop's contract verbatim (strictly serial, ascending, no
	 *      rollback). Occurrences in this app are materialized `event` entities,
	 *      not read-time-generated: without this loop the operator fills in
	 *      "Repeat every (days)" and "Series ends", converts, and the agenda
	 *      still shows exactly one event — the dead end #196 was filed about.
	 *
	 * Refusals come BEFORE any fetch, each naming its own box (the discipline
	 * every sibling form on this page keeps) — so a blank field can no longer
	 * reach the data layer and come back naming a step that never ran.
	 *
	 * A clean finish closes the form and refreshes the world (`loadForSelected` +
	 * the panel's own list re-read) — the event moves from the standalone list
	 * into the series' count. A conversion failure surfaces inline, loud, naming
	 * the failed step, and refreshes NOTHING. An occurrence failure records what
	 * the run still owes (`eventConvertResume`, so a re-submit finishes rather
	 * than converting a second time) and deliberately refreshes only the AGENDA:
	 * re-reading the panel's standalone list would drop the converted event's row
	 * and unmount the very form showing the "N of M" notice.
	 */
	async function submitEventConvert(event: StandaloneEvent): Promise<void> {
		if (eventConvertSubmitting) return; // no duplicate runs on the wire
		if (!selected || manageableSeasonId === null) return;
		clearEventConvertError();

		// A resume belongs to ONE row; anything else is a fresh conversion.
		const resume = eventConvertResume?.eventId === event.id ? eventConvertResume : null;

		// The series' start is the EVENT's own — never re-typed, so it is validated
		// here rather than refused by the data layer under a step name.
		const { date: startDate, time: startTime } = tallinnWallClockParts(event.startDatetime);
		if (!startDate || !startTime) {
			console.error('agenda: converting an event with no readable start', event.id, event.startDatetime);
			setEventConvertError(m.event_convert_start_missing(), null);
			return;
		}
		const intervalDays = Number(eventConvertIntervalDays);
		if (
			!eventConvertIntervalDays.trim() ||
			!Number.isFinite(intervalDays) ||
			intervalDays < 1
		) {
			setEventConvertError(m.event_convert_interval_required(), 'interval');
			return;
		}
		const durationMinutes = Number(eventConvertDuration);
		if (!eventConvertDuration.trim() || !Number.isFinite(durationMinutes) || durationMinutes < 1) {
			setEventConvertError(m.event_convert_duration_required(), 'duration');
			return;
		}
		if (!eventConvertEndDate) {
			setEventConvertError(m.event_convert_end_required(), 'end');
			return;
		}
		if (eventConvertEndDate < startDate) {
			setEventConvertError(m.event_convert_end_before_start(), 'end');
			return;
		}

		const cfg = { db: selected.db, token: getToken() ?? '' };
		const seasonId = manageableSeasonId;
		// #137's discipline, applied to this run: `selected` is live, so a
		// collective switch mid-loop must stop it POSTing further occurrences into
		// the db it just left, and must not write this run's outcome into the new
		// collective's state.
		const runDb = cfg.db;
		const dbChanged = (): boolean => selected?.db !== runDb;

		eventConvertSubmitting = true;
		try {
			let seriesId: string;
			let dbEntityId: string;
			let eventType: string;
			let occurrences: string[];
			let total: number;
			let created: number;

			if (resume) {
				// The series is already on the wire — re-converting would leave a
				// duplicate behind for every retry.
				({ seriesId, dbEntityId, eventType, total } = resume);
				occurrences = resume.remaining;
				created = total - occurrences.length;
			} else {
				let resolvedDbEntityId: string | null;
				try {
					resolvedDbEntityId = await resolveDatabaseEntityId(cfg);
				} catch (e) {
					console.error('agenda: resolving the database entity for event conversion failed', e);
					// #196 review F3 — NOT `eventConvertStepOf(e)`: this rejection comes
					// from the org lookup, which runs before the conversion's first step.
					if (!dbChanged())
						setEventConvertError(
							m.event_convert_failed({ step: EVENT_CONVERT_RESOLVE_STEP }),
							null
						);
					return;
				}
				if (!resolvedDbEntityId) {
					console.error(
						'agenda: event conversion with no resolvable database entity',
						selected.personId
					);
					if (!dbChanged())
						setEventConvertError(
							m.event_convert_failed({ step: EVENT_CONVERT_RESOLVE_STEP }),
							null
						);
					return;
				}
				if (dbChanged()) return;
				dbEntityId = resolvedDbEntityId;
				const input: ConvertEventToSeriesInput = {
					eventId: event.id,
					dbEntityId,
					seasonId,
					intervalDays,
					startTime,
					startDate,
					endDate: eventConvertEndDate,
					durationMinutes
				};
				try {
					const result = await convertEventToSeries(cfg, input);
					seriesId = result.seriesId;
					eventType = result.eventType;
				} catch (e) {
					console.error('agenda: event conversion failed', event.id, e);
					// A pre-write REFUSAL (no name / no event_type) says what is actually
					// wrong; everything else names the step that failed (#196 review F1).
					if (!dbChanged())
						setEventConvertError(
							eventConvertRefusalMessage(e) ??
								m.event_convert_failed({ step: eventConvertStepOf(e) }),
							null
						);
					return;
				}
				if (dbChanged()) return;
				// `[0]` is the converted event's own date — it IS the first
				// occurrence and already exists, so the loop starts at `[1]`.
				occurrences = generateIntervalDates({
					startDate,
					intervalDays,
					timeOfDay: startTime,
					until: eventConvertEndDate
				}).slice(1);
				total = occurrences.length;
				created = 0;
			}

			// #196 review F1 — there is no "converted but typeless" case to handle
			// here any more. Every occurrence carries its own `event_type` (#194/#202
			// — no reader inherits it from the series) and `createEvent` requires one,
			// so a typeless event cannot seed a run; the data layer now REFUSES such
			// an event in `read-event`, before the series is created and before the
			// event is reparented. The branch that used to stand here recorded a run
			// that could never be finished, behind a series that violated v4E.
			for (let i = 0; i < occurrences.length; i += 1) {
				// Checked FIRST, every iteration (the series loop's shape): a switch
				// between occurrences stops the run where it stands. The remainder is
				// NOT recorded across collectives here — see `EventConvertResume`.
				if (dbChanged()) {
					console.warn(
						'agenda: collective switched mid-conversion — the series keeps the occurrences already written',
						runDb,
						seriesId
					);
					return;
				}
				// Set BEFORE the await — "occurrence 1 of N" while the FIRST POST is
				// in flight, the series form's own convention.
				eventConvertProgress = { current: created + 1, total };
				try {
					await createEvent(cfg, {
						dbEntityId,
						seriesId,
						extraParentIds: [seasonId],
						eventType,
						startDatetime: tallinnLocalToUtcIso(occurrences[i])
					});
					created += 1;
				} catch (e) {
					console.error('agenda: generating a converted series occurrence failed', seriesId, e);
					eventConvertProgress = null;
					if (dbChanged()) return;
					// STOP at the failure — no further POSTs, no rollback. Remember
					// exactly where it stopped so a re-submit RESUMES.
					eventConvertResume = {
						eventId: event.id,
						seriesId,
						dbEntityId,
						eventType,
						remaining: occurrences.slice(i),
						total
					};
					setEventConvertError(m.event_convert_generate_failed({ created, total }), null);
					// AGENDA only: the occurrences that DID land must become visible.
					// `refreshSeasonManageLists` would re-read the standalone list, the
					// converted event has left it, and its row — which renders this very
					// form and its resume notice — would unmount mid-decision.
					loadForSelected({ keepSeasonManage: true });
					return;
				}
			}
			// The last successful POST can itself straddle a switch (the check above
			// only catches the NEXT iteration) — one more before the success writes.
			if (dbChanged()) return;
			eventConvertProgress = null;
			closeEventConvertForm();
			// Same discipline as `refreshAfterSeasonManageDelete`/the create path:
			// the write just changed the world this page reads, both the agenda
			// (the event now shows under its series) AND the panel's two lists (it
			// leaves the standalone list, the series' count grows).
			loadForSelected({ keepSeasonManage: true });
			refreshSeasonManageLists(cfg, seasonId);
			// The row that held the ⟳ is about to leave the standalone list, so
			// focus lands on the still-open panel — `restoreSeriesCreateFocus`'s
			// shape, for the same reason.
			tick().then(() => seasonManagePanelEl?.focus());
		} finally {
			eventConvertSubmitting = false;
		}
	}

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

			try {
				await createEvent(cfg, input);
			} catch (e) {
				console.error('agenda: event create failed', e);
				setEventCreateError(m.event_create_failed, null);
				return;
			}

			const origin = eventCreateOrigin;
			// #132/T4 review F3 — say what happened BEFORE the form unmounts. An
			// own name wins; a series occurrence has none of its own, so the
			// inherited series name (or, failing that, the type) names it.
			eventCreateStatus = m.event_created({
				name: trimmedName || eventCreateSeriesDefaults?.name || typeValue,
				when: eventCreateStatusFmt(new Date(startDatetime))
			});
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
		seasonCreateSubmitting || eventCreateSubmitting || seriesCreateSubmitting || eventConvertSubmitting
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
	/** #196 review F1/F4 — the conversion's occurrence loop is the same shape as
	 *  the series bulk run (many serial POSTs, resumable when it stops partway),
	 *  so it blocks the other entry points for the same reasons: nothing else may
	 *  open a creation form over a run still owing occurrences, and nothing may
	 *  unmount the form holding the only record of what it owes. */
	const eventConvertRunUnfinished = $derived(eventConvertSubmitting || eventConvertResume !== null);
	/** What every OTHER entry point gates on: an in-flight write anywhere, or a
	 *  stopped series/conversion run whose remainder is still recorded in the
	 *  open form. */
	const createEntryPointsBlocked = $derived(
		anyCreateSubmitting || seriesRunUnfinished || eventConvertRunUnfinished
	);

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
	 *  series run can outlive the panel (`resetSeasonManage`, a failed agenda
	 *  read on the same collective, guards only `eventConvertRunUnfinished`),
	 *  closing the panel with `seriesRunUnfinished` still true — the
	 *  COLLAPSED expand control (season-card-expand) is never gated on this,
	 *  it stays live so the admin surface is never entirely dead (#138 review
	 *  F2, #135). */
	const seasonCardCollapseDisabled = $derived(
		seasonManageOpen && (seriesRunUnfinished || eventConvertRunUnfinished)
	);

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
		// #196 review F4 — the panel's conversion form is a creation surface too.
		closeEventConvertForm();
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
		untrack(() => loadForSelected());
	});

	function retryAgenda() {
		// #196 review F2 — a retry is the SAME collective, so it must not take the
		// teardown branch while a conversion run is unfinished: that branch drops the
		// run record (`dropConvertRun: true`), which only a real switch may do.
		loadForSelected({ keepSeasonManage: eventConvertRunUnfinished });
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
						     card and stands here, above it, as its own page-level control;
						     its gate (`showSeasonCreate && !seasonCreateOpen`) is UNCHANGED
						     from #132/T2. With zero seasons + an editor this is the ONLY
						     control on the surface (the onboarding banner's own CTA is
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
							<div data-testid="agenda-admin-card" class="mb-3 rounded-md border border-ink-4 p-1.5">
								{#if !seasonManageOpen}
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
									<h2>
										<button
											type="button"
											data-testid="season-card-expand"
											bind:this={seasonManageExpandEl}
											aria-expanded="false"
											class="group flex w-full min-h-11 items-center gap-2 rounded-sm px-1.5 text-left font-display text-lg text-ink hover:bg-ink-5"
											onclick={openSeasonManagePanel}
										>
											<span class="sr-only">{m.season_manage_expand_label()}</span>
											<span aria-hidden="true" class="text-xs text-ink-3 group-hover:text-ink"
												>▸</span
											>
											<span>{seasonManageDeleteName}</span>
										</button>
									</h2>
								{:else}
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
														class="flex min-h-11 min-w-11 items-center justify-center text-ink-2 hover:text-ink"
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
											disabled={seasonManageConductorOptions.length === 0}
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
												     #212 — one action context at a time: the open convert form
												     unmounts every row's delete control (armed or not), the same
												     `{#if !seriesCreateOpen}`/`{#if !eventCreateOpen}`
												     mutual-exclusion precedent the panel's opener buttons use. -->
												{#if eventConvertOpenId === null}
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

								<!-- standalone events -->
								<div>
									<div class="flex items-center justify-between">
										<p class="text-xs tracking-wide text-ink-2 uppercase">
											{m.season_manage_events_label()}
										</p>
										<!-- #132/T6 review F1 — gated on `!eventCreateOpen` like the other
										     three entry points. Ungated, clicking it while the form it
										     itself opened was half-filled silently wiped that form (the
										     open path resets every field). `disabled` on
										     `createEntryPointsBlocked` then keeps it off-limits while ANY
										     create is on the wire OR a stopped series run still owes
										     occurrences — visibly, rather than as a silent no-op click. -->
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
									</div>
									{#if seasonManageEventsError}
										<p
											data-testid="season-manage-events-error"
											role="alert"
											class="mt-1 text-xs text-red-700"
										>
											{m.season_manage_list_load_error()}
										</p>
									{/if}
									{#each seasonManageEvents as event (event.id)}
										<div
											data-testid="season-manage-event-{event.id}"
											class="mt-1 flex items-center justify-between text-xs text-ink"
										>
											<span>{event.name}</span>
											<!-- #197 review F2 — the same two-step confirm the series rows
											     carry: an event delete is irreversible and there is no undo
											     anywhere in the app.
											     #212 — one action context at a time: while ANY row's convert
											     form is open the panel is a single action context, so every
											     row's ⟳/×/confirm/cancel (event rows AND series rows) unmounts,
											     the same `{#if !seriesCreateOpen}`/`{#if !eventCreateOpen}`
											     mutual-exclusion precedent the panel's own opener buttons use. -->
											{#if eventConvertOpenId === null}
												<div class="flex items-center gap-1">
													<!-- #196 — the standalone → series conversion entry point.
													     Icon-only like the `×` delete control beside it; the
													     accessible name (with the event's own name) rides
													     `aria-label`, not visible text (the delete-{event.id}
													     button's own established shape).
													     #196 review F4 — `disabled` on `createEntryPointsBlocked`
													     like `season-manage-add-series`/`-add-event`: a creation
													     entry point that is off-limits must LOOK off-limits, not
													     be a silent no-op click. -->
													<button
														type="button"
														data-testid="season-manage-event-convert-{event.id}"
														aria-label={m.season_manage_event_convert({ name: event.name })}
														disabled={createEntryPointsBlocked}
														class="flex min-h-11 min-w-11 items-center justify-center text-ink-2 hover:text-ink disabled:opacity-50 disabled:hover:text-ink-2"
														onclick={() => openEventConvertForm(event)}
													>
														&#8635;
													</button>
													{#if seasonManageDeleteArmed === event.id}
														<button
															type="button"
															data-testid="season-manage-event-delete-confirm-{event.id}"
															aria-label={m.season_manage_event_delete_confirm({
																name: event.name
															})}
															disabled={seasonManageDeletePendingId !== null}
															aria-busy={seasonManageDeletePendingId === event.id}
															class="flex min-h-11 items-center px-1 text-xs text-red-700 underline disabled:opacity-50"
															onclick={() => onSeasonManageEventDelete(event)}
														>
															{m.season_manage_delete_confirm_short()}
														</button>
														<button
															type="button"
															data-testid="season-manage-event-delete-cancel-{event.id}"
															aria-label={m.season_manage_delete_cancel({ name: event.name })}
															disabled={seasonManageDeletePendingId !== null}
															class="flex min-h-11 items-center px-1 text-xs text-ink-2 underline hover:text-ink disabled:opacity-50"
															onclick={() =>
																void disarmSeasonManageDelete(
																	`season-manage-event-delete-${event.id}`
																)}
														>
															{m.season_manage_delete_cancel_short()}
														</button>
												{:else}
													<!-- #237 — joins the shared red-trashcan unit; the old
													     muted × leaves for TrashIcon + the destructive red pair. -->
													<DeleteTrigger
														data-testid="season-manage-event-delete-{event.id}"
														aria-label={m.season_manage_event_delete({ name: event.name })}
														onclick={() =>
															void armSeasonManageDelete(
																event.id,
																`season-manage-event-delete-confirm-${event.id}`
															)}
													/>
												{/if}
												</div>
											{/if}
										</div>
										{#if eventConvertOpenId === event.id}
											<!-- #196 review F3 — the full dialog contract its four siblings on
											     this page keep: `tabindex="-1"` + the focus effect (a
											     role="dialog" must actually take focus), and its OWN Escape
											     handler, which stops propagation so one Escape no longer
											     dismissed the whole season-manage panel around a conversion
											     still on the wire. -->
											<div
												data-testid="event-convert-form"
												role="dialog"
												aria-label={m.event_convert_form_label()}
												tabindex="-1"
												bind:this={eventConvertFormEl}
												class="mt-1 flex flex-col gap-1.5 border border-dashed border-ink-5 p-2"
												onkeydown={onEventConvertFormKeydown}
											>
												<!-- Every box carries `disabled={eventConvertLocked}`: once the
												     occurrence run has stopped partway the series exists with
												     its cadence already written, so submit FINISHES that run and
												     an edit here would be silently discarded. -->
												<label class="flex w-full flex-col gap-0.5">
													<span class="text-xs text-ink-2">
														{m.event_convert_interval_label()}
													</span>
													<input
														type="number"
														min="1"
														data-testid="event-convert-interval"
														aria-label={m.event_convert_interval_label()}
														aria-invalid={eventConvertInvalid('interval')}
														aria-describedby={eventConvertDescribedBy('interval')}
														disabled={eventConvertLocked}
														value={eventConvertIntervalDays}
														oninput={(e) => {
															eventConvertIntervalDays = (
																e.currentTarget as HTMLInputElement
															).value;
															clearEventConvertError();
														}}
														class="w-full border border-ink-5 bg-paper px-1.5 py-1 text-ink disabled:opacity-50"
													/>
												</label>
												<label class="flex w-full flex-col gap-0.5">
													<span class="text-xs text-ink-2">
														{m.event_convert_duration_label()}
													</span>
													<input
														type="number"
														min="1"
														data-testid="event-convert-duration"
														aria-label={m.event_convert_duration_label()}
														aria-invalid={eventConvertInvalid('duration')}
														aria-describedby={eventConvertDescribedBy('duration')}
														disabled={eventConvertLocked}
														value={eventConvertDuration}
														oninput={(e) => {
															eventConvertDuration = (
																e.currentTarget as HTMLInputElement
															).value;
															clearEventConvertError();
														}}
														class="w-full border border-ink-5 bg-paper px-1.5 py-1 text-ink disabled:opacity-50"
													/>
												</label>
												<!-- #212 — the event's OWN date, derived (never a new $state) from
												     `tallinnWallClockParts(event.startDatetime).date`: plain ISO
												     TEXT, not an input, so the end-date picker below has visible
												     context for what it cannot precede. -->
												<p
													data-testid="event-convert-start-date"
													class="flex w-full flex-col gap-0.5"
												>
													<span class="text-xs text-ink-2">
														{m.event_convert_start_date_label()}
													</span>
													<span class="text-ink">
														{tallinnWallClockParts(event.startDatetime).date}
													</span>
												</p>
												<label class="flex w-full flex-col gap-0.5">
													<span class="text-xs text-ink-2">
														{m.event_convert_end_date_label()}
													</span>
													<input
														type="date"
														data-testid="event-convert-end-date"
														aria-label={m.event_convert_end_date_label()}
														aria-invalid={eventConvertInvalid('end')}
														aria-describedby={eventConvertDescribedBy('end')}
														disabled={eventConvertLocked}
														value={eventConvertEndDate}
														oninput={(e) => {
															eventConvertEndDate = (
																e.currentTarget as HTMLInputElement
															).value;
															clearEventConvertError();
														}}
														class="w-full border border-ink-5 bg-paper px-1.5 py-1 text-ink disabled:opacity-50"
													/>
												</label>
												{#if eventConvertProgress}
													<p
														data-testid="event-convert-progress"
														role="status"
														aria-live="polite"
														class="text-xs text-ink-2"
													>
														{m.event_convert_progress({
															current: eventConvertProgress.current,
															total: eventConvertProgress.total
														})}
													</p>
												{/if}
												{#if eventConvertResume}
													<p data-testid="event-convert-resume-notice" class="text-xs text-ink-2">
														{m.event_convert_resume_notice({
															remaining: eventConvertResume.remaining.length,
															total: eventConvertResume.total
														})}
													</p>
												{/if}
												{#if eventConvertError}
													<p
														id="event-convert-error"
														data-testid="event-convert-error"
														role="alert"
														class="text-xs text-red-700"
													>
														{eventConvertError}
													</p>
												{/if}
												<div class="flex gap-2">
													<button
														type="button"
														data-testid="event-convert-submit"
														disabled={eventConvertSubmitting}
														aria-busy={eventConvertSubmitting}
														class="flex min-h-11 items-center border border-ink px-2 py-1 text-xs text-ink hover:bg-ink hover:text-paper disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-ink"
														onclick={() => void submitEventConvert(event)}
													>
														{m.event_convert_submit()}
													</button>
													<button
														type="button"
														data-testid="event-convert-cancel"
														disabled={eventConvertSubmitting}
														class="flex min-h-11 items-center px-2 py-1 text-xs text-ink-2 hover:text-ink disabled:opacity-50 disabled:hover:text-ink-2"
														onclick={dismissEventConvertForm}
													>
														{m.event_convert_cancel()}
													</button>
												</div>
											</div>
										{/if}
									{/each}
									{#if seasonManageDeleteError?.list === 'events'}
										<p
											data-testid="season-manage-delete-error"
											role="alert"
											class="mt-1 text-xs text-red-700"
										>
											{seasonManageDeleteErrorText(seasonManageDeleteError)}
										</p>
									{/if}
								</div>

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
										pendingKeys={panelPendingKeys}
										addWorkKey={PANEL_ADD_WORK_KEY}
										expanded={true}
										onpdfclick={handlePdfClick}
										onaddwork={handlePanelAddWork}
										onstatuschange={handlePanelStatusChange}
										onremoveitem={handlePanelRemoveItem}
									/>
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
						     live region announces only CHANGES to its contents). -->
						<div data-testid="season-create-status" role="status" aria-live="polite" class="sr-only">
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
						     is generally not announced; only a change to a present one is. -->
						<div data-testid="event-create-status" role="status" aria-live="polite" class="sr-only">
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
								     event created anyway is not lost either — the panel's per-row
								     convert control (#196 phase 2) exists for exactly that. -->
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
								<!-- #247 — the Nimekiri|Kuu view toggle, sitting WITH the chips
								     (Ruled 2026-09-06, item 9): a two-state segmented control of
								     native buttons — day list is the default, the choice persists
								     per-device via the #207-shaped agendaView preference store. -->
								<div
									role="group"
									aria-label={m.agenda_view_toggle_label()}
									class="flex gap-1"
								>
									<button
										type="button"
										data-testid="agenda-view-list"
										aria-pressed={$agendaViewStore === 'list' ? 'true' : 'false'}
										class="rounded-full border px-2 py-0.5 font-mono text-[9px] tracking-wide uppercase {$agendaViewStore ===
										'list'
											? 'border-ink bg-ink text-paper'
											: 'border-ink-4 text-ink-2'}"
										onclick={() => setAgendaView('list')}
									>
										{m.agenda_view_list()}
									</button>
									<button
										type="button"
										data-testid="agenda-view-month"
										aria-pressed={$agendaViewStore === 'month' ? 'true' : 'false'}
										class="rounded-full border px-2 py-0.5 font-mono text-[9px] tracking-wide uppercase {$agendaViewStore ===
										'month'
											? 'border-ink bg-ink text-paper'
											: 'border-ink-4 text-ink-2'}"
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
								recentItems={filteredRecentItems}
								{conductorEventIds}
								{myAttendanceByEventId}
								{worksByEventId}
								{worksManage}
								scheduleItemsByEventId={scheduleByEventId}
								{attendancePanel}
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
