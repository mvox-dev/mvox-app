// Entu request helpers: browser-direct calls to `{base}/{db}/...` with the user's JWT.
import { ENTU_API_BASE } from '$lib/entu-config';
import { AuthExpiredError } from './auth-expired';
import { readThroughGet } from './readCache';
import type { EntuFetchOptions } from './fetchOptions';

export { isAuthExpiredError } from './auth-expired';

// One redirect per burst; released when navigation settles so a later expiry recovers again.
let redirectingToSignIn = false;

// Registered by the app shell; node migration scripts import this module, so no browser imports.
export type AuthExpiredHandler = () => void | Promise<unknown>;

let onAuthExpired: AuthExpiredHandler | null = null;

export function setAuthExpiredHandler(fn: AuthExpiredHandler | null): void {
	onAuthExpired = fn;
}

function handleAuthExpired401(): never {
	if (onAuthExpired && !redirectingToSignIn) {
		redirectingToSignIn = true;
		void Promise.resolve(onAuthExpired()).finally(() => {
			redirectingToSignIn = false;
		});
	}
	throw new AuthExpiredError();
}

export function entuUrl(db: string, pathAndQuery: string): string {
	if (!db) throw new Error('entuUrl: db (collective) is required — no default db exists');
	const path = pathAndQuery.replace(/^\/+/, '');
	// A bare `entity/` would hit Entu's list route and answer 200 with the wrong data (#258).
	if (/^entity\/(\?|$)/.test(path)) {
		throw new Error(`entuUrl: empty entity id composed into path '${pathAndQuery}' (#258)`);
	}
	return `${ENTU_API_BASE}${db}/${path}`;
}

export { CACHED_READ, CACHED_READ_STORE_ONLY, type EntuFetchOptions } from './fetchOptions';

export function entuFetch(
	db: string,
	pathAndQuery: string,
	token: string,
	init: RequestInit = {},
	fetchImpl: typeof fetch = fetch,
	opts: EntuFetchOptions = {}
): Promise<Response> {
	// Writes only: sign-out keeps firing reads with an empty token (session.ts).
	if (!token && (init.method ?? 'GET').toUpperCase() !== 'GET') {
		try {
			handleAuthExpired401();
		} catch (e) {
			return Promise.reject(e);
		}
	}
	const attemptFetch = () =>
		fetchImpl(entuUrl(db, pathAndQuery), {
			...init,
			headers: {
				Authorization: `Bearer ${token}`,
				Accept: 'application/json',
				...init.headers
			}
		});
	const checkAuthExpired = (res: Response): Response => {
		if (res.status === 401) return handleAuthExpired401();
		return res;
	};
	if (!opts.cache) return attemptFetch().then(checkAuthExpired);
	// `{ cache: 'store' }` stores the answer but never serves a stored copy offline.
	return readThroughGet(
		db,
		pathAndQuery,
		init,
		attemptFetch,
		checkAuthExpired,
		opts.cache === 'store'
	);
}

// (*MVOX:Josquin*)
