/**
 * data-tidy-pipeline — Entu data-fixing workflow for mvox-dev.
 *
 * Pure Entu API mutations — no git branches, no TDD chain.
 * Follows §8.6 discipline: PREPARE (dry-run) → REVIEW → EXECUTE (live) → VERIFY.
 * Authorization: launching this workflow = team-lead blanket authorization for the audited scope.
 * Git artifacts deferred — scripts written to disk but NOT committed (tree may be on a feature branch).
 *
 * args.tasks: Array of task descriptors:
 *   {
 *     name: string,          // e.g. 'TD.4'
 *     issueNumber: number,
 *     title: string,
 *     prepPrompt: string,    // what to query + plan
 *     execPrompt: string,    // execution-specific instructions (appended after prep results)
 *     verifyChecks: string,  // what to verify post-execution
 *     parallel: boolean,     // if true, can execute parallel with other parallel:true tasks
 *   }
 *
 * args.repoPath: string
 *
 * (*MVOX:Palestrina*)
 */
export const meta = {
  name: 'data-tidy-pipeline',
  description: 'Entu data fixes — PREPARE/REVIEW/EXECUTE/VERIFY per task, §8.6 discipline',
  phases: [
    { title: 'PREPARE', detail: 'Query current state, plan mutations, dry-run' },
    { title: 'REVIEW', detail: 'Verify planned mutations for correctness and safety', model: 'claude-opus-5[1m]' },
    { title: 'EXECUTE', detail: 'Live Entu API mutations (authorized)' },
    { title: 'VERIFY', detail: 'Re-query and confirm fixes via 3-gate-AND' }
  ]
}

const _args = typeof args === 'string' ? JSON.parse(args) : (args || {})
const REPO = _args.repoPath
const tasks = _args.tasks

const ENTU_CONTEXT = [
  '',
  '## Working Directory: ' + REPO,
  '',
  '## Entu API Authentication',
  '```bash',
  'cd ' + REPO,
  'set -a; . ~/.config/mvox/credentials.env; set +a',
  'JWT=$(curl -s -H "Authorization: Bearer $ENTU_API_KEY" "https://api.entu.app/auth?db=polyphony" | jq -r \'.token\')',
  '# GET:  curl -s -H "Authorization: Bearer $JWT" "https://api.entu.app/polyphony/entity?..."',
  '# POST: curl -s -X POST -H "Authorization: Bearer $JWT" -F "property=value" "https://api.entu.app/polyphony/entity/{id}"',
  '# DELETE property: curl -s -X DELETE -H "Authorization: Bearer $JWT" "https://api.entu.app/polyphony/property/{id}"',
  '```',
  '',
  '## TD.1 Audit (ground truth)',
  'Read from issue #117: cd ' + REPO + ' && gh api repos/mvox-dev/mvox-app/issues/117/comments --jq \'.[].body\'',
  '',
  '## Existing scripts for patterns',
  'Look at ' + REPO + '/scripts/migrations/ for prior seed/probe scripts.',
  'Entu client helpers: ' + REPO + '/scripts/migrations/lib/entu-client.ts',
  '',
  '## CRITICAL: T6.2 lesson (propdef widen + re-aggregation)',
  'A propdef _sharing change does NOT retroactively fix already-aggregated instances.',
  'After widening a propdef _sharing, you MUST touch-save (re-aggregate) every existing',
  'instance of that type — POST any property value to trigger Entu re-aggregation.',
  'Without this, propdef fixes are SILENT.',
  '',
  '## No git operations',
  'Do NOT run any git commands. You may write scripts to ' + REPO + '/scripts/migrations/ for later committing.',
  ''
].join('\n')

const PREP_SCHEMA = {
  type: 'object',
  properties: {
    success: { type: 'boolean' },
    planned: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          entityId: { type: 'string' },
          entityName: { type: 'string' },
          mutation: { type: 'string' },
          currentValue: { type: 'string' },
          targetValue: { type: 'string' }
        },
        required: ['entityId', 'mutation'],
        additionalProperties: false
      }
    },
    scriptPath: { type: 'string' },
    mutationCount: { type: 'number' },
    summary: { type: 'string' }
  },
  required: ['success', 'mutationCount', 'summary'],
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
          severity: { type: 'string', enum: ['blocker', 'warning', 'info'] }
        },
        required: ['description'],
        additionalProperties: false
      }
    }
  },
  required: ['verdict', 'summary'],
  additionalProperties: false
}

const EXEC_SCHEMA = {
  type: 'object',
  properties: {
    success: { type: 'boolean' },
    mutationsApplied: { type: 'number' },
    errors: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' }
  },
  required: ['success', 'mutationsApplied', 'summary'],
  additionalProperties: false
}

const VERIFY_SCHEMA = {
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

// ── PREPARE (parallel) ────────────────────────────────────────────────────
phase('PREPARE')
log('PREPARE: planning mutations for ' + tasks.length + ' tasks')

const preps = await parallel(tasks.map(function(task) {
  return function() {
    return agent(
      task.prepPrompt + '\n' + ENTU_CONTEXT,
      { label: 'prepare-' + task.name.toLowerCase().replace('.', ''), phase: 'PREPARE', schema: PREP_SCHEMA }
    )
  }
}))

var prepFailed = false
for (var pi = 0; pi < preps.length; pi++) {
  if (!preps[pi] || !preps[pi].success) {
    log('PREPARE failed for ' + tasks[pi].name + ': ' + (preps[pi] ? preps[pi].summary : 'null'))
    prepFailed = true
  }
}
if (prepFailed) return { success: false, failedAt: 'PREPARE', preps: preps }

log('PREPARE done: ' + tasks.map(function(t, i) { return t.name + '=' + preps[i].mutationCount }).join(', '))

// ── REVIEW (parallel) ─────────────────────────────────────────────────────
phase('REVIEW')
log('REVIEW: verifying all dry-run plans')

const reviews = await parallel(preps.map(function(prep, i) {
  var task = tasks[i]
  return function() {
    return agent(
      'Review the dry-run plan for ' + task.name + ' — ' + task.title + ' (part of #116 Database tidiness 2.0).\n\n' +
      'Dry-run summary: ' + prep.summary + '\n' +
      'Mutations planned: ' + prep.mutationCount + '\n' +
      (prep.scriptPath ? 'Script at: ' + prep.scriptPath + '\n' : '') +
      'Planned mutations:\n' + JSON.stringify(prep.planned || [], null, 2) + '\n\n' +
      'Verify:\n' +
      '1. Correct entities targeted? Cross-check against TD.1 audit (issue #117).\n' +
      '2. Mutations safe? No collateral damage.\n' +
      '3. Anything MISSING that the audit says should be fixed?\n' +
      '4. For propdef fixes: is touch-save re-aggregation included for ALL instances?\n' +
      '5. For labels: are bilingual values (EN+ET) reasonable and domain-appropriate?\n\n' +
      'Issue GREEN if correct and complete. YELLOW for minor issues. RED for wrong targets.\n\n' +
      ENTU_CONTEXT,
      { label: 'review-' + task.name.toLowerCase().replace('.', ''), phase: 'REVIEW', schema: VERDICT_SCHEMA, model: 'claude-opus-5[1m]' }
    )
  }
}))

var reviewFailed = false
for (var ri = 0; ri < reviews.length; ri++) {
  if (!reviews[ri] || reviews[ri].verdict === 'RED') {
    log('REVIEW RED for ' + tasks[ri].name + ': ' + (reviews[ri] ? reviews[ri].summary : 'null'))
    reviewFailed = true
  }
}
if (reviewFailed) return { success: false, failedAt: 'REVIEW', reviews: reviews, preps: preps }

log('REVIEW done: ' + reviews.map(function(r, i) { return tasks[i].name + '=' + (r ? r.verdict : 'null') }).join(', '))

// ── EXECUTE ───────────────────────────────────────────────────────────────
phase('EXECUTE')

// Split into parallel-eligible and sequential tasks
var parallelTasks = []
var sequentialTasks = []
for (var ei = 0; ei < tasks.length; ei++) {
  if (tasks[ei].parallel) {
    parallelTasks.push({ task: tasks[ei], prep: preps[ei], index: ei })
  } else {
    sequentialTasks.push({ task: tasks[ei], prep: preps[ei], index: ei })
  }
}

var execResults = new Array(tasks.length)

// Run parallel-eligible tasks first
if (parallelTasks.length > 0) {
  log('EXECUTE parallel: ' + parallelTasks.map(function(p) { return p.task.name }).join(', '))
  var parallelResults = await parallel(parallelTasks.map(function(item) {
    return function() {
      return agent(
        '## EXECUTE: ' + item.task.name + ' — ' + item.task.title + ' (LIVE)\n\n' +
        'Run these mutations LIVE against polyphony. This is AUTHORIZED by team-lead.\n\n' +
        (item.prep.scriptPath ? 'Script at: ' + item.prep.scriptPath + '\n\n' : '') +
        'Planned mutations (' + item.prep.mutationCount + '):\n' + JSON.stringify(item.prep.planned || [], null, 2) + '\n\n' +
        (item.task.execPrompt || '') + '\n\n' +
        'Execute each mutation. Verify each API response. Log results. Report total applied vs planned.\n\n' +
        ENTU_CONTEXT,
        { label: 'execute-' + item.task.name.toLowerCase().replace('.', ''), phase: 'EXECUTE', schema: EXEC_SCHEMA }
      )
    }
  }))
  for (var pi2 = 0; pi2 < parallelTasks.length; pi2++) {
    execResults[parallelTasks[pi2].index] = parallelResults[pi2]
    if (!parallelResults[pi2] || !parallelResults[pi2].success) {
      log('EXECUTE failed for ' + parallelTasks[pi2].task.name)
      return { success: false, failedAt: 'EXECUTE ' + parallelTasks[pi2].task.name, execResults: execResults }
    }
  }
}

// Run sequential tasks in order
for (var si = 0; si < sequentialTasks.length; si++) {
  var item = sequentialTasks[si]
  log('EXECUTE sequential: ' + item.task.name)
  var result = await agent(
    '## EXECUTE: ' + item.task.name + ' — ' + item.task.title + ' (LIVE)\n\n' +
    'Run these mutations LIVE against polyphony. This is AUTHORIZED by team-lead.\n\n' +
    'Prior tasks in this pipeline have already executed — entity visibility fixes are live.\n\n' +
    (item.prep.scriptPath ? 'Script at: ' + item.prep.scriptPath + '\n\n' : '') +
    'Planned mutations (' + item.prep.mutationCount + '):\n' + JSON.stringify(item.prep.planned || [], null, 2) + '\n\n' +
    (item.task.execPrompt || '') + '\n\n' +
    'Execute each mutation. Verify each API response. Log results. Report total applied vs planned.\n\n' +
    ENTU_CONTEXT,
    { label: 'execute-' + item.task.name.toLowerCase().replace('.', ''), phase: 'EXECUTE', schema: EXEC_SCHEMA }
  )
  execResults[item.index] = result
  if (!result || !result.success) {
    log('EXECUTE failed for ' + item.task.name)
    return { success: false, failedAt: 'EXECUTE ' + item.task.name, execResults: execResults }
  }
}

log('EXECUTE done: ' + tasks.map(function(t, i) { return t.name + '=' + (execResults[i] ? execResults[i].mutationsApplied + ' applied' : 'null') }).join(', '))

// ── VERIFY ────────────────────────────────────────────────────────────────
phase('VERIFY')
log('VERIFY: re-querying Entu to confirm all fixes')

var verifyChecks = tasks.map(function(t) { return '### ' + t.name + ' — ' + t.title + '\n' + t.verifyChecks }).join('\n\n')

var verify = await agent(
  '## VERIFY: Confirm All Database Tidiness Fixes\n\n' +
  'All mutations have been executed. Re-query live polyphony and confirm:\n\n' +
  verifyChecks + '\n\n' +
  'For name-visibility checks, apply the 3-gate-AND model:\n' +
  '- Gate 1: name prop-def _sharing (should be domain)\n' +
  '- Gate 2: type entity _sharing (should be domain or public)\n' +
  '- Gate 3: instance _sharing (should be domain or public)\n' +
  'Pick sample instances and read their domain-bucket properties to confirm name is present.\n\n' +
  'Report pass/fail per check with details.\n\n' +
  ENTU_CONTEXT,
  { label: 'verify-all', phase: 'VERIFY', schema: VERIFY_SCHEMA }
)

log('VERIFY: ' + (verify && verify.passed ? 'PASSED' : 'FAILED') + ' — ' + (verify ? verify.summary : 'null'))

return {
  success: verify && verify.passed,
  execResults: execResults,
  verify: verify
}
