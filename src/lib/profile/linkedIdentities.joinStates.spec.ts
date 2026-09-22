// #294 RED — the roster's three-state join read: `listJoinStates`.
//
// Contract under test (GREEN implements exactly this, in THIS module —
// lib/profile/linkedIdentities.ts is one of the two MINT_EXEMPT files allowed
// to carry the `entu_user` literal, and it already owns the discriminator):
//
//   export type JoinState = 'absent' | 'invited' | 'joined';
//   listJoinStates(cfg: EntuCfg, personIds: string[], fetchImpl?)
//     : Promise<Record<string, JoinState>>   // keyed by personId
//
// The state model (Mihkel, issue #294, verbatim: "Just check the
// person.entu_user. missing -> invite / present invite hash -> uninvite/
// reinvite / present username -> good!") — discriminate on the entry's
// CONTENTS, never on the property's presence:
//
//   absent  — the caller CAN read the property and it is not there (never
//             invited). A read the caller was never admitted to is a fourth
//             outcome, not this one — see #454 below.
//   invited — an entry carrying `invite` (masked '***' on every read after the
//             mint — linkedIdentities.ts:37) and no `uid`
//   joined  — an entry carrying `uid`/`provider`/`email`, never `invite`
//
// A PRESENCE check ("has entu_user" vs not) classifies an invited-but-never-
// joined member as JOINED — precisely the population the roster controls exist
// for. The issue body's original framing made that exact mistake; it is pinned
// here as its own case.
//
// Wire shape: per-person GET entity/{personId}?props=entu_user,_viewer — the
// #294 read plus the #454 rights tell. The 2026-09-08 probe verified all three
// states live (issue #294, probe result comment: absent → no key; placeholder →
// [{_id, invite:'***'}]; bound → [{_id, uid, email, provider}]). A list-query
// batch was never probed for masked-prop behaviour and is NOT the contract.
//
// Fail-loud, in BOTH refusal shapes:
//
//   1. HTTP failure → THROW. The #294 probe's zero-rights caller got a clean
//      TOTAL 403 — against a `_sharing: private` entity.
//   2. #454 — HTTP 200 with the private bucket WITHHELD → the personId is
//      OMITTED from the record. This is the shape a `_sharing: domain` person
//      entity produces for a grant-less in-db reader (mvox persons are
//      domain-shared; the `entu_user` prop-def is private), i.e. every
//      ordinary member reading a teammate's row — the population #454 newly
//      shows chips to. There is no status to catch: the answer is 200 and the
//      property is simply not in it. Classified 'absent', it would badge every
//      joined teammate "never invited".
//
// Either way "missing" means OBSERVED absent, never "not returned" (the
// rosterData.ts:123 class of trap, kept out of this layer by refusing to
// guess).

import { describe, expect, it, vi } from 'vitest';
import type { EntuCfg } from '$lib/seasons/entuSeasons';
import * as linkedIdentities from './linkedIdentities';

type JoinState = 'absent' | 'invited' | 'joined';
type ListJoinStates = (
	cfg: EntuCfg,
	personIds: string[],
	fetchImpl?: typeof fetch
) => Promise<Record<string, JoinState>>;

// Dynamic-shaped access: at RED the export does not exist yet; each test then
// fails on the call rather than the whole file failing at module link time.
const listJoinStates = (linkedIdentities as unknown as { listJoinStates?: ListJoinStates })
	.listJoinStates;

const cfg: EntuCfg = { db: 'sampledb', token: 'jwt-admin' };

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), { status });
}

type WireEntry = { _id: string; uid?: string; provider?: string; email?: string; invite?: string };

/** A grant admitting the caller to the private bucket. Presence is the whole
 *  signal; the grantee name+email a live row bakes into `.string` (ER-26) is
 *  deliberately not modelled. */
const ADMITTED = [{ _id: 'gr-1', reference: 'me', property_type: '_editor' }];

/**
 * Routed fetch stub: GET entity/{id}?props=entu_user,_viewer answered
 * per-person from `byId`:
 *   WireEntry[]  → 200, admitted, that entu_user array
 *   'no-key'     → 200, admitted, NO entu_user  (observed absent)
 *   'withheld'   → 200, `{ entity: { _id } }` — the private bucket filtered
 *                  out, so neither entu_user NOR the `_viewer` tell (#454)
 *   null         → HTTP 403 (the #294 probe's total-refusal shape)
 * An id absent from the map answers 404.
 */
function personFetch(byId: Record<string, WireEntry[] | 'no-key' | 'withheld' | null>) {
	return vi.fn().mockImplementation((url: string) => {
		const u = String(url);
		const id = u.split('/entity/')[1]?.split('?')[0] ?? '';
		if (!(id in byId) || !u.includes('props=entu_user,_viewer')) {
			return Promise.resolve(json({ error: `unexpected request ${u}` }, 404));
		}
		const val = byId[id];
		if (val === null) return Promise.resolve(json({ error: 'forbidden' }, 403));
		if (val === 'withheld') return Promise.resolve(json({ entity: { _id: id } }));
		if (val === 'no-key') return Promise.resolve(json({ entity: { _id: id, _viewer: ADMITTED } }));
		return Promise.resolve(json({ entity: { _id: id, _viewer: ADMITTED, entu_user: val } }));
	}) as unknown as typeof fetch;
}

const BOUND: WireEntry = { _id: 'eu-b', uid: 'google:123', provider: 'google', email: 'x@y.ee' };
const PLACEHOLDER: WireEntry = { _id: 'eu-p', invite: '***' };

describe('listJoinStates — the three states, read from CONTENTS', () => {
	it('joined — an entry carrying uid (and never invite) reads as joined', async () => {
		const states = await listJoinStates!(cfg, ['p-1'], personFetch({ 'p-1': [BOUND] }));
		expect(states).toEqual<Record<string, JoinState>>({ 'p-1': 'joined' });
	});

	it("invited — the masked placeholder ({invite:'***'}, no uid) reads as invited, NEVER as joined: the presence-check trap, pinned", async () => {
		// Every invited person HAS an entu_user entry — the placeholder is what
		// the mint leaves behind. "Has entu_user" therefore may not mean joined;
		// this is the one case the feature exists for.
		const states = await listJoinStates!(cfg, ['p-2'], personFetch({ 'p-2': [PLACEHOLDER] }));
		expect(states['p-2']).toBe('invited');
	});

	it('absent — a person the caller CAN read, with no entu_user key at all, reads as absent (never invited)', async () => {
		// "Can read" is load-bearing since #454: the same empty-looking body
		// from a caller the private bucket was withheld from is NOT this case —
		// it is the omission pinned below.
		const states = await listJoinStates!(cfg, ['p-3'], personFetch({ 'p-3': 'no-key' }));
		expect(states).toEqual<Record<string, JoinState>>({ 'p-3': 'absent' });
	});

	it('a bound identity plus a stale placeholder still reads joined — the self-link flow leaves this shape legitimately (#193)', async () => {
		const states = await listJoinStates!(
			cfg,
			['p-4'],
			personFetch({ 'p-4': [PLACEHOLDER, BOUND] })
		);
		expect(states['p-4']).toBe('joined');
	});

	it('several persons in one call come back keyed by personId, each classified independently', async () => {
		const fetchImpl = personFetch({
			'p-1': [BOUND],
			'p-2': [PLACEHOLDER],
			'p-3': 'no-key'
		});
		const states = await listJoinStates!(cfg, ['p-1', 'p-2', 'p-3'], fetchImpl);
		expect(states).toEqual<Record<string, JoinState>>({
			'p-1': 'joined',
			'p-2': 'invited',
			'p-3': 'absent'
		});
	});
});

describe('listJoinStates — fail loud, never classify a failed read', () => {
	it("an HTTP failure on any person REJECTS the whole read — 'absent' means OBSERVED absent, never 'not returned'", async () => {
		// The probe observed a clean total 403 for a rights-less caller. If that
		// were mapped to 'absent', the roster would offer kutsu on a JOINED member
		// it merely could not read — the rosterData.ts:123 trap, re-created one
		// layer up. Refuse to guess.
		const fetchImpl = personFetch({ 'p-1': [BOUND], 'p-2': null });
		await expect(listJoinStates!(cfg, ['p-1', 'p-2'], fetchImpl)).rejects.toThrow(/403/);
	});

	it('#454 — a WITHHELD private bucket (200, no rights tell) OMITS the personId: no key, never \'absent\'', async () => {
		// The shape an ordinary member gets for a teammate's domain-shared
		// person. p-2 is genuinely JOINED on the server; this caller simply was
		// not admitted to the property that says so. A key here — any key —
		// would be a guess.
		const fetchImpl = personFetch({ 'p-1': [BOUND], 'p-2': 'withheld' });
		const states = await listJoinStates!(cfg, ['p-1', 'p-2'], fetchImpl);
		expect(states).toEqual<Record<string, JoinState>>({ 'p-1': 'joined' });
		expect('p-2' in states).toBe(false);
	});

	it('#454 — a reader admitted to NONE of them gets {}, not a roster of false \'absent\'', async () => {
		const fetchImpl = personFetch({ 'p-1': 'withheld', 'p-2': 'withheld', 'p-3': 'withheld' });
		const states = await listJoinStates!(cfg, ['p-1', 'p-2', 'p-3'], fetchImpl);
		expect(states).toEqual({});
	});

	it('an empty personIds list resolves to {} without issuing any request', async () => {
		const fetchImpl = personFetch({});
		const states = await listJoinStates!(cfg, [], fetchImpl);
		expect(states).toEqual({});
		expect(fetchImpl).not.toHaveBeenCalled();
	});
});

// (*MVOX:Tallis* — #294 RED: three-state join read, contents-not-presence)
// (*MVOX:Josquin* — #454: the fourth outcome — a read that was never admitted)
