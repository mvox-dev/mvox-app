/**
 * keyboard-reorder-pipeline — Single-slice full TDD for #152.
 *
 * Keyboard-operable section reorder on drag handle.
 * WCAG 2.1.1 fix for admin roster reorder after #150 arrow removal.
 *
 * Model assignments:
 *   RED:         fable    — creative/lateral edge-case tests
 *   GREEN:       sonnet   — constrained execution
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
  name: 'keyboard-reorder-pipeline',
  description: '#152: Keyboard section reorder — single-slice full TDD with Gama reporting',
  phases: [
    { title: 'RED', detail: 'Write failing tests', model: 'claude-fable-5' },
    { title: 'GREEN', detail: 'Implement keyboard reorder', model: 'claude-sonnet-5[1m]' },
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

const ARCH_CONTEXT = [
  '## Architecture context (do NOT deviate from these)',
  '',
  '- **Pure client-side SPA** — no +page.server.ts, no form actions, no server routes.',
  '  All writes are browser-direct: onclick handler → *Actions.ts → entuFetch.',
  '- **entuFetch seam**: src/lib/entu/request.ts — `entuFetch(db, path, token, init, fetchImpl)`.',
  '  Every data function takes `fetchImpl: typeof fetch = fetch` as trailing param (injectable test seam).',
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

// ── Task definition ───────────────────────────────────────────────────────

const tasks = [
  {
    issueNumber: 152,
    taskTag: 'S1',
    branch: 'feat/152-keyboard-reorder',
    title: 'Keyboard-operable section reorder on drag handle',
    commitPrefix: 'feat(#152)',
    skipRed: false,
    redPrompt: [
      'Write failing tests for keyboard section reorder on the roster page (#152).',
      '',
      ARCH_CONTEXT,
      '',
      '## Context',
      '',
      '#150 removed ▲/▼ arrow buttons — the only keyboard reorder path. The drag handle',
      'is currently `tabindex="-1"` + `role="img"` and implements no keyboard protocol.',
      'This creates a WCAG 2.1.1 gap: keyboard-only users cannot reorder sections.',
      '',
      '## What to test',
      '',
      'Extend the existing test files:',
      '- src/routes/page.roster-ux-a11y.spec.ts (a11y guards)',
      '- src/routes/page.sections-a11y.spec.ts (section-specific a11y)',
      '',
      '### Handle accessibility',
      '- Drag handle has `role="button"` (not "img")',
      '- Handle has an accessible label (aria-label containing the section name)',
      '- Handle is focusable (tabindex="0" or roving tabindex)',
      '- At least one handle is in the tab order (roving: only the focused section)',
      '',
      '### Keyboard grab/drop protocol',
      '- Space or Enter on a focused handle enters "grabbed" state',
      '- Visual indicator appears when grabbed (CSS class change, outline, etc.)',
      '- ArrowUp while grabbed moves the section up one position',
      '- ArrowDown while grabbed moves the section down one position',
      '- Space or Enter while grabbed drops the section (confirms the move)',
      '- Escape while grabbed cancels and returns to original position',
      '',
      '### Reorder behavior',
      '- Moving a section calls performReorder with correct source/target args',
      '- ArrowUp at the top position is a no-op (clamp, no wrap)',
      '- ArrowDown at the bottom position is a no-op (clamp, no wrap)',
      '- reorderPending guard: keyboard reorder disabled while a reorder is in-flight',
      '',
      '### Live region',
      '- Moving a section announces via roster-reorder-status live region',
      '- Drop announces the final position',
      '- Cancel announces that the move was cancelled',
      '',
      '### Integration',
      '- The handle is reachable via Tab from the roster page (when admin and not expanded)',
      '- Keyboard reorder coexists with drag reorder (no regression)',
      '',
      '## Reference files',
      '- src/routes/roster/+page.svelte — drag handle, performReorder, dropOnto, reorderPending',
      '- The a11y tests removed in #150 carry comments pointing here — check those specs'
    ].join('\n'),
    greenPrompt: [
      'Implement keyboard section reorder on the drag handle (#152).',
      '',
      ARCH_CONTEXT,
      '',
      '## Context',
      '',
      'The drag handle in src/routes/roster/+page.svelte currently has `tabindex="-1"` +',
      '`role="img"`. It needs to become keyboard-operable for WCAG 2.1.1 compliance.',
      'Reuse the existing `performReorder` write path and `roster-reorder-status` live region.',
      '',
      '## What to implement',
      '',
      '### 1. Handle element changes',
      '- Change `role="img"` → `role="button"`',
      '- Add `aria-label="Reorder section: {sectionName}"` (include section name)',
      '- Implement roving tabindex: one handle in tab order at a time',
      '  - The first section handle gets `tabindex="0"`, others get `tabindex="-1"`',
      '  - When a handle is focused (via Tab or ArrowDown/Up between handles), it gets "0"',
      '  - Manage with a $state variable tracking the focused handle index',
      '',
      '### 2. Keyboard state machine',
      'Add a $state variable `grabbedSectionId: string | null = null`',
      '',
      '- **Idle** (grabbedSectionId === null):',
      '  - Space/Enter on handle → set grabbedSectionId = section.id, announce "Grabbed {name}"',
      '  - ArrowDown → move focus to next handle (roving tabindex)',
      '  - ArrowUp → move focus to previous handle (roving tabindex)',
      '',
      '- **Grabbed** (grabbedSectionId !== null):',
      '  - ArrowUp → call performReorder to move section up, announce "Moved {name} to position {n}"',
      '  - ArrowDown → call performReorder to move section down, announce same',
      '  - ArrowUp at top / ArrowDown at bottom → no-op (clamp)',
      '  - Space/Enter → drop (set grabbedSectionId = null), announce "Dropped {name} at position {n}"',
      '  - Escape → cancel (reset to original position), announce "Reorder cancelled"',
      '',
      '### 3. Visual feedback',
      '- When grabbed: add a CSS class to the section row (e.g., `outline-2 outline-blue-500 outline-dashed`)',
      '- The handle itself could show a different icon or color when grabbed',
      '',
      '### 4. Guards',
      '- Respect `reorderPending` — disable keyboard grab/move while in-flight',
      '- Respect the existing `canReorder` derived (admin && !isExpanded)',
      '',
      '### 5. Live region announcements',
      '- Reuse the existing `roster-reorder-status` live region (role="status", aria-live="polite")',
      '- Set its text content for: grab, move, drop, cancel, error',
      '',
      '### 6. No regression on drag',
      '- The existing drag handlers (dragstart/dragover/drop) must continue to work',
      '- Keyboard and drag are independent — they share performReorder but not state',
      '',
      '## Reference files',
      '- src/routes/roster/+page.svelte — all reorder code lives here',
      '- Look for: performReorder, dropOnto, reorderPending, section-drag-handle'
    ].join('\n'),
    i18nPrompt: null,
    reviewChecklist: [
      '1. Handle is role="button" with aria-label including section name',
      '2. Roving tabindex: only one handle in tab order at a time',
      '3. Full keyboard protocol: Space/Enter grab/drop, ArrowUp/ArrowDown move, Escape cancel',
      '4. performReorder reused (not duplicated)',
      '5. reorderPending guard respected (no keyboard moves while in-flight)',
      '6. Live region announces grab/move/drop/cancel correctly',
      '7. Visual feedback during grab state (outline, class change, etc.)',
      '8. ArrowUp at top and ArrowDown at bottom clamp (no-op, no wrap)',
      '9. Svelte 5 runes throughout ($state for grabbedSectionId, $derived for canReorder)',
      '10. No regression on drag reorder (drag handlers still work)',
      '11. Mobile: handle still works as drag target',
      '12. WCAG 2.1.1 satisfied — section reorder fully keyboard-operable'
    ].join('\n'),
    commitBody: 'Keyboard-operable section reorder on drag handle.\nRoving tabindex, Space/Enter grab/drop, ArrowUp/ArrowDown to move,\nEscape to cancel. Reuses performReorder + live region.\nCloses WCAG 2.1.1 gap from #150 arrow removal.',
    closesIssues: [152]
  }
]

// ── Progress tracking ─────────────────────────────────────────────────────

// Happy-path: RED + GREEN + INTEGRATION + REVIEW + 2×REPORT + MERGE + RETRO = 8
const TOTAL_AGENTS = 8
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

  // ── INTEGRATION ────────────────────────────────────────────────────────
  phase('INTEGRATION')
  log(progress(sliceLabel, 'INTEGRATION', task.title))

  let integrationAttempts = 0
  let integrationPassed = false

  while (!integrationPassed && integrationAttempts < 2) {
    integrationAttempts++

    const integration = await agent(
      'Verify that all changes on branch ' + task.branch + ' for ' + taskLabel + ' are correct and wired in.\n\nWORKING DIRECTORY: ' + REPO + '\n\n## Checks\n1. Drag handle has role="button" and aria-label in the rendered markup\n2. Keyboard event handlers are attached to the handle element\n3. performReorder is called from the keyboard path (grep for call sites)\n4. Live region (roster-reorder-status) is updated from keyboard handlers\n5. No drag regression: dragstart/dragover/drop handlers still present\n6. Run: cd ' + REPO + ' && pnpm test -- --run && pnpm check\n\nReturn passed=true if everything is wired and tests pass. Return passed=false with details on any issues.\n\nDo NOT fix anything — only verify and report.',
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

var retroMsg = '## Keyboard Reorder Pipeline Retrospective\n\n### Completed\n' + completedList + '\n\n### Pipeline shape\nSingle-slice full TDD: RED → GREEN → INTEGRATION → REVIEW → MERGE.\nWCAG 2.1.1 fix for admin roster reorder after #150 arrow removal.\n\n### Questions for retro\n1. Grab visual feedback: outline/border change, or a CSS class swap? What was used?\n2. ArrowUp/ArrowDown at bounds: clamp (no-op) or wrap? What was implemented?\n3. Handle aria-label: includes section name? Format acceptable?\n\nWaiting for your observations.\n\n(*MVOX:Palestrina*)'

await agent(
  'Send a retrospective message to gama@po-team via the comms MCP tool.\n\nStep 1: Use ToolSearch with query "select:mcp__comms__send" to load the tool schema.\nStep 2: Call mcp__comms__send with to="gama@po-team" and the following message (send verbatim, preserving all newlines and formatting):\n\n' + retroMsg + '\n\nReturn sent=true after sending.',
  { label: 'retro-gama', phase: 'RETRO', schema: REPORT_SCHEMA, model: 'claude-sonnet-5[1m]', effort: 'low' }
)

log('Retrospective sent. Pipeline done.')
return { success: true, results: results }
