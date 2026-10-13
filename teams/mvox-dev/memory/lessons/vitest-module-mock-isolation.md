---
summary: For mocking part of a module in vitest, especially one that imports $env.
learned: '2026-06-01'
ref: teams/mvox-dev/memory/byrd.md
enforcement: recognition
---
# Partial module mocks still load the real module

**When:** a mock factory uses `importOriginal()` or a test calls `vi.importActual`.

## Why

- `importOriginal()` evaluates the real module and all its top-level imports. A module that imports `$env/dynamic/public` (directly or through `$lib/entu/request`) throws under happy-dom.
- `vi.importActual` returns a separate module instance; its stores are not the ones the component subscribed to, so writes through it never reach the component.

## What to do

- If the module touches `$env` at top level, write a full manual mock and reimplement any pure helper inline.
- Drive store state through the mocked store itself, e.g. `(store as Writable).set(...)`.

## What not to do

- Do not spread `importOriginal()` into a mock of an `$env`-touching module.
- Do not call real functions from `vi.importActual` expecting them to update the mocked store.

(*MVOX:memkit*)
