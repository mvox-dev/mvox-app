import { describe, expect, test } from 'claude-code/testing'

import {
  bellLabel,
  combineRings,
  confContextPercent,
  confIdleMinutes,
  confValue,
  contextReport,
  expandHome,
  idleReport,
  isHuman,
  isInside,
  marksCrossed,
  matchSegment,
  normalPath,
  pathSegments,
  readDoorbells,
  ringText,
} from '../hooks/watch'
import type { Doorbell } from '../hooks/watch'

const BELL: Doorbell = { label: '', path: 'comms/inboxes/team-lead.json', instruction: '', inject: false }

describe('readDoorbells: the watch_files block list', () => {
  const CONF = [
    'memory_dir: memory',
    'watch_files:',
    '  - label: ""',
    '    path: comms/inboxes/team-lead.json',
    '    instruction: "consume the inbox or new messages won\'t land"',
    '    inject: false',
    '  - label: gh-links',
    '    path: ~/spool/links.txt',
    '    instruction: ""',
    '    inject: true',
    'watch_idle_minutes: 50',
    '',
  ].join('\n')

  test('two full entries, every field read, quotes stripped', () => {
    expect(readDoorbells(CONF)).toEqual({
      declared: true,
      problems: [],
      bells: [
        { label: '', path: 'comms/inboxes/team-lead.json', instruction: "consume the inbox or new messages won't land", inject: false },
        { label: 'gh-links', path: '~/spool/links.txt', instruction: '', inject: true },
      ],
    })
  })

  test('not declared', () => {
    expect(readDoorbells('memory_dir: memory\n')).toEqual({ declared: false, bells: [], problems: [] })
  })

  test('empty fields mean their defaults; missing fields do too', () => {
    const read = readDoorbells('watch_files:\n  - path: a.txt\n')
    expect(read.bells).toEqual([{ label: '', path: 'a.txt', instruction: '', inject: false }])
    expect(read.problems).toEqual([])
  })

  test('entries at column 0 with keys in any order (as yaml.safe_dump writes them)', () => {
    const read = readDoorbells('watch_files:\n- inject: true\n  instruction: look\n  label: x\n  path: a.txt\n- path: b.txt\n')
    expect(read.bells).toEqual([
      { label: 'x', path: 'a.txt', instruction: 'look', inject: true },
      { label: '', path: 'b.txt', instruction: '', inject: false },
    ])
  })

  test('an entry with no path is a problem; the others still count', () => {
    const read = readDoorbells('watch_files:\n  - label: a\n  - path: b.txt\n')
    expect(read.bells).toEqual([{ label: '', path: 'b.txt', instruction: '', inject: false }])
    expect(read.problems).toEqual(['entry 1: no path'])
  })

  test('inject must be true or false', () => {
    const read = readDoorbells('watch_files:\n  - path: a.txt\n    inject: yes\n')
    expect(read.bells).toEqual([])
    expect(read.problems).toEqual(['entry 1: inject must be true or false, not "yes"'])
  })

  test('an unknown field names itself and skips its entry, not the list', () => {
    const read = readDoorbells('watch_files:\n  - path: a.txt\n    archive: b\n  - path: c.txt\n')
    expect(read.bells).toEqual([{ label: '', path: 'c.txt', instruction: '', inject: false }])
    expect(read.problems).toEqual(['unknown field "archive" (label, path, instruction, inject)'])
  })

  test('a field given twice in one entry is a problem', () => {
    const read = readDoorbells('watch_files:\n  - path: a.txt\n    path: b.txt\n')
    expect(read.bells).toEqual([])
    expect(read.problems).toEqual(['field "path" given twice in one entry'])
  })

  test('a field with no entry above it (missing "- ") is a problem', () => {
    const read = readDoorbells('watch_files:\n    path: a.txt\n')
    expect(read.bells).toEqual([])
    expect(read.problems).toEqual(['a field outside any entry (missing "- "?): path: a.txt'])
  })

  test('an inline value is a problem, never silently off', () => {
    expect(readDoorbells('watch_files: a.txt\n').problems).toEqual([
      'expected a block list of entries ("- label: ..." lines), not an inline value',
    ])
  })

  test('declared with nothing under it is a problem', () => {
    expect(readDoorbells('watch_files:\n').problems).toEqual(['no entries under it'])
  })

  test('comments and blank lines are skipped; the next conf key ends the list', () => {
    const read = readDoorbells('watch_files:\n  # the inbox\n\n  - path: a.txt\nwatch_idle_minutes: 50\n')
    expect(read.bells).toEqual([{ label: '', path: 'a.txt', instruction: '', inject: false }])
  })
})

describe('rings', () => {
  test('the label: its own, else the file name', () => {
    expect(bellLabel({ ...BELL, label: 'hub mail' }, '/x/team-lead.json')).toBe('hub mail')
    expect(bellLabel(BELL, '/x/team-lead.json')).toBe('team-lead.json')
  })

  test('the plain bell: file, growth, the home instruction verbatim', () => {
    const bell = { ...BELL, instruction: "consume the inbox or new messages won't land" }
    expect(ringText(bell, '/x/team-lead.json', 2, '[]ab')).toBe(
      "[team-lead.json] /x/team-lead.json grew. consume the inbox or new messages won't land",
    )
  })

  test('no instruction: just the bell', () => {
    expect(ringText(BELL, '/x/a.txt', 0, 'hi')).toBe('[a.txt] /x/a.txt grew.')
  })

  test('inject: the grown tail rides along, non-blank lines only', () => {
    const bell = { ...BELL, label: 'gh-links', inject: true }
    expect(ringText(bell, '/x/links.txt', 8, 'one url\ntwo url\n\nthree url\n')).toBe(
      '[gh-links] /x/links.txt grew.\ntwo url\nthree url',
    )
  })

  test('one ring goes as it is; several under a count', () => {
    expect(combineRings(['[a] /a grew.'])).toBe('[a] /a grew.')
    expect(combineRings(['[a] /a grew.', '[b] /b grew.'])).toBe('[watch] 2 doorbells:\n[a] /a grew.\n[b] /b grew.')
  })
})

describe('conf values and session sensor numbers', () => {
  test('confValue: unquoted, comments stripped, absent is undefined', () => {
    expect(confValue('watch_retire_step: "touch .fresh-next"  # then exit\n', 'watch_retire_step')).toBe('touch .fresh-next')
    expect(confValue('other: x\n', 'watch_retire_step')).toBeUndefined()
  })

  test('watch_idle_minutes: one whole number', () => {
    expect(confIdleMinutes('watch_idle_minutes: 50\n')).toEqual({ declared: true, values: [50] })
    expect(confIdleMinutes('memory_dir: m\n')).toEqual({ declared: false, values: [] })
    expect(confIdleMinutes('watch_idle_minutes: 50, 60\n').problem).toBe('one value expected: "50, 60"')
    expect(confIdleMinutes('watch_idle_minutes: soon\n').problem).toBe('not a list of whole numbers >= 1: "soon"')
    expect(confIdleMinutes('watch_idle_minutes: 0\n').problem).toBe('not a list of whole numbers >= 1: "0"')
  })

  test('watch_context_percent: 1-99, sorted', () => {
    expect(confContextPercent('watch_context_percent: 70, 50, 60\n')).toEqual({ declared: true, values: [50, 60, 70] })
    expect(confContextPercent('watch_context_percent: 50, 110\n').problem).toBe('marks are percent of the window: 1-99')
  })

  test('marksCrossed: at or below the load, not yet reported, nothing without a reading', () => {
    expect(marksCrossed([50, 60, 70], [], 650_000, 1_000_000)).toEqual([50, 60])
    expect(marksCrossed([50, 60, 70], [50], 650_000, 1_000_000)).toEqual([60])
    expect(marksCrossed([50], [], undefined, 1_000_000)).toEqual([])
    expect(marksCrossed([50], [], 500_000, 0)).toEqual([])
    expect(marksCrossed([50], [], 500_000, 1_000_000)).toEqual([50])
  })

  test('the reports say information only, and quote the home where it spoke', () => {
    expect(contextReport(60, 650_000, 1_000_000)).toBe(
      '[watch] Context has reached 65% of the window (650,000 of 1,000,000 tokens), past the 60% mark declared in memory-kit.conf. ' +
        "This is information only; what to do at this level is this home's own rule.",
    )
    expect(idleReport(52, undefined)).toBe(
      '[watch] This session has been idle for 52 min (the watch_idle_minutes mark in memory-kit.conf). ' +
        "This is information only; what idleness means here is this home's own rule.",
    )
    expect(idleReport(52, 'touch .fresh-next, then exit')).toContain(
      "The home's declared step for this (watch_retire_step): touch .fresh-next, then exit.",
    )
  })
})

describe('paths', () => {
  test('expandHome: ~, absolute, relative to the kit home', () => {
    expect(expandHome('~/spool/a.txt', '/kit', '/home/u')).toBe('/home/u/spool/a.txt')
    expect(expandHome('~/a', '/kit', '')).toBeUndefined()
    expect(expandHome('/abs/a', '/kit', '/home/u')).toBe('/abs/a')
    expect(expandHome('C:/x/a', '/kit', '/home/u')).toBe('C:/x/a')
    expect(expandHome('rel/a', '/kit', '/home/u')).toBe('/kit/rel/a')
  })

  test('matchSegment: * wildcards, dotfiles never', () => {
    expect(matchSegment('session-*', 'session-abc')).toBe(true)
    expect(matchSegment('session-*', 'other')).toBe(false)
    expect(matchSegment('*', '.hidden')).toBe(false)
    expect(matchSegment('plain', 'plain')).toBe(true)
  })

  test('pathSegments and normalPath', () => {
    expect(pathSegments('/a/b')).toEqual(['', 'a', 'b'])
    expect(normalPath('/a/./b/../c/')).toBe('/a/c')
  })

  test('isInside', () => {
    expect(isInside('/home/u/kit/sub', '/home/u/kit')).toBe(true)
    expect(isInside('/home/u/kit', '/home/u/kit')).toBe(true)
    expect(isInside('/home/u/other', '/home/u/kit')).toBe(false)
    expect(isInside('C:\\Kit\\Sub', 'c:/kit')).toBe(true)
  })
})

describe('isHuman', () => {
  test('composer, bridge and slack-ping are the human; a plugin is not', () => {
    expect(isHuman({ kind: 'composer' })).toBe(true)
    expect(isHuman({ kind: 'bridge' } as never)).toBe(true)
    expect(isHuman({ kind: 'slack-ping' } as never)).toBe(true)
    expect(isHuman({ kind: 'plugin' } as never)).toBe(false)
  })
})
