// Pure logic of the obligations pane: no `$`, no I/O. Everything here is unit-tested.
//
// Shape of the data: memory-kit/types/memory-obligations.ts (obligations: [{obligation, actor,
// owed_to, since, check, expires, ref}]). URL tier: memory-kit/types/memory-urls.ts
// (memory/urls/<name>, one URL on line 1).

import type { AgentLoad, ObligationRow, PaneAgent, WorkflowRun } from '../types'

// ---------------------------------------------------------------------------------------------
// Parsing: a small strict parser for exactly the obligations shape. The mod environment has no
// node_modules and no bundler, so no YAML dependency. Anything outside the shape is an error
// with a line number, never a silent guess.

export type ParseResult =
  | { kind: 'ok'; items: ObligationRow[] }
  | { kind: 'error'; line: number; message: string }

const KEYS = ['obligation', 'actor', 'owed_to', 'since', 'check', 'expires', 'ref'] as const
type Key = (typeof KEYS)[number]
const REQUIRED: readonly Key[] = ['obligation', 'actor', 'expires']
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

class ParseError extends Error {
  constructor(
    readonly line: number,
    message: string,
  ) {
    super(message)
  }
}

/** Strips a trailing ` # comment` from a plain (unquoted) scalar. */
function plainScalar(raw: string): string {
  const hash = raw.search(/(^|\s)#/)
  return (hash === -1 ? raw : raw.slice(0, hash)).trim()
}

const ESCAPES: Record<string, string> = {
  '0': '\0', a: '\x07', b: '\b', t: '\t', n: '\n', v: '\v', f: '\f', r: '\r', e: '\x1b',
  ' ': ' ', '"': '"', '/': '/', '\\': '\\', N: '\x85', _: '\xa0', L: ' ', P: ' ',
}
const HEX_ESCAPES: Record<string, number> = { x: 2, u: 4, U: 8 }

/**
 * Line folding inside a flow scalar: `text` holds the scalar's lines joined by '\n'. Each
 * line is trimmed (the first only at its end, the last only at its start); one break
 * becomes a space, each empty line between two lines a '\n'.
 */
function fold(lines: readonly string[]): string {
  let out = ''
  let empties = 0
  lines.forEach((raw, i) => {
    let line = i === 0 ? raw : raw.trimStart()
    if (i < lines.length - 1) line = line.trimEnd()
    if (i > 0 && line === '' && i < lines.length - 1) {
      empties++
      return
    }
    if (i > 0) out += empties > 0 ? '\n'.repeat(empties) : ' '
    empties = 0
    out += line
  })
  return out
}

/**
 * One scalar value: double-quoted, single-quoted, or plain, as YAML reads it. `raw` is the
 * value's first line and any continuation lines, joined by '\n' (yaml.safe_dump folds long
 * values onto indented continuation lines). `null` and `~` written plain are empty.
 */
export function parseScalar(raw: string, line: number): string {
  const text = raw.trim()
  if (text.startsWith('"')) {
    // The scalar's lines, escapes marked; folded once the closing quote is found.
    const parts: string[] = []
    let current = ''
    let lineNo = line
    for (let i = 1; i < text.length; i++) {
      const c = text[i] ?? ''
      if (c === '"') {
        const rest = text.slice(i + 1).trim()
        if (rest !== '' && !rest.startsWith('#')) throw new ParseError(lineNo, 'text after closing quote')
        parts.push(current)
        return foldQuoted(parts)
      }
      if (c === '\n') {
        lineNo++
        parts.push(current)
        current = ''
        continue
      }
      if (c === '\\') {
        const n = text[++i] ?? ''
        if (n === '\n') {
          // Escaped break: the lines join with nothing between, the next line's indent dropped.
          lineNo++
          while (text[i + 1] === ' ') i++
          continue
        }
        const width = HEX_ESCAPES[n]
        if (width !== undefined) {
          const hex = text.slice(i + 1, i + 1 + width)
          if (!new RegExp(`^[0-9A-Fa-f]{${width}}$`).test(hex)) throw new ParseError(lineNo, `bad escape \\${n}${hex}`)
          current += escapeMark(String.fromCodePoint(Number.parseInt(hex, 16)))
          i += width
          continue
        }
        const mapped = ESCAPES[n]
        if (mapped === undefined) throw new ParseError(lineNo, `unsupported escape \\${n}`)
        current += escapeMark(mapped)
        continue
      }
      current += c
    }
    throw new ParseError(line, 'unterminated double-quoted string')
  }
  if (text.startsWith("'")) {
    let out = ''
    for (let i = 1; i < text.length; i++) {
      const c = text[i]
      if (c === "'") {
        if (text[i + 1] === "'") {
          out += "'"
          i++
          continue
        }
        const rest = text.slice(i + 1).trim()
        if (rest !== '' && !rest.startsWith('#')) throw new ParseError(line + lineCount(text.slice(0, i)), 'text after closing quote')
        return fold(out.split('\n'))
      }
      out += c
    }
    throw new ParseError(line, 'unterminated single-quoted string')
  }
  const lines = text.split('\n')
  lines.forEach((l, i) => {
    if (i < lines.length - 1 && plainScalar(l) !== l.trim()) throw new ParseError(line + i, 'a comment cannot continue onto the next line')
  })
  const plain = fold(lines.map(plainScalar))
  if (/^[|>]/.test(plain)) throw new ParseError(line, 'block scalars (| or >) are not supported')
  if (/^[[{&*!]/.test(plain)) throw new ParseError(line, `unsupported value: ${plain.slice(0, 20)}`)
  if (plain === '~' || /^(null|Null|NULL)$/.test(plain)) return ''
  return plain
}

function lineCount(text: string): number {
  return text.split('\n').length - 1
}

// Escaped characters are content, never trimmed or folded: each is carried as a mark with
// no whitespace in it (U+0000, the code point in hex, ';') until folding is done.
const escapeMark = (c: string) => `\u0000${(c.codePointAt(0) ?? 0).toString(16)};`

function foldQuoted(parts: readonly string[]): string {
  return fold(parts).replace(/\u0000([0-9a-f]+);/g, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
}

/** Splits `key: value` (value may be empty). */
function keyValue(text: string, line: number): [string, string] {
  const m = /^([A-Za-z_][\w-]*):(\s+(.*))?$/.exec(text)
  if (!m) throw new ParseError(line, `expected "key: value", got: ${text.slice(0, 40)}`)
  return [m[1] ?? '', m[3] ?? '']
}

/**
 * Parses memory/obligations.yaml. Accepts: comments, blank lines, one top-level key
 * `obligations:` holding a block list of flat maps (or `[]`), scalar values quoted or plain.
 * The list items may sit at column 0 under the key, as yaml.safe_dump writes them, or be
 * indented; a value may continue on lines indented deeper than its key (folded as YAML does).
 * Every item records the 1-based line it starts on: file order for ties, and a stable row key.
 */
export function parseObligations(text: string): ParseResult {
  try {
    return { kind: 'ok', items: parseOrThrow(text) }
  } catch (err) {
    if (err instanceof ParseError) return { kind: 'error', line: err.line, message: err.message }
    throw err
  }
}

function parseOrThrow(text: string): ObligationRow[] {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/)
  const items: ObligationRow[] = []
  let seenTop = false
  let isEmptyList = false
  let itemIndent = -1
  let keyIndent = -1
  let current: (Partial<Record<Key, string>> & { line: number }) | undefined
  // The key whose value is still open: continuation lines join it until the next key or item.
  let pending: { key: string; raw: string[]; line: number; blanks: number } | undefined

  const flush = () => {
    if (!pending) return
    const { key, raw, line } = pending
    pending = undefined
    if (!current) throw new ParseError(line, 'key outside a list item')
    if (!(KEYS as readonly string[]).includes(key)) throw new ParseError(line, `unknown key "${key}"`)
    if (current[key as Key] !== undefined) throw new ParseError(line, `duplicate key "${key}"`)
    // A value that starts on the next line: the scalar is the continuation alone.
    const value = raw[0]?.trim() === '' && raw.length > 1 ? raw.slice(1) : raw
    current[key as Key] = parseScalar(value.join('\n'), line)
  }

  const close = () => {
    flush()
    if (!current) return
    for (const key of REQUIRED) {
      if (current[key] === undefined || current[key] === '') {
        throw new ParseError(current.line, `item is missing "${key}"`)
      }
    }
    for (const key of ['since', 'expires'] as const) {
      const v = current[key]
      if (v !== undefined && v !== '' && !ISO_DATE.test(v)) {
        throw new ParseError(current.line, `"${key}" is not an ISO date (YYYY-MM-DD): ${v}`)
      }
    }
    items.push({
      obligation: current.obligation ?? '',
      actor: current.actor ?? '',
      owed_to: current.owed_to ?? '',
      since: current.since ?? '',
      check: current.check ?? '',
      expires: current.expires ?? '',
      ref: current.ref ?? '',
      line: current.line,
    })
    current = undefined
  }

  const openKey = (text: string, line: number) => {
    flush()
    const [key, value] = keyValue(text, line)
    pending = { key, raw: [value], line, blanks: 0 }
  }

  /** Inside an open quoted value, every line is content, a '#' or a blank line included. */
  const inOpenQuote = (): boolean => {
    if (!pending) return false
    const value = pending.raw.join('\n').trim()
    if (value.startsWith("'")) return !/^'(?:[^']|'')*'/.test(value)
    if (value.startsWith('"')) return !/^"(?:[^"\\]|\\[\s\S])*"/.test(value)
    return false
  }

  lines.forEach((raw, i) => {
    const line = i + 1
    const blank = /^\s*(#.*)?$/.test(raw)
    if (raw.includes('\t') && !inOpenQuote()) throw new ParseError(line, 'tab in indentation')
    const indent = raw.length - raw.trimStart().length

    // A continuation line: deeper than the open value's key, or anything inside an open quote.
    if (pending && (inOpenQuote() || (!blank && indent > keyIndent))) {
      if (raw.trim() === '') {
        pending.blanks++
        return
      }
      const quoted = /^\s*['"]/.test(pending.raw.join('\n'))
      if (!quoted && /^[A-Za-z_][\w-]*:(\s|$)/.test(raw.trim())) {
        throw new ParseError(line, 'key at inconsistent indent (nested values are not supported)')
      }
      for (; pending.blanks > 0; pending.blanks--) pending.raw.push('')
      pending.raw.push(raw)
      return
    }
    if (blank) {
      if (pending && raw.trim() === '') pending.blanks++
      return
    }
    if (pending) pending.blanks = 0
    const body = raw.trim()
    const isItem = body.startsWith('- ') || body === '-'

    if (indent === 0 && !(isItem && seenTop)) {
      if (seenTop) throw new ParseError(line, `unexpected top-level line: ${body.slice(0, 40)}`)
      if (isItem) throw new ParseError(line, 'expected "obligations:" first')
      const [key, value] = keyValue(body, line)
      if (key !== 'obligations') throw new ParseError(line, `unknown top-level key "${key}"`)
      seenTop = true
      const v = plainScalar(value)
      if (v === '[]') isEmptyList = true
      else if (v !== '') throw new ParseError(line, '"obligations" must be a list')
      return
    }
    if (!seenTop) throw new ParseError(line, 'expected "obligations:" first')
    if (isEmptyList) throw new ParseError(line, 'content after "obligations: []"')

    if (isItem) {
      if (itemIndent === -1) itemIndent = indent
      if (indent !== itemIndent) throw new ParseError(line, 'list item at inconsistent indent')
      close()
      current = { line }
      const rest = body.slice(1).trimStart()
      if (rest === '') return
      const firstKeyIndent = indent + (body.length - rest.length)
      if (keyIndent === -1) keyIndent = firstKeyIndent
      else if (firstKeyIndent !== keyIndent) throw new ParseError(line, 'key at inconsistent indent')
      openKey(rest, line)
      return
    }

    if (!current) throw new ParseError(line, 'expected a list item ("- ")')
    if (keyIndent === -1) {
      if (indent <= itemIndent) throw new ParseError(line, 'key at inconsistent indent')
      keyIndent = indent
    }
    if (indent !== keyIndent) throw new ParseError(line, 'key at inconsistent indent (nested values are not supported)')
    openKey(body, line)
  })

  if (!seenTop) {
    // A file holding only comments is an empty ledger, not an error.
    if (lines.every(l => /^\s*(#.*)?$/.test(l))) return []
    throw new ParseError(1, 'expected "obligations:"')
  }
  close()
  return items
}

/** A top-level `key: value` of a kit home's memory-kit.conf, unquoted; undefined when absent or empty. */
export function confValue(conf: string, key: string): string | undefined {
  for (const raw of conf.split(/\r?\n/)) {
    if (!raw.startsWith(`${key}:`)) continue
    const v = plainScalar(raw.slice(key.length + 1)).replace(/^["']|["']$/g, '')
    return v === '' ? undefined : v
  }
  return undefined
}

/**
 * An absolute path: POSIX (/...), drive letter (C:\ or C:/) or UNC (\\server\share). The mod
 * has no Node, so no path.isAbsolute (kit #8).
 */
export function isAbsolutePath(path: string): boolean {
  return /^(\/|[A-Za-z]:[\\/]|\\\\)/.test(path)
}

/** The directory holding `path`, POSIX or Windows separators: '/' at the root, '.' for a bare name. */
export function parentDir(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, '')
  const cut = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  if (cut === -1) return '.'
  return cut === 0 ? trimmed.slice(0, 1) : trimmed.slice(0, cut)
}

/** Reads `memory_dir:` from a kit home's memory-kit.conf; undefined when absent. */
export function memoryDirOf(conf: string): string | undefined {
  return confValue(conf, 'memory_dir')
}

/**
 * The main agent's footer name (gh#4): the home's `agent_name:`, else the agentName option,
 * else the folder's name. The home wins because plugin options are user-wide: a box with
 * several homes needs each to name itself.
 */
export function selfName(conf: string, option: string, cwd: string): string {
  return confValue(conf, 'agent_name') ?? (option || basename(cwd))
}

// ---------------------------------------------------------------------------------------------
// The home's kit version (kit #4) and the upstream release check (kit #7).

/** The version a home's memory-kit/VERSION names: line 1, trimmed; undefined when empty. */
export function kitVersionOf(text: string): string | undefined {
  const first = (text.split(/\r?\n/)[0] ?? '').trim()
  return first === '' ? undefined : first
}

export type Release = { major: number; minor: number; patch: number; pre?: { kind: 'alpha' | 'beta' | 'rc'; n: number } }

const NUM = '(0|[1-9]\\d*)'
const RELEASE = new RegExp(`^v?${NUM}\\.${NUM}\\.${NUM}(?:-(alpha|beta|rc)\\.${NUM})?$`)

/** A release tag or version: v<maj>.<min>.<patch>, optional -alpha.N, -beta.N or -rc.N; else undefined. */
export function parseRelease(tag: string): Release | undefined {
  const m = RELEASE.exec(tag.trim())
  if (!m) return undefined
  const core = { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) }
  return m[4] === undefined ? core : { ...core, pre: { kind: m[4] as 'alpha' | 'beta' | 'rc', n: Number(m[5]) } }
}

const PRE_ORDER = { alpha: 0, beta: 1, rc: 2 } as const

/** Semver precedence: core numbers, then a release above its pre-releases, then alpha < beta < rc, then N. */
export function compareRelease(a: Release, b: Release): number {
  const core = a.major - b.major || a.minor - b.minor || a.patch - b.patch
  if (core !== 0) return core
  if (a.pre === undefined || b.pre === undefined) return (a.pre === undefined ? 1 : 0) - (b.pre === undefined ? 1 : 0)
  return PRE_ORDER[a.pre.kind] - PRE_ORDER[b.pre.kind] || a.pre.n - b.pre.n
}

const versionText = (r: Release) =>
  `${r.major}.${r.minor}.${r.patch}${r.pre === undefined ? '' : `-${r.pre.kind}.${r.pre.n}`}`

/** The newest release among tag names, as a version without the `v`; undefined when none is a release. */
export function newestRelease(names: readonly string[]): string | undefined {
  let best: Release | undefined
  for (const name of names) {
    const r = parseRelease(name)
    if (r !== undefined && (best === undefined || compareRelease(r, best) > 0)) best = r
  }
  return best === undefined ? undefined : versionText(best)
}

/**
 * What the header adds when upstream is ahead: the pre-release alone (`alpha.6`) when the
 * core is the same, else the whole version. '' when not newer, or either side is not a release.
 */
export function updateNote(local: string, latest: string): string {
  const mine = parseRelease(local)
  const theirs = parseRelease(latest)
  if (mine === undefined || theirs === undefined || compareRelease(theirs, mine) <= 0) return ''
  const sameCore = mine.major === theirs.major && mine.minor === theirs.minor && mine.patch === theirs.patch
  return sameCore && theirs.pre !== undefined ? `${theirs.pre.kind}.${theirs.pre.n}` : versionText(theirs)
}

/** The header's version slot: `memory-kit <version>`, ` · <note> out` when upstream is ahead; '' without a version. */
export function kitLabel(version: string, note: string): string {
  if (version === '') return ''
  return note === '' ? `memory-kit ${version}` : `memory-kit ${version} · ${note} out`
}

export const DEFAULT_UPSTREAM = 'mitselek/memory-kit'
const REPO_PART = '[A-Za-z0-9_][A-Za-z0-9_.-]*'
const OWNER_REPO = new RegExp(`^${REPO_PART}/${REPO_PART}$`)

/**
 * The tags API URL for memory-kit.conf's `upstream:` (owner/repo on Codeberg; the kit's own
 * repository when absent). undefined for any other value: no request is made.
 */
export function upstreamTagsUrl(upstream: string | undefined): string | undefined {
  const repo = upstream ?? DEFAULT_UPSTREAM
  if (!OWNER_REPO.test(repo) || repo.split('/').some(p => /^\.+$/.test(p))) return undefined
  return `https://codeberg.org/api/v1/repos/${repo}/tags?limit=50`
}

/** Tag names from a tags API answer (a JSON list of `{ name }`); undefined for anything else. */
export function tagNamesOf(text: string): string[] | undefined {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return undefined
  }
  if (!Array.isArray(data)) return undefined
  const names: string[] = []
  for (const tag of data) {
    const name = (tag as { name?: unknown } | null)?.name
    if (typeof name !== 'string') return undefined
    names.push(name)
  }
  return names
}

/** A tags request not answered by then counts as a failed check: $.http.fetch has no timeout of its own. */
export const FETCH_TIMEOUT_MS = 10_000

/** At most one request per upstream in this long, across every session ($.store). */
export const UPDATE_INTERVAL_MS = 6 * 3_600_000

/** One upstream's last check: when, and the newest release then known ('' for none). */
export type UpstreamCheck = { checkedAt: number; latest: string }

/** A check made within the interval. A clock that went back makes it stale. */
export function isFresh(checkedAt: number, now: number): boolean {
  const age = now - checkedAt
  return age >= 0 && age < UPDATE_INTERVAL_MS
}

/** The stored check for `url` from the store's `upstream` value (url -> check); undefined when absent or malformed. */
export function cachedCheck(stored: unknown, url: string): UpstreamCheck | undefined {
  if (typeof stored !== 'object' || stored === null) return undefined
  const entry = (stored as Record<string, unknown>)[url] as Partial<UpstreamCheck> | undefined
  if (typeof entry?.checkedAt !== 'number' || typeof entry.latest !== 'string') return undefined
  return { checkedAt: entry.checkedAt, latest: entry.latest }
}

// ---------------------------------------------------------------------------------------------
// Dates. The plugin environment's local time zone is not trusted: the offset is passed in.

/** `YYYY-MM-DD` of an instant at a UTC offset (minutes east of UTC). */
export function isoDate(now: number, offsetMinutes: number): string {
  return new Date(now + offsetMinutes * 60_000).toISOString().slice(0, 10)
}

/** `YYYY-MM-DD HH:MM` of an instant at a UTC offset. */
export function isoMinute(now: number, offsetMinutes: number): string {
  return new Date(now + offsetMinutes * 60_000).toISOString().slice(0, 16).replace('T', ' ')
}

/** Adds whole days to an ISO date. */
export function addDays(date: string, days: number): string {
  const t = Date.parse(`${date}T00:00:00Z`)
  return new Date(t + days * 86_400_000).toISOString().slice(0, 10)
}

/** Parses `date +%z` output (`+0300`, `-0530`) into minutes east of UTC. */
export function offsetFromZ(z: string): number | undefined {
  const m = /^([+-])(\d{2})(\d{2})$/.exec(z.trim())
  if (!m) return undefined
  const minutes = Number(m[2]) * 60 + Number(m[3])
  return m[1] === '-' ? -minutes : minutes
}

// ---------------------------------------------------------------------------------------------
// Ordering and counts.

/** Soonest expiry first (so expired rows lead); ties by `since`, then file order. */
export function sortByExpires(items: readonly ObligationRow[]): ObligationRow[] {
  return [...items].sort(
    (a, b) => a.expires.localeCompare(b.expires) || a.since.localeCompare(b.since) || a.line - b.line,
  )
}

export type Status = 'expired' | 'due' | 'later'

/** expired: expires before today. due: today .. today+7 inclusive. */
export function statusOf(item: ObligationRow, today: string): Status {
  if (item.expires < today) return 'expired'
  if (item.expires <= addDays(today, 7)) return 'due'
  return 'later'
}

export function countsOf(items: readonly ObligationRow[], today: string): { expired: number; due: number } {
  let expired = 0
  let due = 0
  for (const item of items) {
    const s = statusOf(item, today)
    if (s === 'expired') expired++
    else if (s === 'due') due++
  }
  return { expired, due }
}

export function countsLabel(c: { expired: number; due: number }): string {
  return `${c.expired} expired · ${c.due} due ≤7d`
}

// ---------------------------------------------------------------------------------------------
// Scrolling: an index into the sorted list, stepped one item at a time.

export function clampIndex(index: number, length: number): number {
  if (length <= 0 || !Number.isFinite(index)) return 0
  return Math.min(Math.max(0, Math.trunc(index)), length - 1)
}

export function step(index: number, delta: number, length: number): number {
  return clampIndex(clampIndex(index, length) + delta, length)
}

// ---------------------------------------------------------------------------------------------
// Footer columns.

export const NAME_WIDTH = 10
export const ACTOR_WIDTH = 20

/** At most `width` code points: longer is width-1 chars + "…". No padding. */
export function capName(name: string, width: number): string {
  const chars = Array.from(name.trim())
  return chars.length > width ? chars.slice(0, width - 1).join('') + '…' : chars.join('')
}

/** Footer column: exactly 10 code points, capped as capName, shorter right-padded. */
export function fitName(name: string, width = NAME_WIDTH): string {
  const capped = capName(name, width)
  return capped + ' '.repeat(width - Array.from(capped).length)
}

/** Row actor: capped at 20 so the task text starts on the first line. */
export function fitActor(actor: string): string {
  return capName(actor, ACTOR_WIDTH)
}

/** '·' (drawn dim) when the model is unknown: a question mark reads as an error. */
export type ModelLetter = 'F' | 'O' | 'S' | 'H' | '·'

export function modelLetter(model: string | undefined): ModelLetter {
  const m = (model ?? '').toLowerCase()
  if (m.includes('fable')) return 'F'
  if (m.includes('opus')) return 'O'
  if (m.includes('sonnet')) return 'S'
  if (m.includes('haiku')) return 'H'
  return '·'
}

export const MODEL_COLORS: Record<ModelLetter, string> = {
  F: '#b0006a',
  O: '#c24e00',
  S: '#005fb8',
  H: '#1b7a2e',
  '·': '#666666',
}

/** 127k, 1M, 1.5M, 950. */
export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${Number((n / 1_000_000).toFixed(1))}M`
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`
  return String(Math.round(n))
}

export function contextWeight(tokens: number | undefined, window: number | undefined): string {
  const used = tokens === undefined ? '-' : formatTokens(tokens)
  return window === undefined || window <= 0 ? used : `${used}/${formatTokens(window)}`
}

/** Live agents (anything not finished), oldest first as listed. */
export function liveAgents(agents: readonly PaneAgent[]): PaneAgent[] {
  return agents.filter(a => a.status !== 'completed' && a.status !== 'failed' && a.status !== 'killed')
}

// ---------------------------------------------------------------------------------------------
// Colours. Pane background is a bright pastel; actor colours are saturated darks that read on it.

export const PANE_BG = '#fff3b0'
export const HEADER_BG = '#1f1b3a'
export const HEADER_FG = '#fff3b0'
export const DATE_FG = '#000000'
export const EXPIRED_DATE_BG = '#ffb4a8'
export const LINK_FG = '#00008b'
export const MIHKEL_COLOR = '#d4006f'

/** Saturated, dark enough for the pastel; no plain blue (links are dark blue), no Mihkel pink. */
export const ACTOR_PALETTE = [
  '#7b1fa2', // purple
  '#00796b', // teal
  '#b34700', // burnt orange
  '#2e7d32', // green
  '#5d4037', // brown
  '#6a1b9a', // violet
  '#00838f', // cyan-teal
  '#9e2a2b', // brick
  '#556b2f', // olive
  '#8e24aa', // orchid
] as const

/** FNV-1a, 32-bit. Deterministic across sessions and machines. */
export function hash(text: string): number {
  let h = 0x811c9dc5
  for (const ch of text) {
    h ^= ch.codePointAt(0) ?? 0
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h >>> 0
}

export function actorColor(actor: string): string {
  const key = actor.trim().toLowerCase()
  if (key === 'mihkel') return MIHKEL_COLOR
  return ACTOR_PALETTE[hash(key) % ACTOR_PALETTE.length] ?? ACTOR_PALETTE[0]
}

// ---------------------------------------------------------------------------------------------
// urls/<name> links.

const URL_REF = /urls\/([a-z0-9][a-z0-9-]*)/g

/** Every urls/<name> cited in a row's text, check or ref, each once, in order. */
export function urlNamesOf(item: Pick<ObligationRow, 'obligation' | 'check' | 'ref'>): string[] {
  const names: string[] = []
  for (const field of [item.obligation, item.check, item.ref]) {
    for (const m of field.matchAll(URL_REF)) {
      const name = m[1] ?? ''
      if (!names.includes(name)) names.push(name)
    }
  }
  return names
}

/** The URL a memory/urls/<name> file holds: line 1, trimmed; undefined when unusable. */
export function urlOfFile(text: string): string | undefined {
  const first = (text.split(/\r?\n/)[0] ?? '').trim()
  if (first === '' || /\s/.test(first) || first.length > 2048) return undefined
  return first
}

export type Segment =
  | { kind: 'text'; text: string }
  | { kind: 'link'; name: string; href: string }
  | { kind: 'dead'; name: string }

/** Splits text at each urls/<name>, resolved against `urls` (name -> URL). */
export function segmentsOf(text: string, urls: Readonly<Record<string, string>>): Segment[] {
  const out: Segment[] = []
  let at = 0
  for (const m of text.matchAll(URL_REF)) {
    const start = m.index ?? 0
    if (start > at) out.push({ kind: 'text', text: text.slice(at, start) })
    const name = m[1] ?? ''
    const href = urls[name]
    out.push(href === undefined ? { kind: 'dead', name } : { kind: 'link', name, href })
    at = start + m[0].length
  }
  if (at < text.length) out.push({ kind: 'text', text: text.slice(at) })
  return out
}

/** Links cited in check or ref but not in the obligation text: drawn after the text. */
export function trailingLinksOf(item: ObligationRow, urls: Readonly<Record<string, string>>): Segment[] {
  const inText = new Set(segmentsOf(item.obligation, {}).flatMap(s => (s.kind === 'text' ? [] : [s.name])))
  return urlNamesOf(item)
    .filter(name => !inText.has(name))
    .map(name => {
      const href = urls[name]
      return href === undefined ? { kind: 'dead' as const, name } : { kind: 'link' as const, name, href }
    })
}

/** Last path component; used as the default agent name. */
export function basename(path: string): string {
  const parts = path.split('/').filter(p => p !== '')
  return parts[parts.length - 1] ?? path
}

// ---------------------------------------------------------------------------------------------
// Subagent context load, from turn.step usage.

/** The token counts one step reported (ModelUsage) and the model that answered. */
export type StepUsage = {
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens: number
  cache_creation_input_tokens: number
  model: string
}

/**
 * A loop's context load after a step: the request's input side (uncached, cache read and cache
 * write), as Claude Code computes the status line's used_percentage. Output is left out (0.6.0).
 */
export function contextLoad(u: StepUsage): number {
  return u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens
}

/**
 * Records a subagent's latest step (latest wins). The main loop (no agentId) and steps
 * with no usage leave the map as it was: the main line has its own figures.
 */
export function recordStep(
  loads: Readonly<Record<string, AgentLoad>>,
  agentId: string | undefined,
  usage: StepUsage | null,
): Record<string, AgentLoad> {
  if (agentId === undefined || usage === null) return { ...loads }
  return { ...loads, [agentId]: { tokens: contextLoad(usage), model: usage.model } }
}

/**
 * A subagent's load as the footer shows it: used/window when it runs on the main loop's
 * model (whose window the session reports), the used figure alone otherwise, '' when unknown.
 */
export function subagentWeight(load: AgentLoad | undefined, mainModel: string, mainWindow: number | null): string {
  if (load === undefined) return ''
  const same = mainModel !== '' && load.model.trim().toLowerCase() === mainModel.trim().toLowerCase()
  return contextWeight(load.tokens, same && mainWindow !== null ? mainWindow : undefined)
}

/** Columns the footer takes around its lines: paddingX 1 each side, as the body rows. */
export const FOOTER_CHROME = 2

export const RULE_COLOR = '#b8a24a'

/** The workflow mark (≡) on a footer line, where an agent's model letter stands. */
export const WORKFLOW_FG = '#1f1b3a'

/**
 * The figure a footer line can show in `available` columns: `used/window` when the whole line
 * (name 10, space, letter, space, figure) fits, else `used` alone. Never cut inside the figure.
 */
export function fitWeight(weight: string, available: number): string {
  if (weight === '' || NAME_WIDTH + 3 + Array.from(weight).length <= available) return weight
  return weight.split('/')[0] ?? weight
}

/** After a wheel step, further ui.scroll events are ignored this long: one burst, one item. */
export const WHEEL_THROTTLE_MS = 150

/**
 * One wheel event: the items to step (-1, 0 or 1, never |by|) and the new last-step time.
 * An event within WHEEL_THROTTLE_MS after the last step is ignored.
 */
export function wheelStep(by: number, now: number, lastStep: number | undefined): { delta: number; lastStep: number | undefined } {
  const gap = lastStep === undefined ? Infinity : now - lastStep
  // A clock that went backwards (a reset) starts a fresh burst.
  if (by === 0 || (gap >= 0 && gap < WHEEL_THROTTLE_MS)) return { delta: 0, lastStep }
  return { delta: Math.sign(by), lastStep: now }
}

// ---------------------------------------------------------------------------------------------
// Workflow runs. A workflow's agents are not in $.agent.list(): agent.spawn tags them with the
// run id, turn.complete names the one that finished. The phase and the name are read from the
// files Claude Code keeps for a run (undocumented, so a miss falls back, never fails).

/** Runs kept at most; finished ones are dropped oldest first, live ones never. */
export const MAX_RUNS = 20

function emptyRun(): WorkflowRun {
  return { name: '', phase: '', label: '', started: [], done: [] }
}

/** Drops the oldest finished runs while there are more than MAX_RUNS. Key order is start order. */
function pruneRuns(runs: Record<string, WorkflowRun>): Record<string, WorkflowRun> {
  const ids = Object.keys(runs)
  let excess = ids.length - MAX_RUNS
  if (excess <= 0) return runs
  const out: Record<string, WorkflowRun> = {}
  for (const id of ids) {
    const run = runs[id]!
    if (excess > 0 && run.done.length >= run.started.length) {
      excess--
      continue
    }
    out[id] = run
  }
  return out
}

/** Records a workflow agent's start: counted as started, its label the latest. */
export function recordWorkflowSpawn(
  runs: Readonly<Record<string, WorkflowRun>>,
  runId: string,
  agentId: string,
  label: string,
): Record<string, WorkflowRun> {
  const run = runs[runId] ?? emptyRun()
  if (run.started.includes(agentId)) return { ...runs }
  return pruneRuns({ ...runs, [runId]: { ...run, label, started: [...run.started, agentId] } })
}

/** Records an agent's finish in the run that started it; any other agent changes nothing. */
export function recordWorkflowDone(runs: Readonly<Record<string, WorkflowRun>>, agentId: string): Record<string, WorkflowRun> {
  for (const [id, run] of Object.entries(runs)) {
    if (run.started.includes(agentId) && !run.done.includes(agentId)) {
      return { ...runs, [id]: { ...run, done: [...run.done, agentId] } }
    }
  }
  return { ...runs }
}

/** Runs with an agent still working, in start order. */
export function liveWorkflows(runs: Readonly<Record<string, WorkflowRun>>): Array<[string, WorkflowRun]> {
  return Object.entries(runs).filter(([, run]) => run.done.length < run.started.length)
}

/** The label convention's phase: the part before the first colon ('' without one). */
export function labelPhase(label: string): string {
  const at = label.indexOf(':')
  return at < 0 ? '' : label.slice(0, at).trim()
}

/** The phase of the last `started` entry in a run's journal.jsonl that names one; '' if none. */
export function journalPhase(text: string): string {
  let phase = ''
  for (const line of text.split('\n')) {
    if (!line.includes('"started"')) continue
    try {
      const entry = JSON.parse(line) as { type?: unknown; phase?: unknown }
      if (entry.type === 'started' && typeof entry.phase === 'string' && entry.phase !== '') phase = entry.phase
    } catch {
      // A torn or foreign line: skip it.
    }
  }
  return phase
}

/** The run's name from its saved script `<name>-<runId>.js`; '' when no file matches. */
export function workflowNameOf(fileNames: readonly string[], runId: string): string {
  const suffix = `-${runId}.js`
  const file = fileNames.find(f => f.endsWith(suffix) && f.length > suffix.length)
  return file === undefined ? '' : file.slice(0, -suffix.length)
}

/** Claude Code's folder name for a project: every character but a letter or digit becomes '-'. */
export function projectSlug(cwd: string): string {
  return cwd.replace(/[^A-Za-z0-9]/g, '-')
}

/** What a workflow line shows after the name: the phase (when known), then done/started. */
export function workflowTail(phase: string, done: number, started: number): string {
  return [phase, `${done}/${started}`].filter(p => p !== '').join(' ')
}
