// #467 RED — the roster's DATED join read: `listJoinStateDetails`.
//
// Contract under test (GREEN implements exactly this, in THIS module — the
// sibling of `listJoinStates`, sharing its internal `entity/{personId}` read,
// never a duplicate fetch path):
//
//   export type JoinStateDetail = { state: JoinState; at?: string };
//   listJoinStateDetails(cfg: EntuCfg, personIds: string[], fetchImpl?)
//     : Promise<Record<string, JoinStateDetail>>   // keyed by personId
//   readPropertyCreatedAt(cfg: EntuCfg, propertyId: string, fetchImpl?)
//     : Promise<string | undefined>
//
// The dates (issue #467, Mihkel's table): every property VALUE in Entu carries
// `created: {at, by}`, but ONLY `GET /property/{_id}` returns it — the entity
// read never does (probe-property-value-created-stamp-2026-09-21). The value
// `_id`s needed are already in the `entity/{personId}?props=entu_user,_viewer`
// response this module reads today:
//   invited → the masked placeholder's own `_id` ({_id, invite:'***'})
//   joined  → the bound identity's own `_id`   ({_id, uid, provider, email})
//   absent  → NO follow-up read at all (the date for that display line is the
//             member entity's `_created`, threaded by rosterData.ts — not this
//             module's business)
//
// Failure split, per the house #456 shape:
//   entity read HTTP failure → THROW (existing listLinkedIdentities behaviour,
//     unchanged);
//   property read non-2xx or missing `created.at` → console.warn NAMING the
//     property id, `at` undefined, the STATE still returned, other rows
//     untouched — skip-and-warn per row, never throw the batch.
//
// Withheld private bucket (no `_viewer` tell, #454) → the personId is OMITTED,
// exactly as listJoinStates does today — and no property read is ever issued
// for a person whose entries this caller never observed.
//
// PII (ER-26): `created.by` is a person reference and must never leave the
// reader — the detail shape is {state, at} and nothing else; the full-toEqual
// assertions below pin that structurally.

import { describe, expect, it, vi } from 'vitest';
import type { EntuCfg } from '$lib/seasons/entuSeasons';
import * as linkedIdentities from './linkedIdentities';
import * as inviteData from '$lib/invite/inviteData';

type JoinState = 'absent' | 'invited' | 'joined';
type JoinStateDetail = { state: JoinState; at?: string };
type ListJoinStateDetails = (
	cfg: EntuCfg,
	personIds: string[],
	fetchImpl?: typeof fetch
) => Promise<Record<string, JoinStateDetail>>;
type ReadPropertyCreatedAt = (
	cfg: EntuCfg,
	propertyId: string,
	fetchImpl?: typeof fetch
) => Promise<string | undefined>;

// Dynamic-shaped access: at RED the exports do not exist yet; each test then
// fails on the call rather than the whole file failing at module link time
// (the linkedIdentities.joinStates.spec.ts idiom).
const listJoinStateDetails = (
	linkedIdentities as unknown as { listJoinStateDetails?: ListJoinStateDetails }
).listJoinStateDetails;
const readPropertyCreatedAt = (
	linkedIdentities as unknown as { readPropertyCreatedAt?: ReadPropertyCreatedAt }
).readPropertyCreatedAt;
const listJoinStates = linkedIdentities.listJoinStates;

const cfg: EntuCfg = { db: 'sampledb', token: 'jwt-admin' };

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), { status });
}

type WireEntry = { _id: string; uid?: string; provider?: string; email?: string; invite?: string };

/** A grant admitting the caller to the private bucket (#454 tell). */
const ADMITTED = [{ _id: 'gr-1', reference: 'me', property_type: '_editor' }];

/** The GET /property/{_id} body shape the 2026-09-21 live probe pinned:
 *  {_id, type, string, entity, created:{at, by}}. `by` is DELIBERATELY present
 *  in every fixture — the reader must drop it (ER-26). */
type PropFixture = { created?: { at?: string; by?: string } } | { status: number };

/**
 * Routed fetch stub covering BOTH wire shapes this producer touches:
 *   entity/{id}?props=entu_user,_viewer — answered per-person from `persons`
 *     (WireEntry[] | 'no-key' | 'withheld' | null, the joinStates.spec idiom)
 *   property/{_id} — answered from `props` ({created:{at,by}} or {status})
 * Anything else answers 404 — an unrouted request is a contract violation.
 */
function routedFetch(
	persons: Record<string, WireEntry[] | 'no-key' | 'withheld' | null>,
	props: Record<string, PropFixture> = {}
) {
	return vi.fn().mockImplementation((url: string) => {
		const u = String(url);
		if (u.includes('/property/')) {
			const pid = u.split('/property/')[1]?.split('?')[0] ?? '';
			const fixture = props[pid];
			if (!fixture) return Promise.resolve(json({ error: `unrouted property read ${u}` }, 404));
			if ('status' in fixture) return Promise.resolve(json({ error: 'refused' }, fixture.status));
			return Promise.resolve(
				json({ _id: pid, type: 'entu_user', string: '***', entity: 'e-1', created: fixture.created })
			);
		}
		const id = u.split('/entity/')[1]?.split('?')[0] ?? '';
		if (!(id in persons) || !u.includes('props=entu_user,_viewer')) {
			return Promise.resolve(json({ error: `unexpected request ${u}` }, 404));
		}
		const val = persons[id];
		if (val === null) return Promise.resolve(json({ error: 'forbidden' }, 403));
		if (val === 'withheld') return Promise.resolve(json({ entity: { _id: id } }));
		if (val === 'no-key') return Promise.resolve(json({ entity: { _id: id, _viewer: ADMITTED } }));
		return Promise.resolve(json({ entity: { _id: id, _viewer: ADMITTED, entu_user: val } }));
	}) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
}

const BOUND: WireEntry = { _id: 'eu-b', uid: 'google:123', provider: 'google', email: 'x@y.ee' };
const PLACEHOLDER: WireEntry = { _id: 'eu-p', invite: '***' };
const AT_INVITED = '2026-09-22T10:00:00.000Z';
const AT_JOINED = '2026-09-10T12:00:00.000Z';

function propertyCalls(fetchImpl: ReturnType<typeof vi.fn>): string[] {
	return fetchImpl.mock.calls
		.map((c) => String(c[0]))
		.filter((u) => u.includes('/property/'));
}

describe('listJoinStateDetails — state plus the dated stamp, one property read per invited/joined row', () => {
	it("invited — ONE property read, on the PLACEHOLDER's own _id; detail is {state:'invited', at:<created.at>} and nothing else (never created.by)", async () => {
		const fetchImpl = routedFetch(
			{ 'p-1': [PLACEHOLDER] },
			{ 'eu-p': { created: { at: AT_INVITED, by: 'author-person-1' } } }
		);
		const details = await listJoinStateDetails!(cfg, ['p-1'], fetchImpl);
		expect(details).toEqual<Record<string, JoinStateDetail>>({
			'p-1': { state: 'invited', at: AT_INVITED }
		});
		expect(propertyCalls(fetchImpl)).toHaveLength(1);
		expect(propertyCalls(fetchImpl)[0]).toContain('property/eu-p');
		// ER-26: the author must not survive extraction in ANY shape.
		expect(JSON.stringify(details)).not.toContain('author-person-1');
	});

	it("joined — the property read targets the IDENTITY's _id; {state:'joined', at:<created.at>}", async () => {
		const fetchImpl = routedFetch(
			{ 'p-2': [BOUND] },
			{ 'eu-b': { created: { at: AT_JOINED, by: 'author-person-2' } } }
		);
		const details = await listJoinStateDetails!(cfg, ['p-2'], fetchImpl);
		expect(details).toEqual<Record<string, JoinStateDetail>>({
			'p-2': { state: 'joined', at: AT_JOINED }
		});
		expect(propertyCalls(fetchImpl)).toHaveLength(1);
		expect(propertyCalls(fetchImpl)[0]).toContain('property/eu-b');
	});

	it('precedence unchanged — an identity PLUS a stale placeholder reads joined, and the one property read is on the identity, never the placeholder', async () => {
		const fetchImpl = routedFetch(
			{ 'p-3': [PLACEHOLDER, BOUND] },
			{ 'eu-b': { created: { at: AT_JOINED, by: 'author' } } }
		);
		const details = await listJoinStateDetails!(cfg, ['p-3'], fetchImpl);
		expect(details).toEqual<Record<string, JoinStateDetail>>({
			'p-3': { state: 'joined', at: AT_JOINED }
		});
		expect(propertyCalls(fetchImpl)).toHaveLength(1);
		expect(propertyCalls(fetchImpl)[0]).toContain('property/eu-b');
	});

	it("absent — NO property read at all; {state:'absent'} with no `at` key (the member _created date is rosterData's, not this producer's)", async () => {
		const fetchImpl = routedFetch({ 'p-4': 'no-key' });
		const details = await listJoinStateDetails!(cfg, ['p-4'], fetchImpl);
		expect(details).toEqual<Record<string, JoinStateDetail>>({ 'p-4': { state: 'absent' } });
		expect(propertyCalls(fetchImpl)).toHaveLength(0);
	});

	it('withheld bucket (no _viewer tell, #454) — the personId is OMITTED and no property read is issued', async () => {
		const fetchImpl = routedFetch({ 'p-5': 'withheld' });
		const details = await listJoinStateDetails!(cfg, ['p-5'], fetchImpl);
		expect(details).toEqual({});
		expect(propertyCalls(fetchImpl)).toHaveLength(0);
	});

	it('property read non-2xx — skip-and-warn per row (#456 shape): the STATE survives without `at`, console.warn NAMES the property id, other rows are untouched (full toEqual)', async () => {
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const fetchImpl = routedFetch(
			{ 'p-6': [PLACEHOLDER], 'p-7': [BOUND] },
			{ 'eu-p': { status: 500 }, 'eu-b': { created: { at: AT_JOINED, by: 'author' } } }
		);
		const details = await listJoinStateDetails!(cfg, ['p-6', 'p-7'], fetchImpl);
		expect(details).toEqual<Record<string, JoinStateDetail>>({
			'p-6': { state: 'invited' },
			'p-7': { state: 'joined', at: AT_JOINED }
		});
		expect(warnSpy).toHaveBeenCalled();
		expect(warnSpy.mock.calls.some((c) => c.map(String).join(' ').includes('eu-p'))).toBe(true);
		warnSpy.mockRestore();
	});

	it('property read 2xx but created.at MISSING — same skip-and-warn: state without `at`, warn names the id, no throw', async () => {
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const fetchImpl = routedFetch({ 'p-8': [PLACEHOLDER] }, { 'eu-p': { created: {} } });
		const details = await listJoinStateDetails!(cfg, ['p-8'], fetchImpl);
		expect(details).toEqual<Record<string, JoinStateDetail>>({ 'p-8': { state: 'invited' } });
		expect(warnSpy.mock.calls.some((c) => c.map(String).join(' ').includes('eu-p'))).toBe(true);
		warnSpy.mockRestore();
	});

	it('entity read HTTP failure still FAILS LOUD — the existing listLinkedIdentities throw, unchanged by the dated sibling', async () => {
		const fetchImpl = routedFetch({ 'p-9': null });
		await expect(listJoinStateDetails!(cfg, ['p-9'], fetchImpl)).rejects.toThrow(/403/);
	});

	it('shares the internal entity read — exactly ONE entity fetch per person (invited person: 1 entity + 1 property = 2 calls total)', async () => {
		const fetchImpl = routedFetch(
			{ 'p-1': [PLACEHOLDER] },
			{ 'eu-p': { created: { at: AT_INVITED, by: 'a' } } }
		);
		await listJoinStateDetails!(cfg, ['p-1'], fetchImpl);
		expect(fetchImpl.mock.calls).toHaveLength(2);
	});
});

describe('readPropertyCreatedAt — the small GET /property/{_id} reader (fileUrls.ts signFileUrl shape, but skip-and-warn)', () => {
	it('reads property/{id} and returns created.at', async () => {
		const fetchImpl = vi
			.fn()
			.mockResolvedValue(json({ _id: 'v-1', created: { at: AT_INVITED, by: 'author' } }));
		const at = await readPropertyCreatedAt!(cfg, 'v-1', fetchImpl as unknown as typeof fetch);
		expect(at).toBe(AT_INVITED);
		expect(fetchImpl).toHaveBeenCalledTimes(1);
		expect(String(fetchImpl.mock.calls[0][0])).toContain('property/v-1');
	});

	it('non-2xx → undefined + console.warn naming the property id — never a throw (#456: one bad stamp must not sink the batch)', async () => {
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const fetchImpl = vi.fn().mockResolvedValue(json({}, 500));
		const at = await readPropertyCreatedAt!(cfg, 'v-2', fetchImpl as unknown as typeof fetch);
		expect(at).toBeUndefined();
		expect(warnSpy.mock.calls.some((c) => c.map(String).join(' ').includes('v-2'))).toBe(true);
		warnSpy.mockRestore();
	});

	it('2xx without created.at → undefined + warn naming the id', async () => {
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const fetchImpl = vi.fn().mockResolvedValue(json({ _id: 'v-3' }));
		const at = await readPropertyCreatedAt!(cfg, 'v-3', fetchImpl as unknown as typeof fetch);
		expect(at).toBeUndefined();
		expect(warnSpy.mock.calls.some((c) => c.map(String).join(' ').includes('v-3'))).toBe(true);
		warnSpy.mockRestore();
	});
});

describe('listJoinStates — the bare 3-value contract is byte-identical to today (the owner-controls block branches exhaustively on it)', () => {
	it('still returns Record<personId, JoinState> — plain strings, no detail objects, and NO property read is ever issued', async () => {
		const fetchImpl = routedFetch({
			'p-1': [BOUND],
			'p-2': [PLACEHOLDER],
			'p-3': 'no-key',
			'p-4': 'withheld'
		});
		const states = await listJoinStates(cfg, ['p-1', 'p-2', 'p-3', 'p-4'], fetchImpl);
		expect(states).toEqual<Record<string, JoinState>>({
			'p-1': 'joined',
			'p-2': 'invited',
			'p-3': 'absent'
		});
		expect(propertyCalls(fetchImpl)).toHaveLength(0);
	});
});

describe('INVITE_LIFETIME_MS — the ONE lifetime constant (docs/architecture/invite-flow.md §7: live mints 24 h; the pinned source says 7 d; live is authoritative)', () => {
	it('inviteData.ts exports INVITE_LIFETIME_MS === 24 * 60 * 60 * 1000', () => {
		const lifetime = (inviteData as unknown as { INVITE_LIFETIME_MS?: number })
			.INVITE_LIFETIME_MS;
		expect(lifetime).toBe(24 * 60 * 60 * 1000);
	});
});

// (*MVOX:Tallis* — #467 RED: listJoinStateDetails/readPropertyCreatedAt contract,
//  fetch-mock idiom from linkedIdentities.joinStates.spec.ts, property/{id} mock
//  shape from repertoire/fileUrls.spec.ts)
