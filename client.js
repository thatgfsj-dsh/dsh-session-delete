/**
* 本文件由 scripts/build-client.mjs 从 src/client/*.js 自动生成，请勿直接修改。
* 修改请改 src/client/ 下的源码，然后运行：node scripts/build-client.mjs
*/
window.__ModuleLoader__.load({ id: 'dsh-session-delete', factory(require) { const React = require('react')
const ReactDOM = require('react-dom')
const h = React.createElement
const { useCallback, useEffect, useRef, useState, useSyncExternalStore } = React
const NS = 'sessionDelete'
const API = '/api/dsh-session-delete'
/** 词典（zh/en 两份内容相同，宿主切任何语言都显示中文）。 */
const TEXT = { 'action.delete': '删除会话…', 'action.deleteHint': '删除这个会话', 'dialog.title': '删除会话「{title}」？', 'dialog.titleFallback': '（无标题会话）', 'dialog.loading': '正在读取会话信息…', 'dialog.loadFailed': '读取会话信息失败：{detail}',
'field.sessionId': '会话 ID', 'field.workspace': '所属工作区', 'field.size': '占用空间', 'field.state': '运行状态', 'field.state.idle': '空闲', 'field.state.running': '运行中', 'field.state.runningHint': '会话正在运行，不能直接删除',
'field.state.live': '已加载到内存', 'field.state.cold': '未加载', 'field.subagents': '子代理会话', 'field.subagents.none': '无', 'field.subagents.some': '{n} 个（将一并删除）', 'field.subagents.running': '{n} 个，其中 {running} 个正在运行',
'field.subagents.runningHint': '有 {n} 个子代理会话正在运行，等它们结束后再删除。', 'field.current': '当前打开', 'field.current.yes': '是（删除后回到空态）', 'cleanup.title': '本次将清理', 'cleanup.log': '会话日志目录（{size}）',
'cleanup.projection': '投影缓存（域记录 + 分片文件）', 'cleanup.workspace': '工作区记账、归档与置顶标记', 'cleanup.live': '内存中的活体会话', 'cleanup.subagents': '子代理会话日志（{n} 个）', 'cleanup.trash': '移入回收站，可在「设置 → 会话回收站」还原',
'cleanup.purge': '直接删除，不进回收站，无法恢复', 'trash.explain': '删除后先进回收站，保留 {days} 天；彻底删除不进回收站。', 'trash.explainForever': '删除后先进回收站，永久保留，直到你在设置页彻底删除。', 'stop.checkbox': '先停止运行，再移入回收站', 'stop.checkboxPurge': '先停止运行，再彻底删除',
'stop.needStop': '请先勾选「先停止运行」，或等会话跑完', 'button.cancel': '取消', 'button.trash': '移入回收站', 'button.purge': '彻底删除', 'button.purgeConfirm': '确认彻底删除', 'button.close': '关闭', 'button.retry': '重试', 'dialog.busy.trash': '正在移入回收站…',
'dialog.busy.purge': '正在彻底删除…', 'dialog.failed': '删除失败：{detail}', 'dialog.warnings': '已完成，但有 {n} 条警告', 'dialog.leftovers': '仍有 {n} 个文件未清理', 'notice.trashed': '会话「{title}」已移入回收站', 'notice.purged': '会话「{title}」已彻底删除',
'notice.alreadyGone': '会话已不存在，无需删除', 'notice.alreadyTrash': '会话已在回收站里', 'settings.title': '会话回收站', 'settings.description': '删除的会话先放在这里，可以还原或彻底删除。位置：$DSH_HOME/session-delete/trash。',
'settings.usage': '共 {count} 条 · 占用 {size}', 'settings.empty': '回收站是空的', 'settings.refresh': '刷新', 'settings.loading': '正在读取回收站…', 'settings.loadFailed': '读取回收站失败：{detail}', 'settings.column.title': '会话',
'settings.column.workspace': '工作区', 'settings.column.deletedAt': '删除时间', 'settings.column.size': '大小', 'settings.column.actions': '操作', 'settings.untitled': '（无标题会话）', 'settings.restore': '还原', 'settings.purge': '彻底删除',
'settings.purgeConfirm': '确认彻底删除？', 'settings.restored': '已还原会话', 'settings.purged': '已彻底删除', 'settings.actionFailed': '操作失败：{detail}', 'settings.policy': '保留策略', 'settings.retention': '保留天数',
'settings.retention.7': '7 天', 'settings.retention.15': '15 天', 'settings.retention.30': '30 天', 'settings.retention.90': '90 天', 'settings.retention.0': '永久保留', 'settings.retentionHint': '超过保留天数的条目会在宿主启动时自动清理。',
'settings.sweepOnStartup': '启动时自动清理过期条目', 'settings.sweepNow': '立即清理', 'settings.emptyTrash': '清空回收站', 'settings.selectAll': '全选', 'settings.batchRestore': '批量还原', 'settings.batchRestoreDone': '已还原 {n} 条',
'settings.selectedCount': '已选 {n} 条', 'settings.confirmEmptyYes': '确认清空', 'settings.confirmPurgeYes': '确认彻底删除', 'settings.confirmEmptyHint': '确认清空回收站？此操作不可撤销。', 'settings.confirmPurgeHint': '确认彻底删除这条回收站记录？此操作不可撤销。',
'settings.confirmCancel': '取消', 'settings.emptyConfirm': '确认清空回收站？此操作不可撤销。', 'settings.sweepDone': '已清理 {n} 条过期条目', 'settings.emptyDone': '已清空回收站（{n} 条）', 'settings.settingsFailed': '保存设置失败：{detail}',
'settings.subagents': '含 {n} 个子代理会话', 'settings.partial': '条目不完整（上次删除/还原中断），只能彻底删除或再次还原补齐', 'settings.partialShort': '不完整', 'settings.partialRestoreBlocked': '该条目不完整，不能还原', 'settings.archived': '已归档',
'settings.pinned': '已置顶', 'common.yes': '是', 'common.no': '否', 'batch.open': '批量管理', 'batch.title': '批量管理', 'batch.clear': '清空选择', 'batch.selected': '已选 {n} 个', 'batch.stop': '先停止运行中的会话', 'batch.trash': '移入回收站',
'batch.purge': '彻底删除', 'batch.loadFailed': '读取会话失败：{detail}', 'batch.none': '请先勾选会话', 'batch.working': '正在处理 {total} 个会话…', 'batch.summary': '成功 {ok} 个，失败 {fail} 个', 'batch.selectAllVisible': '全选可见',
'batch.selectAllCapped': '一次最多处理 200 个会话，已选中前 200 个', 'batch.confirm.trashTitle': '确认移入回收站？', 'batch.confirm.purgeTitle': '确认彻底删除？', 'batch.confirm.summary': '将处理 {n} 个会话，合计 {size}。',
'batch.confirm.workspaces': '工作区分布：{list}', 'batch.confirm.breakdown': '其中：运行中 {running} 个、已归档 {archived} 个、含子代理 {subagents} 个', 'batch.confirm.stopOn': '已勾选「先停止运行中的会话」',
'batch.confirm.stopOff': '未勾选「先停止运行中的会话」，运行中的会话会被拒绝', 'batch.confirm.trashNote': '删除后可在「设置 → 会话回收站」还原。', 'batch.confirm.purgeWarning': '彻底删除不进回收站，删除后无法恢复。', 'batch.confirm.trashConfirm': '确认移入回收站',
'batch.confirm.purgeConfirm': '确认彻底删除', 'batch.confirm.cancel': '取消', 'batch.failureLine': '会话「{title}」（{id}）：{detail}', 'batch.failedKept': '失败项已保留勾选，可直接重试', 'batch.failures': '失败项：', 'batch.unGroupedTitle': '未分组',
'batch.refresh': '刷新', 'batch.close': '关闭', 'batch.exit': '退出批量', 'batch.checkbox': '选择此会话', 'batch.hostUnavailable': '宿主接口不可用：请重启 dsh web 后重试（批量接口需要宿主 0.1.1+）', }
const en = TEXT
/** 把字节数变成人话。 */
function formatBytes(bytes) { const value = Number(bytes)
if (!Number.isFinite(value) || value <= 0) return '0 B'
if (value < 1024) return `${Math.round(value)} B`
const units = ['KB', 'MB', 'GB', 'TB']
let size = value / 1024
let index = 0
while (size >= 1024 && index < units.length - 1) { size /= 1024
index += 1
}
return `${size >= 100 ? Math.round(size) : size.toFixed(1)} ${units[index]}`
}
/** 截断长 ID，保留头尾。 */
function shortId(id) { const value = String(id ?? '')
if (value.length <= 22) return value
return `${value.slice(0, 12)}…${value.slice(-6)}`
}
/** 本地时间字符串。 */
function formatTime(iso) { const time = Date.parse(String(iso ?? ''))
if (!Number.isFinite(time)) return '—'
try { return new Date(time).toLocaleString('zh-CN', { hour12: false })
} catch { return new Date(time).toISOString()
}
}
/** 统一取错误文本。 */
function errorText(payload, fallback) { if (payload === null || payload === undefined) return fallback
const detail = typeof payload.detail === 'string' && payload.detail !== '' ? payload.detail : ''
const message = typeof payload.message === 'string' && payload.message !== '' ? payload.message : ''
if (detail !== '' && message !== '') return `${message}（${detail}）`
return message || detail || fallback
}
/** GET 一个插件接口。 */
async function apiGet(path, params) { const url = new URL(`${API}${path}`, window.location.origin)
for (const [key, value] of Object.entries(params ?? {})) { if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value))
}
const response = await fetch(url.toString(), { credentials: 'same-origin', headers: { accept: 'application/json' } })
return await response.json().catch(() => ({ ok: false, message: `HTTP ${response.status}` }))
}
/** POST 一个插件接口。 */
async function apiPost(path, body) { const response = await fetch(`${API}${path}`, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json', accept: 'application/json' },
body: JSON.stringify(body ?? {}), })
return await response.json().catch(() => ({ ok: false, message: `HTTP ${response.status}` }))
}
/** 取客户端 sessions 服务：优先注入的 `ctx.sessions`，退回 `ctx.get`。 */
function sessionsService(ctx) { try { return ctx.sessions ?? ctx.get('sessions')
} catch { return undefined
}
}
/** 主动拉一次会话列表；返回是否真的发起了刷新。 */
function refreshOnce(ctx) { const sessions = sessionsService(ctx)
if (sessions === undefined) return false
try { if (typeof sessions.refresh === 'function') { void sessions.refresh()
return true
}
if (typeof sessions.manager?.refreshList === 'function') { void sessions.manager.refreshList()
return true
}
} catch {
/* 刷新失败不影响删除结果 */
}
return false
}
/**
* 删除/还原后让侧栏列表重新拉一次（冷会话没有活体事件可依赖）。
* 宿主广播与列表拉取有先后，这里做几次短重试，避免残留行点开 404。
*/
function refreshSessionList(ctx) { refreshOnce(ctx)
setTimeout(() => { refreshOnce(ctx) }, 350)
setTimeout(() => { refreshOnce(ctx) }, 1200)
}
/** 删掉的正好是当前打开的会话时，把主视图清回空态（官方归档也是这么做的）。 */
function clearMainIfCurrent(ctx, sessionId) { let ui
try { ui = ctx.uiWorkspace ?? ctx.get('uiWorkspace')
} catch { return
}
if (ui === undefined || typeof ui.clearMain !== 'function') return
try { if (ui.mainReference?.sessionId === sessionId) ui.clearMain()
} catch {
/* 官方主视图接口变化时忽略；侧栏刷新仍会执行 */
}
}
const dialogStore = { value: null, listeners: new Set(), open(request) { this.value = request
this.emit()
}, close() { this.value = null
this.emit()
}, emit() { for (const listener of [...this.listeners]) listener()
}, subscribe(listener) { this.listeners.add(listener)
return () => { this.listeners.delete(listener) }
}, getSnapshot() { return this.value
}, }
/** 结果提示（成功/警告/失败），自动消失。 */
const noticeStore = { value: null, timer: null, listeners: new Set(), show(notice) { this.value = notice
if (this.timer !== null) clearTimeout(this.timer)
this.timer = setTimeout(() => { this.value = null; this.emit() }, notice?.sticky === true ? 12000 : 6000)
this.emit()
}, clear() { if (this.timer !== null) clearTimeout(this.timer)
this.timer = null
this.value = null
this.emit()
}, emit() { for (const listener of [...this.listeners]) listener()
}, subscribe(listener) { this.listeners.add(listener)
return () => { this.listeners.delete(listener) }
}, getSnapshot() { return this.value
}, }
/** 订阅函数保持稳定引用，避免每次渲染都重订阅。 */
const subscribeDialog = listener => dialogStore.subscribe(listener)
const getDialogSnapshot = () => dialogStore.getSnapshot()
const subscribeNotice = listener => noticeStore.subscribe(listener)
const getNoticeSnapshot = () => noticeStore.getSnapshot()
/** 订阅弹窗状态。 */
function useDialogRequest() { return useSyncExternalStore(subscribeDialog, getDialogSnapshot, () => null)
}
/** 订阅提示状态。 */
function useNotice() { return useSyncExternalStore(subscribeNotice, getNoticeSnapshot, () => null)
}
const styles = { iconButton: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '22px', height: '22px', padding: 0, border: 'none', borderRadius: '6px', background: 'transparent',
color: 'var(--dsw-alias-label-secondary)', cursor: 'pointer', }, iconButtonHover: { background: 'var(--dsw-alias-interactive-bg-hover)', color: 'var(--dsw-alias-state-error-primary)', }, menuItem: { display: 'flex',
alignItems: 'center', gap: '8px', width: '100%', padding: '6px 10px', border: 'none', borderRadius: '6px', background: 'transparent', color: 'var(--dsw-alias-state-error-primary)', fontSize: '13px', textAlign: 'left',
cursor: 'pointer', }, menuItemHover: { background: 'var(--dsw-alias-interactive-bg-hover-danger)', }, backdrop: { position: 'fixed', inset: 0, zIndex: 4000, display: 'flex', alignItems: 'center',
justifyContent: 'center', background: 'var(--dsw-alias-bg-mask-1, rgba(0, 0, 0, 0.42))', pointerEvents: 'auto', }, card: { width: 'min(560px, 92vw)', maxHeight: '82vh', overflow: 'auto', padding: '20px',
borderRadius: '12px', border: '1px solid var(--dsw-alias-border-l1)', background: 'var(--dsw-alias-bg-layer-2)', color: 'var(--dsw-alias-label-primary)',
boxShadow: '0 12px 40px var(--dsw-alias-bg-overlay, rgba(0, 0, 0, 0.28))', }, title: { margin: '0 0 14px', fontSize: '16px', fontWeight: 600, lineHeight: 1.4, wordBreak: 'break-word', }, fieldRow: { display: 'grid',
gridTemplateColumns: '88px 1fr', gap: '6px 12px', fontSize: '13px', lineHeight: 1.6, }, fieldLabel: { color: 'var(--dsw-alias-label-tertiary)' },
fieldValue: { color: 'var(--dsw-alias-label-primary)', wordBreak: 'break-word' }, sectionTitle: { margin: '16px 0 6px', fontSize: '12px', fontWeight: 600, color: 'var(--dsw-alias-label-secondary)', }, list: { margin: 0,
padding: '0 0 0 18px', fontSize: '13px', lineHeight: 1.7, color: 'var(--dsw-alias-label-secondary)', }, hint: { margin: '6px 0 0', fontSize: '12px', lineHeight: 1.6, color: 'var(--dsw-alias-label-tertiary)', }, error: {
margin: '10px 0 0', fontSize: '12px', lineHeight: 1.6, color: 'var(--dsw-alias-state-error-primary)', whiteSpace: 'pre-wrap', }, footer: { display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', gap: '8px',
marginTop: '18px', }, button: { padding: '7px 14px', borderRadius: '8px', border: '1px solid var(--dsw-alias-border-l1)', background: 'transparent', color: 'var(--dsw-alias-label-primary)', fontSize: '13px',
cursor: 'pointer', }, buttonPrimary: { border: '1px solid transparent', background: 'var(--dsw-alias-button-primary-fill)', color: 'var(--dsw-alias-label-primary-foreground)', }, buttonDanger: {
border: '1px solid var(--dsw-alias-state-error-primary)', color: 'var(--dsw-alias-state-error-primary)', background: 'transparent', }, buttonDisabled: { opacity: 0.5, cursor: 'not-allowed' }, checkboxRow: {
display: 'flex', alignItems: 'center', gap: '8px', marginTop: '12px', fontSize: '13px', color: 'var(--dsw-alias-label-primary)', }, notice: { position: 'fixed', right: '20px', bottom: '20px', zIndex: 4100,
maxWidth: '380px', padding: '12px 28px 12px 14px', borderRadius: '10px', border: '1px solid var(--dsw-alias-border-l1)', background: 'var(--dsw-alias-bg-layer-3)', color: 'var(--dsw-alias-label-primary)',
boxShadow: '0 8px 24px rgba(0, 0, 0, 0.24)', fontSize: '13px', lineHeight: 1.6, pointerEvents: 'auto', whiteSpace: 'pre-wrap', }, noticeClose: { position: 'absolute', top: '6px', right: '8px', border: 'none',
background: 'transparent', color: 'var(--dsw-alias-label-tertiary)', fontSize: '14px', lineHeight: 1, cursor: 'pointer', padding: '2px', }, cardPanel: { padding: '16px', borderRadius: '10px',
border: '1px solid var(--dsw-alias-settings-card-stroke)', background: 'var(--dsw-alias-settings-card-fill)', marginBottom: '12px', }, table: { width: '100%', borderCollapse: 'collapse', fontSize: '13px' }, th: {
textAlign: 'left', padding: '8px 10px', color: 'var(--dsw-alias-label-tertiary)', fontWeight: 500, borderBottom: '1px solid var(--dsw-alias-border-l1)', whiteSpace: 'nowrap', }, td: { padding: '8px 10px',
borderBottom: '1px solid var(--dsw-alias-border-l1)', color: 'var(--dsw-alias-label-primary)', verticalAlign: 'top', }, smallButton: { padding: '3px 9px', borderRadius: '6px',
border: '1px solid var(--dsw-alias-border-l1)', background: 'transparent', color: 'var(--dsw-alias-label-primary)', fontSize: '12px', cursor: 'pointer', marginRight: '6px', }, }
/** 一个带 hover 反馈的图标按钮。 */
function HoverIconButton({ label, onClick, children }) { const [hover, setHover] = useState(false)
return h('button', { type: 'button', title: label, 'aria-label': label, style: hover ? { ...styles.iconButton, ...styles.iconButtonHover } : styles.iconButton, onMouseEnter: () => setHover(true),
onMouseLeave: () => setHover(false), onClick: (event) => { event.preventDefault()
event.stopPropagation()
onClick()
}, }, children)
}
/** 垃圾桶图标（内联 SVG，不依赖官方图标包）。 */
function TrashIcon({ size = 14 }) { return h('svg', { width: size, height: size, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round',
'aria-hidden': 'true', }, h('path', { d: 'M2.5 4.5h11' }), h('path', { d: 'M6 4.5V3.2a.8.8 0 0 1 .8-.8h2.4a.8.8 0 0 1 .8.8v1.3' }), h('path', { d: 'M4 4.5l.7 8.2a1 1 0 0 0 1 .9h4.6a1 1 0 0 0 1-.9l.7-8.2' }),
h('path', { d: 'M6.6 7v4.2M9.4 7v4.2' }), )
}
/** 行内删除按钮（`sidebar.workspaces.session.row.action`）。 */
function SessionRowDeleteButton({ sessionId, displayTitle, t }) { const label = t('action.deleteHint')
return h(HoverIconButton, { label, onClick: () => dialogStore.open({ sessionId, title: displayTitle ?? '', nonce: Date.now() }), }, h(TrashIcon, { size: 14 }))
}
/** `⋯` 菜单项（`sidebar.workspaces.session.menu.item`）。 */
function SessionMenuDeleteItem({ sessionId, displayTitle, useMenuOpenState, t }) { const [hover, setHover] = useState(false)
const menuOpenState = useMenuOpenState()
const setMenuOpen = typeof menuOpenState?.[1] === 'function' ? menuOpenState[1] : undefined
return h('button', { type: 'button', role: 'menuitem', style: hover ? { ...styles.menuItem, ...styles.menuItemHover } : styles.menuItem, onMouseEnter: () => setHover(true), onMouseLeave: () => setHover(false),
onClick: () => { if (typeof setMenuOpen === 'function') setMenuOpen(false)
dialogStore.open({ sessionId, title: displayTitle ?? '', nonce: Date.now() })
}, }, h(TrashIcon, { size: 14 }), h('span', null, t('action.delete')))
}
/** 弹窗里的一行字段。 */
function Field({ label, children }) { return h(React.Fragment, null, h('div', { style: styles.fieldLabel }, label), h('div', { style: styles.fieldValue }, children), )
}
/** 确认弹窗本体。 */
function DeleteConfirmDialog({ request, ctx, t }) { const [state, setState] = useState({ phase: 'loading', data: null, error: '' })
const [busy, setBusy] = useState('')
const [stopFirst, setStopFirst] = useState(false)
const [purgeArmed, setPurgeArmed] = useState(false)
const primaryRef = useRef(null)
const cardRef = useRef(null)
const closedRef = useRef(false)
const load = useCallback(async () => { setState({ phase: 'loading', data: null, error: '' })
try { const result = await apiGet('/inspect', { sessionId: request.sessionId, title: request.title })
if (result?.ok === true) setState({ phase: 'ready', data: { ...result.session, settings: result.settings }, error: '' })
else setState({ phase: 'error', data: null, error: errorText(result, t('dialog.loadFailed', { detail: '未知错误' })) })
} catch (error) { setState({ phase: 'error', data: null, error: t('dialog.loadFailed', { detail: error instanceof Error ? error.message : String(error) }) })
}
}, [request.sessionId, request.title, t])
useEffect(() => { closedRef.current = false
void load()
return () => { closedRef.current = true }
}, [load])
useEffect(() => { const onKeyDown = (event) => { if (event.key === 'Escape' && busy === '') { event.stopImmediatePropagation()
dialogStore.close()
return
}
if (event.key !== 'Tab') return
const card = cardRef.current
if (card === null) return
const focusable = [...card.querySelectorAll('button, input, select, textarea, [href], [tabindex]:not([tabindex="-1"])')]
.filter(element => element.disabled !== true)
if (focusable.length === 0) return
const first = focusable[0]
const last = focusable[focusable.length - 1]
if (event.shiftKey && document.activeElement === first) { event.preventDefault()
last.focus()
} else if (!event.shiftKey && document.activeElement === last) { event.preventDefault()
first.focus()
}
}
window.addEventListener('keydown', onKeyDown)
return () => window.removeEventListener('keydown', onKeyDown)
}, [busy])
useEffect(() => { if (state.phase === 'ready') primaryRef.current?.focus?.()
}, [state.phase])
const session = state.data
const running = session?.running === true
let uiWorkspace
try { uiWorkspace = ctx.uiWorkspace ?? ctx.get?.('uiWorkspace') } catch { uiWorkspace = undefined }
const isCurrent = uiWorkspace?.mainReference?.sessionId === request.sessionId
const runningChildren = Array.isArray(session?.descendants) ? session.descendants.filter(item => item.running === true).length : 0
const blocked = runningChildren > 0 || (running && !stopFirst)
const close = () => { if (busy === '') dialogStore.close() }
const run = async (mode) => { if (blocked) return
setBusy(mode)
try { const result = await apiPost('/delete', { sessionId: request.sessionId, mode, stopIfRunning: stopFirst, title: request.title, })
if (result?.ok === true) { const title = session?.title || request.title || t('dialog.titleFallback')
const warnings = Array.isArray(result.warnings) ? result.warnings : []
const leftovers = Array.isArray(result.leftovers) ? result.leftovers : []
const text = result.code === 'already-gone'
? t('notice.alreadyGone')
: result.code === 'already-in-trash'
? t('notice.alreadyTrash')
: mode === 'purge' ? t('notice.purged', { title }) : t('notice.trashed', { title })
noticeStore.show({ kind: warnings.length > 0 || leftovers.length > 0 ? 'warn' : 'ok',
text: [text, warnings.length > 0 ? t('dialog.warnings', { n: warnings.length }) : '', ...warnings.slice(0, 5)].filter(Boolean).join('\n'), sticky: warnings.length > 0, })
refreshSessionList(ctx)
clearMainIfCurrent(ctx, request.sessionId)
dialogStore.close()
return
}
setState(previous => ({ ...previous, error: errorText(result, t('dialog.failed', { detail: '未知错误' })), }))
} catch (error) { setState(previous => ({ ...previous, error: t('dialog.failed', { detail: error instanceof Error ? error.message : String(error) }) }))
} finally { setBusy('')
}
}
const title = session?.title || request.title || t('dialog.titleFallback')
const children = []
children.push(h('h2', { style: styles.title, key: 'title', id: 'dsh-session-delete-dialog-title' }, t('dialog.title', { title })))
if (state.phase === 'loading') { children.push(h('p', { style: styles.hint, key: 'loading' }, t('dialog.loading')))
} else if (state.phase === 'error') { children.push(h('p', { style: styles.error, key: 'error' }, state.error))
} else { const subagents = Array.isArray(session.descendants) ? session.descendants : []
const runningChildren = subagents.filter(item => item.running === true).length
const stateText = running ? t('field.state.running') : t('field.state.idle')
children.push(h('div', { style: styles.fieldRow, key: 'fields' }, h(Field, { label: t('field.sessionId') }, h('code', { style: { fontSize: '12px' } }, shortId(session.sessionId))),
h(Field, { label: t('field.current') }, isCurrent ? t('field.current.yes') : t('field.current.no')), h(Field, { label: t('field.workspace') }, session.workspace === null || session.workspace === undefined
? '—'
: `${session.workspace.title || session.workspace.path}（${session.workspace.path}）`), h(Field, { label: t('field.size') }, formatBytes(session.sizeBytes)),
h(Field, { label: t('field.state') }, running ? `${stateText} · ${t('field.state.runningHint')}` : `${stateText} · ${session.live ? t('field.state.live') : t('field.state.cold')}`),
h(Field, { label: t('field.subagents') }, subagents.length === 0
? t('field.subagents.none')
: runningChildren > 0
? t('field.subagents.running', { n: subagents.length, running: runningChildren })
: t('field.subagents.some', { n: subagents.length })), ))
const cleanup = [ t('cleanup.log', { size: formatBytes(session.sizeBytes) }), t('cleanup.projection'), t('cleanup.workspace'), t('cleanup.live'), ]
if (subagents.length > 0) cleanup.push(t('cleanup.subagents', { n: subagents.length }))
children.push(h('div', { style: styles.sectionTitle, key: 'cleanupTitle' }, t('cleanup.title')))
children.push(h('ul', { style: styles.list, key: 'cleanup' }, cleanup.map((line, index) => h('li', { key: `line-${index}` }, line))))
const retentionDays = session.settings?.retentionDays
children.push(h('p', { style: styles.hint, key: 'explain' }, session.inTrash === true
? t('notice.alreadyTrash')
: Number(retentionDays) > 0 ? t('trash.explain', { days: retentionDays }) : t('trash.explainForever')))
if (runningChildren > 0) { children.push(h('p', { style: styles.hint, key: 'childRunningHint' }, t('field.subagents.runningHint', { n: runningChildren })))
}
if (running) { children.push(h('label', { style: styles.checkboxRow, key: 'stop' }, h('input', { type: 'checkbox', checked: stopFirst, onChange: event => setStopFirst(event.target.checked), }),
h('span', null, busy === 'purge' ? t('stop.checkboxPurge') : t('stop.checkbox')), ))
if (!stopFirst) children.push(h('p', { style: styles.hint, key: 'stopHint' }, t('stop.needStop')))
}
if (state.error !== '') children.push(h('p', { style: styles.error, key: 'runError' }, state.error))
if (busy !== '') { children.push(h('p', { style: styles.hint, key: 'busy' }, busy === 'purge' ? t('dialog.busy.purge') : t('dialog.busy.trash')))
}
const disabled = busy !== '' || blocked
children.push(h('div', { style: styles.footer, key: 'footer' }, h('button', { type: 'button', style: styles.button, disabled: busy !== '', onClick: close }, t('button.cancel')), h('button', { type: 'button',
ref: primaryRef, style: disabled ? { ...styles.button, ...styles.buttonPrimary, ...styles.buttonDisabled } : { ...styles.button, ...styles.buttonPrimary }, disabled, onClick: () => void run('trash'),
}, t('button.trash')), h('button', { type: 'button', style: disabled ? { ...styles.button, ...styles.buttonDanger, ...styles.buttonDisabled } : { ...styles.button, ...styles.buttonDanger }, disabled, onClick: () => {
if (!purgeArmed) { setPurgeArmed(true); return }
void run('purge')
}, onBlur: () => setPurgeArmed(false), }, purgeArmed ? t('button.purgeConfirm') : t('button.purge')), ))
}
return h('div', { style: styles.backdrop, role: 'presentation', onMouseDown: (event) => { if (event.target === event.currentTarget) close() }, }, h('div', { role: 'dialog', 'aria-modal': 'true',
'aria-labelledby': 'dsh-session-delete-dialog-title', ref: cardRef, style: styles.card, }, children))
}
/** `shell.overlay` 入口：弹窗 + 结果提示。 */
function OverlayHost({ ctx, t }) { const request = useDialogRequest()
const notice = useNotice()
return h(React.Fragment, null, h(BatchHeaderMount, { t }), h(BatchRowInjector, { t }), h(BatchToolbar, { ctx, t }),
request === null ? null : h(DeleteConfirmDialog, { key: `${request.sessionId}:${request.nonce}`, request, ctx, t }), notice === null ? null : h('div', { style: styles.notice, role: 'status', }, notice.text, h('button', {
type: 'button', 'aria-label': '关闭提示', style: styles.noticeClose, onClick: () => noticeStore.clear(), }, '×')), )
}
/** 设置页「会话回收站」：逐条还原/彻底删除 + 勾选批量还原。 */
function TrashSettingsSection({ ctx, t }) { const [state, setState] = useState({ phase: 'loading', entries: [], usage: { count: 0, bytes: 0 }, settings: null, error: '' })
const [busy, setBusy] = useState('')
const [selected, setSelected] = useState(() => new Set())
const [confirmPurge, setConfirmPurge] = useState('')
const [confirmEmpty, setConfirmEmpty] = useState(false)
const load = useCallback(async () => { setState(previous => ({ ...previous, phase: previous.entries.length === 0 ? 'loading' : previous.phase, error: '' }))
try { const result = await apiGet('/trash')
if (result?.ok === true) { const entries = result.entries ?? []
setState({ phase: 'ready', entries, usage: result.usage ?? { count: 0, bytes: 0 }, settings: result.settings ?? null, error: '' })
setSelected(previous => new Set([...previous].filter(trashId => entries.some(entry => entry.trashId === trashId))))
} else { setState(previous => ({ ...previous, phase: 'error', error: errorText(result, t('settings.loadFailed', { detail: '未知错误' })) }))
}
} catch (error) { setState(previous => ({ ...previous, phase: 'error', error: t('settings.loadFailed', { detail: error instanceof Error ? error.message : String(error) }) }))
}
}, [t])
useEffect(() => { void load() }, [load])
const entries = state.entries
const selectableEntries = entries.filter(entry => entry.partial !== true)
const selectedEntries = selectableEntries.filter(entry => selected.has(entry.trashId))
const act = async (kind, work) => { setBusy(kind)
try { const result = await work()
if (result?.ok !== true) { noticeStore.show({ kind: 'error', text: errorText(result, t('settings.actionFailed', { detail: '未知错误' })) })
return
}
noticeStore.show({ kind: 'ok', text: result.message ?? '' })
if (kind === 'restore') refreshSessionList(ctx)
await load()
} catch (error) { noticeStore.show({ kind: 'error', text: t('settings.actionFailed', { detail: error instanceof Error ? error.message : String(error) }) })
} finally { setBusy('')
setConfirmPurge('')
setConfirmEmpty(false)
}
}
const batchRestore = async () => { if (selectedEntries.length === 0) return
setBusy('batch-restore')
let ok = 0
let failed = 0
for (const entry of selectedEntries) { try { const result = await apiPost('/restore', { sessionId: entry.sessionId })
if (result?.ok === true) ok += 1
else failed += 1
} catch { failed += 1
}
}
noticeStore.show({ kind: failed > 0 ? 'warn' : 'ok', text: failed > 0 ? `${t('settings.batchRestoreDone', { n: ok })}，失败 ${failed} 条` : t('settings.batchRestoreDone', { n: ok }), sticky: failed > 0, })
refreshSessionList(ctx)
await load()
setSelected(new Set())
setBusy('')
}
const saveSettings = async (patch) => { setBusy('settings')
try { const result = await apiPost('/settings', patch)
if (result?.ok === true) setState(previous => ({ ...previous, settings: result.settings }))
else noticeStore.show({ kind: 'error', text: errorText(result, t('settings.settingsFailed', { detail: '未知错误' })) })
} catch (error) { noticeStore.show({ kind: 'error', text: t('settings.settingsFailed', { detail: error instanceof Error ? error.message : String(error) }) })
} finally { setBusy('')
}
}
const toggleEntry = trashId => setSelected(previous => { const next = new Set(previous)
if (next.has(trashId)) next.delete(trashId)
else next.add(trashId)
return next
})
const toggleAll = () => setSelected(previous => ( previous.size >= selectableEntries.length && selectableEntries.length > 0
? new Set()
: new Set(selectableEntries.map(entry => entry.trashId))
))
const settings = state.settings ?? { retentionDays: 30, sweepOnStartup: true }
const rows = entries.map(entry => h('tr', { key: entry.trashId }, h('td', { style: { ...styles.td, width: '28px' } }, h('input', { type: 'checkbox', checked: selected.has(entry.trashId),
disabled: busy !== '' || entry.partial === true, 'aria-label': t('settings.selectAll'), title: entry.partial === true ? t('settings.partialRestoreBlocked') : undefined, onChange: () => toggleEntry(entry.trashId), }), ),
h('td', { style: styles.td }, h('div', { style: { fontWeight: 500 } }, entry.title || t('settings.untitled')),
h('div', { style: { fontSize: '11px', color: 'var(--dsw-alias-label-tertiary)' } }, shortId(entry.sessionId)),
entry.members.length > 1 ? h('div', { style: { fontSize: '11px', color: 'var(--dsw-alias-label-tertiary)' } }, t('settings.subagents', { n: entry.members.length - 1 })) : null, entry.partial === true
? h('div', { style: { fontSize: '11px', color: 'var(--dsw-alias-state-error-primary)' } }, `${t('settings.partialShort')}：${t('settings.partial')}`)
: null, ), h('td', { style: styles.td }, entry.workspaceTitle || entry.workspacePath || '—'), h('td', { style: styles.td }, formatTime(entry.deletedAt)), h('td', { style: styles.td }, formatBytes(entry.sizeBytes)),
h('td', { style: styles.td }, h('button', { type: 'button', style: entry.partial === true ? { ...styles.smallButton, opacity: 0.5 } : styles.smallButton, disabled: busy !== '' || entry.partial === true,
title: entry.partial === true ? t('settings.partialRestoreBlocked') : undefined, onClick: () => void act('restore', () => apiPost('/restore', { sessionId: entry.sessionId })), }, t('settings.restore')), h('button', {
type: 'button', style: { ...styles.smallButton, color: 'var(--dsw-alias-state-error-primary)' }, disabled: busy !== '', onClick: () => setConfirmPurge(entry.trashId), }, t('settings.purge')), ), ))
return h('section', { style: { maxWidth: '860px' } }, h('h2', { style: { margin: '0 0 6px', fontSize: '16px', fontWeight: 600 } }, t('settings.title')), h('p', { style: styles.hint }, t('settings.description')),
h('div', { style: styles.cardPanel }, h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' } },
h('div', { style: { fontSize: '13px', fontWeight: 500 } }, t('settings.usage', { count: state.usage.count, size: formatBytes(state.usage.bytes) })),
h('button', { type: 'button', style: styles.smallButton, disabled: busy !== '', onClick: () => void load() }, t('settings.refresh')), ),
state.phase === 'loading' ? h('p', { style: styles.hint }, t('settings.loading')) : null, state.error !== '' ? h('p', { style: styles.error }, state.error) : null,
state.phase === 'ready' && entries.length === 0 ? h('p', { style: styles.hint }, t('settings.empty')) : null,
entries.length > 0 ? h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', marginTop: '10px', flexWrap: 'wrap' } }, h('label', { style: styles.checkboxRow },
h('input', { type: 'checkbox', checked: selected.size >= entries.length && entries.length > 0, disabled: busy !== '', onChange: toggleAll }), h('span', null, t('settings.selectAll')), ),
h('span', { style: styles.hint }, t('settings.selectedCount', { n: selected.size })), h('button', { type: 'button', style: styles.smallButton, disabled: busy !== '' || selected.size === 0,
onClick: () => void batchRestore(), }, t('settings.batchRestore')), ) : null,
confirmPurge !== '' ? h('div', { style: { marginTop: '10px', padding: '10px', borderRadius: '8px', border: '1px solid var(--dsw-alias-state-error-primary)' } },
h('p', { style: { ...styles.hint, color: 'var(--dsw-alias-state-error-primary)' } }, t('settings.confirmPurgeHint')), h('div', { style: { display: 'flex', gap: '8px' } },
h('button', { type: 'button', style: styles.smallButton, disabled: busy !== '', onClick: () => setConfirmPurge('') }, t('settings.confirmCancel')), h('button', { type: 'button',
style: { ...styles.smallButton, color: 'var(--dsw-alias-state-error-primary)' }, disabled: busy !== '', onClick: () => { const entry = entries.find(item => item.trashId === confirmPurge)
if (entry !== undefined) void act('purge', () => apiPost('/purge', { sessionId: entry.sessionId }))
}, }, t('settings.confirmPurgeYes')), ), ) : null, confirmEmpty ? h('div', { style: { marginTop: '10px', padding: '10px', borderRadius: '8px', border: '1px solid var(--dsw-alias-state-error-primary)' } },
h('p', { style: { ...styles.hint, color: 'var(--dsw-alias-state-error-primary)' } }, t('settings.confirmEmptyHint')), h('div', { style: { display: 'flex', gap: '8px' } },
h('button', { type: 'button', style: styles.smallButton, disabled: busy !== '', onClick: () => setConfirmEmpty(false) }, t('settings.confirmCancel')), h('button', { type: 'button',
style: { ...styles.smallButton, color: 'var(--dsw-alias-state-error-primary)' }, disabled: busy !== '', onClick: () => void act('empty', () => apiPost('/empty', { onlyExpired: false })),
}, t('settings.confirmEmptyYes')), ), ) : null, entries.length > 0 ? h('div', { style: { marginTop: '10px', overflowX: 'auto' } }, h('table', { style: styles.table }, h('thead', null, h('tr', null,
h('th', { style: styles.th }, ''), h('th', { style: styles.th }, t('settings.column.title')), h('th', { style: styles.th }, t('settings.column.workspace')), h('th', { style: styles.th }, t('settings.column.deletedAt')),
h('th', { style: styles.th }, t('settings.column.size')), h('th', { style: styles.th }, t('settings.column.actions')), )), h('tbody', null, rows), ), ) : null, ), h('div', { style: styles.cardPanel },
h('div', { style: { fontSize: '13px', fontWeight: 500, marginBottom: '8px' } }, t('settings.policy')), h('label', { style: { display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px' } },
h('span', null, t('settings.retention')), h('select', { value: String(settings.retentionDays), disabled: busy !== '', onChange: event => void saveSettings({ retentionDays: Number(event.target.value) }),
style: { padding: '4px 8px', borderRadius: '6px', border: '1px solid var(--dsw-alias-border-l1)', background: 'var(--dsw-alias-bg-layer-2)', color: 'var(--dsw-alias-label-primary)' },
}, [7, 15, 30, 90, 0].map(days => h('option', { key: days, value: String(days) }, t(`settings.retention.${days}`)))), ), h('p', { style: styles.hint }, t('settings.retentionHint')),
h('label', { style: { ...styles.checkboxRow, marginTop: '10px' } }, h('input', { type: 'checkbox', checked: settings.sweepOnStartup === true, disabled: busy !== '',
onChange: event => void saveSettings({ sweepOnStartup: event.target.checked }), }), h('span', null, t('settings.sweepOnStartup')), ), h('div', { style: { ...styles.footer, justifyContent: 'flex-start' } }, h('button', {
type: 'button', style: styles.smallButton, disabled: busy !== '', onClick: () => void act('sweep', () => apiPost('/empty', { onlyExpired: true })), }, t('settings.sweepNow')), h('button', { type: 'button',
style: { ...styles.smallButton, color: 'var(--dsw-alias-state-error-primary)' }, disabled: busy !== '', onClick: () => setConfirmEmpty(true), }, t('settings.emptyTrash')), ), ), )
}
const MAX_SELECT = 200
const batchStore = { value: { mode: false, selected: new Set(), headerStatus: 'pending' }, listeners: new Set(), emit() { for (const listener of [...this.listeners]) listener() },
subscribe(listener) { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }, getSnapshot() { return this.value }, setMode(mode) {
this.value = { ...this.value, mode, selected: mode ? this.value.selected : new Set() }
this.emit()
}, toggle(id) { const next = new Set(this.value.selected)
if (next.has(id)) next.delete(id)
else next.add(id)
this.value = { ...this.value, selected: next }
this.emit()
}, select(ids) { this.value = { ...this.value, selected: new Set(ids) }
this.emit()
}, clear() { this.value = { ...this.value, selected: new Set() }; this.emit() }, setHeaderStatus(status) { if (this.value.headerStatus === status) return
this.value = { ...this.value, headerStatus: status }
this.emit()
}, }
const subscribeBatch = listener => batchStore.subscribe(listener)
const getBatchSnapshot = () => batchStore.getSnapshot()
function useBatch() { return useSyncExternalStore(subscribeBatch, getBatchSnapshot, getBatchSnapshot)
}
/** 当前侧栏已挂载勾选框的会话 ID（即用户看得见的行）。 */
function visibleSessionIds() { return Array.from(document.querySelectorAll('[data-dsh-session-delete-select]'))
.map(node => node.getAttribute('data-dsh-session-delete-select') ?? '')
.filter(id => id !== '')
}
/** 从会话行 DOM 里取标题（失败项展示用，拿不到就退回 ID）。 */
function rowTitleOf(sessionId) { const host = document.querySelector(`[data-dsh-session-delete-select="${sessionId}"]`)
const row = host?.parentElement
const text = (row?.textContent ?? '').trim()
return text === '' ? '' : text.split('\n')[0].slice(0, 60)
}
const batchStyles = {
trigger: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '28px', height: '28px', padding: 0, border: 'none', borderRadius: 'var(--dsw-radius-sm, 6px)', background: 'transparent', color: 'var(--dsw-alias-label-secondary)', cursor: 'pointer', flex: 'none' },
triggerActive: { background: 'var(--dsw-alias-interactive-bg-hover)', color: 'var(--dsw-alias-state-business-primary)' },
footerAction: { display: 'flex', alignItems: 'center', gap: '8px', width: '100%', padding: '6px 10px', border: 'none', borderRadius: '6px', background: 'transparent', color: 'var(--dsw-alias-label-secondary)', fontSize: '13px', cursor: 'pointer', whiteSpace: 'nowrap', overflow: 'hidden' },
bar: { position: 'fixed', left: '50%', bottom: '96px', transform: 'translateX(-50%)', zIndex: 4060, display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '8px', maxWidth: '92vw', padding: '10px 14px', borderRadius: '12px', border: '1px solid var(--dsw-alias-border-l1)', background: 'var(--dsw-alias-bg-layer-3)', color: 'var(--dsw-alias-label-primary)', boxShadow: '0 12px 40px var(--dsw-alias-bg-overlay, rgba(0, 0, 0, 0.28))', pointerEvents: 'auto' },
count: { fontSize: '13px', fontWeight: 600, marginRight: '4px' },
button: { padding: '5px 11px', borderRadius: '7px', border: '1px solid var(--dsw-alias-border-l1)', background: 'transparent', color: 'var(--dsw-alias-label-primary)', fontSize: '12px', cursor: 'pointer' },
primary: { padding: '5px 12px', borderRadius: '7px', border: '1px solid transparent', background: 'var(--dsw-alias-button-primary-fill)', color: 'var(--dsw-alias-label-primary-foreground)', fontSize: '12px', cursor: 'pointer' },
danger: { padding: '5px 12px', borderRadius: '7px', border: '1px solid var(--dsw-alias-state-error-primary)', background: 'transparent', color: 'var(--dsw-alias-state-error-primary)', fontSize: '12px', cursor: 'pointer' },
disabled: { opacity: 0.5, cursor: 'not-allowed' }, checkboxRow: { display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'var(--dsw-alias-label-secondary)' },
failures: { flexBasis: '100%', maxHeight: '120px', overflow: 'auto', padding: '6px 8px', borderRadius: '8px', border: '1px solid var(--dsw-alias-state-error-primary)', color: 'var(--dsw-alias-state-error-primary)', fontSize: '11px', lineHeight: 1.6, whiteSpace: 'pre-wrap' },
progress: { fontSize: '12px', color: 'var(--dsw-alias-label-secondary)' },
mask: { position: 'fixed', inset: 0, zIndex: 4090, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--dsw-alias-bg-mask-1, rgba(0, 0, 0, 0.42))', pointerEvents: 'auto' },
confirmCard: { width: 'min(560px, 92vw)', maxHeight: '84vh', overflow: 'auto', display: 'flex', flexDirection: 'column', gap: '10px', padding: '18px', borderRadius: '12px', border: '1px solid var(--dsw-alias-border-l1)', background: 'var(--dsw-alias-bg-layer-2)', color: 'var(--dsw-alias-label-primary)', boxShadow: '0 12px 40px var(--dsw-alias-bg-overlay, rgba(0, 0, 0, 0.28))' },
confirmTitle: { margin: 0, fontSize: '16px', fontWeight: 600 }, confirmText: { margin: 0, fontSize: '13px', lineHeight: 1.7, color: 'var(--dsw-alias-label-secondary)', whiteSpace: 'pre-wrap' },
confirmWarning: { margin: 0, fontSize: '13px', lineHeight: 1.7, color: 'var(--dsw-alias-state-error-primary)', fontWeight: 500 },
confirmFooter: { display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '4px' }, }
/** 批量管理图标（清单 + 勾）。 */
function BatchIcon({ size = 14 }) { return h('svg', { width: size, height: size, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor',
strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true', }, h('path', { d: 'M2.5 4h7M2.5 8h7M2.5 12h4' }), h('path', { d: 'M11 10.5l1.6 1.6 2.4-2.6' }), )
}
/** 把「批量管理」按钮挂到工作区标题行图标区后面（React portal）。 */
function BatchHeaderMount({ t }) { const state = useBatch()
const [container, setContainer] = useState(null)
useEffect(() => { let active = true
let host = null
let failed = false
let timer = null
const probes = new Set()
const findHeader = () => { const nodes = Array.from(document.querySelectorAll('[class*="_sectionHeader"]'))
for (const node of nodes) { const text = node.textContent ?? ''
if (text.includes('工作区') || text.includes('Workspaces')) return node
}
return undefined
}
const attach = () => { if (!active || failed) return
if (host !== null && host.isConnected) return
const header = findHeader()
if (header === undefined) return
host = document.createElement('span')
host.dataset.dshSessionDeleteBatch = ''
host.style.cssText = 'display:inline-flex;align-items:center;flex:none;margin-left:4px'
header.appendChild(host)
setContainer(host)
batchStore.setHeaderStatus('mounted')
const probe = setTimeout(() => { if (!active || host === null) return
const button = host.firstElementChild
if (button === null) return
const rect = button.getBoundingClientRect()
const headerRect = header.getBoundingClientRect()
if (rect.width < 2 || rect.right <= 0 || rect.left >= headerRect.right - 1) { failed = true
host.remove()
host = null
setContainer(null)
batchStore.setHeaderStatus('failed')
}
}, 300)
probes.add(probe)
}
const retry = () => { if (!active || !failed) return
failed = false
batchStore.setHeaderStatus('pending')
attach()
}
attach()
timer = setTimeout(() => { if (active && host === null && !failed) batchStore.setHeaderStatus('failed') }, 3000)
const observer = new MutationObserver(() => { if (!active) return
if (host !== null && host.isConnected) return
host = null
setContainer(null)
attach()
})
observer.observe(document.body, { childList: true, subtree: true })
window.addEventListener('resize', retry)
return () => { active = false
clearTimeout(timer)
for (const probe of probes) clearTimeout(probe)
observer.disconnect()
window.removeEventListener('resize', retry)
if (host !== null) host.remove()
}
}, [])
if (container === null) return null
return ReactDOM.createPortal(h('button', { type: 'button', title: state.mode ? t('batch.exit') : t('batch.open'), 'aria-label': state.mode ? t('batch.exit') : t('batch.open'), 'aria-pressed': state.mode,
style: state.mode ? { ...batchStyles.trigger, ...batchStyles.triggerActive } : batchStyles.trigger, onClick: () => batchStore.setMode(!state.mode), }, h(BatchIcon, { size: 14 })), container)
}
/** 标题行入口不可用时的侧栏底部兜底入口。 */
function BatchFooterFallback({ t }) { const state = useBatch()
if (state.headerStatus !== 'failed') return null
return h('button', { type: 'button', title: state.mode ? t('batch.exit') : t('batch.open'), style: batchStyles.footerAction, onClick: () => batchStore.setMode(!state.mode),
}, h(BatchIcon, { size: 14 }), h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis' } }, state.mode ? t('batch.exit') : t('batch.open')))
}
/**
* 会话行前面的勾选框：注入官方会话行 DOM（`data-row-key="session:<id>"`）最前面。
* MutationObserver + 400ms 轮询补挂；多选模式下点击整行也切换勾选（不打开会话）。
*/
function BatchRowInjector({ t }) { const state = useBatch()
const inputsRef = useRef(new Map())
useEffect(() => { if (!state.mode) return undefined
let active = true
let scheduled = false
const sync = () => { const selected = batchStore.getSnapshot().selected
for (const [sessionId, entry] of inputsRef.current) entry.input.checked = selected.has(sessionId)
}
const decorate = () => { if (!active) return
for (const [sessionId, entry] of [...inputsRef.current]) { if (!entry.host.isConnected) { entry.host.remove()
inputsRef.current.delete(sessionId)
}
}
for (const row of document.querySelectorAll('[data-row-key^="session:"]')) { const key = row.getAttribute('data-row-key') ?? ''
const sessionId = key.slice('session:'.length)
if (sessionId === '') continue
if (row.dataset.dshSessionDeleteRow !== '1') { row.dataset.dshSessionDeleteRow = '1'
row.addEventListener('click', event => { if (!batchStore.getSnapshot().mode) return
const target = event.target
if (target instanceof Element && target.closest('[data-dsh-session-delete-select],button,a,input,[role="menuitem"],[contenteditable="true"]')) return
event.preventDefault()
event.stopPropagation()
batchStore.toggle(sessionId)
}, true)
}
if (inputsRef.current.has(sessionId)) continue
const host = document.createElement('span')
host.dataset.dshSessionDeleteSelect = sessionId
host.style.cssText = 'display:inline-flex;align-items:center;flex:none;margin-right:6px'
const input = document.createElement('input')
input.type = 'checkbox'
input.setAttribute('aria-label', t('batch.checkbox'))
input.style.cssText = 'width:14px;height:14px;margin:0;cursor:pointer;accent-color:var(--dsw-alias-state-business-primary)'
input.addEventListener('click', event => { event.preventDefault()
event.stopPropagation()
batchStore.toggle(sessionId)
})
host.appendChild(input)
row.insertBefore(host, row.firstChild)
inputsRef.current.set(sessionId, { host, input })
}
sync()
}
const schedule = () => { if (scheduled) return
scheduled = true
requestAnimationFrame(() => { scheduled = false; decorate() })
}
decorate()
const observer = new MutationObserver(schedule)
observer.observe(document.body, { childList: true, subtree: true })
const timer = setInterval(schedule, 400)
return () => { active = false
observer.disconnect()
clearInterval(timer)
for (const entry of inputsRef.current.values()) entry.host.remove()
inputsRef.current.clear()
}
}, [state.mode, t])
useEffect(() => { if (!state.mode) return
for (const [sessionId, entry] of inputsRef.current) entry.input.checked = state.selected.has(sessionId)
}, [state])
return null
}
/** 批量操作确认弹窗：列数量/大小/工作区/运行中/归档/子代理，必须显式确认。 */
function BatchConfirmDialog({ ctx, t, mode, selected, stopFirst, busy, metaMap, onCancel, onConfirm }) { const stats = { size: 0, running: 0, archived: 0, subagents: 0, workspaces: new Map() }
for (const id of selected) { const meta = metaMap?.get(id)
if (meta === undefined) continue
stats.size += Number(meta.sizeBytes) || 0
if (meta.running === true) stats.running += 1
if (meta.archived === true) stats.archived += 1
if ((Number(meta.subagentCount) || 0) > 0) stats.subagents += 1
const name = meta.workspace?.title || meta.workspace?.path || t('batch.unGroupedTitle')
stats.workspaces.set(name, (stats.workspaces.get(name) ?? 0) + 1)
}
const workspaceText = [...stats.workspaces.entries()]
.map(([name, count]) => `${name}×${count}`)
.join('、')
const purge = mode === 'purge'
return h('div', { style: batchStyles.mask, role: 'presentation', onMouseDown: event => { if (event.target === event.currentTarget && !busy) onCancel() }, }, h('div', { role: 'dialog', 'aria-modal': 'true',
'aria-label': purge ? t('batch.confirm.purgeTitle') : t('batch.confirm.trashTitle'), style: batchStyles.confirmCard, },
h('h2', { style: batchStyles.confirmTitle }, purge ? t('batch.confirm.purgeTitle') : t('batch.confirm.trashTitle')),
h('p', { style: batchStyles.confirmText }, t('batch.confirm.summary', { n: selected.length, size: formatBytes(stats.size) })),
stats.workspaces.size > 0 ? h('p', { style: batchStyles.confirmText }, t('batch.confirm.workspaces', { list: workspaceText })) : null,
(stats.running + stats.archived + stats.subagents) > 0 ? h('p', { style: batchStyles.confirmText }, t('batch.confirm.breakdown', { running: stats.running, archived: stats.archived, subagents: stats.subagents })) : null,
h('p', { style: batchStyles.confirmText }, stopFirst ? t('batch.confirm.stopOn') : t('batch.confirm.stopOff')),
h('p', { style: purge ? batchStyles.confirmWarning : batchStyles.confirmText }, purge ? t('batch.confirm.purgeWarning') : t('batch.confirm.trashNote')), h('div', { style: batchStyles.confirmFooter },
h('button', { type: 'button', style: batchStyles.button, disabled: busy, onClick: onCancel }, t('batch.confirm.cancel')), h('button', { type: 'button',
style: busy ? { ...(purge ? batchStyles.danger : batchStyles.primary), ...batchStyles.disabled } : (purge ? batchStyles.danger : batchStyles.primary), disabled: busy, onClick: onConfirm,
}, purge ? t('batch.confirm.purgeConfirm') : t('batch.confirm.trashConfirm')), ), ))
}
/** 底部浮动操作栏：全选可见/清空/先停/确认后批量移入回收站或彻底删除/退出。 */
function BatchToolbar({ ctx, t }) { const state = useBatch()
const [busy, setBusy] = useState(false)
const [stopFirst, setStopFirst] = useState(false)
const [confirmMode, setConfirmMode] = useState(null)
const [result, setResult] = useState(null)
const [metaMap, setMetaMap] = useState(null)
const busyRef = useRef(false)
useEffect(() => { if (!state.mode) return
const onKeyDown = event => { if (event.key !== 'Escape' || busyRef.current) return
if (confirmMode !== null) { setConfirmMode(null); return }
if (document.querySelector('[role="dialog"]') !== null) return
batchStore.setMode(false)
}
window.addEventListener('keydown', onKeyDown)
return () => window.removeEventListener('keydown', onKeyDown)
}, [state.mode, confirmMode])
if (!state.mode) return null
const selectedCount = state.selected.size
const fail = text => noticeStore.show({ kind: 'error', text })
const run = async mode => { if (busyRef.current || state.selected.size === 0) return
busyRef.current = true
setBusy(true)
setResult(null)
try { const ids = [...state.selected]
const payload = await apiPost('/batch-delete', { sessionIds: ids, mode, stopIfRunning: stopFirst })
if (payload?.ok !== true) { fail(errorText(payload, t('batch.loadFailed', { detail: '未知错误' })))
return
}
setResult(payload)
const failedItems = (payload.results ?? []).filter(item => item.ok !== true)
const failed = payload.summary?.failed ?? failedItems.length
noticeStore.show({ kind: failed > 0 ? 'warn' : 'ok',
text: failed > 0 ? `${t('batch.summary', { ok: payload.summary?.succeeded ?? 0, fail: failed })}；${t('batch.failedKept')}` : t('batch.summary', { ok: payload.summary?.succeeded ?? 0, fail: 0 }), sticky: failed > 0, })
const deleted = (payload.results ?? []).filter(item => item.ok).map(item => item.sessionId)
refreshSessionList(ctx)
for (const id of deleted) clearMainIfCurrent(ctx, id)
if (failed === 0) { batchStore.clear()
batchStore.setMode(false)
} else { batchStore.select(failedItems.map(item => item.sessionId))
}
} catch (error) { fail(errorText(error, t('batch.loadFailed', { detail: '未知错误' })))
} finally { busyRef.current = false
setBusy(false)
}
}
const openConfirm = async mode => { if (busyRef.current || state.selected.size === 0) return
setConfirmMode(mode)
if (metaMap !== null) return
try { const payload = await apiGet('/sessions')
if (payload?.ok === true && Array.isArray(payload.sessions)) { setMetaMap(new Map(payload.sessions.map(session => [session.sessionId, session])))
}
} catch {
/* 拿不到元数据时确认框只显示数量，不影响删除 */
}
}
const selectAllVisible = () => { const ids = visibleSessionIds()
if (ids.length === 0) return
batchStore.select(ids.slice(0, MAX_SELECT))
if (ids.length > MAX_SELECT) noticeStore.show({ kind: 'warn', text: t('batch.selectAllCapped'), sticky: true })
}
const failures = (result?.results ?? []).filter(item => item.ok !== true)
const disabled = busy || selectedCount === 0
const titleOf = id => metaMap?.get(id)?.title || rowTitleOf(id) || shortId(id)
const bar = h('div', { style: batchStyles.bar, role: 'region', 'aria-label': t('batch.title') }, h('span', { style: batchStyles.count }, t('batch.selected', { n: selectedCount })),
h('button', { type: 'button', style: batchStyles.button, disabled: busy, onClick: selectAllVisible }, t('batch.selectAllVisible')),
h('button', { type: 'button', style: batchStyles.button, disabled: busy, onClick: () => batchStore.clear() }, t('batch.clear')), h('label', { style: batchStyles.checkboxRow },
h('input', { type: 'checkbox', checked: stopFirst, disabled: busy, onChange: event => setStopFirst(event.target.checked) }), h('span', null, t('batch.stop')), ),
busy ? h('span', { style: batchStyles.progress }, t('batch.working', { total: selectedCount })) : null, h('button', { type: 'button',
style: disabled ? { ...batchStyles.primary, ...batchStyles.disabled } : batchStyles.primary, disabled, onClick: () => void openConfirm('trash'), }, t('batch.trash')), h('button', { type: 'button',
style: disabled ? { ...batchStyles.danger, ...batchStyles.disabled } : batchStyles.danger, disabled, onClick: () => void openConfirm('purge'), }, t('batch.purge')),
h('button', { type: 'button', style: batchStyles.button, disabled: busy, onClick: () => batchStore.setMode(false) }, t('batch.exit')), failures.length > 0 ? h('div', { style: batchStyles.failures },
`${t('batch.failures')}\n` + failures.map(item => t('batch.failureLine', { title: titleOf(item.sessionId), id: shortId(item.sessionId), detail: item.detail || item.message || item.code, })).join('\n'), ) : null, )
return h(React.Fragment, null, bar, confirmMode === null ? null : h(BatchConfirmDialog, { ctx, t, mode: confirmMode, selected: [...state.selected], stopFirst, busy, metaMap,
onCancel: () => { if (!busy) setConfirmMode(null) }, onConfirm: () => { if (busyRef.current) return
const mode = confirmMode
setConfirmMode(null)
void run(mode)
}, }), )
}
return { inject: ['slots', 'locale', 'sessions', 'uiWorkspace'], apply(ctx) { ctx.effect(() => ctx.locale.register(NS, { zh: TEXT, en }), 'session-delete: 词典')
const t = ctx.locale.bind(NS)
const shell = { ctx, t }
ctx.slots.inject('sidebar.workspaces.session.row.action', () => ctx.slots.register({ name: 'sidebar.workspaces.session.row.action', id: 'dsh-session-delete', order: 300, locale: NS,
}, props => h(SessionRowDeleteButton, { ...props, t })))
ctx.slots.inject('sidebar.workspaces.session.menu.item', () => ctx.slots.register({ name: 'sidebar.workspaces.session.menu.item', id: 'dsh-session-delete', order: 500, locale: NS,
}, props => h(SessionMenuDeleteItem, { ...props, t })))
ctx.slots.inject('shell.overlay', () => ctx.slots.register({ name: 'shell.overlay', id: 'dsh-session-delete.confirm', order: 900, locale: NS, }, () => h(OverlayHost, shell)))
ctx.slots.inject('settings.section', () => ctx.slots.register({ name: 'settings.section', id: 'dsh-session-delete', order: 60, locale: NS, label: () => t('settings.title'), }, () => h(TrashSettingsSection, shell)))
ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({ name: 'sidebar.footer.action', id: 'dsh-session-delete-batch', order: 120, locale: NS, }, () => h(BatchFooterFallback, { t })))
}, }
}, })
