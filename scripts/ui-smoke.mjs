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
const SHOT_AFTER = '/tmp/dsh-session-delete-after-delete.png'
const SHOT_CONFIRM = '/tmp/dsh-session-delete-batch-confirm.png'

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
  // 侧栏只展示工作区记账里的会话：把真实 workspace.json 与投影缓存一并复制到临时 HOME。
  await mkdir(join(tempHome, 'storages'), { recursive: true })
  await copyFile(join(REAL_HOME, 'storages', 'workspace.json'), join(tempHome, 'storages', 'workspace.json'))
  const projcacheSource = join(REAL_HOME, 'storages', 'session_projcache')
  if (existsSync(projcacheSource)) {
    await cp(projcacheSource, join(tempHome, 'storages', 'session_projcache'), { recursive: true, verbatimSymlinks: true })
  }
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

  const enterAt = Date.now()
  await evaluate(page, 'document.querySelector("[data-dsh-session-delete-batch] button").click()')
  const boxes = await waitFor('会话行勾选框出现', async () => {
    const count = await evaluate(page, 'document.querySelectorAll("input[type=checkbox][aria-label=选择此会话]").length')
    return Number(count) >= 1 ? count : undefined
  }, 3000).catch(() => 0)
  const enterMs = Date.now() - enterAt
  check('会话行前面出现勾选框', Number(boxes) >= 1, `${boxes} 个勾选框，${enterMs}ms`)
  check('勾选框在 1.2s 内出现', Number(boxes) >= 1 && enterMs <= 1200, `${enterMs}ms`)

  const toolbar = await evaluate(page, 'document.querySelector("[role=region][aria-label=批量管理]") !== null')
  check('底部批量操作栏出现', toolbar === true)

  await evaluate(page, 'document.querySelector("input[type=checkbox][aria-label=选择此会话]").click()')
  await sleep(300)
  const barText = await evaluate(page, 'document.querySelector("[role=region][aria-label=批量管理]").textContent')
  check('已选计数更新', String(barText).includes('已选 1 个'), String(barText).slice(0, 80))
  check('批量按钮齐全', ['移入回收站', '彻底删除', '退出批量', '全选', '清空选择'].every(label => String(barText).includes(label)))

  // 全选只覆盖当前可见行：点击“全选可见”后已选数量应等于可见勾选框数量。
  const visibleCount = await evaluate(page, 'document.querySelectorAll("input[type=checkbox][aria-label=选择此会话]").length')
  await evaluate(page, `(() => {
    const bar = document.querySelector('[role=region][aria-label=批量管理]')
    const button = [...bar.querySelectorAll('button')].find(node => (node.textContent ?? '').trim() === '全选可见')
    if (button !== undefined) button.click()
  })()`)
  await sleep(300)
  const selectedAfterAll = await evaluate(page, `(() => {
    const text = document.querySelector('[role=region][aria-label=批量管理]').textContent
    const rest = text.split('已选 ')[1]
    return rest === undefined ? -1 : Number.parseInt(rest, 10)
  })()`)
  check('全选可见只选当前可见行', selectedAfterAll === Number(visibleCount), `可见 ${visibleCount}，已选 ${selectedAfterAll}`)
  await evaluate(page, `(() => {
    const bar = document.querySelector('[role=region][aria-label=批量管理]')
    const button = [...bar.querySelectorAll('button')].find(node => (node.textContent ?? '').trim() === '清空选择')
    if (button !== undefined) button.click()
  })()`)
  await sleep(200)
  await evaluate(page, 'document.querySelector("input[type=checkbox][aria-label=选择此会话]").click()')
  await sleep(300)

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
  // 先截一张多选模式下的界面（勾选框 + 底部批量栏）。
  await sleep(400)
  const shotBefore = await page.send('Page.captureScreenshot', { format: 'png' })
  if (shotBefore.result?.data !== undefined) {
    const { writeFile } = await import('node:fs/promises')
    await writeFile(SHOT, Buffer.from(shotBefore.result.data, 'base64'))
    console.log(`截图：${SHOT}`)
  }

  // 真实执行一次「移入回收站」：先弹确认框，再确认删除；验证删除后列表及时刷新、toast 可见。
  const selectedId = await evaluate(page, 'document.querySelector("[data-dsh-session-delete-select]")?.getAttribute("data-dsh-session-delete-select") ?? null')
  check('取到勾选会话的 ID', typeof selectedId === 'string' && selectedId !== '', String(selectedId))
  const clicked = await evaluate(page, `(() => {
    const toolbar = document.querySelector('[role=region][aria-label=批量管理]')
    const button = [...toolbar.querySelectorAll('button')].find(node => (node.textContent ?? '').trim() === '移入回收站')
    if (button === undefined) return false
    button.click()
    return true
  })()`)
  check('点击批量移入回收站', clicked === true)
  const dialogText = await waitFor('批量确认框出现', async () => {
    const text = await evaluate(page, `document.querySelector("[role=dialog][aria-label='确认移入回收站？']")?.textContent ?? null`)
    return text === null ? undefined : text
  }, 3000).catch(() => null)
  check('批量操作弹出确认框', dialogText !== null)
  check('确认框显示数量与大小', dialogText !== null && /将处理 1 个会话/.test(dialogText) && /合计/.test(dialogText), String(dialogText).slice(0, 120))
  const shotConfirm = await page.send('Page.captureScreenshot', { format: 'png' })
  if (shotConfirm.result?.data !== undefined) {
    const { writeFile } = await import('node:fs/promises')
    await writeFile(SHOT_CONFIRM, Buffer.from(shotConfirm.result.data, 'base64'))
    console.log(`截图：${SHOT_CONFIRM}`)
  }
  const confirmed = await evaluate(page, `(() => {
    const dialog = document.querySelector('[role=dialog][aria-label="确认移入回收站？"]')
    const button = dialog === null ? undefined : [...dialog.querySelectorAll('button')].find(node => (node.textContent ?? '').trim() === '确认移入回收站')
    if (button === undefined) return false
    button.click()
    return true
  })()`)
  check('确认执行批量移入回收站', confirmed === true)
  const rowGone = await waitFor('删除后侧栏行消失', async () => {
    const present = await evaluate(page, `document.querySelector('[data-row-key="session:${selectedId}"]') !== null`)
    return present === false
  }, 8000).then(() => true).catch(() => false)
  check('删除后侧栏行及时消失', rowGone === true, `残留行 session:${selectedId}`)
  const toolbarGone = await evaluate(page, 'document.querySelector("[role=region][aria-label=批量管理]") === null')
  check('批量成功后退出多选模式', toolbarGone === true)

  // Toast 必须完整落在视口内（红队发现曾被 CSS 裁到左上角）。
  await sleep(400)
  const noticeRect = await evaluate(page, `(() => {
    const node = document.querySelector('[role=status]')
    if (node === null) return null
    const rect = node.getBoundingClientRect()
    return { x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom, w: rect.width, h: rect.height, iw: window.innerWidth, ih: window.innerHeight }
  })()`)
  check('删除反馈 toast 可见', noticeRect !== null && noticeRect.w > 0 && noticeRect.h > 0 && noticeRect.x >= 0 && noticeRect.y >= 0 && noticeRect.right <= noticeRect.iw + 1 && noticeRect.bottom <= noticeRect.ih + 1, JSON.stringify(noticeRect))

  await sleep(300)
  const shotAfter = await page.send('Page.captureScreenshot', { format: 'png' })
  if (shotAfter.result?.data !== undefined) {
    const { writeFile } = await import('node:fs/promises')
    await writeFile(SHOT_AFTER, Buffer.from(shotAfter.result.data, 'base64'))
    console.log(`截图：${SHOT_AFTER}`)
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
