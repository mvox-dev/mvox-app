import { entuFetch } from '$lib/entu/request';
import type { EntuCfg } from '$lib/seasons/entuSeasons';
import { listMyProfiles } from '$lib/profile/profileData';

// T6.3/#58(TBD) — the library READ data layer. Read-only throughout: no
// entuFetch(..., { method: 'POST' | 'DELETE' }) anywhere in this module. Field set
// is the T6.1/T6.2/T6.2b ruled set (design doc 2026-08-08-library-browse-design.md
// §2) — queries here must never request a still-private field (barcode, condition,
// notes, edition_type, license, year, file, genre, edition.cost, lending.renewed_at,
// lending.name, lending.notes).

export interface Work {
	id: string;
	name: string;
	composer: string;
}

export async function listWorks(cfg: EntuCfg, fetchImpl: typeof fetch = fetch): Promise<Work[]> {
	const res = await entuFetch(
		cfg.db,
		'entity?_type.string=work&props=name,composer&limit=500',
		cfg.token,
		{},
		fetchImpl
	);
	if (!res.ok) throw new Error(`listWorks failed: ${res.status}`);
	const body = (await res.json()) as {
		entities?: Array<{ _id: string; name?: Array<{ string: string }>; composer?: Array<{ string: string }> }>;
	};
	return (body.entities ?? []).map((raw) => ({
		id: raw._id,
		name: raw.name?.[0]?.string ?? '',
		composer: raw.composer?.[0]?.string ?? ''
	}));
}

export interface Edition {
	id: string;
	name: string;
	publisher: string;
}

export async function listEditions(
	cfg: EntuCfg,
	workId: string,
	fetchImpl: typeof fetch = fetch
): Promise<Edition[]> {
	const res = await entuFetch(
		cfg.db,
		`entity?_type.string=edition&_parent.reference=${encodeURIComponent(workId)}&props=name,publisher&limit=500`,
		cfg.token,
		{},
		fetchImpl
	);
	if (!res.ok) throw new Error(`listEditions failed: ${res.status}`);
	const body = (await res.json()) as {
		entities?: Array<{ _id: string; name?: Array<{ string: string }>; publisher?: Array<{ string: string }> }>;
	};
	return (body.entities ?? []).map((raw) => ({
		id: raw._id,
		name: raw.name?.[0]?.string ?? '',
		publisher: raw.publisher?.[0]?.string ?? ''
	}));
}

export interface Copy {
	id: string;
	name: string;
	copyNumber: number;
}

export async function listCopies(
	cfg: EntuCfg,
	editionId: string,
	fetchImpl: typeof fetch = fetch
): Promise<Copy[]> {
	const res = await entuFetch(
		cfg.db,
		`entity?_type.string=copy&_parent.reference=${encodeURIComponent(editionId)}&props=name,copy_number&limit=500`,
		cfg.token,
		{},
		fetchImpl
	);
	if (!res.ok) throw new Error(`listCopies failed: ${res.status}`);
	const body = (await res.json()) as {
		entities?: Array<{ _id: string; name?: Array<{ string: string }>; copy_number?: Array<{ number: number }> }>;
	};
	return (body.entities ?? []).map((raw) => ({
		id: raw._id,
		name: raw.name?.[0]?.string ?? '',
		copyNumber: raw.copy_number?.[0]?.number ?? 0
	}));
}

/**
 * Flat list of ALL copies in the collective (no parent-edition filter). Used by
 * the librarian checkout form where the copy picker must show every available
 * copy regardless of which edition tree node the user has expanded.
 */
export async function listAllCopies(cfg: EntuCfg, fetchImpl: typeof fetch = fetch): Promise<Copy[]> {
	const res = await entuFetch(
		cfg.db,
		'entity?_type.string=copy&props=name,copy_number&limit=500',
		cfg.token,
		{},
		fetchImpl
	);
	if (!res.ok) throw new Error(`listAllCopies failed: ${res.status}`);
	const body = (await res.json()) as {
		entities?: Array<{ _id: string; name?: Array<{ string: string }>; copy_number?: Array<{ number: number }> }>;
	};
	return (body.entities ?? []).map((raw) => ({
		id: raw._id,
		name: raw.name?.[0]?.string ?? '',
		copyNumber: raw.copy_number?.[0]?.number ?? 0
	}));
}

export interface Lending {
	id: string;
	copyId: string;
	memberId: string;
	assignedAt: string;
	assignedUntil: string;
	/** '' = absent = still out (schema note: entu/research schema.ts:524). */
	returnedAt: string;
}

export async function listLendings(cfg: EntuCfg, fetchImpl: typeof fetch = fetch): Promise<Lending[]> {
	const res = await entuFetch(
		cfg.db,
		'entity?_type.string=lending&props=copy,member,assigned_at,assigned_until,returned_at&limit=500',
		cfg.token,
		{},
		fetchImpl
	);
	if (!res.ok) throw new Error(`listLendings failed: ${res.status}`);
	const body = (await res.json()) as {
		entities?: Array<{
			_id: string;
			copy?: Array<{ reference: string }>;
			member?: Array<{ reference: string }>;
			assigned_at?: Array<{ date: string }>;
			assigned_until?: Array<{ date: string }>;
			returned_at?: Array<{ date: string }>;
		}>;
	};
	return (body.entities ?? []).map((raw) => ({
		id: raw._id,
		copyId: raw.copy?.[0]?.reference ?? '',
		memberId: raw.member?.[0]?.reference ?? '',
		assignedAt: raw.assigned_at?.[0]?.date ?? '',
		assignedUntil: raw.assigned_until?.[0]?.date ?? '',
		returnedAt: raw.returned_at?.[0]?.date ?? ''
	}));
}

export type CopyAvailability =
	| { status: 'available' }
	| { status: 'lent'; memberId: string; assignedAt: string; assignedUntil: string };

/**
 * Pure — no fetch. `returnedAt === ''` is "still out" (schema note). More than one
 * concurrent active lending for one copy is a data anomaly (should be impossible
 * under correct lending discipline) — warn and take the most recently assigned
 * rather than throwing and breaking the whole page over one dirty row.
 */
export function deriveCopyAvailability(copyId: string, lendings: Lending[]): CopyAvailability {
	const active = lendings.filter((l) => l.copyId === copyId && l.returnedAt === '');
	if (active.length === 0) return { status: 'available' };
	if (active.length > 1) {
		console.warn(
			`deriveCopyAvailability: copy ${copyId} has ${active.length} concurrent active lendings`
		);
	}
	const chosen = active.reduce((a, b) => (a.assignedAt >= b.assignedAt ? a : b));
	return {
		status: 'lent',
		memberId: chosen.memberId,
		assignedAt: chosen.assignedAt,
		assignedUntil: chosen.assignedUntil
	};
}

/**
 * `lending.member` references a `member` entity, which carries no name of its own
 * (entu/research schema.ts:287-336) — same shape rosterData.ts already solved for
 * roster rows: member -> person -> profile -> name. Reuses profileData.ts's
 * listMyProfiles directly (NOT rosterData.ts's listProfilesForPerson — that
 * wrapper's own doc says it exists purely for roster call-site clarity, not as a
 * cross-feature entry point). Same domain-or-public scan as rosterData.ts's
 * toRosterRow (rosterData.ts:160-167) — NEVER resolveField, NEVER private.
 * Duplicated deliberately (rule of three — two callers doesn't justify widening
 * either file's exported surface for a one-line scan).
 */
async function resolveBorrowerName(
	cfg: EntuCfg,
	memberId: string,
	fetchImpl: typeof fetch = fetch
): Promise<string> {
	const res = await entuFetch(cfg.db, `entity/${memberId}?props=person`, cfg.token, {}, fetchImpl);
	if (!res.ok) throw new Error(`resolveBorrowerName: member ${memberId} lookup failed: ${res.status}`);
	const body = (await res.json()) as { entity?: { person?: Array<{ reference: string }> } };
	const personId = body.entity?.person?.[0]?.reference;
	if (!personId) {
		throw new Error(`resolveBorrowerName: member ${memberId} carries no readable person reference`);
	}

	const profiles = await listMyProfiles(cfg, personId, fetchImpl);
	let domain = '';
	let pub = '';
	for (const p of profiles) {
		if (p._sharing === 'domain' && p.name.trim() !== '') domain = p.name.trim();
		else if (p._sharing === 'public' && p.name.trim() !== '') pub = p.name.trim();
	}
	return domain !== '' ? domain : pub;
}

/**
 * Batched + deduped borrower-name resolution. Fails loud as a whole (matches
 * loadRoster's Promise.all semantics, rosterData.ts:188-199) — a resolution
 * failure rejects the whole batch rather than silently showing an unresolved
 * copy as available or unattributed.
 */
export async function resolveBorrowerNames(
	cfg: EntuCfg,
	memberIds: string[],
	fetchImpl: typeof fetch = fetch
): Promise<Map<string, string>> {
	const unique = [...new Set(memberIds)];
	const pairs = await Promise.all(
		unique.map(async (id) => [id, await resolveBorrowerName(cfg, id, fetchImpl)] as const)
	);
	return new Map(pairs);
}

// (*MVOX:Tallis* — RED spec)
// (*MVOX:Josquin* — GREEN implementation)
