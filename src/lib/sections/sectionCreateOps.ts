// The roster page's own section create form.
import { m } from '$lib/paraglide/messages.js';
import type { SectionNode } from '$lib/sections/sectionData';
import { formKeydown } from '$lib/a11y/formKeys';
import { findSectionNode, flattenSections, insertSectionNode } from '$lib/sections/sectionTree';
import type { ArrangeOpsDeps } from '$lib/sections/sectionArrangeOps';

export function createPageCreateOps(deps: ArrangeOpsDeps) {
	const { roster, arrange: a, actions, generation, isOffline } = deps;

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

	function onPageCreateFormKeydown(event: KeyboardEvent): void {
		formKeydown(event, { close: closePageCreateForm, submit: () => void submitPageCreate() });
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

	return { openPageCreateForm, closePageCreateForm, onPageCreateFormKeydown, submitPageCreate };
}
