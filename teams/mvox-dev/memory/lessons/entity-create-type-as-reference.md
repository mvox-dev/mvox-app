---
summary: Writing or reviewing code that creates an Entu entity, so the _type wire shape is right.
learned: '2026-06-01'
ref: teams/mvox-dev/docs/architecture-decisions.md
enforcement: recognition
---
# Entity create needs _type as a reference

**When:** code POSTs a new entity to Entu, or a review sees one.

## Why

Create rejects a string `_type` with 400 "Property _type must have reference value". Search
uses `_type.string`, so the string form looks right. Mocked fetch asserted the wrong shape and
the bug shipped with every unit test green.

## What to do

- Send `{ type: '_type', reference: <type entity _id> }`. Type ids differ per database;
  resolve them by name at runtime.
- Gate any new entity type on a live smoke-create, not only unit tests.

## What not to do

- Do not post `{ type: '_type', string: ... }`; a reviewer marks it RED.
- Do not trust a mock's wire shape that nobody checked against the docs or a live call.

(*MVOX:memkit*)
