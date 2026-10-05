// repertoire_item and program_item creates, atomic updates, and deletes.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetTypeIdCache, type EntuCfg } from '$lib/seasons/entuSeasons';
import type { Work } from '$lib/library/libraryData';
import type { RepertoireItem } from './repertoireData';
import {
	createRepertoireItem,
	updateRepertoireStatus,
	pinEdition,
	deleteRepertoireItem,
	createProgramItem,
	updateProgramItemOrdinal,
	deleteProgramItem,
	manageRightsFrom,
	resolveManageRights,
	pickableWorks,
	createRepertoireWriteQueue,
	planProgramMove,
	reorderProgramItems,
	type RepertoireStatus,
	type ManageRightsState
} from './repertoireActions';
import { deferred, json, testCfg, type Call } from '$lib/testing/entuFetchKit';

const cfg = testCfg('testdb');

beforeEach(() => {
	resetTypeIdCache();
});

describe('createRepertoireItem', () => {
	function makeFetchMock(resolvedTypeId = 'repertoire-item-type-id') {
		return vi.fn().mockImplementation((url: string) => {
			if (url.includes('_type.string=entity')) {
				return Promise.resolve(json({ entities: [{ _id: resolvedTypeId }] }));
			}
			return Promise.resolve(json({ _id: 'new-rep-item-1' }));
		});
	}

	function createCallBody(fetchImpl: ReturnType<typeof makeFetchMock>) {
		const call = (fetchImpl.mock.calls as Array<[string, RequestInit]>).find(
			([url]) => !url.includes('_type.string=entity')
		)!;
		return JSON.parse(String(call[1].body)) as Array<{
			type: string;
			reference?: string;
			string?: string;
			number?: number;
		}>;
	}

	it('POST body FULL SHAPE: _type ref + _parent=season + work ref + status=active — and nothing else (NO explicit _sharing, #133: inherited from the domain-tier season parent)', async () => {
		const fetchImpl = makeFetchMock('rep-type-42');
		await createRepertoireItem(cfg, { seasonId: 'season-s', workId: 'work-w', status: 'active' }, fetchImpl);
		const body = createCallBody(fetchImpl);

		const sorted = [...body].sort((a, b) => a.type.localeCompare(b.type));
		expect(sorted).toEqual(
			[
				{ type: '_type', reference: 'rep-type-42' },
				{ type: '_parent', reference: 'season-s' },
				{ type: 'work', reference: 'work-w' },
				{ type: 'status', string: 'active' }
			].sort((a, b) => a.type.localeCompare(b.type))
		);
	});

	it("status omitted → defaults to 'active' (schema default; #91: 'Creates a repertoire_item … with status active')", async () => {
		const fetchImpl = makeFetchMock();
		await createRepertoireItem(cfg, { seasonId: 'season-s', workId: 'work-w' }, fetchImpl);
		const body = createCallBody(fetchImpl);
		expect(body).toEqual(expect.arrayContaining([{ type: 'status', string: 'active' }]));
	});

	it('resolves the repertoire_item type id and sends _type as a REFERENCE, never a string (pinned wire-shape)', async () => {
		const fetchImpl = makeFetchMock('rep-type-42');
		await createRepertoireItem(cfg, { seasonId: 'season-s', workId: 'work-w' }, fetchImpl);
		const typeResolutionUrl = String(fetchImpl.mock.calls[0][0]);
		expect(typeResolutionUrl).toContain('_type.string=entity');
		expect(typeResolutionUrl).toContain('name.string=repertoire_item');
		const body = createCallBody(fetchImpl);
		const typeProp = body.find((p) => p.type === '_type')!;
		expect(typeProp.reference).toBe('rep-type-42');
		expect(typeProp.string).toBeUndefined();
	});

	it('POST body carries NO explicit _sharing (#133: inherited from the domain-tier season parent — never resent)', async () => {
		const fetchImpl = makeFetchMock();
		await createRepertoireItem(cfg, { seasonId: 'season-s', workId: 'work-w' }, fetchImpl);
		const body = createCallBody(fetchImpl);
		expect(body.map((p) => p.type)).not.toContain('_sharing');
	});

	it('returns the created repertoire_item _id', async () => {
		const fetchImpl = makeFetchMock();
		const id = await createRepertoireItem(cfg, { seasonId: 'season-s', workId: 'work-w' }, fetchImpl);
		expect(id).toBe('new-rep-item-1');
	});

	it('throws on a non-2xx create response (status surfaced) — fail loudly, no silent fallback', async () => {
		const fetchImpl = vi.fn().mockImplementation((url: string) => {
			if (url.includes('_type.string=entity')) {
				return Promise.resolve(json({ entities: [{ _id: 'type-id' }] }));
			}
			return Promise.resolve(json({}, 403));
		});
		await expect(
			createRepertoireItem(cfg, { seasonId: 'season-s', workId: 'work-w' }, fetchImpl)
		).rejects.toThrow(/403/);
	});
});

describe('updateRepertoireStatus', () => {

	function makeMockFetch(statusValueIds: string[] = ['sv-1']) {
		const calls: Call[] = [];
		const fetchImpl = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
			const method = init?.method ?? 'GET';
			calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
			if (method === 'DELETE') return Promise.resolve(json({}));
			if (method === 'POST') return Promise.resolve(json({}));
			return Promise.resolve(
				json({
					entity: {
						_id: 'rep-item-1',
						status: statusValueIds.map((id) => ({ _id: id, string: 'active' }))
					}
				})
			);
		});
		return { fetchImpl, calls };
	}

	it.each(['learning', 'active', 'retired', 'dropped'] as const)(
		"status '%s' → POST body is exactly [{ _id: 'sv-1', type: 'status', string: <that status> }] — the old id rides the overwrite (#264)",
		async (status: RepertoireStatus) => {
			const { fetchImpl, calls } = makeMockFetch();
			await updateRepertoireStatus(cfg, 'rep-item-1', status, fetchImpl);
			const postBodies = calls
				.filter((c) => c.method === 'POST')
				.flatMap((c) => c.body as Array<{ type: string; string?: string }>);
			expect(postBodies).toEqual([{ _id: 'sv-1', type: 'status', string: status }]);
		}
	);

	it('order (#264): GET current entity → ONE atomic POST — no DELETE round-trip remains', async () => {
		const { fetchImpl, calls } = makeMockFetch();
		await updateRepertoireStatus(cfg, 'rep-item-1', 'retired', fetchImpl);
		expect(calls[0].method).toBe('GET');
		expect(calls[0].url).toContain('rep-item-1');
		expect(calls[0].url).toContain('status');
		expect(calls.map((c) => c.method)).toEqual(['GET', 'POST']);
	});

	it('a FAILED POST leaves the old value intact — the overwrite never committed, no DELETE is issued at all (an absent status would read back as the schema default, a value the editor never chose)', async () => {
		const calls: Call[] = [];
		const fetchImpl = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
			const method = init?.method ?? 'GET';
			calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
			if (method === 'POST') return Promise.resolve(json({}, 500));
			if (method === 'DELETE') return Promise.resolve(json({}));
			return Promise.resolve(json({ entity: { _id: 'rep-item-1', status: [{ _id: 'sv-1' }] } }));
		});
		await expect(updateRepertoireStatus(cfg, 'rep-item-1', 'retired', fetchImpl)).rejects.toThrow(
			/500/
		);
		expect(calls.filter((c) => c.method === 'DELETE')).toHaveLength(0);
		expect(calls.filter((c) => c.method === 'POST')[0]?.body).toEqual([
			{ _id: 'sv-1', type: 'status', string: 'retired' }
		]);
	});

	it('CORRUPTED multi-value state: the overwrite pairs the FIRST old id; ONLY the extra is deleted, at /property/{id}, strictly AFTER the POST, so the item never sits without a status', async () => {
		const { fetchImpl, calls } = makeMockFetch(['sv-a', 'sv-b']);
		await updateRepertoireStatus(cfg, 'rep-item-1', 'learning', fetchImpl);
		const postCalls = calls.filter((c) => c.method === 'POST');
		expect(postCalls).toHaveLength(1);
		expect(postCalls[0].body).toEqual([{ _id: 'sv-a', type: 'status', string: 'learning' }]);
		const deleteUrls = calls.filter((c) => c.method === 'DELETE').map((c) => c.url);
		expect(deleteUrls).toHaveLength(1);
		expect(deleteUrls[0]).toContain('property');
		expect(deleteUrls[0]).toContain('sv-b');
		expect(deleteUrls.some((u) => /entity\/sv-/.test(u))).toBe(false);
		expect(calls.findIndex((c) => c.method === 'DELETE')).toBeGreaterThan(
			calls.findIndex((c) => c.method === 'POST')
		);
	});

	it('no existing status value (schema-default entity) → NO DELETE calls, straight to POST', async () => {
		const { fetchImpl, calls } = makeMockFetch([]);
		await updateRepertoireStatus(cfg, 'rep-item-1', 'learning', fetchImpl);
		expect(calls.filter((c) => c.method === 'DELETE')).toHaveLength(0);
		expect(calls.filter((c) => c.method === 'POST')).toHaveLength(1);
	});

	it('throws on a non-2xx GET response', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(json({}, 403));
		await expect(updateRepertoireStatus(cfg, 'rep-item-1', 'active', fetchImpl)).rejects.toThrow(/403/);
	});
});

describe('pinEdition', () => {

	function makeMockFetch(editionValueIds: string[]) {
		const calls: Call[] = [];
		const fetchImpl = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
			const method = init?.method ?? 'GET';
			calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
			if (method === 'DELETE') return Promise.resolve(json({}));
			if (method === 'POST') return Promise.resolve(json({}));
			return Promise.resolve(
				json({
					entity: {
						_id: 'rep-item-1',
						edition: editionValueIds.map((id) => ({ _id: id, reference: 'edition-old' }))
					}
				})
			);
		});
		return { fetchImpl, calls };
	}

	it("POST body is exactly [{ type: 'edition', reference: <editionId> }] — a REFERENCE, never a string", async () => {
		const { fetchImpl, calls } = makeMockFetch([]);
		await pinEdition(cfg, 'rep-item-1', 'edition-new', fetchImpl);
		const postBodies = calls
			.filter((c) => c.method === 'POST')
			.flatMap((c) => c.body as Array<{ type: string; reference?: string; string?: string }>);
		expect(postBodies).toEqual([{ type: 'edition', reference: 'edition-new' }]);
	});

	it('item with NO pinned edition → no DELETE calls, straight POST (nothing to clear)', async () => {
		const { fetchImpl, calls } = makeMockFetch([]);
		await pinEdition(cfg, 'rep-item-1', 'edition-new', fetchImpl);
		expect(calls.filter((c) => c.method === 'DELETE')).toHaveLength(0);
		expect(calls.filter((c) => c.method === 'POST')).toHaveLength(1);
	});

	it('re-pin (#264): ONE atomic POST — body exactly [{ _id: <old value id>, type: "edition", reference: <new> }], and NO DELETE round-trip remains', async () => {
		const { fetchImpl, calls } = makeMockFetch(['ev-old']);
		await pinEdition(cfg, 'rep-item-1', 'edition-new', fetchImpl);
		const postCalls = calls.filter((c) => c.method === 'POST');
		expect(postCalls).toHaveLength(1);
		expect(postCalls[0].body).toEqual([{ _id: 'ev-old', type: 'edition', reference: 'edition-new' }]);
		expect(calls.filter((c) => c.method === 'DELETE')).toHaveLength(0);
		expect(calls.map((c) => c.method)).toEqual(['GET', 'POST']);
	});

	it('throws on a non-2xx GET response', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(json({}, 403));
		await expect(pinEdition(cfg, 'rep-item-1', 'edition-new', fetchImpl)).rejects.toThrow(/403/);
	});
});

describe('deleteRepertoireItem', () => {
	it('sends DELETE {db}/entity/{itemId} — entity endpoint, not property', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(json({}));
		await deleteRepertoireItem(cfg, 'rep-item-xyz', fetchImpl);
		expect(fetchImpl).toHaveBeenCalledTimes(1);
		const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
		expect(url).toContain('entity');
		expect(url).toContain('rep-item-xyz');
		expect(url).not.toContain('property');
		expect(init.method).toBe('DELETE');
	});

	it('throws on a non-2xx response (status surfaced)', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(json({}, 403));
		await expect(deleteRepertoireItem(cfg, 'rep-item-xyz', fetchImpl)).rejects.toThrow(/403/);
	});
});

describe('createProgramItem', () => {
	function makeFetchMock(resolvedTypeId = 'program-item-type-id') {
		return vi.fn().mockImplementation((url: string) => {
			if (url.includes('_type.string=entity')) {
				return Promise.resolve(json({ entities: [{ _id: resolvedTypeId }] }));
			}
			return Promise.resolve(json({ _id: 'new-prog-item-1' }));
		});
	}

	function createCallBody(fetchImpl: ReturnType<typeof makeFetchMock>) {
		const call = (fetchImpl.mock.calls as Array<[string, RequestInit]>).find(
			([url]) => !url.includes('_type.string=entity')
		)!;
		return JSON.parse(String(call[1].body)) as Array<{
			type: string;
			reference?: string;
			string?: string;
			number?: number;
		}>;
	}

	it('POST body FULL SHAPE: _type ref + _parent=event + edition ref + ordinal NUMBER — and nothing else (no rights fields, #699)', async () => {
		const fetchImpl = makeFetchMock('prog-type-42');
		await createProgramItem(cfg, { eventId: 'event-e', editionId: 'edition-x', ordinal: 3 }, fetchImpl);
		const body = createCallBody(fetchImpl);

		const sorted = [...body].sort((a, b) => a.type.localeCompare(b.type));
		expect(sorted).toEqual(
			[
				{ type: '_type', reference: 'prog-type-42' },
				{ type: '_parent', reference: 'event-e' },
				{ type: 'edition', reference: 'edition-x' },
				{ type: 'ordinal', number: 3 }
			].sort((a, b) => a.type.localeCompare(b.type))
		);
	});

	it('resolves the program_item type id and sends _type as a REFERENCE, never a string', async () => {
		const fetchImpl = makeFetchMock('prog-type-42');
		await createProgramItem(cfg, { eventId: 'event-e', editionId: 'edition-x', ordinal: 1 }, fetchImpl);
		const typeResolutionUrl = String(fetchImpl.mock.calls[0][0]);
		expect(typeResolutionUrl).toContain('_type.string=entity');
		expect(typeResolutionUrl).toContain('name.string=program_item');
		const body = createCallBody(fetchImpl);
		const typeProp = body.find((p) => p.type === '_type')!;
		expect(typeProp.reference).toBe('prog-type-42');
		expect(typeProp.string).toBeUndefined();
	});

	it("ordinal is sent as `{ number: n }` — never `{ string: '3' }` (schema: ordinal is a NUMBER prop)", async () => {
		const fetchImpl = makeFetchMock();
		await createProgramItem(cfg, { eventId: 'event-e', editionId: 'edition-x', ordinal: 7 }, fetchImpl);
		const body = createCallBody(fetchImpl);
		const ordinalProp = body.find((p) => p.type === 'ordinal')!;
		expect(ordinalProp.number).toBe(7);
		expect(ordinalProp.string).toBeUndefined();
	});

	it('ordinal 0 IS sent (opening piece — a falsy-drop would create an unordered program_item)', async () => {
		const fetchImpl = makeFetchMock();
		await createProgramItem(cfg, { eventId: 'event-e', editionId: 'edition-x', ordinal: 0 }, fetchImpl);
		const body = createCallBody(fetchImpl);
		expect(body).toEqual(expect.arrayContaining([{ type: 'ordinal', number: 0 }]));
	});

	it('returns the created program_item _id', async () => {
		const fetchImpl = makeFetchMock();
		const id = await createProgramItem(
			cfg,
			{ eventId: 'event-e', editionId: 'edition-x', ordinal: 1 },
			fetchImpl
		);
		expect(id).toBe('new-prog-item-1');
	});

	it('throws on a non-2xx create response (status surfaced)', async () => {
		const fetchImpl = vi.fn().mockImplementation((url: string) => {
			if (url.includes('_type.string=entity')) {
				return Promise.resolve(json({ entities: [{ _id: 'type-id' }] }));
			}
			return Promise.resolve(json({}, 403));
		});
		await expect(
			createProgramItem(cfg, { eventId: 'event-e', editionId: 'edition-x', ordinal: 1 }, fetchImpl)
		).rejects.toThrow(/403/);
	});
});

describe('updateProgramItemOrdinal', () => {

	function makeMockFetch(ordinalValueIds: string[] = ['ov-1']) {
		const calls: Call[] = [];
		const fetchImpl = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
			const method = init?.method ?? 'GET';
			calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
			if (method === 'DELETE') return Promise.resolve(json({}));
			if (method === 'POST') return Promise.resolve(json({}));
			return Promise.resolve(
				json({
					entity: {
						_id: 'prog-item-1',
						ordinal: ordinalValueIds.map((id) => ({ _id: id, number: 2 }))
					}
				})
			);
		});
		return { fetchImpl, calls };
	}

	it("POST body is exactly [{ _id: 'ov-1', type: 'ordinal', number: <n> }] — the old id rides the overwrite (#264)", async () => {
		const { fetchImpl, calls } = makeMockFetch();
		await updateProgramItemOrdinal(cfg, 'prog-item-1', 5, fetchImpl);
		const postBodies = calls
			.filter((c) => c.method === 'POST')
			.flatMap((c) => c.body as Array<{ type: string; number?: number; string?: string }>);
		expect(postBodies).toEqual([{ _id: 'ov-1', type: 'ordinal', number: 5 }]);
	});

	it('order (#264): GET → ONE atomic POST — no DELETE round-trip remains (a mid-reorder failure can never leave a program_item with NO ordinal)', async () => {
		const { fetchImpl, calls } = makeMockFetch(['ov-old']);
		await updateProgramItemOrdinal(cfg, 'prog-item-1', 4, fetchImpl);
		expect(calls[0].method).toBe('GET');
		expect(calls[0].url).toContain('prog-item-1');
		expect(calls[0].url).toContain('ordinal');
		expect(calls.map((c) => c.method)).toEqual(['GET', 'POST']);
		expect(calls[1].body).toEqual([{ _id: 'ov-old', type: 'ordinal', number: 4 }]);
	});

	it('ordinal 0 is a legal target (move to opening slot) — POST still carries { number: 0 }', async () => {
		const { fetchImpl, calls } = makeMockFetch();
		await updateProgramItemOrdinal(cfg, 'prog-item-1', 0, fetchImpl);
		const postBodies = calls
			.filter((c) => c.method === 'POST')
			.flatMap((c) => c.body as Array<{ type: string; number?: number }>);
		expect(postBodies).toEqual([{ _id: 'ov-1', type: 'ordinal', number: 0 }]);
	});

	it('throws on a non-2xx GET response', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(json({}, 403));
		await expect(updateProgramItemOrdinal(cfg, 'prog-item-1', 1, fetchImpl)).rejects.toThrow(/403/);
	});
});

describe('deleteProgramItem', () => {
	it('sends DELETE {db}/entity/{itemId} — entity endpoint, not property', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(json({}));
		await deleteProgramItem(cfg, 'prog-item-xyz', fetchImpl);
		expect(fetchImpl).toHaveBeenCalledTimes(1);
		const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
		expect(url).toContain('entity');
		expect(url).toContain('prog-item-xyz');
		expect(url).not.toContain('property');
		expect(init.method).toBe('DELETE');
	});

	it('throws on a non-2xx response (status surfaced)', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(json({}, 403));
		await expect(deleteProgramItem(cfg, 'prog-item-xyz', fetchImpl)).rejects.toThrow(/403/);
	});
});

describe('manageRightsFrom', () => {
	it("person in editors → 'editor'", () => {
		expect(manageRightsFrom([], ['me'], 'me')).toBe('editor');
	});

	it("person in owners → 'editor' — ownership subsumes editing", () => {
		expect(manageRightsFrom(['me'], [], 'me')).toBe('editor');
	});

	it("person in neither → 'not-editor'", () => {
		expect(manageRightsFrom(['someone'], ['else'], 'me')).toBe('not-editor');
	});

	it("no visible rights at all (private bucket, non-granted caller) → 'not-editor'", () => {
		expect(manageRightsFrom([], [], 'me')).toBe('not-editor');
	});

	it('is pure — no fetch, so it costs nothing per event', () => {
		const owners = ['me'];
		const editors: string[] = [];
		manageRightsFrom(owners, editors, 'me');
		expect(owners).toEqual(['me']);
		expect(editors).toEqual([]);
	});
});

describe('resolveManageRights', () => {
	function entityWith(rights: { _owner?: string[]; _editor?: string[] }) {
		return json({
			entity: {
				_id: 'season-s',
				...(rights._owner ? { _owner: rights._owner.map((r) => ({ reference: r })) } : {}),
				...(rights._editor ? { _editor: rights._editor.map((r) => ({ reference: r })) } : {})
			}
		});
	}

	it('GETs entity/{entityId}?props=_owner,_editor — reads the entity own rights props, no list query', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(entityWith({ _editor: ['person-me'] }));
		await resolveManageRights(cfg, 'season-s', 'person-me', fetchImpl);
		expect(fetchImpl).toHaveBeenCalledTimes(1);
		const url = String(fetchImpl.mock.calls[0][0]);
		expect(url).toContain('entity/season-s');
		expect(url).toContain('_owner');
		expect(url).toContain('_editor');
	});

	it("person in _editor → 'editor' (controls render)", async () => {
		const fetchImpl = vi.fn().mockResolvedValue(
			entityWith({ _editor: ['person-other', 'person-me'] })
		);
		const state: ManageRightsState = await resolveManageRights(cfg, 'season-s', 'person-me', fetchImpl);
		expect(state).toBe('editor');
	});

	it("person in _owner (not _editor) → 'editor' — ownership subsumes editing (librarianStore pattern)", async () => {
		const fetchImpl = vi.fn().mockResolvedValue(entityWith({ _owner: ['person-me'] }));
		expect(await resolveManageRights(cfg, 'event-e', 'person-me', fetchImpl)).toBe('editor');
	});

	it("person in neither list → 'not-editor' (controls hidden)", async () => {
		const fetchImpl = vi.fn().mockResolvedValue(
			entityWith({ _owner: ['person-a'], _editor: ['person-b'] })
		);
		expect(await resolveManageRights(cfg, 'season-s', 'person-me', fetchImpl)).toBe('not-editor');
	});

	it("rights props ABSENT entirely (non-granted caller — private bucket invisible) → 'not-editor', no throw", async () => {
		const fetchImpl = vi.fn().mockResolvedValue(json({ entity: { _id: 'season-s' } }));
		expect(await resolveManageRights(cfg, 'season-s', 'person-me', fetchImpl)).toBe('not-editor');
	});

	it("non-2xx response → 'error' — NEVER collapsed into 'not-editor' (fail loudly; a network blip must not silently demote an editor)", async () => {
		const fetchImpl = vi.fn().mockResolvedValue(json({}, 500));
		expect(await resolveManageRights(cfg, 'season-s', 'person-me', fetchImpl)).toBe('error');
	});

	it("fetch rejection → 'error', not an unhandled throw", async () => {
		const fetchImpl = vi.fn().mockRejectedValue(new Error('network down'));
		expect(await resolveManageRights(cfg, 'season-s', 'person-me', fetchImpl)).toBe('error');
	});
});

describe('pickableWorks', () => {
	const works: Work[] = [
		{ id: 'work-a', name: 'Aeternum', composer: 'Pärt' },
		{ id: 'work-b', name: 'Beatus', composer: 'Tormis' },
		{ id: 'work-c', name: 'Cantus', composer: 'Kreek' }
	];

	function repItem(id: string, workId: string, status: string): RepertoireItem {
		return { id, workId, editionId: '', status, name: '' };
	}

	it('filters out works already present in the repertoire (by workId), preserving library order', () => {
		const repertoire = [repItem('rep-1', 'work-b', 'active')];
		expect(pickableWorks(works, repertoire)).toEqual([
			{ id: 'work-a', name: 'Aeternum', composer: 'Pärt' },
			{ id: 'work-c', name: 'Cantus', composer: 'Kreek' }
		]);
	});

	it('excludes works regardless of repertoire status — a retired/dropped item is STILL a repertoire_item (re-activate via status toggle, never a duplicate create)', () => {
		const repertoire = [
			repItem('rep-1', 'work-a', 'retired'),
			repItem('rep-2', 'work-b', 'dropped'),
			repItem('rep-3', 'work-c', 'learning')
		];
		expect(pickableWorks(works, repertoire)).toEqual([]);
	});

	it('empty repertoire → every library work is pickable', () => {
		expect(pickableWorks(works, [])).toEqual(works);
	});

	it('empty library → [] (nothing to pick, regardless of repertoire)', () => {
		expect(pickableWorks([], [repItem('rep-1', 'work-a', 'active')])).toEqual([]);
	});

	it('never mutates its inputs', () => {
		const worksCopy = structuredClone(works);
		const repertoire = [repItem('rep-1', 'work-a', 'active')];
		const repertoireCopy = structuredClone(repertoire);
		pickableWorks(works, repertoire);
		expect(works).toEqual(worksCopy);
		expect(repertoire).toEqual(repertoireCopy);
	});
});

describe('planProgramMove', () => {
	const programme = [
		{ id: 'pi-a', ordinal: 0 },
		{ id: 'pi-b', ordinal: 1 },
		{ id: 'pi-c', ordinal: 2 }
	];

	it('moving up emits BOTH sides of the swap — the neighbour is renumbered too', () => {
		expect(planProgramMove(programme, 'pi-b', 'up')).toEqual([
			{ id: 'pi-b', ordinal: 0 },
			{ id: 'pi-a', ordinal: 1 }
		]);
	});

	it('moving down emits both sides as well', () => {
		expect(planProgramMove(programme, 'pi-b', 'down')).toEqual([
			{ id: 'pi-c', ordinal: 1 },
			{ id: 'pi-b', ordinal: 2 }
		]);
	});

	it('leaves untouched items alone — only rows whose ordinal actually changes are written', () => {
		const plan = planProgramMove(programme, 'pi-b', 'up');
		expect(plan.map((entry) => entry.id)).not.toContain('pi-c');
	});

	it('a boundary row yields NO writes at all (never a bogus ordinal)', () => {
		expect(planProgramMove(programme, 'pi-a', 'up')).toEqual([]);
		expect(planProgramMove(programme, 'pi-c', 'down')).toEqual([]);
	});

	it('an unknown id yields no writes', () => {
		expect(planProgramMove(programme, 'pi-nope', 'up')).toEqual([]);
	});

	it('DUPLICATE ordinals (Entu `mandatory` is a soft hint) renumber cleanly instead of swapping to a no-op', () => {
		const tied = [
			{ id: 'pi-x', ordinal: 0 },
			{ id: 'pi-y', ordinal: 0 }
		];
		const plan = planProgramMove(tied, 'pi-y', 'up');
		expect(plan).toEqual([{ id: 'pi-x', ordinal: 1 }]);
		const after = new Map(tied.map((entry) => [entry.id, entry.ordinal]));
		for (const write of plan) after.set(write.id, write.ordinal);
		expect([...after.entries()].sort((a, b) => a[1] - b[1]).map(([id]) => id)).toEqual([
			'pi-y',
			'pi-x'
		]);
		expect(new Set(after.values()).size).toBe(after.size);
	});

	it('reads the list in DISPLAY order, not array order — "the row above" is the row she saw above', () => {
		const outOfOrder = [
			{ id: 'pi-c', ordinal: 2 },
			{ id: 'pi-a', ordinal: 0 },
			{ id: 'pi-b', ordinal: 1 }
		];
		expect(planProgramMove(outOfOrder, 'pi-c', 'up')).toEqual([
			{ id: 'pi-c', ordinal: 1 },
			{ id: 'pi-b', ordinal: 2 }
		]);
	});

	it('is pure — the caller\'s array is not mutated', () => {
		const input = programme.map((entry) => ({ ...entry }));
		planProgramMove(input, 'pi-b', 'up');
		expect(input).toEqual(programme);
	});
});

describe('reorderProgramItems', () => {
	it('POSTs the swapped numbers for BOTH items — one move, two ATOMIC overwrite-POSTs carrying the old value ids (#264), no DELETE', async () => {
		const fetchImpl = vi.fn().mockImplementation((url: string | URL | Request, init?: RequestInit) => {
			const s = String(url);
			if (!init || init.method === undefined) {
				const itemId = s.split('/').pop()?.split('?')[0];
				return Promise.resolve(json({ entity: { ordinal: [{ _id: `val-${itemId}` }] } }));
			}
			return Promise.resolve(json({}));
		});

		await reorderProgramItems(
			cfg,
			[
				{ id: 'pi-b', ordinal: 0 },
				{ id: 'pi-a', ordinal: 1 }
			],
			fetchImpl
		);

		const posts = fetchImpl.mock.calls.filter(
			([, init]) => (init as RequestInit | undefined)?.method === 'POST'
		);
		expect(posts.length).toBe(2);
		expect(String(posts[0][0])).toContain('entity/pi-b');
		expect(JSON.parse(String((posts[0][1] as RequestInit).body))).toEqual([
			{ _id: 'val-pi-b', type: 'ordinal', number: 0 }
		]);
		expect(String(posts[1][0])).toContain('entity/pi-a');
		expect(JSON.parse(String((posts[1][1] as RequestInit).body))).toEqual([
			{ _id: 'val-pi-a', type: 'ordinal', number: 1 }
		]);
		expect(fetchImpl.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === 'DELETE')).toEqual(
			[]
		);
	});

	it('an empty plan writes nothing at all', async () => {
		const fetchImpl = vi.fn();
		await reorderProgramItems(cfg, [], fetchImpl);
		expect(fetchImpl).not.toHaveBeenCalled();
	});

	it('fails loud on the first rejection — the caller rolls back rather than half-moving silently', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(json({ error: 'nope' }, 403));
		await expect(
			reorderProgramItems(cfg, [{ id: 'pi-b', ordinal: 0 }], fetchImpl)
		).rejects.toThrow();
	});
});

describe('createRepertoireWriteQueue', () => {
	function makeCallbacks() {
		return {
			setPending: vi.fn(),
			reconcile: vi.fn(),
			revert: vi.fn()
		};
	}

	it('fires the write IMMEDIATELY on request — per-tap, no batching, no debounce', () => {
		const callbacks = makeCallbacks();
		const queue = createRepertoireWriteQueue(callbacks);
		const write = vi.fn().mockResolvedValue(undefined);
		queue.request('rep-item-1', write);
		expect(write).toHaveBeenCalledTimes(1);
	});

	it('marks the key pending SYNCHRONOUSLY (before the write settles) — the caller threads this into the control disabled prop', () => {
		const callbacks = makeCallbacks();
		const queue = createRepertoireWriteQueue(callbacks);
		const d = deferred();
		queue.request('rep-item-1', () => d.promise);
		expect(callbacks.setPending).toHaveBeenCalledWith('rep-item-1', true);
		expect(queue.isPending('rep-item-1')).toBe(true);
		d.resolve(); // let it settle so nothing leaks into other tests
	});

	it('DEFENSIVE BACKSTOP: a second request for the SAME key while pending is swallowed — the write thunk never fires (#15: no double-tap 404s)', () => {
		const callbacks = makeCallbacks();
		const queue = createRepertoireWriteQueue(callbacks);
		const d = deferred();
		queue.request('rep-item-1', () => d.promise);
		const second = vi.fn().mockResolvedValue(undefined);
		queue.request('rep-item-1', second);
		expect(second).not.toHaveBeenCalled();
		d.resolve();
	});

	it('a pending key does NOT block a DIFFERENT key — items write concurrently', () => {
		const callbacks = makeCallbacks();
		const queue = createRepertoireWriteQueue(callbacks);
		const d = deferred();
		queue.request('rep-item-1', () => d.promise);
		const other = vi.fn().mockResolvedValue(undefined);
		queue.request('rep-item-2', other);
		expect(other).toHaveBeenCalledTimes(1);
		d.resolve();
	});

	it('on resolve: clears pending, then reconcile(key) — and the key accepts a NEW request afterwards', async () => {
		const callbacks = makeCallbacks();
		const queue = createRepertoireWriteQueue(callbacks);
		const d = deferred();
		queue.request('rep-item-1', () => d.promise);
		d.resolve();
		await vi.waitFor(() => expect(callbacks.reconcile).toHaveBeenCalledWith('rep-item-1'));
		expect(callbacks.setPending).toHaveBeenLastCalledWith('rep-item-1', false);
		expect(queue.isPending('rep-item-1')).toBe(false);
		expect(callbacks.revert).not.toHaveBeenCalled();

		const next = vi.fn().mockResolvedValue(undefined);
		queue.request('rep-item-1', next);
		expect(next).toHaveBeenCalledTimes(1);
	});

	it('on reject: clears pending, then revert(key) — PER-KEY, and no unhandled rejection escapes', async () => {
		const callbacks = makeCallbacks();
		const queue = createRepertoireWriteQueue(callbacks);
		const d = deferred();
		queue.request('rep-item-1', () => d.promise);
		d.reject(new Error('403'));
		await vi.waitFor(() => expect(callbacks.revert).toHaveBeenCalledWith('rep-item-1'));
		expect(callbacks.setPending).toHaveBeenLastCalledWith('rep-item-1', false);
		expect(queue.isPending('rep-item-1')).toBe(false);
		expect(callbacks.reconcile).not.toHaveBeenCalled();
	});

	it('applies the optimistic mutation SYNCHRONOUSLY, before the write is fired', () => {
		const callbacks = makeCallbacks();
		const queue = createRepertoireWriteQueue(callbacks);
		const order: string[] = [];
		const d = deferred();
		queue.request(
			'rep-item-1',
			() => {
				order.push('write');
				return d.promise;
			},
			{ apply: () => order.push('apply') }
		);
		expect(order).toEqual(['apply', 'write']);
		d.resolve();
	});

	it('on resolve: the optimistic value STAYS (no rollback) and reconcile fires', async () => {
		const callbacks = makeCallbacks();
		const queue = createRepertoireWriteQueue(callbacks);
		const rollback = vi.fn();
		const d = deferred();
		queue.request('rep-item-1', () => d.promise, { apply: vi.fn(), rollback });
		d.resolve();
		await vi.waitFor(() => expect(callbacks.reconcile).toHaveBeenCalledWith('rep-item-1'));
		expect(rollback).not.toHaveBeenCalled();
	});

	it('on reject: rolls the optimistic value back BEFORE revert(key) — revert observes the pre-tap state, it never has to undo anything itself', async () => {
		const callbacks = makeCallbacks();
		const order: string[] = [];
		const queue = createRepertoireWriteQueue({
			...callbacks,
			revert: (key: string) => {
				order.push('revert');
				callbacks.revert(key);
			}
		});
		const d = deferred();
		queue.request('rep-item-1', () => d.promise, {
			apply: vi.fn(),
			rollback: () => order.push('rollback')
		});
		d.reject(new Error('403'));
		await vi.waitFor(() => expect(callbacks.revert).toHaveBeenCalledWith('rep-item-1'));
		expect(order).toEqual(['rollback', 'revert']);
	});

	it('hooks are OPTIONAL — a create (no server-assigned id to show yet) still runs as a plain pending-then-reconcile write', async () => {
		const callbacks = makeCallbacks();
		const queue = createRepertoireWriteQueue(callbacks);
		const d = deferred();
		queue.request('__add_work__', () => d.promise);
		d.resolve();
		await vi.waitFor(() => expect(callbacks.reconcile).toHaveBeenCalledWith('__add_work__'));
	});

	it('a swallowed double tap does NOT re-apply the optimistic mutation', () => {
		const callbacks = makeCallbacks();
		const queue = createRepertoireWriteQueue(callbacks);
		const d = deferred();
		const apply = vi.fn();
		queue.request('rep-item-1', () => d.promise, { apply });
		queue.request('rep-item-1', () => Promise.resolve(), { apply });
		expect(apply).toHaveBeenCalledTimes(1);
		d.resolve();
	});

	it("one key's failure never touches another key's state — no whole-map revert (#15's clobber bug, pinned structurally)", async () => {
		const callbacks = makeCallbacks();
		const queue = createRepertoireWriteQueue(callbacks);
		const failing = deferred();
		const inFlight = deferred();
		queue.request('rep-item-fail', () => failing.promise);
		queue.request('rep-item-alive', () => inFlight.promise);
		failing.reject(new Error('500'));
		await vi.waitFor(() => expect(callbacks.revert).toHaveBeenCalledWith('rep-item-fail'));
		expect(queue.isPending('rep-item-alive')).toBe(true);
		expect(callbacks.revert).toHaveBeenCalledTimes(1);
		expect(callbacks.setPending).not.toHaveBeenCalledWith('rep-item-alive', false);
		inFlight.resolve();
	});
});

// (*MVOX:Tallis*)
