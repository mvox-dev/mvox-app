import { describe, expect, test } from 'claude-code/testing'

import {
  ACTOR_PALETTE,
  actorColor,
  addDays,
  clampIndex,
  contextLoad,
  contextWeight,
  countsLabel,
  countsOf,
  fitActor,
  fitName,
  fitWeight,
  isoDate,
  isoMinute,
  LINK_FG,
  memoryDirOf,
  MIHKEL_COLOR,
  modelLetter,
  offsetFromZ,
  parseObligations,
  recordStep,
  segmentsOf,
  sortByExpires,
  statusOf,
  step,
  subagentWeight,
  trailingLinksOf,
  urlNamesOf,
  urlOfFile,
  wheelStep,
} from '../hooks/obligations'
import type { ObligationRow } from '../types'
import { WORKSHOP_YAML } from './fixtures/data'

const row = (expires: string, extra: Partial<ObligationRow> = {}): ObligationRow => ({
  obligation: `due ${expires}`,
  actor: 'Mihkel',
  since: '2026-10-01',
  check: '',
  expires,
  ref: '',
  line: 1,
  ...extra,
})

describe('parsing', () => {
  test('the workshop ledger parses whole', () => {
    const parsed = parseObligations(WORKSHOP_YAML)
    expect(parsed.kind).toBe('ok')
    if (parsed.kind !== 'ok') return
    expect(parsed.items).toHaveLength(6)
    const prusa = parsed.items.find(i => i.actor.startsWith('Prusa'))
    expect(prusa?.ref).toBe('urls/prusa-start-ooze-issue')
    expect(prusa?.expires).toBe('2026-12-31')
    // A double-quoted escape: \\[ is a backslash and a bracket.
    expect(parsed.items[1]?.check).toContain("grep -c '\\[ \\]'")
    // Items remember the line their "- " is on.
    expect(parsed.items[0]?.line).toBe(8)
  })

  test('quoting: double, single, plain with a comment, quoted #ref', () => {
    const parsed = parseObligations(
      [
        'obligations:',
        '  - obligation: "Say \\"hi\\""',
        "    actor: 'O''Brien'",
        '    since: 2026-10-01 # began',
        '    check:',
        '    expires: 2026-10-20',
        '    ref: "#2"',
      ].join('\n'),
    )
    expect(parsed).toEqual({
      kind: 'ok',
      items: [{ obligation: 'Say "hi"', actor: "O'Brien", since: '2026-10-01', check: '', expires: '2026-10-20', ref: '#2', line: 2 }],
    })
  })

  test('empty list and comment-only file are empty, not errors', () => {
    expect(parseObligations('# nothing yet\nobligations: []\n')).toEqual({ kind: 'ok', items: [] })
    expect(parseObligations('obligations:\n')).toEqual({ kind: 'ok', items: [] })
    expect(parseObligations('# only comments\n\n')).toEqual({ kind: 'ok', items: [] })
    expect(parseObligations('')).toEqual({ kind: 'ok', items: [] })
  })

  test('malformed files are errors with a line', () => {
    const cases: [string, number, RegExp][] = [
      ['facts:\n  - a: b', 1, /unknown top-level key/],
      ['obligations:\n  - obligation: "x\n', 2, /unterminated/],
      ['obligations:\n  - obligation: x\n    actor: y\n    expires: soon', 2, /ISO date/],
      ['obligations:\n  - obligation: x\n    actor: y', 2, /missing "expires"/],
      ['obligations:\n  - obligation: x\n    owner: y', 3, /unknown key "owner"/],
      ['obligations:\n  - obligation: x\n    obligation: y', 3, /duplicate key/],
      ['obligations:\n  - obligation: |\n      long', 2, /block scalars/],
      ['obligations:\n  - obligation: x\n      actor: y', 3, /inconsistent indent/],
      ['obligations:\n  actor: y', 2, /expected a list item/],
      ['obligations: nope', 1, /must be a list/],
      ['obligations:\n\t- obligation: x', 2, /tab/],
    ]
    for (const [text, line, message] of cases) {
      const parsed = parseObligations(text)
      expect(parsed.kind, text).toBe('error')
      if (parsed.kind === 'error') {
        expect(parsed.line, text).toBe(line)
        expect(parsed.message, text).toMatch(message)
      }
    }
  })

  test('memory_dir from memory-kit.conf', () => {
    expect(memoryDirOf('# c\nmemory_dir: memory\nmode: gate\n')).toBe('memory')
    expect(memoryDirOf('memory_dir: "notes" # here\n')).toBe('notes')
    expect(memoryDirOf('mode: gate\n')).toBeUndefined()
  })
})

describe('ordering and counts', () => {
  test('soonest expiry first, ties by since then file order', () => {
    const sorted = sortByExpires([
      row('2026-10-28', { line: 10 }),
      row('2026-10-12', { line: 20 }),
      row('2026-10-28', { line: 5, since: '2026-09-01' }),
      row('2026-10-28', { line: 3 }),
    ])
    expect(sorted.map(r => `${r.expires}@${r.line}`)).toEqual(['2026-10-12@20', '2026-10-28@5', '2026-10-28@3', '2026-10-28@10'])
  })

  test('expired and due within 7 days, relative to the injected day', () => {
    const today = '2026-10-14'
    expect(statusOf(row('2026-10-13'), today)).toBe('expired')
    expect(statusOf(row('2026-10-14'), today)).toBe('due')
    expect(statusOf(row('2026-10-21'), today)).toBe('due')
    expect(statusOf(row('2026-10-22'), today)).toBe('later')
    const items = ['2026-09-30', '2026-10-13', '2026-10-14', '2026-10-21', '2026-10-28'].map(d => row(d))
    expect(countsOf(items, today)).toEqual({ expired: 2, due: 2 })
    expect(countsOf(items, '2026-10-29')).toEqual({ expired: 5, due: 0 })
    expect(countsLabel({ expired: 2, due: 5 })).toBe('2 expired · 5 due ≤7d')
  })

  test('dates at a UTC offset, across midnight and month ends', () => {
    const t = Date.parse('2026-10-14T22:30:00Z')
    expect(isoDate(t, 0)).toBe('2026-10-14')
    expect(isoDate(t, 180)).toBe('2026-10-15')
    expect(isoMinute(t, 180)).toBe('2026-10-15 01:30')
    expect(addDays('2026-10-28', 7)).toBe('2026-11-04')
    expect(offsetFromZ('+0300\n')).toBe(180)
    expect(offsetFromZ('-0530')).toBe(-330)
    expect(offsetFromZ('UTC')).toBeUndefined()
  })
})

describe('scroll index', () => {
  test('stays within the list', () => {
    expect(clampIndex(5, 3)).toBe(2)
    expect(clampIndex(-1, 3)).toBe(0)
    expect(clampIndex(4, 0)).toBe(0)
    expect(clampIndex(Number.NaN, 3)).toBe(0)
    expect(step(0, -1, 3)).toBe(0)
    expect(step(0, 1, 3)).toBe(1)
    expect(step(2, 1, 3)).toBe(2)
    // A list that shrank under a stale index steps from the clamped position.
    expect(step(9, -1, 3)).toBe(1)
  })
})

describe('wheel step', () => {
  test('one item per event by sign, then 150 ms ignored', () => {
    expect(wheelStep(3, 1_000, undefined)).toEqual({ delta: 1, lastStep: 1_000 })
    expect(wheelStep(-7, 1_000, undefined)).toEqual({ delta: -1, lastStep: 1_000 })
    expect(wheelStep(1, 1_050, 1_000)).toEqual({ delta: 0, lastStep: 1_000 })
    expect(wheelStep(1, 1_149, 1_000)).toEqual({ delta: 0, lastStep: 1_000 })
    expect(wheelStep(1, 1_150, 1_000)).toEqual({ delta: 1, lastStep: 1_150 })
    expect(wheelStep(0, 5_000, 1_000)).toEqual({ delta: 0, lastStep: 1_000 })
    expect(wheelStep(1, 500, 1_000)).toEqual({ delta: 1, lastStep: 500 })
  })
})

describe('footer columns', () => {
  test('names: 10 columns, 9 + ellipsis when longer, padded when shorter', () => {
    expect(fitName('workshop')).toBe('workshop  ')
    expect(fitName('obligation')).toBe('obligation')
    expect(fitName('passepartout')).toBe('passepart…')
    expect(fitName('')).toBe('          ')
    expect(Array.from(fitName('Põhjamaa-õhtu'))).toHaveLength(10)
    expect(fitName('Põhjamaa-õhtu')).toBe('Põhjamaa-…')
  })

  test('actors: 20 columns, 19 + ellipsis when longer, never padded', () => {
    expect(fitActor('Mihkel')).toBe('Mihkel')
    expect(fitActor('workshop (3d-a1)')).toBe('workshop (3d-a1)')
    expect(fitActor('Prusa (prusa3d/PrusaSlicer-settings-prusa-fff maintainers)')).toBe('Prusa (prusa3d/Prus…')
    expect(Array.from(fitActor('EAÜ (Siim Jõgioja) ja teised'))).toHaveLength(20)
    expect(fitActor('12345678901234567890')).toBe('12345678901234567890')
  })

  test('model letters', () => {
    expect(modelLetter('claude-fable-5-1')).toBe('F')
    expect(modelLetter('Opus 5.5')).toBe('O')
    expect(modelLetter('sonnet')).toBe('S')
    expect(modelLetter('claude-haiku-5-5')).toBe('H')
    expect(modelLetter('gpt-x')).toBe('·')
    expect(modelLetter(undefined)).toBe('·')
  })

  test('footer figure: whole when the line fits, /window dropped when not, never cut', () => {
    // name 10 + space + letter + space = 13 columns before the figure.
    expect(fitWeight('220k/1M', 20)).toBe('220k/1M')
    expect(fitWeight('220k/1M', 19)).toBe('220k')
    expect(fitWeight('220k/1M', 10)).toBe('220k')
    expect(fitWeight('84k', 10)).toBe('84k')
    expect(fitWeight('', 10)).toBe('')
  })

  test('context weight', () => {
    expect(contextWeight(127_400, 1_000_000)).toBe('127k/1M')
    expect(contextWeight(1_520_000, 2_000_000)).toBe('1.5M/2M')
    expect(contextWeight(54_000, 200_000)).toBe('54k/200k')
    expect(contextWeight(undefined, 1_000_000)).toBe('-/1M')
  })
})

describe('subagent context load', () => {
  const usage = (input: number, read: number, write: number, out: number, model = 'claude-sonnet-5-5') => ({
    input_tokens: input,
    cache_read_input_tokens: read,
    cache_creation_input_tokens: write,
    output_tokens: out,
    model,
  })

  test('a step sums input, cache read, cache write and output', () => {
    expect(contextLoad(usage(1_200, 80_000, 2_500, 300))).toBe(84_000)
  })

  test('the latest step wins; agents are kept apart', () => {
    let loads = recordStep({}, 'a1', usage(1_000, 50_000, 0, 0))
    loads = recordStep(loads, 'a2', usage(10, 0, 0, 0, 'claude-haiku-5-5'))
    loads = recordStep(loads, 'a1', usage(1_000, 83_000, 0, 0))
    expect(loads).toEqual({ a1: { tokens: 84_000, model: 'claude-sonnet-5-5' }, a2: { tokens: 10, model: 'claude-haiku-5-5' } })
  })

  test('the main loop (no agentId) and steps with no usage are not recorded', () => {
    const before = { a1: { tokens: 5, model: 'm' } }
    expect(recordStep(before, undefined, usage(1, 1, 1, 1))).toEqual(before)
    expect(recordStep(before, 'a1', null)).toEqual(before)
  })

  test('window only when the model is the main loop\'s; used alone otherwise; nothing when unknown', () => {
    const load = { tokens: 84_000, model: 'claude-sonnet-5-5' }
    expect(subagentWeight(load, 'claude-sonnet-5-5', 1_000_000)).toBe('84k/1M')
    expect(subagentWeight(load, 'claude-opus-5-5', 1_000_000)).toBe('84k')
    expect(subagentWeight(load, '', 1_000_000)).toBe('84k')
    expect(subagentWeight(load, 'claude-sonnet-5-5', null)).toBe('84k')
    expect(subagentWeight(undefined, 'claude-sonnet-5-5', 1_000_000)).toBe('')
  })
})

describe('actor colours', () => {
  test('stable per party, Mihkel his own, all from the palette', () => {
    expect(actorColor('Mihkel')).toBe(MIHKEL_COLOR)
    expect(actorColor(' mihkel ')).toBe(MIHKEL_COLOR)
    expect(actorColor('ESL board')).toBe(actorColor('ESL board'))
    expect(actorColor('ESL Board')).toBe(actorColor('esl board'))
    const others = ['Passepartout', 'ESL board', 'Kaire', 'Prusa', 'EAÜ (Siim Jõgioja)', 'workshop (3d-a1)']
    for (const actor of others) {
      expect((ACTOR_PALETTE as readonly string[]).includes(actorColor(actor)), actor).toBe(true)
    }
    // The palette spreads: six parties land on at least four colours.
    expect(new Set(others.map(actorColor)).size).toBeGreaterThanOrEqual(4)
    expect((ACTOR_PALETTE as readonly string[]).includes(MIHKEL_COLOR)).toBe(false)
    expect((ACTOR_PALETTE as readonly string[]).includes(LINK_FG)).toBe(false)
  })
})

describe('urls/ links', () => {
  const urls = { 'prusa-start-ooze-issue': 'https://github.com/prusa3d/PrusaSlicer-settings-prusa-fff/issues/49' }

  test('names cited in text, check and ref, each once', () => {
    expect(urlNamesOf({ obligation: 'see urls/a-1 and urls/b', check: 'urls/a-1', ref: 'urls/c' })).toEqual(['a-1', 'b', 'c'])
    expect(urlNamesOf({ obligation: 'no links', check: '', ref: 'adoption/05-debt.md' })).toEqual([])
  })

  test('url files: line 1, trimmed; blank or spaced is unusable', () => {
    expect(urlOfFile('https://x.example/a\n')).toBe('https://x.example/a')
    expect(urlOfFile('  https://x.example/a  \nnote')).toBe('https://x.example/a')
    expect(urlOfFile('\n')).toBeUndefined()
    expect(urlOfFile('not a url')).toBeUndefined()
  })

  test('text splits into text, links and dead references', () => {
    expect(segmentsOf('ask on urls/prusa-start-ooze-issue, or urls/gone.', urls)).toEqual([
      { kind: 'text', text: 'ask on ' },
      { kind: 'link', name: 'prusa-start-ooze-issue', href: urls['prusa-start-ooze-issue'] },
      { kind: 'text', text: ', or ' },
      { kind: 'dead', name: 'gone' },
      { kind: 'text', text: '.' },
    ])
  })

  test('ref and check links trail the text, without repeating one in it', () => {
    const r = row('2026-12-31', { obligation: 'see urls/prusa-start-ooze-issue', check: 'urls/other', ref: 'urls/prusa-start-ooze-issue' })
    expect(trailingLinksOf(r, urls)).toEqual([{ kind: 'dead', name: 'other' }])
    const plain = row('2026-12-31', { ref: 'urls/prusa-start-ooze-issue' })
    expect(trailingLinksOf(plain, urls)).toEqual([{ kind: 'link', name: 'prusa-start-ooze-issue', href: urls['prusa-start-ooze-issue'] }])
  })
})

test('probe: the test environment time zone offset', () => {
  // Informational: the mod falls back to `date +%z` when the environment reports UTC.
  expect(typeof new Date().getTimezoneOffset()).toBe('number')
})
