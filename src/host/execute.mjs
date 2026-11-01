/**
 * 删除事务编排：幂等检查 → 采集元数据 → 准入 → 移入回收站 / 彻底删除 → 摘活体 →
 * 清工作区记账与归档置顶 → 删投影缓存 → 广播 → 汇总结果。
 *
 * 顺序与失败语义：
 * - 先刷盘、再摘活体、等写句柄释放，最后才搬目录/删盘：反过来的话，目录已离开原位而
 *   持久化的异步 close 仍按原路径追加日志，会在原位留下无头残骸或旧锁，重开会话时卡死。
 * - 「移入回收站」的提交点是搬目录：搬移失败时目录没动，只是会话已从内存摘除（刷新页面可恢复），
 *   直接报错中止。
 * - 提交点之后（清记账 / 清缓存 / 清残骸）的失败不再回滚磁盘，逐条记为警告并返回，绝不静默。
 * - 彻底删除没有副本，同样先摘活体再删盘：摘活体失败直接中止，不留半残。
 */
import { exists, removeTree } from './fs-util.mjs'
import { DeleteError, ERROR_CODES } from './errors.mjs'
import { assertSessionId } from './paths.mjs'
import { collectSessionMeta, readSnapshotIndex } from './session-meta.mjs'
import { flushLiveSession, detachLiveSession, cleanWorkspaceRecords, cleanProjectionCache, restoreWorkspaceRecords } from './detach.mjs'
import { stopSessionActivity, waitQuiescent } from './stop.mjs'
import { emptyTrash, findEntryBySession, listEntries, moveIntoTrash, purgeEntry, readSettings, restoreEntry, sweepExpired } from './trash.mjs'

/** 一次删除事务允许携带的最大会话数（根 + 子代理），防止异常树把请求拖死。 */
const MAX_TREE = 200

/** 记录一步结果。 */
const step = (steps, name, ok, detail) => {
  steps.push({ step: name, ok, detail })
}

/**
 * 准入判定：运行中是否允许先停、子代理是否运行。
 * @param {object} ctx - 宿主插件上下文。
 * @param {object} meta - 元数据。
 * @param {boolean} stopIfRunning - 是否允许先停止再删除。
 * @param {object[]} steps - 步骤记录。
 * @returns {Promise<boolean>} 是否真正执行过停止。
 */
async function admit(ctx, meta, stopIfRunning, steps) {
  const runningChildren = meta.descendants.filter(item => item.running === true)
  // 子代理整树策略：任一子代理运行中就整体拒绝，不替用户停子代理——避免「先停再删」把别的任务砍掉。
  if (runningChildren.length > 0) {
    throw new DeleteError(ERROR_CODES.subagentRunning, `运行中的子代理会话：${runningChildren.map(item => item.sessionId).join('、')}，请等它们结束后再删除`, { status: 409 })
  }
  if (!meta.running) {
    step(steps, 'admission', true, '会话空闲，允许删除')
    return false
  }
  if (!stopIfRunning) {
    throw new DeleteError(ERROR_CODES.running, '请在弹窗里勾选「先停止运行，再移入回收站」后重试', { status: 409 })
  }
  step(steps, 'admission', true, '会话正在运行，按用户勾选先停止再删除')
  const stopped = await stopSessionActivity(ctx, meta.sessionId)
  step(steps, 'stop', stopped.error === '', stopped.error === '' ? `已请求停止（${stopped.via}）` : `停止请求失败：${stopped.error}`)
  const quiet = await waitQuiescent(ctx, [meta.sessionId])
  if (!quiet.quiescent) {
    throw new DeleteError(ERROR_CODES.stillRunning, `仍有活动：${quiet.remaining.map(item => `${item.sessionId}(${item.kinds.join('/')})`).join('、')}`, { status: 409 })
  }
  step(steps, 'quiesce', true, '会话已静默')
  return true
}

/**
 * 摘除一组会话的活体，返回失败项。
 * @param {object} ctx - 宿主插件上下文。
 * @param {string[]} ids - 会话 ID。
 * @param {object[]} steps - 步骤记录。
 * @returns {Promise<{failed: {sessionId: string, detail: string}[], unsupported: string[]}>} 结果。
 */
async function detachAll(ctx, ids, steps) {
  const failed = []
  const unsupported = []
  const detachedIds = []
  for (const id of ids) {
    const result = await detachLiveSession(ctx, id)
    if (result.status === 'failed') {
      failed.push({ sessionId: id, detail: result.detail })
      step(steps, `detach:${id}`, false, result.detail)
    } else if (result.status === 'unsupported') {
      unsupported.push(id)
      step(steps, `detach:${id}`, false, result.detail)
    } else {
      if (result.status === 'detached') detachedIds.push(id)
      step(steps, `detach:${id}`, true, result.detail)
    }
  }
  return { failed, unsupported, detachedIds }
}

/** 短暂等待（毫秒）。 */
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))

/**
 * 摘活体后等宿主把持久化写句柄关掉：`session/disposed` 的 close 是异步的，
 * 不等它就去搬目录，close 的 drain 会按原路径把日志写回原位。
 * @param {object} ctx - 宿主插件上下文。
 * @param {string[]} detachedIds - 真正被摘除的会话 ID。
 * @returns {Promise<void>} 等待结束。
 */
async function settleAfterDetach(ctx, detachedIds) {
  if (detachedIds.length === 0) return
  const sessions = ctx.get('sessions')
  const deadline = Date.now() + 800
  while (Date.now() < deadline) {
    if (detachedIds.every(id => sessions?.get?.(id) === undefined)) break
    await sleep(50)
  }
  // 给持久化 close 的 drain/release 留一个很短的静默窗口（正常情况无缓冲事件，几毫秒即可）。
  await sleep(120)
}

/**
 * 删除后复检原位：有些组件（或插件自己的写句柄）会按旧路径把日志写回来，
 * 留下没有头部的残骸目录。它在宿主看来不是一个合法会话，却会让“重开会话”卡在坏日志上。
 * 这里把无头残骸清掉；如果宿主已经把同 id 重新登记成合法会话，则保留并告警。
 * @param {object} ctx - 宿主插件上下文。
 * @param {{sessionId: string, dirPath: string}[]} members - 本次处理的会话目录。
 * @param {object[]} steps - 步骤记录。
 * @param {string[]} warnings - 警告收集。
 * @param {string[]} leftovers - 残留收集。
 * @returns {Promise<void>} 完成。
 */
export async function cleanResurrectedResidue(ctx, members, steps, warnings, leftovers) {
  if (members.length === 0) return
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await sleep(attempt === 0 ? 150 : 200)
    const present = []
    for (const member of members) {
      if (await exists(member.dirPath)) present.push(member)
    }
    if (present.length === 0) return
    let listed
    try {
      const persistence = ctx.get('sessionPersistence')
      if (persistence !== undefined && typeof persistence.list === 'function') {
        listed = new Set((await persistence.list()).map(snapshot => snapshot?.header?.id))
      }
    } catch {
      listed = undefined
    }
    let keptLegal = false
    for (const member of present) {
      if (listed !== undefined && listed.has(member.sessionId)) {
        warnings.push(`${member.sessionId}：删除后又被宿主重新登记为合法会话，已保留；如需删除请重新执行`)
        if (!leftovers.includes(member.dirPath)) leftovers.push(member.dirPath)
        keptLegal = true
        continue
      }
      try {
        await removeTree(member.dirPath)
        step(steps, `residue:${member.sessionId}`, true, '已清理删除后重新出现的无头残骸目录')
        warnings.push(`${member.sessionId}：删除后原位出现无头残骸（其它组件按旧路径写回），已清理`)
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error)
        step(steps, `residue:${member.sessionId}`, false, detail)
        warnings.push(`${member.sessionId}：删除后原位残骸清理失败（${detail}）`)
        if (!leftovers.includes(member.dirPath)) leftovers.push(member.dirPath)
        keptLegal = true
      }
    }
    if (keptLegal) return
  }
}

/**
 * 清一组会话的工作区记账与投影缓存，失败项进警告。
 * @param {object} ctx - 宿主插件上下文。
 * @param {string[]} ids - 会话 ID。
 * @param {object[]} steps - 步骤记录。
 * @param {string[]} warnings - 警告收集。
 * @param {string[]} leftovers - 残留收集。
 * @returns {Promise<void>} 完成。
 */
async function cleanWorkspaceOnly(ctx, ids, steps, warnings) {
  for (const id of ids) {
    const workspace = await cleanWorkspaceRecords(ctx, id)
    for (const entry of workspace.steps) {
      step(steps, `${entry.step}:${id}`, entry.ok, entry.detail)
      if (!entry.ok) warnings.push(`${id}：${entry.detail}`)
    }
  }
}

async function cleanProjectionOnly(ctx, ids, steps, warnings, leftovers) {
  for (const id of ids) {
    const projection = await cleanProjectionCache(ctx, id)
    for (const entry of projection.steps) {
      step(steps, `${entry.step}:${id}`, entry.ok, entry.detail)
      if (!entry.ok) warnings.push(`${id}：${entry.detail}`)
    }
    leftovers.push(...projection.leftovers)
  }
}

async function cleanAll(ctx, ids, steps, warnings, leftovers) {
  await cleanWorkspaceOnly(ctx, ids, steps, warnings)
  await cleanProjectionOnly(ctx, ids, steps, warnings, leftovers)
}


/** 清理已从回收站移除的条目的投影缓存（回收站模式保留、彻底清理时补删）。 */
async function cleanPurgedProjections(ctx, entries) {
  const warnings = []
  for (const entry of entries) {
    for (const member of entry.members ?? []) {
      const projection = await cleanProjectionCache(ctx, member.sessionId)
      for (const item of projection.steps) {
        if (!item.ok) warnings.push(`${member.sessionId}：${item.detail}`)
      }
    }
  }
  return warnings
}

/**
 * 广播会话已移除，让侧栏即时消失（活体会话的 disposed 也会触发同一条事件，重复广播无副作用）。
 * @param {object} ctx - 宿主插件上下文。
 * @param {string[]} ids - 会话 ID。
 * @param {object[]} steps - 步骤记录。
 * @returns {void}
 */
function broadcastRemoved(ctx, ids, steps, alreadyRemoved = new Set()) {
  let sent = 0
  for (const id of ids) {
    // 活体摘除时官方会在 session/disposed 里发同一条事件，这里只补发没发过的。
    if (alreadyRemoved.has(id)) continue
    try {
      ctx.emit('api-session/removed', id)
      sent += 1
    } catch (error) {
      steps.push({ step: `broadcast:${id}`, ok: false, detail: error instanceof Error ? error.message : String(error) })
    }
  }
  step(steps, 'broadcast', true, `已广播 ${sent} 条会话移除事件（${ids.length - sent} 条由活体摘除自动广播）`)
}

/**
 * 执行一次删除事务。
 * @param {object} ctx - 宿主插件上下文。
 * @param {{sessionId: string, mode?: 'trash'|'purge', stopIfRunning?: boolean, title?: string}} input - 请求参数。
 * @returns {Promise<object>} 事务结果（`ok` 为 false 时以 DeleteError 抛出，成功时返回摘要）。
 */
export async function executeDelete(ctx, input) {
  const startedAt = Date.now()
  const mode = input?.mode === 'purge' ? 'purge' : 'trash'
  const stopIfRunning = input?.stopIfRunning === true
  const steps = []
  const warnings = []
  const leftovers = []
  const sessionId = assertSessionId(input?.sessionId)

  const existingTrash = await findEntryBySession(sessionId)
  if (existingTrash !== undefined) {
    step(steps, 'idempotent', true, '会话已在回收站里，无需重复删除')
    return {
      ok: true,
      code: 'already-in-trash',
      message: '会话已在回收站里',
      sessionId,
      mode,
      trashId: existingTrash.trashId,
      steps,
      warnings,
      leftovers,
      durationMs: Date.now() - startedAt,
    }
  }

  const index = await readSnapshotIndex(ctx)
  const meta = await collectSessionMeta(ctx, sessionId, { title: input?.title, index })
  if (!meta.exists) {
    step(steps, 'idempotent', true, '会话已不存在')
    return {
      ok: true,
      code: 'already-gone',
      message: '会话已不存在（可能已被其它客户端删除）',
      sessionId,
      mode,
      steps,
      warnings,
      leftovers,
      durationMs: Date.now() - startedAt,
    }
  }
  step(steps, 'metadata', true, `采集到 ${meta.members.length} 个会话目录，共 ${meta.sizeBytes} 字节`)

  const ids = [sessionId, ...meta.descendants.map(item => item.sessionId)]
  if (ids.length > MAX_TREE) {
    throw new DeleteError(ERROR_CODES.tooManySubagents, `会话树共 ${ids.length} 个会话，超过上限 ${MAX_TREE}；为免留下半棵树，本次没有删除`, { status: 409 })
  }
  await admit(ctx, meta, stopIfRunning, steps)

  for (const id of ids) {
    const flushed = await flushLiveSession(ctx, id)
    if (!flushed.ok) warnings.push(`${id}：刷盘失败（${flushed.detail}）`)
  }
  step(steps, 'flush', true, '已尝试刷盘')

  const members = meta.members.filter(member => ids.includes(member.sessionId))
  const trashMeta = {
    sessionId,
    title: meta.title,
    sizeBytes: members.reduce((sum, member) => sum + (Number.isFinite(member.sizeBytes) ? member.sizeBytes : 0), 0),
    workspaceId: meta.workspace?.id ?? '',
    workspacePath: meta.workspace?.path ?? '',
    workspaceTitle: meta.workspace?.title ?? '',
    archived: meta.archived,
    pinned: meta.pinned,
    workspaceSessionIndex: meta.workspace?.index ?? -1,
    beforeSessionId: meta.workspace?.beforeSessionId ?? '',
    hostVersion: '',
  }

  // 目录已经不存在（只剩持久化/投影/记账残留）：不搬移、不报错，清掉残留登记即可。
  if (members.length === 0) {
    step(steps, 'disk', true, '磁盘上已经没有该会话目录')
    const detached = await detachAll(ctx, ids, steps)
    await settleAfterDetach(ctx, detached.detachedIds)
    await cleanAll(ctx, ids, steps, warnings, leftovers)
    broadcastRemoved(ctx, ids, steps, new Set(detached.detachedIds))
    return {
      ok: true,
      code: 'already-gone',
      message: '会话目录已不存在，只清理了残留登记',
      sessionId,
      mode,
      steps,
      warnings,
      leftovers,
      durationMs: Date.now() - startedAt,
    }
  }

  let trashEntry
  // 两种模式都先摘活体再动磁盘：先让持久化写句柄关闭、写锁释放，再搬目录。
  const detached = await detachAll(ctx, ids, steps)
  if (detached.failed.length > 0) {
    throw new DeleteError(ERROR_CODES.detachFailed, detached.failed.map(item => `${item.sessionId}: ${item.detail}`).join('；'), { status: 500 })
  }
  await settleAfterDetach(ctx, detached.detachedIds)

  if (mode === 'trash') {
    try {
      trashEntry = await moveIntoTrash({ members, meta: trashMeta })
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      step(steps, 'trash', false, detail)
      throw new DeleteError(ERROR_CODES.trashFailed, `${detail}（目录未移动；会话已从内存摘除，刷新页面即可恢复显示）`, { status: 500 })
    }
    step(steps, 'trash', true, `已移入回收站：${trashEntry.trashId}`)
  } else {
    for (const member of members) {
      try {
        await removeTree(member.dirPath)
        step(steps, `purge:${member.sessionId}`, true, `已删除目录 ${member.dirPath}`)
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error)
        step(steps, `purge:${member.sessionId}`, false, detail)
        leftovers.push(member.dirPath)
        warnings.push(`${member.sessionId}：目录删除失败（${detail}）`)
      }
    }
    step(steps, 'purge', true, '已彻底删除会话目录')
  }

  // 投影缓存两种模式都清：留下幽灵投影会让插件面板显示一个「还在、但点不开」的会话。
  // 回收站列表的标题来自 metadata.json，还原后标题由日志投影重新计算，不依赖旧缓存。
  await cleanAll(ctx, ids, steps, warnings, leftovers)
  await cleanResurrectedResidue(ctx, members, steps, warnings, leftovers)
  broadcastRemoved(ctx, ids, steps, new Set(detached.detachedIds))

  return {
    ok: true,
    code: 'ok',
    message: mode === 'trash' ? '已移入回收站' : '已彻底删除',
    sessionId,
    mode,
    trashId: trashEntry?.trashId,
    freedBytes: members.reduce((sum, member) => sum + (Number.isFinite(member.sizeBytes) ? member.sizeBytes : 0), 0),
    steps,
    warnings,
    leftovers,
    meta: {
      title: meta.title,
      sizeBytes: meta.sizeBytes,
      workspace: meta.workspace ?? null,
      descendants: meta.descendants.map(item => ({ sessionId: item.sessionId, title: item.title, running: item.running })),
      running: meta.running,
      live: meta.live,
      archived: meta.archived,
      pinned: meta.pinned,
      members: ids,
    },
    durationMs: Date.now() - startedAt,
  }
}

/**
 * 还原一条回收站条目：搬回原目录 → 恢复工作区记账/位置/归档/置顶 → 删除条目。
 * @param {object} ctx - 宿主插件上下文。
 * @param {string} sessionId - 会话 ID。
 * @returns {Promise<object>} 还原摘要。
 */
export async function executeRestore(ctx, sessionId) {
  const startedAt = Date.now()
  const id = assertSessionId(sessionId)
  const entry = await findEntryBySession(id)
  if (entry === undefined) throw new DeleteError(ERROR_CODES.notFound, '回收站里没有这个会话', { status: 404 })
  const steps = []
  const warnings = []
  let cleanupWarning = ''
  try {
    const restoredEntry = await restoreEntry(entry)
    cleanupWarning = restoredEntry.cleanupWarning ?? ''
  } catch (error) {
    throw new DeleteError(ERROR_CODES.restoreFailed, error instanceof Error ? error.message : String(error), { status: 500 })
  }
  if (cleanupWarning !== '') warnings.push(cleanupWarning)
  step(steps, 'restore', true, `已把 ${entry.members.length} 个目录搬回原位`)
  const workspace = await restoreWorkspaceRecords(ctx, entry)
  for (const item of workspace.steps) {
    step(steps, item.step, item.ok, item.detail)
    if (!item.ok) warnings.push(item.detail)
  }
  // 不伪造 `api-session/added`：宿主该事件的载荷是一份完整会话摘要，构造不出正确形状时
  // 会让侧栏出现残缺行。还原后的列表刷新由客户端调用 `sessions.manager.refreshList()` 完成。
  return {
    ok: true,
    code: 'ok',
    message: entry.archived === true ? '已还原会话（仍为归档状态）' : '已还原会话',
    sessionId: entry.sessionId,
    archived: entry.archived === true,
    restored: entry.members.map(member => member.sessionId),
    steps,
    warnings,
    durationMs: Date.now() - startedAt,
  }
}

/**
 * 彻底删除回收站里的一条条目。
 * @param {object} ctx - 宿主插件上下文。
 * @param {string} sessionId - 会话 ID。
 * @returns {Promise<object>} 删除摘要。
 */
export async function executePurgeTrashEntry(ctx, sessionId) {
  const startedAt = Date.now()
  const id = assertSessionId(sessionId)
  const entry = await findEntryBySession(id)
  if (entry === undefined) throw new DeleteError(ERROR_CODES.notFound, '回收站里没有这个会话', { status: 404 })
  let freedBytes = 0
  try {
    freedBytes = await purgeEntry(entry)
  } catch (error) {
    throw new DeleteError(ERROR_CODES.purgeFailed, error instanceof Error ? error.message : String(error), { status: 500 })
  }
  // 回收站模式保留了投影缓存，彻底删除时补清。
  const cleanupWarnings = []
  for (const member of entry.members) {
    const projection = await cleanProjectionCache(ctx, member.sessionId)
    for (const item of projection.steps) {
      if (!item.ok) cleanupWarnings.push(`${member.sessionId}：${item.detail}`)
    }
  }
  return {
    ok: true,
    code: 'ok',
    message: '已彻底删除回收站条目',
    sessionId: entry.sessionId,
    freedBytes,
    warnings: cleanupWarnings,
    durationMs: Date.now() - startedAt,
  }
}

/**
 * 清空回收站。
 * @param {object} ctx - 宿主插件上下文。
 * @returns {Promise<object>} 清空摘要。
 */
export async function executeEmptyTrash(ctx) {
  const startedAt = Date.now()
  const before = await listEntries()
  const result = await emptyTrash()
  if (result.failures.length > 0) {
    throw new DeleteError(ERROR_CODES.emptyFailed, result.failures.map(item => `${item.trashId}: ${item.reason}`).join('；'), {
      status: 500,
      extra: { removed: result.removed, freedBytes: result.freedBytes },
    })
  }
  const after = await listEntries()
  const remainingIds = new Set(after.map(entry => entry.trashId))
  const warnings = await cleanPurgedProjections(ctx, before.filter(entry => !remainingIds.has(entry.trashId)))
  const remainingNote = result.remaining > 0 ? `，仍有 ${result.remaining} 条未处理` : ''
  return {
    ok: true,
    code: 'ok',
    message: `已清空回收站（${result.removed} 条${remainingNote}）`,
    removed: result.removed,
    remaining: result.remaining,
    freedBytes: result.freedBytes,
    warnings,
    durationMs: Date.now() - startedAt,
  }
}

/**
 * 按当前保留策略立即清理过期条目（设置页「立即清理」）。
 * @param {object} ctx - 宿主插件上下文。
 * @returns {Promise<object>} 清理摘要。
 */
export async function executeSweep(ctx) {
  const startedAt = Date.now()
  const settings = await readSettings()
  const before = await listEntries()
  const result = await sweepExpired(settings)
  if (result.failures.length > 0) {
    throw new DeleteError(ERROR_CODES.emptyFailed, result.failures.map(item => `${item.trashId}: ${item.reason}`).join('；'), {
      status: 500,
      extra: { removed: result.removed, freedBytes: result.freedBytes },
    })
  }
  const after = await listEntries()
  const remainingIds = new Set(after.map(entry => entry.trashId))
  const warnings = await cleanPurgedProjections(ctx, before.filter(entry => !remainingIds.has(entry.trashId)))
  const remainingNote = result.remaining > 0 ? `，仍有 ${result.remaining} 条未处理` : ''
  return {
    ok: true,
    code: 'ok',
    message: result.removed === 0 ? '没有过期条目需要清理' : `已清理 ${result.removed} 条过期条目${remainingNote}`,
    removed: result.removed,
    remaining: result.remaining,
    freedBytes: result.freedBytes,
    warnings,
    durationMs: Date.now() - startedAt,
  }
}
