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
import { isAbsolute, join, relative, resolve } from 'node:path'
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
  const bare = target.startsWith('session-') ? target.slice('session-'.length) : target
  const entries = await listEntries()
  return entries.find(entry => entry.members.some(member => {
    const memberBare = member.sessionId.startsWith('session-') ? member.sessionId.slice('session-'.length) : member.sessionId
    return member.sessionId === target || memberBare === bare
  }))
}

/**
 * 把一组会话目录移入回收站。全部成功才写元数据；任一步失败都把已移动的成员搬回原位并删除条目目录。
 * @param {{members: {sessionId: string, dirPath: string, title?: string, isRoot?: boolean, archived?: boolean, pinned?: boolean, sizeBytes?: number}[], meta: object}} input - 成员与公共元数据。
 * @returns {Promise<object>} 写入后的条目（带 `dir`）。
 */
export async function moveIntoTrash(input) {
  const members = Array.isArray(input?.members) ? input.members : []
  if (members.length === 0) throw new Error('没有可移入回收站的会话目录')
  const trashId = `${Date.now()}-${randomUUID().slice(0, 8)}`
  const dir = join(trashRoot(), trashId)
  const payloadRoot = join(dir, 'payload')
  await mkdir(payloadRoot, { recursive: true })
  const moved = []
  try {
    for (const [index, member] of members.entries()) {
      const payload = String(index)
      await moveTree(member.dirPath, join(payloadRoot, payload))
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
    return { ...normalized, dir }
  } catch (error) {
    for (const member of [...moved].reverse()) {
      await moveTree(join(payloadRoot, member.payload), member.dirPath).catch(() => {})
    }
    await removeTree(dir).catch(() => {})
    throw error
  }
}

/**
 * 把一条回收站条目搬回原路径。目标已存在则拒绝，避免覆盖一个同名新会话。
 * @param {object} entry - `listEntries()` 返回的条目。
 * @returns {Promise<{restored: string[], skipped: {sessionId: string, reason: string}[]}>} 还原结果。
 */
export async function restoreEntry(entry) {
  if (entry === undefined || typeof entry.dir !== 'string') throw new Error('回收站条目不存在')
  if (!isInside(resolve(trashRoot()), resolve(entry.dir))) {
    throw new Error(`回收站元数据异常：条目目录越界（${entry.dir}）`)
  }
  const quarantine = resolve(sessionsRoot())
  const canonicalRoot = await realpath(quarantine).catch(() => quarantine)
  for (const member of entry.members) {
    if (!isInside(quarantine, resolve(member.originalPath))) {
      throw new Error(`回收站元数据异常：原路径不在会话目录下（${member.originalPath}）`)
    }
    // 原路径的父目录必须真实落在会话根内：防止 sessions 根下某一级父目录是符号链接时被带出根外。
    const parent = resolve(member.originalPath, '..')
    const canonicalParent = await realpath(parent).catch(() => undefined)
    if (canonicalParent === undefined || !isInside(canonicalRoot, canonicalParent)) {
      throw new Error(`回收站元数据异常：原路径父目录不在会话目录下（${member.originalPath}）`)
    }
    if (!await exists(join(entry.dir, 'payload', member.payload))) {
      throw new Error(`回收站条目缺少数据文件：${member.sessionId}`)
    }
    if (await exists(member.originalPath)) {
      throw new Error(`原路径已存在，无法还原：${member.originalPath}`)
    }
  }
  const done = []
  try {
    for (const member of entry.members) {
      await moveTree(join(entry.dir, 'payload', member.payload), member.originalPath)
      done.push(member)
    }
  } catch (error) {
    for (const member of [...done].reverse()) {
      await moveTree(member.originalPath, join(entry.dir, 'payload', member.payload)).catch(() => {})
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
  return { restored: entry.members.map(member => member.sessionId), skipped: [], cleanupWarning }
}

/**
 * 彻底删除一条回收站条目。
 * @param {object} entry - `listEntries()` 返回的条目。
 * @returns {Promise<number>} 释放的字节数。
 */
export async function purgeEntry(entry) {
  if (entry === undefined || typeof entry.dir !== 'string') throw new Error('回收站条目不存在')
  const root = resolve(trashRoot())
  if (!isInside(root, resolve(entry.dir))) throw new Error(`回收站元数据异常：条目目录越界（${entry.dir}）`)
  const freed = Number.isFinite(entry.sizeBytes) && entry.sizeBytes > 0 ? entry.sizeBytes : await sizeOf(entry.dir)
  await removeTree(entry.dir)
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
