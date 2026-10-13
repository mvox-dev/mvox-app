---
summary: For choosing data-testid names and prefix selectors that will not match nested elements.
learned: '2026-06-01'
ref: urls/mem-byrd-9d2803d
enforcement: recognition
---
# Prefix selectors match nested test ids too

**When:** a test uses `[data-testid^="prefix-"]` or a component adds a wrapper whose id shares a prefix with its children.

## Why

`[data-testid^="agenda-row-"]` matched the rows and also inner `agenda-row-time` spans, so counts were wrong.

## What to do

Give inner elements ids that do not share the wrapper's prefix (`row-time`, not `agenda-row-time`), and update specs as a mechanical rename.

## What not to do

Do not add a card-level wrapper without checking sibling and child ids for the same prefix.

(*MVOX:memkit*)
