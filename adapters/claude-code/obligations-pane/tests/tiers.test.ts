import { describe, expect, test } from 'claude-code/testing'

import { parseMapLists, parseObligations } from '../hooks/obligations'
import {
  choiceOf,
  commitmentsView,
  COMMITMENTS_UNUSED,
  factsView,
  fileUrl,
  isStale,
  keysView,
  lessonsView,
  nextView,
  NO_SCRATCHPAD,
  rulesView,
  scratchpadCandidates,
  scratchpadShaped,
  secretFiles,
  secretsReadmeOf,
  secretsView,
} from '../hooks/tiers'
import type { TierView } from '../types'

/** The ok view's lines, or a failed expectation. */
const ok = (view: TierView) => {
  expect(view.kind).toBe('ok')
  if (view.kind !== 'ok') throw new Error(`not ok: ${JSON.stringify(view)}`)
  return view
}

describe('parseMapLists: the obligations parser, for every tier (kit #43)', () => {
  const SPEC = { tops: ['current', 'staging'], keys: ['label', 'record', 'ref'], required: ['record'], dates: [] }

  test('two top keys, any order, each once; an absent one is empty', () => {
    const r = parseMapLists('staging:\n- label: WIP\n  record: later\ncurrent: []\n', SPEC)
    expect(r).toEqual({ kind: 'ok', lists: { current: [], staging: [{ line: 2, fields: { label: 'WIP', record: 'later', ref: '' } }] } })
    expect(parseMapLists('current:\n- record: x\n', SPEC)).toMatchObject({ kind: 'ok', lists: { staging: [] } })
  })

  test('a top key twice, an unknown one, or items after `[]` are errors with a line', () => {
    expect(parseMapLists('current: []\ncurrent: []\n', SPEC)).toMatchObject({ kind: 'error', line: 2, message: expect.stringContaining('unexpected top-level line') })
    expect(parseMapLists('notes:\n', SPEC)).toMatchObject({ kind: 'error', line: 1, message: 'unknown top-level key "notes"' })
    expect(parseMapLists('current: []\n- record: x\n', SPEC)).toMatchObject({ kind: 'error', line: 2, message: 'content after "current: []"' })
    expect(parseMapLists('- record: x\n', SPEC)).toMatchObject({ kind: 'error', message: 'expected "current:" or "staging:" first' })
  })

  test('one-line flow-map items, as the kit fixtures write them; commas and braces in quotes are content', () => {
    const spec = { tops: ['rules'], keys: ['rule', 'ref'], required: ['rule'], dates: [] }
    const r = parseMapLists('rules:\n  - {rule: "Open the ref, then cite {it}.", ref: \'\'}\n  - {rule: It\'s plain, ref: "#2"}  # note\n', spec)
    expect(r).toEqual({
      kind: 'ok',
      lists: {
        rules: [
          { line: 2, fields: { rule: 'Open the ref, then cite {it}.', ref: '' } },
          { line: 3, fields: { rule: "It's plain", ref: '#2' } },
        ],
      },
    })
    expect(parseMapLists('rules:\n  - {rule: x, owner: y}\n', spec)).toMatchObject({ kind: 'error', line: 2, message: 'unknown key "owner"' })
    expect(parseMapLists('rules:\n  - {rule: [a, b]}\n', spec)).toMatchObject({ kind: 'error', message: 'nested values are not supported' })
    expect(parseMapLists('rules:\n  - {rule: x\n', spec)).toMatchObject({ kind: 'error', message: 'a flow map must open and close on its line' })
  })

  test('obligations parse as before, through it', () => {
    expect(parseObligations('obligations:\n- obligation: x\n  actor: a\n  expires: 2026-10-20\n')).toEqual({
      kind: 'ok',
      items: [{ obligation: 'x', actor: 'a', owed_to: '', since: '', check: '', expires: '2026-10-20', ref: '', line: 2 }],
    })
  })
})

describe('N: the scratchpad tier, found as the lint finds it (kit #53)', () => {
  test('every top-level *.yaml but rules, obligations and keys, in the lint order; commitments.yaml left to its shape', () => {
    const names = ['scratchpad.yaml', 'obligations.yaml', 'vitruvius.yaml', 'rules.yaml', 'keys.yaml', 'commitments.yaml', 'notes.md', 'old.yml', 'Zed.yaml', '.hidden.yaml', 'rules.yaml.bak']
    // Code-point order, as Python sorts paths: upper case before lower, a dot before both.
    expect(scratchpadCandidates(names)).toEqual(['.hidden.yaml', 'Zed.yaml', 'commitments.yaml', 'scratchpad.yaml', 'vitruvius.yaml'])
    expect(scratchpadCandidates(['rules.yaml', 'obligations.yaml', 'keys.yaml'])).toEqual([])
  })

  test('commitments.yaml is a scratchpad when it holds current or staging and no commitments key (kit #30)', () => {
    expect(scratchpadShaped('# named so before the tier existed\ncurrent:\n  - label: WIP\n    record: x\n    ref: ""\nstaging: []\n')).toBe(true)
    expect(scratchpadShaped('staging: []\n')).toBe(true)
    expect(scratchpadShaped('\uFEFFcurrent: []\n')).toBe(true)
    expect(scratchpadShaped('commitments:\n- trigger: a\n  obligation: b\n')).toBe(false)
    expect(scratchpadShaped('commitments: []\ncurrent: []\n')).toBe(false)
    // A key deeper than column 0 is not a top-level key; a comment is not a key.
    expect(scratchpadShaped('commitments:\n- trigger: a\n  current: b\n# current: c\n')).toBe(false)
    expect(scratchpadShaped('')).toBe(false)
  })

  test('one file: its name heads the tab, then current and staging under their headings; counted against the cap', () => {
    const v = ok(nextView([{ name: 'vitruvius.yaml', text: 'current:\n- label: WIP\n  record: "do urls/thing"\n  ref: mihkel:2026-10-19\nstaging:\n- label: GOTCHA\n  record: careful\n  ref: ""\n' }]))
    expect(v.count).toBe('1/15 current · 1 staging')
    expect(v.lines.map(l => [l.heading, l.tag, l.text, l.note])).toEqual([
      [true, '', 'vitruvius.yaml', ''],
      [true, '', 'current (1)', ''],
      [false, 'WIP', 'do urls/thing', 'mihkel:2026-10-19'],
      [true, '', 'staging (1)', ''],
      [false, 'GOTCHA', 'careful', ''],
    ])
  })

  test('no scratchpad file: the home has no scratchpad tier, and no file is named as missing', () => {
    expect(nextView([])).toEqual({ kind: 'missing', message: NO_SCRATCHPAD })
    expect(NO_SCRATCHPAD).toBe('no scratchpad tier in this home')
  })

  test('one file the parser rejects is its error, under its own name', () => {
    expect(nextView([{ name: 'vitruvius.yaml', text: 'current:\n- record: x\n   ref: y\n' }])).toEqual({
      kind: 'error',
      message: expect.stringMatching(/^vitruvius.yaml unreadable: line 3: /),
    })
  })

  test('two files: the lint reads both, so both show, each under its name in the lint order; the counts add up', () => {
    const v = ok(
      nextView([
        { name: 'vitruvius.yaml', text: 'current:\n- label: WIP\n  record: lead work\n  ref: ""\nstaging: []\n' },
        { name: 'scratchpad.yaml', text: 'current:\n- label: WIP\n  record: one\n  ref: ""\n- label: DEFERRED\n  record: two\n  ref: ""\nstaging:\n- label: LEARNED\n  record: three\n  ref: ""\n' },
      ]),
    )
    expect(v.count).toBe('2 scratchpads · 3 current · 1 staging')
    expect(v.lines.map(l => [l.heading, l.text])).toEqual([
      [true, 'scratchpad.yaml'],
      [true, 'current (2)'],
      [false, 'one'],
      [false, 'two'],
      [true, 'staging (1)'],
      [false, 'three'],
      [true, 'vitruvius.yaml'],
      [true, 'current (1)'],
      [false, 'lead work'],
      [true, 'staging (0)'],
    ])
    expect(new Set(v.lines.map(l => l.key)).size).toBe(v.lines.length)
  })

  test('two files, one broken: it is flagged in its place and the other still shows', () => {
    const v = ok(
      nextView([
        { name: 'scratchpad.yaml', text: 'current:\n- label: WIP\n  record: one\n  ref: ""\nstaging: []\n' },
        { name: 'notes.yaml', text: 'notes:\n- a thing\n' },
      ]),
    )
    expect(v.count).toBe('2 scratchpads · 1 current · 0 staging · 1 file unreadable')
    expect(v.lines.map(l => [l.heading, l.text])).toEqual([
      [true, 'notes.yaml'],
      [true, 'scratchpad.yaml'],
      [true, 'current (1)'],
      [false, 'one'],
      [true, 'staging (0)'],
    ])
    expect(v.lines[0]?.flag).toBe('notes.yaml unreadable: line 1: unknown top-level key "notes"')
  })
})

describe('the tabs', () => {
  test('C: a commitments.yaml that is a scratchpad (kit #30) is shown under Next, not here', () => {
    expect(commitmentsView('current:\n- label: WIP\n  record: x\n  ref: ""\nstaging: []\n')).toEqual({
      kind: 'missing',
      message: `${COMMITMENTS_UNUSED} (commitments.yaml holds a scratchpad: see Next)`,
    })
  })

  test('C: trigger -> obligation, then actor -> owed_to and within; a missing file is a tier not in use', () => {
    const v = ok(commitmentsView('commitments:\n- trigger: an invoice arrives\n  obligation: file it\n  actor: Passe\n  owed_to: Mihkel\n  within: 3 days\n  ref: ""\n'))
    expect(v.count).toBe('1 commitment')
    expect(v.lines[0]).toMatchObject({ text: 'an invoice arrives -> file it', note: 'Passe -> Mihkel, within 3 days' })
    expect(commitmentsView(undefined)).toEqual({ kind: 'missing', message: COMMITMENTS_UNUSED })
  })

  test('R: numbered, counted against the cap; a malformed file is its error', () => {
    const v = ok(rulesView('rules:\n- rule: Never send unconfirmed.\n  ref: ""\n- rule: Log every change.\n  ref: ""\n'))
    expect(v.count).toBe('2/20')
    expect(v.lines.map(l => `${l.tag} ${l.text}`)).toEqual(['1. Never send unconfirmed.', '2. Log every change.'])
    expect(rulesView('rules:\n- rule: x\n   ref: y\n')).toEqual({ kind: 'error', message: expect.stringMatching(/^rules.yaml unreadable: line 3: .*inconsistent indent/) })
  })

  test('L: newest first, an enforcement tag, a file link; the filter counts what it shows', () => {
    const index = [
      'lessons:',
      '- slug: old-one',
      '  summary: An old lesson.',
      '  learned: "2026-09-01"',
      '  ref: ""',
      '  enforcement: recognition',
      '- slug: new-one',
      '  summary: A new lesson.',
      '  learned: "2026-10-19"',
      '  ref: ""',
      '  enforcement: linted',
      '',
    ].join('\n')
    const all = ok(lessonsView(index, 'all', '/home/kit/memory/lessons'))
    expect(all.count).toBe('2 lessons')
    expect(all.lines.map(l => [l.tag, l.text, l.note, l.href])).toEqual([
      ['linted', 'A new lesson.', '2026-10-19', 'file:///home/kit/memory/lessons/new-one.md'],
      ['recognition', 'An old lesson.', '2026-09-01', 'file:///home/kit/memory/lessons/old-one.md'],
    ])
    const linted = ok(lessonsView(index, 'linted', '/home/kit/memory/lessons'))
    expect(linted.count).toBe('1/2 linted')
    expect(linted.lines.map(l => l.text)).toEqual(['A new lesson.'])
  })

  test('file URLs: POSIX and Windows, spaces encoded', () => {
    expect(fileUrl('/home/kit/memory/lessons/a b.md')).toBe('file:///home/kit/memory/lessons/a%20b.md')
    expect(fileUrl('C:\\Users\\m\\memory\\lessons\\x.md')).toBe('file:///C:/Users/m/memory/lessons/x.md')
  })

  test('F: grouped by subject, stale and never-verified facts dim; a broken file stays in its place', () => {
    const fresh = 'facts:\n- fact: The box runs Ubuntu.\n  ref: ""\n  refute: "=ref"\n  verified: 2026-10-01\n- fact: Old news.\n  ref: ""\n  refute: ""\n  verified: 2026-01-01\n'
    const v = ok(factsView([{ name: 'box.yaml', text: fresh }, { name: 'broken.yaml', text: 'facts:\n- fact: x\n  verified: soon\n' }, { name: 'a.yaml', text: 'facts:\n- fact: Never checked.\n  ref: ""\n  refute: ""\n  verified: ""\n' }], '2026-10-19'))
    expect(v.count).toBe('3 facts · 2 subjects · 2 not verified in 91 days · 1 file unreadable')
    expect(v.lines.map(l => [l.heading, l.tag, l.text, l.dim])).toEqual([
      [true, '', 'a (1)', false],
      [false, 'never', 'Never checked.', true],
      [true, '', 'box (2)', false],
      [false, '2026-10-01', 'The box runs Ubuntu.', false],
      [false, '2026-01-01', 'Old news.', true],
      [true, '', 'broken', false],
    ])
    expect(v.lines[5]?.flag).toMatch(/^facts\/broken.yaml unreadable: line 2: "verified" is not an ISO date/)
    expect(isStale('2026-07-20', '2026-10-19')).toBe(false)
    expect(isStale('2026-07-19', '2026-10-19')).toBe(true)
  })

  test('K: subject, holder and scope, the revoke step; a blank revoke is a finding, [?] unconfirmed', () => {
    const keys = [
      'keys:',
      '- subject: codeberg',
      '  holder: passe',
      '  scope: issues',
      '  granted: 2026-08-22',
      '  revoke: delete the token in settings',
      '  ref: ""',
      '- subject: gmail',
      '  holder: connector',
      '  scope: read, label',
      '  granted: 2026-08-01',
      '  revoke: ""',
      '  ref: ""',
      '- subject: nas',
      '  holder: kaarel',
      '  scope: read',
      '  granted: 2026-09-01',
      '  revoke: remove the share [?]',
      '  ref: ""',
      '',
    ].join('\n')
    const v = ok(keysView(keys))
    expect(v.count).toBe('3 grants · 1 finding')
    expect(v.lines.map(l => [l.tag, l.text, l.note, l.flag])).toEqual([
      ['codeberg', 'passe · issues', 'revoke: delete the token in settings', ''],
      ['gmail', 'connector · read, label', '', 'no revoke step (a finding)'],
      ['nas', 'kaarel · read', 'revoke: remove the share [?]', 'revoke step unconfirmed [?]'],
    ])
  })
})

describe('S: secrets, names and dates only', () => {
  const README = [
    '# secrets',
    '',
    '- **Public key (encrypt-only, safe to commit):** age1qyqszqgpqyqszqgpqyqszqgpqyqszqgp',
    '- **Master key location (a PATH, never the key):** ~/.config/passepartout/age.key',
    '- **Spare deposited:** 2026-09-13 — **where:** the safe at home — **verified:** NOT YET',
    '',
  ].join('\n')
  const SKELETON = [
    '- **Public key (encrypt-only, safe to commit):** _fill in_',
    '- **Master key location (a PATH, never the key):** _fill in_',
    '- **Spare deposited:** _date or NOT YET_ — **where:** _in words_ — **verified:** _date or NOT YET_',
  ].join('\n')

  test('the three labelled lines; the skeleton as shipped reads as not filled in', () => {
    expect(secretsReadmeOf(README)).toEqual({
      publicKey: 'age1qyqszqgpqyqszqgpqyqszqgpqyqszqgp',
      masterKey: '~/.config/passepartout/age.key',
      deposited: '2026-09-13',
      where: 'the safe at home',
      verified: 'NOT YET',
    })
    expect(secretsReadmeOf(SKELETON)).toEqual({})
  })

  test('a compliant home: the lines, the spare flag, the files by name and date', () => {
    const v = ok(secretsView(README, [{ name: 'codeberg-token.age', modified: '2026-09-13' }]))
    expect(v.banner).toBe('')
    expect(v.count).toBe('1 encrypted file')
    expect(v.lines.map(l => [l.tag, l.text, l.note, l.flag])).toEqual([
      ['public key', 'age1qyqszqgpqyqszqgpqyqszqgpqyqszqgp', '', ''],
      ['master key at', '~/.config/passepartout/age.key', '', ''],
      ['spare', 'deposited 2026-09-13, where the safe at home, verified NOT YET', '', 'spare NOT YET verified'],
      ['', 'encrypted files (1)', '', ''],
      ['', 'codeberg-token.age', '2026-09-13', ''],
    ])
  })

  test('non-compliance is a banner naming what is off', () => {
    expect(ok(secretsView(undefined, [])).banner).toBe('secrets tier not kit-compliant: no secrets/README.md; no encrypted file beside the README')
    const only = ok(secretsView(SKELETON, []))
    expect(only.banner).toBe('secrets tier not kit-compliant: public key not filled in; master key location not filled in; no encrypted file beside the README')
    expect(only.count).toBe('not kit-compliant')
  })

  test('the listing keeps files only: no README, no dotfile, no folder', () => {
    const entries = [
      { name: 'README.md', kind: 'file', mtimeMs: 0 },
      { name: '.gitkeep', kind: 'file', mtimeMs: 0 },
      { name: 'old', kind: 'dir', mtimeMs: 0 },
      { name: 'token.age', kind: 'file', mtimeMs: Date.parse('2026-09-13T10:00:00Z') },
    ]
    expect(secretFiles(entries, ms => new Date(ms).toISOString().slice(0, 10))).toEqual([{ name: 'token.age', modified: '2026-09-13' }])
  })
})

describe('the stored choice', () => {
  test('validated field by field; unknown falls back to Obligations and all', () => {
    expect(choiceOf({ tab: 'L', lessons: 'linted' })).toEqual({ tab: 'L', lessons: 'linted' })
    expect(choiceOf({ tab: 'Z', lessons: 'linted' })).toEqual({ tab: 'O', lessons: 'linted' })
    expect(choiceOf(null)).toEqual({ tab: 'O', lessons: 'all' })
    expect(choiceOf('L')).toEqual({ tab: 'O', lessons: 'all' })
  })
})
