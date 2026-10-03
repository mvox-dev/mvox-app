// schedule_item data layer: read, bulk read, create, edit, remove; no ordinal (#246).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { json, testCfg } from '$lib/testing/entuFetchKit';

vi.mock('$lib/entu-config', async () =>
	(await import('$lib/testing/routeMocks')).entuConfigModule()
);

import {
	listScheduleItems,
	listScheduleItemsByEventId,
	createScheduleItem,
	updateScheduleItemField,
	removeScheduleItem,
	type ScheduleItem
} from './scheduleData';
import { resetTypeIdCache } from '$lib/seasons/entuSeasons';

const cfg = testCfg('sampledb');

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

describe('listScheduleItems — wire shape', () => {
	it('queries by TYPE NAME with parent ref, name+datetime props, limit 500 — the listProgramItems shape', async () => {
		const fetchImpl = vi.fn(async (_input: RequestInfo | URL) => json({ entities: [] }));
		await listScheduleItems(cfg, 'ev1', fetchImpl as unknown as typeof fetch);
		expect(fetchImpl).toHaveBeenCalledTimes(1);
		const url = String(fetchImpl.mock.calls[0][0]);
		expect(url).toContain(
			'_type.string=schedule_item&_parent.reference=ev1&props=name,datetime&limit=500'
		);
		expect(url).not.toContain('_type.reference');
		expect(url).not.toMatch(/6a9cce/);
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
		expect(rows).toEqual([
			{ id: 'si1', name: 'a-kogunemine', datetime: '2026-09-01T15:00:00.000Z' },
			{ id: 'si2', name: 'b-proov', datetime: '2026-09-01T15:00:00.000Z' },
			{ id: 'si3', name: 'kontsert', datetime: '2026-09-01T16:00:00.000Z' }
		] satisfies ScheduleItem[]);
	});
});

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

function createWireStub() {
	const posted: Array<{ url: string; body: Array<Record<string, unknown>> }> = [];
	const stub = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = String(input);
		const method = init?.method ?? 'GET';
		if (url.includes('name.string=schedule_item')) {
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

describe('createScheduleItem — the FULL wire payload, no rights fields', () => {
	it('resolves the type id per db (resolveTypeId, never a baked id) and POSTs the exact four-prop body', async () => {
		const { stub, posted } = createWireStub();
		const id = await createScheduleItem(
			cfg,
			{ eventId: 'ev1', name: 'kogunemine', datetime: '2026-09-01T14:30:00.000Z' },
			stub as unknown as typeof fetch
		);
		expect(id).toBe('si-new');
		expect(posted).toHaveLength(1);
		expect(posted[0].url).toMatch(/\/entity(\?|$)/);
		expect(posted[0].body).toEqual([
			{ type: '_type', reference: 'type-schedule-item' },
			{ type: '_parent', reference: 'ev1' },
			{ type: 'name', string: 'kogunemine' },
			{ type: 'datetime', datetime: '2026-09-01T14:30:00.000Z' }
		]);
	});

	it('NEGATIVE twin — the create body carries no `_sharing` and no `_inheritrights` (#699)', async () => {
		const { stub, posted } = createWireStub();
		await createScheduleItem(
			cfg,
			{ eventId: 'ev1', name: 'proov', datetime: '2026-09-01T15:00:00.000Z' },
			stub as unknown as typeof fetch
		);
		expect(
			posted[0].body.filter((p) => p.type === '_sharing' || p.type === '_inheritrights')
		).toEqual([]);
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

function editWireStub(existingValueIds: string[]) {
	const stub = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = String(input);
		const method = init?.method ?? 'GET';
		if (url.includes('/property/') && method === 'DELETE') return json({ deleted: true });
		if (url.includes('/entity/si1') && method === 'POST') return json({});
		if (url.includes('/entity/si1')) {
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
