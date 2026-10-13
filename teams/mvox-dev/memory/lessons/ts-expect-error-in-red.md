---
summary: For writing type-level RED proofs with @ts-expect-error, and when not to.
learned: '2026-06-01'
ref: urls/mem-tallis-9d2803d
enforcement: recognition
---
# @ts-expect-error in RED tests

**When:** a RED test proves a type change with `@ts-expect-error`, or a type field is being retired.

## Why

The directive covers only the next line, so an error on a later line of a multi-line literal slips past. Vitest strips types, so only `pnpm check` sees these proofs. Forcing a removal proof for a retired field can break `pnpm check` for no gain.

## What to do

- Keep the checked object literal on one line under the directive.
- Run `pnpm check`, not only vitest, for any RED with type proofs.
- For a retired field, let GREEN drop it from the type; do fix fixtures that pin the old shape and would conflict with the new design.

## What not to do

Do not add a removal proof that breaks `pnpm check`.

(*MVOX:memkit*)
