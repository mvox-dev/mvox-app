// Role-management reads and writes, pinned to Entu's rolled-up _owner/_editor wire shape.
import { describe, expect, it, vi } from 'vitest';
import {
	RoleGrantMissingError,
	RoleLockoutError,
	addAdmin,
	addLibrarian,
	fetchRights,
	listAdmins,
	listLibrarians,
	removeAdmin,
	removeLibrarian
} from './roleManagement';
import { json, testCfg } from '$lib/testing/entuFetchKit';

const cfg = testCfg('testdb');

interface WireRight {
	_id: string;
	reference?: string;
	string?: string;
	inherited?: boolean;
}

function rollup(opts: {
	ownOwners?: WireRight[];
	ownEditors?: WireRight[];
	inheritedOwners?: WireRight[];
	inheritedEditors?: WireRight[];
}) {
	const inhOwners = (opts.inheritedOwners ?? []).map((v) => ({ ...v, inherited: true }));
	const inhEditors = (opts.inheritedEditors ?? []).map((v) => ({ ...v, inherited: true }));
	const owners = [...(opts.ownOwners ?? []), ...inhOwners];
	return {
		entity: {
			_id: 'whatever',
			_owner: owners,
			_editor: [...owners.map((v) => ({ ...v })), ...(opts.ownEditors ?? []), ...inhEditors]
		}
	};
}

const ANNA_OWNER: WireRight = { _id: 'pv-own-anna', reference: 'p-anna', string: 'Anna Arro' };
const EMIL_OWNER: WireRight = { _id: 'pv-own-emil', reference: 'p-emil', string: 'Emil Erg' };
const BELA_EDITOR: WireRight = { _id: 'pv-ed-bela', reference: 'p-bela', string: 'Bela Brauer' };
const FED_CHIEF_INH: WireRight = { _id: 'pv-PARENT-chief', reference: 'p-chief', string: 'Fed Chief' };
const FED_CLERK_INH: WireRight = { _id: 'pv-PARENT-clerk', reference: 'p-clerk', string: 'Fed Clerk' };

function callUrls(fetchImpl: ReturnType<typeof vi.fn>): string[] {
	return fetchImpl.mock.calls.map((c) => String(c[0]));
}

function callMethods(fetchImpl: ReturnType<typeof vi.fn>): Array<string | undefined> {
	return fetchImpl.mock.calls.map((c) => (c[1] as RequestInit | undefined)?.method);
}

function deleteUrls(fetchImpl: ReturnType<typeof vi.fn>): string[] {
	return fetchImpl.mock.calls
		.filter((c) => (c[1] as RequestInit | undefined)?.method === 'DELETE')
		.map((c) => String(c[0]));
}

describe('fetchRights — GET entity/{id}?props=_owner,_editor, un-folds the rollup, drops inherited', () => {
	it('filters inherited:true out of BOTH lists and excludes folded owner _ids from ownEditors — FULL shape', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(
			json(
				rollup({
					ownOwners: [ANNA_OWNER],
					ownEditors: [BELA_EDITOR],
					inheritedOwners: [FED_CHIEF_INH],
					inheritedEditors: [FED_CLERK_INH]
				})
			)
		);

		const result = await fetchRights(cfg, 'org-1', fetchImpl);

		expect(fetchImpl).toHaveBeenCalledTimes(1);
		const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit | undefined];
		expect(String(url)).toContain('/testdb/entity/org-1?props=_owner,_editor');
		expect(init?.method ?? 'GET').toBe('GET');

		expect(result).toEqual({
			ownOwners: [expect.objectContaining({ _id: 'pv-own-anna', reference: 'p-anna' })],
			ownEditors: [expect.objectContaining({ _id: 'pv-ed-bela', reference: 'p-bela' })],
			allOwners: [
				expect.objectContaining({ _id: 'pv-own-anna', reference: 'p-anna' }),
				expect.objectContaining({ _id: 'pv-PARENT-chief', reference: 'p-chief', inherited: true })
			]
		});
	});

	it('the fold is keyed by _id, not by person: an owner holding a SEPARATE own _editor value (distinct _id) keeps that value in ownEditors', async () => {
		const annaExtraEditor: WireRight = {
			_id: 'pv-ed-anna',
			reference: 'p-anna',
			string: 'Anna Arro'
		};
		const fetchImpl = vi.fn().mockResolvedValue(
			json(rollup({ ownOwners: [ANNA_OWNER], ownEditors: [annaExtraEditor] }))
		);

		const result = await fetchRights(cfg, 'org-1', fetchImpl);
		expect(result.ownOwners.map((v) => v._id)).toEqual(['pv-own-anna']);
		expect(result.ownEditors.map((v) => v._id)).toEqual(['pv-ed-anna']);
	});

	it('rights props entirely absent (reader without rights — private bucket) → all three lists empty, fail-closed, NOT a throw', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(json({ entity: { _id: 'org-1' } }));
		await expect(fetchRights(cfg, 'org-1', fetchImpl)).resolves.toEqual({
			ownOwners: [],
			ownEditors: [],
			allOwners: []
		});
	});

	it('non-2xx → rejects with the status surfaced', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(json({ error: 'forbidden' }, 403));
		await expect(fetchRights(cfg, 'org-1', fetchImpl)).rejects.toThrow(/403/);
	});
});

describe('listAdmins — one rights GET mapped to { persons: {id, name, role, valueIds}[], canManage }', () => {
	it('owners first, then editors; each row carries its property valueIds; inherited holders are NOT listed', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(
			json(
				rollup({
					ownOwners: [ANNA_OWNER],
					ownEditors: [BELA_EDITOR],
					inheritedOwners: [FED_CHIEF_INH],
					inheritedEditors: [FED_CLERK_INH]
				})
			)
		);

		const result = await listAdmins(cfg, 'org-1', 'p-anna', fetchImpl);

		expect(fetchImpl).toHaveBeenCalledTimes(1);
		expect(result).toEqual({
			persons: [
				{ id: 'p-anna', name: 'Anna Arro', role: 'owner', valueIds: ['pv-own-anna'] },
				{ id: 'p-bela', name: 'Bela Brauer', role: 'editor', valueIds: ['pv-ed-bela'] }
			],
			canManage: true
		});
	});

	it('an owner appears ONCE as "owner" despite the folded _editor entry (same _id in both wire lists)', async () => {
		const fetchImpl = vi
			.fn()
			.mockResolvedValue(json(rollup({ ownOwners: [ANNA_OWNER, EMIL_OWNER] })));

		const result = await listAdmins(cfg, 'org-1', 'p-anna', fetchImpl);
		expect(result.persons).toEqual([
			{ id: 'p-anna', name: 'Anna Arro', role: 'owner', valueIds: ['pv-own-anna'] },
			{ id: 'p-emil', name: 'Emil Erg', role: 'owner', valueIds: ['pv-own-emil'] }
		]);
	});

	it('an owner ALSO holding a SEPARATE own _editor value (distinct _id, which the _id-keyed un-fold cannot collapse) is ONE row, role "owner", carrying BOTH value ids — a duplicate person id would crash the keyed {#each}', async () => {
		const annaExtraEditor: WireRight = {
			_id: 'pv-ed-anna',
			reference: 'p-anna',
			string: 'Anna Arro'
		};
		const fetchImpl = vi
			.fn()
			.mockResolvedValue(
				json(rollup({ ownOwners: [ANNA_OWNER], ownEditors: [annaExtraEditor, BELA_EDITOR] }))
			);

		const result = await listAdmins(cfg, 'org-1', 'p-anna', fetchImpl);

		expect(result.persons).toEqual([
			{ id: 'p-anna', name: 'Anna Arro', role: 'owner', valueIds: ['pv-own-anna', 'pv-ed-anna'] },
			{ id: 'p-bela', name: 'Bela Brauer', role: 'editor', valueIds: ['pv-ed-bela'] }
		]);
		const ids = result.persons.map((p) => p.id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it('an editor holding several own _editor values (stale duplicates) is ONE row carrying every value id', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(
			json(
				rollup({
					ownEditors: [
						{ _id: 'pv-ed-dora-1', reference: 'p-dora', string: 'Dora Duncan' },
						{ _id: 'pv-ed-dora-2', reference: 'p-dora', string: 'Dora Duncan' }
					]
				})
			)
		);

		const result = await listAdmins(cfg, 'org-1', 'p-dora', fetchImpl);
		expect(result.persons).toEqual([
			{ id: 'p-dora', name: 'Dora Duncan', role: 'editor', valueIds: ['pv-ed-dora-1', 'pv-ed-dora-2'] }
		]);
	});

	it('canManage is the WRITE answer, not the listing one: an org _editor viewer (no _owner value) gets canManage false — entu-api 403s her rights writes', async () => {
		const fetchImpl = vi
			.fn()
			.mockResolvedValue(json(rollup({ ownOwners: [ANNA_OWNER], ownEditors: [BELA_EDITOR] })));

		const result = await listAdmins(cfg, 'org-1', 'p-bela', fetchImpl);
		expect(result.canManage).toBe(false);
		expect(result.persons.map((p) => p.id)).toEqual(['p-anna', 'p-bela']);
	});

	it('canManage counts INHERITED owners: an umbrella owner is not listed here, yet the API accepts her writes', async () => {
		const fetchImpl = vi
			.fn()
			.mockResolvedValue(
				json(rollup({ ownOwners: [ANNA_OWNER], inheritedOwners: [FED_CHIEF_INH] }))
			);

		const result = await listAdmins(cfg, 'org-1', 'p-chief', fetchImpl);
		expect(result.canManage).toBe(true);
		expect(result.persons.map((p) => p.id)).toEqual(['p-anna']);
	});

	it('#841: a value without a `string` display name is a nameless row (name null), never the raw id as its name', async () => {
		const fetchImpl = vi
			.fn()
			.mockResolvedValue(json(rollup({ ownOwners: [{ _id: 'pv-x', reference: 'p-ghost' }] })));

		const result = await listAdmins(cfg, 'org-1', 'p-ghost', fetchImpl);
		expect(result.persons).toEqual([
			{ id: 'p-ghost', name: null, role: 'owner', valueIds: ['pv-x'] }
		]);
	});

	it('#841: a nameless owner value folded with a named editor value takes the editor value\'s name', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(
			json(
				rollup({
					ownOwners: [{ _id: 'pv-x', reference: 'p-ghost' }],
					ownEditors: [{ _id: 'pv-y', reference: 'p-ghost', string: 'Ghost Gould' }]
				})
			)
		);

		const result = await listAdmins(cfg, 'org-1', 'p-ghost', fetchImpl);
		expect(result.persons).toEqual([
			{ id: 'p-ghost', name: 'Ghost Gould', role: 'owner', valueIds: ['pv-x', 'pv-y'] }
		]);
	});

	it('#841: a roster row with an empty name neither blanks a named row nor names a nameless one', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(
			json(rollup({ ownOwners: [ANNA_OWNER, { _id: 'pv-x', reference: 'p-ghost' }] }))
		);
		const roster = [
			{ memberId: 'm-1', personId: 'p-anna', name: '', email: '' },
			{ memberId: 'm-2', personId: 'p-ghost', name: '', email: '' }
		];

		const result = await listAdmins(cfg, 'org-1', 'p-anna', fetchImpl, roster);
		expect(result.persons).toEqual([
			{ id: 'p-anna', name: 'Anna Arro', role: 'owner', valueIds: ['pv-own-anna'] },
			{ id: 'p-ghost', name: null, role: 'owner', valueIds: ['pv-x'] }
		]);
	});

	it('#146: a nameless row is named off a passed roster against a passed roster, by personId', async () => {
		const fetchImpl = vi
			.fn()
			.mockResolvedValue(json(rollup({ ownOwners: [{ _id: 'pv-x', reference: 'p-ghost' }] })));
		const roster = [
			{ memberId: 'm-1', personId: 'p-ghost', name: 'Ghost Gould', email: '' },
			{ memberId: 'm-2', personId: 'p-other', name: 'Someone Else', email: '' }
		];

		const result = await listAdmins(cfg, 'org-1', 'p-ghost', fetchImpl, roster);
		expect(result.persons).toEqual([
			{ id: 'p-ghost', name: 'Ghost Gould', role: 'owner', valueIds: ['pv-x'] }
		]);
	});

	it('#469 F1: a row WITH a display name off the rights value is overwritten by the roster when the two disagree — the roster wins', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(json(rollup({ ownOwners: [ANNA_OWNER] })));
		const roster = [
			{ memberId: 'm-1', personId: 'p-anna', name: 'Roster Says Otherwise', email: '' }
		];

		const result = await listAdmins(cfg, 'org-1', 'p-anna', fetchImpl, roster);
		expect(result.persons).toEqual([
			{ id: 'p-anna', name: 'Roster Says Otherwise', role: 'owner', valueIds: ['pv-own-anna'] }
		]);
	});

	it('#469 F1: a person WITH a rights-value name but NO roster row keeps that name — the roster wins only where it has a row', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(json(rollup({ ownOwners: [ANNA_OWNER] })));
		const roster = [{ memberId: 'm-1', personId: 'p-other', name: 'Someone Else', email: '' }];

		const result = await listAdmins(cfg, 'org-1', 'p-anna', fetchImpl, roster);
		expect(result.persons).toEqual([
			{ id: 'p-anna', name: 'Anna Arro', role: 'owner', valueIds: ['pv-own-anna'] }
		]);
	});

	it('#146: a nameless person absent from the roster stays nameless — no roster entry to resolve against', async () => {
		const fetchImpl = vi
			.fn()
			.mockResolvedValue(json(rollup({ ownOwners: [{ _id: 'pv-x', reference: 'p-ghost' }] })));
		const roster = [{ memberId: 'm-1', personId: 'p-other', name: 'Someone Else', email: '' }];

		const result = await listAdmins(cfg, 'org-1', 'p-ghost', fetchImpl, roster);
		expect(result.persons).toEqual([
			{ id: 'p-ghost', name: null, role: 'owner', valueIds: ['pv-x'] }
		]);
	});

	it('rights props entirely absent → no rows and canManage false (fail-closed), NOT a throw', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(json({ entity: { _id: 'org-1' } }));
		await expect(listAdmins(cfg, 'org-1', 'p-anna', fetchImpl)).resolves.toEqual({
			persons: [],
			canManage: false
		});
	});

	it('non-2xx → rejects with the status surfaced', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(json({ error: 'forbidden' }, 403));
		await expect(listAdmins(cfg, 'org-1', 'p-anna', fetchImpl)).rejects.toThrow(/403/);
	});
});

describe('addAdmin — grants _editor on the org (GET → POST → DELETE own stale dupes)', () => {
	it('person with NO existing grant: GET rights, then POST body EXACTLY [{ type: "_editor", reference: personId }] — no DELETE at all', async () => {
		const fetchImpl = vi
			.fn()
			.mockResolvedValueOnce(json(rollup({ ownOwners: [ANNA_OWNER] })))
			.mockResolvedValueOnce(json({}));

		await addAdmin(cfg, 'org-1', 'p-dora', fetchImpl);

		expect(fetchImpl).toHaveBeenCalledTimes(2);
		expect(callUrls(fetchImpl)[0]).toContain('/testdb/entity/org-1?props=_owner,_editor');

		const [postUrl, postInit] = fetchImpl.mock.calls[1] as [string, RequestInit];
		expect(String(postUrl)).toContain('/testdb/entity/org-1');
		expect(postInit.method).toBe('POST');
		expect(JSON.parse(String(postInit.body))).toEqual([{ type: '_editor', reference: 'p-dora' }]);
	});

	it('person ALREADY holding own _editor values (stale duplicates): POST first, THEN DELETE every pre-existing OWN value id — POST-BEFORE-DELETE, property endpoint only', async () => {
		const fetchImpl = vi
			.fn()
			.mockResolvedValueOnce(
				json(
					rollup({
						ownOwners: [ANNA_OWNER],
						ownEditors: [
							{ _id: 'pv-ed-dora-1', reference: 'p-dora', string: 'Dora Duncan' },
							{ _id: 'pv-ed-dora-2', reference: 'p-dora', string: 'Dora Duncan' },
							BELA_EDITOR
						]
					})
				)
			)
			.mockResolvedValue(json({}));

		await addAdmin(cfg, 'org-1', 'p-dora', fetchImpl);

		expect(fetchImpl).toHaveBeenCalledTimes(4);
		expect(callMethods(fetchImpl).slice(1)).toEqual(['POST', 'DELETE', 'DELETE']);
		const urls = callUrls(fetchImpl);
		expect(urls[2]).toContain('/testdb/property/pv-ed-dora-1');
		expect(urls[3]).toContain('/testdb/property/pv-ed-dora-2');
		expect(urls.join('\n')).not.toContain('pv-ed-bela');
		expect(urls.join('\n')).not.toContain('pv-own-anna');
		for (const u of urls.slice(2)) expect(u).not.toContain('/entity/');
	});

	it("person whose ONLY 'grant' is an INHERITED _editor entry: treated as no own grant — POST happens, the inherited (parent-owned) _id is NEVER deleted", async () => {
		const doraInherited: WireRight = {
			_id: 'pv-PARENT-dora',
			reference: 'p-dora',
			string: 'Dora Duncan'
		};
		const fetchImpl = vi
			.fn()
			.mockResolvedValueOnce(
				json(rollup({ ownOwners: [ANNA_OWNER], inheritedEditors: [doraInherited] }))
			)
			.mockResolvedValue(json({}));

		await addAdmin(cfg, 'org-1', 'p-dora', fetchImpl);

		expect(fetchImpl).toHaveBeenCalledTimes(2);
		expect(callMethods(fetchImpl)[1]).toBe('POST');
		expect(callUrls(fetchImpl).join('\n')).not.toContain('pv-PARENT-dora');
	});

	it('person who is ALREADY an own _owner: NO-OP after the GET — nothing POSTed, and the folded _editor entry (same _id as the _owner value!) is NEVER "replaced"', async () => {
		const fetchImpl = vi
			.fn()
			.mockResolvedValue(json(rollup({ ownOwners: [ANNA_OWNER], ownEditors: [BELA_EDITOR] })));

		await addAdmin(cfg, 'org-1', 'p-anna', fetchImpl);
		expect(fetchImpl).toHaveBeenCalledTimes(1);
	});

	it('a failed POST rejects (status surfaced) and NO DELETE is issued — the old grant survives', async () => {
		const fetchImpl = vi
			.fn()
			.mockResolvedValueOnce(
				json(rollup({ ownEditors: [{ _id: 'pv-ed-dora-1', reference: 'p-dora' }] }))
			)
			.mockResolvedValueOnce(json({ error: 'boom' }, 500));

		await expect(addAdmin(cfg, 'org-1', 'p-dora', fetchImpl)).rejects.toThrow(/500/);
		expect(fetchImpl).toHaveBeenCalledTimes(2); // GET + failed POST, nothing more
	});

	it('a failed rights GET rejects without writing anything', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(json({ error: 'nope' }, 502));
		await expect(addAdmin(cfg, 'org-1', 'p-dora', fetchImpl)).rejects.toThrow(/502/);
		expect(fetchImpl).toHaveBeenCalledTimes(1);
	});
});

describe("removeAdmin — deletes the person's OWN rights values; never inherited, never twice, never the last owner", () => {
	it('editor-only person: DELETE property/{id} for EVERY matching own _editor value (stale duplicates too) — other people\'s values untouched, never an entity DELETE', async () => {
		const fetchImpl = vi
			.fn()
			.mockResolvedValueOnce(
				json(
					rollup({
						ownOwners: [ANNA_OWNER],
						ownEditors: [
							BELA_EDITOR,
							{ _id: 'pv-ed-bela-dupe', reference: 'p-bela', string: 'Bela Brauer' }
						]
					})
				)
			)
			.mockResolvedValue(json({}));

		await removeAdmin(cfg, 'org-1', 'p-bela', fetchImpl);

		const urls = callUrls(fetchImpl);
		expect(urls[0]).toContain('/testdb/entity/org-1?props=_owner,_editor');
		expect(fetchImpl).toHaveBeenCalledTimes(3);
		expect(urls[1]).toContain('/testdb/property/pv-ed-bela');
		expect(urls[2]).toContain('/testdb/property/pv-ed-bela-dupe');
		expect(callMethods(fetchImpl).slice(1)).toEqual(['DELETE', 'DELETE']);
		expect(urls.join('\n')).not.toContain('pv-own-anna');
		for (const u of urls.slice(1)) expect(u).not.toContain('/entity/');
	});

	it('an owner (with ANOTHER own owner remaining): her _owner value goes EXACTLY ONCE — the folded _editor twin (same _id) must NOT trigger a second DELETE', async () => {
		const annaExtraEditor: WireRight = {
			_id: 'pv-ed-anna',
			reference: 'p-anna',
			string: 'Anna Arro'
		};
		const fetchImpl = vi
			.fn()
			.mockResolvedValueOnce(
				json(rollup({ ownOwners: [ANNA_OWNER, EMIL_OWNER], ownEditors: [annaExtraEditor] }))
			)
			.mockResolvedValue(json({}));

		await removeAdmin(cfg, 'org-1', 'p-anna', fetchImpl);

		const deletes = deleteUrls(fetchImpl);
		expect(deletes.filter((u) => u.includes('/property/pv-own-anna'))).toHaveLength(1);
		expect(deletes.filter((u) => u.includes('/property/pv-ed-anna'))).toHaveLength(1);
		expect(deletes).toHaveLength(2);
		expect(callUrls(fetchImpl).join('\n')).not.toContain('pv-own-emil');
	});

	it("person whose only entries are INHERITED: rejects with RoleGrantMissingError, NOTHING deleted — inherited values belong to the PARENT entity", async () => {
		const fetchImpl = vi.fn().mockResolvedValue(
			json(
				rollup({
					ownOwners: [ANNA_OWNER],
					inheritedOwners: [FED_CHIEF_INH],
					inheritedEditors: [FED_CLERK_INH]
				})
			)
		);

		await expect(removeAdmin(cfg, 'org-1', 'p-chief', fetchImpl)).rejects.toBeInstanceOf(
			RoleGrantMissingError
		);
		expect(fetchImpl).toHaveBeenCalledTimes(1);
	});

	it('the LAST own _owner: rejects with RoleLockoutError and NOTHING is deleted — the guard runs BEFORE any write', async () => {
		const fetchImpl = vi
			.fn()
			.mockResolvedValue(json(rollup({ ownOwners: [ANNA_OWNER], ownEditors: [BELA_EDITOR] })));

		const attempt = removeAdmin(cfg, 'org-1', 'p-anna', fetchImpl);
		await expect(attempt).rejects.toBeInstanceOf(RoleLockoutError);
		expect(fetchImpl).toHaveBeenCalledTimes(1);
	});

	it('INHERITED owners do NOT count as remaining owners: last own owner + an inherited owner still rejects with RoleLockoutError', async () => {
		const fetchImpl = vi
			.fn()
			.mockResolvedValue(
				json(rollup({ ownOwners: [ANNA_OWNER], inheritedOwners: [FED_CHIEF_INH] }))
			);

		await expect(removeAdmin(cfg, 'org-1', 'p-anna', fetchImpl)).rejects.toBeInstanceOf(
			RoleLockoutError
		);
		expect(fetchImpl).toHaveBeenCalledTimes(1);
	});

	it('#164 defense in depth — a self-removal that would strip the last own _owner still rejects with RoleLockoutError before any write; with another owner remaining it still proceeds (the self rule is the UI\'s leg, not this layer\'s)', async () => {
		const lockedFetch = vi
			.fn()
			.mockResolvedValue(json(rollup({ ownOwners: [ANNA_OWNER], ownEditors: [BELA_EDITOR] })));
		await expect(removeAdmin(cfg, 'org-1', 'p-anna', lockedFetch)).rejects.toBeInstanceOf(
			RoleLockoutError
		);
		expect(lockedFetch).toHaveBeenCalledTimes(1); // rights GET only, zero DELETEs

		const openFetch = vi
			.fn()
			.mockResolvedValueOnce(json(rollup({ ownOwners: [ANNA_OWNER, EMIL_OWNER] })))
			.mockResolvedValue(json({}));
		await removeAdmin(cfg, 'org-1', 'p-anna', openFetch);
		const deletes = deleteUrls(openFetch);
		expect(deletes).toHaveLength(1);
		expect(deletes[0]).toContain('/property/pv-own-anna');
	});

	it('no matching grant at all (stale UI row): rejects with RoleGrantMissingError, nothing deleted', async () => {
		const fetchImpl = vi
			.fn()
			.mockResolvedValue(json(rollup({ ownOwners: [ANNA_OWNER], ownEditors: [BELA_EDITOR] })));

		await expect(removeAdmin(cfg, 'org-1', 'p-ghost', fetchImpl)).rejects.toBeInstanceOf(
			RoleGrantMissingError
		);
		expect(fetchImpl).toHaveBeenCalledTimes(1);
	});

	it('a failing DELETE rejects with the status surfaced', async () => {
		const fetchImpl = vi
			.fn()
			.mockResolvedValueOnce(
				json(rollup({ ownOwners: [ANNA_OWNER], ownEditors: [BELA_EDITOR] }))
			)
			.mockResolvedValueOnce(json({ error: 'boom' }, 500));

		await expect(removeAdmin(cfg, 'org-1', 'p-bela', fetchImpl)).rejects.toThrow(/500/);
	});
});

describe('listLibrarians — the org admins arrive SPLICED IN as inherited (org → library _inheritrights) and are NOT librarians', () => {
	it('GETs entity/{libraryId}?props=_owner,_editor and lists ONLY own grant holders, with valueIds', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(
			json(
				rollup({
					ownEditors: [{ _id: 'pv-ed-cilla', reference: 'p-cilla', string: 'Cilla Cane' }],
					inheritedOwners: [{ _id: 'pv-ORG-anna', reference: 'p-anna', string: 'Anna Arro' }],
					inheritedEditors: [{ _id: 'pv-ORG-bela', reference: 'p-bela', string: 'Bela Brauer' }]
				})
			)
		);

		const result = await listLibrarians(cfg, 'lib-1', 'p-anna', fetchImpl);

		expect(fetchImpl).toHaveBeenCalledTimes(1);
		expect(callUrls(fetchImpl)[0]).toContain('/testdb/entity/lib-1?props=_owner,_editor');
		expect(result).toEqual({
			persons: [{ id: 'p-cilla', name: 'Cilla Cane', role: 'editor', valueIds: ['pv-ed-cilla'] }],
			canManage: true
		});
	});

	it('a library owner holding a separate own _editor value is ONE row, role "owner" — the librarian list is keyed on person id too', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(
			json(
				rollup({
					ownOwners: [{ _id: 'pv-own-anna-lib', reference: 'p-anna', string: 'Anna Arro' }],
					ownEditors: [{ _id: 'pv-ed-anna-lib', reference: 'p-anna', string: 'Anna Arro' }]
				})
			)
		);

		const result = await listLibrarians(cfg, 'lib-1', 'p-anna', fetchImpl);
		expect(result.persons).toEqual([
			{
				id: 'p-anna',
				name: 'Anna Arro',
				role: 'owner',
				valueIds: ['pv-own-anna-lib', 'pv-ed-anna-lib']
			}
		]);
	});

	it('a librarian viewer (own _editor, no _owner anywhere in the rollup) gets canManage false', async () => {
		const fetchImpl = vi
			.fn()
			.mockResolvedValue(
				json(rollup({ ownEditors: [{ _id: 'pv-ed-cilla', reference: 'p-cilla' }] }))
			);

		const result = await listLibrarians(cfg, 'lib-1', 'p-cilla', fetchImpl);
		expect(result.canManage).toBe(false);
	});

	it('#146: a display-name-less librarian row is resolved against a passed roster, same as listAdmins', async () => {
		const fetchImpl = vi
			.fn()
			.mockResolvedValue(
				json(rollup({ ownEditors: [{ _id: 'pv-ed-cilla', reference: 'p-cilla' }] }))
			);
		const roster = [{ memberId: 'm-1', personId: 'p-cilla', name: 'Cilla Cane', email: '' }];

		const result = await listLibrarians(cfg, 'lib-1', 'p-cilla', fetchImpl, roster);
		expect(result.persons).toEqual([
			{ id: 'p-cilla', name: 'Cilla Cane', role: 'editor', valueIds: ['pv-ed-cilla'] }
		]);
	});

	it('rights props absent → no rows, canManage false (fail-closed), non-2xx → rejects', async () => {
		const empty = vi.fn().mockResolvedValue(json({ entity: { _id: 'lib-1' } }));
		await expect(listLibrarians(cfg, 'lib-1', 'p-anna', empty)).resolves.toEqual({
			persons: [],
			canManage: false
		});

		const failing = vi.fn().mockResolvedValue(json({}, 404));
		await expect(listLibrarians(cfg, 'lib-1', 'p-anna', failing)).rejects.toThrow(/404/);
	});
});

describe('addLibrarian — grants _editor on the library, replace semantics on OWN values only', () => {
	it('no existing grant: GET then POST body EXACTLY [{ type: "_editor", reference: personId }] to entity/{libraryId}', async () => {
		const fetchImpl = vi
			.fn()
			.mockResolvedValueOnce(json(rollup({})))
			.mockResolvedValueOnce(json({}));

		await addLibrarian(cfg, 'lib-1', 'p-dora', fetchImpl);

		expect(fetchImpl).toHaveBeenCalledTimes(2);
		const [postUrl, postInit] = fetchImpl.mock.calls[1] as [string, RequestInit];
		expect(String(postUrl)).toContain('/testdb/entity/lib-1');
		expect(postInit.method).toBe('POST');
		expect(JSON.parse(String(postInit.body))).toEqual([{ type: '_editor', reference: 'p-dora' }]);
	});

	it('existing own _editor grant: POST the new value BEFORE deleting the old value id; an inherited entry for the SAME person is not touched', async () => {
		const fetchImpl = vi
			.fn()
			.mockResolvedValueOnce(
				json(
					rollup({
						ownEditors: [{ _id: 'pv-ed-dora-old', reference: 'p-dora' }],
						inheritedEditors: [{ _id: 'pv-ORG-dora', reference: 'p-dora' }]
					})
				)
			)
			.mockResolvedValue(json({}));

		await addLibrarian(cfg, 'lib-1', 'p-dora', fetchImpl);

		expect(callMethods(fetchImpl).slice(1)).toEqual(['POST', 'DELETE']);
		expect(callUrls(fetchImpl)[2]).toContain('/testdb/property/pv-ed-dora-old');
		expect(callUrls(fetchImpl).join('\n')).not.toContain('pv-ORG-dora');
	});
});

describe('removeLibrarian — revokes the OWN EDITOR grant only', () => {
	it("deletes every matching own _editor value via property/{id}; the person's _owner value and its folded twin (same _id) are NEVER touched", async () => {
		const fetchImpl = vi
			.fn()
			.mockResolvedValueOnce(
				json(
					rollup({
						ownOwners: [{ _id: 'pv-own-anna-lib', reference: 'p-anna', string: 'Anna Arro' }],
						ownEditors: [{ _id: 'pv-ed-anna-lib', reference: 'p-anna', string: 'Anna Arro' }]
					})
				)
			)
			.mockResolvedValue(json({}));

		await removeLibrarian(cfg, 'lib-1', 'p-anna', fetchImpl);

		const urls = callUrls(fetchImpl);
		expect(fetchImpl).toHaveBeenCalledTimes(2);
		expect(urls[0]).toContain('/testdb/entity/lib-1?props=_owner,_editor');
		expect(urls[1]).toContain('/testdb/property/pv-ed-anna-lib');
		expect(urls.join('\n')).not.toContain('pv-own-anna-lib');
	});

	it("person whose only _editor entry is INHERITED (an org admin): rejects with RoleGrantMissingError, nothing deleted — org rights are not revocable from the library", async () => {
		const fetchImpl = vi.fn().mockResolvedValue(
			json(
				rollup({
					ownEditors: [{ _id: 'pv-ed-cilla', reference: 'p-cilla', string: 'Cilla Cane' }],
					inheritedOwners: [{ _id: 'pv-ORG-anna', reference: 'p-anna', string: 'Anna Arro' }]
				})
			)
		);

		await expect(removeLibrarian(cfg, 'lib-1', 'p-anna', fetchImpl)).rejects.toBeInstanceOf(
			RoleGrantMissingError
		);
		expect(fetchImpl).toHaveBeenCalledTimes(1);
	});

	it('no matching own _editor grant → rejects with RoleGrantMissingError (an own-owner-only person is NOT silently "removed" via her folded entry)', async () => {
		const fetchImpl = vi
			.fn()
			.mockResolvedValue(
				json(rollup({ ownOwners: [{ _id: 'pv-own-anna-lib', reference: 'p-anna' }] }))
			);

		await expect(removeLibrarian(cfg, 'lib-1', 'p-anna', fetchImpl)).rejects.toBeInstanceOf(
			RoleGrantMissingError
		);
		expect(fetchImpl).toHaveBeenCalledTimes(1);
	});
});

describe('#161 review — database self-reference in _owner is not a person', () => {
	const DB_ID = 'db-entity-1';
	const SELF_REF_OWNER = {
		_id: 'pv-own-self',
		reference: DB_ID,
		string: 'sampledb',
		entity_type: 'database'
	};
	const ANNA_PERSON_OWNER = {
		_id: 'pv-own-anna',
		reference: 'p-anna',
		string: 'Anna Arro',
		entity_type: 'person'
	};
	const EMIL_PERSON_OWNER = {
		_id: 'pv-own-emil',
		reference: 'p-emil',
		string: 'Emil Erg',
		entity_type: 'person'
	};

	function makeRightsRouter(body: unknown): ReturnType<typeof vi.fn> {
		return vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
			if (init?.method === 'DELETE') return json({ deleted: true });
			return json(body);
		});
	}

	it('listAdmins does NOT list the non-person self-reference — persons only, FULL shape', async () => {
		const fetchImpl = makeRightsRouter(
			rollup({ ownOwners: [SELF_REF_OWNER, ANNA_PERSON_OWNER], ownEditors: [BELA_EDITOR] })
		);

		const result = await listAdmins(cfg, DB_ID, 'p-anna', fetchImpl as unknown as typeof fetch);

		expect(result).toEqual({
			persons: [
				{ id: 'p-anna', name: 'Anna Arro', role: 'owner', valueIds: ['pv-own-anna'] },
				{ id: 'p-bela', name: 'Bela Brauer', role: 'editor', valueIds: ['pv-ed-bela'] }
			],
			canManage: true
		});
	});

	it('a rights value WITHOUT entity_type still lists as a person (older wire reads carry no entity_type — filter only on a KNOWN non-person type)', async () => {
		const fetchImpl = makeRightsRouter(
			rollup({ ownOwners: [ANNA_OWNER, SELF_REF_OWNER], ownEditors: [BELA_EDITOR] })
		);

		const result = await listAdmins(cfg, DB_ID, 'p-anna', fetchImpl as unknown as typeof fetch);
		expect(result.persons.map((p) => p.id)).toEqual(['p-anna', 'p-bela']);
	});

	it('removeAdmin lockout guard counts PERSON owners only: last human owner + the self-reference → RoleLockoutError, NOTHING deleted', async () => {
		const fetchImpl = makeRightsRouter(
			rollup({ ownOwners: [ANNA_PERSON_OWNER, SELF_REF_OWNER] })
		);

		await expect(
			removeAdmin(cfg, DB_ID, 'p-anna', fetchImpl as unknown as typeof fetch)
		).rejects.toBeInstanceOf(RoleLockoutError);

		expect(deleteUrls(fetchImpl)).toEqual([]);
		expect(fetchImpl).toHaveBeenCalledTimes(1);
	});

	it('removeAdmin still succeeds when ANOTHER person owner remains — deletes only the removed person\'s own value, never the self-reference', async () => {
		const fetchImpl = makeRightsRouter(
			rollup({ ownOwners: [ANNA_PERSON_OWNER, EMIL_PERSON_OWNER, SELF_REF_OWNER] })
		);

		await removeAdmin(cfg, DB_ID, 'p-anna', fetchImpl as unknown as typeof fetch);

		const deletes = deleteUrls(fetchImpl);
		expect(deletes).toHaveLength(1);
		expect(deletes[0]).toContain('/testdb/property/pv-own-anna');
	});
});

// (*MVOX:Tallis* — #134/S3 RED, rollup revision)
// (*MVOX:Tallis* — #161 review-fix RED: person filter on rights values)
