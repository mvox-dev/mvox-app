/**
 * tdd-slice-pipeline — TDD chain workflow template for mvox-dev slices.
 *
 * Packs an entire slice epic into a single orchestrated run:
 * SPIKE → SEED → PREFLIGHT → RED → GREEN → INTEGRATION → REVIEW → FIX → MERGE → PROBE
 * per task, executed sequentially on a shared working tree.
 *
 * Usage: Workflow({ scriptPath: '...', args: { tasks: [...], repoPath, coAuthor } })
 *
 * args.tasks: Array of task descriptors:
 *   {
 *     issueNumber: number,
 *     branch: string,           // e.g. 'feat/73-single-checkout-return'
 *     title: string,            // short title for logs/commits
 *     commitPrefix: string,     // e.g. 'feat(#73)'
 *     spikePrompt: string,      // research/exploration (optional — skip if facts known)
 *     seedPrompt: string,       // schema/data setup via Entu API (optional — skip if code-only)
 *     preflightPrompt: string,  // validate data prerequisites before RED (optional)
 *     skipRed: boolean,         // true if RED already done externally
 *     redPrompt: string,        // test design (ignored if skipRed)
 *     greenPrompt: string,      // implementation
 *     reviewChecklist: string,  // checklist items for reviewer
 *     commitBody: string,       // body for squash-merge commit message
 *     probePrompt: string,      // post-merge live verification (optional — skip if no data)
 *     probeGates: boolean,      // if true, failed PROBE halts the pipeline (default: false)
 *   }
 *
 * args.repoPath: string — absolute path to the repo
 * args.coAuthor: string — co-author trailer for commits
 *
 * Model assignments per phase (Mihkel's rulings, 2026-08-10):
 *   SPIKE:       opus-5   — comprehension checkpoint, discover what RED should assert
 *   SEED:        opus-4-6 — careful execution, schema/data mutations with ledgers
 *   PREFLIGHT:   sonnet   — constrained check, validate data prerequisites
 *   RED:         fable    — creative/lateral thinking, surprising edge-case tests + integration tests
 *   GREEN:       sonnet   — constrained execution, tests define the goal
 *   INTEGRATION: sonnet   — wiring verification, catch "correct but unreachable" before expensive REVIEW
 *   GREEN-FIX:   sonnet   — fix wiring gaps found by INTEGRATION (cheap loop before REVIEW)
 *   REVIEW:      opus-5   — comprehension checkpoint, different model than writer/implementer
 *   FIX:         opus-5   — comprehension checkpoint, understand root cause from review
 *   MERGE:       sonnet   — mechanical git ops
 *   PROBE:       sonnet   — constrained execution, well-defined checks
 *
 * Three models, deliberately placed: opus-5 at comprehension checkpoints
 * (SPIKE, REVIEW, FIX), opus-4-6 at careful-execution checkpoint (SEED),
 * fable at creative checkpoint (RED), sonnet at constrained-execution
 * and wiring checkpoints (GREEN, INTEGRATION, GREEN-FIX, PREFLIGHT, MERGE, PROBE).
 *
 * (*MVOX:Palestrina*)
 */
export const meta = {
  name: 'tdd-slice-pipeline',
  description: 'Full TDD pipeline for a slice epic — SPIKE/SEED/PREFLIGHT/RED/GREEN/INTEGRATION/REVIEW/MERGE/PROBE per task',
  whenToUse: 'When dispatching a slice epic with 2+ sequential tasks through the TDD chain',
  phases: [
    { title: 'SPIKE', detail: 'Research/exploration — discover facts for RED', model: 'claude-opus-5[1m]' },
    { title: 'SEED', detail: 'Schema/data setup via Entu API', model: 'claude-opus-4-6[1m]' },
    { title: 'PREFLIGHT', detail: 'Validate data prerequisites before RED', model: 'claude-sonnet-5[1m]' },
    { title: 'RED', detail: 'Write failing tests — creative edge cases', model: 'claude-fable-5' },
    { title: 'GREEN', detail: 'Implement to make tests pass', model: 'claude-sonnet-5[1m]' },
    { title: 'INTEGRATION', detail: 'Wiring verification — catch unreachable features before REVIEW', model: 'claude-sonnet-5[1m]' },
    { title: 'GREEN-FIX', detail: 'Fix wiring gaps found by INTEGRATION', model: 'claude-sonnet-5[1m]' },
    { title: 'REVIEW', detail: 'Architecture review (model diversity)', model: 'claude-opus-5[1m]' },
    { title: 'FIX', detail: 'Address review findings (comprehension checkpoint)', model: 'claude-opus-5[1m]' },
    { title: 'MERGE', detail: 'Squash-merge to main + cleanup', model: 'claude-sonnet-5[1m]' },
    { title: 'PROBE', detail: 'Post-merge live data verification', model: 'claude-sonnet-5[1m]' }
  ]
}

// args may arrive as a JSON string when invoked via scriptPath — parse if needed
const _args = typeof args === 'string' ? JSON.parse(args) : (args || {})
const REPO = _args.repoPath
const CO_AUTHOR = _args.coAuthor
const tasks = _args.tasks

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

const SPIKE_SCHEMA = {
  type: 'object',
  properties: {
    success: { type: 'boolean' },
    findings: { type: 'array', items: { type: 'string' } },
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

const results = []

for (let i = 0; i < tasks.length; i++) {
  const task = tasks[i]
  const taskLabel = '#' + task.issueNumber + ' ' + task.title

  // ── SPIKE ─────────────────────────────────────────────────────────────────
  if (task.spikePrompt) {
    phase('SPIKE')
    log('SPIKE: ' + taskLabel)

    const spike = await agent(
      task.spikePrompt + '\n\nWORKING DIRECTORY: ' + REPO + '\n\nYou are researching to discover facts that tests should assert. Read source, probe API behavior, report structured findings. Do NOT write code or tests — only research and report.',
      { label: 'spike-' + task.issueNumber, phase: 'SPIKE', schema: SPIKE_SCHEMA, model: 'claude-opus-5[1m]' }
    )

    if (!spike || !spike.success) {
      log('SPIKE failed for ' + taskLabel + ': ' + (spike ? spike.summary : 'null'))
      return { success: false, failedAt: taskLabel + ' SPIKE', results: results }
    }
    log('SPIKE done: ' + spike.summary)
  }

  // ── SEED ──────────────────────────────────────────────────────────────────
  if (task.seedPrompt) {
    phase('SEED')
    log('SEED: ' + taskLabel)

    const seed = await agent(
      task.seedPrompt + '\n\nWORKING DIRECTORY: ' + REPO + '\n\nYou are performing schema/data setup via the Entu API. Follow the §8.6 discipline: dry-run first, verify, then execute. Commit ledger artifacts to the repo. Report what was created/modified.\n\nIMPORTANT: Do NOT include "Closes #" trailers in commit messages. SEED commits are infrastructure/data setup, not feature delivery — issue closure belongs to the MERGE phase only.',
      { label: 'seed-' + task.issueNumber, phase: 'SEED', schema: RESULT_SCHEMA, model: 'claude-opus-4-6[1m]' }
    )

    if (!seed || !seed.success) {
      log('SEED failed for ' + taskLabel + ': ' + (seed ? seed.summary : 'null'))
      return { success: false, failedAt: taskLabel + ' SEED', results: results }
    }
    log('SEED done: ' + seed.summary)
  }

  // ── PREFLIGHT ─────────────────────────────────────────────────────────────
  if (task.preflightPrompt) {
    phase('PREFLIGHT')
    log('PREFLIGHT: ' + taskLabel)

    const preflight = await agent(
      task.preflightPrompt + '\n\nWORKING DIRECTORY: ' + REPO + '\n\nValidate data prerequisites before proceeding to RED/GREEN. READ-ONLY — do NOT modify any data. Report pass/fail per check. If any prerequisite is missing, report what needs to be fixed (migration, seed, config) before this task can proceed.',
      { label: 'preflight-' + task.issueNumber, phase: 'PREFLIGHT', schema: PROBE_SCHEMA, model: 'claude-sonnet-5[1m]' }
    )

    if (!preflight || !preflight.passed) {
      log('PREFLIGHT failed for ' + taskLabel + ': ' + (preflight ? preflight.summary : 'null'))
      return { success: false, failedAt: taskLabel + ' PREFLIGHT', results: results, preflightDetail: preflight }
    }
    log('PREFLIGHT passed: ' + preflight.summary)
  }

  // ── RED ──────────────────────────────────────────────────────────────────
  if (!task.skipRed) {
    phase('RED')
    log('RED: ' + taskLabel)

    const red = await agent(
      task.redPrompt + '\n\nWORKING DIRECTORY: ' + REPO + '\n\nFIRST: cd ' + REPO + ' && git checkout main && git pull && git checkout -b ' + task.branch + '\n\nIMPORTANT — INTEGRATION TESTS: For every new component or data function, include at least one integration test that verifies it renders on / is called from the actual page route — not just in isolation. The implementer (sonnet) will make unit tests pass without wiring features into the app unless integration tests force it.\n\nAfter writing tests, verify they FAIL (RED), then commit:\ngit add -A && git commit -m "test(#' + task.issueNumber + '): RED — ' + task.title + '"',
      { label: 'red-' + task.issueNumber, phase: 'RED', schema: RESULT_SCHEMA, model: 'claude-fable-5' }
    )

    if (!red || !red.success) {
      log('RED failed for ' + taskLabel + ': ' + (red ? red.summary : 'null'))
      return { success: false, failedAt: taskLabel + ' RED', results: results }
    }
    log('RED done: ' + red.summary)
  }

  // ── GREEN ────────────────────────────────────────────────────────────────
  phase('GREEN')
  log('GREEN: ' + taskLabel)

  const green = await agent(
    task.greenPrompt + '\n\nWORKING DIRECTORY: ' + REPO + '\nBRANCH: ' + task.branch + ' (already checked out)\n\nVerification:\n1. cd ' + REPO + ' && pnpm test -- --run — ALL pass\n2. cd ' + REPO + ' && pnpm check — 0 type errors\n\nGit: git add -A && git commit -m "' + task.commitPrefix + ': ' + task.title + '"',
    { label: 'green-' + task.issueNumber, phase: 'GREEN', schema: RESULT_SCHEMA, model: 'claude-sonnet-5[1m]' }
  )

  if (!green || !green.success) {
    log('GREEN failed for ' + taskLabel + ': ' + (green ? green.summary : 'null'))
    return { success: false, failedAt: taskLabel + ' GREEN', results: results }
  }
  log('GREEN done: ' + green.summary)

  // ── INTEGRATION ─────────────────────────────────────────────────────────
  phase('INTEGRATION')
  log('INTEGRATION: ' + taskLabel)

  let integrationAttempts = 0
  let integrationPassed = false

  while (!integrationPassed && integrationAttempts < 2) {
    integrationAttempts++

    const integration = await agent(
      'Verify that all new features on branch ' + task.branch + ' for issue #' + task.issueNumber + ' (' + task.title + ') are REACHABLE from the actual app — not just correct in isolation.\n\nWORKING DIRECTORY: ' + REPO + '\n\n## Wiring checks\n1. For every new component: grep for its import in a page/route file. If not imported anywhere, it is unreachable.\n2. For every new data function (exported from a .ts file): grep for its import. If only imported by test files, it is unreachable.\n3. For every new UI element: check that the page renders it (conditionally is fine, but the conditional must be reachable).\n4. Run: cd ' + REPO + ' && pnpm test -- --run && pnpm check\n\n## Report\nReturn passed=true if every new export is imported from at least one non-test file AND the page/route renders the feature. Return passed=false with a checks array listing each unreachable item.\n\nDo NOT fix anything — only verify and report.',
      { label: 'integration-' + task.issueNumber + '-' + integrationAttempts, phase: 'INTEGRATION', schema: PROBE_SCHEMA, model: 'claude-sonnet-5[1m]' }
    )

    if (!integration || !integration.passed) {
      var failedChecks = (integration && integration.checks) ? integration.checks.filter(function(c) { return !c.passed }) : []
      var failSummary = failedChecks.map(function(c) { return c.name + ': ' + (c.detail || '') }).join('\n')

      if (integrationAttempts < 2) {
        phase('GREEN-FIX')
        log('INTEGRATION found wiring gaps for ' + taskLabel + ', fixing (attempt ' + integrationAttempts + ')')
        await agent(
          'Fix wiring gaps on branch ' + task.branch + ' for issue #' + task.issueNumber + ' (' + task.title + ').\n\nWORKING DIRECTORY: ' + REPO + '\n\nThe INTEGRATION check found these unreachable features:\n' + failSummary + '\n\nFor each gap: add the missing import/render in the appropriate page or route file. Do NOT rewrite the feature — just wire it in.\n\nVerify: pnpm test -- --run && pnpm check. Commit the fix.',
          { label: 'green-fix-' + task.issueNumber + '-' + integrationAttempts, phase: 'GREEN-FIX', schema: RESULT_SCHEMA, model: 'claude-sonnet-5[1m]' }
        )
      } else {
        log('INTEGRATION still failing after fix for ' + taskLabel + ' — proceeding to REVIEW')
      }
    } else {
      integrationPassed = true
      log('INTEGRATION passed: ' + integration.summary)
    }
  }

  // ── REVIEW ───────────────────────────────────────────────────────────────
  phase('REVIEW')
  log('REVIEW: ' + taskLabel)

  let verdict = null
  let reviewAttempts = 0

  while ((!verdict || verdict.verdict !== 'GREEN') && reviewAttempts < 3) {
    reviewAttempts++

    verdict = await agent(
      'You are the architecture reviewer (Bentham) for mvox. Review branch ' + task.branch + ' for issue #' + task.issueNumber + ' (' + task.title + ').\n\nWORKING DIRECTORY: ' + REPO + '\n\n## Review checklist\n' + task.reviewChecklist + '\n\nRun: cd ' + REPO + ' && git diff main...HEAD --stat\nRead changed files. Then: pnpm test -- --run && pnpm check\n\nIssue GREEN / YELLOW / RED verdict.\n\nFor non-GREEN: list findings as objects with:\n- description: what is wrong (specific file, line, behavior)\n- fixShape: (optional) your recommended fix — be specific about the root cause and what code change resolves it\n- blockerType: (optional) "code" if fixable by editing source, "data" if it needs a migration or live data change, "config" if it needs environment/config change. Omit for code-only findings.',
      { label: 'review-' + task.issueNumber + '-' + reviewAttempts, phase: 'REVIEW', schema: VERDICT_SCHEMA, model: 'claude-opus-5[1m]' }
    )

    if (!verdict) verdict = { verdict: 'RED', summary: 'Review agent failed', findings: [] }

    if (verdict.verdict !== 'GREEN') {
      // Check for non-code blockers — exit early, don't waste fix attempts
      if (hasNonCodeBlocker(verdict.findings)) {
        log('Non-code blocker found for ' + taskLabel + ' — cannot fix in code, exiting review loop')
        return {
          success: false,
          failedAt: taskLabel + ' REVIEW (non-code blocker)',
          results: results,
          verdict: verdict,
          nonCodeBlocker: true
        }
      }

      if (reviewAttempts < 3) {
        phase('FIX')
        log('Review ' + verdict.verdict + ' for ' + taskLabel + ', fixing (attempt ' + reviewAttempts + ')')
        await agent(
          'Fix review findings for #' + task.issueNumber + ' (' + task.title + ') in ' + REPO + ' on branch ' + task.branch + '.\n\nVerdict: ' + verdict.verdict + '\n\n## Findings\n' + formatFindings(verdict.findings) + '\n\nFor each finding, understand the ROOT CAUSE before writing a fix. The "Recommended fix" (if provided) describes the fix shape — use it as a starting point but verify it against the actual code.\n\nFix, verify (pnpm test -- --run && pnpm check), commit.',
          { label: 'fix-' + task.issueNumber + '-' + reviewAttempts, phase: 'FIX', schema: RESULT_SCHEMA, model: 'claude-opus-5[1m]' }
        )
      }
    }
  }

  if (!verdict || verdict.verdict === 'RED') {
    log('REVIEW failed for ' + taskLabel)
    return { success: false, failedAt: taskLabel + ' REVIEW', results: results, verdict: verdict }
  }
  log('REVIEW: ' + verdict.verdict)

  // ── MERGE ────────────────────────────────────────────────────────────────
  phase('MERGE')
  log('MERGE: ' + taskLabel)

  const merge = await agent(
    'Squash-merge ' + task.branch + ' to main for issue #' + task.issueNumber + '.\n\nWORKING DIRECTORY: ' + REPO + '\n\ncd ' + REPO + ' && git checkout main && git pull && git merge --squash ' + task.branch + " && git commit -m \"$(cat <<'EOF'\n" + task.commitPrefix + ': ' + task.title + '\n\n' + task.commitBody + '\n\nCloses #' + task.issueNumber + '\n\n' + CO_AUTHOR + "\nEOF\n)\" && git push && git branch -d " + task.branch + ' && git push origin --delete ' + task.branch + ' 2>/dev/null || true\n\nReport the merge commit SHA.',
    { label: 'merge-' + task.issueNumber, phase: 'MERGE', schema: RESULT_SCHEMA, model: 'claude-sonnet-5[1m]' }
  )

  if (!merge || !merge.success) {
    log('MERGE failed for ' + taskLabel + ': ' + (merge ? merge.summary : 'null'))
    return { success: false, failedAt: taskLabel + ' MERGE', results: results }
  }
  log('Merged: ' + merge.summary)

  // ── PROBE ────────────────────────────────────────────────────────────────
  if (task.probePrompt) {
    phase('PROBE')
    log('PROBE: ' + taskLabel)

    const probe = await agent(
      task.probePrompt + '\n\nWORKING DIRECTORY: ' + REPO + '\n\nYou are verifying live data state after deployment. Query the live system, compare against expected state from the task spec, and report pass/fail per check. Do NOT modify any data — read-only verification only.',
      { label: 'probe-' + task.issueNumber, phase: 'PROBE', schema: PROBE_SCHEMA, model: 'claude-sonnet-5[1m]' }
    )

    if (!probe || !probe.passed) {
      log('PROBE failed for ' + taskLabel + ': ' + (probe ? probe.summary : 'null'))
      results.push({ issueNumber: task.issueNumber, title: task.title, commitSha: merge.commitSha, probePassed: false, probeDetail: probe })
      if (task.probeGates) {
        log('PROBE gates next task — halting pipeline')
        return { success: false, failedAt: taskLabel + ' PROBE', results: results, probeDetail: probe }
      }
      continue
    }
    log('PROBE passed: ' + probe.summary)
    results.push({ issueNumber: task.issueNumber, title: task.title, commitSha: merge.commitSha, probePassed: true })
  } else {
    results.push({ issueNumber: task.issueNumber, title: task.title, commitSha: merge.commitSha })
  }
}

log('Pipeline complete: ' + results.length + ' tasks merged.')
return { success: true, results: results }
