<!-- src/lib/components/agenda/AgendaList.svelte -->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import { m } from '$lib/paraglide/messages.js';
	import type { AgendaItem } from '$lib/agenda/types';
	import type { RsvpByEventId, RsvpStatus } from '$lib/rsvp/rsvpData';
	import RsvpControl from './RsvpControl.svelte';
	import RepertoireElement from './RepertoireElement.svelte';
	// #90 TR.2 — ONE definition of the works view model, shared with
	// RepertoireElement and its producer (repertoire/workRows.ts). Previously
	// duplicated inline here, which let the two copies drift silently.
	import type { WorkRow, WorksManage } from '$lib/repertoire/types';
	// #87 fix — the attendance panel now renders INLINE, as a child of the
	// recent row that opened it (same inline-expansion pattern as the library
	// browse tree's editions-under-work), not below the whole agenda.
	import AttendanceSurface from '$lib/components/attendance/AttendanceSurface.svelte';
	import type { AttendancePanel } from '$lib/attendance/types';
	// #103 review F3 — the badge and the conductor's button are SHARED with the
	// event detail page (they were inline here and copied there, and the copies
	// had already lost the dot + data-status). BadgeStatus is that component's
	// own type now — #85 TA.4's four states, 'not-recorded' among them.
	import AttendanceBadge, { type BadgeStatus } from '$lib/components/attendance/AttendanceBadge.svelte';
	import TakeAttendanceButton from '$lib/components/attendance/TakeAttendanceButton.svelte';

	interface Props {
		items: AgendaItem[];
		loading?: boolean;
		// #12 — one RsvpControl per row, seeded from rsvpByEventId (absent entry =
		// unanswered, never defaulted — #11's display AC). onrsvpchange forwards
		// (item, status) up so the page can own the optimistic write (keeps this
		// component's test unit-level).
		rsvpByEventId?: RsvpByEventId;
		// The singer's membership, as an explicit 3-state — NOT a memberId-or-null
		// (which conflated "still resolving" with "confirmed non-member"). Each
		// row's control gets the REASON it's disabled, so the non-member hint tracks
		// membership only:
		//   'member'     → control enabled.
		//   'non-member' → disabled + "Only members can RSVP" hint (CONFIRMED only).
		//   'loading'    → unresolved (still looking up, or lookup failed) → disabled,
		//                  NO hint (fail-safe: never a false non-member claim). Mapped
		//                  onto the control's `pending` reason (disabled, no hint).
		membership?: 'loading' | 'member' | 'non-member';
		onrsvpchange?: (item: AgendaItem, status: RsvpStatus | null) => void;
		// #15 — while an event's write is in flight, its whole RsvpControl (all 4
		// buttons) is unclickable (Mihkel's ruling), not just the tapped button.
		// This is the primary #15 fix: a second tap on the same event is
		// structurally impossible at the UI layer, so it can never fire a write
		// against the '__optimistic__' placeholder (rsvpChangeQueue.ts covers the
		// write-orchestration half).
		pendingEventIds?: ReadonlySet<string>;
		// Events whose last write REJECTED — that row surfaces an inline save-failed
		// error (the optimistic value having been reverted upstream).
		failedEventIds?: ReadonlySet<string>;
		// #83 — the 'Recent' section: ALL past events of the current season
		// (already reverse-chronological — see conductorLogic.ts's recentEvents;
		// this component renders in the order given, it does not re-sort). Empty/
		// omitted → no Recent section at all (no heading, no empty-state row).
		recentItems?: AgendaItem[];
		// #83 — events where the signed-in person holds the conductor seat
		// (per-event, because an event-level override can differ row by row — same
		// per-event-Set shape as pendingEventIds/failedEventIds). A recent row
		// whose id is in the set shows the 'Take attendance' button; upcoming rows
		// never show it regardless of membership — attendance is taken after the
		// fact only.
		conductorEventIds?: ReadonlySet<string>;
		ontakeattendance?: (item: AgendaItem) => void;
		// #87 fix — the currently-open attendance panel (undefined = none open
		// anywhere). Rendered directly beneath the 'Take attendance' button of
		// the ONE recent row whose id matches `attendancePanel.item.id` — the
		// page owns all the panel's data/IO (exactly as it always did), this
		// component only decides WHERE the resulting markup lands.
		attendancePanel?: AttendancePanel;
		// #85 — my own attendance badge state per RECENT event id. An event id
		// absent from the map (never marked for me) renders as 'not-recorded' —
		// the same explicit 4th state, not a blank.
		myAttendanceByEventId?: Record<string, BadgeStatus>;
		// #85 — the season summary, rendered ONCE at the top of the Recent
		// section (above the first row), whenever the section itself renders.
		// Presentation lives in SeasonSummary.svelte; the page supplies it here
		// as a snippet so it sits inside this component's 'agenda-recent' markup
		// without AgendaList taking on any attendance IO itself.
		seasonSummary?: Snippet;
		// #90 TR.2 — the page resolves the works view model per event (via
		// repertoire/workRows.ts's loadWorksByEventId) and hands it in keyed by
		// event id, same seam as rsvpByEventId. An event id absent from the map
		// (or mapped to an empty array) renders NO Works line at all — the
		// element is per-event, not a fixed slot.
		worksByEventId?: Record<string, WorkRow[]>;
		// #90 TR.2 — forwarded to every RepertoireElement: a tapped PDF is signed
		// AT CLICK TIME by the page (the signed url lives 60s), never pre-resolved
		// into an href.
		onpdfclick?: (fileId: string) => void;
		// #91 TR.3 — the management surface, forwarded per event row. Omitted =
		// the read-only agenda, unchanged (RepertoireElement's own rights default
		// is 'not-editor', so nothing extra renders).
		//
		// THIS PROP IS THE WHOLE POINT of the TR.3 wiring: without it the write
		// layer had zero runtime importers and `manageRights` could never be
		// anything but the default — every control was unreachable in the product
		// while its unit tests stayed green.
		worksManage?: WorksManage;
	}
	const {
		items,
		loading = false,
		rsvpByEventId = {},
		membership = 'loading',
		onrsvpchange,
		pendingEventIds = new Set<string>(),
		failedEventIds = new Set<string>(),
		recentItems = [],
		conductorEventIds = new Set<string>(),
		ontakeattendance,
		attendancePanel,
		myAttendanceByEventId = {},
		seasonSummary,
		worksByEventId = {},
		onpdfclick,
		worksManage
	}: Props = $props();

	/**
	 * Which management surface an event row shows, from the PROVENANCE of its
	 * rows: an event with its own program_items shows the programme; one without
	 * falls back to the season repertoire (TR.2's hierarchy) and therefore shows
	 * the repertoire surface. Never guessed from ordinals — a program_item whose
	 * ordinal failed to read defaults to 0.
	 */
	function worksContext(eventId: string): 'repertoire' | 'programme' {
		return worksByEventId[eventId]?.some((r) => r.kind === 'program') ? 'programme' : 'repertoire';
	}
	// Stable empty defaults — a fresh `new Set()` / `[]` per render would make
	// every RepertoireElement see a changed prop identity on every agenda tick.
	const NO_KEYS: ReadonlySet<string> = new Set<string>();
	const NO_OPTIONS: never[] = [];
	const NO_OPTIONS_BY_ID: Record<string, never[]> = {};

	function eventRightsFor(eventId: string) {
		return worksManage?.eventRightsByEventId[eventId] ?? 'not-editor';
	}
	/** An event row renders the Works element when it HAS works, or when the
	 *  viewer may add some (otherwise a rights-holder on an empty agenda row has
	 *  no entry point at all). */
	function showWorks(eventId: string): boolean {
		if (worksByEventId[eventId]?.length) return true;
		if (!worksManage) return false;
		return worksManage.seasonRights === 'editor' || eventRightsFor(eventId) === 'editor';
	}

	function badgeStatus(eventId: string): BadgeStatus {
		return myAttendanceByEventId[eventId] ?? 'not-recorded';
	}

	// Tallinn IANA timezone — Europe/Tallinn (UTC+3 in summer, UTC+2 in winter)
	// PRESERVED VERBATIM from the harvested AgendaList (old mvox_v4e_web repo) — see
	// T5 build spec §3. Do not touch the TZ constant, the three formatters below, or
	// the `groups` derivation without re-checking the DST edge cases they guard.
	const TZ = 'Europe/Tallinn';

	// Grouping key: YYYY-MM-DD in Tallinn calendar day (en-CA gives ISO date format)
	const groupKeyFmt = new Intl.DateTimeFormat('en-CA', {
		timeZone: TZ,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit'
	});

	// Locale-aware long header text: "Monday, 15 June" (locale of the browser)
	const headerFmt = new Intl.DateTimeFormat(undefined, {
		timeZone: TZ,
		weekday: 'long',
		day: 'numeric',
		month: 'long'
	});

	// Time-of-day HH:MM (24h, Tallinn)
	const timeFmt = new Intl.DateTimeFormat('en-GB', {
		timeZone: TZ,
		hour: '2-digit',
		minute: '2-digit',
		hour12: false
	});

	// Short date for recent rows (e.g. "14 Jun") — recent rows lack day-group
	// headers, so each row needs its own date label to be distinguishable.
	const shortDateFmt = new Intl.DateTimeFormat(undefined, {
		timeZone: TZ,
		day: 'numeric',
		month: 'short'
	});

	/**
	 * Accessible name for a row's event-detail link. #101 review fix (F2): the
	 * primary fix is upstream — `listRehearsals` now inherits a missing name from
	 * the parent series, same as `loadEventDetail` — but an event with no name
	 * ANYWHERE (Entu's `mandatory` is a UI hint, not enforced) would still yield
	 * the bare "View details for ", i.e. a link a screen reader announces
	 * unnamed. The generic label is the floor, never a silent blank.
	 */
	function rowLinkLabel(name: string): string {
		return name.trim() === ''
			? m.agenda_row_link_label_unnamed()
			: m.agenda_row_link_label({ event: name });
	}

	/** Group items by Tallinn calendar date, preserving chronological order. */
	const groups = $derived.by(() => {
		const seen = new Map<string, AgendaItem[]>();
		const order: string[] = [];
		for (const item of items) {
			const d = new Date(item.startDatetime);
			const key = groupKeyFmt.format(d);
			if (!seen.has(key)) {
				seen.set(key, []);
				order.push(key);
			}
			seen.get(key)!.push(item);
		}
		return order.map((key) => ({
			key,
			header: headerFmt.format(new Date(key + 'T12:00:00')), // noon avoids DST edge on the key date
			rows: seen.get(key)!
		}));
	});

	// --- T5 additions below: relative-day labels + multi-week gap markers. Layered
	// on top of `groups` rather than folded in, so the verbatim block above stays
	// untouched. `now` is read once at component init — fine for a page-load list;
	// revisit if the agenda is ever kept open across a real midnight.
	const now = new Date();
	const todayKey = groupKeyFmt.format(now);
	// Same noon-anchor trick as `header` above: reformat today's noon instant +24h
	// through the Tallinn-zoned formatter, so a DST transition can't shift the day.
	const tomorrowKey = groupKeyFmt.format(
		new Date(new Date(todayKey + 'T12:00:00').getTime() + 24 * 60 * 60 * 1000)
	);

	/**
	 * Whole weeks between two group keys, or null when the gap doesn't clear a
	 * genuine multi-week break. M4 fix: the old `days < 6` threshold fired at a
	 * normal weekly rehearsal cadence (≥6 days apart) — "In 1 weeks" showed up on
	 * every ordinary week. Require ~2 weeks (13+ days) before the marker appears.
	 */
	function gapWeeks(fromKey: string, toKey: string): number | null {
		const fromMs = new Date(fromKey + 'T12:00:00').getTime();
		const toMs = new Date(toKey + 'T12:00:00').getTime();
		const days = Math.round((toMs - fromMs) / (24 * 60 * 60 * 1000));
		if (days < 13) return null;
		return Math.max(1, Math.round(days / 7));
	}

	const decoratedGroups = $derived.by(() => {
		let prevKey: string | null = null;
		return groups.map((group) => {
			const gap = prevKey ? gapWeeks(prevKey, group.key) : null;
			prevKey = group.key;
			const relative: 'today' | 'tomorrow' | null =
				group.key === todayKey ? 'today' : group.key === tomorrowKey ? 'tomorrow' : null;
			return { ...group, relative, gapWeeks: gap };
		});
	});
</script>

<!-- #90 TR.2 / #91 TR.3 — ONE definition of the per-event Works element, shared
     by the Recent and Upcoming row templates. It was duplicated inline, and the
     duplicate is exactly how the management wiring went missing from one of
     them and unnoticed from both. -->
{#snippet worksElement(item: AgendaItem)}
	{#if showWorks(item.id)}
		<RepertoireElement
			rows={worksByEventId[item.id] ?? NO_OPTIONS}
			{onpdfclick}
			context={worksContext(item.id)}
			seasonRights={worksManage?.seasonRights ?? 'not-editor'}
			eventRights={eventRightsFor(item.id)}
			pickableWorksList={worksManage?.pickableWorksList ?? NO_OPTIONS}
			pickableEditions={worksManage?.pickableEditionsByEventId[item.id] ?? NO_OPTIONS}
			editionOptionsByRowId={worksManage?.editionOptionsByRowId ?? NO_OPTIONS_BY_ID}
			pendingKeys={worksManage?.pendingKeys ?? NO_KEYS}
			onaddwork={(workId) => worksManage?.onaddwork(workId)}
			onstatuschange={(itemId, status) => worksManage?.onstatuschange(itemId, status)}
			onpinedition={(itemId, editionId) => worksManage?.onpinedition(itemId, editionId)}
			onremoveitem={(itemId) => worksManage?.onremoveitem(item.id, itemId)}
			onmoveitem={(itemId, direction) => worksManage?.onmoveitem(item.id, itemId, direction)}
			onaddprogramitem={(editionId, ordinal) =>
				worksManage?.onaddprogramitem(item.id, editionId, ordinal)}
		/>
	{/if}
{/snippet}

{#if recentItems.length > 0}
	<!-- #83 — 'Recent': ALL past events of the current season, reverse-chron (order
	     as given, no re-sort here). Sits ABOVE the upcoming list (Byrd's brief).
	     Each row: the existing (read-only, past) RsvpControl + a conductor-only
	     'Take attendance' button, gated per-event via conductorEventIds. -->
	<section data-testid="agenda-recent" class="flex flex-col">
		<h2
			data-testid="agenda-recent-header"
			class="pt-4 pb-1 text-[10px] font-normal tracking-wide text-ink-2 uppercase"
		>
			{m.agenda_recent()}
		</h2>
		<!-- #85 — visible for confirmed MEMBERS whenever the Recent section itself
		     renders, above the first row (never conditional on data: zero attendance
		     renders "Attended 0 of N"). Non-members and loading state see nothing —
		     "Attended 0 of 4" reads as "you skipped everything" to someone who was
		     never expected to attend (F4 fix). -->
		{#if seasonSummary && membership === 'member'}
			{@render seasonSummary()}
		{/if}
		{#each recentItems as item (item.id)}
			<div
				data-testid="agenda-recent-row-{item.id}"
				class="grid grid-cols-[60px_1fr] gap-3 border-b border-dashed border-ink-5 py-2 last:border-b-0"
			>
				<!-- #101 TE.1 -- a decorative, non-focusable twin of the named link below
				     (aria-hidden + tabindex="-1"): a bigger tap target on mobile without a
				     second tab stop announcing the same destination. -->
				<a href="/event/{item.id}" aria-hidden="true" tabindex="-1" class="flex flex-col font-mono">
					<span data-testid="recent-row-date" class="text-[10px] text-ink-2">{shortDateFmt.format(new Date(item.startDatetime))}</span>
					<span class="text-sm text-ink">{timeFmt.format(new Date(item.startDatetime))}</span>
					<span class="text-[10px] text-ink-2">{m.agenda_duration_min({ minutes: item.durationMinutes })}</span>
				</a>
				<div class="flex min-w-0 flex-col gap-1">
					<!-- #101 TE.1 -- the row's ACCESSIBLE tap target: name + tap indicator only
					     (never location/works/RSVP/attendance controls), so no interactive
					     control ever ends up NESTED inside an <a>. -->
					<a
						href="/event/{item.id}"
						aria-label={rowLinkLabel(item.name)}
						class="flex min-w-0 items-baseline gap-1"
					>
						<span class="truncate text-sm text-ink">{item.name}</span>
						<span aria-hidden="true" class="text-ink-3">▸</span>
					</a>
					{#if item.location}
						<span class="truncate text-xs text-ink-2">{item.location}</span>
					{/if}
					{@render worksElement(item)}
					<!-- Past event → the singer's own RsvpControl is read-only (always the
					     'pending'/disabled reason — there is nothing left to answer, and no
					     write is in flight either; reusing 'pending' keeps this a silent
					     disable, no misleading non-member hint). -->
					<RsvpControl status={rsvpByEventId[item.id]?.status ?? null} pending={true} />
					<!-- #85 — every RECENT row carries my own attendance badge, gated on
					     confirmed membership (F4 fix: non-members and loading state see
					     no badge — 'Not recorded' reads as 'you skipped' to someone who
					     was never expected to attend). -->
					{#if membership === 'member'}
						<AttendanceBadge status={badgeStatus(item.id)} testid="attendance-badge-{item.id}" />
					{/if}
					{#if conductorEventIds.has(item.id) && ontakeattendance && !(attendancePanel && attendancePanel.item.id === item.id)}
						<TakeAttendanceButton eventName={item.name} onclick={() => ontakeattendance?.(item)} />
					{/if}
					<!-- #87 fix — the panel is a CHILD of the row that opened it, directly
					     below the button, same inline-expansion pattern as the library
					     browse tree. Only the one row whose id matches the open panel's
					     event renders it — exactly one panel at a time, structurally (the
					     page never hands two rows a match, since `attendanceItem` is a
					     single value). -->
					{#if attendancePanel && attendancePanel.item.id === item.id}
						<AttendanceSurface
							item={attendancePanel.item}
							members={attendancePanel.members}
							attendanceByMemberId={attendancePanel.attendanceByMemberId}
							rsvpByMemberId={attendancePanel.rsvpByMemberId}
							loading={attendancePanel.loading}
							error={attendancePanel.error}
							pendingMemberIds={attendancePanel.pendingMemberIds}
							failedMemberIds={attendancePanel.failedMemberIds}
							ontoggle={attendancePanel.ontoggle}
							onclose={attendancePanel.onclose}
						/>
					{/if}
				</div>
			</div>
		{/each}
	</section>
{/if}
<div data-testid="agenda-list" class="flex flex-col">
	{#if loading}
		<div data-testid="agenda-skeleton" class="flex flex-col" aria-hidden="true">
			{#each [0, 1, 2] as skeletonRow (skeletonRow)}
				<div data-testid="agenda-skeleton-row" class="grid grid-cols-[60px_1fr] gap-3 py-2 animate-pulse">
					<div class="h-4 w-10 rounded bg-ink-5"></div>
					<div class="flex flex-col gap-1.5 pt-0.5">
						<div class="h-3 w-2/3 rounded bg-ink-5"></div>
						<div class="h-2.5 w-1/3 rounded bg-ink-5"></div>
					</div>
				</div>
			{/each}
		</div>
	{:else if items.length === 0}
		<div data-testid="agenda-empty" class="flex min-h-[30vh] items-center justify-center">
			<p class="font-display text-xl text-ink-2">{m.agenda_empty_no_rehearsals()}</p>
		</div>
	{:else}
		{#each decoratedGroups as group (group.key)}
			{#if group.gapWeeks}
				<div data-testid="agenda-gap-marker" class="py-3 text-center font-mono text-[10px] tracking-wide text-ink-2">
					{m.agenda_gap_weeks({ weeks: group.gapWeeks })}
				</div>
			{/if}
			<section data-testid="agenda-day-group" class="flex flex-col">
				<div
					data-testid="agenda-date-header"
					class="flex items-baseline gap-2 pt-4 pb-1 text-[10px] tracking-wide text-ink-2 uppercase"
					class:bg-highlight={group.relative === 'today'}
				>
					{#if group.relative === 'today'}
						<span data-testid="agenda-relative-today" class="font-semibold text-ink">{m.agenda_today()}</span>
					{:else if group.relative === 'tomorrow'}
						<span data-testid="agenda-relative-tomorrow" class="font-semibold text-ink">{m.agenda_tomorrow()}</span>
					{/if}
					<span>{group.header}</span>
				</div>
				{#each group.rows as item (item.id)}
					<div data-testid="agenda-row-{item.id}" class="grid grid-cols-[60px_1fr] gap-3 border-b border-dashed border-ink-5 py-2 last:border-b-0">
						<!-- #101 TE.1 — a decorative, non-focusable twin of the named link below
						     (aria-hidden + tabindex="-1"): a bigger tap target on mobile without a
						     second tab stop announcing the same destination. -->
						<a href="/event/{item.id}" aria-hidden="true" tabindex="-1" class="flex flex-col font-mono">
							<span data-testid="row-time" class="text-sm text-ink">{timeFmt.format(new Date(item.startDatetime))}</span>
							<span data-testid="row-duration" class="text-[10px] text-ink-2">{m.agenda_duration_min({ minutes: item.durationMinutes })}</span>
						</a>
						<div class="flex min-w-0 flex-col gap-1">
							<!-- #101 TE.1 — the row's ACCESSIBLE tap target: name + ▸ indicator only
							     (never location/works/RSVP), so no interactive control (RsvpControl's
							     buttons, RepertoireElement's) ever ends up NESTED inside an <a> — a
							     tap on 'Going' must record an RSVP, never navigate. -->
							<a
								href="/event/{item.id}"
								aria-label={rowLinkLabel(item.name)}
								class="flex min-w-0 items-baseline gap-1"
							>
								<span class="truncate text-sm text-ink">{item.name}</span>
								<span aria-hidden="true" class="text-ink-3">▸</span>
							</a>
							{#if item.location}
								<span data-testid="row-location" class="truncate text-xs text-ink-2">{item.location}</span>
							{/if}
							{@render worksElement(item)}
							<RsvpControl
								status={rsvpByEventId[item.id]?.status ?? null}
								nonMember={membership === 'non-member'}
								pending={membership === 'loading' || pendingEventIds.has(item.id)}
								saveFailed={failedEventIds.has(item.id)}
								onchange={(newStatus) => onrsvpchange?.(item, newStatus)}
							/>
						</div>
					</div>
				{/each}
			</section>
		{/each}
	{/if}
</div>
