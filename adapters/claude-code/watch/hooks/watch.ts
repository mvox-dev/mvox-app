// Pure logic of the watch mod: no `$`, no I/O. Everything here is unit-tested.
//
// The watch is information only (kit #9, reshaped 2026-10-16). It rings doorbells on files the
// home declares and reports the session's idleness and context growth; what any ring or report
// means is the home's own rule. Declared per kit home in memory-kit.conf:
//
//   watch_files:
//     - label: ""
//       path: comms/inboxes/team-lead.json
//       instruction: "consume the inbox or new messages won't land"
//       inject: false
//   watch_idle_minutes: 50
//   watch_context_percent: 50, 60, 70, 80

import type { PromptOrigin } from 'claude-code'

// ---------------------------------------------------------------------------------------------
// The conf.

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

// ---------------------------------------------------------------------------------------------
// Doorbells. A doorbell is a labeled file: when the file GROWS, the watch rings once -- one
// prompt at the next turn seam. The watch never reads a file's meaning, never empties, moves or
// archives it; consuming (read, then delete or empty) is the home's own step, and it is what
// re-arms the bell. Created at 0 bytes is not growth; shrinking only resets the remembered size.

/** One declared doorbell. Every field is always present in the conf; empty means its default. */
export type Doorbell = {
  /** The ring's label; '' means the file's name. */
  label: string
  path: string
  /** Home-authored text the ring carries verbatim; '' means just the bell. */
  instruction: string
  /** Ring with the grown tail's lines included (for short, line-shaped files), not just the bell. */
  inject: boolean
}

export const DOORBELL_KEYS = ['label', 'path', 'instruction', 'inject'] as const

/**
 * What `watch_files:` declares: a block list of entries, each a map of the four keys
 * (`- label: ...` then indented `path:`, `instruction:`, `inject:`). `declared` is whether the
 * key is there; every entry that cannot be used is a problem said out loud, never silently off.
 * An explicit empty list is a home ringing nothing on purpose.
 */
export type DoorbellList = { declared: boolean; bells: Doorbell[]; problems: string[] }

export function readDoorbells(conf: string): DoorbellList {
  const lines = conf.split(/\r?\n/)
  const at = lines.findIndex(l => /^watch_files:/.test(l))
  if (at === -1) return { declared: false, bells: [], problems: [] }
  const rest = (lines[at] ?? '').slice('watch_files:'.length).trim()
  if (rest !== '' && !rest.startsWith('#'))
    return { declared: true, bells: [], problems: ['expected a block list of entries ("- label: ..." lines), not an inline value'] }

  const bells: Doorbell[] = []
  const problems: string[] = []
  let entry: Partial<Record<(typeof DOORBELL_KEYS)[number], string>> | undefined
  let entryBad = false
  const close = () => {
    if (entry !== undefined && !entryBad) {
      const n = bells.length + problems.length + 1
      if (entry.path === undefined || entry.path === '') problems.push(`entry ${n}: no path`)
      else if (entry.inject !== undefined && entry.inject !== '' && entry.inject !== 'true' && entry.inject !== 'false')
        problems.push(`entry ${n}: inject must be true or false, not "${entry.inject}"`)
      else bells.push({ label: entry.label ?? '', path: entry.path, instruction: entry.instruction ?? '', inject: entry.inject === 'true' })
    }
    entry = undefined
    entryBad = false
  }
  for (const raw of lines.slice(at + 1)) {
    if (/^\s*(#.*)?$/.test(raw)) continue
    // Entries may sit at column 0 under the key, as yaml.safe_dump writes them; any other
    // column-0 line that is not a list item is the next conf key.
    if (!/^\s/.test(raw) && !/^-(\s|$)/.test(raw)) break
    const item = /^\s*-\s+(.*)$/.exec(raw)
    const field = /^\s*([A-Za-z_]+):(.*)$/.exec(item?.[1] ?? raw.trim())
    if (item) close()
    if (!field) {
      if (!entryBad) problems.push(`not a "key: value" line: ${raw.trim()}`)
      entryBad = true
      if (item) entry = {}
      continue
    }
    if (entry === undefined && !item) {
      problems.push(`a field outside any entry (missing "- "?): ${raw.trim()}`)
      continue
    }
    if (item) entry = {}
    const key = field[1] ?? ''
    if (!(DOORBELL_KEYS as readonly string[]).includes(key)) {
      problems.push(`unknown field "${key}" (label, path, instruction, inject)`)
      entryBad = true
      continue
    }
    if (entry !== undefined && entry[key as (typeof DOORBELL_KEYS)[number]] !== undefined) {
      problems.push(`field "${key}" given twice in one entry`)
      entryBad = true
      continue
    }
    if (entry !== undefined) entry[key as (typeof DOORBELL_KEYS)[number]] = unquote(field[2] ?? '')
  }
  close()
  if (bells.length === 0 && problems.length === 0) problems.push('no entries under it')
  return { declared: true, bells, problems }
}

const baseOf = (path: string) => path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1)

/** A doorbell's effective label: its own, else the file's name. */
export function bellLabel(bell: Doorbell, file: string): string {
  return bell.label !== '' ? bell.label : baseOf(file)
}

/**
 * One ring. Information plus the home's own instruction; with `inject`, the grown tail's
 * non-blank lines ride along (meant for short, line-shaped files: the harness cuts long lines).
 */
export function ringText(bell: Doorbell, file: string, oldSize: number, content: string): string {
  const head = `[${bellLabel(bell, file)}] ${file} grew.${bell.instruction === '' ? '' : ` ${bell.instruction}`}`
  if (!bell.inject) return head
  const tail = content
    .slice(oldSize)
    .split(/\r?\n/)
    .map(l => l.trimEnd())
    .filter(l => l.trim() !== '')
  return [head, ...tail].join('\n')
}

/** One prompt for one poll's rings: every delivered prompt is a full-context turn. */
export function combineRings(rings: readonly string[]): string {
  if (rings.length === 1) return rings[0] ?? ''
  return [`[watch] ${rings.length} doorbells:`, ...rings].join('\n')
}

// ---------------------------------------------------------------------------------------------
// Paths.

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

/** A path's segments for glob expansion, on either separator; a leading '' is the POSIX root. */
export function pathSegments(path: string): string[] {
  return path.split(/[\\/]/)
}

/** A path with `\\` as `/`, `.` and `..` resolved, no trailing slash: for comparing, never for opening. */
export function normalPath(path: string): string {
  const out: string[] = []
  const parts = path.replaceAll('\\', '/').split('/')
  for (const [i, part] of parts.entries()) {
    if (part === '.' || (part === '' && i > 0)) continue
    if (part === '..' && out.length > 1) out.pop()
    else if (part !== '..') out.push(part)
  }
  return out.length === 1 && out[0] === '' ? '/' : out.join('/')
}

/** A drive-letter or UNC path is Windows (for case folding); anything else is not. */
export function isWindowsPath(path: string): boolean {
  return /^([A-Za-z]:[\\/]|\\\\)/.test(path)
}

/**
 * The key a file's bookkeeping goes by (kit #46): one per file however its path is spelled --
 * separators and `.`/`..` normalized, a Windows path (drive or UNC, either slash) case-folded.
 * Two spellings of one spool once kept two bookmarks, and each new line rang twice.
 */
export function fileKey(path: string): string {
  const key = normalPath(path)
  return isWindowsPath(path.replaceAll('/', '\\')) ? key.toLowerCase() : key
}

/** Whether `dir` is `home` or lies inside it. A Windows path folds case. Symlinks are not followed. */
export function isInside(dir: string, home: string): boolean {
  const fold = (p: string) => (isWindowsPath(p) ? p.toLowerCase() : p)
  const d = fold(normalPath(dir))
  const h = fold(normalPath(home))
  return d === h || d.startsWith(h.endsWith('/') ? h : `${h}/`)
}

// ---------------------------------------------------------------------------------------------
// Prompts.

/** A prompt the human gave: typed, through Remote Control, or a Slack ping. */
export function isHuman(origin: PromptOrigin): boolean {
  return origin.kind === 'composer' || origin.kind === 'bridge' || origin.kind === 'slack-ping'
}

// ---------------------------------------------------------------------------------------------
// Session sensors: idle and context marks. Information only, declared in memory-kit.conf;
// absent means off.

export const MINUTE = 60_000
export const HOUR = 60 * MINUTE

/** A conf number list that could not be used, said out loud (never silently off). */
export type ConfNumbers = { declared: boolean; values: number[]; problem?: string }

/** `watch_idle_minutes: 50` -- one value, whole minutes, at least 1. */
export function confIdleMinutes(conf: string): ConfNumbers {
  return confNumbers(conf, 'watch_idle_minutes', 1)
}

/**
 * `watch_idle_repeat: true` (kit #47): the idle report recurs after each further idle interval,
 * instead of once per working stretch. Its turn re-reads the prompt cache before the cache's hour
 * runs out: a keep-alive for a long session. `false` or absent: once.
 */
export function confIdleRepeat(conf: string): { on: boolean; problem?: string } {
  const raw = confValue(conf, 'watch_idle_repeat')
  if (raw === undefined || raw === 'false') return { on: false }
  if (raw === 'true') return { on: true }
  return { on: false, problem: `true or false, not "${raw}"` }
}

/** `watch_context_percent: 50, 60, 70, 80` -- percent marks of the window, 1-99, sorted. */
export function confContextPercent(conf: string): ConfNumbers {
  const read = confNumbers(conf, 'watch_context_percent', Infinity)
  if (read.problem !== undefined) return read
  if (read.values.some(v => v > 99)) return { declared: true, values: [], problem: 'marks are percent of the window: 1-99' }
  return { ...read, values: [...read.values].sort((a, b) => a - b) }
}

function confNumbers(conf: string, key: string, max: number): ConfNumbers {
  const raw = confValue(conf, key)
  if (raw === undefined) return { declared: false, values: [] }
  const parts = raw.split(',').map(p => p.trim())
  const values = parts.map(p => (/^[0-9]+$/.test(p) ? Number(p) : NaN))
  if (values.some(v => Number.isNaN(v) || v < 1)) return { declared: true, values: [], problem: `not a list of whole numbers >= 1: "${raw}"` }
  if (values.length > max) return { declared: true, values: [], problem: `one value expected: "${raw}"` }
  return { declared: true, values }
}

/**
 * The marks newly crossed: declared, at or below the context's percent of the window, not yet
 * reported this session. Several at once (a big jump) report together, highest last.
 */
export function marksCrossed(marks: readonly number[], reported: readonly number[], tokens: number | undefined, window: number): number[] {
  if (tokens === undefined || window <= 0) return []
  const pct = (tokens / window) * 100
  return marks.filter(m => m <= pct && !reported.includes(m))
}

/** The context report: information only; the home's rules say what this level means. */
export function contextReport(mark: number, tokens: number, window: number): string {
  const pct = Math.round((tokens / window) * 100)
  return [
    `[watch] Context has reached ${pct}% of the window (${tokens.toLocaleString('en-US')} of ${window.toLocaleString('en-US')} tokens), past the ${mark}% mark declared in memory-kit.conf.`,
    'This is information only; what to do at this level is this home\'s own rule.',
  ].join(' ')
}

/**
 * The idle report: information only. A declared watch_retire_step is quoted as the home's own
 * declared step, decided by the home, not by the watch.
 */
export function idleReport(idleMinutes: number, retireStep: string | undefined, repeat = false): string {
  const mark = repeat ? 'the watch_idle_minutes mark in memory-kit.conf, repeating while idle (watch_idle_repeat)' : 'the watch_idle_minutes mark in memory-kit.conf'
  const head = `[watch] This session has been idle for ${idleMinutes} min (${mark}).`
  const tail = retireStep === undefined ? 'This is information only; what idleness means here is this home\'s own rule.' : `The home's declared step for this (watch_retire_step): ${retireStep}.`
  return `${head} ${tail}`
}
