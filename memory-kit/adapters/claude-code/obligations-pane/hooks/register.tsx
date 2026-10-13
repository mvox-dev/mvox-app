// Obligations pane: shows memory/obligations.yaml of the session's working directory in a side
// pane, soonest expiry first. Read-only for good (Mihkel, 2026-10-14): it never writes.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { ObligationRow, PaneAgent, PaneSnapshot } from '../types'
import {
  actorColor,
  basename,
  clampIndex,
  contextWeight,
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
  isoDate,
  isoMinute,
  LINK_FG,
  liveAgents,
  MODEL_COLORS,
  memoryDirOf,
  modelLetter,
  offsetFromZ,
  PANE_BG,
  parseObligations,
  recordStep,
  segmentsOf,
  sortByExpires,
  statusOf,
  step,
  subagentWeight,
  trailingLinksOf,
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

/** Where the obligations live for a working directory: <cwd>/<memory_dir>/obligations.yaml. */
async function memoryRoot($: EngineInterface, cwd: string): Promise<string> {
  let dir = 'memory'
  try {
    const conf = `${cwd}/memory-kit.conf`
    if (await $.fs.exists(conf)) dir = memoryDirOf(await $.fs.read(conf)) ?? dir
  } catch {
    // An unreadable conf falls back to the kit default.
  }
  return dir.startsWith('/') ? dir : `${cwd}/${dir}`
}

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

/** Gathers everything the pane draws and writes it to state in one go. */
export async function refresh($: EngineInterface, agentName: string): Promise<void> {
  const now = await $.clock.now()
  const cwd = await $.session.cwd()
  const root = await memoryRoot($, cwd)
  const path = `${root}/obligations.yaml`
  const ledger = await readObligations($, path)
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

/** refresh, never throwing: a failure goes to the debug log and the last snapshot stays. */
async function safeRefresh($: EngineInterface, agentName: string): Promise<void> {
  try {
    await refresh($, agentName)
  } catch (err) {
    $.ui.log(`obligations-pane: refresh failed: ${String(err)}`, { to: 'debug' })
  }
}

export const register: Register = (on, options) => {
  const agentName = typeof options.agentName === 'string' ? options.agentName.trim() : ''
  const autoOpen = options.autoOpen !== false
  let timer: { cancel: () => void } | undefined

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.command.register({ name: 'obligations', description: 'Open the obligations pane (memory/obligations.yaml)' })
    await safeRefresh($, agentName)
    timer?.cancel()
    timer = $.clock.every(REFRESH_MS, () => void safeRefresh($, agentName))
    const snap = await read($, snapshot)
    if (autoOpen && snap?.source !== 'missing') void $.ui.open({ id: PANE, title: TITLE })
    return started
  })

  on('command.run', { command: 'obligations' }, async $ => {
    await safeRefresh($, agentName)
    const opened = await $.ui.open({ id: PANE, title: TITLE })
    return { text: opened.isPlaced ? 'Obligations pane opened.' : 'Obligations pane waits for a wider terminal.' }
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    await safeRefresh($, agentName)
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
      await safeRefresh($, agentName)
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
          {isoMinute(snap.now, snap.offsetMinutes)}
          {snap.source === 'ok' ? `  ${countsLabel(countsOf(items, today))}` : ''}
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
