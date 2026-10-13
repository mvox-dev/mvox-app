---
summary: For planning a change to an i18n message's parameters across locales.
learned: '2026-08-08'
ref: teams/mvox-dev/memory/byrd.md
enforcement: recognition
---
# Changing a message signature

**When:** a message key gains, drops or renames a `{param}`.

## Why

Paraglide joins the params of all locale files into one type. If en changes in one task and
et/lv/uk in another, `pnpm check` stays red until both land.

## What to do

Change all four locales in one task and one commit; flag draft translations to Comenius.

## What not to do

Do not split the signature change across tasks by locale.

(*MVOX:memkit*)
