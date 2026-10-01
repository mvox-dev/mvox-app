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
	{#if roster.ownerTier === 'owner'}
		<div class="flex flex-wrap items-center gap-2">
			{#if state === 'absent'}
				<button
					type="button"
					data-testid="roster-member-invite-{row.memberId}"
					disabled={memberOps.inviteActionPending || isOffline}
					class="rounded-md border border-ink-4 px-2 py-1 text-xs text-ink-2 hover:text-ink disabled:opacity-50"
					onclick={() => ops.handleMintInvite(row)}
				>
					{m.roster_member_invite()}
				</button>
			{:else if state === 'invited'}
				<button
					type="button"
					data-testid="roster-member-reinvite-{row.memberId}"
					disabled={memberOps.inviteActionPending || isOffline}
					class="rounded-md border border-ink-4 px-2 py-1 text-xs text-ink-2 hover:text-ink disabled:opacity-50"
					onclick={() => ops.handleMintInvite(row)}
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
	{#if memberOps.inviteLinkByMemberId[row.memberId]}
		<p class="text-xs">{m.admin_invite_link_label()}</p>
		<button
			type="button"
			data-testid="roster-invite-copy-{row.memberId}"
			class="self-start rounded-md border border-ink-5 px-3 py-1 text-xs text-ink-2 hover:text-ink"
			onclick={() => ops.copyInviteLink(row.memberId)}
		>
			{m.admin_invite_copy()}
		</button>
		<p
			data-testid="roster-invite-copy-status-{row.memberId}"
			role="status"
			aria-live="polite"
			class="min-h-[16px] text-xs leading-[16px] text-ink-2"
		>
			{#if memberOps.copiedByMemberId[row.memberId]}{m.admin_invite_copied()}{/if}
		</p>
		{#if memberOps.copyFailedByMemberId[row.memberId]}
			<FormError data-testid="roster-invite-copy-error-{row.memberId}">
				{m.admin_invite_copy_error()}
			</FormError>
		{/if}
		<p class="text-xs text-ink-3">{m.admin_invite_bearer_warning()}</p>
	{/if}
	{#if memberOps.inviteErrorByMemberId[row.memberId]}
		<FormError data-testid="roster-invite-error-{row.memberId}">
			{m.admin_invite_error()}
		</FormError>
	{/if}
	{#if memberOps.withdrawErrorByMemberId[row.memberId]}
		<FormError data-testid="roster-withdraw-error-{row.memberId}">
			{m.roster_member_withdraw_failed()}
		</FormError>
	{/if}
{/if}
