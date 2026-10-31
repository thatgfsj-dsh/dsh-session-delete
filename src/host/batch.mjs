/**
 * 批量删除：参数校验 + 逐条复用单条删除事务。
 *
 * 设计：整批占用一个串行写队列（由路由层保证），单条失败只记录该条结果，
 * 不中断其它条目；每条都走 v0.1 的完整事务（准入/回收站/摘活体/清理/广播）。
 */
import { asDeleteError, DeleteError, ERROR_CODES } from './errors.mjs'
import { assertSessionId } from './paths.mjs'
import { executeDelete } from './execute.mjs'

/** 一次批量请求最多处理的会话数。 */
export const MAX_BATCH = 200

/**
 * 校验并归一化批量删除请求体。
 * @param {unknown} body - 请求体。
 * @returns {{sessionIds: string[], mode: 'trash'|'purge', stopIfRunning: boolean}} 归一化参数。
 */
export function normalizeBatchInput(body) {
  const source = body !== null && typeof body === 'object' && !Array.isArray(body) ? body : {}
  if (!Array.isArray(source.sessionIds)) throw new DeleteError(ERROR_CODES.badRequest, 'sessionIds 必须是数组', { status: 400 })
  const seen = new Set()
  const sessionIds = []
  for (const raw of source.sessionIds) {
    const id = assertSessionId(raw)
    if (seen.has(id)) continue
    seen.add(id)
    sessionIds.push(id)
  }
  if (sessionIds.length === 0) throw new DeleteError(ERROR_CODES.badRequest, '没有选择任何会话', { status: 400 })
  if (sessionIds.length > MAX_BATCH) {
    throw new DeleteError(ERROR_CODES.tooManySessions, `一次最多处理 ${MAX_BATCH} 个会话（当前 ${sessionIds.length} 个）`, { status: 400 })
  }
  return {
    sessionIds,
    mode: source.mode === 'purge' ? 'purge' : 'trash',
    stopIfRunning: source.stopIfRunning === true,
  }
}

/**
 * 逐条执行批量删除。
 * @param {object} ctx - 宿主插件上下文。
 * @param {{sessionIds: string[], mode: 'trash'|'purge', stopIfRunning: boolean}} input - 归一化参数。
 * @returns {Promise<object>} 汇总结果。
 */
export async function runBatchDelete(ctx, input) {
  const startedAt = Date.now()
  const results = []
  for (const sessionId of input.sessionIds) {
    try {
      const outcome = await executeDelete(ctx, { sessionId, mode: input.mode, stopIfRunning: input.stopIfRunning })
      results.push({
        sessionId,
        ok: true,
        code: outcome.code ?? 'ok',
        message: outcome.message ?? '',
        trashId: outcome.trashId,
      })
    } catch (error) {
      const failure = asDeleteError(error)
      results.push({ sessionId, ok: false, code: failure.code, message: failure.code, detail: failure.detail })
    }
  }
  const succeeded = results.filter(item => item.ok).length
  const failed = results.length - succeeded
  return {
    ok: true,
    code: 'ok',
    message: failed === 0
      ? `已处理 ${succeeded} 个会话`
      : `成功 ${succeeded} 个，失败 ${failed} 个`,
    mode: input.mode,
    results,
    summary: { total: results.length, succeeded, failed },
    durationMs: Date.now() - startedAt,
  }
}
