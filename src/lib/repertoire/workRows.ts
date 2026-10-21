// Joins each event's repertoire refs with work/edition/copy details, read once per agenda.
import type { EntuCfg } from '$lib/entu/cfg';
import {
	listWorks,
	listAllEditions,
	listAllCopies,
	type Work,
	type Edition,
	type Copy,
	type EditionFile
} from '$lib/library/libraryData';
import {
	resolveEventWorksBatch,
	type EventWorks,
	type RepertoireReadOptions
} from './repertoireData';
import type { RepertoireStatus, WorkRow } from './types';

export interface WorkRowSources {
	worksById: Map<string, Work>;
	editionsById: Map<string, Edition>;
	copyCountByEditionId: Map<string, number>;
}

export function collectSources(works: Work[], editions: Edition[], copies: Copy[]): WorkRowSources {
	const copyCountByEditionId = new Map<string, number>();
	for (const copy of copies) {
		if (copy.editionId === '') continue;
		copyCountByEditionId.set(copy.editionId, (copyCountByEditionId.get(copy.editionId) ?? 0) + 1);
	}
	return {
		worksById: new Map(works.map((w) => [w.id, w])),
		editionsById: new Map(editions.map((e) => [e.id, e])),
		copyCountByEditionId
	};
}

// Prefers a PDF, else the first file, so a vaguely typed upload still offers the link.
function pickFile(edition: Edition | undefined): EditionFile | undefined {
	if (!edition || edition.files.length === 0) return undefined;
	const pdf = edition.files.find(
		(f) => f.filetype.toLowerCase().includes('pdf') || f.filename.toLowerCase().endsWith('.pdf')
	);
	return pdf ?? edition.files[0];
}

// external_link is free text bound into an href Svelte does not sanitize: only http(s)
// survives, and a bad value is dropped rather than rendered.
function safeExternalLinks(links: string[]): string[] {
	return links.filter((v) => {
		try {
			const { protocol } = new URL(v);
			return protocol === 'http:' || protocol === 'https:';
		} catch {
			return false;
		}
	});
}

const KNOWN_STATUSES = new Set<string>([
	'learning',
	'active',
	'retired',
	'dropped'
] satisfies RepertoireStatus[]);

// Anything outside the four schema statuses is a data slip; null keeps the select honest.
function narrowStatus(raw: string): RepertoireStatus | null {
	return KNOWN_STATUSES.has(raw) ? (raw as RepertoireStatus) : null;
}

// Missing lookups degrade to '' and keep the row: a blank composer beats a shorter programme.
export function buildWorkRows(eventWorks: EventWorks, sources: WorkRowSources): WorkRow[] {
	const { worksById, editionsById, copyCountByEditionId } = sources;

	if (eventWorks.source === 'program') {
		return eventWorks.items.map((item) => {
			const edition = editionsById.get(item.editionId);
			const work = edition?.workId ? worksById.get(edition.workId) : undefined;
			const file = pickFile(edition);
			return {
				id: item.id,
				kind: 'program' as const,
				workId: edition?.workId ?? '',
				editionId: item.editionId,
				workName: work?.name || item.name,
				composer: work?.composer ?? '',
				status: null,
				editionName: edition?.name ?? '',
				ordinal: item.ordinal,
				fileId: file?.id ?? '',
				fileName: file?.filename ?? '',
				externalLinks: safeExternalLinks(edition?.externalLinks ?? []),
				canBorrow: (copyCountByEditionId.get(item.editionId) ?? 0) > 0,
				notes: item.notes
			};
		});
	}

	return eventWorks.items.map((item) => {
		const work = worksById.get(item.workId);
		const edition = item.editionId === '' ? undefined : editionsById.get(item.editionId);
		const file = pickFile(edition);
		return {
			id: item.id,
			kind: 'repertoire' as const,
			workId: item.workId,
			editionId: item.editionId,
			workName: work?.name || item.name,
			composer: work?.composer ?? '',
			status: narrowStatus(item.status),
			editionName: edition?.name ?? '',
			ordinal: null,
			fileId: file?.id ?? '',
			fileName: file?.filename ?? '',
			externalLinks: safeExternalLinks(edition?.externalLinks ?? []),
			canBorrow: (copyCountByEditionId.get(item.editionId) ?? 0) > 0,
			notes: ''
		};
	});
}

export async function loadWorksByEventId(
	cfg: EntuCfg,
	eventIds: string[],
	seasonId: string | null,
	fetchImpl: typeof fetch = fetch,
	options: RepertoireReadOptions = {}
): Promise<Record<string, WorkRow[]>> {
	if (eventIds.length === 0) return {};

	const [worksRead, editionsRead, copiesRead, worksByEvent] = await Promise.all([
		listWorks(cfg, fetchImpl, options),
		listAllEditions(cfg, fetchImpl, options),
		listAllCopies(cfg, fetchImpl, options),
		resolveEventWorksBatch(cfg, eventIds, seasonId, fetchImpl, options)
	]);
	// A blank editionName reads as "No pinned edition", which a truncated lookup cannot back,
	// so editionsRead.truncated rides every row.
	const sources = collectSources(worksRead.items, editionsRead.items, copiesRead.items);
	const out: Record<string, WorkRow[]> = {};
	for (const [eventId, eventWorks] of Object.entries(worksByEvent)) {
		out[eventId] = buildWorkRows(eventWorks, sources).map((row) => ({
			...row,
			truncated: editionsRead.truncated
		}));
	}
	return out;
}

// (*MVOX:Josquin*)
