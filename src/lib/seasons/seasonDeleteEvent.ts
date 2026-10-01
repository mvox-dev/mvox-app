// Event delete: an event takes its own attendance and program_item children with it.
import { entuFetch } from '$lib/entu/request';
import { CascadePartialError, EntityDeleteForbiddenError } from './deleteErrors';
import type { EntuCfg } from './entuSeasons';

export const CHILD_READ_LIMIT = 500;

/** Entu's DELETE strips the `_parent` link from children instead of removing them,
 *  so these would linger unreachable. rsvp is left alone: it belongs to its author. */
const EVENT_CHILD_TYPES = ['attendance', 'program_item'] as const;

/** Refuses when `count` exceeds the capped read: a partial work list would orphan the rest. */
export async function readChildren<T>(
	cfg: EntuCfg,
	parentId: string,
	childType: string,
	props: string,
	op: string,
	fetchImpl: typeof fetch = fetch
): Promise<T[]> {
	const res = await entuFetch(
		cfg.db,
		`entity?_type.string=${childType}&_parent.reference=${encodeURIComponent(parentId)}&props=${props}&limit=${CHILD_READ_LIMIT}`,
		cfg.token,
		{},
		fetchImpl
	);
	if (!res.ok) throw new Error(`${op} ${childType} lookup failed: ${res.status}`);
	const body = (await res.json()) as { count?: number; entities?: T[] };
	const rows = body.entities ?? [];
	const total = body.count ?? rows.length;
	if (total > rows.length) {
		throw new Error(
			`${op}: ${parentId} has ${total} ${childType} children, more than the ${CHILD_READ_LIMIT}-row cascade read can carry — nothing was deleted`
		);
	}
	return rows;
}

export async function listChildIds(
	cfg: EntuCfg,
	parentId: string,
	childType: string,
	op: string,
	fetchImpl: typeof fetch = fetch
): Promise<string[]> {
	const rows = await readChildren<{ _id?: string }>(cfg, parentId, childType, '_id', op, fetchImpl);
	return rows.flatMap((e) => (e._id ? [e._id] : []));
}

/** A 403 gets its own error: an editor without `_owner` is refused, and that is no "try again". */
export async function deleteEntity(
	cfg: EntuCfg,
	entityId: string,
	op: string,
	fetchImpl: typeof fetch = fetch
): Promise<void> {
	const res = await entuFetch(cfg.db, `entity/${entityId}`, cfg.token, { method: 'DELETE' }, fetchImpl);
	if (res.status === 403) throw new EntityDeleteForbiddenError(entityId);
	if (!res.ok) throw new Error(`${op} failed: ${res.status}`);
}

/** Its own read of the server's `count`: the panel's list may be minutes old,
 *  and the confirm must not promise a number the write never checked. */
export async function countSeriesOccurrences(
	cfg: EntuCfg,
	seriesId: string,
	fetchImpl: typeof fetch = fetch
): Promise<number> {
	const res = await entuFetch(
		cfg.db,
		`entity?_type.string=event&_parent.reference=${encodeURIComponent(seriesId)}&props=_id&limit=1`,
		cfg.token,
		{},
		fetchImpl
	);
	if (!res.ok) throw new Error(`countSeriesOccurrences failed: ${res.status}`);
	const body = (await res.json()) as { count?: number; entities?: unknown[] };
	return body.count ?? body.entities?.length ?? 0;
}

/** Children first, event last: a failure part-way leaves a still-linked remainder.
 *  Every work list is read before the first delete, and deletes run serially. */
export async function deleteEvent(
	cfg: EntuCfg,
	eventId: string,
	fetchImpl: typeof fetch = fetch
): Promise<void> {
	const childIds: string[] = [];
	for (const childType of EVENT_CHILD_TYPES) {
		childIds.push(...(await listChildIds(cfg, eventId, childType, 'deleteEvent', fetchImpl)));
	}

	let deleted = 0;
	for (const childId of childIds) {
		try {
			await deleteEntity(cfg, childId, 'deleteEvent child', fetchImpl);
		} catch (failure) {
			throw new CascadePartialError('event', eventId, deleted, childIds.length, failure);
		}
		deleted += 1;
	}

	await deleteEntity(cfg, eventId, 'deleteEvent', fetchImpl);
}
