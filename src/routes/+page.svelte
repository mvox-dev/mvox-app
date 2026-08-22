<script lang="ts">
	import { tick, untrack } from 'svelte';
	import { authStore } from '$lib/auth/session';
	import { rovingNextIndex } from '$lib/a11y/roving';
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
	import { loadWorksByEventId } from '$lib/repertoire/workRows';
	import { signFileUrl } from '$lib/repertoire/fileUrls';
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
	import { listWorks, listAllEditions, type Edition, type Work } from '$lib/library/libraryData';
	import { ADD_PROGRAMME_KEY, ADD_WORK_KEY } from '$lib/components/agenda/RepertoireElement.svelte';
	import { isAuthExpiredError } from '$lib/entu/request';
	import SessionExpiredNotice from '$lib/components/auth/SessionExpiredNotice.svelte';
	import { m } from '$lib/paraglide/messages.js';
	import DeskSurface from '$lib/components/DeskSurface.svelte';
	import AgendaList from '$lib/components/agenda/AgendaList.svelte';
	import SeasonSummary from '$lib/components/attendance/SeasonSummary.svelte';
	import Autocomplete from '$lib/components/Autocomplete.svelte';
	import type { AttendancePanel } from '$lib/attendance/types';
	import type { Season } from '$lib/seasons/types';
	import { createEvent, createEventSeries, createSeason } from '$lib/entity/entityCreate';
	import type { CreateEventInput, CreateEventSeriesInput } from '$lib/entity/entityCreate';
	import { generateEventDates, type RepeatPattern } from '$lib/events/recurrence';
	import { resolveDatabaseEntityId } from '$lib/collective/databaseEntity';
	import {
		listEventSeriesForSeason,
		listEventsForSeason,
		updateSeasonField,
		addSeasonConductor,
		removeSeasonConductor as apiRemoveSeasonConductor,
		getSeriesDefaults
	} from '$lib/seasons/seasonManage';
	import type {
		SeasonEditableField,
		SeriesDefaults,
		SeriesListItem,
		StandaloneEvent
	} from '$lib/seasons/seasonManage';
	import { listEventTypes } from '$lib/events/eventTypes';

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
	// F1+F2 fix: no duplicate listSeasons/listRehearsals calls, no N+1 conductor
	// reads). `conductorEventIds` is computed PURELY from the already-loaded data
	// (season.conductors + event.conductors on each AgendaItem).
	let recentItems = $state<AgendaItem[]>([]);
	let conductorEventIds = $state<Set<string>>(new Set());

	// #90 TR.2 — the works view model per event id (upcoming AND recent rows),
	// resolved once the agenda itself has loaded (it needs the event ids and the
	// current season). Same supplementary-data posture as rsvpByEventId: a
	// failure here leaves every row work-free rather than breaking the agenda.
	let worksByEventId = $state<Record<string, WorkRow[]>>({});
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
	// chips + the conductor Autocomplete's option list). Mirrored off every
	// `getRoster` resolution (cache hit or fresh fetch) rather than fetched
	// separately, so the panel never pays its own 1+N roster fan-out.
	let rosterRows = $state<RosterRow[]>([]);

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
			return Promise.resolve(rosterCache!.roster);
		}
		return loadRoster(cfg).then((roster) => {
			// Keyed by the db the fetch was FOR — a collective switch mid-flight
			// leaves a cache entry the (now different) selected db never matches.
			rosterCache = { db: cfg.db, roster, fetchedAt: Date.now() };
			rosterRows = roster;
			return roster;
		});
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
			worksByEventId = {};
			pdfError = false;
			resetManagement();
			resetConductor();
			closeAttendancePanel();
			rosterCache = null;
			rosterRows = [];
			resetSeasonManage();
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
		pdfError = false;
		resetManagement();
		if (!keepSeasonManage) {
			// The roster ride-along is deliberate: the panel's conductor chips
			// resolve their names off `rosterRows`, and nothing re-fetches it while
			// the panel merely stays open — wiping it would turn every chip into
			// "unknown member" for a refresh that changed no collective.
			rosterCache = null;
			rosterRows = [];
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
		// loadRecentEvents() pair. Seasons and rehearsals are fetched once;
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
				resetManagement();
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
	 *  "Work — Edition" so the picker reads as music rather than as ids. */
	const pickableEditionsByEventId = $derived.by(() => {
		const workNameById = new Map(libraryWorks.map((work) => [work.id, work.name]));
		const all: PickerOption[] = libraryEditions.map((edition) => {
			const workName = workNameById.get(edition.workId ?? '') ?? '';
			return {
				id: edition.id,
				label: workName === '' ? editionLabel(edition) : `${workName} — ${editionLabel(edition)}`
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
	// past-event count — "Attended 31 of 2 rehearsals".
	const mySeasonAttendance = $derived((() => {
		const recentIds = new Set(recentItems.map((i) => i.id));
		return myAttendance.filter((a) => recentIds.has(a.eventId));
	})());
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
		Promise.all([loadRoster(cfg), Promise.all(events.map((event) => listAttendance(cfg, event.id)))])
			.then(([roster, perEventRecords]) => {
				if (thisRequestSnapshot !== requestId) return;
				seasonMemberRates = deriveAllMemberRates(perEventRecords.flat(), roster, events.length);
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
	// Chosen conductors, in pick order — the Autocomplete clears itself after
	// each pick (multi-add readiness), so THIS is what renders the chips and
	// what `conductorRefs` is built from on submit.
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
	// The conductor autocomplete's source — loaded ONCE when the form opens
	// (never per-keystroke; the Autocomplete itself filters client-side).
	let seasonConductorOptions = $state<Array<{ id: string; label: string }>>([]);

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
		// other two creation surfaces must yield.
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
		seasonConductorOptions = [];
		// F1 — through the shared cache, not a fresh 1+N fan-out per form open.
		getRoster({ db: current.db, token: getToken() ?? '' })
			.then((rows) => {
				seasonConductorOptions = rows.map((row) => ({ id: row.personId, label: row.name }));
			})
			.catch((e) => {
				// Supplementary — the conductor field is simply option-less on a
				// failed read; the name/dates path (the point of the form) stays live.
				console.error('agenda: loading the roster for the conductor autocomplete failed', e);
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
	// #132/T2 review F2 — LAYERED with the conductor Autocomplete, not racing it:
	// while its dropdown is OPEN the Autocomplete consumes Escape (stopPropagation)
	// and only dismisses its own popup, so one keystroke can no longer close the
	// dropdown AND throw away the half-filled form around it. With the dropdown
	// closed the event reaches here, and the form dismisses — the WAI-APG
	// two-Escapes-to-leave behaviour.
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
		// No `allowFreeText` on this Autocomplete — id is always non-null here in
		// practice, but stay fail-closed rather than trust that wiring silently.
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

	// ── #132/T3 — season MANAGEMENT: [⚙] gear + inline panel ──────────────────
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
	const showSeasonManageGear = $derived(
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
	/** A failed conductor add/remove reverts the optimistic chip — and, without
	 *  this, said nothing (#132/T3 review F1). Same contract the three text/date
	 *  fields already keep: a silently snapped-back value reads as a bug. */
	let seasonManageConductorError = $state(false);
	/** True while the panel's roster read is in flight — the conductor chips
	 *  need it to tell "name not here YET" from "name will NEVER arrive"
	 *  (#132/T3 review F4). */
	let seasonManageRosterLoading = $state(false);
	/** The dialog itself and the gear that opens it — focus moves INTO the
	 *  panel on open and back to the gear on close (#132/T3 review F1). */
	let seasonManagePanelEl = $state<HTMLDivElement | null>(null);
	let seasonManageGearEl = $state<HTMLButtonElement | null>(null);

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

	/** The conductor Autocomplete's source: roster members not ALREADY a
	 *  conductor of this season. */
	const seasonManageConductorOptions = $derived(
		rosterRows
			.filter((row) => !seasonManageConductorIds.includes(row.personId))
			.map((row) => ({ id: row.personId, label: row.name }))
	);

	/** Season bounds are date-ONLY (`yyyy-mm-dd`), so they format in UTC — the
	 *  same guard `library/+page.svelte`'s `formatDate` uses to keep a date-only
	 *  value from sliding to the previous day in a negative offset. Options and
	 *  the implicit-locale shape match `event/[id]/+page.svelte`'s `dateFmt`;
	 *  a raw ISO string never reaches the UI (#132/T3 review F3). */
	const seasonDateFmt = new Intl.DateTimeFormat(undefined, {
		timeZone: 'UTC',
		year: 'numeric',
		month: 'short',
		day: 'numeric'
	});

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

	function resetSeasonManage(): void {
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
		seasonManageConductorError = false;
		seasonManageRosterLoading = false;
		seasonEditingField = null;
		seasonEditDraft = '';
		seasonEditErrors = {};
		seasonEditPending = {};
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
		// visit): the conductor chips/Autocomplete are the FIRST thing in this
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
		if (seriesRunUnfinished) return;
		seasonManageOpen = false;
		seasonEditingField = null;
		// The dialog held focus (see the $effect below); dismissing it unmounts
		// the focused element, so hand focus back to the control that opened it
		// rather than dropping the keyboard user at <body> — the same debt every
		// self-unmounting control on this page pays (#113 TU.5, #99 F1/F3).
		seasonManageGearEl?.focus();
	}

	/** Focus moves INTO the dialog the moment it opens (#132/T3 review F1). Without
	 *  this the panel's own Escape handler is unreachable in a real browser: the
	 *  panel is a SIBLING of the gear's wrapper, so a keypress at the still-focused
	 *  gear never enters the panel's subtree and never bubbles to `onkeydown`. It
	 *  is also what `role="dialog"` promises a screen-reader user. Same shape as
	 *  the season-CREATE form's focus effect above; both deps are stable while the
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
	 *  while an edit is open — the WAI-APG two-Escapes-to-leave shape, same as
	 *  the conductor Autocomplete vs. the season-CREATE form (#132/T2 review F2). */
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
	 *  event/[id]/+page.svelte's editor (and AgendaList's display). Duplicated
	 *  rather than shared: neither of those two owns a module the other could
	 *  import from without a bigger refactor, and this is the third site to
	 *  need the SAME two-pass DST-aware conversion. */
	const EVENT_CREATE_TZ = 'Europe/Tallinn';

	/** The Tallinn wall-clock offset (minutes) in effect AT `date` — see
	 *  event/[id]/+page.svelte's `tallinnOffsetMinutes` for the derivation. */
	function eventCreateTallinnOffsetMinutes(date: Date): number {
		const parts = new Intl.DateTimeFormat('en-US', {
			timeZone: EVENT_CREATE_TZ,
			hourCycle: 'h23',
			year: 'numeric',
			month: '2-digit',
			day: '2-digit',
			hour: '2-digit',
			minute: '2-digit',
			second: '2-digit'
		}).formatToParts(date);
		const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? '0');
		const asUtc = Date.UTC(
			get('year'),
			get('month') - 1,
			get('day'),
			get('hour'),
			get('minute'),
			get('second')
		);
		return (asUtc - date.getTime()) / 60_000;
	}

	/** A `datetime-local` value typed AS TALLINN wall clock → the UTC instant
	 *  to write on the wire (TE.4, exactly — see event/[id]/+page.svelte's
	 *  `tallinnLocalToUtcIso` for why this needs two passes). '' on an empty or
	 *  unparseable draft. */
	function tallinnLocalToUtcIso(local: string): string {
		const [datePart, timePart] = local.split('T');
		const [y, mo, d] = (datePart ?? '').split('-').map(Number);
		const [h, mi] = (timePart ?? '00:00').split(':').map(Number);
		const guessUtcMs = Date.UTC(y, mo - 1, d, h, mi);
		if (Number.isNaN(guessUtcMs)) return '';
		const firstOffset = eventCreateTallinnOffsetMinutes(new Date(guessUtcMs));
		let instantMs = guessUtcMs - firstOffset * 60_000;
		const secondOffset = eventCreateTallinnOffsetMinutes(new Date(instantMs));
		if (secondOffset !== firstOffset) instantMs = guessUtcMs - secondOffset * 60_000;
		return new Date(instantMs).toISOString();
	}

	// Rights gate: the SAME formula `showSeasonManageGear` already computes —
	// #167: the MANAGEABLE season (current-if-running, else the soonest future
	// one), editor rights on it — deliberately independent of T2's
	// `showSeasonCreate` gate (an upcoming season hides [+ Season] but must not
	// hide [+ Event]; see the RED spec's own doc on the two gates).
	const showEventCreate = $derived(
		manageableSeasonId !== null && manageableSeasonRights === 'editor'
	);

	/** The event-create fields a validation message can belong to; `null` = a
	 *  form-wide failure (no org, a failed write) that names no single box. */
	type EventCreateErrorField = 'type' | 'season' | 'datetime' | 'name' | null;

	/** The created event's start, in the viewer's locale AND Tallinn wall clock —
	 *  for the success announcement. A raw ISO string never reaches the UI
	 *  (#132/T3 review F3). */
	const eventCreateStatusFmt = new Intl.DateTimeFormat(undefined, {
		timeZone: EVENT_CREATE_TZ,
		year: 'numeric',
		month: 'short',
		day: 'numeric',
		hour: '2-digit',
		minute: '2-digit',
		hourCycle: 'h23'
	});

	let eventCreateOpen = $state(false);
	// Which entry point opened the form — the ONLY thing that decides whether a
	// successful create ALSO refreshes the panel's two lists (a page-level open
	// has no panel to refresh).
	let eventCreateOrigin = $state<'agenda' | 'panel' | null>(null);
	let eventCreateSeasonId = $state('');
	let eventCreateSeriesId = $state('');
	let eventCreateSeriesOptions = $state<SeriesListItem[]>([]);
	// The selected series' inherited name/duration/location/description —
	// rendered as PLACEHOLDERS only, never copied into a value (the #132/T4
	// preview contract: what this shows is exactly what the read-side merge
	// (`listRehearsals`, `loadEventDetail`) would show for an untouched
	// occurrence).
	let eventCreateSeriesDefaults = $state<SeriesDefaults | null>(null);
	// Deduped + sorted PRIOR event_type values — the type Autocomplete's source.
	// Dedup/sort is deliberately done HERE (not in `listEventTypes`, which hands
	// back the wire values verbatim) — see eventTypes.ts's module doc.
	let eventCreateTypeOptions = $state<string[]>([]);
	let eventCreateType = $state('');
	let eventCreateName = $state('');
	let eventCreateDatetime = $state('');
	let eventCreateDuration = $state('');
	let eventCreateLocation = $state('');
	let eventCreateDescription = $state('');
	let eventCreateCapacity = $state('');
	let eventCreateConductors = $state<Array<{ id: string; name: string }>>([]);
	let eventCreateError = $state<(() => string) | null>(null);
	/** Which field the message belongs to — always set WITH the message, the T2
	 *  review F2 shape: a form-wide "try again" that names no field is a dead end
	 *  for anyone who cannot see which box is empty. `null` = form-wide. */
	let eventCreateErrorField = $state<EventCreateErrorField>(null);
	/** #132/T4 review F1 — the type Autocomplete's LIVE text, mirrored here via
	 *  its `onQueryChange`. `eventCreateType` alone is not the truth of what the
	 *  viewer sees: "afterparty" typed and never confirmed with Enter leaves the
	 *  committed value at '' while the word is still in the box. */
	let eventCreateTypeQuery = $state('');
	/**
	 * #132/T4 review (2nd pass) F1 — the type the viewer is ACTUALLY looking at.
	 *
	 * The LIVE box wins over the committed value, not the other way round. A
	 * commit resets the Autocomplete's own input to '' and reports
	 * `onQueryChange('')` (Autocomplete.svelte's `commit`), so a blank query means
	 * "the box is empty — the committed value is all there is". A NON-blank query
	 * means the viewer has typed since: whether or not she pressed Enter, that
	 * word is what the box reads. The other precedence loses silently — commit
	 * 'rehearsal', retype 'concert' without Enter, submit, and the write carries
	 * 'rehearsal' with no refusal and no aria-invalid to show for it.
	 */
	const eventCreateEffectiveType = $derived((eventCreateTypeQuery.trim() || eventCreateType).trim());
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
	/** The page-level [+ Event] — focus's landing after the form unmounts itself
	 *  (an agenda-born create/cancel), so the keyboard user is not dropped at
	 *  <body>. A panel-born form hands focus back to the panel instead. */
	let eventCreateButtonEl = $state<HTMLButtonElement | null>(null);

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

	/** Deduped (exact) + sorted (localeCompare) — the PAGE's job per the
	 *  eventTypes.ts contract; `listEventTypes` hands back the wire values
	 *  verbatim, duplicates included. Lazy: fired only when the form opens. */
	function loadEventCreateTypeOptions(cfg: ManageCfg): void {
		const thisLoad = eventCreateLoadId;
		listEventTypes(cfg)
			.then((raw) => {
				if (thisLoad !== eventCreateLoadId) return; // review F3 — a closed/reopened form's reply
				const unique = [...new Set(raw)];
				unique.sort((a, b) => a.localeCompare(b));
				eventCreateTypeOptions = unique;
			})
			.catch((e) => {
				if (thisLoad !== eventCreateLoadId) return;
				console.error('agenda: loading prior event types failed', e);
				eventCreateTypeOptions = [];
			});
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

	/** Opened from the page-level [+ Event] (`origin: 'agenda'`, season starts
	 *  EMPTY) or from T3's panel [+ Event] (`origin: 'panel'`, the panel's own
	 *  season pre-filled and its series already offered). Same form either way. */
	function openEventCreateForm(origin: 'agenda' | 'panel'): void {
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
		const prefillSeasonId = origin === 'panel' ? (manageableSeasonId ?? '') : '';
		eventCreateSeasonId = prefillSeasonId;
		eventCreateSeriesId = '';
		eventCreateSeriesOptions = [];
		eventCreateSeriesDefaults = null;
		eventCreateType = '';
		eventCreateTypeQuery = '';
		eventCreateTypeOptions = [];
		eventCreateName = '';
		eventCreateDatetime = '';
		eventCreateDuration = '';
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
		loadEventCreateTypeOptions(cfg);
		getRoster(cfg).catch((e) => {
			console.error('agenda: loading the roster for the event conductor autocomplete failed', e);
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
		eventCreateTypeQuery = '';
		eventCreateTypeOptions = [];
		eventCreateName = '';
		eventCreateDatetime = '';
		eventCreateDuration = '';
		eventCreateLocation = '';
		eventCreateDescription = '';
		eventCreateCapacity = '';
		eventCreateConductors = [];
		clearEventCreateError();
	}

	/**
	 * The form is self-unmounting, and the element that had focus goes with it —
	 * without this the keyboard user lands at <body> (#113 TU.5, #99 F1/F3, the
	 * same debt `closeSeasonManagePanel` pays). A PANEL-born form hands focus
	 * back to the still-open panel; an agenda-born one to the [+ Event] button
	 * that re-renders in the form's place. `tick()` because both targets are
	 * mounted only on the NEXT tick. NOT folded into `closeEventCreateForm` —
	 * that also runs on a collective switch, where stealing focus would be wrong.
	 *
	 * Best-effort by design (`?.`): on the agenda-born SUCCESS path the reload
	 * blanks `manageableSeasonId` until it resolves, so the button is briefly
	 * unmounted and there is nothing to focus — the pre-existing behaviour, not
	 * a regression. Cancel/Escape, which reload nothing, always land.
	 */
	function restoreEventCreateFocus(origin: 'agenda' | 'panel' | null): void {
		tick().then(() => {
			if (origin === 'panel') seasonManagePanelEl?.focus();
			else eventCreateButtonEl?.focus();
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

	/** The type Autocomplete's `onSelect` — a list pick and a free-text commit
	 *  both carry the chosen string in `label` (list picks have `id === label`
	 *  per the eventTypes contract; free text has `id: null`). */
	function handleEventCreateTypeSelect(selection: { id: string | null; label: string }): void {
		const value = selection.label.trim();
		if (!value) return;
		eventCreateType = value;
		clearEventCreateError();
	}

	/** The type Autocomplete's live text (#132/T4 review F1) — mirrored so submit
	 *  can honour a typed-but-not-Entered type instead of writing '' and blaming
	 *  the network for it. */
	function handleEventCreateTypeQuery(query: string): void {
		eventCreateTypeQuery = query;
		if (query.trim()) clearEventCreateError();
	}

	function handleEventCreateConductorSelect(selection: { id: string | null; label: string }): void {
		if (!selection.id) return;
		if (eventCreateConductors.some((c) => c.id === selection.id)) return; // no duplicate chips
		eventCreateConductors = [...eventCreateConductors, { id: selection.id, name: selection.label }];
	}

	function removeEventCreateConductor(id: string): void {
		eventCreateConductors = eventCreateConductors.filter((c) => c.id !== id);
	}

	/** The conductor Autocomplete's source: roster members not already picked.
	 *  Off the SAME cached `rosterRows` the season-manage panel populates —
	 *  `getRoster` above is the one cache, so opening this form after the panel
	 *  (or vice versa) never pays a second 1+N fan-out. */
	const eventCreateConductorOptions = $derived(
		rosterRows
			.filter((row) => !eventCreateConductors.some((c) => c.id === row.personId))
			.map((row) => ({ id: row.personId, label: row.name }))
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

	/** Re-reads the panel's two lists after a PANEL-born create — the new
	 *  occurrence must land in the counts the panel already shows. Mirrors
	 *  `openSeasonManagePanel`'s pair of reads, minus the roster/open-state
	 *  parts (this is a refresh, not a (re)open). */
	function refreshSeasonManageLists(cfg: ManageCfg, seasonId: string): void {
		const thisRequest = requestId;
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
	 * invisible to every agenda read — `listRehearsals` selects on it), type,
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
		// What the type box actually READS — the live text if there is any, else
		// the committed value (review F1, then its 2nd-pass correction: the live
		// text has to WIN, or a retype-after-commit writes the old word silently).
		const typeValue = eventCreateEffectiveType;
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

			const durationValue = eventCreateNumberOrUndefined(eventCreateDuration);
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
				when: eventCreateStatusFmt.format(new Date(startDatetime))
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
	// can only mean optional GENERATION — see the RED spec's header). Generation
	// is the `seriesCreateGenerate` checkbox (default OFF); ON reveals the live
	// preview and turns a plain series-create into a serial bulk `createEvent`
	// per occurrence.

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
	let seriesCreateGenerate = $state(false);
	let seriesCreateSkipDateInput = $state('');
	let seriesCreateSkipDates = $state<string[]>([]);
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
	 *  stopped series run whose remainder is still recorded in the open form. */
	const createEntryPointsBlocked = $derived(anyCreateSubmitting || seriesRunUnfinished);

	// #156 — agenda admin toolbar roving tabindex. WAI-APG *toolbar* pattern,
	// not a selector — no member is ever 'selected', so the roving stop is
	// just 'last focused, else first enabled'. Keyed by testid rather than a
	// domain id (the three members aren't rows of anything). The walk EXCLUDES
	// [disabled] — `createEntryPointsBlocked` can disable both create buttons,
	// and a disabled button cannot hold focus: a roving stop parked on one
	// would strand the whole toolbar from the keyboard.
	let toolbarRoving = $state<string | null>(null);
	const toolbarActiveTestid = $derived.by(() => {
		if (toolbarRoving === 'season-manage-gear' && showSeasonManageGear) return toolbarRoving;
		if (toolbarRoving === 'season-create' && showSeasonCreate && !seasonCreateOpen && !createEntryPointsBlocked)
			return toolbarRoving;
		if (toolbarRoving === 'event-create' && showEventCreate && !eventCreateOpen && !createEntryPointsBlocked)
			return toolbarRoving;
		if (showSeasonManageGear) return 'season-manage-gear';
		if (showSeasonCreate && !seasonCreateOpen && !createEntryPointsBlocked) return 'season-create';
		if (showEventCreate && !eventCreateOpen && !createEntryPointsBlocked) return 'event-create';
		return null;
	});

	function handleAdminToolbarKeydown(e: KeyboardEvent): void {
		const toolbar = e.currentTarget as HTMLElement;
		const buttons = Array.from(toolbar.querySelectorAll<HTMLButtonElement>('button:not([disabled])'));
		const idx = buttons.indexOf(e.target as HTMLButtonElement);
		if (idx < 0) return;
		const next = rovingNextIndex(e.key, idx, buttons.length);
		if (next < 0) return;
		e.preventDefault();
		buttons[next].focus();
	}

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
	 * generation is ON AND time/from/until are set — plus a day WHEN THE PATTERN
	 * USES ONE. An incomplete recurrence has nothing determinate to preview yet.
	 */
	const seriesCreatePreviewDates = $derived.by(() => {
		if (!seriesCreateGenerate) return null;
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
	 * The dates the preview actually LISTS — #132/T5 review F3.
	 *
	 * After a stopped run the count line is suppressed in favour of the resume
	 * notice ("2 remaining of 3"), but the rows underneath kept coming from the
	 * FULL recomputed set, so a run that stopped at 2 of 3 showed three dates
	 * while a re-submit would create one. The list and the notice must describe
	 * the SAME set: while `seriesCreateResume` is non-null that set is exactly
	 * `remaining` — what submit will write.
	 */
	const seriesCreatePreviewRows = $derived.by(() => {
		if (seriesCreatePreviewDates === null) return null;
		return seriesCreateResume ? seriesCreateResume.remaining : seriesCreatePreviewDates;
	});

	/** `date` (a `generateEventDates` 'YYYY-MM-DDTHH:MM' local string) as an ISO
	 *  calendar day — the preview row testid and the skip-chip's own shape.
	 *  #141 — a plain slice, never a `Date` readback: `generateEventDates`
	 *  itself now emits the local string directly (see recurrence.ts's module
	 *  doc) precisely so no caller reconstructs a `Date` at the occurrence's
	 *  hour and risks the DST spring-forward normalization. */
	function seriesCreateIsoDay(date: string): string {
		return date.slice(0, 10);
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
		seriesCreateGenerate = false;
		seriesCreateSkipDateInput = '';
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
		seriesCreateSkipDateInput = '';
		// A resume record only ever exists for a GENERATING run (a series-only
		// create has nothing left to owe), and the preview/notice both need it on.
		seriesCreateGenerate = true;
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

	function addSeriesCreateSkipDate(): void {
		const value = seriesCreateSkipDateInput.trim();
		if (!value) return;
		if (!seriesCreateSkipDates.includes(value)) {
			seriesCreateSkipDates = [...seriesCreateSkipDates, value].sort();
		}
		seriesCreateSkipDateInput = '';
	}

	function removeSeriesCreateSkipDate(date: string): void {
		seriesCreateSkipDates = seriesCreateSkipDates.filter((d) => d !== date);
	}

	/**
	 * Submit: series-only when generation is OFF — `createEventSeries` (T1) is
	 * the ONE seam, org from `resolveDatabaseEntityId`, the panel's season in
	 * `extraParentIds`. WITH generation, bulk-creates one `createEvent` per
	 * `generateEventDates` date, STRICTLY SERIAL, ascending (Entu rate/ordering
	 * — #132/T5's pinned contract). Validation runs BEFORE any fetch, each
	 * refusal naming its own field (the T4 discipline this form inherits) — a
	 * refused submit must never leave a half-made series behind. When
	 * `seriesCreateResume` is set (a previous run stopped partway) the series is
	 * NOT re-created: the run picks up at the occurrence that failed.
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
		// the discriminator `listRehearsals` filters on, so a viewer who cleared
		// the box (to type 'concert', or deliberately) would get a rehearsal
		// series with no message and no way to see the mistake until the agenda
		// is wrong. Refuse the blank, the way T4's sibling form on this page does.
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
		if (seriesCreateGenerate && seriesCreateDayApplies && seriesCreateDay === '') {
			setSeriesCreateError(m.series_create_day_required, 'day');
			return;
		}

		// The occurrence set is computed BEFORE any write: a recurrence that
		// yields nothing (Mondays over a Tue–Sun range) must be REFUSED, not
		// reported as a silent success with a childless series behind it.
		let dates: string[] = [];
		if (seriesCreateGenerate) {
			dates =
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
		} else if (resume) {
			// Generation switched OFF after a partial run: the series already
			// exists, so there is nothing left to write — just close out rather
			// than creating a SECOND series for the same form. #138 review F1 —
			// this is the second operator-facing close-out, so it forgets the run
			// explicitly (`closeSeriesCreateForm` no longer does).
			clearSeriesCreateResumeForSelected();
			closeSeriesCreateForm();
			restoreSeriesCreateFocus();
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
			// Only the generated set knows the real bounds, so this applies when
			// generation is ON; with generation OFF there is nothing better than
			// the operator's own range. (On a RESUME run `dates` is only the tail,
			// but `seriesInput` is never sent then — the series already exists.)
			const startDate =
				seriesCreateGenerate && dates.length > 0 ? seriesCreateIsoDay(dates[0]) : seriesCreateFrom;
			const endDate =
				seriesCreateGenerate && dates.length > 0
					? seriesCreateIsoDay(dates[dates.length - 1])
					: seriesCreateUntil;

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
				// single occurrence followed. With generation on that is a stopped
				// run owing everything, and the record is the only thing standing
				// between a return visit and a duplicate series.
				if (seriesCreateGenerate) recordStop(seriesId, 0);
				return;
			}

			if (!seriesCreateGenerate) {
				closeSeriesCreateForm();
				// #132/T6 — the refresh discipline is UNIFORM across all three
				// creation kinds: a series-only create also re-reads the whole
				// agenda (`loadFullAgenda`), not just the panel's own lists — a
				// new series can change what `showEventCreate`/series pickers
				// elsewhere on the page offer. `keepSeasonManage` keeps the panel
				// the series was just made in.
				loadForSelected({ keepSeasonManage: true });
				if (panelSeasonId === seasonId) {
					refreshSeasonManageLists(cfg, panelSeasonId);
				}
				restoreSeriesCreateFocus();
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
		loadForSelected();
	}
</script>

{#if auth.status === 'authenticated'}
	{#if collectives.status === 'ready' && selected}
		<DeskSurface>
			<div class="mx-auto flex min-h-screen w-full max-w-md flex-col gap-2 px-4 py-6">
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
						<!-- #149 — [⚙] season-manage, [+ Season] and [+ Event] triggers
						     grouped into one admin toolbar (shared border, consistent
						     button sizing) so they read as one admin surface instead of
						     three loose buttons. Each control keeps its OWN pre-existing
						     rights gate (#132/T2-T4: showSeasonManageGear /
						     showSeasonCreate+!seasonCreateOpen / showEventCreate+
						     !eventCreateOpen) — this is a visual grouping only, not a
						     rights change. The toolbar itself only mounts when at least
						     one control would show, so a non-editor never sees an empty
						     frame. The panels/forms these open (season-manage-panel,
						     season-create-form, event-create-form) render below,
						     unchanged, outside the toolbar.
						     #149 review F2 — `w-fit`, NOT `self-start`: the parent
						     (`rounded-lg bg-paper p-4`) is a plain BLOCK container, so
						     `align-self` had nothing to act on and the frame silently
						     stretched the full card width. `w-fit` (= fit-content) makes
						     the border hug the buttons as intended, and still caps at the
						     available width, so `flex-wrap` — not overflow — is what
						     happens when the three no longer fit on one 375px line. -->
						{#if showSeasonManageGear || (showSeasonCreate && !seasonCreateOpen) || (showEventCreate && !eventCreateOpen)}
							<div
								data-testid="agenda-admin-toolbar"
								role="toolbar"
								aria-label={m.agenda_admin_toolbar_label()}
								tabindex="-1"
								class="mb-3 flex w-fit flex-wrap items-center gap-2 rounded-md border border-ink-4 p-1.5"
								onkeydown={handleAdminToolbarKeydown}
							>
								<!-- #149 review F3 — the gear wears the SAME outline as its two
								     siblings (`border border-ink text-ink`, same hover
								     inversion). Inside a shared frame a borderless lighter
								     glyph next to two outlined pills reads as an inconsistency,
								     not as a hierarchy; checklist item 4 asks for one uniform
								     control row, so the gear is a pill too. -->
								{#if showSeasonManageGear}
									<button
										type="button"
										data-testid="season-manage-gear"
										bind:this={seasonManageGearEl}
										aria-label={m.season_manage_gear_label()}
										tabindex={toolbarActiveTestid === 'season-manage-gear' ? 0 : -1}
										onfocus={() => (toolbarRoving = 'season-manage-gear')}
										class="flex min-h-11 min-w-11 items-center justify-center rounded-md border border-ink text-xs text-ink hover:bg-ink hover:text-paper"
										onclick={openSeasonManagePanel}
									>
										<span aria-hidden="true">⚙</span>
									</button>
								{/if}
								{#if showSeasonCreate && !seasonCreateOpen}
									<button
										type="button"
										data-testid="season-create"
										disabled={createEntryPointsBlocked}
										tabindex={toolbarActiveTestid === 'season-create' ? 0 : -1}
										onfocus={() => (toolbarRoving = 'season-create')}
										class="flex min-h-11 items-center rounded-md border border-ink px-3 py-1.5 text-xs tracking-wide text-ink uppercase hover:bg-ink hover:text-paper disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-ink"
										onclick={openSeasonCreateForm}
									>
										{m.season_create()}
									</button>
								{/if}
								{#if showEventCreate && !eventCreateOpen}
									<button
										type="button"
										data-testid="event-create"
										bind:this={eventCreateButtonEl}
										disabled={createEntryPointsBlocked}
										tabindex={toolbarActiveTestid === 'event-create' ? 0 : -1}
										onfocus={() => (toolbarRoving = 'event-create')}
										class="flex min-h-11 items-center rounded-md border border-ink px-3 py-1.5 text-xs tracking-wide text-ink uppercase hover:bg-ink hover:text-paper disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-ink"
										onclick={() => openEventCreateForm('agenda')}
									>
										{m.event_create()}
									</button>
								{/if}
							</div>
						{/if}
						{#if seasonManageOpen}
							<div
								data-testid="season-manage-panel"
								bind:this={seasonManagePanelEl}
								role="dialog"
								aria-label={m.season_manage_panel_label()}
								tabindex="-1"
								class="mb-3 flex flex-col gap-3 border border-ink-5 p-3"
								onkeydown={onSeasonManagePanelKeydown}
							>
								<div class="flex items-center justify-between">
									<h2 class="font-display text-lg text-ink">{m.season_manage_panel_label()}</h2>
									<button
										type="button"
										data-testid="season-manage-close"
										aria-label={m.season_manage_close()}
										disabled={seriesRunUnfinished}
										class="flex min-h-11 min-w-11 items-center justify-center text-ink-2 hover:text-ink disabled:opacity-50 disabled:hover:text-ink-2"
										onclick={closeSeasonManagePanel}
									>
										&times;
									</button>
								</div>

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
										<div class="flex items-center gap-2">
											<p data-testid="season-manage-name" class="font-display text-lg text-ink">
												{seasonManageName}
											</p>
											<button
												type="button"
												data-testid="season-edit-btn-name"
												aria-label={m.season_manage_edit_name_label()}
												disabled={seasonEditPending.name === true}
												class="flex min-h-11 min-w-11 items-center justify-center text-xs text-ink-3 hover:text-ink disabled:opacity-40"
												onclick={() => beginSeasonFieldEdit('name')}
											>
												<span aria-hidden="true">✎</span>
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
								     the aria-labels ride on the pencils only, so without it neither a
								     sighted nor a screen-reader user reading the two values side by
								     side can tell start from end — and an unset bound would render as
								     a bare, unexplained ✎. -->
								<div class="flex gap-4">
									<div>
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
											<div class="flex items-center gap-1">
												<!-- #151 — text-base, not text-xs: this value is REPLACED in place
												     by the date input above, which renders at the 16px control
												     default (#130), so at text-xs it jumped 12px -> 16px -> 12px
												     across an edit. Same for end_date below. -->
												<span data-testid="season-manage-start_date" class="text-base text-ink-2">
													{#if seasonManageStartDate}
														{formatSeasonDate(seasonManageStartDate)}
													{:else}
														{m.season_manage_date_unset()}
													{/if}
												</span>
												<button
													type="button"
													data-testid="season-edit-btn-start_date"
													aria-label={m.season_manage_edit_start_date_label()}
													disabled={seasonEditPending.start_date === true}
													class="flex min-h-11 min-w-11 items-center justify-center text-xs text-ink-3 hover:text-ink disabled:opacity-40"
													onclick={() => beginSeasonFieldEdit('start_date')}
												>
													<span aria-hidden="true">✎</span>
												</button>
											</div>
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
									<div>
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
											<div class="flex items-center gap-1">
												<span data-testid="season-manage-end_date" class="text-base text-ink-2">
													{#if seasonManageEndDate}
														{formatSeasonDate(seasonManageEndDate)}
													{:else}
														{m.season_manage_date_unset()}
													{/if}
												</span>
												<button
													type="button"
													data-testid="season-edit-btn-end_date"
													aria-label={m.season_manage_edit_end_date_label()}
													disabled={seasonEditPending.end_date === true}
													class="flex min-h-11 min-w-11 items-center justify-center text-xs text-ink-3 hover:text-ink disabled:opacity-40"
													onclick={() => beginSeasonFieldEdit('end_date')}
												>
													<span aria-hidden="true">✎</span>
												</button>
											</div>
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
										<Autocomplete
											items={seasonManageConductorOptions}
											onSelect={onSeasonManageConductorSelect}
											placeholder={m.season_conductor_placeholder()}
											label={m.season_conductor_label()}
											emptyLabel={m.season_conductor_no_matches()}
										/>
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
											     would be silently discarded (review F5). -->
											<input
												type="text"
												data-testid="series-create-name"
												bind:this={seriesCreateNameInput}
												aria-label={m.series_create_name_label()}
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
											<input
												type="text"
												data-testid="series-create-type"
												aria-label={m.series_create_type_label()}
												aria-invalid={seriesCreateInvalid('type')}
												aria-describedby={seriesCreateDescribedBy('type')}
												disabled={seriesCreateLocked}
												value={seriesCreateType}
												oninput={(e) => {
													seriesCreateType = (e.currentTarget as HTMLInputElement).value;
													clearSeriesCreateError();
												}}
												class="w-full border border-ink-5 bg-paper px-1.5 py-1 text-ink disabled:opacity-50"
											/>
											<input
												type="number"
												data-testid="series-create-duration"
												aria-label={m.series_create_duration_label()}
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
											<input
												type="text"
												data-testid="series-create-location"
												aria-label={m.series_create_location_label()}
												placeholder={m.series_create_location_placeholder()}
												disabled={seriesCreateLocked}
												value={seriesCreateLocation}
												oninput={(e) =>
													(seriesCreateLocation = (e.currentTarget as HTMLInputElement).value)}
												class="w-full border border-ink-5 bg-paper px-1.5 py-1 text-ink disabled:opacity-50"
											/>
											<textarea
												data-testid="series-create-description"
												aria-label={m.series_create_description_label()}
												placeholder={m.series_create_description_placeholder()}
												disabled={seriesCreateLocked}
												value={seriesCreateDescription}
												oninput={(e) =>
													(seriesCreateDescription = (
														e.currentTarget as HTMLTextAreaElement
													).value)}
												class="w-full border border-ink-5 bg-paper px-1.5 py-1 text-ink disabled:opacity-50"
											></textarea>

											<div class="flex gap-2">
												<select
													data-testid="series-create-repeat"
													aria-label={m.series_create_repeat_label()}
													disabled={seriesCreateLocked}
													value={seriesCreateRepeat}
													onchange={(e) =>
														(seriesCreateRepeat = (e.currentTarget as HTMLSelectElement)
															.value as RepeatPattern)}
													class="min-w-0 flex-1 border border-ink-5 bg-paper px-1.5 py-1 text-ink disabled:opacity-50"
												>
													<option value="weekly">{m.series_create_repeat_weekly()}</option>
													<option value="biweekly">{m.series_create_repeat_biweekly()}</option>
													<option value="daily">{m.series_create_repeat_daily()}</option>
												</select>
												<!-- Daily ignores the day of week entirely (recurrence.ts) — an
												     inert control must not be shown, let alone demanded. -->
												{#if seriesCreateDayApplies}
													<select
														data-testid="series-create-day"
														aria-label={m.series_create_day_label()}
														aria-invalid={seriesCreateInvalid('day')}
														aria-describedby={seriesCreateDescribedBy('day')}
														disabled={seriesCreateLocked}
														value={seriesCreateDay}
														onchange={(e) => {
															seriesCreateDay = (e.currentTarget as HTMLSelectElement).value;
															clearSeriesCreateError();
														}}
														class="min-w-0 flex-1 border border-ink-5 bg-paper px-1.5 py-1 text-ink disabled:opacity-50"
													>
														<option value="">{m.series_create_day_placeholder()}</option>
														<option value="0">{m.series_create_day_0()}</option>
														<option value="1">{m.series_create_day_1()}</option>
														<option value="2">{m.series_create_day_2()}</option>
														<option value="3">{m.series_create_day_3()}</option>
														<option value="4">{m.series_create_day_4()}</option>
														<option value="5">{m.series_create_day_5()}</option>
														<option value="6">{m.series_create_day_6()}</option>
													</select>
												{/if}
											</div>

											<input
												type="time"
												data-testid="series-create-time"
												aria-label={m.series_create_time_label()}
												aria-invalid={seriesCreateInvalid('time')}
												aria-describedby={seriesCreateDescribedBy('time')}
												disabled={seriesCreateLocked}
												value={seriesCreateTime}
												oninput={(e) => {
													seriesCreateTime = (e.currentTarget as HTMLInputElement).value;
													clearSeriesCreateError();
												}}
												class="w-full border border-ink-5 bg-paper px-1.5 py-1 text-ink disabled:opacity-50"
											/>

											<div class="flex gap-2">
												<input
													type="date"
													data-testid="series-create-from"
													aria-label={m.series_create_from_label()}
													aria-invalid={seriesCreateInvalid('from')}
													aria-describedby={seriesCreateDescribedBy('from')}
													disabled={seriesCreateLocked}
													value={seriesCreateFrom}
													oninput={(e) => {
														seriesCreateFrom = (e.currentTarget as HTMLInputElement).value;
														clearSeriesCreateError();
													}}
													class="min-w-0 flex-1 border border-ink-5 bg-paper px-1.5 py-1 text-ink disabled:opacity-50"
												/>
												<input
													type="date"
													data-testid="series-create-until"
													aria-label={m.series_create_until_label()}
													aria-invalid={seriesCreateInvalid('until')}
													aria-describedby={seriesCreateDescribedBy('until')}
													disabled={seriesCreateLocked}
													value={seriesCreateUntil}
													oninput={(e) => {
														seriesCreateUntil = (e.currentTarget as HTMLInputElement).value;
														clearSeriesCreateError();
													}}
													class="min-w-0 flex-1 border border-ink-5 bg-paper px-1.5 py-1 text-ink disabled:opacity-50"
												/>
											</div>

											<label class="flex min-h-11 items-center gap-1.5 text-xs text-ink">
												<input
													type="checkbox"
													data-testid="series-create-generate"
													checked={seriesCreateGenerate}
													onchange={(e) =>
														(seriesCreateGenerate = (e.currentTarget as HTMLInputElement)
															.checked)}
												/>
												{m.series_create_generate_label()}
											</label>

											<div class="flex items-center gap-2">
												<input
													type="date"
													data-testid="series-create-skip-date"
													aria-label={m.series_create_skip_date_label()}
													disabled={seriesCreateLocked}
													value={seriesCreateSkipDateInput}
													oninput={(e) =>
														(seriesCreateSkipDateInput = (
															e.currentTarget as HTMLInputElement
														).value)}
													class="min-w-0 flex-1 border border-ink-5 bg-paper px-1.5 py-1 text-ink disabled:opacity-50"
												/>
												<button
													type="button"
													data-testid="series-create-skip-add"
													disabled={seriesCreateLocked}
													class="flex min-h-11 min-w-11 items-center justify-center text-xs text-ink underline disabled:opacity-50"
													onclick={addSeriesCreateSkipDate}
												>
													{m.series_create_skip_add()}
												</button>
											</div>
											{#if seriesCreateSkipDates.length > 0}
												<ul class="flex flex-wrap gap-1.5">
													{#each seriesCreateSkipDates as date (date)}
														<!-- #132/T6 review F2 — icon-only ×, 44x44 (see the conductor chip). -->
														<li
															data-testid="series-create-skip-{date}"
															class="flex items-center gap-1 border border-ink-5 px-1.5 text-xs text-ink"
														>
															{date}
															<button
																type="button"
																data-testid="series-create-skip-remove-{date}"
																aria-label={m.series_create_skip_remove({ date })}
																disabled={seriesCreateLocked}
																class="flex min-h-11 min-w-11 items-center justify-center text-ink-2 hover:text-ink disabled:opacity-50"
																onclick={() => removeSeriesCreateSkipDate(date)}
															>
																&times;
															</button>
														</li>
													{/each}
												</ul>
											{/if}

											{#if seriesCreatePreviewRows !== null}
												<div data-testid="series-create-preview" class="text-xs text-ink-2">
													<p class="tracking-wide uppercase">
														{m.series_create_preview_label()}
													</p>
													<!-- The count says up front what submit will do; a daily series
													     across a season is ~90 rows, so the list scrolls INSIDE the
													     form rather than pushing submit/cancel off a phone screen.
													     Suppressed once a stopped run is resumable: submit would then
													     create only the remainder, and the resume notice below is the
													     number that applies. -->
													{#if !seriesCreateResume}
														<p data-testid="series-create-preview-count" class="text-ink">
															{seriesCreatePreviewRows.length === 1
																? m.series_create_preview_count_one()
																: m.series_create_preview_count_other({
																		count: seriesCreatePreviewRows.length
																	})}
														</p>
													{/if}
													<!-- Review F3 — the ROWS come from `seriesCreatePreviewRows`, which
													     is the REMAINDER while a stopped run is resumable. Listing the
													     full recomputed set there contradicted the resume notice right
													     under it: three dates shown, one event actually created. -->
													<div class="max-h-32 overflow-y-auto">
														{#each seriesCreatePreviewRows as date (date)}
															<p data-testid="series-create-preview-date-{seriesCreateIsoDay(date)}">
																{seriesCreateIsoDay(date)}
															</p>
														{/each}
													</div>
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
													disabled={seriesCreateSubmitting}
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
										</div>
									{/each}
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
										<div data-testid="season-manage-event-{event.id}" class="mt-1 text-xs text-ink">
											{event.name}
										</div>
									{/each}
								</div>
							</div>
						{/if}
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
									<Autocomplete
										items={seasonConductorOptions}
										onSelect={onSeasonConductorSelect}
										placeholder={m.season_conductor_placeholder()}
										label={m.season_conductor_label()}
										emptyLabel={m.season_conductor_no_matches()}
									/>
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
								<div data-testid="event-create-type-field">
									<Autocomplete
										items={eventCreateTypeOptions.map((t) => ({ id: t, label: t }))}
										onSelect={handleEventCreateTypeSelect}
										onQueryChange={handleEventCreateTypeQuery}
										errorId={eventCreateDescribedBy('type')}
										allowFreeText={true}
										placeholder={m.event_create_type_placeholder()}
										label={m.event_create_type_label()}
										emptyLabel={m.event_create_type_no_matches()}
									/>
								</div>
								<!-- The committed type, echoed because the combobox blanks its own
								     input on commit. Hidden the moment the viewer types again
								     (review 2nd-pass F1): while the box says 'concert' this line
								     saying 'rehearsal' would be showing the value the write no
								     longer uses. -->
								{#if eventCreateType && !eventCreateTypeQuery.trim()}
									<p data-testid="event-create-type-value" class="text-xs text-ink-2">
										{eventCreateType}
									</p>
								{/if}
								
								<select
									data-testid="event-create-season"
									aria-label={m.event_create_season_label()}
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
								
								<select
									data-testid="event-create-series"
									aria-label={m.event_create_series_label()}
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
								
								<!-- #132/T4 review F4 — the inherited default is a PLACEHOLDER, and
								     a blank one is not a placeholder at all: `default_location` is
								     optional on event_series, and `getSeriesDefaults` reports an
								     absent property as ''. `||` (not the ternary) keeps the static
								     hint whenever the series has nothing to lend. -->
								<input
									type="text"
									data-testid="event-create-name"
									bind:this={eventCreateNameInput}
									aria-label={m.event_create_name_label()}
									aria-invalid={eventCreateInvalid('name')}
									aria-describedby={eventCreateDescribedBy('name')}
									placeholder={eventCreateSeriesDefaults?.name ||
										m.event_create_name_placeholder()}
									value={eventCreateName}
									oninput={(e) => {
										eventCreateName = (e.currentTarget as HTMLInputElement).value;
										clearEventCreateError();
									}}
									class="w-full border border-ink-5 bg-paper px-1.5 py-1 text-ink"
								/>

								<input
									type="datetime-local"
									data-testid="event-create-datetime"
									aria-label={m.event_create_datetime_label()}
									aria-invalid={eventCreateInvalid('datetime')}
									aria-describedby={eventCreateDescribedBy('datetime')}
									value={eventCreateDatetime}
									oninput={(e) => {
										eventCreateDatetime = (e.currentTarget as HTMLInputElement).value;
										clearEventCreateError();
									}}
									class="w-full border border-ink-5 bg-paper px-1.5 py-1 text-ink"
								/>
								
								<div class="flex gap-2">
									<input
										type="number"
										data-testid="event-create-duration"
										aria-label={m.event_create_duration_label()}
										placeholder={eventCreateSeriesDefaults &&
										eventCreateSeriesDefaults.durationMinutes !== null
											? String(eventCreateSeriesDefaults.durationMinutes)
											: m.event_create_duration_placeholder()}
										value={eventCreateDuration}
										oninput={(e) =>
											(eventCreateDuration = (e.currentTarget as HTMLInputElement).value)}
										class="min-w-0 flex-1 border border-ink-5 bg-paper px-1.5 py-1 text-ink"
									/>
									<!-- #132/T4 review F5 — a visible hint, not an aria-label alone:
									     this box sits beside a duration box that HAS one, so a sighted
									     viewer otherwise reads one labelled number field next to an
									     anonymous one. -->
									<input
										type="number"
										data-testid="event-create-capacity"
										aria-label={m.event_create_capacity_label()}
										placeholder={m.event_create_capacity_placeholder()}
										value={eventCreateCapacity}
										oninput={(e) =>
											(eventCreateCapacity = (e.currentTarget as HTMLInputElement).value)}
										class="min-w-0 flex-1 border border-ink-5 bg-paper px-1.5 py-1 text-ink"
									/>
								</div>
								
								<input
									type="text"
									data-testid="event-create-location"
									aria-label={m.event_create_location_label()}
									placeholder={eventCreateSeriesDefaults?.defaultLocation ||
										m.event_create_location_placeholder()}
									value={eventCreateLocation}
									oninput={(e) =>
										(eventCreateLocation = (e.currentTarget as HTMLInputElement).value)}
									class="w-full border border-ink-5 bg-paper px-1.5 py-1 text-ink"
								/>
								
								<textarea
									data-testid="event-create-description"
									aria-label={m.event_create_description_label()}
									placeholder={eventCreateSeriesDefaults?.defaultDescription ||
										m.event_create_description_placeholder()}
									value={eventCreateDescription}
									oninput={(e) =>
										(eventCreateDescription = (e.currentTarget as HTMLTextAreaElement).value)}
									class="w-full border border-ink-5 bg-paper px-1.5 py-1 text-ink"
								></textarea>
								
								<div data-testid="event-create-conductors-field">
									<Autocomplete
										items={eventCreateConductorOptions}
										onSelect={handleEventCreateConductorSelect}
										placeholder={m.event_create_conductor_placeholder()}
										label={m.event_create_conductor_label()}
										emptyLabel={m.event_create_conductor_no_matches()}
									/>
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
						<AgendaList
							items={agendaItems}
							loading={agendaLoading}
							{rsvpByEventId}
							membership={gatedMembership}
							{pendingEventIds}
							{failedEventIds}
							{recentItems}
							{conductorEventIds}
							{myAttendanceByEventId}
							{worksByEventId}
							{worksManage}
							{attendancePanel}
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
{:else if auth.status === 'anonymous'}
	<main class="flex min-h-screen flex-col items-center justify-center gap-4 bg-paper text-ink">
		<p class="text-sm text-ink" data-testid="auth-status">{m.agenda_signed_out()}</p>
		<a class="text-sm underline" href="/auth/login">{m.agenda_sign_in()}</a>
	</main>
{/if}
