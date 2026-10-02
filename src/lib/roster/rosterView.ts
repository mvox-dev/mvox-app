// Pure lookups the roster page derives from its rows and section tree.
import { m } from '$lib/paraglide/messages.js';
import type { SectionGroup, SectionNode } from '$lib/sections/sectionData';
import type { RosterViewMode } from '$lib/roster/rosterPageState';

export function groupsBySectionId(groups: SectionGroup[]): Map<string, SectionGroup> {
	const map = new Map<string, SectionGroup>();
	for (const g of groups) if (g.sectionId !== null) map.set(g.sectionId, g);
	return map;
}

export function rootDbEntityBySectionId(sections: SectionNode[]): Map<string, string | null> {
	const map = new Map<string, string | null>();
	function walk(nodes: SectionNode[], rootOrg: string | null): void {
		for (const n of nodes) {
			const org = n.parentId === null ? (n.dbEntityId ?? null) : rootOrg;
			map.set(n.id, org);
			walk(n.children, org);
		}
	}
	walk(sections, null);
	return map;
}

const VIEW_MODE_LABEL: Record<RosterViewMode, () => string> = {
	collapsed: m.roster_view_collapsed,
	expanded: m.roster_view_expanded,
	arrange: m.roster_view_arrange
};

export function viewModeOptions(isAdmin: boolean) {
	return (Object.keys(VIEW_MODE_LABEL) as RosterViewMode[])
		.filter((mode) => mode !== 'arrange' || isAdmin)
		.map((mode) => ({
			value: mode,
			label: VIEW_MODE_LABEL[mode](),
			testid: `roster-view-chip-${mode}`
		}));
}
