# #38 — Roster load-error i18n leak

## Problem

`roster/+page.svelte` interpolates raw `Error.message` strings into the user-facing `roster_load_error` i18n template. Two paths produce developer-facing English text that reaches end users:

1. **Line 49** — `catch (e)` captures thrown errors (e.g. `listActiveMembers`' verbose message about "narrower-than-entity sharing tier" + raw entity IDs).
2. **Line 37** — hardcoded `'no auth token in storage on a protected route'`.

The i18n wrapper is localized (`roster_load_error` exists in en/et/lv/uk), but the `{message}` payload is always English and developer-facing.

## Fix

Split concerns: keep the detailed thrown error for developers/logs; show a generic localized string to the user.

### UI (`src/routes/roster/+page.svelte`)

- On catch: `console.error` the detailed error message for debugging.
- Remove the `{message}` interpolation from the rendered template — call `m.roster_load_error()` with no parameter.
- The `loadError` state variable can be removed or kept for internal use; it must not reach the template.

### i18n (all 4 locales)

Replace `roster_load_error` — drop the `{message}` parameter:

| Locale | Current | New |
|--------|---------|-----|
| en | `"Couldn't load the roster: {message}"` | `"Something went wrong loading the roster."` |
| et | `"Liikmete nimekirja laadimine ebaõnnestus: {message}"` | `"Liikmete nimekirja laadimine ebaõnnestus."` |
| lv | `"Neizdevās ielādēt dalībnieku sarakstu: {message}"` | `"Neizdevās ielādēt dalībnieku sarakstu."` |
| uk | `"Не вдалося завантажити список учасників: {message}"` | `"Не вдалося завантажити список учасників."` |

### Test (`src/routes/page.roster.spec.ts`)

- Update the `roster_load_error` mock — no `{message}` parameter.
- Load-error test: assert the generic message is shown, assert `'boom 500'` is NOT in rendered output.
- Verify `console.error` was called with the detailed error.

### No changes

- `src/lib/roster/rosterData.ts` — the detailed thrown errors are correct as thrown errors.
- `src/lib/roster/rosterData.spec.ts` — data-layer tests are unaffected.

## Scope

Small. Three files touched: `+page.svelte`, `page.roster.spec.ts`, `messages/*.json` (4 locales).

## Owners

Tallis (RED) → Byrd (GREEN, UI) + Comenius (i18n strings) → Bentham (REVIEW) → Josquin (MERGE).

(*MVOX:Palestrina*)
