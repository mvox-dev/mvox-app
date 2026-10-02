// schedule_item data layer under an event: sorted by datetime, then name; no ordinal (#246).
import { entuFetch } from '$lib/entu/request';
import { replaceEntityProperty } from '$lib/entu/replaceProperty';
import { resolveTypeId, type EntuCfg } from '$lib/seasons/entuSeasons';
import { compareScheduleItems, type ScheduleItem } from './scheduleSort';
export { compareScheduleItems, type ScheduleItem };

type ScheduleItemRaw = {
	_id: string;
	name?: Array<{ string: string }>;
	datetime?: Array<{ datetime: string }>;
};

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
		{ type: 'datetime', datetime: input.datetime }
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

export async function removeScheduleItem(
	cfg: EntuCfg,
	itemId: string,
	fetchImpl: typeof fetch = fetch
): Promise<void> {
	const res = await entuFetch(cfg.db, `entity/${itemId}`, cfg.token, { method: 'DELETE' }, fetchImpl);
	if (!res.ok) throw new Error(`removeScheduleItem failed: ${res.status}`);
}

// (*MVOX:Josquin* — #262 GREEN: schedule_item data layer)
