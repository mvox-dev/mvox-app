// mvox-app#274 — shared script-safety runner. Extracted from 10+ crede/
// migration scripts that each hand-rolled the same two pieces: the
// DRY_RUN-default flag parse, and the mvox_crede API-key -> JWT exchange.
// Before this file existed, 3 of the 8 original crede-instance scripts
// (seed-184, seed-187, seed-188) had NO DRY_RUN guard at all — a copy-paste
// of one of them was a live mutation with no opt-out. Centralizing here
// means every future script gets dry-run-by-default BY CONSTRUCTION: it has
// to import `readDryRun`/`loadCredeCfg` from somewhere, and this is the
// only somewhere.
//
// Scope note: this does NOT touch `./creds.ts` (Josquin's T4.10 polyphony
// loader, `ENTU_API_URL`/`ENTU_API_KEY`/`ENTU_DATABASE` + the frozen-host
// verification dance) — polyphony scripts keep using `loadCfg` from there.
// `loadCredeCfg` below is the crede-side analog for `MVOX_CREDE_DB`/
// `MVOX_CREDE_API_KEY`, which never needed the same frozen-host check:
// crede scripts hardcode `https://api.entu.app` for the token exchange,
// which is also entu-config.ts's own PUBLIC_ENTU_API_BASE fallback — so the
// mismatch `loadCfg` guards against (a deliberately non-default
// ENTU_API_URL with an unexported PUBLIC_ENTU_API_BASE) cannot occur on the
// crede path, since crede scripts never read ENTU_API_URL in the first
// place. Verified against src/lib/entu-config.ts before writing this.

import type { EntuCfg } from '$lib/seasons/entuSeasons';

/**
 * DRY_RUN is true unless the env var is literally the string 'false'
 * (case-insensitive) — same semantics every migrated script already used,
 * kept byte-identical so no run's observable behavior changes from the
 * refactor alone. Safe by default: an unset or misspelled value stays dry.
 */
export function readDryRun(): boolean {
	return (process.env.DRY_RUN ?? 'true').toLowerCase() !== 'false';
}

/**
 * Exchange the mvox_crede permanent API key for a 48h JWT, same wire shape
 * every crede-touching script duplicated inline (`GET /auth?db=<db>` with
 * the api-key as Bearer). Fails loud on a missing key, a non-2xx exchange,
 * or a 2xx body with no `token` (the apparent-success trap already named in
 * the individual scripts this replaces).
 */
export async function loadCredeCfg(
	dbEnvVar = 'MVOX_CREDE_DB',
	keyEnvVar = 'MVOX_CREDE_API_KEY',
	defaultDb = 'mvox_crede',
	fetchImpl: typeof fetch = fetch
): Promise<EntuCfg> {
	const db = process.env[dbEnvVar] ?? defaultDb;
	const key = process.env[keyEnvVar];
	if (!key) throw new Error(`loadCredeCfg: ${keyEnvVar} is not set — source ~/.config/mvox/credentials.env first`);
	const res = await fetchImpl(`https://api.entu.app/auth?db=${db}`, {
		headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' }
	});
	if (!res.ok) throw new Error(`loadCredeCfg: auth exchange failed: ${res.status}`);
	const body = (await res.json()) as { token?: string };
	if (!body.token) throw new Error('loadCredeCfg: auth exchange returned no token (apparent-success trap)');
	return { db, token: body.token };
}

/** Common error-to-string, unifies the `errMsg` helper duplicated across scripts. */
export function errMsg(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

/**
 * Standard `main().catch()` wrapper: runs `fn`, prints a uniform ABORTED
 * line with the script name on any throw, and exits 1. Callers still own
 * their own success/failure exit code inside `fn` (returned as `false` on
 * "ran but had failures", consistent with the ledger-driven failure counts
 * every migrated script already reports).
 */
export function runScript(name: string, fn: () => Promise<boolean>): void {
	fn()
		.then((ok) => process.exit(ok ? 0 : 1))
		.catch((err) => {
			console.error(`${name} ABORTED:`, errMsg(err));
			process.exit(1);
		});
}

// (*MVOX:Perotin*)
