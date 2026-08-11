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
	import { page } from '$app/state';
	import { m } from '$lib/paraglide/messages.js';
	import { getToken } from '$lib/auth/storage';
	import { selectedCollectiveStore } from '$lib/collectives/store';
	import { loadEventDetail, EventDetailLoadError, type EventDetail } from '$lib/events/eventDetail';
	import type { EntuCfg } from '$lib/seasons/entuSeasons';
	import {
		findMyMemberId,
		listMyRsvps,
		rsvpsByEventId,
		type MyRsvp,
		type RsvpStatus
	} from '$lib/rsvp/rsvpData';
	import { createRsvpChangeQueue, type RsvpEntry } from '$lib/rsvp/rsvpChangeQueue';
	import { listAllRsvpsForEvent } from '$lib/attendance/attendanceData';
	import { manageRightsFrom } from '$lib/repertoire/repertoireActions';
	import RsvpControl from '$lib/components/agenda/RsvpControl.svelte';

	const selected = $derived($selectedCollectiveStore);
	const eventId = $derived(page.params.id ?? '');

	// 'not-available' is a genuine 5th state, NOT a flavour of 'load-error':
	// switching collectives with a detail page open refetches the SAME id against
	// the newly selected db, where it does not exist (403/404). Offering Retry
	// there is offering an action that can never succeed — this state offers the
	// back link instead (#101 review fix F5).
	type Status = 'loading' | 'no-collective' | 'load-error' | 'not-available' | 'ready';

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
			return;
		}
		status = 'loading';
		detail = null;
		resetRsvpState();
		try {
			const cfg = { db: current.db, token: getToken() ?? '' };
			const loaded = await loadEventDetail(cfg, id);
			if (g !== generation) return; // superseded by a newer selection/param
			detail = loaded;
			status = 'ready';
			loadRsvpControl(cfg, current.personId, id, g);
			if (canSeeTally(loaded, current.personId)) {
				loadTally(cfg, id, g);
			}
		} catch (e) {
			if (g !== generation) return;
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
	 *  viewer's own rsvp write lands (#102 review F4). */
	function loadTally(cfg: EntuCfg, evId: string, g: number): void {
		listAllRsvpsForEvent(cfg, evId)
			.then((rows) => {
				if (g !== generation) return;
				tallyError = false;
				tally = {
					going: rows.filter((r) => r.status === 'going').length,
					not_going: rows.filter((r) => r.status === 'not_going').length,
					maybe: rows.filter((r) => r.status === 'maybe').length,
					late: rows.filter((r) => r.status === 'late').length
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
		loadTally({ db: current.db, token: getToken() ?? '' }, loaded.id, generation);
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
				loadTally({ db: current.db, token: getToken() ?? '' }, loaded.id, generation);
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
			console.error('event detail: load failed', e);
			status = 'load-error';
		});
	});

	// Tallinn IANA timezone — same TZ + HH:MM formatter as AgendaList.svelte
	// (verbatim T5 build spec convention; do not diverge from it here).
	const TZ = 'Europe/Tallinn';
	const timeFmt = new Intl.DateTimeFormat('en-GB', {
		timeZone: TZ,
		hour: '2-digit',
		minute: '2-digit',
		hour12: false
	});
	// #101 review fix (F4) — the agenda supplies each event's DATE via its day-group
	// headers, which this page does not inherit: a bookmarked /event/<id> showed a
	// time with no day at all. Same formatter options as AgendaList.svelte's
	// `headerFmt`, so the two surfaces render a date identically.
	const dateFmt = new Intl.DateTimeFormat(undefined, {
		timeZone: TZ,
		weekday: 'long',
		day: 'numeric',
		month: 'long'
	});

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
	const startAt = $derived.by(() => {
		const raw = detail?.startDatetime ?? '';
		if (raw === '') return null;
		const parsed = new Date(raw);
		return Number.isNaN(parsed.getTime()) ? null : parsed;
	});

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

	/**
	 * "19:00–20:30" — start, then start + duration, both Tallinn-zoned. #101 review
	 * fix (F2): a zero/unknown duration (no `duration_minutes` on the event AND
	 * none on its parent series → loadEventDetail defaults to 0) yields the start
	 * time ALONE, never the degenerate "19:00–19:00" range.
	 */
	function timeRange(start: Date, minutes: number): string {
		if (minutes <= 0) return timeFmt.format(start);
		return `${timeFmt.format(start)}–${timeFmt.format(new Date(start.getTime() + minutes * 60_000))}`;
	}

	// #101 review fix (F3) — the badge rendered the raw Entu `event_type` string,
	// the one user-visible string on this page that never passed through paraglide
	// (an Estonian user read "REHEARSAL"). The eight known types come from the v4E
	// schema's `event_type` note (schema.ts: rehearsal | concert | festival |
	// retreat | workshop | meeting | social | other); an UNKNOWN type falls back to
	// its raw value — visibly wrong beats invisibly blank.
	const EVENT_TYPE_LABEL: Record<string, () => string> = {
		rehearsal: m.event_type_rehearsal,
		concert: m.event_type_concert,
		festival: m.event_type_festival,
		retreat: m.event_type_retreat,
		workshop: m.event_type_workshop,
		meeting: m.event_type_meeting,
		social: m.event_type_social,
		other: m.event_type_other
	};
	function eventTypeLabel(eventType: string): string {
		return EVENT_TYPE_LABEL[eventType]?.() ?? eventType;
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
				<!-- Guarded like every other optional header field below: an event with
				     no `event_type` must not render a bare, empty pill. -->
				{#if detail.eventType}
					<span
						data-testid="event-detail-type"
						class="w-fit rounded-full border border-ink-4 px-1.5 py-0.5 font-mono text-[9px] tracking-wide text-ink-2 uppercase"
					>
						{eventTypeLabel(detail.eventType)}
					</span>
				{/if}
				<h1 data-testid="event-detail-name" class="font-display text-2xl">{detail.name}</h1>
				<!-- Guarded like every other optional field: an event with no parseable
				     start_datetime shows no time line at all (formatting an Invalid Date
				     would throw mid-render and take the whole header down with it). -->
				{#if startAt}
					<p data-testid="event-detail-time" class="text-sm text-ink-2">
						<!-- The comma is plain text, NOT an aria-hidden decoration like the
						     back link's ←: it is real punctuation, and hiding it would run
						     "September 1" straight into "19:00" for a screen reader. -->
						<span data-testid="event-detail-date">{dateFmt.format(startAt)}</span>, {timeRange(
							startAt,
							detail.durationMinutes
						)}
					</p>
				{/if}
				<!-- Guarded too: an unknown duration (0) is not "0 min", it is nothing
				     to say — the time line already collapsed to the start time alone. -->
				{#if detail.durationMinutes > 0}
					<p data-testid="event-detail-duration" class="text-xs text-ink-2">
						{m.agenda_duration_min({ minutes: detail.durationMinutes })}
					</p>
				{/if}
				{#if detail.location}
					<p data-testid="event-detail-location" class="text-sm text-ink-2">{detail.location}</p>
				{/if}
				{#if detail.conductorNames.length > 0}
					<p data-testid="event-detail-conductors" class="text-sm text-ink-2">
						{m.event_detail_conductor_label()}: {detail.conductorNames.join(', ')}
					</p>
				{/if}
				{#if detail.description}
					<p data-testid="event-detail-description" class="mt-2 text-sm text-ink">
						{detail.description}
					</p>
				{/if}

				<!-- #102 TE.2 — the RSVP section: the SAME RsvpControl component and
				     rsvp entity the agenda rows use, plus (for a viewer visible in this
				     event's `_owner`/`_editor` list) the tally and capacity. -->
				<div data-testid="event-detail-rsvp" class="mt-3 flex flex-col gap-2">
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
				</div>
			</div>
		{/if}
	</div>
</main>
