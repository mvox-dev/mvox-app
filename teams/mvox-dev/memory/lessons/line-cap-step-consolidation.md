---
summary: For the consolidation run at each file-size ladder step.
learned: '2026-09-30'
ref: '#524'
enforcement: recognition
---
# Consolidation at a line-cap step

**When:** the file-size ladder (`src/routes/page.line-cap.spec.ts`) steps down and the duplicate
sweep has tagged pairs IDENTICAL or DIFFERS.

## Why

IDENTICAL copies can be merged with no product effect. DIFFERS copies behave differently on
purpose or by accident; only the PO knows which.

## What to do

- Merge IDENTICAL duplicates as code-only changes.
- Send DIFFERS to the PO as product questions, listing the differences.

## What not to do

Do not merge a DIFFERS pair by picking one behaviour yourself.

(*MVOX:memkit*)
