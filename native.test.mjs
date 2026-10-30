import { test } from 'node:test'
import assert from 'node:assert/strict'
import { WPSLingxiAuthPlugin } from './index.mjs'

const plugin = await WPSLingxiAuthPlugin()
const loader = await plugin.auth.loader(async () => ({ cookie: '{{SECRET_x1s8hd2m}}' }))
const nativeFetch = globalThis.fetch

const SSE = `data: ${JSON.stringify({ type: 'text', data: 'ok' })}\n\ndata: ${JSON.stringify({ type: 'end' })}\n\n`

async function capture(body) {
  const calls = []
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init })
    if (url.endsWith('/sessions')) return Response.json({ data: { session_id: 's1' } })
    return new Response(SSE)
  }
  const res = await loader.fetch('https://mock/v1/chat/completions', { body: JSON.stringify(body) })
  await res.text()
  const [, completion] = calls
  return {
    session: calls[0],
    completion,
    payload: JSON.parse(completion.init.body),
    headers: completion.init.headers,
  }
}

test('native request shape', async (t) => {
  try {
    await t.test('session is created with an empty body first', async () => {
      const { session } = await capture({ model: 'wps-lingxi/kimi-k3.1-pro', messages: [{ role: 'user', content: 'hi' }] })
      assert.match(session.url, /\/api\/aigc\/v3\/assistant\/sessions$/)
      assert.equal(session.init.method, 'POST')
      assert.equal(session.init.body, '{}')
    })

    await t.test('completions carries the fields the web client sends', async () => {
      const { payload, completion } = await capture({
        model: 'wps-lingxi/kimi-k3.1-pro',
        messages: [{ role: 'user', content: 'hi' }],
      })
      assert.match(completion.url, /\/api\/aigc\/v3\/assistant\/sessions\/s1\/completions$/)
      assert.equal(completion.init.method, 'POST')
      assert.equal(payload.expect_model, 'kimi-k3.1-pro')
      assert.equal(payload.question, 'User: hi')
      assert.equal(payload.user_input.text, payload.question)
      assert.equal(payload.thinking, 'auto')
      assert.equal(payload.with_mcp, false)
      assert.equal(payload.with_expert, false)
    })

    await t.test('client headers match the web app', async () => {
      const { headers } = await capture({ messages: [{ role: 'user', content: 'hi' }] })
      assert.equal(headers['X-Cc-Version'], '1')
      assert.equal(headers['X-Client-Type'], 'lingxi-web')
      assert.equal(headers['Content-Type'], 'application/json')
    })

    await t.test('reasoning_effort 0 turns thinking off', async () => {
      const { payload } = await capture({
        messages: [{ role: 'user', content: 'hi' }],
        reasoning_effort: 'low',
      })
      assert.equal(payload.reasoning_effort, '0')
      assert.equal(payload.thinking, 'disabled')
    })

    await t.test('reasoning_effort high keeps thinking on', async () => {
      const { payload } = await capture({
        messages: [{ role: 'user', content: 'hi' }],
        reasoning_effort: 'max',
      })
      assert.equal(payload.reasoning_effort, '2')
      assert.equal(payload.thinking, 'auto')
    })

    await t.test('model prefix is stripped but defaults survive', async () => {
      const { payload } = await capture({ messages: [{ role: 'user', content: 'hi' }] })
      assert.equal(payload.expect_model, 'deepseek-v4.1-flash')
    })
  } finally {
    globalThis.fetch = nativeFetch
  }
})
