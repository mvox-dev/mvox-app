// IDENTICAL in adapters/claude-code/{obligations-pane,watch,kit-update}/tests/kit-home.test.ts,
// as hooks/kit-home.ts is; lint/run-fixtures.sh fails when the copies differ (kit #18).
import { describe, expect, test } from 'claude-code/testing'

import { foundAboveNote, isAbsolute, noConfNotice, normalizePath, parentOf, resolveKitHome } from '../hooks/kit-home'

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

  test('a folder with no memory-kit.conf: the notice, worded as lint/kit_home.py words it (kit #31)', () => {
    expect(noConfNotice('/u/start/')).toBe('/u/start has no memory-kit.conf, so it is not a kit home; if the home is elsewhere, put kit_home: <path> in a memory-kit.conf here')
  })

  test("the pointer conf's other keys are reported as ignored", async () => {
    const files = {
      '/u/start/memory-kit.conf': '# pointer\nkit_home: ../desk\nwatch_sources:\n  - a | lines | x\nmemory_dir: m\n',
      '/u/desk/memory-kit.conf': '',
    }
    expect(await resolveKitHome('/u/start', reader(files))).toEqual({ home: '/u/desk', pointer: '/u/start/memory-kit.conf', ignored: ['watch_sources', 'memory_dir'] })
  })
})

describe('a start folder without memory-kit.conf looks upward for the nearest one (kit #42)', () => {
  test('a subfolder of a home finds the home', async () => {
    const files = { '/u/home/memory-kit.conf': 'memory_dir: memory\n' }
    expect(await resolveKitHome('/u/home/a/b', reader(files))).toEqual({ home: '/u/home', ignored: [], foundIn: '/u/home' })
  })

  test("a worktree below a pointer conf follows the pointer, relative to that conf's own folder", async () => {
    const files = { '/u/3D/memory-kit.conf': 'kit_home: workshop\n', '/u/3D/workshop/memory-kit.conf': 'memory_dir: memory\n' }
    expect(await resolveKitHome('/u/3D/slicer/.worktrees/m4', reader(files))).toEqual({
      home: '/u/3D/workshop',
      pointer: '/u/3D/memory-kit.conf',
      ignored: [],
      foundIn: '/u/3D',
    })
  })

  test("the nearest conf wins, and the start folder's own conf beats any above it", async () => {
    const files = { '/u/memory-kit.conf': '', '/u/home/memory-kit.conf': '', '/u/home/a/memory-kit.conf': '' }
    expect(await resolveKitHome('/u/home/x', reader(files))).toEqual({ home: '/u/home', ignored: [], foundIn: '/u/home' })
    expect(await resolveKitHome('/u/home/a', reader(files))).toEqual({ home: '/u/home/a', ignored: [] })
  })

  test('no conf anywhere leaves the start folder as the home; the walk reads the root conf too', async () => {
    const asked: string[] = []
    const r = await resolveKitHome('/u/a', async p => {
      asked.push(p)
      return undefined
    })
    expect(r).toEqual({ home: '/u/a', ignored: [] })
    expect(asked).toEqual(['/u/a/memory-kit.conf', '/u/memory-kit.conf', '/memory-kit.conf'])
    expect(await resolveKitHome('/u/a', reader({ '/memory-kit.conf': '' }))).toEqual({ home: '/', ignored: [], foundIn: '/' })
  })

  test('a broken pointer found above is still a problem, never a silent fall back', async () => {
    const r = await resolveKitHome('/u/home/a', reader({ '/u/home/memory-kit.conf': 'kit_home: ../gone\n' }))
    expect(r).toEqual({ pointer: '/u/home/memory-kit.conf', problem: expect.stringContaining('/u/gone: no memory-kit.conf there') })
  })

  test('a folder above that cannot be read ends the walk; the start folder itself still throws', async () => {
    const refusing = async (p: string) => {
      if (p !== '/s/share/a/memory-kit.conf') throw new Error('network location')
      return undefined
    }
    expect(await resolveKitHome('/s/share/a', refusing)).toEqual({ home: '/s/share/a', ignored: [] })
    await expect(resolveKitHome('/s/other', refusing)).rejects.toThrow('network location')
  })

  test('parentOf stops at every kind of root', () => {
    expect(parentOf('/u/a/')).toBe('/u')
    expect(parentOf('/u')).toBe('/')
    expect(parentOf('/')).toBeUndefined()
    expect(parentOf('C:\\Users\\m')).toBe('C:/Users')
    expect(parentOf('C:/Users')).toBe('C:/')
    expect(parentOf('C:/')).toBeUndefined()
    expect(parentOf('\\\\server\\share\\kit')).toBe('//server/share')
    expect(parentOf('//server/share')).toBeUndefined()
  })

  test('the found-above note, worded as lint/kit_home.py words it', () => {
    expect(foundAboveNote('/u/3D/slicer/', '/u/3D')).toBe('/u/3D/slicer has no memory-kit.conf; using the nearest one above it, in /u/3D')
  })
})

describe('a memory-kit.conf that gives a top-level key twice is a problem, never a silent pick (kit #55)', () => {
  const twice = (conf: string, key: string, line: number, first: number) =>
    `${conf}: duplicate key '${key}' on line ${line} (first on line ${first}); the plugins would take the first and the lint the last, so keep only one`

  test("in the start folder's conf, worded as lint/kit_home.py words it", async () => {
    const r = await resolveKitHome('/u/start', reader({ '/u/start/memory-kit.conf': 'memory_dir: memory\r\nmode: gate\r\nmemory_dir: notes  # moved\r\n' }))
    expect(r).toEqual({ pointer: '/u/start/memory-kit.conf', problem: twice('/u/start/memory-kit.conf', 'memory_dir', 3, 1) })
  })

  test('in the conf a pointer names', async () => {
    const files = { '/u/start/memory-kit.conf': 'kit_home: ../desk\n', '/u/desk/memory-kit.conf': 'update: pinned\n\nupdate: latest\n' }
    expect(await resolveKitHome('/u/start', reader(files))).toEqual({ pointer: '/u/start/memory-kit.conf', problem: twice('/u/desk/memory-kit.conf', 'update', 3, 1) })
  })

  test('kit_home itself twice', async () => {
    const files = { '/u/start/memory-kit.conf': 'kit_home: ../a\nkit_home: ../b\n', '/u/a/memory-kit.conf': '', '/u/b/memory-kit.conf': '' }
    expect(await resolveKitHome('/u/start', reader(files))).toMatchObject({ problem: twice('/u/start/memory-kit.conf', 'kit_home', 2, 1) })
  })

  test('in a conf found above', async () => {
    const r = await resolveKitHome('/u/home/sub', reader({ '/u/home/memory-kit.conf': 'memory_dir: a\nmemory_dir: b\n' }))
    expect(r).toEqual({ pointer: '/u/home/memory-kit.conf', problem: twice('/u/home/memory-kit.conf', 'memory_dir', 2, 1) })
  })

  test('a key repeated inside a block, or in a comment, is not a top-level key given twice', async () => {
    const conf = 'watch_files:\n  - label: "a"\n    path: a.txt\n  - label: "b"\n    path: b.txt\n# memory_dir: old\nmemory_dir: memory\n'
    expect(await resolveKitHome('/u/start', reader({ '/u/start/memory-kit.conf': conf }))).toEqual({ home: '/u/start', ignored: [] })
  })
})
