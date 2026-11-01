// #374/#375/#1066: normalizeUrl(input, currentHost), the one save-time url fix.
import { describe, expect, it } from 'vitest';
import { normalizeUrl } from './normalizeUrl';

describe('#374 — schemeless input gets https:// prepended', () => {
	const cases: Array<[input: string, currentHost: string, expected: string]> = [
		['crede.ee/salvestused', 'mvox.eu', 'https://crede.ee/salvestused'],
		['example.com', 'mvox.eu', 'https://example.com'],
		['www.mvox.eu/x', 'mvox.eu', 'https://www.mvox.eu/x']
	];
	it.each(cases)('%s (on %s) → %s', (input, currentHost, expected) => {
		const out = normalizeUrl(input, currentHost);
		expect(out).toBe(expected);
		expect(normalizeUrl(out, currentHost)).toBe(out);
	});
});

describe('#374 — an input already carrying a scheme passes as typed', () => {
	const cases: Array<[input: string, currentHost: string]> = [
		['http://crede.ee/x', 'mvox.eu'],
		['https://crede.ee/x', 'mvox.eu'],
		['mailto:info@crede.ee', 'mvox.eu'],
		['tel:+3725551234', 'mvox.eu'],
		['ftp://files.crede.ee/y', 'mvox.eu'],
		['HTTPS://CREDE.EE/x', 'mvox.eu']
	];
	it.each(cases)('%s (on %s) → unchanged', (input, currentHost) => {
		expect(normalizeUrl(input, currentHost)).toBe(input);
	});
});

describe('#1066 — mailto: and tel: are schemes, not host:port', () => {
	it.each(['tel:+3725551234', 'tel:1234', 'mailto:a@b.ee', 'MAILTO:a@b.ee', 'Tel:1234'])(
		'%s passes as typed',
		(input) => {
			expect(normalizeUrl(input, 'mvox.eu')).toBe(input);
		}
	);

	it('a real host:port still gets https://', () => {
		expect(normalizeUrl('example.com:8080/x', 'mvox.eu')).toBe('https://example.com:8080/x');
	});
});

describe('#375 — own-host urls trim to a relative path that ALWAYS starts with /', () => {
	const trimmed: Array<[input: string, currentHost: string, expected: string]> = [
		['https://mvox.eu', 'mvox.eu', '/'],
		['https://mvox.eu/', 'mvox.eu', '/'],
		['https://mvox.eu?a=1', 'mvox.eu', '/?a=1'],
		['https://mvox.eu#x', 'mvox.eu', '/#x'],
		['https://mvox.eu/path?q=1#frag', 'mvox.eu', '/path?q=1#frag'],
		['https://mvox.eu/path/', 'mvox.eu', '/path/'],
		['https://MVOX.EU/Path', 'mvox.eu', '/Path'],
		['http://mvox.eu/x', 'mvox.eu', '/x'],
		['mvox.eu/events', 'mvox.eu', '/events'],
		['https://dev.mvox.eu:5173/x', 'dev.mvox.eu:5173', '/x']
	];
	it.each(trimmed)('%s (on %s) → %s', (input, currentHost, expected) => {
		const out = normalizeUrl(input, currentHost);
		expect(out).toBe(expected);
		expect(out).toMatch(/^\//);
		expect(normalizeUrl(out, currentHost)).toBe(out);
	});
});

describe('#375 — an input that is ALREADY a relative path passes through untouched (idempotency)', () => {
	const cases: Array<[input: string, currentHost: string]> = [
		['/salvestused', 'dev.mvox.eu'],
		['/salvestused?x=1#y', 'dev.mvox.eu'],
		['/path/', 'dev.mvox.eu'],
		['/Path/Case', 'dev.mvox.eu'],
		['/', 'dev.mvox.eu'],
		['/events', 'mvox.eu']
	];
	it.each(cases)('%s (on %s) → unchanged', (input, currentHost) => {
		expect(normalizeUrl(input, currentHost)).toBe(input);
	});

	it("PINNED: the '//' protocol-relative case still wins over the leading-'/' passthrough — order matters", () => {
		expect(normalizeUrl('//crede.ee/x', 'mvox.eu')).toBe('https://crede.ee/x');
		expect(normalizeUrl('//mvox.eu/x', 'mvox.eu')).toBe('/x');
	});
});

describe('#375 — any other host is returned unchanged (literal .host compare)', () => {
	const cases: Array<[input: string, currentHost: string]> = [
		['https://www.mvox.eu/x', 'mvox.eu'],
		['https://mvox.eu/x', 'www.mvox.eu'],
		['https://crede.ee/x', 'mvox.eu'],
		['https://dev.mvox.eu:5173/x', 'dev.mvox.eu'],
		['https://dev.mvox.eu/x', 'dev.mvox.eu:5173']
	];
	it.each(cases)('%s (on %s) → unchanged', (input, currentHost) => {
		expect(normalizeUrl(input, currentHost)).toBe(input);
	});
});

describe('pinned decisions — the ambiguous shapes', () => {
	it("PINNED: '//host/path' (protocol-relative) is schemeless — 'https:' goes in front, other host stays absolute", () => {
		expect(normalizeUrl('//crede.ee/x', 'mvox.eu')).toBe('https://crede.ee/x');
	});

	it("PINNED: '//host/path' on the OWN host trims relative after the prepend", () => {
		expect(normalizeUrl('//mvox.eu/x', 'mvox.eu')).toBe('/x');
	});

	it("PINNED: 'localhost:5173/x' is host:port, not a scheme — a colon followed by digits only (up to the first '/' or end) is a port", () => {
		expect(normalizeUrl('localhost:5173/x', 'dev.mvox.eu')).toBe('https://localhost:5173/x');
	});

	it("PINNED: 'localhost:5173/x' on currentHost 'localhost:5173' trims relative", () => {
		expect(normalizeUrl('localhost:5173/x', 'localhost:5173')).toBe('/x');
	});

	it('PINNED: unparseable after the prepend → input returned UNCHANGED, never a throw (no fallback — the page saves what was typed)', () => {
		expect(() => normalizeUrl('ex ample.com/x', 'mvox.eu')).not.toThrow();
		expect(normalizeUrl('ex ample.com/x', 'mvox.eu')).toBe('ex ample.com/x');
		expect(normalizeUrl('http://', 'mvox.eu')).toBe('http://');
	});

	it('PINNED: whitespace-only passes through unchanged — the non-empty check upstream runs on what was typed, before this helper', () => {
		expect(normalizeUrl('   ', 'mvox.eu')).toBe('   ');
	});
});

