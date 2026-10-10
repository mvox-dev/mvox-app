// @vitest-environment happy-dom
// Open `in process` / `in research` cards count time since that label in the browser; cards also
// show how long research and building took, and an epic sums its sub-issues'. (*PO:Gama*)
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchBoard, labelSince, labelSpanMs, type LabelEvent } from './fetch-issues';
import { formatClock, formatElapsed, renderBoard, type RoadmapIssue } from './render';

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
		expect(time?.textContent).toBe('2:15:00');
		expect(time?.getAttribute('datetime')).toBe(SINCE);
		expect(time?.getAttribute('title')).toMatch(/^in process since /);
	});

	it('an open in-research card shows the time since that label was set, and says which label', () => {
		const time = corner(renderBoard([issue({ labels: [{ name: 'in research', color: null }] })], GENERATED_AT));
		expect(time?.textContent).toBe('2:15:00');
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

	it('the page ticks every second from the browser clock, not the build', () => {
		vi.useFakeTimers({ toFake: ['Date', 'setInterval'] });
		vi.setSystemTime(new Date('2026-10-08T19:50:00.000Z'));
		const html = renderBoard([issue()], GENERATED_AT);
		const doc = new DOMParser().parseFromString(html, 'text/html');
		document.body.innerHTML = doc.body.innerHTML;
		new Function(doc.querySelector('script')?.textContent ?? '')();
		const time = document.querySelector('article[data-issue="809"] time');
		expect(time?.textContent).toBe('2 p 04:05:00');
		vi.advanceTimersByTime(1000);
		expect(time?.textContent).toBe('2 p 04:05:01');
	});
});

describe('formatClock', () => {
	it('h:mm:ss under a day, then days and hh:mm:ss', () => {
		expect(formatClock(0)).toBe('0:00:00');
		expect(formatClock(7 * 1000)).toBe('0:00:07');
		expect(formatClock((2 * 3600 + 15 * 60 + 7) * 1000)).toBe('2:15:07');
		expect(formatClock(((2 * 24 + 4) * 3600 + 5 * 60 + 1) * 1000)).toBe('2 p 04:05:01');
		expect(formatClock(-1000)).toBe('0:00:00');
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
		const history: LabelEvent[] = [
			{ kind: 'labeled', label: 'in research', at: '2026-10-01T10:00:00Z' },
			{ kind: 'unlabeled', label: 'in research', at: '2026-10-02T10:00:00Z' },
			{ kind: 'labeled', label: 'ready', at: '2026-10-03T10:00:00Z' },
			{ kind: 'labeled', label: 'in research', at: '2026-10-04T10:00:00Z' }
		];
		expect(labelSince(history, 'in research')).toBe('2026-10-04T10:00:00Z');
	});

	it('is null when the label was never added', () => {
		expect(labelSince([{ kind: 'labeled', label: 'ready', at: 'x' }], 'in process')).toBeNull();
	});
});

const H = (h: number) => `2026-10-01T${String(h).padStart(2, '0')}:00:00Z`;

describe('labelSpanMs', () => {
	it('sums every span the label was on, from added to removed', () => {
		const history: LabelEvent[] = [
			{ kind: 'labeled', label: 'in research', at: H(1) },
			{ kind: 'unlabeled', label: 'in research', at: H(3) },
			{ kind: 'labeled', label: 'in research', at: H(5) },
			{ kind: 'unlabeled', label: 'in research', at: H(6) }
		];
		expect(labelSpanMs(history, 'in research')).toBe(3 * 3600000);
	});

	it('a label still on at close ends its span at the close', () => {
		const history: LabelEvent[] = [
			{ kind: 'labeled', label: 'in process', at: H(2) },
			{ kind: 'closed', at: H(6) }
		];
		expect(labelSpanMs(history, 'in process')).toBe(4 * 3600000);
	});

	it('a span still running does not count, and a label never removed gives null', () => {
		expect(labelSpanMs([{ kind: 'labeled', label: 'in research', at: H(1) }], 'in research')).toBeNull();
		expect(labelSpanMs([{ kind: 'labeled', label: 'ready', at: H(1) }], 'in research')).toBeNull();
	});
});

describe('researched in · built in', () => {
	const spans = (over: Partial<RoadmapIssue>) =>
		new DOMParser()
			.parseFromString(renderBoard([issue({ labels: [], ...over })], GENERATED_AT), 'text/html')
			.querySelector('article[data-issue="809"] .issue-spans')?.textContent ?? null;

	it('a closed card shows both', () => {
		expect(spans({ state: 'closed', stateReason: 'completed', researchMs: 75 * 60000, buildMs: 3 * 3600000 })).toBe(
			'researched in 1 h 15 min · built in 3 h 0 min'
		);
	});

	it('an open card shows only researched in; built in waits for the close', () => {
		expect(spans({ researchMs: 30 * 60000, buildMs: 3600000 })).toBe('researched in 30 min');
	});

	it('a part whose label never ended is left out, and no line at all when neither did', () => {
		expect(spans({ state: 'closed', stateReason: 'completed', researchMs: null, buildMs: 3600000 })).toBe(
			'built in 1 h 0 min'
		);
		expect(spans({ researchMs: null, buildMs: null })).toBeNull();
	});

	it('the fetch step fills both from the label history', async () => {
		const list = [
			{
				number: 809,
				title: 't',
				state: 'closed',
				state_reason: 'completed',
				labels: [],
				body: null,
				closed_at: H(9),
				updated_at: H(9),
				html_url: 'https://github.com/mvox-dev/mvox-app/issues/809'
			}
		];
		const nodes = [
			{ __typename: 'LabeledEvent', createdAt: H(1), label: { name: 'in research' } },
			{ __typename: 'UnlabeledEvent', createdAt: H(2), label: { name: 'in research' } },
			{ __typename: 'LabeledEvent', createdAt: H(4), label: { name: 'in process' } },
			{ __typename: 'ClosedEvent', createdAt: H(9) }
		];
		const issues = {
			pageInfo: { hasNextPage: false, endCursor: null },
			nodes: [{ number: 809, timelineItems: { pageInfo: { hasNextPage: false }, nodes } }]
		};
		const history = { data: { repository: { issues } } };
		const stub = (async (input: RequestInfo | URL) => {
			const body = String(input).endsWith('/graphql') ? history : list;
			return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
		}) as unknown as typeof fetch;
		const [fetched] = await fetchBoard('mvox-dev/mvox-app', 'test-token', stub);
		expect(fetched.researchMs).toBe(3600000);
		expect(fetched.buildMs).toBe(5 * 3600000);
	});

	it('a labeled issue whose GraphQL timeline comes back empty is read again over REST', async () => {
		const list = [
			{
				number: 809,
				title: 't',
				state: 'open',
				labels: [{ name: 'in process' }],
				body: null,
				html_url: 'https://github.com/mvox-dev/mvox-app/issues/809'
			}
		];
		const issues = {
			pageInfo: { hasNextPage: false, endCursor: null },
			nodes: [{ number: 809, timelineItems: { pageInfo: { hasNextPage: false }, nodes: [] } }]
		};
		const events = [{ event: 'labeled', label: { name: 'in process' }, created_at: H(4) }];
		const stub = (async (input: RequestInfo | URL) => {
			const url = String(input);
			const body = url.endsWith('/graphql') ? { data: { repository: { issues } } } : url.includes('/events') ? events : list;
			return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
		}) as unknown as typeof fetch;
		const [fetched] = await fetchBoard('mvox-dev/mvox-app', 'test-token', stub);
		expect(fetched.statusSince).toBe(H(4));
	});
});

describe("an epic's summary sums its sub-issues' times", () => {
	const HOUR = 3600000;
	const sub = (number: number, state: 'open' | 'closed', over: Partial<RoadmapIssue> = {}): RoadmapIssue =>
		issue({ number, state, labels: [], statusSince: null, ...over });
	const summary = (epic: RoadmapIssue) =>
		new DOMParser()
			.parseFromString(renderBoard([epic], GENERATED_AT), 'text/html')
			.querySelector(`article[data-issue="${epic.number}"] summary`)?.textContent ?? null;

	it('a finished epic adds research and build time over all its sub-issues, nested ones included', () => {
		const nested = sub(902, 'closed', {
			issueType: 'Epic',
			subIssues: [sub(903, 'closed', { researchMs: HOUR, buildMs: 2 * HOUR })]
		});
		const epic = sub(900, 'closed', {
			issueType: 'Epic',
			subIssues: [sub(901, 'closed', { researchMs: 30 * 60000, buildMs: HOUR }), nested]
		});
		expect(summary(epic)).toBe('2 tehtud alamülesannet · uuritud 1 h 30 min · ehitatud 3 h 0 min');
	});

	it('an active epic sums too; an open sub-issue adds its research but not a build time yet', () => {
		const epic = sub(900, 'open', {
			issueType: 'Epic',
			subIssues: [sub(901, 'closed', { buildMs: HOUR }), sub(902, 'open', { researchMs: HOUR, buildMs: HOUR })]
		});
		expect(summary(epic)).toBe('2 alamülesannet, 1 pooleli · uuritud 1 h 0 min · ehitatud 1 h 0 min');
	});

	it('no times, no suffix', () => {
		const epic = sub(900, 'closed', { issueType: 'Epic', subIssues: [sub(901, 'closed')] });
		expect(summary(epic)).toBe('1 tehtud alamülesanne');
	});
});

describe('in human review', () => {
	it('an open card in human review ticks from that label, ahead of in process', () => {
		const labels = [
			{ name: 'in process', color: null },
			{ name: 'in human review', color: null }
		];
		const time = corner(renderBoard([issue({ labels })], GENERATED_AT));
		expect(time?.getAttribute('title')).toMatch(/^in human review since /);
	});

	it('a closed card adds "human review X", and an epic sums it as "ülevaadatud"', () => {
		const sub = issue({ number: 901, state: 'closed', stateReason: 'completed', labels: [], reviewMs: 2 * 3600000 });
		const html = renderBoard(
			[issue({ number: 900, state: 'closed', stateReason: 'completed', labels: [], issueType: 'Epic', subIssues: [sub] })],
			GENERATED_AT
		);
		const doc = new DOMParser().parseFromString(html, 'text/html');
		expect(doc.querySelector('article[data-issue="901"] .issue-spans')?.textContent).toBe('human review 2 h 0 min');
		expect(doc.querySelector('article[data-issue="900"] summary')?.textContent).toBe(
			'1 tehtud alamülesanne · ülevaadatud 2 h 0 min'
		);
	});
});
