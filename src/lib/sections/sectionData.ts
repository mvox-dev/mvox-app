// The section tree and the roster grouped over it; a section that cannot be placed fails loud.
import { entuFetch } from '$lib/entu/request';
import type { EntuCfg } from '$lib/seasons/entuSeasons';
import { byDisplayOrder } from '$lib/collections/displayOrder';
import type { RosterRow } from '$lib/roster/rosterData';

export interface SectionNode {
	id: string;
	name: string;
	displayOrder: number;
	parentId: string | null;
	// The owning database of a root section; null for a sub-section or a legacy organization parent.
	dbEntityId?: string | null;
	// Set when the section holds other than exactly one _parent; absent (not false) on clean nodes.
	parentDamaged?: boolean;
	depth: number;
	children: SectionNode[];
}

export interface SectionGroup {
	sectionId: string | null;
	name: string;
	depth: number;
	memberCount: number;
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

export async function listSections(
	cfg: EntuCfg,
	fetchImpl: typeof fetch = fetch
): Promise<SectionNode[]> {
	// Sections are a handful per collective, so the db-wide cap is a guard, not a silent prefix.
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

	const nodes = new Map<string, MutableNode>();
	for (const r of raw) {
		const name = r.name?.[0]?.string ?? '';
		const displayOrder = r.display_order?.[0]?.number ?? Number.POSITIVE_INFINITY;
		const parentValues = r._parent ?? [];
		// Damaged parent data is never placed by a guess: it surfaces at top level, flagged.
		const parentDamaged = parentValues.length !== 1;
		const parentId = parentDamaged
			? null
			: (parentValues.find((p) => p.entity_type === 'section')?.reference ?? null);
		const dbEntityId = parentValues.find((p) => p.entity_type === 'database')?.reference ?? null;
		nodes.set(r._id, {
			id: r._id,
			name,
			displayOrder,
			parentId,
			dbEntityId,
			depth: 0,
			children: [],
			...(parentDamaged ? { parentDamaged: true } : {})
		});
	}

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

	// A node the walk from the roots never reaches sits in a parent cycle.
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

	function sortTree(list: MutableNode[]): void {
		list.sort(byDisplayOrder);
		for (const n of list) sortTree(n.children);
	}
	sortTree(roots);

	return roots;
}

// A member of several sections appears in each; Unassigned holds members matching none.
export function groupBySection(members: RosterRow[], sections: SectionNode[]): SectionGroup[] {
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

// The roster's own order for a person picker, each member once at their first position.
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

// (*MVOX:Josquin*)
