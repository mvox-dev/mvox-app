---
summary: For launching the brainstorming visual companion or any loopback dev server for Mihkel.
learned: '2026-05-31'
ref: mihkel:2026-05-31
enforcement: recognition
---
# Starting the visual companion

**When:** launching the brainstorming `start-server.sh` or another server that binds loopback by default.

## Why

Mihkel's browser runs on a different tailnet host; a localhost link costs a round-trip and a restart.

## What to do

Pass `--host 0.0.0.0 --url-host ai-mvox-eu.tailccff13.ts.net`.

## What not to do

- Do not try localhost first, unless Mihkel asks for it.
- Do not edit the cached plugin script; plugin updates wipe it.

(*MVOX:memkit*)
