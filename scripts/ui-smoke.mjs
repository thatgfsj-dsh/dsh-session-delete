/**
 * 批量管理 UI 冒烟（可选，需要本机 Chrome）：
 * 自建临时 DSH 实例（临时 DSH_HOME + 复制 profile + --port 0），用 headless Chrome 通过 CDP 验证：
 * 1. 工作区标题行出现「批量管理」入口；
 * 2. 点击后批量管理面板打开；
 * 3. 面板列出会话、全选可用；
 * 并保存截图到 /tmp/dsh-session-delete-batch-ui.png。
 *
 * 不触碰线上 dsh web / 真实会话。
 * 用法：node scripts/ui-smoke.mjs
 */
import { spawn } from 'node:child_process'
import { cp, mkdtemp, readdir, rm, mkdir, copyFile, symlink } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REAL_HOME = join(homedir(), '.dsh')
const PROFILE = 'web'
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DSH = process.env.DSH_CLI ?? 'dsh'
const CHROME = process.env.CHROME ?? ['google-chrome', 'google-chrome-stable', 'chromium'].map(name => `/usr/bin/${name}`).find(path => existsSync(path))
const SHOT = '/tmp/dsh-session-delete-batch-ui.png'

const failures = []
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail === '' ? '' : `：${detail}`}`)
  if (!ok) failures.push(`${name}${detail === '' ? '' : `：${detail}`}`)
}
const sleep = ms => new Promise(resolveSleep => setTimeout(resolveSleep, ms))
async function waitFor(label, probe, timeoutMs = 60000, intervalMs = 200) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = await probe()
    if (value !== undefined && value !== null && value !== false) return value
    if (Date.now() >= deadline) throw new Error(`等待超时：${label}`)
    await sleep(intervalMs)
  }
}

let tempHome = null
let server = null
let chrome = null

async function repairSymlinks(sourceRoot, targetRoot) {
  let repaired = 0
  const walk = async (relative) => {
    const targetDir = relative === '' ? targetRoot : join(targetRoot, relative)
    let entries
    try { entries = await readdir(targetDir, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      const relChild = relative === '' ? entry.name : join(relative, entry.name)
      const targetPath = join(targetRoot, relChild)
      if (entry.isSymbolicLink()) {
        const linkTarget = await import('node:fs/promises').then(module => module.readlink(targetPath))
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

async function copySamples(limit) {
  const realSessions = join(REAL_HOME, 'sessions')
  const projects = (await readdir(realSessions, { withFileTypes: true })).filter(entry => entry.isDirectory())
  let copied = 0
  for (const project of projects) {
    const projectDir = join(realSessions, project.name)
    const sessions = (await readdir(projectDir, { withFileTypes: true })).filter(entry => entry.isDirectory())
    for (const session of sessions) {
      if (copied >= limit) return copied
      const sourceDir = join(projectDir, session.name)
      const logs = (await readdir(sourceDir)).filter(name => name.endsWith('.jsonl.zstd'))
      if (logs.length === 0) continue
      const targetDir = join(tempHome, 'sessions', project.name, session.name)
      await mkdir(targetDir, { recursive: true })
      for (const log of logs) await copyFile(join(sourceDir, log), join(targetDir, log))
      copied += 1
    }
  }
  return copied
}

/** 连 CDP。 */
async function connectCdp(browserWs) {
  const socket = new WebSocket(browserWs)
  await new Promise((resolveOpen, reject) => {
    socket.onopen = resolveOpen
    socket.onerror = () => reject(new Error('CDP WebSocket 连接失败'))
  })
  let nextId = 0
  const pending = new Map()
  socket.onmessage = event => {
    const message = JSON.parse(event.data)
    if (message.id !== undefined && pending.has(message.id)) {
      pending.get(message.id)(message)
      pending.delete(message.id)
    }
  }
  const send = (method, params = {}) => new Promise(resolveSend => {
    const id = ++nextId
    pending.set(id, resolveSend)
    socket.send(JSON.stringify({ id, method, params }))
  })
  return { send, close: () => socket.close() }
}

async function evaluate(cdp, expression) {
  const response = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  return response.result?.result?.value
}

try {
  if (CHROME === undefined) throw new Error('本机没有 Chrome，跳过 UI 冒烟')
  const targetProfile = join(REAL_HOME, 'profiles', PROFILE)
  if (!existsSync(join(targetProfile, 'node_modules', 'dsh-session-delete'))) throw new Error('插件未安装进 web profile')

  tempHome = await mkdtemp(join(tmpdir(), 'dsh-sd-ui-'))
  const copy = join(tempHome, 'profiles', PROFILE)
  await cp(targetProfile, copy, { recursive: true, verbatimSymlinks: true })
  const repaired = await repairSymlinks(targetProfile, copy)
  // 去掉换肤类插件的欢迎封面，避免遮住侧栏与面板（只改临时 profile）。
  const packagePath = join(copy, 'package.json')
  const manifest = JSON.parse(await (await import('node:fs/promises')).readFile(packagePath, 'utf8'))
  const bundles = manifest?.dsh?.profile?.bundles
  if (Array.isArray(bundles)) {
    manifest.dsh.profile.bundles = bundles.filter(name => name !== 'dsh-dream-skin')
    await (await import('node:fs/promises')).writeFile(packagePath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  }
  // 启动动画（dsh-boot-animation）会盖住整页，禁用它（只改临时 profile）。
  const patchPath = join(copy, 'cordis.patch.yml')
  if (existsSync(patchPath)) {
    const { appendFile } = await import('node:fs/promises')
    await appendFile(patchPath, '\n# ui-smoke：禁掉启动动画\n- id: boot-animation\n  disabled: true\n', 'utf8')
  }
  const samples = await copySamples(2)
  check('临时 profile 就绪', existsSync(copy), `修复符号链接 ${repaired} 个`)
  check('复制样例会话', samples >= 2, `${samples} 个`)

  server = spawn(DSH, ['--profile', PROFILE, '--port', '0', '--host', '127.0.0.1', '--no-open'], {
    env: { ...process.env, DSH_HOME: tempHome },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stdout = ''
  server.stdout.on('data', chunk => { stdout += String(chunk) })
  const url = await waitFor('dsh web URL', () => stdout.match(/dsh web:\s*(http:\/\/\S+)/)?.[1], 90000)
  const origin = new URL(url).origin

  const chromeDir = join(tempHome, 'chrome')
  chrome = spawn(CHROME, [
    '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${chromeDir}`,
    '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--window-size=1440,960',
    url,
  ], { stdio: ['ignore', 'pipe', 'pipe'] })
  let chromeErr = ''
  chrome.stderr.on('data', chunk => { chromeErr += String(chunk) })
  const browserWs = await waitFor('Chrome DevTools', () => chromeErr.match(/DevTools listening on (ws:\/\/\S+)/)?.[1], 30000)
  const browser = await connectCdp(browserWs)
  const target = await waitFor('页面 target', async () => {
    const response = await fetch(`${browserWs.replace('ws://', 'http://').replace(/\/devtools\/browser\/.*$/, '')}/json/list`)
    const list = await response.json()
    return list.find(item => item.type === 'page' && item.url.startsWith(origin))
  }, 30000)
  const page = await connectCdp(target.webSocketDebuggerUrl)
  await page.send('Runtime.enable')

  await waitFor('页面加载完成', () => evaluate(page, 'document.readyState === "complete"'), 30000)
  await sleep(1500)

  // dream-skin 等换肤插件的欢迎封面可能盖住整页，先点掉再验证。
  const dismissedCover = await evaluate(page, `(() => {
    const nodes = [...document.querySelectorAll('body *')]
    const cover = nodes.find(node => node.children.length === 0 && (node.textContent ?? '').includes('点一下直接进入'))
    if (cover === undefined) return false
    cover.click()
    return true
  })()`)
  if (dismissedCover === true) await sleep(1500)

  const triggerCount = await evaluate(page, 'document.querySelectorAll("[data-dsh-session-delete-batch] button").length')
  check('工作区标题行出现批量管理入口', Number(triggerCount) === 1, `找到 ${triggerCount} 个`)

  await evaluate(page, 'document.querySelector("[data-dsh-session-delete-batch] button").click()')
  await sleep(800)
  const dialog = await evaluate(page, 'document.querySelector("[role=dialog][aria-label=批量管理]") !== null')
  check('批量管理面板打开', dialog === true)

  const rows = await evaluate(page, 'document.querySelectorAll("[role=dialog][aria-label=批量管理] input[type=checkbox]").length')
  check('面板列出会话（含勾选框）', Number(rows) >= 3, `${rows} 个勾选框`)

  const selectedText = await evaluate(page, 'document.querySelector("[role=dialog][aria-label=批量管理]").textContent.includes("已选 0 个")')
  check('面板显示已选计数', selectedText === true)

  // 临时 HOME 没有凭据，会弹「开始使用」引导层；截屏前关掉它。
  const dismissedOnboarding = await evaluate(page, `(() => {
    const candidates = [...document.querySelectorAll('[role="dialog"], [class*="_dialog"], body *')]
      .filter(node => node.children.length > 0 && (node.textContent ?? '').includes('开始使用'))
    for (const node of candidates) {
      const close = [...node.querySelectorAll('button')]
        .find(button => (button.getAttribute('aria-label') ?? '').includes('关闭') || (button.textContent ?? '').trim() === '×')
      if (close !== undefined) { close.click(); return true }
    }
    return false
  })()`)
  if (dismissedOnboarding === true) await sleep(600)
  await sleep(400)
  const shot = await page.send('Page.captureScreenshot', { format: 'png' })
  if (shot.result?.data !== undefined) {
    const { writeFile } = await import('node:fs/promises')
    await writeFile(SHOT, Buffer.from(shot.result.data, 'base64'))
    console.log(`截图：${SHOT}`)
  }
  page.close()
  browser.close()
} catch (error) {
  check('UI 冒烟', false, error instanceof Error ? error.message : String(error))
} finally {
  if (chrome !== null) { try { chrome.kill('SIGKILL') } catch { /* 已退出 */ } }
  if (server !== null) {
    try { server.kill('SIGTERM') } catch { /* 已退出 */ }
    await Promise.race([new Promise(resolveExit => server.once('exit', resolveExit)), sleep(6000)])
    try { server.kill('SIGKILL') } catch { /* 已退出 */ }
  }
  if (tempHome !== null) await rm(tempHome, { recursive: true, force: true }).catch(() => {})
}

if (failures.length > 0) {
  console.log(`\n失败 ${failures.length} 项：`)
  for (const failure of failures) console.log(` - ${failure}`)
  process.exitCode = 1
} else {
  console.log('\nUI 冒烟通过。')
}
