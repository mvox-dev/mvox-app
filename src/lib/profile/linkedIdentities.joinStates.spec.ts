// listJoinStates: the roster's three-state join read.
import { describe, expect, it, vi } from 'vitest';
import type { EntuCfg } from '$lib/seasons/entuSeasons';
import * as linkedIdentities from './linkedIdentities';
import { json, testCfg } from '$lib/testing/entuFetchKit';

type JoinState = 'absent' | 'invited' | 'joined';
type ListJoinStates = (
	cfg: EntuCfg,
	personIds: string[],
	fetchImpl?: typeof fetch
) => Promise<Record<string, JoinState>>;

const listJoinStates = (linkedIdentities as unknown as { listJoinStates?: ListJoinStates })
	.listJoinStates;

const cfg = testCfg('sampledb', 'jwt-admin');

type WireEntry = { _id: string; uid?: string; provider?: string; email?: string; invite?: string };

const ADMITTED = [{ _id: 'gr-1', reference: 'me', property_type: '_editor' }];

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
		const states = await listJoinStates!(cfg, ['p-2'], personFetch({ 'p-2': [PLACEHOLDER] }));
		expect(states['p-2']).toBe('invited');
	});

	it('absent — a person the caller CAN read, with no entu_user key at all, reads as absent (never invited)', async () => {
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
		const fetchImpl = personFetch({ 'p-1': [BOUND], 'p-2': null });
		await expect(listJoinStates!(cfg, ['p-1', 'p-2'], fetchImpl)).rejects.toThrow(/403/);
	});

	it('#454 — a WITHHELD private bucket (200, no rights tell) OMITS the personId: no key, never \'absent\'', async () => {
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
