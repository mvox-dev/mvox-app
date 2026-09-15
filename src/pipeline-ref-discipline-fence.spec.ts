// #381 acceptance additions (Gama, review round 2026-09-15) — both directions
// of the ref-discipline HALT fence, pinned structurally against the real
// classifier in pipeline-ref-discipline-fence.ts (not against prose a test
// cannot execute). See that file's header for the full rationale.
import { describe, expect, it } from 'vitest';
import {
	classifyRefState,
	HALT_REASON_FOREIGN_COMMIT,
	HALT_REASON_MAIN,
	HALT_REASON_TIP,
	HALT_REASON_WRONG_BRANCH,
	type RefState
} from './pipeline-ref-discipline-fence';

/** The everyday state: on the right branch, nothing anomalous. */
function healthyRun(overrides: Partial<RefState> = {}): RefState {
	return {
		currentBranch: 'fix/381-fix-agent-main-halt',
		storyBranch: 'fix/381-fix-agent-main-halt',
		thisTasksWorkOnMain: false,
		branchMissingOrWrongTip: false,
		foreignCommitOnBranch: false,
		...overrides
	};
}

describe('#381 acceptance: the fence stays SILENT on the everyday healthy-run state', () => {
	it('on the story branch, main carrying unrelated (other tasks\') work, branch carrying earlier pipeline phases\' commits — no halt', () => {
		// "main carrying unrelated work" and "branch carrying other phases'
		// commits" are the everyday state, not anomalies — thisTasksWorkOnMain
		// and foreignCommitOnBranch are specifically false, not just unset.
		const verdict = classifyRefState(healthyRun());
		expect(verdict).toEqual({ halt: false });
	});

	it('a trigger nobody has watched not-fire is untested (Gama) — confirm every anomaly flag independently toggles the SAME healthy baseline to halt', () => {
		// Each anomaly is checked in isolation against the identical baseline —
		// proves the healthy fixture isn't silent merely because some OTHER
		// flag happens to mask it.
		expect(classifyRefState(healthyRun({ thisTasksWorkOnMain: true })).halt).toBe(true);
		expect(classifyRefState(healthyRun({ branchMissingOrWrongTip: true })).halt).toBe(true);
		expect(classifyRefState(healthyRun({ foreignCommitOnBranch: true })).halt).toBe(true);
		expect(classifyRefState({ ...healthyRun(), currentBranch: 'main' }).halt).toBe(true);
	});
});

describe('#381 acceptance: the fence FIRES on the #357 shape', () => {
	it('a fix agent finds itself on main instead of the story branch — halts, naming the branch anomaly', () => {
		// The #357 incident, precisely: a review-fix agent's commit landed on
		// local main, not the story branch it was dispatched onto.
		const verdict = classifyRefState({
			currentBranch: 'main',
			storyBranch: 'fix/357-some-story-branch',
			thisTasksWorkOnMain: true,
			branchMissingOrWrongTip: false,
			foreignCommitOnBranch: false
		});
		expect(verdict).toEqual({ halt: true, reason: HALT_REASON_WRONG_BRANCH });
	});

	it('on the right branch, but THIS task\'s work is already committed on main — halts on the after-the-fact net', () => {
		const verdict = classifyRefState(healthyRun({ thisTasksWorkOnMain: true }));
		expect(verdict).toEqual({ halt: true, reason: HALT_REASON_MAIN });
	});

	it('the story branch is missing / not at the expected tip — halts', () => {
		const verdict = classifyRefState(healthyRun({ branchMissingOrWrongTip: true }));
		expect(verdict).toEqual({ halt: true, reason: HALT_REASON_TIP });
	});

	it('the branch carries a commit from neither this agent nor an earlier pipeline phase — halts', () => {
		const verdict = classifyRefState(healthyRun({ foreignCommitOnBranch: true }));
		expect(verdict).toEqual({ halt: true, reason: HALT_REASON_FOREIGN_COMMIT });
	});
});

describe('#381 acceptance: EARLIEST CHECK WINS (Gama) — the pre-commit branch check is PRIMARY', () => {
	it('when the branch is wrong AND an after-the-fact anomaly also holds, the branch check wins — it is answerable first, pre-commit', () => {
		const verdict = classifyRefState({
			currentBranch: 'main',
			storyBranch: 'fix/381-fix-agent-main-halt',
			thisTasksWorkOnMain: true,
			branchMissingOrWrongTip: true,
			foreignCommitOnBranch: true
		});
		expect(verdict).toEqual({ halt: true, reason: HALT_REASON_WRONG_BRANCH });
	});

	it('once the branch is correct, the three after-the-fact anomalies are checked in the SAME order the fence prose states them', () => {
		// main-anomaly checked before tip-anomaly before foreign-commit-anomaly,
		// each independently of the others being simultaneously true.
		expect(
			classifyRefState(healthyRun({ thisTasksWorkOnMain: true, branchMissingOrWrongTip: true, foreignCommitOnBranch: true }))
		).toEqual({ halt: true, reason: HALT_REASON_MAIN });
		expect(
			classifyRefState(healthyRun({ branchMissingOrWrongTip: true, foreignCommitOnBranch: true }))
		).toEqual({ halt: true, reason: HALT_REASON_TIP });
	});
});

// (*MVOX:Byrd* — #381 acceptance additions)
