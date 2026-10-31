// 积分/数值的边界模拟：临时积分窗口、钱包型账号、过期批次、坏时间。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { WPSLingxiAuthPlugin, _internal } from '../index.mjs'

const DAY = 24 * 60 * 60 * 1000
const now = Date.parse('2026-10-31T00:00:00+08:00')

function installFetch(payload) {
  const original = globalThis.fetch
  globalThis.fetch = async () => Response.json(payload)
  return () => { globalThis.fetch = original }
}

test('expiring: only unexpired batches inside the window count', () => {
  const s = _internal.summarizeExpiring([
    { balance: 100, value: 100, consumed: 0, expire_time: new Date(now + 5 * DAY).toISOString() },
    { balance: 200, value: 300, consumed: 100, expire_time: new Date(now + 10 * DAY).toISOString() },
    { balance: 400, value: 400, consumed: 0, expire_time: new Date(now + 20 * DAY).toISOString() }, // 窗口外
    { balance: 50, value: 50, consumed: 0, expire_time: new Date(now - DAY).toISOString() },       // 已过期
    { balance: 9, value: 9, consumed: 0, expire_time: 'not-a-date' },                              // 坏时间
  ], now, 15 * DAY)
  assert.equal(s.balance, 300)
  assert.equal(s.value, 400)
  assert.equal(s.consumed, 100)
  assert.equal(Date.parse(s.earliest), now + 5 * DAY)
})

test('expiring: exactly at the window edge counts, one ms over does not', () => {
  const at = _internal.summarizeExpiring([{ balance: 1, value: 1, consumed: 0, expire_time: new Date(now + 15 * DAY).toISOString() }], now, 15 * DAY)
  assert.equal(at.balance, 1)
  const over = _internal.summarizeExpiring([{ balance: 1, value: 1, consumed: 0, expire_time: new Date(now + 15 * DAY + 1).toISOString() }], now, 15 * DAY)
  assert.equal(over.balance, 0)
})

test('expiring: consumed falls back to value - balance', () => {
  const s = _internal.summarizeExpiring([{ balance: 40, value: 100, expire_time: new Date(now + DAY).toISOString() }], now, 15 * DAY)
  assert.equal(s.consumed, 60)
})

test('usage: standard account gets a finite used and no temp window at 30 days', async () => {
  const plugin = await WPSLingxiAuthPlugin()
  const restore = installFetch({
    data: {
      total_balance: 2393,
      total_contract: 0,
      bonus_summary: { total_value: 2400, total_consumed: 7, items: [] },
      bonus_credits: [{ balance: 2393, value: 2400, consumed: 7, expire_time: '2026-11-30T07:06:59+08:00' }],
    },
  })
  try {
    const u = await plugin.auth.usage(async () => ({ cookie: 'wps_sid=x', accountId: 'wps-1' }))
    assert.equal(u.windows.length, 1)
    assert.equal(u.windows[0].name, '智点')
    assert.ok(Number.isFinite(u.windows[0].used))
    assert.equal(u.windows[0].amount, 7)
    assert.equal(u.windows[0].limit, 2400)
  } finally { restore() }
})

test('usage: wallet account has used=0 and no amount/limit', async () => {
  const plugin = await WPSLingxiAuthPlugin()
  const restore = installFetch({
    data: { total_balance: 500, total_contract: 0, bonus_summary: { total_value: 0 }, bonus_credits: [] },
  })
  try {
    const u = await plugin.auth.usage(async () => ({ cookie: 'wps_sid=x' }))
    assert.equal(u.windows.length, 1)
    assert.equal(u.windows[0].used, 0)
    assert.equal(u.windows[0].amount, undefined)
    assert.equal(u.windows[0].limit, undefined)
    assert.equal(u.windows[0].display, '500 智点')
  } finally { restore() }
})

test('usage: expired batches never become until', async () => {
  const plugin = await WPSLingxiAuthPlugin()
  const restore = installFetch({
    data: {
      total_balance: 5,
      bonus_summary: { total_value: 5, total_consumed: 0 },
      bonus_credits: [{ balance: 5, value: 5, consumed: 0, expire_time: '2020-01-01T00:00:00+08:00' }],
    },
  })
  try {
    const u = await plugin.auth.usage(async () => ({ cookie: 'wps_sid=x' }))
    assert.equal(u.until, '')
  } finally { restore() }
})
