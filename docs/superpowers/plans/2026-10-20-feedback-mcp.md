# Feedback MCP Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A read-only MCP server, reached over SSH on the tailnet, that lists, shows and counts mvox `feedback` entities from every Entu db it holds a key for.

**Architecture:** A Node process speaks MCP JSON-RPC 2.0 over stdio, using pure handler functions in the style of `workers/entu-rights-mcp/src/protocol.ts` (no SDK). It is started per connection by sshd through a forced command in `authorized_keys` that fixes `--team`. The process and sshd run in their own sidecar image, next to the mvox container on shipyard.

**Tech Stack:** TypeScript (strict), Node 22, vitest (the repo's runner), `sharp` (screenshot downscale, service-local dependency only), OpenSSH sshd.

**Spec:** `docs/superpowers/specs/2026-10-20-feedback-mcp-design.md`

## Global Constraints

- Read-only. The only HTTP method the Entu client may issue is `GET`.
- `db` must be a name listed in the config. `id` must match `/^[0-9a-f]{24}$/` before it goes into any URL.
- Config is a JSON file at `--config` (default `/etc/feedback-mcp/config.json`): `{ "dbs": [{ "db": string, "label": string, "key": string }] }`. It is never read from env vars.
- Entu base is `https://api.entu.app`. Auth is `GET /auth?db=<db>` with `Authorization: Bearer <key>`, then `.token`.
- Feedback list: `GET /<db>/entity?_type.string=feedback&props=name,description,metadata,doodle_layer,screenshot,issue_url,_parent,_created&limit=100&skip=N`, paged until a page holds fewer than 100.
- Kind: `description` starting `Automatic problem report` means `automatic`. Anything else is `singer`.
- Report text comes back under a `user_submitted` label. Free text over 10000 characters is cut, with a `[truncated]` marker.
- A screenshot over 1 MB (1048576 bytes) is downscaled to fit, as PNG. The doodle layer comes back as its stroke JSON text.
- Every tool call writes one log line: ISO time, team, tool, JSON args. It never logs feedback content. Log path is `--log` (default `/var/log/feedback-mcp/calls.log`).
- The `feedback` login has no Docker rights. sshd listens only on the address it is given (the tailnet).
- Code lives in `services/feedback-mcp/`. Its specs run under the repo's vitest: add `'services/**/*.spec.ts'` to `vitest.config.ts` include.

## Review Focus

- A db whose key fails auth (revoked or mistyped key): the other dbs still answer, and the failing one is named in the result, not silently skipped. → Task 2 test `a failing db is reported, others still list`.
- A feedback with missing or malformed `metadata` JSON (pre-#611 crede rows): it still lists, with null version/page/error fields. → Task 3 test `malformed metadata lists with nulls`.
- An expired token mid-session (Entu JWTs expire): one 401 triggers a single re-auth and retry. → Task 2 test `401 re-auths once`.
- Prompt-injection shaped args (`db: "../x"`, `id: "abc?x=1"`): rejected before any fetch. → Task 1 test `rejects unlisted db and malformed id`.
- A feedback with no screenshot (automatic reports): `get_feedback` returns the text without error. → Task 4 test `no screenshot returns text only`.

---

### Task 1: Package scaffold, config and argument guards

**Files:**
- Create: `services/feedback-mcp/package.json` (name `feedback-mcp`, `type: module`, dependency `sharp`, bin `feedback-mcp` → `dist/main.js`), `services/feedback-mcp/tsconfig.json` (copy `workers/entu-rights-mcp/tsconfig.json`), `services/feedback-mcp/src/config.ts`, `services/feedback-mcp/src/guards.ts`
- Modify: `vitest.config.ts:18` (add `'services/**/*.spec.ts'`)
- Test: `services/feedback-mcp/config.spec.ts`, `services/feedback-mcp/guards.spec.ts`

**Interfaces:**
- Produces: `type DbEntry = { db: string; label: string; key: string }`; `loadConfig(path: string, read?: (p: string) => string): DbEntry[]` (throws on a missing `dbs`, an empty list or a duplicate db); `assertDb(dbs: DbEntry[], db: string): DbEntry` (throws `unknown db`); `assertId(id: string): string` (throws `bad id`).

- [ ] **Step 1: Write the failing tests:** `loads dbs from file`, `throws on duplicate db`, and `rejects unlisted db and malformed id`. The last one asserts `assertDb(dbs,'../x')`, `assertId('abc?x=1')` and `assertId('ABC')` throw, and `assertId('0123456789abcdef01234567')` returns it.
- [ ] **Step 2: Run** `pnpm vitest run services/feedback-mcp`. Expected: FAIL (modules missing).
- [ ] **Step 3: Implement** `config.ts` and `guards.ts` per Interfaces, and add the vitest include.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(feedback-mcp): config and argument guards`.

### Task 2: Read-only Entu client

**Files:**
- Create: `services/feedback-mcp/src/entu.ts`
- Test: `services/feedback-mcp/entu.spec.ts`

**Interfaces:**
- Consumes: `DbEntry`, `assertId`.
- Produces: `type RawEntity = Record<string, unknown> & { _id: string }`; `class EntuReader { constructor(dbs: DbEntry[], fetchImpl?: typeof fetch); listFeedback(db: string): Promise<RawEntity[]>; getFeedback(db: string, id: string): Promise<RawEntity>; signFile(db: string, fileId: string): Promise<string>; fetchBytes(url: string): Promise<Uint8Array> }`. Also `listAll(): Promise<{ results: { db: string; entities: RawEntity[] }[]; errors: { db: string; message: string }[] }>`.
- `signFile` calls `GET /<db>/property/<fileId>` and returns `.url`, as `src/lib/repertoire/fileUrls.ts` does.

- [ ] **Step 1: Write the failing tests** with a recording mock `fetch`:
  - `every request is GET`: run all methods, and assert every recorded `init.method` is `undefined` or `'GET'`.
  - `pages until a short page`: 100 + 3 entities make 2 list calls, with `skip=0` and `skip=100`.
  - `401 re-auths once`: the first list returns 401, then the auth call, then 200. Assert exactly 2 auth calls, and that a second 401 throws.
  - `a failing db is reported, others still list`: in `listAll`, auth for db B returns 403. `results` holds A and `errors` is `[{db:'B',...}]`.
  - `token cached per db`: two lists on the same db make 1 auth call.
- [ ] **Step 2: Run** `pnpm vitest run services/feedback-mcp/entu.spec.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `EntuReader`. A private `get(db, path)` is the only fetch call site. It sends no method, no body, and the Bearer token.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(feedback-mcp): read-only Entu client`.

### Task 3: Report model, filters and counts

**Files:**
- Create: `services/feedback-mcp/src/report.ts`
- Test: `services/feedback-mcp/report.spec.ts` (synthetic fixtures only, no real names)

**Interfaces:**
- Consumes: `RawEntity`.
- Produces:
  - `type Report = { db: string; id: string; created: string; name: string | null; page: string | null; kind: 'automatic' | 'singer'; firstError: string | null; action: string | null; appVersion: string | null; description: string; metadata: unknown | null; issueUrls: string[]; senderId: string | null; senderName: string | null; screenshotFileId: string | null; doodleLayer: string | null }`
  - `toReport(db: string, e: RawEntity): Report`
  - `type Filter = { db?: string; since?: string; until?: string; page?: string; appVersion?: string; errorName?: string; kind?: 'automatic' | 'singer'; untriaged?: boolean }`
  - `matches(r: Report, f: Filter): boolean`
  - `countBy(rs: Report[], key: 'firstError' | 'action' | 'appVersion'): { value: string; count: number }[]`, sorted by count descending, with null as `"(none)"`.
- Field sources:
  - `page` is `metadata.route`, else `name` before the date.
  - `appVersion` is `metadata.version.commit`.
  - `firstError` is the ErrorName parsed from `metadata.problems[0].detail` (text before the first `:`), else the `(Name)` in the description.
  - `action` is `metadata.problems[0].action`.
  - `senderId`/`senderName` come from `_parent[0].reference`/`.string`.
  - `untriaged` means `issueUrls.length === 0`.
  - `errorName` and `page` match as substrings, case-insensitively.

- [ ] **Step 1: Write the failing tests:**
  - `automatic kind from description prefix`
  - `malformed metadata lists with nulls`: `metadata` is `"{oops"`, so `metadata`/`appVersion`/`firstError` are null and no throw.
  - `filters combine`: since + kind + untriaged.
  - `countBy groups and sorts`
- [ ] **Step 2: Run** `pnpm vitest run services/feedback-mcp/report.spec.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `report.ts`.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(feedback-mcp): report model, filters, counts`.

### Task 4: MCP protocol, tools and call log

**Files:**
- Create: `services/feedback-mcp/src/tools.ts`, `services/feedback-mcp/src/protocol.ts`, `services/feedback-mcp/src/image.ts`, `services/feedback-mcp/src/main.ts`
- Test: `services/feedback-mcp/tools.spec.ts`, `services/feedback-mcp/protocol.spec.ts`

**Interfaces:**
- Consumes: `EntuReader`, `toReport`, `matches`, `countBy`, `assertDb`, `assertId`.
- Produces:
  - `TOOL_DEFINITIONS` (`list_feedback`, `get_feedback`, `count_feedback`; each `inputSchema` mirrors `Filter`, plus `{db,id}` for get and `{by}` for count).
  - `type Ctx = { reader: EntuReader; dbs: DbEntry[]; team: string; log: (line: string) => void; resize: (png: Uint8Array, maxBytes: number) => Promise<Uint8Array> }`
  - `callTool(ctx: Ctx, name: string, args: unknown): Promise<ToolResult>`, where `ToolResult = { content: ({type:'text';text:string} | {type:'image';data:string;mimeType:'image/png'})[]; isError?: boolean }`
  - `handleMessage(ctx: Ctx, msg: unknown): Promise<JsonRpcResponse | null>`. It returns null for notifications and mirrors `entu-rights-mcp` for initialize, tools/list, error codes −32600/−32601/−32602, and `SERVER_NAME = 'mvox-feedback'`.
  - `image.ts` exports `downscaleToFit(png: Uint8Array, maxBytes: number): Promise<Uint8Array>`, using sharp and stepping width down until it fits.
  - `main.ts` parses `--team`, `--config` and `--log`, then reads newline-delimited JSON from stdin and writes responses to stdout. It writes nothing else to stdout.
- Output: `list_feedback` returns one text block. It holds a JSON array of summaries (db, id, created, page, kind, firstError, appVersion, untriaged) plus any `errors` from `listAll`. `get_feedback` returns a text block with the full `Report` as JSON, `description` wrapped as `{"user_submitted": "<text>"}` and cut at 10000 characters. If there's a screenshot, an image block follows.

- [ ] **Step 1: Write the failing tests** with a stub reader and a stub `resize`:
  - `list returns summaries across dbs`
  - `get returns report then image`
  - `no screenshot returns text only`
  - `screenshot over 1 MB is resized`: `resize` is called with `1048576`.
  - `description over 10000 chars is truncated with marker`
  - `every call logs team, tool and args but no description text`: assert the log line includes `team`, `get_feedback` and the id, and excludes the fixture description.
  - `bad args give isError, not a throw`
  - In protocol: `initialize advertises tools`, `tools/list has three tools`, `unknown method -32601`.
- [ ] **Step 2: Run** `pnpm vitest run services/feedback-mcp`. Expected: FAIL.
- [ ] **Step 3: Implement** `tools.ts`, `protocol.ts`, `image.ts` and `main.ts`. In `main.ts`, open the log with `appendFileSync`. If it can't be written, write to stderr and continue.
- [ ] **Step 4: Run.** Expected: PASS. Then run `pnpm check`. Expected: 0 errors.
- [ ] **Step 5: Smoke test:** run `printf '{"jsonrpc":"2.0","id":1,"method":"tools/list"}\n' | node services/feedback-mcp/dist/main.js --team mvox --config <fixture-config> --log /tmp/fb.log`. It should print one JSON line with 3 tools, after the package's `tsc` build.
- [ ] **Step 6: Commit** `feat(feedback-mcp): MCP tools over stdio`.

### Task 5: Sidecar image, SSH access and hand-off

**Files:**
- Create:
  - `services/feedback-mcp/Dockerfile`: node:22-slim + openssh-server. Build the package, then create user `feedback` with no password and no docker group. sshd runs as root in the container only.
  - `services/feedback-mcp/sshd_config`: `Port 2223`, `ListenAddress 0.0.0.0` inside the container, `PasswordAuthentication no`, `PermitRootLogin no`, `AllowUsers feedback`, `AuthorizedKeysFile /etc/feedback-mcp/authorized_keys`, `PermitTTY no`, `AllowTcpForwarding no`, `X11Forwarding no`.
  - `services/feedback-mcp/make-authorized-keys.ts`: reads lines `<team> <pubkey...>` and writes `restrict,command="/usr/local/bin/feedback-mcp --team <team>" <pubkey>`. Team must match `/^[a-z0-9-]+$/`.
  - `services/feedback-mcp/compose.snippet.yml`: publish `100.103.189.3:2223:2223` only, `restart: unless-stopped`, read-only mounts for `config.json`, `authorized_keys` and host keys, and a log volume.
  - `services/feedback-mcp/README.md`: what it serves, the readers ruling, the connect line `claude mcp add mvox-feedback -- ssh -p 2223 -i ~/.ssh/sm_<team> feedback@100.103.189.3`, the host steps, and how to add a team.
- Test: `services/feedback-mcp/authorized-keys.spec.ts`

**Interfaces:**
- Produces: `makeAuthorizedKeys(input: string): string` (throws on a bad team name or a line with no key).

- [ ] **Step 1: Write the failing tests:**
  - `each team line gets restrict and forced command`
  - `rejects team with shell characters`: `mvox;rm` throws.
  - `skips comments and blanks`
- [ ] **Step 2: Run** `pnpm vitest run services/feedback-mcp/authorized-keys.spec.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** it and write the Dockerfile, sshd_config, compose snippet and README.
- [ ] **Step 4: Run.** Expected: PASS. Generate `authorized_keys` from `~/workspace/scratchpad/feedback-mcp-keys.pub`, and check it has 3 lines with `restrict,command=`.
- [ ] **Step 5: Commit** `feat(feedback-mcp): sidecar image, ssh access, host hand-off`. Docker isn't available in the mvox container, so the image build and SSH check move to the hand-off: Mihkel or Passepartout apply the compose snippet on shipyard, and Passepartout connects and reports.

### Task 6: Live acceptance (after deploy)

- [ ] **Step 1:** Perotin runs `main.ts` directly, with no SSH, against a config of the real keys. Calls: `list_feedback {"db":"mvox_crede"}` should give 3 or more reports, and `get_feedback` on the newest should give its text and its screenshot if any. This is read-only and covered by the 2026-10-20 feedback ruling.
- [ ] **Step 2:** After the host deploy, each team runs the connect line, and `list_feedback` answers. Check the log shows each team.
