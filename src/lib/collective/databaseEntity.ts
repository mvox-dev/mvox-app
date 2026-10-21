// Resolves the db's database entity, which is the collective's identity (one per db).

import { entuFetch, type EntuFetchOptions } from '$lib/entu/request';
import type { EntuCfg } from '$lib/entu/cfg';

export class DatabaseEntityLookupError extends Error {
	readonly status?: number;

	constructor(message: string, opts: { status?: number } = {}) {
		super(message);
		this.name = 'DatabaseEntityLookupError';
		this.status = opts.status;
	}
}

// opts defaults to no cache: most callers POST this id as _parent, and a cached read must not
// feed a write. The agenda passes CACHED_READ itself.
export async function resolveDatabaseEntityId(
	cfg: EntuCfg,
	fetchImpl: typeof fetch = fetch,
	opts: EntuFetchOptions = {}
): Promise<string | null> {
	const res = await entuFetch(
		cfg.db,
		'entity?_type.string=database&props=_id&limit=1',
		cfg.token,
		{},
		fetchImpl,
		opts
	);
	if (!res.ok) {
		throw new DatabaseEntityLookupError(
			`resolveDatabaseEntityId: database entity lookup failed: HTTP ${res.status} in db '${cfg.db}'`,
			{ status: res.status }
		);
	}
	const body = (await res.json()) as { entities?: Array<{ _id?: string }> };
	const entity = body.entities?.[0];
	if (!entity) return null;
	if (!entity._id) {
		throw new DatabaseEntityLookupError(
			`resolveDatabaseEntityId: the database entity in '${cfg.db}' read back without an _id`
		);
	}
	return entity._id;
}

// (*MVOX:Palestrina* — #161 GREEN implementation)
