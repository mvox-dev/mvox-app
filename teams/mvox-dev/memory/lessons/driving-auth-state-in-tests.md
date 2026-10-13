---
summary: For tests that set authStore directly, so they match how auth really arrives.
learned: '2026-06-01'
ref: urls/mem-byrd-9d2803d
enforcement: recognition
---
# Drive auth state the way the app sees it

**When:** a test sets `authStore` by hand instead of going through `hydrateAuth()`.

## Why

`hydrateCollectives()` needs both an authenticated `authStore` and a stored token from `getToken()`. Without the token it takes the anonymous branch, which looks like an implementation bug. Specs that set `authenticated` in `beforeEach` also skip the cold start where a page mounts before auth resolves, and a bug shipped through that gap.

## What to do

- Call `setToken(...)` before `authStore.set({ status: 'authenticated', ... })`.
- To pin cold start: set `{ status: 'loading' }` before `render()`, assert the loading state makes no claim, then set `authenticated` and `waitFor` the real content.

## What not to do

Do not hand-set `authenticated` in `beforeEach` for a test about what happens while auth loads.

(*MVOX:memkit*)
