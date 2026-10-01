// #237 — the red-trashcan sweep, source-scanned: hover:text-red-800 lives in
// ONE file, every Table-A route imports it, Table-B chips keep their × and
// muted tone (WHY stated in markup too). (*MVOX:Palestrina*)
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const SRC_ROOT = resolve(__dirname);

function svelteFiles(): string[] {
	return readdirSync(SRC_ROOT, { recursive: true, withFileTypes: true })
		.filter((d) => d.isFile() && d.name.endsWith('.svelte'))
		.map((d) => join(d.parentPath, d.name));
}

/** Source with comments stripped, so a WHY-comment mentioning the red pair
 *  cannot count as a definition. */
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
		'lib/agenda/SeasonManagePanel.svelte',
		'lib/agenda/SeasonManageSeries.svelte',
		'lib/events/EventScheduleSection.svelte',
		'lib/events/EventDangerZone.svelte',
		'lib/sections/SectionArrangeRow.svelte'
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

/** The chip button's source, testid literal to closing tag — a sweep that
 *  converts it drops the `</button>` and every fence below fails. */
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
		[
			'lib/agenda/SeasonManageConductors.svelte',
			'data-testid="season-manage-conductor-remove-{personId}"'
		],
		[
			'lib/components/agenda/SeasonCreateForm.svelte',
			'data-testid="season-create-conductor-remove-{conductor.id}"'
		],
		[
			'lib/components/agenda/EventCreateForm.svelte',
			'data-testid="event-create-conductor-remove-{conductor.id}"'
		]
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

	// The rationale must live in the markup, not only here (read raw, since the
	// point is that the HTML comment survives in the source).
	it('the season-manage chip carries the WHY in markup, above the button a future sweeper would convert', () => {
		const source = readFileSync(
			join(SRC_ROOT, 'lib/agenda/SeasonManageConductors.svelte'),
			'utf-8'
		);
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
		'season_manage_series_delete',
		'season_manage_event_delete',
		'event_detail_delete_label',
		'roster_section_remove',
		'season_conductor_remove'
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
