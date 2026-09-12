// #318 RED — the build-time generator: doc + source commit SHA (+ commit date,
// Gama 2026-09-12 item 3) → the GITIGNORED rules bundle.
//
// The bundle is a stamped VIEW: every rule in it is the parser's verbatim
// extraction, and the stamp (sourceCommit + sourceCommitDate) rides on it so a
// stale answer is detectable at a glance rather than merely plausible. The
// generated file is never committed — a committed copy would be the
// independent rule store #318 forbids (fences.spec.ts pins the .gitignore
// entry).
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildBundle, generateBundleJson } from './src/generate';
import { parseRightsDoc } from './src/parse';

const DOC_PATH = resolve(
	__dirname,
	'../../docs/architecture/entu-rights-and-visibility-model.md'
);
const doc = readFileSync(DOC_PATH, 'utf-8');

// Injected fake stamp — the generator takes the SHA/date as INPUTS (the build
// script runs `git rev-parse HEAD` etc.; the pure function never shells out).
const FAKE_SHA = 'deadbeefcafe0123456789abcdef0123456789ab';
const FAKE_DATE = '2026-09-12T00:00:00Z';

describe('buildBundle: the in-memory stamped view', () => {
	it('carries all 23 parsed rules plus the injected stamp — nothing else', () => {
		const bundle = buildBundle(doc, FAKE_SHA, FAKE_DATE);
		expect(Object.keys(bundle).sort()).toEqual(['rules', 'sourceCommit', 'sourceCommitDate']);
		expect(bundle.sourceCommit).toBe(FAKE_SHA);
		expect(bundle.sourceCommitDate).toBe(FAKE_DATE);
		expect(bundle.rules.length).toBe(23);
	});

	it('bundle rules ARE the parser output — the full parsed shape, verbatim text included (toEqual, not a subset)', () => {
		const bundle = buildBundle(doc, FAKE_SHA, FAKE_DATE);
		expect(bundle.rules).toEqual(parseRightsDoc(doc).rules);
	});

	it('a doc with parse rejects throws — fail loudly, never emit a partial rule store', () => {
		const malformed = ['> **ER-0** — malformed id.', '> Evidence: `entity.js:1`.', ''].join('\n');
		expect(() => buildBundle(malformed, FAKE_SHA, FAKE_DATE)).toThrow(/ER-0|reject/i);
	});
});

describe('generateBundleJson: the emitted module bytes', () => {
	it('is deterministic — running twice on the same inputs is byte-identical', () => {
		const a = generateBundleJson(doc, FAKE_SHA, FAKE_DATE);
		const b = generateBundleJson(doc, FAKE_SHA, FAKE_DATE);
		expect(a).toBe(b);
	});

	it('parses back to exactly the buildBundle output (JSON round-trip, full shape)', () => {
		const emitted = generateBundleJson(doc, FAKE_SHA, FAKE_DATE);
		const roundTripped: unknown = JSON.parse(emitted);
		expect(roundTripped).toEqual(JSON.parse(JSON.stringify(buildBundle(doc, FAKE_SHA, FAKE_DATE))));
	});

	it('the injected stamp is present in the emitted bytes — every downstream response inherits it from here', () => {
		const emitted = generateBundleJson(doc, FAKE_SHA, FAKE_DATE);
		expect(emitted).toContain(FAKE_SHA);
		expect(emitted).toContain(FAKE_DATE);
	});

	it('a different source commit changes the emitted bytes (the stamp is load-bearing, not decorative)', () => {
		const a = generateBundleJson(doc, FAKE_SHA, FAKE_DATE);
		const b = generateBundleJson(doc, '0123456789abcdef0123456789abcdef01234567', FAKE_DATE);
		expect(a).not.toBe(b);
	});

	it('refuses a doc with parse rejects — same loud failure as buildBundle', () => {
		const malformed = ['> **ER-0** — malformed id.', '> Evidence: `entity.js:1`.', ''].join('\n');
		expect(() => generateBundleJson(malformed, FAKE_SHA, FAKE_DATE)).toThrow(/ER-0|reject/i);
	});
});
