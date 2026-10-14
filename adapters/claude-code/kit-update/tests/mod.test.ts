import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { CWD, SESSION, worldOf } from './fixtures/world'
import type { World } from './fixtures/world'

const NOW = Date.parse('2026-10-14T12:00:00Z')
const MIN = 60_000
const HOUR = 60 * MIN
const TAGS = 'https://codeberg.org/api/v1/repos/mitselek/memory-kit/tags?limit=50&page=1'
const KEY = 'prompt:0.1.0-alpha.13'

const UPGRADE = [
  '## Per version',
  '- **0.1.0-alpha.11 -> 0.1.0-alpha.12:** no data step. Pull, lint.',
  '- **0.1.0-alpha.12 -> 0.1.0-alpha.13:** no data step. Pull, lint, `/reload-plugins`.',
  '- **0.1.0-alpha.13 -> 0.1.0-alpha.14:** data step: rename keys in `facts/` before the lint.',
  '',
].join('\n')

/** A home on alpha.12 following `channel`; upstream has alpha.13 out (verified) and the UPGRADE.md for it. */
const homeOn = (on: Parameters<typeof worldOf>[0], channel: string | undefined, store: Record<string, unknown> = {}) => {
  const world = worldOf(
    on,
    {
      'memory-kit/VERSION': '0.1.0-alpha.12\n',
      'memory-kit.conf': `memory_dir: memory\n${channel === undefined ? '' : `update: ${channel}\n`}`,
    },
    store,
  )
  world.tags = ['v0.1.0-alpha.13', 'verified/v0.1.0-alpha.13', 'v0.1.0-alpha.12', 'verified/v0.1.0-alpha.12']
  world.upgrade = { 'v0.1.0-alpha.13': UPGRADE, 'v0.1.0-alpha.14': UPGRADE }
  return world
}

/** Session start, then the claim's settle time: the first prompt is due by then. */
const start = async ($: Engine, clock: { advance: (ms: number) => Promise<void> }) => {
  await $.session.start(SESSION)
  await clock.advance(5_000)
}

const tagRequests = (world: World) => world.requests.filter(u => u.includes('/tags'))

describe('a newer release on the home channel (kit #15)', () => {
  test('verified: a newer verified release prompts once, not again on later checks', async ($, on) => {
    const world = homeOn(on, 'verified')
    const clock = mock.clock(on, { now: NOW })
    await start($, clock)
    expect(world.submitted).toHaveLength(1)
    expect(world.submitted[0]).toMatch(/^\[kit-update\] memory-kit 0\.1\.0-alpha\.13 \(verified\) is out; this home is on 0\.1\.0-alpha\.12\. Run `python3 memory-kit\/tools\/kit-update\.py '\/home\/u\/kit'`/)
    await clock.advance(5 * HOUR)
    expect(world.submitted).toHaveLength(1)
    // Checked again each hour, not each minute.
    expect(tagRequests(world).length).toBeGreaterThanOrEqual(5)
    expect(tagRequests(world).length).toBeLessThanOrEqual(6)
  })

  test('latest prompts on a tag not yet verified; verified does not', async ($, on) => {
    const world = homeOn(on, 'latest')
    world.tags = ['v0.1.0-alpha.13', 'v0.1.0-alpha.12', 'verified/v0.1.0-alpha.12']
    const clock = mock.clock(on, { now: NOW })
    await start($, clock)
    expect(world.submitted).toEqual([expect.stringMatching(/0\.1\.0-alpha\.13 \(latest\) is out/)])
  })

  test('verified does not prompt on a tag not yet verified', async ($, on) => {
    const world = homeOn(on, 'verified')
    world.tags = ['v0.1.0-alpha.13', 'v0.1.0-alpha.12', 'verified/v0.1.0-alpha.12']
    const clock = mock.clock(on, { now: NOW })
    await start($, clock)
    await clock.advance(2 * HOUR)
    expect(world.submitted).toEqual([])
    expect(tagRequests(world).length).toBeGreaterThan(0)
  })

  test('a data-step release prompts "manual upgrade needed" instead', async ($, on) => {
    const world = homeOn(on, 'latest')
    world.files.set(`${CWD}/memory-kit/VERSION`, '0.1.0-alpha.13\n')
    world.tags = ['v0.1.0-alpha.14', 'v0.1.0-alpha.13']
    const clock = mock.clock(on, { now: NOW })
    await start($, clock)
    expect(world.submitted).toHaveLength(1)
    expect(world.submitted[0]).toContain('manual upgrade needed (a data step in 0.1.0-alpha.13 -> 0.1.0-alpha.14)')
    expect(world.submitted[0]).not.toContain('Run `python3')
  })

  test('an intermediate release with no UPGRADE.md entry: "manual upgrade needed", as the script would refuse', async ($, on) => {
    const world = homeOn(on, 'latest')
    world.files.set(`${CWD}/memory-kit/VERSION`, '0.1.0-alpha.11\n')
    world.tags = ['v0.1.0-alpha.13', 'v0.1.0-alpha.12', 'v0.1.0-alpha.11']
    world.upgrade = { 'v0.1.0-alpha.13': '- **0.1.0-alpha.11 -> 0.1.0-alpha.13:** no data step.\n' }
    const clock = mock.clock(on, { now: NOW })
    await start($, clock)
    expect(world.submitted).toHaveLength(1)
    expect(world.submitted[0]).toContain('manual upgrade needed (UPGRADE.md has no entry for 0.1.0-alpha.11 -> 0.1.0-alpha.12)')
  })

  test('a home already on the newest release: nothing', async ($, on) => {
    const world = homeOn(on, 'latest')
    world.files.set(`${CWD}/memory-kit/VERSION`, '0.1.0-alpha.13\n')
    const clock = mock.clock(on, { now: NOW })
    await start($, clock)
    expect(world.submitted).toEqual([])
  })
})

describe('kit_home: the start folder points at the home (kit #18)', () => {
  const DESK = '/home/u/desk'
  /** Upstream as homeOn has it, the start folder a pointer, the desk the home. */
  const pointed = (on: Parameters<typeof worldOf>[0], deskFiles: Record<string, string>, startConf = 'kit_home: ../desk\n') => {
    const world = worldOf(on, { 'memory-kit.conf': startConf, ...Object.fromEntries(Object.entries(deskFiles).map(([k, v]) => [`${DESK}/${k}`, v])) })
    world.tags = ['v0.1.0-alpha.13', 'verified/v0.1.0-alpha.13', 'v0.1.0-alpha.12', 'verified/v0.1.0-alpha.12']
    world.upgrade = { 'v0.1.0-alpha.13': UPGRADE }
    return world
  }
  const DESK_HOME = { 'memory-kit/VERSION': '0.1.0-alpha.12\n', 'memory-kit.conf': 'update: verified\n' }

  test("the channel and the version come from the home it names; the prompt names that home", async ($, on) => {
    const world = pointed(on, DESK_HOME)
    const clock = mock.clock(on, { now: NOW })
    await start($, clock)
    expect(world.submitted).toHaveLength(1)
    expect(world.submitted[0]).toContain(`kit-update.py '${DESK}'`)
  })

  test('the pointer wins over a user-scope home option', { options: { home: '/home/u/elsewhere' } }, async ($, on) => {
    const world = pointed(on, DESK_HOME)
    world.files.set('/home/u/elsewhere/memory-kit.conf', 'update: pinned\n')
    world.files.set('/home/u/elsewhere/memory-kit/VERSION', '0.1.0-alpha.12\n')
    const clock = mock.clock(on, { now: NOW })
    await start($, clock)
    expect(world.submitted).toHaveLength(1)
  })

  test('a broken pointer: one visible notice, no request', async ($, on) => {
    const world = pointed(on, {}, 'kit_home: ../nowhere\n')
    const clock = mock.clock(on, { now: NOW })
    await start($, clock)
    await clock.advance(2 * HOUR)
    expect(world.requests).toEqual([])
    expect(world.notified).toEqual([expect.stringContaining('no memory-kit.conf there')])
  })

  test('a pointed home without memory-kit/VERSION: one visible notice, no request', async ($, on) => {
    const world = pointed(on, { 'memory-kit.conf': 'update: verified\n' })
    const clock = mock.clock(on, { now: NOW })
    await start($, clock)
    await clock.advance(2 * HOUR)
    expect(world.requests).toEqual([])
    expect(world.notified).toEqual([expect.stringContaining(`${DESK} has no memory-kit/VERSION`)])
  })

  test('update: left in a pointer conf is ignored, and said so', async ($, on) => {
    const world = pointed(on, { ...DESK_HOME, 'memory-kit.conf': 'update: pinned\n' }, 'kit_home: ../desk\nupdate: latest\n')
    const clock = mock.clock(on, { now: NOW })
    await start($, clock)
    expect(world.requests).toEqual([])
    expect(world.notified).toEqual([expect.stringMatching(/update .*ignored.*desk\/memory-kit\.conf/)])
  })

  test('/kit-update names the home and the pointer', async ($, on) => {
    pointed(on, DESK_HOME)
    const clock = mock.clock(on, { now: NOW })
    await start($, clock)
    const { text } = await $.command.run({ command: 'kit-update', args: '', origin: { kind: 'composer' } } as never)
    expect(text).toContain(`this home: 0.1.0-alpha.12 (${DESK}, by kit_home in ${CWD}/memory-kit.conf)`)
  })
})

describe('no request at all', () => {
  for (const channel of ['pinned', undefined] as const) {
    test(`update: ${channel ?? '(absent, so pinned)'} never prompts and never asks upstream`, async ($, on) => {
      const world = homeOn(on, channel)
      const clock = mock.clock(on, { now: NOW })
      await start($, clock)
      await clock.advance(3 * HOUR)
      expect(world.requests).toEqual([])
      expect(world.submitted).toEqual([])
    })
  }

  test('no memory-kit/VERSION: no request', async ($, on) => {
    const world = homeOn(on, 'latest')
    world.files.delete(`${CWD}/memory-kit/VERSION`)
    const clock = mock.clock(on, { now: NOW })
    await start($, clock)
    await clock.advance(2 * HOUR)
    expect(world.requests).toEqual([])
  })

  test('checkUpdates: false makes no request', { options: { checkUpdates: false } }, async ($, on) => {
    const world = homeOn(on, 'latest')
    const clock = mock.clock(on, { now: NOW })
    await start($, clock)
    await clock.advance(2 * HOUR)
    expect(world.requests).toEqual([])
  })

  test('an unknown channel: one visible notice, read as pinned', async ($, on) => {
    const world = homeOn(on, 'nightly')
    const clock = mock.clock(on, { now: NOW })
    await start($, clock)
    await clock.advance(2 * HOUR)
    expect(world.requests).toEqual([])
    expect(world.notified).toEqual([expect.stringMatching(/update: nightly/)])
  })
})

describe('failure is silent and retried at the next interval', () => {
  test('offline: no prompt, no notice; the next hourly check prompts', async ($, on) => {
    const world = homeOn(on, 'verified')
    world.offline = true
    const clock = mock.clock(on, { now: NOW })
    await start($, clock)
    await clock.advance(30 * MIN)
    expect(world.submitted).toEqual([])
    expect(world.notified).toEqual([])
    expect(tagRequests(world)).toHaveLength(1)
    world.offline = false
    await clock.advance(31 * MIN)
    expect(world.submitted).toHaveLength(1)
  })

  test('a request that never answers fails at 10 s and does not hold the checks', async ($, on) => {
    const world = homeOn(on, 'verified')
    world.offline = 'hang'
    const clock = mock.clock(on, { now: NOW })
    await $.session.start(SESSION)
    await clock.advance(10_000)
    expect(world.logs.some(l => l.startsWith('debug: ') && l.includes('timed out'))).toBe(true)
    world.offline = false
    await clock.advance(HOUR)
    expect(world.submitted).toHaveLength(1)
  })

  test('UPGRADE.md out of reach: no prompt yet; the next interval tries again', async ($, on) => {
    const world = homeOn(on, 'verified')
    world.upgrade = {}
    const clock = mock.clock(on, { now: NOW })
    await start($, clock)
    expect(world.submitted).toEqual([])
    world.upgrade = { 'v0.1.0-alpha.13': UPGRADE }
    await clock.advance(HOUR)
    expect(world.submitted).toHaveLength(1)
  })
})

describe('one prompt per release, across sessions and reloads', () => {
  test('another session already delivered it: nothing here, not even the UPGRADE.md fetch', async ($, on) => {
    const world = homeOn(on, 'verified', { [KEY]: { state: 'delivered', token: 'other', at: NOW - HOUR } })
    const clock = mock.clock(on, { now: NOW })
    await start($, clock)
    await clock.advance(2 * HOUR)
    expect(world.submitted).toEqual([])
    expect(world.requests.filter(u => u.includes('UPGRADE'))).toEqual([])
  })

  test('another session holds a fresh claim: it delivers, not this one', async ($, on) => {
    const world = homeOn(on, 'verified', { [KEY]: { state: 'claimed', token: 'other', at: NOW - 5 * MIN } })
    const clock = mock.clock(on, { now: NOW })
    await start($, clock)
    await clock.advance(10 * MIN)
    expect(world.submitted).toEqual([])
  })

  test('a claim left 30 min undelivered (its session gone) is taken over', async ($, on) => {
    const world = homeOn(on, 'verified', { [KEY]: { state: 'claimed', token: 'other', at: NOW - 31 * MIN } })
    const clock = mock.clock(on, { now: NOW })
    await start($, clock)
    expect(world.submitted).toHaveLength(1)
  })

  test("a claim another session writes during this one's settle time wins: this one backs off", async ($, on) => {
    const world = homeOn(on, 'verified')
    const clock = mock.clock(on, { now: NOW })
    await $.session.start(SESSION)
    await clock.advance(1_000)
    // Mid-settle, another session's claim lands over this one's.
    world.store.set(KEY, { state: 'claimed', token: 'other', at: NOW + 1_000 })
    await clock.advance(10 * MIN)
    expect(world.submitted).toEqual([])
  })

  test('a reload (session.start again) does not prompt again', async ($, on) => {
    const world = homeOn(on, 'verified')
    const clock = mock.clock(on, { now: NOW })
    await start($, clock)
    await start($, clock)
    await clock.advance(HOUR)
    expect(world.submitted).toHaveLength(1)
  })
})

describe('a refused prompt is retried with backoff', () => {
  test('refused: retried at 1, 2, 4 min; delivered once when the refusal lifts', async ($, on) => {
    const world = homeOn(on, 'verified')
    world.refuse = 'held by a guard plugin'
    const clock = mock.clock(on, { now: NOW })
    await start($, clock)
    await clock.advance(8 * MIN)
    expect(world.submitted).toEqual([])
    expect(world.attempts.length).toBeGreaterThanOrEqual(3)
    expect(world.attempts.length).toBeLessThanOrEqual(5)
    world.refuse = undefined
    await clock.advance(30 * MIN)
    expect(world.submitted).toHaveLength(1)
    await clock.advance(3 * HOUR)
    expect(world.submitted).toHaveLength(1)
  })

  test('a refused claim is kept fresh, so no other session takes it over meanwhile', async ($, on) => {
    const world = homeOn(on, 'verified')
    world.refuse = 'held'
    const clock = mock.clock(on, { now: NOW })
    await start($, clock)
    await clock.advance(45 * MIN)
    const claim = world.store.get(KEY) as { state: string; at: number }
    expect(claim.state).toBe('claimed')
    // Refreshed every tick (each minute) while it waits, not only at each retry.
    expect(NOW + 45 * MIN + 5_000 - claim.at).toBeLessThanOrEqual(MIN)
  })
})

describe('/kit-update', () => {
  test('shows the channel, the current and newest versions, the last check and the prompt state', async ($, on) => {
    const world = homeOn(on, 'verified')
    const clock = mock.clock(on, { now: NOW })
    await start($, clock)
    expect(world.commands).toEqual(['kit-update'])
    const { text } = await $.command.run({ command: 'kit-update', args: '', origin: { kind: 'composer' } } as never)
    expect(text).toContain('channel: verified')
    expect(text).toContain('this home: 0.1.0-alpha.12')
    expect(text).toContain('newest on the channel: 0.1.0-alpha.13')
    expect(text).toContain('last check: 2026-10-14T12:00')
    expect(text).toMatch(/0\.1\.0-alpha\.13: prompted/)
  })

  test('pinned says so', async ($, on) => {
    homeOn(on, undefined)
    const clock = mock.clock(on, { now: NOW })
    await start($, clock)
    const { text } = await $.command.run({ command: 'kit-update', args: '', origin: { kind: 'composer' } } as never)
    expect(text).toMatch(/channel: pinned.*no checks/)
  })
})

describe('upstream paging', () => {
  test('more than 50 tags: the next page is read too', async ($, on) => {
    const world = homeOn(on, 'latest')
    const old = Array.from({ length: 60 }, (_, i) => `v0.0.${60 - i}`)
    world.tags = [...old, 'v0.1.0-alpha.13']
    const clock = mock.clock(on, { now: NOW })
    await start($, clock)
    expect(tagRequests(world)).toEqual([TAGS, TAGS.replace('page=1', 'page=2')])
    expect(world.submitted).toEqual([expect.stringMatching(/0\.1\.0-alpha\.13 \(latest\)/)])
  })
})
