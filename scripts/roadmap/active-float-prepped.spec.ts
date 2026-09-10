// @vitest-environment happy-dom
/**
 * #315 RED — roadmap board: `prepped` joins the active float, BETWEEN
 * `in process` and `in research`.
 *
 * The commission is one array element: ACTIVE_TIER_LABELS becomes
 * ['in process', 'prepped', 'in research']. The float reads the lifecycle
 * backwards — nearest-to-done first — so the top of the board answers
 * "what is closest to landing". The placement IS the commission, so the
 * placement test here must fail if anyone reorders the list.
 *
 * Multi-label precedence falls out of findIndex over the ordered list
 * (in process beats prepped beats in research) — pinned anyway, so a
 * rewrite of the comparator cannot silently change it. The closed group
 * stays label-blind: a stale `prepped` on finished work must not reorder
 * it. Sub-issues inherit everything through the one shared boardOrder.
 *
 * The label string is the REAL one (live palette, gh api 2026-09-10):
 * `prepped` #c5def5. Per #310's standing amendment there is deliberately
 * NO pin-the-label-strings test — a fixture cannot see a GitHub-side
 * rename (and `prepped` was born `researched` and renamed inside two
 * minutes). The rename coupling lives in the plain-words comment at the
 * sort site in render.ts, which must name all three strings; review
 * verifies the comment.
 *
 * (*MVOX:Tallis*)
 */
import { describe, expect, it } from 'vitest';
import { renderBoard, type RoadmapIssue, type RoadmapLabel } from './render';

const GENERATED_AT = '2026-09-10T12:34:56Z';

/** Live palette (gh api repos/mvox-dev/mvox-app/labels, 2026-09-10). */
const IN_PROCESS: RoadmapLabel = { name: 'in process', color: '95ea29' };
const PREPPED: RoadmapLabel = { name: 'prepped', color: 'c5def5' };
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

describe('renderBoard — open group: three tiers (#315)', () => {
	it('tiers the open group: in process, prepped, in research, then the rest — number ascending inside each tier', () => {
		// #310's tier case extended to three tiers. Input order deliberately
		// scrambled across all four groups, two issues per group so the
		// number-ascending rule is exercised inside every tier.
		const board = [
			issue({ number: 12, title: 'Plain task', labels: [TASK] }),
			issue({ number: 7, title: 'Research low', labels: [TASK, IN_RESEARCH] }),
			issue({ number: 18, title: 'Prepped high', labels: [TASK, PREPPED] }),
			issue({ number: 20, title: 'Process high', labels: [TASK, IN_PROCESS] }),
			issue({ number: 5, title: 'Process low', labels: [IN_PROCESS] }),
			issue({ number: 4, title: 'Prepped low', labels: [PREPPED] }),
			issue({ number: 15, title: 'Research high', labels: [IN_RESEARCH] }),
			issue({ number: 3, title: 'Plain bug', labels: [] })
		];
		const html = renderBoard(board, GENERATED_AT);
		expectOrder(html, [5, 20, 4, 18, 7, 15, 3, 12]);
	});

	it('PLACEMENT: prepped sorts BETWEEN in process and in research — fails under any reordering of the tier list', () => {
		// One issue per tier plus one unlabelled. Every wrong permutation of
		// the three-element list produces a different render order:
		//   prepped first        -> 4, 9, 2, 1
		//   prepped last         -> 9, 2, 4, 1
		//   research before process -> 2, 4, 9, 1
		// Only ['in process', 'prepped', 'in research'] yields 9, 4, 2, 1.
		const board = [
			issue({ number: 1, title: 'Waiting', labels: [TASK] }),
			issue({ number: 2, title: 'Being researched', labels: [IN_RESEARCH] }),
			issue({ number: 4, title: 'Prepped, ready to build', labels: [PREPPED] }),
			issue({ number: 9, title: 'Being built', labels: [IN_PROCESS] })
		];
		const html = renderBoard(board, GENERATED_AT);
		expectOrder(html, [9, 4, 2, 1]);
	});
});

describe('renderBoard — multi-label precedence over three tiers (#315)', () => {
	it('prepped alongside in process sorts as in-process — the higher tier wins', () => {
		// If #10 fell into the prepped tier the order would be 8, 6, 10, 3;
		// if prepped issues fell out of the float entirely (today's code),
		// #6 would sink below #3 — both wrong orders differ from the pin.
		const board = [
			issue({ number: 3, title: 'Research only', labels: [IN_RESEARCH] }),
			issue({ number: 6, title: 'Prepped only', labels: [PREPPED] }),
			issue({ number: 10, title: 'Prepped and in process', labels: [PREPPED, IN_PROCESS] }),
			issue({ number: 8, title: 'Process only', labels: [IN_PROCESS] })
		];
		const html = renderBoard(board, GENERATED_AT);
		expectOrder(html, [8, 10, 6, 3]);
	});

	it('prepped alongside in research sorts as prepped — the higher tier wins', () => {
		// If #10 fell into the research tier the order would be 8, 6, 10.
		const board = [
			issue({ number: 6, title: 'Research only', labels: [IN_RESEARCH] }),
			issue({ number: 10, title: 'Prepped and in research', labels: [PREPPED, IN_RESEARCH] }),
			issue({ number: 8, title: 'Prepped only', labels: [PREPPED] })
		];
		const html = renderBoard(board, GENERATED_AT);
		expectOrder(html, [8, 10, 6]);
	});
});

describe('renderBoard — the closed group never moves, prepped included (#315)', () => {
	it('a stale `prepped` label on a closed issue does NOT reorder finished work — closedAt-desc only', () => {
		// Same forgotten-label shape as #310's case: #44 closed long ago with
		// `prepped` never cleared. If the float applied to closed issues it
		// would jump above #50. It must not.
		const board = [
			issue({
				number: 44,
				title: 'Done long ago, prepped label never cleared',
				state: 'closed',
				stateReason: 'completed',
				closedAt: '2026-08-01T00:00:00Z',
				labels: [TASK, PREPPED]
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
				title: 'Done in between, stale process label',
				state: 'closed',
				stateReason: 'completed',
				closedAt: '2026-08-20T00:00:00Z',
				labels: [IN_PROCESS]
			})
		];
		const html = renderBoard(board, GENERATED_AT);
		expectOrder(html, [50, 47, 44]);
	});
});

describe('renderBoard — sub-issues inherit the three-tier float (#315)', () => {
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
			issue({ number: 296, title: 'Child prepped', labels: [PREPPED] }),
			issue({
				number: 292,
				title: 'Child done, stale prepped label',
				state: 'closed',
				stateReason: 'completed',
				closedAt: '2026-08-01T00:00:00Z',
				labels: [PREPPED]
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

	it('orders children like the top level: process, prepped, research, rest — then closed by closedAt-desc, stale labels ignored', () => {
		const html = renderBoard([epic], GENERATED_AT);
		expectOrder(html, [295, 296, 293, 297, 294, 292]);
	});
});
