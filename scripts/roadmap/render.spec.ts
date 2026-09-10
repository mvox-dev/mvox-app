// @vitest-environment happy-dom
/**
 * #305 RED — roadmap board renderer contract.
 *
 * The renderer is the testable core: issues JSON in → complete static HTML
 * out. The GitHub Action around it is reviewed, not unit-tested here.
 *
 * Facts these fixtures reflect (verified live 2026-09-10):
 * - ZERO issues carry YAML frontmatter today; every epic has ZERO native
 *   sub-issues. Day one renders flat English titles — that is CORRECT per
 *   #305, not a degraded mode.
 * - Live label taxonomy: ready / in research / in process / epic / bug / task
 *   (plus labels outside that set, which must never crash the board).
 * - state_reason has real examples of both `completed` and `not_planned`.
 *
 * #307 RED adds: labels carry {name, color} (hex without leading '#', the
 * GitHub wire format) and closedAt (ISO date-time | null); chips render in
 * the label's own colour with luminance-derived text colour; open group
 * sorts by number ascending, closed group by closedAt most-recent-first
 * (null last); an explicit Pooleli/Tehtud divider separates the top-level
 * groups (hardcoded Estonian — this static page is outside Paraglide by
 * design). Fixture colours are the LIVE palette (gh api, 2026-09-10).
 *
 * (*MVOX:Tallis*)
 */
import { describe, expect, it } from 'vitest';
import liveShapedJson from './fixtures/live-shaped.json';
import {
	buildStamp,
	displayTitle,
	formatGeneratedAt,
	parseFrontmatter,
	renderBoard,
	type RoadmapIssue,
	type RoadmapLabel
} from './render';

const GENERATED_AT = '2026-09-10T12:34:56Z';

const liveShaped: RoadmapIssue[] = liveShapedJson as RoadmapIssue[];

/** A {name, color} label; colour is the GitHub hex WITHOUT the leading '#', or null. */
function label(name: string, color: string | null = null): RoadmapLabel {
	return { name, color };
}

function issue(overrides: Partial<RoadmapIssue> & Pick<RoadmapIssue, 'number' | 'title'>): RoadmapIssue {
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

/** All inline script text of the page, joined — the self-refresh machinery lives there. */
function scriptText(doc: Document): string {
	return Array.from(doc.querySelectorAll('script'))
		.map((s) => s.textContent ?? '')
		.join('\n');
}

/** The rendered element for one issue. Contract: every issue renders as an element carrying data-issue="<number>". */
function entry(doc: Document, number: number): Element {
	const el = doc.querySelector(`[data-issue="${number}"]`);
	expect(el, `no [data-issue="${number}"] element rendered`).not.toBeNull();
	return el as Element;
}

describe('parseFrontmatter', () => {
	it('returns null for a body with no frontmatter block (all 302 live issues today)', () => {
		expect(parseFrontmatter('## The design\n\nPlain markdown body.')).toBeNull();
	});

	it('returns null for a null body', () => {
		expect(parseFrontmatter(null)).toBeNull();
	});

	it('parses a leading --- YAML block into a mapping', () => {
		const fm = parseFrontmatter('---\nslugline: Laenutuse seis noodi lehel\n---\n\n## Body\n');
		expect(fm).not.toBeNull();
		expect(fm?.slugline).toBe('Laenutuse seis noodi lehel');
	});

	it('ignores unknown keys rather than rejecting the block', () => {
		const fm = parseFrontmatter(
			'---\nslugline: Eestikeelne pealkiri\nsome_future_key: whatever\nanother: 42\n---\nBody.'
		);
		expect(fm).not.toBeNull();
		expect(fm?.slugline).toBe('Eestikeelne pealkiri');
	});

	it('treats malformed YAML as absent — returns null, never throws', () => {
		expect(() => parseFrontmatter('---\nslugline: [unclosed\n---\nBody.')).not.toThrow();
		expect(parseFrontmatter('---\nslugline: [unclosed\n---\nBody.')).toBeNull();
	});

	it('treats an unterminated block (no closing ---) as absent', () => {
		expect(parseFrontmatter('---\nslugline: pooleli\n\nno closing fence anywhere')).toBeNull();
	});

	it('does not mistake a --- later in the body (horizontal rule) for frontmatter', () => {
		expect(parseFrontmatter('Intro paragraph.\n\n---\n\nMore body.')).toBeNull();
	});

	it('treats a non-mapping YAML document (list, scalar) as absent', () => {
		expect(parseFrontmatter('---\n- just\n- a list\n---\nBody.')).toBeNull();
		expect(parseFrontmatter('---\njust a scalar\n---\nBody.')).toBeNull();
	});
});

describe('displayTitle', () => {
	it('falls back to the English title when there is no frontmatter — the day-one default', () => {
		expect(displayTitle(issue({ number: 301, title: 'Score detail page shows lending state' }))).toBe(
			'Score detail page shows lending state'
		);
	});

	it('uses the frontmatter slugline in place of the English title', () => {
		expect(
			displayTitle(
				issue({
					number: 301,
					title: 'Score detail page shows lending state',
					body: '---\nslugline: Laenutuse seis noodi lehel\n---\nBody.'
				})
			)
		).toBe('Laenutuse seis noodi lehel');
	});

	it('falls back to the English title when frontmatter is malformed', () => {
		expect(
			displayTitle(
				issue({ number: 5, title: 'English title', body: '---\nslugline: [broken\n---\nBody.' })
			)
		).toBe('English title');
	});

	it('falls back to the English title when frontmatter has only unknown keys', () => {
		expect(
			displayTitle(issue({ number: 6, title: 'English title', body: '---\nfoo: bar\n---\nBody.' }))
		).toBe('English title');
	});

	it('falls back when slugline is empty or not a string', () => {
		expect(
			displayTitle(issue({ number: 7, title: 'English title', body: '---\nslugline: ""\n---\n' }))
		).toBe('English title');
		expect(
			displayTitle(issue({ number: 8, title: 'English title', body: '---\nslugline: 42\n---\n' }))
		).toBe('English title');
	});
});

describe('renderBoard — day one: the live-shaped board (no frontmatter, no sub-issues)', () => {
	it('is a complete static HTML document', () => {
		const html = renderBoard(liveShaped, GENERATED_AT);
		expect(html.toLowerCase().trimStart().startsWith('<!doctype html')).toBe(true);
		expect(html).toContain('</html>');
		const doc = parse(html);
		expect(doc.querySelector('title')?.textContent).toBeTruthy();
		expect(doc.querySelector('meta[charset]')).not.toBeNull();
	});

	it('renders every issue with its number and English title — undecorated issues are useful, not degraded', () => {
		const doc = parse(renderBoard(liveShaped, GENERATED_AT));
		for (const i of liveShaped) {
			const el = entry(doc, i.number);
			expect(el.textContent).toContain(i.title);
			expect(el.textContent).toContain(String(i.number));
		}
	});

	it('is deterministic: the clock is injected, never read inside', () => {
		expect(renderBoard(liveShaped, GENERATED_AT)).toBe(renderBoard(liveShaped, GENERATED_AT));
	});

	it('renders open issues before closed ones (current work first)', () => {
		const html = renderBoard(liveShaped, GENERATED_AT);
		const pos = (n: number) => {
			const i = html.indexOf(`data-issue="${n}"`);
			expect(i, `data-issue="${n}" missing`).toBeGreaterThan(-1);
			return i;
		};
		const open = liveShaped.filter((i) => i.state === 'open').map((i) => pos(i.number));
		const closed = liveShaped.filter((i) => i.state === 'closed').map((i) => pos(i.number));
		expect(Math.max(...open)).toBeLessThan(Math.min(...closed));
	});

	it('renders an issue with no labels at all without crashing', () => {
		const doc = parse(renderBoard([issue({ number: 9, title: 'Unlabeled stray' })], GENERATED_AT));
		expect(entry(doc, 9).textContent).toContain('Unlabeled stray');
	});
});

describe('renderBoard — state and stateReason are distinguishable', () => {
	it('marks open vs closed distinguishably', () => {
		const doc = parse(renderBoard(liveShaped, GENERATED_AT));
		expect(entry(doc, 305).getAttribute('data-state')).toBe('open');
		expect(entry(doc, 304).getAttribute('data-state')).toBe('closed');
	});

	it('marks completed vs not_planned distinguishably', () => {
		const doc = parse(renderBoard(liveShaped, GENERATED_AT));
		expect(entry(doc, 304).getAttribute('data-state-reason')).toBe('completed');
		expect(entry(doc, 291).getAttribute('data-state-reason')).toBe('not_planned');
	});
});

describe('renderBoard — labels', () => {
	it('surfaces the live taxonomy labels on their issues', () => {
		const doc = parse(renderBoard(liveShaped, GENERATED_AT));
		expect(entry(doc, 305).textContent).toContain('ready');
		expect(entry(doc, 305).textContent).toContain('in process');
		expect(entry(doc, 298).textContent).toContain('in research');
		expect(entry(doc, 289).textContent).toContain('epic');
		expect(entry(doc, 262).textContent).toContain('bug');
		expect(entry(doc, 304).textContent).toContain('task');
	});

	it('does not crash on labels outside the taxonomy', () => {
		const html = renderBoard(
			[
				issue({
					number: 210,
					title: 'Legacy import spike',
					labels: [label('task', '1d76db'), label('wontfix', 'ffffff'), label('völlig-unbekannt')]
				})
			],
			GENERATED_AT
		);
		expect(parse(html).querySelector('[data-issue="210"]')).not.toBeNull();
	});
});

/**
 * The `.label` chip element for one label name under one issue's entry.
 * Contract: every label renders as an element with class "label" whose text
 * content is the label name.
 */
function chip(doc: Document, issueNumber: number, name: string): Element {
	const found = Array.from(entry(doc, issueNumber).querySelectorAll('.label')).find(
		(c) => c.textContent?.trim() === name
	);
	expect(found, `no .label chip "${name}" under #${issueNumber}`).toBeDefined();
	return found as Element;
}

function styleOf(el: Element): string {
	return el.getAttribute('style') ?? '';
}

// Text-colour value patterns: labelTextColor returns '#ffffff' / '#000000',
// but accept the 3-digit shorthand too. `(?<![\w-])` keeps `background-color:`
// from matching as `color:`.
const LIGHT_TEXT = /(?<![\w-])color:\s*#(?:ffffff|fff)(?![0-9a-fA-F])/i;
const DARK_TEXT = /(?<![\w-])color:\s*#(?:000000|000)(?![0-9a-fA-F])/i;

describe('renderBoard — label chips carry their own colours (#307)', () => {
	it('worst case blocked #b60205: chip background is the label colour, text derived light', () => {
		const doc = parse(
			renderBoard([issue({ number: 20, title: 'Blocked one', labels: [label('blocked', 'b60205')] })], GENERATED_AT)
		);
		const s = styleOf(chip(doc, 20, 'blocked'));
		expect(s).toMatch(/background(?:-color)?:\s*#b60205/i);
		expect(s).toMatch(LIGHT_TEXT);
	});

	it('worst case wontfix #ffffff: white background, text derived dark', () => {
		const doc = parse(
			renderBoard([issue({ number: 21, title: 'Wont fix', labels: [label('wontfix', 'ffffff')] })], GENERATED_AT)
		);
		const s = styleOf(chip(doc, 21, 'wontfix'));
		expect(s).toMatch(/background(?:-color)?:\s*#ffffff/i);
		expect(s).toMatch(DARK_TEXT);
	});

	it('chips carry a hairline border, so the #ffffff chip reads as a chip on the white page', () => {
		const html = renderBoard(
			[issue({ number: 21, title: 'Wont fix', labels: [label('wontfix', 'ffffff')] })],
			GENERATED_AT
		);
		const classBorder = /\.label\s*\{[^}]*border/.test(html);
		const inlineBorder = /border/i.test(styleOf(chip(parse(html), 21, 'wontfix')));
		expect(
			classBorder || inlineBorder,
			'no border on chips — a near-white chip is invisible against the page'
		).toBe(true);
	});

	it('a label with no colour falls back to the neutral grey chip, not a throw', () => {
		const html = renderBoard(
			[issue({ number: 22, title: 'Stray', labels: [label('völlig-unbekannt')] })],
			GENERATED_AT
		);
		const c = chip(parse(html), 22, 'völlig-unbekannt');
		const s = styleOf(c);
		const inlineNeutral = /background(?:-color)?:\s*#eee/i.test(s);
		const classNeutral = !/background/i.test(s) && /\.label\s*\{[^}]*background:\s*#eee/.test(html);
		expect(
			inlineNeutral || classNeutral,
			'colourless label must land on the neutral #eee chip (inline or via the .label class default)'
		).toBe(true);
	});

	it('fixture chips render in the live palette colours', () => {
		const doc = parse(renderBoard(liveShaped, GENERATED_AT));
		expect(styleOf(chip(doc, 305, 'ready'))).toMatch(/background(?:-color)?:\s*#0e8a16/i);
		expect(styleOf(chip(doc, 289, 'epic'))).toMatch(/background(?:-color)?:\s*#6f42c1/i);
	});
});

describe('renderBoard — ordering inside the groups (#307)', () => {
	const pos = (html: string, needle: string): number => {
		const i = html.indexOf(needle);
		expect(i, `${needle} missing from the page`).toBeGreaterThan(-1);
		return i;
	};
	const issuePos = (html: string, n: number): number => pos(html, `data-issue="${n}"`);

	it('orders the open group by activity tier, then issue number ascending (#310 amends #307)', () => {
		// Fixture: #305 carries `in process`, #298 `in research`; 262/289/301
		// have neither. #310 makes the tier the primary key — so 305, 298,
		// then the rest by number: 262, 289, 301. (#307's number-ascending
		// rule survives per tier.)
		const html = renderBoard(liveShaped, GENERATED_AT);
		const positions = [305, 298, 262, 289, 301].map((n) => issuePos(html, n));
		expect([...positions].sort((a, b) => a - b)).toEqual(positions);
	});

	it('orders the closed group by closedAt, most recently finished first', () => {
		// Fixture file order is 210 (no closedAt), 291 (Aug 15), 304 (Sep 8) —
		// must render 304, 291, then 210 last (missing date sorts last).
		const html = renderBoard(liveShaped, GENERATED_AT);
		expect(issuePos(html, 304)).toBeLessThan(issuePos(html, 291));
		expect(issuePos(html, 291)).toBeLessThan(issuePos(html, 210));
	});

	it('a closed issue with no closedAt sorts last — not at the top, not a crash', () => {
		const board = [
			issue({ number: 41, title: 'Done, undated', state: 'closed', stateReason: 'completed' }),
			issue({
				number: 42,
				title: 'Done recently',
				state: 'closed',
				stateReason: 'completed',
				closedAt: '2026-09-09T08:00:00Z'
			}),
			issue({
				number: 43,
				title: 'Done long ago',
				state: 'closed',
				stateReason: 'completed',
				closedAt: '2026-07-01T08:00:00Z'
			})
		];
		const html = renderBoard(board, GENERATED_AT);
		expect(issuePos(html, 42)).toBeLessThan(issuePos(html, 43));
		expect(issuePos(html, 43)).toBeLessThan(issuePos(html, 41));
	});
});

describe('renderBoard — the line: Pooleli / Tehtud divider (#307)', () => {
	// Hardcoded Estonian literals by design: this static page is outside
	// Paraglide (a node CLI, not the SvelteKit app) — not an i18n violation.
	const pos = (html: string, needle: string): number => {
		const i = html.indexOf(needle);
		expect(i, `${needle} missing from the page`).toBeGreaterThan(-1);
		return i;
	};

	it('separates the groups: Pooleli heads the open group, Tehtud sits between the groups', () => {
		const html = renderBoard(liveShaped, GENERATED_AT);
		const openPositions = liveShaped
			.filter((i) => i.state === 'open')
			.map((i) => pos(html, `data-issue="${i.number}"`));
		const closedPositions = liveShaped
			.filter((i) => i.state === 'closed')
			.map((i) => pos(html, `data-issue="${i.number}"`));
		const pooleli = pos(html, 'Pooleli');
		const tehtud = pos(html, 'Tehtud');
		expect(pooleli).toBeLessThan(Math.min(...openPositions));
		expect(Math.max(...openPositions)).toBeLessThan(tehtud);
		expect(tehtud).toBeLessThan(Math.min(...closedPositions));
	});

	it('omits the Tehtud heading when nothing is closed', () => {
		const html = renderBoard([issue({ number: 1, title: 'Only open work' })], GENERATED_AT);
		expect(html).toContain('Pooleli');
		expect(html).not.toContain('Tehtud');
	});

	it('omits the Pooleli heading when nothing is open', () => {
		const html = renderBoard(
			[
				issue({
					number: 2,
					title: 'Everything done',
					state: 'closed',
					stateReason: 'completed',
					closedAt: '2026-09-01T00:00:00Z'
				})
			],
			GENERATED_AT
		);
		expect(html).toContain('Tehtud');
		expect(html).not.toContain('Pooleli');
	});

	it('is top-level only: a closed sub-issue inside an epic spawns no headings inside the epic', () => {
		const epic = issue({
			number: 289,
			title: '[EPIC] Library lending 1.0',
			labels: [label('epic', '6f42c1')],
			subIssues: [
				issue({ number: 290, title: 'Open child', labels: [label('task', '1d76db')] }),
				issue({
					number: 292,
					title: 'Closed child',
					state: 'closed',
					stateReason: 'completed',
					closedAt: '2026-09-01T00:00:00Z',
					labels: [label('task', '1d76db')]
				})
			]
		});
		const html = renderBoard([epic], GENERATED_AT);
		// The board's top level has only the open epic — a closed CHILD must not
		// produce a Tehtud heading anywhere, and Pooleli appears exactly once.
		expect(html).not.toContain('Tehtud');
		expect(html.split('Pooleli').length - 1).toBe(1);
	});
});

describe('renderBoard — sub-issues inherit ordering and chips (#307)', () => {
	// Children arrive out of order on purpose: open 297 before open 290,
	// old-closed 292 before newly-closed 294.
	const epic = issue({
		number: 289,
		title: '[EPIC] Library lending 1.0',
		labels: [label('epic', '6f42c1')],
		subIssues: [
			issue({ number: 297, title: 'Child three', labels: [label('task', '1d76db')] }),
			issue({
				number: 292,
				title: 'Child closed long ago',
				state: 'closed',
				stateReason: 'completed',
				closedAt: '2026-08-01T00:00:00Z',
				labels: [label('task', '1d76db')]
			}),
			issue({ number: 290, title: 'Child one', labels: [label('ready', '0e8a16')] }),
			issue({
				number: 294,
				title: 'Child closed recently',
				state: 'closed',
				stateReason: 'completed',
				closedAt: '2026-09-05T00:00:00Z',
				labels: [label('blocked', 'b60205')]
			})
		]
	});

	it('orders children like the top level: open by number ascending, then closed by closedAt descending', () => {
		const html = renderBoard([epic], GENERATED_AT);
		const p = (n: number): number => {
			const i = html.indexOf(`data-issue="${n}"`);
			expect(i, `data-issue="${n}" missing`).toBeGreaterThan(-1);
			return i;
		};
		expect(p(290)).toBeLessThan(p(297));
		expect(p(297)).toBeLessThan(p(294));
		expect(p(294)).toBeLessThan(p(292));
	});

	it('renders coloured chips on children through the same path', () => {
		const doc = parse(renderBoard([epic], GENERATED_AT));
		expect(styleOf(chip(doc, 290, 'ready'))).toMatch(/background(?:-color)?:\s*#0e8a16/i);
		const blocked = styleOf(chip(doc, 294, 'blocked'));
		expect(blocked).toMatch(/background(?:-color)?:\s*#b60205/i);
		expect(blocked).toMatch(LIGHT_TEXT);
	});
});

describe('renderBoard — frontmatter on the page', () => {
	const decorated = issue({
		number: 301,
		title: 'Score detail page shows lending state',
		labels: [label('task', '1d76db'), label('ready', '0e8a16')],
		body: '---\nslugline: Laenutuse seis noodi lehel\ninternal_note: LEAK-MARKER-VALUE\n---\n\nBODY-MARKER-DO-NOT-RENDER paragraph.'
	});

	it('displays the slugline in place of the English title', () => {
		const doc = parse(renderBoard([decorated], GENERATED_AT));
		const text = entry(doc, 301).textContent ?? '';
		expect(text).toContain('Laenutuse seis noodi lehel');
		expect(text).not.toContain('Score detail page shows lending state');
	});

	it('PUBLIC-by-mechanism: unknown frontmatter key VALUES never reach the HTML', () => {
		expect(renderBoard([decorated], GENERATED_AT)).not.toContain('LEAK-MARKER-VALUE');
	});

	it('emits only issue-derived display text — body prose is not rendered', () => {
		const html = renderBoard([decorated], GENERATED_AT);
		expect(html).not.toContain('BODY-MARKER-DO-NOT-RENDER');
	});

	it('never dumps the raw frontmatter fence into the page', () => {
		expect(renderBoard([decorated], GENERATED_AT)).not.toContain('slugline:');
	});

	it('one bad issue must not take down the board: malformed YAML renders that issue with its English title, neighbours untouched', () => {
		const bad = issue({ number: 66, title: 'Issue with broken frontmatter', body: '---\n: : :\n\t???\n---\nBody.' });
		const doc = parse(renderBoard([bad, ...liveShaped], GENERATED_AT));
		expect(entry(doc, 66).textContent).toContain('Issue with broken frontmatter');
		for (const i of liveShaped) entry(doc, i.number);
	});
});

describe('renderBoard — escaping (issue text is attacker-adjacent input on a public page)', () => {
	it('escapes HTML in titles instead of injecting it', () => {
		const html = renderBoard(
			[issue({ number: 13, title: '<script>alert("xss")</script> & <b>bold</b>' })],
			GENERATED_AT
		);
		expect(html).not.toContain('<script>alert');
		expect(html).not.toContain('<b>bold</b>');
		const doc = parse(html);
		expect(entry(doc, 13).textContent).toContain('<script>alert("xss")</script>');
	});

	it('escapes HTML in sluglines too', () => {
		const html = renderBoard(
			[issue({ number: 14, title: 'Safe title', body: '---\nslugline: <img src=x onerror=alert(1)>\n---\n' })],
			GENERATED_AT
		);
		expect(html).not.toContain('<img src=x');
	});
});

describe('renderBoard — sub-issues', () => {
	const epicWithChildren = issue({
		number: 289,
		title: '[EPIC] Library lending 1.0',
		labels: [label('epic', '6f42c1')],
		subIssues: [
			issue({ number: 290, title: 'Lending slice one', labels: [label('task', '1d76db'), label('ready', '0e8a16')] }),
			issue({
				number: 292,
				title: 'Lending slice two',
				labels: [label('task', '1d76db')],
				state: 'closed',
				stateReason: 'completed',
				closedAt: '2026-09-01T00:00:00Z'
			})
		]
	});

	it('renders sub-issues nested inside their epic', () => {
		const doc = parse(renderBoard([epicWithChildren], GENERATED_AT));
		expect(doc.querySelector('[data-issue="289"] [data-issue="290"]')).not.toBeNull();
		expect(doc.querySelector('[data-issue="289"] [data-issue="292"]')).not.toBeNull();
		expect(doc.querySelector('[data-issue="289"] [data-issue="290"]')?.textContent).toContain(
			'Lending slice one'
		);
	});

	it('renders an epic with zero sub-issues flat — correct, not a gap (every live epic today)', () => {
		const doc = parse(renderBoard(liveShaped, GENERATED_AT));
		expect(doc.querySelector('[data-issue] [data-issue]')).toBeNull();
	});
});

describe('stamp + self-refresh', () => {
	it('buildStamp carries the build identity and changes per build', () => {
		const a = buildStamp('2026-09-10T12:00:00Z');
		const b = buildStamp('2026-09-10T12:05:00Z');
		expect(a).toContain('2026-09-10T12:00:00Z');
		expect(a).not.toBe(b);
		expect(buildStamp('2026-09-10T12:00:00Z')).toBe(a);
	});

	it('one stamp, not two: the page visibly shows the exact value the stamp file carries', () => {
		const doc = parse(renderBoard(liveShaped, GENERATED_AT));
		expect(doc.body?.textContent).toContain(buildStamp(GENERATED_AT).trim());
	});

	it('polls the same-origin stamp file on an interval, cache-busted', () => {
		const script = scriptText(parse(renderBoard(liveShaped, GENERATED_AT)));
		expect(script).toContain('stamp.txt');
		expect(script).toMatch(/setInterval|setTimeout/);
		expect(script).toMatch(/no-store|Date\.now/);
		expect(script).not.toMatch(/https?:\/\/[^\s"'`]*stamp\.txt/);
	});

	it('reloads on a changed stamp without losing the reader\'s scroll position', () => {
		const script = scriptText(parse(renderBoard(liveShaped, GENERATED_AT)));
		expect(script).toMatch(/location\.reload/);
		expect(script).toMatch(/scrollY/);
		expect(script).toMatch(/scrollTo|scrollRestoration/);
	});

	it('a failed stamp fetch changes nothing — the poll is error-tolerant', () => {
		const script = scriptText(parse(renderBoard(liveShaped, GENERATED_AT)));
		expect(script).toMatch(/\.catch\(|try\s*\{/);
	});
});

describe('formatGeneratedAt — Estonian local time (#308)', () => {
	it('formats an EEST (summer) instant as dd.MM.yyyy HH:mm with a +3 zone marker', () => {
		expect(formatGeneratedAt('2026-07-01T12:00:00Z')).toBe('01.07.2026 15:00 GMT +3');
	});

	it('formats an EET (winter) instant as dd.MM.yyyy HH:mm with a +2 zone marker — the DST flip, not a hardcoded offset', () => {
		expect(formatGeneratedAt('2026-01-15T12:00:00Z')).toBe('15.01.2026 14:00 GMT +2');
	});

	it('matches the issue\'s own example exactly', () => {
		expect(formatGeneratedAt('2026-09-10T03:33:16.799Z')).toBe('10.09.2026 06:33 GMT +3');
	});
});

describe('renderBoard — generated-at display (#308)', () => {
	it('the visible <time> text is the Tallinn-local rendering, distinct from the raw ISO datetime attribute', () => {
		const doc = parse(renderBoard(liveShaped, GENERATED_AT));
		const time = doc.querySelector('time');
		expect(time?.getAttribute('datetime')).toBe(GENERATED_AT);
		expect(time?.textContent).toBe(formatGeneratedAt(GENERATED_AT));
		expect(time?.textContent).not.toBe(GENERATED_AT);
	});

	it('datetime attribute and stamp.txt still carry the raw ISO instant unchanged', () => {
		const doc = parse(renderBoard(liveShaped, GENERATED_AT));
		expect(doc.querySelector('time')?.getAttribute('datetime')).toBe(GENERATED_AT);
		expect(buildStamp(GENERATED_AT)).toBe(GENERATED_AT);
	});

	it('REFRESH_SCRIPT\'s CURRENT still carries the raw ISO instant, not the display string', () => {
		const script = scriptText(parse(renderBoard(liveShaped, GENERATED_AT)));
		expect(script).toContain(JSON.stringify(GENERATED_AT));
		expect(script).not.toContain(formatGeneratedAt(GENERATED_AT));
	});
});
