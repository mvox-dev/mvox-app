// T4.10 migration — credential loading + token exchange (issue mvox-dev/mvox-app#30).
//
// The migration runs as a STANDALONE node script, not browser-direct. `entuFetch`
// sends `cfg.token` as a raw Bearer, but the local credential `ENTU_API_KEY` is an
// Entu API-KEY, not a JWT — so it must first be exchanged at `{base}auth` for a JWT
// (harvest `getJwt` precedent, ~/workspace/scripts/migrations/lib/entu-client.ts).
// The key resolves to person …8079 (db-root / Mihkel), the identity permitted to
// DELETE person values (RECON B §4: no systemUser bypass on `DELETE property/{id}`).
//
// NO writes happen here — only the read-only auth GET. Live execution is gated
// elsewhere (team-lead per-run verify on #30 + Perotin).

import type { EntuCfg } from '$lib/seasons/entuSeasons';

/** Ensure a base URL ends in exactly one trailing slash (entu-config.ts:11 requires it —
 * callers build `${base}auth` and `${base}{db}/entity`). */
export function normalizeBase(base: string): string {
	return base.endsWith('/') ? base : `${base}/`;
}

/**
 * Exchange an Entu API-KEY for a short-lived JWT. `GET {base}auth` with the api-key as
 * Bearer → `body.token`. Fails loud on non-2xx OR a 2xx body carrying no token.
 */
export async function exchangeApiKeyForJwt(
	base: string,
	apiKey: string,
	fetchImpl: typeof fetch = fetch
): Promise<string> {
	const url = `${normalizeBase(base)}auth`;
	const res = await fetchImpl(url, {
		method: 'GET',
		headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' }
	});
	if (!res.ok) {
		throw new Error(`exchangeApiKeyForJwt: auth exchange failed: ${res.status}`);
	}
	const body = (await res.json()) as { token?: string };
	if (!body.token) {
		throw new Error('exchangeApiKeyForJwt: auth response carried no token (apparent-success trap)');
	}
	return body.token;
}

/**
 * Build the live `EntuCfg` from the local credential env. Reads `ENTU_API_URL`,
 * `ENTU_API_KEY`, `ENTU_DATABASE`; normalizes the base; VERIFIES the operator exported
 * a matching `PUBLIC_ENTU_API_BASE` before node started (the host is frozen at import
 * time — see below — so it cannot be set here); exchanges the api-key for a JWT. Fails
 * loud on any missing/mismatched credential. NOTE: this only READS the environment and
 * performs the read-only auth GET — no migration write.
 */
export async function loadCfg(fetchImpl: typeof fetch = fetch): Promise<EntuCfg> {
	const rawBase = process.env.ENTU_API_URL;
	const apiKey = process.env.ENTU_API_KEY;
	const db = process.env.ENTU_DATABASE;
	if (!rawBase) throw new Error('loadCfg: ENTU_API_URL is not set');
	if (!apiKey) throw new Error('loadCfg: ENTU_API_KEY is not set');
	if (!db) throw new Error('loadCfg: ENTU_DATABASE is not set');

	const base = normalizeBase(rawBase);
	// The Entu host is FROZEN AT PROCESS START: the $env/dynamic/public shim
	// (env-dynamic-public.ts) captures process.env.PUBLIC_ENTU_API_BASE at module-eval,
	// and $lib/entu-config freezes ENTU_API_BASE from it — both before main()→loadCfg()
	// runs. Assigning PUBLIC_ENTU_API_BASE here would be DEAD: the import graph already
	// read it, so every entity GET/POST/DELETE would still target the frozen host while
	// only the JWT mint below uses `base`. So FAIL LOUD if the operator did not export a
	// host matching ENTU_API_URL before starting node — a mismatch would send live
	// writes/deletes to the wrong Entu install with no other signal.
	const frozenBase = process.env.PUBLIC_ENTU_API_BASE;
	if (!frozenBase) {
		throw new Error(
			`loadCfg: PUBLIC_ENTU_API_BASE was not exported before node started — the Entu host is ` +
				`frozen at import time and would default to the dev fallback, NOT ENTU_API_URL (${base}). ` +
				`Run \`export PUBLIC_ENTU_API_BASE="${base}"\` before invoking the migration.`
		);
	}
	if (normalizeBase(frozenBase) !== base) {
		throw new Error(
			`loadCfg: Entu host mismatch — PUBLIC_ENTU_API_BASE (${normalizeBase(frozenBase)}) frozen at ` +
				`import time ≠ ENTU_API_URL (${base}). The JWT would be minted against ${base} but every ` +
				`entity write/delete would target ${normalizeBase(frozenBase)}. ` +
				`Export PUBLIC_ENTU_API_BASE="${base}" and re-run.`
		);
	}

	const token = await exchangeApiKeyForJwt(base, apiKey, fetchImpl);
	return { db, token };
}
