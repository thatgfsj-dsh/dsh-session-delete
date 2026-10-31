/**
 * 客户端 bundle 的结构单测：模块 id、slot 注册（名称/顺序/id/词典）、纯函数行为。
 *
 * 注意：这里只验证「bundle 能加载、注册了什么」，**不代表**真实页面渲染已验收；
 * UI 渲染需要在真实浏览器里点验（见 README 的验证章节）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'

/** 加载 client.js 并返回模块描述对象。 */
async function loadClient() {
  const source = await readFile(new URL('../client.js', import.meta.url), 'utf8')
  // 与参考实现相同的手法：把内部纯函数挂到 checks 上，便于在 Node 里直接断言。
  const patched = source.replace(
    "    return {\n      inject: ['slots', 'locale'],",
    "    return {\n      checks: { TEXT, formatBytes, shortId, formatTime, errorText },\n      inject: ['slots', 'locale'],",
  )
  assert.notEqual(patched, source, 'client.js 的返回对象形状变了，测试需要同步')
  let loaded
  const sandbox = {
    window: { __ModuleLoader__: { load: value => { loaded = value } } },
    URL,
    setTimeout,
    clearTimeout,
    fetch: async () => ({ json: async () => ({ ok: true }) }),
    console,
  }
  runInNewContext(patched, sandbox)
  assert.ok(loaded, 'client.js 没有调用 __ModuleLoader__.load')
  return { loaded, sandbox }
}

test('客户端模块 id 必须等于包名', async () => {
  const { loaded } = await loadClient()
  assert.equal(loaded.id, 'dsh-session-delete')
  assert.equal(typeof loaded.factory, 'function')
})

test('apply 注册四个 slot，顺序与 id 符合契约', async () => {
  const { loaded } = await loadClient()
  const registrations = []
  const dictionaries = []
  const effects = []
  const module = loaded.factory(() => ({ createElement: () => null }))
  assert.deepEqual([...module.inject], ['slots', 'locale'])
  const ctx = {
    locale: {
      register: (ns, dicts) => { dictionaries.push([ns, dicts]); return () => {} },
      bind: () => (key, params) => `${key}${params === undefined ? '' : JSON.stringify(params)}`,
    },
    slots: {
      inject: (name, install) => { install() },
      register: (options, component) => { registrations.push({ options, component }); return () => {} },
    },
    effect: (fn, label) => { effects.push(label); fn() },
    get: () => undefined,
  }
  module.apply(ctx)
  const byName = Object.fromEntries(registrations.map(item => [item.options.name, item.options]))
  assert.deepEqual(Object.keys(byName).sort(), [
    'settings.section',
    'shell.overlay',
    'sidebar.workspaces.session.menu.item',
    'sidebar.workspaces.session.row.action',
  ])
  assert.equal(byName['sidebar.workspaces.session.row.action'].id, 'dsh-session-delete')
  assert.equal(byName['sidebar.workspaces.session.row.action'].order, 300)
  assert.equal(byName['sidebar.workspaces.session.menu.item'].id, 'dsh-session-delete')
  assert.ok(byName['sidebar.workspaces.session.menu.item'].order > 400, '菜单项要排在官方归档（400）之后')
  assert.equal(byName['shell.overlay'].id, 'dsh-session-delete.confirm')
  assert.equal(byName['settings.section'].id, 'dsh-session-delete')
  assert.equal(typeof byName['settings.section'].label, 'function')
  assert.equal(byName['settings.section'].label(), 'settings.title')
  for (const item of registrations) assert.equal(item.options.locale, 'sessionDelete')
  assert.equal(dictionaries.length, 1)
  assert.equal(dictionaries[0][0], 'sessionDelete')
  assert.equal(dictionaries[0][1].zh['action.delete'], '删除会话…')
  assert.equal(dictionaries[0][1].en['action.delete'], '删除会话…', 'en 词典也必须是中文')
})

test('纯函数：字节格式化、ID 截断、错误文本', async () => {
  const { loaded } = await loadClient()
  const checks = loaded.factory(() => ({ createElement: () => null })).checks
  assert.equal(checks.formatBytes(0), '0 B')
  assert.equal(checks.formatBytes(512), '512 B')
  assert.equal(checks.formatBytes(2048), '2.0 KB')
  assert.equal(checks.formatBytes(1024 * 1024 * 12.34), '12.3 MB')
  assert.equal(checks.formatBytes(Number.NaN), '0 B')
  assert.equal(checks.shortId('short'), 'short')
  const long = 'session-1234567890abcdef1234567890abcdef'
  assert.ok(checks.shortId(long).includes('…'))
  assert.equal(checks.errorText({ message: '失败', detail: '原因' }, '兜底'), '失败（原因）')
  assert.equal(checks.errorText(null, '兜底'), '兜底')
  assert.equal(checks.errorText({}, '兜底'), '兜底')
  assert.equal(checks.TEXT['settings.title'], '会话回收站')
  // 所有词条值都必须是中文（至少含一个 CJK 字符），避免漏翻
  for (const [key, value] of Object.entries(checks.TEXT)) {
    if (key === 'common.yes' || key === 'common.no') continue
    assert.match(value, /[\u4e00-\u9fff]/, `词条 ${key} 不是中文：${value}`)
  }
})
