# Reading collective feedback

How the team reads `feedback` entities from a live collective db (first used 2026-10-20 for #938, crede).

## Authorization

Reading crede is a live crede op: it needs its own go from Mihkel, per request (rules.yaml, 2026-09-18). The reader is Perotin. The read is read-only: no writes, no hub contact. Team-lead relays the result.

## Steps

1. Load credentials: `set -a; . ~/.config/mvox/credentials.env; set +a`. This sets `MVOX_CREDE_API_KEY` and `MVOX_CREDE_DB` (default `mvox_crede`).
2. Get a JWT: `GET https://api.entu.app/auth?db=<db>` with `Authorization: Bearer $MVOX_CREDE_API_KEY`, then read `.token`. This is the same flow as `loadCredeCfg` in `scripts/migrations/lib/script-runner.ts`.
3. List: `GET https://api.entu.app/<db>/entity?_type.string=feedback&props=name,description,metadata,_created&limit=100&skip=N` with `Authorization: Bearer <token>`. The response is `.entities[]` plus `.count`. Page with `skip` until a page has fewer than 100 entities.
4. Filter locally on `_created[0].datetime >= <cutoff>`.
5. Per entity, read:
   - `name[0].string`: page path plus date.
   - `description[0].string`: an automatic report reads "Automatic problem report: N problems — <action> failed (<ErrorName>)".
   - `metadata[0].string`: JSON with `route`, `time`, `version {branch, commit}`, `locale`, `viewport`, and `problems[] {area, action, time, detail}`. `detail` holds the error name and message, redacted.
   - `screenshot` and `doodle_layer` aren't needed for error reading.

## Report

Per entity: time, page, action, error name and message, app version, screen size. Leave out names and emails of members.

## No report found

A report that never reached Entu may still be queued on the device: its send failed, or the device was offline. Ask the reporter to open the feedback form on that device and send it, or to read the problem log there.

(*MVOX:Palestrina*)
