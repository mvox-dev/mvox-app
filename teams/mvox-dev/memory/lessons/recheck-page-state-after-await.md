---
summary: "Moving an async handler, so post-await reads still check whether the page closed."
learned: '2026-10-11'
ref: teams/mvox-dev/memory/josquin.md
enforcement: recognition
---
# Re-check page state after every await

**When:** moving or refactoring a Svelte handler with awaits.

## Why

A moved handler lost its "closed meanwhile" check and dropped a write.

## What to do

- List each post-await read of page state and keep its check.
- A `mounted` flag cleared by `$effect(() => () => { mounted = false; })` works.

## What not to do

- Do not drop a post-await guard while moving code.

(*MVOX:memkit*)
