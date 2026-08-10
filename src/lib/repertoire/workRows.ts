import type { EntuCfg } from '$lib/seasons/entuSeasons';
import { listWorks, listAllEditions, listAllCopies, type Work, type Edition, type Copy } from '$lib/library/libraryData';
import {
	resolveEventWorksBatch,
	type EventWorks,
	type RepertoireReadOptions
} from './repertoireData';
import type { RepertoireStatus, WorkRow } from './types';

// #90 TR.2 — the JOIN between the repertoire data layer and the agenda's works
// view model. repertoireData.ts resolves WHICH items an event shows
// (program_items, else the season's active repertoire_items); those items carry
// only refs (workId / editionId). Everything a member actually reads — work
// name, composer, edition name, external links, whether a PDF exists, whether
// copies exist to borrow — lives on the work/edition/copy entities. This module
// resolves that lookup set ONCE for the whole agenda and joins it in.
//
// Read-only throughout: no entuFetch(..., { method: 'POST' | 'DELETE' }).

export interface WorkRowSources {
	worksById: Map<string, Work>;
	editionsById: Map<string, Edition>;
	/** How many copy entities exist per edition id — >0 is what lights Borrow. */
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

/**
 * The edition's downloadable score, as a file PROPERTY id (never a url — see
 * types.ts's `fileId` note on the 60-second signing window). Prefers an
 * actual PDF; falls back to the first file so an edition whose score was
 * uploaded with a vague filetype still offers the link.
 */
function pickFileId(edition: Edition | undefined): string {
	if (!edition || edition.files.length === 0) return '';
	const pdf = edition.files.find(
		(f) => f.filetype.toLowerCase().includes('pdf') || f.filename.toLowerCase().endsWith('.pdf')
	);
	return (pdf ?? edition.files[0]).id;
}

/**
 * Only http(s) urls survive. `edition.external_link` is free text typed by
 * anyone with editor rights on the edition, and RepertoireElement binds these
 * straight into an `href` — Svelte does not sanitize href bindings, so a
 * `javascript:` value would render as a live anchor running in the member's
 * session. Filtering here rather than in the template means every future
 * consumer of WorkRow inherits it. A bad value is DROPPED, not rendered inert:
 * a silently missing link beats a live hostile one.
 */
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

/**
 * Pure — no fetch. Joins one event's resolved items against the collective-wide
 * lookup set. Both branches produce the SAME row shape; they differ only in
 * where the work comes from and what the row carries:
 *   - 'program'    — edition-first (program_item.edition is required); the work
 *                    is the edition's parent. Carries ordinal + notes, status
 *                    null (a concert programme has no learning/active state).
 *   - 'repertoire' — work-first (repertoire_item.work is required); the edition
 *                    is optional (an unpinned work renders the no-edition
 *                    placeholder). Carries status, ordinal null (season
 *                    repertoire has no concert position), notes '' (the type
 *                    has no notes prop).
 * Missing lookups degrade to '' rather than dropping the row: a member seeing a
 * work name with a blank composer is strictly better than a silently shorter
 * programme.
 */
const KNOWN_STATUSES = new Set<string>([
	'learning',
	'active',
	'retired',
	'dropped'
] satisfies RepertoireStatus[]);

/** All four schema statuses survive to the row (#91: an editor must be able to
 *  toggle a retired work back). Anything OUTSIDE the four is a data slip and
 *  becomes null — no badge, and the management select falls back to the schema
 *  default rather than seeding an option that does not exist. */
function narrowStatus(raw: string): RepertoireStatus | null {
	return KNOWN_STATUSES.has(raw) ? (raw as RepertoireStatus) : null;
}

export function buildWorkRows(eventWorks: EventWorks, sources: WorkRowSources): WorkRow[] {
	const { worksById, editionsById, copyCountByEditionId } = sources;

	if (eventWorks.source === 'program') {
		return eventWorks.items.map((item) => {
			const edition = editionsById.get(item.editionId);
			const work = edition?.workId ? worksById.get(edition.workId) : undefined;
			return {
				id: item.id,
				// #91 — provenance travels WITH the row: `id` here names a
				// program_item, so only the programme write layer may touch it.
				kind: 'program' as const,
				workId: edition?.workId ?? '',
				editionId: item.editionId,
				// item.name is the program_item's own formula (edition -> work), the
				// right fallback when the work entity itself isn't readable.
				workName: work?.name || item.name,
				composer: work?.composer ?? '',
				status: null,
				editionName: edition?.name ?? '',
				ordinal: item.ordinal,
				fileId: pickFileId(edition),
				externalLinks: safeExternalLinks(edition?.externalLinks ?? []),
				canBorrow: (copyCountByEditionId.get(item.editionId) ?? 0) > 0,
				notes: item.notes
			};
		});
	}

	return eventWorks.items.map((item) => {
		const work = worksById.get(item.workId);
		const edition = item.editionId === '' ? undefined : editionsById.get(item.editionId);
		return {
			id: item.id,
			// #91 — `id` here names a repertoire_item (a CHILD OF SEASON, shared by
			// every event that falls back to it), never a program_item.
			kind: 'repertoire' as const,
			workId: item.workId,
			editionId: item.editionId,
			workName: work?.name || item.name,
			composer: work?.composer ?? '',
			status: narrowStatus(item.status),
			editionName: edition?.name ?? '',
			ordinal: null,
			fileId: pickFileId(edition),
			externalLinks: safeExternalLinks(edition?.externalLinks ?? []),
			canBorrow: (copyCountByEditionId.get(item.editionId) ?? 0) > 0,
			notes: ''
		};
	});
}

/**
 * The page's single entry point: every agenda event's works, keyed by event id.
 *
 * Cost, for an agenda of N unique event ids:
 *   - THREE collective-wide lookups, regardless of N — works / editions /
 *     copies, the same bulk reads the library page makes;
 *   - ONE program_item read per unique event id (resolveEventWorksBatch fans
 *     these out concurrently). Unavoidable: Entu has no multi-parent entity
 *     query, so program_items can only be fetched per `_parent.reference`;
 *   - AT MOST ONE season repertoire read — only when some event actually falls
 *     back (a fully programmed agenda never touches it), and never more than
 *     once however many events fall back.
 * So ~N+4 requests, not a constant. An empty event list short-circuits with NO
 * fetch at all.
 */
export async function loadWorksByEventId(
	cfg: EntuCfg,
	eventIds: string[],
	seasonId: string | null,
	fetchImpl: typeof fetch = fetch,
	options: RepertoireReadOptions = {}
): Promise<Record<string, WorkRow[]>> {
	if (eventIds.length === 0) return {};

	const [works, editions, copies, worksByEvent] = await Promise.all([
		listWorks(cfg, fetchImpl),
		listAllEditions(cfg, fetchImpl),
		listAllCopies(cfg, fetchImpl),
		resolveEventWorksBatch(cfg, eventIds, seasonId, fetchImpl, options)
	]);

	const sources = collectSources(works, editions, copies);
	const out: Record<string, WorkRow[]> = {};
	for (const [eventId, eventWorks] of Object.entries(worksByEvent)) {
		out[eventId] = buildWorkRows(eventWorks, sources);
	}
	return out;
}

// (*MVOX:Josquin*)
// (*MVOX:Josquin* — review fix-forward: http(s)-only external links, honest
// read-cost docstring)
