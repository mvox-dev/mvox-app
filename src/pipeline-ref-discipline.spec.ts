// #381 — a fix agent that lands a commit on main halts instead of narrating it.
//
// RED for the #381 TDD chain. On #357 a round-2 finding-fix agent committed a
// squash-style commit (trailer, `Closes` line and all) directly onto local
// main — the merge agent's act, performed by a fix agent, on the wrong ref.
// Both reviewers NOTICED and said so plainly in-band; noticing left the next
// agent free to decide, and it decided to continue. The fix is structural:
// every committing phase's PROMPT in the pipeline template carries a
// ref-discipline fence, as a HALT-not-narrate rule —
//   (a) all commits land ONLY on the story branch, and
//   (b) on discovering ANY unexpected state — work already on main, branch not
//       at its expected tip, a commit the agent did not make — the agent STOPS
//       and returns the state verbatim; it "cannot proceed by describing the
//       situation instead" (the issue's done-when phrasing).
//
// This spec mechanically pins the REAL template file
// (.claude/workflows/tdd-slice-pipeline.js) — the same drift-pin role the
// issue-template / rights-model / typography pins play for their documents.
//
// SPEC HOME (noted per the #381 brief): no spec harness covered
// .claude/workflows/ before this file. House drift-pins over real repo files
// live at src root (issue-template.spec.ts, rights-model-identifiers.spec.ts,
// typography-scale.spec.ts), and vitest's include is `src/**/*.spec.ts` —
// this spec follows that precedent rather than opening a new harness dir.
//
// WHICH PHASES ("find every phase whose agents may commit" — the finding):
// prompts in the template that instruct a commit are SEED, RED, GREEN,
// GREEN-FIX, FIX (the review-fix rounds), and MERGE. Of these:
//   - RED, GREEN, GREEN-FIX, FIX are story-branch phases → FULL fence (both
//     clauses). This is the brief's enumeration (FIX, GREEN-FIX, review-fix
//     rounds) plus the two other branch-scoped committing phases the sweep
//     found (RED, GREEN commit on the story branch and were equally unfenced).
//   - MERGE is EXEMPT from clause (a): its commit on main IS its job; it has
//     its own fences (review gate, placeholder rule, dirty-tree rule). A
//     blanket-appended fence would contradict it — pinned negatively below.
//   - SEED is EXEMPT from clause (a): it runs before RED creates the story
//     branch, so "commits land ONLY on the story branch" would be a false
//     instruction there; it keeps the template's generic GIT_SAFETY
//     stop-and-report. Widening SEED's discipline is outside #381's scope
//     (the issue is fix agents).
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
	HALT_REASON_FOREIGN_COMMIT,
	HALT_REASON_MAIN,
	HALT_REASON_TIP,
	HALT_REASON_WRONG_BRANCH
} from './pipeline-ref-discipline-fence';

const TEMPLATE_PATH = resolve(__dirname, '../.claude/workflows/tdd-slice-pipeline.js');

/** Reads the real template; '' when absent so every assertion fails with its own message. */
const template = (): string => (existsSync(TEMPLATE_PATH) ? readFileSync(TEMPLATE_PATH, 'utf-8') : '');

// ── call-region extraction ───────────────────────────────────────────────────
// Every phase agent is dispatched via `agentS(...)`. Splitting the source on
// the literal call token yields one region per call: the region starts at the
// call's prompt expression and runs to the next `agentS(` (or EOF), so it
// contains both the prompt constructor and the call's own `label:` — enough to
// associate fence text with a phase without parsing JS.
function callRegions(text: string): string[] {
	return text.split('agentS(').slice(1);
}

/** The region whose options carry the given label prefix (e.g. "label: 'fix-"), or ''. */
function regionFor(labelKey: string): string {
	const hits = callRegions(template()).filter((r) => r.includes(labelKey));
	return hits.join('\n/* --- next region with same label --- */\n');
}

// Label keys, copied from the template's own `label:` literals. Note
// `label: 'green-'` (with the closing quote) cannot match `label: 'green-fix-`,
// and `label: 'fix-` cannot match inside `label: 'green-fix-` — verified
// against the source shapes `label: 'green-' + ...` / `label: 'green-fix-' + ...`.
const LABELS = {
	seed: "label: 'seed-",
	red: "label: 'red-",
	green: "label: 'green-'",
	greenFix: "label: 'green-fix-",
	fix: "label: 'fix-",
	merge: "label: 'merge-",
} as const;

// ── the fence pins (load-bearing literal substrings) ─────────────────────────
// GREEN authors the fence; these literals are the contract. Clause (a) — imported
// from pipeline-ref-discipline-fence.ts (Gama acceptance addition, review round
// 2026-09-15) rather than duplicated, so this raw-text pin and the executable
// classifier's own fixtures cannot drift apart silently:
const BRANCH_PIN = HALT_REASON_WRONG_BRANCH;
// Clause (b) — the HALT-not-narrate rule, with the anomaly set enumerated. The
// three anchored anomaly phrases are the SAME imported constants:
const HALT_PINS = [
	'HALT', //                                the rule's name, uppercase — not advice
	HALT_REASON_MAIN, //                      anomaly 1, anchored to THIS task (review-fix round: the
	//                                        unanchored 'work already on main' was true on every
	//                                        healthy run — main always carries prior work)
	HALT_REASON_TIP, //                       anomaly 2, anchored to the agent's own brief
	HALT_REASON_FOREIGN_COMMIT, //            anomaly 3, anchored: the branch legitimately carries
	//                                        OTHER agents' RED/GREEN commits; only a commit from
	//                                        outside the pipeline is anomalous.
	//                                        (Stops short of "...pipeline's earlier phases" — the
	//                                        template source has that apostrophe escaped as `\'`, a
	//                                        literal backslash this raw-text pin would otherwise have
	//                                        to match character-for-character.)
	'verbatim', //                            the state is RETURNED verbatim, not summarized
	'cannot proceed by describing the situation instead', // the issue's done-when phrasing, literal
] as const;
const FULL_FENCE_PINS = [BRANCH_PIN, ...HALT_PINS];

/** Pins from `pins` that do NOT appear in `region`. */
function missingPins(region: string, pins: readonly string[]): string[] {
	return pins.filter((p) => !region.includes(p));
}

// Committing-prompt detection for the structural sweep: a region whose text
// carries the word "commit" as a word (instructional prose or a `git commit`
// line). `\bcommit\b` deliberately does NOT match identifiers like
// `commitSha`/`commitPrefix`/`commitBody` (no word boundary inside them).
const COMMIT_WORD = /\bcommit\b/i;

// Non-agentS dispatch boundary (Bentham review round 2026-09-15): the
// structural sweep (describe block 2, below) only scans `agentS(` call
// regions. A phase DISPATCHED via a bare `agent(` call — no trailing `S` —
// would bypass that sweep silently, no matter how the sweep's own comment
// reads. `\bawait agent\(` (not bare `\bagent\(`) is the dispatch-site
// pattern specifically: it excludes both prose (a comment mentioning
// "agent() calls" has no `await` before it) and the `agentS` wrapper's own
// definition (`const agentS = (prompt, opts) => agent(prompt + ...)` calls
// the primitive with no `await` — it's the shared plumbing every agentS(...)
// call already routes through, not an independent dispatch that bypasses
// anything). Only a genuine `await agent(...)` call site is a phase
// dispatched OUTSIDE agentS's guards. Each region is a bounded window after
// the call site (not run to EOF or the next split point) so its `label:`
// option can be checked without risk of picking up an unrelated later call's
// label.
const BARE_AGENT_CALL = /\bawait agent\(/g;
const BARE_AGENT_REGION_WINDOW = 1000;

function bareAgentCallRegions(text: string): string[] {
	const regions: string[] = [];
	const re = new RegExp(BARE_AGENT_CALL);
	let match: RegExpExecArray | null;
	while ((match = re.exec(text)) !== null) {
		regions.push(text.slice(match.index, match.index + BARE_AGENT_REGION_WINDOW));
	}
	return regions;
}

// ── 0. instrument sanity — a clean negative is a claim about the instrument ──

describe('#381: instrument sanity — the template and its phase regions are found', () => {
	it('the pipeline template file exists at .claude/workflows/tdd-slice-pipeline.js', () => {
		expect(
			existsSync(TEMPLATE_PATH),
			'.claude/workflows/tdd-slice-pipeline.js not found — the drift-pin has nothing to pin'
		).toBe(true);
	});

	it('every known phase label resolves to an agentS call region', () => {
		const missing = (Object.entries(LABELS) as [string, string][])
			.filter(([, key]) => regionFor(key) === '')
			.map(([name, key]) => `${name} (${key})`);
		expect(
			missing,
			`no agentS region found for: ${missing.join(', ')} — region extraction is broken or the template was restructured; fix the instrument before trusting any fence assertion`
		).toEqual([]);
	});

	it('the sweep detects every known committing phase as committing (SEED, RED, GREEN, GREEN-FIX, FIX, MERGE)', () => {
		const notDetected = (Object.entries(LABELS) as [string, string][])
			.filter(([, key]) => !COMMIT_WORD.test(regionFor(key)))
			.map(([name]) => name);
		expect(
			notDetected,
			`committing-phase detection missed: ${notDetected.join(', ')} — the negative sweep below would pass vacuously; fix the detector first`
		).toEqual([]);
	});
});

// ── 1. the full fence, one assertion per branch-scoped committing phase ─────

describe('#381: each branch-scoped committing phase prompt carries the full ref-discipline fence', () => {
	it('FIX (review-fix rounds) — the phase that committed on main in #357', () => {
		const missing = missingPins(regionFor(LABELS.fix), FULL_FENCE_PINS);
		expect(
			missing,
			`the FIX prompt constructor lacks fence string(s): ${JSON.stringify(missing)} — a fix agent that finds its work committed on main must HALT, not narrate around it (#381 done-when)`
		).toEqual([]);
	});

	it('GREEN-FIX (integration wiring fixes) — commits on the story branch, same exposure', () => {
		const missing = missingPins(regionFor(LABELS.greenFix), FULL_FENCE_PINS);
		expect(
			missing,
			`the GREEN-FIX prompt constructor lacks fence string(s): ${JSON.stringify(missing)}`
		).toEqual([]);
	});

	it('GREEN (implementation commit) — commits on the story branch, same exposure', () => {
		const missing = missingPins(regionFor(LABELS.green), FULL_FENCE_PINS);
		expect(
			missing,
			`the GREEN prompt constructor lacks fence string(s): ${JSON.stringify(missing)}`
		).toEqual([]);
	});

	it('RED (test commit) — creates and commits on the story branch, same exposure', () => {
		const missing = missingPins(regionFor(LABELS.red), FULL_FENCE_PINS);
		expect(
			missing,
			`the RED prompt constructor lacks fence string(s): ${JSON.stringify(missing)}`
		).toEqual([]);
	});
});

// ── 2. negative — no committing-phase prompt lacks the fence ────────────────
// Structural sweep: ANY agentS-DISPATCHED region that instructs a commit must
// carry the fence marker, except the two by-design exemptions (MERGE commits
// on main as its job; SEED commits ledgers before the story branch exists). A
// future committing phase added via `agentS(` without the fence fails here by
// construction. This sweep's reach is bounded to `agentS(` call regions — it
// does NOT see a committing phase dispatched via a bare `agent(` call; the
// "boundary predicate" describe block below (Bentham review round
// 2026-09-15) is what keeps that gap closed, by pinning the non-agentS
// dispatch set at exactly one known-benign reader.

describe('#381: no committing-phase prompt lacks the fence (structural sweep)', () => {
	const FENCE_MARKER = 'cannot proceed by describing the situation instead';

	it('every committing agentS region carries the fence marker, MERGE and SEED exempt', () => {
		const unfenced = callRegions(template())
			.filter((r) => COMMIT_WORD.test(r))
			.filter((r) => !r.includes(LABELS.merge) && !r.includes(LABELS.seed))
			.filter((r) => !r.includes(FENCE_MARKER))
			.map((r) => {
				const label = r.match(/label:\s*'([^']*)/);
				return label ? label[1] : r.slice(0, 80).replace(/\s+/g, ' ');
			});
		expect(
			unfenced,
			`committing-phase prompt(s) without the ref-discipline fence: ${JSON.stringify(unfenced)} — every agent that commits mid-pipeline must halt on unexpected state, not describe it and continue`
		).toEqual([]);
	});
});

// ── 2b. the structural sweep's own boundary, pinned as a predicate ─────────
// Bentham review round 2026-09-15: the sweep above claims to reach "any
// committing phase added" by construction, but its reach is `agentS(` calls
// only — one bare `await agent(` already exists (LOAD, the JSON args
// reader). Turning the boundary into an explicit, tested predicate: the
// non-agentS dispatch set is pinned at EXACTLY ONE, and that one is named as
// the known-benign LOAD reader. A second bare dispatch — which could hide an
// unfenced committing phase from the sweep above — fails here loudly instead
// of passing silently.

describe('#381 acceptance: the non-agentS dispatch boundary is a pinned predicate, not an assumption', () => {
	it('exactly one bare agent( call exists — a second would bypass the agentS( structural sweep silently', () => {
		const regions = bareAgentCallRegions(template());
		expect(
			regions.length,
			`expected exactly 1 bare agent( dispatch (the known-benign LOAD reader) but found ${regions.length} — the structural sweep above only scans agentS( regions, so any additional bare dispatch is invisible to it and needs its own review`
		).toBe(1);
	});

	it('the one bare agent( call is the LOAD phase\'s known-benign JSON reader, labeled load-args', () => {
		const [region] = bareAgentCallRegions(template());
		expect(
			region?.includes("label: 'load-args'"),
			"the bare agent( call is not labeled 'load-args' — the sweep's exemption assumes exactly this one non-committing reader (it only returns parsed JSON, never touches git); a differently-labeled bare dispatch needs its own review, not a silent pass"
		).toBe(true);
	});
});

// ── 3. negative — the exempt phases are not blanket-fenced wrongly ──────────

describe('#381: the fence is placed per phase, not blanket-appended', () => {
	it('the MERGE prompt does NOT carry the story-branch-only clause — its commit on main IS its job', () => {
		expect(
			regionFor(LABELS.merge).includes(BRANCH_PIN),
			`the MERGE prompt contains '${BRANCH_PIN}' — a merge agent commits ON MAIN by design; this clause there means the fence was appended indiscriminately (e.g. via the agentS wrapper) and now contradicts the one prompt whose main-commit is legitimate`
		).toBe(false);
	});

	it('the SEED prompt does NOT carry the story-branch-only clause — it commits before the story branch exists', () => {
		expect(
			regionFor(LABELS.seed).includes(BRANCH_PIN),
			`the SEED prompt contains '${BRANCH_PIN}' — SEED runs before RED creates the branch; this clause there is a false instruction`
		).toBe(false);
	});
});

// ── 4. EARLIEST CHECK WINS (Gama acceptance addition, review round 2026-09-15) ──
// The pre-commit branch check is the PRIMARY gate — answerable before a commit
// exists, so there is nothing yet to narrate around. The after-the-fact
// anomalies (the three HALT_REASON_* clauses) are the SECONDARY net. This pins
// the ORDER of the fence text itself, not just presence — a fence that states
// its primary gate after its secondary net reads as a checklist, not a
// sequence, and invites checking them in the wrong order live.
describe('#381 acceptance: PRIMARY (pre-commit branch) check precedes the SECONDARY (after-the-fact) net, in prose', () => {
	const PRIMARY_MARKER = 'PRIMARY CHECK';
	const SECONDARY_MARKER = 'SECONDARY CHECK';

	it.each([
		['RED', LABELS.red],
		['GREEN', LABELS.green],
		['GREEN-FIX', LABELS.greenFix],
		['FIX', LABELS.fix]
	])('%s: PRIMARY CHECK is stated before SECONDARY CHECK, and before every anomaly phrase', (name, labelKey) => {
		const region = regionFor(labelKey);
		const primaryIdx = region.indexOf(PRIMARY_MARKER);
		const secondaryIdx = region.indexOf(SECONDARY_MARKER);
		expect(primaryIdx, `${name}: PRIMARY CHECK marker not found`).toBeGreaterThanOrEqual(0);
		expect(secondaryIdx, `${name}: SECONDARY CHECK marker not found`).toBeGreaterThanOrEqual(0);
		expect(
			primaryIdx,
			`${name}: PRIMARY CHECK must come before SECONDARY CHECK — the pre-commit branch gate is answerable first`
		).toBeLessThan(secondaryIdx);
		for (const anomaly of [HALT_REASON_MAIN, HALT_REASON_TIP, HALT_REASON_FOREIGN_COMMIT]) {
			const anomalyIdx = region.indexOf(anomaly);
			expect(anomalyIdx, `${name}: anomaly phrase '${anomaly}' not found`).toBeGreaterThanOrEqual(0);
			expect(
				primaryIdx,
				`${name}: PRIMARY CHECK must precede the after-the-fact anomaly '${anomaly}'`
			).toBeLessThan(anomalyIdx);
		}
	});
});

// (*MVOX:Tallis* — #381 RED; review-fix + acceptance additions *MVOX:Byrd*)
