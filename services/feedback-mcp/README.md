# feedback-mcp

A read-only MCP server for mvox `feedback` reports. It reads every Entu db it holds a key for
and serves three tools:

- `list_feedback`: summaries, newest first, with filters for db, since/until, page, app version,
  error name, kind (`automatic` or `singer`) and untriaged (no linked issue yet).
- `get_feedback`: one report in full, with its screenshot as an image (downscaled when over 1 MB)
  and its doodle layer as stroke JSON. The description comes back under `user_submitted`.
- `count_feedback`: the same filters, grouped by first error, action or app version.

The only Entu calls are `GET`s. A db that fails (a revoked key, say) is named under `errors`;
the other dbs still answer. Every call writes one log line (time, team, tool, args) and never the
report text.

Design: `docs/superpowers/specs/2026-10-20-feedback-mcp-design.md`.

## Who may read

Mihkel, 2026-10-20: Palestrina, Henry, Gama and Passepartout may read collective feedback at any
time without asking. This covers feedback reads only. Every other live crede operation still needs
his go each time.

## Connect

```sh
claude mcp add mvox-feedback -- ssh -p 2223 -i ~/.ssh/sm_<team> feedback@100.103.189.3
```

Your key fixes your team. The login can do nothing but start the server.

## Run it from the repo

```sh
pnpm exec tsx services/feedback-mcp/src/main.ts --team mvox --config <config.json> --log <file>
```

Or build first with `pnpm exec tsc -p services/feedback-mcp/tsconfig.build.json` and run
`node services/feedback-mcp/dist/main.js` with the same flags. It reads newline-delimited JSON-RPC
on stdin. `sharp` isn't installed in the repo, so a screenshot over 1 MB comes back as a note (`isError`)
instead of an image there.

## Config

A JSON file, `/etc/feedback-mcp/config.json` by default. It is never read from env vars, because
sshd passes no environment to a forced command.

```json
{ "dbs": [{ "db": "mvox_crede", "label": "Crede", "key": "<api key>" }] }
```

Which dbs it lists is the deployer's choice. Never commit a config with keys.

## Host steps (shipyard, Mihkel or Passepartout)

Docker isn't available in the mvox container, so these run on shipyard.

1. Make `/srv/feedback-mcp/` and write `config.json` there. Make it readable by the container's
   `feedback` user only: `chown 10010 config.json && chmod 0400 config.json`.
2. Make a host key:
   `mkdir host-keys && ssh-keygen -t ed25519 -N '' -f host-keys/ssh_host_ed25519_key`.
3. Write `authorized_keys` from the team key list (see below) into `/srv/feedback-mcp/`, owned by
   root, mode 0644.
4. Merge `compose.snippet.yml` into the compose file next to the mvox container, then
   `docker compose up -d --build feedback-mcp`.
5. Check that `ss -ltn | grep 2223` shows only `100.103.189.3:2223`. Then, from a tailnet machine,
   send `{"jsonrpc":"2.0","id":1,"method":"tools/list"}` over the connect line's ssh command and
   look for three tools.

### Capabilities

The container drops every capability and sets `no-new-privileges`. It adds back only `SETUID`,
`SETGID` and `SYS_CHROOT`, which OpenSSH privilege separation uses. `CHOWN` and `AUDIT_WRITE` are
left out because sshd needs them only for a PTY login, and `PermitTTY no` rules those out. Port 2223
needs no `NET_BIND_SERVICE`. This list is not yet tested and is confirmed at deploy.

Without `DAC_OVERRIDE`, root in the container can't read a file it doesn't own. The host key under
`/srv/feedback-mcp/host-keys/` must be owned by root (uid 0), so run step 2 as root.

If sshd won't start or logins fail, read `docker compose logs feedback-mcp` and add back the
capability its error names:

| Log line | Add |
|---|---|
| `chroot("/run/sshd"): Operation not permitted` | `SYS_CHROOT` |
| `setgroups`, `setgid` or `setresgid` ... `Operation not permitted` | `SETGID` |
| `setuid`, `setresuid` or `permanently_set_uid` ... `Operation not permitted` | `SETUID` |
| `linux_audit_write_entry failed: Operation not permitted` | `AUDIT_WRITE` |
| `Could not load host key` or `Permission denied` on the host key | `chown root` the key, not a cap |
| `kill(<pid>): Operation not permitted` (cleanup after a failed login, harmless) | `KILL` |

Add a capability under `cap_add` in the compose file, then `docker compose up -d feedback-mcp`.

The `feedback` login has no Docker rights; Docker group membership is root on the host. sshd runs
inside this sidecar, never through `docker exec` from the host. The port is published on the
tailnet address only, because Docker's published ports bypass ufw.

## Add a team

1. The team mails its hub courier public key over the hub.
2. Add a line `<team> <public key>` to the key list (today
   `~/workspace/scratchpad/feedback-mcp-keys.pub`). The team name is `[a-z0-9-]+`.
3. Regenerate the file:
   `node --experimental-strip-types services/feedback-mcp/make-authorized-keys.ts <key list> > authorized_keys`.
   Each line comes out as `restrict,command="/usr/local/bin/feedback-mcp --team <team>" <key>`.
4. Copy it to `/srv/feedback-mcp/authorized_keys` on shipyard. sshd reads it on each login, so no
   restart is needed.

(*MVOX:Josquin*)
