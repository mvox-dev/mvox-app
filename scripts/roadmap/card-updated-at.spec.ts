// @vitest-environment happy-dom
// The card's upper-right corner shows the issue's updatedAt and nothing else (closedAt, labels
// and the build stamp never reach it), in the page's one date format. (*PO:Gama*)
import { describe, expect, it } from 'vitest';
import { renderBoard, renderUpdatedAt, type RoadmapIssue } from './render';

const GENERATED_AT = '2026-09-18T09:00:00.000Z';
// EEST (summer, UTC+3) — Tallinn wall clock 14:53.
const UPDATED_ISO = '2026-09-18T11:53:00.000Z';
const UPDATED_DISPLAY = '18.09.2026 14:53 GMT +3';

function issue(over: Partial<RoadmapIssue> = {}): RoadmapIssue {
	return {
		number: 403,
		title: 'A roadmap card shows when the issue was last updated',
		state: 'open',
		stateReason: null,
		labels: [],
		body: null,
		closedAt: null,
		updatedAt: UPDATED_ISO,
		htmlUrl: 'https://github.com/mvox-dev/mvox-app/issues/403',
		subIssues: [],
		...over
	};
}

describe('#403 — every card carries its last-updated time', () => {
	it('renders a <time> in the card with the ISO instant as its datetime and the page convention as its text', () => {
		const html = renderBoard([issue()], GENERATED_AT);
		const doc = new DOMParser().parseFromString(html, 'text/html');
		const corner = doc.querySelector('article[data-issue="403"] time.issue-updated');
		expect(corner).not.toBeNull();
		expect(corner?.getAttribute('datetime')).toBe(UPDATED_ISO);
		expect(corner?.textContent).toBe(UPDATED_DISPLAY);
	});

	it('a CLOSED card shows its last-updated time too — the corner is not a close time', () => {
		const html = renderBoard(
			[issue({ state: 'closed', stateReason: 'completed', closedAt: '2026-01-02T03:04:05.000Z' })],
			GENERATED_AT
		);
		const doc = new DOMParser().parseFromString(html, 'text/html');
		const corner = doc.querySelector('article[data-issue="403"] time.issue-updated');
		expect(corner?.getAttribute('datetime')).toBe(UPDATED_ISO);
		expect(corner?.textContent).toBe(UPDATED_DISPLAY);
	});

	it('the corner sits before the title link, so the float lands in the upper right', () => {
		const html = renderBoard([issue()], GENERATED_AT);
		const doc = new DOMParser().parseFromString(html, 'text/html');
		const card = doc.querySelector('article[data-issue="403"]');
		expect(card?.firstElementChild?.classList.contains('issue-updated')).toBe(true);
	});

	it('the corner renders floated right inside a card that contains the float', () => {
		document.documentElement.innerHTML = renderBoard([issue()], GENERATED_AT)
			.replace(/^[\s\S]*?<html[^>]*>|<\/html>[\s\S]*$/g, '')
			.replace(/<script[\s\S]*?<\/script>/g, '');
		const card = document.querySelector('article[data-issue="403"]')!;
		expect(getComputedStyle(card.querySelector('time.issue-updated')!).float).toBe('right');
		expect(getComputedStyle(card).display).toBe('flow-root');
	});
});

describe('#403 — the corner reads updatedAt and nothing else', () => {
	it('no updatedAt → no corner, and the card still renders', () => {
		const html = renderBoard([issue({ updatedAt: null })], GENERATED_AT);
		const doc = new DOMParser().parseFromString(html, 'text/html');
		expect(doc.querySelector('article[data-issue="403"]')).not.toBeNull();
		expect(doc.querySelector('time.issue-updated')).toBeNull();
	});

	it('an ABSENT updatedAt (a pre-#403 fixture) renders no corner rather than throwing', () => {
		const bare = issue();
		delete (bare as { updatedAt?: unknown }).updatedAt;
		const html = renderBoard([bare], GENERATED_AT);
		const doc = new DOMParser().parseFromString(html, 'text/html');
		expect(doc.querySelector('article[data-issue="403"]')).not.toBeNull();
		expect(doc.querySelector('time.issue-updated')).toBeNull();
	});

	it('closedAt cannot supply the corner — a closed card with no updatedAt shows none', () => {
		const html = renderBoard(
			[issue({ state: 'closed', stateReason: 'completed', closedAt: '2026-01-02T03:04:05.000Z', updatedAt: null })],
			GENERATED_AT
		);
		const doc = new DOMParser().parseFromString(html, 'text/html');
		expect(doc.querySelector('time.issue-updated')).toBeNull();
	});

	it('the build stamp cannot supply the corner — same issue, a different generatedAt, same rendering', () => {
		const a = renderBoard([issue()], GENERATED_AT);
		const b = renderBoard([issue()], '2027-03-04T05:06:07.000Z');
		const corner = (html: string) =>
			new DOMParser().parseFromString(html, 'text/html').querySelector('time.issue-updated')?.outerHTML;
		expect(corner(a)).toBe(corner(b));
	});

	it('labels cannot supply the corner — motion labels change, the corner does not', () => {
		const plain = renderBoard([issue()], GENERATED_AT);
		const labelled = renderBoard(
			[issue({ labels: [{ name: 'in process', color: '95ea29' }] })],
			GENERATED_AT
		);
		const corner = (html: string) =>
			new DOMParser().parseFromString(html, 'text/html').querySelector('time.issue-updated')?.outerHTML;
		expect(corner(plain)).toBe(corner(labelled));
	});
});

describe('#403 — renderUpdatedAt keeps unvalidated text out of the datetime attribute', () => {
	it('normalizes the instant it emits, so a quote can never reach the attribute', () => {
		expect(renderUpdatedAt('2026-09-18T11:53:00Z')).toContain(`datetime="${UPDATED_ISO}"`);
	});

	it('an unparseable value renders nothing', () => {
		expect(renderUpdatedAt('" onload="alert(1)')).toBe('');
		expect(renderUpdatedAt('not a date')).toBe('');
	});
});
