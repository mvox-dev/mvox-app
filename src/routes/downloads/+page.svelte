<script lang="ts">
	import ListOfStuff from '$lib/components/ListOfStuff.svelte';
	import { reportProblem } from '$lib/problems/reportProblem';
	import FormError from '$lib/components/FormError.svelte';
	// Lists downloaded parts by label and opens them in the viewer, with no network.
	// heldFileIds is the source of truth for what is held; labelsFor only names held ids,
	// so an unlabelled held part still shows and an orphan label never does.
	import { goto } from '$app/navigation';
	import { m } from '$lib/paraglide/messages.js';
	import { authStore } from '$lib/auth/session';
	import { getAppByteStore } from '$lib/files/appByteStore';
	import { getAppLabelStore } from '$lib/files/appLabelStore';
	import { deriveOfflineIdentities, type OfflineIdentity } from '$lib/collectives/offlineIdentity';
	import type { PartLabel } from '$lib/files/labelStore';

	// Mirrors collectives/store.ts's `SELECTED_KEY`, read directly: that module's stores
	// are empty with no network, since collective discovery is a network call.
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

	// On a cold load this mounts before hydrateAuth resolves: wait out 'loading' and
	// reload on every later resolution. loadGen drops a stale resolve.
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
			.catch((e) => {
				// An IDB read error shows as a failure, never as an endless "Loading…".
				if (g !== loadGen) return;
				reportProblem({ area: 'downloads', action: 'loading the downloaded parts', error: e });
				loaded = true;
				loadError = true;
			});
	});

	// The viewer owns the byte read and its failure notices. `?db=` names the partition
	// the row was listed under, since this page holds several identities at once.
	function handleOpen(identity: OfflineIdentity, fileId: string): void {
		void goto(`/part/${fileId}?db=${identity.db}`);
	}
</script>

<main class="min-h-screen bg-paper px-6 py-10 text-ink">
	<ListOfStuff title={m.downloads_title()}>
		{#if !loaded}
			<p data-testid="downloads-loading" class="mt-4 text-sm text-ink-2">{m.downloads_loading()}</p>
		{:else if loadError}
			<FormError data-testid="downloads-load-error" class="mt-4">
				{m.downloads_load_error()}
			</FormError>
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
	</ListOfStuff>
</main>

<!-- (*MVOX:Josquin* — #353 GREEN; review-fix round *MVOX:Byrd*) -->
