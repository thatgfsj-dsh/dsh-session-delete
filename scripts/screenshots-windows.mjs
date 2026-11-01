/**
 * 生成 Windows 实例（Wine + Windows DSH）的界面截图。
 *
 * 与 `scripts/screenshots.mjs` 的区别：
 * - 服务端是**真正的 Windows DSH**：Wine 前缀里装着 Windows Node 24 与 Windows DSH 0.2.1-rc.2；
 * - 会话数据是合成的，头部里的 `cwd` 写成 `C:\...` 形式，截图里能看到 Windows 路径；
 * - 浏览器仍用宿主机的 Chrome：Wine 与宿主共享网络栈，宿主可以直接访问 Windows DSH 的端口。
 *
 * 前置（见 README「Windows 验证」）：
 *   - Wine 前缀默认 ~/.wine-nodetest，里面已装好 `C:\node24\node.exe` 与
 *     `C:\npm-global\node_modules\@deepseek-ai\dsh`；
 *   - Windows 侧 profile `C:\dsh-shot-home\profiles\web` 里已装好本插件。
 *
 * 用法：node scripts/screenshots-windows.mjs
 */
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { capturePng, dismissOverlays, evaluate, openChrome, sleep, waitFor } from './lib/cdp.mjs'
import { joinWin, seedFixture } from './lib/fixture.mjs'

const WINEPREFIX = process.env.WINEPREFIX ?? join(homedir(), '.wine-nodetest')
const DRIVE = join(WINEPREFIX, 'drive_c')
const WIN_HOME = 'C:\\dsh-shot-home'
const FS_HOME = join(DRIVE, 'dsh-shot-home')
const WIN_NODE = 'C:\\node24\\node.exe'
const WIN_DSH_BIN = 'C:\\npm-global\\node_modules\\@deepseek-ai\\dsh\\lib\\bin.js'
const LOG = join(DRIVE, 'dsh-shot.log')
const RUN_CMD = join(DRIVE, 'run-dsh-shot.cmd')
const OUT_DIR = join(process.cwd(), 'docs', 'screenshots')

/** Windows 路径 → Wine 前缀里的真实路径。 */
const toFs = winPath => join(DRIVE, winPath.replace(/^[A-Za-z]:\\?/, '').replace(/\\/g, '/'))

const sleep2 = sleep

let chrome = null
try {
  // Windows profile：缺失时从 `C:\dsh-test-home` 复制一份（含已装好的插件）。
  const profileDir = toFs(`${WIN_HOME}\\profiles\\web`)
  if (!existsSync(join(profileDir, 'node_modules', 'dsh-session-delete'))) {
    const source = toFs('C:\\dsh-test-home\\profiles\\web')
    if (!existsSync(join(source, 'node_modules', 'dsh-session-delete'))) {
      throw new Error('Wine 前缀里没有可用的 Windows profile：先按 README「Windows 验证」装好插件')
    }
    await mkdir(profileDir, { recursive: true })
    await cp(source, profileDir, { recursive: true })
  }
  // 用本仓库当前源码覆盖插件，保证截图与代码一致。
  const pluginDir = join(profileDir, 'node_modules', 'dsh-session-delete')
  for (const file of ['index.js', 'client.js', 'package.json', 'cordis.patch.yml']) {
    await cp(join(process.cwd(), file), join(pluginDir, file))
  }

  // 合成会话：落盘在 Wine 前缀里（POSIX 路径），头部写 Windows 路径。
  // 只清数据目录，保留 profile（插件装在里面）。
  for (const dir of ['sessions', 'storages', 'workspaces']) {
    await rm(join(FS_HOME, dir), { recursive: true, force: true })
  }
  const fixture = await seedFixture(FS_HOME, {
    cwdJoin: joinWin,
    cwdHome: WIN_HOME,
    workspaces: [
      { id: 'ws-win-01', title: 'Windows 项目演示', count: 5 },
      { id: 'ws-win-02', title: 'Windows 工具仓库', count: 4 },
    ],
  })
  console.log(`Windows 合成会话 ${fixture.sessionIds.length} 条`)

  // 启动 Windows DSH（--port 0：随机端口，不占用主端口）。
  await writeFile(RUN_CMD, [
    '@echo off',
    `set PATH=${WIN_NODE.replace(/node\.exe$/i, '')};%PATH%`,
    `set DSH_HOME=${WIN_HOME}`,
    `${WIN_NODE} ${WIN_DSH_BIN} web --port 0 --host 127.0.0.1 --no-open > C:\\dsh-shot.log 2>&1`,
    '',
  ].join('\r\n'), 'utf8')
  await rm(LOG, { force: true })
  const server = spawn('wine', ['cmd', '/c', 'C:\\run-dsh-shot.cmd'], {
    env: { ...process.env, WINEPREFIX, WINEDEBUG: '-all', DISPLAY: '' },
    detached: true,
    stdio: 'ignore',
  })
  server.unref()
  try {
    const url = await waitFor('Windows DSH web URL', async () => {
      const text = await readFile(LOG, 'utf8').catch(() => '')
      return text.match(/dsh web:\s*(http:\/\/\S+)/)?.[1]
    }, 180000, 1000)
    console.log(`Windows 实例：${url}`)

    const opened = await openChrome(url)
    chrome = opened.chrome
    const page = opened.page
    await dismissOverlays(page)

    const rows = await waitFor('侧栏会话行', async () => {
      const count = await evaluate(page, 'document.querySelectorAll(\'[data-row-key^="session:"]\').length')
      return Number(count) >= 2 ? count : undefined
    }, 20000)
    console.log(`Windows 侧栏会话行 ${rows} 条`)

    // 悬停会话行，露出行内垃圾桶按钮。
    await evaluate(page, `(() => {
      const row = document.querySelector('[data-row-key^="session:"]')
      if (row === undefined) return false
      row.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
      row.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }))
      return true
    })()`)
    await sleep2(500)
    await mkdir(OUT_DIR, { recursive: true })
    const bytes = await capturePng(page, join(OUT_DIR, '07-windows-instance.png'))
    await writeFile(join(OUT_DIR, '07-windows-instance.png'), bytes)
    const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 12)
    const text = String(await evaluate(page, 'document.body.innerText') ?? '')
    const missing = ['Windows 项目演示', 'Windows 路径兼容性回归'].filter(keyword => !text.includes(keyword))
    console.log(`  ✓ 07-windows-instance.png（Windows DSH 实例）${missing.length === 0 ? '' : ` ⚠ 画面缺少：${missing.join('、')}`}`)
    console.log(`  哈希 ${hash}`)
  } finally {
    try { spawn('wineserver', ['-k'], { env: { ...process.env, WINEPREFIX } }).unref() } catch { /* 已停 */ }
  }
} catch (error) {
  console.error(`Windows 截图失败：${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
} finally {
  if (chrome !== null) { try { chrome.kill('SIGKILL') } catch { /* 已退出 */ } }
  // 保留 profile，只清本次造的数据。
  for (const dir of ['sessions', 'storages', 'workspaces']) {
    await rm(join(FS_HOME, dir), { recursive: true, force: true }).catch(() => {})
  }
}
