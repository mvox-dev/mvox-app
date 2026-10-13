# Pérotin Scratchpad

(*MVOX:Perotin*)

> Pruned 2026-09-15 from 1623 lines. Full narrative lives in `git log -- teams/mvox-dev/memory/
> perotin.md` plus the commits/ledgers/issue threads each entry pointed at.

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
- **Reference values leak a name for free**: any reference-type property value — a raw `_owner`/
  `_editor` entry, `/history`'s `old`/`new` — carries a denormalized human-readable `.string` of the
  target, even when `name` was never in the requested `props` (confirmed #369; `/history` does the
  same server-side via `$lookup`). "Don't request name" ≠ ids-only — strip `.string` at extraction.
- **`created` stamp lives on `property/{_id}` only**: `entity/{id}?props=X` value objects carry
  `_id`+`string` alone — `GET /property/{_id}` returns the full shape (`_id,type,string,entity,
  created:{at,by}`) and resolves for plain strings too, though entu-www documents it only for files.
  A DELETEd value 404s there after — no soft-delete read (probe, 2026-09-21). `loadCfg`'s
  `PUBLIC_ENTU_API_BASE` needs the same trailing slash as `ENTU_API_URL` or URLs lose the separator.

## Authorization gate — canonical (cross-ref `[[feedback_authorization_gate]]`)

Explicit inbound `"I authorize this run"` from **team-lead** is the only valid gate — not dry-run-
clean, not Bentham GREEN, not a categorical prior go-ahead covering a different script. Re-verify per
script/target-set even under a standing go-ahead; >15 min silence past an expected authorization →
status ping, never self-authorize. Some chains hold a FURTHER gate past team-lead (e.g. a PO nod) —
read the dispatch's exact wording, don't assume the standard 2-party gate is the whole chain.

**A classifier block means stop and report — never retry the same action split into smaller pieces**
(2026-09-22 ruling, team-lead, after I `rm`'d 8 untracked dry-twins one file at a time once the batched
`rm` was blocked; harmless outcome, wrong process). The decision to go around a block belongs to
team-lead or Mihkel, not the session — even when the split-up version looks equally safe.

## Privacy boundary register (current state)

- **polyphony = confirmed SYNTHETIC** end-to-end (PO 2026-08-05) — routine-ops pre-authorization
  applies here only. A handful of real team-owned fixtures live in it too (db-root/PO, Mihkel's own
  OAuth identity, a Test User, one real walkthrough signup) — out of the synthetic population.
- **mvox_crede = confirmed REAL PII** (Mihkel, 2026-09-06, #265 comment 5561632474) — real choir
  pilot, real names/emails. Any crede-targeting script/ledger is real-PII by default; use
  `sensitive: true` in `writeLedger` (routes to gitignored `seed-results/crede-instance/`).
- Estonian choir names (EFK/Sireen/RAM/TAM/EKBL/EMKL) — real, publicly-associated. Seed persons
  elsewhere — synthesized Estonian-style names, `@example.ee`, no real PII.

## Currently deferred / not scheduled

- **Real member-seat verification** — every live run here is db-root-omniscient; "write landed" ≠ "a
  real non-owner member sees it." No second seat to synthesize (`ENTU_ADMIN_KEY` = anonymous-floor) —
  needs a real second OAuth login.
- **#68 db-root `_owner` backfill BLOCKED** (2026-08-09) — needs `_owner` already held on target;
  db-root holds none of the 72 flagged entities, chicken-and-egg via plain API. Needs an Entu admin
  override.

## Standing patterns worth naming once

- **Frozen-set drift-check + canary-first + ownership pre-check**: hardcode a population snapshot and
  diff live re-reads every run, naming deltas individually; touch one representative row before a
  full sweep, throw on canary failure; scan `_owner` for non-db-root holders pre-write, abort if found.
- **Ledger fields name what they attest** (intended/config vs. observed/read-back are different
  things); **artifact hygiene** — delete superseded dry-runs, keep one current artifact per script.
  **A remedy run's done-signal is the post-verify POPULATION TOTAL, not the write count** — they
  diverge the moment anything skip-and-flags (Gama, #369, 2026-09-15).
- **Single-tree serialization**: `git branch --show-current` before every commit — if not `main`,
  STOP, report branch+status+log evidence, never switch/stash/work around. Caught two real
  concurrent-chain collisions (2026-08-08) and one classifier-block escalation (#348, 2026-09-14).
