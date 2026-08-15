/**
 * roving-tabindex-pipeline — #156 Roving tabindex on all button groups.
 *
 * 2 slices:
 *   S1: SPIKE — Audit all button groups in the codebase. Map each group,
 *       its current tab behavior, and what needs to change. Report to Gama.
 *   S2: Implement — Apply roving tabindex to each group identified in S1.
 *       Reuse the nav's existing pattern. Closes #156.
 *
 * S1 is an investigation (SPIKE, opus-5, no branch).
 * S2 is a skip-RED fix whose GREEN prompt is composed dynamically from S1 findings.
 *
 * Model assignments:
 *   SPIKE:       opus-5   — comprehension, scan codebase for button groups
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
  name: 'roving-tabindex-pipeline',
  description: '#156 Roving tabindex: SPIKE audit of button groups + implement across all groups',
  phases: [
    { title: 'SPIKE', detail: 'Audit all button groups, map current tab behavior', model: 'claude-opus-5[1m]' },
    { title: 'GREEN', detail: 'Implement roving tabindex on all groups', model: 'claude-sonnet-5[1m]' },
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

// ── Schemas ───────────────────────────────────────────────────────────────

const AUDIT_SCHEMA = {
  type: 'object',
  properties: {
    groups: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          file: { type: 'string' },
          lineRange: { type: 'string' },
          currentBehavior: { type: 'string' },
          needsChange: { type: 'boolean' },
          changeDescription: { type: 'string' }
        },
        required: ['name', 'file', 'currentBehavior', 'needsChange'],
        additionalProperties: false
      }
    },
    referenceImpl: { type: 'string' },
    summary: { type: 'string' },
    needsChangeCount: { type: 'number' },
    alreadyCorrectCount: { type: 'number' }
  },
  required: ['groups', 'summary', 'needsChangeCount', 'alreadyCorrectCount'],
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

// ── Progress tracking ─────────────────────────────────────────────────────

// S1 (SPIKE): 2 agents (SPIKE + REPORT)
// S2: GREEN+INTEGRATION+REVIEW+2×REPORT+MERGE = 6
// RETRO = 1
// Total: 2+6+1 = 9
const TOTAL_AGENTS = 9

let agentNum = 0

function progress(sliceLabel, phaseName, taskTitle) {
  agentNum++
  return '[agent ' + agentNum + '/' + TOTAL_AGENTS + '] ' + sliceLabel + ' — ' + phaseName + ': ' + taskTitle
}

// ── S1: SPIKE — Audit all button groups ─────────────────────────────────

phase('SPIKE')
log(progress('S1 (investigation)', 'SPIKE', '#156 roving tabindex audit'))

const audit = await agent(
  'Audit all button groups in the mvox codebase for roving tabindex implementation.\n\nWORKING DIRECTORY: ' + REPO + '\n\n## Goal\nMap every button group — a set of related buttons that form a logical unit — in the codebase. For each, document its current tab behavior and whether it needs roving tabindex.\n\n## Reference implementation\nThe main nav already implements roving tabindex correctly. Find it, read it, and document the pattern:\n- How it manages tabindex="0" on the active item and tabindex="-1" on others\n- How Left/Right arrow navigation works\n- How Tab leaves the group\n\n## Known groups to check (from #156 epic)\n1. View mode chip selector (Collapsed / Expanded / Arrange) — on the roster page\n2. Agenda admin toolbar (⚙, + Season, + Event) — on the agenda page\n3. Language selector (en / et / lv / uk) — on the profile page\n4. RSVP response buttons — on the agenda page\n5. Attendance status choices — on the agenda/event page\n6. Indent/unindent buttons in arrange mode — already tabindex="-1"\n7. Any other grouped controls found during scanning\n\n## Also check\n- src/lib/components/ — Autocomplete.svelte dropdown items, SectionPicker listbox\n- Any button clusters in src/routes/ pages\n\n## For each group, report:\n- name: human-readable name\n- file: source file path\n- lineRange: approximate line range (optional)\n- currentBehavior: how Tab/arrow keys currently work (e.g., "each button is a separate tab stop", "roving tabindex already implemented", "tabindex=-1 mouse-only")\n- needsChange: true if roving tabindex should be added\n- changeDescription: what specifically needs to change (only if needsChange=true)\n\n## Classification rules\n- NEEDS CHANGE: group of related buttons where each is currently a separate tab stop → convert to roving tabindex (one tab stop, arrow keys navigate within)\n- ALREADY CORRECT: group already uses roving tabindex or is a different pattern (e.g., listbox with role="listbox" → keep as-is, that is a different WAI-APG pattern)\n- EXCLUDED: buttons with tabindex="-1" that are mouse/touch only (like indent/unindent per Mihkel ruling) → no change, document why\n\nAlso report the reference implementation details (referenceImpl field) so the GREEN agent can replicate the pattern.',
  { label: 'spike-156', phase: 'SPIKE', schema: AUDIT_SCHEMA, model: 'claude-opus-5[1m]' }
)

if (!audit) {
  log('SPIKE returned null — halting')
  return { success: false, failedAt: 'S1 SPIKE null', results: [] }
}

log('SPIKE done: ' + audit.needsChangeCount + ' need change, ' + audit.alreadyCorrectCount + ' already correct — ' + audit.summary)

// Report S1 findings to Gama
phase('REPORT')
log(progress('S1 (investigation)', 'REPORT', 'audit findings → Gama'))

var auditSummaryLines = audit.groups.map(function(g) {
  return '- ' + g.name + ' (' + g.file + '): ' + (g.needsChange ? 'NEEDS CHANGE — ' + g.changeDescription : 'OK — ' + g.currentBehavior)
}).join('\n')

var auditMsg = 'S1 SPIKE #156 button group audit: ' + audit.needsChangeCount + ' need roving tabindex, ' + audit.alreadyCorrectCount + ' already correct.\n\n' + auditSummaryLines
await agent(
  'Send a progress report to gama@po-team via the comms MCP tool.\n\nStep 1: Use ToolSearch with query "select:mcp__comms__send" to load the tool schema.\nStep 2: Call mcp__comms__send with to="gama@po-team" and message="' + escapeForPrompt(auditMsg) + '"\n\nReturn sent=true after sending.',
  { label: 'report-spike-156', phase: 'REPORT', schema: REPORT_SCHEMA, model: 'claude-sonnet-5[1m]', effort: 'low' }
)

// ── S2: Implement roving tabindex ───────────────────────────────────────

// Compose GREEN prompt dynamically from SPIKE findings
var changeList = audit.groups.filter(function(g) { return g.needsChange }).map(function(g) {
  return '- ' + g.name + ' (' + g.file + (g.lineRange ? ':' + g.lineRange : '') + '): ' + g.changeDescription
}).join('\n')

var excludedList = audit.groups.filter(function(g) { return !g.needsChange }).map(function(g) {
  return '- ' + g.name + ' (' + g.file + '): ' + g.currentBehavior + ' — no change needed'
}).join('\n')

var greenPrompt = [
  'Implement roving tabindex on all button groups that need it (#156).',
  '',
  '## Roving tabindex pattern (from main nav reference)',
  audit.referenceImpl || 'Read the main nav implementation for the reference pattern.',
  '',
  '## Pattern to apply to each group:',
  '1. Only the active/selected item gets tabindex="0", all others tabindex="-1"',
  '2. Left/Right arrow keys move focus within the group (wrap or clamp — clamp preferred)',
  '3. Tab leaves the group entirely (moves to next focusable element outside)',
  '4. Add role="toolbar" or role="radiogroup" where semantically appropriate (toolbar for action buttons, radiogroup for mutually exclusive choices)',
  '5. Add aria-label on the group container',
  '',
  '## Groups that NEED roving tabindex:',
  changeList || '(none — SPIKE found no groups needing change)',
  '',
  '## Groups that are ALREADY CORRECT or EXCLUDED (do not touch):',
  excludedList || '(none)',
  '',
  '## Implementation notes:',
  '- Svelte 5 runes ($state, $derived) for tracking the active index',
  '- Use a shared helper if 3+ groups need the same boilerplate, otherwise inline',
  '- Ensure each group works on mobile (touch still works as before)',
  '- No i18n changes needed unless aria-labels are added (add to messages/*.json if so)',
  '',
  '## Verification',
  '1. pnpm test -- --run — ALL pass',
  '2. pnpm check — 0 type errors'
].join('\n')

phase('GREEN')
log(progress('S2 (implement)', 'GREEN', '#156 roving tabindex on button groups'))

const green = await agent(
  'FIRST: cd ' + REPO + ' && git checkout main && git pull && git checkout -b feat/156-roving-tabindex\n\n' + greenPrompt + '\n\nWORKING DIRECTORY: ' + REPO + '\nBRANCH: feat/156-roving-tabindex (just created)\n\nGit: git add -A && git commit -m "feat(#156): roving tabindex on all button groups"',
  { label: 'green-S2', phase: 'GREEN', schema: RESULT_SCHEMA, model: 'claude-sonnet-5[1m]' }
)

if (!green || !green.success) {
  log('GREEN failed: ' + (green ? green.summary : 'null'))
  return { success: false, failedAt: 'S2 GREEN', results: [{ taskTag: 'S1', issueNumber: 156, title: 'button group audit', reviewVerdict: 'SPIKE:done' }] }
}
log('GREEN done: ' + green.summary)

// ── INTEGRATION ─────────────────────────────────────────────────────────
phase('INTEGRATION')
log(progress('S2 (implement)', 'INTEGRATION', '#156 roving tabindex'))

let integrationAttempts = 0
let integrationPassed = false

while (!integrationPassed && integrationAttempts < 2) {
  integrationAttempts++

  const integration = await agent(
    'Verify roving tabindex implementation on branch feat/156-roving-tabindex.\n\nWORKING DIRECTORY: ' + REPO + '\n\n## Checks\n1. For every group that was changed: verify tabindex="0" on active, tabindex="-1" on others\n2. Arrow key handlers present on each group\n3. Tab leaves the group (not trapped)\n4. No regressions: existing click/touch behavior preserved\n5. Run: cd ' + REPO + ' && pnpm test -- --run && pnpm check\n\nDo NOT fix anything — only verify and report.',
    { label: 'integration-S2-' + integrationAttempts, phase: 'INTEGRATION', schema: PROBE_SCHEMA, model: 'claude-sonnet-5[1m]' }
  )

  if (!integration || !integration.passed) {
    var failedChecks = (integration && integration.checks) ? integration.checks.filter(function(c) { return !c.passed }) : []
    var failSummary = failedChecks.map(function(c) { return c.name + ': ' + (c.detail || '') }).join('\n')

    if (integrationAttempts < 2) {
      phase('GREEN-FIX')
      log('[retry] S2 — GREEN-FIX: wiring gaps')
      await agent(
        'Fix issues on branch feat/156-roving-tabindex.\n\nWORKING DIRECTORY: ' + REPO + '\n\nProblems found:\n' + failSummary + '\n\nFix, verify (pnpm test -- --run && pnpm check), commit.',
        { label: 'green-fix-S2', phase: 'GREEN-FIX', schema: RESULT_SCHEMA, model: 'claude-sonnet-5[1m]' }
      )
    } else {
      log('INTEGRATION still failing after fix — proceeding to REVIEW')
    }
  } else {
    integrationPassed = true
    log('INTEGRATION passed: ' + integration.summary)
  }
}

// ── REVIEW ──────────────────────────────────────────────────────────────
phase('REVIEW')
log(progress('S2 (implement)', 'REVIEW', '#156 roving tabindex'))

let verdict = null
let reviewAttempts = 0

while ((!verdict || verdict.verdict !== 'GREEN') && reviewAttempts < 3) {
  reviewAttempts++

  verdict = await agent(
    'You are Bentham, architecture reviewer for mvox-dev. Review branch feat/156-roving-tabindex for #156 roving tabindex.\n\nWORKING DIRECTORY: ' + REPO + '\n\n## Review checklist\n1. Every button group identified in the SPIKE has roving tabindex OR is documented as excluded\n2. Only the active item has tabindex="0", all others tabindex="-1"\n3. Left/Right arrow navigation works within each group\n4. Tab leaves the group (no focus trap)\n5. role="toolbar" or role="radiogroup" applied where appropriate\n6. aria-label on group containers\n7. Mobile: touch/click behavior preserved (no regression)\n8. Svelte 5 runes throughout\n9. No regressions: pnpm test -- --run && pnpm check\n10. Groups excluded from roving (e.g., indent/unindent tabindex="-1") are not accidentally changed\n\nProcedure:\n1. cd ' + REPO + ' && git diff main...HEAD --stat\n2. Read all changed files\n3. Run: pnpm test -- --run && pnpm check\n4. Issue GREEN / YELLOW / RED verdict\n\nIMPORTANT blockerType guidance:\n- blockerType "code" = requires changes to THIS branch before merge\n- Do NOT tag as "data" or "config" for advisory/speculative concerns',
    { label: 'review-S2-' + reviewAttempts, phase: 'REVIEW', schema: VERDICT_SCHEMA, model: 'claude-opus-5[1m]' }
  )

  if (!verdict) verdict = { verdict: 'RED', summary: 'Review agent returned null', findings: [] }

  if (verdict.verdict !== 'GREEN') {
    if (hasNonCodeBlocker(verdict.findings)) {
      log('Non-code blocker — halting')
      return { success: false, failedAt: 'S2 REVIEW (non-code blocker)', results: [], verdict: verdict }
    }

    if (reviewAttempts < 3) {
      phase('FIX')
      log('[retry ' + reviewAttempts + '] S2 — FIX: review findings')
      await agent(
        'Fix review findings for #156 roving tabindex in ' + REPO + ' on branch feat/156-roving-tabindex.\n\nVerdict: ' + verdict.verdict + '\n\n## Findings\n' + formatFindings(verdict.findings) + '\n\nFix, verify (pnpm test -- --run && pnpm check), commit.',
        { label: 'fix-S2-' + reviewAttempts, phase: 'FIX', schema: RESULT_SCHEMA, model: 'claude-opus-5[1m]' }
      )
    }
  }
}

if (!verdict || verdict.verdict === 'RED') {
  log('REVIEW failed after ' + reviewAttempts + ' attempts')
  return { success: false, failedAt: 'S2 REVIEW', results: [], verdict: verdict }
}
log('REVIEW: ' + verdict.verdict + ' — ' + verdict.summary)

// Report review result to Gama
phase('REPORT')
log(progress('S2 (implement)', 'REPORT', 'review verdict → Gama'))
var reviewMsg = 'S2 REVIEW: #156 roving tabindex — verdict ' + verdict.verdict + '. ' + verdict.summary
await agent(
  'Send a progress report to gama@po-team via the comms MCP tool.\n\nStep 1: Use ToolSearch with query "select:mcp__comms__send" to load the tool schema.\nStep 2: Call mcp__comms__send with to="gama@po-team" and message="' + escapeForPrompt(reviewMsg) + '"\n\nReturn sent=true after sending.',
  { label: 'report-review-S2', phase: 'REPORT', schema: REPORT_SCHEMA, model: 'claude-sonnet-5[1m]', effort: 'low' }
)

// ── MERGE ───────────────────────────────────────────────────────────────
phase('MERGE')
log(progress('S2 (implement)', 'MERGE', '#156 roving tabindex'))

var mergeCmd = 'cd ' + REPO + ' && git checkout main && git pull && git merge --squash feat/156-roving-tabindex && git commit -m "$(cat <<\'COMMITEOF\'\nfeat(#156): roving tabindex on all button groups\n\nImplement roving tabindex on all button groups: only the active item\ngets tabindex=0, Left/Right arrows navigate within, Tab leaves.\nMatches the main nav reference pattern.\n\nCloses #156\n\n' + CO_AUTHOR + '\nCOMMITEOF\n)" && git push && git branch -D feat/156-roving-tabindex && git push origin --delete feat/156-roving-tabindex 2>/dev/null || true'

const merge = await agent(
  'Squash-merge feat/156-roving-tabindex to main for #156.\n\nWORKING DIRECTORY: ' + REPO + '\n\nRun this exact command:\n' + mergeCmd + '\n\nReport the merge commit SHA.',
  { label: 'merge-S2', phase: 'MERGE', schema: RESULT_SCHEMA, model: 'claude-sonnet-5[1m]' }
)

if (!merge || !merge.success) {
  log('MERGE failed: ' + (merge ? merge.summary : 'null'))
  return { success: false, failedAt: 'S2 MERGE', results: [] }
}
log('Merged: ' + merge.summary)

// Report merge to Gama
var mergeReportMsg = 'S2 MERGED: #156 roving tabindex @ ' + (merge.commitSha || 'unknown') + '. ' + merge.summary
await agent(
  'Send a progress report to gama@po-team via the comms MCP tool.\n\nStep 1: Use ToolSearch with query "select:mcp__comms__send" to load the tool schema.\nStep 2: Call mcp__comms__send with to="gama@po-team" and message="' + escapeForPrompt(mergeReportMsg) + '"\n\nReturn sent=true after sending.',
  { label: 'report-merge-S2', phase: 'REPORT', schema: REPORT_SCHEMA, model: 'claude-sonnet-5[1m]', effort: 'low' }
)

// ── RETRO ───────────────────────────────────────────────────────────────
phase('RETRO')
log(progress('Final', 'RETRO', 'retrospective → Gama'))
log('#156 pipeline complete.')

var retroMsg = '## #156 Roving Tabindex — Retrospective\n\n### Results\n- SPIKE: ' + audit.needsChangeCount + ' groups needed change, ' + audit.alreadyCorrectCount + ' already correct\n- Fix merged: ' + (merge.commitSha || 'unknown') + '\n- Review: ' + verdict.verdict + ' (attempts: ' + reviewAttempts + ')\n\n### Groups audited\n' + auditSummaryLines + '\n\n### Questions\n1. Should the SPIKE have also checked components in src/lib/components/ (Autocomplete, SectionPicker)?\n2. Should role="toolbar" have been added to groups matching the WAI-APG toolbar pattern?\n3. The indent/unindent buttons stay tabindex="-1" per Mihkel ruling — do they need roving (arrow navigation) or just stay as-is?\n\n(*MVOX:Palestrina*)'

await agent(
  'Send a retrospective message to gama@po-team via the comms MCP tool.\n\nStep 1: Use ToolSearch with query "select:mcp__comms__send" to load the tool schema.\nStep 2: Call mcp__comms__send with to="gama@po-team" and the following message (send verbatim):\n\n' + retroMsg + '\n\nReturn sent=true after sending.',
  { label: 'retro-gama', phase: 'RETRO', schema: REPORT_SCHEMA, model: 'claude-sonnet-5[1m]', effort: 'low' }
)

log('Retrospective sent. #156 pipeline done.')
return {
  success: true,
  results: [
    { taskTag: 'S1', issueNumber: 156, title: 'button group audit', reviewVerdict: 'SPIKE:done', needsChangeCount: audit.needsChangeCount, alreadyCorrectCount: audit.alreadyCorrectCount },
    { taskTag: 'S2', issueNumber: 156, title: 'roving tabindex implementation', commitSha: merge.commitSha, reviewVerdict: verdict.verdict, reviewAttempts: reviewAttempts }
  ]
}
