/**
 * 中文错误码与统一错误类型。
 *
 * 约定：`code` 是稳定的机器可读短语（中文），`message` 是给用户看的一句话，
 * `detail` 放技术细节（不翻译，便于排障）。HTTP 状态码只在路由层使用。
 */

/** 会话删除相关的错误码。 */
export const ERROR_CODES = Object.freeze({
  badRequest: '请求格式不正确',
  badSessionId: '会话 ID 非法',
  notFound: '会话不存在',
  running: '会话正在运行，已取消删除',
  subagentRunning: '有子代理会话正在运行，已取消删除',
  tooManySubagents: '子代理会话过多，已取消删除',
  tooManySessions: '一次选择的会话过多',
  stillRunning: '等待会话停止超时，已取消删除',
  trashFailed: '移入回收站失败，已回滚',
  detachFailed: '摘除活体会话失败，已回滚',
  purgeFailed: '彻底删除失败',
  restoreConflict: '原路径已存在，无法还原',
  restoreFailed: '还原失败，已回滚',
  emptyFailed: '清空回收站时部分条目失败',
  settingsFailed: '保存设置失败',
  internal: '服务器内部错误',
})

/** 带中文错误码的错误。 */
export class DeleteError extends Error {
  /**
   * @param {string} code - 中文错误码短语。
   * @param {string} [detail] - 技术细节。
   * @param {{status?: number, extra?: object}} [options] - HTTP 状态与附加字段。
   */
  constructor(code, detail = '', options = {}) {
    super(code)
    this.name = 'DeleteError'
    this.code = code
    this.detail = detail
    this.status = Number.isInteger(options.status) ? options.status : 400
    this.extra = options.extra ?? {}
  }

  /** 序列化成路由层返回的 JSON。 */
  toJSON() {
    return { ok: false, code: this.code, message: this.code, detail: this.detail, ...this.extra }
  }
}

/**
 * 把任意错误归一化成 DeleteError。
 * @param {unknown} error - 捕获到的错误。
 * @param {string} [fallbackCode] - 兜底错误码。
 * @returns {DeleteError} 归一化结果。
 */
export function asDeleteError(error, fallbackCode = ERROR_CODES.internal) {
  if (error instanceof DeleteError) return error
  const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
  return new DeleteError(fallbackCode, detail, { status: 500 })
}
