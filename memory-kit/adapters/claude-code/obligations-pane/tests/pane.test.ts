import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { actorColor, LINK_FG, MODEL_COLORS, PANE_BG } from '../hooks/obligations'
import { PRUSA_URL_FILE, WORKSHOP_YAML } from './fixtures/data'
import { PANE, PLUGIN, SESSION, tagsAnswer, worldOf } from './fixtures/world'

const NOW = Date.parse('2026-10-14T12:00:00Z')
const KIT = {
  'memory/obligations.yaml': WORKSHOP_YAML,
  'memory/urls/prusa-start-ooze-issue': PRUSA_URL_FILE,
  'memory-kit/VERSION': '0.1.0-alpha.5\n',
}
const TAGS_URL = 'https://codeberg.org/api/v1/repos/mitselek/memory-kit/tags?limit=50'
const HOUR = 3_600_000

const mountPane = ($: Engine, surface: 'terminal' | 'desktop' = 'terminal') =>
  $.ui.mount({ ...PANE, surface, plugin: PLUGIN } as never)

const textOf = async (ui: { findAll: (q: { type?: string }) => Promise<{ text: string }[]> }) =>
  (await ui.findAll({ type: 'Text' })).map(t => t.text)

describe('the pane over the workshop ledger', () => {
  test('header, ordered rows, link, footer; accepted by terminal and desktop', async ($, on) => {
    worldOf(on, KIT)
    mock.clock(on, { now: NOW })
    await $.session.start(SESSION)

    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await mountPane($, surface)
      const root = await ui.drawn()
      expect((root as { props?: { backgroundColor?: string } }).props?.backgroundColor).toBe(PANE_BG)

      const texts = await textOf(ui)
      const header = texts.find(t => t.includes('expired'))
      expect(header).toBe('memory-kit 0.1.0-alpha.5  0 expired · 1 due ≤7d')

      // Rows: soonest expiry first; the Prusa row (2026-12-31) last.
      const dates = texts.filter(t => /^\d{4}-\d{2}-\d{2}$/.test(t))
      expect(dates).toEqual(['2026-10-21', '2026-10-28', '2026-10-28', '2026-10-28', '2026-10-28', '2026-12-31'])

      expect(await ui.find({ type: 'Text', text: /^Prusa \(prusa3d\/Prus…$/ })).toBeDefined()

      const link = await ui.find({ type: 'Link' })
      expect(link?.props.href).toBe('https://github.com/prusa3d/PrusaSlicer-settings-prusa-fff/issues/49')
      expect(link?.text.endsWith('prusa-start-ooze-issue')).toBe(true)
      const linkText = await ui.find({ type: 'Text', text: /^prusa-start-ooze-issue$/ })
      expect(linkText?.props.color).toBe(LINK_FG)

      const self = texts.find(t => t.startsWith('kit       '))
      expect(self).toBe('kit        O 127k/1M')
      const letter = await ui.find({ type: 'Text', text: /^O$/ })
      expect(letter?.props.color).toBe(MODEL_COLORS.O)

      await ui.unmount()
    }
  })

  test('opens itself at session start when the file is there', async ($, on) => {
    const world = worldOf(on, KIT)
    mock.clock(on, { now: NOW })
    await $.session.start(SESSION)
    expect(world.opened).toEqual(['obligations'])
    expect(world.commands).toEqual(['obligations'])
  })

  test('scrolls one item at a time, within bounds', async ($, on) => {
    worldOf(on, KIT)
    mock.clock(on, { now: NOW })
    await $.session.start(SESSION)
    const ui = await mountPane($)
    const firstDate = async () => (await textOf(ui)).find(t => /^\d{4}-\d{2}-\d{2}$/.test(t))
    const position = async () => (await textOf(ui)).find(t => /^\d+\/\d+$/.test(t))

    expect(await position()).toBe('1/6')
    await ui.press({ key: 'up' })
    expect(await position()).toBe('1/6')
    expect(await firstDate()).toBe('2026-10-21')
    await ui.press({ key: 'down' })
    expect(await position()).toBe('2/6')
    expect(await firstDate()).toBe('2026-10-28')
    for (let i = 0; i < 10; i++) await ui.press({ key: 'down' })
    expect(await position()).toBe('6/6')
    expect(await firstDate()).toBe('2026-12-31')
    await ui.unmount()
  })
})

describe('empty states', () => {
  test('no file: says so, and does not open itself', async ($, on) => {
    const world = worldOf(on, {})
    mock.clock(on, { now: NOW })
    await $.session.start(SESSION)
    expect(world.opened).toEqual([])
    const ui = await mountPane($)
    expect((await textOf(ui)).some(t => t.startsWith('no obligations file here'))).toBe(true)
    await ui.unmount()
  })

  test('empty list: "no obligations"', async ($, on) => {
    worldOf(on, { 'memory/obligations.yaml': 'obligations: []\n' })
    mock.clock(on, { now: NOW })
    await $.session.start(SESSION)
    const ui = await mountPane($)
    const texts = await textOf(ui)
    expect(texts).toContain('no obligations')
    // No memory-kit/VERSION here: nothing in the version slot, never a guess.
    expect(texts.find(t => t.includes('expired'))).toBe('0 expired · 0 due ≤7d')
    await ui.unmount()
  })

  test('owed_to: "actor -> owed_to: obligation"; a row without one as before (kit #29)', async ($, on) => {
    worldOf(on, {
      'memory/obligations.yaml': [
        'obligations:',
        '  - obligation: answer the email',
        '    actor: Passepartout',
        '    owed_to: the board',
        '    expires: 2026-10-15',
        '  - obligation: from before owed_to',
        '    actor: Mihkel',
        '    expires: 2026-10-16',
        '',
      ].join('\n'),
    })
    mock.clock(on, { now: NOW })
    await $.session.start(SESSION)
    const ui = await mountPane($)
    const texts = await textOf(ui)
    expect(texts).toContain('2026-10-15 Passepartout -> the board: answer the email')
    expect(texts).toContain('2026-10-16 Mihkel from before owed_to')
    // The party owed is drawn as an actor is: bold, in its own stable colour.
    const owed = await ui.find({ type: 'Text', text: /^the board$/ })
    expect(owed?.props.bold).toBe(true)
    expect(owed?.props.color).toBe(actorColor('the board'))
    await ui.unmount()
  })

  test('malformed: the error and its line', async ($, on) => {
    worldOf(on, { 'memory/obligations.yaml': 'obligations:\n  - obligation: x\n    actor: y\n    expires: soon\n' })
    mock.clock(on, { now: NOW })
    await $.session.start(SESSION)
    const ui = await mountPane($)
    expect((await textOf(ui)).some(t => t.includes('line 2') && t.includes('ISO date'))).toBe(true)
    await ui.unmount()
  })

  test('a memory_dir from memory-kit.conf is honoured', async ($, on) => {
    worldOf(on, { 'memory-kit.conf': 'memory_dir: notes\n', 'notes/obligations.yaml': WORKSHOP_YAML })
    mock.clock(on, { now: NOW })
    await $.session.start(SESSION)
    const ui = await mountPane($)
    expect((await textOf(ui)).filter(t => /^\d{4}-\d{2}-\d{2}$/.test(t))).toHaveLength(6)
    await ui.unmount()
  })
})

describe('kit_home: the start folder points at the home (kit #18)', () => {
  const DESK = '/home/desk'
  const dates = async (ui: Parameters<typeof textOf>[0]) => (await textOf(ui)).filter(t => /^\d{4}-\d{2}-\d{2}$/.test(t))
  const header = async (ui: Parameters<typeof textOf>[0]) => (await textOf(ui)).find(t => t.includes('expired'))
  const desk = {
    'memory-kit.conf': 'kit_home: ../desk\n',
    [`${DESK}/memory-kit.conf`]: 'memory_dir: notes\n',
    [`${DESK}/notes/obligations.yaml`]: WORKSHOP_YAML,
    [`${DESK}/memory-kit/VERSION`]: '0.1.0-alpha.14\n',
  }

  test("the ledger and the version come from the home it names, with that home's memory_dir", async ($, on) => {
    worldOf(on, desk)
    mock.clock(on, { now: NOW })
    await $.session.start(SESSION)
    const ui = await mountPane($)
    expect(await dates(ui)).toHaveLength(6)
    expect(await header(ui)).toBe('memory-kit 0.1.0-alpha.14  0 expired · 1 due ≤7d')
    await ui.unmount()
  })

  test('the pointer wins over a user-scope memoryDir', { options: { memoryDir: '/srv/other/memory' } }, async ($, on) => {
    worldOf(on, { ...desk, '/srv/other/memory/obligations.yaml': 'obligations: []\n' })
    mock.clock(on, { now: NOW })
    await $.session.start(SESSION)
    const ui = await mountPane($)
    expect(await dates(ui)).toHaveLength(6)
    await ui.unmount()
  })

  test('a broken pointer is shown in the pane, never the start folder instead', async ($, on) => {
    const world = worldOf(on, { 'memory-kit.conf': 'kit_home: ../nowhere\n', 'memory/obligations.yaml': WORKSHOP_YAML })
    mock.clock(on, { now: NOW })
    await $.session.start(SESSION)
    expect(world.opened).toEqual(['obligations'])
    const ui = await mountPane($)
    expect(await dates(ui)).toHaveLength(0)
    expect((await textOf(ui)).some(t => t.startsWith('kit_home pointer broken: ') && t.includes('no memory-kit.conf there'))).toBe(true)
    await ui.unmount()
  })

  test('a pointed home without memory-kit/VERSION shows "memory-kit ?" and asks upstream nothing', async ($, on) => {
    const { [`${DESK}/memory-kit/VERSION`]: _, ...noVersion } = desk
    const world = worldOf(on, noVersion)
    world.answer = () => tagsAnswer('v0.1.0-alpha.15')
    mock.clock(on, { now: NOW })
    await $.session.start(SESSION)
    const ui = await mountPane($)
    expect(await header(ui)).toBe('memory-kit ?  0 expired · 1 due ≤7d')
    expect(world.requests).toEqual([])
    await ui.unmount()
  })
})

describe('the memoryDir option', () => {
  const dates = async (ui: Parameters<typeof textOf>[0]) =>
    (await textOf(ui)).filter(t => /^\d{4}-\d{2}-\d{2}$/.test(t))

  test('an absolute memoryDir wins over the cwd memory-kit.conf', { options: { memoryDir: '/srv/home/memory' } }, async ($, on) => {
    worldOf(on, {
      'memory-kit.conf': 'memory_dir: notes\n',
      'notes/obligations.yaml': 'obligations: []\n',
      '/srv/home/memory/obligations.yaml': WORKSHOP_YAML,
    })
    mock.clock(on, { now: NOW })
    await $.session.start(SESSION)
    const ui = await mountPane($)
    expect(await dates(ui)).toHaveLength(6)
    expect((await textOf(ui)).some(t => t.startsWith('no obligations file here'))).toBe(false)
    await ui.unmount()
  })

  test('a relative memoryDir resolves against the working directory', { options: { memoryDir: 'kit-home/memory' } }, async ($, on) => {
    worldOf(on, { 'kit-home/memory/obligations.yaml': WORKSHOP_YAML })
    mock.clock(on, { now: NOW })
    await $.session.start(SESSION)
    const ui = await mountPane($)
    expect(await dates(ui)).toHaveLength(6)
    await ui.unmount()
  })

  test('a blank memoryDir falls back to the cwd conf', { options: { memoryDir: '   ' } }, async ($, on) => {
    worldOf(on, { 'memory-kit.conf': 'memory_dir: notes\n', 'notes/obligations.yaml': WORKSHOP_YAML })
    mock.clock(on, { now: NOW })
    await $.session.start(SESSION)
    const ui = await mountPane($)
    expect(await dates(ui)).toHaveLength(6)
    await ui.unmount()
  })

  // On this POSIX host the engine's $.fs resolves a C:\ path against the process cwd before
  // any hook sees it, so a test cannot serve the file there. It checks where the pane looked:
  // the path in "no obligations file here (...)" is the one memoryRoot built (kit #8).
  const lookedAt = async (ui: Parameters<typeof textOf>[0]) =>
    (await textOf(ui)).find(t => t.startsWith('no obligations file here'))
  for (const dir of ['C:\\Users\\m\\pepys\\memory', 'C:/Users/m/pepys/memory', '\\\\server\\share\\memory']) {
    test(`a Windows absolute memoryDir is not joined to cwd (kit #8): ${dir}`, { options: { memoryDir: dir } }, async ($, on) => {
      worldOf(on, { 'memory/obligations.yaml': WORKSHOP_YAML })
      mock.clock(on, { now: NOW })
      await $.session.start(SESSION)
      const ui = await mountPane($)
      expect(await lookedAt(ui)).toBe(`no obligations file here (${dir}/obligations.yaml)`)
      await ui.unmount()
    })
  }

  test('a Windows absolute memory_dir in memory-kit.conf is not joined to cwd (kit #8)', async ($, on) => {
    worldOf(on, { 'memory-kit.conf': 'memory_dir: D:\\homes\\kit\\memory\n', 'memory/obligations.yaml': WORKSHOP_YAML })
    mock.clock(on, { now: NOW })
    await $.session.start(SESSION)
    const ui = await mountPane($)
    expect(await lookedAt(ui)).toBe('no obligations file here (D:\\homes\\kit\\memory/obligations.yaml)')
    await ui.unmount()
  })

  test('a relative memoryDir still resolves against the working directory (kit #8)', { options: { memoryDir: 'elsewhere/memory' } }, async ($, on) => {
    worldOf(on, {})
    mock.clock(on, { now: NOW })
    await $.session.start(SESSION)
    const ui = await mountPane($)
    expect(await lookedAt(ui)).toBe('no obligations file here (/home/kit/elsewhere/memory/obligations.yaml)')
    await ui.unmount()
  })

  test('a memoryDir pointing nowhere says where it looked', { options: { memoryDir: '/nowhere/memory' } }, async ($, on) => {
    worldOf(on, { 'memory/obligations.yaml': WORKSHOP_YAML })
    mock.clock(on, { now: NOW })
    await $.session.start(SESSION)
    const ui = await mountPane($)
    expect((await textOf(ui)).some(t => t.includes('/nowhere/memory/obligations.yaml'))).toBe(true)
    await ui.unmount()
  })
})

describe('refresh', () => {
  test('every 20 s: the file and the clock', async ($, on) => {
    const world = worldOf(on, KIT)
    const clock = mock.clock(on, { now: NOW })
    await $.session.start(SESSION)
    const ui = await mountPane($)

    world.files.set('/home/kit/memory/obligations.yaml', 'obligations: []\n')
    await clock.advance(19_000)
    expect(await textOf(ui)).not.toContain('no obligations')
    await clock.advance(1_000)
    expect(await textOf(ui)).toContain('no obligations')

    await ui.unmount()
  })

  test('eight days on, the 2026-10-21 row has expired and is marked', async ($, on) => {
    worldOf(on, KIT)
    mock.clock(on, { now: NOW + 8 * 86_400_000 })
    await $.session.start(SESSION)
    const ui = await mountPane($)
    // The header no longer shows the date; the counts still run on today's.
    const header = (await textOf(ui)).find(t => t.includes('expired'))
    expect(header).toBe('memory-kit 0.1.0-alpha.5  1 expired · 4 due ≤7d')
    const expired = await ui.find({ type: 'Text', text: /^2026-10-21$/ })
    expect(expired?.props.backgroundColor).toBeDefined()
    const later = await ui.find({ type: 'Text', text: /^2026-10-28$/ })
    expect(later?.props.backgroundColor).toBeUndefined()
    await ui.unmount()
  })

  test('on turn end', async ($, on) => {
    const world = worldOf(on, KIT)
    mock.clock(on, { now: NOW })
    await $.session.start(SESSION)
    const ui = await mountPane($)
    world.files.set('/home/kit/memory/obligations.yaml', 'obligations: []\n')
    await $.turn.complete({ answer: 'done', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
    expect(await textOf(ui)).toContain('no obligations')
    await ui.unmount()
  })
})

describe('footer agents', () => {
  test('live subagents with the model their spawn resolved to', async ($, on) => {
    const world = worldOf(on, KIT)
    mock.clock(on, { now: NOW })
    on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: 'a1' }))
    await $.session.start(SESSION)

    world.agents = [
      { id: 'a1', name: 'braid-stagger-long', description: 'braid', type: 'teammate', status: 'running' },
      { id: 'a2', description: 'lookup', type: 'Explore', status: 'idle' },
      { id: 'a3', name: 'gone', description: 'x', type: 'Explore', status: 'completed' },
    ]
    await $.agent.spawn({
      tool_use_id: 'tu1',
      prompt: 'p',
      description: 'braid',
      subagentType: 'teammate',
      provider: { plugin: 'engine', tier: 'core' },
      parentModel: 'claude-opus-5-5',
      background: true,
      fork: false,
    } as never)

    const ui = await mountPane($)
    const texts = await textOf(ui)
    expect(texts).toContain('braid-sta… H')
    expect(texts).toContain('lookup     ·')
    const unknown = await ui.find({ type: 'Text', text: /^·$/ })
    expect(unknown?.props.dimColor).toBe(true)
    expect(texts.some(t => t.startsWith('gone'))).toBe(false)
    await ui.unmount()
  })
})

describe('footer context load from turn.step', () => {
  const stepInput = (agentId?: string) => ({
    turnId: 't1',
    index: 0,
    model: 'x',
    messageCount: 1,
    ...(agentId !== undefined && { agentId }),
  })
  const stepResult = (model: string, input: number, read: number) => ({
    turnId: 't1',
    index: 0,
    answer: '',
    toolUses: [],
    stopReason: 'end_turn',
    usage: { input_tokens: input, output_tokens: 0, cache_read_input_tokens: read, cache_creation_input_tokens: 0, model },
  })
  /** Runs one step through the plugins, beneath them a step that answers `result`. */
  const runStep = async ($: Engine, input: object): Promise<unknown> => {
    const stream = $.turn.step(input as never)
    let r = await stream.next()
    while (r.done !== true) r = await stream.next()
    return r.value
  }

  test('loads per subagent, window when on the main model, used alone otherwise; result unchanged', async ($, on) => {
    const world = worldOf(on, KIT)
    mock.clock(on, { now: NOW })
    const answers: Record<string, ReturnType<typeof stepResult>> = {
      main: stepResult('claude-opus-5-5', 1_000, 100_000),
      a1: stepResult('claude-sonnet-5-5', 1_000, 83_000),
      a2: stepResult('claude-opus-5-5', 2_000, 40_000),
    }
    on('turn.step', async function* ($, e) {
      return answers[e.agentId ?? 'main'] as never
    })
    world.agents = [
      { id: 'a1', name: 'coverage-lib', description: 'c', type: 'teammate', status: 'running' },
      { id: 'a2', name: 'hairpin', description: 'h', type: 'teammate', status: 'running' },
      { id: 'a3', name: 'old-one', description: 'o', type: 'teammate', status: 'running' },
    ]
    await $.session.start(SESSION)

    expect(await runStep($, stepInput())).toEqual(answers.main)
    expect(await runStep($, stepInput('a1'))).toEqual(answers.a1)
    await runStep($, stepInput('a2'))

    const ui = await mountPane($)
    const texts = await textOf(ui)
    // The main line keeps the session's own figure: its step is not counted as an agent.
    expect(texts).toContain('kit        O 127k/1M')
    expect(texts).toContain('coverage-… S 84k')
    expect(texts).toContain('hairpin    O 42k/1M')
    // Started before the pane saw a step: dim dot, no load.
    expect(texts).toContain('old-one    ·')
    await ui.unmount()
  })
})

describe('footer at narrow widths', () => {
  test('figures are whole or lose /window, never an ellipsis', async ($, on) => {
    const world = worldOf(on, KIT)
    mock.clock(on, { now: NOW })
    world.tokens = 220_000
    world.agents = [{ id: 'a1', name: 'coverage-lib', description: 'c', type: 'teammate', status: 'running' }]
    on('turn.step', async function* ($, e) {
      return {
        turnId: 't', index: 0, answer: '', toolUses: [], stopReason: 'end_turn',
        usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 285_000, cache_creation_input_tokens: 0, model: e.agentId === undefined ? 'claude-opus-5-5' : 'claude-opus-5-5' },
      } as never
    })
    await $.session.start(SESSION)
    for (const agentId of [undefined, 'a1']) {
      const stream = $.turn.step({ turnId: 't', index: 0, model: 'x', messageCount: 1, ...(agentId !== undefined && { agentId }) } as never)
      let r = await stream.next()
      while (r.done !== true) r = await stream.next()
    }
    const footerAt = async (bodyColumns: number) => {
      const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns }, plugin: PLUGIN } as never)
      const lines = (await textOf(ui)).filter(t => t.startsWith('kit ') || t.startsWith('coverage'))
      const line = await ui.find({ type: 'Text', text: /^kit / })
      const rule = await ui.find({ type: 'Text', text: /^─+$/ })
      const framed = (await ui.findAll({ type: 'Box' })).filter(b => b.props.borderStyle !== undefined)
      await ui.unmount()
      return { lines, wrap: line?.props.wrap, rule: rule?.text, framed: framed.length }
    }

    // 22 columns: 20 inside the footer (paddingX 1), exactly "kit        O 220k/1M".
    expect((await footerAt(22)).lines).toEqual(['kit        O 220k/1M', 'coverage-… O 285k/1M'])
    // One column less: the window goes, the figure stays whole.
    const narrow = await footerAt(21)
    expect(narrow.lines).toEqual(['kit        O 220k', 'coverage-… O 285k'])
    expect(narrow.wrap).toBe('wrap')
    // One rule across the body, no framed box.
    expect(narrow.rule).toBe('─'.repeat(21))
    expect(narrow.framed).toBe(0)
    for (const width of [14, 18, 21, 22, 30]) {
      for (const line of (await footerAt(width)).lines) expect(line.slice(13)).not.toContain('…')
    }
  })
})

describe('mouse wheel', () => {
  const wheel = ($: Engine, by: number) =>
    $.ui.scroll({
      component: 'Pane',
      requestId: 'obligations',
      offset: 0,
      by,
      bodyRows: 40,
      contentRows: 40,
      origin: { kind: 'person' },
      pointer: { row: 5, column: 3 },
    } as never)

  test('strictly one item per burst: |by| ignored, 150 ms throttle, clamped at both ends', async ($, on) => {
    worldOf(on, KIT)
    const clock = mock.clock(on, { now: NOW })
    await $.session.start(SESSION)
    const ui = await mountPane($)
    const position = async () => (await textOf(ui)).find(t => /^\d+\/\d+$/.test(t))
    const firstDate = async () => (await textOf(ui)).find(t => /^\d{4}-\d{2}-\d{2}$/.test(t))

    // |by| = 3 steps one.
    await wheel($, 3)
    expect(await position()).toBe('2/6')
    expect(await firstDate()).toBe('2026-10-28')
    // Two events 50 ms apart: one step.
    await clock.advance(200)
    await wheel($, 1)
    await clock.advance(50)
    await wheel($, 1)
    expect(await position()).toBe('3/6')
    // Two events 200 ms apart: two steps.
    await clock.advance(200)
    await wheel($, 1)
    await clock.advance(200)
    await wheel($, 1)
    expect(await position()).toBe('5/6')
    // Clamped at the end, then at the top.
    for (let i = 0; i < 4; i++) {
      await clock.advance(200)
      await wheel($, 5)
    }
    expect(await position()).toBe('6/6')
    expect(await firstDate()).toBe('2026-12-31')
    for (let i = 0; i < 8; i++) {
      await clock.advance(200)
      await wheel($, -40)
    }
    expect(await position()).toBe('1/6')
    await ui.unmount()
  })

  test('the engine window is kept: header and footer stay, no arrows drawn', async ($, on) => {
    worldOf(on, KIT)
    mock.clock(on, { now: NOW })
    await $.session.start(SESSION)
    const ui = await mountPane($)
    const header = async () => (await textOf(ui)).find(t => t.includes('expired'))
    const footer = async () => (await textOf(ui)).find(t => t.startsWith('kit '))
    const before = { header: await header(), footer: await footer() }

    const result = await wheel($, 1)
    expect(result).toEqual({})
    expect(await header()).toBe(before.header)
    expect(await footer()).toBe(before.footer)
    // The k / j buttons are mounted (hotkeys) but sit in a Box that is not displayed.
    const hidden = (await ui.findAll({ type: 'Box' })).find(b => b.props.display === 'none')
    expect(hidden).toBeDefined()
    expect(hidden?.text).toBe('▲▼')
    await ui.unmount()
  })
})

describe('the pane follows the home the session started in (kit issue #3)', () => {
  const OTHER = '/home/other-repo'
  const OTHER_YAML = 'obligations:\n  - obligation: "the other repo\'s own obligation"\n    actor: "Kit"\n    expires: 2026-01-01\n'
  const dates = async (ui: Parameters<typeof textOf>[0]) => (await textOf(ui)).filter(t => /^\d{4}-\d{2}-\d{2}$/.test(t))

  test('a cd mid-session does not switch the ledger (timer and turn end)', async ($, on) => {
    const world = worldOf(on, { ...KIT, [`${OTHER}/memory/obligations.yaml`]: OTHER_YAML })
    const clock = mock.clock(on, { now: NOW })
    await $.session.start(SESSION)
    const ui = await mountPane($)
    expect(await dates(ui)).toHaveLength(6)

    world.cwd = OTHER
    await clock.advance(20_000)
    await $.turn.complete({ answer: 'done', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
    expect(await dates(ui)).toHaveLength(6)
    expect(await dates(ui)).not.toContain('2026-01-01')
    await ui.unmount()
  })

  test('a reload after the cd (session.start again, new cwd) keeps the first home', async ($, on) => {
    const world = worldOf(on, { ...KIT, [`${OTHER}/memory/obligations.yaml`]: OTHER_YAML })
    mock.clock(on, { now: NOW })
    await $.session.start(SESSION)
    world.cwd = OTHER
    await $.session.start({ ...SESSION, cwd: OTHER })
    const ui = await mountPane($)
    expect(await dates(ui)).toHaveLength(6)
    await ui.unmount()
  })
})

describe('upstream release check (kit #7)', () => {
  const header = async (ui: Parameters<typeof textOf>[0]) => (await textOf(ui)).find(t => t.includes('expired'))

  test('a newer tag upstream: the header says so', async ($, on) => {
    const world = worldOf(on, KIT)
    world.answer = () => tagsAnswer('v0.1.0-alpha.6', 'v0.1.0-alpha.5', 'not-a-release')
    mock.clock(on, { now: NOW })
    await $.session.start(SESSION)
    const ui = await mountPane($)
    expect(await header(ui)).toBe('memory-kit 0.1.0-alpha.5 · alpha.6 out  0 expired · 1 due ≤7d')
    expect(world.requests).toEqual([TAGS_URL])
    await ui.unmount()
  })

  test('alpha.10 is newer than alpha.9', async ($, on) => {
    const world = worldOf(on, { ...KIT, 'memory-kit/VERSION': '0.1.0-alpha.9\n' })
    world.answer = () => tagsAnswer('v0.1.0-alpha.9', 'v0.1.0-alpha.10')
    mock.clock(on, { now: NOW })
    await $.session.start(SESSION)
    const ui = await mountPane($)
    expect(await header(ui)).toBe('memory-kit 0.1.0-alpha.9 · alpha.10 out  0 expired · 1 due ≤7d')
    await ui.unmount()
  })

  test('another major, minor or patch: the whole version', async ($, on) => {
    const world = worldOf(on, KIT)
    world.answer = () => tagsAnswer('v0.2.0', 'v0.1.0-alpha.10')
    mock.clock(on, { now: NOW })
    await $.session.start(SESSION)
    const ui = await mountPane($)
    expect(await header(ui)).toBe('memory-kit 0.1.0-alpha.5 · 0.2.0 out  0 expired · 1 due ≤7d')
    await ui.unmount()
  })

  for (const tags of [['v0.1.0-alpha.5'], ['v0.1.0-alpha.4', 'v0.1.0-alpha.3']]) {
    test(`the same or an older tag (${tags.join(', ')}): nothing extra`, async ($, on) => {
      const world = worldOf(on, KIT)
      world.answer = () => tagsAnswer(...tags)
      mock.clock(on, { now: NOW })
      await $.session.start(SESSION)
      const ui = await mountPane($)
      expect(world.requests).toEqual([TAGS_URL])
      expect(await header(ui)).toBe('memory-kit 0.1.0-alpha.5  0 expired · 1 due ≤7d')
      await ui.unmount()
    })
  }

  const failures: [string, ((url: string) => ReturnType<typeof tagsAnswer>) | undefined][] = [
    ['refused (offline)', undefined],
    ['an error status', () => ({ status: 429, ok: false, headers: {}, text: '{"message":"rate limited"}' })],
    ['junk', () => ({ status: 200, ok: true, headers: {}, text: '<html>captive portal</html>' })],
  ]
  for (const [what, answer] of failures) {
    test(`${what}: nothing extra, no error drawn, one debug line, no retry within 6 h`, async ($, on) => {
      const world = worldOf(on, KIT)
      world.answer = answer
      const clock = mock.clock(on, { now: NOW })
      await $.session.start(SESSION)
      const ui = await mountPane($)
      await clock.advance(20_000)
      const texts = await textOf(ui)
      expect(await header(ui)).toBe('memory-kit 0.1.0-alpha.5  0 expired · 1 due ≤7d')
      expect(texts.some(t => /unreadable|error|fail|upstream/i.test(t))).toBe(false)
      expect(world.requests).toHaveLength(1)
      const lines = world.logs.filter(l => l.includes('upstream'))
      expect(lines).toHaveLength(1)
      expect(lines[0]).toMatch(/^debug: /)
      await ui.unmount()
    })
  }

  test('a failure keeps the last known result', async ($, on) => {
    const world = worldOf(on, KIT, { upstream: { [TAGS_URL]: { checkedAt: NOW - 7 * HOUR, latest: '0.1.0-alpha.6' } } })
    mock.clock(on, { now: NOW })
    await $.session.start(SESSION)
    const ui = await mountPane($)
    expect(world.requests).toEqual([TAGS_URL])
    expect(await header(ui)).toBe('memory-kit 0.1.0-alpha.5 · alpha.6 out  0 expired · 1 due ≤7d')
    await ui.unmount()
  })

  test('within 6 h no request (cache hit); after 6 h, one', async ($, on) => {
    const world = worldOf(on, KIT)
    world.answer = () => tagsAnswer('v0.1.0-alpha.5')
    const clock = mock.clock(on, { now: NOW })
    await $.session.start(SESSION)
    // The release check runs unawaited after session start; a zero advance lets it settle.
    await clock.advance(0)
    expect(world.requests).toHaveLength(1)
    for (let i = 0; i < 5; i++) await clock.advance(HOUR)
    await $.turn.complete({ answer: 'done', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
    await clock.advance(HOUR - 20_000)
    expect(world.requests).toHaveLength(1)
    await clock.advance(20_000)
    expect(world.requests).toHaveLength(2)
    await clock.advance(20_000)
    expect(world.requests).toHaveLength(2)
  })

  test('the cache is shared: a check another session made is used, not repeated', async ($, on) => {
    const world = worldOf(on, KIT, { upstream: { [TAGS_URL]: { checkedAt: NOW - HOUR, latest: '0.1.0-alpha.6' } } })
    mock.clock(on, { now: NOW })
    await $.session.start(SESSION)
    const ui = await mountPane($)
    expect(world.requests).toEqual([])
    expect(await header(ui)).toBe('memory-kit 0.1.0-alpha.5 · alpha.6 out  0 expired · 1 due ≤7d')
    await ui.unmount()
  })

  test('checkUpdates: false makes no request at all', { options: { checkUpdates: false } }, async ($, on) => {
    // A stale cache that names a newer release: a check would be due, and the note would show.
    const world = worldOf(on, KIT, { upstream: { [TAGS_URL]: { checkedAt: NOW - 7 * HOUR, latest: '0.1.0-alpha.6' } } })
    world.answer = () => tagsAnswer('v0.1.0-alpha.6')
    const clock = mock.clock(on, { now: NOW })
    await $.session.start(SESSION)
    const ui = await mountPane($)
    await clock.advance(20_000)
    await $.turn.complete({ answer: 'done', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
    await clock.advance(0)
    expect(world.requests).toEqual([])
    expect(await header(ui)).toBe('memory-kit 0.1.0-alpha.5  0 expired · 1 due ≤7d')
    await ui.unmount()
  })

  test('no memory-kit/VERSION: no request, no comparison, no note', async ($, on) => {
    const { 'memory-kit/VERSION': _, ...noVersion } = KIT
    const world = worldOf(on, noVersion)
    world.answer = () => tagsAnswer('v0.1.0-alpha.6')
    mock.clock(on, { now: NOW })
    await $.session.start(SESSION)
    const ui = await mountPane($)
    expect(world.requests).toEqual([])
    expect(await header(ui)).toBe('0 expired · 1 due ≤7d')
    await ui.unmount()
  })

  test('a fetch that never settles: session start and turn end still return; timed out at 10 s, next try after 6 h', { timeoutMs: 20_000 }, async ($, on) => {
    // 20 s of test time: six mocked hours of 20 s refreshes take a few real seconds.
    const world = worldOf(on, KIT)
    world.answer = 'hang'
    const clock = mock.clock(on, { now: NOW })
    await $.session.start(SESSION)
    await $.turn.complete({ answer: 'done', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
    await clock.advance(10_000)
    expect(world.requests).toHaveLength(1)
    expect(world.logs.filter(l => l.includes('upstream'))).toEqual([expect.stringMatching(/^debug: .*timed out/)])
    // The timeout counted as a check: nothing more until 6 h after it.
    await clock.advance(6 * HOUR - 10_000 - 20_000)
    await $.turn.complete({ answer: 'done', durationMs: 1, isAborted: false, turnId: 't2', reason: 'answer' })
    expect(world.requests).toHaveLength(1)
    world.answer = () => tagsAnswer('v0.1.0-alpha.6')
    await clock.advance(20_000)
    expect(world.requests).toHaveLength(2)
    const ui = await mountPane($)
    expect(await header(ui)).toBe('memory-kit 0.1.0-alpha.5 · alpha.6 out  0 expired · 1 due ≤7d')
    await ui.unmount()
  })

  test('a memoryDir home outside the cwd: VERSION and upstream come from the home that holds the memory dir', { options: { memoryDir: '/srv/home/memory' } }, async ($, on) => {
    const world = worldOf(on, {
      '/srv/home/memory/obligations.yaml': WORKSHOP_YAML,
      '/srv/home/memory-kit/VERSION': '0.1.0-alpha.4\n',
      '/srv/home/memory-kit.conf': 'memory_dir: memory\nupstream: someone/kit-fork\n',
    })
    world.answer = () => tagsAnswer('v0.1.0-alpha.5')
    mock.clock(on, { now: NOW })
    await $.session.start(SESSION)
    const ui = await mountPane($)
    expect(await header(ui)).toBe('memory-kit 0.1.0-alpha.4 · alpha.5 out  0 expired · 1 due ≤7d')
    expect(world.requests).toEqual(['https://codeberg.org/api/v1/repos/someone/kit-fork/tags?limit=50'])
    await ui.unmount()
  })

  test('a memoryDir home without VERSION falls back to the cwd home', { options: { memoryDir: '/srv/home/memory' } }, async ($, on) => {
    worldOf(on, { '/srv/home/memory/obligations.yaml': WORKSHOP_YAML, 'memory-kit/VERSION': '0.1.0-alpha.5\n' })
    mock.clock(on, { now: NOW })
    await $.session.start(SESSION)
    const ui = await mountPane($)
    expect(await header(ui)).toBe('memory-kit 0.1.0-alpha.5  0 expired · 1 due ≤7d')
    await ui.unmount()
  })

  test('upstream: owner/repo in memory-kit.conf picks the repository; a bad value makes no request', async ($, on) => {
    const world = worldOf(on, { ...KIT, 'memory-kit.conf': 'memory_dir: memory\nupstream: someone/kit-fork\n' })
    world.answer = () => tagsAnswer('v0.1.0-rc.1')
    mock.clock(on, { now: NOW })
    await $.session.start(SESSION)
    const ui = await mountPane($)
    expect(world.requests).toEqual(['https://codeberg.org/api/v1/repos/someone/kit-fork/tags?limit=50'])
    expect(await header(ui)).toBe('memory-kit 0.1.0-alpha.5 · rc.1 out  0 expired · 1 due ≤7d')
    await ui.unmount()

    world.files.set('/home/kit/memory-kit.conf', 'upstream: https://evil.example/tags\n')
    world.requests.length = 0
    await $.session.start(SESSION)
    expect(world.requests).toEqual([])
  })
})
