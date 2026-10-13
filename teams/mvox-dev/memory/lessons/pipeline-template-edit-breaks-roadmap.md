---
summary: Editing the tdd-slice-pipeline template, so the roadmap deploy job keeps passing.
learned: '2026-09-18'
ref: src/pipeline-ref-discipline.spec.ts
enforcement: linted
---
# Template edits must pass the ref-discipline spec

**When:** changing .claude/workflows/tdd-slice-pipeline.js.

## Why

src/pipeline-ref-discipline.spec.ts pins exactly one bare `agent(` dispatch. It runs in the
roadmap deploy job, not in slice gates, so commit 34a7965 passed every local gate and broke the
roadmap board for seven hours until c957e66.

## What to do

- Before pushing: `npx vitest run src/pipeline-ref-discipline.spec.ts`.
- Dispatch new steps through `agentS(`.
- After pushing, run `gh workflow run roadmap.yml --ref main` and watch it; the board does not
  redeploy on push.

## What not to do

Do not change the spec's pinned count without a stated reason in the spec.

(*MVOX:memkit*)
