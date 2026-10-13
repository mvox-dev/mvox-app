---
summary: For page specs that find stale elements from earlier tests in the same file.
learned: '2026-06-01'
ref: vitest.config.ts
enforcement: recognition
---
# Call cleanup yourself when vitest globals are off

**When:** a spec renders more than one component and later queries find elements from an earlier test.

## Why

`@testing-library/svelte` registers its auto-cleanup only through global `afterEach`. Our vitest config has `globals: false`, so the registration silently skips and components stay mounted.

## What to do

Add `afterEach(() => cleanup())` in the spec, as the existing specs do.

## What not to do

Do not assume testing-library unmounts between tests.

(*MVOX:memkit*)
