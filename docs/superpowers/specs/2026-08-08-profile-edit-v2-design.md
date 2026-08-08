# Design Spec: Profile Edit v2 — One Input Per Property, Visibility Picker as Save Surface

**Issue:** [#35](https://github.com/mvox-dev/mvox-app/issues/35)
**Spec author:** Mihkel (verbatim PO session, 2026-08-07); design by Palestrina
**Status:** Ready (PO comment 2026-08-07, sequenced after #40)

---

## Summary

Replace the three per-level `ProfileLevelCard` forms with a single input per property (name, email). Each input sits alongside its visibility picker (the T4.7 three-icon control, evolved). Saves are event-driven (autosave), and save feedback renders on the currently selected visibility button. The underlying entity model, create/move paths, and queues are unchanged — the redesign is a UI-layer collapse that simplifies the member's mental model from "fill three cards" to "fill two fields, pick who sees them."

---

## Component changes

### DELETED: `ProfileLevelCard.svelte`

The three per-level cards are removed entirely. Their per-level name/email inputs and manual Save button are superseded by the new `ProfileField` component.

### NEW: `ProfileField.svelte`

One instance per property (name, email). Each `ProfileField` contains:

1. **A single text input** for the property value (bound to the unified draft).
2. **An integrated visibility picker** — the three-icon row (private / collective / public), evolved from `VisibilityFieldRow`. The active icon indicates which entity currently holds the value (narrowest non-empty holder, or `domain` default when unset).
3. **Autosave behavior** — the component owns its idle timer and blur handler, delegating actual writes to the autosave module (see below).
4. **Save feedback on the active visibility button** — while a save is in flight, the active button shows disabled + "Saving" text; on server confirmation it returns to its normal active state. This is the only save-status indicator (no separate status line, no manual Save button).
5. **Name-private guard (name field only)** — the private icon is visually inactive/disabled and its click handler is a no-op.

Props (sketch):
```
field: FieldKey              // 'name' | 'email'
value: string                // bound draft value
activeLevel: Level           // the level currently holding this field
transportLevel: Level | null // in-flight move target (spinner)
leakLevels: Level[]          // interrupted-move wider holders
saving: boolean              // autosave in flight → active button disabled + "Saving"
movable: boolean             // exactly one holder
conflict: boolean            // distinct values at ≥2 levels
conflictLevels: Level[]
disabled: boolean            // cross-queue write lock
moveFailed: boolean
saveFailed: boolean
onvisibilitychange: (field, toLevel) => void
onvaluechange: (field, value) => void
onblur: (field) => void
```

### ABSORBED: `VisibilityFieldRow.svelte`

Its three-icon picker logic moves into `ProfileField`. The separate file is deleted. The icon states (`active`, `transport`, `leak`, `conflict`, `inactive`) carry over unchanged. Two additions:

- **Save feedback on the active button:** when `saving` is true, the active button gets `disabled` + its label changes to `m.profile_saving()` (or a new key — team's call per Mihkel's "or whats better" delegation). On server confirm, it returns to normal.
- **Name-private inactive:** for the name field, the private button is permanently `disabled` with reduced opacity, regardless of state. Click handler is a no-op.

### UNCHANGED: `VisibilityRepairBanner.svelte`

The privacy-repair banner for interrupted moves remains as-is. It renders above the `ProfileField` components, same as today.

---

## Data model changes in `+page.svelte`

### Draft simplification

**Before (v1):** `draft: Record<Level, { name: string; email: string }>` — three copies of each field.

**After (v2):** `draft: { name: string; email: string }` — one value per field.

The member sees and edits one name, one email. Which entity holds the value is placement mechanics managed by `activeLevel`.

### Active level per field

```ts
const activeLevelFor = (f: FieldKey): Level =>
  resolveField(loadedProfiles, f).holders[0]?.level ?? 'domain';
```

When no entity holds the field, the default is `domain` (Mihkel's ruling). When she types into an unset field and autosave fires, the save targets the domain entity (lazy-creating it if needed, through the sole create path).

### Confirmed state

Stays per-entity (`Record<Level, { id: string | null; name: string; email: string }>`). The edit queue and move queue write to specific entities — confirmed state must track each entity's server-acknowledged value for round-trip honesty. Only the DRAFT is unified; the backend model is not.

### isDirty

```ts
const isDirty = (field: FieldKey): boolean => {
  const level = activeLevelFor(field);
  return draft[field] !== confirmed[level][field];
};
```

A field is dirty when its unified draft value differs from the confirmed value at its active level.

### Load → draft assignment

`loadForSelected()` populates the unified draft from the resolved field values:

```ts
const nameRes = resolveField(profiles, 'name');
const emailRes = resolveField(profiles, 'email');
nextDraft = {
  name: nameRes.value,    // narrowest non-empty holder's value
  email: emailRes.value
};
```

The #39 prefill composes unchanged: if `nextDraft.name === ''` and no domain entity exists, prefill from `getUser()?.name`.

---

## Autosave module: `src/lib/profile/autosave.ts`

A standalone, framework-agnostic module (no Svelte imports) for testability. Manages per-field idle timers and exposes a thin API consumed by `ProfileField` / `+page.svelte`.

### Interface

```ts
interface AutosaveConfig {
  idleMs: number;           // 120_000 (2 minutes)
  onSave: (field: FieldKey) => void;
}

interface AutosaveController {
  /** Called on every keystroke — resets the idle timer for this field. */
  keystroke(field: FieldKey): void;
  /** Called on input blur — fires save immediately if dirty. */
  blur(field: FieldKey): void;
  /** Called on visibility change — fires save immediately if dirty,
   *  THEN delegates the move to the caller. */
  visibilityChange(field: FieldKey): void;
  /** Tear down all timers (collective switch / unmount). */
  destroy(): void;
}

function createAutosave(config: AutosaveConfig): AutosaveController;
```

### Trigger semantics

Three autosave triggers, exactly as specified:

1. **Typing idle 2 minutes** — `keystroke()` resets a per-field `setTimeout(idleMs)`. When the timer fires, `onSave(field)` is called. The timer is cleared on blur or visibility change (they fire the save themselves).

2. **Blur** — `blur()` fires `onSave(field)` immediately if the field is dirty. Clears the idle timer (no double-fire).

3. **Visibility change** — `visibilityChange()` fires `onSave(field)` immediately if the field is dirty, THEN returns so the caller can proceed with the move. The save must settle before the move dispatches (the cross-queue write lock ensures this — see Interactions below).

### What `onSave` does (in `+page.svelte`)

The `onSave` callback is the page's save dispatcher. It:

1. Checks `isDirty(field)` — if not dirty, no-op.
2. Resolves the active level for the field.
3. Builds the fields payload: the dirty field's value comes from the unified draft; the **sibling field's value comes from `confirmed[activeLevel][sibling]`** (the target entity's own confirmed value), NEVER from the unified draft. The unified draft resolves each field from its own narrowest holder — if the sibling lives at a different (potentially private) level, using `draft[sibling]` would write a foreign-tier value onto this entity, a privacy leak.
4. Dispatches through the existing `queue.request()` with `{ level: activeLevel, existingId: confirmed[activeLevel].id, fields }`.

```ts
const activeLevel = activeLevelFor(field);
const sibling = field === 'name' ? 'email' : 'name';
const fields = {
  [field]: draft[field],
  [sibling]: confirmed[activeLevel][sibling]  // target entity's own value, not the unified draft
};
queue.request({ cfg, personId, level: activeLevel, existingId: confirmed[activeLevel].id, fields });
```

The save always writes the FULL pair (name + email) to the active entity, same as today. **The sibling is pinned to the target entity's confirmed value to prevent cross-tier value leakage.** A dedicated test asserts this: a name autosave while email lives on a different (private) entity must NOT copy the private email onto the domain entity.

### Dirty guard placement

The `onSave` callback checks dirtiness, not the autosave module. The module fires on every qualifying event; the callback decides whether the fire is meaningful. This keeps the module stateless with respect to draft/confirmed values.

---

## Save feedback on the active visibility button

When a save is in flight for a field:

- The field's active visibility button (the one with `aria-pressed="true"`) shows:
  - `disabled` attribute set
  - Label text: "Saving" (via `m.profile_saving()` or a new i18n key)
  - `aria-busy="true"`
- All other visibility buttons for this field remain in their current state (inactive/disabled as appropriate).

On server confirmation (the queue's `reconcile` callback):
- The active button returns to normal (`disabled` removed, label restored, `aria-busy` removed).

On failure (the queue's `markFailed` callback):
- The active button returns to normal, and a per-field error line appears below the icons (same position as today's `moveFailed` error).

The button's return to normal is the honest signal — it happens ONLY on server confirmation, never optimistically (standing rule from #15).

---

## Name-private guard

### Frontend

In the name field's `ProfileField`, the private visibility button is rendered with:
- `disabled` attribute (always, regardless of field state)
- Reduced opacity (`opacity-50`)
- No click handler fires
- `aria-label` indicating the restriction (new i18n key, e.g. `m.profile_name_private_disabled()`)

### Code guard

A guard in the save/move dispatch path that rejects name → private. Per Mihkel's standing rule: an impossible state gets a **loud failure**, never a silent no-op — a silent `return` would discard every name edit indefinitely if the state arose, with no signal.

**In `onSave` (the autosave callback):**
```ts
if (field === 'name' && activeLevelFor('name') === 'private') {
  throw new Error('name-private guard: name cannot be saved at private level');
}
```
The thrown error surfaces through the queue's `markFailed` callback → per-field error line. This is a backstop for a by-design-impossible state — the frontend disables the private option for name, so this path should never fire. If it does, the loud failure is the signal.

**In `onmove`:**
```ts
if (field === 'name' && toLevel === 'private') {
  throw new Error('name-private guard: name cannot be moved to private level');
}
```
Same loud backstop for the move path.

Both guards have dedicated test assertions verifying the loud failure (thrown error, not a silent return).

---

## Interactions

### #28 completion gate

Unchanged. The gate keys on domain name presence (`hasDomainName`). The autosave module funnels through the same `queue.request()` → `applyProfileSave` → `assertDomainNameIfCompletion` path. The `refreshCompletionGate()` call in the reconcile callback continues to fire on domain saves.

### #39 prefill

Unchanged. The prefill fires in `loadForSelected()` before draft assignment. The unified draft receives the prefilled name exactly as the per-level draft did. The member's first blur or idle timeout on the prefilled-but-not-yet-saved name triggers an autosave, which creates the domain entity and confirms the name. The forced-confirm pattern (prefill is draft-only until server-confirmed) is preserved.

### Cross-queue write lock

Expanded to cover autosave-in-flight. The existing `writesInFlight` derived:

```ts
const writesInFlight = $derived(busy || pendingLevels.size > 0);
```

continues to gate moves against saves. The autosave module's `visibilityChange()` path:

1. Fires `onSave(field)` if dirty → the save enters the edit queue → `pendingLevels` blocks moves.
2. The move dispatches only after the save settles (the `onmove` handler checks `writesInFlight` and returns if true).

The page orchestrates this: on a visibility click while the field is dirty, the autosave fires the save, and the move re-attempts after the save settles. Implementation options:
- **Option A (simple):** the move click is simply blocked while `writesInFlight` is true. The member clicks the visibility icon again after the save settles (the "Saving" label clears). The autosave already fired on the visibility change, so the save is in flight.
- **Option B (queued):** the page remembers the intended move and dispatches it automatically after the save settles.

**Option A is endorsed (PO).** It's simpler, honest (the member sees the save in flight), and avoids a hidden queued-move state (Option B's remembered move is #15-class optimistic state). The "Saving" feedback on the active button is the signal.

### Navigate-away boundary

A dirty draft that hasn't triggered any of the three events (idle 2 min, blur, visibility change) is lost on navigation. This is **spec-conformant** — the three triggers are exhaustive by Mihkel's word. A fourth trigger (e.g. `beforeunload`) would be his spec change to make if ever wanted, not an implementation courtesy.

### Generation guard

Unchanged. The generation counter increments on every `loadForSelected()` call. Both the edit queue and move queue capture the generation at dispatch and no-op their callbacks if it changed. The autosave module's `destroy()` clears all timers on a collective switch (called from `resetState()`).

### YELLOW-T4.7.1 (unsaved-draft discard on move reload)

Expected to be largely dissolved. In v1, a move triggered a full reload (`loadForSelected()`), which discarded any unsaved draft in the three level cards. In v2:
- The unified draft is one value per field, not per-level.
- A move changes which entity holds the value, but the value itself (and the draft) is the same.
- The reload after a move re-derives the draft from resolved field values, which should match the just-moved value.
- Edge case: the member changed the draft AND clicked a visibility icon. The autosave fires the save first (cross-queue lock), then the move proceeds. After the move's reload, the draft re-derives from the now-confirmed value at the new level.

Verify at review rather than assume — the edge case where the autosave-then-move sequence interleaves with a reload needs a test.

---

## Page layout (v2 ready state)

```
┌──────────────────────────────────────┐
│ Your profile                         │
│ (intro text)                         │
│                                      │
│ [completion banner, if incomplete]   │
│                                      │
│ [repair banners, if any]             │
│                                      │
│ ┌──────────────────────────────────┐ │
│ │ Name                             │ │
│ │ ┌──────────────────────────────┐ │ │
│ │ │ [text input]                 │ │ │
│ │ └──────────────────────────────┘ │ │
│ │ [Private(disabled)] [Collective(●)] [Public(○)] │ │
│ │ (error line if failed)          │ │
│ └──────────────────────────────────┘ │
│                                      │
│ ┌──────────────────────────────────┐ │
│ │ Email                            │ │
│ │ ┌──────────────────────────────┐ │ │
│ │ │ [email input]                │ │ │
│ │ └──────────────────────────────┘ │ │
│ │ [Private(○)] [Collective(●)] [Public(○)] │ │
│ │ (error line if failed)          │ │
│ └──────────────────────────────────┘ │
└──────────────────────────────────────┘
```

The private button on the name field is always dimmed/disabled. The active button (e.g. Collective with ●) shows "Saving" + disabled while a save is in flight.

---

## Files

### Creates
| File | Purpose |
|---|---|
| `src/lib/components/profile/ProfileField.svelte` | One-input-per-property component with integrated visibility picker and autosave hooks |
| `src/lib/profile/autosave.ts` | Standalone timer module: keystroke idle, blur, visibility-change triggers |
| `src/lib/profile/autosave.spec.ts` | Unit tests for the autosave module (timer logic, trigger semantics) |

### Modifies
| File | Change |
|---|---|
| `src/routes/profile/+page.svelte` | Replace `ProfileLevelCard` loop with `ProfileField` x2; simplify draft to `{ name, email }`; wire autosave callbacks; add name-private code guards; remove `canSave`/`onsave`/`isDirty` per-level logic |
| `src/routes/page.profile.spec.ts` | Rewrite to test v2 surface: single inputs, autosave triggers (idle/blur/visibility), save feedback on active button, name-private guard, #39 prefill, cross-queue lock with autosave |
| `messages/{en,et,lv,uk}.json` | Add key for name-private disabled label; autosave-specific feedback if wording diverges from existing `profile_saving`; remove i18n keys for deleted per-level card UI |

### Deletes
| File | Reason |
|---|---|
| `src/lib/components/profile/ProfileLevelCard.svelte` | Superseded by `ProfileField` — no per-level cards in v2 |
| `src/lib/components/profile/VisibilityFieldRow.svelte` | Absorbed into `ProfileField` — the picker is now part of the field component |

### Not changing
| File | Reason |
|---|---|
| `src/lib/profile/profileData.ts` | Types, `resolveField`, `createOwnProfile`, `saveProfileFields`, `listMyProfiles` — all unchanged; v2 consumes them as-is |
| `src/lib/profile/fieldMove.ts` | `applyFieldMove`, `applyDuplicateRepair`, `planLoadedDuplicateRepairs` — unchanged; moves still work the same way |
| `src/lib/profile/profileEditQueue.ts` | Queue orchestrator — unchanged; autosave funnels through `queue.request()` |
| `src/lib/profile/fieldMoveQueue.ts` | Move queue — unchanged; visibility changes still dispatch through `moveQueue.move()` |
| `src/lib/profile/applyProfileSave.ts` | Write dispatcher — unchanged; the save path is the same |
| `src/lib/profile/completionGate.ts` | Gate module — unchanged; `hasDomainName` / `resolveGate` / `assertDomainNamePersisted` all operate on the same entity reads |
| `src/lib/components/profile/VisibilityRepairBanner.svelte` | Privacy-repair banner — unchanged |
| `src/lib/profile/soleCreatePath.spec.ts` | Structural guard — unchanged (no new create paths introduced) |

---

## Done when

- [ ] One input per property with its visibility picker; the three per-level cards are gone.
- [ ] Autosave fires on exactly the three events (typing idle 2 min, blur, visibility change); no other implicit saves; all writes through the existing paths (sole create path for creates, move path for visibility changes).
- [ ] Save feedback on the selected visibility button, server-confirmed before returning to settled state.
- [ ] All fields default to `domain`; `name`'s private option inactive in frontend AND guarded in code, with a test asserting the guard.
- [ ] T4.7 race guards demonstrably cover the new triggers.
- [ ] #39 prefill composes unchanged (prefill → autosave confirms on first blur/idle).
- [ ] YELLOW-T4.7.1 verified at review — unsaved-draft-discard class expected dissolved by autosave.

---

(*MVOX:Palestrina*)
