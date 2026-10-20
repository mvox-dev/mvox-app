# Feedback MCP server — design

2026-10-20. Asked for by Mihkel. Access design by Passepartout, approved by Mihkel.

## Why

Reading feedback today takes a relay. On 2026-10-20, to read crede feedback for the #938 iPad bug, Henry (po-team) had to mail Palestrina, Palestrina had to get Mihkel's go, and Palestrina then spawned Perotin to run hand-written Entu queries. Mihkel wants feedback reading "as frictionless as possible": the AI team leads on the tailnet read feedback themselves, from their own Claude sessions, with no go-between.

## Ruling this records

Mihkel, 2026-10-20: Palestrina, Henry, Gama and Passepartout may read collective feedback at any time without asking. This replaces the per-operation authorization rule (rules.yaml, 2026-09-18) **for feedback reads only**. Every other live crede operation still needs his go each time.

## Goals

- An MCP server the four readers add with one command and then use like any other tool.
- It reads `feedback` entities from every Entu database it holds a key for. Today that's `mvox_crede` (key `MVOX_CREDE_API_KEY`) and `polyphony` (key `ENTU_API_KEY`). A collective added later shows up once its key is added to the config. No code change.
- Readers see the whole report: name, description, the metadata JSON, sender, created time, linked issues, screenshot, doodle layer.

## Non-goals

- No writes of any kind: no marking reports handled, no replies, no edits. The only Entu calls are `GET`s.
- No other entity types.
- No in-app UI. The app doesn't change for this. #1006 (user-agent in metadata) is a separate issue already in progress.

## Anti-goals (a failure even if it works)

- Anything that lets a reader write to Entu, or reach a shell, the container or Docker on the host.
- A port open to the public internet. shipyard has a public IP, and Docker's published ports bypass ufw.
- Feedback content leaking into logs beyond what's needed to say who asked what.

## Access (Passepartout's design, Mihkel OK)

- The server speaks MCP over **stdio**, started per connection by **sshd** for a dedicated `feedback` login.
- That sshd listens **only on the tailnet**: shipyard is 100.103.189.3, and the port is separate from the hub's (e.g. 2223).
- `authorized_keys` holds one line per team: that team's **hub courier public key**, with `restrict,command="feedback-mcp --team <team>"`. The key fixes the team, and the login can do nothing but start the server.
- The keys are collected over the hub. Each team mails its public key, and Palestrina adds the line. Teams today: `mvox` (`~/.ssh/sm_mvox.pub`, here), `po-team` (one key for Henry and Gama), and `passepartout`.
- A team connects with: `claude mcp add mvox-feedback -- ssh -p 2223 -i ~/.ssh/sm_<team> feedback@100.103.189.3`.
- The `feedback` login gets **no Docker rights**: Docker group membership equals root on the host. sshd runs inside the mvox container or a small sidecar next to it, never `docker exec` from the host.
- **Palestrina's call:** the server logs team, tool and arguments per call, but never feedback content. Mihkel said not to identify the requester, and the key now does that anyway. The log answers "who read what". Mihkel can veto this.

## Tools (from Henry's list, 2026-10-20)

1. **list_feedback**: filters for db (default all), since/until, page path, app version, error name (matched inside `metadata.problems[].detail`), kind (automatic or singer-sent), and untriaged (no `issue_url` yet, see #951). It returns a summary per report: db, id, created, page, kind, first error, app version.
2. **get_feedback**: db and id. It returns everything, with the screenshot as MCP image content and the doodle layer as stroke JSON.
3. **count_feedback**: the same filters, grouped by error name, action or app version, to spot patterns without reading each report.

## Entu facts (verified by Perotin against mvox_crede, 2026-10-20)

- Auth: `GET https://api.entu.app/auth?db=<db>` with `Authorization: Bearer <api key>`, then read `.token`. Same as `loadCredeCfg` in `scripts/migrations/lib/script-runner.ts`.
- List: `GET https://api.entu.app/<db>/entity?_type.string=feedback&props=...&limit=100&skip=N`, which returns `.entities[]` and `.count`.
- `description[0].string`: an automatic report reads "Automatic problem report: N problems — <action> failed (<ErrorName>)".
- `metadata[0].string`: JSON with `route`, `time`, `version {branch, commit}`, `locale`, `viewport`, and `problems[] {area, action, time, detail}`. After #1006 it also has `userAgent`.
- Props (`scripts/migrations/lib/mvox-schema-extensions.ts`, the feedback type):
  - `screenshot`: a file.
  - `doodle_layer`: text, StrokeData JSON from `src/lib/strokes/strokes.ts`. It is not an image.
  - `description`: text, optional.
  - `metadata`: text, JSON.
  - `issue_url`: a string list, live since #951.
  - The entity's `name` is the page path plus the UTC date.
- The sender is the feedback's `_parent` member. File URLs are signed the way `signFileUrl` in `$lib/repertoire/fileUrls` does it, and `src/lib/feedback/feedbackData.ts` is the app's own reader to copy from.
- Kind: an automatic report's `description` starts "Automatic problem report". Anything else is singer-sent.
- The keys in use have db-root rights [speculative: Perotin saw all 3 crede feedback]. The server never needs more than read.

## Calls made by Palestrina (Mihkel can veto)

- **Secrets:** a sidecar container with its own config file. The file lists db name, key and a label per db, is mounted read-only, and only the server process can read it. It is not passed as environment variables, because sshd doesn't pass its environment to forced commands. The host side places the file.
- **Read-only:** the only Entu calls are `GET`s, enforced in code. The db must be one listed in the config, and the id must be a 24-hex Entu id before it goes into a URL. No other path shapes are allowed. No per-db read-only key is required.
- **Testing:** unit tests run against recorded fixtures (synthetic, no PII) and a mock Entu. Acceptance is a live read-only run by Perotin on crede, which the feedback ruling covers.
- **Untrusted content:** report text comes back marked as user-submitted content. It isn't truncated, except free text over 10k characters.
- **Images:** the screenshot comes back as an image, downscaled if it's over 1 MB. The doodle layer comes back as its stroke JSON. Drawing it onto the screenshot is a later nice-to-have.
- **Delivery:** the builder delivers the image, a compose snippet and the authorized_keys file. Mihkel or Passepartout apply them on shipyard. The keys are in `~/workspace/scratchpad/feedback-mcp-keys.pub`.

## Constraints

- It runs on shipyard next to the mvox container. `credentials.env` stays where it is. The server reads the db/key pairs from a config, not hard-coded.
- Pin the container's bridge IP if a tailscale-serve-style proxy is used. For a host port binding to the tailnet IP, give it a restart policy, because Docker can't bind before tailscaled is up after a reboot (Passepartout).
- The host change (port exposure) needs Mihkel or Passepartout. The mvox team can't make it from inside the container.

## Left to the builder

Language and MCP SDK; where the code lives in the repo; pagination and caching; output formatting; how filters map to Entu query params versus local filtering.

(*MVOX:Palestrina*)
