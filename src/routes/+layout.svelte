<script module lang="ts">
	import { install401Recovery } from '$lib/auth/install-401-recovery';

	// #107 — register the browser-side 401 recovery (session teardown + sign-in
	// redirect) into the shared `entuFetch` seam. Module scope, not `onMount`:
	// this runs once when the root layout module is first evaluated, which is
	// before any page component can instantiate and issue an Entu read. Keeping
	// the effects OUT of $lib/entu/request is what lets the node migration
	// scripts keep importing that module (see install-401-recovery.ts).
	install401Recovery();
</script>

<script lang="ts">
	import '../app.css';
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { getToken } from '$lib/auth/storage';
	import { isProtectedPath } from '$lib/auth/guard';
	import { hydrateAuth, authStore } from '$lib/auth/session';
	import {
		hydrateCollectives,
		urlCollectiveDbStore,
		selectedCollectiveIdentityStore,
		pickerModeStore,
		COLLECTIVE_URL_PARAM
	} from '$lib/collectives/store';
	import { completionGateStore, resetGate, resolveGate } from '$lib/profile/completionGate';
	import NavShell from '$lib/components/nav/NavShell.svelte';
	import { NAV_ENTRIES } from '$lib/nav/entries';
	import { adminStore, resetAdmin, resolveAdmin } from '$lib/nav/adminStore';
	import { getLocale } from '$lib/paraglide/runtime.js';

	let { children } = $props();

	// ── #123/S4 review F1 — keep the DOCUMENT's declared language in step with the
	// locale Paraglide actually resolved. `src/app.html` ships a hardcoded
	// `<html lang="en">`, and this is a pure client-side SPA: no hooks, no
	// +layout.server, nothing else writes `documentElement.lang`. So a member who
	// picks Eesti (or whose browser reports et/lv/uk via the preferredLanguage
	// strategy) got a fully translated page that still ANNOUNCED itself as
	// English — screen readers apply English pronunciation to Estonian text and
	// browser translation/hyphenation heuristics get the wrong signal.
	//
	// One effect in the root layout covers every route. Locale switching goes
	// through a document reload (see LanguageSelector.svelte), so this runs once
	// per load, after the strategy chain has resolved, and always matches.
	$effect(() => {
		document.documentElement.lang = getLocale();
	});

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

	// ── T4.8/#28 — the mandatory-completion gate, enforced APP-WIDE in the one layout
	// so no member-display surface can open a hole. Two sibling effects:
	//
	// EFFECT A — populate `completionGateStore`. Keyed on auth + selected collective
	// IDENTITY ONLY (NOT pathname → no per-nav refetch; NOT the collective's display
	// LABEL → #165 review F1: `selectedCollectiveStore` re-emits a fresh object on
	// every `renameCollectiveInStore`, which through this effect would mean a
	// gate teardown + re-resolve on a name edit that changed nothing this effect
	// reads. `selectedCollectiveIdentityStore` emits only on a real db/person
	// change). `resetGate()` to 'loading' on every (re)selection (no-flash: only a
	// genuine read flips it). Generation-guarded so a stale collective's late
	// resolve can't clobber a newer one (mirrors the +page.svelte requestId /
	// profile generation discipline). FAIL-SAFE lives in resolveGate (a read throw
	// → 'loading', never a false 'incomplete').
	let gateGen = 0;
	$effect(() => {
		const auth = $authStore;
		const selected = $selectedCollectiveIdentityStore;
		const g = ++gateGen;
		if (auth.status !== 'authenticated' || !selected) {
			resetGate();
			return;
		}
		resetGate();
		const cfg = { db: selected.db, token: getToken() ?? '' };
		resolveGate(cfg, selected.personId).then((state) => {
			if (g === gateGen) completionGateStore.set(state);
		});
	});

	// EFFECT B — enforce (cheap, no fetch). Acts ONLY on a RESOLVED 'incomplete';
	// 'loading' never redirects (no flash). Exempts /profile itself (redirect loop)
	// and reuses guard.isProtectedPath so public/asset paths pass through. Unauth is
	// owned by +layout.ts (synchronous load guard) — this short-circuits unless
	// authenticated, so the two layers never collide.
	$effect(() => {
		const auth = $authStore;
		const selected = $selectedCollectiveIdentityStore;
		const gate = $completionGateStore;
		const path = page.url.pathname;
		if (auth.status !== 'authenticated' || !selected) return;
		// This effect runs ONLY for an authenticated member with a selected collective,
		// so `/` here is unambiguously the post-login app home (the agenda — the primary
		// member-display surface, RECON A S1), NOT the public landing page. The guard's
		// `isProtectedPath` puts `/` on the public allowlist (correct for the unauth
		// login guard), so we redirect from `/` explicitly IN ADDITION to any protected
		// path — otherwise an incomplete member would sit on the home agenda and never be
		// "directed to the profile page" (the #28 ruling). Exempt `/profile` (loop).
		if (gate === 'incomplete' && path !== '/profile' && (path === '/' || isProtectedPath(path))) {
			goto('/profile');
		}
	});

	// ── T5.2/#52 — admin determination for the nav shell Invite entry.
	// Same generation-guard discipline as the gate effect above, and keyed on the
	// same auth + collective IDENTITY (#165 review F1 — this one is the costly
	// side of that bug: on a label-only store change it would `resetAdmin()` the
	// store to 'loading', which unmounts the Admin nav entry the viewer is
	// standing on, then spend 2 Entu round-trips re-deciding what it already
	// knew).
	let adminGen = 0;
	$effect(() => {
		const auth = $authStore;
		const selected = $selectedCollectiveIdentityStore;
		const g = ++adminGen;
		if (auth.status !== 'authenticated' || !selected) {
			resetAdmin();
			return;
		}
		resetAdmin();
		const cfg = { db: selected.db, token: getToken() ?? '' };
		resolveAdmin(cfg, selected.personId).then((state) => {
			if (g === adminGen) adminStore.set(state);
		});
	});
</script>

<NavShell
	entries={NAV_ENTRIES}
	activeRoute={page.url.pathname}
	completionLocked={$completionGateStore === 'incomplete'}
	anonymous={$authStore.status !== 'authenticated'}
	isAdmin={$adminStore === 'admin'}
	hasMultipleCollectives={$pickerModeStore === 'picker'}
>
	{@render children?.()}
</NavShell>
