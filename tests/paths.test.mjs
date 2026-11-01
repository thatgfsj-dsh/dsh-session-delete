/**
 * 路径与标识工具的单测。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { homedir, tmpdir } from 'node:os'
import { assertSessionId, dshHome, encodeSegment, idVariants, projectKey, predictedSessionDir, sessionsRoot, trashRoot } from '../src/host/paths.mjs'

test('idVariants：两种历史命名都要覆盖', () => {
  assert.deepEqual(idVariants('session-abc'), ['session-abc', 'abc'])
  assert.deepEqual(idVariants('abc'), ['abc', 'session-abc'])
  // Windows 上 ':' 是文件名非法字符，不做这个用例。
  if (process.platform !== 'win32') assert.deepEqual(idVariants('session-a.b_c:d'), ['session-a.b_c:d', 'a.b_c:d'])
})

test('assertSessionId：拒绝空、超长、路径穿越与非法字符（不做 trim 归一化）', () => {
  assert.equal(assertSessionId('session-1'), 'session-1')
  for (const bad of ['', '   ', ' session-1 ', '../etc', 'a/b', 'a\\b', '.', '..', 'x'.repeat(201), 'a b']) {
    assert.throws(() => assertSessionId(bad), /会话 ID/, `应当拒绝：${bad}`)
  }
})

test('encodeSegment 与官方 JSONL 布局一致', () => {
  assert.equal(encodeSegment('session-abc'), 'session-abc')
  assert.equal(encodeSegment('.'), '~002E')
  assert.equal(encodeSegment('..'), '~002E~002E')
  assert.equal(encodeSegment('a/b'), 'a~002Fb')
})

test('projectKey 与官方 JSONL 布局一致', () => {
  assert.equal(projectKey('/home/u/proj'), '--home-u-proj--')
  // 尾部分隔符会被折成一个 '-'（与官方实现一致，官方也不做尾部裁剪）
  assert.equal(projectKey('/home/u/proj/'), '--home-u-proj---')
  assert.equal(projectKey('/'), '--root--')
  assert.equal(projectKey('/home/u/中文'), '--home-u-~4E2D~6587--')
  // Windows 盘符/反斜杠：与官方 projectKey 一样把 ':' 和 '\\' 都折成 '-'
  assert.equal(projectKey('C:\\Users\\me\\proj'), '--C-Users-me-proj--')
  assert.equal(projectKey('C:\\'), '--C---')
})

test('dshHome：$DSH_HOME 空白视为未设置、支持 ~、结果绝对路径', () => {
  const previous = process.env.DSH_HOME
  try {
    process.env.DSH_HOME = '   '
    assert.equal(dshHome(), join(homedir(), '.dsh'))
    delete process.env.DSH_HOME
    assert.equal(dshHome(), join(homedir(), '.dsh'))
    process.env.DSH_HOME = '~/custom-dsh'
    assert.equal(dshHome(), join(homedir(), 'custom-dsh'))
  } finally {
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
  }
})

test('predictedSessionDir 按 DSH_HOME 推算', () => {
  const previous = process.env.DSH_HOME
  const home = join(tmpdir(), 'dsh-home-x')
  process.env.DSH_HOME = home
  try {
    assert.equal(predictedSessionDir('session-1', '/a/b'), join(home, 'sessions', '--a-b--', 'session-1'))
    assert.equal(predictedSessionDir('session-1', undefined), join(home, 'sessions', '_no-cwd', 'session-1'))
    assert.equal(trashRoot(), join(home, 'session-delete', 'trash'))
    assert.equal(sessionsRoot(), join(home, 'sessions'))
  } finally {
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
  }
})
