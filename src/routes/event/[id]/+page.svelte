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
	let status = $state<Status>('loading');
	let detail = $state<EventDetail | null>(null);

	async function loadForSelected(): Promise<void> {
		const current = selected;
		const id = eventId;
		const g = ++generation;
		if (!current || !id) {
			status = 'no-collective';
			detail = null;
			return;
		}
		status = 'loading';
		detail = null;
		try {
			const cfg = { db: current.db, token: getToken() ?? '' };
			const loaded = await loadEventDetail(cfg, id);
			if (g !== generation) return; // superseded by a newer selection/param
			detail = loaded;
			status = 'ready';
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
			</div>
		{/if}
	</div>
</main>
