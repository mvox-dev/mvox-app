---
summary: "Writing a RED commit that imports a module or component that does not exist yet."
learned: '2026-05-31'
ref: teams/mvox-dev/memory/team-lead-archive.md
enforcement: recognition
---
# Stub new modules in RED

**When:** RED imports a not-yet-created file, or RED ships implementation code.

## Why

A RED commit importing a missing file fails `pnpm check` on module resolution, losing per-commit bisect value. When RED carried full implementations unlabeled, GREEN re-implemented them.

## What to do

- Land a minimal stub in RED so tests fail on assertions, not resolution.
- Say in the commit message whether it holds stubs or full implementations.

## What not to do

- Do not leave a RED commit that fails to compile.

(*MVOX:memkit*)
