<script lang="ts">
	import { untrack } from 'svelte';
	import { m } from '$lib/paraglide/messages.js';
	import { getToken } from '$lib/auth/storage';
	import { listActiveMembers, loadRoster } from '$lib/roster/rosterData';
	import { isPastDetail } from '$lib/events/eventTime';
	import RsvpControl from '$lib/components/agenda/RsvpControl.svelte';
	import RsvpNonMemberHint from '$lib/components/agenda/RsvpNonMemberHint.svelte';
	import PersonName from '$lib/components/PersonName.svelte';
	import type { MyRsvp, RsvpStatus } from '$lib/rsvp/rsvpData';
	import type { RsvpEntry } from '$lib/rsvp/rsvpChangeQueue';
	import type { EntuCfg } from '$lib/seasons/entuSeasons';
	import type { Collective } from '$lib/collectives/types';
	import type { EventDetail } from '$lib/events/eventDetail';
	import type { EventActions, EventPageState } from '$lib/events/eventPageState';

	let {
		detail,
		selected,
		ev,
		isOffline,
		generation,
		writeGenerations,
		isCurrentWrite,
		actions
	}: {
		detail: EventDetail;
		selected: Collective | null;
		ev: EventPageState;
		isOffline: boolean;
		generation: () => number;
		writeGenerations: Map<string, number>;
		isCurrentWrite: (evId: string) => boolean;
		actions: EventActions;
	} = $props();

	const isPast = $derived(isPastDetail(detail));

	let rsvpRights = $state<'loading' | 'editor' | 'not-editor'>('loading');
	let myRsvp = $state<RsvpEntry | null>(null);
	let rsvpPending = $state(false);
	let rsvpFailed = $state(false);
	let rsvpSaved = $state(false);

	let tally = $state<{
		going: number;
		not_going: number;
		maybe: number;
		late: number;
		not_responded: number | null;
	} | null>(null);
	let tallyError = $state(false);

	const RSVP_TALLY_STATUS_ORDER = ['going', 'not_going', 'maybe', 'late', 'not_responded'] as const;
	type RsvpTallyStatus = (typeof RSVP_TALLY_STATUS_ORDER)[number];

	let tallyMemberIdsByStatus = $state<Record<
		'going' | 'not_going' | 'maybe' | 'late',
		string[]
	> | null>(null);
	let tallyNotRespondedMemberIds = $state<string[] | null>(null);
	let tallyRawRowCount = $state(0);

	let tallyCardOpen = $state(false);
	let tallyCardNames = $state<Record<string, string> | null>(null);
	let tallyCardNamesError = $state(false);
	let tallyCardNamesPartial = $state(false);
	let tallyMembersPartial = $state(false);

	function loadRsvpControl(cfg: EntuCfg, personId: string, evId: string, g: number): void {
		actions.resolveManageRights(cfg, personId, personId).then((state) => {
			if (g !== generation()) return;
			rsvpRights = state === 'editor' ? 'editor' : 'not-editor';
		});

		actions.findMyRsvpForEvent(cfg, personId, evId)
			.then((entry) => {
				if (g !== generation()) return;
				myRsvp = entry;
			})
			.catch(() => {
				if (g !== generation()) return;
				myRsvp = null;
			});
	}

	function loadTally(cfg: EntuCfg, evId: string, g: number, past: boolean): void {
		Promise.all([
			actions.listAllRsvpsForEvent(cfg, evId),
			past ? Promise.resolve<null>(null) : listActiveMembers(cfg)
		])
			.then(([rows, activeMembersRead]) => {
				if (g !== generation()) return;
				const activeMembers = activeMembersRead?.items;
				tallyMembersPartial = activeMembersRead?.truncated ?? false;
				const scoped = activeMembers
					? rows.filter((r) => activeMembers.some((am) => am.memberId === r.memberId))
					: rows;
				const answeredMemberIds = new Set(scoped.map((r) => r.memberId));
				const notResponded = activeMembers
					? activeMembers.filter((am) => !answeredMemberIds.has(am.memberId)).map((am) => am.memberId)
					: null;
				tallyError = false;
				tallyRawRowCount = rows.length;
				tallyMemberIdsByStatus = {
					going: scoped.filter((r) => r.status === 'going').map((r) => r.memberId),
					not_going: scoped.filter((r) => r.status === 'not_going').map((r) => r.memberId),
					maybe: scoped.filter((r) => r.status === 'maybe').map((r) => r.memberId),
					late: scoped.filter((r) => r.status === 'late').map((r) => r.memberId)
				};
				tallyNotRespondedMemberIds = notResponded;
				tally = {
					going: tallyMemberIdsByStatus.going.length,
					not_going: tallyMemberIdsByStatus.not_going.length,
					maybe: tallyMemberIdsByStatus.maybe.length,
					late: tallyMemberIdsByStatus.late.length,
					not_responded: notResponded?.length ?? null
				};
			})
			.catch((e) => {
				if (g !== generation()) return;
				console.error('event detail: tally load failed', e);
				tally = null;
				tallyError = true;
				tallyMemberIdsByStatus = null;
				tallyNotRespondedMemberIds = null;
				tallyRawRowCount = 0;
				tallyCardOpen = false;
				tallyCardNames = null;
				tallyCardNamesError = false;
				tallyCardNamesPartial = false;
				tallyMembersPartial = false;
			});
	}

	function retryTally(): void {
		const current = selected;
		const loaded = detail;
		if (!current || !loaded) return;
		tallyError = false;
		loadTally({ db: current.db, token: getToken() ?? '' }, loaded.id, generation(), isPastDetail(loaded));
	}

	const showTallyCardToggle = $derived(
		tally !== null &&
			!tallyError &&
			(tallyRawRowCount > 0 || (tallyNotRespondedMemberIds?.length ?? 0) > 0)
	);

	const tallyCardGroups = $derived.by<
		{ status: RsvpTallyStatus; count: number; memberIds: string[] }[] | null
	>(() => {
		if (!tally || !tallyMemberIdsByStatus) return null;
		const groups: { status: RsvpTallyStatus; count: number; memberIds: string[] }[] = [
			{ status: 'going', count: tally.going, memberIds: tallyMemberIdsByStatus.going },
			{ status: 'not_going', count: tally.not_going, memberIds: tallyMemberIdsByStatus.not_going },
			{ status: 'maybe', count: tally.maybe, memberIds: tallyMemberIdsByStatus.maybe },
			{ status: 'late', count: tally.late, memberIds: tallyMemberIdsByStatus.late }
		];
		if (tallyNotRespondedMemberIds !== null) {
			groups.push({
				status: 'not_responded',
				count: tallyNotRespondedMemberIds.length,
				memberIds: tallyNotRespondedMemberIds
			});
		}
		return groups;
	});

	function rsvpTallyStatusLabel(status: RsvpTallyStatus): string {
		switch (status) {
			case 'going':
				return m.rsvp_status_going();
			case 'not_going':
				return m.rsvp_status_not_going();
			case 'maybe':
				return m.rsvp_status_maybe();
			case 'late':
				return m.rsvp_status_late();
			case 'not_responded':
				return m.rsvp_status_not_responded();
		}
	}

	function loadTallyCardNames(): void {
		const current = selected;
		const loaded = detail;
		if (!current || !loaded) return;
		const g = generation();
		const evId = loaded.id;
		const cfg = { db: current.db, token: getToken() ?? '' };
		tallyCardNamesError = false;
		const read = isPastDetail(loaded) ? actions.loadRosterIncludingArchived(cfg) : loadRoster(cfg);
		read
			.then((rosterRead) => {
				if (g !== generation() || detail?.id !== evId) return;
				const names: Record<string, string> = {};
				for (const row of rosterRead.items) names[row.memberId] = row.name;
				tallyCardNames = names;
				tallyCardNamesPartial = rosterRead.truncated;
			})
			.catch((e) => {
				console.error('event detail: tally card roster load failed', e);
				if (g !== generation() || detail?.id !== evId) return;
				tallyCardNames = null;
				tallyCardNamesPartial = false;
				tallyCardNamesError = true;
			});
	}

	function retryTallyCardNames(): void {
		loadTallyCardNames();
	}

	function toggleTallyCard(): void {
		if (tallyCardOpen) {
			tallyCardOpen = false;
			return;
		}
		tallyCardOpen = true;
		loadTallyCardNames();
	}

	const rsvpQueue = untrack(() =>
		actions.createRsvpChangeQueue({
			setOptimistic(evId, entry) {
				if (!isCurrentWrite(evId)) return;
				myRsvp = entry;
			},
			setPending(evId, isPending) {
				if (isPending) writeGenerations.set(evId, generation());
				if (!isCurrentWrite(evId)) return;
				rsvpPending = isPending;
				if (isPending) rsvpFailed = false;
				if (isPending) rsvpSaved = false;
			},
			reconcile(evId, entry) {
				const stillCurrent = isCurrentWrite(evId);
				writeGenerations.delete(evId);
				if (!stillCurrent) return;
				myRsvp = entry;
				rsvpSaved = true;
				const current = selected;
				const loaded = detail;
				if (current && loaded) {
					loadTally({ db: current.db, token: getToken() ?? '' }, loaded.id, generation(), isPastDetail(loaded));
				}
			},
			revert(evId, before) {
				const stillCurrent = isCurrentWrite(evId);
				writeGenerations.delete(evId);
				if (!stillCurrent) return;
				myRsvp = before;
				rsvpFailed = true;
				rsvpSaved = false;
			}
		})
	);

	function handleRsvpChange(newStatus: RsvpStatus | null): void {
		if (!selected || !detail) return;
		if (isOffline) return;
		const cfg = { db: selected.db, token: getToken() ?? '' };
		const personId = selected.personId;
		const g = generation();
		const existing: MyRsvp | null = myRsvp
			? { rsvpId: myRsvp.rsvpId, eventId: detail.id, status: myRsvp.status }
			: null;
		rsvpQueue.request({
			cfg,
			personId,
			memberId: ev.memberId,
			resolveMemberId: async () => {
				const id = await actions.findMyMemberId(cfg, personId);
				if (g === generation()) {
					ev.memberId = id;
					if (!id) ev.membership = 'non-member';
				}
				return id;
			},
			eventId: detail.id,
			existing,
			newStatus
		});
	}

	untrack(() => {
		if (!selected) return;
		const cfg = { db: selected.db, token: getToken() ?? '' };
		const g = generation();
		loadRsvpControl(cfg, selected.personId, detail.id, g);
		loadTally(cfg, detail.id, g, isPastDetail(detail));
	});
</script>

<section
	data-testid="event-detail-rsvp"
	class="mt-3 flex flex-col gap-2"
	aria-labelledby="event-detail-rsvp-heading"
>
	<h2 id="event-detail-rsvp-heading" class="font-display text-lg text-ink-2">
		{m.event_detail_rsvp_heading()}
	</h2>
	{#if isPast}
		<RsvpControl status={myRsvp?.status ?? null} pending={true} />
	{:else if ev.membership === 'non-member'}
		<RsvpNonMemberHint />
	{:else if rsvpRights !== 'not-editor'}
		<RsvpControl
			status={myRsvp?.status ?? null}
			pending={rsvpRights === 'loading' || rsvpPending}
			saveFailed={rsvpFailed}
			saved={rsvpSaved}
			onchange={handleRsvpChange}
		/>
	{/if}
	{#snippet tallyLine()}
		{#if tally}
			<span data-testid="event-detail-tally" class="text-xs text-ink-2" aria-live="polite">
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
				{#if tally.not_responded !== null}
					·
					<span data-testid="event-detail-tally-not_responded"
						>{m.event_detail_tally_not_responded({ count: tally.not_responded })}</span
					>
				{/if}
			</span>
		{/if}
	{/snippet}
	{#if tally}
		{#if showTallyCardToggle}
			<button
				type="button"
				data-testid="event-detail-tally-toggle"
				class="flex w-full flex-wrap items-baseline gap-1 text-left"
				aria-expanded={tallyCardOpen}
				onclick={toggleTallyCard}
			>
				{@render tallyLine()}
				<span class="sr-only"
					>{tallyCardOpen
						? m.event_detail_tally_card_collapse_label()
						: m.event_detail_tally_card_expand_label()}</span
				>
			</button>
			{#if tallyCardOpen}
				<div
					data-testid="event-detail-tally-card"
					class="flex flex-col gap-2 rounded-md border border-ink-5 p-2 text-xs text-ink-2"
				>
					{#if tallyCardNamesError}
						<p
							data-testid="event-detail-tally-card-names-error"
							role="status"
							class="flex flex-wrap items-baseline gap-2 text-red-700"
						>
							<span>{m.event_detail_tally_names_error()}</span>
							<button
								type="button"
								data-testid="event-detail-tally-card-names-retry"
								class="underline"
								onclick={retryTallyCardNames}
							>
								{m.event_detail_retry()}
							</button>
						</p>
					{/if}
					{#if tallyCardNamesPartial}
						<p data-testid="event-detail-tally-card-partial-notice" class="text-ink-2">
							{m.picker_partial_members_notice()}
						</p>
					{/if}
					{#if tallyCardNames === null && !tallyCardNamesError}
						<p data-testid="event-detail-tally-card-loading" class="text-ink-2">
							{m.picker_roster_loading()}
						</p>
					{/if}
					{#each tallyCardGroups ?? [] as group (group.status)}
						<div data-testid={`event-detail-tally-card-group-${group.status}`}>
							<h3 class="font-medium text-ink">
								{rsvpTallyStatusLabel(group.status)} ({group.count})
							</h3>
							{#if group.memberIds.length > 0 && tallyCardNames}
								<ul class="pl-3">
									{#each group.memberIds as memberId (memberId)}
										<li>
											<PersonName
												name={tallyCardNames[memberId] ??
													m.event_detail_tally_name_unavailable()}
											/>
										</li>
									{/each}
								</ul>
							{/if}
						</div>
					{/each}
				</div>
			{/if}
		{:else}
			{@render tallyLine()}
		{/if}
		{#if tallyMembersPartial && tally.not_responded !== null && !tallyCardNamesPartial}
			<p data-testid="event-detail-tally-partial-notice" class="text-xs text-ink-2">
				{m.picker_partial_members_notice()}
			</p>
		{/if}
		{#if detail.capacity !== null}
			<p data-testid="event-detail-capacity" class="text-xs text-ink-2">
				{m.event_detail_capacity({ going: tally.going, capacity: detail.capacity })}
			</p>
		{/if}
	{/if}
	{#if tallyError}
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
