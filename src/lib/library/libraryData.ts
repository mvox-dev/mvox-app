import { entuFetch } from '$lib/entu/request';
import type { EntuCfg } from '$lib/seasons/entuSeasons';
import { listMyProfiles } from '$lib/profile/profileData';

// T6.3/#58(TBD) — the library READ data layer. Read-only throughout: no
// entuFetch(..., { method: 'POST' | 'DELETE' }) anywhere in this module. Field set
// is the T6.1/T6.2/T6.2b ruled set (design doc 2026-08-08-library-browse-design.md
// §2) — queries here must never request a still-private field (barcode, condition,
// copy.notes, lending.notes, edition_type, license, year, genre, edition.cost,
// lending.renewed_at, lending.name). EXCEPTION (#89 TR.1): `edition.file` was
// widened to domain-visible 2026-08-10; `edition.external_link` was already domain
// (see scripts/migrations/edition-widen-junction-types-2026-08-10.ts). Both are now
// queried below alongside name/publisher.

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

export interface EditionFile {
	id: string;
	filename: string;
	filesize: number;
	filetype: string;
}

export interface Edition {
	id: string;
	name: string;
	publisher: string;
	/** Parent work ID; populated by listAllEditions, empty when loaded via listEditions. */
	workId?: string;
	/** Multi-value `external_link` (#89 TR.1 widen); [] when absent, never undefined. */
	externalLinks: string[];
	/** Multi-value `file` prop metadata (#89 TR.1 widen); [] when absent, never undefined. */
	files: EditionFile[];
}

type EditionRaw = {
	_id: string;
	name?: Array<{ string: string }>;
	publisher?: Array<{ string: string }>;
	external_link?: Array<{ string: string }>;
	file?: Array<{ _id: string; filename: string; filesize: number; filetype: string }>;
};

function toEdition(raw: EditionRaw, workId?: string): Edition {
	return {
		id: raw._id,
		name: raw.name?.[0]?.string ?? '',
		publisher: raw.publisher?.[0]?.string ?? '',
		...(workId !== undefined ? { workId } : {}),
		externalLinks: (raw.external_link ?? []).map((v) => v.string),
		files: (raw.file ?? []).map((f) => ({
			id: f._id,
			filename: f.filename,
			filesize: f.filesize,
			filetype: f.filetype
		}))
	};
}

export async function listEditions(
	cfg: EntuCfg,
	workId: string,
	fetchImpl: typeof fetch = fetch
): Promise<Edition[]> {
	const res = await entuFetch(
		cfg.db,
		`entity?_type.string=edition&_parent.reference=${encodeURIComponent(workId)}&props=name,publisher,external_link,file&limit=500`,
		cfg.token,
		{},
		fetchImpl
	);
	if (!res.ok) throw new Error(`listEditions failed: ${res.status}`);
	const body = (await res.json()) as { entities?: EditionRaw[] };
	return (body.entities ?? []).map((raw) => toEdition(raw));
}

/**
 * Flat list of ALL editions in the collective (no parent-work filter). Used by
 * the librarian bulk checkout/return UI where the edition picker must show every
 * edition regardless of which work tree node the user has expanded.
 */
export async function listAllEditions(cfg: EntuCfg, fetchImpl: typeof fetch = fetch): Promise<Edition[]> {
	const res = await entuFetch(
		cfg.db,
		'entity?_type.string=edition&props=name,publisher,_parent,external_link,file&limit=500',
		cfg.token,
		{},
		fetchImpl
	);
	if (!res.ok) throw new Error(`listAllEditions failed: ${res.status}`);
	const body = (await res.json()) as {
		entities?: Array<EditionRaw & { _parent?: Array<{ reference: string; entity_type?: string }> }>;
	};
	return (body.entities ?? []).map((raw) =>
		toEdition(raw, (raw._parent ?? []).find((p) => p.entity_type === 'work')?.reference ?? '')
	);
}

export interface Copy {
	id: string;
	name: string;
	copyNumber: number;
	/** Parent edition ID; empty string when loaded without parent context. */
	editionId: string;
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
		copyNumber: raw.copy_number?.[0]?.number ?? 0,
		editionId
	}));
}

/**
 * Flat list of ALL copies in the collective (no parent-edition filter). Used by
 * the librarian checkout form where the copy picker must show every available
 * copy regardless of which edition tree node the user has expanded. Includes
 * `_parent` so each copy carries its edition ID for bulk-return grouping.
 */
export async function listAllCopies(cfg: EntuCfg, fetchImpl: typeof fetch = fetch): Promise<Copy[]> {
	const res = await entuFetch(
		cfg.db,
		'entity?_type.string=copy&props=name,copy_number,_parent&limit=500',
		cfg.token,
		{},
		fetchImpl
	);
	if (!res.ok) throw new Error(`listAllCopies failed: ${res.status}`);
	const body = (await res.json()) as {
		entities?: Array<{ _id: string; name?: Array<{ string: string }>; copy_number?: Array<{ number: number }>; _parent?: Array<{ reference: string; entity_type?: string }> }>;
	};
	return (body.entities ?? []).map((raw) => ({
		id: raw._id,
		name: raw.name?.[0]?.string ?? '',
		copyNumber: raw.copy_number?.[0]?.number ?? 0,
		editionId: (raw._parent ?? []).find((p) => p.entity_type === 'edition')?.reference ?? ''
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
	// #258 — a lending row is created ONLY by createLending (lendingActions.ts),
	// which always POSTs copy + member together in one entity create. There is
	// no in-app path that produces a lending with just one of the two refs, so
	// a row missing either is corrupt data, not a legitimate intermediate
	// state — same read as the concurrent-active-lending anomaly already
	// handled below (deriveCopyAvailability): warn and keep serving the rest
	// of the page rather than letting one dirty row take the whole library
	// read down for everyone (Promise.all in +page.svelte would otherwise turn
	// one bad row into a hard load-error for every collective member). Coercing
	// the missing ref to '' — the old behaviour — is what let '' silently
	// compose an `entity/` (LIST route) request downstream; dropping the row
	// here means resolveCopyName/resolveBorrowerName/resolveCopyChains never
	// see an empty id from a real lending row at all.
	return (body.entities ?? []).flatMap((raw) => {
		const copyId = raw.copy?.[0]?.reference;
		const memberId = raw.member?.[0]?.reference;
		if (!copyId || !memberId) {
			console.warn(
				`listLendings: dropping malformed lending row ${raw._id} — missing ${!copyId ? 'copy' : 'member'} reference (#258)`
			);
			return [];
		}
		return [
			{
				id: raw._id,
				copyId,
				memberId,
				assignedAt: raw.assigned_at?.[0]?.date ?? '',
				assignedUntil: raw.assigned_until?.[0]?.date ?? '',
				returnedAt: raw.returned_at?.[0]?.date ?? ''
			}
		];
	});
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
 * Resolves a copy entity's display name. Prefers `name`; falls back to
 * `#<copy_number>`; falls back to '' (page renders a placeholder).
 */
async function resolveCopyName(
	cfg: EntuCfg,
	copyId: string,
	fetchImpl: typeof fetch = fetch
): Promise<string> {
	const res = await entuFetch(cfg.db, `entity/${copyId}?props=name,copy_number`, cfg.token, {}, fetchImpl);
	if (!res.ok) throw new Error(`resolveCopyName: copy ${copyId} lookup failed: ${res.status}`);
	const body = (await res.json()) as {
		entity?: { name?: Array<{ string: string }>; copy_number?: Array<{ number: number }> };
	};
	const name = body.entity?.name?.[0]?.string ?? '';
	if (name) return name;
	const num = body.entity?.copy_number?.[0]?.number;
	if (num !== undefined) return `#${num}`;
	return '';
}

/**
 * Batched + deduped copy-name resolution. Same fail-loud-as-a-whole pattern
 * as resolveBorrowerNames.
 */
export async function resolveCopyNames(
	cfg: EntuCfg,
	copyIds: string[],
	fetchImpl: typeof fetch = fetch
): Promise<Map<string, string>> {
	const unique = [...new Set(copyIds)];
	const pairs = await Promise.all(
		unique.map(async (id) => [id, await resolveCopyName(cfg, id, fetchImpl)] as const)
	);
	return new Map(pairs);
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

/**
 * Pure — no fetch. Counts how many copies of a given edition are currently
 * available (not actively lent). An active lending has `returnedAt === ''`.
 */
export function deriveEditionAvailability(
	editionId: string,
	copies: Copy[],
	lendings: Lending[]
): { available: number; total: number } {
	const editionCopies = copies.filter((c) => c.editionId === editionId);
	const available = editionCopies.filter(
		(c) => deriveCopyAvailability(c.id, lendings).status === 'available'
	).length;
	return { available, total: editionCopies.length };
}

/**
 * Pure — no fetch. Counts how many copies across ALL editions of a given work
 * are currently available (not actively lent). Aggregates per-edition
 * availability for the whole work subtree.
 */
export function deriveWorkAvailability(
	workId: string,
	editions: Edition[],
	copies: Copy[],
	lendings: Lending[]
): { available: number; total: number } {
	const editionIds = new Set(editions.filter((e) => e.workId === workId).map((e) => e.id));
	const workCopies = copies.filter((c) => editionIds.has(c.editionId));
	const activeLentCopyIds = new Set(
		lendings.filter((l) => l.returnedAt === '').map((l) => l.copyId)
	);
	const lent = workCopies.filter((c) => activeLentCopyIds.has(c.id)).length;
	return { available: workCopies.length - lent, total: workCopies.length };
}

/**
 * Pure — no fetch. Finds an active lending for a specific member within a set
 * of edition copy IDs. Returns the lending if the member already holds a copy
 * of that edition, undefined otherwise.
 */
export function activeLendingForMemberInEdition(
	memberId: string,
	editionCopyIds: Set<string>,
	lendings: Lending[]
): Lending | undefined {
	return lendings.find(
		(l) => l.memberId === memberId && editionCopyIds.has(l.copyId) && l.returnedAt === ''
	);
}

export interface LoanChain {
	copyNumber: number;
	workName: string;
	editionName: string;
}

export function formatLoanChainLabel(chain: LoanChain): string {
	const context = `${chain.workName} / ${chain.editionName}`;
	if (!chain.copyNumber) return context;
	return `Copy #${chain.copyNumber} — ${context}`;
}

export async function resolveCopyChains(
	cfg: EntuCfg,
	copyIds: string[],
	works: Work[],
	fetchImpl: typeof fetch = fetch
): Promise<Map<string, LoanChain>> {
	const unique = [...new Set(copyIds)];
	const editionCache = new Map<string, { name: string; workId: string }>();

	const pairs = await Promise.all(
		unique.map(async (copyId) => {
			const copyRes = await entuFetch(cfg.db, `entity/${copyId}?props=copy_number,_parent`, cfg.token, {}, fetchImpl);
			if (!copyRes.ok) throw new Error(`resolveCopyChains: copy ${copyId} lookup failed: ${copyRes.status}`);
			const copyBody = (await copyRes.json()) as {
				entity?: {
					copy_number?: Array<{ number: number }>;
					_parent?: Array<{ reference: string; entity_type?: string }>;
				};
			};
			const copyNumber = copyBody.entity?.copy_number?.[0]?.number ?? 0;
			const editionParent = (copyBody.entity?._parent ?? []).find((p) => p.entity_type === 'edition');
			if (!editionParent) {
				return [copyId, { copyNumber, workName: '', editionName: '' }] as const;
			}

			const editionId = editionParent.reference;
			if (!editionCache.has(editionId)) {
				const edRes = await entuFetch(cfg.db, `entity/${editionId}?props=name,_parent`, cfg.token, {}, fetchImpl);
				if (!edRes.ok) throw new Error(`resolveCopyChains: edition ${editionId} lookup failed: ${edRes.status}`);
				const edBody = (await edRes.json()) as {
					entity?: {
						name?: Array<{ string: string }>;
						_parent?: Array<{ reference: string; entity_type?: string }>;
					};
				};
				const edName = edBody.entity?.name?.[0]?.string ?? '';
				const workParent = (edBody.entity?._parent ?? []).find((p) => p.entity_type === 'work');
				editionCache.set(editionId, { name: edName, workId: workParent?.reference ?? '' });
			}

			const ed = editionCache.get(editionId)!;
			const workName = works.find((w) => w.id === ed.workId)?.name ?? '';
			return [copyId, { copyNumber, workName, editionName: ed.name }] as const;
		})
	);
	return new Map(pairs);
}

// (*MVOX:Tallis* — RED spec)
// (*MVOX:Josquin* — GREEN implementation)
