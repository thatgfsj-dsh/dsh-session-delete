/**
 * 审计日志：每次删除/还原/彻底删除/清空/策略变更写一行 JSON。
 * 写日志永远不抛错，日志故障不能反过来弄坏用户的数据操作。
 */
import { appendFile, mkdir, rename, stat } from 'node:fs/promises'
import { dirname } from 'node:path'
import { auditLogPath } from './paths.mjs'

/** 超过这个大小就滚动成 `.1`，避免日志无限长。 */
const MAX_LOG_BYTES = 2 * 1024 * 1024

/**
 * 追加一条审计记录。
 * @param {object} record - 记录内容（时间由本函数补）。
 * @returns {Promise<void>} 完成（失败也 resolve）。
 */
export async function appendAudit(record) {
  try {
    const path = auditLogPath()
    await mkdir(dirname(path), { recursive: true })
    const info = await stat(path).catch(() => undefined)
    if (info !== undefined && info.size > MAX_LOG_BYTES) await rename(path, `${path}.1`).catch(() => {})
    const line = JSON.stringify({ time: new Date().toISOString(), ...record })
    await appendFile(path, `${line}\n`, 'utf8')
  } catch {
    /* 审计日志是旁路，失败不影响主流程 */
  }
}
