/**
 * 生成 README 用的实机界面截图。
 *
 * 约束（见 Issue #13）：
 * - 只在**临时实例**上拍：临时 `DSH_HOME` + 复制 web profile + `--port 0`（随机空闲端口），
 *   绝不占用主端口 3080，也不碰线上实例与真实会话目录。
 * - 画面里的会话是**合成数据**（scripts/lib/fixture.mjs），不含任何真实对话内容。
 * - 截图产物落在 docs/screenshots/，单张体积控制在 ~400KB 以内。
 *
 * 用法：node scripts/screenshots.mjs
 */
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cp, mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile, appendFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { capturePng, dismissOverlays, evaluate, openChrome, sleep, waitFor } from './lib/cdp.mjs'
import { seedFixture } from './lib/fixture.mjs'

const REAL_HOME = join(homedir(), '.dsh')
const PROFILE = 'web'
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT_DIR = join(ROOT, 'docs', 'screenshots')
const DSH = process.env.DSH_CLI ?? 'dsh'
/** 合成工作区的落盘与头部路径：固定短路径，截图不含用户名，重跑结果一致。 */
const DEMO_ROOT = '/tmp/dsh-screenshot-demo'

/** 复制 profile 后，把指向原目录的符号链接改成指向复制品（跨目录相对链接会失效）。 */
async function repairSymlinks(sourceRoot, targetRoot) {
  let repaired = 0
  const walk = async relative => {
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

let tempHome = null
let server = null
let chrome = null

try {
  const targetProfile = join(REAL_HOME, 'profiles', PROFILE)
  if (!existsSync(join(targetProfile, 'node_modules', 'dsh-session-delete'))) throw new Error('插件未安装进 web profile')

  tempHome = await mkdtemp(join(tmpdir(), 'dsh-shot-'))
  const copy = join(tempHome, 'profiles', PROFILE)
  await cp(targetProfile, copy, { recursive: true, verbatimSymlinks: true })
  await repairSymlinks(targetProfile, copy)
  // 换肤插件的欢迎封面会盖住整页，临时 profile 里去掉（只改副本）。
  const manifestPath = join(copy, 'package.json')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  if (Array.isArray(manifest?.dsh?.profile?.bundles)) {
    manifest.dsh.profile.bundles = manifest.dsh.profile.bundles.filter(name => name !== 'dsh-dream-skin')
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  }
  // 启动动画会盖住整页，禁用（只改副本）。
  const patchPath = join(copy, 'cordis.patch.yml')
  if (existsSync(patchPath)) await appendFile(patchPath, '\n# screenshots：禁掉启动动画\n- id: boot-animation\n  disabled: true\n', 'utf8')

  // 合成会话：头部里的工作区路径指向固定短路径，工作区目录也要真实存在。
  const fixture = await seedFixture(tempHome, { cwdHome: DEMO_ROOT, createWorkspaceDirs: false })
  for (const workspace of fixture.workspaces) {
    await mkdir(join(DEMO_ROOT, 'workspaces', workspace.title), { recursive: true })
  }
  console.log(`合成会话 ${fixture.sessionIds.length} 条，工作区 ${fixture.workspaces.length} 个`)

  // --port 0：随机空闲端口，绝不碰主端口 3080。
  server = spawn(DSH, ['--profile', PROFILE, '--port', '0', '--host', '127.0.0.1', '--no-open'], {
    env: { ...process.env, DSH_HOME: tempHome },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stdout = ''
  server.stdout.on('data', chunk => { stdout += String(chunk) })
  const url = await waitFor('dsh web URL', () => stdout.match(/dsh web:\s*(http:\/\/\S+)/)?.[1], 90000)
  const origin = new URL(url).origin
  console.log(`临时实例：${origin}（随机端口，未占用 3080）`)

  const opened = await openChrome(url, { userDataDir: join(tempHome, 'chrome') })
  chrome = opened.chrome
  const page = opened.page
  await dismissOverlays(page)

  const results = []

  /**
   * 截一张图并落盘。
   *
   * 同时记录两样东西，方便自动核对画面内容（截图没法靠肉眼验收）：
   * - 页面可见文本里的关键词命中情况；
   * - 图片字节的 sha256，用来发现「两张图其实一模一样」。
   * @param {string} file - 输出文件名。
   * @param {string} description - 画面说明。
   * @param {string[]} [keywords] - 画面里应当出现的关键词。
   * @returns {Promise<void>} 无返回值。
   */
  const shoot = async (file, description, keywords = []) => {
    const bytes = await capturePng(page, join(OUT_DIR, file))
    await mkdir(OUT_DIR, { recursive: true })
    await writeFile(join(OUT_DIR, file), bytes)
    const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 12)
    const text = String(await evaluate(page, 'document.body.innerText') ?? '')
    const missing = keywords.filter(keyword => !text.includes(keyword))
    results.push({ file, hash, missing })
    console.log(`  ✓ ${file}（${description}）${missing.length === 0 ? '' : ` ⚠ 画面缺少：${missing.join('、')}`}`)
  }

  const rows = await waitFor('侧栏会话行', async () => {
    const count = await evaluate(page, 'document.querySelectorAll(\'[data-row-key^="session:"]\').length')
    return Number(count) >= 2 ? count : undefined
  }, 15000)
  console.log(`侧栏会话行 ${rows} 条`)

  // ① 侧栏：悬停第一条会话行，让行内垃圾桶按钮显出来。
  await evaluate(page, `(() => {
    const row = document.querySelector('[data-row-key^="session:"]')
    if (row === undefined) return false
    row.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    row.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }))
    return true
  })()`)
  await sleep(500)
  await shoot('01-sidebar-row-delete.png', '侧栏会话行内的删除按钮', ['项目演示', '批量删除与回收站功能验证'])

  // ② 单个删除确认弹窗。
  await evaluate(page, `(() => {
    const button = document.querySelector('[data-row-key^="session:"] button[aria-label="删除这个会话"]')
    if (button === undefined) return false
    button.click()
    return true
  })()`)
  const dialog = await waitFor('删除确认弹窗', async () => {
    const text = await evaluate(page, `document.querySelector('[role=dialog][aria-labelledby=dsh-session-delete-dialog-title]')?.textContent ?? null`)
    return text === null ? undefined : text
  }, 5000).catch(() => null)
  if (dialog === null) throw new Error('删除确认弹窗没有出现，无法截图')
  await shoot('02-delete-confirm-dialog.png', '单个会话删除的中文确认弹窗', ['删除会话', '移入回收站', '将清理'])
  await evaluate(page, `(() => {
    const card = document.querySelector('[role=dialog][aria-labelledby=dsh-session-delete-dialog-title]')
    const close = card === null ? undefined : [...card.querySelectorAll('button')].find(node => (node.getAttribute('aria-label') ?? '').includes('取消'))
    if (close !== undefined) { close.click(); return true }
    return false
  })()`)
  await sleep(700)

  // ③ 批量管理模式：会话行前勾选框 + 底部批量操作栏。
  await evaluate(page, `(() => {
    const button = document.querySelector('[data-dsh-session-delete-batch] button')
    if (button === undefined) return false
    button.click()
    return true
  })()`)
  await waitFor('勾选框出现', async () => {
    const count = await evaluate(page, 'document.querySelectorAll(\'input[type=checkbox][aria-label="选择此会话"]\').length')
    return Number(count) >= 2 ? count : undefined
  }, 5000)
  await evaluate(page, `(() => {
    const boxes = [...document.querySelectorAll('input[type=checkbox][aria-label="选择此会话"]')]
    for (const box of boxes.slice(0, 3)) box.click()
    return boxes.length
  })()`)
  await sleep(600)
  await shoot('03-batch-mode.png', '批量管理模式：会话行前勾选框与底部操作栏', ['已选 3 个', '全选可见', '移入回收站'])

  // ④ 批量移入回收站的确认框。
  await evaluate(page, `(() => {
    const bar = document.querySelector('[role=region][aria-label="批量管理"]')
    if (bar === null) return false
    const button = [...bar.querySelectorAll('button')].find(node => (node.textContent ?? '').trim() === '移入回收站')
    if (button === undefined) return false
    button.click()
    return true
  })()`)
  const batchDialog = await waitFor('批量确认框', async () => {
    const text = await evaluate(page, `document.querySelector('[role=dialog][aria-label="确认移入回收站？"]')?.textContent ?? null`)
    return text === null ? undefined : text
  }, 5000).catch(() => null)
  if (batchDialog === null) throw new Error('批量确认框没有出现，无法截图')
  await shoot('04-batch-confirm-dialog.png', '批量移入回收站的确认框', ['将处理 3 个会话', '确认移入回收站'])

  // 确认执行，让回收站里真的有内容，便于截设置页。
  await evaluate(page, `(() => {
    const dialog = document.querySelector('[role=dialog][aria-label="确认移入回收站？"]')
    if (dialog === null) return false
    const button = [...dialog.querySelectorAll('button')].find(node => (node.textContent ?? '').trim() === '确认移入回收站')
    if (button === undefined) return false
    button.click()
    return true
  })()`)
  await sleep(2500)

  // ⑤ 设置页「会话回收站」。
  await evaluate(page, `(() => {
    const button = document.querySelector('button[aria-label="账号菜单"]')
    if (button === undefined) return false
    button.click()
    return true
  })()`)
  await sleep(800)
  await evaluate(page, `(() => {
    const item = [...document.querySelectorAll('[role=menuitem]')].find(node => (node.textContent ?? '').trim() === '设置')
    if (item === undefined) return false
    item.click()
    return true
  })()`)
  await sleep(1500)
  await evaluate(page, `(() => {
    const button = [...document.querySelectorAll('button')].find(node => (node.textContent ?? '').trim() === '会话回收站')
    if (button === undefined) return false
    button.click()
    return true
  })()`)
  await sleep(1500)
  const trashText = String(await evaluate(page, 'document.body.innerText'))
  if (!trashText.includes('会话回收站')) throw new Error('设置页没有找到「会话回收站」分区')
  await shoot('05-trash-settings.png', '插件设置页的「会话回收站」', ['会话回收站', '保留天数', '彻底删除'])

  // ⑥ 清空回收站的二次确认（危险操作先弹确认面板，不直接执行）。
  const armed = await evaluate(page, `(() => {
    const button = [...document.querySelectorAll('button')].find(node => (node.textContent ?? '').trim() === '清空回收站')
    if (button === undefined) return false
    button.click()
    return true
  })()`)
  const emptyConfirm = await waitFor('清空二次确认', async () => {
    const shown = await evaluate(page, `document.body.innerText.includes('确认清空回收站？此操作不可撤销。')`)
    return shown === true ? true : undefined
  }, 4000).catch(() => false)
  if (armed === true && emptyConfirm === true) {
    await sleep(400)
    await shoot('06-empty-trash-confirm.png', '清空回收站的二次确认面板', ['确认清空回收站', '确认清空'])
  } else {
    console.log('  · 跳过 06（清空二次确认面板没有出现）')
  }

  const hashes = results.map(item => item.hash)
  const duplicated = hashes.filter((hash, index) => hashes.indexOf(hash) !== index)
  if (duplicated.length > 0) console.warn(`⚠ 有 ${duplicated.length} 张图内容完全相同，截图步骤可能没生效`)
  const missing = results.flatMap(item => item.missing.map(keyword => `${item.file}:${keyword}`))
  if (missing.length > 0) console.warn(`⚠ 画面缺少关键词：${missing.join('、')}`)
  console.log(`\n截图完成，输出目录：${OUT_DIR}`)
} catch (error) {
  console.error(`截图失败：${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
} finally {
  if (chrome !== null) { try { chrome.kill('SIGKILL') } catch { /* 已退出 */ } }
  if (server !== null) {
    try { server.kill('SIGTERM') } catch { /* 已退出 */ }
    await Promise.race([new Promise(resolveExit => server.once('exit', resolveExit)), sleep(6000)])
    try { server.kill('SIGKILL') } catch { /* 已退出 */ }
  }
  if (tempHome !== null) await rm(tempHome, { recursive: true, force: true }).catch(() => {})
  await rm(DEMO_ROOT, { recursive: true, force: true }).catch(() => {})
}
