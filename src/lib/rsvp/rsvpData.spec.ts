import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetTypeIdCache, type EntuCfg } from '$lib/seasons/entuSeasons';
import { findMyMemberId, createRsvp, updateRsvpStatus, deleteRsvp } from './rsvpData';

const cfg: EntuCfg = { db: 'testdb', token: 'jwt' };

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), { status });
}

beforeEach(() => {
	resetTypeIdCache();
});

// ── findMyMemberId ────────────────────────────────────────────────────────────
// DE-FANNED to match listSeasons/listRehearsals: no orgId param — person +
// status=active alone resolves the singer's active member row in the collective.

describe('findMyMemberId', () => {
	it('queries member type + person ref + status=active, WITHOUT an org _parent filter', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(json({ entities: [{ _id: 'member-1' }] }));
		await findMyMemberId(cfg, 'person-p', fetchImpl);
		const url = String(fetchImpl.mock.calls[0][0]);
		expect(url).toContain('_type.string=member');
		expect(url).toContain('person.reference=person-p');
		expect(url).toContain('status.string=active');
		expect(url).not.toContain('_parent.reference'); // de-fanned: no org scoping
	});

	it('returns the first entity _id when found', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(json({ entities: [{ _id: 'member-42' }] }));
		const id = await findMyMemberId(cfg, 'person-p', fetchImpl);
		expect(id).toBe('member-42');
	});

	it('returns null when entities array is empty', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(json({ entities: [] }));
		const id = await findMyMemberId(cfg, 'person-p', fetchImpl);
		expect(id).toBeNull();
	});

	it('throws on a non-2xx response', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(json({}, 403));
		await expect(findMyMemberId(cfg, 'person-p', fetchImpl)).rejects.toThrow(/403/);
	});
});

// ── createRsvp ────────────────────────────────────────────────────────────────

describe('createRsvp', () => {
	/** Type-resolution GET (`_type.string=entity`) + entity-create POST. */
	function makeFetchMock(resolvedTypeId = 'rsvp-type-id') {
		return vi.fn().mockImplementation((url: string) => {
			if (url.includes('_type.string=entity')) {
				return Promise.resolve(json({ entities: [{ _id: resolvedTypeId }] }));
			}
			return Promise.resolve(json({ _id: 'new-rsvp-1' }));
		});
	}

	function createCallBody(fetchImpl: ReturnType<typeof makeFetchMock>) {
		const call = (fetchImpl.mock.calls as Array<[string, RequestInit]>).find(
			([url]) => !url.includes('_type.string=entity')
		)!;
		return JSON.parse(String(call[1].body)) as Array<{ type: string; reference?: string; string?: string }>;
	}

	it.each([
		['going', 'going_ref', ['not_going_ref', 'maybe_ref', 'late_ref']],
		['not_going', 'not_going_ref', ['going_ref', 'maybe_ref', 'late_ref']],
		['maybe', 'maybe_ref', ['going_ref', 'not_going_ref', 'late_ref']],
		['late', 'late_ref', ['going_ref', 'not_going_ref', 'maybe_ref']]
	] as const)(
		'status=%s → POST body full-shape has exactly one sentinel (%s) and NOT the other three',
		async (status, sentinelType, absentSentinels) => {
			const fetchImpl = makeFetchMock('rsvp-type-42');
			await createRsvp(
				cfg,
				{ personId: 'person-p', eventId: 'event-e', memberId: 'member-m', status },
				fetchImpl
			);
			const body = createCallBody(fetchImpl);

			// FULL SET check — every required prop present, exactly one sentinel present.
			expect(body).toEqual(
				expect.arrayContaining([
					{ type: '_type', reference: 'rsvp-type-42' },
					{ type: '_parent', reference: 'person-p' },
					{ type: 'event', reference: 'event-e' },
					{ type: 'member', reference: 'member-m' },
					{ type: 'status', string: status },
					{ type: sentinelType, reference: 'event-e' },
					{ type: '_sharing', string: 'private' }
				])
			);
			const presentTypes = body.map((p) => p.type);
			for (const absent of absentSentinels) {
				expect(presentTypes).not.toContain(absent);
			}
			expect(presentTypes.filter((t) => t.endsWith('_ref'))).toEqual([sentinelType]);
		}
	);

	it('POST body contains explicit _sharing:private (Pérotin live-probe finding: without it, Entu auto-inherits domain-shared from the person parent, leaking the answer)', async () => {
		const fetchImpl = makeFetchMock();
		await createRsvp(
			cfg,
			{ personId: 'person-p', eventId: 'event-e', memberId: 'member-m', status: 'going' },
			fetchImpl
		);
		const body = createCallBody(fetchImpl);
		expect(body).toEqual(expect.arrayContaining([{ type: '_sharing', string: 'private' }]));
	});

	it('returns the created rsvp _id', async () => {
		const fetchImpl = makeFetchMock();
		const id = await createRsvp(
			cfg,
			{ personId: 'person-p', eventId: 'event-e', memberId: 'member-m', status: 'not_going' },
			fetchImpl
		);
		expect(id).toBe('new-rsvp-1');
	});

	it('throws on a non-2xx create response (status surfaced)', async () => {
		const fetchImpl = vi.fn().mockImplementation((url: string) => {
			if (url.includes('_type.string=entity')) {
				return Promise.resolve(json({ entities: [{ _id: 'type-id' }] }));
			}
			return Promise.resolve(json({}, 403));
		});
		await expect(
			createRsvp(
				cfg,
				{ personId: 'person-p', eventId: 'event-e', memberId: 'member-m', status: 'going' },
				fetchImpl
			)
		).rejects.toThrow(/403/);
	});
});

// ── updateRsvpStatus ──────────────────────────────────────────────────────────

describe('updateRsvpStatus', () => {
	type Call = { url: string; method: string; body?: unknown };

	/**
	 * GET returns an rsvp entity carrying whichever status/sentinel value-ids the
	 * caller passes in `existing` (defaults to a single going_ref — the normal,
	 * non-corrupted case). DELETE/POST both succeed. All calls recorded in order.
	 */
	function makeMockFetch(existing: {
		statusValueId?: string;
		eventRef?: string;
		sentinels?: Partial<Record<'going_ref' | 'not_going_ref' | 'maybe_ref' | 'late_ref', string>>;
	}) {
		const { statusValueId = 'sv-1', eventRef = 'event-abc', sentinels = { going_ref: 'sent-1' } } = existing;
		const calls: Call[] = [];
		const fetchImpl = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
			const method = init?.method ?? 'GET';
			calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
			if (method === 'DELETE') return Promise.resolve(json({}));
			if (method === 'POST') return Promise.resolve(json({}));
			const entity: Record<string, unknown> = {
				_id: 'rsvp-1',
				status: [{ _id: statusValueId, string: 'going' }],
				event: [{ reference: eventRef }]
			};
			for (const [type, valueId] of Object.entries(sentinels)) {
				entity[type] = [{ _id: valueId }];
			}
			return Promise.resolve(json({ entity }));
		});
		return { fetchImpl, calls };
	}

	it('GET requests props=status,event,going_ref,not_going_ref,maybe_ref,late_ref', async () => {
		const { fetchImpl } = makeMockFetch({});
		await updateRsvpStatus(cfg, 'rsvp-1', 'not_going', fetchImpl);
		const getCall = (fetchImpl.mock.calls as Array<[string, RequestInit?]>).find(
			([, init]) => !init?.method || init.method === 'GET'
		)!;
		const url = String(getCall[0]);
		for (const prop of ['status', 'event', 'going_ref', 'not_going_ref', 'maybe_ref', 'late_ref']) {
			expect(url).toContain(prop);
		}
	});

	it('order: GET → DELETE(s) → POST', async () => {
		const { fetchImpl, calls } = makeMockFetch({});
		await updateRsvpStatus(cfg, 'rsvp-1', 'not_going', fetchImpl);
		expect(calls[0].method).toBe('GET');
		const deleteIdx = calls.findIndex((c) => c.method === 'DELETE');
		const postIdx = calls.findIndex((c) => c.method === 'POST');
		expect(deleteIdx).toBeGreaterThan(0);
		expect(postIdx).toBeGreaterThan(deleteIdx);
	});

	it('DELETE targets /property/{value-id} (NOT /entity/{id})', async () => {
		const { fetchImpl, calls } = makeMockFetch({ statusValueId: 'sv-old' });
		await updateRsvpStatus(cfg, 'rsvp-1', 'late', fetchImpl);
		const deleteUrls = calls.filter((c) => c.method === 'DELETE').map((c) => c.url);
		expect(deleteUrls.some((u) => u.includes('sv-old') && u.includes('property'))).toBe(true);
		expect(deleteUrls.some((u) => /entity\/sv-old/.test(u))).toBe(false);
	});

	it('FULL SET: DELETEs the old status value-id AND every existing sentinel value-id, even when more than one is present (corrupted-state defense)', async () => {
		const { fetchImpl, calls } = makeMockFetch({
			statusValueId: 'sv-old',
			sentinels: { going_ref: 'sent-going', late_ref: 'sent-late' } // two present at once — should never happen, but the delete must be generic
		});
		await updateRsvpStatus(cfg, 'rsvp-1', 'maybe', fetchImpl);
		const deleteUrls = calls.filter((c) => c.method === 'DELETE').map((c) => c.url);
		expect(deleteUrls.some((u) => u.includes('sv-old'))).toBe(true);
		expect(deleteUrls.some((u) => u.includes('sent-going'))).toBe(true);
		expect(deleteUrls.some((u) => u.includes('sent-late'))).toBe(true);
		expect(deleteUrls).toHaveLength(3);
	});

	it('FULL SET: after update, POST carries exactly the new status + its matching sentinel — no other status/_ref prop', async () => {
		const { fetchImpl, calls } = makeMockFetch({ sentinels: { going_ref: 'sent-1' } });
		await updateRsvpStatus(cfg, 'rsvp-1', 'maybe', fetchImpl);
		const postBodies = calls
			.filter((c) => c.method === 'POST')
			.flatMap((c) => c.body as Array<{ type: string; string?: string; reference?: string }>);
		expect(postBodies).toEqual(
			expect.arrayContaining([
				{ type: 'status', string: 'maybe' },
				{ type: 'maybe_ref', reference: 'event-abc' }
			])
		);
		expect(postBodies).toHaveLength(2); // exactly these two props, nothing else
	});

	it('sentinel reference = event id read from the GET (not from caller input — updateRsvpStatus takes no eventId)', async () => {
		const { fetchImpl, calls } = makeMockFetch({ eventRef: 'event-from-get' });
		await updateRsvpStatus(cfg, 'rsvp-1', 'late', fetchImpl);
		const postBodies = calls
			.filter((c) => c.method === 'POST')
			.flatMap((c) => c.body as Array<{ type: string; reference?: string }>);
		expect(postBodies.find((p) => p.type === 'late_ref')?.reference).toBe('event-from-get');
	});

	it('throws on a non-2xx GET response', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(json({}, 403));
		await expect(updateRsvpStatus(cfg, 'rsvp-1', 'going', fetchImpl)).rejects.toThrow(/403/);
	});
});

// ── deleteRsvp (clear) ────────────────────────────────────────────────────────

describe('deleteRsvp', () => {
	it('sends DELETE {db}/entity/{rsvpId}', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(json({}));
		await deleteRsvp(cfg, 'rsvp-xyz', fetchImpl);
		const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
		expect(url).toContain('entity');
		expect(url).toContain('rsvp-xyz');
		expect(init.method).toBe('DELETE');
	});

	it('throws on a non-2xx response (status surfaced)', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(json({}, 403));
		await expect(deleteRsvp(cfg, 'rsvp-xyz', fetchImpl)).rejects.toThrow(/403/);
	});
});

// (*MVOX:Tallis*)
