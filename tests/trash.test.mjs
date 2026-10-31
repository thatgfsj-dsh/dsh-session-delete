/**
 * 回收站存储的单测：策略归一化、原子写、移入/还原/彻底删除/清空/过期清理。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { rm } from 'node:fs/promises'
import {
  emptyTrash,
  findEntryBySession,
  listEntries,
  moveIntoTrash,
  normalizeMetadata,
  normalizeSettings,
  purgeEntry,
  readSettings,
  restoreEntry,
  sweepExpired,
  usageOf,
  writeSettings,
} from '../src/host/trash.mjs'
import { settingsPath } from '../src/host/paths.mjs'

/** 每个测试一个隔离 DSH_HOME。 */
async function withHome(run) {
  const previous = process.env.DSH_HOME
  const home = await mkdtemp(join(tmpdir(), 'dsh-sd-test-'))
  process.env.DSH_HOME = home
  try {
    await run(home)
  } finally {
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
    await rm(home, { recursive: true, force: true })
  }
}

/** 造一个带内容的假会话目录。 */
async function makeSessionDir(home, id, bytes = 10) {
  const dir = join(home, 'sessions', '--proj--', id)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'session.v4.jsonl'), 'x'.repeat(bytes), 'utf8')
  return dir
}

test('normalizeSettings：非法值回落到默认值', () => {
  assert.deepEqual(normalizeSettings(undefined), { version: 1, retentionDays: 30, sweepOnStartup: true })
  assert.deepEqual(normalizeSettings({ retentionDays: 7, sweepOnStartup: false }), { version: 1, retentionDays: 7, sweepOnStartup: false })
  assert.equal(normalizeSettings({ retentionDays: 999 }).retentionDays, 30)
  assert.equal(normalizeSettings({ retentionDays: 0 }).retentionDays, 0)
  assert.equal(normalizeSettings({ sweepOnStartup: 'yes' }).sweepOnStartup, false)
})

test('策略读写是原子且可往返', async () => {
  await withHome(async () => {
    assert.equal((await readSettings()).retentionDays, 30)
    const next = await writeSettings({ retentionDays: 15 })
    assert.equal(next.retentionDays, 15)
    assert.equal(JSON.parse(await readFile(settingsPath(), 'utf8')).retentionDays, 15)
    assert.equal((await readSettings()).retentionDays, 15)
  })
})

test('normalizeMetadata：缺成员直接判无效，畸形字段被丢弃', () => {
  assert.equal(normalizeMetadata(null, 'x'), undefined)
  assert.equal(normalizeMetadata({ members: [] }, 'x'), undefined)
  const meta = normalizeMetadata({ members: [{ sessionId: 's1', originalPath: '/p' }], sizeBytes: 'bad' }, 'x')
  assert.equal(meta.sessionId, 's1')
  assert.equal(meta.members.length, 1)
  assert.equal(meta.sizeBytes, 0)
})

test('移入回收站 → 列表 → 还原：目录与记账位置都回来', async () => {
  await withHome(async home => {
    const id = 'session-11111111-2222-3333-4444-555555555555'
    const dir = await makeSessionDir(home, id, 32)
    const entry = await moveIntoTrash({
      members: [{ sessionId: id, dirPath: dir, title: '测试会话', isRoot: true, sizeBytes: 32 }],
      meta: { sessionId: id, title: '测试会话', workspaceId: 'ws-1', workspaceTitle: '工作区', beforeSessionId: 'next-id' },
    })
    assert.equal(entry.members.length, 1)
    assert.equal(await listEntries().then(list => list.length), 1)
    assert.equal((await findEntryBySession(id))?.trashId, entry.trashId)
    // 两种命名都能找到
    assert.equal((await findEntryBySession('11111111-2222-3333-4444-555555555555'))?.trashId, entry.trashId)

    const restored = await restoreEntry(entry)
    assert.deepEqual(restored.restored, [id])
    assert.equal((await readFile(join(dir, 'session.v4.jsonl'), 'utf8')).length, 32)
    assert.deepEqual(await listEntries(), [])
  })
})

test('还原时原路径已存在则拒绝，不覆盖', async () => {
  await withHome(async home => {
    const id = 'session-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
    const dir = await makeSessionDir(home, id)
    const entry = await moveIntoTrash({ members: [{ sessionId: id, dirPath: dir, isRoot: true }], meta: { sessionId: id } })
    await mkdir(dir, { recursive: true })
    await assert.rejects(() => restoreEntry(entry), /原路径已存在/)
    assert.equal((await listEntries()).length, 1)
  })
})

test('彻底删除与清空回收站', async () => {
  await withHome(async home => {
    const first = 'session-00000000-0000-0000-0000-000000000001'
    const second = 'session-00000000-0000-0000-0000-000000000002'
    const firstDir = await makeSessionDir(home, first, 4)
    const secondDir = await makeSessionDir(home, second, 6)
    const entry = await moveIntoTrash({ members: [{ sessionId: first, dirPath: firstDir, isRoot: true, sizeBytes: 4 }], meta: { sessionId: first } })
    await moveIntoTrash({ members: [{ sessionId: second, dirPath: secondDir, isRoot: true, sizeBytes: 6 }], meta: { sessionId: second } })
    assert.equal(usageOf(await listEntries()).count, 2)
    const freed = await purgeEntry(entry)
    assert.equal(freed, 4)
    assert.equal((await listEntries()).length, 1)
    const result = await emptyTrash()
    assert.equal(result.removed, 1)
    assert.deepEqual(await listEntries(), [])
  })
})

test('过期清理只删超过保留天数的条目', async () => {
  await withHome(async home => {
    const oldId = 'session-11111111-1111-1111-1111-111111111111'
    const newId = 'session-22222222-2222-2222-2222-222222222222'
    const oldDir = await makeSessionDir(home, oldId)
    const newDir = await makeSessionDir(home, newId)
    const oldEntry = await moveIntoTrash({ members: [{ sessionId: oldId, dirPath: oldDir, isRoot: true }], meta: { sessionId: oldId, deletedAt: new Date(Date.now() - 40 * 86400000).toISOString() } })
    await moveIntoTrash({ members: [{ sessionId: newId, dirPath: newDir, isRoot: true }], meta: { sessionId: newId } })
    const result = await sweepExpired({ retentionDays: 30 })
    assert.equal(result.removed, 1)
    const left = await listEntries()
    assert.equal(left.length, 1)
    assert.notEqual(left[0].trashId, oldEntry.trashId)
    // 永久保留时什么都不删
    const forever = await sweepExpired({ retentionDays: 0 })
    assert.equal(forever.removed, 0)
  })
})

test('移入失败时把已移动的成员搬回原位', async () => {
  await withHome(async home => {
    const first = 'session-33333333-3333-3333-3333-333333333333'
    const second = 'session-44444444-4444-4444-4444-444444444444'
    const firstDir = await makeSessionDir(home, first)
    await assert.rejects(() => moveIntoTrash({
      members: [
        { sessionId: first, dirPath: firstDir, isRoot: true },
        { sessionId: second, dirPath: join(home, 'sessions', 'missing', second), isRoot: false },
      ],
      meta: { sessionId: first },
    }))
    assert.equal((await readFile(join(firstDir, 'session.v4.jsonl'), 'utf8')).length, 10)
    assert.deepEqual(await listEntries(), [])
  })
})
