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
 * (*MVOX:Tallis*)
 */
import { describe, expect, it } from 'vitest';
import liveShapedJson from './fixtures/live-shaped.json';
import {
	buildStamp,
	displayTitle,
	parseFrontmatter,
	renderBoard,
	type RoadmapIssue
} from './render';

const GENERATED_AT = '2026-09-10T12:34:56Z';

const liveShaped: RoadmapIssue[] = liveShapedJson as RoadmapIssue[];

function issue(overrides: Partial<RoadmapIssue> & Pick<RoadmapIssue, 'number' | 'title'>): RoadmapIssue {
	return {
		state: 'open',
		stateReason: null,
		labels: [],
		body: null,
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
			[issue({ number: 210, title: 'Legacy import spike', labels: ['task', 'wontfix', 'völlig-unbekannt'] })],
			GENERATED_AT
		);
		expect(parse(html).querySelector('[data-issue="210"]')).not.toBeNull();
	});
});

describe('renderBoard — frontmatter on the page', () => {
	const decorated = issue({
		number: 301,
		title: 'Score detail page shows lending state',
		labels: ['task', 'ready'],
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
		labels: ['epic'],
		subIssues: [
			issue({ number: 290, title: 'Lending slice one', labels: ['task', 'ready'] }),
			issue({
				number: 292,
				title: 'Lending slice two',
				labels: ['task'],
				state: 'closed',
				stateReason: 'completed'
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
