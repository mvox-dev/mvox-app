// The one implementation of Entu property overwrite (POST with the old value's `_id`) and removal.
import { entuFetch } from './request';

export type EntuWireValue = { type: string } & Record<string, unknown>;

export type OverwriteStep = 'lookup' | 'post' | 'delete';

export interface OverwriteOptions {
	label?: string;
	fail?: (step: OverwriteStep, res: Response) => Error | Promise<Error>;
}

export interface OverwriteEntry {
	value: EntuWireValue;
	existing: ReadonlyArray<{ _id: string }>;
}

const STEP_WORD: Record<OverwriteStep, string> = { lookup: 'lookup', post: 'POST', delete: 'delete' };

function optionsOf(opts: string | OverwriteOptions, fallbackLabel: string) {
	const options = typeof opts === 'string' ? { label: opts } : opts;
	return { ...options, label: options.label ?? fallbackLabel };
}

async function failure(
	step: OverwriteStep,
	res: Response,
	opts: OverwriteOptions & { label: string }
): Promise<Error> {
	if (opts.fail) return opts.fail(step, res);
	return new Error(`${opts.label} ${STEP_WORD[step]} failed: ${res.status}`);
}

export async function replaceEntityProperty(
	cfg: { db: string; token: string },
	entityId: string,
	value: EntuWireValue,
	fetchImpl: typeof fetch = fetch,
	opts: string | OverwriteOptions = 'replaceEntityProperty'
): Promise<void> {
	const options = optionsOf(opts, 'replaceEntityProperty');
	const prop = value.type;

	const getRes = await entuFetch(cfg.db, `entity/${entityId}?props=${prop}`, cfg.token, {}, fetchImpl);
	if (!getRes.ok) throw await failure('lookup', getRes, options);
	const body = (await getRes.json()) as { entity?: Record<string, Array<{ _id: string }>> };
	const existing = body.entity?.[prop] ?? [];

	await overwriteEntityValues(cfg, entityId, [{ value, existing }], fetchImpl, options);
}

// The `_id` makes Entu replace the old value in the same call, so a failed POST leaves it intact.
// It is not compare-and-swap: a gone `_id` appends, so double-firing callers keep their own guard.
// Extra values exist only in damaged data and are deleted after the POST, never before.
export async function overwriteEntityValues(
	cfg: { db: string; token: string },
	entityId: string,
	entries: ReadonlyArray<OverwriteEntry>,
	fetchImpl: typeof fetch = fetch,
	opts: string | OverwriteOptions = 'overwriteEntityValues'
): Promise<void> {
	const options = optionsOf(opts, 'overwriteEntityValues');
	const body = entries.map(({ value, existing }) =>
		existing[0] ? { _id: existing[0]._id, ...value } : value
	);

	const postRes = await entuFetch(
		cfg.db,
		`entity/${entityId}`,
		cfg.token,
		{
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body)
		},
		fetchImpl
	);
	if (!postRes.ok) throw await failure('post', postRes, options);

	for (const { existing } of entries) {
		for (const v of existing.slice(1)) {
			const delRes = await entuFetch(cfg.db, `property/${v._id}`, cfg.token, { method: 'DELETE' }, fetchImpl);
			if (!delRes.ok) throw await failure('delete', delRes, options);
		}
	}
}

// A datetime slot has no empty value (Entu stores `datetime: ''` as a bad string), so clearing a
// non-string property deletes its values instead of overwriting them.
export async function clearEntityProperty(
	cfg: { db: string; token: string },
	entityId: string,
	prop: string,
	fetchImpl: typeof fetch = fetch,
	label = 'clearEntityProperty'
): Promise<void> {
	const getRes = await entuFetch(cfg.db, `entity/${entityId}?props=${prop}`, cfg.token, {}, fetchImpl);
	if (!getRes.ok) throw new Error(`${label} lookup failed: ${getRes.status}`);
	const body = (await getRes.json()) as { entity?: Record<string, Array<{ _id: string }>> };
	const existing = body.entity?.[prop] ?? [];

	for (const v of existing) {
		const delRes = await entuFetch(cfg.db, `property/${v._id}`, cfg.token, { method: 'DELETE' }, fetchImpl);
		if (!delRes.ok) throw new Error(`${label} delete failed: ${delRes.status}`);
	}
}

// (*MVOX:Palestrina*)
// (*MVOX:Josquin*)
