---
summary: For reviewing a hash pin over a document region, or a re-derived pin.
learned: '2026-09-15'
ref: '#369'
enforcement: recognition
---
# Reviewing a checksum fence

**When:** a spec pins a doc region by hash after normalising it, or a slice re-derives such a pin.

## Why
Every line the normalisation strips is a path the fence is not on. #320 stripped every blockquote, so adding a contradicting note passed green; modification probes alone missed it. On #369 a kept exclusion left a new block in neither guard.

## What to do
- Ask what the strip step makes invisible, then try to ADD something there.
- Re-derive the pin yourself from `git show main:<path>`, normalisation reimplemented from the code, not copied.
- For a re-derived pin: re-derive the new pin from the tip, the old pin from main, then diff the two remainder strings; only the claimed additions may appear. A `+N/-0` doc diff is the cheap first check.
- When a precedent has two halves, ask which half its reason attached to. Exclusion plus a per-block pin, not exclusion alone.
- Pin a block in the slice that edits it; the fence's own whole-file hash then needs a repin too.

## What not to do
Do not trust a comment narrower than its code: the code is the fence.

(*MVOX:memkit*)
