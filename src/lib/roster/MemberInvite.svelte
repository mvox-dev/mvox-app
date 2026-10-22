<script lang="ts">
	import FormError from '$lib/components/FormError.svelte';
	import { m } from '$lib/paraglide/messages.js';
	import type { RosterRow } from '$lib/roster/rosterData';
	import type { MemberOpsState, RosterState } from '$lib/roster/rosterPageState';
	import type { MemberOps } from '$lib/roster/rosterMemberOps';

	let {
		row,
		roster,
		memberOps,
		ops,
		isOffline
	}: {
		row: RosterRow;
		roster: RosterState;
		memberOps: MemberOpsState;
		ops: MemberOps;
		isOffline: boolean;
	} = $props();
</script>

{#if roster.joinStates[row.personId] !== undefined}
	{@const state = roster.joinStates[row.personId]}
	{#if roster.dbRight === 'owner'}
		<div class="flex flex-wrap items-center gap-2">
			{#if state === 'absent'}
				<button
					type="button"
					data-testid="roster-member-invite-{row.memberId}"
					disabled={memberOps.inviteActionPending || isOffline}
					class="rounded-md border border-ink-4 px-2 py-1 text-xs text-ink-2 hover:text-ink disabled:opacity-50"
					onclick={() => ops.handleSendInvite(row)}
				>
					{m.roster_member_invite()}
				</button>
			{:else if state === 'invited'}
				<button
					type="button"
					data-testid="roster-member-reinvite-{row.memberId}"
					disabled={memberOps.inviteActionPending || isOffline}
					class="rounded-md border border-ink-4 px-2 py-1 text-xs text-ink-2 hover:text-ink disabled:opacity-50"
					onclick={() => ops.handleSendInvite(row)}
				>
					{m.roster_member_reinvite()}
				</button>
				<button
					type="button"
					data-testid="roster-member-withdraw-{row.memberId}"
					disabled={memberOps.inviteActionPending || isOffline}
					class="rounded-md border border-ink-4 px-2 py-1 text-xs text-ink-2 hover:text-ink disabled:opacity-50"
					onclick={() => ops.handleWithdrawInvite(row)}
				>
					{m.roster_member_withdraw()}
				</button>
			{/if}
		</div>
	{/if}
	{#if memberOps.inviteOutcomeByMemberId[row.memberId]}
		{@const outcome = memberOps.inviteOutcomeByMemberId[row.memberId]}
		{#if outcome.sent}
			<p data-testid="roster-invite-sent-{row.memberId}" role="status" class="text-xs text-ink-2">
				{m.roster_member_invite_sent({ email: outcome.email })}
			</p>
		{:else}
			<p data-testid="roster-invite-no-email-{row.memberId}" role="status" class="text-xs text-ink-2">
				{m.roster_member_invite_no_email()}
			</p>
		{/if}
	{/if}
	{#if memberOps.inviteErrorByMemberId[row.memberId]}
		<FormError data-testid="roster-invite-error-{row.memberId}">
			{m.roster_member_invite_send_failed()}
		</FormError>
	{/if}
	{#if memberOps.withdrawErrorByMemberId[row.memberId]}
		<FormError data-testid="roster-withdraw-error-{row.memberId}">
			{m.roster_member_withdraw_failed()}
		</FormError>
	{/if}
{/if}
