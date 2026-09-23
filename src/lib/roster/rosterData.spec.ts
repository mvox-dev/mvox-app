import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetTypeIdCache, type EntuCfg } from '$lib/seasons/entuSeasons';
import type { MyProfile } from '$lib/profile/profileData';
import {
	listActiveMembers,
	listProfilesForPerson,
	toRosterRow,
	loadRoster,
	type ActiveMember,
	type RosterRow
} from './rosterData';

// T3.2/#18 RED — the roster data layer. `rosterData.ts`'s exports are stubs that
// throw 'not implemented', so every assertion below FAILS until Josquin's GREEN.
//
// HARD RULE under test throughout: NO client-side privacy-boundary filtering. The
// server (entu-api Gate A/B) is what keeps a private-tier profile entity from ever
// reaching `listProfilesForPerson`'s caller — this file asserts the QUERY SHAPE never
// requests private-tier fields (the honest unit-level proxy for that server-side
// property; the boundary itself needs live Entu, deferred to T3.4) and that
// `toRosterRow`/`loadRoster` never add a defensive `_sharing !== 'private'` branch of
// their own (test 14 proves the opposite — resolveField has zero independent defense
// and that is BY DESIGN, not a bug to "fix" with a client filter).

const cfg: EntuCfg = { db: 'testdb', token: 'jwt' };

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), { status });
}

function profile(sharing: MyProfile['_sharing'], name: string, email = ''): MyProfile {
	return { _id: `p-${sharing}`, name, email, _sharing: sharing };
}

beforeEach(() => {
	resetTypeIdCache();
});

// ── listActiveMembers ──────────────────────────────────────────────────────────
// Lists ALL active members, domain-wide — no person/org scoping (RULED target:
// members are _sharing:'domain'). Widened variant of findMyMemberId's query.

describe('listActiveMembers — lists ALL active members, domain-wide (no person filter)', () => {
	it('happy path — maps member,_parent into ActiveMember[]; a member with no section _parent → sectionIds: []', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(
			json({
				entities: [
					{
						_id: 'member-1',
						person: [{ reference: 'person-a' }],
						_parent: [{ reference: 'sec-sop', entity_type: 'section' }]
					},
					{
						_id: 'member-2',
						person: [{ reference: 'person-b' }],
						_parent: [{ reference: 'org-1', entity_type: 'database' }]
					} // no section among _parent
				]
			})
		);
		const members = await listActiveMembers(cfg, fetchImpl);
		// #161 (collective = database) — dbEntityId now rides along too: member-2's
		// fixture happens to carry a database `_parent`, so she picks one up here
		// even though this test predates that contract (see
		// rosterData.database.spec.ts for the dedicated pins).
		// #321 — the reader returns `{ items, total, truncated }`; the MAPPING is what
		// this file pins, the read shape itself lives in rosterData.truncation.spec.ts.
		expect(members.items).toEqual<ActiveMember[]>([
			{
				memberId: 'member-1',
				personId: 'person-a',
				sectionIds: ['sec-sop'],
				dbEntityId: undefined,
				ownerIds: []
			},
			{ memberId: 'member-2', personId: 'person-b', sectionIds: [], dbEntityId: 'org-1', ownerIds: [] }
		]);
	});

	it('PO ruling 2026-08-11 (#95/#80): sections resolve to the ENTITY IDs of every `_parent` entry that is entity_type=section — never current_section (dropped, dead code)', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(
			json({
				entities: [
					{
						_id: 'member-1',
						person: [{ reference: 'person-a' }],
						_parent: [
							{ reference: 'org-1', entity_type: 'database' },
							{ reference: 'sec-sop', entity_type: 'section' }
						]
					}
				]
			})
		);
		const members = await listActiveMembers(cfg, fetchImpl);
		// TU.1/#109 (finding #10) — dbEntityId rides along (see comment above).
		expect(members.items).toEqual<ActiveMember[]>([
			{
				memberId: 'member-1',
				personId: 'person-a',
				sectionIds: ['sec-sop'],
				dbEntityId: 'org-1',
				ownerIds: []
			}
		]);
	});

	it('F1 code-review fix: a member with MULTIPLE section _parent entries keeps ALL of them, in wire order — not just the first', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(
			json({
				entities: [
					{
						_id: 'member-1',
						person: [{ reference: 'person-a' }],
						_parent: [
							{ reference: 'sec-sop', entity_type: 'section' },
							{ reference: 'org-1', entity_type: 'database' },
							{ reference: 'sec-lead', entity_type: 'section' }
						]
					}
				]
			})
		);
		const members = await listActiveMembers(cfg, fetchImpl);
		// TU.1/#109 (finding #10) — dbEntityId rides along (see comment above).
		expect(members.items).toEqual<ActiveMember[]>([
			{
				memberId: 'member-1',
				personId: 'person-a',
				sectionIds: ['sec-sop', 'sec-lead'],
				dbEntityId: 'org-1',
				ownerIds: []
			}
		]);
	});

	it('URL: _type.string=member, status.string=active, props=person,_parent, explicit limit=500', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(json({ entities: [] }));
		await listActiveMembers(cfg, fetchImpl);
		const url = String(fetchImpl.mock.calls[0][0]);
		expect(url).toContain('_type.string=member');
		expect(url).toContain('status.string=active');
		expect(url).toContain('props=person,_parent');
		expect(url).toContain('limit=500');
	});

	it('regression guard: does NOT scope to one caller — no person.reference= param (that would silently narrow the roster to findMyMemberId\'s single-member query)', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(json({ entities: [] }));
		await listActiveMembers(cfg, fetchImpl);
		const url = String(fetchImpl.mock.calls[0][0]);
		expect(url).not.toContain('person.reference=');
	});

	it('regression guard: does NOT project/filter on member.name — the RULED target member carries no name prop-def (the shipped-but-superseded invite create path still writes one; this query must not revive that shape)', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(json({ entities: [] }));
		await listActiveMembers(cfg, fetchImpl);
		const url = String(fetchImpl.mock.calls[0][0]);
		expect(url).not.toMatch(/\bname\b/);
	});

	it('fails loud on a non-2xx response, with the status surfaced', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(json({}, 500));
		await expect(listActiveMembers(cfg, fetchImpl)).rejects.toThrow(/500/);
	});

	it('#456: a member with an unreadable person reference is SKIPPED — one console.warn naming her member id, healthy rows returned in wire order (full ListRead shape)', async () => {
		// Deleting the person in Entu soft-deletes every property referencing it
		// (entu-www db-mutations), so `person` is genuinely absent on the wire —
		// the row skips (house shape: attendanceData listAttendance, libraryData
		// listLendings), the rest of the roster renders.
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		try {
			const fetchImpl = vi.fn().mockResolvedValue(
				json({
					count: 3,
					entities: [
						{
							_id: 'member-1',
							person: [{ reference: 'person-a' }],
							_parent: [{ reference: 'sec-sop', entity_type: 'section' }]
						},
						{ _id: 'member-orphan' },
						{
							_id: 'member-2',
							person: [{ reference: 'person-b' }],
							_parent: [{ reference: 'org-1', entity_type: 'database' }]
						}
					]
				})
			);
			const read = await listActiveMembers(cfg, fetchImpl);
			// FULL toEqual: the two healthy rows in wire order; `total` stays the
			// server's count (the orphan is still a member the server holds);
			// `truncated` false — deriveListRead keys off the RAW wire length, so a
			// client-side drop can never fabricate a truncation the server never
			// reported.
			expect(read).toEqual({
				items: [
					{
						memberId: 'member-1',
						personId: 'person-a',
						sectionIds: ['sec-sop'],
						dbEntityId: undefined,
						ownerIds: []
					},
					{
						memberId: 'member-2',
						personId: 'person-b',
						sectionIds: [],
						dbEntityId: 'org-1',
						ownerIds: []
					}
				],
				total: 3,
				truncated: false
			});
			// One warning per dropped row per load, naming the member id.
			expect(warn).toHaveBeenCalledTimes(1);
			expect(warn).toHaveBeenCalledWith(expect.stringContaining('member-orphan'));
		} finally {
			warn.mockRestore();
		}
	});

	it('#456: a roster with NO orphaned member is unchanged — exact pre-change output, console.warn never called', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		try {
			const fetchImpl = vi.fn().mockResolvedValue(
				json({
					count: 2,
					entities: [
						{
							_id: 'member-1',
							person: [{ reference: 'person-a' }],
							_parent: [{ reference: 'sec-sop', entity_type: 'section' }]
						},
						{
							_id: 'member-2',
							person: [{ reference: 'person-b' }],
							_parent: [{ reference: 'org-1', entity_type: 'database' }]
						}
					]
				})
			);
			const read = await listActiveMembers(cfg, fetchImpl);
			expect(read).toEqual({
				items: [
					{
						memberId: 'member-1',
						personId: 'person-a',
						sectionIds: ['sec-sop'],
						dbEntityId: undefined,
						ownerIds: []
					},
					{
						memberId: 'member-2',
						personId: 'person-b',
						sectionIds: [],
						dbEntityId: 'org-1',
						ownerIds: []
					}
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

// ── listProfilesForPerson ──────────────────────────────────────────────────────
// Reuse claim: identical wire call to listMyProfiles for the same personId. Proven
// as a pass-through equivalence test, not a reimplementation test.

describe('listProfilesForPerson — reuses listMyProfiles\'s exact query for an arbitrary personId', () => {
	it('issues the identical URL listMyProfiles would (props=name,email,_sharing&limit=10, _parent.reference=<personId>) for another member\'s person id', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(json({ entities: [] }));
		await listProfilesForPerson(cfg, 'other-person-x', fetchImpl);
		const url = String(fetchImpl.mock.calls[0][0]);
		expect(url).toContain('_type.string=profile');
		expect(url).toContain('_parent.reference=other-person-x');
		expect(url).toContain('props=name,email,_sharing');
		expect(url).toMatch(/limit=\d+/);
	});

	it('returns the identically-shaped MyProfile[]', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(
			json({
				entities: [
					{
						_id: 'prof-dom',
						name: [{ string: 'Ada' }],
						email: [{ string: 'ada@example.com' }],
						_sharing: [{ string: 'domain' }]
					}
				]
			})
		);
		const out = await listProfilesForPerson(cfg, 'other-person-x', fetchImpl);
		expect(out).toEqual<MyProfile[]>([
			{ _id: 'prof-dom', name: 'Ada', email: 'ada@example.com', _sharing: 'domain' }
		]);
	});
});

// ── toRosterRow — pure per-member resolver (literal fixtures, no fetch) ──────────

describe('toRosterRow — pure: member + profiles → RosterRow | null', () => {
	const member: ActiveMember = { memberId: 'member-1', personId: 'person-a', sectionIds: [] };

	it('domain profile with name+email → full row (TS.1/#95: sectionIds carried through — [] here)', () => {
		const row = toRosterRow(member, [profile('domain', 'Ada Lovelace', 'ada@example.com')]);
		expect(row).toEqual<RosterRow>({
			memberId: 'member-1',
			personId: 'person-a',
			name: 'Ada Lovelace',
			email: 'ada@example.com',
			sectionIds: []
		});
	});

	it('TS.1/#95, F1: a member\'s sectionIds (section entity ids) are carried onto the row verbatim, including multiple sections', () => {
		const sectioned: ActiveMember = {
			memberId: 'member-1',
			personId: 'person-a',
			sectionIds: ['sec-sop', 'sec-lead']
		};
		const row = toRosterRow(sectioned, [profile('domain', 'Ada Lovelace', 'ada@example.com')]);
		expect(row).toEqual<RosterRow>({
			memberId: 'member-1',
			personId: 'person-a',
			name: 'Ada Lovelace',
			email: 'ada@example.com',
			sectionIds: ['sec-sop', 'sec-lead']
		});
	});

	it('domain name present, email present only at public tier → resolveField picks the public email; row still returned', () => {
		const row = toRosterRow(member, [
			profile('domain', 'Ada Lovelace'),
			profile('public', '', 'ada-public@example.com')
		]);
		expect(row).toEqual<RosterRow>({
			memberId: 'member-1',
			personId: 'person-a',
			name: 'Ada Lovelace',
			email: 'ada-public@example.com',
			sectionIds: []
		});
	});

	it('no profiles at all → null', () => {
		expect(toRosterRow(member, [])).toBeNull();
	});

	it('domain profile present but name is empty or whitespace-only, no public profile → null (matches hasVisibleName\'s .trim() rule)', () => {
		expect(toRosterRow(member, [profile('domain', '')])).toBeNull();
		expect(toRosterRow(member, [profile('domain', '   ')])).toBeNull();
	});

	it('#58: a PUBLIC-only name DOES satisfy the gate (Mihkel ruling) — row uses the public name', () => {
		const row = toRosterRow(member, [profile('public', 'Ada', 'ada@example.com')]);
		expect(row).toEqual<RosterRow>({
			memberId: 'member-1',
			personId: 'person-a',
			name: 'Ada',
			email: 'ada@example.com',
			sectionIds: []
		});
	});

	it('#58: domain name blank but public name present → row uses the public name', () => {
		const row = toRosterRow(member, [
			profile('domain', ''),
			profile('public', 'Ada', 'ada@example.com')
		]);
		expect(row).toEqual<RosterRow>({
			memberId: 'member-1',
			personId: 'person-a',
			name: 'Ada',
			email: 'ada@example.com',
			sectionIds: []
		});
	});

	it('#58: both domain and public names present → domain is preferred for display', () => {
		const row = toRosterRow(member, [
			profile('domain', 'Ada Domain'),
			profile('public', 'Ada Public', 'ada@example.com')
		]);
		expect(row?.name).toBe('Ada Domain');
	});

	it('#58: private-only name does NOT satisfy the gate → null', () => {
		expect(toRosterRow(member, [profile('private', 'Ada', 'leak@x.com')])).toBeNull();
	});

	it('domain name present, no email at any tier → email: \'\'', () => {
		const row = toRosterRow(member, [profile('domain', 'Ada Lovelace')]);
		expect(row).toEqual<RosterRow>({
			memberId: 'member-1',
			personId: 'person-a',
			name: 'Ada Lovelace',
			email: '',
			sectionIds: []
		});
	});

	it('#58: a PUBLIC-only name DOES satisfy the gate — regression guard for the exact widening this issue introduced (superseded the pre-#58 domain-only rule)', () => {
		const row = toRosterRow(member, [profile('public', 'Ada', 'pub@x.com')]);
		expect(row).toEqual<RosterRow>({
			memberId: 'member-1',
			personId: 'person-a',
			name: 'Ada',
			email: 'pub@x.com',
			sectionIds: []
		});
	});

	it('THE SHARP EDGE, stated honestly: a private-tier entity handed to this function (illegitimately — the server should never do this) is NOT independently filtered. resolveField\'s narrower-wins (NARROWNESS: private=0 < domain=1 < public=2) picks the PRIVATE email because it sorts first. This documents that the resolver has ZERO independent defense — safety is 100% server-side (Gate A/B in entu-api). DO NOT "fix" this by adding a client-side `_sharing !== \'private\'` filter here — that would be exactly the forbidden client-side boundary filter the design rules this task out.', () => {
		const row = toRosterRow(member, [
			profile('domain', 'Ada Lovelace', 'domain@x.com'),
			profile('private', 'Ada Lovelace', 'leak@x.com')
		]);
		expect(row?.email).toBe('leak@x.com');
	});
});

// ── loadRoster — orchestration (mocked fetch, branching on URL substring) ───────

describe('loadRoster — list members, fan out per-member profile reads, resolve, drop nameless, sort by name', () => {
	function makeFetchMock(
		members: Array<{ _id: string; person: string }>,
		profilesByPerson: Record<string, unknown[]>
	) {
		return vi.fn().mockImplementation((url: string) => {
			if (url.includes('_type.string=member')) {
				return Promise.resolve(
					json({ entities: members.map((m) => ({ _id: m._id, person: [{ reference: m.person }] })) })
				);
			}
			const match = /_parent\.reference=([^&]+)/.exec(url);
			const personId = match ? decodeURIComponent(match[1]) : '';
			return Promise.resolve(json({ entities: profilesByPerson[personId] ?? [] }));
		});
	}

	function rawProfile(sharing: string, name: string, email = '', id = `prof-${sharing}`) {
		return {
			_id: id,
			name: name ? [{ string: name }] : undefined,
			email: email ? [{ string: email }] : undefined,
			_sharing: [{ string: sharing }]
		};
	}

	it('two active members, one complete + one nameless → result has exactly 1 row, correctly shaped', async () => {
		const fetchImpl = makeFetchMock(
			[
				{ _id: 'member-1', person: 'person-a' },
				{ _id: 'member-2', person: 'person-b' }
			],
			{
				'person-a': [rawProfile('domain', 'Ada Lovelace', 'ada@example.com')],
				'person-b': [] // no domain profile → nameless, excluded
			}
		);
		// #321 — `loadRoster` reports `{ items, total, truncated }` since the PO's
		// reachability ruling (its closed-set picker consumers say the truncation
		// out loud); the row shape below is what `items` carries.
		const rows = (await loadRoster(cfg, fetchImpl)).items;
		expect(rows).toEqual<RosterRow[]>([
			{
				memberId: 'member-1',
				personId: 'person-a',
				name: 'Ada Lovelace',
				// #269 — `loadRoster` now always carries the profile resolution
				// alongside the displayed name (equal here: no real-names overlay
				// wired into this fixture's toggle read).
				profileName: 'Ada Lovelace',
				email: 'ada@example.com',
				sectionIds: [],
				ownerIds: []
			}
		]);
	});

	it('TS.1/#95, F1: a member\'s section _parent entries flow all the way through to the row (the section entity ids groupBySection joins on), including more than one', async () => {
		const fetchImpl = vi.fn().mockImplementation((url: string) => {
			if (url.includes('_type.string=member')) {
				return Promise.resolve(
					json({
						entities: [
							{
								_id: 'member-1',
								person: [{ reference: 'person-a' }],
								_parent: [
									{ reference: 'sec-sop', entity_type: 'section' },
									{ reference: 'sec-lead', entity_type: 'section' }
								]
							}
						]
					})
				);
			}
			return Promise.resolve(
				json({ entities: [rawProfile('domain', 'Ada Lovelace', 'ada@example.com')] })
			);
		});
		// #321 — `loadRoster` reports `{ items, total, truncated }` since the PO's
		// reachability ruling (its closed-set picker consumers say the truncation
		// out loud); the row shape below is what `items` carries.
		const rows = (await loadRoster(cfg, fetchImpl)).items;
		expect(rows).toEqual<RosterRow[]>([
			{
				memberId: 'member-1',
				personId: 'person-a',
				name: 'Ada Lovelace',
				// #269 — see the previous test's note.
				profileName: 'Ada Lovelace',
				email: 'ada@example.com',
				sectionIds: ['sec-sop', 'sec-lead'],
				ownerIds: []
			}
		]);
	});

	it('never fetches private-tier data — no profile-read URL\'s props= param ever contains notes/id_code/birthdate/phone (query-shape proxy for the server-side boundary; live enforcement is T3.4)', async () => {
		const fetchImpl = makeFetchMock(
			[{ _id: 'member-1', person: 'person-a' }],
			{ 'person-a': [rawProfile('domain', 'Ada Lovelace', 'ada@example.com')] }
		);
		await loadRoster(cfg, fetchImpl);
		for (const call of fetchImpl.mock.calls as Array<[string]>) {
			const url = String(call[0]);
			// #285 BLIND-SPOT FIX: the fence named only 'idcode' (no underscore) —
			// but the REAL prop-def shipped by #282 is `id_code`, which that
			// substring never matches, so the fence was blind to the one leak it
			// exists to catch. `id_code` added; `idcode` kept too (belt).
			expect(url).not.toMatch(/props=[^&]*\b(notes|idcode|id_code|birthdate|phone)\b/);
		}
	});

	it('empty active-member list → [] and fetchImpl called exactly once (no profile fetch attempted for zero members)', async () => {
		const fetchImpl = makeFetchMock([], {});
		const rows = (await loadRoster(cfg, fetchImpl)).items;
		expect(rows).toEqual([]);
		expect(fetchImpl).toHaveBeenCalledTimes(1);
	});

	it('a per-member profile-read rejection (member B\'s read 500s) → loadRoster rejects as a whole — no silent partial roster hiding one member\'s read failure', async () => {
		const fetchImpl = vi.fn().mockImplementation((url: string) => {
			if (url.includes('_type.string=member')) {
				return Promise.resolve(
					json({
						entities: [
							{ _id: 'member-1', person: [{ reference: 'person-a' }] },
							{ _id: 'member-2', person: [{ reference: 'person-b' }] }
						]
					})
				);
			}
			if (url.includes('person-b')) return Promise.resolve(json({}, 500));
			return Promise.resolve(json({ entities: [rawProfile('domain', 'Ada Lovelace')] }));
		});
		await expect(loadRoster(cfg, fetchImpl)).rejects.toThrow(/500/);
	});

	it('sort order — 2+ complete members returned alphabetically by name regardless of member-list order', async () => {
		const fetchImpl = makeFetchMock(
			[
				{ _id: 'member-1', person: 'person-zed' },
				{ _id: 'member-2', person: 'person-ann' }
			],
			{
				'person-zed': [rawProfile('domain', 'Zelda')],
				'person-ann': [rawProfile('domain', 'Ann')]
			}
		);
		const read = await loadRoster(cfg, fetchImpl);
		expect(read.items.map((r) => r.name)).toEqual(['Ann', 'Zelda']);
	});

	// ── #268 privacy fence — the member-visible roster load fetches NOTHING new.
	// The module docstring's fence stays true: rosterData is a MEMBER-VISIBLE
	// path, so it must never read the admin's record layer. The `props=`
	// negative assertion above (no notes/idcode/birthdate/phone) is the standing
	// half; these pin the other half — no roster-load request ever names the
	// admin_member_record type at all. (Fence pins: they PASS against the
	// pre-#268 tree by design and guard GREEN from widening the read.)

	it('#268 fence: no roster-load URL ever contains admin_member_record — the admin record layer is a separate, admin-only read', async () => {
		const fetchImpl = makeFetchMock(
			[{ _id: 'member-1', person: 'person-a' }],
			{ 'person-a': [rawProfile('domain', 'Ada Lovelace', 'ada@example.com')] }
		);
		await loadRoster(cfg, fetchImpl);
		expect(fetchImpl.mock.calls.length).toBeGreaterThan(0);
		for (const call of fetchImpl.mock.calls as Array<[string]>) {
			expect(String(call[0])).not.toContain('admin_member_record');
		}
	});

	it('#268 fence: the member-list query still projects exactly props=person,_parent — nothing record-shaped rides along', async () => {
		const fetchImpl = makeFetchMock([], {});
		await loadRoster(cfg, fetchImpl);
		expect(String((fetchImpl.mock.calls as Array<[string]>)[0][0])).toContain(
			'props=person,_parent'
		);
	});
});

// ── #467 — the member's own `_created` stamp rides the SAME list read ─────────
//
// "Not invited since <yyyy-mm-dd>" reads the member record's `_created`, which
// (unlike a regular value's `created` sub-object) DOES embed into the entity
// read when named in `props=` (probe-property-author-filter-2026-09-21, step
// q4a: key set [_id, datetime, entity_type, property_type, reference, string]).
// Only `.datetime` may leave this reader — `.reference` is the AUTHOR, a person
// id with a PII-bearing `.string` alongside (ER-26): dropped at extraction,
// never carried onto the row.

describe('#467 — listActiveMembers requests and threads the member _created stamp', () => {
	it('URL: props widened to person,_parent,_created — the stamp rides the existing read, no extra request', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(json({ entities: [] }));
		await listActiveMembers(cfg, fetchImpl);
		expect(String(fetchImpl.mock.calls[0][0])).toContain('props=person,_parent,_created');
	});

	it('createdAt = _created[0].datetime; the author `.reference` (and its baked `.string`) is NOT present anywhere on the row (ER-26)', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(
			json({
				entities: [
					{
						_id: 'member-1',
						person: [{ reference: 'person-a' }],
						_parent: [{ reference: 'org-1', entity_type: 'database' }],
						_created: [
							{
								_id: 'cr-1',
								datetime: '2026-06-01T09:00:00.000Z',
								reference: 'author-9',
								string: 'Author Name',
								entity_type: 'member',
								property_type: '_created'
							}
						]
					}
				]
			})
		);
		const members = await listActiveMembers(cfg, fetchImpl);
		expect(members.items).toEqual([
			{
				memberId: 'member-1',
				personId: 'person-a',
				sectionIds: [],
				dbEntityId: 'org-1',
				createdAt: '2026-06-01T09:00:00.000Z',
				ownerIds: []
			}
		]);
		const flat = JSON.stringify(members.items);
		expect(flat).not.toContain('author-9');
		expect(flat).not.toContain('Author Name');
	});

	it('missing _created → createdAt undefined — fail-soft per row (no fabrication, no warn, row kept)', async () => {
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const fetchImpl = vi.fn().mockResolvedValue(
			json({
				entities: [{ _id: 'member-1', person: [{ reference: 'person-a' }] }]
			})
		);
		const members = await listActiveMembers(cfg, fetchImpl);
		expect(members.items).toHaveLength(1);
		expect(members.items[0].memberId).toBe('member-1');
		expect((members.items[0] as { createdAt?: string }).createdAt).toBeUndefined();
		expect(warnSpy).not.toHaveBeenCalled();
		warnSpy.mockRestore();
	});

	// #467 review F1 — a non-string `_created[0].datetime` (a JSON `null`) is
	// the same absence: letting it through typed `string` is what reaches the
	// roster's date formatter as `new Date(null)` → a fabricated 1970-01-01.
	it('_created[0].datetime = null (non-string) → createdAt undefined, not a null typed as string', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(
			json({
				entities: [
					{
						_id: 'member-1',
						person: [{ reference: 'person-a' }],
						_created: [{ datetime: null }]
					}
				]
			})
		);
		const members = await listActiveMembers(cfg, fetchImpl);
		expect((members.items[0] as { createdAt?: string }).createdAt).toBeUndefined();
	});
});

describe('#467 — toRosterRow threads createdAt onto the RosterRow verbatim', () => {
	const memberWithStamp = {
		memberId: 'm-1',
		personId: 'p-1',
		sectionIds: [],
		dbEntityId: undefined,
		createdAt: '2026-06-01T09:00:00.000Z'
	} as unknown as ActiveMember;

	it('carries createdAt through', () => {
		const row = toRosterRow(memberWithStamp, [profile('domain', 'Ada', 'a@x.ee')]);
		expect((row as unknown as { createdAt?: string })?.createdAt).toBe(
			'2026-06-01T09:00:00.000Z'
		);
	});

	it('absent on the member → absent on the row (undefined, never a guessed stamp)', () => {
		const bare = {
			memberId: 'm-2',
			personId: 'p-2',
			sectionIds: [],
			dbEntityId: undefined
		} as ActiveMember;
		const row = toRosterRow(bare, [profile('domain', 'Bea', 'b@x.ee')]);
		expect((row as unknown as { createdAt?: string })?.createdAt).toBeUndefined();
	});
});

// ── #468 — the member's own _owner grant rides the list read (picker gate) ─────

describe('#468 — listActiveMembers requests and threads member _owner references (the section-picker gate source)', () => {
	it('URL: props widened to person,_parent,_created,_owner — the gate rides the ONE existing list read, no per-row fetchRights fan-out', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(json({ entities: [] }));
		await listActiveMembers(cfg, fetchImpl);
		expect(String(fetchImpl.mock.calls[0][0])).toContain('props=person,_parent,_created,_owner');
		expect(fetchImpl).toHaveBeenCalledTimes(1);
	});

	it('ownerIds = every _owner `.reference` in wire order, INHERITED values included (a db-level owner holds an inherited _owner on each member — never filtered out); the baked `.string` (PII, ER-26) is NOT present anywhere on the row; full row shape pinned', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(
			json({
				entities: [
					{
						_id: 'member-1',
						person: [{ reference: 'person-a' }],
						_parent: [{ reference: 'org-1', entity_type: 'database' }],
						_created: [{ datetime: '2026-06-01T09:00:00.000Z' }],
						_owner: [
							// Inherited from the database entity — Entu's aggregate view
							// flags it (see fetchRights, roleManagement.ts) but the gate
							// keeps it: an inherited owner may move the member too.
							{ reference: 'person-db-owner', string: 'Olga Owner', inherited: true },
							{ reference: 'person-direct', string: 'Dora Direct' }
						]
					}
				]
			})
		);
		const members = await listActiveMembers(cfg, fetchImpl);
		// FULL toEqual — the partial-assertions-hide-bugs rule: the row carries the
		// references and NOTHING else rode along (no `.string`, no tier objects).
		expect(members.items).toEqual([
			{
				memberId: 'member-1',
				personId: 'person-a',
				sectionIds: [],
				dbEntityId: 'org-1',
				createdAt: '2026-06-01T09:00:00.000Z',
				ownerIds: ['person-db-owner', 'person-direct']
			}
		]);
		const flat = JSON.stringify(members.items);
		expect(flat).not.toContain('Olga Owner');
		expect(flat).not.toContain('Dora Direct');
	});

	it('no _owner in the read (withheld private bucket OR genuinely no grant) → ownerIds: [] — an honest empty list, never undefined, row kept', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(
			json({
				entities: [{ _id: 'member-1', person: [{ reference: 'person-a' }] }]
			})
		);
		const members = await listActiveMembers(cfg, fetchImpl);
		expect(members.items).toHaveLength(1);
		expect(members.items[0].ownerIds).toEqual([]);
	});
});

describe('#468 — ownerIds thread through to the RosterRow verbatim', () => {
	it('toRosterRow carries ownerIds through', () => {
		const member = {
			memberId: 'm-1',
			personId: 'p-1',
			sectionIds: [],
			dbEntityId: undefined,
			ownerIds: ['person-db-owner', 'person-p']
		} as ActiveMember;
		const row = toRosterRow(member, [profile('domain', 'Ada', 'a@x.ee')]);
		expect(row?.ownerIds).toEqual(['person-db-owner', 'person-p']);
	});

	it('loadRoster: wire `_owner` references reach the final row — one member-list read, the profile fan-out, and #469s toggle read, NO extra rights request', async () => {
		const fetchImpl = vi.fn().mockImplementation((url: string) => {
			const u = String(url);
			if (u.includes('_type.string=member')) {
				return Promise.resolve(
					json({
						entities: [
							{
								_id: 'member-1',
								person: [{ reference: 'person-a' }],
								_owner: [
									{ reference: 'person-db-owner', string: 'Olga Owner', inherited: true },
									{ reference: 'person-p', string: 'Paula Person' }
								]
							}
						]
					})
				);
			}
			// #469 — loadRoster now runs applyRealNames unconditionally: resolve
			// the database entity, then the toggle — absent here, same as no
			// setting configured, so NO admin_member_record read is ever spent.
			if (u.includes('_type.string=database')) {
				return Promise.resolve(json({ entities: [{ _id: 'db-ent-1' }] }));
			}
			if (u.includes('entity/db-ent-1') && u.includes('roster_show_real_names')) {
				return Promise.resolve(json({ entity: { _id: 'db-ent-1' } }));
			}
			return Promise.resolve(
				json({
					entities: [
						{
							_id: 'prof-domain',
							name: [{ string: 'Ada Lovelace' }],
							email: [{ string: 'ada@x.ee' }],
							_sharing: [{ string: 'domain' }]
						}
					]
				})
			);
		});
		const rows = (await loadRoster(cfg, fetchImpl)).items;
		expect(rows).toEqual<RosterRow[]>([
			{
				memberId: 'member-1',
				personId: 'person-a',
				name: 'Ada Lovelace',
				profileName: 'Ada Lovelace',
				email: 'ada@x.ee',
				sectionIds: [],
				ownerIds: ['person-db-owner', 'person-p']
			}
		]);
		// ER-26 — the baked person names never leave the extraction.
		const flat = JSON.stringify(rows);
		expect(flat).not.toContain('Olga Owner');
		expect(flat).not.toContain('Paula Person');
		// ONE list read + ONE profile read + ONE database resolve + ONE toggle
		// read (#469) — the gate added no per-row fetch, and the toggle being
		// absent means NO admin_member_record read at all.
		expect(fetchImpl).toHaveBeenCalledTimes(4);
		expect(
			fetchImpl.mock.calls.map((c) => String(c[0])).some((u) => u.includes('admin_member_record'))
		).toBe(false);
	});
});

// (*MVOX:Tallis*)
// (*MVOX:Tallis* — #268 fence pins)
// (*MVOX:Tallis* — #467 RED: _created widening + createdAt threading, author dropped)
// (*MVOX:Josquin* — #467 review F1: non-string _created datetime → undefined)
// (*MVOX:Tallis* — #468 RED: _owner widening + ownerIds threading, .string dropped)
