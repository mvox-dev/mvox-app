// A write with no token sends nothing and goes to the same session-expired handling a 401 gets.
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/entu-config', () => ({ ENTU_API_BASE: 'https://api.entu-test.invalid/' }));

async function freshRequest() {
	vi.resetModules();
	const req = await import('./request');
	const handler = vi.fn(() => new Promise<void>(() => {}));
	req.setAuthExpiredHandler(handler);
	const fetchImpl = vi.fn<typeof fetch>(async () => new Response('{}', { status: 200 }));
	return { req, handler, fetchImpl };
}

beforeEach(() => {
	vi.restoreAllMocks();
});

describe('entuFetch — no token (#550)', () => {
	it.each(['POST', 'PUT', 'DELETE'])('%s with no token: nothing sent, handler called, rejects auth-expired', async (method) => {
		const { req, handler, fetchImpl } = await freshRequest();
		const call = req.entuFetch('db1', 'entity/e1', '', { method }, fetchImpl);
		const error = await call.catch((e: unknown) => e);
		expect(req.isAuthExpiredError(error)).toBe(true);
		expect(fetchImpl).not.toHaveBeenCalled();
		expect(handler).toHaveBeenCalledTimes(1);
	});

	it('does not throw synchronously', async () => {
		const { req, fetchImpl } = await freshRequest();
		let call: Promise<Response> | undefined;
		expect(() => {
			call = req.entuFetch('db1', 'entity/e1', '', { method: 'POST' }, fetchImpl);
		}).not.toThrow();
		await expect(call).rejects.toMatchObject({ name: 'AuthExpiredError' });
	});

	it('a burst of no-token writes fires the handler once', async () => {
		const { req, handler, fetchImpl } = await freshRequest();
		const calls = [1, 2, 3].map(() =>
			req.entuFetch('db1', 'entity/e1', '', { method: 'POST' }, fetchImpl).catch((e: unknown) => e)
		);
		const errors = await Promise.all(calls);
		expect(errors.map((e) => req.isAuthExpiredError(e))).toEqual([true, true, true]);
		expect(handler).toHaveBeenCalledTimes(1);
		expect(fetchImpl).not.toHaveBeenCalled();
	});

	it('a GET with no token still sends, and the handler is not called', async () => {
		const { req, handler, fetchImpl } = await freshRequest();
		const res = await req.entuFetch('db1', 'entity/e1', '', {}, fetchImpl);
		expect(res.status).toBe(200);
		expect(fetchImpl).toHaveBeenCalledTimes(1);
		expect(fetchImpl.mock.calls[0]).toEqual([
			'https://api.entu-test.invalid/db1/entity/e1',
			{ headers: { Authorization: 'Bearer ', Accept: 'application/json' } }
		]);
		expect(handler).not.toHaveBeenCalled();
	});
});

// (*MVOX:Josquin*)
