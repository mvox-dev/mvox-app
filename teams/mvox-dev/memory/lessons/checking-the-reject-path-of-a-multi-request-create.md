---
summary: For reviewing a create made of several requests.
learned: '2026-10-06'
ref: '#808'
enforcement: recognition
---
# Checking the reject path of a multi-request create

**When:** a create spans more than one request.

## Why
`createFeedback` cleaned up on `!res.ok` but a thrown step (TypeError, AuthExpiredError) bypassed cleanup, leaving a half-made entity; a retry queue then made a duplicate.

## What to do
Check the reject path of every step after the first. Ask for a test that fails step 2.

## What not to do
Do not test only a step-1 failure.

(*MVOX:memkit*)
