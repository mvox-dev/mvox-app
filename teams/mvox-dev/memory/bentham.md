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

## [GOTCHA-MIGRATIONS-TWIN-FILES] 2026-09-07, #278 — never run a scripts/migrations predicate on basename

`scripts/migrations/` holds **twin files**: `X.ts` at top level is a thin RUNNER that owns the
`writeFileSync`, and `lib/X.ts` is the logic module with no file write. Twelve pairs at least
(`config-menu-admin-only`, `library-visibility`, `widen-member-refs`, …). Consequences:

- A predicate reported by **basename collapses each pair into one line** and silently hides which half
  matched. Mine did on the first pass, and I nearly raised a false finding against #278's grandfather
  list — its entries are bare filenames (`'library-visibility-2026-08-08.ts'`) while the guard compares
  `relative(scripts/migrations, full)`, which yields `lib/…` for the lib half. That looks like a path
  bug and is not: only the top-level halves call `writeFileSync`, so their `rel` IS the bare filename.
  **Always emit full relative paths, never `basename`.**
- Generally: **a guard's exemption list and the audit predicate that produced it must agree on path
  shape.** Check that they do before trusting either — they can agree on the *set* while disagreeing on
  the *keys*, which passes today and breaks the moment a file moves between the twin locations.

## [GOTCHA-DEDUP-BY-DELETE-IS-PARITY-DEPENDENT] 2026-09-07, #269 — demand an ODD-count test

"Drop duplicates from a map" written as *set-on-first, delete-on-second* is **count-parity dependent**
and silently re-adds. Without a `seen`/`duplicated` set, record 3 finds `map.has(id)` false — the
delete removed it — and re-`set`s the person under an arbitrary name. Measured on the real loop shape:

| records for one person | with the `duplicated` guard | WITHOUT it |
|---|---|---|
| 2 | dropped | dropped ✓ |
| **3** | dropped | **re-added as the 3rd name** ✗ |
| 4 | dropped | dropped ✓ |

**Two and four both pass. Only odd counts ≥3 fail.** So a spec that pins only the two-record case
certifies a broken implementation, and the bug reaches production looking tested. #269 shipped the
correct form (a `duplicated: Set` consulted *before* the `has` check, making it count-independent) and
a dedicated third-record pin — verified by replaying both pins at file granularity against the pre-fix
blob: exactly 3 failures, 27 unrelated cases still green.

**Standing move**: for ANY dedup/drop/refuse-to-guess collection logic, ask for the **odd-count**
case, not just the duplicate case — and check the implementation is guarded by a separate seen-set
rather than by the absence of the key it just deleted. The general form: **never use a mutated
collection's own membership as the memory of what you removed from it.**

## [PATTERN-NEW-SUSPENSION-POINT-AUDIT] 2026-09-07, #268 r4 — three questions, always

When a fix inserts an `await` into a guarded async handler (here: a fresh `loadMemberRecord` moved
into `saveRecordEditor` so the check-then-create invariant guards the WRITE, not the editor-open),
run all three:

1. **Does the new guard exist?** Every pre-existing guard across a suspension point must be re-checked
   across the new one. #268 did this — `isCurrent(g) && recordEditorMemberId === memberId` is
   re-checked immediately after the new await.
2. **Did the existing race pins go SHORT-CIRCUIT?** A held-promise race test may now satisfy itself at
   the NEW early guard and never reach the post-write guard it was written for — passing for a
   different reason, leaving the original guard uncovered. Trace the await ordering in the test:
   #268's `:732` pin survived intact because its `await tick()` lets the new lookup resolve and the
   held `createMemberRecord` be entered BEFORE the collective switch, so the post-write guard is still
   the one under test. **That has to be traced, not assumed** — a green suite says nothing about which
   branch did the work.
3. **Does the NEW guard have its own pin?** Usually not, and that is the finding. The new suspension
   point needs a race test that holds the *new* await (defer `loadMemberRecordMock`, switch, release)
   and asserts neither write fires. Without it a future refactor deletes the guard silently.

Q2 and Q3 are the ones everyone misses; Q1 is the one everyone remembers. A fix that adds an await is
a **coverage** event as much as a behaviour one.

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

## [GOTCHA-DEPARENT-BY-COPY-LOSES-THE-SUBTREE] 2026-09-10, #305 r2

De-duplicating a tree that arrives as a **flat list plus separately-fetched child lists** has a second
hole one level below the one it closes. #305's `fetchBoard` collected resolved child numbers and
filtered them out of the top level — correct for one level. But `fetchSubIssues` builds each child by
`normalizeIssue`, which hardcodes `subIssues: []`, so the nested child is a **different object** from
the top-level one whose own children the loop resolved. Filter the top-level copy away and its subtree
goes with it. Measured on the real committed blobs (epic 289 → epic 290 → task 291): rendered ids
`[289, 290, 305]` — **291 on no path to the page at all**, no error, no count mismatch.

**The tell is a comment that states the property the code lacks**: `fetch-issues.ts:139-141` said "An
epic that is itself someone's sub-issue keeps its own children — only its top-level position moves."
Verified false the same pass. Sibling of `[LEARNED #264]` — a false invariant in a comment is worse
than the bug, because the next fixer builds on it.

**General form**: when de-duplicating by dropping a copy, the surviving copy must BE the same object
(or carry the same subtree). `const byNumber = new Map(items.map(i => [i.number, i]))`, then attach
`byNumber.get(n) ?? fresh` — order-independent, because the shared object is mutated in place. **Price
it honestly**: copies are cycle-proof by construction, shared references are not, so a reference fix
owes the recursive walk a visited-set or depth cap.

**Method note.** Both the one-level fix and the day-one zero-child case were fine; only the two-level
case failed. A one-level spec certifies a one-level fix and says nothing below it — same shape as
`[GOTCHA-DEDUP-BY-DELETE-IS-PARITY-DEPENDENT]` (2 and 4 pass, 3 fails). **For any de-parent / de-dup
over a hierarchy, ask for the case one level deeper than the one the fix names.** Driving the real
`fetchBoard` from a scratchpad probe (cases: zero-child, one level, two levels, shared child) cost
minutes and settled all four; reading the recursion would not have.

**Closed at `05554ff` (r3), and the fix taught the better rule.** Shared objects alone are not enough:
de-parenting is only safe for a child something still *reaches*, and a cycle makes every ring member
some other member's child, so the filter would drop the whole ring silently. The shape that works
splits the contract across the two steps — **the fetch step guarantees every issue appears AT LEAST
once (walk what the roots reach, return anything stranded to the top level); the renderer guarantees AT
MOST once (a rendered-numbers set, empty string for a repeat).** Neither half holds the invariant
alone: the fetch step cannot stop a child reported under two parents rendering twice, and the renderer
cannot invent an issue the fetch step dropped. Verified across nine graph shapes including a
self-parent, a three-ring and a ring with no roots at all — no duplicates, nothing missing,
deterministic, sub-millisecond.

**How to check a cycle spec is not vacuous.** Assert the fixture cycles by *identity*, then replay the
pre-fix module against it. I extracted the pre-fix `render.ts` blob to the scratchpad (patching only
its bare `yaml` import to an absolute path — ESM outside the package cannot resolve it) and drove it
with the new `fetchBoard`: `289.sub[0].sub[0] === the 289 object`, and the old renderer died with
`RangeError: Maximum call stack size exceeded`. That makes the guard demonstrably load-bearing rather
than asserted to be. The identity property itself needs no separate pin — the two-level test fails the
moment anyone reverts to copies, which is the cheaper way to hold it.

## [GOTCHA-ONE-ENDPOINT-PAGINATES-ITS-SIBLING-DOES-NOT] 2026-09-10, #305 r3

Same file, two functions apart: `fetchAllIssues` paginates carefully via the `Link` header and the
module docstring explains why ("302 issues … well past one REST page"); `fetchSubIssues` sends no
`per_page` and follows no `Link`. GitHub documents `per_page` **default 30** on the sub-issues list and
**up to 100 sub-issues per parent**, so a 35-child epic nests 30 and renders the other 5 flat
(measured — nothing is lost, because the unreturned children never enter `childNumbers` and so stay
roots). **When a module states a pagination discipline in its header, check every endpoint it calls
against that discipline, not just the one the comment discusses.** A stated discipline reads as
covering the file.

## [PATTERN-QUALIFICATION-TEST] 2026-09-10, #317 — what makes X a qualification of Y, not a companion

The #317 scheme obliges every base rule to carry a `Qualifications:` line naming **every** rule that
bounds it, so the completeness question ("is any pair missing?") arrives at every review in this epic.
The discriminator that settled it: **quote the base whole and ask whether a reader is left confident in
something false.** Quoting ER-5 whole ("CREATE auto-grants the creator `_owner`") without ER-9 leaves
the reader believing the creator stays owner — false, a later lower grant silently demotes. Quoting
ER-11 whole ("changing `_sharing` requires `_owner`") without ER-17 hides the service-key bypass. Both
correctly demand the line.

ER-7 versus ER-6 is the **non**-finding the test also decides: ER-7 bounds ER-6 to the direct layer, but
ER-6's own sentence already says "direct", so quoting it whole misleads nobody — companion distinction,
no `Qualifications:` line owed. Do not raise it in a later round. **The wrong test is "does X narrow Y's
subject matter" — that catches every adjacent rule and would turn the scheme into noise.**

Also settled this pass, so it is not re-litigated: the §-section **prose** keeps its em-dash clauses
(§5:132 still holds the systemUser bypass inline). That is the PO's originals-untouched ruling
(15:27Z, "Originals untouched is right"), not a missed split — the identified blocks are the citable
layer. Flagging the prose would YELLOW a PO decision.

## [GOTCHA-CHECKSUM-FENCE-EXEMPTION-IS-AN-OPEN-PATH] 2026-09-11, #320 r5

A checksum pin over a document region is only as tight as its **normalization**, and every line the
normalization strips is a path the fence is not on. #320's fence hashes §1→§3 with
`.filter((l) => !l.startsWith('>'))` so the slice's sanctioned ER blockquotes don't break the pin. That
closes every *modification* path — I probed seven and all seven moved the hash: both headings, §2 code
lines and code comments outside the nine pinned sentences, the `Why private is robust` paragraph, the
literal-`'private'` argument, deleting a pinned sentence, and even blockquote-*izing* a pinned line
(stripping it changes the kept set). But **adding** a bare non-ER blockquote to §1 sails through green,
and I demonstrated it carrying a claim that contradicts §1 outright.

**The tell is a comment narrower than its code**: the comment says "minus the ER blockquotes this slice
is sanctioned to add", while the code exempts *every* blockquote line. Where those two disagree, the code
is the fence and the comment is the intent — so the gap is exactly the difference. **Check every
checksum/normalization fence by asking what its strip step makes invisible, then try to ADD something
there** — modification probes alone certify the half everyone already thinks about. Fix shape: exempt
only lines belonging to a block whose first line matches the ER-definition pattern, so a non-ER
blockquote inside the fenced region fails loudly.

Generalises as a section-I instance (a guard is a property of a PATH): a normalization *is* a path
enumeration, written as code rather than prose. Sibling of the finding that prompted it — the round-4
nine-sentence presence list had the same shape, pinning nine paths and leaving the rest of the region
open.

**Method note for this doc family (#318/#319 will add more fences):** re-derive any claimed pin yourself
from `git show main:<path>` through the same normalization, reimplemented from the comment's prose rather
than copy-pasted. On #320 that also proved the pin certifies MAIN rather than branch self-agreement —
main's slice drops **zero** blockquote lines, and both sides normalize to the same 33 lines / 2025 bytes,
which is what rules out the strip discarding real prose.

**Closed at `cd56721`** — exemption narrowed to runs whose first line matches `DEFINITION_FIRST_LINE`.
Re-derived independently: pin unchanged (`113c0327…`, 2025 prose bytes on both main and tip, so nothing
was repinned) and the smuggled-note case now moves the hash to `c8b7e07e…`.

**[STAND-DOWN, premise named] one level deeper, NOT pressed.** Per the #305 lesson I asked for the case
below the one the fix names: a line appended **inside an existing ER block's contiguous `>` run** (no
blank line between) is still exempt — measured, the hash stays exactly at the pin. A non-ER blockquote
separated by a blank line IS caught, so the run boundary reads markdown correctly. I did not press it, on
three premises: (a) the text lands inside a rule block, so it surfaces whenever anyone quotes that rule,
which is the identifier scheme's whole purpose — unlike the closed hole, which hid prose in §1/§2
attributed to nothing; (b) it stays bound by the 12-line/1200-char caps, the evidence-line rule and the
exactly-one content probes; (c) ER-18..ER-23 are #320's own reviewed deliverable, and `UNTOUCHED_SHA256`
deliberately pins only the 13 pre-#320 blocks.

**Re-open when** any of those three goes false — in particular, **once #320 merges those blocks stop being
the live deliverable, so the cheap close is adding ER-18..ER-23 to `UNTOUCHED_SHA256` in the next slice
that touches this spec (#318).** No new machinery needed; the mechanism is already there.

## [PATTERN-PAIR-THE-FLAG-WITH-THE-ROWS] 2026-09-11, #321 r4 — the audit that finds the missed consumers

When a producer starts reporting a completeness flag beside its rows (`{ items, total, truncated }`), the
review question is not "does each notice work" but **"does every consumer of `items` either consume the
flag or state at the site why it does not?"** Run it mechanically — one grep pairs them:

```
grep -rn 'Read\.items\|Read\.truncated\|read\.items\|read\.truncated' src/routes src/lib \
  --include='*.svelte' --include='*.ts' | grep -v spec | sort
```

Adjacent line numbers with `.items` and no `.truncated` partner ARE the finding. On #321 that surfaced
four unpaired sites after three fix commits had already closed six others by hand — three of them closed-set
`<select>` feeds the PO's ruling covered (`+page.svelte:1671`, `event/[id]:1669`, `+page.svelte:3406` →
`work-manage-add-work-select` / `work-manage-add-programme-select`). Reading the fix commits alone would
not have found them; the fixes were all correct, and the gap was entirely in what they did not reach —
the section-I shape again, at the consumer level.

**Companion lesson on scope comments.** All four unpaired sites carried the SAME sentence — "out of the
RED-pinned scope: only /library and the agenda's own rsvp/attendance lines get one" — which the PO had
already overruled ("naming something a follow-up does not narrow a criterion that already covers it").
**A stale scope comment replicated across sites is a search key, not one defect**: grep the sentence, not
the symptom. And note the asymmetry worth preserving — one of the four (`workRows.ts:193`) was correctly
out on the merits (a label-lookup miss degrades a name to `''`, it hides no pickable item), so its
DISPOSITION was right while its stated REASON was the overruled one. Enumerate that case explicitly or a
fixer "corrects" a true disposition into a false one.

**Ruling shape to watch for:** a PO ruling that adds a test can EXTEND an existing criterion rather than
replace it. #321's reachability test extended the display-list criterion to option-lists; the chain read
it as replacing, which exempted a roll-up table ("nothing is picked here"). The PO corrected it in the
same words. When a ruling introduces a test, ask whether the prior criterion survives alongside it.

### The grep's own blind spot — follow the ARRAY, not the read (found 2026-09-11, #321 r5)

That pairing grep is **read-level**: it finds a `.items` assignment with no `.truncated` partner. It cannot
see the case where the flag IS captured at the read and a **second consumer of the same array** renders no
notice. On #321 the closure commit made the read-level audit come back clean, and one closed-set picker was
still uncovered: `libraryEditions` feeds the "Add to programme" select (wired) **and** `editionsByWorkId` →
`editionOptionsByRowId` → `work-edition-picker`, the per-row pin-edition select
(`RepertoireElement.svelte:409`), which got nothing.

**So the audit has two passes and I only had the first.** After pairing every read, take each flagged array
and follow its *derived* consumers one hop at a time (`grep -n '<arrayName>' <page>`, then each `$derived`
built from it). A notice wired at one consumer proves nothing about its siblings.

**Why that instance did not become a second RED, and the line I drew** — worth keeping, because the
consistency question is the hard part. The three feeds I RED'd were **mechanical**: flag present at the
read, notice shape already built, only threading missing, and every site carried a comment citing a reason
the PO had overruled. Nothing needed deciding. The pin-edition case is **not** mechanical: its control is
gated on `options.length > 0`, so under truncation the select does not render at all and the row falls
through to `work-no-edition` ("no edition") — a positive false statement, with no control left to hang a
trailing option on. Fixing it means deciding what the row should SAY, a design call inside an issue whose
fence reads "no paging UI, no filter/search, no cap changes". **Mechanical gap → RED; residual needing a
ruling → name it at the site, route it to the PO, don't block the merge.** The same branch had already
handled its `listMyRsvps` single-value residual that way with PO endorsement, so the line follows an
accepted precedent rather than my mood.

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
