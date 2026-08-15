/**
 * fixes-and-features-pipeline — Post-#132 fixes + feature pipeline.
 *
 * 4 serial slices:
 *   Slice 1: T6 follow-ups (#135, #136, #137) — well-specified fixes, skip RED
 *   Slice 2: YELLOW batch (128.1 pluralization, 131.1 setTimeout, 131.2 Escape test) — skip RED
 *   Slice 3: #134 Role management 1.0 — admin + librarian assignment UI (full TDD)
 *   Slice 4: #123 Language selector on profile page (full TDD)
 *
 * Based on the epic-132-event-management template. Includes:
 *   - Progress tracking ([agent N/total])
 *   - Verdict-triggered Gama reporting (post-REVIEW + post-MERGE)
 *   - blockerType guidance in REVIEW prompt (lesson from #132)
 *   - Closing RETRO phase
 *
 * No pipelined RED this run (no-parallel-branches convention). All 4 slices
 * touch different files — pipelining would be safe if the convention is relaxed.
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
  name: 'fixes-and-features-pipeline',
  description: 'Post-#132: T6 follow-ups, YELLOW batch, role management (#134), language selector (#123)',
  phases: [
    { title: 'RED', detail: 'Write failing tests', model: 'claude-fable-5' },
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
  '- **Canonical create shape** (follow src/lib/sections/sectionActions.ts:80-177):',
  '  1. `const typeId = await resolveTypeId(cfg, typeName, fetchImpl)`',
  '  2. POST `entity` with props array: `[{type:"_type", reference: typeId}, {type:"_parent", reference: parentId}, ...]`',
  '  3. Guard: response must contain `_id` (the "apparent-success trap")',
  '',
  '- **Trust _inheritrights** — created entities set ONLY _type + _parent + domain props.',
  '  No explicit _sharing or _inheritrights. Org has _sharing:domain + _inheritrights:true.',
  '',
  '- **Replace semantics** (Entu POST appends, never overwrites):',
  '  GET old value _ids → POST new value → DELETE old _ids. POST-before-DELETE rule.',
  '  See: src/lib/events/eventFieldEdit.ts:8-26',
  '',
  '- **Rights gating**: rights props (_owner/_editor) ride on list reads (no extra fetch).',
  '  `manageRightsFrom(owners, editors, personId)` → "editor" | "not-editor" | "error".',
  '  Absence of rights props = not-editor (fail-closed). See: src/routes/+page.svelte:284-292',
  '',
  '- **Admin resolution**: `resolveAdmin(cfg, personId, fetchImpl)` from src/lib/nav/adminStore.ts.',
  '  Checks _owner/_editor on the organization entity. Result: "admin" | "not-admin" | "error".',
  '',
  '- **Librarian resolution**: `resolveLibrarian` from src/lib/library/librarianStore.ts.',
  '  Checks _owner/_editor on the library entity.',
  '',
  '- **Org resolution**: `resolveMyOrgId(cfg, personId)` from src/lib/org/myOrg.ts:51-93.',
  '  NEVER `entity?_type.string=organization&limit=1` (returns federation umbrella, not collective).',
  '',
  '- **Svelte 5 runes ONLY**: $state(), $derived(), $effect(), $props(), $bindable().',
  '  NEVER legacy `export let` or `$:` syntax. REASSIGN arrays/objects to trigger reactivity.',
  '',
  '- **Autocomplete component**: src/lib/components/Autocomplete.svelte (introduced in #132 T2).',
  '  Props: items, onSelect, placeholder, allowFreeText, label. Reuse for person search.',
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
  // ─── Slice 1: T6 follow-ups (#135 + #136 + #137) ─────────────────────
  {
    issueNumber: 135,
    taskTag: 'S1',
    branch: 'fix/t6-followups',
    title: 'T6 follow-ups (#135 mutual exclusion, #136 touch targets, #137 collective switch)',
    commitPrefix: 'fix(#135,#136,#137)',
    skipRed: true,
    redPrompt: null,
    greenPrompt: [
      'Fix three T6 YELLOW follow-ups from Epic #132. All on this one branch.',
      '',
      ARCH_CONTEXT,
      '',
      '## Fix 1: #135 — Mutual exclusion must guard in-flight submits',
      '',
      'File: src/routes/+page.svelte',
      '',
      'Problem: `openSeasonCreateForm` / `openEventCreateForm` / `openSeriesCreateForm` call direct',
      '`close*` functions instead of the guarded `dismiss*` variants. This bypasses in-flight submit',
      'guards — if a bulk generation is running and the user opens a different form, the series form',
      'is torn down mid-run.',
      '',
      'Fix:',
      '1. Guard the mutual-exclusion closes on in-flight flags: `open*Form` functions early-return',
      '   when `seriesCreateSubmitting || eventCreateSubmitting` is true',
      '2. Add `seriesRunUnfinished = $derived(seriesCreateSubmitting || seriesCreateResume !== null)`',
      '   and use it in all guard predicates',
      '3. Mirror `dismissSeriesCreateForm` pattern for season and event cancel buttons',
      '4. Either widen `closeSeasonManagePanel` guard to `seriesRunUnfinished`, or render explanation',
      '   text when resume is pending',
      '',
      'Look at lines ~1500, ~2287, ~2834, ~1916 in +page.svelte.',
      '',
      '## Fix 2: #136 — 44x44px touch targets on admin controls',
      '',
      'File: src/routes/+page.svelte',
      '',
      'Problem: Inline-edit pencil buttons, conductor chip remove buttons, skip-date remove buttons,',
      'and form fields are below the 44x44px touch target minimum.',
      '',
      'Fix:',
      '1. Add `flex min-h-11 min-w-11 items-center justify-center` to pencil buttons',
      '   (`season-edit-btn-name`, `season-edit-btn-start_date`, `season-edit-btn-end_date`)',
      '2. Same for conductor chip × remove and skip-date remove buttons',
      '3. Add `min-h-11` to form inputs/selects/textareas (or narrow the test to buttons only)',
      '4. Fix the series-create-generate checkbox (~16px → min-h-11 wrapper)',
      '',
      'Look at lines ~3270, 3320, 3367 in +page.svelte.',
      '',
      '## Fix 3: #137 — Collective switch during bulk generation',
      '',
      'File: src/routes/+page.svelte',
      '',
      'Problem: `loadForSelected()` on a collective switch runs `closeSeriesCreateForm()`',
      'unconditionally while `seriesCreateSubmitting === true`. The bulk loop keeps POSTing',
      'against the old db config.',
      '',
      'Fix:',
      '1. Capture the run\'s db at submit: `const runDb = cfg.db`',
      '2. Before every post-loop state write in `submitSeriesCreate`, bail if `selected?.db !== runDb`',
      '3. Optionally abort the generation loop on db mismatch',
      '',
      'Look at lines ~360, ~3167-3189 in +page.svelte.',
      '',
      '## Verification',
      'After all three fixes: pnpm test -- --run && pnpm check'
    ].join('\n'),
    i18nPrompt: null,
    reviewChecklist: [
      '1. open*Form functions guard on in-flight submit flags (never tear down a running form)',
      '2. seriesRunUnfinished derived correctly and used consistently',
      '3. dismiss* pattern used for all cancel paths (not direct close*)',
      '4. Touch targets: all admin buttons >= 44x44px (min-h-11 min-w-11)',
      '5. Form fields either min-h-11 or test contract narrowed to buttons only',
      '6. Collective switch during bulk gen: runDb captured and checked before post-loop writes',
      '7. No regressions in existing tests',
      '8. Svelte 5 runes throughout',
      '9. No unrelated changes outside the three fix scopes'
    ].join('\n'),
    commitBody: 'Three T6 follow-ups from Epic #132:\n- #135: Mutual exclusion guards in-flight submits\n- #136: 44x44px touch targets on admin inline-edit and form controls\n- #137: Collective switch during bulk generation bails safely',
    closesIssues: [135, 136, 137]
  },

  // ─── Slice 2: YELLOW batch (128.1 + 131.1 + 131.2) ───────────────────
  {
    issueNumber: 0,
    taskTag: 'S2',
    branch: 'fix/yellow-followups',
    title: 'YELLOW follow-ups (128.1 pluralization, 131.1 setTimeout, 131.2 Escape test)',
    commitPrefix: 'fix(#128,#131)',
    skipRed: true,
    redPrompt: null,
    greenPrompt: [
      'Fix three YELLOW follow-ups from prior reviews. All on this one branch.',
      '',
      ARCH_CONTEXT,
      '',
      '## Fix 1: YELLOW-128.1 — Pluralization',
      '',
      'File: messages/{en,et,lv,uk}.json, key "library_available_summary"',
      'Current: "{count} copies available for lending" (same string for all counts — broken at count=1)',
      '',
      'Fix: Use ICU MessageFormat plural syntax.',
      'English: "{count, plural, one {# copy available for lending} other {# copies available for lending}}"',
      'Apply linguistically correct plural forms:',
      '- Estonian: 2 forms (one/other)',
      '- Latvian: 3 forms (zero/one/other)',
      '- Ukrainian: 3 forms (one/few/many/other)',
      '',
      'Reference: src/routes/library/+page.svelte uses m.library_available_summary({ count: availableCount })',
      '',
      '## Fix 2: YELLOW-131.2 — Escape key test',
      '',
      'File: src/routes/page.profile.spec.ts',
      'The profile conflict resolution has an Escape key handler:',
      '"if (e.key === \'Escape\' && previewLevel !== null) previewLevel = null"',
      '',
      'Add a test that:',
      '- Enters conflict preview mode (simulates the first tap on a visibility button)',
      '- Presses Escape',
      '- Verifies the preview is dismissed (previewLevel back to null)',
      '',
      '## Fix 3: YELLOW-131.1 — setTimeout(0) cleanup',
      '',
      'File: src/routes/profile/+page.svelte, line ~407',
      'Current: setTimeout(() => void loadForSelected(), 0)',
      '',
      'Fix: Replace with tick() from svelte.',
      'Import: import { tick } from \'svelte\'',
      'Replacement: await tick(); loadForSelected(); (make the enclosing function async if needed)',
      '',
      '## Verification',
      'After all three fixes: pnpm test -- --run && pnpm check'
    ].join('\n'),
    i18nPrompt: null,
    reviewChecklist: [
      '1. Pluralization uses correct ICU MessageFormat syntax for all 4 locales',
      '2. Estonian/Latvian/Ukrainian plural rules are linguistically correct',
      '3. Escape key test actually tests the dismiss behavior, not just handler existence',
      '4. tick() replacement preserves original timing semantics',
      '5. No regressions in existing tests'
    ].join('\n'),
    commitBody: 'Follow-ups from #128 and #131 reviews:\n- 128.1: Pluralization for library_available_summary (ICU MessageFormat)\n- 131.2: Escape key test for profile conflict preview dismiss\n- 131.1: setTimeout(0) replaced with tick() in profile page',
    closesIssues: []
  },

  // ─── Slice 3: #134 — Role management 1.0 ──────────────────────────────
  {
    issueNumber: 134,
    taskTag: 'S3',
    branch: 'feat/134-role-management',
    title: 'Role management 1.0 — admin + librarian assignment UI',
    commitPrefix: 'feat(#134)',
    skipRed: false,
    redPrompt: [
      'Write failing tests for role management (#134).',
      '',
      ARCH_CONTEXT,
      '',
      '## What to test',
      '',
      '### 1. Role data functions',
      'File: src/lib/admin/roleManagement.spec.ts',
      '',
      '#### CRITICAL: Entu aggregated rights wire shape',
      '- GET entity/{id}?props=_owner,_editor returns a ROLLUP:',
      '  - _owner entries are folded into _editor (same _id)',
      '  - Parent rights are spliced in with {inherited: true}',
      '- Test fixtures MUST model this wire shape:',
      '  - An owner\'s _editor entry shares the same _id as their _owner entry',
      '  - Include inherited:true entries with foreign entity _ids',
      '  - Test that remove NEVER deletes inherited entries or double-deletes folded _ids',
      '- Write operations (POST/DELETE on rights props) require _owner, not just _editor',
      '',
      '#### fetchRights(cfg, entityId, fetchImpl) → { ownOwners, ownEditors }',
      '- Filters out inherited:true, separates own owners from own editors',
      '- ownEditors excludes entries whose _id appears in ownOwners (the fold)',
      '',
      '#### listAdmins(cfg, orgId, fetchImpl) → Person[]',
      '- Uses fetchRights, returns person list with id, name, role, and property valueId',
      '',
      '#### addAdmin(cfg, orgId, personId, fetchImpl)',
      '- POSTs _editor reference to org entity',
      '',
      '#### removeAdmin(cfg, orgId, personId, fetchImpl)',
      '- Finds matching entries from ownOwners/ownEditors ONLY (never inherited)',
      '- Dedupes _ids before deleting (owner entry appears in both sets)',
      '- Lockout prevention: refuses if removing the last ownOwner',
      '',
      '#### listLibrarians / addLibrarian / removeLibrarian',
      '- Same pattern but targeting library entity',
      '',
      '### 2. Admin page route',
      'File: src/routes/page.admin.spec.ts',
      '',
      '- /admin route exists and renders',
      '- Only accessible to admins (redirect or 403 for non-admins)',
      '- Shows admin management section with current admin list',
      '- Shows librarian management section with current librarian list',
      '- Person autocomplete for adding admins (reuses Autocomplete component)',
      '- Person autocomplete for adding librarians',
      '- Remove button per admin/librarian entry',
      '- Remove button disabled on the last _owner (lockout prevention)',
      '- Integration: /admin route accessible from navigation (admin-only nav item)',
      '',
      '### 3. Role resolution for library entity ID',
      '- Need a way to resolve the library entity ID for the current collective',
      '  (similar to resolveMyOrgId but for library — check if this exists already)',
      '',
      '## Reference files',
      '- src/lib/nav/adminStore.ts — existing admin resolution (read pattern to follow for write)',
      '- src/lib/library/librarianStore.ts — existing librarian resolution',
      '- src/lib/components/Autocomplete.svelte — reuse for person search',
      '- src/lib/events/eventFieldEdit.ts:8-26 — replace semantics for _editor refs'
    ].join('\n'),
    greenPrompt: [
      'Implement role management (#134).',
      '',
      ARCH_CONTEXT,
      '',
      '## CRITICAL: Entu aggregated rights wire shape',
      '',
      'GET entity/{id}?props=_owner,_editor returns a ROLLUP, NOT own grants:',
      '- utils/aggregate.js:193-197 folds the entity\'s own _owner docs into _editor (same _id)',
      '- utils/rights.js:14-45 splices in PARENT rights docs, tagged {inherited: true}',
      '- cleanupEntity (utils/entity.js:569-586) ships the aggregate untouched',
      '',
      'Consequences for this implementation:',
      '1. _editor array contains own _editor grants + own _owner docs + parent _owner/_editor docs',
      '2. An entry with inherited:true has a _id from a PARENT entity — deleting it mutates the parent',
      '3. An _editor entry whose _id matches an _owner entry is NOT a separate editor grant',
      '',
      'Rules for role management:',
      '- ALWAYS filter out inherited:true entries before building actionable lists',
      '- For owner display: use only _owner entries where inherited is absent/false',
      '- For editor display: use only _editor entries where inherited is absent/false AND _id does NOT appear in _owner',
      '- For remove: ONLY delete _ids from the filtered own-grants sets, NEVER inherited ones',
      '- Dedupe delete sets by _id before issuing DELETEs (an _owner entry appears in both _owner and _editor)',
      '',
      '## CRITICAL: Write operations require _owner, not just _editor',
      '',
      'Entu requires the caller to be in private._owner for ANY write to a rights property:',
      '- POST path: utils/entity.js:113-121 ("User not in _owner property", 403)',
      '- DELETE path: routes/[db]/property/[_id]/index.delete.js:140-146',
      '',
      'The admin page must gate write controls on _owner status specifically:',
      '- An org _editor can SEE the admin page (they pass resolveAdmin which checks _owner OR _editor)',
      '- But they CANNOT add/remove roles — every write 403s',
      '- Solution: separate isOwner check. Show lists to editors (read-only), enable add/remove only for owners.',
      '  Add a localized hint for editors: "Only owners can change roles"',
      '',
      '## What to implement',
      '',
      '### 1. Role data functions',
      'File: src/lib/admin/roleManagement.ts',
      '',
      '**fetchRights(cfg, entityId, fetchImpl) → { ownOwners, ownEditors, allEntries }:**',
      '- GET entity/{entityId}?props=_owner,_editor',
      '- Filter: ownOwners = _owner entries where inherited is absent/false',
      '- Filter: ownEditors = _editor entries where inherited is absent/false AND _id NOT IN ownOwner _ids',
      '- Return both sets plus the raw response for display purposes',
      '',
      '**listAdmins(cfg, orgId, fetchImpl):**',
      '- Uses fetchRights to get ownOwners + ownEditors',
      '- Return array of { id, name, role: "owner"|"editor", valueId } (valueId = property _id for removal)',
      '- May show inherited entries as read-only info rows (optional)',
      '',
      '**addAdmin(cfg, orgId, personId, fetchImpl):**',
      '- POST _editor reference to entity/{orgId}',
      '- No replace needed — just append',
      '',
      '**removeAdmin(cfg, orgId, personId, fetchImpl):**',
      '- Use fetchRights to get ownOwners + ownEditors',
      '- Find matching entries ONLY from ownOwners/ownEditors (never inherited)',
      '- Lockout prevention: if removing an owner, count remaining ownOwners. If <= 1, throw.',
      '- Collect _ids to delete, dedupe via new Set()',
      '- DELETE property/{valueId} for each unique _id',
      '',
      '**listLibrarians / addLibrarian / removeLibrarian:**',
      'Same pattern but targeting the library entity.',
      '',
      '**resolveLibraryId(cfg, fetchImpl):**',
      '- Check if librarianStore.ts already provides this. If not:',
      '  GET entity?_type.string=library&_parent.reference={orgId}&props=_id&limit=1',
      '',
      '### 2. Admin page',
      'File: src/routes/admin/+page.svelte',
      '',
      '- Admin-gated route: check $adminStore === "admin", redirect if not',
      '- Resolve isOwner separately: check if current person is in ownOwners (not just admin)',
      '- Two sections: Admin Management, Librarian Management',
      '- Each section: list of current own role holders + Autocomplete to add new ones',
      '- Each entry: name + role badge (owner/editor) + remove button',
      '- Add/remove controls DISABLED for non-owners with hint "Only owners can change roles"',
      '- Remove button disabled for last _owner (lockout prevention)',
      '- Person autocomplete reuses Autocomplete component from #132 T2',
      '  Items = collective members (existing person list from member data)',
      '',
      '### 3. Navigation link',
      '- Add /admin to the NavShell (admin-only, gated on $adminStore === "admin")',
      '',
      '### 4. Test fixtures',
      'Tests MUST model the real Entu wire shape:',
      '- Owner entries appear in BOTH _owner and _editor arrays (same _id)',
      '- Include inherited:true entries with foreign entity _ids',
      '- Test: removing an editor does NOT delete an owner-folded-into-editor entry',
      '- Test: removing a librarian does NOT delete an inherited parent entry',
      '- Test: org _editor (not _owner) sees read-only admin page',
      '',
      '## Reference files',
      '- src/lib/nav/adminStore.ts — admin resolution pattern',
      '- src/lib/library/librarianStore.ts — librarian resolution pattern',
      '- src/lib/components/Autocomplete.svelte — person search',
      '- src/lib/events/eventFieldEdit.ts — replace semantics for reference props',
      '- ~/projects/entu-api/utils/aggregate.js:193-197 — _owner folded into _editor',
      '- ~/projects/entu-api/utils/rights.js:14-45 — inherited rights tagged inherited:true'
    ].join('\n'),
    i18nPrompt: [
      'Add i18n strings for role management (#134).',
      '',
      'Files: messages/{en,et,lv,uk}.json',
      '',
      'Check what message keys the GREEN phase implementation uses (read the component code).',
      'Expected keys (verify against actual):',
      '- Page title: "Administration" / "Haldamine" / "Administrēšana" / "Адміністрування"',
      '- Section headers: "Admins", "Librarians"',
      '- Add button/placeholder: "Add admin...", "Add librarian..."',
      '- Remove button label',
      '- Role badges: "Owner", "Editor"',
      '- Lockout warning: "Cannot remove the last owner"',
      '- Empty states',
      '- Navigation link: "Admin"',
      '',
      'Apply linguistically correct translations for all 4 locales.',
      'Verify: pnpm check — 0 type errors.'
    ].join('\n'),
    reviewChecklist: [
      '1. Admin page gated on $adminStore === "admin" (redirect, not just hidden)',
      '2. Write controls (add/remove) gated on _owner specifically, not just admin (org _editor passes resolveAdmin but cannot write rights props — 403)',
      '3. fetchRights filters out inherited:true entries before building actionable delete sets',
      '4. _owner entries folded into _editor (same _id) are NOT double-deleted — dedupe by _id',
      '5. Remove never deletes an inherited entry (would mutate parent entity)',
      '6. Lockout prevention: cannot remove last own _owner on org entity',
      '7. Test fixtures model real Entu wire shape: owner-in-editor fold, inherited:true entries',
      '8. Autocomplete reused from #132 T2 without modification',
      '9. Library entity ID resolved correctly (not hardcoded)',
      '10. Navigation link admin-gated in NavShell',
      '11. Person search does not N+1 (loaded once, filtered client-side)',
      '12. Svelte 5 runes throughout',
      '13. Mobile responsive',
      '14. i18n complete for all 4 locales',
      '15. No _sharing or _inheritrights set when modifying role refs'
    ].join('\n'),
    commitBody: 'Role management 1.0: admin + librarian assignment UI.\nNew /admin route with person autocomplete, lockout prevention,\nand rights-based resolution (org for admins, library for librarians).',
    closesIssues: [134]
  },

  // ─── Slice 4: #123 — Language selector ────────────────────────────────
  {
    issueNumber: 123,
    taskTag: 'S4',
    branch: 'feat/123-language-selector',
    title: 'Language selector on profile page',
    commitPrefix: 'feat(#123)',
    skipRed: false,
    redPrompt: [
      'Write failing tests for the language selector feature on the profile page (#123).',
      '',
      ARCH_CONTEXT,
      '',
      '## What to test',
      '',
      'File: src/routes/page.language-selector.spec.ts',
      '',
      'The app uses Paraglide with 4 locales (en, et, lv, uk). Currently language is',
      'browser-detected only — no user-facing control.',
      '',
      'Read the existing profile page (src/routes/profile/+page.svelte) and Paraglide',
      'setup (src/lib/paraglide/) to understand the current i18n infrastructure.',
      '',
      '### Tests',
      '- A language selector renders on the profile page with all 4 locale options',
      '- Each locale shows its native name (English, Eesti, Latviešu, Українська)',
      '- Selecting a locale changes the app language',
      '- The selected locale persists via cookie',
      '- The persisted locale takes priority over browser detection on next load',
      '- Integration test: the language selector appears on the actual profile route',
      '- Keyboard accessible (tab to selector, enter/space to select)',
      '',
      '## Reference files',
      '- src/routes/profile/+page.svelte — existing profile page',
      '- src/lib/paraglide/ — Paraglide setup, check for setLanguageTag or cookie mechanism'
    ].join('\n'),
    greenPrompt: [
      'Implement the language selector on the profile page (#123).',
      '',
      ARCH_CONTEXT,
      '',
      '## What to implement',
      '',
      '### 1. Locale persistence',
      'Add a locale preference cookie. In SvelteKit hooks or layout load, read the locale',
      'cookie and pass it to Paraglide to override browser detection. Set the cookie when',
      'the user changes language.',
      '',
      'Check how Paraglide handles locale switching in SvelteKit — look for setLanguageTag,',
      'i18n.config, or the Paraglide SvelteKit adapter documentation.',
      '',
      '### 2. Language selector component',
      'Add to src/routes/profile/+page.svelte (or a small component rendered from it):',
      '',
      '- Show all 4 locales with native names:',
      '  - en: English',
      '  - et: Eesti',
      '  - lv: Latviešu',
      '  - uk: Українська',
      '- On selection: set the locale cookie, trigger Paraglide language change',
      '- Current locale highlighted/selected',
      '- Keyboard accessible',
      '',
      'Use a simple <select> or radio group — no need for Autocomplete here.',
      'Use Svelte 5 runes ($state, $derived, $props).',
      '',
      '### 3. Wire into profile page',
      '- Place the selector in a logical section of the profile page',
      '- Label it with an i18n key',
      '',
      '## Reference files',
      '- src/routes/profile/+page.svelte — existing profile page',
      '- src/lib/paraglide/ — Paraglide setup'
    ].join('\n'),
    i18nPrompt: [
      'Add i18n strings for the language selector feature (#123).',
      '',
      'Files: messages/{en,et,lv,uk}.json',
      '',
      'Check what message keys the GREEN phase implementation uses (read the code).',
      'Expected keys (verify against actual):',
      '- Language selector label: "Language" / "Keel" / "Valoda" / "Мова"',
      '- Helper text if present',
      '- Locale display names if referenced from messages (may be hardcoded — check)',
      '',
      'Apply linguistically correct translations for all 4 locales.',
      'Verify: pnpm check — 0 type errors.'
    ].join('\n'),
    reviewChecklist: [
      '1. Language selector renders with all 4 locales on the profile page',
      '2. Locale persistence works via cookie',
      '3. Persisted locale overrides browser detection on next load',
      '4. Svelte 5 runes used throughout',
      '5. Paraglide integration is correct (not a workaround)',
      '6. Keyboard accessible',
      '7. Mobile responsive',
      '8. i18n messages present and correct for all 4 locales',
      '9. No XSS vectors in locale handling (validate locale value)',
      '10. Cookie is httpOnly or at least path-scoped and SameSite'
    ].join('\n'),
    commitBody: 'Language selector on the profile page. Users choose their preferred\nlocale (en/et/lv/uk) which persists via cookie and overrides browser\ndetection on subsequent visits.',
    closesIssues: [123]
  }
]

// ── Progress tracking ─────────────────────────────────────────────────────

const TOTAL_AGENTS = tasks.reduce(function(sum, t) {
  return sum + (t.skipRed ? 0 : 1) + (t.greenPrompt ? 1 : 0) + (t.i18nPrompt ? 1 : 0) + 1 + 1 + 1 + 1 + 1
}, 0) + 1
// S1: GREEN+INTEGRATION+REVIEW+2×REPORT+MERGE = 6
// S2: same = 6
// S3: RED+GREEN+I18N+INTEGRATION+REVIEW+2×REPORT+MERGE = 8
// S4: RED+GREEN+I18N+INTEGRATION+REVIEW+2×REPORT+MERGE = 8
// RETRO = 1
// Total: 6+6+8+8+1 = 29

let agentNum = 0

function progress(sliceLabel, phaseName, taskTitle) {
  agentNum++
  return '[agent ' + agentNum + '/' + TOTAL_AGENTS + '] ' + sliceLabel + ' — ' + phaseName + ': ' + taskTitle
}

// ── Pipeline execution ────────────────────────────────────────────────────

const results = []

for (let i = 0; i < tasks.length; i++) {
  const task = tasks[i]
  const taskLabel = (task.issueNumber ? '#' + task.issueNumber : 'YELLOW batch') + '/' + task.taskTag + ' ' + task.title
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
      'Verify that all new features on branch ' + task.branch + ' for ' + taskLabel + ' are REACHABLE from the actual app — not just correct in isolation.\n\nWORKING DIRECTORY: ' + REPO + '\n\n## Wiring checks\n1. For every new component: grep for its import in a page/route file. If not imported anywhere, it is unreachable.\n2. For every new data function (exported from a .ts file): grep for its import. If only imported by test files, it is unreachable.\n3. For every new UI element: check that the page renders it (conditionally is fine, but the conditional must be reachable).\n4. Run: cd ' + REPO + ' && pnpm test -- --run && pnpm check\n\nReturn passed=true if every new export is imported from at least one non-test file AND the page/route renders the feature. Return passed=false with a checks array listing each unreachable item.\n\nDo NOT fix anything — only verify and report.',
      { label: 'integration-' + task.taskTag + '-' + integrationAttempts, phase: 'INTEGRATION', schema: PROBE_SCHEMA, model: 'claude-sonnet-5[1m]' }
    )

    if (!integration || !integration.passed) {
      var failedChecks = (integration && integration.checks) ? integration.checks.filter(function(c) { return !c.passed }) : []
      var failSummary = failedChecks.map(function(c) { return c.name + ': ' + (c.detail || '') }).join('\n')

      if (integrationAttempts < 2) {
        phase('GREEN-FIX')
        log('[retry] ' + sliceLabel + ' — GREEN-FIX: wiring gaps for ' + task.title)
        await agent(
          'Fix wiring gaps on branch ' + task.branch + ' for ' + taskLabel + '.\n\nWORKING DIRECTORY: ' + REPO + '\n\nUnreachable features:\n' + failSummary + '\n\nFor each gap: add the missing import/render in the appropriate page or route file. Do NOT rewrite the feature — just wire it in.\n\nVerify: pnpm test -- --run && pnpm check. Commit the fix.',
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
  var mergeCmd = 'cd ' + REPO + ' && git checkout main && git pull && git merge --squash ' + task.branch + ' && git commit -m "$(cat <<\'COMMITEOF\'\n' + task.commitPrefix + '/' + task.taskTag + ': ' + task.title + '\n\n' + task.commitBody + closesLines + '\n\n' + CO_AUTHOR + '\nCOMMITEOF\n)" && git push && git branch -d ' + task.branch + ' && git push origin --delete ' + task.branch + ' 2>/dev/null || true'

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

var retroMsg = '## Fixes & Features Pipeline Retrospective\n\n### Completed slices\n' + completedList + '\n\n### Pipeline shape\n4 serial slices (2 fix batches + 2 features). Fix batches skipped RED (well-specified). Features ran full TDD: RED → GREEN → I18N → INTEGRATION → REVIEW → MERGE.\n\n### Questions for retro\n1. Fix batching (3 issues in one slice) — right granularity, or too coarse?\n2. Skipping RED for well-specified fixes — worked as expected?\n3. Role management (#134) — Autocomplete reuse from #132 smooth?\n4. Language selector (#123) — cookie persistence approach acceptable?\n5. Pipeline template improvements to codify for next run?\n\nWaiting for your observations.\n\n(*MVOX:Palestrina*)'

await agent(
  'Send a retrospective message to gama@po-team via the comms MCP tool.\n\nStep 1: Use ToolSearch with query "select:mcp__comms__send" to load the tool schema.\nStep 2: Call mcp__comms__send with to="gama@po-team" and the following message (send verbatim, preserving all newlines and formatting):\n\n' + retroMsg + '\n\nReturn sent=true after sending.',
  { label: 'retro-gama', phase: 'RETRO', schema: REPORT_SCHEMA, model: 'claude-sonnet-5[1m]', effort: 'low' }
)

log('Retrospective sent. Pipeline done.')
return { success: true, results: results }
