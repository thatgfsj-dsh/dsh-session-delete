/**
 * 路径与标识工具：DSH 主目录、回收站目录、会话标识的两种命名（`session-<uuid>` 与裸 `<uuid>`）、
 * 以及官方 JSONL 后端的目录编码规则（仅在拿不到持久化服务时作为兜底）。
 *
 * 本文件不 import 任何 `@deepseek-ai/*` 包，只用 Node 内置模块。
 */
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { DeleteError, ERROR_CODES } from './errors.mjs'

/** 展开 `~` / `~/` / `~\` 前缀（与官方 dsh-home-paths 一致）。 */
function expandHomePath(path) {
  if (path === '~') return homedir()
  if (path.startsWith('~/') || path.startsWith('~\\')) return join(homedir(), path.slice(2))
  return path
}

/**
 * DSH 主目录：优先 `DSH_HOME`（空白视为未设置），否则 `~/.dsh`。
 * 与官方 `@deepseek-ai/dsh-home-paths` 的 resolveDshHome 保持一致：
 * 展开 `~`、resolve 成绝对路径、不依赖 `$HOME`（Windows 上 `$HOME` 不可靠）。
 */
export function dshHome() {
  const explicit = process.env.DSH_HOME
  const value = typeof explicit === 'string' && explicit.trim() !== '' ? explicit : join(homedir(), '.dsh')
  return resolve(expandHomePath(value))
}

/** 插件私有数据根：`$DSH_HOME/session-delete`。 */
export const pluginRoot = () => join(dshHome(), 'session-delete')

/** 回收站根：`$DSH_HOME/session-delete/trash`，每条一个目录。 */
export const trashRoot = () => join(pluginRoot(), 'trash')

/** 回收站策略文件。 */
export const settingsPath = () => join(pluginRoot(), 'settings.json')

/** 审计日志：`$DSH_HOME/logs/dsh-session-delete.log`。 */
export const auditLogPath = () => join(dshHome(), 'logs', 'dsh-session-delete.log')

/** 会话日志根：`$DSH_HOME/sessions`（官方 base 层 `root: dshHomePath('sessions')`）。 */
export const sessionsRoot = () => join(dshHome(), 'sessions')

/** 存储根：`$DSH_HOME/storages`（`workspace.json` 与 `session_projcache/` 都在这里）。 */
export const storagesRoot = () => join(dshHome(), 'storages')

/** 投影缓存分片目录：`$DSH_HOME/storages/session_projcache/sessions`。 */
export const projCacheDir = () => join(storagesRoot(), 'session_projcache', 'sessions')

/**
 * 校验一个会话标识是否可以安全地用于文件系统操作。
 * @param {unknown} id - 候选标识。
 * @returns {string} 校验通过的标识。
 */
export function assertSessionId(id) {
  const fail = detail => new DeleteError(ERROR_CODES.badSessionId, detail, { status: 400 })
  if (typeof id !== 'string' || id === '') throw fail('会话 ID 不能为空')
  // 不做 trim：前后空白属于非法字符，静默归一化会把 " abc " 当成 abc，破坏「精确 ID」约定。
  const value = id
  if (value.length > 200) throw fail('会话 ID 过长')
  if (value === '.' || value === '..') throw fail('会话 ID 非法')
  if (!/^[A-Za-z0-9._:-]+$/.test(value)) throw fail('会话 ID 含有非法字符')
  // Windows 文件名额外限制：非法字符、保留设备名、结尾的点/空格都会让目录操作失败或落到 ADS。
  if (process.platform === 'win32') {
    if (/[<>:"|?*\u0000-\u001f]/.test(value)) throw fail('会话 ID 含有 Windows 非法字符')
    if (/[. ]$/.test(value)) throw fail('会话 ID 不能以点或空格结尾')
    if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i.test(value)) throw fail('会话 ID 是 Windows 保留设备名')
  }
  return value
}

/**
 * 会话标识的两种历史命名：`session-<uuid>` 与裸 `<uuid>`。
 * 会话目录与投影缓存分片都可能用其中一种，所以每次清理都要两种都试。
 * @param {string} id - 会话标识。
 * @returns {string[]} 去重后的候选名，原标识在前。
 */
export function idVariants(id) {
  const value = assertSessionId(id)
  const bare = value.startsWith('session-') ? value.slice('session-'.length) : value
  const prefixed = value.startsWith('session-') ? value : `session-${value}`
  const out = [value]
  for (const candidate of [bare, prefixed]) {
    if (candidate !== '' && !out.includes(candidate)) out.push(candidate)
  }
  return out.filter(candidate => /^[A-Za-z0-9._:-]+$/.test(candidate))
}

/**
 * 官方 JSONL 后端的路径段编码：非 `[A-Za-z0-9._-]` 的码元转 `~XXXX`，
 * `.` 与 `..` 单独转义。与 `dsh-session-persistence-jsonl` 的 `encodeSegment` 一致。
 * @param {string} raw - 原始片段。
 * @returns {string} 文件系统安全的单段名。
 */
export function encodeSegment(raw) {
  if (raw === '.') return '~002E'
  if (raw === '..') return '~002E~002E'
  let out = ''
  for (let index = 0; index < raw.length; index += 1) {
    const code = raw.charCodeAt(index)
    const char = String.fromCharCode(code)
    if (char !== '~' && /^[A-Za-z0-9._-]$/.test(char)) out += char
    else out += `~${code.toString(16).toUpperCase().padStart(4, '0')}`
  }
  return out
}

/**
 * 官方 JSONL 后端的项目目录名：分隔符折成 `-`，不安全码元转义，前后加 `--`。
 * 与 `dsh-session-persistence-jsonl` 的 `projectKey` 一致。
 * @param {string} cwd - 会话的工作目录。
 * @returns {string} 项目目录名。
 */
export function projectKey(cwd) {
  if (typeof cwd !== 'string' || cwd.length === 0) throw new Error('工作目录不能为空')
  let readable = ''
  let separatorRun = false
  for (let index = 0; index < cwd.length; index += 1) {
    const code = cwd.charCodeAt(index)
    const char = String.fromCharCode(code)
    if (char === '/' || char === '\\' || char === ':') {
      if (!separatorRun) readable += '-'
      separatorRun = true
    } else if (char !== '~' && /^[A-Za-z0-9._-]$/.test(char)) {
      readable += char
      separatorRun = false
    } else {
      readable += `~${code.toString(16).toUpperCase().padStart(4, '0')}`
      separatorRun = false
    }
  }
  return `--${(readable.replace(/^-+/, '') || 'root').slice(0, 251)}--`
}

/**
 * 按官方布局推算一个会话目录（不访问磁盘）。
 * @param {string} id - 会话标识。
 * @param {string|undefined} cwd - 会话的工作目录；缺省走 `_no-cwd`。
 * @returns {string} 会话目录的绝对路径。
 */
export function predictedSessionDir(id, cwd) {
  const root = sessionsRoot()
  const project = typeof cwd === 'string' && cwd !== '' ? projectKey(cwd) : '_no-cwd'
  return join(root, project, encodeSegment(id))
}
