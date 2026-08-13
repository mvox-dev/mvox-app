/**
 * mvox10-session-pipeline — MVOX-10 session workflow.
 *
 * 4 serial slices with verdict-triggered Gama reporting + closing retro.
 * Based on tdd-slice-pipeline template, extended with:
 * - I18N phase (optional, between GREEN and INTEGRATION)
 * - Gama reports after REVIEW verdicts and MERGE completions
 * - RETRO phase: retrospective message to Gama at pipeline end
 * - Branch creation for skipRed tasks (handled in GREEN)
 * - Custom merge messages for batched tasks (no Closes # tag)
 *
 * Slices:
 *   1. #122 — Event create _sharing default-to-private (bug fix)
 *   2. YELLOW batch — 128.1 pluralization + 131.2 Escape test + 131.1 setTimeout
 *   3. #123 — Language selector on profile page (feature)
 *   4. #14 — Playwright RSVP optimistic-update coverage (test)
 *
 * Model assignments (inherited from tdd-slice-pipeline, Mihkel's rulings 2026-08-10):
 *   RED:         fable    — creative/lateral thinking
 *   GREEN:       sonnet   — constrained execution
 *   I18N:        sonnet   — constrained execution
 *   INTEGRATION: sonnet   — wiring verification
 *   GREEN-FIX:   sonnet   — fix wiring gaps
 *   REVIEW:      opus-5   — comprehension checkpoint
 *   FIX:         opus-5   — understand root cause from review
 *   REPORT:      sonnet   — mechanical message send (effort: low)
 *   MERGE:       sonnet   — mechanical git ops
 *   RETRO:       sonnet   — compose + send retro (effort: low)
 *
 * (*MVOX:Palestrina*)
 */
export const meta = {
  name: 'mvox10-session-pipeline',
  description: 'MVOX-10: 4 serial slices — #122, YELLOWs, #123, #14 — with Gama reporting and retro',
  phases: [
    { title: 'RED', detail: 'Write failing tests', model: 'claude-fable-5' },
    { title: 'GREEN', detail: 'Implement to make tests pass', model: 'claude-sonnet-5[1m]' },
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
  {
    issueNumber: 122,
    branch: 'fix/122-event-sharing',
    title: 'Event create sets _sharing to domain',
    commitPrefix: 'fix(#122)',
    skipRed: false,
    redPrompt: 'Write failing tests for the event creation _sharing bug.\n\nCONTEXT: The event-create code path never sets _sharing explicitly. New events default to private, making them invisible to members. Events should be created with _sharing:domain so collective members can see them.\n\nRead the existing event creation code in src/routes/ and src/lib/server/ to understand the current flow. Then write tests that:\n1. Assert that newly created events have _sharing set to "domain"\n2. Assert that the _sharing value is passed to the Entu API call\n3. Cover the edge case where _sharing might be overridden by explicit input\n\nPlace tests colocated with the source they test.',
    greenPrompt: 'Fix the event creation code to set _sharing: domain on new events.\n\nCONTEXT: The event-create code path never sets _sharing explicitly. Tests from the RED phase verify this behavior. Make them pass.\n\n1. Find the event creation handler (likely in src/routes/ or src/lib/server/)\n2. Add _sharing: "domain" to the entity creation payload\n3. Ensure existing events are not affected (this is for new creates only)',
    i18nPrompt: null,
    reviewChecklist: '1. _sharing is set to domain on event creation, not hardcoded elsewhere\n2. No regression on existing event handling\n3. Tests cover the actual API call payload, not just UI state\n4. No other entity creation paths have the same _sharing gap',
    commitBody: 'Event creation now explicitly sets _sharing: domain so new events are visible to all collective members. Previously defaulted to private.',
    closesIssue: true
  },
  {
    issueNumber: 0,
    branch: 'fix/yellow-followups',
    title: 'YELLOW follow-ups (128.1 pluralization, 131.2 Escape test, 131.1 setTimeout)',
    commitPrefix: 'fix(#128,#131)',
    skipRed: true,
    redPrompt: null,
    greenPrompt: 'Fix three YELLOW follow-ups from prior reviews. All on this one branch.\n\n1. **YELLOW-128.1 — Pluralization**\n   File: messages/{en,et,lv,uk}.json, key "library_available_summary"\n   Current: "{count} copies available for lending" (same string for all counts — broken at count=1)\n   Fix: Use ICU MessageFormat plural syntax. English: "{count, plural, one {# copy available for lending} other {# copies available for lending}}". Apply linguistically correct plural forms for Estonian, Latvian, and Ukrainian — these languages have different plural rules than English (Estonian has 2 forms, Latvian has 3 forms including zero, Ukrainian has 3 forms).\n   Reference: src/routes/library/+page.svelte uses m.library_available_summary({ count: availableCount })\n\n2. **YELLOW-131.2 — Escape key test**\n   File: src/routes/page.profile.spec.ts\n   The profile conflict resolution has an Escape key handler: "if (e.key === \'Escape\' && previewLevel !== null) previewLevel = null"\n   Add a test that:\n   - Enters conflict preview mode (simulates the first tap on a visibility button)\n   - Presses Escape\n   - Verifies the preview is dismissed (previewLevel back to null)\n\n3. **YELLOW-131.1 — setTimeout(0) cleanup**\n   File: src/routes/profile/+page.svelte, line ~407\n   Current: setTimeout(() => void loadForSelected(), 0)\n   Fix: Replace with tick() from svelte — this is a Svelte component, tick() is idiomatic for deferring to next microtask after DOM update.\n   Import: import { tick } from \'svelte\'\n   Replacement: await tick(); loadForSelected();  (make the enclosing function async if needed)\n\nCommit all fixes, then verify: pnpm test -- --run && pnpm check',
    i18nPrompt: null,
    reviewChecklist: '1. Pluralization uses correct ICU MessageFormat syntax for all 4 locales\n2. Estonian/Latvian/Ukrainian plural rules are linguistically correct (not just copy-paste of English)\n3. Escape key test actually tests the dismiss behavior, not just handler existence\n4. tick() replacement preserves original timing semantics\n5. No regressions in existing tests',
    commitBody: 'Follow-ups from #128 and #131 reviews:\n- 128.1: Pluralization for library_available_summary (ICU MessageFormat)\n- 131.2: Escape key test for profile conflict preview dismiss\n- 131.1: setTimeout(0) replaced with tick() in profile page',
    closesIssue: false
  },
  {
    issueNumber: 123,
    branch: 'feat/123-language-selector',
    title: 'Language selector on profile page',
    commitPrefix: 'feat(#123)',
    skipRed: false,
    redPrompt: 'Write failing tests for the language selector feature on the profile page.\n\nCONTEXT: The app uses Paraglide with 4 locales (en, et, lv, uk). Currently language is browser-detected only — no user-facing control. The profile page needs a language picker that persists the user\'s choice.\n\nRead the existing profile page (src/routes/profile/+page.svelte) and Paraglide setup (src/lib/paraglide/) to understand the current i18n infrastructure.\n\nTests should cover:\n1. A language selector renders on the profile page with all 4 locale options\n2. Selecting a locale changes the app language\n3. The selected locale persists (via cookie, localStorage, or profile property)\n4. The persisted locale takes priority over browser detection on next load\n5. Integration test: the language selector appears on the actual profile route\n\nPlace unit tests colocated with source. Playwright E2E in tests/ if needed.',
    greenPrompt: 'Implement the language selector on the profile page.\n\nCONTEXT: Profile page at src/routes/profile/+page.svelte. Paraglide i18n with 4 locales (en, et, lv, uk). Messages in messages/{locale}.json, generated TS at src/lib/paraglide/.\n\nImplementation:\n1. **Backend:** Add a locale preference cookie. In SvelteKit hooks or layout server load, read the locale cookie and pass it to Paraglide to override browser detection. Set the cookie when the user changes language.\n\n2. **Frontend:** Add a language selector component to the profile page. Show all 4 locales with native names (English, Eesti, Latviešu, Українська). On selection, set the locale cookie and trigger Paraglide language change (setLanguageTag or navigate to localized route — check how Paraglide handles this in SvelteKit).\n\n3. Wire the selector into the profile page layout.\n\nUse Svelte 5 runes ($state, $derived, $props). Follow existing component patterns in the codebase. Read the Paraglide docs/setup before implementing.',
    i18nPrompt: 'Add i18n strings for the language selector feature.\n\nFiles: messages/{en,et,lv,uk}.json\n\nAdd message keys for:\n- Language selector label ("Language" / "Keel" / "Valoda" / "Мова")\n- Any helper text ("Choose your preferred language" etc.)\n- Locale display names if the implementation expects them from messages rather than hardcoded\n\nCheck what keys the GREEN phase implementation already added or expects (read the component code). Add missing translations for all 4 locales.\n\nVerify: pnpm check — 0 Paraglide compilation errors.',
    reviewChecklist: '1. Language selector renders correctly with all 4 locales\n2. Locale persistence works (cookie-based preferred)\n3. Persisted locale overrides browser detection on next load\n4. Svelte 5 runes used throughout (no legacy export let or $: syntax)\n5. Paraglide integration is correct\n6. i18n messages present and correct for all 4 locales\n7. No XSS vectors in locale handling (validate locale value server-side)\n8. Accessible — keyboard navigable, proper ARIA labels',
    commitBody: 'Adds a language selector to the profile page. Users choose their preferred locale (en/et/lv/uk) which persists via cookie and overrides browser detection on subsequent visits.',
    closesIssue: true
  },
  {
    issueNumber: 14,
    branch: 'test/14-playwright-rsvp',
    title: 'Playwright RSVP optimistic-update coverage',
    commitPrefix: 'test(#14)',
    skipRed: false,
    redPrompt: 'Write Playwright E2E tests for the RSVP optimistic-update flow.\n\nCONTEXT: The RSVP feature uses optimistic updates — tapping updates visible state immediately while the write is in flight. If the write fails, the visible state reverts. The feature already works in production.\n\nRead the existing RSVP implementation:\n- UI: look for RSVP components in src/routes/ or src/lib/components/\n- API: look for RSVP handlers in src/routes/api/ or src/lib/server/\n- Existing unit tests: grep for rsvp/RSVP in test files to understand the data model\n\nWrite Playwright tests in tests/ that exercise:\n1. Set RSVP — tap shows immediate visual confirmation\n2. Change RSVP — switching response updates immediately\n3. Clear RSVP — removing response updates immediately\n4. Failed write — mock/intercept the API to simulate failure, verify visible state reverts\n\nThese tests cover existing functionality — they may pass or fail depending on test infrastructure setup. Both outcomes are valid for RED.\n\nYou may need to set up Playwright test fixtures for authenticated user state and event context.',
    greenPrompt: 'Make the Playwright RSVP tests pass. The tests from RED cover existing working functionality.\n\nDo NOT change production code — only fix test infrastructure:\n1. Ensure Playwright config covers the test paths\n2. Set up needed fixtures (authenticated user, event with RSVP enabled)\n3. Fix selectors if they do not match actual DOM structure\n4. For the "failed write" test: use Playwright route interception to mock API failure\n\nRun: cd /home/ai-teams/workspace-app && pnpm test -- --run && pnpm exec playwright test',
    i18nPrompt: null,
    reviewChecklist: '1. Tests cover set/change/clear RSVP paths end-to-end\n2. Optimistic update + revert on failure is tested\n3. Tests use fixtures, not specific seed data\n4. No flaky patterns (arbitrary timeouts, race-prone selectors)\n5. Tests run alongside existing suite without conflicts\n6. No production code changes',
    commitBody: 'Playwright E2E coverage for RSVP optimistic-update flow: set/change/clear responses with immediate visual feedback, plus failure-revert path. Closes the test gap noted at slice-2 close.',
    closesIssue: true
  }
]

// ── Pipeline execution ────────────────────────────────────────────────────

const results = []

for (let i = 0; i < tasks.length; i++) {
  const task = tasks[i]
  const taskLabel = (task.issueNumber ? '#' + task.issueNumber : 'YELLOW batch') + ' ' + task.title
  const sliceLabel = 'Slice ' + (i + 1) + '/' + tasks.length

  log(sliceLabel + ': ' + taskLabel)

  // ── RED ────────────────────────────────────────────────────────────────
  if (!task.skipRed) {
    phase('RED')
    log('RED: ' + taskLabel)

    const red = await agent(
      task.redPrompt + '\n\nWORKING DIRECTORY: ' + REPO + '\n\nFIRST: cd ' + REPO + ' && git checkout main && git pull && git checkout -b ' + task.branch + '\n\nIMPORTANT — INTEGRATION TESTS: For every new component or data function, include at least one integration test that verifies it renders on / is called from the actual page route — not just in isolation.\n\nAfter writing tests, commit:\ngit add -A && git commit -m "test(' + (task.issueNumber ? '#' + task.issueNumber : task.branch) + '): RED — ' + task.title + '"',
      { label: 'red-' + (task.issueNumber || 'yellow'), phase: 'RED', schema: RESULT_SCHEMA, model: 'claude-fable-5' }
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
    log('GREEN: ' + taskLabel)

    const branchSetup = task.skipRed
      ? 'FIRST: cd ' + REPO + ' && git checkout main && git pull && git checkout -b ' + task.branch + '\n\n'
      : ''

    const green = await agent(
      branchSetup + task.greenPrompt + '\n\nWORKING DIRECTORY: ' + REPO + '\nBRANCH: ' + task.branch + (task.skipRed ? ' (just created)' : ' (already checked out from RED)') + '\n\nVerification:\n1. cd ' + REPO + ' && pnpm test -- --run — ALL pass\n2. cd ' + REPO + ' && pnpm check — 0 type errors\n\nGit: git add -A && git commit -m "' + task.commitPrefix + ': ' + task.title + '"',
      { label: 'green-' + (task.issueNumber || 'yellow'), phase: 'GREEN', schema: RESULT_SCHEMA, model: 'claude-sonnet-5[1m]' }
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
    log('I18N: ' + taskLabel)

    const i18n = await agent(
      task.i18nPrompt + '\n\nWORKING DIRECTORY: ' + REPO + '\nBRANCH: ' + task.branch + '\n\nVerification: cd ' + REPO + ' && pnpm check — 0 type errors\n\nGit: git add -A && git commit -m "i18n(' + (task.issueNumber ? '#' + task.issueNumber : task.branch) + '): locale strings for ' + task.title + '"',
      { label: 'i18n-' + (task.issueNumber || 'yellow'), phase: 'I18N', schema: RESULT_SCHEMA, model: 'claude-sonnet-5[1m]' }
    )

    if (!i18n || !i18n.success) {
      log('I18N failed for ' + taskLabel + ': ' + (i18n ? i18n.summary : 'null'))
      return { success: false, failedAt: taskLabel + ' I18N', results: results }
    }
    log('I18N done: ' + i18n.summary)
  }

  // ── INTEGRATION ────────────────────────────────────────────────────────
  phase('INTEGRATION')
  log('INTEGRATION: ' + taskLabel)

  let integrationAttempts = 0
  let integrationPassed = false

  while (!integrationPassed && integrationAttempts < 2) {
    integrationAttempts++

    const integration = await agent(
      'Verify that all new features on branch ' + task.branch + ' for ' + taskLabel + ' are REACHABLE from the actual app — not just correct in isolation.\n\nWORKING DIRECTORY: ' + REPO + '\n\n## Wiring checks\n1. For every new component: grep for its import in a page/route file. If not imported anywhere, it is unreachable.\n2. For every new data function (exported from a .ts file): grep for its import. If only imported by test files, it is unreachable.\n3. For every new UI element: check that the page renders it (conditionally is fine, but the conditional must be reachable).\n4. Run: cd ' + REPO + ' && pnpm test -- --run && pnpm check\n\nReturn passed=true if every new export is imported from at least one non-test file AND the page/route renders the feature. Return passed=false with a checks array listing each unreachable item.\n\nDo NOT fix anything — only verify and report.',
      { label: 'integration-' + (task.issueNumber || 'yellow') + '-' + integrationAttempts, phase: 'INTEGRATION', schema: PROBE_SCHEMA, model: 'claude-sonnet-5[1m]' }
    )

    if (!integration || !integration.passed) {
      var failedChecks = (integration && integration.checks) ? integration.checks.filter(function(c) { return !c.passed }) : []
      var failSummary = failedChecks.map(function(c) { return c.name + ': ' + (c.detail || '') }).join('\n')

      if (integrationAttempts < 2) {
        phase('GREEN-FIX')
        log('INTEGRATION found wiring gaps for ' + taskLabel + ', fixing')
        await agent(
          'Fix wiring gaps on branch ' + task.branch + ' for ' + taskLabel + '.\n\nWORKING DIRECTORY: ' + REPO + '\n\nUnreachable features:\n' + failSummary + '\n\nFor each gap: add the missing import/render in the appropriate page or route file. Do NOT rewrite the feature — just wire it in.\n\nVerify: pnpm test -- --run && pnpm check. Commit the fix.',
          { label: 'green-fix-' + (task.issueNumber || 'yellow'), phase: 'GREEN-FIX', schema: RESULT_SCHEMA, model: 'claude-sonnet-5[1m]' }
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
  log('REVIEW: ' + taskLabel)

  let verdict = null
  let reviewAttempts = 0

  while ((!verdict || verdict.verdict !== 'GREEN') && reviewAttempts < 3) {
    reviewAttempts++

    verdict = await agent(
      'You are Bentham, architecture reviewer for mvox-dev. Review branch ' + task.branch + ' for ' + taskLabel + '.\n\nWORKING DIRECTORY: ' + REPO + '\n\n## Review checklist\n' + task.reviewChecklist + '\n\nProcedure:\n1. cd ' + REPO + ' && git diff main...HEAD --stat\n2. Read all changed files\n3. Run: pnpm test -- --run && pnpm check\n4. Issue GREEN / YELLOW / RED verdict\n\nFor non-GREEN: list findings with description, fixShape (recommended fix), and blockerType (code/data/config).',
      { label: 'review-' + (task.issueNumber || 'yellow') + '-' + reviewAttempts, phase: 'REVIEW', schema: VERDICT_SCHEMA, model: 'claude-opus-5[1m]' }
    )

    if (!verdict) verdict = { verdict: 'RED', summary: 'Review agent returned null', findings: [] }

    if (verdict.verdict !== 'GREEN') {
      if (hasNonCodeBlocker(verdict.findings)) {
        log('Non-code blocker for ' + taskLabel + ' — halting')
        return { success: false, failedAt: taskLabel + ' REVIEW (non-code blocker)', results: results, verdict: verdict }
      }

      if (reviewAttempts < 3) {
        phase('FIX')
        log('Review ' + verdict.verdict + ' for ' + taskLabel + ', fixing (attempt ' + reviewAttempts + ')')
        await agent(
          'Fix review findings for ' + taskLabel + ' in ' + REPO + ' on branch ' + task.branch + '.\n\nVerdict: ' + verdict.verdict + '\n\n## Findings\n' + formatFindings(verdict.findings) + '\n\nFor each finding, understand the ROOT CAUSE before writing a fix. The fixShape (if provided) describes the recommended approach — use it as a starting point but verify against actual code.\n\nFix, verify (pnpm test -- --run && pnpm check), commit.',
          { label: 'fix-' + (task.issueNumber || 'yellow') + '-' + reviewAttempts, phase: 'FIX', schema: RESULT_SCHEMA, model: 'claude-opus-5[1m]' }
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
  const reviewMsg = sliceLabel + ' REVIEW: ' + taskLabel + ' — verdict ' + verdict.verdict + '. ' + verdict.summary
  await agent(
    'Send a progress report to gama@po-team via the comms MCP tool.\n\nStep 1: Use ToolSearch with query "select:mcp__comms__send" to load the tool schema.\nStep 2: Call mcp__comms__send with to="gama@po-team" and message="' + escapeForPrompt(reviewMsg) + '"\n\nReturn sent=true after sending.',
    { label: 'report-review-' + (task.issueNumber || 'yellow'), phase: 'REPORT', schema: REPORT_SCHEMA, model: 'claude-sonnet-5[1m]', effort: 'low' }
  )

  // ── MERGE ──────────────────────────────────────────────────────────────
  phase('MERGE')
  log('MERGE: ' + taskLabel)

  const closesTag = task.closesIssue ? '\nCloses #' + task.issueNumber : ''
  const mergeCmd = 'cd ' + REPO + ' && git checkout main && git pull && git merge --squash ' + task.branch + ' && git commit -m "$(cat <<\'COMMITEOF\'\n' + task.commitPrefix + ': ' + task.title + '\n\n' + task.commitBody + closesTag + '\n\n' + CO_AUTHOR + '\nCOMMITEOF\n)" && git push && git branch -d ' + task.branch + ' && git push origin --delete ' + task.branch + ' 2>/dev/null || true'

  const merge = await agent(
    'Squash-merge ' + task.branch + ' to main for ' + taskLabel + '.\n\nWORKING DIRECTORY: ' + REPO + '\n\nRun this exact command:\n' + mergeCmd + '\n\nReport the merge commit SHA.',
    { label: 'merge-' + (task.issueNumber || 'yellow'), phase: 'MERGE', schema: RESULT_SCHEMA, model: 'claude-sonnet-5[1m]' }
  )

  if (!merge || !merge.success) {
    log('MERGE failed for ' + taskLabel + ': ' + (merge ? merge.summary : 'null'))
    return { success: false, failedAt: taskLabel + ' MERGE', results: results }
  }
  log('Merged: ' + merge.summary)

  // ── REPORT (post-merge) ───────────────────────────────────────────────
  const mergeMsg = sliceLabel + ' MERGED: ' + taskLabel + (merge.commitSha ? ' @ ' + merge.commitSha : '') + '. ' + merge.summary
  await agent(
    'Send a progress report to gama@po-team via the comms MCP tool.\n\nStep 1: Use ToolSearch with query "select:mcp__comms__send" to load the tool schema.\nStep 2: Call mcp__comms__send with to="gama@po-team" and message="' + escapeForPrompt(mergeMsg) + '"\n\nReturn sent=true after sending.',
    { label: 'report-merge-' + (task.issueNumber || 'yellow'), phase: 'REPORT', schema: REPORT_SCHEMA, model: 'claude-sonnet-5[1m]', effort: 'low' }
  )

  results.push({
    issueNumber: task.issueNumber,
    title: task.title,
    commitSha: merge.commitSha,
    reviewVerdict: verdict.verdict,
    reviewAttempts: reviewAttempts
  })
}

// ── RETRO ────────────────────────────────────────────────────────────────
phase('RETRO')
log('Pipeline complete: ' + results.length + ' slices merged. Sending retrospective to Gama.')

const completedList = results.map(function(r) {
  return '- ' + (r.issueNumber ? '#' + r.issueNumber : 'YELLOW batch') + ' ' + r.title + ' (review: ' + r.reviewVerdict + ', attempts: ' + r.reviewAttempts + ', sha: ' + (r.commitSha || 'unknown') + ')'
}).join('\n')

const retroMsg = '## MVOX-10 Pipeline Retrospective\n\n### Completed slices\n' + completedList + '\n\n### Pipeline shape\n4 serial slices (no parallel branches). Each slice: RED → GREEN → I18N (optional) → INTEGRATION → REVIEW (with FIX loop) → MERGE. Verdict-triggered Gama reporting after REVIEW and MERGE phases.\n\n### Questions for retro\n1. Did the reporting cadence feel right? (too much / too little / about right)\n2. Any tasks that should have been prioritized differently?\n3. Observations on the review verdicts — patterns or surprises?\n4. Should we formalize this pipeline shape (with Gama reporting) into the template, or keep it experimental?\n\nWaiting for your observations.\n\n(*MVOX:Palestrina*)'

await agent(
  'Send a retrospective message to gama@po-team via the comms MCP tool.\n\nStep 1: Use ToolSearch with query "select:mcp__comms__send" to load the tool schema.\nStep 2: Call mcp__comms__send with to="gama@po-team" and the following message (send verbatim, preserving all newlines and formatting):\n\n' + retroMsg + '\n\nReturn sent=true after sending.',
  { label: 'retro-gama', phase: 'RETRO', schema: REPORT_SCHEMA, model: 'claude-sonnet-5[1m]', effort: 'low' }
)

log('Retrospective sent. Pipeline done.')
return { success: true, results: results }
