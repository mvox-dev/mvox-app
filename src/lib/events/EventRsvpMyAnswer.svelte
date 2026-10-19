<script lang="ts">
	import { untrack } from 'svelte';
	import { cfgFor } from '$lib/entu/cfg';
	import { isPastDetail } from '$lib/events/eventTime';
	import RsvpControl from '$lib/components/agenda/RsvpControl.svelte';
	import RsvpNonMemberHint from '$lib/components/agenda/RsvpNonMemberHint.svelte';
	import type { RsvpStatus } from '$lib/rsvp/rsvpData';
	import type { RsvpEntry } from '$lib/rsvp/rsvpData';
	import { createRsvpWriteStatus, existingRsvp } from '$lib/rsvp/rsvpWriteStatus';
	import { createWriteTokens } from '$lib/net/writeTokens';
	import type { EntuCfg } from '$lib/seasons/entuSeasons';
	import { reportProblem } from '$lib/problems/reportProblem';
	import type { Collective } from '$lib/collectives/types';
	import type { EventDetail } from '$lib/events/eventDetail';
	import type { EventActions, EventPageState } from '$lib/events/eventPageState';

	let {
		detail,
		selected,
		ev,
		isOffline,
		generation,
		actions,
		onreconcile
	}: {
		detail: EventDetail;
		selected: Collective | null;
		ev: EventPageState;
		isOffline: boolean;
		generation: () => number;
		actions: EventActions;
		onreconcile: () => void;
	} = $props();

	const isPast = $derived(isPastDetail(detail));

	let rsvpRights = $state<'loading' | 'editor' | 'not-editor'>('loading');
	let myRsvp = $state<RsvpEntry | null>(null);
	let rsvpPending = $state(false);
	let rsvpFailed = $state(false);
	let rsvpSaved = $state(false);

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
			.catch((e) => {
				if (g !== generation()) return;
				reportProblem({ area: 'event', action: 'loading your answer', error: e });
				myRsvp = null;
			});
	}

	const rsvpQueue = untrack(() =>
		actions.createRsvpChangeQueue(
			createRsvpWriteStatus({
				tokens: createWriteTokens((evId: string) => (evId === detail?.id ? generation() : null)),
				accessors: {
					setEntry: (_evId, entry) => (myRsvp = entry),
					setPending: (_evId, pending) => (rsvpPending = pending),
					setFailed: (_evId, failed) => (rsvpFailed = failed),
					setSaved: (_evId, saved) => (rsvpSaved = saved)
				},
				onReconcile: onreconcile
			})
		)
	);

	function handleRsvpChange(newStatus: RsvpStatus | null): void {
		if (!selected || !detail) return;
		if (isOffline) return;
		const cfg = cfgFor(selected.db);
		const personId = selected.personId;
		const g = generation();
		const existing = existingRsvp(myRsvp, detail.id);
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
		loadRsvpControl(cfgFor(selected.db), selected.personId, detail.id, generation());
	});
</script>

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
