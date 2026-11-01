    // ---------------------------------------------------------------------
    // 批量管理：勾选框注入侧栏会话行前面，底部浮动栏做批量操作。
    // 全选只覆盖当前可见行（DOM 中已挂载勾选框的行），跨工作区/折叠组不会被一次选中。
    // 移入回收站/彻底删除都走模态确认；官方标题行没有插槽，入口用 DOM 锚点 + 底部兜底。
    // 官方会话行示例：<div data-row-key="session:<id>">…</div>（注入/整行点击都依赖这个属性）。
    // ---------------------------------------------------------------------
    const MAX_SELECT = 200
    const batchStore = {
      value: { mode: false, selected: new Set(), headerStatus: 'pending' },
      listeners: new Set(),
      emit() { for (const listener of [...this.listeners]) listener() },
      subscribe(listener) { this.listeners.add(listener); return () => { this.listeners.delete(listener) } },
      getSnapshot() { return this.value },
      setMode(mode) {
        this.value = { ...this.value, mode, selected: mode ? this.value.selected : new Set() }
        this.emit()
      },
      toggle(id) {
        const next = new Set(this.value.selected)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        this.value = { ...this.value, selected: next }
        this.emit()
      },
      select(ids) {
        this.value = { ...this.value, selected: new Set(ids) }
        this.emit()
      },
      clear() { this.value = { ...this.value, selected: new Set() }; this.emit() },
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

    /** 当前侧栏已挂载勾选框的会话 ID（即用户看得见的行）。 */
    function visibleSessionIds() {
      return Array.from(document.querySelectorAll('[data-dsh-session-delete-select]'))
        .map(node => node.getAttribute('data-dsh-session-delete-select') ?? '')
        .filter(id => id !== '')
    }

    /** 从会话行 DOM 里取标题（失败项展示用，拿不到就退回 ID）。 */
    function rowTitleOf(sessionId) {
      const host = document.querySelector(`[data-dsh-session-delete-select="${sessionId}"]`)
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
      disabled: { opacity: 0.5, cursor: 'not-allowed' },
      checkboxRow: { display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'var(--dsw-alias-label-secondary)' },
      failures: { flexBasis: '100%', maxHeight: '120px', overflow: 'auto', padding: '6px 8px', borderRadius: '8px', border: '1px solid var(--dsw-alias-state-error-primary)', color: 'var(--dsw-alias-state-error-primary)', fontSize: '11px', lineHeight: 1.6, whiteSpace: 'pre-wrap' },
      progress: { fontSize: '12px', color: 'var(--dsw-alias-label-secondary)' },
      mask: { position: 'fixed', inset: 0, zIndex: 4090, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--dsw-alias-bg-mask-1, rgba(0, 0, 0, 0.42))', pointerEvents: 'auto' },
      confirmCard: { width: 'min(560px, 92vw)', maxHeight: '84vh', overflow: 'auto', display: 'flex', flexDirection: 'column', gap: '10px', padding: '18px', borderRadius: '12px', border: '1px solid var(--dsw-alias-border-l1)', background: 'var(--dsw-alias-bg-layer-2)', color: 'var(--dsw-alias-label-primary)', boxShadow: '0 12px 40px var(--dsw-alias-bg-overlay, rgba(0, 0, 0, 0.28))' },
      confirmTitle: { margin: 0, fontSize: '16px', fontWeight: 600 },
      confirmText: { margin: 0, fontSize: '13px', lineHeight: 1.7, color: 'var(--dsw-alias-label-secondary)', whiteSpace: 'pre-wrap' },
      confirmWarning: { margin: 0, fontSize: '13px', lineHeight: 1.7, color: 'var(--dsw-alias-state-error-primary)', fontWeight: 500 },
      confirmFooter: { display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '4px' },
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
      const state = useBatch()
      const [container, setContainer] = useState(null)
      useEffect(() => {
        let active = true
        let host = null
        let failed = false
        let timer = null
        const probes = new Set()
        const findHeader = () => {
          const nodes = Array.from(document.querySelectorAll('[class*="_sectionHeader"]'))
          for (const node of nodes) {
            const text = node.textContent ?? ''
            if (text.includes('工作区') || text.includes('Workspaces')) return node
          }
          return undefined
        }
        const attach = () => {
          if (!active || failed) return
          if (host !== null && host.isConnected) return
          const header = findHeader()
          if (header === undefined) return
          host = document.createElement('span')
          host.dataset.dshSessionDeleteBatch = ''
          host.style.cssText = 'display:inline-flex;align-items:center;flex:none;margin-left:4px'
          header.appendChild(host)
          setContainer(host)
          batchStore.setHeaderStatus('mounted')
          // 侧栏折叠（rail）时标题行的图标区会被 overflow 裁掉，挂上了也看不见；此时降级到底部入口。
          // 要等 portal 渲染出按钮后才能量到宽度，所以延后检查。
          const probe = setTimeout(() => {
            if (!active || host === null) return
            const button = host.firstElementChild
            if (button === null) return
            const rect = button.getBoundingClientRect()
            const headerRect = header.getBoundingClientRect()
            if (rect.width < 2 || rect.right <= 0 || rect.left >= headerRect.right - 1) {
              failed = true
              host.remove()
              host = null
              setContainer(null)
              batchStore.setHeaderStatus('failed')
            }
          }, 300)
          probes.add(probe)
        }
        const retry = () => {
          if (!active || !failed) return
          failed = false
          batchStore.setHeaderStatus('pending')
          attach()
        }
        attach()
        timer = setTimeout(() => { if (active && host === null && !failed) batchStore.setHeaderStatus('failed') }, 3000)
        const observer = new MutationObserver(() => {
          if (!active) return
          if (host !== null && host.isConnected) return
          host = null
          setContainer(null)
          attach()
        })
        observer.observe(document.body, { childList: true, subtree: true })
        window.addEventListener('resize', retry)
        return () => {
          active = false
          clearTimeout(timer)
          for (const probe of probes) clearTimeout(probe)
          observer.disconnect()
          window.removeEventListener('resize', retry)
          if (host !== null) host.remove()
        }
      }, [])
      if (container === null) return null
      return ReactDOM.createPortal(h('button', {
        type: 'button',
        title: state.mode ? t('batch.exit') : t('batch.open'),
        'aria-label': state.mode ? t('batch.exit') : t('batch.open'),
        'aria-pressed': state.mode,
        style: state.mode ? { ...batchStyles.trigger, ...batchStyles.triggerActive } : batchStyles.trigger,
        onClick: () => batchStore.setMode(!state.mode),
      }, h(BatchIcon, { size: 14 })), container)
    }

    /** 标题行入口不可用时的侧栏底部兜底入口。 */
    function BatchFooterFallback({ t }) {
      const state = useBatch()
      if (state.headerStatus !== 'failed') return null
      return h('button', {
        type: 'button',
        title: state.mode ? t('batch.exit') : t('batch.open'),
        style: batchStyles.footerAction,
        onClick: () => batchStore.setMode(!state.mode),
      }, h(BatchIcon, { size: 14 }), h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis' } }, state.mode ? t('batch.exit') : t('batch.open')))
    }

    /**
     * 会话行前面的勾选框：注入官方会话行 DOM（`data-row-key="session:<id>"`）最前面。
     * MutationObserver + 400ms 轮询补挂；多选模式下点击整行也切换勾选（不打开会话）。
     */
    function BatchRowInjector({ t }) {
      const state = useBatch()
      const inputsRef = useRef(new Map())
      useEffect(() => {
        if (!state.mode) return undefined
        let active = true
        let scheduled = false
        const sync = () => {
          const selected = batchStore.getSnapshot().selected
          for (const [sessionId, entry] of inputsRef.current) entry.input.checked = selected.has(sessionId)
        }
        const decorate = () => {
          if (!active) return
          for (const [sessionId, entry] of [...inputsRef.current]) {
            if (!entry.host.isConnected) {
              entry.host.remove()
              inputsRef.current.delete(sessionId)
            }
          }
          for (const row of document.querySelectorAll('[data-row-key^="session:"]')) {
            const key = row.getAttribute('data-row-key') ?? ''
            const sessionId = key.slice('session:'.length)
            if (sessionId === '') continue
            if (row.dataset.dshSessionDeleteRow !== '1') {
              row.dataset.dshSessionDeleteRow = '1'
              row.addEventListener('click', event => {
                if (!batchStore.getSnapshot().mode) return
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
            input.addEventListener('click', event => {
              event.preventDefault()
              event.stopPropagation()
              batchStore.toggle(sessionId)
            })
            host.appendChild(input)
            row.insertBefore(host, row.firstChild)
            inputsRef.current.set(sessionId, { host, input })
          }
          sync()
        }
        const schedule = () => {
          if (scheduled) return
          scheduled = true
          requestAnimationFrame(() => { scheduled = false; decorate() })
        }
        decorate()
        const observer = new MutationObserver(schedule)
        observer.observe(document.body, { childList: true, subtree: true })
        const timer = setInterval(schedule, 400)
        return () => {
          active = false
          observer.disconnect()
          clearInterval(timer)
          for (const entry of inputsRef.current.values()) entry.host.remove()
          inputsRef.current.clear()
        }
      }, [state.mode, t])
      useEffect(() => {
        if (!state.mode) return
        for (const [sessionId, entry] of inputsRef.current) entry.input.checked = state.selected.has(sessionId)
      }, [state])
      return null
    }

    /** 批量操作确认弹窗：列数量/大小/工作区/运行中/归档/子代理，必须显式确认。 */
    function BatchConfirmDialog({ ctx, t, mode, selected, stopFirst, busy, metaMap, onCancel, onConfirm }) {
      const stats = { size: 0, running: 0, archived: 0, subagents: 0, workspaces: new Map() }
      for (const id of selected) {
        const meta = metaMap?.get(id)
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
      return h('div', {
        style: batchStyles.mask,
        role: 'presentation',
        onMouseDown: event => { if (event.target === event.currentTarget && !busy) onCancel() },
      }, h('div', {
        role: 'dialog',
        'aria-modal': 'true',
        'aria-label': purge ? t('batch.confirm.purgeTitle') : t('batch.confirm.trashTitle'),
        style: batchStyles.confirmCard,
      },
        h('h2', { style: batchStyles.confirmTitle }, purge ? t('batch.confirm.purgeTitle') : t('batch.confirm.trashTitle')),
        h('p', { style: batchStyles.confirmText }, t('batch.confirm.summary', { n: selected.length, size: formatBytes(stats.size) })),
        stats.workspaces.size > 0 ? h('p', { style: batchStyles.confirmText }, t('batch.confirm.workspaces', { list: workspaceText })) : null,
        (stats.running + stats.archived + stats.subagents) > 0 ? h('p', { style: batchStyles.confirmText }, t('batch.confirm.breakdown', { running: stats.running, archived: stats.archived, subagents: stats.subagents })) : null,
        h('p', { style: batchStyles.confirmText }, stopFirst ? t('batch.confirm.stopOn') : t('batch.confirm.stopOff')),
        h('p', { style: purge ? batchStyles.confirmWarning : batchStyles.confirmText }, purge ? t('batch.confirm.purgeWarning') : t('batch.confirm.trashNote')),
        h('div', { style: batchStyles.confirmFooter },
          h('button', { type: 'button', style: batchStyles.button, disabled: busy, onClick: onCancel }, t('batch.confirm.cancel')),
          h('button', {
            type: 'button',
            style: busy ? { ...(purge ? batchStyles.danger : batchStyles.primary), ...batchStyles.disabled } : (purge ? batchStyles.danger : batchStyles.primary),
            disabled: busy,
            onClick: onConfirm,
          }, purge ? t('batch.confirm.purgeConfirm') : t('batch.confirm.trashConfirm')),
        ),
      ))
    }

    /** 底部浮动操作栏：全选可见/清空/先停/确认后批量移入回收站或彻底删除/退出。 */
    function BatchToolbar({ ctx, t }) {
      const state = useBatch()
      const [busy, setBusy] = useState(false)
      const [stopFirst, setStopFirst] = useState(false)
      const [confirmMode, setConfirmMode] = useState(null)
      const [result, setResult] = useState(null)
      const [metaMap, setMetaMap] = useState(null)
      const busyRef = useRef(false)

      useEffect(() => {
        if (!state.mode) return
        const onKeyDown = event => {
          if (event.key !== 'Escape' || busyRef.current) return
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

      const run = async mode => {
        if (busyRef.current || state.selected.size === 0) return
        busyRef.current = true
        setBusy(true)
        setResult(null)
        try {
          const ids = [...state.selected]
          const payload = await apiPost('/batch-delete', { sessionIds: ids, mode, stopIfRunning: stopFirst })
          if (payload?.ok !== true) {
            fail(errorText(payload, t('batch.loadFailed', { detail: '未知错误' })))
            return
          }
          setResult(payload)
          const failedItems = (payload.results ?? []).filter(item => item.ok !== true)
          const failed = payload.summary?.failed ?? failedItems.length
          noticeStore.show({
            kind: failed > 0 ? 'warn' : 'ok',
            text: failed > 0 ? `${t('batch.summary', { ok: payload.summary?.succeeded ?? 0, fail: failed })}；${t('batch.failedKept')}` : t('batch.summary', { ok: payload.summary?.succeeded ?? 0, fail: 0 }),
            sticky: failed > 0,
          })
          const deleted = (payload.results ?? []).filter(item => item.ok).map(item => item.sessionId)
          refreshSessionList(ctx)
          for (const id of deleted) clearMainIfCurrent(ctx, id)
          if (failed === 0) {
            batchStore.clear()
            batchStore.setMode(false)
          } else {
            batchStore.select(failedItems.map(item => item.sessionId))
          }
        } catch (error) {
          fail(errorText(error, t('batch.loadFailed', { detail: '未知错误' })))
        } finally {
          busyRef.current = false
          setBusy(false)
        }
      }

      const openConfirm = async mode => {
        if (busyRef.current || state.selected.size === 0) return
        setConfirmMode(mode)
        if (metaMap !== null) return
        try {
          const payload = await apiGet('/sessions')
          if (payload?.ok === true && Array.isArray(payload.sessions)) {
            setMetaMap(new Map(payload.sessions.map(session => [session.sessionId, session])))
          }
        } catch {
          /* 拿不到元数据时确认框只显示数量，不影响删除 */
        }
      }

      const selectAllVisible = () => {
        const ids = visibleSessionIds()
        if (ids.length === 0) return
        batchStore.select(ids.slice(0, MAX_SELECT))
        if (ids.length > MAX_SELECT) noticeStore.show({ kind: 'warn', text: t('batch.selectAllCapped'), sticky: true })
      }

      const failures = (result?.results ?? []).filter(item => item.ok !== true)
      const disabled = busy || selectedCount === 0
      const titleOf = id => metaMap?.get(id)?.title || rowTitleOf(id) || shortId(id)

      const bar = h('div', { style: batchStyles.bar, role: 'region', 'aria-label': t('batch.title') },
        h('span', { style: batchStyles.count }, t('batch.selected', { n: selectedCount })),
        h('button', { type: 'button', style: batchStyles.button, disabled: busy, onClick: selectAllVisible }, t('batch.selectAllVisible')),
        h('button', { type: 'button', style: batchStyles.button, disabled: busy, onClick: () => batchStore.clear() }, t('batch.clear')),
        h('label', { style: batchStyles.checkboxRow },
          h('input', { type: 'checkbox', checked: stopFirst, disabled: busy, onChange: event => setStopFirst(event.target.checked) }),
          h('span', null, t('batch.stop')),
        ),
        busy ? h('span', { style: batchStyles.progress }, t('batch.working', { total: selectedCount })) : null,
        h('button', {
          type: 'button',
          style: disabled ? { ...batchStyles.primary, ...batchStyles.disabled } : batchStyles.primary,
          disabled,
          onClick: () => void openConfirm('trash'),
        }, t('batch.trash')),
        h('button', {
          type: 'button',
          style: disabled ? { ...batchStyles.danger, ...batchStyles.disabled } : batchStyles.danger,
          disabled,
          onClick: () => void openConfirm('purge'),
        }, t('batch.purge')),
        h('button', { type: 'button', style: batchStyles.button, disabled: busy, onClick: () => batchStore.setMode(false) }, t('batch.exit')),
        failures.length > 0 ? h('div', { style: batchStyles.failures },
          `${t('batch.failures')}\n` + failures.map(item => t('batch.failureLine', {
            title: titleOf(item.sessionId),
            id: shortId(item.sessionId),
            detail: item.detail || item.message || item.code,
          })).join('\n'),
        ) : null,
      )

      return h(React.Fragment, null,
        bar,
        confirmMode === null ? null : h(BatchConfirmDialog, {
          ctx,
          t,
          mode: confirmMode,
          selected: [...state.selected],
          stopFirst,
          busy,
          metaMap,
          onCancel: () => { if (!busy) setConfirmMode(null) },
          onConfirm: () => {
            if (busyRef.current) return
            const mode = confirmMode
            setConfirmMode(null)
            void run(mode)
          },
        }),
      )
    }
