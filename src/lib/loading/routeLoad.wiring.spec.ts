// The shared route-load machine must replace the per-page copies, not sit beside them.
// +layout.svelte and the agenda +page.svelte stay out: their guards compose or
// proceed rather than return, so they would need reshaping, not extracting.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { stripComments } from '$lib/testing/commentRules';

const SRC_ROOT = resolve(__dirname, '../..'); // …/src

const ROUTE_CONSUMERS = [
	'routes/profile/+page.svelte',
	'routes/roster/+page.svelte',
	'routes/library/+page.svelte',
	'routes/event/[id]/+page.svelte'
] as const;

const SUPERSET_EXTRAS: Record<string, readonly string[]> = {
	'lib/invite/InviteSurface.svelte': ["'no-access'", "'creating'", "'create-error'"],
	'routes/event/[id]/+page.svelte': ["'not-available'"]
};

const BASE_STATES = [
	"'loading'",
	"'no-collective'",
	"'load-error'",
	"'session-expired'",
	"'ready'"
] as const;

function read(rel: string): string {
	return readFileSync(resolve(SRC_ROOT, rel), 'utf8');
}

/** Every `type X = …;` alias body in the file (unions span lines). */
function typeAliasBodies(src: string): string[] {
	return [...src.matchAll(/\btype\s+[A-Za-z_$][\w$]*\s*=\s*([^;]*);/g)].map((m) => m[1]);
}

/** True when some single type alias re-spells the FULL 5-state base union
 *  (template `status === '…'` comparisons are fine — only the DECLARATION
 *  counts as duplication). */
function respellsBaseUnion(src: string): boolean {
	return typeAliasBodies(src).some((body) => BASE_STATES.every((s) => body.includes(s)));
}

describe('#232 — the shared route-load machine is wired into its consumers (source scan)', () => {
	for (const rel of ROUTE_CONSUMERS) {
		describe(rel, () => {
			it('imports from $lib/loading/routeLoad', () => {
				expect(read(rel)).toMatch(/from\s+['"]\$lib\/loading\/routeLoad['"]/);
			});

			it('constructs the shared machine (createRouteLoadMachine)', () => {
				expect(read(rel)).toMatch(/createRouteLoadMachine\s*[(<]/);
			});

			it('carries no local generation counter — the machine owns it', () => {
				expect(read(rel)).not.toMatch(/\blet\s+generation\s*=\s*0\b/);
			});

			it('declares no local re-spelling of the 5-state base union', () => {
				expect(respellsBaseUnion(read(rel))).toBe(false);
			});
		});
	}

	for (const [rel, extras] of Object.entries(SUPERSET_EXTRAS)) {
		describe(`${rel} (superset type consumer)`, () => {
			it('imports the shared base status type from $lib/loading/routeLoad', () => {
				expect(read(rel)).toMatch(/from\s+['"]\$lib\/loading\/routeLoad['"]/);
			});

			it('composes its extra states onto the shared base instead of re-spelling it', () => {
				const src = read(rel);
				expect(respellsBaseUnion(src)).toBe(false);
				for (const extra of extras) expect(src).toContain(extra);
			});
		});
	}
});

describe('routeLoad.ts keeps its epoch in createLatest, not a counter of its own', () => {
	// A text fence: a hand-rolled counter behaves the same, so only the source can show it.
	it('declares no `let generation` and builds on createLatest', () => {
		const src = stripComments(read('lib/loading/routeLoad.ts'));
		expect(src).not.toMatch(/\blet\s+generation\b/);
		expect(src).toMatch(/createLatest\(\)/);
	});
});

// (*MVOX:Tallis*) (*MVOX:Josquin*)
