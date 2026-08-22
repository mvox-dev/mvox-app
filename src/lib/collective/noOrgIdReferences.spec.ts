import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { findSourceFiles } from '$lib/testing/soleLiteralGuard';

// #174 RED — rename orgId → dbEntityId. With Organization eliminated (#161)
// and collective = database, `orgId` is a misleading name: the value it holds
// is the DATABASE entity ID, not an organization ID. #161 changed the
// resolution logic but deliberately kept the variable names for minimal diff;
// this is the standing STRUCTURAL guard that forces the rename to actually
// land everywhere and never creep back.
//
// Rules (case-sensitive, per line):
// - Any line in a non-spec .ts/.svelte file under src/ containing the literal
//   `orgId` is a violation — identifiers, type members, props, params,
//   template expressions, all of it. This also catches suffix compounds like
//   `orgIds`. (CamelCase prefix compounds capitalize the O — `myOrgId` — and
//   the operative one, `resolveMyOrgId`, is already banned by the #161 guard
//   in noOrganizationReferences.spec.ts.)
// - SOLE exemption: a comment line that documents the rename itself, i.e. a
//   line that is a comment AND mentions BOTH `orgId` and `dbEntityId`
//   (e.g. `// renamed from orgId → dbEntityId in #174`). A comment that says
//   `orgId` without naming the successor is describing a world the app no
//   longer has — rewrite it, don't keep it.
// - Spec files are exempt (same stance as noOrganizationReferences.spec.ts):
//   retiring the pre-#174 specs that pin the `orgId` names is GREEN's
//   explicit, reviewed act, not a side effect of this guard.

const SRC_EXTENSIONS = ['.ts', '.svelte'];
const NEEDLE = 'orgId';
const SUCCESSOR = 'dbEntityId';

/** True when the trimmed line reads as a comment in .ts or .svelte source. */
export function isCommentLine(line: string): boolean {
	const t = line.trim();
	return (
		t.startsWith('//') ||
		t.startsWith('/*') ||
		t.startsWith('*') ||
		t.startsWith('<!--')
	);
}

/**
 * Pure per-file predicate — returns the 1-based line numbers of violating
 * lines, so failures name exactly where the rename was missed.
 */
export function orgIdViolationLines(content: string): number[] {
	const out: number[] = [];
	content.split('\n').forEach((line, i) => {
		if (!line.includes(NEEDLE)) return;
		// Sole exemption: rename-history comment naming both old and new.
		if (isCommentLine(line) && line.includes(SUCCESSOR)) return;
		out.push(i + 1);
	});
	return out;
}

function violations(): string[] {
	const libDir = join(import.meta.dirname, '..'); // src/lib
	const srcDir = join(libDir, '..'); // src

	// The WHOLE src tree, one root — findSourceFiles recurses, so this subsumes
	// src/lib and src/routes while also catching top-level src/*.ts (app.d.ts,
	// a future hooks.server.ts) and any directory added later. Scanning the two
	// subtrees separately left those silently unguarded (#174 review fix).
	const candidates = findSourceFiles(srcDir, SRC_EXTENSIONS);
	const out: string[] = [];
	for (const full of candidates) {
		const rel = relative(srcDir, full);
		if (rel.endsWith('.spec.ts')) continue;
		const lines = orgIdViolationLines(readFileSync(full, 'utf-8'));
		if (lines.length > 0) out.push(`${rel} :: lines ${lines.join(', ')}`);
	}
	return out.sort();
}

describe('#174 — orgId is not a name this app uses (it is dbEntityId)', () => {
	it('no non-spec .ts/.svelte file under src/ contains the literal `orgId` (case-sensitive), except comments documenting the rename', () => {
		expect(violations()).toEqual([]);
	});
});

describe('#174 — guard mechanics (unit, synthetic content)', () => {
	it('flags a plain identifier line', () => {
		expect(orgIdViolationLines('const orgId = resolve();')).toEqual([1]);
	});

	it('flags suffix compounds — orgIds is a rename miss too', () => {
		expect(orgIdViolationLines('const orgIds = [];')).toEqual([1]);
	});

	it('camelCase prefix compounds capitalize the O and are out of scope here — `myOrgId` is already banned by the #161 guard (`resolveMyOrgId`)', () => {
		expect(orgIdViolationLines('let myOrgId = 1;')).toEqual([]);
	});

	it('flags a comment that says orgId without naming dbEntityId', () => {
		expect(orgIdViolationLines('// orgId comes from the member walk')).toEqual([1]);
	});

	it('exempts a rename-history comment naming both old and new', () => {
		expect(orgIdViolationLines('// renamed from orgId to dbEntityId in #174')).toEqual([]);
		expect(orgIdViolationLines(' * `orgId` became `dbEntityId` (#174)')).toEqual([]);
	});

	it('does NOT exempt code lines that merely mention both names', () => {
		expect(orgIdViolationLines('const dbEntityId = orgId;')).toEqual([1]);
	});

	it('is case-sensitive — OrgID / ORGID are not the needle', () => {
		expect(orgIdViolationLines('const OrgID = 1; // ORGID')).toEqual([]);
	});
});

// (*MVOX:Tallis* — #174 RED)
