    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { zh: TEXT, en }), 'session-delete: 词典')
        const t = ctx.locale.bind(NS)
        const shell = { ctx, t }

        ctx.slots.inject('sidebar.workspaces.session.row.action', () => ctx.slots.register({
          name: 'sidebar.workspaces.session.row.action',
          id: 'dsh-session-delete',
          order: 300,
          locale: NS,
        }, props => h(SessionRowDeleteButton, { ...props, t })))

        ctx.slots.inject('sidebar.workspaces.session.menu.item', () => ctx.slots.register({
          name: 'sidebar.workspaces.session.menu.item',
          id: 'dsh-session-delete',
          order: 500,
          locale: NS,
        }, props => h(SessionMenuDeleteItem, { ...props, t })))

        ctx.slots.inject('shell.overlay', () => ctx.slots.register({
          name: 'shell.overlay',
          id: 'dsh-session-delete.confirm',
          order: 900,
          locale: NS,
        }, () => h(OverlayHost, shell)))

        ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section',
          id: 'dsh-session-delete',
          order: 60,
          locale: NS,
          label: () => t('settings.title'),
        }, () => h(TrashSettingsSection, shell)))

        // 批量管理兜底入口：工作区标题行锚点不可用时，显示在侧栏底部（正常时不渲染）。
        ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
          name: 'sidebar.footer.action',
          id: 'dsh-session-delete-batch',
          order: 120,
          locale: NS,
        }, () => h(BatchFooterFallback, { t })))
      },
    }
