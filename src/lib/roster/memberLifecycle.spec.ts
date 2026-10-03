// Member lifecycle: deactivate, reinstate, the inactive list and the refusal read.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { json, testCfg, type Call } from '$lib/testing/entuFetchKit';

const { listAdminsMock, listLibrariansMock, listMyProfilesMock } = vi.hoisted(() => ({
	listAdminsMock: vi.fn(),
	listLibrariansMock: vi.fn(),
	listMyProfilesMock: vi.fn()
}));
vi.mock('$lib/admin/roleManagement', async (importActual) => ({
	...(await importActual<typeof import('$lib/admin/roleManagement')>()),
	listAdmins: listAdminsMock,
	listLibrarians: listLibrariansMock
}));
vi.mock('$lib/profile/profileData', async (importActual) => ({
	...(await importActual<typeof import('$lib/profile/profileData')>()),
	listMyProfiles: listMyProfilesMock
}));
vi.mock('$lib/entu-config', async () =>
	(await import('$lib/testing/routeMocks')).entuConfigModule()
);

import {
	deactivateMember,
	reinstateMember,
	listInactiveMembers,
	loadInactiveRoster,
	loadRosterIncludingArchived,
	loadActiveAndArchivedRosters,
	listDeactivateBlockers
} from './memberLifecycle';

const cfg = testCfg('testdb');

function makeStatusFlipFetch(statusValues: Array<{ _id: string; string: string }>) {
	const calls: Call[] = [];
	const fetchImpl = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
		const method = init?.method ?? 'GET';
		calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
		if (method === 'DELETE') return Promise.resolve(json({}));
		if (method === 'POST') return Promise.resolve(json({}));
		return Promise.resolve(
			json({
				entity: {
					_id: 'member-1',
					status: statusValues,
					_parent: [{ _id: 'pv-1', reference: 'sec-alto', entity_type: 'section' }],
					person: [{ _id: 'per-v', reference: 'person-x' }]
				}
			})
		);
	});
	return { fetchImpl, calls };
}

describe('deactivateMember', () => {
	it('order: GET → ONE atomic POST — no DELETE anywhere (the overwrite replaces the old value in the same call)', async () => {
		const { fetchImpl, calls } = makeStatusFlipFetch([{ _id: 'sv-1', string: 'active' }]);
		await deactivateMember(cfg, 'member-1', fetchImpl);
		expect(calls.map((c) => c.method)).toEqual(['GET', 'POST']);
	});

	it('GET targets the member entity and asks for status', async () => {
		const { fetchImpl, calls } = makeStatusFlipFetch([{ _id: 'sv-1', string: 'active' }]);
		await deactivateMember(cfg, 'member-1', fetchImpl);
		expect(calls[0].url).toContain('entity/member-1');
		expect(calls[0].url).toContain('status');
	});

	it('corrupted double-value state: the overwrite pairs the FIRST old id; ONLY the extra is deleted, strictly AFTER the POST (never before — an empty status must be unreachable)', async () => {
		const { fetchImpl, calls } = makeStatusFlipFetch([
			{ _id: 'sv-a', string: 'active' },
			{ _id: 'sv-b', string: 'active' }
		]);
		await deactivateMember(cfg, 'member-1', fetchImpl);
		const postCalls = calls.filter((c) => c.method === 'POST');
		expect(postCalls).toHaveLength(1);
		expect(postCalls[0].body).toEqual([{ _id: 'sv-a', type: 'status', string: 'archived' }]);
		const deleteUrls = calls.filter((c) => c.method === 'DELETE').map((c) => c.url);
		expect(deleteUrls).toHaveLength(1);
		expect(deleteUrls[0]).toContain('property');
		expect(deleteUrls[0]).toContain('sv-b');
		expect(calls.findIndex((c) => c.method === 'DELETE')).toBeGreaterThan(
			calls.findIndex((c) => c.method === 'POST')
		);
	});

	it("DONE-WHEN 1 (#255) + #264: POST body is EXACTLY [{_id:'sv-1', type:'status', string:'archived'}] — the old value id rides the write, and no other property is touched (toEqual, not arrayContaining)", async () => {
		const { fetchImpl, calls } = makeStatusFlipFetch([{ _id: 'sv-1', string: 'active' }]);
		await deactivateMember(cfg, 'member-1', fetchImpl);
		const postCalls = calls.filter((c) => c.method === 'POST');
		expect(postCalls).toHaveLength(1);
		expect(postCalls[0].url).toContain('entity/member-1');
		expect(postCalls[0].body).toEqual([{ _id: 'sv-1', type: 'status', string: 'archived' }]);
	});

	it('#264 — a REJECTED POST leaves the OLD value intact: no DELETE was ever issued, so the empty-status half-landing is structurally impossible', async () => {
		const calls: Call[] = [];
		const fetchImpl = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
			const method = init?.method ?? 'GET';
			calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
			if (method === 'POST') return Promise.resolve(json({}, 500));
			if (method === 'DELETE') return Promise.resolve(json({}));
			return Promise.resolve(
				json({ entity: { _id: 'member-1', status: [{ _id: 'sv-1', string: 'active' }] } })
			);
		});
		await expect(deactivateMember(cfg, 'member-1', fetchImpl)).rejects.toThrow(/500/);
		expect(calls.filter((c) => c.method === 'DELETE')).toEqual([]);
		expect(calls.filter((c) => c.method === 'POST')[0]?.body).toEqual([
			{ _id: 'sv-1', type: 'status', string: 'archived' }
		]);
	});

	it('DONE-WHEN 1: nothing in the entire call log touches _parent, _owner or _editor — no property but status is cleared, no rights change, no reparent', async () => {
		const { fetchImpl, calls } = makeStatusFlipFetch([{ _id: 'sv-1', string: 'active' }]);
		await deactivateMember(cfg, 'member-1', fetchImpl);
		for (const call of calls) {
			expect(call.url).not.toContain('pv-1');
			const body = JSON.stringify(call.body ?? []);
			expect(body).not.toContain('_parent');
			expect(body).not.toContain('_owner');
			expect(body).not.toContain('_editor');
		}
	});

	it('NO existing status value (corrupted state) → plain POST, body EXACTLY [{type:"status", string:"archived"}], and still no DELETE', async () => {
		const { fetchImpl, calls } = makeStatusFlipFetch([]);
		await deactivateMember(cfg, 'member-1', fetchImpl);
		expect(calls.map((c) => c.method)).toEqual(['GET', 'POST']);
		expect(calls[1].body).toEqual([{ type: 'status', string: 'archived' }]);
	});

	it('throws on a non-2xx GET', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(json({}, 403));
		await expect(deactivateMember(cfg, 'member-1', fetchImpl)).rejects.toThrow(/403/);
	});

	it('throws on a non-2xx EXTRA-sweep DELETE (corrupted 2+ state only — no silent half-flip)', async () => {
		const fetchImpl = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
			if (init?.method === 'DELETE') return Promise.resolve(json({}, 500));
			if (init?.method === 'POST') return Promise.resolve(json({}));
			return Promise.resolve(
				json({
					entity: {
						_id: 'member-1',
						status: [
							{ _id: 'sv-a', string: 'active' },
							{ _id: 'sv-b', string: 'active' }
						]
					}
				})
			);
		});
		await expect(deactivateMember(cfg, 'member-1', fetchImpl)).rejects.toThrow(/500/);
	});
});

describe('reinstateMember', () => {
	it("#264: POST body is EXACTLY [{_id:'sv-arch', type:'status', string:'active'}] — the archived value is replaced atomically, never cleared first", async () => {
		const { fetchImpl, calls } = makeStatusFlipFetch([{ _id: 'sv-arch', string: 'archived' }]);
		await reinstateMember(cfg, 'member-1', fetchImpl);
		expect(calls.filter((c) => c.method === 'DELETE')).toEqual([]);
		const postCalls = calls.filter((c) => c.method === 'POST');
		expect(postCalls).toHaveLength(1);
		expect(postCalls[0].body).toEqual([{ _id: 'sv-arch', type: 'status', string: 'active' }]);
	});

	it('order: GET → ONE atomic POST, same wire as deactivate — no DELETE', async () => {
		const { fetchImpl, calls } = makeStatusFlipFetch([{ _id: 'sv-arch', string: 'archived' }]);
		await reinstateMember(cfg, 'member-1', fetchImpl);
		expect(calls.map((c) => c.method)).toEqual(['GET', 'POST']);
	});

	it('touches no invite machinery: no call URL mentions invite (reinstate WITHOUT a fresh invitation)', async () => {
		const { fetchImpl, calls } = makeStatusFlipFetch([{ _id: 'sv-arch', string: 'archived' }]);
		await reinstateMember(cfg, 'member-1', fetchImpl);
		for (const call of calls) {
			expect(call.url).not.toContain('invite');
		}
	});
});

describe('listInactiveMembers', () => {
	it('URL: _type.string=member, status.string=archived, props=person,_parent, limit=500 — same shape as listActiveMembers (rosterData.ts:100), status inverted', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(json({ entities: [] }));
		await listInactiveMembers(cfg, fetchImpl);
		const url = String(fetchImpl.mock.calls[0][0]);
		expect(url).toContain('_type.string=member');
		expect(url).toContain('status.string=archived');
		expect(url).toContain('props=person,_parent');
		expect(url).toContain('limit=500');
	});

	it('FULL SHAPE: maps memberId/personId/sectionIds/dbEntityId — the section assignment is the surface BINDING (explains the section ghost-blocker)', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(
			json({
				entities: [
					{
						_id: 'member-9',
						person: [{ reference: 'person-9' }],
						_parent: [
							{ reference: 'sec-alto', entity_type: 'section' },
							{ reference: 'db-1', entity_type: 'database' }
						]
					}
				]
			})
		);
		const read = await listInactiveMembers(cfg, fetchImpl);
		expect(read.items).toEqual([
			{
				memberId: 'member-9',
				personId: 'person-9',
				sectionIds: ['sec-alto'],
				dbEntityId: 'db-1'
			}
		]);
	});

	it('throws on a non-2xx response', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(json({}, 500));
		await expect(listInactiveMembers(cfg, fetchImpl)).rejects.toThrow(/500/);
	});

	it('#456: an archived member with an unreadable person reference is SKIPPED — one console.warn naming her member id, healthy rows returned in wire order (full ListRead shape)', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		try {
			const fetchImpl = vi.fn().mockResolvedValue(
				json({
					count: 3,
					entities: [
						{
							_id: 'member-9',
							person: [{ reference: 'person-9' }],
							_parent: [
								{ reference: 'sec-alto', entity_type: 'section' },
								{ reference: 'db-1', entity_type: 'database' }
							]
						},
						{ _id: 'member-orphan' },
						{
							_id: 'member-8',
							person: [{ reference: 'person-8' }],
							_parent: [{ reference: 'db-1', entity_type: 'database' }]
						}
					]
				})
			);
			const read = await listInactiveMembers(cfg, fetchImpl);
			expect(read).toEqual({
				items: [
					{
						memberId: 'member-9',
						personId: 'person-9',
						sectionIds: ['sec-alto'],
						dbEntityId: 'db-1'
					},
					{ memberId: 'member-8', personId: 'person-8', sectionIds: [], dbEntityId: 'db-1' }
				],
				total: 3,
				truncated: false
			});
			expect(warn).toHaveBeenCalledTimes(1);
			expect(warn).toHaveBeenCalledWith(expect.stringContaining('member-orphan'));
		} finally {
			warn.mockRestore();
		}
	});

	it('#456: an archived roster with NO orphaned member is unchanged — exact pre-change output, console.warn never called', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		try {
			const fetchImpl = vi.fn().mockResolvedValue(
				json({
					count: 2,
					entities: [
						{
							_id: 'member-9',
							person: [{ reference: 'person-9' }],
							_parent: [
								{ reference: 'sec-alto', entity_type: 'section' },
								{ reference: 'db-1', entity_type: 'database' }
							]
						},
						{
							_id: 'member-8',
							person: [{ reference: 'person-8' }],
							_parent: [{ reference: 'db-1', entity_type: 'database' }]
						}
					]
				})
			);
			const read = await listInactiveMembers(cfg, fetchImpl);
			expect(read).toEqual({
				items: [
					{
						memberId: 'member-9',
						personId: 'person-9',
						sectionIds: ['sec-alto'],
						dbEntityId: 'db-1'
					},
					{ memberId: 'member-8', personId: 'person-8', sectionIds: [], dbEntityId: 'db-1' }
				],
				total: 2,
				truncated: false
			});
			expect(warn).not.toHaveBeenCalled();
		} finally {
			warn.mockRestore();
		}
	});
});

describe('loadInactiveRoster', () => {
	beforeEach(() => {
		listMyProfilesMock.mockReset();
	});

	it('FULL SHAPE: resolves names via the shared-profile read + toRosterRow (#28 gate), carrying sectionIds through — the surface must show her section; #469: profileName is set like loadRoster sets it', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(
			json({
				entities: [
					{
						_id: 'member-9',
						person: [{ reference: 'person-9' }],
						_parent: [
							{ reference: 'sec-alto', entity_type: 'section' },
							{ reference: 'db-1', entity_type: 'database' }
						]
					}
				]
			})
		);
		listMyProfilesMock.mockResolvedValue([
			{ _id: 'prof-9', _sharing: 'domain', name: 'Gone Girl', email: 'gone@example.com' }
		]);
		const read = await loadInactiveRoster(cfg, fetchImpl);
		expect(read.items).toEqual([
			{
				memberId: 'member-9',
				personId: 'person-9',
				name: 'Gone Girl',
				profileName: 'Gone Girl',
				email: 'gone@example.com',
				sectionIds: ['sec-alto'],
				dbEntityId: 'db-1'
			}
		]);
	});

	it('a nameless inactive member is dropped (#28 completeness gate — same rule as loadRoster)', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(
			json({
				entities: [{ _id: 'member-9', person: [{ reference: 'person-9' }], _parent: [] }]
			})
		);
		listMyProfilesMock.mockResolvedValue([]);
		const read = await loadInactiveRoster(cfg, fetchImpl);
		expect(read.items).toEqual([]);
	});
});

describe('listDeactivateBlockers', () => {
	beforeEach(() => {
		listAdminsMock.mockReset();
		listLibrariansMock.mockReset();
	});

	const adminListing = (ids: string[]) => ({
		persons: ids.map((id) => ({ id, name: `Name of ${id}`, role: 'owner' as const, valueIds: [`v-${id}`] })),
		canManage: true
	});

	it("a person holding an admin grant on the database entity → [{ role: 'admin' }]", async () => {
		listAdminsMock.mockResolvedValue(adminListing(['person-b']));
		listLibrariansMock.mockResolvedValue(adminListing([]));
		const blockers = await listDeactivateBlockers(cfg, 'person-b', 'db-1', 'lib-1');
		expect(blockers).toEqual([{ role: 'admin' }]);
		expect(listAdminsMock.mock.calls[0][1]).toBe('db-1');
	});

	it("a person holding a librarian grant on the library entity → [{ role: 'librarian' }]", async () => {
		listAdminsMock.mockResolvedValue(adminListing([]));
		listLibrariansMock.mockResolvedValue(adminListing(['person-b']));
		const blockers = await listDeactivateBlockers(cfg, 'person-b', 'db-1', 'lib-1');
		expect(blockers).toEqual([{ role: 'librarian' }]);
		expect(listLibrariansMock.mock.calls[0][1]).toBe('lib-1');
	});

	it('both grants → both blockers, admin first (FULL SHAPE)', async () => {
		listAdminsMock.mockResolvedValue(adminListing(['person-b']));
		listLibrariansMock.mockResolvedValue(adminListing(['person-b']));
		const blockers = await listDeactivateBlockers(cfg, 'person-b', 'db-1', 'lib-1');
		expect(blockers).toEqual([{ role: 'admin' }, { role: 'librarian' }]);
	});

	it('no grants anywhere → [] (deactivate may proceed)', async () => {
		listAdminsMock.mockResolvedValue(adminListing(['person-other']));
		listLibrariansMock.mockResolvedValue(adminListing([]));
		const blockers = await listDeactivateBlockers(cfg, 'person-b', 'db-1', 'lib-1');
		expect(blockers).toEqual([]);
	});

	it('libraryId null (collective has no library) → listLibrarians is NOT called at all', async () => {
		listAdminsMock.mockResolvedValue(adminListing([]));
		const blockers = await listDeactivateBlockers(cfg, 'person-b', 'db-1', null);
		expect(blockers).toEqual([]);
		expect(listLibrariansMock).not.toHaveBeenCalled();
	});

	it('FAIL LOUD: a failed rights read REJECTS — never resolves [] (fail-open would let a deactivate slip past an unverified grant)', async () => {
		listAdminsMock.mockRejectedValue(new Error('rights lookup failed: 500'));
		listLibrariansMock.mockResolvedValue(adminListing([]));
		await expect(listDeactivateBlockers(cfg, 'person-b', 'db-1', 'lib-1')).rejects.toThrow();
	});

	it('FAIL LOUD: an EMPTY database entity id REJECTS before any rights read — an unscoped read is not a clean one', async () => {
		listAdminsMock.mockResolvedValue(adminListing([]));
		listLibrariansMock.mockResolvedValue(adminListing([]));
		await expect(listDeactivateBlockers(cfg, 'person-b', '', 'lib-1')).rejects.toThrow();
		expect(listAdminsMock).not.toHaveBeenCalled();
		expect(listLibrariansMock).not.toHaveBeenCalled();
	});
});

describe('#467 — listInactiveMembers requests and threads the member _created stamp', () => {
	it('URL: props widened to person,_parent,_created — same shape as listActiveMembers', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(json({ entities: [] }));
		await listInactiveMembers(cfg, fetchImpl);
		expect(String(fetchImpl.mock.calls[0][0])).toContain('props=person,_parent,_created');
	});

	it('createdAt = _created[0].datetime; the author `.reference`/`.string` never reaches the item (ER-26)', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(
			json({
				entities: [
					{
						_id: 'member-9',
						person: [{ reference: 'person-9' }],
						_parent: [{ reference: 'db-1', entity_type: 'database' }],
						_created: [
							{
								_id: 'cr-9',
								datetime: '2026-05-05T08:00:00.000Z',
								reference: 'author-7',
								string: 'Author Seven',
								entity_type: 'member',
								property_type: '_created'
							}
						]
					}
				]
			})
		);
		const read = await listInactiveMembers(cfg, fetchImpl);
		expect(read.items).toEqual([
			{
				memberId: 'member-9',
				personId: 'person-9',
				sectionIds: [],
				dbEntityId: 'db-1',
				createdAt: '2026-05-05T08:00:00.000Z'
			}
		]);
		const flat = JSON.stringify(read.items);
		expect(flat).not.toContain('author-7');
		expect(flat).not.toContain('Author Seven');
	});

	it('missing _created → createdAt undefined — fail-soft per row, no warn, row kept', async () => {
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const fetchImpl = vi.fn().mockResolvedValue(
			json({ entities: [{ _id: 'member-9', person: [{ reference: 'person-9' }] }] })
		);
		const read = await listInactiveMembers(cfg, fetchImpl);
		expect(read.items).toHaveLength(1);
		expect((read.items[0] as { createdAt?: string }).createdAt).toBeUndefined();
		expect(warnSpy).not.toHaveBeenCalled();
		warnSpy.mockRestore();
	});

	it('_created[0].datetime = null (non-string) → createdAt undefined', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(
			json({
				entities: [
					{ _id: 'member-9', person: [{ reference: 'person-9' }], _created: [{ datetime: null }] }
				]
			})
		);
		const read = await listInactiveMembers(cfg, fetchImpl);
		expect((read.items[0] as { createdAt?: string }).createdAt).toBeUndefined();
	});
});

function makeRealNamesWire(opts: {
	active?: Array<{ _id: string; person: string }>;
	archived?: Array<{ _id: string; person: string }>;
	toggle?: boolean | 'absent';
	records?: Array<{ _id: string; person?: string; name?: string }>;
}) {
	const { active = [], archived = [], toggle = 'absent', records = [] } = opts;
	const wireMembers = (list: Array<{ _id: string; person: string }>) =>
		json({ entities: list.map((m) => ({ _id: m._id, person: [{ reference: m.person }] })) });
	return vi.fn().mockImplementation((url: string) => {
		const u = String(url);
		if (u.includes('_type.string=admin_member_record')) {
			return Promise.resolve(
				json({
					entities: records.map((r) => ({
						_id: r._id,
						...(r.person !== undefined ? { person: [{ reference: r.person }] } : {}),
						...(r.name !== undefined ? { name: [{ string: r.name }] } : {})
					}))
				})
			);
		}
		if (u.includes('_type.string=member') && u.includes('status.string=archived')) {
			return Promise.resolve(wireMembers(archived));
		}
		if (u.includes('_type.string=member')) {
			return Promise.resolve(wireMembers(active));
		}
		if (u.includes('_type.string=database')) {
			return Promise.resolve(json({ entities: [{ _id: 'db-ent-9' }] }));
		}
		if (u.includes('entity/db-ent-9') && u.includes('roster_show_real_names')) {
			return Promise.resolve(
				json({
					entity: {
						_id: 'db-ent-9',
						...(toggle === 'absent'
							? {}
							: { roster_show_real_names: [{ _id: 'v-toggle', boolean: toggle }] })
					}
				})
			);
		}
		return Promise.resolve(json({ entities: [] }));
	});
}

function requestedUrls(fetchImpl: ReturnType<typeof vi.fn>): string[] {
	return (fetchImpl.mock.calls as Array<[unknown]>).map((c) => String(c[0]));
}

describe('#469 — loadInactiveRoster obeys roster_show_real_names (supersedes the v1 profile-only boundary)', () => {
	beforeEach(() => {
		listMyProfilesMock.mockReset();
	});

	const profilesByPerson: Record<string, unknown[]> = {
		'person-9': [{ _id: 'prof-9', _sharing: 'domain', name: 'Gone Girl', email: 'gone@example.com' }],
		'person-8': [{ _id: 'prof-8', _sharing: 'domain', name: 'Away Anna', email: 'anna@example.com' }]
	};

	it('toggle ON: the record-backed archived row shows the REAL name, profileName carries the profile resolution, rows re-sort by the displayed name — full ListRead shape, ONE toggle GET, ONE records GET', async () => {
		listMyProfilesMock.mockImplementation((_cfg: unknown, personId: string) =>
			Promise.resolve(profilesByPerson[personId] ?? [])
		);
		const fetchImpl = makeRealNamesWire({
			archived: [
				{ _id: 'member-9', person: 'person-9' },
				{ _id: 'member-8', person: 'person-8' }
			],
			toggle: true,
			records: [{ _id: 'rec-9', person: 'person-9', name: 'Zoe Zed' }]
		});
		const read = await loadInactiveRoster(cfg, fetchImpl);
		expect(read).toEqual({
			items: [
				{
					memberId: 'member-8',
					personId: 'person-8',
					name: 'Away Anna',
					profileName: 'Away Anna',
					email: 'anna@example.com',
					sectionIds: []
				},
				{
					memberId: 'member-9',
					personId: 'person-9',
					name: 'Zoe Zed',
					profileName: 'Gone Girl',
					email: 'gone@example.com',
					sectionIds: []
				}
			],
			total: 2,
			truncated: false
		});
		const all = requestedUrls(fetchImpl);
		expect(all.filter((u) => u.includes('roster_show_real_names'))).toHaveLength(1);
		expect(all.filter((u) => u.includes('admin_member_record'))).toHaveLength(1);
	});

	it('toggle OFF: profile names everywhere, profileName still set, the toggle read spent once, ZERO records reads', async () => {
		listMyProfilesMock.mockImplementation((_cfg: unknown, personId: string) =>
			Promise.resolve(profilesByPerson[personId] ?? [])
		);
		const fetchImpl = makeRealNamesWire({
			archived: [{ _id: 'member-9', person: 'person-9' }],
			toggle: false,
			records: [{ _id: 'rec-9', person: 'person-9', name: 'Zoe Zed' }]
		});
		const read = await loadInactiveRoster(cfg, fetchImpl);
		expect(read.items).toEqual([
			{
				memberId: 'member-9',
				personId: 'person-9',
				name: 'Gone Girl',
				profileName: 'Gone Girl',
				email: 'gone@example.com',
				sectionIds: []
			}
		]);
		const all = requestedUrls(fetchImpl);
		expect(all.filter((u) => u.includes('roster_show_real_names'))).toHaveLength(1);
		expect(all.filter((u) => u.includes('admin_member_record'))).toEqual([]);
	});
});

describe('#469 — loadRosterIncludingArchived overlays ONCE over the union', () => {
	beforeEach(() => {
		listMyProfilesMock.mockReset();
	});

	it('toggle ON: union rows (active wins) overlaid in ONE pass — exactly ONE toggle GET and ONE records GET for the whole call, full ListRead shape sorted by displayed name', async () => {
		const profilesByPerson: Record<string, unknown[]> = {
			'person-a': [
				{ _id: 'prof-a', _sharing: 'domain', name: 'Ada Lovelace', email: 'ada@example.com' }
			],
			'person-9': [
				{ _id: 'prof-9', _sharing: 'domain', name: 'Gone Girl', email: 'gone@example.com' }
			]
		};
		listMyProfilesMock.mockImplementation((_cfg: unknown, personId: string) =>
			Promise.resolve(profilesByPerson[personId] ?? [])
		);
		const fetchImpl = makeRealNamesWire({
			active: [{ _id: 'member-1', person: 'person-a' }],
			archived: [{ _id: 'member-9', person: 'person-9' }],
			toggle: true,
			records: [
				{ _id: 'rec-a', person: 'person-a', name: 'Zoe Zed' },
				{ _id: 'rec-9', person: 'person-9', name: 'Real Rita' }
			]
		});
		const read = await loadRosterIncludingArchived(cfg, fetchImpl);
		expect(read).toEqual({
			items: [
				{
					memberId: 'member-9',
					personId: 'person-9',
					name: 'Real Rita',
					profileName: 'Gone Girl',
					email: 'gone@example.com',
					sectionIds: []
				},
				{
					memberId: 'member-1',
					personId: 'person-a',
					name: 'Zoe Zed',
					profileName: 'Ada Lovelace',
					email: 'ada@example.com',
					sectionIds: [],
					ownerIds: []
				}
			],
			total: 2,
			truncated: false
		});
		const all = requestedUrls(fetchImpl);
		expect(all.filter((u) => u.includes('roster_show_real_names'))).toHaveLength(1);
		expect(all.filter((u) => u.includes('admin_member_record'))).toHaveLength(1);
	});
});

describe('#469 review F1 — loadActiveAndArchivedRosters: one overlay, two halves', () => {
	beforeEach(() => {
		listMyProfilesMock.mockReset();
	});

	const profilesByPerson: Record<string, unknown[]> = {
		'person-a': [
			{ _id: 'prof-a', _sharing: 'domain', name: 'Ada Lovelace', email: 'ada@example.com' }
		],
		'person-9': [{ _id: 'prof-9', _sharing: 'domain', name: 'Gone Girl', email: 'gone@example.com' }]
	};

	it('toggle ON: both halves carry REAL names from ONE toggle GET and ONE records GET, each half sorted by the displayed name, profileName untouched', async () => {
		listMyProfilesMock.mockImplementation((_cfg: unknown, personId: string) =>
			Promise.resolve(profilesByPerson[personId] ?? [])
		);
		const fetchImpl = makeRealNamesWire({
			active: [{ _id: 'member-1', person: 'person-a' }],
			archived: [{ _id: 'member-9', person: 'person-9' }],
			toggle: true,
			records: [
				{ _id: 'rec-a', person: 'person-a', name: 'Zoe Zed' },
				{ _id: 'rec-9', person: 'person-9', name: 'Real Rita' }
			]
		});
		const { active, inactive } = await loadActiveAndArchivedRosters(cfg, fetchImpl);
		expect(active).toEqual({
			items: [
				{
					memberId: 'member-1',
					personId: 'person-a',
					name: 'Zoe Zed',
					profileName: 'Ada Lovelace',
					email: 'ada@example.com',
					sectionIds: [],
					ownerIds: []
				}
			],
			total: 1,
			truncated: false
		});
		expect(inactive).toEqual({
			items: [
				{
					memberId: 'member-9',
					personId: 'person-9',
					name: 'Real Rita',
					profileName: 'Gone Girl',
					email: 'gone@example.com',
					sectionIds: []
				}
			],
			total: 1,
			truncated: false
		});
		const all = requestedUrls(fetchImpl);
		expect(all.filter((u) => u.includes('roster_show_real_names'))).toHaveLength(1);
		expect(all.filter((u) => u.includes('admin_member_record'))).toHaveLength(1);
		expect(all.filter((u) => u.includes('_type.string=database'))).toHaveLength(1);
	});

	it('toggle OFF: profile names in BOTH halves, the toggle read spent once, ZERO records reads', async () => {
		listMyProfilesMock.mockImplementation((_cfg: unknown, personId: string) =>
			Promise.resolve(profilesByPerson[personId] ?? [])
		);
		const fetchImpl = makeRealNamesWire({
			active: [{ _id: 'member-1', person: 'person-a' }],
			archived: [{ _id: 'member-9', person: 'person-9' }],
			toggle: false,
			records: [
				{ _id: 'rec-a', person: 'person-a', name: 'Zoe Zed' },
				{ _id: 'rec-9', person: 'person-9', name: 'Real Rita' }
			]
		});
		const { active, inactive } = await loadActiveAndArchivedRosters(cfg, fetchImpl);
		expect(active.items.map((r) => r.name)).toEqual(['Ada Lovelace']);
		expect(inactive.items.map((r) => r.name)).toEqual(['Gone Girl']);
		const all = requestedUrls(fetchImpl);
		expect(all.filter((u) => u.includes('roster_show_real_names'))).toHaveLength(1);
		expect(all.filter((u) => u.includes('admin_member_record'))).toEqual([]);
	});

	it('ACTIVE WINS a memberId collision: a status flip mid-flight puts her in the active half only, never twice in one table', async () => {
		listMyProfilesMock.mockImplementation((_cfg: unknown, personId: string) =>
			Promise.resolve(profilesByPerson[personId] ?? [])
		);
		const fetchImpl = makeRealNamesWire({
			active: [{ _id: 'member-1', person: 'person-a' }],
			archived: [{ _id: 'member-1', person: 'person-a' }],
			toggle: 'absent'
		});
		const { active, inactive } = await loadActiveAndArchivedRosters(cfg, fetchImpl);
		expect(active.items.map((r) => r.memberId)).toEqual(['member-1']);
		expect(inactive.items).toEqual([]);
	});

	it('a short ARCHIVED member read marks the ARCHIVED half only — it says nothing about the active list', async () => {
		listMyProfilesMock.mockImplementation((_cfg: unknown, personId: string) =>
			Promise.resolve(profilesByPerson[personId] ?? [])
		);
		const fetchImpl = vi.fn().mockImplementation((url: string) => {
			const u = String(url);
			if (u.includes('_type.string=member') && u.includes('status.string=archived')) {
				return Promise.resolve(
					json({ count: 812, entities: [{ _id: 'member-9', person: [{ reference: 'person-9' }] }] })
				);
			}
			if (u.includes('_type.string=member')) {
				return Promise.resolve(
					json({ count: 1, entities: [{ _id: 'member-1', person: [{ reference: 'person-a' }] }] })
				);
			}
			return Promise.resolve(json({ entities: [] }));
		});
		const { active, inactive } = await loadActiveAndArchivedRosters(cfg, fetchImpl);
		expect(active.truncated).toBe(false);
		expect(inactive.truncated).toBe(true);
		expect(active.total).toBe(1);
		expect(inactive.total).toBe(812);
	});

	it('a short ACTIVE member read marks the ACTIVE half only — the mirror image', async () => {
		listMyProfilesMock.mockImplementation((_cfg: unknown, personId: string) =>
			Promise.resolve(profilesByPerson[personId] ?? [])
		);
		const fetchImpl = vi.fn().mockImplementation((url: string) => {
			const u = String(url);
			if (u.includes('_type.string=member') && u.includes('status.string=archived')) {
				return Promise.resolve(
					json({ count: 1, entities: [{ _id: 'member-9', person: [{ reference: 'person-9' }] }] })
				);
			}
			if (u.includes('_type.string=member')) {
				return Promise.resolve(
					json({ count: 640, entities: [{ _id: 'member-1', person: [{ reference: 'person-a' }] }] })
				);
			}
			return Promise.resolve(json({ entities: [] }));
		});
		const { active, inactive } = await loadActiveAndArchivedRosters(cfg, fetchImpl);
		expect(active.truncated).toBe(true);
		expect(inactive.truncated).toBe(false);
	});

	it('a short RECORDS read marks BOTH halves — one overlay, one degrade, two lists affected', async () => {
		listMyProfilesMock.mockImplementation((_cfg: unknown, personId: string) =>
			Promise.resolve(profilesByPerson[personId] ?? [])
		);
		const fetchImpl = vi.fn().mockImplementation((url: string) => {
			const u = String(url);
			if (u.includes('_type.string=admin_member_record')) {
				return Promise.resolve(
					json({
						count: 900,
						entities: [
							{ _id: 'rec-a', person: [{ reference: 'person-a' }], name: [{ string: 'Zoe Zed' }] }
						]
					})
				);
			}
			if (u.includes('_type.string=member') && u.includes('status.string=archived')) {
				return Promise.resolve(
					json({ count: 1, entities: [{ _id: 'member-9', person: [{ reference: 'person-9' }] }] })
				);
			}
			if (u.includes('_type.string=member')) {
				return Promise.resolve(
					json({ count: 1, entities: [{ _id: 'member-1', person: [{ reference: 'person-a' }] }] })
				);
			}
			if (u.includes('_type.string=database')) {
				return Promise.resolve(json({ entities: [{ _id: 'db-ent-9' }] }));
			}
			if (u.includes('entity/db-ent-9') && u.includes('roster_show_real_names')) {
				return Promise.resolve(
					json({
						entity: { _id: 'db-ent-9', roster_show_real_names: [{ _id: 'v-toggle', boolean: true }] }
					})
				);
			}
			return Promise.resolve(json({ entities: [] }));
		});
		const { active, inactive } = await loadActiveAndArchivedRosters(cfg, fetchImpl);
		expect(active.items.map((r) => r.name)).toEqual(['Zoe Zed']);
		expect(active.truncated).toBe(true);
		expect(inactive.truncated).toBe(true);
	});
});

// (*MVOX:Tallis*)
// (*MVOX:Josquin*)
// (*MVOX:Palestrina*)
