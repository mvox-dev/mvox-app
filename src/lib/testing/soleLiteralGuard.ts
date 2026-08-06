// Structural sole-path guard utilities — extracted from soleCreatePath.spec.ts
// (T4.4/#25) so multiple structural specs can share them without importing one
// spec file from another (which would double-register its describes).
//
// The pattern: pick a LITERAL that only the sole intended module ever needs to
// contain, walk the source tree, and flag any non-exempt, non-spec file carrying
// it. Currently used by:
// - src/lib/profile/soleCreatePath.spec.ts (T4.4 AC4)
// - src/lib/invite/singleInviteMechanism.spec.ts (T4.5 AC3)

import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Pure predicate — kept separate from the fs walk so it's unit-testable against
 * synthetic content without touching real files.
 */
export function isSoleCreatePathViolation(
	relPath: string,
	content: string,
	needle: string,
	exemptRelPaths: string[]
): boolean {
	if (relPath.endsWith('.spec.ts')) return false; // tests may reference the literal in assertions/comments
	if (exemptRelPaths.includes(relPath)) return false;
	return content.includes(needle);
}

/**
 * Recursively list files under `dir` whose name ends with one of `extensions`
 * (e.g. `['.ts']` or `['.ts', '.svelte']` — route pages are `.svelte`, so a
 * mechanism guard that ignored them would be blind to a second UI-side path).
 */
export function findSourceFiles(dir: string, extensions: string[]): string[] {
	const out: string[] = [];
	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry);
		if (statSync(full).isDirectory()) {
			out.push(...findSourceFiles(full, extensions));
			continue;
		}
		if (extensions.some((ext) => full.endsWith(ext))) out.push(full);
	}
	return out;
}

