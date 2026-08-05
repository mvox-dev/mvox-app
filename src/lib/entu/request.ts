// Entu request helpers — the runtime `db` is threaded in as the URL PATH SEGMENT
// (`{base}/{db}/...`), never a constant. The host is always PUBLIC_ENTU_API_BASE;
// only the db segment varies per selected collective (T4). Calls are browser-direct
// and carry the localStorage Entu JWT (aud=IP-bound — see entu-config.ts).
import { ENTU_API_BASE } from '$lib/entu-config';

/**
 * Compose an Entu API URL for a given db. `pathAndQuery` is everything after the
 * db segment, e.g. `entity?_type.string=member&limit=1`. Leading slashes are
 * tolerated so callers can pass `/entity/...` or `entity/...`.
 */
export function entuUrl(db: string, pathAndQuery: string): string {
	if (!db) throw new Error('entuUrl: db (collective) is required — no default db exists');
	const path = pathAndQuery.replace(/^\/+/, '');
	return `${ENTU_API_BASE}${db}/${path}`;
}

/**
 * Browser-direct authenticated fetch against a specific db. Merges the Bearer
 * token into headers; callers supply the token (from `$lib/auth/storage.getToken`)
 * so this stays a pure, testable seam.
 */
export function entuFetch(
	db: string,
	pathAndQuery: string,
	token: string,
	init: RequestInit = {},
	fetchImpl: typeof fetch = fetch
): Promise<Response> {
	return fetchImpl(entuUrl(db, pathAndQuery), {
		...init,
		headers: {
			Authorization: `Bearer ${token}`,
			Accept: 'application/json',
			...init.headers
		}
	});
}

// (*MVOX:Josquin*)
