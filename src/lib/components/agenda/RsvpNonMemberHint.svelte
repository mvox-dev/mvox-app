<!-- src/lib/components/agenda/RsvpNonMemberHint.svelte -->
<!--
	The "Only members can RSVP" hint, standing IN PLACE OF an RsvpControl.

	#372 review F3 — this used to be a `nonMember` prop on RsvpControl (a
	disabled control plus a hint). Since #372 a confirmed non-member gets NO
	control at all, so the hint outlived its host and was hand-copied onto both
	surfaces (agenda rows + the event page) byte-identically. One component now
	owns it, so the two copies cannot drift.

	Markup is the pre-#372 `rsvp-msg-line` shape verbatim: the same reserved
	`min-h-[16px] leading-[16px]` text-xs box the control's own message line
	uses, so a row swapping between hint and control shifts nothing.
-->
<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
</script>

<p data-testid="rsvp-msg-line" class="min-h-[16px] text-xs leading-[16px] italic text-ink-2">
	<span data-testid="rsvp-non-member-hint">{m.rsvp_non_member_hint()}</span>
</p>
