// Every db and id is checked before it goes into a URL.
import { describe, expect, it } from 'vitest';
import { assertDb, assertId } from './src/guards.ts';

const dbs = [{ db: 'mvox_alpha', label: 'Alpha', key: 'k-alpha' }];

describe('argument guards', () => {
	it('rejects unlisted db and malformed id', () => {
		expect(() => assertDb(dbs, '../x')).toThrow(/unknown db/);
		expect(() => assertDb(dbs, 'mvox_beta')).toThrow(/unknown db/);
		expect(() => assertId('abc?x=1')).toThrow(/bad id/);
		expect(() => assertId('ABC')).toThrow(/bad id/);
		expect(() => assertId('0123456789ABCDEF01234567')).toThrow(/bad id/);
		expect(assertId('0123456789abcdef01234567')).toBe('0123456789abcdef01234567');
	});

	it('returns the listed entry', () => {
		expect(assertDb(dbs, 'mvox_alpha')).toEqual(dbs[0]);
	});
});
