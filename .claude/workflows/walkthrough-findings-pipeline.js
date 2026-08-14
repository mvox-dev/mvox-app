/**
 * walkthrough-findings-pipeline — Walkthrough UX findings.
 *
 * 4 serial slices, all skip-RED (well-specified fixes):
 *   Slice 1: Admin page fixes (#146 name resolution, #147 self-removal guard, #148 remove ownership note)
 *   Slice 2: #149 Agenda admin toolbar grouping
 *   Slice 3: #150 Roster: remove up/down arrows
 *   Slice 4: #151 Typography consistency pass
 *
 * Model assignments:
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
  name: 'walkthrough-findings-pipeline',
  description: 'Walkthrough findings: admin fixes (#146-148), agenda toolbar (#149), roster arrows (#150), typography (#151)',
  phases: [
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
  '- **Trust _inheritrights** — created entities set ONLY _type + _parent + domain props.',
  '  No explicit _sharing or _inheritrights. Org has _sharing:domain + _inheritrights:true.',
  '- **Rights gating**: rights props (_owner/_editor) ride on list reads (no extra fetch).',
  '  `manageRightsFrom(owners, editors, personId)` → "editor" | "not-editor" | "error".',
  '- **Admin resolution**: `resolveAdmin(cfg, personId, fetchImpl)` from src/lib/nav/adminStore.ts.',
  '- **Svelte 5 runes ONLY**: $state(), $derived(), $effect(), $props(), $bindable().',
  '  NEVER legacy `export let` or `$:` syntax. REASSIGN arrays/objects to trigger reactivity.',
  '- **Tailwind CSS v4** — full class names only, no dynamic template literals.',
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

// ── Task definitions ──────────────────────────────────────────────────────

const tasks = [
  // ─── Slice 1: Admin page fixes (#146 + #147 + #148) ──────────────────
  {
    issueNumber: 146,
    taskTag: 'S1',
    branch: 'fix/admin-page-batch-146-147-148',
    title: 'Admin page fixes (#146 name resolution, #147 self-removal guard, #148 ownership note)',
    commitPrefix: 'fix(#146,#147,#148)',
    skipRed: true,
    redPrompt: null,
    greenPrompt: [
      'Fix three admin page bugs from the live walkthrough. All on one branch.',
      '',
      ARCH_CONTEXT,
      '',
      '## Fixes',
      '',
      '### #146 — Person names show entity ID instead of name',
      'File: src/lib/admin/roleManagement.ts (line ~176, toRolePersons or fetchRights)',
      '',
      'Root cause: newly POSTed _editor references carry only `reference` (person entity ID),',
      'not `string` (display name). The code falls back to showing the raw ID.',
      '',
      'Fix: After reading the rights list, resolve person names for entries where name === id.',
      'The roster is already loaded for the Autocomplete person search — use it as a lookup table.',
      'Pass the roster to the name resolution function (or fetch each unresolved person entity',
      'by ID — small N, typically 1-5 admins, so individual fetches are acceptable).',
      '',
      '### #147 — Self-lockout: admin can remove own rights',
      'File: src/routes/admin/+page.svelte (remove button conditional)',
      '',
      'Current guard only prevents removing the last _owner. An admin with _editor (or an _owner',
      'when other owners exist) can remove themselves, locking themselves out.',
      '',
      'Fix: Add `isSelf(person)` guard comparing person.id to the logged-in user\'s personId.',
      'Disable the remove button when isSelf is true. Apply to BOTH admin and librarian lists.',
      'Show a tooltip or label: "Cannot remove your own rights".',
      '',
      '### #148 — Confusing "Library ownership" note',
      'File: src/routes/admin/+page.svelte (hint rendering)',
      'File: messages/{en,et,lv,uk}.json (admin_roles_library_owner_hint key)',
      '',
      'Fix: Hide the remove button entirely for owner entries instead of showing disabled with',
      'a confusing note. Remove the `admin_roles_library_owner_hint` i18n key. The role badge',
      '(owner/editor) provides sufficient context — no explanation needed.',
      '',
      '## Verification',
      'pnpm test -- --run && pnpm check'
    ].join('\n'),
    i18nPrompt: [
      'Update i18n strings for admin page fixes (#146-148).',
      '',
      'Files: messages/{en,et,lv,uk}.json',
      '',
      '1. REMOVE the `admin_roles_library_owner_hint` key from all 4 locale files (#148)',
      '2. ADD a self-removal tooltip key for #147, e.g.:',
      '   - en: "Cannot remove your own rights"',
      '   - et: "Ei saa eemaldada enda õigusi"',
      '   - lv: "Nevar noņemt savas tiesības"',
      '   - uk: "Неможливо видалити власні права"',
      '',
      'Check what key name the GREEN phase used (read the component code).',
      'Verify: pnpm check — 0 type errors.'
    ].join('\n'),
    reviewChecklist: [
      '1. Person names resolve correctly for new entries (not raw entity IDs)',
      '2. Self-removal guard prevents removing own admin AND librarian rights',
      '3. Remove button hidden (not disabled) for owner entries — no confusing note',
      '4. admin_roles_library_owner_hint key removed from all 4 locale files',
      '5. Self-removal tooltip key present in all 4 locales',
      '6. Lockout prevention (last _owner) still works alongside self-removal guard',
      '7. No regressions in existing admin page tests',
      '8. Svelte 5 runes throughout'
    ].join('\n'),
    commitBody: 'Admin page fixes from walkthrough:\n- #146: Resolve person names from roster instead of rights value string\n- #147: Self-removal guard prevents lockout\n- #148: Hide remove button for owners (remove confusing note)',
    closesIssues: [146, 147, 148]
  },

  // ─── Slice 2: #149 Agenda admin toolbar ───────────────────────────────
  {
    issueNumber: 149,
    taskTag: 'S2',
    branch: 'fix/149-agenda-toolbar',
    title: 'Agenda admin toolbar grouping',
    commitPrefix: 'fix(#149)',
    skipRed: true,
    redPrompt: null,
    greenPrompt: [
      'Group the agenda admin buttons into a visual toolbar (#149).',
      '',
      ARCH_CONTEXT,
      '',
      '## Fix',
      '',
      'File: src/routes/+page.svelte',
      '',
      'The three admin controls — [⚙] (season management), [+ Season], [+ Event] —',
      'appear as separate, ungrouped buttons. Wrap them in a flex container with',
      'shared visual treatment so they read as one admin toolbar.',
      '',
      'Options (pick the one that fits the existing design):',
      '- Grouped button bar with shared border/background',
      '- Subtle flex container with gap + separator from the rest of the agenda',
      '- A flex row with consistent button styling (same height, alignment)',
      '',
      'Keep it simple — this is a visual grouping, not a component extraction.',
      'The buttons should still be individually rights-gated as they are now.',
      '',
      '## Verification',
      'pnpm test -- --run && pnpm check',
      'Check at 375px viewport that the toolbar does not overflow.'
    ].join('\n'),
    i18nPrompt: null,
    reviewChecklist: [
      '1. All three admin controls visually grouped as one toolbar',
      '2. Rights gating unchanged (each button still individually gated)',
      '3. Mobile responsive at 375px — no overflow',
      '4. Consistent button styling within the group',
      '5. No regressions in agenda tests'
    ].join('\n'),
    commitBody: 'Wrap [⚙], [+ Season], [+ Event] in a flex toolbar container\nso they read as a single admin action group.',
    closesIssues: [149]
  },

  // ─── Slice 3: #150 Roster remove arrows ──────────────────────────────
  {
    issueNumber: 150,
    taskTag: 'S3',
    branch: 'fix/150-remove-reorder-arrows',
    title: 'Roster: remove up/down reorder arrows',
    commitPrefix: 'fix(#150)',
    skipRed: true,
    redPrompt: null,
    greenPrompt: [
      'Remove up/down arrow buttons from section reordering (#150).',
      '',
      ARCH_CONTEXT,
      '',
      '## Fix',
      '',
      'File: src/routes/roster/+page.svelte',
      '',
      '1. Remove the up/down arrow buttons for section reordering.',
      '   The drag handle is sufficient. Find the buttons (likely rendering ▲/▼ or arrow icons)',
      '   and remove them along with their click handlers.',
      '',
      '2. If the arrow buttons have i18n labels, remove those keys from messages/{en,et,lv,uk}.json.',
      '',
      '3. Add a one-line comment documenting the subsection handle visibility question:',
      '   // Design question: rearrange handle visibility for subsections is TBD (see #150)',
      '   Place near the drag handle rendering.',
      '',
      '4. Keep the drag handle and all existing reorder logic intact.',
      '',
      '5. Update any tests that reference the arrow buttons.',
      '',
      '## Verification',
      'pnpm test -- --run && pnpm check'
    ].join('\n'),
    i18nPrompt: null,
    reviewChecklist: [
      '1. Arrow buttons removed (not just hidden)',
      '2. Drag handle still works for reordering',
      '3. Reorder logic unchanged',
      '4. Arrow-related i18n keys removed if they existed',
      '5. Tests updated (no references to removed buttons)',
      '6. Subsection handle question documented as TBD'
    ].join('\n'),
    commitBody: 'Remove up/down arrow buttons from section reordering.\nDrag handle is sufficient. Subsection handle visibility rule\ndocumented as design TBD.',
    closesIssues: [150]
  },

  // ─── Slice 4: #151 Typography consistency ────────────────────────────
  {
    issueNumber: 151,
    taskTag: 'S4',
    branch: 'fix/151-typography',
    title: 'Typography consistency pass',
    commitPrefix: 'fix(#151)',
    skipRed: true,
    redPrompt: null,
    greenPrompt: [
      'Audit and unify font sizes across the entire app (#151).',
      '',
      ARCH_CONTEXT,
      '',
      '## Process',
      '',
      '### Step 1: Catalog',
      'Read every .svelte file in src/routes/ and src/lib/components/.',
      'Catalog all Tailwind text-* classes currently in use:',
      '- Which pages use which sizes',
      '- Where inconsistencies exist',
      '',
      '### Step 2: Establish scale',
      'Apply a coherent Tailwind typographic scale:',
      '- text-xs (12px): badges, labels, metadata, timestamps',
      '- text-sm (14px): secondary text, descriptions, form labels',
      '- text-base (16px): body text, form controls (MUST stay >= 16px for iOS zoom, see #130)',
      '- text-lg (18px): section headers, primary headings',
      '- text-xl+ : page titles only',
      '',
      'This scale is a guideline — adjust based on what the existing design actually uses.',
      'The goal is CONSISTENCY, not a redesign.',
      '',
      '### Step 3: Apply',
      'For each file, update text-* classes to match the established scale.',
      'Key constraints:',
      '- Form controls (input, select, textarea) MUST stay >= 16px (text-base or larger)',
      '  This is the iOS zoom fix from #130 — do NOT regress it',
      '- Mobile responsive: check breakpoint-specific sizes (sm:text-*, md:text-*, etc.)',
      '- Touch targets: do not shrink buttons below 44px (see #136)',
      '',
      '### Pages to cover',
      '- src/routes/+page.svelte (agenda — largest file)',
      '- src/routes/roster/+page.svelte',
      '- src/routes/profile/+page.svelte',
      '- src/routes/library/+page.svelte',
      '- src/routes/admin/+page.svelte',
      '- src/routes/event/[id]/+page.svelte',
      '- All components in src/lib/components/',
      '',
      '## Verification',
      'pnpm test -- --run && pnpm check'
    ].join('\n'),
    i18nPrompt: null,
    reviewChecklist: [
      '1. Coherent typographic scale applied consistently across all pages',
      '2. Form controls >= 16px (text-base) — iOS zoom fix NOT regressed (#130)',
      '3. Touch targets >= 44px NOT regressed (#136)',
      '4. Headers, body, labels, badges each have a consistent size across pages',
      '5. Mobile responsive: breakpoint-specific sizes where needed',
      '6. No functional regressions (text readability, truncation, overflow)',
      '7. All tests pass (text changes may affect snapshot-like assertions)'
    ].join('\n'),
    commitBody: 'Typography consistency pass: unify text sizes across all pages\ninto a coherent Tailwind scale. Form controls stay >= 16px (iOS zoom).',
    closesIssues: [151]
  }
]

// ── Progress tracking ─────────────────────────────────────────────────────

// All 4 slices skip RED. Per task (happy path):
// S1: GREEN + I18N + INTEGRATION + REVIEW + 2×REPORT + MERGE = 7
// S2: GREEN + INTEGRATION + REVIEW + 2×REPORT + MERGE = 6
// S3: GREEN + INTEGRATION + REVIEW + 2×REPORT + MERGE = 6
// S4: GREEN + INTEGRATION + REVIEW + 2×REPORT + MERGE = 6
// RETRO = 1
// Total: 7 + 6 + 6 + 6 + 1 = 26

const TOTAL_AGENTS = tasks.reduce(function(sum, t) {
  return sum + (t.skipRed ? 0 : 1) + (t.greenPrompt ? 1 : 0) + (t.i18nPrompt ? 1 : 0) + 1 + 1 + 1 + 1 + 1
}, 0) + 1

let agentNum = 0

function progress(sliceLabel, phaseName, taskTitle) {
  agentNum++
  return '[agent ' + agentNum + '/' + TOTAL_AGENTS + '] ' + sliceLabel + ' — ' + phaseName + ': ' + taskTitle
}

// ── Pipeline execution ────────────────────────────────────────────────────

const results = []

for (let i = 0; i < tasks.length; i++) {
  const task = tasks[i]
  const taskLabel = '#' + task.issueNumber + '/' + task.taskTag + ' ' + task.title
  const sliceLabel = 'Slice ' + (i + 1) + '/' + tasks.length + ' (' + task.taskTag + ')'

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
      'Verify that all changes on branch ' + task.branch + ' for ' + taskLabel + ' are correct and wired in.\n\nWORKING DIRECTORY: ' + REPO + '\n\n## Checks\n1. All modified components still render correctly (grep for imports)\n2. No dead code introduced (removed features fully cleaned up)\n3. Run: cd ' + REPO + ' && pnpm test -- --run && pnpm check\n\nReturn passed=true if everything is wired and tests pass. Return passed=false with details on any issues.\n\nDo NOT fix anything — only verify and report.',
      { label: 'integration-' + task.taskTag + '-' + integrationAttempts, phase: 'INTEGRATION', schema: PROBE_SCHEMA, model: 'claude-sonnet-5[1m]' }
    )

    if (!integration || !integration.passed) {
      var failedChecks = (integration && integration.checks) ? integration.checks.filter(function(c) { return !c.passed }) : []
      var failSummary = failedChecks.map(function(c) { return c.name + ': ' + (c.detail || '') }).join('\n')

      if (integrationAttempts < 2) {
        phase('GREEN-FIX')
        log('[retry] ' + sliceLabel + ' — GREEN-FIX: wiring gaps for ' + task.title)
        await agent(
          'Fix issues on branch ' + task.branch + ' for ' + taskLabel + '.\n\nWORKING DIRECTORY: ' + REPO + '\n\nIssues found:\n' + failSummary + '\n\nFix, verify (pnpm test -- --run && pnpm check), commit.',
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
log('Pipeline complete: ' + results.length + ' slices merged.')

var completedList = results.map(function(r) {
  return '- ' + r.taskTag + ': ' + r.title + ' (review: ' + r.reviewVerdict + ', attempts: ' + r.reviewAttempts + ', sha: ' + (r.commitSha || 'unknown') + ')'
}).join('\n')

var retroMsg = '## Walkthrough Findings Pipeline Retrospective\n\n### Completed slices\n' + completedList + '\n\n### Pipeline shape\n4 serial slices, all skip-RED (well-specified walkthrough fixes). Each: GREEN → I18N (where applicable) → INTEGRATION → REVIEW → MERGE.\n\n### Questions for retro\n1. S1 admin page batch: roster-based name resolution vs entity fetch — which approach was used?\n2. S3 subsection handle rule: documented as TBD per plan — acceptable, or needs resolution?\n3. S4 typography: was the scale applied consistently? Any pages that need more attention?\n4. Fix batching worked for S1 — would S2+S3 have been better batched too?\n5. Anything missing from the walkthrough findings?\n\nWaiting for your observations.\n\n(*MVOX:Palestrina*)'

await agent(
  'Send a retrospective message to gama@po-team via the comms MCP tool.\n\nStep 1: Use ToolSearch with query "select:mcp__comms__send" to load the tool schema.\nStep 2: Call mcp__comms__send with to="gama@po-team" and the following message (send verbatim, preserving all newlines and formatting):\n\n' + retroMsg + '\n\nReturn sent=true after sending.',
  { label: 'retro-gama', phase: 'RETRO', schema: REPORT_SCHEMA, model: 'claude-sonnet-5[1m]', effort: 'low' }
)

log('Retrospective sent. Pipeline done.')
return { success: true, results: results }
