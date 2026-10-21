// T4.10 migration credentials (#30): exchanges the local Entu API key for a JWT.

// The key is db-root's (person …8079, Mihkel). Read-only auth GET; live runs need
// team-lead's per-run go on #30 and Perotin.

import type { EntuCfg } from '$lib/entu/cfg';

export function normalizeBase(base: string): string {
	return base.endsWith('/') ? base : `${base}/`;
}

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

export async function loadCfg(fetchImpl: typeof fetch = fetch): Promise<EntuCfg> {
	const rawBase = process.env.ENTU_API_URL;
	const apiKey = process.env.ENTU_API_KEY;
	const db = process.env.ENTU_DATABASE;
	if (!rawBase) throw new Error('loadCfg: ENTU_API_URL is not set');
	if (!apiKey) throw new Error('loadCfg: ENTU_API_KEY is not set');
	if (!db) throw new Error('loadCfg: ENTU_DATABASE is not set');

	const base = normalizeBase(rawBase);
	// The host is frozen from PUBLIC_ENTU_API_BASE at import time, so setting it here is too late;
	// a mismatch would send live writes to a different Entu install than the JWT was minted on.
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
