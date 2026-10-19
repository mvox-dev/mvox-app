// The memory pane's tabs (kit #43): one read-only view per memory tier. Pure: no `$`, no I/O; the
// caller reads the files and hands in their text. Shapes: memory-kit/types/memory-*.ts. Every
// file goes through parseMapLists, the obligations parser's own, so a tier the parser rejects
// shows its error in its own tab and the others keep working.

import type { LessonFilter, TabId, TierView, ViewChoice, ViewLine } from '../types'
import { addDays, parseMapLists } from './obligations'
import type { ListSpec, MapRow } from './obligations'

/** The tab row, in Mihkel's order (19.10.2026): from "act now" to "rarely visited". */
export const TABS: readonly { id: TabId; name: string }[] = [
  { id: 'O', name: 'Obligations' },
  { id: 'N', name: 'Next' },
  { id: 'C', name: 'Commitments' },
  { id: 'R', name: 'Rules' },
  { id: 'L', name: 'Lessons' },
  { id: 'F', name: 'Facts' },
  { id: 'K', name: 'Keys' },
  { id: 'S', name: 'Secrets' },
]

export const LESSON_FILTERS: readonly LessonFilter[] = ['all', 'hooked', 'linted', 'recognition']

export const DEFAULT_CHOICE: ViewChoice = { tab: 'O', lessons: 'all' }

/** A stored choice, validated: anything unknown falls back to the default, field by field. */
export function choiceOf(stored: unknown): ViewChoice {
  const raw = (typeof stored === 'object' && stored !== null ? stored : {}) as { tab?: unknown; lessons?: unknown }
  const tab = TABS.find(t => t.id === raw.tab)?.id ?? DEFAULT_CHOICE.tab
  const lessons = LESSON_FILTERS.find(f => f === raw.lessons) ?? DEFAULT_CHOICE.lessons
  return { tab, lessons }
}

/** The $.store key of a home's choice: one per resolved home path. */
export const choiceKey = (home: string) => `view:${home}`

// Caps the header counts against (memory-kit/types/caps.ts; a plugin loads only its own folder).
export const CURRENT_CAP = 15
export const RULES_CAP = 20
/** A fact whose `verified` is older than this, or blank, is drawn dim: a quarter, as the weekly sweep ages them. */
export const FACT_STALE_DAYS = 91

const line = (key: string, text: string, more: Partial<Omit<ViewLine, 'key' | 'text'>> = {}): ViewLine => ({
  key,
  tag: '',
  text,
  note: '',
  dim: false,
  heading: false,
  flag: '',
  href: '',
  ...more,
})

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** Parses one tier file, or the view that says why it cannot be shown. */
function parsed(text: string, file: string, spec: ListSpec): Record<string, MapRow[]> | TierView {
  const result = parseMapLists(text, spec)
  return result.kind === 'ok' ? result.lists : { kind: 'error', message: `${file} unreadable: line ${result.line}: ${result.message}` }
}

const isView = (x: Record<string, MapRow[]> | TierView): x is TierView => 'kind' in x && typeof x.kind === 'string'

// ---------------------------------------------------------------------------------------------
// N: the scratchpad (memory/scratchpad.yaml), shown as "Next": S is Secrets.

const SCRATCHPAD: ListSpec = { tops: ['current', 'staging'], keys: ['label', 'record', 'ref'], required: ['record'], dates: [] }

export function nextView(text: string): TierView {
  const lists = parsed(text, 'scratchpad.yaml', SCRATCHPAD)
  if (isView(lists)) return lists
  const current = lists.current ?? []
  const staging = lists.staging ?? []
  const rows = (rows: MapRow[], section: string) =>
    rows.map(r => line(`${section}-${r.line}`, r.fields.record ?? '', { tag: r.fields.label ?? '', note: r.fields.ref ?? '' }))
  return {
    kind: 'ok',
    count: `${current.length}/${CURRENT_CAP} current · ${staging.length} staging`,
    banner: '',
    lines: [
      line('h-current', `current (${current.length})`, { heading: true }),
      ...rows(current, 'current'),
      line('h-staging', `staging (${staging.length})`, { heading: true }),
      ...rows(staging, 'staging'),
    ],
  }
}

// ---------------------------------------------------------------------------------------------
// C: commitments (memory/commitments.yaml), optional: a home opts in with the file (kit #30).

const COMMITMENTS: ListSpec = {
  tops: ['commitments'],
  keys: ['trigger', 'obligation', 'actor', 'owed_to', 'within', 'ref'],
  required: ['trigger', 'obligation'],
  dates: [],
}

export const COMMITMENTS_UNUSED = 'commitments tier not in use here'

export function commitmentsView(text: string | undefined): TierView {
  if (text === undefined) return { kind: 'missing', message: COMMITMENTS_UNUSED }
  const lists = parsed(text, 'commitments.yaml', COMMITMENTS)
  if (isView(lists)) return lists
  const rows = lists.commitments ?? []
  return {
    kind: 'ok',
    count: plural(rows.length, 'commitment'),
    banner: '',
    lines: rows.map(({ fields: f, line: at }) => {
      const parties = [f.actor, f.owed_to].filter(p => p !== '').join(' -> ')
      const within = f.within === '' ? '' : `within ${f.within}`
      return line(`c-${at}`, `${f.trigger} -> ${f.obligation}`, { note: [parties, within].filter(p => p !== '').join(', ') })
    }),
  }
}

// ---------------------------------------------------------------------------------------------
// R: rules (memory/rules.yaml), numbered, counted against the cap.

const RULES: ListSpec = { tops: ['rules'], keys: ['rule', 'ref'], required: ['rule'], dates: [] }

export function rulesView(text: string): TierView {
  const lists = parsed(text, 'rules.yaml', RULES)
  if (isView(lists)) return lists
  const rows = lists.rules ?? []
  return {
    kind: 'ok',
    count: `${rows.length}/${RULES_CAP}`,
    banner: '',
    lines: rows.map((r, i) => line(`r-${r.line}`, r.fields.rule ?? '', { tag: `${i + 1}.` })),
  }
}

// ---------------------------------------------------------------------------------------------
// L: lessons, from the generated index (memory/lessons/index.yaml), newest first, filterable.

const LESSONS: ListSpec = {
  tops: ['lessons'],
  keys: ['slug', 'summary', 'learned', 'ref', 'enforcement', 'trigger'],
  required: ['slug', 'summary'],
  dates: ['learned'],
}

/** A file:// URL for a local path, POSIX or Windows (C:/ gets the third slash). */
export function fileUrl(path: string): string {
  const p = path.replaceAll('\\', '/')
  const abs = p.startsWith('/') ? p : `/${p}`
  return `file://${abs.split('/').map(encodeURIComponent).join('/').replace(/^\/([A-Za-z])%3A/, '/$1:')}`
}

export function lessonsView(text: string, filter: LessonFilter, lessonsDir: string): TierView {
  const lists = parsed(text, 'lessons/index.yaml', LESSONS)
  if (isView(lists)) return lists
  const all = [...(lists.lessons ?? [])].sort((a, b) => (b.fields.learned ?? '').localeCompare(a.fields.learned ?? '') || a.line - b.line)
  const shown = filter === 'all' ? all : all.filter(r => r.fields.enforcement === filter)
  return {
    kind: 'ok',
    count: filter === 'all' ? plural(all.length, 'lesson') : `${shown.length}/${all.length} ${filter}`,
    banner: '',
    lines: shown.map(({ fields: f, line: at }) =>
      line(`l-${at}`, f.summary ?? '', { tag: f.enforcement ?? '', note: f.learned ?? '', href: fileUrl(`${lessonsDir}/${f.slug}.md`) }),
    ),
  }
}

// ---------------------------------------------------------------------------------------------
// F: facts (memory/facts/<subject>.yaml), grouped by subject, stale ones dim.

const FACTS: ListSpec = { tops: ['facts'], keys: ['fact', 'ref', 'refute', 'verified'], required: ['fact'], dates: ['verified'] }

/** Whether a fact's `verified` is blank or older than FACT_STALE_DAYS before today. */
export function isStale(verified: string, today: string): boolean {
  return verified === '' || verified < addDays(today, -FACT_STALE_DAYS)
}

/** `files`: each facts file's name (`<subject>.yaml`) and text, in any order. */
export function factsView(files: readonly { name: string; text: string }[], today: string): TierView {
  const lines: ViewLine[] = []
  let facts = 0
  let stale = 0
  const errors: string[] = []
  for (const file of [...files].sort((a, b) => a.name.localeCompare(b.name))) {
    const subject = file.name.replace(/\.ya?ml$/, '')
    const lists = parsed(file.text, `facts/${file.name}`, FACTS)
    if (isView(lists)) {
      // One broken subject is said in its place; the other subjects still show.
      lines.push(line(`h-${subject}`, subject, { heading: true, flag: lists.kind === 'error' ? lists.message : '' }))
      errors.push(subject)
      continue
    }
    const rows = lists.facts ?? []
    lines.push(line(`h-${subject}`, `${subject} (${rows.length})`, { heading: true }))
    for (const { fields: f, line: at } of rows) {
      const old = isStale(f.verified ?? '', today)
      facts++
      if (old) stale++
      lines.push(line(`f-${subject}-${at}`, f.fact ?? '', { tag: f.verified === '' ? 'never' : (f.verified ?? ''), dim: old }))
    }
  }
  const parts = [plural(facts, 'fact'), plural(files.length - errors.length, 'subject')]
  if (stale > 0) parts.push(`${stale} not verified in ${FACT_STALE_DAYS} days`)
  if (errors.length > 0) parts.push(`${plural(errors.length, 'file')} unreadable`)
  return { kind: 'ok', count: parts.join(' · '), banner: '', lines }
}

// ---------------------------------------------------------------------------------------------
// K: keys (memory/keys.yaml): who can get in, and how it is shut off.

const KEYS: ListSpec = {
  tops: ['keys'],
  keys: ['subject', 'holder', 'scope', 'granted', 'revoke', 'ref'],
  required: ['subject'],
  dates: ['granted'],
}

export function keysView(text: string): TierView {
  const lists = parsed(text, 'keys.yaml', KEYS)
  if (isView(lists)) return lists
  const rows = lists.keys ?? []
  let findings = 0
  const lines = rows.map(({ fields: f, line: at }) => {
    const blank = (f.revoke ?? '').trim() === ''
    if (blank) findings++
    const flag = blank ? 'no revoke step (a finding)' : (f.revoke ?? '').includes('[?]') ? 'revoke step unconfirmed [?]' : ''
    return line(`k-${at}`, [f.holder, f.scope].filter(p => p !== '').join(' · '), {
      tag: f.subject ?? '',
      note: blank ? '' : `revoke: ${f.revoke}`,
      flag,
    })
  })
  const parts = [plural(rows.length, 'grant')]
  if (findings > 0) parts.push(plural(findings, 'finding'))
  return { kind: 'ok', count: parts.join(' · '), banner: '', lines }
}

// ---------------------------------------------------------------------------------------------
// S: secrets (memory/secrets/): the README's three labelled lines and the encrypted files' names.
// Never a value: the pane reads the README and a directory listing, never an encrypted file.

/** What the skeleton's README says (memory-kit/skeleton/memory/secrets/README.md), unfilled = undefined. */
export type SecretsReadme = {
  publicKey?: string
  masterKey?: string
  deposited?: string
  where?: string
  verified?: string
}

/** A value still as the skeleton ships it (`_fill in_`, `_date or NOT YET_`), or absent. */
const filled = (v: string | undefined) => (v === undefined || v === '' || /^_.*_$/.test(v) ? undefined : v)

/** The three labelled lines; a label the README lacks or leaves as shipped is undefined. */
export function secretsReadmeOf(text: string): SecretsReadme {
  const out: SecretsReadme = {}
  for (const raw of text.split(/\r?\n/)) {
    const l = raw.trim()
    let m = /^- \*\*Public key[^*]*:\*\*\s*(.*)$/.exec(l)
    if (m) out.publicKey = filled(m[1]?.trim())
    m = /^- \*\*Master key location[^*]*:\*\*\s*(.*)$/.exec(l)
    if (m) out.masterKey = filled(m[1]?.trim())
    m = /^- \*\*Spare deposited:\*\*\s*(.*?)\s*[—–-]+\s*\*\*where:\*\*\s*(.*?)\s*[—–-]+\s*\*\*verified:\*\*\s*(.*)$/.exec(l)
    if (m) {
      out.deposited = filled(m[1]?.trim())
      out.where = filled(m[2]?.trim())
      out.verified = filled(m[3]?.trim())
    }
  }
  return out
}

const notYet = (v: string | undefined) => v === undefined || /not yet/i.test(v)

/**
 * `readme`: the README's text, undefined when there is none. `files`: the secrets folder's
 * entries other than the README, by name and modification date; never their contents.
 */
export function secretsView(readme: string | undefined, files: readonly { name: string; modified: string }[]): TierView {
  const off: string[] = []
  if (readme === undefined) off.push('no secrets/README.md')
  const r = readme === undefined ? {} : secretsReadmeOf(readme)
  if (readme !== undefined) {
    if (r.publicKey === undefined) off.push('public key not filled in')
    if (r.masterKey === undefined) off.push('master key location not filled in')
  }
  if (files.length === 0) off.push('no encrypted file beside the README')
  const lines: ViewLine[] = []
  if (readme !== undefined) {
    lines.push(line('s-pub', r.publicKey ?? '(not filled in)', { tag: 'public key' }))
    lines.push(line('s-master', r.masterKey ?? '(not filled in)', { tag: 'master key at' }))
    const spareFlags = [notYet(r.deposited) ? 'spare NOT YET deposited' : '', notYet(r.verified) ? 'spare NOT YET verified' : '']
    lines.push(
      line('s-spare', `deposited ${r.deposited ?? 'NOT YET'}, where ${r.where ?? '(not said)'}, verified ${r.verified ?? 'NOT YET'}`, {
        tag: 'spare',
        flag: spareFlags.filter(f => f !== '').join(', '),
      }),
    )
  }
  lines.push(line('h-files', `encrypted files (${files.length})`, { heading: true }))
  for (const f of [...files].sort((a, b) => a.name.localeCompare(b.name))) lines.push(line(`s-${f.name}`, f.name, { note: f.modified }))
  return {
    kind: 'ok',
    count: off.length > 0 ? 'not kit-compliant' : plural(files.length, 'encrypted file'),
    banner: off.length > 0 ? `secrets tier not kit-compliant: ${off.join('; ')}` : '',
    lines,
  }
}

/** Secrets folder entries that count as encrypted files: not the README, not a dotfile, not a folder. */
export function secretFiles(entries: readonly { name: string; kind: string; mtimeMs: number }[], dateOf: (ms: number) => string) {
  return entries
    .filter(e => e.kind === 'file' && e.name !== 'README.md' && !e.name.startsWith('.'))
    .map(e => ({ name: e.name, modified: dateOf(e.mtimeMs) }))
}
