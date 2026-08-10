import { entuFetch } from '$lib/entu/request';
import type { EntuCfg } from '$lib/seasons/entuSeasons';

// #90 TR.2 GREEN — the repertoire READ data layer. Read-only throughout: no
// entuFetch(..., { method: 'POST' | 'DELETE' }) anywhere in this module. Schema
// anchors (entu/research schema.ts):
//   repertoire_item — child of season; props: name (formula from work), work
//     (ref, required), edition (ref, optional pinned edition), status
//     ('learning | active | retired | dropped; default `active`').
//   program_item — child of event; props: name (formula via edition→work),
//     edition (ref, required), ordinal (number, required, concert position),
//     notes (text).
// Source hierarchy (#90): an event WITH program_items uses those (ordinal
// order); an event WITHOUT falls back to the season's repertoire_items,
// filtered to active/learning — retired/dropped never reach a member's view.

export interface RepertoireItem {
	id: string;
	workId: string;
	/** Pinned edition ref; '' = no pinned edition. */
	editionId: string;
	/** 'learning | active | retired | dropped'; defaults to 'active' (schema default). */
	status: string;
	name: string;
}

export interface ProgramItem {
	id: string;
	editionId: string;
	ordinal: number;
	/** Soloists, dedications; '' = absent. */
	notes: string;
	name: string;
}

export type EventWorks =
	| { source: 'program'; items: ProgramItem[] }
	| { source: 'repertoire'; items: RepertoireItem[] };

type RepertoireItemRaw = {
	_id: string;
	name?: Array<{ string: string }>;
	work?: Array<{ reference: string }>;
	edition?: Array<{ reference: string }>;
	status?: Array<{ string: string }>;
};

export async function listRepertoireItems(
	cfg: EntuCfg,
	seasonId: string,
	fetchImpl: typeof fetch = fetch
): Promise<RepertoireItem[]> {
	const res = await entuFetch(
		cfg.db,
		`entity?_type.string=repertoire_item&_parent.reference=${encodeURIComponent(seasonId)}&props=name,work,edition,status&limit=500`,
		cfg.token,
		{},
		fetchImpl
	);
	if (!res.ok) throw new Error(`listRepertoireItems failed: ${res.status}`);
	const body = (await res.json()) as { entities?: RepertoireItemRaw[] };
	const rows: RepertoireItem[] = [];
	for (const raw of body.entities ?? []) {
		const workId = raw.work?.[0]?.reference;
		// A repertoire_item with no readable work reference is broken data — drop
		// it rather than fabricating workId '' (which would silently point every
		// caller resolving work details at nothing).
		if (!workId) continue;
		rows.push({
			id: raw._id,
			workId,
			editionId: raw.edition?.[0]?.reference ?? '',
			status: raw.status?.[0]?.string ?? 'active',
			name: raw.name?.[0]?.string ?? ''
		});
	}
	return rows;
}

type ProgramItemRaw = {
	_id: string;
	name?: Array<{ string: string }>;
	edition?: Array<{ reference: string }>;
	ordinal?: Array<{ number: number }>;
	notes?: Array<{ string: string }>;
};

export async function listProgramItems(
	cfg: EntuCfg,
	eventId: string,
	fetchImpl: typeof fetch = fetch
): Promise<ProgramItem[]> {
	const res = await entuFetch(
		cfg.db,
		`entity?_type.string=program_item&_parent.reference=${encodeURIComponent(eventId)}&props=name,edition,ordinal,notes&limit=500`,
		cfg.token,
		{},
		fetchImpl
	);
	if (!res.ok) throw new Error(`listProgramItems failed: ${res.status}`);
	const body = (await res.json()) as { entities?: ProgramItemRaw[] };
	const rows: ProgramItem[] = (body.entities ?? []).map((raw) => ({
		id: raw._id,
		editionId: raw.edition?.[0]?.reference ?? '',
		ordinal: raw.ordinal?.[0]?.number ?? 0,
		notes: raw.notes?.[0]?.string ?? '',
		name: raw.name?.[0]?.string ?? ''
	}));
	return rows.sort((a, b) => a.ordinal - b.ordinal);
}

const ACTIVE_STATUSES = new Set(['active', 'learning']);

/**
 * #91 TR.3 — read mode.
 *
 * `includeInactive: true` keeps retired/dropped repertoire_items in the
 * fallback. It exists because the member-facing filter made the status toggle
 * ONE-WAY: the instant an editor set a work to retired the row vanished from
 * the only surface carrying the toggle, and `pickableWorks` deliberately
 * refuses to re-offer a work that already HAS a repertoire_item — so the work
 * became permanently unmanageable. A rights-holder therefore reads the
 * UNFILTERED repertoire; every other reader keeps the AC-8 filter.
 */
export interface RepertoireReadOptions {
	/** Keep retired/dropped repertoire_items in the fallback (management read). */
	includeInactive?: boolean;
}

/**
 * The source hierarchy (#90): an event WITH program_items uses those
 * (concert-ordinal order) and never touches the season's repertoire — a
 * programmed concert must not silently gain unrelated season rep. An event
 * WITHOUT program_items falls back to the CURRENT season's repertoire_items,
 * filtered to active/learning (retired/dropped never reach a member, AC-8)
 * unless `options.includeInactive` says otherwise (see RepertoireReadOptions).
 * `seasonId === null` (no current season) short-circuits the fallback to an
 * empty repertoire WITHOUT a second fetch — there is nothing to query.
 */
export async function resolveEventWorks(
	cfg: EntuCfg,
	eventId: string,
	seasonId: string | null,
	fetchImpl: typeof fetch = fetch,
	options: RepertoireReadOptions = {}
): Promise<EventWorks> {
	const byEvent = await resolveEventWorksBatch(cfg, [eventId], seasonId, fetchImpl, options);
	return byEvent[eventId];
}

/**
 * The whole agenda's worth of works in ONE pass — what the page actually calls
 * (the agenda renders every event at once, so the single-event resolver above
 * would re-read the SAME season repertoire once per unprogrammed event: an N+1
 * against a list that is identical for all of them).
 *
 * Same hierarchy as resolveEventWorks, and the same two economies:
 *   - the season repertoire is read AT MOST ONCE, and only if at least one
 *     event actually falls back to it (a fully programmed agenda never touches
 *     it — same rule as the single-event path: a programmed event must not
 *     silently gain unrelated season rep);
 *   - `seasonId === null` short-circuits the fallback with NO fetch.
 * Fails loud as a whole: one rejected program_item read rejects the batch
 * rather than silently showing some events as work-free.
 */
export async function resolveEventWorksBatch(
	cfg: EntuCfg,
	eventIds: string[],
	seasonId: string | null,
	fetchImpl: typeof fetch = fetch,
	options: RepertoireReadOptions = {}
): Promise<Record<string, EventWorks>> {
	const uniqueIds = [...new Set(eventIds)];
	const programsPerEvent = await Promise.all(
		uniqueIds.map(async (id) => [id, await listProgramItems(cfg, id, fetchImpl)] as const)
	);

	const needsFallback = programsPerEvent.some(([, items]) => items.length === 0);
	const all: RepertoireItem[] =
		needsFallback && seasonId !== null ? await listRepertoireItems(cfg, seasonId, fetchImpl) : [];
	const fallback: RepertoireItem[] = options.includeInactive
		? all
		: all.filter((item) => ACTIVE_STATUSES.has(item.status));

	const byEvent: Record<string, EventWorks> = {};
	for (const [id, items] of programsPerEvent) {
		byEvent[id] =
			items.length > 0 ? { source: 'program', items } : { source: 'repertoire', items: fallback };
	}
	return byEvent;
}

// (*MVOX:Josquin* — GREEN implementation)
