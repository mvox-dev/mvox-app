// The section tree editor's remove flow and its focus placement.
import { tick } from 'svelte';
import { m } from '$lib/paraglide/messages.js';
import { isSectionNotEmpty } from '$lib/sections/sectionErrors';
import { focusTestIdAfterRender, focusableByTestId } from '$lib/a11y/focusable';
import { findSectionNode, removeSectionNode, siblingsOf } from '$lib/sections/sectionTree';
import { without } from '$lib/collections/immutable';
import { createRestoreSections } from '$lib/sections/sectionArrangeRestore';
import { isStructuralWritePending } from '$lib/sections/sectionArrangeState';
import type { ArrangeOpsDeps } from '$lib/sections/sectionArrangeOps';

export function createRemoveOps(deps: ArrangeOpsDeps) {
	const { roster, arrange: a, actions, generation, isOffline } = deps;
	const structuralWritePending = () => isStructuralWritePending(a);
	const restoreSections = createRestoreSections(deps);

	async function armRemove(id: string): Promise<void> {
		a.removeError = null;
		a.pendingRemoveId = id;
		await focusTestIdAfterRender(`section-remove-confirm-${id}`);
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
				roster.expandedIds = without(roster.expandedIds, id);
			}
			a.removeStatus = m.roster_section_removed({ name });
			if (ownsFocus) await placeFocusAfterRemove(fallbackId);
		} catch (e) {
			console.error('roster: section remove failed', id, e);
			if (!(await restoreSections(cfg, g, () => before, 'remove'))) return;
			a.removeError = { name, kind: isSectionNotEmpty(e) ? 'not-empty' : 'write' };
			failedRemoveId = id;
		} finally {
			if (g === generation()) a.removePending = false;
			if (ownsFocus && failedRemoveId !== null) await placeFocusAfterFailedRemove(failedRemoveId);
		}
	}

	return { armRemove, disarmRemove, handleRemoveSection };
}
