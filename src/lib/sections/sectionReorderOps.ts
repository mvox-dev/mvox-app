// The section tree editor's reorder, indent and unindent writes.
import { m } from '$lib/paraglide/messages.js';
import type { SectionNode } from '$lib/sections/sectionData';
import { isSectionParentDamaged } from '$lib/sections/sectionErrors';
import {
	applyReparent,
	applySiblingOrder,
	findSectionNode,
	siblingsOf,
	type ReparentTarget
} from '$lib/sections/sectionTree';
import { createRestoreSections } from '$lib/sections/sectionArrangeRestore';
import { isStructuralWritePending } from '$lib/sections/sectionArrangeState';
import type { ArrangeOpsDeps } from '$lib/sections/sectionArrangeOps';

export function createReorderOps(deps: ArrangeOpsDeps) {
	const { roster, arrange: a, actions, generation, isOffline } = deps;
	const structuralWritePending = () => isStructuralWritePending(a);
	const restoreSections = createRestoreSections(deps);

	function visibleSiblingsOf(id: string): SectionNode[] | null {
		const siblings = siblingsOf(roster.sections, id);
		if (siblings === null) return null;
		return siblings === roster.sections ? deps.visibleSections() : siblings;
	}

	async function performReorder(
		beforeIds: string[],
		afterIds: string[],
		movedId: string
	): Promise<boolean> {
		if (structuralWritePending()) return false;
		if (isOffline()) return false;
		const cfg = deps.cfg();
		if (!cfg) {
			console.error('roster: section reorder with no cfg', afterIds);
			a.reorderError = true;
			a.reparentPartial = false;
			return false;
		}
		const g = generation();
		a.reorderPending = true;
		a.reorderError = false;
		a.reparentPartial = false;
		a.reorderStatus = '';
		roster.sections = applySiblingOrder(roster.sections, afterIds);
		try {
			await actions.reorderSections(cfg, afterIds);
			if (g !== generation()) return false;
			a.reorderStatus = m.roster_section_moved({
				name: findSectionNode(roster.sections, movedId)?.name ?? movedId,
				position: afterIds.indexOf(movedId) + 1,
				total: afterIds.length
			});
			return true;
		} catch (e) {
			console.error('roster: section reorder failed', e);
			if (g !== generation()) return false;
			a.reorderError = true;
			await restoreSections(
				cfg,
				g,
				() => applySiblingOrder(roster.sections, beforeIds),
				'reorder'
			);
		} finally {
			if (g === generation()) a.reorderPending = false;
		}
		return false;
	}

	function prevSiblingId(id: string): string | null {
		const siblingIds = visibleSiblingsOf(id)?.map((n) => n.id) ?? [];
		const idx = siblingIds.indexOf(id);
		if (idx <= 0) return null;
		return siblingIds[idx - 1];
	}

	function canIndent(id: string): boolean {
		return prevSiblingId(id) !== null;
	}

	function canUnindent(id: string): boolean {
		return (findSectionNode(roster.sections, id)?.parentId ?? null) !== null;
	}

	async function performReparent(
		node: SectionNode,
		target: ReparentTarget,
		insertAfterId: string | null,
		announce: () => string
	): Promise<boolean> {
		if (structuralWritePending()) return false;
		if (isOffline()) return false;
		const cfg = deps.cfg();
		if (!cfg) {
			console.error('roster: section reparent with no cfg', node.id);
			a.reorderError = true;
			a.reparentPartial = false;
			return false;
		}
		const g = generation();
		a.reorderPending = true;
		a.reorderError = false;
		a.reparentPartial = false;
		a.reorderStatus = '';
		const before = roster.sections;
		roster.sections = applyReparent(roster.sections, node.id, target, insertAfterId);
		const newParentId = target.kind === 'org' ? target.dbEntityId : target.sectionId;
		let moveLanded = false;
		try {
			await actions.reparentSection(cfg, node.id, newParentId);
			moveLanded = true;
			if (g !== generation()) return false;
			const destinationIds = visibleSiblingsOf(node.id)?.map((n) => n.id) ?? [];
			if (destinationIds.length > 0) await actions.reorderSections(cfg, destinationIds);
			if (g !== generation()) return false;
			a.reorderStatus = announce();
			return true;
		} catch (e) {
			console.error(
				isSectionParentDamaged(e)
					? 'roster: section reparent refused — parent data damaged, nothing written'
					: 'roster: section reparent failed',
				e
			);
			if (g !== generation()) return false;
			a.reorderError = true;
			a.reparentPartial = moveLanded;
			await restoreSections(cfg, g, () => before, 'reparent');
		} finally {
			if (g === generation()) a.reorderPending = false;
		}
		return false;
	}

	async function handleIndent(node: SectionNode): Promise<void> {
		const prevId = prevSiblingId(node.id);
		if (prevId === null) return;
		const parentName = findSectionNode(roster.sections, prevId)?.name ?? '';
		await performReparent(node, { kind: 'section', sectionId: prevId }, null, () =>
			m.roster_section_indented({ name: node.name, parentName })
		);
	}

	async function handleUnindent(node: SectionNode): Promise<void> {
		if (node.parentId === null) return;
		const parent = findSectionNode(roster.sections, node.parentId);
		if (!parent) return;
		if (parent.parentId === null) {
			const dbEntityId = parent.dbEntityId ?? deps.currentDbEntityId();
			if (!dbEntityId) {
				console.error('roster: unindent to top level with no known collective (database entity) id', node.id);
				a.reorderError = true;
				a.reparentPartial = false;
				return;
			}
			await performReparent(node, { kind: 'org', dbEntityId }, parent.id, () =>
				m.roster_section_unindented_top({ name: node.name })
			);
			return;
		}
		const grandParentId = parent.parentId;
		const grandParentName = findSectionNode(roster.sections, grandParentId)?.name ?? '';
		await performReparent(node, { kind: 'section', sectionId: grandParentId }, parent.id, () =>
			m.roster_section_unindented({ name: node.name, parentName: grandParentName })
		);
	}

	return { visibleSiblingsOf, performReorder, prevSiblingId, canIndent, canUnindent, handleIndent, handleUnindent };
}
