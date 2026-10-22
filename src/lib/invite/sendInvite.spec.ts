// sendInvite: Entu emails the invite to the person's own email; no person email, no request.
import { describe, expect, it, vi } from 'vitest';
import { sendInvite, SendInviteError } from './inviteData';
import { json, testCfg } from '$lib/testing/entuFetchKit';

const cfg = testCfg('sampledb', 'jwt-owner');
const PERSON_ID = 'person-target';

function wire(opts: { emails?: string[]; readable?: boolean; readStatus?: number; sendStatus?: number }) {
	const calls: Array<{ method: string; url: string; body?: unknown; auth?: string }> = [];
	const fetchImpl = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
		const method = init?.method ?? 'GET';
		const headers = new Headers(init?.headers);
		calls.push({
			method,
			url: String(url),
			body: init?.body ? JSON.parse(String(init.body)) : undefined,
			auth: headers.get('Authorization') ?? undefined
		});
		if (method === 'GET') {
			if (opts.readStatus) return Promise.resolve(json({ error: 'no' }, opts.readStatus));
			const entity: Record<string, unknown> = { _id: PERSON_ID };
			if (opts.readable !== false) entity._viewer = [{ reference: 'me' }];
			if (opts.emails?.length) entity.email = opts.emails.map((e, i) => ({ _id: `em-${i}`, string: e }));
			return Promise.resolve(json({ entity }));
		}
		return Promise.resolve(json({ _id: PERSON_ID }, opts.sendStatus ?? 200));
	}) as unknown as typeof fetch;
	return { fetchImpl, calls };
}

describe('sendInvite', () => {
	it("POSTs send-invite to the person on the selected collective's db and JWT, and returns the address", async () => {
		const { fetchImpl, calls } = wire({ emails: ['dora@person.example'] });
		await expect(sendInvite(cfg, PERSON_ID, fetchImpl)).resolves.toEqual({
			sent: true,
			email: 'dora@person.example'
		});
		const posts = calls.filter((c) => c.method === 'POST');
		expect(posts).toHaveLength(1);
		expect(posts[0].url).toMatch(/\/sampledb\/entity\/person-target$/);
		expect(posts[0].body).toEqual([{ type: 'entu_user', string: 'send-invite' }]);
		expect(posts[0].auth).toBe('Bearer jwt-owner');
		expect(calls.every((c) => c.method === 'GET' || c.method === 'POST')).toBe(true);
	});

	it('a person with no email: nothing is written, and the answer says so', async () => {
		const { fetchImpl, calls } = wire({});
		await expect(sendInvite(cfg, PERSON_ID, fetchImpl)).resolves.toEqual({ sent: false });
		expect(calls.length).toBeGreaterThan(0);
		expect(calls.filter((c) => c.method !== 'GET')).toEqual([]);
	});

	it('a withheld person read is an error, never a "no email"', async () => {
		const { fetchImpl, calls } = wire({ emails: ['dora@person.example'], readable: false });
		await expect(sendInvite(cfg, PERSON_ID, fetchImpl)).rejects.toThrow(SendInviteError);
		expect(calls.filter((c) => c.method !== 'GET')).toEqual([]);
	});

	it('a failed person read throws, and nothing is written', async () => {
		const { fetchImpl, calls } = wire({ readStatus: 500 });
		await expect(sendInvite(cfg, PERSON_ID, fetchImpl)).rejects.toThrow(/HTTP 500/);
		expect(calls.filter((c) => c.method !== 'GET')).toEqual([]);
	});

	it('a refused send (403) throws a SendInviteError naming the status', async () => {
		const { fetchImpl } = wire({ emails: ['dora@person.example'], sendStatus: 403 });
		const err = await sendInvite(cfg, PERSON_ID, fetchImpl).catch((e: unknown) => e);
		expect(err).toBeInstanceOf(SendInviteError);
		expect((err as Error).message).toMatch(/HTTP 403/);
		expect((err as Error).message).not.toContain('dora@person.example');
	});
});

// (*MVOX:Josquin*)
