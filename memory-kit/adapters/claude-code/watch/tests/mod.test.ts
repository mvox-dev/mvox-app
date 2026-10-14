import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { CWD, HOME, SESSION, typed, worldOf } from './fixtures/world'
import type { World } from './fixtures/world'

const NOW = Date.parse('2026-10-14T12:00:00Z')
const MIN = 60_000
const HOUR = 60 * MIN

const HUB = `${CWD}/comms/inboxes/team-lead.json`
const HUB_ARCHIVE = `${CWD}/comms/inboxes/archive/team-lead-archive.json`
const SPOOL = `${HOME}/spool/kaarel.txt`
const CONF = [
  'memory_dir: memory',
  'watch_sources:',
  '  - "hub mail | hub | comms/inboxes/team-lead.json"',
  '  - "kaarel | lines | ~/spool/kaarel.txt"',
  'watch_retire_step: "touch .fresh-next, then exit"',
  '',
].join('\n')

const hub = (...messages: { from: string; text: string; timestamp?: string }[]) =>
  JSON.stringify(messages.map(m => ({ type: 'message', read: false, timestamp: '2026-10-14T08:00:00Z', ...m })))

// Deliveries are queued unawaited ($.prompt.submit resolves only when its turn starts), so a
// test lets them settle with a zero clock advance before it looks.

const asides = (world: World) => [...world.files.keys()].filter(f => /\.watch-(drain|pending)-/.test(f))

describe('notifications: drain and deliver', () => {
  test('a hub inbox: each message prefixed, in order; archived; the inbox gone, no aside left', async ($, on) => {
    const world = worldOf(on, {
      'memory-kit.conf': CONF,
      [HUB]: hub({ from: 'po-team', text: 'Ping from Henry.' }, { from: 'esl', text: 'Second.' }),
      [HUB_ARCHIVE]: hub({ from: 'old', text: 'already archived' }),
    })
    const clock = mock.clock(on, { now: NOW })
    await $.session.start(SESSION)
    await clock.advance(0)
    expect(world.submitted).toEqual([
      '[hub mail] from po-team [2026-10-14T08:00:00Z]: Ping from Henry.',
      '[hub mail] from esl [2026-10-14T08:00:00Z]: Second.',
    ])
    expect(world.files.has(HUB)).toBe(false)
    expect(JSON.parse(world.files.get(HUB_ARCHIVE) ?? '').map((m: { from: string }) => m.from)).toEqual(['old', 'po-team', 'esl'])
    expect(asides(world)).toEqual([])
    // The inbox is renamed aside before it is read (race-safe against a writer); the archive and
    // the pending events are written through a temporary and a rename; the aside is removed; each
    // accepted event then leaves the pending file (rewritten, then removed when empty).
    expect(world.commands.map(c => c.slice(0, 2).join(' '))).toEqual(['mv --', 'mv -f', 'mv -f', 'rm -f', 'mv -f', 'rm -f'])
    expect([...world.files.keys()].some(f => f.endsWith('.watch-tmp'))).toBe(false)
  })

  test('a spool of lines, written while the session runs: delivered at the next poll', async ($, on) => {
    const world = worldOf(on, { 'memory-kit.conf': CONF })
    const clock = mock.clock(on, { now: NOW })
    await $.session.start(SESSION)
    await clock.advance(0)
    expect(world.submitted).toEqual([])
    world.files.set(SPOOL, '[kaarel-chat 10:01] tere\n[kaarel-session 10:02] kaarel LOGGED IN\n')
    await clock.advance(15_000)
    expect(world.submitted).toEqual(['[kaarel] [kaarel-chat 10:01] tere', '[kaarel] [kaarel-session 10:02] kaarel LOGGED IN'])
    expect(world.files.get(`${HOME}/spool/archive/kaarel.txt`)).toBe('[kaarel-chat 10:01] tere\n[kaarel-session 10:02] kaarel LOGGED IN\n')
    expect(world.files.has(SPOOL)).toBe(false)
    // Nothing new: nothing delivered twice.
    await clock.advance(30_000)
    expect(world.submitted).toHaveLength(2)
  })

  test('a long item: a preview and the archive path, under 450 chars', async ($, on) => {
    const long = `Long report. ${'word '.repeat(400)}`
    const world = worldOf(on, { 'memory-kit.conf': CONF, [HUB]: hub({ from: 'esl', text: long }) })
    const clock = mock.clock(on, { now: NOW })
    await $.session.start(SESSION)
    await clock.advance(0)
    const [event] = world.submitted
    expect(event?.length).toBeLessThanOrEqual(450)
    expect(event).toContain(`full text in ${HUB_ARCHIVE}`)
    expect(event).toContain('Long report.')
  })

  test('an empty inbox ([]) is left alone; a file that is not a hub list is not moved, one debug line', async ($, on) => {
    const world = worldOf(on, { 'memory-kit.conf': CONF, [HUB]: '[]', [SPOOL]: '\n\n' })
    const clock = mock.clock(on, { now: NOW })
    await $.session.start(SESSION)
    await clock.advance(0)
    expect(world.commands).toEqual([])
    world.files.set(HUB, '{"half": ')
    await clock.advance(15_000)
    await clock.advance(15_000)
    expect(world.files.get(HUB)).toBe('{"half": ')
    expect(world.submitted).toEqual([])
    expect(world.logs.filter(l => l.includes('team-lead.json'))).toEqual([expect.stringMatching(/^debug: .*not a hub inbox/)])
  })

  test('an aside a crash left behind is delivered at the next poll', async ($, on) => {
    const aside = `${CWD}/comms/inboxes/.watch-drain-team-lead.json-1-2`
    const world = worldOf(on, { 'memory-kit.conf': CONF, [aside]: hub({ from: 'po', text: 'stranded' }) })
    const clock = mock.clock(on, { now: NOW })
    await $.session.start(SESSION)
    await clock.advance(0)
    expect(world.submitted).toEqual(['[hub mail] from po [2026-10-14T08:00:00Z]: stranded'])
    expect(asides(world)).toEqual([])
  })

  test('an aside that turns out unreadable goes back, never over a newer inbox', async ($, on) => {
    const aside = `${CWD}/comms/inboxes/.watch-drain-team-lead.json-1-2`
    const world = worldOf(on, { 'memory-kit.conf': CONF, [aside]: 'garbage', [HUB]: hub({ from: 'po', text: 'new' }) })
    const clock = mock.clock(on, { now: NOW })
    await $.session.start(SESSION)
    await clock.advance(0)
    // The new inbox is drained and delivered; the garbage stays aside, not over anything.
    expect(world.submitted).toEqual(['[hub mail] from po [2026-10-14T08:00:00Z]: new'])
    expect(world.files.get(aside)).toBe('garbage')
  })

  test('a refused delivery keeps the items on disk and tells the human once', async ($, on) => {
    const world = worldOf(on, {
      'memory-kit.conf': CONF,
      [HUB]: hub({ from: 'po', text: 'first' }, { from: 'po', text: 'second' }),
    })
    world.refuse = 'held by a guard plugin'
    const clock = mock.clock(on, { now: NOW })
    await $.session.start(SESSION)
    await clock.advance(0)
    expect(world.submitted).toEqual([])
    // Drained from the inbox and archived, but still waiting on disk beside it.
    expect(world.files.has(HUB)).toBe(false)
    expect(JSON.parse(world.files.get(HUB_ARCHIVE) ?? '')).toHaveLength(2)
    const waiting = asides(world)
    expect(waiting).toHaveLength(1)
    expect(world.files.get(waiting[0] ?? '')).toContain('second')
    // Polls go on for 20 min: one notice, and retries backed off, not one per poll.
    await clock.advance(20 * MIN)
    expect(world.notified).toEqual([expect.stringMatching(/2 items waiting in .*comms\/inboxes.*held by a guard plugin/)])
    expect(world.attempts.length).toBeLessThanOrEqual(6)
    expect(world.attempts.every(t => t.endsWith(': first'))).toBe(true)
  })

  test('when the refusal lifts, the next try delivers each item once, in order', async ($, on) => {
    const world = worldOf(on, {
      'memory-kit.conf': CONF,
      [HUB]: hub({ from: 'po', text: 'first' }, { from: 'po', text: 'second' }),
    })
    world.refuse = 'held by a guard plugin'
    const clock = mock.clock(on, { now: NOW })
    await $.session.start(SESSION)
    await clock.advance(5 * MIN)
    world.refuse = undefined
    await clock.advance(30 * MIN)
    expect(world.submitted).toEqual([
      '[hub mail] from po [2026-10-14T08:00:00Z]: first',
      '[hub mail] from po [2026-10-14T08:00:00Z]: second',
    ])
    expect(asides(world)).toEqual([])
    // Mail that arrived meanwhile follows, after the older items.
    world.files.set(HUB, hub({ from: 'po', text: 'third' }))
    await clock.advance(HOUR)
    expect(world.submitted.map(t => t.split(': ')[1])).toEqual(['first', 'second', 'third'])
  })

  test('a submit still pending at the next poll is not delivered twice, and the order holds', async ($, on) => {
    const world = worldOf(on, {
      'memory-kit.conf': CONF,
      [HUB]: hub({ from: 'po', text: 'first' }, { from: 'po', text: 'second' }),
    })
    // A busy session: no submit enters until its turn can start.
    world.hold = true
    const clock = mock.clock(on, { now: NOW })
    await $.session.start(SESSION)
    await clock.advance(60_000)
    // Four poll ticks went by: still the one submit in flight.
    expect(world.attempts).toHaveLength(1)
    world.files.set(HUB, hub({ from: 'po', text: 'third' }))
    for (let i = 0; i < 3; i++) {
      world.release()
      await clock.advance(15_000)
    }
    expect(world.attempts.map(t => t.split(': ')[1])).toEqual(['first', 'second', 'third'])
    expect(world.submitted.map(t => t.split(': ')[1])).toEqual(['first', 'second', 'third'])
    expect(asides(world)).toEqual([])
  })

  test('a glob source (a team inbox under a rotating session folder) with a {name} archive', async ($, on) => {
    const conf = 'watch_sources:\n  - "hub mail | hub | ~/.claude/teams/session-*/inboxes/team-lead.json | ~/comms/archive/{name}-archive.json"\n'
    const inbox = `${HOME}/.claude/teams/session-ab12/inboxes/team-lead.json`
    const world = worldOf(on, {
      'memory-kit.conf': conf,
      [inbox]: hub({ from: 'courier', text: 'eight hours of mail' }),
      [`${HOME}/.claude/teams/session-ab12/inboxes/other.json`]: hub({ from: 'x', text: 'not ours' }),
    })
    const clock = mock.clock(on, { now: NOW })
    await $.session.start(SESSION)
    await clock.advance(0)
    expect(world.submitted).toEqual(['[hub mail] from courier [2026-10-14T08:00:00Z]: eight hours of mail'])
    expect(world.files.has(`${HOME}/comms/archive/team-lead-archive.json`)).toBe(true)
    expect(world.files.has(`${HOME}/.claude/teams/session-ab12/inboxes/other.json`)).toBe(true)
  })

  test('no watch_sources: nothing polled, nothing run', async ($, on) => {
    const world = worldOf(on, { 'memory-kit.conf': 'memory_dir: memory\n', [HUB]: hub({ from: 'po', text: 'x' }) })
    const clock = mock.clock(on, { now: NOW })
    await $.session.start(SESSION)
    await clock.advance(60_000)
    expect(world.submitted).toEqual([])
    expect(world.commands).toEqual([])
  })

  test('a bad source line is skipped with one debug line; the good ones still run', async ($, on) => {
    const conf = 'watch_sources:\n  - "broken | json | x"\n  - "kaarel | lines | ~/spool/kaarel.txt"\n'
    const world = worldOf(on, { 'memory-kit.conf': conf, [SPOOL]: 'hi\n' })
    const clock = mock.clock(on, { now: NOW })
    await $.session.start(SESSION)
    await clock.advance(30_000)
    expect(world.submitted).toEqual(['[kaarel] hi'])
    expect(world.logs.filter(l => l.includes('broken'))).toHaveLength(1)
  })
})

describe('checkpoint and retire on idle', () => {
  const RETIRE = { retireOnIdle: true, pollSeconds: 60 }

  /** Session start with a startup turn that read `startup` tokens, then a typed prompt, its answer at `grown`. */
  const humanSession = async ($: Engine, world: World, startup: number | undefined, grown: number) => {
    world.tokens = startup
    await $.session.start(SESSION)
    await $.prompt.submit(typed('work on the thing') as never)
    world.tokens = grown
    await $.turn.complete({ answer: 'done', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
  }
  const asks = (world: World) => world.submitted.filter(t => t.includes('close routine'))

  test('off by default: idle, grown, a human seen, and still no ask', async ($, on) => {
    const world = worldOf(on, { 'memory-kit.conf': CONF })
    const clock = mock.clock(on, { now: NOW })
    await humanSession($, world, 50_000, 700_000)
    await clock.advance(2 * HOUR)
    expect(asks(world)).toEqual([])
  })

  test('on: one ask after 50 idle minutes, naming the home retire step', { options: RETIRE }, async ($, on) => {
    const world = worldOf(on, { 'memory-kit.conf': CONF })
    const clock = mock.clock(on, { now: NOW })
    await humanSession($, world, 50_000, 700_000)
    await clock.advance(49 * MIN)
    expect(asks(world)).toEqual([])
    await clock.advance(MIN)
    expect(asks(world)).toHaveLength(1)
    expect(asks(world)[0]).toContain('touch .fresh-next, then exit')
  })

  test('guard 1: no human input since start, never', { options: RETIRE }, async ($, on) => {
    const world = worldOf(on, { 'memory-kit.conf': CONF })
    const clock = mock.clock(on, { now: NOW })
    await $.session.start(SESSION)
    world.tokens = 900_000
    await $.turn.complete({ answer: 'startup', durationMs: 1, isAborted: false, turnId: 't0', reason: 'answer' })
    await clock.advance(3 * HOUR)
    expect(asks(world)).toEqual([])
  })

  test('guard 2: a fresh session above the size threshold does not retire', { options: RETIRE }, async ($, on) => {
    const world = worldOf(on, { 'memory-kit.conf': CONF })
    const clock = mock.clock(on, { now: NOW })
    // The startup alone read 70%; the human's turn added 5%.
    await humanSession($, world, 700_000, 750_000)
    await clock.advance(2 * HOUR)
    expect(asks(world)).toEqual([])
  })

  test('guard 3: a session that survives its ask is not asked again; one notice after an hour', { options: RETIRE }, async ($, on) => {
    const world = worldOf(on, { 'memory-kit.conf': CONF })
    const clock = mock.clock(on, { now: NOW })
    await humanSession($, world, 50_000, 700_000)
    await clock.advance(50 * MIN)
    expect(asks(world)).toHaveLength(1)
    // The retire step failed: the session is still here, idle again after the ask's turn.
    await $.turn.complete({ answer: 'checkpointed, but exit refused', durationMs: 1, isAborted: false, turnId: 't2', reason: 'answer' })
    await clock.advance(59 * MIN)
    expect(world.notified).toEqual([])
    await clock.advance(MIN)
    expect(world.notified).toEqual([expect.stringMatching(/still here/)])
    await clock.advance(3 * HOUR)
    expect(asks(world)).toHaveLength(1)
    expect(world.notified).toHaveLength(1)
  })

  test('guard 4: a retire 30 min ago (another session) brakes: no ask, one notice', { options: RETIRE }, async ($, on) => {
    const world = worldOf(on, { 'memory-kit.conf': CONF }, { retires: [NOW - 30 * MIN] })
    const clock = mock.clock(on, { now: NOW })
    await humanSession($, world, 50_000, 700_000)
    await clock.advance(2 * HOUR)
    expect(asks(world)).toEqual([])
    expect(world.notified).toEqual([expect.stringMatching(/less than 2 h ago/)])
  })

  test('guard 4: four retires in 24 h brake too', { options: RETIRE }, async ($, on) => {
    const world = worldOf(on, { 'memory-kit.conf': CONF }, { retires: [NOW - 20 * HOUR, NOW - 15 * HOUR, NOW - 10 * HOUR, NOW - 5 * HOUR] })
    const clock = mock.clock(on, { now: NOW })
    await humanSession($, world, 50_000, 700_000)
    await clock.advance(HOUR)
    expect(asks(world)).toEqual([])
    expect(world.notified).toEqual([expect.stringMatching(/4 retires in 24 h/)])
  })

  test('guard 5: after the brake trips the mod stops asking for the day, even once the brake clears', { options: RETIRE }, async ($, on) => {
    const world = worldOf(on, { 'memory-kit.conf': CONF }, { retires: [NOW - 30 * MIN] })
    const clock = mock.clock(on, { now: NOW })
    await humanSession($, world, 50_000, 700_000)
    await clock.advance(50 * MIN)
    expect(world.notified).toHaveLength(1)
    // 2 h after that retire the brake itself would allow one; the mod stays stopped.
    await clock.advance(2 * HOUR)
    expect(asks(world)).toEqual([])
    expect(world.notified).toHaveLength(1)
  })

  for (const result of [{ isSent: false, reason: 'no-channel' }, { isSent: true, channel: 'terminal_bell' }] as const) {
    test(`a notice no terminal shows (${JSON.stringify(result)}) also goes to the transcript`, { options: RETIRE }, async ($, on) => {
      const world = worldOf(on, { 'memory-kit.conf': CONF }, { retires: [NOW - 30 * MIN] })
      world.notifyResult = result
      const clock = mock.clock(on, { now: NOW })
      await humanSession($, world, 50_000, 700_000)
      await clock.advance(50 * MIN)
      expect(world.logs.filter(l => l.startsWith('transcript: ') && l.includes('less than 2 h ago'))).toHaveLength(1)
    })
  }

  test('human first, before any reading: the first reading is the floor, not growth', { options: RETIRE }, async ($, on) => {
    const world = worldOf(on, { 'memory-kit.conf': CONF })
    const clock = mock.clock(on, { now: NOW })
    // No startup turn: the first answer (system prompt, tools, a big paste) reads 300k.
    await humanSession($, world, undefined, 300_000)
    world.tokens = 700_000
    await $.prompt.submit(typed('more') as never)
    await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't3', reason: 'answer' })
    await clock.advance(60 * MIN)
    expect(asks(world)).toEqual([])
    world.tokens = 850_000
    await $.prompt.submit(typed('and more') as never)
    await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't4', reason: 'answer' })
    await clock.advance(50 * MIN)
    expect(asks(world)).toHaveLength(1)
  })

  test('a retire is recorded in the shared store, so the next session brakes', { options: RETIRE }, async ($, on) => {
    const world = worldOf(on, { 'memory-kit.conf': CONF })
    const clock = mock.clock(on, { now: NOW })
    await humanSession($, world, 50_000, 700_000)
    await clock.advance(50 * MIN)
    expect(asks(world)).toHaveLength(1)
    expect(world.logs.some(l => l.includes('retire asked'))).toBe(true)
  })

  test('human input resets the idle timer', { options: RETIRE }, async ($, on) => {
    const world = worldOf(on, { 'memory-kit.conf': CONF })
    const clock = mock.clock(on, { now: NOW })
    await humanSession($, world, 50_000, 700_000)
    await clock.advance(40 * MIN)
    await $.prompt.submit(typed('one more thing') as never)
    await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't3', reason: 'answer' })
    await clock.advance(40 * MIN)
    expect(asks(world)).toEqual([])
    await clock.advance(10 * MIN)
    expect(asks(world)).toHaveLength(1)
  })

  test('no watch_retire_step in memory-kit.conf: never asks (retiring is the home\'s own step)', { options: RETIRE }, async ($, on) => {
    const world = worldOf(on, { 'memory-kit.conf': 'watch_sources: []\n' })
    const clock = mock.clock(on, { now: NOW })
    await humanSession($, world, 50_000, 700_000)
    await clock.advance(2 * HOUR)
    expect(asks(world)).toEqual([])
  })
})
