// kit_home: a memory-kit.conf key naming the kit home (kit #18). Pure: the caller hands in how
// to read a file.
//
// IDENTICAL in adapters/claude-code/{obligations-pane,watch,kit-update}/hooks/kit-home.ts: a
// plugin loads only its own folder, so each carries a copy; lint/run-fixtures.sh fails when the
// copies differ. The same rules for Python are lint/kit_home.py, with the same messages.
//
// A start folder without a memory-kit.conf takes the nearest one above it (kit #42), as git finds
// .git: a session started in a subfolder or a worktree of a home finds that home. The walk stops at
// the filesystem root; no conf anywhere leaves the start folder as the home, as before.
//
// If that memory-kit.conf says `kit_home: <path>` (absolute, or relative to that conf's folder),
// the home is the folder it names: that home's conf, memory-kit/VERSION, memory
// directory, update:/upstream: and watch_files count, and the pointer conf's other keys are
// ignored (reported in `ignored`). One hop, never chained: the target's conf may not point on (a
// loop is a chain too). `kit_home: .` is just the home. A target with no memory-kit.conf, and a
// `~` path (not expanded), are problems said plainly, never a silent fall back.

export const KIT_HOME_KEY = 'kit_home'

/** `foundIn`: the folder above the start folder whose memory-kit.conf decided (kit #42); absent
 *  when the start folder's own did, or none did. */
export type KitHome = { home: string; pointer?: string; ignored: string[]; foundIn?: string } | { problem: string; pointer: string }

/** POSIX (/...), a drive letter (C:\ or C:/) or UNC (\\server\share). */
export function isAbsolute(path: string): boolean {
  return /^(\/|[A-Za-z]:[\\/]|\\\\)/.test(path)
}

/** `.` and `..` resolved, `/` as the separator, no trailing slash; a root (/, C:/, //server/share) kept. */
export function normalizePath(path: string): string {
  const unc = /^\\\\|^\/\//.test(path)
  const drive = /^[A-Za-z]:[\\/]/.exec(path)?.[0].slice(0, 2)
  const root = unc ? '//' : drive !== undefined ? `${drive}/` : path.startsWith('/') ? '/' : ''
  const parts: string[] = []
  for (const part of path.slice(unc ? 2 : drive !== undefined ? 3 : root.length).split(/[\\/]+/)) {
    if (part === '' || part === '.') continue
    if (part === '..' && parts.length > 0 && parts[parts.length - 1] !== '..') parts.pop()
    else if (part !== '..' || root === '') parts.push(part)
  }
  return `${root}${parts.join('/')}` || '.'
}

/** `name` inside `dir`; a root (/, C:/) already ends in its separator. */
const inside = (dir: string, name: string) => (dir.endsWith('/') ? `${dir}${name}` : `${dir}/${name}`)

/** The folder above `path`, normalized; undefined at a root (/, C:/, //server/share). */
export function parentOf(path: string): string | undefined {
  const p = normalizePath(path)
  if (p === '/' || /^[A-Za-z]:\/$/.test(p) || /^\/\/[^/]+(\/[^/]+)?$/.test(p)) return undefined
  const cut = p.lastIndexOf('/')
  if (cut === -1) return undefined
  if (cut === 0) return '/'
  const up = p.slice(0, cut)
  return /^[A-Za-z]:$/.test(up) ? `${up}/` : up
}

const sameAs = (a: string, b: string) => {
  const [x, y] = [normalizePath(a), normalizePath(b)]
  return /^[A-Za-z]:\//.test(x) || x.startsWith('//') ? x.toLowerCase() === y.toLowerCase() : x === y
}

/** A top-level `key: value` of memory-kit.conf, a trailing comment and quotes stripped; '' when absent. */
export function confValueOf(conf: string, key: string): string {
  for (const line of conf.split(/\r?\n/)) {
    if (!line.startsWith(`${key}:`)) continue
    const raw = line.slice(key.length + 1)
    const hash = raw.search(/\s#/)
    return (hash === -1 ? raw : raw.slice(0, hash)).trim().replace(/^["']|["']$/g, '')
  }
  return ''
}

/** What a reader says when the folder it took for the home has no memory-kit.conf (kit #31): silence
 *  there looked the same as "nothing newer". lint/kit_home.py no_conf_notice says it alike. */
export function noConfNotice(folder: string): string {
  return `${normalizePath(folder)} has no memory-kit.conf, so it is not a kit home; if the home is elsewhere, put kit_home: <path> in a memory-kit.conf here`
}

/** What a reader says when the home came from a conf above the start folder (kit #42), so a
 *  surprising home is visible. lint/kit_home.py found_above_note says it alike. */
export function foundAboveNote(start: string, foundIn: string): string {
  return `${normalizePath(start)} has no memory-kit.conf; using the nearest one above it, in ${normalizePath(foundIn)}`
}

const topKeys = (conf: string) => conf.split(/\r?\n/).flatMap(line => /^([A-Za-z_][\w-]*):/.exec(line)?.[1] ?? [])

/** The home for a start folder, by its memory-kit.conf's kit_home (see the head of this file). */
export async function resolveKitHome(start: string, read: (path: string) => Promise<string | undefined>): Promise<KitHome> {
  const begin = normalizePath(start)
  let from: string | undefined = begin
  let conf: string | undefined
  for (; from !== undefined; from = parentOf(from)) {
    try {
      conf = await read(inside(from, 'memory-kit.conf'))
    } catch (err) {
      // A folder above that cannot be read (a network share refuses) ends the walk, as no conf would.
      if (from === begin) throw err
      break
    }
    if (conf !== undefined) break
  }
  if (from === undefined || conf === undefined) return { home: begin, ignored: [] }
  const above = from === begin ? {} : { foundIn: from }
  const pointer = inside(from, 'memory-kit.conf')
  const raw = confValueOf(conf, KIT_HOME_KEY)
  if (raw === '') return { home: from, ignored: [], ...above }
  if (raw.startsWith('~'))
    return { pointer, problem: `${pointer}: kit_home: ${raw} -- write it absolute or relative to this conf's folder (~ is not expanded)` }
  const target = normalizePath(isAbsolute(raw) ? raw : inside(from, raw))
  if (sameAs(target, from)) return { home: from, ignored: [], ...above }
  const targetConf = await read(inside(target, 'memory-kit.conf'))
  if (targetConf === undefined) return { pointer, problem: `${pointer}: kit_home: ${raw} -> ${target}: no memory-kit.conf there, so it is not a kit home` }
  const onward = confValueOf(targetConf, KIT_HOME_KEY)
  if (onward !== '' && !sameAs(isAbsolute(onward) ? onward : inside(target, onward), target))
    return {
      pointer,
      problem: `${pointer}: kit_home: ${raw} -> ${target}, whose own conf points on (kit_home: ${onward}); a pointer is followed one hop, never chained`,
    }
  return { home: target, pointer, ignored: topKeys(conf).filter(k => k !== KIT_HOME_KEY), ...above }
}
