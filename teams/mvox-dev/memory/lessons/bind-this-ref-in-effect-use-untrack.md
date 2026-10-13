---
summary: "Calling a bind:this component ref inside a Svelte effect."
learned: '2026-10-11'
ref: teams/mvox-dev/memory/josquin.md
enforcement: recognition
---
# A bind:this ref read in an effect re-runs it

**When:** an effect calls a method on a bind:this ref.

## Why

`roles?.reset()` inside an effect tracked the ref and looped forever.

## What to do

- Wrap the ref call in `untrack`.

## What not to do

- Do not read a bind:this ref bare inside an effect.

(*MVOX:memkit*)
