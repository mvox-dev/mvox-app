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

	// #323 — reorder save-state (the arrows write immediately, so this IS
	// auto-save; reference pattern #267, docs/qa/autosave-field-inventory.md).
	// `reorderPending` is a WRITE guard, distinct from the boundary
	// `disabled={i===0}` checks: while true it disables BOTH arrows of EVERY
	// row (not just the row being moved), and `move()` re-checks it itself
	// (not just the DOM `disabled` attribute) so a dispatched click during
	// flight is a genuine no-op, not just visually blocked.
	let reorderPending = $state(false);
	// Persistent role="status" node, present from first render, same node
	// every announcement (#267 shape) — cleared at the START of every attempt
	// so a stale "saved" never overlaps a new write, and left EMPTY on
	// failure (the alert carries that state instead).
	let reorderStatus = $state('');
	// Non-null only while the alert is showing; cleared at attempt start so a
	// retry doesn't sit under a stale banner. Two failure shapes, because the
	// message differs (#323 review F2): 'confirmed' — the post-failure re-read
	// landed, so the screen really does show what the server holds;
	// 'stale' — the re-read ALSO failed, so the screen is the pre-write order
	// and nothing may claim it is authoritative.
	let reorderError = $state<'confirmed' | 'stale' | null>(null);
	// #323 adjacent (Gama's ruling) — createLink/updateLink/deleteLink
	// failures surface as role="alert" too, FAILURE ONLY: explicit-submit
	// forms get no saved cue (success is self-evident — the draft clears /
	// the form closes / the row goes). One slot is enough: the three forms
	// never write concurrently on this page.
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
	 *  has moved `selected` (or the route-load generation `g` the calling write
	 *  was started under) on since the write that triggered this refresh.
	 *
	 *  Returns TRUE only when `rows` now holds a fresh server read. Callers use
	 *  that to decide what they are allowed to claim on screen: the reorder
	 *  failure alert says "showing the order the server holds", and that is a
	 *  lie unless this returned true (#323 review F2 — listLinks can reject on
	 *  its own, and the reorder that just failed may have left the server
	 *  half-renumbered, so the untouched `rows` are NOT the server's order). */
	async function refreshRows(cfg: { db: string; token: string }, g: number): Promise<boolean> {
		try {
			const list = await listLinks(cfg);
			if (selected?.db !== cfg.db || g !== routeLoad.generation) return false;
			rows = list;
			return true;
		} catch (e) {
			if (selected?.db !== cfg.db || g !== routeLoad.generation) return false;
			console.error('links: refresh failed', e);
			return false;
		}
	}

	// #323 review F1 — EVERY write on this page captures `routeLoad.generation`
	// before it fires and re-checks it after each await, returning early on BOTH
	// settle paths when it has moved. `routeLoad.generation` bumps once per
	// loadForSelected, i.e. once per genuine collective switch (the identity
	// store de-dupes equal identities), so the check fires only when the user
	// really has moved on. Without it a write started in collective A settles
	// after the switch to B and paints A's outcome — "Link order saved.", a
	// failure alert, a cleared draft, a closed edit form — onto B's page, the
	// #299 cross-collective-draft class the routeLoad `reset` exists to kill.
	// The check goes BEFORE any state write, including the draft/form clears:
	// by then B's own draft may already be typed. `reorderPending = false` in
	// move()'s `finally` stays UNGUARDED so the guard can never wedge the
	// arrows. Reference: #267, src/routes/profile/+page.svelte (rosterStatus).

	async function submitAdd(): Promise<void> {
		if (!currentCfg) return;
		const cfg = currentCfg;
		const name = addName.trim();
		// Non-empty is the ONLY validation — nothing checks what a url looks
		// like (#256 ruling).
		if (!name || !/\S/.test(addUrl)) return;
		const description = addDescription.trim() ? addDescription : null;
		const maxOrder = rows.reduce((max, r) => Math.max(max, r.displayOrder ?? 0), 0);
		const g = routeLoad.generation;
		// Attempt-start clear (#267 shape): a fresh submit owns the alert slot —
		// a previous failure must not outlive the retry that fixed it.
		writeError = null;
		try {
			await createLink(cfg, { name, url: addUrl, description, displayOrder: maxOrder + 1 });
			if (g !== routeLoad.generation) return;
			addName = '';
			addUrl = '';
			addDescription = '';
			await refreshRows(cfg, g);
		} catch (e) {
			if (g !== routeLoad.generation) return;
			console.error('links: create failed', e);
			// Failure surfacing only (Gama's ruling) — the draft is left exactly
			// as typed so the retry has something to resubmit.
			writeError = 'create';
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
		const g = routeLoad.generation;
		writeError = null;
		try {
			await updateLink(cfg, id, { name, url: editUrl, description });
			if (g !== routeLoad.generation) return;
			cancelEdit();
			await refreshRows(cfg, g);
		} catch (e) {
			if (g !== routeLoad.generation) return;
			console.error('links: update failed', e);
			// The in-situ form stays open with its draft — cancelEdit() above
			// only runs on the success path.
			writeError = 'update';
		}
	}

	async function handleRemove(id: string): Promise<void> {
		if (!currentCfg) return;
		const cfg = currentCfg;
		const g = routeLoad.generation;
		writeError = null;
		try {
			await deleteLink(cfg, id);
			if (g !== routeLoad.generation) return;
			await refreshRows(cfg, g);
		} catch (e) {
			if (g !== routeLoad.generation) return;
			console.error('links: remove failed', e);
			// The row stays for retry — no optimistic removal happened above.
			writeError = 'remove';
		}
	}

	async function move(from: number, to: number): Promise<void> {
		// #323 write guard — one outstanding reorder write at a time. Checked
		// here (not just via the `disabled` attribute at the render site)
		// because `fireEvent`/a stray dispatched click bypasses `disabled`; the
		// handler itself has to refuse the second tap.
		if (reorderPending) return;
		if (!currentCfg) return;
		const cfg = currentCfg;
		const g = routeLoad.generation;
		const newOrder = rows.map((r) => r.id);
		const [movedId] = newOrder.splice(from, 1);
		newOrder.splice(to, 0, movedId);
		reorderPending = true;
		// Attempt-start clear: a stale "saved" or a stale alert must not sit
		// through a new write.
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
			// reorderLinks (linkActions.ts) renumbers per-id SEQUENTIALLY and can
			// throw mid-loop, leaving the server half-applied — a partial success
			// distinct from both the pre-write order and the user's intent. Only
			// a genuine re-read can say what actually landed, so the restore here
			// is refreshRows, never a revert to a locally-held order: reverting
			// would show something the server never confirmed, and #267's
			// "restore to the pre-write capture" reference doesn't apply to a
			// write whose failure mode is a partial server mutation rather than
			// an atomic all-or-nothing one. Awaited BEFORE the alert flips on:
			// the alert and the re-enabled controls land in the DOM together, one
			// state transition, not a window where the alert is visible but a
			// retry tap still gets swallowed by the pending guard.
			//
			// refreshRows REPORTS whether it actually re-read (#323 review F2):
			// its own listLinks call can reject too — a dropped network fails
			// both the renumber and the re-read — and then `rows` still holds the
			// PRE-WRITE order while the server sits half-renumbered. Claiming
			// "showing the order the server holds" there is false, so the alert
			// switches to the _stale wording, which only tells the user to
			// reload.
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

<div data-testid="links-page" class="flex flex-col gap-4">
	<h1 class="text-lg font-semibold">{m.links_title()}</h1>

	{#if admin === 'admin'}
		<!-- #323 — reorder save-state, reference pattern #267
		     (docs/qa/autosave-field-inventory.md). #267's own node is sr-only;
		     this one is DELIBERATELY also visible (stated choice, not the
		     reference default): the row jump on a successful move is the only
		     on-screen feedback otherwise, and it looks identical to a move that
		     silently failed to persist before this fix — a sighted user needs
		     the same confirmation the aria-live announcement gives a screen
		     reader. Present from first render (persistent node, #267 shape) so
		     the SAME node's text-change is what fires aria-live, not a
		     freshly-mounted one; cleared at attempt start; admin-gated (only
		     admins can ever trigger a reorder). -->
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
		<!-- #323 — truthful failure: the mid-loop-throw shape means the server
		     can be half-renumbered, so `move()`'s catch has already re-read the
		     list by the time this renders; the arrows are re-enabled for retry
		     (reorderPending is already false in `finally`). The wording follows
		     what the re-read actually achieved (review F2): 'confirmed' — the
		     list was re-read, the screen IS the server's order; 'stale' — the
		     re-read failed too, so the message claims nothing about the screen
		     and asks for a reload instead. -->
		<p data-testid="links-reorder-error" role="alert" class="text-sm text-red-700">
			{reorderError === 'stale' ? m.links_reorder_failed_stale() : m.links_reorder_failed()}
		</p>
	{/if}

	{#if writeError}
		<!-- #323 adjacent (Gama's 2026-09-11 ruling) — createLink/updateLink/
		     deleteLink failures surface here too, FAILURE ONLY: no saved cue for
		     these explicit-submit forms, success is self-evident (draft clears /
		     form closes / row disappears). One slot for all three — they never
		     write concurrently on this page. -->
		<p data-testid="links-write-error" role="alert" class="text-sm text-red-700">
			{writeError === 'create'
				? m.links_create_failed()
				: writeError === 'update'
					? m.links_update_failed()
					: m.links_remove_failed()}
		</p>
	{/if}

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
				<input
					data-testid="links-add-name"
					type="text"
					bind:value={addName}
					class="rounded-md border border-ink px-2 py-1 text-base disabled:opacity-50"
				/>
			</label>
			<label class="flex flex-col gap-1 text-sm">
				{m.links_add_url_label()}
				<input
					data-testid="links-add-url"
					type="text"
					bind:value={addUrl}
					class="rounded-md border border-ink px-2 py-1 text-base disabled:opacity-50"
				/>
			</label>
			<label class="flex flex-col gap-1 text-sm">
				{m.links_add_description_label()}
				<input
					data-testid="links-add-description"
					type="text"
					bind:value={addDescription}
					class="rounded-md border border-ink px-2 py-1 text-base disabled:opacity-50"
				/>
			</label>
			<button
				type="submit"
				data-testid="links-add-submit"
				class="self-start rounded-md border border-ink px-2 py-1 text-xs disabled:opacity-50"
			>
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
				<li data-testid="links-row" class="flex flex-col gap-1 border-b border-ink-5 py-2">
					{#if editingId === row.id}
						<label class="flex flex-col gap-1 text-sm">
							{m.links_add_name_label()}
							<input
								data-testid="links-edit-name"
								type="text"
								bind:value={editName}
								class="rounded-md border border-ink px-2 py-1 text-base disabled:opacity-50"
							/>
						</label>
						<label class="flex flex-col gap-1 text-sm">
							{m.links_add_url_label()}
							<input
								data-testid="links-edit-url"
								type="text"
								bind:value={editUrl}
								class="rounded-md border border-ink px-2 py-1 text-base disabled:opacity-50"
							/>
						</label>
						<label class="flex flex-col gap-1 text-sm">
							{m.links_add_description_label()}
							<input
								data-testid="links-edit-description"
								type="text"
								bind:value={editDescription}
								class="rounded-md border border-ink px-2 py-1 text-base disabled:opacity-50"
							/>
						</label>
						<div class="flex gap-2">
							<button
								type="button"
								data-testid="links-edit-save"
								onclick={() => saveEdit(row.id)}
								class="rounded-md border border-ink px-2 py-1 text-xs disabled:opacity-50"
							>
								{m.links_save()}
							</button>
							<button
								type="button"
								data-testid="links-edit-cancel"
								onclick={cancelEdit}
								class="rounded-md border border-ink-4 px-2 py-1 text-xs text-ink-2 hover:text-ink disabled:opacity-50"
							>
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
									disabled={i === 0 || reorderPending}
									aria-label={m.links_move_up()}
									onclick={() => moveUp(i)}
									class="rounded-md border border-ink-4 px-2 py-1 text-xs text-ink-2 hover:text-ink disabled:opacity-50"
								>
									↑
								</button>
								<button
									type="button"
									data-testid="links-move-down"
									disabled={i === rows.length - 1 || reorderPending}
									aria-label={m.links_move_down()}
									onclick={() => moveDown(i)}
									class="rounded-md border border-ink-4 px-2 py-1 text-xs text-ink-2 hover:text-ink disabled:opacity-50"
								>
									↓
								</button>
								<button
									type="button"
									data-testid="links-edit"
									onclick={() => startEdit(row)}
									class="rounded-md border border-ink-4 px-2 py-1 text-xs text-ink-2 hover:text-ink disabled:opacity-50"
								>
									{m.links_edit()}
								</button>
								<button
									type="button"
									data-testid="links-remove"
									onclick={() => handleRemove(row.id)}
									class="rounded-md border border-ink-4 px-2 py-1 text-xs text-ink-2 hover:text-ink disabled:opacity-50"
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
