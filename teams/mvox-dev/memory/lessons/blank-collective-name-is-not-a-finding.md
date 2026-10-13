---
summary: For reviewing copy that interpolates the collective name.
learned: '2026-09-11'
ref: '#193'
enforcement: recognition
---
# A blank collective name is not a finding

**When:** a review worries that `{collective}` in copy could render empty.

## Why
`src/lib/collectives/marker.ts` reads `hit?.name?.[0]?.string?.trim() || db`: blank and whitespace names fall back to the db name. Cleared on #193.

## What to do
Check the fallback line is still there; if so, move on.

## What not to do
Do not re-raise it. Do not confuse it with the admin page's `admin_collective_name_unnamed`, the editable field before fallback.

(*MVOX:memkit*)
