// The section tree reload every failed structural write falls back on.
import type { EntuCfg } from '$lib/seasons/entuSeasons';
import type { SectionNode } from '$lib/sections/sectionData';
import type { ArrangeOpsDeps } from '$lib/sections/sectionArrangeOps';
import { reportProblem } from '$lib/problems/reportProblem';

export function createRestoreSections(deps: ArrangeOpsDeps) {
	const { roster, actions, generation } = deps;

	// Reloads the tree after a failed write; false when a switch superseded it meanwhile.
	return async function restoreSections(
		cfg: EntuCfg,
		g: number,
		restore: () => SectionNode[],
		what: string
	): Promise<boolean> {
		try {
			const fresh = await actions.listSections(cfg);
			if (g !== generation()) return false;
			roster.sections = fresh;
		} catch (refetchError) {
			if (g !== generation()) return false;
			const action = `re-reading the sections after a failed ${what}`;
			reportProblem({ area: 'roster', action, error: refetchError });
			roster.sections = restore();
		}
		return true;
	};
}
