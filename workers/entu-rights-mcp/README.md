# entu-rights-mcp

An MCP server that serves the rights model rules — `docs/architecture/entu-rights-and-visibility-model.md` — verbatim, over JSON-RPC 2.0. It is a **VIEW, never a second home**: it holds no rule text of its own, only a build-time snapshot of the doc, and every response carries the source commit (+ its date) so a stale answer is detectable rather than merely plausible.

**It accelerates; it never gates.** The doc stays directly readable in the repo. When this server is down, or not yet deployed, the answer is slower — someone reads the doc by hand — never unavailable.

**This slice ships the code only.** Nothing here has been deployed, and nothing in this repo runs `wrangler`. Activation is a production deployment and needs explicit PO authorization (see "Activation" below).

## What it serves

- `rights_rule(id)` — one rule, verbatim, plus its evidence (`file:line` refs, probe-script and result-file paths) and the source-commit stamp.
- `rights_rules(topic)` — identifiers matching a free-text topic, each with a short doc-derived context line, for a caller who does not know the identifier.

Deliberately **not** served: generated per-question answers. Every served string is doc-derived — the rule's own verbatim text, or a byte-substring context line of it.

## Generate the bundle

The two tools read an in-memory `RulesBundle` built from the doc plus a source-commit stamp. The parser and generator (`src/parse.ts`, `src/generate.ts`) are pure functions, exercised directly by the test suite. The one impure step — reading the doc off disk, shelling out to `git`, and writing the output file — lives in `generate-bundle.ts`, run via:

```sh
pnpm mcp:bundle
```

This writes `workers/entu-rights-mcp/generated/rules-bundle.json` (**gitignored** — see `.gitignore`; a committed copy would be the independent rule store this design forbids). The deploy entry point (`src/index.ts`) imports that file and wires it into the Worker fetch handler (`src/worker.ts`).

## Refresh path (Gama, 2026-09-12 item 1) — currently MANUAL

**Stated in plain words, as asked:** after a merge that edits the doc, refreshing the deployed server is a human running, in order:

```sh
# from the repo root — mcp:bundle is a root package.json script
pnpm mcp:bundle
# from the Worker directory — wrangler searches cwd and upwards for its
# config, and the only one is workers/entu-rights-mcp/wrangler.jsonc
cd workers/entu-rights-mcp && pnpm dlx wrangler deploy
```

The two commands do **not** share a working directory: run the generator at the root, the deploy inside `workers/entu-rights-mcp/`. (`pnpm dlx wrangler deploy -c workers/entu-rights-mcp/wrangler.jsonc` from the root is the same thing in one line, if you prefer it.)

**Nothing in this repo does that automatically today.** There is no app deploy workflow at all — `mvox.eu` is published by Cloudflare Pages' own Git integration (configured outside this repo), and a Worker is not deployed by that integration either. The only GitHub Actions workflow in this repo is `.github/workflows/roadmap.yml`, and it does not touch this Worker.

**Is a repo-side deploy trigger feasible (item 2)?** Yes, in the same shape as `roadmap.yml`: a workflow on `push` to `main` that touches `docs/architecture/entu-rights-and-visibility-model.md`, running `pnpm mcp:bundle` at the repo root then `wrangler deploy` from `workers/entu-rights-mcp/` (or `wrangler deploy -c workers/entu-rights-mcp/wrangler.jsonc`, same cwd split as above). That needs a Cloudflare API token stored as a GitHub Actions secret — provisioning that secret is Mihkel's infra call, not this slice's. This paragraph answers feasibility only; no workflow file is added here.

**Until that trigger exists (or is explicitly declined in favor of the manual step above), redeploy-after-doc-edit is part of the doc-amendment procedure itself** — anyone who lands an edit to the rights-model doc, once this server is activated, also runs the two commands above.

## wrangler.jsonc

Config only. `name`, `main`, `compatibility_date` — no `nodejs_compat` (the Worker is plain TS over the Fetch API, no Node builtins), no `vars` (no secrets: this Worker reads nothing but its own generated bundle). No `routes` entry: the routing choice is left to PO (below).

## Activation — PO-gated, not part of this change

Two decisions belong to PO, not to this slice:

1. **Routing at `mvox.eu`**: a path route (`mvox.eu/mcp`) on the existing zone, or a subdomain (e.g. `rights.mvox.eu`). Either is a `wrangler.jsonc` `routes` addition plus whatever DNS/zone configuration Cloudflare requires — not made here.
2. **Whether to activate at all, and on what refresh-path terms** — see "Refresh path" above. The PO ruling on #318 is explicit: activation is not granted until the refresh path is a stated, working answer, not "someone remembers."

**No deploy, no DNS change, and no `wrangler` execution happens as part of this repo's tests or tooling.** The first `wrangler deploy` for this Worker is the activation event itself, run by hand once PO authorizes it.
