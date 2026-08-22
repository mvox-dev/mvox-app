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
		expect(members).toEqual<ActiveMember[]>([
			{ memberId: 'member-1', personId: 'person-a', sectionIds: ['sec-sop'], dbEntityId: undefined },
			{ memberId: 'member-2', personId: 'person-b', sectionIds: [], dbEntityId: 'org-1' }
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
		expect(members).toEqual<ActiveMember[]>([
			{ memberId: 'member-1', personId: 'person-a', sectionIds: ['sec-sop'], dbEntityId: 'org-1' }
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
		expect(members).toEqual<ActiveMember[]>([
			{
				memberId: 'member-1',
				personId: 'person-a',
				sectionIds: ['sec-sop', 'sec-lead'],
				dbEntityId: 'org-1'
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

	it('fails loud when a returned member entity carries an unreadable person reference — names the member id, asserts can\'t-see (not doesn\'t-exist), never silently dropped', async () => {
		const orphanFetch = () =>
			vi.fn().mockResolvedValue(json({ entities: [{ _id: 'member-orphan' }] }));
		await expect(listActiveMembers(cfg, orphanFetch())).rejects.toThrow(/member-orphan/);
		await expect(listActiveMembers(cfg, orphanFetch())).rejects.toThrow(/cannot read/i);
		await expect(listActiveMembers(cfg, orphanFetch())).rejects.not.toThrow(/has no person reference/i);
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
		const rows = await loadRoster(cfg, fetchImpl);
		expect(rows).toEqual<RosterRow[]>([
			{
				memberId: 'member-1',
				personId: 'person-a',
				name: 'Ada Lovelace',
				email: 'ada@example.com',
				sectionIds: []
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
		const rows = await loadRoster(cfg, fetchImpl);
		expect(rows).toEqual<RosterRow[]>([
			{
				memberId: 'member-1',
				personId: 'person-a',
				name: 'Ada Lovelace',
				email: 'ada@example.com',
				sectionIds: ['sec-sop', 'sec-lead']
			}
		]);
	});

	it('never fetches private-tier data — no profile-read URL\'s props= param ever contains notes/idcode/birthdate/phone (query-shape proxy for the server-side boundary; live enforcement is T3.4)', async () => {
		const fetchImpl = makeFetchMock(
			[{ _id: 'member-1', person: 'person-a' }],
			{ 'person-a': [rawProfile('domain', 'Ada Lovelace', 'ada@example.com')] }
		);
		await loadRoster(cfg, fetchImpl);
		for (const call of fetchImpl.mock.calls as Array<[string]>) {
			const url = String(call[0]);
			expect(url).not.toMatch(/props=[^&]*\b(notes|idcode|birthdate|phone)\b/);
		}
	});

	it('empty active-member list → [] and fetchImpl called exactly once (no profile fetch attempted for zero members)', async () => {
		const fetchImpl = makeFetchMock([], {});
		const rows = await loadRoster(cfg, fetchImpl);
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
		const rows = await loadRoster(cfg, fetchImpl);
		expect(rows.map((r) => r.name)).toEqual(['Ann', 'Zelda']);
	});
});

// (*MVOX:Tallis*)
