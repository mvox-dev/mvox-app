import { describe, expect, it, vi } from 'vitest';
import type { EntuCfg } from '$lib/seasons/entuSeasons';
import type { MyProfile } from '$lib/profile/profileData';
import { listActiveMembers, toRosterRow, type ActiveMember } from './rosterData';

// TU.1/#109 RED — finding #10 support: the roster data layer must CARRY THE
// MEMBER'S ORGANIZATION ID through to the page.
//
// WHY: `createSection`'s top-level org fallback (`limit=1` first-org) is
// live-verifiably wrong — polyphony's 6 organization entities are all
// `_sharing: domain`, and the first one is the umbrella federation, not the
// collective. The page must instead hand `createSection` an EXPLICIT orgId —
// and the correct one is already on the wire the roster loads: every active
// member's `_parent` carries an `entity_type: 'organization'` entry
// (live-verified 2026-08-12: 133/133 active members → EFK). Today
// `listActiveMembers` reads `_parent` and KEEPS ONLY the section entries,
// dropping the org on the floor.
//
// Contract under test (GREEN — see ActiveMember.orgId / RosterRow.orgId):
//   - `listActiveMembers`: `orgId` = the reference of the FIRST `_parent` entry
//     with `entity_type === 'organization'`; undefined when none is visible
//     (never a throw — org visibility must not gate the roster).
//   - `toRosterRow`: carries `orgId` through verbatim, like `sectionIds`.

const cfg: EntuCfg = { db: 'testdb', token: 'jwt' };

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), { status });
}

function profile(sharing: MyProfile['_sharing'], name: string, email = ''): MyProfile {
	return { _id: `p-${sharing}`, name, email, _sharing: sharing };
}

describe('listActiveMembers — carries the member org (finding #10)', () => {
	it('LIVE-WIRE-SHAPED member (_parent = org entry + section entries, with rider fields): orgId = the organization reference; sectionIds unchanged', async () => {
		// Verbatim live shape (polyphony member 6a0dd24b4ff8277cd4306172, ids
		// abbreviated): _parent values carry _id/property_type/string riders and
		// the ORG entry comes FIRST on the wire.
		const fetchImpl = vi.fn().mockResolvedValue(
			json({
				entities: [
					{
						_id: 'member-1',
						person: [{ reference: 'person-a' }],
						_parent: [
							{
								_id: 'pv-1',
								reference: 'org-efk',
								property_type: '_parent',
								string: 'Eesti Filharmoonia Kammerkoor',
								entity_type: 'organization'
							},
							{
								_id: 'pv-2',
								reference: 'sec-sop',
								property_type: '_parent',
								string: 'Soprano',
								entity_type: 'section'
							}
						]
					}
				]
			})
		);
		const out = await listActiveMembers(cfg, fetchImpl);
		expect(out).toEqual<ActiveMember[]>([
			{
				memberId: 'member-1',
				personId: 'person-a',
				sectionIds: ['sec-sop'],
				orgId: 'org-efk'
			}
		]);
	});

	it('a member with NO visible organization _parent: orgId is undefined (absent), the row still lists — org visibility must never gate the roster', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(
			json({
				entities: [
					{
						_id: 'member-2',
						person: [{ reference: 'person-b' }],
						_parent: [{ reference: 'sec-alto', entity_type: 'section' }]
					}
				]
			})
		);
		const out = await listActiveMembers(cfg, fetchImpl);
		expect(out).toHaveLength(1);
		expect(out[0].orgId).toBeUndefined();
		expect(out[0].sectionIds).toEqual(['sec-alto']);
	});
});

describe('toRosterRow — orgId rides through to the page (finding #10)', () => {
	it('carries orgId verbatim from the ActiveMember, alongside sectionIds', () => {
		const member: ActiveMember = {
			memberId: 'member-1',
			personId: 'person-a',
			sectionIds: ['sec-sop'],
			orgId: 'org-efk'
		};
		const row = toRosterRow(member, [profile('domain', 'Ada Lovelace', 'ada@example.com')]);
		expect(row).not.toBeNull();
		expect(row?.orgId).toBe('org-efk');
		expect(row?.sectionIds).toEqual(['sec-sop']);
	});
});

// (*MVOX:Tallis* — TU.1/#109 RED, finding #10: the roster carries the collective org id)
