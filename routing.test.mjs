import { test } from 'node:test'
import assert from 'node:assert/strict'
import { WPSLingxiAuthPlugin } from './index.mjs'

const plugin = await WPSLingxiAuthPlugin()
const loader = await plugin.auth.loader(async () => ({ cookie: 'wps_sid=test' }))
const nativeFetch = globalThis.fetch

// 原生目录只有 6 个模型；网页目录更多。两个目录的 key 有重叠但不相同。
const NATIVE_CATALOG = {
  data: {
    models: [
      { key: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro', desc: 'flagship' },
      { key: 'GLM-5.1', name: 'GLM-5.1', desc: 'listed but rejected by credits/runs' },
    ],
    plans: [
      { key: 'plan_pro', name: 'Pro 模式', desc: 'daily' },
      { key: 'plan_max', name: 'Max 模式', desc: 'complex' },
    ],
  },
}

const WEB_CATALOG = {
  data: {
    models: [
      { key: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro' },
      { key: 'GLM-5.1', name: 'GLM-5.1' },
      { key: 'kimi-k3.1-pro', name: 'Kimi-K3.1 Pro' },
    ],
    plans: [{ key: 'plan_pro', name: 'Pro 模式' }],
  },
}

const nativeSse = [
  { code: 'Success', usage: { prompt_tokens: 7, completion_tokens: 2, total_tokens: 9 }, choices: [{ index: 0, finish_reason: 'stop', text: 'native-ok', reasoning_content: '' }] },
].map((l) => `data: ${JSON.stringify(l)}\n\n`).join('')

const legacySse = [
  { type: 'text', data: 'legacy-ok' },
  { type: 'end' },
].map((l) => `data: ${JSON.stringify(l)}\n\n`).join('')

const isCowork = (url) => url.includes('cowork.wps.cn')

async function withUpstream(fn, opts = {}) {
  const calls = []
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url)
    calls.push({ url: u, init })
    if (u.includes('/api/aioffice/v1/sessions/plans')) {
      // 只让原生目录挂掉，网页目录保持可用
      if (opts.catalogStatus && isCowork(u)) return new Response('down', { status: opts.catalogStatus })
      return Response.json(isCowork(u) ? NATIVE_CATALOG : WEB_CATALOG)
    }
    if (u.includes('/api/public/v1/credits/runs')) {
      if (opts.rejectRun) {
        return new Response('{"hint":"参数错误","result":"InvalidArgument","v7code":400000007}', { status: 400 })
      }
      return Response.json({ data: { run_id: 'run-1', status: 'created' } })
    }
    if (u.includes('/agent-runtime/chat/completions')) return new Response(nativeSse)
    if (u.endsWith('/sessions')) return Response.json({ data: { session_id: 'legacy-1' } })
    return new Response(legacySse)
  }
  try {
    return await fn(calls)
  } finally {
    globalThis.fetch = nativeFetch
  }
}

const call = (model, extra = {}, opts = {}) => withUpstream(async (calls) => {
  const res = await loader.fetch('https://mock/v1/chat/completions', {
    body: JSON.stringify({ model, stream: true, messages: [{ role: 'user', content: 'hi' }], ...extra }),
  })
  return { calls, route: res.headers.get('X-Lingxi-Route'), text: await res.text() }
}, opts)

test('0.2.1 routing', async (t) => {
  try {
    await t.test('the loader warms the native catalog itself, without models()', async () => {
      const { calls, route } = await call('deepseek-v4-pro')
      assert.ok(calls.some((c) => c.url.includes('/sessions/plans')), 'catalog must be fetched lazily')
      assert.ok(calls.some((c) => c.url.includes('/credits/runs')), 'native run must be requested')
      assert.equal(route, 'native')
    })

    await t.test('models() lists native and web together, tagged by route', async () => {
      const models = await withUpstream(() => plugin.provider.models({ id: 'wps-lingxi' }, { auth: { cookie: 'c' } }))
      assert.deepEqual(
        Object.keys(models).sort(),
        ['GLM-5.1', 'deepseek-v4-pro', 'kimi-k3.1-pro', 'plan_max', 'plan_pro'],
        'web-only models must survive the native catalog',
      )
      assert.match(models['deepseek-v4-pro'].name, /· 原生$/)
      assert.match(models['kimi-k3.1-pro'].name, /· 网页$/)
      assert.match(models['plan_pro'].name, /· 网页$/)
      assert.deepEqual(models['deepseek-v4-pro'].variants, ['low', 'high', 'max'])
      assert.deepEqual(models['kimi-k3.1-pro'].variants, [], 'web route does not stream reasoning, so no variants')
      assert.equal(models['kimi-k3.1-pro'].capabilities.reasoning, false)
    })

    await t.test('a native key rejected by credits/runs downgrades to the web route', async () => {
      const first = await call('GLM-5.1', {}, { rejectRun: true })
      assert.equal(first.route, 'legacy', 'the rejected call must be served by the web route')
      assert.ok(first.calls.some((c) => c.url.includes('/credits/runs')), 'native must be attempted once')
      assert.match(first.text, /legacy-ok/)

      const second = await call('GLM-5.1', {}, { rejectRun: true })
      assert.equal(second.route, 'legacy')
      assert.ok(!second.calls.some((c) => c.url.includes('/credits/runs')), 'the rejected key must be remembered')
    })

    await t.test('plan_* goes to the web route even though it is in the native catalog', async () => {
      const { calls, route } = await call('plan_pro')
      assert.ok(!calls.some((c) => c.url.includes('/credits/runs')), 'credits/runs rejects plan keys with 400')
      assert.ok(calls.some((c) => c.url.endsWith('/sessions')), 'legacy session must be created')
      assert.equal(route, 'legacy')
    })

    await t.test('web-only model uses the web route and says so', async () => {
      const { calls, route, text } = await call('kimi-k3.1-pro')
      assert.equal(route, 'legacy')
      assert.ok(!calls.some((c) => c.url.includes('/agent-runtime/chat/completions')))
      assert.match(text, /legacy-ok/)
    })

    await t.test('native model reports its route too', async () => {
      const { route, text } = await call('deepseek-v4-pro')
      assert.equal(route, 'native')
      assert.match(text, /native-ok/)
    })

    await t.test('catalog outage still yields the web model list', async () => {
      const models = await withUpstream(
        () => plugin.provider.models({ id: 'wps-lingxi' }, { auth: { cookie: 'c' } }),
        { catalogStatus: 500 },
      )
      assert.ok(models['kimi-k3.1-pro'], 'web models must still be listed')
      assert.deepEqual(models['kimi-k3.1-pro'].variants, [])
    })
  } finally {
    globalThis.fetch = nativeFetch
  }
})
