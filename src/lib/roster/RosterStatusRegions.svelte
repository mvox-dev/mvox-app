<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import type { AdminState } from '$lib/nav/adminStore';
	import type { MemberOpsState } from '$lib/roster/rosterPageState';
	import type { ArrangeState } from '$lib/sections/sectionArrangeOps';

	let {
		arrange,
		memberOps,
		admin
	}: { arrange: ArrangeState; memberOps: MemberOpsState; admin: AdminState } = $props();
</script>

<div data-testid="roster-reorder-status" role="status" aria-live="polite" class="sr-only">
	{arrange.reorderStatus}
</div>

{#if admin === 'admin'}
	<span
		id="section-reorder-instructions"
		data-testid="roster-reorder-instructions"
		class="sr-only"
	>
		{m.roster_section_reorder_instructions()}
	</span>
{/if}

<div
	data-testid="roster-section-remove-status"
	role="status"
	aria-live="polite"
	class="sr-only"
>
	{arrange.removeStatus}
</div>

<div
	data-testid="roster-section-create-status"
	role="status"
	aria-live="polite"
	class="sr-only"
>
	{arrange.pageCreateStatus}
</div>

<div
	data-testid="roster-section-rename-status"
	role="status"
	aria-live="polite"
	class="sr-only"
>
	{arrange.renameStatus}
</div>

<div
	data-testid="roster-member-record-status"
	role="status"
	aria-live="polite"
	class="sr-only"
>
	{memberOps.recordStatus}
</div>
