# Typography scale

Settled in #151 (review-fix pass). Enforced, as far as it is mechanically
checkable, by `src/typography-scale.spec.ts` and `src/ios-form-zoom.spec.ts`.

## The scale

| Step | px | Role |
|---|---|---|
| `font-display text-2xl` | 24 | Page / entity title (`h1`). Caveat. |
| `font-display text-lg` | 18 | Section heading (`h2`/`h3`) inside a page or panel. Caveat. |
| `text-base` | 16 | **Body adjacent to form controls** — see the 16px rule below. |
| `text-sm` | 14 | Body copy on page-level surfaces (profile, admin, invite, library page chrome). |
| `text-xs` | 12 | Dense surfaces: agenda desk rows, panel internals, field labels, inline errors. |
| `text-[10px]` / `text-[9px]` | 10 / 9 | The **stamp tier** — `font-mono uppercase tracking-wide` chips, badges, event-type pills, timestamps. |
| `text-xl` | 20 | Rare; empty-state and landing display copy. |

`text-3xl` and above are not in use. Adding a step means adding it to
`SANCTIONED_STEPS` in `src/typography-scale.spec.ts` — deliberately, not by
drift.

### `text-sm` vs `text-xs` is surface density, not accident

The split is real and intentional, and it is what #151 flagged as looking
arbitrary. State it plainly:

- **`text-sm`** — the reading tier. Pages whose job is one linear body of
  content: `profile`, `admin`, `invite/[token]`, `auth/login`, the library
  page's own chrome.
- **`text-xs`** — the dense tier. Anything that is a *row in a list of many*,
  or the internals of a panel/popover/form stacked inside another surface: the
  agenda desk (`routes/+page.svelte`), attendance rows, library tree nodes,
  season-manage panel fields.

A page is allowed to hold both — the library page is `text-sm` at the page
level and `text-xs` inside its work/edition/copy tree. What is NOT allowed is
two elements in the **same role on the same kind of surface** carrying
different steps.

## The 16px rule (the #130 interaction)

`src/app.css` sets `input, select, textarea { font-size: 1rem }` so iOS Safari
does not auto-zoom on focus (#130). That rule is a **default**, not a floor:

- It lives inside `@layer base`. Tailwind v4 emits every utility into
  `@layer utilities`, and unlayered CSS beats every layered rule regardless of
  specificity — so authored outside a layer this rule silently ate `text-2xl` /
  `text-lg` on the inline-edit inputs, which is exactly how the event and
  season names came to shrink when you clicked the pencil. Asserted by
  `ios-form-zoom.spec.ts`.
- Because it is only a default, the >=16px guarantee rides on the companion
  rule: **no `input`/`select`/`textarea` may carry `text-xs`, `text-sm`, or an
  arbitrary `text-[Npx]` below 16px.** Also asserted by `ios-form-zoom.spec.ts`.

Consequence for display text:

> **Display text that a form control REPLACES IN PLACE — every inline-edit
> value — is `text-base` or larger.**

Otherwise the text changes size on entering and leaving edit mode. This is why
the event detail header metadata (`event-detail-time`, duration, location,
description, conductors) and the season-manage panel dates are `text-base`
while the surrounding dense surface is `text-xs`/`text-sm`. The pairs that
already matched — the event name (`text-2xl` both sides) and the season name
(`text-lg` both sides) — only actually match now that the base-layer fix lets
those utilities apply.

The rule is about *substitution*, not adjacency. Field **labels** and **hints**
next to a control are a different role and stay at `text-xs`/`text-sm`: they
sit beside the control permanently, so nothing about them ever resizes.

## Colour roles

| Role | Treatment |
|---|---|
| Surface-level error (a whole page or panel failed to load) | `text-sm text-red-700` |
| Inline / field / row error | `text-xs text-red-700` |
| Informational status (`no-access`, `not-available`, loading) | `text-sm`, default ink |
| Destructive **action** affordance (remove links) | `text-red` (the paper-palette theme token) |
| Secondary / supporting copy | `text-ink-2`, `text-ink-3` |

The app carries two reds on purpose: `--color-red` (`text-red`, the paper
palette) and Tailwind's default `text-red-700`. Error *copy* is `text-red-700`
everywhere (~50 sites); the bare token is reserved for destructive *actions*.

An error message is never rendered at the stamp tier — a stamp is a chip or a
badge, an error is a sentence.

Both rules are enforced by `typography-scale.spec.ts`, against the **rendered**
treatment rather than the tag: for every `role="alert"` element (or one with an
`error`/`failed` test id) it resolves the colour and the size step from the
nearest ancestor that sets one, self first. Checking the tag alone would miss
the common case — the RSVP save-failed line put `text-[9px]` and `text-red` on
the reserved-space `<p>` wrapper while `role="alert"` sat on the inner `<span>`,
so a tag-local check reported clean on the one site that violated both rules.

<!-- (*MVOX:Josquin*) -->
