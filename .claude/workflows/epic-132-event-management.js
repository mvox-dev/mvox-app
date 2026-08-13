/**
 * epic-132-event-management — Full TDD pipeline for Epic #132.
 *
 * Event management: create + manage seasons, event series, and events.
 * 6 serial slices (T1–T6), each through RED → GREEN → I18N → INTEGRATION → REVIEW → MERGE.
 * Verdict-triggered Gama reporting + closing retro.
 *
 * Design reference: https://gist.github.com/mitselek/2e0ee86dffdfbc12bf380e1bfbbe42b8
 * Epic: mvox-dev/mvox-app#132
 *
 * Architectural facts (from Finn's codebase research, 2026-08-13):
 *   - Pure client-side SPA (ssr=false, browser-direct Entu calls via entuFetch)
 *   - No +page.server.ts, no form actions — writes are onclick → *Actions.ts → entuFetch
 *   - Canonical create: resolveTypeId → POST [_type(ref), _parent(ref), ...props]
 *   - Replace semantics: GET old value _ids → POST new → DELETE old (POST-before-DELETE rule)
 *   - Rights ride on list reads (props=_owner,_editor), manageRightsFrom() computation
 *   - SectionPicker (521 lines) is nearest autocomplete precedent
 *   - Page-level "+ New X" form from roster/+page.svelte:712-800 is create UX template
 *   - resolveMyOrgId (myOrg.ts:51-93) for org parent — never query by type name
 *
 * DESIGN DECISION (Gama, 2026-08-13): trust _inheritrights from org.
 *   Created entities set ONLY _type + _parent — no explicit _sharing or _inheritrights.
 *   This DEVIATES from all 8 existing creates (which set _sharing: domain).
 *   The rationale: org has _sharing:domain + _inheritrights:true, so children inherit.
 *
 * Model assignments (per tdd-slice-pipeline convention):
 *   RED:         fable    — creative/lateral edge-case tests
 *   GREEN:       sonnet   — constrained execution, tests define the goal
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
  name: 'epic-132-event-management',
  description: 'Epic #132: Event management — 6 serial TDD slices (T1–T6) with Gama reporting and retro',
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

// ── Shared context block injected into every agent prompt ────────────────

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
  '  3. Guard: response must contain `_id` (the "apparent-success trap" — 2xx without _id is a silent failure)',
  '',
  '- **CRITICAL DESIGN DECISION: NO explicit _sharing or _inheritrights on created entities.**',
  '  Set ONLY `_type` (reference) + `_parent` (reference) + domain props.',
  '  Trust Entu `_inheritrights` propagation from the organization entity.',
  '  This is a deliberate deviation from all existing creates (which set _sharing:domain).',
  '',
  '- **Replace semantics** (Entu POST appends, never overwrites):',
  '  GET old value _ids → POST new value → DELETE old _ids. POST-before-DELETE rule.',
  '  See: src/lib/events/eventFieldEdit.ts:8-26',
  '',
  '- **Rights gating**: rights props (_owner/_editor) ride on list reads (no extra fetch).',
  '  `manageRightsFrom(owners, editors, personId)` → "editor" | "not-editor" | "error".',
  '  Absence of rights props = not-editor (fail-closed). See: src/routes/+page.svelte:284-292',
  '',
  '- **Org resolution**: `resolveMyOrgId(cfg, personId)` from src/lib/org/myOrg.ts:51-93.',
  '  NEVER `entity?_type.string=organization&limit=1` (returns federation umbrella, not collective).',
  '',
  '- **resolveTypeId**: src/lib/seasons/entuSeasons.ts:26-50.',
  '  Module-level Map cache; `resetTypeIdCache()` for tests.',
  '',
  '- **Field-typed wire values** (src/lib/events/eventFieldEdit.ts:40-49):',
  '  start_datetime → {type, datetime}, duration_minutes → {type, number}, default → {type, string}',
  '',
  '- **Series inheritance merge** (src/lib/seasons/entuSeasons.ts:122-167):',
  '  event reads name/duration_minutes/location from series via _parent[].entity_type=event_series.',
  '  Rights are NOT inherited from series — series editor ≠ event editor.',
  '',
  '- **Svelte 5 runes ONLY**: $state(), $derived(), $effect(), $props(), $bindable().',
  '  NEVER legacy `export let` or `$:` syntax. REASSIGN arrays/objects to trigger reactivity.',
  '',
  '- **Existing types**: src/lib/seasons/types.ts (SeasonRaw, Season, SeriesRaw, RehearsalRaw).',
  '  src/lib/agenda/types.ts (AgendaItem). src/lib/events/eventDetail.ts (detail view model).',
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
  // ─── T1: Entity creation API utility ──────────────────────────────────
  {
    issueNumber: 132,
    taskTag: 'T1',
    branch: 'feat/132-t1-entity-create-utility',
    title: 'Entity creation API utility (createSeason, createEventSeries, createEvent)',
    commitPrefix: 'feat(#132)',
    skipRed: false,
    redPrompt: [
      'Write failing tests for the entity creation API utility — three create functions for #132.',
      '',
      ARCH_CONTEXT,
      '',
      '## What to test',
      '',
      'Create a test file: src/lib/entity/entityCreate.spec.ts',
      '',
      '### createSeason(cfg, params, fetchImpl)',
      'params: { name: string, startDate: string, endDate: string, parentId: string, conductorRefs?: string[] }',
      '- Calls resolveTypeId with "season"',
      '- POSTs with _type (reference to resolved id), _parent (reference to parentId)',
      '- Sends name (string), start_date (date), end_date (date)',
      '- If conductorRefs provided, sends conductor (reference) for each',
      '- Does NOT set _sharing or _inheritrights (critical — test that these are absent from the POST body)',
      '- Returns the created entity _id from the response',
      '- Throws on missing _id in response (apparent-success trap)',
      '',
      '### createEventSeries(cfg, params, fetchImpl)',
      'params: { name: string, parentId: string, durationMinutes?: number, defaultLocation?: string, description?: string }',
      '- Calls resolveTypeId with "event_series"',
      '- POSTs with _type (reference), _parent (reference to season)',
      '- Sends name (string), duration_minutes (number), default_location (string), description (string) — optional fields omitted when absent',
      '- Does NOT set _sharing or _inheritrights',
      '- Returns created entity _id',
      '',
      '### createEvent(cfg, params, fetchImpl)',
      'params: { name: string, parentId: string, eventType: string, startDatetime?: string, durationMinutes?: number, location?: string, description?: string, conductorRefs?: string[], capacity?: number }',
      '- parentId may be a season or event_series',
      '- Calls resolveTypeId with "event"',
      '- POSTs with _type (reference), _parent (reference), event_type (string)',
      '- Optional fields: start_datetime (datetime), duration_minutes (number), location (string), description (string), conductor (reference[]), capacity (number)',
      '- Does NOT set _sharing or _inheritrights',
      '- Returns created entity _id',
      '',
      '### Shared test patterns',
      '- Use the fetchImpl injectable seam for mocking (same pattern as existing tests)',
      '- Verify the exact POST body shape against Entu wire contract',
      '- Test that _sharing and _inheritrights are ABSENT in every create call',
      '- Test error cases: resolveTypeId failure, POST failure, missing _id in response',
      '',
      '## Reference files',
      '- src/lib/sections/sectionActions.ts:80-177 — existing create pattern (follow contract block style)',
      '- src/lib/seasons/entuSeasons.ts:26-50 — resolveTypeId',
      '- src/lib/entu/request.ts — entuFetch, entuUrl'
    ].join('\n'),
    greenPrompt: [
      'Implement three entity creation functions for #132.',
      '',
      ARCH_CONTEXT,
      '',
      '## What to implement',
      '',
      'Create: src/lib/entity/entityCreate.ts',
      '',
      'Follow the sectionActions.ts:80-177 contract pattern:',
      '1. Written contract block (JSDoc) documenting params, wire shape, error conditions',
      '2. Name-trim validation before any fetch',
      '3. resolveTypeId call',
      '4. POST with typed props array',
      '5. Guard: response must contain _id (apparent-success trap)',
      '',
      'Three functions: createSeason, createEventSeries, createEvent',
      '(see test file for exact signatures and expected behavior)',
      '',
      'Key constraint: NO _sharing, NO _inheritrights in the POST body.',
      'Only _type (reference) + _parent (reference) + domain props.',
      '',
      'Import resolveTypeId and resetTypeIdCache from src/lib/seasons/entuSeasons.ts.',
      'Import entuFetch from src/lib/entu/request.ts.',
      'Export EntuCfg type from this module (or re-export from entuSeasons).',
      '',
      'Field type mapping (per eventFieldEdit.ts:40-49):',
      '- start_date, end_date → { type, date: value }',
      '- start_datetime → { type, datetime: value }',
      '- duration_minutes, capacity → { type, number: value }',
      '- name, location, description, event_type, default_location → { type, string: value }',
      '- conductor, _type, _parent → { type, reference: value }',
      '',
      '## Reference files',
      '- src/lib/sections/sectionActions.ts:80-177 — contract template',
      '- src/lib/events/eventFieldEdit.ts:40-49 — field type mapping',
      '- src/lib/seasons/entuSeasons.ts:26-50 — resolveTypeId'
    ].join('\n'),
    i18nPrompt: null,
    reviewChecklist: [
      '1. Wire shape matches Entu contract: _type as reference (not string), _parent as reference',
      '2. NO _sharing or _inheritrights in any POST body (critical design decision)',
      '3. resolveTypeId called correctly for each entity type',
      '4. Apparent-success trap: guards on missing _id in response',
      '5. POST-before-DELETE not needed here (creates only), but verify no accidental deletes',
      '6. Field types correct: date vs datetime vs number vs string vs reference',
      '7. Optional fields genuinely omitted when absent (not sent as empty string/null)',
      '8. Name-trim validation present',
      '9. fetchImpl injectable seam preserved for testing',
      '10. No regressions in existing tests (pnpm test -- --run && pnpm check)'
    ].join('\n'),
    commitBody: 'T1: Shared entity creation utility for season, event_series, and event types.\nTrusts _inheritrights from org — no explicit _sharing (design decision #132).',
    closesIssue: false
  },

  // ─── T2: Season creation ──────────────────────────────────────────────
  {
    issueNumber: 132,
    taskTag: 'T2',
    branch: 'feat/132-t2-season-creation',
    title: 'Season creation — [+ Season] entry point + inline form + autocomplete',
    commitPrefix: 'feat(#132)',
    skipRed: false,
    redPrompt: [
      'Write failing tests for season creation UI (T2 of #132).',
      '',
      ARCH_CONTEXT,
      '',
      '## What to test',
      '',
      '### 1. Autocomplete component (new — first in codebase)',
      'File: src/lib/components/Autocomplete.spec.ts',
      '',
      'A reusable autocomplete/combobox component. Pattern reference: src/lib/sections/SectionPicker.svelte',
      '(521 lines — listbox a11y, ArrowUp/Down, Escape, outside-click, aria-expanded/haspopup/controls).',
      '',
      'Props: items (searchable list), onSelect callback, placeholder, allowFreeText (boolean)',
      '',
      'Tests:',
      '- Renders input with placeholder',
      '- Typing filters the item list',
      '- ArrowDown/ArrowUp navigates the filtered list',
      '- Enter selects the highlighted item, calls onSelect',
      '- Escape closes the dropdown',
      '- When allowFreeText=true, Enter on non-matching text calls onSelect with the typed text',
      '- When allowFreeText=false, Enter on non-matching text does nothing',
      '- Outside click closes the dropdown',
      '- Accessibility: aria-expanded, aria-haspopup="listbox", role="listbox" on dropdown',
      '',
      '### 2. Season creation form',
      'File: src/routes/page.season-create.spec.ts',
      '',
      'Test against the actual +page.svelte (agenda route) — integration tests.',
      '',
      '- [+ Season] button renders when user has admin rights AND no upcoming season exists',
      '- [+ Season] button does NOT render for non-admin users',
      '- Clicking [+ Season] shows inline creation form (not a separate route)',
      '- Form has fields: name (text), start date (date), end date (date), conductors (autocomplete)',
      '- Conductor autocomplete searches collective persons',
      '- Submit calls createSeason with correct params',
      '- Submit includes parent = org id (from resolveMyOrgId)',
      '- Form closes after successful creation and refreshes the agenda',
      '- Cancel/Escape dismisses the form without creating',
      '- Form validation: name required, end date >= start date',
      '',
      '## Reference files',
      '- src/lib/sections/SectionPicker.svelte — listbox a11y pattern to follow',
      '- src/routes/roster/+page.svelte:712-800 — page-level "+ New X" form precedent',
      '- src/routes/+page.svelte:284-292 — rights gating (manageRightsFrom)',
      '- src/lib/org/myOrg.ts:51-93 — resolveMyOrgId for parent'
    ].join('\n'),
    greenPrompt: [
      'Implement season creation UI (T2 of #132).',
      '',
      ARCH_CONTEXT,
      '',
      '## What to implement',
      '',
      '### 1. Autocomplete component',
      'File: src/lib/components/Autocomplete.svelte',
      '',
      'Reusable combobox based on SectionPicker.svelte patterns (read it first):',
      '- Input with aria-expanded, aria-haspopup="listbox", aria-controls',
      '- Dropdown with role="listbox", authored accessible name',
      '- ArrowDown/ArrowUp navigation (clamped both ends)',
      '- Escape closes dropdown (restores focus to input)',
      '- Outside-click closes (with !target.isConnected guard from SectionPicker)',
      '- Text filtering of items',
      '- allowFreeText prop: when true, Enter on non-matching text emits the typed text',
      '- Props via $props(): items, onSelect, placeholder, allowFreeText, label (for a11y)',
      '',
      '### 2. Season creation form on agenda',
      'Wire into src/routes/+page.svelte:',
      '',
      'Follow the roster/+page.svelte:712-800 pattern (page-level "+ New X" form):',
      '- State: seasonCreateOpen, seasonCreateName, seasonCreateStartDate, seasonCreateEndDate, seasonCreateConductors, seasonCreateStatus, seasonCreateError',
      '- [+ Season] button in the agenda, rights-gated: visible when seasonManageRights === "editor"',
      '  AND no upcoming season exists (or always visible — check design sketch A)',
      '- Clicking opens inline form (replaces button area)',
      '- Conductor field uses the Autocomplete component (items = collective persons)',
      '- Submit: calls createSeason from src/lib/entity/entityCreate.ts',
      '  Parent = org id from resolveMyOrgId(cfg, personId)',
      '- On success: close form, refresh agenda (call loadFullAgenda again)',
      '- On error: show error message, keep form open',
      '- Cancel button / Escape: close form without side effects',
      '',
      '### 3. Person search for conductor autocomplete',
      'File: src/lib/persons/personSearch.ts (or find existing person list utility)',
      'Need a function to search collective persons for the conductor autocomplete.',
      'Check if listMembers or similar exists already; if not, create a simple search.',
      '',
      '## Reference files',
      '- src/lib/sections/SectionPicker.svelte — a11y patterns',
      '- src/routes/roster/+page.svelte:712-800 — page-level form pattern',
      '- src/routes/+page.svelte:270-310 — where new state/load calls slot in',
      '- src/lib/entity/entityCreate.ts — createSeason (from T1)'
    ].join('\n'),
    i18nPrompt: [
      'Add i18n strings for season creation UI (T2 of #132).',
      '',
      'Files: messages/{en,et,lv,uk}.json',
      '',
      'Check what message keys the GREEN phase implementation uses (read the component code).',
      'Expected keys (verify against actual implementation):',
      '- Season creation button label ("+ Season" / "+ Hooaeg" / "+ Sezona" / "+ Сезон")',
      '- Form field labels: Name, Start date, End date, Conductors',
      '- Form buttons: Create, Cancel',
      '- Validation messages: Name required, End date must be after start date',
      '- Success/error messages',
      '- Autocomplete placeholder for conductor search',
      '',
      'Apply linguistically correct translations for all 4 locales.',
      'Estonian and Latvian have specific musical terminology — use domain-appropriate words.',
      '',
      'Verify: pnpm check — 0 type errors (Paraglide compilation).'
    ].join('\n'),
    reviewChecklist: [
      '1. Autocomplete component is truly reusable (no season-specific logic baked in)',
      '2. Accessibility: aria-expanded, aria-haspopup, role="listbox", keyboard navigation complete',
      '3. Rights gating fail-closed: [+ Season] invisible to non-editors, not just disabled',
      '4. createSeason called with correct args (org from resolveMyOrgId, not hardcoded)',
      '5. No _sharing or _inheritrights in the create call',
      '6. Form validation present and user-friendly',
      '7. Svelte 5 runes throughout, no legacy syntax',
      '8. Mobile responsive (no horizontal scroll)',
      '9. i18n strings present for all 4 locales, domain-appropriate',
      '10. Conductor autocomplete reusable for T4 (event creation) without modification',
      '11. No N+1 fetches (person list loaded once, filtered client-side)',
      '12. SectionPicker a11y patterns correctly adapted (not just copied)'
    ].join('\n'),
    commitBody: 'T2: Season creation — [+ Season] on agenda, inline form with conductor autocomplete.\nIntroduces reusable Autocomplete component (first combobox in the app).',
    closesIssue: false
  },

  // ─── T3: Season management page ──────────────────────────────────────
  {
    issueNumber: 132,
    taskTag: 'T3',
    branch: 'feat/132-t3-season-management',
    title: 'Season management — gear icon + edit fields + list series/events',
    commitPrefix: 'feat(#132)',
    skipRed: false,
    redPrompt: [
      'Write failing tests for season management UI (T3 of #132).',
      '',
      ARCH_CONTEXT,
      '',
      '## What to test',
      '',
      'File: src/routes/page.season-manage.spec.ts',
      '',
      'Test against the actual +page.svelte (agenda route) — integration tests.',
      '',
      '### Season management entry point',
      '- [⚙] gear icon renders on the season header when user has editor rights',
      '- [⚙] does NOT render for non-editor users',
      '- Clicking [⚙] opens a season management panel/drawer (inline, not a separate route)',
      '',
      '### Season field editing',
      '- Season name is editable (click to edit, enter to save)',
      '- Start date is editable',
      '- End date is editable',
      '- Conductors are editable (add/remove via autocomplete)',
      '- Saving a field uses replace semantics (GET old → POST new → DELETE old)',
      '- Changes are reflected immediately after save',
      '',
      '### Event series listing',
      '- Lists all event series in the season',
      '- Each series shows name and event count',
      '- [+ Series] button present for editors (entry point for T5)',
      '',
      '### Standalone events listing',
      '- Lists events that are direct children of the season (not via a series)',
      '- [+ Event] button present for editors (entry point for T4)',
      '',
      '### Close/navigation',
      '- Close button / Escape dismisses the management panel',
      '- Changes persist after closing and reopening',
      '',
      '## Data loading',
      'Need functions to list event series and events for a season:',
      '- listEventSeriesForSeason(cfg, seasonId, fetchImpl) → series with event counts',
      '- listEventsForSeason(cfg, seasonId, fetchImpl) → standalone events (not in a series)',
      '',
      '## Reference files',
      '- src/lib/events/eventFieldEdit.ts — replace choreography for field editing',
      '- src/routes/event/[id]/+page.svelte — existing per-field edit UX pattern',
      '- src/routes/+page.svelte:284-292 — rights gating',
      '- Design sketch B: season management layout'
    ].join('\n'),
    greenPrompt: [
      'Implement season management UI (T3 of #132).',
      '',
      ARCH_CONTEXT,
      '',
      '## What to implement',
      '',
      '### 1. Data functions',
      'File: src/lib/seasons/seasonManage.ts (or extend existing entuSeasons.ts)',
      '',
      '- listEventSeriesForSeason(cfg, seasonId, fetchImpl):',
      '  GET entity?_type.string=event_series&_parent.reference={seasonId}&props=name,duration_minutes,default_location,description,_owner,_editor',
      '  For each series: count events via GET entity?_type.string=event&_parent.reference={seriesId}&props=_id&limit=0 (or use a formula if available)',
      '',
      '- listStandaloneEventsForSeason(cfg, seasonId, fetchImpl):',
      '  GET all events under this season, filter to those whose _parent is the season (not a series)',
      '',
      '- updateSeasonField(cfg, seasonId, field, value, fetchImpl):',
      '  Replace semantics: GET old value _ids → POST new → DELETE old',
      '  Follow eventFieldEdit.ts pattern',
      '',
      '### 2. Season management panel',
      'Add to src/routes/+page.svelte (or a new component rendered from it):',
      '',
      '- [⚙] gear icon on the season header, rights-gated (seasonManageRights === "editor")',
      '- Management panel (inline drawer/modal — not a separate route, per design decision)',
      '- Editable season fields: name (inline edit), start_date (date picker), end_date (date picker), conductors (autocomplete from T2)',
      '- Event series section: list with name + event count + [+ Series] button (button present, wired in T5)',
      '- Standalone events section: list with name + date + [+ Event] button (button present, wired in T4)',
      '- Close button + Escape to dismiss',
      '',
      '### 3. Field editing UX',
      'Follow event/[id]/+page.svelte inline edit pattern:',
      '- Click field value to enter edit mode',
      '- Enter/blur to save (replace semantics)',
      '- Escape to cancel edit',
      '- Loading state during save',
      '',
      '## Reference files',
      '- src/lib/events/eventFieldEdit.ts — replace choreography',
      '- src/routes/event/[id]/+page.svelte — inline edit UX',
      '- src/lib/components/Autocomplete.svelte — conductor editing (from T2)',
      '- Design sketch B: season management layout'
    ].join('\n'),
    i18nPrompt: [
      'Add i18n strings for season management UI (T3 of #132).',
      '',
      'Files: messages/{en,et,lv,uk}.json',
      '',
      'Check what message keys the GREEN phase implementation uses (read the code).',
      'Expected keys (verify against actual):',
      '- Season management title/header',
      '- Field labels: Name, Start date, End date, Conductors',
      '- Section headers: Event series, Standalone events',
      '- Buttons: + Series, + Event, Close, Edit, Save, Cancel',
      '- Empty states: "No event series yet", "No standalone events yet"',
      '- Event count labels ("{count} events" — use ICU plural syntax)',
      '',
      'Apply linguistically correct translations for all 4 locales.',
      'Verify: pnpm check — 0 type errors.'
    ].join('\n'),
    reviewChecklist: [
      '1. Replace semantics correct: GET old → POST new → DELETE old (POST-before-DELETE)',
      '2. No N+1: series event counts are not individual fetches per series',
      '3. Rights gating fail-closed on [⚙] gear icon',
      '4. Panel is inline (not a separate route) per design decision',
      '5. Conductor editing reuses Autocomplete from T2',
      '6. Field editing UX consistent with event/[id]/+page.svelte pattern',
      '7. [+ Series] and [+ Event] buttons are present but may not yet be functional (wired in T4/T5)',
      '8. Escape/close works correctly, state preserved on reopen',
      '9. Mobile responsive',
      '10. i18n: all strings present, plural forms correct (ICU MessageFormat)'
    ].join('\n'),
    commitBody: 'T3: Season management — gear icon on agenda, inline panel with editable fields,\nevent series listing with counts, standalone event listing.',
    closesIssue: false
  },

  // ─── T4: Event creation ──────────────────────────────────────────────
  {
    issueNumber: 132,
    taskTag: 'T4',
    branch: 'feat/132-t4-event-creation',
    title: 'Event creation — [+ Event] form with type autocomplete + series inheritance preview',
    commitPrefix: 'feat(#132)',
    skipRed: false,
    redPrompt: [
      'Write failing tests for event creation UI (T4 of #132).',
      '',
      ARCH_CONTEXT,
      '',
      '## What to test',
      '',
      'File: src/routes/page.event-create.spec.ts',
      '',
      '### Event creation form',
      '- [+ Event] button on agenda (rights-gated, editor only)',
      '- [+ Event] button in season management panel (from T3)',
      '- Clicking opens inline event creation form',
      '',
      '### Form fields',
      '- Event type: autocomplete from prior event types (query existing events), free text allowed',
      '- Season picker: dropdown of available seasons (pre-filled if opened from a season context)',
      '- Series picker: optional, dropdown of series in selected season',
      '- Name: text input',
      '- Date/time: datetime picker',
      '- Duration: number input (minutes)',
      '- Location: text input',
      '- Description: textarea',
      '- Conductors: autocomplete (reuse from T2)',
      '- Capacity: number input (optional)',
      '',
      '### Series inheritance',
      '- When a series is selected, inherited fields show as placeholders (not values)',
      '- Inherited fields: name, duration_minutes (from series), location (from default_location)',
      '- User can override any inherited field by typing a value',
      '- Clearing an override restores the placeholder',
      '',
      '### Submission',
      '- Submit calls createEvent with correct params',
      '- Parent = series id if series selected, else season id',
      '- eventType set from the type field value',
      '- Only explicitly set fields (not inherited defaults) are sent in the create call',
      '- Success: close form, refresh agenda/management view',
      '- Error: show error, keep form open',
      '',
      '### Event type autocomplete',
      '- Queries existing events to build a list of prior event_type values',
      '- Deduplicates and sorts',
      '- Free text allowed for new types',
      '',
      '## Reference files',
      '- src/lib/entity/entityCreate.ts — createEvent (from T1)',
      '- src/lib/components/Autocomplete.svelte — reusable component (from T2)',
      '- src/lib/seasons/entuSeasons.ts:122-167 — series inheritance merge logic',
      '- Design sketch C: event creation form layout'
    ].join('\n'),
    greenPrompt: [
      'Implement event creation UI (T4 of #132).',
      '',
      ARCH_CONTEXT,
      '',
      '## What to implement',
      '',
      '### 1. Event type list utility',
      'File: src/lib/events/eventTypes.ts',
      '',
      '- listPriorEventTypes(cfg, fetchImpl): query existing events, extract unique event_type values',
      '  GET entity?_type.string=event&props=event_type&limit=500',
      '  Deduplicate, sort alphabetically, return as string[]',
      '',
      '### 2. Event creation form',
      'Wire into src/routes/+page.svelte AND the season management panel (from T3):',
      '',
      '- [+ Event] buttons in both locations, rights-gated',
      '- Inline form with all fields from the tests',
      '- Event type field: Autocomplete with items=prior event types, allowFreeText=true',
      '- Season picker: <select> from available seasons (pre-selected if context provides)',
      '- Series picker: <select> from series in selected season (optional)',
      '- Conductor field: Autocomplete (reuse from T2)',
      '',
      '### 3. Series inheritance preview',
      '- When series selected, load series defaults (name, duration_minutes, default_location)',
      '- Show as placeholder text in the form fields',
      '- User typing overrides the placeholder',
      '- Only send explicitly set values to createEvent (inherited = not sent)',
      '',
      '### 4. Submit handler',
      '- Determine parent: series id if selected, else season id',
      '- Call createEvent from src/lib/entity/entityCreate.ts',
      '- Only include fields the user explicitly set (not inherited placeholders)',
      '- On success: close form, trigger agenda/management refresh',
      '- On error: display error, keep form open',
      '',
      '## Reference files',
      '- src/lib/entity/entityCreate.ts — createEvent',
      '- src/lib/components/Autocomplete.svelte — reuse for event type + conductor',
      '- src/lib/seasons/entuSeasons.ts:122-167 — series inheritance for understanding defaults',
      '- src/routes/roster/+page.svelte:712-800 — page-level form pattern',
      '- Design sketch C: event creation form layout'
    ].join('\n'),
    i18nPrompt: [
      'Add i18n strings for event creation UI (T4 of #132).',
      '',
      'Files: messages/{en,et,lv,uk}.json',
      '',
      'Check what message keys the GREEN phase implementation uses (read the code).',
      'Expected keys (verify against actual):',
      '- Button: + Event',
      '- Form title: Create event / New event',
      '- Field labels: Type, Season, Series (optional), Name, Date/time, Duration, Location, Description, Conductors, Capacity',
      '- Duration unit: "minutes"',
      '- Placeholder text for inherited fields: "From series: {value}"',
      '- Series picker: "No series (standalone event)"',
      '- Buttons: Create, Cancel',
      '- Validation: Type required',
      '',
      'Apply linguistically correct translations for all 4 locales.',
      'Verify: pnpm check — 0 type errors.'
    ].join('\n'),
    reviewChecklist: [
      '1. Event type autocomplete: deduplicates, sorts, allows free text',
      '2. Series inheritance: inherited values shown as placeholders, not committed values',
      '3. Only explicitly set fields sent to createEvent (not inherited defaults)',
      '4. Parent resolution: series id when series selected, season id otherwise',
      '5. Autocomplete reused from T2 without modification',
      '6. Rights gating fail-closed on [+ Event] buttons',
      '7. Form works from both entry points (agenda and season management)',
      '8. No _sharing or _inheritrights in the create call',
      '9. Mobile responsive',
      '10. i18n complete for all 4 locales'
    ].join('\n'),
    commitBody: 'T4: Event creation — [+ Event] from agenda and season management,\ntype autocomplete, series inheritance preview, conductor autocomplete.',
    closesIssue: false
  },

  // ─── T5: Event series creation + bulk generator ──────────────────────
  {
    issueNumber: 132,
    taskTag: 'T5',
    branch: 'feat/132-t5-series-bulk-generator',
    title: 'Event series creation + bulk event generator',
    commitPrefix: 'feat(#132)',
    skipRed: false,
    redPrompt: [
      'Write failing tests for event series creation + bulk generator (T5 of #132).',
      '',
      ARCH_CONTEXT,
      '',
      '## What to test',
      '',
      '### 1. Recurrence date calculator (pure function)',
      'File: src/lib/events/recurrence.spec.ts',
      '',
      'generateEventDates(params) → Date[]',
      'params: { repeat: "weekly"|"biweekly"|"daily", dayOfWeek: number (0-6), timeOfDay: string (HH:MM), from: string (YYYY-MM-DD), until: string (YYYY-MM-DD), skipDates: string[] (YYYY-MM-DD) }',
      '',
      '- Weekly on Monday from 2026-09-01 to 2026-12-01 → correct count of Mondays',
      '- Biweekly on Wednesday → every other Wednesday',
      '- Daily from Sept 1-7 → 7 dates',
      '- skipDates excludes specific dates from the output',
      '- Empty result when from > until',
      '- Time attached correctly to each generated datetime',
      '- Generates in local timezone (not UTC-shifted)',
      '',
      '### 2. Event series creation form',
      'File: src/routes/page.series-create.spec.ts',
      '',
      '- [+ Series] button in season management panel (rights-gated)',
      '- Inline form with:',
      '  - Name (text)',
      '  - Duration (number, minutes)',
      '  - Default location (text)',
      '  - Description (textarea)',
      '  - Recurrence section (optional):',
      '    - Repeat pattern: weekly / biweekly / daily',
      '    - Day of week picker',
      '    - Time of day',
      '    - From date / Until date (default to season dates)',
      '    - Skip dates (multi-select date picker)',
      '  - Live preview: shows list of generated event dates when recurrence filled',
      '  - Preview updates live as recurrence params change',
      '',
      '### 3. Bulk generation',
      '- Submit without recurrence: creates series only (via createEventSeries)',
      '- Submit with recurrence: creates series, then POSTs each generated event individually',
      '- Events created with series as parent',
      '- Events inherit name/duration/location from series (not explicitly set)',
      '- Only start_datetime and event_type are set on each generated event',
      '- Progress indicator during bulk creation',
      '- Partial failure: if event N fails, events 1..N-1 still exist; error displayed with count',
      '',
      '## Reference files',
      '- src/lib/entity/entityCreate.ts — createEventSeries, createEvent',
      '- Design sketch D: event series creation + recurrence UI'
    ].join('\n'),
    greenPrompt: [
      'Implement event series creation + bulk generator (T5 of #132).',
      '',
      ARCH_CONTEXT,
      '',
      '## What to implement',
      '',
      '### 1. Recurrence date calculator',
      'File: src/lib/events/recurrence.ts',
      '',
      'Pure function: generateEventDates(params) → Date[]',
      '- Generate dates based on repeat pattern (weekly/biweekly/daily)',
      '- Apply dayOfWeek filter for weekly/biweekly',
      '- Attach timeOfDay to each date',
      '- Exclude skipDates',
      '- Sort ascending',
      '',
      '### 2. Series creation form',
      'Wire into season management panel (from T3):',
      '',
      '- [+ Series] button → inline form',
      '- Template fields: name, duration_minutes, default_location, description',
      '- Recurrence section (collapsible/optional):',
      '  - Repeat: <select> weekly/biweekly/daily',
      '  - Day: day-of-week picker (buttons or <select>)',
      '  - Time: time input',
      '  - From/Until: date inputs (default to season start/end dates)',
      '  - Skip dates: date inputs with add/remove',
      '- Live preview: call generateEventDates as params change, show date list',
      '  Use $derived for reactive preview calculation',
      '',
      '### 3. Bulk submit handler',
      '- Without recurrence: createEventSeries only',
      '- With recurrence:',
      '  1. createEventSeries → get seriesId',
      '  2. For each date from generateEventDates:',
      '     createEvent({ name: (omitted — inherits from series), parentId: seriesId,',
      '       eventType: "rehearsal" (or from form), startDatetime: date.toISOString() })',
      '  3. POST individually in serial (not parallel — avoid Entu rate issues)',
      '  4. Track progress: "Creating event 5/38..."',
      '  5. On failure: stop, report which events were created vs failed',
      '- On complete: close form, refresh season management view',
      '',
      '## Reference files',
      '- src/lib/entity/entityCreate.ts — createEventSeries, createEvent',
      '- Season management panel from T3 — where to add the form',
      '- Design sketch D: series creation + recurrence'
    ].join('\n'),
    i18nPrompt: [
      'Add i18n strings for event series creation + bulk generator (T5 of #132).',
      '',
      'Files: messages/{en,et,lv,uk}.json',
      '',
      'Check what message keys the GREEN phase implementation uses (read the code).',
      'Expected keys (verify against actual):',
      '- Button: + Series',
      '- Form title: Create event series',
      '- Template fields: Name, Duration, Default location, Description',
      '- Recurrence section header',
      '- Repeat options: Weekly, Biweekly, Daily',
      '- Day names: Monday, Tuesday, ..., Sunday',
      '- Time label, From/Until labels, Skip dates label',
      '- Preview header: "Preview: {count} events" (ICU plural)',
      '- Progress: "Creating event {current} of {total}" (or similar)',
      '- Buttons: Create, Create with events, Cancel',
      '- Error: "Failed after creating {count} of {total} events"',
      '',
      'Day names must be in the correct language. Use ICU plural where counts appear.',
      'Verify: pnpm check — 0 type errors.'
    ].join('\n'),
    reviewChecklist: [
      '1. Recurrence calculator is a pure function with no side effects (easily testable)',
      '2. Date generation handles timezone correctly (local dates, not UTC-shifted)',
      '3. Bulk creation is serial (not parallel) to avoid Entu rate/ordering issues',
      '4. Partial failure handled: report what was created before the failure',
      '5. Progress indicator during bulk creation',
      '6. Generated events only set start_datetime + event_type (inherit rest from series)',
      '7. No _sharing or _inheritrights in any create call',
      '8. Live preview uses $derived (reactive, no manual trigger)',
      '9. Skip dates work correctly (excluded from generated list)',
      '10. Default from/until dates come from the season',
      '11. Mobile responsive (recurrence section may need special attention)',
      '12. i18n: day names, plural forms, progress messages'
    ].join('\n'),
    commitBody: 'T5: Event series creation with defaults template + bulk event generator.\nRecurrence patterns (weekly/biweekly/daily) with skip dates and live preview.\nApp-side serial POST loop for generated events.',
    closesIssue: false
  },

  // ─── T6: Agenda admin controls ───────────────────────────────────────
  {
    issueNumber: 132,
    taskTag: 'T6',
    branch: 'feat/132-t6-agenda-admin-controls',
    title: 'Agenda admin controls — wire entry points + rights-gate + mobile',
    commitPrefix: 'feat(#132)',
    skipRed: false,
    redPrompt: [
      'Write failing tests for agenda admin controls wiring (T6 of #132).',
      '',
      ARCH_CONTEXT,
      '',
      '## What to test',
      '',
      'File: src/routes/page.agenda-admin.spec.ts',
      '',
      'This is the final wiring and consistency pass. T2-T5 added the individual features;',
      'T6 verifies they are all correctly wired into the agenda.',
      '',
      '### Entry point consistency',
      '- [⚙] gear on season header → opens season management (from T3)',
      '- [+ Event] on agenda → opens event creation form (from T4)',
      '- [+ Season] on agenda → opens season creation form (from T2)',
      '- All three are rights-gated: visible ONLY when seasonManageRights === "editor"',
      '- None visible for non-editor users',
      '',
      '### Rights-gate fail-closed verification',
      '- Simulate: user with no rights → all admin controls absent from DOM (not just hidden/disabled)',
      '- Simulate: user with editor rights → all admin controls present',
      '- Simulate: rights load error → admin controls absent (fail-closed, never fail-open)',
      '',
      '### Mobile responsiveness',
      '- All forms render without horizontal scroll at 375px viewport width',
      '- Touch targets are at least 44x44px',
      '- Inline forms don\'t overflow their container',
      '',
      '### State management',
      '- Only one creation form open at a time (opening [+ Event] closes [+ Season] if open, etc.)',
      '- Season management panel and creation forms coexist correctly',
      '- Agenda refreshes after any successful creation (season, series, or event)',
      '',
      '## Reference files',
      '- src/routes/+page.svelte — all admin controls live here',
      '- src/routes/+page.svelte:284-292 — existing rights gating',
      '- Design sketch A: agenda with admin entry points'
    ].join('\n'),
    greenPrompt: [
      'Final wiring pass for agenda admin controls (T6 of #132).',
      '',
      ARCH_CONTEXT,
      '',
      '## What to implement',
      '',
      'This is a consistency + polish pass, not a new feature. T2-T5 built everything;',
      'T6 makes sure it is correctly integrated.',
      '',
      '### 1. Entry point audit',
      'Read src/routes/+page.svelte and verify:',
      '- [⚙] gear icon on season header: present, rights-gated, opens management panel',
      '- [+ Event] button on agenda: present, rights-gated, opens event creation form',
      '- [+ Season] button: present, rights-gated, opens season creation form',
      '- If any entry point is missing or incorrectly gated, wire it now',
      '',
      '### 2. Mutual exclusion',
      '- Only one creation form open at a time',
      '- Opening a new form closes any open form',
      '- Season management panel can coexist with forms (it is a panel, not a form)',
      '',
      '### 3. Refresh coordination',
      '- After any successful creation: trigger loadFullAgenda() to refresh the agenda',
      '- If season management is open: also refresh its event/series lists',
      '',
      '### 4. Mobile fixes',
      '- Check all forms at 375px viewport width',
      '- Fix any overflow or touch target issues',
      '- Ensure forms collapse/stack correctly on small screens',
      '',
      '### 5. Accessibility audit',
      '- All interactive elements have proper ARIA attributes',
      '- Focus management: opening a form focuses the first field; closing returns focus to the trigger',
      '- Keyboard navigation works throughout (Tab, Enter, Escape)',
      '',
      '## Reference files',
      '- All T2-T5 implementation files',
      '- src/routes/roster/+page.svelte — rights-gated controls reference',
      '- Design sketch A: expected entry point layout'
    ].join('\n'),
    i18nPrompt: [
      'Final i18n consistency check for epic #132.',
      '',
      'Read ALL message files: messages/{en,et,lv,uk}.json',
      'Read ALL new/modified .svelte and .ts files from the T2-T5 branches.',
      '',
      'Check for:',
      '1. Any m.* calls that reference keys not present in all 4 locale files',
      '2. Any hardcoded user-facing strings that should be i18n keys',
      '3. Pluralization keys using ICU MessageFormat where counts appear',
      '4. Consistent terminology across all #132 strings (e.g., "series" vs "event series")',
      '',
      'Fix any gaps found. Verify: pnpm check — 0 type errors.'
    ].join('\n'),
    reviewChecklist: [
      '1. All three entry points present, correctly rights-gated, fail-closed',
      '2. Mutual exclusion: only one form open at a time',
      '3. Refresh coordination: agenda refreshes after any creation',
      '4. Mobile: no horizontal scroll at 375px, touch targets >= 44x44px',
      '5. Accessibility: ARIA attributes, focus management, keyboard navigation',
      '6. No hardcoded user-facing strings (all through i18n)',
      '7. No _sharing or _inheritrights anywhere in #132 code',
      '8. No N+1 fetch patterns introduced across T2-T5',
      '9. State management clean: no stale state after form close/reopen',
      '10. ALL tests pass: pnpm test -- --run && pnpm check',
      '11. Epic #132 acceptance criteria fully met'
    ].join('\n'),
    commitBody: 'T6: Final wiring — agenda admin controls, rights-gate consistency,\nmutual exclusion, refresh coordination, mobile + a11y polish.\n\nCloses #132',
    closesIssue: true
  }
]

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
    log('RED: ' + taskLabel)

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
    log('GREEN: ' + taskLabel)

    const green = await agent(
      task.greenPrompt + '\n\nWORKING DIRECTORY: ' + REPO + '\nBRANCH: ' + task.branch + ' (already checked out from RED)\n\nVerification:\n1. cd ' + REPO + ' && pnpm test -- --run — ALL pass\n2. cd ' + REPO + ' && pnpm check — 0 type errors\n\nGit: git add -A && git commit -m "' + task.commitPrefix + '/' + task.taskTag + ': ' + task.title + '"',
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
    log('I18N: ' + taskLabel)

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
  log('INTEGRATION: ' + taskLabel)

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
        log('INTEGRATION found wiring gaps for ' + taskLabel + ', fixing')
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
  log('REVIEW: ' + taskLabel)

  let verdict = null
  let reviewAttempts = 0

  while ((!verdict || verdict.verdict !== 'GREEN') && reviewAttempts < 3) {
    reviewAttempts++

    verdict = await agent(
      'You are Bentham, architecture reviewer for mvox-dev. Review branch ' + task.branch + ' for ' + taskLabel + '.\n\nWORKING DIRECTORY: ' + REPO + '\n\n' + ARCH_CONTEXT + '\n\n## Review checklist\n' + task.reviewChecklist + '\n\nProcedure:\n1. cd ' + REPO + ' && git diff main...HEAD --stat\n2. Read all changed files\n3. Run: pnpm test -- --run && pnpm check\n4. Issue GREEN / YELLOW / RED verdict\n\nFor non-GREEN: list findings with description, fixShape (recommended fix), and blockerType (code/data/config).',
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
        log('Review ' + verdict.verdict + ' for ' + taskLabel + ', fixing (attempt ' + reviewAttempts + ')')
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
  var reviewMsg = sliceLabel + ' REVIEW: ' + taskLabel + ' — verdict ' + verdict.verdict + '. ' + verdict.summary
  await agent(
    'Send a progress report to gama@po-team via the comms MCP tool.\n\nStep 1: Use ToolSearch with query "select:mcp__comms__send" to load the tool schema.\nStep 2: Call mcp__comms__send with to="gama@po-team" and message="' + escapeForPrompt(reviewMsg) + '"\n\nReturn sent=true after sending.',
    { label: 'report-review-' + task.taskTag, phase: 'REPORT', schema: REPORT_SCHEMA, model: 'claude-sonnet-5[1m]', effort: 'low' }
  )

  // ── MERGE ──────────────────────────────────────────────────────────────
  phase('MERGE')
  log('MERGE: ' + taskLabel)

  var closesTag = task.closesIssue ? '\nCloses #' + task.issueNumber : ''
  var mergeCmd = 'cd ' + REPO + ' && git checkout main && git pull && git merge --squash ' + task.branch + ' && git commit -m "$(cat <<\'COMMITEOF\'\n' + task.commitPrefix + '/' + task.taskTag + ': ' + task.title + '\n\n' + task.commitBody + closesTag + '\n\n' + CO_AUTHOR + '\nCOMMITEOF\n)" && git push && git branch -d ' + task.branch + ' && git push origin --delete ' + task.branch + ' 2>/dev/null || true'

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
log('Epic #132 pipeline complete: ' + results.length + ' slices merged. Sending retrospective to Gama.')

var completedList = results.map(function(r) {
  return '- ' + r.taskTag + ': ' + r.title + ' (review: ' + r.reviewVerdict + ', attempts: ' + r.reviewAttempts + ', sha: ' + (r.commitSha || 'unknown') + ')'
}).join('\n')

var retroMsg = '## Epic #132 Pipeline Retrospective\n\n### Completed slices\n' + completedList + '\n\n### Pipeline shape\n6 serial slices (T1–T6). Each slice: RED → GREEN → I18N (where applicable) → INTEGRATION → REVIEW (with FIX loop) → MERGE. Verdict-triggered Gama reporting after REVIEW and MERGE phases.\n\n### Design decisions exercised\n- Trust _inheritrights from org (no explicit _sharing) — first time deviating from the existing create pattern\n- Autocomplete component (new to codebase) — introduced in T2, reused in T4\n- Bulk event generator (T5) — app-side serial POST loop\n- All forms inline (no dedicated routes)\n\n### Questions for retro\n1. Did the _inheritrights-only approach work as expected? Any issues observed?\n2. Reporting cadence — was post-REVIEW + post-MERGE the right granularity for a 6-slice epic?\n3. Autocomplete component: ready to graduate to a shared library, or needs iteration?\n4. Bulk generator: serial POSTs acceptable, or should we consider batching for large recurrences?\n5. Any acceptance criteria not fully met?\n\nWaiting for your observations.\n\n(*MVOX:Palestrina*)'

await agent(
  'Send a retrospective message to gama@po-team via the comms MCP tool.\n\nStep 1: Use ToolSearch with query "select:mcp__comms__send" to load the tool schema.\nStep 2: Call mcp__comms__send with to="gama@po-team" and the following message (send verbatim, preserving all newlines and formatting):\n\n' + retroMsg + '\n\nReturn sent=true after sending.',
  { label: 'retro-gama', phase: 'RETRO', schema: REPORT_SCHEMA, model: 'claude-sonnet-5[1m]', effort: 'low' }
)

log('Retrospective sent. Epic #132 pipeline done.')
return { success: true, results: results }
