# Pérotin Scratchpad

(*MVOX:Perotin*)

> Pruned 2026-09-15 (MVOX-23, ≤100-line convention) from 1623 lines. Full narrative lives in
> `git log -- teams/mvox-dev/memory/perotin.md` plus the commits/ledgers/issue threads each entry
> pointed at. Kept below: durable facts, current state, open items, standing patterns.

## Repo location + script catalog

`~/workspace-app` (`mvox-dev/mvox-app`) is the live app repo — `$REPO`, all current scripts/probes/
scratchpad. `~/workspace` (`mvox-dev/mvox_v4e_web`) is legacy/schema-repo — pre-2026-08-07-split
scripts + `docs/migration/findings/*.md` live only there, never migrated. Full inventory of current
work = `git log --oneline -- scripts/migrations/` (one committed result artifact per run in
`seed-results/`) — commits+artifacts+issue comments ARE the audit trail, not re-narrated here.

## Entu platform mechanics (durable — verified empirically; cite prior findings docs for detail)

- **Two DELETE endpoints**: entity `_id` (incl. prop-defs) → `DELETE /entity/{id}`. Property-VALUE
  `_id` → `DELETE /property/{id}`. Never interchangeable.
- **POST appends, never replaces**, for every non-formula property. Replace = DELETE old value(s)
  first, then POST.
- **CREATE** requires explicit `{type:'_type', reference:'<type-id>'}` — no dry-run-visible failure,
  only surfaces live. No parent-rights check ever; `creators: CreatorRule[]` in v4E is documentation
  only, zero enforcement.
- **Formulas**: no `_id` on their value; direct POST is silently overwritten by re-eval. Materialized
  value PERSISTS after source deletion (re-eval only on a prop-def formula-expr change, any non-
  formula POST on the instance, or a source-prop write). formula→plain: `DELETE /property/
  {formulaValueId}` off the prop-def entity.
- **`_sharing`**: parent's value auto-copies to a new child UNLESS the create payload sets it
  explicitly (explicit always wins); private/absent parent → child gets none (= private). Type-def
  `_sharing` is NEVER copied to instances. **`_inheritrights`**: absent ⇒ CREATE-time auto-fills
  `true` only if a `_parent` already has it `true`, else stays absent; at read/aggregate time absent
  behaves IDENTICALLY to explicit `false` — no inherit-by-default, no self-healing.
- **Rights tiers**: `_editor` = LIST/GET/POST-props/DELETE-prop-value, NOT `DELETE /entity` or any
  `rightType` prop (`_owner/_editor/_viewer/_expander/_sharing/_inheritrights/_noaccess` — all need
  `_owner`). A reference holds at most ONE active direct tier per entity — any new direct grant
  silently retires whichever was there before (non-monotonic, mechanism not in local `entu-api`
  clone). `_owner` folds into all four aggregate arrays as one document. Entity-level rights (even
  bare `_viewer`) read a `private`-tier PROPERTY in full — property sharing never filters on top of
  entity rights. List `count` always equals the caller's visible subset, at every tier tested.
- **Bucket exposure = 3-gate AND**: prop-def `_sharing` AND type-def `_sharing` (a CAP) AND instance
  `_sharing`. Missing any one is an apparent-success trap. Buckets are write-time snapshots — a
  prop-def fix does NOT retroactively fix existing instances; touch-save changes nothing about tier,
  only an actual value change or explicit `_sharing` re-write does.
- **File properties**: two-step, `POST` announce (filename+filesize+filetype all required, or silent
  empty shell) then `PUT` to a 60s-TTL signed S3-compatible URL. HEAD 403s on a signed URL (method-
  scoped) — use GET. Any replace path always mints a NEW file-property `_id`; staleness is structural.
  Bucket CORS is a real per-origin allowlist; `mvox.eu` + `dev.mvox.eu` confirmed admitted BY HEADER
  (#348, 2026-09-14) — Node `fetch` doesn't enforce CORS, cite as server-side ACAO only until the
  app's own browser fetch succeeds there (Gama). No client-side ETag — `Access-Control-Expose-Headers`
  is absent even for an admitted origin.
- **Pagination**: envelope always `{entities, count, limit, skip}`, no cursor. `name.string=X` = exact
  NFC match; `q=X` = case-insensitive substring. `mandatory:true` on a prop-def is a UI hint only.
- **API key vs JWT**: `entu_api_key` permanent (SHA-256); JWT 48h, IP-bound (`aud`, cross-IP = silent
  401); a key on a person with no OAuth account returns an anonymous-floor JWT — no real seat.

## Authorization gate — canonical (cross-ref `[[feedback_authorization_gate]]`)

Explicit inbound `"I authorize this run"` from **team-lead** is the only valid gate — not dry-run-
clean, not Bentham GREEN, not a categorical prior go-ahead covering a different script. Re-verify per
script/target-set even under a standing go-ahead; >15 min silence past an expected authorization →
status ping, never self-authorize. Some chains hold a FURTHER gate past team-lead (e.g. a PO nod) —
read the dispatch's exact wording, don't assume the standard 2-party gate is the whole chain.

## Privacy boundary register (current state)

- **polyphony = confirmed SYNTHETIC** end-to-end (PO 2026-08-05) — routine-ops pre-authorization
  applies here only. A handful of real team-owned fixtures live in it too (db-root/PO, Mihkel's own
  OAuth identity, a Test User, one real walkthrough signup) — out of the synthetic population.
- **mvox_crede = confirmed REAL PII** (Mihkel, 2026-09-06, #265 comment 5561632474) — real choir
  pilot, real names/emails. Any crede-targeting script/ledger is real-PII by default; use
  `sensitive: true` in `writeLedger` (routes to gitignored `seed-results/crede-instance/`).
- Estonian choir names (EFK/Sireen/RAM/TAM/EKBL/EMKL) — real, publicly-associated, acceptable. Seed
  persons elsewhere — synthesized Estonian-style names, `@example.ee`, no real PII.

## Currently deferred / not scheduled

- **Real member-seat empirical verification** — every live run I execute is db-root-omniscient;
  "write landed" ≠ "a real non-owner member sees it." No way to synthesize a second seat myself
  (`ENTU_ADMIN_KEY` confirmed anonymous-floor) — needs an actual second OAuth login.
- **#68 db-root `_owner` backfill — STRUCTURALLY BLOCKED** (2026-08-09): `_owner` is a rightType
  property needing `_owner` already held on the target — db-root holds none of the 72 flagged
  entities, chicken-and-egg via plain API. Needs an Entu admin override or manual admin-UI action.
  `lib/v4e-translator.ts` never sets `_sharing` on new prop-defs either (Josquin's territory, flagged).

## Standing patterns worth naming once

- **`BASELINE_*_IDS` frozen-set drift-check**: hardcode a population snapshot, diff live re-reads
  against it every run, name deltas individually rather than folding into a bare count. **Canary-
  first + read-back verify**: touch one representative row before a full sweep; throw on canary
  failure. **Ownership pre-check**: scan `_owner` for non-db-root holders before any instance
  mutation; hard-abort pre-write if found.
- **Ledger fields name what they attest** — an intended/config value vs. an observed/read-back value
  are different things; name the field so a reader can tell which without reading the source.
  **Artifact hygiene**: delete superseded pre-authorization dry-runs as you go, keep exactly one
  current artifact per script until the live run lands its own.
- **Single-tree serialization**: `git branch --show-current` before every commit — if not `main`,
  STOP, report branch+status+log evidence, never switch/stash/work around. Caught two real
  concurrent-chain collisions (2026-08-08) and one classifier-block escalation (#348, 2026-09-14).
