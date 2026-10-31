    // ---------------------------------------------------------------------
    // 批量管理（v0.1.2）：勾选框直接长在侧栏会话行前面（官方 leading 插槽），
    // 底部浮动操作栏负责全选/清空/批量移入回收站/彻底删除。
    // 官方 leading 单元格只在空闲行挂载，运行中/已归档行不显示勾选框（契约限制）。
    // ---------------------------------------------------------------------
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

    const batchStyles = {
      trigger: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '28px', height: '28px', padding: 0, border: 'none', borderRadius: 'var(--dsw-radius-sm, 6px)', background: 'transparent', color: 'var(--dsw-alias-label-secondary)', cursor: 'pointer', flex: 'none' },
      triggerActive: { background: 'var(--dsw-alias-interactive-bg-hover)', color: 'var(--dsw-alias-state-business-primary)' },
      footerAction: { display: 'flex', alignItems: 'center', gap: '8px', width: '100%', padding: '6px 10px', border: 'none', borderRadius: '6px', background: 'transparent', color: 'var(--dsw-alias-label-secondary)', fontSize: '13px', cursor: 'pointer' },
      bar: { position: 'fixed', left: '50%', bottom: '24px', transform: 'translateX(-50%)', zIndex: 4060, display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '8px', maxWidth: '92vw', padding: '10px 14px', borderRadius: '12px', border: '1px solid var(--dsw-alias-border-l1)', background: 'var(--dsw-alias-bg-layer-3)', color: 'var(--dsw-alias-label-primary)', boxShadow: '0 12px 40px var(--dsw-alias-bg-overlay, rgba(0, 0, 0, 0.28))', pointerEvents: 'auto' },
      count: { fontSize: '13px', fontWeight: 600, marginRight: '4px' },
      button: { padding: '5px 11px', borderRadius: '7px', border: '1px solid var(--dsw-alias-border-l1)', background: 'transparent', color: 'var(--dsw-alias-label-primary)', fontSize: '12px', cursor: 'pointer' },
      primary: { padding: '5px 12px', borderRadius: '7px', border: '1px solid transparent', background: 'var(--dsw-alias-button-primary-fill)', color: 'var(--dsw-alias-label-primary-foreground)', fontSize: '12px', cursor: 'pointer' },
      danger: { padding: '5px 12px', borderRadius: '7px', border: '1px solid var(--dsw-alias-state-error-primary)', background: 'transparent', color: 'var(--dsw-alias-state-error-primary)', fontSize: '12px', cursor: 'pointer' },
      disabled: { opacity: 0.5, cursor: 'not-allowed' },
      checkboxRow: { display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'var(--dsw-alias-label-secondary)' },
      failures: { flexBasis: '100%', maxHeight: '110px', overflow: 'auto', padding: '6px 8px', borderRadius: '8px', border: '1px solid var(--dsw-alias-state-error-primary)', color: 'var(--dsw-alias-state-error-primary)', fontSize: '11px', lineHeight: 1.6, whiteSpace: 'pre-wrap' },
      progress: { fontSize: '12px', color: 'var(--dsw-alias-label-secondary)' },
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
      }, h(BatchIcon, { size: 14 }), h('span', null, state.mode ? t('batch.exit') : t('batch.open')))
    }

    /**
     * 会话行前面的勾选框：直接注入到官方会话行 DOM（`data-row-key="session:<id>"`）最前面。
     * 官方 leading 插槽只在空闲行挂载、且会被状态点占用，无法覆盖全部行；这里用 MutationObserver
     * 跟随行节点重建自动补挂，退出多选时整体清理。
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
            if (sessionId === '' || inputsRef.current.has(sessionId)) continue
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
        return () => {
          active = false
          observer.disconnect()
          for (const entry of inputsRef.current.values()) entry.host.remove()
          inputsRef.current.clear()
        }
      }, [state.mode, t])
      // 选择变化时同步勾选状态（不重建 DOM）。
      useEffect(() => {
        if (!state.mode) return
        for (const [sessionId, entry] of inputsRef.current) entry.input.checked = state.selected.has(sessionId)
      }, [state])
      return null
    }

    /** 底部浮动操作栏：全选/清空/先停/批量移入回收站/彻底删除/退出。 */
    function BatchToolbar({ ctx, t }) {
      const state = useBatch()
      const [busy, setBusy] = useState(false)
      const [stopFirst, setStopFirst] = useState(false)
      const [armed, setArmed] = useState(false)
      const [result, setResult] = useState(null)

      useEffect(() => {
        if (!state.mode) return
        const onKeyDown = event => {
          if (event.key === 'Escape' && !busy) batchStore.setMode(false)
        }
        window.addEventListener('keydown', onKeyDown)
        return () => window.removeEventListener('keydown', onKeyDown)
      }, [state.mode, busy])

      if (!state.mode) return null
      const selectedCount = state.selected.size

      const fail = text => noticeStore.show({ kind: 'error', text })

      const run = async (mode) => {
        if (busy || selectedCount === 0) return
        setBusy(true)
        setResult(null)
        setArmed(false)
        try {
          const payload = await apiPost('/batch-delete', {
            sessionIds: [...state.selected],
            mode,
            stopIfRunning: stopFirst,
          })
          if (payload?.ok !== true) {
            fail(errorText(payload, t('batch.loadFailed', { detail: '未知错误' })))
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
          batchStore.clear()
          if (failed === 0) batchStore.setMode(false)
        } catch (error) {
          fail(errorText(error, t('batch.loadFailed', { detail: '未知错误' })))
        } finally {
          setBusy(false)
        }
      }

      const selectAll = async () => {
        try {
          const payload = await apiGet('/sessions')
          if (payload?.ok !== true) {
            fail(errorText(payload, t('batch.loadFailed', { detail: '未知错误' })))
            return
          }
          batchStore.select((payload.sessions ?? []).map(session => session.sessionId))
        } catch (error) {
          fail(t('batch.hostUnavailable'))
        }
      }

      const failures = (result?.results ?? []).filter(item => item.ok !== true)
      const disabled = busy || selectedCount === 0

      return h('div', { style: batchStyles.bar, role: 'region', 'aria-label': t('batch.title') },
        h('span', { style: batchStyles.count }, t('batch.selected', { n: selectedCount })),
        h('button', { type: 'button', style: batchStyles.button, disabled: busy, onClick: () => void selectAll() }, t('batch.selectAll')),
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
        h('button', { type: 'button', style: batchStyles.button, disabled: busy, onClick: () => batchStore.setMode(false) }, t('batch.exit')),
        failures.length > 0 ? h('div', { style: batchStyles.failures },
          `${t('batch.failures')}：\n` + failures.map(item => `${item.sessionId}：${item.message ?? item.code}`).join('\n'),
        ) : null,
      )
    }
