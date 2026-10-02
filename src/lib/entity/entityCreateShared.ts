// The wire props, required-field checks and the one POST every entity create goes through.
import { entuFetch } from '$lib/entu/request';
import { resolveTypeId, type EntuCfg } from '$lib/seasons/entuSeasons';

export type WireProp = {
	type: string;
	reference?: string;
	string?: string;
	number?: number;
	date?: string;
	datetime?: string;
};

export function ref(type: string, value: string): WireProp {
	return { type, reference: value };
}

// Blank drops the prop: the forms hand over '' and an own '' shadows the series default.
export function optional(type: string, value: string | undefined): WireProp[] {
	const trimmed = value?.trim();
	return trimmed ? [{ type, string: trimmed }] : [];
}

// A blank number input gives null or NaN, and JSON.stringify turns NaN into null.
export function optionalNumber(type: string, value: number | undefined): WireProp[] {
	return typeof value === 'number' && Number.isFinite(value) ? [{ type, number: value }] : [];
}

export function conductorProps(refs: string[] | undefined): WireProp[] {
	return (refs ?? []).map((r) => ref('conductor', r));
}

// Checked before any fetch: Entu's `mandatory` is a soft hint, so this is the only enforcement.
export function requireText(fn: string, field: string, value: string | undefined): string {
	const trimmed = value?.trim();
	if (!trimmed) {
		throw new Error(`${fn}: ${field} must not be empty`);
	}
	return trimmed;
}

export function requireNumber(
	fn: string,
	field: string,
	value: number | undefined,
	min?: number
): number {
	if (typeof value !== 'number' || !Number.isFinite(value)) {
		throw new Error(`${fn}: ${field} must be a number`);
	}
	if (min !== undefined && value < min) {
		throw new Error(`${fn}: ${field} must be at least ${min}`);
	}
	return value;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// An inverted range gives a season nothing falls in and a series with no occurrences.
export function requireDateRange(
	fn: string,
	startField: string,
	startValue: string,
	endField: string,
	endValue: string
): { start: string; end: string } {
	const start = requireText(fn, startField, startValue);
	const end = requireText(fn, endField, endValue);
	if (ISO_DATE.test(start) && ISO_DATE.test(end) && end < start) {
		throw new Error(`${fn}: ${endField} must not be before ${startField}`);
	}
	return { start, end };
}

// The required collective parent first, then the rest in order, blanks and repeats dropped.
export function parentIdsFor(
	fn: string,
	dbEntityId: string,
	extraParentIds: Array<string | undefined> | undefined
): string[] {
	const primary = requireText(fn, 'dbEntityId', dbEntityId);
	const seen = new Set<string>([primary]);
	const ids = [primary];
	for (const raw of extraParentIds ?? []) {
		const id = raw?.trim();
		if (!id || seen.has(id)) continue;
		seen.add(id);
		ids.push(id);
	}
	return ids;
}

// Callers build the full body themselves; specs pin it exactly, so only the send is shared here.
export async function postEntity(
	cfg: EntuCfg,
	fn: string,
	props: WireProp[],
	fetchImpl: typeof fetch
): Promise<string> {
	const res = await entuFetch(
		cfg.db,
		'entity',
		cfg.token,
		{
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(props)
		},
		fetchImpl
	);
	if (!res.ok) {
		throw new Error(`${fn}: create failed: HTTP ${res.status}`);
	}
	const body = (await res.json()) as { _id?: string };
	if (!body._id) {
		throw new Error(`${fn}: create returned 2xx without _id (apparent-success trap)`);
	}
	return body._id;
}

// No `_sharing` and no rights flag: rights come down Entu's inheritance chain (Mihkel 2026-08-13).
export async function postCreate(
	cfg: EntuCfg,
	typeName: string,
	parentIds: string[],
	domainProps: WireProp[],
	fetchImpl: typeof fetch
): Promise<string> {
	const typeId = await resolveTypeId(cfg, typeName, fetchImpl);

	const props: WireProp[] = [
		ref('_type', typeId),
		...parentIds.map((id) => ref('_parent', id)),
		...domainProps
	];

	const res = await entuFetch(
		cfg.db,
		'entity',
		cfg.token,
		{
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(props)
		},
		fetchImpl
	);
	if (!res.ok) {
		throw new Error(`entityCreate: create '${typeName}' failed: HTTP ${res.status}`);
	}
	const body = (await res.json()) as { _id?: string };
	if (!body._id) {
		throw new Error(
			`entityCreate: create '${typeName}' returned 2xx without _id (apparent-success trap)`
		);
	}
	return body._id;
}

// (*MVOX:Josquin*)
