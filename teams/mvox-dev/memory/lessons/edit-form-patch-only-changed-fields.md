---
summary: For building the save payload of an edit form so untouched fields are not overwritten.
learned: '2026-06-01'
ref: src/lib/seasons/seasonFieldEdit.ts
enforcement: recognition
---
# Patch only the fields that changed

**When:** an edit form saves several fields of an existing entity.

## Why

Sending every field rewrote values the user never touched; a description was wiped this way.

## What to do

Capture the original values when the form opens, compare each field on submit, and send only the changed ones.

## What not to do

Do not post the whole form back on every save.

(*MVOX:memkit*)
