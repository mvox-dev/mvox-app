import { describe, expect, it } from 'vitest';
import type { SectionNode } from '$lib/sections/sectionData';
import {
	applyReparent,
	applySiblingOrder,
	findSectionNode,
	flattenSections,
	insertSectionNode,
	listArrangeRows,
	removeSectionNode,
	renameSectionNode,
	siblingsOf
} from './sectionTree';

function node(
	id: string,
	depth: number,
	parentId: string | null,
	children: SectionNode[] = []
): SectionNode {
	return {
		id,
		name: id.toUpperCase(),
		displayOrder: 0,
		parentId,
		dbEntityId: parentId === null ? 'db1' : null,
		depth,
		children
	};
}

function tree(): SectionNode[] {
	return [node('a', 0, null, [node('a1', 1, 'a'), node('a2', 1, 'a')]), node('b', 0, null)];
}

const ids = (nodes: SectionNode[]) => flattenSections(nodes).map((n) => n.id);

describe('sectionTree', () => {
	it('finds a nested node, and null for an unknown id', () => {
		expect(findSectionNode(tree(), 'a2')).toEqual(node('a2', 1, 'a'));
		expect(findSectionNode(tree(), 'zz')).toBeNull();
	});

	it('flattens depth-first in tree order', () => {
		expect(ids(tree())).toEqual(['a', 'a1', 'a2', 'b']);
	});

	it('inserts at the top level and under a parent', () => {
		expect(ids(insertSectionNode(tree(), node('c', 0, null), null))).toEqual([
			'a',
			'a1',
			'a2',
			'b',
			'c'
		]);
		expect(ids(insertSectionNode(tree(), node('b1', 1, 'b'), 'b'))).toEqual([
			'a',
			'a1',
			'a2',
			'b',
			'b1'
		]);
	});

	it('removes and renames a nested node', () => {
		expect(ids(removeSectionNode(tree(), 'a1'))).toEqual(['a', 'a2', 'b']);
		expect(findSectionNode(renameSectionNode(tree(), 'a1', 'New'), 'a1')?.name).toBe('New');
	});

	it('returns the sibling list holding an id', () => {
		expect(siblingsOf(tree(), 'a2')?.map((n) => n.id)).toEqual(['a1', 'a2']);
		expect(siblingsOf(tree(), 'zz')).toBeNull();
	});

	it('reorders the one sibling list that holds every id', () => {
		expect(ids(applySiblingOrder(tree(), ['a2', 'a1']))).toEqual(['a', 'a2', 'a1', 'b']);
		expect(ids(applySiblingOrder(tree(), ['b', 'a']))).toEqual(['b', 'a', 'a1', 'a2']);
	});

	it('reparents under a section after a sibling, rewriting depth and parent', () => {
		const next = applyReparent(tree(), 'b', { kind: 'section', sectionId: 'a' }, 'a1');
		expect(ids(next)).toEqual(['a', 'a1', 'b', 'a2']);
		expect(findSectionNode(next, 'b')).toEqual({ ...node('b', 1, 'a'), dbEntityId: null });
	});

	it('reparents to the top level under a collective', () => {
		const next = applyReparent(tree(), 'a1', { kind: 'org', dbEntityId: 'db1' }, 'a');
		expect(ids(next)).toEqual(['a', 'a2', 'a1', 'b']);
		expect(findSectionNode(next, 'a1')).toEqual(node('a1', 0, null));
	});

	it('lists arrange rows with depth and member count', () => {
		expect(listArrangeRows(tree(), (id) => (id === 'a' ? 3 : 0))).toEqual([
			{ id: 'a', name: 'A', depth: 0, memberCount: 3 },
			{ id: 'a1', name: 'A1', depth: 1, memberCount: 0 },
			{ id: 'a2', name: 'A2', depth: 1, memberCount: 0 },
			{ id: 'b', name: 'B', depth: 0, memberCount: 0 }
		]);
	});
});
