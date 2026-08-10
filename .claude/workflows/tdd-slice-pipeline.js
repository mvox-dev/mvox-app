/**
 * tdd-slice-pipeline — TDD chain workflow template for mvox-dev slices.
 *
 * Packs an entire slice epic into a single orchestrated run:
 * each task gets RED → GREEN → REVIEW (with fix loop) → MERGE,
 * executed sequentially on a shared working tree.
 *
 * Usage: Workflow({ name: 'tdd-slice-pipeline', args: { tasks: [...], repoPath, coAuthor } })
 *
 * args.tasks: Array of task descriptors:
 *   {
 *     issueNumber: number,
 *     branch: string,           // e.g. 'feat/73-single-checkout-return'
 *     title: string,            // short title for logs/commits
 *     commitPrefix: string,     // e.g. 'feat(#73)'
 *     skipRed: boolean,         // true if RED already done externally
 *     redPrompt: string,        // prompt for RED agent (ignored if skipRed)
 *     greenPrompt: string,      // prompt for GREEN agent
 *     reviewChecklist: string,  // checklist items for reviewer
 *     commitBody: string,       // body for squash-merge commit message
 *   }
 *
 * args.repoPath: string — absolute path to the repo
 * args.coAuthor: string — co-author trailer for commits
 *
 * The pattern:
 * - RED agents write failing tests + commit on a feature branch
 * - GREEN agents implement to make tests pass + commit
 * - REVIEW agents assess the diff; if not GREEN, a fix agent runs (max 3 loops)
 * - MERGE agents squash-merge to main + push + delete branch
 * - Between tasks: fresh branch from updated main
 *
 * Model assignments per phase (Mihkel's ruling, 2026-08-10):
 *   RED:    opus   — structural thinking, test design is the hard part
 *   GREEN:  sonnet — constrained execution, tests define the goal
 *   REVIEW: fable  — independent perspective, different model family than writer/implementer
 *   FIX:    opus   — understand + resolve architectural findings
 *   MERGE:  sonnet — mechanical git ops
 *
 * Designed for the mvox-dev TDD chain. Adapt prompts per-slice.
 *
 * (*MVOX:Palestrina*)
 */
export const meta = {
  name: 'tdd-slice-pipeline',
  description: 'Full TDD pipeline for a slice epic — RED/GREEN/REVIEW/MERGE per task, sequentially',
  whenToUse: 'When dispatching a slice epic with 2+ sequential tasks through the TDD chain',
  phases: [
    { title: 'RED', detail: 'Write failing tests', model: 'opus' },
    { title: 'GREEN', detail: 'Implement to make tests pass', model: 'sonnet' },
    { title: 'REVIEW', detail: 'Architecture review (model diversity)', model: 'fable' },
    { title: 'FIX', detail: 'Address review findings', model: 'opus' },
    { title: 'MERGE', detail: 'Squash-merge to main', model: 'sonnet' }
  ]
}

const REPO = args.repoPath
const CO_AUTHOR = args.coAuthor
const tasks = args.tasks

const VERDICT_SCHEMA = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['GREEN', 'YELLOW', 'RED'] },
    summary: { type: 'string' },
    findings: { type: 'array', items: { type: 'string' } }
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

const results = []

for (let i = 0; i < tasks.length; i++) {
  const task = tasks[i]
  const taskLabel = `#${task.issueNumber} ${task.title}`

  // ── RED ──────────────────────────────────────────────────────────────────
  if (!task.skipRed) {
    phase(`${taskLabel} RED`)
    log(`Starting RED for ${taskLabel}`)

    const red = await agent(
      `${task.redPrompt}\n\nWORKING DIRECTORY: ${REPO}\n\nFIRST: cd ${REPO} && git checkout main && git pull && git checkout -b ${task.branch}\n\nAfter writing tests, verify they FAIL (RED), then commit:\ngit add -A && git commit -m "test(#${task.issueNumber}): RED — ${task.title}"`,
      { label: `red-${task.issueNumber}`, phase: `${taskLabel} RED`, schema: RESULT_SCHEMA, model: 'opus' }
    )

    if (!red || !red.success) {
      log(`RED failed for ${taskLabel}: ` + (red ? red.summary : 'null'))
      return { success: false, failedAt: `${taskLabel} RED`, results }
    }
    log(`RED done: ${red.summary}`)
  }

  // ── GREEN ────────────────────────────────────────────────────────────────
  phase(`${taskLabel} GREEN`)
  log(`Starting GREEN for ${taskLabel}`)

  const green = await agent(
    `${task.greenPrompt}\n\nWORKING DIRECTORY: ${REPO}\nBRANCH: ${task.branch} (already checked out)\n\nVerification:\n1. cd ${REPO} && pnpm test -- --run — ALL pass\n2. cd ${REPO} && pnpm check — 0 type errors\n\nGit: git add -A && git commit -m "${task.commitPrefix}: ${task.title}"`,
    { label: `green-${task.issueNumber}`, phase: `${taskLabel} GREEN`, schema: RESULT_SCHEMA, model: 'sonnet' }
  )

  if (!green || !green.success) {
    log(`GREEN failed for ${taskLabel}: ` + (green ? green.summary : 'null'))
    return { success: false, failedAt: `${taskLabel} GREEN`, results }
  }
  log(`GREEN done: ${green.summary}`)

  // ── REVIEW ───────────────────────────────────────────────────────────────
  phase(`${taskLabel} REVIEW`)
  log(`Starting REVIEW for ${taskLabel}`)

  let verdict = null
  let reviewAttempts = 0

  while ((!verdict || verdict.verdict !== 'GREEN') && reviewAttempts < 3) {
    reviewAttempts++

    verdict = await agent(
      `You are the architecture reviewer (Bentham) for mvox. Review branch ${task.branch} for issue #${task.issueNumber} (${task.title}).\n\nWORKING DIRECTORY: ${REPO}\n\n## Review checklist\n${task.reviewChecklist}\n\nRun: cd ${REPO} && git diff main...HEAD --stat\nRead changed files. Then: pnpm test -- --run && pnpm check\n\nIssue GREEN / YELLOW / RED. For non-GREEN: list specific findings.`,
      { label: `review-${task.issueNumber}-${reviewAttempts}`, phase: `${taskLabel} REVIEW`, schema: VERDICT_SCHEMA, model: 'fable' }
    )

    if (!verdict) verdict = { verdict: 'RED', summary: 'Review agent failed', findings: [] }

    if (verdict.verdict !== 'GREEN' && reviewAttempts < 3) {
      log(`Review ${verdict.verdict}, fixing (attempt ${reviewAttempts})`)
      await agent(
        `Fix review findings for #${task.issueNumber} (${task.title}) in ${REPO} on branch ${task.branch}.\n\nVerdict: ${verdict.verdict}\nFindings:\n${(verdict.findings || []).join('\n')}\n\nFix, verify (pnpm test -- --run && pnpm check), commit.`,
        { label: `fix-${task.issueNumber}-${reviewAttempts}`, phase: `${taskLabel} FIX`, schema: RESULT_SCHEMA, model: 'opus' }
      )
    }
  }

  if (!verdict || verdict.verdict === 'RED') {
    log(`REVIEW failed for ${taskLabel}`)
    return { success: false, failedAt: `${taskLabel} REVIEW`, results, verdict }
  }
  log(`REVIEW: ${verdict.verdict}`)

  // ── MERGE ────────────────────────────────────────────────────────────────
  phase(`${taskLabel} MERGE`)
  log(`Merging ${taskLabel}`)

  const merge = await agent(
    `Squash-merge ${task.branch} to main for issue #${task.issueNumber}.\n\nWORKING DIRECTORY: ${REPO}\n\ncd ${REPO} && git checkout main && git pull && git merge --squash ${task.branch} && git commit -m "$(cat <<'EOF'\n${task.commitPrefix}: ${task.title}\n\n${task.commitBody}\n\nCloses #${task.issueNumber}\n\n${CO_AUTHOR}\nEOF\n)" && git push && git branch -d ${task.branch}\n\nReport the merge commit SHA.`,
    { label: `merge-${task.issueNumber}`, phase: `${taskLabel} MERGE`, schema: RESULT_SCHEMA, model: 'sonnet' }
  )

  if (!merge || !merge.success) {
    log(`MERGE failed for ${taskLabel}: ` + (merge ? merge.summary : 'null'))
    return { success: false, failedAt: `${taskLabel} MERGE`, results }
  }
  log(`Merged: ${merge.summary}`)
  results.push({ issueNumber: task.issueNumber, title: task.title, commitSha: merge.commitSha })
}

log(`Pipeline complete: ${results.length} tasks merged.`)
return { success: true, results }
