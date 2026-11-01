/**
 * 截图用的合成会话夹具。
 *
 * 目的：给临时实例造一批「看起来像真的」的会话（标题、工作区、占用空间、子代理），
 * 但**不包含任何真实对话内容**——截图会进公开仓库，不能泄露用户数据。
 *
 * 两套路径风格：
 * - `fsJoin` / `fsHome`：文件真正落盘的位置（Linux 实例用 node:path；Wine 实例落到
 *   ~/.wine/drive_c/…，仍然是 POSIX 路径）；
 * - `cwdJoin` / `cwdHome`：写进会话头部的 `cwd`（Linux 实例同 fs；Wine 实例是 `C:\\…`）。
 *
 * 产物：
 *   <fsHome>/sessions/<projectKey>/<sessionId>/session.v4.jsonl.zstd
 *   <fsHome>/storages/workspace.json
 *   <fsHome>/storages/session_projcache/sessions/<sessionId>.json
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { zstdCompressSync } from 'node:zlib'

/** Windows 风格的路径拼接（Wine 里的 Windows DSH 用 `C:\\...`）。 */
export const joinWin = (...segments) => segments.join('\\').replace(/\\+/g, '\\')

/**
 * 默认工作区（标题、该工作区下的会话条数）。
 * 工作区目录必须真实存在——官方工作区登记要求 `cwd` 能 realpath 且是目录，
 * 否则整个工作区不会被侧栏展示。
 */
export const DEFAULT_WORKSPACES = Object.freeze([
  { id: 'ws-demo-01', title: '项目演示', count: 5 },
  { id: 'ws-demo-02', title: '工具仓库', count: 4 },
  { id: 'ws-demo-03', title: '文档笔记', count: 3 },
])

/** 会话标题模板：短中文标题，覆盖插件截图需要展示的各种状态。 */
export const TITLES = Object.freeze([
  '批量删除与回收站功能验证',
  '插件设置页截图用会话',
  '侧栏行内删除按钮演示',
  '子代理整树清理演练',
  'Windows 路径兼容性回归',
  '回收站还原与彻底删除',
  '运行中会话的删除保护',
  '归档会话与置顶会话',
  '标题很长的会话用来检查侧栏省略号与确认弹窗的换行表现',
  '短标题',
  '中英混排 Session Title 混排测试',
  '子代理一',
])

/** 官方 projectKey 规则：非法字符折成 `~XXXX`，分隔符折成 `-`。 */
export function projectKey(cwd) {
  let readable = ''
  let separatorRun = false
  for (let i = 0; i < cwd.length; i += 1) {
    const ch = cwd[i]
    if (ch === '/' || ch === '\\' || ch === ':') {
      if (!separatorRun) readable += '-'
      separatorRun = true
    } else if (ch !== '~' && /^[A-Za-z0-9._-]$/.test(ch)) {
      readable += ch
      separatorRun = false
    } else {
      readable += `~${ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`
      separatorRun = false
    }
  }
  return `--${(readable.replace(/^-+/, '') || 'root').slice(0, 251)}--`
}

/** 稳定的假 UUID（同一个序号永远得到同一个 ID，重跑可复现）。 */
function fakeUuid(index) {
  return `${index.toString(16).padStart(8, '0')}-1111-2222-3333-444455556666`
}

/**
 * 造一个会话日志（zstd 帧序列）。
 *
 * 官方 JSONL 持久化的硬性约束：**第一帧必须恰好是头部那一行**（`assertZstdHeaderFrame`
 * 会检查帧内只有一个换行且在末尾），其余事件放在后续帧里。所以这里压两帧，不是压一帧。
 * @param {object} options - 会话参数。
 * @param {string} options.id - 会话 ID。
 * @param {string} options.cwd - 会话工作目录（写进头部）。
 * @param {number} options.createdAt - 创建时间戳。
 * @param {string} options.title - 会话标题。
 * @param {string} [options.parentSession] - 父会话 ID（子代理）。
 * @returns {Buffer} 压缩后的日志字节。
 */
export function buildLog(options) {
  const header = {
    type: 'session',
    version: 4,
    id: options.id,
    createdAt: options.createdAt,
    cwd: options.cwd,
    isSeeded: false,
    delegationDepth: 0,
  }
  if (options.parentSession !== undefined) {
    header.parentSession = options.parentSession
    header.origin = 'subagent'
    header.delegationDepth = 1
  }
  const headerFrame = Buffer.from(`${JSON.stringify(header)}\n`, 'utf8')
  const bodyFrame = Buffer.from(`${JSON.stringify({
    type: 'session/title',
    seq: 0,
    time: options.createdAt,
    data: { title: options.title, messageSeqs: [1], source: { kind: 'fallback' } },
  })}\n`, 'utf8')
  return Buffer.concat([zstdCompressSync(headerFrame), zstdCompressSync(bodyFrame)])
}

/**
 * 在指定位置铺好合成会话、工作区记账与标题投影缓存。
 * @param {string} fsHome - 文件落盘根目录。
 * @param {object} [options] - 可选项。
 * @param {typeof DEFAULT_WORKSPACES} [options.workspaces] - 工作区定义。
 * @param {number} [options.baseTime] - 基准时间戳。
 * @param {(segments: string[]) => string} [options.fsJoin] - 落盘路径拼接。
 * @param {(segments: string[]) => string} [options.cwdJoin] - 头部 `cwd` 路径拼接。
 * @param {string} [options.cwdHome] - 头部 `cwd` 的路径根。
 * @param {boolean} [options.createWorkspaceDirs] - 是否创建工作区目录（默认 true）。
 * @returns {Promise<{sessionIds: string[], workspaces: object[]}>} 会话与工作区清单。
 */
export async function seedFixture(fsHome, options = {}) {
  const workspaces = options.workspaces ?? DEFAULT_WORKSPACES
  const baseTime = options.baseTime ?? Date.now()
  const fsJoin = options.fsJoin ?? join
  const cwdJoin = options.cwdJoin ?? join
  const cwdHome = options.cwdHome ?? fsHome
  const createWorkspaceDirs = options.createWorkspaceDirs !== false

  const projcacheDir = fsJoin(fsHome, 'storages', 'session_projcache', 'sessions')
  await mkdir(projcacheDir, { recursive: true })
  await mkdir(fsJoin(fsHome, 'sessions'), { recursive: true })

  const sessionIds = []
  const workspaceRecords = []
  let counter = 0
  for (const workspace of workspaces) {
    const workspacePath = cwdJoin(cwdHome, 'workspaces', workspace.title)
    if (createWorkspaceDirs) await mkdir(fsJoin(fsHome, 'workspaces', workspace.title), { recursive: true })
    const ids = []
    for (let index = 0; index < workspace.count; index += 1) {
      counter += 1
      const id = fakeUuid(counter)
      const title = TITLES[(counter - 1) % TITLES.length]
      const createdAt = baseTime - counter * 3600_000
      const dir = fsJoin(fsHome, 'sessions', projectKey(workspacePath), id)
      await mkdir(dir, { recursive: true })
      await writeFile(fsJoin(dir, 'session.v4.jsonl.zstd'), buildLog({ id, cwd: workspacePath, createdAt, title }))
      await writeFile(fsJoin(projcacheDir, `${id}.json`), JSON.stringify({
        version: 7,
        record: {
          identity: { formatVersion: 4, createdAt, cwd: workspacePath, isSeeded: false, inheritedEventCount: 0 },
          rows: { title: { ver: 1, seq: 0, val: title } },
        },
      }))
      ids.push(id)
      sessionIds.push(id)
    }
    workspaceRecords.push({
      id: workspace.id,
      record: {
        path: workspacePath,
        title: workspace.title,
        sessionIds: ids,
        createdAt: new Date(baseTime).toISOString(),
        updatedAt: new Date(baseTime).toISOString(),
      },
    })
  }

  const table = {}
  for (const workspace of workspaceRecords) table[workspace.id] = workspace.record
  await mkdir(fsJoin(fsHome, 'storages'), { recursive: true })
  await writeFile(fsJoin(fsHome, 'storages', 'workspace.json'), JSON.stringify({
    unit: { name: 'workspace', version: 2 },
    global: {
      initialized: true,
      defaultWorkspaceId: workspaceRecords[0].id,
      workspaceIds: workspaceRecords.map(workspace => workspace.id),
      archivedSessionIds: [],
      pinnedSessionIds: [],
    },
    tables: { workspaces: table },
  }))

  return { sessionIds, workspaces: workspaceRecords.map(workspace => workspace.record) }
}
