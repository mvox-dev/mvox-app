<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import type { EditRightState } from '$lib/nav/dbRights';
	import type { MemberOpsState } from '$lib/roster/rosterPageState';
	import type { ArrangeState } from '$lib/sections/sectionArrangeOps';

	let {
		arrange,
		memberOps,
		editRight
	}: { arrange: ArrangeState; memberOps: MemberOpsState; editRight: EditRightState } = $props();
</script>

<div data-testid="roster-reorder-status" role="status" aria-live="polite" class="sr-only">
	{arrange.reorderStatus}
</div>

{#if editRight === 'editor'}
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
