import type { SectionNode } from '$lib/sections/sectionData';

export function findSectionNode(nodes: SectionNode[], id: string): SectionNode | null {
	for (const node of nodes) {
		if (node.id === id) return node;
		const found = findSectionNode(node.children, id);
		if (found) return found;
	}
	return null;
}

export function insertSectionNode(
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

export function removeSectionNode(nodes: SectionNode[], id: string): SectionNode[] {
	return nodes
		.filter((n) => n.id !== id)
		.map((n) => (n.children.length === 0 ? n : { ...n, children: removeSectionNode(n.children, id) }));
}

export function renameSectionNode(nodes: SectionNode[], id: string, name: string): SectionNode[] {
	return nodes.map((n) => {
		if (n.id === id) return { ...n, name };
		if (n.children.length === 0) return n;
		return { ...n, children: renameSectionNode(n.children, id, name) };
	});
}

function withDepth(node: SectionNode, depth: number): SectionNode {
	return { ...node, depth, children: node.children.map((c) => withDepth(c, depth + 1)) };
}

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

export type ReparentTarget = { kind: 'section'; sectionId: string } | { kind: 'org'; dbEntityId: string };

export function applyReparent(
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

export function flattenSections(nodes: SectionNode[]): SectionNode[] {
	const out: SectionNode[] = [];
	for (const node of nodes) {
		out.push(node);
		out.push(...flattenSections(node.children));
	}
	return out;
}

export function siblingsOf(nodes: SectionNode[], id: string): SectionNode[] | null {
	if (nodes.some((n) => n.id === id)) return nodes;
	for (const n of nodes) {
		const found = siblingsOf(n.children, id);
		if (found) return found;
	}
	return null;
}

export function applySiblingOrder(nodes: SectionNode[], orderedIds: string[]): SectionNode[] {
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

export type ArrangeRow = { id: string; name: string; depth: number; memberCount: number };

export function listArrangeRows(
	nodes: SectionNode[],
	memberCountOf: (id: string) => number
): ArrangeRow[] {
	const list: ArrangeRow[] = [];
	function walk(level: SectionNode[]): void {
		for (const n of level) {
			list.push({ id: n.id, name: n.name, depth: n.depth, memberCount: memberCountOf(n.id) });
			walk(n.children);
		}
	}
	walk(nodes);
	return list;
}

// (*MVOX:Josquin*)
