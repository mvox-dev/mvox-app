import type { On, RenderInput, SessionStartInput } from 'claude-code'

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
  model: string
  tokens: number | undefined
  window: number
  agents: Agent[]
  opened: string[]
  commands: string[]
  zone: string
  reads: number
}

const abs = (path: string) => (path.startsWith('/') ? path : `${CWD}/${path}`)

export function worldOf(on: On, files: Readonly<Record<string, string>>): World {
  const world: World = {
    files: new Map(Object.entries(files).map(([p, t]) => [abs(p), t])),
    model: 'claude-opus-5-5',
    tokens: 127_400,
    window: 1_000_000,
    agents: [],
    opened: [],
    commands: [],
    zone: '+0300',
    reads: 0,
  }
  const isDir = (path: string) => [...world.files.keys()].some(f => f.startsWith(`${path}/`))

  on('fs.exists', ($, e) => ({ value: world.files.has(abs(e.path)) || isDir(abs(e.path)) }))
  on('fs.read', ($, e) => {
    world.reads += 1
    const text = world.files.get(abs(e.path))
    return text === undefined ? { deny: `ENOENT: ${e.path}` } : { value: text }
  })
  on('session.cwd', () => ({ value: CWD }))
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
    world.commands.push(e.name)
    return { value: { command: e.name } }
  })
  on('ui.open', ($, e) => {
    world.opened.push(e.id)
    return { value: { isPlaced: true } } as never
  })
  on('ui.log', () => ({ value: undefined }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('turn.complete', ($, e) => ({ text: (e as { answer?: string }).answer ?? '' }) as never)

  return world
}
