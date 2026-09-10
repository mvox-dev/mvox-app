// @vitest-environment happy-dom
/**
 * #310 RED — roadmap board: active issues float to the top of the open list.
 *
 * The open group gains a primary sort key: issues labelled `in process`
 * first, then `in research`, then everything else — issue number ascending
 * within each tier (#307's rule, per tier). An issue carrying BOTH labels
 * sorts as in-process. The closed group does not move: closedAt-desc only,
 * a stale activity label on a closed issue must not reorder finished work.
 * Sub-issues inherit the tiering through the same shared boardOrder — no
 * second code path. And NO new heading or divider appears between tiers:
 * the chips already say which state a card is in, and a second Estonian
 * heading under Pooleli would collide with it.
 *
 * The label strings here are the REAL ones (live palette, gh api
 * 2026-09-10): `in process` #95ea29, `in research` #ecde62. Per Gama's
 * amendment on #310, there is deliberately NO pin-the-label-strings test —
 * a fixture cannot see a GitHub-side rename (the fixture keeps the old
 * string and stays green through exactly that failure). What a test here
 * CAN catch is a comparator that is wrong or unstable — that is what these
 * pin. The rename coupling is named in a plain-words comment at the sort
 * site in render.ts instead; review verifies the comment.
 *
 * (*MVOX:Tallis*)
 */
import { describe, expect, it } from 'vitest';
import { renderBoard, type RoadmapIssue, type RoadmapLabel } from './render';

const GENERATED_AT = '2026-09-10T12:34:56Z';

/** Live palette (gh api repos/mvox-dev/mvox-app/labels, 2026-09-10). */
const IN_PROCESS: RoadmapLabel = { name: 'in process', color: '95ea29' };
const IN_RESEARCH: RoadmapLabel = { name: 'in research', color: 'ecde62' };
const TASK: RoadmapLabel = { name: 'task', color: '1d76db' };

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

function issuePos(html: string, n: number): number {
	const i = html.indexOf(`data-issue="${n}"`);
	expect(i, `data-issue="${n}" missing from the page`).toBeGreaterThan(-1);
	return i;
}

/** Assert the page renders these issues in exactly this order. */
function expectOrder(html: string, numbers: number[]): void {
	const positions = numbers.map((n) => issuePos(html, n));
	expect(
		[...positions].sort((a, b) => a - b),
		`expected render order ${numbers.join(', ')}`
	).toEqual(positions);
}

describe('renderBoard — open group: active issues float to the top (#310)', () => {
	it('tiers the open group: in process, then in research, then the rest — number ascending inside each tier', () => {
		// Input order deliberately scrambled across all three tiers.
		const board = [
			issue({ number: 12, title: 'Plain task', labels: [TASK] }),
			issue({ number: 7, title: 'Research low', labels: [TASK, IN_RESEARCH] }),
			issue({ number: 20, title: 'Process high', labels: [TASK, IN_PROCESS] }),
			issue({ number: 5, title: 'Process low', labels: [IN_PROCESS] }),
			issue({ number: 15, title: 'Research high', labels: [IN_RESEARCH] }),
			issue({ number: 3, title: 'Plain bug', labels: [] })
		];
		const html = renderBoard(board, GENERATED_AT);
		expectOrder(html, [5, 20, 7, 15, 3, 12]);
	});

	it('an issue carrying BOTH labels sorts as in-process — pinned, not build-to-build luck', () => {
		// If #10 fell into the research tier instead, the order would be
		// 8, 6, 10 — so #6 (in research, lower number) is the tripwire.
		const board = [
			issue({ number: 6, title: 'Research only', labels: [IN_RESEARCH] }),
			issue({ number: 10, title: 'Both labels', labels: [IN_PROCESS, IN_RESEARCH] }),
			issue({ number: 8, title: 'Process only', labels: [IN_PROCESS] })
		];
		const html = renderBoard(board, GENERATED_AT);
		expectOrder(html, [8, 10, 6]);
	});

	it('tiering does not disturb #307 number-ascending inside the untiered rest', () => {
		const board = [
			issue({ number: 9, title: 'Rest high' }),
			issue({ number: 2, title: 'Rest low' }),
			issue({ number: 11, title: 'Active', labels: [IN_PROCESS] })
		];
		const html = renderBoard(board, GENERATED_AT);
		expectOrder(html, [11, 2, 9]);
	});
});

describe('renderBoard — the closed group never moves (#310)', () => {
	it('a stale `in process` label on a closed issue does NOT reorder finished work — closedAt-desc only', () => {
		// #44 closed a month before #50 but still carries `in process` (label
		// contract says it is cleared at merge — this is the forgotten case).
		// If the float applied, #44 would jump above #50. It must not.
		const board = [
			issue({
				number: 44,
				title: 'Done long ago, label never cleared',
				state: 'closed',
				stateReason: 'completed',
				closedAt: '2026-08-01T00:00:00Z',
				labels: [TASK, IN_PROCESS]
			}),
			issue({
				number: 50,
				title: 'Done recently, clean',
				state: 'closed',
				stateReason: 'completed',
				closedAt: '2026-09-09T00:00:00Z',
				labels: [TASK]
			}),
			issue({
				number: 47,
				title: 'Done in between, stale research label',
				state: 'closed',
				stateReason: 'completed',
				closedAt: '2026-08-20T00:00:00Z',
				labels: [IN_RESEARCH]
			})
		];
		const html = renderBoard(board, GENERATED_AT);
		expectOrder(html, [50, 47, 44]);
	});
});

describe('renderBoard — sub-issues inherit the float (#310)', () => {
	// Children scrambled on purpose. boardOrder is the single ordering
	// function for both levels (#307) — if making this pass needs a second
	// code path, that is a finding to report, not accommodate.
	const epic = issue({
		number: 289,
		title: '[EPIC] Library lending 1.0',
		labels: [{ name: 'epic', color: '6f42c1' }],
		subIssues: [
			issue({ number: 297, title: 'Child plain', labels: [TASK] }),
			issue({ number: 293, title: 'Child researching', labels: [IN_RESEARCH] }),
			issue({
				number: 292,
				title: 'Child done, stale process label',
				state: 'closed',
				stateReason: 'completed',
				closedAt: '2026-08-01T00:00:00Z',
				labels: [IN_PROCESS]
			}),
			issue({
				number: 294,
				title: 'Child done recently',
				state: 'closed',
				stateReason: 'completed',
				closedAt: '2026-09-05T00:00:00Z',
				labels: [TASK]
			}),
			issue({ number: 295, title: 'Child building', labels: [IN_PROCESS] })
		]
	});

	it('orders children like the top level: process, research, rest — then closed by closedAt-desc, stale labels ignored', () => {
		const html = renderBoard([epic], GENERATED_AT);
		expectOrder(html, [295, 293, 297, 294, 292]);
	});
});

describe('renderBoard — no new heading, no divider between tiers (#310)', () => {
	// Sort only. The in process / in research chips already say which state a
	// card is in; a second Estonian heading under Pooleli ("in progress")
	// would collide with it rather than clarify.
	it('the open group gains no heading or divider beyond its own Pooleli h2', () => {
		const board = [
			issue({ number: 5, title: 'Building', labels: [IN_PROCESS] }),
			issue({ number: 7, title: 'Researching', labels: [IN_RESEARCH] }),
			issue({ number: 12, title: 'Waiting', labels: [TASK] }),
			issue({
				number: 44,
				title: 'Done',
				state: 'closed',
				stateReason: 'completed',
				closedAt: '2026-09-01T00:00:00Z'
			})
		];
		const doc = parse(renderBoard(board, GENERATED_AT));
		const main = doc.querySelector('main');
		expect(main).not.toBeNull();
		const headings = Array.from(
			(main as Element).querySelectorAll('h1, h2, h3, h4, h5, h6')
		).map((h) => h.textContent?.trim());
		expect(headings).toEqual(['Pooleli', 'Tehtud']);
		expect((main as Element).querySelectorAll('hr')).toHaveLength(0);
	});
});
