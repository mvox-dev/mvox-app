// #341 RED — the Links page shipped with NO page shell and nobody noticed
// until Mihkel opened it on a phone — twice; two commits touched the file
// before a human saw it. unclassed-controls.spec.ts closes that gap for form
// controls; this closes it one level up, for the page itself: every route's
// +page.svelte contains the house shell string
//
//   <main class="min-h-screen bg-paper px-6 py-10 text-ink">
//
// or its route is a NAMED exception on the allowlist below, with its reason
// written where you are reading now. The allowlist is the chokepoint and it
// fails CLOSED: a new route with no shell and no entry is a violation until
// someone either gives it the shell or writes its line here.
//
// THE LIMIT, stated where you meet it: this asserts the shell is PRESENT, not
// that it is the root element or wraps everything. That is a decision, not a
// shortcut. Enumerating the thirteen routes at HEAD found two where the root
// is not the first markup in the file: roster declares four {#snippet} blocks
// before its root (the shell sits near line 4489), and the agenda's root is a
// conditional ({#if auth.status === 'authenticated'}). A root-element check
// would false-fail both — and a guard wrong about two of thirteen routes gets
// switched off. Presence is exactly strong enough for the defect that
// happened: Links had the shell NOWHERE, for two commits.
//
// Presence-not-structure has one trap: a naive contains() is satisfied by a
// commented-out shell. Both prior sweeps on #335 were bitten by exactly that
// comment blindness (the retracted InviteSurface "finding"), so the checker
// strips HTML comments — and <script>/<style> blocks, where tag-looking prose
// lives in // comments — BEFORE matching: a commented shell does NOT count.
// Pinned below.
//
// The checker is a pure EXPORTED function in ./page-shell (route files in,
// violations out) and its behaviour is pinned with INLINE STRING fixtures —
// never fixture .svelte files under src/ (this guard walks src/routes, and a
// shell-less fixture route would trip the guard itself forever), never counts
// over the live tree (pin the instrument, not the tree you are about to
// change — Gama's ruling on #335).
//
// Sibling invariant, NOT here: the `dependencies: {}` question is guarded in
// workers/entu-rights-mcp/fences.spec.ts already; no package.json assertion
// lives in this file.
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { HOUSE_SHELL, findShellViolations, type RouteFile } from './page-shell';

// ── the allowlist: six routes, each with its reason where you meet it ────────
// A route earns a line here by being a DIFFERENT page shape on purpose — not
// by missing its shell. If you are adding a route and reaching for this map,
// first ask whether the page should simply carry the house shell.
const ALLOWLIST: ReadonlyMap<string, string> = new Map([
	[
		'/',
		'agenda — wraps itself in DeskSurface, a deliberately different surface; its root is also conditional ({#if auth.status === ...}), with a separate centered <main> for the no-collectives state'
	],
	[
		'/auth/[provider]',
		'centered full-screen family — flex min-h-screen items-center justify-center bg-paper; no horizontal gutter, no py-10 vertical rhythm: centering does the layout instead'
	],
	[
		'/auth/callback',
		'centered full-screen family — same shape as /auth/[provider]: content is centered, not flowed from the top'
	],
	[
		'/auth/login',
		'centered full-screen family — carries px-6 for a phone gutter but NOT py-10: vertical rhythm is replaced by centering, which is what makes it a different shape rather than a shell-less page'
	],
	[
		'/invite/[token]',
		'centered full-screen family — same as /auth/login: px-6 gutter present, py-10 absent by design, content centered'
	],
	['/auth/logout', 'renders nothing — script-only redirect, no markup at all']
]);

// ── the live walk: every src/routes/**/+page.svelte ──────────────────────────
const ROUTES_ROOT = resolve(__dirname, 'routes');

function liveRouteFiles(): (RouteFile & { file: string })[] {
	return readdirSync(ROUTES_ROOT, { recursive: true, withFileTypes: true })
		.filter((d) => d.isFile() && d.name === '+page.svelte')
		.map((d) => {
			const file = join(d.parentPath, d.name);
			const rel = relative(ROUTES_ROOT, dirname(file)).split(sep).join('/');
			return {
				route: rel === '' ? '/' : `/${rel}`,
				source: readFileSync(file, 'utf-8'),
				file: relative(resolve(__dirname, '..'), file)
			};
		});
}

// ── checker pins: inline string fixtures, green forever ──────────────────────
// These pin the INSTRUMENT, not the current state of the tree.

/** A realistic conforming page, as a string — the shell present, once. */
const CONFORMING_SOURCE = [
	'<script lang="ts">',
	"\tlet items = $state<string[]>([]);",
	'</script>',
	'',
	`${HOUSE_SHELL}`,
	'\t<h1 class="font-display text-2xl">Fixture</h1>',
	'</main>'
].join('\n');

/** The same page with the shell line removed — the revert-a-conformer case. */
const SHELL_REMOVED_SOURCE = CONFORMING_SOURCE.replace(
	HOUSE_SHELL,
	'<main class="min-h-screen bg-paper text-ink">'
);

describe('#341 shell checker — behaviour pinned on inline fixtures', () => {
	it('names a conformer whose shell was removed (the revert-a-conformer case, as a fixture)', () => {
		const violations = findShellViolations(
			[{ route: '/library-fixture', source: SHELL_REMOVED_SOURCE }],
			ALLOWLIST
		);
		expect(violations).toHaveLength(1);
		expect(violations[0].route).toBe('/library-fixture');
	});

	it('fails CLOSED on a brand-new route that is neither shelled nor allowlisted — tested directly, not inferred', () => {
		const violations = findShellViolations(
			[{ route: '/totally-new-feature', source: '<div class="p-4">work in progress</div>' }],
			ALLOWLIST
		);
		expect(violations).toHaveLength(1);
		expect(violations[0].route).toBe('/totally-new-feature');
	});

	it('passes an allowlisted route without the shell — the exception mechanism is live', () => {
		const syntheticAllowlist: ReadonlyMap<string, string> = new Map([
			['/fixture-exception', 'synthetic entry — pins that an allowlisted route needs no shell']
		]);
		const violations = findShellViolations(
			[
				{
					route: '/fixture-exception',
					source: '<main class="flex min-h-screen items-center justify-center">centered</main>'
				}
			],
			syntheticAllowlist
		);
		expect(violations).toEqual([]);
	});

	it('passes a shelled route that is NOT on the allowlist — conformers need no registration', () => {
		expect(
			findShellViolations([{ route: '/some-new-page', source: CONFORMING_SOURCE }], ALLOWLIST)
		).toEqual([]);
	});

	it('does NOT count a shell that appears only inside an HTML comment — a commented-out shell is an absent shell (#335 comment blindness)', () => {
		const fixture = [
			'<!--',
			`\tTODO restore the house shell: ${HOUSE_SHELL}`,
			'-->',
			'<div class="p-4">unshelled content</div>'
		].join('\n');
		const violations = findShellViolations([{ route: '/commented-shell', source: fixture }], ALLOWLIST);
		expect(violations).toHaveLength(1);
		expect(violations[0].route).toBe('/commented-shell');
	});

	it('does NOT count the shell string as prose inside a <script> comment — the shell is markup (#335, one comment syntax over)', () => {
		const fixture = [
			'<script lang="ts">',
			`\t// every page root should be ${HOUSE_SHELL} — but this one is not, yet`,
			'\tlet open = $state(false);',
			'</script>',
			'',
			'<div class="p-4">unshelled content</div>'
		].join('\n');
		const violations = findShellViolations([{ route: '/script-prose-shell', source: fixture }], ALLOWLIST);
		expect(violations).toHaveLength(1);
		expect(violations[0].route).toBe('/script-prose-shell');
	});
});

// ── the guard ────────────────────────────────────────────────────────────────

describe('#341 — every route carries the house shell, or is a named exception', () => {
	const routeFiles = liveRouteFiles();

	it('walks a non-trivial set of route pages and finds the shell in the wild (sanity: the walker works)', () => {
		expect(routeFiles.length).toBeGreaterThan(5);
		expect(routeFiles.some(({ source }) => source.includes(HOUSE_SHELL))).toBe(true);
	});

	it('every allowlist entry names a route that actually exists — a stale exception is a hole', () => {
		const routes = new Set(routeFiles.map((r) => r.route));
		const stale = [...ALLOWLIST.keys()].filter((route) => !routes.has(route));
		expect(
			stale,
			`allowlist entries with no matching route (delete the line or fix the path):\n${stale.join('\n')}`
		).toEqual([]);
	});

	it('no route is shell-less without a named reason (fail-closed: new route + no shell = violation)', () => {
		const fileByRoute = new Map(routeFiles.map((r) => [r.route, r.file]));
		const offenders = findShellViolations(routeFiles, ALLOWLIST).map(
			({ route, detail }) => `${fileByRoute.get(route)} (route ${route}) — ${detail}`
		);
		expect(
			offenders,
			`routes carrying neither the house shell ${HOUSE_SHELL} nor an allowlist entry — give the page its shell, or write its exception line WITH its reason in src/page-shell.spec.ts (#341; Links shipped shell-less twice before a human noticed):\n${offenders.join('\n')}`
		).toEqual([]);
	});
});

// (*MVOX:Tallis* — #341 RED)
