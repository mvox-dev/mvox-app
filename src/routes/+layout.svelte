<script lang="ts">
	import '../app.css';
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { hydrateAuth, authStore } from '$lib/auth/session';
	import { hydrateCollectives, urlCollectiveDbStore, COLLECTIVE_URL_PARAM } from '$lib/collectives/store';

	let { children } = $props();

	// Keep the URL-derived collective selection in sync with the address bar so a
	// deep link like `?collective=<db>` wins in the selection precedence.
	$effect(() => {
		urlCollectiveDbStore.set(page.url.searchParams.get(COLLECTIVE_URL_PARAM));
	});

	// Publish auth from the localStorage JWT on mount. Collective hydration is
	// driven reactively below (Fix B), not here — that covers both this initial
	// resolve AND any later client-side auth flip without a re-mount.
	onMount(() => {
		hydrateAuth();
	});

	// Fix B (#7 defense-in-depth): re-hydrate collectives reactively on the FIRST
	// auth resolution and on every later transition INTO 'authenticated' OR back
	// OUT to 'anonymous' — not just once at mount. Bug #7: discovery used to run
	// only in onMount, which does NOT re-run on a client-side `goto` after a
	// later auth flip (e.g. an OAuth sign-in), stranding collectiveState at
	// 'loading'. Fix A closes the OAuth-callback path directly (drives
	// hydrateCollectives() there before the redirect); this effect is the
	// architectural safety net so NO client-side auth flip — from that path or
	// any future one — can leave collectives stale, without requiring a full
	// page reload. The authenticated->anonymous edge (client-side sign-out) is
	// symmetric with the same class of bug: without it, collectiveState stays
	// stranded at a stale 'ready' after sign-out until a full reload.
	//
	// Guards against loops / duplicate fetches:
	// - `lastAuthStatus` is a plain (non-reactive) variable, not `$state` —
	//   reading/writing it inside the effect does not register a dependency, so
	//   it can't retrigger this same effect (the feedback-loop risk raised for
	//   $effect + store subscriptions).
	// - Edge-detection (`firstResolve` / `becameAuthenticated` / `becameAnonymous`)
	//   means the guard fires only on a genuine transition, not on every
	//   authStore emission — deliberately NOT gated on collectiveState already
	//   being resolved, since that would also suppress the real
	//   anonymous->authenticated case this fix exists for.
	// - `hydrating` skips overlapping calls if auth flips again before an
	//   in-flight discovery resolves.
	let lastAuthStatus: 'loading' | 'anonymous' | 'authenticated' | null = null;
	let hydrating = false;
	$effect(() => {
		const auth = $authStore;
		const prev = lastAuthStatus;
		lastAuthStatus = auth.status;

		if (auth.status === 'loading') return; // not yet resolved — nothing to react to

		const firstResolve = prev === null || prev === 'loading';
		const becameAuthenticated = auth.status === 'authenticated' && prev !== 'authenticated';
		const becameAnonymous = auth.status === 'anonymous' && prev === 'authenticated';
		if ((firstResolve || becameAuthenticated || becameAnonymous) && !hydrating) {
			hydrating = true;
			hydrateCollectives().finally(() => {
				hydrating = false;
			});
		}
	});
</script>

{@render children?.()}
