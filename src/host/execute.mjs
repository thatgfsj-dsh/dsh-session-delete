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
import { resolve } from 'node:path'
import { exists, removeTree } from './fs-util.mjs'
import { DeleteError, ERROR_CODES } from './errors.mjs'
import { assertSessionId, sessionsRoot } from './paths.mjs'
import { collectSessionMeta, readSnapshotIndex } from './session-meta.mjs'
import { flushLiveSession, detachLiveSession, cleanWorkspaceRecords, cleanProjectionCache, restoreWorkspaceRecords } from './detach.mjs'
import { stopSessionActivity, waitQuiescent } from './stop.mjs'
import { emptyTrash, findEntryBySession, isInside, listEntries, moveIntoTrash, purgeEntry, readSettings, restoreEntry, sweepExpired } from './trash.mjs'

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
 * 摘活体后给持久化 close 留一个很短的静默窗口。
 * 注意：`session/disposed` 的监听是 fire-and-forget（官方 close 不 await，也没有完成信号），
 * 只能按经验等待；更可靠的兜底是后续的残骸复检，而不是这个固定等待。
 * @param {string[]} detachedIds - 真正被摘除的会话 ID。
 * @returns {Promise<void>} 等待结束。
 */
async function settleAfterDetach(detachedIds) {
  if (detachedIds.length === 0) return
  await sleep(120)
}

/**
 * 删除后复检原位：有些组件（或插件自己的写句柄）会按旧路径把日志写回来，
 * 留下没有头部的残骸目录。它在宿主看来不是一个合法会话，却会让“重开会话”卡在坏日志上。
 *
 * 安全规则（红蓝对抗 P0）：
 * - 只有 `sessionPersistence.list()` **成功**且确认该 id 不是合法会话时才删除；
 *   list 不可用/抛错时一律 fail-closed（保留 + 告警），绝不盲删。
 * - 宿主已把同 id 重新登记成合法会话时保留并告警。
 * - 只在本次真的摘掉了活体（或 flush 失败）时开启持续探测窗口；
 *   冷会话删除只做一次即时检查，不付固定等待成本。
 * @param {object} ctx - 宿主插件上下文。
 * @param {{sessionId: string, dirPath: string}[]} members - 本次处理的会话目录。
 * @param {object[]} steps - 步骤记录。
 * @param {string[]} warnings - 警告收集。
 * @param {string[]} leftovers - 残留收集。
 * @param {{watch?: boolean}} [options] - `watch=true` 时在 ~1.5s 窗口内持续探测迟到写回。
 * @returns {Promise<void>} 完成。
 */
export async function cleanResurrectedResidue(ctx, members, steps, warnings, leftovers, options = {}) {
  const stats = { cleaned: 0, kept: 0, failed: 0 }
  if (members.length === 0) return stats
  const offsets = options.watch === true ? [0, 150, 450, 900, 1500] : [0]
  let elapsed = 0
  for (const offset of offsets) {
    if (offset > elapsed) {
      await sleep(offset - elapsed)
      elapsed = offset
    }
    const present = []
    for (const member of members) {
      if (await exists(member.dirPath)) present.push(member)
    }
    if (present.length === 0) continue
    let listed
    let listError = ''
    try {
      const persistence = ctx.get('sessionPersistence')
      if (persistence === undefined || typeof persistence.list !== 'function') listError = '会话持久化服务不可用'
      else listed = new Set((await persistence.list()).map(snapshot => snapshot?.header?.id))
    } catch (error) {
      listError = error instanceof Error ? error.message : String(error)
      listed = undefined
    }
    if (listed === undefined) {
      for (const member of present) {
        warnings.push(`${member.sessionId}：无法确认原位目录是否为合法会话（${listError || '列表不可用'}），已保留，请稍后重启宿主再清理`)
        if (!leftovers.includes(member.dirPath)) leftovers.push(member.dirPath)
        stats.kept += 1
      }
      return stats
    }
    let keep = false
    for (const member of present) {
      if (listed.has(member.sessionId)) {
        warnings.push(`${member.sessionId}：删除后又被宿主重新登记为合法会话，已保留；如需删除请重新执行`)
        if (!leftovers.includes(member.dirPath)) leftovers.push(member.dirPath)
        keep = true
        stats.kept += 1
        continue
      }
      const absolute = resolve(member.dirPath)
      if (!isInside(resolve(sessionsRoot()), absolute)) {
        warnings.push(`${member.sessionId}：原位路径不在会话根内（${absolute}），已保留`)
        if (!leftovers.includes(member.dirPath)) leftovers.push(member.dirPath)
        keep = true
        stats.kept += 1
        continue
      }
      try {
        await removeTree(member.dirPath)
        step(steps, `residue:${member.sessionId}`, true, '已清理删除后重新出现的无头残骸目录')
        stats.cleaned += 1
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error)
        step(steps, `residue:${member.sessionId}`, false, detail)
        warnings.push(`${member.sessionId}：删除后原位残骸清理失败（${detail}）`)
        if (!leftovers.includes(member.dirPath)) leftovers.push(member.dirPath)
        keep = true
        stats.failed += 1
      }
    }
    if (keep) return stats
  }
  return stats
}

/**
 * 删除事务返回后，在后台补几次残骸检查（不阻塞响应）。
 * 用于覆盖「异步 close / 迟到写回」落在事务窗口之外的场景；清理仍遵守 fail-closed。
 * @param {object} ctx - 宿主插件上下文。
 * @param {{sessionId: string, dirPath: string}[]} members - 本次会话目录。
 * @returns {void}
 */
/** 每个会话目录只保留一份后台清扫计划；还原成功时取消，避免还原后又被扫描打扰。 */
const pendingResidueSweeps = new Map()

/**
 * 取消指定目录的后台残骸清扫（还原成功后调用）。
 * @param {string[]} dirPaths - 会话目录绝对路径。
 * @returns {void}
 */
export function cancelResidueSweeps(dirPaths) {
  for (const dirPath of dirPaths) {
    const timers = pendingResidueSweeps.get(dirPath)
    if (timers === undefined) continue
    for (const timer of timers) clearTimeout(timer)
    pendingResidueSweeps.delete(dirPath)
  }
}

function scheduleResidueSweep(ctx, members) {
  if (members.length === 0) return
  for (const offset of [300, 900, 1800]) {
    const timer = setTimeout(() => {
      cleanResurrectedResidue(ctx, members, [], [], [], { watch: false })
        .then(stats => {
          if (stats.cleaned > 0) ctx.logger?.warn?.(`session-delete: 已清理删除后迟到写回的残骸 ${stats.cleaned} 个`)
          if (stats.kept > 0 || stats.failed > 0) ctx.logger?.warn?.(`session-delete: 删除后原位仍有目录（保留 ${stats.kept}、失败 ${stats.failed}），请重启宿主或手动检查`)
        })
        .catch(error => ctx.logger?.warn?.(`session-delete: 后台残骸清理失败：${error instanceof Error ? error.message : String(error)}`))
    }, offset)
    timer.unref?.()
    for (const member of members) {
      const timers = pendingResidueSweeps.get(member.dirPath) ?? []
      timers.push(timer)
      pendingResidueSweeps.set(member.dirPath, timers)
    }
  }
}

/**
 * 宿主缺少 liveEntryFor/detachEntered 且会话仍在内存时中止：否则会「删盘不摘活体」，
 * 活体后续写入失败或在原位重建残骸，只能重启。
 * @param {object} ctx - 宿主插件上下文。
 * @param {{unsupported: string[]}} detached - detachAll 结果。
 * @param {string[]} ids - 本次会话 ID。
 * @returns {void}
 */
function abortIfUnsupportedLive(ctx, detached, ids) {
  const unsupportedLive = detached.unsupported.filter(id => ids.includes(id) && ctx.get('sessions')?.get?.(id) !== undefined)
  if (unsupportedLive.length === 0) return
  throw new DeleteError(ERROR_CODES.detachFailed, `当前宿主缺少 liveEntryFor/detachEntered，无法安全摘除活体会话：${unsupportedLive.join('、')}；请升级宿主或重启后重试`, { status: 409 })
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


/**
 * 用索引里的 header 统计一棵会话树的规模（不读盘）。
 * @param {Map<string, object>} headers - 按 id 索引的 header。
 * @param {string} rootId - 根会话 ID。
 * @returns {number} 根 + 子代理数量。
 */
function countSessionTree(headers, rootId) {
  const childrenOf = new Map()
  for (const [id, header] of headers) {
    if (header?.origin !== 'subagent' || typeof header.parentSession !== 'string') continue
    const siblings = childrenOf.get(header.parentSession) ?? []
    siblings.push(id)
    childrenOf.set(header.parentSession, siblings)
  }
  let count = 0
  const stack = [rootId]
  const seen = new Set()
  while (stack.length > 0) {
    const id = stack.pop()
    if (seen.has(id)) continue
    seen.add(id)
    count += 1
    for (const child of childrenOf.get(id) ?? []) stack.push(child)
  }
  return count
}

/**
 * flush 之后重新解析会话目录：空白/未落盤会话会在 flush 时被 materialize，
 * 若沿用 flush 之前的 `members`，删除会误走 already-gone 并把日志留在盘上。
 * @param {object} ctx - 宿主插件上下文。
 * @param {string} sessionId - 会话 ID。
 * @param {string|undefined} title - 标题提示。
 * @param {object} meta - flush 之前的元数据。
 * @returns {Promise<object>} 尽力刷新后的元数据。
 */
async function refreshMetaAfterFlush(ctx, sessionId, title, meta) {
  if (meta.members.length > 0 && !meta.live) return meta
  let latest = meta
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (attempt > 0) await sleep(80)
    const index = await readSnapshotIndex(ctx)
    const refreshed = await collectSessionMeta(ctx, sessionId, { title, index })
    latest = refreshed
    if (refreshed.members.length > 0) return refreshed
  }
  return latest
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
  // 保留 alreadyRemoved 参数以兼容旧调用点；事件幂等，总是补发。
  let sent = 0
  for (const id of ids) {
    // 官方事件是幂等的，重复广播无副作用；总是补发，覆盖「已 enter 但尚未 announce」导致 disposed 没发广播的窗口。
    try {
      ctx.emit('api-session/removed', id)
      sent += 1
    } catch (error) {
      steps.push({ step: `broadcast:${id}`, ok: false, detail: error instanceof Error ? error.message : String(error) })
    }
  }
  step(steps, 'broadcast', true, `已广播 ${sent} 条会话移除事件`)
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
    // 上一次删除可能在「搬完目录、清记账/投影前」中断；重试时把幂等收尾补跑一遍。
    const entryMembers = Array.isArray(existingTrash.members) ? existingTrash.members : []
    const entryIds = entryMembers.length > 0 ? [...new Set(entryMembers.map(member => member.sessionId))] : [sessionId]
    let validIds
    let listError = ''
    try {
      const persistence = ctx.get('sessionPersistence')
      if (persistence === undefined || typeof persistence.list !== 'function') listError = '会话持久化服务不可用'
      else validIds = new Set((await persistence.list()).map(snapshot => snapshot?.header?.id))
    } catch (error) {
      listError = error instanceof Error ? error.message : String(error)
      validIds = undefined
    }
    if (validIds === undefined) {
      // fail-closed：无法判断哪些 id 是合法会话时，只做不依赖列表的安全动作（不动 store、不删缓存）。
      warnings.push(`无法读取会话列表（${listError || '未知错误'}），本次只做幂等返回，未补跑收尾清理`)
      step(steps, 'idempotent-cleanup', false, '会话列表不可用，跳过收尾清理')
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
    // 只对「当前不是合法会话」的 id 补清理，避免误伤同 id 重建的新会话。
    const staleIds = entryIds.filter(id => !validIds.has(id))
    if (staleIds.length > 0) {
      const detached = await detachAll(ctx, staleIds, steps)
      await settleAfterDetach(detached.detachedIds)
      await cleanAll(ctx, staleIds, steps, warnings, leftovers)
    }
    const originalPaths = entryMembers
      .filter(member => typeof member.originalPath === 'string')
      .map(member => ({ sessionId: member.sessionId, dirPath: member.originalPath }))
      .filter(member => !validIds.has(member.sessionId))
    await cleanResurrectedResidue(ctx, originalPaths, steps, warnings, leftovers, { watch: false })
    step(steps, 'idempotent-cleanup', true, staleIds.length > 0 ? `已补跑 ${staleIds.length} 个会话的收尾清理` : '没有需要补跑的收尾清理')
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
  // 先用索引里的 header 做 O(n) 数量上限检查，避免对超大子树做完整采集（每个子孙都会 sizeOf/活动探测）。
  const knownHeaders = new Map()
  for (const [id, snapshot] of index.snapshots) knownHeaders.set(id, snapshot.header)
  for (const [id, session] of index.live) knownHeaders.set(id, session.header)
  const treeSize = countSessionTree(knownHeaders, sessionId)
  if (treeSize > MAX_TREE) {
    throw new DeleteError(ERROR_CODES.tooManySubagents, `会话树共 ${treeSize} 个会话，超过上限 ${MAX_TREE}；为免留下半棵树，本次没有删除`, { status: 409 })
  }
  let meta = await collectSessionMeta(ctx, sessionId, { title: input?.title, index })
  // 破坏性路径必须精确：索引里的 header id 与请求 id 不一致时拒绝，不能拿别名目录动手。
  if (meta.header !== undefined && typeof meta.header.id === 'string' && meta.header.id !== sessionId) {
    throw new DeleteError(ERROR_CODES.badSessionId, `会话 ID 不匹配：请求 ${sessionId}，磁盘 header 为 ${meta.header.id}；为免误删已拒绝`, { status: 409 })
  }
  if (!meta.exists) {
    // 持久化列表降级/不可读时不能断言「会话不存在」：目录可能还在，只是 header 读不到。
    if (index.degraded.length > 0) {
      throw new DeleteError(ERROR_CODES.internal, `读取会话列表失败：${index.degraded.join('；')}；无法确认会话是否存在，请稍后重试`, { status: 503 })
    }
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

  let ids = [sessionId, ...meta.descendants.map(item => item.sessionId)]
  if (ids.length > MAX_TREE) {
    throw new DeleteError(ERROR_CODES.tooManySubagents, `会话树共 ${ids.length} 个会话，超过上限 ${MAX_TREE}；为免留下半棵树，本次没有删除`, { status: 409 })
  }
  await admit(ctx, meta, stopIfRunning, steps)

  for (const id of ids) {
    const flushed = await flushLiveSession(ctx, id)
    if (!flushed.ok) warnings.push(`${id}：刷盘失败（${flushed.detail}）`)
  }
  step(steps, 'flush', true, '已尝试刷盘')

  // flush 可能把未落盘的空白会话/子代理写到磁盘：必须重新解析，否则会误判 already-gone。
  meta = await refreshMetaAfterFlush(ctx, sessionId, input?.title, meta)
  ids = [sessionId, ...meta.descendants.map(item => item.sessionId)]
  if (ids.length > MAX_TREE) {
    throw new DeleteError(ERROR_CODES.tooManySubagents, `flush 后会话树共 ${ids.length} 个会话，超过上限 ${MAX_TREE}；为免留下半棵树，本次没有删除`, { status: 409 })
  }
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
    abortIfUnsupportedLive(ctx, detached, ids)
    await settleAfterDetach(detached.detachedIds)
    await cleanAll(ctx, ids, steps, warnings, leftovers)
    broadcastRemoved(ctx, ids, steps)
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
  abortIfUnsupportedLive(ctx, detached, ids)
  await settleAfterDetach(detached.detachedIds)

  if (mode === 'trash') {
    try {
      trashEntry = await moveIntoTrash({ members, meta: trashMeta })
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      step(steps, 'trash', false, detail)
      throw new DeleteError(ERROR_CODES.trashFailed, `${detail}（目录未移动；会话已从内存摘除，刷新页面即可恢复显示）`, { status: 500 })
    }
    step(steps, 'trash', true, `已移入回收站：${trashEntry.trashId}`)
    for (const warning of Array.isArray(trashEntry.warnings) ? trashEntry.warnings : []) warnings.push(warning)
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
  await cleanResurrectedResidue(ctx, members, steps, warnings, leftovers, { watch: false })
  if (detached.detachedIds.length > 0) scheduleResidueSweep(ctx, members)
  broadcastRemoved(ctx, ids, steps)

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
  let restoreDetail
  try {
    restoreDetail = await restoreEntry(ctx, entry)
    cleanupWarning = restoreDetail.cleanupWarning ?? ''
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    // 原路径被合法会话占用属于冲突，不应该报成「已回滚」。
    const code = /原路径已存在且无法确认|缺少数据文件/.test(message) ? ERROR_CODES.restoreConflict : ERROR_CODES.restoreFailed
    throw new DeleteError(code, message, { status: code === ERROR_CODES.restoreConflict ? 409 : 500 })
  }
  if (cleanupWarning !== '') warnings.push(cleanupWarning)
  cancelResidueSweeps(entry.members.map(member => member.originalPath))
  step(steps, 'restore', true, restoreDetail.alreadyRestored?.length > 0
    ? `已把 ${entry.members.length} 个目录还原到位（其中 ${restoreDetail.alreadyRestored.length} 个上次已还原）`
    : `已把 ${entry.members.length} 个目录搬回原位`)
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
    alreadyRestored: restoreDetail.alreadyRestored ?? [],
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
  const after = await listEntries()
  const remainingIds = new Set(after.map(entry => entry.trashId))
  const successWarnings = await cleanPurgedProjections(ctx, before.filter(entry => !remainingIds.has(entry.trashId)))
  if (result.failures.length > 0) {
    throw new DeleteError(ERROR_CODES.emptyFailed, result.failures.map(item => `${item.trashId}: ${item.reason}`).join('；'), {
      status: 500,
      extra: { removed: result.removed, freedBytes: result.freedBytes, warnings: successWarnings },
    })
  }
  const warnings = successWarnings
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
  const after = await listEntries()
  const remainingIds = new Set(after.map(entry => entry.trashId))
  const successWarnings = await cleanPurgedProjections(ctx, before.filter(entry => !remainingIds.has(entry.trashId)))
  if (result.failures.length > 0) {
    throw new DeleteError(ERROR_CODES.emptyFailed, result.failures.map(item => `${item.trashId}: ${item.reason}`).join('；'), {
      status: 500,
      extra: { removed: result.removed, freedBytes: result.freedBytes, warnings: successWarnings },
    })
  }
  const warnings = successWarnings
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
