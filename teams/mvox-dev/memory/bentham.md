---
name: bentham-scratchpad
description: Bentham's personal notes — review method and calibration for mvox-dev
metadata:
  type: project
---

# Bentham scratchpad

**Consolidated 2026-09-06 (MVOX-16).** The rulebook this file had become now lives in
`architecture-decisions.md` under **"Review rulebook — consolidated from `bentham.md`"** — sections
A (tests that pass while broken), B (Entu read/rights mechanics), C (canonical 7 triggers + repointed
schema gate), D (verdict semantics), E (TDD commit shapes), F (UI triggers, incl. the REOPENED
optimistic-write stand-down), G (migration ledgers), H (PII leak audits). **Read the rules there, not
here** — a second copy is the two-agents-different-contracts hazard I keep warning about. What stays
below is only how *I* work: method, self-corrections, and findings I have already cleared.

## Review method — how I establish ground truth

- **[CALIBRATION-DO-NOT-FABRICATE]** Every claim in a verdict quotes a line I read THIS pass from THE
  REAL FILE. No claim survives a cancelled or aborted tool batch. Enumerate branches with
  `git for-each-ref refs/heads` and confirm the tip's commit SUBJECT before reviewing — a dispatch
  names the chore, not the branch, and not the phase. If the GREEN task is still pending, the correct
  response is "not ready, awaiting GREEN," not a review. If verdict and file disagree, the FILE wins.
- **[GOTCHA-BRANCH-MOVED-UNDER-REVIEW]** Re-derive the branch's real HEAD; never trust a SHA quoted in
  a handoff. Capture `git rev-parse HEAD` + `git status -s` BEFORE and AFTER any gate run in the SAME
  command, so a mid-review move is detectable. Read diffs from committed blobs (`git show <sha>:<path>`),
  never the working tree — untracked WIP shadows commit content invisibly. To test an old state, use
  file-granularity checkout (section A's replay technique), never a worktree. When HEAD moves
  mid-review, re-gate and report the corrected SHA + test count explicitly. Fired twice
  (#7-signin `f4f199e`→`a9e8919`; #36 `a755ceb`→`a25e78d`).
- **[CALIBRATION-NEVER-CAVE-TO-AUTHORITY]** When team-lead's report conflicts with my clean read,
  present the RAW conflict plus a deterministic cross-check — do NOT "corroborate" to be agreeable.
  Content hashes (`git rev-parse <ref>:<path>`, `git cat-file -p <blob>`, `git hash-object`) arbitrate;
  they survive a flaky stdout channel where rendered file text does not. Session 27 is why: I caved my
  clean `2e12` blob read to team-lead's `2e9` report. The blob SHA was right; the social correction was
  wrong.
- **[CALIBRATION-GATE-CLAIMS]** Before any gate claim, READ the gate-result file in the SAME turn and
  quote the exact line. If I have not read it this turn I have no number to report — say the verdict is
  static-provable and gate-independent instead. Run each commit's `pnpm check` as its OWN discrete Bash
  call, never `&&`-chained across commits: an ELIFECYCLE on a middle command eats the failure and
  `tail -N` then misattributes the previous commit's `COMPLETED N FILES E ERRORS`. **Test-runtime
  success ≠ type-check success** — vitest passing never underwrites a failed or missing `pnpm check`.
- **[ENV-PNPM-NOT-ON-PATH]** `pnpm` is NOT on the default `PATH` here — a bare `pnpm check` dies with
  exit 127, which reads like a broken repo and is not. Prefix gate runs with
  `export PATH="$HOME/.local/share/pnpm:$PATH"`. It lives at `~/.local/share/pnpm/pnpm` (v10.30.1);
  no nvm here, `node`/`npm`/`corepack` are in `/usr/local/bin`. Cost me one failed gate run on #213.
- **[CALIBRATION-PRUNE-TIMING]** Prune this file at session END, not START — keep current-arc entries
  until the work they document is CLOSED. Lift broad patterns to `architecture-decisions.md` BEFORE
  pruning them from here. (Done wholesale 2026-09-06; the arcs for #193, #206, #213, #255, #260 and
  #20 are closed and their durable residue is in the rulebook.)

## Self-corrections I must not repeat

- **[CALIBRATION-MY-OWN-RED-TRIGGER-NAMED-A-DEAD-FUNCTION]** I once enforced a Path C rule by grepping
  for `setAccounts` — a function that **does not exist in this codebase**. Enforce that rule (and any
  rule phrased as a call sequence) **by intent — never publish auth state derived from a stale token** —
  not by symbol, or I manufacture a false RED. The correction is live in `architecture-decisions.md`
  (Path C review-enforcement block) with the verified `run-link-callback.ts:95-102` shape. Closed
  2026-09-03; do not re-open. **Generalize it**: before firing any trigger whose text names a symbol,
  confirm the symbol still exists.
- **[GOTCHA-COLLECTIVE-NAME-CANNOT-BE-EMPTY]** `marker.ts:70` is `hit?.name?.[0]?.string?.trim() || db`
  — the `||` sits after `.trim()`, so blank and whitespace names fall back to the db name. Any
  `{collective}` interpolation therefore **cannot** render dangling copy. I chased this on #193 and
  cleared it; do not re-raise. (The admin page's `admin_collective_name_unnamed` is a *different*
  surface — the editable marker field, pre-fallback.)
- **A stand-down whose premise goes stale is worse than no stand-down.** I nearly waved off a live #255
  finding on the strength of a note I wrote when its premise was true. The rule that saved it is now
  section D ("a stand-down is a decision"); the discipline it demands of me is to re-check the premise
  **at the point of use**, every time.

## [CALIBRATION-PROPOSAL-SHAPE] — what makes a proposal rulable rather than merely persuasive

Gama's words from the #255 arc (proposal → all four recommendations ruled), worth reusing: one
recommendation per question, each grounded in a read done THAT pass, each with the alternative stated
fairly enough to be ruled against on merits rather than on framing. The concrete move that did the
work: **for every "don't do X" I named what X would actually break at a file:line**, so the refusal was
evidence, not preference.

## [GOTCHA-SALVAGE-DIFF-MISSES-WORKTREE] — the memory-file YELLOW, and how to prescribe its fix

Standing YELLOW: a branch diff vs main carrying `teams/mvox-dev/memory/*` means scratchpads are riding
into a feature squash. Prescribe a fix that **PRESERVES** the edits — agents write scratchpads mid-chain
by standing policy, so the salvage set is usually part-committed, part-working-tree:

```
git diff main -- teams/mvox-dev/memory/ > /tmp/claude-1000/memory-salvage-<issue>.patch
test -s /tmp/claude-1000/memory-salvage-<issue>.patch          # refuse to proceed on empty
git checkout main -- teams/mvox-dev/memory/ && git commit -m "chore: drop memory files from #<issue> branch"
```

**The trap**: `git diff main HEAD -- <path>` compares two COMMITS and ignores the working tree. With
dirty-but-uncommitted scratchpads it returns 0 lines, exits 0, and writes an empty patch that looks
successful — then `git checkout main -- <path>` destroys the very edits the export existed to save.
Measured on #199 @ `e819fff`: `main HEAD` = 0 lines, `main` = 120 lines, same paths, same moment.
Re-confirmed #255 r4 @ `d67ce9f`: 0 vs 116. Twice, months apart, unrelated branches — it is the form's
behaviour, not a one-off. **Drop `HEAD`; keep the `test -s` guard.**

**Second use — this pair also answers "are scratchpads in the squash?"** `git diff main --stat` compares
against the WORKING TREE, where dirty scratchpads always sit, so it over-reports. The committed question
is `git log main..HEAD -- teams/mvox-dev/memory/` (empty ⇒ clean squash). Run both and **say which one
you ran**; they disagree by construction whenever anyone has an uncommitted scratchpad, which under
standing mid-chain-write policy is nearly always.

Two riders: `git commit` fails on an empty commit when the memory paths were never committed to the
branch (the common case), so make it conditional or `--allow-empty`. And re-run BOTH diff forms at
review time — a clean RED commit does not bind the GREEN / i18n / FIX commits that follow, each of
which gets its own `add -A`.

## [CALIBRATION-SCOPED-GATE-IS-NOT-THE-GATE] 2026-09-07, #274 r2

Pérotin reported "vitest 117/117" and it was true — of a **scoped** run
(`scripts/migrations/lib`, `src/lib/sections`). The full suite was **1 failed | 3633 passed**: the new
`script-runner.spec.ts` tripped `src/lib/testing/testIsolation.guard.spec.ts` (#163 C6, Tallis), a
**repo-wide** guard asserting no `*.spec.ts` under `src/` or `scripts/` contains the literal
production Entu host. A path-scoped run cannot see a guard that lives outside the scope but polices
inside it — and adding a spec file is exactly when repo-wide guards fire. **Always re-run the FULL
suite on a branch that adds a spec, and never accept a scoped count as the gate.** Round 1 being fully
green (242 files / 3606 tests) is what made the regression attributable in one step — carry a
full-suite number forward from the previous round for exactly this.

## [CALIBRATION-MY-PROBE-POLLUTED-THE-TREE] 2026-09-07, #274

`writeLedger` builds its output path with a **relative** `join('scripts','migrations','seed-results')`,
so it writes relative to **cwd**. My round-1 probe's first invocation ran with the repo as cwd and
dropped 4 `PROBE-dry-*.json` files into the real `seed-results/` — untracked, in a directory #274 had
just un-ignored, i.e. precisely where a merge-time `git add -A` would sweep them into the squash. I
caught them only because I re-read `git status` at the top of round 2.

Two rules for myself. **Run probes from the scratchpad cwd, never the repo cwd** — and prefer what the
spec did (mock `node:fs`) when the goal is behaviour rather than file output. And **`| head` on a
side-effecting probe is dangerous**: SIGPIPE killed the run after 4 of 6 writes, which is why the
artefacts were both present and incomplete. **Re-read `git status -s` at the START and END of every
review round** — I already do that for HEAD movement; extend it to untracked files, because my own
tooling is a source of them.

## [GOTCHA-REDACTOR-DROPS-KEY-CONTEXT] 2026-09-07, #274 — a recursive scrubber must carry the key down

`ledger-writer.ts`'s `redactValue` dispatched on **type first**, so the declared-field check
(`keyLower && redactFieldSet.has(keyLower)`) only ever ran on a **string** leaf. Descending into an
array passed `null` as the key, and descending into an object re-keyed children by their **own**
names — so the key context died at the first non-scalar. `{surname: 'Tamm'}` redacted;
`{surname: ['Tamm']}`, `{surname: [{string:'Tamm'}]}` and `{surname: {string:'Tamm'}}` all came
through **in the clear**, silently. That third shape is Entu's *native* multi-value property shape
(`project_entu_post_appends_multi_value`: every non-formula string prop is implicitly multi-valued),
so the hole sat exactly where this codebase's data actually lives.

**The general rule**: in any recursive redact/scrub/mask, hoist the key-match ABOVE the type
dispatch, so a declared-sensitive key redacts its **whole subtree** whatever shape it holds. A
content regex (here the unconditional email scan) hides this bug — emails kept getting caught by
content while names silently escaped, which is why the mechanism looked like it worked.

**Completion test for this class** — not a grep, a shape table. Any field-based redactor must pin all
of: scalar / array-of-string / array-of-object / nested-object / deep-nested, under BOTH a default
field and a caller-supplied `redactFields` entry. I proved the #274 instance by running the real
committed blob (verified `git hash-object` == `19347f07`) from a scratchpad cwd — copy the module out,
drive it, read the JSON. Cheaper and far more honest than reading the recursion.

**Calibration that made this findable**: I did NOT trust "verified live: seed-178 shows `[REDACTED]`"
in the commit body. That claim was TRUE and still concealed the bug, because seed-178's fields are
scalars. **A worked example proves the shape it exercises and nothing wider** — when a safety claim is
universal ("redacts every value under a declared name"), test the shapes the example does *not* cover.

## [LEARNED 2026-09-06, #264] A class-shaped finding needs a class-shaped prescription

Round 3 of #264 found stale clear-then-set comments and named **two spec files**. The fix corrected
exactly those two — correctly, verbatim to the prescription — and the class was never swept. My
post-cap pass found **four more**, three in SOURCE docstrings, including one
(`repertoireActions.ts:241`) describing a "GET → DELETE → POST" order that was never the wire in
either era.

**Nothing went wrong in the fixing; the prescription was the defect.** A site list reads as the whole
job, so a diligent agent closes the named sites and stops. Same failure as
`[CALIBRATION-MY-OWN-RED-TRIGGER-NAMED-A-DEAD-FUNCTION]` from the other end: there I enforced by
symbol instead of intent; here I would have prescribed by site instead of class.

**The move**: when a finding is one instance of a searchable class, hand over the **grep that defines
the class** alongside the sites — "run this after the fix; empty output is the completion test." That
turns a site list into a verifiable predicate and makes a further round on that kind unnecessary.
Worked instance:
`grep -rn "DELETE every pre-existing\|DELETE-stale\|GET → DELETE\|POST-one-value\|DELETE every old" src/`
It also earns its keep by finding the NON-findings, which matter as much: two hits were CORRECT
(`seasonManage.ts` describing its own deliberately-unconverted code; a spec framing the old wire as
explicitly historical). **Enumerate those in the verdict too**, or the fixer "corrects" true comments
into false ones.

## PO standing rules — pointer only

**The binding text is the "PO standing rules" section of `architecture-decisions.md`. Read it there;
never keep a second copy here.** I pruned my 55-line shorthand on 2026-09-02 because it had already
drifted behind the canonical section. Rules 1–7 and all five triggers live there:
`[TRIGGER-NATIVE-CONTROLS]`, `[TRIGGER-INSITU-WHOLE-FIELD]`, `[TRIGGER-24H-TIME]`,
`[TRIGGER-MONDAY-FIRST]`, `[TRIGGER-ISO-DATE]`. Rules 5, 6 and 7 all SHIPPED via #207 (`32845d6`,
`8e6d014`) and #220 (`66ebd9d`) — do not review them as outstanding retrofits. The two live traps
(TimeSelect is the sanctioned custom control; `[TRIGGER-ISO-DATE]` does not bind native date pickers)
are documented at the trigger text itself.

(*MVOX:Bentham*)
