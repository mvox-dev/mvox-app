---
summary: "Touching an old file that now falls under the comment-rules spec."
learned: '2026-10-11'
ref: src/comment-rules.spec.ts
enforcement: linted
---
# Comment rules cover the whole touched file

**When:** editing any file that predates comment-rules.spec.

## Why

Touching a file puts all of it under the spec, not just your lines; the spec also reads scripts/** headers.

## What to do

- Count its comments first. Fastest trim: strip whole-line comments by script, check `git diff -U0` removes only comments, then add a top line and a few one-line whys.
- A shrink below 400 lines removes it from LINE_CAP_EXCEPTIONS (src/lib/testing/lineCap.ts).

## What not to do

- Do not touch src/lib/redact/redact.ts or its spec comments; their text is pinned.

(*MVOX:memkit*)
