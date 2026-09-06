# Mvox Dev — Common Standards

## Team

- **Team name:** `mvox-dev`
- **Members:** team-lead/Palestrina (coordinator), byrd (frontend), josquin (database/API), tallis (testing), bentham (reviewer), comenius (i18n), victoria (requirements analyst), finn (research), perotin (data manager — on-demand)
- **Human PO:** The human user is the Product Owner. Victoria drafts requirements; the PO decides.

## Project

**Mvox** — web application for choral music sharing. Schema is mvox's own (independent since Mihkel's 2026-09-06 ruling), with v4E heritage — the `entu/research` repo's `docs/schema/v4E/` is historical reference, not a sync target.

Backed by Entu (entity-property database platform); no own database. Acts as a BFF in front of Entu's API. Successor to the polyphony prototype, with refined data model and federation-ready design.

## Path Conventions

mvox-dev runs on a Linux substrate. Two anchor paths apply across prompts and memory files:

| Anchor | Resolves to | Default |
|---|---|---|
| `$REPO` | This repo's working tree | `~/workspace-app/` (resolve via `git rev-parse --show-toplevel` or the current working directory) |
| `$ENTU_RESEARCH` | Your local clone of [`entu/research`](https://github.com/entu/research) — READ-ONLY historical reference since 2026-09-06, never a PR target | `~/projects/entu-research/`. Override via shell env var if cloned elsewhere. |

When prompts or memory cite `$REPO/...` or `$ENTU_RESEARCH/...`, resolve relative to those anchors. Avoid baking absolute home paths into new content.

## Key References

- `CLAUDE.md` — project overview, architecture, commands, conventions
- Schema authority: the commissioning GitHub issue per type (see "Schema Evolution" below); schema-of-record home pending. `entu/research` `docs/schema/v4E/` is HISTORICAL REFERENCE only (retired as canonical 2026-09-06)
- GitHub Issues — check open issues for task context

## Communication Rule

**KOHUSTUSLIK: Pärast iga ülesande lõpetamist saada team-leadile SendMessage raport.** Ära mine idle ilma raporteerimata.

## Author Attribution

All persistent text output (architecture decisions, PR descriptions, shared knowledge files, scratchpad entries) must carry the author's name: `(*MVOX:<AgentName>*)`. Place on a new line below the block, or next to the section heading if you wrote the entire section.


## Stack

Landed 2026-05-18 session 2. See `memory/architecture-decisions.md` for the rationale behind each row.

| Component       | Technology                     | Notes                                                                                                                                                                  |
| --------------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Framework       | SvelteKit 2 + Svelte 5         | Runes ONLY (`$state`, `$derived`, `$effect`, `$props`, `$bindable`) — never legacy `export let` / `$:`                                                                 |
| Platform        | Cloudflare Pages + Workers     | `@sveltejs/adapter-cloudflare`. Env vars only — NO D1, R2, KV, or Durable Objects                                                                                      |
| Backend         | Entu API                       | MongoDB + S3 under the hood; mvox has no own DB. Schema: mvox-independent (v4E-heritage; `entu/research` docs are historical reference only, 2026-09-06)               |
| File storage    | S3 via Entu signed URLs        | 60-second TTL; client uploads direct to S3 after BFF requests the URL from Entu                                                                                        |
| Auth            | Entu OAuth + BFF JWT cookie    | OAuth providers via Entu (Google, Apple, Smart-ID, Mobile-ID, ID-card, e-mail). SvelteKit server stores Entu JWT (48h, no refresh) in httpOnly cookie; proxies all API |
| i18n            | Paraglide                      | 4 locales: en, et, lv, uk. Messages at `messages/{locale}.json`; generated TS at `src/lib/paraglide/`; usage `import * as m from '$lib/paraglide/messages.js'`         |
| Testing         | Vitest + Playwright            | Unit + E2E                                                                                                                                                             |
| Package manager | pnpm                           | Always pnpm, never npm. Flat single-app — no workspaces                                                                                                                |
| CSS             | Tailwind CSS v4                | Full class names only — no dynamic template literals                                                                                                                   |
| Repo layout     | Flat single-app SvelteKit      | `src/lib/`, `src/routes/`, `src/lib/server/` (server-only boundary). NOT monorepo — defer `apps/` + `packages/` until a second deployable exists                       |

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

Only one agent (or defined pair) owns the working branch at any moment. Ownership transfers explicitly via handoff message.

| Phase | Owner | May write | Passes to |
|-------|-------|-----------|-----------|
| 0. Issue | Victoria | GitHub Issues only | team-lead |
| 1. Assign | team-lead | (creates branch only) | Tallis |
| 2. RED | Tallis | `*.spec.ts` colocated with source; `tests/` (Playwright E2E) | Byrd and/or Josquin |
| 3. GREEN | Byrd + Josquin | Byrd: `src/lib/components/`, `src/routes/**/*.svelte`, `src/lib/types.ts`. Josquin: `src/lib/server/`, `src/routes/**/+page.server.ts`, `src/routes/**/+server.ts`, `src/routes/api/` | Comenius |
| 4. i18n | Comenius | `messages/{en,et,lv,uk}.json`; minimal `m.*()` substitutions in `.svelte` / `.ts` | Bentham |
| 5. REVIEW | Bentham | review comments only (no file writes) | Josquin |
| 6. MERGE | Josquin | PR creation, squash-merge | team-lead (close issue) |

**Rules:**
1. Only the current owner may commit to the story branch.
2. Ownership transfer is explicit — send a handoff message to team-lead.
3. Byrd + Josquin co-own GREEN phase. Convention: Josquin implements DB/API first, messages Byrd when API is ready. Byrd implements UI against the API.
4. Comenius may be skipped if the story has no user-facing strings. Team-lead decides at assignment.
5. Finn never owns the branch. Any agent may request research from Finn at any phase.

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

Josquin merges after Bentham GREEN + team-lead approval. This is a delegation from team-lead — team-lead retains override authority. Bentham never merges.

### Merge Procedure

**Always merge locally, never via `gh pr merge`.** This ensures the `prepare-commit-msg` hook runs and adds the co-author trailer.

```bash
git checkout main
git pull
git merge --squash <feature-branch>
git commit -m "feat(#XXX): description"
git push
```

Then close the PR and delete the branch:
```bash
gh pr close <number>
git push origin --delete <feature-branch>
```

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
- Server-only code MUST be in `src/lib/server/` — never import server modules in client
- Sticky + overflow: NEVER put `overflow` on ancestors of `position: sticky` elements

### v4E / Entu

- **Single-hop formula traversal only.** `propertyName.*.property` and `_parent` work; chained forms like `ref.*._parent.*.name` silently return absent. Denormalize via intermediate single-hop formulas (case study Section D1).
- **Formula output is string or number only.** Declaring `type: reference` on a formula property doesn't enforce reference output — it silently coerces to string. Declare as `type: string` for honest schema (case study D3).
- **Formula evaluator bypasses rights** (`entu/api/utils/formula.js`). Use formulas for AGGREGATES (counts, sums) across rights boundaries — never project raw values (names, descriptions) via formulas, since that leaks (case study D6).
- **Rights islands at org boundaries.** `_inheritrights: false` on `organization` is load-bearing — blocks cascade from umbrella to collective. Don't flip it without a v4E schema change (case study B3).
- **BFF user-rights default.** SvelteKit server proxies as the authenticated user via their Entu JWT. Elevated ops live on an explicit enumerated list (cron cleanup, federation reports); add to that list only with team-lead approval (case study B4).
- **Membership-rights invariant.** Any explicit `_owner` / `_editor` / `_viewer` grant on an org-subtree entity requires an active `member` for that person in that org. BFF enforces (case study B2).
- **Field-level rights don't exist.** Rights are per-entity. If two roles need different write access to one entity, split it into two entities (case study D5).
- **No multi-hop reference picker scoping.** `reference_query` on a reference property type is static — no `{{_parent}}` substitution. Enforce contextual scoping in your BFF / UI layer (case study D7).

### Git Safety

- Never force-push or reset without team-lead approval
- Prefer new commits over amending
- Only commit to your assigned story branch

### Schema Evolution (mvox-independent)

**Ruled by Mihkel 2026-09-06** (supersedes the 2026-05-22 "v4E ours to maintain" convention and the entire upstream-first flow): **mvox is independent — the `entu/research` upstream flow is retired entirely.** v4E in `entu/research` is historical reference and design heritage, not a sync target; mvox evolves its own schema. First application: `schedule_item` (#246 — upstream PR entu/research#54 withdrawn on this ruling).

1. **PO sign-off before build is unchanged**: new entity types, property shapes, rights or sharing semantics still require an explicit PO ruling, recorded on the commissioning GitHub issue. That issue thread is the type's design record.
2. The mvox PR carries `PO-Approved: <date> <issue/comment ref or "verbal in session, logged by team-lead">`. The `Schema-Change: entu/research@…` trailer is **retired** — do not point new work at the upstream repo.
3. Bentham REDs any mvox PR whose diff references a new/changed entity type, property, formula, or rights default without a `PO-Approved:` trailer.
4. Type creation on live databases lands via seed/setup scripts, Pérotin's domain, with the usual authorization gate. Precision (Pérotin premise-check 2026-09-06): the `mvox_collective` "precedent" covers only *skipping schema.ts/PR/trailers* — its definition actually lives inline in entu-research's `setup-entity-types.ts` (foreign team, foreign repo). Do NOT add new types there; new definitions live workspace-app-side (home per the pending schema-of-record decision).
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

The team-lead is a coordinator only. If you observe team-lead doing any of the following, message them with a reminder:
- Editing source code files
- Running builds, tests, or deployments
- Writing git commits or pushing code
- Reading source code for implementation understanding

## Team Memory

### Personal Scratchpads

Each teammate maintains a personal notes file at `teams/mvox-dev/memory/<your-name>.md`.
You own this file — only you write to it. Keep it under 100 lines; prune stale entries.

### Shared Knowledge Files

For cross-cutting discoveries, append to the relevant shared file in `teams/mvox-dev/memory/`:

- **`architecture-decisions.md`** — settled architectural choices (format: decision, rationale, date). Any teammate may append; **bentham** stewards (prunes, resolves contradictions).
- **`test-gaps.md`** — untested areas for triage. **tallis** appends, **victoria** triages into issues.
- **`i18n-conventions.md`** — naming rules, tricky translation choices. **comenius** stewards, all read.

### Startup Read List

On startup, before your first action:

1. Read `teams/mvox-dev/memory/<your-name>.md` if it exists
2. Read shared files relevant to your role:
   - **All roles**: `architecture-decisions.md`
   - **byrd, josquin**: `architecture-decisions.md` (API contracts, component patterns)
   - **tallis**: `test-gaps.md`
   - **comenius**: `i18n-conventions.md`
   - **bentham**: `architecture-decisions.md`, `test-gaps.md` (for review calibration)
   - **victoria**: `test-gaps.md` (for triage)
   - **finn**: all shared files (for research context)
3. Send intro message to `team-lead` saying you're ready

### When to Save

- **Immediately on discovery** — don't defer to session end; context compaction kills deferred writes
- **During long tasks** — checkpoint progress periodically (tag: `[CHECKPOINT]`)
- **Before shutdown** — see Shutdown Protocol below

### What to Save

Only persist knowledge that:

- Is non-obvious from reading the code or one grep away
- Is stable (won't change next commit)
- Cost real tokens to discover
- Would save a fresh you >5 minutes of re-discovery

Use tags: `[DECISION]`, `[PATTERN]`, `[WIP]`, `[CHECKPOINT]`, `[DEFERRED]`, `[GOTCHA]`,
or role-specific tags. Date every entry.

### What NOT to Save

- Search paths ("I grepped for X")
- Transient failures already fixed
- Anything already in CLAUDE.md, MEMORY.md, or docs/
- Draft work that got superseded

## Shutdown Protocol

### Agent Shutdown

When you receive a shutdown request:

1. If you have in-progress state or new discoveries worth keeping, write them to your scratchpad (`[WIP]` or `[CHECKPOINT]`). If you have nothing to save, skip this step.
2. Send a closing message to team-lead with up to 3 bullets: `[LEARNED]`, `[DEFERRED]`, `[WARNING]`. Skip if nothing to report.
3. Complete steps 1 and 2 BEFORE calling shutdown_response. Do not batch these with the shutdown approval.

### Team-Lead Shutdown

The team lead shuts down LAST. Execute in this order:

1. **Write own scratchpad** — save decisions, WIP, warnings to `memory/team-lead.md`.
2. **Write [NEXT SESSION] seed** — at the TOP of `memory/team-lead.md`, write a 3-5 bullet starter for the next team-lead session: state of play, expected first action, any open decisions awaiting PO, and concrete pointers (file paths, credentials locations, last-known data state) so future-Palestrina starts from orientation rather than re-reading cold. Tag the section `### [NEXT SESSION] YYYY-MM-DD — session-N → session-N+1` so it's distinct from historical `[DECISION]` / `[CHECKPOINT]` / `[DEFERRED]` entries. When next-session-Palestrina has processed it, they remove or downgrade the tag.
3. **Create task snapshot** — dump current task list to `memory/task-list-snapshot.md`.
4. **Send shutdown requests** — to all agents. Wait for each `teammate_terminated`.
5. **Persist inboxes** — copy pruned inboxes from runtime to repo:
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
6. **Commit and push** — all scratchpads, task snapshot, and inboxes:
   ```bash
   git add teams/mvox-dev/memory/ teams/mvox-dev/inboxes/
   git commit -m "chore: save mvox-dev team state"
   git push
   ```
   By convention, **pause before `git push`** so PO can review the diff first (especially the [NEXT SESSION] seed and any scratchpad additions).
