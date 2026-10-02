// A member's collective is its _parent entry with entity_type database.
import { describe, expect, it, vi } from 'vitest';
import { listActiveMembers, toRosterRow } from './rosterData';
import type { MyProfile } from '$lib/profile/profileData';
import { json, testCfg } from '$lib/testing/entuFetchKit';

const cfg = testCfg('sampledb');
const DB_ENTITY = '69c7f8688489bfcb0e81aff1';

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
		expect(members).toEqual({
			items: [
				{
					memberId: 'm-ada',
					personId: 'p-ada',
					sectionIds: ['sec-sop'],
					dbEntityId: DB_ENTITY,
					ownerIds: []
				}
			],
			total: 1,
			truncated: false
		});
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
		expect(members.items[0].dbEntityId).toBeUndefined();
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

// (*MVOX:Tallis*)
