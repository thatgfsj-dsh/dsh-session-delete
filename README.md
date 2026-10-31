# dsh-session-delete

**全中文的 DeepSeek Harness（DSH）会话删除插件**：在侧栏会话行直接删除会话，删除先进插件设置页的回收站，可还原或彻底删除。

> DSH 官方只有「归档」，归档只把会话从侧栏藏起来，日志仍留在磁盘上。本插件补上真正的删除，并把「删掉」与「清空磁盘」分开：删除默认进回收站，彻底删除才是不可恢复的。

## 功能

- **会话行内删除按钮**：悬停会话行，点击垃圾桶图标即可删除。
- **会话行 `⋯` 菜单「删除会话…」**：与行内按钮同一套逻辑。
- **中文确认弹窗**：显示会话标题、ID、工作区、占用空间、运行状态、子代理数量、将清理的内容。
- **运行中保护**：运行中的会话默认拒绝删除；勾选「先停止运行」后走官方 `workspace/session-stop` 停止回合、子代理、后台任务与定时提醒，再删除。
- **子代理整树**：有子代理会话时默认一并删除；任一子代理仍在运行则整体拒绝，避免留下半棵树。
- **回收站**（插件设置页「会话回收站」）：列表、还原、彻底删除、清空、保留天数（7/15/30/90 天或永久）、启动时清理、用量统计。
- **即时刷新**：删除后广播 `api-session/removed`，侧栏行立即消失；还原后主动刷新会话列表。
- **失败可解释**：分步执行并记录每一步；可回滚项回滚；返回中文错误与残留文件清单，不静默失败。

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
# 单元测试（纯函数、事务顺序、回收站、路径安全）
node --test

# 隔离环境端到端（需要先把本仓库装进某个 web profile）
node tests/e2e.mjs
```

端到端脚本会：创建临时 `DSH_HOME`、复制一个真实会话到临时目录、用随机端口启动 `dsh web`，然后调用
`inspect → delete(trash) → trash → restore → delete(purge) → settings` 全链路并核对磁盘残留，最后清理临时目录。
它不会碰你的真实会话，也不会重启你正在使用的 `dsh web`。

### 验证状态

- 宿主半边：单测 35 项全绿；隔离环境 HTTP 全链路（inspect/delete/trash/restore/purge/settings）通过。
- 客户端半边：headless Chrome（临时实例）实测行内按钮、`⋯` 菜单「删除会话…」、中文确认弹窗、回收站列表/还原/彻底删除均可用，控制台无 error / exception；manifest、slot 契约、bundle 组合静态与运行时检查通过。
- **仍需真机点验**：运行中 / 运行中子代理状态下的弹窗、明暗主题切换、删除当前会话后的主视图清空（已实现，调用官方 `uiWorkspace.clearMain()`）、真实鼠标操作。

## 目录结构

```
index.js                    宿主入口：路由注册、启动清理
src/host/session-meta.mjs   元数据采集（持久化/活体/工作区/子代理树/运行态/大小）
src/host/stop.mjs           停止运行中会话并等待静默
src/host/detach.mjs         摘活体、清工作区/归档/置顶、清投影缓存、还原登记
src/host/trash.mjs          回收站存储与策略
src/host/execute.mjs        删除事务编排、回滚、结果汇总
src/host/{http,errors,paths,fs-util,audit}.mjs  基础设施
client.js                   行内按钮 / 菜单项 / 确认弹窗 / 设置页回收站
locale/{zh,en}.json         展示元数据（两份均为中文）
tests/                      单元测试与隔离端到端脚本
```

## 许可

MIT
