<script lang="ts">
	// #101 TE.1 — the event detail page. Reads the route's `id` param off
	// `$app/state`'s `page` (SvelteKit 2.12+'s reactive replacement for
	// `$app/stores`), loads the SELECTED collective's event via
	// `loadEventDetail` (eventDetail.ts), and renders the header. Same
	// load-on-effect / requestId-guard shape as roster/+page.svelte and the
	// agenda's own `loadForSelected` — a stale (superseded) load can never
	// clobber a newer collective/route-param combination.
	//
	// No `getToken()`-missing gate (unlike roster.svelte's protected-route
	// check): this mirrors the agenda +page.svelte's own cfg-building convention
	// (`token: getToken() ?? ''`, see routes/+page.svelte:271) rather than
	// roster's stricter one — the token is threaded straight through to Entu,
	// which is the actual authority on whether it's valid.
	import { tick } from 'svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { m } from '$lib/paraglide/messages.js';
	// #251 — the narrative date line's locale source is the APP language, not
	// the device's. Same specifier LanguageSelector.svelte / routes/+page.svelte
	// already import from.
	import { getLocale } from '$lib/paraglide/runtime.js';
	import { getToken } from '$lib/auth/storage';
	import { selectedCollectiveStore } from '$lib/collectives/store';
	import {
		loadEventDetail,
		listEventLocations,
		EventDetailLoadError,
		type EventDetail
	} from '$lib/events/eventDetail';
	// #220 — the AM/PM preference reaches every displayed clock time through
	// this ONE shared formatter (timeFormat.no-hardcoded-render.spec.ts pins
	// that no other file may keep its own 24h-rendering Intl formatter).
	import { tallinnHHMM, formatTime, timeFormatStore } from '$lib/preferences/timeFormat';
	// #194/#202 — the type-label map is SHARED with the agenda's per-row badge
	// (was inline here only, #101 review F3; a second inline copy is exactly
	// the drift class the WorkRow/AttendanceBadge cleanups already paid for).
	// #199 — the canonical select options, SAME source as the create forms.
	import { eventTypeLabel, CANONICAL_EVENT_TYPES } from '$lib/events/eventTypeLabels';
	// #211 — the SAME color scheme the agenda badges consume.
	import { eventTypeBadgeClass } from '$lib/events/eventTypeStyles';
	import type { EntuCfg } from '$lib/seasons/entuSeasons';
	// #203 — the delete button's write call. Imported from seasonManage
	// directly (NOT re-exported by this page's other imports from that module)
	// so the event-delete spec's PARTIAL `vi.mock('$lib/seasons/seasonManage', …)`
	// (which replaces only `deleteEvent` and keeps the rest real) lands cleanly.
	import { deleteEvent } from '$lib/seasons/seasonManage';
	// The error discriminators live in their OWN module, not in seasonManage —
	// see deleteErrors.ts's header: importing them from seasonManage would make
	// them `undefined` under the spec's wholesale-replacement mock shape.
	import { isDeleteForbidden, isEventCascadePartial } from '$lib/seasons/deleteErrors';
	import {
		findMyMemberId,
		listMyRsvps,
		rsvpsByEventId,
		type MyRsvp,
		type RsvpStatus
	} from '$lib/rsvp/rsvpData';
	import { createRsvpChangeQueue, type RsvpEntry } from '$lib/rsvp/rsvpChangeQueue';
	import {
		listAllRsvpsForEvent,
		listAttendance,
		attendanceByMemberId,
		type AttendanceStatus,
		type EventAttendance
	} from '$lib/attendance/attendanceData';
	import { createAttendanceChangeQueue } from '$lib/attendance/attendanceChangeQueue';
	import { loadRoster, listActiveMembers, type RosterRow } from '$lib/roster/rosterData';
	import type { AgendaItem } from '$lib/agenda/types';
	// #103 TE.3 — the works pipeline: the SAME producer the agenda uses
	// (workRows.ts joins repertoireData's resolved items against the library
	// lookups), plus the write layer (repertoireActions) and its picker source
	// (repertoireData.listRepertoireItems, library.listWorks/-Editions).
	import { loadWorksByEventId } from '$lib/repertoire/workRows';
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
	import type { ManageRightsState, PickerOption, RepertoireStatus, WorkRow } from '$lib/repertoire/types';
	import { signFileUrl } from '$lib/repertoire/fileUrls';
	import { workLabel } from '$lib/repertoire/workLabel';
	import RsvpControl from '$lib/components/agenda/RsvpControl.svelte';
	import RepertoireElement, {
		ADD_PROGRAMME_KEY,
		ADD_WORK_KEY
	} from '$lib/components/agenda/RepertoireElement.svelte';
	import AttendanceSurface from '$lib/components/attendance/AttendanceSurface.svelte';
	// #103 review F3 — the badge and the conductor's button are the AGENDA's, not
	// lookalikes: both surfaces render the same extracted components, so the dot,
	// the data-status, the aria-label shape and the chrome cannot drift again.
	import AttendanceBadge from '$lib/components/attendance/AttendanceBadge.svelte';
	import TakeAttendanceButton from '$lib/components/attendance/TakeAttendanceButton.svelte';
	// #104 TE.4 — inline event editing: the write half (updateEventField) plus
	// this page's own optimistic-and-reconcile wiring, same posture as the
	// rsvp/attendance/repertoire queues above (per-tap immediate writes, no
	// "save all"). See eventFieldEdit.ts for the replace-semantics contract.
	import { updateEventField, type EditableEventField } from '$lib/events/eventFieldEdit';
	// #107 review F2 — the detail page is a primary member surface (reachable
	// from every agenda row), and it was the one load surface the first pass
	// missed: a 401 landed in 'load-error', offering a Retry against a token that
	// had already been deleted from localStorage.
	import { isAuthExpiredError } from '$lib/entu/request';
	import SessionExpiredNotice from '$lib/components/auth/SessionExpiredNotice.svelte';
	import TimeSelect from '$lib/components/TimeSelect.svelte';

	const selected = $derived($selectedCollectiveStore);
	const eventId = $derived(page.params.id ?? '');

	// 'not-available' is a genuine 5th state, NOT a flavour of 'load-error':
	// switching collectives with a detail page open refetches the SAME id against
	// the newly selected db, where it does not exist (403/404). Offering Retry
	// there is offering an action that can never succeed — this state offers the
	// back link instead (#101 review fix F5).
	type Status =
		| 'loading'
		| 'no-collective'
		| 'load-error'
		| 'not-available'
		| 'session-expired'
		| 'ready';

	// Non-reactive generation guard — same pattern as roster/+page.svelte's
	// `generation` (never `$state`, so bumping it doesn't retrigger the effect).
	let generation = 0;

	// #102 review round 2 (F1) — the load `generation` each in-flight rsvp write
	// was STARTED under, keyed by event id (the queue allows at most one live
	// write per event, so the key is exact). Non-reactive, and deliberately NOT
	// cleared by `resetRsvpState`: its entries describe writes that are still
	// running against the PREVIOUS load, which is exactly what has to be
	// recognised when they settle. Entries are dropped in reconcile/revert, i.e.
	// whichever way the write ends.
	const writeGenerations = new Map<string, number>();

	/**
	 * Does a queue callback for `evId` still describe what is on screen? Two
	 * things can have moved since the write started:
	 *   • the route param — /event/ev1 → /event/ev2 reuses this component (see
	 *     the `$effect` below), so the event id has to be checked;
	 *   • the selected collective — the id is UNCHANGED there, so only the
	 *     generation distinguishes an ev1-in-polyphony write from the ev1 now
	 *     loaded from another db (whose rsvp ids live in a different database).
	 * Both are covered by comparing the write's start generation, which
	 * `loadForSelected` bumps for either; the id check is kept as the direct,
	 * readable statement of the per-event contract.
	 */
	function isCurrentWrite(evId: string): boolean {
		return (
			detail !== null && evId === detail.id && writeGenerations.get(evId) === generation
		);
	}

	let status = $state<Status>('loading');
	let detail = $state<EventDetail | null>(null);

	// #102 TE.2 — the RSVP control's own state: the viewer's active member id
	// (gates the control itself, same 'loading'/'member'/'non-member' tri-state
	// the agenda uses — a FAILED lookup must never be asserted as non-member),
	// her existing rsvp on THIS event (seeds the control's pressed state), and
	// the per-write pending/failed flags RsvpControl expects.
	let memberId = $state<string | null>(null);
	let membership = $state<'loading' | 'member' | 'non-member'>('loading');
	let myRsvp = $state<RsvpEntry | null>(null);
	let rsvpPending = $state(false);
	let rsvpFailed = $state(false);

	// #102 TE.2 — the rights-gated tally (owner OR editor, see `canSeeTally`
	// below), per-status counts from the domain
	// rsvp read (listAllRsvpsForEvent). null until loaded (or never loaded, for
	// a non-editor) — the template gates BOTH the tally and the capacity line on
	// `tally !== null`, not on `isEditor` alone, so neither surface ever renders
	// its zero-filled placeholder ahead of the real counts (see page.spec.ts:
	// every tally/capacity assertion follows a waitFor on the SAME element).
	let tally = $state<{ going: number; not_going: number; maybe: number; late: number } | null>(
		null
	);
	// #102 review round 2 (F2) — a FAILED tally read is not "no counts to show".
	// Without this the `isEditor && tally` gate rendered a conductor exactly the
	// plain-member view on a 500/offline read, so she read "nobody answered / I
	// have no rights" instead of "the counts failed to load". Same rule the rest
	// of the rights code states out loud (repertoireActions.resolveManageRights:
	// absence IS the clean negative, a fetch failure is NOT) and the same
	// error+retry treatment this page already gives the event read.
	let tallyError = $state(false);

	// ── #203 — delete state ────────────────────────────────────────────────────
	// Same two-step confirm shape as the agenda's #197 season-manage delete rows:
	// `deleteArmed` swaps the idle × for confirm/cancel (writes NOTHING),
	// `deletePending` disables both buttons for the one write in flight, and
	// `deleteError` — set only on a REJECTED confirm, never reset by arming/
	// cancelling on its own attempt — carries which flavour of failure to show.
	// Unlike the season-manage panel's per-row map, this page has exactly ONE
	// deletable entity (the event it is standing on), so plain scalars suffice.
	let deleteArmed = $state(false);
	let deletePending = $state(false);
	let deleteError = $state<{
		reason: 'forbidden' | 'partial' | 'generic';
		deleted?: number;
		total?: number;
	} | null>(null);

	// ── #103 TE.3 — Works section state ───────────────────────────────────────
	// The event's parent season id and the season's management rights — BOTH
	// carried by `loadEventDetail` itself (`seasonId` off the event's `_parent`,
	// the rights off the season read it already makes for the conductor list) —
	// plus the resolved works for THIS event (program_items, else the season's
	// repertoire — TR.2's hierarchy, run through the same producer the agenda
	// uses).
	//
	// Review F1/F2/F3 — this used to be a three-deep serial waterfall on top of
	// the detail load: loadEventSeasonId (a SECOND GET of the event, for a
	// `_parent` the detail read already had) → resolveManageRights (a SECOND GET
	// of the season) → loadWorksByEventId, each awaiting the last because
	// `includeInactive` depended on the rights answer. Both extra reads are gone:
	// rights are pure computation on data already in hand (#91 review F1's rule),
	// so the works load fires immediately — and `manageRightsFrom` has no 'error'
	// state, so a rights blip can no longer silently demote a season editor to
	// read-only with the retired/dropped rows filtered out.
	let seasonId = $state<string | null>(null);
	let seasonManageRights = $state<ManageRightsState>('not-editor');
	let workRows = $state<WorkRow[]>([]);
	// Management picker sources — only ever fetched for a rights-holder (season
	// OR event editor), same economy as the agenda's loadManagePickers.
	let libraryWorks = $state<Work[]>([]);
	let libraryEditions = $state<Edition[]>([]);
	let seasonRepertoire = $state<RepertoireItem[]>([]);
	let managePendingKeys = $state<Set<string>>(new Set());

	// ── #103 TE.3 — Attendance section state ──────────────────────────────────
	// Domain-visible (attendance is `_sharing: domain` at create time, #82-style
	// widen) — loaded unconditionally for a PAST event, never rights-gated. Feeds
	// both the viewer's own badge and the per-status tally.
	let attendanceMap = $state<Record<string, { attendanceId: string; status: AttendanceStatus }>>(
		{}
	);
	// The conductor's inline "Take attendance" panel — one event on this page, so
	// a plain boolean (not the agenda's per-event `attendanceItem`) is enough.
	let attendancePanelOpen = $state(false);
	let attendancePanelLoading = $state(false);
	let attendancePanelError = $state(false);
	let attendanceRoster = $state<RosterRow[]>([]);
	let attendanceRsvpMap = $state<Record<string, { rsvpId: string; status: string }>>({});
	// #15-shaped guard, per member id (attendanceChangeQueue.ts doc).
	let attendancePendingMemberIds = $state<Set<string>>(new Set());
	let attendanceFailedMemberIds = $state<Set<string>>(new Set());

	/**
	 * The ONE rights predicate this page owns — `manageRightsFrom`, the app's
	 * single owner-OR-editor rule (repertoireActions.ts; ownership subsumes
	 * editing), run over the already-loaded detail. Never a fetch of its own:
	 * rights props live in the private bucket, so a non-granted reader's
	 * `ownerIds`/`editorIds` are simply [] (see eventDetail.ts).
	 *
	 * #102 review fixes F1+F5: this used to be `editorIds.includes(...)` written
	 * TWICE (the derived below and the tally-fetch gate in `loadForSelected`).
	 * `_owner` was missing from both, so an owner-only conductor got the agenda's
	 * programme controls for this event yet no tally here — the two surfaces
	 * disagreed about who is an editor of the SAME entity.
	 */
	function canSeeTally(d: EventDetail, personId: string): boolean {
		return manageRightsFrom(d.ownerIds, d.editorIds, personId) === 'editor';
	}

	const isEditor = $derived(
		detail !== null && selected !== null && canSeeTally(detail, selected.personId)
	);

	async function loadForSelected(): Promise<void> {
		const current = selected;
		const id = eventId;
		const g = ++generation;
		if (!current || !id) {
			status = 'no-collective';
			detail = null;
			resetRsvpState();
			resetComposeState();
			resetDeleteState();
			return;
		}
		status = 'loading';
		detail = null;
		resetRsvpState();
		resetComposeState();
		resetDeleteState();
		try {
			const cfg = { db: current.db, token: getToken() ?? '' };
			const loaded = await loadEventDetail(cfg, id);
			if (g !== generation) return; // superseded by a newer selection/param
			detail = loaded;
			status = 'ready';
			loadRsvpControl(cfg, current.personId, id, g);
			if (canSeeTally(loaded, current.personId)) {
				// #255 (D) stale-closure pin — pastness CAPTURED here, at request
				// time, off the just-resolved `loaded` detail, never read live
				// inside loadTally's own async continuation.
				loadTally(cfg, id, g, isPastDetail(loaded));
			}
			loadComposeSurfaces(cfg, loaded, current.personId, g);
		} catch (e) {
			if (g !== generation) return;
			// ORDER MATTERS: entuFetch throws AuthExpiredError BEFORE loadEventDetail
			// ever inspects `eventRes.ok`, so a 401 never becomes an
			// EventDetailLoadError — it must be recognised ahead of the
			// unavailable/load-error split, or it falls through to the misleading
			// generic error whose Retry can never succeed against a dead token.
			if (isAuthExpiredError(e)) {
				status = 'session-expired';
				detail = null;
				return;
			}
			console.error('event detail: load failed', e);
			// A 403/404 (or a 2xx carrying no entity) means this id is not readable
			// in THIS db — retrying cannot change that. Anything else (network,
			// parse, 5xx) is transient enough to be worth a Retry button.
			status = e instanceof EventDetailLoadError && e.unavailable ? 'not-available' : 'load-error';
			detail = null;
		}
	}

	function resetRsvpState(): void {
		memberId = null;
		membership = 'loading';
		myRsvp = null;
		rsvpPending = false;
		rsvpFailed = false;
		tally = null;
		tallyError = false;
	}

	/** #203 — a fresh (or superseded) load must not carry the PREVIOUS event's
	 *  armed/pending/error delete state across the switch — same rule
	 *  resetRsvpState/resetComposeState follow for their own surfaces. */
	function resetDeleteState(): void {
		deleteArmed = false;
		deletePending = false;
		deleteError = null;
	}

	/** #103 TE.3 — mirrors resetRsvpState for the works + attendance surfaces:
	 *  a fresh load (or a superseded one) must not carry the PREVIOUS event's
	 *  rows, rights, or attendance panel across the switch. */
	function resetComposeState(): void {
		seasonId = null;
		seasonManageRights = 'not-editor';
		workRows = [];
		libraryWorks = [];
		libraryEditions = [];
		seasonRepertoire = [];
		managePendingKeys = new Set();
		attendanceMap = {};
		attendancePanelOpen = false;
		attendancePanelLoading = false;
		attendancePanelError = false;
		attendanceRoster = [];
		attendanceRsvpMap = {};
		attendancePendingMemberIds = new Set();
		attendanceFailedMemberIds = new Set();
	}

	/** Membership + the viewer's own rsvp — the SAME primitives the agenda seeds
	 *  its rows from (findMyMemberId, listMyRsvps), so both surfaces read one
	 *  rsvp entity per event. `g` guards against a superseded collective/param
	 *  switch clobbering a newer load, same pattern as `loadForSelected`. */
	function loadRsvpControl(cfg: EntuCfg, personId: string, evId: string, g: number): void {
		findMyMemberId(cfg, personId)
			.then((id) => {
				if (g !== generation) return;
				memberId = id;
				membership = id ? 'member' : 'non-member';
			})
			.catch(() => {
				if (g !== generation) return;
				// Lookup FAILED — do NOT assert non-member. Stay unresolved (disabled,
				// no false hint) and fail safe, same rule as the agenda's own lookup.
				memberId = null;
				membership = 'loading';
			});

		listMyRsvps(cfg, personId)
			.then((rsvps) => {
				if (g !== generation) return;
				myRsvp = rsvpsByEventId(rsvps)[evId] ?? null;
			})
			.catch(() => {
				if (g !== generation) return;
				myRsvp = null;
			});
	}

	/** The rights-gated tally read — domain-tier listAllRsvpsForEvent (#82's
	 *  widen), counted per status. Only ever called behind `canSeeTally` (owner
	 *  OR editor visible on this event): on first load, and again once the
	 *  viewer's own rsvp write lands (#102 review F4).
	 *
	 *  #255 (D), DATE-GATED (Gama 15:31 refinement): a FUTURE event's tally
	 *  joins against the ACTIVE roster — a deactivated member's recorded 'yes'
	 *  must not inflate a count the conductor plans around (same reasoning as
	 *  the season summary's rate refusal). A PAST event keeps the tally
	 *  EXACTLY as recorded, raw and unjoined: she very likely sang, and
	 *  rewriting a historical number on the basis of present membership is the
	 *  same wrong as showing her a rate. The join is necessarily CLIENT-side —
	 *  Entu has no server-side two-hop (rsvp -> member -> status) filter.
	 *
	 *  `past` is CAPTURED BY THE CALLER at request time (`isPastDetail` on the
	 *  just-loaded `EventDetail`, never the live `isPast` $derived) and passed
	 *  in — this function's own `.then()` can resolve well after the event's
	 *  start ticks over mid-flight, and reading pastness THEN would be the
	 *  stale-closure trap the RED suite pins against. Her rsvp row is never
	 *  touched either way — this is a read-side filter, not a write. */
	function loadTally(cfg: EntuCfg, evId: string, g: number, past: boolean): void {
		Promise.all([
			listAllRsvpsForEvent(cfg, evId),
			// No roster fetch is needed for a PAST tally — skip it rather than pay
			// for a read whose answer would be thrown away.
			past ? Promise.resolve<null>(null) : listActiveMembers(cfg)
		])
			.then(([rows, activeMembers]) => {
				if (g !== generation) return;
				const scoped = activeMembers
					? rows.filter((r) => activeMembers.some((am) => am.memberId === r.memberId))
					: rows;
				tallyError = false;
				tally = {
					going: scoped.filter((r) => r.status === 'going').length,
					not_going: scoped.filter((r) => r.status === 'not_going').length,
					maybe: scoped.filter((r) => r.status === 'maybe').length,
					late: scoped.filter((r) => r.status === 'late').length
				};
			})
			.catch((e) => {
				if (g !== generation) return;
				// #102 review round 2 (F2) — loud, and visibly so. The counts are gone
				// (drop them rather than show a stale number as current), but the
				// editor is TOLD, and offered the same Retry affordance the event
				// read's own failure offers.
				console.error('event detail: tally load failed', e);
				tally = null;
				tallyError = true;
			});
	}

	/** Re-run the tally read for the event on screen — the Retry beside the
	 *  "counts unavailable" line. Rights-gated exactly like every other call
	 *  site, so it can never become a back door to the cross-person read. */
	function retryTally(): void {
		const current = selected;
		const loaded = detail;
		if (!current || !loaded || !canSeeTally(loaded, current.personId)) return;
		tallyError = false;
		loadTally({ db: current.db, token: getToken() ?? '' }, loaded.id, generation, isPastDetail(loaded));
	}

	// ── #203 — delete: the ONE destructive action this page owns ───────────────
	// Gated on `isEditor` in the template — the same predicate the pencils and
	// tally run. Two-step confirm, same shape as the agenda's #197 season-manage
	// delete rows: arming writes nothing, only the confirm button destroys.

	// Review F1 — both halves are async for ONE reason (the roster's
	// `armRemove`/`disarmRemove` spell it out, and `armSeasonManageDelete` follows
	// it verbatim): each flip unmounts the very button that holds focus — arming
	// unmounts the trigger, cancelling unmounts the confirm/cancel pair — so
	// without explicit placement focus drops to <body> and the next Tab restarts
	// at the top of the document (WCAG 2.4.3). `tick()` lets the swapped-in button
	// render before the query for it runs. The FAILURE path needs no such care: a
	// rejected confirm keeps the pair mounted, so focus never moves.

	/** Tap the trigger — arms the confirm/cancel pair and hands focus to the
	 *  confirm that replaced it. Writes nothing. A fresh attempt owns the error
	 *  slot, same rule armSeasonManageDelete follows. */
	async function armDelete(): Promise<void> {
		deleteError = null;
		deleteArmed = true;
		await tick();
		document.querySelector<HTMLElement>('[data-testid="event-detail-delete-confirm"]')?.focus();
	}

	/** Back to idle: the trigger returns (and catches focus), confirm/cancel
	 *  unmount, nothing was called. */
	async function cancelDelete(): Promise<void> {
		deleteArmed = false;
		deleteError = null;
		await tick();
		document.querySelector<HTMLElement>('[data-testid="event-detail-delete"]')?.focus();
	}

	/** The confirm tap: `deleteEvent` runs the #197 cascade (children first, the
	 *  event last) and this page navigates home on success — the id it was
	 *  standing on no longer exists. A REJECTED delete keeps the page up: no
	 *  navigation, `deleteArmed` stays true (the confirm/cancel pair remains, so
	 *  a retry or a cancel is still one tap away, same posture as
	 *  onSeasonManageEventDelete's failure path), and `deleteError` is set from
	 *  the discriminated failure — a 403 refusal (`isDeleteForbidden`) is NOT
	 *  "try again": an `_editor` can pass the button's gate yet lack the
	 *  `_owner` the DELETE endpoint demands (deleteErrors.ts). */
	async function confirmDelete(): Promise<void> {
		if (!selected || !detail || deletePending) return;
		deletePending = true;
		deleteError = null;
		const cfg = { db: selected.db, token: getToken() ?? '' };
		const evId = detail.id;
		try {
			await deleteEvent(cfg, evId);
			goto('/');
		} catch (e) {
			console.error('event detail: delete failed', evId, e);
			if (isDeleteForbidden(e)) {
				deleteError = { reason: 'forbidden' };
			} else if (isEventCascadePartial(e)) {
				const partial = e as { deletedCount?: number; totalCount?: number };
				deleteError = {
					reason: 'partial',
					deleted: partial.deletedCount ?? 0,
					total: partial.totalCount ?? 0
				};
			} else {
				deleteError = { reason: 'generic' };
			}
			deletePending = false;
		}
	}

	/** The copy for a failed delete — mirrors seasonManageDeleteErrorText's
	 *  switch. `forbidden` deliberately does not invite a retry. */
	function deleteErrorText(failure: NonNullable<typeof deleteError>): string {
		switch (failure.reason) {
			case 'forbidden':
				return m.event_detail_delete_forbidden();
			case 'partial':
				return m.event_detail_delete_partial({
					deleted: failure.deleted ?? 0,
					total: failure.total ?? 0
				});
			default:
				return m.event_detail_delete_error();
		}
	}

	// #102 TE.2 — same write-orchestration module the agenda uses
	// (rsvpChangeQueue.ts: per-event pending guard, optimistic set, reconcile on
	// success, revert on failure). One event lives on this page, but the SAME
	// entity — reusing the queue (rather than re-deriving its create/update/
	// delete dispatch inline) is what guarantees a status change here always
	// targets the viewer's EXISTING rsvp, never a second create.
	//
	// #102 review round 2 (F1) — EVERY callback discriminates before it writes.
	// The queue's callbacks are per-EVENT precisely so a late one cannot land on
	// the wrong event (rsvpChangeQueue.ts module doc: the #15 root cause was a
	// whole-map operation clobbering another event's state); the agenda preserves
	// that by writing into `rsvpByEventId[evId]`, this page collapses it into the
	// scalars `myRsvp`/`rsvpPending`/`rsvpFailed` — so the discrimination the
	// agenda gets from its map key has to be done explicitly here, or a settled
	// write for the event we just navigated AWAY from seeds the control of the
	// one now on screen (and the next tap then rewrites the OLD event's rsvp
	// entity, recording nothing for the new one).
	const rsvpQueue = createRsvpChangeQueue({
		setOptimistic(evId, entry) {
			if (!isCurrentWrite(evId)) return;
			myRsvp = entry;
		},
		setPending(evId, isPending) {
			// Record the generation the write STARTS under, here and only here:
			// `setPending(evId, true)` fires from inside `request()` exactly when the
			// queue ACCEPTS a request (a request dropped by the queue's own
			// same-event guard never reaches this), so the map holds live writes
			// only — never a scope stamped by a tap that wrote nothing.
			if (isPending) writeGenerations.set(evId, generation);
			if (!isCurrentWrite(evId)) return;
			rsvpPending = isPending;
			// A fresh write starting clears any stale failure marker — the user is
			// trying again.
			if (isPending) rsvpFailed = false;
		},
		reconcile(evId, entry) {
			const stillCurrent = isCurrentWrite(evId);
			writeGenerations.delete(evId);
			if (!stillCurrent) return;
			myRsvp = entry;
			// #102 review fix (F4) — the viewer's own answer is one of the rows the
			// tally counts, so a successful write just invalidated it (and the
			// capacity line, which reads `tally.going`). Re-read rather than patch a
			// local delta: the read is the same one that produced these counts, and
			// it also picks up anything else that changed meanwhile. Gated on the
			// SAME rights predicate as the initial fetch, so a plain member never
			// issues the cross-person read. `revert` needs no refresh — a failed
			// write changed nothing server-side.
			const current = selected;
			const loaded = detail;
			if (current && loaded && canSeeTally(loaded, current.personId)) {
				loadTally({ db: current.db, token: getToken() ?? '' }, loaded.id, generation, isPastDetail(loaded));
			}
		},
		revert(evId, before) {
			const stillCurrent = isCurrentWrite(evId);
			writeGenerations.delete(evId);
			if (!stillCurrent) return;
			myRsvp = before;
			rsvpFailed = true;
		}
	});

	function handleRsvpChange(newStatus: RsvpStatus | null): void {
		if (!selected || !detail) return;
		const cfg = { db: selected.db, token: getToken() ?? '' };
		const existing: MyRsvp | null = myRsvp
			? { rsvpId: myRsvp.rsvpId, eventId: detail.id, status: myRsvp.status }
			: null;
		rsvpQueue.request({
			cfg,
			personId: selected.personId,
			memberId,
			eventId: detail.id,
			existing,
			newStatus
		});
	}

	$effect(() => {
		// Depend on both — a collective switch OR a route-param change (a second
		// event link tapped from the agenda while this page is already open) must
		// both re-trigger the load.
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

	// Tallinn IANA timezone — same TZ as AgendaList.svelte (verbatim T5 build
	// spec convention; do not diverge from it here). The HH:MM-rendering
	// formatter itself now lives in $lib/preferences/timeFormat (#220
	// tallinnHHMM) — the one place the app renders a 24h clock time.
	const TZ = 'Europe/Tallinn';
	// #101 review fix (F4) — the agenda supplies each event's DATE via its day-group
	// headers, which this page does not inherit: a bookmarked /event/<id> showed a
	// time with no day at all. Same formatter options as AgendaList.svelte's
	// `headerFmt`, so the two surfaces render a date identically.
	// #251 — the locale argument now follows the APP language via getLocale()
	// (was the browser/device locale), rebuilt reactively so a language switch
	// updates the date without relying on setLocale's page reload. TZ and the
	// weekday/day/month options are unchanged.
	const dateFmt = $derived(
		new Intl.DateTimeFormat(getLocale(), {
			timeZone: TZ,
			weekday: 'long',
			day: 'numeric',
			month: 'long'
		})
	);

	/**
	 * The event's start INSTANT, or null when the entity carries no parseable
	 * `start_datetime`. #101 review fix (F1): `loadEventDetail` defaults a missing
	 * `start_datetime` to '' (Entu's `mandatory` is a UI hint, not enforced, so a
	 * timeless event is representable data), and `Intl.DateTimeFormat.format`
	 * THROWS `RangeError: Invalid time value` on an Invalid Date. Formatting it
	 * unguarded inside the template threw during render, which no `try/catch`
	 * around the async load can reach — the whole header, name included, silently
	 * failed to mount. Resolved once, here, so the template only ever formats a
	 * Date it has already proven valid.
	 */
	/** '' or an unparseable value -> null (never throws — see the callers'
	 *  docs). Pulled out to a plain function so `isPastDetail` below (used by
	 *  `loadComposeSurfaces`, which runs on the just-resolved `EventDetail`
	 *  BEFORE relying on `$derived` to have caught up) shares the exact same
	 *  parse rule as the template's own `startAt`. */
	function parseStartAt(raw: string): Date | null {
		if (raw === '') return null;
		const parsed = new Date(raw);
		return Number.isNaN(parsed.getTime()) ? null : parsed;
	}

	const startAt = $derived.by(() => parseStartAt(detail?.startDatetime ?? ''));

	/**
	 * #102 review fix (F3) — this event has already started, so its RSVP is
	 * closed. The agenda partitions past from upcoming on the START INSTANT
	 * alone (`recentEvents`: `item.startDatetime < now`, the exact complement of
	 * listFullAgenda's `>= now` upcoming gate — duration is NOT part of the
	 * boundary), and its 'Recent' rows render the control read-only. Those rows
	 * link straight here, so this page has to draw the line in the SAME place —
	 * otherwise a singer taps a finished rehearsal and edits an answer the
	 * agenda declares closed, possibly after attendance was recorded.
	 *
	 * An event with no parseable start is NOT past: unknown ≠ over.
	 *
	 * `Date.now()` is read whenever `startAt` changes — i.e. once per load, the
	 * same freshness the agenda's own partition has (it splits at load time and
	 * does not re-split while the page stays open).
	 */
	const isPast = $derived(startAt !== null && startAt.getTime() < Date.now());
	/** Same rule as `isPast`, computed straight off an `EventDetail` rather than
	 *  the reactive `startAt` — used the instant a load resolves, before this
	 *  page's own `$derived`s are guaranteed to have re-run. */
	function isPastDetail(d: EventDetail): boolean {
		const start = parseStartAt(d.startDatetime);
		return start !== null && start.getTime() < Date.now();
	}

	/**
	 * "19:00–20:30" — start, then start + duration, both Tallinn-zoned. #101 review
	 * fix (F2): a zero/unknown duration (no `duration_minutes` on the event AND
	 * none on its parent series → loadEventDetail defaults to 0) yields the start
	 * time ALONE, never the degenerate "19:00–19:00" range.
	 */
	function timeRange(start: Date, minutes: number): string {
		// #220 — both ends explicit in AM/PM mode ('7:00 PM–8:30 PM'), reading
		// $timeFormatStore live so a preference change while this page is open
		// re-renders the time line (same reactive-read pattern TimeSelect uses).
		const mode = $timeFormatStore;
		const startStr = formatTime(tallinnHHMM(start), mode);
		if (minutes <= 0) return startStr;
		const endStr = formatTime(tallinnHHMM(new Date(start.getTime() + minutes * 60_000)), mode);
		return `${startStr}–${endStr}`;
	}

	// #194/#202 — the label map + fallback moved to $lib/events/eventTypeLabels
	// (imported above), shared with the agenda's per-row badge.

	// ═══════════════════════════════════════════════════════════════════════
	// #103 TE.3 — compose the WORKS and ATTENDANCE surfaces. Shape mirrors the
	// RSVP wiring above: this page owns the reads, the rights, the optimistic
	// local mutation and its inverse; repertoireActions/attendanceData own the
	// wire calls; the write queues own the pending guard and the settle path;
	// RepertoireElement/AttendanceSurface only render and forward taps — the
	// exact same components + producers the agenda uses, never a lookalike.
	// ═══════════════════════════════════════════════════════════════════════

	type ComposeCfg = { db: string; token: string };

	/** `_editor` (or `_owner`) on THIS event — the app's one rights rule, run
	 *  over data this page already loaded. Governs the "Add to programme" /
	 *  programme-row controls RepertoireElement renders regardless of `context`
	 *  (see that component's doc); `seasonManageRights` below governs the
	 *  season-repertoire ones. */
	const eventManageRights = $derived<ManageRightsState>(isEditor ? 'editor' : 'not-editor');

	/**
	 * The works + attendance reads for one just-loaded event. Called from
	 * `loadForSelected` alongside `loadRsvpControl`/`loadTally` — same `g`
	 * generation guard throughout, so a superseded load (collective switch,
	 * second event link tapped) can never land its rows on the page that has
	 * since moved on.
	 *
	 * Review F1/F2 — the season id and BOTH rights answers ride on `loaded`
	 * (see EventDetail's `seasonId`/`seasonOwnerIds`/`seasonEditorIds`), so
	 * everything below is pure computation and the works read is the FIRST
	 * request this function makes, not the third link of a serial chain.
	 */
	function loadComposeSurfaces(cfg: ComposeCfg, loaded: EventDetail, personId: string, g: number): void {
		const sid = loaded.seasonId;
		seasonId = sid;
		// The app's one owner-OR-editor rule, run over the reads that already
		// happened — no round-trip, and therefore no 'error' state to mistake for
		// 'not-editor' (repertoire/types.ts on why that collapse is forbidden).
		const seasonRights: ManageRightsState =
			sid === null
				? 'not-editor'
				: manageRightsFrom(loaded.seasonOwnerIds, loaded.seasonEditorIds, personId);
		seasonManageRights = seasonRights;
		const eventEditor = manageRightsFrom(loaded.ownerIds, loaded.editorIds, personId) === 'editor';

		loadWorksByEventId(cfg, [loaded.id], sid, fetch, {
			includeInactive: seasonRights === 'editor'
		})
			.then((byEvent) => {
				if (g !== generation) return;
				workRows = byEvent[loaded.id] ?? [];
			})
			.catch(() => {
				if (g !== generation) return;
				workRows = [];
			});

		if (seasonRights === 'editor' || eventEditor) loadManagePickers(cfg, sid, g);

		// Attendance — domain-visible, so read unconditionally for a past event
		// (never rights-gated); absent entirely on a future one (nothing to show).
		if (isPastDetail(loaded)) {
			listAttendance(cfg, loaded.id)
				.then((records) => {
					if (g !== generation) return;
					attendanceMap = attendanceByMemberId(records);
				})
				.catch((e) => {
					console.error('event detail: attendance load failed', e);
					if (g !== generation) return;
					attendanceMap = {};
				});
		}
	}

	/** The management picker sources — only fetched for a rights-holder. */
	function loadManagePickers(cfg: ComposeCfg, sid: string | null, g: number): void {
		Promise.all([
			listWorks(cfg),
			listAllEditions(cfg),
			sid === null ? Promise.resolve<RepertoireItem[]>([]) : listRepertoireItems(cfg, sid)
		])
			.then(([works, editions, repertoire]) => {
				if (g !== generation) return;
				libraryWorks = works;
				libraryEditions = editions;
				seasonRepertoire = repertoire;
			})
			.catch(() => {
				if (g !== generation) return;
				libraryWorks = [];
				libraryEditions = [];
				seasonRepertoire = [];
			});
	}

	// ── the works management write layer ──────────────────────────────────

	function manageCfg(): ComposeCfg | null {
		return selected ? { db: selected.db, token: getToken() ?? '' } : null;
	}

	/** The PDF download, signed AT CLICK TIME — Entu's signed S3 url is valid
	 *  for 60 seconds (entu-www src/api/files/index.md), so it can never be
	 *  resolved ahead of the click and parked in an href (RepertoireElement
	 *  hands up the file property id instead). Verbatim the agenda's own
	 *  `handlePdfClick`: the blank tab opens SYNCHRONOUSLY, inside the click's
	 *  user-gesture window, so a popup blocker cannot swallow it. */
	function handlePdfClick(fileId: string): void {
		if (!selected) return;
		const cfg = { db: selected.db, token: getToken() ?? '' };
		const tab = window.open('', '_blank');
		if (tab) tab.opener = null;
		signFileUrl(cfg, fileId)
			.then((url) => {
				if (tab) tab.location.href = url;
				else window.location.href = url;
			})
			.catch((e) => {
				console.error('event detail: pdf signing failed', e);
				tab?.close();
			});
	}

	/** Re-read what a settled write changed — the rows are a join over four
	 *  collections (workRows.ts), so only worth paying after a CREATE (whose
	 *  server-assigned id exists nowhere else) or a FAILED write (the screen
	 *  must show the truth, not a stale local fiction). Mirrors the agenda's
	 *  own `refreshWorksAfterWrite`. */
	function refreshWorks(): void {
		const cfg = manageCfg();
		if (!cfg || !detail) return;
		const evId = detail.id;
		const g = generation;
		loadWorksByEventId(cfg, [evId], seasonId, fetch, { includeInactive: seasonManageRights === 'editor' })
			.then((byEvent) => {
				if (g !== generation) return;
				workRows = byEvent[evId] ?? [];
			})
			.catch(() => {
				/* keep the optimistic rows; the next load reconciles */
			});
		if (seasonId !== null && seasonManageRights === 'editor') {
			listRepertoireItems(cfg, seasonId)
				.then((items) => {
					if (g !== generation) return;
					seasonRepertoire = items;
				})
				.catch(() => {
					/* the picker keeps its previous exclusion set */
				});
		}
	}

	const repertoireQueue = createRepertoireWriteQueue({
		setPending(key, pending) {
			const next = new Set(managePendingKeys);
			if (pending) next.add(key);
			else next.delete(key);
			managePendingKeys = next;
		},
		reconcile(key) {
			// Only a CREATE needs the server (its id is assigned there); every
			// other write kind already holds the authoritative value locally —
			// same economy the agenda's own queue callbacks apply.
			if (key === ADD_WORK_KEY || key === ADD_PROGRAMME_KEY) refreshWorks();
		},
		revert(key) {
			console.error('event detail: repertoire write failed', key);
			// None of these writes is atomic — refetch shows the TRUTH rather than
			// a rolled-back-but-possibly-wrong local guess (agenda's own F5 rule).
			refreshWorks();
		}
	});

	function findWorkRow(itemId: string): WorkRow | undefined {
		return workRows.find((row) => row.id === itemId);
	}
	function patchWorkRow(itemId: string, patch: Partial<WorkRow>): void {
		workRows = workRows.map((row) => (row.id === itemId ? { ...row, ...patch } : row));
	}
	function dropWorkRow(itemId: string): void {
		workRows = workRows.filter((row) => row.id !== itemId);
	}
	function restoreWorkRow(index: number, row: WorkRow): void {
		if (workRows.some((r) => r.id === row.id)) return;
		const next = [...workRows];
		next.splice(Math.min(index, next.length), 0, row);
		workRows = next;
	}
	function setWorkOrdinals(ordinalById: Map<string, number>): void {
		workRows = workRows.map((row) =>
			ordinalById.has(row.id) ? { ...row, ordinal: ordinalById.get(row.id)! } : row
		);
	}

	function handleAddWork(workId: string): void {
		const cfg = manageCfg();
		if (!cfg || seasonId === null) return;
		const sid = seasonId;
		repertoireQueue.request(ADD_WORK_KEY, async () => {
			await createRepertoireItem(cfg, { seasonId: sid, workId });
		});
	}

	function handleStatusChange(itemId: string, status: RepertoireStatus): void {
		const cfg = manageCfg();
		const row = findWorkRow(itemId);
		if (!cfg || !row || row.kind !== 'repertoire') return;
		const before = row.status;
		repertoireQueue.request(itemId, () => updateRepertoireStatus(cfg, itemId, status), {
			apply: () => patchWorkRow(itemId, { status }),
			rollback: () => patchWorkRow(itemId, { status: before })
		});
	}

	function handlePinEdition(itemId: string, editionId: string): void {
		const cfg = manageCfg();
		const row = findWorkRow(itemId);
		if (!cfg || !row || row.kind !== 'repertoire') return;
		const before = { editionId: row.editionId, editionName: row.editionName };
		const editionName = libraryEditions.find((e) => e.id === editionId)?.name ?? '';
		repertoireQueue.request(itemId, () => pinEdition(cfg, itemId, editionId), {
			apply: () => patchWorkRow(itemId, { editionId, editionName }),
			rollback: () => patchWorkRow(itemId, before)
		});
	}

	/** WHICH delete this is comes from the row's own `kind`, never from the
	 *  surface it was tapped on — a repertoire-context row can be a fallback
	 *  program-item-free event, but the row itself always states its own
	 *  provenance (same rule the agenda's handleRemoveItem follows). */
	function handleRemoveItem(itemId: string): void {
		const cfg = manageCfg();
		const row = findWorkRow(itemId);
		if (!cfg || !row) return;
		const index = workRows.findIndex((r) => r.id === itemId);
		if (row.kind === 'program') {
			repertoireQueue.request(itemId, () => deleteProgramItem(cfg, itemId), {
				apply: () => dropWorkRow(itemId),
				rollback: () => restoreWorkRow(index, row)
			});
			return;
		}
		const repertoireBefore = seasonRepertoire;
		repertoireQueue.request(itemId, () => deleteRepertoireItem(cfg, itemId), {
			apply: () => {
				dropWorkRow(itemId);
				seasonRepertoire = seasonRepertoire.filter((item) => item.id !== itemId);
			},
			rollback: () => {
				restoreWorkRow(index, row);
				seasonRepertoire = repertoireBefore;
			}
		});
	}

	function handleMoveItem(itemId: string, direction: 'up' | 'down'): void {
		const cfg = manageCfg();
		if (!cfg || !detail) return;
		const items = workRows
			.filter((row) => row.kind === 'program')
			.map((row) => ({ id: row.id, ordinal: row.ordinal ?? 0 }));
		const plan = planProgramMove(items, itemId, direction);
		if (plan.length === 0) return; // boundary row, or not in this programme
		const key = `move:${detail.id}`;
		const before = new Map(
			plan.map((entry) => [entry.id, items.find((i) => i.id === entry.id)?.ordinal ?? 0])
		);
		const after = new Map(plan.map((entry) => [entry.id, entry.ordinal]));
		repertoireQueue.request(key, () => reorderProgramItems(cfg, plan), {
			apply: () => setWorkOrdinals(after),
			rollback: () => setWorkOrdinals(before)
		});
	}

	function handleAddProgramItem(editionId: string, ordinal: number): void {
		const cfg = manageCfg();
		if (!cfg || !detail) return;
		const eventIdForProgram = detail.id;
		repertoireQueue.request(ADD_PROGRAMME_KEY, async () => {
			await createProgramItem(cfg, { eventId: eventIdForProgram, editionId, ordinal });
		});
	}

	// ── derived picker sources (single event/season, unlike the agenda's
	//    per-event maps — this page only ever has ONE of each) ────────────

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

	/** Per repertoire ROW: the editions of that row's work ("pin edition"). */
	const editionOptionsByRowId = $derived.by(() => {
		const out: Record<string, PickerOption[]> = {};
		for (const row of workRows) {
			if (row.kind !== 'repertoire' || row.workId === '') continue;
			const options = (editionsByWorkId.get(row.workId) ?? []).map((edition) => ({
				id: edition.id,
				label: editionLabel(edition)
			}));
			if (options.length > 0) out[row.id] = options;
		}
		return out;
	});

	/** Editions not already on THIS event's programme, labelled
	 *  "Work - Composer — Edition" (#204). */
	const pickableEditionsList = $derived.by(() => {
		const workById = new Map(libraryWorks.map((work) => [work.id, work]));
		const programmed = new Set(
			workRows.filter((row) => row.kind === 'program').map((row) => row.editionId)
		);
		return libraryEditions
			.filter((edition) => !programmed.has(edition.id))
			.map((edition) => {
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
	});

	const pickableWorksList = $derived(pickableWorks(libraryWorks, seasonRepertoire));

	/** Absent entirely for a viewer with no works AND no rights anywhere on
	 *  this event — never an empty "Works" placeholder (same rule
	 *  RepertoireElement itself follows for a plain member). A rights-holder on
	 *  an otherwise-empty event still gets the section, so "Add work"/"Add to
	 *  programme" has somewhere to render (the agenda's own `showWorks`). */
	const showWorksSection = $derived(
		workRows.length > 0 || seasonManageRights === 'editor' || eventManageRights === 'editor'
	);

	/** Which management surface the works element shows, from the PROVENANCE of
	 *  its rows — the SAME rule AgendaList.worksContext applies (an event with
	 *  its own program_items shows the programme; one without falls back to the
	 *  season repertoire and therefore shows the repertoire surface).
	 *
	 *  Review F2 — this was hardcoded to 'repertoire', and RepertoireElement
	 *  gates its per-row controls on `context` matching the row's `kind`, so a
	 *  programmed event rendered NO row controls at all here (move/remove
	 *  unreachable) while the SAME event's agenda row rendered them, and offered
	 *  the season's "Add work" where the agenda did not. `seasonRights` /
	 *  `eventRights` are passed independently, so both surfaces stay correctly
	 *  gated in either mode. */
	const worksContext = $derived<'repertoire' | 'programme'>(
		workRows.some((row) => row.kind === 'program') ? 'programme' : 'repertoire'
	);

	// ── the attendance section ─────────────────────────────────────────────

	/** The viewer's own attendance for this event, or 'not-recorded' once her
	 *  member id is known but no record exists — never a blank, and never
	 *  computed before her member id has resolved (an unresolved membership is
	 *  not "not recorded", it's "don't know yet"). */
	const myAttendanceStatus = $derived<AttendanceStatus | 'not-recorded' | null>(
		memberId === null ? null : (attendanceMap[memberId]?.status ?? 'not-recorded')
	);

	/** Anyone at all was marked for this event — the ONE "there is data" test
	 *  both the section gate and the tally gate run (review F1 and F4). */
	const hasAttendanceRecords = $derived(Object.keys(attendanceMap).length > 0);

	const attendanceTally = $derived.by(() => {
		let present = 0;
		let absent = 0;
		let late = 0;
		for (const entry of Object.values(attendanceMap)) {
			if (entry.status === 'present') present++;
			else if (entry.status === 'absent') absent++;
			else if (entry.status === 'late') late++;
		}
		return { present, absent, late };
	});

	/** The viewer holds the conductor seat for THIS event — resolveConductors'
	 *  verdict (#77), already resolved into `detail.conductorIds` by
	 *  loadEventDetail. Same gate the agenda's 'Take attendance' button uses. */
	const isConductorForEvent = $derived(
		detail !== null && selected !== null && detail.conductorIds.includes(selected.personId)
	);

	/** Hidden entirely on a future event (nothing to show yet — the task spec's
	 *  rule), and hidden on a past one with NO attendance recorded at all unless
	 *  the viewer can actually do something about it (take attendance).
	 *
	 *  Review F1 — "the viewer is a member" is NOT a stand-in for "there is
	 *  attendance data": `myAttendanceStatus` is non-null for ANY resolved
	 *  member (it falls back to 'not-recorded'), so including it here gave every
	 *  member an empty section with a 0/0/0 tally on every past event nobody had
	 *  taken attendance for — which is most past rehearsals, and the exact
	 *  "no empty placeholders" rule #103 asks for. A member who DOES have a
	 *  record is already covered by the non-empty map.
	 *
	 *  Review F4 — a conductor admitted here by the second branch has NO tally
	 *  to read (the tally is gated on `hasAttendanceRecords` too); she gets the
	 *  heading and the Take-attendance button, nothing zeroed. */
	const showAttendanceSection = $derived(
		isPast && detail !== null && (hasAttendanceRecords || isConductorForEvent)
	);

	/** A minimal `AgendaItem` view of `detail` — AttendanceSurface's `item` prop
	 *  is the agenda's own view model (name shown in the panel header); this
	 *  page has no AgendaItem of its own, only EventDetail, so it maps the
	 *  fields that shape actually carries. */
	const agendaItemForPanel = $derived<AgendaItem | null>(
		detail === null
			? null
			: {
					id: detail.id,
					name: detail.name,
					startDatetime: detail.startDatetime,
					durationMinutes: detail.durationMinutes,
					location: detail.location,
					conductors: detail.conductorIds,
					owners: detail.ownerIds,
					editors: detail.editorIds
				}
	);

	function openAttendancePanel(): void {
		if (!selected || !detail || !isConductorForEvent) return;
		attendancePanelOpen = true;
		attendancePanelLoading = true;
		attendancePanelError = false;
		const cfg = { db: selected.db, token: getToken() ?? '' };
		const evId = detail.id;
		const g = generation;
		Promise.all([loadRoster(cfg), listAttendance(cfg, evId), listAllRsvpsForEvent(cfg, evId)])
			.then(([roster, records, rsvps]) => {
				if (g !== generation || detail?.id !== evId) return;
				attendanceRoster = roster;
				attendanceMap = attendanceByMemberId(records);
				const rsvpMap: Record<string, { rsvpId: string; status: string }> = {};
				for (const r of rsvps) rsvpMap[r.memberId] = { rsvpId: r.rsvpId, status: r.status };
				attendanceRsvpMap = rsvpMap;
				attendancePanelLoading = false;
			})
			.catch((e) => {
				console.error('event detail: attendance panel load failed', e);
				if (g !== generation || detail?.id !== evId) return;
				attendancePanelLoading = false;
				attendancePanelError = true;
			});
	}

	// #113 review F2 — the symmetric half of AttendanceSurface's open-focus
	// (`onMount` puts focus on the panel's Close button). This page renders the
	// same surface behind the same hide-while-open gate as the agenda, so the
	// Close button unmounts ITSELF and the entry point remounts with nothing
	// focused — focus drops to <body> (WCAG 2.4.3). Same fix as the agenda's
	// `closeAttendancePanel`, minus its `untrack` guard: that one is called from
	// inside a tracking `$effect` (`loadForSelected`'s cleanup path) and must not
	// register a dependency; this one is only ever the AttendanceSurface
	// `onclose` callback (`resetComposeState` clears `attendancePanelOpen`
	// directly, without going through here).
	function closeAttendancePanel(): void {
		attendancePanelOpen = false;
		tick().then(() => {
			document
				.querySelector<HTMLElement>(
					'[data-testid="event-detail-attendance"] [data-testid="take-attendance-btn"]'
				)
				?.focus();
		});
	}

	// The write-generation guard, same shape as `writeGenerations` above (the
	// RSVP queue's F1 fix): a write started under a PREVIOUS event/collective
	// must never land its optimistic value on the page that has since moved on.
	const attendanceWriteGenerations = new Map<string, number>();
	function isCurrentAttendanceWrite(evId: string, targetMemberId: string): boolean {
		return (
			detail !== null &&
			evId === detail.id &&
			attendanceWriteGenerations.get(targetMemberId) === generation
		);
	}

	const attendanceQueue = createAttendanceChangeQueue({
		setOptimistic(evId, targetMemberId, entry) {
			if (!isCurrentAttendanceWrite(evId, targetMemberId)) return;
			const next = { ...attendanceMap };
			if (entry) next[targetMemberId] = entry;
			else delete next[targetMemberId];
			attendanceMap = next;
		},
		setPending(evId, targetMemberId, pending) {
			if (pending) attendanceWriteGenerations.set(targetMemberId, generation);
			if (!isCurrentAttendanceWrite(evId, targetMemberId)) return;
			const next = new Set(attendancePendingMemberIds);
			if (pending) next.add(targetMemberId);
			else next.delete(targetMemberId);
			attendancePendingMemberIds = next;
			if (pending) {
				const failed = new Set(attendanceFailedMemberIds);
				failed.delete(targetMemberId);
				attendanceFailedMemberIds = failed;
			}
		},
		reconcile(evId, targetMemberId, entry) {
			const stillCurrent = isCurrentAttendanceWrite(evId, targetMemberId);
			attendanceWriteGenerations.delete(targetMemberId);
			if (!stillCurrent) return;
			const next = { ...attendanceMap };
			if (entry) next[targetMemberId] = entry;
			else delete next[targetMemberId];
			attendanceMap = next;
		},
		revert(evId, targetMemberId, before) {
			const stillCurrent = isCurrentAttendanceWrite(evId, targetMemberId);
			attendanceWriteGenerations.delete(targetMemberId);
			if (!stillCurrent) return;
			const next = { ...attendanceMap };
			if (before) next[targetMemberId] = before;
			else delete next[targetMemberId];
			attendanceMap = next;
			const failed = new Set(attendanceFailedMemberIds);
			failed.add(targetMemberId);
			attendanceFailedMemberIds = failed;
		}
	});

	function handleAttendanceToggle(targetMemberId: string, newStatus: AttendanceStatus | null): void {
		if (!selected || !detail) return;
		const cfg = { db: selected.db, token: getToken() ?? '' };
		const current = attendanceMap[targetMemberId];
		const existing: EventAttendance | null = current
			? { attendanceId: current.attendanceId, memberId: targetMemberId, status: current.status }
			: null;
		attendanceQueue.request({ cfg, eventId: detail.id, memberId: targetMemberId, existing, newStatus });
	}

	// ── #104 TE.4 — inline event editing ──────────────────────────────────────
	// The ONE rights predicate is `isEditor` (already derived above from
	// manageRightsFrom — the app's owner-OR-editor rule). Per-tap: tap a pencil,
	// the field becomes an input seeded with the CURRENT value, blur/Enter
	// confirms with an immediate optimistic write (eventFieldEdit.ts owns the
	// replace-semantics wire choreography), Escape cancels writing nothing, and
	// a failed write reverts the display and shows an inline error. Same
	// optimistic-mutate-then-reconcile-or-revert shape as every other write
	// queue on this page — and literally the same primitive: the write goes
	// through `createRepertoireWriteQueue` keyed on the FIELD NAME.
	//
	// #104 review F1 — `editingField` is NOT a write guard. It guards concurrent
	// EDITING (one input open at a time), but it is cleared synchronously on
	// confirm, so the pencil is back before the write it fired has landed. A
	// second edit of the same field while the first is still in flight would run
	// a second GET-POST-DELETE against the SAME pre-existing value id: both GETs
	// see the old value, both POST (the entity ends with two values for the
	// field), and whichever DELETE loses the race 404s — surfacing a false inline
	// error over a value the server actually accepted. The queue's per-key
	// pending set drops the second write exactly like every other control here,
	// and `editWritePending` disables the pencil while it is in flight (the
	// primary guard; the queue's own set is the backstop).

	let editingField = $state<EditableEventField | null>(null);
	let editDraft = $state('');

	// #248 — location suggestions on this detail route, PO ruling (option c):
	// this page holds no multi-event location corpus in memory (unlike the
	// agenda page's agendaItems/recentItems), so the corpus is fetched, but
	// LAZILY — only on the first focus of event-edit-input-location, never on
	// page load. `locationCorpusRequested` is the single-flight guard: it is
	// plain page state (NOT reset when the edit closes/reopens), so a second
	// focus after cancel-then-reopen does not re-fetch. Failure degrades
	// silently — `locationSuggestions` simply stays empty; suggestions are
	// never load-bearing for the edit/save path.
	const LOCATION_SUGGESTIONS_ID = 'event-edit-location-suggestions';
	let locationSuggestions = $state<string[]>([]);
	let locationCorpusRequested = false;
	function ensureLocationCorpusLoaded(): void {
		if (locationCorpusRequested) return;
		locationCorpusRequested = true;
		if (!selected) return;
		const cfg = { db: selected.db, token: getToken() ?? '' };
		listEventLocations(cfg)
			.then((locs) => {
				locationSuggestions = locs;
			})
			.catch((e) => {
				console.error('event detail: loading location suggestions failed', e);
			});
	}
	// #207 rule 5 — start_datetime's own composite draft: the native date input
	// and the TimeSelect hour/minute keep their own pieces here, combined into
	// the SAME `editDraft` 'YYYY-MM-DDTHH:MM' string (or '' while either part is
	// missing) every existing reader (draftWireValue/isUnchanged) already
	// expects — see `updateCompositeDraft` below.
	let editDraftDate = $state('');
	let editDraftTime = $state('');
	let editErrors = $state<Partial<Record<EditableEventField, boolean>>>({});
	// #243 — duration_minutes' end editor can be refused for a REASON (end at
	// or before start) distinct from a failed WRITE: this flag picks the
	// `event_end_before_start` copy over the generic save-error copy in the
	// SAME `event-edit-error-duration_minutes` slot (one testid, two possible
	// messages). Cleared alongside `editErrors` whenever the pencil reopens.
	let editRangeErrors = $state<Partial<Record<EditableEventField, boolean>>>({});
	let editWritePending = $state<Partial<Record<EditableEventField, boolean>>>({});

	// #105 TE.5 — focus management (WAI-ARIA edit-in-place). Plain (non-$state)
	// DOM refs, same posture as any `bind:this` target: these are imperative
	// handles, not values the template reads reactively. Keyed by field so
	// Escape can send focus back to the SAME pencil that opened the editor —
	// start_datetime has two possible pencil sites (with/without a rendered
	// time line) but only ever one on screen at a time, so one slot per field
	// is enough.
	let pencilRefs: Partial<Record<EditableEventField, HTMLButtonElement>> = {};

	// #105 review R2-F1 — does the IN-FLIGHT write for this field owe the pencil
	// its focus back when it settles? Set from the dismissal that started the
	// write: a keyboard dismissal (Enter) does, a blur does NOT — the viewer
	// already moved focus somewhere deliberate. Without this the settle could
	// only ask "is any editor open?", which says nothing about whether focus
	// now sits on an RSVP button, a works control or the back link — all of
	// which a late restore would rip focus away from mid-interaction. Plain
	// (non-$state) like `pencilRefs`: imperative bookkeeping the template never
	// reads. Keyed by field because writes are queued per field and can settle
	// out of order.
	let pendingFocusRestore: Partial<Record<EditableEventField, boolean>> = {};

	/** A field's write has settled (either way): hand the pencil its focus back
	 *  IF the dismissal that started the write was the kind that owes it, and
	 *  no editor has been opened since. The flag is spent either way — a write
	 *  settles exactly once. */
	function settleFieldFocus(field: EditableEventField): void {
		const owed = pendingFocusRestore[field] === true;
		delete pendingFocusRestore[field];
		if (owed && editingField === null) restorePencilFocus(field);
	}

	/** Svelte action: focus the element the instant it mounts. Used on every
	 *  edit input/textarea — activating a pencil must move focus INTO the
	 *  control it becomes, never leave it stranded on the unmounted button
	 *  (which drops focus to <body>). */
	function focusOnMount(node: HTMLElement): void {
		node.focus();
	}

	// The optimistic apply/rollback ride in as `hooks` per request (they close
	// over that confirm's `before` value); this queue only carries the pending
	// flag and the inline-error surface.
	//
	// #105 review F1 — the pencil is DISABLED for exactly the window this
	// queue's own `pending` set covers (`editWritePending[field]`, the
	// `disabled={...}` on every pencil button above). A disabled element cannot
	// take focus (HTMLElementUtility.focus is a no-op on one) — so restoring
	// focus the instant `editingField` clears, back in `confirmFieldEdit`,
	// would race the SAME synchronous `request()` call that just disabled the
	// button and silently fail. `reconcile`/`revert` fire once the pending flag
	// has already flipped back to `false` (see `setPending` above, which the
	// queue always calls before either), so the pencil is enabled again by the
	// time these run — the right place to land the restore. Both hand off to
	// `settleFieldFocus`, which restores only when the dismissal that STARTED
	// this write asked for it (`pendingFocusRestore`, #105 review R2-F1) and no
	// editor has been opened since.
	const editWriteQueue = createRepertoireWriteQueue({
		setPending(key, pending) {
			editWritePending = { ...editWritePending, [key as EditableEventField]: pending };
		},
		reconcile(key) {
			editErrors = { ...editErrors, [key as EditableEventField]: false };
			settleFieldFocus(key as EditableEventField);
		},
		revert(key) {
			editErrors = { ...editErrors, [key as EditableEventField]: true };
			settleFieldFocus(key as EditableEventField);
		}
	});

	/** Current display value for a field, read off `detail` — the single
	 *  source of truth both the header and the edit-draft seed from. */
	function fieldValue(d: EventDetail, field: EditableEventField): string | number {
		switch (field) {
			case 'name':
				return d.name;
			case 'start_datetime':
				return d.startDatetime;
			case 'duration_minutes':
				return d.durationMinutes;
			case 'location':
				return d.location;
			case 'description':
				return d.description;
			case 'event_type':
				return d.eventType;
		}
	}

	/** Apply a field's value onto `detail` — the SAME optimistic-mutation shape
	 *  every other write on this page uses (rsvpQueue/attendanceQueue/
	 *  repertoireQueue callbacks): a plain reassignment, so the header re-renders
	 *  immediately, identically on the optimistic apply and the (identical)
	 *  post-success value — no forced re-read. */
	function applyFieldLocally(field: EditableEventField, value: string | number): void {
		if (!detail) return;
		switch (field) {
			case 'name':
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

	/** The Tallinn wall-clock offset (minutes, e.g. +180 in EEST) in effect AT
	 *  `date` — rendering `date`'s Tallinn wall clock, then re-reading those same
	 *  digits as if THEY were UTC and diffing against the real instant, gives
	 *  exactly the offset. DST-aware because the formatter is. */
	function tallinnOffsetMinutes(date: Date): number {
		const parts = new Intl.DateTimeFormat('en-US', {
			timeZone: TZ,
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

	/** ISO instant → the `datetime-local` input value seeded from the TALLINN
	 *  wall clock the header itself displays (never raw UTC — TE.4 contract).
	 *  '' on an unparseable instant. */
	function toTallinnLocalInputValue(iso: string): string {
		const date = new Date(iso);
		if (Number.isNaN(date.getTime())) return '';
		const parts = new Intl.DateTimeFormat('en-CA', {
			timeZone: TZ,
			hourCycle: 'h23',
			year: 'numeric',
			month: '2-digit',
			day: '2-digit',
			hour: '2-digit',
			minute: '2-digit'
		}).formatToParts(date);
		const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
		return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
	}

	/** The inverse: a `datetime-local` value the user typed AS TALLINN wall
	 *  clock → the UTC instant to write on the wire. Two passes because the
	 *  Tallinn offset (EET/EEST) itself depends on the INSTANT being converted —
	 *  the first pass reads the offset at the UTC-as-if-Tallinn guess, the second
	 *  re-reads it at the instant that guess produced. On the two DST transition
	 *  days the guess sits on the far side of the changeover (a 01:30 EET wall
	 *  clock on 29 March guesses 01:30Z, still EET-side, and one pass would write
	 *  22:30Z — 00:30 Tallinn, an hour off), so the second pass is what makes
	 *  every valid wall clock in the year round-trip. Only 03:00–03:59 on
	 *  spring-forward day stays off, and those wall clocks do not exist locally.
	 *
	 *  TOTAL on purpose — '' for an empty or unparseable draft, mirroring
	 *  `toTallinnLocalInputValue`'s own NaN guard. An empty draft is a REACHABLE
	 *  state (a timeless event's pencil seeds '', and an editor can clear the
	 *  input), and `Date.UTC(NaN, …)` would feed an Invalid Date into
	 *  `formatToParts`, which THROWS — escaping the onblur handler and stranding
	 *  the page in edit mode with no inline error. */
	function tallinnLocalToUtcIso(local: string): string {
		const [datePart, timePart] = local.split('T');
		const [y, mo, d] = (datePart ?? '').split('-').map(Number);
		const [h, mi] = (timePart ?? '00:00').split(':').map(Number);
		const guessUtcMs = Date.UTC(y, mo - 1, d, h, mi);
		if (Number.isNaN(guessUtcMs)) return '';
		const firstOffset = tallinnOffsetMinutes(new Date(guessUtcMs));
		let instantMs = guessUtcMs - firstOffset * 60_000;
		const secondOffset = tallinnOffsetMinutes(new Date(instantMs));
		if (secondOffset !== firstOffset) instantMs = guessUtcMs - secondOffset * 60_000;
		return new Date(instantMs).toISOString();
	}

	function beginFieldEdit(field: EditableEventField): void {
		// A field whose previous write is still in flight cannot be re-opened —
		// the pencil is disabled for exactly this window, this is the backstop for
		// a tap that beat the re-render (#104 review F1).
		if (!detail || editWritePending[field]) return;
		editErrors = { ...editErrors, [field]: false };
		editRangeErrors = { ...editRangeErrors, [field]: false };
		if (field === 'start_datetime') {
			const seeded = toTallinnLocalInputValue(detail.startDatetime);
			const [datePart, timePart] = seeded.split('T');
			editDraftDate = datePart ?? '';
			editDraftTime = timePart ?? '';
			editDraft = seeded;
		} else if (field === 'duration_minutes') {
			// #243 (Done-when 6) — the editor is now an END composite, seeded with
			// start + duration projected to the Tallinn wall clock: existing events
			// carrying only a duration derive their end with no migration, no
			// backfill. A timeless event (no parseable start) seeds '' — same
			// posture as start_datetime's own empty seed.
			const startMs = new Date(detail.startDatetime).getTime();
			const seeded = Number.isNaN(startMs)
				? ''
				: toTallinnLocalInputValue(
						new Date(startMs + detail.durationMinutes * 60_000).toISOString()
					);
			const [datePart, timePart] = seeded.split('T');
			editDraftDate = datePart ?? '';
			editDraftTime = timePart ?? '';
			editDraft = seeded;
		} else {
			editDraft = String(fieldValue(detail, field));
		}
		editingField = field;
	}

	/** #207 — a date+time composite's own onchange seam: the native date input
	 *  and the TimeSelect each call this with their OWN new part plus the OTHER
	 *  part unchanged, recombining into the same 'YYYY-MM-DDTHH:MM' `editDraft`
	 *  every other function here already reads. Field-NEUTRAL in name and in
	 *  body (it touches only the shared draft state): #243 gave duration_minutes
	 *  an END composite of the same shape, so both fields' four controls call
	 *  this one function — a `start_datetime`-flavoured name would now be wrong
	 *  at half the call sites. */
	function updateCompositeDraft(datePart: string, timePart: string): void {
		editDraftDate = datePart;
		editDraftTime = timePart;
		editDraft = datePart && timePart ? `${datePart}T${timePart}` : '';
	}

	/** #207 — commit = focus leaving the WHOLE composite. `focusout` bubbles
	 *  (unlike `blur`), so one listener on the wrapper catches every part; a
	 *  `relatedTarget` still INSIDE the wrapper means focus only moved between
	 *  the composite's own date/hour/minute controls, which must NOT commit. */
	function handleStartDatetimeFocusOut(e: FocusEvent): void {
		const wrapper = e.currentTarget as HTMLElement;
		const next = e.relatedTarget as Node | null;
		if (next && wrapper.contains(next)) return;
		confirmFieldEdit('start_datetime', false);
	}

	/** #243 — the same wrapper-focusout commit rule, for the duration_minutes
	 *  END composite. */
	function handleDurationEndFocusOut(e: FocusEvent): void {
		const wrapper = e.currentTarget as HTMLElement;
		const next = e.relatedTarget as Node | null;
		if (next && wrapper.contains(next)) return;
		confirmFieldEdit('duration_minutes', false);
	}

	/** Restores focus to the pencil button for `field`, once it has remounted
	 *  (the `{#if editingField === field}` branch flips on the tick AFTER
	 *  `editingField` is cleared, so the focus call waits for `tick()` rather
	 *  than firing synchronously against a not-yet-mounted button). Shared by
	 *  every editor-dismissal path that owes the pencil focus back: Escape,
	 *  Enter (both the commit and the no-change-cancel branches) — see the
	 *  `restoreFocus` param on `cancelFieldEdit`/`confirmFieldEdit` for who
	 *  does NOT call this (#105 review F1/F2). */
	function restorePencilFocus(field: EditableEventField): void {
		tick().then(() => pencilRefs[field]?.focus());
	}

	/** `field` is the editor being closed — required so focus can be sent back
	 *  to the pencil that opened it (#105: an unmounted activeElement would
	 *  otherwise drop focus to <body>, forcing a keyboard user to Tab back
	 *  from the top of the page).
	 *
	 *  `restoreFocus` — #105 review F2: a blur means the user ALREADY moved
	 *  focus somewhere else deliberately (tapped another field, clicked away),
	 *  and yanking it back to the pencil fights that choice. Only a KEYBOARD
	 *  dismissal (Escape, or an Enter that turned out to carry no change) owes
	 *  the pencil its focus back — blur handlers pass `false`. */
	function cancelFieldEdit(field: EditableEventField, restoreFocus: boolean): void {
		editingField = null;
		editDraft = '';
		editDraftDate = '';
		editDraftTime = '';
		if (restoreFocus) restorePencilFocus(field);
	}

	/** The draft, coerced to the value that would go on the wire — or `null`
	 *  when the draft is not writable at all and the confirm must degrade to a
	 *  cancel:
	 *    • start_datetime — an empty/unparseable `datetime-local` (the timeless
	 *      event's pencil seeds '', and an editor can clear the input). There is
	 *      no "unset the start" gesture in TE.4, so a blur on an untouched empty
	 *      picker writes NOTHING rather than throwing or clearing.
	 *    • duration_minutes — a cleared, non-finite or NEGATIVE number. A
	 *      cleared input coerces to 0, and `eventDetail` reads the event's own
	 *      `duration_minutes` with `??`, so a literal 0 is not nullish and would
	 *      permanently MASK the series' inherited duration instead of restoring
	 *      it. (Clearing back to inherited would need the empty-list clear POST
	 *      — a separate gesture, not this one.)
	 *    • name/location/description — an EMPTY (or whitespace-only) text draft,
	 *      for the very same reason (#104 review F2). Posting `string: ''` is not
	 *      the documented clear gesture (that is the empty-LIST POST), and its
	 *      outcome is unspecified either way: if Entu stores the empty value,
	 *      `eventDetail` reads `event.location?.[0]?.string ?? series
	 *      .default_location` and '' is not nullish, so the blank permanently
	 *      masks the series default; if Entu drops it, the trailing DELETEs still
	 *      remove the old value and the field silently reverts to the series
	 *      default server-side while the page shows '' optimistically. TE.4 has
	 *      no "unset" gesture, so a cleared text field CANCELS, exactly like a
	 *      cleared picker or a cleared duration. */
	function draftWireValue(field: EditableEventField): string | number | null {
		if (field === 'start_datetime') {
			const iso = tallinnLocalToUtcIso(editDraft);
			return iso === '' ? null : iso;
		}
		// duration_minutes is handled separately by `draftDurationEndMinutesRaw`
		// (#243) — its draft is now an END composite, not a raw number, and its
		// confirm needs the RAW (possibly non-positive) minutes to tell "no
		// change" from "an invalid range", which this generic null-or-value shape
		// cannot express.
		if (editDraft.trim() === '') return null;
		return editDraft;
	}

	/** #243 — duration_minutes' own draft resolution: `editDraft` is the END
	 *  composite's 'YYYY-MM-DDTHH:MM' Tallinn wall clock (same shape
	 *  start_datetime's editor uses), not a raw number any more. `null` when
	 *  there is nothing writable at all — an empty/partial composite, or no
	 *  parseable `start_datetime` to derive against (the timeless-event guard).
	 *  Otherwise the RAW elapsed minutes (possibly zero or negative — the
	 *  caller decides what that means) from two INDEPENDENT UTC conversions:
	 *  start read straight off `detail.startDatetime`, end converted the SAME
	 *  way start_datetime's own editor does (`tallinnLocalToUtcIso`) — DST-safe,
	 *  never wall-clock subtraction. */
	function draftDurationEndMinutesRaw(): number | null {
		if (!detail || editDraft.trim() === '') return null;
		const endIso = tallinnLocalToUtcIso(editDraft);
		if (endIso === '') return null;
		const startMs = new Date(detail.startDatetime).getTime();
		if (Number.isNaN(startMs)) return null;
		const endMs = new Date(endIso).getTime();
		return Math.round((endMs - startMs) / 60_000);
	}

	/** True when confirming would write back exactly what is displayed. Note
	 *  `before` is the DISPLAYED value, which for `name`/`duration_minutes`/
	 *  `location`/`description` may be INHERITED from the parent event_series —
	 *  so this comparison is what stops an idle pencil tap from materialising
	 *  the series default as a permanent event-level override and silently
	 *  severing inheritance. start_datetime compares INSTANTS, not strings:
	 *  the wire ISO and Entu's stored ISO can name the same moment in different
	 *  serialisations. */
	function isUnchanged(field: EditableEventField, value: string | number, before: string | number): boolean {
		if (field === 'start_datetime') {
			const a = new Date(String(value)).getTime();
			const b = new Date(String(before)).getTime();
			return !Number.isNaN(a) && !Number.isNaN(b) && a === b;
		}
		return value === before;
	}

	/** Blur/Enter confirm: applies the draft OPTIMISTICALLY (the header updates
	 *  before the write even lands) and fires `updateEventField` at once — a
	 *  failed write reverts to `before` and surfaces `editErrors[field]`. Guards
	 *  on `editingField === field` so a stray blur firing after Escape (element
	 *  removal in some browsers) or a second confirm cannot double-fire.
	 *  A confirm that carries no change (issue #104: "Cancel: Escape or blur
	 *  without change") — or no writable value at all — closes the editor and
	 *  touches the wire not at all; that branch defers to `cancelFieldEdit`,
	 *  passing `restoreFocus` straight through (#105 review F2: still a blur
	 *  when it was one).
	 *
	 *  `restoreFocus` — #105 review F1/F2 + R2-F1: it governs BOTH branches the
	 *  same way. The no-change branch hands it straight to `cancelFieldEdit`. The
	 *  write branch cannot act on it here — the pencil is DISABLED for the
	 *  write's duration, so an immediate focus attempt would race the very
	 *  `request()` call below that disables it and silently no-op — so it rides
	 *  along in `pendingFocusRestore[field]` and is honoured by
	 *  `settleFieldFocus` once `reconcile`/`revert` fires. Enter (`true`) gets
	 *  its focus back; a blur (`false`) leaves focus wherever the viewer put it,
	 *  which after a real change is very often another live control on this page
	 *  (an RSVP button, the back link) that a late restore would yank away from
	 *  mid-interaction. */
	function confirmFieldEdit(field: EditableEventField, restoreFocus: boolean): void {
		if (!selected || !detail || editingField !== field) return;
		const before = fieldValue(detail, field);
		// #243 — duration_minutes takes its own path: the derived RAW minutes
		// (which may be zero or negative) decide between "no change" (cancel,
		// silent), "an invalid range" (cancel, but SAY WHY — fail loudly, not a
		// silent no-op) and "write it". Checking against `before` BEFORE the
		// range check matters: an untouched pencil tap on a zero/unset-duration
		// event seeds end === start, which is <= 0 but equal to `before` — that
		// must cancel silently like every other idle tap, not surface a bogus
		// refusal.
		if (field === 'duration_minutes') {
			const raw = draftDurationEndMinutesRaw();
			if (raw === null || raw === before) {
				cancelFieldEdit(field, restoreFocus);
				return;
			}
			if (raw <= 0) {
				cancelFieldEdit(field, restoreFocus);
				editRangeErrors = { ...editRangeErrors, duration_minutes: true };
				return;
			}
			editingField = null;
			pendingFocusRestore[field] = restoreFocus;
			const cfg = { db: selected.db, token: getToken() ?? '' };
			const evId = detail.id;
			editWriteQueue.request(
				field,
				() =>
					updateEventField(cfg, evId, field, raw, fetch).catch((e) => {
						console.error('event detail: field edit failed', field, e);
						throw e;
					}),
				{
					apply: () => applyFieldLocally(field, raw),
					rollback: () => applyFieldLocally(field, before)
				}
			);
			return;
		}
		const value = draftWireValue(field);
		if (value === null || isUnchanged(field, value, before)) {
			cancelFieldEdit(field, restoreFocus);
			return;
		}
		editingField = null;
		// Set BEFORE `request()` — a write that resolves synchronously would
		// otherwise settle against a flag that is not there yet.
		pendingFocusRestore[field] = restoreFocus;
		const cfg = { db: selected.db, token: getToken() ?? '' };
		const evId = detail.id;
		editWriteQueue.request(
			field,
			() =>
				updateEventField(cfg, evId, field, value, fetch).catch((e) => {
					console.error('event detail: field edit failed', field, e);
					throw e;
				}),
			{
				apply: () => applyFieldLocally(field, value),
				rollback: () => applyFieldLocally(field, before)
			}
		);
	}

	/** Escape cancels on every field; Enter confirms on single-line inputs only
	 *  — the textarea's Enter is a newline, not a submit (TE.4 contract). */
	function handleFieldKeydown(e: KeyboardEvent, field: EditableEventField, multiline: boolean): void {
		if (e.key === 'Escape') {
			e.preventDefault();
			// Keyboard dismissal — the pencil owes this focus back (#105 review F2).
			cancelFieldEdit(field, true);
		} else if (e.key === 'Enter' && !multiline) {
			e.preventDefault();
			// Keyboard dismissal — same rule, whichever branch confirmFieldEdit takes.
			confirmFieldEdit(field, true);
		}
	}
</script>

<main class="min-h-screen bg-paper px-6 py-10 text-ink">
	<div class="mx-auto flex w-full max-w-md flex-col gap-4">
		<!-- The ← is markup, never message text: translators handle words only, and
		     the glyph is decorative (aria-hidden), same convention as the agenda
		     row's ▸ tap indicator (AgendaList.svelte). -->
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
			<!-- The id is not readable in the SELECTED collective (403/404) — most
			     often because the collective was switched while this page was open.
			     No Retry button: the back link above is the only action that helps. -->
			<p data-testid="event-detail-not-available" role="alert" class="text-sm">
				{m.event_detail_not_in_collective()}
			</p>
		{:else if status === 'no-collective'}
			<p data-testid="event-detail-no-collective" class="text-sm">
				{m.event_detail_no_collective()}
			</p>
		{:else if detail}
			<div class="flex flex-col gap-1.5">
				<!-- #245 — event_type: the SIXTH #157 whole-field activator. Guarded
				     like every other optional header field below: an event with no
				     `event_type` must not render a bare, empty pill — for anyone,
				     editor included (the empty-guard stays; only the ACTIVATOR is
				     rights-gated). -->
				{#if editingField === 'event_type'}
					<!-- Standing rule 1 — native <select>, the #199 canonical option
					     source (SAME list the create forms render), no second hand-typed
					     list. The activator is unmounted the instant this mounts, so the
					     select carries its OWN aria-label (unlike the button, which uses
					     an sr-only child — there is no value-bearing content here to
					     silence). An empty option keeps '' representable so opening +
					     blurring an unset type can never manufacture a value. -->
					<select
						data-testid="event-edit-input-event_type"
						aria-label={m.event_edit_event_type_aria_label()}
						class="w-fit border-b border-ink bg-transparent text-ink-2"
						value={editDraft}
						use:focusOnMount
						onchange={(e) => (editDraft = (e.currentTarget as HTMLSelectElement).value)}
						onblur={() => confirmFieldEdit('event_type', false)}
						onkeydown={(e) => handleFieldKeydown(e, 'event_type', false)}
					>
						<option value=""></option>
						{#each CANONICAL_EVENT_TYPES as type (type)}
							<option value={type}>{eventTypeLabel(type)}</option>
						{/each}
					</select>
				{:else if detail.eventType || isEditor}
					{#if isEditor}
						<!-- #157 — whole-field tap target, see the `name` field above. The
						     #211-colored badge rides INSIDE the button so its color and
						     label survive the wrap. -->
						<button
							type="button"
							data-testid="event-edit-btn-event_type"
							class="group flex min-h-11 w-fit appearance-none items-center gap-2 border-0 bg-transparent p-0 text-left disabled:opacity-40"
							disabled={editWritePending.event_type === true}
							bind:this={pencilRefs.event_type}
							onclick={() => beginFieldEdit('event_type')}
						>
							<span class="sr-only">{m.event_edit_event_type_aria_label()}</span>
							<span aria-hidden="true" class="text-xs text-ink-3 group-hover:text-ink">✎</span>
							{#if detail.eventType}
								<span
									data-testid="event-detail-type"
									class="w-fit rounded-full border px-1.5 py-0.5 font-mono text-[9px] tracking-wide uppercase {eventTypeBadgeClass(detail.eventType)}"
								>
									{eventTypeLabel(detail.eventType)}
								</span>
							{/if}
						</button>
					{:else}
						<span
							data-testid="event-detail-type"
							class="w-fit rounded-full border px-1.5 py-0.5 font-mono text-[9px] tracking-wide uppercase {eventTypeBadgeClass(detail.eventType)}"
						>
							{eventTypeLabel(detail.eventType)}
						</span>
					{/if}
				{/if}
				{#if editErrors.event_type}
					<p data-testid="event-edit-error-event_type" role="alert" class="text-xs text-red-700">
						{m.event_edit_save_error()}
					</p>
				{/if}
				<!-- #104 TE.4 — name: always present, no empty-guard needed. -->
				{#if editingField === 'name'}
					<input
						type="text"
						data-testid="event-edit-input-name"
						aria-label={m.event_edit_name_aria_label()}
						class="border-b border-ink bg-transparent font-display text-2xl"
						value={editDraft}
						use:focusOnMount
						oninput={(e) => (editDraft = (e.currentTarget as HTMLInputElement).value)}
						onblur={() => confirmFieldEdit('name', false)}
						onkeydown={(e) => handleFieldKeydown(e, 'name', false)}
					/>
				{:else if isEditor}
					<!-- #157 — the whole field (value + pencil), not just the pencil, is the
					     edit tap target: a <button> (not a div+role) so it is keyboard-
					     accessible by default, with `appearance-none`/transparent styling so
					     it still reads as the plain field display it replaces, `w-full` +
					     `min-h-11` so the target spans the field and clears the 44px minimum
					     even when the value is empty.

					     The <h1> stays OUTSIDE the button (review F2): a button's content
					     model is phrasing content only — a heading nested inside it is
					     invalid, and `role=button` makes its descendants presentational, so
					     the editor's page would lose its only h1 while a member's kept one.
					     A button IS phrasing content, so this nesting is legal and the
					     heading role survives.

					     The label rides as an sr-only NODE, not `aria-label` (review F1):
					     aria-label overrides name-from-contents, so a wrapper carrying one
					     would announce "Edit event name, button" and never speak the value
					     it now contains. As a child it composes — "Edit event name, Tuesday
					     Rehearsal, button".

					     That sr-only child sits inside the page's only <h1>, though, so
					     the HEADING would inherit it too: name-from-contents recurses into
					     the button and takes ITS accessible name, so an editor jumping by
					     heading would hear "Edit event name Tuesday Rehearsal" where a
					     member hears "Tuesday Rehearsal" — the two heading trees the #157
					     tests set out to keep identical. Naming the h1 explicitly after the
					     value span alone pins them back together without touching the
					     button's own composed name (review round 2, F1). `heading` supports
					     name-from-author, so this is a sanctioned override, not a hack. -->
					<h1
						data-testid="event-detail-name"
						aria-labelledby="event-detail-name-value"
						class="font-display text-2xl"
					>
						<button
							type="button"
							data-testid="event-edit-btn-name"
							class="group flex min-h-11 w-full appearance-none items-center gap-2 border-0 bg-transparent p-0 text-left font-display text-2xl disabled:opacity-40"
							disabled={editWritePending.name === true}
							bind:this={pencilRefs.name}
							onclick={() => beginFieldEdit('name')}
						>
							<span class="sr-only">{m.event_edit_name_aria_label()}</span>
							<!-- `group`/`group-hover:text-ink` on all five whole-field buttons
							     (review round 2, F2): the pre-#157 pencil buttons each carried
							     `hover:text-ink`, and growing the target to the whole field
							     dropped the only pointer cue that the region is clickable —
							     Tailwind's preflight sets no `cursor: pointer` for <button>, so a
							     mouse user would otherwise get no feedback at all. -->
							<span aria-hidden="true" class="text-xs text-ink-3 group-hover:text-ink">✎</span>
							<span id="event-detail-name-value">{detail.name}</span>
						</button>
					</h1>
				{:else}
					<h1 data-testid="event-detail-name" class="font-display text-2xl">{detail.name}</h1>
				{/if}
				{#if editErrors.name}
					<p data-testid="event-edit-error-name" role="alert" class="text-xs text-red-700">
						{m.event_edit_save_error()}
					</p>
				{/if}

				<!-- #104 TE.4 — start_datetime: guarded like the original (no parseable
				     start shows no time line — formatting an Invalid Date would throw
				     mid-render), but a rights-holder still gets the pencil even then, so
				     a timeless event can have a start set inline. -->
				{#if editingField === 'start_datetime'}
					<!-- #207 rule 5 — a composite under the SAME surface testid (now on
					     this wrapper): the native date input (native picker stays, Gama
					     ruling) plus the TimeSelect hour/minute composite. The wrapper is a
					     NAMED role="group" — it supplies the accessible name for the whole
					     composite, so the controls inside must NOT repeat that name
					     (double-announcement, #207 review F2). Commit = focus leaving the
					     WHOLE wrapper (see `handleStartDatetimeFocusOut`) — moving between
					     the composite's own parts is not a commit; `focusout` bubbles, so
					     one wrapper listener is correct for it. The Escape/Enter gesture,
					     by contrast, goes on each real control: a role="group" is
					     non-interactive and must not own key listeners (#207 review F3). -->
					<div
						data-testid="event-edit-input-start_datetime"
						role="group"
						aria-label={m.event_edit_start_datetime_aria_label()}
						class="flex flex-wrap items-center gap-2 text-ink-2"
						onfocusout={handleStartDatetimeFocusOut}
					>
						<input
							type="date"
							data-testid="event-edit-input-start_datetime-date"
							aria-label={m.time_select_date_label()}
							class="min-w-0 border-b border-ink bg-transparent text-ink-2"
							value={editDraftDate}
							use:focusOnMount
							oninput={(e) =>
								updateCompositeDraft((e.currentTarget as HTMLInputElement).value, editDraftTime)}
							onkeydown={(e) => handleFieldKeydown(e, 'start_datetime', false)}
						/>
						<TimeSelect
							prefix="event-edit-input-start_datetime"
							value={editDraftTime}
							onkeydown={(e) => handleFieldKeydown(e, 'start_datetime', false)}
							onchange={(v) => updateCompositeDraft(editDraftDate, v)}
						/>
					</div>
				{:else if startAt}
					<!-- #151 — text-base, not text-sm: this line is REPLACED in place by the
					     datetime-local input above, which renders at the 16px control default
					     (#130). At text-sm the header visibly grew on entering edit mode and
					     shrank on leaving. Every inline-edit display counterpart in this
					     header holds the same 16px body tier for the same reason. -->
					{#if isEditor}
						<!-- #157 — whole-field tap target, see the `name` field above. -->
						<button
							type="button"
							data-testid="event-edit-btn-start_datetime"
							class="group flex min-h-11 w-full appearance-none flex-wrap items-center gap-2 border-0 bg-transparent p-0 text-left text-base text-ink-2 disabled:opacity-40"
							disabled={editWritePending.start_datetime === true}
							bind:this={pencilRefs.start_datetime}
							onclick={() => beginFieldEdit('start_datetime')}
						>
							<span class="sr-only">{m.event_edit_start_datetime_aria_label()}</span>
							<span aria-hidden="true" class="text-xs text-ink-3 group-hover:text-ink">✎</span>
							<span data-testid="event-detail-time" class="flex flex-wrap items-center gap-2">
								<!-- The comma is plain text, NOT an aria-hidden decoration like the
								     back link's ←: it is real punctuation, and hiding it would run
								     "September 1" straight into "19:00" for a screen reader. -->
								<span data-testid="event-detail-date">{dateFmt.format(startAt)}</span>, {timeRange(
									startAt,
									detail.durationMinutes
								)}
							</span>
						</button>
					{:else}
						<p data-testid="event-detail-time" class="flex flex-wrap items-center gap-2 text-base text-ink-2">
							<!-- The comma is plain text, NOT an aria-hidden decoration like the
							     back link's ←: it is real punctuation, and hiding it would run
							     "September 1" straight into "19:00" for a screen reader. -->
							<span data-testid="event-detail-date">{dateFmt.format(startAt)}</span>, {timeRange(
								startAt,
								detail.durationMinutes
							)}
						</p>
					{/if}
				{:else if isEditor}
					<!-- No parseable start: nothing to show but the affordance itself, which
					     still gets the #157 full-width, 44px-tall target (an empty optional
					     field is exactly where a glyph-sized target hurt most). -->
					<button
						type="button"
						data-testid="event-edit-btn-start_datetime"
						class="group flex min-h-11 w-full appearance-none items-center gap-2 border-0 bg-transparent p-0 text-left text-xs text-ink-3 disabled:opacity-40"
						disabled={editWritePending.start_datetime === true}
						bind:this={pencilRefs.start_datetime}
						onclick={() => beginFieldEdit('start_datetime')}
					>
						<span class="sr-only">{m.event_edit_start_datetime_aria_label()}</span>
						<!-- Same `group-hover` cue as the four populated fields: this branch
						     kept a button-level `hover:text-ink` while they had none, which
						     made the header's hover treatment inconsistent with itself. -->
						<span aria-hidden="true" class="group-hover:text-ink">✎</span>
					</button>
				{/if}
				{#if editErrors.start_datetime}
					<p data-testid="event-edit-error-start_datetime" role="alert" class="text-xs text-red-700">
						{m.event_edit_save_error()}
					</p>
				{/if}

				<!-- #243 — duration_minutes: the number input is GONE. The field keeps
				     its duration_minutes IDENTITY (this testid, the wire, the queue key)
				     but its editor is now an END composite — the SAME rule-5 shape as
				     start_datetime, seeded with start + duration projected to the
				     Tallinn wall clock (`beginFieldEdit`). Commit derives minutes from
				     two INDEPENDENT UTC conversions (`draftDurationEndMinutesRaw`) and
				     writes duration_minutes ONLY; start_datetime is never touched.

				     `event_edit_duration_minutes_aria_label` names BOTH halves of this
				     field ("Edit end and duration") on purpose — review #243 F1: the
				     key labels the END composite here AND the pencil below, whose
				     visible value is still the duration (`agenda_duration_min`, "90
				     min"). An end-only label announced "Edit end, 90 min"; a
				     duration-only one would label a control that asks for a date and a
				     time. Teaching the DISPLAY surfaces to speak end/day-span (this
				     line, `timeRange`, AgendaList) is a separate, PO-copy call —
				     nothing here reads a multi-day span as anything but minutes. -->
				{#if editingField === 'duration_minutes'}
					<div
						data-testid="event-edit-input-duration_minutes"
						role="group"
						aria-label={m.event_edit_duration_minutes_aria_label()}
						class="flex flex-wrap items-center gap-2 text-ink-2"
						onfocusout={handleDurationEndFocusOut}
					>
						<input
							type="date"
							data-testid="event-edit-input-duration_minutes-date"
							aria-label={m.time_select_date_label()}
							class="min-w-0 border-b border-ink bg-transparent text-ink-2"
							value={editDraftDate}
							use:focusOnMount
							oninput={(e) =>
								updateCompositeDraft((e.currentTarget as HTMLInputElement).value, editDraftTime)}
							onkeydown={(e) => handleFieldKeydown(e, 'duration_minutes', false)}
						/>
						<TimeSelect
							prefix="event-edit-input-duration_minutes"
							value={editDraftTime}
							onkeydown={(e) => handleFieldKeydown(e, 'duration_minutes', false)}
							onchange={(v) => updateCompositeDraft(editDraftDate, v)}
						/>
					</div>
				{:else if detail.durationMinutes > 0 || isEditor}
					{#if isEditor}
						<!-- #157 — whole-field tap target, see the `name` field above. -->
						<button
							type="button"
							data-testid="event-edit-btn-duration_minutes"
							class="group flex min-h-11 w-full appearance-none items-center gap-2 border-0 bg-transparent p-0 text-left text-base text-ink-2 disabled:opacity-40"
							disabled={editWritePending.duration_minutes === true}
							bind:this={pencilRefs.duration_minutes}
							onclick={() => beginFieldEdit('duration_minutes')}
						>
							<span class="sr-only">{m.event_edit_duration_minutes_aria_label()}</span>
							<span aria-hidden="true" class="text-xs text-ink-3 group-hover:text-ink">✎</span>
							{#if detail.durationMinutes > 0}
								<span data-testid="event-detail-duration">
									{m.agenda_duration_min({ minutes: detail.durationMinutes })}
								</span>
							{/if}
						</button>
					{:else}
						<p class="flex items-center gap-2 text-base text-ink-2">
							<span data-testid="event-detail-duration">
								{m.agenda_duration_min({ minutes: detail.durationMinutes })}
							</span>
						</p>
					{/if}
				{/if}
				{#if editRangeErrors.duration_minutes}
					<!-- #243 — end at or before start: a REASON, not the generic
					     save-error copy (fail loudly with the actual cause). -->
					<p data-testid="event-edit-error-duration_minutes" role="alert" class="text-xs text-red-700">
						{m.event_end_before_start()}
					</p>
				{:else if editErrors.duration_minutes}
					<p data-testid="event-edit-error-duration_minutes" role="alert" class="text-xs text-red-700">
						{m.event_edit_save_error()}
					</p>
				{/if}

				<!-- #104 TE.4 — location: a rights-holder gets the pencil even with no
				     location set, so it can be SET inline. -->
				{#if editingField === 'location'}
					<input
						type="text"
						data-testid="event-edit-input-location"
						aria-label={m.event_edit_location_aria_label()}
						class="border-b border-ink bg-transparent text-ink-2"
						list={LOCATION_SUGGESTIONS_ID}
						value={editDraft}
						use:focusOnMount
						oninput={(e) => (editDraft = (e.currentTarget as HTMLInputElement).value)}
						onfocus={ensureLocationCorpusLoaded}
						onblur={() => confirmFieldEdit('location', false)}
						onkeydown={(e) => handleFieldKeydown(e, 'location', false)}
					/>
					<datalist id={LOCATION_SUGGESTIONS_ID}>
						{#each locationSuggestions as loc (loc)}
							<option value={loc}></option>
						{/each}
					</datalist>
				{:else if detail.location || isEditor}
					{#if isEditor}
						<!-- #157 — whole-field tap target, see the `name` field above. -->
						<button
							type="button"
							data-testid="event-edit-btn-location"
							class="group flex min-h-11 w-full appearance-none items-center gap-2 border-0 bg-transparent p-0 text-left text-base text-ink-2 disabled:opacity-40"
							disabled={editWritePending.location === true}
							bind:this={pencilRefs.location}
							onclick={() => beginFieldEdit('location')}
						>
							<span class="sr-only">{m.event_edit_location_aria_label()}</span>
							<span aria-hidden="true" class="text-xs text-ink-3 group-hover:text-ink">✎</span>
							{#if detail.location}
								<span data-testid="event-detail-location">{detail.location}</span>
							{/if}
						</button>
					{:else}
						<p class="flex items-center gap-2 text-base text-ink-2">
							<span data-testid="event-detail-location">{detail.location}</span>
						</p>
					{/if}
				{/if}
				{#if editErrors.location}
					<p data-testid="event-edit-error-location" role="alert" class="text-xs text-red-700">
						{m.event_edit_save_error()}
					</p>
				{/if}

				{#if detail.conductorNames.length > 0}
					<!-- Not inline-editable, but it sits in the same header metadata stack as
					     the four fields that are, so it holds the same 16px body tier — a lone
					     14px line among them would just be the old inconsistency relocated. -->
					<p data-testid="event-detail-conductors" class="text-base text-ink-2">
						{m.event_detail_conductor_label()}: {detail.conductorNames.join(', ')}
					</p>
				{/if}

				<!-- #104 TE.4 — description: the RED spec's explicit empty-optional-field
				     case — an event with none still gets the pencil for a rights-holder,
				     otherwise the field could never be SET inline. -->
				{#if editingField === 'description'}
					<textarea
						data-testid="event-edit-input-description"
						aria-label={m.event_edit_description_aria_label()}
						class="mt-2 min-h-24 w-full border border-ink-4 bg-transparent p-2 text-ink"
						value={editDraft}
						use:focusOnMount
						oninput={(e) => (editDraft = (e.currentTarget as HTMLTextAreaElement).value)}
						onblur={() => confirmFieldEdit('description', false)}
						onkeydown={(e) => handleFieldKeydown(e, 'description', true)}
					></textarea>
				{:else if detail.description || isEditor}
					{#if isEditor}
						<!-- #157 — whole-field tap target, see the `name` field above. -->
						<button
							type="button"
							data-testid="event-edit-btn-description"
							class="group mt-2 flex min-h-11 w-full appearance-none items-start gap-2 border-0 bg-transparent p-0 text-left text-base text-ink disabled:opacity-40"
							disabled={editWritePending.description === true}
							bind:this={pencilRefs.description}
							onclick={() => beginFieldEdit('description')}
						>
							<span class="sr-only">{m.event_edit_description_aria_label()}</span>
							<span aria-hidden="true" class="text-xs text-ink-3 group-hover:text-ink">✎</span>
							{#if detail.description}
								<span data-testid="event-detail-description">{detail.description}</span>
							{/if}
						</button>
					{:else}
						<p class="mt-2 flex items-start gap-2 text-base text-ink">
							<span data-testid="event-detail-description">{detail.description}</span>
						</p>
					{/if}
				{/if}
				{#if editErrors.description}
					<p data-testid="event-edit-error-description" role="alert" class="text-xs text-red-700">
						{m.event_edit_save_error()}
					</p>
				{/if}

				<!-- #102 TE.2 — the RSVP section: the SAME RsvpControl component and
				     rsvp entity the agenda rows use, plus (for a viewer visible in this
				     event's `_owner`/`_editor` list) the tally and capacity. -->
				<section
					data-testid="event-detail-rsvp"
					class="mt-3 flex flex-col gap-2"
					aria-labelledby="event-detail-rsvp-heading"
				>
					<h2 id="event-detail-rsvp-heading" class="font-display text-lg text-ink-2">
						{m.event_detail_rsvp_heading()}
					</h2>
					<!-- Three silent-disable reasons collapse into `pending`, exactly as
					     the agenda maps them (AgendaList: `membership === 'loading' ||
					     pendingEventIds.has(id)` on upcoming rows, `pending={true}` on
					     past ones):
					       • isPast — nothing left to answer (#102 review F3).
					       • membership unresolved — the member lookup starts only AFTER
					         the event read resolves, and may fail; tapping in that window
					         reached applyRsvpChange with a null memberId, which throws and
					         surfaces the save-failed error to a genuine member (F2).
					       • rsvpPending — a write for this event is in flight.
					     `nonMember` stays separate: it is the one reason that earns a
					     visible hint. -->
					<RsvpControl
						status={myRsvp?.status ?? null}
						nonMember={membership === 'non-member'}
						pending={isPast || membership === 'loading' || rsvpPending}
						saveFailed={rsvpFailed}
						onchange={handleRsvpChange}
					/>
					<!-- Gated on the counts actually being loaded, not merely on
					     `isEditor`: rendering the moment rights resolve — ahead of the
					     tally fetch — would flash a zero-filled placeholder. -->
					{#if isEditor && tally}
						<p data-testid="event-detail-tally" class="text-xs text-ink-2" aria-live="polite">
							<span data-testid="event-detail-tally-going"
								>{m.event_detail_tally_going({ count: tally.going })}</span
							>
							·
							<span data-testid="event-detail-tally-not_going"
								>{m.event_detail_tally_not_going({ count: tally.not_going })}</span
							>
							·
							<span data-testid="event-detail-tally-maybe"
								>{m.event_detail_tally_maybe({ count: tally.maybe })}</span
							>
							·
							<span data-testid="event-detail-tally-late"
								>{m.event_detail_tally_late({ count: tally.late })}</span
							>
						</p>
						{#if detail.capacity !== null}
							<p data-testid="event-detail-capacity" class="text-xs text-ink-2">
								{m.event_detail_capacity({ going: tally.going, capacity: detail.capacity })}
							</p>
						{/if}
					{/if}
					<!-- The counts FAILED to load (#102 review round 2, F2). Shown to the
					     same viewers the tally itself is shown to — a plain member is not
					     told about a read she never issues — and never at the same time
					     as the tally: a failed read drops the counts rather than leaving
					     a stale number standing as if it were current. -->
					{#if isEditor && tallyError}
						<p
							data-testid="event-detail-tally-error"
							role="status"
							class="flex flex-wrap items-baseline gap-2 text-xs text-red-700"
						>
							<span>{m.event_detail_tally_error()}</span>
							<button
								type="button"
								data-testid="event-detail-tally-retry"
								class="underline"
								onclick={retryTally}
							>
								{m.event_detail_retry()}
							</button>
						</p>
					{/if}
				</section>

				<!-- #103 TE.3 — Works: the SAME RepertoireElement the agenda uses, fed
				     by the SAME producer (workRows.ts). Always expanded on this page —
				     the detail page IS the expanded view, no tap needed. Absent
				     entirely when the event resolves no works and the viewer has no
				     rights to add any (never an empty "Works" placeholder). -->
				{#if showWorksSection}
					<section
						data-testid="event-detail-works"
						class="mt-4 flex flex-col gap-2"
						aria-labelledby="event-detail-works-heading"
					>
						<h2 id="event-detail-works-heading" class="font-display text-lg text-ink-2">
							{m.event_detail_works_heading()}
						</h2>
						<RepertoireElement
							rows={workRows}
							expanded={true}
							onpdfclick={handlePdfClick}
							manageRights={seasonManageRights}
							seasonRights={seasonManageRights}
							eventRights={eventManageRights}
							context={worksContext}
							{pickableWorksList}
							pickableEditions={pickableEditionsList}
							{editionOptionsByRowId}
							pendingKeys={managePendingKeys}
							onaddwork={handleAddWork}
							onstatuschange={handleStatusChange}
							onpinedition={handlePinEdition}
							onremoveitem={handleRemoveItem}
							onmoveitem={handleMoveItem}
							onaddprogramitem={handleAddProgramItem}
						/>
					</section>
				{/if}

				<!-- #103 TE.3 — Attendance: PAST events only. The badge + tally are
				     domain-visible data (no rights gate); "Take attendance" opens the
				     SAME AttendanceSurface the agenda's recent rows use, fed by the
				     real loadRoster + listAttendance + listAllRsvpsForEvent reads. -->
				{#if showAttendanceSection}
					<section
						data-testid="event-detail-attendance"
						class="mt-4 flex flex-col gap-2"
						aria-labelledby="event-detail-attendance-heading"
					>
						<h2 id="event-detail-attendance-heading" class="font-display text-lg text-ink-2">
							{m.event_detail_attendance_heading()}
						</h2>
						{#if myAttendanceStatus !== null}
							<AttendanceBadge status={myAttendanceStatus} testid="event-detail-attendance-badge" />
						{/if}
						<!-- Review round 2 (F4) — the tally only renders when there is
						     something to count. `showAttendanceSection` admits a CONDUCTOR
						     onto a past event with nothing recorded (the Take-attendance
						     button needs somewhere to live), and an unconditional tally
						     greeted her with '0 present · 0 absent · 0 late' — the same
						     empty placeholder F1 removed for members. The works section
						     already models the shape: an empty rights-holder gets the Add
						     control, never a zeroed summary. -->
						{#if hasAttendanceRecords}
							<p
								data-testid="event-detail-attendance-tally"
								class="text-xs text-ink-2"
								aria-live="polite"
							>
								<span data-testid="event-detail-attendance-tally-present"
									>{m.event_detail_attendance_tally_present({ count: attendanceTally.present })}</span
								>
								·
								<span data-testid="event-detail-attendance-tally-absent"
									>{m.event_detail_attendance_tally_absent({ count: attendanceTally.absent })}</span
								>
								·
								<span data-testid="event-detail-attendance-tally-late"
									>{m.event_detail_attendance_tally_late({ count: attendanceTally.late })}</span
								>
							</p>
						{/if}
						{#if isConductorForEvent && !attendancePanelOpen}
							<TakeAttendanceButton eventName={detail.name} onclick={openAttendancePanel} />
						{/if}
						{#if attendancePanelOpen && agendaItemForPanel}
							<AttendanceSurface
								item={agendaItemForPanel}
								members={attendanceRoster}
								attendanceByMemberId={attendanceMap}
								rsvpByMemberId={attendanceRsvpMap}
								loading={attendancePanelLoading}
								error={attendancePanelError}
								pendingMemberIds={attendancePendingMemberIds}
								failedMemberIds={attendanceFailedMemberIds}
								ontoggle={handleAttendanceToggle}
								onclose={closeAttendancePanel}
							/>
						{/if}
					</section>
				{/if}

				<!-- #203 — delete: the ONE destructive action on this page, gated on the
				     SAME isEditor predicate as the pencils/tally above (rights props live
				     in the private bucket — a plain member reads no rights lists at all and
				     must never see this affordance). Two-step confirm, same posture as the
				     agenda's #197 season-manage delete rows: the trigger ARMS (writes
				     nothing), the armed pair REPLACES it so two live delete triggers can
				     never coexist, and only the confirm button destroys.
				     Review F2 — it lives at the FOOT of the article, behind a rule, and it
				     NAMES itself. The agenda's bare × is unambiguous because it sits at the
				     right edge of a named list row; sat mid-page in the field stack this one
				     read as a fifth field affordance next to the four edit pencils, with
				     nothing but the glyph to separate "delete this whole event" from "edit
				     the description". Last in both visual and tab order, with a visible
				     label, is the affordance hierarchy an irreversible whole-entity delete
				     deserves. -->
				{#if isEditor}
					<div
						data-testid="event-detail-danger-zone"
						class="mt-6 flex flex-col items-start gap-1 border-t border-ink-3/20 pt-3"
					>
						{#if deleteArmed}
							<div class="flex items-center gap-2">
								<button
									type="button"
									data-testid="event-detail-delete-confirm"
									aria-label={m.event_detail_delete_confirm_aria_label()}
									disabled={deletePending}
									aria-busy={deletePending}
									class="flex min-h-11 items-center px-1 text-xs text-red-700 underline disabled:opacity-50"
									onclick={() => void confirmDelete()}
								>
									{m.event_detail_delete_confirm_short()}
								</button>
								<button
									type="button"
									data-testid="event-detail-delete-cancel"
									aria-label={m.event_detail_delete_cancel_aria_label()}
									disabled={deletePending}
									class="flex min-h-11 items-center px-1 text-xs text-ink-2 underline hover:text-ink disabled:opacity-50"
									onclick={() => void cancelDelete()}
								>
									{m.event_detail_delete_cancel_short()}
								</button>
							</div>
						{:else}
							<!-- No aria-label, per the #157 rule the pencils above follow: the
							     button has visible content now, and aria-label would override
							     name-from-contents and silence it. The × is kept as the visual
							     marker but aria-hidden, so the accessible name is exactly the
							     label a sighted user reads (WCAG 2.5.3 label-in-name). -->
							<button
								type="button"
								data-testid="event-detail-delete"
								class="flex min-h-11 min-w-11 items-center gap-1 px-1 text-xs text-red-700 underline hover:text-red-800"
								onclick={() => void armDelete()}
							>
								<span aria-hidden="true">&times;</span>
								{m.event_detail_delete_label()}
							</button>
						{/if}
						{#if deleteError}
							<p data-testid="event-detail-delete-error" role="alert" class="text-xs text-red-700">
								{deleteErrorText(deleteError)}
							</p>
						{/if}
					</div>
				{/if}
			</div>
		{/if}
	</div>
</main>
