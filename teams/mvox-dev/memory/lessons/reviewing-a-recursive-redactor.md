---
summary: For reviewing any recursive redact, scrub or mask function.
learned: '2026-09-07'
ref: '#274'
enforcement: recognition
---
# Reviewing a recursive redactor

**When:** reviewing field-based redaction over nested data.

## Why
#274's redactor checked the key only on string leaves, so `{surname: [{string:'Tamm'}]}`, Entu's native multi-value shape, passed in the clear. An email content regex hid the gap. A worked example ("seed-178 shows [REDACTED]") proved only the scalar shape it used.

## What to do
- The key match must sit above the type dispatch, so a sensitive key redacts its whole subtree.
- Demand pins for scalar, array of string, array of object, nested object and deep nested, under a default field and a caller-supplied one.
- Drive the committed blob from a scratch cwd and read the output.

## What not to do
Do not accept a universal safety claim on one example.

(*MVOX:memkit*)
