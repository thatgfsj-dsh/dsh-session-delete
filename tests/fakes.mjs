/**
 * 测试用的假宿主上下文：只实现插件真正会碰到的服务面。
 */
import { join } from 'node:path'

/**
 * 造一个假 ctx。
 * @param {object} options - 会话、快照、工作区、活动族等。
 * @returns {object} `{ ctx, emitted, flushes, detaches, live, calls }`。
 */
export function makeFakeCtx(options = {}) {
  const home = options.home
  const live = new Map()
  for (const session of options.sessions ?? []) live.set(session.id, session)
  const emitted = []
  const flushes = []
  const detaches = []
  const calls = { attach: [], insertBefore: [], archive: [], unarchive: [], pin: [], unpin: [], detach: [], domainDelete: [] }
  const snapshots = options.snapshots ?? []
  const sessionsRoot = options.sessionsRoot ?? join(home, 'sessions')

  const registry = options.registry ?? {
    list: () => [],
    get: () => undefined,
    resolveByPath: async () => undefined,
    archivedSessionIds: [],
    pinnedSessionIds: [],
    unarchiveSession: async id => { calls.unarchive.push(id) },
    unpinSession: async id => { calls.unpin.push(id) },
    pinSession: async id => { calls.pin.push(id) },
    archiveSession: async id => { calls.archive.push(id) },
    stopSessionActivity: async id => { calls.stop = id },
  }

  const facility = options.domain ?? {
    get: name => name === 'session_projcache'
      ? { table: () => ({ delete: async key => { calls.domainDelete.push(key); return true } }) }
      : undefined,
  }

  const agents = options.agents ?? {
    get: id => (options.runningIds ?? []).includes(id) ? { id, status: 'running', cancel() {} } : undefined,
    list: () => [],
  }

  const ctx = {
    get(name) {
      switch (name) {
        case 'sessions':
          return {
            get: id => live.get(id),
            list: () => [...live.values()],
            flush: async session => { flushes.push(session.id) },
            liveEntryFor: session => ({ session }),
            detachEntered: entry => { live.delete(entry.session.id); detaches.push(entry.session.id) },
          }
        case 'sessionPersistence':
          return {
            list: async () => snapshots,
            locate: meta => ({ kind: 'jsonl', path: join(sessionsRoot, '--proj--', meta.id, 'session.v4.jsonl.zstd') }),
          }
        case 'workspaceRegistry':
          return registry
        case 'agents':
          return agents
        case 'storageDomain':
          return facility
        case 'sessionProjections':
          return options.projections
        default:
          return undefined
      }
    },
    waterfall: async () => options.activity ?? [],
    emit: (name, payload) => { emitted.push({ name, payload }) },
    logger: { info() {}, warn() {} },
  }

  return { ctx, emitted, flushes, detaches, live, calls, registry }
}

/**
 * 造一个工作区实体（记录 detach/attach 调用）。
 * @param {object} options - id/path/title/sessionIds。
 * @returns {object} 实体与调用记录。
 */
export function makeWorkspace(options = {}) {
  const calls = { detach: [], attach: [], insertBefore: [] }
  let sessionIds = [...(options.sessionIds ?? [])]
  const entity = {
    id: options.id ?? 'ws-1',
    path: options.path ?? '/tmp/ws',
    title: options.title ?? '测试工作区',
    get sessionIds() { return sessionIds },
    async detachSession(id) {
      calls.detach.push(id)
      sessionIds = sessionIds.filter(item => item !== id)
    },
    async attachSession(id) {
      calls.attach.push(id)
      if (!sessionIds.includes(id)) sessionIds = [id, ...sessionIds]
    },
    async insertSessionBefore(id, before) {
      calls.insertBefore.push([id, before])
      const without = sessionIds.filter(item => item !== id)
      const at = without.indexOf(before)
      sessionIds = at === -1 ? [...without, id] : [...without.slice(0, at), id, ...without.slice(at)]
    },
  }
  return { entity, calls }
}
