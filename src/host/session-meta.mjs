/**
 * 会话元数据采集：持久化记录、活体会话、标题、工作区归属、子代理树、运行状态、磁盘占用、
 * 以及会话目录的定位。所有宿主服务都通过 `ctx.get()` 取，缺失时按「降级 + 记录原因」处理。
 */
import { readdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { exists, readJsonSafe, sizeOf, statSafe } from './fs-util.mjs'
import { idVariants, predictedSessionDir, projCacheDir, sessionsRoot } from './paths.mjs'

/**
 * 读取全部持久化会话快照，按 id 建索引；持久化服务不可用时退回活体会话。
 * @param {object} ctx - 宿主插件上下文。
 * @returns {Promise<{snapshots: Map<string, object>, live: Map<string, object>, degraded: string[]}>} 索引。
 */
export async function readSnapshotIndex(ctx) {
  const degraded = []
  const snapshots = new Map()
  const persistence = ctx.get('sessionPersistence')
  if (persistence !== undefined && typeof persistence.list === 'function') {
    try {
      for (const snapshot of await persistence.list()) {
        const header = snapshot?.header
        if (header !== undefined && typeof header.id === 'string') {
          snapshots.set(header.id, { header, sizeBytes: Number.isFinite(snapshot.sizeBytes) ? snapshot.sizeBytes : 0 })
        }
      }
    } catch (error) {
      degraded.push(`读取会话持久化列表失败：${error instanceof Error ? error.message : String(error)}`)
    }
  } else {
    degraded.push('未找到 sessionPersistence 服务，子代理树与磁盘定位只能按活体会话与目录扫描推断')
  }
  const live = new Map()
  const sessions = ctx.get('sessions')
  if (sessions !== undefined && typeof sessions.list === 'function') {
    for (const session of sessions.list()) {
      if (session?.header !== undefined) live.set(session.id, session)
    }
  }
  return { snapshots, live, degraded }
}

/**
 * 解析一个会话的 header：活体会话优先，其次持久化快照。
 * @param {object} ctx - 宿主插件上下文。
 * @param {string} sessionId - 会话 ID。
 * @param {{snapshots: Map<string, object>, live: Map<string, object>}} index - 快照索引。
 * @returns {object|undefined} header。
 */
export function resolveHeader(ctx, sessionId, index) {
  const live = index.live.get(sessionId)
  if (live !== undefined) return live.header
  return index.snapshots.get(sessionId)?.header
}

/**
 * 从投影缓存分片里读标题（冷会话没有活体投影可用）。
 * @param {string} sessionId - 会话 ID。
 * @returns {Promise<string>} 标题，读不到返回空串。
 */
async function titleFromProjectionCache(sessionId) {
  for (const variant of idVariants(sessionId)) {
    const raw = await readJsonSafe(join(projCacheDir(), `${variant}.json`))
    const value = raw?.record?.rows?.title?.val
    if (typeof value === 'string' && value !== '') return value
  }
  return ''
}

/**
 * 解析会话标题：活体投影 → 投影缓存分片 → 调用方给的提示。
 * @param {object} ctx - 宿主插件上下文。
 * @param {string} sessionId - 会话 ID。
 * @param {string} [hint] - 客户端行内已有的标题。
 * @returns {Promise<string>} 标题（可能为空）。
 */
export async function resolveTitle(ctx, sessionId, hint) {
  const live = ctx.get('sessions')?.get(sessionId)
  if (live !== undefined) {
    const projections = ctx.get('sessionProjections')
    if (projections !== undefined && typeof projections.stateOf === 'function') {
      try {
        const value = projections.stateOf(live, 'title')
        if (typeof value === 'string' && value !== '') return value
      } catch {
        /* 投影不可读时退回缓存 */
      }
    }
  }
  const cached = await titleFromProjectionCache(sessionId)
  if (cached !== '') return cached
  return typeof hint === 'string' ? hint : ''
}

/**
 * 定位会话目录：官方 `persistence.locate()` → 扫描会话根 → 按官方布局推算。
 * @param {object} ctx - 宿主插件上下文。
 * @param {object} header - 会话 header。
 * @returns {Promise<string|undefined>} 已确认存在的会话目录绝对路径。
 */
export async function resolveSessionDir(ctx, header) {
  if (header === undefined || typeof header.id !== 'string') return undefined
  const persistence = ctx.get('sessionPersistence')
  if (persistence !== undefined && typeof persistence.locate === 'function') {
    try {
      const located = persistence.locate({ id: header.id, cwd: header.cwd })
      if (typeof located?.path === 'string') {
        const dir = dirname(located.path)
        if (await exists(dir)) return dir
      }
    } catch {
      /* 定位失败时继续走扫描 */
    }
  }
  const variants = idVariants(header.id).map(name => ({ raw: name }))
  const candidates = []
  if (typeof header.cwd === 'string' && header.cwd !== '') {
    for (const variant of variants) candidates.push(predictedSessionDir(variant.raw, header.cwd))
  }
  for (const variant of variants) candidates.push(predictedSessionDir(variant.raw, undefined))
  let projectDirs = []
  try {
    projectDirs = (await readdir(sessionsRoot(), { withFileTypes: true })).filter(entry => entry.isDirectory()).map(entry => entry.name)
  } catch {
    projectDirs = []
  }
  for (const project of projectDirs) {
    for (const variant of variants) candidates.push(join(sessionsRoot(), project, variant.raw))
  }
  for (const candidate of candidates) {
    const info = await statSafe(candidate)
    if (info?.isDirectory() === true) return candidate
  }
  return undefined
}

/**
 * 沿 `header.parentSession` 收集子代理会话（只认 `origin: 'subagent'`，fork 是独立会话不算子树）。
 * @param {Map<string, object>} headers - 全部已知 header，按 id 索引。
 * @param {string} rootId - 根会话 ID。
 * @returns {string[]} 后代会话 ID，先序。
 */
export function collectDescendants(headers, rootId) {
  const childrenOf = new Map()
  for (const header of headers.values()) {
    if (header.parentSession === undefined || header.origin !== 'subagent') continue
    const siblings = childrenOf.get(header.parentSession) ?? []
    siblings.push(header.id)
    childrenOf.set(header.parentSession, siblings)
  }
  const out = []
  const seen = new Set([rootId])
  const queue = [...(childrenOf.get(rootId) ?? [])]
  while (queue.length > 0) {
    const id = queue.shift()
    if (seen.has(id)) continue
    seen.add(id)
    out.push(id)
    for (const child of childrenOf.get(id) ?? []) queue.push(child)
  }
  return out
}

/**
 * 读取一个会话当前的活动族（turn / job / schedule / subagent）。
 * 走官方 `workspace/session-activity` 瀑布，任何 provider 失败都降级为「未知」而不是假装空闲。
 * @param {object} ctx - 宿主插件上下文。
 * @param {string} sessionId - 会话 ID。
 * @returns {Promise<{known: boolean, activity: object[], error: string}>} 活动结果。
 */
export async function collectActivity(ctx, sessionId) {
  try {
    const activity = await ctx.waterfall('workspace/session-activity', { sessionId }, () => Promise.resolve([]))
    return { known: true, activity: Array.isArray(activity) ? activity : [], error: '' }
  } catch (error) {
    return { known: false, activity: [], error: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * 会话是否正在运行（活体 Agent 状态或活动族里有 turn）。
 * @param {object} ctx - 宿主插件上下文。
 * @param {string} sessionId - 会话 ID。
 * @param {{known: boolean, activity: object[]}} activity - 活动结果。
 * @returns {boolean} 是否运行中。
 */
export function isRunning(ctx, sessionId, activity) {
  const agent = ctx.get('agents')?.get?.(sessionId)
  if (agent?.status === 'running') return true
  return Array.isArray(activity?.activity) && activity.activity.some(entry => entry?.kind === 'turn')
}

/**
 * 找到会话所属的工作区记录。
 * @param {object} ctx - 宿主插件上下文。
 * @param {string} sessionId - 会话 ID。
 * @returns {{id: string, path: string, title: string, index: number, beforeSessionId: string}|undefined} 工作区信息。
 */
export function resolveWorkspace(ctx, sessionId) {
  const registry = ctx.get('workspaceRegistry')
  if (registry === undefined || typeof registry.list !== 'function') return undefined
  for (const entity of registry.list()) {
    let ids = []
    try {
      ids = entity.sessionIds
    } catch {
      ids = []
    }
    const index = ids.indexOf(sessionId)
    if (index === -1) continue
    return {
      id: entity.id,
      path: entity.path,
      title: entity.title,
      index,
      beforeSessionId: index >= 0 && index + 1 < ids.length ? ids[index + 1] : '',
    }
  }
  return undefined
}

/**
 * 采集一个会话（含子树）的完整删除前元数据。
 * @param {object} ctx - 宿主插件上下文。
 * @param {string} sessionId - 会话 ID。
 * @param {{title?: string, index?: {snapshots: Map<string, object>, live: Map<string, object>, degraded: string[]}}} [options] - 标题提示与复用索引。
 * @returns {Promise<object>} 元数据。
 */
export async function collectSessionMeta(ctx, sessionId, options = {}) {
  const index = options.index ?? await readSnapshotIndex(ctx)
  const header = resolveHeader(ctx, sessionId, index)
  const headers = new Map()
  for (const [id, snapshot] of index.snapshots) headers.set(id, snapshot.header)
  for (const [id, session] of index.live) headers.set(id, session.header)
  const descendants = collectDescendants(headers, sessionId)
  const activity = await collectActivity(ctx, sessionId)
  const running = isRunning(ctx, sessionId, activity)
  const title = await resolveTitle(ctx, sessionId, options.title)
  const workspace = resolveWorkspace(ctx, sessionId)
  const dir = await resolveSessionDir(ctx, header)
  const sizeBytes = dir === undefined ? 0 : await sizeOf(dir)
  const members = []
  if (dir !== undefined) {
    members.push({ sessionId, dirPath: dir, title, isRoot: true, sizeBytes })
  }
  const descendantsMeta = []
  for (const childId of descendants) {
    const childHeader = resolveHeader(ctx, childId, index)
    const childDir = await resolveSessionDir(ctx, childHeader)
    const childSize = childDir === undefined ? 0 : await sizeOf(childDir)
    const childTitle = await resolveTitle(ctx, childId, '')
    const childRunning = isRunning(ctx, childId, await collectActivity(ctx, childId))
    descendantsMeta.push({
      sessionId: childId,
      title: childTitle,
      dirPath: childDir,
      sizeBytes: childSize,
      running: childRunning,
      parentSession: childHeader?.parentSession ?? '',
    })
    if (childDir !== undefined) {
      members.push({ sessionId: childId, dirPath: childDir, title: childTitle, isRoot: false, sizeBytes: childSize })
    }
  }
  return {
    sessionId,
    header,
    title,
    dir,
    sizeBytes,
    workspace,
    descendants: descendantsMeta,
    activity: activity.activity,
    activityKnown: activity.known,
    activityError: activity.error,
    running,
    live: index.live.has(sessionId),
    archived: ctx.get('workspaceRegistry')?.archivedSessionIds?.includes(sessionId) === true,
    pinned: ctx.get('workspaceRegistry')?.pinnedSessionIds?.includes(sessionId) === true,
    members,
    degraded: index.degraded,
    exists: dir !== undefined || header !== undefined,
  }
}
