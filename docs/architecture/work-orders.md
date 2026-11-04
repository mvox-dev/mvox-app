# Work orders: live data changes

Code: `scripts/migrations/lib/work-order.ts` (the order format), `scripts/migrations/run-work-order.ts`
(the runner), `scripts/migrations/lib/work-order-live-gate.ts` (what a live run needs first).
Asked for by Mihkel, 2026-11-01.

## Why

A live write's go used to live only in chat. The permission classifier cannot see chat, so it
blocked an approved delete, and nothing on disk said who allowed what. A work order puts the go in
a file the runner checks, and each change is a committed file with its go and its result.

Dry and live are two commands. `pnpm work-order:dry` only reads, so it may be allowed outright.
`pnpm work-order:live` writes, and Mihkel answers a permission prompt for every live run. An
allowed command runs whatever code is in the tree, so allowing the live command would let any
uncommitted edit to the runner write live data (Bentham, #1068 review). The live run therefore
also refuses unless the code and the order are both committed and unchanged.

Both commands read `~/.config/mvox/credentials.env` themselves (never printed), so a run is
exactly `pnpm work-order:dry <order>` or `pnpm work-order:live <order>`: no `source`, no env
prefix. The live command loads the crede key, which is why the live run is the one Mihkel
approves at the prompt.

## The flow

1. Pérotin reads live data freely and finds what has to change.
2. Pérotin writes the order: `~/workspace/teams/mvox-dev/work-orders/<YYYY-MM-DD>-<slug>.yaml`.
3. Mihkel gives the go; his exact words go into `go.quote`, with the time.
4. Dry run, from `~/workspace-app`: `pnpm work-order:dry <order.yaml>`. It reads each target and
   checks it against `expect`, prints the plan, and writes nothing. `DRY_RUN` is not read.
5. The order is committed to the home repo.
6. Live run: `pnpm work-order:live <order.yaml>`, which Mihkel approves at the prompt.
7. The order, now holding its `result`, is committed again.

## The order

```yaml
db: mvox_crede
why: drop a file property whose upload never landed
ref: 'mihkel:2026-11-01'          # an issue (#N) or mihkel:<date>
go:
  by: Mihkel
  at: '2026-11-01T23:53:00+02:00' # ISO date and time
  quote: <his exact words>
ops:
  - op: delete-property
    entity: '<24-hex entity id>'
    property: '<24-hex property id>'
    expect:
      type: photo                 # the property's type, ^[a-z][a-z0-9_]*$
      filesize: 0                 # required; null when the property has no size
      filetype: application/pdf   # optional
  - op: add-entity-type
    type: ink_layer               # a type in mvox-schema-extensions.ts, ^[a-z][a-z0-9_]*$
```

Ids, a type and a size only. A filename or a free-text value can hold a person's name, and the
order is committed, so `expect` takes neither; the runner also refuses any `@` in the file. The
type is pinned to a plain name because it goes into the read URL.

`add-entity-type` names one type from the schema of record and nothing else: its sharing, grants,
parents and properties come from `scripts/migrations/lib/mvox-schema-extensions.ts`, its label and
description from `scripts/migrations/lib/mvox-type-text.ts`, so the type has to be merged before
the order can run. A type with `addFrom` is refused: the op does not wire it.

The runner refuses, before any call to Entu:

- a file name that is not `YYYY-MM-DD-<slug>.yaml`, a key it does not know, an empty op list;
- no `go`, a `go` not from Mihkel, a `go.at` without a time, a blank quote;
- on a live run only: a `go.at` in the future or older than 7 days (a stale go needs a new one);
- `polyphony` (frozen since 2026-09-18, #407), or a db other than the one `MVOX_CREDE_DB` opens;
- an unknown op, an id that is not 24 hex characters, an `expect` without `type` or `filesize`,
  an `add-entity-type` with anything beside `type`;
- a spent order: one that already has a `result`.

A live run also refuses, before any call to Entu, unless:

- the app tree is on `main`, its HEAD equals `origin/main` after a fetch, and it is clean
  (no changed or untracked files): the code that runs is the reviewed, merged code;
- the order sits directly in `~/workspace/teams/mvox-dev/work-orders/`, is in that repo's HEAD,
  and has no uncommitted changes: the go that is checked is the go that was committed.

## The runner

- `AUTHORIZED_BY` is not read. The ledger's authorizer is built from the order: who, when, which
  order.
- Every op is pre-checked before anything is written. The property must be on the entity, under
  `expect.type`, and `filesize` (and `filetype` when given) must equal the live value; a missing
  live value counts as null. Only those named fields are compared; any other field on the live
  property is not checked. One mismatch and
  the run stops with nothing written.
- Live, op by op: pre-check again, delete exactly that property, read the entity back. Still there
  is a failure. The first failure stops the run; the remaining ops are `not-run`.
- `add-entity-type` pre-checks, reading only: the meta-types and every parent type resolve, and no
  type by that name exists, not even part of one. Live, it creates the type-def, then each prop-def,
  each with `_sharing` written; the type-def also gets `_inheritrights`. It then reads them back and
  fails on any difference from the definition: exactly one type-def by the name, its `_sharing` and
  `_inheritrights`, and for each prop-def its type, mandatory, list and `_sharing`, with none
  missing or extra. Its result lists every id it created, also when it stopped half-way, so a failed
  run says what to clean up by hand. Running it again on the same type is refused at pre-check.
- Once a live run has reached the writes, it writes the ledger (sensitive, so to the gitignored
  `seed-results/crede-instance/`) and the order's `result`, even when an op failed, then exits
  non-zero on a failure. The result makes the order spent.
- Errors name only what the order already holds, never the live value. Tokens and keys are never
  printed.

## Adding an op

One parser in `OP_PARSERS` (`lib/work-order.ts`) and one runner in `OP_RUNNERS`
(`run-work-order.ts`): describe, pre-check, execute, post-check. Each new op is its own reviewed
change. The ops are `delete-property` and `add-entity-type` (#1071).

(*MVOX:Josquin*)
