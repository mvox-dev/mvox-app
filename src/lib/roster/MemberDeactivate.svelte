<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import EntuRef from '$lib/components/EntuRef.svelte';
	import type { RosterRow } from '$lib/roster/rosterData';
	import type { Collective } from '$lib/collectives/types';
	import type { MemberOpsState } from '$lib/roster/rosterPageState';
	import type { MemberOps } from '$lib/roster/rosterMemberOps';

	let {
		row,
		selected,
		memberOps,
		ops,
		isOffline
	}: {
		row: RosterRow;
		selected: Collective | null;
		memberOps: MemberOpsState;
		ops: MemberOps;
		isOffline: boolean;
	} = $props();
</script>

<div class="relative mt-1 flex flex-wrap items-center gap-2">
	{#if memberOps.pendingDeactivateId === row.memberId}
		<span class="text-xs text-ink-2">{m.roster_member_deactivate_confirm_prompt()}</span>
		<button
			type="button"
			data-testid="member-deactivate-confirm-{row.memberId}"
			disabled={memberOps.deactivatePending || isOffline}
			aria-busy={memberOps.deactivatePending}
			class="rounded-md border border-red-700 px-2 py-1 text-xs text-red-700 hover:bg-red-700 hover:text-paper disabled:opacity-50"
			onclick={() => ops.handleDeactivateConfirm(row)}
		>
			{m.roster_member_deactivate_confirm()}
		</button>
		<button
			type="button"
			data-testid="member-deactivate-cancel-{row.memberId}"
			disabled={memberOps.deactivatePending}
			class="rounded-md border border-ink-4 px-2 py-1 text-xs text-ink-2 hover:text-ink disabled:opacity-50"
			onclick={() => ops.disarmDeactivate(row.memberId)}
		>
			{m.roster_member_deactivate_cancel()}
		</button>
	{:else}
		<button
			type="button"
			data-testid="member-deactivate-{row.memberId}"
			disabled={memberOps.deactivatePending || isOffline}
			class="rounded-md border border-ink-4 px-2 py-1 text-xs text-ink-2 hover:text-ink disabled:opacity-50"
			onclick={() => ops.armDeactivate(row.memberId)}
		>
			{m.roster_member_deactivate()}
		</button>
	{/if}
</div>
{#if memberOps.pendingDeactivateId === row.memberId && memberOps.deactivateRefusal?.memberId === row.memberId}
	<p
		data-testid="member-deactivate-refused-{row.memberId}"
		role="alert"
		class="relative text-xs text-red-700"
	>
		{#each memberOps.deactivateRefusal.blockers as blocker (blocker.role)}
			{blocker.role === 'admin'
				? m.roster_deactivate_refused_admin({ collective: selected?.name ?? '' })
				: m.roster_deactivate_refused_librarian({ collective: selected?.name ?? '' })}
		{/each}
	</p>
{/if}
{#if memberOps.pendingDeactivateId === row.memberId && memberOps.deactivateActionError?.memberId === row.memberId && memberOps.deactivateActionError.kind === 'deactivate'}
	<p
		data-testid="member-deactivate-failed-{row.memberId}"
		role="alert"
		class="relative text-xs text-red-700"
	>
		{m.roster_member_deactivate_failed()}
		<EntuRef id={row.memberId} />
	</p>
{/if}
