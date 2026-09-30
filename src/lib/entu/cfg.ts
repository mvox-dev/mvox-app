import { getToken } from '$lib/auth/storage';
import type { EntuCfg } from '$lib/seasons/entuSeasons';

export function cfgFor(db: string): EntuCfg {
	return { db, token: getToken() ?? '' };
}
