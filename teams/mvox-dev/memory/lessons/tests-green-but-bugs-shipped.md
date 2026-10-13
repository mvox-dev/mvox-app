---
summary: For writing or reviewing tests on mutations, store-to-page links and Entu wire calls.
learned: '2026-06-01'
ref: ''
enforcement: recognition
---
# Tests green but bugs shipped

**When:** writing or reviewing a test for a write payload, a store feeding a page, an Entu request, or a new i18n key or branch.

## Why

A test proves only what it asserts. Four PO-found bugs shipped green: a page test used a state the store never produced; a mocked fetch encoded the wrong _type shape for Entu creates; keys existed only in test mocks; a partial match missed a write that wiped the description.

## What to do

- Assert the full shape of write payloads (toEqual), so a clobbering field fails.
- Drive the real producer in integration tests, mocking only the lowest layer.
- Check a new wire contract, such as a new entity create, live on a preview before GREEN.
- Grep src to confirm a key or branch is used outside tests.
- Click through a deployed preview as part of done.

## What not to do

Do not use objectContaining on payloads where a missing or extra field loses data. Do not hand-set intermediate state.

(*MVOX:memkit*)
