import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { findSourceFiles, isSoleCreatePathViolation } from '$lib/testing/soleLiteralGuard';

// #161 RED — collective = database: the Organization entity TYPE is eliminated
// (#159 already deleted every instance). This is the standing STRUCTURAL guard
// for the acceptance criteria "zero remaining `_type.string=organization`
// queries" and "all `entity_type === 'organization'` checks changed to
// `'database'`" — the same walk-the-tree pattern as soleCreatePath.spec.ts,
// with an EMPTY allowlist: no non-spec file under src/ may carry the literals.
//
// Comments count deliberately: a comment quoting the retired query shape is a
// comment describing mechanics the app no longer has — rewrite it, don't keep it.
//
// The second describe forces the RENAME: `resolveMyOrgId` / `$lib/org/myOrg`
// (the person → member → organization walk) is replaced by
// `$lib/collective/databaseEntity`'s `resolveDatabaseEntityId`; no non-spec file
// may still name the old function or import the old module — including
// `src/lib/org/myOrg.ts` itself, which is deleted, not kept as a shim.
//
// NOTE (GREEN): pre-#161 specs that pin the ORGANIZATION world (myOrg.spec.ts,
// rosterData.org.spec.ts, sectionActions.create-org.spec.ts's legacy-fallback
// cases, and every spec mocking `$lib/org/myOrg`) describe retired behavior —
// they are superseded by the #161 specs and go with the GREEN pass. Spec files
// are exempt from THIS guard precisely so their removal is GREEN's explicit,
// reviewed act rather than a side effect.

const SRC_EXTENSIONS = ['.ts', '.svelte'];
const NO_EXEMPTIONS: string[] = [];

/** The operative Organization literals — query shape and entity_type filters. */
const ORGANIZATION_NEEDLES = [
	'_type.string=organization',
	"entity_type === 'organization'",
	"entity_type: 'organization'"
];

/** The retired resolution chain — function name and module path. */
const MYORG_NEEDLES = ['resolveMyOrgId', 'org/myOrg'];

function violations(needles: string[]): string[] {
	const libDir = join(import.meta.dirname, '..'); // src/lib
	const srcDir = join(libDir, '..'); // src
	const routesDir = join(srcDir, 'routes');

	const candidates = [
		...findSourceFiles(libDir, SRC_EXTENSIONS),
		...findSourceFiles(routesDir, SRC_EXTENSIONS)
	];
	const out: string[] = [];
	for (const full of candidates) {
		const rel = relative(srcDir, full);
		const content = readFileSync(full, 'utf-8');
		for (const needle of needles) {
			if (isSoleCreatePathViolation(rel, content, needle, NO_EXEMPTIONS)) {
				out.push(`${rel} :: ${needle}`);
				break; // one entry per file is enough to name it
			}
		}
	}
	return out.sort();
}

describe('#161 — Organization is not an entity type this app knows', () => {
	it('no non-spec file under src/ queries `_type.string=organization` or filters `_parent` by entity_type organization', () => {
		expect(violations(ORGANIZATION_NEEDLES)).toEqual([]);
	});

	it('no non-spec file under src/ references `resolveMyOrgId` or the `$lib/org/myOrg` module — the resolution lives in $lib/collective/databaseEntity now', () => {
		expect(violations(MYORG_NEEDLES)).toEqual([]);
	});
});

// (*MVOX:Tallis* — #161 RED)
