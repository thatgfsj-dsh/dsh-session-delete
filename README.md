# dsh-session-delete

**全中文的 DeepSeek Harness（DSH）会话删除插件**：在侧栏会话行直接删除会话，删除先进插件设置页的回收站，可还原或彻底删除。

> DSH 官方只有「归档」，归档只把会话从侧栏藏起来，日志仍留在磁盘上。本插件补上真正的删除，并把「删掉」与「清空磁盘」分开：删除默认进回收站，彻底删除才是不可恢复的。

## 功能

- **会话行内删除按钮**：悬停会话行，点击垃圾桶图标即可删除。
- **会话行 `⋯` 菜单「删除会话…」**：与行内按钮同一套逻辑。
- **中文确认弹窗**：显示会话标题、ID、工作区、占用空间、运行状态、子代理数量、将清理的内容。
- **运行中保护**：运行中的会话默认拒绝删除；勾选「先停止运行」后走官方 `workspace/session-stop` 停止回合、子代理、后台任务与定时提醒，再删除。
- **子代理整树**：有子代理会话时默认一并删除；任一子代理仍在运行则整体拒绝，避免留下半棵树。
- **批量管理**（v0.1.4）：点侧栏「工作区」标题行右侧图标进入多选模式，**会话行前面直接出现勾选框**；底部浮动栏提供「全选可见 / 清空 / 先停止运行中会话 / 批量移入回收站 / 彻底删除 / 退出」。全选只覆盖**当前可见行**，移入回收站/彻底删除都会弹出确认框（数量、总大小、工作区分布、运行中/归档/子代理数）；逐条报告失败并保留失败项选择。
- **回收站**（插件设置页「会话回收站」）：列表、还原、彻底删除、清空、保留天数（7/15/30/90 天或永久）、启动时清理、用量统计。
- **即时刷新**：删除后广播 `api-session/removed`，侧栏行立即消失；还原后主动刷新会话列表。
- **失败可解释**：分步执行并记录每一步；可回滚项回滚；返回中文错误与残留文件清单，不静默失败。

## Windows

插件已做 Windows 适配，客户端 UI 与平台无关，主要改动在宿主：

- 主目录解析对齐官方 `dsh-home-paths`（`$DSH_HOME` → `~/.dsh`，支持 `~`、resolve 成绝对路径，不依赖 `$HOME`）。
- 会话 ID 额外拒绝 Windows 非法字符（`<>:"|?*`、控制字符）、结尾点/空格与保留设备名（`CON`/`NUL`/`COM1`…）。
- 回收站路径包含判断改用 `path.relative`（盘符大小写、`..`、混合分隔符都正确）。
- 搬移/删除对 Windows 的 `EPERM`/`EBUSY`/`EACCES` 做退避重试；只读属性会先清再删；跨盘仍走「复制 → 逐文件校验 → 删源」。
- 审计日志滚动先删旧 `.1` 再改名（Windows 不允许 rename 覆盖已存在文件）。

安装与 Linux 相同：`dsh plugin --profile web add <本仓库路径>`（Windows 上需要 `pnpm` 在 `PATH`；若插件管理器的 pnpm 解析异常，可手动把包放进 `%DSH_HOME%\profiles\web\node_modules\dsh-session-delete`，并把包名加进 profile 的 `dependencies` 与 `dsh.profile.bundles`）。

### Windows 验证（Wine，可选）

本仓库已在 Wine 10 + Windows Node 24.21 + Windows DSH 0.2.1-rc.2 下实测：

- `node --test`：47 项全绿（Windows 专属用例：盘符/大小写包含判断、非法 ID、只读文件递归删除、同盘 rename 搬移）；
- 宿主冒烟：`/sessions`、`/inspect`、`/delete`（trash/purge）、`/trash`、`/restore`、`/batch-delete`、`/empty`、非法 ID 全部通过；
- 复现：`node scripts/wine-host-smoke.mjs`（脚本头部注释写明 Wine 侧前置：Windows Node、Windows DSH、插件装进 `C:\dsh-test-home` 的 web profile）。

注意：会话与回收站都位于 `%DSH_HOME%` 内，正常永远同盘；只有把 DSH_HOME 指到别的盘时才可能触发跨盘复制。杀软/索引器短暂占用目录时删除会自动退避重试，仍失败会给出可行动错误。

## 安装

插件要求 DSH `0.2.x`（`engines.dsh: ">=0.2.0-rc.1 <0.3.0-0"`）。

```bash
# 从本地目录（开发时推荐，改完文件不用重装）
dsh plugin --profile web add /absolute/path/to/dsh-session-delete

# 从 tarball
pnpm pack
dsh plugin --profile web add /absolute/path/to/dsh-session-delete-0.1.0.tgz
```

安装后**重启** `dsh web`（宿主插件与浏览器 bundle 需要重启加载）。

卸载：

```bash
dsh plugin --profile web remove dsh-session-delete
```

## 使用

1. **删除**：在侧栏会话行悬停，点垃圾桶；或打开会话行 `⋯` 菜单点「删除会话…」。
2. 在弹窗里确认会话信息，选择 **移入回收站**（默认）或 **彻底删除**；运行中的会话需先勾选「先停止运行」。
3. **还原 / 彻底删除**：打开 设置 →「会话回收站」，每条记录可还原或彻底删除；也可以清空回收站、调整保留天数。
4. **批量管理**：点侧栏「工作区」标题行最右侧的清单图标进入多选模式 → 在会话行前面勾选（点整行也可切换）→ 底部浮动栏选「移入回收站」或「彻底删除」→ 在确认框里核对数量/大小/范围后确认。运行中的根会话可勾选栏里的「先停止运行中的会话」；有运行中子代理的会话会被整体拒绝。再点标题行图标或「退出批量」结束。

### 删除会清理什么

| 对象 | 位置 | 处理 |
| --- | --- | --- |
| 会话日志目录 | `~/.dsh/sessions/<工作区键>/<会话 ID>/` | 移入回收站或删除 |
| 活体会话（内存） | 会话 store | 官方 `liveEntryFor` + `detachEntered` 摘除并广播 |
| 工作区记账 | `workspace.json` 的 `sessionIds` | 从各工作区摘除 |
| 归档集合 | `workspace.json` 的 `archivedSessionIds` | 取消归档 |
| 置顶集合 | `workspace.json` 的 `pinnedSessionIds` | 取消置顶 |
| 投影缓存 | `storages/session_projcache/sessions/<ID>.json` + 域记录 | 域记录与分片一起删（兼容两种命名） |
| 子代理会话 | 独立日志与 Session | 默认整树删除 |

> 本期**不**清理内容寻址附件与会话产出的工作区文件（误删风险高，留待后续版本）。

### 数据目录

```
$DSH_HOME/session-delete/
  settings.json              # 回收站策略（保留天数、启动清理）
  trash/<trashId>/metadata.json
  trash/<trashId>/payload/   # 被删除会话的原始目录
```

审计日志：`$DSH_HOME/logs/dsh-session-delete.log`（每次删除/还原/清空/策略变更一行 JSON）。

## 安全设计

- **删除语义与顺序**：回收站模式先搬目录（提交点）再摘活体，摘活体失败会把目录搬回；彻底删除则先摘活体再删盘，避免侧栏「删了又回来」。
- **默认回收站**：彻底删除必须在弹窗或回收站里二次确认。
- **可回滚**：移入回收站成功但摘活体失败时，把目录搬回原位；跨盘搬移用「复制 → 逐文件校验 → 删源」。
- **串行写**：删除/还原/清空/策略写操作在进程内排队，避免并发写坏 `workspace.json`。
- **路径校验**：会话 ID 白名单校验；回收站元数据里的原路径必须落在会话目录下，条目目录必须在回收站根下；拒绝路径穿越。
- **幂等**：会话已不存在、已在回收站、重复点击都返回明确状态，不产生副作用。

## 兼容性

- 目标：DSH `0.2.x`（开发与验证环境 `0.2.1-rc.2`）。
- 不兼容 `0.1.x`。
- 依赖官方内部摘除通道 `liveEntryFor` / `detachEntered`：当前版本存在；缺失时插件降级为「删盘 + 提示需重启宿主」，并写入结果警告。

## 开发与测试

```bash
# 客户端 bundle 由 src/client/*.js 生成（改了源码后必须重新生成）
node scripts/build-client.mjs
node scripts/build-client.mjs --check   # 只校验 client.js 是否与源码同步

# 单元测试（纯函数、事务顺序、回收站、路径安全、批量、会话清单）
node --test

# 隔离环境端到端（需要先把本仓库装进某个 web profile；自建临时实例，不碰线上）
node tests/e2e.mjs

# 批量管理 UI 冒烟（可选，需要本机 Chrome；同样自建临时实例，不碰线上）
node scripts/ui-smoke.mjs

# Windows（Wine）宿主冒烟（可选，脚本头注释写明 Wine 侧前置）
node scripts/wine-host-smoke.mjs
```

端到端脚本会：创建临时 `DSH_HOME`、复制一个真实会话到临时目录、用随机端口启动 `dsh web`，然后调用
`inspect → delete(trash) → trash → restore → delete(purge) → settings` 全链路并核对磁盘残留，最后清理临时目录。
它不会碰你的真实会话，也不会重启你正在使用的 `dsh web`。

### 验证状态

- 宿主半边：单测 35 项全绿；隔离环境 HTTP 全链路（inspect/delete/trash/restore/purge/settings）通过。
- 客户端半边：headless Chrome（临时实例）实测行内按钮、`⋯` 菜单「删除会话…」、中文确认弹窗、回收站列表/还原/彻底删除均可用，控制台无 error / exception；manifest、slot 契约、bundle 组合静态与运行时检查通过。
- v0.1.1 批量管理：宿主接口与面板逻辑已测；标题行入口通过 DOM 锚点挂载（官方无公开插槽），官方 UI 大改版时可能失效，失效后会自动降级到侧栏底部入口。
- v0.1.4 批量管理 UI 已用 headless Chrome 在自建临时实例上实测：标题行入口、会话行勾选框、底部批量栏、全选仅覆盖可见行、确认框、删除后侧栏行及时消失、toast 完整可见（见 `node scripts/ui-smoke.mjs`）。
- 会话行勾选框通过注入官方会话行 DOM（`data-row-key="session:<id>"`）实现：官方 leading 插槽只在空闲行挂载且会被状态点占用，覆盖不全；注入点随官方 UI 结构变化可能失效，失效时底部批量栏仍可用（可全选可见）。
- **仍需真机点验**：批量面板拖拽/滚动交互、运行中 / 运行中子代理状态下的弹窗、明暗主题切换、删除当前会话后的主视图清空（已实现，调用官方 `uiWorkspace.clearMain()`）、真实鼠标操作。

## 目录结构

```
index.js                      宿主入口：路由注册、启动清理
src/host/session-meta.mjs     元数据采集（持久化/活体/工作区/子代理树/运行态/大小）
src/host/stop.mjs             停止运行中会话并等待静默
src/host/detach.mjs           摘活体、清工作区/归档/置顶、清投影缓存、还原登记
src/host/trash.mjs            回收站存储与策略
src/host/execute.mjs          删除事务编排、回滚、结果汇总
src/host/sessions-list.mjs    批量管理用的轻量会话清单
src/host/batch.mjs            批量删除参数校验与逐条执行
src/host/{http,errors,paths,fs-util,audit}.mjs  基础设施
src/client/base.js            词典、工具函数、样式、共享 store
src/client/delete-ui.js       行内按钮 / 菜单项 / 确认弹窗 / 设置页回收站
src/client/batch-ui.js        批量管理：标题行入口 + 会话行勾选 + 底部操作栏
src/client/entry.js           slot 注册与 apply
client.js                     由上面四个部件生成（勿手改）
scripts/build-client.mjs      客户端构建脚本
locale/{zh,en}.json           展示元数据（两份均为中文）
tests/                        单元测试与隔离端到端脚本
```

## 许可

MIT
