/**
 * 红蓝对抗（Issue #17）回归：P0/P1 修复的定向单测。
 *
 * 覆盖：精确 ID、list 降级、unsupported detach、blank/flush 重解析、
 * already-in-trash 幂等收尾、回滚保留、还原续做、purge 顺序、还原端残骸。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { executeDelete } from '../src/host/execute.mjs'
import { listEntries, moveIntoTrash, purgeEntry, restoreEntry } from '../src/host/trash.mjs'
import { makeFakeCtx, makeWorkspace } from './fakes.mjs'

const ROOT = 'session-aaaa1111-1111-2222-3333-444444444444'
const CHILD = 'session-bbbb2222-1111-2222-3333-444444444444'

/** 隔离 DSH_HOME。 */
async function withHome(run) {
  const previous = process.env.DSH_HOME
  const home = await mkdtemp(join(tmpdir(), 'dsh-sd-rb-'))
  process.env.DSH_HOME = home
  try {
    await run(home)
  } finally {
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
    await rm(home, { recursive: true, force: true })
  }
}

/** 造会话目录（带日志与锁文件）。 */
async function makeDir(home, id, bytes = 8) {
  const dir = join(home, 'sessions', '--proj--', id)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'session.v4.jsonl.zstd'), 'x'.repeat(bytes), 'utf8')
  await writeFile(join(dir, 'session.lock'), '', 'utf8')
  return dir
}

/** 造投影缓存分片。 */
async function makeProjCache(home, id) {
  const dir = join(home, 'storages', 'session_projcache', 'sessions')
  await mkdir(dir, { recursive: true })
  const path = join(dir, `${id}.json`)
  await writeFile(path, '{}', 'utf8')
  return path
}

test('P0 精确 ID：删除不存在的 `abc` 不会碰 `session-abc` 的目录', async () => {
  await withHome(async home => {
    const victim = await makeDir(home, 'session-abc')
    const fake = makeFakeCtx({ home, snapshots: [{ header: { id: 'session-abc', cwd: '/proj' }, sizeBytes: 8 }] })
    const result = await executeDelete(fake.ctx, { sessionId: 'abc', mode: 'purge' })
    assert.equal(result.code, 'already-gone')
    assert.equal(existsSync(victim), true)
  })
})

test('P0 回收站精确匹配：`abc` 不会命中 `session-abc` 的条目', async () => {
  await withHome(async home => {
    const dir = await makeDir(home, 'session-abc')
    const entry = await moveIntoTrash({ members: [{ sessionId: 'session-abc', dirPath: dir, isRoot: true }], meta: { sessionId: 'session-abc' } })
    const fake = makeFakeCtx({ home })
    const result = await executeDelete(fake.ctx, { sessionId: 'abc', mode: 'trash' })
    assert.equal(result.code, 'already-gone')
    assert.equal((await listEntries()).length, 1)
    assert.equal(entry.sessionId, 'session-abc')
  })
})

test('P2 list 降级且目录不存在：返回 5xx，不谎报 already-gone', async () => {
  await withHome(async home => {
    const fake = makeFakeCtx({ home })
    const baseGet = fake.ctx.get
    fake.ctx.get = name => name === 'sessionPersistence'
      ? { list: async () => { throw new Error('EACCES: permission denied') }, locate: () => ({ kind: 'jsonl', path: join(home, 'sessions', '--proj--', ROOT, 'session.v4.jsonl.zstd') }) }
      : baseGet(name)
    await assert.rejects(
      () => executeDelete(fake.ctx, { sessionId: ROOT, mode: 'trash' }),
      error => typeof error.status === 'number' && error.status >= 500 && String(error.detail).includes('无法确认'),
    )
  })
})

test('P1 unsupported detach + 活体会话：中止，目录不动', async () => {
  await withHome(async home => {
    const dir = await makeDir(home, ROOT)
    const fake = makeFakeCtx({ home, sessions: [{ id: ROOT, header: { id: ROOT, cwd: '/proj' } }], snapshots: [{ header: { id: ROOT, cwd: '/proj' } }] })
    const baseGet = fake.ctx.get
    fake.ctx.get = name => name === 'sessions'
      ? {
        get: id => (id === ROOT ? { id: ROOT, header: { id: ROOT, cwd: '/proj' } } : undefined),
        list: () => [{ id: ROOT, header: { id: ROOT, cwd: '/proj' } }],
        flush: async () => {},
      }
      : baseGet(name)
    await assert.rejects(
      () => executeDelete(fake.ctx, { sessionId: ROOT, mode: 'purge' }),
      error => error.status === 409 && String(error.detail).includes('liveEntryFor'),
    )
    assert.equal(existsSync(dir), true)
    assert.equal((await listEntries()).length, 0)
  })
})

test('P1 blank 会话：flush 落盘后要真正删除，而不是 already-gone', async () => {
  await withHome(async home => {
    const dir = join(home, 'sessions', '--proj--', ROOT)
    const snapshots = []
    const fake = makeFakeCtx({ home, sessions: [{ id: ROOT, header: { id: ROOT, cwd: '/proj' } }], snapshots })
    const baseGet = fake.ctx.get
    fake.ctx.get = name => name === 'sessions'
      ? {
        get: id => (id === ROOT ? { id: ROOT, header: { id: ROOT, cwd: '/proj' } } : undefined),
        list: () => [{ id: ROOT, header: { id: ROOT, cwd: '/proj' } }],
        flush: async () => {
          await mkdir(dir, { recursive: true })
          await writeFile(join(dir, 'session.v4.jsonl.zstd'), 'header', 'utf8')
          snapshots.push({ header: { id: ROOT, cwd: '/proj' }, sizeBytes: 6 })
        },
        liveEntryFor: session => ({ session }),
        detachEntered: entry => { fake.detaches.push(entry.session.id) },
      }
      : baseGet(name)
    const result = await executeDelete(fake.ctx, { sessionId: ROOT, mode: 'purge' })
    assert.equal(result.code, 'ok')
    assert.equal(existsSync(dir), false)
  })
})

test('P1 already-in-trash：重试时补跑工作区与投影缓存清理', async () => {
  await withHome(async home => {
    const dir = await makeDir(home, ROOT)
    const { entity, calls } = makeWorkspace({ sessionIds: [ROOT, 'other'] })
    const registry = {
      list: () => [entity],
      get: () => entity,
      resolveByPath: async () => undefined,
      archivedSessionIds: [],
      pinnedSessionIds: [],
      unarchiveSession: async () => {},
      unpinSession: async () => {},
    }
    const snapshots = [{ header: { id: ROOT, cwd: '/proj' }, sizeBytes: 8 }]
    const fake = makeFakeCtx({ home, snapshots, registry })
    await executeDelete(fake.ctx, { sessionId: ROOT, mode: 'trash' })
    snapshots.splice(0) // 真实宿主：目录进回收站后 list() 不再返回该 id
    // 模拟上次删除在收尾前中断：工作区记账与投影缓存又出现了
    await entity.attachSession(ROOT)
    const cacheFile = await makeProjCache(home, ROOT)
    const retry = await executeDelete(fake.ctx, { sessionId: ROOT, mode: 'trash' })
    assert.equal(retry.code, 'already-in-trash')
    assert.equal(calls.detach.includes(ROOT) || !entity.sessionIds.includes(ROOT), true)
    assert.equal(existsSync(cacheFile), false)
    assert.equal(retry.warnings.length, 0)
  })
})

test('P0 回滚失败：保留回收站 payload 并标记 partial，不丢数据', async () => {
  await withHome(async home => {
    const first = await makeDir(home, ROOT, 11)
    const second = await makeDir(home, CHILD, 9)
    // 第二个成员搬移失败；第一个成员回滚也失败（payload → 原路径）。
    let attempts = 0
    const deps = {
      moveTree: async (source, target) => {
        attempts += 1
        if (attempts === 2) throw new Error('inject: second member move failed')
        if (attempts >= 3) throw new Error('inject: rollback failed')
        await rename(source, target)
        return { mode: 'rename' }
      },
    }
    await assert.rejects(
      () => moveIntoTrash({
        members: [
          { sessionId: ROOT, dirPath: first, isRoot: true },
          { sessionId: CHILD, dirPath: second },
        ],
        meta: { sessionId: ROOT },
      }, deps),
      error => String(error.message).includes('回滚未完成'),
    )
    const entries = await listEntries()
    assert.equal(entries.length, 1)
    assert.equal(entries[0].partial, true)
    // 第一个成员的数据必须还在 payload 里（唯一副本）
    const payload = join(entries[0].dir, 'payload', '0')
    assert.equal((await readFile(join(payload, 'session.v4.jsonl.zstd'), 'utf8')).length, 11)
    assert.equal(existsSync(second), true)
  })
})

test('P1 还原续做：上次已搬回原位（宿主认可）的成员跳过，条目可清掉', async () => {
  await withHome(async home => {
    const dir = await makeDir(home, ROOT)
    const entry = await moveIntoTrash({ members: [{ sessionId: ROOT, dirPath: dir, isRoot: true }], meta: { sessionId: ROOT } })
    // 模拟上次还原：payload 已搬回原位，但条目目录还在
    await mkdir(join(home, 'sessions', '--proj--'), { recursive: true })
    await rename(join(entry.dir, 'payload', '0'), dir)
    const fake = makeFakeCtx({ home, snapshots: [{ header: { id: ROOT, cwd: '/proj' }, sizeBytes: 8 }] })
    const result = await restoreEntry(fake.ctx, entry)
    assert.deepEqual(result.alreadyRestored, [ROOT])
    assert.equal(existsSync(dir), true)
    assert.equal(existsSync(entry.dir), false)
  })
})

test('P1 还原端残骸：原路径只有无头残骸时清掉后继续还原', async () => {
  await withHome(async home => {
    const dir = await makeDir(home, ROOT)
    const entry = await moveIntoTrash({ members: [{ sessionId: ROOT, dirPath: dir, isRoot: true }], meta: { sessionId: ROOT } })
    // 原位被迟到写回留下残骸：只有 session.lock，没有日志
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'session.lock'), '', 'utf8')
    const fake = makeFakeCtx({ home, snapshots: [] })
    const result = await restoreEntry(fake.ctx, entry)
    assert.deepEqual(result.restored, [ROOT])
    assert.equal(existsSync(join(dir, 'session.v4.jsonl.zstd')), true)
    assert.equal(existsSync(join(dir, 'session.lock')), false)
    assert.equal(existsSync(entry.dir), false)
  })
})

test('P2 purge 顺序：payload 删除失败时条目仍可见、可重试', async () => {
  await withHome(async home => {
    const dir = await makeDir(home, ROOT)
    const entry = await moveIntoTrash({ members: [{ sessionId: ROOT, dirPath: dir, isRoot: true }], meta: { sessionId: ROOT } })
    const { removeTree: realRemove } = await import('../src/host/fs-util.mjs')
    await assert.rejects(
      () => purgeEntry(entry, { removeTree: async path => {
        if (path.includes('payload')) throw new Error('inject: EACCES')
        await realRemove(path)
      } }),
      error => String(error.message).includes('inject'),
    )
    const entries = await listEntries()
    assert.equal(entries.length, 1)
    assert.equal(entries[0].trashId, entry.trashId)
    assert.equal(existsSync(join(entry.dir, 'metadata.json')), true)
  })
})
