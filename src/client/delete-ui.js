    /** 一个带 hover 反馈的图标按钮。 */
    function HoverIconButton({ label, onClick, children }) {
      const [hover, setHover] = useState(false)
      return h('button', {
        type: 'button',
        title: label,
        'aria-label': label,
        style: hover ? { ...styles.iconButton, ...styles.iconButtonHover } : styles.iconButton,
        onMouseEnter: () => setHover(true),
        onMouseLeave: () => setHover(false),
        onClick: (event) => {
          event.preventDefault()
          event.stopPropagation()
          onClick()
        },
      }, children)
    }

    /** 垃圾桶图标（内联 SVG，不依赖官方图标包）。 */
    function TrashIcon({ size = 14 }) {
      return h('svg', {
        width: size,
        height: size,
        viewBox: '0 0 16 16',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.4,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': 'true',
      },
        h('path', { d: 'M2.5 4.5h11' }),
        h('path', { d: 'M6 4.5V3.2a.8.8 0 0 1 .8-.8h2.4a.8.8 0 0 1 .8.8v1.3' }),
        h('path', { d: 'M4 4.5l.7 8.2a1 1 0 0 0 1 .9h4.6a1 1 0 0 0 1-.9l.7-8.2' }),
        h('path', { d: 'M6.6 7v4.2M9.4 7v4.2' }),
      )
    }

    /** 行内删除按钮（`sidebar.workspaces.session.row.action`）。 */
    function SessionRowDeleteButton({ sessionId, displayTitle, t }) {
      const label = t('action.deleteHint')
      return h(HoverIconButton, {
        label,
        onClick: () => dialogStore.open({ sessionId, title: displayTitle ?? '', nonce: Date.now() }),
      }, h(TrashIcon, { size: 14 }))
    }

    /** `⋯` 菜单项（`sidebar.workspaces.session.menu.item`）。 */
    function SessionMenuDeleteItem({ sessionId, displayTitle, useMenuOpenState, t }) {
      const [hover, setHover] = useState(false)
      // 契约保证该 hook 恒存在：无条件调用，避免 props 变化导致 hooks 顺序错乱。
      const menuOpenState = useMenuOpenState()
      const setMenuOpen = typeof menuOpenState?.[1] === 'function' ? menuOpenState[1] : undefined
      return h('button', {
        type: 'button',
        role: 'menuitem',
        style: hover ? { ...styles.menuItem, ...styles.menuItemHover } : styles.menuItem,
        onMouseEnter: () => setHover(true),
        onMouseLeave: () => setHover(false),
        onClick: () => {
          if (typeof setMenuOpen === 'function') setMenuOpen(false)
          dialogStore.open({ sessionId, title: displayTitle ?? '', nonce: Date.now() })
        },
      }, h(TrashIcon, { size: 14 }), h('span', null, t('action.delete')))
    }

    /** 弹窗里的一行字段。 */
    function Field({ label, children }) {
      return h(React.Fragment, null,
        h('div', { style: styles.fieldLabel }, label),
        h('div', { style: styles.fieldValue }, children),
      )
    }

    /** 确认弹窗本体。 */
    function DeleteConfirmDialog({ request, ctx, t }) {
      const [state, setState] = useState({ phase: 'loading', data: null, error: '' })
      const [busy, setBusy] = useState('')
      const [stopFirst, setStopFirst] = useState(false)
      const [purgeArmed, setPurgeArmed] = useState(false)
      const primaryRef = useRef(null)
      const cardRef = useRef(null)
      const closedRef = useRef(false)

      const load = useCallback(async () => {
        setState({ phase: 'loading', data: null, error: '' })
        try {
          const result = await apiGet('/inspect', { sessionId: request.sessionId, title: request.title })
          if (result?.ok === true) setState({ phase: 'ready', data: { ...result.session, settings: result.settings }, error: '' })
          else setState({ phase: 'error', data: null, error: errorText(result, t('dialog.loadFailed', { detail: '未知错误' })) })
        } catch (error) {
          setState({ phase: 'error', data: null, error: t('dialog.loadFailed', { detail: error instanceof Error ? error.message : String(error) }) })
        }
      }, [request.sessionId, request.title, t])

      useEffect(() => {
        closedRef.current = false
        void load()
        return () => { closedRef.current = true }
      }, [load])

      useEffect(() => {
        const onKeyDown = (event) => {
          if (event.key === 'Escape' && busy === '') {
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
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault()
            last.focus()
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault()
            first.focus()
          }
        }
        window.addEventListener('keydown', onKeyDown)
        return () => window.removeEventListener('keydown', onKeyDown)
      }, [busy])

      useEffect(() => {
        if (state.phase === 'ready') primaryRef.current?.focus?.()
      }, [state.phase])

      const session = state.data
      const running = session?.running === true
      const runningChildren = Array.isArray(session?.descendants) ? session.descendants.filter(item => item.running === true).length : 0
      const blocked = runningChildren > 0 || (running && !stopFirst)
      const close = () => { if (busy === '') dialogStore.close() }

      const run = async (mode) => {
        if (blocked) return
        setBusy(mode)
        try {
          const result = await apiPost('/delete', {
            sessionId: request.sessionId,
            mode,
            stopIfRunning: stopFirst,
            title: request.title,
          })
          if (result?.ok === true) {
            const title = session?.title || request.title || t('dialog.titleFallback')
            const warnings = Array.isArray(result.warnings) ? result.warnings : []
            const leftovers = Array.isArray(result.leftovers) ? result.leftovers : []
            const text = result.code === 'already-gone'
              ? t('notice.alreadyGone')
              : result.code === 'already-in-trash'
                ? t('notice.alreadyTrash')
                : mode === 'purge' ? t('notice.purged', { title }) : t('notice.trashed', { title })
            noticeStore.show({
              kind: warnings.length > 0 || leftovers.length > 0 ? 'warn' : 'ok',
              text: [text, warnings.length > 0 ? t('dialog.warnings', { n: warnings.length }) : '', ...warnings.slice(0, 5)].filter(Boolean).join('\n'),
              sticky: warnings.length > 0,
            })
            refreshSessionList(ctx)
            clearMainIfCurrent(ctx, request.sessionId)
            dialogStore.close()
            return
          }
          setState(previous => ({
            ...previous,
            error: errorText(result, t('dialog.failed', { detail: '未知错误' })),
          }))
        } catch (error) {
          setState(previous => ({ ...previous, error: t('dialog.failed', { detail: error instanceof Error ? error.message : String(error) }) }))
        } finally {
          setBusy('')
        }
      }

      const title = session?.title || request.title || t('dialog.titleFallback')
      const children = []
      children.push(h('h2', { style: styles.title, key: 'title', id: 'dsh-session-delete-dialog-title' }, t('dialog.title', { title })))

      if (state.phase === 'loading') {
        children.push(h('p', { style: styles.hint, key: 'loading' }, t('dialog.loading')))
      } else if (state.phase === 'error') {
        children.push(h('p', { style: styles.error, key: 'error' }, state.error))
      } else {
        const subagents = Array.isArray(session.descendants) ? session.descendants : []
        const runningChildren = subagents.filter(item => item.running === true).length
        const stateText = running ? t('field.state.running') : t('field.state.idle')
        children.push(h('div', { style: styles.fieldRow, key: 'fields' },
          h(Field, { label: t('field.sessionId') }, h('code', { style: { fontSize: '12px' } }, shortId(session.sessionId))),
          h(Field, { label: t('field.workspace') }, session.workspace === null || session.workspace === undefined
            ? '—'
            : `${session.workspace.title || session.workspace.path}（${session.workspace.path}）`),
          h(Field, { label: t('field.size') }, formatBytes(session.sizeBytes)),
          h(Field, { label: t('field.state') }, running ? `${stateText} · ${t('field.state.runningHint')}` : `${stateText} · ${session.live ? t('field.state.live') : t('field.state.cold')}`),
          h(Field, { label: t('field.subagents') }, subagents.length === 0
            ? t('field.subagents.none')
            : runningChildren > 0
              ? t('field.subagents.running', { n: subagents.length, running: runningChildren })
              : t('field.subagents.some', { n: subagents.length })),
        ))

        const cleanup = [
          t('cleanup.log', { size: formatBytes(session.sizeBytes) }),
          t('cleanup.projection'),
          t('cleanup.workspace'),
          t('cleanup.live'),
        ]
        if (subagents.length > 0) cleanup.push(t('cleanup.subagents', { n: subagents.length }))
        children.push(h('div', { style: styles.sectionTitle, key: 'cleanupTitle' }, t('cleanup.title')))
        children.push(h('ul', { style: styles.list, key: 'cleanup' }, cleanup.map((line, index) => h('li', { key: `line-${index}` }, line))))
        const retentionDays = session.settings?.retentionDays
        children.push(h('p', { style: styles.hint, key: 'explain' }, session.inTrash === true
          ? t('notice.alreadyTrash')
          : Number(retentionDays) > 0 ? t('trash.explain', { days: retentionDays }) : t('trash.explainForever')))
        if (runningChildren > 0) {
          children.push(h('p', { style: styles.hint, key: 'childRunningHint' }, t('field.subagents.runningHint', { n: runningChildren })))
        }
        if (running) {
          children.push(h('label', { style: styles.checkboxRow, key: 'stop' },
            h('input', {
              type: 'checkbox',
              checked: stopFirst,
              onChange: event => setStopFirst(event.target.checked),
            }),
            h('span', null, busy === 'purge' ? t('stop.checkboxPurge') : t('stop.checkbox')),
          ))
          if (!stopFirst) children.push(h('p', { style: styles.hint, key: 'stopHint' }, t('stop.needStop')))
        }
        if (state.error !== '') children.push(h('p', { style: styles.error, key: 'runError' }, state.error))
        if (busy !== '') {
          children.push(h('p', { style: styles.hint, key: 'busy' }, busy === 'purge' ? t('dialog.busy.purge') : t('dialog.busy.trash')))
        }
        const disabled = busy !== '' || blocked
        children.push(h('div', { style: styles.footer, key: 'footer' },
          h('button', { type: 'button', style: styles.button, disabled: busy !== '', onClick: close }, t('button.cancel')),
          h('button', {
            type: 'button',
            ref: primaryRef,
            style: disabled ? { ...styles.button, ...styles.buttonPrimary, ...styles.buttonDisabled } : { ...styles.button, ...styles.buttonPrimary },
            disabled,
            onClick: () => void run('trash'),
          }, t('button.trash')),
          h('button', {
            type: 'button',
            style: disabled ? { ...styles.button, ...styles.buttonDanger, ...styles.buttonDisabled } : { ...styles.button, ...styles.buttonDanger },
            disabled,
            onClick: () => {
              if (!purgeArmed) { setPurgeArmed(true); return }
              void run('purge')
            },
            onBlur: () => setPurgeArmed(false),
          }, purgeArmed ? t('button.purgeConfirm') : t('button.purge')),
        ))
      }

      return h('div', {
        style: styles.backdrop,
        role: 'presentation',
        onMouseDown: (event) => { if (event.target === event.currentTarget) close() },
      }, h('div', {
        role: 'dialog',
        'aria-modal': 'true',
        'aria-labelledby': 'dsh-session-delete-dialog-title',
        ref: cardRef,
        style: styles.card,
      }, children))
    }

    /** `shell.overlay` 入口：弹窗 + 结果提示。 */
    function OverlayHost({ ctx, t }) {
      const request = useDialogRequest()
      const notice = useNotice()
      return h(React.Fragment, null,
        h(BatchHeaderMount, { t }),
        h(BatchRowInjector, { t }),
        h(BatchToolbar, { ctx, t }),
        request === null ? null : h(DeleteConfirmDialog, { key: `${request.sessionId}:${request.nonce}`, request, ctx, t }),
        notice === null ? null : h('div', {
          style: styles.notice,
          role: 'status',
        }, notice.text, h('button', {
          type: 'button',
          'aria-label': '关闭提示',
          style: styles.noticeClose,
          onClick: () => noticeStore.clear(),
        }, '×')),
      )
    }

    /** 设置页「会话回收站」。 */
    function TrashSettingsSection({ ctx, t }) {
      const [state, setState] = useState({ phase: 'loading', entries: [], usage: { count: 0, bytes: 0 }, settings: null, error: '' })
      const [busy, setBusy] = useState('')
      const [armed, setArmed] = useState('')

      const load = useCallback(async () => {
        setState(previous => ({ ...previous, phase: previous.entries.length === 0 ? 'loading' : previous.phase, error: '' }))
        try {
          const result = await apiGet('/trash')
          if (result?.ok === true) {
            setState({ phase: 'ready', entries: result.entries ?? [], usage: result.usage ?? { count: 0, bytes: 0 }, settings: result.settings ?? null, error: '' })
          } else {
            setState(previous => ({ ...previous, phase: 'error', error: errorText(result, t('settings.loadFailed', { detail: '未知错误' })) }))
          }
        } catch (error) {
          setState(previous => ({ ...previous, phase: 'error', error: t('settings.loadFailed', { detail: error instanceof Error ? error.message : String(error) }) }))
        }
      }, [t])

      useEffect(() => { void load() }, [load])

      const act = async (kind, work) => {
        setBusy(kind)
        try {
          const result = await work()
          if (result?.ok !== true) {
            noticeStore.show({ kind: 'error', text: errorText(result, t('settings.actionFailed', { detail: '未知错误' })) })
            return
          }
          noticeStore.show({ kind: 'ok', text: result.message ?? '' })
          if (kind === 'restore') refreshSessionList(ctx)
          await load()
        } catch (error) {
          noticeStore.show({ kind: 'error', text: t('settings.actionFailed', { detail: error instanceof Error ? error.message : String(error) }) })
        } finally {
          setBusy('')
          setArmed('')
        }
      }

      const saveSettings = async (patch) => {
        setBusy('settings')
        try {
          const result = await apiPost('/settings', patch)
          if (result?.ok === true) setState(previous => ({ ...previous, settings: result.settings }))
          else noticeStore.show({ kind: 'error', text: errorText(result, t('settings.settingsFailed', { detail: '未知错误' })) })
        } catch (error) {
          noticeStore.show({ kind: 'error', text: t('settings.settingsFailed', { detail: error instanceof Error ? error.message : String(error) }) })
        } finally {
          setBusy('')
        }
      }

      const settings = state.settings ?? { retentionDays: 30, sweepOnStartup: true }
      const rows = state.entries.map(entry => h('tr', { key: entry.trashId },
        h('td', { style: styles.td },
          h('div', { style: { fontWeight: 500 } }, entry.title || t('settings.untitled')),
          h('div', { style: { fontSize: '11px', color: 'var(--dsw-alias-label-tertiary)' } }, shortId(entry.sessionId)),
          entry.members.length > 1 ? h('div', { style: { fontSize: '11px', color: 'var(--dsw-alias-label-tertiary)' } }, t('settings.subagents', { n: entry.members.length - 1 })) : null,
        ),
        h('td', { style: styles.td }, entry.workspaceTitle || entry.workspacePath || '—'),
        h('td', { style: styles.td }, formatTime(entry.deletedAt)),
        h('td', { style: styles.td }, formatBytes(entry.sizeBytes)),
        h('td', { style: styles.td },
          h('button', {
            type: 'button',
            style: styles.smallButton,
            disabled: busy !== '',
            onClick: () => void act('restore', () => apiPost('/restore', { sessionId: entry.sessionId })),
          }, t('settings.restore')),
          h('button', {
            type: 'button',
            style: { ...styles.smallButton, color: 'var(--dsw-alias-state-error-primary)' },
            disabled: busy !== '',
            onClick: () => {
              if (armed !== entry.trashId) { setArmed(entry.trashId); return }
              void act('purge', () => apiPost('/purge', { sessionId: entry.sessionId }))
            },
          }, armed === entry.trashId ? t('settings.purgeConfirm') : t('settings.purge')),
        ),
      ))

      return h('section', { style: { maxWidth: '860px' } },
        h('h2', { style: { margin: '0 0 6px', fontSize: '16px', fontWeight: 600 } }, t('settings.title')),
        h('p', { style: styles.hint }, t('settings.description')),
        h('div', { style: styles.cardPanel },
          h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' } },
            h('div', { style: { fontSize: '13px', fontWeight: 500 } }, t('settings.usage', { count: state.usage.count, size: formatBytes(state.usage.bytes) })),
            h('button', { type: 'button', style: styles.smallButton, disabled: busy !== '', onClick: () => void load() }, t('settings.refresh')),
          ),
          state.phase === 'loading' ? h('p', { style: styles.hint }, t('settings.loading')) : null,
          state.error !== '' ? h('p', { style: styles.error }, state.error) : null,
          state.phase === 'ready' && state.entries.length === 0 ? h('p', { style: styles.hint }, t('settings.empty')) : null,
          state.entries.length > 0 ? h('div', { style: { marginTop: '10px', overflowX: 'auto' } },
            h('table', { style: styles.table },
              h('thead', null, h('tr', null,
                h('th', { style: styles.th }, t('settings.column.title')),
                h('th', { style: styles.th }, t('settings.column.workspace')),
                h('th', { style: styles.th }, t('settings.column.deletedAt')),
                h('th', { style: styles.th }, t('settings.column.size')),
                h('th', { style: styles.th }, t('settings.column.actions')),
              )),
              h('tbody', null, rows),
            ),
          ) : null,
        ),
        h('div', { style: styles.cardPanel },
          h('div', { style: { fontSize: '13px', fontWeight: 500, marginBottom: '8px' } }, t('settings.policy')),
          h('label', { style: { display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px' } },
            h('span', null, t('settings.retention')),
            h('select', {
              value: String(settings.retentionDays),
              disabled: busy !== '',
              onChange: event => void saveSettings({ retentionDays: Number(event.target.value) }),
              style: { padding: '4px 8px', borderRadius: '6px', border: '1px solid var(--dsw-alias-border-l1)', background: 'var(--dsw-alias-bg-layer-2)', color: 'var(--dsw-alias-label-primary)' },
            }, [7, 15, 30, 90, 0].map(days => h('option', { key: days, value: String(days) }, t(`settings.retention.${days}`)))),
          ),
          h('p', { style: styles.hint }, t('settings.retentionHint')),
          h('label', { style: { ...styles.checkboxRow, marginTop: '10px' } },
            h('input', {
              type: 'checkbox',
              checked: settings.sweepOnStartup === true,
              disabled: busy !== '',
              onChange: event => void saveSettings({ sweepOnStartup: event.target.checked }),
            }),
            h('span', null, t('settings.sweepOnStartup')),
          ),
          h('div', { style: { ...styles.footer, justifyContent: 'flex-start' } },
            h('button', {
              type: 'button',
              style: styles.smallButton,
              disabled: busy !== '',
              onClick: () => void act('sweep', () => apiPost('/empty', { onlyExpired: true })),
            }, t('settings.sweepNow')),
            h('button', {
              type: 'button',
              style: { ...styles.smallButton, color: 'var(--dsw-alias-state-error-primary)' },
              disabled: busy !== '',
              onClick: () => {
                if (armed !== 'empty') { setArmed('empty'); return }
                void act('empty', () => apiPost('/empty', { onlyExpired: false }))
              },
            }, armed === 'empty' ? t('settings.emptyConfirm') : t('settings.emptyTrash')),
          ),
        ),
      )
    }

