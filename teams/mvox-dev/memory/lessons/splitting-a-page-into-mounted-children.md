---
summary: For reviewing page splits that move an open/close form or write queue into a child component.
learned: '2026-09-30'
ref: '#526'
enforcement: recognition
---
# Splitting a page into mounted children

**When:** a slice moves a form into an `{#if open}` child or makes a write queue per mount.

## Why
Mount/unmount replaces open()/close() resets, so state read after an `await` to ask "was I closed?" is gone and the async tail completes in the dead child. A dead component's props return their last values. A per-mount queue drops in-flight keys on reload, changing dedupe.

## What to do
Grep the old page for state read after an await in each moved submit. Fix shape: a mounted flag cleared in an `$effect` cleanup, read where the old guard was. Check post-write refreshes from a section that may have unmounted.

## What not to do
Do not assume bound props stop updating after unmount.

(*MVOX:memkit*)
