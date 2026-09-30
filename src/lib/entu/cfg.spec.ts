import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ token: null as string | null }));
vi.mock('$lib/auth/storage', () => ({ getToken: () => h.token }));

import { cfgFor } from './cfg';

describe('cfgFor', () => {
	beforeEach(() => {
		h.token = null;
	});

	it('pairs the db with the stored token', () => {
		h.token = 'jwt-1';
		expect(cfgFor('choir')).toEqual({ db: 'choir', token: 'jwt-1' });
	});

	it("uses '' when no token is stored", () => {
		expect(cfgFor('choir')).toEqual({ db: 'choir', token: '' });
	});

	it('reads the token at call time', () => {
		h.token = 'old';
		const first = cfgFor('choir');
		h.token = 'new';
		expect(first).toEqual({ db: 'choir', token: 'old' });
		expect(cfgFor('choir')).toEqual({ db: 'choir', token: 'new' });
	});
});
