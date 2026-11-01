/**
 * HTTP 小工具：JSON 响应、请求体解析、查询参数、统一中文错误响应。
 */
import { DeleteError, ERROR_CODES, asDeleteError } from './errors.mjs'

/** 请求体上限：删除请求只带几个字段，64 KiB 足够。 */
const MAX_BODY_BYTES = 64 * 1024

/**
 * 构造 JSON 响应。
 * @param {number} status - HTTP 状态码。
 * @param {unknown} body - 可 JSON 序列化的响应体。
 * @returns {Response} 响应对象。
 */
export function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })
}

/**
 * 读取并解析 JSON 请求体。
 * @param {Request} request - 传入请求。
 * @returns {Promise<object>} 解析后的对象。
 */
export async function readJsonBody(request) {
  // 先看 content-length；再按流读取并在超限时立刻停止，避免把超大 body 整个读进内存。
  const declared = Number(request.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) throw new DeleteError(ERROR_CODES.badRequest, '请求体过大')
  let text = ''
  try {
    if (request.body === null) {
      text = ''
    } else {
      const reader = request.body.getReader()
      const decoder = new TextDecoder()
      let size = 0
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        size += value.byteLength
        if (size > MAX_BODY_BYTES) {
          await reader.cancel().catch(() => {})
          throw new DeleteError(ERROR_CODES.badRequest, '请求体过大')
        }
        text += decoder.decode(value, { stream: true })
      }
      text += decoder.decode()
    }
  } catch (error) {
    if (error instanceof DeleteError) throw error
    throw new DeleteError(ERROR_CODES.badRequest, `读取请求体失败：${error instanceof Error ? error.message : String(error)}`)
  }
  if (text.trim() === '') return {}
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    throw new DeleteError(ERROR_CODES.badRequest, `JSON 解析失败：${error instanceof Error ? error.message : String(error)}`)
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new DeleteError(ERROR_CODES.badRequest, '请求体必须是 JSON 对象')
  }
  return parsed
}

/**
 * 读取查询参数。
 * @param {Request} request - 传入请求。
 * @param {string} name - 参数名。
 * @returns {string|undefined} 参数值。
 */
export function queryParam(request, name) {
  const value = new URL(request.url).searchParams.get(name)
  return value === null ? undefined : value
}

/**
 * 把一个处理函数包成「永远返回 JSON」的 Fetch 路由实现。
 * @param {(request: Request) => Promise<Response>} handler - 业务处理函数。
 * @returns {(request: Request) => Promise<Response>} 包装后的处理函数。
 */
export function withErrors(handler) {
  return async (request) => {
    try {
      return await handler(request)
    } catch (error) {
      const failure = asDeleteError(error)
      return json(failure.status, failure.toJSON())
    }
  }
}
