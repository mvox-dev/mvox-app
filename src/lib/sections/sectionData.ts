import { entuFetch } from '$lib/entu/request';
import type { EntuCfg } from '$lib/seasons/entuSeasons';
import type { RosterRow } from '$lib/roster/rosterData';

// TS.1/#95 — the section READ data layer. RED (this file): every exported function
// is a STUB that throws 'not implemented' so `sectionData.spec.ts` compiles and
// FAILS on assertions until GREEN. Types are the real contract.
//
// CONTRACT (pinned by sectionData.spec.ts):
//
//   - `listSections` queries `section` entities (name, display_order, _parent) and
//     builds the RECURSIVE tree: a section whose `_parent` contains an
//     `entity_type: 'section'` entry nests under that parent; org-parented sections
//     are roots. Sorted at every level by displayOrder (missing display_order →
//     Infinity, sorts last), ties by name. FAILS LOUD (never silently drops) when a
//     fetched section cannot be placed in the tree — an unreadable/absent parent or
//     a parent cycle means we'd otherwise render a roster missing a whole section.
//   - `groupBySection` is PURE: rows + section tree → flat pre-order group list
//     (parent, then its subtree, each with `depth` for indentation), members within
//     a group sorted by name, EVERY section emitted (empty ones too — the structure
//     is the product), 'Unassigned' (sectionId: null, name: '' — the label is the
//     UI's to localize) LAST and only when non-empty. `memberCount` is the
//     recursive roll-up (direct + all descendant sections), matching the schema's
//     `member_count` formula semantics. F1 code-review fix: a row's `sectionIds`
//     is an ARRAY — the row is pushed into EVERY group whose id is among her
//     sectionIds (e.g. a section leader who also sings in the section shows up
//     in both places), never collapsed onto just one. A row whose `sectionIds`
//     is undefined / [] / contains no id present in the tree lands in Unassigned
//     — the member stays VISIBLE (grouping is presentation, not a gate; contrast
//     rosterData's #28 completeness gate which is upstream of this function).

export interface SectionNode {
	id: string;
	name: string;
	/** UI sort within parent; Number.POSITIVE_INFINITY when absent (sorts last). */
	displayOrder: number;
	/** Parent SECTION id; null for top-level (org-parented) sections. */
	parentId: string | null;
	/**
	 * #161 (collective = database, Mihkel ruling 2026-08-16) — the OWNING
	 * COLLECTIVE id of a top-level section: the `_parent` entry with
	 * `entity_type === 'database'`. `null` for a sub-section (its `_parent` IS
	 * the parent section — v4E `parentConstraint: 'exactly_one_of'`, so there is
	 * no database entry to read) AND for a root whose only non-section parent is
	 * a LEGACY "organization"-typed entry (that retired entity kind is not a
	 * collective identity anymore — never fall back to it).
	 *
	 * WHY: `parentId` alone loses the collective, exactly as `ActiveMember` used
	 * to lose it before rosterData.ts:133. The picker's sibling-scoped duplicate
	 * check needs it to tell top-level roots of DIFFERENT databases apart.
	 * `listSections` ALWAYS sets this; optional at the type level only so
	 * pre-#161 fixtures stay type-clean (same convention as `RosterRow.dbEntityId`).
	 */
	dbEntityId?: string | null;
	/** Indentation level: 0 for top-level, 1 for sub-sections, 2 for sub-sub, … */
	depth: number;
	/** Child sections, sorted by displayOrder (ties by name). */
	children: SectionNode[];
}

export interface SectionGroup {
	/** Section entity id; null identifies the 'Unassigned' group. */
	sectionId: string | null;
	/** Section name; '' for Unassigned (the localized label is the UI's job). */
	name: string;
	/** Indentation level, carried from SectionNode.depth; 0 for Unassigned. */
	depth: number;
	/** Recursive roll-up: direct members + all descendant sections' members. */
	memberCount: number;
	/** DIRECT members of this section, sorted by name. */
	members: RosterRow[];
}

interface RawSection {
	_id: string;
	name?: Array<{ string: string }>;
	display_order?: Array<{ number: number }>;
	_parent?: Array<{ reference: string; entity_type?: string }>;
}

interface MutableNode extends SectionNode {
	children: MutableNode[];
}

/**
 * List the collective's sections as a recursive tree, sorted by display_order.
 * See module header for the pinned contract.
 */
export async function listSections(
	cfg: EntuCfg,
	fetchImpl: typeof fetch = fetch
): Promise<SectionNode[]> {
	const res = await entuFetch(
		cfg.db,
		'entity?_type.string=section&props=name,display_order,_parent&limit=500',
		cfg.token,
		{},
		fetchImpl
	);
	if (!res.ok) throw new Error(`listSections failed: ${res.status}`);
	const body = (await res.json()) as { entities?: RawSection[] };
	const raw = body.entities ?? [];

	// Pass 1 — build a node per fetched section (parentId = the parent SECTION
	// id, null for database-parented roots; dbEntityId = the database `_parent`, null
	// for section-parented sub-sections and for a root whose only non-section
	// parent is a legacy `organization` entry — #161), keyed by id.
	const nodes = new Map<string, MutableNode>();
	for (const r of raw) {
		const name = r.name?.[0]?.string ?? '';
		const displayOrder = r.display_order?.[0]?.number ?? Number.POSITIVE_INFINITY;
		const parentId = (r._parent ?? []).find((p) => p.entity_type === 'section')?.reference ?? null;
		// #161 — keep the DATABASE entity, don't discard it (see SectionNode.dbEntityId):
		// roots of different databases are not siblings, and the picker needs to
		// know. A legacy `organization` `_parent` is never the collective anymore.
		const dbEntityId =
			(r._parent ?? []).find((p) => p.entity_type === 'database')?.reference ?? null;
		nodes.set(r._id, { id: r._id, name, displayOrder, parentId, dbEntityId, depth: 0, children: [] });
	}

	// Pass 2 — every non-null parent ref must resolve within the fetched set.
	// FAIL LOUD (never silently drop) — an unreadable/absent parent would
	// otherwise render a roster missing a whole section, naming both ids.
	for (const node of nodes.values()) {
		if (node.parentId !== null && !nodes.has(node.parentId)) {
			throw new Error(
				`listSections: section ${node.id} references parent ${node.parentId}, which was not found in the fetched set (unreadable, absent, or not a section)`
			);
		}
	}

	// Pass 3 — attach children, collect roots.
	const roots: MutableNode[] = [];
	for (const node of nodes.values()) {
		if (node.parentId === null) {
			roots.push(node);
		} else {
			nodes.get(node.parentId)!.children.push(node);
		}
	}

	// Pass 4 — assign depth via DFS from the roots; any node never reached is
	// part of a parent CYCLE (its parent resolves, per pass 2, but the chain
	// never bottoms out at a root) — completeness guard, fail loud.
	const visited = new Set<string>();
	function visit(node: MutableNode, depth: number): void {
		node.depth = depth;
		visited.add(node.id);
		for (const child of node.children) visit(child, depth + 1);
	}
	for (const root of roots) visit(root, 0);

	if (visited.size !== nodes.size) {
		const unreached = [...nodes.keys()].filter((id) => !visited.has(id));
		throw new Error(
			`listSections: parent cycle detected — section(s) ${unreached.join(', ')} are not reachable from any root`
		);
	}

	// Pass 5 — sort every level by displayOrder, ties by name.
	function sortTree(list: MutableNode[]): void {
		list.sort((a, b) => a.displayOrder - b.displayOrder || a.name.localeCompare(b.name));
		for (const n of list) sortTree(n.children);
	}
	sortTree(roots);

	return roots;
}

/**
 * PURE: group roster rows by their sectionIds over the section tree. See module
 * header for the pinned contract.
 *
 * F1 code-review fix: `sectionIds` is an array — a member belonging to more than
 * one section is pushed into EVERY one of those groups (not collapsed onto the
 * first, which used to silently drop her from the rest). She lands in Unassigned
 * only when NONE of her sectionIds match a known section (covers both an empty/
 * undefined array and an array whose every id is absent from the tree) — same
 * "stays visible" guarantee as the single-section case this widens.
 */
export function groupBySection(members: RosterRow[], sections: SectionNode[]): SectionGroup[] {
	// Direct members per section id, and the full set of known section ids (a
	// member with no sectionIds among them falls to Unassigned).
	const directBySection = new Map<string, RosterRow[]>();
	const knownSectionIds = new Set<string>();
	function collectIds(nodes: SectionNode[]): void {
		for (const n of nodes) {
			knownSectionIds.add(n.id);
			directBySection.set(n.id, []);
			collectIds(n.children);
		}
	}
	collectIds(sections);

	const unassigned: RosterRow[] = [];
	for (const member of members) {
		const matched = (member.sectionIds ?? []).filter((id) => knownSectionIds.has(id));
		if (matched.length > 0) {
			for (const id of matched) directBySection.get(id)!.push(member);
		} else {
			unassigned.push(member);
		}
	}
	for (const list of directBySection.values()) list.sort((a, b) => a.name.localeCompare(b.name));
	unassigned.sort((a, b) => a.name.localeCompare(b.name));

	// Recursive roll-up (post-order) — a section's memberCount is its own
	// direct members plus every descendant section's.
	const countOf = new Map<string, number>();
	function computeCounts(nodes: SectionNode[]): void {
		for (const n of nodes) {
			computeCounts(n.children);
			let total = directBySection.get(n.id)?.length ?? 0;
			for (const child of n.children) total += countOf.get(child.id) ?? 0;
			countOf.set(n.id, total);
		}
	}
	computeCounts(sections);

	// Pre-order emission, every section included (empty ones too).
	const groups: SectionGroup[] = [];
	function emit(nodes: SectionNode[]): void {
		for (const n of nodes) {
			groups.push({
				sectionId: n.id,
				name: n.name,
				depth: n.depth,
				memberCount: countOf.get(n.id) ?? 0,
				members: directBySection.get(n.id) ?? []
			});
			emit(n.children);
		}
	}
	emit(sections);

	if (unassigned.length > 0) {
		groups.push({
			sectionId: null,
			name: '',
			depth: 0,
			memberCount: unassigned.length,
			members: unassigned
		});
	}

	return groups;
}

/**
 * #209 — the ROSTER ORDER a native person <select> lists its options in (Gama
 * ruling 3): section (this tree's own order), then position within section,
 * Unassigned last — the SAME order the roster page renders via `groupBySection`.
 * Built ON TOP of `groupBySection` (never re-walks the section tree itself), so
 * every picker site shares the one ordering implementation the roster page
 * already uses.
 *
 * `groupBySection` pushes a multi-section member into EVERY one of her groups
 * (by design — the roster page shows her in each section she belongs to); a
 * person-PICKER needs her exactly once, so this flattens the groups in order
 * and keeps only each row's FIRST appearance (her earliest roster position).
 */
export function rosterOrder(rows: RosterRow[], sections: SectionNode[]): RosterRow[] {
	const groups = groupBySection(rows, sections);
	const seen = new Set<string>();
	const ordered: RosterRow[] = [];
	for (const group of groups) {
		for (const member of group.members) {
			if (seen.has(member.personId)) continue;
			seen.add(member.personId);
			ordered.push(member);
		}
	}
	return ordered;
}

// (*MVOX:Tallis* — RED stubs + interface, TS.1/#95)
// (*MVOX:Palestrina* — GREEN implementation, TS.1/#95)
// (*MVOX:Palestrina* — F1 code-review fix: multi-section members, TS.1/#95)
// (*MVOX:Palestrina* — TU.1/#109 review: SectionNode carries its owning org id)
// (*MVOX:Palestrina* — #209 GREEN: rosterOrder, shared by every native person select)
