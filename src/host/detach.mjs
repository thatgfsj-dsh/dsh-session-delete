/**
 * 摘活体与清登记：会话 store detach、工作区记账/归档/置顶清理、投影缓存清理，
 * 以及还原时的反向恢复。全部按官方公开通道走；通道缺失时降级并写明原因。
 */
import { unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { projCacheDir } from './paths.mjs'

/**
 * 把活体会话的缓冲事件刷到磁盘，让随后的目录搬移搬走完整日志。
 * @param {object} ctx - 宿主插件上下文。
 * @param {string} sessionId - 会话 ID。
 * @returns {Promise<{ok: boolean, detail: string}>} 结果。
 */
export async function flushLiveSession(ctx, sessionId) {
  const sessions = ctx.get('sessions')
  const session = sessions?.get?.(sessionId)
  if (session === undefined) return { ok: true, detail: '会话不在内存中，无需刷盘' }
  if (typeof sessions.flush !== 'function') return { ok: true, detail: '当前 sessions 服务没有 flush 通道，跳过刷盘' }
  try {
    await sessions.flush(session)
    return { ok: true, detail: '已刷盘' }
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * 把会话从内存 store 里摘掉，并触发 `session/disposed`（宿主据此广播 `api-session/removed`）。
 * 只走官方内部通道 `liveEntryFor` + `detachEntered`；两者缺失时降级为「需要重启宿主」。
 * @param {object} ctx - 宿主插件上下文。
 * @param {string} sessionId - 会话 ID。
 * @returns {Promise<{status: 'detached'|'not-live'|'unsupported'|'failed', detail: string}>} 结果。
 */
export async function detachLiveSession(ctx, sessionId) {
  const sessions = ctx.get('sessions')
  if (sessions === undefined) return { status: 'unsupported', detail: '未找到 sessions 服务' }
  const session = sessions.get?.(sessionId)
  if (session === undefined) return { status: 'not-live', detail: '会话不在内存中' }
  if (typeof sessions.liveEntryFor !== 'function' || typeof sessions.detachEntered !== 'function') {
    return { status: 'unsupported', detail: '当前 DSH 版本没有 liveEntryFor/detachEntered 通道，需重启宿主后侧栏行才会消失' }
  }
  try {
    const entry = sessions.liveEntryFor(session)
    sessions.detachEntered(entry)
    return { status: 'detached', detail: '已摘除活体会话' }
  } catch (error) {
    return { status: 'failed', detail: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * 清工作区记账、归档集合、置顶集合。三步互相独立，某一步失败不影响其它步。
 * @param {object} ctx - 宿主插件上下文。
 * @param {string} sessionId - 会话 ID。
 * @returns {Promise<{steps: {step: string, ok: boolean, detail: string}[]}>} 分步结果。
 */
export async function cleanWorkspaceRecords(ctx, sessionId) {
  const steps = []
  const registry = ctx.get('workspaceRegistry')
  if (registry === undefined) {
    return { steps: [{ step: 'workspace', ok: false, detail: 'workspaceRegistry 未激活，工作区记账与归档标记未清理（重启后由宿主自动修剪）' }] }
  }
  let detached = 0
  try {
    for (const entity of registry.list()) {
      let ids = []
      try {
        ids = entity.sessionIds
      } catch {
        ids = []
      }
      if (!ids.includes(sessionId)) continue
      await entity.detachSession(sessionId)
      detached += 1
    }
    steps.push({ step: 'workspace', ok: true, detail: detached === 0 ? '会话不在任何工作区记账里' : `已从 ${detached} 个工作区记账里摘除` })
  } catch (error) {
    steps.push({ step: 'workspace', ok: false, detail: `工作区记账清理失败：${error instanceof Error ? error.message : String(error)}` })
  }
  try {
    await registry.unarchiveSession(sessionId)
    steps.push({ step: 'archive', ok: true, detail: '已从归档集合移除' })
  } catch (error) {
    steps.push({ step: 'archive', ok: false, detail: `归档集合清理失败：${error instanceof Error ? error.message : String(error)}` })
  }
  try {
    await registry.unpinSession(sessionId)
    steps.push({ step: 'pin', ok: true, detail: '已从置顶集合移除' })
  } catch (error) {
    steps.push({ step: 'pin', ok: false, detail: `置顶集合清理失败：${error instanceof Error ? error.message : String(error)}` })
  }
  return { steps }
}

/**
 * 清投影缓存：先删域记录（内存 + 介质），再兜底删两种命名的分片文件。
 * @param {object} ctx - 宿主插件上下文。
 * @param {string} sessionId - 会话 ID。
 * @returns {Promise<{steps: {step: string, ok: boolean, detail: string}[], leftovers: string[]}>} 分步结果。
 */
export async function cleanProjectionCache(ctx, sessionId) {
  const steps = []
  const leftovers = []
  const variants = [sessionId]
  const facility = ctx.get('storageDomain')
  const domain = typeof facility?.get === 'function' ? facility.get('session_projcache') : undefined
  if (domain !== undefined && typeof domain.table === 'function') {
    try {
      const table = domain.table('sessions')
      let removed = 0
      for (const variant of variants) {
        if (await table.delete(variant)) removed += 1
      }
      steps.push({ step: 'projection-domain', ok: true, detail: removed === 0 ? '投影缓存域里没有该会话的记录' : `已删除 ${removed} 条投影缓存域记录` })
    } catch (error) {
      steps.push({ step: 'projection-domain', ok: false, detail: `投影缓存域记录删除失败：${error instanceof Error ? error.message : String(error)}` })
    }
  } else {
    steps.push({ step: 'projection-domain', ok: false, detail: 'session_projcache 域未打开，只清理分片文件' })
  }
  let files = 0
  for (const variant of variants) {
    const path = join(projCacheDir(), `${variant}.json`)
    try {
      await unlink(path)
      files += 1
    } catch (error) {
      if (error?.code !== 'ENOENT') leftovers.push(path)
    }
  }
  steps.push({ step: 'projection-files', ok: leftovers.length === 0, detail: files === 0 ? '没有残留的投影缓存分片' : `已删除 ${files} 个投影缓存分片` })
  return { steps, leftovers }
}

/**
 * 还原时恢复工作区记账、位置、归档与置顶标记。
 * @param {object} ctx - 宿主插件上下文。
 * @param {object} entry - 回收站条目（归一化元数据）。
 * @returns {Promise<{steps: {step: string, ok: boolean, detail: string}[]}>} 分步结果。
 */
export async function restoreWorkspaceRecords(ctx, entry) {
  const steps = []
  const registry = ctx.get('workspaceRegistry')
  if (registry === undefined) {
    return { steps: [{ step: 'workspace', ok: false, detail: 'workspaceRegistry 未激活，工作区归属需重启宿主后自动重建' }] }
  }
  let entity
  try {
    if (typeof entry.workspaceId === 'string' && entry.workspaceId !== '') entity = registry.get(entry.workspaceId)
    if (entity === undefined && typeof entry.workspacePath === 'string' && entry.workspacePath !== '') {
      entity = await registry.resolveByPath(entry.workspacePath)
    }
  } catch (error) {
    steps.push({ step: 'workspace', ok: false, detail: `工作区定位失败：${error instanceof Error ? error.message : String(error)}` })
  }
  if (entity === undefined) {
    steps.push({ step: 'workspace', ok: false, detail: '未找到原工作区，会话会以无归属状态出现' })
  } else {
    try {
      await entity.attachSession(entry.sessionId)
      if (typeof entry.beforeSessionId === 'string' && entry.beforeSessionId !== '') {
        try {
          await entity.insertSessionBefore(entry.sessionId, entry.beforeSessionId)
        } catch {
          /* 原位置锚点已不存在时停在首位，不影响可用性 */
        }
      }
      steps.push({ step: 'workspace', ok: true, detail: `已恢复到工作区「${entity.title}」` })
    } catch (error) {
      steps.push({ step: 'workspace', ok: false, detail: `工作区记账恢复失败：${error instanceof Error ? error.message : String(error)}` })
    }
    // 子树里的子代理会话也一起恢复记账（它们原来可能被单独记账）。
    for (const member of entry.members) {
      if (member.isRoot === true || member.sessionId === entry.sessionId) continue
      try {
        await entity.attachSession(member.sessionId)
        steps.push({ step: `workspace-child:${member.sessionId}`, ok: true, detail: '已恢复子代理会话记账' })
      } catch (error) {
        steps.push({ step: `workspace-child:${member.sessionId}`, ok: false, detail: `子代理会话记账恢复失败：${error instanceof Error ? error.message : String(error)}` })
      }
    }
  }
  if (entry.pinned === true) {
    try {
      await registry.pinSession(entry.sessionId)
      steps.push({ step: 'pin', ok: true, detail: '已恢复置顶标记' })
    } catch (error) {
      steps.push({ step: 'pin', ok: false, detail: `置顶标记恢复失败：${error instanceof Error ? error.message : String(error)}` })
    }
  }
  if (entry.archived === true) {
    try {
      await registry.archiveSession(entry.sessionId)
      steps.push({ step: 'archive', ok: true, detail: '已恢复归档标记' })
    } catch (error) {
      steps.push({ step: 'archive', ok: false, detail: `归档标记恢复失败：${error instanceof Error ? error.message : String(error)}` })
    }
  }
  return { steps }
}
