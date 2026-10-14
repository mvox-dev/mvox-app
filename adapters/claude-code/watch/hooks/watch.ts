// Pure logic of the watch mod: no `$`, no I/O. Everything here is unit-tested.
//
// Sources are declared per kit home in memory-kit.conf (kit issue #9):
//
//   watch_sources:
//     - "hub mail | hub | comms/inboxes/team-lead.json"
//     - "kaarel | lines | ~/spool/kaarel.txt | ~/spool/archive/kaarel.txt"
//   watch_retire_step: "touch .fresh-next, then exit"

import type { PromptOrigin } from 'claude-code'

// ---------------------------------------------------------------------------------------------
// Sources.

export type Format = 'hub' | 'lines'

/**
 * Which entries of a shared hub inbox a source takes (kit #12): `unread` skips `read: true`,
 * `courier` takes only entries whose `from` ends in `-courier`. A source with either is shared:
 * the file is the harness's own teammate inbox, so only the taken entries leave it.
 */
export type Take = { unread: boolean; courier: boolean }

/** One declared source: the prefix each item arrives under, its format, its file, its archive. */
export type Source = { prefix: string; format: Format; path: string; archive?: string; take?: Take }

/** Parses `prefix | format [modifiers] | path [| archive]`; a string says what is wrong. */
export function parseSource(spec: string): Source | string {
  const parts = spec.split('|').map(p => p.trim())
  if (parts.length < 3 || parts.length > 4) return `expected "prefix | format | path [| archive]": ${spec}`
  const [prefix = '', formatField = '', path = '', archive] = parts
  const [format = '', ...modifiers] = formatField.split(/\s+/)
  if (prefix === '') return `empty prefix: ${spec}`
  if (format !== 'hub' && format !== 'lines') return `unknown format "${format}" (hub or lines): ${spec}`
  if (path === '') return `empty path: ${spec}`
  const source: Source = archive === undefined || archive === '' ? { prefix, format, path } : { prefix, format, path, archive }
  if (modifiers.length === 0) return source
  if (format !== 'hub') return `modifiers apply only to a hub format: ${spec}`
  const take: Take = { unread: false, courier: false }
  for (const m of modifiers) {
    if (m !== 'unread' && m !== 'courier') return `unknown modifier "${m}" (unread or courier): ${spec}`
    if (take[m]) return `modifier "${m}" given twice: ${spec}`
    take[m] = true
  }
  return { ...source, take }
}

/** Whether a shared source takes this inbox entry. */
export function takes(take: Take, entry: unknown): boolean {
  if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return false
  const e = entry as Record<string, unknown>
  if (take.unread && e.read === true) return false
  if (take.courier && !(typeof e.from === 'string' && e.from.endsWith('-courier'))) return false
  return true
}

/** How an inbox entry is known across polls: its msg_id, else its whole content. */
export function entryKey(entry: unknown): string {
  const id = (entry as { msg_id?: unknown } | null)?.msg_id
  return typeof id === 'string' && id !== '' ? `id:${id}` : `json:${JSON.stringify(entry)}`
}

/**
 * Courier mail stays this long in a shared inbox before the watch takes it: while the harness's
 * team is live it delivers (and removes) inbox entries itself within about a second (live check,
 * 2026-10-14), so the watch only takes what the harness is not picking up.
 */
export const COURIER_GRACE_MS = 30_000

/** The harness's lock (`<inbox>.lock`, a directory) is stale past this age, and broken. */
export const STALE_LOCK_MS = 60_000

/** Strips a trailing ` # comment` and one pair of enclosing quotes. */
function unquote(raw: string): string {
  const text = raw.trim()
  const quoted = /^(["'])(.*)\1(\s+#.*)?$/.exec(text)
  if (quoted) return quoted[2] ?? ''
  const hash = text.search(/(^|\s)#/)
  return (hash === -1 ? text : text.slice(0, hash)).trim()
}

/** A top-level `key: value` of memory-kit.conf, unquoted; undefined when absent or empty. */
export function confValue(conf: string, key: string): string | undefined {
  for (const raw of conf.split(/\r?\n/)) {
    if (!raw.startsWith(`${key}:`)) continue
    const v = unquote(raw.slice(key.length + 1))
    return v === '' ? undefined : v
  }
  return undefined
}

/** The `watch_sources:` block list of memory-kit.conf, each item unquoted. */
export function sourcesOf(conf: string): string[] {
  const out: string[] = []
  let inList = false
  for (const raw of conf.split(/\r?\n/)) {
    if (/^watch_sources:/.test(raw)) {
      inList = true
      continue
    }
    if (!inList || /^\s*(#.*)?$/.test(raw)) continue
    const item = /^\s*-\s+(.*)$/.exec(raw)
    if (!item) {
      if (!/^\s/.test(raw)) inList = false
      continue
    }
    const v = unquote(item[1] ?? '')
    if (v !== '') out.push(v)
  }
  return out
}

const ABSOLUTE = /^(\/|[A-Za-z]:[\\/]|\\\\)/

/** `~/` from the user's home, a relative path from the kit home; undefined when `~` has no home. */
export function expandHome(path: string, kitHome: string, userHome: string): string | undefined {
  if (path === '~' || path.startsWith('~/')) return userHome === '' ? undefined : `${userHome}${path.slice(1)}`
  return ABSOLUTE.test(path) ? path : `${kitHome}/${path}`
}

/** One path segment against a pattern with `*` wildcards. A dotfile never matches a wildcard. */
export function matchSegment(pattern: string, name: string): boolean {
  if (!pattern.includes('*')) return pattern === name
  if (name.startsWith('.') && !pattern.startsWith('.')) return false
  const re = new RegExp(`^${pattern.split('*').map(p => p.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`)
  return re.test(name)
}

// ---------------------------------------------------------------------------------------------
// Formats. An item is a head (who and when, '' for a plain line) and a body.

export type Item = { head: string; body: string }

/** A hub inbox: a JSON list of `{ from, text | summary, timestamp }`. undefined when it is not one. */
export function hubItems(text: string): Item[] | undefined {
  if (text.trim() === '') return []
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return undefined
  }
  if (!Array.isArray(data)) return undefined
  const items: Item[] = []
  for (const entry of data) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return undefined
    const m = entry as Record<string, unknown>
    const str = (v: unknown) => (typeof v === 'string' ? v : v === undefined || v === null ? '' : String(v))
    items.push({ head: `from ${str(m.from)} [${str(m.timestamp)}]`, body: str(m.text) || str(m.summary) })
  }
  return items
}

/** A spool: one item per non-blank line. */
export function lineItems(text: string): Item[] {
  return text
    .split(/\r?\n/)
    .map(l => l.trimEnd())
    .filter(l => l.trim() !== '')
    .map(body => ({ head: '', body }))
}

const dirOf = (path: string) => path.slice(0, Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')))
const baseOf = (path: string) => path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1)
const stemOf = (path: string) => baseOf(path).replace(/\.[^.]*$/, '')

/**
 * Where a drained file's items are kept: the source's archive (`{name}` is the file's stem),
 * else `archive/` beside the file: `<stem>-archive.json` for a hub inbox, the same name for lines.
 */
export function archiveFor(template: string | undefined, file: string, format: Format): string {
  if (template !== undefined) return template.replaceAll('{name}', stemOf(file))
  return `${dirOf(file)}/archive/${format === 'hub' ? `${stemOf(file)}-archive.json` : baseOf(file)}`
}

const ASIDE = '.watch-drain-'

/** The name a file is renamed to before it is read: a dotfile beside it, never matched by a glob. */
export function asideOf(file: string, now: number, nonce: number): string {
  return `${dirOf(file)}/${ASIDE}${baseOf(file)}-${now}-${nonce}`
}

/** Whether a directory entry is an aside of `file` (one this mod made, perhaps before a crash). */
export function isAsideOf(file: string, name: string): boolean {
  const head = `${ASIDE}${baseOf(file)}-`
  return name.startsWith(head) && /^\d+-\d+$/.test(name.slice(head.length))
}

const PENDING = '.watch-pending-'

/**
 * Where an aside's events wait once it is archived: the same name, `pending` for `drain`. Each
 * event leaves the file only after its $.prompt.submit was accepted.
 */
export function pendingOf(aside: string): string {
  const cut = Math.max(aside.lastIndexOf('/'), aside.lastIndexOf('\\')) + 1
  return `${aside.slice(0, cut)}${aside.slice(cut).replace(ASIDE, PENDING)}`
}

/** Whether a directory entry holds events of `file` still waiting for delivery. */
export function isPendingOf(file: string, name: string): boolean {
  const head = `${PENDING}${baseOf(file)}-`
  return name.startsWith(head) && /^\d+-\d+$/.test(name.slice(head.length))
}

/** The waiting events a pending file holds; [] for anything else. */
export function pendingEvents(text: string): string[] {
  try {
    const data: unknown = JSON.parse(text)
    return Array.isArray(data) ? data.filter((e): e is string => typeof e === 'string') : []
  } catch {
    return []
  }
}

/** After `failures` refused deliveries in a row: 1 min, doubling, at most 30 min. */
export function backoffMs(failures: number): number {
  return failures <= 0 ? 0 : Math.min(30 * 60_000, 60_000 * 2 ** (failures - 1))
}

// ---------------------------------------------------------------------------------------------
// Events: what one $.prompt.submit carries.

/** Longest event, in characters: the harness cuts long lines, so a long item is a preview. */
export const EVENT_LIMIT = 450

/** `[prefix] head: body`, or for a long body `[prefix] head (long: N chars, full text in <archive>): preview…`. */
export function formatEvent(prefix: string, item: Item, archive: string, limit = EVENT_LIMIT): string {
  const lead = `[${prefix}]${item.head === '' ? '' : ` ${item.head}`}`
  const whole = `${lead}${item.head === '' ? ' ' : ': '}${item.body}`
  if (Array.from(whole).length <= limit) return whole
  const chars = Array.from(item.body)
  const head = `${lead} (long: ${chars.length} chars, full text in ${archive}): `
  const room = Math.max(0, limit - Array.from(head).length - 1)
  return `${head}${chars.slice(0, room).join('')}…`
}

/** A prompt the human gave: typed, through Remote Control, or a Slack ping. */
export function isHuman(origin: PromptOrigin): boolean {
  return origin.kind === 'composer' || origin.kind === 'bridge' || origin.kind === 'slack-ping'
}

// ---------------------------------------------------------------------------------------------
// Checkpoint and retire on idle: the five guards (kit #9, PO comment 2026-10-14).

export const MINUTE = 60_000
export const HOUR = 60 * MINUTE
/** Guard 3: the ask still unanswered by a retire after this long raises one notice. */
export const SURVIVE_MS = HOUR
/** Guard 4: no retire within this long of the last one. */
export const BRAKE_GAP_MS = 2 * HOUR
/** Guard 4: at most this many retires in BRAKE_WINDOW_MS. */
export const BRAKE_MAX = 4
export const BRAKE_WINDOW_MS = 24 * HOUR

export type RetireConfig = { idleMs: number; growthFraction: number }

export type RetireInput = {
  now: number
  /** Last activity: a prompt, a step, a tool call, a turn's end. */
  idleSince: number
  /** Guard 1: a human prompt arrived since the session started. */
  humanSeen: boolean
  /** Guard 2: context tokens at the first human prompt (the startup's reading). */
  baseline: number
  tokens: number | undefined
  window: number
  /** Guard 3: when this session was asked, undefined if never. */
  askedAt: number | undefined
  survivedNotified: boolean
  /** Guard 5: the mod asks nothing before this time (the brake tripped). */
  stoppedUntil: number
  /** Guard 4: every retire ask in the shared store. */
  asks: readonly number[]
}

export type RetireAction = 'none' | 'ask' | 'survived' | 'brake'

/** The asks still inside the brake's 24 h window. */
export function recentAsks(asks: readonly number[], now: number): number[] {
  return asks.filter(t => now - t < BRAKE_WINDOW_MS && t <= now)
}

/** Guard 4: whether another retire may be asked now. */
export function brake(asks: readonly number[], now: number): { ok: true } | { ok: false; reason: string } {
  const recent = recentAsks(asks, now)
  if (recent.some(t => now - t < BRAKE_GAP_MS)) return { ok: false, reason: 'a retire less than 2 h ago' }
  if (recent.length >= BRAKE_MAX) return { ok: false, reason: `${BRAKE_MAX} retires in 24 h` }
  return { ok: true }
}

/** What the idle check does now. Every guard can only hold the ask back. */
export function decideRetire(cfg: RetireConfig, s: RetireInput): RetireAction {
  if (s.stoppedUntil > s.now) return 'none'
  if (s.askedAt !== undefined) return !s.survivedNotified && s.now - s.askedAt >= SURVIVE_MS ? 'survived' : 'none'
  if (!s.humanSeen) return 'none'
  if (s.now - s.idleSince < cfg.idleMs) return 'none'
  if (s.tokens === undefined || s.window <= 0) return 'none'
  if (s.tokens - s.baseline < cfg.growthFraction * s.window) return 'none'
  return brake(s.asks, s.now).ok ? 'ask' : 'brake'
}

/** The one checkpoint-and-retire prompt a session gets. */
export function retirePrompt(retireStep: string, idleMinutes: number, grownPercent: number): string {
  return [
    `This session has been idle for ${idleMinutes} min and its context has grown ${grownPercent}% of the window since the first human prompt.`,
    'Run your close routine now: regenerate the scratchpad current, run the lint, commit and push.',
    'If you were waiting for an answer from the human, put that question in the checkpoint with its exact wording.',
    `Then retire: ${retireStep}.`,
    'This is asked once per session.',
  ].join(' ')
}

// ---------------------------------------------------------------------------------------------
// Platform (kit alpha.9). $.fs has no rename or delete, so the drain runs four file operations
// on the host: POSIX mv / rm, or on Windows PowerShell's Move-Item / Remove-Item.

export type Platform = 'posix' | 'windows'

/** The operations: rename, rename only where nothing is (put-back), rename over, delete, and take / release a lock directory. */
export type FileOp =
  | { op: 'move' | 'move-keep' | 'move-replace'; from: string; to: string }
  | { op: 'remove' | 'lock' | 'unlock'; path: string }

/** Run where the home does not say: success means POSIX (macOS's BSD mv has no --version). */
export const PROBE_ARGV = ['uname', '-s'] as const

/** A drive-letter or UNC home is Windows; anything else needs the probe. */
export function platformOfHome(home: string): Platform | undefined {
  return /^([A-Za-z]:[\\/]|\\\\)/.test(home) ? 'windows' : undefined
}

/** A PowerShell single-quoted literal: no expansion; every character PowerShell reads as a single quote doubled. */
export function psQuote(text: string): string {
  return `'${text.replace(/['‘’‚‛]/g, q => q + q)}'`
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/** Base64 of the text's UTF-16LE bytes: what powershell.exe -EncodedCommand reads. */
export function base64Utf16le(text: string): string {
  const bytes: number[] = []
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i)
    bytes.push(unit & 0xff, unit >> 8)
  }
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const [a = 0, b = 0, c = 0] = [bytes[i], bytes[i + 1], bytes[i + 2]]
    const n = (a << 16) | (b << 8) | c
    out += B64[(n >> 18) & 63] ?? ''
    out += B64[(n >> 12) & 63] ?? ''
    out += i + 1 < bytes.length ? (B64[(n >> 6) & 63] ?? '') : '='
    out += i + 2 < bytes.length ? (B64[n & 63] ?? '') : '='
  }
  return out
}

/**
 * The argv for one operation. Windows: Windows PowerShell 5.1 (on every Windows 10 and 11), the
 * script passed as -EncodedCommand so no command-line quoting is involved; -LiteralPath so
 * `[ ]` in a path are not wildcards; a failure stops the script with exit code 1.
 */
export function fileOpArgv(platform: Platform, f: FileOp): string[] {
  if ('path' in f) {
    if (platform === 'posix') return f.op === 'remove' ? ['rm', '-f', '--', f.path] : [f.op === 'lock' ? 'mkdir' : 'rmdir', '--', f.path]
    const path = psQuote(f.path)
    return powershell(
      f.op === 'remove'
        ? `Remove-Item -LiteralPath ${path} -Force -ErrorAction SilentlyContinue`
        : f.op === 'lock'
          ? // New-Item has no -LiteralPath; it fails when the directory exists, which the lock needs.
            `New-Item -ItemType Directory -Path ${path} | Out-Null`
          : `Remove-Item -LiteralPath ${path} -Force`,
    )
  }
  if (platform === 'posix') {
    const flag = f.op === 'move-keep' ? ['-n'] : f.op === 'move-replace' ? ['-f'] : []
    return ['mv', ...flag, '--', f.from, f.to]
  }
  return powershell(`Move-Item -LiteralPath ${psQuote(f.from)} -Destination ${psQuote(f.to)}${f.op === 'move-replace' ? ' -Force' : ''}`)
}

function powershell(command: string): string[] {
  const script = `$ErrorActionPreference = 'Stop'; ${command}`
  return ['powershell.exe', '-NoProfile', '-NonInteractive', '-EncodedCommand', base64Utf16le(script)]
}

/** A path's segments for glob expansion, on either separator; a leading '' is the POSIX root. */
export function pathSegments(path: string): string[] {
  return path.split(/[\\/]/)
}
