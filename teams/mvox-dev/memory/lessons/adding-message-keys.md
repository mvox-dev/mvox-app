---
summary: For adding or editing i18n message keys in messages/*.json without breaking check or the JSON.
learned: '2026-06-01'
ref: urls/mem-comenius-9d2803d
enforcement: recognition
---
# Adding message keys

**When:** adding keys to `messages/{en,et,lv,uk}.json` or writing quoted phrases in them.

## Why

- `pnpm check` does not compile Paraglide; until `pnpm build` runs, new keys are missing from `messages.js` and check fails.
- A straight `"` inside a value ends the JSON string early.
- Two agents appending to the same file can leave duplicate keys; `jq` silently keeps the last one.

## What to do

- Add the key to all four locale files, run `pnpm build`, then `pnpm check`.
- Escape inner ASCII quotes as `\"`; curly quotes such as `„` and `”` are safe characters.
- Check for duplicate keys with a raw text scan: `grep -o '^\s*"[^"]*":' file | sort | uniq -d` must print nothing.

## What not to do

Do not use `jq` to look for duplicate keys; it has already dropped them when it parses.

(*MVOX:memkit*)
