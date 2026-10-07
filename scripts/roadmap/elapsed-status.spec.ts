// @vitest-environment happy-dom
// An open `in process` or `in research` card shows how long since that label was set, counted
// in the browser; every other card keeps its last-updated time. (*PO:Gama*)
import { afterEach, describe, expect, it, vi } from 'vitest';
import { labelSince } from './fetch-issues';
import { formatElapsed, renderBoard, type RoadmapIssue } from './render';

const GENERATED_AT = '2026-10-06T18:00:00.000Z';
const SINCE = '2026-10-06T15:45:00.000Z';
const UPDATED = '2026-10-06T17:00:00.000Z';

function issue(over: Partial<RoadmapIssue> = {}): RoadmapIssue {
	return {
		number: 809,
		title: 'Single-select controls become segmented pills',
		state: 'open',
		stateReason: null,
		labels: [{ name: 'in process', color: null }],
		body: null,
		closedAt: null,
		updatedAt: UPDATED,
		statusSince: SINCE,
		htmlUrl: 'https://github.com/mvox-dev/mvox-app/issues/809',
		subIssues: [],
		...over
	};
}

function corner(html: string): Element | null {
	return new DOMParser().parseFromString(html, 'text/html').querySelector('article[data-issue="809"] time');
}

afterEach(() => {
	vi.useRealTimers();
});

describe('elapsed time on in-process and in-research cards', () => {
	it('an open in-process card shows the time since the label was set, not a timestamp', () => {
		const time = corner(renderBoard([issue()], GENERATED_AT));
		expect(time?.textContent).toBe('2 h 15 min');
		expect(time?.getAttribute('datetime')).toBe(SINCE);
		expect(time?.getAttribute('title')).toMatch(/^in process since /);
	});

	it('an open in-research card shows the time since that label was set, and says which label', () => {
		const time = corner(renderBoard([issue({ labels: [{ name: 'in research', color: null }] })], GENERATED_AT));
		expect(time?.textContent).toBe('2 h 15 min');
		expect(time?.getAttribute('title')).toMatch(/^in research since /);
	});

	it('a card wearing both counts from in process', () => {
		const labels = [
			{ name: 'in research', color: null },
			{ name: 'in process', color: null }
		];
		const time = corner(renderBoard([issue({ labels })], GENERATED_AT));
		expect(time?.getAttribute('title')).toMatch(/^in process since /);
	});

	it('a card with neither label keeps its last-updated time', () => {
		const time = corner(renderBoard([issue({ labels: [{ name: 'ready', color: null }] })], GENERATED_AT));
		expect(time?.getAttribute('datetime')).toBe(UPDATED);
		expect(time?.textContent).toBe('06.10.2026 20:00 GMT +3');
	});

	it('a closed card still wearing the label keeps its last-updated time', () => {
		const time = corner(
			renderBoard([issue({ state: 'closed', stateReason: 'completed', closedAt: UPDATED })], GENERATED_AT)
		);
		expect(time?.getAttribute('datetime')).toBe(UPDATED);
	});

	it('a card with no known label time keeps its last-updated time', () => {
		const time = corner(renderBoard([issue({ statusSince: null })], GENERATED_AT));
		expect(time?.getAttribute('datetime')).toBe(UPDATED);
	});

	it('the page counts on in the browser: the shown time follows the clock, not the build', () => {
		vi.useFakeTimers({ toFake: ['Date', 'setInterval'] });
		vi.setSystemTime(new Date('2026-10-08T19:50:00.000Z'));
		const html = renderBoard([issue()], GENERATED_AT);
		const doc = new DOMParser().parseFromString(html, 'text/html');
		document.body.innerHTML = doc.body.innerHTML;
		new Function(doc.querySelector('script')?.textContent ?? '')();
		const time = document.querySelector('article[data-issue="809"] time');
		expect(time?.textContent).toBe('2 p 4 h');
		vi.setSystemTime(new Date('2026-10-08T20:50:00.000Z'));
		vi.advanceTimersByTime(60000);
		expect(time?.textContent).toBe('2 p 5 h');
	});
});

describe('formatElapsed', () => {
	it('minutes under an hour, hours and minutes under a day, then days and hours', () => {
		expect(formatElapsed(0)).toBe('0 min');
		expect(formatElapsed(59 * 60000)).toBe('59 min');
		expect(formatElapsed(75 * 60000)).toBe('1 h 15 min');
		expect(formatElapsed((2 * 1440 + 4 * 60 + 30) * 60000)).toBe('2 p 4 h');
		expect(formatElapsed(-60000)).toBe('0 min');
	});
});

describe('labelSince', () => {
	it('is the last time the label was added, ignoring other labels and removals', () => {
		const events = [
			{ event: 'labeled', label: { name: 'in research' }, created_at: '2026-10-01T10:00:00Z' },
			{ event: 'unlabeled', label: { name: 'in research' }, created_at: '2026-10-02T10:00:00Z' },
			{ event: 'labeled', label: { name: 'ready' }, created_at: '2026-10-03T10:00:00Z' },
			{ event: 'labeled', label: { name: 'in research' }, created_at: '2026-10-04T10:00:00Z' }
		];
		expect(labelSince(events, 'in research')).toBe('2026-10-04T10:00:00Z');
	});

	it('is null when the label was never added', () => {
		expect(labelSince([{ event: 'labeled', label: { name: 'ready' }, created_at: 'x' }], 'in process')).toBeNull();
	});
});
