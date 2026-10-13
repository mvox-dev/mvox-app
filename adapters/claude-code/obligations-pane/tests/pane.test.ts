import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { LINK_FG, MODEL_COLORS, PANE_BG } from '../hooks/obligations'
import { PRUSA_URL_FILE, WORKSHOP_YAML } from './fixtures/data'
import { PANE, PLUGIN, SESSION, worldOf } from './fixtures/world'

const NOW = Date.parse('2026-10-14T12:00:00Z')
const KIT = { 'memory/obligations.yaml': WORKSHOP_YAML, 'memory/urls/prusa-start-ooze-issue': PRUSA_URL_FILE }

/** The header clock as the mod computes it: the environment's own zone, else the host's +0300. */
const expectedClock = () => {
  const own = -new Date(NOW).getTimezoneOffset()
  return new Date(NOW + (own !== 0 ? own : 180) * 60_000).toISOString().slice(0, 16).replace('T', ' ')
}

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
      const header = texts.find(t => t.startsWith('2026-'))
      expect(header).toBe(`${expectedClock()}  0 expired · 1 due ≤7d`)

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
    expect(texts.find(t => t.startsWith('2026-'))).toBe(`${expectedClock()}  0 expired · 0 due ≤7d`)
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
    const header = (await textOf(ui)).find(t => t.startsWith('2026-'))
    expect(header).toMatch(/^2026-10-22 .* 1 expired · 4 due ≤7d$/)
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
    const header = async () => (await textOf(ui)).find(t => t.startsWith('2026-') && t.includes('expired'))
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
