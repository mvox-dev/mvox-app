---
summary: For stating a pnpm check / pnpm test result I can stand behind.
learned: '2026-10-06'
ref: '#809'
enforcement: recognition
---
# Reporting a gate result

**When:** about to quote a gate number or pass a branch on its gates.

## Why
Chained commands, scoped runs and narrow greps have each produced a wrong number: an ELIFECYCLE in a chain made `tail` show the previous commit's count; a scoped "117/117" hid a repo-wide guard failing; a grep for "Test Files|Tests |FAIL" hid `Errors 1 error`.

## What to do
- Read the gate output in the same turn and quote the exact line. No read this turn, no number.
- Prefix gate runs with `export PATH="$HOME/.local/share/pnpm:$PATH"`; a bare `pnpm` exits 127, which looks like a broken repo and is not.
- Run each commit's `pnpm check` as its own Bash call.
- Grep `"Test Files|Tests |FAIL|Errors|Unhandled"`; any `Errors` line is a failed gate.
- Run the FULL suite on any branch that adds a spec; repo-wide guards fire on new files. Carry the previous round's full count forward.
- Long suites: run in the foreground with a 600000 timeout, split into src/lib, src/routes/page.[a-l]*, page.[m-z]* and the rest; check the file total matches a `find ... | wc -l`.

## What not to do
Do not accept a scoped count as the gate. Do not let passing vitest stand in for a failed or missing `pnpm check`.

(*MVOX:memkit*)
