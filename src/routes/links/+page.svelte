<script lang="ts">
	// #256 GREEN — Lingikogu (link collection) page surface. NEW page: uses the
	// EXTRACTED createRouteLoadMachine ($lib/loading/routeLoad — the machine
	// roster/library/profile share), not a hand-rolled in-file counter (see
	// page.links-collective-switch.spec.ts's structural pin).
	//
	// Contract (Gama's 2026-09-09 sign-off + 2026-09-10 forward-marker close on
	// #256; full pin set in page.links.spec.ts / page.links-wire.spec.ts /
	// page.links-collective-switch.spec.ts):
	//   - Members read the list in the STABLE order listLinks returns
	//     (display_order ascending, missing last — see linkData.ts). Every row
	//     is a REAL anchor: href verbatim, target=_blank, rel="noopener noreferrer".
	//   - Admins (adminStore 'admin' — editor-or-owner tier on the DATABASE
	//     entity, exactly the tier `link`'s creators rule names) can add, edit,
	//     reorder and remove. Members cannot: the controls are ABSENT from the
	//     DOM, not disabled (the codebase-wide idiom).
	//   - A link with no description renders NO description node at all.
	//   - Reorder = native move up / move down buttons per row (native controls
	//     only is standing law; no drag-drop); boundary controls are disabled.
	//   - Edit = whole-field in-situ (standing rule): the row's static view is
	//     replaced by its own input fields, never a separate modal.
	import { m } from '$lib/paraglide/messages.js';
	import { selectedCollectiveIdentityStore } from '$lib/collectives/store';
	import { adminStore } from '$lib/nav/adminStore';
	import { listLinks, type LinkRow } from '$lib/links/linkData';
	import { createLink, updateLink, reorderLinks, deleteLink } from '$lib/links/linkActions';
	import { createRouteLoadMachine, type RouteLoadStatus } from '$lib/loading/routeLoad';
	import SessionExpiredNotice from '$lib/components/auth/SessionExpiredNotice.svelte';

	const selected = $derived($selectedCollectiveIdentityStore);
	const admin = $derived($adminStore);

	let status = $state<RouteLoadStatus>('loading');
	let rows = $state<LinkRow[]>([]);

	// The cfg the page's writes fire against — set once loadForSelected has a
	// real token+db (mirrors roster's `currentCfg`: plain module-scope state,
	// not `$state`, since writes read it at tap time and it never itself needs
	// to drive a render).
	let currentCfg: { db: string; token: string } | null = null;

	// Add-form draft.
	let addName = $state('');
	let addUrl = $state('');
	let addDescription = $state('');

	// Whole-field in-situ edit — which row (by id) is open, and its draft.
	let editingId = $state<string | null>(null);
	let editName = $state('');
	let editUrl = $state('');
	let editDescription = $state('');

	function resetDrafts(): void {
		addName = '';
		addUrl = '';
		addDescription = '';
		editingId = null;
		editName = '';
		editUrl = '';
		editDescription = '';
	}

	// #256 pin 6 — the shared route-load machine owns the Status union, the
	// generation guard and the loadForSelected sequencing (reset →
	// no-collective → token check → 'loading' → this page's fetch body →
	// 4-branch error classification). `reset` drops any typed draft and any
	// open edit form — neither belongs to the collective being switched away
	// from (the #299 cross-collective-draft bug class).
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
		// Depend on `selected`; run the async load out-of-band so a rejection
		// can never escape as an unhandled rejection from the effect
		// (loadForSelected already fails loud into `status`).
		void selected;
		loadForSelected().catch((e) => {
			console.error('links: load failed', e);
			status = 'load-error';
		});
	});

	/** Re-read the list against `cfg`; drops the result if a collective switch
	 *  has moved `selected` on since the write that triggered this refresh. */
	async function refreshRows(cfg: { db: string; token: string }): Promise<void> {
		try {
			const list = await listLinks(cfg);
			if (selected?.db !== cfg.db) return;
			rows = list;
		} catch (e) {
			if (selected?.db !== cfg.db) return;
			console.error('links: refresh failed', e);
		}
	}

	async function submitAdd(): Promise<void> {
		if (!currentCfg) return;
		const cfg = currentCfg;
		const name = addName.trim();
		// Non-empty is the ONLY validation — nothing checks what a url looks
		// like (#256 ruling).
		if (!name || !/\S/.test(addUrl)) return;
		const description = addDescription.trim() ? addDescription : null;
		const maxOrder = rows.reduce((max, r) => Math.max(max, r.displayOrder ?? 0), 0);
		try {
			await createLink(cfg, { name, url: addUrl, description, displayOrder: maxOrder + 1 });
			addName = '';
			addUrl = '';
			addDescription = '';
			await refreshRows(cfg);
		} catch (e) {
			console.error('links: create failed', e);
		}
	}

	function startEdit(row: LinkRow): void {
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
		if (!currentCfg) return;
		const cfg = currentCfg;
		const name = editName.trim();
		if (!name || !/\S/.test(editUrl)) return;
		const description = editDescription.trim() ? editDescription : null;
		try {
			await updateLink(cfg, id, { name, url: editUrl, description });
			cancelEdit();
			await refreshRows(cfg);
		} catch (e) {
			console.error('links: update failed', e);
		}
	}

	async function handleRemove(id: string): Promise<void> {
		if (!currentCfg) return;
		const cfg = currentCfg;
		try {
			await deleteLink(cfg, id);
			await refreshRows(cfg);
		} catch (e) {
			console.error('links: remove failed', e);
		}
	}

	async function move(from: number, to: number): Promise<void> {
		if (!currentCfg) return;
		const cfg = currentCfg;
		const newOrder = rows.map((r) => r.id);
		const [movedId] = newOrder.splice(from, 1);
		newOrder.splice(to, 0, movedId);
		try {
			await reorderLinks(cfg, newOrder);
			await refreshRows(cfg);
		} catch (e) {
			console.error('links: reorder failed', e);
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

<div data-testid="links-page" class="flex flex-col gap-4">
	<h1 class="text-lg font-semibold">{m.links_title()}</h1>

	{#if admin === 'admin'}
		<form
			data-testid="links-add-form"
			class="flex flex-col gap-2"
			onsubmit={(e) => {
				e.preventDefault();
				void submitAdd();
			}}
		>
			<label class="flex flex-col gap-1 text-sm">
				{m.links_add_name_label()}
				<input data-testid="links-add-name" type="text" bind:value={addName} />
			</label>
			<label class="flex flex-col gap-1 text-sm">
				{m.links_add_url_label()}
				<input data-testid="links-add-url" type="text" bind:value={addUrl} />
			</label>
			<label class="flex flex-col gap-1 text-sm">
				{m.links_add_description_label()}
				<input data-testid="links-add-description" type="text" bind:value={addDescription} />
			</label>
			<button type="submit" data-testid="links-add-submit" class="self-start">
				{m.links_add_submit()}
			</button>
		</form>
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
			<button type="button" data-testid="links-retry-load" onclick={() => loadForSelected()}>
				{m.links_retry()}
			</button>
		</div>
	{:else if rows.length === 0}
		<div data-testid="links-empty" class="text-sm">{m.links_empty()}</div>
	{:else}
		<ul data-testid="links-list" class="flex flex-col gap-2">
			{#each rows as row, i (row.id)}
				<li data-testid="links-row" class="flex flex-col gap-1 border-b border-ink-5 py-2">
					{#if editingId === row.id}
						<label class="flex flex-col gap-1 text-sm">
							{m.links_add_name_label()}
							<input data-testid="links-edit-name" type="text" bind:value={editName} />
						</label>
						<label class="flex flex-col gap-1 text-sm">
							{m.links_add_url_label()}
							<input data-testid="links-edit-url" type="text" bind:value={editUrl} />
						</label>
						<label class="flex flex-col gap-1 text-sm">
							{m.links_add_description_label()}
							<input
								data-testid="links-edit-description"
								type="text"
								bind:value={editDescription}
							/>
						</label>
						<div class="flex gap-2">
							<button type="button" data-testid="links-edit-save" onclick={() => saveEdit(row.id)}>
								{m.links_save()}
							</button>
							<button type="button" data-testid="links-edit-cancel" onclick={cancelEdit}>
								{m.links_cancel()}
							</button>
						</div>
					{:else}
						<a
							data-testid="links-row-url"
							href={row.url}
							target="_blank"
							rel="noopener noreferrer"
						>
							<span data-testid="links-row-name">{row.name}</span>
						</a>
						{#if row.description}
							<p data-testid="links-row-description" class="text-sm text-ink-70">
								{row.description}
							</p>
						{/if}
						{#if admin === 'admin'}
							<div class="flex gap-2">
								<button
									type="button"
									data-testid="links-move-up"
									disabled={i === 0}
									aria-label={m.links_move_up()}
									onclick={() => moveUp(i)}
								>
									↑
								</button>
								<button
									type="button"
									data-testid="links-move-down"
									disabled={i === rows.length - 1}
									aria-label={m.links_move_down()}
									onclick={() => moveDown(i)}
								>
									↓
								</button>
								<button type="button" data-testid="links-edit" onclick={() => startEdit(row)}>
									{m.links_edit()}
								</button>
								<button
									type="button"
									data-testid="links-remove"
									onclick={() => handleRemove(row.id)}
								>
									{m.links_remove()}
								</button>
							</div>
						{/if}
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</div>

<!-- (*MVOX:Palestrina* — #256 GREEN) -->
