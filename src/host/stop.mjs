/**
 * 停止运行中的会话并等待静默。
 *
 * 优先走官方 `workspaceRegistry.stopSessionActivity()`（它会触发 `workspace/session-stop`
 * 瀑布，由官方 provider 取消 turn、杀掉后台任务、取消子代理、取消定时提醒），
 * 服务不可用时退回 `agents.get(id).cancel()`。
 */
import { collectActivity } from './session-meta.mjs'

/** 等待静默的默认上限：超过就拒绝删除，而不是硬删一个还在跑的会话。 */
export const QUIESCE_TIMEOUT_MS = 10000

/** 轮询间隔。 */
const POLL_INTERVAL_MS = 250

/**
 * 请求停止一个会话当前的活动。
 * @param {object} ctx - 宿主插件上下文。
 * @param {string} sessionId - 会话 ID。
 * @returns {Promise<{via: string, error: string}>} 走的通道与失败原因。
 */
export async function stopSessionActivity(ctx, sessionId) {
  const registry = ctx.get('workspaceRegistry')
  if (registry !== undefined && typeof registry.stopSessionActivity === 'function') {
    try {
      await registry.stopSessionActivity(sessionId)
      return { via: 'workspaceRegistry', error: '' }
    } catch (error) {
      return { via: 'workspaceRegistry', error: error instanceof Error ? error.message : String(error) }
    }
  }
  const agent = ctx.get('agents')?.get?.(sessionId)
  if (agent !== undefined && agent?.status === 'running' && typeof agent.cancel === 'function') {
    try {
      agent.cancel({ kind: 'user' })
      return { via: 'agents.cancel', error: '' }
    } catch (error) {
      return { via: 'agents.cancel', error: error instanceof Error ? error.message : String(error) }
    }
  }
  return { via: 'none', error: '未找到可用的停止通道' }
}

/** 短暂等待。 */
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))

/**
 * 等待一组会话静默（活动族为空）。
 * @param {object} ctx - 宿主插件上下文。
 * @param {string[]} sessionIds - 需要静默的会话（含子代理）。
 * @param {number} [timeoutMs] - 上限。
 * @returns {Promise<{quiescent: boolean, remaining: {sessionId: string, kinds: string[]}[]}>} 结果。
 */
export async function waitQuiescent(ctx, sessionIds, timeoutMs = QUIESCE_TIMEOUT_MS) {
  const ids = Array.isArray(sessionIds) ? sessionIds.filter(id => typeof id === 'string') : []
  if (ids.length === 0) return { quiescent: true, remaining: [] }
  const deadline = Date.now() + Math.max(0, timeoutMs)
  for (;;) {
    const remaining = []
    for (const sessionId of ids) {
      const activity = await collectActivity(ctx, sessionId)
      if (!activity.known) {
        remaining.push({ sessionId, kinds: ['unknown'] })
        continue
      }
      if (activity.activity.length > 0) {
        remaining.push({ sessionId, kinds: activity.activity.map(entry => String(entry?.kind ?? 'unknown')) })
      }
    }
    if (remaining.length === 0) return { quiescent: true, remaining: [] }
    if (Date.now() >= deadline) return { quiescent: false, remaining }
    await sleep(POLL_INTERVAL_MS)
  }
}
