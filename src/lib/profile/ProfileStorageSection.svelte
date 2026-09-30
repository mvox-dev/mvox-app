<!-- #352 — "Remove downloaded parts from this device", scoped to the signed-in (db,
	personId). The page calls load() and reset() through bind:this. -->
<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import { getAppByteStore } from '$lib/files/appByteStore';
	import { formatFileSize } from '$lib/files/fileSize';
	import type * as LibraryData from '$lib/library/libraryData';
	import { focusTestIdAfterRender } from '$lib/a11y/focusable';
	import type { EntuCfg } from '$lib/seasons/entuSeasons';

	interface Props {
		ready: boolean;
		generation: () => number;
		activeContext: () => { cfg: EntuCfg; personId: string } | null;
		listAllEditions: typeof LibraryData.listAllEditions;
	}

	let { ready, generation, activeContext, listAllEditions }: Props = $props();

	// null = not answered yet, so no section renders; never a made-up {count: 0, size: 0}.
	let storageMine = $state<{ count: number; size: number } | null>(null);
	let storageOthers = $state<{ count: number; size: number } | null>(null);
	let storageHeldFileIds = $state<string[]>([]);
	let storagePartNames = $state<Record<string, string>>({});
	let storageArmedMine = $state(false);
	let storageArmedAll = $state(false);
	let storageRemoveMinePending = $state(false);
	let storageRemoveAllPending = $state(false);
	let storageError = $state<string | null>(null);
	// The name join reads a capped list: past the cap, an unnamed part is an unanswered lookup.
	let storageNamesTruncated = $state(false);
	const storageNamesPartial = $derived(
		storageNamesTruncated && storageHeldFileIds.some((fileId) => !storagePartNames[fileId])
	);

	export function reset(): void {
		storageMine = null;
		storageOthers = null;
		storageHeldFileIds = [];
		storagePartNames = {};
		storageArmedMine = false;
		storageArmedAll = false;
		storageRemoveMinePending = false;
		storageRemoveAllPending = false;
		storageError = null;
		storageNamesTruncated = false;
	}

	// Presence-only reads, never store.get(): a profile visit must not stamp opens and
	// reorder LRU eviction. All three read metadata only, so running them together is safe.
	export async function load(
		cfg: EntuCfg,
		identity: { db: string; personId: string },
		g: number,
		opts: { joinNames?: boolean } = {}
	): Promise<void> {
		try {
			// Inside the try: getAppByteStore() can throw synchronously (no IndexedDB).
			const store = getAppByteStore();
			const [mine, others, heldIds] = await Promise.all([
				store.usageForPartition(identity.db, identity.personId),
				store.usageForOthers(identity.db, identity.personId),
				store.heldFileIds(identity.db, identity.personId)
			]);
			if (g !== generation()) return;
			storageMine = mine;
			storageOthers = others;
			storageHeldFileIds = heldIds;
		} catch (err) {
			if (g !== generation()) return;
			// console.warn, not .error: the section just stays absent.
			console.warn('profile: storage usage read failed', err);
			return;
		}

		// Naming is the online path only: listAllEditions is a network read, and offline
		// naming is #353's. Skipped when the caller holds the map or nothing is held.
		if (opts.joinNames === false) return;
		if (storageHeldFileIds.length === 0) {
			storagePartNames = {};
			storageNamesTruncated = false;
			return;
		}
		try {
			const editions = await listAllEditions(cfg);
			if (g !== generation()) return;
			const names: Record<string, string> = {};
			for (const edition of editions.items) {
				for (const file of edition.files) {
					names[file.id] = file.filename;
				}
			}
			storagePartNames = names;
			storageNamesTruncated = editions.truncated;
		} catch (err) {
			if (g !== generation()) return;
			console.warn('profile: storage part-name metadata read failed', err);
			storagePartNames = {};
			// A read that never landed is a failure, not a truncation.
			storageNamesTruncated = false;
		}
	}

	// Two-step confirm; focus moves to the button that replaces the trigger (WCAG 2.4.3).
	async function armStorageRemoveMine(): Promise<void> {
		storageArmedMine = true;
		await focusTestIdAfterRender('profile-storage-remove-mine-confirm');
	}

	async function disarmStorageRemoveMine(): Promise<void> {
		storageArmedMine = false;
		await focusTestIdAfterRender('profile-storage-remove-mine');
	}

	async function armStorageRemoveAll(): Promise<void> {
		storageArmedAll = true;
		await focusTestIdAfterRender('profile-storage-remove-all-confirm');
	}

	async function disarmStorageRemoveAll(): Promise<void> {
		storageArmedAll = false;
		await focusTestIdAfterRender('profile-storage-remove-all');
	}

	// Clears exactly the signed-in partition. A failed removal is shown, since nothing
	// was deleted; joinNames: false because a removal only shrinks the held-id set.
	async function confirmStorageRemoveMine(): Promise<void> {
		const ctx = activeContext();
		if (!ctx) return;
		storageError = null;
		storageRemoveMinePending = true;
		try {
			await getAppByteStore().clearPartition(ctx.cfg.db, ctx.personId);
			await load(ctx.cfg, { db: ctx.cfg.db, personId: ctx.personId }, generation(), {
				joinNames: false
			});
		} catch (err) {
			console.error('profile: remove-downloaded-parts (this account) failed', err);
			storageError = m.profile_storage_remove_error();
		} finally {
			storageRemoveMinePending = false;
		}
		await disarmStorageRemoveMine();
	}

	// The device-wide wipe, never a sweep of the partitions this page knows about.
	async function confirmStorageRemoveAll(): Promise<void> {
		const ctx = activeContext();
		if (!ctx) return;
		storageError = null;
		storageRemoveAllPending = true;
		try {
			await getAppByteStore().clearAllPartitions();
			await load(ctx.cfg, { db: ctx.cfg.db, personId: ctx.personId }, generation(), {
				joinNames: false
			});
		} catch (err) {
			console.error('profile: remove-everything-downloaded failed', err);
			storageError = m.profile_storage_remove_error();
		} finally {
			storageRemoveAllPending = false;
		}
		await disarmStorageRemoveAll();
	}
</script>

<!-- #343: logout does not clear the byte store; this is the control for a shared device. -->
{#if ready && storageMine !== null && storageOthers !== null}
	<section data-testid="profile-storage" class="flex flex-col gap-4 border-t border-ink/10 pt-4">
		<h2 class="text-sm font-semibold">{m.profile_storage_title()}</h2>

		{#if storageError}
			<p data-testid="profile-storage-error" role="alert" class="text-xs text-red-700">
				{storageError}
			</p>
		{/if}

		<div data-testid="profile-storage-mine" class="flex flex-col gap-2">
			<p class="text-sm text-ink-2">
				{m.profile_storage_mine_summary({
					count: storageMine.count,
					size: formatFileSize(storageMine.size)
				})}
			</p>
			{#if storageHeldFileIds.some((fileId) => storagePartNames[fileId])}
				<ul class="flex flex-col gap-1">
					{#each storageHeldFileIds as fileId (fileId)}
						{#if storagePartNames[fileId]}
							<li data-testid={`profile-storage-part-${fileId}`} class="text-sm text-ink-2">
								{storagePartNames[fileId]}
							</li>
						{/if}
					{/each}
				</ul>
			{/if}
			{#if storageNamesPartial}
				<p data-testid="profile-storage-names-partial" role="status" class="text-xs text-ink-3">
					{m.profile_storage_names_partial()}
				</p>
			{/if}

			{#if !storageArmedMine}
				<button
					type="button"
					data-testid="profile-storage-remove-mine"
					class="self-start rounded-md border border-ink px-4 py-2 text-sm hover:bg-ink hover:text-paper"
					onclick={armStorageRemoveMine}
				>
					{m.profile_storage_remove_mine()}
				</button>
			{:else}
				<p data-testid="profile-storage-remove-mine-note" class="text-xs text-ink-3">
					{m.profile_storage_remove_mine_note()}
				</p>
				<div class="flex gap-2">
					<button
						type="button"
						data-testid="profile-storage-remove-mine-confirm"
						disabled={storageRemoveMinePending}
						aria-busy={storageRemoveMinePending}
						class="rounded-md border border-red-700 px-4 py-2 text-sm text-red-700 hover:bg-red-700 hover:text-paper disabled:cursor-not-allowed disabled:opacity-50"
						onclick={confirmStorageRemoveMine}
					>
						{m.profile_storage_remove_mine_confirm()}
					</button>
					<button
						type="button"
						data-testid="profile-storage-remove-mine-cancel"
						disabled={storageRemoveMinePending}
						class="rounded-md border border-ink/40 px-4 py-2 text-sm hover:bg-ink hover:text-paper disabled:cursor-not-allowed disabled:opacity-50"
						onclick={disarmStorageRemoveMine}
					>
						{m.profile_storage_cancel()}
					</button>
				</div>
			{/if}
		</div>

		<!-- PO ruling (#352): count and size only, never titled. -->
		<div data-testid="profile-storage-others" class="flex flex-col gap-2">
			<p class="text-sm text-ink-2">
				{m.profile_storage_others_summary({
					count: storageOthers.count,
					size: formatFileSize(storageOthers.size)
				})}
			</p>

			{#if !storageArmedAll}
				<button
					type="button"
					data-testid="profile-storage-remove-all"
					class="self-start rounded-md border border-ink px-4 py-2 text-sm hover:bg-ink hover:text-paper"
					onclick={armStorageRemoveAll}
				>
					{m.profile_storage_remove_all()}
				</button>
			{:else}
				<p data-testid="profile-storage-remove-all-note" class="text-xs text-ink-3">
					{m.profile_storage_remove_all_note()}
				</p>
				<div class="flex gap-2">
					<button
						type="button"
						data-testid="profile-storage-remove-all-confirm"
						disabled={storageRemoveAllPending}
						aria-busy={storageRemoveAllPending}
						class="rounded-md border border-red-700 px-4 py-2 text-sm text-red-700 hover:bg-red-700 hover:text-paper disabled:cursor-not-allowed disabled:opacity-50"
						onclick={confirmStorageRemoveAll}
					>
						{m.profile_storage_remove_all_confirm()}
					</button>
					<button
						type="button"
						data-testid="profile-storage-remove-all-cancel"
						disabled={storageRemoveAllPending}
						class="rounded-md border border-ink/40 px-4 py-2 text-sm hover:bg-ink hover:text-paper disabled:cursor-not-allowed disabled:opacity-50"
						onclick={disarmStorageRemoveAll}
					>
						{m.profile_storage_cancel()}
					</button>
				</div>
			{/if}
		</div>
	</section>
{/if}
