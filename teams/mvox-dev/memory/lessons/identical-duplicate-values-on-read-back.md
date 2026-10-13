---
summary: For a live read-back that shows the same Entu value twice.
learned: '2026-09-22'
ref: '#445'
enforcement: recognition
---
# Identical duplicate values on read-back

**When:** a read-back or census shows two identical values for one property, such as two equal sharing or rights values.

## Why

Entu resolves identical values to the same effective result, so the outcome asked for is already met. On #445 treating duplicates as damage cost diagnosis, scripts and four authorization round-trips; Mihkel called it wasted.

## What to do

Count identical duplicates as a pass. Migration scripts assert the wanted value is present, not that exactly one value exists. Stop only on differing values.

## What not to do

Do not write cleanup or converge logic for identical duplicates, and do not ask for authorization to remove them.

(*MVOX:memkit*)
