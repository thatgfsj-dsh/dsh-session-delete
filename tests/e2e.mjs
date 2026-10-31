/**
 * 隔离环境端到端自检（不会碰真实会话，也不会重启你正在用的 dsh web）：
 *
 * 1. 检查本仓库已安装进某个 web profile（默认 `~/.dsh/profiles/web`）。
 * 2. 创建临时 `DSH_HOME`，复制一份 web profile 并修复外部符号链接（不写真实 profile）。
 * 3. 从真实 `~/.dsh/sessions` 复制一个会话到临时目录（只复制日志文件，不复制锁）。
 * 4. 用 `--port 0` 启动 `dsh web`，解析它打印的 URL 与 token。
 * 5. 走 `inspect → delete(trash) → trash → restore → delete(purge) → settings` 全链路，
 *    并核对磁盘上会话目录的删/还原/再删。
 * 6. 校验启动 HTML 的 boot 图包含 `dsh-session-delete/client.js`。
 * 7. 无论成败都杀掉临时实例并删除临时目录。
 *
 * 用法：
 *   node tests/e2e.mjs
 * 可选环境变量：
 *   DSH_PROFILE=web        要启动的 profile 名（默认 web）
 *   DSH_REAL_HOME=~/.dsh   真实 DSH 主目录（用来找 profile 与样例会话）
 *   DSH_CLI=dsh             dsh 可执行文件
 */

import { spawn } from 'node:child_process'
import { copyFile, cp, mkdtemp, readdir, readlink, rm, symlink, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

const PROFILE = process.env.DSH_PROFILE ?? 'web'
const REAL_HOME = process.env.DSH_REAL_HOME ?? join(homedir(), '.dsh')
const DSH = process.env.DSH_CLI ?? 'dsh'
const PROFILE_DIR = join(REAL_HOME, 'profiles', PROFILE)
const PLUGIN_DIR = join(PROFILE_DIR, 'node_modules', 'dsh-session-delete')

const failures = []
let tempHome = null
let server = null
let lastOutput = ''
let authCookie = ''

/** 记录一次检查。 */
function check(name, ok, detail = '') {
  const line = `${ok ? 'PASS' : 'FAIL'}  ${name}${detail === '' ? '' : `：${detail}`}`
  console.log(line)
  if (!ok) failures.push(`${name}${detail === '' ? '' : `：${detail}`}`)
}

/** 短暂等待。 */
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

/** 轮询直到条件成立或超时。 */
async function waitFor(label, probe, timeoutMs = 60000, intervalMs = 250) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = await probe()
    if (value !== undefined && value !== null && value !== false) return value
    if (Date.now() >= deadline) throw new Error(`等待超时：${label}`)
    await sleep(intervalMs)
  }
}

/** 调插件 HTTP 接口。 */
async function api(origin, path, options = {}) {
  const response = await fetch(`${origin}/api/dsh-session-delete${path}`, {
    method: options.method ?? 'GET',
    headers: {
      accept: 'application/json',
      ...(authCookie === '' ? {} : { cookie: authCookie }),
      ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  })
  const payload = await response.json().catch(() => ({ ok: false, message: `HTTP ${response.status}` }))
  return { status: response.status, payload }
}

/**
 * 复制 profile 后，把指向仓库外部的相对符号链接改写成绝对路径。
 * @param {string} sourceRoot - 真实 profile 根。
 * @param {string} targetRoot - 临时 profile 根。
 * @returns {Promise<number>} 修复的数量。
 */
async function repairSymlinks(sourceRoot, targetRoot) {
  let repaired = 0
  const walk = async (relative) => {
    const targetDir = relative === '' ? targetRoot : join(targetRoot, relative)
    let entries
    try {
      entries = await readdir(targetDir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const relChild = relative === '' ? entry.name : join(relative, entry.name)
      const targetPath = join(targetRoot, relChild)
      if (entry.isSymbolicLink()) {
        const linkTarget = await readlink(targetPath)
        if (existsSync(resolve(dirname(targetPath), linkTarget))) continue
        const sourcePath = join(sourceRoot, relChild)
        const absolute = resolve(dirname(sourcePath), linkTarget)
        await rm(targetPath, { force: true })
        await symlink(absolute, targetPath)
        repaired += 1
        continue
      }
      if (entry.isDirectory()) await walk(relChild)
    }
  }
  await walk('')
  return repaired
}

/** 从真实会话树里挑若干个样例会话并复制到临时 HOME。 */
async function copySampleSessions(limit) {
  const realSessions = join(REAL_HOME, 'sessions')
  if (!existsSync(realSessions)) throw new Error(`没有找到真实会话目录：${realSessions}`)
  const projects = (await readdir(realSessions, { withFileTypes: true })).filter(entry => entry.isDirectory())
  const copied = []
  const sampleFilter = process.env.DSH_E2E_SAMPLE
  for (const project of projects) {
    const projectDir = join(realSessions, project.name)
    const sessions = (await readdir(projectDir, { withFileTypes: true })).filter(entry => entry.isDirectory())
    for (const session of sessions) {
      if (copied.length >= limit) return copied
      if (sampleFilter !== undefined && sampleFilter !== '' && !session.name.includes(sampleFilter)) continue
      const sourceDir = join(projectDir, session.name)
      const logs = (await readdir(sourceDir)).filter(name => name.endsWith('.jsonl.zstd'))
      if (logs.length === 0) continue
      const targetDir = join(tempHome, 'sessions', project.name, session.name)
      await mkdir(targetDir, { recursive: true })
      for (const log of logs) await copyFile(join(sourceDir, log), join(targetDir, log))
      copied.push({ projectKey: project.name, dirName: session.name, targetDir })
    }
  }
  if (copied.length === 0) throw new Error('真实会话树里没有可复制的会话')
  return copied
}

/** 用 inspect 解析一个目录名对应的真实 sessionId（兼容 session- 前缀/裸 UUID）。 */
async function resolveSessionId(origin, dirName) {
  const candidates = [dirName]
  if (dirName.startsWith('session-')) candidates.push(dirName.slice('session-'.length))
  else candidates.push(`session-${dirName}`)
  for (const candidate of candidates) {
    const { payload } = await api(origin, `/inspect?sessionId=${encodeURIComponent(candidate)}`)
    if (payload.ok === true && payload.session?.exists === true) return { sessionId: candidate, inspected: payload }
  }
  return { sessionId: null, inspected: null }
}

/** 启动临时 dsh web，返回 origin 与页面 HTML。 */
async function startServer() {
  lastOutput = ''
  const child = spawn(DSH, ['--profile', PROFILE, '--port', '0', '--host', '127.0.0.1', '--no-open'], {
    env: { ...process.env, DSH_HOME: tempHome },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  server = child
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', chunk => { stdout += String(chunk) })
  child.stderr.on('data', chunk => { stderr += String(chunk); lastOutput = `${stdout}\n${stderr}` })
  const url = await waitFor('dsh web 打印 URL', () => {
    const match = stdout.match(/dsh web:\s*(http:\/\/\S+)/)
    return match === null ? undefined : match[1]
  }, 90000)
  const origin = new URL(url).origin

  // 第一次带 token 的请求会 303 并下发鉴权 cookie；后续请求必须带上它。
  const tokenResponse = await waitFor('token 换取鉴权 cookie', async () => {
    try {
      const response = await fetch(url, { redirect: 'manual' })
      return response.status === 303 || response.ok ? response : undefined
    } catch {
      return undefined
    }
  }, 30000)
  authCookie = (tokenResponse.headers.getSetCookie?.() ?? [])
    .map(value => value.split(';')[0])
    .join('; ')
  const pageResponse = await fetch(`${origin}/`, { headers: authCookie === '' ? {} : { cookie: authCookie } })
  const page = await pageResponse.text()
  return { origin, page, status: pageResponse.status, stdout, stderr, pid: child.pid }
}

/** 清理临时实例与目录。 */
async function cleanup() {
  if (server !== null) {
    try { server.kill('SIGTERM') } catch { /* 已退出 */ }
    await Promise.race([
      new Promise(resolve => server.once('exit', resolve)),
      sleep(8000),
    ])
    try { server.kill('SIGKILL') } catch { /* 已退出 */ }
    server = null
  }
  if (tempHome !== null) {
    await rm(tempHome, { recursive: true, force: true }).catch(() => {})
    tempHome = null
  }
}

try {
  console.log(`真实 DSH 主目录：${REAL_HOME}`)
  check('web profile 存在', existsSync(PROFILE_DIR), PROFILE_DIR)
  check('插件已安装进 profile', existsSync(PLUGIN_DIR), '先执行 dsh plugin --profile web add <本仓库路径>')
  if (failures.length > 0) throw new Error('前置条件不满足')

  tempHome = await mkdtemp(join(tmpdir(), 'dsh-session-delete-e2e-'))
  // 复制一份 profile 到临时 HOME：之后修复相对符号链接，避免污染真实 profile 文件。
  const sourceProfile = join(REAL_HOME, 'profiles', PROFILE)
  const targetProfile = join(tempHome, 'profiles', PROFILE)
  await cp(sourceProfile, targetProfile, { recursive: true, verbatimSymlinks: true })
  const repaired = await repairSymlinks(sourceProfile, targetProfile)
  console.log(`临时 profile 已复制，修复符号链接 ${repaired} 个`)

  const sampleCount = Math.max(1, Number(process.env.DSH_E2E_SAMPLES ?? 3))
  const samples = await copySampleSessions(sampleCount)
  if (samples.length < 2) throw new Error(`批量用例至少需要 2 个样例会话，当前只复制到 ${samples.length} 个`)
  const sample = samples[0]
  console.log(`样例会话：${samples.map(item => `${item.projectKey}/${item.dirName}`).join('、')}`)

  const { origin, page, status, stdout } = await startServer()
  check('临时实例已启动', origin !== '', origin)
  check('鉴权后的首页可访问', status === 200, `HTTP ${status}`)
  check('宿主插件已挂载', stdout.includes('[dsh-session-delete] 宿主半边已挂载'))

  const resolved = await resolveSessionId(origin, sample.dirName)
  const sessionId = resolved.sessionId
  const inspected = resolved.inspected
  check('inspect 能读到样例会话', sessionId !== null, sessionId ?? '两个命名候选都读不到')

  if (sessionId === null) throw new Error('inspect 失败，后续链路无法继续')
  check('inspect 返回占用大小', Number(inspected.session.sizeBytes) > 0, String(inspected.session.sizeBytes))
  check('inspect 返回回收站策略', typeof inspected.settings?.retentionDays === 'number', JSON.stringify(inspected.settings))

  const badId = await api(origin, `/inspect?sessionId=${encodeURIComponent('../etc/passwd')}`)
  check('拒绝路径穿越的会话 ID', badId.status === 400 && String(badId.payload?.code ?? '').includes('非法'), JSON.stringify(badId.payload))

  const deleted = await api(origin, '/delete', { method: 'POST', body: { sessionId, mode: 'trash' } })
  check('移入回收站成功', deleted.payload.ok === true, JSON.stringify(deleted.payload).slice(0, 160))
  check('会话目录已离开 sessions', !existsSync(sample.targetDir), sample.targetDir)

  const trash1 = await api(origin, '/trash')
  const entry = (trash1.payload.entries ?? []).find(item => item.sessionId === sessionId)
  check('回收站里有该会话', entry !== undefined, `共 ${trash1.payload.entries?.length ?? 0} 条`)
  check('回收站条目带元数据', entry !== undefined && Number(entry.sizeBytes) >= 0 && typeof entry.deletedAt === 'string', JSON.stringify(entry ?? {}).slice(0, 160))

  const restored = await api(origin, '/restore', { method: 'POST', body: { sessionId } })
  check('还原成功', restored.payload.ok === true, JSON.stringify(restored.payload).slice(0, 160))
  check('会话目录已回到 sessions', existsSync(sample.targetDir), sample.targetDir)
  const trash2 = await api(origin, '/trash')
  check('回收站已清空该条目', (trash2.payload.entries ?? []).length === 0)

  const purged = await api(origin, '/delete', { method: 'POST', body: { sessionId, mode: 'purge' } })
  check('彻底删除成功', purged.payload.ok === true, JSON.stringify(purged.payload).slice(0, 160))
  check('彻底删除后目录不存在', !existsSync(sample.targetDir), sample.targetDir)
  const inTrashAfterPurge = await api(origin, '/trash')
  check('彻底删除不进回收站', (inTrashAfterPurge.payload.entries ?? []).length === 0)

  // 批量管理：会话清单 + 批量删除
  const sessionsList = await api(origin, '/sessions')
  check('会话清单接口可用', sessionsList.payload.ok === true && Array.isArray(sessionsList.payload.sessions), `共 ${sessionsList.payload.sessions?.length ?? 0} 个`)
  check('会话清单带大小与分组字段', (sessionsList.payload.sessions ?? []).every(item => typeof item.sessionId === 'string' && typeof item.sizeBytes === 'number' && 'workspace' in item))

  const batchTargets = []
  for (const item of samples.slice(1)) {
    const found = await resolveSessionId(origin, item.dirName)
    if (found.sessionId !== null) batchTargets.push({ ...item, sessionId: found.sessionId })
  }
  check('批量目标会话已就绪', batchTargets.length >= 1, `解析到 ${batchTargets.length} 个`)

  const listIds = new Set((sessionsList.payload.sessions ?? []).map(item => item.sessionId))
  check('会话清单包含样例会话', batchTargets.every(item => listIds.has(item.sessionId)))

  const trashBatch = batchTargets.slice(0, 1)
  const batchTrash = await api(origin, '/batch-delete', { method: 'POST', body: { sessionIds: trashBatch.map(item => item.sessionId), mode: 'trash', stopIfRunning: false } })
  check('批量移入回收站成功', batchTrash.payload.ok === true && batchTrash.payload.summary?.succeeded === trashBatch.length, JSON.stringify(batchTrash.payload.summary))
  check('批量删除后目录消失', trashBatch.every(item => !existsSync(item.targetDir)))
  const trashAfterBatch = await api(origin, '/trash')
  check('回收站收到批量条目', trashBatch.every(item => (trashAfterBatch.payload.entries ?? []).some(entry => entry.sessionId === item.sessionId)))

  if (batchTargets.length >= 2) {
    const purgeTarget = batchTargets[1]
    const batchPurge = await api(origin, '/batch-delete', { method: 'POST', body: { sessionIds: [purgeTarget.sessionId], mode: 'purge', stopIfRunning: false } })
    check('批量彻底删除成功', batchPurge.payload.ok === true && batchPurge.payload.summary?.succeeded === 1, JSON.stringify(batchPurge.payload.summary))
    check('批量彻底删除后目录不存在', !existsSync(purgeTarget.targetDir))
  }

  const badBatch = await api(origin, '/batch-delete', { method: 'POST', body: { sessionIds: ['../etc/passwd'], mode: 'trash' } })
  check('批量接口拒绝非法会话 ID', badBatch.status === 400 && String(badBatch.payload?.code ?? '').includes('非法'), JSON.stringify(badBatch.payload))

  const emptyAfterBatch = await api(origin, '/empty', { method: 'POST', body: { onlyExpired: false } })
  check('清空批量回收站', emptyAfterBatch.payload.ok === true)

  const malformed = await api(origin, '/settings', { method: 'POST', body: { retentionDays: null } })
  check('畸形 retentionDays 回落到默认 30', malformed.payload.ok === true && malformed.payload.settings?.retentionDays === 30, JSON.stringify(malformed.payload.settings))
  const malformedArray = await api(origin, '/settings', { method: 'POST', body: { retentionDays: [] } })
  check('数组 retentionDays 回落到默认 30', malformedArray.payload.ok === true && malformedArray.payload.settings?.retentionDays === 30, JSON.stringify(malformedArray.payload.settings))

  const settings = await api(origin, '/settings', { method: 'POST', body: { retentionDays: 90, sweepOnStartup: false } })
  check('保存回收站策略', settings.payload.ok === true && settings.payload.settings?.retentionDays === 90, JSON.stringify(settings.payload.settings))
  const settingsBack = await api(origin, '/settings')
  check('读回回收站策略', settingsBack.payload.settings?.retentionDays === 90 && settingsBack.payload.settings?.sweepOnStartup === false)

  check('客户端 bundle 进入启动图', page.includes('dsh-session-delete/client.js'), '启动 HTML 中未找到 dsh-session-delete/client.js')
} catch (error) {
  check('端到端流程', false, error instanceof Error ? error.message : String(error))
  if (lastOutput !== '') {
    console.log('\n--- 临时实例输出（用于排障）---')
    console.log(lastOutput.split('\n').slice(-25).join('\n'))
  }
} finally {
  await cleanup()
}

if (failures.length > 0) {
  console.log(`\n失败 ${failures.length} 项：`)
  for (const failure of failures) console.log(` - ${failure}`)
  process.exitCode = 1
} else {
  console.log('\n全部通过。')
}
