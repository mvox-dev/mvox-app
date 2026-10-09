<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import type { RosterState } from '$lib/roster/rosterPageState';
	import type { MemberOps } from '$lib/roster/rosterMemberOps';

	let { roster, ops }: { roster: RosterState; ops: MemberOps } = $props();
</script>

<button
	type="button"
	data-testid="roster-inactive-toggle"
	aria-expanded={roster.showInactive}
	class="self-start text-xs tracking-wide text-ink-2 uppercase underline hover:text-ink"
	onclick={() => ops.toggleInactive()}
>
	{roster.showInactive ? m.roster_inactive_hide() : m.roster_inactive_show()}
</button>
