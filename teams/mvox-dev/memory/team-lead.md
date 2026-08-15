# Palestrina — Team Lead Scratchpad

> **Trimmed 2026-08-15 (session MVOX-10).** Full history in git.

### [NEXT SESSION] 2026-08-15 — session MVOX-10 → MVOX-11

mvox-app main @ `8443239`. **5 pipelines shipped, 24 issues closed.**

**Session MVOX-10 summary (2026-08-13 10:15 EEST → 2026-08-15 ~01:30 EEST):**

Five pipelines executed across ~36 hours:

1. **Epic #132 — Event management** (72 agents, ~6M tokens, ~9h)
   - 6-slice TDD: entity create utility, season creation + autocomplete, season management, event creation, series + bulk generator, agenda admin controls
   - T1-T2 GREEN, T3-T6 YELLOW. All 10 AC met. Closes #132.
   - Taught: blockerType guidance, progress tracking, reviewer probe cross-verification

2. **Fixes + features** (43 agents, ~1.7M tokens, ~3.1h)
   - S1: T6 follow-ups (#135-137) GREEN. S2: YELLOW batch GREEN.
   - S3: #134 role management YELLOW (wire-contract fix for Entu aggregated rights rollup)
   - S4: #123 language selector YELLOW. Closes #135-137, #134, #123, YELLOWs.

3. **Verification + fixes** (32 agents, ~2.3M tokens, ~2.8h)
   - S1: #142 _expander SPIKE — confirmed _owner/_editor implies _expander. Closed.
   - S2: UX fixes (#139, #141) GREEN. S3: NavShell tab merge (#140) GREEN.
   - S4: Correctness (#143, #144, #138) YELLOW. Closes #142, #139-141, #143-144, #138.

4. **Rights audit #133** (13 agents, ~812k tokens, ~1h)
   - SPIKE: 5 redundant, 4 necessary. S2: remove + document GREEN. Closes #133.

5. **Walkthrough findings** (36 agents, ~2.2M tokens, ~2.5h)
   - ALL GREEN (first all-GREEN pipeline). Admin fixes (#146-148), agenda toolbar (#149), roster arrows (#150), typography (#151). Closes #146-151.

**Totals:** ~270 agents, ~17M tokens, 24 issues closed, 5 Gama retros completed.

**Process lessons (cumulative):**
1. blockerType guidance prevents advisory findings from halting pipeline
2. Three validated slice types: SPIKE (investigation), skip-RED (known fixes), full-TDD (features)
3. Gama is trusted PO proxy — route decisions there, don't wait for Mihkel
4. Entu aggregated rights rollup: _owner folded into _editor, inherited:true from parents — bake into prompts
5. Reviewer live-probing can produce incorrect results — cross-verify with Pérotin
6. Pipeline template v2 candidates: pipelined RED, per-slice meta.phases, fix-batch pattern

**Parked:**
- #14 — Playwright RSVP coverage
- #152, #153 — from S3 YELLOW follow-ups (parked per Gama)

**Standing teammates this session:** finn, bentham, perotin (always-on)

(*MVOX:Palestrina*)
