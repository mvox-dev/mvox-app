import { tick } from 'svelte';
import { m } from '$lib/paraglide/messages.js';
import type { EntuCfg } from '$lib/seasons/entuSeasons';
import type { listSections, SectionNode } from '$lib/sections/sectionData';
import type {
	createSection,
	deleteSection,
	renameSection,
	reorderSections,
	reparentSection
} from '$lib/sections/sectionActions';
import { isSectionNotEmpty, isSectionParentDamaged } from '$lib/sections/sectionErrors';
import { focusableByTestId } from '$lib/a11y/focusable';
import {
	applyReparent,
	applySiblingOrder,
	findSectionNode,
	flattenSections,
	insertSectionNode,
	removeSectionNode,
	renameSectionNode,
	siblingsOf,
	type ReparentTarget
} from '$lib/sections/sectionTree';
import type { RosterState } from '$lib/roster/rosterPageState';

export interface ArrangeActions {
	listSections: typeof listSections;
	createSection: typeof createSection;
	reorderSections: typeof reorderSections;
	deleteSection: typeof deleteSection;
	reparentSection: typeof reparentSection;
	renameSection: typeof renameSection;
}

/** The section tree editor's state; lives as long as the page, so it survives a view switch. */
export interface ArrangeState {
	reorderPending: boolean;
	reorderError: boolean;
	reparentPartial: boolean;
	reorderStatus: string;
	removeError: { name: string; kind: 'write' | 'not-empty' } | null;
	pendingRemoveId: string | null;
	removeStatus: string;
	removePending: boolean;
	pageCreateOpen: boolean;
	pageCreateName: string;
	pageCreateParentId: string;
	pageCreateError: (() => string) | null;
	pageCreateStatus: string;
	renamingSectionId: string | null;
	renameValue: string;
	renamePending: boolean;
	renameError: { id: string; name: string } | null;
	renameStatus: string;
	draggedSectionId: string | null;
	dragOverId: string | null;
	touchDragId: string | null;
	touchOverId: string | null;
	grabbedSectionId: string | null;
	rovingHandleId: string | null;
}

export function createArrangeState(): ArrangeState {
	return {
		reorderPending: false,
		reorderError: false,
		reparentPartial: false,
		reorderStatus: '',
		removeError: null,
		pendingRemoveId: null,
		removeStatus: '',
		removePending: false,
		pageCreateOpen: false,
		pageCreateName: '',
		pageCreateParentId: '',
		pageCreateError: null,
		pageCreateStatus: '',
		renamingSectionId: null,
		renameValue: '',
		renamePending: false,
		renameError: null,
		renameStatus: '',
		draggedSectionId: null,
		dragOverId: null,
		touchDragId: null,
		touchOverId: null,
		grabbedSectionId: null,
		rovingHandleId: null
	};
}

// Writes only, and before the rename flush: the flush's own gate reads these.
export function clearStructuralWrites(a: ArrangeState): void {
	a.reorderError = false;
	a.reorderStatus = '';
	a.reorderPending = false;
	a.removeError = null;
	a.pendingRemoveId = null;
	a.pageCreateError = null;
	a.removePending = false;
}

// Writes only, after the rename flush. Drag, grab and the roving stop are never reset.
export function resetArrange(a: ArrangeState, { isSwitch }: { isSwitch: boolean }): void {
	a.renamingSectionId = null;
	a.renameValue = '';
	a.renamePending = false;
	a.renameError = null;
	a.removeStatus = '';
	a.renameStatus = '';
	a.pageCreateStatus = '';
	if (isSwitch) {
		a.pageCreateOpen = false;
		a.pageCreateName = '';
		a.pageCreateParentId = '';
	}
}

export function isStructuralWritePending(a: ArrangeState): boolean {
	return a.reorderPending || a.renamePending || a.removePending;
}

export interface ArrangeOpsDeps {
	roster: RosterState;
	arrange: ArrangeState;
	actions: ArrangeActions;
	cfg: () => EntuCfg | null;
	generation: () => number;
	isOffline: () => boolean;
	visibleSections: () => SectionNode[];
	currentDbEntityId: () => string | null;
}

export type ArrangeOps = ReturnType<typeof createArrangeOps>;

export function createArrangeOps(deps: ArrangeOpsDeps) {
	const { roster, arrange: a, actions, generation, isOffline } = deps;
	const structuralWritePending = () => isStructuralWritePending(a);

	function visibleSiblingsOf(id: string): SectionNode[] | null {
		const siblings = siblingsOf(roster.sections, id);
		if (siblings === null) return null;
		return siblings === roster.sections ? deps.visibleSections() : siblings;
	}

	async function armRemove(id: string): Promise<void> {
		a.removeError = null;
		a.pendingRemoveId = id;
		await tick();
		document.querySelector<HTMLElement>(`[data-testid="section-remove-confirm-${id}"]`)?.focus();
	}

	async function disarmRemove(id: string): Promise<void> {
		a.pendingRemoveId = null;
		await tick();
		const target =
			focusableByTestId(`section-remove-${id}`) ??
			focusableByTestId(`section-toggle-${id}`) ??
			focusableByTestId(`arrange-row-${id}`);
		target?.focus();
		if (target === document.querySelector(`[data-testid="arrange-row-${id}"]`)) {
			a.rovingHandleId = id;
		}
	}

	function removeFocusFallbackId(id: string): string | null {
		const siblingNodes = siblingsOf(roster.sections, id);
		if (!siblingNodes) return null;
		const idx = siblingNodes.findIndex((n) => n.id === id);
		if (idx > 0) return siblingNodes[idx - 1].id;
		return findSectionNode(roster.sections, id)?.parentId ?? null;
	}

	async function placeFocusAfterRemove(targetId: string | null): Promise<void> {
		if (targetId && roster.viewMode === 'arrange') {
			a.rovingHandleId = targetId;
		}
		await tick();
		const neighbour = targetId
			? (document.querySelector<HTMLElement>(`[data-testid="section-toggle-${targetId}"]`) ??
				document.querySelector<HTMLElement>(`[data-testid="arrange-row-${targetId}"]`))
			: null;
		(neighbour ?? document.querySelector<HTMLElement>('[data-testid="roster-view-chip-collapsed"]'))?.focus();
	}

	async function placeFocusAfterFailedRemove(id: string): Promise<void> {
		await tick();
		const target =
			focusableByTestId(`section-remove-confirm-${id}`) ?? focusableByTestId(`arrange-row-${id}`);
		if (!target) return;
		target.focus();
		if (target === document.querySelector(`[data-testid="arrange-row-${id}"]`)) {
			a.rovingHandleId = id;
		}
	}

	async function handleRemoveSection(id: string): Promise<void> {
		if (structuralWritePending()) return;
		if (isOffline()) return;
		const fallbackId = removeFocusFallbackId(id);
		const active = document.activeElement;
		const ownsFocus =
			!active ||
			active === document.body ||
			active === document.querySelector(`[data-testid="section-remove-confirm-${id}"]`);
		a.removeError = null;
		a.removeStatus = '';
		const name = findSectionNode(roster.sections, id)?.name ?? id;
		const cfg = deps.cfg();
		if (!cfg) {
			console.error('roster: section remove with no cfg', id);
			a.removeError = { name, kind: 'write' };
			if (ownsFocus) await placeFocusAfterFailedRemove(id);
			return;
		}
		const g = generation();
		const before = roster.sections;
		let failedRemoveId: string | null = null;
		a.removePending = true;
		try {
			await actions.deleteSection(cfg, id);
			if (g !== generation()) return;
			roster.sections = removeSectionNode(roster.sections, id);
			a.pendingRemoveId = null;
			if (roster.expandedIds.has(id)) {
				const next = new Set(roster.expandedIds);
				next.delete(id);
				roster.expandedIds = next;
			}
			a.removeStatus = m.roster_section_removed({ name });
			if (ownsFocus) await placeFocusAfterRemove(fallbackId);
		} catch (e) {
			console.error('roster: section remove failed', id, e);
			try {
				const fresh = await actions.listSections(cfg);
				if (g !== generation()) return;
				roster.sections = fresh;
			} catch (refetchError) {
				console.error('roster: section refetch after a failed remove failed', refetchError);
				if (g !== generation()) return;
				roster.sections = before;
			}
			if (g !== generation()) return;
			a.removeError = { name, kind: isSectionNotEmpty(e) ? 'not-empty' : 'write' };
			failedRemoveId = id;
		} finally {
			if (g === generation()) a.removePending = false;
			if (ownsFocus && failedRemoveId !== null) await placeFocusAfterFailedRemove(failedRemoveId);
		}
	}

	function openPageCreateForm(): void {
		a.pageCreateName = '';
		a.pageCreateParentId = '';
		a.pageCreateError = null;
		a.pageCreateOpen = true;
	}

	function closePageCreateForm(): void {
		a.pageCreateOpen = false;
		a.pageCreateName = '';
		a.pageCreateParentId = '';
		a.pageCreateError = null;
	}

	function onPageCreateNameKeydown(event: KeyboardEvent): void {
		if (event.key !== 'Enter') return;
		event.preventDefault();
		void submitPageCreate();
	}

	async function submitPageCreate(): Promise<void> {
		if (isOffline()) return;
		a.pageCreateError = null;
		a.pageCreateStatus = '';
		const name = a.pageCreateName.trim();
		if (!name) {
			a.pageCreateError = m.roster_section_name_required;
			return;
		}
		const parentId = a.pageCreateParentId === '' ? null : a.pageCreateParentId;
		const isDuplicate = flattenSections(deps.visibleSections()).some(
			(node) => node.parentId === parentId && node.name.toLowerCase() === name.toLowerCase()
		);
		if (isDuplicate) {
			a.pageCreateError = m.roster_section_duplicate;
			return;
		}

		const cfg = deps.cfg();
		if (!cfg) {
			console.error('roster: page-level section create with no cfg', name, parentId);
			a.pageCreateError = m.roster_section_create_failed;
			return;
		}
		const g = generation();
		const dbEntityId = deps.currentDbEntityId();

		let newId: string;
		try {
			newId = await actions.createSection(cfg, { name, parentId, dbEntityId });
		} catch (e) {
			console.error('roster: page-level section create failed', name, parentId, e);
			if (g !== generation()) return;
			a.pageCreateError = m.roster_section_create_failed;
			return;
		}
		if (g !== generation()) return;

		const depth = parentId ? (findSectionNode(roster.sections, parentId)?.depth ?? 0) + 1 : 0;
		const newNode: SectionNode = {
			id: newId,
			name,
			displayOrder: Number.POSITIVE_INFINITY,
			parentId,
			dbEntityId: parentId ? null : (deps.currentDbEntityId() ?? null),
			depth,
			children: []
		};
		roster.sections = insertSectionNode(roster.sections, newNode, parentId);
		roster.expandedIds = new Set(roster.expandedIds).add(newId);
		a.pageCreateStatus = m.roster_section_created({ name });
		closePageCreateForm();
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
			try {
				const fresh = await actions.listSections(cfg);
				if (g !== generation()) return false;
				roster.sections = fresh;
			} catch (refetchError) {
				console.error('roster: section refetch after a failed reorder failed', refetchError);
				if (g === generation()) roster.sections = applySiblingOrder(roster.sections, beforeIds);
			}
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
			try {
				const fresh = await actions.listSections(cfg);
				if (g !== generation()) return false;
				roster.sections = fresh;
			} catch (refetchError) {
				console.error('roster: section refetch after a failed reparent failed', refetchError);
				if (g === generation()) roster.sections = before;
			}
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

	function startRename(node: SectionNode): void {
		if (isOffline()) return;
		if (a.reorderPending || a.removePending) return;
		if (a.renamingSectionId !== null && a.renamingSectionId !== node.id) {
			void submitRename({ refocus: false });
			if (a.renamingSectionId !== null) return;
		}
		a.renameError = null;
		a.renameStatus = '';
		a.renamingSectionId = node.id;
		a.renameValue = node.name;
	}

	async function cancelRename(): Promise<void> {
		const id = a.renamingSectionId;
		a.renamingSectionId = null;
		a.renameValue = '';
		await tick();
		if (id) document.querySelector<HTMLElement>(`[data-testid="arrange-rename-${id}"]`)?.focus();
	}

	async function submitRename(opts?: {
		blurTrigger?: boolean;
		refocus?: boolean;
		generation?: number;
	}): Promise<void> {
		const blurTrigger = opts?.blurTrigger ?? false;
		const refocus = opts?.refocus ?? true;
		const id = a.renamingSectionId;
		if (id === null) return;
		const name = a.renameValue.trim();
		if (structuralWritePending() || a.pendingRemoveId !== null || isOffline()) return;
		if (blurTrigger) {
			const original = findSectionNode(roster.sections, id)?.name ?? '';
			if (name === '' || name === original) {
				a.renamingSectionId = null;
				a.renameValue = '';
				a.renameError = null;
				return;
			}
		} else if (!name) {
			return;
		}
		const cfg = deps.cfg();
		if (!cfg) {
			console.error('roster: section rename with no cfg', id);
			a.renameError = { id, name };
			return;
		}
		const g = opts?.generation ?? generation();
		const before = roster.sections;
		a.renamePending = true;
		a.renamingSectionId = null;
		roster.sections = renameSectionNode(roster.sections, id, name);
		try {
			await actions.renameSection(cfg, id, name);
			if (g !== generation()) return;
			a.renameStatus = m.roster_section_renamed({ name });
		} catch (e) {
			console.error('roster: section rename failed', id, e);
			try {
				const fresh = await actions.listSections(cfg);
				if (g !== generation()) return;
				roster.sections = fresh;
			} catch (refetchError) {
				console.error('roster: section refetch after a failed rename failed', refetchError);
				if (g !== generation()) return;
				roster.sections = before;
			}
			if (g !== generation()) return;
			a.renameError = { id, name };
		} finally {
			if (g === generation()) a.renamePending = false;
			if (refocus) {
				await tick();
				document.querySelector<HTMLElement>(`[data-testid="arrange-rename-${id}"]`)?.focus();
			}
		}
	}

	function onRenameKeydown(event: KeyboardEvent): void {
		event.stopPropagation();
		if (event.key === 'Enter') {
			event.preventDefault();
			void submitRename();
		} else if (event.key === 'Escape') {
			event.preventDefault();
			void cancelRename();
		}
	}

	return {
		visibleSiblingsOf,
		armRemove,
		disarmRemove,
		handleRemoveSection,
		openPageCreateForm,
		closePageCreateForm,
		onPageCreateNameKeydown,
		submitPageCreate,
		performReorder,
		prevSiblingId,
		canIndent,
		canUnindent,
		handleIndent,
		handleUnindent,
		startRename,
		cancelRename,
		submitRename,
		onRenameKeydown
	};
}

// (*MVOX:Josquin*)
