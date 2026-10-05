// @vitest-environment happy-dom
// A closed issue shows no motion labels (ready, in process, prepped, in research, blocked); kind
// labels stay. Matching is exact and case-sensitive, and the staleness warning must not change.

// (*MVOX:Tallis*)
import { describe, expect, it } from 'vitest';
import { isMotionLabel, renderBoard, type RoadmapIssue, type RoadmapLabel } from './render';

const GENERATED_AT = '2026-09-14T09:00:00.000Z';

/** The five motion labels — where work sits in the queue. */
const READY: RoadmapLabel = { name: 'ready', color: '0e8a16' };
const IN_PROCESS: RoadmapLabel = { name: 'in process', color: '95ea29' };
const PREPPED: RoadmapLabel = { name: 'prepped', color: 'c5def5' };
const IN_RESEARCH: RoadmapLabel = { name: 'in research', color: 'ecde62' };
const BLOCKED: RoadmapLabel = { name: 'blocked', color: 'b60205' };
const MOTION: RoadmapLabel[] = [READY, IN_PROCESS, PREPPED, IN_RESEARCH, BLOCKED];

/** Kind labels — what the work was. These stay on closed issues. */
const TASK: RoadmapLabel = { name: 'task', color: '1d76db' };
const EPIC: RoadmapLabel = { name: 'epic', color: '6f42c1' };
const BUG: RoadmapLabel = { name: 'bug', color: 'd73a4a' };
const ENHANCEMENT: RoadmapLabel = { name: 'enhancement', color: 'a2eeef' };

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

function entry(doc: Document, number: number): Element {
	const el = doc.querySelector(`[data-issue="${number}"]`);
	expect(el, `no [data-issue="${number}"] element rendered`).not.toBeNull();
	return el as Element;
}

/** One issue's OWN chips: its .issue-labels span precedes any sub-issue's, so take the first. */
function ownChips(doc: Document, number: number): string[] {
	const labels = entry(doc, number).querySelector('.issue-labels');
	return Array.from(labels?.querySelectorAll('.label') ?? []).map(
		(c) => c.textContent?.trim() ?? ''
	);
}

/** One board read by both the chip tests and the staleness fence; #401 is the one violator. */
function boardFixture(): RoadmapIssue[] {
	return [
		issue({
			number: 400,
			title: '[EPIC] Parent epic, open and groomed',
			labels: [EPIC, READY],
			subIssues: [
				issue({ number: 401, title: 'Groomed and idle', labels: [TASK, READY] }),
				issue({
					number: 402,
					title: 'Finished child, labels never cleared',
					state: 'closed',
					stateReason: 'completed',
					closedAt: '2026-09-10T00:00:00Z',
					labels: [TASK, READY, IN_PROCESS]
				})
			]
		}),
		issue({
			number: 403,
			title: 'Finished top-level, every motion label still on',
			state: 'closed',
			stateReason: 'completed',
			closedAt: '2026-09-08T00:00:00Z',
			labels: [TASK, READY, IN_PROCESS, PREPPED, IN_RESEARCH, BLOCKED, BUG]
		})
	];
}

describe('#354 — isMotionLabel is the exported instrument', () => {
	it('exactly the five motion names are motion — kind names, neighbours and case variants are not', () => {
		const names = [
			// The five motion labels (issue #354's own list, verbatim).
			'ready',
			'in process',
			'prepped',
			'in research',
			'blocked',
			// Kind labels stay.
			'task',
			'epic',
			'bug',
			'enhancement',
			// Near-misses: `blocks research` is a staleness suppressor (#340),
			// NOT a motion label — five names, not a family resemblance.
			'blocks research',
			'wontfix',
			'',
			// Case decision, pinned: EXACT match, case-sensitive — the
			// ACTIVE_TIER_LABELS / hasLabel idiom of render.ts, nothing folds case.
			'Ready',
			'READY',
			'In Process',
			'BLOCKED'
		];
		const verdicts = Object.fromEntries(names.map((name) => [name, isMotionLabel(name)]));
		expect(verdicts).toEqual({
			ready: true,
			'in process': true,
			prepped: true,
			'in research': true,
			blocked: true,
			task: false,
			epic: false,
			bug: false,
			enhancement: false,
			'blocks research': false,
			wontfix: false,
			'': false,
			Ready: false,
			READY: false,
			'In Process': false,
			BLOCKED: false
		});
	});

	it('is pure: same name, same verdict, no state between calls', () => {
		expect(isMotionLabel('ready')).toBe(isMotionLabel('ready'));
		expect(isMotionLabel('task')).toBe(isMotionLabel('task'));
	});
});

describe('#354 — renderBoard: a closed issue displays no motion labels', () => {
	it('top-level closed issue wearing all five motion labels shows kind chips ONLY, in label order', () => {
		const doc = parse(renderBoard(boardFixture(), GENERATED_AT));
		expect(ownChips(doc, 403)).toEqual(['task', 'bug']);
	});

	it('closed child nested under an open epic shows kind chips ONLY — same rule on the recursive path', () => {
		const doc = parse(renderBoard(boardFixture(), GENERATED_AT));
		// #402 stays ON the board under its epic (showing closed children is
		// right — the defect is only the labels) …
		expect(entry(doc, 402).getAttribute('data-state')).toBe('closed');
		// … but its `ready` / `in process` chips are gone; `task` stays.
		expect(ownChips(doc, 402)).toEqual(['task']);
	});

	it('each of the five motion names, alone, vanishes from a closed issue', () => {
		for (const motion of MOTION) {
			const doc = parse(
				renderBoard(
					[
						issue({
							number: 77,
							title: `Closed with ${motion.name}`,
							state: 'closed',
							stateReason: 'completed',
							closedAt: '2026-09-01T00:00:00Z',
							labels: [motion, TASK]
						})
					],
					GENERATED_AT
				)
			);
			expect(ownChips(doc, 77), `"${motion.name}" must not render on a closed issue`).toEqual([
				'task'
			]);
		}
	});

	it('open issues are unchanged, labels and all — identical label sets keep every chip', () => {
		const doc = parse(renderBoard(boardFixture(), GENERATED_AT));
		expect(ownChips(doc, 401)).toEqual(['task', 'ready']);
		expect(ownChips(doc, 400)).toEqual(['epic', 'ready']);
		// The exhaustive open control: the SAME seven labels #403 wears, on an
		// open issue, all render.
		const open = parse(
			renderBoard(
				[
					issue({
						number: 78,
						title: 'Open with every label #403 has',
						labels: [TASK, READY, IN_PROCESS, PREPPED, IN_RESEARCH, BLOCKED, BUG]
					})
				],
				GENERATED_AT
			)
		);
		expect(ownChips(open, 78)).toEqual([
			'task',
			'ready',
			'in process',
			'prepped',
			'in research',
			'blocked',
			'bug'
		]);
	});

	it('surviving kind chips on a closed issue keep their own colours — filtered, not restyled', () => {
		const doc = parse(renderBoard(boardFixture(), GENERATED_AT));
		const task = Array.from(entry(doc, 403).querySelectorAll('.label')).find(
			(c) => c.textContent?.trim() === 'task'
		);
		expect(task, 'no task chip on #403').toBeDefined();
		expect(task?.getAttribute('style') ?? '').toMatch(/background(?:-color)?:\s*#1d76db/i);
	});

	it('a not_planned close is just as closed — enhancement stays, motion goes', () => {
		const doc = parse(
			renderBoard(
				[
					issue({
						number: 79,
						title: 'Dropped idea',
						state: 'closed',
						stateReason: 'not_planned',
						closedAt: '2026-08-20T00:00:00Z',
						labels: [ENHANCEMENT, READY, BLOCKED]
					})
				],
				GENERATED_AT
			)
		);
		expect(ownChips(doc, 79)).toEqual(['enhancement']);
	});
});

describe('#354 — fence: the staleness warning names exactly the same issues, same board', () => {
	// stalenessViolators reads open issues only, so the chip rule must not change it.
	const warningEl = (doc: Document): Element | null => doc.querySelector('.staleness-warning');
	const warnedNumbers = (doc: Document): string[] =>
		(warningEl(doc)?.textContent ?? '').match(/#\d+/g) ?? [];

	it('the shared board fixture warns about #401 and ONLY #401 — closed motion labels neither add violators nor suppress', () => {
		// A closed `in research` (#403) does not switch the check off; closed #402 never violates.
		const doc = parse(renderBoard(boardFixture(), GENERATED_AT));
		expect(warnedNumbers(doc)).toEqual(['#401']);
	});

	it('with the open violator satisfied, the same closed issues produce NO warning — closed ready never becomes a violator', () => {
		const board = boardFixture();
		// Satisfy #401 (`in process` joins task+ready) — the board's only open
		// violator goes quiet; the closed motion-label wearers must stay silent.
		board[0].subIssues![0] = issue({
			number: 401,
			title: 'Groomed and picked up',
			labels: [TASK, READY, IN_PROCESS]
		});
		const doc = parse(renderBoard(board, GENERATED_AT));
		expect(warningEl(doc)).toBeNull();
	});
});
