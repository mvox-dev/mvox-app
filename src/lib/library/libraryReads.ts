// Library list reads; read-only, and never a still-private field (library-browse design §2).
import type { EntuFetchOptions } from '$lib/entu/request';
import type { EntuCfg } from '$lib/seasons/entuSeasons';
import { readList, type ListRead } from '$lib/entu/listRead';

export interface Work {
	id: string;
	name: string;
	composer: string;
}

type WorkRaw = { _id: string; name?: Array<{ string: string }>; composer?: Array<{ string: string }> };
type ParentRaw = { _parent?: Array<{ reference: string; entity_type?: string }> };

function parentOf(raw: ParentRaw, type: string): string {
	return (raw._parent ?? []).find((p) => p.entity_type === type)?.reference ?? '';
}

// Shared readers: `opts` defaults the cache off; libraryPageData.ts switches it on.
export async function listWorks(
	cfg: EntuCfg,
	fetchImpl: typeof fetch = fetch,
	opts: EntuFetchOptions = {}
): Promise<ListRead<Work>> {
	return readList<WorkRaw, Work>(
		cfg,
		'listWorks',
		'entity?_type.string=work&props=name,composer&limit=500',
		(raw) =>
			raw.map((r) => ({
				id: r._id,
				name: r.name?.[0]?.string ?? '',
				composer: r.composer?.[0]?.string ?? ''
			})),
		fetchImpl,
		opts
	);
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
	return readList<EditionRaw, Edition>(
		cfg,
		'listEditions',
		`entity?_type.string=edition&_parent.reference=${encodeURIComponent(workId)}&props=name,publisher,external_link,file&limit=500`,
		(raw) => raw.map((r) => toEdition(r)),
		fetchImpl,
		opts
	);
}

// Every edition in the collective, so the librarian pickers need no expanded tree node.
export async function listAllEditions(
	cfg: EntuCfg,
	fetchImpl: typeof fetch = fetch,
	opts: EntuFetchOptions = {}
): Promise<ListRead<Edition>> {
	return readList<EditionRaw & ParentRaw, Edition>(
		cfg,
		'listAllEditions',
		'entity?_type.string=edition&props=name,publisher,_parent,external_link,file&limit=500',
		(raw) => raw.map((r) => toEdition(r, parentOf(r, 'work'))),
		fetchImpl,
		opts
	);
}

export interface Copy {
	id: string;
	name: string;
	copyNumber: number;
	/** Parent edition ID; empty string when loaded without parent context. */
	editionId: string;
}

type CopyRaw = { _id: string; name?: Array<{ string: string }>; copy_number?: Array<{ number: number }> };

function toCopy(raw: CopyRaw, editionId: string): Copy {
	return { id: raw._id, name: raw.name?.[0]?.string ?? '', copyNumber: raw.copy_number?.[0]?.number ?? 0, editionId };
}

export async function listCopies(
	cfg: EntuCfg,
	editionId: string,
	fetchImpl: typeof fetch = fetch,
	opts: EntuFetchOptions = {}
): Promise<ListRead<Copy>> {
	return readList<CopyRaw, Copy>(
		cfg,
		'listCopies',
		`entity?_type.string=copy&_parent.reference=${encodeURIComponent(editionId)}&props=name,copy_number&limit=500`,
		(raw) => raw.map((r) => toCopy(r, editionId)),
		fetchImpl,
		opts
	);
}

// Every copy in the collective; `_parent` gives each its edition for bulk-return grouping.
export async function listAllCopies(
	cfg: EntuCfg,
	fetchImpl: typeof fetch = fetch,
	opts: EntuFetchOptions = {}
): Promise<ListRead<Copy>> {
	return readList<CopyRaw & ParentRaw, Copy>(
		cfg,
		'listAllCopies',
		'entity?_type.string=copy&props=name,copy_number,_parent&limit=500',
		(raw) => raw.map((r) => toCopy(r, parentOf(r, 'edition'))),
		fetchImpl,
		opts
	);
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

type LendingRaw = {
	_id: string;
	copy?: Array<{ reference: string }>;
	member?: Array<{ reference: string }>;
	assigned_at?: Array<{ date: string }>;
	assigned_until?: Array<{ date: string }>;
	returned_at?: Array<{ date: string }>;
};

export async function listLendings(
	cfg: EntuCfg,
	fetchImpl: typeof fetch = fetch,
	opts: EntuFetchOptions = {}
): Promise<ListRead<Lending>> {
	// createLending always writes copy and member together, so a row missing one is corrupt:
	// drop it with a warning rather than fail the page, and never pass '' on as an id (#258).
	return readList<LendingRaw, Lending>(
		cfg,
		'listLendings',
		'entity?_type.string=lending&props=copy,member,assigned_at,assigned_until,returned_at&limit=500',
		(raw) =>
			raw.flatMap((r) => {
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
			}),
		fetchImpl,
		opts
	);
}
