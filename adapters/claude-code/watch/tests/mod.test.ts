import { describe, expect, mock, test } from 'claude-code/testing'

import { bookmarkFor, LINES_CAP, textHash } from '../hooks/watch'
import { CWD, HOME, newSession, SESSION, typed, worldOf } from './fixtures/world'

const NOW = Date.parse('2026-10-14T12:00:00Z')
const MIN = 60_000

const INBOX = `${CWD}/comms/inboxes/team-lead.json`
const LINKS = `${HOME}/spool/links.txt`
const CONF = [
  'memory_dir: memory',
  'watch_files:',
  '  - label: "hub mail"',
  '    path: comms/inboxes/team-lead.json',
  '    instruction: "consume the inbox or new messages won\'t land"',
  '    inject: false',
  '  - label: ""',
  '    path: ~/spool/links.txt',
  '    instruction: ""',
  '    inject: true',
  '',
].join('\n')

// Rings are queued unawaited ($.prompt.submit resolves only when its turn starts), so a test
// lets them settle with a zero clock advance before it looks.

describe('doorbells: ring on growth, never touch the file', () => {
  test('a file with content at session start rings once, with the home instruction, and is not touched', async ($, on) => {
    const world = worldOf(on, { 'memory-kit.conf': CONF, [INBOX]: '[{"from":"po","text":"Ping"}]' })
    const clock = mock.clock(on, { now: NOW })
    await $.session.start(SESSION)
    await clock.advance(0)
    expect(world.submitted).toEqual([`[hub mail] ${INBOX} grew. consume the inbox or new messages won't land`])
    expect(world.files.get(INBOX)).toBe('[{"from":"po","text":"Ping"}]')
    expect(world.commands).toEqual([])
    // No growth: no second ring, however long it sits unconsumed.
    await clock.advance(60_000)
    expect(world.submitted).toHaveLength(1)
  })

  test('consuming (emptying) re-arms the bell: the next write rings again', async ($, on) => {
    const world = worldOf(on, { 'memory-kit.conf': CONF, [INBOX]: '[{"m":1}]' })
    const clock = mock.clock(on, { now: NOW })
    await $.session.start(SESSION)
    await clock.advance(0)
    expect(world.submitted).toHaveLength(1)
    world.files.set(INBOX, '')
    await clock.advance(5_000)
    expect(world.submitted).toHaveLength(1)
    world.files.set(INBOX, '[{"m":2}]')
    await clock.advance(5_000)
    expect(world.submitted).toHaveLength(2)
  })

  test('consuming by deleting works the same', async ($, on) => {
    const world = worldOf(on, { 'memory-kit.conf': CONF, [INBOX]: '[{"m":1}]' })
    const clock = mock.clock(on, { now: NOW })
    await $.session.start(SESSION)
    await clock.advance(0)
    world.files.delete(INBOX)
    await clock.advance(5_000)
    expect(world.submitted).toHaveLength(1)
    world.files.set(INBOX, '[{"m":2}]')
    await clock.advance(5_000)
    expect(world.submitted).toHaveLength(2)
  })

  test('created at 0 bytes is not growth; cut shorter is other text, a replacement; growing past it rings', async ($, on) => {
    const world = worldOf(on, { 'memory-kit.conf': CONF })
    const clock = mock.clock(on, { now: NOW })
    await $.session.start(SESSION)
    await clock.advance(0)
    world.files.set(INBOX, '')
    await clock.advance(5_000)
    expect(world.submitted).toEqual([])
    world.files.set(INBOX, '0123456789')
    await clock.advance(5_000)
    expect(world.submitted).toHaveLength(1)
    world.files.set(INBOX, '0123')
    await clock.advance(5_000)
    expect(world.submitted).toHaveLength(2)
    expect(world.submitted[1]).toBe(`[hub mail] ${INBOX} was replaced. consume the inbox or new messages won't land`)
    world.files.set(INBOX, '012345')
    await clock.advance(5_000)
    expect(world.submitted).toHaveLength(3)
    expect(world.submitted[2]).toBe(`[hub mail] ${INBOX} grew. consume the inbox or new messages won't land`)
  })

  test('consumed and refilled between two polls by a shorter message still rings (kit #52)', async ($, on) => {
    const world = worldOf(on, { 'memory-kit.conf': CONF, [INBOX]: '[{"from":"mvox","text":"a long message"}]' })
    const clock = mock.clock(on, { now: NOW })
    await $.session.start(SESSION)
    await clock.advance(0)
    expect(world.submitted).toHaveLength(1)
    // The home deletes the inbox and the courier writes the next mail before the watch polls.
    world.files.set(INBOX, '[{"from":"po","text":"hi"}]')
    await clock.advance(5_000)
    expect(world.submitted).toEqual([
      `[hub mail] ${INBOX} grew. consume the inbox or new messages won't land`,
      `[hub mail] ${INBOX} was replaced. consume the inbox or new messages won't land`,
    ])
    // Nothing new after it: no second ring for the same mail.
    await clock.advance(60_000)
    expect(world.submitted).toHaveLength(2)
  })

  test('refilled by a message of the same size rings; the same text written again does not', async ($, on) => {
    const world = worldOf(on, { 'memory-kit.conf': CONF, [INBOX]: '[{"m":1}]' })
    const clock = mock.clock(on, { now: NOW })
    await $.session.start(SESSION)
    await clock.advance(0)
    world.files.set(INBOX, '[{"m":2}]')
    await clock.advance(5_000)
    expect(world.submitted).toHaveLength(2)
    world.files.set(INBOX, '[{"m":2}]')
    await clock.advance(5_000)
    expect(world.submitted).toHaveLength(2)
  })

  test('inject: a replaced file rings its whole new text, not a tail past the old size', async ($, on) => {
    const world = worldOf(on, { 'memory-kit.conf': CONF, [LINKS]: 'https://a\nhttps://b\n' })
    const clock = mock.clock(on, { now: NOW })
    await $.session.start(SESSION)
    await clock.advance(0)
    world.files.set(LINKS, 'https://c\nhttps://d\nhttps://e\n')
    await clock.advance(5_000)
    expect(world.submitted[1]).toBe(`[links.txt] ${LINKS} was replaced.\nhttps://c\nhttps://d\nhttps://e`)
  })

  test('a refused replacement rolls back and rings again once the refusal lifts', async ($, on) => {
    const world = worldOf(on, { 'memory-kit.conf': CONF, [INBOX]: '[{"from":"mvox","text":"a long message"}]' })
    const clock = mock.clock(on, { now: NOW })
    await $.session.start(SESSION)
    await clock.advance(0)
    world.refuse = 'another plugin holds prompts'
    world.files.set(INBOX, '[{"m":2}]')
    await clock.advance(5_000)
    expect(world.submitted).toHaveLength(1)
    world.refuse = undefined
    await clock.advance(5_000)
    expect(world.submitted[1]).toBe(`[hub mail] ${INBOX} was replaced. consume the inbox or new messages won't land`)
  })

  test('inject: the ring carries the grown tail, and the next ring only what is new', async ($, on) => {
    const world = worldOf(on, { 'memory-kit.conf': CONF, [LINKS]: 'https://a\n' })
    const clock = mock.clock(on, { now: NOW })
    await $.session.start(SESSION)
    await clock.advance(0)
    expect(world.submitted).toEqual([`[links.txt] ${LINKS} grew.\nhttps://a`])
    world.files.set(LINKS, 'https://a\nhttps://b\nhttps://c\n')
    await clock.advance(5_000)
    expect(world.submitted[1]).toBe(`[links.txt] ${LINKS} grew.\nhttps://b\nhttps://c`)
  })

  test('two doorbells grow in one poll: one prompt', async ($, on) => {
    const world = worldOf(on, { 'memory-kit.conf': CONF, [INBOX]: '[1]', [LINKS]: 'https://a\n' })
    const clock = mock.clock(on, { now: NOW })
    await $.session.start(SESSION)
    await clock.advance(0)
    expect(world.submitted).toEqual([
      `[watch] 2 doorbells:\n[hub mail] ${INBOX} grew. consume the inbox or new messages won't land\n[links.txt] ${LINKS} grew.\nhttps://a`,
    ])
  })

  test('a refused ring rolls its baseline back and rings again once the refusal lifts', async ($, on) => {
    const world = worldOf(on, { 'memory-kit.conf': CONF, [INBOX]: '[1]' })
    world.refuse = 'another plugin holds prompts'
    const clock = mock.clock(on, { now: NOW })
    await $.session.start(SESSION)
    await clock.advance(0)
    expect(world.attempts).toHaveLength(1)
    expect(world.submitted).toEqual([])
    world.refuse = undefined
    await clock.advance(5_000)
    expect(world.submitted).toEqual([`[hub mail] ${INBOX} grew. consume the inbox or new messages won't land`])
  })

  test('a glob path: each matched file is its own bell, dotfiles never', async ($, on) => {
    const conf = 'watch_files:\n  - label: team\n    path: /teams/session-*/inbox.json\n    instruction: ""\n    inject: false\n'
    const world = worldOf(on, { 'memory-kit.conf': conf, '/teams/session-a/inbox.json': '[1]', '/teams/session-b/inbox.json': '[2]' })
    const clock = mock.clock(on, { now: NOW })
    await $.session.start(SESSION)
    await clock.advance(0)
    expect(world.submitted).toEqual(['[watch] 2 doorbells:\n[team] /teams/session-a/inbox.json grew.\n[team] /teams/session-b/inbox.json grew.'])
  })

  test('watch_sources still in the conf: one migration notice, nothing delivered from it', async ($, on) => {
    const world = worldOf(on, { 'memory-kit.conf': 'watch_sources:\n  - "hub mail | hub | comms/inboxes/team-lead.json"\n', [INBOX]: '[1]' })
    const clock = mock.clock(on, { now: NOW })
    await $.session.start(SESSION)
    await clock.advance(60_000)
    expect(world.notified.filter(n => n.includes('watch_sources') && n.includes('watch_files'))).toHaveLength(1)
    expect(world.submitted).toEqual([])
    expect(world.files.get(INBOX)).toBe('[1]')
  })

  test('a broken entry is one visible notice; the good ones still ring', async ($, on) => {
    const conf = 'watch_files:\n  - label: a\n  - label: b\n    path: b.txt\n    instruction: ""\n    inject: false\n'
    const world = worldOf(on, { 'memory-kit.conf': conf, 'b.txt': 'x' })
    const clock = mock.clock(on, { now: NOW })
    await $.session.start(SESSION)
    await clock.advance(60_000)
    expect(world.notified).toEqual([expect.stringContaining('entry 1: no path')])
    expect(world.submitted).toEqual([`[b] ${CWD}/b.txt grew.`])
  })

  test('watch_files: declared empty-handed is one notice, not one per poll', async ($, on) => {
    const world = worldOf(on, { 'memory-kit.conf': 'watch_files:\nmode: gate\n' })
    const clock = mock.clock(on, { now: NOW })
    await $.session.start(SESSION)
    await clock.advance(60_000)
    expect(world.notified.filter(n => n.includes('watch_files'))).toHaveLength(1)
    expect(world.notified.some(n => n.includes(`${CWD}/memory-kit.conf`))).toBe(true)
  })

  test('where no channel shows a notice, it goes to the transcript', async ($, on) => {
    const world = worldOf(on, { 'memory-kit.conf': 'watch_files:\nmode: gate\n' })
    world.notifyResult = { isSent: false, reason: 'no-channel' }
    const clock = mock.clock(on, { now: NOW })
    await $.session.start(SESSION)
    await clock.advance(0)
    expect(world.logs.filter(l => l.startsWith('transcript: ') && l.includes('watch_files'))).toHaveLength(1)
  })

  test('no conf at all (not a kit home, kit #35): the watch is silent', async ($, on) => {
    const world = worldOf(on, {})
    const clock = mock.clock(on, { now: NOW })
    await $.session.start(SESSION)
    await clock.advance(60_000)
    expect(world.submitted).toEqual([])
    expect(world.notified).toEqual([])
  })
})

describe('a consumer that rewrites its inbox, as esl-suvekool does (kit #57)', () => {
  // The courier writes the inbox as JSON with indent 1; the consumer (hub-consume.py) takes the
  // hub mail and writes back what it leaves -- [] or the teammates' entries, with indent 2.
  const HUB1 = { from: 'hub', text: 'mvox: the 06:37 delivery, with a long body', timestamp: '2026-10-24T06:37:00Z' }
  const HUB2 = { from: 'hub', text: 'po: the 06:38 delivery', timestamp: '2026-10-24T06:38:00Z' }
  const MATE = { from: 'poster', text: 'the poster is done', timestamp: '2026-10-24T06:36:00Z' }
  const NEW = { from: 'hub', text: 'hi', timestamp: '2026-10-24T07:00:00Z' }
  const courier = (...entries: object[]) => JSON.stringify(entries, null, 1)
  const consumer = (...entries: object[]) => JSON.stringify(entries, null, 2)
  const GREW = `[hub mail] ${INBOX} grew. consume the inbox or new messages won't land`
  const REPLACED = `[hub mail] ${INBOX} was replaced. consume the inbox or new messages won't land`

  test('consumed down to []: no ring; the next mail, shorter, rings as a replacement', async ($, on) => {
    const world = worldOf(on, { 'memory-kit.conf': CONF, [INBOX]: courier(HUB1, HUB2) })
    const clock = mock.clock(on, { now: NOW })
    await $.session.start(SESSION)
    await clock.advance(0)
    expect(world.submitted).toEqual([GREW])
    world.files.set(INBOX, '[]')
    await clock.advance(5_000)
    expect(world.submitted).toEqual([GREW])
    world.files.set(INBOX, courier(NEW))
    await clock.advance(5_000)
    expect(world.submitted).toEqual([GREW, REPLACED])
    await clock.advance(60_000)
    expect(world.submitted).toHaveLength(2)
  })

  test("consumed down to a teammate's entry, re-indented: no ring; new mail beside it rings", async ($, on) => {
    const world = worldOf(on, { 'memory-kit.conf': CONF, [INBOX]: courier(HUB1, MATE) })
    const clock = mock.clock(on, { now: NOW })
    await $.session.start(SESSION)
    await clock.advance(0)
    world.files.set(INBOX, consumer(MATE))
    await clock.advance(5_000)
    expect(world.submitted).toEqual([GREW])
    world.files.set(INBOX, courier(MATE, NEW))
    await clock.advance(5_000)
    expect(world.submitted).toEqual([GREW, REPLACED])
  })

  test('consumed and refilled with shorter mail between two polls still rings (kit #52)', async ($, on) => {
    const world = worldOf(on, { 'memory-kit.conf': CONF, [INBOX]: courier(HUB1, HUB2) })
    const clock = mock.clock(on, { now: NOW })
    await $.session.start(SESSION)
    await clock.advance(0)
    world.files.set(INBOX, '[]')
    world.files.set(INBOX, courier(NEW))
    await clock.advance(5_000)
    expect(world.submitted).toEqual([GREW, REPLACED])
  })

  test('a bookmark an older watch kept (no lines): a replacement rings as in watch 0.7.0; the next one is judged by lines', async ($, on) => {
    const SEEN = courier(HUB1, HUB2)
    const world = worldOf(on, { 'memory-kit.conf': CONF, [INBOX]: '[]' })
    // The plugin updated and reloaded mid-session, and the consumer ran before its first poll.
    world.state.set('watch/bellSizes', { value: { [INBOX]: SEEN.length }, version: 1 })
    world.state.set('watch/bellHashes', { value: { [INBOX]: textHash(SEEN) }, version: 1 })
    const clock = mock.clock(on, { now: NOW })
    await $.session.start(SESSION)
    await clock.advance(0)
    expect(world.submitted).toEqual([REPLACED])
    world.files.set(INBOX, courier(NEW))
    await clock.advance(5_000)
    world.files.set(INBOX, '[]')
    await clock.advance(5_000)
    expect(world.submitted).toEqual([REPLACED, REPLACED])
  })

  test('a bookmark an older watch kept, of the text still there, takes its lines at the next poll', async ($, on) => {
    const SEEN = courier(HUB1, MATE)
    const world = worldOf(on, { 'memory-kit.conf': CONF, [INBOX]: SEEN })
    world.state.set('watch/bellSizes', { value: { [INBOX]: SEEN.length }, version: 1 })
    world.state.set('watch/bellHashes', { value: { [INBOX]: textHash(SEEN) }, version: 1 })
    const clock = mock.clock(on, { now: NOW })
    await $.session.start(SESSION)
    await clock.advance(0)
    world.files.set(INBOX, consumer(MATE))
    await clock.advance(5_000)
    expect(world.submitted).toEqual([])
  })

  test('a file past the size cap keeps no lines: a replacement rings as in watch 0.7.0', async ($, on) => {
    const BIG = { from: 'hub', text: 'x'.repeat(LINES_CAP), timestamp: '2026-10-24T06:37:00Z' }
    const world = worldOf(on, { 'memory-kit.conf': CONF, [INBOX]: courier(BIG, MATE) })
    const clock = mock.clock(on, { now: NOW })
    await $.session.start(SESSION)
    await clock.advance(0)
    world.files.set(INBOX, consumer(MATE))
    await clock.advance(5_000)
    expect(world.submitted).toEqual([GREW, REPLACED])
    // Back under the cap, the bookmark keeps lines again.
    world.files.set(INBOX, '[]')
    await clock.advance(5_000)
    expect(world.submitted).toEqual([GREW, REPLACED])
  })

  test('a refused replacement rolls back its lines too, and rings again once the refusal lifts', async ($, on) => {
    const world = worldOf(on, { 'memory-kit.conf': CONF, [INBOX]: courier(HUB1, MATE) })
    const clock = mock.clock(on, { now: NOW })
    await $.session.start(SESSION)
    await clock.advance(0)
    world.refuse = 'another plugin holds prompts'
    world.files.set(INBOX, courier(MATE, NEW))
    await clock.advance(5_000)
    expect(world.submitted).toEqual([GREW])
    world.refuse = undefined
    await clock.advance(5_000)
    expect(world.submitted).toEqual([GREW, REPLACED])
  })

  test('a tail-style file: the kept bookmark carries the lines; cut to a part of itself, a new session rings nothing', async ($, on) => {
    const world = worldOf(on, { 'memory-kit.conf': CONF, [LINKS]: 'https://a\nhttps://b\n' })
    const clock = mock.clock(on, { now: NOW })
    await $.session.start(SESSION)
    await clock.advance(0)
    expect(world.store.get(`bells:${CWD}`)).toEqual({ [LINKS]: bookmarkFor('https://a\nhttps://b\n') })
    newSession(world)
    world.files.set(LINKS, 'https://b\n')
    await $.session.start(SESSION)
    await clock.advance(5_000)
    expect(world.submitted).toEqual([`[links.txt] ${LINKS} grew.\nhttps://a\nhttps://b`])
    expect(world.store.get(`bells:${CWD}`)).toEqual({ [LINKS]: bookmarkFor('https://b\n') })
  })

  test('a tail-style bookmark an older watch kept in the store (no lines): a replacement rings as in watch 0.7.0', async ($, on) => {
    const TWO = 'https://a\nhttps://b\n'
    const world = worldOf(on, { 'memory-kit.conf': CONF, [LINKS]: 'https://b\n' }, { [`bells:${CWD}`]: { [LINKS]: { size: TWO.length, hash: textHash(TWO) } } })
    const clock = mock.clock(on, { now: NOW })
    await $.session.start(SESSION)
    await clock.advance(5_000)
    expect(world.submitted).toEqual([`[links.txt] ${LINKS} was replaced.\nhttps://b`])
    expect(world.store.get(`bells:${CWD}`)).toEqual({ [LINKS]: bookmarkFor('https://b\n') })
  })
})

describe('a tail-style bookmark outlives the session (kit #51)', () => {
  const BELLS = `bells:${CWD}`
  const TWO = 'https://a\nhttps://b\n'

  test('after a /clear a tail-style file rings only what is new, not the whole file again', async ($, on) => {
    const world = worldOf(on, { 'memory-kit.conf': CONF, [LINKS]: 'https://a\n' })
    const clock = mock.clock(on, { now: NOW })
    await $.session.start(SESSION)
    await clock.advance(0)
    world.files.set(LINKS, TWO)
    await clock.advance(5_000)
    expect(world.submitted).toEqual([`[links.txt] ${LINKS} grew.\nhttps://a`, `[links.txt] ${LINKS} grew.\nhttps://b`])
    newSession(world)
    await $.session.start(SESSION)
    await clock.advance(60_000)
    expect(world.submitted).toHaveLength(2)
    world.files.set(LINKS, `${TWO}https://c\n`)
    await clock.advance(5_000)
    expect(world.submitted[2]).toBe(`[links.txt] ${LINKS} grew.\nhttps://c`)
  })

  test('lines written while no session ran ring at the next session start, and only they', async ($, on) => {
    const world = worldOf(on, { 'memory-kit.conf': CONF, [LINKS]: 'https://a\n' })
    const clock = mock.clock(on, { now: NOW })
    await $.session.start(SESSION)
    await clock.advance(0)
    newSession(world)
    world.files.set(LINKS, `${TWO}https://c\n`)
    await $.session.start(SESSION)
    await clock.advance(0)
    expect(world.submitted).toEqual([`[links.txt] ${LINKS} grew.\nhttps://a`, `[links.txt] ${LINKS} grew.\nhttps://b\nhttps://c`])
  })

  test('an inbox-style file keeps a per-session bookmark: unconsumed, it rings once in the new session', async ($, on) => {
    const world = worldOf(on, { 'memory-kit.conf': CONF, [INBOX]: '[{"m":1}]' })
    const clock = mock.clock(on, { now: NOW })
    await $.session.start(SESSION)
    await clock.advance(0)
    newSession(world)
    await $.session.start(SESSION)
    await clock.advance(60_000)
    const ring = `[hub mail] ${INBOX} grew. consume the inbox or new messages won't land`
    expect(world.submitted).toEqual([ring, ring])
    expect(Object.keys((world.store.get(BELLS) ?? {}) as object)).not.toContain(INBOX)
  })

  test("the bookmark is kept per home in the plugin's own store, never in the home", async ($, on) => {
    const world = worldOf(on, { 'memory-kit.conf': CONF, [LINKS]: TWO })
    const clock = mock.clock(on, { now: NOW })
    await $.session.start(SESSION)
    await clock.advance(0)
    expect(world.store.get(BELLS)).toEqual({ [LINKS]: bookmarkFor(TWO) })
    expect([...world.files.keys()].sort()).toEqual([`${CWD}/memory-kit.conf`, LINKS])
  })

  test('another home watching the same file keeps a bookmark of its own: each home rings it', async ($, on) => {
    const DESK = '/home/u/desk'
    const world = worldOf(on, { 'memory-kit.conf': CONF, [`${DESK}/memory-kit.conf`]: CONF, [LINKS]: TWO })
    world.root = DESK
    const clock = mock.clock(on, { now: NOW })
    await $.session.start({ ...SESSION, cwd: DESK })
    await clock.advance(0)
    newSession(world)
    world.root = CWD
    await $.session.start(SESSION)
    await clock.advance(0)
    const ring = `[links.txt] ${LINKS} grew.\nhttps://a\nhttps://b`
    expect(world.submitted).toEqual([ring, ring])
    expect([...world.store.keys()].sort()).toEqual([`bells:${DESK}`, BELLS])
  })

  test('a bookmark an older watch kept in $.state folds in without a false ring', async ($, on) => {
    const world = worldOf(on, { 'memory-kit.conf': CONF, [LINKS]: TWO })
    // The plugin updated and reloaded mid-session: $.state still holds the older watch's bookmark.
    world.state.set('watch/bellSizes', { value: { [LINKS]: TWO.length }, version: 1 })
    world.state.set('watch/bellHashes', { value: { [LINKS]: textHash(TWO) }, version: 1 })
    const clock = mock.clock(on, { now: NOW })
    await $.session.start(SESSION)
    await clock.advance(5_000)
    expect(world.submitted).toEqual([])
    newSession(world)
    await $.session.start(SESSION)
    await clock.advance(5_000)
    expect(world.submitted).toEqual([])
    world.files.set(LINKS, `${TWO}https://c\n`)
    await clock.advance(5_000)
    expect(world.submitted).toEqual([`[links.txt] ${LINKS} grew.\nhttps://c`])
  })

  test('two sessions in one home each keep their own bookmark: both ring a new line', async ($, on) => {
    const world = worldOf(on, { 'memory-kit.conf': CONF, [LINKS]: 'https://a\n' })
    const clock = mock.clock(on, { now: NOW })
    await $.session.start(SESSION)
    await clock.advance(0)
    // A line arrives, and the other session's ring of it enters first, moving the kept bookmark.
    world.files.set(LINKS, TWO)
    world.store.set(BELLS, { [LINKS]: bookmarkFor(TWO) })
    await clock.advance(5_000)
    expect(world.submitted).toEqual([`[links.txt] ${LINKS} grew.\nhttps://a`, `[links.txt] ${LINKS} grew.\nhttps://b`])
  })

  test('a refused ring leaves the kept bookmark behind, and rings again once the refusal lifts', async ($, on) => {
    const world = worldOf(on, { 'memory-kit.conf': CONF, [LINKS]: 'https://a\n' })
    world.refuse = 'another plugin holds prompts'
    const clock = mock.clock(on, { now: NOW })
    await $.session.start(SESSION)
    await clock.advance(0)
    expect(world.attempts).toHaveLength(1)
    world.refuse = undefined
    newSession(world)
    await $.session.start(SESSION)
    await clock.advance(0)
    expect(world.submitted).toEqual([`[links.txt] ${LINKS} grew.\nhttps://a`])
  })

  test('a ring still queued when its session ends rings again in the next session', async ($, on) => {
    const world = worldOf(on, { 'memory-kit.conf': CONF, [LINKS]: 'https://a\n' })
    const clock = mock.clock(on, { now: NOW })
    await $.session.start(SESSION)
    await clock.advance(5_000)
    // A busy closing turn: the ring of b queues behind it, and the session ends before it enters.
    world.hold = true
    world.files.set(LINKS, TWO)
    await clock.advance(5_000)
    expect(world.attempts).toHaveLength(2)
    world.hold = false
    newSession(world)
    await $.session.start(SESSION)
    await clock.advance(30_000)
    expect(world.submitted).toEqual([`[links.txt] ${LINKS} grew.\nhttps://a`, `[links.txt] ${LINKS} grew.\nhttps://b`])
  })

  test('a queued ring that enters late moves the kept bookmark then: the next session does not ring it again', async ($, on) => {
    const world = worldOf(on, { 'memory-kit.conf': CONF, [LINKS]: 'https://a\n' })
    const clock = mock.clock(on, { now: NOW })
    await $.session.start(SESSION)
    await clock.advance(5_000)
    world.hold = true
    world.files.set(LINKS, TWO)
    await clock.advance(30_000)
    expect(world.store.get(BELLS)).toEqual({ [LINKS]: bookmarkFor('https://a\n') })
    world.release()
    world.hold = false
    await clock.advance(0)
    expect(world.store.get(BELLS)).toEqual({ [LINKS]: bookmarkFor(TWO) })
    newSession(world)
    await $.session.start(SESSION)
    await clock.advance(30_000)
    expect(world.submitted).toEqual([`[links.txt] ${LINKS} grew.\nhttps://a`, `[links.txt] ${LINKS} grew.\nhttps://b`])
  })

  test("a ring the last session left queued does not hold the new session's kept bookmark back", async ($, on) => {
    const world = worldOf(on, { 'memory-kit.conf': CONF, [LINKS]: 'https://a\n' })
    const clock = mock.clock(on, { now: NOW })
    await $.session.start(SESSION)
    await clock.advance(5_000)
    world.hold = true
    world.files.set(LINKS, TWO)
    await clock.advance(5_000)
    world.hold = false
    newSession(world)
    // The new session rings b again; the store takes no write until a later poll.
    world.storeSetFails = true
    await $.session.start(SESSION)
    await clock.advance(5_000)
    world.storeSetFails = false
    await clock.advance(5_000)
    expect(world.store.get(BELLS)).toEqual({ [LINKS]: bookmarkFor(TWO) })
  })

  test('a store that can be read but not written: the session keeps its own bookmark, each line rings once', async ($, on) => {
    const world = worldOf(on, { 'memory-kit.conf': CONF, [LINKS]: 'https://a\n' })
    const clock = mock.clock(on, { now: NOW })
    await $.session.start(SESSION)
    await clock.advance(5_000)
    // A full disk, a read-only configuration folder, or a store over 4 MiB: set is refused, get still answers.
    world.storeSetFails = true
    world.files.set(LINKS, TWO)
    await clock.advance(30_000)
    expect(world.submitted).toEqual([`[links.txt] ${LINKS} grew.\nhttps://a`, `[links.txt] ${LINKS} grew.\nhttps://b`])
    expect(world.logs.filter(l => l.includes('store'))).toEqual([expect.stringContaining('cannot be written')])
    // The store keeps the bookmark it last took: a new session rings again what came since.
    newSession(world)
    await $.session.start(SESSION)
    await clock.advance(5_000)
    expect(world.submitted.slice(2)).toEqual([`[links.txt] ${LINKS} grew.\nhttps://b`])
  })

  test('a store that cannot be read for a while rings no line twice, and catches up when it can', async ($, on) => {
    const world = worldOf(on, { 'memory-kit.conf': CONF, [LINKS]: 'https://a\n' })
    const clock = mock.clock(on, { now: NOW })
    await $.session.start(SESSION)
    await clock.advance(5_000)
    world.storeFails = true
    world.files.set(LINKS, TWO)
    await clock.advance(5_000)
    world.storeFails = false
    await clock.advance(30_000)
    expect(world.submitted).toEqual([`[links.txt] ${LINKS} grew.\nhttps://a`, `[links.txt] ${LINKS} grew.\nhttps://b`])
    expect(world.store.get(BELLS)).toEqual({ [LINKS]: bookmarkFor(TWO) })
  })

  test('one file declared inbox-style, then tail-style: the first entry keeps it, one ring per new text', async ($, on) => {
    const entry = (path: string, inject: boolean) => `  - label: spool\n    path: ${path}\n    instruction: ""\n    inject: ${inject}\n`
    const world = worldOf(on, { 'memory-kit.conf': `watch_files:\n${entry('spool.txt', false)}${entry('./spool.txt', true)}`, 'spool.txt': 'x\n' })
    const clock = mock.clock(on, { now: NOW })
    await $.session.start(SESSION)
    await clock.advance(0)
    world.files.set(`${CWD}/spool.txt`, 'x\ny\n')
    await clock.advance(5_000)
    expect(world.submitted).toEqual([`[spool] ${CWD}/spool.txt grew.`, `[spool] ${CWD}/spool.txt grew.`])
  })

  test('a store that cannot be read: the bookmark lasts the session, as before, and that is said once', async ($, on) => {
    const world = worldOf(on, { 'memory-kit.conf': CONF, [LINKS]: 'https://a\n' })
    world.storeFails = true
    const clock = mock.clock(on, { now: NOW })
    await $.session.start(SESSION)
    await clock.advance(30_000)
    world.files.set(LINKS, TWO)
    await clock.advance(30_000)
    expect(world.submitted).toEqual([`[links.txt] ${LINKS} grew.\nhttps://a`, `[links.txt] ${LINKS} grew.\nhttps://b`])
    expect(world.logs.filter(l => l.includes('store'))).toEqual([expect.stringContaining('this session only')])
  })
})

describe('kit_home: the start folder points at the home (kit #18)', () => {
  const DESK = '/home/u/desk'
  const DESK_CONF = 'watch_files:\n  - label: doorbell\n    path: spool.txt\n    instruction: ""\n    inject: false\n'

  test('a pointer conf: doorbells come from the home it names, paths relative to that home', async ($, on) => {
    const world = worldOf(on, { 'memory-kit.conf': 'kit_home: ../desk\n', [`${DESK}/memory-kit.conf`]: DESK_CONF, [`${DESK}/spool.txt`]: 'ring\n' })
    const clock = mock.clock(on, { now: NOW })
    await $.session.start(SESSION)
    await clock.advance(0)
    expect(world.submitted).toEqual([`[doorbell] ${DESK}/spool.txt grew.`])
  })

  test('a broken pointer: one visible notice, nothing rung, the start folder not used instead', async ($, on) => {
    const world = worldOf(on, {
      'memory-kit.conf': 'kit_home: ../nowhere\nwatch_files:\n  - label: local\n    path: spool.txt\n    instruction: ""\n    inject: false\n',
      'spool.txt': 'x\n',
    })
    const clock = mock.clock(on, { now: NOW })
    await $.session.start(SESSION)
    await clock.advance(30_000)
    expect(world.notified).toEqual([expect.stringContaining('no memory-kit.conf there')])
    expect(world.submitted).toEqual([])
  })

  test('watch_files left in a pointer conf are ignored, and said so', async ($, on) => {
    const world = worldOf(on, {
      'memory-kit.conf': 'kit_home: ../desk\nwatch_files:\n  - label: local\n    path: spool.txt\n    instruction: ""\n    inject: false\n',
      [`${DESK}/memory-kit.conf`]: 'memory_dir: memory\n',
      'spool.txt': 'x\n',
    })
    const clock = mock.clock(on, { now: NOW })
    await $.session.start(SESSION)
    await clock.advance(10_000)
    expect(world.submitted).toEqual([])
    expect(world.notified).toEqual([expect.stringMatching(/watch_files .*ignored.*desk\/memory-kit\.conf/)])
  })

  test('/watch names the home and the pointer', async ($, on) => {
    worldOf(on, { 'memory-kit.conf': 'kit_home: ../desk\n', [`${DESK}/memory-kit.conf`]: DESK_CONF })
    const clock = mock.clock(on, { now: NOW })
    await $.session.start(SESSION)
    await clock.advance(0)
    const { text } = await $.command.run({ command: 'watch', args: '', origin: { kind: 'composer' } } as never)
    expect(text).toContain(`home: ${DESK} (kit_home in ${CWD}/memory-kit.conf)`)
    expect(text).toContain('1 doorbell')
  })
})

describe('session reports: idle and context marks', () => {
  const IDLE_CONF = 'watch_idle_minutes: 50\nwatch_retire_step: "touch .fresh-next, then exit"\n'

  test('idle: armed by a human prompt, one report past the mark, quoting the home step', async ($, on) => {
    const world = worldOf(on, { 'memory-kit.conf': IDLE_CONF })
    const clock = mock.clock(on, { now: NOW })
    await $.session.start(SESSION)
    await $.prompt.submit(typed('work on the thing') as never)
    await $.turn.complete({ answer: 'done', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
    await clock.advance(49 * MIN)
    expect(world.submitted).toEqual([])
    await clock.advance(MIN)
    expect(world.submitted).toHaveLength(1)
    expect(world.submitted[0]).toContain('idle for 50 min')
    expect(world.submitted[0]).toContain('touch .fresh-next, then exit')
    // The report's own turn never re-arms it: one report per working stretch.
    await $.turn.complete({ answer: 'noted', durationMs: 1, isAborted: false, turnId: 't2', reason: 'answer' })
    await clock.advance(3 * 60 * MIN)
    expect(world.submitted).toHaveLength(1)
    // The next human prompt arms the next stretch.
    await $.prompt.submit(typed('more work') as never)
    await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't3', reason: 'answer' })
    await clock.advance(50 * MIN)
    expect(world.submitted).toHaveLength(2)
  })

  test('idle: no human prompt, never (a headless home is not pinged idle)', async ($, on) => {
    const world = worldOf(on, { 'memory-kit.conf': IDLE_CONF })
    const clock = mock.clock(on, { now: NOW })
    await $.session.start(SESSION)
    await clock.advance(3 * 60 * MIN)
    expect(world.submitted).toEqual([])
  })

  test('idle: human activity resets the clock', async ($, on) => {
    const world = worldOf(on, { 'memory-kit.conf': IDLE_CONF })
    const clock = mock.clock(on, { now: NOW })
    await $.session.start(SESSION)
    await $.prompt.submit(typed('work') as never)
    await clock.advance(40 * MIN)
    await $.prompt.submit(typed('more') as never)
    await clock.advance(40 * MIN)
    expect(world.submitted).toEqual([])
    await clock.advance(10 * MIN)
    expect(world.submitted).toHaveLength(1)
  })

  test('idle, repeating (kit #47): a report every further interval while idle; a human still arms it first', async ($, on) => {
    const world = worldOf(on, { 'memory-kit.conf': 'watch_idle_minutes: 50\nwatch_idle_repeat: true\n' })
    const clock = mock.clock(on, { now: NOW })
    await $.session.start(SESSION)
    await clock.advance(2 * 60 * MIN)
    expect(world.submitted).toEqual([])
    await $.prompt.submit(typed('work on the thing') as never)
    await $.turn.complete({ answer: 'done', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
    await clock.advance(50 * MIN)
    expect(world.submitted).toHaveLength(1)
    expect(world.submitted[0]).toContain('idle for 50 min (the watch_idle_minutes mark in memory-kit.conf, repeating while idle (watch_idle_repeat))')
    expect(world.submitted[0]).toContain('information only')
    // The report's own turn ends; the next report comes a full interval after it, and so on.
    await $.turn.complete({ answer: 'noted', durationMs: 1, isAborted: false, turnId: 't2', reason: 'answer' })
    await clock.advance(49 * MIN)
    expect(world.submitted).toHaveLength(1)
    await clock.advance(MIN)
    expect(world.submitted).toHaveLength(2)
    await $.turn.complete({ answer: 'noted', durationMs: 1, isAborted: false, turnId: 't3', reason: 'answer' })
    await clock.advance(50 * MIN)
    expect(world.submitted).toHaveLength(3)
  })

  test('idle, repeating: a report whose turn never starts still waits a full interval for the next', async ($, on) => {
    const world = worldOf(on, { 'memory-kit.conf': 'watch_idle_minutes: 50\nwatch_idle_repeat: true\n' })
    const clock = mock.clock(on, { now: NOW })
    await $.session.start(SESSION)
    await $.prompt.submit(typed('work') as never)
    world.refuse = 'busy elsewhere'
    await clock.advance(50 * MIN)
    await clock.advance(10 * MIN)
    expect(world.attempts).toHaveLength(1)
    await clock.advance(40 * MIN)
    expect(world.attempts).toHaveLength(2)
  })

  test('watch_idle_repeat: false, or absent, is once per stretch; a bad value is once too, and said', async ($, on) => {
    const world = worldOf(on, { 'memory-kit.conf': 'watch_idle_minutes: 50\nwatch_idle_repeat: yes\n' })
    const clock = mock.clock(on, { now: NOW })
    await $.session.start(SESSION)
    await $.prompt.submit(typed('work') as never)
    await clock.advance(50 * MIN)
    await $.turn.complete({ answer: 'noted', durationMs: 1, isAborted: false, turnId: 't2', reason: 'answer' })
    await clock.advance(3 * 60 * MIN)
    expect(world.submitted).toHaveLength(1)
    expect(world.logs).toContain('debug: watch: watch_idle_repeat: true or false, not "yes"')
  })

  test('not declared: no idle report however long the silence', async ($, on) => {
    const world = worldOf(on, { 'memory-kit.conf': 'memory_dir: memory\n' })
    const clock = mock.clock(on, { now: NOW })
    await $.session.start(SESSION)
    await $.prompt.submit(typed('work') as never)
    await clock.advance(5 * 60 * MIN)
    expect(world.submitted).toEqual([])
  })

  test('context: one report per mark; a jump over several reports once, naming the highest', async ($, on) => {
    const world = worldOf(on, { 'memory-kit.conf': 'watch_context_percent: 50, 60, 70\n' })
    const clock = mock.clock(on, { now: NOW })
    await $.session.start(SESSION)
    await clock.advance(0)
    expect(world.submitted).toEqual([]) // no reading yet
    world.tokens = 650_000
    await clock.advance(5_000)
    expect(world.submitted).toEqual([
      '[watch] Context has reached 65% of the window (650,000 of 1,000,000 tokens), past the 60% mark declared in memory-kit.conf. ' +
        "This is information only; what to do at this level is this home's own rule.",
    ])
    await clock.advance(30_000)
    expect(world.submitted).toHaveLength(1)
    world.tokens = 720_000
    await clock.advance(5_000)
    expect(world.submitted).toHaveLength(2)
    expect(world.submitted[1]).toContain('past the 70% mark')
  })

  test('a shrunk context (compaction) does not repeat old marks', async ($, on) => {
    const world = worldOf(on, { 'memory-kit.conf': 'watch_context_percent: 50\n' })
    const clock = mock.clock(on, { now: NOW })
    await $.session.start(SESSION)
    world.tokens = 600_000
    await clock.advance(5_000)
    expect(world.submitted).toHaveLength(1)
    world.tokens = 200_000
    await clock.advance(5_000)
    world.tokens = 600_000
    await clock.advance(5_000)
    expect(world.submitted).toHaveLength(1)
  })

  test('an unreadable sensor line is said in the debug log, never silently off', async ($, on) => {
    const world = worldOf(on, { 'memory-kit.conf': 'watch_idle_minutes: soon\nwatch_context_percent: 50, 110\n' })
    const clock = mock.clock(on, { now: NOW })
    await $.session.start(SESSION)
    await clock.advance(5_000)
    expect(world.logs.some(l => l.includes('watch_idle_minutes') && l.includes('soon'))).toBe(true)
    expect(world.logs.some(l => l.includes('watch_context_percent'))).toBe(true)
  })
})

describe('/watch', () => {
  test('says the doorbells, their flags, and the sensor marks', async ($, on) => {
    worldOf(on, { 'memory-kit.conf': `${CONF}watch_idle_minutes: 50\nwatch_context_percent: 50, 70\n` })
    const clock = mock.clock(on, { now: NOW })
    await $.session.start(SESSION)
    await clock.advance(0)
    const { text } = await $.command.run({ command: 'watch', args: '', origin: { kind: 'composer' } } as never)
    expect(text).toContain('2 doorbells')
    expect(text).toContain('[hub mail] comms/inboxes/team-lead.json')
    expect(text).toContain('"consume the inbox')
    expect(text).toContain('[(links.txt)] ~/spool/links.txt  inject')
    expect(text).toContain('idle: report at 50 min; context: report at 50, 70% of the window')
  })

  test('says a repeating idle report', async ($, on) => {
    worldOf(on, { 'memory-kit.conf': 'watch_idle_minutes: 50\nwatch_idle_repeat: true\n' })
    const clock = mock.clock(on, { now: NOW })
    await $.session.start(SESSION)
    await clock.advance(0)
    const { text } = await $.command.run({ command: 'watch', args: '', origin: { kind: 'composer' } } as never)
    expect(text).toContain('idle: report at 50 min, repeating; context: off')
  })

  test('with nothing declared says so', async ($, on) => {
    worldOf(on, { 'memory-kit.conf': 'memory_dir: memory\n' })
    const clock = mock.clock(on, { now: NOW })
    await $.session.start(SESSION)
    await clock.advance(0)
    const { text } = await $.command.run({ command: 'watch', args: '', origin: { kind: 'composer' } } as never)
    expect(text).toMatch(/no watch_files/)
    expect(text).toContain('idle: off; context: off')
  })
})

describe('the start folder and path spellings (kit #42, #45, #46)', () => {
  const SPOOL_CONF = (path: string) => `watch_files:\n  - label: "spool"\n    path: ${path}\n    instruction: ""\n    inject: true\n`

  test('a start folder below the home finds it; /watch says where it looked', async ($, on) => {
    const world = worldOf(on, { 'memory-kit.conf': CONF })
    world.cwd = world.root = `${CWD}/sub/worktree`
    const clock = mock.clock(on, { now: NOW })
    await $.session.start({ ...SESSION, cwd: world.cwd })
    await clock.advance(0)
    const { text } = await $.command.run({ command: 'watch', args: '', origin: { kind: 'composer' } } as never)
    expect(text).toContain(`home: ${CWD}`)
    expect(text).toContain(`${CWD}/sub/worktree has no memory-kit.conf; using the nearest one above it, in ${CWD}`)
    expect(text).toContain('2 doorbells')
  })

  test('enabled mid-session after a shell cd: the session root, not the cd folder', async ($, on) => {
    const world = worldOf(on, { 'memory-kit.conf': CONF, '/home/u/other/memory-kit.conf': 'memory_dir: memory\n' })
    world.cwd = '/home/u/other'
    const clock = mock.clock(on, { now: NOW })
    await $.session.start({ ...SESSION, cwd: '/home/u/other' })
    await clock.advance(0)
    const { text } = await $.command.run({ command: 'watch', args: '', origin: { kind: 'composer' } } as never)
    expect(text).toContain(`home: ${CWD}\n`)
  })

  test('one file under two spellings keeps one bookmark: each new line rings once', async ($, on) => {
    const conf = `${SPOOL_CONF('inbound/spool.txt')}  - label: "spool"\n    path: ./inbound/../inbound/spool.txt\n    instruction: ""\n    inject: true\n`
    const world = worldOf(on, { 'memory-kit.conf': conf, 'inbound/spool.txt': '' })
    const clock = mock.clock(on, { now: NOW })
    await $.session.start(SESSION)
    await clock.advance(0)
    world.files.set(`${CWD}/inbound/spool.txt`, 'line 1\n')
    await clock.advance(5_000)
    world.files.set(`${CWD}/inbound/spool.txt`, 'line 1\nline 2\n')
    await clock.advance(5_000)
    expect(world.submitted).toHaveLength(2)
    expect(world.submitted.join('\n').match(/line 2/g)).toHaveLength(1)
  })
})

describe('the home option (user scope)', () => {
  test('a session outside the option home rings nothing there, one notice; its own sensors still run', { options: { home: '/elsewhere' } }, async ($, on) => {
    const world = worldOf(on, {
      '/elsewhere/memory-kit.conf': 'watch_files:\n  - label: x\n    path: spool.txt\n    instruction: ""\n    inject: false\nwatch_context_percent: 50\n',
      '/elsewhere/spool.txt': 'grown content',
    })
    const clock = mock.clock(on, { now: NOW })
    await $.session.start(SESSION)
    world.tokens = 600_000
    await clock.advance(10_000)
    expect(world.notified).toEqual([expect.stringContaining('outside the watch\'s home /elsewhere')])
    expect(world.submitted).toEqual([expect.stringContaining('past the 50% mark')])
  })

  test('the retired retireOnIdle option is said once', { options: { retireOnIdle: true } }, async ($, on) => {
    const world = worldOf(on, { 'memory-kit.conf': 'memory_dir: memory\n' })
    const clock = mock.clock(on, { now: NOW })
    await $.session.start(SESSION)
    await clock.advance(30_000)
    expect(world.notified.filter(n => n.includes('retireOnIdle'))).toHaveLength(1)
  })
})
