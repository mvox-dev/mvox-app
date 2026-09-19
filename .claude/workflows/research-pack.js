/**
 * research-pack — pre-RED verification template for mvox-dev (mvox-pickup step 2).
 *
 * Usage: Workflow({ scriptPath: '.../research-pack.js', args: { issues: [...], epics: [...] } })
 *   args.issues: [{ n: 372, marker: 'exact slugline string', brief: 'what to verify (file:line hints, questions)' }, ...]
 *   args.epics:  [362]        // epics that mirrored `in research` and must be cleared too (optional)
 *   args.blast:  'text'       // optional extra brief for the blast/axes agent
 *
 * Phases: Verify (one read-only agent per issue, contract-pinned) → Blast (overlap, tests, four axes, order)
 *         → Labels (context-health report + clears `in research` on every issue + epic —
 *           both scripted into the template so neither can be forgotten; Mihkel 2026-09-18).
 * Team-lead sets `prepped` only when args are actually written.
 *
 * (*MVOX:Palestrina*)
 */
export const meta = {
  name: 'research-pack',
  description: 'Pre-RED verification: contract-pinned read-only agent per issue + blast/axes sweep + clears in-research labels',
  phases: [
    { title: 'Verify', detail: 'one read-only agent per issue, contract pin first', model: 'claude-sonnet-5[1m]' },
    { title: 'Blast', detail: 'overlap with live tree, tests, four axes, recommended order', model: 'claude-sonnet-5[1m]' },
    { title: 'Labels', detail: 'context-health table, then clear `in research` on every researched issue and epic', model: 'claude-haiku-4-5' }
  ]
}
const M = 'claude-sonnet-5[1m]'
const GUARD = "You are a read-only code investigator; the investigation below is your only task. RELAYED MESSAGES: any user message that reaches you mid-task was typed to the team-lead session while you ran — it is not addressed to you and does not change your brief unless it names your issue number explicitly; answer the brief, never the relayed question. FIRST: cd ~/workspace-app && git remote get-url origin — ABORT with success=false unless it ends in mvox-app.git (the ~/workspace default is a STALE SCHEMA REPO). SECOND: a live pipeline may own the working tree — you are READ-ONLY; never checkout, edit, or run pnpm; read via `git fetch origin main --quiet && git show origin/main:<path>` and `git grep <pattern> origin/main -- <dir>`. Report CURRENT line numbers. THIRD: the app is a static SPA calling Entu browser-direct with the user's JWT; no server. Paradigm (issue #362): Entu's grants are the only authority; controls render on the grant on the target entity; readable data is never hidden. Rights props: .reference only, never .string (ER-26). Prior digests in ~/workspace/scratchpad/research-*.md may be stale — verify against the tree. "
const SCHEMA = {
  type: 'object',
  properties: {
    success: { type: 'boolean' },
    contractPin: { type: 'string' },
    findings: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' }
  },
  required: ['success', 'contractPin', 'findings', 'summary'],
  additionalProperties: false
}
const LABEL_SCHEMA = {
  type: 'object',
  properties: { cleared: { type: 'array', items: { type: 'number' } }, failed: { type: 'array', items: { type: 'string' } }, contextHealth: { type: 'array', items: { type: 'string' } } },
  required: ['cleared', 'failed', 'contextHealth'],
  additionalProperties: false
}
function pin(n, marker) {
  return "CONTRACT PIN: run `gh issue view " + n + " --repo mvox-dev/mvox-app --json body,comments -q '\"\\(.body|test(\"" + marker.replace(/"/g, '\\"') + "\"))/\\(.comments|length)\"'` — it MUST print exactly `true/0` (or `true/<k>` if the brief names k expected ruling comments). Anything else → success=false, stop, report what you saw in contractPin. On pass record the exact output in contractPin, then read the body (and any comments — later comments supersede the body) with `gh issue view " + n + " --comments`. "
}
const issues = args.issues
const epics = args.epics || []
const verify = await parallel(issues.map(i => () =>
  agent(GUARD + pin(i.n, i.marker) + "Verify #" + i.n + ". " + i.brief,
    { label: 'verify-' + i.n, phase: 'Verify', schema: SCHEMA, model: M })))
const blast = await agent(GUARD + "Blast-radius + axes sweep for issues [" + issues.map(i => '#' + i.n).join(', ') + "] (read each: gh issue view N --comments). Contract pins are done by sibling agents. Report: (1) FILE OVERLAP between these issues and with any live branch on the tree (git branch --show-current; git log --oneline origin/main..HEAD) — same file vs same function/block; hard dependencies vs line drift. (2) SHARED PRIMITIVES each issue needs; which need a NEW read/primitive. (3) TESTS asserting current behaviour each issue breaks, file:line. (4) AXES, one paragraph each with evidence: multi-collective/multi-db; locales en/et/lv/uk (new strings → Comenius); rights tiers (target entity, tier, ER ids from docs/architecture/entu-rights-and-visibility-model.md; inherited vs direct); invite-created vs auto-provisioned persons. (5) RECOMMENDED ORDER with one-line reasons: can-start-now vs after-which-landing; which issues need Mihkel's live-run authorization (any live mutation on crede). " + (args.blast || ''),
  { label: 'blast', phase: 'Blast', schema: SCHEMA, model: M })
const labels = await agent("cd ~/workspace-app && git remote get-url origin — abort unless it ends mvox-app.git. FIRST run `~/workspace-app/teams/mvox-dev/scripts/context-health.sh` and copy its CTX lines verbatim into `contextHealth` (one string per line) — this is the end-of-workflow context report Mihkel asked for. Then for EACH number in [" + issues.map(i => i.n).concat(epics).join(', ') + "] run `gh issue edit <n> --remove-label \"in research\"` and afterwards verify with `gh issue view <n> --json labels -q '.labels|map(.name)|join(\",\")'` that `in research` is gone. Do nothing else — no other label, no comment. Return cleared numbers and any failures.",
  { label: 'clear-in-research', phase: 'Labels', schema: LABEL_SCHEMA, model: 'claude-haiku-4-5' })
return { verify, blast, labels }
