// #255 RED — the member lifecycle data layer: deactivate/reinstate status flip,
// the inactive-members read (done-when 4), and the refusal read (accepted
// rec 1: deactivate REFUSES while a manageable grant is held).
// #264 RED — the flip's wire goes ATOMIC (see the deactivateMember block
// header): one overwrite-POST carrying the old value's `_id`, no clear-first
// DELETE, empty-status half-landing structurally impossible.
//
// Done-when 1 is pinned HARD here: `status` is the ONLY property the flip
// touches — the POST body is asserted with toEqual (full shape), and the whole
// call log is swept for `_parent`/`_owner`/`_editor` anywhere.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EntuCfg } from '$lib/seasons/entuSeasons';

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
// Both possible profile-read paths (listProfilesForPerson delegates to
// listMyProfiles — rosterData.ts:160) funnel through this ONE function, so the
// loadInactiveRoster orchestration can be pinned without caring which wrapper
// GREEN reuses.
vi.mock('$lib/profile/profileData', async (importActual) => ({
	...(await importActual<typeof import('$lib/profile/profileData')>()),
	listMyProfiles: listMyProfilesMock
}));
// Sever the $env chain under vitest (same one-liner every data-layer spec uses).
vi.mock('$lib/entu-config', () => ({ ENTU_API_BASE: 'https://api.entu-test.invalid/' }));

import {
	deactivateMember,
	reinstateMember,
	listInactiveMembers,
	loadInactiveRoster,
	loadRosterIncludingArchived,
	loadActiveAndArchivedRosters,
	listDeactivateBlockers
} from './memberLifecycle';

const cfg: EntuCfg = { db: 'testdb', token: 'jwt' };

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), { status });
}

type Call = { url: string; method: string; body?: unknown };

/**
 * GET answers the member entity with whichever status value-ids the caller
 * passes; DELETE/POST succeed; all calls recorded in order — the same harness
 * shape updateRsvpStatus's atomic overwrite (#264) tests use (rsvpData.spec.ts:167).
 */
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
					// The GET may see more of the entity than it asked for — the flip
					// must still only ever touch `status`.
					_parent: [{ _id: 'pv-1', reference: 'sec-alto', entity_type: 'section' }],
					person: [{ _id: 'per-v', reference: 'person-x' }]
				}
			})
		);
	});
	return { fetchImpl, calls };
}

// ── deactivateMember — the status flip, now ATOMIC (#264) ─────────────────────
//
// #264 RED (PO ruling, branch (i), item 3): the old clear-then-set wire
// (GET → DELETE old value(s) → POST new) half-lands EMPTY — the DELETE fires
// BEFORE the POST, so a rejected POST leaves the member with NO status at all,
// worse than a stranded duplicate. Entu's native atomic overwrite (the POST
// entry carrying the old value's `_id` — entu-www "Overwriting a Property
// Value") replaces the value in ONE call: a rejected POST leaves the OLD value
// intact. `status` is not a rightTypes prop, so there is no rights dimension —
// this is pure atomicity.
//
// New pinned wire: GET status value-ids → ONE POST:
//   - one existing value → body EXACTLY [{ _id: <old id>, type:'status', string:<new> }]
//   - no existing value  → body EXACTLY [{ type:'status', string:<new> }]
//   - corrupted 2+ values → the overwrite pairs the FIRST id; extras are
//     deleted at /property/{id} strictly AFTER the POST (never before).
// NO property DELETE is issued anywhere on the normal (≤1-value) path.

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
		// THE pin: nothing was cleared before the write failed. Under the old
		// DELETE-then-POST wire this log held a DELETE of sv-1 — the member was
		// left status-LESS. Now the rejected overwrite changed nothing.
		expect(calls.filter((c) => c.method === 'DELETE')).toEqual([]);
		expect(calls.filter((c) => c.method === 'POST')[0]?.body).toEqual([
			{ _id: 'sv-1', type: 'status', string: 'archived' }
		]);
	});

	it('DONE-WHEN 1: nothing in the entire call log touches _parent, _owner or _editor — no property but status is cleared, no rights change, no reparent', async () => {
		const { fetchImpl, calls } = makeStatusFlipFetch([{ _id: 'sv-1', string: 'active' }]);
		await deactivateMember(cfg, 'member-1', fetchImpl);
		for (const call of calls) {
			// pv-1 is the _parent VALUE id the GET exposed — deleting it would be the
			// silent section-unassignment done-when 1 forbids.
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

// ── reinstateMember — the SAME mechanism, other direction (done-when 4) ───────

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

// ── listInactiveMembers — the archived mirror of listActiveMembers ────────────

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
		// #321 — the reader returns `{ items, total, truncated }`; the MAPPING is what
		// this file pins, the read shape itself lives in rosterData.truncation.spec.ts.
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
		// Identical contract to listActiveMembers (rosterData.spec.ts, same issue):
		// deleting the person in Entu soft-deletes every property referencing it,
		// so `person` is genuinely absent on the wire — the row skips, the rest of
		// the archived view renders.
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
			// FULL toEqual: healthy rows in wire order; `total` stays the server's
			// count; `truncated` false — deriveListRead keys off the RAW wire
			// length, so the client-side drop can never fabricate a truncation.
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

// ── loadInactiveRoster — loadRoster's orchestration over the archived read ────

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
				// #469 — the archived producer emits the SAME one row shape as
				// loadRoster: profileName set on every row (the old "inactive rows
				// never carry profileName" v1 boundary is superseded by #469).
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

// ── listDeactivateBlockers — the refusal read (accepted rec 1) ────────────────

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

	// #255 review r3 F1 — an empty dbEntityId collapses `fetchRights`'s
	// `entity/${id}?props=…` into `entity/?props=…`, entu-api's entity LIST route:
	// a 200 with `entities` and no `entity`, so the rights parse reads nothing and
	// the blockers come back []. That is fail-OPEN wearing "no blockers", on the
	// one check the refuse-don't-strip design rests on — so it is refused here
	// too, not only at the page, and no future caller can reintroduce it.
	it('FAIL LOUD: an EMPTY database entity id REJECTS before any rights read — an unscoped read is not a clean one', async () => {
		listAdminsMock.mockResolvedValue(adminListing([]));
		listLibrariansMock.mockResolvedValue(adminListing([]));
		await expect(listDeactivateBlockers(cfg, 'person-b', '', 'lib-1')).rejects.toThrow();
		expect(listAdminsMock).not.toHaveBeenCalled();
		expect(listLibrariansMock).not.toHaveBeenCalled();
	});
});

// ── #467 — the SAME _created widening as listActiveMembers, on the archived
//    mirror (two files, one shape — grep both before calling this done) ───────

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

	// #467 review F1 — mirrors rosterData.spec.ts: a non-string datetime is the
	// same absence, never a null riding through typed `string`.
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

// ── #469 — the ARCHIVED producers obey roster_show_real_names ─────────────────
//
// Mihkel (issue #469, 2026-09-23): "all places we are showing member names ...
// must obey the admin setting" — SUPERSEDING both the 2026-09-06 #269
// roster-only ruling AND the 'deliberate v1 boundary' that kept
// loadInactiveRoster from ever resolving real names. The overlay is the SAME
// `applyRealNames` loadRoster now runs (exported from rosterData.ts — one
// overlay, not a re-implementation): toggle read via readRosterNamesSetting,
// ONE bulk admin_member_record read, refuse-to-guess on duplicates, fail-soft
// with the console.error breadcrumb, re-sort by displayed name, truncated OR.
//
// `loadRosterIncludingArchived` overlays ONCE over the UNION: two raw member
// reads, union (active wins), then ONE toggle GET + ONE records GET per call —
// never one overlay per sub-list (that would double both reads).

/** One wire for the #469 cases: active + archived member lists, the database
 *  resolve, the toggle and the bulk records read. Profiles stay on
 *  `listMyProfilesMock` like the rest of this file. */
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
			// Profile order: Away Anna, Gone Girl. Displayed order after the
			// overlay: Away Anna, Zoe Zed — member-9 moves BEHIND member-8's
			// unchanged row only if sorting keys off the displayed name.
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
		// Displayed order: Real Rita (archived member-9) before Zoe Zed (active
		// member-1) — profile order (Ada, Gone) would have put member-1 first, so
		// this order is only reachable through the overlaid union sort.
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
		// THE one-pass pin: one toggle read and one records read PER CALL — the
		// naive shape (each sub-producer overlaying its own rows) would double
		// both, and rosterData.realNames.spec.ts pins "exactly ONE records query
		// for the whole roster" for the shared producer.
		const all = requestedUrls(fetchImpl);
		expect(all.filter((u) => u.includes('roster_show_real_names'))).toHaveLength(1);
		expect(all.filter((u) => u.includes('admin_member_record'))).toHaveLength(1);
	});
});

// ── #469 review F1 — the season panel's one-pass producer ──────────────────────
//
// The agenda's season-rate table needs the two halves SEPARATELY (active rows
// carry a rate, archived rows a count only) and used to get them by calling
// `loadRoster` + `loadInactiveRoster` side by side — two overlays, so two
// database resolves, two toggle reads and two `admin_member_record?limit=500`
// reads for one table, with the two halves free to degrade independently into a
// table mixing real names with profile names. `loadActiveAndArchivedRosters` is
// `loadRosterIncludingArchived`'s read stopped one step earlier: ONE overlay
// over both halves, partitioned back by the active read's ids.
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
		// THE pin this function exists for: ONE of each, for BOTH halves — the
		// side-by-side shape it replaces spent two of each per panel open.
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

	// #469 review F1 (second round) — truncation is PER-HALF, because the two
	// shortnesses are facts about different things. This function shipped with ONE
	// combined flag on both halves; the /roster page (two independently-closable
	// lists) cannot recover the per-half fact from it, and a short ARCHIVED read
	// left its notice standing over the ACTIVE roster after the panel closed —
	// the claim-about-a-list-no-longer-on-screen #321 review F3 removed. The
	// season-rate table's "one table, one statement" is still exactly right, and
	// it is still made — by the table, OR-ing the two halves at its call site.
	it('a short ARCHIVED member read marks the ARCHIVED half only — it says nothing about the active list', async () => {
		listMyProfilesMock.mockImplementation((_cfg: unknown, personId: string) =>
			Promise.resolve(profilesByPerson[personId] ?? [])
		);
		const fetchImpl = vi.fn().mockImplementation((url: string) => {
			const u = String(url);
			if (u.includes('_type.string=member') && u.includes('status.string=archived')) {
				// 812 on the server, one row on the wire — short.
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
		// `total` stays per-half: each read's own server count.
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

	// The one shortness that DOES belong to both: the records read is the single
	// overlay serving both halves, and a short one reverts SOME rows to profile
	// names wherever they are shown — byte-indistinguishable from "she has no
	// record", in either list.
	it('a short RECORDS read marks BOTH halves — one overlay, one degrade, two lists affected', async () => {
		listMyProfilesMock.mockImplementation((_cfg: unknown, personId: string) =>
			Promise.resolve(profilesByPerson[personId] ?? [])
		);
		const fetchImpl = vi.fn().mockImplementation((url: string) => {
			const u = String(url);
			if (u.includes('_type.string=admin_member_record')) {
				// 900 on the server, one row on the wire — short.
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
		// Non-vacuous: the overlay really did run and really did rename her.
		expect(active.items.map((r) => r.name)).toEqual(['Zoe Zed']);
		expect(active.truncated).toBe(true);
		expect(inactive.truncated).toBe(true);
	});
});


// (*MVOX:Tallis*)
// (*MVOX:Tallis* — #467 RED: archived-mirror _created widening, author dropped)
// (*MVOX:Josquin* — #467 review F1: non-string _created datetime → undefined)
// (*MVOX:Tallis* — #469 RED: archived producers obey the real-names setting, one overlay pass)
// (*MVOX:Palestrina* — #469 review F1: loadActiveAndArchivedRosters, one overlay for the season table)
