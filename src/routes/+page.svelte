<script lang="ts">
	import { authStore } from '$lib/auth/session';
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
		updateRepertoireStatus
	} from '$lib/repertoire/repertoireActions';
	import { listWorks, listAllEditions, type Edition, type Work } from '$lib/library/libraryData';
	import { ADD_PROGRAMME_KEY, ADD_WORK_KEY } from '$lib/components/agenda/RepertoireElement.svelte';
	import { m } from '$lib/paraglide/messages.js';
	import DeskSurface from '$lib/components/DeskSurface.svelte';
	import AgendaList from '$lib/components/agenda/AgendaList.svelte';
	import SeasonSummary from '$lib/components/attendance/SeasonSummary.svelte';
	import type { AttendancePanel } from '$lib/attendance/types';

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
	let eventManageRights = $state<Record<string, ManageRightsState>>({});
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

	// Load the selected collective's upcoming agenda; reload on every collective
	// switch. `requestId` guards against a slow earlier fetch clobbering a later
	// one if the user switches collectives before the first load resolves — the
	// same guard covers a stale rejection (M2 fix below), not just a stale resolve.
	let requestId = 0;
	function loadForSelected() {
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
			attendanceFailedByEvent = new Map();
			myAttendance = [];
			seasonSummaryExpanded = false;
			seasonMemberRates = [];
			seasonRatesLoaded = false;
			seasonRatesLoading = false;
			seasonRatesError = false;
			return;
		}
		const thisRequest = ++requestId;
		// A fresh collective selection closes any open attendance panel — its data
		// (roster + attendance + rsvp) belongs to the PREVIOUS collective.
		closeAttendancePanel();
		agendaLoading = true;
		agendaError = false;
		// Fresh selection -> membership is unresolved again (not carried over as a
		// stale member/non-member), and no event has a failed write yet.
		memberId = null;
		membership = 'loading';
		failedEventIds = new Set();
		worksByEventId = {};
		pdfError = false;
		resetManagement();
		rosterCache = null;
		attendanceFailedByEvent = new Map();
		myAttendance = [];
		seasonSummaryExpanded = false;
		seasonMemberRates = [];
		seasonRatesLoaded = false;
		seasonRatesLoading = false;
		seasonRatesError = false;

		const personId = current.personId;

		// #83 fix (F1+F2) — ONE combined load replaces the old loadAgenda() +
		// loadRecentEvents() pair. Seasons and rehearsals are fetched once;
		// conductor data rides on the already-fetched props (no separate reads).
		loadFullAgenda()
			.then(({ upcoming, recent, seasonId, seasonConductors, seasonOwners, seasonEditors }) => {
				if (thisRequest !== requestId) return; // superseded by a newer selection
				agendaItems = upcoming;
				agendaLoading = false;
				recentItems = recent;

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
					seasonId === null ? 'not-editor' : manageRightsFrom(seasonOwners, seasonEditors, personId);
				eventManageRights = Object.fromEntries(
					events.map((item) => [item.id, manageRightsFrom(item.owners, item.editors, personId)])
				);
				loadWorksAndManagement(worksCfg, eventIds, seasonId, thisRequest);
				// Conductor event IDs: pure computation on already-loaded data (no IO).
				const ids = computeConductorEventIds(personId, seasonConductors, recent);
				conductorEventIds = ids;
				// F3 fix — wire isConductor from the broader signal: a season conductor
				// IS a conductor even before any past events exist this season (the
				// per-event Set gates rows; this store is the coarser "is a conductor
				// at all" signal for TA.3).
				isConductor.set(
					ids.size > 0 || seasonConductors.includes(personId)
						? 'conductor'
						: 'not-conductor'
				);
			})
			.catch(() => {
				// M2 fix: without this catch, a rejected load left agendaLoading
				// stuck at true forever — permanent skeleton, no error, no recovery.
				if (thisRequest !== requestId) return;
				agendaLoading = false;
				agendaError = true;
				recentItems = [];
				conductorEventIds = new Set();
				worksByEventId = {};
				resetManagement();
				resetConductor();
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
		eventManageRights = {};
		seasonRepertoire = [];
		libraryWorks = [];
		libraryEditions = [];
		managePendingKeys = new Set();
		manageError = false;
	}

	type ManageCfg = { db: string; token: string };

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

		loadWorksByEventId(cfg, eventIds, seasonId, fetch, {
			includeInactive: seasonManageRights === 'editor'
		})
			.then((byEvent) => {
				if (thisRequest !== requestId) return;
				worksByEventId = byEvent;
			})
			.catch(() => {
				if (thisRequest !== requestId) return;
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
		loadWorksByEventId(cfg, eventIds, seasonId, fetch, {
			includeInactive: seasonManageRights === 'editor'
		})
			.then((byEvent) => {
				if (thisRequest !== requestId) return;
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
		const cacheValid =
			rosterCache &&
			rosterCache.db === selected.db &&
			Date.now() - rosterCache.fetchedAt < ROSTER_CACHE_TTL_MS;
		const rosterPromise = cacheValid
			? Promise.resolve(rosterCache!.roster)
			: loadRoster(cfg).then((roster) => {
					if (selected) rosterCache = { db: selected.db, roster, fetchedAt: Date.now() };
					return roster;
				});

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
		attendanceRequestId++; // invalidate any in-flight load
		attendanceItem = null;
		attendanceLoading = false;
		attendanceError = false;
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

	$effect(() => {
		loadForSelected();
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
							<a class="underline" href="/collectives">Switch collective</a>
						{/if}
					</nav>
				</header>
				<div class="rounded-lg bg-paper p-4">
					{#if agendaError}
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
							<p data-testid="repertoire-pdf-error" class="pt-2 text-xs text-red" role="alert">
								{m.repertoire_pdf_error()}
							</p>
						{/if}
						<!-- #91 — a management write that failed. Its optimistic change is
						     already rolled back by the time this renders, so without the
						     message the value would just snap back and read as a bug. -->
						{#if manageError}
							<p data-testid="repertoire-manage-error" class="pt-2 text-xs text-red" role="alert">
								{m.repertoire_manage_error()}
							</p>
						{/if}
					{/if}
				</div>
			</div>
		</DeskSurface>
	{:else}
		<main class="flex min-h-screen flex-col items-center justify-center gap-4 bg-paper text-ink">
			<p class="text-sm text-ink" data-testid="auth-status">Signed in</p>
			{#if collectives.status === 'none'}
				<a class="text-sm underline" href="/collectives">No collectives yet</a>
			{:else if collectives.status === 'error'}
				<a class="text-sm underline" href="/collectives">Couldn't load collectives — retry</a>
			{:else}
				<p class="text-sm text-ink">Loading collectives…</p>
			{/if}
		</main>
	{/if}
{:else if auth.status === 'anonymous'}
	<main class="flex min-h-screen flex-col items-center justify-center gap-4 bg-paper text-ink">
		<p class="text-sm text-ink" data-testid="auth-status">Signed out</p>
		<a class="text-sm underline" href="/auth/login">Sign in</a>
	</main>
{/if}
