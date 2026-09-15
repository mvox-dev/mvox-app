// #381 acceptance additions (Gama, review round 2026-09-15) on the ref-discipline
// HALT fence baked into .claude/workflows/tdd-slice-pipeline.js's RED / GREEN /
// GREEN-FIX / FIX prompts.
//
// The fence text is prompt PROSE — an agent interprets it, nothing executes it.
// A raw-text pin (pipeline-ref-discipline.spec.ts) can confirm the WORDS are
// present, but a trigger nobody has watched fire — or not-fire — is untested
// (Gama's framing): wording that reads true on every healthy run gets
// overridden by an agent that reasons around it, and an overridden fence is
// worse than none, because it trains the override so the one TRUE firing
// looks like all the others.
//
// This module is the single source of truth the prose paraphrases: the exact
// anomaly-reason phrases (re-used verbatim inside the live template's fence
// text and pinned there by pipeline-ref-discipline.spec.ts's HALT_PINS,
// imported from here rather than duplicated) plus a pure classifier that
// decides HALT/ok from a state descriptor — driven by two fixtures in
// refDisciplineFence.spec.ts: the everyday healthy run (silent) and the #357
// shape (fires). Both run against this REAL instrument, not against prose a
// test cannot execute.
//
// EARLIEST CHECK WINS (Gama): the pre-commit branch check is the PRIMARY
// gate — "am I on the story branch" is answerable BEFORE a commit exists, and
// pre-commit state cannot be narrated around because there is nothing yet to
// narrate. The three after-the-fact anomalies (#357's shape and its
// siblings) are the SECONDARY net, checked only once the primary gate has
// already passed. `classifyRefState`'s check order mirrors that, and is
// itself pinned by the ordering test in the spec.

export interface RefState {
	/** `git rev-parse --abbrev-ref HEAD`, read BEFORE staging a commit. */
	currentBranch: string;
	/** The story branch this task's commits must land on (`task.branch`). */
	storyBranch: string;
	/** THIS task's own work is already present as a commit on main. */
	thisTasksWorkOnMain: boolean;
	/** The story branch is missing, or not at the tip the agent's brief describes. */
	branchMissingOrWrongTip: boolean;
	/** The branch carries a commit from neither this agent nor an earlier pipeline phase. */
	foreignCommitOnBranch: boolean;
}

export type RefVerdict = { halt: false } | { halt: true; reason: string };

// Exact phrases re-used verbatim inside the live template's fence text —
// pipeline-ref-discipline.spec.ts imports these (not duplicate literals) so
// the prose and this classifier cannot drift apart silently.
export const HALT_REASON_WRONG_BRANCH = 'ONLY on the story branch';
export const HALT_REASON_MAIN = 'already committed on main';
export const HALT_REASON_TIP = 'not at the tip your brief describes';
export const HALT_REASON_FOREIGN_COMMIT = 'a commit from neither you nor this pipeline';

/**
 * PRIMARY gate first (branch identity — answerable pre-commit, nothing yet to
 * narrate), then the three after-the-fact anomalies as the SECONDARY net, in
 * the same order the template's fence prose now states them. The order is
 * load-bearing: when more than one condition holds, the earliest applicable
 * check wins and names the reason — mirrors why a #357-shaped agent (found
 * itself on main) must be caught by the branch check itself, not by
 * reasoning about what landed there.
 */
export function classifyRefState(state: RefState): RefVerdict {
	if (state.currentBranch !== state.storyBranch) {
		return { halt: true, reason: HALT_REASON_WRONG_BRANCH };
	}
	if (state.thisTasksWorkOnMain) {
		return { halt: true, reason: HALT_REASON_MAIN };
	}
	if (state.branchMissingOrWrongTip) {
		return { halt: true, reason: HALT_REASON_TIP };
	}
	if (state.foreignCommitOnBranch) {
		return { halt: true, reason: HALT_REASON_FOREIGN_COMMIT };
	}
	return { halt: false };
}

// (*MVOX:Byrd* — #381 acceptance additions)
