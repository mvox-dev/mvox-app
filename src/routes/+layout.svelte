<!-- Root layout: the app-wide effects (auth, collectives, gates, retention) around every route. -->
<script module lang="ts">
	import { install401Recovery } from '$lib/auth/install-401-recovery';
	import { startUpdateForcing } from '$lib/sw/swUpdate';

	// Module scope: runs once, before any page can issue an Entu read.
	install401Recovery();

	startUpdateForcing();
</script>

<script lang="ts">
	import '../app.css';
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { afterNavigate, goto } from '$app/navigation';
	import { clearReadFellBackToCache } from '$lib/net/cacheFallback';
	import { getToken } from '$lib/auth/storage';
	import { cfgFor } from '$lib/entu/cfg';
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
	import { ensureRetentionSweep } from '$lib/files/retention';
	import { completionGateStore, resetGate, resolveGate } from '$lib/profile/completionGate';
	import { membershipStore, resetMembership, resolveMembership } from '$lib/collective/membershipStore';
	import NavShell from '$lib/components/nav/NavShell.svelte';
	import { NAV_ENTRIES } from '$lib/nav/entries';
	import { adminStore, resetAdmin, resolveAdmin } from '$lib/nav/adminStore';
	import { getLocale } from '$lib/paraglide/runtime.js';
	// Here, not on the profile page: Chromium fires beforeinstallprompt once per load.
	import { startInstallAffordance } from '$lib/install/installState';
	import { m } from '$lib/paraglide/messages.js';

	let { children } = $props();

	// app.html hardcodes lang="en"; this keeps it in step with the resolved locale.
	$effect(() => {
		document.documentElement.lang = getLocale();
	});

	// Every navigation is a load boundary for the cache-fallback half of the write gate.
	afterNavigate(() => {
		clearReadFellBackToCache();
	});

	$effect(() => {
		urlCollectiveDbStore.set(page.url.searchParams.get(COLLECTIVE_URL_PARAM));
	});

	onMount(() => {
		hydrateAuth();
		return startInstallAffordance();
	});

	// Re-hydrate collectives on the first auth resolve and on every flip in or out, so a
	// client-side sign-in or sign-out never strands them. lastAuthStatus is a plain let.
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

	// Built once per session here: four routes put bytes through the store, and a cold boot
	// into any of them must not sweep with an empty protected set.
	$effect(() => {
		const auth = $authStore;
		const state = $collectiveState;
		if (auth.status !== 'authenticated' || state.status !== 'ready') return;
		const token = getToken();
		if (!token) return;
		void ensureRetentionSweep({ token, collectives: state.collectives });
	});

	// Completion gate, app-wide. Keyed on collective identity, not its label, so a rename
	// does not reset the gate; generation-guarded against a stale collective.
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
		const cfg = cfgFor(selected.db);
		resolveGate(cfg, selected.personId).then((state) => {
			if (g === gateGen) completionGateStore.set(state);
		});
	});

	// Enforce: redirect only on a resolved 'incomplete', never from /profile itself.
	$effect(() => {
		const auth = $authStore;
		const selected = $selectedCollectiveIdentityStore;
		const gate = $completionGateStore;
		const path = page.url.pathname;
		if (auth.status !== 'authenticated' || !selected) return;
		if (gate === 'incomplete' && path !== '/profile' && isProtectedPath(path)) {
			goto('/profile');
		}
	});

	// Admin state for the nav, keyed on identity like the gate: a rename must not reset it.
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
		const cfg = cfgFor(selected.db);
		resolveAdmin(cfg, selected.personId).then((state) => {
			if (g === adminGen) adminStore.set(state);
		});
	});

	// The app-wide "not active" notice, resolved once here and keyed on identity.
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
		const cfg = cfgFor(selected.db);
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
		<!-- Presentation only: no redirect and no nav lock (PO-accepted). -->
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
