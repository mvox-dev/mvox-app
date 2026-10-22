// The watch mod (memory-kit issue #9). Information only, on one timer:
//  1. doorbells: when a file the home declares (watch_files) grows, ring once -- one
//     $.prompt.submit, which queues until the session is idle and wakes it then. The watch never
//     reads a file's meaning and never empties, moves or archives it; consuming (read, then
//     delete or empty) is the home's own step, and it is what re-arms the bell;
//  2. session reports: idleness past watch_idle_minutes and context past each
//     watch_context_percent mark. The watch never says what a ring or report means; that is the
//     home's own rule.

import { atom, read } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import {
  bellChange,
  bellLabel,
  bellsKey,
  bookmarksOf,
  combineRings,
  confContextPercent,
  confIdleMinutes,
  confIdleRepeat,
  confValue,
  contextReport,
  expandHome,
  fileKey,
  idleReport,
  isHuman,
  isInside,
  marksCrossed,
  matchSegment,
  MINUTE,
  pathSegments,
  readDoorbells,
  ringText,
  textHash,
} from './watch'
import type { Bookmark, Doorbell } from './watch'
import { foundAboveNote, normalizePath, resolveKitHome } from './kit-home'
import type { KitHome } from './kit-home'

const startCwd = atom({ plugin: 'watch', key: 'startCwd' } as const, '')
/** Context marks already reported this session: once per mark, reloads included. */
const reportedMarks = atom({ plugin: 'watch', key: 'reportedMarks' } as const, [] as number[])
/** Each watched file's last-seen size, by expanded path: growth past it rings. A tail-style
 *  file's is also kept in $.store, which a new session, having none of its own, reads (kit #51). */
const bellSizes = atom({ plugin: 'watch', key: 'bellSizes' } as const, {} as Record<string, number>)
/** Each watched file's last-seen text hash, by the same key: other text in its place rings (kit #52). */
const bellHashes = atom({ plugin: 'watch', key: 'bellHashes' } as const, {} as Record<string, number>)

type Settings = { home: string; pollMs: number }

const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : fallback)

// Module state: a reload starts it over, which only ever holds a report back (not armed yet).
/** Armed by a human prompt, disarmed by the one idle report: one report per working stretch,
 *  and the report's own turn can never re-arm it. With watch_idle_repeat (kit #47) a report
 *  leaves it armed, so reports recur while the session stays idle; only a human arms it first. */
let idleArmed = false
let lastActivity = 0
/** Set when register() saw a retired option: told once at session start. */
let retiredOption: string | undefined
let polling = false
const logged = new Set<string>()
/** The tail-style rings of this session whose prompt has not yet entered or been refused, by
 *  the files each carries: the kept bookmark of such a file waits for its ring (kit #51). A
 *  reload forgets them, so a ring queued across a reload and then lost with its session is not
 *  rung again. */
const inFlight = new Set<readonly string[]>()

/** One debug line per distinct message for the module's life: a poll every 5 s must not spam. */
function logOnce($: EngineInterface, text: string): void {
  if (logged.has(text)) return
  logged.add(text)
  $.ui.log(`watch: ${text}`, { to: 'debug' })
}

async function readOrEmpty($: EngineInterface, path: string): Promise<string> {
  try {
    return (await $.fs.exists(path)) ? await $.fs.read(path) : ''
  } catch {
    return ''
  }
}

/** A file's text, undefined when it is missing or unreadable. */
async function readMaybe($: EngineInterface, path: string): Promise<string | undefined> {
  try {
    return (await $.fs.exists(path)) ? await $.fs.read(path) : undefined
  } catch {
    return undefined
  }
}

/**
 * The kit home (kit #18). The start folder's memory-kit.conf decides first: a `kit_home:` pointer
 * names the home, one hop; a start folder without a conf takes the nearest one above it (kit
 * #42). A home so found wins over the user-scope `home` option, which applies to every session on
 * the machine. Otherwise the option, else the start folder. The start folder is the first
 * session.start's; without one (a plugin installed mid-session, kit #45) the session's root,
 * which a shell cd does not move. The option is normalized as the pointer is (kit #46).
 */
async function homeOf($: EngineInterface, settings: Settings): Promise<Placed> {
  const start = (await read($, startCwd)) || (await $.session.root())
  const found = await resolveKitHome(start, p => readMaybe($, p))
  if ('problem' in found || found.pointer !== undefined || found.foundIn !== undefined || settings.home === '')
    return { found, start, viaOption: false }
  return { found: { home: normalizePath(expandHome(settings.home, start, '') ?? start), ignored: [] }, start, viaOption: true }
}

/** The folder the session started in: its root, which a shell cd does not move (kit #45); `cwd` if the engine gives none. */
async function startFolder($: EngineInterface, cwd: string): Promise<string> {
  try {
    return (await $.session.root()) || cwd
  } catch {
    return cwd
  }
}

/** The kit home as found, the folder the session started in, and whether the home came from the `home` option. */
type Placed = { found: KitHome; start: string; viaOption: boolean }

/** A usable home: where it is, where the session started, and whether the `home` option named it. */
type Home = { home: string; start: string; viaOption: boolean }

/** The home, or one visible notice when the pointer is broken; also when it leaves watch_files behind. */
async function usableHome($: EngineInterface, settings: Settings): Promise<Home | undefined> {
  const { found, start, viaOption } = await homeOf($, settings)
  if ('problem' in found) {
    await tellOnce($, `${found.problem}. The watch rings nothing until it is fixed.`)
    return undefined
  }
  if (found.pointer !== undefined && found.ignored.includes('watch_files'))
    await tellOnce($, `watch_files in ${found.pointer} are ignored: that conf points at the home (kit_home), and they count in ${found.home}/memory-kit.conf.`)
  return { home: found.home, start, viaOption }
}

/** The files a path names; `*` in a segment matches the directory's entries (never dotfiles). */
async function expand($: EngineInterface, path: string): Promise<string[]> {
  if (!path.includes('*')) return [path]
  const segments = pathSegments(path)
  let bases = [segments[0] ?? '']
  for (const segment of segments.slice(1)) {
    const next: string[] = []
    for (const base of bases) {
      if (!segment.includes('*')) {
        next.push(`${base}/${segment}`)
        continue
      }
      try {
        // '' is the POSIX root; a bare drive ('C:') is that drive's root, not its current directory.
        const dir = base === '' ? '/' : /^[A-Za-z]:$/.test(base) ? `${base}/` : base
        for (const entry of await $.fs.list(dir)) if (matchSegment(segment, entry.name)) next.push(`${base}/${entry.name}`)
      } catch {
        // A directory that is not there matches nothing.
      }
    }
    bases = next.sort()
  }
  return bases
}

/**
 * One prompt, fire and forget (its submit resolves only when its turn starts, which a poll must
 * not wait for). A refusal runs `undo`, so a lost ring's baseline rolls back and the growth
 * rings again at a later poll; a prompt that enters runs `entered`. A prompt that never resolves
 * (its session ended first) runs neither.
 */
function ask($: EngineInterface, text: string, undo?: () => Promise<void>, entered?: () => Promise<void>): void {
  void $.prompt
    .submit({ text })
    .then(
      r => {
        if (r.drop !== undefined) {
          logOnce($, `prompt refused: ${r.drop}`)
          return undo?.()
        }
        return entered?.()
      },
      err => {
        logOnce($, `prompt refused: ${String(err)}`)
        return undo?.()
      },
    )
    // Run past its session, undo or entered may find their calls refused.
    .catch(err => logOnce($, `after a ring: ${String(err)}`))
}

/**
 * The last-seen sizes, validated out of $.state, keyed by fileKey (kit #46). A key an older watch
 * stored under another spelling folds into its file's key, so an upgrade rings nothing again.
 */
async function sizesOf($: EngineInterface): Promise<Record<string, number>> {
  const raw = await read($, bellSizes)
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {}
  const sizes: Record<string, number> = {}
  for (const [file, size] of Object.entries(raw)) {
    if (typeof size !== 'number') continue
    const key = fileKey(file)
    sizes[key] = Math.max(sizes[key] ?? 0, size)
  }
  return sizes
}

/** The last-seen text hashes, validated out of $.state; a file with none is judged by size alone. */
async function hashesOf($: EngineInterface): Promise<Record<string, number>> {
  const raw = await read($, bellHashes)
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {}
  const hashes: Record<string, number> = {}
  for (const [key, hash] of Object.entries(raw)) if (typeof hash === 'number') hashes[key] = hash
  return hashes
}

/**
 * The kept bookmarks of the home's tail-style bells (kit #51), out of $.store, which outlives the
 * session: a new session, or one after /clear, rings only what no ring has brought in. Undefined
 * when the store cannot be read; a session with no bookmark of its own then counts from 0, as
 * before.
 */
async function keptOf($: EngineInterface, home: string): Promise<Record<string, Bookmark> | undefined> {
  try {
    return bookmarksOf(await $.store.get(bellsKey(home)))
  } catch (err) {
    logOnce($, `tail-style bookmarks last this session only: the store cannot be read (${String(err)})`)
    return undefined
  }
}

async function keep($: EngineInterface, home: string, kept: Record<string, Bookmark>): Promise<void> {
  try {
    await $.store.set(bellsKey(home), kept)
  } catch (err) {
    logOnce($, `tail-style bookmarks stay as last kept: the store cannot be written (${String(err)})`)
  }
}

/**
 * The doorbells: every declared file that grew past its last-seen text, or whose text was
 * replaced by other non-empty text (kit #52), rings; all of one poll's rings as one prompt. Sizes
 * are character counts of what $.fs.read returns -- compared only with themselves. A missing file
 * counts 0, so delete-then-write rings and create-at-0 does not.
 *
 * $.state, the session's own, keeps every bookmark and is read first. A tail-style bell (inject:
 * true) is never consumed, so its bookmark is also kept in $.store, per home, which a session with
 * no bookmark of its own reads (kit #51). The kept one moves only past what reached a turn: when
 * a ring's prompt enters, and at a poll that rings nothing of the file with no ring of it queued
 * (it was emptied, an older watch kept it in $.state alone, or a store write failed before). So a
 * ring still queued when its session ends rings again in the next. An inbox-style bell keeps only
 * the session's: an unconsumed inbox rings once in a new session.
 */
async function doorbellCheck($: EngineInterface, home: string, conf: string): Promise<void> {
  const confPath = `${home}/memory-kit.conf`
  if (/^watch_sources:/m.test(conf))
    await tellOnce($, `watch_sources in ${confPath} is gone (watch 0.5.0): declare watch_files entries (label, path, instruction, inject); consuming a file is the home's own step.`)
  const d = readDoorbells(conf)
  for (const p of d.problems) await tellOnce($, `watch_files in ${confPath}: ${p}`)
  if (d.bells.length === 0) return

  const userHome = (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE')) ?? ''
  const sizes = await sizesOf($)
  const hashes = await hashesOf($)
  const kept = d.bells.some(b => b.inject) ? await keptOf($, home) : undefined
  const queued = new Set([...inFlight].flat())
  const rung: { bell: Doorbell; file: string; key: string; old: number; oldHash?: number; content: string; replaced: boolean }[] = []
  const seen = new Set<string>()
  let changed = false
  let keptChanged = false
  for (const bell of d.bells) {
    const path = expandHome(bell.path, home, userHome)
    if (path === undefined) {
      await tellOnce($, `watch_files in ${confPath}: skipped "${bell.path}": no HOME or USERPROFILE for ~`)
      continue
    }
    for (const file of await expand($, path)) {
      const key = fileKey(file)
      // A file two entries name is one bell, the first entry's: one bookmark, one ring (kit #46).
      if (seen.has(key)) continue
      seen.add(key)
      const content = await readOrEmpty($, file)
      const own = sizes[key]
      const mark = bell.inject ? kept?.[key] : undefined
      const old = own ?? mark?.size ?? 0
      const oldHash = own !== undefined ? hashes[key] : mark?.hash
      const change = bellChange(content, old, oldHash)
      if (change !== undefined) rung.push({ bell, file, key, old, oldHash, content, replaced: change === 'replaced' })
      const hash = textHash(content)
      if (content.length !== sizes[key] || hash !== hashes[key]) {
        sizes[key] = content.length
        hashes[key] = hash
        changed = true
      }
      if (bell.inject && kept !== undefined && change === undefined && !queued.has(key) && (content.length !== mark?.size || hash !== mark.hash)) {
        kept[key] = { size: content.length, hash }
        keptChanged = true
      }
    }
  }
  if (changed) {
    await $.state.set({ plugin: 'watch', key: 'bellSizes' }, sizes)
    await $.state.set({ plugin: 'watch', key: 'bellHashes' }, hashes)
  }
  if (kept !== undefined && keptChanged) await keep($, home, kept)
  if (rung.length === 0) return
  $.ui.log(`watch: ring (${rung.map(g => bellLabel(g.bell, g.file)).join(', ')})`, { to: 'debug' })
  const tails = rung.filter(g => g.bell.inject)
  const carried = tails.map(g => g.key)
  if (carried.length > 0) inFlight.add(carried)
  ask(
    $,
    combineRings(rung.map(g => ringText(g.bell, g.file, g.old, g.content, g.replaced))),
    async () => {
      // Back to the bookmark before the ring, size and hash together, so the next poll rings
      // again. The kept one never moved for it. Still queued until rolled back: a poll between
      // must not move the kept one past it.
      try {
        const nowSizes = await sizesOf($)
        const nowHashes = await hashesOf($)
        for (const g of rung) {
          nowSizes[g.key] = g.old
          if (g.oldHash === undefined) delete nowHashes[g.key]
          else nowHashes[g.key] = g.oldHash
        }
        await $.state.set({ plugin: 'watch', key: 'bellSizes' }, nowSizes)
        await $.state.set({ plugin: 'watch', key: 'bellHashes' }, nowHashes)
      } finally {
        inFlight.delete(carried)
      }
    },
    async () => {
      // The ring reached a turn: the kept bookmarks move past what it carried (kit #51).
      try {
        if (tails.length === 0) return
        const nowKept = await keptOf($, home)
        if (nowKept === undefined) return
        for (const g of tails) nowKept[g.key] = { size: g.content.length, hash: textHash(g.content) }
        await keep($, home, nowKept)
      } finally {
        inFlight.delete(carried)
      }
    },
  )
}

/**
 * The session reports, both information only. A conf line that cannot be read is said once, never
 * a silent off. Each context mark reports once per session; the idle report fires once per
 * working stretch (armed by a human prompt, disarmed by the report itself).
 */
async function reportCheck($: EngineInterface, conf: string): Promise<void> {
  const idle = confIdleMinutes(conf)
  if (idle.problem !== undefined) logOnce($, `watch_idle_minutes: ${idle.problem}`)
  const repeat = confIdleRepeat(conf)
  if (repeat.problem !== undefined) logOnce($, `watch_idle_repeat: ${repeat.problem}`)
  if (repeat.on && !idle.declared) logOnce($, 'watch_idle_repeat: true does nothing without watch_idle_minutes')
  const marks = confContextPercent(conf)
  if (marks.problem !== undefined) logOnce($, `watch_context_percent: ${marks.problem}`)
  if (idle.values.length === 0 && marks.values.length === 0) return

  const now = await $.clock.now()
  const { context } = await $.session.usage()

  const idleMinutes = idle.values[0]
  if (idleMinutes !== undefined && idleArmed && now - lastActivity >= idleMinutes * MINUTE) {
    idleArmed = repeat.on
    const minutes = Math.round((now - lastActivity) / MINUTE)
    // The next report waits a full interval from this one, even if this one's turn never starts
    // (a refused prompt): a repeating report must not fire at every poll.
    lastActivity = now
    $.ui.log(`watch: idle report (${minutes} min${repeat.on ? ', repeating' : ''})`, { to: 'debug' })
    ask($, idleReport(minutes, confValue(conf, 'watch_retire_step'), repeat.on))
  }

  if (marks.values.length > 0 && context.tokens !== undefined) {
    const done = await read($, reportedMarks)
    const reported = Array.isArray(done) ? done.filter((m): m is number => typeof m === 'number') : []
    const crossed = marksCrossed(marks.values, reported, context.tokens, context.window)
    if (crossed.length > 0) {
      await $.state.set({ plugin: 'watch', key: 'reportedMarks' }, [...reported, ...crossed])
      const top = crossed[crossed.length - 1]
      if (top !== undefined) {
        $.ui.log(`watch: context report (${crossed.join('%, ')}% crossed)`, { to: 'debug' })
        ask($, contextReport(top, context.tokens, context.window))
      }
    }
  }
}

/**
 * One notice to the human. A terminal without a notification channel (tmux, live check
 * 2026-10-14: `no-channel`) or with a bare bell shows no text, so the text also goes to the
 * transcript as a dim line.
 */
async function tell($: EngineInterface, text: string): Promise<void> {
  let shown = false
  try {
    const sent = await $.ui.notify(text, { title: 'watch' })
    shown = sent.isSent && sent.channel !== 'terminal_bell'
  } catch {
    // Refused: the transcript line below carries it.
  }
  // The engine already heads a plugin's transcript line with its name (seen live).
  if (!shown) $.ui.log(text)
}

const told = new Set<string>()

/** tell, once per distinct text for the module's life. */
async function tellOnce($: EngineInterface, text: string): Promise<void> {
  if (told.has(text)) return
  told.add(text)
  await tell($, text)
}

/** What /watch answers: the doorbells active now, what was skipped and why, the session sensors. */
async function status($: EngineInterface, settings: Settings): Promise<string> {
  const { found, start, viaOption } = await homeOf($, settings)
  if ('problem' in found) return `${found.problem}.\nThe watch rings nothing until it is fixed.`
  const home = found.home
  const conf = await readOrEmpty($, `${home}/memory-kit.conf`)
  const confPath = `${home}/memory-kit.conf`
  const d = readDoorbells(conf)
  const lines: string[] = [`home: ${home}${found.pointer !== undefined ? ` (kit_home in ${found.pointer})` : ''}`]
  if (found.foundIn !== undefined) lines.push(foundAboveNote(start, found.foundIn))
  if (!d.declared) lines.push(`no watch_files in ${confPath}; no doorbells.`)
  else {
    const n = d.bells.length
    lines.push(`${n} doorbell${n === 1 ? '' : 's'}, from ${confPath}`)
    for (const b of d.bells)
      lines.push(`  [${b.label === '' ? `(${b.path.split(/[\\/]/).pop()})` : b.label}] ${b.path}${b.inject ? '  inject' : ''}${b.instruction === '' ? '' : `  "${b.instruction}"`}`)
    for (const p of d.problems) lines.push(`  problem: ${p}`)
    if (viaOption && !isInside(start, home)) lines.push(`ringing here: no; this session started outside the home (${start})`)
  }
  const idle = confIdleMinutes(conf)
  const marks = confContextPercent(conf)
  const repeat = confIdleRepeat(conf)
  const again = repeat.problem !== undefined ? ` (watch_idle_repeat unreadable: ${repeat.problem})` : repeat.on ? ', repeating' : ''
  const idleSay = idle.problem !== undefined ? `unreadable (${idle.problem})` : idle.values[0] !== undefined ? `report at ${idle.values[0]} min${again}` : 'off'
  const markSay = marks.problem !== undefined ? `unreadable (${marks.problem})` : marks.values.length > 0 ? `report at ${marks.values.join(', ')}% of the window` : 'off'
  lines.push(`idle: ${idleSay}; context: ${markSay}; poll every ${settings.pollMs / 1000} s`)
  return lines.join('\n')
}

async function tick($: EngineInterface, settings: Settings): Promise<void> {
  if (polling) return
  polling = true
  try {
    const at = await usableHome($, settings)
    if (at === undefined) return
    const conf = await readOrEmpty($, `${at.home}/memory-kit.conf`)
    // The `home` option applies to every session on the machine; a session started outside that
    // home stays silent there (the session sensors are this session's own and still run).
    if (at.viaOption && !isInside(at.start, at.home)) {
      if (readDoorbells(conf).declared)
        await tellOnce(
          $,
          `This session started in ${at.start}, outside the watch's home ${at.home} (the home option), so it rings nothing here. To watch the home from another folder, put "kit_home: ${at.home}" in that folder's memory-kit.conf.`,
        )
    } else await doorbellCheck($, at.home, conf)
    await reportCheck($, conf)
  } catch (err) {
    logOnce($, `poll failed: ${String(err)}`)
  } finally {
    polling = false
  }
}

async function markActivity($: EngineInterface): Promise<void> {
  lastActivity = await $.clock.now()
}

export const register: Register = (on, options) => {
  const settings: Settings = {
    home: typeof options.home === 'string' ? options.home.trim() : '',
    pollMs: Math.max(5, num(options.pollSeconds, 5)) * 1_000,
  }
  // The retire options moved into memory-kit.conf (watch 0.5.0): say so, never silently.
  if (options.retireOnIdle === true) {
    retiredOption = 'the retireOnIdle option is gone: declare watch_idle_minutes and watch_context_percent in memory-kit.conf (watch 0.5.0, information-only reports)'
  }
  let timer: { cancel: () => void } | undefined

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    // The first start only (a reload fires it again, by then maybe after a cd). That first start
    // may be an install or enable mid-session, whose e.cwd is the shell's folder after any cd:
    // the session's root is not moved by a cd (kit #45).
    if ((await read($, startCwd)) === '') await $.state.set({ plugin: 'watch', key: 'startCwd' }, await startFolder($, e.cwd))
    if (retiredOption !== undefined) await tellOnce($, retiredOption)
    await markActivity($)
    await $.command.register({ name: 'watch', description: 'Show the doorbells and session reports active in this home' })
    // A new session (a /clear) has no ring of its own queued yet; one of the last session's that
    // still enters moves the kept bookmark then (kit #51).
    inFlight.clear()
    timer?.cancel()
    timer = $.clock.every(settings.pollMs, () => void tick($, settings))
    // Not awaited: a ring waits for its turn to start, which a start hook must not hold up.
    void tick($, settings)
    return started
  })

  on('command.run', { command: 'watch' }, async $ => ({ text: await status($, settings) }))

  // Activity, for the idle clock. Observers: a failure here never touches the prompt or the call.
  on('prompt.submit', async ($, e, next) => {
    try {
      await markActivity($)
      // Only the human arms the idle report: the watch's own rings and reports never do,
      // so one working stretch gets one report, not one every idle interval.
      if (isHuman(e.origin)) idleArmed = true
    } catch {
      // The idle clock is not worth a lost prompt.
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    await markActivity($)
    return done
  }).catch(($, e, next) => next(e))

  on('tool.call', async ($, e, next) => {
    await markActivity($)
    return next(e)
  }).catch(($, e, next) => next(e))
}
