/**
 * arrange-mode-pipeline — 4-slice TDD pipeline for #155.
 *
 * Roster: Arrange mode — section management redesign.
 * S1: View mode chip selector + arrange mode shell (full TDD)
 * S2: Reorder in arrange mode (skip-RED — #152 patterns transfer)
 * S3: Indent/unindent (full TDD)
 * S4: Relocate CRUD + strip other views (skip-RED)
 *
 * Model assignments:
 *   RED:         fable    — creative/lateral edge-case tests
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
  name: 'arrange-mode-pipeline',
  description: '#155: Roster arrange mode — 4-slice pipeline with Gama reporting',
  phases: [
    { title: 'RED', detail: 'Write failing tests', model: 'claude-fable-5' },
    { title: 'GREEN', detail: 'Implement', model: 'claude-sonnet-5[1m]' },
    { title: 'I18N', detail: 'Internationalize strings', model: 'claude-sonnet-5[1m]' },
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
  '- **Replace semantics** (Entu POST appends, never overwrites):',
  '  GET old value _ids → POST new value → DELETE old _ids. POST-before-DELETE rule.',
  '  See: src/lib/events/eventFieldEdit.ts:8-26',
  '- **Roster page**: src/routes/roster/+page.svelte — large file, all roster logic lives here.',
  '- **Section tree model**: recursive sections under org. See src/lib/sections/SectionPicker.svelte',
  '  for tree traversal and nesting model.',
  '- **sectionActions.ts**: createSection, deleteSection, reorderSections at src/lib/sections/sectionActions.ts.',
  '- **performReorder**: existing function in roster/+page.svelte that calls reorderSections.',
  '- **Keyboard reorder from #152**: roving tabindex, Space/Enter grab/drop, ArrowUp/Down move,',
  '  Escape cancel. grabbedSectionId state, data-grabbed CSS, roster-reorder-status live region.',
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
  // ─── S1: Chip selector + arrange mode shell ───────────────────────────
  {
    issueNumber: 155,
    taskTag: 'S1',
    branch: 'feat/155-s1-chip-selector',
    title: 'View mode chip selector + arrange mode shell',
    commitPrefix: 'feat(#155)',
    skipRed: false,
    redPrompt: [
      'Write failing tests for the roster view mode chip selector and arrange mode shell (#155 S1).',
      '',
      ARCH_CONTEXT,
      '',
      '## What to test',
      '',
      'File: src/routes/page.roster-arrange.spec.ts (new)',
      '',
      '### 1. Chip selector',
      '- The current collapse-all/expand-all toggle is replaced by a 3-chip selector',
      '- Three chips: Collapsed, Expanded, Arrange',
      '- Default selection: Collapsed (or whatever the current default is)',
      '- Clicking a chip switches the view mode',
      '- Only one chip active at a time (radio-style)',
      '- "Arrange" chip is visible ONLY to editors (rights-gated)',
      '- Non-editors see only Collapsed/Expanded (2 chips)',
      '',
      '### 2. Arrange mode rendering',
      '- When "Arrange" chip is active:',
      '  - Shows a compact list of all sections',
      '  - Each row shows: section name + member count',
      '  - Nesting shown by visual indentation (nesting level)',
      '  - No member lists visible (compact)',
      '  - No management controls yet (S2-S4 add those)',
      '- When switching back to Collapsed/Expanded, normal rendering resumes',
      '',
      '### 3. Integration',
      '- Chip selector renders on the roster page',
      '- View mode state drives which rendering path is used',
      '- The section data (names, counts, nesting) comes from existing section loading',
      '',
      '## Reference files',
      '- src/routes/roster/+page.svelte — current toggle, section rendering',
      '- src/lib/sections/SectionPicker.svelte — tree model for nesting/indentation'
    ].join('\n'),
    greenPrompt: [
      'Implement the roster view mode chip selector and arrange mode shell (#155 S1).',
      '',
      ARCH_CONTEXT,
      '',
      '## What to implement',
      '',
      '### 1. View mode state',
      'Add a $state variable: `viewMode: "collapsed" | "expanded" | "arrange" = "collapsed"`',
      '(or adapt the existing collapse/expand state to a 3-way enum)',
      '',
      '### 2. Chip selector UI',
      'Replace the current collapse-all/expand-all toggle with 3 chips:',
      '- Collapsed / Expanded / Arrange',
      '- Chip styling: active chip gets a distinct background (e.g., bg-blue-100/bg-blue-900),',
      '  inactive chips are outlined/subtle',
      '- "Arrange" chip visible only when the user has editor rights',
      '  (use the existing admin/editor check — likely $adminStore or canReorder)',
      '- Chips arranged in a horizontal flex row',
      '',
      '### 3. Arrange mode rendering',
      'When viewMode === "arrange":',
      '- Render a compact section list (NOT the full member-expanded view)',
      '- Each row: section name + member count badge',
      '- Indent rows by nesting level (e.g., pl-4 per level, or pl-{level*4})',
      '  Use fixed class names per level (pl-4, pl-8, pl-12) — NO dynamic template literals',
      '- Use the existing section tree data (already loaded)',
      '- No drag handles, no management controls in this slice',
      '',
      '### 4. Conditional rendering',
      'The existing collapsed/expanded rendering continues to work in those modes.',
      'Arrange mode is a third rendering path.',
      '',
      '## Reference files',
      '- src/routes/roster/+page.svelte — current toggle, section rendering',
      '- Look for the existing collapse/expand state and toggle UI'
    ].join('\n'),
    i18nPrompt: [
      'Add i18n strings for the roster view mode chip selector (#155 S1).',
      '',
      'Files: messages/{en,et,lv,uk}.json',
      '',
      'Check what message keys the GREEN phase implementation uses (read the code).',
      'Expected keys:',
      '- Chip labels: "Collapsed" / "Expanded" / "Arrange"',
      '  Estonian: "Kokku" / "Lahti" / "Korralda"',
      '  Latvian: "Sakļauts" / "Izvērsts" / "Sakārtot"',
      '  Ukrainian: "Згорнуто" / "Розгорнуто" / "Упорядкувати"',
      '- Member count: "{count} members" — use ICU plural syntax',
      '',
      'Verify against actual implementation. Apply linguistically correct translations.',
      'Verify: pnpm check — 0 type errors.'
    ].join('\n'),
    reviewChecklist: [
      '1. Chip selector replaces old toggle (not added alongside it)',
      '2. Three modes: collapsed, expanded, arrange',
      '3. Arrange chip rights-gated (invisible to non-editors, not just disabled)',
      '4. Arrange mode renders compact list with name + member count + indentation',
      '5. No management controls in arrange mode yet (those come in S2-S4)',
      '6. Collapsed/Expanded modes unchanged (no regression)',
      '7. Nesting indentation uses fixed Tailwind classes (no dynamic template literals)',
      '8. Svelte 5 runes throughout',
      '9. Mobile responsive — chips wrap or scroll on narrow viewports',
      '10. i18n: chip labels + member count pluralization for all 4 locales'
    ].join('\n'),
    commitBody: 'S1: Replace collapse/expand toggle with 3-chip selector (Collapsed/Expanded/Arrange).\nArrange mode renders compact section list with member counts and nesting indentation.\nArrange chip rights-gated to editors only.',
    closesIssues: []
  },

  // ─── S2: Reorder in arrange mode ──────────────────────────────────────
  {
    issueNumber: 155,
    taskTag: 'S2',
    branch: 'feat/155-s2-reorder',
    title: 'Reorder in arrange mode — whole-row drag + keyboard + subtree',
    commitPrefix: 'feat(#155)',
    skipRed: true,
    redPrompt: null,
    greenPrompt: [
      'Implement reorder in arrange mode (#155 S2).',
      '',
      ARCH_CONTEXT,
      '',
      '## What to implement',
      '',
      'In arrange mode (viewMode === "arrange"), make section rows reorderable.',
      '',
      '### 1. Whole row as drag target',
      '- The entire arrange-mode row is draggable (not just a handle)',
      '- Use the same drag events as the current implementation (dragstart/dragover/drop)',
      '- Parent drag moves the entire subtree with it',
      '',
      '### 2. Keyboard reorder (from #152)',
      'Transfer the keyboard protocol from #152 to arrange mode:',
      '- Roving tabindex on rows (one row focusable at a time)',
      '- Space/Enter: grab/drop',
      '- ArrowUp/ArrowDown: move position (clamp at bounds)',
      '- Escape: cancel',
      '- Subtree moves with parent when parent is grabbed',
      '',
      '### 3. Visual feedback',
      '- data-grabbed attribute on the grabbed row (outline-dashed style from #152)',
      '- Subtree rows visually grouped with grabbed parent',
      '',
      '### 4. Reuse existing infrastructure',
      '- performReorder write path (already exists)',
      '- roster-reorder-status live region for announcements',
      '- reorderPending in-flight guard',
      '',
      '### 5. Subtree handling',
      '- When a parent section is moved, its children move with it',
      '- The visible order updates immediately (optimistic)',
      '- Use the existing section tree data to determine children',
      '',
      '## Reference files',
      '- src/routes/roster/+page.svelte — performReorder, drag handlers, #152 keyboard code',
      '- The arrange mode shell from S1 (just merged to main)'
    ].join('\n'),
    i18nPrompt: null,
    reviewChecklist: [
      '1. Whole row is drag target in arrange mode (not a separate handle)',
      '2. Keyboard protocol: Space/Enter grab/drop, Up/Down move, Escape cancel',
      '3. Subtree moves with parent (both drag and keyboard)',
      '4. performReorder reused (not duplicated)',
      '5. Clamping at bounds (no wrap)',
      '6. reorderPending guard respected',
      '7. Live region announces grab/move/drop/cancel',
      '8. Visual feedback on grabbed row + subtree',
      '9. No regression on collapsed/expanded view drag (if it still exists)',
      '10. Svelte 5 runes throughout'
    ].join('\n'),
    commitBody: 'S2: Reorder in arrange mode — whole-row drag target,\nkeyboard protocol (from #152), subtree moves with parent.',
    closesIssues: []
  },

  // ─── S3: Indent/unindent ──────────────────────────────────────────────
  {
    issueNumber: 155,
    taskTag: 'S3',
    branch: 'feat/155-s3-indent',
    title: 'Indent/unindent — nesting buttons + keyboard Left/Right + _parent change',
    commitPrefix: 'feat(#155)',
    skipRed: false,
    redPrompt: [
      'Write failing tests for indent/unindent in arrange mode (#155 S3).',
      '',
      ARCH_CONTEXT,
      '',
      '## What to test',
      '',
      'File: src/routes/page.roster-indent.spec.ts (new)',
      '',
      '### 1. Indent/unindent buttons',
      '- Each row in arrange mode has indent (→) and unindent (←) buttons',
      '- Buttons are always visible (not just during grab)',
      '- Indent button disabled when no previous sibling (nowhere to nest under)',
      '- Unindent button disabled when section is at top level (no parent to promote from)',
      '',
      '### 2. Indent behavior',
      '- Indent = nest under the immediate previous sibling',
      '- Changes the section _parent reference (replace semantics: POST new → DELETE old)',
      '- Visual indentation updates immediately',
      '- Section tree recalculates after indent',
      '',
      '### 3. Unindent behavior',
      '- Unindent = promote one level (move from current parent to grandparent)',
      '- Changes _parent reference',
      '- Top-level sections (parent = org) cannot unindent further',
      '',
      '### 4. Keyboard indent/unindent',
      '- ArrowLeft during grab → unindent',
      '- ArrowRight during grab → indent',
      '- Same guards apply (no indent without previous sibling, no unindent at top)',
      '',
      '### 5. Data layer',
      '- reparentSection(cfg, sectionId, newParentId, fetchImpl) function',
      '  or equivalent that changes _parent via replace semantics',
      '- GET old _parent value _ids → POST new _parent reference → DELETE old',
      '',
      '### 6. Live region',
      '- Indent announces "Indented {name} under {parentName}"',
      '- Unindent announces "Unindented {name} to {parentName}" (or "to top level")',
      '',
      '## Reference files',
      '- src/lib/sections/sectionActions.ts — existing section ops, may need reparentSection',
      '- src/lib/events/eventFieldEdit.ts — replace semantics pattern',
      '- src/routes/roster/+page.svelte — arrange mode from S1, keyboard from S2'
    ].join('\n'),
    greenPrompt: [
      'Implement indent/unindent in arrange mode (#155 S3).',
      '',
      ARCH_CONTEXT,
      '',
      '## What to implement',
      '',
      '### 1. reparentSection function',
      'File: src/lib/sections/sectionActions.ts (add to existing file)',
      '',
      'reparentSection(cfg, sectionId, newParentId, fetchImpl):',
      '- GET entity/{sectionId}?props=_parent to find the current _parent value _ids',
      '- POST new _parent reference to entity/{sectionId}',
      '- DELETE old _parent value _ids (POST-before-DELETE rule)',
      '- Return success/failure',
      '',
      '### 2. Indent/unindent buttons on arrange rows',
      'In src/routes/roster/+page.svelte, add to each arrange-mode row:',
      '- Indent button (→ or ⇥ icon) — calls indent handler',
      '- Unindent button (← or ⇤ icon) — calls unindent handler',
      '- Always visible (not just during grab)',
      '- Disable logic:',
      '  - Indent: disabled when section has no previous sibling at same level',
      '  - Unindent: disabled when section is at top level (parent is org)',
      '',
      '### 3. Indent handler',
      '- Find the immediate previous sibling at the same nesting level',
      '- Call reparentSection(cfg, section.id, previousSibling.id, fetchImpl)',
      '- On success: update local section tree, visual indentation updates reactively',
      '',
      '### 4. Unindent handler',
      '- Find the current parent section',
      '- Find that parent\'s own parent (grandparent)',
      '- Call reparentSection(cfg, section.id, grandparent.id, fetchImpl)',
      '  (if grandparent is org, use the org id)',
      '- On success: update local section tree',
      '',
      '### 5. Keyboard extension',
      'In the existing keyboard grab handler (from S2/#152):',
      '- ArrowRight during grab → call indent handler',
      '- ArrowLeft during grab → call unindent handler',
      '- Same disable guards as the buttons',
      '',
      '### 6. Live region',
      'Announce indent/unindent via roster-reorder-status:',
      '- "Indented {name} under {parentName}"',
      '- "Unindented {name} to top level" or "Unindented {name} under {newParentName}"',
      '',
      '## Reference files',
      '- src/lib/sections/sectionActions.ts — add reparentSection',
      '- src/lib/events/eventFieldEdit.ts — replace semantics template',
      '- src/routes/roster/+page.svelte — arrange mode + keyboard handlers'
    ].join('\n'),
    i18nPrompt: null,
    reviewChecklist: [
      '1. reparentSection uses correct replace semantics (POST-before-DELETE)',
      '2. Indent nests under IMMEDIATE previous sibling only (not arbitrary)',
      '3. Unindent promotes to grandparent (or org for top-level)',
      '4. Indent button disabled when no previous sibling',
      '5. Unindent button disabled at top level',
      '6. Keyboard Left/Right works during grab mode',
      '7. Section tree updates reactively after reparent',
      '8. Live region announces indent/unindent correctly',
      '9. No max depth constraint (nesting is unlimited)',
      '10. Svelte 5 runes throughout',
      '11. No regression on S1 chip selector or S2 reorder'
    ].join('\n'),
    commitBody: 'S3: Indent/unindent in arrange mode — always-visible buttons per row,\nkeyboard Left/Right during grab, reparentSection with replace semantics.',
    closesIssues: []
  },

  // ─── S4: Relocate CRUD + strip other views ───────────────────────────
  {
    issueNumber: 155,
    taskTag: 'S4',
    branch: 'feat/155-s4-relocate-crud',
    title: 'Relocate CRUD to arrange mode + strip collapsed/expanded views',
    commitPrefix: 'feat(#155)',
    skipRed: true,
    redPrompt: null,
    greenPrompt: [
      'Relocate section CRUD to arrange mode and strip management controls from other views (#155 S4).',
      '',
      ARCH_CONTEXT,
      '',
      '## What to implement',
      '',
      '### 1. Move CRUD into arrange mode',
      'In arrange mode, each section row gets:',
      '- **Tap section name to rename** (inline edit):',
      '  Click the name → turns into a text input → Enter saves → Escape cancels.',
      '  Use the same rename function that exists for sections (sectionActions.ts or inline).',
      '- **Add section** button (at the bottom of the arrange list, or contextual):',
      '  Reuse existing createSection flow.',
      '- **Delete section** button per row:',
      '  Reuse existing deleteSection (refuses non-empty — that guard stays as-is).',
      '  Disable for sections with children/members.',
      '',
      '### 2. Strip collapsed/expanded views',
      'Remove from collapsed and expanded view modes:',
      '- Drag handles (the grab handles from the old reorder)',
      '- Section management controls (rename, delete, add buttons)',
      '- Any admin-only controls that now live exclusively in arrange mode',
      '- These views become display-only',
      '',
      '### 3. Preserve',
      '- Member lists in expanded view (display-only — members still show)',
      '- Section header display (name, member count) in collapsed view',
      '- All member-facing functionality (non-admin) is unaffected',
      '',
      '### 4. Verify',
      '- deleteSection guard: still refuses non-empty sections',
      '- createSection: still works from arrange mode',
      '- Inline rename: saves via replace semantics',
      '- Collapsed/Expanded views are clean display-only (no stale admin UI)',
      '',
      '## Reference files',
      '- src/routes/roster/+page.svelte — all section CRUD, drag handles, admin controls',
      '- src/lib/sections/sectionActions.ts — createSection, deleteSection'
    ].join('\n'),
    i18nPrompt: [
      'Check i18n consistency after relocating CRUD to arrange mode (#155 S4).',
      '',
      'Files: messages/{en,et,lv,uk}.json',
      '',
      'Read the updated roster/+page.svelte. Check for:',
      '1. Any new message keys added for arrange-mode CRUD (rename hint, delete confirmation, etc.)',
      '2. Any existing keys that are now unused (from removed collapsed/expanded controls)',
      '3. Inline rename placeholder text if needed',
      '',
      'Clean up unused keys. Add any missing translations.',
      'Verify: pnpm check — 0 type errors.'
    ].join('\n'),
    reviewChecklist: [
      '1. Section add/rename/delete ONLY available in arrange mode',
      '2. Collapsed/Expanded views are display-only (no admin controls)',
      '3. Drag handles removed from collapsed/expanded views',
      '4. Inline rename: click name → input → Enter saves → Escape cancels',
      '5. deleteSection guard preserved (refuses non-empty)',
      '6. createSection flow works from arrange mode',
      '7. No stale admin UI in collapsed/expanded views',
      '8. Member display in expanded view unaffected (display-only)',
      '9. Svelte 5 runes throughout',
      '10. Mobile responsive',
      '11. i18n: no unused keys, all new strings translated',
      '12. No regression on S1 chips, S2 reorder, S3 indent'
    ].join('\n'),
    commitBody: 'S4: Relocate section CRUD to arrange mode exclusively.\nCollapsed/Expanded views become display-only.\nInline rename, add, and delete in arrange mode.\n\nCloses #155',
    closesIssues: [155]
  }
]

// ── Progress tracking ─────────────────────────────────────────────────────

// S1: RED+GREEN+I18N+INTEGRATION+REVIEW+2×REPORT+MERGE = 8
// S2: GREEN+INTEGRATION+REVIEW+2×REPORT+MERGE = 6 (skip-RED, no I18N)
// S3: RED+GREEN+INTEGRATION+REVIEW+2×REPORT+MERGE = 7 (no I18N)
// S4: GREEN+I18N+INTEGRATION+REVIEW+2×REPORT+MERGE = 7 (skip-RED)
// RETRO = 1
// Total = 8 + 6 + 7 + 7 + 1 = 29
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
      'Verify that all changes on branch ' + task.branch + ' for ' + taskLabel + ' are correct and wired in.\n\nWORKING DIRECTORY: ' + REPO + '\n\n## Checks\n1. New components/functions are imported and used from the roster page\n2. New UI elements render in arrange mode\n3. Existing collapsed/expanded modes are unaffected\n4. Run: cd ' + REPO + ' && pnpm test -- --run && pnpm check\n\nReturn passed=true if everything is wired and tests pass.\n\nDo NOT fix anything — only verify and report.',
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

var retroMsg = '## Arrange Mode Pipeline Retrospective (#155)\n\n### Completed\n' + completedList + '\n\n### Pipeline shape\n4 serial slices: S1 chip selector (full TDD), S2 reorder (skip-RED), S3 indent (full TDD), S4 CRUD relocation (skip-RED). Each merges to main before the next starts.\n\n### Questions for retro\n1. S3 indent/unindent: was reparentSection added to sectionActions.ts or inlined?\n2. S3 _parent replace semantics: any issues with the POST-before-DELETE pattern?\n3. S4 tap-to-rename: did it use contenteditable or an input swap?\n4. S2 subtree handling: did subtree move work atomically?\n5. Any follow-up issues from YELLOW findings?\n\nWaiting for your observations.\n\n(*MVOX:Palestrina*)'

await agent(
  'Send a retrospective message to gama@po-team via the comms MCP tool.\n\nStep 1: Use ToolSearch with query "select:mcp__comms__send" to load the tool schema.\nStep 2: Call mcp__comms__send with to="gama@po-team" and the following message (send verbatim, preserving all newlines and formatting):\n\n' + retroMsg + '\n\nReturn sent=true after sending.',
  { label: 'retro-gama', phase: 'RETRO', schema: REPORT_SCHEMA, model: 'claude-sonnet-5[1m]', effort: 'low' }
)

log('Retrospective sent. Pipeline done.')
return { success: true, results: results }
