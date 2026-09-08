// #285 RED — the Estonian isikukood checksum validator, unit-pinned in
// isolation (the birthdateToWire one-concern precedent). The export is a stub
// that throws 'not implemented', so every assertion below FAILS until GREEN.
//
// THE RULE, exactly and ONLY: empty → valid (optional field); else exactly
// 11 digits (/^\d{11}$/) AND a valid EVS 585 check digit. Nothing else —
// no trimming, no century/sex plausibility, no date plausibility (the
// over-validation fence below pins their ABSENCE).
import { describe, expect, it } from 'vitest';
import { isValidIdCode } from './idCode';

describe('#285 isValidIdCode — empty is valid (the field is optional)', () => {
	it("'' → true: an empty isikukood saves normally, the guard skips it", () => {
		expect(isValidIdCode('')).toBe(true);
	});
});

describe('#285 isValidIdCode — the three checksum branches (EVS 585, hand-computed vectors, synthetic dates)', () => {
	it("STAGE 1: '50001010017' is valid — digits [5,0,0,0,1,0,1,0,0,1] · weights [1,2,3,4,5,6,7,8,9,1] = 5+5+7+1 = 18; 18 % 11 = 7 = check digit", () => {
		expect(isValidIdCode('50001010017')).toBe(true);
	});

	it("STAGE 2: '10000000098' is valid — stage 1: 1·1 + 9·1 = 10 → remainder 10, re-weight; stage 2: 1·3 + 9·3 = 30; 30 % 11 = 8 = check digit", () => {
		expect(isValidIdCode('10000000098')).toBe(true);
	});

	it("DOUBLE FALLBACK: '80001010010' is valid — stage 1: 8+5+7+1 = 21 → 21 % 11 = 10; stage 2: 24+7+9+3 = 43 → 43 % 11 = 10 → check digit is 0 (the branch most likely miscoded — pinned)", () => {
		expect(isValidIdCode('80001010010')).toBe(true);
	});

	it("wrong check digit: '50001010011' is invalid (stage 1 says 7, the string says 1)", () => {
		expect(isValidIdCode('50001010011')).toBe(false);
	});

	// Exhaustive last-digit sweep on the stage-1 vector: exactly ONE of the ten
	// candidates is valid — the checksum discriminates, it doesn't rubber-stamp.
	it.each(['0', '1', '2', '3', '4', '5', '6', '8', '9'])(
		"'5000101001%s' is invalid — only check digit 7 fits the stage-1 arithmetic",
		(d) => {
			expect(isValidIdCode(`5000101001${d}`)).toBe(false);
		}
	);

	// Same sweep on the double-fallback vector: only 0 fits.
	it.each(['1', '2', '3', '4', '5', '6', '7', '8', '9'])(
		"'8000101001%s' is invalid — the double-fallback check digit is 0, nothing else",
		(d) => {
			expect(isValidIdCode(`8000101001${d}`)).toBe(false);
		}
	);
});

describe('#285 isValidIdCode — exactly 11 digits, no trimming leniency', () => {
	it("10 digits: '5000101001' is invalid", () => {
		expect(isValidIdCode('5000101001')).toBe(false);
	});

	it("12 digits: '500010100178' is invalid", () => {
		expect(isValidIdCode('500010100178')).toBe(false);
	});

	it("a letter: '5000101001a' is invalid", () => {
		expect(isValidIdCode('5000101001a')).toBe(false);
	});

	it("leading space: ' 50001010017' is invalid — the rule is exact digits, the guard does NOT trim on the caller's behalf", () => {
		expect(isValidIdCode(' 50001010017')).toBe(false);
	});

	it("trailing space: '50001010017 ' is invalid — same exactness, both ends", () => {
		expect(isValidIdCode('50001010017 ')).toBe(false);
	});

	it("internal separator: '50001 010017' is invalid", () => {
		expect(isValidIdCode('50001 010017')).toBe(false);
	});
});

describe('#285 isValidIdCode — OVER-VALIDATION FENCE: the rule is the checksum, nothing more', () => {
	// The issue's own strict-vs-email rationale cuts BOTH ways: the rule is
	// strict because the spec is closed, and it is ONLY what the spec's
	// checksum defines. Century/sex-range and date-plausibility checks are
	// outside the commission — their absence is pinned here, so a future
	// "improvement" that rejects a checksum-valid value is caught as the
	// regression it is.
	it("'90002310022' is VALID — leading digit 9 (no assigned century/sex) and \"31 February\", but the checksum holds: [9,0,0,0,2,3,1,0,0,2]·[1,2,3,4,5,6,7,8,9,1] = 9+10+18+7+2 = 46; 46 % 11 = 2 = check digit", () => {
		expect(isValidIdCode('90002310022')).toBe(true);
	});
});

// (*MVOX:Tallis* — #285 RED, checksum vectors hand-computed against EVS 585
//  references)
