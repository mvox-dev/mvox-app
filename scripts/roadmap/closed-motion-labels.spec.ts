// @vitest-environment happy-dom
/**
 * #354 RED — a closed issue displays no motion labels.
 *
 * The board renders closed sub-issues inside Pooleli under their open epic
 * (correct — that a child is done is the useful fact about the epic), but each
 * still wears its motion chips: a green `ready` among work that genuinely is
 * outstanding. The house pattern closes issues WITH `ready` still on them
 * (~250 closed issues wear it), so relabelling is a forever-sweep; the fix is
 * ONE render-time rule instead:
 *
 *   A closed issue does not display motion labels — `ready`, `in process`,
 *   `prepped`, `in research`, `blocked`. Motion describes where something sits
 *   in the queue; a closed issue is not in the queue. Kind labels (`task`,
 *   `epic`, `bug`, `enhancement`) still say something true about what it was,
 *   and stay. Open issues are untouched, labels and all.
 *
 * Instrument (guard-instrument law): the rule is an exported PURE predicate
 * `isMotionLabel(name)` on render.ts — every membership decision pinned on it
 * with inline string fixtures and a FULL-shape toEqual verdict record
 * (objectContaining shipped 4 real bugs in this repo — never used here).
 * Matching is EXACT and case-sensitive, the same idiom as render.ts's
 * ACTIVE_TIER_LABELS / hasLabel: the live GitHub labels are lowercase, and no
 * other label comparison in this file folds case — a `Ready` GitHub-side would
 * neither float (#310) nor suppress (#340), so it must not vanish here either.
 * Same rename caveat as active-float.spec.ts: a fixture cannot see a
 * GitHub-side label rename.
 *
 * Integration: renderBoard IS the page — the CLI (render.ts main) writes its
 * output verbatim to roadmap/index.html — so the DOM assertions below read the
 * rule off the real deployed artefact's producer, not a helper in isolation.
 * Wire-shape normalization (REST labels → chips) is already pinned end-to-end
 * by board.spec.ts (#307/#310); the filter runs after that on the same names.
 *
 * Fence (issue #354, verbatim): "Do not touch the staleness predicate." It
 * reads open issues only, so the warning must name EXACTLY the same issues
 * before and after this change, given the same board — including the
 * staleness-warning.spec.ts precedent that a stale `in research` on a CLOSED
 * issue does not suppress the check.
 *
 * Label strings/colours are the REAL ones (gh api repos/mvox-dev/mvox-app/labels
 * via fixtures/live-shaped.json; enhancement is GitHub's stock a2eeef).
 *
 * (*MVOX:Tallis*)
 */
import { describe, expect, it } from 'vitest';
import { renderBoard, type RoadmapIssue, type RoadmapLabel } from './render';

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

/**
 * The chip names of one issue's OWN labels, in render order. The issue's own
 * `.issue-labels` span precedes any nested sub-issue's in tree order, so the
 * first match is the right one — a child's chips never bleed into its parent's
 * reading.
 */
function ownChips(doc: Document, number: number): string[] {
	const labels = entry(doc, number).querySelector('.issue-labels');
	return Array.from(labels?.querySelectorAll('.label') ?? []).map(
		(c) => c.textContent?.trim() ?? ''
	);
}

/**
 * THE board fixture — one board, read twice: once by the chip assertions
 * (which must flip under #354) and once by the staleness fence (which must
 * not). #400 is the open epic; #401 its open groomed-and-idle child (the one
 * genuine staleness violator); #402 its closed child still wearing motion
 * labels; #403 a top-level closed issue wearing ALL FIVE motion labels plus a
 * kind label — including `in research`, the label that per the
 * staleness-warning.spec.ts precedent must NOT suppress the warning from a
 * closed issue.
 */
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
	// Dynamic import so THIS describe fails on the missing export while the
	// renderBoard DOM specs below still fail on their own merits, not on an
	// import-binding error poisoning the whole file.
	async function instrument(): Promise<(name: string) => boolean> {
		const render = (await import('./render')) as Record<string, unknown>;
		expect(
			typeof render.isMotionLabel,
			'render.ts must export the pure predicate isMotionLabel(name: string): boolean'
		).toBe('function');
		return render.isMotionLabel as (name: string) => boolean;
	}

	it('exactly the five motion names are motion — kind names, neighbours and case variants are not', async () => {
		const isMotionLabel = await instrument();
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

	it('is pure: same name, same verdict, no state between calls', async () => {
		const isMotionLabel = await instrument();
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
	// These are green TODAY and must stay green after the chip rule lands:
	// stalenessViolators reads flattenOpenIssues, and #354 must not touch it.
	const warningEl = (doc: Document): Element | null => doc.querySelector('.staleness-warning');
	const warnedNumbers = (doc: Document): string[] =>
		(warningEl(doc)?.textContent ?? '').match(/#\d+/g) ?? [];

	it('the shared board fixture warns about #401 and ONLY #401 — closed motion labels neither add violators nor suppress', () => {
		// #403 (closed) carries `in research`: per the staleness-warning.spec.ts
		// precedent it does NOT switch the check off. #402 (closed) carries
		// task+ready: never a violator. #400 (open epic) carries ready without
		// task: never fires. #401 is the one genuine violator — before AND after.
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
