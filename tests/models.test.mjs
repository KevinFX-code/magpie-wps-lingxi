// Issue #9: public hooks with mocked upstream; no real account/network.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { WPSLingxiAuthPlugin } from '../index.mjs'

const auth = { cookie: 'wps_sid=SID' + 'a'.repeat(29) }
const snapshotIds = [
  'deepseek-v4.1-flash', 'deepseek-v4-flash-0731', 'deepseek-v4-pro-0813',
  'kimi-k3', 'GLM-5.3', 'GLM-5.3-Flash', 'qwen3.8_max', 'qwen3.8_flash',
  'minimax_m3', 'doubao_seed_2_1_pro_260628', 'mimo-v2.6-pro',
]
const plans = [{ key: 'plan_pro' }, { key: 'plan_max' }, { key: 'future_mode' }]

async function withFetch(handler, run) {
  const original = globalThis.fetch
  const calls = []
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ path: new URL(url).pathname, init })
    return handler(url, init)
  }
  try { await run(calls) } finally { globalThis.fetch = original }
}

test('live catalog exposes only valid data.models and preserves metadata', async () => {
  const plugin = await WPSLingxiAuthPlugin()
  await withFetch(() => Response.json({ data: {
    plans,
    models: [
      { key: 'kimi-k3', name: 'Kimi-K3', multiplier: '1.60x', max_context_tokens: 123456, reasoning_efforts: ['low', 'high'] },
      { key: 'new-real-model', name: 'New model' },
      null, {}, { key: '' }, { key: ' ' }, { key: 42 },
      ...['auto', 'plan_pro', 'plan_max'].map(key => ({ key })),
    ],
  } }), async calls => {
    const models = await plugin.provider.models({}, { auth })
    assert.deepEqual(Object.keys(models), ['kimi-k3', 'new-real-model'])
    assert.equal(models['kimi-k3'].name, 'Kimi-K3')
    assert.equal(models['kimi-k3'].rate, 1.6)
    assert.equal(models['kimi-k3'].limit.context, 123456)
    assert.deepEqual(Object.keys(models['kimi-k3'].variants), ['low', 'high'])
    assert.deepEqual(calls.map(c => c.path), ['/api/aioffice/v1/sessions/plans'])
  })
})

for (const [label, response] of [
  ['plans only', () => Response.json({ data: { plans } })],
  ['empty models', () => Response.json({ data: { plans, models: [] } })],
  ['malformed models', () => Response.json({ data: { models: {} } })],
  ['invalid model entries', () => Response.json({ data: { models: [null, {}, { key: 'plan_pro' }] } })],
  ['HTTP failure', () => new Response('', { status: 503 })],
  ['network failure', () => { throw new Error('offline') }],
  ['invalid JSON', () => new Response('{')],
]) {
  test(`safe snapshot fallback: ${label}`, async () => {
    const plugin = await WPSLingxiAuthPlugin()
    await withFetch(response, async () => {
      assert.deepEqual(Object.keys(await plugin.provider.models({}, { auth })), snapshotIds)
    })
  })
}

test('unauthenticated catalog and config use safe defaults; old invalid rows are removed', async () => {
  const plugin = await WPSLingxiAuthPlugin()
  await withFetch(() => { throw new Error('unexpected network') }, async calls => {
    assert.deepEqual(Object.keys(await plugin.provider.models({})), snapshotIds)
    const config = { provider: { 'wps-lingxi': { models: {
      auto: {}, plan_pro: {}, plan_max: {},
      'kimi-k3': { name: 'Custom Kimi' }, custom: { name: 'User model' },
    } } } }
    await plugin.config(config)
    const models = config.provider['wps-lingxi'].models
    assert.deepEqual(Object.keys(models), [...snapshotIds, 'custom'])
    assert.equal(models['kimi-k3'].name, 'Custom Kimi')
    assert.equal(models.custom.name, 'User model')
    assert.equal(calls.length, 0)
  })
})

for (const id of ['auto', 'plan_pro', 'plan_max']) {
  for (const prefix of ['', 'wps-lingxi/', 'lingxi-', 'lingxi/']) {
    for (const stream of [false, true]) {
      test(`chat rejects ${prefix}${id}, stream=${stream}, before any upstream call`, async () => {
        const plugin = await WPSLingxiAuthPlugin()
        const loader = await plugin.auth.loader(async () => auth)
        await withFetch(() => { throw new Error('must not contact upstream') }, async calls => {
          const res = await loader.fetch('https://mock/chat/completions', {
            body: JSON.stringify({ model: prefix + id, stream, messages: [{ role: 'user', content: 'hello' }] }),
          })
          assert.equal(res.status, 404)
          assert.equal((await res.json()).error.code, 'model_not_found')
          assert.equal(calls.length, 0, 'no sessions, credits/runs or agent-runtime requests')
        })
      })
    }
  }
}

test('a real model still reaches credits/runs and completes chat', async () => {
  const plugin = await WPSLingxiAuthPlugin()
  const loader = await plugin.auth.loader(async () => ({ cookie: auth.cookie }))
  await withFetch((url, init) => {
    const path = new URL(url).pathname
    if (path.endsWith('/cowork/sessions')) return Response.json({ data: { session_id: 'models-test-session' } })
    if (path.endsWith('/credits/runs')) {
      assert.equal(JSON.parse(init.body).model_id, 'kimi-k3')
      return Response.json({ data: { run_id: 'models-test-run' } })
    }
    if (path.endsWith('/agent-runtime/chat/completions')) return new Response(
      'data: {"choices":[{"text":"ok","finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
      { headers: { 'Content-Type': 'text/event-stream' } },
    )
    throw new Error(`unexpected request: ${url}`)
  }, async calls => {
    const res = await loader.fetch('https://mock/chat/completions', {
      body: JSON.stringify({ model: 'wps-lingxi/kimi-k3', stream: false, messages: [{ role: 'user', content: 'hello' }] }),
    })
    assert.equal(res.status, 200)
    assert.equal((await res.json()).choices[0].message.content, 'ok')
    assert.deepEqual(calls.map(c => c.path), [
      '/api/aioffice/v1/cowork/sessions', '/api/public/v1/credits/runs',
      '/api/public/v1/agent-runtime/chat/completions',
    ])
  })
})
