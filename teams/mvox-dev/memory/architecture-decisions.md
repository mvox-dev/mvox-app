# mvox-dev — Architecture Decisions

Settled patterns. **Bentham** stewards: prunes, resolves contradictions, appends new decisions as they land. Any teammate may propose additions via team-lead.

Format per entry: short title, decision, rationale, date. Most recent at the top within each section.

---

## Desk-readability conformance — bg-ancestor is the mechanism, `data-desk-text` is the narrow exemption (2026-06-14, session 33)

**Decision**: On the warm wood-grain desk surface (`.wood-bg` / `DeskSurface`), every visible leaf text node must sit on a real colored-background ancestor OR be a genuinely-exempt element. The exemption marker `data-desk-text` (a no-CSS `data-*` attribute) is NOT a conformance mechanism — it styles nothing. Conformance is achieved one of two ways:

1. **Real colored-bg ancestor** — `bg-paper` / `bg-paper-2`, a `PaperCard` / `PaperStack`, a cream panel (`#fbf9f3`, `rgba(251,249,243,0.8)`), or any element whose **computed `background-color` is opaque** (alpha > 0). This is the default and strongly-preferred path. Wrap state messages, list rows, and cards in a `bg-paper` container (e.g. `.state-msg-container`, `.series-card`, `.day-card` — all introduced session 33).
2. **`data-desk-text` exemption** — ONLY for genuinely bare-on-desk elements in the §2 exempt categories: big display titles (h1/h2 at display size) and handwritten-style floating marginalia (`font-display`/Caveat, often `absolute`-positioned, rotated). The `<Margin>` component takes an opt-in `exempt?: boolean` prop (default `false`) rather than a blanket tag, so the same component conforms via bg-ancestor when nested in a card (library) and exempts only when bare (about / auth pages).

**Review enforcement (Bentham)** — the verdict tiers, calibrated over 4 session-33 reviews:

- **RED**: `data-desk-text` on a **small/body-text element that is genuinely bare on the desk** — the marker is a *lie* (it doesn't make the text readable; it just silences the gate). Fix = give it a real bg-ancestor, not a tag. (Exemplar: ComingSoon "coming soon" eyebrow, RED'd sub-chain 1, fixed `2cc9b56`.)
- **RED**: a blanket component-level `data-desk-text` that exempts nested usages which already have a bg-ancestor (the marker leaks to conforming contexts). Fix = opt-in `exempt` prop. (Exemplar: `<Margin>` blanket tag, fixed `ea52da4`.)
- **YELLOW**: a **redundant** marker on an element that already conforms (has a colored-bg ancestor) AND/OR is a true §2 big-title. Not broken, but noise — and a test asserting the marker's *presence* is review-gate-artifact-in-production (sibling to the i18n-mock-leak guard smell). Fix = drop the attr + flip the test to assert ABSENCE. (Exemplar: agenda `.page-title`, YELLOW sub-chain 2, closed `chore/s33-yellows`.)
- **Audit tell**: `git grep <suspect_key_or_attr> <tip> -- src/` — a `data-desk-text` whose element has any `bg-*` / cream-bg ancestor is at best redundant; never accept the marker itself as evidence of conformance — check the actual ancestor chain.

**The Playwright bg-rule gate** (`tests/bg-rule.spec.ts`) enforces this on **public routes only** (`/`, `/about`, `/auth/login`); auth-guarded routes (library, seasons, roster/notices/settings) 302 to login and are covered by unit tests + Bentham's static backstop (hybrid-gate, spec §4.3). Gate mechanics that are load-bearing: walk runs inside one `page.evaluate()` (live refs, no selector round-trip); `.wood-bg` is the stop condition (checked before its own styles, so the desk gradient never false-passes); **only an opaque `background-color` counts** — `background-image`/gradients are NOT an independent conformance signal (a transparent gradient has `background-image !== 'none'` but zero coverage). Any element that paints coverage via a gradient/image MUST also declare a `background-color` fallback.

**Known latent gap (YELLOW-33.4)**: `LibraryMaster.svelte` `.master-paper` provides text coverage via a fade-to-transparent `linear-gradient` with no `background-color` fallback. Harmless today (library is auth-guarded, outside the gate), but if the gate is ever extended to authed routes, add `background-color: #fbf9f3` to `.master-paper` first (the gradient's 0–50% opaque region already gives the visual coverage; the declaration just makes the gate agree).

**Source**: Session 33 readability work — sub-chains 1–3 + `fix/s33-seasons-rehearsal-bg` + `chore/s33-yellows`. Full review trail + per-exemplar SHAs in `bentham.md` (the `data-desk-text` discipline arc). Lifted to settled patterns at session-33 shutdown so future desk-surface UI work consults one rule.

(*MVOX:Bentham*)

---

## Verify load-bearing identifiers against ground truth before asserting (2026-05-31, session 27→28)

**Decision**: Before any teammate asserts, acts on, or reports a load-bearing identifier — a commit SHA, a gate/test count, a file set, a deploy/prod status, a hash — they MUST verify it against ground truth (their own `git` / `curl` / file read) and gate the claim on a completed tool result read **in the same turn**. Never assert before the tool result returns. If you have not read the result this turn, you have no value to report.

**The discipline, in order of force:**

1. **Same-turn read gates every claim.** A number, SHA, or status that isn't quoted from a tool result completed this turn is a fabrication risk — do not write it. Expectation, memory of a prior run, or a teammate's report are not substitutes for reading the artifact yourself this turn.
2. **Blob-level proof settles disputes.** When two parties disagree about file contents (or a channel is unreliable), the arbiter is content-addressed: `git rev-parse <ref>:<path>` for the blob SHA, `git cat-file -p <blob>` (or `git hash-object <file>`) for the bytes. Rendered file text can be stale, duplicated, or dropped by a flaky channel; content hashes cannot. Prefer them for ground truth and never bend your own clean evidence to agree with authority — present the raw conflict plus a deterministic cross-check and let the hash arbitrate.
3. **Surface-and-stop beats shipping a confident fiction.** If your read and an assertion (yours, a teammate's, or a prior turn's) disagree, the artifact wins and the assertion is wrong. Say so and stop; don't paper over it to be agreeable or to look done.
4. **Staged-set gate before every commit.** Show `git diff --cached --name-only`, confirm the exact file set is intended, THEN commit. Catches stray scratchpad/doc/memory files sneaking into feature squashes and sweep-mutation over-reach.

**Rationale**: Session 27 ran on a badly flaky tool-channel — Bash/Read output was dropped, garbled, duplicated, and stale-buffered for nearly every agent and team-lead. Under that noise, load-bearing identifiers got fabricated: a full review verdict twice (Bentham), SHAs ~4× (Josquin), "verified" messages sent before the verify returned (team-lead). The four disciplines above are what held the line — and they are correct discipline regardless of channel health, so they are promoted from flaky-session survival tactics to standing team norms. The failure mode they prevent (asserting an unread identifier) is silent and high-blast-radius: a wrong SHA routes a review at the wrong commit; a fabricated gate count greenlights a broken branch.

**Review enforcement (Bentham)**: A verdict, handoff, or merge claim that quotes a SHA / gate count / file set / prod status NOT demonstrably read in the same turn is itself the defect — RED on a review verdict (the verdict is unsound), YELLOW elsewhere (trailer/handoff hygiene). My own session-27 fabrications (`CALIBRATION-FABRICATION-TWICE`, `BLOB-PROOF + AUTHORITY-CAVING LESSON` in `bentham.md`) are the calibrating exemplars: I caved my clean `2e12` blob read to team-lead's `2e9` report, then recovered via `git rev-parse <sha>:<path>` + `git cat-file -p`. The blob SHA was right; the social correction was wrong.

**Cross-links**: Sibling to `feedback_atomic_git_chaining` (chain `checkout && commit && push` in one Bash call to defend against shared-tree harness flips — same defend-against-a-lying-channel posture, at the write side) and the per-commit-GREEN decision below (the staged-set gate is the per-commit discipline's commit-time guard). The blob-proof technique also underwrites the merge-shape check (`git log --oneline branch..main`) — both rely on `git` plumbing as the immutable arbiter.

**Source**: Session 27 [NEXT SESSION] seed L121 (team-lead.md), the dominant lesson of a flaky-channel session. Lift requested by team-lead at session-28 dispatch; authored by Bentham as steward.

(*MVOX:Bentham*)

---

## Freeze the spec before dispatching a TDD chain (2026-05-31, session 27→28)

**Decision**: The RED spec is frozen at the moment the TDD chain is dispatched. Team-lead does NOT change the spec — structure, headings, acceptance criteria, i18n key set, or assertion shape — after RED is handed off. If a spec change becomes unavoidable mid-chain (PO redirect, discovered defect in the spec itself), team-lead PAUSES the chain, re-syncs every downstream agent who has not yet committed, and only then resumes. The spec update must not chase a moving branch.

**Rationale**: CHORE-72 (a static `/about` placeholder) churned roughly 3× more than its complexity warranted because the spec structure was changed (PO's 4-section pick) AFTER RED was dispatched. On a flaky channel the chain raced through the OLD structure first, producing: duplicate i18n keys (last-wins silently masking the correct values), a page and spec pinned to the wrong headings, plus a dedupe-correction commit and an alignment commit to recover. None of that work was wrong when authored — it was correct against a spec that had already moved. The cost is the re-sync that didn't happen, multiplied by every downstream agent racing the stale spec in parallel.

This is the spec-side complement to `feedback_no_parallel_branches` (only one feature branch active across the team at a time): that rule serializes branches so two chains don't collide; this rule freezes the contract within a single chain so the one active chain isn't racing a contract that's still being edited. Both target the same root failure — concurrent mutation of state the chain depends on.

**Review enforcement (Bentham)**: When a branch review shows churn that traces to a mid-chain spec edit — duplicate/last-wins i18n keys, page/spec heading mismatches mid-history, a dedupe or realign commit cleaning up a contract change — the tip can still be GREEN (the recovery commits did their job), but flag the process drift: the chain should have paused and re-synced rather than chased. Distinct from the legitimate mid-chain spec revisions I already adjudicate GREEN: the RED author correcting a spec that encoded the very bug the issue exists to fix (CHORE-77 `CALIBRATION-AC7-INTENT-CORRECTION`), and a GREEN agent improving a spec to match project conventions with intent preserved and disclosed in the commit body (CHORE-72 Task-15 rule, CHORE-75 / CHORE-74 adjudications). Those are same-intent refinements WITHIN the frozen contract; this decision bars CHANGING the contract (new structure, new AC, new key set) once the chain is live.

**Source**: Session 27 [NEXT SESSION] seed L122 (team-lead.md), self-inflicted on CHORE-72. Lift requested by team-lead at session-28 dispatch; authored by Bentham as steward.

(*MVOX:Bentham*)

---

## Responsive-layout review — structural class-presence tests can't catch broken computed layout (2026-05-31, session 26→27)

**Decision**: Responsive show/hide and overflow contracts have a computed-layout outcome that jsdom/happy-dom cannot evaluate — they have no layout engine, so a spec can assert "class X is present" but never "the element actually renders the intended display/visibility." Two RED triggers close the gap. Both are mandatory at review; both have a paired spec-strengthening requirement so the test layer constrains the real outcome, not just the markup.

### Trigger 1 — Single-axis overflow clip on a dropdown/popover host = RED

`overflow-x: hidden` (or `overflow-y: hidden`) on a box whose other axis is `visible` forces that other axis to compute to `auto` (CSS Overflow Module Level 3 §3.2). The box becomes a clip container and cuts any `position: absolute` / `position: fixed` descendant that intentionally paints outside it — dropdown menus, tooltips, popovers, `top-full` panels.

- **RED**: any single-axis overflow clip (`overflow-x-hidden` / `overflow-y-hidden`) on an element that hosts (is an ancestor of) an `absolute`/`fixed` descendant meant to paint outside the box.
- **Correct horizontal-overflow control for a flex row**: `min-w-0` + `truncate` on flexible children, `flex-shrink-0` on fixed children. Never a parent clip.
- **Standing audit**: `grep -rn "overflow-x-hidden\|overflow-y-hidden\|overflow-hidden" src/ --include="*.svelte"` on any component that hosts a dropdown/popover.
- **Spec strengthening**: a spec must not pin the clip mechanism itself as the desired state (CHORE-76 AC7 originally asserted the header *carried* `overflow-x-hidden` — the assertion encoded the bug). When the bug is the pinned mechanism, the spec moves with the fix (assert the clip is *absent* + truncation does the work). The companion viewport/paint-order check belongs in Playwright (see test-gaps.md CHORE-76/77).

### Trigger 2 — A `sm:`/`md:`/`lg:` display utility with no paired base `hidden` (or correct default) = RED

A lone responsive-show class (`sm:grid` / `sm:block` / `sm:flex`) only flips `display` *at and above* the breakpoint. Below it, the element renders in its tag's default `display` (block for a `<div>`) — so a "desktop-only" element with no base `hidden` is visible on mobile, in the wrong display mode.

- **RED**: any element with a `sm:`/`md:`/`lg:` display class that is meant to be hidden below the breakpoint but carries no base `hidden` (or other correct default). The canonical correct pattern is `hidden sm:block` (as on `library-master`); the anti-pattern is a bare `sm:grid` (as on `library-md-grid` before the fix).
- **Standing audit**: for every `data-testid` element with a `sm:`/`md:`/`lg:` display class, grep its className for a paired `hidden` — or confirm the element's default display IS the intended mobile state.
- **Spec strengthening**: when a component has a "hidden below breakpoint / shown above" contract, the spec must assert BOTH halves — the responsive-show class AND the base-hide class. Asserting only the `sm:*` half passes on markup that renders block-flow on mobile. Tallis has adopted this BOTH-halves assertion as a standing RED-phase sweep.

### Root cause (shared)

jsdom/happy-dom have no layout engine. A structural class-presence assertion (`className.contains('sm:grid')`, `className.contains('overflow-x-hidden')`) runs green while the COMPUTED display/visibility outcome is broken. Two consecutive CHOREs shipped this exact failure mode (CHORE-76 overflow → CHORE-78 grid-not-hidden). The fix is threefold: (a) the review triggers above catch the markup; (b) the paired spec-strengthening makes the test assert the full contract, not the partial one; (c) the genuinely computed-layout cases (does the element occupy zero box on mobile? is the panel within the viewport? does scroll-spy stay off below sm?) go to Playwright, where a real layout engine exists.

### Sources

- **Trigger 1**: CHORE-76 RED-76.1 regression (header `overflow-x-hidden` clipped AvatarMenu + nav-tab-menu dropdowns) → CHORE-77 fix (`overflow-x-hidden` → `relative z-30` on `MvoxNav.svelte`, branch `chore/nav-stacking-fix` @ `316ff02`). My own CHORE-76 GREEN review missed the CSS side-effect — encoded as `GOTCHA-OVERFLOW-FORCES-AUTO`.
- **Trigger 2**: CHORE-78 RED-78.1 (`library-md-grid` was `sm:grid` with no base `hidden` → desktop detail column bled into mobile below sm; fix `hidden sm:grid` on `LibraryMasterDetail.svelte`). Encoded as `CALIBRATION-STRUCTURAL-TEST-BLINDSPOT`.
- Sibling to the per-commit-GREEN and vertical-skin-neutrality decisions — the responsive-review complement. Lift proposed at session-26 shutdown, ratified + authored session 27.

(*MVOX:Bentham*)

---

## URL parameters override persisted state — project-wide resolution rule for UI state (2026-05-24, session 22)

**Decision**: For any UI state that has BOTH a URL representation AND a persisted representation (localStorage, IndexedDB, Svelte stores), resolution follows a fixed order.

**On read** (initial mount, navigation, hydration):

1. URL parameter — when present and valid.
2. Persisted store — when present and valid.
3. Application default — last resort.

**On user-initiated change** (click handlers, programmatic updates, etc.):

1. Update URL via SvelteKit soft-nav (`goto(...)` with `replaceState`/`noScroll` as appropriate).
2. Update persisted store.
3. UI re-renders from the derived store.

**Rationale**: Deep-linking + shareability is the win. A user can copy `https://mvox.eu/library?org=foo&work=bar` and paste into another tab, device, or share with a teammate, and the recipient sees the same view. The persisted store carries the silent everyday default (no params in URL → "where I was last time"). The two-write on change keeps both representations in sync so subsequent navigation without params still reads the right value. The read order (URL → persisted → default) honors the explicit-over-implicit principle: a URL param IS an explicit user choice (typed, pasted, or linked); the persisted store is a silent inference from prior behavior; the default is what we fall back to when neither speaks.

### Applies to (current + foreseeable)

| Pattern | Example use site |
|---|---|
| `?org=<id>` | Organization selector (CHORE-66, immediate) |
| `?work=<id>` | Library drill-down (future CHORE) |
| `?status=<x>` / `?sort=<x>` | Filter + sort state on list pages |
| `?q=<text>` | Search query |
| `?lang=<locale>` | Explicit locale override (Paraglide normally infers; URL is the escape hatch) |
| `?page=<n>` / `?cursor=<x>` | Pagination |
| Future | Tab selectors, drawer state, modal state — any state users may want to deep-link to |

### Doesn't apply to

- **Secret/sensitive state** (auth tokens, session ids, OAuth nonces) — never in URL. URLs leak via referer headers, browser history, server logs, screenshots.
- **Ephemeral UI state** (focus, hover, transient validation, animation state) — neither URL nor persisted. Lives in component-local `$state` only.
- **Server-side state** — Path C means we don't have server state to coordinate with; the rule is browser-side only.

### Convention shape

- localStorage key naming: `mvox.<scope>Id` for entity ids (e.g., `mvox.selectedOrgId`); `mvox.<scope>.<facet>` for compound state (e.g., `mvox.library.sort`).
- URL param naming: lowercase, short, matches the dimension it represents (`org`, `work`, `status`, `sort`, `q`, `lang`, `page`).
- When the URL and persisted store disagree at read time, the URL wins AND a backfill write to the persisted store happens (so the next "everyday nav" without params keeps the URL's intent). This is the "two-write" symmetry: change writes URL+store; read writes store-from-URL if they diverge.

### Spec exemplar

`docs/superpowers/specs/2026-05-24-navbar-auth-wiring-design.md` Section "Selected-org resolution" is the first concrete implementation. The MvoxNav `?org=` ↔ `localStorage('mvox.selectedOrgId')` ↔ first-org pattern is the canonical shape — read order URL → localStorage → first-account; change order goto-with-`?org=` → setItem → derived re-render.

### Review enforcement (Bentham)

Any future spec or PR that introduces UI state needing persistence MUST follow this pattern. Verdicts:

- **RED**: New state is persisted in localStorage but NOT also expressible in URL, and no reasonable "doesn't apply to" exemption (secret / ephemeral / server-only) applies. The shareability/deep-link contract is structural; opting out of it leaks state that other devs reasonably expect to round-trip.
- **RED**: URL param exists but persisted store is missing. Deep-links work but everyday nav forgets — asymmetric, surprising, and a regression on the prior session's UX.
- **RED**: Write order is reversed (persisted-first, URL-as-decoration). That lets reload diverge from URL: the user navigates explicitly, then a refresh silently rewrites the URL back from the store, hiding the deep-link they just executed.
- **YELLOW**: Implementation diverges in non-blocking ways — e.g., URL param works AND localStorage works AND read order is correct, but the localStorage key name doesn't follow the `mvox.<scope>Id` / `mvox.<scope>.<facet>` convention; or the `goto` call uses `pushState` where `replaceState` would avoid history pollution.

### Cross-links

- First implementation: CHORE-66 navbar auth wiring (org selector). Spec: `docs/superpowers/specs/2026-05-24-navbar-auth-wiring-design.md`.
- Browser-direct data path (parent decision): "Data path — browser-direct to Entu" below. Path C means there's no server-side hop to fight over state ownership — the browser is authoritative for UI state, which is what makes the URL ↔ localStorage symmetry work cleanly.
- Storage naming precedent: see the `entu/webapp` parity rules in the same Path C section (`token` / `accounts` / `user` unprefixed for Entu compatibility; `mvox.*` prefix for mvox-owned keys).

**Source**: PO direction 2026-05-24, session 22. First exercised in CHORE-66; lifted to settled patterns at dispatch time so subsequent UI state work has a single rule to consult rather than re-deriving from the exemplar.

(*MVOX:Bentham*)

---

## Dispatch-message `Co-authored-by:` trailers short-circuit prepare-commit-msg hook (2026-05-24, session 22)

**Decision**: Team-lead dispatch messages MUST NOT include `Co-authored-by:` lines in commit-message templates. Use `Contributors:`, `Reviewed-by:`, `Helped-by:`, or body prose for team attribution instead. Implementers writing their own commits follow the same rule.

**Rationale**: `.githooks/prepare-commit-msg` uses `git interpret-trailers --if-exists doNothing` to append the PO co-author trailer (`Mihkel Putrinš <mihkel.putrinsh@gmail.com>`). `interpret-trailers` deduplicates on trailer KEY, not on full value. When the dispatch-message template already contains ANY `Co-authored-by:` trailer — including malformed group forms like `Co-authored-by: Comenius, Tallis, Byrd, Bentham (review)` — the hook short-circuits on the existing key and the PO co-author trailer is silently dropped. The commit lands without the standing co-authorship convention being honored, and nothing surfaces at commit time.

**Exemplar**: session-22 squash `9637eee` (closes #62 + #63). Squash landed cleanly but lacks the PO trailer because the dispatch template ended with `Co-authored-by: Comenius, Tallis, Byrd, Bentham (review)`. PO call 2026-05-24: leave the one-commit drift, codify the rule.

**Rule**:
- Dispatch templates: attribution lives in body prose or under `Contributors:` / `Reviewed-by:` / `Helped-by:` (any sentinel that isn't `Co-authored-by:`).
- Genuine multi-author co-authorship: list each contributor on its own line as `Co-authored-by: Name <email>` with a real git identity + email. The hook's dedupe checks full value, so distinct properly-formatted lines all survive AND the PO trailer still appends.
- Never write malformed group-form `Co-authored-by:` (multiple names on one line, parenthetical notes like `(review)`, names without emails).

**Review enforcement (Bentham)**: Any commit on main or a feature branch missing the PO co-author trailer when other `Co-authored-by:` lines are present → YELLOW for trailer-discipline drift. Spot-check the commit message body for the group-form pattern; if found, the dispatch template was the cause.

(*MVOX:Josquin*)

---

## Per-commit GREEN on feature branches — every commit independently passes the full GREEN gate (2026-05-23, session 19)

**Decision**: Every commit on a feature branch MUST independently pass the full GREEN gate — not just the branch tip. The gate is the same as the GREEN-phase quality gate below:

```
pnpm check     # 0 type errors
pnpm test:unit # all tests pass
pnpm lint:fix  # zero lint findings after autofix
pnpm build     # builds clean
```

Intermediate broken states ("I'll fix it in the next commit") are not permitted. When a planned commit ordering would leave a transient broken intermediate, the GREEN-phase implementer surfaces-and-stops, proposes a re-sequence, and re-splits the work into atomic GREEN commits. The branch tip passing alone is not sufficient.

**Rationale**: CHORE-B (the Path C rewrite, `feat/chore-53b-rewrite`) is the canonical exemplar. The plan's literal step ordering would have produced two broken intermediates:

- **B11 (`hooks.server.ts` + `app.d.ts` strip)** — stripping cookie-reading before landing's `+page.server.ts` was updated would break landing's `PageData` typing mid-branch. Josquin surface-and-stop #1.
- **B12 (landing `+page.server.ts` → `{}`)** — emptying the server load before the `+page.svelte` stopped reading `data.session` would strip data the component still consumed. Josquin surface-and-stop #2.

The team adopted "Path 2: every commit GREEN" via re-sequence — B13a (wrapper extend) → B13b (svelte rewrite consuming the extended wrapper) → B12 (server-load strip, now safe because the consumer no longer reads it). Three atomic GREEN commits instead of one commit + two broken intermediates. Net branch: 15 implementer commits, zero broken intermediates, bisect-clean across both re-sequences.

This is sibling to the lint:fix-in-GREEN rule below — both rules close gaps between "tests pass at the tip" and "the branch is actually a clean unit of history." Per-commit-GREEN closes the gap for bisect viability and prevents the "transient broken-state hand-off lands in main on squash" failure mode.

**Review enforcement (Bentham)**: For any feature-branch review, spot-check `pnpm check` + `pnpm test:unit` on at least two non-tip commits (e.g., the first GREEN commit and a mid-branch commit). If any commit fails the gate, the branch is YELLOW pending re-sequence — not auto-RED, because the tip is what merges, but the audit trail loses bisect value and the re-sequence cost is owed back. Implementers who surface-and-stop on a plan-ordering bug instead of merging through a broken intermediate are doing the right thing; team-lead's role is to accept the re-sequence proposal, not push through the original ordering.

**Source**: CHORE-B branch `feat/chore-53b-rewrite` (session 17, 2026-05-23). Bentham's session-17 review note: "bisect viability + prevents transient broken hand-off landing in main on squash." Lift proposed end of session 17, parked through session 18, ratified session 19.

(*MVOX:Bentham*)

---

## GREEN-phase quality gate — `pnpm lint:fix` is part of GREEN, not optional (2026-05-23, session 16)

**Decision**: GREEN-phase agents (Byrd + Josquin) MUST run `pnpm lint:fix` before handing off to the next phase. Test-passing alone is not GREEN. The full GREEN gate is:

```
pnpm check     # 0 type errors
pnpm test:unit # all tests pass
pnpm lint:fix  # zero lint findings after autofix
pnpm build     # builds clean
```

Then hand off. The lint:fix step catches the divergence between "tests pass" and "code matches house style after Biome's view of it." Skipping lint:fix manufactures a downstream autofix commit that pollutes the PR history with whitespace + import-order changes that should have been in the GREEN impl commit.

**Rationale**: CHORE-A (PR #56) was the first GREEN cycle to exercise the lint scaffolding from CHORE-48 (`b9b3499`). `pnpm test` passed; `pnpm lint` did not. The result was a separate `db59557` autofix commit at the tip of the branch — palatable as a one-time scope-override on the first lint-cycle, but a smell that becomes noise if it repeats. Lift to a settled norm BEFORE CHORE-B GREEN so it doesn't compound.

**Review enforcement (Bentham)**: From CHORE-B forward, any GREEN handoff whose subsequent autofix commit changes more than the implementer's claimed scope is YELLOW. An autofix commit that ONLY changes whitespace/import-order is a smell but not a blocker; an autofix that touches function bodies, conditionals, or semantic structure is RED — the GREEN commit was misattributed work.

**Source**: Josquin's session-16 [PATTERN] entry on `bentham.md` review thread; lift endorsed by Bentham, ratified by team-lead. First exercised: CHORE-B onward.

(*MVOX:Bentham*)

---

## Bundled-migration RED → split-by-blast-radius (2026-05-22, session 13)

**Decision**: When a bundled migration script has a clean Layer N and a problematic Layer N+1, the recommended fix path is **split the script into two** — one ships now (the clean layer), one defers behind its own task (the problematic layer). This wins over fix-in-place when:

1. The clean layer unblocks downstream consumers immediately (no pessimization waiting on the broken layer).
2. The deferred layer's open questions get their own probe/empirical-verification budget without timeline pressure.
3. The audit trail is cleaner — one PR = one clearly-bounded migration outcome, instead of a single PR carrying mixed "this worked, this didn't, here's why" semantics.

Bentham's standing recommendation on bundled-migration RED-1 verdicts: **lead with "split here" before "fix in place,"** unless the layers are genuinely coupled (the same op cannot be safely run without the other half).

**Rationale**: First exercised on the photo-rename pre-stage (task #12 → #15). Combined Layer 1 (prop-def rename) + Layer 2 (instance-value migration with DELETE-then-POST on file properties) script was RED on Layer 2's file-payload-round-trip bug. Option A split landed Layer 1 only as `cleanup-rename-photo-prop-def-only-2026-05-21.ts`; Layer 2 deferred to task #14 pending empirical probe of Entu's POST-with-file-fields semantics (does it re-link to a pre-existing S3 object, or always require a fresh upload?). Layer 1 live-executed cleanly 2026-05-22 (`82727ca`); Layer 2 remains deferred without blocking downstream work. Total split cost ~50 lines of Pérotin work vs. open-ended fix-in-place + Entu-probe budget on the combined script.

**Source**: Task #12 RED + task #15 GREEN (Option A split); live execution `82727ca` 2026-05-22; task #14 carries the deferred Layer 2 work.

(*MVOX:Bentham*)

---

## File-property mutations must round-trip full file payload (2026-05-22, session 13)

**Decision**: Any DELETE-then-POST migration on file-typed properties (`type: 'photo'`, `type: 'file'`, etc.) must round-trip the COMPLETE file payload — at minimum `filename`, `md5`, `filesize`, S3 key, content-type — from the DELETEd value to the POST body. Posting `[{type: 'photo'}]` (empty file property) silently destroys the S3 file binding.

**RED triggers**:
- Any DELETE-then-POST script touching file properties whose POST body lacks ANY of the file payload fields (`md5`, S3 key, content-type, filesize, filename).
- Any probe script enumerating file-typed property values that captures only a subset of file fields. The probe's captured-data shape is the upper bound on what a downstream live-run can reconstitute.
- `EntuProperty` (`src/lib/server/entu/client.ts:32-38` or equivalent) used as the POST body type for file mutations — it currently declares only `string`/`number`/`boolean`/`reference` and is incomplete for file values. Extend or split into `EntuFileProperty` before any file-property mutation lands.

**Open question (gates Layer 2 / task #14)**: Does Entu's POST-with-file-fields path re-link to a pre-existing S3 object, or does it always require a fresh upload? Until verified via `_probe_` against a throwaway entity with a real file value, NO DELETE-then-POST migration on file properties is GREEN-eligible. If Entu requires fresh upload, the rename CAN'T be done as DELETE-then-POST on file properties at all — would need an Entu-side property-rename API, or accept-data-loss.

**Empty-probe-today ≠ safe-to-defer**: Any script whose manifest is built at runtime from a live `listEntities` call must have its dead-code paths correct, because the gap between dry-run and live-run is exactly when uploads can land. Reviewer posture: code-review the dead path AS IF it will fire; don't carry it forward as YELLOW just because the count is zero today.

**Rationale**: Surfaced in the photo-rename pre-stage RED-1 (task #12). The combined script's `executeMigration` path posted `[{type: 'photo'}]` (empty body) — would have silently dropped the S3 file binding if any avatar/logo value existed at live-run time. Today's dead code, but the runtime manifest enumeration in `buildInstanceEntries` is the explicit safety net for "value uploaded between dry-run and live-run."

**Source**: Bentham RED on `chore/perotin-rename-photo-prestage-2026-05-21` `05eb5df` (task #12). Findings doc `docs/migration/findings/v4e-rename-avatar-logo-to-photo-2026-05-21.md:85` prescribes the correct POST shape. Layer 2 deferred to task #14.

(*MVOX:Bentham*)

---

## Entu formula-to-plain conversion mechanic (2026-05-21, session 9)

**Decision**: To convert a formula property to a plain writable string on a type, DELETE the `formula` property VALUE from the prop-def entity (not the prop-def itself). Wire shape: `DELETE /property/{formulaValueId}` where `formulaValueId` is the `_id` of the formula value on the prop-def entity (not the prop-def entity `_id`).

After deletion:
- New instances: plain POSTs write and persist normally.
- Existing instances with stale formula-cached values: the cached value persists (consistent with Q4 — Entu retains materialized formula values after source deletion). A direct POST replaces the stale value with a single clean value — no pre-delete of the stale value needed. Formula-cached values have no `_id`, so Entu's POST path does not accumulate them alongside the new write — unlike the Q5 multi-value-append trap, where plain-string POSTs append rather than replace, requiring DELETE-then-POST for replace semantics.

**Corollary (formula-cache + `_id` interaction)**: Sanity-check or preserve-then-restore patterns that depend on a stable pre-image to restore to are BROKEN at the moment formula→plain conversion lands, because the pre-image (formula-cached value) has no `_id` to filter against. Any test-then-restore script that writes a probe value to a real entity whose original value came from a formula will lose the original on cleanup. **Use a throwaway entity for sanity checks, or use a real entity whose original value is itself an `_id`-bearing plain POST (e.g., seed-script-created instance).**

**Rationale**: Verified live against polyphony via `scripts/migrations/probes/probe-phase-d-formula-unwrap-2026-05-21.ts`. Unlocked Phase D sub-op 1 (converting `person.name` from formula `forename ' ' surname` → plain string to align live polyphony with v4E `schema.ts`). The "POST replaces stale formula cache without pre-delete" finding significantly reduces Phase D op count.

**Source**: Probe `probe-phase-d-formula-unwrap-2026-05-21.ts`, result artifact `probe-phase-d-formula-unwrap-2026-05-21T05-13-08-917Z.json`, findings doc `docs/migration/findings/entu-formula-unwrap-2026-05-21.md`. Session 9.

---

## Seed-data model — v4E-clean target shape (2026-05-20, session 8)

**Decision**: Seed scripts (`scripts/migrations/seed-*.ts`) write v4E-clean entities, NOT pre-v4E polyphony shape:

- **`person`**: plain `name: string` per v4E `schema.ts`. NO `forename` / `surname` (polyphony's legacy shape; Phase D retires those).
- **`member`**: required `person` reference + optional `current_section` reference + `status: "active"`. NO `name` on member (identity lives on linked person).
- **`organization`**: required `_parent.reference` to founder `person`. NO `org_type` / `contact_email` (deleted by Phase B + B.1). Umbrella↔collective distinction is structural (collective gets second `_parent` to umbrella org), not a property.
- **Multi-parent create**: founder + umbrella attached via two-POST sequence (POST create with founder; second POST appends umbrella to `_parent`). Per `project_entu_post_appends_multi_value` memory. Idempotency requires read-then-skip on the second POST.
- **Founder identity**: elected from the seed-created persons themselves (member-person founders). Reuses persons we're creating anyway; matches "founded by" semantic.

**Rationale**: Forward-looking work (seeds, new features, BFF contracts) targets the v4E schema as canonical truth. When `schema.ts` conflicts with polyphony's live state, **schema wins** — polyphony's divergence is the Phase B/C/D migration's job to close, not the seed's. Pérotin's session-8 dispatch surfaced three real schema conflicts (member.name doesn't exist; person required on member; org requires person parent), all settled by reading `$ENTU_RESEARCH/docs/schema/v4E/schema.ts` empirically.

**Source**: PO decisions session 8 (2026-05-20). Captured in `docs/migration/findings/seeding-source-plan-2026-05-20.md` + executed by `scripts/migrations/seed-collectives.ts` (merged at `a6ed6bb`).

---

## Entu mutation-op wire shapes (2026-05-20, session 8)

**Decision**: Empirical wire shapes for the three Entu mutation patterns, verified live by `scripts/migrations/probes/probe-mutation-ops-2026-05-20.ts` on polyphony:

| Op | Wire shape | Notes |
|---|---|---|
| **UPDATE** single property value | `DELETE /property/{old-value-id}` + `POST /entity/{id}` with new value | Entu POST APPENDS to multi-valued properties. Must DELETE old value before POST for replace semantics. |
| **REMOVE** single property value | `DELETE /property/{value-id}` | Clean, immediate. Verified via post-GET. |
| **DELETE_ENTITY** | `DELETE /entity/{id}` | Returns 404 on subsequent GET. Distinct from property-value delete. |
| **POST boolean property** | `POST /entity/{id}` with body `[{type: '<prop>', boolean: <true\|false>}]` | Replace semantics: DELETE existing value first then POST (same as UPDATE). Empirically confirmed by Phase D sub-op 5 (commit `88595c7`) — 6 successful `_inheritrights: false` flips on `organization` instances. |

Companion call-out: **prop-def DELETE** also uses `DELETE /entity/{prop-def-id}` (prop-defs ARE entities). The v12 Bug-1 fix + #56 wire-shape split established the distinction between entity-`_id` and property-value-`_id`:

- Entity `_id` (entity OR prop-def): `DELETE /entity/{id}`
- Property-value `_id` (one of the multi-values on an entity's property): `DELETE /property/{id}`

**Rationale**: These are the canonical mutation primitives. Future scripts MUST distinguish entity-`_id` from property-value-`_id` and route to the correct endpoint. Conflating the two led to two prior bugs (v12 Bug-1; #56). Bentham REDs PRs that conflate them.

**Source**: Probe result artifact `scripts/migrations/seed-results/probe-mutation-ops-2026-05-20T15-24-35-641Z.json`; #56 commit `a7b4774`; v12 commit (Phase B GREEN v12).

---

## Stack (2026-05-18, session 2)

**Decision**: mvox is a SvelteKit 2 + Svelte 5 (Runes) + TypeScript-strict + Tailwind CSS v4 application, deployed to Cloudflare Pages + Workers via `@sveltejs/adapter-cloudflare`. Backend is the Entu API (no own DB; MongoDB + S3 under the hood). Auth is Entu OAuth with a BFF pattern: SvelteKit server holds the Entu JWT in an httpOnly cookie and proxies all Entu API calls. i18n via Paraglide, locales `en` / `et` / `lv` / `uk`. Tests via Vitest + Playwright. Package manager: pnpm (no workspaces).

**Rationale**: Inherited shape from the entu-research POC (also SvelteKit + Entu OAuth + BFF + Cloudflare). mvox is the production fork; it shares only the v4E schema as a contract with entu-research (option b — schema-as-contract, see below).

**Source**: PO briefing in session 2; cross-checked against `$ENTU_RESEARCH/CLAUDE.md`.

---

## Repo layout — flat single-app SvelteKit (2026-05-18, session 2)

**Decision**: Flat single-app layout. `src/lib/`, `src/routes/`, `src/lib/server/` (server-only boundary). NOT a monorepo — no `apps/` or `packages/` directories.

**Rationale**: mvox is one deployable. Entu handles auth, so there's no separate auth gateway (polyphony had `apps/vault` + `apps/registry`, which justified its monorepo — that justification doesn't exist for mvox). Migration to monorepo is mechanical (`mkdir apps/mvox && git mv src apps/mvox/`) and can happen later if a second deployable emerges (mobile companion, admin panel, federation cron). Don't pre-pay.

**Source**: PO decision, session 2.

---

## v4E schema ownership — schema-as-contract (2026-05-18, session 2)

**Decision**: mvox does not own v4E. The schema lives in `entu/research` at `docs/schema/v4E/` and is the single canonical source. mvox consumes v4E as a contract (option b of the four-option matrix surfaced in session 2). entu-research's editor.html + case study stay accurate as living docs.

**Rationale**: Preserves entu-research's investment (editor, narrative README, case study). Symmetric for any future v4E consumer. Cost: cross-repo coordination for schema changes — manageable at the current change cadence. Migration path to a third dedicated schema repo (option d) is open if a third consumer ever appears.

**Source**: PO decision, session 2. Trade-offs evaluated in session-2 conversation.

---

## v4E schema mutation gate — commit trailer convention (2026-05-18, session 2)

**Decision**: When a mvox feature requires a v4E schema change:

1. Open a PR against `entu/research` first; get PO approval there.
2. After it lands, open the mvox PR with these commit trailers:
   ```
   Schema-Change: entu/research@<sha> "<short title>"
   PO-Approved: <date> <PO handle or "verbal in session, logged by team-lead">
   ```
3. Bentham REDs any mvox PR whose diff references new/changed v4E entity types, properties, formulas, or rights defaults without both trailers.

PO approval can be in-session verbal (logged by team-lead in scratchpad with timestamp) or written (GitHub comment / email). Strictness can ratchet up later if needed.

**Rationale**: Closes Bentham's session-1 flag #4. Convention-only (zero tooling), works across the repo boundary (the schema isn't in this repo). The trailer makes the dependency visible at review time; the entu-research PR provides the queryable audit history. Adopted essentially as Bentham's Option A proposal from his session-2 intro.

### Schema-alignment carve-out (2026-05-21, session 9)

A PR that closes drift between live data and an *already-landed* v4E `EntityDef` does NOT require the `Schema-Change` trailer. Only PRs that diff `entu/research/docs/schema/v4E/schema.ts` (new/changed `EntityDef`s, properties, formulas, or rights defaults) require the trailer. Bentham distinguishes:

- "Does this PR change what's in `schema.ts`?" → trailer required
- "Does this PR change live data to match what's already in `schema.ts`?" → no trailer

First exercised by Phase D sub-ops 1+3+4 (forename/surname retirement; `person.name` formula→plain; commit `adc41e8`) and sub-op 5 (`_inheritrights: false` on 6 orgs; commit `88595c7`). All four had no Schema-Change trailer on the justification that v4E `schema.ts` already declared the target shape; live polyphony was the drift to close.

### Upstream-PR ownership shift (2026-05-22, session 13)

**Update to step 1:** team-lead authors and opens the `entu/research` PR directly. No more "PO submits via the upstream GitHub UI" relay.

Procedure: branch in `~/projects/entu-research/`, edit `docs/schema/v4E/schema.ts`, run `pnpm build-schema` to regenerate `schema.json`, sweep `docs/schema/v4E/README.md` for narrative refs, commit with PO email trailer, push, `gh pr create`. PO reviews on the GitHub side.

Rationale: the earlier finding-doc → paste-into-UI relay stranded schema work across session boundaries (session 12 wrote the draft for the `avatar/logo → photo` rename; session 13 still needed PO action before any consumer could move). PO directive 2026-05-22: "from here forward — this schema is ours to maintain at entu-research". First exercised on entu/research#49 (the rename), opened by team-lead end-to-end.

What this changes:
- The session-12 finding-doc pattern (`docs/migration/findings/v4e-rename-*.md`) remains useful as **design rationale capture**, but is no longer the gating artifact.
- Mechanical changes (renames, note clarifications, regenerated artifacts) are team-lead's to execute.
- **Structural changes** (new entity types, new rights model, new sharing semantics) still consult PO before the upstream PR opens. "Ours to maintain" ≠ "ours to design unilaterally."

What stays unchanged:
- The `Schema-Change: entu/research@<sha>` + `PO-Approved: <date> ...` trailer convention on the consuming mvox PR.
- Bentham REDs mvox PRs missing either trailer.
- The schema-alignment carve-out above.

**Source**: PO directive, session 13, immediately after entu/research#49 opened.

**Source for the umbrella decision**: Bentham proposal session 2 + PO confirmation.

---

## Data path — browser-direct to Entu (2026-05-23, session 17, CHORE-53/Path C)

**Decision**: mvox does NOT proxy Entu data calls. The frontend authenticates via Entu's OAuth flow client-side and then talks to `api.entu.app` browser-direct, exactly the way Entu's reference frontend (`entu/webapp`) does. The Entu JWT lives in `localStorage` and is sent as `Authorization: Bearer` on every API call. The BFF (CF Worker) is reserved for OAuth coordination + a currently-empty list of genuinely-elevated future operations (transactional email, cron cleanup, federation reports). All data flows browser ↔ `api.entu.app` directly, with no SvelteKit server-side hop.

### Forcing function

After CHORE-50 + CHORE-51 unblocked live OAuth sign-in in session 15, every subsequent BFF-proxied data call 500'd. Root cause: Entu JWTs encode the issuing browser's IP in the `aud` claim; the BFF on Cloudflare Workers proxies from CF Frankfurt egress IPs, so every BFF call returns `401 Invalid JWT audience`. This is not a code bug — it is a foundational incompatibility between mvox's prior "httpOnly cookie + BFF proxy" pattern and Entu's IP-bound JWT design. Three paths considered (Path A: service-entity API key with mvox owning rights enforcement — rejected by PO 2026-05-23 ("if we have to own rights management, why use Entu at all"); Path B: ask Argo to relax IP-binding — rejected as it would weaken Entu's threat model; Path C: mirror `entu/webapp`). Path C selected. Full design at `docs/superpowers/specs/2026-05-23-chore-53-path-c-design.md`.

### Why this is structurally sound, not a downgrade

1. **It mirrors Entu's reference implementation.** `entu/webapp` (Entu's own open-source production frontend) uses localStorage + Bearer + browser-direct. If Entu ships future best-practice updates, mvox adopts them mechanically.
2. **It accepts Entu's threat model honestly.** IP-binding is the JWT-theft mitigation — a stolen token from a different IP is useless. The prior httpOnly-cookie wrapper *looked* more secure than localStorage, but the BFF proxy made the JWT unusable; the apparent security was theater because data flow could not happen at all.
3. **It realizes the open-platform stance.** Multiple Entu frontends (`entu/webapp`, mvox, future federation peers, third-party UIs) all run the same browser-direct pattern. "Open-platform stance for 3rd-party frontends" stops being aspirational doc text and becomes structurally enforced.
4. **Failure modes shrink.** Auth-cookie state machine vanishes (no "cookie expired but JWT valid" / "cookie present but JWT expired" / "cookie on wrong domain"). The CF-Workers-environment-differs-from-Node trap (CHORE-47 `process.env`) is structurally impossible because there is no CF Worker code in the data path.
5. **Test layer becomes honest.** Tests intercept `api.entu.app` at the network layer (MSW under CHORE-C); every layer runs the same code in tests as in production.

The honest non-win: XSS in mvox now grants the attacker the full Entu API surface as the user for the JWT's remaining lifetime, instead of only the routes the BFF explicitly exposed. The mitigation is IP-binding (stolen token used from a different IP = useless) — the same deal `entu/webapp` accepts. Defensive hygiene under Path C: strict CSP, no third-party scripts in the auth/data flow, careful review of any component that handles untrusted input. See spec §7.1.

### Architecture

```
Browser ──► api.entu.app          (data calls, Bearer from localStorage)
Browser ──► mvox BFF (CF Worker)   (OAuth coordination + future elevated ops only)
```

The BFF retains:

- `/auth/login` — server-renders the provider picker page (i18n stays).
- `/auth/[provider]/+page.svelte` — **client-side** OAuth init: constructs the init URL with state nonce + forward-compat `login_hint` from localStorage, then `window.location` redirects to `api.entu.app/auth/<provider>?next=...`. Mirrors `entu/webapp:app/pages/auth/[provider].vue`. No `+server.ts` here.
- `/auth/callback` — server-renders the spinner shell; client-side JS runs the JWT exchange (browser-direct to `api.entu.app/auth?db=...`) + writes `token` / `accounts` / `user` to localStorage.
- `/auth/logout` — `+page.svelte` that clears localStorage on mount; no server-side state to clear.

Deleted under CHORE-B: `/auth/+server.ts`, `/auth/cookie/+server.ts`, `/auth/logout/+server.ts`, `/api/organizations/+server.ts` + `[id]/sections/+server.ts` + all corresponding `.spec.ts` files. `hooks.server.ts` becomes a no-op (no cookie session under Path C).

### Storage and CSRF model

Browser storage layout:

| Key | Storage | Lifetime | Purpose | Cleared by |
|---|---|---|---|---|
| `token` | localStorage | until expiry / 401 / logout | Entu JWT (`Authorization: Bearer`) | logout, 401 |
| `accounts` | localStorage | until logout | Entu account list (multi-tenant) | logout, 401 |
| `user` | localStorage | until logout | Entu user metadata | logout, 401 |
| `mvox.last_provider` | localStorage | persistent | Last successful OAuth provider id | **logout only** (NOT 401) |
| `mvox.token_version` | localStorage | until version bump | Cache-bust sentinel on JWT shape changes | written by `setToken` only |
| OAuth `state` nonce | sessionStorage | single OAuth round-trip | CSRF protection for OAuth callback | callback verifies + deletes |

Naming rules:
- The first three keys (`token`, `accounts`, `user`) match `entu/webapp` exactly — same names, same shapes. Future devs reading `entu/webapp` source can apply that knowledge directly.
- mvox-specific keys are prefixed `mvox.` — clear namespace boundary, clear devtools signal.
- Return URL never lives in localStorage / sessionStorage independently; it rides inside the OAuth `state` payload (base64url JSON: `{ nonce, return_to, intent }`). Stale return URLs cannot outlive a single OAuth attempt — state is verified-then-consumed atomically on callback.

`/auth/logout` clears all five localStorage keys + sessionStorage; the next sign-in starts at the provider picker (no `login_hint`, no `prompt=none`, no carried account identifier) — load-bearing for users with multiple Google/Apple accounts mapped to different memberships. Involuntary re-auth on 401 (handled by `src/lib/api/wrapper.ts`) clears the same keys EXCEPT `mvox.last_provider`, then redirects to `/auth/<saved-provider>` with `intent=reauth`.

### Wire shapes (canonical)

The two browser-direct call shapes mvox uses today:

- **OAuth init redirect**: `window.location → ${ENTU_API_BASE}auth/${provider}?next=<callback-with-state>[&login_hint=<email>]`. Implementation: `src/routes/auth/[provider]/+page.svelte` → `src/routes/auth/[provider]/build-oauth-init-url.ts`.
- **Session-to-JWT exchange**: `GET ${ENTU_API_BASE}auth?db=${encodeURIComponent(db)}` with `Authorization: Bearer <session-token>`. Implementation: `src/lib/auth/exchange.ts`. Query-form (`?db=...`) is canonical — closes the path-form (`/{db}/auth`) drift that CHORE-50/51 surfaced.

`ENTU_API_BASE` is the single canonical Entu base URL constant from `src/lib/entu-config.ts` (today: `https://api.entu.app/`). The constant must be readable from client code — server-only access (`$env/dynamic/private`) is incompatible with the browser-direct call shape. The per-deployment tenant database is supplied at the call site via `PUBLIC_ENTU_DB` (`$env/static/public`); CF Pages sets it via `wrangler.json` `vars`.

### Carve-out vs default — terminology shift

Sessions 13 / 14 called the OAuth session-token-to-JWT exchange a "carve-out" — a narrow exception to a BFF-default rule. Under Path C the framing inverts: **browser-direct IS the default**, and the OAuth exchange is no longer special. The whole data path now runs the pattern that was previously labeled an exception. What stays narrow is the elevated-ops list (see "BFF elevated-ops list" decision below) — those genuinely cannot live client-side because their secrets / privilege cannot ship to the browser.

### Review enforcement (Bentham)

For any PR touching the auth or data path:

- **GREEN** when client-side calls go to `${ENTU_API_BASE}` directly via `src/lib/entu/client.ts` (or its consumers) and the resulting JWT is read from localStorage via `src/lib/auth/storage.ts`.
- **RED** for any NEW `+server.ts` under `src/routes/api/` that proxies Entu data calls. The data path is browser-direct by decision; new BFF data routes require team-lead approval + an entry on the elevated-ops list with rationale.
- **RED** for any client-side code that reads/writes the Entu JWT outside the `src/lib/auth/storage.ts` helpers (single source of truth for key names + version sentinel).
- **RED** for any code path that writes `user` / `accounts` AFTER `setToken` — see the token-version invariant in `storage.ts`. The contract is: callers MUST sequence `setUser` + `setAccounts` BEFORE `setToken`; `setToken` is the gate that publishes the new auth state with the current version. Reversing the order across a version bump leaves stale data without triggering the wipe.
- **RED** for any `apiRequest` consumer that handles 401 itself instead of letting the wrapper's interceptor fire. The 401 → clear-with-preserve-provider → redirect is centralized.

### What would trigger revision

The decision narrows or expands if any of the following lands:

1. **Entu retires `aud` IP-binding.** Then the data path could optionally move back through a BFF without breakage. The browser-direct default would still stand on the architectural-coherence grounds (Section "Why this is structurally sound" above), but the IP-binding necessity argument vanishes.
2. **Entu publishes a JWKS endpoint.** The BFF could cryptographically verify Entu-issued JWTs server-side, enabling stronger server-side guards on the elevated-ops list. Does not change the browser-direct data default.
3. **A second BFF-resident credential or capability emerges.** Treat as a request to expand the elevated-ops list (next section); requires team-lead approval + rationale.

### Cross-links

- GitHub issue: [mvox-dev/mvox_v4e_web#53](https://github.com/mvox-dev/mvox_v4e_web/issues/53).
- Full design spec: `docs/superpowers/specs/2026-05-23-chore-53-path-c-design.md`.
- Implementation plan: `docs/superpowers/plans/2026-05-23-chore-53-b-rewrite.md`.
- Entu base URL constant: `src/lib/entu-config.ts` (`ENTU_API_BASE`).
- Browser-side auth + API trio: `src/lib/auth/storage.ts` (localStorage helpers + version sentinel), `src/lib/auth/state.ts` (OAuth state payload + CSRF nonce), `src/lib/api/wrapper.ts` (Bearer injection + 401 interceptor).
- Reference frontend (mvox mirrors this): [entu/webapp](https://github.com/entu/webapp) — `app/utils/user.js`, `app/utils/api.js`, `app/pages/auth/[provider].vue`, `app/pages/auth/callback.vue`.
- Finn research: `docs/migration/findings/entu-api-key-expiry-2026-05-20.md` (JWT IP-binding mechanic, §3).
- CHORE-A merge: PR #56 — foundation libraries (`src/lib/auth/{storage,state}.ts`, `src/lib/api/wrapper.ts` skeleton, `EntuClient` move).
- CHORE-B branch: `feat/chore-53b-rewrite` — this decision's implementation.

**Source**: PO direction 2026-05-23, session 17. Brainstorm + spec authored same day. Supersedes the session-2 "BFF user-rights default" decision (the BFF-as-data-proxy default becomes moot — those routes do not exist under Path C) and the session-13 "Client-side Entu carve-out for IP-bound OAuth exchange" decision (today's default is no longer an exception). Closes YELLOW-50.1 + YELLOW-51.1 from session 15 (the wire-shape literal + parenthetical drift in the prior carve-out section is moot — the section is replaced; the canonical wire shapes are stated above).

(*MVOX:Bentham*)

---

## BFF elevated-ops list (2026-05-23, session 17, CHORE-53/Path C)

**Decision**: The BFF (SvelteKit server + CF Worker) hosts a single explicit enumerated list of operations that genuinely cannot run in the user's browser, because their secrets or privilege cannot ship to the client. Every other operation runs browser-direct against `api.entu.app` with the user's JWT (see "Data path — browser-direct to Entu" decision above).

**Current elevated-ops list** (seeded empty under Path C):

- *(none yet — list seeded empty; populate as real ops emerge)*

Anticipated future entries (no implementation today, no commitment to add):

- **Transactional email** (CHORE-6 Resend) — Resend API key cannot ship to the browser.
- **Cron cleanup** — orphan persons, expired invitations/applications, series past `end_date`. Service-account credentials; no human user context.
- **Federation reports** — curated cross-org aggregates. May require service-account read across rights islands.

Adding to the list requires:

1. A written rationale (in the PR description or scratchpad) for why the op cannot run browser-direct under the user's JWT.
2. Team-lead approval.
3. An update to this section listing the new op + the rationale summary.

**Rationale**: The rights model (Entu `_owner` / `_editor` / `_viewer` per entity) is the authoritative API contract. If the BFF has magic capabilities beyond user rights, alternative frontends (`entu/webapp`, mvox-mobile, federation peers, third-party UIs) become second-class. Heuristic: if a frequent user operation needs elevation, the role model is probably wrong. Per case study `$ENTU_RESEARCH/docs/case-studies/2026-05-polyphony-on-entu.md` §B4.

**Review enforcement (Bentham)**: New `+server.ts` under `src/routes/api/` that performs Entu writes/reads with anything other than the caller's JWT → RED unless the op is on this list. New BFF data routes that only proxy user-JWT calls (i.e., would have been browser-direct trivially) → RED for re-introducing the proxy pattern Path C deletes.

**Source**: PO direction 2026-05-23, session 17. Splits out from the prior "BFF user-rights default" decision (session 2) — that decision's BFF-data-proxy default is moot under Path C; what survives is this narrow elevated-ops list.

(*MVOX:Bentham*)

---

## Historical — Client-side Entu carve-out for IP-bound OAuth exchange (2026-05-22, session 13) (SUPERSEDED 2026-05-23 by "Data path — browser-direct to Entu")

**Decision**: A single, narrow carve-out to the BFF user-rights default above and to the canonical "no client→Entu" RED trigger. The OAuth session-token-to-JWT exchange step — and ONLY that step — runs in the user's browser, calling Entu directly. All other Entu API traffic continues through the BFF on the user's JWT.

### Where the carve-out lives

- **File**: `src/lib/auth/exchange.ts` (function `exchangeSession`).
- **Wire shape**: `GET ${ENTU_API_BASE}{db}/auth` with `Authorization: Bearer {sessionToken}` from the browser. `ENTU_API_BASE` is the single canonical Entu base URL constant from `src/lib/entu-config.ts`; whatever value it carries (currently `https://entu.app/api/`) IS the wire-shape literal — citing the constant rather than a hardcoded URL keeps this section drift-free across future base-URL unifications. Entu has historically served both subdomain (`https://api.entu.app/...`) and path (`https://entu.app/api/...`) forms; the canonical form is whatever `ENTU_API_BASE` resolves to today.
- **What flows back through the BFF**: the resulting 48h JWT is POSTed by the same client to `POST /auth/cookie`, where the server validates shape + `exp` and sets the `entu_jwt` httpOnly cookie. From that point onward, all Entu calls are BFF-proxied with the user's JWT, per the BFF user-rights default.

### Why this exchange must be client-side

Entu's session token is **IP-bound**: the resulting JWT's `aud` claim encodes the client IP at mint time, and Entu verifies `aud` on every subsequent API call (see `docs/migration/findings/entu-api-key-expiry-2026-05-20.md` §3). If the IP between session-token mint and JWT mint changes, the exchange silently produces an unusable JWT.

mvox deploys to Cloudflare Pages + Workers (see "Stack" decision above). CF Workers do not preserve the originating browser IP on outbound `fetch` — the call appears to Entu as coming from CF's edge network, not the user. Doing the exchange server-side would mint a JWT bound to a CF edge IP that the user's browser cannot use. Hence: the exchange must happen in the browser, where the IP matches what Entu expects.

This is a property of Entu's auth implementation, not a mvox design choice. Until Entu either drops `aud` IP-binding or publishes a JWKS endpoint that would let us verify Entu-issued JWTs server-side (and route the exchange through a trusted server context), the carve-out stays.

### Carve-out scope (what's allowed)

- Exactly one call path: the OAuth session-token-to-JWT exchange in `src/lib/auth/exchange.ts`.
- The Entu call uses ONLY the session token in `Authorization: Bearer` — no rights elevation, no service-account JWT, no API key.
- The resulting JWT MUST be handed off to `POST /auth/cookie` (server-controlled cookie set) before any further use. The browser does NOT cache or re-use the JWT directly.

### What stays disallowed (Bentham REDs)

- Any other client-side `fetch` to `entu.app` (any subdomain, any path) — outside `src/lib/auth/exchange.ts`. Reads, writes, file uploads, signed-URL retrieval, ALL Entu data traffic continues to flow through the BFF.
- Exposing the `entu_jwt` cookie value to JS (must stay `httpOnly`).
- Removing the `POST /auth/cookie` handoff step — the JWT must travel to the cookie via a server-controlled write, not via JS reading and setting `document.cookie`.

### What would trigger expansion or retirement

The carve-out narrows or disappears if any of the following lands:

1. **Entu publishes a JWKS endpoint.** Then the BFF can verify Entu-issued JWTs server-side, and we have an alternative path: keep the exchange client-side but additionally have the BFF cryptographically verify the JWT before setting the cookie. The carve-out itself doesn't change, but YELLOW-41.3 (JWT signature verification in `/auth/cookie`) closes.
2. **Entu retires `aud` IP-binding** (e.g., switches to a non-IP-bound mint that proves session-token validity by a different mechanism). Then the entire exchange can move server-side and the carve-out is removed — `src/lib/auth/exchange.ts` is deleted; `POST /auth/cookie` either disappears or becomes a strict redirect.
3. **A second IP-bound Entu operation appears.** Treat as a request to widen the carve-out: requires team-lead approval, scratchpad rationale, and an architecture-decisions update. Default posture is to refuse — find a non-IP-bound alternative first.

### Review enforcement (Bentham)

For any PR touching client-side Entu access:

- **GREEN** when the only client→Entu call is the exchange in `src/lib/auth/exchange.ts` and the JWT round-trips through `POST /auth/cookie`.
- **RED** for any other client-side `fetch` whose URL matches `entu.app` (any subdomain) — regardless of the verb, the data, or the operator's intent. Refactor to BFF-route first.
- **RED** for any change to `src/lib/auth/exchange.ts` that broadens the carve-out (additional Entu endpoints, additional verbs, additional credentials carried).

### Cross-links

- Entu base URL constant: `src/lib/entu-config.ts` (`ENTU_API_BASE`). Single source of truth for both server (`src/lib/server/entu/client.ts`) and client (`src/lib/auth/exchange.ts`).
- Finn research artifact: `docs/migration/findings/entu-api-key-expiry-2026-05-20.md` (JWT IP-binding mechanic, §3).
- Finn scratchpad: `teams/mvox-dev/memory/finn.md:70` (IP-binding summary line).
- Bentham #41 review: `teams/mvox-dev/memory/bentham.md` (session-13 #41 entry — pattern entries + 3 YELLOW carryforwards).
- CHORE-41 merge: commit `a506266` (`feat(#41): real OAuth wiring — client-side exchange flow`).
- CHORE-45 hardening (CSRF binding + Entu base URL unify): branch `feat/oauth-hardening`. Introduced `ENTU_API_BASE`; this section's wire-shape line was generalized to cite the constant at the same time (YELLOW-45.1).
- Related decision above: "BFF user-rights default (2026-05-18, session 2)" — this carve-out modifies the "all BFF route handlers default to user-rights" rule by adding a single client-side exchange step *upstream* of the BFF. The user-rights default itself is unchanged for the BFF surface.

**Source**: Bentham #41 review (session 13, 2026-05-22), lifted to settled patterns at team-lead direction the same session. Wire-shape generalization to constant: CHORE-45 / YELLOW-45.1, session 13.

(*MVOX:Bentham*)

---

## Formula rule — single-hop, aggregates-only across rights boundaries (2026-05-18, session 2)

**Decision**:

1. **Single-hop only.** v4E formulas use only single-hop traversal (`propertyName.*.property` or `_parent`). Chained forms like `ref.*._parent.*.name` silently return absent. Denormalize via intermediate single-hop formulas (case study D1).
2. **String or number output only.** Declaring `type: reference` on a formula property silently coerces to string. Declare as `type: string` for honest schema (case study D3).
3. **Aggregates only across rights boundaries.** The formula evaluator bypasses rights checks (`entu/api/utils/formula.js`). Use formulas for aggregates (COUNT, SUM, AVERAGE, MIN, MAX) — safe. Never project raw values (names, descriptions) across rights boundaries via formulas — would leak (case study D6).

Bentham REDs PRs that violate any of these.

**Rationale**: All three are platform behaviours verified in the polyphony POC. Encoded here so the team doesn't re-derive them.

**Source**: Case study Sections D1, D3, D6.

---

## Test fixtures pin production defaults — don't DRY them into the value under test (2026-05-21, session 10)

**Decision**: When a production module exports a constant that has a fixed default (e.g., `DEFAULT_BASE_URL = 'https://entu.app/api/'`), the colocated spec should keep the literal `'https://entu.app/api/'` **hardcoded** as a fixture rather than importing the constant. The hardcoded literal acts as a drift-detection pin: if the production constant changes without the spec being updated, the test fails — surfacing the change for review. Importing the constant into the spec turns the assertion into a tautology (`stubEnv(X, X)` always passes regardless of what `X` is) and removes the drift signal.

**Corollary — DRY discipline applies to production-side code, not to test fixtures.** Two production sources of truth for the same value (e.g., `client.ts:1` AND `+server.ts:4` both declaring `const DEFAULT_BASE_URL = ...`) IS a drift bug — fix it by exporting from one and importing into the other. A test that pins the same literal as a fixture is NOT a drift bug — it's the gate that catches drift in the production side. The two surfaces serve opposite purposes; DRY-ing across them collapses the gate.

**Mechanism**:
- Production-to-production drift: real risk. Fix: one source of truth, others import.
- Production-to-test drift: a *feature*, not a bug. The test's hardcoded literal is the "what the value used to be" pin; the assertion against the production constant is what makes the test fail-on-change.
- A test that imports the constant from production loses both the "what it was" pin and the "did it change?" signal — the test still runs and still passes, silently.

**Caveats**:
- Applies to constants representing *stable defaults* (URLs, timeouts, schema versions, port numbers) — values where intentional change should be a reviewable event.
- Does NOT apply to test fixtures derived from production schemas/types (e.g., `import type { Foo }` for type-only consumption; importing the *type* is fine, importing a *value* with the intent of using it as a comparand against itself is the antipattern).
- Does NOT apply to integration tests that need the same actual URL the production code uses to talk to a real backend — those should share the constant to ensure they target the same endpoint.

**Rationale**: Discovered during #20 (YELLOW-2 follow-up, Bentham review of commit `7e36c07`). Josquin's first attempt exported `DEFAULT_BASE_URL` from `client.ts` and imported it into `client.spec.ts:7` to "DRY the literal." The change passed all 288 tests because every test continued to assert what it had always asserted — but the env-stub line `vi.stubEnv('ENTU_BASE_URL', DEFAULT_BASE_URL)` had become a tautology that could no longer fail when the constant changed. Reverted in v2; the spec's literal stays hardcoded as a fixture pin.

**Source**: Bentham review of `7e36c07`, RED verdict, v2 dispatched. Session 10.

**Forward pointer (2026-05-22, session 13)**: The constant has since been renamed to `ENTU_API_BASE` in `src/lib/entu-config.ts` (CHORE-45 / commit `2fa3b7b`). The lesson generalizes to any production-side constant — the example above stays anchored to the original `#20` incident for audit-trail fidelity.

(*MVOX:Bentham*)

---

## Test data strategy — empty-state UI first, dogfood second (2026-05-18, session 3)

**Decision**: Build empty-state designs for every singer/conductor view (agenda, repertoire, programme list, etc.) as part of the GREEN phase for each story. Do not seed the polyphony Entu db with synthetic test events/works. Once manager/admin stories ship, real test data is created through mvox itself (dogfood path).

**Rationale**: The polyphony db (6 real Estonian choirs, 116 real members, 0 events, 0 works) is production-shaped — real users may eventually see it; seeding synthetic test entities would muddy it. Empty-state UI is needed for any new org joining mvox anyway, so the work isn't wasted. Trade-off: slower visual feedback during early dev (devs see empty screens until admin flows exist). Mitigation: the first end-to-end TDD cycle prioritises an admin story (likely "create event") so test data appears quickly downstream.

**Source**: PO decision, session 3 (Gap 4 of the 5 session-2 carryforwards).

**SUPERSEDED (2026-08-05, single-collective pivot — Mihkel).** Both the premise and the directive above are stale:
- **Data premise — WRONG.** polyphony's data is **SYNTHETIC fixture data**, not real. Mihkel, 2026-08-05: *"there is still no real data in Entu; import is the very last thing."* The "6 real Estonian choirs / 116 real members / production-shaped, real users may see it" line does **not** hold — treat polyphony's contents as synthetic throughout. (This exact stale line nearly changed a live-mutation risk calc mid-session; hence the correction in place.)
- **Standing policy — polyphony is the DEV/TEST collective.** Routine synthetic-data ops on it (seed fixtures, markers, test props, refreshes) are **pre-authorized** — no per-op PO escalation. Genuine *schema-shape* changes (new entity **types**, new sharing model) still get a quick PO nod. When production arrives, real collectives are **separate clones** (polyphony as the template); polyphony itself never holds real data.
- The old "do NOT seed synthetic test entities into polyphony" directive is **reversed** accordingly — seeding synthetic dev data into polyphony is expected under the dev-collective model.

See the single-collective pivot (mvox-app slice-1) and `~/.claude/.../memory/mvox-single-collective-pivot`. (*MVOX:Palestrina*)

---

## Vertical-skin neutrality — domain vocabulary lives in i18n values, never in code (2026-05-31, session 24)

**Decision**: Every human-facing reference to mvox's current vertical ("choir", "choirs", "choral", "sing", "voicing", etc.) MUST live in i18n message **values** (`messages/{locale}.json`), never in:

- Hard-coded strings inside `.svelte` templates
- Component file names (e.g., `ChoirNav.svelte`, `ChoirCard.svelte` — forbidden; use `EnsembleNav` / generic names)
- TypeScript type names (`type ChoirEntity = ...` — forbidden; use `EnsembleEntity` / generic)
- Function names, prop names, store names, route segments, CSS class names
- Comments, error messages, log lines
- i18n message **keys** themselves — keys stay vocabulary-neutral (`landing_hero_headline`, not `landing_hero_choir_headline`)

**Rationale**: PO confirmed (session 24, 2026-05-31) that mvox's v4E schema and component architecture are vertical-identical across choir / orchestra / chamber ensemble / mixed-voicing / instrumental groups — the product fits all of them. Current copy is choir-specific for personality + specificity reasons (lean character-rich; see `feedback_mvox_visual_personality`). Future verticals will land as net-new **skin layers** — a sibling messages bundle (e.g., `messages/orchestra/{locale}.json`) layered over the base, swapping the vocabulary without touching components, routes, or types. The skin swap MUST be a copy operation, never a refactor.

**What violates the rule**:
- ❌ A `.svelte` template with `<h1>For your choir.</h1>` baked in → must be `<h1>{m.landing_hero_headline()}</h1>`
- ❌ A component named `ChoirAvatar.svelte` → name it `EnsembleAvatar.svelte` (or `MemberAvatar.svelte`, etc.)
- ❌ A type `type ChoirSection = { ... }` → name it `type EnsembleSection` (or `type VoicePart`, etc., if vocabulary is genuinely part of the domain modeling vs. just labeling)
- ❌ An i18n key `landing_hero_for_choirs` → key should be `landing_hero_eyebrow` (semantic, not vocabulary)
- ❌ A route `/choir-settings` → use `/settings` (generic)
- ❌ A grep returns `// for the choir page` in code comments → comments use neutral language

**What does NOT violate the rule**:
- ✓ `messages/en.json` containing `"landing_hero_headline": "The back-of-house for your choir."` — values carry vocabulary; that's by design
- ✓ A spec or design doc using "choir" freely — specs are human-readable artifacts, not the skin surface
- ✓ Brand assets like the favicon, logo, or domain — they're not text strings under i18n control
- ✓ Test fixtures in `*.spec.ts` files using "choir" as test data — fixture data is not user-facing strings
- ✓ The `MvoxNav` component name (vendor-namespaced, not vertical-specific)

**Tallis RED triggers**: any spec touching new user-facing copy must assert the string comes from a `m.*()` call, not a literal in the template. Existing CHORE-66 / CHORE-67 specs already follow this pattern; new specs continue it.

**Bentham RED triggers**: any PR with new templates / components / types / routes / class names where the diff introduces a vertical-specific word ("choir", "sing", "voice" as a type word, etc.) gets RED with a pointer to this decision. Vocabulary-bearing values that flow through `m.*()` are fine; structural names that hardcode the vertical are not.

**Implementation cost when a future skin lands**: a new vertical (e.g., orchestra) becomes:
1. Author `messages/orchestra/en.json` + et/lv/uk variants (Comenius)
2. Wire skin selection (cookie? subdomain? route prefix? — defer that mechanism decision until expansion is taken)
3. Ship

Zero `.svelte` / `.ts` files touched. Zero tests rewritten (specs assert key invocation, not value equality). The skin swap is a copy operation.

**First exemplar of the rule**: CHORE-72 landing page redesign (spec `docs/superpowers/specs/2026-05-31-landing-page-design.md`). All `choir` references in the landing copy live in `messages/en.json` values; the 14 new components carry no vertical-specific names.

**Source**: PO decision, session 24, 2026-05-31. Q15 of CHORE-72 brainstorm.

(*MVOX:Palestrina*)

---

## Cloudflare Pages project name — `multivox` (2026-05-18, session 3)

**Decision**: The mvox Cloudflare Pages project is named `multivox`, served at `multivox.pages.dev` (and any future custom domain). Cloudflare account ID `1431b76f0b65e3d23833966744ff2bdf`. `mvox.pages.dev` is owned by a third party (live cert, dead origin); `multivox.pages.dev` and `mvox-app.pages.dev` were both free as of 2026-05-18.

**Rationale**: `multivox` matches the full product name from `$ENTU_RESEARCH/docs/user-stories.md` ("Multivox — User Stories"). Cleaner brand at the URL surface than `mvox-app`. Mild repo↔URL mismatch (`mvox_v4e_web` repo, `multivox` deploy) is acceptable since the repo is internal-facing and the URL is user-facing. entu-research's adjacent project (`entuphony.pages.dev`) follows the same "long name at the URL" pattern.

**Source**: PO decision, session 3 (Gap 5 of the 5 session-2 carryforwards). Availability check by Finn 2026-05-18, ownership confirmed via CF API token check (5 projects in account, no `mvox`).

---

(*MVOX:Palestrina*)

## Single-tree serialization protocol (git collision elimination)

**Decision** (PO directive, 2026-06-12 session 32, after 3 shared-tree branch flips in one day; supersedes the same-day "primary-tree-stays-on-main + agent worktrees" draft — PO: worktrees have never produced a clean session; they generate split-brain rather than preventing it):

1. **One tree.** All work happens in the shared primary tree (`~/workspace`). NO agent worktrees, no EnterWorktree, no `isolation: "worktree"`.
2. **One branch at a time.** The tree sits on `main` between chains and on the single active feature branch during a chain. Nothing else is ever checked out; no other branch exists.
3. **One actor at a time.** TDD chain tasks are strictly serial (session-24 Level 2) — the agent holding the current task is the ONLY actor running git or writing files. This includes team-lead: no doc/spec/plan commits while a chain is mid-flight. Specs + plans commit to main BEFORE the feature branch is created; everything else batches until the merge closes and the tree is back on main.
4. **No `chore/*` branches.** Probes, seeds, findings, scratchpads commit DIRECTLY to `main`, and run BETWEEN chains, never alongside one.
5. End-of-chain hygiene: feature branch deleted local+remote at merge; `git branch -a` between chains shows exactly `main` + `origin/main`.

**Rationale:** every shared-tree incident to date (sessions 14, 22, 24, 29, 32) reduces to two actors assuming different tree states. Serializing actors AND collapsing to one tree removes the failure mode structurally; worktree isolation was tried (sessions 29-32) and empirically leaked every time (branches created in the wrong tree, scratchpads split across trees, stale worktrees pinning branches).

**Bentham standing trigger:** any dispatch/plan that instructs worktree use, creates a `chore/*` branch, or schedules concurrent tree actors is RED.

(*MVOX:Palestrina*)

---

## Entities created directly under an organization MUST set `_inheritrights:true` explicitly (2026-06-15, session 37)

**Decision**: When creating an entity whose parent is an `organization` (the only v4E type with `inheritsRights: false` — the rights-island), the creating code MUST set `_inheritrights: true` **explicitly** on the new entity. In v4E this is the org's direct children: **seasons, sections, members, library** — anything parented directly on the org. Below that first level no explicit set is needed: inheritance auto-propagates at create (a child of a `true` season auto-gets `true`). The explicit set is required ONLY at the org→child boundary.

**Robust convention (preferred):** BFF create helpers + Pérotin's seed scripts should set `_inheritrights` explicitly to the schema's declared `inheritsRights` value for **every** type they create — this removes all dependence on Entu's create-time auto-propagation and the absent-default, and the org-boundary gap disappears by construction.

**Source**: Finn `entu/api` source-read + Pérotin live probe, S37 2026-06-15. Findings: `docs/migration/findings/slice3-membership-content-visibility-2026-06-15.md`. **Follow-up**: reflect this create-time gap in the v4E README (`entu/research`) rights section, which currently states only "org = `false` rights-island" without the children-must-set-explicitly consequence. PO-requested.

(*MVOX:Palestrina*)
