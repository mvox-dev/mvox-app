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
	import { getToken } from '$lib/auth/storage';
	import { selectedCollectiveStore } from '$lib/collectives/store';
	import { loadRoster, type RosterRow } from '$lib/roster/rosterData';
	import { listSections, groupBySection, type SectionNode, type SectionGroup } from '$lib/sections/sectionData';
	import {
		assignMemberSection,
		unassignMemberSection,
		createSection,
		reorderSections,
		deleteSection
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
	// SPIKE root cause (2026-08-12, #124 check 4): `currentOrgId` used to read
	// `rows.find((r) => r.orgId)?.orgId` — i.e. whichever roster row `loadRoster`
	// happened to sort first (alphabetically), NOT the viewer. `loadRoster`'s
	// member query is not org-scoped either, so on a multi-org db the first row
	// can legitimately belong to another org, silently migrating every
	// destructive control onto the wrong collective's sections and rendering a
	// FOREIGN org's empty "(0)" section without its remove control while the
	// viewer's own kept one — two headers reading identically, disagreeing.
	// "Whose roster is this?" is answered from the AUTHENTICATED VIEWER's own
	// roster row (matched by `personId`, carried on `selected` from the token's
	// accounts map — see `Collective.personId`), never a guess from row order.
	/** The collective's organization id, read off the VIEWER's own roster row
	 *  (matched by `personId`) — falls back to the first row exposing an
	 *  `orgId` ONLY when the viewer has no row of her own on this roster (an
	 *  admin auditing a roster she isn't a member of, or a single-org fixture
	 *  that never gave the viewer a matching `personId`); null when neither
	 *  answers anything (org unknown to this reader entirely). The fallback is
	 *  intentionally the OLD heuristic, kept as a last resort rather than
	 *  removed outright: on the single-org fixtures it always ran against, "the
	 *  first row's org" and "the viewer's org" are the same answer — the
	 *  multi-org ambiguity #124/F3 fixes only bites when the viewer's OWN row
	 *  is present but sorts non-first, which the primary lookup above already
	 *  handles before the fallback is ever reached. */
	const currentOrgId = $derived(
		rows.find((r) => r.personId === selected?.personId)?.orgId ??
			rows.find((r) => r.orgId)?.orgId ??
			null
	);

	/** #124 (F3) — the section tree filtered to the viewer's OWN org: a
	 *  top-level (root) section is kept only when its `orgId` matches
	 *  `currentOrgId`; a kept root's WHOLE subtree comes along with it (a
	 *  sub-section carries no org `_parent` of its own — v4E
	 *  `parentConstraint: 'exactly_one_of'` — so it can never be split from its
	 *  root). Permissive when `currentOrgId` is unknown (an unauthenticated
	 *  reader, or a pre-#124 fixture with no `orgId` on any row) — keeps
	 *  everything, same "unknown means don't restrict" rule `isOwnOrgSection`
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
		currentOrgId === null ? sections : sections.filter((n) => (n.orgId ?? null) === currentOrgId)
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

	// ── #110 review F2 / #124 F3: `isOwnOrgSection` — a defense-in-depth backstop.
	//
	// `currentOrgId`/`visibleSections` above already keep a foreign org's section
	// OUT of the render entirely (#124/F3), so in practice every node reaching
	// `canRemove` below has already passed that filter. `isOwnOrgSection` stays as
	// a second, independent check on the same question (never trust one gate for
	// a destructive control) — see #110 review F2's original ruling: a
	// destructive affordance on another org's entity must never ship, belt AND
	// braces.
	/** section id → the OWNING org id of its top-level root. Sub-sections carry no
	 *  org `_parent` of their own (v4E `parentConstraint: 'exactly_one_of'`), so
	 *  the root's org is propagated down the subtree. */
	const rootOrgBySectionId = $derived.by(() => {
		const map = new Map<string, string | null>();
		function walk(nodes: SectionNode[], rootOrg: string | null): void {
			for (const n of nodes) {
				const org = n.parentId === null ? (n.orgId ?? null) : rootOrg;
				map.set(n.id, org);
				walk(n.children, org);
			}
		}
		walk(sections, null);
		return map;
	});

	/**
	 * True when `id` is NOT known to belong to a different organization. Permissive
	 * when either side is unknown — a reader who cannot see any org `_parent`
	 * (rosterData never throws on that) or a tree from a pre-TU.1 fixture must not
	 * lose its own controls; the check exists to exclude sections we can POSITIVELY
	 * place in another org.
	 */
	function isOwnOrgSection(id: string): boolean {
		const org = rootOrgBySectionId.get(id) ?? null;
		if (org === null || currentOrgId === null) return true;
		return org === currentOrgId;
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

	// Whether ANY section is currently expanded — not "all", because a single
	// manually-expanded section (finding #9's "manually part-expanded" case)
	// must still read as "there's something open" and collapse fully on the
	// next toggle-all tap, not expand further.
	//
	// #110 review F3 — derived from what is actually ON SCREEN
	// (`allSectionIdsList` walks the live tree plus the unassigned pseudo-group),
	// NOT from `expandedIds.size`. A set member whose section is gone (removed
	// leaf, or a leftover from a previous collective) must not make the toggle
	// read "Collapse all sections" over a fully-collapsed tree, where the first
	// tap would visibly do nothing but clear the stale set.
	const anySectionExpanded = $derived(allSectionIdsList.some((id) => expandedIds.has(id)));

	function toggleAllSections(): void {
		expandedIds = anySectionExpanded ? new Set() : new Set(allSectionIdsList);
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
	 *  falls back to the collapse-all control that always renders above the
	 *  groups. */
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
		await tick();
		const neighbour = targetId
			? document.querySelector<HTMLElement>(`[data-testid="section-toggle-${targetId}"]`)
			: null;
		(neighbour ?? document.querySelector<HTMLElement>('[data-testid="sections-toggle-all"]'))?.focus();
	}

	/** …and after a REFUSED one: nothing was removed, so the ✕ that the Confirm
	 *  button replaced is back in the header row and is the honest landing (the
	 *  header itself only as a fallback — `canRemove` could have gone false under
	 *  a concurrent refetch). The error text is announced separately by
	 *  `section-remove-error`'s role="alert". */
	async function placeFocusAfterFailedRemove(id: string): Promise<void> {
		await tick();
		(
			document.querySelector<HTMLElement>(`[data-testid="section-remove-${id}"]`) ??
			document.querySelector<HTMLElement>(`[data-testid="section-toggle-${id}"]`)
		)?.focus();
	}

	// #113 review F1 — a SUCCESSFUL remove was also the one outcome with no
	// announcement at all: the failure path has `section-remove-error`
	// (role="alert") and the reorder path has `roster-reorder-status`, so the
	// delete that actually worked was the one thing a screen-reader user got no
	// confirmation of (WCAG 4.1.3). Its own visually-hidden role="status"
	// region, mirroring `reorderStatus` — see `roster-section-remove-status`.
	let removeStatus = $state('');

	async function handleRemoveSection(id: string): Promise<void> {
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
		const before = sections;
		sections = removeSectionNode(sections, id);
		try {
			await deleteSection(cfg, id);
			// #110 review F3 — the node is gone for good, so its collapse-state entry
			// is dead weight. Pruned only AFTER the write lands: a rejected delete
			// restores the tree, and the section's expanded state must come back with
			// it. (`anySectionExpanded` no longer depends on this pruning for
			// correctness — it reads the live tree — but the set should not keep
			// growing across removals either.)
			if (expandedIds.has(id)) {
				const next = new Set(expandedIds);
				next.delete(id);
				expandedIds = next;
			}
			removeStatus = m.roster_section_removed({ name });
			if (ownsFocus) await placeFocusAfterRemove(fallbackId);
		} catch (e) {
			console.error('roster: section remove failed', id, e);
			sections = before;
			// #110 review F1/F3 — say it, don't just log it. `section-not-empty` is
			// its own message: nothing was written, and "it's not actually empty" is
			// a different instruction to the user than "the delete was refused".
			removeError = { name, kind: isSectionNotEmpty(e) ? 'not-empty' : 'write' };
			if (ownsFocus) await placeFocusAfterFailedRemove(id);
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
		// (RosterRow.orgId, carried from the member's `_parent`) — never let the
		// data layer fall back to its `limit=1` guess, which live-verifiably
		// returns the umbrella federation, not the collective.
		const orgId = rows.find((r) => r.memberId === memberId)?.orgId;

		let newId: string;
		try {
			newId = await createSection(cfg, { ...input, orgId });
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
			orgId: input.parentId ? null : (orgId ?? null),
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
			newId = await createSection(cfg, { name, parentId, orgId: currentOrgId });
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
			orgId: parentId ? null : (currentOrgId ?? null),
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

	/** Immutable reorder: whichever level's id SET matches `orderedIds` exactly
	 *  gets rebuilt in that order (nodes themselves, incl. `children`, untouched
	 *  — only the array's order changes); every ancestor on the path down to it
	 *  is rebuilt too, so reassigning `sections` is enough to notify Svelte. */
	function applySiblingOrder(nodes: SectionNode[], orderedIds: string[]): SectionNode[] {
		if (nodes.length === orderedIds.length && orderedIds.every((id) => nodes.some((n) => n.id === id))) {
			const byId = new Map(nodes.map((n) => [n.id, n]));
			return orderedIds.map((id) => byId.get(id)!);
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
	async function performReorder(
		beforeIds: string[],
		afterIds: string[],
		movedId: string
	): Promise<void> {
		if (reorderPending) return;
		const cfg = currentCfg;
		if (!cfg) {
			console.error('roster: section reorder with no cfg', afterIds);
			reorderError = true;
			return;
		}
		const g = generation;
		reorderPending = true;
		// A fresh attempt owns both slots — a previous failure's alert must not
		// outlive the retry that fixed it, and a stale "moved to position 2" must
		// not sit in the live region while a new move is in flight.
		reorderError = false;
		reorderStatus = '';
		sections = applySiblingOrder(sections, afterIds);
		try {
			await reorderSections(cfg, afterIds);
			reorderStatus = m.roster_section_moved({
				name: findSectionNode(sections, movedId)?.name ?? movedId,
				position: afterIds.indexOf(movedId) + 1,
				total: afterIds.length
			});
		} catch (e) {
			console.error('roster: section reorder failed', e);
			reorderError = true;
			try {
				const fresh = await listSections(cfg);
				if (g !== generation) return; // superseded by a newer collective selection
				sections = fresh;
			} catch (refetchError) {
				console.error('roster: section refetch after a failed reorder failed', refetchError);
				if (g === generation) sections = applySiblingOrder(sections, beforeIds);
			}
		} finally {
			reorderPending = false;
		}
	}

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

		const siblingNodes = siblingsOf(sections, fromId);
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
		const under = document.elementFromPoint?.(x, y);
		const group = under?.closest('[data-testid^="section-group-"]') ?? null;
		const testid = group?.getAttribute('data-testid') ?? '';
		const id = testid.slice('section-group-'.length);
		return id && id !== 'unassigned' ? id : null;
	}

	function handlePointerDown(id: string, event: PointerEvent): void {
		if (event.pointerType === 'mouse') return; // the native dnd path owns mouse
		if (reorderPending) return; // same in-flight refusal as `draggable="false"`
		endTouchDrag();
		// Derived from `target`, not `currentTarget`: Svelte 5 DELEGATES pointer
		// events from the root, so `currentTarget` is a patched property rather than
		// the real one — `closest` off the actual target is the version that cannot
		// be wrong.
		const handle = (event.target as HTMLElement | null)?.closest?.(
			'[data-testid^="section-drag-handle-"]'
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
				memberName={row.name}
				{sections}
				selectedIds={row.sectionIds ?? []}
				orgId={row.orgId}
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
	<!-- TS.4/#98: reorder controls are per-header — COLLAPSED (a section must
	     collapse to reorder) AND admin — fail-closed AND, never OR. -->
	{@const canReorder = admin === 'admin' && !isExpanded}
	{@const siblingIds = canReorder ? (siblingsOf(sections, node.id)?.map((n) => n.id) ?? []) : []}
	{@const siblingIdx = siblingIds.indexOf(node.id)}
	<!-- #99 review F4: whether this header can actually TAKE the live drag.
	     `dropOnto` silently refuses any non-sibling target (a sub-section dropped
	     on a top-level header is a STRUCTURAL move, not an order change — #98), so
	     the sibling test belongs on every affordance that says "drop here":
	     aria-dropeffect (AT), the ondragover/ondrop pair (the browser only fires
	     `drop` where dragover was prevented), and the touch highlight. Without it a
	     screen-reader user was told a foreign header would accept the move, the
	     drop was accepted, and nothing happened — with no feedback either way. -->
	{@const acceptsDrop =
		canReorder &&
		draggedSectionId !== null &&
		draggedSectionId !== node.id &&
		siblingIds.includes(draggedSectionId)}
	{@const acceptsTouchDrop =
		canReorder &&
		touchDragId !== null &&
		touchOverId === node.id &&
		touchOverId !== touchDragId &&
		siblingIds.includes(touchDragId)}
	<!-- TU.2/#110 (finding #11) — this section is the live drag's current hover
	     target: render the dashed drop-target hint inside ITS OWN group. Native
	     drag (`dragOverId`) and the touch long-press path (`touchOverId`) both
	     feed it, so the hint shows for either input.

	     #110 review F2 — BOTH branches gate on the same `acceptsDrop`/
	     `acceptsTouchDrop` the drop itself does. The touch branch used to restate
	     a weaker condition (no `canReorder`, no sibling test), and
	     `handlePointerMove` sets `touchOverId` from whatever section group is
	     under the finger regardless of parentage or expansion — so dragging a
	     sub-section handle across a top-level header painted "drop here" on a
	     target `dropOnto` silently refuses, and an EXPANDED sibling got the hint
	     wedged between its header and its member rows. That is exactly the
	     misleading affordance #99's F4 fix removed from aria-dropeffect; the hint
	     must not reintroduce it. Reusing the guards also means the hint and the
	     `bg-ink-5` highlight can never disagree about whether a drop will act. -->
	{@const showDropIndicator = (acceptsDrop && dragOverId === node.id) || acceptsTouchDrop}
	<!-- #110 review F1 — WHICH SIDE of this header the hint belongs on. `dropOnto`
	     gives the dragged section the target's ORIGINAL index, so an UPWARD move
	     (source below the target) lands the item ABOVE the target and a downward
	     move lands it BELOW. A hint pinned after the header row therefore pointed
	     one slot too low for every upward drag. `siblingIds` membership is already
	     implied by `showDropIndicator`, so `dragFromIdx` is a real index whenever
	     this is read. -->
	{@const dragFromIdx = siblingIds.indexOf(draggedSectionId ?? touchDragId ?? '')}
	{@const hintBefore = dragFromIdx > siblingIdx}
	<!-- TU.2/#110 (finding #7) — a REMOVE control on ZERO-MEMBER, ZERO-CHILDREN
	     ("leaf") sections only: deleting a section with sub-sections would orphan
	     them, so an empty PARENT stays bare — only its empty LEAF children get
	     the control. `memberCount` is the section's RECURSIVE roll-up
	     (sectionData.ts), so an empty parent with a non-empty child never
	     qualifies either way; the children.length===0 check is what actually
	     draws the "has sub-sections" line. Admin-only, same fail-closed pattern
	     as every other admin control on this page.

	     #110 review F2 — plus `isOwnOrgSection`: `listSections` is not org-scoped
	     and sections are `_sharing: public`, so the tree holds EVERY readable
	     collective's sections, and a foreign org's are all `memberCount === 0` by
	     construction (`rows` holds only the selected collective's members). Without
	     this an EFK admin's /roster offered a delete button on every other
	     collective's empty sections.

	     #110 review F3 — `memberCount` is the ROSTER's count: active + name-complete
	     members only (rosterData's query + `toRosterRow`'s #28 gate), over a tree
	     fetched once at load. A section holding only inactive/nameless members, or
	     one that gained a member since the tab opened, still reads (0) here. That is
	     why `deleteSection` re-verifies emptiness server-side and can refuse — this
	     gate decides what to OFFER, not what is safe to delete. -->
	{@const canRemove =
		admin === 'admin' &&
		(group?.memberCount ?? 0) === 0 &&
		node.children.length === 0 &&
		isOwnOrgSection(node.id)}
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
		{#if showDropIndicator && hintBefore}
			{@render dropIndicator()}
		{/if}
		<!-- The touch-drag affordance stands in for the drag image the browser draws
		     for a native drag and does not for a pointer one: without it a long-press
		     drag has no visible drop target at all. -->
		<div
			role="group"
			aria-label={node.name}
			aria-dropeffect={acceptsDrop ? 'move' : undefined}
			data-drop-target={acceptsTouchDrop ? 'true' : undefined}
			class="flex items-center gap-2 py-1.5 {acceptsTouchDrop ? 'bg-ink-5' : ''}"
			ondragover={acceptsDrop ? (event: DragEvent) => handleDragOver(node.id, event) : undefined}
			ondragleave={acceptsDrop
				? (event: DragEvent) => handleDragLeave(node.id, event)
				: undefined}
			ondrop={acceptsDrop ? (event: DragEvent) => handleDrop(node.id, event) : undefined}
		>
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
			{#if canRemove}
				<!-- #110 review F4 — a TWO-STEP inline confirm, superseding the original
				     single-activation shape. No blocking `confirm()`: the two-step lives
				     in the header row itself, matching SectionPicker's inline create form
				     and testable without stubbing a window global. The delete is
				     IRREVERSIBLE (Entu soft-deletes every property referencing the
				     entity) on a `max-w-md`, thumb-driven page — one stray tap was one
				     tap too few. `armRemove` only arms; only
				     `section-remove-confirm-<id>` writes. -->
				{#if pendingRemoveId === node.id}
					<button
						type="button"
						data-testid="section-remove-confirm-{node.id}"
						aria-label={m.roster_section_remove_confirm({ name: node.name })}
						class="rounded px-1 text-xs text-red-700 underline"
						onclick={() => void handleRemoveSection(node.id)}
					>
						{m.roster_section_remove_confirm_short()}
					</button>
					<button
						type="button"
						data-testid="section-remove-cancel-{node.id}"
						aria-label={m.roster_section_remove_cancel({ name: node.name })}
						class="rounded px-1 text-xs text-ink-2 underline hover:text-ink"
						onclick={() => void disarmRemove(node.id)}
					>
						{m.roster_section_remove_cancel_short()}
					</button>
				{:else}
					<button
						type="button"
						data-testid="section-remove-{node.id}"
						aria-label={m.roster_section_remove({ name: node.name })}
						title={m.roster_section_remove({ name: node.name })}
						class="rounded px-1 text-xs text-ink-2 hover:text-red-700"
						onclick={() => void armRemove(node.id)}
					>
						✕
					</button>
				{/if}
			{/if}
			{#if canReorder}
				<!-- TWO drag protocols on one handle, because there is no single one that
				     covers both: native `draggable` is DESKTOP-POINTER only (HTML5 dnd is
				     not driven by touch events — a long-press on a `draggable="true"`
				     element does NOT synthesise a dragstart on Android Chrome or iOS
				     Safari), and the pointer-event long-press below is the touch twin
				     (F2 code-review fix, #98 review — this page is mobile-shaped,
				     `max-w-md`, so the drag half of "works on mobile (long-press) and
				     desktop" cannot be desktop-only). `handlePointerDown` ignores mouse
				     pointers so the two never race on one gesture; both funnel into the
				     same `dropOnto`.
				     `touch-action: none` is what lets a drag off the handle be a drag
				     rather than a page scroll.
				     Both paths are disabled while a reorder write is in flight — see
				     `reorderPending`. -->
				<!-- #99 review F5: role="img", NOT role="button". The handle is deliberately
				     not focusable and implements no activation of its own, so announcing
				     it as a button promised a screen-reader user a control they could
				     never operate. role="img" + aria-label keeps it a NAMED, non-hidden
				     object that can still carry the drag state.
				     #150 — the ▲/▼ buttons that used to sit beside this handle (and were
				     this page's only KEYBOARD path to a reorder) are gone; drag/touch is
				     now the sole input. Restoring keyboard operability is tracked in
				     #152 — note that if the handle DOES become operable, this role="img"
				     choice must be revisited (F5's reasoning was conditioned on it not
				     being operable). -->
				<!-- Design question: rearrange-handle visibility for subsections (and how a
				     handle should read on a COLLAPSED sub-section vs. its parent) is TBD —
				     split out of #150 point 2 into #153, which is where the decision lands. -->
				<span
					data-testid="section-drag-handle-{node.id}"
					draggable={reorderPending ? 'false' : 'true'}
					role="img"
					tabindex="-1"
					aria-grabbed={draggedSectionId === node.id ? 'true' : 'false'}
					aria-label={m.roster_section_drag_handle({ name: node.name })}
					title={m.roster_section_drag_handle({ name: node.name })}
					style="touch-action: none"
					class="px-1 text-ink-2 select-none {reorderPending
						? 'cursor-default opacity-30'
						: 'cursor-grab'} {touchDragId === node.id ? 'opacity-50' : ''}"
					ondragstart={(event: DragEvent) => handleDragStart(node.id, event)}
					ondragend={handleDragEnd}
					onpointerdown={(event: PointerEvent) => handlePointerDown(node.id, event)}
					onpointermove={handlePointerMove}
					onpointerup={handlePointerUp}
					onpointercancel={endTouchDrag}
					onlostpointercapture={endTouchDrag}
				>
					≡
				</span>
			{/if}
		</div>
		{#if showDropIndicator && !hintBefore}
			{@render dropIndicator()}
		{/if}
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
				     cause. -->
				<p data-testid="section-reorder-error" role="alert" class="text-sm text-red-700">
					{m.roster_section_reorder_failed()}
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
				{#if admin === 'admin'}
					<!-- #124 (F1+F2) — the page-level "+ New section" entry point, ABOVE
					     the groups (same document-order contract as `sections-toggle-all`
					     right below), admin-only (fail-closed, same gate as every other
					     admin control), reachable with every section collapsed. See the
					     script-side comment above `pageCreateOpen` for the SPIKE root
					     cause this is the PRIMARY fix for. -->
					<div class="flex flex-col gap-1.5 border-b border-dashed border-ink-5 pb-3">
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
				<!-- TU.2/#110 (finding #9) — collapse-all/expand-all, ABOVE the groups
				     (pinned document-order contract) so it acts as a single entry point
				     before diving into a (now collapsed-by-default) tree. -->
				<button
					type="button"
					data-testid="sections-toggle-all"
					aria-label={anySectionExpanded
						? m.roster_sections_collapse_all()
						: m.roster_sections_expand_all()}
					class="self-start text-xs tracking-wide text-ink-2 uppercase underline hover:text-ink"
					onclick={toggleAllSections}
				>
					{anySectionExpanded ? m.roster_sections_collapse_all() : m.roster_sections_expand_all()}
				</button>
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
