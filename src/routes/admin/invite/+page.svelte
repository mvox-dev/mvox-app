<script lang="ts">
	// T4.5 (#31) — the admin invite surface. #140/S3: the invite functionality
	// now lives INSIDE /admin (see src/routes/admin/+page.svelte's
	// "admin-invite-section"), sharing this exact same live component
	// (InviteSurface — state machine, data seams, testids all unchanged from
	// the original T4.5 page). This standalone route stays servicable so no
	// externally-held /admin/invite link dead-ends (#140 backward-compat
	// requirement) — see src/lib/components/admin/InviteSurface.svelte for the
	// full history/rationale.
	// Contract: src/routes/page.admin-invite.spec.ts,
	// src/routes/page.admin-invite-session-expired.spec.ts.
	import InviteSurface from '$lib/components/admin/InviteSurface.svelte';
</script>

<main class="min-h-screen bg-paper px-6 py-10 text-ink">
	<InviteSurface />
</main>

<!-- (*MVOX:Tallis* — #31/T4.5 RED route stub) -->
<!-- (*MVOX:Palestrina* — #140/S3 GREEN, delegated to InviteSurface -->
