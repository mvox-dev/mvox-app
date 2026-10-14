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
  /** The host: POSIX answers uname and runs mv/rm; Windows has only powershell.exe. */
  platform: 'posix' | 'windows'
  /** Lock directories (`<inbox>.lock`, the harness's), with their mtime. */
  locks: Map<string, number>
  /** Windows: every powershell.exe call also writes CLIXML progress records to stderr. */
  clixml: boolean
  /** A lock the plugin takes is gone again at once: the harness broke it as stale. */
  lockVanishes: boolean
}

const abs = (path: string) => (path.startsWith('/') ? path : `${CWD}/${path}`)

/** What Windows PowerShell writes to stderr on a call that succeeded (kit #11, Pepys's desk). */
export const CLIXML = '#< CLIXML\r\n<Objs Version="1.1.0.1" xmlns="http://schemas.microsoft.com/powershell/2004/04"><Obj S="progress" RefId="0"><TN RefId="0"><T>System.Management.Automation.PSCustomObject</T></TN><MS><I64 N="SourceId">1</I64><PR N="Record"><AV>Preparing modules for first use.</AV></PR></MS></Obj></Objs>\r\n'

/** Text of a powershell.exe -EncodedCommand argument (base64 of UTF-16LE). */
export function decodeUtf16le(b64: string): string {
  const bin = atob(b64)
  let out = ''
  for (let i = 0; i + 1 < bin.length; i += 2) out += String.fromCharCode(bin.charCodeAt(i) | (bin.charCodeAt(i + 1) << 8))
  return out
}

export function worldOf(
  on: On,
  files: Readonly<Record<string, string>>,
  store: Readonly<Record<string, unknown>> = {},
  env: Readonly<Record<string, string>> = { HOME },
  platform: 'posix' | 'windows' = 'posix',
): World {
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
    platform,
    locks: new Map(),
    clixml: false,
    lockVanishes: false,
  }
  mock.store(on, store)
  mock.env(on, env)
  const isDir = (path: string) => world.locks.has(path) || [...world.files.keys(), ...world.locks.keys()].some(f => f.startsWith(`${path}/`))

  on('fs.exists', ($, e) => ({ value: world.files.has(abs(e.path)) || isDir(abs(e.path)) }))
  on('fs.stat', ($, e) => {
    const path = abs(e.path)
    const lock = world.locks.get(path)
    if (lock !== undefined) return { value: { kind: 'dir', size: 0, mtimeMs: lock, isLink: false } as never }
    if (world.files.has(path)) return { value: { kind: 'file', size: 0, mtimeMs: 0, isLink: false } as never }
    return isDir(path) ? { value: { kind: 'dir', size: 0, mtimeMs: 0, isLink: false } as never } : { deny: `ENOENT: ${e.path}` }
  })
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
    for (const l of world.locks.keys()) if (l.startsWith(`${dir}/`) && !l.slice(dir.length + 1).includes('/')) names.set(l.slice(dir.length + 1), 'dir')
    return { value: [...names].map(([name, kind]) => ({ name, kind, size: 0, mtimeMs: 0, isLink: false })) as never }
  })
  // The host beneath: POSIX (uname answers; mv, rm) or Windows (no uname; powershell.exe with an
  // -EncodedCommand of Move-Item / Remove-Item), over the in-memory files.
  on('process.run', ($, e) => {
    const argv = [...e.argv]
    world.commands.push(argv)
    const ok = { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false }
    const fail = (stderr: string) => ({ value: { ...ok, exitCode: 1, stderr } })
    const move = (from: string, to: string, clobber: 'yes' | 'no' | 'skip') => {
      const text = world.files.get(abs(from))
      if (text === undefined) return fail(`cannot find '${from}'`)
      if (world.files.has(abs(to))) {
        if (clobber === 'skip') return { value: ok }
        if (clobber === 'no') return fail(`'${to}' exists`)
      }
      world.files.delete(abs(from))
      world.files.set(abs(to), text)
      return { value: ok }
    }
    const mkdir = (path: string) => {
      if (world.locks.has(abs(path)) || world.files.has(abs(path))) return fail(`'${path}' exists`)
      if (!world.lockVanishes) world.locks.set(abs(path), 0)
      return { value: ok }
    }
    const rmdir = (path: string) => (world.locks.delete(abs(path)) ? { value: ok } : fail(`no directory '${path}'`))
    if (world.platform === 'windows') {
      if (argv[0] !== 'powershell.exe') return { deny: `ENOENT: ${argv[0]}` }
      // As Windows PowerShell 5.1 does it (Pepys's desk, kit #11): under
      // $ErrorActionPreference = 'Stop' any error ends the script with exit 1, even with
      // -ErrorAction SilentlyContinue on the command; stderr may carry CLIXML progress records
      // on a call that succeeded.
      const script = decodeUtf16le(argv[argv.length - 1] ?? '').replace(/^\$ErrorActionPreference = 'Stop'; /, '')
      const lit = "'((?:[^']|'')*)'"
      const un = (q: string | undefined) => (q ?? '').replaceAll("''", "'")
      const exists = (path: string) => world.files.has(abs(path)) || world.locks.has(abs(path))
      const run1 = (stmt: string): ReturnType<typeof fail> | { value: typeof ok } => {
        const guarded = new RegExp(`^if \\(Test-Path -LiteralPath ${lit}\\) \\{ (.*) \\}$`).exec(stmt)
        if (guarded) return exists(un(guarded[1])) ? run1(guarded[2] ?? '') : { value: ok }
        const mv = new RegExp(`^Move-Item -LiteralPath ${lit} -Destination ${lit}( -Force)?$`).exec(stmt)
        if (mv) return move(un(mv[1]), un(mv[2]), mv[3] === undefined ? 'no' : 'yes')
        const md = new RegExp(`^New-Item -ItemType Directory -Path ${lit} \\| Out-Null$`).exec(stmt)
        if (md) return mkdir(un(md[1]))
        const rm = new RegExp(`^Remove-Item -LiteralPath ${lit} -Force( -ErrorAction SilentlyContinue)?$`).exec(stmt)
        if (rm) {
          const path = un(rm[1])
          if (!exists(path)) return fail(`Remove-Item : Cannot find path '${path}' because it does not exist.`)
          world.files.delete(abs(path))
          world.locks.delete(abs(path))
          return { value: ok }
        }
        return fail(`not mocked: ${stmt}`)
      }
      const result = run1(script)
      return world.clixml ? { value: { ...result.value, stderr: `${CLIXML}${result.value.stderr}` } } : result
    }
    const paths = argv.filter(a => !a.startsWith('-'))
    if (argv[0] === 'mkdir') return mkdir(paths[1] ?? '')
    if (argv[0] === 'rmdir') return rmdir(paths[1] ?? '')
    if (argv[0] === 'uname') return { value: { ...ok, stdout: 'Linux\n' } }
    if (argv[0] === 'mv') {
      const [, from, to] = paths
      if (from === undefined || to === undefined) return fail('usage')
      return move(from, to, argv.includes('-n') ? 'skip' : 'yes')
    }
    if (argv[0] === 'rm' && argv.includes('-d')) {
      // rm -d -f: a file or an empty directory; -f: quiet when it is already gone.
      for (const p of paths.slice(1)) {
        world.files.delete(abs(p))
        world.locks.delete(abs(p))
      }
      return { value: ok }
    }
    if (argv[0] === 'rm') {
      for (const p of paths.slice(1)) world.files.delete(abs(p))
      return { value: ok }
    }
    return fail(`not mocked: ${argv.join(' ')}`)
  })
  on('command.register', ($, e) => ({ value: { command: e.name } }))
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
