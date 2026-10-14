// The kit-update plugin (memory-kit issue #15, part 3): every checkMinutes it asks upstream for the
// newest release on the home's channel (memory-kit.conf `update: pinned | verified | latest`) and,
// once per release across every session, prompts the session to run memory-kit/tools/kit-update.py.
// It never runs git and never changes a file: it only tells.

import type { EngineInterface, Register } from 'claude-code'

import {
  backoffMs,
  channelOf,
  compareRelease,
  confValue,
  isFresh,
  kitVersionOf,
  parseRelease,
  promptText,
  stepCheck,
  tagNamesOf,
  tagsUrl,
  targetOf,
  upgradeUrl,
} from './release'
import type { Channel } from './release'

const MINUTE = 60_000
/** The local tick: cheap (store and file reads); upstream is asked only once per checkMinutes. */
const TICK_MS = MINUTE
/** $.http.fetch has no timeout of its own (the pane's lesson, #7). */
const FETCH_TIMEOUT_MS = 10_000
/** A claim is read back after this long; the last writer owns the release. */
const CLAIM_SETTLE_MS = 3_000
/** A claim not refreshed this long belongs to a session that is gone: another may take it over. */
const CLAIM_STALE_MS = 30 * MINUTE
/** At most this many tag pages (50 each). */
const MAX_PAGES = 10

/** $.store, shared by every session: the tags cache, and one record per prompted release. */
const TAGS = 'tags'
const promptKey = (version: string) => `prompt:${version}`

type TagsCache = Record<string, { checkedAt: number; names: string[] }>
type PromptRecord = { state: 'claimed' | 'delivered'; token: string; at: number }

type Settings = { home: string; checkMs: number; checkUpdates: boolean }

// Module state: a reload starts it over; the store keeps what must survive (the dedupe).
let checking = false
let refusals = 0
let nextTryAt = 0
let upgradeRetryAt = 0
const upgradeTexts = new Map<string, string>()
const told = new Set<string>()
/** This module's claim token: a reload gets a new one, and finds its old claim by the store's time. */
let token = ''

async function readOrEmpty($: EngineInterface, path: string): Promise<string> {
  try {
    return (await $.fs.exists(path)) ? await $.fs.read(path) : ''
  } catch {
    return ''
  }
}

async function homeOf($: EngineInterface, settings: Settings): Promise<string> {
  const cwd = await $.session.cwd()
  if (settings.home === '') return startCwd || cwd
  return /^(\/|[A-Za-z]:[\\/]|\\\\)/.test(settings.home) ? settings.home : `${startCwd || cwd}/${settings.home}`
}
let startCwd = ''

/** One notice to the human, once per text: notify, else a transcript line (the watch's lesson). */
async function tellOnce($: EngineInterface, text: string): Promise<void> {
  if (told.has(text)) return
  told.add(text)
  let shown = false
  try {
    const sent = await $.ui.notify(text, { title: 'kit-update' })
    shown = sent.isSent && sent.channel !== 'terminal_bell'
  } catch {
    // Refused: the transcript line carries it.
  }
  if (!shown) $.ui.log(text)
}

/** A GET that fails after FETCH_TIMEOUT_MS; undefined (and one debug line) on any failure. */
async function fetchText($: EngineInterface, url: string): Promise<string | undefined> {
  let timer: { cancel: () => void } | undefined
  try {
    const expired = new Promise<never>((_, reject) => {
      timer = $.clock.after(FETCH_TIMEOUT_MS, () => reject(new Error(`timed out after ${FETCH_TIMEOUT_MS / 1000} s`)))
    })
    const answer = await Promise.race([$.http.fetch(url, { headers: { accept: 'application/json, text/plain' } }), expired])
    if (!answer.ok) throw new Error(`HTTP ${answer.status}`)
    return answer.text
  } catch (err) {
    $.ui.log(`kit-update: ${url} failed: ${String(err)}`, { to: 'debug' })
    return undefined
  } finally {
    timer?.cancel()
  }
}

/**
 * Upstream's tag names, from the shared cache while it is younger than checkMinutes, else asked
 * (every page). A failure is silent and counts as a check, so the next try is one interval on,
 * for every session; undefined then.
 */
async function tagNames($: EngineInterface, upstream: string | undefined, settings: Settings, now: number): Promise<string[] | undefined> {
  const key = tagsUrl(upstream, 1) ?? ''
  const stored = await $.store.get(TAGS)
  const cache: TagsCache = typeof stored === 'object' && stored !== null ? (stored as TagsCache) : {}
  const entry = cache[key]
  if (entry !== undefined && Array.isArray(entry.names) && isFresh(entry.checkedAt, now, settings.checkMs)) return entry.names
  const names: string[] = []
  let failed = false
  for (let page = 1; page <= MAX_PAGES; page++) {
    const text = await fetchText($, tagsUrl(upstream, page) ?? '')
    const batch = text === undefined ? undefined : tagNamesOf(text)
    if (batch === undefined) {
      failed = true
      break
    }
    names.push(...batch)
    if (batch.length < 50) break
  }
  // Only release-shaped names are kept: the cache stays small.
  const kept = failed ? (entry?.names ?? []) : names.filter(n => /^(verified\/)?v\d/.test(n))
  await $.store.set(TAGS, { ...cache, [key]: { checkedAt: now, names: kept } })
  return failed ? undefined : kept
}

function recordOf(value: unknown): PromptRecord | undefined {
  const r = value as Partial<PromptRecord> | null | undefined
  if (r == null || (r.state !== 'claimed' && r.state !== 'delivered') || typeof r.token !== 'string' || typeof r.at !== 'number') return undefined
  return r as PromptRecord
}

/**
 * The prompt for `target`, once across every session: a session claims the release in $.store,
 * reads the claim back after CLAIM_SETTLE_MS (the last writer owns it), submits, and marks it
 * delivered. A refused submit keeps the claim, refreshed each tick, and retries with backoff; a
 * claim left CLAIM_STALE_MS (its session gone) is taken over.
 */
async function offer($: EngineInterface, target: string, channel: Channel, current: string, home: string, upstream: string | undefined, settings: Settings): Promise<void> {
  const key = promptKey(target)
  const now = await $.clock.now()
  const rec = recordOf(await $.store.get(key))
  if (rec?.state === 'delivered') return
  const ours = rec?.token === token
  if (rec !== undefined && !ours && now - rec.at < CLAIM_STALE_MS) return
  if (ours && now < nextTryAt) {
    await $.store.set(key, { state: 'claimed', token, at: now })
    return
  }

  let md = upgradeTexts.get(target)
  if (md === undefined) {
    if (now < upgradeRetryAt) return
    md = await fetchText($, upgradeUrl(upstream, target) ?? '')
    if (md === undefined) {
      upgradeRetryAt = now + settings.checkMs
      return
    }
    upgradeTexts.set(target, md)
  }
  const steps = stepCheck(md, current, target)

  if (!ours) {
    await $.store.set(key, { state: 'claimed', token, at: now })
    await $.clock.sleep(CLAIM_SETTLE_MS)
    if (recordOf(await $.store.get(key))?.token !== token) return
  }
  const text = promptText(
    steps.manual ? { version: target, channel, current, home, manual: true, reason: steps.reason } : { version: target, channel, current, home, manual: false },
  )
  let refused: string | undefined
  try {
    const result = await $.prompt.submit({ text })
    if (result.drop !== undefined) refused = result.drop
  } catch (err) {
    refused = String(err)
  }
  const after = await $.clock.now()
  if (refused !== undefined) {
    refusals++
    nextTryAt = after + backoffMs(refusals)
    await $.store.set(key, { state: 'claimed', token, at: after })
    $.ui.log(`kit-update: the prompt for ${target} was refused (${refused}); retrying in ${backoffMs(refusals) / MINUTE} min`, { to: 'debug' })
    return
  }
  refusals = 0
  await $.store.set(key, { state: 'delivered', token, at: after })
}

/** What the home declares and holds now. */
async function homeState($: EngineInterface, settings: Settings) {
  const home = await homeOf($, settings)
  const conf = await readOrEmpty($, `${home}/memory-kit.conf`)
  const version = kitVersionOf(await readOrEmpty($, `${home}/memory-kit/VERSION`))
  return { home, conf, version, ...channelOf(conf), upstream: confValue(conf, 'upstream') }
}

async function tick($: EngineInterface, settings: Settings): Promise<void> {
  if (checking) return
  checking = true
  try {
    const h = await homeState($, settings)
    if (h.problem !== undefined) await tellOnce($, `${h.home}/memory-kit.conf: ${h.problem}.`)
    if (!settings.checkUpdates || h.channel === 'pinned' || h.version === undefined) return
    if (tagsUrl(h.upstream, 1) === undefined) {
      await tellOnce($, `${h.home}/memory-kit.conf: upstream: ${h.upstream} is not owner/repo on Codeberg; nothing is checked.`)
      return
    }
    const names = await tagNames($, h.upstream, settings, await $.clock.now())
    if (names === undefined) return
    const target = targetOf(h.channel, names)
    const mine = parseRelease(h.version)
    const theirs = target === undefined ? undefined : parseRelease(target)
    if (target === undefined || mine === undefined || theirs === undefined || compareRelease(theirs, mine) <= 0) return
    await offer($, target, h.channel, h.version, h.home, h.upstream, settings)
  } catch (err) {
    $.ui.log(`kit-update: check failed: ${String(err)}`, { to: 'debug' })
  } finally {
    checking = false
  }
}

/** What /kit-update answers. */
async function status($: EngineInterface, settings: Settings): Promise<string> {
  const h = await homeState($, settings)
  const lines = [`channel: ${h.channel}${h.problem !== undefined ? ` (${h.problem})` : ''}`, `this home: ${h.version ?? 'no memory-kit/VERSION'} (${h.home})`]
  if (h.channel === 'pinned') {
    lines[0] += ' -- no checks; set update: verified or latest in memory-kit.conf to follow releases'
    return lines.join('\n')
  }
  if (!settings.checkUpdates) lines.push('checkUpdates is off: no checks')
  const stored = await $.store.get(TAGS)
  const entry = (typeof stored === 'object' && stored !== null ? (stored as TagsCache) : {})[tagsUrl(h.upstream, 1) ?? '']
  const target = entry === undefined ? undefined : targetOf(h.channel, entry.names)
  lines.push(`newest on the channel: ${target ?? 'not known yet'}`)
  lines.push(`last check: ${entry === undefined ? 'none yet' : `${new Date(entry.checkedAt).toISOString().slice(0, 16)} UTC`} (every ${settings.checkMs / MINUTE} min)`)
  if (target !== undefined) {
    const rec = recordOf(await $.store.get(promptKey(target)))
    const when = (at: number) => `${new Date(at).toISOString().slice(0, 16)} UTC`
    lines.push(
      `${target}: ${
        rec === undefined
          ? 'not prompted'
          : rec.state === 'delivered'
            ? `prompted ${when(rec.at)}${rec.token === token ? ' in this session' : ' in another session'}`
            : `claimed ${when(rec.at)}${rec.token === token ? ' by this session (prompt refused, retrying)' : ' by another session'}`
      }`,
    )
  }
  return lines.join('\n')
}

export const register: Register = (on, options) => {
  const settings: Settings = {
    home: typeof options.home === 'string' ? options.home.trim() : '',
    checkMs: Math.max(5, typeof options.checkMinutes === 'number' && Number.isFinite(options.checkMinutes) ? options.checkMinutes : 60) * MINUTE,
    checkUpdates: options.checkUpdates !== false,
  }
  let timer: { cancel: () => void } | undefined

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    if (startCwd === '') startCwd = e.cwd
    if (token === '') token = `${await $.clock.now()}-${Math.random().toString(36).slice(2, 10)}`
    await $.command.register({ name: 'kit-update', description: "Show the kit's update channel, this home's version, the newest release and the last check" })
    timer?.cancel()
    timer = $.clock.every(TICK_MS, () => void tick($, settings))
    // Never awaited: a check may wait on the network, and a prompt on its turn.
    void tick($, settings)
    return started
  })

  on('command.run', { command: 'kit-update' }, async $ => ({ text: await status($, settings) }))
}
