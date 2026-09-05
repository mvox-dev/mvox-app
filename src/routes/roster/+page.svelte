<script lang="ts">
	// T3.3/#19 — the collective roster: active members' shared name+email subset.
	// TS.1/#95 — rewritten from a flat list into a SECTION-GROUPED collapsible
	// layout (default) with a column-header toggle to a flat alphabetical view.
	// Protected automatically (not on guard.ts's allowlist, `isProtectedPath('/roster')`
	// is true by default). No `completionGate` import here — the CURRENT-user
	// application of #28 is the layout's redirect; the OTHER-members application (a
	// nameless member never appearing as a row) lives entirely in `rosterData.ts`'s
	// `toRosterRow` — this component only renders whatever `loadRoster` returns.
	import { tick } from 'svelte';
	import { m } from '$lib/paraglide/messages.js';
	import { rovingNextIndex } from '$lib/a11y/roving';
	import { getToken } from '$lib/auth/storage';
	import { selectedCollectiveStore } from '$lib/collectives/store';
	import { loadRoster, type RosterRow } from '$lib/roster/rosterData';
	import {
		deactivateMember,
		reinstateMember,
		loadInactiveRoster,
		listDeactivateBlockers,
		type DeactivateBlocker
	} from '$lib/roster/memberLifecycle';
	import { resolveMyLibraryId } from '$lib/library/librarianStore';
	import { listSections, groupBySection, type SectionNode, type SectionGroup } from '$lib/sections/sectionData';
	import {
		assignMemberSection,
		unassignMemberSection,
		createSection,
		reorderSections,
		deleteSection,
		reparentSection,
		renameSection
	} from '$lib/sections/sectionActions';
	import { isSectionMembershipMissing, isSectionNotEmpty } from '$lib/sections/sectionErrors';
	import SectionPicker from '$lib/sections/SectionPicker.svelte';
	import { adminStore } from '$lib/nav/adminStore';
	import type { EntuCfg } from '$lib/seasons/entuSeasons';
	import { isAuthExpiredError } from '$lib/entu/request';
	import SessionExpiredNotice from '$lib/components/auth/SessionExpiredNotice.svelte';

	const selected = $derived($selectedCollectiveStore);
	const admin = $derived($adminStore);

	type Status = 'loading' | 'no-collective' | 'load-error' | 'session-expired' | 'ready';

	// Non-reactive generation guard — mirrors profile/+page.svelte's `let generation`
	// exactly (never $state, so bumping it doesn't retrigger the load effect). Guards
	// against a stale (superseded) load resolving after a collective switch.
	let generation = 0;
	// #255 review r3 F2 — the collective whose data is currently on screen, so
	// `loadForSelected` can tell a SWITCH from a refresh. Non-reactive for the same
	// reason as `generation`: it is read inside the load, never rendered.
	let loadedDb: string | null = null;
	let status = $state<Status>('loading');
	let rows = $state<RosterRow[]>([]);
	let sections = $state<SectionNode[]>([]);
	// F3 code-review fix: the two loads are DECOUPLED (Promise.allSettled, not
	// Promise.all) — a section-tree failure must not black out a roster the app
	// could otherwise show. `sectionsError` is set when ONLY the section load
	// failed (rows loaded fine); the page then renders the flat list plus a
	// visible banner — still loud (console.error + banner), never silent.
	let sectionsError = $state(false);

	// F5 code-review fix: a failed "Create + assign" used to be INVISIBLE. The
	// picker closes synchronously on a valid submit (its pinned contract), and
	// both writes then failed into a bare console.error — the user tapped, the
	// dropdown vanished, and nothing appeared: no group, no error, no reopened
	// form. There is no optimistic state to revert here either (unlike a pick,
	// where the row visibly snaps back), so the failure has to be SAID. Rendered
	// inline in the member's own row rather than as a page-top banner: that is
	// where the user is looking, and a long roster can scroll a top banner out of
	// sight entirely.
	//   'create' — createSection rejected (or there was no cfg): nothing was written.
	//   'assign' — the section WAS created (it is in the tree) but the member could
	//              not be put into it.
	let sectionWriteError = $state<{ memberId: string; kind: 'create' | 'assign' } | null>(null);

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
		// #99 review F2/F3 — a reload re-derives the tree from scratch, so neither a
		// previous reorder's alert nor its "moved to position 2" announcement is
		// about anything on screen any more (a collective switch replaces the tree
		// outright).
		reorderError = false;
		reorderStatus = '';
		// #110 review F1/F4 — the remove path's two pieces of transient state are
		// about a tree that is being replaced: a failure message naming a section
		// the next tree may not even contain, and a half-armed confirm on a header
		// that is about to be re-rendered from different data. Both drop here,
		// alongside the reorder pair, for the same reason.
		removeError = null;
		pendingRemoveId = null;
		// #255 (A) — same reasoning: a half-armed deactivate confirm or a stale
		// refusal message is about a row the next tree may not even contain.
		pendingDeactivateId = null;
		deactivateRefusal = null;
		deactivateActionError = null;
		// #255 review r3 F2 — the inactive panel is the one surface this function
		// does NOT re-derive, so without this a switch left collective A's inactive
		// members rendered under B's roster, each with a live Reinstate button
		// pointing at A's member ids. Same rule `expandedIds` follows (state keyed
		// to data that is being replaced) — but scoped to an actual SWITCH, because
		// the deactivate/reinstate paths call this as a REFRESH and reload the panel
		// themselves; a blanket reset here would slam it shut under them.
		if (current?.db !== loadedDb) {
			loadedDb = current?.db ?? null;
			showInactive = false;
			inactiveRows = [];
			inactiveLoadError = false;
		}
		if (!current) {
			status = 'no-collective';
			rows = [];
			sections = [];
			// #110 review F3 — collapse state is keyed by section id, so it must never
			// outlive the tree it describes. Ids from the previous collective would
			// otherwise keep `expandedIds` non-empty over a tree that has none of them
			// on screen, and accumulate across every switch. Every site that REPLACES
			// the tree wholesale drops the set (see the two below).
			expandedIds = new Set();
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
			// #107 — a dead token kills BOTH parallel reads uniformly; say so
			// truthfully instead of the generic load error (whose Retry can never
			// succeed against a dead token).
			if (isAuthExpiredError(rowResult.reason)) {
				status = 'session-expired';
				return;
			}
			// The roster itself couldn't be read — nothing presentable regardless of
			// how the section load went. Full loud error, matching pre-F3 behavior.
			console.error('roster: load failed', rowResult.reason);
			status = 'load-error';
			return;
		}
		rows = rowResult.value;

		if (sectionResult.status === 'rejected') {
			if (isAuthExpiredError(sectionResult.reason)) {
				status = 'session-expired';
				return;
			}
			console.error('roster: section tree load failed', sectionResult.reason);
			sections = [];
			expandedIds = new Set();
			sectionsError = true;
			// Grouping is meaningless without a tree — fall back to the flat view so
			// the toggle button's label stays truthful about what's on screen.
			view = 'flat';
		} else {
			sections = sectionResult.value;
			expandedIds = new Set();
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

	// ── #124 (F3) — which sections belong to THIS collective ────────────────────
	//
	// `listSections` queries `entity?_type.string=section&…&limit=500` with NO org
	// scoping, and sections are created `_sharing: 'public'` (federation
	// discoverability, v4E) — so EVERY readable section in the db lands in
	// `sections`, not just this collective's. Live polyphony holds 16 sections
	// across FOUR test orgs, all org-parented.
	//
	// SPIKE root cause (2026-08-12, #124 check 4): `currentDbEntityId` used to read
	// `rows.find((r) => r.dbEntityId)?.dbEntityId` — i.e. whichever roster row `loadRoster`
	// happened to sort first (alphabetically), NOT the viewer. `loadRoster`'s
	// member query is not org-scoped either, so on a multi-org db the first row
	// can legitimately belong to another org, silently migrating every
	// destructive control onto the wrong collective's sections and rendering a
	// FOREIGN org's empty "(0)" section without its remove control while the
	// viewer's own kept one — two headers reading identically, disagreeing.
	// "Whose roster is this?" is answered from the AUTHENTICATED VIEWER's own
	// roster row (matched by `personId`, carried on `selected` from the token's
	// accounts map — see `Collective.personId`), never a guess from row order.
	/** #161 (collective = database) — the collective's DATABASE entity id, read
	 *  off the VIEWER's own roster row (matched by `personId`) — falls back to
	 *  the first row exposing a `dbEntityId` ONLY when the viewer has no row of her
	 *  own on this roster (an admin auditing a roster she isn't a member of, or
	 *  a fixture that never gave the viewer a matching `personId`); null when
	 *  neither answers anything (collective unknown to this reader entirely).
	 *  The fallback is intentionally the OLD heuristic, kept as a last resort
	 *  rather than removed outright: in a single-collective database, "the
	 *  first row's collective" and "the viewer's collective" are the same
	 *  answer — the multi-org ambiguity #124/F3 fixes only bites when the
	 *  viewer's OWN row is present but sorts non-first, which the primary
	 *  lookup above already handles before the fallback is ever reached. */
	const currentDbEntityId = $derived(
		rows.find((r) => r.personId === selected?.personId)?.dbEntityId ??
			rows.find((r) => r.dbEntityId)?.dbEntityId ??
			null
	);

	/** #124 (F3) — the section tree filtered to the viewer's OWN org: a
	 *  top-level (root) section is kept only when its `dbEntityId` matches
	 *  `currentDbEntityId`; a kept root's WHOLE subtree comes along with it (a
	 *  sub-section carries no org `_parent` of its own — v4E
	 *  `parentConstraint: 'exactly_one_of'` — so it can never be split from its
	 *  root). Permissive when `currentDbEntityId` is unknown (an unauthenticated
	 *  reader, or a pre-#124 fixture with no `dbEntityId` on any row) — keeps
	 *  everything, same "unknown means don't restrict" rule `isOwnDbEntitySection`
	 *  below already followed. This is what actually fixes the F3
	 *  inconsistency: a foreign org's section is no longer RENDERED at all, so
	 *  there is no "(0)" without a ✕ left on screen to disagree with the
	 *  viewer's own — pinned as-is (no membership exception) by
	 *  page.roster-sections-live-wire.spec.ts: a member the live DATA bug
	 *  mis-parents into another org's flat section (TU.1/#109's own
	 *  investigation-verdict fixture) is meant to surface as the data defect it
	 *  is, not be masked by keeping a foreign-org group on screen for her sake —
	 *  the fix for that is the data fix (reparent to a REAL sub-section),
	 *  tracked separately, not a rendering carve-out here. */
	const visibleSections = $derived(
		currentDbEntityId === null ? sections : sections.filter((n) => (n.dbEntityId ?? null) === currentDbEntityId)
	);

	const groups = $derived(groupBySection(rows, visibleSections));
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

	// ── #110 review F2 / #124 F3: `isOwnDbEntitySection` — a defense-in-depth backstop.
	//
	// `currentDbEntityId`/`visibleSections` above already keep a foreign org's section
	// OUT of the render entirely (#124/F3), so in practice every node reaching
	// `canRemove` below has already passed that filter. `isOwnDbEntitySection` stays as
	// a second, independent check on the same question (never trust one gate for
	// a destructive control) — see #110 review F2's original ruling: a
	// destructive affordance on another org's entity must never ship, belt AND
	// braces.
	/** section id → the OWNING org id of its top-level root. Sub-sections carry no
	 *  org `_parent` of their own (v4E `parentConstraint: 'exactly_one_of'`), so
	 *  the root's org is propagated down the subtree. */
	const rootDbEntityBySectionId = $derived.by(() => {
		const map = new Map<string, string | null>();
		function walk(nodes: SectionNode[], rootOrg: string | null): void {
			for (const n of nodes) {
				const org = n.parentId === null ? (n.dbEntityId ?? null) : rootOrg;
				map.set(n.id, org);
				walk(n.children, org);
			}
		}
		walk(sections, null);
		return map;
	});

	/**
	 * True when `id` is NOT known to belong to a different collective (#161: the
	 * database entity). Permissive when either side is unknown — a reader who
	 * cannot see any collective `_parent` (rosterData never throws on that) or a
	 * tree from a pre-#161 fixture must not lose its own controls; the check
	 * exists to exclude sections we can POSITIVELY place in another collective.
	 */
	function isOwnDbEntitySection(id: string): boolean {
		const org = rootDbEntityBySectionId.get(id) ?? null;
		if (org === null || currentDbEntityId === null) return true;
		return org === currentDbEntityId;
	}

	// TU.2/#110 (finding #9) — collapse state is an OPT-IN set (every section
	// starts COLLAPSED; expanding adds its id). Supersedes the TS.1/#95
	// opt-out/expanded-by-default shape per PO decision in #110 — see
	// page.roster-sections-ux.spec.ts. Same `new Set(...)` copy-then-reassign
	// pattern as the library browse tree (library/+page.svelte's
	// expandedWorks/expandedEditions).
	let expandedIds = $state<Set<string>>(new Set());
	function toggleSection(id: string): void {
		const next = new Set(expandedIds);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		expandedIds = next;
	}

	/** Every section id in the live tree, recursively, plus 'unassigned' when
	 *  that pseudo-group is on screen — the full set collapse-all/expand-all
	 *  operates over. */
	const allSectionIdsList = $derived.by(() => {
		const ids: string[] = [];
		function walk(nodes: SectionNode[]): void {
			for (const n of nodes) {
				ids.push(n.id);
				walk(n.children);
			}
		}
		walk(visibleSections);
		if (unassignedGroup) ids.push('unassigned');
		return ids;
	});

	// #155/S1 — the collapse-all/expand-all toggle is REPLACED by a 3-chip
	// selector (Collapsed / Expanded / Arrange). Collapsed and Expanded are
	// display modes over the SAME `expandedIds` opt-in set finding #9 shipped;
	// Arrange swaps `roster-groups` out for the compact section list entirely
	// (no member rows at all) and is where ALL section management will live
	// (S2–S4). Radio-style, not a flip: each chip sets `expandedIds`
	// DETERMINISTICALLY (empty / full) rather than toggling off the CURRENT
	// state, so "Collapsed" and "Expanded" are idempotent regardless of what a
	// user did with an individual section's own disclosure toggle in between —
	// and switching OUT of Arrange always lands on a truthful collapsed/expanded
	// screen, never a stale one.
	let viewMode = $state<'collapsed' | 'expanded' | 'arrange'>('collapsed');

	function setViewMode(mode: 'collapsed' | 'expanded' | 'arrange'): void {
		viewMode = mode;
		if (mode === 'collapsed') expandedIds = new Set();
		else if (mode === 'expanded') expandedIds = new Set(allSectionIdsList);
		// 'arrange' leaves `expandedIds` as-is — the arrange list doesn't read it,
		// and whichever collapsed/expanded shape was live comes right back when
		// the user switches to one of the other two chips.
	}

	// #156 — view-mode chip roving tabindex. Radiogroup semantics (arrow moves
	// AND selects): `viewMode` already models single selection, so there is no
	// separate roving $state to keep in sync — the pressed chip IS the tab
	// stop. Membership is resolved live at keypress (the Arrange chip is
	// conditionally rendered for non-admins), matching the nav's own walk.
	function handleViewModeKeydown(e: KeyboardEvent): void {
		const group = e.currentTarget as HTMLElement;
		const chips = Array.from(group.querySelectorAll<HTMLButtonElement>('button'));
		const idx = chips.indexOf(e.target as HTMLButtonElement);
		if (idx < 0) return;
		const next = rovingNextIndex(e.key, idx, chips.length);
		if (next < 0) return;
		e.preventDefault();
		const mode = chips[next].dataset.viewMode as 'collapsed' | 'expanded' | 'arrange' | undefined;
		if (!mode) return;
		setViewMode(mode);
		chips[next].focus();
	}

	/** #155/S1 arrange-mode shell — one row per section, EVERY nesting level, in
	 *  tree pre-order, over the SAME `visibleSections` the grouped view renders
	 *  (org-filtered, #124/F3). `memberCount` is read off the SAME `groupById`
	 *  map the grouped headers use, so the arrange list's "(n)" is always the
	 *  identical roll-up, never a re-derivation that could drift from it. */
	type ArrangeRow = { id: string; name: string; depth: number; memberCount: number };
	const arrangeRows = $derived.by(() => {
		const list: ArrangeRow[] = [];
		function walk(nodes: SectionNode[]): void {
			for (const n of nodes) {
				list.push({ id: n.id, name: n.name, depth: n.depth, memberCount: groupById.get(n.id)?.memberCount ?? 0 });
				walk(n.children);
			}
		}
		walk(visibleSections);
		return list;
	});

	// Tailwind v4 needs full static class names (no dynamic template literals) —
	// a fixed per-depth lookup, clamped at the deepest entry for any section
	// tree that somehow nests beyond it.
	const ARRANGE_INDENT_CLASSES = ['pl-0', 'pl-4', 'pl-8', 'pl-12', 'pl-16'] as const;
	function arrangeIndentClass(depth: number): string {
		return ARRANGE_INDENT_CLASSES[Math.min(depth, ARRANGE_INDENT_CLASSES.length - 1)];
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

	// TS.3/#97 — inline "+ New section…" wiring. Two ordered, SERVER-CONFIRMED
	// writes: createSection resolves with the new id first, only THEN
	// assignMemberSection fires (the id doesn't exist to assign against until
	// the create round-trips — no optimism on the create half). On success the
	// new node is inserted into the LOCAL tree + the member's local row —
	// `loadRoster`/`listSections` are never refetched (same "runs once at load"
	// contract as the rest of this page).

	/** Depth-first search for a node by id — used to derive the new node's depth. */
	function findSectionNode(nodes: SectionNode[], id: string): SectionNode | null {
		for (const node of nodes) {
			if (node.id === id) return node;
			const found = findSectionNode(node.children, id);
			if (found) return found;
		}
		return null;
	}

	/** Immutable insert: appended as a new ROOT when parentId is null, else spliced
	 *  into the matching ancestor's `children` (rebuilding every node on the path
	 *  so `sections` reassignment is enough to notify Svelte). */
	function insertSectionNode(
		nodes: SectionNode[],
		newNode: SectionNode,
		parentId: string | null
	): SectionNode[] {
		if (parentId === null) return [...nodes, newNode];
		return nodes.map((node) => {
			if (node.id === parentId) return { ...node, children: [...node.children, newNode] };
			if (node.children.length === 0) return node;
			return { ...node, children: insertSectionNode(node.children, newNode, parentId) };
		});
	}

	// TU.2/#110 (finding #7) — "Remove" wiring. `canRemove` in `sectionGroup`
	// already enforces admin-only + zero-members + zero-children before this
	// control even renders, so this handler trusts its `id` argument the same
	// way `handleCreate`'s `assignMemberSection` call trusts its just-created
	// section id. Optimistic-and-reconcile, same shape as `performReorder`: the
	// LOCAL tree is patched immediately (no roster/section refetch anywhere on
	// this page), and a rejected write reverts the WHOLE snapshot taken before
	// the patch — safe here (unlike the per-membership reverts above) because a
	// remove touches exactly one node with no concurrent writes racing it.

	/** Immutable remove: drops `id` wherever it sits in the tree (top level or
	 *  nested inside some ancestor's `children`). */
	function removeSectionNode(nodes: SectionNode[], id: string): SectionNode[] {
		return nodes
			.filter((n) => n.id !== id)
			.map((n) => (n.children.length === 0 ? n : { ...n, children: removeSectionNode(n.children, id) }));
	}

	// #155/S4 — RENAME tree-mutation helper. Unlike remove/reparent, a rename
	// touches exactly one node's `name` in place — no relocation, no depth
	// recompute, children untouched.

	/** Immutable rename: rewrites `name` on `id` wherever it sits in the tree
	 *  (top level or nested), children untouched. */
	function renameSectionNode(nodes: SectionNode[], id: string, name: string): SectionNode[] {
		return nodes.map((n) => {
			if (n.id === id) return { ...n, name };
			if (n.children.length === 0) return n;
			return { ...n, children: renameSectionNode(n.children, id, name) };
		});
	}

	// #155/S3 — indent/unindent tree-mutation helpers. Unlike `insertSectionNode`
	// (new node, no prior home) and `removeSectionNode` (gone for good), a
	// reparent RELOCATES an existing node+subtree: it has to come out of wherever
	// it sits, get its own (and every descendant's) `depth` recomputed relative
	// to its NEW parent, and go back in at a SPECIFIC position among its new
	// siblings — "last child" for indent, "right after the former parent" for
	// unindent (see `applyReparent`'s callers below).

	/** Rewrite `node.depth` to `depth`, and cascade `depth + 1, +2, …` down every
	 *  descendant — the whole subtree moves as one relative shape, only its
	 *  ANCHOR depth changes. */
	function withDepth(node: SectionNode, depth: number): SectionNode {
		return { ...node, depth, children: node.children.map((c) => withDepth(c, depth + 1)) };
	}

	/** Immutable extract: pulls `id` (with its whole subtree, untouched) out of
	 *  wherever it sits — top level or nested — and returns BOTH the pruned tree
	 *  and the removed node (null if `id` isn't anywhere in it). */
	function extractSectionNode(nodes: SectionNode[], id: string): [SectionNode[], SectionNode | null] {
		let removed: SectionNode | null = null;
		function walk(list: SectionNode[]): SectionNode[] {
			const kept: SectionNode[] = [];
			for (const n of list) {
				if (n.id === id) {
					removed = n;
					continue;
				}
				kept.push(n.children.length === 0 ? n : { ...n, children: walk(n.children) });
			}
			return kept;
		}
		const next = walk(nodes);
		return [next, removed];
	}

	/** Immutable insert at a SPECIFIC index (unlike `insertSectionNode`, which
	 *  always appends): `parentId === null` targets the top level, `atIndex`
	 *  undefined means "append" (used for indent's "last child"). */
	function insertSectionNodeAt(
		nodes: SectionNode[],
		newNode: SectionNode,
		parentId: string | null,
		atIndex: number | undefined
	): SectionNode[] {
		if (parentId === null) {
			const idx = atIndex ?? nodes.length;
			return [...nodes.slice(0, idx), newNode, ...nodes.slice(idx)];
		}
		return nodes.map((node) => {
			if (node.id === parentId) {
				const idx = atIndex ?? node.children.length;
				return { ...node, children: [...node.children.slice(0, idx), newNode, ...node.children.slice(idx)] };
			}
			if (node.children.length === 0) return node;
			return { ...node, children: insertSectionNodeAt(node.children, newNode, parentId, atIndex) };
		});
	}

	/** Where a reparent's new parent is: a SECTION (indent's previous sibling,
	 *  unindent's grandparent) or the ORGANIZATION (unindent promoting to top
	 *  level) — `reparentSection`'s wire call takes either id verbatim, but the
	 *  LOCAL tree update needs to know which so it can set `depth`/`parentId`/
	 *  `dbEntityId` correctly (see `SectionNode.dbEntityId`'s own doc: only top-level
	 *  nodes carry it). */
	type ReparentTarget = { kind: 'section'; sectionId: string } | { kind: 'org'; dbEntityId: string };

	/** Move `id` (with its subtree) to `target`, landing right after
	 *  `insertAfterId` among its NEW siblings (`null` = append at the end — used
	 *  for indent's "last child of the previous sibling"). Depths of `id` and
	 *  every descendant are recomputed relative to the new parent; nodes
	 *  elsewhere in the tree are untouched. No-op (returns `nodes` as-is) if
	 *  `id` isn't found. */
	function applyReparent(
		nodes: SectionNode[],
		id: string,
		target: ReparentTarget,
		insertAfterId: string | null
	): SectionNode[] {
		const [withoutNode, removed] = extractSectionNode(nodes, id);
		if (!removed) return nodes;

		const newDepth =
			target.kind === 'org' ? 0 : (findSectionNode(nodes, target.sectionId)?.depth ?? 0) + 1;
		const newParentId = target.kind === 'org' ? null : target.sectionId;
		const newDbEntityId = target.kind === 'org' ? target.dbEntityId : null;
		const movedNode: SectionNode = { ...withDepth(removed, newDepth), parentId: newParentId, dbEntityId: newDbEntityId };

		let atIndex: number | undefined;
		if (insertAfterId !== null) {
			const newSiblings =
				target.kind === 'org' ? withoutNode : (findSectionNode(withoutNode, target.sectionId)?.children ?? []);
			const idx = newSiblings.findIndex((n) => n.id === insertAfterId);
			atIndex = idx === -1 ? undefined : idx + 1;
		}
		return insertSectionNodeAt(withoutNode, movedNode, newParentId, atIndex);
	}

	// #110 review F1 — a FAILED remove used to be SILENT: the catch reverted
	// `sections` and logged, so the user tapped ✕, watched the group vanish, and
	// watched it reappear with nothing on screen explaining why. That is precisely
	// the failure mode this page's own F5 fix (`sectionWriteError`) and #99's F2
	// fix (`reorderError`) were added to eliminate — the remove path, added last,
	// had neither. It is not a rare path either: Entu only lets `_owner` delete an
	// entity, `_owner` is auto-assigned to the CREATOR, and `createSection`'s body
	// deliberately carries no `_inheritrights` — so an admin who did not
	// personally create the section (every seeded or migration-created one, and
	// every section made by another admin) gets a 403.
	//
	//   'write'     — the delete was attempted and rejected (403, network, no cfg).
	//   'not-empty' — REFUSED before any write: the server still reports members
	//                 or sub-sections under it (see deleteSection's contract). The
	//                 on-screen "(0)" is the roster's active-and-named-only count,
	//                 which is not the same question.
	//
	// Carries the NAME, not the id: it is rendered once, above the groups (next to
	// the reorder alert), and by then the section it names is back on screen but
	// not otherwise marked.
	let removeError = $state<{ name: string; kind: 'write' | 'not-empty' } | null>(null);

	// #110 review F4 — a two-step inline confirm, because a section delete is
	// IRREVERSIBLE and this page is mobile-shaped (`max-w-md`): the ✕ sat one
	// mis-tap away from destroying an entity. Inline rather than a blocking
	// `confirm()` — the page's own idiom (SectionPicker's inline create form) and
	// testable without stubbing a window global. `pendingRemoveId` is the section
	// whose header is currently showing "confirm / cancel" instead of the ✕; only
	// one at a time, and arming one disarms the other.
	let pendingRemoveId = $state<string | null>(null);

	// ── #255 (A) — deactivate a member: admin-only, never self, two-step
	// confirm reusing the SAME idiom as `pendingRemoveId` above, REFUSAL while
	// the person holds a manageable `_owner`/`_editor` grant (accepted rec 1 —
	// deactivate refuses rather than auto-stripping rights; see
	// memberLifecycle.ts's doc for why). GREEN's stated choice: the control is
	// NOT pre-disabled at render for a blocker — computing `listDeactivateBlockers`
	// for every row on every render would mean N rights reads (2 Entu calls
	// each) on a page that already does real work just listing the roster; the
	// refusal instead surfaces the ONE TIME it matters, at confirm, which is
	// also the only point the rights answer needs to be fresh (a grant could
	// be added between page-load and this tap). The trade is one wasted tap
	// for an admin who already knows the target holds a role, against a
	// roster-wide fan-out of rights reads most renders never need.
	let pendingDeactivateId = $state<string | null>(null);
	let deactivateRefusal = $state<{ memberId: string; blockers: DeactivateBlocker[] } | null>(null);
	let deactivatePending = $state(false);

	// #255 review F2 — the two lifecycle writes must fail LOUD, not just closed.
	// Both catches previously only logged, so a rejected rights read, a 4xx on the
	// status write or a dropped network left the control disarming itself with the
	// row unchanged and nothing on screen — indistinguishable from a no-op or a UI
	// bug. Modelled on `removeError` above (the page's own idiom for exactly this):
	// carries the member id, because unlike the section alert this renders IN the
	// row that was tapped. Copy binding still holds — neither string may say
	// removed/deleted; both say the state is unchanged.
	let deactivateActionError = $state<{ memberId: string; kind: 'deactivate' | 'reinstate' } | null>(
		null
	);

	async function armDeactivate(memberId: string): Promise<void> {
		deactivateRefusal = null;
		deactivateActionError = null;
		pendingDeactivateId = memberId;
		await tick();
		document.querySelector<HTMLElement>(`[data-testid="member-deactivate-confirm-${memberId}"]`)?.focus();
	}

	async function disarmDeactivate(memberId: string): Promise<void> {
		pendingDeactivateId = null;
		await tick();
		document.querySelector<HTMLElement>(`[data-testid="member-deactivate-${memberId}"]`)?.focus();
	}

	/** Confirm branch of the two-step deactivate. FAIL-CLOSED throughout: the
	 *  rights read (`listDeactivateBlockers`) rejecting, or any other failure,
	 *  must never let the write proceed — caught below, nothing sent. */
	async function handleDeactivateConfirm(row: RosterRow): Promise<void> {
		if (deactivatePending) return;
		const cfg = currentCfg;
		if (!cfg) return;
		deactivatePending = true;
		deactivateRefusal = null;
		deactivateActionError = null;
		try {
			// #255 review r3 F1 — the database entity id is the SUBJECT of both rights
			// reads below, so an unresolvable one is a FAILED check, never "nothing to
			// check". The `?? ''` this replaces made it the latter: an empty id turns
			// `listAdmins`'s rights GET into entu-api's entity LIST route, which
			// answers 200 with no `entity` key, so the blocker list came back EMPTY
			// and the deactivate proceeded past an unverified grant — silently, on the
			// one guard the whole refuse-don't-strip design rests on. Thrown (not
			// returned) so the outer catch renders the same loud alert every other
			// fail-closed path here already renders.
			const dbEntityId = row.dbEntityId ?? currentDbEntityId;
			if (!dbEntityId) {
				throw new Error(`roster: cannot resolve the database entity id for member ${row.memberId}`);
			}
			// #255 review round 2 F1 — the library lookup is part of the FAIL-CLOSED
			// chain, NOT a best-effort side read. `resolveMyLibraryId` THROWS on any
			// non-2xx library list (`LibraryLookupError`) and reserves `null` for the
			// one factual emptiness it can assert: no library entity under the
			// database entity. Swallowing the throw into `null` would convert a
			// transient 500 into the factual claim "this collective has no library",
			// which makes `listDeactivateBlockers` skip the `listLibrarians` read
			// entirely and lets the deactivate proceed past an UNVERIFIED librarian
			// grant — exactly the grant-outlives-active-member state (invariant B2 /
			// v4E trigger 5) that must be unreachable by construction. So it rejects
			// into the outer catch like every other read here.
			const libraryId = await resolveMyLibraryId(cfg, undefined, dbEntityId);
			const blockers = await listDeactivateBlockers(cfg, row.personId, dbEntityId, libraryId);
			if (blockers.length > 0) {
				deactivateRefusal = { memberId: row.memberId, blockers };
				pendingDeactivateId = null;
				return;
			}
			await deactivateMember(cfg, row.memberId);
			pendingDeactivateId = null;
			// She drops out of every active-scoped read — re-derive from the
			// server rather than patch a local delta (same discipline the section
			// remove/reorder paths already follow on this page).
			await loadForSelected();
			// #255 review r3 F2 — and she drops INTO the inactive panel, so an open
			// panel is stale the moment this write lands. `handleReinstate` already
			// refreshes it for the mirror-image reason; the two lifecycle paths have
			// to agree. Its own try/catch: a stale panel is not a failed deactivate
			// and must not raise the deactivate's alert over a write that landed.
			if (showInactive) {
				try {
					inactiveRows = await loadInactiveRoster(cfg);
				} catch (e) {
					console.error('roster: inactive roster reload after deactivate failed', e);
				}
			}
		} catch (e) {
			// FAIL-CLOSED (Gama binding): a rejected rights read, or a rejected
			// write, must never leave the deactivate looking like it went through.
			// And fail-LOUD (#255 review F2): the confirm disarms itself and the row
			// is unchanged, so without this alert the tap reads as "nothing happened".
			console.error('roster: deactivate failed', row.memberId, e);
			pendingDeactivateId = null;
			deactivateActionError = { memberId: row.memberId, kind: 'deactivate' };
		} finally {
			deactivatePending = false;
		}
	}

	// ── #255 (B) — the inactive-members surface: OUT of the roster's normal
	// flow (engineering's placement call — a collapsed, admin-only panel below
	// the main list, closed by default and loaded lazily on first open, never
	// preloaded alongside the active roster). Shows each inactive member's
	// SECTION assignment (adopted binding — explains the section
	// ghost-blocker), reinstates with ONE action and no fresh invitation.
	let showInactive = $state(false);
	let inactiveRows = $state<RosterRow[]>([]);
	let inactiveLoadError = $state(false);

	async function toggleInactive(): Promise<void> {
		const opening = !showInactive;
		showInactive = opening;
		if (!opening) return;
		const cfg = currentCfg;
		if (!cfg) return;
		try {
			inactiveLoadError = false;
			inactiveRows = await loadInactiveRoster(cfg);
		} catch (e) {
			console.error('roster: inactive roster load failed', e);
			inactiveLoadError = true;
			inactiveRows = [];
		}
	}

	// #255 review round 2 F2 — mirrors `deactivatePending`. `reinstateMember` is a
	// clear-then-set pair: two concurrent runs both GET the same status value id,
	// the first DELETE wins and the second gets a non-2xx, so the SECOND call
	// throws and renders "…couldn't be reinstated — they're still not active"
	// AFTER the reinstate in fact succeeded. A false claim in copy whose whole
	// point is truthfulness, so a second tap is refused while one is in flight.
	let reinstatePending = $state<string | null>(null);

	async function handleReinstate(memberId: string): Promise<void> {
		if (reinstatePending) return;
		const cfg = currentCfg;
		if (!cfg) return;
		reinstatePending = memberId;
		deactivateActionError = null;
		try {
			await reinstateMember(cfg, memberId);
			// Back in the active reads — the page re-reads rather than patching,
			// same discipline as `handleDeactivateConfirm` above.
			await loadForSelected();
			if (showInactive) {
				try {
					inactiveRows = await loadInactiveRoster(cfg);
				} catch (e) {
					console.error('roster: inactive roster reload after reinstate failed', e);
				}
			}
		} catch (e) {
			// #255 review F2 — a failed reinstate produces NO visible change at all
			// otherwise (the row is already in the inactive panel and stays there),
			// so the tap is silently indistinguishable from a dead button.
			console.error('roster: reinstate failed', memberId, e);
			deactivateActionError = { memberId, kind: 'reinstate' };
		} finally {
			reinstatePending = null;
		}
	}

	// #113 RED — arming/disarming the two-step confirm each unmount the very
	// button that held focus (the ✕ → confirm/cancel swap, and the reverse on
	// cancel), so without explicit placement focus drops to <body> (WCAG
	// 2.4.3). Async: `tick()` lets the swapped-in button render before the
	// query for it runs.
	async function armRemove(id: string): Promise<void> {
		// A fresh attempt owns the error slot — a previous failure's message must
		// not outlive the retry that fixed it (same discipline as `handleCreate`
		// and `performReorder`).
		removeError = null;
		pendingRemoveId = id;
		await tick();
		document.querySelector<HTMLElement>(`[data-testid="section-remove-confirm-${id}"]`)?.focus();
	}

	async function disarmRemove(id: string): Promise<void> {
		pendingRemoveId = null;
		await tick();
		document.querySelector<HTMLElement>(`[data-testid="section-remove-${id}"]`)?.focus();
	}

	// #113 review F1 — the COMPLETING half of the same WCAG 2.4.3 story as
	// `armRemove`/`disarmRemove`, and the only irreversible one: a SUCCESSFUL
	// remove unmounts the focused Confirm button together with the whole
	// `section-group-<id>` subtree, so unlike the cancel path there is no
	// restored twin to hand focus back to and it drops to <body>. The neighbour
	// has to be resolved from the PRE-removal tree — afterwards the node is gone
	// and its parentage with it.

	/** The section whose header should catch focus once `id` is gone: its
	 *  PREVIOUS sibling (focus moves UP the list rather than jumping across it),
	 *  else its parent, else null — "no neighbouring header", and the caller
	 *  falls back to the Collapsed view-mode chip that always renders above the
	 *  groups (#155/S1 — supersedes the old collapse-all control). */
	function removeFocusFallbackId(id: string): string | null {
		const siblingNodes = siblingsOf(sections, id);
		if (!siblingNodes) return null;
		const idx = siblingNodes.findIndex((n) => n.id === id);
		if (idx > 0) return siblingNodes[idx - 1].id;
		return findSectionNode(sections, id)?.parentId ?? null;
	}

	/** Place focus once a SUCCESSFUL removal has settled. `tick()` first, same
	 *  shape as `armRemove`: the group only leaves the DOM after the
	 *  `sections` reassignment renders. */
	async function placeFocusAfterRemove(targetId: string | null): Promise<void> {
		// #155/S4 review F2 — delete MOVED into arrange mode, where there is no
		// `section-toggle-*` at all (that is the collapsed/expanded group's expand
		// control). Resolving the neighbour by that selector alone therefore always
		// missed and fell through to the view-mode chip — so the natural next
		// keypress straight after Confirm silently switched the page OUT of arrange
		// mode. Two selectors, in render order, exactly like `handleElementFor`:
		// only one of the two UIs is ever mounted, so trying both is unambiguous.
		// The chip stays as the genuine last resort — "no neighbouring header".
		if (targetId && viewMode === 'arrange') {
			// Keep the roving tab stop WITH the focus: an arrange row is only at
			// `tabindex="0"` when `activeArrangeRowId` names it, and landing focus
			// on a `tabindex="-1"` row would put the widget's tab stop somewhere
			// else than the caret.
			rovingHandleId = targetId;
		}
		await tick();
		const neighbour = targetId
			? (document.querySelector<HTMLElement>(`[data-testid="section-toggle-${targetId}"]`) ??
				document.querySelector<HTMLElement>(`[data-testid="arrange-row-${targetId}"]`))
			: null;
		(neighbour ?? document.querySelector<HTMLElement>('[data-testid="roster-view-chip-collapsed"]'))?.focus();
	}

	/** …and after a REFUSED one: nothing was removed, so the ✕ that the Confirm
	 *  button replaced is back in the header row and is the honest landing (the
	 *  header itself only as a fallback — `canRemove` could have gone false under
	 *  a concurrent refetch). The error text is announced separately by
	 *  `section-remove-error`'s role="alert". */
	async function placeFocusAfterFailedRemove(id: string): Promise<void> {
		await tick();
		// #155/S4 review F1 (follow-up) — PRESENT is not the same as FOCUSABLE. S4
		// made the ✕ `disabled` when the section is ineligible (`!canDelete`) as
		// well as while a structural write is in flight, and a disabled <button>
		// cannot take focus at all: stopping the `??` chain at the first element
		// that merely EXISTS made `.focus()` a silent no-op and dropped focus to
		// <body>. That is precisely the `section-not-empty` case — the refusal's own
		// reconcile reveals the child that makes the ✕ ineligible — so the chain has
		// to step OVER a disabled candidate and land on the row instead.
		const focusable = (testid: string): HTMLElement | null => {
			const el = document.querySelector<HTMLElement>(`[data-testid="${testid}"]`);
			return el && !(el as HTMLButtonElement).disabled ? el : null;
		};
		// #155/S4 review F2 — same two-UI lookup as `placeFocusAfterRemove`: the
		// `section-toggle-*` fallback is dead in arrange mode, where the row itself
		// is the landing.
		const target =
			focusable(`section-remove-${id}`) ??
			focusable(`section-toggle-${id}`) ??
			focusable(`arrange-row-${id}`);
		if (!target) return;
		target.focus();
		// Landing on the ROW means landing inside the roving-tabindex widget, where
		// focus and the tab stop must stay together (the same reasoning
		// `placeFocusAfterRemove` spells out) — a focused row at `tabindex="-1"`
		// leaves the widget's Tab entry point on some other row.
		if (target === document.querySelector(`[data-testid="arrange-row-${id}"]`)) {
			rovingHandleId = id;
		}
	}

	// #113 review F1 — a SUCCESSFUL remove was also the one outcome with no
	// announcement at all: the failure path has `section-remove-error`
	// (role="alert") and the reorder path has `roster-reorder-status`, so the
	// delete that actually worked was the one thing a screen-reader user got no
	// confirmation of (WCAG 4.1.3). Its own visually-hidden role="status"
	// region, mirroring `reorderStatus` — see `roster-section-remove-status`.
	let removeStatus = $state('');

	// #155/S4 review F1 — the delete's own in-flight flag, the third member of the
	// single-flight set (`reorderPending`/`renamePending` are the other two, see
	// `structuralWritePending` below). Before S4, delete rendered only in the
	// collapsed/expanded views and indent/unindent only in arrange, so a delete
	// could never be on screen beside another structural control; S4 puts rename,
	// delete, indent and unindent on the SAME row, and without this flag a delete
	// in flight left every one of its neighbours live.
	let removePending = $state(false);

	async function handleRemoveSection(id: string): Promise<void> {
		// #155/S4 review F1 — one structural write at a time, the same refusal
		// `performReorder`/`performReparent` already make. The primary guard is the
		// UI disabling the controls (see `structuralWritePending` on the arrange
		// row's buttons); this is the defensive backstop for the paths the UI
		// can't disable (the armed Confirm button renders unconditionally).
		if (structuralWritePending) return;
		// Both resolved BEFORE `pendingRemoveId` is cleared and the tree mutated —
		// each of those destroys the evidence this needs.
		const fallbackId = removeFocusFallbackId(id);
		const active = document.activeElement;
		// Only restore focus if the REMOVAL is what lost it — the same `ownsFocus`
		// discipline as the picker's `closeMenu`: focus already sitting elsewhere
		// is the user's own doing and yanking it back would fight them.
		const ownsFocus =
			!active ||
			active === document.body ||
			active === document.querySelector(`[data-testid="section-remove-confirm-${id}"]`);
		pendingRemoveId = null;
		removeError = null;
		// A fresh attempt owns the live region too — a previous "Tenor removed."
		// must not sit in it while a new removal is in flight.
		removeStatus = '';
		const name = findSectionNode(sections, id)?.name ?? id;
		const cfg = currentCfg;
		if (!cfg) {
			console.error('roster: section remove with no cfg', id);
			removeError = { name, kind: 'write' };
			if (ownsFocus) await placeFocusAfterFailedRemove(id);
			return;
		}
		// #155/S4 review F1 — the same collective-switch guard `performReorder`/
		// `performReparent` carry: a reconcile resolving after the user switched
		// collectives must not clobber the newer collective's tree.
		const g = generation;
		const before = sections;
		// #155/S4 review F1 (follow-up) — the failure landing is DEFERRED to the
		// `finally`, because the ✕ it wants to land on is
		// `disabled={structuralWritePending || …}` and `removePending` is still true
		// for the whole of the `catch`. Focusing from there was a no-op that dropped
		// focus to <body> (WCAG 2.4.3). Same ordering `submitRename` already gets
		// right: clear the flag, THEN `tick()` + focus. Left null on every path that
		// must NOT move focus — success (which places its own), and the
		// collective-switch bail-outs, where the tree on screen is no longer this
		// removal's.
		let failedRemoveId: string | null = null;
		removePending = true;
		sections = removeSectionNode(sections, id);
		try {
			await deleteSection(cfg, id);
			// #110 review F3 — the node is gone for good, so its collapse-state entry
			// is dead weight. Pruned only AFTER the write lands: a rejected delete
			// restores the tree, and the section's expanded state must come back with
			// it. (Neither view-mode chip's `aria-pressed` depends on this pruning
			// for correctness — #155/S1 reads `viewMode` directly, never a live
			// re-derivation off `expandedIds` — but the set should not keep growing
			// across removals either.)
			if (expandedIds.has(id)) {
				const next = new Set(expandedIds);
				next.delete(id);
				expandedIds = next;
			}
			removeStatus = m.roster_section_removed({ name });
			if (ownsFocus) await placeFocusAfterRemove(fallbackId);
		} catch (e) {
			console.error('roster: section remove failed', id, e);
			// #155/S4 review F1 — STOP GUESSING, re-derive from the server. The blind
			// `sections = before` this replaces restored a snapshot taken before the
			// write went out, discarding whatever landed since, and it was WRONG for
			// the refusal case in its own right: `section-not-empty` means the server
			// holds members/sub-sections this stale tree does not know about (that is
			// the whole reason `canDelete` couldn't gate it — see sectionErrors.ts),
			// so the honest thing to put back on screen is the server's tree, not the
			// one that mispredicted. Exactly the `listSections` reconcile
			// `performReparent` uses, with the same `generation` guard; the snapshot
			// survives only as the fallback for when the refetch ALSO fails.
			try {
				const fresh = await listSections(cfg);
				if (g !== generation) return; // superseded by a newer collective selection
				sections = fresh;
			} catch (refetchError) {
				console.error('roster: section refetch after a failed remove failed', refetchError);
				if (g !== generation) return;
				sections = before;
			}
			// #110 review F1/F3 — say it, don't just log it. `section-not-empty` is
			// its own message: nothing was written, and "it's not actually empty" is
			// a different instruction to the user than "the delete was refused".
			removeError = { name, kind: isSectionNotEmpty(e) ? 'not-empty' : 'write' };
			failedRemoveId = id;
		} finally {
			removePending = false;
			if (ownsFocus && failedRemoveId !== null) await placeFocusAfterFailedRemove(failedRemoveId);
		}
	}

	async function handleCreate(
		memberId: string,
		input: { name: string; parentId: string | null }
	): Promise<void> {
		// A fresh attempt owns the error slot — a previous failure's message must not
		// outlive the retry that fixed it.
		sectionWriteError = null;
		const cfg = currentCfg;
		if (!cfg) {
			console.error('roster: section create with no cfg', memberId, input);
			sectionWriteError = { memberId, kind: 'create' };
			return;
		}

		// TU.1/#109 (finding #10 root cause A) — the page threads the MEMBER'S OWN
		// org id into every create (the data layer ignores it when parentId is
		// set, so uniform threading is correct and simplest — see
		// page.roster-create-section-org.spec.ts). The page already knows it
		// (RosterRow.dbEntityId, carried from the member's `_parent`) — never let the
		// data layer fall back to its `limit=1` guess, which live-verifiably
		// returns the umbrella federation, not the collective.
		const dbEntityId = rows.find((r) => r.memberId === memberId)?.dbEntityId;

		let newId: string;
		try {
			newId = await createSection(cfg, { ...input, dbEntityId });
		} catch (e) {
			console.error('roster: section create failed', memberId, input, e);
			sectionWriteError = { memberId, kind: 'create' };
			return;
		}

		const depth = input.parentId ? (findSectionNode(sections, input.parentId)?.depth ?? 0) + 1 : 0;
		const newNode: SectionNode = {
			id: newId,
			name: input.name,
			displayOrder: Number.POSITIVE_INFINITY,
			parentId: input.parentId,
			// TU.1/#109 review — mirror what `listSections` would read back for it: a
			// top-level section is parented to THIS member's org, a sub-section is
			// section-parented and carries no org `_parent` at all (v4E
			// `parentConstraint: 'exactly_one_of'`). Without this the just-created
			// root would have an unknown org and the next top-level create in the
			// same session couldn't tell it apart from another org's roots.
			dbEntityId: input.parentId ? null : (dbEntityId ?? null),
			depth,
			children: []
		};
		// The section itself was genuinely created server-side — it belongs in the
		// tree regardless of how the assign below goes.
		sections = insertSectionNode(sections, newNode, input.parentId);
		// TU.2/#110 (finding #9) — a freshly created section starts EXPANDED (not
		// the new collapsed-by-default), so the member the caller is about to be
		// assigned into it is visible immediately, no manual toggle needed.
		expandedIds = new Set(expandedIds).add(newId);

		try {
			await assignMemberSection(cfg, memberId, newId);
		} catch (e) {
			console.error('roster: assigning the newly-created section failed', memberId, newId, e);
			// The section itself is real and already in the tree — say precisely that,
			// so the user doesn't retry the create and end up with a duplicate.
			sectionWriteError = { memberId, kind: 'assign' };
			return;
		}
		patchMemberSectionIds(memberId, [...currentSectionIds(memberId), newId]);
	}

	// #124 (F1+F2) — page-level "+ New section" entry point. SEPARATE from the
	// inline SectionPicker's own create form above (kept as-is; its own specs
	// keep pinning it) — this one lives in the roster header, needs no member
	// row, no picker, and no expansion state to reach.
	//
	// SPIKE root cause (2026-08-12, #124 check 1): section creation "does
	// nothing" in live NOT because the writes were broken, but because the ONLY
	// entry point was the picker's "+ New section…" — the LAST row of a member's
	// dropdown, one mis-tap away from the adjacent "(Unassigned)" row (identical
	// 24px height; a tap there is `pick(null)`, which no-ops and closes the
	// picker silently on an already-unassigned member — exactly the reported
	// symptom). A 16-section live tree also made that dropdown ~440px tall, so
	// the inline create form it swapped in was off-screen on a phone. This
	// control needs none of that: reachable with every section collapsed,
	// admin-only (fail-closed, same gate as every other admin control here).
	let pageCreateOpen = $state(false);
	let pageCreateName = $state('');
	let pageCreateParentId = $state('');
	let pageCreateError = $state<(() => string) | null>(null);
	let pageCreateNameInput = $state<HTMLInputElement | null>(null);

	// Announced result, mirroring `removeStatus`/`reorderStatus` above — the
	// "invisible success" half of the SPIKE finding: a create used to sort LAST
	// (`displayOrder: POSITIVE_INFINITY`, unchanged here — out of this fix's
	// scope) with nothing on screen saying a create even happened. role="status",
	// mounted from first render (a live region announces only CHANGES to its
	// contents).
	let pageCreateStatus = $state('');

	/** Pre-order flatten, same shape as SectionPicker's own `flatten` — the
	 *  parent `<select>`'s options and the sibling-scoped duplicate check both
	 *  walk this. Built off `visibleSections` (already filtered to the viewer's
	 *  own org, #124/F3) — a foreign org's section is never offered as a parent
	 *  (finding F2) and never blocks a same-named create (finding #10 B, same
	 *  discipline as SectionPicker's own org-scoped check). */
	function flattenSections(nodes: SectionNode[]): SectionNode[] {
		const out: SectionNode[] = [];
		for (const node of nodes) {
			out.push(node);
			out.push(...flattenSections(node.children));
		}
		return out;
	}
	const ownOrgFlatSections = $derived(flattenSections(visibleSections));

	/** Indent the parent `<select>`'s option labels so the tree shape survives a
	 *  flat option list — NBSP, since leading ordinary spaces collapse in
	 *  rendered option text (same fix as SectionPicker's `parentOptionLabel`). */
	function pageCreateParentLabel(node: SectionNode): string {
		return '  '.repeat(node.depth) + node.name;
	}

	function openPageCreateForm(): void {
		pageCreateName = '';
		pageCreateParentId = '';
		pageCreateError = null;
		pageCreateOpen = true;
	}

	function closePageCreateForm(): void {
		pageCreateOpen = false;
		pageCreateName = '';
		pageCreateParentId = '';
		pageCreateError = null;
	}

	// Same "Enter submits" affordance as SectionPicker's name input — this is not
	// wrapped in a <form>, so there is no implicit submit otherwise.
	function onPageCreateNameKeydown(event: KeyboardEvent): void {
		if (event.key !== 'Enter') return;
		event.preventDefault();
		void submitPageCreate();
	}

	async function submitPageCreate(): Promise<void> {
		// A fresh attempt owns both the error slot and the status slot — a
		// previous failure/success must not sit alongside a new attempt in flight.
		pageCreateError = null;
		pageCreateStatus = '';
		const name = pageCreateName.trim();
		if (!name) {
			pageCreateError = m.roster_section_name_required;
			return;
		}
		const parentId = pageCreateParentId === '' ? null : pageCreateParentId;
		// Sibling-scoped, not global (finding #10 root cause B) — siblings are the
		// chosen parent's DIRECT CHILDREN, or the top-level roots when parentId is
		// null. `ownOrgFlatSections` is already own-org-scoped (#124/F3), so
		// another org's same-named root never blocks this create.
		const isDuplicate = ownOrgFlatSections.some(
			(node) => node.parentId === parentId && node.name.toLowerCase() === name.toLowerCase()
		);
		if (isDuplicate) {
			pageCreateError = m.roster_section_duplicate;
			return;
		}

		const cfg = currentCfg;
		if (!cfg) {
			console.error('roster: page-level section create with no cfg', name, parentId);
			pageCreateError = m.roster_section_create_failed;
			return;
		}

		let newId: string;
		try {
			newId = await createSection(cfg, { name, parentId, dbEntityId: currentDbEntityId });
		} catch (e) {
			console.error('roster: page-level section create failed', name, parentId, e);
			pageCreateError = m.roster_section_create_failed;
			return;
		}

		// LOCAL insertion — same "never refetch" contract as `handleCreate` above.
		// There is no MEMBER context here (this is the page-level control, not a
		// picker pinned to one row) — `assignMemberSection` never fires.
		const depth = parentId ? (findSectionNode(sections, parentId)?.depth ?? 0) + 1 : 0;
		const newNode: SectionNode = {
			id: newId,
			name,
			displayOrder: Number.POSITIVE_INFINITY,
			parentId,
			// Mirrors what `listSections` would read back for it: a top-level
			// section is parented to the VIEWER's own org, a sub-section is
			// section-parented and carries no org `_parent` at all (v4E
			// `parentConstraint: 'exactly_one_of'`).
			dbEntityId: parentId ? null : (currentDbEntityId ?? null),
			depth,
			children: []
		};
		sections = insertSectionNode(sections, newNode, parentId);
		expandedIds = new Set(expandedIds).add(newId);
		pageCreateStatus = m.roster_section_created({ name });
		closePageCreateForm();
	}

	// Auto-focus the name input the instant the page-level form appears, same
	// contract as SectionPicker's own create form.
	$effect(() => {
		if (pageCreateOpen && pageCreateNameInput) pageCreateNameInput.focus();
	});

	// TS.4/#98 — drag-reorder on COLLAPSED section headers (admin only). ALL THREE
	// input paths (native HTML5 drop, touch long-press drag, keyboard up/down)
	// funnel into `performReorder`, which
	// does the SAME optimistic-and-reconcile as `handlePick` above: the tree is
	// patched immediately (`sections` is `$state`, `groups`/`groupById` are
	// `$derived` off it), `reorderSections` fires, and a rejection reverts to
	// the pre-move order and logs — no refetch of roster or sections either way.
	//
	// A "sibling group" is either the top-level `sections` array or one node's
	// `children` array — `siblingsOf` walks the live tree to find whichever one
	// holds a given id, so the same helpers work at any depth without the
	// caller tracking parentage explicitly.

	/** The live sibling array (top-level `sections`, or some node's `children`)
	 *  that currently holds `id` — null if `id` isn't anywhere in the tree. */
	function siblingsOf(nodes: SectionNode[], id: string): SectionNode[] | null {
		if (nodes.some((n) => n.id === id)) return nodes;
		for (const n of nodes) {
			const found = siblingsOf(n.children, id);
			if (found) return found;
		}
		return null;
	}

	/** #152 review F1 — the sibling group AS RENDERED, which is what every
	 *  reorder path must index, clamp, announce and write over.
	 *
	 *  `siblingsOf` walks the RAW `sections` tree, but the top level on screen is
	 *  `visibleSections`: `listSections` is not org-scoped and sections are
	 *  `_sharing: public`, so on a multi-collective db the raw top level also
	 *  holds roots belonging to OTHER collectives, which #124/F3 filters out of
	 *  the render entirely. Indexing the raw array therefore counts slots the
	 *  user can neither see nor reach — a keypress that appears to do nothing, an
	 *  announcement that contradicts the screen, and a `reorderSections` payload
	 *  that renumbers another collective's sections.
	 *
	 *  Only the ROOT level needs the filter: a sub-section carries no org
	 *  `_parent` of its own (v4E `parentConstraint: 'exactly_one_of'`), so a
	 *  rendered root's whole subtree is org-coherent by construction — the same
	 *  reasoning `visibleSections`/`rootDbEntityBySectionId` above already rest on. */
	function visibleSiblingsOf(id: string): SectionNode[] | null {
		const siblings = siblingsOf(sections, id);
		if (siblings === null) return null;
		// Identity, not a content test: `siblingsOf(sections, …)` returns the very
		// array it was handed when `id` is a root.
		return siblings === sections ? visibleSections : siblings;
	}

	/** Immutable reorder: whichever level holds ALL of `orderedIds` gets those
	 *  nodes rebuilt in that order (nodes themselves, incl. `children`, untouched
	 *  — only the array's order changes); every ancestor on the path down to it
	 *  is rebuilt too, so reassigning `sections` is enough to notify Svelte.
	 *
	 *  #152 review F1 — `orderedIds` may be a SUBSET of its level: a reorder now
	 *  carries only the VISIBLE siblings (`visibleSiblingsOf`), so a foreign
	 *  collective's root sitting in the same raw array is not part of the move.
	 *  Those nodes keep the slots they already occupy; only the listed ones are
	 *  permuted among the slots they held between them. */
	function applySiblingOrder(nodes: SectionNode[], orderedIds: string[]): SectionNode[] {
		const wanted = new Set(orderedIds);
		if (orderedIds.length > 0 && nodes.filter((n) => wanted.has(n.id)).length === orderedIds.length) {
			const byId = new Map(nodes.map((n) => [n.id, n]));
			let next = 0;
			return nodes.map((n) => (wanted.has(n.id) ? byId.get(orderedIds[next++])! : n));
		}
		return nodes.map((n) =>
			n.children.length === 0 ? n : { ...n, children: applySiblingOrder(n.children, orderedIds) }
		);
	}

	// F2 code-review fix (#98 review): an IN-FLIGHT GUARD on the reorder write.
	// `reorderSections` renumbers the WHOLE sibling group, so two overlapping
	// runs write the same entities: both GET a section's display_order before
	// either DELETEs, both then POST a new value and DELETE the same stale value
	// id — the second DELETE 404s, the section is left holding TWO display_order
	// values (the POST-appends multi-value trap), `listSections` reads
	// `display_order[0]`, and the order on next load is whichever value Entu
	// returns first. The throw also reverts the UI to a `beforeIds` that parts of
	// the second write already invalidated server-side, so the screen lies — and
	// this page never refetches, so both are permanent.
	//
	// Same fix as the programme reorder one slice earlier (#91 review F4, see
	// `handleMoveItem` in routes/+page.svelte): the key is the SIBLING GROUP, not
	// the row, because a reorder's blast radius is the whole group — and one
	// page-wide flag is that key here, since only one group can be mid-move at a
	// time on this page. The primary guard is the UI disabling the controls
	// (`draggable="false"` on the handle) so a double-tap is visibly refused
	// rather than silently swallowed; the early return below is the defensive
	// backstop for the paths the UI can't disable.
	let reorderPending = $state(false);

	// #99 review F2 — a failed reorder used to be SILENT to the user: the catch
	// path below logs, refetches, and swaps `sections`, so the list visibly snaps
	// to a different order (the server's partial truth) with nothing on screen
	// saying why, and a screen-reader user gets nothing at all. Every other write
	// path on this page surfaces `role="alert"` (section-write-error-*,
	// roster-load-error, roster-sections-load-error) — the reorder path, the one
	// TS.4 added, had none.
	let reorderError = $state(false);

	// #253 — a reparent is TWO writes (`_parent` move, then destination-group
	// renumber); `reorderError` alone can't say WHICH failed, and the two
	// outcomes need DIFFERENT copy: the move itself failing means nothing
	// landed (today's `roster_section_reorder_failed` stays exactly right),
	// but a landed move whose renumber then fails means the section IS at its
	// new parent — telling the user "the order couldn't be saved" as if
	// nothing happened would be a lie. True only when `performReparent`'s
	// `reorderSections` call (the renumber) is what rejected — never set by
	// `performReorder`'s own pure-reorder failures, which keep today's single
	// copy regardless (PO ruling #253: two banner states, not three). Reset at
	// the top of every fresh attempt in both write paths so a PREVIOUS
	// failure's state can never leak into a new one (no-cfg early-returns
	// included).
	let reparentPartial = $state(false);

	// #99 review F3 — the reorder path had no result announcement at all: a drag
	// moved the section, the DOM reordered silently, and a screen-reader user got
	// no confirmation anything happened beyond the drag's own aria-grabbed/
	// aria-dropeffect state. Rendered into a visually-hidden role="status"
	// region — see `roster-reorder-status` below.
	let reorderStatus = $state('');

	// F3 code-review fix (#98 review): a reorder write is NOT all-or-nothing, so a
	// blind revert can make the screen LIE. `reorderSections` renumbers the sibling
	// group SERIALLY and throws on the first non-2xx — every section written before
	// that throw keeps its NEW display_order server-side. Reverting the whole
	// optimistic order then puts the screen back to an order the server no longer
	// holds (e.g. Alto=1 landed, Soprano 403'd: the server sorts Alto first, the
	// screen shows Soprano first), and this page never refetches, so the two
	// disagree until the next full page load with nothing saying so.
	//
	// Fix: on failure STOP GUESSING — re-derive from the server. `listSections` is
	// the same read the page loaded with, so whatever partial state landed is what
	// renders. Guarded by `generation` (the collective-switch guard) so a refetch
	// resolving after a switch can't clobber the newer collective's tree. The
	// `beforeIds` revert survives only as the fallback for when the refetch ALSO
	// fails — at that point there is no server truth to be had, and the pre-move
	// order is the best available guess (logged loudly either way).
	//
	// #99 review F2/F3: the same run owns BOTH user-visible outcomes — the
	// `role="alert"` on failure and the `role="status"` announcement on success —
	// so every input path (native drop, touch drop) gets them for free.
	// `movedId` is the section the user acted on; it is what the announcement has
	// to name (`afterIds` alone can't say which one moved).
	//
	// Returns whether the write LANDED — false for a refused attempt (a write
	// already in flight, no cfg) as well as for a failed one. #152 review F2:
	// the keyboard drop path needs to tell "committed" from "announced
	// provisionally and then nothing happened" before it overwrites the live
	// region with its own committed-drop wording; `reorderError` alone can't say
	// that, since the early returns above leave it untouched or set it without a
	// request ever going out.
	async function performReorder(
		beforeIds: string[],
		afterIds: string[],
		movedId: string
	): Promise<boolean> {
		// #155/S4 review F1 — `structuralWritePending`, not `reorderPending` alone:
		// a rename or a delete started on a neighbouring arrange row is just as
		// much an outstanding write on this tree.
		if (structuralWritePending) return false;
		const cfg = currentCfg;
		if (!cfg) {
			console.error('roster: section reorder with no cfg', afterIds);
			reorderError = true;
			reparentPartial = false;
			return false;
		}
		const g = generation;
		reorderPending = true;
		// A fresh attempt owns both slots — a previous failure's alert must not
		// outlive the retry that fixed it, and a stale "moved to position 2" must
		// not sit in the live region while a new move is in flight. #253: this is
		// the PURE-reorder path — it never sets `reparentPartial`, so it always
		// renders today's one copy regardless of a previous reparent's state.
		reorderError = false;
		reparentPartial = false;
		reorderStatus = '';
		sections = applySiblingOrder(sections, afterIds);
		try {
			await reorderSections(cfg, afterIds);
			reorderStatus = m.roster_section_moved({
				name: findSectionNode(sections, movedId)?.name ?? movedId,
				position: afterIds.indexOf(movedId) + 1,
				total: afterIds.length
			});
			return true;
		} catch (e) {
			console.error('roster: section reorder failed', e);
			reorderError = true;
			try {
				const fresh = await listSections(cfg);
				if (g !== generation) return false; // superseded by a newer collective selection
				sections = fresh;
			} catch (refetchError) {
				console.error('roster: section refetch after a failed reorder failed', refetchError);
				if (g === generation) sections = applySiblingOrder(sections, beforeIds);
			}
		} finally {
			reorderPending = false;
		}
		return false;
	}

	// ── #155/S3 — indent/unindent (structural reparent, arrange mode) ──────────
	//
	// A DIFFERENT write from the reorder above: `reparentSection` changes a
	// section's `_parent` REFERENCE (which sibling group it belongs to), never
	// its `display_order` (position within one). Same in-flight guard
	// (`reorderPending` — one outstanding structural write at a time, reused
	// rather than a second flag, per the RED contract) and the same
	// `roster-reorder-status` live region / failure-reconcile shape as
	// `performReorder`, so every structural write on this page — reorder or
	// reparent — behaves identically to the user and to a screen reader.

	/** The immediate previous sibling AT THE SAME LEVEL, or null when `id` is
	 *  already first (nothing to nest under) or not found. `visibleSiblingsOf`
	 *  is the exact helper the reorder/drag paths use, so a top-level id is
	 *  scoped to the viewer's own collective the same way (#124/F3). */
	function prevSiblingId(id: string): string | null {
		const siblingIds = visibleSiblingsOf(id)?.map((n) => n.id) ?? [];
		const idx = siblingIds.indexOf(id);
		if (idx <= 0) return null;
		return siblingIds[idx - 1];
	}

	/** Indent guard: something to nest under. */
	function canIndent(id: string): boolean {
		return prevSiblingId(id) !== null;
	}

	/** Unindent guard: not already top-level (a top-level section's `parentId`
	 *  is null — its parent is the collective's database entity (#161), and there
	 *  is no level above that to promote to). */
	function canUnindent(id: string): boolean {
		return (findSectionNode(sections, id)?.parentId ?? null) !== null;
	}

	/** The one write seam both `handleIndent`/`handleUnindent` and the
	 *  ArrowRight/ArrowLeft keyboard branch funnel through — GET-POST-DELETE via
	 *  `reparentSection`, local tree patched optimistically first, reconciled
	 *  against the server (refetch via `listSections`) on failure exactly like
	 *  `performReorder` (#98 AC-8). Returns whether the write landed, same
	 *  contract as `performReorder`.
	 *
	 *  #155/S3 review F2 — a reparent is TWO writes, not one. `reparentSection`
	 *  moves `_parent`, and that is all it moves: the section keeps whatever
	 *  `display_order` it held in its OLD sibling group, which is a number that
	 *  means nothing among its NEW siblings. `listSections` sorts every level by
	 *  `displayOrder` (name as tie-break, sectionData.ts pass 5), so without a
	 *  renumber the POSITION on screen is a lie that survives only until the next
	 *  full load — indent Alto (display_order 2) under Soprano ▸ [Soprano 1 = 1,
	 *  Soprano 2 = 2] shows and announces "last child", and reloads as
	 *  [Soprano 1, Alto, Soprano 2]. So the reparent is followed by ONE
	 *  `reorderSections` over the DESTINATION sibling group, in the order the
	 *  freshly-patched local tree holds it (`visibleSiblingsOf` — the group AS
	 *  RENDERED, #152 review F1, which is `visibleSections` for a promote-to-org
	 *  and the new parent's `children` for everything else). The SOURCE group is
	 *  deliberately left alone: pulling a node out leaves a GAP in its old
	 *  numbering (1, 3, 4), and a gap sorts identically to a dense run.
	 *
	 *  Both writes live inside the one `reorderPending` guard and the one
	 *  catch: a renumber that fails after the `_parent` landed is exactly the
	 *  partial state #98/F3 built the `listSections` reconcile for — the screen
	 *  re-derives from the server rather than guessing. */
	async function performReparent(
		node: SectionNode,
		target: ReparentTarget,
		insertAfterId: string | null,
		announce: () => string
	): Promise<boolean> {
		// #155/S4 review F1 — see `performReorder`: one structural write at a time,
		// counting rename and delete.
		if (structuralWritePending) return false;
		const cfg = currentCfg;
		if (!cfg) {
			console.error('roster: section reparent with no cfg', node.id);
			reorderError = true;
			reparentPartial = false;
			return false;
		}
		const g = generation;
		reorderPending = true;
		reorderError = false;
		reparentPartial = false;
		reorderStatus = '';
		const before = sections;
		sections = applyReparent(sections, node.id, target, insertAfterId);
		const newParentId = target.kind === 'org' ? target.dbEntityId : target.sectionId;
		// #253 review F1 — the banner state is decided by WHICH PHASE we were in
		// when the rejection arrived, NOT by the rejection's shape. `reorderSections`
		// can reject untyped after the `_parent` move already landed (a network
		// rejection propagated verbatim by `entuFetch`, a SyntaxError from a
		// malformed body, an `AuthExpiredError` on a 401) — every one of those
		// leaves the section AT ITS NEW PARENT, so a type-gated decision would show
		// "the order couldn't be saved" over a screen that shows the move.
		let moveLanded = false;
		try {
			await reparentSection(cfg, node.id, newParentId);
			moveLanded = true;
			// Read AFTER the optimistic patch above: this is the destination group
			// in its new on-screen order, including the moved section itself.
			const destinationIds = visibleSiblingsOf(node.id)?.map((n) => n.id) ?? [];
			if (destinationIds.length > 0) await reorderSections(cfg, destinationIds);
			reorderStatus = announce();
			return true;
		} catch (e) {
			// #253 — full typed-error evidence (status + response body, when the
			// rejection carries them) logged where a human can read it after the
			// fact; `e` itself, not a stringified summary, so the object's fields
			// stay inspectable. Two failure phases: `reparentSection` rejecting
			// means NOTHING landed (`moveLanded` still false — today's copy is
			// correct); anything rejecting after it resolved means the `_parent`
			// move ALREADY landed and only the renumber failed — the section DID
			// move, so the banner must say so, whatever shape that rejection has.
			// The typed fields (step, k-of-N, status, body) are DIAGNOSIS ONLY:
			// they ride along in the logged `e` and decide nothing on screen. No
			// retry, no automatic unwind either way (PO #253 refusals) — the catch
			// below is the SAME single refetch-reconcile + snapshot fallback
			// `performReorder` uses, untouched.
			console.error('roster: section reparent failed', e);
			reorderError = true;
			reparentPartial = moveLanded;
			try {
				const fresh = await listSections(cfg);
				if (g !== generation) return false; // superseded by a newer collective selection
				sections = fresh;
			} catch (refetchError) {
				console.error('roster: section refetch after a failed reparent failed', refetchError);
				if (g === generation) sections = before;
			}
		} finally {
			reorderPending = false;
		}
		return false;
	}

	/** INDENT: nest `node` under its immediate previous sibling, as that
	 *  sibling's LAST child (`insertAfterId: null` → append). Refuses silently
	 *  when there's no previous sibling (guard already gates the button/key). */
	async function handleIndent(node: SectionNode): Promise<void> {
		const prevId = prevSiblingId(node.id);
		if (prevId === null) return;
		const parentName = findSectionNode(sections, prevId)?.name ?? '';
		await performReparent(node, { kind: 'section', sectionId: prevId }, null, () =>
			m.roster_section_indented({ name: node.name, parentName })
		);
	}

	/** UNINDENT: promote `node` one level — to its parent's own parent (a
	 *  section), or to the ORGANIZATION when the parent is already top-level.
	 *  Lands right after the former parent among the new siblings
	 *  (`insertAfterId: parent.id`). Refuses silently when `node` is already
	 *  top-level (no parent to promote FROM). */
	async function handleUnindent(node: SectionNode): Promise<void> {
		if (node.parentId === null) return;
		const parent = findSectionNode(sections, node.parentId);
		if (!parent) return;
		if (parent.parentId === null) {
			// The parent is top-level — promoting past it lands on the collective's database entity (#161).
			const dbEntityId = parent.dbEntityId ?? currentDbEntityId;
			if (!dbEntityId) {
				// #155/S3 review F3 — this used to log and return SILENTLY while the
				// button stayed ENABLED (`canUnindent` only asks whether there IS a
				// parent, not whether the promote target is resolvable): the user
				// tapped a live control, nothing moved, nothing was announced, no
				// banner appeared. Reachable whenever no visible root carries an
				// `dbEntityId` — the same permissive-when-unknown state `visibleSections`
				// deliberately tolerates. Every other failure on this page raises
				// `reorderError` (the role="alert" banner above the groups), and so
				// does this one now: fail loudly over silent degradation, same shape
				// as `performReparent`'s own no-cfg path.
				console.error('roster: unindent to top level with no known collective (database entity) id', node.id);
				reorderError = true;
				reparentPartial = false;
				return;
			}
			await performReparent(node, { kind: 'org', dbEntityId }, parent.id, () =>
				m.roster_section_unindented_top({ name: node.name })
			);
			return;
		}
		const grandParentId = parent.parentId;
		const grandParentName = findSectionNode(sections, grandParentId)?.name ?? '';
		await performReparent(node, { kind: 'section', sectionId: grandParentId }, parent.id, () =>
			m.roster_section_unindented({ name: node.name, parentName: grandParentName })
		);
	}

	// ── #155/S4 — inline RENAME (arrange mode only) ─────────────────────────────
	//
	// "Tap the name → it turns into a text input → Enter saves → Escape
	// cancels" (issue #155). Only ONE row can be renaming at a time
	// (`renamingSectionId`), same single-flight posture as the grab/drag state
	// machines above. The row stays draggable=false and its own grab/keydown
	// machinery is bypassed while renaming — see the template's guards.

	let renamingSectionId = $state<string | null>(null);
	let renameValue = $state('');
	let renamePending = $state(false);
	// A fresh attempt owns the slot — a previous failure must not outlive the
	// retry that fixed it (same discipline as `sectionWriteError`/`removeError`).
	let renameError = $state<{ id: string; name: string } | null>(null);
	let renameInputEl = $state<HTMLInputElement | null>(null);
	// Announced result — same "invisible success" concern `pageCreateStatus`/
	// `removeStatus` exist for: a rename that silently succeeds says nothing to
	// a screen-reader user.
	let renameStatus = $state('');

	// ── #155/S4 review F1 — the single-flight set ───────────────────────────────
	//
	// ONE structural write on the section tree at a time, whichever control
	// started it. `reorderPending` (reorder + reparent), `renamePending` and
	// `removePending` used to guard only themselves, which was harmless while the
	// controls lived in different views: before S4, delete rendered only in
	// collapsed/expanded and indent/unindent only in arrange, so two of them could
	// never be on screen together. S4 puts rename, delete, indent and unindent
	// side by side on every arrange row — so a rename could be started over an
	// outstanding reorder, a delete over an outstanding rename, and each one's
	// failure path would then restore a tree snapshot taken before the other's
	// write, silently discarding it.
	//
	// Every one of the four controls' `disabled` reads this, and every write seam
	// (`performReorder`, `performReparent`, `handleRemoveSection`, `submitRename`)
	// refuses on it as the defensive backstop.
	const structuralWritePending = $derived(reorderPending || renamePending || removePending);

	function startRename(node: SectionNode): void {
		if (structuralWritePending) return; // one structural write at a time
		renameError = null;
		renameStatus = '';
		renamingSectionId = node.id;
		renameValue = node.name;
	}

	async function cancelRename(): Promise<void> {
		const id = renamingSectionId;
		renamingSectionId = null;
		renameValue = '';
		await tick();
		if (id) document.querySelector<HTMLElement>(`[data-testid="arrange-rename-${id}"]`)?.focus();
	}

	async function submitRename(): Promise<void> {
		const id = renamingSectionId;
		if (id === null) return;
		const name = renameValue.trim();
		if (!name) {
			// Empty name — same "nothing written" refusal as a blank create; the
			// input just stays open for the user to fix or Escape out of.
			return;
		}
		// #155/S4 review F1 — another structural write is outstanding (a reorder or
		// reparent started on a NEIGHBOURING row, which stays live while this input
		// is open). Refuse the same way a blank value is refused: nothing written,
		// the input stays open for the user to retry or Escape out of — never a
		// silent discard of what they typed.
		if (structuralWritePending) return;
		const cfg = currentCfg;
		if (!cfg) {
			console.error('roster: section rename with no cfg', id);
			renameError = { id, name };
			return;
		}
		// #155/S4 review F1 — the collective-switch guard `performReparent` carries,
		// for the same reason: a reconcile resolving after a switch must not clobber
		// the newer collective's tree.
		const g = generation;
		const before = sections;
		renamePending = true;
		renamingSectionId = null;
		sections = renameSectionNode(sections, id, name);
		try {
			await renameSection(cfg, id, name);
			renameStatus = m.roster_section_renamed({ name });
		} catch (e) {
			console.error('roster: section rename failed', id, e);
			// #155/S4 review F1 — re-derive from the server rather than blind-
			// restoring a pre-write snapshot (the #98/F3 reconcile `performReorder`
			// and `performReparent` already use). `renameSection` is a replace, i.e.
			// GET → POST → DELETE: a rejection can leave the old and the new value
			// BOTH present server-side, which the snapshot cannot represent either.
			// The snapshot survives only as the fallback for when the refetch ALSO
			// fails.
			try {
				const fresh = await listSections(cfg);
				if (g !== generation) return; // superseded by a newer collective selection
				sections = fresh;
			} catch (refetchError) {
				console.error('roster: section refetch after a failed rename failed', refetchError);
				if (g !== generation) return;
				sections = before;
			}
			renameError = { id, name };
		} finally {
			renamePending = false;
			// The rename input unmounts the instant `renamingSectionId` cleared
			// above — same WCAG 2.4.3 concern `armRemove`/`disarmRemove` already
			// carry on this page: land focus back on the trigger that opened it,
			// success or failure alike, rather than dropping it to <body>.
			await tick();
			document.querySelector<HTMLElement>(`[data-testid="arrange-rename-${id}"]`)?.focus();
		}
	}

	function onRenameKeydown(event: KeyboardEvent): void {
		// Never let the rename input's own keys reach the row's grab/reorder
		// keydown machine (Space/Enter grab, arrows move, Escape cancel-grab) —
		// the input has its own, incompatible, meaning for every one of those.
		event.stopPropagation();
		if (event.key === 'Enter') {
			event.preventDefault();
			void submitRename();
		} else if (event.key === 'Escape') {
			event.preventDefault();
			void cancelRename();
		}
	}

	// Auto-focus + select the input the instant rename mode opens, same
	// contract as the page-level create form's name input.
	$effect(() => {
		if (renamingSectionId !== null && renameInputEl) {
			renameInputEl.focus();
			renameInputEl.select();
		}
	});

	// Drag source, tracked between dragstart and drop. #99/TS.5 — now `$state`
	// (was a plain variable, read only at drop time): the drag handle's
	// `aria-grabbed` and the sibling headers' `aria-dropeffect` both need to
	// reflect it live, in the DOM, the instant a drag starts/ends — not just at
	// the moment of drop.
	let draggedSectionId = $state<string | null>(null);

	// TU.2/#110 (finding #11) — the section currently under the drag, native
	// path only (`handleDragOver` below); the touch long-press path already has
	// its own equivalent (`touchOverId`). Drives the dashed drop-target hint in
	// `sectionGroup`'s `showDropIndicator`. Cleared on dragend AND on drop —
	// synthetic test drops don't always fire a trailing dragend, so both paths
	// own the clear (see `handleDragEnd`/`handleDrop`).
	let dragOverId = $state<string | null>(null);

	// F1 code-review fix (#98 review): a dragstart handler MUST populate the drag
	// data store. Firefox refuses to START a drag session at all when the store is
	// left empty — dragstart fires, then no dragover/drop ever follows, so the
	// whole drop path was dead there. `draggedSectionId` stays the source of
	// truth on drop — it survives the cross-handler hop just as it did before;
	// `setData` is here to satisfy the browser's drag-initiation precondition,
	// not to carry state.
	function handleDragStart(id: string, event: DragEvent): void {
		draggedSectionId = id;
		dragOverId = null; // a fresh drag owns its own hover trail, not a stale one
		if (event.dataTransfer) {
			event.dataTransfer.setData('text/plain', id);
			event.dataTransfer.effectAllowed = 'move';
		}
	}

	// F1 code-review fix (#98 review): `dragend` ALWAYS fires — including on an
	// aborted drag (Esc, or a release outside any drop zone), where `drop` never
	// does. Without it `draggedSectionId` outlived its drag and stayed live
	// forever, arming the next drop that reached a header with a stale source id.
	function handleDragEnd(): void {
		draggedSectionId = null;
		dragOverId = null; // TU.2/#110 finding #11 — no stale hint after an aborted drag
	}

	function handleDragOver(id: string, event: DragEvent): void {
		// F1 code-review fix (#98 review): accept the drop ONLY while one of OUR
		// section handles is being dragged. `preventDefault()` is what MAKES an
		// element a drop zone, so calling it unconditionally turned every collapsed
		// admin header into a drop target for ANY drag — a file, a selection, a link
		// from another window — and the resulting `drop` then reordered against
		// whatever `draggedSectionId` happened to hold. Bail BEFORE preventDefault:
		// a foreign drag must never be accepted as a drop in the first place.
		if (draggedSectionId === null) return;
		// Permits the drop in real browsers (a DragEvent target is not a drop
		// zone by default); harmless no-op under the test harness's synthetic events.
		event.preventDefault();
		// Move cursor rather than the default copy affordance.
		if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
		// TU.2/#110 (finding #11) — this header is now the drop-target hint's
		// home; the binding (`ondragover={acceptsDrop ? ... : undefined}`) already
		// restricts calls here to valid sibling targets, so `id` is always a legal
		// hover target.
		dragOverId = id;
	}

	// #110 review F4 — the hint has to LEAVE when the cursor does. `dragOverId` was
	// only ever cleared on dragstart/dragend/drop, so moving off a sibling header
	// into a non-target area (the gap between groups, a member row, the page
	// margin) left the dashed line pinned to the last hovered header for the rest
	// of the drag — promising a landing slot a release right there would not
	// produce. Guarded on the id: `dragleave` on the header being left fires AFTER
	// `dragenter`/`dragover` on the header being entered, so an unguarded clear
	// would blank a hint that had just legitimately moved.
	function handleDragLeave(id: string, event: DragEvent): void {
		if (dragOverId !== id) return;
		// `dragleave` BUBBLES, so a pointer travelling between this header's own
		// descendants (the toggle button, the name span, the drag handle) reports
		// one too. Only a leave whose destination is OUTSIDE the header row counts
		// — otherwise the hint flickers off and back on across every internal hop.
		// (`relatedTarget` is null when the pointer leaves for nothing, and under
		// the synthetic events of the test harness; both mean "gone".)
		const row = event.currentTarget as HTMLElement | null;
		const to = event.relatedTarget as Node | null;
		if (row && to && row.contains(to)) return;
		dragOverId = null;
	}

	/** The shared reorder computation behind BOTH pointer paths (native HTML5 drop
	 *  and the touch long-press drag below): "the dragged section takes the drop
	 *  target's ORIGINAL position". Silently does nothing for a non-sibling target
	 *  (a sub-section dropped on a top-level header is a STRUCTURAL move, not an
	 *  order change — #98) or a self-drop. */
	function dropOnto(fromId: string, targetId: string): void {
		if (!fromId || fromId === targetId) return;

		// #152 review F1 — the RENDERED sibling group (see `visibleSiblingsOf`):
		// a foreign collective's root is not a slot the pointer can land on
		// either, and must never end up in the `reorderSections` payload.
		const siblingNodes = visibleSiblingsOf(fromId);
		if (!siblingNodes) return;
		const siblingIds = siblingNodes.map((n) => n.id);
		const targetIndex = siblingIds.indexOf(targetId);
		if (targetIndex === -1) return;

		// Drop it back in at `targetId`'s pre-removal index (clamped to the
		// shortened array's length so a drop past the end still lands last).
		const withoutFrom = siblingIds.filter((id) => id !== fromId);
		const insertAt = Math.min(targetIndex, withoutFrom.length);
		const afterIds = [...withoutFrom.slice(0, insertAt), fromId, ...withoutFrom.slice(insertAt)];
		void performReorder(siblingIds, afterIds, fromId);
	}

	function handleDrop(targetId: string, event: DragEvent): void {
		const fromId = draggedSectionId;
		draggedSectionId = null;
		dragOverId = null; // TU.2/#110 finding #11 — the hint doesn't outlive the drop
		// Backstop only, now that `handleDragOver` refuses to accept foreign drags:
		// no live internal drag → not our drop, so don't even swallow the browser's
		// default handling of it.
		if (!fromId) return;
		event.preventDefault();
		dropOnto(fromId, targetId);
	}

	// F2 code-review fix (#98 review): TOUCH drag-reorder. Native HTML5 `draggable`
	// is a POINTER-ONLY protocol — a long-press on a `draggable="true"` element does
	// not synthesise `dragstart` on Android Chrome or iOS Safari — so on a page this
	// mobile-shaped (`max-w-md`) the drag half of #98's "works on mobile (long-press)
	// and desktop" was simply absent. This is the pointer-event twin of the native
	// path: long-press to pick up, move to hit-test sibling headers, release to drop.
	// Only the INPUT layer is new — it funnels into the same `dropOnto` the native
	// drop does, so both paths share one set of reorder semantics.
	//
	// Mouse pointers are deliberately EXCLUDED: the native path already owns them
	// (and its `dragstart` would otherwise race this one on the same gesture).
	const LONG_PRESS_MS = 400;
	/** Finger drift (px) that cancels a pending long-press — that gesture was a scroll. */
	const LONG_PRESS_SLOP_PX = 10;

	// Active touch drag (both `$state` — unlike `draggedSectionId` these DO drive a
	// render: the picked-up handle and the hovered target both need an affordance,
	// since a touch drag has no browser-drawn drag image).
	let touchDragId = $state<string | null>(null);
	let touchOverId = $state<string | null>(null);
	// Pending-press bookkeeping — read at gesture time, never rendered.
	let longPressTimer: ReturnType<typeof setTimeout> | null = null;
	let pressOrigin: { x: number; y: number } | null = null;
	let pressHandle: HTMLElement | null = null;
	let pressPointerId: number | null = null;

	/** Drop every trace of an in-progress or pending touch drag. Idempotent — it is
	 *  the single teardown for success, cancel, abort and pointer loss alike. */
	function endTouchDrag(): void {
		if (longPressTimer !== null) {
			clearTimeout(longPressTimer);
			longPressTimer = null;
		}
		if (pressHandle && pressPointerId !== null) {
			// Releasing an uncaptured pointer throws in some engines — the capture is
			// best-effort (touch pointers are implicitly captured anyway).
			try {
				if (pressHandle.hasPointerCapture?.(pressPointerId)) {
					pressHandle.releasePointerCapture(pressPointerId);
				}
			} catch {
				/* nothing to release */
			}
		}
		pressOrigin = null;
		pressHandle = null;
		pressPointerId = null;
		touchDragId = null;
		touchOverId = null;
	}

	/** Hit-test: which SECTION group's header is under this point, if any. Returns
	 *  the innermost match (sub-sections render nested inside their parent's
	 *  `<section>`), and never the Unassigned pseudo-group — it is not a section
	 *  entity and always sorts last (#98). */
	function sectionIdUnderPointer(x: number, y: number): string | null {
		// #155/S2 — arrange mode has no `section-group-*` wrapper at all (its
		// ROWS are the drop target, not a handle's containing group), so the
		// touch hit test also recognises `arrange-row-*`.
		// #205 review F3 — …and `data-drop-row`, the arrange row's LAYOUT wrapper.
		// The rename activator is a SIBLING of `arrange-row-*`, not a descendant,
		// so once it grew to cover the name column a finger over it resolved to
		// null here — `touchOverId` dropped mid-gesture and the release was
		// discarded. The wrapper spans the whole visual row (row + action
		// cluster) and carries the same id, which is also where the native
		// `ondrop` now lives, so both pointer paths agree on the target.
		const under = document.elementFromPoint?.(x, y);
		const match =
			under?.closest(
				'[data-testid^="section-group-"], [data-testid^="arrange-row-"], [data-drop-row]'
			) ?? null;
		const testid = match?.getAttribute('data-testid') ?? '';
		const id = testid.startsWith('arrange-row-')
			? testid.slice('arrange-row-'.length)
			: testid.startsWith('section-group-')
				? testid.slice('section-group-'.length)
				: (match?.getAttribute('data-drop-row') ?? '');
		return id && id !== 'unassigned' ? id : null;
	}

	function handlePointerDown(id: string, event: PointerEvent): void {
		if (event.pointerType === 'mouse') return; // the native dnd path owns mouse
		if (structuralWritePending) return; // same in-flight refusal as `draggable="false"`
		endTouchDrag();
		// Derived from `target`, not `currentTarget`: Svelte 5 DELEGATES pointer
		// events from the root, so `currentTarget` is a patched property rather than
		// the real one — `closest` off the actual target is the version that cannot
		// be wrong.
		// #155/S2 — arrange mode has no `section-drag-handle-*`; its touch pickup
		// zone is the narrow `arrange-grip-*` bar at the head of each row (review
		// F4 — the row itself keeps `touch-action: pan-y` so the list still
		// scrolls under a finger, so only the grip can start a drag).
		const handle = (event.target as HTMLElement | null)?.closest?.(
			'[data-testid^="section-drag-handle-"], [data-testid^="arrange-grip-"]'
		) as HTMLElement | null;
		if (!handle) return;
		pressHandle = handle;
		pressPointerId = event.pointerId;
		pressOrigin = { x: event.clientX, y: event.clientY };
		longPressTimer = setTimeout(() => {
			longPressTimer = null;
			touchDragId = id;
			touchOverId = id;
			try {
				handle.setPointerCapture(pressPointerId as number);
			} catch {
				/* pointer already gone — the implicit touch capture still routes moves here */
			}
		}, LONG_PRESS_MS);
	}

	function handlePointerMove(event: PointerEvent): void {
		if (touchDragId === null) {
			// Still in the long-press window: drift past the slop means the user is
			// scrolling, not picking a section up.
			if (longPressTimer === null || !pressOrigin) return;
			const dx = event.clientX - pressOrigin.x;
			const dy = event.clientY - pressOrigin.y;
			if (Math.hypot(dx, dy) > LONG_PRESS_SLOP_PX) endTouchDrag();
			return;
		}
		// Picked up — this gesture is a drag now, not a scroll.
		event.preventDefault();
		touchOverId = sectionIdUnderPointer(event.clientX, event.clientY);
	}

	function handlePointerUp(event: PointerEvent): void {
		const fromId = touchDragId;
		if (fromId === null) {
			endTouchDrag(); // a plain tap (or an abandoned press) — nothing to drop
			return;
		}
		// Prefer the release point; fall back to the last hovered header for engines
		// that report a released pointer as over nothing.
		const targetId = sectionIdUnderPointer(event.clientX, event.clientY) ?? touchOverId;
		endTouchDrag();
		if (targetId) dropOnto(fromId, targetId);
	}

	// #150 — the up/down arrow buttons that used to live here (`reorderButton`/
	// `moveSection`) are gone; the drag handle below is now the only reorder
	// input. That leaves this page with NO keyboard-operable reorder path (the
	// handle is deliberately `tabindex="-1"`, see the drag handle rendering) —
	// an open a11y gap, not a design decision made here. Tracked in #152:
	// restore a keyboard path on the handle itself (roving tabindex +
	// ArrowUp/ArrowDown + Space to grab), reusing `performReorder` and the
	// `roster-reorder-status` live region, which already announce the outcome.

	// #152 — keyboard section reorder on the drag handle (WCAG 2.1.1). A
	// SEPARATE input path from the native/touch drag handlers above (those are
	// untouched) that funnels its own commit through the SAME `performReorder`
	// write seam and the same `roster-reorder-status` live region, so a write —
	// drag, touch, or keyboard — is always reconciled and announced identically.
	//
	// `grabbedSectionId` is this state machine's own flag (idle ⇄ grabbed),
	// independent of the drag path's `draggedSectionId` — a keyboard grab and a
	// pointer drag never occur on the same gesture, but nothing here assumes
	// that; `aria-grabbed` on a handle is true when EITHER path holds it (see
	// the handle's template below).
	let grabbedSectionId = $state<string | null>(null);
	// Non-reactive — the pre-grab sibling order, snapshotted once at grab time
	// so Escape can restore it exactly regardless of how many provisional
	// moves happened in between. Never drives a render on its own.
	let grabSiblingIds: string[] | null = null;
	// Non-reactive — true only for the instant a PROVISIONAL move is re-homing
	// focus onto the moved handle. Reordering the tree MOVES that handle's
	// element in the DOM, which blurs it; `handleHandleBlur` below must not read
	// that as the user leaving the control (see #152 review F2).
	let grabRefocusPending = false;

	// Roving tabindex — one handle in the Tab order at a time.
	// `reorderableHandleIds` walks the SAME collapsed/expanded shape the
	// template renders (a node contributes its own handle when COLLAPSED, else
	// its children are walked instead of it — mirrors `canReorder`/`isExpanded`
	// in `sectionGroup` exactly), so this is always "every handle actually on
	// screen", in document order.
	const reorderableHandleIds = $derived.by(() => {
		if (admin !== 'admin') return [] as string[];
		const ids: string[] = [];
		function walk(nodes: SectionNode[]): void {
			for (const n of nodes) {
				if (expandedIds.has(n.id)) walk(n.children);
				else ids.push(n.id);
			}
		}
		walk(visibleSections);
		return ids;
	});
	let rovingHandleId = $state<string | null>(null);
	/** The handle currently at tabindex="0" — `rovingHandleId` when it still
	 *  names a rendered handle, else the first rendered one (covers the
	 *  initial render, and a roving id that vanished from under it via an
	 *  expand/collapse elsewhere on the page). */
	const activeHandleId = $derived(
		rovingHandleId !== null && reorderableHandleIds.includes(rovingHandleId)
			? rovingHandleId
			: (reorderableHandleIds[0] ?? null)
	);

	function handleElementFor(id: string): HTMLElement | null {
		// #155/S2 — arrange mode's whole ROW is a second possible home for this
		// same refocus lookup; only one of the two ever renders at a time
		// (`viewMode` picks exactly one UI), so trying both selectors in order
		// is unambiguous.
		return (
			document.querySelector<HTMLElement>(`[data-testid="section-drag-handle-${id}"]`) ??
			document.querySelector<HTMLElement>(`[data-testid="arrange-row-${id}"]`)
		);
	}

	/** IDLE-state ArrowUp/ArrowDown: move the roving tabindex to the
	 *  next/previous reorderable handle and focus it. Clamps at either end (no
	 *  wrap) — ArrowUp/ArrowDown while GRABBED is a completely different
	 *  branch, below, and never calls this. */
	function moveFocus(direction: 1 | -1): void {
		// #155/S2 — arrange mode's rows are a SEPARATE reorderable set (every
		// row is on screen regardless of collapse state, unlike the
		// collapsed-only `reorderableHandleIds`), so idle-state Up/Down roves
		// whichever list is actually rendered.
		const ids = viewMode === 'arrange' ? arrangeReorderableIds : reorderableHandleIds;
		const currentId = viewMode === 'arrange' ? activeArrangeRowId : activeHandleId;
		if (currentId === null) return;
		const idx = ids.indexOf(currentId);
		const nextIdx = idx + direction;
		if (idx === -1 || nextIdx < 0 || nextIdx >= ids.length) return;
		const nextId = ids[nextIdx];
		rovingHandleId = nextId;
		tick().then(() => handleElementFor(nextId)?.focus());
	}

	/** Grab ⇄ drop, the one place the toggle lives.
	 *
	 *  #152 review F1 — `role="button"` promises ACTIVATION, and activation does
	 *  not always arrive as a keydown. NVDA/JAWS browse-mode Enter/Space on a
	 *  role="button" synthesises a `click`; TalkBack/VoiceOver double-tap fires a
	 *  click; Voice Control / Dragon ("click Reorder Soprano") fires a click.
	 *  Wiring the toggle to keydown alone left every one of those users with a
	 *  control that announces itself as a button and then does nothing — the
	 *  4.1.2 half of the promise unmet even though 2.1.1 (sighted keyboard) was
	 *  satisfied. Both `onkeydown` and `onclick` now funnel here, so the grab
	 *  state machine has exactly one implementation.
	 *
	 *  Grab is refused while `reorderPending` (#4 — no new grab over an
	 *  outstanding write). Drop commits through `performReorder` — the SAME seam
	 *  the drag path writes through — and only when the order actually changed;
	 *  a drop back in place writes nothing. */
	async function toggleGrab(node: SectionNode): Promise<void> {
		// Belt-and-braces, same guard `handleHandleKeydown` applies: a handle that
		// does not own the grab never drives the state machine.
		if (grabbedSectionId !== null && grabbedSectionId !== node.id) return;

		if (grabbedSectionId === null) {
			if (structuralWritePending) return;
			grabbedSectionId = node.id;
			grabSiblingIds = visibleSiblingsOf(node.id)?.map((n) => n.id) ?? [node.id];
			rovingHandleId = node.id;
			reorderStatus = m.roster_section_grabbed({ name: node.name });
			return;
		}

		const before = grabSiblingIds ?? [];
		const after = visibleSiblingsOf(node.id)?.map((n) => n.id) ?? before;
		grabbedSectionId = null;
		grabSiblingIds = null;
		if (before.length === after.length && before.every((id, i) => id === after[i])) {
			// Dropped back in place — nothing to write, but still worth saying so.
			reorderStatus = m.roster_section_dropped({
				name: node.name,
				position: after.indexOf(node.id) + 1,
				total: after.length
			});
			return;
		}
		// #152 review F2 — "moved" is the PROVISIONAL word (what an arrow press
		// announces), "dropped" is the COMMITTED one. `performReorder` announces
		// `roster_section_moved` for the drag path, where there is no provisional
		// step and "moved" IS the commit; on this path that string has already
		// been in the live region since the arrow press, so re-announcing it
		// would make "saved" indistinguishable from "not saved yet". Only a write
		// that actually landed earns the overwrite — a failure leaves
		// `performReorder`'s own error handling (role="alert" + refetch) to speak.
		const wrote = await performReorder(before, after, node.id);
		if (!wrote) return;
		const committed = visibleSiblingsOf(node.id)?.map((n) => n.id) ?? after;
		reorderStatus = m.roster_section_dropped({
			name: node.name,
			position: committed.indexOf(node.id) + 1,
			total: committed.length
		});
	}

	/** The keyboard state machine for one handle.
	 *
	 *  Idle (`grabbedSectionId === null`): Space/Enter grabs (refused while
	 *  `reorderPending`); ArrowUp/ArrowDown rove focus between handles.
	 *
	 *  Grabbed: ArrowUp/ArrowDown move the section one SIBLING slot per press
	 *  — PROVISIONAL (the local tree reorders, focus follows the moved handle,
	 *  the move is announced, but nothing is written yet), clamped at either
	 *  end; Space/Enter drops (`toggleGrab`) — commits through `performReorder`
	 *  (the SAME write seam and `roster-reorder-status` region the drag path
	 *  uses) only when the order actually changed, a no-op drop writes nothing,
	 *  and the committed drop is announced with its OWN wording so "saved"
	 *  never sounds like the provisional "moved" (#152 review F2); Escape
	 *  cancels — restores the pre-grab order from `grabSiblingIds`, announces,
	 *  never writes.
	 *
	 *  `visibleSiblingsOf` is the exact helper `dropOnto` (the drag path) also
	 *  uses, so a keyboard move can never escape its own sibling group (a
	 *  sub-section's parent's `children`, or the top-level list AS RENDERED —
	 *  #152 review F1) — the Unassigned pseudo-group is never reachable either
	 *  way, since it isn't part of the `sections` tree `siblingsOf` walks. */
	async function handleHandleKeydown(node: SectionNode, event: KeyboardEvent): Promise<void> {
		// #155/S3 review F1 — only a keydown on the handle ITSELF drives this state
		// machine; one from a descendant control is that control's business. The
		// idle branch below `preventDefault()`s Space/Enter, which would SUPPRESS a
		// nested control's own native activation — a keyboard user pressing it
		// would grab the row instead (WCAG 2.1.1 / predictable activation), and
		// ArrowUp/ArrowDown would rove focus off it.
		// The indent/unindent buttons no longer rely on this: review R2/F1 moved
		// them OUT of the row's subtree entirely (they are siblings now), so
		// nothing they emit reaches here in the first place. The guard stays as
		// belt-and-braces, and it covers the grouped-view handle for free.
		if (event.target !== event.currentTarget) return;

		const key = event.key;

		// #152 review F2 (belt-and-braces) — the grabbed branch below assumes it
		// is acting on the grabbed section. Never let a handle that does NOT own
		// the grab drive the state machine, whatever put focus there.
		if (grabbedSectionId !== null && grabbedSectionId !== node.id) return;

		if (grabbedSectionId === null) {
			if (key === ' ' || key === 'Enter') {
				event.preventDefault();
				await toggleGrab(node);
				return;
			}
			if (key === 'ArrowDown') {
				event.preventDefault();
				moveFocus(1);
				return;
			}
			if (key === 'ArrowUp') {
				event.preventDefault();
				moveFocus(-1);
			}
			return;
		}

		// Grabbed — every branch below acts on THIS node's own section, which is
		// always the grabbed one: focus follows the grab throughout, losing focus
		// CANCELS it (`handleHandleBlur`), and the guard at the top of this
		// function refuses a handle that does not own the grab either way.
		if (key === 'ArrowUp' || key === 'ArrowDown') {
			event.preventDefault();
			const siblingIds = visibleSiblingsOf(node.id)?.map((n) => n.id) ?? [];
			const idx = siblingIds.indexOf(node.id);
			const nextIdx = idx + (key === 'ArrowUp' ? -1 : 1);
			if (idx === -1 || nextIdx < 0 || nextIdx >= siblingIds.length) return; // clamp, no wrap
			const reordered = [...siblingIds];
			reordered.splice(idx, 1);
			reordered.splice(nextIdx, 0, node.id);
			// The reorder relocates this handle's element, which blurs it — see
			// `grabRefocusPending`/`handleHandleBlur` (#152 review F2).
			grabRefocusPending = true;
			sections = applySiblingOrder(sections, reordered);
			reorderStatus = m.roster_section_moved({
				name: node.name,
				position: nextIdx + 1,
				total: reordered.length
			});
			try {
				await tick();
				handleElementFor(node.id)?.focus();
			} finally {
				grabRefocusPending = false;
			}
			return;
		}

		// #155/S3 — ArrowRight indents, ArrowLeft unindents, both IMMEDIATE
		// commits (unlike Up/Down above, which stay provisional until drop): a
		// reparent changes the sibling GROUP itself, so `grabSiblingIds` (the
		// restore snapshot Escape/blur would replay) no longer describes
		// anything meaningful afterwards. The grab therefore ENDS with the
		// commit — same guards as the buttons (`prevSiblingId`/`node.parentId`),
		// and a refused move (no previous sibling / already top-level) writes
		// nothing and LEAVES the grab exactly as Up/Down's own clamp does.
		if (key === 'ArrowRight') {
			event.preventDefault();
			if (prevSiblingId(node.id) === null) return; // guard — grab stays
			grabbedSectionId = null;
			grabSiblingIds = null;
			await handleIndent(node);
			return;
		}

		if (key === 'ArrowLeft') {
			event.preventDefault();
			if (node.parentId === null) return; // guard — grab stays (already top-level)
			grabbedSectionId = null;
			grabSiblingIds = null;
			await handleUnindent(node);
			return;
		}

		if (key === ' ' || key === 'Enter') {
			event.preventDefault();
			await toggleGrab(node);
			return;
		}

		if (key === 'Escape') {
			event.preventDefault();
			cancelGrab(node);
			await tick();
			handleElementFor(node.id)?.focus();
		}
	}

	/** Abandon the grab on `node`: the pre-grab sibling order comes back, the
	 *  state machine returns to idle, and the cancellation is announced. NEVER
	 *  writes — a provisional move that is cancelled must leave no trace on the
	 *  server. State is cleared BEFORE the tree is patched so the DOM churn that
	 *  patch causes can't re-enter this through `handleHandleBlur`. */
	function cancelGrab(node: SectionNode): void {
		const restore = grabSiblingIds;
		grabbedSectionId = null;
		grabSiblingIds = null;
		if (restore) sections = applySiblingOrder(sections, restore);
		reorderStatus = m.roster_section_move_cancelled({ name: node.name });
	}

	/** #152 review F2 — a grab must not outlive the handle's focus.
	 *
	 *  Without this, Tab (or any other focus move) left `grabbedSectionId` set
	 *  and the PROVISIONAL, unwritten reorder on screen: this page never
	 *  refetches, so the order shown disagreed with the server until the next
	 *  full load — the same "the screen lies" failure `performReorder`'s #98/F3
	 *  comment exists to prevent — and the dangling grab then hijacked the next
	 *  handle the user pressed an arrow on, on an element whose `aria-grabbed`
	 *  read "false".
	 *
	 *  Cancels exactly like Escape, minus the focus restore: focus has
	 *  legitimately moved on, and dragging it back would trap the user.
	 *  `grabRefocusPending` excludes the blur a PROVISIONAL move causes by
	 *  relocating the grabbed handle in the DOM — that one is ours, not the
	 *  user's. */
	function handleHandleBlur(node: SectionNode): void {
		if (grabRefocusPending) return;
		if (grabbedSectionId !== node.id) return;
		cancelGrab(node);
	}

	// ── #155/S2 — arrange-mode reorder ──────────────────────────────────────
	//
	// The whole ARRANGE ROW is now the drag target (GH#155: "Whole row is the
	// drag target (no separate handle needed)"), for BOTH pointer paths
	// (native dragstart/dragover/drop, and the touch long-press twin) and for
	// the keyboard grab/move/drop/cancel machine #152 shipped. None of
	// `toggleGrab`/`handleHandleKeydown`/`cancelGrab`/`handleHandleBlur`/
	// `handleDragStart`/`handleDragEnd`/`handleDragOver`/`handleDragLeave`/
	// `handleDrop`/`handlePointerDown`/`handlePointerMove`/`handlePointerUp`
	// above needed to change to serve rows instead of drag handles — every one
	// of them already operates purely on a section id/SectionNode and its
	// SIBLING GROUP (`visibleSiblingsOf`), never on which UI rendered the
	// control. `findSectionNode(sections, row.id)` is what supplies the
	// SectionNode arrange rows don't carry themselves (`ArrangeRow` is a
	// flattened name/depth/count projection, not the tree node).
	//
	// "The subtree moves with its grabbed/dragged parent" (S2 point 5) is true
	// of the WRITE for free: `applySiblingOrder` moves a node's `children`
	// array along with it, and `arrangeRows` walks the CURRENT tree pre-order,
	// so the flat list simply reflects wherever the parent landed — no extra
	// code needed for that half. What follows is the VISUAL half (S2 point 3):
	// which rows currently belong to whichever section is held, so they can be
	// shown grouped with it.

	/** Every arrange row is reorderable (unlike the collapsed-only
	 *  `reorderableHandleIds` above, arrange mode has no expand/collapse gate
	 *  — the whole tree is always on screen), in the SAME pre-order the list
	 *  renders in.
	 *
	 *  #155/S4 review F3 — EXCEPT the row currently in rename mode, which does
	 *  not render an `arrange-row-*` element at all (it renders the rename
	 *  `<input>` block instead — see the template). Leaving it in this list let
	 *  `activeArrangeRowId` name a row that isn't there, and then EVERY rendered
	 *  row sat at `tabindex="-1"`: the reorder widget lost its roving tab stop
	 *  entirely and was unreachable by Tab for as long as the input stayed open
	 *  (there is no blur-close, so that is indefinitely). Excluding it here is
	 *  what makes the tab stop fall through to a row that actually renders —
	 *  the same "still-rendered-or-first" contract `activeHandleId` holds for
	 *  the collapsed view. */
	const arrangeReorderableIds = $derived(
		arrangeRows.filter((r) => r.id !== renamingSectionId).map((r) => r.id)
	);

	/** The row currently at tabindex="0" in the arrange list — same
	 *  still-rendered-or-first-row fallback as `activeHandleId`. */
	const activeArrangeRowId = $derived(
		rovingHandleId !== null && arrangeReorderableIds.includes(rovingHandleId)
			? rovingHandleId
			: (arrangeReorderableIds[0] ?? null)
	);

	/** The section currently HELD by whichever input path owns it right now —
	 *  keyboard grab, a live native drag, or a live touch drag. Only one of
	 *  the three is ever non-null at once (a keyboard grab and a pointer drag
	 *  never occur on the same gesture — the same assumption `aria-grabbed`
	 *  above already makes). */
	const heldSectionId = $derived(grabbedSectionId ?? draggedSectionId ?? touchDragId ?? null);

	/** Every DESCENDANT id of `heldSectionId` — the rows that visually belong
	 *  WITH it while it's being moved (S2 point 3: "subtree rows visually
	 *  grouped with grabbed parent"). Never includes `heldSectionId` itself —
	 *  that row gets its own `data-grabbed`, not this. */
	const heldSubtreeIds = $derived.by(() => {
		const ids = new Set<string>();
		if (heldSectionId === null) return ids;
		const node = findSectionNode(sections, heldSectionId);
		if (!node) return ids;
		function walk(n: SectionNode): void {
			for (const child of n.children) {
				ids.add(child.id);
				walk(child);
			}
		}
		walk(node);
		return ids;
	});

	/** Sentinel for "the hint belongs AFTER the last arrange row" — a slot, not a
	 *  section id, so it can never collide with one. */
	const ARRANGE_DROP_HINT_END = '__end__';

	/** #155/S2 review F2 — WHERE the dashed landing hint goes in the ARRANGE list,
	 *  as the id of the row it renders IMMEDIATELY BEFORE (or the end sentinel).
	 *  One place computes it, so "one indicator, never two" holds by construction
	 *  the same way `sectionGroup`'s two-slot `hintBefore` does.
	 *
	 *  Why not simply reuse `hintBefore` per row: `sectionGroup` renders the hint
	 *  around a section's HEADER, and its children live in a nested region. The
	 *  arrange list is FLAT pre-order — a parent's descendants are rows of the
	 *  same list, right after it. So the "lands below the target" slot is not
	 *  after the target's row, it is after the target's whole SUBTREE, otherwise
	 *  a downward drag onto a parent would draw the hint wedged between that
	 *  parent and its own children.
	 *
	 *  Direction is the same `dropOnto` fact #110 review F1 pinned: the dragged
	 *  section takes the target's ORIGINAL index, so an UPWARD move (source below
	 *  the target) lands ABOVE the target and a downward move lands BELOW it.
	 *  Gated on exactly what the drop itself accepts (live drag, distinct target,
	 *  same visible sibling group), so the hint and the `bg-ink-5` target tint can
	 *  never disagree about whether a drop will act. */
	const arrangeDropHintBeforeId = $derived.by((): string | null => {
		if (viewMode !== 'arrange') return null;
		const fromId = draggedSectionId ?? touchDragId;
		const overId = draggedSectionId !== null ? dragOverId : touchOverId;
		if (fromId === null || overId === null || overId === fromId) return null;
		const siblingIds = visibleSiblingsOf(overId)?.map((n) => n.id) ?? [];
		const fromIdx = siblingIds.indexOf(fromId);
		const toIdx = siblingIds.indexOf(overId);
		if (fromIdx < 0 || toIdx < 0) return null;
		if (fromIdx > toIdx) return overId;
		const targetIdx = arrangeRows.findIndex((r) => r.id === overId);
		if (targetIdx < 0) return null;
		const targetDepth = arrangeRows[targetIdx].depth;
		let i = targetIdx + 1;
		while (i < arrangeRows.length && arrangeRows[i].depth > targetDepth) i += 1;
		return arrangeRows[i]?.id ?? ARRANGE_DROP_HINT_END;
	});
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
			<!-- #155/S4 review F4 — SCOPE CALL, recorded so code and acceptance text
			     agree. S4's "collapsed/expanded are display-only — no add/rename/
			     delete" is about the SECTION-TREE management controls that used to sit
			     on every section header (drag handle, ✕, and the page-level "+ New
			     section"); all three moved into Arrange mode. This picker is a
			     different thing: MEMBER→section ASSIGNMENT, which has no home in
			     arrange mode at all (arrange renders no member rows), so it stays on
			     the member row in Expanded view.
			     Its inline `section-picker-new` → `section-create-form` create entry
			     stays WITH it, deliberately: it exists so an admin assigning a member
			     to a section that doesn't exist yet can make it in place (#111/#120),
			     and pulling it out would mean leaving the assignment flow, switching
			     view mode, creating, and coming back. The S4 acceptance wording is
			     therefore read as "the PAGE-LEVEL add entry moved to arrange mode";
			     the picker's assignment-scoped create is out of that scope.
			     `page.roster-arrange-crud.spec.ts`'s STRIP suite asserts this
			     explicitly (present in Expanded, absent in Collapsed where no member
			     rows render) so the choice is visible to the gate rather than
			     invisible to it. -->
			<SectionPicker
				memberId={row.memberId}
				memberName={row.name}
				{sections}
				selectedIds={row.sectionIds ?? []}
				dbEntityId={row.dbEntityId}
				onpick={(sectionId) => handlePick(row.memberId, sectionId)}
				oncreate={(input) => handleCreate(row.memberId, input)}
			/>
			{#if sectionWriteError?.memberId === row.memberId}
				<!-- F5 code-review fix — the create path's loud failure (see
				     `sectionWriteError` above). role="alert" because it appears after the
				     picker has already closed, with nothing else on screen changing. -->
				<p
					data-testid="section-write-error-{row.memberId}"
					role="alert"
					class="text-xs text-red-700"
				>
					{sectionWriteError.kind === 'create'
						? m.roster_section_create_failed()
						: m.roster_section_assign_failed()}
				</p>
			{/if}
		{/if}
		{#if admin === 'admin' && row.personId !== selected?.personId}
			<!-- #255 (A) — deactivate, admin-only and NEVER on the viewer's own row
			     (done-when 7: a member cannot deactivate herself or anyone else via
			     a control she can't even see for her own row). Two-step confirm
			     reusing the page's existing destructive idiom (see `pendingRemoveId`
			     above) rather than inventing a new shape. -->
			<div class="flex flex-wrap items-center gap-2 pt-1">
				{#if pendingDeactivateId === row.memberId}
					<span class="text-xs text-ink-2">{m.roster_member_deactivate_confirm_prompt()}</span>
					<button
						type="button"
						data-testid="member-deactivate-confirm-{row.memberId}"
						class="rounded-md border border-red-700 px-2 py-1 text-xs text-red-700 hover:bg-red-700 hover:text-paper"
						onclick={() => handleDeactivateConfirm(row)}
					>
						{m.roster_member_deactivate_confirm()}
					</button>
					<button
						type="button"
						data-testid="member-deactivate-cancel-{row.memberId}"
						class="rounded-md border border-ink-4 px-2 py-1 text-xs text-ink-2 hover:text-ink"
						onclick={() => disarmDeactivate(row.memberId)}
					>
						{m.roster_member_deactivate_cancel()}
					</button>
				{:else}
					<button
						type="button"
						data-testid="member-deactivate-{row.memberId}"
						class="rounded-md border border-ink-4 px-2 py-1 text-xs text-ink-2 hover:text-ink"
						onclick={() => armDeactivate(row.memberId)}
					>
						{m.roster_member_deactivate()}
					</button>
				{/if}
			</div>
			{#if deactivateRefusal?.memberId === row.memberId}
				<!-- Gama binding: the refusal NAMES THE REMEDY — who holds what role
				     and where to remove it — never a bare "cannot deactivate" (the
				     #252 failure in message form). -->
				<p
					data-testid="member-deactivate-refused-{row.memberId}"
					role="alert"
					class="text-xs text-red-700"
				>
					{#each deactivateRefusal.blockers as blocker (blocker.role)}
						{blocker.role === 'admin'
							? m.roster_deactivate_refused_admin({ collective: selected?.name ?? '' })
							: m.roster_deactivate_refused_librarian({ collective: selected?.name ?? '' })}
					{/each}
				</p>
			{/if}
			{#if deactivateActionError?.memberId === row.memberId && deactivateActionError.kind === 'deactivate'}
				<!-- #255 review F2 — the loud failure, mirroring `removeError`'s alert
				     over the section groups. The row is unchanged and the confirm has
				     disarmed itself, so the copy says exactly that: nothing moved. -->
				<p
					data-testid="member-deactivate-failed-{row.memberId}"
					role="alert"
					class="text-xs text-red-700"
				>
					{m.roster_member_deactivate_failed({ name: row.name })}
				</p>
			{/if}
		{/if}
	</li>
{/snippet}

<!-- TU.2/#110 (finding #11) — the dashed landing-position hint. ONE definition
     rendered from ONE of two slots in `sectionGroup` (above or below the target's
     header row, per the drag's direction — see `hintBefore`), so "one indicator,
     never two" holds by construction. -->
{#snippet dropIndicator()}
	<div
		data-testid="section-drop-indicator"
		aria-hidden="true"
		class="mx-2 h-0.5 border-t-2 border-dashed border-ink-3"
	></div>
{/snippet}

{#snippet sectionGroup(node: SectionNode)}
	{@const group = groupById.get(node.id)}
	{@const isExpanded = expandedIds.has(node.id)}
	<!--
		F2 code-review fix: a child's <section> is rendered NESTED inside its
		parent's (below, `{#each node.children as child}{@render sectionGroup(child)}{/each}`
		lives INSIDE this same <section>) — so each level's own margin-left ALREADY
		stacks on top of every ancestor's. `node.depth * 1rem` therefore compounded
		quadratically (a depth-2 node got 1+2=3rem of visual indent, not 2rem). A
		CONSTANT 1rem on every non-root node gives each level exactly 1rem of
		indent relative to its immediate parent — nesting itself does the rest.

		#155/S4 — COLLAPSED and EXPANDED are DISPLAY-ONLY now: no drag handle, no
		remove control, no rename. Every section-management affordance that used
		to live on this header (TS.4/#98 drag, TU.2/#110 remove) moved exclusively
		to Arrange mode — see the `roster-arrange-list` rendering below, which is
		the ONLY place `section-remove-*`/rename/add now render. This snippet
		keeps just the toggle + header display + nested member rows/children.
	-->
	<section
		data-testid="section-group-{node.id}"
		data-depth={node.depth}
		class="flex flex-col"
		style="margin-left: {node.depth === 0 ? 0 : 1}rem"
	>
		<div class="flex items-center gap-2 py-1.5">
			<button
				type="button"
				data-testid="section-toggle-{node.id}"
				aria-expanded={isExpanded}
				aria-controls={isExpanded ? `section-region-${node.id}` : undefined}
				class="flex items-center gap-2 text-left"
				onclick={() => toggleSection(node.id)}
			>
				<span aria-hidden="true" class="text-ink-2">{isExpanded ? '▾' : '▸'}</span>
				<span data-testid="section-header-{node.id}" class="text-sm font-medium text-ink">
					{node.name} ({group?.memberCount ?? 0})
				</span>
			</button>
		</div>
		{#if isExpanded}
			<!-- #99/TS.5 — the id the toggle's aria-controls points at. `display:
			     contents` (Tailwind `contents`) keeps this wrapper invisible to
			     layout: the ul and the nested child sections flow exactly as they
			     did as bare siblings before — only a real DOM node (with an id) was
			     added, nothing about the flex column changed. -->
			<div id="section-region-{node.id}" class="contents">
				<ul class="flex flex-col pl-5">
					{#each group?.members ?? [] as row (row.memberId)}
						{@render memberRow(row, false)}
					{/each}
				</ul>
				{#each node.children as child (child.id)}
					{@render sectionGroup(child)}
				{/each}
			</div>
		{/if}
	</section>
{/snippet}

<main class="min-h-screen bg-paper px-6 py-10 text-ink">
	<div class="mx-auto flex w-full max-w-md flex-col gap-4">
		<h1 class="font-display text-2xl">{m.roster_title()}</h1>

		<!-- #99 review F3 — the reorder result, for the keyboard/AT path. Present from
		     first render (a live region announces only CHANGES to its contents, so one
		     mounted alongside its own text is announced by nothing) and visually
		     hidden: sighted users already SEE the row move. `sr-only` is absolutely
		     positioned, so it takes no slot in this flex column. -->
		<div data-testid="roster-reorder-status" role="status" aria-live="polite" class="sr-only">
			{reorderStatus}
		</div>

		<!-- #152 review F1 — the drag handle's keyboard protocol (Space grabs,
		     arrows move, Space drops, Escape cancels) is not guessable from a
		     name that only says "Drag to reorder". Every handle points its
		     aria-describedby here, so the protocol is READ OUT when the control
		     takes focus instead of having to be discovered. One node for the whole
		     page (the handles are rendered by a RECURSIVE snippet — a per-handle
		     copy would duplicate the id). Admin-gated on the same condition that
		     renders the handles at all (`canReorder` = `admin === 'admin' &&
		     !isExpanded`), so the id resolves exactly when something references
		     it, and a non-admin is not described a control she never gets. NOT a
		     live region: it never changes, and role="status" here would make it
		     compete with the reorder announcements above. -->
		{#if admin === 'admin'}
			<span
				id="section-reorder-instructions"
				data-testid="roster-reorder-instructions"
				class="sr-only"
			>
				{m.roster_section_reorder_instructions()}
			</span>
		{/if}

		<!-- #113 review F1 — the removal result, same contract as the reorder region
		     above: mounted from first render (a live region announces only CHANGES
		     to its contents) and visually hidden, because a sighted user watched the
		     group vanish. Only the SUCCESS text lands here; a refused remove is a
		     role="alert" (`section-remove-error`), not a status. -->
		<div
			data-testid="roster-section-remove-status"
			role="status"
			aria-live="polite"
			class="sr-only"
		>
			{removeStatus}
		</div>

		<!-- #124 (F1) — the page-level create's result, same contract as the reorder
		     and remove regions above: mounted from first render, visually hidden.
		     The "invisible success" half of the SPIKE finding — a create used to
		     land nothing on screen saying it happened. -->
		<div
			data-testid="roster-section-create-status"
			role="status"
			aria-live="polite"
			class="sr-only"
		>
			{pageCreateStatus}
		</div>

		<!-- #155/S4 — the rename result, same contract as the create/remove regions
		     above: mounted from first render, visually hidden. Only the SUCCESS
		     text lands here; a failed rename is a role="alert" (`arrange-rename-error-*`). -->
		<div
			data-testid="roster-section-rename-status"
			role="status"
			aria-live="polite"
			class="sr-only"
		>
			{renameStatus}
		</div>

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
		{:else if status === 'session-expired'}
			<SessionExpiredNotice />
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
			{#if reorderError}
				<!-- #99 review F2 — the reorder path's loud failure. The list has already
				     been re-derived from the server by then (see `performReorder`), so
				     without this the user watches the order snap to something they did
				     not choose with no explanation. role="alert" for the same reason the
				     create-failure paragraph carries it: nothing else on screen names the
				     cause. #253 — TWO states, not one: `reparentPartial` is only ever true
				     when a reparent's `_parent` move LANDED and its renumber then failed
				     (see `performReparent`'s catch) — that copy says the section DID move.
				     Every other failure (pure reorder, or a reparent that never landed)
				     keeps this original copy unchanged. -->
				<p data-testid="section-reorder-error" role="alert" class="text-sm text-red-700">
					{reparentPartial ? m.roster_section_reparent_partial() : m.roster_section_reorder_failed()}
				</p>
			{/if}
			{#if removeError}
				<!-- #110 review F1/F3 — the remove path's loud failure, mirroring the
				     reorder alert directly above. The section is already back on screen
				     by the time this renders (the catch reverts the tree), so without it
				     the whole event reads as "nothing happened". Names the section: the
				     alert sits above the groups, not in the header that was tapped. -->
				<p data-testid="section-remove-error" role="alert" class="text-sm text-red-700">
					{removeError.kind === 'not-empty'
						? m.roster_section_remove_not_empty({ name: removeError.name })
						: m.roster_section_remove_failed({ name: removeError.name })}
				</p>
			{/if}
			{#if reorderPending}
				<!-- TU.2/#110 (finding #6) — a visible loading indicator while the
				     display_order write is outstanding. `reorderPending` already gates
				     both drag/keyboard controls (disables them, see `sectionGroup`
				     below); this is the same flag surfaced as an on-screen affordance,
				     clearing on both success AND failure (see `performReorder`'s
				     finally). -->
				<div
					data-testid="section-reorder-pending"
					role="status"
					aria-busy="true"
					aria-live="polite"
					class="flex items-center gap-2 text-xs text-ink-2"
				>
					<span
						aria-hidden="true"
						class="h-3 w-3 animate-spin rounded-full border-2 border-ink-3 border-t-transparent"
					></span>
					{m.roster_section_reorder_pending()}
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
				<!-- #155/S1 — the 3-chip view-mode selector, ABOVE the groups (pinned
				     document-order contract the old collapse-all/expand-all toggle
				     held). Radio-style single selection — and since #156 it says so:
				     `role="radiogroup"` + `role="radio"` + `aria-checked`, exactly one
				     chip "true". The role is load-bearing, not decoration: arrows here
				     both MOVE and SELECT (`handleViewModeKeydown`), which is radiogroup
				     behaviour and NOT what the app's other roving groups do (those are
				     `role="toolbar"`, arrows move only) — under a bare `role="group"`
				     nothing in the markup told a screen-reader user which of the two
				     they were in. `aria-checked` REPLACES `aria-pressed`: pressed-state
				     on `role="radio"` is an invalid ARIA mix, the same trap
				     page.sections-a11y.spec.ts caught on `role="option"`.
				     Arrange is rights-gated (admin-only, fail-closed on
				     'loading'/'error' same as every other admin control on this page)
				     — non-editors get exactly the two display chips. -->
				<div
					data-testid="roster-view-modes"
					role="radiogroup"
					tabindex="-1"
					aria-label={m.roster_view_modes_label()}
					class="inline-flex flex-wrap items-center gap-1.5 self-start"
					onkeydown={handleViewModeKeydown}
				>
					<button
						type="button"
						data-testid="roster-view-chip-collapsed"
						data-view-mode="collapsed"
						role="radio"
						aria-checked={viewMode === 'collapsed' ? 'true' : 'false'}
						tabindex={viewMode === 'collapsed' ? 0 : -1}
						class="rounded-full border px-2.5 py-1 text-xs tracking-wide uppercase {viewMode === 'collapsed'
							? 'border-ink bg-ink text-paper'
							: 'border-ink-4 text-ink-2 hover:text-ink'}"
						onclick={() => setViewMode('collapsed')}
					>
						{m.roster_view_collapsed()}
					</button>
					<button
						type="button"
						data-testid="roster-view-chip-expanded"
						data-view-mode="expanded"
						role="radio"
						aria-checked={viewMode === 'expanded' ? 'true' : 'false'}
						tabindex={viewMode === 'expanded' ? 0 : -1}
						class="rounded-full border px-2.5 py-1 text-xs tracking-wide uppercase {viewMode === 'expanded'
							? 'border-ink bg-ink text-paper'
							: 'border-ink-4 text-ink-2 hover:text-ink'}"
						onclick={() => setViewMode('expanded')}
					>
						{m.roster_view_expanded()}
					</button>
					{#if admin === 'admin'}
						<button
							type="button"
							data-testid="roster-view-chip-arrange"
							data-view-mode="arrange"
							role="radio"
							aria-checked={viewMode === 'arrange' ? 'true' : 'false'}
							tabindex={viewMode === 'arrange' ? 0 : -1}
							class="rounded-full border px-2.5 py-1 text-xs tracking-wide uppercase {viewMode === 'arrange'
								? 'border-ink bg-ink text-paper'
								: 'border-ink-4 text-ink-2 hover:text-ink'}"
							onclick={() => setViewMode('arrange')}
						>
							{m.roster_view_arrange()}
						</button>
					{/if}
				</div>
				{#if viewMode === 'arrange' && admin === 'admin'}
					<!-- #155/S1 — the arrange-mode SHELL: a compact section list (name +
					     recursive member count, nesting by indentation only), replacing
					     `roster-groups` on screen. No member rows, no per-section expand
					     toggle/picker/new-section/remove yet — S3–S4 add those.
					     #155/S2 — every row is now the reorder control itself: the WHOLE
					     row is draggable (native + touch) and carries the SAME keyboard
					     grab/move/drop/cancel machine #152 shipped on the old drag handle
					     (`toggleGrab`/`handleHandleKeydown`, unmodified — see the script-
					     side "#155/S2" comment block above `</script>` for why nothing
					     there needed to change). `node` is the row's own SectionNode
					     (`ArrangeRow` itself carries no tree reference); it always resolves
					     because `arrangeRows` is built by walking the very tree
					     `findSectionNode` searches. -->
					<div data-testid="roster-arrange-list" class="flex flex-col">
						{#each arrangeRows as row (row.id)}
							{@const node = findSectionNode(sections, row.id)}
							{#if node}
								{@const siblingIds = visibleSiblingsOf(row.id)?.map((n) => n.id) ?? []}
								{@const acceptsDrop =
									draggedSectionId !== null &&
									draggedSectionId !== row.id &&
									siblingIds.includes(draggedSectionId)}
								{@const acceptsTouchDrop =
									touchDragId !== null &&
									touchOverId === row.id &&
									touchOverId !== touchDragId &&
									siblingIds.includes(touchDragId)}
								<!-- #155/S4 — DELETE eligibility. Same rule `sectionGroup`'s old
								     `canRemove` enforced (TU.2/#110 finding #7/#110 review F2/F3):
								     zero members (the roster's active + name-complete roll-up),
								     zero sub-sections (would orphan them), and not a foreign org's
								     section (belt-and-braces — `visibleSections`/`arrangeRows`
								     already keep a foreign root off this list entirely). UNLIKE the
								     old conditional-render, the control here is ALWAYS rendered and
								     DISABLED when ineligible (task #155/S4: "Disable for sections
								     with children/members"), matching indent/unindent's own
								     always-shown-sometimes-disabled shape. -->
								{@const canDelete =
									row.memberCount === 0 && node.children.length === 0 && isOwnDbEntitySection(row.id)}
								<!-- #252 — applicability, read ONCE per row for both the `disabled`
								     wiring below (unchanged: `structuralWritePending || renaming ||
								     !can*`) and the presentation-only `invisible` treatment, which
								     must key on APPLICABILITY ALONE, not the combined `disabled`
								     value — a transient structural-write lock dims an otherwise-
								     applicable direction (`disabled:opacity-60`, still on screen), it
								     does not disappear it. Only "this direction does not exist here"
								     (GH#252 item 2, Mihkel: "show only active actions") earns
								     `invisible`, and `invisible` (not `hidden`) is what keeps the
								     `min-h-11 min-w-11` box reserved so the row never jumps. -->
								{@const indentApplicable = canIndent(row.id)}
								{@const unindentApplicable = canUnindent(row.id)}
								{#if arrangeDropHintBeforeId === row.id}
									{@render dropIndicator()}
								{/if}
								<!-- #155/S2 review F1 / #205 review F2 — the row's `aria-label` is
								     "{name} ({count})". S2 named this role="button" from its own CONTENTS
								     to keep the member roll-up in the name (WCAG 2.5.3 Label in Name) —
								     the failure mode then was `aria-label={row.name}` alone, which
								     announced "Soprano" over a visible "Soprano (3)". #205 moved the
								     NAME's home into the rename activator beside this row (that
								     containment is what makes "tap the name" open the editor), leaving
								     the row's own content as the "(3)" roll-up. The label restores the
								     full "Soprano (3)" the S2 fix was defending and still CONTAINS the
								     visible "(3)", so Label in Name holds; it is composed from the same
								     two values the row and its neighbour render, so there is no second
								     string for Comenius to keep in sync. The reorder protocol is
								     unaffected: it was never in the label, it comes from
								     `aria-describedby` below. -->
								<!-- #155/S2 review F2 — the HELD SUBTREE and the DROP TARGET must not
								     look the same. Both used to paint `bg-ink-5`, so mid-drag "these
								     rows are coming with me" and "the section lands here" were the
								     one tint. The subtree now reads `bg-indigo-soft`, tying it to the
								     held row's own indigo dashed outline; `bg-ink-5` stays the drop
								     target's alone. (Tint, not a border — a left border would shift
								     every subtree row by its width the moment a drag started.) The
								     two can never both apply to one row anyway: a descendant of the
								     dragged section is by construction not its sibling, and only
								     siblings accept the drop. -->
								<!-- #155/S2 review F3 — `reorderPending` dims NOTHING here. In the
								     collapsed view that `opacity-30` sat on the ≡ glyph alone, so an
								     in-flight write faded one character; on a whole row it washed
								     out the entire section list, names and counts included, for
								     every reorder round-trip. The refusal is already real and
								     announced elsewhere — `draggable="false"` plus the guards in
								     `handlePointerDown`/`performReorder` — so the cursor is the only
								     affordance that still needs to change. -->
								<!-- #155/S2 review F4 — `touch-action` is `pan-y` on the ROW, `none` on
								     the leading GRIP alone. In the collapsed view `touch-action: none`
								     sat on the ~12px ≡ glyph; hoisted onto a whole row it covered the
								     entire arrange list, and since touch-action is latched at gesture
								     START (neither the 10px long-press slop cancel nor `pointercancel`
								     can hand the scroll back afterwards) a finger swipe beginning
								     anywhere on the list could no longer scroll this deliberately
								     mobile-shaped (`max-w-md`) page. Zoning it is what keeps both:
								     press the grip and the browser never claims the gesture, press
								     anywhere else on the row and `pan-y` scrolls as normal.
								     Only the touch PICKUP is zoned — the whole row stays the native
								     `draggable` surface for mouse and stays the keyboard control. -->
								<!-- #155/S3 review R2/F1 — the SLOT wrapper. The two nesting buttons used
								     to sit INSIDE the `role="button"` row below, which cost two things at
								     once. (a) Accessible name: the row is deliberately named from its own
								     CONTENTS (#155/S2 review F1, so the "(3)" roll-up survives — WCAG 2.5.3
								     Label in Name), and name computation recurses into every child using
								     that child's OWN name — an `aria-label`/`title` first. The row therefore
								     computed to "Soprano (3) Indent Soprano Unindent Soprano". A
								     `textContent` assertion structurally cannot catch that (both buttons
								     hold only an `aria-hidden` SVG), which is why the S2 guard test stayed
								     green over the regression. (b) Focusable `<button>`s inside a
								     `role="button"` is the `nested-interactive` violation (WCAG 4.1.2):
								     `button` has presentational children in ARIA, so AT exposure of the
								     nested controls is implementation-defined, and they added two extra tab
								     stops per row inside a composite widget #152 gave ONE roving tab stop.
								     Hoisting them out of the subtree removes both at the source rather than
								     guarding around the symptom. Everything the KEYBOARD/DRAG-SOURCE machine
								     resolves by (`data-testid="arrange-row-*"` for `handleElementFor`,
								     `tabindex`, `aria-grabbed`, `data-grabbed*`, `draggable`, `dragstart`,
								     the depth padding) stays on the row itself. -->
								<!-- #205 review F3 — the wrapper owns the DROP semantics. Once the rename
								     activator grew to `flex-1` beside the row, the row no longer covered the
								     full width a user perceives as "the row": `ondragover`/`ondrop` bound on
								     the row never fired over the rename band, and the touch hit-test
								     (`sectionIdUnderPointer` → `closest`) returned null there because the
								     button is a SIBLING of the row, not a descendant. A drop released on the
								     right half of a row was silently discarded. Binding the drop handlers and
								     the `data-drop-row` hit-test hook here makes the drop target equal the
								     visual row — including the action cluster — while the row keeps being the
								     drag SOURCE and the keyboard control. `closest` returns the innermost
								     match, so a point over the row still resolves through `arrange-row-*` to
								     the same id. -->
								<!-- #205 review F2 (round 2) — the HOLD affordances belong here too, for the
								     same reason the drop tint does. `outline-dashed` (the row you are
								     holding), `bg-indigo-soft` (its subtree) and `opacity-50` (the
								     touch-dragged row) used to sit on `arrange-row-*`, which since #205
								     spans the GRIP alone: the dashed "this is what you picked up" outline
								     enclosed a bare grip and visibly EXCLUDED the section name that
								     identifies it, while the drop target painted the full width. That is
								     exactly the held-vs-target asymmetry S2 review F2 (below) exists to
								     prevent — both must read as whole rows, distinguishable by TINT only.
								     The mutual-exclusion argument in that comment survives the move
								     unchanged: a descendant of the dragged section is by construction not
								     its sibling, and only siblings accept the drop. Everything BEHAVIOURAL
								     (role, tabindex, draggable, aria-grabbed, data-grabbed*, the handlers,
								     the depth padding, and the grab cursor on the drag surface itself)
								     stays on the row. -->
								<!-- #205 review F2 (round 3) — the FOCUS indicator joins hold and drop
								     on this wrapper. The row was the last thing still painting at grip
								     size: since #205 `arrange-row-*` spans the ~16px grip alone, so the
								     browser's default outline ringed a bare glyph while pressing Space
								     immediately drew the held-row dashed outline around the full width
								     — focus and hold disagreeing about what a row is, which is the same
								     asymmetry round 2 fixed for hold-vs-drop. `focus-within` (not
								     `focus`): the wrapper is `role="presentation"` and never itself
								     focusable, and every focusable thing a user reaches inside it — the
								     reorder row, the rename activator, delete — is part of the same
								     visual row, so "focus is somewhere in this row" is exactly the state
								     worth painting. A RING, not an outline: `outline-dashed` for the
								     held state lives on this element too, and two outline-style
								     utilities on one element fight over which wins. Ring and outline
								     compose (box-shadow vs outline), so a held-and-focused row shows
								     both, as it should. -->
								<div
									class="flex items-center focus-within:ring-2 focus-within:ring-indigo {(acceptsDrop &&
										dragOverId === row.id) ||
									acceptsTouchDrop
										? 'bg-ink-5'
										: ''} {touchDragId === row.id ? 'opacity-50' : ''} {heldSectionId === row.id
										? 'outline-2 outline-dashed outline-indigo'
										: ''} {heldSubtreeIds.has(row.id) ? 'bg-indigo-soft' : ''}"
									role="presentation"
									data-drop-row={row.id}
									ondragover={acceptsDrop ? (event: DragEvent) => handleDragOver(row.id, event) : undefined}
									ondragleave={acceptsDrop
										? (event: DragEvent) => handleDragLeave(row.id, event)
										: undefined}
									ondrop={acceptsDrop ? (event: DragEvent) => handleDrop(row.id, event) : undefined}
								>
									{#if renamingSectionId === row.id}
										<!-- #155/S4 — RENAME mode: a SEPARATE, non-draggable row, never the
										     `role="button"` reorder row with an `<input>` nested inside it
										     (that would be the same `nested-interactive` violation — WCAG
										     4.1.2 — review R2/F1 above already fixed for indent/unindent).
										     Enter saves (`onRenameKeydown` → `submitRename`), Escape cancels;
										     no Save/Cancel buttons — matches the issue's literal "tap the
										     name → input → Enter saves → Escape cancels" contract. -->
										<div class="flex grow items-center gap-2 py-1.5 {arrangeIndentClass(row.depth)}">
											<span aria-hidden="true" class="w-4 shrink-0"></span>
											<input
												type="text"
												data-testid="arrange-rename-input-{row.id}"
												bind:this={renameInputEl}
												aria-label={m.roster_section_name_label()}
												value={renameValue}
												oninput={(e) => (renameValue = (e.currentTarget as HTMLInputElement).value)}
												onkeydown={onRenameKeydown}
												class="min-w-0 grow border border-ink-5 bg-paper px-1.5 py-0.5 text-ink"
											/>
										</div>
									{:else}
										<div
											data-testid="arrange-row-{row.id}"
											data-depth={row.depth}
											data-grabbed={heldSectionId === row.id ? 'true' : undefined}
											data-grabbed-subtree={heldSubtreeIds.has(row.id) ? 'true' : undefined}
											role="button"
											tabindex={activeArrangeRowId === row.id ? 0 : -1}
											aria-label={`${row.name} (${row.memberCount})`}
											aria-grabbed={draggedSectionId === row.id || grabbedSectionId === row.id
												? 'true'
												: 'false'}
											aria-dropeffect={acceptsDrop ? 'move' : undefined}
											aria-describedby="section-reorder-instructions"
											draggable={structuralWritePending ? 'false' : 'true'}
											style="touch-action: pan-y"
											class="flex shrink-0 items-center gap-2 py-1.5 pr-2 {arrangeIndentClass(
												row.depth
											)} focus:outline-none select-none {structuralWritePending
												? 'cursor-default'
												: 'cursor-grab'}"
											ondragstart={(event: DragEvent) => handleDragStart(row.id, event)}
											ondragend={handleDragEnd}
											onpointermove={handlePointerMove}
											onpointerup={handlePointerUp}
											onpointercancel={endTouchDrag}
											onlostpointercapture={endTouchDrag}
											onkeydown={(event: KeyboardEvent) => void handleHandleKeydown(node, event)}
											onclick={(event: MouseEvent) => {
												// Same "honour the role=button activation promise arriving as
												// a click, without letting a pointer gesture near the grab
												// state machine" contract as the old handle's onclick — see
												// #152 review F1 in `sectionGroup` above.
												if (event.detail !== 0) return;
												handleElementFor(row.id)?.focus();
												void toggleGrab(node);
											}}
											onfocus={() => (rovingHandleId = row.id)}
											onblur={() => handleHandleBlur(node)}
										>
											<!-- The touch grab zone, and since #205 review F2 (round 2) the row's
											     ONLY child. `aria-hidden` and drawn from bars rather than a `≡`
											     character on purpose: nothing here may carry text — the row now
											     renders NO visible text at all, which is what makes its explicit
											     `aria-label` trivially satisfy WCAG 2.5.3 (nothing visible inside
											     it for the name to have to contain).
											     #205 review F2 (round 3) — grip-only drag is the intended
											     tradeoff (team decision recorded on #205): it matches the touch
											     pickup zone and keeps the drag gesture from competing with the
											     rename activator's click, which now covers the rest of the row.
											     What it owed was LEGIBILITY — three static bars at `text-ink-2`
											     with no state at all told a pointer user nothing about where a
											     drag can start. `hover:`/`active:` give it that affordance, and
											     `min-h-11` stretches the reactive surface to the row's own
											     height (set by the rename activator's `min-h-11` beside it), so
											     what lights up is the whole strip you can actually grab rather
											     than the ~18px the bars occupy. The bars stay centred
											     (`justify-center`) and the strip stays `w-4`, so the no-scroll
											     `touch-action: none` region grows in HEIGHT only and the rest
											     of the row still pans (#155/S2 review F4).
											     The affordance is gated on `structuralWritePending` for the
											     same reason the row's `cursor-grab` is: while a structural
											     write is outstanding `handlePointerDown` refuses the pickup
											     outright, and a strip that still lights up under the cursor
											     would be advertising a gesture the page will not honour. -->
											<span
												data-testid="arrange-grip-{row.id}"
												aria-hidden="true"
												style="touch-action: none"
												class="flex min-h-11 w-4 shrink-0 flex-col justify-center gap-0.5 rounded-sm py-1 text-ink-2 {structuralWritePending
													? 'cursor-default'
													: 'cursor-grab hover:bg-ink-5 hover:text-ink active:bg-ink-5 active:text-ink'}"
												onpointerdown={(event: PointerEvent) => handlePointerDown(row.id, event)}
											>
												<span class="h-px w-full bg-current"></span>
												<span class="h-px w-full bg-current"></span>
												<span class="h-px w-full bg-current"></span>
											</span>
										</div>
									{/if}
									<!-- #205 whole-field shape (see admin/+page.svelte:513-540 and the
									     season panel above for the full rationale) — the rename trigger
									     WRAPS the section name so tapping the name area (not just the
									     pencil) activates it. Still a sibling of the `role="button"` row
									     (#155/S3 review R2/F1 nested-interactive fix stays intact) — the
									     NAME simply moved out of the row and into this button, which is
									     what makes the name area itself the tab-reachable activator.
									     `flex-1 min-w-0` — not `w-full`, which would fight the fixed-width
									     grip/indent/unindent/remove siblings in this flex row — grows the
									     button to the remaining name-column width rather than
									     shrink-wrapping the ✎ glyph (#165 review F3 trap). The drop target
									     the button now covers is restored by the wrapper's `data-drop-row`
									     (review F3, see above).
									     #205 review F2 — the sr-only label is the BARE action verb, not
									     `roster_section_rename({ name })`: the name is rendered visibly
									     inside the button, so the parameterised string made the computed
									     name stutter ("Rename Soprano Soprano"). Bare verb + visible value
									     gives "Rename Soprano", the same "<action> <value>" contract the
									     admin/season/profile activators use. `title` keeps the full
									     parameterised string for the mouse tooltip (it never reaches the
									     accessible name — contents win over title). -->
									<button
										type="button"
										data-testid="arrange-rename-{row.id}"
										title={m.roster_section_rename({ name: row.name })}
										disabled={structuralWritePending || renamingSectionId === row.id}
										class="group flex min-h-11 min-w-0 flex-1 appearance-none items-center gap-1.5 border-0 bg-transparent p-0 text-left text-ink-2 hover:text-ink disabled:cursor-default"
										onclick={() => startRename(node)}
									>
										<span class="sr-only">{m.roster_section_rename_action()}</span>
										<!-- The in-flight refusal dims the GLYPH, never the name (#155/S2 review
										     F3): with the name living in here, `disabled:opacity-30` on the button
										     washed out every section name on the page for the length of a reorder
										     write — the exact regression F3 removed from the row. The refusal is
										     already real (`disabled`), so the affordance only has to show on the
										     control itself. -->
										<svg
											aria-hidden="true"
											viewBox="0 0 16 16"
											class="h-3 w-3 shrink-0 fill-current group-hover:text-ink group-disabled:opacity-30"
										>
											<path
												d="M11.3 1.3a1 1 0 0 1 1.4 0l2 2a1 1 0 0 1 0 1.4l-8 8-3.7 1 1-3.7 8-8z"
											/>
										</svg>
										<!-- While THIS row is being renamed the editor beside it already shows the
										     name in an <input>; printing it here too would show it twice. The
										     button itself stays mounted-and-disabled (the #155/S4 "ALWAYS
										     rendered" contract). -->
										{#if renamingSectionId !== row.id}
											<span class="truncate text-sm">{row.name}</span>
										{/if}
									</button>
									<!-- #205 review F1 (round 2) — the "(n)" roll-up reads AFTER the name, as it
									     always has ("Soprano (3)"). The first GREEN left it inside the reorder
									     row while the name moved into the activator BESIDE that row, so each
									     row reversed to "grip (3) ✎ Soprano" — and, because the row was
									     `grow` (basis auto) next to a `flex-1` (basis 0) activator, the free
									     width split between them and pushed the name to roughly mid-row. The
									     count is a SIBLING here rather than a child of the activator so that
									     tapping it is not "rename", and outside the row so the row keeps no
									     visible text of its own. The row is `shrink-0` around the grip now, so
									     the activator's `flex-1` starts immediately after the depth indent and
									     the indent step lands on the NAME, where the tree cue belongs. -->
									<span data-testid="arrange-count-{row.id}" class="shrink-0 pl-2 text-sm text-ink"
										>({row.memberCount})</span
									>
									<!-- #155/S3 — indent/unindent: ALWAYS rendered (not grab-gated), so a
									     pointer-only admin can restructure the tree without ever touching
									     the keyboard grab machine. SIBLINGS of the row, never children of
									     it (review R2/F1, see the wrapper comment above): the row is the
									     `role="button"` reorder control, and nesting a real `<button>`
									     inside one both pollutes its accessible name and creates the
									     `nested-interactive` violation. Sitting outside the row's subtree
									     also means nothing they emit can reach `handleHandleKeydown`, so
									     no `stopPropagation()` on either handler is needed any more
									     (review F1 shipped one when they were still children; the
									     containment fix retires it — the
									     `event.target !== event.currentTarget` guard inside
									     `handleHandleKeydown` stays as belt-and-braces).
									     TABINDEX="-1" — POINTER/TOUCH ONLY, deliberately. Mihkel's
									     ruling, recorded in `.claude/workflows/roving-tabindex-pipeline.js`
									     (#156 SPIKE brief: "EXCLUDED: buttons with tabindex=-1 that are
									     mouse/touch only (like indent/unindent per Mihkel ruling)"), and
									     re-affirmed by #156 review checklist item 10. These two are the
									     ONLY controls in the row action cluster with a full keyboard
									     equivalent elsewhere: focus the row, Space/Enter to grab, then
									     ArrowRight indents / ArrowLeft unindents through the SAME
									     `handleIndent`/`handleUnindent` seam (`handleHandleKeydown`,
									     ~line 2100). Two tab stops per row for a move the row itself
									     already offers is noise, so they are dropped from the tab order
									     rather than roved. Rename and delete have NO such equivalent, so
									     they stay real tab stops until a row-level story exists for them
									     — the asymmetry inside this wrapper is intentional, not an
									     oversight. Pinned in page.roster-indent.spec.ts.
									     No text nodes inside either button (SVG glyph only,
									     `aria-hidden`): the accessible name comes from `aria-label`, and
									     a text glyph here would land in the slot's own text — leaking
									     into `textContent` assertions (e.g. "Soprano (4)") the moment two
									     rows sit in the same list — the grip bars beside them use the
									     same no-text-node trick for the same reason. `reorderPending`
									     disables EVERY button while any structural write (reorder or
									     reparent) is outstanding — the same one-at-a-time posture
									     `reorderPending` already enforces on the drag handle. -->
									<!-- #252 — findable and tappable (Joosep's report + Gama's
									     correction: this is a real usability defect on its own merits,
									     sequenced after #253's write-integrity fix). Four stated choices
									     (issue demands stated, not silent, decisions):
									     (a) TOUCH TARGET — `min-h-11 min-w-11` on the `<button>` itself,
									     the same 44px standard the season trashcan/gear/create/close
									     controls already keep elsewhere on this page and admin/+page;
									     the glyph inside stays a small `h-4 w-4` — only the hit area
									     grows, chosen over enlarging the glyph so the row doesn't visibly
									     thicken to reach it.
									     (b) INAPPLICABLE DIRECTION — `invisible` (not `hidden`/removed),
									     keyed on applicability ALONE (`indentApplicable`/
									     `unindentApplicable` above), never on the full `disabled` value:
									     a transient `structuralWritePending` lock still shows the glyph,
									     dimmed (`disabled:opacity-60`) — only a direction that does not
									     exist here disappears. `invisible` keeps the `min-h-11 min-w-11`
									     box in the layout (`display` untouched), so a row never jumps
									     when applicability flips (e.g. unindenting Soprano 1 out from
									     under Soprano). Picked over restyled-disabled because Mihkel's
									     own direction on this issue is "show only active actions" — a
									     faded-but-still-shaped triangle is still a ghost control.
									     (c) DISTINGUISHABILITY — indent stays a SOLID triangle
									     (`fill-current`); unindent is now an OUTLINE triangle
									     (`fill-none stroke-current`), same geometry mirrored. Solid vs.
									     outline is a categorical (fill/no-fill) difference on top of the
									     existing left/right orientation, not just a mirror of one shape
									     — at 16px that reads as "adding a level" vs. "releasing one"
									     even before orientation is parsed, which a same-weight mirror
									     pair cannot offer (mirror symmetry is exactly what a quick glance
									     struggles to tell apart — the pinned defect, GH#252 item 3).
									     (d) TONE — base `text-ink` (this page's normal control ink),
									     not `text-ink-2`: a control the user is being asked to LOCATE
									     must not be the quietest thing on the row (GH#252 item 4, #238
									     finding) — even though `text-ink-2` is otherwise this page's own
									     icon-button convention (the grip, :3258), that convention is
									     exactly what read as invisible here. -->
									<button
										type="button"
										data-testid="arrange-indent-{row.id}"
										aria-label={m.roster_section_indent({ name: row.name })}
										title={m.roster_section_indent({ name: row.name })}
										disabled={structuralWritePending ||
											renamingSectionId === row.id ||
											!indentApplicable}
										tabindex="-1"
										class="flex min-h-11 min-w-11 items-center justify-center rounded text-ink disabled:cursor-default disabled:opacity-60 {indentApplicable
											? ''
											: 'invisible'}"
										onclick={() => void handleIndent(node)}
									>
										<svg aria-hidden="true" viewBox="0 0 16 16" class="h-4 w-4 fill-current">
											<path d="M4 2 L12 8 L4 14 Z" />
										</svg>
									</button>
									<button
										type="button"
										data-testid="arrange-unindent-{row.id}"
										aria-label={m.roster_section_unindent({ name: row.name })}
										title={m.roster_section_unindent({ name: row.name })}
										disabled={structuralWritePending ||
											renamingSectionId === row.id ||
											!unindentApplicable}
										tabindex="-1"
										class="flex min-h-11 min-w-11 items-center justify-center rounded text-ink disabled:cursor-default disabled:opacity-60 {unindentApplicable
											? ''
											: 'invisible'}"
										onclick={() => void handleUnindent(node)}
									>
										<svg
											aria-hidden="true"
											viewBox="0 0 16 16"
											class="h-4 w-4 fill-none stroke-current"
											stroke-width="1.5"
											stroke-linejoin="round"
										>
											<path d="M12 2 L4 8 L12 14 Z" />
										</svg>
									</button>
									<!-- #155/S4 — DELETE: reuses `armRemove`/`disarmRemove`/
									     `handleRemoveSection`/`pendingRemoveId` VERBATIM (same testids
									     too — `section-remove-*`), the exact two-step-confirm write seam
									     `sectionGroup` used to render. Only the RENDERING moved: always
									     shown, `disabled` when `!canDelete` rather than absent, per the
									     task's own "Disable for sections with children/members". -->
									{#if pendingRemoveId === row.id}
										<button
											type="button"
											data-testid="section-remove-confirm-{row.id}"
											aria-label={m.roster_section_remove_confirm({ name: row.name })}
											class="rounded px-1 text-xs text-red-700 underline"
											onclick={() => void handleRemoveSection(row.id)}
										>
											{m.roster_section_remove_confirm_short()}
										</button>
										<button
											type="button"
											data-testid="section-remove-cancel-{row.id}"
											aria-label={m.roster_section_remove_cancel({ name: row.name })}
											class="rounded px-1 text-xs text-ink-2 underline hover:text-ink"
											onclick={() => void disarmRemove(row.id)}
										>
											{m.roster_section_remove_cancel_short()}
										</button>
									{:else}
										<button
											type="button"
											data-testid="section-remove-{row.id}"
											aria-label={m.roster_section_remove({ name: row.name })}
											title={m.roster_section_remove({ name: row.name })}
											disabled={structuralWritePending ||
												renamingSectionId === row.id ||
												!canDelete}
											class="rounded p-1 text-xs text-ink-2 hover:text-red-700 disabled:cursor-default disabled:opacity-30 disabled:hover:text-ink-2"
											onclick={() => void armRemove(row.id)}
										>
											✕
										</button>
									{/if}
								</div>
								{#if renameError?.id === row.id}
									<!-- #155/S4 — same "say it, don't just log it" discipline as
									     `sectionWriteError`/`removeError` above. role="alert": nothing
									     else on screen names the failure (the input has already closed). -->
									<p
										data-testid="arrange-rename-error-{row.id}"
										role="alert"
										class="text-xs text-red-700 {arrangeIndentClass(row.depth)}"
									>
										{m.roster_section_rename_failed({ name: renameError.name })}
									</p>
								{/if}
							{/if}
						{/each}
						{#if arrangeDropHintBeforeId === ARRANGE_DROP_HINT_END}
							{@render dropIndicator()}
						{/if}
					</div>
					{#if admin === 'admin'}
						<!-- #155/S4 — "Add section" RELOCATED into Arrange mode exclusively
						     (was page-level, rendered regardless of viewMode — #124). Reuses
						     `createSection`/`pageCreateOpen`/`submitPageCreate` VERBATIM, same
						     testids too (`roster-new-section*`) — only WHERE it renders moved. -->
						<div class="flex flex-col gap-1.5 border-t border-dashed border-ink-5 pt-3">
							{#if !pageCreateOpen}
								<button
									type="button"
									data-testid="roster-new-section"
									class="self-start rounded-md border border-ink px-3 py-1.5 text-xs tracking-wide text-ink uppercase hover:bg-ink hover:text-paper"
									onclick={openPageCreateForm}
								>
									{m.roster_new_section()}
								</button>
							{:else}
								<div
									data-testid="roster-new-section-form"
									role="dialog"
									aria-label={m.roster_new_section_form_label()}
									class="flex flex-col gap-1.5"
								>
									<input
										type="text"
										data-testid="roster-new-section-name"
										bind:this={pageCreateNameInput}
										aria-label={m.roster_section_name_label()}
										placeholder={m.roster_section_name_label()}
										aria-invalid={pageCreateError ? true : undefined}
										aria-describedby={pageCreateError ? 'roster-new-section-error' : undefined}
										value={pageCreateName}
										oninput={(e) => (pageCreateName = (e.currentTarget as HTMLInputElement).value)}
										onkeydown={onPageCreateNameKeydown}
										class="border border-ink-5 bg-paper px-1.5 py-1 text-ink"
									/>
									<select
										data-testid="roster-new-section-parent"
										aria-label={m.roster_section_parent_label()}
										value={pageCreateParentId}
										onchange={(e) => (pageCreateParentId = (e.currentTarget as HTMLSelectElement).value)}
										class="border border-ink-5 bg-paper px-1.5 py-1 text-ink"
									>
										<option value="">{m.roster_new_section_top_level()}</option>
										{#each ownOrgFlatSections as node (node.id)}
											<option value={node.id}>{pageCreateParentLabel(node)}</option>
										{/each}
									</select>
									{#if pageCreateError}
										<!-- F5-style loud inline failure, same discipline as the picker's
										     own create-error paragraph: role="alert" + aria-describedby
										     on the input above. -->
										<p
											id="roster-new-section-error"
											role="alert"
											data-testid="roster-new-section-error"
											class="text-xs text-red-700"
										>
											{pageCreateError()}
										</p>
									{/if}
									<div class="flex gap-2">
										<button
											type="button"
											data-testid="roster-new-section-submit"
											class="border border-ink px-2 py-1 text-xs text-ink hover:bg-ink hover:text-paper"
											onclick={() => void submitPageCreate()}
										>
											{m.roster_create_assign()}
										</button>
										<button
											type="button"
											data-testid="roster-new-section-cancel"
											class="px-2 py-1 text-xs text-ink-2 hover:text-ink"
											onclick={closePageCreateForm}
										>
											{m.roster_cancel()}
										</button>
									</div>
								</div>
							{/if}
						</div>
					{/if}
				{:else}
					<div data-testid="roster-groups" class="flex flex-col">
						{#each visibleSections as node (node.id)}
							{@render sectionGroup(node)}
						{/each}
						{#if unassignedGroup}
							{@const isExpanded = expandedIds.has('unassigned')}
							<section data-testid="section-group-unassigned" data-depth="0" class="flex flex-col">
								<button
									type="button"
									data-testid="section-toggle-unassigned"
									aria-expanded={isExpanded}
									aria-controls={isExpanded ? 'section-region-unassigned' : undefined}
									class="flex items-center gap-2 py-1.5 text-left"
									onclick={() => toggleSection('unassigned')}
								>
									<span aria-hidden="true" class="text-ink-2">{isExpanded ? '▾' : '▸'}</span>
									<span data-testid="section-header-unassigned" class="text-sm font-medium text-ink">
										{m.roster_unassigned()} ({unassignedGroup.memberCount})
									</span>
								</button>
								{#if isExpanded}
									<ul id="section-region-unassigned" class="flex flex-col pl-5">
										{#each unassignedGroup.members as row (row.memberId)}
											{@render memberRow(row, false)}
										{/each}
									</ul>
								{/if}
							</section>
						{/if}
					</div>
				{/if}
			{:else}
				<ul data-testid="roster-flat-list" class="flex flex-col">
					{#each flatRows as row (row.memberId)}
						{@render memberRow(row, true)}
					{/each}
				</ul>
			{/if}
		{/if}

		{#if admin === 'admin' && status === 'ready'}
			<!-- #255 (B) — the inactive-members surface: deliberately OUT of the
			     normal roster flow (a collapsed, closed-by-default panel below
			     everything else, never preloaded alongside the active roster —
			     engineering's placement call). Shows each inactive member's SECTION
			     assignment (adopted binding — this is what explains a section that
			     refuses deletion while holding only inactive members, with zero
			     write-path change) and reinstates with ONE action, no invitation. -->
			<div class="flex flex-col gap-2 border-t border-dashed border-ink-5 pt-3">
				<button
					type="button"
					data-testid="roster-inactive-toggle"
					aria-expanded={showInactive}
					class="self-start text-xs tracking-wide text-ink-2 uppercase underline hover:text-ink"
					onclick={() => toggleInactive()}
				>
					{showInactive ? m.roster_inactive_hide() : m.roster_inactive_show()}
				</button>
				{#if showInactive}
					{#if inactiveLoadError}
						<p data-testid="roster-inactive-load-error" role="alert" class="text-sm text-red-700">
							{m.roster_inactive_load_error()}
						</p>
					{:else if inactiveRows.length === 0}
						<p data-testid="roster-inactive-empty" class="text-xs text-ink-2">{m.roster_inactive_empty()}</p>
					{:else}
						<ul data-testid="roster-inactive-list" class="flex flex-col">
							{#each inactiveRows as row (row.memberId)}
								{@const inactiveSectionNames = (row.sectionIds ?? [])
									.map((id) => sectionNameById.get(id))
									.filter((name): name is string => Boolean(name))}
								<li
									data-testid="inactive-member-row-{row.memberId}"
									class="flex flex-col gap-0.5 border-b border-dashed border-ink-5 py-2 last:border-b-0"
								>
									<span class="text-sm text-ink">{row.name}</span>
									{#if inactiveSectionNames.length > 0}
										<span data-testid="inactive-member-section-{row.memberId}" class="text-xs text-ink-2">
											{inactiveSectionNames.join(', ')}
										</span>
									{/if}
									<button
										type="button"
										data-testid="member-reinstate-{row.memberId}"
										class="self-start rounded-md border border-ink px-3 py-1 text-xs hover:bg-ink hover:text-paper disabled:cursor-not-allowed disabled:opacity-50"
										disabled={reinstatePending !== null}
										onclick={() => handleReinstate(row.memberId)}
									>
										{m.roster_member_reinstate()}
									</button>
									{#if deactivateActionError?.memberId === row.memberId && deactivateActionError.kind === 'reinstate'}
										<!-- #255 review F2 — same loud-failure idiom as the deactivate
										     alert above: a failed reinstate leaves this row exactly
										     where it is, which on its own reads as a dead button. -->
										<p
											data-testid="member-reinstate-failed-{row.memberId}"
											role="alert"
											class="text-xs text-red-700"
										>
											{m.roster_member_reinstate_failed({ name: row.name })}
										</p>
									{/if}
								</li>
							{/each}
						</ul>
					{/if}
				{/if}
			</div>
		{/if}
	</div>
</main>
