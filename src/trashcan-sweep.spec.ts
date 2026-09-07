// #237 — the red-trashcan sweep, made enforceable at the source level.
//
// Scanning real sources (rather than rendering) follows the
// typography-scale.spec / ios-form-zoom.spec precedent: a call site nothing
// mounts cannot hide a violation, and the check costs nothing at runtime.
//
// What lives here (the halves of #237 that are repo-wide invariants, not
// per-route behavior — those are pinned in the route suites):
//
//   1. ONE DEFINITION (the issue's load-bearing half): the idle destructive
//      treatment `hover:text-red-800` lives in EXACTLY one .svelte file —
//      src/lib/components/DeleteTrigger.svelte. One colour change = one edit.
//      This is also what FORCES the two pre-#237 TrashIcon sites
//      (season-manage-delete-season from #236/#261, event-schedule-remove
//      from #262) onto the shared unit: stated choice = MIGRATE, because
//      leaving them would leave three definitions and the issue's "defined
//      once" would be a fiction. Their rendered surfaces are pinned unchanged
//      by their own suites (page.season-card.spec.ts, page.schedule.spec.ts),
//      which must stay green through the migration.
//   2. Every Table-A route file actually IMPORTS the shared unit (integration
//      floor: the component cannot be "done" in isolation).
//   3. Table B NEGATIVE fences (PO ruling in the #237 body, reaffirmed in the
//      release comment): the three conductor-remove chips KEEP their × and
//      their muted tone. They use the same × glyph as the old Table-A sites,
//      so any sweep-by-glyph over-matches — these fences catch it. The WHY
//      is also required to be stated IN THE MARKUP at one of the three (the
//      season-manage chip) — a future sweeper reads the .svelte first and
//      this spec file last, so a rationale that lives only here is a
//      rationale they never see (#237 review F1).
//   4. The #238 lesson as a fence: no colour-emoji glyph (🗑 ⚙) in any
//      .svelte markup — emoji ignore CSS `color`.
//   5. Locale fence: the sweep is purely visual — the four Table-A accessible
//      names and the Table-B name are EXISTING glyph-independent keys,
//      present in all four locales; no key edits ride along.
//   6. Stale-pointer fence: pre-#261 a comment said the gear was "left for
//      #237 to pick up"; #261 removed the gear and the pointer. Nothing may
//      reintroduce a #237-waits-for-the-gear breadcrumb.
//
// (*MVOX:Palestrina* — #237 RED)
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const SRC_ROOT = resolve(__dirname);

function svelteFiles(): string[] {
	return readdirSync(SRC_ROOT, { recursive: true, withFileTypes: true })
		.filter((d) => d.isFile() && d.name.endsWith('.svelte'))
		.map((d) => join(d.parentPath, d.name));
}

/** Source with HTML comments and //-style script comment lines removed, so a
 *  needle in a WHY-comment (TrashIcon.svelte narrates the red pair) cannot
 *  count as a definition. */
function markupOf(path: string): string {
	return readFileSync(path, 'utf-8')
		.replace(/<!--[\s\S]*?-->/g, '')
		.split('\n')
		.filter((line) => {
			const t = line.trim();
			return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
		})
		.join('\n');
}

function rel(path: string): string {
	return relative(SRC_ROOT, path).replace(/\\/g, '/');
}

const SHARED_UNIT = 'lib/components/DeleteTrigger.svelte';

// ── 1. one definition ───────────────────────────────────────────────────────────

describe('#237 — the destructive trigger treatment is defined ONCE', () => {
	it(`\`hover:text-red-800\` lives in exactly one .svelte file: ${SHARED_UNIT}`, () => {
		const holders = svelteFiles()
			.filter((f) => /hover:text-red-800/.test(markupOf(f)))
			.map(rel)
			.sort();
		expect(
			holders,
			'the idle destructive-red pair must live in the shared unit and NOWHERE else — one colour change, one edit'
		).toEqual([SHARED_UNIT]);
	});
});

// ── 2. the shared unit is WIRED into every Table-A route ───────────────────────

describe('#237 — every Table-A route imports the shared unit (integration floor)', () => {
	const routes = [
		'routes/+page.svelte', // season-manage series + event rows (+ the migrated season delete)
		'routes/event/[id]/+page.svelte', // event-detail delete (+ the migrated #262 schedule remove)
		'routes/roster/+page.svelte' // section remove
	];
	for (const route of routes) {
		it(`${route} imports $lib/components/DeleteTrigger.svelte`, () => {
			const source = readFileSync(join(SRC_ROOT, route), 'utf-8');
			expect(source).toMatch(
				/import\s+DeleteTrigger\s+from\s+'\$lib\/components\/DeleteTrigger\.svelte'/
			);
		});
	}
});

// ── 3. Table B fences — unlink is NOT destroy ──────────────────────────────────

/** The chip button's source block: from its testid literal to its closing tag.
 *  If a sweep converts the chip to DeleteTrigger the </button> disappears and
 *  the slice runs long — every fence below then fails, which is the point. */
function buttonBlock(path: string, testidLiteral: string): string {
	const source = readFileSync(join(SRC_ROOT, path), 'utf-8');
	const at = source.indexOf(testidLiteral);
	expect(at, `${testidLiteral} missing from ${path}`).toBeGreaterThan(-1);
	const end = source.indexOf('</button>', at);
	expect(end, `no </button> after ${testidLiteral} in ${path}`).toBeGreaterThan(at);
	return source.slice(at, end);
}

describe('#237 — Table B keeps the × (PO ruling: a red trashcan on an unlink empties the idiom)', () => {
	const chips: Array<[string, string]> = [
		['routes/+page.svelte', 'data-testid="season-manage-conductor-remove-{personId}"'],
		['routes/+page.svelte', 'data-testid="season-create-conductor-remove-{conductor.id}"'],
		['routes/+page.svelte', 'data-testid="event-create-conductor-remove-{conductor.id}"']
	];
	for (const [path, testid] of chips) {
		it(`${testid} keeps × and the muted tone — no trashcan, no red`, () => {
			const block = buttonBlock(path, testid);
			expect(block, 'the × glyph must stay').toContain('&times;');
			expect(block, 'the muted tone must stay').toContain('text-ink-2');
			expect(block).not.toContain('TrashIcon');
			expect(block).not.toContain('DeleteTrigger');
			expect(block).not.toContain('text-red-700');
			expect(block).not.toContain('hover:text-red-800');
		});
	}

	// #237 review F1 — the issue's "Done when" asks for the RATIONALE at a
	// Table-B site, in the markup a future sweeper edits FIRST. Recording it
	// only in this spec file puts it where that sweeper looks LAST, which is
	// the failure mode the bullet exists to prevent. Read raw (not markupOf):
	// the whole point is that the HTML comment survives in the source.
	it('the season-manage chip carries the WHY in markup, above the button a future sweeper would convert', () => {
		const source = readFileSync(join(SRC_ROOT, 'routes/+page.svelte'), 'utf-8');
		const at = source.indexOf('data-testid="season-manage-conductor-remove-{personId}"');
		expect(at, 'the season-manage chip must exist').toBeGreaterThan(-1);
		const preamble = source.slice(Math.max(0, at - 1400), at);
		expect(preamble, 'no #237 pointer above the Table-B chip').toContain('#237');
		expect(
			preamble,
			'the ruling itself (unlink is not destroy) must be stated at the site, not only in the tests'
		).toMatch(/unlink/i);
	});
});

// ── 4. the #238 lesson, fenced ─────────────────────────────────────────────────

describe('#237 — no colour-emoji glyph anywhere in markup', () => {
	it('🗑 (U+1F5D1) and ⚙ (U+2699) appear in NO .svelte markup — emoji ignore CSS color', () => {
		const offenders = svelteFiles()
			.filter((f) => /[\u{1F5D1}\u{2699}]/u.test(markupOf(f)))
			.map(rel);
		expect(offenders).toEqual([]);
	});
});

// ── 5. locales — a purely visual sweep ─────────────────────────────────────────

describe('#237 — zero message-key changes ride along', () => {
	const keys = [
		'season_manage_series_delete', // Table A: series row
		'season_manage_event_delete', // Table A: event row
		'event_detail_delete_label', // Table A: detail page visible label
		'roster_section_remove', // Table A: roster section
		'season_conductor_remove' // Table B: stays as-is
	];
	for (const locale of ['en', 'et', 'lv', 'uk']) {
		it(`messages/${locale}.json still carries every glyph-independent name key`, () => {
			const messages = JSON.parse(
				readFileSync(resolve(SRC_ROOT, '..', `messages/${locale}.json`), 'utf-8')
			) as Record<string, unknown>;
			for (const key of keys) {
				expect(messages[key], `${key} missing in ${locale}`).toBeTruthy();
			}
		});
	}
});

// ── 6. stale-pointer fence ─────────────────────────────────────────────────────

describe('#237 — no stale gear-for-#237 breadcrumb survives', () => {
	it('routes/+page.svelte carries no "left for #237" / "#237 to pick up" pointer (the gear died in #261)', () => {
		const source = readFileSync(join(SRC_ROOT, 'routes/+page.svelte'), 'utf-8');
		expect(source).not.toMatch(/left for #237|#237 to pick up|for #237 to pick/i);
	});
});
