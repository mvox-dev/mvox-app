// Repertoire reads: an event's program_items, else its season's repertoire_items.
import { entuFetch, type EntuFetchOptions } from '$lib/entu/request';
import type { EntuCfg } from '$lib/entu/cfg';

export interface RepertoireItem {
	id: string;
	workId: string;
	editionId: string;
	status: string;
	name: string;
}

export interface ProgramItem {
	id: string;
	editionId: string;
	ordinal: number;
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
	fetchImpl: typeof fetch = fetch,
	opts: EntuFetchOptions = {}
): Promise<RepertoireItem[]> {
	const res = await entuFetch(
		cfg.db,
		`entity?_type.string=repertoire_item&_parent.reference=${encodeURIComponent(seasonId)}&props=name,work,edition,status&limit=500`,
		cfg.token,
		{},
		fetchImpl,
		opts
	);
	if (!res.ok) throw new Error(`listRepertoireItems failed: ${res.status}`);
	const body = (await res.json()) as { entities?: RepertoireItemRaw[] };
	const rows: RepertoireItem[] = [];
	for (const raw of body.entities ?? []) {
		const workId = raw.work?.[0]?.reference;
		// No readable work reference is broken data: drop it, never fake workId ''.
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
	fetchImpl: typeof fetch = fetch,
	opts: EntuFetchOptions = {}
): Promise<ProgramItem[]> {
	const res = await entuFetch(
		cfg.db,
		`entity?_type.string=program_item&_parent.reference=${encodeURIComponent(eventId)}&props=name,edition,ordinal,notes&limit=500`,
		cfg.token,
		{},
		fetchImpl,
		opts
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

// includeInactive is for rights-holders: hiding retired works there would make the status
// toggle one-way, since a work with a repertoire_item is never offered again.
export interface RepertoireReadOptions extends EntuFetchOptions {
	includeInactive?: boolean;
}

// A programmed event never falls back to season repertoire; seasonId null skips the read.
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

// Reads the season repertoire at most once for the whole agenda; one failed read rejects all.
export async function resolveEventWorksBatch(
	cfg: EntuCfg,
	eventIds: string[],
	seasonId: string | null,
	fetchImpl: typeof fetch = fetch,
	options: RepertoireReadOptions = {}
): Promise<Record<string, EventWorks>> {
	const uniqueIds = [...new Set(eventIds)];
	const programsPerEvent = await Promise.all(
		uniqueIds.map(async (id) => [id, await listProgramItems(cfg, id, fetchImpl, options)] as const)
	);

	const needsFallback = programsPerEvent.some(([, items]) => items.length === 0);
	const all: RepertoireItem[] =
		needsFallback && seasonId !== null
			? await listRepertoireItems(cfg, seasonId, fetchImpl, options)
			: [];
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
