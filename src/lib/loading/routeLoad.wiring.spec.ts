// #232 RED — structural wiring: the shared machine must actually REPLACE the
// per-page copies, not sit beside them.
//
// This lint-style spec (house precedent: timeFormat.no-hardcoded-render.spec.ts)
// makes the extraction's "consumes it" clause executable. For each mandatory
// consumer it asserts, from source:
//
//   • the three PRIMARY routes (profile / roster / library +page.svelte):
//       — import from `$lib/loading/routeLoad`;
//       — construct the machine (`createRouteLoadMachine(`);
//       — carry NO local `let generation = 0` counter any more (the machine
//         owns the counter; #260's refreshCompletionGate co-guard and the
//         profile queue factories read it through `machine.generation`);
//       — declare NO local re-spelling of the full 5-state base union.
//   • InviteSurface.svelte (SUPERSET consumer — 4 extra states, and NO
//     generation/loadForSelected sequencing to extract):
//       — imports the shared base type from `$lib/loading/routeLoad` and
//         composes its extras onto it (`RouteLoadStatus | 'no-access' | …`);
//       — the machine itself is deliberately NOT forced onto it: its
//         load-prerequisites flow has no staleness counter today, and
//         grafting one on would be a behavior change, not an extraction.
//
// Combined with each page's untouched behavior suites (which pin every
// transition, the #260 gate-race semantics and the #255 switch-scoped panel
// resets), "machine constructed + no local counter + no local union" can only
// pass when the machine genuinely drives the pages.
//
// DELIBERATE EXCLUSIONS (scanned nowhere below — the issue marks all three as
// optional follow-through, and none meets its "drops in without reshaping"
// bar):
//   • src/routes/event/[id]/+page.svelte — duplicates the FULL pattern with a
//     genuine extra 'not-available' state and its own 5-branch template. It
//     could join later as a superset consumer (structurally like
//     InviteSurface plus sequencing), but that widens this slice's blast
//     radius for no mandatory gain — left and noted.
//   • src/routes/+layout.svelte — its two guards (gateGen, adminGen) are the
//     POSITIVE form (`if (g === X) {...}`), guard-and-proceed rather than
//     guard-and-return; converting them means reshaping, not extracting.
//   • src/routes/+page.svelte — its worksLoadId guard is COMPOSED with
//     requestId (`thisRequest !== requestId || thisWorksLoad !== worksLoadId`);
//     a single-counter helper does not express two independently-scoped
//     counters checked together.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC_ROOT = resolve(__dirname, '../..'); // …/src

const ROUTE_CONSUMERS = [
	'routes/profile/+page.svelte',
	'routes/roster/+page.svelte',
	'routes/library/+page.svelte'
] as const;

const TYPE_CONSUMERS = ['lib/components/admin/InviteSurface.svelte'] as const;

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

	for (const rel of TYPE_CONSUMERS) {
		describe(`${rel} (superset type consumer)`, () => {
			it('imports the shared base status type from $lib/loading/routeLoad', () => {
				expect(read(rel)).toMatch(/from\s+['"]\$lib\/loading\/routeLoad['"]/);
			});

			it('composes its 4 extra states onto the shared base instead of re-spelling it', () => {
				const src = read(rel);
				expect(respellsBaseUnion(src)).toBe(false);
				// The superset states remain — they are real, locally-owned states.
				for (const extra of ["'no-access'", "'creating'", "'done'", "'create-error'"]) {
					expect(src).toContain(extra);
				}
			});
		});
	}
});

// (*MVOX:Tallis*)
