// Memory pane (the obligations pane until kit #43): a side pane over the home's memory, one tab
// per tier. The Obligations tab shows memory/obligations.yaml, soonest expiry first, as 0.6.0 did;
// the other tabs are tiers.ts's views. Read-only for good (Mihkel, 2026-10-14): it never writes
// into the home; the open tab is remembered in the plugin's own $.store.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { ObligationRow, PaneAgent, PaneSnapshot, TierView, ViewChoice, ViewLine } from '../types'
import { foundAboveNote, resolveKitHome } from './kit-home'
import {
  actorColor,
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
  journalPhase,
  labelPhase,
  liveWorkflows,
  projectSlug,
  recordWorkflowDone,
  recordWorkflowSpawn,
  workflowNameOf,
  workflowTail,
  isFresh,
  isoDate,
  kitLabel,
  kitVersionOf,
  LINK_FG,
  liveAgents,
  MODEL_COLORS,
  memoryDirOf,
  selfName,
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
  urlNamesIn,
  urlNamesOf,
  urlOfFile,
  wheelStep,
  WORKFLOW_FG,
} from './obligations'
import type { Segment } from './obligations'
import {
  choiceKey,
  choiceOf,
  commitmentsView,
  DEFAULT_CHOICE,
  factsView,
  keysView,
  LESSON_FILTERS,
  lessonsView,
  nextView,
  NO_SCRATCHPAD,
  rulesView,
  scratchpadCandidates,
  scratchpadShaped,
  secretFiles,
  secretsView,
  TABS,
} from './tiers'

export const PANE = 'obligations'
export const TITLE = 'Memory'
export const REFRESH_MS = 20_000

const snapshot = atom({ plugin: 'obligations-pane', key: 'snapshot' } as const, null)
const index = atom({ plugin: 'obligations-pane', key: 'index' } as const, 0)
const models = atom({ plugin: 'obligations-pane', key: 'models' } as const, {})
const loads = atom({ plugin: 'obligations-pane', key: 'loads' } as const, {})
const mainModel = atom({ plugin: 'obligations-pane', key: 'mainModel' } as const, '')
const startCwd = atom({ plugin: 'obligations-pane', key: 'startCwd' } as const, '')
const workflows = atom({ plugin: 'obligations-pane', key: 'workflows' } as const, {})
const choice = atom({ plugin: 'obligations-pane', key: 'choice' } as const, DEFAULT_CHOICE)
const choiceHome = atom({ plugin: 'obligations-pane', key: 'choiceHome' } as const, '')

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

async function resolveUrls($: EngineInterface, root: string, items: readonly ObligationRow[], tier: TierView | null) {
  const urls: Record<string, string> = {}
  const cited = tier?.kind === 'ok' ? urlNamesIn(tier.lines.flatMap(l => [l.text, l.note])) : []
  const names = [...new Set([...items.flatMap(urlNamesOf), ...cited])].slice(0, 100)
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

/** A file's text, undefined when it is not there; a read that fails throws. */
async function readIfThere($: EngineInterface, path: string): Promise<string | undefined> {
  return (await $.fs.exists(path)) ? $.fs.read(path) : undefined
}

/** The most facts files one refresh reads: a home with more shows these, and says so in the count. */
const MAX_FACT_FILES = 200

/**
 * The open tab's view (kit #43), read from the memory directory `root`. Only the open tab is read:
 * a refresh reads one tier besides obligations, however many tabs there are. A tier that cannot be
 * read is its own tab's message, never the other tabs' business.
 */
async function readTier($: EngineInterface, view: ViewChoice, root: string, today: string, offset: number): Promise<TierView | null> {
  const missing = (file: string): TierView => ({ kind: 'missing', message: `no ${file} here (${root}/${file})` })
  try {
    switch (view.tab) {
      case 'O':
        return null
      case 'N': {
        // kit #53: the scratchpad tier is found as the lint finds it, not by a fixed name.
        const noTier: TierView = { kind: 'missing', message: `${NO_SCRATCHPAD} (${root})` }
        if (!(await $.fs.exists(root))) return noTier
        const files: { name: string; text: string }[] = []
        for (const e of await $.fs.list(root)) {
          if (scratchpadCandidates([e.name]).length === 0) continue
          // The lint follows a link to a file; a link is `other` in a listing, so ask where it leads.
          const kind = e.kind === 'other' ? (await $.fs.stat(`${root}/${e.name}`)).kind : e.kind
          if (kind !== 'file') continue
          const text = await $.fs.read(`${root}/${e.name}`)
          if (e.name !== 'commitments.yaml' || scratchpadShaped(text)) files.push({ name: e.name, text })
        }
        return files.length === 0 ? noTier : nextView(files)
      }
      case 'C':
        return commitmentsView(await readIfThere($, `${root}/commitments.yaml`))
      case 'R': {
        const text = await readIfThere($, `${root}/rules.yaml`)
        return text === undefined ? missing('rules.yaml') : rulesView(text)
      }
      case 'L': {
        const text = await readIfThere($, `${root}/lessons/index.yaml`)
        return text === undefined ? missing('lessons/index.yaml') : lessonsView(text, view.lessons, `${root}/lessons`)
      }
      case 'F': {
        if (!(await $.fs.exists(`${root}/facts`))) return missing('facts/')
        const names = (await $.fs.list(`${root}/facts`))
          .filter(e => e.kind === 'file' && /\.ya?ml$/.test(e.name))
          .map(e => e.name)
          .sort()
        const files: { name: string; text: string }[] = []
        for (const name of names.slice(0, MAX_FACT_FILES)) files.push({ name, text: await $.fs.read(`${root}/facts/${name}`) })
        const v = factsView(files, today)
        return v.kind === 'ok' && names.length > MAX_FACT_FILES ? { ...v, count: `${v.count} · first ${MAX_FACT_FILES} of ${names.length} files` } : v
      }
      case 'K': {
        const text = await readIfThere($, `${root}/keys.yaml`)
        return text === undefined ? missing('keys.yaml') : keysView(text)
      }
      case 'S': {
        // Names and dates only: the README and a listing, never an encrypted file's bytes.
        const dir = `${root}/secrets`
        const readme = await readIfThere($, `${dir}/README.md`)
        const entries = (await $.fs.exists(dir)) ? await $.fs.list(dir) : []
        return secretsView(readme, secretFiles(entries, ms => isoDate(ms, offset)))
      }
    }
  } catch (err) {
    return { kind: 'error', message: `cannot read: ${String(err)}` }
  }
}

/**
 * The open tab and lessons filter for `home`: what $.state holds when it is this home's, else
 * what $.store remembers for the home (kit #43: it outlives a restart), else Obligations.
 */
async function choiceFor($: EngineInterface, home: string): Promise<ViewChoice> {
  if ((await read($, choiceHome)) === home) return choiceOf(await read($, choice))
  let stored: unknown
  try {
    stored = await $.store.get(choiceKey(home))
  } catch {
    // No store: the default tab.
  }
  const loaded = choiceOf(stored)
  await $.state.set({ plugin: 'obligations-pane', key: 'choice' }, loaded)
  await $.state.set({ plugin: 'obligations-pane', key: 'choiceHome' }, home)
  return loaded
}

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

/** The folder the session started in: its root, which a shell cd does not move (kit #45); `cwd` if the engine gives none. */
async function startFolder($: EngineInterface, cwd: string): Promise<string> {
  try {
    return (await $.session.root()) || cwd
  } catch {
    return cwd
  }
}

/** Gathers everything the pane draws and writes it to state in one go. No network. */
export async function refresh($: EngineInterface, settings: Settings): Promise<void> {
  const { agentName, memoryDir, checkUpdates } = settings
  const now = await $.clock.now()
  // The home is where the session started (kit issue #3): a shell cd into another repo
  // mid-session must not switch the ledger. Without a start seen (a plugin installed mid-session,
  // kit #45), the session's root: a shell cd does not move it, as it moves $.session.cwd().
  const cwd = (await read($, startCwd)) || (await $.session.root())
  // kit #18: the start folder's memory-kit.conf may point at the home (kit_home:, one hop); kit
  // #42: a start folder without one takes the nearest above it. A home so found wins over the
  // user-scope memoryDir option, which applies to every session.
  const found = await resolveKitHome(cwd, async p => ((await $.fs.exists(p)) ? $.fs.read(p) : undefined))
  const pointed = !('problem' in found) && (found.pointer !== undefined || found.foundIn !== undefined) ? found.home : undefined
  const home = pointed ?? cwd
  const conf = await readOrEmpty($, `${home}/memory-kit.conf`)
  const root = memoryRoot(home, conf, pointed !== undefined ? '' : memoryDir)
  const path = 'problem' in found ? found.pointer : `${root}/obligations.yaml`
  const ledger: Pick<PaneSnapshot, 'source' | 'error' | 'items'> =
    'problem' in found ? { source: 'pointer', error: found.problem, items: [] } : await readObligations($, path)
  const offsetMinutes = await offsetOf($, now)
  // kit #43: the open tab, remembered per home; a conf problem (a broken pointer, kit #18, or a
  // key given twice, kit #55) shows on every tab as it is.
  const view = await choiceFor($, home)
  const tier = 'problem' in found ? null : await readTier($, view, root, isoDate(now, offsetMinutes), offsetMinutes)
  const urls = await resolveUrls($, root, ledger.items, tier)

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
    foundAbove: !('problem' in found) && found.foundIn !== undefined ? foundAboveNote(cwd, found.foundIn) : '',
    home,
    tab: view.tab,
    tier,
    ...('problem' in found ? { kitVersion: '', upstreamUrl: '', latest: '' } : await kitOf($, cwd, root, checkUpdates, pointed)),
    now,
    offsetMinutes,
    self: { name: selfName(conf, agentName, cwd), model, tokens, window },
    agents: liveAgents(agents),
  }
  await $.state.set({ plugin: 'obligations-pane', key: 'snapshot' }, value)
}

let lastWheelStep: number | undefined

/** How many rows the open tab scrolls through: obligations, or the tab's lines. */
function rowCount(snap: PaneSnapshot | null): number {
  if (snap === null) return 0
  const tier = snap.tier ?? null
  return tier === null ? snap.items.length : tier.kind === 'ok' ? tier.lines.length : 0
}

/** One wheel event: at most one item, and nothing within the throttle of the last step. */
async function wheel($: EngineInterface, by: number): Promise<void> {
  const { delta, lastStep } = wheelStep(by, await $.clock.now(), lastWheelStep)
  lastWheelStep = lastStep
  if (delta === 0) return
  const length = rowCount(await read($, snapshot))
  await update($, index, i => step(i, delta, length))
}

/**
 * A tab or filter chosen (kit #43): shown at once from the top, remembered for the home in
 * $.store (never in the home's memory), then the tab is read.
 */
async function choose($: EngineInterface, settings: Settings, change: Partial<ViewChoice>): Promise<void> {
  const before = choiceOf(await read($, choice))
  const next = { ...before, ...change }
  await $.state.set({ plugin: 'obligations-pane', key: 'choice' }, next)
  if (next.tab !== before.tab || next.lessons !== before.lessons) await $.state.set({ plugin: 'obligations-pane', key: 'index' }, 0)
  const home = (await read($, snapshot))?.home ?? ''
  if (home !== '') {
    await $.state.set({ plugin: 'obligations-pane', key: 'choiceHome' }, home)
    try {
      await $.store.set(choiceKey(home), next)
    } catch (err) {
      $.ui.log(`obligations-pane: the tab is not remembered: ${String(err)}`, { to: 'debug' })
    }
  }
  await safeRefresh($, settings)
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

/**
 * The session's folder under Claude Code's projects directory, where it keeps each workflow run's
 * journal and saved script (undocumented layout: any miss leaves the phase and name to fall back).
 */
async function sessionDir($: EngineInterface): Promise<string> {
  const config = (await $.env.get('CLAUDE_CONFIG_DIR')) ?? `${(await $.env.get('HOME')) ?? ''}/.claude`
  const cwd = (await read($, startCwd)) || (await $.session.root())
  return `${config}/projects/${projectSlug(cwd)}/${await $.session.id()}`
}

/** Reads each live run's phase (journal) and, until found, its name (saved script). Never throws. */
async function refreshWorkflows($: EngineInterface): Promise<void> {
  try {
    const live = liveWorkflows(await read($, workflows))
    if (live.length === 0) return
    const dir = await sessionDir($)
    let scripts: string[] | undefined
    for (const [runId, run] of live) {
      let phase = run.phase
      try {
        phase = journalPhase(await $.fs.read(`${dir}/subagents/workflows/${runId}/journal.jsonl`))
      } catch {
        // No journal (yet): the label fallback stands.
      }
      let name = run.name
      if (name === '') {
        try {
          scripts ??= (await $.fs.list(`${dir}/workflows/scripts`)).map(entry => entry.name)
          name = workflowNameOf(scripts, runId)
        } catch {
          scripts = []
        }
      }
      if (phase !== run.phase || name !== run.name) {
        await update($, workflows, w => (w[runId] === undefined ? w : { ...w, [runId]: { ...w[runId], phase, name } }))
      }
    }
  } catch (err) {
    $.ui.log(`obligations-pane: workflow refresh failed: ${String(err)}`, { to: 'debug' })
  }
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
    // directory the session is in by then, so only the first start sets it. That first start may
    // be an install or enable mid-session, whose e.cwd is the shell's folder after any cd: the
    // session's root is not moved by a cd (kit #45).
    if ((await read($, startCwd)) === '') await $.state.set({ plugin: 'obligations-pane', key: 'startCwd' }, await startFolder($, e.cwd))
    // A refused command is a debug line, never a skipped start: a refusal used to throw out of
    // this hook, and the pane never opened (/memory, Claude Code's built-in, live on 2.1.303).
    for (const command of [
      { name: 'obligations', description: 'Open the memory pane on its Obligations tab (memory/obligations.yaml)' },
      { name: 'memory-pane', description: 'Open the memory pane: one tab per memory tier' },
    ]) {
      try {
        await $.command.register(command)
      } catch (err) {
        $.ui.log(`obligations-pane: /${command.name} not registered: ${String(err)}`, { to: 'debug' })
      }
    }
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
    await choose($, settings, { tab: 'O' })
    const opened = await $.ui.open({ id: PANE, title: TITLE })
    return { text: opened.isPlaced ? 'Obligations pane opened.' : 'Obligations pane waits for a wider terminal.' }
  })

  on('command.run', { command: 'memory-pane' }, async $ => {
    await safeRefresh($, settings)
    const opened = await $.ui.open({ id: PANE, title: TITLE })
    return { text: opened.isPlaced ? 'Memory pane opened.' : 'Memory pane waits for a wider terminal.' }
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    const agentId = e.agentId
    if (agentId !== undefined) await update($, workflows, w => recordWorkflowDone(w, agentId))
    await refreshAll($, settings)
    await refreshWorkflows($)
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
      const runId = e.workflow?.runId
      if (runId !== undefined && runId !== '') {
        await update($, workflows, w => recordWorkflowSpawn(w, runId, id, e.description))
        await refreshWorkflows($)
      }
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
    const runs = liveWorkflows(await read($, workflows))
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
    // kit #43: the tab the person chose, at once; its view once a refresh has read it.
    const view = choiceOf(await read($, choice))
    const onO = view.tab === 'O'
    const tier = !onO && snap.tab === view.tab ? (snap.tier ?? null) : null
    const count = onO ? items.length : tier?.kind === 'ok' ? tier.lines.length : 0
    const first = clampIndex(at, count)
    const move = (delta: number) => () => update($, index, i => step(i, delta, count))
    const pick = (change: Partial<ViewChoice>) => () => choose($, settings, change)

    // The tab row (kit #43): the open tab by its full name, the others by one letter, so the row
    // fits a narrow pane; it wraps when even that does not fit. Digits 1-8 pick a tab too.
    const tabRow = (
      <Box key="tabs" flexDirection="row" flexWrap="wrap" flexShrink={0} paddingX={1}>
        {TABS.map(t =>
          t.id === view.tab ? (
            <Button key={`tab-${t.id}`} plain onPress={pick({ tab: t.id })}>
              <Text bold color={HEADER_FG} backgroundColor={HEADER_BG}>
                [{t.name}]
              </Text>
            </Button>
          ) : (
            <Button key={`tab-${t.id}`} plain onPress={pick({ tab: t.id })}>
              <Text color={DATE_FG}>[{t.id}]</Text>
            </Button>
          ),
        )}
        <Box display="none">
          {TABS.map((t, i) => (
            <Button key={`tab-key-${t.id}`} plain hotkey={String(i + 1)} onPress={pick({ tab: t.id })}>
              {t.id}
            </Button>
          ))}
        </Box>
      </Box>
    )

    // The lessons filter (kit #43): one chip per enforcement type, under the header.
    const chips = view.tab === 'L' && (
      <Box key="chips" flexDirection="row" flexWrap="wrap" flexShrink={0} paddingX={1}>
        {LESSON_FILTERS.map(f => (
          <Button key={`chip-${f}`} plain onPress={pick({ lessons: f })}>
            {f === view.lessons ? (
              <Text bold color={HEADER_FG} backgroundColor={HEADER_BG}>
                [{f}]
              </Text>
            ) : (
              <Text color={DATE_FG}>[{f}]</Text>
            )}
          </Button>
        ))}
      </Box>
    )

    // The header's middle: the obligations counts on O, the open tab's own count elsewhere.
    const headerCount = onO ? (snap.source === 'ok' ? countsLabel(countsOf(items, today)) : '') : tier?.kind === 'ok' ? tier.count : ''

    const header = (
      <Box key="header" backgroundColor={HEADER_BG} flexDirection="row" justifyContent="space-between" paddingX={1} flexShrink={0}>
        <Text color={HEADER_FG} bold wrap="truncate-end">
          {/* `?? ''`: a snapshot a 0.2.x module wrote before a hot reload has neither field. */}
          {[kitLabel(snap.kitVersion ?? '', updateNote(snap.kitVersion ?? '', snap.latest ?? '')), headerCount]
            .filter(part => part !== '')
            .join('  ')}
        </Text>
        {count > 1 && (
          <Box flexDirection="row" flexShrink={0}>
            <Text color={HEADER_FG}>
              {first + 1}/{count}
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
            </Text>
            {/* kit #29: 'actor -> owed_to:', as tools/obligations-due.py prints it. An array, not a
                fragment: the engine refused a fragment here (Box inside an inline element). */}
            {item.owed_to !== ''
              ? [
                  ' -> ',
                  <Text key="owed" bold color={actorColor(item.owed_to)}>
                    {fitActor(item.owed_to)}
                  </Text>,
                  ':',
                ]
              : null}{' '}
            {segmentsOf(item.obligation, snap.urls).map(segment)}
            {trailing.map((s, i) => [' ', segment(s, 100 + i)])}
          </Text>
        </Box>
      )
    }

    // kit #42: a home found above the start folder is said, so a surprising home is visible.
    // `?? ''`: a snapshot an older module wrote before a hot reload has no such field.
    const foundAbove = (snap.foundAbove ?? '') !== '' && (
      <Text key="found-above" color={DATE_FG} dimColor wrap="wrap">
        {snap.foundAbove}
      </Text>
    )

    // One line of a tier tab (kit #43): a heading, or tag, text with its links, note and flag.
    const tierLine = (l: ViewLine) => {
      if (l.heading)
        return (
          <Box key={l.key} flexDirection="column" flexShrink={0} paddingX={1}>
            <Text bold underline color={DATE_FG}>
              {l.text}
              {l.flag !== '' ? <Text color="#9e0000"> {l.flag}</Text> : null}
            </Text>
          </Box>
        )
      const text = segmentsOf(l.text, snap.urls).map(segment)
      return (
        <Box key={l.key} flexDirection="column" flexShrink={0} paddingX={1}>
          <Text color={DATE_FG} dimColor={l.dim}>
            {l.tag !== '' ? [<Text key="tag" bold color={view.tab === 'K' ? actorColor(l.tag) : DATE_FG}>{l.tag}</Text>, ' '] : null}
            {l.href !== '' ? (
              <Link key="file" href={l.href}>
                <Text color={LINK_FG}>{l.text}</Text>
              </Link>
            ) : (
              text
            )}
            {l.note !== '' ? <Text dimColor> {l.note}</Text> : null}
            {l.flag !== '' ? <Text color="#9e0000"> {l.flag}</Text> : null}
          </Text>
        </Box>
      )
    }

    const tierBody =
      tier === null ? (
        <Text color={DATE_FG}>reading…</Text>
      ) : tier.kind === 'missing' ? (
        <Text color={DATE_FG}>{tier.message}</Text>
      ) : tier.kind === 'error' ? (
        <Text color="#9e0000">{tier.message}</Text>
      ) : (
        [
          tier.banner !== '' ? (
            <Text key="banner" color="#9e0000" bold wrap="wrap">
              {tier.banner}
            </Text>
          ) : null,
          ...(tier.lines.length === 0 ? [<Text key="empty" color={DATE_FG}>nothing here yet</Text>] : tier.lines.slice(first).map(tierLine)),
        ]
      )

    const body = !onO && snap.source !== 'pointer' ? (
      tierBody
    ) :
      snap.source === 'missing' ? (
        <Text color={DATE_FG}>no obligations file here ({snap.path})</Text>
      ) : snap.source === 'pointer' ? (
        <Text color="#9e0000">memory-kit.conf problem: {snap.error}</Text>
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
          {runs.map(([runId, run]) => (
            <Text key={`wf-${runId}`} color={DATE_FG} wrap="wrap">
              {fitName(run.name !== '' ? run.name : runId)}{' '}
              <Text bold color={WORKFLOW_FG}>
                ≡
              </Text>{' '}
              {workflowTail(run.phase !== '' ? run.phase : labelPhase(run.label), run.done.length, run.started.length)}
            </Text>
          ))}
        </Box>
      </Box>
    )

    return (
      <Box backgroundColor={PANE_BG} flexDirection="column" height={rows}>
        {tabRow}
        {header}
        {chips}
        <Box key="body" flexDirection="column" flexGrow={1} flexShrink={1} overflow="hidden" gap={1} paddingTop={1}>
          {foundAbove}
          {body}
        </Box>
        {footer}
      </Box>
    )
  })
}
