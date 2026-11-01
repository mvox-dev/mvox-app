// Every route's +page.svelte carries the house shell, or its route is a named exception below.
// Presence only, not root position: the agenda's root is conditional, roster's follows snippets.
// It strips comments, <script> and <style> first. Why: docs/architecture/guards.md.

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { HOUSE_SHELL, findShellViolations, type RouteFile } from './page-shell';

// ── the allowlist: a route is listed for a different page shape, never a missing shell ──
const ALLOWLIST: ReadonlyMap<string, string> = new Map([
	[
		'/agenda',
		'agenda — its root is conditional ({#if auth.status === …}), with a separate centered <main> for the no-collectives state'
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
	['/auth/logout', 'renders nothing — script-only redirect, no markup at all'],
	[
		'/part/[fileId]',
		'#427 fullscreen part viewer — the /auth/* full-screen family precedent taken one shape further: 100dvh edge-to-edge reading surface on a dark paper-black surround (a music stand, not a page), NO nav shell, no px-6 gutter and no py-10 rhythm — the tap zones need the whole viewport'
	]
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
