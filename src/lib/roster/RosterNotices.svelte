<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import type { AdminState } from '$lib/nav/adminStore';
	import type { RosterState } from '$lib/roster/rosterPageState';
	import type { ArrangeState } from '$lib/sections/sectionArrangeOps';

	let {
		roster,
		arrange,
		admin
	}: { roster: RosterState; arrange: ArrangeState; admin: AdminState } = $props();
</script>

{#if admin === 'admin' && roster.ownerTier !== 'owner' && roster.ownerTier !== 'loading'}
	<p data-testid="roster-invite-owner-note" class="text-xs text-ink-2">
		{m.roster_member_invite_owner_only()}
	</p>
{/if}
{#if roster.sectionsError}
	<div data-testid="roster-sections-load-error" class="flex flex-col gap-1" role="alert">
		<p class="text-sm text-red-700">{m.roster_sections_load_error()}</p>
	</div>
{/if}
{#if arrange.reorderError}
	<p data-testid="section-reorder-error" role="alert" class="text-sm text-red-700">
		{arrange.reparentPartial ? m.roster_section_reparent_partial() : m.roster_section_reorder_failed()}
	</p>
{/if}
{#if arrange.removeError}
	<p data-testid="section-remove-error" role="alert" class="text-sm text-red-700">
		{arrange.removeError.kind === 'not-empty'
			? m.roster_section_remove_not_empty({ name: arrange.removeError.name })
			: m.roster_section_remove_failed({ name: arrange.removeError.name })}
	</p>
{/if}
{#if arrange.reorderPending}
	<div
		data-testid="section-reorder-pending"
		role="status"
		aria-busy="true"
		aria-live="polite"
		class="flex items-center gap-2 text-xs text-ink-2"
	>
		<span
			aria-hidden="true"
			class="h-3 w-3 animate-spin rounded-full border-2 border-ink-3 border-t-transparent"
		></span>
		{m.roster_section_reorder_pending()}
	</div>
{/if}
