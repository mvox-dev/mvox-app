/**
 * ux-fixes-157-158-pipeline — Single skip-RED slice for #157 + #158.
 *
 * #157: Event page — whole field as edit tap target (not just pencil icon)
 * #158: Auto-scroll to attendance list on open
 *
 * (*MVOX:Palestrina*)
 */
export const meta = {
  name: 'ux-fixes-157-158',
  description: 'UX fixes: event field tap target (#157) + attendance auto-scroll (#158)',
  phases: [
    { title: 'GREEN', detail: 'Implement fixes', model: 'claude-sonnet-5[1m]' },
    { title: 'INTEGRATION', detail: 'Wiring verification', model: 'claude-sonnet-5[1m]' },
    { title: 'REVIEW', detail: 'Architecture review', model: 'claude-opus-5[1m]' },
    { title: 'FIX', detail: 'Address review findings', model: 'claude-opus-5[1m]' },
    { title: 'REPORT', detail: 'Report to Gama', model: 'claude-sonnet-5[1m]' },
    { title: 'MERGE', detail: 'Squash-merge to main', model: 'claude-sonnet-5[1m]' },
    { title: 'RETRO', detail: 'Retrospective with Gama', model: 'claude-sonnet-5[1m]' }
  ]
}

const REPO = '/home/ai-teams/workspace-app'
const CO_AUTHOR = 'Co-authored-by: Mihkel Putrinš <mihkel.putrinsh@gmail.com>'

const ARCH_CONTEXT = [
  '## Architecture context',
  '',
  '- **Pure client-side SPA** — no +page.server.ts, no form actions, no server routes.',
  '- **Svelte 5 runes ONLY**: $state(), $derived(), $effect(), $props(), $bindable().',
  '  NEVER legacy `export let` or `$:` syntax.',
  ''
].join('\n')

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

// ── Task definition ──────────────────────────────────────────────────────

const task = {
  issueNumber: 157,
  taskTag: 'S1',
  branch: 'fix/ux-batch-157-158',
  title: 'UX fixes (#157 event field tap target, #158 attendance auto-scroll)',
  commitPrefix: 'fix(#157,#158)',
  greenPrompt: [
    'Fix two UX issues on one branch.',
    '',
    ARCH_CONTEXT,
    '',
    '## 1. #157 — Event page: whole field as edit tap target',
    'File: src/routes/event/[id]/+page.svelte',
    '',
    'Currently only the pencil icon activates inline editing — the rest of the field area is a dead zone.',
    '',
    'Fix: wrap the field display value and pencil icon in a single clickable container.',
    '- Use a `<button>` element (not div with role="button") for the wrapper — semantic, keyboard-accessible by default.',
    '- The click handler activates edit mode (same handler the pencil currently uses).',
    '- The pencil icon stays as a visual affordance inside the button.',
    '- Style the button to look like the current field display (no button chrome — use `appearance-none`, transparent background).',
    '- Apply to ALL inline-edit fields on the event detail page.',
    '- Ensure Enter/Escape still work correctly in edit mode (no regression).',
    '',
    '## 2. #158 — Auto-scroll to attendance list on open',
    'Files: src/routes/+page.svelte, possibly src/lib/components/attendance/AttendanceSurface.svelte',
    '',
    'When tapping "Märgi kohalolek" (Mark attendance), auto-scroll to the attendance list.',
    '',
    'Fix:',
    '- After the attendance panel renders and data loads, call `scrollIntoView({ block: "start", behavior: "smooth" })` on the panel container.',
    '- Use `tick()` from svelte to wait for DOM update before scrolling.',
    '- The scroll should happen AFTER data loads (not just after the panel opens) — the content height matters.',
    '- If the attendance data loads asynchronously, scroll after the loading state resolves.',
    '',
    '## Verification',
    '1. cd /home/ai-teams/workspace-app && pnpm test -- --run — ALL pass',
    '2. cd /home/ai-teams/workspace-app && pnpm check — 0 type errors'
  ].join('\n'),
  reviewChecklist: [
    '1. All inline-edit fields on event detail page have full-width tap target (not just pencil)',
    '2. Clickable container is a semantic <button> (keyboard accessible by default)',
    '3. scrollIntoView called after data loads (not just after panel opens — wait for content)',
    '4. Smooth scroll behavior',
    '5. No regression on existing edit behavior (Enter/Escape still work in edit mode)',
    '6. Mobile: tap targets are full field width',
    '7. Svelte 5 runes throughout',
    '8. No new a11y issues introduced (button within button, etc.)'
  ].join('\n'),
  commitBody: 'UX fixes: event field whole-area tap target (#157) + attendance auto-scroll (#158).',
  closesIssues: [157, 158]
}

// ── Progress tracking ────────────────────────────────────────────────────
// GREEN + INTEGRATION + REVIEW + 2×REPORT + MERGE + RETRO = 7
const TOTAL_AGENTS = 7
let agentNum = 0

function progress(phaseName, title) {
  agentNum++
  return '[agent ' + agentNum + '/' + TOTAL_AGENTS + '] S1 — ' + phaseName + ': ' + title
}

// ── Pipeline execution ────────────────────────────────────────────────────

const taskLabel = '#157,#158/S1 ' + task.title

log('Starting: ' + taskLabel)

// ── GREEN ────────────────────────────────────────────────────────────────
phase('GREEN')
log(progress('GREEN', task.title))

const green = await agent(
  'FIRST: cd ' + REPO + ' && git checkout main && git pull && git checkout -b ' + task.branch + '\n\n' + task.greenPrompt + '\n\nWORKING DIRECTORY: ' + REPO + '\nBRANCH: ' + task.branch + ' (just created)\n\nGit: git add -A && git commit -m "' + task.commitPrefix + '/S1: ' + task.title + '"',
  { label: 'green-S1', phase: 'GREEN', schema: RESULT_SCHEMA, model: 'claude-sonnet-5[1m]' }
)

if (!green || !green.success) {
  log('GREEN failed: ' + (green ? green.summary : 'null'))
  return { success: false, failedAt: 'GREEN' }
}
log('GREEN done: ' + green.summary)

// ── INTEGRATION ──────────────────────────────────────────────────────────
phase('INTEGRATION')
log(progress('INTEGRATION', task.title))

let integrationAttempts = 0
let integrationPassed = false

while (!integrationPassed && integrationAttempts < 2) {
  integrationAttempts++

  const integration = await agent(
    'Verify that all changes on branch ' + task.branch + ' for ' + taskLabel + ' are REACHABLE from the actual app.\n\nWORKING DIRECTORY: ' + REPO + '\n\n## Checks\n1. Event detail inline-edit fields: verify the clickable wrapper renders and the click handler is wired.\n2. Attendance panel: verify scrollIntoView is called after the panel opens.\n3. Run: cd ' + REPO + ' && pnpm test -- --run && pnpm check\n\nReturn passed=true if changes are wired correctly. Do NOT fix anything.',
    { label: 'integration-S1-' + integrationAttempts, phase: 'INTEGRATION', schema: PROBE_SCHEMA, model: 'claude-sonnet-5[1m]' }
  )

  if (!integration || !integration.passed) {
    if (integrationAttempts < 2) {
      var failedChecks = (integration && integration.checks) ? integration.checks.filter(function(c) { return !c.passed }) : []
      var failSummary = failedChecks.map(function(c) { return c.name + ': ' + (c.detail || '') }).join('\n')
      phase('GREEN-FIX')
      log('[retry] GREEN-FIX: wiring gaps')
      await agent(
        'Fix wiring gaps on branch ' + task.branch + '.\n\nWORKING DIRECTORY: ' + REPO + '\n\nUnreachable features:\n' + failSummary + '\n\nFix, verify (pnpm test -- --run && pnpm check), commit.',
        { label: 'green-fix-S1', phase: 'GREEN-FIX', schema: RESULT_SCHEMA, model: 'claude-sonnet-5[1m]' }
      )
    } else {
      log('INTEGRATION still failing — proceeding to REVIEW')
    }
  } else {
    integrationPassed = true
    log('INTEGRATION passed: ' + integration.summary)
  }
}

// ── REVIEW ───────────────────────────────────────────────────────────────
phase('REVIEW')
log(progress('REVIEW', task.title))

let verdict = null
let reviewAttempts = 0

while ((!verdict || verdict.verdict !== 'GREEN') && reviewAttempts < 3) {
  reviewAttempts++

  verdict = await agent(
    'You are Bentham, architecture reviewer for mvox-dev. Review branch ' + task.branch + ' for ' + taskLabel + '.\n\nWORKING DIRECTORY: ' + REPO + '\n\n' + ARCH_CONTEXT + '\n\n## Review checklist\n' + task.reviewChecklist + '\n\nProcedure:\n1. cd ' + REPO + ' && git diff main...HEAD --stat\n2. Read all changed files\n3. Run: pnpm test -- --run && pnpm check\n4. Issue GREEN / YELLOW / RED verdict\n\nFor non-GREEN: list findings with description, fixShape, and blockerType (code/data/config).\n\nIMPORTANT blockerType guidance:\n- "code" = requires changes to THIS branch before merge\n- Do NOT tag as "data"/"config" for future/separate concerns',
    { label: 'review-S1-' + reviewAttempts, phase: 'REVIEW', schema: VERDICT_SCHEMA, model: 'claude-opus-5[1m]' }
  )

  if (!verdict) verdict = { verdict: 'RED', summary: 'Review agent returned null', findings: [] }

  if (verdict.verdict !== 'GREEN') {
    if (hasNonCodeBlocker(verdict.findings)) {
      log('Non-code blocker — halting')
      return { success: false, failedAt: 'REVIEW (non-code blocker)', verdict: verdict }
    }

    if (reviewAttempts < 3) {
      phase('FIX')
      log('[retry ' + reviewAttempts + '] FIX: review findings')
      await agent(
        'Fix review findings for ' + taskLabel + ' in ' + REPO + ' on branch ' + task.branch + '.\n\n' + ARCH_CONTEXT + '\n\nVerdict: ' + verdict.verdict + '\n\n## Findings\n' + formatFindings(verdict.findings) + '\n\nFix, verify (pnpm test -- --run && pnpm check), commit.',
        { label: 'fix-S1-' + reviewAttempts, phase: 'FIX', schema: RESULT_SCHEMA, model: 'claude-opus-5[1m]' }
      )
    }
  }
}

if (!verdict || verdict.verdict === 'RED') {
  log('REVIEW failed after ' + reviewAttempts + ' attempts')
  return { success: false, failedAt: 'REVIEW', verdict: verdict }
}
log('REVIEW: ' + verdict.verdict + ' — ' + verdict.summary)

// ── REPORT (post-review) ────────────────────────────────────────────────
phase('REPORT')
log(progress('REPORT', 'review verdict → Gama'))
var reviewMsg = 'S1 REVIEW: ' + taskLabel + ' — verdict ' + verdict.verdict + '. ' + verdict.summary
await agent(
  'Send a progress report to gama@po-team via the comms MCP tool.\n\nStep 1: Use ToolSearch with query "select:mcp__comms__send" to load the tool schema.\nStep 2: Call mcp__comms__send with to="gama@po-team" and message="' + escapeForPrompt(reviewMsg) + '"\n\nReturn sent=true after sending.',
  { label: 'report-review-S1', phase: 'REPORT', schema: REPORT_SCHEMA, model: 'claude-sonnet-5[1m]', effort: 'low' }
)

// ── MERGE ────────────────────────────────────────────────────────────────
phase('MERGE')
log(progress('MERGE', task.title))

var closesLines = task.closesIssues.map(function(n) { return '\nCloses #' + n }).join('')
var mergeCmd = 'cd ' + REPO + ' && git checkout main && git pull && git merge --squash ' + task.branch + ' && git commit -m "$(cat <<\'COMMITEOF\'\n' + task.commitPrefix + '/S1: ' + task.title + '\n\n' + task.commitBody + closesLines + '\n\n' + CO_AUTHOR + '\nCOMMITEOF\n)" && git push && git branch -D ' + task.branch + ' && git push origin --delete ' + task.branch + ' 2>/dev/null || true'

const merge = await agent(
  'Squash-merge ' + task.branch + ' to main for ' + taskLabel + '.\n\nWORKING DIRECTORY: ' + REPO + '\n\nRun this exact command:\n' + mergeCmd + '\n\nReport the merge commit SHA.',
  { label: 'merge-S1', phase: 'MERGE', schema: RESULT_SCHEMA, model: 'claude-sonnet-5[1m]' }
)

if (!merge || !merge.success) {
  log('MERGE failed: ' + (merge ? merge.summary : 'null'))
  return { success: false, failedAt: 'MERGE' }
}
log('Merged: ' + merge.summary)

// ── REPORT (post-merge) ─────────────────────────────────────────────────
var mergeMsg = 'S1 MERGED: ' + taskLabel + (merge.commitSha ? ' @ ' + merge.commitSha : '') + '. ' + merge.summary
await agent(
  'Send a progress report to gama@po-team via the comms MCP tool.\n\nStep 1: Use ToolSearch with query "select:mcp__comms__send" to load the tool schema.\nStep 2: Call mcp__comms__send with to="gama@po-team" and message="' + escapeForPrompt(mergeMsg) + '"\n\nReturn sent=true after sending.',
  { label: 'report-merge-S1', phase: 'REPORT', schema: REPORT_SCHEMA, model: 'claude-sonnet-5[1m]', effort: 'low' }
)

// ── RETRO ────────────────────────────────────────────────────────────────
phase('RETRO')
log(progress('RETRO', 'retrospective → Gama'))

var retroMsg = '## UX Fixes Pipeline Retrospective\n\n### Completed\n- #157 Event field whole-area tap target\n- #158 Attendance auto-scroll\n\nReview: ' + verdict.verdict + ' (attempts: ' + reviewAttempts + '), SHA: ' + (merge.commitSha || 'unknown') + '\n\nSingle skip-RED slice — both fixes small and well-specified.\n\n(*MVOX:Palestrina*)'

await agent(
  'Send a retrospective message to gama@po-team via the comms MCP tool.\n\nStep 1: Use ToolSearch with query "select:mcp__comms__send" to load the tool schema.\nStep 2: Call mcp__comms__send with to="gama@po-team" and the following message:\n\n' + retroMsg + '\n\nReturn sent=true after sending.',
  { label: 'retro-gama', phase: 'RETRO', schema: REPORT_SCHEMA, model: 'claude-sonnet-5[1m]', effort: 'low' }
)

log('Pipeline done.')
return {
  success: true,
  results: [{
    taskTag: 'S1',
    issueNumber: 157,
    title: task.title,
    commitSha: merge.commitSha,
    reviewVerdict: verdict.verdict,
    reviewAttempts: reviewAttempts
  }]
}
