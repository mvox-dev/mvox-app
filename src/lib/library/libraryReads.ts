// Library list reads; read-only, and never a still-private field (library-browse design §2).
import { entuFetch, type EntuFetchOptions } from '$lib/entu/request';
import type { EntuCfg } from '$lib/seasons/entuSeasons';
import { deriveListRead, type ListRead } from '$lib/entu/listRead';

export interface Work {
	id: string;
	name: string;
	composer: string;
}

// Shared readers: `opts` defaults the cache off; libraryPageData.ts switches it on.
export async function listWorks(
	cfg: EntuCfg,
	fetchImpl: typeof fetch = fetch,
	opts: EntuFetchOptions = {}
): Promise<ListRead<Work>> {
	const res = await entuFetch(
		cfg.db,
		'entity?_type.string=work&props=name,composer&limit=500',
		cfg.token,
		{},
		fetchImpl,
		opts
	);
	if (!res.ok) throw new Error(`listWorks failed: ${res.status}`);
	const body = (await res.json()) as {
		count?: number;
		entities?: Array<{ _id: string; name?: Array<{ string: string }>; composer?: Array<{ string: string }> }>;
	};
	const raw = body.entities ?? [];
	const items = raw.map((r) => ({
		id: r._id,
		name: r.name?.[0]?.string ?? '',
		composer: r.composer?.[0]?.string ?? ''
	}));
	return deriveListRead(items, raw.length, body.count);
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
	externalLinks: string[];
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
	fetchImpl: typeof fetch = fetch,
	opts: EntuFetchOptions = {}
): Promise<ListRead<Edition>> {
	const res = await entuFetch(
		cfg.db,
		`entity?_type.string=edition&_parent.reference=${encodeURIComponent(workId)}&props=name,publisher,external_link,file&limit=500`,
		cfg.token,
		{},
		fetchImpl,
		opts
	);
	if (!res.ok) throw new Error(`listEditions failed: ${res.status}`);
	const body = (await res.json()) as { count?: number; entities?: EditionRaw[] };
	const raw = body.entities ?? [];
	return deriveListRead(raw.map((r) => toEdition(r)), raw.length, body.count);
}

// Every edition in the collective, so the librarian pickers need no expanded tree node.
export async function listAllEditions(
	cfg: EntuCfg,
	fetchImpl: typeof fetch = fetch,
	opts: EntuFetchOptions = {}
): Promise<ListRead<Edition>> {
	const res = await entuFetch(
		cfg.db,
		'entity?_type.string=edition&props=name,publisher,_parent,external_link,file&limit=500',
		cfg.token,
		{},
		fetchImpl,
		opts
	);
	if (!res.ok) throw new Error(`listAllEditions failed: ${res.status}`);
	const body = (await res.json()) as {
		count?: number;
		entities?: Array<EditionRaw & { _parent?: Array<{ reference: string; entity_type?: string }> }>;
	};
	const raw = body.entities ?? [];
	const items = raw.map((r) => toEdition(r, (r._parent ?? []).find((p) => p.entity_type === 'work')?.reference ?? ''));
	return deriveListRead(items, raw.length, body.count);
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
	fetchImpl: typeof fetch = fetch,
	opts: EntuFetchOptions = {}
): Promise<ListRead<Copy>> {
	const res = await entuFetch(
		cfg.db,
		`entity?_type.string=copy&_parent.reference=${encodeURIComponent(editionId)}&props=name,copy_number&limit=500`,
		cfg.token,
		{},
		fetchImpl,
		opts
	);
	if (!res.ok) throw new Error(`listCopies failed: ${res.status}`);
	const body = (await res.json()) as {
		count?: number;
		entities?: Array<{ _id: string; name?: Array<{ string: string }>; copy_number?: Array<{ number: number }> }>;
	};
	const raw = body.entities ?? [];
	const items = raw.map((r) => ({
		id: r._id,
		name: r.name?.[0]?.string ?? '',
		copyNumber: r.copy_number?.[0]?.number ?? 0,
		editionId
	}));
	return deriveListRead(items, raw.length, body.count);
}

// Every copy in the collective; `_parent` gives each its edition for bulk-return grouping.
export async function listAllCopies(
	cfg: EntuCfg,
	fetchImpl: typeof fetch = fetch,
	opts: EntuFetchOptions = {}
): Promise<ListRead<Copy>> {
	const res = await entuFetch(
		cfg.db,
		'entity?_type.string=copy&props=name,copy_number,_parent&limit=500',
		cfg.token,
		{},
		fetchImpl,
		opts
	);
	if (!res.ok) throw new Error(`listAllCopies failed: ${res.status}`);
	const body = (await res.json()) as {
		count?: number;
		entities?: Array<{ _id: string; name?: Array<{ string: string }>; copy_number?: Array<{ number: number }>; _parent?: Array<{ reference: string; entity_type?: string }> }>;
	};
	const raw = body.entities ?? [];
	const items = raw.map((r) => ({
		id: r._id,
		name: r.name?.[0]?.string ?? '',
		copyNumber: r.copy_number?.[0]?.number ?? 0,
		editionId: (r._parent ?? []).find((p) => p.entity_type === 'edition')?.reference ?? ''
	}));
	return deriveListRead(items, raw.length, body.count);
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

export async function listLendings(
	cfg: EntuCfg,
	fetchImpl: typeof fetch = fetch,
	opts: EntuFetchOptions = {}
): Promise<ListRead<Lending>> {
	const res = await entuFetch(
		cfg.db,
		'entity?_type.string=lending&props=copy,member,assigned_at,assigned_until,returned_at&limit=500',
		cfg.token,
		{},
		fetchImpl,
		opts
	);
	if (!res.ok) throw new Error(`listLendings failed: ${res.status}`);
	const body = (await res.json()) as {
		count?: number;
		entities?: Array<{
			_id: string;
			copy?: Array<{ reference: string }>;
			member?: Array<{ reference: string }>;
			assigned_at?: Array<{ date: string }>;
			assigned_until?: Array<{ date: string }>;
			returned_at?: Array<{ date: string }>;
		}>;
	};
	// createLending always writes copy and member together, so a row missing one is corrupt:
	// drop it with a warning rather than fail the page, and never pass '' on as an id (#258).
	const raw = body.entities ?? [];
	const items = raw.flatMap((r) => {
		const copyId = r.copy?.[0]?.reference;
		const memberId = r.member?.[0]?.reference;
		if (!copyId || !memberId) {
			console.warn(
				`listLendings: dropping malformed lending row ${r._id} — missing ${!copyId ? 'copy' : 'member'} reference (#258)`
			);
			return [];
		}
		return [
			{
				id: r._id,
				copyId,
				memberId,
				assignedAt: r.assigned_at?.[0]?.date ?? '',
				assignedUntil: r.assigned_until?.[0]?.date ?? '',
				returnedAt: r.returned_at?.[0]?.date ?? ''
			}
		];
	});
	// RAW length, never `items.length`: a dropped row must not read as truncation (#321).
	return deriveListRead(items, raw.length, body.count);
}
