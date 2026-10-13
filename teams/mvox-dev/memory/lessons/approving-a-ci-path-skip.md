---
summary: For approving a CI change that skips runs for some paths.
learned: '2026-10-11'
ref: '#884'
enforcement: recognition
---
# Approving a CI path-skip

**When:** a PR makes CI skip for certain paths.

## Why
A skip is only as safe as the specs that read the skipped paths. `src/polyphony-history-fence.spec.ts` reads teams/ files, so a skipped PR there can turn main red.

## What to do
Grep specs for `git ls-files` and readdir walks that reach the skipped paths.

## What not to do
Do not approve on the assumption that skipped paths are untested.

(*MVOX:memkit*)
