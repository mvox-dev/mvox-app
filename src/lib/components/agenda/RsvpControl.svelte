<!-- src/lib/components/agenda/RsvpControl.svelte -->
<!--
	#12 RED stub. Byrd implements the real 4-button segmented control — harvest
	`mvox_v4e_web` `src/lib/components/agenda/RsvpControl.svelte` (same shape:
	tap-active-to-clear, disabled + hint for non-members). This app's i18n import
	style differs from the harvest source: `import { m } from '$lib/paraglide/messages.js'`
	(not `import * as m`), matching AgendaList.svelte. No RsvpTallyBadge — tally is
	out of scope for slice-2 (see epic #8).
-->
<script lang="ts">
	import type { RsvpStatus } from '$lib/rsvp/rsvpData';

	interface Props {
		status?: RsvpStatus | null;
		disabled?: boolean;
		onchange?: (s: RsvpStatus | null) => void;
	}
	const { status = null, disabled = false, onchange }: Props = $props();
</script>

<!-- stub: status={status} disabled={disabled} onchange={typeof onchange} -->
<div data-testid="rsvp-control"></div>
