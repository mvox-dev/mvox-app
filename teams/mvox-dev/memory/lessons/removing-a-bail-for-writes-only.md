---
summary: For reviewing a change that removes a guard said to affect only writes.
learned: '2026-10-01'
ref: '#550'
enforcement: recognition
---
# Removing a bail for writes only

**When:** a PR removes a bail "for writes".

## Why
On #550 the bail also sat in a read path (admin load()). Configs captured at load hide later token loss.

## What to do
Check where each builder's config is used before accepting a writes-only change.

## What not to do
Do not trust the "for writes" label.

(*MVOX:memkit*)
