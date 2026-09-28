// #395 slice 2/2 RED — "One create path, structurally enforced" (Done when).
//
// The literal that only a `feedback` CREATE ever needs is the type name as a
// quoted string — `resolveTypeId(cfg, 'feedback')` resolves the `_type`
// reference the create POST carries. So every quoted form of it must live in
// exactly one non-spec source file: src/lib/feedback/feedbackActions.ts.
// Same shape as src/lib/profile/soleCreatePath.spec.ts (the precedent), via
// the shared $lib/testing/soleLiteralGuard.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { findSourceFiles, isSoleCreatePathViolation } from '$lib/testing/soleLiteralGuard';

const NEEDLES = ["'feedback'", '"feedback"', '`feedback`'];
const EXEMPT = ['lib/feedback/feedbackActions.ts'];

function violates(rel: string, content: string): boolean {
	return NEEDLES.some((needle) => isSoleCreatePathViolation(rel, content, needle, EXEMPT));
}

describe('#395 sole feedback create path — guard predicate (self-test)', () => {
	it('flags a second module that contains the create literal', () => {
		expect(violates('lib/feedback/secondCreate.ts', "await resolveTypeId(cfg, 'feedback');")).toBe(true);
		expect(violates('routes/feedback/+page.svelte', 'resolveTypeId(cfg, "feedback")')).toBe(true);
	});

	it('does NOT flag the one exempt module', () => {
		expect(violates('lib/feedback/feedbackActions.ts', "resolveTypeId(cfg, 'feedback')")).toBe(false);
	});

	it('does NOT flag a .spec.ts file', () => {
		expect(violates('lib/feedback/other.spec.ts', "name.string=feedback 'feedback'")).toBe(false);
	});

	it('does NOT flag a file that never quotes the type name', () => {
		expect(violates('lib/feedback/feedbackData.ts', 'export async function loadFeedback() {}')).toBe(false);
	});
});

describe('#395 sole feedback create path (integration — real src/ tree)', () => {
	const libDir = join(import.meta.dirname, '..'); // src/lib
	const srcDir = join(libDir, '..'); // src

	it('the exempt module exists and actually carries the literal (the guard is not vacuous)', () => {
		const content = readFileSync(join(srcDir, EXEMPT[0]), 'utf-8');
		expect(NEEDLES.some((n) => content.includes(n))).toBe(true);
	});

	it('no .ts/.svelte file under src/lib or src/routes outside feedbackActions.ts carries the feedback create literal', () => {
		const candidates = [
			...findSourceFiles(libDir, ['.ts', '.svelte']),
			...findSourceFiles(join(srcDir, 'routes'), ['.ts', '.svelte'])
		];
		const violations = candidates
			.map((full) => ({ full, rel: relative(srcDir, full) }))
			.filter(({ rel, full }) => violates(rel, readFileSync(full, 'utf-8')))
			.map(({ rel }) => rel);
		expect(violations).toEqual([]);
	});
});

// (*MVOX:Tallis*)
