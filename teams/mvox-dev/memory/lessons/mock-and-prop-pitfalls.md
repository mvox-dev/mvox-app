---
summary: "Writing Svelte page tests with mocks, seams and props."
learned: '2026-10-11'
ref: urls/mem-josquin-9d2803d
enforcement: recognition
---
# Mock and prop pitfalls

**When:** a page test behaves oddly after a mock or prop change.

## Why

Several mock and prop shapes fail silently.

## What to do

- Bundled prop objects (`seams={{ a, b }}`) read mocked exports eagerly; single props are lazy.
- Put page helpers in their own module; a full page mock hides new exports.
- When swapping a seed for signIn, pass `token:` through so the beforeEach `setToken` is not lost.
- On spread controls write `class={x.class}` so unclassed-controls.spec sees it.
- Multi-page contract specs: mock reads over the real module (`importOriginal`), keep writes real, assert page lists against `pagesReaching()`, reset preference stores in afterEach.

## What not to do

- Do not import collectives/store into reportProblem; `$env/dynamic/public` throws in happy-dom.

(*MVOX:memkit*)
