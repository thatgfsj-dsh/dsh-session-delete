/**
 * 批量删除单测：参数校验、逐条执行、部分失败不中断。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MAX_BATCH, normalizeBatchInput, runBatchDelete } from '../src/host/batch.mjs'
import { listEntries } from '../src/host/trash.mjs'
import { makeFakeCtx, makeWorkspace } from './fakes.mjs'

const ROOT = 'session-aaaaaaaa-1111-2222-3333-444444444444'
const SECOND = 'session-bbbbbbbb-1111-2222-3333-444444444444'

async function withHome(run) {
  const previous = process.env.DSH_HOME
  const home = await mkdtemp(join(tmpdir(), 'dsh-sd-batch-'))
  process.env.DSH_HOME = home
  try {
    await run(home)
  } finally {
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
    await rm(home, { recursive: true, force: true })
  }
}

async function makeDir(home, id, bytes = 5) {
  const dir = join(home, 'sessions', '--proj--', id)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'session.v4.jsonl.zstd'), 'x'.repeat(bytes), 'utf8')
  return dir
}

test('normalizeBatchInput：去重、默认值、非法输入', () => {
  const normalized = normalizeBatchInput({ sessionIds: [ROOT, ROOT, SECOND] })
  assert.deepEqual(normalized.sessionIds, [ROOT, SECOND])
  assert.equal(normalized.mode, 'trash')
  assert.equal(normalized.stopIfRunning, false)
  assert.equal(normalizeBatchInput({ sessionIds: [ROOT], mode: 'purge', stopIfRunning: true }).mode, 'purge')
  assert.throws(() => normalizeBatchInput({}), error => error.code === '请求格式不正确' && error.detail === 'sessionIds 必须是数组')
  assert.throws(() => normalizeBatchInput({ sessionIds: [] }), error => error.code === '请求格式不正确' && error.detail === '没有选择任何会话')
  assert.throws(() => normalizeBatchInput({ sessionIds: ['../etc/passwd'] }), error => error.code === '会话 ID 非法')
  const many = Array.from({ length: MAX_BATCH + 1 }, (_, index) => `session-${String(index).padStart(8, '0')}-1111-2222-3333-444444444444`)
  assert.throws(() => normalizeBatchInput({ sessionIds: many }), error => error.code === '一次选择的会话过多')
})

test('runBatchDelete：逐条执行，单条失败不中断其它条目', async () => {
  await withHome(async home => {
    const firstDir = await makeDir(home, ROOT, 12)
    const secondDir = await makeDir(home, SECOND, 6)
    const snapshots = [
      { header: { id: ROOT, cwd: '/proj' }, sizeBytes: 12 },
      { header: { id: SECOND, cwd: '/proj' }, sizeBytes: 6 },
    ]
    const { entity } = makeWorkspace({ sessionIds: [ROOT, SECOND] })
    const registry = {
      list: () => [entity],
      get: () => entity,
      resolveByPath: async () => undefined,
      archivedSessionIds: [],
      pinnedSessionIds: [],
      unarchiveSession: async () => {},
      unpinSession: async () => {},
      pinSession: async () => {},
      archiveSession: async () => {},
      stopSessionActivity: async () => {},
    }
    // SECOND 处于运行中：未勾选先停止时应单条失败，不影响 ROOT。
    const fake = makeFakeCtx({ home, snapshots, registry, runningIds: [SECOND], sessions: [] })
    const result = await runBatchDelete(fake.ctx, {
      sessionIds: [ROOT, SECOND],
      mode: 'trash',
      stopIfRunning: false,
    })
    assert.equal(result.summary.total, 2)
    assert.equal(result.summary.succeeded, 1)
    assert.equal(result.summary.failed, 1)
    assert.equal(result.results[0].ok, true)
    assert.equal(result.results[1].ok, false)
    assert.equal(result.results[1].code, '会话正在运行，已取消删除')
    assert.equal(existsSync(firstDir), false)
    assert.equal(existsSync(secondDir), true)
    const entries = await listEntries()
    assert.equal(entries.length, 1)
    assert.equal(entries[0].sessionId, ROOT)
  })
})

test('runBatchDelete：全部成功时回收站条目数与摘要一致', async () => {
  await withHome(async home => {
    await makeDir(home, ROOT)
    await makeDir(home, SECOND)
    const snapshots = [
      { header: { id: ROOT, cwd: '/proj' }, sizeBytes: 5 },
      { header: { id: SECOND, cwd: '/proj' }, sizeBytes: 5 },
    ]
    const { entity } = makeWorkspace({ sessionIds: [ROOT, SECOND] })
    const registry = {
      list: () => [entity],
      get: () => entity,
      resolveByPath: async () => undefined,
      archivedSessionIds: [],
      pinnedSessionIds: [],
      unarchiveSession: async () => {},
      unpinSession: async () => {},
      pinSession: async () => {},
      archiveSession: async () => {},
      stopSessionActivity: async () => {},
    }
    const fake = makeFakeCtx({ home, snapshots, registry, sessions: [] })
    const result = await runBatchDelete(fake.ctx, { sessionIds: [ROOT, SECOND], mode: 'trash', stopIfRunning: false })
    assert.equal(result.summary.succeeded, 2)
    assert.equal(result.summary.failed, 0)
    assert.equal((await listEntries()).length, 2)
  })
})
