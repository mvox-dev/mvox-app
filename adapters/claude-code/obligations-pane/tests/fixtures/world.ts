import type { HttpResponse, On, RenderInput, SessionStartInput } from 'claude-code'

export const CWD = '/home/kit'
export const PLUGIN = 'obligations-pane'

export const SESSION: SessionStartInput = { surface: 'terminal', isInteractive: true, cwd: CWD }

export const PANE: RenderInput<'Pane'> = {
  component: 'Pane',
  surface: 'terminal',
  requestId: 'obligations',
  viewport: { columns: 180, rows: 48, isFullscreen: true },
  props: {
    title: 'Obligations',
    isFocused: false,
    bodyColumns: 56,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
}

export type Agent = { id: string; name?: string; description: string; type: string; status: string }

/** The world beneath the plugin, in memory: files, the session's figures, the agents. */
export type World = {
  files: Map<string, string>
  /** What $.session.cwd() answers now: a shell cd mid-session moves it. */
  cwd: string
  /** What $.session.root() answers: the folder the session started in; a shell cd does not move it (kit #45). */
  root: string
  model: string
  tokens: number | undefined
  window: number
  agents: Agent[]
  opened: string[]
  commands: string[]
  zone: string
  reads: number
  /** Every path $.fs.read was asked for, in order (kit #43: the secrets tab never reads a secret). */
  readPaths: string[]
  /** Every URL the plugin fetched, in order. Tests never reach the network. */
  requests: string[]
  /** What $.http.fetch answers; undefined refuses (as offline), 'hang' never settles. */
  answer: ((url: string) => HttpResponse) | 'hang' | undefined
  /** Lines the plugin logged, as `<to>: <text>`. */
  logs: string[]
  /** What $.store holds, shared as the store is across sessions: a test reads what the plugin wrote. */
  store: Record<string, unknown>
  /**
   * Symbolic links, by path, and what each leads to (kit #53): a listing shows a link as `other`,
   * as a real one does, and $.fs.stat follows it. A link to a file reads as that file's text.
   */
  links: Map<string, 'file' | 'dir' | 'other'>
}

/** A tags API answer listing these names, newest first as Forgejo lists them. */
export const tagsAnswer = (...names: string[]): HttpResponse => ({
  status: 200,
  ok: true,
  headers: { 'content-type': 'application/json' },
  text: JSON.stringify(names.map(name => ({ name, id: 'x', commit: { sha: 'x' } }))),
})

/** POSIX, drive-letter (C:\ or C:/) and UNC paths are absolute; the rest are under the cwd. */
const abs = (path: string) => (/^(\/|[A-Za-z]:[\\/]|\\\\)/.test(path) ? path : `${CWD}/${path}`)

export function worldOf(on: On, files: Readonly<Record<string, string>>, store: Readonly<Record<string, unknown>> = {}): World {
  const world: World = {
    files: new Map(Object.entries(files).map(([p, t]) => [abs(p), t])),
    cwd: CWD,
    root: CWD,
    model: 'claude-opus-5-5',
    tokens: 127_400,
    window: 1_000_000,
    agents: [],
    opened: [],
    commands: [],
    zone: '+0300',
    reads: 0,
    readPaths: [],
    requests: [],
    answer: undefined,
    logs: [],
    store: { ...store },
    links: new Map(),
  }
  on('store.get', ($, e) => ({ value: world.store[e.key] }))
  on('store.set', ($, e) => {
    world.store[e.key] = e.value
    return { value: undefined }
  })
  const isDir = (path: string) => [...world.files.keys()].some(f => f.startsWith(`${path}/`))

  on('fs.exists', ($, e) => ({ value: world.files.has(abs(e.path)) || isDir(abs(e.path)) }))
  on('fs.read', ($, e) => {
    world.reads += 1
    world.readPaths.push(abs(e.path))
    const text = world.files.get(abs(e.path))
    return text === undefined ? { deny: `ENOENT: ${e.path}` } : { value: text }
  })
  // A listing as a real folder gives it: each entry once, a folder for anything deeper, a link as
  // `other`; files dated 2026-09-13 10:00 UTC.
  on('fs.list', ($, e) => {
    const dir = abs(e.path ?? world.cwd)
    if (!isDir(dir)) return { deny: `ENOENT: ${dir}` }
    const names = new Map<string, 'file' | 'dir' | 'other'>()
    for (const f of world.files.keys()) {
      if (!f.startsWith(`${dir}/`)) continue
      const [name, ...rest] = f.slice(dir.length + 1).split('/')
      if (name !== undefined) names.set(name, rest.length > 0 ? 'dir' : 'file')
    }
    for (const link of world.links.keys()) {
      const name = link.slice(dir.length + 1)
      if (link.startsWith(`${dir}/`) && !name.includes('/')) names.set(name, 'other')
    }
    const mtimeMs = Date.parse('2026-09-13T10:00:00Z')
    return { value: [...names].map(([name, kind]) => ({ name, kind, size: 0, mtimeMs, isLink: false })) as never }
  })
  on('fs.stat', ($, e) => {
    const path = abs(e.path)
    const kind = world.links.get(path) ?? (world.files.has(path) ? 'file' : isDir(path) ? 'dir' : undefined)
    if (kind === undefined) return { deny: `ENOENT: ${e.path}` }
    return { value: { kind, size: 0, mtimeMs: Date.parse('2026-09-13T10:00:00Z'), isLink: world.links.has(path) } }
  })
  on('session.cwd', () => ({ value: world.cwd }))
  on('session.root', () => ({ value: world.root }))
  on('session.model', () => ({ value: world.model }))
  on('session.usage', () => ({
    value: {
      startedAt: 0,
      context: { window: world.window, ...(world.tokens !== undefined && { tokens: world.tokens }) },
    } as never,
  }))
  on('agent.list', () => ({ value: world.agents as never }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: `${world.zone}\n`, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('command.register', ($, e) => {
    // As the harness does: a built-in's name is refused.
    if (['memory', 'help', 'clear'].includes(e.name)) return { deny: `"/${e.name}" refused: it is the built-in /${e.name}` }
    world.commands.push(e.name)
    return { value: { command: e.name } }
  })
  on('ui.open', ($, e) => {
    world.opened.push(e.id)
    return { value: { isPlaced: true } } as never
  })
  on('ui.log', ($, e) => {
    world.logs.push(`${e.to}: ${e.text}`)
    return { value: undefined }
  })
  on('http.fetch', ($, e) => {
    world.requests.push(e.url)
    if (world.answer === 'hang') return new Promise<never>(() => {})
    return world.answer === undefined ? { deny: 'offline' } : { value: world.answer(e.url) }
  })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('turn.complete', ($, e) => ({ text: (e as { answer?: string }).answer ?? '' }) as never)

  return world
}
