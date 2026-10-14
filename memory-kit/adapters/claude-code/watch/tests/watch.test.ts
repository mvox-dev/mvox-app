import { describe, expect, test } from 'claude-code/testing'

import {
  archiveFor,
  asideOf,
  backoffMs,
  brake,
  confValue,
  decideRetire,
  EVENT_LIMIT,
  expandHome,
  formatEvent,
  HOUR,
  hubItems,
  isAsideOf,
  isHuman,
  isPendingOf,
  lineItems,
  matchSegment,
  parseSource,
  pendingEvents,
  pendingOf,
  retirePrompt,
  sourcesOf,
  SURVIVE_MS,
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
