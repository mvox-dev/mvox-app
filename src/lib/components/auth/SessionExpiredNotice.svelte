<script lang="ts">
	// #107 — the session-expired notice, ONE component instead of six copies.
	//
	// A 401 is a different failure class from "couldn't load": the entuFetch layer
	// has already ended the session and fired the sign-in redirect, so this frame
	// only has to say why — and a generic Retry against a deleted token could never
	// succeed. The block was copy-pasted verbatim across the agenda, library,
	// profile and roster during the first pass; extracting it here is what keeps
	// the six surfaces (those four plus event detail and admin invite) from
	// drifting in copy, testids or link params (#107 review F2/F3).
	//
	// The sign-in href carries `error=session_expired` + `redirect=<here>` — see
	// $lib/auth/session-expired for why both matter.
	import { m } from '$lib/paraglide/messages.js';
	import { currentSessionExpiredSignInHref } from '$lib/auth/session-expired';

	// `centered` matches the agenda's full-width empty-state framing; the default
	// left-aligned form matches the library/profile/roster/event/invite blocks.
	let { centered = false }: { centered?: boolean } = $props();
</script>

<div
	data-testid="session-expired"
	role="alert"
	class={centered
		? 'flex flex-col items-center gap-3 py-10 text-center'
		: 'flex flex-col gap-2'}
>
	<p class="text-sm text-ink-2">{m.session_expired_message()}</p>
	<a
		href={currentSessionExpiredSignInHref()}
		data-testid="session-expired-signin"
		class="{centered
			? ''
			: 'self-start '}rounded-md border border-ink px-4 py-2 text-sm text-ink hover:bg-ink hover:text-paper"
	>
		{m.session_expired_signin()}
	</a>
</div>

<!-- (*MVOX:Josquin*) -->
