import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetTypeIdCache, type EntuCfg } from '$lib/seasons/entuSeasons';
import {
	createAttendance,
	updateAttendanceStatus,
	deleteAttendance,
	listAttendance,
	listAllRsvpsForEvent,
	attendanceByMemberId,
	type EventAttendance
} from './attendanceData';

// #84 TA.3 RED — the attendance write/read data layer. Mirrors rsvpData.ts
// EXACTLY, with the structural differences pinned by #77's ruling:
//
//   - `attendance` is a CHILD OF EVENT (`_parent` = eventId) — the conductor
//     records it, so it hangs off the event, not the singer's person (the
//     participation split: rsvp child-of-person/member-created, attendance
//     child-of-event/conductor-created).
//   - status enum is present | absent | late (three, not four).
//   - three sentinels: present_ref / absent_ref / late_ref, each carrying the
//     EVENT id as reference — for attendance the event IS `_parent`, so the
//     sentinel's reference and the parent coincide (unlike rsvp, where the
//     sentinel points at the separate `event` prop).
//   - `_sharing: domain` EXPLICIT at create time per v4E (#82 widen: the whole
//     collective may see who showed up, and the singer can read her own row).
//   - per-tap immediate writes — NOT batch. Each toggle tap is one createAttendance /
//     updateAttendanceStatus / deleteAttendance round-trip; there is no "save all"
//     payload shape anywhere in this module's API.

const cfg: EntuCfg = { db: 'testdb', token: 'jwt' };

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), { status });
}

beforeEach(() => {
	resetTypeIdCache();
});

// ── createAttendance ──────────────────────────────────────────────────────────

describe('createAttendance', () => {
	/** Type-resolution GET (`_type.string=entity`) + entity-create POST. */
	function makeFetchMock(resolvedTypeId = 'attendance-type-id') {
		return vi.fn().mockImplementation((url: string) => {
			if (url.includes('_type.string=entity')) {
				return Promise.resolve(json({ entities: [{ _id: resolvedTypeId }] }));
			}
			return Promise.resolve(json({ _id: 'new-attendance-1' }));
		});
	}

	function createCallBody(fetchImpl: ReturnType<typeof makeFetchMock>) {
		const call = (fetchImpl.mock.calls as Array<[string, RequestInit]>).find(
			([url]) => !url.includes('_type.string=entity')
		)!;
		return JSON.parse(String(call[1].body)) as Array<{ type: string; reference?: string; string?: string }>;
	}

	it.each([
		['present', 'present_ref', ['absent_ref', 'late_ref']],
		['absent', 'absent_ref', ['present_ref', 'late_ref']],
		['late', 'late_ref', ['present_ref', 'absent_ref']]
	] as const)(
		'status=%s → POST body full-shape has exactly one sentinel (%s = eventId) and NOT the other two',
		async (status, sentinelType, absentSentinels) => {
			const fetchImpl = makeFetchMock('attendance-type-42');
			await createAttendance(
				cfg,
				{ eventId: 'event-e', memberId: 'member-m', status },
				fetchImpl
			);
			const body = createCallBody(fetchImpl);

			// FULL SET check — every required prop present, exactly one sentinel present.
			// `_parent` is the EVENT (attendance is a child of event, #77 participation
			// split) — there is no personId anywhere in this payload.
			expect(body).toEqual(
				expect.arrayContaining([
					{ type: '_type', reference: 'attendance-type-42' },
					{ type: '_parent', reference: 'event-e' },
					{ type: 'member', reference: 'member-m' },
					{ type: 'status', string: status },
					{ type: sentinelType, reference: 'event-e' },
					{ type: '_sharing', string: 'domain' }
				])
			);
			const presentTypes = body.map((p) => p.type);
			for (const absent of absentSentinels) {
				expect(presentTypes).not.toContain(absent);
			}
			expect(presentTypes.filter((t) => t.endsWith('_ref'))).toEqual([sentinelType]);
		}
	);

	it('resolves the attendance type id and sends _type as a REFERENCE, never a string (pinned wire-shape)', async () => {
		const fetchImpl = makeFetchMock('attendance-type-42');
		await createAttendance(
			cfg,
			{ eventId: 'event-e', memberId: 'member-m', status: 'present' },
			fetchImpl
		);
		const typeResolutionUrl = String(fetchImpl.mock.calls[0][0]);
		expect(typeResolutionUrl).toContain('_type.string=entity');
		expect(typeResolutionUrl).toContain('name.string=attendance');
		const body = createCallBody(fetchImpl);
		const typeProp = body.find((p) => p.type === '_type')!;
		expect(typeProp.reference).toBe('attendance-type-42');
		expect(typeProp.string).toBeUndefined();
	});

	it('POST body contains explicit _sharing:domain — set by the creating client per v4E, never inherit-reliant', async () => {
		const fetchImpl = makeFetchMock();
		await createAttendance(
			cfg,
			{ eventId: 'event-e', memberId: 'member-m', status: 'absent' },
			fetchImpl
		);
		const body = createCallBody(fetchImpl);
		expect(body).toEqual(expect.arrayContaining([{ type: '_sharing', string: 'domain' }]));
		// A body carrying BOTH domain and private would also satisfy arrayContaining —
		// pin private's absence separately.
		expect(body).not.toEqual(expect.arrayContaining([{ type: '_sharing', string: 'private' }]));
	});

	it('returns the created attendance _id', async () => {
		const fetchImpl = makeFetchMock();
		const id = await createAttendance(
			cfg,
			{ eventId: 'event-e', memberId: 'member-m', status: 'late' },
			fetchImpl
		);
		expect(id).toBe('new-attendance-1');
	});

	it('throws on a non-2xx create response (status surfaced)', async () => {
		const fetchImpl = vi.fn().mockImplementation((url: string) => {
			if (url.includes('_type.string=entity')) {
				return Promise.resolve(json({ entities: [{ _id: 'type-id' }] }));
			}
			return Promise.resolve(json({}, 403));
		});
		await expect(
			createAttendance(cfg, { eventId: 'event-e', memberId: 'member-m', status: 'present' }, fetchImpl)
		).rejects.toThrow(/403/);
	});
});

// ── updateAttendanceStatus ────────────────────────────────────────────────────
// Mirrors updateRsvpStatus: GET current entity → DELETE old status value + every
// existing sentinel value → POST new status + its matching sentinel. The sentinel
// reference for attendance is the EVENT id, which IS the entity's `_parent` — read
// from the GET, never from the caller (the function takes no eventId).

describe('updateAttendanceStatus', () => {
	type Call = { url: string; method: string; body?: unknown };

	/**
	 * GET returns an attendance entity carrying whichever status/sentinel value-ids
	 * the caller passes (defaults: single present_ref — normal, non-corrupted case).
	 * DELETE/POST both succeed. All calls recorded in order.
	 */
	function makeMockFetch(existing: {
		statusValueId?: string;
		parentRef?: string;
		sentinels?: Partial<Record<'present_ref' | 'absent_ref' | 'late_ref', string>>;
	}) {
		const {
			statusValueId = 'sv-1',
			parentRef = 'event-abc',
			sentinels = { present_ref: 'sent-1' }
		} = existing;
		const calls: Call[] = [];
		const fetchImpl = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
			const method = init?.method ?? 'GET';
			calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
			if (method === 'DELETE') return Promise.resolve(json({}));
			if (method === 'POST') return Promise.resolve(json({}));
			const entity: Record<string, unknown> = {
				_id: 'attendance-1',
				status: [{ _id: statusValueId, string: 'present' }],
				_parent: [{ reference: parentRef }]
			};
			for (const [type, valueId] of Object.entries(sentinels)) {
				entity[type] = [{ _id: valueId }];
			}
			return Promise.resolve(json({ entity }));
		});
		return { fetchImpl, calls };
	}

	it('GET requests props=status,_parent,present_ref,absent_ref,late_ref', async () => {
		const { fetchImpl } = makeMockFetch({});
		await updateAttendanceStatus(cfg, 'attendance-1', 'absent', fetchImpl);
		const getCall = (fetchImpl.mock.calls as Array<[string, RequestInit?]>).find(
			([, init]) => !init?.method || init.method === 'GET'
		)!;
		const url = String(getCall[0]);
		for (const prop of ['status', '_parent', 'present_ref', 'absent_ref', 'late_ref']) {
			expect(url).toContain(prop);
		}
	});

	it('order: GET → DELETE(s) → POST', async () => {
		const { fetchImpl, calls } = makeMockFetch({});
		await updateAttendanceStatus(cfg, 'attendance-1', 'absent', fetchImpl);
		expect(calls[0].method).toBe('GET');
		const deleteIdx = calls.findIndex((c) => c.method === 'DELETE');
		const postIdx = calls.findIndex((c) => c.method === 'POST');
		expect(deleteIdx).toBeGreaterThan(0);
		expect(postIdx).toBeGreaterThan(deleteIdx);
	});

	it('DELETE targets /property/{value-id} (NOT /entity/{id}) — the wire-shape split', async () => {
		const { fetchImpl, calls } = makeMockFetch({ statusValueId: 'sv-old' });
		await updateAttendanceStatus(cfg, 'attendance-1', 'late', fetchImpl);
		const deleteUrls = calls.filter((c) => c.method === 'DELETE').map((c) => c.url);
		expect(deleteUrls.some((u) => u.includes('sv-old') && u.includes('property'))).toBe(true);
		expect(deleteUrls.some((u) => /entity\/sv-old/.test(u))).toBe(false);
	});

	it('FULL SET: DELETEs the old status value-id AND every existing sentinel value-id, even when more than one is present (corrupted-state defense)', async () => {
		const { fetchImpl, calls } = makeMockFetch({
			statusValueId: 'sv-old',
			sentinels: { present_ref: 'sent-present', late_ref: 'sent-late' } // two at once — should never happen; the delete must be generic
		});
		await updateAttendanceStatus(cfg, 'attendance-1', 'absent', fetchImpl);
		const deleteUrls = calls.filter((c) => c.method === 'DELETE').map((c) => c.url);
		expect(deleteUrls.some((u) => u.includes('sv-old'))).toBe(true);
		expect(deleteUrls.some((u) => u.includes('sent-present'))).toBe(true);
		expect(deleteUrls.some((u) => u.includes('sent-late'))).toBe(true);
		expect(deleteUrls).toHaveLength(3);
	});

	it('FULL SET: after update, POST carries exactly the new status + its matching sentinel — no other status/_ref prop', async () => {
		const { fetchImpl, calls } = makeMockFetch({ sentinels: { present_ref: 'sent-1' } });
		await updateAttendanceStatus(cfg, 'attendance-1', 'absent', fetchImpl);
		const postBodies = calls
			.filter((c) => c.method === 'POST')
			.flatMap((c) => c.body as Array<{ type: string; string?: string; reference?: string }>);
		expect(postBodies).toEqual(
			expect.arrayContaining([
				{ type: 'status', string: 'absent' },
				{ type: 'absent_ref', reference: 'event-abc' }
			])
		);
		expect(postBodies).toHaveLength(2); // exactly these two props, nothing else
	});

	it('sentinel reference = the event id read from the GET `_parent` (not from caller input — updateAttendanceStatus takes no eventId)', async () => {
		const { fetchImpl, calls } = makeMockFetch({ parentRef: 'event-from-get' });
		await updateAttendanceStatus(cfg, 'attendance-1', 'late', fetchImpl);
		const postBodies = calls
			.filter((c) => c.method === 'POST')
			.flatMap((c) => c.body as Array<{ type: string; reference?: string }>);
		expect(postBodies.find((p) => p.type === 'late_ref')?.reference).toBe('event-from-get');
	});

	it('throws on a non-2xx GET response', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(json({}, 403));
		await expect(updateAttendanceStatus(cfg, 'attendance-1', 'present', fetchImpl)).rejects.toThrow(
			/403/
		);
	});
});

// ── deleteAttendance (tap active to clear) ────────────────────────────────────
// The status enum has no "unmarked" value — deletion IS the "no record"
// representation, exactly like deleteRsvp. This is also what keeps the three
// sentinels from surviving as orphan phantom counts.

describe('deleteAttendance', () => {
	it('sends DELETE {db}/entity/{attendanceId}', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(json({}));
		await deleteAttendance(cfg, 'attendance-xyz', fetchImpl);
		const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
		expect(url).toContain('entity');
		expect(url).toContain('attendance-xyz');
		expect(init.method).toBe('DELETE');
	});

	it('throws on a non-2xx response (status surfaced)', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(json({}, 403));
		await expect(deleteAttendance(cfg, 'attendance-xyz', fetchImpl)).rejects.toThrow(/403/);
	});
});

// ── listAttendance ────────────────────────────────────────────────────────────
// attendance is a child of event — `_parent.reference=eventId` alone scopes the
// read to this event's records (the exact mirror of listMyRsvps' child-of-person
// scoping).

describe('listAttendance', () => {
	it("queries _type.string=attendance&_parent.reference=<eventId> — native under the event, encoded", async () => {
		const fetchImpl = vi.fn().mockResolvedValue(json({ entities: [] }));
		await listAttendance(cfg, 'event e', fetchImpl); // space forces encoding to be observable
		const url = String(fetchImpl.mock.calls[0][0]);
		expect(url).toContain('_type.string=attendance');
		expect(url).toContain(`_parent.reference=${encodeURIComponent('event e')}`);
	});

	it('maps entities to full-shape EventAttendance[]', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(
			json({
				entities: [
					{ _id: 'att-1', member: [{ reference: 'member-a' }], status: [{ string: 'present' }] },
					{ _id: 'att-2', member: [{ reference: 'member-b' }], status: [{ string: 'absent' }] }
				]
			})
		);
		const records = await listAttendance(cfg, 'event-e', fetchImpl);
		expect(records).toEqual([
			{ attendanceId: 'att-1', memberId: 'member-a', status: 'present' },
			{ attendanceId: 'att-2', memberId: 'member-b', status: 'absent' }
		]);
	});

	it('returns [] when entities array is empty', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(json({ entities: [] }));
		const records = await listAttendance(cfg, 'event-e', fetchImpl);
		expect(records).toEqual([]);
	});

	it('DROPS rows with missing member (non-owner read path — prop-def _sharing not widened) instead of fabricating memberId=""', async () => {
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const fetchImpl = vi.fn().mockResolvedValue(
			json({
				entities: [
					// Row visible to non-owner: _id present but member/status in private bucket
					{ _id: 'att-invisible', status: [{ string: 'present' }] },
					// Normal row
					{ _id: 'att-ok', member: [{ reference: 'member-a' }], status: [{ string: 'absent' }] }
				]
			})
		);
		const records = await listAttendance(cfg, 'event-e', fetchImpl);
		expect(records).toEqual([{ attendanceId: 'att-ok', memberId: 'member-a', status: 'absent' }]);
		expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('att-invisible'));
		warnSpy.mockRestore();
	});

	it('DROPS rows with missing status (non-owner read path — prop-def _sharing not widened) instead of defaulting to "present"', async () => {
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const fetchImpl = vi.fn().mockResolvedValue(
			json({
				entities: [
					{ _id: 'att-no-status', member: [{ reference: 'member-a' }] }
				]
			})
		);
		const records = await listAttendance(cfg, 'event-e', fetchImpl);
		expect(records).toEqual([]);
		expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('att-no-status'));
		warnSpy.mockRestore();
	});

	it('DROPS rows with BOTH member and status missing — no fabrication, just a warn', async () => {
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const fetchImpl = vi.fn().mockResolvedValue(
			json({
				entities: [{ _id: 'att-ghost' }]
			})
		);
		const records = await listAttendance(cfg, 'event-e', fetchImpl);
		expect(records).toEqual([]);
		expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('att-ghost'));
		warnSpy.mockRestore();
	});

	it('throws on a non-2xx response', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(json({}, 403));
		await expect(listAttendance(cfg, 'event-e', fetchImpl)).rejects.toThrow(/403/);
	});
});

// ── listAllRsvpsForEvent ──────────────────────────────────────────────────────
// The conductor's RSVP→attendance comparison read (#82 made rsvps domain-visible
// exactly for this). rsvp is a child of PERSON, so the event scoping goes through
// the `event` reference prop — NOT `_parent` (that would scope to a person and
// return nothing). Cross-person by design: the conductor reads every member's
// domain-tier answer for THIS event.

describe('listAllRsvpsForEvent', () => {
	it('queries _type.string=rsvp&event.reference=<eventId> — by event ref, NOT _parent (rsvp is child of person)', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(json({ entities: [] }));
		await listAllRsvpsForEvent(cfg, 'event e', fetchImpl); // space forces encoding to be observable
		const url = String(fetchImpl.mock.calls[0][0]);
		expect(url).toContain('_type.string=rsvp');
		expect(url).toContain(`event.reference=${encodeURIComponent('event e')}`);
		expect(url).not.toContain('_parent.reference');
	});

	it('maps entities to full-shape rows keyed by member — the comparison joins on memberId', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(
			json({
				entities: [
					{ _id: 'rsvp-1', member: [{ reference: 'member-a' }], status: [{ string: 'going' }] },
					{ _id: 'rsvp-2', member: [{ reference: 'member-b' }], status: [{ string: 'not_going' }] }
				]
			})
		);
		const rsvps = await listAllRsvpsForEvent(cfg, 'event-e', fetchImpl);
		expect(rsvps).toEqual([
			{ rsvpId: 'rsvp-1', memberId: 'member-a', status: 'going' },
			{ rsvpId: 'rsvp-2', memberId: 'member-b', status: 'not_going' }
		]);
	});

	it('returns [] when entities array is empty', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(json({ entities: [] }));
		const rsvps = await listAllRsvpsForEvent(cfg, 'event-e', fetchImpl);
		expect(rsvps).toEqual([]);
	});

	it('DROPS rows with missing member (non-owner read — prop-def _sharing not widened) instead of fabricating memberId=""', async () => {
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const fetchImpl = vi.fn().mockResolvedValue(
			json({
				entities: [
					{ _id: 'rsvp-invisible', status: [{ string: 'going' }] },
					{ _id: 'rsvp-ok', member: [{ reference: 'member-a' }], status: [{ string: 'not_going' }] }
				]
			})
		);
		const rsvps = await listAllRsvpsForEvent(cfg, 'event-e', fetchImpl);
		expect(rsvps).toEqual([{ rsvpId: 'rsvp-ok', memberId: 'member-a', status: 'not_going' }]);
		expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('rsvp-invisible'));
		warnSpy.mockRestore();
	});

	it('DROPS rows with missing status (non-owner read — prop-def _sharing not widened) instead of defaulting to "going"', async () => {
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const fetchImpl = vi.fn().mockResolvedValue(
			json({
				entities: [
					{ _id: 'rsvp-no-status', member: [{ reference: 'member-a' }] }
				]
			})
		);
		const rsvps = await listAllRsvpsForEvent(cfg, 'event-e', fetchImpl);
		expect(rsvps).toEqual([]);
		expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('rsvp-no-status'));
		warnSpy.mockRestore();
	});

	it('DROPS rows with BOTH member and status missing — no fabrication, just a warn', async () => {
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const fetchImpl = vi.fn().mockResolvedValue(
			json({
				entities: [{ _id: 'rsvp-ghost' }]
			})
		);
		const rsvps = await listAllRsvpsForEvent(cfg, 'event-e', fetchImpl);
		expect(rsvps).toEqual([]);
		expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('rsvp-ghost'));
		warnSpy.mockRestore();
	});

	it('throws on a non-2xx response', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(json({}, 403));
		await expect(listAllRsvpsForEvent(cfg, 'event-e', fetchImpl)).rejects.toThrow(/403/);
	});
});

// ── attendanceByMemberId ──────────────────────────────────────────────────────
// Pure mapping — no fetch. The panel's per-member toggle rows read initial state
// off this map; a member with no record is ABSENT (renders unmarked), never
// defaulted to any status. Exact mirror of rsvpsByEventId.

describe('attendanceByMemberId', () => {
	it('maps each record by its member id', () => {
		const records: EventAttendance[] = [
			{ attendanceId: 'att-1', memberId: 'member-a', status: 'present' },
			{ attendanceId: 'att-2', memberId: 'member-b', status: 'late' }
		];
		const map = attendanceByMemberId(records);
		expect(map).toEqual({
			'member-a': { attendanceId: 'att-1', status: 'present' },
			'member-b': { attendanceId: 'att-2', status: 'late' }
		});
	});

	it('a member with no record is ABSENT from the map — not defaulted to any status', () => {
		const records: EventAttendance[] = [
			{ attendanceId: 'att-1', memberId: 'member-a', status: 'present' }
		];
		const map = attendanceByMemberId(records);
		expect('member-unmarked' in map).toBe(false);
		expect(map['member-unmarked']).toBeUndefined();
	});

	it('returns {} for an empty list', () => {
		expect(attendanceByMemberId([])).toEqual({});
	});
});

// (*MVOX:Tallis*)
