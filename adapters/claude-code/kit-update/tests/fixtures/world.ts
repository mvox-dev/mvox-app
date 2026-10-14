import type { HttpResponse, On, SessionStartInput } from 'claude-code'

export const CWD = '/home/u/kit'
export const SESSION: SessionStartInput = { surface: 'terminal', isInteractive: true, cwd: CWD }

/** The world beneath the plugin, in memory: the home's files, upstream, the store, the session. */
export type World = {
  files: Map<string, string>
  /** Upstream tag names, newest first, as the tags API lists them. */
  tags: string[]
  /** UPGRADE.md per release tag (`v0.1.0-alpha.N`); a tag not listed answers 404. */
  upgrade: Record<string, string>
  /** While set, every request is refused (offline); 'hang' never answers. */
  offline: boolean | 'hang'
  /** Every URL fetched, in order. */
  requests: string[]
  /** Every prompt the plugin submitted that entered. */
  submitted: string[]
  /** Every submit tried. */
  attempts: string[]
  /** While set, a submit is refused ({ drop }). */
  refuse: string | undefined
  notified: string[]
  logs: string[]
  commands: string[]
  /** The plugin's $.store, as the engine keeps it: one JSON value per key, shared by every session. */
  store: Map<string, unknown>
}

const abs = (path: string) => (path.startsWith('/') ? path : `${CWD}/${path}`)
const json = (data: unknown): HttpResponse => ({ status: 200, ok: true, headers: {}, text: JSON.stringify(data) })

export function worldOf(on: On, files: Readonly<Record<string, string>>, store: Readonly<Record<string, unknown>> = {}): World {
  const world: World = {
    files: new Map(Object.entries(files).map(([p, t]) => [abs(p), t])),
    tags: [],
    upgrade: {},
    offline: false,
    requests: [],
    submitted: [],
    attempts: [],
    refuse: undefined,
    notified: [],
    logs: [],
    commands: [],
    store: new Map(Object.entries(store)),
  }
  // The store in memory, readable and writable by the test (another session's writes).
  const copy = (v: unknown) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)))
  on('store.get', ($, e) => ({ value: copy(world.store.get(e.key)) }))
  on('store.set', ($, e) => {
    world.store.set(e.key, copy(e.value))
    return { value: undefined }
  })
  on('store.delete', ($, e) => {
    world.store.delete(e.key)
    return { value: undefined }
  })
  on('store.keys', () => ({ value: [...world.store.keys()] }))

  on('fs.exists', ($, e) => ({ value: world.files.has(abs(e.path)) }))
  on('fs.read', ($, e) => {
    const text = world.files.get(abs(e.path))
    return text === undefined ? { deny: `ENOENT: ${e.path}` } : { value: text }
  })
  on('session.cwd', () => ({ value: CWD }))
  // Codeberg: the tags API, 50 to a page; raw files at a ref.
  on('http.fetch', ($, e) => {
    world.requests.push(e.url)
    if (world.offline === 'hang') return new Promise<never>(() => {})
    if (world.offline) return { deny: 'offline' }
    const url = new URL(e.url)
    if (url.pathname.endsWith('/tags')) {
      const page = Number(url.searchParams.get('page') ?? '1')
      const limit = Number(url.searchParams.get('limit') ?? '50')
      return { value: json(world.tags.slice((page - 1) * limit, page * limit).map(name => ({ name, id: 'x' }))) }
    }
    if (url.pathname.endsWith('/raw/UPGRADE.md')) {
      const text = world.upgrade[url.searchParams.get('ref') ?? '']
      return { value: text === undefined ? { status: 404, ok: false, headers: {}, text: 'not found' } : { status: 200, ok: true, headers: {}, text } }
    }
    return { value: { status: 404, ok: false, headers: {}, text: '' } }
  })
  on('prompt.submit', ($, e) => {
    if (e.origin.kind !== 'plugin') return { text: e.text, origin: e.origin }
    world.attempts.push(e.text)
    if (world.refuse !== undefined) return { drop: world.refuse }
    world.submitted.push(e.text)
    return { text: e.text, origin: e.origin }
  })
  on('ui.notify', ($, e) => {
    world.notified.push(e.text)
    return { value: { isSent: true, channel: 'ghostty' } } as never
  })
  on('ui.log', ($, e) => {
    world.logs.push(`${e.to}: ${e.text}`)
    return { value: undefined }
  })
  on('command.register', ($, e) => {
    world.commands.push(e.name)
    return { value: { command: e.name } }
  })
  on('session.start', ($, e) => ({ cwd: e.cwd }))

  return world
}
