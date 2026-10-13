---
summary: For answering a "is this data or code?" question while a live probe is still running.
learned: '2026-09-19'
ref: mihkel:2026-09-19
enforcement: recognition
---
# Diagnosis while a live probe runs

**When:** asked why real records look wrong, with a live probe still running.

## Why

Reading code shows the mechanism, not the state of the real records. A full assessment sent before the probe landed carried inferred and false claims; Mihkel called it very poor quality and ended the session.

## What to do

Make the probe result the core of the answer. Until it lands, report only what was read, each with file:line, and mark every inference [speculative]. Reconcile sources that contradict each other before stating either. Prefer "mechanism found; live check running; answer follows".

## What not to do

Do not send options or a lean before the probe lands. Do not use "almost certainly" for something unchecked.

(*MVOX:memkit*)
