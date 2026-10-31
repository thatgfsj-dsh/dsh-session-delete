    // ---------------------------------------------------------------------
    // 批量管理：工作区标题行入口（React portal）+ 官方 shell.overlay 面板。
    // 官方标题行图标区没有公开插槽，这里用最小化的 DOM 锚点 + React 渲染；
    // 找不到标题行时自动降级到 sidebar.footer.action，并由 MutationObserver 自愈。
    // ---------------------------------------------------------------------
    const batchStore = {
      value: { open: false, headerStatus: 'pending' },
      listeners: new Set(),
      emit() { for (const listener of [...this.listeners]) listener() },
      subscribe(listener) { this.listeners.add(listener); return () => { this.listeners.delete(listener) } },
      getSnapshot() { return this.value },
      setOpen(open) { this.value = { ...this.value, open }; this.emit() },
      setHeaderStatus(status) {
        if (this.value.headerStatus === status) return
        this.value = { ...this.value, headerStatus: status }
        this.emit()
      },
    }
    const subscribeBatch = listener => batchStore.subscribe(listener)
    const getBatchSnapshot = () => batchStore.getSnapshot()
    function useBatch() {
      return useSyncExternalStore(subscribeBatch, getBatchSnapshot, getBatchSnapshot)
    }

    const batchStyles = {
      backdrop: {
        position: 'fixed', inset: 0, zIndex: 4050, display: 'flex',
        alignItems: 'center', justifyContent: 'center',
        background: 'var(--dsw-alias-bg-mask-1, rgba(0, 0, 0, 0.42))', pointerEvents: 'auto',
      },
      card: {
        width: 'min(820px, 94vw)', maxHeight: '86vh', display: 'flex', flexDirection: 'column',
        padding: '18px', borderRadius: '12px', border: '1px solid var(--dsw-alias-border-l1)',
        background: 'var(--dsw-alias-bg-layer-2)', color: 'var(--dsw-alias-label-primary)',
        boxShadow: '0 12px 40px var(--dsw-alias-bg-overlay, rgba(0, 0, 0, 0.28))',
      },
      header: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px' },
      title: { margin: 0, fontSize: '16px', fontWeight: 600 },
      desc: { margin: '4px 0 0', fontSize: '12px', lineHeight: 1.6, color: 'var(--dsw-alias-label-tertiary)' },
      close: { border: 'none', background: 'transparent', color: 'var(--dsw-alias-label-tertiary)', fontSize: '18px', cursor: 'pointer', lineHeight: 1 },
      toolbar: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px', margin: '12px 0 10px' },
      select: { padding: '4px 8px', borderRadius: '6px', border: '1px solid var(--dsw-alias-border-l1)', background: 'var(--dsw-alias-bg-layer-2)', color: 'var(--dsw-alias-label-primary)', fontSize: '12px' },
      search: { flex: 1, minWidth: '180px', padding: '5px 9px', borderRadius: '6px', border: '1px solid var(--dsw-alias-border-l1)', background: 'transparent', color: 'var(--dsw-alias-label-primary)', fontSize: '12px' },
      smallButton: { padding: '4px 10px', borderRadius: '6px', border: '1px solid var(--dsw-alias-border-l1)', background: 'transparent', color: 'var(--dsw-alias-label-primary)', fontSize: '12px', cursor: 'pointer' },
      selected: { marginLeft: 'auto', fontSize: '12px', color: 'var(--dsw-alias-label-secondary)' },
      list: { flex: 1, minHeight: '120px', overflow: 'auto', border: '1px solid var(--dsw-alias-border-l1)', borderRadius: '10px', padding: '6px' },
      group: { marginBottom: '8px' },
      groupTitle: { padding: '6px 8px 4px', fontSize: '12px', fontWeight: 600, color: 'var(--dsw-alias-label-tertiary)', overflowWrap: 'anywhere' },
      row: { display: 'flex', alignItems: 'center', gap: '8px', padding: '5px 8px', borderRadius: '6px', cursor: 'pointer' },
      rowTitle: { flex: 1, minWidth: 0, fontSize: '13px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
      rowMeta: { flex: 'none', fontSize: '11px', color: 'var(--dsw-alias-label-tertiary)' },
      badge: { flex: 'none', padding: '0 6px', borderRadius: '999px', fontSize: '11px', lineHeight: '16px', background: 'var(--dsw-alias-interactive-bg-hover)', color: 'var(--dsw-alias-label-secondary)' },
      badgeWarn: { flex: 'none', padding: '0 6px', borderRadius: '999px', fontSize: '11px', lineHeight: '16px', background: 'transparent', border: '1px solid var(--dsw-alias-state-error-primary)', color: 'var(--dsw-alias-state-error-primary)' },
      hint: { padding: '10px 4px', fontSize: '12px', color: 'var(--dsw-alias-label-tertiary)' },
      error: { padding: '10px 4px', fontSize: '12px', color: 'var(--dsw-alias-state-error-primary)', whiteSpace: 'pre-wrap' },
      failures: { marginTop: '8px', padding: '8px 10px', borderRadius: '8px', border: '1px solid var(--dsw-alias-state-error-primary)', fontSize: '12px', color: 'var(--dsw-alias-state-error-primary)', maxHeight: '120px', overflow: 'auto', whiteSpace: 'pre-wrap' },
      footer: { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '8px', marginTop: '12px' },
      checkboxRow: { display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'var(--dsw-alias-label-secondary)' },
      primary: { padding: '7px 14px', borderRadius: '8px', border: '1px solid transparent', background: 'var(--dsw-alias-button-primary-fill)', color: 'var(--dsw-alias-label-primary-foreground)', fontSize: '13px', cursor: 'pointer' },
      danger: { padding: '7px 14px', borderRadius: '8px', border: '1px solid var(--dsw-alias-state-error-primary)', background: 'transparent', color: 'var(--dsw-alias-state-error-primary)', fontSize: '13px', cursor: 'pointer' },
      disabled: { opacity: 0.5, cursor: 'not-allowed' },
      progress: { marginLeft: 'auto', fontSize: '12px', color: 'var(--dsw-alias-label-secondary)' },
      trigger: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '28px', height: '28px', padding: 0, border: 'none', borderRadius: 'var(--dsw-radius-sm, 6px)', background: 'transparent', color: 'var(--dsw-alias-label-secondary)', cursor: 'pointer', flex: 'none' },
      footerAction: { display: 'flex', alignItems: 'center', gap: '8px', width: '100%', padding: '6px 10px', border: 'none', borderRadius: '6px', background: 'transparent', color: 'var(--dsw-alias-label-secondary)', fontSize: '13px', cursor: 'pointer' },
    }

    /** 批量管理图标（清单 + 勾）。 */
    function BatchIcon({ size = 14 }) {
      return h('svg', {
        width: size, height: size, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor',
        strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true',
      },
        h('path', { d: 'M2.5 4h7M2.5 8h7M2.5 12h4' }),
        h('path', { d: 'M11 10.5l1.6 1.6 2.4-2.6' }),
      )
    }

    /** 把「批量管理」按钮挂到工作区标题行图标区后面（React portal）。 */
    function BatchHeaderMount({ t }) {
      const [container, setContainer] = useState(null)
      useEffect(() => {
        let active = true
        let host = null
        let timer = null
        const findHeader = () => {
          const nodes = Array.from(document.querySelectorAll('[class*="_sectionHeader"]'))
          for (const node of nodes) {
            const text = node.textContent ?? ''
            if (text.includes('工作区') || text.includes('Workspaces')) return node
          }
          return undefined
        }
        const attach = () => {
          if (!active) return
          if (host !== null && host.isConnected) return
          const header = findHeader()
          if (header === undefined) return
          host = document.createElement('span')
          host.dataset.dshSessionDeleteBatch = ''
          host.style.cssText = 'display:inline-flex;align-items:center;flex:none;margin-left:4px'
          header.appendChild(host)
          setContainer(host)
          batchStore.setHeaderStatus('mounted')
        }
        attach()
        timer = setTimeout(() => { if (active && host === null) batchStore.setHeaderStatus('failed') }, 3000)
        const observer = new MutationObserver(() => {
          if (!active) return
          if (host !== null && host.isConnected) return
          host = null
          setContainer(null)
          attach()
        })
        observer.observe(document.body, { childList: true, subtree: true })
        return () => {
          active = false
          clearTimeout(timer)
          observer.disconnect()
          if (host !== null) host.remove()
        }
      }, [])
      if (container === null) return null
      return ReactDOM.createPortal(h('button', {
        type: 'button',
        title: t('batch.open'),
        'aria-label': t('batch.open'),
        style: batchStyles.trigger,
        onClick: () => batchStore.setOpen(true),
      }, h(BatchIcon, { size: 14 })), container)
    }

    /** 标题行入口不可用时的侧栏底部兜底入口。 */
    function BatchFooterFallback({ t }) {
      const state = useBatch()
      if (state.headerStatus !== 'failed') return null
      return h('button', {
        type: 'button',
        title: t('batch.headerFailed'),
        style: batchStyles.footerAction,
        onClick: () => batchStore.setOpen(true),
      }, h(BatchIcon, { size: 14 }), h('span', null, t('batch.open')))
    }

    /** 批量管理面板：按工作区分组、勾选、批量移入回收站/彻底删除。 */
    function BatchPanel({ ctx, t }) {
      const state = useBatch()
      return state.open ? h(BatchPanelInner, { ctx, t }) : null
    }

    function BatchPanelInner({ ctx, t }) {
      const [list, setList] = useState({ sessions: [], workspaces: [], total: 0 })
      const [phase, setPhase] = useState('loading')
      const [error, setError] = useState('')
      const [filter, setFilter] = useState('all')
      const [query, setQuery] = useState('')
      const [selected, setSelected] = useState(() => new Set())
      const [stopFirst, setStopFirst] = useState(false)
      const [busy, setBusy] = useState(false)
      const [result, setResult] = useState(null)
      const [armed, setArmed] = useState(false)

      const load = useCallback(async () => {
        setPhase('loading')
        setError('')
        try {
          const payload = await apiGet('/sessions')
          if (payload?.ok === true) {
            setList({ sessions: payload.sessions ?? [], workspaces: payload.workspaces ?? [], total: payload.total ?? 0 })
            setPhase('ready')
          } else {
            setError(errorText(payload, t('batch.loadFailed', { detail: '未知错误' })))
            setPhase('error')
          }
        } catch (failure) {
          setError(t('batch.loadFailed', { detail: failure instanceof Error ? failure.message : String(failure) }))
          setPhase('error')
        }
      }, [t])

      useEffect(() => { void load() }, [load])

      const normalizedQuery = query.trim().toLowerCase()
      const filtered = list.sessions.filter(session => {
        if (filter === 'archived' && session.archived !== true) return false
        if (filter === 'active' && session.archived === true) return false
        if (normalizedQuery === '') return true
        const haystack = `${session.title ?? ''}\n${session.workspace?.title ?? ''}\n${session.workspace?.path ?? ''}\n${session.cwd ?? ''}`.toLowerCase()
        return haystack.includes(normalizedQuery)
      })
      const groupMap = new Map()
      for (const session of filtered) {
        const key = session.workspace?.id ?? ''
        if (!groupMap.has(key)) {
          groupMap.set(key, { key, title: session.workspace?.title ?? t('batch.ungrouped'), items: [] })
        }
        groupMap.get(key).items.push(session)
      }
      const groups = [...groupMap.values()]
      const visibleIds = filtered.map(session => session.sessionId)
      const selectedCount = selected.size
      const titleOf = id => list.sessions.find(session => session.sessionId === id)?.title || id

      const toggle = id => setSelected(previous => {
        const next = new Set(previous)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        return next
      })
      const toggleAll = () => setSelected(previous => (
        previous.size >= visibleIds.length && visibleIds.length > 0 ? new Set() : new Set(visibleIds)
      ))
      const invert = () => setSelected(previous => {
        const next = new Set()
        for (const id of visibleIds) if (!previous.has(id)) next.add(id)
        return next
      })

      const run = async (mode) => {
        if (busy || selectedCount === 0) return
        setBusy(true)
        setResult(null)
        setArmed(false)
        try {
          const payload = await apiPost('/batch-delete', {
            sessionIds: [...selected],
            mode,
            stopIfRunning: stopFirst,
          })
          if (payload?.ok !== true) {
            noticeStore.show({ kind: 'error', text: errorText(payload, t('batch.loadFailed', { detail: '未知错误' })) })
            return
          }
          setResult(payload)
          const failed = payload.summary?.failed ?? 0
          noticeStore.show({
            kind: failed > 0 ? 'warn' : 'ok',
            text: t('batch.summary', { ok: payload.summary?.succeeded ?? 0, fail: failed }),
            sticky: failed > 0,
          })
          const deleted = (payload.results ?? []).filter(item => item.ok).map(item => item.sessionId)
          refreshSessionList(ctx)
          for (const id of deleted) clearMainIfCurrent(ctx, id)
          setSelected(new Set())
          await load()
        } catch (failure) {
          noticeStore.show({ kind: 'error', text: t('batch.loadFailed', { detail: failure instanceof Error ? failure.message : String(failure) }) })
        } finally {
          setBusy(false)
        }
      }

      const renderRow = (session) => {
        const badges = []
        if (session.running === true) badges.push(h('span', { key: 'running', style: batchStyles.badgeWarn }, t('batch.running')))
        if (session.archived === true) badges.push(h('span', { key: 'archived', style: batchStyles.badge }, t('batch.archived')))
        if (session.pinned === true) badges.push(h('span', { key: 'pinned', style: batchStyles.badge }, t('batch.pinned')))
        if (Number(session.subagentCount) > 0) badges.push(h('span', { key: 'subagents', style: batchStyles.badge }, t('batch.subagents', { n: session.subagentCount })))
        return h('label', { key: session.sessionId, style: batchStyles.row },
          h('input', {
            type: 'checkbox',
            checked: selected.has(session.sessionId),
            disabled: busy,
            onChange: () => toggle(session.sessionId),
          }),
          h('span', { style: batchStyles.rowTitle, title: session.title || session.sessionId }, session.title || t('settings.untitled')),
          ...badges,
          h('span', { style: batchStyles.rowMeta }, formatBytes(session.sizeBytes)),
        )
      }

      const failures = (result?.results ?? []).filter(item => item.ok !== true)
      const disabled = busy || selectedCount === 0

      return h('div', {
        style: batchStyles.backdrop,
        role: 'presentation',
        onMouseDown: event => { if (event.target === event.currentTarget && !busy) batchStore.setOpen(false) },
      }, h('div', {
        role: 'dialog',
        'aria-modal': 'true',
        'aria-label': t('batch.title'),
        style: batchStyles.card,
      },
        h('div', { style: batchStyles.header },
          h('div', null,
            h('h2', { style: batchStyles.title }, t('batch.title')),
            h('p', { style: batchStyles.desc }, t('batch.desc')),
          ),
          h('button', {
            type: 'button',
            'aria-label': t('batch.close'),
            style: batchStyles.close,
            disabled: busy,
            onClick: () => batchStore.setOpen(false),
          }, '×'),
        ),
        h('div', { style: batchStyles.toolbar },
          h('select', {
            value: filter,
            style: batchStyles.select,
            disabled: busy,
            onChange: event => setFilter(event.target.value),
          },
            h('option', { value: 'all' }, t('batch.filter.all')),
            h('option', { value: 'active' }, t('batch.filter.active')),
            h('option', { value: 'archived' }, t('batch.filter.archived')),
          ),
          h('input', {
            type: 'search',
            value: query,
            placeholder: t('batch.search'),
            style: batchStyles.search,
            disabled: busy,
            onChange: event => setQuery(event.target.value),
          }),
          h('button', { type: 'button', style: batchStyles.smallButton, disabled: busy, onClick: toggleAll }, t('batch.selectAll')),
          h('button', { type: 'button', style: batchStyles.smallButton, disabled: busy, onClick: invert }, t('batch.invert')),
          h('button', { type: 'button', style: batchStyles.smallButton, disabled: busy, onClick: () => setSelected(new Set()) }, t('batch.clear')),
          h('button', { type: 'button', style: batchStyles.smallButton, disabled: busy, onClick: () => void load() }, t('batch.refresh')),
          h('span', { style: batchStyles.selected }, t('batch.selected', { n: selectedCount })),
        ),
        phase === 'loading' ? h('p', { style: batchStyles.hint }, t('batch.loading')) : null,
        phase === 'error' ? h('p', { style: batchStyles.error }, error) : null,
        phase === 'ready' && groups.length === 0 ? h('p', { style: batchStyles.hint }, t('batch.empty')) : null,
        phase === 'ready' && groups.length > 0 ? h('div', { style: batchStyles.list },
          groups.map(group => h('div', { key: group.key || 'ungrouped', style: batchStyles.group },
            h('div', { style: batchStyles.groupTitle }, `${group.title}（${group.items.length}）`),
            group.items.map(renderRow),
          )),
        ) : null,
        failures.length > 0 ? h('div', { style: batchStyles.failures },
          `${t('batch.failures')}：\n` + failures.map(item => `${titleOf(item.sessionId)}：${item.message ?? item.code}`).join('\n'),
        ) : null,
        h('div', { style: batchStyles.footer },
          h('label', { style: batchStyles.checkboxRow },
            h('input', { type: 'checkbox', checked: stopFirst, disabled: busy, onChange: event => setStopFirst(event.target.checked) }),
            h('span', null, t('batch.stop')),
          ),
          busy ? h('span', { style: batchStyles.progress }, t('batch.working', { total: selectedCount })) : null,
          h('button', {
            type: 'button',
            style: busy ? { ...batchStyles.smallButton, ...batchStyles.disabled } : batchStyles.smallButton,
            disabled: busy,
            onClick: () => batchStore.setOpen(false),
          }, t('batch.cancel')),
          h('button', {
            type: 'button',
            style: disabled ? { ...batchStyles.primary, ...batchStyles.disabled } : batchStyles.primary,
            disabled,
            onClick: () => void run('trash'),
          }, t('batch.trash')),
          h('button', {
            type: 'button',
            style: disabled ? { ...batchStyles.danger, ...batchStyles.disabled } : batchStyles.danger,
            disabled,
            onClick: () => {
              if (!armed) { setArmed(true); return }
              void run('purge')
            },
            onBlur: () => setArmed(false),
          }, armed ? t('batch.purgeConfirm') : t('batch.purge')),
        ),
      ))
    }
