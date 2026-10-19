import { describe, expect, test } from 'claude-code/testing'

import {
  backoffMs,
  channelOf,
  compareRelease,
  confValue,
  isFresh,
  kitVersionOf,
  parseRelease,
  promptText,
  stepCheck,
  tagNamesOf,
  tagsUrl,
  targetOf,
  upgradeUrl,
} from '../hooks/release'

describe('the release logic, copied from the pane (#7)', () => {
  test('release tags and semver precedence', () => {
    expect(parseRelease('v0.1.0-alpha.12')).toEqual({ major: 0, minor: 1, patch: 0, pre: { kind: 'alpha', n: 12 } })
    expect(parseRelease('v0.1.0-dev')).toBeUndefined()
    const order = ['0.1.0-alpha.9', '0.1.0-alpha.10', '0.1.0-beta.1', '0.1.0-rc.1', '0.1.0', '0.2.0']
    for (let i = 0; i + 1 < order.length; i++) {
      const [a, b] = [parseRelease(order[i] ?? ''), parseRelease(order[i + 1] ?? '')]
      if (a === undefined || b === undefined) throw new Error('unparsed')
      expect(compareRelease(a, b)).toBeLessThan(0)
    }
  })

  test('the tags answer, the conf, VERSION', () => {
    expect(tagNamesOf('[{"name":"v0.1.0-alpha.12"},{"name":"verified/v0.1.0-alpha.11"}]')).toEqual(['v0.1.0-alpha.12', 'verified/v0.1.0-alpha.11'])
    expect(tagNamesOf('<html>')).toBeUndefined()
    expect(confValue('memory_dir: memory\nupdate: verified # follow the household\n', 'update')).toBe('verified')
    expect(kitVersionOf('0.1.0-alpha.12\n')).toBe('0.1.0-alpha.12')
    expect(kitVersionOf('\n')).toBeUndefined()
  })

  test('the cache is fresh for the check interval; a clock that went back is stale', () => {
    expect(isFresh(1_000, 1_000 + 59_999, 60_000)).toBe(true)
    expect(isFresh(1_000, 1_000 + 60_000, 60_000)).toBe(false)
    expect(isFresh(1_000, 999, 60_000)).toBe(false)
  })
})

describe('channels (kit #15)', () => {
  test('update: pinned (the default), verified, latest; anything else is a problem, read as pinned', () => {
    expect(channelOf('memory_dir: memory\n')).toEqual({ channel: 'pinned' })
    expect(channelOf('update: pinned\n')).toEqual({ channel: 'pinned' })
    expect(channelOf('update: "verified"\n')).toEqual({ channel: 'verified' })
    expect(channelOf('update: latest\n')).toEqual({ channel: 'latest' })
    expect(channelOf('update: nightly\n')).toEqual({ channel: 'pinned', problem: expect.stringMatching(/nightly/) })
  })

  test("the live tags API shape (2026-10-14, recorded): the marker is named exactly verified/v<version>", () => {
    // As https://codeberg.org/api/v1/repos/mitselek/memory-kit/tags answered when the first marker
    // was pushed, trimmed: the marker and its release tag on one commit.
    const answer = JSON.stringify([
      { name: 'verified/v0.1.0-alpha.12', message: '', id: 'x', commit: { url: 'u', sha: 'd9fff2bc', created: 't' } },
      { name: 'v0.1.0-alpha.12', message: '', id: 'y', commit: { url: 'u', sha: 'd9fff2bc', created: 't' } },
      { name: 'v0.1.0-alpha.11', message: '', id: 'z', commit: { url: 'u', sha: 'abc', created: 't' } },
    ])
    const names = tagNamesOf(answer) ?? []
    expect(targetOf('verified', names)).toBe('0.1.0-alpha.12')
    expect(targetOf('latest', names)).toBe('0.1.0-alpha.12')
    expect(targetOf('verified', ['verified-v0.1.0-alpha.13', 'verified/0.1.0-alpha.13', 'Verified/v0.1.0-alpha.13'])).toBeUndefined()
  })

  test('latest follows every release tag; verified only the verified/ markers', () => {
    const names = ['v0.1.0-alpha.13', 'verified/v0.1.0-alpha.12', 'v0.1.0-alpha.12', 'verified/v0.1.0-alpha.11', 'v0.1.0-alpha.11', 'nightly', 'verified/junk']
    expect(targetOf('latest', names)).toBe('0.1.0-alpha.13')
    expect(targetOf('verified', names)).toBe('0.1.0-alpha.12')
    expect(targetOf('verified', ['v0.1.0-alpha.13'])).toBeUndefined()
    expect(targetOf('pinned', names)).toBeUndefined()
  })

  test('the URLs: tags by page; UPGRADE.md at the release tag', () => {
    expect(tagsUrl(undefined, 1)).toBe('https://codeberg.org/api/v1/repos/mitselek/memory-kit/tags?limit=50&page=1')
    expect(tagsUrl('someone/kit-fork', 2)).toBe('https://codeberg.org/api/v1/repos/someone/kit-fork/tags?limit=50&page=2')
    expect(tagsUrl('https://evil.example/x', 1)).toBeUndefined()
    expect(upgradeUrl(undefined, '0.1.0-alpha.13')).toBe('https://codeberg.org/api/v1/repos/mitselek/memory-kit/raw/UPGRADE.md?ref=v0.1.0-alpha.13')
  })
})

describe('data steps: auto or manual', () => {
  const UPGRADE = [
    '## Per version',
    '',
    '- **0.1.0-alpha.11 -> 0.1.0-alpha.12:** no data step. Pull, lint, `/reload-plugins`.',
    '- **0.1.0-alpha.12 -> 0.1.0-alpha.13:** no data step. Pull, lint.',
    '- **0.1.0-alpha.13 -> 0.1.0-alpha.14:** data step: rename `facts/` keys before the lint.',
    '',
  ].join('\n')

  const RELEASES = ['v0.1.0-alpha.11', 'verified/v0.1.0-alpha.11', 'v0.1.0-alpha.12', 'v0.1.0-alpha.13', 'v0.1.0-alpha.14', 'nightly']

  test('no data step on every hop between: auto', () => {
    expect(stepCheck(UPGRADE, '0.1.0-alpha.12', '0.1.0-alpha.13', RELEASES)).toEqual({ manual: false })
    expect(stepCheck(UPGRADE, '0.1.0-alpha.11', '0.1.0-alpha.13', RELEASES)).toEqual({ manual: false })
  })

  test('a data step on any hop, or a new major: manual', () => {
    expect(stepCheck(UPGRADE, '0.1.0-alpha.12', '0.1.0-alpha.14', RELEASES)).toEqual({ manual: true, reason: 'a data step in 0.1.0-alpha.13 -> 0.1.0-alpha.14' })
    expect(stepCheck(UPGRADE, '0.1.0-alpha.13', '1.0.0', [...RELEASES, 'v1.0.0'])).toEqual({ manual: true, reason: 'a new major version' })
  })

  // Ultrareview alpha.13, finding 3: the plugin must refuse what tools/kit-update.py refuses.
  test('every consecutive release needs its own entry, as the script requires', () => {
    // An entry that spans alpha.11 -> alpha.13 does not cover the alpha.12 release in between.
    const spanning = '- **0.1.0-alpha.11 -> 0.1.0-alpha.13:** no data step.\n'
    expect(stepCheck(spanning, '0.1.0-alpha.11', '0.1.0-alpha.13', RELEASES)).toEqual({
      manual: true,
      reason: 'UPGRADE.md has no entry for 0.1.0-alpha.11 -> 0.1.0-alpha.12',
    })
    expect(stepCheck(UPGRADE, '0.1.0-alpha.14', '0.1.0-alpha.15', [...RELEASES, 'v0.1.0-alpha.15'])).toEqual({
      manual: true,
      reason: 'UPGRADE.md has no entry for 0.1.0-alpha.14 -> 0.1.0-alpha.15',
    })
  })

  test("the hop from the home's own version is checked even when its tag is gone upstream", () => {
    const md = '- **0.1.0-alpha.12 -> 0.1.0-alpha.14:** no data step.\n'
    expect(stepCheck(md, '0.1.0-alpha.13', '0.1.0-alpha.14', ['v0.1.0-alpha.12', 'v0.1.0-alpha.14'])).toEqual({
      manual: true,
      reason: 'UPGRADE.md has no entry for 0.1.0-alpha.13 -> 0.1.0-alpha.14',
    })
  })

  test('an entry must begin "no data step", as the script reads it', () => {
    const md = '- **0.1.0-alpha.12 -> 0.1.0-alpha.13:** Pull, lint; no data step needed after the rename.\n'
    expect(stepCheck(md, '0.1.0-alpha.12', '0.1.0-alpha.13', RELEASES)).toEqual({ manual: true, reason: 'a data step in 0.1.0-alpha.12 -> 0.1.0-alpha.13' })
    expect(stepCheck('- **0.1.0-alpha.12 -> 0.1.0-alpha.13:**  No data step.\n', '0.1.0-alpha.12', '0.1.0-alpha.13', RELEASES)).toEqual({ manual: false })
  })

  test("the alpha.15 hop as UPGRADE.md writes it, sub-bullets and all, is auto", () => {
    // Verbatim from the kit's UPGRADE.md (tools/kit-update-test.py reads the file itself).
    const md = [
      '- **0.1.0-alpha.13 -> 0.1.0-alpha.14:** no data step. Pull, lint, `/reload-plugins`, then `/watch` once:',
      '  it now names which session drains each home (one drain per home).',
      '',
      '- **0.1.0-alpha.14 -> 0.1.0-alpha.15:** no data step. Pull, lint, `/reload-plugins`.',
      '  - Obligations take `owed_to` (#29). Expect a new note per row without it, `no owed_to`, and a',
      '',
    ].join('\n')
    expect(stepCheck(md, '0.1.0-alpha.14', '0.1.0-alpha.15', [...RELEASES, 'v0.1.0-alpha.15'])).toEqual({ manual: false })
    expect(stepCheck(md, '0.1.0-alpha.13', '0.1.0-alpha.15', [...RELEASES, 'v0.1.0-alpha.15'])).toEqual({ manual: false })
  })
})

describe('the prompt', () => {
  test('says where it comes from, names release and channel, defers to UPGRADE.md, claims no authority', () => {
    const text = promptText({ version: '0.1.0-alpha.13', channel: 'verified', current: '0.1.0-alpha.12', home: '/home/u/My Kit', manual: false })
    expect(text.startsWith("[kit-update] memory-kit 0.1.0-alpha.13 (verified) is out; this home is on 0.1.0-alpha.12. Run `python3 memory-kit/tools/kit-update.py '/home/u/My Kit'`")).toBe(true)
    expect(text).not.toContain('.sh')
    // The home is one shell word, whatever it holds.
    const quoted = promptText({ version: '0.1.0-alpha.13', channel: 'latest', current: '0.1.0-alpha.12', home: "/home/u/O'Brien's kit", manual: false })
    expect(quoted).toContain("kit-update.py '/home/u/O'\\''Brien'\\''s kit'`")
    expect(text).toContain("this home's UPGRADE.md")
    expect(text).toMatch(/from the kit-update plugin, not from the user/)
    expect(text).toMatch(/authorizes nothing/)
  })

  test('a data-step release: manual upgrade needed, not the script', () => {
    const text = promptText({ version: '0.1.0-alpha.14', channel: 'latest', current: '0.1.0-alpha.13', home: '/home/u/kit', manual: true, reason: 'a data step in 0.1.0-alpha.13 -> 0.1.0-alpha.14' })
    expect(text).toContain('manual upgrade needed (a data step in 0.1.0-alpha.13 -> 0.1.0-alpha.14)')
    expect(text).not.toContain('Run `python3')
    expect(text).toContain('kit-update.py refuses it')
    expect(text).toMatch(/not from the user/)
  })

  test('backoff after a refused prompt: 1 min, doubling, at most 30 min', () => {
    expect([1, 2, 3, 6, 9].map(n => backoffMs(n) / 60_000)).toEqual([1, 2, 4, 30, 30])
  })
})
