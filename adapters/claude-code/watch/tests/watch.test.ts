import { describe, expect, test } from 'claude-code/testing'

import {
  archiveFor,
  asideOf,
  base64Utf16le,
  backoffMs,
  BATCH_MAX,
  batchPrompt,
  brake,
  CLAIM_STALE_MS,
  claimDecision,
  claimKey,
  confValue,
  COURIER_GRACE_MS,
  decideRetire,
  entryKey,
  EVENT_LIMIT,
  expandHome,
  fileOpArgv,
  formatEvent,
  HOUR,
  hubItems,
  isAsideOf,
  isHuman,
  isInside,
  isPendingOf,
  lineItems,
  matchSegment,
  normalPath,
  pathSegments,
  parseSource,
  pendingEvents,
  pendingOf,
  platformOfHome,
  PROBE_ARGV,
  psQuote,
  retirePrompt,
  readSources,
  sourcesOf,
  STALE_LOCK_MS,
  SURVIVE_MS,
  takes,
} from '../hooks/watch'
import type { RetireInput } from '../hooks/watch'

describe('sources', () => {
  test('a spec: prefix | format | path [| archive]', () => {
    expect(parseSource('hub mail | hub | comms/inboxes/team-lead.json')).toEqual({
      prefix: 'hub mail',
      format: 'hub',
      path: 'comms/inboxes/team-lead.json',
    })
    expect(parseSource(' kaarel |lines| ~/spool/kaarel.txt | ~/spool/archive/kaarel.txt ')).toEqual({
      prefix: 'kaarel',
      format: 'lines',
      path: '~/spool/kaarel.txt',
      archive: '~/spool/archive/kaarel.txt',
    })
    expect(parseSource('x | json | a')).toMatch(/format/)
    expect(parseSource('x | hub')).toMatch(/prefix \| format \| path/)
    expect(parseSource(' | hub | a')).toMatch(/prefix/)
    expect(parseSource('x | hub | a | b | c')).toMatch(/prefix \| format \| path/)
  })

  test('watch_sources: a block list in memory-kit.conf', () => {
    const conf = [
      'memory_dir: memory',
      '# the watch mod',
      'watch_sources:',
      '  - "hub mail | hub | comms/inboxes/team-lead.json"',
      "  - 'kaarel | lines | comms/spool/kaarel.txt' # doorbell",
      '  - plain | lines | x.txt',
      '',
      'watch_retire_step: "touch .fresh-next, then exit"',
      'mode: gate',
    ].join('\n')
    expect(sourcesOf(conf)).toEqual(['hub mail | hub | comms/inboxes/team-lead.json', 'kaarel | lines | comms/spool/kaarel.txt', 'plain | lines | x.txt'])
    expect(sourcesOf('watch_sources:\n- a | hub | b\nmode: gate\n')).toEqual(['a | hub | b'])
    expect(sourcesOf('watch_sources: []\n')).toEqual([])
    expect(sourcesOf('mode: gate\n')).toEqual([])
    expect(confValue(conf, 'watch_retire_step')).toBe('touch .fresh-next, then exit')
    expect(confValue(conf, 'absent')).toBeUndefined()
  })

  test('paths: ~ from the user home, relative from the kit home, absolute as given', () => {
    expect(expandHome('~/spool/k.txt', '/kit', '/home/u')).toBe('/home/u/spool/k.txt')
    expect(expandHome('comms/a.json', '/kit', '/home/u')).toBe('/kit/comms/a.json')
    expect(expandHome('/abs/a.json', '/kit', '/home/u')).toBe('/abs/a.json')
    expect(expandHome('C:\\inbox\\a.json', '/kit', '/home/u')).toBe('C:\\inbox\\a.json')
    expect(expandHome('~/x', '/kit', '')).toBeUndefined()
  })

  test('one * per path segment; never a dotfile (the drain asides)', () => {
    expect(matchSegment('session-*', 'session-9a8b')).toBe(true)
    expect(matchSegment('*.json', 'team-lead.json')).toBe(true)
    expect(matchSegment('*.json', '.drain-1-2.json')).toBe(false)
    expect(matchSegment('*.json', 'team-lead.txt')).toBe(false)
    expect(matchSegment('team-lead.json', 'team-lead.json')).toBe(true)
    expect(matchSegment('a.b', 'aXb')).toBe(false)
  })
})

describe('watch_sources: the flow form too, and never silently empty (kit #14)', () => {
  const BLOCK = ['watch_sources:', '  - "hub mail | hub unread courier | ~/.claude/teams/session-*/inboxes/team-lead.json"', "  - 'kaarel | lines | ~/spool/k.txt'", ''].join('\n')
  const ITEMS = ['hub mail | hub unread courier | ~/.claude/teams/session-*/inboxes/team-lead.json', 'kaarel | lines | ~/spool/k.txt']

  test("mvox's one-line flow list reads as the block form does", () => {
    const flow = `watch_sources: ["${ITEMS[0]}", '${ITEMS[1]}']\n`
    expect(readSources(flow)).toEqual({ declared: true, items: ITEMS })
    expect(readSources(BLOCK)).toEqual({ declared: true, items: ITEMS })
    expect(sourcesOf(flow)).toEqual(sourcesOf(BLOCK))
  })

  test('flow quoting: commas and brackets inside quotes, escapes, plain items, a comment, a trailing comma', () => {
    expect(readSources(`watch_sources: [ "a, b | hub | x[1].json", 'it''s | lines | y.txt', plain | lines | z.txt, ] # three\n`)).toEqual({
      declared: true,
      items: ['a, b | hub | x[1].json', "it's | lines | y.txt", 'plain | lines | z.txt'],
    })
    expect(readSources('watch_sources: ["say \\"hi\\" | lines | a\\\\b.txt"]\n').items).toEqual(['say "hi" | lines | a\\b.txt'])
  })

  test('a flow list over several lines', () => {
    const conf = ['watch_sources: [', `  "${ITEMS[0]}",`, '  # a comment line', `  '${ITEMS[1]}'`, ']', 'mode: gate', ''].join('\n')
    expect(readSources(conf)).toEqual({ declared: true, items: ITEMS })
  })

  test('declared empty on purpose ([]) is no problem; absent is not declared', () => {
    expect(readSources('watch_sources: []\n')).toEqual({ declared: true, items: [] })
    expect(readSources('watch_sources: [ ] # none yet\n')).toEqual({ declared: true, items: [] })
    expect(readSources('mode: gate\n')).toEqual({ declared: false, items: [] })
  })

  test('anything else the watch cannot read says so, never a silent empty list', () => {
    const cases: [string, RegExp][] = [
      ['watch_sources:\nmode: gate\n', /no items/],
      ['watch_sources:\n  -\n', /no items/],
      ['watch_sources: "a | hub | x"\n', /a list/],
      ['watch_sources: ["a | hub | x"\n', /unterminated|closing/],
      ['watch_sources: ["a | hub | x]\n', /unterminated/],
      ['watch_sources: [["a"]]\n', /nested/],
      ['watch_sources: [{a: b}]\n', /nested/],
      ['watch_sources: ["a" "b"]\n', /comma/],
    ]
    for (const [conf, problem] of cases) {
      const read = readSources(conf)
      expect(read.declared, conf).toBe(true)
      expect(read.problem, conf).toMatch(problem)
    }
  })
})

describe('formats', () => {
  test('hub inbox: a JSON list of messages; anything else is junk', () => {
    const text = JSON.stringify([
      { from: 'po-team', text: 'Ping', summary: 'P', timestamp: '2026-10-14T08:00:00Z', type: 'message' },
      { from: 'esl', summary: 'only a summary', timestamp: '2026-10-14T08:01:00Z' },
    ])
    expect(hubItems(text)).toEqual([
      { head: 'from po-team [2026-10-14T08:00:00Z]', body: 'Ping' },
      { head: 'from esl [2026-10-14T08:01:00Z]', body: 'only a summary' },
    ])
    expect(hubItems('[]')).toEqual([])
    expect(hubItems('')).toEqual([])
    expect(hubItems('  \n')).toEqual([])
    for (const junk of ['{', '{"a":1}', '[1]', '[null]']) expect(hubItems(junk), junk).toBeUndefined()
  })

  test('lines: one item per non-blank line', () => {
    expect(lineItems('[kaarel-chat 10:01] hi\n\n  \n[kaarel-session 10:02] LOGGED IN\n')).toEqual([
      { head: '', body: '[kaarel-chat 10:01] hi' },
      { head: '', body: '[kaarel-session 10:02] LOGGED IN' },
    ])
    expect(lineItems('')).toEqual([])
  })

  test('archives: given ({name} is the file stem), else archive/ beside the file', () => {
    expect(archiveFor(undefined, '/c/inboxes/team-lead.json', 'hub')).toBe('/c/inboxes/archive/team-lead-archive.json')
    expect(archiveFor(undefined, '/c/spool/kaarel.txt', 'lines')).toBe('/c/spool/archive/kaarel.txt')
    expect(archiveFor('/home/u/comms/archive/{name}-archive.json', '/t/s-1/inboxes/esl-lead.json', 'hub')).toBe(
      '/home/u/comms/archive/esl-lead-archive.json',
    )
  })

  test('asides: a dotfile beside the source, recognised as its own', () => {
    const aside = asideOf('/c/inboxes/team-lead.json', 1_000, 42)
    expect(aside).toBe('/c/inboxes/.watch-drain-team-lead.json-1000-42')
    expect(isAsideOf('/c/inboxes/team-lead.json', '.watch-drain-team-lead.json-1000-42')).toBe(true)
    expect(isAsideOf('/c/inboxes/team-lead.json', '.watch-drain-team-lead.json.bak-1-2')).toBe(false)
    expect(isAsideOf('/c/inboxes/team-lead.json', '.watch-drain-other.json-1000-42')).toBe(false)
  })
})

describe('pending deliveries', () => {
  test('an archived aside waits as a pending file beside the source', () => {
    const pending = pendingOf('/c/inboxes/.watch-drain-team-lead.json-1000-42')
    expect(pending).toBe('/c/inboxes/.watch-pending-team-lead.json-1000-42')
    expect(isPendingOf('/c/inboxes/team-lead.json', '.watch-pending-team-lead.json-1000-42')).toBe(true)
    expect(isPendingOf('/c/inboxes/team-lead.json', '.watch-drain-team-lead.json-1000-42')).toBe(false)
    expect(isAsideOf('/c/inboxes/team-lead.json', '.watch-pending-team-lead.json-1000-42')).toBe(false)
    expect(pendingEvents('["a","b"]')).toEqual(['a', 'b'])
    expect(pendingEvents('junk')).toEqual([])
  })

  test('backoff after refusals: 1 min, doubling, at most 30 min', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 9].map(n => backoffMs(n) / 60_000)).toEqual([0, 1, 2, 4, 8, 16, 30, 30])
  })
})

describe('events', () => {
  test('short: prefix, head, body', () => {
    expect(formatEvent('hub mail', { head: 'from po [t]', body: 'Ping' }, '/a.json')).toBe('[hub mail] from po [t]: Ping')
    expect(formatEvent('kaarel', { head: '', body: '[kaarel-chat 10:01] hi' }, '/a.txt')).toBe('[kaarel] [kaarel-chat 10:01] hi')
  })

  test(`long: a preview and the archive path, never over ${EVENT_LIMIT} chars`, () => {
    const body = 'x'.repeat(2_000)
    const event = formatEvent('hub mail', { head: 'from po [t]', body }, '/home/u/comms/inboxes/archive/team-lead-archive.json')
    expect(event.length).toBeLessThanOrEqual(EVENT_LIMIT)
    expect(event.startsWith('[hub mail] from po [t] (long: 2000 chars, full text in /home/u/comms/inboxes/archive/team-lead-archive.json): xxx')).toBe(true)
    expect(event.endsWith('…')).toBe(true)
    // Exactly at the limit stays whole; one more goes to preview.
    const fits = 'y'.repeat(EVENT_LIMIT - '[k] '.length)
    expect(formatEvent('k', { head: '', body: fits }, '/a')).toBe(`[k] ${fits}`)
    expect(formatEvent('k', { head: '', body: `${fits}y` }, '/a')).toMatch(/^\[k\] \(long: \d+ chars, full text in \/a\): y+…$/)
    // Code points, not UTF-16 units: an emoji is never cut in half.
    const emoji = formatEvent('k', { head: '', body: '😀'.repeat(600) }, '/a')
    expect(Array.from(emoji).length).toBeLessThanOrEqual(EVENT_LIMIT)
    expect(emoji).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/)
  })

  test('a human prompt: typed, through Remote Control, or a Slack ping; nothing else', () => {
    expect(isHuman({ kind: 'composer' })).toBe(true)
    expect(isHuman({ kind: 'bridge' })).toBe(true)
    expect(isHuman({ kind: 'slack-ping' })).toBe(true)
    for (const kind of ['plugin', 'peer', 'peer-send-message', 'task-notification', 'scheduled-trigger', 'unclassified', 'sdk'])
      expect(isHuman({ kind } as never), kind).toBe(false)
  })
})

describe('retire decision (the five guards)', () => {
  const NOW = Date.parse('2026-10-14T12:00:00Z')
  const MIN = 60_000
  const cfg = { idleMs: 50 * MIN, growthFraction: 0.5 }
  /** Every condition met: idle 60 min, grown 600k of 1M since the baseline, a human seen, no brake. */
  const ready: RetireInput = {
    now: NOW,
    idleSince: NOW - 60 * MIN,
    humanSeen: true,
    baseline: 100_000,
    tokens: 700_000,
    window: 1_000_000,
    askedAt: undefined,
    survivedNotified: false,
    stoppedUntil: 0,
    asks: [],
  }

  test('all conditions met: ask', () => {
    expect(decideRetire(cfg, ready)).toBe('ask')
  })

  test('guard 1: no human input since start, never', () => {
    expect(decideRetire(cfg, { ...ready, humanSeen: false })).toBe('none')
  })

  test('guard 2: growth since the start counts, not size', () => {
    // A fresh session whose startup alone read 70%: the baseline is that reading, growth 0.
    expect(decideRetire(cfg, { ...ready, baseline: 700_000, tokens: 700_000 })).toBe('none')
    expect(decideRetire(cfg, { ...ready, baseline: 700_000, tokens: 1_000_000 })).toBe('none')
    expect(decideRetire(cfg, { ...ready, baseline: 0, tokens: 499_999 })).toBe('none')
    expect(decideRetire(cfg, { ...ready, baseline: 0, tokens: 500_000 })).toBe('ask')
    // No reading yet, or a compaction that shrank the context: nothing.
    expect(decideRetire(cfg, { ...ready, tokens: undefined })).toBe('none')
    expect(decideRetire(cfg, { ...ready, tokens: 50_000 })).toBe('none')
  })

  test('not idle long enough: nothing', () => {
    expect(decideRetire(cfg, { ...ready, idleSince: NOW - 50 * MIN + 1 })).toBe('none')
    expect(decideRetire(cfg, { ...ready, idleSince: NOW - 50 * MIN })).toBe('ask')
  })

  test('guard 3: one ask per session; still here an hour later, one notice', () => {
    const asked = { ...ready, askedAt: NOW - 10 * MIN }
    expect(decideRetire(cfg, asked)).toBe('none')
    expect(decideRetire(cfg, { ...asked, askedAt: NOW - SURVIVE_MS })).toBe('survived')
    expect(decideRetire(cfg, { ...asked, askedAt: NOW - SURVIVE_MS, survivedNotified: true })).toBe('none')
    expect(decideRetire(cfg, { ...asked, askedAt: NOW - 30 * HOUR, survivedNotified: true })).toBe('none')
  })

  test('guard 4: no retire within 2 h of the last, at most 4 in 24 h', () => {
    expect(brake([], NOW)).toEqual({ ok: true })
    expect(brake([NOW - 2 * HOUR + 1], NOW)).toEqual({ ok: false, reason: 'a retire less than 2 h ago' })
    expect(brake([NOW - 2 * HOUR], NOW)).toEqual({ ok: true })
    const four = [NOW - 20 * HOUR, NOW - 15 * HOUR, NOW - 10 * HOUR, NOW - 5 * HOUR]
    expect(brake(four, NOW)).toEqual({ ok: false, reason: '4 retires in 24 h' })
    expect(brake([NOW - 25 * HOUR, ...four.slice(1)], NOW)).toEqual({ ok: true })
    expect(decideRetire(cfg, { ...ready, asks: [NOW - HOUR] })).toBe('brake')
    expect(decideRetire(cfg, { ...ready, asks: four })).toBe('brake')
  })

  test('guard 5: stopped after the brake tripped, until the day is over', () => {
    expect(decideRetire(cfg, { ...ready, stoppedUntil: NOW + 1 })).toBe('none')
    expect(decideRetire(cfg, { ...ready, stoppedUntil: NOW })).toBe('ask')
  })

  test('three relaunches within 2 h: at most one ask', () => {
    // Each relaunch is a new session; only the store's ask list is shared.
    const asks: number[] = []
    const outcomes = [0, 40, 80].map(minutes => {
      const now = NOW + minutes * MIN
      const outcome = decideRetire(cfg, { ...ready, now, idleSince: now - 60 * MIN, asks })
      if (outcome === 'ask') asks.push(now)
      return outcome
    })
    expect(outcomes).toEqual(['ask', 'brake', 'brake'])
  })

  test('the prompt names the close routine, the home retire step, and the open question', () => {
    const text = retirePrompt('touch .fresh-next, then exit', 52, 61)
    expect(text).toContain('idle for 52 min')
    expect(text).toContain('61%')
    expect(text).toContain('scratchpad')
    expect(text).toContain('touch .fresh-next, then exit')
    expect(text).toMatch(/exact wording/)
    expect(text.length).toBeLessThanOrEqual(EVENT_LIMIT * 2)
  })
})

describe('platform: the four file operations (kit alpha.9)', () => {
  const decode = (b64: string) => {
    const bin = atob(b64)
    let out = ''
    for (let i = 0; i + 1 < bin.length; i += 2) out += String.fromCharCode(bin.charCodeAt(i) | (bin.charCodeAt(i + 1) << 8))
    return out
  }
  const script = (argv: string[]) => {
    expect(argv.slice(0, 4)).toEqual(['powershell.exe', '-NoProfile', '-NonInteractive', '-EncodedCommand'])
    expect(argv).toHaveLength(5)
    return decode(argv[4] ?? '')
  }
  const from = '/c/My Inbox [team]/.watch-drain-team-lead.json-1-2'
  const to = "/c/My Inbox [team]/O'Brien's lead.json"

  test('POSIX: mv, mv -n, mv -f, rm -f, each with -- before the paths', () => {
    expect(fileOpArgv('posix', { op: 'move', from, to })).toEqual(['mv', '--', from, to])
    expect(fileOpArgv('posix', { op: 'move-keep', from, to })).toEqual(['mv', '-n', '--', from, to])
    expect(fileOpArgv('posix', { op: 'move-replace', from, to })).toEqual(['mv', '-f', '--', from, to])
    expect(fileOpArgv('posix', { op: 'remove', path: from })).toEqual(['rm', '-f', '--', from])
  })

  test('Windows: Move-Item (fails on an existing target), -Force to replace, Remove-Item quietly; -LiteralPath', () => {
    const q = (p: string) => psQuote(p)
    expect(script(fileOpArgv('windows', { op: 'move', from, to }))).toBe(
      `$ErrorActionPreference = 'Stop'; Move-Item -LiteralPath ${q(from)} -Destination ${q(to)}`,
    )
    // No-clobber put-back: plain Move-Item refuses an existing target, which is the point.
    expect(script(fileOpArgv('windows', { op: 'move-keep', from, to }))).toBe(
      `$ErrorActionPreference = 'Stop'; Move-Item -LiteralPath ${q(from)} -Destination ${q(to)}`,
    )
    expect(script(fileOpArgv('windows', { op: 'move-replace', from, to }))).toBe(
      `$ErrorActionPreference = 'Stop'; Move-Item -LiteralPath ${q(from)} -Destination ${q(to)} -Force`,
    )
    // Under Stop a missing file fails even with -ErrorAction SilentlyContinue (kit #11): test first.
    expect(script(fileOpArgv('windows', { op: 'remove', path: from }))).toBe(
      `$ErrorActionPreference = 'Stop'; if (Test-Path -LiteralPath ${q(from)}) { Remove-Item -LiteralPath ${q(from)} -Force }`,
    )
  })

  test("PowerShell quoting: single quotes, every quote PowerShell reads as one doubled; [ ] and $ stay literal", () => {
    expect(psQuote("C:\\Users\\m\\My Inbox [team]\\a$b.json")).toBe("'C:\\Users\\m\\My Inbox [team]\\a$b.json'")
    expect(psQuote("O'Brien")).toBe("'O''Brien'")
    expect(psQuote('it\u2019s \u2018x\u2019 \u201a \u201b')).toBe("'it\u2019\u2019s \u2018\u2018x\u2019\u2019 \u201a\u201a \u201b\u201b'")
  })

  test('the script travels as UTF-16LE base64 (-EncodedCommand): no command-line quoting at all', () => {
    expect(base64Utf16le('a')).toBe('YQA=')
    expect(base64Utf16le('Wõ€')).toBe(btoa('W\0\xf5\0\xac\x20'))
    expect(decode(base64Utf16le("Move-Item 'ä [x]'"))).toBe("Move-Item 'ä [x]'")
  })

  test('detection: a drive-letter or UNC home is Windows; otherwise the probe decides', () => {
    expect(platformOfHome('C:\\Users\\m\\kit')).toBe('windows')
    expect(platformOfHome('d:/kit')).toBe('windows')
    expect(platformOfHome('\\\\server\\share\\kit')).toBe('windows')
    expect(platformOfHome('/home/m/kit')).toBeUndefined()
    expect(PROBE_ARGV).toEqual(['uname', '-s'])
  })

  test('glob segments split on either separator, a drive kept whole', () => {
    expect(pathSegments('/home/u/.claude/teams/session-*/inboxes/a.json')).toEqual(['', 'home', 'u', '.claude', 'teams', 'session-*', 'inboxes', 'a.json'])
    expect(pathSegments('C:\\Users\\m\\.claude\\teams\\session-*\\inboxes\\a.json')).toEqual(['C:', 'Users', 'm', '.claude', 'teams', 'session-*', 'inboxes', 'a.json'])
  })
})

describe('a shared inbox: take only courier mail, unread (kit #12)', () => {
  test('modifiers after the hub format: unread, courier, both', () => {
    expect(parseSource('hub mail | hub unread courier | ~/.claude/teams/session-*/inboxes/team-lead.json')).toEqual({
      prefix: 'hub mail',
      format: 'hub',
      path: '~/.claude/teams/session-*/inboxes/team-lead.json',
      take: { unread: true, courier: true },
    })
    expect(parseSource('h | hub courier | a.json')).toEqual({ prefix: 'h', format: 'hub', path: 'a.json', take: { unread: false, courier: true } })
    expect(parseSource('h | hub  unread | a.json')).toEqual({ prefix: 'h', format: 'hub', path: 'a.json', take: { unread: true, courier: false } })
    // A plain hub source drains the whole file, as before.
    expect(parseSource('h | hub | a.json')).toEqual({ prefix: 'h', format: 'hub', path: 'a.json' })
    expect(parseSource('h | hub unread unread | a.json')).toMatch(/twice/)
    expect(parseSource('h | hub everything | a.json')).toMatch(/unknown/)
    expect(parseSource('h | lines courier | a.txt')).toMatch(/only to a hub/)
  })

  test('which entries a source takes', () => {
    const entries = [
      { from: 'mate', text: 'teammate, delivered', read: true },
      { from: 'mate', text: 'teammate, not yet delivered', read: false },
      { from: 'hub-courier', text: 'hub mail', read: false },
      { from: 'company-courier', text: 'hub mail, no read field' },
      { from: 'hub-courier', text: 'hub mail the harness delivered', read: true },
      { from: 'courier', text: 'not a -courier suffix' },
      'not an object',
    ]
    expect(entries.map(e => takes({ unread: true, courier: true }, e))).toEqual([false, false, true, true, false, false, false])
    expect(entries.map(e => takes({ unread: false, courier: true }, e))).toEqual([false, false, true, true, true, false, false])
    expect(entries.map(e => takes({ unread: true, courier: false }, e))).toEqual([false, true, true, true, false, true, false])
  })

  test('an entry is known by its msg_id, else by its content', () => {
    expect(entryKey({ msg_id: 'm1', text: 'a' })).toBe('id:m1')
    expect(entryKey({ from: 'hub-courier', text: 'a', timestamp: 't' })).toBe(entryKey({ from: 'hub-courier', text: 'a', timestamp: 't' }))
    expect(entryKey({ from: 'hub-courier', text: 'a', timestamp: 't' })).not.toBe(entryKey({ from: 'hub-courier', text: 'b', timestamp: 't' }))
  })

  test('the harness gets 30 s to take courier mail itself; a lock older than 60 s is stale', () => {
    expect(COURIER_GRACE_MS).toBe(30_000)
    expect(STALE_LOCK_MS).toBe(60_000)
  })

  test("the harness's lock: mkdir / rm -d -f; on Windows New-Item / a guarded Remove-Item", () => {
    const lock = '/c/My Inbox [x]/team-lead.json.lock'
    expect(fileOpArgv('posix', { op: 'lock', path: lock })).toEqual(['mkdir', '--', lock])
    // rm -d -f: the empty lock directory, and quiet when it is already gone (rmdir is not).
    expect(fileOpArgv('posix', { op: 'unlock', path: lock })).toEqual(['rm', '-d', '-f', '--', lock])
    const decode = (argv: string[]) => {
      const bin = atob(argv[argv.length - 1] ?? '')
      let out = ''
      for (let i = 0; i + 1 < bin.length; i += 2) out += String.fromCharCode(bin.charCodeAt(i) | (bin.charCodeAt(i + 1) << 8))
      return out
    }
    expect(decode(fileOpArgv('windows', { op: 'lock', path: lock }))).toBe(
      `$ErrorActionPreference = 'Stop'; New-Item -ItemType Directory -Path ${psQuote(lock)} | Out-Null`,
    )
    expect(decode(fileOpArgv('windows', { op: 'unlock', path: lock }))).toBe(
      `$ErrorActionPreference = 'Stop'; if (Test-Path -LiteralPath ${psQuote(lock)}) { Remove-Item -LiteralPath ${psQuote(lock)} -Force }`,
    )
  })
})

describe('one prompt per poll (kit #17)', () => {
  test('a single item goes as it is; several go as one prompt, one per line, under a count', () => {
    expect(batchPrompt(['[lelle] from=a id=1 subject=x'])).toBe('[lelle] from=a id=1 subject=x')
    expect(batchPrompt(['[lelle] one', '[hub mail] from po [t]: two', '[lelle] three'])).toBe(
      '[watch] 3 items, oldest first:\n[lelle] one\n[hub mail] from po [t]: two\n[lelle] three',
    )
  })

  test('a batch is bounded: each line under the event limit, at most BATCH_MAX lines', () => {
    expect(BATCH_MAX).toBe(20)
    expect(EVENT_LIMIT * BATCH_MAX).toBeLessThanOrEqual(10_000)
  })
})

describe('one drain per home (kit #17)', () => {
  test('paths compare with either separator, . and .. resolved, no trailing slash', () => {
    expect(normalPath('/home/u/kit/../desk/')).toBe('/home/u/desk')
    expect(normalPath('/home/u/./desk')).toBe('/home/u/desk')
    expect(normalPath('C:\\Users\\m\\desk\\')).toBe('C:/Users/m/desk')
    expect(normalPath('/')).toBe('/')
  })

  test('inside the home: the home itself or below it; a sibling with the same prefix is not', () => {
    expect(isInside('/home/u/desk', '/home/u/desk')).toBe(true)
    expect(isInside('/home/u/desk/sub', '/home/u/desk/')).toBe(true)
    expect(isInside('/home/u/desk-two', '/home/u/desk')).toBe(false)
    expect(isInside('/home/u', '/home/u/desk')).toBe(false)
    expect(isInside('/home/u/kit', '/home/u/kit/../desk')).toBe(false)
    expect(isInside('/home/u/desk/x', '/')).toBe(true)
    // A drive-letter path is Windows: no case.
    expect(isInside('c:\\users\\M\\Desk\\x', 'C:/Users/m/desk')).toBe(true)
  })

  const NOW = 1_000_000_000
  test('one store key per home, the path normalised', () => {
    expect(claimKey('/home/u/kit/')).toBe('drain:/home/u/kit')
    expect(claimKey('/home/u/x/../kit')).toBe('drain:/home/u/kit')
  })

  test('no claim, a stale claim, or our own: this session drains', () => {
    expect(claimDecision(undefined, 'me', NOW, CLAIM_STALE_MS)).toEqual({ drain: true })
    expect(claimDecision('junk', 'me', NOW, CLAIM_STALE_MS)).toEqual({ drain: true })
    expect(claimDecision({ session: 'other', cwd: '/o', at: NOW - CLAIM_STALE_MS - 1 }, 'me', NOW, CLAIM_STALE_MS)).toEqual({ drain: true })
    expect(claimDecision({ session: 'me', cwd: '/h', at: NOW - 5 }, 'me', NOW, CLAIM_STALE_MS)).toEqual({ drain: true })
  })

  test("another session's fresh claim: this one does not drain, and is told who does", () => {
    const holder = { session: 'other', cwd: '/h/sub', at: NOW - 10_000 }
    expect(claimDecision(holder, 'me', NOW, CLAIM_STALE_MS)).toEqual({ drain: false, holder })
  })
})
