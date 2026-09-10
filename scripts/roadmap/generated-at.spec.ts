// @vitest-environment happy-dom
/**
 * #308 RED — the generated-at line shows Estonian local time.
 *
 * One instant, rendered twice: the <time> element's `datetime` attribute
 * keeps the ISO UTC instant (machine identity — same value as stamp.txt and
 * REFRESH_SCRIPT's CURRENT), while its TEXT CONTENT becomes a human rendering
 * in Europe/Tallinn. The display string is formatted FROM generatedAt; there
 * is no second clock.
 *
 * Expected strings below are REAL Intl output, verified live on Node 22
 * full-ICU (et-EE, Europe/Tallinn, 2-digit day/month, numeric year, 24h,
 * timeZoneName 'shortOffset'), reassembled from formatToParts with a single
 * space between date and time. No dateStyle/timeStyle preset produces this:
 * presets emit a comma (`01.07.2026, 15:00`) or a two-digit year — the exact
 * assertions here are deliberate so a naive .format() call fails.
 *
 * The zone marker keeps Intl's native spacing: `GMT +3` / `GMT +2`, WITH a
 * space after GMT (that is the literal formatToParts value for this zone).
 *
 * DST both sides is the issue's hard requirement: a hardcoded +03:00 offset
 * renders the January instant 15:00 instead of 14:00 and nothing would ever
 * report it — the winter test below is what catches exactly that.
 *
 * (*MVOX:Tallis*)
 */
import { describe, expect, it } from 'vitest';
import liveShapedJson from './fixtures/live-shaped.json';
import { renderBoard, type RoadmapIssue } from './render';

const liveShaped: RoadmapIssue[] = liveShapedJson as RoadmapIssue[];

// Instants in new Date().toISOString() shape (what main() injects).
// EEST (summer, UTC+3) — Tallinn wall clock 15:00.
const SUMMER_ISO = '2026-07-01T12:00:00.000Z';
const SUMMER_DISPLAY = '01.07.2026 15:00 GMT +3';
// EET (winter, UTC+2) — Tallinn wall clock 14:00. A fixed +03:00 says 15:00.
const WINTER_ISO = '2026-01-15T12:00:00.000Z';
const WINTER_DISPLAY = '15.01.2026 14:00 GMT +2';
// An instant with visible milliseconds — noise on a build stamp.
const MILLIS_ISO = '2026-09-10T03:33:16.799Z';
const MILLIS_DISPLAY = '10.09.2026 06:33 GMT +3';

function parse(html: string): Document {
	return new DOMParser().parseFromString(html, 'text/html');
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
		// Every dateStyle/timeStyle preset and even explicit-field .format()
		// puts ", " between date and time; the target format has a bare space,
		// so the string must be assembled from formatToParts.
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
		// The human line must not show the raw ISO string at all.
		const meta = doc.querySelector('.meta');
		expect(meta).not.toBeNull();
		expect(meta?.textContent).not.toContain(SUMMER_ISO);
	});

	it('keeps the page furniture English: the line still reads "Generated at …"', () => {
		const doc = parse(renderBoard(liveShaped, SUMMER_ISO));
		expect(doc.querySelector('.meta')?.textContent).toMatch(/^Generated at /);
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
