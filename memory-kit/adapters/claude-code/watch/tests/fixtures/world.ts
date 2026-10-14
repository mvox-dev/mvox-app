import type { On, PromptSubmitInput, SessionStartInput } from 'claude-code'
import { mock } from 'claude-code/testing'

export const HOME = '/home/u'
export const CWD = '/home/u/kit'
export const SESSION: SessionStartInput = { surface: 'terminal', isInteractive: true, cwd: CWD }

/** A typed prompt, as the engine raises it from the composer. */
export const typed = (text: string): PromptSubmitInput => ({ text, wait: false, origin: { kind: 'composer' } })

/** The world beneath the plugin, in memory: files, the host's mv and rm, the session's figures. */
export type World = {
  files: Map<string, string>
  /** What $.session.usage() reports: tokens undefined before a first answer. */
  tokens: number | undefined
  window: number
  /** Every prompt the plugin submitted that entered, in order. */
  submitted: string[]
  /** Every submit the plugin tried, entered or not. */
  attempts: string[]
  /** While set, a submit is refused as another plugin's guard would ({ drop }). */
  refuse: string | undefined
  /** While set, a submit is held until the test calls `release()`: a busy session's turn starts late. */
  hold: boolean
  /** Lets every held submit enter, in order. */
  release: () => void
  /** Every notification the plugin raised. */
  notified: string[]
  /** What $.ui.notify answers: a channel that shows the text, or none (as in tmux). */
  notifyResult: { isSent: true; channel: 'ghostty' | 'terminal_bell' } | { isSent: false; reason: 'no-channel' }
  /** Lines the plugin logged, as `<to>: <text>`. */
  logs: string[]
  /** Every command the plugin ran. */
  commands: string[][]
}

const abs = (path: string) => (path.startsWith('/') ? path : `${CWD}/${path}`)

export function worldOf(on: On, files: Readonly<Record<string, string>>, store: Readonly<Record<string, unknown>> = {}): World {
  const held: (() => void)[] = []
  const world: World = {
    files: new Map(Object.entries(files).map(([p, t]) => [abs(p), t])),
    tokens: undefined,
    window: 1_000_000,
    submitted: [],
    attempts: [],
    refuse: undefined,
    hold: false,
    release: () => {
      for (const enter of held.splice(0)) enter()
    },
    notified: [],
    notifyResult: { isSent: true, channel: 'ghostty' },
    logs: [],
    commands: [],
  }
  mock.store(on, store)
  mock.env(on, { HOME })
  const isDir = (path: string) => [...world.files.keys()].some(f => f.startsWith(`${path}/`))

  on('fs.exists', ($, e) => ({ value: world.files.has(abs(e.path)) || isDir(abs(e.path)) }))
  on('fs.read', ($, e) => {
    const text = world.files.get(abs(e.path))
    return text === undefined ? { deny: `ENOENT: ${e.path}` } : { value: text }
  })
  on('fs.write', ($, e) => {
    world.files.set(abs(e.path), e.text)
    return { value: undefined }
  })
  on('fs.list', ($, e) => {
    const dir = abs(e.path ?? CWD)
    if (!isDir(dir)) return { deny: `ENOENT: ${dir}` }
    const names = new Map<string, 'file' | 'dir'>()
    for (const f of world.files.keys()) {
      if (!f.startsWith(`${dir}/`)) continue
      const [name, ...rest] = f.slice(dir.length + 1).split('/')
      if (name !== undefined) names.set(name, rest.length > 0 ? 'dir' : 'file')
    }
    return { value: [...names].map(([name, kind]) => ({ name, kind, size: 0, mtimeMs: 0, isLink: false })) as never }
  })
  // The host's mv (rename; -n keeps an existing target) and rm -f, over the in-memory files.
  on('process.run', ($, e) => {
    const argv = [...e.argv]
    world.commands.push(argv)
    const ok = { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false }
    const fail = (stderr: string) => ({ value: { ...ok, exitCode: 1, stderr } })
    const paths = argv.filter(a => !a.startsWith('-'))
    if (argv[0] === 'mv') {
      const [, from, to] = paths
      if (from === undefined || to === undefined) return fail('usage')
      const text = world.files.get(abs(from))
      if (text === undefined) return fail(`mv: cannot stat '${from}'`)
      if (argv.includes('-n') && world.files.has(abs(to))) return { value: ok }
      world.files.delete(abs(from))
      world.files.set(abs(to), text)
      return { value: ok }
    }
    if (argv[0] === 'rm') {
      for (const p of paths.slice(1)) world.files.delete(abs(p))
      return { value: ok }
    }
    return fail(`not mocked: ${argv.join(' ')}`)
  })
  on('session.cwd', () => ({ value: CWD }))
  on('session.usage', () => ({
    value: {
      startedAt: 0,
      rateLimits: [],
      context: { window: world.window, ...(world.tokens !== undefined && { tokens: world.tokens }) },
    } as never,
  }))
  on('prompt.submit', async ($, e) => {
    if (e.origin.kind !== 'plugin') return { text: e.text, origin: e.origin }
    world.attempts.push(e.text)
    if (world.refuse !== undefined) return { drop: world.refuse }
    const enter = () => {
      world.submitted.push(e.text)
      return { text: e.text, origin: e.origin }
    }
    if (!world.hold) return enter()
    return new Promise(resolve => held.push(() => resolve(enter())))
  })
  on('ui.notify', ($, e) => {
    world.notified.push(e.text)
    return { value: world.notifyResult } as never
  })
  on('ui.log', ($, e) => {
    world.logs.push(`${e.to}: ${e.text}`)
    return { value: undefined }
  })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('turn.complete', ($, e) => ({ text: (e as { answer?: string }).answer ?? '' }) as never)

  return world
}
