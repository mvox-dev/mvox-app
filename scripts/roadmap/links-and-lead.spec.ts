// @vitest-environment happy-dom
/**
 * #309 RED — cards link to their issue, a `lead` frontmatter field, and a
 * header link back to the app.
 *
 * Card link contract (issue body):
 * - The card's `#N` and displayed title together form ONE `<a>` whose href is
 *   the issue's `htmlUrl` VERBATIM (fetched `html_url`, carried camelCase per
 *   the closedAt convention) — no string assembly, no hardcoded host.
 * - Epics render exactly like leaves: children sit AFTER the labels span, so
 *   wrapping only number+title can never nest anchors — pinned here as zero
 *   nested `<a>` in the raw markup, and children's links outside the parent's.
 * - Accessible name is the link's own text; NO aria-label anywhere (none
 *   exists in the module today — pinned to stay that way).
 * - Same tab: no target attribute.
 * - VISIBLY a link at rest: the existing .issue-number/.issue-title author
 *   color rules override the UA's default link styling, so a bare `<a>` would
 *   look exactly like today's plain text — a stylesheet rule (underline) on
 *   the link is REQUIRED, pinned with the same style-block-assertion pattern
 *   the #307 chip specs use.
 *
 * Lead contract: second frontmatter field `lead`, ADDITIONAL to the title
 * (slugline REPLACES the title; lead renders under it, above the labels, as
 * `.issue-lead`). Absent lead → no element at all. Not truncated. Escaped
 * like every other authored string. Unknown keys still ignored. Same
 * renderIssue path for sub-issue cards.
 *
 * Header link contract (amendment, comment 5613989097 — DECISION-Mihkel
 * "links are enough"): ONE plain static `<a>` to https://mvox.eu in the page
 * header, same tab, labelled with the bare product name "mvox", no
 * session/token/origin plumbing of any kind.
 *
 * (*MVOX:Tallis*)
 */
import { describe, expect, it } from 'vitest';
import liveShapedJson from './fixtures/live-shaped.json';
import * as renderModule from './render';
import { renderBoard, displayTitle, type RoadmapIssue, type RoadmapLabel } from './render';

const GENERATED_AT = '2026-09-10T12:34:56Z';

/**
 * The fixture and these specs carry htmlUrl ahead of the RoadmapIssue type
 * gaining the field — the intersection stays valid before and after.
 */
type LinkedIssue = RoadmapIssue & { htmlUrl?: string };

const liveShaped = liveShapedJson as (RoadmapIssue & { htmlUrl: string })[];

/** displayLead does not exist at HEAD — reached via the namespace so the whole file still runs RED. */
const displayLead = (
	renderModule as { displayLead?: (issue: RoadmapIssue) => string | null }
).displayLead;

function label(name: string, color: string | null = null): RoadmapLabel {
	return { name, color };
}

function issue(
	overrides: Partial<LinkedIssue> & Pick<RoadmapIssue, 'number' | 'title'>
): LinkedIssue {
	return {
		state: 'open',
		stateReason: null,
		labels: [],
		body: null,
		closedAt: null,
		subIssues: [],
		htmlUrl: `https://example.test/issues/${overrides.number}`,
		...overrides
	};
}

function parse(html: string): Document {
	return new DOMParser().parseFromString(html, 'text/html');
}

function entry(doc: Document, number: number): Element {
	const el = doc.querySelector(`[data-issue="${number}"]`);
	expect(el, `no [data-issue="${number}"] element rendered`).not.toBeNull();
	return el as Element;
}

/**
 * Maximum <a> nesting depth in the RAW markup. DOM-based checks cannot see
 * source-level nesting — the HTML parser auto-splits nested anchors — so the
 * zero-nested-anchors pin has to read the string the renderer actually emits.
 */
function maxAnchorDepth(html: string): number {
	let depth = 0;
	let max = 0;
	for (const m of html.matchAll(/<\/a>|<a[\s>]/gi)) {
		if (m[0].startsWith('</')) depth--;
		else {
			depth++;
			max = Math.max(max, depth);
		}
	}
	return max;
}

describe('renderBoard — cards link to their issue (#309)', () => {
	it('every fixture card wraps its #N and title in one link to the issue htmlUrl — and only that one link', () => {
		const doc = parse(renderBoard(liveShaped, GENERATED_AT));
		for (const i of liveShaped) {
			const card = entry(doc, i.number);
			const link = card.querySelector(`a[href="${i.htmlUrl}"]`);
			expect(link, `#${i.number}: no <a href="${i.htmlUrl}"> on the card`).not.toBeNull();
			expect(link?.textContent).toContain(`#${i.number}`);
			expect(link?.textContent).toContain(displayTitle(i));
			expect(
				card.querySelectorAll('a'),
				`#${i.number}: the card must carry exactly one link — its own`
			).toHaveLength(1);
		}
	});

	it('uses the htmlUrl verbatim — query string intact, no assembled github.com URL anywhere', () => {
		const url = 'https://example.test/anywhere/77?probe=1';
		const html = renderBoard(
			[issue({ number: 77, title: 'Verbatim href probe', htmlUrl: url })],
			GENERATED_AT
		);
		const link = entry(parse(html), 77).querySelector('a');
		expect(link, 'card renders no link').not.toBeNull();
		expect(link?.getAttribute('href')).toBe(url);
		// Nothing in the input mentions github.com, so nothing in the output may
		// either — a hardcoded host would surface right here.
		expect(html).not.toContain('github.com');
	});

	it('the link text is the DISPLAYED title — the slugline when frontmatter provides one', () => {
		const doc = parse(
			renderBoard(
				[
					issue({
						number: 320,
						title: 'English title',
						htmlUrl: 'https://example.test/issues/320',
						body: '---\nslugline: Eesti pealkiri\n---\nBody.'
					})
				],
				GENERATED_AT
			)
		);
		const link = entry(doc, 320).querySelector('a[href="https://example.test/issues/320"]');
		expect(link).not.toBeNull();
		expect(link?.textContent).toContain('#320');
		expect(link?.textContent).toContain('Eesti pealkiri');
		expect(link?.textContent).not.toContain('English title');
	});

	it('labels and lead stay OUTSIDE the link — selectable, not draggable', () => {
		const doc = parse(
			renderBoard(
				[
					issue({
						number: 321,
						title: 'English title',
						labels: [label('task', '1d76db')],
						body: '---\nslugline: Eesti pealkiri\nlead: LEAD-MARKER selgitav lause\n---\nBody.'
					})
				],
				GENERATED_AT
			)
		);
		const link = entry(doc, 321).querySelector('a');
		expect(link, 'card renders no link').not.toBeNull();
		expect(link?.querySelector('.issue-labels')).toBeNull();
		expect(link?.querySelector('.issue-lead')).toBeNull();
		expect(link?.textContent).not.toContain('task');
		expect(link?.textContent).not.toContain('LEAD-MARKER');
	});

	it('accessible name is the link\'s own text — no aria-label anywhere on the page', () => {
		const html = renderBoard(liveShaped, GENERATED_AT);
		// Guard: the links must actually exist before the absence pin means anything.
		expect(parse(html).querySelector('article a')).not.toBeNull();
		expect(html).not.toContain('aria-label');
	});

	it('opens in the same tab — no target attribute on any anchor', () => {
		const doc = parse(renderBoard(liveShaped, GENERATED_AT));
		// 8 card links + the header app link.
		expect(doc.querySelectorAll('a').length).toBeGreaterThanOrEqual(9);
		expect(doc.querySelectorAll('a[target]')).toHaveLength(0);
	});

	it('is VISIBLY a link at rest: the stylesheet carries an underline rule targeting the link', () => {
		// The existing .issue-number / .issue-title author color rules override
		// the UA's default link styling, so without an explicit rule the link
		// would look exactly like today's plain text — an invisible target.
		const style = parse(renderBoard(liveShaped, GENERATED_AT)).querySelector('style')?.textContent ?? '';
		const underlineRules = [...style.matchAll(/([^{}]+)\{[^}]*underline[^}]*\}/g)];
		expect(underlineRules.length, 'no underline rule anywhere in the stylesheet').toBeGreaterThan(0);
		expect(
			underlineRules.some(
				([, selector]) => /(^|[\s.,:>~+])a\b/.test(selector) || /link/i.test(selector)
			),
			'the underline rule must target the anchor (an `a` selector or a *link* class)'
		).toBe(true);
	});

	it('a closed card keeps its link and href inside the dim — no special case', () => {
		const url = 'https://example.test/issues/330';
		const doc = parse(
			renderBoard(
				[
					issue({
						number: 330,
						title: 'Done and dimmed',
						state: 'closed',
						stateReason: 'completed',
						closedAt: '2026-09-01T00:00:00Z',
						htmlUrl: url
					})
				],
				GENERATED_AT
			)
		);
		const card = entry(doc, 330);
		expect(card.getAttribute('data-state')).toBe('closed');
		expect(card.querySelector('a')?.getAttribute('href')).toBe(url);
	});
});

describe('renderBoard — epics link like leaves, anchors never nest (#309)', () => {
	const epic = issue({
		number: 289,
		title: '[EPIC] Library lending 1.0',
		htmlUrl: 'https://example.test/issues/289',
		labels: [label('epic', '6f42c1')],
		subIssues: [
			issue({
				number: 290,
				title: 'Lending slice one',
				htmlUrl: 'https://example.test/issues/290',
				labels: [label('task', '1d76db')]
			}),
			issue({
				number: 292,
				title: 'Lending slice two',
				htmlUrl: 'https://example.test/issues/292',
				state: 'closed',
				stateReason: 'completed',
				closedAt: '2026-09-01T00:00:00Z',
				labels: [label('task', '1d76db')]
			})
		]
	});

	it('an epic card renders exactly like a leaf: its own link wraps its own #N + title only', () => {
		const doc = parse(renderBoard([epic], GENERATED_AT));
		const parentLink = entry(doc, 289).querySelector('a[href="https://example.test/issues/289"]');
		expect(parentLink, 'epic card has no link of its own').not.toBeNull();
		expect(parentLink?.textContent).toContain('#289');
		expect(parentLink?.textContent).toContain('[EPIC] Library lending 1.0');
		expect(parentLink?.querySelector('[data-issue]'), 'a child card sits inside the parent link').toBeNull();
		expect(parentLink?.querySelector('a'), 'an anchor sits inside the parent link').toBeNull();
	});

	it('children link to their own issues, inside their own card, outside the parent\'s anchor', () => {
		const doc = parse(renderBoard([epic], GENERATED_AT));
		const childLink = doc.querySelector(
			'[data-issue="289"] [data-issue="290"] a[href="https://example.test/issues/290"]'
		);
		expect(childLink, 'nested child card has no link of its own').not.toBeNull();
		expect(childLink?.textContent).toContain('#290');
		expect(doc.querySelectorAll('a[href="https://example.test/issues/290"]')).toHaveLength(1);
		// The closed child keeps its link too, through the same path.
		expect(
			doc.querySelector('[data-issue="292"] a[href="https://example.test/issues/292"]')
		).not.toBeNull();
	});

	it('zero nested anchors anywhere in the raw markup — the parser would hide this, the string cannot', () => {
		const html = renderBoard([epic, ...liveShaped], GENERATED_AT);
		expect(maxAnchorDepth(html)).toBe(1);
	});
});

describe('displayLead (#309)', () => {
	it('render.ts exports displayLead', () => {
		expect(displayLead, 'render.ts must export displayLead').toBeTypeOf('function');
	});

	it('returns the lead when present and a non-empty string', () => {
		expect(
			displayLead?.(
				issue({
					number: 301,
					title: 'Score detail page shows lending state',
					body: '---\nlead: Laenutuse seis noodi lehel, ühe lausega.\n---\nBody.'
				})
			)
		).toBe('Laenutuse seis noodi lehel, ühe lausega.');
	});

	it('returns null when there is no frontmatter, or no body at all', () => {
		expect(displayLead?.(issue({ number: 1, title: 't', body: 'Plain markdown body.' }))).toBeNull();
		expect(displayLead?.(issue({ number: 2, title: 't', body: null }))).toBeNull();
	});

	it('returns null when lead is empty or not a string — the displayTitle type-guard, mirrored', () => {
		expect(displayLead?.(issue({ number: 3, title: 't', body: '---\nlead: ""\n---\n' }))).toBeNull();
		expect(displayLead?.(issue({ number: 4, title: 't', body: '---\nlead: 42\n---\n' }))).toBeNull();
	});

	it('returns null on malformed frontmatter, never throws', () => {
		expect(() => displayLead?.(issue({ number: 5, title: 't', body: '---\nlead: [broken\n---\n' }))).not.toThrow();
		expect(displayLead?.(issue({ number: 5, title: 't', body: '---\nlead: [broken\n---\n' }))).toBeNull();
	});

	it('returns null when the frontmatter carries only a slugline', () => {
		expect(
			displayLead?.(issue({ number: 6, title: 't', body: '---\nslugline: Ainult pealkiri\n---\n' }))
		).toBeNull();
	});
});

describe('renderBoard — lead on the page (#309)', () => {
	it('renders the lead under the title and above the labels, as .issue-lead', () => {
		const html = renderBoard(
			[
				issue({
					number: 322,
					title: 'English title',
					labels: [label('task', '1d76db')],
					body: '---\nslugline: Eesti pealkiri\nlead: LEAD-MARKER selgitav lause\n---\nBody.'
				})
			],
			GENERATED_AT
		);
		const doc = parse(html);
		const card = entry(doc, 322);
		const lead = card.querySelector('.issue-lead');
		expect(lead, 'no .issue-lead element on the card').not.toBeNull();
		expect(lead?.textContent).toContain('LEAD-MARKER selgitav lause');
		expect(card.querySelector('.issue-title')?.textContent).toBe('Eesti pealkiri');
		// Ordering read off the CARD's own children rather than off the whole
		// document string: a string search matches the stylesheet's
		// `.issue-labels` SELECTOR text as readily as the rendered span, so it
		// would pass or fail on where the <style> block sits instead of on the
		// card markup this test is about.
		const order = Array.from(card.children).map((el) => el.className);
		expect(order, 'the card must render link, lead and labels').toEqual(
			expect.arrayContaining(['issue-link', 'issue-lead', 'issue-labels'])
		);
		expect(order.indexOf('issue-lead'), 'lead must sit under the title').toBeGreaterThan(
			order.indexOf('issue-link')
		);
		expect(order.indexOf('issue-lead'), 'lead must sit above the labels').toBeLessThan(
			order.indexOf('issue-labels')
		);
	});

	it('an issue without a lead renders NO element at all — the fixture board carries exactly one lead (#301)', () => {
		const doc = parse(renderBoard(liveShaped, GENERATED_AT));
		const lead = entry(doc, 301).querySelector('.issue-lead');
		expect(lead, 'the fixture lead on #301 must render').not.toBeNull();
		expect(lead?.textContent).toContain('Näitab iga eksemplari laenutuse seisu otse noodi lehel.');
		// Every other fixture issue is undecorated: no placeholder, no empty span.
		expect(entry(doc, 305).querySelector('.issue-lead')).toBeNull();
		expect(doc.querySelectorAll('.issue-lead')).toHaveLength(1);
	});

	it('lead is ADDITIONAL: slugline+lead coexist, lead-only keeps the English title, slugline-only renders no lead element', () => {
		const doc = parse(
			renderBoard(
				[
					issue({
						number: 31,
						title: 'Both decorated',
						body: '---\nslugline: Mõlemad olemas\nlead: Kirjeldus mõlema kõrvale\n---\n'
					}),
					issue({
						number: 32,
						title: 'Lead only keeps this title',
						body: '---\nlead: Ainult kirjeldus\n---\n'
					}),
					issue({
						number: 33,
						title: 'Slugline only',
						body: '---\nslugline: Ainult pealkiri\n---\n'
					})
				],
				GENERATED_AT
			)
		);
		const both = entry(doc, 31);
		expect(both.textContent).toContain('Mõlemad olemas');
		expect(both.querySelector('.issue-lead')?.textContent).toContain('Kirjeldus mõlema kõrvale');
		const leadOnly = entry(doc, 32);
		expect(leadOnly.textContent).toContain('Lead only keeps this title');
		expect(leadOnly.querySelector('.issue-lead')?.textContent).toContain('Ainult kirjeldus');
		const sluglineOnly = entry(doc, 33);
		expect(sluglineOnly.textContent).toContain('Ainult pealkiri');
		expect(sluglineOnly.querySelector('.issue-lead')).toBeNull();
	});

	it('a long lead renders in FULL — keeping it short is editorial discipline, not a code limit', () => {
		const longLead = 'Pikk kirjeldus, mida kood ei tohi kunagi kärpida ega lühendada. '.repeat(8).trim();
		expect(longLead.length).toBeGreaterThan(400);
		const doc = parse(
			renderBoard(
				[issue({ number: 34, title: 'Long lead', body: `---\nlead: ${longLead}\n---\n` })],
				GENERATED_AT
			)
		);
		expect(entry(doc, 34).querySelector('.issue-lead')?.textContent).toContain(longLead);
	});

	it('escapes HTML in leads too', () => {
		const html = renderBoard(
			[
				issue({
					number: 35,
					title: 'Safe title',
					body: '---\nlead: <img src=x onerror=alert(1)>\n---\n'
				})
			],
			GENERATED_AT
		);
		// Guard first: the lead must actually be on the page — an absent lead
		// would pass the injection check vacuously.
		const lead = entry(parse(html), 35).querySelector('.issue-lead');
		expect(lead, 'no .issue-lead rendered — nothing to escape').not.toBeNull();
		expect(lead?.textContent).toContain('<img src=x onerror=alert(1)>');
		expect(html).not.toContain('<img src=x');
	});

	it('unknown frontmatter keys are still ignored alongside lead — and their values never reach the HTML', () => {
		const html = renderBoard(
			[
				issue({
					number: 36,
					title: 'Future keys',
					body: '---\nlead: Toimiv lühikirjeldus\nsome_future_key: FUTURE-LEAK-VALUE\n---\n'
				})
			],
			GENERATED_AT
		);
		const doc = parse(html);
		expect(entry(doc, 36).querySelector('.issue-lead')?.textContent).toContain('Toimiv lühikirjeldus');
		expect(html).not.toContain('FUTURE-LEAK-VALUE');
	});

	it('sub-issue cards render lead identically — same renderIssue path', () => {
		const doc = parse(
			renderBoard(
				[
					issue({
						number: 289,
						title: '[EPIC] Library lending 1.0',
						labels: [label('epic', '6f42c1')],
						subIssues: [
							issue({
								number: 290,
								title: 'Lending slice one',
								body: '---\nlead: NESTED-LEAD lapse kirjeldus\n---\n'
							})
						]
					})
				],
				GENERATED_AT
			)
		);
		const nestedLead = doc.querySelector('[data-issue="289"] [data-issue="290"] .issue-lead');
		expect(nestedLead, 'nested child card renders no .issue-lead').not.toBeNull();
		expect(nestedLead?.textContent).toContain('NESTED-LEAD lapse kirjeldus');
	});
});

describe('renderBoard — header link back to the app (#309 amendment 5613989097)', () => {
	it('one plain <a href="https://mvox.eu"> labelled with the bare product name, in the header beside the h1', () => {
		const doc = parse(renderBoard(liveShaped, GENERATED_AT));
		const link = doc.querySelector('header a[href="https://mvox.eu"]');
		expect(link, 'no <a href="https://mvox.eu"> in the page header').not.toBeNull();
		expect(link?.textContent?.trim()).toBe('mvox');
		expect(link?.closest('header')?.querySelector('h1'), 'the header holding the link must be the h1 header').not.toBeNull();
	});

	it('same tab, no plumbing: the href is exactly https://mvox.eu and there is no target attribute', () => {
		const doc = parse(renderBoard(liveShaped, GENERATED_AT));
		const appLinks = Array.from(doc.querySelectorAll('a')).filter((a) =>
			(a.getAttribute('href') ?? '').includes('mvox.eu')
		);
		expect(appLinks, 'exactly one link to the app').toHaveLength(1);
		expect(appLinks[0].getAttribute('href')).toBe('https://mvox.eu');
		expect(appLinks[0].hasAttribute('target')).toBe(false);
	});

	it('lives in the header region, not among the cards', () => {
		const doc = parse(renderBoard(liveShaped, GENERATED_AT));
		expect(doc.querySelector('header a[href="https://mvox.eu"]')).not.toBeNull();
		expect(doc.querySelector('main a[href="https://mvox.eu"]')).toBeNull();
		expect(doc.querySelector('article a[href="https://mvox.eu"]')).toBeNull();
	});
});
