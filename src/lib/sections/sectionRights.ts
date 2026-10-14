// What Entu lets the person write on each section, read off that section's own rights.
import { manageRightsFrom } from '$lib/repertoire/repertoireActions';
import type { SectionNode } from './sectionData';
import { findSectionNode, flattenSections, siblingsOf } from './sectionTree';
import type { ArrangeOpsDeps } from './sectionArrangeOps';

export interface SectionAccess {
	editable: Set<string>;
	owned: Set<string>;
	expandable: Set<string>;
}

export function sectionAccess(sections: SectionNode[], personId: string | null): SectionAccess {
	const access: SectionAccess = { editable: new Set(), owned: new Set(), expandable: new Set() };
	if (personId === null) return access;
	for (const n of flattenSections(sections)) {
		const owners = n.ownerIds ?? [];
		if (manageRightsFrom(owners, n.editorIds ?? [], personId) === 'editor') access.editable.add(n.id);
		if (owners.includes(personId)) access.owned.add(n.id);
		if (access.editable.has(n.id) || (n.expanderIds ?? []).includes(personId)) {
			access.expandable.add(n.id);
		}
	}
	return access;
}

export function createArrangeRights(deps: ArrangeOpsDeps) {
	const access = () => sectionAccess(deps.roster.sections, deps.personId());

	function siblingIds(id: string): string[] {
		const siblings = siblingsOf(deps.roster.sections, id);
		if (siblings === null) return [];
		return (siblings === deps.roster.sections ? deps.visibleSections() : siblings).map((n) => n.id);
	}

	function editsAll(ids: string[]): boolean {
		const a = access();
		return ids.length > 0 && ids.every((id) => a.editable.has(id));
	}

	// `_parent` needs `_owner` on the section and `_expander` on the new parent (a null parent is
	// the database entity); the destination siblings are renumbered after.
	function mayReparent(id: string, parentId: string | null, destinationIds: string[]): boolean {
		const a = access();
		const parentOk = parentId === null ? deps.canEditDb() : a.expandable.has(parentId);
		return a.owned.has(id) && parentOk && destinationIds.every((d) => a.editable.has(d));
	}

	function mayIndent(id: string): boolean {
		const ids = siblingIds(id);
		const prevId = ids[ids.indexOf(id) - 1];
		if (prevId === undefined) return false;
		const children = findSectionNode(deps.roster.sections, prevId)?.children ?? [];
		return mayReparent(id, prevId, children.map((n) => n.id));
	}

	function mayUnindent(id: string): boolean {
		const parentId = findSectionNode(deps.roster.sections, id)?.parentId ?? null;
		const parent = parentId === null ? null : findSectionNode(deps.roster.sections, parentId);
		if (!parent) return false;
		if (parent.parentId === null) {
			return mayReparent(id, null, deps.visibleSections().map((n) => n.id));
		}
		const grandParent = findSectionNode(deps.roster.sections, parent.parentId);
		return mayReparent(id, parent.parentId, (grandParent?.children ?? []).map((n) => n.id));
	}

	return {
		mayRename: (id: string) => access().editable.has(id),
		mayReorder: (id: string) => editsAll(siblingIds(id)),
		mayRemove: (id: string) => access().owned.has(id),
		mayIndent,
		mayUnindent
	};
}

// (*MVOX:Josquin*)
