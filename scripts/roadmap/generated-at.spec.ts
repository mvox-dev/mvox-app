// @vitest-environment happy-dom
// The header <time> shows Tallinn local time (both DST sides) while datetime keeps the ISO instant;
// expected strings are real Intl output (et-EE, Europe/Tallinn). (*MVOX:Tallis*)
import { describe, expect, it } from 'vitest';
import liveShapedJson from './fixtures/live-shaped.json';
import { renderBoard, type RoadmapIssue } from './render';

const liveShaped: RoadmapIssue[] = liveShapedJson as RoadmapIssue[];

const SUMMER_ISO = '2026-07-01T12:00:00.000Z';
const SUMMER_DISPLAY = '01.07.2026 15:00 GMT +3';
const WINTER_ISO = '2026-01-15T12:00:00.000Z';
const WINTER_DISPLAY = '15.01.2026 14:00 GMT +2';
const MILLIS_ISO = '2026-09-10T03:33:16.799Z';
const MILLIS_DISPLAY = '10.09.2026 06:33 GMT +3';

function parse(html: string): Document {
	return new DOMParser().parseFromString(html, 'text/html');
}

function doc0(): Document {
	return parse(renderBoard(liveShaped, SUMMER_ISO));
}

/** The one <time> element on the page. Contract: it exists, exactly once. */
function timeEl(doc: Document): Element {
	const els = doc.querySelectorAll('time');
	expect(els.length, 'the page must carry exactly one <time> element').toBe(1);
	return els[0];
}

/** All inline script text of the page — REFRESH_SCRIPT lives there. */
function scriptText(doc: Document): string {
	return Array.from(doc.querySelectorAll('script'))
		.map((s) => s.textContent ?? '')
		.join('\n');
}

describe('#308 — generated-at shown in Estonian local time', () => {
	it('renders the summer (EEST) instant as Tallinn wall-clock time with the GMT +3 marker', () => {
		const doc = parse(renderBoard(liveShaped, SUMMER_ISO));
		expect(timeEl(doc).textContent).toBe(SUMMER_DISPLAY);
	});

	it('renders the winter (EET) instant one hour differently — a hardcoded +03:00 would show 15:00', () => {
		const doc = parse(renderBoard(liveShaped, WINTER_ISO));
		expect(timeEl(doc).textContent).toBe(WINTER_DISPLAY);
	});

	it('separates date and time with a single space, not the Intl preset comma', () => {
		const doc = parse(renderBoard(liveShaped, SUMMER_ISO));
		const text = timeEl(doc).textContent ?? '';
		expect(text).not.toContain(',');
		expect(text).toContain('01.07.2026 15:00');
	});

	it('drops milliseconds and seconds from the visible text while datetime keeps the full ISO', () => {
		const doc = parse(renderBoard(liveShaped, MILLIS_ISO));
		const el = timeEl(doc);
		expect(el.getAttribute('datetime')).toBe(MILLIS_ISO);
		expect(el.textContent).toBe(MILLIS_DISPLAY);
		expect(el.textContent).not.toContain('799');
		expect(el.textContent).not.toContain(':16');
	});

	it('one instant, two renderings: datetime keeps the ISO UTC instant, the text does not repeat it', () => {
		const doc = parse(renderBoard(liveShaped, SUMMER_ISO));
		const el = timeEl(doc);
		expect(el.getAttribute('datetime')).toBe(SUMMER_ISO);
		expect(el.textContent).not.toBe(el.getAttribute('datetime'));
		const header = doc.querySelector('header');
		expect(header).not.toBeNull();
		expect(header?.textContent).not.toContain(SUMMER_ISO);
	});

	it('one header line reads "mvox roadmap | <time>", with mvox the link to the app', () => {
		const doc = parse(renderBoard(liveShaped, SUMMER_ISO));
		const header = doc.querySelector('header');
		expect(header?.textContent?.replace(/\s+/g, ' ').trim()).toBe(
			`mvox roadmap | ${timeEl(doc).textContent}`
		);
		expect(header?.querySelector('h1 a[href="https://mvox.eu"]')?.textContent).toBe('mvox');
		expect(header?.querySelectorAll('p, br')).toHaveLength(0);
	});

	it('the header line is sticky, on one flex row, and mvox is italic', () => {
		const style = doc0().querySelector('style')?.textContent ?? '';
		const rule = (sel: string) => new RegExp(`(^|[\\s,}])${sel.replace('.', '\\.')}\\s*\\{([^}]*)\\}`).exec(style)?.[2] ?? '';
		expect(rule('.masthead')).toMatch(/position:\s*sticky/);
		expect(rule('.masthead')).toMatch(/top:\s*0/);
		expect(rule('.masthead')).toMatch(/display:\s*flex/);
		expect(rule('.masthead')).toMatch(/background:/);
		expect(rule('.app-link')).toMatch(/font-style:\s*italic/);
		expect(doc0().querySelector('header')?.classList.contains('masthead')).toBe(true);
	});

	it('self-refresh identity untouched: CURRENT stays the ISO stamp, never the display string', () => {
		const doc = parse(renderBoard(liveShaped, SUMMER_ISO));
		const script = scriptText(doc);
		// The exact JS literal REFRESH_SCRIPT embeds — compared against stamp.txt with !==.
		expect(script).toContain(JSON.stringify(SUMMER_ISO));
		expect(script).not.toContain(SUMMER_DISPLAY);
	});

	it('stays deterministic with the formatting in place: same instant, byte-identical page', () => {
		expect(renderBoard(liveShaped, WINTER_ISO)).toBe(renderBoard(liveShaped, WINTER_ISO));
	});
});
