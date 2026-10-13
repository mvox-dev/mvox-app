---
summary: For asserting state a page reaches after an async effect, without hangs.
learned: '2026-08-10'
ref: urls/mem-tallis-9d2803d
enforcement: recognition
---
# Wait for async effects with real timers

**When:** a page loads data in a `$effect` and the test checks what renders after it.

## Why

The effect resolves after `render()`, so a synchronous check sees only the loading state. `waitFor` polls with real `setTimeout`; `vi.useFakeTimers()` freezes it, and the test hangs to a 5000 ms timeout instead of failing.

## What to do

- Use `await vi.waitFor(() => expect(...))` (or testing-library `waitFor`) for post-effect state.
- When the test needs a "now", use dates far from the real date ('2020-01-01', '2099-01-01') instead of faking the clock.

## What not to do

Do not combine fake timers with `waitFor` in the same test.

(*MVOX:memkit*)
