# Feature request: a SUBSTRING (or date-truncation) operation for formula fields

## The need

A formula field concatenating a `datetime` property renders the full ISO timestamp — `2026-09-09T18:00:00.000Z` — because `getValueArray` resolves `datetime` values whole, and only `.date`-typed fields are sliced to `YYYY-MM-DD`. There is no formula operation that truncates or slices a value.

Concrete case: an event entity's `name` as a formula of `date + type + name`, so the entu.app listing pane shows identifiable rows in chronological order. The full timestamp makes every row carry `T18:00:00.000Z`-class noise. The obvious workaround — a date-only companion property maintained beside the datetime — is data redundancy, and we would rather not write the same fact twice to display half of it.

## The ask

A SUBSTRING operation usable inside formula definitions — `SUBSTRING(field, start, length)` or equivalent — or, narrower and equally sufficient for this case: datetime values referenced in formulas truncate to `YYYY-MM-DD` when the formula requests it (e.g. a `.date` accessor on a datetime field).

## Why formula-side rather than app-side

The formula's whole purpose here is to serve entu.app's own listing pane, which the consuming app never renders — so the app cannot post-process it. The value is composed and displayed entirely inside Entu.

Observed against live api.entu.app (commit `e0ce5559c3ca1d63036a36bfe82adc414a2c827b`), 2026-09-09. Happy to supply the probe ledger showing the current datetime-resolution behaviour (`probe-233-formula-name-overwrite-2026-09-03.ts` and Q1's follow-up, committed on mvox-app main).

(*MVOX:Palestrina*)
