/**
 * 会话清单单测：按工作区排序、标题、运行态、归档/置顶、子代理计数与大小。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { collectSessionList } from '../src/host/sessions-list.mjs'
import { makeFakeCtx, makeWorkspace } from './fakes.mjs'

const ROOT = 'session-aaaaaaaa-1111-2222-3333-444444444444'
const CHILD = 'session-cccccccc-1111-2222-3333-444444444444'
const OTHER = 'session-bbbbbbbb-1111-2222-3333-444444444444'

async function withHome(run) {
  const previous = process.env.DSH_HOME
  const home = await mkdtemp(join(tmpdir(), 'dsh-sd-list-'))
  process.env.DSH_HOME = home
  try {
    await run(home)
  } finally {
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
    await rm(home, { recursive: true, force: true })
  }
}

test('collectSessionList：工作区分组、排序、运行态、归档置顶与子代理计数', async () => {
  await withHome(async home => {
    const snapshots = [
      { header: { id: ROOT, cwd: '/proj' }, sizeBytes: 100 },
      { header: { id: CHILD, cwd: '/proj', parentSession: ROOT, origin: 'subagent' }, sizeBytes: 50 },
      { header: { id: OTHER, cwd: '/other' }, sizeBytes: 30 },
    ]
    const { entity: first } = makeWorkspace({ id: 'ws-1', title: '工作区一', sessionIds: [ROOT, CHILD] })
    const { entity: second } = makeWorkspace({ id: 'ws-2', title: '工作区二', sessionIds: [OTHER] })
    const registry = {
      list: () => [first, second],
      get: id => (id === 'ws-1' ? first : id === 'ws-2' ? second : undefined),
      resolveByPath: async () => undefined,
      archivedSessionIds: [OTHER],
      pinnedSessionIds: [ROOT],
      unarchiveSession: async () => {},
      unpinSession: async () => {},
      pinSession: async () => {},
      archiveSession: async () => {},
      stopSessionActivity: async () => {},
    }
    const fake = makeFakeCtx({
      home,
      snapshots,
      registry,
      runningIds: [OTHER],
      sessions: [
        { id: ROOT, header: { id: ROOT, cwd: '/proj' } },
        { id: CHILD, header: { id: CHILD, cwd: '/proj', parentSession: ROOT, origin: 'subagent' } },
      ],
      projections: { stateOf: (_session, key) => (key === 'title' ? '活体标题' : undefined) },
    })
    const list = await collectSessionList(fake.ctx)
    assert.equal(list.total, 3)
    assert.deepEqual(list.workspaces.map(item => item.title), ['工作区一', '工作区二'])
    assert.deepEqual(list.sessions.map(item => item.sessionId), [ROOT, CHILD, OTHER])
    const root = list.sessions[0]
    assert.equal(root.title, '活体标题')
    assert.equal(root.workspace.title, '工作区一')
    assert.equal(root.pinned, true)
    assert.equal(root.archived, false)
    assert.equal(root.subagentCount, 1)
    assert.equal(root.sizeBytes, 100)
    assert.equal(root.live, true)
    const other = list.sessions[2]
    assert.equal(other.running, true)
    assert.equal(other.archived, true)
    assert.equal(other.workspace.title, '工作区二')
  })
})
