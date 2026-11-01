/**
 * Wine + Windows DSH 的宿主冒烟（Linux 侧驱动，可选）。
 *
 * 前置：已按 README「Windows 验证」把 Windows Node 24 + Windows DSH 装进 Wine，
 * 并在 C:\dsh-test-home 的 web profile 里装好本插件。脚本会：
 *  1. 停掉该 Wine 前缀里的 DSH；
 *  2. 从真实 ~/.dsh/sessions 复制 2~3 个会话 + workspace.json + 投影缓存到 Windows DSH_HOME；
 *  3. 用 Wine 启动 `dsh web --port 0`，解析日志里的 token URL 换 cookie；
 *  4. 验证：/sessions、/inspect、/delete(trash/purge)、/trash、/restore、/batch-delete、/empty、非法 ID；
 *  5. 清理临时实例（保留 Windows profile 供下次复用）。
 *
 * 环境变量：
 *  - WINEPREFIX        Wine 前缀（默认 ~/.wine-nodetest）
 *  - WIN_DSH_HOME      Windows 侧 DSH_HOME（默认 C:\dsh-test-home）
 *  - WIN_NODE          Windows Node 路径（默认 C:\node24\node.exe）
 *  - WIN_DSH_BIN       DSH bin.js 路径（默认 C:\npm-global\node_modules\@deepseek-ai\dsh\lib\bin.js）
 *  - WIN_KEEP=1        失败时保留临时实例（便于排查）
 */
import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { cp, mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

const WINEPREFIX = process.env.WINEPREFIX ?? join(homedir(), '.wine-nodetest')
const WIN_HOME = process.env.WIN_DSH_HOME ?? 'C:\\dsh-test-home'
const WIN_NODE = process.env.WIN_NODE ?? 'C:\\node24\\node.exe'
const WIN_DSH_BIN = process.env.WIN_DSH_BIN ?? 'C:\\npm-global\\node_modules\\@deepseek-ai\\dsh\\lib\\bin.js'
const LINUX_HOME = join(WINEPREFIX, 'drive_c', WIN_HOME.replace(/^[A-Za-z]:\\?/, ''))
const LOG = join(WINEPREFIX, 'drive_c', 'dsh-web.log')
const RUN_CMD = join(WINEPREFIX, 'drive_c', 'run-dsh-web.cmd')
const REAL_HOME = join(homedir(), '.dsh')

const failures = []
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail === '' ? '' : `：${detail}`}`)
  if (!ok) failures.push(name)
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const readLog = () => { try { return readFileSync(LOG, 'utf8') } catch { return '' } }

/** 停掉该 Wine 前缀里的进程（只影响本前缀）。 */
function stopWine() {
  try { spawn('wineserver', ['-k'], { env: { ...process.env, WINEPREFIX } }).unref() } catch { /* 已停 */ }
}

/** 复制样例会话（2 个项目、最多 3 条）以及工作区记账/投影缓存。 */
async function copySamples() {
  const target = join(LINUX_HOME, 'sessions')
  await rm(target, { recursive: true, force: true })
  await mkdir(target, { recursive: true })
  let copied = 0
  const projects = (await readdir(join(REAL_HOME, 'sessions'), { withFileTypes: true })).filter(entry => entry.isDirectory())
  for (const project of projects) {
    if (copied >= 3) break
    const projectDir = join(REAL_HOME, 'sessions', project.name)
    const sessions = (await readdir(projectDir, { withFileTypes: true })).filter(entry => entry.isDirectory())
    for (const session of sessions) {
      if (copied >= 3) break
      const sourceDir = join(projectDir, session.name)
      const logs = (await readdir(sourceDir)).filter(name => name.endsWith('.jsonl.zstd'))
      if (logs.length === 0) continue
      const destDir = join(target, project.name, session.name)
      await mkdir(destDir, { recursive: true })
      for (const log of logs) await cp(join(sourceDir, log), join(destDir, log))
      copied += 1
    }
  }
  const storages = join(LINUX_HOME, 'storages')
  await mkdir(storages, { recursive: true })
  if (existsSync(join(REAL_HOME, 'storages', 'workspace.json'))) {
    await cp(join(REAL_HOME, 'storages', 'workspace.json'), join(storages, 'workspace.json'))
  }
  if (existsSync(join(REAL_HOME, 'storages', 'session_projcache'))) {
    await cp(join(REAL_HOME, 'storages', 'session_projcache'), join(storages, 'session_projcache'), { recursive: true })
  }
  return copied
}

async function startServer() {
  await writeFile(RUN_CMD, [
    '@echo off',
    `set PATH=${WIN_NODE.replace(/node\.exe$/i, '')};%PATH%`,
    `set DSH_HOME=${WIN_HOME}`,
    `${WIN_NODE} ${WIN_DSH_BIN} web --port 0 --host 127.0.0.1 --no-open > C:\\dsh-web.log 2>&1`,
    '',
  ].join('\r\n'), 'utf8')
  await rm(LOG, { force: true })
  spawn('wine', ['cmd', '/c', 'C:\\run-dsh-web.cmd'], {
    env: { ...process.env, WINEPREFIX, WINEDEBUG: '-all', DISPLAY: '' },
    detached: true,
    stdio: 'ignore',
  }).unref()
  for (let index = 0; index < 180; index += 1) {
    const match = readLog().match(/dsh web:\s*(http:\/\/\S+)/)
    if (match) return match[1]
    await sleep(1000)
  }
  throw new Error('等待 Windows DSH web 启动超时，日志：' + readLog().slice(-800))
}

try {
  check('Wine 前缀存在', existsSync(WINEPREFIX), WINEPREFIX)
  check('Windows DSH_HOME 存在', existsSync(LINUX_HOME), WIN_HOME)
  stopWine()
  await sleep(2000)
  const samples = await copySamples()
  check('复制样例会话', samples >= 2, `${samples} 条`)

  const url = await startServer()
  const origin = new URL(url).origin
  const tokenResponse = await fetch(url, { redirect: 'manual' })
  const cookie = (tokenResponse.headers.getSetCookie?.() ?? []).map(value => value.split(';')[0]).join('; ')
  const api = async (path, options = {}) => {
    const response = await fetch(`${origin}${path}`, {
      method: options.method ?? 'GET',
      headers: { cookie, ...(options.body === undefined ? {} : { 'content-type': 'application/json' }) },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    })
    return { status: response.status, payload: await response.json().catch(() => ({})) }
  }

  const page = await fetch(`${origin}/`, { headers: { cookie } })
  check('鉴权首页可访问', page.status === 200, `HTTP ${page.status}`)
  check('插件进入启动图', (await page.text()).includes('dsh-session-delete/client.js'))

  const trash0 = await api('/api/dsh-session-delete/trash')
  check('回收站接口', trash0.payload.ok === true)
  const list = await api('/api/dsh-session-delete/sessions')
  const sessions = list.payload.sessions ?? []
  check('会话清单', list.payload.ok === true && sessions.length >= 2, `${sessions.length} 条`)
  if (sessions.length < 2) throw new Error('样例会话不足，无法继续')

  const findDir = async sessionId => {
    const root = join(LINUX_HOME, 'sessions')
    for (const project of await readdir(root, { withFileTypes: true })) {
      if (!project.isDirectory()) continue
      const dirs = await readdir(join(root, project.name), { withFileTypes: true })
      for (const dir of dirs) {
        if (dir.isDirectory() && (dir.name === sessionId || dir.name === sessionId.replace(/^session-/, ''))) {
          return join(root, project.name, dir.name)
        }
      }
    }
    return undefined
  }

  const first = sessions[0].sessionId
  const second = sessions[1].sessionId
  const firstDir = await findDir(first)
  const secondDir = await findDir(second)
  check('定位 Windows 会话目录', firstDir !== undefined && secondDir !== undefined)

  const inspect = await api(`/api/dsh-session-delete/inspect?sessionId=${encodeURIComponent(first)}`)
  check('inspect', inspect.payload.ok === true && inspect.payload.session?.exists === true)

  const trashed = await api('/api/dsh-session-delete/delete', { method: 'POST', body: { sessionId: first, mode: 'trash' } })
  check('移入回收站（Windows）', trashed.payload.ok === true && firstDir !== undefined && !existsSync(firstDir))
  const trash1 = await api('/api/dsh-session-delete/trash')
  check('回收站条目', (trash1.payload.entries ?? []).some(entry => entry.sessionId === first))

  const restored = await api('/api/dsh-session-delete/restore', { method: 'POST', body: { sessionId: first } })
  check('还原（Windows）', restored.payload.ok === true && firstDir !== undefined && existsSync(firstDir))
  const trash2 = await api('/api/dsh-session-delete/trash')
  check('还原后回收站为空', (trash2.payload.entries ?? []).length === 0)

  const purged = await api('/api/dsh-session-delete/delete', { method: 'POST', body: { sessionId: first, mode: 'purge' } })
  check('彻底删除（Windows）', purged.payload.ok === true && firstDir !== undefined && !existsSync(firstDir))

  const batch = await api('/api/dsh-session-delete/batch-delete', { method: 'POST', body: { sessionIds: [second], mode: 'trash', stopIfRunning: false } })
  check('批量删除（Windows）', batch.payload.ok === true && batch.payload.summary?.succeeded === 1)
  const empty = await api('/api/dsh-session-delete/empty', { method: 'POST', body: { onlyExpired: false } })
  check('清空回收站（Windows）', empty.payload.ok === true)

  const bad = await api('/api/dsh-session-delete/inspect?sessionId=C%3A%5C%5Cwindows')
  check('拒绝 Windows 非法会话 ID', bad.status === 400, `HTTP ${bad.status}`)
} catch (error) {
  check('Wine 宿主冒烟', false, error instanceof Error ? error.message : String(error))
  if (process.env.WIN_KEEP !== '1') stopWine()
  process.exitCode = 1
} finally {
  stopWine()
}

if (failures.length > 0) {
  console.log(`\n失败 ${failures.length} 项：${failures.join('、')}`)
  process.exitCode = 1
} else {
  console.log('\nWindows（Wine）宿主冒烟全部通过。')
}
