// The section tree editor's handlers, composed from one module per flow.
import type { EntuCfg } from '$lib/entu/cfg';
import type { listSections, SectionNode } from '$lib/sections/sectionData';
import type {
	createSection,
	deleteSection,
	renameSection,
	reorderSections,
	reparentSection
} from '$lib/sections/sectionActions';
import type { RosterState } from '$lib/roster/rosterPageState';
import type { ArrangeState } from '$lib/sections/sectionArrangeState';
import { createRemoveOps } from '$lib/sections/sectionRemoveOps';
import { createPageCreateOps } from '$lib/sections/sectionCreateOps';
import { createReorderOps } from '$lib/sections/sectionReorderOps';
import { createRenameOps } from '$lib/sections/sectionRenameOps';
import { createArrangeRights } from '$lib/sections/sectionRights';

export interface ArrangeActions {
	listSections: typeof listSections;
	createSection: typeof createSection;
	reorderSections: typeof reorderSections;
	deleteSection: typeof deleteSection;
	reparentSection: typeof reparentSection;
	renameSection: typeof renameSection;
}

export {
	type ArrangeState,
	createArrangeState,
	clearStructuralWrites,
	resetArrange,
	isStructuralWritePending
} from '$lib/sections/sectionArrangeState';

export interface ArrangeOpsDeps {
	roster: RosterState;
	arrange: ArrangeState;
	actions: ArrangeActions;
	cfg: () => EntuCfg | null;
	generation: () => number;
	isOffline: () => boolean;
	visibleSections: () => SectionNode[];
	currentDbEntityId: () => string | null;
	personId: () => string | null;
	canEditDb: () => boolean;
}

export type ArrangeOps = ReturnType<typeof createArrangeOps>;

export function createArrangeOps(deps: ArrangeOpsDeps) {
	return {
		...createRemoveOps(deps),
		...createPageCreateOps(deps),
		...createReorderOps(deps),
		...createRenameOps(deps),
		...createArrangeRights(deps)
	};
}
