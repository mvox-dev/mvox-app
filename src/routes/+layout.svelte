<script module lang="ts">
	import { install401Recovery } from '$lib/auth/install-401-recovery';
	import { startUpdateForcing } from '$lib/sw/swUpdate';

	// #107 — register the browser-side 401 recovery (session teardown + sign-in
	// redirect) into the shared `entuFetch` seam. Module scope, not `onMount`:
	// this runs once when the root layout module is first evaluated, which is
	// before any page component can instantiate and issue an Entu read. Keeping
	// the effects OUT of $lib/entu/request is what lets the node migration
	// scripts keep importing that module (see install-401-recovery.ts).
	install401Recovery();

	// #368 — start the service worker update-forcing dance (interval +
	// visibility re-checks, guarded single reload on controllerchange). Module
	// scope for the same reason as install401Recovery above: runs exactly once,
	// as early as possible, regardless of which route the client boots into.
	startUpdateForcing();
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
		collectiveState,
		urlCollectiveDbStore,
		selectedCollectiveStore,
		selectedCollectiveIdentityStore,
		COLLECTIVE_URL_PARAM
	} from '$lib/collectives/store';
	// #410 — the session-scoped retention set behind the storage-pressure
	// sweep (see the effect below, and $lib/files/retention).
	import { ensureRetentionSweep } from '$lib/files/retention';
	import { completionGateStore, resetGate, resolveGate } from '$lib/profile/completionGate';
	import { membershipStore, resetMembership, resolveMembership } from '$lib/collective/membershipStore';
	import NavShell from '$lib/components/nav/NavShell.svelte';
	import { NAV_ENTRIES } from '$lib/nav/entries';
	import { adminStore, resetAdmin, resolveAdmin } from '$lib/nav/adminStore';
	import { getLocale } from '$lib/paraglide/runtime.js';
	// #408 review F1 — the `beforeinstallprompt` adapter. It lives HERE, not on
	// the profile page: Chromium fires that event once per page LOAD and never
	// re-fires it on a client-side navigation, and the root layout is the only
	// component that survives a route change. Started from the profile page's
	// own `onMount`, the listener did not exist yet in the ordinary flow (land
	// on `/` or return from the OAuth callback, then click Profile in the nav),
	// so the event was dropped and the button never rendered at all. The stash
	// and the store are module scope in installState.ts, so catching the event
	// app-wide is enough — the page stays a pure subscriber.
	import { startInstallAffordance } from '$lib/install/installState';
	import { m } from '$lib/paraglide/messages.js';

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
		// Returned teardown: the install listeners live exactly as long as the app
		// shell does (this layout never unmounts in the browser; under test it
		// does, and the listeners go with it).
		return startInstallAffordance();
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

	// ── #410 — the storage-pressure sweep's retention set, built ONCE PER
	// SESSION here rather than on the agenda page.
	//
	// review F1: the byte store is a module singleton and FOUR routes put bytes
	// through it (agenda, /event/<id>, /library, /downloads); every put fires
	// the after-every-put pressure sweep. While the build lived in
	// `+page.svelte`, a cold boot straight into any of the other three never
	// mounted that component, `setProtectedKeys` was never called, and the
	// store swept the whole session with the default-EMPTY protected set —
	// evicting the next event's parts, the exact thing #410 forbids. One effect
	// in the root layout covers every route (the same pattern as the
	// documentElement.lang effect above).
	//
	// review F2: the scope is the collectives she has JOINED — the hydrated,
	// marker-filtered `collectiveState` list, NOT `auth.personIdByDb` (every
	// Entu db in her token, her non-mvox apps included).
	//
	// `ensureRetentionSweep` is idempotent (run-once latch, same promise
	// returned) and never rejects, so this effect may re-run freely and can
	// neither hold up nor break the loads running beside it.
	$effect(() => {
		const auth = $authStore;
		const state = $collectiveState;
		if (auth.status !== 'authenticated' || state.status !== 'ready') return;
		const token = getToken();
		if (!token) return;
		void ensureRetentionSweep({ token, collectives: state.collectives });
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
		// member-display surface, RECON A S1), NOT the public landing page. `/` is
		// protected by guard.isProtectedPath (#221), so it's already covered by the
		// `isProtectedPath(path)` check below — an incomplete member sitting on the home
		// agenda still gets "directed to the profile page" (the #28 ruling). Exempt
		// `/profile` itself (redirect loop).
		if (gate === 'incomplete' && path !== '/profile' && isProtectedPath(path)) {
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

	// ── #255 done-when 6 — the app-level "not active" membership notice, on the
	// SAME completionGate precedent as the gate effect above: ONE app-wide
	// answer, resolved here and consumed once, so no surface can re-derive it
	// and open a hole. Keyed on auth + collective IDENTITY (same reasoning as
	// the gate/admin effects — a rename must not teardown+reflip this).
	// `resetMembership()` on every (re)selection is the no-flash discipline;
	// `resolveMembership` itself is the fail-safe (a read failure resolves
	// 'loading', never a false 'inactive' — see its own doc), so this effect
	// needs no separate try/catch.
	let membershipGen = 0;
	$effect(() => {
		const auth = $authStore;
		const selected = $selectedCollectiveIdentityStore;
		const g = ++membershipGen;
		if (auth.status !== 'authenticated' || !selected) {
			resetMembership();
			return;
		}
		resetMembership();
		const cfg = { db: selected.db, token: getToken() ?? '' };
		resolveMembership(cfg, selected.personId).then((state) => {
			if (g === membershipGen) membershipStore.set(state);
		});
	});
</script>

<NavShell
	entries={NAV_ENTRIES}
	activeRoute={page.url.pathname}
	completionLocked={$completionGateStore === 'incomplete'}
	anonymous={$authStore.status !== 'authenticated'}
	isAdmin={$adminStore === 'admin'}
>
	{#if $membershipStore === 'inactive' && $selectedCollectiveStore}
		<!-- #255 done-when 6 — the ONE app-level notice. NO redirect (nothing she
		     can do at any destination — a redirect is a dead end) and NO nav lock
		     (she keeps the domain-readable calendar and her own history) — both
		     refusals PO-accepted; this is presentation only, right where every
		     other route already renders underneath NavShell. -->
		<p
			data-testid="membership-inactive-notice"
			role="status"
			class="mx-auto w-full max-w-md px-6 pt-4 text-sm text-ink-2"
		>
			{m.membership_not_active_notice({ collective: $selectedCollectiveStore.name })}
		</p>
	{/if}
	{@render children?.()}
</NavShell>
