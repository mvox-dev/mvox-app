// The section tree editor's inline rename.
import { tick } from 'svelte';
import { m } from '$lib/paraglide/messages.js';
import type { SectionNode } from '$lib/sections/sectionData';
import { focusTestIdAfterRender } from '$lib/a11y/focusable';
import { findSectionNode, renameSectionNode } from '$lib/sections/sectionTree';
import { createRestoreSections } from '$lib/sections/sectionArrangeRestore';
import { isStructuralWritePending } from '$lib/sections/sectionArrangeState';
import type { ArrangeOpsDeps } from '$lib/sections/sectionArrangeOps';

export function createRenameOps(deps: ArrangeOpsDeps) {
	const { roster, arrange: a, actions, generation, isOffline } = deps;
	const structuralWritePending = () => isStructuralWritePending(a);
	const restoreSections = createRestoreSections(deps);

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
			if (!(await restoreSections(cfg, g, () => before, 'rename'))) return;
			a.renameError = { id, name };
		} finally {
			if (g === generation()) a.renamePending = false;
			if (refocus) {
				await focusTestIdAfterRender(`arrange-rename-${id}`);
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

	return { startRename, cancelRename, submitRename, onRenameKeydown };
}
