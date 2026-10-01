// Its own module so specs that mock resolveDatabaseEntityId also reach this caller.
import { resolveDatabaseEntityId } from '$lib/collective/databaseEntity';
import type { EntuCfg } from '$lib/seasons/entuSeasons';

export interface DbEntityLogLabel {
	area: string;
	action: string;
}

export async function resolveDbEntityOrLog(
	cfg: EntuCfg,
	label: DbEntityLogLabel,
	personId: string | null
): Promise<string | null> {
	let dbEntityId: string | null;
	try {
		dbEntityId = await resolveDatabaseEntityId(cfg);
	} catch (e) {
		console.error(`${label.area}: resolving the database entity for ${label.action} failed`, e);
		return null;
	}
	if (!dbEntityId) {
		console.error(`${label.area}: ${label.action} with no resolvable database entity`, personId);
		return null;
	}
	return dbEntityId;
}
