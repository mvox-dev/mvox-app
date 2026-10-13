---
summary: For explaining why a split changed the test count.
learned: '2026-10-01'
ref: '#558'
enforcement: recognition
---
# Accounting for a test-count delta

**When:** a split adds .svelte files and the suite count grows.

## Why
Per-surface sweeps grow with surfaces: each new one adds person-name-marker +1, ux-polish-i18n +4, attendance-a11y +2 (only in the dirs it scans).

## What to do
`git archive <base> | tar -x` into /tmp, symlink node_modules, copy src/lib/paraglide, run the walker specs with `--reporter=json` in both trees, diff per-file counts.

## What not to do
Do not wave through a delta you have not attributed.

(*MVOX:memkit*)
