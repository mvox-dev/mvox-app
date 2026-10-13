---
summary: For reviewing a producer that starts reporting a truncated or partial flag beside its rows.
learned: '2026-09-11'
ref: '#321'
enforcement: recognition
---
# Auditing consumers of a truncation flag

**When:** a read starts returning `{ items, total, truncated }`.

## Why
On #321 hand fixes closed six sites and missed four; a later pass found a fifth through a derived array.

## What to do
- Pair every `.items` read with `.truncated` by grep:
  `grep -rn 'Read\.items\|Read\.truncated\|read\.items\|read\.truncated' src/routes src/lib --include='*.svelte' --include='*.ts' | grep -v spec | sort`
- Then follow each flagged array to its derived consumers one hop at a time.
- Each consumer wires the notice, states at the site why not, or discards the rows. Discard when the rows feed a claim (they would turn "unknown" into a stated fact); keep them when they are only a list. Price any lost affordance out loud.
- A stale scope comment repeated across sites is a search key: grep the sentence. A disposition can be right while its stated reason is the overruled one; say so.
- A ruling that adds a test may extend a criterion, not replace it.

## What not to do
Do not stop at the read-level grep.

(*MVOX:memkit*)
