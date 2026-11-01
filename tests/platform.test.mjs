/**
 * 跨平台适配测试：Windows 盘符/大小写/保留名/只读文件，以及 POSIX 基础行为。
 * Windows 专属用例在 Linux 上自动跳过（Wine + Windows Node 下会真正执行）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile, chmod } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { assertSessionId } from '../src/host/paths.mjs'
import { isInside } from '../src/host/trash.mjs'
import { moveTree, removeTree } from '../src/host/fs-util.mjs'

test('isInside：目录包含判断（POSIX）', () => {
  assert.equal(isInside('/a/b', '/a/b/c'), true)
  assert.equal(isInside('/a/b', '/a/b'), true)
  assert.equal(isInside('/a/b', '/a/bc'), false)
  assert.equal(isInside('/a/b', '/a'), false)
  assert.equal(isInside('/a/b', '/a/b/../c'), false)
})

test('isInside：Windows 盘符与大小写不敏感', { skip: process.platform !== 'win32' }, () => {
  assert.equal(isInside('C:\\dsh\\trash', 'C:\\dsh\\trash\\id'), true)
  assert.equal(isInside('C:\\dsh\\trash', 'c:\\DSH\\trash\\id'), true)
  assert.equal(isInside('C:\\dsh\\trash', 'C:\\dsh\\trash2'), false)
  assert.equal(isInside('C:\\dsh\\trash', 'C:\\dsh'), false)
  assert.equal(isInside('C:\\dsh\\trash', 'C:\\dsh\\trash\\..\\escape'), false)
})

test('assertSessionId：Windows 非法字符/保留名/结尾点空格', { skip: process.platform !== 'win32' }, () => {
  for (const bad of ['a:b', 'a|b', 'a?b', 'a*b', 'a<b', 'a>b', 'a"b', 'CON', 'nul.txt', 'COM1', 'lpt9.log', 'foo.', 'a\u0000b']) {
    assert.throws(() => assertSessionId(bad), /会话 ID/, `应当拒绝：${JSON.stringify(bad)}`)
  }
  assert.equal(assertSessionId('session-8f0c1a2b'), 'session-8f0c1a2b')
  // 不做 trim：前后空白直接判非法。
  assert.throws(() => assertSessionId(' foo '), /会话 ID/)
})

test('removeTree：Windows 只读文件也能递归删除', { skip: process.platform !== 'win32' }, async () => {
  const home = await mkdtemp(join(tmpdir(), 'dsh-win-ro-'))
  try {
    const dir = join(home, 'tree', 'nested')
    await mkdir(dir, { recursive: true })
    const file = join(dir, 'session.v4.jsonl.zstd')
    await writeFile(file, 'x', 'utf8')
    await chmod(file, 0o444)
    await removeTree(join(home, 'tree'))
    assert.equal(existsSync(join(home, 'tree')), false)
  } finally {
    await rm(home, { recursive: true, force: true }).catch(() => {})
  }
})

test('moveTree：Windows 同盘 rename 搬目录', { skip: process.platform !== 'win32' }, async () => {
  const home = await mkdtemp(join(tmpdir(), 'dsh-win-mv-'))
  try {
    const source = join(home, 'a', 'session-1')
    const target = join(home, 'b', 'session-1')
    await mkdir(source, { recursive: true })
    await writeFile(join(source, 'log.zstd'), 'payload')
    const result = await moveTree(source, target)
    assert.equal(result.mode, 'rename')
    assert.equal(existsSync(source), false)
    assert.equal(existsSync(join(target, 'log.zstd')), true)
  } finally {
    await rm(home, { recursive: true, force: true }).catch(() => {})
  }
})
