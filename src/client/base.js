    const NS = 'sessionDelete'
    const API = '/api/dsh-session-delete'

    /** 词典（zh/en 两份内容相同，宿主切任何语言都显示中文）。 */
    const TEXT = {
      'action.delete': '删除会话…',
      'action.deleteHint': '删除这个会话',
      'dialog.title': '删除会话「{title}」？',
      'dialog.titleFallback': '（无标题会话）',
      'dialog.loading': '正在读取会话信息…',
      'dialog.loadFailed': '读取会话信息失败：{detail}',
      'field.sessionId': '会话 ID',
      'field.workspace': '所属工作区',
      'field.size': '占用空间',
      'field.state': '运行状态',
      'field.state.idle': '空闲',
      'field.state.running': '运行中',
      'field.state.runningHint': '会话正在运行，不能直接删除',
      'field.state.live': '已加载到内存',
      'field.state.cold': '未加载',
      'field.subagents': '子代理会话',
      'field.subagents.none': '无',
      'field.subagents.some': '{n} 个（将一并删除）',
      'field.subagents.running': '{n} 个，其中 {running} 个正在运行',
      'field.subagents.runningHint': '有 {n} 个子代理会话正在运行，等它们结束后再删除。',
      'field.current': '当前打开',
      'field.current.yes': '是（删除后回到空态）',
      'cleanup.title': '本次将清理',
      'cleanup.log': '会话日志目录（{size}）',
      'cleanup.projection': '投影缓存（域记录 + 分片文件）',
      'cleanup.workspace': '工作区记账、归档与置顶标记',
      'cleanup.live': '内存中的活体会话',
      'cleanup.subagents': '子代理会话日志（{n} 个）',
      'cleanup.trash': '移入回收站，可在「设置 → 会话回收站」还原',
      'cleanup.purge': '直接删除，不进回收站，无法恢复',
      'trash.explain': '删除后先进回收站，保留 {days} 天；彻底删除不进回收站。',
      'trash.explainForever': '删除后先进回收站，永久保留，直到你在设置页彻底删除。',
      'stop.checkbox': '先停止运行，再移入回收站',
      'stop.checkboxPurge': '先停止运行，再彻底删除',
      'stop.needStop': '请先勾选「先停止运行」，或等会话跑完',
      'button.cancel': '取消',
      'button.trash': '移入回收站',
      'button.purge': '彻底删除',
      'button.purgeConfirm': '确认彻底删除',
      'button.close': '关闭',
      'button.retry': '重试',
      'dialog.busy.trash': '正在移入回收站…',
      'dialog.busy.purge': '正在彻底删除…',
      'dialog.failed': '删除失败：{detail}',
      'dialog.warnings': '已完成，但有 {n} 条警告',
      'dialog.leftovers': '仍有 {n} 个文件未清理',
      'notice.trashed': '会话「{title}」已移入回收站',
      'notice.purged': '会话「{title}」已彻底删除',
      'notice.alreadyGone': '会话已不存在，无需删除',
      'notice.alreadyTrash': '会话已在回收站里',
      'settings.title': '会话回收站',
      'settings.description': '删除的会话先放在这里，可以还原或彻底删除。位置：$DSH_HOME/session-delete/trash。',
      'settings.usage': '共 {count} 条 · 占用 {size}',
      'settings.empty': '回收站是空的',
      'settings.refresh': '刷新',
      'settings.loading': '正在读取回收站…',
      'settings.loadFailed': '读取回收站失败：{detail}',
      'settings.column.title': '会话',
      'settings.column.workspace': '工作区',
      'settings.column.deletedAt': '删除时间',
      'settings.column.size': '大小',
      'settings.column.actions': '操作',
      'settings.untitled': '（无标题会话）',
      'settings.restore': '还原',
      'settings.purge': '彻底删除',
      'settings.purgeConfirm': '确认彻底删除？',
      'settings.restored': '已还原会话',
      'settings.purged': '已彻底删除',
      'settings.actionFailed': '操作失败：{detail}',
      'settings.policy': '保留策略',
      'settings.retention': '保留天数',
      'settings.retention.7': '7 天',
      'settings.retention.15': '15 天',
      'settings.retention.30': '30 天',
      'settings.retention.90': '90 天',
      'settings.retention.0': '永久保留',
      'settings.retentionHint': '超过保留天数的条目会在宿主启动时自动清理。',
      'settings.sweepOnStartup': '启动时自动清理过期条目',
      'settings.sweepNow': '立即清理',
      'settings.emptyTrash': '清空回收站',
      'settings.emptyConfirm': '确认清空回收站？此操作不可撤销。',
      'settings.sweepDone': '已清理 {n} 条过期条目',
      'settings.emptyDone': '已清空回收站（{n} 条）',
      'settings.settingsFailed': '保存设置失败：{detail}',
      'settings.subagents': '含 {n} 个子代理会话',
      'settings.archived': '已归档',
      'settings.pinned': '已置顶',
      'common.yes': '是',
      'common.no': '否',
      'batch.open': '批量管理',
      'batch.title': '批量管理',
      'batch.desc': '勾选会话后批量移入回收站或彻底删除；运行中子代理的会话会被整体拒绝。',
      'batch.filter.all': '全部',
      'batch.filter.active': '未归档',
      'batch.filter.archived': '已归档',
      'batch.search': '搜索标题、工作区或路径',
      'batch.selectAll': '全选',
      'batch.invert': '反选',
      'batch.clear': '清空选择',
      'batch.selected': '已选 {n} 个',
      'batch.stop': '先停止运行中的会话',
      'batch.trash': '移入回收站',
      'batch.purge': '彻底删除',
      'batch.purgeConfirm': '确认彻底删除',
      'batch.cancel': '取消',
      'batch.loading': '正在读取会话…',
      'batch.loadFailed': '读取会话失败：{detail}',
      'batch.empty': '没有符合条件的会话',
      'batch.none': '请先勾选会话',
      'batch.working': '正在处理 {total} 个会话…',
      'batch.summary': '成功 {ok} 个，失败 {fail} 个',
      'batch.failures': '失败项',
      'batch.archived': '已归档',
      'batch.pinned': '已置顶',
      'batch.running': '运行中',
      'batch.subagents': '子代理 {n}',
      'batch.ungrouped': '未分组',
      'batch.refresh': '刷新',
      'batch.close': '关闭',
      'batch.headerFailed': '标题行入口不可用，已放到侧栏底部',
      'batch.exit': '退出批量',
      'batch.checkbox': '选择此会话',
      'batch.hostUnavailable': '宿主接口不可用：请重启 dsh web 后重试（批量接口需要宿主 0.1.1+）',
    }
    const en = TEXT

    /** 把字节数变成人话。 */
    function formatBytes(bytes) {
      const value = Number(bytes)
      if (!Number.isFinite(value) || value <= 0) return '0 B'
      if (value < 1024) return `${Math.round(value)} B`
      const units = ['KB', 'MB', 'GB', 'TB']
      let size = value / 1024
      let index = 0
      while (size >= 1024 && index < units.length - 1) {
        size /= 1024
        index += 1
      }
      return `${size >= 100 ? Math.round(size) : size.toFixed(1)} ${units[index]}`
    }

    /** 截断长 ID，保留头尾。 */
    function shortId(id) {
      const value = String(id ?? '')
      if (value.length <= 22) return value
      return `${value.slice(0, 12)}…${value.slice(-6)}`
    }

    /** 本地时间字符串。 */
    function formatTime(iso) {
      const time = Date.parse(String(iso ?? ''))
      if (!Number.isFinite(time)) return '—'
      try {
        return new Date(time).toLocaleString('zh-CN', { hour12: false })
      } catch {
        return new Date(time).toISOString()
      }
    }

    /** 统一取错误文本。 */
    function errorText(payload, fallback) {
      if (payload === null || payload === undefined) return fallback
      const detail = typeof payload.detail === 'string' && payload.detail !== '' ? payload.detail : ''
      const message = typeof payload.message === 'string' && payload.message !== '' ? payload.message : ''
      if (detail !== '' && message !== '') return `${message}（${detail}）`
      return message || detail || fallback
    }

    /** GET 一个插件接口。 */
    async function apiGet(path, params) {
      const url = new URL(`${API}${path}`, window.location.origin)
      for (const [key, value] of Object.entries(params ?? {})) {
        if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value))
      }
      const response = await fetch(url.toString(), { credentials: 'same-origin', headers: { accept: 'application/json' } })
      return await response.json().catch(() => ({ ok: false, message: `HTTP ${response.status}` }))
    }

    /** POST 一个插件接口。 */
    async function apiPost(path, body) {
      const response = await fetch(`${API}${path}`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(body ?? {}),
      })
      return await response.json().catch(() => ({ ok: false, message: `HTTP ${response.status}` }))
    }

    /** 删除/还原后让侧栏列表重新拉一次（冷会话没有活体事件可依赖）。 */
    function refreshSessionList(ctx) {
      try {
        const sessions = ctx.get('sessions')
        // 公共入口 `sessions.refresh()`；旧宿主只有 manager.refreshList 时再退回内部方法。
        if (typeof sessions?.refresh === 'function') {
          void sessions.refresh()
          return
        }
        const refresh = sessions?.manager?.refreshList
        if (typeof refresh === 'function') void refresh.call(sessions.manager)
      } catch {
        /* 刷新失败不影响删除结果，用户刷新页面即可 */
      }
    }

    /** 删掉的正好是当前打开的会话时，把主视图清回空态（官方归档也是这么做的）。 */
    function clearMainIfCurrent(ctx, sessionId) {
      try {
        const ui = ctx.get('uiWorkspace')
        if (ui === undefined || typeof ui.clearMain !== 'function') return
        if (ui.mainReference?.sessionId === sessionId) ui.clearMain()
      } catch {
        /* 官方主视图接口变化时忽略；侧栏刷新仍会执行 */
      }
    }

    // ---------------------------------------------------------------------
    // 确认弹窗的共享状态：行内按钮、菜单项写入，overlay 读取。
    // ---------------------------------------------------------------------
    const dialogStore = {
      value: null,
      listeners: new Set(),
      open(request) {
        this.value = request
        this.emit()
      },
      close() {
        this.value = null
        this.emit()
      },
      emit() {
        for (const listener of [...this.listeners]) listener()
      },
      subscribe(listener) {
        this.listeners.add(listener)
        return () => { this.listeners.delete(listener) }
      },
      getSnapshot() {
        return this.value
      },
    }

    /** 结果提示（成功/警告/失败），自动消失。 */
    const noticeStore = {
      value: null,
      timer: null,
      listeners: new Set(),
      show(notice) {
        this.value = notice
        if (this.timer !== null) clearTimeout(this.timer)
        this.timer = setTimeout(() => { this.value = null; this.emit() }, notice?.sticky === true ? 12000 : 6000)
        this.emit()
      },
      clear() {
        if (this.timer !== null) clearTimeout(this.timer)
        this.timer = null
        this.value = null
        this.emit()
      },
      emit() {
        for (const listener of [...this.listeners]) listener()
      },
      subscribe(listener) {
        this.listeners.add(listener)
        return () => { this.listeners.delete(listener) }
      },
      getSnapshot() {
        return this.value
      },
    }

    /** 订阅函数保持稳定引用，避免每次渲染都重订阅。 */
    const subscribeDialog = listener => dialogStore.subscribe(listener)
    const getDialogSnapshot = () => dialogStore.getSnapshot()
    const subscribeNotice = listener => noticeStore.subscribe(listener)
    const getNoticeSnapshot = () => noticeStore.getSnapshot()

    /** 订阅弹窗状态。 */
    function useDialogRequest() {
      return useSyncExternalStore(subscribeDialog, getDialogSnapshot, () => null)
    }

    /** 订阅提示状态。 */
    function useNotice() {
      return useSyncExternalStore(subscribeNotice, getNoticeSnapshot, () => null)
    }

    // ---------------------------------------------------------------------
    // 主题样式片段
    // ---------------------------------------------------------------------
    const styles = {
      iconButton: {
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '22px',
        height: '22px',
        padding: 0,
        border: 'none',
        borderRadius: '6px',
        background: 'transparent',
        color: 'var(--dsw-alias-label-secondary)',
        cursor: 'pointer',
      },
      iconButtonHover: {
        background: 'var(--dsw-alias-interactive-bg-hover)',
        color: 'var(--dsw-alias-state-error-primary)',
      },
      menuItem: {
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        width: '100%',
        padding: '6px 10px',
        border: 'none',
        borderRadius: '6px',
        background: 'transparent',
        color: 'var(--dsw-alias-state-error-primary)',
        fontSize: '13px',
        textAlign: 'left',
        cursor: 'pointer',
      },
      menuItemHover: {
        background: 'var(--dsw-alias-interactive-bg-hover-danger)',
      },
      backdrop: {
        position: 'fixed',
        inset: 0,
        zIndex: 4000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--dsw-alias-bg-mask-1, rgba(0, 0, 0, 0.42))',
        pointerEvents: 'auto',
      },
      card: {
        width: 'min(560px, 92vw)',
        maxHeight: '82vh',
        overflow: 'auto',
        padding: '20px',
        borderRadius: '12px',
        border: '1px solid var(--dsw-alias-border-l1)',
        background: 'var(--dsw-alias-bg-layer-2)',
        color: 'var(--dsw-alias-label-primary)',
        boxShadow: '0 12px 40px var(--dsw-alias-bg-overlay, rgba(0, 0, 0, 0.28))',
      },
      title: {
        margin: '0 0 14px',
        fontSize: '16px',
        fontWeight: 600,
        lineHeight: 1.4,
        wordBreak: 'break-word',
      },
      fieldRow: {
        display: 'grid',
        gridTemplateColumns: '88px 1fr',
        gap: '6px 12px',
        fontSize: '13px',
        lineHeight: 1.6,
      },
      fieldLabel: { color: 'var(--dsw-alias-label-tertiary)' },
      fieldValue: { color: 'var(--dsw-alias-label-primary)', wordBreak: 'break-word' },
      sectionTitle: {
        margin: '16px 0 6px',
        fontSize: '12px',
        fontWeight: 600,
        color: 'var(--dsw-alias-label-secondary)',
      },
      list: {
        margin: 0,
        padding: '0 0 0 18px',
        fontSize: '13px',
        lineHeight: 1.7,
        color: 'var(--dsw-alias-label-secondary)',
      },
      hint: {
        margin: '6px 0 0',
        fontSize: '12px',
        lineHeight: 1.6,
        color: 'var(--dsw-alias-label-tertiary)',
      },
      error: {
        margin: '10px 0 0',
        fontSize: '12px',
        lineHeight: 1.6,
        color: 'var(--dsw-alias-state-error-primary)',
        whiteSpace: 'pre-wrap',
      },
      footer: {
        display: 'flex',
        flexWrap: 'wrap',
        justifyContent: 'flex-end',
        gap: '8px',
        marginTop: '18px',
      },
      button: {
        padding: '7px 14px',
        borderRadius: '8px',
        border: '1px solid var(--dsw-alias-border-l1)',
        background: 'transparent',
        color: 'var(--dsw-alias-label-primary)',
        fontSize: '13px',
        cursor: 'pointer',
      },
      buttonPrimary: {
        border: '1px solid transparent',
        background: 'var(--dsw-alias-button-primary-fill)',
        color: 'var(--dsw-alias-label-primary-foreground)',
      },
      buttonDanger: {
        border: '1px solid var(--dsw-alias-state-error-primary)',
        color: 'var(--dsw-alias-state-error-primary)',
        background: 'transparent',
      },
      buttonDisabled: { opacity: 0.5, cursor: 'not-allowed' },
      checkboxRow: {
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        marginTop: '12px',
        fontSize: '13px',
        color: 'var(--dsw-alias-label-primary)',
      },
      notice: {
        position: 'fixed',
        right: '20px',
        bottom: '20px',
        zIndex: 4100,
        maxWidth: '380px',
        padding: '12px 14px',
        borderRadius: '10px',
        border: '1px solid var(--dsw-alias-border-l1)',
        background: 'var(--dsw-alias-bg-layer-3)',
        color: 'var(--dsw-alias-label-primary)',
        boxShadow: '0 8px 24px rgba(0, 0, 0, 0.24)',
        fontSize: '13px',
        lineHeight: 1.6,
        pointerEvents: 'auto',
        whiteSpace: 'pre-wrap',
        position: 'relative',
        paddingRight: '24px',
      },
      noticeClose: {
        position: 'absolute',
        top: '6px',
        right: '8px',
        border: 'none',
        background: 'transparent',
        color: 'var(--dsw-alias-label-tertiary)',
        fontSize: '14px',
        lineHeight: 1,
        cursor: 'pointer',
        padding: '2px',
      },
      cardPanel: {
        padding: '16px',
        borderRadius: '10px',
        border: '1px solid var(--dsw-alias-settings-card-stroke)',
        background: 'var(--dsw-alias-settings-card-fill)',
        marginBottom: '12px',
      },
      table: { width: '100%', borderCollapse: 'collapse', fontSize: '13px' },
      th: {
        textAlign: 'left',
        padding: '8px 10px',
        color: 'var(--dsw-alias-label-tertiary)',
        fontWeight: 500,
        borderBottom: '1px solid var(--dsw-alias-border-l1)',
        whiteSpace: 'nowrap',
      },
      td: {
        padding: '8px 10px',
        borderBottom: '1px solid var(--dsw-alias-border-l1)',
        color: 'var(--dsw-alias-label-primary)',
        verticalAlign: 'top',
      },
      smallButton: {
        padding: '3px 9px',
        borderRadius: '6px',
        border: '1px solid var(--dsw-alias-border-l1)',
        background: 'transparent',
        color: 'var(--dsw-alias-label-primary)',
        fontSize: '12px',
        cursor: 'pointer',
        marginRight: '6px',
      },
    }

