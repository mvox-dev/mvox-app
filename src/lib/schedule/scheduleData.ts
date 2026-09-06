import { entuFetch } from '$lib/entu/request';
import { replaceEntityProperty } from '$lib/entu/replaceProperty';
import { resolveTypeId, type EntuCfg } from '$lib/seasons/entuSeasons';
// The row shape + its ONE sort rule live in their own dependency-free module
// (see scheduleSort.ts's header) — re-exported here so every EXISTING
// `from '$lib/schedule/scheduleData'` import (this module's own spec, the
// event-detail page) is unaffected. AgendaList.svelte imports straight from
// scheduleSort.ts instead, to avoid dragging entuFetch's $env chain into its
// component-level test.
import { compareScheduleItems, type ScheduleItem } from './scheduleSort';
export { compareScheduleItems, type ScheduleItem };

// #262 GREEN — the schedule_item data layer: read, bulk read, create, edit,
// remove. Child of event (1 → 0..N); props `name` (string) + `datetime`
// (datetime), both required. Sort by `datetime` ascending, `name` tie-break —
// deliberately NO ordinal anywhere (adjudicated on #246). Rights/sharing
// program_item-identical: parent-event `_editor` writes, `_sharing: domain`.

type ScheduleItemRaw = {
	_id: string;
	name?: Array<{ string: string }>;
	datetime?: Array<{ datetime: string }>;
};

/**
 * Read one event's schedule items — `_type.string=schedule_item` (NEVER a raw
 * type id: per-db type-def ids differ), sorted `datetime` asc, `name`
 * tie-break. Mirrors listProgramItems (repertoireData.ts:89-111).
 */
export async function listScheduleItems(
	cfg: EntuCfg,
	eventId: string,
	fetchImpl: typeof fetch = fetch
): Promise<ScheduleItem[]> {
	const res = await entuFetch(
		cfg.db,
		`entity?_type.string=schedule_item&_parent.reference=${encodeURIComponent(eventId)}&props=name,datetime&limit=500`,
		cfg.token,
		{},
		fetchImpl
	);
	if (!res.ok) throw new Error(`listScheduleItems failed: ${res.status}`);
	const body = (await res.json()) as { entities?: ScheduleItemRaw[] };
	const rows: ScheduleItem[] = (body.entities ?? []).map((raw) => ({
		id: raw._id,
		name: raw.name?.[0]?.string ?? '',
		datetime: raw.datetime?.[0]?.datetime ?? ''
	}));
	return rows.sort(compareScheduleItems);
}

/**
 * The agenda's bulk read (mirror loadWorksByEventId): one GET per event id —
 * the platform has no multi-parent query — assembled into a per-event record,
 * each list sorted. Empty input short-circuits with NO fetch.
 */
export async function listScheduleItemsByEventId(
	cfg: EntuCfg,
	eventIds: string[],
	fetchImpl: typeof fetch = fetch
): Promise<Record<string, ScheduleItem[]>> {
	if (eventIds.length === 0) return {};
	const pairs = await Promise.all(
		eventIds.map(async (id) => [id, await listScheduleItems(cfg, id, fetchImpl)] as const)
	);
	const record: Record<string, ScheduleItem[]> = {};
	for (const [id, items] of pairs) record[id] = items;
	return record;
}

export interface CreateScheduleItemInput {
	eventId: string;
	name: string;
	datetime: string;
}

/**
 * Create a schedule_item under an event. Explicit `_sharing: domain` is
 * MANDATORY — createProgramItem precedent (repertoireActions.ts:188-205):
 * parent events are NOT uniformly domain-shared, so relying on create-time
 * inherit can land a public schedule_item whose domain-tier prop-defs then
 * drop out of ordinary reads.
 */
export async function createScheduleItem(
	cfg: EntuCfg,
	input: CreateScheduleItemInput,
	fetchImpl: typeof fetch = fetch
): Promise<string> {
	const typeId = await resolveTypeId(cfg, 'schedule_item', fetchImpl);
	const props = [
		{ type: '_type', reference: typeId },
		{ type: '_parent', reference: input.eventId },
		{ type: 'name', string: input.name },
		{ type: 'datetime', datetime: input.datetime },
		{ type: '_sharing', string: 'domain' }
	];
	const res = await entuFetch(
		cfg.db,
		'entity',
		cfg.token,
		{ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(props) },
		fetchImpl
	);
	if (!res.ok) throw new Error(`createScheduleItem failed: ${res.status}`);
	const body = (await res.json()) as { _id: string };
	return body._id;
}

/**
 * Edit one field via the replaceEntityProperty choreography (GET existing
 * value ids, POST exactly one new value, DELETE every pre-existing id).
 */
export async function updateScheduleItemField(
	cfg: EntuCfg,
	itemId: string,
	field: 'name' | 'datetime',
	value: string,
	fetchImpl: typeof fetch = fetch
): Promise<void> {
	const wireValue = field === 'name' ? { type: 'name', string: value } : { type: 'datetime', datetime: value };
	await replaceEntityProperty(cfg, itemId, wireValue, fetchImpl, 'updateScheduleItemField');
}

/** Remove a schedule_item entity ("Remove" — the two-step confirm idiom). */
export async function removeScheduleItem(
	cfg: EntuCfg,
	itemId: string,
	fetchImpl: typeof fetch = fetch
): Promise<void> {
	const res = await entuFetch(cfg.db, `entity/${itemId}`, cfg.token, { method: 'DELETE' }, fetchImpl);
	if (!res.ok) throw new Error(`removeScheduleItem failed: ${res.status}`);
}

// (*MVOX:Josquin* — #262 GREEN: schedule_item data layer)
