import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { CLIXML, CWD, decodeUtf16le, HOME, SESSION, typed, worldOf } from './fixtures/world'
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
    // The first file operation probes the host once (uname answers: POSIX).
    expect(world.commands.map(c => c.slice(0, 2).join(' '))).toEqual(['uname -s', 'mv --', 'mv -f', 'mv -f', 'rm -f', 'mv -f', 'rm -f'])
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

  test('a bad source line is skipped with one visible notice; the good ones still run', async ($, on) => {
    const conf = 'watch_sources:\n  - "broken | json | x"\n  - "kaarel | lines | ~/spool/kaarel.txt"\n'
    const world = worldOf(on, { 'memory-kit.conf': conf, [SPOOL]: 'hi\n' })
    const clock = mock.clock(on, { now: NOW })
    await $.session.start(SESSION)
    await clock.advance(30_000)
    expect(world.submitted).toEqual(['[kaarel] hi'])
    expect(world.notified).toEqual([expect.stringMatching(/broken \| json \| x.*unknown format/)])
  })
})

describe('never idle silently (kit #14)', () => {
  test("mvox's one-line flow list is read, and its mail delivered", async ($, on) => {
    const conf = 'watch_sources: ["hub mail | hub | comms/inboxes/team-lead.json", \'kaarel | lines | ~/spool/kaarel.txt\']\n'
    const world = worldOf(on, { 'memory-kit.conf': conf, [HUB]: hub({ from: 'po', text: 'Ping' }), [SPOOL]: 'hi\n' })
    const clock = mock.clock(on, { now: NOW })
    await $.session.start(SESSION)
    await clock.advance(0)
    expect(world.submitted).toEqual(['[hub mail] from po [2026-10-14T08:00:00Z]: Ping', '[kaarel] hi'])
    expect(world.notified).toEqual([])
  })

  for (const [what, conf] of [
    ['declared with no items', 'watch_sources:\nmode: gate\n'],
    ['a form the watch cannot read', 'watch_sources: "hub mail | hub | x.json"\n'],
    ['only items that do not parse', 'watch_sources:\n  - "hub mail | json | x.json"\n'],
  ] as const) {
    test(`watch_sources ${what}: one visible notice, not one per poll`, async ($, on) => {
      const world = worldOf(on, { 'memory-kit.conf': conf })
      const clock = mock.clock(on, { now: NOW })
      await $.session.start(SESSION)
      await clock.advance(60_000)
      expect(world.notified.filter(n => n.includes('watch_sources'))).toHaveLength(1)
      expect(world.notified.some(n => n.includes(`${CWD}/memory-kit.conf`))).toBe(true)
    })
  }

  test('where no channel shows the notice, it goes to the transcript', async ($, on) => {
    const world = worldOf(on, { 'memory-kit.conf': 'watch_sources:\nmode: gate\n' })
    world.notifyResult = { isSent: false, reason: 'no-channel' }
    const clock = mock.clock(on, { now: NOW })
    await $.session.start(SESSION)
    await clock.advance(0)
    expect(world.logs.filter(l => l.startsWith('transcript: ') && l.includes('watch_sources'))).toHaveLength(1)
  })

  test('watch_sources: [] is a home that watches nothing on purpose: no notice', async ($, on) => {
    const world = worldOf(on, { 'memory-kit.conf': 'watch_sources: []\n' })
    const clock = mock.clock(on, { now: NOW })
    await $.session.start(SESSION)
    await clock.advance(30_000)
    expect(world.notified).toEqual([])
  })

  test('/watch says what is active, after a reload as any time', async ($, on) => {
    const conf = 'watch_sources: ["hub mail | hub | comms/inboxes/team-lead.json", "broken | json | x", \'kaarel | lines | ~/spool/kaarel.txt\']\n'
    worldOf(on, { 'memory-kit.conf': conf })
    const clock = mock.clock(on, { now: NOW })
    await $.session.start(SESSION)
    await clock.advance(0)
    const { text } = await $.command.run({ command: 'watch', args: '', origin: { kind: 'composer' } } as never)
    expect(text).toContain('2 sources active')
    expect(text).toContain(`${CWD}/memory-kit.conf`)
    expect(text).toContain('[hub mail] hub')
    expect(text).toContain('[kaarel] lines')
    expect(text).toMatch(/broken \| json \| x.*unknown format/)
    expect(text).toMatch(/retire on idle: off/)
  })

  test('/watch with nothing declared says so', async ($, on) => {
    worldOf(on, { 'memory-kit.conf': 'memory_dir: memory\n' })
    const clock = mock.clock(on, { now: NOW })
    await $.session.start(SESSION)
    await clock.advance(0)
    const { text } = await $.command.run({ command: 'watch', args: '', origin: { kind: 'composer' } } as never)
    expect(text).toMatch(/no watch_sources/)
  })
})

describe('a shared harness inbox: only courier mail, only unread (kit #12)', () => {
  const TEAM = `${HOME}/.claude/teams/session-ab12/inboxes`
  const INBOX = `${TEAM}/team-lead.json`
  const SHARED = 'watch_sources:\n  - "hub mail | hub unread courier | ~/.claude/teams/session-*/inboxes/team-lead.json | ~/comms/archive/{name}-archive.json"\n'
  const teammateRead = { from: 'mate', text: 'already delivered by the harness', timestamp: 't1', read: true, msg_id: 'm1' }
  const teammateUnread = { from: 'mate', text: 'for the harness to deliver', timestamp: 't2', read: false, msg_id: 'm2' }
  const courier = { from: 'hub-courier', text: 'eight hours of hub mail', timestamp: 't3', read: false }
  const inbox = (world: World) => JSON.parse(world.files.get(INBOX) ?? 'null') as unknown
  /** Start, then let the harness's 30 s grace pass with polls running. */
  const pastGrace = async ($: Engine, clock: { advance: (ms: number) => Promise<void> }) => {
    await $.session.start(SESSION)
    await clock.advance(35_000)
  }

  test('a read teammate entry and a courier entry: only the courier entry is delivered; the teammate one stays in place', async ($, on) => {
    const world = worldOf(on, { 'memory-kit.conf': SHARED, [INBOX]: JSON.stringify([teammateRead, courier]) })
    const clock = mock.clock(on, { now: NOW })
    await pastGrace($, clock)
    expect(world.submitted).toEqual(['[hub mail] from hub-courier [t3]: eight hours of hub mail'])
    expect(inbox(world)).toEqual([teammateRead])
    expect(JSON.parse(world.files.get(`${HOME}/comms/archive/team-lead-archive.json`) ?? '')).toEqual([courier])
    // Taken under the harness's own lock, released after.
    expect(world.commands.some(c => c[0] === 'mkdir' && c[2] === `${INBOX}.lock`)).toBe(true)
    expect(world.locks.size).toBe(0)
  })

  test('courier mail already marked read (delivered by the harness) is not delivered again', async ($, on) => {
    const delivered = { ...courier, text: 'the harness delivered this one', read: true }
    const world = worldOf(on, { 'memory-kit.conf': SHARED, [INBOX]: JSON.stringify([delivered, courier]) })
    const clock = mock.clock(on, { now: NOW })
    await pastGrace($, clock)
    expect(world.submitted).toEqual(['[hub mail] from hub-courier [t3]: eight hours of hub mail'])
    expect(inbox(world)).toEqual([delivered])
  })

  test('teammate entries only: the file is left untouched, no lock taken', async ($, on) => {
    const text = JSON.stringify([teammateRead, teammateUnread])
    const world = worldOf(on, { 'memory-kit.conf': SHARED, [INBOX]: text })
    const clock = mock.clock(on, { now: NOW })
    await pastGrace($, clock)
    expect(world.submitted).toEqual([])
    expect(world.files.get(INBOX)).toBe(text)
    expect(world.commands.filter(c => c[0] !== 'uname')).toEqual([])
  })

  test('an unread teammate entry beside courier mail is left, unread, for the harness', async ($, on) => {
    const world = worldOf(on, { 'memory-kit.conf': SHARED, [INBOX]: JSON.stringify([teammateUnread, courier]) })
    const clock = mock.clock(on, { now: NOW })
    await pastGrace($, clock)
    expect(world.submitted).toEqual(['[hub mail] from hub-courier [t3]: eight hours of hub mail'])
    expect(inbox(world)).toEqual([teammateUnread])
  })

  test('courier mail the harness takes within its grace is never delivered by the watch', async ($, on) => {
    const world = worldOf(on, { 'memory-kit.conf': SHARED, [INBOX]: JSON.stringify([courier]) })
    const clock = mock.clock(on, { now: NOW })
    await $.session.start(SESSION)
    await clock.advance(20_000)
    expect(world.submitted).toEqual([])
    // The harness delivers it and empties its inbox, as it does when its team is live.
    world.files.set(INBOX, '[]')
    await clock.advance(60_000)
    expect(world.submitted).toEqual([])
    expect(world.files.get(INBOX)).toBe('[]')
  })

  test('while the harness holds its lock, nothing is taken; once it lets go, the mail is', async ($, on) => {
    const world = worldOf(on, { 'memory-kit.conf': SHARED, [INBOX]: JSON.stringify([courier]) })
    world.locks.set(`${INBOX}.lock`, NOW + 30_000)
    const clock = mock.clock(on, { now: NOW })
    await pastGrace($, clock)
    expect(world.submitted).toEqual([])
    expect(world.files.get(INBOX)).toBe(JSON.stringify([courier]))
    world.locks.delete(`${INBOX}.lock`)
    await clock.advance(5_000)
    expect(world.submitted).toHaveLength(1)
    expect(inbox(world)).toEqual([])
  })

  test('a lock left more than 60 s is stale: broken once, then the mail is taken', async ($, on) => {
    const world = worldOf(on, { 'memory-kit.conf': SHARED, [INBOX]: JSON.stringify([courier]) })
    world.locks.set(`${INBOX}.lock`, NOW - 90_000)
    const clock = mock.clock(on, { now: NOW })
    await pastGrace($, clock)
    expect(world.submitted).toHaveLength(1)
    expect(world.locks.size).toBe(0)
    expect(world.logs.filter(l => l.includes('stale lock'))).toHaveLength(1)
  })

  test('a shared aside left unreadable by a crash is never put back over the harness inbox', async ($, on) => {
    const aside = `${TEAM}/.watch-drain-team-lead.json-1-2`
    const world = worldOf(on, { 'memory-kit.conf': SHARED, [aside]: '[{"from": "hub-cour' })
    const clock = mock.clock(on, { now: NOW })
    await $.session.start(SESSION)
    await clock.advance(0)
    expect(world.files.has(INBOX)).toBe(false)
    expect(world.files.get(aside)).toBe('[{"from": "hub-cour')
  })

  test('on Windows the same, through New-Item / Remove-Item for the lock', async ($, on) => {
    const world = worldOf(on, { 'memory-kit.conf': SHARED, [INBOX]: JSON.stringify([teammateRead, courier]) }, {}, { HOME }, 'windows')
    const clock = mock.clock(on, { now: NOW })
    await pastGrace($, clock)
    expect(world.submitted).toEqual(['[hub mail] from hub-courier [t3]: eight hours of hub mail'])
    expect(inbox(world)).toEqual([teammateRead])
    expect(world.locks.size).toBe(0)
  })
})

describe('Windows (kit alpha.9)', () => {
  const scripts = (world: World) =>
    world.commands.filter(c => c[0] === 'powershell.exe').map(c => decodeUtf16le(c[c.length - 1] ?? '').replace(/^.*?; /, ''))

  test('no uname: the drain runs through PowerShell, end to end', async ($, on) => {
    const world = worldOf(
      on,
      { 'memory-kit.conf': CONF, [HUB]: hub({ from: 'po', text: 'first' }, { from: 'po', text: 'second' }) },
      {},
      { HOME },
      'windows',
    )
    const clock = mock.clock(on, { now: NOW })
    await $.session.start(SESSION)
    await clock.advance(0)
    expect(world.submitted).toEqual([
      '[hub mail] from po [2026-10-14T08:00:00Z]: first',
      '[hub mail] from po [2026-10-14T08:00:00Z]: second',
    ])
    expect(world.files.has(HUB)).toBe(false)
    expect(JSON.parse(world.files.get(HUB_ARCHIVE) ?? '')).toHaveLength(2)
    expect(asides(world)).toEqual([])
    expect(world.commands[0]).toEqual(['uname', '-s'])
    expect(world.commands.slice(1).every(c => c[0] === 'powershell.exe')).toBe(true)
    const cmdlet = (s: string) => (s.startsWith('if (Test-Path ') ? 'guarded Remove-Item' : s.split(' -')[0])
    expect(scripts(world).map(cmdlet)).toEqual(['Move-Item', 'Move-Item', 'Move-Item', 'guarded Remove-Item', 'Move-Item', 'guarded Remove-Item'])
  })

  test('the put-back never replaces a newer inbox (Move-Item without -Force)', async ($, on) => {
    const aside = `${CWD}/comms/inboxes/.watch-drain-team-lead.json-1-2`
    const world = worldOf(on, { 'memory-kit.conf': CONF, [aside]: 'garbage', [HUB]: hub({ from: 'po', text: 'new' }) }, {}, { HOME }, 'windows')
    const clock = mock.clock(on, { now: NOW })
    await $.session.start(SESSION)
    await clock.advance(0)
    expect(world.submitted).toEqual(['[hub mail] from po [2026-10-14T08:00:00Z]: new'])
    expect(world.files.get(aside)).toBe('garbage')
    expect(scripts(world)[0]).toMatch(/^Move-Item -LiteralPath '.*\.watch-drain-team-lead\.json-1-2' -Destination '.*team-lead\.json'$/)
  })

  test('the platform is probed once and cached', async ($, on) => {
    const world = worldOf(on, { 'memory-kit.conf': CONF }, {}, { HOME }, 'windows')
    const clock = mock.clock(on, { now: NOW })
    await $.session.start(SESSION)
    for (let i = 0; i < 3; i++) {
      world.files.set(SPOOL, `line ${i}\n`)
      await clock.advance(15_000)
    }
    expect(world.submitted).toEqual(['[kaarel] line 0', '[kaarel] line 1', '[kaarel] line 2'])
    expect(world.commands.filter(c => c[0] === 'uname')).toHaveLength(1)
  })

  test('~ is USERPROFILE where HOME is not set', async ($, on) => {
    const world = worldOf(on, { 'memory-kit.conf': CONF, [SPOOL]: 'hi\n' }, {}, { USERPROFILE: HOME }, 'windows')
    const clock = mock.clock(on, { now: NOW })
    await $.session.start(SESSION)
    await clock.advance(0)
    expect(world.submitted).toEqual(['[kaarel] hi'])
  })
})

describe('a file already gone counts as removed (kit #11)', () => {
  const failures = (world: World) => world.logs.filter(l => / failed: /.test(l))

  for (const platform of ['posix', 'windows'] as const) {
    test(`${platform}: a pending file another session already finished is removed quietly`, async ($, on) => {
      const world = worldOf(on, { 'memory-kit.conf': CONF, [HUB]: hub({ from: 'po', text: 'only' }) }, {}, { HOME }, platform)
      world.hold = true
      const clock = mock.clock(on, { now: NOW })
      await $.session.start(SESSION)
      await clock.advance(5_000)
      // While our submit waits for its turn, another session delivers the same pending file and removes it.
      for (const f of asides(world)) world.files.delete(f)
      world.release()
      await clock.advance(5_000)
      expect(world.submitted).toEqual(['[hub mail] from po [2026-10-14T08:00:00Z]: only'])
      expect(failures(world)).toEqual([])
    })

    test(`${platform}: a lock the harness already broke is released quietly`, async ($, on) => {
      const team = `${HOME}/.claude/teams/session-ab12/inboxes/team-lead.json`
      const conf = `watch_sources:\n  - "hub mail | hub unread courier | ${team}"\n`
      const world = worldOf(on, { 'memory-kit.conf': conf, [team]: JSON.stringify([{ from: 'hub-courier', text: 'x', timestamp: 't' }]) }, {}, { HOME }, platform)
      world.lockVanishes = true
      const clock = mock.clock(on, { now: NOW })
      await $.session.start(SESSION)
      await clock.advance(35_000)
      expect(world.submitted).toHaveLength(1)
      expect(failures(world)).toEqual([])
    })
  }

  test('windows: CLIXML progress records on stderr with exit 0 are a success', async ($, on) => {
    const world = worldOf(on, { 'memory-kit.conf': CONF, [HUB]: hub({ from: 'po', text: 'first' }, { from: 'po', text: 'second' }) }, {}, { HOME }, 'windows')
    world.clixml = true
    const clock = mock.clock(on, { now: NOW })
    await $.session.start(SESSION)
    await clock.advance(0)
    expect(world.submitted).toHaveLength(2)
    expect(world.files.has(HUB)).toBe(false)
    expect(asides(world)).toEqual([])
    expect(failures(world)).toEqual([])
    expect(CLIXML.startsWith('#< CLIXML')).toBe(true)
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
