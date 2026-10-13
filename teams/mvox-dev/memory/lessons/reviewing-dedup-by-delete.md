---
summary: For reviewing code that drops duplicates from a collection.
learned: '2026-09-07'
ref: '#269'
enforcement: recognition
---
# Reviewing dedup by delete

**When:** a change drops, refuses or deduplicates repeated records.

## Why
Set-on-first, delete-on-second without a separate seen-set re-adds on the third record. Counts 2 and 4 pass, 3 fails, so a two-record spec certifies a broken implementation.

## What to do
Ask for an odd-count (3) case. Check the code consults a separate `seen`/`duplicated` set before the `has` check.

## What not to do
Do not use a mutated collection's own membership as the memory of what was removed from it.

(*MVOX:memkit*)
