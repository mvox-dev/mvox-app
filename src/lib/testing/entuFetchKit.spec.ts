// The shared Entu fetch kit builds exactly what the specs that import it expect.
import { describe, expect, it } from 'vitest';
import { deferred, json, testCfg } from './entuFetchKit';

describe('json', () => {
	it('serialises the body with status 200 by default', async () => {
		const res = json({ entities: [], count: 0 });
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ entities: [], count: 0 });
	});

	it('carries the given status', () => {
		expect(json({ error: 'nope' }, 403).status).toBe(403);
	});

	it('sets headers only when given', () => {
		expect(json({}).headers.get('Content-Type')).toBe('text/plain;charset=UTF-8');
		const res = json({}, 200, { 'Content-Type': 'application/json' });
		expect(res.headers.get('Content-Type')).toBe('application/json');
	});
});

describe('deferred', () => {
	it('stays pending until resolved, then yields the value', async () => {
		const d = deferred<number>();
		let seen: number | undefined;
		void d.promise.then((v) => (seen = v));
		await Promise.resolve();
		expect(seen).toBeUndefined();
		d.resolve(7);
		await d.promise;
		expect(seen).toBe(7);
	});

	it('rejects with the given error', async () => {
		const d = deferred();
		const err = new Error('write failed');
		d.reject(err);
		await expect(d.promise).rejects.toBe(err);
	});
});

describe('testCfg', () => {
	it('defaults the token to jwt', () => {
		expect(testCfg('testdb')).toEqual({ db: 'testdb', token: 'jwt' });
	});

	it('takes another token', () => {
		expect(testCfg('sampledb', 'jwt-admin')).toEqual({ db: 'sampledb', token: 'jwt-admin' });
	});
});
