// @vitest-environment happy-dom
/**
 * #340 RED — roadmap warns when groomed work sits still and nobody is researching.
 *
 * The predicate, evaluated over OPEN issues in the flattened tree (top level
 * AND nested subIssues — fetchBoard reparents open sub-issues under epics, and
 * a nested groomed-and-idle task is exactly the #338 shape this exists to
 * catch):
 *
 *   IF no open issue carries `in research` AND no open issue carries
 *   `blocks research`, THEN every open issue carrying BOTH `task` AND `ready`
 *   must also carry `in process` OR `prepped` OR `blocked`.
 *
 * Violators render as ONE visible warning line naming each issue number.
 * Epics never fire — scope is the `task` label (present by convention on every
 * task); an epic's ready+blocked is the live counterexample (#316). Advisory
 * ONLY: a failing predicate must never fail the build, because main()'s
 * top-level catch sets exitCode=1 which FREEZES the deployed page — the exact
 * inversion the issue forbids. Hence the never-fail test: malformed labels
 * mirror parseFrontmatter's local-catch precedent (treated as absent, never a
 * crash).
 *
 * Text and class pinned here are the contract with render.ts: Estonian
 * hardcoded literals in the page's own chrome idiom (like 'Pooleli'/'Tehtud')
 * — NO Paraglide; this file's target is a standalone node CLI build step
 * outside the SvelteKit app (see render.ts's own doc comment).
 *
 * Label strings/colours below are the REAL ones (gh api
 * repos/mvox-dev/mvox-app/labels, 2026-09-12). Same caveat as
 * active-float.spec.ts: a fixture cannot see a GitHub-side rename.
 *
 * (*MVOX:Tallis*)
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { renderBoard, type RoadmapIssue, type RoadmapLabel } from './render';

const GENERATED_AT = '2026-09-12T09:00:00.000Z';

/** The warning element's own class — NOT `.meta` (generated-at.spec.ts pins that). */
const WARNING_CLASS = 'staleness-warning';
/** The Estonian warning sentence, page-chrome idiom. Issue numbers follow it. */
const WARNING_TEXT = 'Valmis tööd seisavad ja keegi ei uuri';

/** Live palette (gh api repos/mvox-dev/mvox-app/labels, 2026-09-12). */
const TASK: RoadmapLabel = { name: 'task', color: '1d76db' };
const READY: RoadmapLabel = { name: 'ready', color: '0e8a16' };
const IN_PROCESS: RoadmapLabel = { name: 'in process', color: '95ea29' };
const IN_RESEARCH: RoadmapLabel = { name: 'in research', color: 'ecde62' };
const PREPPED: RoadmapLabel = { name: 'prepped', color: 'c5def5' };
const BLOCKED: RoadmapLabel = { name: 'blocked', color: 'b60205' };
const BLOCKS_RESEARCH: RoadmapLabel = { name: 'blocks research', color: 'd93f0b' };
const EPIC: RoadmapLabel = { name: 'epic', color: '6f42c1' };

function issue(
	overrides: Partial<RoadmapIssue> & Pick<RoadmapIssue, 'number' | 'title'>
): RoadmapIssue {
	return {
		state: 'open',
		stateReason: null,
		labels: [],
		body: null,
		closedAt: null,
		htmlUrl: `https://example.test/issues/${overrides.number}`,
		subIssues: [],
		...overrides
	};
}

function parse(html: string): Document {
	return new DOMParser().parseFromString(html, 'text/html');
}

function warningEl(doc: Document): Element | null {
	return doc.querySelector(`.${WARNING_CLASS}`);
}

/** A closed issue so the board always has a Tehtud group for the fence tests. */
const CLOSED_DONE = issue({
	number: 200,
	title: 'Done long ago',
	state: 'closed',
	stateReason: 'completed',
	closedAt: '2026-09-01T00:00:00Z',
	labels: [TASK]
});

describe('#340 — quiet-board violation renders the warning', () => {
	it('one open task ready-only, nothing in research anywhere → warning names it', () => {
		// #12 is `in process` WITHOUT `blocks research` — per Mihkel's ruling a
		// build running is NOT an excuse for a groomed item to sit unresearched,
		// so it must not suppress; and it is itself no violator (not `ready`).
		const board = [
			issue({ number: 301, title: 'Groomed and idle', labels: [TASK, READY] }),
			issue({ number: 12, title: 'Build running', labels: [TASK, IN_PROCESS] }),
			CLOSED_DONE
		];
		const doc = parse(renderBoard(board, GENERATED_AT));
		const el = warningEl(doc);
		expect(el, `no .${WARNING_CLASS} element on the page`).not.toBeNull();
		expect(el?.textContent).toContain(WARNING_TEXT);
		expect(el?.textContent).toContain('#301');
		expect(el?.textContent).not.toContain('#12');
	});

	it('a stale `in research` label on a CLOSED issue does not suppress — the predicate is over open issues', () => {
		const board = [
			issue({ number: 301, title: 'Groomed and idle', labels: [TASK, READY] }),
			issue({
				number: 198,
				title: 'Done, research label never cleared',
				state: 'closed',
				stateReason: 'completed',
				closedAt: '2026-09-05T00:00:00Z',
				labels: [TASK, IN_RESEARCH]
			})
		];
		const doc = parse(renderBoard(board, GENERATED_AT));
		expect(warningEl(doc), 'closed in-research must not switch the check off').not.toBeNull();
		expect(warningEl(doc)?.textContent).toContain('#301');
	});
});

describe('#340 — suppressions and exemptions', () => {
	it('any open issue carrying `in research` suppresses the warning entirely', () => {
		const board = [
			issue({ number: 301, title: 'Groomed and idle', labels: [TASK, READY] }),
			issue({ number: 12, title: 'Build running', labels: [TASK, IN_PROCESS] }),
			issue({ number: 44, title: 'Being researched', labels: [TASK, IN_RESEARCH] }),
			CLOSED_DONE
		];
		const doc = parse(renderBoard(board, GENERATED_AT));
		expect(warningEl(doc)).toBeNull();
	});

	it('an in-process issue carrying `blocks research` suppresses the warning entirely', () => {
		const board = [
			issue({ number: 301, title: 'Groomed and idle', labels: [TASK, READY] }),
			issue({
				number: 12,
				title: 'Build that genuinely blocks research',
				labels: [TASK, IN_PROCESS, BLOCKS_RESEARCH]
			}),
			CLOSED_DONE
		];
		const doc = parse(renderBoard(board, GENERATED_AT));
		expect(warningEl(doc)).toBeNull();
	});

	it('`ready` + `blocked` is exempt — the only candidate being blocked means no warning', () => {
		// Mihkel's honest-labeling ruling: `blocked` is the held-type label, and
		// keeping `ready` alongside it preserves the groomed state (#319/#316/#233 live).
		const board = [
			issue({ number: 319, title: 'Groomed but held', labels: [TASK, READY, BLOCKED] }),
			CLOSED_DONE
		];
		const doc = parse(renderBoard(board, GENERATED_AT));
		expect(warningEl(doc)).toBeNull();
	});

	it('`prepped` satisfies the predicate — a ready+prepped task is no violator', () => {
		const board = [
			issue({ number: 320, title: 'Groomed and prepped', labels: [TASK, READY, PREPPED] }),
			CLOSED_DONE
		];
		const doc = parse(renderBoard(board, GENERATED_AT));
		expect(warningEl(doc)).toBeNull();
	});

	it('an open epic labelled ready never fires — scope is the `task` label (#316 shape)', () => {
		const board = [
			issue({ number: 316, title: '[EPIC] Groomed container', labels: [EPIC, READY] }),
			issue({ number: 12, title: 'Build running', labels: [TASK, IN_PROCESS] }),
			CLOSED_DONE
		];
		const doc = parse(renderBoard(board, GENERATED_AT));
		expect(warningEl(doc)).toBeNull();
	});
});

describe('#340 — the predicate walks the flattened tree', () => {
	it('an open ready-only task nested in an epic subIssues array is named — the #338 shape', () => {
		// fetchBoard reparents open sub-issues under epics, so a nested
		// groomed-and-idle task never appears at top level. The check must still
		// see it.
		const board = [
			issue({
				number: 289,
				title: '[EPIC] Container',
				labels: [EPIC],
				subIssues: [issue({ number: 338, title: 'Nested, groomed, idle', labels: [TASK, READY] })]
			}),
			CLOSED_DONE
		];
		const doc = parse(renderBoard(board, GENERATED_AT));
		const el = warningEl(doc);
		expect(el, 'a nested violator must still trigger the warning').not.toBeNull();
		expect(el?.textContent).toContain('#338');
	});

	it('one child object shared by two epics is named ONCE — fetchBoard shares one object per number', () => {
		// fetch-issues.ts nests the object from the top-level list, so the SAME
		// object is reachable under every parent that reports the child. The
		// renderer already dedupes on issue number (renderIssue's `rendered`
		// set); the flattened walk the predicate runs over must too, or the
		// warning line says "#338, #338" with two identical links.
		const shared = issue({ number: 338, title: 'Nested, groomed, idle', labels: [TASK, READY] });
		const board = [
			issue({ number: 289, title: '[EPIC] Container one', labels: [EPIC], subIssues: [shared] }),
			issue({ number: 290, title: '[EPIC] Container two', labels: [EPIC], subIssues: [shared] }),
			CLOSED_DONE
		];
		const doc = parse(renderBoard(board, GENERATED_AT));
		const el = warningEl(doc);
		expect(el, 'a nested violator must still trigger the warning').not.toBeNull();
		const mentions = el?.textContent?.match(/#338/g) ?? [];
		expect(mentions, `warning named #338 ${mentions.length} time(s)`).toHaveLength(1);
		expect(el?.querySelectorAll('a')).toHaveLength(1);
	});

	it('a parent cycle still yields the warning — the walk terminates instead of overflowing', () => {
		// 289 → 290 → 289, the exact shape fetch-issues.ts defends against. An
		// unguarded recursion overflows the stack here, and stalenessViolators'
		// own catch swallows the RangeError — the check would go silent on
		// precisely the malformed board where a real violator (#338) is present.
		const epicA = issue({ number: 289, title: '[EPIC] Container one', labels: [EPIC] });
		const epicB = issue({ number: 290, title: '[EPIC] Container two', labels: [EPIC] });
		const child = issue({ number: 338, title: 'Nested, groomed, idle', labels: [TASK, READY] });
		epicA.subIssues = [epicB];
		epicB.subIssues = [epicA, child];
		const doc = parse(renderBoard([epicA], GENERATED_AT));
		const el = warningEl(doc);
		expect(el, 'a cyclic board must still report its violator').not.toBeNull();
		expect(el?.textContent).toContain('#338');
		expect(el?.textContent?.match(/#338/g) ?? []).toHaveLength(1);
	});
});

describe('#340 — multiple violators, one line', () => {
	it('both numbers named on ONE warning line — page idiom, not a console dump', () => {
		const board = [
			issue({ number: 21, title: 'Idle one', labels: [TASK, READY] }),
			issue({ number: 34, title: 'Idle two', labels: [TASK, READY] }),
			CLOSED_DONE
		];
		const doc = parse(renderBoard(board, GENERATED_AT));
		const els = doc.querySelectorAll(`.${WARNING_CLASS}`);
		expect(els).toHaveLength(1);
		expect(els[0].textContent).toContain('#21');
		expect(els[0].textContent).toContain('#34');
	});
});

describe('#340 — structure fences: the warning lives in its own element, not the page chrome', () => {
	const board = [
		issue({ number: 301, title: 'Groomed and idle', labels: [TASK, READY] }),
		CLOSED_DONE
	];

	it('the warning is not a heading, not an <hr>, and does not wear the .meta class', () => {
		const doc = parse(renderBoard(board, GENERATED_AT));
		const el = warningEl(doc);
		expect(el).not.toBeNull();
		expect((el as Element).tagName).not.toMatch(/^H[1-6]$/i);
		expect((el as Element).tagName.toLowerCase()).not.toBe('hr');
		expect((el as Element).classList.contains('meta')).toBe(false);
	});

	it('active-float pins hold with the warning present: main headings exactly Pooleli/Tehtud, zero <hr>', () => {
		const doc = parse(renderBoard(board, GENERATED_AT));
		const main = doc.querySelector('main');
		expect(main).not.toBeNull();
		const headings = Array.from(
			(main as Element).querySelectorAll('h1, h2, h3, h4, h5, h6')
		).map((h) => h.textContent?.trim());
		expect(headings).toEqual(['Pooleli', 'Tehtud']);
		expect((main as Element).querySelectorAll('hr')).toHaveLength(0);
	});

	it('the warning sits between the header and the board groups', () => {
		// Fenced against the board-group MARKUP (`<section class="board-group"`),
		// not the bare substring `board-group` — that also occurs in the <style>
		// block in <head>, i.e. BEFORE the warning, so a bare-substring fence
		// would only pass while the stylesheet avoided naming the class.
		const html = renderBoard(board, GENERATED_AT);
		const warningIdx = html.indexOf(WARNING_TEXT);
		expect(warningIdx, `warning text "${WARNING_TEXT}" missing from the page`).toBeGreaterThan(-1);
		expect(warningIdx).toBeGreaterThan(html.indexOf('</header>'));
		const groupIdx = html.indexOf('<section class="board-group"');
		expect(groupIdx, 'no <section class="board-group"> on the page').toBeGreaterThan(-1);
		expect(warningIdx).toBeLessThan(groupIdx);
	});
});

describe("#340 — never-fail: the checker's own bugs must not freeze the page", () => {
	it('malformed labels (labels: null, a label missing name) → full page, no throw, warning simply absent', () => {
		// main()'s top-level catch sets exitCode=1, which freezes the deployed
		// page — the exact inversion the issue forbids. Mirror parseFrontmatter's
		// local-catch precedent: malformed input is treated as absent, never a crash.
		const malformed = [
			{
				...issue({ number: 90, title: 'Labels null, smuggled past the type' }),
				labels: null
			} as unknown as RoadmapIssue,
			issue({
				number: 91,
				title: 'Label object missing name',
				labels: [{ color: '00ff00' } as unknown as RoadmapLabel]
			}),
			issue({ number: 92, title: 'Healthy plain issue', labels: [TASK] })
		];
		let html = '';
		expect(() => {
			html = renderBoard(malformed, GENERATED_AT);
		}).not.toThrow();
		expect(html.toLowerCase().trimStart().startsWith('<!doctype html')).toBe(true);
		expect(html).toContain('data-issue="92"');
		const doc = parse(html);
		expect(doc.querySelector('main')).not.toBeNull();
		expect(warningEl(doc)).toBeNull();
	});
});

describe('#340 integration — the warning reaches the file the Action actually deploys', () => {
	// Runs the REAL CLI (the same invocation the GitHub Action makes) over a
	// fixture exhibiting the quiet-board violation, and asserts the warning is
	// on the deployed roadmap/index.html — not just in renderBoard's return
	// value in a unit test.
	// join over dirname, not `new URL(…)` — happy-dom replaces the global URL
	// class and its instances are not file-scheme URLs fileURLToPath accepts.
	const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
	let outDir: string;

	beforeAll(() => {
		outDir = mkdtempSync(join(tmpdir(), 'roadmap-340-'));
		const violationBoard = [
			issue({ number: 338, title: 'Groomed and idle', labels: [TASK, READY] }),
			issue({ number: 12, title: 'Build running', labels: [TASK, IN_PROCESS] }),
			CLOSED_DONE
		];
		const fixturePath = join(outDir, 'violation-board.json');
		writeFileSync(fixturePath, JSON.stringify(violationBoard, null, 2), 'utf-8');
		execFileSync(
			process.execPath,
			['--import', 'tsx', 'scripts/roadmap/render.ts', '--input', fixturePath, '--out', outDir],
			{ cwd: repoRoot, stdio: 'pipe', timeout: 60_000 }
		);
	}, 90_000);

	afterAll(() => {
		if (outDir) rmSync(outDir, { recursive: true, force: true });
	});

	it('the deployed page carries the warning line naming the idle issue', () => {
		// '#338' alone would match the issue card's own number span, so the
		// number is asserted INSIDE the warning element, not anywhere on the page.
		const html = readFileSync(join(outDir, 'roadmap', 'index.html'), 'utf-8');
		expect(html).toContain(WARNING_TEXT);
		const el = warningEl(parse(html));
		expect(el, `no .${WARNING_CLASS} element on the deployed page`).not.toBeNull();
		expect(el?.textContent).toContain('#338');
		expect(el?.textContent).not.toContain('#12');
	});
});
