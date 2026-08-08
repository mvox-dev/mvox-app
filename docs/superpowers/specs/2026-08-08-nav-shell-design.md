# Design Spec: Nav Shell — Three-Breakpoint Responsive Component

**Issue:** [#52](https://github.com/mvox-dev/mvox-app/issues/52) (parent: [#49](https://github.com/mvox-dev/mvox-app/issues/49) — Slice 5, Nav 1.0)
**Spec author:** Palestrina
**Status:** Ready — all four settle-first decisions resolved; Mihkel's corrected shape pick (2026-08-08)
**Reference visuals:** [Byrd's T5.0 artifact](https://claude.ai/code/artifact/fca6b4cf-3e62-4efd-ad5f-1dbd2cd531a6) — Mihkel picked A+C+B across three breakpoints
**User stories:** [Stories-nav wiki](https://github.com/mvox-dev/mvox-app/wiki/Stories-nav)

---

## 1. Summary

Build a persistent navigation shell wrapping the app's page content, connecting five surfaces (Agenda, Roster, Profile, Invite, Collectives) so a member can move between them without knowing URLs. The shell renders in three responsive states driven by CSS breakpoints. Nav visibility is convenience, never a security boundary — the page's own enforcement is unchanged.

---

## 2. Three Responsive States and Breakpoints

| State | Breakpoint | Layout | Nav position | Entry layout |
|---|---|---|---|---|
| **A — Bottom tab bar** | Base (< 640px / `sm`) | Column, nav at bottom | Fixed bottom | Icon above label, stacked vertically |
| **C — Spine rail** | `sm` to `lg` (640px–1023px) | Row, nav at left | Fixed left rail, 4rem wide | Icon above label, folder-tab styling |
| **B — Top bar** | `lg`+ (>= 1024px) | Column, nav at top | Fixed top, 3rem tall | Icon + label side by side, horizontal |

Tailwind v4 breakpoints used: `sm` = 640px, `lg` = 1024px. No custom breakpoints.

**State A — Bottom tab bar (portrait phone):**
- Horizontal row of 3–5 entries, evenly spaced
- Each entry: icon (20px) above label (10px), stacked
- `paper-2` background, `paper-3` top border
- Active entry: `paper` background, `ink` text, `font-medium`
- Position: `order: 1` in flex-column (below content)

**State C — Spine rail (landscape phone / tablet):**
- Vertical column on the left edge, 4rem wide
- Folder-tab styling: active tab has `paper` background with right edge overlapping the rail–content border, creating a physical-folder illusion
- Active tab: rounded left corners, no right border gap, `z-index: 1`
- Inactive tabs: `paper-2` background, muted text
- `paper-3` right border separating rail from content

**State B — Top bar (desktop):**
- Horizontal bar at top, 3rem tall
- Entries in a row: icon (18px) + label (13px) side by side
- `paper-2` background, `paper-3` bottom border
- Active entry: `paper` background, `ink` text
- App name/logo area on the left (future; placeholder space for now)

---

## 3. Entry List

The entry set is a **declarative list** — each entry is a data row with a visibility predicate. Adding a future entry (Library, Programme) is adding a row; the shell renders whatever the list holds.

### Entry type

```ts
export interface NavContext {
  isAdmin: boolean;
  hasMultipleCollectives: boolean;
}

export interface NavEntry {
  key: string;
  label: () => string;     // Paraglide message function, called at render time
  route: string;
  icon: string;            // Inline SVG string
  visible: (ctx: NavContext) => boolean;
}
```

### Entries (Decision 1)

| # | Key | Route | Visible when | Seat |
|---|---|---|---|---|
| 1 | `agenda` | `/` | Always | Member |
| 2 | `roster` | `/roster` | Always | Member |
| 3 | `profile` | `/profile` | Always | Member |
| 4 | `invite` | `/admin/invite` | `ctx.isAdmin` | Admin |
| 5 | `collectives` | `/collectives` | `ctx.hasMultipleCollectives` | Member (>1 collective) |

Icons are inline SVGs using `currentColor` for stroke, no fill, 24x24 viewBox. They inherit the nav entry's text color.

---

## 4. Admin Determination (T5.1)

**Mechanism:** `GET entity?_type.string=organization&props=_owner,_editor&limit=1` via `entuFetch`.

**Logic:**
1. Fetch the first organization entity with `_owner` and `_editor` props
2. `_owner` and `_editor` live in Entu's private bucket — visible only to rights-holders (`utils/aggregate.js:9-17`, `utils/entity.js:569-586`)
3. If the response contains `_owner` or `_editor` arrays AND the authenticated user's `personId` appears in either → **admin**
4. If `_owner`/`_editor` absent or personId not found → **not admin** (determinate, fail-closed)
5. HTTP/network failure → **error** (retryable; NOT collapsed into "not admin" — codebase precedent: `inviteData.ts:92-98`, `marker.ts:34-39`)

**Store shape** (mirrors `completionGateStore` pattern):

```ts
export type AdminState = 'loading' | 'admin' | 'not-admin' | 'error';
export const adminStore: Writable<AdminState>;
export function resetAdmin(): void;
export function resolveAdmin(cfg: EntuCfg, personId: string, fetchImpl?): Promise<AdminState>;
```

**Layout wiring:** reactive `$effect` keyed on `authStore` + `selectedCollectiveStore`, with generation guard against stale resolves (same pattern as the completion gate effect in `+layout.svelte`).

**This is the only new Entu query** in the nav shell — all other state (auth, collectives, completion gate) comes from existing stores.

---

## 5. Completion Gate Interaction (Decision 3)

**Incomplete member:** nav is **visible but locked to `/profile`**.
- All entries render in a disabled visual state (`ink-4` text, `cursor: not-allowed`, no hover effect)
- Clicking any entry navigates to `/profile` (via the link's `href`)
- Exception: the Profile entry is NOT disabled — it shows as active (the user is on `/profile`) and clickable normally
- `aria-disabled="true"` on disabled entries; `tabindex="-1"` to remove from tab order

**Complete member:** nav functions normally. Entries are clickable, active state tracks current route.

**Gate source:** `completionGateStore` from `$lib/profile/completionGate` — the existing app-wide SSOT. NavShell receives `completionLocked: boolean` as a prop (true when gate is `'incomplete'`).

---

## 6. Anonymous State

**Anonymous users get no nav.** The NavShell renders only `{@render children?.()}` — the login surface fills the viewport without any nav chrome. Anonymous is determined by `authStore.status !== 'authenticated'`.

---

## 7. Active State

**Route matching:**
- Root route (`/`): **exact match** — `activeRoute === '/'`
- All other routes: **prefix match** — `activeRoute.startsWith(route)`

This means `/roster` matches `/roster` and any future sub-routes (`/roster/123`). `/admin/invite` matches the full path.

**Visual:** active entry gets `paper` background, `ink` text, `font-medium`. On the spine rail, the active entry additionally gets the folder-tab treatment (paper background overlapping the rail border).

**`aria-current="page"`** is set on the active entry's `<a>` element.

---

## 8. Growth / Overflow

The entry list is designed for growth. Current: 3–5 entries (3 member + 1 admin + 1 conditional switcher). The known upcoming entry is Library (from the lending domain).

**Overflow mechanisms per breakpoint** (not built in this slice — stated growth path per Mihkel's rider):

| State | Overflow mechanism | Threshold |
|---|---|---|
| A (bottom tabs) | "More" tab → bottom sheet with remaining entries | ~5 visible entries |
| B (top bar) | "More" dropdown menu | ~7 visible entries |
| C (spine rail) | Rail absorbs naturally (vertical scroll at extreme count) | ~10+ entries |

The spine rail has the most headroom — it was Mihkel's pick partly for this reason.

---

## 9. Component Architecture

### `NavShell.svelte` — the shell component

**Location:** `src/lib/components/nav/NavShell.svelte`

**Props:**

```ts
{
  entries: NavEntry[];
  activeRoute: string;
  completionLocked?: boolean;   // default false
  anonymous?: boolean;           // default false
  isAdmin?: boolean;             // default false
  hasMultipleCollectives?: boolean; // default false
  children: Snippet;
}
```

**Internal derivations:**
- `ctx: NavContext` — derived from `isAdmin` and `hasMultipleCollectives`
- `visibleEntries` — `entries.filter(e => e.visible(ctx))`
- `isActive(route)` — route matching function
- Per-entry `disabled` — `completionLocked && entry.route !== '/profile'`

**Rendering:**
- `anonymous` or `visibleEntries.length === 0` → render only children (no nav chrome)
- Otherwise → render the shell div with nav + main, styled per breakpoint via CSS media queries

**CSS approach:** component-scoped `<style>` block with three `@media` rules (base, `min-width: 640px and max-width: 1023.98px`, `min-width: 1024px`). Uses CSS custom properties from `app.css` `@theme` (e.g., `var(--color-paper)`, `var(--color-ink-3)`). No Tailwind utility classes in the component — pure scoped CSS for the three-state responsive layout.

### `entries.ts` — the declarative entry list

**Location:** `src/lib/nav/entries.ts`

Exports `NAV_ENTRIES: NavEntry[]` and the `NavEntry`/`NavContext` types. Imports Paraglide message functions for labels. Icons are inline SVG strings.

### `adminStore.ts` — admin determination store

**Location:** `src/lib/nav/adminStore.ts`

Follows the `completionGateStore` pattern: writable store + reset function + async resolve function. The resolve function makes one Entu call and returns the state; the caller (layout) writes to the store under a generation guard.

---

## 10. i18n

Five new message keys, in all four locales:

| Key | en | et | lv | uk |
|---|---|---|---|---|
| `nav_agenda` | Agenda | Päevakord | Darba kārtība | Порядок денний |
| `nav_roster` | Roster | Liikmed | Dalībnieki | Учасники |
| `nav_profile` | Profile | Profiil | Profils | Профіль |
| `nav_invite` | Invite | Kutsu | Uzaicināt | Запросити |
| `nav_collectives` | Collectives | Kollektiivid | Kolektīvi | Колективи |

Labels are called at render time via Paraglide (`m.nav_agenda()` etc.), so they respect the active locale.

---

## 11. a11y

- **`<nav role="navigation" aria-label="Main navigation">`** wraps the entry list
- **`aria-current="page"`** on the active entry's `<a>` element
- **`aria-disabled="true"`** on completion-locked entries (except Profile)
- **`tabindex="-1"`** on disabled entries to remove from keyboard tab order
- **Arrow key navigation** within the nav: ArrowRight/ArrowDown moves to next entry, ArrowLeft/ArrowUp moves to previous (wrapping). Implemented via `keydown` handler on the `<nav>` element
- **Focus management:** entries are `<a>` elements (natively focusable); disabled entries removed from tab sequence but still visible
- Icons carry `aria-hidden="true"` — the label provides the accessible name

---

## 12. Layout Integration

**File:** `src/routes/+layout.svelte`

The existing layout wraps `{@render children?.()}`. After integration:

```svelte
<NavShell
  entries={NAV_ENTRIES}
  activeRoute={page.url.pathname}
  completionLocked={$completionGateStore === 'incomplete'}
  anonymous={$authStore.status !== 'authenticated'}
  isAdmin={$adminStore === 'admin'}
  hasMultipleCollectives={$pickerModeStore === 'picker'}
>
  {@render children?.()}
</NavShell>
```

**New layout effect** (admin determination, mirrors gate effect pattern):

```ts
let adminGen = 0;
$effect(() => {
  const auth = $authStore;
  const selected = $selectedCollectiveStore;
  const g = ++adminGen;
  if (auth.status !== 'authenticated' || !selected) {
    resetAdmin();
    return;
  }
  resetAdmin();
  const cfg = { db: selected.db, token: getToken() ?? '' };
  resolveAdmin(cfg, selected.personId).then((state) => {
    if (g === adminGen) adminStore.set(state);
  });
});
```

---

## 13. File Manifest

### Creates

| File | Purpose |
|---|---|
| `src/lib/nav/entries.ts` | NavEntry/NavContext types + `NAV_ENTRIES` declarative list |
| `src/lib/nav/adminStore.ts` | Admin determination store (writable + resolve) |
| `src/lib/components/nav/NavShell.svelte` | Three-breakpoint responsive nav shell component |
| `src/lib/nav/adminStore.spec.ts` | Admin store unit tests |
| `src/routes/layout.nav-shell.spec.ts` | Layout + NavShell integration tests |

### Modifies

| File | Change |
|---|---|
| `src/routes/+layout.svelte` | Wrap children with NavShell; add admin store effect |
| `messages/en.json` | Add 5 nav_* keys |
| `messages/et.json` | Add 5 nav_* keys |
| `messages/lv.json` | Add 5 nav_* keys |
| `messages/uk.json` | Add 5 nav_* keys |

### Does NOT touch

- Auth stores, completion gate, collective stores — consumed read-only
- Route guards (`guard.ts`, `+layout.ts`) — unchanged
- Individual page components — no modifications
- Rights model — nav visibility is convenience only

---

(*MVOX:Palestrina*)
