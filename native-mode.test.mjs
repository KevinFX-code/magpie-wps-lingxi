import { test } from 'node:test'
import assert from 'node:assert/strict'
import { WPSLingxiAuthPlugin } from './index.mjs'

const plugin = await WPSLingxiAuthPlugin()
const authFn = async () => ({ cookie: 'wps_sid=test' })
const loader = await plugin.auth.loader(authFn)
const nativeFetch = globalThis.fetch

const CATALOG = {
  data: {
    models: [
      { key: 'native-one', name: 'Native One', desc: 'first' },
      { key: 'native-two', name: 'Native Two', desc: 'second' },
    ],
    plans: [{ key: 'plan_pro', name: 'Pro 模式', desc: 'reasoning' }],
  },
}

function sse(lines) {
  return lines.map((l) => `data: ${JSON.stringify(l)}\n\n`).join('')
}

const TOOL_SSE = sse([
  { code: 'Success', usage: { completion_tokens: 0 }, choices: [{ index: 0, finish_reason: '', text: '', reasoning_content: 'thinking' }] },
  { code: 'Success', choices: [{ index: 0, finish_reason: '', tool_calls: [{ type: 'function', id: 'call_1', index: 0, function: { name: 'write', arguments: '' } }] }] },
  { code: 'Success', choices: [{ index: 0, finish_reason: '', tool_calls: [{ type: '', id: '', index: 0, function: { name: '', arguments: '{"a":1}' } }] }] },
  { code: 'Success', usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15, cached_tokens: 0 }, choices: [{ index: 0, finish_reason: 'tool_calls', text: '', reasoning_content: '' }] },
])

const TEXT_SSE = sse([
  { code: 'Success', usage: { completion_tokens: 0 }, choices: [{ index: 0, finish_reason: '', text: '', reasoning_content: 'plan' }] },
  { code: 'Success', choices: [{ index: 0, finish_reason: '', text: 'hi' }] },
  { code: 'Success', usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 }, choices: [{ index: 0, finish_reason: 'stop', text: '', reasoning_content: '' }] },
])

// 记录所有上游调用，按 URL 路由
async function withUpstream(handler, fn) {
  const calls = []
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init })
    return handler(String(url), init, calls)
  }
  try {
    return await fn(calls)
  } finally {
    globalThis.fetch = nativeFetch
  }
}

const nativeHandler = (opts = {}) => async (url, init) => {
  if (url.includes('/api/aioffice/v1/sessions/plans')) return Response.json(opts.catalog ?? CATALOG)
  if (url.includes('/api/public/v1/credits/runs')) {
    if (opts.runStatus) return new Response('{"code":"UserUnauthorized"}', { status: opts.runStatus })
    return Response.json({ data: { run_id: 'run-1', status: 'created' } })
  }
  if (url.includes('/agent-runtime/chat/completions')) {
    if (opts.chatStatus) return new Response('{"code":"GatewayError"}', { status: opts.chatStatus })
    if (opts.chatBody) return new Response(JSON.stringify(opts.chatBody), { headers: { 'Content-Type': 'application/json' } })
    return new Response(opts.sse ?? TEXT_SSE)
  }
  if (url.endsWith('/sessions')) return Response.json({ data: { session_id: 'legacy-1' } })
  return new Response(opts.legacySse ?? TEXT_SSE)
}

const chunksOf = (text) => text.split('\n')
  .filter((l) => l.startsWith('data: ') && !l.includes('[DONE]'))
  .map((l) => JSON.parse(l.slice(6)))

test('native agent runtime', async (t) => {
  try {
    await t.test('catalog drives the model list', async () => {
      const models = await withUpstream(nativeHandler(), () => plugin.provider.models({ id: 'wps-lingxi' }, { auth: { cookie: 'c' } }))
      assert.deepEqual(Object.keys(models).sort(), ['native-one', 'native-two', 'plan_pro'])
      assert.equal(models['native-one'].capabilities.toolcall, true)
      assert.equal(models['native-one'].api.id, 'native-one')
    })

    await t.test('request is native: run then chat with messages/tools/context', async () => {
      const { calls, text } = await withUpstream(nativeHandler(), async (calls) => {
        const res = await loader.fetch('https://mock/v1/chat/completions', {
          body: JSON.stringify({
            model: 'wps-lingxi/native-one',
            stream: true,
            reasoning_effort: 'max',
            max_tokens: 2048,
            messages: [
              { role: 'system', content: 'be brief' },
              { role: 'user', content: 'hi' },
            ],
            tools: [{ type: 'function', function: { name: 'write', parameters: { type: 'object' } } }],
          }),
        })
        return { calls, text: await res.text() }
      })

      const run = calls.find((c) => c.url.includes('/credits/runs'))
      const chat = calls.find((c) => c.url.includes('/agent-runtime/chat/completions'))
      assert.ok(run, 'credits/runs must be called')
      assert.ok(chat, 'agent-runtime must be called')

      const runBody = JSON.parse(run.init.body)
      assert.equal(runBody.model_provider, 'lingxi')
      assert.equal(runBody.model_id, 'native-one')
      assert.equal(runBody.client_type, 'wps_separate')

      const chatBody = JSON.parse(chat.init.body)
      assert.equal(chatBody.model, 'native-one')
      assert.equal(chatBody.context, 'be brief')
      assert.deepEqual(chatBody.messages, [{ role: 'user', content: 'hi' }])
      assert.equal(chatBody.tools[0].function.name, 'write')
      assert.equal(chatBody.reasoning_effort, 'max')
      assert.equal(chatBody.base_llm_arguments.max_tokens, 2048)
      assert.deepEqual(chatBody.sec_text, { from: 'AI_WPS_SMARTASSISTANT', scene: 'soul_claw' })
      assert.equal(chat.init.headers['X-Cc-Run-ID'], 'run-1')
      assert.equal(chat.init.headers['AI-Gateway-Product-Name'], 'wps-public-pc')
      assert.equal(chat.init.headers['AI-Gateway-Intention-Code'], 'wps_public_home_agentconversation')
      assert.match(text, /\[DONE\]/)
    })

    await t.test('native tool_calls and usage are translated to OpenAI chunks', async () => {
      const { text } = await withUpstream(nativeHandler({ sse: TOOL_SSE }), async () => {
        const res = await loader.fetch('https://mock/v1/chat/completions', {
          body: JSON.stringify({ model: 'native-one', stream: true, messages: [{ role: 'user', content: 'go' }] }),
        })
        return { text: await res.text() }
      })
      const chunks = chunksOf(text)
      const reasoning = chunks.filter((c) => c.choices?.[0]?.delta?.reasoning_content).map((c) => c.choices[0].delta.reasoning_content)
      assert.deepEqual(reasoning, ['thinking'])

      const toolDeltas = chunks.flatMap((c) => c.choices?.[0]?.delta?.tool_calls ?? [])
      assert.equal(toolDeltas.length, 2)
      assert.equal(toolDeltas[0].id, 'call_1')
      assert.equal(toolDeltas[0].function.name, 'write')
      assert.equal(toolDeltas[1].function.arguments, '{"a":1}')

      const finish = chunks.map((c) => c.choices?.[0]?.finish_reason).filter(Boolean)
      assert.deepEqual(finish, ['tool_calls'])

      const usage = chunks.find((c) => c.usage)?.usage
      assert.deepEqual(usage, { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 })
    })

    await t.test('non-stream response is a chat.completion', async () => {
      const { text } = await withUpstream(nativeHandler({
        chatBody: {
          code: 'Success',
          usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
          choices: [{ index: 0, finish_reason: 'stop', text: 'ok', reasoning_content: 'r' }],
        },
      }), async () => {
        const res = await loader.fetch('https://mock/v1/chat/completions', {
          body: JSON.stringify({ model: 'native-one', stream: false, messages: [{ role: 'user', content: 'hi' }] }),
        })
        return { text: await res.text() }
      })
      const json = JSON.parse(text)
      assert.equal(json.object, 'chat.completion')
      assert.equal(json.choices[0].message.content, 'ok')
      assert.equal(json.choices[0].message.reasoning_content, 'r')
      assert.equal(json.choices[0].finish_reason, 'stop')
      assert.equal(json.usage.total_tokens, 5)
    })

    await t.test('unknown model falls back to the legacy web path', async () => {
      const { calls } = await withUpstream(nativeHandler(), async (calls) => {
        await loader.fetch('https://mock/v1/chat/completions', {
          body: JSON.stringify({ model: 'deepseek-v4.1-flash', stream: true, messages: [{ role: 'user', content: 'hi' }] }),
        }).then((r) => r.text())
        return { calls }
      })
      assert.ok(calls.some((c) => c.url.endsWith('/sessions')), 'legacy session must be created')
      assert.ok(!calls.some((c) => c.url.includes('/credits/runs')), 'native run must not be requested')
    })

    await t.test('run rejection is surfaced with the upstream status', async () => {
      const { res } = await withUpstream(nativeHandler({ runStatus: 401 }), async () => {
        const r = await loader.fetch('https://mock/v1/chat/completions', {
          body: JSON.stringify({ model: 'native-one', messages: [{ role: 'user', content: 'hi' }] }),
        })
        return { res: r }
      })
      assert.equal(res.status, 401)
      assert.match(await res.text(), /401/)
    })

    await t.test('chat error is surfaced with the upstream status', async () => {
      const { res } = await withUpstream(nativeHandler({ chatStatus: 500 }), async () => {
        const r = await loader.fetch('https://mock/v1/chat/completions', {
          body: JSON.stringify({ model: 'native-one', messages: [{ role: 'user', content: 'hi' }] }),
        })
        return { res: r }
      })
      assert.equal(res.status, 500)
      assert.match(await res.text(), /GatewayError/)
    })

    await t.test('catalog failure falls back to the legacy model list', async () => {
      const models = await withUpstream(async (url) => {
        if (url.includes('/sessions/plans')) return new Response('nope', { status: 500 })
        return new Response('[]')
      }, () => plugin.provider.models({ id: 'wps-lingxi' }, { auth: { cookie: 'c' } }))
      assert.ok(models['deepseek-v4.1-flash'], 'legacy table must be returned')
    })
  } finally {
    globalThis.fetch = nativeFetch
  }
})
