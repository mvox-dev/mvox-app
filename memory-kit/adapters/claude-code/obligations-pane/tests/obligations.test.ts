import { describe, expect, test } from 'claude-code/testing'

import {
  ACTOR_PALETTE,
  actorColor,
  addDays,
  cachedCheck,
  clampIndex,
  compareRelease,
  confValue,
  contextLoad,
  contextWeight,
  countsLabel,
  countsOf,
  fitActor,
  fitName,
  fitWeight,
  isAbsolutePath,
  isoDate,
  isFresh,
  isoMinute,
  kitLabel,
  kitVersionOf,
  LINK_FG,
  memoryDirOf,
  parentDir,
  MIHKEL_COLOR,
  modelLetter,
  newestRelease,
  offsetFromZ,
  parseObligations,
  parseRelease,
  recordStep,
  segmentsOf,
  sortByExpires,
  statusOf,
  step,
  subagentWeight,
  tagNamesOf,
  trailingLinksOf,
  UPDATE_INTERVAL_MS,
  updateNote,
  upstreamTagsUrl,
  urlNamesOf,
  urlOfFile,
  wheelStep,
} from '../hooks/obligations'
import type { ObligationRow } from '../types'
import { WORKSHOP_YAML } from './fixtures/data'
import { SAFE_DUMP_ASCII, SAFE_DUMP_ITEMS, SAFE_DUMP_UNICODE } from './fixtures/safe-dump'

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

  test('yaml.safe_dump output: items at column 0, folded lines, escapes (kit #5)', () => {
    for (const text of [SAFE_DUMP_ASCII, SAFE_DUMP_UNICODE]) {
      const parsed = parseObligations(text)
      expect(parsed.kind).toBe('ok')
      if (parsed.kind !== 'ok') return
      expect(parsed.items.map(({ line, ...rest }) => rest)).toEqual(SAFE_DUMP_ITEMS)
      expect(parsed.items.map(i => i.line)).toEqual([2, 9, 15, 23])
    }
  })

  test('the indented layout still parses, and the two layouts agree', () => {
    const indented = SAFE_DUMP_UNICODE.split('\n')
      .map(l => (l === '' || l === 'obligations:' ? l : `  ${l}`))
      .join('\n')
    const parsed = parseObligations(indented)
    expect(parsed.kind).toBe('ok')
    if (parsed.kind === 'ok') expect(parsed.items.map(({ line, ...rest }) => rest)).toEqual(SAFE_DUMP_ITEMS)
    expect(parseObligations(WORKSHOP_YAML).kind).toBe('ok')
  })

  test('multi-line scalars fold as YAML does', () => {
    const one = (value: string) => {
      const parsed = parseObligations(`obligations:\n- obligation: ${value}\n  actor: a\n  expires: 2026-10-20\n`)
      return parsed.kind === 'ok' ? parsed.items[0]?.obligation : parsed
    }
    // A blank line inside a scalar is a line break; single breaks are spaces.
    expect(one('x\n    more text\n\n    after blank')).toBe('x more text\nafter blank')
    expect(one("'a\n\n    b  \n     c'")).toBe('a\nb c')
    // Double-quoted: a backslash ends the line without a space; "\ " is a space.
    expect(one('"a\\\n    \\ b"')).toBe('a b')
    expect(one('"caf\\xE9 \\u2014 \\U0001F600"')).toBe('café — 😀')
    // The value may start on the next line.
    expect(one('\n    on the next line')).toBe('on the next line')
    // Plain null and ~ are empty; quoted, they are text.
    const nulls = parseObligations("obligations:\n- obligation: x\n  actor: a\n  expires: 2026-10-20\n  ref: null\n  check: ~\n  since: ''\n")
    expect(nulls.kind === 'ok' && [nulls.items[0]?.ref, nulls.items[0]?.check]).toEqual(['', ''])
  })

  test('column-0 and multi-line errors', () => {
    const cases: [string, number, RegExp][] = [
      ['- obligation: x', 1, /expected "obligations:" first/],
      ['obligations: []\n- obligation: x', 2, /content after/],
      ['obligations:\n- obligation: x\n  - obligation: y', 3, /inconsistent indent/],
      ['obligations:\n- obligation: x\n    actor: y', 3, /inconsistent indent/],
      ['obligations:\n- obligation: x # note\n    more', 2, /comment/],
      ['obligations:\n- obligation: "x\n  actor: y', 2, /unterminated/],
      ['obligations:\n- obligation: x\nfacts:', 3, /unexpected top-level line/],
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

  test('absolute paths: POSIX, drive letter, UNC (kit #8)', () => {
    for (const p of ['/srv/home/memory', 'C:\\Users\\m\\memory', 'C:/Users/m/memory', 'd:\\x', '\\\\server\\share\\memory'])
      expect(isAbsolutePath(p), p).toBe(true)
    for (const p of ['memory', 'kit-home/memory', './memory', '..\\memory', 'C:memory', 'CC:\\x', ''])
      expect(isAbsolutePath(p), p).toBe(false)
  })

  test('parent directory, POSIX and Windows separators', () => {
    expect(parentDir('/srv/home/memory')).toBe('/srv/home')
    expect(parentDir('/srv/home/memory/')).toBe('/srv/home')
    expect(parentDir('C:\\Users\\m\\memory')).toBe('C:\\Users\\m')
    expect(parentDir('/home/kit/C:/x/memory')).toBe('/home/kit/C:/x')
    expect(parentDir('/memory')).toBe('/')
    expect(parentDir('memory')).toBe('.')
  })

  test('memory_dir from memory-kit.conf', () => {
    expect(memoryDirOf('# c\nmemory_dir: memory\nmode: gate\n')).toBe('memory')
    expect(memoryDirOf('memory_dir: "notes" # here\n')).toBe('notes')
    expect(memoryDirOf('mode: gate\n')).toBeUndefined()
  })
})

describe('kit version and upstream releases (kit #4, #7)', () => {
  test('conf values, VERSION text', () => {
    const conf = '# c\nmemory_dir: memory\nupstream: "someone/memory-kit" # fork\nmode: gate\n'
    expect(confValue(conf, 'upstream')).toBe('someone/memory-kit')
    expect(confValue(conf, 'mode')).toBe('gate')
    expect(confValue(conf, 'absent')).toBeUndefined()
    expect(confValue('  upstream: nested\n', 'upstream')).toBeUndefined()
    expect(kitVersionOf('0.1.0-alpha.5\n')).toBe('0.1.0-alpha.5')
    expect(kitVersionOf('  \n')).toBeUndefined()
    expect(kitVersionOf('')).toBeUndefined()
  })

  test('release tags: v<maj>.<min>.<patch>, optional -alpha.N, -beta.N, -rc.N', () => {
    expect(parseRelease('v0.1.0-alpha.5')).toEqual({ major: 0, minor: 1, patch: 0, pre: { kind: 'alpha', n: 5 } })
    expect(parseRelease('0.1.0-alpha.5')).toEqual({ major: 0, minor: 1, patch: 0, pre: { kind: 'alpha', n: 5 } })
    expect(parseRelease('v1.2.3')).toEqual({ major: 1, minor: 2, patch: 3 })
    for (const junk of ['v1.2', 'v1.2.3-dev', 'v1.2.3-alpha', 'v1.2.3-rc.1.1', 'release-1', 'v01.2.3', 'v1.2.3+build', ''])
      expect(parseRelease(junk), junk).toBeUndefined()
  })

  test('semver precedence', () => {
    const order = ['0.1.0-alpha.2', '0.1.0-alpha.9', '0.1.0-alpha.10', '0.1.0-beta.1', '0.1.0-rc.1', '0.1.0', '0.1.1', '0.2.0-alpha.1', '1.0.0']
    for (let i = 0; i + 1 < order.length; i++) {
      const a = parseRelease(order[i] ?? '')
      const b = parseRelease(order[i + 1] ?? '')
      if (a === undefined || b === undefined) throw new Error(`unparsed ${order[i]}`)
      expect(compareRelease(a, b), `${order[i]} < ${order[i + 1]}`).toBeLessThan(0)
      expect(compareRelease(b, a)).toBeGreaterThan(0)
      expect(compareRelease(a, a)).toBe(0)
    }
    expect(newestRelease(['v0.1.0-alpha.9', 'nightly', 'v0.1.0-alpha.10', 'v9.9.9-dev'])).toBe('0.1.0-alpha.10')
    expect(newestRelease(['junk'])).toBeUndefined()
  })

  test('the note: newer only; the pre-release alone on the same core, else the whole version', () => {
    expect(updateNote('0.1.0-alpha.5', '0.1.0-alpha.6')).toBe('alpha.6')
    expect(updateNote('0.1.0-alpha.5', '0.1.0-rc.1')).toBe('rc.1')
    expect(updateNote('0.1.0-alpha.5', '0.1.0')).toBe('0.1.0')
    expect(updateNote('0.1.0-alpha.5', '0.2.0-alpha.1')).toBe('0.2.0-alpha.1')
    expect(updateNote('0.1.0-alpha.5', '0.1.0-alpha.5')).toBe('')
    expect(updateNote('0.1.0-alpha.5', '0.1.0-alpha.4')).toBe('')
    expect(updateNote('0.1.0-alpha.5', '')).toBe('')
    expect(updateNote('', '0.1.0-alpha.6')).toBe('')
    expect(updateNote('my-fork', '0.1.0-alpha.6')).toBe('')
    expect(kitLabel('0.1.0-alpha.5', 'alpha.6')).toBe('memory-kit 0.1.0-alpha.5 · alpha.6 out')
    expect(kitLabel('0.1.0-alpha.5', '')).toBe('memory-kit 0.1.0-alpha.5')
    expect(kitLabel('', 'alpha.6')).toBe('')
  })

  test('upstream: owner/repo on Codeberg, the kit repo by default', () => {
    expect(upstreamTagsUrl(undefined)).toBe('https://codeberg.org/api/v1/repos/mitselek/memory-kit/tags?limit=50')
    expect(upstreamTagsUrl('someone/memory-kit.fork')).toBe('https://codeberg.org/api/v1/repos/someone/memory-kit.fork/tags?limit=50')
    for (const bad of ['https://example.com/tags', 'a/b/c', '../x', 'a', 'a/..', ''])
      expect(upstreamTagsUrl(bad), bad).toBeUndefined()
  })

  test('tags answer: names of a JSON list, else junk', () => {
    expect(tagNamesOf('[{"name":"v0.1.0-alpha.5","id":"x"},{"name":"v0.1.0-alpha.4"}]')).toEqual(['v0.1.0-alpha.5', 'v0.1.0-alpha.4'])
    expect(tagNamesOf('[]')).toEqual([])
    for (const junk of ['<html>', '{"message":"rate"}', '[{"nom":"x"}]', '[1]', ''])
      expect(tagNamesOf(junk), junk).toBeUndefined()
  })

  test('cache: fresh for 6 h; a clock that went back is stale', () => {
    expect(UPDATE_INTERVAL_MS).toBe(6 * 3_600_000)
    expect(isFresh(1_000, 1_000)).toBe(true)
    expect(isFresh(1_000, 1_000 + UPDATE_INTERVAL_MS - 1)).toBe(true)
    expect(isFresh(1_000, 1_000 + UPDATE_INTERVAL_MS)).toBe(false)
    expect(isFresh(1_000, 999)).toBe(false)
    const url = 'https://u'
    expect(cachedCheck({ [url]: { checkedAt: 5, latest: '0.1.0' } }, url)).toEqual({ checkedAt: 5, latest: '0.1.0' })
    expect(cachedCheck({ [url]: { checkedAt: '5', latest: '0.1.0' } }, url)).toBeUndefined()
    expect(cachedCheck({ other: { checkedAt: 5, latest: '' } }, url)).toBeUndefined()
    expect(cachedCheck(undefined, url)).toBeUndefined()
    expect(cachedCheck('junk', url)).toBeUndefined()
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
