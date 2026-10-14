// IDENTICAL in adapters/claude-code/{obligations-pane,watch,kit-update}/tests/kit-home.test.ts,
// as hooks/kit-home.ts is; lint/run-fixtures.sh fails when the copies differ (kit #18).
import { describe, expect, test } from 'claude-code/testing'

import { isAbsolute, normalizePath, resolveKitHome } from '../hooks/kit-home'

/** An in-memory file system: path -> text. */
const reader = (files: Record<string, string>) => async (path: string) => files[normalizePath(path)]

describe('kit_home: memory-kit.conf names the kit home (kit #18)', () => {
  test('no pointer: the start folder is the home', async () => {
    expect(await resolveKitHome('/u/start', reader({ '/u/start/memory-kit.conf': 'memory_dir: memory\n' }))).toEqual({ home: '/u/start', ignored: [] })
    expect(await resolveKitHome('/u/none', reader({}))).toEqual({ home: '/u/none', ignored: [] })
  })

  test('a relative pointer is relative to the conf folder; an absolute one is as written', async () => {
    const files = { '/u/start/memory-kit.conf': 'kit_home: ../desk  # the desk\n', '/u/desk/memory-kit.conf': 'memory_dir: memory\n' }
    expect(await resolveKitHome('/u/start', reader(files))).toEqual({ home: '/u/desk', pointer: '/u/start/memory-kit.conf', ignored: [] })
    const abs = { '/u/start/memory-kit.conf': "kit_home: '/u/desk'\n", '/u/desk/memory-kit.conf': '' }
    expect(await resolveKitHome('/u/start', reader(abs))).toMatchObject({ home: '/u/desk' })
  })

  test('Windows paths count as absolute; ~ does not', () => {
    for (const p of ['/srv/home', 'C:\\Users\\m\\.claude\\pepys', 'C:/Users/m', '\\\\server\\share\\kit']) expect(isAbsolute(p), p).toBe(true)
    for (const p of ['desk', '../desk', 'C:desk', '~/desk']) expect(isAbsolute(p), p).toBe(false)
    expect(normalizePath('C:\\Users\\m\\start\\..\\desk')).toBe('C:/Users/m/desk')
    expect(normalizePath('/u/start/./../desk/')).toBe('/u/desk')
    expect(normalizePath('\\\\server\\share\\a\\..\\kit')).toBe('//server/share/kit')
  })

  test('a target with no memory-kit.conf is a problem, never a silent fall back', async () => {
    const r = await resolveKitHome('/u/start', reader({ '/u/start/memory-kit.conf': 'kit_home: ../nowhere\n' }))
    expect(r).toEqual({ pointer: '/u/start/memory-kit.conf', problem: '/u/start/memory-kit.conf: kit_home: ../nowhere -> /u/nowhere: no memory-kit.conf there, so it is not a kit home' })
  })

  test('followed one hop, never chained; a loop is a chain too', async () => {
    const chain = { '/u/a/memory-kit.conf': 'kit_home: ../b\n', '/u/b/memory-kit.conf': 'kit_home: ../c\n', '/u/c/memory-kit.conf': '' }
    expect(await resolveKitHome('/u/a', reader(chain))).toMatchObject({ problem: expect.stringContaining('followed one hop, never chained') })
    const loop = { '/u/a/memory-kit.conf': 'kit_home: ../b\n', '/u/b/memory-kit.conf': 'kit_home: ../a\n' }
    expect(await resolveKitHome('/u/a', reader(loop))).toMatchObject({ problem: expect.stringContaining('followed one hop, never chained') })
  })

  test('a home naming itself is just the home, also as a pointer target', async () => {
    const files = { '/u/desk/memory-kit.conf': 'kit_home: .\nmemory_dir: memory\n', '/u/start/memory-kit.conf': 'kit_home: ../desk\n' }
    expect(await resolveKitHome('/u/desk', reader(files))).toEqual({ home: '/u/desk', ignored: [] })
    expect(await resolveKitHome('/u/start', reader(files))).toMatchObject({ home: '/u/desk' })
  })

  test('~ is refused plainly', async () => {
    expect(await resolveKitHome('/u/start', reader({ '/u/start/memory-kit.conf': 'kit_home: ~/desk\n' }))).toMatchObject({
      problem: expect.stringContaining('absolute or relative'),
    })
  })

  test("the pointer conf's other keys are reported as ignored", async () => {
    const files = {
      '/u/start/memory-kit.conf': '# pointer\nkit_home: ../desk\nwatch_sources:\n  - a | lines | x\nmemory_dir: m\n',
      '/u/desk/memory-kit.conf': '',
    }
    expect(await resolveKitHome('/u/start', reader(files))).toEqual({ home: '/u/desk', pointer: '/u/start/memory-kit.conf', ignored: ['watch_sources', 'memory_dir'] })
  })
})
