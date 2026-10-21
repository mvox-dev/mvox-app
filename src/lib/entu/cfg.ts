// Entu call config: the selected collective's db and the user's JWT (browser-direct).
import { getToken } from '$lib/auth/storage';

export interface EntuCfg {
	db: string;
	token: string;
}

export function cfgFor(db: string, token?: string): EntuCfg {
	return { db, token: token ?? getToken() ?? '' };
}
