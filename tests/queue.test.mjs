/**
 * 串行写队列单测：删除/还原/清空共用一条队列，保证不会并发写回收站与 workspace.json。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { __test } from '../index.js'

const { createQueue } = __test

test('createQueue：任务按入队顺序串行执行', async () => {
  const enqueue = createQueue()
  const order = []
  const first = enqueue(async () => {
    order.push('a-start')
    await new Promise(resolve => setTimeout(resolve, 20))
    order.push('a-end')
    return 1
  })
  const second = enqueue(async () => {
    order.push('b-start')
    order.push('b-end')
    return 2
  })
  assert.deepEqual(await Promise.all([first, second]), [1, 2])
  assert.deepEqual(order, ['a-start', 'a-end', 'b-start', 'b-end'])
})

test('createQueue：前一个任务失败不会卡住后续任务', async () => {
  const enqueue = createQueue()
  const failed = enqueue(async () => {
    throw new Error('boom')
  })
  const after = enqueue(async () => 'ok')
  await assert.rejects(() => failed, /boom/)
  assert.equal(await after, 'ok')
})
