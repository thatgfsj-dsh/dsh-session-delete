/**
 * 元数据采集与准入判定的单测。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  collectActivity,
  collectDescendants,
  collectSessionMeta,
  isRunning,
  readSnapshotIndex,
  resolveSessionDir,
  resolveTitle,
  resolveWorkspace,
} from '../src/host/session-meta.mjs'
import { makeFakeCtx, makeWorkspace } from './fakes.mjs'

/** 隔离 DSH_HOME。 */
async function withHome(run) {
  const previous = process.env.DSH_HOME
  const home = await mkdtemp(join(tmpdir(), 'dsh-sd-meta-'))
  process.env.DSH_HOME = home
  try {
    await run(home)
  } finally {
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
    await rm(home, { recursive: true, force: true })
  }
}

/** 在官方布局下造一个会话目录。 */
async function makeDir(home, id) {
  const dir = join(home, 'sessions', '--proj--', id)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'session.v4.jsonl.zstd'), 'log', 'utf8')
  return dir
}

test('collectDescendants：只收 subagent 血缘，fork 不算子树，循环安全', () => {
  const headers = new Map([
    ['root', { id: 'root' }],
    ['child-a', { id: 'child-a', parentSession: 'root', origin: 'subagent' }],
    ['child-b', { id: 'child-b', parentSession: 'child-a', origin: 'subagent' }],
    ['fork-1', { id: 'fork-1', parentSession: 'root', isSeeded: true }],
    ['other', { id: 'other', parentSession: 'elsewhere', origin: 'subagent' }],
  ])
  assert.deepEqual(collectDescendants(headers, 'root'), ['child-a', 'child-b'])
  assert.deepEqual(collectDescendants(headers, 'child-b'), [])
})

test('collectActivity / isRunning：活动族与活体状态都能判定运行中', async () => {
  await withHome(async home => {
    const fake = makeFakeCtx({ home, activity: [{ kind: 'turn' }], runningIds: [] })
    const activity = await collectActivity(fake.ctx, 's1')
    assert.equal(activity.known, true)
    assert.equal(isRunning(fake.ctx, 's1', activity), true)
    assert.equal(isRunning(fake.ctx, 's1', { known: true, activity: [] }), false)

    const running = makeFakeCtx({ home, activity: [], runningIds: ['s1'] })
    assert.equal(isRunning(running.ctx, 's1', { known: true, activity: [] }), true)

    const broken = makeFakeCtx({ home })
    broken.ctx.waterfall = async () => { throw new Error('provider 崩了') }
    const failed = await collectActivity(broken.ctx, 's1')
    assert.equal(failed.known, false)
    assert.match(failed.error, /provider/)
  })
})

test('resolveWorkspace：按记账顺序给出位置锚点', async () => {
  await withHome(async home => {
    const { entity } = makeWorkspace({ sessionIds: ['a', 'b', 'c'] })
    const fake = makeFakeCtx({ home, registry: { ...makeFakeCtx({ home }).registry, list: () => [entity] } })
    const workspace = resolveWorkspace(fake.ctx, 'b')
    assert.equal(workspace.id, 'ws-1')
    assert.equal(workspace.index, 1)
    assert.equal(workspace.beforeSessionId, 'c')
    assert.equal(resolveWorkspace(fake.ctx, 'zzz'), undefined)
  })
})

test('resolveSessionDir：locate 命中、扫描兜底、都不命中返回 undefined', async () => {
  await withHome(async home => {
    const id = 'session-55555555-5555-5555-5555-555555555555'
    const dir = await makeDir(home, id)
    const fake = makeFakeCtx({ home })
    assert.equal(await resolveSessionDir(fake.ctx, { id, cwd: '/proj' }), dir)

    // 没有 locate 通道时按目录扫描兜底
    const scanning = makeFakeCtx({ home })
    const original = scanning.ctx.get
    scanning.ctx.get = name => name === 'sessionPersistence' ? undefined : original(name)
    assert.equal(await resolveSessionDir(scanning.ctx, { id, cwd: '/proj' }), dir)
    assert.equal(await resolveSessionDir(scanning.ctx, { id: 'session-99999999-9999-9999-9999-999999999999' }), undefined)
  })
})

test('resolveTitle：活体投影 → 投影缓存分片 → 提示', async () => {
  await withHome(async home => {
    const id = 'session-66666666-6666-6666-6666-666666666666'
    const fake = makeFakeCtx({
      home,
      sessions: [{ id, header: { id, cwd: '/proj' } }],
      projections: { stateOf: () => '活体标题' },
    })
    assert.equal(await resolveTitle(fake.ctx, id, '提示'), '活体标题')

    const cached = makeFakeCtx({ home, sessions: [{ id, header: { id, cwd: '/proj' } }] })
    const cacheDir = join(home, 'storages', 'session_projcache', 'sessions')
    await mkdir(cacheDir, { recursive: true })
    await writeFile(join(cacheDir, `${id}.json`), JSON.stringify({ record: { rows: { title: { val: '缓存标题' } } } }), 'utf8')
    assert.equal(await resolveTitle(cached.ctx, id, '提示'), '缓存标题')
    assert.equal(await resolveTitle(cached.ctx, 'session-77777777-7777-7777-7777-777777777777', '提示'), '提示')
  })
})

test('collectSessionMeta：汇总标题、大小、工作区、子树与运行状态', async () => {
  await withHome(async home => {
    const rootId = 'session-88888888-8888-8888-8888-888888888888'
    const childId = 'session-99999999-9999-9999-9999-999999999999'
    await makeDir(home, rootId)
    await makeDir(home, childId)
    const { entity } = makeWorkspace({ sessionIds: [rootId] })
    const base = makeFakeCtx({ home })
    const fake = makeFakeCtx({
      home,
      registry: { ...base.registry, list: () => [entity] },
      snapshots: [
        { header: { id: rootId, cwd: '/proj' }, sizeBytes: 3 },
        { header: { id: childId, cwd: '/proj', parentSession: rootId, origin: 'subagent' }, sizeBytes: 3 },
      ],
    })
    const index = await readSnapshotIndex(fake.ctx)
    const meta = await collectSessionMeta(fake.ctx, rootId, { index, title: '提示标题' })
    assert.equal(meta.title, '提示标题')
    assert.equal(meta.exists, true)
    assert.equal(meta.workspace?.id, 'ws-1')
    assert.equal(meta.descendants.length, 1)
    assert.equal(meta.descendants[0].sessionId, childId)
    assert.equal(meta.members.length, 2)
    assert.ok(meta.sizeBytes > 0)
    assert.equal(meta.running, false)
  })
})
