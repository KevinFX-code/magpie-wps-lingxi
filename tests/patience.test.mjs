// 网关等待耐心：慢思考模型（kimi-k3.1-pro）对大提示词的首字延迟超过 magpie
// 默认的 60s，会被判 502 重试到尽（10 次/37s 实测）。插件在 config 钩子里
// 声明 patience=240（magpie 的 PatienceLongest），用户显式设置过则不覆盖。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { WPSLingxiAuthPlugin } from '../index.mjs'

test('config declares patience=240 for slow-thinking models', async () => {
  const plugin = await WPSLingxiAuthPlugin()
  const config = { provider: {} }
  await plugin.config(config)
  const p = config.provider['wps-lingxi']
  assert.equal(p.patience, 240)
})

test("an operator's explicit patience is never overwritten", async () => {
  const plugin = await WPSLingxiAuthPlugin()
  const config = { provider: { 'wps-lingxi': { patience: 30 } } }
  await plugin.config(config)
  assert.equal(config.provider['wps-lingxi'].patience, 30)
})
