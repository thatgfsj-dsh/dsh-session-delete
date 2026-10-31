/**
 * 批量管理用的会话清单：轻量、只读，不做全量磁盘扫描。
 *
 * 数据来源：持久化快照（`sessionPersistence.list()`，带 sizeBytes）、活体会话、工作区记账、
 * 归档/置顶集合、agent 运行状态、子代理血缘（header.parentSession + origin=subagent）。
 * 标题优先活体投影，其次投影缓存分片，按有界并发读取。
 */
import { readSnapshotIndex, resolveTitle } from './session-meta.mjs'

/** 标题读取并发上限，避免几百个会话同时打满文件 IO。 */
const TITLE_CONCURRENCY = 8

/**
 * 有界并发地处理数组。
 * @param {unknown[]} items - 输入。
 * @param {number} limit - 并发上限。
 * @param {(item: unknown, index: number) => Promise<unknown>} work - 处理函数。
 * @returns {Promise<unknown[]>} 与输入同序的结果。
 */
async function mapLimit(items, limit, work) {
  const results = new Array(items.length)
  let cursor = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = cursor
      cursor += 1
      if (index >= items.length) return
      results[index] = await work(items[index], index)
    }
  })
  await Promise.all(workers)
  return results
}

/**
 * 采集全部会话的轻量清单，供批量管理面板使用。
 * @param {object} ctx - 宿主插件上下文。
 * @returns {Promise<{sessions: object[], workspaces: object[], total: number, degraded: string[]}>} 清单。
 */
export async function collectSessionList(ctx) {
  const index = await readSnapshotIndex(ctx)
  const headers = new Map()
  for (const [id, snapshot] of index.snapshots) headers.set(id, snapshot.header)
  for (const [id, session] of index.live) headers.set(id, session.header)
  const registry = ctx.get('workspaceRegistry')
  const workspaces = []
  const workspaceOf = new Map()
  if (registry !== undefined && typeof registry.list === 'function') {
    for (const entity of registry.list()) {
      let ids = []
      try {
        ids = entity.sessionIds
      } catch {
        ids = []
      }
      const info = { id: entity.id, title: entity.title, path: entity.path, order: workspaces.length }
      workspaces.push(info)
      ids.forEach((sessionId, position) => workspaceOf.set(sessionId, { ...info, position }))
    }
  }
  const archived = new Set(registry?.archivedSessionIds ?? [])
  const pinned = new Set(registry?.pinnedSessionIds ?? [])
  const agents = ctx.get('agents')

  // 子代理计数：header 里 origin=subagent 且 parentSession 指向当前会话。
  const childCount = new Map()
  for (const header of headers.values()) {
    if (header?.origin !== 'subagent' || typeof header.parentSession !== 'string') continue
    childCount.set(header.parentSession, (childCount.get(header.parentSession) ?? 0) + 1)
  }

  const ids = [...headers.keys()]
  const sessions = await mapLimit(ids, TITLE_CONCURRENCY, async (sessionId) => {
    const header = headers.get(sessionId)
    const workspace = workspaceOf.get(sessionId)
    const title = await resolveTitle(ctx, sessionId, '')
    return {
      sessionId,
      title,
      workspace: workspace === undefined ? null : { id: workspace.id, title: workspace.title, path: workspace.path },
      workspacePosition: workspace?.order ?? Number.MAX_SAFE_INTEGER,
      sessionPosition: workspace?.position ?? Number.MAX_SAFE_INTEGER,
      archived: archived.has(sessionId),
      pinned: pinned.has(sessionId),
      live: index.live.has(sessionId),
      running: agents?.get?.(sessionId)?.status === 'running',
      subagentCount: childCount.get(sessionId) ?? 0,
      sizeBytes: index.snapshots.get(sessionId)?.sizeBytes ?? 0,
      cwd: typeof header?.cwd === 'string' ? header.cwd : '',
    }
  })
  sessions.sort((left, right) => {
    if (left.workspacePosition !== right.workspacePosition) return left.workspacePosition - right.workspacePosition
    if (left.sessionPosition !== right.sessionPosition) return left.sessionPosition - right.sessionPosition
    return left.sessionId.localeCompare(right.sessionId)
  })
  return { sessions, workspaces, total: sessions.length, degraded: index.degraded }
}
