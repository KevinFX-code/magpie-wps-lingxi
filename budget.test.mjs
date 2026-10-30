// 0.2.2: prompt budget + upstream error detail.
// 预算设成 32KB 让小数据量就能触发截断，跑得快。
process.env.MAGPIE_LINGXI_MAX_PROMPT_KB = '32'
process.env.MAGPIE_LINGXI_MAX_HISTORY_LINE_KB = '8'

import { test } from 'node:test'
import assert from 'node:assert/strict'

const { WPSLingxiAuthPlugin } = await import('./index.mjs')

const plugin = await WPSLingxiAuthPlugin()
const auth = { cookie: 'wps_sid=test' }
const loader = await plugin.auth.loader(async () => auth)
const nativeFetch = globalThis.fetch

const BUDGET = 32 * 1024
const byteLen = (s) => Buffer.byteLength(String(s ?? ''), 'utf8')

const OK_SSE = 'data: {"type":"text","data":"ok"}\n\ndata: {"type":"end"}\n\n'
const LIMIT_SSE = 'event:error\ndata:{"result":"PromptTokenExceedLimit","msg":"场景token超过限制"}\n\n'

const NATIVE_CATALOG = { data: { models: [{ key: 'native-one', name: 'Native One' }], plans: [] } }

async function withUpstream(handler, fn) {
  const calls = []
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url)
    calls.push({ url: u, init })
    return handler(u, init, calls)
  }
  try {
    return await fn(calls)
  } finally {
    globalThis.fetch = nativeFetch
  }
}

const legacyHandler = (sse = OK_SSE) => async (url) => {
  if (url.includes('/sessions/plans')) return Response.json(NATIVE_CATALOG)
  if (url.endsWith('/sessions')) return Response.json({ data: { session_id: 's1' } })
  return new Response(sse)
}

async function send(body, handler = legacyHandler()) {
  return withUpstream(handler, async (calls) => {
    const res = await loader.fetch('https://mock/v1/chat/completions', { body: JSON.stringify(body) })
    const text = await res.text()
    const completion = calls.find((c) => c.url.includes('/completions'))
    return {
      status: res.status,
      text,
      calls,
      question: completion ? JSON.parse(completion.init.body).question : null,
    }
  })
}

const big = (kb) => 'x'.repeat(kb * 1024)

test('0.2.2 prompt budget', async (t) => {
  try {
    await t.test('long history is trimmed from the oldest end', async () => {
      const messages = [{ role: 'system', content: 'be brief' }]
      for (let i = 0; i < 40; i++) {
        messages.push({ role: 'user', content: `q${i} ` + big(1) })
        messages.push({ role: 'assistant', content: `a${i} ` + big(1) })
      }
      messages.push({ role: 'user', content: 'FINAL-REQUEST' })

      const { question } = await send({ model: 'kimi-k3.1-pro', stream: false, messages })
      assert.ok(byteLen(question) <= BUDGET + 4096, `question must respect the budget, got ${(byteLen(question) / 1024).toFixed(1)}KB`)
      assert.match(question, /历史已压缩/)
      assert.match(question, /User: FINAL-REQUEST$/)
      assert.doesNotMatch(question, /q0 /, 'the oldest message must be dropped')
      assert.match(question, /a39 /, 'the newest history must survive')
    })

    await t.test('one oversized message is elided instead of taking the whole history with it', async () => {
      // 一个 100KB 的粘贴夹在中间：不能被整条丢掉，否则其余历史一起陪葬
      const huge = 'HEAD-' + 'z'.repeat(100 * 1024) + '-TAIL'
      const { question } = await send({
        model: 'kimi-k3.1-pro',
        stream: false,
        messages: [
          { role: 'system', content: 'be brief' },
          { role: 'user', content: huge },
          { role: 'assistant', content: '收到' },
          { role: 'user', content: 'FINAL-REQUEST' },
        ],
      })
      assert.ok(byteLen(question) <= BUDGET + 4096, `question must stay within budget, got ${(byteLen(question) / 1024).toFixed(1)}KB`)
      assert.match(question, /本条历史过长已截断/, 'the oversized line must be elided')
      assert.match(question, /HEAD-/, 'the head of the long message must survive')
      assert.match(question, /-TAIL/, 'the tail of the long message must survive')
      assert.match(question, /Assistant: 收到/, 'neighbouring history must survive')
      assert.match(question, /User: FINAL-REQUEST$/)
    })

    await t.test('a request that cannot fit even without history is a 400, not a retryable 502', async () => {
      const res = await send({
        model: 'kimi-k3.1-pro',
        stream: false,
        messages: [{ role: 'system', content: big(40) }, { role: 'user', content: 'hi' }],
      })
      assert.equal(res.status, 400)
      assert.match(res.text, /prompt_token_exceed_limit/)
      assert.equal(res.question, null, 'must not reach upstream')
    })

    await t.test('upstream error frames expose result/msg instead of a generic message', async () => {
      const res = await send({ model: 'kimi-k3.1-pro', stream: false, messages: [{ role: 'user', content: 'hi' }] }, legacyHandler(LIMIT_SSE))
      assert.equal(res.status, 400, 'prompt-limit must not be retried as 502')
      assert.match(res.text, /场景token超过限制/)
      assert.match(res.text, /PromptTokenExceedLimit/)
    })

    await t.test('the same error is visible in the stream', async () => {
      const res = await send({ model: 'kimi-k3.1-pro', stream: true, messages: [{ role: 'user', content: 'hi' }] }, legacyHandler(LIMIT_SSE))
      assert.match(res.text, /场景token超过限制/)
      assert.match(res.text, /PromptTokenExceedLimit/)
    })

    await t.test('native route trims oversized message lists too', async () => {
      const handler = async (url) => {
        if (url.includes('/sessions/plans')) return Response.json(NATIVE_CATALOG)
        if (url.includes('/credits/runs')) return Response.json({ data: { run_id: 'run-1', status: 'created' } })
        if (url.includes('/agent-runtime/chat/completions')) {
          return new Response('data: {"code":"Success","usage":{"prompt_tokens":1,"completion_tokens":1,"total_tokens":2},"choices":[{"index":0,"finish_reason":"stop","text":"ok"}]}\n\n')
        }
        return new Response(OK_SSE)
      }
      const messages = [{ role: 'system', content: 'be brief' }]
      for (let i = 0; i < 40; i++) {
        messages.push({ role: 'user', content: `q${i} ` + big(1) })
        messages.push({ role: 'assistant', content: `a${i} ` + big(1) })
      }
      messages.push({ role: 'user', content: 'FINAL-REQUEST' })

      const res = await withUpstream(handler, async (calls) => {
        const r = await loader.fetch('https://mock/v1/chat/completions', {
          body: JSON.stringify({ model: 'native-one', stream: false, messages }),
        })
        return { status: r.status, calls, chat: calls.find((c) => c.url.includes('/agent-runtime/chat/completions')) }
      })
      assert.equal(res.status, 200)
      const sent = JSON.parse(res.chat.init.body)
      const total = sent.messages.reduce((n, m) => n + byteLen(m.content), 0) + byteLen(sent.context)
      assert.ok(total <= BUDGET + 4096, `native payload must respect the budget, got ${(total / 1024).toFixed(1)}KB`)
      assert.equal(sent.messages.at(-1).content, 'FINAL-REQUEST', 'the current request must survive')
      assert.ok(!sent.messages.some((m) => String(m.content).startsWith('q0 ')), 'oldest message must be dropped')
    })
  } finally {
    globalThis.fetch = nativeFetch
  }
})
