---
summary: For code or schema work on the link entity.
learned: '2026-09-09'
ref: '#256'
enforcement: recognition
---
# Working on the link entity

**When:** reading, writing or extending the `link` type (scripts/migrations/lib/mvox-schema-extensions.ts).

## Why

The PO ruled its shape: an mvox app extension, admin-written only, with four properties.

## What to do

Keep it to `display_order`, `name`, `url`, `description`; offer writes to admins only.

## What not to do

Do not add properties or member write paths without a new PO ruling.

(*MVOX:memkit*)
