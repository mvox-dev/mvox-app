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
		type EventDetail,
		type EventInheritedField
	} from '$lib/events/eventDetail';
	// #304 — the series picker's write layer (reassign = atomic-overwrite POST,
	// unassign = DELETE of the series `_parent` value id — see that module's
	// header for the SPIKE-verified rights shape).
	import { reassignEventSeries, unassignEventSeries } from '$lib/events/eventSeriesActions';
	// #313 — the #196/#212 standalone-event → series conversion, relocated here
	// from the season panel (routes/+page.svelte). `convertEventToSeries` makes
	// THIS event the series' first occurrence; `createEvent` + `generateIntervalDates`
	// write the further occurrences; `resolveDatabaseEntityId` is the collective's
	// org lookup every write on this page ultimately needs.
	import { convertEventToSeries, type ConvertEventToSeriesInput } from '$lib/events/eventConvert';
	import { createEvent } from '$lib/entity/entityCreate';
	import { generateIntervalDates } from '$lib/events/recurrence';
	import { resolveDatabaseEntityId } from '$lib/collective/databaseEntity';
	// #220 — the AM/PM preference reaches every displayed clock time through
	// this ONE shared formatter (timeFormat.no-hardcoded-render.spec.ts pins
	// that no other file may keep its own 24h-rendering Intl formatter).
	import {
		tallinnHHMM,
		formatTime,
		timeFormatStore,
		tallinnLocalToUtcIso
	} from '$lib/preferences/timeFormat';
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
	import {
		deleteEvent,
		listSeriesOptionsForSeason,
		getSeriesDefaults,
		type SeriesOption,
		type SeriesDefaults
	} from '$lib/seasons/seasonManage';
	// The error discriminators live in their OWN module, not in seasonManage —
	// see deleteErrors.ts's header: importing them from seasonManage would make
	// them `undefined` under the spec's wholesale-replacement mock shape.
	import { isDeleteForbidden, isEventCascadePartial } from '$lib/seasons/deleteErrors';
	import {
		findMyMemberId,
		findMyRsvpForEvent,
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
	import {
		listWorks,
		listEditions,
		listAllEditions,
		type Edition,
		type Work
	} from '$lib/library/libraryData';
	import { unresolvedEditionWorkIds } from '$lib/repertoire/editionUnknown';
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
	// #262 — the schedule_item data layer (own read/write, program_item
	// wire-shape twin) + the #238 red-trashcan icon this section's remove
	// trigger uses (the SAME component, not a lookalike).
	import {
		listScheduleItems,
		createScheduleItem,
		updateScheduleItemField,
		removeScheduleItem,
		compareScheduleItems,
		type ScheduleItem
	} from '$lib/schedule/scheduleData';
	import DeleteTrigger from '$lib/components/DeleteTrigger.svelte';

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
	// #326 — the last write for THIS event's rsvp reconciled successfully; feeds
	// RsvpControl's `saved` prop (its own persistent status-region cue). Same
	// isCurrentWrite discrimination as myRsvp/rsvpPending/rsvpFailed below — a
	// write that settles after a navigation/collective switch must never paint
	// this page's now-different control.
	let rsvpSaved = $state(false);

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

	// ── #304 — series picker state ─────────────────────────────────────────────
	// The season-scoped option source (`listEventSeriesForSeason`, reused
	// verbatim — the SAME read the agenda's event-create picker already runs).
	// Server-confirmed write (#289, `roster_show_real_names`'s pattern, NOT the
	// rsvp/attendance queues' optimistic one): `detail.seriesId` is the only
	// thing the select's DOM value is ever bound to, so nothing on screen moves
	// until a write actually lands — a REJECTED write reverts the element's
	// live DOM value explicitly (the browser has already moved it) rather than
	// waiting on a signal that never changes.
	let seriesOptions = $state<SeriesOption[]>([]);
	// Flips true once the options fetch SETTLES (success or failure) — the
	// select itself waits for it (see the template): rendering it ahead of the
	// season-scoped options landing would show the none-option alone for one
	// frame and, worse, let the browser "preselect" a value with no matching
	// <option> yet, which native <select> resolves to whatever it has (never
	// the intended current series).
	let seriesOptionsLoaded = $state(false);
	// null = idle (no pending pick). '' = an armed UNASSIGN; any other string =
	// an armed REASSIGN to that series id. Set only when `detail.inheritedFields`
	// is non-empty — the "no ceremony" case never arms at all (see
	// `onSeriesSelectChange`).
	let seriesArmedTarget = $state<{ id: string } | null>(null);
	// The NEW series' raw field values, for the reassign preview ("what they
	// will become") — fetched once per arm via `getSeriesDefaults` (the SAME
	// source the event-create form's inheritance preview already uses). Stays
	// null for an armed UNASSIGN (nothing to fetch — the preview is just "this
	// clears") and while a REASSIGN's fetch is still in flight.
	let seriesPreviewDefaults = $state<SeriesDefaults | null>(null);
	let seriesPending = $state(false);
	let seriesError = $state<string | null>(null);
	let seriesStatus = $state('');

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
	/**
	 * #321 (PO ruling 2026-09-11) — the two library reads behind this page's
	 * repertoire PICKERS came back truncated. Both are closed sets: a work the
	 * "Add work" list does not offer cannot be added to the season's repertoire,
	 * and an edition "Add to programme" does not offer cannot go on tonight's
	 * programme. The gap reads as "it isn't in the library" — the false absence
	 * the ruling is about, not a short list. This site carried the "out of the
	 * RED-pinned scope" narrowing the ruling rejects.
	 *
	 * One flag per FEED: a truncated edition read says nothing about the works
	 * list, and a shared flag would put a false claim in the other picker.
	 */
	let libraryWorksPartial = $state(false);
	let libraryEditionsPartial = $state(false);
	/**
	 * #329 (review) — the scoped half of the truncation fix, verbatim the
	 * agenda's (routes/+page.svelte): a repertoire row the collective-wide
	 * edition read could not settle (no matched option, or a pin it could not
	 * name) gets ONE `listEditions(workId)`, and the answer lands here keyed by
	 * work id. Merged into `editionOptionsByRowId`, its key set handed down as
	 * `editionsResolvedWorkIds` — a work in here is a fact again (named pin, or
	 * a genuine known-absence when the scoped list is empty).
	 *
	 * The requested-set is the dispatch guard, not a render input, so it stays
	 * out of $state. A FAILED read stays in it and out of the map: the row keeps
	 * the unknown wording, which is all a read that did not answer leaves us.
	 */
	let scopedEditionsByWorkId = $state<Record<string, PickerOption[]>>({});
	let scopedEditionWorkIdsRequested = new Set<string>();
	let seasonRepertoire = $state<RepertoireItem[]>([]);
	// #311 — this page opts `pickableWorksVisible` in: its `loadManagePickers`
	// is a single generation-guarded Promise.all settling BOTH of
	// `pickableWorksList`'s inputs (`libraryWorks`/`seasonRepertoire`) with
	// distinct success/catch paths — exactly the one-flag shape the main
	// agenda flow gates on (research-311). True before the Promise.all
	// dispatches, false in BOTH its settle paths.
	let libraryPickersLoading = $state(false);
	// #311 — the second signal the sticky effect needs: `!libraryPickersLoading`
	// alone cannot tell a settle that SUCCEEDED apart from one that FAILED (the
	// catch clears the loading flag too) — see the main agenda flow's own
	// `libraryPickersLoadSucceeded` for the full reasoning, mirrored here.
	let libraryPickersLoadSucceeded = $state(false);
	// #311 — sibling of the main flow's page-level scalar. `undefined` = not
	// yet decided; RepertoireElement's own default (render) applies.
	let pickableWorksVisible = $state<boolean | undefined>(undefined);
	let managePendingKeys = $state<Set<string>>(new Set());
	// #324 — this page's own `repertoireQueue` failure/saved signals (the
	// agenda's #91 `manageError` idiom, propagated here since this page had
	// none: `revert()` was console.error + a silent refetch). Scoped to THIS
	// page, distinct from the agenda page's own same-named state.
	let manageError = $state(false);
	// #324/#267 shape — persistent sr-only role="status" region
	// (profile-roster-names-status idiom): mounted blank, text set
	// imperatively on a successful settle, cleared at the START of the next
	// attempt (never on a timer).
	let manageStatus = $state('');

	// ── #262 — schedule_item section state ────────────────────────────────────
	// Loaded in `loadComposeSurfaces` alongside `workRows`, under the SAME `g`
	// generation guard. Sort (datetime asc, name tie-break, #246: no ordinal)
	// is re-applied CLIENT-SIDE on every local patch (edit) via
	// `compareScheduleItems` — the data layer already sorts the initial read,
	// but an edited row's new datetime can change its position without a
	// refetch.
	let scheduleRows = $state<ScheduleItem[]>([]);
	// Gates `showScheduleSection` alongside `scheduleRows` — an editor's
	// section (and its add affordance) must not flash into existence AHEAD of
	// the read settling, the same "never a zero-filled placeholder ahead of
	// the real data" rule the RSVP tally (`tally !== null`) already follows.
	// Flips true on EITHER a successful or a failed read (a failed read still
	// leaves an editor able to try adding the first item).
	let scheduleLoaded = $state(false);
	// Add form: date defaults to the EVENT's own Tallinn date (the concert-day
	// commission — a schedule item almost always shares the event's calendar
	// day) via a plain native date input the editor can still override; time
	// starts empty on the TimeSelect composite (no default guess).
	let scheduleAddOpen = $state(false);
	let scheduleAddName = $state('');
	let scheduleAddDate = $state('');
	let scheduleAddTime = $state('');
	// One row editable at a time (mirrors `editingField`'s single-slot rule,
	// scoped to schedule rows instead of the event's own fields).
	let scheduleEditingId = $state<string | null>(null);
	let scheduleEditName = $state('');
	let scheduleEditDate = $state('');
	let scheduleEditTime = $state('');
	// One row armed for removal at a time — the #238 two-step idiom.
	let scheduleRemoveArmedId = $state<string | null>(null);
	let scheduleWritePending = $state<Record<string, boolean>>({});
	// #262 review F1/F4 — the per-key error slot carries the MESSAGE, not a bare
	// boolean: the same key set the write queue uses (`schedule-add`,
	// `schedule-edit-name-{id}`, `schedule-edit-datetime-{id}`,
	// `schedule-remove-{id}`), so every failed write AND every pre-write refusal
	// has somewhere row-local to speak. Held as a getter rather than a rendered
	// string so the copy follows a locale switch — the `eventCreateError` shape
	// on the agenda page.
	let scheduleErrors = $state<Record<string, (() => string) | null>>({});
	// #328 — ONE region shared by every write kind this queue carries (add,
	// per-row name/datetime edit, remove — Gama's one-node-PER-SURFACE
	// ruling: the schedule section is one surface, one queue). Matches the
	// #324/#267 shape (`manageStatus`/`editStatus` on this same page):
	// persistent role="status" region, mounted blank, text set imperatively
	// on a successful settle, cleared at the START of the next attempt.
	let scheduleStatus = $state('');
	/** Which add-form box the current refusal belongs to — always set WITH the
	 *  message (#132/T2 review F2: a refusal that names no box is a dead end for
	 *  anyone who cannot see which one is empty). `null` = form-wide, which is
	 *  what a failed write is. */
	let scheduleAddErrorField = $state<'name' | 'datetime' | null>(null);

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
	/** #321 (PO ruling 2026-09-11) — the member read behind the panel's rows was
	 *  partial. The panel is a CLOSED SET: a singer with no row cannot be marked
	 *  present, and the absent row reads as "she is not a member". Assigned from
	 *  every panel load and cleared with `attendanceRoster`, so the claim never
	 *  outlives the rows it is about. */
	let attendanceRosterPartial = $state(false);
	let attendanceRsvpMap = $state<Record<string, { rsvpId: string; status: string }>>({});
	// #15-shaped guard, per member id (attendanceChangeQueue.ts doc).
	let attendancePendingMemberIds = $state<Set<string>>(new Set());
	let attendanceFailedMemberIds = $state<Set<string>>(new Set());
	// #327 — members whose last write for THIS event's attendance RECONCILED
	// successfully; feeds AttendanceSurface's `savedMemberIds` prop. Same
	// isCurrentAttendanceWrite discrimination as attendanceMap/pending/failed
	// below — a write that settles after a navigation/collective switch must
	// never paint this page's now-different panel.
	let attendanceSavedMemberIds = $state<Set<string>>(new Set());

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

	/**
	 * #304 — SPECIFICALLY owner-tier (not merely `_editor`), off the SAME
	 * `ownerIds` the tally/isEditor rule already reads. UNASSIGN (a `_parent`
	 * value DELETE) is owner-gated on the wire (SPIKE, probe-304-parent-rights-
	 * gate-live-2026-09-10); an `_editor`-only viewer gets a 403 for a delete
	 * the picker must never even offer. `ownerIds` already carries the FULL
	 * aggregate (inherited + direct — the probe's own tester-rights-selfcheck
	 * shows Entu folding an inherited database-level owner into the same
	 * list), so this is pure computation over data already loaded, no second
	 * read (same economy `isEditor` itself follows).
	 */
	const isOwnerTier = $derived(
		detail !== null && selected !== null && detail.ownerIds.includes(selected.personId)
	);

	/**
	 * #304 (Gama ruling 5613471404) — true exactly when the "not in a series"
	 * OPTION must be withheld AND the rights-note shown: a confirmed
	 * NON-owner, on an event that currently HAS a series (nothing to unassign
	 * on a standalone event, so withholding/explaining would be noise). One
	 * condition serves both the option's absence and the note's presence —
	 * they are the same case by the ruling's own wording ("option absent …
	 * PLUS a … note").
	 */
	const seriesUnassignGated = $derived(
		detail !== null && !isOwnerTier && detail.seriesId !== null
	);

	// ── #313 — the #196/#212 standalone-event → series conversion ─────────────
	// RELOCATED here from the season panel's per-row `season-manage-event-
	// convert-<id>` control (routes/+page.svelte): "every event should have
	// these administrator controls on their page" (Mihkel, #313). One slot,
	// not keyed by event id — this page ever shows exactly ONE event, unlike
	// the panel's list.
	//
	// THE GATE — `isEditor`, deliberately NOT `isOwnerTier`: research-313
	// confirmed the conversion's wire (a plain series CREATE + one `_parent`
	// APPEND on the event, see eventConvert.ts) is editor-reachable, the SAME
	// tier the panel's own gate (`manageableSeasonRights === 'editor'`) already
	// required — unlike the #304 unassign beside it on this page, which is
	// owner-gated because ITS wire op is a `_parent` value DELETE (isOwnerTier's
	// own doc comment). Rendered only for a STANDALONE event
	// (`detail.seriesId === null` — converting a series child is meaningless)
	// that HAS a season (`detail.seasonId !== null` — the new series is
	// parented to it; no season, nowhere to put it), and absent (never
	// disabled) while `detail` itself is unresolved — the #301/#304 fail-closed
	// posture every other rights-gated control on this page already follows.
	const canConvert = $derived(
		detail !== null && isEditor && detail.seriesId === null && detail.seasonId !== null
	);

	let eventConvertOpen = $state(false);
	let eventConvertIntervalDays = $state('7');
	let eventConvertDuration = $state('');
	let eventConvertEndDate = $state('');
	let eventConvertSubmitting = $state(false);
	/** Already the localized message (a failure's `{step}` / a count already
	 *  filled in) — not a raw error, so the render side stays a plain string
	 *  print. */
	let eventConvertError = $state<string | null>(null);
	/** Which box a refusal belongs to (#196 review F2). `null` = form-wide (a
	 *  failed write, an event with no start) and names no box. */
	type EventConvertErrorField = 'interval' | 'duration' | 'end' | null;
	let eventConvertErrorField = $state<EventConvertErrorField>(null);
	/** Non-null while the occurrence loop runs — `current` is the occurrence IN
	 *  FLIGHT (1-based). */
	let eventConvertProgress = $state<{ current: number; total: number } | null>(null);
	/**
	 * #196 review F1 — what a STOPPED occurrence run still owes. The conversion
	 * itself already landed (the series exists and the event is linked to it),
	 * so a re-submit must never re-convert: it picks up at the occurrence that
	 * failed. No `eventId` field (unlike the panel-era shape this relocates):
	 * this page shows exactly one event, and `resetConvertState` below drops
	 * the record the moment the route/collective moves to a different one.
	 */
	type EventConvertResume = {
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
	/** The conversion form's own dialog element — focus moves into it on open,
	 *  and its Escape handler is what dismisses it (the panel-era
	 *  `series-create-form` contract this relocates). */
	let eventConvertFormEl = $state<HTMLDivElement | null>(null);

	/** Mirrors `resetDeleteState`/`resetSeriesState`: a fresh (or superseded)
	 *  load must not carry the PREVIOUS event's conversion state — armed form,
	 *  in-flight submit, or a stopped run's resume record — across the switch. */
	function resetConvertState(): void {
		eventConvertOpen = false;
		eventConvertIntervalDays = '7';
		eventConvertDuration = '';
		eventConvertEndDate = '';
		eventConvertError = null;
		eventConvertErrorField = null;
		eventConvertProgress = null;
		eventConvertResume = null;
	}

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
			resetSeriesState();
			resetConvertState();
			return;
		}
		status = 'loading';
		detail = null;
		resetRsvpState();
		resetComposeState();
		resetDeleteState();
		resetConvertState();
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
		rsvpSaved = false;
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

	/** #304 — mirrors resetDeleteState: a fresh (or superseded) load must not
	 *  carry the PREVIOUS event's armed/pending/error/status series-picker
	 *  state across the switch (the generation-guard test's exact scenario —
	 *  a write started under the old event must never paint the new one). */
	function resetSeriesState(): void {
		seriesOptions = [];
		seriesOptionsLoaded = false;
		seriesArmedTarget = null;
		seriesPreviewDefaults = null;
		seriesPending = false;
		seriesError = null;
		seriesStatus = '';
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
		// #321 — the claims go with the lists they describe, so a truncation found
		// in the collective being left never captions the next one's pickers.
		libraryWorksPartial = false;
		libraryEditionsPartial = false;
		// #329 review — the scoped per-work answers belong to the event/collective
		// they were read under, and so does the "already asked" guard: dropping
		// only the map would leave the guard vetoing every re-read after a switch.
		scopedEditionsByWorkId = {};
		scopedEditionWorkIdsRequested = new Set<string>();
		seasonRepertoire = [];
		// #311 — same synchronous pass as the blanking above, mirroring the main
		// agenda flow's `resetManagement`: the sticky effect must not treat this
		// now-blanked `libraryWorks`/`seasonRepertoire` as a genuine settle
		// before `loadManagePickers` (or, for a non-rights-holder, nothing at
		// all) has had its own say.
		libraryPickersLoading = true;
		libraryPickersLoadSucceeded = false;
		managePendingKeys = new Set();
		// #324 review F1 — the write cues go with the rows they describe, exactly
		// as `resetSeriesState` clears both `seriesError` and `seriesStatus` a
		// few lines up: a failure raised for the event being left must never
		// caption the next one's works section, and the sr-only region must not
		// still read "saved" from an older event's settle.
		manageError = false;
		manageStatus = '';
		// #328 review F1 — the inline-field cue is the same kind of per-SUBJECT
		// claim as `manageStatus` above and `scheduleStatus` below, and goes down
		// with them: without this, a settle on the event being left keeps
		// captioning the next one's field region, which would read "saved" from
		// its first render for a write the editor never made there.
		editStatus = '';
		scheduleRows = [];
		scheduleLoaded = false;
		scheduleAddOpen = false;
		scheduleAddName = '';
		scheduleAddDate = '';
		scheduleAddTime = '';
		scheduleEditingId = null;
		scheduleEditName = '';
		scheduleEditDate = '';
		scheduleEditTime = '';
		scheduleRemoveArmedId = null;
		scheduleWritePending = {};
		scheduleErrors = {};
		// #328 — the write cue goes with the rows it describes, exactly as
		// `manageStatus` above: a settle for the event being left must never
		// caption the next one's schedule section.
		scheduleStatus = '';
		scheduleAddErrorField = null;
		attendanceMap = {};
		attendancePanelOpen = false;
		attendancePanelLoading = false;
		attendancePanelError = false;
		attendanceRoster = [];
		attendanceRosterPartial = false;
		attendanceRsvpMap = {};
		attendancePendingMemberIds = new Set();
		attendanceFailedMemberIds = new Set();
		attendanceSavedMemberIds = new Set();
	}

	/** Membership + the viewer's own rsvp for THIS event. `g` guards against a
	 *  superseded collective/param switch clobbering a newer load, same pattern
	 *  as `loadForSelected`.
	 *
	 *  #329 (ruling on #321's residual) — the own-answer read is the SCOPED
	 *  one-row `findMyRsvpForEvent` (event.reference=evId AND
	 *  _parent.reference=personId, limit=1), not the person-lifetime
	 *  `listMyRsvps` the agenda uses for its whole-season row map. The lifetime
	 *  read has a reachable cap (#321: limit=500, a ten-year weekly member
	 *  clears it on real rows); deriving this page's single answer from it could
	 *  print "not answered" for an event she DID answer — a negative derived
	 *  from a truncated read, not a fact. The scoped read has no such cap to
	 *  fall past: its empty result IS the fact of no answer, so there is no
	 *  unknown state to render here, only found-or-absent. */
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

		findMyRsvpForEvent(cfg, personId, evId)
			.then((entry) => {
				if (g !== generation) return;
				myRsvp = entry;
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
			.then(([rows, activeMembersRead]) => {
				if (g !== generation) return;
				// #321 — the active-member read is here only as a FILTER on the tally
				// (drop answers from people who have since left), never as a rendered
				// list, so its `truncated` gets no notice of its own on this page: the
				// member list whose cardinality it is lives on /roster and says so
				// there. `listActiveMembers`' own doc states the same boundary.
				const activeMembers = activeMembersRead?.items;
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
			// #326 — and any stale SAVED cue from a previous write: the cue always
			// describes the latest write, never a settled earlier one.
			if (isPending) rsvpSaved = false;
		},
		reconcile(evId, entry) {
			const stillCurrent = isCurrentWrite(evId);
			writeGenerations.delete(evId);
			if (!stillCurrent) return;
			myRsvp = entry;
			// #326 — the write settled: the control earns the saved cue. A
			// reconciled NULL (a cleared answer) announces too — it renders
			// identically to never-answered, so the cue is the only distinguisher.
			rsvpSaved = true;
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
			// #326 — failure and saved are mutually exclusive (already cleared by
			// setPending at this attempt's start in practice; kept here too so
			// revert never depends on that ordering).
			rsvpSaved = false;
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

	/** #262 — one schedule_item row's time, the SAME formatTime(tallinnHHMM(...),
	 *  $timeFormatStore) combo `timeRange` uses above (the timeFormat
	 *  no-hardcoded-render allowlist fence: no OTHER clock-rendering path is
	 *  legal in this file). */
	function scheduleRowTime(iso: string): string {
		return formatTime(tallinnHHMM(new Date(iso)), $timeFormatStore);
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

		// #304 — the series picker's OPTIONS source, same economy as
		// `loadManagePickers` below: only ever fetched for a rights-holder (the
		// picker itself is `isEditor`-gated in the template), and only when the
		// event has a season to scope the query by — a picker with nothing to
		// offer is not worth a read.
		if (eventEditor && sid !== null) loadSeriesOptions(cfg, sid, g);

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

		// #262 — the schedule_item read, same generation guard as everything
		// else `loadComposeSurfaces` fires. Sorted by the data layer already
		// (datetime asc, name tie-break); no rights gate on the READ (members
		// see it, PO 05:30 shape point 2) — `isEditor` only gates the CRUD
		// affordances the template renders around these rows.
		listScheduleItems(cfg, loaded.id, fetch)
			.then((rows) => {
				if (g !== generation) return;
				scheduleRows = rows;
				scheduleLoaded = true;
			})
			.catch((e) => {
				console.error('event detail: schedule load failed', e);
				if (g !== generation) return;
				scheduleRows = [];
				scheduleLoaded = true;
			});

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

	/** #304 — the season-scoped series options (id + name only —
	 *  `listSeriesOptionsForSeason`, seasonManage.ts's doc explains why this is
	 *  NOT `listEventSeriesForSeason`, the agenda event-create picker's source:
	 *  that function's eventCount costs a second season-wide event read this
	 *  picker never uses). */
	function loadSeriesOptions(cfg: ComposeCfg, sid: string, g: number): void {
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

	/** Localized label for one inherited field — shared by the persistent
	 *  "comes from the series" note and the consequence-preview block. */
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

	/** What `field` would BECOME under `defaults` (the target series' raw
	 *  values) — the reassign half of the consequence preview. `durationMinutes`
	 *  stringifies; `null` (the series carries none) renders as ''. */
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

	/**
	 * The select's `onchange` — arms the confirm/cancel pair when (and only
	 * when) the event actually inherits something (#304's "the safe case pays
	 * nothing" rule): with nothing inherited, the write commits straight away,
	 * no ceremony. Reassign fetches the NEW series' raw defaults for the
	 * preview (`getSeriesDefaults`, the event-create form's own inheritance-
	 * preview source); unassign needs no fetch — the preview is just "this
	 * clears".
	 */
	async function onSeriesSelectChange(e: Event): Promise<void> {
		const selectEl = e.currentTarget as HTMLSelectElement;
		const newId = selectEl.value;
		if (!detail || !selected) return;
		const previousId = detail.seriesId ?? '';
		seriesError = null;
		seriesStatus = '';
		if (newId === previousId) {
			// Picked back to the already-committed value — same as a cancel.
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
		if (newId === '') return; // unassign — nothing to fetch
		const cfg = { db: selected.db, token: getToken() ?? '' };
		try {
			const defaults = await getSeriesDefaults(cfg, newId);
			if (seriesArmedTarget?.id !== newId) return; // superseded by a later pick
			seriesPreviewDefaults = defaults;
		} catch (err) {
			console.error('event detail: series preview load failed', err);
			if (seriesArmedTarget?.id !== newId) return;
			seriesArmedTarget = null;
			selectEl.value = previousId;
			seriesError = m.event_detail_series_save_error();
		}
	}

	/** Back to idle: the select's DOM value is forced back to the last
	 *  server-confirmed series (the browser has already moved it to the user's
	 *  pick — same forced-resync discipline `onRosterNamesChange` follows,
	 *  #267), the confirm/cancel pair unmounts, nothing was written. */
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

	/** The confirm tap — commits whatever `seriesArmedTarget` names. */
	async function confirmSeriesChange(): Promise<void> {
		if (!seriesArmedTarget || seriesPending) return;
		const selectEl = document.querySelector<HTMLSelectElement>('[data-testid="event-series-select"]');
		await commitSeriesChange(seriesArmedTarget.id, selectEl);
	}

	/**
	 * The one write path — reached either straight from `onSeriesSelectChange`
	 * (nothing inherited, no ceremony) or from `confirmSeriesChange` (the armed
	 * pair). #289's rule verbatim (`onRosterNamesChange`'s pattern): the local
	 * value changes ONLY after the write returns. On success the page
	 * re-reads the event (`refreshEventDetail`) so every merged field — not
	 * just the series ref — shows the NEW values, never stale inherited text.
	 * On failure the select's DOM value is forced back to what the server
	 * still holds and the error names what did not happen; `detail` is left
	 * completely untouched. `g` is captured BEFORE the write, same idiom as
	 * every other queue on this page — a write that resolves after a
	 * collective switch must never paint the new view (page.series-picker.spec's
	 * generation-guard scenario).
	 */
	async function commitSeriesChange(newId: string, selectEl: HTMLSelectElement | null): Promise<void> {
		if (!detail || !selected) return;
		const g = generation;
		const evId = detail.id;
		const previousId = detail.seriesId ?? '';
		seriesPending = true;
		seriesError = null;
		seriesStatus = '';
		const cfg = { db: selected.db, token: getToken() ?? '' };
		try {
			if (newId === '') {
				await unassignEventSeries(cfg, evId);
			} else {
				await reassignEventSeries(cfg, evId, newId);
			}
			if (g !== generation) return;
			seriesArmedTarget = null;
			seriesPreviewDefaults = null;
			// The refresh BEFORE the announcement, deliberately: "saved" must mean
			// the screen already shows what was saved, never a promise that it will
			// (#289) — announcing first would open exactly the window this feature
			// exists to close, just one write later (the merged fields flashing
			// stale for one frame).
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

	/** Re-reads the event after a landed series write — the ONLY way the page
	 *  learns the new merged name/duration/location/description (this function
	 *  never re-derives them locally, so it can never drift from the read-side
	 *  merge `loadEventDetail` owns). Generation-guarded like every other
	 *  callback on this page: a refresh that resolves after a collective
	 *  switch must not repaint the view the viewer has since moved to. A
	 *  FAILED refresh is a lesser problem than losing the confirmed write —
	 *  `detail` is simply left as it was; the viewer can reload. */
	async function refreshEventDetail(evId: string, g: number): Promise<void> {
		if (!selected) return;
		try {
			const cfg = { db: selected.db, token: getToken() ?? '' };
			const refreshed = await loadEventDetail(cfg, evId);
			if (g !== generation) return;
			detail = refreshed;
		} catch (err) {
			if (g !== generation) return;
			console.error('event detail: post-series-write refresh failed', evId, err);
		}
	}

	// ── #313 — the standalone-event → series conversion, wiring relocated ─────
	// from the season panel (routes/+page.svelte's #196/#212 machinery). The
	// #196/#212 behaviour contract (form, validation, occurrence loop, resume,
	// dialog) is UNCHANGED — only the entry point, the route, and this event's
	// own `detail` as the season source are new (see page.event-convert.spec.ts
	// under this route for the pinned contract).

	/** The Tallinn wall-clock date + time a UTC instant reads as — the series'
	 *  `startTime`/`startDate` are derived from the EVENT's own `startDatetime`,
	 *  not re-typed by the operator. '' / '' on an unparseable instant. */
	function tallinnWallClockParts(isoUtc: string): { date: string; time: string } {
		const instant = new Date(isoUtc);
		if (Number.isNaN(instant.getTime())) return { date: '', time: '' };
		const parts = new Intl.DateTimeFormat('en-US', {
			timeZone: TZ,
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

	/** Opens the conversion form — interval defaults to 7 (weekly, the common
	 *  case); duration/end-date start blank, the operator supplies those, the
	 *  start itself comes from the event. The entry control it replaces is
	 *  gone the instant this flips (the template's `{#if !eventConvertOpen}`),
	 *  one entry, one meaning — the armed-delete swap idiom applied here. */
	function openEventConvertForm(): void {
		eventConvertOpen = true;
		eventConvertIntervalDays = '7';
		eventConvertDuration = '';
		eventConvertEndDate = '';
		eventConvertProgress = null;
		clearEventConvertError();
	}

	/** Unmounts the form AND forgets whatever a stopped run still owed. Safe to
	 *  do both together (unlike the series-create form's cross-collective
	 *  resume): the only callers that reach this with a record outstanding are
	 *  the operator's own exits (Cancel/Escape) and the clean finish. */
	function closeEventConvertForm(): void {
		eventConvertOpen = false;
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
	 *  finishes THAT run (the series is already on the wire, its
	 *  `interval_days`/`end_date` already written), so an edit here would be
	 *  silently discarded. */
	const eventConvertLocked = $derived(eventConvertResume !== null);

	/** Hands focus back to the entry control — it is still on screen whenever
	 *  the form is dismissed rather than finished (a finished conversion takes
	 *  the control away with the rest of the standalone-only header). */
	function restoreEventConvertFocus(): void {
		tick().then(() =>
			document.querySelector<HTMLElement>('[data-testid="event-detail-convert"]')?.focus()
		);
	}

	/** Cancel/Escape — the operator's explicit exit, and the one place a
	 *  stopped run may be ABANDONED. Refused while a write is on the wire. */
	function dismissEventConvertForm(): void {
		if (eventConvertSubmitting) return;
		closeEventConvertForm();
		restoreEventConvertFocus();
	}

	function onEventConvertFormKeydown(event: KeyboardEvent): void {
		if (event.key !== 'Escape') return;
		event.preventDefault();
		dismissEventConvertForm();
	}

	/** Focus moves INTO the dialog the moment it opens — what `role="dialog"`
	 *  promises a screen-reader user. */
	$effect(() => {
		if (eventConvertOpen && eventConvertFormEl) eventConvertFormEl.focus();
	});

	/** The failed step, duck-typed off whatever `convertEventToSeries` rejected
	 *  with (`EventConvertError#step`) — never `instanceof`: the page specs mock
	 *  `$lib/events/eventConvert` at the module boundary, so a rejection built
	 *  by hand in a test must be recognised exactly like the real class. The
	 *  fallback is 'unknown', NOT 'read-event' — naming the choreography's first
	 *  step for a rejection that carries no step would say a step failed that
	 *  never ran. */
	function eventConvertStepOf(e: unknown): string {
		if (e && typeof e === 'object' && 'step' in e) {
			const step = (e as { step?: unknown }).step;
			if (typeof step === 'string' && step) return step;
		}
		return 'unknown';
	}

	/** The collective lookup runs BEFORE `convertEventToSeries`, so its
	 *  failures belong to no conversion step. */
	const EVENT_CONVERT_RESOLVE_STEP = 'resolve-collective';

	/** WHY a pre-write refusal happened, when the step alone cannot say it.
	 *  `convertEventToSeries` refuses an event with no name and an event with
	 *  no event_type in the same 'read-event' step, and both are permanent
	 *  properties of the data — a retry never fixes either, so the retryable
	 *  "Couldn't convert the event (read-event). Try again." is the wrong thing
	 *  to say. Duck-typed for the same reason `eventConvertStepOf` is. */
	function eventConvertRefusalMessage(e: unknown): string | null {
		if (!e || typeof e !== 'object' || !('reason' in e)) return null;
		const reason = (e as { reason?: unknown }).reason;
		if (reason === 'missing-name') return m.event_convert_missing_name();
		if (reason === 'missing-event-type') return m.event_convert_missing_type();
		return null;
	}

	/**
	 * Submit — the WHOLE conversion, which is two acts, not one.
	 *
	 *   1. `convertEventToSeries` makes the event the first occurrence of a new
	 *      series carrying the typed cadence: THIS event's own season
	 *      (`detail.seasonId` — the relocation of the panel's
	 *      `manageableSeasonId`), the collective's database entity id
	 *      (`resolveDatabaseEntityId`, never guessed), and the event's OWN start
	 *      as a Tallinn wall clock (`tallinnWallClockParts`).
	 *   2. the FURTHER occurrences are written — one serial `createEvent` per
	 *      `generateIntervalDates` date after the event's own. Occurrences in
	 *      this app are materialized `event` entities, not read-time-generated.
	 *
	 * Refusals come BEFORE any fetch, each naming its own box. A clean finish
	 * closes the form and re-reads THIS event (`refreshEventDetail`) — the
	 * world refreshed, the event is a series child now. A conversion failure
	 * surfaces inline, loud, naming the failed step, and refreshes nothing. An
	 * occurrence failure records what the run still owes (`eventConvertResume`,
	 * so a re-submit finishes rather than converting a second time) and
	 * deliberately does NOT re-read the event: a refresh would show
	 * `seriesId` set, unmount this very region (the gate is
	 * `detail.seriesId === null`), and eat the only record of the unfinished
	 * run — the relocation of the panel's "the standalone list is deliberately
	 * NOT re-read" pin.
	 */
	async function submitEventConvert(): Promise<void> {
		if (eventConvertSubmitting) return; // no duplicate runs on the wire
		if (!selected || !detail || detail.seasonId === null) return;
		clearEventConvertError();

		// Single-slot, page-scoped to THIS event — no id check needed (unlike
		// the panel-era shape, this page never shows a second event's form).
		const resume = eventConvertResume;

		// The series' start is the EVENT's own — never re-typed, so it is
		// validated here rather than refused by the data layer under a step name.
		const { date: startDate, time: startTime } = tallinnWallClockParts(detail.startDatetime);
		if (!startDate || !startTime) {
			console.error('event detail: converting an event with no readable start', detail.id, detail.startDatetime);
			setEventConvertError(m.event_convert_start_missing(), null);
			return;
		}
		const intervalDays = Number(eventConvertIntervalDays);
		if (!eventConvertIntervalDays.trim() || !Number.isFinite(intervalDays) || intervalDays < 1) {
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
		const seasonId = detail.seasonId;
		const eventId = detail.id;
		// Same generation guard every other write on this page uses: a
		// collective/route switch mid-run must stop it POSTing further
		// occurrences into a screen the operator has since left, and must not
		// paint this run's outcome onto whatever is now on screen.
		const g = generation;

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
					console.error('event detail: resolving the database entity for event conversion failed', e);
					if (g === generation)
						setEventConvertError(m.event_convert_failed({ step: EVENT_CONVERT_RESOLVE_STEP }), null);
					return;
				}
				if (!resolvedDbEntityId) {
					console.error(
						'event detail: event conversion with no resolvable database entity',
						selected.personId
					);
					if (g === generation)
						setEventConvertError(m.event_convert_failed({ step: EVENT_CONVERT_RESOLVE_STEP }), null);
					return;
				}
				if (g !== generation) return;
				dbEntityId = resolvedDbEntityId;
				const input: ConvertEventToSeriesInput = {
					eventId,
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
					console.error('event detail: event conversion failed', eventId, e);
					// A pre-write REFUSAL (no name / no event_type) says what is
					// actually wrong; everything else names the step that failed.
					if (g === generation)
						setEventConvertError(
							eventConvertRefusalMessage(e) ?? m.event_convert_failed({ step: eventConvertStepOf(e) }),
							null
						);
					return;
				}
				if (g !== generation) return;
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

			for (let i = 0; i < occurrences.length; i += 1) {
				// Checked FIRST, every iteration: a switch between occurrences
				// stops the run where it stands. The remainder is NOT recorded
				// across a switch — see `EventConvertResume`'s doc.
				if (g !== generation) {
					console.warn(
						'event detail: collective/route switched mid-conversion — the series keeps the occurrences already written',
						seriesId
					);
					return;
				}
				// Set BEFORE the await — "occurrence 1 of N" while the FIRST POST
				// is in flight.
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
					console.error('event detail: generating a converted series occurrence failed', seriesId, e);
					eventConvertProgress = null;
					if (g !== generation) return;
					// STOP at the failure — no further POSTs, no rollback. Remember
					// exactly where it stopped so a re-submit RESUMES.
					eventConvertResume = {
						seriesId,
						dbEntityId,
						eventType,
						remaining: occurrences.slice(i),
						total
					};
					setEventConvertError(m.event_convert_generate_failed({ created, total }), null);
					// Deliberately NOT re-read — see this function's doc comment.
					return;
				}
			}
			// The last successful POST can itself straddle a switch (the check
			// above only catches the NEXT iteration) — one more before the
			// success writes.
			if (g !== generation) return;
			eventConvertProgress = null;
			closeEventConvertForm();
			// The write just changed the world this page reads: the event is a
			// series child now. Re-read BEFORE anything else, same discipline as
			// the series-picker's own commit (#289).
			await refreshEventDetail(eventId, g);
		} finally {
			eventConvertSubmitting = false;
		}
	}

	/** The management picker sources — only fetched for a rights-holder. */
	function loadManagePickers(cfg: ComposeCfg, sid: string | null, g: number): void {
		Promise.all([
			listWorks(cfg),
			listAllEditions(cfg),
			sid === null ? Promise.resolve<RepertoireItem[]>([]) : listRepertoireItems(cfg, sid)
		])
			.then(([worksRead, editionsRead, repertoire]) => {
				if (g !== generation) return;
				// #321 (PO ruling 2026-09-11) — each picker states its OWN feed's
				// truncation, same as the agenda's loadManagePickers.
				libraryWorks = worksRead.items;
				libraryEditions = editionsRead.items;
				libraryWorksPartial = worksRead.truncated;
				libraryEditionsPartial = editionsRead.truncated;
				seasonRepertoire = repertoire;
				libraryPickersLoading = false;
				// #311 — the ONE place this flips true: this settle completed
				// SUCCESSFULLY. The sticky effect near `pickableWorksList` reads
				// this alongside `libraryPickersLoading` before recomputing
				// `pickableWorksVisible`.
				libraryPickersLoadSucceeded = true;
			})
			.catch(() => {
				if (g !== generation) return;
				libraryWorks = [];
				libraryEditions = [];
				// #321 — a failed read says nothing about completeness, and no options
				// are left for a claim to be about.
				libraryWorksPartial = false;
				libraryEditionsPartial = false;
				seasonRepertoire = [];
				libraryPickersLoading = false;
				// #311 — explicit: a failed settle is never mistaken for one that
				// landed, so the sticky effect leaves `pickableWorksVisible`
				// exactly where the last SUCCESSFUL load put it — visible-but-
				// empty stands, same as the main agenda flow's catch.
				libraryPickersLoadSucceeded = false;
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
			// A fresh attempt clears the previous failure/saved cue — she is
			// trying again (agenda's own `manageError` rule, #324 propagates it
			// to `manageStatus` too: never a stale "saved" beside a live retry).
			if (pending) {
				manageError = false;
				manageStatus = '';
			}
		},
		reconcile(key) {
			// Only a CREATE needs the server (its id is assigned there); every
			// other write kind already holds the authoritative value locally —
			// same economy the agenda's own queue callbacks apply.
			if (key === ADD_WORK_KEY || key === ADD_PROGRAMME_KEY) refreshWorks();
			// #324 — the settle itself must say so, for every write kind.
			manageStatus = m.repertoire_manage_saved();
		},
		revert(key) {
			console.error('event detail: repertoire write failed', key);
			// None of these writes is atomic — refetch shows the TRUTH rather than
			// a rolled-back-but-possibly-wrong local guess (agenda's own F5 rule).
			refreshWorks();
			// #324 — the agenda's own `manageError` idiom, propagated to this page.
			manageError = true;
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

	// ═══════════════════════════════════════════════════════════════════════
	// #262 — the schedule_item section's write layer: add / edit / remove.
	// Same `createRepertoireWriteQueue` primitive as every other write on this
	// page, its own queue instance keyed by row id (`schedule-add`,
	// `schedule-edit-name-{id}`, `schedule-edit-datetime-{id}`,
	// `schedule-remove-{id}`) so a schedule write can never collide with a
	// works-management key running concurrently.
	// ═══════════════════════════════════════════════════════════════════════

	const SCHEDULE_ADD_KEY = 'schedule-add';

	function patchScheduleRow(id: string, patch: Partial<ScheduleItem>): void {
		scheduleRows = scheduleRows
			.map((row) => (row.id === id ? { ...row, ...patch } : row))
			.sort(compareScheduleItems);
	}
	function dropScheduleRow(id: string): void {
		scheduleRows = scheduleRows.filter((row) => row.id !== id);
	}
	function restoreScheduleRow(row: ScheduleItem): void {
		if (scheduleRows.some((r) => r.id === row.id)) return;
		scheduleRows = [...scheduleRows, row].sort(compareScheduleItems);
	}

	// #328 review R2-F1 — the schedule twin of `editWriteGenerations` below: the
	// load `generation` each in-flight schedule write was STARTED under, keyed
	// by this queue's own key (add / per-row name / per-row datetime / remove).
	// Same capture-compare the page's other write guards use.
	const scheduleWriteGenerations = new Map<string, number>();

	const scheduleQueue = createRepertoireWriteQueue({
		setPending(key, pending) {
			scheduleWritePending = { ...scheduleWritePending, [key]: pending };
			// #328 — a fresh attempt (on ANY key this queue carries) clears a stale
			// saved cue from a previous write's settle: the ONE shared region
			// always describes the LATEST write (the family rule, `manageStatus`'s
			// own start-of-attempt clear above).
			if (pending) {
				scheduleWriteGenerations.set(key, generation);
				scheduleStatus = '';
			}
		},
		reconcile(key) {
			const startedUnder = scheduleWriteGenerations.get(key);
			scheduleWriteGenerations.delete(key);
			clearScheduleError(key);
			if (key === SCHEDULE_ADD_KEY) {
				// The create's own id/sort position is only known once the server
				// answers — refetch rather than guess (same economy ADD_WORK_KEY's
				// `refreshWorks` uses).
				refreshSchedule();
				scheduleAddOpen = false;
				scheduleAddName = '';
				scheduleAddDate = '';
				scheduleAddTime = '';
			}
			// #328 — the settle itself must say so, for every write kind (add, a
			// row's name/datetime edit, remove), into the ONE region shared by the
			// surface — never disturbs another row's standing alert.
			//
			// #328 review R2-F1 — guarded exactly as the field leg's cue is: a
			// write that started on the event being left must not announce onto the
			// one the editor has since moved to. `refreshSchedule` above carries
			// the same generation check internally, so the whole reconcile now
			// agrees about which subject it is describing.
			if (startedUnder === generation) scheduleStatus = m.event_schedule_saved();
		},
		revert(key) {
			scheduleWriteGenerations.delete(key);
			// #262 review F1 — the optimistic patch has ALREADY been rolled back by
			// the queue's own `rollback` hook, so without this the row simply snaps
			// back to its old value and the editor watches her edit un-do itself
			// with nothing said. A failed write is form-wide, not a box's fault.
			console.error('event detail: schedule write failed', key);
			if (key === SCHEDULE_ADD_KEY) scheduleAddErrorField = null;
			setScheduleError(key, m.event_schedule_save_error);
		}
	});

	function setScheduleError(key: string, msg: () => string): void {
		scheduleErrors = { ...scheduleErrors, [key]: msg };
	}
	function clearScheduleError(...keys: string[]): void {
		const next = { ...scheduleErrors };
		for (const key of keys) next[key] = null;
		scheduleErrors = next;
	}
	/** The three keys one ROW can fail under — name edit, datetime edit, remove.
	 *  Rendered through a single row-local alert (the row has one place to
	 *  speak, the way each event field owns one `event-edit-error-*`). */
	function scheduleRowErrorKeys(id: string): string[] {
		return [`schedule-edit-name-${id}`, `schedule-edit-datetime-${id}`, `schedule-remove-${id}`];
	}
	function scheduleRowError(id: string): (() => string) | null {
		for (const key of scheduleRowErrorKeys(id)) {
			const msg = scheduleErrors[key];
			if (msg) return msg;
		}
		return null;
	}

	function refreshSchedule(): void {
		const cfg = manageCfg();
		if (!cfg || !detail) return;
		const evId = detail.id;
		const g = generation;
		listScheduleItems(cfg, evId, fetch)
			.then((rows) => {
				if (g !== generation) return;
				scheduleRows = rows;
			})
			.catch((e) => {
				console.error('event detail: schedule refresh failed', e);
			});
	}

	function beginScheduleAdd(): void {
		scheduleAddOpen = true;
		clearScheduleAddError();
		scheduleAddName = '';
		// Default the date to the EVENT's own Tallinn calendar day — schedule
		// items are almost always same-day breakdowns of one event — while
		// leaving it a plain native date input the editor can still change.
		const seeded = toTallinnLocalInputValue(detail?.startDatetime ?? '');
		scheduleAddDate = seeded.split('T')[0] ?? '';
		scheduleAddTime = '';
	}

	function cancelScheduleAdd(): void {
		scheduleAddOpen = false;
		clearScheduleAddError();
		scheduleAddName = '';
		scheduleAddDate = '';
		scheduleAddTime = '';
	}

	/** #132/T2 review F6's rule, applied here: an error that outlives the edit
	 *  which fixed it is a lie. Any keystroke in any add box clears it; the next
	 *  submit re-decides. */
	function clearScheduleAddError(): void {
		scheduleAddErrorField = null;
		clearScheduleError(SCHEDULE_ADD_KEY);
	}
	function setScheduleAddError(msg: () => string, field: 'name' | 'datetime'): void {
		scheduleAddErrorField = field;
		// #328 review R2-F2 — a refusal is an attempt too: the shared region must
		// not keep reading "saved" (from an EARLIER write) beside a fresh refusal.
		// The queue's own start-of-attempt clear in `setPending` is unreachable —
		// nothing is written on a refused path.
		scheduleStatus = '';
		setScheduleError(SCHEDULE_ADD_KEY, msg);
	}

	function submitScheduleAdd(): void {
		const cfg = manageCfg();
		if (!cfg || !detail) return;
		// ── validation BEFORE any fetch (#262 review F4, the #132/T4 F1 rule) ──
		// A bare `return` here was a silent no-op: the editor filled the name,
		// left the time blank, clicked Add and nothing whatsoever happened. Each
		// refusal below names its own box.
		clearScheduleAddError();
		const name = scheduleAddName.trim();
		if (name === '') {
			setScheduleAddError(m.event_schedule_name_required, 'name');
			return;
		}
		if (!scheduleAddDate || !scheduleAddTime) {
			setScheduleAddError(m.event_schedule_datetime_required, 'datetime');
			return;
		}
		// '' means unparseable — refused here rather than sent as an empty
		// datetime, which every schedule read sorts on.
		const iso = tallinnLocalToUtcIso(`${scheduleAddDate}T${scheduleAddTime}`);
		if (iso === '') {
			setScheduleAddError(m.event_schedule_datetime_required, 'datetime');
			return;
		}
		const eventIdForSchedule = detail.id;
		scheduleQueue.request(SCHEDULE_ADD_KEY, async () => {
			await createScheduleItem(cfg, { eventId: eventIdForSchedule, name, datetime: iso });
		});
	}

	function beginScheduleEdit(row: ScheduleItem): void {
		scheduleRemoveArmedId = null;
		// #262 review F1 — a stale row error must not outlive the retry it
		// provoked (`beginScheduleAdd`'s rule, applied to the row keys).
		clearScheduleError(...scheduleRowErrorKeys(row.id));
		scheduleEditingId = row.id;
		scheduleEditName = row.name;
		const seeded = toTallinnLocalInputValue(row.datetime);
		const [datePart, timePart] = seeded.split('T');
		scheduleEditDate = datePart ?? '';
		scheduleEditTime = timePart ?? '';
	}

	function cancelScheduleEdit(): void {
		scheduleEditingId = null;
		scheduleEditName = '';
		scheduleEditDate = '';
		scheduleEditTime = '';
	}

	/** Is `next` (a blur/focusout relatedTarget) still inside the SAME row's open
	 *  editor? The row activator opens a TWO-field editor (name + datetime
	 *  composite); a field's own commit must therefore never close the editor
	 *  while focus is only travelling to its sibling — closing there unmounts the
	 *  other half under the pointer and silently drops the click (#262 T3 F1). */
	function staysInsideScheduleRowEditor(origin: HTMLElement, next: Node | null): boolean {
		if (!next) return false;
		const wrapper = origin.closest('[data-schedule-edit-row]');
		return wrapper !== null && wrapper.contains(next);
	}

	/** Commit the NAME half of a row edit — its own field, its own commit,
	 *  independent of the datetime composite (the same split the event's own
	 *  location/description text fields keep from their composite siblings).
	 *  Commit ONLY: closing the editor is the blur handler's call, not this
	 *  one's, so a name commit cannot tear down the datetime half. */
	function commitScheduleName(id: string): void {
		const cfg = manageCfg();
		const row = scheduleRows.find((r) => r.id === id);
		if (!cfg || !row || scheduleEditingId !== id) return;
		const value = scheduleEditName.trim();
		// #262 review F4 — an emptied name is a REFUSAL, not a no-op: say so and
		// leave the editor open on the box that has to be fixed.
		if (value === '') {
			// #328 review R2-F2 — same rule as the add form's refusals: a refusal
			// clears the surface's saved cue rather than standing beside it.
			scheduleStatus = '';
			setScheduleError(`schedule-edit-name-${id}`, m.event_schedule_name_required);
			return;
		}
		clearScheduleError(`schedule-edit-name-${id}`);
		if (value === row.name) return;
		const before = row.name;
		scheduleQueue.request(`schedule-edit-name-${id}`, () => updateScheduleItemField(cfg, id, 'name', value), {
			apply: () => patchScheduleRow(id, { name: value }),
			rollback: () => patchScheduleRow(id, { name: before })
		});
	}

	/** Commit the DATETIME half — focus leaving the WHOLE composite wrapper
	 *  (the #207 rule-5 commit rule), never a bare blur on one of its parts. */
	function commitScheduleDatetime(id: string): void {
		const cfg = manageCfg();
		const row = scheduleRows.find((r) => r.id === id);
		if (!cfg || !row || scheduleEditingId !== id) return;
		if (!scheduleEditDate || !scheduleEditTime) return;
		const iso = tallinnLocalToUtcIso(`${scheduleEditDate}T${scheduleEditTime}`);
		if (iso === '' || new Date(iso).getTime() === new Date(row.datetime).getTime()) return;
		const before = row.datetime;
		scheduleQueue.request(
			`schedule-edit-datetime-${id}`,
			() => updateScheduleItemField(cfg, id, 'datetime', iso),
			{
				apply: () => patchScheduleRow(id, { datetime: iso }),
				rollback: () => patchScheduleRow(id, { datetime: before })
			}
		);
	}

	function handleScheduleEditDatetimeFocusOut(e: FocusEvent, id: string): void {
		const group = e.currentTarget as HTMLElement;
		const next = e.relatedTarget as Node | null;
		// Focus moving BETWEEN the composite's own parts is not a commit (#207 rule 5).
		if (next && group.contains(next)) return;
		commitScheduleDatetime(id);
		// …and focus moving to the row's NAME box is a commit but not an exit:
		// the editor stays open on the half the user just reached for.
		if (staysInsideScheduleRowEditor(group, next)) return;
		scheduleEditingId = null;
	}

	/** The NAME box losing focus: commit it, then close the row editor ONLY when
	 *  focus actually left the row (not when it moved to the datetime half). */
	function handleScheduleNameBlur(e: FocusEvent, id: string): void {
		const input = e.currentTarget as HTMLElement;
		commitScheduleName(id);
		if (staysInsideScheduleRowEditor(input, e.relatedTarget as Node | null)) return;
		// #262 review F4 — an emptied name is a refusal: the editor stays open on
		// the box that has to be fixed rather than closing over its own alert.
		if (scheduleEditName.trim() === '') return;
		scheduleEditingId = null;
	}

	function handleScheduleNameKeydown(e: KeyboardEvent, id: string): void {
		if (e.key === 'Escape') {
			e.preventDefault();
			cancelScheduleEdit();
		} else if (e.key === 'Enter') {
			e.preventDefault();
			commitScheduleName(id);
			if (scheduleEditName.trim() !== '') scheduleEditingId = null;
		}
	}

	function armScheduleRemove(id: string): void {
		scheduleEditingId = null;
		// #262 review F1 — same rule as `beginScheduleEdit`: the previous failure
		// must not still be on screen while the retry is being armed.
		clearScheduleError(...scheduleRowErrorKeys(id));
		scheduleRemoveArmedId = id;
	}
	function cancelScheduleRemove(): void {
		scheduleRemoveArmedId = null;
	}
	function confirmScheduleRemove(id: string): void {
		const cfg = manageCfg();
		const row = scheduleRows.find((r) => r.id === id);
		if (!cfg || !row) return;
		scheduleRemoveArmedId = null;
		scheduleQueue.request(`schedule-remove-${id}`, () => removeScheduleItem(cfg, id), {
			apply: () => dropScheduleRow(id),
			rollback: () => restoreScheduleRow(row)
		});
	}

	/** Works precedent (`showWorksSection`): absent for a plain member on an
	 *  otherwise-empty event, present for ANY rights-holder so the add
	 *  affordance has somewhere to render. */
	const showScheduleSection = $derived(scheduleLoaded && (scheduleRows.length > 0 || isEditor));

	// ── derived picker sources (single event/season, unlike the agenda's
	//    per-event maps — this page only ever has ONE of each) ────────────

	// #321/#329 — the pin-edition picker (`work-edition-picker`) is a THIRD
	// closed set over `libraryEditions`, joined here per work. Under a TRUNCATED
	// `listAllEditions` read that join proves nothing about a work it has no row
	// for, so the row's state splits three ways (#329 + its review, same shape as
	// the agenda's):
	//   • matched, or a pin the join can name → a stated FACT, untouched;
	//   • not settled by the join → UNKNOWN wording, the picker stays open, and
	//     this page reads `listEditions(workId)` SCOPED for that one work;
	//   • that scoped read settled COMPLETE → a fact again, whichever way it
	//     came out; truncated against its own cap, it settles nothing.
	// A complete read issues no scoped reads: it already IS the fact.
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

	/** Per repertoire ROW: the editions of that row's work ("pin edition"). A work
	 *  with a SCOPED answer uses it verbatim, in preference to the
	 *  collective-wide join: it is the complete list for that one work. */
	const editionOptionsByRowId = $derived.by(() => {
		const out: Record<string, PickerOption[]> = {};
		for (const row of workRows) {
			if (row.kind !== 'repertoire' || row.workId === '') continue;
			const options =
				scopedEditionsByWorkId[row.workId] ??
				(editionsByWorkId.get(row.workId) ?? []).map((edition) => ({
					id: edition.id,
					label: editionLabel(edition)
				}));
			if (options.length > 0) out[row.id] = options;
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
			workRows,
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
		const g = generation;
		for (const workId of workIds) {
			if (scopedEditionWorkIdsRequested.has(workId)) continue;
			scopedEditionWorkIdsRequested.add(workId);
			listEditions(cfg, workId)
				.then((read) => {
					if (g !== generation) return;
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

	// #311 — the STICKY half of `pickableWorksVisible`, mirroring the main
	// agenda flow's own effect byte-for-byte: skip while loading, skip a
	// settle that FAILED, otherwise recompute from `pickableWorksList`
	// reactively (so a write that changes `seasonRepertoire` without a fresh
	// `loadManagePickers` re-decides visibility too).
	$effect(() => {
		if (libraryPickersLoading || !libraryPickersLoadSucceeded) return;
		pickableWorksVisible = pickableWorksList.length > 0;
	});

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
		// #327 — a saved cue reports a write, never a read: a fresh open (or
		// reopen) starts with no cue at all.
		attendanceSavedMemberIds = new Set();
		const cfg = { db: selected.db, token: getToken() ?? '' };
		const evId = detail.id;
		const g = generation;
		Promise.all([loadRoster(cfg), listAttendance(cfg, evId), listAllRsvpsForEvent(cfg, evId)])
			.then(([rosterRead, records, rsvps]) => {
				if (g !== generation || detail?.id !== evId) return;
				attendanceRoster = rosterRead.items;
				attendanceRosterPartial = rosterRead.truncated;
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
				// A failed load says nothing about completeness — the error is the
				// whole statement.
				attendanceRosterPartial = false;
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
				// #327 — and any stale SAVED cue from a previous, now-superseded write:
				// the cue always describes the latest write, never a settled earlier one.
				const saved = new Set(attendanceSavedMemberIds);
				saved.delete(targetMemberId);
				attendanceSavedMemberIds = saved;
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
			// #327 — the write settled: the row earns the saved cue. A reconciled
			// NULL (a cleared record) announces too — it renders identically to
			// never-marked, so the cue is the only distinguisher.
			const saved = new Set(attendanceSavedMemberIds);
			saved.add(targetMemberId);
			attendanceSavedMemberIds = saved;
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
			// #327 — failure and saved are mutually exclusive (already cleared by
			// setPending at this attempt's start in practice; kept here too so
			// revert never depends on that ordering).
			if (attendanceSavedMemberIds.has(targetMemberId)) {
				const cleared = new Set(attendanceSavedMemberIds);
				cleared.delete(targetMemberId);
				attendanceSavedMemberIds = cleared;
			}
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
	// #104 review F1 / #264 review F2 — `editingField` is NOT a write guard. It
	// guards concurrent EDITING (one input open at a time), but it is cleared
	// synchronously on confirm, so the pencil is back before the write it fired
	// has landed. A second edit of the same field while the first is still in
	// flight would run a second atomic overwrite (#264: GET the existing value
	// id → ONE POST pairing that `_id` with the new value) against the SAME
	// pre-existing value id: both GETs see the old value, the first POST
	// consumes it, and the second POST carries an `_id` that no longer names a
	// live value.
	//
	// That second POST SUCCEEDS. `_id` is the soft-delete target, not a
	// precondition — entu-api inserts the new value and its `markPropertiesDeleted`
	// `updateMany` matches nothing without complaining — so it returns 200 and
	// the entity ends up with TWO values for the field, silently. (The old
	// GET-POST-DELETE wire failed loudly here: the losing DELETE 404'd. The
	// atomic wire trades that noise away, so the guards below are now the only
	// protection, not a second one.) The queue's per-key pending set drops the
	// second write exactly like every other control here, and `editWritePending`
	// disables the pencil while it is in flight (the primary guard; the queue's
	// own set is the backstop).

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
			.then((result) => {
				locationSuggestions = result.items;
				// #321 — no user-facing claim of completeness for an autocomplete
				// corpus (see listEventLocations' own doc comment for the treatment);
				// a dev-visible signal is the honest minimum for a truncation this
				// surface doesn't otherwise report.
				if (result.truncated) {
					console.warn('event detail: location-suggestion corpus is truncated');
				}
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
	// #328 — ONE region shared by all six inline fields (Gama's one-node-PER-
	// SURFACE ruling: the inline-field surface is one queue, `editWriteQueue`,
	// not six), matching the #324/#267 shape (`manageStatus` a few lines up on
	// this same page): persistent role="status" region, mounted blank, text
	// set imperatively on a successful settle, cleared at the START of the
	// next attempt — never on a timer.
	let editStatus = $state('');

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
	// #328 review R2-F1 — the load `generation` each in-flight FIELD write was
	// STARTED under, keyed by field (the queue allows at most one live write per
	// key). Same capture-compare shape `writeGenerations`/
	// `attendanceWriteGenerations` above use, and the same one #325 threads on
	// the season leg — so all three legs of the trio answer the late-settle
	// question identically. Non-reactive, and deliberately NOT cleared by
	// `resetComposeState`: its entries describe writes still running against the
	// PREVIOUS load, which is exactly what has to be recognised when they settle.
	// Threading it here rather than into `createRepertoireWriteQueue` keeps
	// #324's shared-primitive contract unwidened.
	const editWriteGenerations = new Map<string, number>();

	const editWriteQueue = createRepertoireWriteQueue({
		setPending(key, pending) {
			editWritePending = { ...editWritePending, [key as EditableEventField]: pending };
			// #328 — a fresh attempt (on ANY of the six fields) clears a stale
			// saved cue from a previous field's settle: the ONE shared region
			// always describes the LATEST write (the family rule, `manageStatus`'s
			// own start-of-attempt clear above).
			if (pending) {
				editWriteGenerations.set(key, generation);
				editStatus = '';
			}
		},
		reconcile(key) {
			const startedUnder = editWriteGenerations.get(key);
			editWriteGenerations.delete(key);
			editErrors = { ...editErrors, [key as EditableEventField]: false };
			settleFieldFocus(key as EditableEventField);
			// #328 — the settle itself must say so, into the ONE region shared by
			// all six fields (Gama's one-node-per-SURFACE ruling) — never disturbs
			// another field's standing error.
			//
			// #328 review R2-F1 — but ONLY when the write still describes what is
			// on screen. `resetComposeState` blanks the region AT the switch; it
			// cannot stop a write already in flight, so without this guard a save
			// made on the event being left announces "saved" onto the event the
			// editor has since moved to — the epic's own defect class, arriving
			// through the cue. Error/focus handling is left untouched (byte-
			// preserved): only the ANNOUNCEMENT is a claim about the current
			// subject.
			if (startedUnder === generation) editStatus = m.event_edit_saved();
		},
		revert(key) {
			editWriteGenerations.delete(key);
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

	// tallinnLocalToUtcIso (the inverse: a `datetime-local` value the user
	// typed AS TALLINN wall clock → the UTC instant to write on the wire) now
	// lives in $lib/preferences/timeFormat (#230) — shared with the event-
	// create flow in src/routes/+page.svelte, which had a byte-identical copy.

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
				// #328 review R2-F2 — a refusal is an attempt too: the shared region
				// must not keep reading "saved" (from an EARLIER field's write)
				// beside a fresh refusal. The queue's own start-of-attempt clear in
				// `setPending` is unreachable — nothing is written on this path.
				editStatus = '';
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
				<!-- #304 — the series picker. Rights-holders only (`isEditor`, the SAME
				     one predicate the pencils/tally/delete all run — a plain member
				     gets no picker and no note); scoped to events that HAVE a season
				     (series are season children, so a season-less event has nothing to
				     scope options by). Placed FIRST in the header — name is the field
				     series-children most depend on (#132), so the control that decides
				     it comes before it. -->
				{#if isEditor && detail.seasonId !== null && seriesOptionsLoaded}
					<div class="flex flex-col gap-1 border-b border-dashed border-ink-5 pb-2">
						<label for="event-series-select" class="text-xs text-ink-2">
							{m.event_detail_series_label()}
						</label>
						<!-- Standing rule 1 — native <select>. Value is bound to the
						     SERVER-CONFIRMED `detail.seriesId` alone (never the armed pick),
						     so nothing here forces the DOM back until a write actually
						     settles (#289; onRosterNamesChange's exact discipline, #267). The
						     none-option ('' — the event-create-series convention) is a REAL
						     state, not a placeholder prompt (#288 — stays out of the
						     label-in-name guard), so it is OMITTED rather than disabled when
						     `seriesUnassignGated` withholds it (Gama ruling 5613471404): an
						     absent option, never a greyed-out one. -->
						<select
							id="event-series-select"
							data-testid="event-series-select"
							value={detail.seriesId ?? ''}
							disabled={seriesPending}
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
							<!-- #301's precedent, applied here: absent PLUS a note — a hole
							     inside an otherwise-normal dropdown is invisible without one. -->
							<p data-testid="event-series-rights-note" class="text-xs text-ink-3">
								{m.event_detail_series_rights_note()}
							</p>
						{/if}
						{#if detail.inheritedFields.length > 0}
							<!-- "Under the select, name the inheritance" — ONLY the fields
							     THIS event actually inherits (raw-presence test,
							     eventDetail.ts), never all four unconditionally. -->
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
						<!-- The consequence preview — visible BEFORE any write, and only
						     when something is actually inherited (the safe case pays
						     nothing, #304's own rule). Reassign shows what each inherited
						     field WILL BECOME (the new series' raw values); unassign names
						     which fields CLEAR, with the name-goes-empty case called out on
						     its own (#132 — series children carry no own name). -->
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
										disabled={seriesPending}
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
				<!-- #313 — the standalone → series conversion control. STATED CHOICE:
				     it sits directly UNDER the series picker (immediately above), not
				     inside it — the picker offers "join an EXISTING series", this
				     offers "become a NEW one", two different writes that happen to
				     share a header region; keeping them as siblings rather than
				     nesting one inside the other's `{#if}` keeps each gate legible on
				     its own. Gate: `canConvert` — `isEditor` (NOT `isOwnerTier`; see
				     that derived's doc above and `canConvert`'s own doc for why this
				     control and the #304 unassign beside it are gated on two
				     DIFFERENT tiers for two different wire ops), a STANDALONE event
				     (`detail.seriesId === null`), and a season to parent the new
				     series to. One entry, one meaning: the control is GONE while the
				     form is open (`{#if !eventConvertOpen}`), same swap idiom as
				     #237's armed-delete pair. -->
				{#if canConvert}
					{#if !eventConvertOpen}
						<button
							type="button"
							data-testid="event-detail-convert"
							class="flex min-h-11 w-fit items-center text-xs text-ink underline"
							onclick={openEventConvertForm}
						>
							{m.event_detail_convert()}
						</button>
					{:else}
						<!-- The #196/#212 form contract, relocated verbatim: role="dialog"
						     + tabindex="-1" + the focus effect above, its OWN Escape
						     handler, every box `disabled={eventConvertLocked}` once a
						     stopped run is resumable, and the #212 start-date TEXT (never
						     an input) above the end-date picker it precedes. -->
						<div
							data-testid="event-convert-form"
							role="dialog"
							aria-label={m.event_convert_form_label()}
							tabindex="-1"
							bind:this={eventConvertFormEl}
							class="flex flex-col gap-1.5 border border-dashed border-ink-5 p-2"
							onkeydown={onEventConvertFormKeydown}
						>
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
							<!-- #212 — the event's OWN date, derived (never a new $state)
							     from `tallinnWallClockParts(detail.startDatetime).date`:
							     plain ISO TEXT, not an input, so the end-date picker below
							     has visible context for what it cannot precede. -->
							<p
								data-testid="event-convert-start-date"
								class="flex w-full flex-col gap-0.5"
							>
								<span class="text-xs text-ink-2">
									{m.event_convert_start_date_label()}
								</span>
								<span class="text-ink">
									{tallinnWallClockParts(detail.startDatetime).date}
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
									onclick={() => void submitEventConvert()}
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
				{/if}
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

				<!-- #328/#267 shape — persistent sr-only role="status" region,
				     mounted from first render (a live region announces only CHANGES
				     to its contents) so a settle is distinguishable from silence even
				     when nothing failed. ONE region shared by all six inline fields
				     above (Gama's one-node-per-SURFACE ruling) — distinct from
				     #324's repertoire-manage-status and this leg's own
				     event-schedule-status sibling below. -->
				<div data-testid="event-edit-status" role="status" aria-live="polite" class="sr-only">
					{editStatus}
				</div>

				<!-- #262 — the schedule_item section: engineering's placement call is
				     HERE, right below the event's own date/time/description block and
				     above RSVP — "beside the event's own date/time block" (Gama 05:30),
				     the same header stack the time/duration/location/description
				     pencils already occupy. OWN container (`event-detail-schedule`),
				     never a descendant of `event-detail-time` — the 'kontsert' fixture
				     deliberately SHARES the event's own 19:00 start, and
				     `event-detail-time`'s exact-count regex pins (page.spec.ts) must
				     keep holding. Visibility follows the Works precedent
				     (`showWorksSection`): absent for a plain member on an
				     otherwise-empty event, present for ANY rights-holder so the add
				     affordance has somewhere to render. Members get the read ONLY —
				     no edit affordance renders for them at all (Gama point 2/3). -->
				{#if showScheduleSection}
					<section
						data-testid="event-detail-schedule"
						class="mt-4 flex flex-col gap-2"
						aria-labelledby="event-detail-schedule-heading"
					>
						<h2 id="event-detail-schedule-heading" class="font-display text-lg text-ink-2">
							{m.event_schedule_heading()}
						</h2>
						{#if scheduleRows.length > 0}
							<ul class="flex flex-col gap-1">
								{#each scheduleRows as row (row.id)}
									<!-- The <li> is a COLUMN so the row's own error line (below) sits
									     under the controls rather than inline beside them; the controls
									     keep their original single-row flex in the wrapper. -->
									<li class="flex flex-col gap-0.5">
										<div class="flex items-center gap-2 text-sm text-ink">
											{#if isEditor && scheduleEditingId === row.id}
												<!-- #207 rule 5 composite, same shape as the event's own
												     start_datetime/duration_minutes editors — the name
												     input commits on ITS OWN blur (independent field,
												     same split as location/description), the datetime
												     composite commits on focus leaving the WHOLE group.

												     `data-schedule-edit-row` marks the boundary of the
												     WHOLE two-field editor: each half commits on its own
												     blur but closes the editor only when focus leaves
												     THIS wrapper, so committing one half can never
												     unmount the other under the pointer (#262 T3 F1). -->
												<div
													data-schedule-edit-row={row.id}
													class="flex flex-1 flex-wrap items-end gap-2"
												>
													<div class="flex flex-col gap-0.5">
														<label
															for={`event-schedule-edit-name-input-${row.id}`}
															class="text-xs text-ink-2"
														>
															{m.event_schedule_name_label()}
														</label>
														<input
															type="text"
															id={`event-schedule-edit-name-input-${row.id}`}
															data-testid={`event-schedule-edit-name-${row.id}`}
															class="border-b border-ink bg-transparent text-ink"
															value={scheduleEditName}
															use:focusOnMount
															oninput={(e) => {
																scheduleEditName = (
																	e.currentTarget as HTMLInputElement
																).value;
																// T2 F6: the refusal must not outlive the keystroke
																// that fixes it.
																clearScheduleError(`schedule-edit-name-${row.id}`);
															}}
															onblur={(e) => handleScheduleNameBlur(e, row.id)}
															onkeydown={(e) => handleScheduleNameKeydown(e, row.id)}
														/>
													</div>
													<div class="flex flex-col gap-0.5">
														<!-- #262 review F2 / #249 single-name rule: the VISIBLE
														     label is the group's ONE name source
														     (`aria-labelledby`), never the same key emitted
														     twice as an `aria-label` beside it. -->
														<span
															id={`event-schedule-edit-datetime-${row.id}-label`}
															class="text-xs text-ink-2">{m.event_schedule_datetime_label()}</span
														>
														<div
															data-testid={`event-schedule-edit-datetime-${row.id}`}
															role="group"
															aria-labelledby={`event-schedule-edit-datetime-${row.id}-label`}
															class="flex flex-wrap items-center gap-2 text-ink-2"
															onfocusout={(e) =>
																handleScheduleEditDatetimeFocusOut(e, row.id)}
														>
															<input
																type="date"
																data-testid={`event-schedule-edit-datetime-${row.id}-date`}
																aria-label={m.time_select_date_label()}
																class="min-w-0 border-b border-ink bg-transparent text-ink"
																value={scheduleEditDate}
																oninput={(e) =>
																	(scheduleEditDate = (
																		e.currentTarget as HTMLInputElement
																	).value)}
															/>
															<TimeSelect
																prefix={`event-schedule-edit-datetime-${row.id}`}
																value={scheduleEditTime}
																onchange={(v) => (scheduleEditTime = v)}
															/>
														</div>
													</div>
												</div>
											{:else if isEditor}
												<!-- #157/admin-collective-name whole-field pattern: the
												     WHOLE row (name + time) is the tap target, native
												     <button>, TAB-reachable, named for the item — never a
												     bare pencil glyph.

												     #262 review F3 — the label rides as an sr-only CHILD, NOT
												     as `aria-label`: `aria-label` overrides descendant content,
												     so the row announced "Edit kogunemine" and swallowed the
												     TIME, the one datum the schedule exists to convey. As a
												     child it composes with the visible spans — "Edit schedule
												     item, kogunemine, 17:30" — exactly what
												     event-edit-btn-start_datetime does above. -->
												<button
													type="button"
													data-testid={`event-schedule-edit-${row.id}`}
													disabled={scheduleWritePending[`schedule-edit-name-${row.id}`] ===
														true ||
														scheduleWritePending[`schedule-edit-datetime-${row.id}`] ===
															true}
													class="group flex min-h-11 flex-1 appearance-none items-center gap-2 border-0 bg-transparent p-0 text-left text-sm text-ink disabled:opacity-40"
													onclick={() => beginScheduleEdit(row)}
												>
													<span class="sr-only">{m.event_schedule_edit_aria_label()}</span>
													<span aria-hidden="true" class="text-xs text-ink-3 group-hover:text-ink"
														>✎</span
													>
													<span data-testid="event-schedule-row-name">{row.name}</span>
													<span data-testid="event-schedule-row-time" class="text-ink-2"
														>{scheduleRowTime(row.datetime)}</span
													>
												</button>
											{:else}
												<span data-testid="event-schedule-row-name">{row.name}</span>
												<span data-testid="event-schedule-row-time" class="text-ink-2"
													>{scheduleRowTime(row.datetime)}</span
												>
											{/if}

											{#if isEditor && scheduleEditingId !== row.id}
												<!-- #238 shape: TrashIcon inside the trigger, aria-hidden;
												     the BUTTON carries the accessible name; two-step
												     arm/confirm/cancel, writes nothing until confirmed. -->
												{#if scheduleRemoveArmedId === row.id}
													<div class="flex items-center gap-1">
														<button
															type="button"
															data-testid={`event-schedule-remove-confirm-${row.id}`}
															aria-label={m.event_schedule_remove_confirm_aria_label({
																name: row.name
															})}
															disabled={scheduleWritePending[
																`schedule-remove-${row.id}`
															] === true}
															aria-busy={scheduleWritePending[`schedule-remove-${row.id}`] ===
																true}
															class="flex min-h-11 items-center px-1 text-xs text-red-700 underline disabled:opacity-50"
															onclick={() => confirmScheduleRemove(row.id)}
														>
															{m.event_schedule_remove_confirm_short()}
														</button>
														<button
															type="button"
															data-testid={`event-schedule-remove-cancel-${row.id}`}
															aria-label={m.event_schedule_remove_cancel_aria_label({
																name: row.name
															})}
															disabled={scheduleWritePending[
																`schedule-remove-${row.id}`
															] === true}
															class="flex min-h-11 items-center px-1 text-xs text-ink-2 underline hover:text-ink disabled:opacity-50"
															onclick={() => cancelScheduleRemove()}
														>
															{m.event_schedule_remove_cancel_short()}
														</button>
													</div>
												{:else}
													<!-- #237 — MIGRATED onto the shared DeleteTrigger unit: this
													     was one of the two pre-existing TrashIcon sites, and the
													     "defined once" contract forces it here rather than leaving
													     a second definition standing. iconClass h-4 w-4 stays a
													     stated per-site choice — these rows are narrower than the
													     season-panel rows that keep the h-5 w-5 default. -->
													<DeleteTrigger
														data-testid={`event-schedule-remove-${row.id}`}
														aria-label={m.event_schedule_remove_aria_label({ name: row.name })}
														iconClass="h-4 w-4"
														onclick={() => armScheduleRemove(row.id)}
													/>
												{/if}
											{/if}
										</div>
										<!-- #262 review F1 — the row's OWN error line. Without it a
										     failed name edit, datetime edit or removal rolled back
										     silently: the row snapped to its old value and said
										     nothing. One alert per row, the way each event field owns
										     one `event-edit-error-*`. -->
										{#if scheduleRowError(row.id)}
											{@const rowError = scheduleRowError(row.id)!}
											<p
												data-testid={`event-schedule-error-${row.id}`}
												role="alert"
												class="text-xs text-red-700"
											>
												{rowError()}
											</p>
										{/if}
									</li>
								{/each}
							</ul>
						{/if}

						{#if isEditor}
							<!-- #262 review F4 — one slot, two speakers: the generic
							     "couldn't save" a failed create sets, and the field-naming
							     refusal `submitScheduleAdd` sets BEFORE any fetch. The
							     offending box points at it via `aria-describedby`. -->
							{#if scheduleErrors[SCHEDULE_ADD_KEY]}
								{@const addError = scheduleErrors[SCHEDULE_ADD_KEY]!}
								<p
									id="event-schedule-add-error"
									data-testid="event-schedule-add-error"
									role="alert"
									class="text-xs text-red-700"
								>
									{addError()}
								</p>
							{/if}
							{#if scheduleAddOpen}
								<div class="flex flex-wrap items-end gap-2">
									<div class="flex flex-col gap-0.5">
										<label for="event-schedule-add-name-input" class="text-xs text-ink-2">
											{m.event_schedule_name_label()}
										</label>
										<input
											type="text"
											id="event-schedule-add-name-input"
											data-testid="event-schedule-add-name"
											class="border-b border-ink bg-transparent text-ink"
											aria-invalid={scheduleAddErrorField === 'name' ? true : undefined}
											aria-describedby={scheduleAddErrorField === 'name'
												? 'event-schedule-add-error'
												: undefined}
											value={scheduleAddName}
											use:focusOnMount
											oninput={(e) => {
												scheduleAddName = (e.currentTarget as HTMLInputElement).value;
												clearScheduleAddError();
											}}
										/>
									</div>
									<div class="flex flex-col gap-0.5">
										<!-- #262 review F2 / #249 single-name rule: the VISIBLE label is
										     the group's ONE name source, pointed at with
										     `aria-labelledby` — never the same key emitted a second
										     time as an `aria-label` on the group beside it. -->
										<span id="event-schedule-add-datetime-label" class="text-xs text-ink-2"
											>{m.event_schedule_datetime_label()}</span
										>
										<div
											data-testid="event-schedule-add-datetime"
											role="group"
											aria-labelledby="event-schedule-add-datetime-label"
											aria-describedby={scheduleAddErrorField === 'datetime'
												? 'event-schedule-add-error'
												: undefined}
											class="flex flex-wrap items-center gap-2 text-ink-2"
										>
											<input
												type="date"
												data-testid="event-schedule-add-datetime-date"
												aria-label={m.time_select_date_label()}
												aria-invalid={scheduleAddErrorField === 'datetime' ? true : undefined}
												class="min-w-0 border-b border-ink bg-transparent text-ink"
												value={scheduleAddDate}
												oninput={(e) => {
													scheduleAddDate = (e.currentTarget as HTMLInputElement).value;
													clearScheduleAddError();
												}}
											/>
											<TimeSelect
												prefix="event-schedule-add-datetime"
												value={scheduleAddTime}
												onchange={(v) => {
													scheduleAddTime = v;
													clearScheduleAddError();
												}}
											/>
										</div>
									</div>
									<button
										type="button"
										data-testid="event-schedule-add-submit"
										disabled={scheduleWritePending[SCHEDULE_ADD_KEY] === true}
										class="flex min-h-11 items-center rounded-md border border-ink px-3 py-1.5 text-xs tracking-wide text-ink uppercase hover:bg-ink hover:text-paper disabled:opacity-50"
										onclick={submitScheduleAdd}
									>
										{m.event_schedule_add_submit()}
									</button>
									<button
										type="button"
										data-testid="event-schedule-add-cancel"
										class="flex min-h-11 items-center px-1 text-xs text-ink-2 underline hover:text-ink"
										onclick={cancelScheduleAdd}
									>
										{m.event_schedule_add_cancel()}
									</button>
								</div>
							{:else}
								<button
									type="button"
									data-testid="event-schedule-add"
									class="flex min-h-11 items-center gap-1 self-start text-xs text-ink-2 underline hover:text-ink"
									onclick={beginScheduleAdd}
								>
									{m.event_schedule_add_label()}
								</button>
							{/if}
						{/if}
						<!-- #328/#267 shape — persistent sr-only role="status" region,
						     mounted from first render (a live region announces only
						     CHANGES to its contents) so a settle is distinguishable from
						     silence even when nothing failed. ONE region shared by every
						     write kind this section's queue carries (add, per-row edit,
						     remove — Gama's one-node-per-SURFACE ruling) — distinct from
						     the inline-field leg's event-edit-status and #324's
						     repertoire-manage-status. -->
						<div
							data-testid="event-schedule-status"
							role="status"
							aria-live="polite"
							class="sr-only"
						>
							{scheduleStatus}
						</div>
					</section>
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
						saved={rsvpSaved}
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
							{pickableWorksVisible}
							pickableWorksPartial={libraryWorksPartial}
							pickableEditions={pickableEditionsList}
							pickableEditionsPartial={libraryEditionsPartial}
							{editionOptionsByRowId}
							{editionsResolvedWorkIds}
							pendingKeys={managePendingKeys}
							onaddwork={handleAddWork}
							onstatuschange={handleStatusChange}
							onpinedition={handlePinEdition}
							onremoveitem={handleRemoveItem}
							onmoveitem={handleMoveItem}
							onaddprogramitem={handleAddProgramItem}
						/>
						<!-- #324 — a management write that failed. Its optimistic change is
						     already rolled back by the time this renders, so without the
						     message the value would just snap back and read as a bug
						     (the agenda page's own #91 `manageError` idiom, propagated). -->
						{#if manageError}
							<p data-testid="repertoire-manage-error" class="pt-2 text-xs text-red-700" role="alert">
								{m.repertoire_manage_error()}
							</p>
						{/if}
						<!-- #324/#267 shape — persistent sr-only role="status" region,
						     mounted from first render (a live region announces only
						     CHANGES to its contents) so a settle is distinguishable from
						     silence even when nothing failed. -->
						<div data-testid="repertoire-manage-status" role="status" aria-live="polite" class="sr-only">
							{manageStatus}
						</div>
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
								savedMemberIds={attendanceSavedMemberIds}
								membersPartial={attendanceRosterPartial}
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
							     name-from-contents and silence it. #237 STATED CHOICE — this
							     site keeps its VISIBLE label (not icon-only): the decoration
							     moves from a bare × to the shared aria-hidden TrashIcon, so the
							     accessible name is exactly the label a sighted user reads
							     (WCAG 2.5.3 label-in-name), same as before the sweep. -->
							<DeleteTrigger
								data-testid="event-detail-delete"
								class="gap-1 px-1 text-xs underline"
								onclick={() => void armDelete()}
							>
								{#snippet children()}
									{m.event_detail_delete_label()}
								{/snippet}
							</DeleteTrigger>
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
