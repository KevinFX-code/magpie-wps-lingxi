import { test } from 'node:test'
import assert from 'node:assert/strict'
import { makePlugin } from './test-helpers.mjs'

const plugin = await makePlugin()
const loader = await plugin.auth.loader(async () => ({ cookie: '{{SECRET_9n5hfz3k}}' }))
const nativeFetch = globalThis.fetch

const SSE = `data: ${JSON.stringify({ type: 'text', data: 'ok' })}\n\ndata: ${JSON.stringify({ type: 'end' })}\n\n`

async function questionOf(body) {
  const calls = []
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init })
    if (url.endsWith('/sessions')) return Response.json({ data: { session_id: 's' } })
    return new Response(SSE)
  }
  const res = await loader.fetch('https://mock/v1/chat/completions', { body: JSON.stringify(body) })
  await res.text()
  return JSON.parse(calls[1].init.body).question
}

test('prompt structure', async (t) => {
  try {
    await t.test('system is hoisted to the front and de-duplicated', async () => {
      const q = await questionOf({
        messages: [
          { role: 'system', content: 'RULES-A' },
          { role: 'user', content: 'hello' },
          { role: 'assistant', content: 'hi' },
          { role: 'system', content: 'RULES-A' },
          { role: 'user', content: 'again' },
        ],
      })
      assert.equal(q.match(/RULES-A/g).length, 1)
      assert.ok(q.startsWith('SYSTEM:\nRULES-A'), q.slice(0, 40))
    })

    await t.test('sections are ordered SYSTEM → TOOLS → history → request', async () => {
      const q = await questionOf({
        messages: [
          { role: 'system', content: 'S1' },
          { role: 'user', content: 'first' },
          { role: 'assistant', content: 'second' },
          { role: 'user', content: 'third' },
        ],
        tools: [{ type: 'function', function: { name: 'write', parameters: { type: 'object' } } }],
      })
      const at = (s) => q.indexOf(s)
      assert.ok(at('SYSTEM:') < at('TOOLS:'), 'system before tools')
      assert.ok(at('TOOLS:') < at('User: first'), 'tools before history')
      assert.ok(at('User: first') < at('User: third'), 'history before request')
      assert.ok(q.endsWith('User: third'))
    })

    await t.test('single user message stays a single request line', async () => {
      assert.equal(await questionOf({ messages: [{ role: 'user', content: 'just this' }] }), 'User: just this')
    })

    await t.test('developer role counts as system', async () => {
      const q = await questionOf({
        messages: [{ role: 'developer', content: 'DEV-RULES' }, { role: 'user', content: 'q' }],
      })
      assert.ok(q.startsWith('SYSTEM:\nDEV-RULES'))
    })

    await t.test('the last user message is not duplicated into history', async () => {
      const q = await questionOf({
        messages: [{ role: 'user', content: 'only-once' }],
      })
      assert.equal(q.match(/only-once/g).length, 1)
    })

    await t.test('tool results keep their label', async () => {
      const q = await questionOf({
        messages: [
          { role: 'user', content: 'go' },
          { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'write', arguments: '{}' } }] },
          { role: 'tool', tool_call_id: 'c1', name: 'write', content: 'done' },
          { role: 'user', content: 'next' },
        ],
      })
      assert.match(q, /Tool \(write\): done/)
    })

    await t.test('trailing tool result keeps chronological order', async () => {
      const q = await questionOf({
        messages: [
          { role: 'user', content: 'go' },
          { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'write', arguments: '{}' } }] },
          { role: 'tool', tool_call_id: 'c1', name: 'write', content: 'done' },
        ],
      })
      const at = (s) => q.indexOf(s)
      assert.ok(at('User: go') < at('Assistant: <|FunctionCallBegin|>'))
      assert.ok(at('Assistant: <|FunctionCallBegin|>') < at('Tool (write): done'))
      assert.ok(at('Tool (write): done') < at('请据此继续'))
      assert.equal(q.match(/User: go/g).length, 1)
    })

    await t.test('image parts degrade to a visible placeholder', async () => {
      const q = await questionOf({
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'what is this' },
              { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } },
            ],
          },
        ],
      })
      assert.match(q, /what is this/)
      assert.match(q, /\[image\]/)
      assert.doesNotMatch(q, /base64/)
    })

    await t.test('empty conversation still produces a request', async () => {
      assert.equal(await questionOf({ messages: [] }), 'User: 你好')
    })
  } finally {
    globalThis.fetch = nativeFetch
  }
})
