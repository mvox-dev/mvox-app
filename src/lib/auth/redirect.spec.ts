import { describe, expect, it } from 'vitest';
import { safeRedirectTarget } from './redirect';

describe('safeRedirectTarget (open-redirect guard)', () => {
	it('passes through a local absolute path (with query)', () => {
		expect(safeRedirectTarget('/agenda?work=a')).toBe('/agenda?work=a');
		expect(safeRedirectTarget('/')).toBe('/');
	});

	it('rejects a protocol-relative `//host` target', () => {
		expect(safeRedirectTarget('//evil.com')).toBe('/');
		expect(safeRedirectTarget('//evil.com/path')).toBe('/');
	});

	it('rejects an absolute URL with a scheme', () => {
		expect(safeRedirectTarget('https://evil.com')).toBe('/');
		expect(safeRedirectTarget('http://evil.com/x')).toBe('/');
	});

	it('rejects a non-slash / relative target', () => {
		expect(safeRedirectTarget('evil.com')).toBe('/');
		expect(safeRedirectTarget('agenda')).toBe('/');
	});

	it('maps null / empty to `/`', () => {
		expect(safeRedirectTarget(null)).toBe('/');
		expect(safeRedirectTarget('')).toBe('/');
	});
});
