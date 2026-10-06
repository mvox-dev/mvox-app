// Every producer of member names obeys the collective's real-names setting.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetTypeIdCache, type EntuCfg } from '$lib/seasons/entuSeasons';
import { loadRoster, type RosterRow } from './rosterData';
import * as rosterDataModule from './rosterData';
import { json, testCfg } from '$lib/testing/entuFetchKit';

const cfg = testCfg('testdb');
const DB_ENTITY = 'db-ent-1';

type RealNameRow = RosterRow & { profileName: string };

function rawProfile(sharing: string, name: string, email = '', id = `prof-${sharing}`) {
	return {
		_id: id,
		name: name ? [{ string: name }] : undefined,
		email: email ? [{ string: email }] : undefined,
		_sharing: [{ string: sharing }]
	};
}

type WireRecord = { _id: string; person?: string; name?: string };

function makeFetch(opts: {
	members?: Array<{ _id: string; person: string }>;
	profilesByPerson?: Record<string, unknown[]>;
	toggle?: boolean | 'absent';
	records?: WireRecord[];
	toggleStatus?: number;
	recordsStatus?: number;
}) {
	const {
		members = [],
		profilesByPerson = {},
		toggle = 'absent',
		records = [],
		toggleStatus = 200,
		recordsStatus = 200
	} = opts;
	return vi.fn().mockImplementation((url: string) => {
		const u = String(url);
		if (u.includes('_type.string=admin_member_record')) {
			if (recordsStatus !== 200) return Promise.resolve(json({}, recordsStatus));
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
		if (u.includes('_type.string=member')) {
			return Promise.resolve(
				json({
					entities: members.map((m) => ({ _id: m._id, person: [{ reference: m.person }] }))
				})
			);
		}
		if (u.includes('_type.string=database')) {
			return Promise.resolve(json({ entities: [{ _id: DB_ENTITY }] }));
		}
		if (u.includes(`entity/${DB_ENTITY}`) && u.includes('roster_show_real_names')) {
			if (toggleStatus !== 200) return Promise.resolve(json({}, toggleStatus));
			return Promise.resolve(
				json({
					entity: {
						_id: DB_ENTITY,
						...(toggle === 'absent'
							? {}
							: { roster_show_real_names: [{ _id: 'v-toggle', boolean: toggle }] })
					}
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

function urls(fetchImpl: ReturnType<typeof vi.fn>): string[] {
	return (fetchImpl.mock.calls as Array<[unknown]>).map((c) => String(c[0]));
}

beforeEach(() => {
	resetTypeIdCache();
});

describe('#469 loadRoster — resolution rule: toggle AND non-empty record name, otherwise the profile name exactly as today', () => {
	it('toggle ON + a record with a non-empty name → row.name IS the record name; the profile name still travels as row.profileName (SectionPicker keeps it)', async () => {
		const fetchImpl = makeFetch({
			members: [{ _id: 'member-1', person: 'person-a' }],
			profilesByPerson: { 'person-a': [rawProfile('domain', 'Ada Lovelace', 'ada@example.com')] },
			toggle: true,
			records: [{ _id: 'rec-1', person: 'person-a', name: 'Zoe Zed' }]
		});
		const rows = (await loadRoster(cfg, fetchImpl)).items as RealNameRow[];
		expect(rows).toEqual([
			{
				memberId: 'member-1',
				personId: 'person-a',
				name: 'Zoe Zed',
				profileName: 'Ada Lovelace',
				email: 'ada@example.com',
				sectionIds: [],
				ownerIds: []
			}
		]);
	});

	it('FALLBACK SILENT AND COMPLETE: mixed rows — no record, an empty record name, and a whitespace-only record name ALL fall back to the profile name; nothing else about the row differs', async () => {
		const fetchImpl = makeFetch({
			members: [
				{ _id: 'member-a', person: 'person-a' },
				{ _id: 'member-b', person: 'person-b' },
				{ _id: 'member-c', person: 'person-c' },
				{ _id: 'member-d', person: 'person-d' }
			],
			profilesByPerson: {
				'person-a': [rawProfile('domain', 'Ada Lovelace', 'ada@example.com')],
				'person-b': [rawProfile('domain', 'Bella Boone', 'bella@example.com')],
				'person-c': [rawProfile('domain', 'Cora Crane', 'cora@example.com')],
				'person-d': [rawProfile('domain', 'Dora Dunn', 'dora@example.com')]
			},
			toggle: true,
			records: [
				{ _id: 'rec-a', person: 'person-a', name: 'Zoe Zed' },
				{ _id: 'rec-c', person: 'person-c', name: '' },
				{ _id: 'rec-d', person: 'person-d', name: '   ' }
			]
		});
		const rows = (await loadRoster(cfg, fetchImpl)).items as RealNameRow[];
		expect(rows).toEqual([
			{
				memberId: 'member-b',
				personId: 'person-b',
				name: 'Bella Boone',
				profileName: 'Bella Boone',
				email: 'bella@example.com',
				sectionIds: [],
				ownerIds: []
			},
			{
				memberId: 'member-c',
				personId: 'person-c',
				name: 'Cora Crane',
				profileName: 'Cora Crane',
				email: 'cora@example.com',
				sectionIds: [],
				ownerIds: []
			},
			{
				memberId: 'member-d',
				personId: 'person-d',
				name: 'Dora Dunn',
				profileName: 'Dora Dunn',
				email: 'dora@example.com',
				sectionIds: [],
				ownerIds: []
			},
			{
				memberId: 'member-a',
				personId: 'person-a',
				name: 'Zoe Zed',
				profileName: 'Ada Lovelace',
				email: 'ada@example.com',
				sectionIds: [],
				ownerIds: []
			}
		]);
	});

	it('SORTING follows the DISPLAYED name: a fixture where real-name order differs from profile-name order comes back in displayed order', async () => {
		const fetchImpl = makeFetch({
			members: [
				{ _id: 'member-a', person: 'person-a' },
				{ _id: 'member-b', person: 'person-b' }
			],
			profilesByPerson: {
				'person-a': [rawProfile('domain', 'Anna Aas')],
				'person-b': [rawProfile('domain', 'Berta Kask')]
			},
			toggle: true,
			records: [{ _id: 'rec-a', person: 'person-a', name: 'Zoe Zed' }]
		});
		const rows = (await loadRoster(cfg, fetchImpl)).items;
		expect(rows.map((r) => r.name)).toEqual(['Berta Kask', 'Zoe Zed']);
	});
});

describe('#469 loadRoster — toggle read and the toggle-off negative', () => {
	it('TOGGLE OFF (boolean false): profile names everywhere, records present server-side notwithstanding — and NO admin_member_record request is issued AT ALL; the toggle itself IS read, exactly once', async () => {
		const fetchImpl = makeFetch({
			members: [{ _id: 'member-1', person: 'person-a' }],
			profilesByPerson: { 'person-a': [rawProfile('domain', 'Ada Lovelace', 'ada@example.com')] },
			toggle: false,
			records: [{ _id: 'rec-1', person: 'person-a', name: 'Zoe Zed' }]
		});
		const rows = (await loadRoster(cfg, fetchImpl)).items as RealNameRow[];
		expect(rows).toEqual([
			{
				memberId: 'member-1',
				personId: 'person-a',
				name: 'Ada Lovelace',
				profileName: 'Ada Lovelace',
				email: 'ada@example.com',
				sectionIds: [],
				ownerIds: []
			}
		]);
		const all = urls(fetchImpl);
		expect(all.filter((u) => u.includes('admin_member_record'))).toEqual([]);
		expect(all.filter((u) => u.includes(`entity/${DB_ENTITY}`) && u.includes('props=roster_show_real_names'))).toHaveLength(1);
	});

	it('TOGGLE ABSENT (key entirely missing from the entity JSON, the unset default) → parsed ?.[0]?.boolean ?? false → identical to toggle off: profile names, one toggle read, no records fetch', async () => {
		const fetchImpl = makeFetch({
			members: [{ _id: 'member-1', person: 'person-a' }],
			profilesByPerson: { 'person-a': [rawProfile('domain', 'Ada Lovelace', 'ada@example.com')] },
			toggle: 'absent',
			records: [{ _id: 'rec-1', person: 'person-a', name: 'Zoe Zed' }]
		});
		const rows = (await loadRoster(cfg, fetchImpl)).items;
		expect(rows.map((r) => r.name)).toEqual(['Ada Lovelace']);
		const all = urls(fetchImpl);
		expect(all.filter((u) => u.includes('admin_member_record'))).toEqual([]);
		expect(all.filter((u) => u.includes(`entity/${DB_ENTITY}`) && u.includes('props=roster_show_real_names'))).toHaveLength(1);
	});
});

describe('#469 loadRoster — the records read: ONE bulk query, narrow projection, client-side join', () => {
	const threeMembers = {
		members: [
			{ _id: 'member-a', person: 'person-a' },
			{ _id: 'member-b', person: 'person-b' },
			{ _id: 'member-c', person: 'person-c' }
		],
		profilesByPerson: {
			'person-a': [rawProfile('domain', 'Ada Lovelace', 'ada@example.com')],
			'person-b': [rawProfile('domain', 'Bella Boone', 'bella@example.com')],
			'person-c': [rawProfile('domain', 'Cora Crane', 'cora@example.com')]
		}
	};

	it('toggle ON → exactly ONE admin_member_record query for the whole roster (the listSections one-fetch idiom, joined client-side by person) — never one per member', async () => {
		const fetchImpl = makeFetch({
			...threeMembers,
			toggle: true,
			records: [
				{ _id: 'rec-a', person: 'person-a', name: 'Zoe Zed' },
				{ _id: 'rec-c', person: 'person-c', name: 'Mara Moon' }
			]
		});
		const rows = (await loadRoster(cfg, fetchImpl)).items;
		const recordUrls = urls(fetchImpl).filter((u) => u.includes('admin_member_record'));
		expect(recordUrls).toHaveLength(1);
		const u = recordUrls[0];
		expect(u).toContain('_type.string=admin_member_record');
		expect(u).toMatch(/props=person,name(&|$)/);
		expect(u).toContain('limit=500');
		expect(rows.map((r) => [r.memberId, r.name])).toEqual([
			['member-b', 'Bella Boone'],
			['member-c', 'Mara Moon'],
			['member-a', 'Zoe Zed']
		]);
	});

	it('INCIDENTAL-EXPOSURE FENCE (PO-ruled, unchanged by #469): no request URL ever projects phone/birthdate, and the admin_member_record query projects EXACTLY person,name — never email either', async () => {
		const fetchImpl = makeFetch({
			...threeMembers,
			toggle: true,
			records: [{ _id: 'rec-a', person: 'person-a', name: 'Zoe Zed' }]
		});
		await loadRoster(cfg, fetchImpl);
		const all = urls(fetchImpl);
		for (const u of all) {
			expect(u).not.toMatch(/props=[^&]*\b(phone|birthdate|notes|idcode|id_code)\b/);
		}
		const recordUrls = all.filter((u) => u.includes('admin_member_record'));
		expect(recordUrls).toHaveLength(1);
		expect(recordUrls[0]).toMatch(/props=person,name(&|$)/);
		expect(recordUrls[0]).not.toMatch(/props=[^&]*\bemail\b/);
	});

	it('join is by person ?.[0]?.reference: a record with NO person value and a record whose person is not on the roster are both ignored silently — no throw, no misjoin', async () => {
		const fetchImpl = makeFetch({
			members: [{ _id: 'member-a', person: 'person-a' }],
			profilesByPerson: {
				'person-a': [rawProfile('domain', 'Ada Lovelace', 'ada@example.com')]
			},
			toggle: true,
			records: [
				{ _id: 'rec-orphan', name: 'No Person Ref' },
				{ _id: 'rec-stranger', person: 'person-zz', name: 'Not A Member' },
				{ _id: 'rec-a', person: 'person-a', name: 'Zoe Zed' }
			]
		});
		const rows = (await loadRoster(cfg, fetchImpl)).items;
		expect(rows.map((r) => r.name)).toEqual(['Zoe Zed']);
	});

	it('MORE THAN ONE record for the same person → the overlay REFUSES TO GUESS: that row shows the PROFILE name (never an arbitrary server-order pick), silently and completely, while her single-record neighbour still shows hers', async () => {
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const fetchImpl = makeFetch({
			...threeMembers,
			toggle: true,
			records: [
				{ _id: 'rec-a1', person: 'person-a', name: 'First Wins' },
				{ _id: 'rec-a2', person: 'person-a', name: 'Second Wins' },
				{ _id: 'rec-b', person: 'person-b', name: 'Mara Moon' }
			]
		});
		const rows = (await loadRoster(cfg, fetchImpl)).items as RealNameRow[];
		expect(rows.map((r) => [r.memberId, r.name])).toEqual([
			['member-a', 'Ada Lovelace'],
			['member-c', 'Cora Crane'],
			['member-b', 'Mara Moon']
		]);
		const dup = rows.find((r) => r.memberId === 'member-a')!;
		expect(dup.profileName).toBe('Ada Lovelace');
		expect(dup.name).toBe(dup.profileName);
		expect(errorSpy).not.toHaveBeenCalled();
		expect(warnSpy).not.toHaveBeenCalled();
		errorSpy.mockRestore();
		warnSpy.mockRestore();
	});

	it('a THIRD record for the same person does not resurrect her: still the profile name (the drop is not re-set by a later duplicate)', async () => {
		const fetchImpl = makeFetch({
			...threeMembers,
			toggle: true,
			records: [
				{ _id: 'rec-a1', person: 'person-a', name: 'First' },
				{ _id: 'rec-a2', person: 'person-a', name: 'Second' },
				{ _id: 'rec-a3', person: 'person-a', name: 'Third' }
			]
		});
		const rows = (await loadRoster(cfg, fetchImpl)).items;
		expect(rows.map((r) => [r.memberId, r.name])).toEqual([
			['member-a', 'Ada Lovelace'],
			['member-b', 'Bella Boone'],
			['member-c', 'Cora Crane']
		]);
	});

	it('the completeness gate stays PROFILE-only: a member with NO visible (domain/public) profile name stays OFF the roster even though a named record exists (pinned; design note for the live round)', async () => {
		const fetchImpl = makeFetch({
			members: [
				{ _id: 'member-a', person: 'person-a' },
				{ _id: 'member-b', person: 'person-b' }
			],
			profilesByPerson: {
				'person-a': [rawProfile('private', 'Hidden Name', 'hidden@example.com')],
				'person-b': [rawProfile('domain', 'Bella Boone', 'bella@example.com')]
			},
			toggle: true,
			records: [
				{ _id: 'rec-a', person: 'person-a', name: 'Zoe Zed' },
				{ _id: 'rec-b', person: 'person-b', name: 'Mara Moon' }
			]
		});
		const rows = (await loadRoster(cfg, fetchImpl)).items;
		expect(rows.map((r) => [r.memberId, r.name])).toEqual([['member-b', 'Mara Moon']]);
	});
});

describe('#469 loadRoster — a failing overlay degrades to profile names, loudly', () => {
	it('the TOGGLE read answers 500: the base roster comes back INTACT with profile names in BOTH name and profileName, no records request is ever issued, and the degrade is logged', async () => {
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const fetchImpl = makeFetch({
			members: [
				{ _id: 'member-a', person: 'person-a' },
				{ _id: 'member-b', person: 'person-b' }
			],
			profilesByPerson: {
				'person-a': [rawProfile('domain', 'Ada Lovelace', 'ada@example.com')],
				'person-b': [rawProfile('domain', 'Bella Boone', 'bella@example.com')]
			},
			toggle: true,
			records: [{ _id: 'rec-a', person: 'person-a', name: 'Zoe Zed' }],
			toggleStatus: 500
		});
		const rows = (await loadRoster(cfg, fetchImpl)).items as RealNameRow[];
		expect(rows).toEqual([
			{
				memberId: 'member-a',
				personId: 'person-a',
				name: 'Ada Lovelace',
				profileName: 'Ada Lovelace',
				email: 'ada@example.com',
				sectionIds: [],
				ownerIds: []
			},
			{
				memberId: 'member-b',
				personId: 'person-b',
				name: 'Bella Boone',
				profileName: 'Bella Boone',
				email: 'bella@example.com',
				sectionIds: [],
				ownerIds: []
			}
		]);
		expect(urls(fetchImpl).filter((u) => u.includes('admin_member_record'))).toEqual([]);
		expect(errorSpy).toHaveBeenCalledWith(
			'roster: loading the real-names overlay failed',
			expect.any(Error)
		);
		errorSpy.mockRestore();
	});

	it('the RECORDS read answers 500 with the toggle ON: same intact profile-name roster, the one records request WAS attempted, and the degrade is logged', async () => {
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const fetchImpl = makeFetch({
			members: [
				{ _id: 'member-a', person: 'person-a' },
				{ _id: 'member-b', person: 'person-b' }
			],
			profilesByPerson: {
				'person-a': [rawProfile('domain', 'Ada Lovelace', 'ada@example.com')],
				'person-b': [rawProfile('domain', 'Bella Boone', 'bella@example.com')]
			},
			toggle: true,
			records: [{ _id: 'rec-a', person: 'person-a', name: 'Zoe Zed' }],
			recordsStatus: 500
		});
		const rows = (await loadRoster(cfg, fetchImpl)).items as RealNameRow[];
		expect(rows).toEqual([
			{
				memberId: 'member-a',
				personId: 'person-a',
				name: 'Ada Lovelace',
				profileName: 'Ada Lovelace',
				email: 'ada@example.com',
				sectionIds: [],
				ownerIds: []
			},
			{
				memberId: 'member-b',
				personId: 'person-b',
				name: 'Bella Boone',
				profileName: 'Bella Boone',
				email: 'bella@example.com',
				sectionIds: [],
				ownerIds: []
			}
		]);
		expect(urls(fetchImpl).filter((u) => u.includes('admin_member_record'))).toHaveLength(1);
		expect(errorSpy).toHaveBeenCalledWith(
			'roster: loading the real-names overlay failed',
			expect.any(Error)
		);
		errorSpy.mockRestore();
	});
});

describe('#469 loadRoster (shared producer) — obeys roster_show_real_names (supersedes the #269 roster-only ruling)', () => {
	it('toggle ON with named records on the wire: REAL names on the rows, profileName untouched, and exactly ONE toggle GET + ONE records GET for the whole load', async () => {
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const fetchImpl = makeFetch({
			members: [
				{ _id: 'member-a', person: 'person-a' },
				{ _id: 'member-b', person: 'person-b' }
			],
			profilesByPerson: {
				'person-a': [rawProfile('domain', 'Ada Lovelace', 'ada@example.com')],
				'person-b': [rawProfile('domain', 'Bella Boone', 'bella@example.com')]
			},
			toggle: true,
			records: [
				{ _id: 'rec-a', person: 'person-a', name: 'Zoe Zed' },
				{ _id: 'rec-b', person: 'person-b', name: 'Aaron Aardvark' }
			]
		});
		const rows = (await loadRoster(cfg, fetchImpl)).items as RealNameRow[];
		expect(rows).toEqual([
			{
				memberId: 'member-b',
				personId: 'person-b',
				name: 'Aaron Aardvark',
				profileName: 'Bella Boone',
				email: 'bella@example.com',
				sectionIds: [],
				ownerIds: []
			},
			{
				memberId: 'member-a',
				personId: 'person-a',
				name: 'Zoe Zed',
				profileName: 'Ada Lovelace',
				email: 'ada@example.com',
				sectionIds: [],
				ownerIds: []
			}
		]);
		const requested = urls(fetchImpl);
		expect(requested.filter((u) => u.includes('admin_member_record'))).toHaveLength(1);
		expect(
			requested.filter((u) => u.includes(`entity/${DB_ENTITY}`) && u.includes('props=roster_show_real_names'))
		).toHaveLength(1);
		expect(errorSpy).not.toHaveBeenCalled();
		errorSpy.mockRestore();
	});

	it('EMPTY roster → the toggle read is never spent: zero database resolves, zero toggle GETs, zero records GETs', async () => {
		const fetchImpl = makeFetch({
			members: [],
			toggle: true,
			records: [{ _id: 'rec-a', person: 'person-a', name: 'Zoe Zed' }]
		});
		const read = await loadRoster(cfg, fetchImpl);
		expect(read.items).toEqual([]);
		const requested = urls(fetchImpl);
		expect(requested.filter((u) => u.includes('_type.string=database'))).toEqual([]);
		expect(requested.filter((u) => u.includes('roster_show_real_names'))).toEqual([]);
		expect(requested.filter((u) => u.includes('admin_member_record'))).toEqual([]);
	});

	it('ONE producer: `loadRosterWithRealNames` is GONE — the opt-in fork #269 built (and #469 retires) no longer exports, so no caller can sit outside the setting', () => {
		expect('loadRosterWithRealNames' in rosterDataModule).toBe(false);
	});
});

// (*MVOX:Tallis*)
// (*MVOX:Palestrina*)
