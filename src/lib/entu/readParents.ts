// Reads an entity's `_parent` values; `op` prefixes the lookup error.
import { entuFetch } from './request';

export async function readParentValues<V>(
	cfg: { db: string; token: string },
	entityId: string,
	op: string,
	fetchImpl: typeof fetch
): Promise<V[]> {
	const res = await entuFetch(cfg.db, `entity/${entityId}?props=_parent`, cfg.token, {}, fetchImpl);
	if (!res.ok) throw new Error(`${op} lookup failed: ${res.status}`);
	const body = (await res.json()) as { entity?: { _parent?: V[] } };
	return body.entity?._parent ?? [];
}
