// The watch mod (memory-kit issue #9). Two jobs, both on one timer:
//  1. drain the sources a kit home declares and deliver each item as a $.prompt.submit, which
//     queues until the session is idle and wakes it then;
//  2. behind retireOnIdle (default off), ask an idle session whose context has grown to
//     checkpoint and retire, held back by the five guards in hooks/watch.ts.

import { atom, read } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import {
  archiveFor,
  asideOf,
  backoffMs,
  brake,
  confValue,
  COURIER_GRACE_MS,
  decideRetire,
  entryKey,
  expandHome,
  fileOpArgv,
  formatEvent,
  hubItems,
  isAsideOf,
  isHuman,
  isPendingOf,
  lineItems,
  matchSegment,
  MINUTE,
  parseSource,
  pathSegments,
  pendingEvents,
  pendingOf,
  platformOfHome,
  PROBE_ARGV,
  recentAsks,
  retirePrompt,
  sourcesOf,
  STALE_LOCK_MS,
  takes,
} from './watch'
import type { FileOp, Item, Platform, Source, Take } from './watch'

const startCwd = atom({ plugin: 'watch', key: 'startCwd' } as const, '')
const askedAt = atom({ plugin: 'watch', key: 'askedAt' } as const, 0)
const survivedNotified = atom({ plugin: 'watch', key: 'survivedNotified' } as const, false)

/** $.store key: every retire ask, from every session (guard 4). */
const RETIRES = 'retires'
const DAY = 24 * 60 * MINUTE

type Settings = { home: string; pollMs: number; retireOnIdle: boolean; idleMs: number; growthFraction: number }

const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : fallback)

// Module state: a reload starts it over, which only ever holds a retire back (no human seen yet).
let humanSeen = false
let baseline = 0
/** The human spoke before the session had any reading: the first reading becomes the baseline. */
let baselinePending = false
let lastActivity = 0
let stoppedUntil = 0
let polling = false
let nonce = 0
const logged = new Set<string>()

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

async function homeOf($: EngineInterface, settings: Settings): Promise<string> {
  const start = (await read($, startCwd)) || (await $.session.cwd())
  return settings.home === '' ? start : (expandHome(settings.home, start, '') ?? start)
}

const dirOf = (path: string) => path.slice(0, Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')))

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

// The host's platform, found once per module load (kit alpha.9): a drive-letter or UNC home is
// Windows; otherwise `uname -s` decides (it answers on Linux and macOS, not on Windows).
let platform: Platform | undefined
let homeHint = ''

async function platformOf($: EngineInterface): Promise<Platform> {
  if (platform !== undefined) return platform
  let found = platformOfHome(homeHint)
  if (found === undefined) {
    try {
      found = (await $.process.run([...PROBE_ARGV], { timeoutMs: 10_000 })).exitCode === 0 ? 'posix' : 'windows'
    } catch {
      found = 'windows'
    }
  }
  platform = found
  logOnce($, `file operations run on ${found === 'posix' ? 'POSIX mv/rm' : 'Windows PowerShell'}`)
  return found
}

/** One rename, delete or lock operation on the host; false (one debug line per distinct failure) when it failed. */
async function fileOp($: EngineInterface, f: FileOp): Promise<boolean> {
  const what = 'path' in f ? `${f.op} ${f.path}` : `${f.op} ${f.from} -> ${f.to}`
  try {
    const { exitCode, stderr } = await $.process.run(fileOpArgv(await platformOf($), f), { timeoutMs: 30_000 })
    if (exitCode !== 0) logOnce($, `${what} failed: ${stderr.trim()}`)
    return exitCode === 0
  } catch (err) {
    logOnce($, `${what} failed: ${String(err)}`)
    return false
  }
}

const itemsOf = (format: Source['format'], text: string): Item[] | undefined =>
  format === 'hub' ? hubItems(text) : lineItems(text)

/** Writes a whole file through a temporary beside it and a rename: a crash never leaves half an archive. */
async function replace($: EngineInterface, path: string, text: string): Promise<boolean> {
  const tmp = `${path}.watch-tmp`
  await $.fs.write(tmp, text)
  return fileOp($, { op: 'move-replace', from: tmp, to: path })
}

/** Adds an aside's content to the archive. False (and the aside kept) when the archive is not usable. */
async function archive($: EngineInterface, format: Source['format'], path: string, text: string): Promise<boolean> {
  try {
    const old = await readOrEmpty($, path)
    if (format === 'lines') {
      const sep = old === '' || old.endsWith('\n') ? '' : '\n'
      return await replace($, path, `${old}${sep}${text.endsWith('\n') ? text : `${text}\n`}`)
    }
    const before: unknown = old.trim() === '' ? [] : JSON.parse(old)
    const added: unknown = text.trim() === '' ? [] : JSON.parse(text)
    if (!Array.isArray(before) || !Array.isArray(added)) {
      logOnce($, `${path}: the archive is not a JSON list; drained items stay aside`)
      return false
    }
    return await replace($, path, `${JSON.stringify([...before, ...added], null, 2)}\n`)
  } catch (err) {
    logOnce($, `${path}: cannot archive (${String(err)}); drained items stay aside`)
    return false
  }
}

/** The retire ask: fire and forget (a refusal is logged); it resolves only when its turn starts. */
function ask($: EngineInterface, text: string): void {
  void $.prompt.submit({ text }).catch(err => logOnce($, `retire ask refused: ${String(err)}`))
}

/**
 * One aside: archive it, then turn it into a pending file of events beside the source and
 * remove it. Delivery is a separate pass. An unreadable aside goes back if the file is free.
 */
async function drainAside($: EngineInterface, source: Source, file: string, aside: string, archivePath: string): Promise<void> {
  const text = await readOrEmpty($, aside)
  const items = itemsOf(source.format, text)
  if (items === undefined) {
    if (source.take !== undefined) {
      // A shared inbox is the harness's: nothing of ours is ever put back into it.
      logOnce($, `${aside}: not a hub inbox; left aside`)
      return
    }
    // Put back only where nothing new has arrived (mv -n); otherwise it stays aside, not lost.
    await fileOp($, { op: 'move-keep', from: aside, to: file })
    logOnce($, `${aside}: not a hub inbox; put back where ${file} was free, else left aside`)
    return
  }
  if (items.length > 0) {
    if (!(await archive($, source.format, archivePath, text))) return
    const events = items.map(item => formatEvent(source.prefix, item, archivePath))
    if (!(await replace($, pendingOf(aside), `${JSON.stringify(events, null, 1)}\n`))) return
  }
  await fileOp($, { op: 'remove', path: aside })
}

/** The entries of `file`'s directory that `match`, as paths, oldest first (the names carry the time). */
async function besideOf($: EngineInterface, file: string, match: (file: string, name: string) => boolean): Promise<string[]> {
  try {
    return (await $.fs.list(dirOf(file)))
      .filter(e => match(file, e.name))
      .map(e => `${dirOf(file)}/${e.name}`)
      .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))
  } catch {
    return [] // No directory: nothing there.
  }
}

/** Drains one file: asides a crash left behind first, then the file itself, renamed aside before it is read. */
async function drainFile($: EngineInterface, source: Source, file: string, archivePath: string): Promise<void> {
  for (const aside of await besideOf($, file, isAsideOf)) await drainAside($, source, file, aside, archivePath)
  if (source.take !== undefined) {
    await drainShared($, source, source.take, file, archivePath)
    return
  }

  const text = await readOrEmpty($, file)
  const items = itemsOf(source.format, text)
  if (items === undefined) {
    logOnce($, `${file}: not a hub inbox; left in place`)
    return
  }
  if (items.length === 0) return
  const aside = asideOf(file, await $.clock.now(), ++nonce)
  if (!(await fileOp($, { op: 'move', from: file, to: aside }))) return
  await drainAside($, source, file, aside, archivePath)
}

/** When each takeable entry of a shared inbox was first seen, by `<file>\n<entry key>`. */
const firstSeen = new Map<string, number>()

/**
 * Takes the harness's lock on a shared inbox (`<inbox>.lock`, a directory, as the harness itself
 * takes it). A lock older than STALE_LOCK_MS is broken first. False: someone holds it.
 */
async function lock($: EngineInterface, path: string, now: number): Promise<boolean> {
  if (await $.fs.exists(path)) {
    let mtime = now
    try {
      mtime = (await $.fs.stat(path)).mtimeMs
    } catch {
      return false
    }
    if (now - mtime <= STALE_LOCK_MS) return false
    logOnce($, `${path}: stale lock (older than ${STALE_LOCK_MS / 1000} s), broken`)
    if (!(await fileOp($, { op: 'unlock', path }))) return false
  }
  return fileOp($, { op: 'lock', path })
}

/**
 * A shared inbox (kit #12): the harness's own teammate inbox, which the courier also writes. Only
 * the entries the source takes leave it, after COURIER_GRACE_MS (the harness delivers them itself
 * while its team is live). Under the harness's lock: re-read, write the taken entries to an aside
 * (temp + rename), then the rest back in place (temp + rename, as the harness writes), unlock.
 * Everything else stays, in order and unchanged. The courier writes only into an empty inbox, and
 * the watch writes only when it takes something, so it never meets the courier mid-write.
 */
async function drainShared($: EngineInterface, source: Source, take: Take, file: string, archivePath: string): Promise<void> {
  const text = await readOrEmpty($, file)
  if (text.trim() === '') return
  const parse = (t: string): unknown[] | undefined => {
    try {
      const data: unknown = JSON.parse(t)
      return Array.isArray(data) ? data : undefined
    } catch {
      return undefined
    }
  }
  const seen = parse(text)
  if (seen === undefined) {
    logOnce($, `${file}: not a hub inbox; left in place`)
    return
  }
  const now = await $.clock.now()
  const keys = new Set(seen.filter(e => takes(take, e)).map(e => `${file}\n${entryKey(e)}`))
  for (const k of [...firstSeen.keys()]) if (k.startsWith(`${file}\n`) && !keys.has(k)) firstSeen.delete(k)
  for (const k of keys) if (!firstSeen.has(k)) firstSeen.set(k, now)
  const ready = new Set([...keys].filter(k => now - (firstSeen.get(k) ?? now) >= COURIER_GRACE_MS))
  if (ready.size === 0) return

  const lockPath = `${file}.lock`
  if (!(await lock($, lockPath, now))) return
  let aside: string | undefined
  try {
    const entries = parse(await readOrEmpty($, file))
    if (entries === undefined) return
    const isTaken = (e: unknown) => takes(take, e) && ready.has(`${file}\n${entryKey(e)}`)
    const taken = entries.filter(isTaken)
    if (taken.length === 0) return
    const candidate = asideOf(file, now, ++nonce)
    if (!(await replace($, candidate, `${JSON.stringify(taken, null, 2)}\n`))) return
    if (!(await replace($, file, JSON.stringify(entries.filter(e => !isTaken(e)), null, 2)))) {
      // The inbox still holds them: drop our copy rather than deliver twice.
      await fileOp($, { op: 'remove', path: candidate })
      return
    }
    for (const e of taken) firstSeen.delete(`${file}\n${entryKey(e)}`)
    aside = candidate
  } finally {
    await fileOp($, { op: 'unlock', path: lockPath })
  }
  await drainAside($, source, file, aside, archivePath)
}

// Delivery state: refusals in a row, the next try, whether the human was told about this streak.
let refusals = 0
let nextDeliveryAt = 0
let refusalTold = false

/**
 * Delivers the pending events, oldest first, one at a time: each submit is awaited and its event
 * leaves the pending file only once accepted. A submit resolves when its turn starts, so a busy
 * session holds this pass (and the poll, single-flight) until then; nothing is sent twice. A
 * crash between an accepted submit and the rewrite can deliver that one event again; none is lost.
 * A refusal stops the pass, backs off (1 min doubling to 30 min) and tells the human once.
 */
async function deliverPending($: EngineInterface, files: readonly string[]): Promise<void> {
  if ((await $.clock.now()) < nextDeliveryAt) return
  for (const [i, path] of files.entries()) {
    let events = pendingEvents(await readOrEmpty($, path))
    while (events.length > 0) {
      const [event = '', ...rest] = events
      let refused: string | undefined
      try {
        const result = await $.prompt.submit({ text: event })
        if (result.drop !== undefined) refused = result.drop
      } catch (err) {
        refused = String(err)
      }
      if (refused !== undefined) {
        refusals++
        nextDeliveryAt = (await $.clock.now()) + backoffMs(refusals)
        if (!refusalTold) {
          refusalTold = true
          let waiting = events.length
          for (const later of files.slice(i + 1)) waiting += pendingEvents(await readOrEmpty($, later)).length
          const where = [...new Set(files.slice(i).map(dirOf))].join(', ')
          await tell($, `${waiting} items waiting in ${where}: delivery refused (${refused}). Retrying with backoff.`)
        }
        return
      }
      refusals = 0
      refusalTold = false
      events = rest
      if (events.length > 0) await replace($, path, `${JSON.stringify(events, null, 1)}\n`)
      else await fileOp($, { op: 'remove', path })
    }
  }
}

/** Drains every source into pending files; returns them all, in source order, oldest first. */
async function drainAll($: EngineInterface, home: string, conf: string): Promise<string[]> {
  const pending: string[] = []
  // Windows has USERPROFILE, and HOME only where something set it.
  const userHome = (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE')) ?? ''
  for (const spec of sourcesOf(conf)) {
    const source = parseSource(spec)
    if (typeof source === 'string') {
      logOnce($, `watch_sources: ${source}`)
      continue
    }
    const path = expandHome(source.path, home, userHome)
    const template = source.archive === undefined ? undefined : expandHome(source.archive, home, userHome)
    if (path === undefined || (source.archive !== undefined && template === undefined)) {
      logOnce($, `watch_sources: no HOME for ~ in: ${spec}`)
      continue
    }
    for (const file of await expand($, path)) {
      await drainFile($, source, file, archiveFor(template, file, source.format))
      pending.push(...(await besideOf($, file, isPendingOf)))
    }
  }
  return pending
}

/** The idle check: at most one ask per session, held back by every guard. */
async function idleCheck($: EngineInterface, settings: Settings, conf: string): Promise<void> {
  const step = confValue(conf, 'watch_retire_step')
  if (step === undefined) {
    logOnce($, 'retireOnIdle is on, but memory-kit.conf names no watch_retire_step: never asking')
    return
  }
  const now = await $.clock.now()
  const { context } = await $.session.usage()
  const stored = await $.store.get(RETIRES)
  const asks = Array.isArray(stored) ? stored.filter((t): t is number => typeof t === 'number') : []
  const asked = await read($, askedAt)
  const action = decideRetire(
    { idleMs: settings.idleMs, growthFraction: settings.growthFraction },
    {
      now,
      idleSince: lastActivity,
      // Until the baseline is known, no human counts yet.
      humanSeen: humanSeen && !baselinePending,
      baseline,
      tokens: context.tokens,
      window: context.window,
      askedAt: asked === 0 ? undefined : asked,
      survivedNotified: await read($, survivedNotified),
      stoppedUntil,
      asks,
    },
  )
  if (action === 'ask') {
    await $.store.set(RETIRES, [...recentAsks(asks, now), now])
    await $.state.set({ plugin: 'watch', key: 'askedAt' }, now)
    const grown = Math.round((((context.tokens ?? 0) - baseline) / context.window) * 100)
    $.ui.log(`watch: retire asked (idle ${Math.round((now - lastActivity) / MINUTE)} min, grown ${grown}%)`, { to: 'debug' })
    ask($, retirePrompt(step, Math.round((now - lastActivity) / MINUTE), grown))
  } else if (action === 'survived') {
    await $.state.set({ plugin: 'watch', key: 'survivedNotified' }, true)
    await tell($, 'This session was asked to checkpoint and retire an hour ago and is still here. The watch will not ask it again.')
  } else if (action === 'brake') {
    const verdict = brake(asks, now)
    stoppedUntil = now + DAY
    await tell($, `Retire on idle stopped until tomorrow: ${verdict.ok ? 'brake' : verdict.reason}. Reload the watch to resume sooner.`)
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
  if (!shown) $.ui.log(`watch: ${text}`)
}

async function tick($: EngineInterface, settings: Settings): Promise<void> {
  if (polling) return
  polling = true
  try {
    const home = await homeOf($, settings)
    homeHint = home
    const conf = await readOrEmpty($, `${home}/memory-kit.conf`)
    await deliverPending($, await drainAll($, home, conf))
    if (settings.retireOnIdle) await idleCheck($, settings, conf)
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
    retireOnIdle: options.retireOnIdle === true,
    idleMs: num(options.idleMinutes, 50) * MINUTE,
    growthFraction: num(options.growthPercent, 50) / 100,
  }
  let timer: { cancel: () => void } | undefined

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    if ((await read($, startCwd)) === '') await $.state.set({ plugin: 'watch', key: 'startCwd' }, e.cwd)
    await markActivity($)
    timer?.cancel()
    timer = $.clock.every(settings.pollMs, () => void tick($, settings))
    // Not awaited: a delivery waits for its turn to start, which a start hook must not hold up.
    void tick($, settings)
    return started
  })

  // Activity, for the idle clock. Observers: a failure here never touches the prompt or the call.
  on('prompt.submit', async ($, e, next) => {
    try {
      await markActivity($)
      if (isHuman(e.origin) && !humanSeen) {
        humanSeen = true
        // Guard 2: growth counts from what the session held when the human first spoke, or,
        // with no reading yet, from the first one (system prompt, tools and that first turn).
        const tokens = (await $.session.usage()).context.tokens
        baselinePending = tokens === undefined
        baseline = tokens ?? 0
      }
    } catch {
      // The idle clock is not worth a lost prompt.
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    await markActivity($)
    if (baselinePending) {
      const tokens = (await $.session.usage()).context.tokens
      if (tokens !== undefined) {
        baseline = tokens
        baselinePending = false
      }
    }
    return done
  }).catch(($, e, next) => next(e))

  on('tool.call', async ($, e, next) => {
    await markActivity($)
    return next(e)
  }).catch(($, e, next) => next(e))
}
