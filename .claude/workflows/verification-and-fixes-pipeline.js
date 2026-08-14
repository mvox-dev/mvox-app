/**
 * verification-and-fixes-pipeline — _expander verification + UX/correctness fixes + nav restructure.
 *
 * 4 slices:
 *   S1: #142 _expander gate verification (SPIKE investigation — not code)
 *   S2: UX fixes (#139 autocomplete max-height, #141 DST spring-forward) — skip RED
 *   S3: #140 NavShell tab merge (invite + admin → single Admin tab) — full TDD
 *   S4: Correctness fixes (#143 resolveLibrarian, #144 listSeasons scope, #138 resume orphan) — skip RED
 *
 * S1 is a research/investigation task handled as a SPIKE before the main loop.
 * S2-S4 follow the standard pipeline (GREEN → I18N → INTEGRATION → REVIEW → MERGE).
 *
 * Model assignments:
 *   SPIKE:       opus-5   — comprehension, read Entu source
 *   GREEN:       sonnet   — constrained execution
 *   I18N:        sonnet   — constrained execution
 *   INTEGRATION: sonnet   — wiring verification
 *   GREEN-FIX:   sonnet   — fix wiring gaps
 *   REVIEW:      opus-5   — comprehension checkpoint
 *   FIX:         opus-5   — understand root cause
 *   REPORT:      sonnet   — mechanical comms (effort: low)
 *   MERGE:       sonnet   — mechanical git ops
 *   RETRO:       sonnet   — compose + send retro (effort: low)
 *
 * (*MVOX:Palestrina*)
 */
export const meta = {
  name: 'verification-and-fixes-pipeline',
  description: '#142 _expander verification, UX fixes (#139/#141), NavShell tab merge (#140), correctness fixes (#143/#144/#138)',
  phases: [
    { title: 'SPIKE', detail: '#142 _expander gate investigation', model: 'claude-opus-5[1m]' },
    { title: 'GREEN', detail: 'Implement / fix', model: 'claude-sonnet-5[1m]' },
    { title: 'I18N', detail: 'Internationalize user-facing strings', model: 'claude-sonnet-5[1m]' },
    { title: 'INTEGRATION', detail: 'Wiring verification', model: 'claude-sonnet-5[1m]' },
    { title: 'GREEN-FIX', detail: 'Fix wiring gaps', model: 'claude-sonnet-5[1m]' },
    { title: 'REVIEW', detail: 'Architecture review', model: 'claude-opus-5[1m]' },
    { title: 'FIX', detail: 'Address review findings', model: 'claude-opus-5[1m]' },
    { title: 'REPORT', detail: 'Report to Gama (PO team)', model: 'claude-sonnet-5[1m]' },
    { title: 'MERGE', detail: 'Squash-merge to main', model: 'claude-sonnet-5[1m]' },
    { title: 'RETRO', detail: 'Retrospective with Gama', model: 'claude-sonnet-5[1m]' }
  ]
}

const REPO = '/home/ai-teams/workspace-app'
const CO_AUTHOR = 'Co-authored-by: Mihkel Putrinš <mihkel.putrinsh@gmail.com>'

// ── Shared context block ─────────────────────────────────────────────────

const ARCH_CONTEXT = [
  '## Architecture context (do NOT deviate from these)',
  '',
  '- **Pure client-side SPA** — no +page.server.ts, no form actions, no server routes.',
  '  All writes are browser-direct: onclick handler → *Actions.ts → entuFetch.',
  '- **entuFetch seam**: src/lib/entu/request.ts — `entuFetch(db, path, token, init, fetchImpl)`.',
  '  Every data function takes `fetchImpl: typeof fetch = fetch` as trailing param (injectable test seam).',
  '- **EntuCfg**: `{ db: string; token: string }` — the config object every write module takes.',
  '',
  '- **Trust _inheritrights** — created entities set ONLY _type + _parent + domain props.',
  '  No explicit _sharing or _inheritrights. Org has _sharing:domain + _inheritrights:true.',
  '',
  '- **Replace semantics** (Entu POST appends, never overwrites):',
  '  GET old value _ids → POST new value → DELETE old _ids. POST-before-DELETE rule.',
  '',
  '- **Rights gating**: rights props (_owner/_editor) ride on list reads (no extra fetch).',
  '  `manageRightsFrom(owners, editors, personId)` → "editor" | "not-editor" | "error".',
  '',
  '- **Org resolution**: `resolveMyOrgId(cfg, personId)` from src/lib/org/myOrg.ts:51-93.',
  '  NEVER `entity?_type.string=organization&limit=1` (returns federation umbrella, not collective).',
  '',
  '- **Svelte 5 runes ONLY**: $state(), $derived(), $effect(), $props(), $bindable().',
  '  NEVER legacy `export let` or `$:` syntax. REASSIGN arrays/objects to trigger reactivity.',
  '',
  '- **Autocomplete component**: src/lib/components/Autocomplete.svelte (introduced in #132 T2).',
  ''
].join('\n')

// ── Schemas ───────────────────────────────────────────────────────────────

const VERDICT_SCHEMA = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['GREEN', 'YELLOW', 'RED'] },
    summary: { type: 'string' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          description: { type: 'string' },
          fixShape: { type: 'string' },
          blockerType: { type: 'string', enum: ['code', 'data', 'config'] }
        },
        required: ['description'],
        additionalProperties: false
      }
    }
  },
  required: ['verdict', 'summary'],
  additionalProperties: false
}

const RESULT_SCHEMA = {
  type: 'object',
  properties: {
    success: { type: 'boolean' },
    commitSha: { type: 'string' },
    testsPassed: { type: 'boolean' },
    typeCheckPassed: { type: 'boolean' },
    summary: { type: 'string' }
  },
  required: ['success', 'summary'],
  additionalProperties: false
}

const PROBE_SCHEMA = {
  type: 'object',
  properties: {
    passed: { type: 'boolean' },
    checks: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          passed: { type: 'boolean' },
          detail: { type: 'string' }
        },
        required: ['name', 'passed'],
        additionalProperties: false
      }
    },
    summary: { type: 'string' }
  },
  required: ['passed', 'summary'],
  additionalProperties: false
}

const REPORT_SCHEMA = {
  type: 'object',
  properties: {
    sent: { type: 'boolean' },
    summary: { type: 'string' }
  },
  required: ['sent', 'summary'],
  additionalProperties: false
}

const SPIKE_SCHEMA = {
  type: 'object',
  properties: {
    expanderImplied: { type: 'boolean' },
    summary: { type: 'string' },
    evidence: { type: 'string' },
    actionNeeded: { type: 'string' }
  },
  required: ['expanderImplied', 'summary'],
  additionalProperties: false
}

// ── Helpers ───────────────────────────────────────────────────────────────

function formatFindings(findings) {
  if (!findings || !findings.length) return '(none)'
  return findings.map(function (f, idx) {
    var desc = typeof f === 'string' ? f : f.description
    var shape = (typeof f === 'object' && f.fixShape) ? '\nRecommended fix: ' + f.fixShape : ''
    var btype = (typeof f === 'object' && f.blockerType) ? ' [' + f.blockerType + ']' : ''
    return (idx + 1) + '. ' + desc + btype + shape
  }).join('\n\n')
}

function hasNonCodeBlocker(findings) {
  if (!findings) return false
  return findings.some(function (f) {
    return typeof f === 'object' && f.blockerType && f.blockerType !== 'code'
  })
}

function escapeForPrompt(str) {
  return str.replace(/"/g, '\\"')
}

// ── Task definitions (S2-S4, main loop) ──────────────────────────────────

const tasks = [
  // ─── S2: UX fixes (#139 + #141) ──────────────────────────────────────
  {
    issueNumber: 139,
    taskTag: 'S2',
    branch: 'fix/ux-batch-139-141',
    title: 'UX fixes (#139 autocomplete max-height, #141 DST spring-forward)',
    commitPrefix: 'fix(#139,#141)',
    skipRed: true,
    redPrompt: null,
    greenPrompt: [
      'Fix two UX issues.',
      '',
      ARCH_CONTEXT,
      '',
      '## Fix 1: #139 — Autocomplete dropdown max-height + scrollIntoView',
      'File: src/lib/components/Autocomplete.svelte',
      '',
      '1. Add `max-h-60 overflow-y-auto` to the dropdown container element',
      '2. On keyboard navigation (ArrowDown/ArrowUp), call `scrollIntoView({ block: "nearest" })`',
      '   on the highlighted item so it stays visible when the list scrolls',
      '3. The dropdown should scroll internally, not push page content',
      '',
      '## Fix 2: #141 — DST spring-forward in recurrence generator',
      'File: src/lib/events/recurrence.ts',
      '',
      'The generator steps calendar days and attaches a fixed time. During DST spring-forward',
      '(e.g., 2026-03-29 in Tallinn), a 03:00 occurrence normalizes to 04:00 because 03:00',
      'does not exist.',
      '',
      'Fix: format the datetime string from the generator parameters (date + requested time)',
      'directly, rather than constructing a Date object and reading back its time. This',
      'sidesteps timezone normalization entirely.',
      '',
      'For example, instead of:',
      '  const d = new Date(year, month, day, hour, minute)',
      '  return d.toISOString()',
      '',
      'Do:',
      '  return `${year}-${pad(month+1)}-${pad(day)}T${timeOfDay}:00`',
      '',
      'Verify with a test case for DST transition date if one exists.',
      '',
      'Verify: pnpm test -- --run && pnpm check'
    ].join('\n'),
    i18nPrompt: null,
    reviewChecklist: [
      '1. Autocomplete dropdown has max-h-60 overflow-y-auto',
      '2. scrollIntoView({ block: "nearest" }) on keyboard nav',
      '3. Dropdown scrolls internally, does not push page content',
      '4. DST fix: datetime formatted from params, not from Date object',
      '5. DST fix preserves the requested time for all dates (no TZ normalization)',
      '6. No regressions in existing recurrence tests',
      '7. No regressions in existing Autocomplete tests'
    ].join('\n'),
    commitBody: '#139: Autocomplete dropdown max-height + scrollIntoView on keyboard nav.\n#141: DST spring-forward fix — format datetime from params, not Date object.',
    closesIssues: [139, 141]
  },

  // ─── S3: #140 — NavShell tab merge ───────────────────────────────────
  {
    issueNumber: 140,
    taskTag: 'S3',
    branch: 'feat/140-navshell-tab-merge',
    title: 'NavShell tab merge — invite + admin into single Admin tab',
    commitPrefix: 'feat(#140)',
    skipRed: false,
    redPrompt: [
      'Write failing tests for the NavShell tab merge (#140).',
      '',
      ARCH_CONTEXT,
      '',
      '## What to test',
      '',
      '### Context',
      'Currently NavShell has separate "Invite" and "Admin" nav entries.',
      'Mihkel ruled: merge them into a single "Admin" tab that contains both',
      'invite functionality and admin/role management. This reduces nav entries',
      'from 7 to 6, fixing narrow-viewport overflow by design.',
      '',
      '### Tests',
      'File: src/routes/page.navshell-merge.spec.ts (or extend existing nav tests)',
      '',
      '1. NavShell renders exactly 6 top-level nav entries (not 7)',
      '2. An "Admin" nav entry exists for admin users',
      '3. No separate "Invite" nav entry exists',
      '4. The /admin route contains both admin role management AND invite functionality',
      '5. Non-admin users do not see the Admin nav entry',
      '6. The /invite URL either redirects to /admin or still works standalone',
      '   (backward compat — check if external links exist to /invite)',
      '7. Admin tab is highlighted when on /admin or /admin/invite (active-route matching)',
      '',
      '### Integration',
      '- Test against the actual NavShell component rendering',
      '- Verify the invite content is accessible from within the admin page',
      '',
      '## Reference files',
      '- Find NavShell: grep for NavShell in src/lib/components/ or src/routes/+layout.svelte',
      '- Find invite route: look for src/routes/invite/ or src/routes/admin/invite/',
      '- Find admin route: src/routes/admin/+page.svelte (from #134)'
    ].join('\n'),
    greenPrompt: [
      'Implement NavShell tab merge (#140).',
      '',
      ARCH_CONTEXT,
      '',
      '## What to implement',
      '',
      '### 1. Merge invite into admin',
      'The /invite route content (invite link generation/display) should become a section',
      'within the /admin page, OR a sub-route /admin/invite. Either approach works —',
      'pick whichever fits the existing structure better.',
      '',
      'Read the current invite route to understand what it renders, then:',
      '- Move or import the invite content into the admin page',
      '- Add it as a distinct section (e.g., "Invite Members" section alongside',
      '  "Admin Management" and "Librarian Management" from #134)',
      '',
      '### 2. Update NavShell',
      'Find the NavShell component and:',
      '- Remove the separate "Invite" nav entry',
      '- Keep the "Admin" entry (already added by #134)',
      '- Ensure active-route matching works for /admin and any sub-routes',
      '- Result: 6 nav entries total (down from 7)',
      '',
      '### 3. Handle /invite URL',
      'If the standalone /invite route exists:',
      '- Either redirect /invite → /admin (preferred if no external links depend on it)',
      '- Or keep it working alongside the merged view',
      '',
      '## Reference files',
      '- NavShell component (find via grep)',
      '- Current invite route',
      '- src/routes/admin/+page.svelte (from #134)'
    ].join('\n'),
    i18nPrompt: [
      'Update i18n strings for the NavShell tab merge (#140).',
      '',
      'Files: messages/{en,et,lv,uk}.json',
      '',
      'Changes needed:',
      '- Remove or repurpose the "Invite" nav label key (if it existed as a separate entry)',
      '- Ensure the "Admin" nav label is correct across all 4 locales',
      '- Add section header for the invite content within the admin page',
      '  (e.g., "Invite Members" / "Kutsu liikmeid" / etc.)',
      '',
      'Check what message keys the implementation uses (read the code).',
      'Verify: pnpm check — 0 type errors.'
    ].join('\n'),
    reviewChecklist: [
      '1. NavShell has exactly 6 top-level entries (not 7)',
      '2. No separate "Invite" nav entry exists',
      '3. Invite functionality accessible from within /admin',
      '4. Active-route matching works for /admin and sub-routes',
      '5. /invite URL handled (redirect or dual-render)',
      '6. Admin-gated (non-admins cannot see the tab)',
      '7. Mobile: no horizontal overflow at narrow viewports (the point of this change)',
      '8. Svelte 5 runes throughout',
      '9. i18n complete for all 4 locales',
      '10. No regressions in existing admin page functionality (#134)'
    ].join('\n'),
    commitBody: 'Merge invite and admin nav entries into single Admin tab.\nReduces NavShell entries from 7 to 6, fixing narrow-viewport overflow by design.\nInvite functionality now lives within the admin page.',
    closesIssues: [140]
  },

  // ─── S4: Correctness fixes (#143 + #144 + #138) ──────────────────────
  {
    issueNumber: 143,
    taskTag: 'S4',
    branch: 'fix/correctness-batch-143-144-138',
    title: 'Correctness fixes (#143 resolveLibrarian, #144 listSeasons scope, #138 resume orphan)',
    commitPrefix: 'fix(#143,#144,#138)',
    skipRed: true,
    redPrompt: null,
    greenPrompt: [
      'Fix three correctness issues.',
      '',
      ARCH_CONTEXT,
      '',
      '## Fix 1: #143 — resolveLibrarian limit=1 first-hit-guess risk',
      'File: src/lib/library/librarianStore.ts',
      '',
      'Current: queries `entity?_type.string=library&props=_owner,_editor&limit=1`',
      'This is the same first-hit-guess pattern fixed for resolveAdmin in TU.1/#109.',
      'With multiple library entities, limit=1 may resolve the wrong one.',
      '',
      'Fix: derive the library entity from the org, mirroring resolveMyOrgId.',
      'Create resolveMyLibraryId that finds the library entity parented under the',
      'user\'s own collective org (via _parent.reference=orgId), not a limit=1 global query.',
      '- First resolve the org via resolveMyOrgId',
      '- Then query entity?_type.string=library&_parent.reference={orgId}&props=_id&limit=1',
      '- Use this scoped library ID in resolveLibrarian',
      '',
      '## Fix 2: #144 — listSeasons add org scope',
      'File: src/lib/seasons/entuSeasons.ts (line ~70)',
      '',
      'Current: `entity?_type.string=season` with no org scope — reads from ALL orgs.',
      'Not a bug in single-collective, but becomes real with multi-org data.',
      '',
      'Fix: scope the query to the user\'s own org.',
      'Add `_parent.reference={orgId}` to the query, similar to how resolveMyOrgId',
      'resolves the collective. The orgId should be passed as a parameter or resolved',
      'within the function.',
      '',
      'Check also: does `currentSeason` have the same exposure? If so, fix both.',
      '',
      '## Fix 3: #138 — Collective switch mid-generation resume orphan',
      'File: src/routes/+page.svelte (~2788, ~288-360, ~3135-3305)',
      '',
      'Current: seriesCreateResume is a single unkeyed slot. On collective switch',
      'mid bulk-generation, the resume record is nulled and lost. Coming back and',
      're-submitting creates duplicate series + events.',
      '',
      'Fix: key the resume record by db.',
      '- Change seriesCreateResume to seriesCreateResumeByDb: a Map or Record keyed by db string',
      '- On stop/abort: write { seriesId, remaining, total } under the current db key',
      '- On loadForSelected: look up the entry for the CURRENT db',
      '- seriesRunUnfinished / seriesCreateLocked derive from the entry for the current db only',
      '- The old collective\'s stopped run does not lock the new collective\'s forms',
      '',
      'Verify: pnpm test -- --run && pnpm check'
    ].join('\n'),
    i18nPrompt: null,
    reviewChecklist: [
      '1. resolveLibrarian derives library from org (not limit=1 global query)',
      '2. listSeasons scoped to user\'s own org via _parent.reference',
      '3. currentSeason also scoped if it had the same exposure',
      '4. seriesCreateResume keyed by db — collective switch preserves stopped run',
      '5. Re-entering a collective with a stopped run shows the resume state',
      '6. New collective\'s forms not locked by old collective\'s stopped run',
      '7. No regressions in existing season/librarian/series tests',
      '8. resolveMyOrgId used (not hardcoded org ID)'
    ].join('\n'),
    commitBody: '#143: resolveLibrarian derives from org, not limit=1 global query.\n#144: listSeasons scoped to user\'s own org.\n#138: Series resume record keyed by db — collective switch preserves stopped runs.',
    closesIssues: [143, 144, 138]
  }
]

// ── Progress tracking ─────────────────────────────────────────────────────

// S1 (SPIKE): 2 agents (SPIKE + REPORT)
// S2: GREEN+INTEGRATION+REVIEW+2×REPORT+MERGE = 6
// S3: RED+GREEN+I18N+INTEGRATION+REVIEW+2×REPORT+MERGE = 8
// S4: GREEN+INTEGRATION+REVIEW+2×REPORT+MERGE = 6
// RETRO = 1
// Total: 2+6+8+6+1 = 23
const TOTAL_AGENTS = 23

let agentNum = 0

function progress(sliceLabel, phaseName, taskTitle) {
  agentNum++
  return '[agent ' + agentNum + '/' + TOTAL_AGENTS + '] ' + sliceLabel + ' — ' + phaseName + ': ' + taskTitle
}

// ── S1: #142 _expander gate verification (SPIKE) ─────────────────────────

phase('SPIKE')
log(progress('S1 (investigation)', 'SPIKE', '#142 _expander gate verification'))

const spike = await agent(
  'Investigate whether _owner/_editor on an Entu entity implies _expander rights.\n\nWORKING DIRECTORY: /home/ai-teams\n\n## Background\nEntu validates _parent references on entity creation — the creator must hold _editor, _owner, or _expander rights on the parent entity. The #132 event management creates (season, event_series, event) POST with _parent referencing the org or season. If _owner/_editor does NOT imply _expander, admins cannot create seasons.\n\n## Investigation steps\n1. Read ~/projects/entu-api/utils/entity.js — find the _parent/_expander validation on create\n   Look for where it checks parent rights before allowing entity creation\n2. Read ~/projects/entu-api/utils/rights.js — understand how _expander relates to _owner/_editor\n3. Read ~/projects/entu-api/utils/aggregate.js — check if _expander is populated from _owner/_editor\n4. Determine: does having _owner or _editor on an entity automatically give _expander access?\n\n## Report\nReturn expanderImplied=true if _owner/_editor implies _expander (the gate is safe).\nReturn expanderImplied=false if _expander is independent (needs explicit grants).\nInclude the specific code references (file:line) as evidence.\nIf false, describe actionNeeded: what data op or code change is required.',
  { label: 'spike-142', phase: 'SPIKE', schema: SPIKE_SCHEMA, model: 'claude-opus-5[1m]' }
)

if (!spike) {
  log('SPIKE returned null — halting')
  return { success: false, failedAt: 'S1 SPIKE null', results: [] }
}

log('SPIKE result: expanderImplied=' + spike.expanderImplied + ' — ' + spike.summary)

// Report S1 to Gama
phase('REPORT')
log(progress('S1 (investigation)', 'REPORT', 'SPIKE result → Gama'))
var spikeMsg = 'S1 SPIKE: #142 _expander gate — expanderImplied=' + spike.expanderImplied + '. ' + spike.summary
await agent(
  'Send a progress report to gama@po-team via the comms MCP tool.\n\nStep 1: Use ToolSearch with query "select:mcp__comms__send" to load the tool schema.\nStep 2: Call mcp__comms__send with to="gama@po-team" and message="' + escapeForPrompt(spikeMsg) + '"\n\nReturn sent=true after sending.',
  { label: 'report-spike-142', phase: 'REPORT', schema: REPORT_SCHEMA, model: 'claude-sonnet-5[1m]', effort: 'low' }
)

if (!spike.expanderImplied) {
  log('#142: _expander NOT implied by _owner/_editor — halting pipeline for ruling. Action needed: ' + (spike.actionNeeded || 'unknown'))
  return { success: false, failedAt: 'S1 #142 _expander not implied', results: [], spike: spike }
}

// If expanderImplied=true, close #142 via the merge agent
phase('MERGE')
log(progress('S1 (investigation)', 'MERGE', 'close #142'))
await agent(
  'Close GitHub issue #142 in ' + REPO + ' with the investigation findings.\n\ncd ' + REPO + ' && gh issue close 142 -c "$(cat <<\'CLOSEEOF\'\nInvestigation complete: _owner/_editor on an Entu entity implies _expander rights.\n\n' + escapeForPrompt(spike.summary) + '\n\nEvidence: ' + escapeForPrompt(spike.evidence || 'see SPIKE agent output') + '\n\nThe #132 create path is safe — admins with _editor on the org can create children.\n\nCloses #142\n\n' + CO_AUTHOR + '\nCLOSEEOF\n)"\n\nReport success.',
  { label: 'close-142', phase: 'MERGE', schema: RESULT_SCHEMA, model: 'claude-sonnet-5[1m]', effort: 'low' }
)

log('S1 done: #142 closed.')

// ── Main pipeline loop (S2-S4) ──────────────────────────────────────────

const results = [{ taskTag: 'S1', issueNumber: 142, title: '_expander gate verification', reviewVerdict: 'SPIKE:' + spike.expanderImplied, reviewAttempts: 1 }]

for (let i = 0; i < tasks.length; i++) {
  const task = tasks[i]
  const taskLabel = (task.issueNumber ? '#' + task.issueNumber : 'batch') + '/' + task.taskTag + ' ' + task.title
  const sliceLabel = 'Slice ' + (i + 2) + '/4 (' + task.taskTag + ')'

  log(sliceLabel + ': ' + taskLabel)

  // ── RED ────────────────────────────────────────────────────────────────
  if (!task.skipRed) {
    phase('RED')
    log(progress(sliceLabel, 'RED', task.title))

    const red = await agent(
      task.redPrompt + '\n\nWORKING DIRECTORY: ' + REPO + '\n\nFIRST: cd ' + REPO + ' && git checkout main && git pull && git checkout -b ' + task.branch + '\n\nIMPORTANT — INTEGRATION TESTS: For every new component or data function, include at least one integration test that verifies it renders on / is called from the actual page route — not just in isolation.\n\nAfter writing tests, commit:\ngit add -A && git commit -m "test(#' + task.issueNumber + '/' + task.taskTag + '): RED — ' + task.title + '"',
      { label: 'red-' + task.taskTag, phase: 'RED', schema: RESULT_SCHEMA, model: 'claude-fable-5' }
    )

    if (!red || !red.success) {
      log('RED failed for ' + taskLabel + ': ' + (red ? red.summary : 'null'))
      return { success: false, failedAt: taskLabel + ' RED', results: results }
    }
    log('RED done: ' + red.summary)
  }

  // ── GREEN ──────────────────────────────────────────────────────────────
  if (task.greenPrompt) {
    phase('GREEN')
    log(progress(sliceLabel, 'GREEN', task.title))

    var branchSetup = task.skipRed
      ? 'FIRST: cd ' + REPO + ' && git checkout main && git pull && git checkout -b ' + task.branch + '\n\n'
      : ''

    const green = await agent(
      branchSetup + task.greenPrompt + '\n\nWORKING DIRECTORY: ' + REPO + '\nBRANCH: ' + task.branch + (task.skipRed ? ' (just created)' : ' (already checked out from RED)') + '\n\nVerification:\n1. cd ' + REPO + ' && pnpm test -- --run — ALL pass\n2. cd ' + REPO + ' && pnpm check — 0 type errors\n\nGit: git add -A && git commit -m "' + task.commitPrefix + '/' + task.taskTag + ': ' + task.title + '"',
      { label: 'green-' + task.taskTag, phase: 'GREEN', schema: RESULT_SCHEMA, model: 'claude-sonnet-5[1m]' }
    )

    if (!green || !green.success) {
      log('GREEN failed for ' + taskLabel + ': ' + (green ? green.summary : 'null'))
      return { success: false, failedAt: taskLabel + ' GREEN', results: results }
    }
    log('GREEN done: ' + green.summary)
  }

  // ── I18N (optional) ────────────────────────────────────────────────────
  if (task.i18nPrompt) {
    phase('I18N')
    log(progress(sliceLabel, 'I18N', task.title))

    const i18n = await agent(
      task.i18nPrompt + '\n\nWORKING DIRECTORY: ' + REPO + '\nBRANCH: ' + task.branch + '\n\nVerification: cd ' + REPO + ' && pnpm check — 0 type errors\n\nGit: git add -A && git commit -m "i18n(#' + task.issueNumber + '/' + task.taskTag + '): locale strings for ' + task.title + '"',
      { label: 'i18n-' + task.taskTag, phase: 'I18N', schema: RESULT_SCHEMA, model: 'claude-sonnet-5[1m]' }
    )

    if (!i18n || !i18n.success) {
      log('I18N failed for ' + taskLabel + ': ' + (i18n ? i18n.summary : 'null'))
      return { success: false, failedAt: taskLabel + ' I18N', results: results }
    }
    log('I18N done: ' + i18n.summary)
  }

  // ── INTEGRATION ────────────────────────────────────────────────────────
  phase('INTEGRATION')
  log(progress(sliceLabel, 'INTEGRATION', task.title))

  let integrationAttempts = 0
  let integrationPassed = false

  while (!integrationPassed && integrationAttempts < 2) {
    integrationAttempts++

    const integration = await agent(
      'Verify that all new features on branch ' + task.branch + ' for ' + taskLabel + ' are REACHABLE from the actual app — not just correct in isolation.\n\nWORKING DIRECTORY: ' + REPO + '\n\n## Wiring checks\n1. For every new component: grep for its import in a page/route file. If not imported anywhere, it is unreachable.\n2. For every new data function (exported from a .ts file): grep for its import. If only imported by test files, it is unreachable.\n3. For every new UI element: check that the page renders it (conditionally is fine, but the conditional must be reachable).\n4. Run: cd ' + REPO + ' && pnpm test -- --run && pnpm check\n\nReturn passed=true if every new export is imported from at least one non-test file AND the page/route renders the feature. Return passed=false with a checks array listing each unreachable item.\n\nDo NOT fix anything — only verify and report.',
      { label: 'integration-' + task.taskTag + '-' + integrationAttempts, phase: 'INTEGRATION', schema: PROBE_SCHEMA, model: 'claude-sonnet-5[1m]' }
    )

    if (!integration || !integration.passed) {
      var failedChecks = (integration && integration.checks) ? integration.checks.filter(function(c) { return !c.passed }) : []
      var failSummary = failedChecks.map(function(c) { return c.name + ': ' + (c.detail || '') }).join('\n')

      if (integrationAttempts < 2) {
        phase('GREEN-FIX')
        log('[retry] ' + sliceLabel + ' — GREEN-FIX: wiring gaps for ' + task.title)
        await agent(
          'Fix wiring gaps on branch ' + task.branch + ' for ' + taskLabel + '.\n\nWORKING DIRECTORY: ' + REPO + '\n\nUnreachable features:\n' + failSummary + '\n\nFor each gap: add the missing import/render in the appropriate page or route file. Do NOT rewrite the feature — just wire it in.\n\nVerify: pnpm test -- --run && pnpm check. Commit the fix.',
          { label: 'green-fix-' + task.taskTag, phase: 'GREEN-FIX', schema: RESULT_SCHEMA, model: 'claude-sonnet-5[1m]' }
        )
      } else {
        log('INTEGRATION still failing after fix — proceeding to REVIEW')
      }
    } else {
      integrationPassed = true
      log('INTEGRATION passed: ' + integration.summary)
    }
  }

  // ── REVIEW ─────────────────────────────────────────────────────────────
  phase('REVIEW')
  log(progress(sliceLabel, 'REVIEW', task.title))

  let verdict = null
  let reviewAttempts = 0

  while ((!verdict || verdict.verdict !== 'GREEN') && reviewAttempts < 3) {
    reviewAttempts++

    verdict = await agent(
      'You are Bentham, architecture reviewer for mvox-dev. Review branch ' + task.branch + ' for ' + taskLabel + '.\n\nWORKING DIRECTORY: ' + REPO + '\n\n' + ARCH_CONTEXT + '\n\n## Review checklist\n' + task.reviewChecklist + '\n\nProcedure:\n1. cd ' + REPO + ' && git diff main...HEAD --stat\n2. Read all changed files\n3. Run: pnpm test -- --run && pnpm check\n4. Issue GREEN / YELLOW / RED verdict\n\nFor non-GREEN: list findings with description, fixShape (recommended fix), and blockerType (code/data/config).\n\nIMPORTANT blockerType guidance:\n- blockerType "code" = requires changes to THIS branch\'s code before merge\n- blockerType "data" = requires a live data mutation that blocks THIS task\n- blockerType "config" = requires environment/config change that blocks THIS task\n\nDo NOT tag as "data" or "config" for:\n- Integration risks in FUTURE slices (note in summary, omit blockerType)\n- Separate cleanup tasks (note in summary, omit blockerType)\n- Speculative or unverified concerns (note in summary, omit blockerType)\n\nOnly use "data"/"config" when THIS branch cannot merge without the fix.',
      { label: 'review-' + task.taskTag + '-' + reviewAttempts, phase: 'REVIEW', schema: VERDICT_SCHEMA, model: 'claude-opus-5[1m]' }
    )

    if (!verdict) verdict = { verdict: 'RED', summary: 'Review agent returned null', findings: [] }

    if (verdict.verdict !== 'GREEN') {
      if (hasNonCodeBlocker(verdict.findings)) {
        log('Non-code blocker for ' + taskLabel + ' — halting')
        return { success: false, failedAt: taskLabel + ' REVIEW (non-code blocker)', results: results, verdict: verdict }
      }

      if (reviewAttempts < 3) {
        phase('FIX')
        log('[retry ' + reviewAttempts + '] ' + sliceLabel + ' — FIX: review findings for ' + task.title)
        await agent(
          'Fix review findings for ' + taskLabel + ' in ' + REPO + ' on branch ' + task.branch + '.\n\n' + ARCH_CONTEXT + '\n\nVerdict: ' + verdict.verdict + '\n\n## Findings\n' + formatFindings(verdict.findings) + '\n\nFor each finding, understand the ROOT CAUSE before writing a fix. Fix, verify (pnpm test -- --run && pnpm check), commit.',
          { label: 'fix-' + task.taskTag + '-' + reviewAttempts, phase: 'FIX', schema: RESULT_SCHEMA, model: 'claude-opus-5[1m]' }
        )
      }
    }
  }

  if (!verdict || verdict.verdict === 'RED') {
    log('REVIEW failed for ' + taskLabel + ' after ' + reviewAttempts + ' attempts')
    return { success: false, failedAt: taskLabel + ' REVIEW', results: results, verdict: verdict }
  }
  log('REVIEW: ' + verdict.verdict + ' — ' + verdict.summary)

  // ── REPORT (post-review) ──────────────────────────────────────────────
  phase('REPORT')
  log(progress(sliceLabel, 'REPORT', 'review verdict → Gama'))
  var reviewMsg = sliceLabel + ' REVIEW: ' + taskLabel + ' — verdict ' + verdict.verdict + '. ' + verdict.summary
  await agent(
    'Send a progress report to gama@po-team via the comms MCP tool.\n\nStep 1: Use ToolSearch with query "select:mcp__comms__send" to load the tool schema.\nStep 2: Call mcp__comms__send with to="gama@po-team" and message="' + escapeForPrompt(reviewMsg) + '"\n\nReturn sent=true after sending.',
    { label: 'report-review-' + task.taskTag, phase: 'REPORT', schema: REPORT_SCHEMA, model: 'claude-sonnet-5[1m]', effort: 'low' }
  )

  // ── MERGE ──────────────────────────────────────────────────────────────
  phase('MERGE')
  log(progress(sliceLabel, 'MERGE', task.title))

  var closesLines = (task.closesIssues || []).map(function(n) { return '\nCloses #' + n }).join('')
  var mergeCmd = 'cd ' + REPO + ' && git checkout main && git pull && git merge --squash ' + task.branch + ' && git commit -m "$(cat <<\'COMMITEOF\'\n' + task.commitPrefix + '/' + task.taskTag + ': ' + task.title + '\n\n' + task.commitBody + closesLines + '\n\n' + CO_AUTHOR + '\nCOMMITEOF\n)" && git push && git branch -D ' + task.branch + ' && git push origin --delete ' + task.branch + ' 2>/dev/null || true'

  const merge = await agent(
    'Squash-merge ' + task.branch + ' to main for ' + taskLabel + '.\n\nWORKING DIRECTORY: ' + REPO + '\n\nRun this exact command:\n' + mergeCmd + '\n\nReport the merge commit SHA.',
    { label: 'merge-' + task.taskTag, phase: 'MERGE', schema: RESULT_SCHEMA, model: 'claude-sonnet-5[1m]' }
  )

  if (!merge || !merge.success) {
    log('MERGE failed for ' + taskLabel + ': ' + (merge ? merge.summary : 'null'))
    return { success: false, failedAt: taskLabel + ' MERGE', results: results }
  }
  log('Merged: ' + merge.summary)

  // ── REPORT (post-merge) ───────────────────────────────────────────────
  log(progress(sliceLabel, 'REPORT', 'merge result → Gama'))
  var mergeMsg = sliceLabel + ' MERGED: ' + taskLabel + (merge.commitSha ? ' @ ' + merge.commitSha : '') + '. ' + merge.summary
  await agent(
    'Send a progress report to gama@po-team via the comms MCP tool.\n\nStep 1: Use ToolSearch with query "select:mcp__comms__send" to load the tool schema.\nStep 2: Call mcp__comms__send with to="gama@po-team" and message="' + escapeForPrompt(mergeMsg) + '"\n\nReturn sent=true after sending.',
    { label: 'report-merge-' + task.taskTag, phase: 'REPORT', schema: REPORT_SCHEMA, model: 'claude-sonnet-5[1m]', effort: 'low' }
  )

  results.push({
    taskTag: task.taskTag,
    issueNumber: task.issueNumber,
    title: task.title,
    commitSha: merge.commitSha,
    reviewVerdict: verdict.verdict,
    reviewAttempts: reviewAttempts
  })
}

// ── RETRO ────────────────────────────────────────────────────────────────
phase('RETRO')
log(progress('Final', 'RETRO', 'retrospective → Gama'))

var completedList = results.map(function(r) {
  return '- ' + r.taskTag + ': ' + r.title + ' (review: ' + r.reviewVerdict + ', attempts: ' + r.reviewAttempts + (r.commitSha ? ', sha: ' + r.commitSha : '') + ')'
}).join('\n')

var retroMsg = '## Verification & Fixes Pipeline Retrospective\n\n### Completed slices\n' + completedList + '\n\n### Pipeline shape\nS1: SPIKE investigation (no code). S2+S4: skip-RED fix batches. S3: full TDD.\nVerdict-triggered Gama reporting. Progress tracking.\n\n### Questions for retro\n1. S1 SPIKE-only investigation — right approach for verification tasks?\n2. Fix batching across S2 and S4 — right granularity?\n3. NavShell tab merge (#140) — smooth?\n4. Any follow-up issues to file from YELLOW findings?\n5. Template improvements to codify?\n\nWaiting for your observations.\n\n(*MVOX:Palestrina*)'

await agent(
  'Send a retrospective message to gama@po-team via the comms MCP tool.\n\nStep 1: Use ToolSearch with query "select:mcp__comms__send" to load the tool schema.\nStep 2: Call mcp__comms__send with to="gama@po-team" and the following message (send verbatim, preserving all newlines and formatting):\n\n' + retroMsg + '\n\nReturn sent=true after sending.',
  { label: 'retro-gama', phase: 'RETRO', schema: REPORT_SCHEMA, model: 'claude-sonnet-5[1m]', effort: 'low' }
)

log('Retrospective sent. Pipeline done.')
return { success: true, results: results }
