# Mvox Dev — Common Standards

## Team

- **Team name:** `mvox-dev`
- **Members:** team-lead/Palestrina (coordinator), byrd (frontend), josquin (database/API), tallis (testing), bentham (reviewer), comenius (i18n), victoria (requirements analyst), finn (research), perotin (data manager — on-demand)
- **Human PO:** The human user is the Product Owner. Victoria drafts requirements; the PO decides.
- **Fresh instances (Mihkel, 2026-09-30):** Finn is spawned per research task and released after it. Bentham is released at the end of each wave. Pérotin is spawned only for live-data jobs. Lessons travel in briefs and scratchpads, not in a long-lived context.

## Project

**Mvox** — web application for choral music sharing. Schema is mvox's own (independent since Mihkel's 2026-09-06 ruling), with v4E heritage — the `entu/research` repo's `docs/schema/v4E/` is historical reference, not a sync target.

Backed by Entu (entity-property database platform); no own database. Static SPA — the browser calls Entu directly with the user's JWT; Entu's grants are the only authority. Successor to the polyphony prototype, with refined data model and federation-ready design.

## Path Conventions

mvox-dev runs on a Linux substrate. Two anchor paths apply across prompts and memory files:

| Anchor | Resolves to | Default |
|---|---|---|
| `$REPO` | This repo's working tree | `~/workspace-app/` (resolve via `git rev-parse --show-toplevel` or the current working directory) |
| `$ENTU_RESEARCH` | Your local clone of [`entu/research`](https://github.com/entu/research) — READ-ONLY historical reference since 2026-09-06, never a PR target | `~/projects/entu-research/`. Override via shell env var if cloned elsewhere. |

When prompts or memory cite `$REPO/...` or `$ENTU_RESEARCH/...`, resolve relative to those anchors. Avoid baking absolute home paths into new content.

## Key References

- `CLAUDE.md` — project overview, architecture, commands, conventions
- Schema authority: the commissioning GitHub issue per type adjudicates; shape-of-record = `scripts/migrations/lib/mvox-schema-extensions.ts` + `docs/architecture/mvox-schema-extensions.md` (settled #263 — see "Schema Evolution" item 5). `entu/research` `docs/schema/v4E/` is HISTORICAL REFERENCE only (retired as canonical 2026-09-06)
- GitHub Issues — check open issues for task context

## Standing Rules

Standing rules: teams/mvox-dev/memory/rules.yaml — read on spawn.

## Author Attribution

All persistent text output (architecture decisions, PR descriptions, shared knowledge files, scratchpad entries, **issue bodies — at file time, not as a later edit**) must carry the author's name: `(*MVOX:<AgentName>*)`. Place on a new line below the block, or next to the section heading if you wrote the entire section.

## Source Comments

A comment says why the code is as it is (Mihkel, 2026-09-29, #506):

- At most 3 lines, each at most 100 characters.
- At most one comment per function or component, and only where the why is not obvious.
- Comments are under 10% of a file's lines. One comment line at the top of a file, saying what it is, is not counted (Mihkel, 2026-09-30, #562).
- No review rounds, finding numbers, or "slice N" narration — those go in the commit message or PR, never the source.
- When in doubt, leave comment out (Mihkel, 2026-09-29).

How `src/comment-rules.spec.ts` counts these, on every code file a change touches (#509):

- Consecutive comment lines are ONE comment, whatever their syntax — a 3-line block touching a `//` line is a 4-line comment, and a blank line between them is the fix.
- A block comment costs every line it spans, toward both the 3-line limit and the 10% share.
- The top line is the file's first non-blank line, if it is a whole-line comment (`// x`, `/* x */`, `<!-- x -->`); the rest of its run counts, and it still obeys the 3-line, 100-character and narration rules. A `.svelte` file gets it only for a `<!-- -->` line above `<script>`.
- The narration rule matches plural and suffixed shapes too: "findings 1a-1d", "slice 4b", "review-round 2".
- A comment TRAILING code (`const x = 1; // why`) is exempt from the 3-line and 10% counts — that line is code — but NOT from the narration and 100-character rules, which read the comment text alone. A `//` inside a string opens no comment, so URLs are safe.
- The check skips UNTRACKED files until that is fixed: `git add -N` a new file before running gates.

## Code Layout and Size

From #524 (Mihkel, 2026-09-30). The issue body is the source of truth.

- One folder per area: `src/lib/<area>/` holds that area's modules, components (PascalCase.svelte) and specs, each spec beside its file. `src/lib/components/` keeps only shared, area-free UI. Routes stay thin: `+page.svelte` composes the area's components. A helper lives with the area it serves, not the page it came from. Files move to this layout when a change touches them.
- The file-size ladder steps down 1500 → 1000 → 700 → 500 → 400 lines for source files (specs are off it). `src/routes/page.line-cap.spec.ts` gates the current step. A file a change adds must be at most the next step, and files over the next step are listed in the register.
- At each step boundary there is a consolidation run. Duplicates tagged IDENTICAL are merged as code-only changes. Those tagged DIFFERS go to the PO as product questions, with the differences listed.

## Tests and Source Text

A test that pins loose text in a source file (`readFileSync` + `toContain`/regex) is a deliberate, stated choice only (Mihkel, 2026-09-30). Ask for data or an export and test behaviour instead; a comment can satisfy a text pin, and a comment can trip a text fence. When a text scan is the right tool (a fence), its one-line why says so, and it ignores comments (`stripComments`).

**Review gate for every PR that adds or changes tests** (Mihkel, 2026-10-05; tests had reached 3.9:1 against source):
1. A test checks what the user gets (what shows, what is written, what is announced) — the standing rule in `memory/rules.yaml`. Exceptions are named guards with a stated reason (unmeasurable layout, focus ring, data-protecting order).
2. A rule that holds on every page is tested once, over a page list taken from the source, from the moment a second page needs it. No per-page or per-language copies.
3. Every new test fails when the thing it protects breaks; the PR names the break tried and what failed.
4. The PR states its test-to-source ratio: test and source lines added and removed, and the repo-wide ratio after it.

## Stack

Landed 2026-05-18 session 2. See `teams/mvox-dev/docs/architecture-decisions.md` for the rationale behind each row.

| Component       | Technology                     | Notes                                                                                                                                                                  |
| --------------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Framework       | SvelteKit 2 + Svelte 5         | Runes ONLY (`$state`, `$derived`, `$effect`, `$props`, `$bindable`) — never legacy `export let` / `$:`                                                                 |
| Platform        | Cloudflare Pages + Workers     | `@sveltejs/adapter-cloudflare`. Env vars only — NO D1, R2, KV, or Durable Objects                                                                                      |
| Backend         | Entu API                       | MongoDB + S3 under the hood; mvox has no own DB. Schema: mvox-independent (v4E-heritage; `entu/research` docs are historical reference only, 2026-09-06)               |
| File storage    | S3 via Entu signed URLs        | 60-second TTL; client uploads direct to S3 after the app requests the URL from Entu                                                                                    |
| Auth            | Entu OAuth, client-held JWT    | OAuth providers via Entu (Google, Apple, Smart-ID, Mobile-ID, ID-card, e-mail). Browser stores the Entu JWT (48h, no refresh) in localStorage; calls Entu's API directly |
| i18n            | Paraglide                      | 4 locales: en, et, lv, uk. Messages at `messages/{locale}.json`; generated TS at `src/lib/paraglide/`; usage `import * as m from '$lib/paraglide/messages.js'`         |
| Testing         | Vitest + Playwright            | Unit + E2E                                                                                                                                                             |
| Package manager | pnpm                           | Always pnpm, never npm. Flat single-app — no workspaces                                                                                                                |
| CSS             | Tailwind CSS v4                | Full class names only — no dynamic template literals                                                                                                                   |
| Repo layout     | Flat single-app SvelteKit      | `src/lib/`, `src/routes/`. No server code: static SPA, the browser calls Entu directly. NOT monorepo — defer `apps/` + `packages/` until a second deployable exists                       |

## Quality Gates

Before any PR:

- `pnpm check` — 0 type errors
- `pnpm test` — all tests pass
- Bentham code review (RED/YELLOW/GREEN)

## Decision Authority

### Team-lead CAN decide (without PO):
- Task routing and assignment to specialists
- Spawn order and agent lifecycle
- Branch strategy (feat/ vs fix/ naming)
- Dev environment operations (local backend setup, scratch data)
- PR merge timing (after Bentham GREEN)
- GitHub issue creation and closure
- Code review assignment

### Team-lead MUST escalate to PO:
- Production/remote backend changes (Entu schema edits, data migrations)
- Production deployment
- Architecture decisions (new entity types, auth changes, federation)
- Feature scope changes
- Priority disputes
- External communication
- Team composition changes

### When in doubt: act and report.
Make the decision, log it to your scratchpad, report to team-lead. PO may reverse, but waiting is the worse failure mode.

## TDD Workflow

### Story Branch Ownership Chain

Default chain (Mihkel, 2026-09-30): one fresh Josquin per issue (`josquin-<N>`), spawned from a brief, does RED and GREEN; Bentham alone reviews; team-lead merges via PR. Tallis, Byrd, Comenius and Victoria stay on the roster but are not in the default chain.

| Phase | Owner | May write | Passes to |
|-------|-------|-----------|-----------|
| 0. Issue | PO / team-lead (Victoria may draft) | GitHub Issues only | team-lead |
| 1. Assign | team-lead | brief `~/workspace/scratchpad/brief-<N>.md` | josquin-<N> |
| 2. RED + GREEN | josquin-<N> | failing tests first (`*.spec.ts` colocated with source; `tests/` for Playwright E2E), then the code that makes them pass | Bentham |
| 3. REVIEW | Bentham | review comments only (no file writes) | team-lead |
| 4. MERGE | team-lead | PR, squash-merge | team-lead (close issue) |

**Rules:**
1. Only the current owner may commit to the story branch.
2. Ownership transfer is explicit — send a handoff message to team-lead.
3. Finn never owns the branch. Any agent may request research from Finn at any phase.

### Handoff Message Format

```
## Story Handoff
- **Story:** #<issue-number> — <title>
- **Branch:** <branch-name>
- **From:** <agent> (phase: <RED|GREEN|i18n|REVIEW|MERGE>)
- **To:** <agent> (phase: <next-phase>)
- **Status:** <TESTS_WRITTEN | TESTS_PASSING | I18N_COMPLETE | REVIEW_VERDICT>

### What was done
<1-3 bullets>

### What to do next
<specific action for receiving agent>

### Files to start with
<2-3 key files>
```

### Merge Authority

Team-lead merges via PR after Bentham GREEN. Bentham never merges.

### Merge Procedure

Since 2026-09-19 (#415, Mihkel) main carries branch protection with the CI check `check + test` required, so a direct push to main is rejected.

```bash
git checkout <feature-branch> && git push -u origin <feature-branch>
cat > /tmp/pr-<N>.md <<'EOF'
...body (STATED CHOICES, review line, Closes #N)...

(*MVOX:<Name>*)
EOF
gh pr create --base main --head <feature-branch> --title "feat(#N): title" --body-file /tmp/pr-<N>.md
# the CI run can take a few seconds to register — poll before watching
for i in $(seq 1 30); do gh pr checks <feature-branch> >/dev/null 2>&1 && break; sleep 10; done
gh pr checks <feature-branch> --watch --fail-fast
gh pr merge <feature-branch> --squash --delete-branch --subject "feat(#N): title" --body-file /tmp/pr-<N>.md
git checkout main && git pull && gh pr view <number> --json state   # must say MERGED
```

A failing check means no merge: report the check name and the PR URL. Never `--admin`, never `--auto`.

### Issue Closure

**Only team-lead closes issues.** After merge, team-lead posts a structured completion comment:
- Summary of changes
- Files changed
- Tests added/modified
- AC verification

## Known Pitfalls

### Svelte 5

- Runes ONLY: `$props()`, `$state()`, `$derived()`, `$effect()`, `$bindable()`
- NEVER legacy `export let` or `$:` syntax
- REASSIGN arrays/objects to trigger reactivity (mutation doesn't work with runes)
- No server code: mvox is a static SPA and the browser calls Entu directly — no `src/lib/server/`, `+server.ts` or `$env/static/private`
- Sticky + overflow: NEVER put `overflow` on ancestors of `position: sticky` elements

### v4E / Entu

- **Single-hop formula traversal only.** `propertyName.*.property` and `_parent` work; chained forms like `ref.*._parent.*.name` silently return absent. Denormalize via intermediate single-hop formulas (case study Section D1).
- **Formula output is string or number only.** Declaring `type: reference` on a formula property doesn't enforce reference output — it silently coerces to string. Declare as `type: string` for honest schema (case study D3).
- **Formula evaluator bypasses rights** (`entu/api/utils/formula.js`). Use formulas for AGGREGATES (counts, sums) across rights boundaries — never project raw values (names, descriptions) via formulas, since that leaks (case study D6).
- **Rights islands at org boundaries.** `_inheritrights: false` on `organization` is load-bearing — blocks cascade from umbrella to collective. Don't flip it without a v4E schema change (case study B3).
- **Grants are the only authority.** The browser calls Entu directly with the user's own JWT; who may read or write is answered by the rights Entu returns on the target entity, never re-derived by the app. The short enumerated list of ops that run under something other than the user's own token (data-manager scripts, cron) stays written down and stays short (case study B4).
- **Field-level rights don't exist.** Rights are per-entity. If two roles need different write access to one entity, split it into two entities (case study D5).
- **No multi-hop reference picker scoping.** `reference_query` on a reference property type is static — no `{{_parent}}` substitution. Enforce contextual scoping in the UI (case study D7).

### Git Safety

- Never force-push or reset without team-lead approval
- Prefer new commits over amending
- Only commit to your assigned story branch

### Schema Evolution (mvox-independent)

**Ruled by Mihkel 2026-09-06** (supersedes the 2026-05-22 "v4E ours to maintain" convention and the entire upstream-first flow): **mvox is independent — the `entu/research` upstream flow is retired entirely.** v4E in `entu/research` is historical reference and design heritage, not a sync target; mvox evolves its own schema. First application: `schedule_item` (#246 — upstream PR entu/research#54 withdrawn on this ruling).

1. The PO ruling the standing rules require is recorded on the commissioning GitHub issue. That issue thread is the type's design record.
2. Trailer format: `PO-Approved: <date> <issue/comment ref or "verbal in session, logged by team-lead">`. The `Schema-Change: entu/research@…` trailer is **retired** — do not point new work at the upstream repo.
3. Bentham REDs any mvox PR whose diff references a new/changed entity type, property, formula, or rights default without a `PO-Approved:` trailer.
4. Type creation on live databases lands via seed/setup scripts, Pérotin's domain, with the usual authorization gate. Precision (Pérotin premise-check 2026-09-06): the `mvox_collective` "precedent" covers only *skipping schema.ts/PR/trailers* — its definition actually lives inline in entu-research's `setup-entity-types.ts` (foreign team, foreign repo). Do NOT add new types there; new definitions live workspace-app-side (home per item 5 below).
5. The durable **schema-of-record home** is settled (PO ruling 2026-09-06, mvox-app#263): `scripts/migrations/lib/mvox-schema-extensions.ts` (definitions, one `MvoxEntityDef` per type) + `docs/architecture/mvox-schema-extensions.md` (narrative) + `scripts/migrations/lib/ensure-schema-type.ts` (idempotent provision primitive). The commissioning issue is the **adjudication record** (fixed once settled); the `ts`/`.md` pair is the **shape-of-record** (current truth, synced with what's provisioned); `MvoxEntityDef.commissionedBy` is the permanent pointer from shape back to adjudication. **Guard:** on any conflict between shape-of-record and a provisioned db, the discrepancy is a defect to surface — never silently edit either side to match the other. Provisioning audience is per-commission: each commissioning issue answers explicitly whether the type lands on mvox_crede too (schema additions follow their commission's audience — no default-yes). Run ledgers for type-provisioning live in `seed-results/`, same as instance seeds.

## Research Support

When you need information gathered (GitHub issues, codebase lookups, schema references, dependency checks), message **finn** directly. He will collect the data and send you a markdown report. Use Finn before burning your own tokens on exploration.

### Research Request Format

```
## Research Request
- **From:** <agent>
- **Story:** #<issue> (or "general")
- **Urgency:** blocking | nice-to-have
- **Question:** <specific question>

### Context
<What you already know. What you've already checked.>
```

## Team-Lead Role Boundary

If you see team-lead doing work the standing rules keep from the lead, or reading source code for implementation understanding, message them with a reminder.

## Team Memory

Team memory lives in `teams/mvox-dev/memory/`, in the memory-kit shape (`memory/README.md`). The kit itself is `memory-kit/` — never edit it.

### Your Scratchpad

`teams/mvox-dev/memory/<your-name>.yaml`. You own this file — only you write to it. If you have none, create it in this shape when you first have something to keep:

```yaml
current:   # what the next session acts on; at most 15 rows; regenerated at close, never appended
  - label: WIP
    record: "≤ 100 characters"
    ref: "file path, #issue, or mihkel:<date>"
staging:   # fresh findings not yet promoted
  - label: LEARNED
    record: "…"
    ref: "…"
```

Labels: `DECISION`, `LEARNED`, `WARNING`, `WIP`, `DEFERRED`, `PATTERN`, `GOTCHA`.

### Where Else Things Go

- **Standing rules** — `memory/rules.yaml`, read on spawn after the kit's 8 in `memory-kit/memory/rules.yaml`.
- **PO / Gama rulings** — `memory/facts/rulings-<area>.yaml`.
- **Facts about a subject** — `memory/facts/<subject>.yaml`.
- **Situational know-how** (what to do when X comes up) — `memory/lessons/<slug>.md`. After adding or editing one, regenerate the index: `python3 memory-kit/tools/lesson-index.py teams/mvox-dev/memory`.
- **Something owed** — `memory/obligations.yaml`.
- **Settled architecture** — `teams/mvox-dev/docs/architecture-decisions.md` (format: decision, rationale, date). Any teammate may append; **bentham** stewards (prunes, resolves contradictions).
- **i18n naming and translation choices** — `teams/mvox-dev/docs/i18n-conventions.md`. **comenius** stewards, all read.

Lint before committing memory: `sh memory-kit/lint/memory-lint.sh teams/mvox-dev/memory --gate` (needs python3 + PyYAML).

### Startup Read List

On startup, before your first action:

1. Read `memory-kit/memory/rules.yaml`, then `teams/mvox-dev/memory/rules.yaml`
2. Read `teams/mvox-dev/memory/<your-name>.yaml` if it exists
3. Read `teams/mvox-dev/memory/lessons/index.yaml`; open a lesson only when its moment comes
4. Read shared docs relevant to your role:
   - **All roles**: `teams/mvox-dev/docs/architecture-decisions.md`
   - **comenius**: `teams/mvox-dev/docs/i18n-conventions.md`
   - **finn**: both docs, and `memory/facts/` as the research needs
5. Send intro message to `team-lead` saying you're ready

### When to Save

- **Immediately on discovery** — don't defer to session end; context compaction kills deferred writes. New rows go to `staging`.
- **During long tasks** — keep a `WIP` row in `current` up to date
- **Before shutdown** — see Shutdown Protocol below

### What to Save

Only persist knowledge that:

- Is non-obvious from reading the code or one grep away
- Is stable (won't change next commit)
- Cost real tokens to discover
- Would save a fresh you >5 minutes of re-discovery

One row = one label + one record of at most 100 characters + a `ref` saying where it came from.

### What NOT to Save

- Search paths ("I grepped for X")
- Transient failures already fixed
- Anything already in CLAUDE.md, MEMORY.md, or docs/
- Draft work that got superseded

## Shutdown Protocol

### Agent Shutdown

When you receive a shutdown request:

1. If you have in-progress state or new discoveries worth keeping, regenerate your scratchpad's `current` (what the next session acts on) and put fresh findings in `staging` — or promote them: rulings to `memory/facts/rulings-<area>.yaml`, know-how to `memory/lessons/`. If you have nothing to save, skip this step.
2. Send a closing message to team-lead with up to 3 bullets: `[LEARNED]`, `[DEFERRED]`, `[WARNING]`. Skip if nothing to report.
3. Complete steps 1 and 2 BEFORE calling shutdown_response. Do not batch these with the shutdown approval.

### Team-Lead Shutdown

The team lead shuts down LAST. Execute in this order:

1. **Regenerate `memory/team-lead.yaml` `current`** — at most 15 rows: state of play, expected first action, open items (every active task — startup restores the task list from these rows), decisions awaiting PO, loose ends, with concrete pointers in `ref`. Rewrite it whole; do not append. Fresh findings go to `staging` or get promoted (rulings to `memory/facts/rulings-<area>.yaml`, know-how to `memory/lessons/` + index regenerated).
2. **Lint** — `sh memory-kit/lint/memory-lint.sh teams/mvox-dev/memory --gate`.
3. **Send shutdown requests** — to all agents. Wait for each `teammate_terminated`.
4. **Persist inboxes** — copy pruned inboxes from runtime to repo:
   ```bash
   TEAM_CONFIG="$HOME/workspace-app/teams/mvox-dev"
   TEAM_DIR="$HOME/.claude/teams/mvox-dev"
   if [ -d "$TEAM_DIR/inboxes" ]; then
     mkdir -p "$TEAM_CONFIG/inboxes"
     for f in "$TEAM_DIR/inboxes/"*.json; do
       [ -f "$f" ] || continue
       jq '.[-100:]' "$f" > "$TEAM_CONFIG/inboxes/$(basename "$f")"
     done
   fi
   ```
5. **Commit and merge via PR** — memory files and inboxes, on a `chore/…-checkpoint` branch, then the Merge Procedure above (branch protection rejects a direct push to main). By convention, **pause before opening the PR** so PO can review the diff first (especially `team-lead.yaml` `current` and any memory additions).
