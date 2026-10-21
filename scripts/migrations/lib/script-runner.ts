// #274 shared runner for migration scripts: dry-run by default, mvox_crede key exchange.

import type { EntuCfg } from '$lib/entu/cfg';

/** Only the literal 'false' (any case) runs live; unset or misspelled stays dry. */
export function readDryRun(): boolean {
	return (process.env.DRY_RUN ?? 'true').toLowerCase() !== 'false';
}

// Blank reads as undefined; the caller's assertLiveRunAuthorized decides if that is fatal.
export function readAuthorizedBy(): string | undefined {
	const value = process.env.AUTHORIZED_BY?.trim();
	return value ? value : undefined;
}

// userId is the accounts entry for THIS db, not the first one: rights preflights check it
// against _owner/_editor. A missing token or user id fails loud.
export async function loadCredeCfg(
	dbEnvVar = 'MVOX_CREDE_DB',
	keyEnvVar = 'MVOX_CREDE_API_KEY',
	defaultDb = 'mvox_crede',
	fetchImpl: typeof fetch = fetch
): Promise<EntuCfg & { userId: string }> {
	const db = process.env[dbEnvVar] ?? defaultDb;
	const key = process.env[keyEnvVar];
	if (!key) throw new Error(`loadCredeCfg: ${keyEnvVar} is not set — source ~/.config/mvox/credentials.env first`);
	const res = await fetchImpl(`https://api.entu.app/auth?db=${db}`, {
		headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' }
	});
	if (!res.ok) throw new Error(`loadCredeCfg: auth exchange failed: ${res.status}`);
	const body = (await res.json()) as {
		token?: string;
		accounts?: Array<{ _id: string; user?: { _id?: string } }>;
	};
	if (!body.token) throw new Error('loadCredeCfg: auth exchange returned no token (apparent-success trap)');
	const userId = body.accounts?.find((account) => account._id === db)?.user?._id;
	if (!userId) throw new Error(`loadCredeCfg: auth exchange reported no user id for db '${db}'`);
	return { db, token: body.token, userId };
}

export function errMsg(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

export function runScript(name: string, fn: () => Promise<boolean>): void {
	fn()
		.then((ok) => process.exit(ok ? 0 : 1))
		.catch((err) => {
			console.error(`${name} ABORTED:`, errMsg(err));
			process.exit(1);
		});
}

// (*MVOX:Perotin*)
