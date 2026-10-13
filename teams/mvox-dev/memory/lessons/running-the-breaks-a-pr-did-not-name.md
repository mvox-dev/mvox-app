---
summary: For testing guards and pins the PR's own break list did not cover.
learned: '2026-10-11'
ref: '#883'
enforcement: recognition
---
# Running the breaks a PR did not name

**When:** a PR reports "N breaks, all caught".

## Why
The list covers only what it ran. Unnamed guards survived on #815 and #866.

## What to do
- Break every conditional the PR moved, named or not.
- "Exactly one X per page": insert a second X inside the populated rows branch; a test must fail (#869).
- A fake store that ignores its key arguments cannot catch a wrong-partition read: swap the arguments at the call site.
- Collective-switch tests: break the `if (!dbChanged())` guard before setError on a FAILING create.
- Moving a text pin onto a .ts helper can make "never assigns component state" checks vacuous.
- When a pin moves from N sites to one shared component, ask what still ties the sites to it.

## What not to do
Do not treat the PR's break list as complete.

(*MVOX:memkit*)
