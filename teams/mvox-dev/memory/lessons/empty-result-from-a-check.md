---
summary: For deciding whether a sweep, query, guard or test that found nothing really means all clear.
learned: '2026-09-09'
ref: '2026-09-09'
enforcement: recognition
---
# Empty result from a check

**When:** a check, sweep, query or guard comes back empty or green.

## Why

An empty result says something about the check before it says anything about the world. On one day: a ready-label sweep returned zero because the search index lagged; a research sweep aimed at async bugs missed a synchronous one (#299); a guard had never examined the three keys it was written for.

## What to do

Ask two questions: was the check aimed at the right kind of failure, and did it actually examine its subject? Show it would have failed had the problem been there: by construction, by reasoning through the failing branch, or by breaking the thing on purpose. Fix a check that was not looking before fixing what it should catch, with a test that fails before and passes after.

## What not to do

Do not report "clear" from an empty result alone. Do not write a pin that passes whether or not the guard exists.

(*MVOX:memkit*)
