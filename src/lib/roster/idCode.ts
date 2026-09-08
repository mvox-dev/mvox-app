// #285 — the Estonian isikukood checksum validator, PURE and one-concern (the
// `birthdateToWire` precedent: a single exported function, unit-tested in
// isolation, called INLINE from the page's save handler).
//
// PLACEMENT CONTRACT (issue #285 + Gama's promotion comment): this is the
// THIRD guard in `saveRecordEditor`'s established refusal slot — after the
// #283 email guard, BEFORE the generation capture and the single-flight arm —
// because a refusal is not a write: it must never arm the lock and never
// reach the fresh-lookup re-read.
//
// THE RULE, exactly and ONLY (a strict rule is right HERE because the
// isikukood has a precise, closed, checksummable specification — the opposite
// of #283's deliberately-permissive email rule; do NOT harmonise them):
//
//   empty        → valid (the field is optional; an empty value saves normally)
//   otherwise    → exactly 11 digits (/^\d{11}$/ — no trimming, no leniency)
//                  AND a valid Estonian check digit (EVS 585):
//
//   stage 1: dot-product of digits 1–10 with weights [1,2,3,4,5,6,7,8,9,1],
//            mod 11. Remainder < 10 → that IS the check digit.
//   stage 2: remainder == 10 → re-weight with [3,4,5,6,7,8,9,1,2,3], mod 11.
//            Remainder < 10 → that is the check digit.
//   fallback: stage-2 remainder == 10 too → the check digit is 0.
//
//   Worked three-branch vectors (synthetic dates, hand-computed — pinned in
//   idCode.spec.ts):
//     '50001010017': 5+0+0+0+5+0+7+0+0+1 = 18, 18 % 11 = 7  → stage-1, valid
//     '10000000098': stage-1 = 1+9 = 10 → 10 % 11 = 10; stage-2 = 3+27 = 30,
//                    30 % 11 = 8                            → stage-2, valid
//     '80001010010': stage-1 = 8+5+7+1 = 21 → 21 % 11 = 10; stage-2 =
//                    24+7+9+3 = 43 → 43 % 11 = 10 → check digit 0
//                                                 → double-fallback, valid
//
// OVER-VALIDATION FENCE: century/sex-range and date-plausibility checks are
// OUTSIDE the commission. '90002310022' (leading digit 9 — no assigned
// century/sex; "date" 31 February) carries a VALID check digit and MUST pass.
// The rule is the checksum, nothing more.
//
// PRIVACY (crede real-PII law): this function never throws a message carrying
// the value, never logs. It returns a boolean, full stop.

const STAGE1_WEIGHTS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 1];
const STAGE2_WEIGHTS = [3, 4, 5, 6, 7, 8, 9, 1, 2, 3];

function weightedRemainder(digits: number[], weights: number[]): number {
	let sum = 0;
	for (let i = 0; i < 10; i++) sum += digits[i] * weights[i];
	return sum % 11;
}

/** True when `value` is empty (optional field) or a checksum-valid Estonian
 *  isikukood: exactly 11 digits with a valid EVS 585 check digit. */
export function isValidIdCode(value: string): boolean {
	if (value === '') return true;
	if (!/^\d{11}$/.test(value)) return false;
	const digits = value.split('').map(Number);
	const checkDigit = digits[10];
	const stage1 = weightedRemainder(digits, STAGE1_WEIGHTS);
	if (stage1 < 10) return stage1 === checkDigit;
	const stage2 = weightedRemainder(digits, STAGE2_WEIGHTS);
	if (stage2 < 10) return stage2 === checkDigit;
	return checkDigit === 0;
}

// (*MVOX:Tallis* — #285 RED stub + contract header)
// (*MVOX:Josquin* — #285 GREEN: EVS 585 two-stage checksum implementation)
