/**
 * 宿主半边：注册 `/api/dsh-session-delete/*` 路由、串行化写操作、启动时清理过期回收站条目。
 *
 * 依赖注入只声明 `connection` 与 `sessions`（前者提供已鉴权的 Fetch 路由，后者是会话 store）；
 * `workspaceRegistry` / `sessionPersistence` / `sessionProjections` / `agents` / `storageDomain`
 * 激活较晚，一律用 `ctx.get()` 现取，取不到就降级并在结果里写明。
 *
 * 不 import 任何 `@deepseek-ai/*` 包：只用 Node 内置模块与本仓库的相对路径。
 */
import { appendAudit } from './src/host/audit.mjs'
import { DeleteError, ERROR_CODES, asDeleteError } from './src/host/errors.mjs'
import { json, queryParam, readJsonBody, withErrors } from './src/host/http.mjs'
import { assertSessionId } from './src/host/paths.mjs'
import { collectSessionMeta, readSnapshotIndex } from './src/host/session-meta.mjs'
import {
  executeDelete,
  executeEmptyTrash,
  executePurgeTrashEntry,
  executeRestore,
  executeSweep,
} from './src/host/execute.mjs'
import { findEntryBySession, listEntries, readSettings, sweepExpired, usageOf, writeSettings } from './src/host/trash.mjs'

/** 路由前缀。 */
const BASE = '/api/dsh-session-delete'

/** 启动清理的延迟：等宿主把会话与存储服务都挂好，又不至于让用户等。 */
const STARTUP_SWEEP_DELAY_MS = 4000

/**
 * 进程内串行队列：删除、还原、清空都会写 `workspace.json` 与回收站目录，
 * 并发执行会互相踩，所以同一时刻只允许一个写事务。
 * @returns {(work: () => Promise<unknown>) => Promise<unknown>} 入队函数。
 */
function createQueue() {
  let tail = Promise.resolve()
  return (work) => {
    const run = tail.then(work, work)
    tail = run.then(() => {}, () => {})
    return run
  }
}

/**
 * 把回收站条目裁成给浏览器看的形状（不暴露磁盘路径细节）。
 * @param {object} entry - `listEntries()` 的条目。
 * @returns {object} 公开形状。
 */
function publicEntry(entry) {
  return {
    trashId: entry.trashId,
    sessionId: entry.sessionId,
    title: entry.title,
    deletedAt: entry.deletedAt,
    sizeBytes: entry.sizeBytes,
    workspaceTitle: entry.workspaceTitle,
    workspacePath: entry.workspacePath,
    archived: entry.archived,
    pinned: entry.pinned,
    members: entry.members.map(member => ({
      sessionId: member.sessionId,
      title: member.title,
      sizeBytes: member.sizeBytes,
      isRoot: member.isRoot,
    })),
  }
}

/**
 * 弹窗所需的会话元数据。
 * @param {object} ctx - 宿主插件上下文。
 * @param {string} sessionId - 会话 ID。
 * @param {string} [title] - 客户端行内标题（宿主取不到标题时的兜底）。
 * @returns {Promise<object>} 元数据。
 */
async function inspectSession(ctx, sessionId, title) {
  const index = await readSnapshotIndex(ctx)
  const meta = await collectSessionMeta(ctx, sessionId, { title, index })
  const inTrash = (await findEntryBySession(sessionId)) !== undefined
  return {
    sessionId,
    title: meta.title,
    sizeBytes: meta.sizeBytes,
    exists: meta.exists,
    inTrash,
    running: meta.running,
    activity: meta.activity,
    activityKnown: meta.activityKnown,
    activityError: meta.activityError,
    live: meta.live,
    archived: meta.archived,
    pinned: meta.pinned,
    workspace: meta.workspace === undefined
      ? null
      : { id: meta.workspace.id, path: meta.workspace.path, title: meta.workspace.title },
    descendants: meta.descendants.map(item => ({
      sessionId: item.sessionId,
      title: item.title,
      sizeBytes: item.sizeBytes,
      running: item.running,
    })),
    members: meta.members.map(member => member.sessionId),
    degraded: meta.degraded,
  }
}

/**
 * 启动时清理过期条目；失败只写审计，不打扰启动。
 * @param {object} ctx - 宿主插件上下文。
 * @returns {Promise<void>} 完成。
 */
async function startupSweep(ctx, enqueue) {
  try {
    const settings = await readSettings()
    if (settings.sweepOnStartup !== true) return
    // 与用户操作共用同一个串行队列，避免启动清理和删除/还原同时写回收站。
    const result = await enqueue(() => sweepExpired(settings))
    if (result.removed > 0 || result.failures.length > 0) {
      await appendAudit({ action: 'startup-sweep', ok: result.failures.length === 0, removed: result.removed, freedBytes: result.freedBytes, failures: result.failures.length })
      if (result.removed > 0) ctx.logger?.info?.(`session-delete: 启动清理回收站 ${result.removed} 条`)
    }
  } catch (error) {
    ctx.logger?.warn?.(`session-delete: 启动清理失败：${error instanceof Error ? error.message : String(error)}`)
  }
}

/**
 * 挂载宿主半边。
 * @param {object} ctx - 宿主插件上下文。
 * @returns {void}
 */
export function apply(ctx) {
  console.log('[dsh-session-delete] apply 开始：等待 connection / sessions 服务就绪')
  ctx.inject(['connection', 'sessions'], (scoped) => {
    const enqueue = createQueue()

    /** 统一的写事务入口：入队 + 审计。 */
    const mutate = async (action, sessionId, work) => {
      const startedAt = Date.now()
      try {
        const result = await enqueue(work)
        await appendAudit({
          action,
          sessionId,
          ok: true,
          code: result?.code ?? 'ok',
          warnings: Array.isArray(result?.warnings) ? result.warnings.length : 0,
          leftovers: Array.isArray(result?.leftovers) ? result.leftovers.length : 0,
          durationMs: Date.now() - startedAt,
        })
        return json(200, result)
      } catch (error) {
        const failure = asDeleteError(error)
        await appendAudit({
          action,
          sessionId,
          ok: false,
          code: failure.code,
          detail: failure.detail,
          durationMs: Date.now() - startedAt,
        })
        return json(failure.status, failure.toJSON())
      }
    }

    scoped.effect(() => scoped.connection.fetch.register({
      path: `${BASE}/inspect`,
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: withErrors(async (request) => {
        const sessionId = assertSessionId(queryParam(request, 'sessionId'))
        const title = queryParam(request, 'title')
        const session = await inspectSession(scoped, sessionId, title)
        const settings = await readSettings()
        return json(200, { ok: true, session, settings })
      }),
    }), 'session-delete: inspect 路由')

    scoped.effect(() => scoped.connection.fetch.register({
      path: `${BASE}/delete`,
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: withErrors(async (request) => {
        const body = await readJsonBody(request)
        const sessionId = assertSessionId(body.sessionId)
        return await mutate('delete', sessionId, () => executeDelete(scoped, {
          sessionId,
          mode: body.mode === 'purge' ? 'purge' : 'trash',
          stopIfRunning: body.stopIfRunning === true,
          title: typeof body.title === 'string' ? body.title : '',
        }))
      }),
    }), 'session-delete: delete 路由')

    scoped.effect(() => scoped.connection.fetch.register({
      path: `${BASE}/trash`,
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: withErrors(async () => {
        const entries = await listEntries()
        return json(200, {
          ok: true,
          entries: entries.map(publicEntry),
          usage: usageOf(entries),
          settings: await readSettings(),
        })
      }),
    }), 'session-delete: trash 路由')

    scoped.effect(() => scoped.connection.fetch.register({
      path: `${BASE}/restore`,
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: withErrors(async (request) => {
        const body = await readJsonBody(request)
        const sessionId = assertSessionId(body.sessionId)
        return await mutate('restore', sessionId, () => executeRestore(scoped, sessionId))
      }),
    }), 'session-delete: restore 路由')

    scoped.effect(() => scoped.connection.fetch.register({
      path: `${BASE}/purge`,
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: withErrors(async (request) => {
        const body = await readJsonBody(request)
        const sessionId = assertSessionId(body.sessionId)
        return await mutate('purge', sessionId, () => executePurgeTrashEntry(scoped, sessionId))
      }),
    }), 'session-delete: purge 路由')

    scoped.effect(() => scoped.connection.fetch.register({
      path: `${BASE}/empty`,
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: withErrors(async (request) => {
        const body = await readJsonBody(request)
        const onlyExpired = body.onlyExpired === true
        return await mutate(onlyExpired ? 'sweep' : 'empty', '', () => onlyExpired ? executeSweep(scoped) : executeEmptyTrash(scoped))
      }),
    }), 'session-delete: empty 路由')

    scoped.effect(() => scoped.connection.fetch.register({
      path: `${BASE}/settings`,
      methods: ['GET', 'POST'],
      requestBody: 'buffered',
      fetch: withErrors(async (request) => {
        if (request.method === 'POST') {
          const body = await readJsonBody(request)
          return await mutate('settings', '', async () => {
            try {
              const settings = await writeSettings(body)
              return { ok: true, code: 'ok', settings }
            } catch (error) {
              throw new DeleteError(ERROR_CODES.settingsFailed, error instanceof Error ? error.message : String(error), { status: 500 })
            }
          })
        }
        return json(200, { ok: true, settings: await readSettings() })
      }),
    }), 'session-delete: settings 路由')

    // 一行挂载日志：`--help` 冒烟时用它确认 apply 真的执行到了这里（技能里的验证阶梯要求可见）。
    console.log('[dsh-session-delete] 宿主半边已挂载：/api/dsh-session-delete/{inspect,delete,trash,restore,purge,empty,settings}')

    const timer = setTimeout(() => { void startupSweep(scoped, enqueue) }, STARTUP_SWEEP_DELAY_MS)
    timer.unref?.()
    scoped.effect(() => () => clearTimeout(timer), 'session-delete: 启动清理定时器')
  })
}

/** 自检与测试用的内部导出（不属于插件契约）。 */
export const __test = { BASE, createQueue, publicEntry, inspectSession }
