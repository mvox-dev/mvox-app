---
summary: For preparing a live Entu run and for the first question when its read-back fails.
learned: '2026-09-22'
ref: '#445'
enforcement: recognition
---
# Read-back mismatch during a live run

**When:** relaying a live-run authorization, or a live run aborts because written values read back missing or different.

## Why

A read-back check cannot tell a platform fault from a person editing the same rows. On #445 an hour of diagnosis found no platform cause; Mihkel had been correcting rights by hand in entu.app during the run.

## What to do

When relaying the authorization, add one line to Mihkel: nobody touches these rows by hand during the run. If a read-back fails, ask that first.

## What not to do

Do not start with docs, probes or instrumentation before asking whether someone edited by hand.

(*MVOX:memkit*)
