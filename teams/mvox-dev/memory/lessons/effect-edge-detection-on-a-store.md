---
summary: For reacting in a Svelte 5 effect when a store enters one state, without a loop.
learned: '2026-06-01'
ref: urls/mem-byrd-9d2803d
enforcement: recognition
---
# Detect a store transition in an effect

**When:** an effect must act when a store moves into a state (e.g. auth becomes authenticated), not on every emission.

## Why

Bookkeeping in `$state` inside the effect makes it a dependency and can retrigger the effect. Reading a downstream store as an "already done" guard also blocks the real case the effect exists for.

## What to do

- Keep the previous value in a plain `let`, not `$state`.
- Compare it with the value read through `$store`, which is the tracked dependency.
- Guard the async call with an in-flight boolean.

## What not to do

Do not use another store's current value as the guard.

(*MVOX:memkit*)
