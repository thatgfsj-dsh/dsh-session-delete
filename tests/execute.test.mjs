/**
 * 删除事务的集成单测：回收站模式、彻底删除、准入拒绝、幂等、子代理整树、摘活体失败回滚。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { executeDelete, executeEmptyTrash, executePurgeTrashEntry, executeRestore, executeSweep } from '../src/host/execute.mjs'
import { listEntries, moveIntoTrash, readSettings } from '../src/host/trash.mjs'
import { makeFakeCtx, makeWorkspace } from './fakes.mjs'

/** 隔离 DSH_HOME。 */
async function withHome(run) {
  const previous = process.env.DSH_HOME
  const home = await mkdtemp(join(tmpdir(), 'dsh-sd-exec-'))
  process.env.DSH_HOME = home
  try {
    await run(home)
  } finally {
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
    await rm(home, { recursive: true, force: true })
  }
}

/** 造会话目录。 */
async function makeDir(home, id, bytes = 5) {
  const dir = join(home, 'sessions', '--proj--', id)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'session.v4.jsonl.zstd'), 'x'.repeat(bytes), 'utf8')
  return dir
}

/** 造投影缓存分片。 */
async function makeProjCache(home, key) {
  const dir = join(home, 'storages', 'session_projcache', 'sessions')
  await mkdir(dir, { recursive: true })
  const path = join(dir, `${key}.json`)
  await writeFile(path, '{}', 'utf8')
  return path
}

/** 造带记账/归档/置顶的 registry。 */
function makeRegistry(entity, options = {}) {
  const calls = { unarchive: [], unpin: [], pin: [], archive: [], stop: [] }
  return {
    calls,
    list: () => (entity === undefined ? [] : [entity]),
    get: id => (entity !== undefined && id === entity.id ? entity : undefined),
    resolveByPath: async () => undefined,
    archivedSessionIds: options.archived ?? [],
    pinnedSessionIds: options.pinned ?? [],
    unarchiveSession: async id => { calls.unarchive.push(id) },
    unpinSession: async id => { calls.unpin.push(id) },
    pinSession: async id => { calls.pin.push(id) },
    archiveSession: async id => { calls.archive.push(id) },
    stopSessionActivity: async id => { calls.stop.push(id); options.onStop?.() },
  }
}

const ROOT = 'session-aaaaaaaa-1111-2222-3333-444444444444'
const CHILD = 'session-bbbbbbbb-1111-2222-3333-444444444444'

test('回收站模式：搬目录 → 摘活体 → 清记账 → 保留投影缓存 → 广播', async () => {
  await withHome(async home => {
    const dir = await makeDir(home, ROOT, 12)
    const cacheFile = await makeProjCache(home, ROOT)
    const { entity, calls: workspaceCalls } = makeWorkspace({ sessionIds: [ROOT, 'other'] })
    const registry = makeRegistry(entity, { archived: [ROOT], pinned: [ROOT] })
    const fake = makeFakeCtx({
      home,
      sessions: [{ id: ROOT, header: { id: ROOT, cwd: '/proj' } }],
      snapshots: [{ header: { id: ROOT, cwd: '/proj' }, sizeBytes: 12 }],
      registry,
      projections: { stateOf: () => '测试会话' },
    })

    const result = await executeDelete(fake.ctx, { sessionId: ROOT, mode: 'trash', title: '测试会话' })
    assert.equal(result.ok, true)
    assert.equal(result.mode, 'trash')
    assert.equal(existsSync(dir), false)
    // 移入回收站保留投影缓存，还原后侧栏标题不丢；彻底删除时才清。
    assert.equal(existsSync(cacheFile), true)
    assert.deepEqual(fake.detaches, [ROOT])
    assert.deepEqual(workspaceCalls.detach, [ROOT])
    assert.deepEqual(registry.calls.unarchive, [ROOT])
    assert.deepEqual(registry.calls.unpin, [ROOT])
    assert.ok(fake.emitted.some(item => item.name === 'api-session/removed' && item.payload === ROOT))
    assert.equal(fake.calls.domainDelete.includes(ROOT), false)
    const entries = await listEntries()
    assert.equal(entries.length, 1)
    assert.equal(entries[0].title, '测试会话')
    assert.equal(entries[0].workspaceTitle, '测试工作区')
    assert.equal(entries[0].archived, true)
    assert.equal(entries[0].pinned, true)
    // 回收站里确实有日志副本
    const payload = join(entries[0].dir, 'payload', '0')
    assert.equal((await readFile(join(payload, 'session.v4.jsonl.zstd'), 'utf8')).length, 12)
  })
})

test('彻底删除回收站条目：清掉投影缓存', async () => {
  await withHome(async home => {
    const dir = await makeDir(home, ROOT, 12)
    const cacheFile = await makeProjCache(home, ROOT)
    const fake = makeFakeCtx({
      home,
      sessions: [{ id: ROOT, header: { id: ROOT, cwd: '/proj' } }],
      snapshots: [{ header: { id: ROOT, cwd: '/proj' }, sizeBytes: 12 }],
      projections: { stateOf: () => '测试会话' },
    })
    await executeDelete(fake.ctx, { sessionId: ROOT, mode: 'trash', title: '测试会话' })
    assert.equal(existsSync(cacheFile), true)
    const purged = await executePurgeTrashEntry(fake.ctx, ROOT)
    assert.equal(purged.ok, true)
    assert.equal(existsSync(cacheFile), false)
    assert.equal(fake.calls.domainDelete.includes(ROOT), true)
    assert.equal(existsSync(dir), false)
  })
})

test('彻底删除：不写回收站，直接删目录', async () => {
  await withHome(async home => {
    const dir = await makeDir(home, ROOT)
    const registry = makeRegistry(undefined)
    const fake = makeFakeCtx({ home, sessions: [{ id: ROOT, header: { id: ROOT, cwd: '/proj' } }], registry })
    const result = await executeDelete(fake.ctx, { sessionId: ROOT, mode: 'purge' })
    assert.equal(result.ok, true)
    assert.equal(existsSync(dir), false)
    assert.deepEqual(await listEntries(), [])
  })
})

test('运行中且未勾选先停止：拒绝且不产生任何副作用', async () => {
  await withHome(async home => {
    const dir = await makeDir(home, ROOT)
    const fake = makeFakeCtx({ home, sessions: [{ id: ROOT, header: { id: ROOT } }], activity: [{ kind: 'turn' }] })
    await assert.rejects(
      () => executeDelete(fake.ctx, { sessionId: ROOT, mode: 'trash', stopIfRunning: false }),
      error => error.code === '会话正在运行，已取消删除',
    )
    assert.equal(existsSync(dir), true)
    assert.deepEqual(await listEntries(), [])
  })
})

test('运行中并勾选先停止：停止后成功删除', async () => {
  await withHome(async home => {
    const dir = await makeDir(home, ROOT)
    const activity = [{ kind: 'turn' }]
    const registry = makeRegistry(undefined, { onStop: () => { activity.length = 0 } })
    const fake = makeFakeCtx({ home, sessions: [{ id: ROOT, header: { id: ROOT } }], registry })
    fake.ctx.waterfall = async () => activity
    const result = await executeDelete(fake.ctx, { sessionId: ROOT, mode: 'trash', stopIfRunning: true })
    assert.equal(result.ok, true)
    assert.deepEqual(registry.calls.stop, [ROOT])
    assert.equal(existsSync(dir), false)
  })
})

test('子代理整树：父子目录一起进回收站，任一子代理运行则整体拒绝', async () => {
  await withHome(async home => {
    const rootDir = await makeDir(home, ROOT)
    const childDir = await makeDir(home, CHILD)
    const snapshots = [
      { header: { id: ROOT, cwd: '/proj' }, sizeBytes: 5 },
      { header: { id: CHILD, cwd: '/proj', parentSession: ROOT, origin: 'subagent' }, sizeBytes: 5 },
    ]
    const busy = makeFakeCtx({ home, snapshots, runningIds: [CHILD] })
    await assert.rejects(
      () => executeDelete(busy.ctx, { sessionId: ROOT, mode: 'trash' }),
      error => error.code === '有子代理会话正在运行，已取消删除',
    )
    assert.equal(existsSync(rootDir), true)
    assert.equal(existsSync(childDir), true)

    const { entity: workspace } = makeWorkspace({ sessionIds: [ROOT, CHILD] })
    const fake = makeFakeCtx({
      home,
      snapshots,
      registry: makeRegistry(workspace),
      sessions: [
        { id: ROOT, header: { id: ROOT, cwd: '/proj' } },
        { id: CHILD, header: { id: CHILD, cwd: '/proj', parentSession: ROOT, origin: 'subagent' } },
      ],
    })
    const result = await executeDelete(fake.ctx, { sessionId: ROOT, mode: 'trash' })
    assert.equal(result.ok, true)
    assert.equal(existsSync(rootDir), false)
    assert.equal(existsSync(childDir), false)
    const entries = await listEntries()
    assert.equal(entries[0].members.length, 2)
    assert.deepEqual(fake.detaches.sort(), [CHILD, ROOT].sort())

    // 还原时父子都要回到工作区记账里
    const restored = await executeRestore(fake.ctx, ROOT)
    assert.equal(restored.ok, true)
    assert.deepEqual([...workspace.sessionIds].sort(), [CHILD, ROOT].sort())
  })
})

test('运行中子代理：即使勾选「先停止」也整体拒绝，且不留副作用', async () => {
  await withHome(async home => {
    const rootDir = await makeDir(home, ROOT)
    const childDir = await makeDir(home, CHILD)
    const snapshots = [
      { header: { id: ROOT, cwd: '/proj' }, sizeBytes: 5 },
      { header: { id: CHILD, cwd: '/proj', parentSession: ROOT, origin: 'subagent' }, sizeBytes: 5 },
    ]
    const busy = makeFakeCtx({ home, snapshots, runningIds: [CHILD] })
    await assert.rejects(
      () => executeDelete(busy.ctx, { sessionId: ROOT, mode: 'trash', stopIfRunning: true }),
      error => error.code === '有子代理会话正在运行，已取消删除',
    )
    assert.equal(existsSync(rootDir), true)
    assert.equal(existsSync(childDir), true)
    assert.equal((await listEntries()).length, 0)
  })
})

test('幂等：会话已不存在返回 already-gone，已在回收站返回 already-in-trash', async () => {
  await withHome(async home => {
    const gone = makeFakeCtx({ home })
    const first = await executeDelete(gone.ctx, { sessionId: 'session-cccccccc-1111-2222-3333-444444444444', mode: 'trash' })
    assert.equal(first.code, 'already-gone')

    const dir = await makeDir(home, ROOT)
    const fake = makeFakeCtx({ home, snapshots: [{ header: { id: ROOT, cwd: '/proj' } }] })
    await executeDelete(fake.ctx, { sessionId: ROOT, mode: 'trash' })
    assert.equal(existsSync(dir), false)
    const second = await executeDelete(fake.ctx, { sessionId: ROOT, mode: 'trash' })
    assert.equal(second.code, 'already-in-trash')
  })
})

test('摘活体失败时把目录搬回原位并报错', async () => {
  await withHome(async home => {
    const dir = await makeDir(home, ROOT)
    const fake = makeFakeCtx({ home, sessions: [{ id: ROOT, header: { id: ROOT } }] })
    fake.ctx.get = name => {
      if (name !== 'sessions') return makeFakeCtx({ home }).ctx.get(name)
      return {
        get: id => (id === ROOT ? { id: ROOT, header: { id: ROOT } } : undefined),
        list: () => [{ id: ROOT, header: { id: ROOT } }],
        flush: async () => {},
        liveEntryFor: () => { throw new Error('store 已经坏了') },
        detachEntered: () => {},
      }
    }
    await assert.rejects(
      () => executeDelete(fake.ctx, { sessionId: ROOT, mode: 'trash' }),
      error => error.code === '摘除活体会话失败，已回滚',
    )
    assert.equal(existsSync(dir), true)
    assert.deepEqual(await listEntries(), [])
  })
})

test('回收站还原、彻底删除、清空与过期清理', async () => {
  await withHome(async home => {
    const dir = await makeDir(home, ROOT)
    const fake = makeFakeCtx({ home, snapshots: [{ header: { id: ROOT, cwd: '/proj' } }] })
    await executeDelete(fake.ctx, { sessionId: ROOT, mode: 'trash' })
    const restored = await executeRestore(fake.ctx, ROOT)
    assert.equal(restored.ok, true)
    assert.equal(existsSync(dir), true)
    assert.deepEqual(await listEntries(), [])

    // 再删一次并彻底删除回收站条目
    await executeDelete(fake.ctx, { sessionId: ROOT, mode: 'trash' })
    const purged = await executePurgeTrashEntry(fake.ctx, ROOT)
    assert.equal(purged.ok, true)
    assert.deepEqual(await listEntries(), [])

    // 清空与立即清理在空回收站上是幂等的
    const emptied = await executeEmptyTrash(fake.ctx)
    assert.equal(emptied.removed, 0)
    const swept = await executeSweep(fake.ctx)
    assert.equal(swept.removed, 0)
    assert.equal((await readSettings()).retentionDays, 30)
  })
})
