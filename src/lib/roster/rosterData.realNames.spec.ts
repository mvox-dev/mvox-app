import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetTypeIdCache, type EntuCfg } from '$lib/seasons/entuSeasons';
import { loadRoster, loadRosterWithRealNames, type RosterRow } from './rosterData';

// #269 RED — roster renders real names when the admin setting says so.
// Contract: issue #269 body + release ruling (2026-09-07) + scope ruling
// ("roster only for now", 2026-09-06). Seam: the DATA layer —
// `loadRosterWithRealNames` reads the collective toggle and (only when it is
// true) the admin_member_record names, so `row.name` IS the displayed name and
// all three sort sites (its own sort, the page's flatRows re-sort, and
// groupBySection's per-group ordering) follow it with no page-side surgery.
//
// #269 review F1/F2 — the overlay is OPT-IN, a second export rather than a flag
// on the shared producer: `loadRoster` has four production consumers (/roster,
// the event page's attendance panel, the agenda's getRoster, the admin roles
// page), and Henry's scope ruling fences the overlay to the roster row. The
// shared producer's own fence is pinned at the bottom of this file; the three
// route boundaries are pinned in page.agenda-real-names-fence.spec.ts,
// page.admin-real-names-fence.spec.ts and event/[id]/page.spec.ts.
//
// Pinned here:
//   1. RESOLUTION RULE — `roster_show_real_names` true AND that member's
//      admin_member_record carries a non-empty `name` → row.name is the real
//      name; OTHERWISE the profile name exactly as today. The fallback is
//      SILENT AND COMPLETE: no placeholder, no marker — an empty/cleared/
//      whitespace-only record name falls back like no record at all.
//   2. PROFILE NAME STILL TRAVELS — `row.profileName` carries the roster's own
//      domain-or-public profile resolution on EVERY row, because SectionPicker
//      (out of #269's contracted surface, per the roster-only scope ruling)
//      keeps naming the member by her PROFILE name.
//   3. TOGGLE READ — resolveDatabaseEntityId's query (`_type.string=database`)
//      then ONE GET `entity/{dbEntityId}?props=roster_show_real_names`, parsed
//      `?.[0]?.boolean ?? false` (the key is entirely ABSENT when unset).
//   4. RECORDS READ — ONLY when the toggle is true (a false toggle fetches NO
//      records at all — pinned as a negative): ONE bulk query per roster load,
//      `entity?_type.string=admin_member_record&props=person,name&limit=500`,
//      joined client-side by person reference (the listSections one-fetch
//      idiom; person read as `?.[0]?.reference`). A person carrying MORE THAN
//      ONE record is DROPPED from the join rather than last-wins — the same
//      refuse-to-guess answer `loadMemberRecord` gives that member ({state:
//      'damaged'}, #264), which on the row means the silent profile-name
//      fallback of rule 1.
//   5. INCIDENTAL-EXPOSURE FENCE (PO-ruled) — `props=person,name` is the db-
//      level projection fence: `phone`, `email` and `birthdate` are private
//      record fields and this load must never request them. Pinned as URL-shape
//      negatives in the rosterData.spec.ts:403-411 style. NOTE the scoping:
//      the roster's PROFILE read legitimately projects `email`
//      (props=name,email,_sharing — the roster renders it), so the email fence
//      is pinned on the admin_member_record query specifically, while
//      phone/birthdate (which no roster-load query may ever carry) are pinned
//      across EVERY request URL. No fetch-and-discard: the ruled ban means no
//      code path requests the fields and drops them — the URL pins ARE the
//      acceptance list's network check at this layer.
//   6. SORTING — rows come back ordered by the DISPLAYED name (fixture where
//      real-name order differs from profile-name order).
//   7. COMPLETENESS GATE STAYS PROFILE-ONLY — a member with no domain/public
//      profile name stays off the roster even when a record exists (pinned;
//      design note for the live round).

const cfg: EntuCfg = { db: 'testdb', token: 'jwt' };
const DB_ENTITY = 'db-ent-1';

/** The pinned row shape once #269 lands: profileName rides along on every row. */
type RealNameRow = RosterRow & { profileName: string };

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), { status });
}

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
	/** #269 review F3 — non-2xx on the toggle read (readRosterNamesSetting throws). */
	toggleStatus?: number;
	/** #269 review F3 — non-2xx on the bulk admin_member_record read. */
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

describe('#269 loadRosterWithRealNames — resolution rule: toggle AND non-empty record name, otherwise the profile name exactly as today', () => {
	it('toggle ON + a record with a non-empty name → row.name IS the record name; the profile name still travels as row.profileName (SectionPicker keeps it)', async () => {
		const fetchImpl = makeFetch({
			members: [{ _id: 'member-1', person: 'person-a' }],
			profilesByPerson: { 'person-a': [rawProfile('domain', 'Ada Lovelace', 'ada@example.com')] },
			toggle: true,
			records: [{ _id: 'rec-1', person: 'person-a', name: 'Zoe Zed' }]
		});
		const rows = (await loadRosterWithRealNames(cfg, fetchImpl)) as RealNameRow[];
		// Full shape (partial-assertions memory): the record substitutes ONLY the
		// displayed name — email/sections/ids untouched, profile name preserved.
		expect(rows).toEqual([
			{
				memberId: 'member-1',
				personId: 'person-a',
				name: 'Zoe Zed',
				profileName: 'Ada Lovelace',
				email: 'ada@example.com',
				sectionIds: []
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
				// person-b has NO record; person-c's record name was CLEARED;
				// person-d's is whitespace-only — "non-empty" means a real name.
				{ _id: 'rec-c', person: 'person-c', name: '' },
				{ _id: 'rec-d', person: 'person-d', name: '   ' }
			]
		});
		const rows = (await loadRosterWithRealNames(cfg, fetchImpl)) as RealNameRow[];
		// Sorted by the DISPLAYED name (Zoe last although Ada would sort first) —
		// and every fallback row is shaped IDENTICALLY to the record-backed one:
		// same fields, no marker field, no placeholder text.
		expect(rows).toEqual([
			{
				memberId: 'member-b',
				personId: 'person-b',
				name: 'Bella Boone',
				profileName: 'Bella Boone',
				email: 'bella@example.com',
				sectionIds: []
			},
			{
				memberId: 'member-c',
				personId: 'person-c',
				name: 'Cora Crane',
				profileName: 'Cora Crane',
				email: 'cora@example.com',
				sectionIds: []
			},
			{
				memberId: 'member-d',
				personId: 'person-d',
				name: 'Dora Dunn',
				profileName: 'Dora Dunn',
				email: 'dora@example.com',
				sectionIds: []
			},
			{
				memberId: 'member-a',
				personId: 'person-a',
				name: 'Zoe Zed',
				profileName: 'Ada Lovelace',
				email: 'ada@example.com',
				sectionIds: []
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
				// Profile order would be: Anna Aas, Berta Kask.
				'person-a': [rawProfile('domain', 'Anna Aas')],
				'person-b': [rawProfile('domain', 'Berta Kask')]
			},
			toggle: true,
			// Displayed: person-a → 'Zoe Zed', person-b → 'Berta Kask' (no record
			// name change) — displayed order flips: Berta first, Zoe second.
			records: [{ _id: 'rec-a', person: 'person-a', name: 'Zoe Zed' }]
		});
		const rows = await loadRosterWithRealNames(cfg, fetchImpl);
		expect(rows.map((r) => r.name)).toEqual(['Berta Kask', 'Zoe Zed']);
	});
});

describe('#269 loadRosterWithRealNames — toggle read and the toggle-off negative', () => {
	it('TOGGLE OFF (boolean false): profile names everywhere, records present server-side notwithstanding — and NO admin_member_record request is issued AT ALL; the toggle itself IS read', async () => {
		const fetchImpl = makeFetch({
			members: [{ _id: 'member-1', person: 'person-a' }],
			profilesByPerson: { 'person-a': [rawProfile('domain', 'Ada Lovelace', 'ada@example.com')] },
			toggle: false,
			records: [{ _id: 'rec-1', person: 'person-a', name: 'Zoe Zed' }]
		});
		const rows = (await loadRosterWithRealNames(cfg, fetchImpl)) as RealNameRow[];
		expect(rows).toEqual([
			{
				memberId: 'member-1',
				personId: 'person-a',
				name: 'Ada Lovelace',
				profileName: 'Ada Lovelace',
				email: 'ada@example.com',
				sectionIds: []
			}
		]);
		const all = urls(fetchImpl);
		// A false toggle fetches NO records at all (the ruled negative).
		expect(all.filter((u) => u.includes('admin_member_record'))).toEqual([]);
		// The toggle WAS read: ONE GET entity/{dbEntityId}?props=roster_show_real_names.
		expect(all.filter((u) => u.includes(`entity/${DB_ENTITY}`) && u.includes('props=roster_show_real_names'))).toHaveLength(1);
	});

	it('TOGGLE ABSENT (key entirely missing from the entity JSON, the unset default) → parsed ?.[0]?.boolean ?? false → identical to toggle off: profile names, no records fetch', async () => {
		const fetchImpl = makeFetch({
			members: [{ _id: 'member-1', person: 'person-a' }],
			profilesByPerson: { 'person-a': [rawProfile('domain', 'Ada Lovelace', 'ada@example.com')] },
			toggle: 'absent',
			records: [{ _id: 'rec-1', person: 'person-a', name: 'Zoe Zed' }]
		});
		const rows = await loadRosterWithRealNames(cfg, fetchImpl);
		expect(rows.map((r) => r.name)).toEqual(['Ada Lovelace']);
		const all = urls(fetchImpl);
		expect(all.filter((u) => u.includes('admin_member_record'))).toEqual([]);
		expect(all.filter((u) => u.includes(`entity/${DB_ENTITY}`) && u.includes('props=roster_show_real_names'))).toHaveLength(1);
	});
});

describe('#269 loadRosterWithRealNames — the records read: ONE bulk query, narrow projection, client-side join', () => {
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
		const rows = await loadRosterWithRealNames(cfg, fetchImpl);
		const recordUrls = urls(fetchImpl).filter((u) => u.includes('admin_member_record'));
		expect(recordUrls).toHaveLength(1);
		const u = recordUrls[0];
		expect(u).toContain('_type.string=admin_member_record');
		expect(u).toMatch(/props=person,name(&|$)/);
		expect(u).toContain('limit=500');
		// The join lands on the right members.
		expect(rows.map((r) => [r.memberId, r.name])).toEqual([
			['member-b', 'Bella Boone'],
			['member-c', 'Mara Moon'],
			['member-a', 'Zoe Zed']
		]);
	});

	it('INCIDENTAL-EXPOSURE FENCE (PO-ruled): no request URL ever projects phone/birthdate, and the admin_member_record query projects EXACTLY person,name — never email either', async () => {
		const fetchImpl = makeFetch({
			...threeMembers,
			toggle: true,
			records: [{ _id: 'rec-a', person: 'person-a', name: 'Zoe Zed' }]
		});
		await loadRosterWithRealNames(cfg, fetchImpl);
		const all = urls(fetchImpl);
		for (const u of all) {
			// phone/birthdate (and the older private-tier fields) have NO legitimate
			// carrier anywhere in a roster load — pinned across every URL.
			expect(u).not.toMatch(/props=[^&]*\b(phone|birthdate|notes|idcode)\b/);
		}
		// email IS legitimately projected on the PROFILE read (the roster renders
		// it) — so the email fence is pinned on the record query specifically:
		// props=person,name exactly, nothing widening it.
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
		const rows = await loadRosterWithRealNames(cfg, fetchImpl);
		expect(rows.map((r) => r.name)).toEqual(['Zoe Zed']);
	});

	it('MORE THAN ONE record for the same person → the overlay REFUSES TO GUESS: that row shows the PROFILE name (never an arbitrary server-order pick), silently and completely, while her single-record neighbour still shows hers', async () => {
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const fetchImpl = makeFetch({
			...threeMembers,
			toggle: true,
			records: [
				// person-a carries TWO records with DIFFERENT names — the condition
				// loadMemberRecord calls {state:'damaged'} (#264). Last-wins would have
				// shown 'Second Wins' here while the pencil on the same row refused to
				// guess; instead the row falls back to the profile name.
				{ _id: 'rec-a1', person: 'person-a', name: 'First Wins' },
				{ _id: 'rec-a2', person: 'person-a', name: 'Second Wins' },
				{ _id: 'rec-b', person: 'person-b', name: 'Mara Moon' }
			]
		});
		const rows = (await loadRosterWithRealNames(cfg, fetchImpl)) as RealNameRow[];
		expect(rows.map((r) => [r.memberId, r.name])).toEqual([
			['member-a', 'Ada Lovelace'],
			['member-c', 'Cora Crane'],
			['member-b', 'Mara Moon']
		]);
		// SILENT AND COMPLETE — byte-indistinguishable from "no record at all": no
		// placeholder, no marker, profileName unchanged, and nothing on the console.
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
		const rows = await loadRosterWithRealNames(cfg, fetchImpl);
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
				// person-a: only a PRIVATE-tier name — hasVisibleName === 'incomplete'.
				'person-a': [rawProfile('private', 'Hidden Name', 'hidden@example.com')],
				'person-b': [rawProfile('domain', 'Bella Boone', 'bella@example.com')]
			},
			toggle: true,
			records: [
				{ _id: 'rec-a', person: 'person-a', name: 'Zoe Zed' },
				{ _id: 'rec-b', person: 'person-b', name: 'Mara Moon' }
			]
		});
		const rows = await loadRosterWithRealNames(cfg, fetchImpl);
		// member-a never appears — the record does NOT satisfy the gate; member-b
		// is on and shows her real name.
		expect(rows.map((r) => [r.memberId, r.name])).toEqual([['member-b', 'Mara Moon']]);
	});
});

// ── #269 review F3 — the overlay's failure branch: OBSERVABLE degrade ───────
//
// `readRosterNamesSetting` is fail-loud by contract (rosterNames.ts: "no visible
// database entity or a non-2xx anywhere → throw"). `loadRosterWithRealNames` deliberately
// NARROWS that at its one call site — a dead overlay must never take the base
// member/profile roster down with it — so the narrowing is pinned here, both
// branches, and it is LOUD in the console rather than silent (the standing
// fail-loudly-over-fallbacks rule). The degrade direction is what makes it safe:
// it can only show FEWER real names, never leak one while the toggle is off.

describe('#269 loadRosterWithRealNames — a failing overlay degrades to profile names, loudly', () => {
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
		const rows = (await loadRosterWithRealNames(cfg, fetchImpl)) as RealNameRow[];
		// Full shape, both members still on the roster — the overlay is what is
		// lost, never a member.
		expect(rows).toEqual([
			{
				memberId: 'member-a',
				personId: 'person-a',
				name: 'Ada Lovelace',
				profileName: 'Ada Lovelace',
				email: 'ada@example.com',
				sectionIds: []
			},
			{
				memberId: 'member-b',
				personId: 'person-b',
				name: 'Bella Boone',
				profileName: 'Bella Boone',
				email: 'bella@example.com',
				sectionIds: []
			}
		]);
		// The toggle never resolved true, so no records read was even attempted.
		expect(urls(fetchImpl).filter((u) => u.includes('admin_member_record'))).toEqual([]);
		expect(errorSpy).toHaveBeenCalledWith(
			'loadRosterWithRealNames: real-names overlay unavailable, showing profile names',
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
		const rows = (await loadRosterWithRealNames(cfg, fetchImpl)) as RealNameRow[];
		expect(rows).toEqual([
			{
				memberId: 'member-a',
				personId: 'person-a',
				name: 'Ada Lovelace',
				profileName: 'Ada Lovelace',
				email: 'ada@example.com',
				sectionIds: []
			},
			{
				memberId: 'member-b',
				personId: 'person-b',
				name: 'Bella Boone',
				profileName: 'Bella Boone',
				email: 'bella@example.com',
				sectionIds: []
			}
		]);
		// The toggle DID resolve true here — the read was made and failed; no retry.
		expect(urls(fetchImpl).filter((u) => u.includes('admin_member_record'))).toHaveLength(1);
		expect(errorSpy).toHaveBeenCalledWith(
			'loadRosterWithRealNames: real-names overlay unavailable, showing profile names',
			expect.any(Error)
		);
		errorSpy.mockRestore();
	});
});

// ── #269 review F1/F2 — the SHARED producer's fence ────────────────────────
//
// `loadRoster` is the app-wide member-name producer: the agenda, the event
// detail page and the admin roles page all call it, and Henry's 2026-09-06
// scope ruling keeps every one of those on PROFILE names. The overlay
// therefore is not a flag on this function, it is a different function — and
// that has to be pinned at the data layer too, not only per route: a future
// "just add the toggle read to loadRoster" would otherwise re-open the leak on
// three surfaces at once.
//
// The wire below is the one on which the overlay WOULD fire (the database
// entity resolves, the toggle answers TRUE, records carry names), so this is
// not a vacuous negative.

describe('#269 loadRoster (shared producer) — profile names only, no overlay reads at all', () => {
	it('toggle ON with named records on the wire: names are the PROFILE names, profileName rides along, and NEITHER the toggle nor the records is ever requested', async () => {
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
		const rows = (await loadRoster(cfg, fetchImpl)) as RealNameRow[];
		expect(rows).toEqual([
			{
				memberId: 'member-a',
				personId: 'person-a',
				name: 'Ada Lovelace',
				profileName: 'Ada Lovelace',
				email: 'ada@example.com',
				sectionIds: []
			},
			{
				memberId: 'member-b',
				personId: 'person-b',
				name: 'Bella Boone',
				profileName: 'Bella Boone',
				email: 'bella@example.com',
				sectionIds: []
			}
		]);
		// The exposure fence: no record data is pulled, and the collective is
		// never even asked what its roster-names setting is.
		const requested = urls(fetchImpl);
		expect(requested.filter((u) => u.includes('admin_member_record'))).toEqual([]);
		expect(requested.filter((u) => u.includes('roster_show_real_names'))).toEqual([]);
		expect(requested.filter((u) => u.includes('_type.string=database'))).toEqual([]);
		// …and nothing "degraded": the shared producer has no overlay to lose.
		expect(errorSpy).not.toHaveBeenCalled();
		errorSpy.mockRestore();
	});
});

// (*MVOX:Tallis* — #269 RED, data layer)
// (*MVOX:Palestrina* — #269 review F1/F3 fixes: overlay-failure pins)
// (*MVOX:Palestrina* — #269 review F1/F2: shared-producer fence, opt-in overlay)
