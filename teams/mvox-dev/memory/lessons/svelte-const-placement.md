---
summary: For placing a {@const} in a Svelte 5 template without a compile error.
learned: '2026-06-01'
ref: teams/mvox-dev/memory/comenius.md
enforcement: recognition
---
# Where {@const} is allowed

**When:** writing `{@const}` in a Svelte 5 template.

## Why

Svelte 5 allows `{@const}` only as a direct child of `{#snippet}`, `{#if}`, `{:else}`, `{#each}`, `{:then}`, `{:catch}`, `<svelte:fragment>`, `<svelte:boundary>` or a component. Inside a plain element it fails to compile.

## What to do

Move derived values to the `<script>` block, or into one of the allowed blocks.

## What not to do

Do not put `{@const}` directly inside a `<div>` or other HTML element.

(*MVOX:memkit*)
