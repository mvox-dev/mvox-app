# Palestrina — Team Lead Scratchpad

> **Trimmed 2026-08-12 (session MVOX-8).** Full history in git.

### [NEXT SESSION] 2026-08-12 — session MVOX-8 → MVOX-9

mvox-app main @ `fb1759f`. **v1.0 code complete + UX polish + database tidiness delivered.**

**What happened this session (MVOX-8, 2026-08-11 23:15 EEST → 2026-08-12 ~17:00 EEST):**

Two major epics delivered in parallel. ~80 agents, ~18h elapsed, 611 Entu data mutations.

**Delivered:**
- #107 Auth token recovery: TDD pipeline (10 agents, ~94 min). Fix: 401 → clear cookie → redirect to sign-in
- #108 UX polish 1.0: TDD pipeline, 5 tasks #109–#113 (40 agents, ~4.7h). Section defects, sections UX, repertoire UX, attendance+library (#88), i18n+a11y
- #116 Database tidiness 2.0: data-tidy-pipeline, TD.1–TD.5 (30+ agents, 611 mutations). Name visibility (6 propdef widens + 55 touch-saves), type labels (18 bilingual), entity visibility (25 instance widens), tier alignment (130 narrow public→domain), member name formula, RSVP name formula
- #106 Event detail live gate: 14/14 clean, zero findings (PO walked)

**New workflow template:** `data-tidy-pipeline.js` — PREPARE/REVIEW/EXECUTE/VERIFY with §8.6 discipline. 4 iterations to get through opus reviewer (tier inversion discovery, PO label direction ruling, lending formula edge case). Proven pattern for Entu data ops.

**Issues closed this session:** #88, #106, #107, #109, #110, #111, #112, #113, #116, #117, #118, #119, #120, #121

**Key findings saved to team knowledge:**
- Tier inversion pattern: instance _sharing wider than propdef _sharing → name invisible in the served bucket. Season+person had this. Fix: align tiers (narrow instances or widen propdef).
- Person names were NOT missing — 128 real names existed, masked by tier inversion. #115 root cause retroactively explained.
- lending.name is a FORMULA — can't touch-save by re-POSTing name (no _id). Use non-formula property as touch vector.
- Event create path never sets _sharing explicitly → new events default to private. Needs follow-up issue.

**FIRST ACTION next session:**
1. #114 UX polish live gate FAILED (7 findings). Fix 1-6, #7 may be filed separately:
   1. Section creation broken — [+ New section] does nothing in live. TU.1 fix didn't hold.
   2. Sub-section test blocked (depends on #1)
   3. Empty section remove inconsistent — two Bass(0) rows, only one shows remove
   4. Work separators: unindent title for clearer visual separation
   5. Status row: (a) inline buttons not dropdown; (b) remove [pin], replace with unified edition picker
   6. Copy sort: nulls-last not working
   7. Language selector on profile page (NEW — PO may file separately)
   5 checks passed (spinner, collapse-all, drop-target, native picker, attendance hide)
2. #37 cleanup epic — still open, needs PO verification
3. Event create _sharing follow-up — file issue for the create-path default-to-private problem
4. Dry-run ledger cleanup — 12 dry-run JSON files in scripts/migrations/ledgers/ (only live ledgers committed)
5. Standing teammates (finn, bentham, perotin) need respawn
6. Perotin prompt path fixed this session (committed `9991309`)

**Standing teammates this session:** finn, bentham, perotin (always-on, spawned at session start)

(*MVOX:Palestrina*)
