<script lang="ts">
	// T3.3/#19 — the collective roster: active members' shared name+email subset.
	// TS.1/#95 — rewritten from a flat list into a SECTION-GROUPED collapsible
	// layout (default) with a column-header toggle to a flat alphabetical view.
	// Protected automatically (not on guard.ts's allowlist, `isProtectedPath('/roster')`
	// is true by default). No `completionGate` import here — the CURRENT-user
	// application of #28 is the layout's redirect; the OTHER-members application (a
	// nameless member never appearing as a row) lives entirely in `rosterData.ts`'s
	// `toRosterRow` — this component only renders whatever `loadRoster` returns.
	import { m } from '$lib/paraglide/messages.js';
	import { getToken } from '$lib/auth/storage';
	import { selectedCollectiveStore } from '$lib/collectives/store';
	import { loadRoster, type RosterRow } from '$lib/roster/rosterData';
	import { listSections, groupBySection, type SectionNode, type SectionGroup } from '$lib/sections/sectionData';
	import { assignMemberSection, unassignMemberSection } from '$lib/sections/sectionActions';
	import { isSectionMembershipMissing } from '$lib/sections/sectionErrors';
	import SectionPicker from '$lib/sections/SectionPicker.svelte';
	import { adminStore } from '$lib/nav/adminStore';
	import type { EntuCfg } from '$lib/seasons/entuSeasons';

	const selected = $derived($selectedCollectiveStore);
	const admin = $derived($adminStore);

	type Status = 'loading' | 'no-collective' | 'load-error' | 'ready';

	// Non-reactive generation guard — mirrors profile/+page.svelte's `let generation`
	// exactly (never $state, so bumping it doesn't retrigger the load effect). Guards
	// against a stale (superseded) load resolving after a collective switch.
	let generation = 0;
	let status = $state<Status>('loading');
	let rows = $state<RosterRow[]>([]);
	let sections = $state<SectionNode[]>([]);
	// F3 code-review fix: the two loads are DECOUPLED (Promise.allSettled, not
	// Promise.all) — a section-tree failure must not black out a roster the app
	// could otherwise show. `sectionsError` is set when ONLY the section load
	// failed (rows loaded fine); the page then renders the flat list plus a
	// visible banner — still loud (console.error + banner), never silent.
	let sectionsError = $state(false);

	// TS.1/#95 — grouped ↔ flat toggle, default grouped. groupBySection is the
	// GENUINE data-layer function (sectionData.ts) — the page never re-derives
	// grouping/counts ad hoc. Declared here (not near its other UI derivations
	// below) because F3's section-load failure path forces it to 'flat'.
	let view = $state<'grouped' | 'flat'>('grouped');

	// TS.2/#96 — the cfg the picker's writes fire against. Set once loadForSelected
	// has a real token+db (mirrors `generation`: plain module-scope state, not
	// `$state` — writes read it at tap time, it never needs to drive a render).
	let currentCfg: EntuCfg | null = null;

	async function loadForSelected(): Promise<void> {
		const current = selected;
		const g = ++generation;
		if (!current) {
			status = 'no-collective';
			rows = [];
			sections = [];
			sectionsError = false;
			currentCfg = null;
			return;
		}
		const token = getToken();
		if (!token) {
			// Inconsistency on a protected route — fail loud as a load error, never a
			// silent empty list. F3 code-review fix: drop `currentCfg` too — a write
			// cfg must never outlive the load state that produced it (otherwise a
			// stale token from a previous collective could still back picker writes
			// on an errored page).
			console.error('roster: no auth token in storage on a protected route');
			currentCfg = null;
			status = 'load-error';
			return;
		}
		status = 'loading';
		const cfg = { db: current.db, token };
		currentCfg = cfg;
		const [rowResult, sectionResult] = await Promise.allSettled([loadRoster(cfg), listSections(cfg)]);
		if (g !== generation) return; // superseded by a newer collective selection

		if (rowResult.status === 'rejected') {
			// The roster itself couldn't be read — nothing presentable regardless of
			// how the section load went. Full loud error, matching pre-F3 behavior.
			console.error('roster: load failed', rowResult.reason);
			status = 'load-error';
			return;
		}
		rows = rowResult.value;

		if (sectionResult.status === 'rejected') {
			console.error('roster: section tree load failed', sectionResult.reason);
			sections = [];
			sectionsError = true;
			// Grouping is meaningless without a tree — fall back to the flat view so
			// the toggle button's label stays truthful about what's on screen.
			view = 'flat';
		} else {
			sections = sectionResult.value;
			sectionsError = false;
		}
		status = 'ready';
	}

	$effect(() => {
		// Depend on `selected`; run the async load out-of-band so a rejection can never
		// escape as an unhandled rejection from the effect (loadForSelected already
		// fails loud into `status`, but its synchronous prologue must not throw here).
		void selected;
		loadForSelected().catch((e) => {
			console.error('roster: load failed', e);
			status = 'load-error';
		});
	});

	const groups = $derived(groupBySection(rows, sections));
	const groupById = $derived.by(() => {
		const map = new Map<string, SectionGroup>();
		for (const g of groups) if (g.sectionId !== null) map.set(g.sectionId, g);
		return map;
	});
	const unassignedGroup = $derived(groups.find((g) => g.sectionId === null) ?? null);

	// Section name lookup (id → name), for the flat view's secondary text — walks
	// the SAME tree `groupBySection` is joining against.
	const sectionNameById = $derived.by(() => {
		const map = new Map<string, string>();
		function walk(nodes: SectionNode[]): void {
			for (const n of nodes) {
				map.set(n.id, n.name);
				walk(n.children);
			}
		}
		walk(sections);
		return map;
	});

	const flatRows = $derived([...rows].sort((a, b) => a.name.localeCompare(b.name)));

	// Collapse state — an OPT-OUT set (every section starts expanded; collapsing
	// adds its id). Same `new Set(...)` copy-then-reassign pattern as the library
	// browse tree (library/+page.svelte's expandedWorks/expandedEditions).
	let collapsedIds = $state<Set<string>>(new Set());
	function toggleSection(id: string): void {
		const next = new Set(collapsedIds);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		collapsedIds = next;
	}

	// TS.2/#96 — section-picker wiring. Per-tap immediate write + optimistic-and-
	// reconcile: `rows` (already `$state`) is patched IMMEDIATELY on tap, which
	// alone moves the row (`groups`/`groupById` are `$derived` off `rows`) — no
	// separate optimistic-state map needed. On write failure the patch is
	// reverted to the PRE-tap value and the failure logged; on success it simply
	// stays (no roster refetch — `loadRoster` runs once, at load).
	function currentSectionIds(memberId: string): string[] {
		return rows.find((r) => r.memberId === memberId)?.sectionIds ?? [];
	}

	function patchMemberSectionIds(memberId: string, sectionIds: string[]): void {
		rows = rows.map((r) => (r.memberId === memberId ? { ...r, sectionIds } : r));
	}

	// F1 code-review fix: a revert must UNDO EXACTLY THE ONE MEMBERSHIP its own
	// call owned, computed against the row as it is NOW — never restore a
	// whole-array pre-tap snapshot. Two bugs the snapshot restore had:
	//   - partial failure: "(Unassigned)" on a two-section member where one DELETE
	//     succeeds and the other 403s restored BOTH sections, permanently diverging
	//     from the server (the page never refetches by design);
	//   - concurrent taps on one member: a later tap's already-persisted change was
	//     silently discarded when an earlier tap's write failed and overwrote the
	//     row with its own stale snapshot.
	// `addBack`/`dropBack` therefore read the LIVE row and touch one id only.
	function addBack(memberId: string, sectionIds: string[]): void {
		const live = currentSectionIds(memberId);
		const restored = [...live];
		for (const id of sectionIds) if (!restored.includes(id)) restored.push(id);
		patchMemberSectionIds(memberId, restored);
	}

	function dropBack(memberId: string, sectionId: string): void {
		patchMemberSectionIds(
			memberId,
			currentSectionIds(memberId).filter((id) => id !== sectionId)
		);
	}

	async function handlePick(memberId: string, sectionId: string | null): Promise<void> {
		const cfg = currentCfg;
		if (!cfg) {
			// F3 code-review fix: a tap that writes nothing and says nothing is exactly
			// the silent degradation the project's fail-loudly rule targets.
			console.error('roster: section pick with no cfg', memberId, sectionId);
			return;
		}
		const before = currentSectionIds(memberId);

		if (sectionId === null) {
			// "(Unassigned)" — clear ALL current section parents, one unassign call
			// per currently-assigned section. allSettled, not all: each call has its
			// own fate, and only the ones that REJECTED come back onto the row.
			if (before.length === 0) return;
			patchMemberSectionIds(memberId, []);
			const results = await Promise.allSettled(
				before.map((id) => unassignMemberSection(cfg, memberId, id))
			);
			const failed: string[] = [];
			results.forEach((result, i) => {
				if (result.status === 'rejected') {
					console.error('roster: clearing section assignment failed', before[i], result.reason);
					// F1(b) code-review fix: "the membership was already gone server-side"
					// is NOT a failed write — the server already holds what the optimistic
					// removal shows. Re-adding it would be the divergence, and permanent
					// (this page never refetches). Log it, keep the removal, revert only
					// genuine write failures.
					if (!isSectionMembershipMissing(result.reason)) failed.push(before[i]);
				}
			});
			if (failed.length > 0) addBack(memberId, failed);
			return;
		}

		// Toggle: already assigned → unassign; not assigned → assign. Assigning
		// never replaces — a member can hold several sections at once.
		const isCurrent = before.includes(sectionId);
		const after = isCurrent ? before.filter((id) => id !== sectionId) : [...before, sectionId];
		patchMemberSectionIds(memberId, after);
		try {
			if (isCurrent) {
				await unassignMemberSection(cfg, memberId, sectionId);
			} else {
				await assignMemberSection(cfg, memberId, sectionId);
			}
		} catch (e) {
			console.error('roster: section assignment change failed', e);
			// F1(b) code-review fix: an unassign that failed BECAUSE the membership
			// was already absent server-side means UI and server now agree — keep the
			// optimistic removal (logged just above for visibility). Only real write
			// failures (network, 4xx/5xx) get undone.
			if (isSectionMembershipMissing(e)) return;
			// Undo just this call's one membership, against the live row.
			if (isCurrent) addBack(memberId, [sectionId]);
			else dropBack(memberId, sectionId);
		}
	}
</script>

{#snippet memberRow(row: RosterRow, showSection: boolean)}
	{@const rowSectionNames = (row.sectionIds ?? [])
		.map((id) => sectionNameById.get(id))
		.filter((name): name is string => Boolean(name))}
	<li
		data-testid="roster-row-{row.memberId}"
		class="flex flex-col gap-0.5 border-b border-dashed border-ink-5 py-2 last:border-b-0"
	>
		<span data-testid="roster-row-name" class="text-sm text-ink">{row.name}</span>
		{#if row.email}
			<span data-testid="roster-row-email" class="text-xs text-ink-2">{row.email}</span>
		{/if}
		{#if showSection && rowSectionNames.length > 0}
			<span data-testid="roster-row-section" class="text-xs text-ink-2">{rowSectionNames.join(', ')}</span>
		{/if}
		{#if admin === 'admin' && !sectionsError}
			<!-- F2 code-review fix: no section tree → nothing meaningful to pick. The
			     picker's option list would hold only "(Unassigned)" (its sole reachable
			     action being the destructive clear-all) and its trigger label — built
			     from names the empty tree can't resolve — would collapse to a
			     zero-width unlabeled button. The section-load-error banner above
			     already explains the absence; hide the write control rather than
			     offer one whose options are known-incomplete. -->
			<SectionPicker
				memberId={row.memberId}
				{sections}
				selectedIds={row.sectionIds ?? []}
				onpick={(sectionId) => handlePick(row.memberId, sectionId)}
			/>
		{/if}
	</li>
{/snippet}

{#snippet sectionGroup(node: SectionNode)}
	{@const group = groupById.get(node.id)}
	{@const isExpanded = !collapsedIds.has(node.id)}
	<!--
		F2 code-review fix: a child's <section> is rendered NESTED inside its
		parent's (below, `{#each node.children as child}{@render sectionGroup(child)}{/each}`
		lives INSIDE this same <section>) — so each level's own margin-left ALREADY
		stacks on top of every ancestor's. `node.depth * 1rem` therefore compounded
		quadratically (a depth-2 node got 1+2=3rem of visual indent, not 2rem). A
		CONSTANT 1rem on every non-root node gives each level exactly 1rem of
		indent relative to its immediate parent — nesting itself does the rest.
	-->
	<section
		data-testid="section-group-{node.id}"
		data-depth={node.depth}
		class="flex flex-col"
		style="margin-left: {node.depth === 0 ? 0 : 1}rem"
	>
		<button
			type="button"
			data-testid="section-toggle-{node.id}"
			aria-expanded={isExpanded}
			class="flex items-center gap-2 py-1.5 text-left"
			onclick={() => toggleSection(node.id)}
		>
			<span aria-hidden="true" class="text-ink-2">{isExpanded ? '▾' : '▸'}</span>
			<span data-testid="section-header-{node.id}" class="text-sm font-medium text-ink">
				{node.name} ({group?.memberCount ?? 0})
			</span>
		</button>
		{#if isExpanded}
			<ul class="flex flex-col pl-5">
				{#each group?.members ?? [] as row (row.memberId)}
					{@render memberRow(row, false)}
				{/each}
			</ul>
			{#each node.children as child (child.id)}
				{@render sectionGroup(child)}
			{/each}
		{/if}
	</section>
{/snippet}

<main class="min-h-screen bg-paper px-6 py-10 text-ink">
	<div class="mx-auto flex w-full max-w-md flex-col gap-4">
		<h1 class="font-display text-2xl">{m.roster_title()}</h1>

		{#if status === 'no-collective'}
			<p data-testid="roster-no-collective" class="text-sm">{m.roster_no_collective()}</p>
		{:else if status === 'loading'}
			<div
				data-testid="roster-skeleton"
				class="flex flex-col gap-3"
				aria-hidden="true"
				aria-busy="true"
			>
				{#each [0, 1, 2] as row (row)}
					<div data-testid="roster-skeleton-row" class="flex animate-pulse flex-col gap-1.5 py-2">
						<div class="h-3 w-1/2 rounded bg-ink-5"></div>
						<div class="h-2.5 w-1/3 rounded bg-ink-5"></div>
					</div>
				{/each}
			</div>
		{:else if status === 'load-error'}
			<div data-testid="roster-load-error" class="flex flex-col gap-2" role="alert">
				<p class="text-sm text-red-700">{m.roster_load_error()}</p>
				<button
					type="button"
					data-testid="roster-retry-load"
					class="self-start rounded-md border border-ink px-4 py-2 text-sm hover:bg-ink hover:text-paper"
					onclick={() => loadForSelected()}
				>
					{m.roster_retry()}
				</button>
			</div>
		{:else if rows.length === 0 && sections.length === 0}
			<!-- F4 code-review fix: gated on BOTH rows and sections being empty — when
			     sections exist but no member has loaded into them yet, the section
			     structure itself (with (0) counts) is real information and must
			     render, not be suppressed behind a "nothing here" placeholder. -->
			<div data-testid="roster-empty" class="flex min-h-[30vh] items-center justify-center">
				<p class="font-display text-xl text-ink-2">{m.roster_empty()}</p>
			</div>
		{:else}
			{#if sectionsError}
				<!-- F3 code-review fix: the section-tree load failed but the roster
				     itself loaded fine — render loudly (banner + the already-logged
				     console.error above), not silently, and fall back to the flat
				     list since there's no tree left to group by. -->
				<div data-testid="roster-sections-load-error" class="flex flex-col gap-1" role="alert">
					<p class="text-sm text-red-700">{m.roster_sections_load_error()}</p>
				</div>
			{/if}
			<div class="flex items-center justify-between border-b border-ink-5 pb-1.5">
				<span class="text-xs tracking-wide text-ink-2 uppercase">{m.roster_column_name()}</span>
				{#if !sectionsError}
					<!-- F3: no grouped view is on offer without a section tree, so the
					     toggle that would switch INTO it is hidden, not just disabled. -->
					<button
						type="button"
						data-testid="roster-sort-toggle"
						aria-pressed={view === 'flat'}
						class="text-xs tracking-wide text-ink-2 uppercase underline hover:text-ink"
						onclick={() => (view = view === 'grouped' ? 'flat' : 'grouped')}
					>
						{view === 'grouped' ? m.roster_sort_alphabetical() : m.roster_sort_grouped()}
					</button>
				{/if}
			</div>

			{#if view === 'grouped' && !sectionsError}
				<div data-testid="roster-groups" class="flex flex-col">
					{#each sections as node (node.id)}
						{@render sectionGroup(node)}
					{/each}
					{#if unassignedGroup}
						{@const isExpanded = !collapsedIds.has('unassigned')}
						<section data-testid="section-group-unassigned" data-depth="0" class="flex flex-col">
							<button
								type="button"
								data-testid="section-toggle-unassigned"
								aria-expanded={isExpanded}
								class="flex items-center gap-2 py-1.5 text-left"
								onclick={() => toggleSection('unassigned')}
							>
								<span aria-hidden="true" class="text-ink-2">{isExpanded ? '▾' : '▸'}</span>
								<span data-testid="section-header-unassigned" class="text-sm font-medium text-ink">
									{m.roster_unassigned()} ({unassignedGroup.memberCount})
								</span>
							</button>
							{#if isExpanded}
								<ul class="flex flex-col pl-5">
									{#each unassignedGroup.members as row (row.memberId)}
										{@render memberRow(row, false)}
									{/each}
								</ul>
							{/if}
						</section>
					{/if}
				</div>
			{:else}
				<ul data-testid="roster-flat-list" class="flex flex-col">
					{#each flatRows as row (row.memberId)}
						{@render memberRow(row, true)}
					{/each}
				</ul>
			{/if}
		{/if}
	</div>
</main>
