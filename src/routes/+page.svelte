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
	import type { WorkRow } from '$lib/repertoire/types';
	import { m } from '$lib/paraglide/messages.js';
	import DeskSurface from '$lib/components/DeskSurface.svelte';
	import AgendaList from '$lib/components/agenda/AgendaList.svelte';
	import AttendanceSurface from '$lib/components/attendance/AttendanceSurface.svelte';
	import SeasonSummary from '$lib/components/attendance/SeasonSummary.svelte';

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
			.then(({ upcoming, recent, seasonId, seasonConductors }) => {
				if (thisRequest !== requestId) return; // superseded by a newer selection
				agendaItems = upcoming;
				agendaLoading = false;
				recentItems = recent;

				// #90 TR.2 — the Works element on every row. Resolved HERE (not in a
				// parallel branch above) because it needs the event ids and the
				// current season id the agenda load just produced. Supplementary:
				// a rejection leaves rows work-free, it never fails the agenda.
				const worksCfg = { db: current.db, token: getToken() ?? '' };
				const eventIds = [...upcoming, ...recent].map((item) => item.id);
				loadWorksByEventId(worksCfg, eventIds, seasonId)
					.then((byEvent) => {
						if (thisRequest !== requestId) return;
						worksByEventId = byEvent;
					})
					.catch(() => {
						if (thisRequest !== requestId) return;
						worksByEventId = {};
					});
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
						{#if attendanceItem}
							<AttendanceSurface
								item={attendanceItem}
								members={attendanceRoster}
								attendanceByMemberId={attendanceMap}
								rsvpByMemberId={attendanceRsvpMap}
								loading={attendanceLoading}
								error={attendanceError}
								pendingMemberIds={attendancePendingMemberIds}
								failedMemberIds={attendanceFailedMemberIds}
								ontoggle={handleAttendanceToggle}
								onclose={closeAttendancePanel}
							/>
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
