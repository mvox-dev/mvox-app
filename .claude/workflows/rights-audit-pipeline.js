/**
 * rights-audit-pipeline — #133 Rights inspection audit.
 *
 * 2 slices:
 *   S1: SPIKE — Map parent chains for all 8 creates, classify each explicit
 *       _sharing/_inheritrights as redundant or necessary. Report to Gama.
 *   S2: Fix — Remove redundant explicit _sharing/_inheritrights from creates,
 *       document exceptions. Closes #133.
 *
 * S1 is an investigation (SPIKE, opus-5, no branch).
 * S2 is a skip-RED fix whose GREEN prompt is composed dynamically from S1 findings.
 *
 * Model assignments:
 *   SPIKE:       opus-5   — comprehension, read source + trace parent chains
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
  name: 'rights-audit-pipeline',
  description: '#133 Rights inspection: SPIKE to map parent chains + fix to remove redundant _sharing',
  phases: [
    { title: 'SPIKE', detail: 'Map parent chains for 8 creates, classify _sharing', model: 'claude-opus-5[1m]' },
    { title: 'GREEN', detail: 'Remove redundant _sharing + document exceptions', model: 'claude-sonnet-5[1m]' },
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
    creates: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          file: { type: 'string' },
          line: { type: 'number' },
          entityType: { type: 'string' },
          parentChain: { type: 'string' },
          explicitSharing: { type: 'boolean' },
          explicitInheritRights: { type: 'boolean' },
          inheritRightsValue: { type: 'boolean' },
          classification: { type: 'string', enum: ['redundant', 'necessary'] },
          reason: { type: 'string' }
        },
        required: ['file', 'entityType', 'parentChain', 'classification', 'reason'],
        additionalProperties: false
      }
    },
    summary: { type: 'string' },
    redundantCount: { type: 'number' },
    necessaryCount: { type: 'number' }
  },
  required: ['creates', 'summary', 'redundantCount', 'necessaryCount'],
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

// ── S1: SPIKE — Map parent chains for all creates ───────────────────────

phase('SPIKE')
log(progress('S1 (investigation)', 'SPIKE', '#133 rights inspection audit'))

const audit = await agent(
  'Audit all entity creates in the mvox codebase for explicit _sharing/_inheritrights usage.\n\nWORKING DIRECTORY: ' + REPO + '\n\n## Goal\nFor each create that sets _sharing or _inheritrights explicitly, trace the full parent chain to the organization entity and classify the explicit setting as REDUNDANT (inheritance from org suffices) or NECESSARY (inheritance chain breaks).\n\n## Creates to audit\n\n1. attendanceData.ts:88 — attendance, parent chain: event → season → org\n2. rsvpData.ts:127 — rsvp, parent: person (NOT in org chain)\n3. inviteData.ts:222 — invitation (1), parent chain: unknown, investigate\n4. inviteData.ts:303 — invitation (2), parent chain: unknown, investigate\n5. repertoireActions.ts:64 — repertoire_item, parent chain: season → org\n6. repertoireActions.ts:191 — program_item, parent chain: event → season → org\n7. lendingActions.ts:35 — lending, parent chain: unknown, investigate\n8. sectionActions.ts — section, parent chain: ?→ org\n9. profileData.ts:81 — profile, _inheritrights: false (known deliberate isolation)\n10. inviteData.ts:222-223 — invitation, _inheritrights: true + _sharing: domain (investigate)\n\n## Procedure\n\nFor each create:\n1. Read the source file, find the POST body props array\n2. Identify what _sharing and/or _inheritrights values are set\n3. Trace the parent chain by reading the _parent reference — what entity type is it parented under?\n4. For each step in the chain, determine if _inheritrights is true (or absent/default)\n   - Read ~/projects/entu-api/utils/entity.js for create-time _inheritrights copy behavior\n   - Read ~/projects/entu-api/utils/aggregate.js for runtime inheritance\n5. Classify:\n   - REDUNDANT: parent chain reaches org, _inheritrights true at every step → explicit _sharing:domain unnecessary\n   - NECESSARY: parent chain breaks (e.g., child of person, not org chain) or _inheritrights explicitly false somewhere → explicit setting required\n\n## Known exceptions (classify as NECESSARY with reason)\n- profileData.ts:81 _inheritrights: false — deliberate isolation, profiles must not inherit from person\n\n## Report format\nReturn an array of creates, each with: file, entityType, parentChain (human-readable), classification (redundant/necessary), reason (why).\nAlso return counts: redundantCount, necessaryCount.',
  { label: 'spike-133', phase: 'SPIKE', schema: AUDIT_SCHEMA, model: 'claude-opus-5[1m]' }
)

if (!audit) {
  log('SPIKE returned null — halting')
  return { success: false, failedAt: 'S1 SPIKE null', results: [] }
}

log('SPIKE done: ' + audit.redundantCount + ' redundant, ' + audit.necessaryCount + ' necessary — ' + audit.summary)

// Report S1 findings to Gama
phase('REPORT')
log(progress('S1 (investigation)', 'REPORT', 'audit findings → Gama'))

var auditSummaryLines = audit.creates.map(function(c) {
  return '- ' + c.file + ' (' + c.entityType + '): ' + c.classification.toUpperCase() + ' — ' + c.reason
}).join('\n')

var auditMsg = 'S1 SPIKE #133 rights audit: ' + audit.redundantCount + ' redundant, ' + audit.necessaryCount + ' necessary.\n\n' + auditSummaryLines
await agent(
  'Send a progress report to gama@po-team via the comms MCP tool.\n\nStep 1: Use ToolSearch with query "select:mcp__comms__send" to load the tool schema.\nStep 2: Call mcp__comms__send with to="gama@po-team" and message="' + escapeForPrompt(auditMsg) + '"\n\nReturn sent=true after sending.',
  { label: 'report-spike-133', phase: 'REPORT', schema: REPORT_SCHEMA, model: 'claude-sonnet-5[1m]', effort: 'low' }
)

// ── S2: Fix — Remove redundant + document exceptions ────────────────────

// Compose the GREEN prompt dynamically from SPIKE findings
var redundantList = audit.creates.filter(function(c) { return c.classification === 'redundant' }).map(function(c) {
  return '- ' + c.file + (c.line ? ':' + c.line : '') + ' (' + c.entityType + '): remove explicit _sharing:domain. Parent chain: ' + c.parentChain
}).join('\n')

var necessaryList = audit.creates.filter(function(c) { return c.classification === 'necessary' }).map(function(c) {
  return '- ' + c.file + (c.line ? ':' + c.line : '') + ' (' + c.entityType + '): KEEP. Reason: ' + c.reason
}).join('\n')

var greenPrompt = [
  'Remove redundant explicit _sharing/_inheritrights from entity creates and document exceptions (#133).',
  '',
  '## Architecture context',
  '- Org entity has _sharing:domain + _inheritrights:true',
  '- Entu copies _inheritrights from parent at create time (utils/entity.js:296-327)',
  '- Entu copies _sharing from parent at create time when parent is non-private',
  '- Creates in the org→season→event chain inherit both — explicit setting is redundant',
  '- Creates outside the org chain (e.g., child of person) do NOT inherit — explicit setting is needed',
  '',
  '## REDUNDANT — remove explicit _sharing:domain from POST body:',
  redundantList || '(none found)',
  '',
  'For each redundant create:',
  '1. Remove the _sharing prop from the POST body array',
  '2. If _inheritrights:true is also set explicitly and the parent chain provides it, remove that too',
  '3. Add a one-line contract comment above the POST: // _sharing + _inheritrights inherited from org via parent chain',
  '4. Update any tests that assert on the POST body shape (toEqual) — remove the _sharing assertion',
  '',
  '## NECESSARY — keep explicit setting, add documentation comment:',
  necessaryList || '(none found)',
  '',
  'For each necessary create:',
  '1. Keep the explicit _sharing and/or _inheritrights as-is',
  '2. Add a one-line contract comment explaining WHY: // explicit _sharing required: <reason>',
  '',
  '## Verification',
  '1. pnpm test -- --run — ALL pass (some tests will need _sharing assertion updates)',
  '2. pnpm check — 0 type errors',
  '',
  '## IMPORTANT',
  '- Do NOT touch entityCreate.ts (the #132 creates already omit _sharing by design)',
  '- Do NOT touch profileData.ts _inheritrights:false (deliberate isolation)',
  '- Only modify creates listed above'
].join('\n')

phase('GREEN')
log(progress('S2 (fix)', 'GREEN', '#133 remove redundant _sharing + document exceptions'))

const green = await agent(
  'FIRST: cd ' + REPO + ' && git checkout main && git pull && git checkout -b fix/133-rights-audit\n\n' + greenPrompt + '\n\nWORKING DIRECTORY: ' + REPO + '\nBRANCH: fix/133-rights-audit (just created)\n\nGit: git add -A && git commit -m "fix(#133): remove redundant explicit _sharing, document exceptions"',
  { label: 'green-S2', phase: 'GREEN', schema: RESULT_SCHEMA, model: 'claude-sonnet-5[1m]' }
)

if (!green || !green.success) {
  log('GREEN failed: ' + (green ? green.summary : 'null'))
  return { success: false, failedAt: 'S2 GREEN', results: [{ taskTag: 'S1', issueNumber: 133, title: 'rights audit SPIKE', reviewVerdict: 'SPIKE:done' }] }
}
log('GREEN done: ' + green.summary)

// ── INTEGRATION ─────────────────────────────────────────────────────────
phase('INTEGRATION')
log(progress('S2 (fix)', 'INTEGRATION', '#133 rights audit'))

let integrationAttempts = 0
let integrationPassed = false

while (!integrationPassed && integrationAttempts < 2) {
  integrationAttempts++

  const integration = await agent(
    'Verify that the rights audit changes on branch fix/133-rights-audit are correct and no creates are broken.\n\nWORKING DIRECTORY: ' + REPO + '\n\n## Checks\n1. For every create that HAD _sharing removed: verify the parent chain to org is intact and _inheritrights propagates\n2. For every create that KEPT _sharing: verify the contract comment explains why\n3. Run: cd ' + REPO + ' && pnpm test -- --run && pnpm check\n4. Verify no new _sharing or _inheritrights was accidentally added\n\nDo NOT fix anything — only verify and report.',
    { label: 'integration-S2-' + integrationAttempts, phase: 'INTEGRATION', schema: PROBE_SCHEMA, model: 'claude-sonnet-5[1m]' }
  )

  if (!integration || !integration.passed) {
    var failedChecks = (integration && integration.checks) ? integration.checks.filter(function(c) { return !c.passed }) : []
    var failSummary = failedChecks.map(function(c) { return c.name + ': ' + (c.detail || '') }).join('\n')

    if (integrationAttempts < 2) {
      phase('GREEN-FIX')
      log('[retry] S2 — GREEN-FIX: wiring gaps')
      await agent(
        'Fix issues on branch fix/133-rights-audit.\n\nWORKING DIRECTORY: ' + REPO + '\n\nProblems found:\n' + failSummary + '\n\nFix, verify (pnpm test -- --run && pnpm check), commit.',
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
log(progress('S2 (fix)', 'REVIEW', '#133 rights audit'))

let verdict = null
let reviewAttempts = 0

while ((!verdict || verdict.verdict !== 'GREEN') && reviewAttempts < 3) {
  reviewAttempts++

  verdict = await agent(
    'You are Bentham, architecture reviewer for mvox-dev. Review branch fix/133-rights-audit for #133 rights inspection audit.\n\nWORKING DIRECTORY: ' + REPO + '\n\n## Review checklist\n1. Every create that had _sharing removed: parent chain to org is intact, _inheritrights true at every step\n2. Every create that kept _sharing: contract comment explains why (inheritance chain breaks)\n3. profileData.ts _inheritrights:false is UNTOUCHED\n4. entityCreate.ts (the #132 creates) is UNTOUCHED\n5. Tests updated to match new POST body shape (no _sharing where removed)\n6. No regression: pnpm test -- --run && pnpm check\n7. Contract comments are accurate and concise (one line each)\n8. No create accidentally lost a NECESSARY _sharing\n\nProcedure:\n1. cd ' + REPO + ' && git diff main...HEAD --stat\n2. Read all changed files\n3. Run: pnpm test -- --run && pnpm check\n4. Issue GREEN / YELLOW / RED verdict\n\nIMPORTANT blockerType guidance:\n- blockerType "code" = requires changes to THIS branch before merge\n- Do NOT tag as "data" or "config" for advisory/speculative concerns',
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
        'Fix review findings for #133 rights audit in ' + REPO + ' on branch fix/133-rights-audit.\n\nVerdict: ' + verdict.verdict + '\n\n## Findings\n' + formatFindings(verdict.findings) + '\n\nFix, verify (pnpm test -- --run && pnpm check), commit.',
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
log(progress('S2 (fix)', 'REPORT', 'review verdict → Gama'))
var reviewMsg = 'S2 REVIEW: #133 rights audit — verdict ' + verdict.verdict + '. ' + verdict.summary
await agent(
  'Send a progress report to gama@po-team via the comms MCP tool.\n\nStep 1: Use ToolSearch with query "select:mcp__comms__send" to load the tool schema.\nStep 2: Call mcp__comms__send with to="gama@po-team" and message="' + escapeForPrompt(reviewMsg) + '"\n\nReturn sent=true after sending.',
  { label: 'report-review-S2', phase: 'REPORT', schema: REPORT_SCHEMA, model: 'claude-sonnet-5[1m]', effort: 'low' }
)

// ── MERGE ───────────────────────────────────────────────────────────────
phase('MERGE')
log(progress('S2 (fix)', 'MERGE', '#133 rights audit'))

var mergeCmd = 'cd ' + REPO + ' && git checkout main && git pull && git merge --squash fix/133-rights-audit && git commit -m "$(cat <<\'COMMITEOF\'\nfix(#133): remove redundant explicit _sharing, document exceptions\n\nRights inspection audit: removed explicit _sharing:domain from creates\nwhere org inheritance suffices. Documented exceptions where explicit\nsetting is necessary (parent chain outside org).\n\nCloses #133\n\n' + CO_AUTHOR + '\nCOMMITEOF\n)" && git push && git branch -D fix/133-rights-audit && git push origin --delete fix/133-rights-audit 2>/dev/null || true'

const merge = await agent(
  'Squash-merge fix/133-rights-audit to main for #133.\n\nWORKING DIRECTORY: ' + REPO + '\n\nRun this exact command:\n' + mergeCmd + '\n\nReport the merge commit SHA.',
  { label: 'merge-S2', phase: 'MERGE', schema: RESULT_SCHEMA, model: 'claude-sonnet-5[1m]' }
)

if (!merge || !merge.success) {
  log('MERGE failed: ' + (merge ? merge.summary : 'null'))
  return { success: false, failedAt: 'S2 MERGE', results: [] }
}
log('Merged: ' + merge.summary)

// Report merge to Gama
var mergeReportMsg = 'S2 MERGED: #133 rights audit @ ' + (merge.commitSha || 'unknown') + '. ' + merge.summary
await agent(
  'Send a progress report to gama@po-team via the comms MCP tool.\n\nStep 1: Use ToolSearch with query "select:mcp__comms__send" to load the tool schema.\nStep 2: Call mcp__comms__send with to="gama@po-team" and message="' + escapeForPrompt(mergeReportMsg) + '"\n\nReturn sent=true after sending.',
  { label: 'report-merge-S2', phase: 'REPORT', schema: REPORT_SCHEMA, model: 'claude-sonnet-5[1m]', effort: 'low' }
)

// ── RETRO ───────────────────────────────────────────────────────────────
phase('RETRO')
log(progress('Final', 'RETRO', 'retrospective → Gama'))
log('#133 pipeline complete.')

var retroMsg = '## #133 Rights Inspection Audit — Retrospective\n\n### Results\n- SPIKE: ' + audit.redundantCount + ' redundant, ' + audit.necessaryCount + ' necessary\n- Fix merged: ' + (merge.commitSha || 'unknown') + '\n- Review: ' + verdict.verdict + ' (attempts: ' + reviewAttempts + ')\n\n### Audit findings\n' + auditSummaryLines + '\n\n### Questions\n1. Are the exception classifications correct?\n2. Should the redundant creates also have been caught by the existing soleCreatePath test guard?\n3. Any follow-up needed for the necessary exceptions?\n\n(*MVOX:Palestrina*)'

await agent(
  'Send a retrospective message to gama@po-team via the comms MCP tool.\n\nStep 1: Use ToolSearch with query "select:mcp__comms__send" to load the tool schema.\nStep 2: Call mcp__comms__send with to="gama@po-team" and the following message (send verbatim):\n\n' + retroMsg + '\n\nReturn sent=true after sending.',
  { label: 'retro-gama', phase: 'RETRO', schema: REPORT_SCHEMA, model: 'claude-sonnet-5[1m]', effort: 'low' }
)

log('Retrospective sent. #133 pipeline done.')
return {
  success: true,
  results: [
    { taskTag: 'S1', issueNumber: 133, title: 'rights audit SPIKE', reviewVerdict: 'SPIKE:done', redundantCount: audit.redundantCount, necessaryCount: audit.necessaryCount },
    { taskTag: 'S2', issueNumber: 133, title: 'remove redundant _sharing + document exceptions', commitSha: merge.commitSha, reviewVerdict: verdict.verdict, reviewAttempts: reviewAttempts }
  ]
}
