// @vitest-environment happy-dom
/**
 * #403 RED — the card's upper-right corner shows when the issue was last updated.
 *
 * Mihkel's commission, and its simplification: the corner is PLAIN last-updated,
 * "be it label movement or new comment". So the rendering reads exactly one
 * field — `updatedAt` — and nothing else may reach it: not `closedAt`, not a
 * label, not the build stamp. The last-updated claim is only true while that
 * stays the single source, which is what the isolation tests below pin.
 *
 * The issue's third box ("a commit or an issue that only references it does not
 * change what the corner shows") is a property of GitHub's `updated_at`, not of
 * this code: verified at the artefact on #369 (closed 22:39:45Z, updated
 * 22:39:51Z, two later commit `referenced` events left it unchanged) and on
 * #371 (cross-reference, likewise unchanged). What IS ours to hold is that the
 * corner cannot drift off that field, so that is what is tested here.
 *
 * Display convention is the page's existing one (`formatGeneratedAt`) — one date
 * convention on one page, no second clock.
 *
 * (*PO:Gama*)
 */
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

	it('the stylesheet floats it right and the card contains the float', () => {
		const html = renderBoard([issue()], GENERATED_AT);
		expect(html).toContain('.issue-updated { float: right;');
		expect(html).toContain('.issue { display: flow-root;');
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
