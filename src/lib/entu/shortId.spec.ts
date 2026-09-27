// @vitest-environment node
//
// #487 RED — shortEntuId: the short form an Entu reference shows in place of
// a person's name. CONTRACT (GREEN implements src/lib/entu/shortId.ts):
//
//   shortEntuId(id: string): string — the LAST 6 characters of the `_id`.
//
// WHY the suffix, not the prefix: an Entu `_id` leads with its creation
// timestamp, so records created minutes apart share the head. The two
// fixtures below (src/lib/library/editionFiles.spec.ts ~261/~264) share their
// first 6 characters and differ in the last 6.
//
// NAMING: not "idCode" — src/lib/roster/idCode.ts is the unrelated isikukood
// validator.
import { describe, expect, it } from 'vitest';
import { shortEntuId } from './shortId';

describe('#487 — shortEntuId returns the last 6 characters of an Entu _id', () => {
	it('6a9f440dca67df980f417d78 → 417d78', () => {
		expect(shortEntuId('6a9f440dca67df980f417d78')).toBe('417d78');
	});

	it('6a9f4512ca67df980f417d81 → 417d81', () => {
		expect(shortEntuId('6a9f4512ca67df980f417d81')).toBe('417d81');
	});

	it('two ids sharing a timestamp prefix get distinct short forms', () => {
		const a = '6a9f440dca67df980f417d78';
		const b = '6a9f4512ca67df980f417d81';
		// Fixtures share their first 5 characters (the timestamp head diverges
		// at the 6th character for these two) — still close enough to motivate
		// the suffix-not-prefix design the comment above describes.
		expect(a.slice(0, 5)).toBe(b.slice(0, 5));
		expect(shortEntuId(a)).not.toBe(shortEntuId(b));
	});

	it("Mihkel's example id 6a92a3f2ca67df980f4154c4 → 4154c4", () => {
		expect(shortEntuId('6a92a3f2ca67df980f4154c4')).toBe('4154c4');
	});
});

// (*MVOX:Tallis* — #487 RED)
