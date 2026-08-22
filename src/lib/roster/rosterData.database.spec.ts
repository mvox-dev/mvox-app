import { describe, expect, it, vi } from 'vitest';
import { listActiveMembers, toRosterRow } from './rosterData';
import type { EntuCfg } from '$lib/seasons/entuSeasons';
import type { MyProfile } from '$lib/profile/profileData';

// #161 RED — collective = database: a member's collective is the `_parent` entry
// with `entity_type === 'database'`, NOT `'organization'` (#159 deleted every
// organization instance; entu-api parents members created through the invite
// flow under the database entity now). `ActiveMember.dbEntityId` / `RosterRow.dbEntityId`
// keep their names (an entity id is an entity id — the roster page threads it
// into createSection unchanged) but must carry the DATABASE entity id.
//
// Successor of rosterData.org.spec.ts's organization-parent contract — that
// spec's `entity_type: 'organization'` fixtures describe the retired world and
// go with the GREEN pass.

const cfg: EntuCfg = { db: 'polyphony', token: 'jwt' };
const DB_ENTITY = '69c7f8688489bfcb0e81aff1';

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), { status });
}

describe('listActiveMembers — the collective id comes from the DATABASE `_parent` (#161)', () => {
	it("a member parented to [section, database]: dbEntityId = the `entity_type: 'database'` reference, sections untouched", async () => {
		const fetchImpl = vi.fn().mockResolvedValue(
			json({
				entities: [
					{
						_id: 'm-ada',
						person: [{ reference: 'p-ada' }],
						_parent: [
							{ reference: 'sec-sop', entity_type: 'section' },
							{ reference: DB_ENTITY, entity_type: 'database' }
						]
					}
				],
				count: 1
			})
		);
		const members = await listActiveMembers(cfg, fetchImpl);
		expect(members).toEqual([
			{
				memberId: 'm-ada',
				personId: 'p-ada',
				sectionIds: ['sec-sop'],
				dbEntityId: DB_ENTITY
			}
		]);
	});

	it('a member whose only non-section parent is a LEGACY organization entry resolves NO collective (dbEntityId undefined) — organization is not a collective identity anymore', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(
			json({
				entities: [
					{
						_id: 'm-old',
						person: [{ reference: 'p-old' }],
						_parent: [{ reference: 'org-legacy', entity_type: 'organization' }]
					}
				],
				count: 1
			})
		);
		const members = await listActiveMembers(cfg, fetchImpl);
		expect(members[0].dbEntityId).toBeUndefined();
	});
});

describe('toRosterRow — carries the database-entity collective id through verbatim (#161)', () => {
	it('RosterRow.dbEntityId = ActiveMember.dbEntityId (the database entity id)', () => {
		const profiles: MyProfile[] = [
			{ _id: 'prof-1', name: 'Ada Lovelace', email: 'ada@x.com', _sharing: 'domain' }
		];
		const row = toRosterRow(
			{ memberId: 'm-ada', personId: 'p-ada', sectionIds: [], dbEntityId: DB_ENTITY },
			profiles
		);
		expect(row).not.toBeNull();
		expect(row?.dbEntityId).toBe(DB_ENTITY);
	});
});

// (*MVOX:Tallis* — #161 RED)
