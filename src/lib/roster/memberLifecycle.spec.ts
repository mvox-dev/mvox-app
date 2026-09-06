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
		const rows = await listInactiveMembers(cfg, fetchImpl);
		expect(rows).toEqual([
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
});

// ── loadInactiveRoster — loadRoster's orchestration over the archived read ────

describe('loadInactiveRoster', () => {
	beforeEach(() => {
		listMyProfilesMock.mockReset();
	});

	it('FULL SHAPE: resolves names via the shared-profile read + toRosterRow (#28 gate), carrying sectionIds through — the surface must show her section', async () => {
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
		const rows = await loadInactiveRoster(cfg, fetchImpl);
		expect(rows).toEqual([
			{
				memberId: 'member-9',
				personId: 'person-9',
				name: 'Gone Girl',
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
		const rows = await loadInactiveRoster(cfg, fetchImpl);
		expect(rows).toEqual([]);
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

// (*MVOX:Tallis*)
