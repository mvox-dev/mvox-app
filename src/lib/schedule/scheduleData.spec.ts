// #262 RED — the schedule_item data layer: read, bulk read, create, edit,
// remove. The type EXISTS on both dbs (#246 settle + seed): child of event
// (1 → 0..N), props `name` (string) + `datetime` (datetime), both required.
// Sort by `datetime` ascending, `name` tie-break — deliberately NO ordinal
// anywhere (adjudicated on #246). Rights/sharing program_item-identical:
// parent-event `_editor` writes, `_sharing: domain`.
//
// CONTRACT under test (defined HERE, implemented in GREEN):
//
//   src/lib/schedule/scheduleData.ts
//     export type ScheduleItem = { id: string; name: string; datetime: string };
//     export async function listScheduleItems(
//       cfg: EntuCfg, eventId: string, fetchImpl?: typeof fetch
//     ): Promise<ScheduleItem[]>;                       // sorted, full shape
//     export async function listScheduleItemsByEventId(
//       cfg: EntuCfg, eventIds: string[], fetchImpl?: typeof fetch
//     ): Promise<Record<string, ScheduleItem[]>>;      // the agenda's bulk read
//     export async function createScheduleItem(
//       cfg: EntuCfg,
//       input: { eventId: string; name: string; datetime: string },
//       fetchImpl?: typeof fetch
//     ): Promise<string>;                              // returns new entity id
//     export async function updateScheduleItemField(
//       cfg: EntuCfg, itemId: string,
//       field: 'name' | 'datetime', value: string,
//       fetchImpl?: typeof fetch
//     ): Promise<void>;                                // replaceEntityProperty
//     export async function removeScheduleItem(
//       cfg: EntuCfg, itemId: string, fetchImpl?: typeof fetch
//     ): Promise<void>;                                // DELETE entity/{id}
//
// Wire rules pinned below (all with a live precedent):
//   • read = `_type.string=schedule_item` — NEVER a raw type id (per-db ids
//     differ: polyphony 6a9ccea4…, crede 6a9cceab…); mirror listProgramItems
//     (repertoireData.ts:89-111).
//   • create = POST `entity` with `_type` as reference via resolveTypeId
//     (create bodies need refs as `reference`, never `string` — the pinned
//     wire shape), `_parent` reference, name string, datetime datetime, AND an
//     explicit `_sharing: domain` — MANDATORY (createProgramItem precedent,
//     repertoireActions.ts:188-205: parent events are not uniformly domain,
//     omitting it can land a public schedule_item whose domain-tier prop-defs
//     drop out of ordinary reads).
//   • edit = the replaceEntityProperty choreography (replaceProperty.ts): GET
//     existing id(s) FIRST → ONE POST pairing the first old `_id` with the new
//     value (Entu's native atomic overwrite); corrupted extras only are swept
//     after the POST — the normal ≤1-value path issues zero deletes.
//   • remove = DELETE `entity/{id}` (the ENTITY endpoint — property DELETEs
//     are for value ids only; conflating the two 404s and pollutes).
//   • NO ordinal: no read asks for it, no write sends it.
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/entu-config', () => ({ ENTU_API_BASE: 'https://api.entu-test.invalid/' }));

import {
	listScheduleItems,
	listScheduleItemsByEventId,
	createScheduleItem,
	updateScheduleItemField,
	removeScheduleItem,
	type ScheduleItem
} from './scheduleData';
import { resetTypeIdCache } from '$lib/seasons/entuSeasons';

const cfg = { db: 'polyphony', token: 'jwt' };

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), { status });
}

function urls(fetchImpl: ReturnType<typeof vi.fn>): string[] {
	return fetchImpl.mock.calls.map((c) => String(c[0]));
}

function methods(fetchImpl: ReturnType<typeof vi.fn>): Array<string> {
	return fetchImpl.mock.calls.map((c) => (c[1] as RequestInit | undefined)?.method ?? 'GET');
}

function scheduleEntity(id: string, name: string, iso: string) {
	return {
		_id: id,
		name: [{ _id: `val-${id}-name`, string: name }],
		datetime: [{ _id: `val-${id}-dt`, datetime: iso }]
	};
}

beforeEach(() => {
	resetTypeIdCache();
});

// ── read: one event ──────────────────────────────────────────────────────────

describe('listScheduleItems — wire shape', () => {
	it('queries by TYPE NAME with parent ref, name+datetime props, limit 500 — the listProgramItems shape', async () => {
		const fetchImpl = vi.fn(async (_input: RequestInfo | URL) => json({ entities: [] }));
		await listScheduleItems(cfg, 'ev1', fetchImpl as unknown as typeof fetch);
		expect(fetchImpl).toHaveBeenCalledTimes(1);
		const url = String(fetchImpl.mock.calls[0][0]);
		expect(url).toContain(
			'_type.string=schedule_item&_parent.reference=ev1&props=name,datetime&limit=500'
		);
		// NEVER a raw type id — per-db type-def ids differ (polyphony 6a9ccea4…,
		// crede 6a9cceab…); a baked id reads one db's schedule and 404s the other.
		expect(url).not.toContain('_type.reference');
		expect(url).not.toMatch(/6a9cce/);
		// NO ordinal — the #246 adjudication holds on the wire too.
		expect(url).not.toContain('ordinal');
	});

	it('throws on a non-2xx response (fail loud, no silent empty list)', async () => {
		const fetchImpl = vi.fn(async () => json({}, 403));
		await expect(
			listScheduleItems(cfg, 'ev1', fetchImpl as unknown as typeof fetch)
		).rejects.toThrow();
	});
});

describe('listScheduleItems — sort: datetime ascending, name tie-break', () => {
	it('returns the FULL row shape, sorted by datetime then name — never wire order', async () => {
		// Wire order is deliberately scrambled AND carries a datetime tie:
		// 'b-proov' and 'a-kogunemine' share 15:00Z — the tie-break must put
		// 'a-kogunemine' first alphabetically. No ordinal exists to sort by.
		const fetchImpl = vi.fn(async () =>
			json({
				entities: [
					scheduleEntity('si3', 'kontsert', '2026-09-01T16:00:00.000Z'),
					scheduleEntity('si2', 'b-proov', '2026-09-01T15:00:00.000Z'),
					scheduleEntity('si1', 'a-kogunemine', '2026-09-01T15:00:00.000Z')
				]
			})
		);
		const rows = await listScheduleItems(cfg, 'ev1', fetchImpl as unknown as typeof fetch);
		// Full-shape toEqual — partial assertions hide bugs.
		expect(rows).toEqual([
			{ id: 'si1', name: 'a-kogunemine', datetime: '2026-09-01T15:00:00.000Z' },
			{ id: 'si2', name: 'b-proov', datetime: '2026-09-01T15:00:00.000Z' },
			{ id: 'si3', name: 'kontsert', datetime: '2026-09-01T16:00:00.000Z' }
		] satisfies ScheduleItem[]);
	});
});

// ── read: bulk, for the agenda ───────────────────────────────────────────────

describe('listScheduleItemsByEventId — the agenda bulk read (mirror loadWorksByEventId)', () => {
	it('one GET per event id (the platform has no multi-parent query), assembled into a per-event record, each list sorted', async () => {
		const byParent: Record<string, unknown[]> = {
			up1: [
				scheduleEntity('s-b', 'kontsert', '2026-06-15T16:00:00.000Z'),
				scheduleEntity('s-a', 'kogunemine', '2026-06-15T06:30:00.000Z')
			],
			rec1: [scheduleEntity('s-c', 'proov', '2026-06-01T14:30:00.000Z')]
		};
		const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
			const url = String(input);
			const match = url.match(/_parent\.reference=([^&]+)/);
			return json({ entities: byParent[match?.[1] ?? ''] ?? [] });
		});
		const record = await listScheduleItemsByEventId(
			cfg,
			['up1', 'rec1', 'up-empty'],
			fetchImpl as unknown as typeof fetch
		);
		// Exactly one schedule GET per id — a per-row refetch storm fails here.
		const scheduleUrls = urls(fetchImpl).filter((u) => u.includes('_type.string=schedule_item'));
		expect(scheduleUrls).toHaveLength(3);
		expect(
			scheduleUrls.map((u) => u.match(/_parent\.reference=([^&]+)/)?.[1]).sort()
		).toEqual(['rec1', 'up-empty', 'up1']);
		expect(record).toEqual({
			up1: [
				{ id: 's-a', name: 'kogunemine', datetime: '2026-06-15T06:30:00.000Z' },
				{ id: 's-b', name: 'kontsert', datetime: '2026-06-15T16:00:00.000Z' }
			],
			rec1: [{ id: 's-c', name: 'proov', datetime: '2026-06-01T14:30:00.000Z' }],
			'up-empty': []
		});
	});

	it('empty id list → {} with ZERO fetches', async () => {
		const fetchImpl = vi.fn();
		const record = await listScheduleItemsByEventId(cfg, [], fetchImpl as unknown as typeof fetch);
		expect(record).toEqual({});
		expect(fetchImpl).not.toHaveBeenCalled();
	});
});

// ── create ───────────────────────────────────────────────────────────────────

function createWireStub() {
	const posted: Array<{ url: string; body: Array<Record<string, unknown>> }> = [];
	const stub = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = String(input);
		const method = init?.method ?? 'GET';
		if (url.includes('name.string=schedule_item')) {
			// resolveTypeId's lookup — the type-def id this db actually holds.
			return json({ entities: [{ _id: 'type-schedule-item' }] });
		}
		if (method === 'POST') {
			posted.push({ url, body: JSON.parse(String(init?.body)) as Array<Record<string, unknown>> });
			return json({ _id: 'si-new' });
		}
		return json({ entities: [] });
	});
	return { stub, posted };
}

describe('createScheduleItem — the FULL wire payload, _sharing included', () => {
	it('resolves the type id per db (resolveTypeId, never a baked id) and POSTs the exact five-prop body', async () => {
		const { stub, posted } = createWireStub();
		const id = await createScheduleItem(
			cfg,
			{ eventId: 'ev1', name: 'kogunemine', datetime: '2026-09-01T14:30:00.000Z' },
			stub as unknown as typeof fetch
		);
		expect(id).toBe('si-new');
		expect(posted).toHaveLength(1);
		// POST goes to the collection endpoint (`entity`), not entity/{id}.
		expect(posted[0].url).toMatch(/\/entity(\?|$)/);
		// Full-shape toEqual — the exact createProgramItem-family payload.
		expect(posted[0].body).toEqual([
			{ type: '_type', reference: 'type-schedule-item' },
			{ type: '_parent', reference: 'ev1' },
			{ type: 'name', string: 'kogunemine' },
			{ type: 'datetime', datetime: '2026-09-01T14:30:00.000Z' },
			{ type: '_sharing', string: 'domain' }
		]);
	});

	it('NEGATIVE twin — the explicit `_sharing: domain` prop is MANDATORY on the create body', async () => {
		// createProgramItem precedent (repertoireActions.ts:188-205): parent
		// events are NOT uniformly domain-shared — one live event is public — so
		// a create relying on create-time inherit can land a PUBLIC
		// schedule_item, and aggregate.js then drops its domain-tier prop-defs
		// from ordinary reads. A payload without `_sharing` must fail here.
		const { stub, posted } = createWireStub();
		await createScheduleItem(
			cfg,
			{ eventId: 'ev1', name: 'proov', datetime: '2026-09-01T15:00:00.000Z' },
			stub as unknown as typeof fetch
		);
		expect(posted[0].body).toContainEqual({ type: '_sharing', string: 'domain' });
	});

	it('never writes an ordinal — no prop of that name on any create body', async () => {
		const { stub, posted } = createWireStub();
		await createScheduleItem(
			cfg,
			{ eventId: 'ev1', name: 'kontsert', datetime: '2026-09-01T16:00:00.000Z' },
			stub as unknown as typeof fetch
		);
		expect(posted[0].body.map((p) => p.type)).not.toContain('ordinal');
	});

	it('throws on a non-2xx POST (fail loud)', async () => {
		const stub = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = String(input);
			if (url.includes('name.string=schedule_item'))
				return json({ entities: [{ _id: 'type-schedule-item' }] });
			if ((init?.method ?? 'GET') === 'POST') return json({ message: 'boom' }, 500);
			return json({ entities: [] });
		});
		await expect(
			createScheduleItem(
				cfg,
				{ eventId: 'ev1', name: 'x', datetime: '2026-09-01T16:00:00.000Z' },
				stub as unknown as typeof fetch
			)
		).rejects.toThrow();
	});
});

// ── edit: replaceEntityProperty choreography ─────────────────────────────────

function editWireStub(existingValueIds: string[]) {
	const stub = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = String(input);
		const method = init?.method ?? 'GET';
		if (url.includes('/property/') && method === 'DELETE') return json({ deleted: true });
		if (url.includes('/entity/si1') && method === 'POST') return json({});
		if (url.includes('/entity/si1')) {
			// The GET the choreography opens with — existing value ids to delete.
			const prop = url.match(/props=([^&]+)/)?.[1] ?? 'name';
			return json({
				entity: {
					_id: 'si1',
					[prop]: existingValueIds.map((vid) => ({ _id: vid }))
				}
			});
		}
		return json({ entities: [] });
	});
	return stub;
}

// #264 — the shared replaceEntityProperty helper went ATOMIC (the POST entry
// carries the first old value's `_id`; only corrupted EXTRA ids are swept,
// after the POST). This caller inherits that wire; the shapes below track it.
describe('updateScheduleItemField — atomic overwrite via replaceEntityProperty (#264)', () => {
	it("name edit with a corrupted phantom: POST body is exactly [{_id:'v-old', type:'name', string}], and ONLY the phantom is deleted, AFTER the POST", async () => {
		const stub = editWireStub(['v-old', 'v-phantom']);
		await updateScheduleItemField(cfg, 'si1', 'name', 'kutse', stub as unknown as typeof fetch);
		expect(methods(stub)).toEqual(['GET', 'POST', 'DELETE']);
		const postCall = stub.mock.calls[1];
		expect(JSON.parse(String((postCall[1] as RequestInit).body))).toEqual([
			{ _id: 'v-old', type: 'name', string: 'kutse' }
		]);
		const deleteUrls = urls(stub).slice(2);
		expect(deleteUrls.some((u) => u.includes('/property/v-phantom'))).toBe(true);
		expect(deleteUrls.some((u) => u.includes('/property/v-old'))).toBe(false);
	});

	it("datetime edit: the value rides the `datetime` slot ({_id, type:'datetime', datetime: iso}), never `string` — and the single old value needs NO delete", async () => {
		const stub = editWireStub(['v-dt-old']);
		await updateScheduleItemField(
			cfg,
			'si1',
			'datetime',
			'2026-09-01T15:00:00.000Z',
			stub as unknown as typeof fetch
		);
		expect(methods(stub)).toEqual(['GET', 'POST']);
		const postCall = stub.mock.calls[1];
		expect(JSON.parse(String((postCall[1] as RequestInit).body))).toEqual([
			{ _id: 'v-dt-old', type: 'datetime', datetime: '2026-09-01T15:00:00.000Z' }
		]);
	});
});

// ── remove ───────────────────────────────────────────────────────────────────

describe('removeScheduleItem — DELETE the ENTITY, not a property value', () => {
	it('sends exactly one DELETE to entity/{itemId}', async () => {
		const stub = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
			json({ deleted: true })
		);
		await removeScheduleItem(cfg, 'si1', stub as unknown as typeof fetch);
		expect(stub).toHaveBeenCalledTimes(1);
		const url = String(stub.mock.calls[0][0]);
		expect(url).toContain('/entity/si1');
		expect(url).not.toContain('/property/');
		expect((stub.mock.calls[0][1] as RequestInit).method).toBe('DELETE');
	});

	it('throws on a non-2xx response (fail loud, no silent "removed")', async () => {
		const stub = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => json({}, 403));
		await expect(
			removeScheduleItem(cfg, 'si1', stub as unknown as typeof fetch)
		).rejects.toThrow();
	});
});

// (*MVOX:Tallis* — #262 RED: schedule_item data layer)
