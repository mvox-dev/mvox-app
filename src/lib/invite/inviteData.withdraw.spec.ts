// withdrawInvite revokes an unredeemed invite link; one live link per person.
import { describe, expect, it, vi } from 'vitest';
import type { EntuCfg } from '$lib/seasons/entuSeasons';
import * as inviteData from './inviteData';
import { mintSelfLinkInvite } from './inviteData';
import { json, testCfg } from '$lib/testing/entuFetchKit';

type WithdrawInvite = (
	cfg: EntuCfg,
	personId: string,
	fetchImpl?: typeof fetch
) => Promise<void>;

const withdrawInvite = (inviteData as unknown as { withdrawInvite?: WithdrawInvite })
	.withdrawInvite;

const cfg = testCfg('sampledb', 'jwt-owner');
const PERSON_ID = 'person-target';

interface StoredValue {
	_id: string;
	uid?: string;
	provider?: string;
	email?: string;
	rawInvite?: string;
}

function makeEntuStore(initial: StoredValue[], failDeleteIds: string[] = []) {
	const state = { values: [...initial] };
	const ops: Array<{ method: string; url: string }> = [];
	let mintN = 0;
	const fetchImpl = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
		const u = String(url);
		const method = init?.method ?? 'GET';
		ops.push({ method, url: u });
		if (method === 'GET' && u.includes(`/entity/${PERSON_ID}`) && u.includes('props=entu_user')) {
			const masked = state.values.map((v) =>
				v.rawInvite !== undefined
					? { _id: v._id, invite: '***' }
					: { _id: v._id, uid: v.uid, provider: v.provider, email: v.email }
			);
			return Promise.resolve(
				json({ entity: { _id: PERSON_ID, ...(masked.length ? { entu_user: masked } : {}) } })
			);
		}
		if (method === 'DELETE' && u.includes('/property/')) {
			const id = u.split('/property/')[1]?.split('?')[0] ?? '';
			if (failDeleteIds.includes(id)) return Promise.resolve(json({ error: 'boom' }, 500));
			state.values = state.values.filter((v) => v._id !== id);
			return Promise.resolve(json({ deleted: true }));
		}
		if (method === 'POST' && u.includes(`/entity/${PERSON_ID}`)) {
			mintN += 1;
			const raw = `tok-fresh-${mintN}`;
			state.values.push({ _id: `eu-minted-${mintN}`, rawInvite: raw });
			return Promise.resolve(
				json({ _id: PERSON_ID, properties: [{ type: 'entu_user', invite: raw }] })
			);
		}
		return Promise.resolve(json({ error: `unexpected ${method} ${u}` }, 404));
	}) as unknown as typeof fetch;
	return { fetchImpl, state, ops };
}

function findStoredInvite(values: StoredValue[]): StoredValue | undefined {
	return values.find((v) => v.rawInvite !== undefined);
}

const BOUND: StoredValue = {
	_id: 'eu-bound',
	uid: 'google:real',
	provider: 'google',
	email: 'joined@example.com'
};

describe('withdrawInvite — the sweep, standalone (revocation, not tidiness)', () => {
	it('sweeps EVERY live placeholder — two coexisting placeholders (the observed append shape) → two property DELETEs, none surviving', async () => {
		const { fetchImpl, state, ops } = makeEntuStore([
			{ _id: 'eu-old-1', rawInvite: 'tok-old-1' },
			{ _id: 'eu-old-2', rawInvite: 'tok-old-2' }
		]);
		await withdrawInvite!(cfg, PERSON_ID, fetchImpl);
		expect(findStoredInvite(state.values)).toBeUndefined();
		const deletes = ops.filter((o) => o.method === 'DELETE');
		expect(deletes).toHaveLength(2);
		for (const d of deletes) expect(d.url).toMatch(/\/property\/eu-old-[12]/);
	});

	it('a bound identity is NEVER touched — withdraw on a person with a bound entry AND a placeholder deletes ONLY the placeholder', async () => {
		const { fetchImpl, state, ops } = makeEntuStore([
			BOUND,
			{ _id: 'eu-stale', rawInvite: 'tok-stale' }
		]);
		await withdrawInvite!(cfg, PERSON_ID, fetchImpl);
		expect(state.values).toContainEqual(BOUND);
		expect(findStoredInvite(state.values)).toBeUndefined();
		const deletes = ops.filter((o) => o.method === 'DELETE');
		expect(deletes).toHaveLength(1);
		expect(deletes[0].url).toContain('/property/eu-stale');
	});

	it('withdraw cannot unlink a member who has actually JOINED: only bound entries present → zero DELETEs, resolves as a no-op', async () => {
		const { fetchImpl, state, ops } = makeEntuStore([BOUND]);
		await withdrawInvite!(cfg, PERSON_ID, fetchImpl);
		expect(state.values).toEqual([BOUND]);
		expect(ops.filter((o) => o.method === 'DELETE')).toHaveLength(0);
	});

	it('all-or-report: with two placeholders, a failure on the SECOND delete rejects — one delete having succeeded is not success', async () => {
		const { fetchImpl, state } = makeEntuStore(
			[
				{ _id: 'eu-old-1', rawInvite: 'tok-old-1' },
				{ _id: 'eu-old-2', rawInvite: 'tok-old-2' }
			],
			['eu-old-2']
		);
		await expect(withdrawInvite!(cfg, PERSON_ID, fetchImpl)).rejects.toThrow(/eu-old-2|500/);
		expect(findStoredInvite(state.values)).toBeDefined();
	});

	it('all-or-report: a failure on the FIRST delete rejects loudly', async () => {
		const { fetchImpl } = makeEntuStore([{ _id: 'eu-old-1', rawInvite: 'tok-old-1' }], [
			'eu-old-1'
		]);
		await expect(withdrawInvite!(cfg, PERSON_ID, fetchImpl)).rejects.toThrow(/eu-old-1|500/);
	});

	it('an identity-read failure rejects — never silently treated as "nothing to withdraw"', async () => {
		const failingRead = vi
			.fn()
			.mockResolvedValue(json({ error: 'forbidden' }, 403)) as unknown as typeof fetch;
		await expect(withdrawInvite!(cfg, PERSON_ID, failingRead)).rejects.toThrow(/403/);
	});

	it('withdraw leaves NO marker: no POST is ever issued — withdrawn and never-invited are the SAME state (Mihkel ruling)', async () => {
		const { fetchImpl, ops } = makeEntuStore([{ _id: 'eu-old', rawInvite: 'tok-old' }]);
		await withdrawInvite!(cfg, PERSON_ID, fetchImpl);
		expect(ops.filter((o) => o.method === 'POST')).toHaveLength(0);
	});
});

describe('the one-live-link invariant — after saada uuesti, the OLD link no longer redeems (Gama, issue #294)', () => {

	it('after a resend, findStoredInvite can only ever land on the FRESH token — the previously issued link is gone from the store', async () => {
		const { fetchImpl, state } = makeEntuStore([{ _id: 'eu-old', rawInvite: 'tok-old' }]);
		const { inviteToken } = await mintSelfLinkInvite(cfg, PERSON_ID, fetchImpl);
		const redeemable = findStoredInvite(state.values);
		expect(redeemable).toBeDefined();
		expect(redeemable!.rawInvite).toBe(inviteToken);
		expect(redeemable!.rawInvite).not.toBe('tok-old');
		expect(state.values.filter((v) => v.rawInvite !== undefined)).toHaveLength(1);
	});

	it('the sweep PRECEDES the mint on the wire — the old link is dead before the new one exists, never two live at once', async () => {
		const { fetchImpl, ops } = makeEntuStore([{ _id: 'eu-old', rawInvite: 'tok-old' }]);
		await mintSelfLinkInvite(cfg, PERSON_ID, fetchImpl);
		const deleteIdx = ops.findIndex((o) => o.method === 'DELETE');
		const mintIdx = ops.findIndex((o) => o.method === 'POST');
		expect(deleteIdx).toBeGreaterThan(-1);
		expect(mintIdx).toBeGreaterThan(-1);
		expect(deleteIdx).toBeLessThan(mintIdx);
	});
});

// (*MVOX:Tallis* — #294 RED: withdraw = sweep-without-mint, all-or-report;
