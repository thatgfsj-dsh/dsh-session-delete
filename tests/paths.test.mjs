/**
 * 路径与标识工具的单测。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { assertSessionId, encodeSegment, idVariants, projectKey, predictedSessionDir, sessionsRoot, trashRoot } from '../src/host/paths.mjs'

test('idVariants：两种历史命名都要覆盖', () => {
  assert.deepEqual(idVariants('session-abc'), ['session-abc', 'abc'])
  assert.deepEqual(idVariants('abc'), ['abc', 'session-abc'])
  assert.deepEqual(idVariants('session-a.b_c:d'), ['session-a.b_c:d', 'a.b_c:d'])
})

test('assertSessionId：拒绝空、超长、路径穿越与非法字符', () => {
  assert.equal(assertSessionId(' session-1 '), 'session-1')
  for (const bad of ['', '   ', '../etc', 'a/b', 'a\\b', '.', '..', 'x'.repeat(201), 'a b']) {
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
})

test('predictedSessionDir 按 DSH_HOME 推算', () => {
  const previous = process.env.DSH_HOME
  process.env.DSH_HOME = '/tmp/dsh-home-x'
  try {
    assert.equal(predictedSessionDir('session-1', '/a/b'), '/tmp/dsh-home-x/sessions/--a-b--/session-1')
    assert.equal(predictedSessionDir('session-1', undefined), '/tmp/dsh-home-x/sessions/_no-cwd/session-1')
    assert.equal(trashRoot(), '/tmp/dsh-home-x/session-delete/trash')
    assert.equal(sessionsRoot(), '/tmp/dsh-home-x/sessions')
  } finally {
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
  }
})
