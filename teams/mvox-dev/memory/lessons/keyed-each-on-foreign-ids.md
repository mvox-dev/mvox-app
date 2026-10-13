---
summary: For reviewing a keyed Svelte each block whose keys come from data.
learned: '2026-09-24'
ref: '#470'
enforcement: recognition
---
# Keyed each on foreign ids

**When:** a `{#each ids as id (id)}` keys on values arriving from outside the component.

## Why
Svelte throws on a duplicate key in dev and production alike, so a data duplicate becomes a crash. Entu `_parent` POSTs without `_id` append, so two admins can create one by ordinary concurrent use.

## What to do
Put the uniqueness guarantee at the extraction boundary, plus the one shared write choke point (#470: `new Set` in `listActiveMembers` and in `patchMemberSectionIds`). Verify by enumerating every assignment to the keyed array.

## What not to do
Do not accept a guard on the picking path alone: the next writer is not a UI path.

(*MVOX:memkit*)
