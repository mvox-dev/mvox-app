// The roster's member reads say when a list is partial, from the server count.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetTypeIdCache, type EntuCfg } from '$lib/seasons/entuSeasons';
import { listActiveMembers, loadRoster } from './rosterData';
import { listInactiveMembers, loadInactiveRoster } from './memberLifecycle';
import { json, testCfg } from '$lib/testing/entuFetchKit';

const cfg = testCfg('testdb');
const DB_ENTITY = 'db-ent-1';

function domainProfile(name: string, id = 'prof-1') {
	return { _id: id, name: [{ string: name }], _sharing: [{ string: 'domain' }] };
}

function makeFetch(opts: {
	members?: Array<{ _id: string; person: string }>;
	memberCount?: number;
	profilesByPerson?: Record<string, unknown[]>;
	toggle?: boolean;
	records?: Array<{ _id: string; person?: string; name?: string }>;
	recordCount?: number;
}) {
	const {
		members = [],
		memberCount,
		profilesByPerson = {},
		toggle = false,
		records = [],
		recordCount
	} = opts;
	return vi.fn().mockImplementation((url: string) => {
		const u = String(url);
		if (u.includes('_type.string=admin_member_record')) {
			return Promise.resolve(
				json({
					...(recordCount === undefined ? {} : { count: recordCount }),
					entities: records.map((r) => ({
						_id: r._id,
						...(r.person !== undefined ? { person: [{ reference: r.person }] } : {}),
						...(r.name !== undefined ? { name: [{ string: r.name }] } : {})
					}))
				})
			);
		}
		if (u.includes('_type.string=member')) {
			return Promise.resolve(
				json({
					...(memberCount === undefined ? {} : { count: memberCount }),
					entities: members.map((m) => ({ _id: m._id, person: [{ reference: m.person }] }))
				})
			);
		}
		if (u.includes('_type.string=database')) {
			return Promise.resolve(json({ entities: [{ _id: DB_ENTITY }] }));
		}
		if (u.includes(`entity/${DB_ENTITY}`) && u.includes('roster_show_real_names')) {
			return Promise.resolve(
				json({
					entity: { _id: DB_ENTITY, roster_show_real_names: [{ _id: 'v-t', boolean: toggle }] }
				})
			);
		}
		if (u.includes('_type.string=profile')) {
			const match = /_parent\.reference=([^&]+)/.exec(u);
			const personId = match ? decodeURIComponent(match[1]) : '';
			return Promise.resolve(json({ entities: profilesByPerson[personId] ?? [] }));
		}
		return Promise.resolve(json({ entities: [] }));
	});
}

beforeEach(() => {
	resetTypeIdCache();
});

describe('listActiveMembers — count-based truncation detection (#321)', () => {
	it('count > entities.length → truncated, full shape, ONE request', async () => {
		const fetchImpl = makeFetch({
			members: [{ _id: 'member-1', person: 'person-a' }],
			memberCount: 640
		});
		expect(await listActiveMembers(cfg, fetchImpl)).toEqual({
			items: [
				{
					memberId: 'member-1',
					personId: 'person-a',
					sectionIds: [],
					dbEntityId: undefined,
					ownerIds: []
				}
			],
			total: 640,
			truncated: true
		});
		expect(fetchImpl).toHaveBeenCalledTimes(1);
		const url = String(fetchImpl.mock.calls[0][0]);
		expect(url).toContain('_type.string=member');
		expect(url).toContain('status.string=active');
		expect(url).toContain('limit=500');
		expect(url).not.toContain('skip=');
	});

	it('count === entities.length → complete', async () => {
		const fetchImpl = makeFetch({
			members: [{ _id: 'member-1', person: 'person-a' }],
			memberCount: 1
		});
		expect(await listActiveMembers(cfg, fetchImpl)).toEqual({
			items: [
				{
					memberId: 'member-1',
					personId: 'person-a',
					sectionIds: [],
					dbEntityId: undefined,
					ownerIds: []
				}
			],
			total: 1,
			truncated: false
		});
	});

	it('NO count at all → complete, total falls back to the wire length (never a false partial)', async () => {
		const fetchImpl = makeFetch({ members: [{ _id: 'member-1', person: 'person-a' }] });
		expect(await listActiveMembers(cfg, fetchImpl)).toEqual({
			items: [
				{
					memberId: 'member-1',
					personId: 'person-a',
					sectionIds: [],
					dbEntityId: undefined,
					ownerIds: []
				}
			],
			total: 1,
			truncated: false
		});
	});
});

describe('listInactiveMembers / loadInactiveRoster — the archived-member panel (#321)', () => {
	it('count > entities.length → truncated', async () => {
		const fetchImpl = makeFetch({
			members: [{ _id: 'member-9', person: 'person-z' }],
			memberCount: 812
		});
		expect(await listInactiveMembers(cfg, fetchImpl)).toEqual({
			items: [{ memberId: 'member-9', personId: 'person-z', sectionIds: [], dbEntityId: undefined }],
			total: 812,
			truncated: true
		});
		expect(String(fetchImpl.mock.calls[0][0])).toContain('status.string=archived');
	});

	it('loadInactiveRoster carries the flag through, and the #28 gate never fabricates one', async () => {
		const fetchImpl = makeFetch({
			members: [
				{ _id: 'member-9', person: 'person-z' },
				{ _id: 'member-8', person: 'person-y' } // no profile name → dropped by #28
			],
			memberCount: 812,
			profilesByPerson: { 'person-z': [domainProfile('Zoe Zed')] }
		});
		const read = await loadInactiveRoster(cfg, fetchImpl);
		expect(read.items.map((r) => r.name)).toEqual(['Zoe Zed']);
		expect(read.total).toBe(812);
		expect(read.truncated).toBe(true);
	});

	it('a complete archived read whose rows the #28 gate drops is NOT truncated', async () => {
		const fetchImpl = makeFetch({
			members: [{ _id: 'member-8', person: 'person-y' }],
			memberCount: 1
		});
		expect(await loadInactiveRoster(cfg, fetchImpl)).toEqual({
			items: [],
			total: 1,
			truncated: false
		});
	});
});

describe('loadRoster — the shared producer REPORTS the flag (#321)', () => {
	it('reports truncated, with the member read\'s own count as total', async () => {
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const fetchImpl = makeFetch({
			members: [{ _id: 'member-1', person: 'person-a' }],
			memberCount: 640,
			profilesByPerson: { 'person-a': [domainProfile('Ada Lovelace')] }
		});
		const read = await loadRoster(cfg, fetchImpl);
		expect(read.truncated).toBe(true);
		expect(read.total).toBe(640);
		expect(read.items.map((r) => r.name)).toEqual(['Ada Lovelace']);
		expect(warnSpy).not.toHaveBeenCalled();
		warnSpy.mockRestore();
	});

	it('a complete read reports truncated false', async () => {
		const read = await loadRoster(
			cfg,
			makeFetch({
				members: [{ _id: 'member-1', person: 'person-a' }],
				memberCount: 1,
				profilesByPerson: { 'person-a': [domainProfile('Ada Lovelace')] }
			})
		);
		expect(read.truncated).toBe(false);
		expect(read.total).toBe(1);
	});
});

describe('loadRoster — the shared producer reports both reads (#321; overlay folded in by #469)', () => {
	it('a truncated MEMBER read → truncated, total is that read\'s count', async () => {
		const read = await loadRoster(
			cfg,
			makeFetch({
				members: [{ _id: 'member-1', person: 'person-a' }],
				memberCount: 640,
				profilesByPerson: { 'person-a': [domainProfile('Ada Lovelace')] }
			})
		);
		expect(read.items.map((r) => r.name)).toEqual(['Ada Lovelace']);
		expect(read.total).toBe(640);
		expect(read.truncated).toBe(true);
	});

	it('a truncated RECORDS read → truncated, even though the member read is complete (the overlay silently reverts rows to profile names)', async () => {
		const read = await loadRoster(
			cfg,
			makeFetch({
				members: [{ _id: 'member-1', person: 'person-a' }],
				memberCount: 1,
				profilesByPerson: { 'person-a': [domainProfile('Ada Lovelace')] },
				toggle: true,
				records: [{ _id: 'rec-1', person: 'person-a', name: 'Zoe Zed' }],
				recordCount: 900
			})
		);
		expect(read.items.map((r) => r.name)).toEqual(['Zoe Zed']);
		expect(read.total).toBe(1);
		expect(read.truncated).toBe(true);
	});

	it('toggle OFF fires no records read at all, so nothing there can raise the flag', async () => {
		const fetchImpl = makeFetch({
			members: [{ _id: 'member-1', person: 'person-a' }],
			memberCount: 1,
			profilesByPerson: { 'person-a': [domainProfile('Ada Lovelace')] },
			toggle: false,
			records: [{ _id: 'rec-1', person: 'person-a', name: 'Zoe Zed' }],
			recordCount: 900
		});
		const read = await loadRoster(cfg, fetchImpl);
		expect(read.truncated).toBe(false);
		const requested = (fetchImpl.mock.calls as Array<[unknown]>).map((c) => String(c[0]));
		expect(requested.some((u) => u.includes('_type.string=admin_member_record'))).toBe(false);
	});

	it('the orphan/duplicate drops in the records join never fabricate a truncation (RAW wire length, not map size)', async () => {
		const read = await loadRoster(
			cfg,
			makeFetch({
				members: [{ _id: 'member-1', person: 'person-a' }],
				memberCount: 1,
				profilesByPerson: { 'person-a': [domainProfile('Ada Lovelace')] },
				toggle: true,
				records: [
					{ _id: 'rec-orphan', name: 'Nobody' },
					{ _id: 'rec-1', person: 'person-a', name: 'Zoe Zed' },
					{ _id: 'rec-2', person: 'person-a', name: 'Zoe Zedd' }
				],
				recordCount: 3
			})
		);
		expect(read.items.map((r) => r.name)).toEqual(['Ada Lovelace']);
		expect(read.truncated).toBe(false);
	});

	it('NO presentable member and a truncated read → the flag still travels (the notice matters most here)', async () => {
		const read = await loadRoster(
			cfg,
			makeFetch({
				members: [{ _id: 'member-8', person: 'person-y' }], // no profile name → #28 drops her
				memberCount: 640
			})
		);
		expect(read.items).toEqual([]);
		expect(read.truncated).toBe(true);
	});

	it('a failed records read degrades to profile names and reports NOTHING about its own completeness', async () => {
		const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const fetchImpl = vi.fn().mockImplementation((url: string) => {
			const u = String(url);
			if (u.includes('_type.string=admin_member_record')) return Promise.resolve(json({}, 500));
			if (u.includes('_type.string=member'))
				return Promise.resolve(
					json({ count: 1, entities: [{ _id: 'member-1', person: [{ reference: 'person-a' }] }] })
				);
			if (u.includes('_type.string=database')) return Promise.resolve(json({ entities: [{ _id: DB_ENTITY }] }));
			if (u.includes(`entity/${DB_ENTITY}`))
				return Promise.resolve(
					json({
						entity: { _id: DB_ENTITY, roster_show_real_names: [{ _id: 'v-t', boolean: true }] }
					})
				);
			if (u.includes('_type.string=profile'))
				return Promise.resolve(json({ entities: [domainProfile('Ada Lovelace')] }));
			return Promise.resolve(json({ entities: [] }));
		});
		const read = await loadRoster(cfg, fetchImpl);
		expect(read.items.map((r) => r.name)).toEqual(['Ada Lovelace']);
		expect(read.truncated).toBe(false);
		expect(errSpy).toHaveBeenCalled();
		errSpy.mockRestore();
	});
});

// (*MVOX:Josquin*)
