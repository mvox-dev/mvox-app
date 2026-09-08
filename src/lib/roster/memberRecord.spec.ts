// #268 RED — the admin_member_record data layer (wire contract). The module's
// exports are stubs that throw 'not implemented', so every assertion below
// FAILS until GREEN.
//
// Real member PII rides through this layer on a live pilot (crede): the last
// describe pins that thrown messages carry static strings + status codes only,
// never a field value.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EntuCfg } from '$lib/seasons/entuSeasons';

// resolveTypeId is mocked so the create test's fetch mock only ever sees the
// create POST itself (the type lookup is the resolver's own, cached, concern).
const { resolveTypeIdMock, replaceEntityPropertyMock } = vi.hoisted(() => ({
	resolveTypeIdMock: vi.fn(),
	replaceEntityPropertyMock: vi.fn()
}));
vi.mock('$lib/seasons/entuSeasons', async (importActual) => ({
	...(await importActual<typeof import('$lib/seasons/entuSeasons')>()),
	resolveTypeId: resolveTypeIdMock
}));
vi.mock('$lib/entu/replaceProperty', async (importActual) => ({
	...(await importActual<typeof import('$lib/entu/replaceProperty')>()),
	replaceEntityProperty: replaceEntityPropertyMock
}));

import {
	loadMemberRecord,
	createMemberRecord,
	updateMemberRecord,
	birthdateToWire,
	birthdateFromWire,
	MemberRecordPartialSaveError
} from './memberRecord';

const cfg: EntuCfg = { db: 'polyphony', token: 'jwt' };

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), { status });
}

beforeEach(() => {
	resolveTypeIdMock.mockReset().mockResolvedValue('type-amr');
	// Test-hygiene fix (sibling convention: memberLifecycle.spec.ts's
	// loadInactiveRoster/listDeactivateBlockers describes reset their hoisted
	// mocks before each `it`) — several tests below assert an EXACT
	// `toHaveBeenCalledTimes`, which only holds per-test when the invocation
	// history doesn't carry over from the previous one.
	replaceEntityPropertyMock.mockReset().mockResolvedValue(undefined);
});

// ── READ: check-then-create + editor load, ONE query ─────────────────────────

describe('loadMemberRecord — ONE db-scoped query (check-then-create + editor load share it)', () => {
	it('URL: _type.string=admin_member_record, person.reference={personId}, props=name,phone,email,birthdate,id_code, limit=10, against cfg.db (#285: the fifth field joins the ONE projection)', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(json({ entities: [] }));
		await loadMemberRecord(cfg, 'pp-2', fetchImpl);
		expect(fetchImpl).toHaveBeenCalledTimes(1);
		const url = String(fetchImpl.mock.calls[0][0]);
		expect(url).toContain('_type.string=admin_member_record');
		expect(url).toContain('person.reference=pp-2');
		expect(url).toContain('props=name,phone,email,birthdate,id_code');
		expect(url).toContain('limit=10');
		// Db-scoped per call — per-collective isolation by construction (the
		// record's required `database` parent + single-collective-per-db make a
		// _parent filter redundant, matching listActiveMembers).
		expect(url).toContain('/polyphony/');
		expect(url).not.toContain('_parent.reference=');
	});

	it('0 results → { state: "none" } (the create path)', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(json({ entities: [] }));
		await expect(loadMemberRecord(cfg, 'pp-2', fetchImpl)).resolves.toEqual({ state: 'none' });
	});

	it('1 result → { state: "one" } with the FULL record (#285: id_code mapped as a plain string, like phone); birthdate is the stored string\'s DATE PART (split("T")[0]), absent props resolve to ""', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(
			json({
				entities: [
					{
						_id: 'rec-1',
						name: [{ string: 'Berta Real' }],
						birthdate: [{ datetime: '1990-03-15T00:00:00.000Z' }],
						id_code: [{ string: '50001010017' }]
						// phone/email absent → ''
					}
				]
			})
		);
		await expect(loadMemberRecord(cfg, 'pp-2', fetchImpl)).resolves.toEqual({
			state: 'one',
			record: {
				_id: 'rec-1',
				name: 'Berta Real',
				phone: '',
				email: '',
				birthdate: '1990-03-15',
				id_code: '50001010017'
			}
		});
	});

	it('>1 result → { state: "damaged", count } — and NO writes fire (#264: refuse to guess, no self-repair)', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(
			json({
				entities: [
					{ _id: 'rec-1', name: [{ string: 'A' }] },
					{ _id: 'rec-2', name: [{ string: 'B' }] }
				]
			})
		);
		await expect(loadMemberRecord(cfg, 'pp-2', fetchImpl)).resolves.toEqual({
			state: 'damaged',
			count: 2
		});
		// The single read is the ONLY wire traffic: no POST, no DELETE, ever.
		expect(fetchImpl).toHaveBeenCalledTimes(1);
		const init = fetchImpl.mock.calls[0][1] as RequestInit | undefined;
		expect(init?.method ?? 'GET').toBe('GET');
	});

	it('non-2xx → throws a static message with the status code', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(json({}, 500));
		await expect(loadMemberRecord(cfg, 'pp-2', fetchImpl)).rejects.toThrow(/500/);
	});
});

// ── CREATE: lazy, first save ─────────────────────────────────────────────────

describe('createMemberRecord — lazy create, entity-level _sharing asserted explicitly', () => {
	it('POST entity with the FULL pinned payload: _type reference, _parent = database entity, _sharing domain, person, name, and each optional field — id_code LAST (full-shape toEqual, #285: the ninth entry)', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(json({ _id: 'rec-new' }));
		await expect(
			createMemberRecord(
				cfg,
				{
					dbEntityId: 'db-1',
					personId: 'pp-2',
					name: 'Berta Real',
					phone: '+372 5551234',
					email: 'berta@real.example',
					birthdate: '1990-03-15',
					id_code: '50001010017'
				},
				fetchImpl
			)
		).resolves.toBe('rec-new');
		expect(resolveTypeIdMock).toHaveBeenCalledWith(cfg, 'admin_member_record', expect.anything());
		expect(fetchImpl).toHaveBeenCalledTimes(1);
		const url = String(fetchImpl.mock.calls[0][0]);
		expect(url).toContain('/polyphony/entity');
		const init = fetchImpl.mock.calls[0][1] as RequestInit;
		expect(init.method).toBe('POST');
		// SHARING MECHANICS (state it so "sharing explicit on every property"
		// reads correctly): the per-PROPERTY tiers (name→domain, phone/email/
		// birthdate→private) are the provisioned prop-defs' — schema-level, #265.
		// What the instance write asserts explicitly is the record's own
		// entity-level _sharing. birthdate is the UTC-midnight-anchored datetime.
		expect(JSON.parse(String(init.body))).toEqual([
			{ type: '_type', reference: 'type-amr' },
			{ type: '_parent', reference: 'db-1' },
			{ type: '_sharing', string: 'domain' },
			{ type: 'person', reference: 'pp-2' },
			{ type: 'name', string: 'Berta Real' },
			{ type: 'phone', string: '+372 5551234' },
			{ type: 'email', string: 'berta@real.example' },
			{ type: 'birthdate', datetime: '1990-03-15T00:00:00.000Z' },
			// #285 — id_code rides LAST (FIELD_ORDER parity: a deterministic
			// partial-failure order needs a deterministic payload order too).
			{ type: 'id_code', string: '50001010017' }
		]);
	});

	it('negative twin: the payload always carries the explicit entity-level _sharing — a payload missing it is a defect', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(json({ _id: 'rec-new' }));
		await createMemberRecord(cfg, { dbEntityId: 'db-1', personId: 'pp-2', name: 'N' }, fetchImpl);
		const body = JSON.parse(String((fetchImpl.mock.calls[0][1] as RequestInit).body)) as Array<{
			type: string;
			string?: string;
		}>;
		expect(body.some((e) => e.type === '_sharing' && e.string === 'domain')).toBe(true);
	});

	it('optional fields ride along ONLY when non-empty: name-only create (all four optionals empty, id_code included) sends exactly the five identity/required entries', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(json({ _id: 'rec-new' }));
		await createMemberRecord(
			cfg,
			{ dbEntityId: 'db-1', personId: 'pp-2', name: 'Berta Real', phone: '', email: '', birthdate: '', id_code: '' },
			fetchImpl
		);
		expect(JSON.parse(String((fetchImpl.mock.calls[0][1] as RequestInit).body))).toEqual([
			{ type: '_type', reference: 'type-amr' },
			{ type: '_parent', reference: 'db-1' },
			{ type: '_sharing', string: 'domain' },
			{ type: 'person', reference: 'pp-2' },
			{ type: 'name', string: 'Berta Real' }
		]);
	});

	it('non-2xx throws; 2xx with no _id throws (the apparent-success trap)', async () => {
		const failing = vi.fn().mockResolvedValue(json({}, 500));
		await expect(
			createMemberRecord(cfg, { dbEntityId: 'db-1', personId: 'pp-2', name: 'N' }, failing)
		).rejects.toThrow(/500/);
		const noId = vi.fn().mockResolvedValue(json({}));
		await expect(
			createMemberRecord(cfg, { dbEntityId: 'db-1', personId: 'pp-2', name: 'N' }, noId)
		).rejects.toThrow();
	});
});

// ── UPDATE: atomic overwrite per changed field ───────────────────────────────

describe('updateMemberRecord — replaceEntityProperty per changed field, fixed order, no deletes', () => {
	it('routes EVERY changed field through replaceEntityProperty (atomic overwrite — never a bare POST append), in the fixed order name → phone → email → birthdate regardless of object key order', async () => {
		const fetchImpl = vi.fn();
		await updateMemberRecord(
			cfg,
			'rec-1',
			{ email: 'new@x.example', name: 'New Name' },
			fetchImpl
		);
		expect(replaceEntityPropertyMock).toHaveBeenCalledTimes(2);
		expect(replaceEntityPropertyMock.mock.calls[0][1]).toBe('rec-1');
		expect(replaceEntityPropertyMock.mock.calls[0][2]).toEqual({ type: 'name', string: 'New Name' });
		expect(replaceEntityPropertyMock.mock.calls[1][2]).toEqual({
			type: 'email',
			string: 'new@x.example'
		});
		// The normal path issues ZERO wire calls of its own (no property DELETEs).
		expect(fetchImpl).not.toHaveBeenCalled();
	});

	it('birthdate wire: the date input\'s YYYY-MM-DD becomes { type: "birthdate", datetime: "<date>T00:00:00.000Z" } (UTC-midnight anchor)', async () => {
		await updateMemberRecord(cfg, 'rec-1', { birthdate: '1990-03-15' }, vi.fn());
		expect(replaceEntityPropertyMock).toHaveBeenCalledTimes(1);
		expect(replaceEntityPropertyMock.mock.calls[0][2]).toEqual({
			type: 'birthdate',
			datetime: '1990-03-15T00:00:00.000Z'
		});
	});

	it('clearing a field is an overwrite to "" through the same atomic path — a deliberately-cleared field stays cleared (R4)', async () => {
		await updateMemberRecord(cfg, 'rec-1', { phone: '' }, vi.fn());
		expect(replaceEntityPropertyMock).toHaveBeenCalledTimes(1);
		expect(replaceEntityPropertyMock.mock.calls[0][2]).toEqual({ type: 'phone', string: '' });
	});

	// ── #285 — id_code on the update path: STRING shape (like phone), LAST in
	// FIELD_ORDER ────────────────────────────────────────────────────────────
	it('#285 — a changed id_code routes through replaceEntityProperty as { type: "id_code", string: … } — plain string shape like phone, NOT birthdate\'s datetime anchor', async () => {
		const fetchImpl = vi.fn();
		await updateMemberRecord(cfg, 'rec-1', { id_code: '50001010017' }, fetchImpl);
		expect(replaceEntityPropertyMock).toHaveBeenCalledTimes(1);
		expect(replaceEntityPropertyMock.mock.calls[0][1]).toBe('rec-1');
		expect(replaceEntityPropertyMock.mock.calls[0][2]).toEqual({
			type: 'id_code',
			string: '50001010017'
		});
		expect(fetchImpl).not.toHaveBeenCalled();
	});

	it('#285 — id_code is LAST in the fixed write order: { id_code, name } writes name FIRST, id_code after, regardless of object key order (deterministic partial-failure order)', async () => {
		await updateMemberRecord(cfg, 'rec-1', { id_code: '50001010017', name: 'New Name' }, vi.fn());
		expect(replaceEntityPropertyMock).toHaveBeenCalledTimes(2);
		expect(replaceEntityPropertyMock.mock.calls[0][2]).toEqual({ type: 'name', string: 'New Name' });
		expect(replaceEntityPropertyMock.mock.calls[1][2]).toEqual({
			type: 'id_code',
			string: '50001010017'
		});
	});

	it('#285 — id_code comes after even BIRTHDATE (the previous last field): { id_code, birthdate } writes birthdate first', async () => {
		await updateMemberRecord(
			cfg,
			'rec-1',
			{ id_code: '50001010017', birthdate: '1990-03-15' },
			vi.fn()
		);
		expect(replaceEntityPropertyMock).toHaveBeenCalledTimes(2);
		expect(replaceEntityPropertyMock.mock.calls[0][2]).toEqual({
			type: 'birthdate',
			datetime: '1990-03-15T00:00:00.000Z'
		});
		expect(replaceEntityPropertyMock.mock.calls[1][2]).toEqual({
			type: 'id_code',
			string: '50001010017'
		});
	});

	it('#285 — clearing id_code is an overwrite to "" through the atomic path (string semantics, like phone) — NEVER the birthdate-style GET+DELETE removal, no wire calls of its own', async () => {
		const fetchImpl = vi.fn();
		await updateMemberRecord(cfg, 'rec-1', { id_code: '' }, fetchImpl);
		expect(replaceEntityPropertyMock).toHaveBeenCalledTimes(1);
		expect(replaceEntityPropertyMock.mock.calls[0][2]).toEqual({ type: 'id_code', string: '' });
		// The removal path (clearEntityProperty's GET + DELETE) is birthdate's
		// alone: '' is a legal string, so id_code stays on the overwrite path.
		expect(fetchImpl).not.toHaveBeenCalled();
	});

	it('#285 — an id_code write that fails reports through the typed partial-save error naming the FIELD (landed siblings listed, value never)', async () => {
		replaceEntityPropertyMock
			.mockResolvedValueOnce(undefined)
			.mockRejectedValueOnce(new Error('replaceEntityProperty POST failed: 500'));
		const p = updateMemberRecord(
			cfg,
			'rec-1',
			{ name: 'New Name', id_code: '50001010017' },
			vi.fn()
		);
		await expect(p).rejects.toBeInstanceOf(MemberRecordPartialSaveError);
		const err = (await p.catch((e) => e)) as MemberRecordPartialSaveError;
		expect(err.landedFields).toEqual(['name']);
		expect(err.failedField).toBe('id_code');
		expect(err.message).not.toContain('50001010017');
	});

	// #268 review F1 — the ONE field where clearing is NOT an overwrite.
	// clearEntityProperty is deliberately NOT mocked here (the module mock
	// spreads importActual), so these assertions see the WIRE THAT IS ACTUALLY
	// ISSUED, not a stubbed call record.
	it('clearing the BIRTHDATE removes the stored value (GET + DELETE /property/{id}) — it never POSTs `datetime: ""`, which entu-api would store verbatim as a JS string', async () => {
		const fetchImpl = vi
			.fn()
			.mockResolvedValueOnce(json({ entity: { _id: 'rec-1', birthdate: [{ _id: 'v-dob' }] } }))
			.mockResolvedValue(json({ deleted: true }));

		await updateMemberRecord(cfg, 'rec-1', { birthdate: '' }, fetchImpl);

		// The overwrite path is not taken at all — no `{ type: 'birthdate',
		// datetime: '' }` anywhere, neither through the helper nor on the wire.
		expect(replaceEntityPropertyMock).not.toHaveBeenCalled();
		expect(fetchImpl).toHaveBeenCalledTimes(2);
		expect(String(fetchImpl.mock.calls[0][0])).toContain('/polyphony/entity/rec-1?props=birthdate');
		expect((fetchImpl.mock.calls[1][1] as RequestInit).method).toBe('DELETE');
		expect(String(fetchImpl.mock.calls[1][0])).toContain('/polyphony/property/v-dob');
		const wire = fetchImpl.mock.calls
			.map((c) => String((c[1] as RequestInit | undefined)?.body ?? ''))
			.join(' ');
		expect(wire).not.toContain('datetime');
	});

	it('a birthdate clear that fails mid-removal still reports as a partial-save failure naming the field (the typed error contract holds on the removal path too)', async () => {
		const fetchImpl = vi
			.fn()
			.mockResolvedValueOnce(json({ entity: { _id: 'rec-1', birthdate: [{ _id: 'v-dob' }] } }))
			.mockResolvedValueOnce(json({ error: 'forbidden' }, 403));
		const p = updateMemberRecord(cfg, 'rec-1', { name: 'New Name', birthdate: '' }, fetchImpl);
		await expect(p).rejects.toBeInstanceOf(MemberRecordPartialSaveError);
		const err = (await p.catch((e) => e)) as MemberRecordPartialSaveError;
		expect(err.landedFields).toEqual(['name']);
		expect(err.failedField).toBe('birthdate');
	});

	it('partial failure (field 2 of 2 fails): rejects with MemberRecordPartialSaveError naming exactly what landed and what failed (#253)', async () => {
		replaceEntityPropertyMock
			.mockResolvedValueOnce(undefined)
			.mockRejectedValueOnce(new Error('replaceEntityProperty POST failed: 500'));
		const p = updateMemberRecord(cfg, 'rec-1', { name: 'New Name', email: 'new@x.example' }, vi.fn());
		await expect(p).rejects.toBeInstanceOf(MemberRecordPartialSaveError);
		const err = (await p.catch((e) => e)) as MemberRecordPartialSaveError;
		expect(err.landedFields).toEqual(['name']);
		expect(err.failedField).toBe('email');
	});

	it('first-field failure: rejects with the typed error carrying landedFields [] — the page can truthfully say NOTHING was saved', async () => {
		replaceEntityPropertyMock.mockRejectedValueOnce(new Error('replaceEntityProperty POST failed: 500'));
		const p = updateMemberRecord(cfg, 'rec-1', { name: 'New Name' }, vi.fn());
		await expect(p).rejects.toBeInstanceOf(MemberRecordPartialSaveError);
		const err = (await p.catch((e) => e)) as MemberRecordPartialSaveError;
		expect(err.landedFields).toEqual([]);
		expect(err.failedField).toBe('name');
	});
});

// ── birthdate round-trip: never a day shift, any timezone ────────────────────

describe('birthdate round-trip — #207 no-day-shift idiom (pure string, never new Date() local getters)', () => {
	// Deterministic non-UTC fixture: America/Anchorage (UTC-9). Local-time
	// getters on new Date('…T00:00:00.000Z') here yield the PREVIOUS day —
	// exactly the defect the contract forbids. Node re-reads process.env.TZ.
	const priorTZ = process.env.TZ;
	beforeAll(() => {
		process.env.TZ = 'America/Anchorage';
	});
	afterAll(() => {
		if (priorTZ === undefined) delete process.env.TZ;
		else process.env.TZ = priorTZ;
	});

	it('birthdateToWire: 1990-03-15 → 1990-03-15T00:00:00.000Z', () => {
		expect(birthdateToWire('1990-03-15')).toBe('1990-03-15T00:00:00.000Z');
	});

	it('birthdateFromWire: split("T")[0] — 1990-03-15T00:00:00.000Z reads back 1990-03-15 even at UTC-9', () => {
		expect(birthdateFromWire('1990-03-15T00:00:00.000Z')).toBe('1990-03-15');
	});

	it('round-trip: save 1990-03-15, reopen shows 1990-03-15 — regardless of the viewer\'s timezone', () => {
		expect(birthdateFromWire(birthdateToWire('1990-03-15'))).toBe('1990-03-15');
	});
});

// ── privacy: static errors, never a field value ──────────────────────────────

describe('privacy — thrown messages carry static strings + status codes only, NEVER a field value', () => {
	// #285 — the isikukood joins the never-in-a-message set: it identifies a
	// real person more precisely than any other field on this form.
	const PII = ['Berta Real', '+372 5551234', 'berta@real.example', '1990-03-15', '50001010017'];

	it('a failed create\'s thrown message contains none of the submitted values', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(json({}, 500));
		const err = (await createMemberRecord(
			cfg,
			{
				dbEntityId: 'db-1',
				personId: 'pp-2',
				name: 'Berta Real',
				phone: '+372 5551234',
				email: 'berta@real.example',
				birthdate: '1990-03-15',
				id_code: '50001010017'
			},
			fetchImpl
		).catch((e) => e)) as Error;
		expect(err).toBeInstanceOf(Error);
		for (const value of PII) expect(err.message).not.toContain(value);
	});

	it('a partial-save error\'s message contains field NAMES at most, never the values being written', async () => {
		replaceEntityPropertyMock
			.mockResolvedValueOnce(undefined)
			.mockRejectedValueOnce(new Error('replaceEntityProperty POST failed: 500'));
		const err = (await updateMemberRecord(
			cfg,
			'rec-1',
			{ name: 'Berta Real', email: 'berta@real.example', id_code: '50001010017' },
			vi.fn()
		).catch((e) => e)) as Error;
		expect(err).toBeInstanceOf(Error);
		for (const value of PII) expect(err.message).not.toContain(value);
	});
});

// (*MVOX:Tallis* — #268 RED)
// (*MVOX:Tallis* — #285 RED: id_code joins the projection, the create payload
//  (last), FIELD_ORDER (last), the string-shape update/clear path, and the PII
//  never-in-a-message set)
