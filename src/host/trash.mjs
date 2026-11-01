/**
 * 会话回收站存储：策略文件、条目元数据、移入/还原/彻底删除/清空/过期清理、用量统计。
 *
 * 目录布局（每条一个目录，原子写元数据）：
 *   $DSH_HOME/session-delete/
 *     settings.json
 *     trash/<trashId>/metadata.json
 *     trash/<trashId>/payload/0, payload/1, ...   ← 每个被删会话的原始目录
 */
import { mkdir, readdir, rm } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { realpath } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { atomicWriteJson, exists, moveTree, readJsonSafe, removeTree, sizeOf, statSafe } from './fs-util.mjs'
import { assertSessionId, sessionsRoot, settingsPath, trashRoot } from './paths.mjs'

/** 回收站元数据版本。 */
const METADATA_VERSION = 1

/** 策略默认值。保留天数 0 表示永久保留。 */
export const SETTINGS_DEFAULTS = Object.freeze({
  version: 1,
  retentionDays: 30,
  sweepOnStartup: true,
})

/** 取相对路径的分隔符风格（win32 下 rel 用 `\\`）。 */
const sepOf = rel => (rel.includes('\\') ? '\\' : '/')

/**
 * 判断 `target` 是否在 `root` 目录内（含根目录本身）。
 * 用 `path.relative` 而不是字符串前缀：Windows 盘符大小写、`..`、混合分隔符都能正确处理。
 * @param {string} root - 根目录绝对路径。
 * @param {string} target - 待判断绝对路径。
 * @returns {boolean} 是否在根目录内。
 */
export function isInside(root, target) {
  const rel = relative(resolve(root), resolve(target))
  if (rel === '') return true
  if (isAbsolute(rel)) return false
  return rel !== '..' && !rel.startsWith(`..${sepOf(rel)}`)
}

/**
 * 把输入收敛成「整数天数」或 NaN。
 * 只接受数字与非空整数字符串；`null`/`[]`/`''`/`false` 等一律 NaN，
 * 交给上层回落到默认值——`Number()` 会把它们变成 0（合法档位「永久保留」），不能直接用。
 * @param {unknown} value - 原始值。
 * @returns {number} 整数天数或 NaN。
 */
function coerceRetentionDays(value) {
  if (typeof value === 'number') return Number.isInteger(value) ? value : Number.NaN
  if (typeof value === 'string') {
    const text = value.trim()
    if (/^-?\d+$/.test(text)) return Number(text)
  }
  return Number.NaN
}

/** 允许的保留天数档位（0 = 永久）。 */
export const RETENTION_CHOICES = Object.freeze([7, 15, 30, 90, 0])

/** 单批处理的条目数；清空/清理会分批循环，避免一次请求把事件循环占死。 */
const MAX_BATCH = 200

/** 单次清空/清理最多循环的批次数，防御性上限。 */
const MAX_ROUNDS = 100

/**
 * 归一化策略对象：非法值回落到默认值，绝不把畸形配置写回磁盘。
 * @param {unknown} raw - 磁盘或请求里的原始值。
 * @returns {{version: number, retentionDays: number, sweepOnStartup: boolean}} 归一化结果。
 */
export function normalizeSettings(raw) {
  const source = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  const days = coerceRetentionDays(source.retentionDays)
  const retentionDays = RETENTION_CHOICES.includes(days) ? days : SETTINGS_DEFAULTS.retentionDays
  return {
    version: 1,
    retentionDays,
    sweepOnStartup: source.sweepOnStartup === undefined ? SETTINGS_DEFAULTS.sweepOnStartup : source.sweepOnStartup === true,
  }
}

/**
 * 读取策略文件；缺失或畸形时返回默认值。
 * @returns {Promise<{version: number, retentionDays: number, sweepOnStartup: boolean}>} 当前策略。
 */
export async function readSettings() {
  return normalizeSettings(await readJsonSafe(settingsPath()))
}

/**
 * 合并写入策略文件（原子写）。
 * @param {unknown} patch - 只包含要改的字段。
 * @returns {Promise<{version: number, retentionDays: number, sweepOnStartup: boolean}>} 写入后的策略。
 */
export async function writeSettings(patch) {
  const current = await readSettings()
  const source = patch !== null && typeof patch === 'object' && !Array.isArray(patch) ? patch : {}
  const next = normalizeSettings({ ...current, ...source })
  await atomicWriteJson(settingsPath(), next)
  return next
}

/**
 * 归一化一条回收站元数据：缺字段补空、类型不对丢掉，保证 UI 永远拿到稳定形状。
 * @param {unknown} raw - metadata.json 的内容。
 * @param {string} trashId - 目录名。
 * @returns {object|undefined} 归一化后的条目。
 */
export function normalizeMetadata(raw, trashId) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const members = Array.isArray(raw.members)
    ? raw.members.filter(item => item !== null && typeof item === 'object'
      && typeof item.sessionId === 'string' && item.sessionId !== ''
      && typeof item.originalPath === 'string' && isAbsolute(item.originalPath))
      .map((item, index) => ({
        sessionId: item.sessionId,
        title: typeof item.title === 'string' ? item.title : '',
        originalPath: item.originalPath,
        // payload 必须是纯数字序号；篡改/缺失都判整条元数据无效，避免把 payload 挪到错误路径。
        payload: typeof item.payload === 'string' && /^\d+$/.test(item.payload) ? item.payload : '',
        sizeBytes: Number.isFinite(item.sizeBytes) ? item.sizeBytes : 0,
        isRoot: item.isRoot === true,
        archived: item.archived === true,
        pinned: item.pinned === true,
      }))
    : []
  // 成员形状不完整（缺 payload 等）时整条判无效，宁可让人看到坏数据也不做有风险的还原。
  if (members.length === 0 || members.some(item => item.payload === '')) return undefined
  const root = members.find(item => item.isRoot) ?? members[0]
  return {
    version: METADATA_VERSION,
    trashId,
    // 顶层 sessionId 可被篡改，恢复记账必须以成员里的 root 为准。
    sessionId: root.sessionId,
    title: typeof raw.title === 'string' ? raw.title : root.title,
    deletedAt: typeof raw.deletedAt === 'string' ? raw.deletedAt : new Date(0).toISOString(),
    sizeBytes: Number.isFinite(raw.sizeBytes) ? raw.sizeBytes : members.reduce((sum, item) => sum + item.sizeBytes, 0),
    workspaceId: typeof raw.workspaceId === 'string' && raw.workspaceId.length <= 200 ? raw.workspaceId : '',
    workspacePath: typeof raw.workspacePath === 'string' ? raw.workspacePath : '',
    workspaceTitle: typeof raw.workspaceTitle === 'string' ? raw.workspaceTitle : '',
    archived: raw.archived === true,
    pinned: raw.pinned === true,
    workspaceSessionIndex: Number.isInteger(raw.workspaceSessionIndex) ? raw.workspaceSessionIndex : -1,
    beforeSessionId: typeof raw.beforeSessionId === 'string' ? raw.beforeSessionId : '',
    hostVersion: typeof raw.hostVersion === 'string' ? raw.hostVersion : '',
    partial: raw.partial === true,
    restoredInPlace: Array.isArray(raw.restoredInPlace) ? raw.restoredInPlace.filter(item => typeof item === 'string') : [],
    rollbackFailures: Array.isArray(raw.rollbackFailures) ? raw.rollbackFailures.filter(item => typeof item === 'string') : [],
    members,
  }
}

/**
 * 列出回收站里的全部条目（按删除时间倒序）。畸形条目跳过，不让一条坏数据挡住整个列表。
 * @returns {Promise<object[]>} 归一化条目数组，带 `dir` 字段。
 */
export async function listEntries() {
  let names
  try {
    names = await readdir(trashRoot(), { withFileTypes: true })
  } catch {
    return []
  }
  const entries = []
  for (const name of names) {
    if (!name.isDirectory() || name.name.startsWith('.')) continue
    const dir = join(trashRoot(), name.name)
    const meta = normalizeMetadata(await readJsonSafe(join(dir, 'metadata.json')), name.name)
    if (meta === undefined) continue
    entries.push({ ...meta, dir })
  }
  entries.sort((left, right) => String(right.deletedAt).localeCompare(String(left.deletedAt)))
  return entries
}

/**
 * 按会话 ID 找回收站条目（也接受 `session-` 前缀/裸 UUID 的另一种写法）。
 * @param {string} sessionId - 会话 ID。
 * @returns {Promise<object|undefined>} 命中的条目。
 */
export async function findEntryBySession(sessionId) {
  const target = assertSessionId(sessionId)
  // 破坏性路径只认精确 ID：`abc` 与 `session-abc` 是两个不同会话，不能互相命中。
  const entries = await listEntries()
  return entries.find(entry => entry.members.some(member => member.sessionId === target))
}

/**
 * 把一组会话目录移入回收站。全部成功才写元数据；任一步失败都把已移动的成员搬回原位并删除条目目录。
 * @param {{members: {sessionId: string, dirPath: string, title?: string, isRoot?: boolean, archived?: boolean, pinned?: boolean, sizeBytes?: number}[], meta: object}} input - 成员与公共元数据。
 * @returns {Promise<object>} 写入后的条目（带 `dir`）。
 */
export async function moveIntoTrash(input, deps = {}) {
  const move = deps.moveTree ?? moveTree
  const members = Array.isArray(input?.members) ? input.members : []
  if (members.length === 0) throw new Error('没有可移入回收站的会话目录')
  const trashId = `${Date.now()}-${randomUUID().slice(0, 8)}`
  const dir = join(trashRoot(), trashId)
  const payloadRoot = join(dir, 'payload')
  await mkdir(payloadRoot, { recursive: true })
  const moved = []
  const moveWarnings = []
  try {
    for (const [index, member] of members.entries()) {
      const payload = String(index)
      const target = join(payloadRoot, payload)
      const movedResult = await move(member.dirPath, target)
      if (typeof movedResult?.sourceCleanupWarning === 'string' && movedResult.sourceCleanupWarning !== '') moveWarnings.push(`${member.sessionId}：${movedResult.sourceCleanupWarning}`)
      // 锁文件不进回收站：官方 POSIX 锁是 flock 绑定 inode、Windows 是同名内核信号量，
      // 把 session.lock 一起搬走/还原等于把旧锁带回原位，重开会话时可能撞上它。
      // 官方明确「删除活会话的锁文件是安全的」：持有者会校验 inode/路径并重建。
      await rm(join(target, 'session.lock'), { force: true }).catch(() => {})
      moved.push({ ...member, payload })
    }
    const meta = {
      ...input.meta,
      version: METADATA_VERSION,
      deletedAt: input.meta?.deletedAt ?? new Date().toISOString(),
      members: moved.map(member => ({
        sessionId: member.sessionId,
        title: member.title ?? '',
        originalPath: member.dirPath,
        payload: member.payload,
        sizeBytes: member.sizeBytes ?? 0,
        isRoot: member.isRoot === true,
        archived: member.archived === true,
        pinned: member.pinned === true,
      })),
    }
    await atomicWriteJson(join(dir, 'metadata.json'), meta)
    const normalized = normalizeMetadata(meta, trashId)
    return { ...normalized, dir, warnings: moveWarnings }
  } catch (error) {
    const rollbackFailures = []
    for (const member of [...moved].reverse()) {
      try {
        await move(join(payloadRoot, member.payload), member.dirPath)
      } catch (rollbackError) {
        rollbackFailures.push(`${member.sessionId}: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`)
      }
    }
    if (rollbackFailures.length === 0) {
      // 所有成员都已搬回原位，条目里没有数据，可以安全清理。
      await removeTree(dir).catch(() => {})
      throw error
    }
    // 回滚未完成：payload 里是这些成员仅存的副本，绝不能删；保留条目并标记 partial 供 UI/后续重试识别。
    const partialMeta = {
      ...input.meta,
      version: METADATA_VERSION,
      partial: true,
      deletedAt: input.meta?.deletedAt ?? new Date().toISOString(),
      rollbackFailures,
      members: moved.map(member => ({
        sessionId: member.sessionId,
        title: member.title ?? '',
        originalPath: member.dirPath,
        payload: member.payload,
        sizeBytes: member.sizeBytes ?? 0,
        isRoot: member.isRoot === true,
        archived: member.archived === true,
        pinned: member.pinned === true,
      })),
    }
    await atomicWriteJson(join(dir, 'metadata.json'), partialMeta).catch(() => {})
    const detail = error instanceof Error ? error.message : String(error)
    const wrapped = new Error(`${detail}；回滚未完成（${rollbackFailures.join('；')}），数据已保留在回收站临时条目 ${dir}，请先不要手动删除`)
    wrapped.cause = error
    throw wrapped
  }
}

/** 读取当前宿主认可的会话 ID 集合；失败返回 undefined（调用方必须 fail-closed）。 */
async function listValidSessionIds(ctx) {
  if (ctx === undefined || typeof ctx.get !== 'function') return undefined
  try {
    const persistence = ctx.get('sessionPersistence')
    if (persistence === undefined || typeof persistence.list !== 'function') return undefined
    return new Set((await persistence.list()).map(snapshot => snapshot?.header?.id))
  } catch {
    return undefined
  }
}

/**
 * 把一条回收站条目搬回原路径。
 *
 * 支持「上次还原中断」的续做：
 * - payload 还在、原路径不存在 → 正常搬回；
 * - payload 不在、原路径存在且是宿主认可的合法会话 → 视为上次已还原完成，跳过；
 * - 原路径存在但不是合法会话（无头残骸）→ 清掉残骸后继续；列表不可用/无法判断时拒绝（fail-closed）。
 * @param {object} ctxOrEntry - 宿主插件上下文（新签名）或条目（旧签名）。
 * @param {object} [maybeEntry] - 条目（新签名）。
 * @returns {Promise<{restored: string[], skipped: {sessionId: string, reason: string}[], alreadyRestored: string[], cleanupWarning: string}>} 还原结果。
 */
export async function restoreEntry(ctxOrEntry, maybeEntry, deps = {}) {
  const ctx = maybeEntry === undefined ? undefined : ctxOrEntry
  const entry = maybeEntry === undefined ? ctxOrEntry : maybeEntry
  if (entry === undefined || typeof entry.dir !== 'string') throw new Error('回收站条目不存在')
  if (!isInside(resolve(trashRoot()), resolve(entry.dir))) {
    throw new Error(`回收站元数据异常：条目目录越界（${entry.dir}）`)
  }
  const quarantine = resolve(sessionsRoot())
  const canonicalRoot = await realpath(quarantine).catch(() => quarantine)
  const move = deps.moveTree ?? moveTree
  const remove = deps.removeTree ?? removeTree
  const validIds = await listValidSessionIds(ctx)
  const actions = []
  for (const member of entry.members) {
    if (!isInside(quarantine, resolve(member.originalPath))) {
      throw new Error(`回收站元数据异常：原路径不在会话目录下（${member.originalPath}）`)
    }
    const parent = resolve(member.originalPath, '..')
    if (await exists(parent)) {
      // 已存在的父目录必须真实落在会话根内：防止某一级是符号链接被带出根外。
      const canonicalParent = await realpath(parent).catch(() => undefined)
      if (canonicalParent === undefined || !isInside(canonicalRoot, canonicalParent)) {
        throw new Error(`回收站元数据异常：原路径父目录不在会话目录下（${member.originalPath}）`)
      }
    }
    const payloadPath = join(entry.dir, 'payload', member.payload)
    const payloadExists = await exists(payloadPath)
    const originalExists = await exists(member.originalPath)
    const listed = validIds === undefined ? undefined : validIds.has(member.sessionId)
    if (!payloadExists) {
      if (originalExists && listed === true) {
        actions.push({ member, kind: 'already-restored' })
        continue
      }
      if (listed === undefined) {
        throw new Error(`无法读取会话列表，暂时无法判断会话 ${member.sessionId} 的还原状态，请稍后重试`)
      }
      throw new Error(`回收站条目缺少数据文件：${member.sessionId}`)
    }
    if (originalExists) {
      if (listed === true) {
        // 上次还原已把目录搬回、但条目没删干净：不要覆盖用户正在用的会话。
        actions.push({ member, kind: 'already-restored' })
        continue
      }
      if (listed === undefined) {
        throw new Error(`原路径已存在且无法确认是否为合法会话：${member.originalPath}，请稍后重试`)
      }
      // 确认不是合法会话（无头残骸）才清理；清理失败不要继续覆盖。
      await remove(member.originalPath)
    }
    actions.push({ member, kind: 'move', payloadPath })
  }

  const done = []
  const alreadyRestored = []
  try {
    for (const action of actions) {
      if (action.kind === 'already-restored') {
        alreadyRestored.push(action.member)
        continue
      }
      await mkdir(dirname(action.member.originalPath), { recursive: true })
      await move(action.payloadPath, action.member.originalPath)
      // 兼容旧版本回收站条目：它们可能把 session.lock 一起搬走了，还原时不要再带回旧锁。
      await rm(join(action.member.originalPath, 'session.lock'), { force: true }).catch(() => {})
      done.push(action.member)
    }
  } catch (error) {
    const rollbackFailures = []
    for (const member of [...done].reverse()) {
      try {
        await move(member.originalPath, join(entry.dir, 'payload', member.payload))
      } catch (rollbackError) {
        rollbackFailures.push(`${member.sessionId}: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`)
      }
    }
    if (rollbackFailures.length > 0) {
      // 保留条目并记录「已搬回原位」的成员，下一次还原可以跳过它们继续。
      try {
        const raw = await readJsonSafe(join(entry.dir, 'metadata.json'))
        const partialMeta = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
        partialMeta.partial = true
        partialMeta.restoredInPlace = [...new Set([...(Array.isArray(partialMeta.restoredInPlace) ? partialMeta.restoredInPlace : []), ...done.map(member => member.sessionId)])]
        await atomicWriteJson(join(entry.dir, 'metadata.json'), partialMeta)
      } catch {
        /* 元数据写不进去也不要删条目 */
      }
      const detail = error instanceof Error ? error.message : String(error)
      const wrapped = new Error(`${detail}；还原回滚未完成（${rollbackFailures.join('；')}），已还原的会话留在原位，条目保留，可再次点还原继续`)
      wrapped.cause = error
      throw wrapped
    }
    throw error
  }
  // 数据已经搬回原位，清理回收站目录失败只作为警告，不能把「已还原」说成「还原失败」。
  let cleanupWarning = ''
  try {
    await removeTree(entry.dir)
  } catch (error) {
    cleanupWarning = `回收站临时目录清理失败：${error instanceof Error ? error.message : String(error)}`
  }
  return { restored: entry.members.map(member => member.sessionId), skipped: [], alreadyRestored: alreadyRestored.map(member => member.sessionId), cleanupWarning }
}

/**
 * 彻底删除一条回收站条目。
 * @param {object} entry - `listEntries()` 返回的条目。
 * @returns {Promise<number>} 释放的字节数。
 */
export async function purgeEntry(entry, deps = {}) {
  const remove = deps.removeTree ?? removeTree
  if (entry === undefined || typeof entry.dir !== 'string') throw new Error('回收站条目不存在')
  const root = resolve(trashRoot())
  if (!isInside(root, resolve(entry.dir))) throw new Error(`回收站元数据异常：条目目录越界（${entry.dir}）`)
  const freed = Number.isFinite(entry.sizeBytes) && entry.sizeBytes > 0 ? entry.sizeBytes : await sizeOf(entry.dir)
  // 先删 payload、最后删 metadata：中途失败时条目仍在列表里（可见、可重试），不会变成不可见的磁盘孤儿。
  const payloadDir = join(entry.dir, 'payload')
  if (await exists(payloadDir)) await remove(payloadDir)
  await remove(entry.dir)
  return freed
}

/**
 * 清空回收站（最多 `MAX_BATCH` 条），逐条记录失败原因。
 * @returns {Promise<{removed: number, freedBytes: number, failures: {trashId: string, reason: string}[]}>} 清空结果。
 */
export async function emptyTrash() {
  let removed = 0
  let freedBytes = 0
  const failures = []
  let remaining = 0
  // 分批清空，直到没有进展或清完；失败条目会留在列表里，本轮不再重试以免死循环。
  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    const entries = await listEntries()
    if (entries.length === 0) return { removed, freedBytes, failures, remaining: 0 }
    const batch = entries.slice(0, MAX_BATCH)
    let progress = 0
    for (const entry of batch) {
      try {
        freedBytes += await purgeEntry(entry)
        removed += 1
        progress += 1
      } catch (error) {
        failures.push({ trashId: entry.trashId, reason: error instanceof Error ? error.message : String(error) })
      }
    }
    if (progress === 0) {
      remaining = entries.length
      break
    }
  }
  if (remaining === 0) remaining = (await listEntries()).length
  return { removed, freedBytes, failures, remaining }
}

/**
 * 按保留天数清理过期条目。`retentionDays === 0` 表示永久保留，直接跳过。
 * @param {{retentionDays: number}} settings - 当前策略。
 * @param {number} [now] - 注入当前时间，便于测试。
 * @returns {Promise<{removed: number, freedBytes: number, failures: {trashId: string, reason: string}[]}>} 清理结果。
 */
export async function sweepExpired(settings, now = Date.now()) {
  const days = Number(settings?.retentionDays)
  if (!Number.isFinite(days) || days <= 0) return { removed: 0, freedBytes: 0, failures: [] }
  const cutoff = now - days * 24 * 60 * 60 * 1000
  let removed = 0
  let freedBytes = 0
  const failures = []
  let remaining = 0
  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    const entries = await listEntries()
    const expired = entries.filter(entry => {
      const deletedAt = Date.parse(entry.deletedAt)
      return Number.isFinite(deletedAt) && deletedAt <= cutoff
    })
    if (expired.length === 0) return { removed, freedBytes, failures, remaining: 0 }
    const batch = expired.slice(0, MAX_BATCH)
    let progress = 0
    for (const entry of batch) {
      try {
        freedBytes += await purgeEntry(entry)
        removed += 1
        progress += 1
      } catch (error) {
        failures.push({ trashId: entry.trashId, reason: error instanceof Error ? error.message : String(error) })
      }
    }
    if (progress === 0) {
      remaining = expired.length
      break
    }
  }
  return { removed, freedBytes, failures, remaining }
}

/**
 * 回收站用量：条目数、总占用、最早/最晚删除时间。
 * @param {object[]} entries - `listEntries()` 的结果。
 * @returns {{count: number, bytes: number, oldest: string|null, newest: string|null}} 统计。
 */
export function usageOf(entries) {
  const list = Array.isArray(entries) ? entries : []
  const bytes = list.reduce((sum, entry) => sum + (Number.isFinite(entry.sizeBytes) ? entry.sizeBytes : 0), 0)
  const times = list.map(entry => entry.deletedAt).filter(value => typeof value === 'string').sort()
  return {
    count: list.length,
    bytes,
    oldest: times[0] ?? null,
    newest: times[times.length - 1] ?? null,
  }
}

/**
 * 删除一个空目录（不存在忽略）。回收站根在首次使用时才创建。
 * @returns {Promise<void>} 完成。
 */
export async function ensureTrashRoot() {
  await mkdir(trashRoot(), { recursive: true })
}

/**
 * 判断一个目录是否为空（用于删除后残留检查）。
 * @param {string} dir - 绝对路径。
 * @returns {Promise<boolean>} 是否为空或不存在。
 */
export async function isEmptyDir(dir) {
  const info = await statSafe(dir)
  if (info === undefined) return true
  if (!info.isDirectory()) return false
  try {
    return (await readdir(dir)).length === 0
  } catch {
    return false
  }
}

/**
 * 尽力删除一个路径，返回是否真的删掉了（用于清理「删除后又复活」的空目录）。
 * @param {string} path - 绝对路径。
 * @returns {Promise<boolean>} 是否已不存在。
 */
export async function forceRemove(path) {
  try {
    await rm(path, { recursive: true, force: true, maxRetries: 2 })
    return true
  } catch {
    return false
  }
}

/** 供测试直接引用：元数据版本与批量上限。 */
export const internals = { METADATA_VERSION, MAX_BATCH }
