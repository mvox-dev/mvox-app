<!-- /links: the collective's link list; admins add, edit, reorder and remove links. -->
<script lang="ts">
	import { reportProblem } from '$lib/problems/reportProblem';
	import { page } from '$app/state';
	import { m } from '$lib/paraglide/messages.js';
	import { selectedCollectiveIdentityStore } from '$lib/collectives/store';
	import { adminStore } from '$lib/nav/adminStore';
	import { listLinks, type LinkRow } from '$lib/links/linkData';
	import { createLink, updateLink, reorderLinks, deleteLink } from '$lib/links/linkActions';
	import { normalizeUrl } from '$lib/links/normalizeUrl';
	import { cfgFor } from '$lib/entu/cfg';
	import { createRouteLoadMachine, type RouteLoadStatus } from '$lib/loading/routeLoad';
	import SessionExpiredNotice from '$lib/components/auth/SessionExpiredNotice.svelte';
	import LinksAddForm from '$lib/links/LinksAddForm.svelte';
	import LinksRow from '$lib/links/LinksRow.svelte';
	// Every write here is refused while there is no usable signal; nothing is queued.
	import { writesAvailable } from '$lib/net/online';

	const selected = $derived($selectedCollectiveIdentityStore);
	const admin = $derived($adminStore);
	const isOffline = $derived(!$writesAvailable);

	let status = $state<RouteLoadStatus>('loading');
	let rows = $state<LinkRow[]>([]);

	// Plain, not $state: writes read it at tap time and it never drives a render.
	let currentCfg: { db: string; token: string } | null = null;

	let addName = $state('');
	let addUrl = $state('');
	let addDescription = $state('');

	let editingId = $state<string | null>(null);
	let editName = $state('');
	let editUrl = $state('');
	let editDescription = $state('');

	// A write guard: while true it disables both arrows of every row, and move() re-checks it,
	// so a dispatched click during flight is a no-op, not only visually blocked.
	let reorderPending = $state(false);
	let reorderStatus = $state('');
	// 'confirmed': the post-failure re-read landed; 'stale': it failed too, so the screen
	// still shows the pre-write order and must not claim to be the server's.
	let reorderError = $state<'confirmed' | 'stale' | null>(null);
	// One slot is enough: the three forms never write concurrently on this page.
	let writeError = $state<'create' | 'update' | 'remove' | null>(null);

	function resetDrafts(): void {
		addName = '';
		addUrl = '';
		addDescription = '';
		editingId = null;
		editName = '';
		editUrl = '';
		editDescription = '';
		reorderStatus = '';
		reorderError = null;
		writeError = null;
	}

	// `reset` drops any typed draft and open edit form: neither belongs to the next collective.
	const routeLoad = createRouteLoadMachine({
		name: 'links',
		selected: () => selected,
		setStatus: (s) => {
			status = s;
		},
		reset: () => {
			resetDrafts();
		},
		onNoCollective: () => {
			currentCfg = null;
		},
		onNoToken: () => {
			currentCfg = null;
		},
		async load({ cfg, isCurrent }) {
			currentCfg = cfg;
			const list = await listLinks(cfg);
			if (!isCurrent()) return; // superseded by a newer collective selection
			rows = list;
			status = 'ready';
		}
	});

	function loadForSelected(): Promise<void> {
		return routeLoad.loadForSelected();
	}

	$effect(() => {
		void selected;
		void loadForSelected();
	});

	/** Re-reads the list; true only when `rows` now holds a fresh server read, which is what
	 *  lets the reorder alert claim to show the order the server holds. */
	async function refreshRows(cfg: { db: string; token: string }, g: number): Promise<boolean> {
		try {
			const list = await listLinks(cfg);
			if (selected?.db !== cfg.db || g !== routeLoad.generation) return false;
			rows = list;
			return true;
		} catch (e) {
			if (selected?.db !== cfg.db || g !== routeLoad.generation) return false;
			reportProblem({ area: 'links', action: 'loading the links', error: e });
			return false;
		}
	}

	// Every write captures `routeLoad.generation` before it fires and returns early on both
	// settle paths once it has moved, before any state write: a write started in one collective
	// must not paint its outcome onto the next. move()'s `finally` stays unguarded.
	async function submitAdd(): Promise<void> {
		// Before the attempt-start clear, so a refused submit keeps the last real failure.
		if (isOffline) return;
		if (!currentCfg) return;
		const cfg = cfgFor(currentCfg.db);
		const name = addName.trim();
		// Non-empty is the only validation (#256 ruling).
		if (!name || !/\S/.test(addUrl)) return;
		const description = addDescription.trim() ? addDescription : null;
		const maxOrder = rows.reduce((max, r) => Math.max(max, r.displayOrder ?? 0), 0);
		const g = routeLoad.generation;
		writeError = null;
		try {
			await createLink(cfg, {
				name,
				url: normalizeUrl(addUrl, page.url.host),
				description,
				displayOrder: maxOrder + 1
			});
			if (g !== routeLoad.generation) return;
			addName = '';
			addUrl = '';
			addDescription = '';
			await refreshRows(cfg, g);
		} catch (e) {
			if (g !== routeLoad.generation) return;
			console.error('links: create failed', e);
			// The draft is left as typed so the retry has something to resubmit.
			writeError = 'create';
		}
	}

	function startEdit(row: LinkRow): void {
		// Backstop for a tap that beat the offline re-render.
		if (isOffline) return;
		editingId = row.id;
		editName = row.name;
		editUrl = row.url;
		editDescription = row.description ?? '';
	}

	function cancelEdit(): void {
		editingId = null;
		editName = '';
		editUrl = '';
		editDescription = '';
	}

	async function saveEdit(id: string): Promise<void> {
		// Offline: refuse before the `writeError` clear, and keep the form open on its draft.
		if (isOffline) return;
		if (!currentCfg) return;
		const cfg = cfgFor(currentCfg.db);
		const name = editName.trim();
		if (!name || !/\S/.test(editUrl)) return;
		const description = editDescription.trim() ? editDescription : null;
		const g = routeLoad.generation;
		writeError = null;
		try {
			await updateLink(cfg, id, { name, url: normalizeUrl(editUrl, page.url.host), description });
			if (g !== routeLoad.generation) return;
			cancelEdit();
			await refreshRows(cfg, g);
		} catch (e) {
			if (g !== routeLoad.generation) return;
			console.error('links: update failed', e);
			writeError = 'update';
		}
	}

	async function handleRemove(id: string): Promise<void> {
		if (isOffline) return;
		if (!currentCfg) return;
		const cfg = cfgFor(currentCfg.db);
		const g = routeLoad.generation;
		writeError = null;
		try {
			await deleteLink(cfg, id);
			if (g !== routeLoad.generation) return;
			await refreshRows(cfg, g);
		} catch (e) {
			if (g !== routeLoad.generation) return;
			console.error('links: remove failed', e);
			writeError = 'remove';
		}
	}

	async function move(from: number, to: number): Promise<void> {
		// Checked here too: a dispatched click bypasses `disabled`.
		if (reorderPending) return;
		// Before the attempt-start clears, so a refused move leaves the arrows as they were.
		if (isOffline) return;
		if (!currentCfg) return;
		const cfg = cfgFor(currentCfg.db);
		const g = routeLoad.generation;
		const newOrder = rows.map((r) => r.id);
		const [movedId] = newOrder.splice(from, 1);
		newOrder.splice(to, 0, movedId);
		reorderPending = true;
		reorderError = null;
		reorderStatus = '';
		try {
			await reorderLinks(cfg, newOrder);
			if (g !== routeLoad.generation) return;
			await refreshRows(cfg, g);
			if (g !== routeLoad.generation) return;
			reorderStatus = m.links_reorder_saved();
		} catch (e) {
			if (g !== routeLoad.generation) return;
			console.error('links: reorder failed', e);
			// The renumber is sequential and can fail half-applied, so only a re-read can say what
			// landed; awaited before the alert, so the alert and the re-enabled arrows land together.
			const reread = await refreshRows(cfg, g);
			if (g !== routeLoad.generation) return;
			reorderError = reread ? 'confirmed' : 'stale';
		} finally {
			reorderPending = false;
		}
	}

	function moveUp(index: number): void {
		if (index <= 0) return;
		void move(index, index - 1);
	}

	function moveDown(index: number): void {
		if (index >= rows.length - 1) return;
		void move(index, index + 1);
	}
</script>

<main class="min-h-screen bg-paper px-6 py-10 text-ink">
	<div data-testid="links-page" class="mx-auto flex w-full max-w-md flex-col gap-4">
	<h1 class="font-display text-2xl">{m.links_title()}</h1>

	{#if admin === 'admin'}
		<!-- Visible, not sr-only, by choice: a saved move otherwise looks identical to one that
		     failed to persist. Present from first render, so its text change fires aria-live. -->
		<div
			data-testid="links-reorder-status"
			role="status"
			aria-live="polite"
			class="min-h-[1.25rem] text-sm text-ink-70"
		>
			{reorderStatus}
		</div>
	{/if}

	{#if reorderError}
		<p data-testid="links-reorder-error" role="alert" class="text-sm text-red-700">
			{reorderError === 'stale' ? m.links_reorder_failed_stale() : m.links_reorder_failed()}
		</p>
	{/if}

	{#if writeError}
		<!-- Failure only: for explicit-submit forms success is self-evident. -->
		<p data-testid="links-write-error" role="alert" class="text-sm text-red-700">
			{writeError === 'create'
				? m.links_create_failed()
				: writeError === 'update'
					? m.links_update_failed()
					: m.links_remove_failed()}
		</p>
	{/if}

	<!-- One reason for every disabled write control; admin-gated, as only admins see them. -->
	{#if admin === 'admin' && isOffline}
		<p data-testid="links-write-unavailable" class="text-sm text-ink-2">
			{m.write_unavailable_no_signal()}
		</p>
	{/if}

	{#if admin === 'admin'}
		<LinksAddForm
			bind:addName
			bind:addUrl
			bind:addDescription
			{isOffline}
			onsubmit={() => void submitAdd()}
		/>
	{/if}

	{#if status === 'no-collective'}
		<p data-testid="links-no-collective" class="text-sm">{m.links_no_collective()}</p>
	{:else if status === 'loading'}
		<div data-testid="links-skeleton" aria-hidden="true" aria-busy="true"></div>
	{:else if status === 'session-expired'}
		<SessionExpiredNotice />
	{:else if status === 'load-error'}
		<div data-testid="links-load-error" role="alert" class="flex flex-col gap-2">
			<p class="text-sm text-red-700">{m.links_load_error()}</p>
			<button
				type="button"
				data-testid="links-retry-load"
				onclick={() => loadForSelected()}
				class="self-start rounded-md border border-ink-4 px-2 py-1 text-xs text-ink-2 hover:text-ink disabled:opacity-50"
			>
				{m.links_retry()}
			</button>
		</div>
	{:else if rows.length === 0}
		<div data-testid="links-empty" class="text-sm">{m.links_empty()}</div>
	{:else}
		<ul data-testid="links-list" class="flex flex-col gap-2">
			{#each rows as row, i (row.id)}
				<LinksRow
					{row}
					index={i}
					rowCount={rows.length}
					isAdmin={admin === 'admin'}
					{isOffline}
					{reorderPending}
					editing={editingId === row.id}
					bind:editName
					bind:editUrl
					bind:editDescription
					onsave={(id) => void saveEdit(id)}
					oncancel={cancelEdit}
					onmoveup={moveUp}
					onmovedown={moveDown}
					onedit={startEdit}
					onremove={(id) => void handleRemove(id)}
				/>
			{/each}
		</ul>
	{/if}
	</div>
</main>

<!-- (*MVOX:Palestrina* — #256 GREEN) -->
