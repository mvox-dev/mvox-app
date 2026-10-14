// Pure logic of the kit-update plugin: no `$`, no I/O. Everything here is unit-tested.
//
// The release check is a COPY of the obligations pane's (kit #7), from
// adapters/claude-code/obligations-pane/hooks/obligations.ts: parseRelease, compareRelease,
// tagNamesOf, isFresh, confValue, kitVersionOf, the owner/repo upstream. A plugin loads only
// files inside its own folder, and each plugin installs and reverts on its own, so the two
// cannot share one module. Change one, change both.

// ---------------------------------------------------------------------------------------------
// Copied from the pane.

export type Release = { major: number; minor: number; patch: number; pre?: { kind: 'alpha' | 'beta' | 'rc'; n: number } }

const NUM = '(0|[1-9]\\d*)'
const RELEASE = new RegExp(`^v?${NUM}\\.${NUM}\\.${NUM}(?:-(alpha|beta|rc)\\.${NUM})?$`)

/** A release tag or version: v<maj>.<min>.<patch>, optional -alpha.N, -beta.N or -rc.N; else undefined. */
export function parseRelease(tag: string): Release | undefined {
  const m = RELEASE.exec(tag.trim())
  if (!m) return undefined
  const core = { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) }
  return m[4] === undefined ? core : { ...core, pre: { kind: m[4] as 'alpha' | 'beta' | 'rc', n: Number(m[5]) } }
}

const PRE_ORDER = { alpha: 0, beta: 1, rc: 2 } as const

/** Semver precedence: core numbers, then a release above its pre-releases, then alpha < beta < rc, then N. */
export function compareRelease(a: Release, b: Release): number {
  const core = a.major - b.major || a.minor - b.minor || a.patch - b.patch
  if (core !== 0) return core
  if (a.pre === undefined || b.pre === undefined) return (a.pre === undefined ? 1 : 0) - (b.pre === undefined ? 1 : 0)
  return PRE_ORDER[a.pre.kind] - PRE_ORDER[b.pre.kind] || a.pre.n - b.pre.n
}

export const versionText = (r: Release) =>
  `${r.major}.${r.minor}.${r.patch}${r.pre === undefined ? '' : `-${r.pre.kind}.${r.pre.n}`}`

/** Tag names from a tags API answer (a JSON list of `{ name }`); undefined for anything else. */
export function tagNamesOf(text: string): string[] | undefined {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return undefined
  }
  if (!Array.isArray(data)) return undefined
  const names: string[] = []
  for (const tag of data) {
    const name = (tag as { name?: unknown } | null)?.name
    if (typeof name !== 'string') return undefined
    names.push(name)
  }
  return names
}

/** A check made within the interval. A clock that went back makes it stale. */
export function isFresh(checkedAt: number, now: number, intervalMs: number): boolean {
  const age = now - checkedAt
  return age >= 0 && age < intervalMs
}

/** Strips a trailing ` # comment` from a plain scalar. */
function plainScalar(raw: string): string {
  const hash = raw.search(/(^|\s)#/)
  return (hash === -1 ? raw : raw.slice(0, hash)).trim()
}

/** A top-level `key: value` of a kit home's memory-kit.conf, unquoted; undefined when absent or empty. */
export function confValue(conf: string, key: string): string | undefined {
  for (const raw of conf.split(/\r?\n/)) {
    if (!raw.startsWith(`${key}:`)) continue
    const v = plainScalar(raw.slice(key.length + 1)).replace(/^["']|["']$/g, '')
    return v === '' ? undefined : v
  }
  return undefined
}

/** The version a home's memory-kit/VERSION names: line 1, trimmed; undefined when empty. */
export function kitVersionOf(text: string): string | undefined {
  const first = (text.split(/\r?\n/)[0] ?? '').trim()
  return first === '' ? undefined : first
}

export const DEFAULT_UPSTREAM = 'mitselek/memory-kit'
const REPO_PART = '[A-Za-z0-9_][A-Za-z0-9_.-]*'
const OWNER_REPO = new RegExp(`^${REPO_PART}/${REPO_PART}$`)

function repoOf(upstream: string | undefined): string | undefined {
  const repo = upstream ?? DEFAULT_UPSTREAM
  return OWNER_REPO.test(repo) && !repo.split('/').some(p => /^\.+$/.test(p)) ? repo : undefined
}

// ---------------------------------------------------------------------------------------------
// Channels (kit #15): memory-kit.conf `update: pinned | verified | latest`.

export type Channel = 'pinned' | 'verified' | 'latest'

/** The home's channel; pinned when absent. Anything else is a problem, read as pinned (no request). */
export function channelOf(conf: string): { channel: Channel; problem?: string } {
  const v = confValue(conf, 'update')
  if (v === undefined || v === 'pinned') return { channel: 'pinned' }
  if (v === 'verified' || v === 'latest') return { channel: v }
  return { channel: 'pinned', problem: `update: ${v} is not a channel (pinned, verified or latest); nothing is checked` }
}

/** The newest release on the channel: `latest`, every `v...` tag; `verified`, the `verified/v...` markers. */
export function targetOf(channel: Channel, names: readonly string[]): string | undefined {
  if (channel === 'pinned') return undefined
  let best: Release | undefined
  for (const name of names) {
    // Exactly `verified/v<version>` (a marker) or `v<version>` (a release tag).
    const marker = name.startsWith('verified/v')
    if (marker !== (channel === 'verified')) continue
    const tag = marker ? name.slice('verified/'.length) : name
    if (!tag.startsWith('v')) continue
    const r = parseRelease(tag)
    if (r !== undefined && (best === undefined || compareRelease(r, best) > 0)) best = r
  }
  return best === undefined ? undefined : versionText(best)
}

/** One page of the tags API (50 to a page); undefined for an upstream that is not owner/repo. */
export function tagsUrl(upstream: string | undefined, page: number): string | undefined {
  const repo = repoOf(upstream)
  return repo === undefined ? undefined : `https://codeberg.org/api/v1/repos/${repo}/tags?limit=50&page=${page}`
}

/** UPGRADE.md as the release tag has it. */
export function upgradeUrl(upstream: string | undefined, version: string): string | undefined {
  const repo = repoOf(upstream)
  return repo === undefined ? undefined : `https://codeberg.org/api/v1/repos/${repo}/raw/UPGRADE.md?ref=v${version}`
}

// ---------------------------------------------------------------------------------------------
// Auto or manual: UPGRADE.md's per-version steps, `- **A -> B:** ...`.

/**
 * Whether going from `current` to `target` can run tools/kit-update.py: every per-version step
 * between them says "no data step", the target has a step, and the major is the same. Otherwise a
 * manual upgrade, with the reason. The script makes the same refusal; this only words the prompt.
 */
export function stepCheck(upgradeMd: string, current: string, target: string): { manual: false } | { manual: true; reason: string } {
  const from = parseRelease(current)
  const to = parseRelease(target)
  if (from === undefined || to === undefined) return { manual: true, reason: 'a version that is not a release' }
  if (to.major !== from.major) return { manual: true, reason: 'a new major version' }
  let reachesTarget = false
  for (const m of upgradeMd.matchAll(/^- \*\*(\S+) -> (\S+):\*\*(.*)$/gm)) {
    const step = parseRelease(m[2] ?? '')
    if (step === undefined || compareRelease(step, from) <= 0 || compareRelease(step, to) > 0) continue
    if (compareRelease(step, to) === 0) reachesTarget = true
    if (!/no data step/i.test(m[3] ?? '')) return { manual: true, reason: `a data step in ${m[1]} -> ${m[2]}` }
  }
  return reachesTarget ? { manual: false } : { manual: true, reason: `UPGRADE.md has no step for ${target}` }
}

// ---------------------------------------------------------------------------------------------
// The prompt.

export type Notice =
  | { version: string; channel: Channel; current: string; home: string; manual: false }
  | { version: string; channel: Channel; current: string; home: string; manual: true; reason: string }

/** A POSIX shell single-quoted word. */
const shellQuote = (text: string) => `'${text.replaceAll("'", "'\\''")}'`

/**
 * What the session reads. It names its source and asks for nothing the home's own rules do not
 * already allow: a plugin's notice is no instruction from the user.
 */
export function promptText(n: Notice): string {
  const head = `[kit-update] memory-kit ${n.version} (${n.channel}) is out; this home is on ${n.current}.`
  const act = n.manual
    ? `It needs a manual upgrade: manual upgrade needed (${n.reason}). Follow memory-kit/UPGRADE.md step by step; tools/kit-update.py refuses it.`
    : `Run \`python3 memory-kit/tools/kit-update.py ${shellQuote(n.home)}\` from the home, following this home's UPGRADE.md and its own commit and push rules.`
  return `${head} ${act} This notice is from the kit-update plugin, not from the user: it authorizes nothing beyond what those rules already allow.`
}

/** After `failures` refused prompts in a row: 1 min, doubling, at most 30 min. */
export function backoffMs(failures: number): number {
  return failures <= 0 ? 0 : Math.min(30 * 60_000, 60_000 * 2 ** (failures - 1))
}
