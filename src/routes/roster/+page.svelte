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
		reorderSections
	} from '$lib/sections/sectionActions';
	import { isSectionMembershipMissing } from '$lib/sections/sectionErrors';
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

		let newId: string;
		try {
			newId = await createSection(cfg, input);
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
			depth,
			children: []
		};
		// The section itself was genuinely created server-side — it belongs in the
		// tree regardless of how the assign below goes.
		sections = insertSectionNode(sections, newNode, input.parentId);

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
	// (`disabled` on ▲/▼, `draggable="false"` on the handle) so a double-tap is
	// visibly refused rather than silently swallowed; the early return below is
	// the defensive backstop for the paths the UI can't disable.
	let reorderPending = $state(false);

	// #99 review F2 — a failed reorder used to be SILENT to the user: the catch
	// path below logs, refetches, and swaps `sections`, so the list visibly snaps
	// to a different order (the server's partial truth) with nothing on screen
	// saying why, and a screen-reader user gets nothing at all. Every other write
	// path on this page surfaces `role="alert"` (section-write-error-*,
	// roster-load-error, roster-sections-load-error) — the reorder path, the one
	// TS.4 added, had none.
	let reorderError = $state(false);

	// #99 review F3 — the keyboard reorder path had no result announcement at all:
	// ▲/▼ moved the section, the DOM reordered silently, and a screen-reader user
	// pressing ▲ got no confirmation anything happened (the DRAG path at least
	// announces state via aria-grabbed/aria-dropeffect). Rendered into a
	// visually-hidden role="status" region — see `roster-reorder-status` below.
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
	// so every input path (native drop, touch drop, ▲/▼) gets them for free.
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

	// F1 code-review fix (#98 review): a dragstart handler MUST populate the drag
	// data store. Firefox refuses to START a drag session at all when the store is
	// left empty — dragstart fires, then no dragover/drop ever follows, so the
	// whole drop path is dead there (silently: the ▲/▼ buttons still work).
	// `draggedSectionId` stays the source of truth on drop — it survives the
	// cross-handler hop just as it did before; `setData` is here to satisfy the
	// browser's drag-initiation precondition, not to carry state.
	function handleDragStart(id: string, event: DragEvent): void {
		draggedSectionId = id;
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
	}

	function handleDragOver(event: DragEvent): void {
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

	// #99 review F3 — the ▲/▼ buttons DESTROY THEIR OWN FOCUS TARGET: `performReorder`
	// flips `reorderPending` synchronously, so the button the user just activated is
	// `disabled` in the same update, and a browser blurs an element that becomes
	// disabled while focused — focus drops to <body> and the next Tab restarts at the
	// top of the document (WCAG 2.4.3, the same defect class F1 fixed for the picker).
	// At a boundary it is permanent: ▲ on the second sibling moves it to index 0, so
	// the button STAYS disabled once the write settles and there is nothing to return
	// to.
	//
	// The `disabled` attribute stays (a refused control is the honest affordance, and
	// it is pinned) — focus is restored explicitly instead: back onto the same button
	// if it is still operable, otherwise onto `section-toggle-<id>`, which always
	// renders, is always focusable, and names the section that moved. Looked up by
	// data-testid rather than off the click event: Svelte 5 DELEGATES click, so
	// `currentTarget` is a patched property, and the id+direction already identify
	// the button exactly.
	function reorderButton(id: string, direction: 'up' | 'down'): HTMLButtonElement | null {
		return document.querySelector<HTMLButtonElement>(
			`[data-testid="section-move-${direction}-${id}"]`
		);
	}

	async function moveSection(id: string, direction: 'up' | 'down'): Promise<void> {
		const siblingNodes = siblingsOf(sections, id);
		if (!siblingNodes) return;
		const siblingIds = siblingNodes.map((n) => n.id);
		const idx = siblingIds.indexOf(id);
		const swapWith = direction === 'up' ? idx - 1 : idx + 1;
		if (swapWith < 0 || swapWith >= siblingIds.length) return; // boundary — no wraparound

		// Only restore focus if the reorder is what LOST it: focus already sitting on
		// something else is the user's own doing, and yanking it back would fight them
		// (the same `hadFocus` discipline as the picker's `closeMenu`).
		const activated = reorderButton(id, direction);
		const active = document.activeElement;
		const ownsFocus = !active || active === document.body || active === activated;

		const afterIds = [...siblingIds];
		[afterIds[idx], afterIds[swapWith]] = [afterIds[swapWith], afterIds[idx]];
		await performReorder(siblingIds, afterIds, id);
		if (!ownsFocus) return;
		await tick(); // let the re-enabled/boundary-disabled buttons settle first
		const settled = reorderButton(id, direction);
		if (settled && !settled.disabled) {
			settled.focus();
			return;
		}
		document.querySelector<HTMLElement>(`[data-testid="section-toggle-${id}"]`)?.focus();
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
				memberName={row.name}
				{sections}
				selectedIds={row.sectionIds ?? []}
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

{#snippet sectionGroup(node: SectionNode)}
	{@const group = groupById.get(node.id)}
	{@const isExpanded = !collapsedIds.has(node.id)}
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
		<!-- The touch-drag affordance stands in for the drag image the browser draws
		     for a native drag and does not for a pointer one: without it a long-press
		     drag has no visible drop target at all. -->
		<div
			role="group"
			aria-label={node.name}
			aria-dropeffect={acceptsDrop ? 'move' : undefined}
			data-drop-target={acceptsTouchDrop ? 'true' : undefined}
			class="flex items-center gap-2 py-1.5 {acceptsTouchDrop ? 'bg-ink-5' : ''}"
			ondragover={acceptsDrop ? handleDragOver : undefined}
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
				     same `dropOnto`. The ▲/▼ buttons remain the keyboard/a11y path.
				     `touch-action: none` is what lets a drag off the handle be a drag
				     rather than a page scroll.
				     Both paths are disabled while a reorder write is in flight — see
				     `reorderPending`. -->
				<!-- #99 review F5: role="img", NOT role="button". The handle is deliberately
				     not focusable and implements no activation of its own (the keyboard
				     path is the labelled ▲/▼ buttons below), so announcing it as a button
				     promised a screen-reader user a control they could never operate.
				     role="img" + aria-label keeps it a NAMED, non-hidden object that can
				     still carry the drag state. -->
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
				<button
					type="button"
					data-testid="section-move-up-{node.id}"
					aria-label={m.roster_section_move_up({ name: node.name })}
					class="rounded px-1 text-xs text-ink-2 hover:text-ink disabled:opacity-30"
					disabled={siblingIdx <= 0 || reorderPending}
					onclick={() => void moveSection(node.id, 'up')}
				>
					▲
				</button>
				<button
					type="button"
					data-testid="section-move-down-{node.id}"
					aria-label={m.roster_section_move_down({ name: node.name })}
					class="rounded px-1 text-xs text-ink-2 hover:text-ink disabled:opacity-30"
					disabled={siblingIdx === -1 || siblingIdx >= siblingIds.length - 1 || reorderPending}
					onclick={() => void moveSection(node.id, 'down')}
				>
					▼
				</button>
			{/if}
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
