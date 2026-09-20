<script lang="ts">
	// #353 — the one view that works with no network: lists downloaded parts
	// BY LABEL and opens them from the store. See workRows.ts/#353 for why the
	// label exists at all, and offlineIdentity.ts for why this page derives
	// its own identities rather than reading the collective-picker's identity
	// store (spike 3: that store is NULL on every page with no network —
	// collective discovery is a network call).
	//
	// SCOPE: opening a part offline, not making every view work offline
	// (issue #353's own fence). Rosters, admin, invites and the rest may fail
	// with no network — routeLoad.ts's `load-error` state is how they do that
	// legibly, not this page's problem.
	//
	// OPEN (#427 review round 3, finding 5): a row is an in-app NAVIGATION to
	// the fullscreen viewer, /part/[fileId]?db=. This page is the only
	// surface that lists parts with no network, so it is the only offline
	// DOOR to the viewer — the library and event entry points both need an
	// Entu read to render their lists at all. The byte read the viewer
	// performs is the same openFileBytes read-through this page used to run
	// itself, so a store hit still touches no network; what is gone is the
	// blank-tab dance and raw bytes in a foreign tab.
	//
	// DATA: `heldFileIds` (byte store) is the source of truth for WHAT is
	// held; `labelsFor` (label store) only NAMES held ids. A held id with no
	// label still renders — hiding a file the view cannot name is worse than
	// showing it unnamed — and a label whose byte row is gone (an orphan)
	// never produces a row.
	import { goto } from '$app/navigation';
	import { m } from '$lib/paraglide/messages.js';
	import { authStore } from '$lib/auth/session';
	import { getAppByteStore } from '$lib/files/appByteStore';
	import { getAppLabelStore } from '$lib/files/appLabelStore';
	import { deriveOfflineIdentities, type OfflineIdentity } from '$lib/collectives/offlineIdentity';
	import type { PartLabel } from '$lib/files/labelStore';

	// Mirrors collectives/store.ts's own `SELECTED_KEY` — read directly here,
	// never through that module's stores, which this page must not touch (see
	// the module doc above).
	const SELECTED_COLLECTIVE_KEY = 'mvox.selected_collective';

	interface Row {
		identity: OfflineIdentity;
		fileId: string;
		label: PartLabel | null;
	}

	let rows = $state<Row[]>([]);
	let loaded = $state(false);
	let loadError = $state(false);

	async function loadRows(auth: { personIdByDb: Record<string, string> }): Promise<Row[]> {
		const persisted =
			typeof localStorage !== 'undefined' ? localStorage.getItem(SELECTED_COLLECTIVE_KEY) : null;
		const identities = deriveOfflineIdentities(auth.personIdByDb, persisted);
		const byteStore = getAppByteStore();
		const labelStore = getAppLabelStore();

		const out: Row[] = [];
		for (const identity of identities) {
			const [heldIds, labels] = await Promise.all([
				byteStore.heldFileIds(identity.db, identity.personId),
				labelStore.labelsFor(identity.db, identity.personId)
			]);
			for (const fileId of heldIds) {
				out.push({ identity, fileId, label: labels.get(fileId) ?? null });
			}
		}
		return out;
	}

	// #353 fix round — cold-start auth race: on a cold full-document load of
	// /downloads this component mounts BEFORE +layout.svelte's onMount
	// hydrateAuth resolves, so $authStore's real first value is 'loading'. The
	// old `void load()` read $authStore synchronously once and took the
	// !== 'authenticated' branch permanently — a device holding parts got a
	// downloads-empty page that never recovers, since nothing re-ran it. This
	// effect instead waits out 'loading' (loaded stays false, no claim
	// rendered) and (re)loads on every later resolution — mirrors
	// +layout.svelte's gate/admin/membership effects. `loadGen` guards a
	// stale resolve from clobbering a newer one if auth flips again before an
	// in-flight read settles.
	let loadGen = 0;
	$effect(() => {
		const auth = $authStore;
		if (auth.status === 'loading') return;
		const g = ++loadGen;
		if (auth.status !== 'authenticated') {
			rows = [];
			loaded = true;
			loadError = false;
			return;
		}
		loaded = false;
		loadError = false;
		loadRows(auth)
			.then((out) => {
				if (g !== loadGen) return;
				rows = out;
				loaded = true;
			})
			.catch(() => {
				// #353 review round, finding 2 — heldFileIds/labelsFor reject on an
				// IDB error (idbAdapter.ts). An unguarded rejection here left
				// `loaded` false forever: exactly on this degraded-conditions
				// surface, that reads as an infinite "Loading…", never as a
				// failure. Surface it instead — hiding a read failure is worse
				// than naming it (same reasoning as the module doc's unnamed-part
				// stance above).
				if (g !== loadGen) return;
				loaded = true;
				loadError = true;
			});
	});

	/** #427 review round 3, finding 5 — the row opens the part IN the app.
	 *  The viewer owns the byte read, the page turns and every failure notice
	 *  that read can produce (it distinguishes "not on this device" from "a
	 *  server refused", which this page never could), so nothing is left here
	 *  but the navigation. `?db=` names the partition the row was listed
	 *  under — this page holds several identities at once. */
	function handleOpen(identity: OfflineIdentity, fileId: string): void {
		void goto(`/part/${fileId}?db=${identity.db}`);
	}
</script>

<main class="min-h-screen bg-paper px-6 py-10 text-ink">
	<h1 class="text-lg font-semibold">{m.downloads_title()}</h1>
	{#if !loaded}
		<p data-testid="downloads-loading" class="mt-4 text-sm text-ink-2">{m.downloads_loading()}</p>
	{:else if loadError}
		<p data-testid="downloads-load-error" class="mt-4 text-xs text-red-700" role="alert">
			{m.downloads_load_error()}
		</p>
	{:else if rows.length === 0}
		<p data-testid="downloads-empty" class="mt-4 text-sm text-ink-2">{m.downloads_empty()}</p>
	{:else}
		<ul class="mt-4 flex flex-col gap-3">
			{#each rows as row (row.identity.db + ':' + row.identity.personId + ':' + row.fileId)}
				<li
					data-testid="downloads-part-{row.fileId}"
					class="flex items-center justify-between gap-3 text-sm"
				>
					<span>
						{#if row.label}
							{row.label.work} — {row.label.composer} — {row.label.filename}
						{:else}
							{m.downloads_unnamed_part()}
						{/if}
					</span>
					<button
						type="button"
						data-testid="downloads-open-{row.fileId}"
						class="shrink-0 text-xs underline"
						onclick={() => handleOpen(row.identity, row.fileId)}
					>
						{m.downloads_open()}
					</button>
				</li>
			{/each}
		</ul>
	{/if}
</main>

<!-- (*MVOX:Josquin* — #353 GREEN; review-fix round *MVOX:Byrd*) -->
