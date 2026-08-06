<script lang="ts">
	import { authStore } from '$lib/auth/session';
	import { collectiveState, selectedCollectiveStore, pickerModeStore } from '$lib/collectives/store';
	import { loadAgenda } from '$lib/agenda/agendaData';
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
	import { m } from '$lib/paraglide/messages.js';
	import DeskSurface from '$lib/components/DeskSurface.svelte';
	import AgendaList from '$lib/components/agenda/AgendaList.svelte';

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
			return;
		}
		const thisRequest = ++requestId;
		agendaLoading = true;
		agendaError = false;
		// Fresh selection → membership is unresolved again (not carried over as a
		// stale member/non-member), and no event has a failed write yet.
		memberId = null;
		membership = 'loading';
		failedEventIds = new Set();

		const cfg = { db: current.db, token: getToken() ?? '' };
		const personId = current.personId;

		loadAgenda()
			.then((items) => {
				if (thisRequest !== requestId) return; // superseded by a newer selection
				agendaItems = items;
				agendaLoading = false;
			})
			.catch(() => {
				// M2 fix: without this catch, a rejected loadAgenda left agendaLoading
				// stuck at true forever — permanent skeleton, no error, no recovery.
				if (thisRequest !== requestId) return;
				agendaLoading = false;
				agendaError = true;
			});

		findMyMemberId(cfg, personId)
			.then((id) => {
				if (thisRequest !== requestId) return;
				// A genuine resolution: an id → member; null → CONFIRMED non-member.
				memberId = id;
				membership = id ? 'member' : 'non-member';
			})
			.catch(() => {
				if (thisRequest !== requestId) return;
				// Lookup FAILED — do NOT assert non-member. Stay unresolved (disabled,
				// no false hint) and fail safe.
				memberId = null;
				membership = 'loading';
			});

		listMyRsvps(cfg, personId)
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
						<a class="underline" href="/auth/logout">Sign out</a>
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
							{membership}
							{pendingEventIds}
							{failedEventIds}
							onrsvpchange={handleRsvpChange}
						/>
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
			<a class="text-sm underline" href="/auth/logout">Sign out</a>
		</main>
	{/if}
{:else if auth.status === 'anonymous'}
	<main class="flex min-h-screen flex-col items-center justify-center gap-4 bg-paper text-ink">
		<p class="text-sm text-ink" data-testid="auth-status">Signed out</p>
		<a class="text-sm underline" href="/auth/login">Sign in</a>
	</main>
{/if}
