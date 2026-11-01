// Its own module so specs that mock resolveDatabaseEntityId also reach this caller.
import { resolveDatabaseEntityId } from '$lib/collective/databaseEntity';
import type { EntuCfg } from '$lib/entu/cfg';
import { reportProblem } from '$lib/problems/reportProblem';
import { writeOwner } from '$lib/problems/writeOwner';

export interface DbEntityLogLabel {
	area: string;
	action: string;
}

export async function resolveDbEntityOrLog(
	cfg: EntuCfg,
	label: DbEntityLogLabel
): Promise<string | null> {
	const owner = writeOwner(cfg);
	const problem = { area: label.area, action: `resolving the database entity for ${label.action}`, owner };
	let dbEntityId: string | null;
	try {
		dbEntityId = await resolveDatabaseEntityId(cfg);
	} catch (e) {
		reportProblem({ ...problem, error: e });
		return null;
	}
	if (!dbEntityId) {
		reportProblem({ ...problem, reason: 'no database entity is visible in this collective' });
		return null;
	}
	return dbEntityId;
}
