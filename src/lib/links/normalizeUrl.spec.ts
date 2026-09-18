// #374 + #375 RED — normalizeUrl(input, currentHost): the ONE pure helper both
// save paths run at payload-build time.
//
// Law (Gama issues #374/#375, pins 2026-09-18):
//   (a) #374 — no scheme → `https://` prepended, silently; any scheme
//       (http:, https:, mailto:, tel:, …) passes AS TYPED through step (a).
//   (b) #375 — after (a), a url whose parsed WHATWG .host equals currentHost
//       (literal compare — .host includes the port; www ≠ bare; URL parsing
//       lowercases the host so the compare is case-insensitive) is returned
//       as pathname+search+hash, ALWAYS beginning with '/': an empty path
//       trims to '/', never to the empty string. Any other host → the
//       (possibly prepended) string returned unchanged — no URL
//       re-serialisation of what the person typed.
//
// Pinned decisions (each named in its test):
//   - `//host/path` (protocol-relative) is schemeless: `https:` in front.
//   - `host:port/…` (the "scheme" is digits-only up to the first `/` or end)
//     is schemeless, not a scheme.
//   - unparseable after the prepend → input returned UNCHANGED, never throw.
//   - whitespace-only is rejected upstream (the page's non-empty check runs
//     on what was typed, BEFORE this helper) — here it passes through as-is.
import { describe, expect, it } from 'vitest';
import { normalizeUrl } from './normalizeUrl';

describe('#374 — schemeless input gets https:// prepended', () => {
	const cases: Array<[input: string, currentHost: string, expected: string]> = [
		['crede.ee/salvestused', 'mvox.eu', 'https://crede.ee/salvestused'],
		['example.com', 'mvox.eu', 'https://example.com'],
		// www is NOT the bare host — prepended, then left absolute (#375
		// literal host compare).
		['www.mvox.eu/x', 'mvox.eu', 'https://www.mvox.eu/x']
	];
	it.each(cases)('%s (on %s) → %s', (input, currentHost, expected) => {
		const out = normalizeUrl(input, currentHost);
		expect(out).toBe(expected);
		// Idempotent: the prepended output re-normalises to itself.
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
		// Scheme detection is case-insensitive; an other-host absolute url is
		// returned VERBATIM — no URL re-serialisation (no lowercasing).
		['HTTPS://CREDE.EE/x', 'mvox.eu']
	];
	it.each(cases)('%s (on %s) → unchanged', (input, currentHost) => {
		expect(normalizeUrl(input, currentHost)).toBe(input);
	});
});

describe('#375 — own-host urls trim to a relative path that ALWAYS starts with /', () => {
	// [input, currentHost, expected-relative]
	const trimmed: Array<[input: string, currentHost: string, expected: string]> = [
		// Empty path parses to '/' — a trim that would leave nothing stores
		// '/', never the empty string (Gama pin, 2026-09-18).
		['https://mvox.eu', 'mvox.eu', '/'],
		['https://mvox.eu/', 'mvox.eu', '/'],
		['https://mvox.eu?a=1', 'mvox.eu', '/?a=1'],
		['https://mvox.eu#x', 'mvox.eu', '/#x'],
		['https://mvox.eu/path?q=1#frag', 'mvox.eu', '/path?q=1#frag'],
		// Trailing slash preserved.
		['https://mvox.eu/path/', 'mvox.eu', '/path/'],
		// Host compare is case-insensitive (URL lowercases the host); the
		// path keeps its case.
		['https://MVOX.EU/Path', 'mvox.eu', '/Path'],
		// A non-https scheme still trims when the host matches — the trim
		// runs on the parsed host, not on the scheme.
		['http://mvox.eu/x', 'mvox.eu', '/x'],
		// Schemeless own-host: #374's prepend runs FIRST, then the trim.
		['mvox.eu/events', 'mvox.eu', '/events'],
		// .host includes the port — dev surface with port matches itself.
		['https://dev.mvox.eu:5173/x', 'dev.mvox.eu:5173', '/x']
	];
	it.each(trimmed)('%s (on %s) → %s', (input, currentHost, expected) => {
		const out = normalizeUrl(input, currentHost);
		expect(out).toBe(expected);
		// The Gama pin as a law over EVERY trimmed case: relative means
		// starts-with-'/', no exception.
		expect(out).toMatch(/^\//);
		// Idempotency law over EVERY trimmed case: re-normalising what was
		// stored is a no-op. This is the re-save path — the admin reopens a
		// row holding a relative url and edits only the name.
		expect(normalizeUrl(out, currentHost)).toBe(out);
	});
});

describe('#375 — an input that is ALREADY a relative path passes through untouched (idempotency)', () => {
	// The stored shape of #375 is a leading-'/' path. Re-saving it (edit the
	// name, leave the url alone) must not read it as schemeless: prepending
	// would produce `https:///salvestused`, which WHATWG parses as host
	// `salvestused` — a dead link to someone else's domain.
	const cases: Array<[input: string, currentHost: string]> = [
		['/salvestused', 'dev.mvox.eu'],
		['/salvestused?x=1#y', 'dev.mvox.eu'],
		['/path/', 'dev.mvox.eu'],
		['/Path/Case', 'dev.mvox.eu'],
		['/', 'dev.mvox.eu'],
		// Host-independent: the path is relative to whatever surface renders
		// it, so currentHost never enters the decision.
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
		// .host (not .hostname): a different/absent port is a DIFFERENT host.
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
		// A space is a forbidden host code point — `https://ex ample.com/x`
		// throws in the WHATWG parser.
		expect(() => normalizeUrl('ex ample.com/x', 'mvox.eu')).not.toThrow();
		expect(normalizeUrl('ex ample.com/x', 'mvox.eu')).toBe('ex ample.com/x');
		// Scheme present but unparseable (`new URL('http://')` throws) —
		// unchanged too.
		expect(normalizeUrl('http://', 'mvox.eu')).toBe('http://');
	});

	it('PINNED: whitespace-only passes through unchanged — the non-empty check upstream runs on what was typed, before this helper', () => {
		expect(normalizeUrl('   ', 'mvox.eu')).toBe('   ');
	});
});

// (*MVOX:Tallis* — #374/#375 RED)
