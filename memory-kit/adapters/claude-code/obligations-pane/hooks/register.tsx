// Obligations pane: shows memory/obligations.yaml of the session's working directory in a side
// pane, soonest expiry first. Read-only for good (Mihkel, 2026-10-14): it never writes.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { ObligationRow, PaneAgent, PaneSnapshot } from '../types'
import { resolveKitHome } from './kit-home'
import {
  actorColor,
  basename,
  cachedCheck,
  clampIndex,
  confValue,
  contextWeight,
  FETCH_TIMEOUT_MS,
  countsLabel,
  countsOf,
  DATE_FG,
  EXPIRED_DATE_BG,
  fitActor,
  fitName,
  fitWeight,
  FOOTER_CHROME,
  RULE_COLOR,
  HEADER_BG,
  HEADER_FG,
  isAbsolutePath,
  isFresh,
  isoDate,
  kitLabel,
  kitVersionOf,
  LINK_FG,
  liveAgents,
  MODEL_COLORS,
  memoryDirOf,
  modelLetter,
  newestRelease,
  offsetFromZ,
  PANE_BG,
  parentDir,
  parseObligations,
  recordStep,
  segmentsOf,
  sortByExpires,
  statusOf,
  step,
  subagentWeight,
  tagNamesOf,
  trailingLinksOf,
  updateNote,
  upstreamTagsUrl,
  urlNamesOf,
  urlOfFile,
  wheelStep,
} from './obligations'
import type { Segment } from './obligations'

export const PANE = 'obligations'
export const TITLE = 'Obligations'
export const REFRESH_MS = 20_000

const snapshot = atom({ plugin: 'obligations-pane', key: 'snapshot' } as const, null)
const index = atom({ plugin: 'obligations-pane', key: 'index' } as const, 0)
const models = atom({ plugin: 'obligations-pane', key: 'models' } as const, {})
const loads = atom({ plugin: 'obligations-pane', key: 'loads' } as const, {})
const mainModel = atom({ plugin: 'obligations-pane', key: 'mainModel' } as const, '')
const startCwd = atom({ plugin: 'obligations-pane', key: 'startCwd' } as const, '')

/** The pane's userConfig, trimmed. */
export type Settings = { agentName: string; memoryDir: string; checkUpdates: boolean }

/** A file's text, '' when it is missing or unreadable. */
async function readOrEmpty($: EngineInterface, path: string): Promise<string> {
  try {
    return (await $.fs.exists(path)) ? await $.fs.read(path) : ''
  } catch {
    return ''
  }
}

/**
 * The memory directory: the memoryDir option when set, else <cwd>/<memory_dir> from
 * <cwd>/memory-kit.conf, else <cwd>/memory. A relative path resolves against cwd; a Windows
 * absolute one (C:\, C:/, UNC) does not (kit #8).
 */
function memoryRoot(cwd: string, conf: string, memoryDir: string): string {
  const dir = memoryDir !== '' ? memoryDir : (memoryDirOf(conf) ?? 'memory')
  return isAbsolutePath(dir) ? dir : `${cwd}/${dir}`
}

/** The $.store key holding every upstream's last check (url -> UpstreamCheck), shared across sessions. */
const STORE_KEY = 'upstream'

let zoneOffset: number | undefined

/** Minutes east of UTC. The environment's own zone first; the host's `date +%z` when it says UTC. */
async function offsetOf($: EngineInterface, now: number): Promise<number> {
  const own = -new Date(now).getTimezoneOffset()
  if (own !== 0) return own
  if (zoneOffset !== undefined) return zoneOffset
  try {
    const { exitCode, stdout } = await $.process.run(['date', '+%z'], { timeoutMs: 2_000 })
    zoneOffset = exitCode === 0 ? (offsetFromZ(stdout) ?? 0) : 0
  } catch {
    zoneOffset = 0
  }
  return zoneOffset
}

async function readObligations(
  $: EngineInterface,
  path: string,
): Promise<Pick<PaneSnapshot, 'source' | 'error' | 'items'>> {
  if (!(await $.fs.exists(path))) return { source: 'missing', error: '', items: [] }
  let text: string
  try {
    text = await $.fs.read(path)
  } catch (err) {
    return { source: 'error', error: `cannot read: ${String(err)}`, items: [] }
  }
  const parsed = parseObligations(text)
  if (parsed.kind === 'error') return { source: 'error', error: `line ${parsed.line}: ${parsed.message}`, items: [] }
  return { source: 'ok', error: '', items: sortByExpires(parsed.items) }
}

async function resolveUrls($: EngineInterface, root: string, items: readonly ObligationRow[]) {
  const urls: Record<string, string> = {}
  const names = [...new Set(items.flatMap(urlNamesOf))].slice(0, 100)
  for (const name of names) {
    try {
      const url = urlOfFile(await $.fs.read(`${root}/urls/${name}`))
      if (url !== undefined) urls[name] = url
    } catch {
      // Missing urls/<name>: drawn as a dead reference. The pane never writes urls/.
    }
  }
  return urls
}

let badUpstreamLogged = false

/**
 * The release check's inputs (kit #4, #7): the home's memory-kit/VERSION, the tags URL to ask
 * ('' when no check is made: checkUpdates off, no VERSION, or an unusable `upstream:`), and
 * the newest release the shared cache knows for it. No request here.
 *
 * The home is the one that holds the memory directory (a memoryDir session runs outside it),
 * else the cwd: the first with a memory-kit/VERSION. Its memory-kit.conf names `upstream:`.
 */
async function kitOf($: EngineInterface, cwd: string, root: string, checkUpdates: boolean, pointed?: string) {
  let home = ''
  let kitVersion = ''
  // A pointed home (kit_home) is the only candidate; without its VERSION the slot says "?" (the
  // pointer promised a kit home) and nothing is asked upstream.
  if (pointed !== undefined && kitVersionOf(await readOrEmpty($, `${pointed}/memory-kit/VERSION`)) === undefined)
    return { kitVersion: '?', upstreamUrl: '', latest: '' }
  for (const candidate of pointed !== undefined ? [pointed] : [...new Set([parentDir(root), cwd])]) {
    kitVersion = kitVersionOf(await readOrEmpty($, `${candidate}/memory-kit/VERSION`)) ?? ''
    if (kitVersion !== '') {
      home = candidate
      break
    }
  }
  if (!checkUpdates || kitVersion === '') return { kitVersion, upstreamUrl: '', latest: '' }
  const upstream = confValue(await readOrEmpty($, `${home}/memory-kit.conf`), 'upstream')
  const url = upstreamTagsUrl(upstream)
  if (url === undefined) {
    if (!badUpstreamLogged) $.ui.log(`obligations-pane: upstream check skipped: unusable upstream "${upstream}"`, { to: 'debug' })
    badUpstreamLogged = true
    return { kitVersion, upstreamUrl: '', latest: '' }
  }
  let latest = ''
  try {
    latest = cachedCheck(await $.store.get(STORE_KEY), url)?.latest ?? ''
  } catch {
    // No store: the check below fills it.
  }
  return { kitVersion, upstreamUrl: url, latest }
}

/** Gathers everything the pane draws and writes it to state in one go. No network. */
export async function refresh($: EngineInterface, settings: Settings): Promise<void> {
  const { agentName, memoryDir, checkUpdates } = settings
  const now = await $.clock.now()
  // The home is where the session started (kit issue #3): a shell cd into another repo
  // mid-session must not switch the ledger. $.session.cwd() only when no start was seen.
  const cwd = (await read($, startCwd)) || (await $.session.cwd())
  // kit #18: the start folder's memory-kit.conf may point at the home (kit_home:, one hop). The
  // pointer wins over the user-scope memoryDir option, which applies to every session.
  const found = await resolveKitHome(cwd, async p => ((await $.fs.exists(p)) ? $.fs.read(p) : undefined))
  const pointed = !('problem' in found) && found.pointer !== undefined ? found.home : undefined
  const home = pointed ?? cwd
  const conf = await readOrEmpty($, `${home}/memory-kit.conf`)
  const root = memoryRoot(home, conf, pointed !== undefined ? '' : memoryDir)
  const path = 'problem' in found ? found.pointer : `${root}/obligations.yaml`
  const ledger: Pick<PaneSnapshot, 'source' | 'error' | 'items'> =
    'problem' in found ? { source: 'pointer', error: found.problem, items: [] } : await readObligations($, path)
  const urls = await resolveUrls($, root, ledger.items)

  let tokens: number | null = null
  let window: number | null = null
  try {
    const { context } = await $.session.usage()
    tokens = context.tokens ?? null
    window = context.window
  } catch {
    // No usage yet (no session bound): the footer shows "-".
  }
  let model = ''
  try {
    model = await $.session.model()
  } catch {
    // Unknown model draws "?".
  }
  const known = await read($, models)
  let agents: PaneAgent[] = []
  try {
    agents = (await $.agent.list()).map(a => ({
      id: a.id,
      name: a.name ?? a.teammateId?.split('@')[0] ?? a.description ?? a.type,
      model: known[a.id] ?? '',
      status: a.status,
    }))
  } catch {
    // No agent list: the footer shows the main agent alone.
  }

  const value: PaneSnapshot = {
    path,
    ...ledger,
    urls,
    ...('problem' in found ? { kitVersion: '', upstreamUrl: '', latest: '' } : await kitOf($, cwd, root, checkUpdates, pointed)),
    now,
    offsetMinutes: await offsetOf($, now),
    self: { name: agentName || basename(cwd), model, tokens, window },
    agents: liveAgents(agents),
  }
  await $.state.set({ plugin: 'obligations-pane', key: 'snapshot' }, value)
}

let lastWheelStep: number | undefined

/** One wheel event: at most one item, and nothing within the throttle of the last step. */
async function wheel($: EngineInterface, by: number): Promise<void> {
  const { delta, lastStep } = wheelStep(by, await $.clock.now(), lastWheelStep)
  lastWheelStep = lastStep
  if (delta === 0) return
  const snap = await read($, snapshot)
  const length = snap?.items.length ?? 0
  await update($, index, i => step(i, delta, length))
}

/**
 * Asks upstream for its tags when the shared cache is older than 6 h, and records the newest
 * release in $.store and the snapshot. Only reads: it never pulls. A failure is one debug line
 * and keeps the last known result; it counts as a check, so the next try is 6 h later.
 */
async function checkUpstream($: EngineInterface): Promise<void> {
  const url = (await read($, snapshot))?.upstreamUrl ?? ''
  if (url === '') return
  const now = await $.clock.now()
  const stored = await $.store.get(STORE_KEY)
  const cached = cachedCheck(stored, url)
  if (cached !== undefined && isFresh(cached.checkedAt, now)) return

  let latest = cached?.latest ?? ''
  let timeout: { cancel: () => void } | undefined
  try {
    // A request that never settles would hold `checking` for good: it fails at 10 s instead.
    const expired = new Promise<never>((_, reject) => {
      timeout = $.clock.after(FETCH_TIMEOUT_MS, () => reject(new Error(`timed out after ${FETCH_TIMEOUT_MS / 1000} s`)))
    })
    const answer = await Promise.race([$.http.fetch(url, { headers: { accept: 'application/json' } }), expired])
    const names = answer.ok ? tagNamesOf(answer.text) : undefined
    if (names === undefined) throw new Error(answer.ok ? 'not a tags list' : `HTTP ${answer.status}`)
    latest = newestRelease(names) ?? ''
  } catch (err) {
    $.ui.log(`obligations-pane: upstream check failed (${url}): ${String(err)}`, { to: 'debug' })
  } finally {
    timeout?.cancel()
  }
  const all = typeof stored === 'object' && stored !== null ? (stored as Record<string, unknown>) : {}
  await $.store.set(STORE_KEY, { ...all, [url]: { checkedAt: now, latest } })
  await update($, snapshot, s => (s === null || s.upstreamUrl !== url ? s : { ...s, latest }))
}

/** refresh, never throwing: a failure goes to the debug log and the last snapshot stays. */
async function safeRefresh($: EngineInterface, settings: Settings): Promise<void> {
  try {
    await refresh($, settings)
  } catch (err) {
    $.ui.log(`obligations-pane: refresh failed: ${String(err)}`, { to: 'debug' })
  }
}

let checking: Promise<void> | undefined

/** checkUpstream, one at a time and never throwing. */
async function safeCheck($: EngineInterface): Promise<void> {
  if (checking !== undefined) return checking
  checking = checkUpstream($).catch(err => $.ui.log(`obligations-pane: upstream check failed: ${String(err)}`, { to: 'debug' }))
  try {
    await checking
  } finally {
    checking = undefined
  }
}

/** The local refresh, then the release check when one is due, not awaited: no hook waits on the network. */
async function refreshAll($: EngineInterface, settings: Settings): Promise<void> {
  await safeRefresh($, settings)
  void safeCheck($)
}

export const register: Register = (on, options) => {
  const settings: Settings = {
    agentName: typeof options.agentName === 'string' ? options.agentName.trim() : '',
    memoryDir: typeof options.memoryDir === 'string' ? options.memoryDir.trim() : '',
    checkUpdates: options.checkUpdates !== false,
  }
  const autoOpen = options.autoOpen !== false
  let timer: { cancel: () => void } | undefined

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    // Kept in $.state, which outlives a reload: a reload fires session.start again with the
    // directory the session is in by then, so only the first start sets it.
    if ((await read($, startCwd)) === '') await $.state.set({ plugin: 'obligations-pane', key: 'startCwd' }, e.cwd)
    await $.command.register({ name: 'obligations', description: 'Open the obligations pane (memory/obligations.yaml)' })
    await safeRefresh($, settings)
    timer?.cancel()
    timer = $.clock.every(REFRESH_MS, () => void refreshAll($, settings))
    const snap = await read($, snapshot)
    if (autoOpen && snap?.source !== 'missing') void $.ui.open({ id: PANE, title: TITLE })
    // After the pane is up, and not awaited: the release check may wait on the network.
    void safeCheck($)
    return started
  })

  on('command.run', { command: 'obligations' }, async $ => {
    await safeRefresh($, settings)
    const opened = await $.ui.open({ id: PANE, title: TITLE })
    return { text: opened.isPlaced ? 'Obligations pane opened.' : 'Obligations pane waits for a wider terminal.' }
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    await refreshAll($, settings)
    return done
  })

  // agent.list() carries no model: remember what each spawn resolved to. An observer: if it
  // fails, the spawn goes on (next(e) replays a call that already settled, runs it otherwise).
  // Context load per subagent: the latest step's usage. Observe only: every chunk passes
  // through, the result is returned unchanged, and a failure here never touches the step.
  on('turn.step', async function* ($, e, next) {
    const result = yield* next(e)
    try {
      const usage = result.usage
      if (usage !== null) {
        if (e.agentId === undefined) await $.state.set({ plugin: 'obligations-pane', key: 'mainModel' }, usage.model)
        else await update($, loads, l => recordStep(l, e.agentId, usage))
      }
    } catch {
      // A lost load figure is not worth a failed hook.
    }
    return result
  })

  on('agent.spawn', async ($, e, next) => {
    const result = await next(e)
    const id = result.agentId
    if (result.deny === undefined && id !== undefined) {
      await update($, models, m => ({ ...m, [id]: result.model }))
      await safeRefresh($, settings)
    }
    return result
  }).catch(($, e, next) => next(e))

  // Mouse wheel (and scroll keys) over the pane: strictly one obligation per event, by e.by's
  // sign, then 150 ms of ignored events (a trackpad burst is one item); clamped to the list.
  // No next(e): the engine's window stays, so the header and footer stay fixed; the index
  // write redraws the pane.
  on('ui.scroll', { component: 'Pane', requestId: PANE }, async ($, e) => {
    await wheel($, e.by)
    return {}
  }).catch(() => ({}))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button, Link } = $.ui.resolve(e)
    const snap = await read($, snapshot)
    const at = await read($, index)
    const agentLoads = await read($, loads)
    const mainId = await read($, mainModel)
    const rows = e.props.scroll.bodyRows

    if (snap === null) {
      return (
        <Box backgroundColor={PANE_BG} flexDirection="column" height={rows}>
          <Text color={DATE_FG}>loading obligations…</Text>
        </Box>
      )
    }

    const today = isoDate(snap.now, snap.offsetMinutes)
    const items = snap.items
    const first = clampIndex(at, items.length)
    const move = (delta: number) => () => update($, index, i => step(i, delta, items.length))

    const header = (
      <Box key="header" backgroundColor={HEADER_BG} flexDirection="row" justifyContent="space-between" paddingX={1} flexShrink={0}>
        <Text color={HEADER_FG} bold wrap="truncate-end">
          {/* `?? ''`: a snapshot a 0.2.x module wrote before a hot reload has neither field. */}
          {[kitLabel(snap.kitVersion ?? '', updateNote(snap.kitVersion ?? '', snap.latest ?? '')), snap.source === 'ok' ? countsLabel(countsOf(items, today)) : '']
            .filter(part => part !== '')
            .join('  ')}
        </Text>
        {items.length > 1 && (
          <Box flexDirection="row" flexShrink={0}>
            <Text color={HEADER_FG}>
              {first + 1}/{items.length}
            </Text>
            {/* Not drawn: they only carry the k / j hotkeys. The wheel scrolls (ui.scroll). */}
            <Box display="none">
              <Button key="up" plain hotkey="k" onPress={move(-1)}>
                ▲
              </Button>
              <Button key="down" plain hotkey="j" onPress={move(1)}>
                ▼
              </Button>
            </Box>
          </Box>
        )}
      </Box>
    )

    const segment = (s: Segment, i: number) =>
      s.kind === 'text' ? (
        s.text
      ) : s.kind === 'link' ? (
        <Link key={`l${i}`} href={s.href}>
          <Text color={LINK_FG} underline>
            {s.name}
          </Text>
        </Link>
      ) : (
        <Text key={`d${i}`} color="#666666" strikethrough>
          urls/{s.name}
        </Text>
      )

    const row = (item: ObligationRow) => {
      const status = statusOf(item, today)
      const trailing = trailingLinksOf(item, snap.urls)
      return (
        <Box key={`row-${item.line}`} flexDirection="column" flexShrink={0} paddingX={1}>
          <Text color={DATE_FG}>
            <Text bold color={DATE_FG} {...(status === 'expired' ? { backgroundColor: EXPIRED_DATE_BG } : {})}>
              {item.expires}
            </Text>{' '}
            <Text bold color={actorColor(item.actor)}>
              {fitActor(item.actor)}
            </Text>{' '}
            {segmentsOf(item.obligation, snap.urls).map(segment)}
            {trailing.map((s, i) => [' ', segment(s, 100 + i)])}
          </Text>
        </Box>
      )
    }

    const body =
      snap.source === 'missing' ? (
        <Text color={DATE_FG}>no obligations file here ({snap.path})</Text>
      ) : snap.source === 'pointer' ? (
        <Text color="#9e0000">kit_home pointer broken: {snap.error}</Text>
      ) : snap.source === 'error' ? (
        <Text color="#9e0000">obligations.yaml unreadable: {snap.error}</Text>
      ) : items.length === 0 ? (
        <Text color={DATE_FG}>no obligations</Text>
      ) : (
        items.slice(first).map(row)
      )

    const agentLine = (key: string, name: string, model: string, tail: string, dim: boolean) => {
      const letter = modelLetter(model)
      return (
        // wrap, never truncate: the figure is the point of the line (fitWeight keeps it short).
        <Text key={key} color={DATE_FG} dimColor={dim} wrap="wrap">
          {fitName(name)}{' '}
          <Text bold color={MODEL_COLORS[letter]} dimColor={letter === '·'}>
            {letter}
          </Text>
          {tail !== '' ? ` ${fitWeight(tail, e.props.bodyColumns - FOOTER_CHROME)}` : ''}
        </Text>
      )
    }

    const footer = (
      <Box key="footer" flexDirection="column" flexShrink={0}>
        <Text key="rule" color={RULE_COLOR} wrap="truncate-end">
          {'─'.repeat(Math.max(0, e.props.bodyColumns))}
        </Text>
        <Box key="lines" flexDirection="column" paddingX={1}>
          {agentLine('self', snap.self.name, snap.self.model, contextWeight(snap.self.tokens ?? undefined, snap.self.window ?? undefined), false)}
          {snap.agents.map(a => {
            const load = agentLoads[a.id]
            const model = load?.model ?? a.model
            const weight = subagentWeight(load, mainId !== '' ? mainId : snap.self.model, snap.self.window)
            return agentLine(`agent-${a.id}`, a.name, model, weight, a.status !== 'running')
          })}
        </Box>
      </Box>
    )

    return (
      <Box backgroundColor={PANE_BG} flexDirection="column" height={rows}>
        {header}
        <Box key="body" flexDirection="column" flexGrow={1} flexShrink={1} overflow="hidden" gap={1} paddingTop={1}>
          {body}
        </Box>
        {footer}
      </Box>
    )
  })
}
