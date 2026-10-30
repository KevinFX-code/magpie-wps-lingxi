import { test } from 'node:test'
import assert from 'node:assert/strict'
import { WPSLingxiAuthPlugin } from './index.mjs'

const plugin = await WPSLingxiAuthPlugin()
const auth = async () => ({ cookie: 'wps_sid=test' })
const loader = await plugin.auth.loader(auth)
const nativeFetch = globalThis.fetch

const WRITE_TOOL = {
  type: 'function',
  function: {
    name: 'write',
    description: 'Write a file',
    parameters: {
      type: 'object',
      properties: { file_path: { type: 'string' }, content: { type: 'string' } },
      required: ['file_path', 'content'],
    },
  },
}

const ENVELOPE = '<|FunctionCallBegin|>[{"name":"write","parameters":{"file_path":"D:\\\\DSH\\\\a.svg","content":"<svg/>"}}]<|FunctionCallEnd|>'

// 把上游 SSE 文本切成任意大小的块，模拟网络/UTF-8 边界
function sseFrom(texts, size = Infinity) {
  const payload = texts.map((t) => `data: ${JSON.stringify({ type: 'text', data: t })}\n\n`).join('') +
    `data: ${JSON.stringify({ type: 'end' })}\n\n`
  const bytes = new TextEncoder().encode(payload)
  return new ReadableStream({
    start(c) {
      for (let i = 0; i < bytes.length; i += size) c.enqueue(bytes.slice(i, i + size))
      c.close()
    },
  })
}

async function run({ texts, stream = false, tools = [WRITE_TOOL], messages, size = Infinity }) {
  const calls = []
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init })
    if (url.endsWith('/sessions')) return Response.json({ data: { session_id: 's1' } })
    return new Response(sseFrom(texts, size))
  }
  const res = await loader.fetch('https://mock/v1/chat/completions', {
    body: JSON.stringify({
      model: 'wps-lingxi/deepseek-v4.1-flash',
      stream,
      messages: messages ?? [{ role: 'user', content: 'draw a pelican' }],
      ...(tools.length ? { tools } : {}),
    }),
  })
  return { res, text: await res.text(), calls, body: calls[1] ? JSON.parse(calls[1].init.body) : null }
}

function chunksOf(text) {
  return text.split('\n')
    .filter((l) => l.startsWith('data: ') && !l.includes('[DONE]'))
    .map((l) => JSON.parse(l.slice(6)))
}

test('native tool calls are bridged to OpenAI tool_calls', async (t) => {
  try {
    await t.test('non-stream: envelope becomes tool_calls', async () => {
      const { res, text } = await run({ texts: ['I will write it.\n\n' + ENVELOPE] })
      assert.equal(res.status, 200)
      const json = JSON.parse(text)
      const choice = json.choices[0]
      assert.equal(choice.finish_reason, 'tool_calls')
      assert.equal(choice.message.tool_calls.length, 1)
      assert.equal(choice.message.tool_calls[0].function.name, 'write')
      assert.deepEqual(JSON.parse(choice.message.tool_calls[0].function.arguments), {
        file_path: 'D:\\DSH\\a.svg', content: '<svg/>',
      })
      assert.doesNotMatch(choice.message.content ?? '', /FunctionCall/)
      assert.match(choice.message.content ?? '', /I will write it/)
    })

    await t.test('stream: byte-by-byte still yields one complete call', async () => {
      const { text } = await run({ texts: ['before ' + ENVELOPE + ' after'], stream: true, size: 1 })
      const chunks = chunksOf(text)
      const deltas = chunks.flatMap((c) => c.choices?.[0]?.delta?.tool_calls ?? [])
      assert.equal(deltas.length, 1)
      assert.equal(deltas[0].function.name, 'write')
      assert.deepEqual(JSON.parse(deltas[0].function.arguments), {
        file_path: 'D:\\DSH\\a.svg', content: '<svg/>',
      })
      const content = chunks.map((c) => c.choices?.[0]?.delta?.content ?? '').join('')
      assert.equal(content, 'before  after')
      const finish = chunks.map((c) => c.choices?.[0]?.finish_reason).filter(Boolean)
      assert.deepEqual(finish, ['tool_calls'])
      assert.match(text, /data: \[DONE\]/)
    })

    await t.test('envelope split across SSE events', async () => {
      const half = Math.floor(ENVELOPE.length / 2)
      const { text } = await run({ texts: [ENVELOPE.slice(0, half), ENVELOPE.slice(half)], stream: true })
      const chunks = chunksOf(text)
      assert.equal(chunks.flatMap((c) => c.choices?.[0]?.delta?.tool_calls ?? []).length, 1)
      assert.equal(chunks.map((c) => c.choices?.[0]?.delta?.content ?? '').join(''), '')
    })

    await t.test('multiple calls in one block', async () => {
      const block = '<|FunctionCallBegin|>[' +
        '{"name":"write","parameters":{"file_path":"a","content":"x"}},' +
        '{"name":"write","parameters":{"file_path":"b","content":"y"}}]<|FunctionCallEnd|>'
      const { text } = await run({ texts: [block], stream: true })
      const deltas = chunksOf(text).flatMap((c) => c.choices?.[0]?.delta?.tool_calls ?? [])
      assert.deepEqual(deltas.map((d) => d.index), [0, 1])
      assert.notEqual(deltas[0].id, deltas[1].id)
    })

    await t.test('unknown tool name is not executed', async () => {
      const block = '<|FunctionCallBegin|>[{"name":"rm_rf","parameters":{"path":"/"}}]<|FunctionCallEnd|>'
      const { text } = await run({ texts: [block] })
      const json = JSON.parse(text)
      assert.equal(json.choices[0].finish_reason, 'stop')
      assert.equal(json.choices[0].message.tool_calls, undefined)
      assert.match(json.choices[0].message.content, /FunctionCallBegin/)
    })

    await t.test('malformed payload stays as text', async () => {
      const block = '<|FunctionCallBegin|>[{"name":"write","parameters":]<|FunctionCallEnd|>'
      const { text } = await run({ texts: [block] })
      assert.match(JSON.parse(text).choices[0].message.content, /FunctionCallBegin/)
    })

    await t.test('envelope without a tool list is left alone', async () => {
      const { text } = await run({ texts: [ENVELOPE], tools: [] })
      assert.equal(JSON.parse(text).choices[0].finish_reason, 'stop')
    })

    await t.test('tool schemas are forwarded in the prompt', async () => {
      const { body } = await run({ texts: ['ok'] })
      assert.match(body.question, /write/)
      assert.match(body.question, /FunctionCallBegin/)
      assert.match(body.question, /file_path/)
      assert.equal(body.tools, undefined)
    })

    await t.test('tool loop history is flattened in native form', async () => {
      const { body } = await run({
        texts: ['done'],
        messages: [
          { role: 'system', content: 'be brief' },
          { role: 'user', content: 'draw' },
          {
            role: 'assistant', content: null,
            tool_calls: [{ id: 'c1', type: 'function', function: { name: 'write', arguments: '{"file_path":"a","content":"x"}' } }],
          },
          { role: 'tool', tool_call_id: 'c1', name: 'write', content: 'ok' },
          { role: 'user', content: 'now what' },
        ],
      })
      assert.match(body.question, /SYSTEM:\nbe brief/)
      assert.match(body.question, /Assistant: <\|FunctionCallBegin\|>/)
      assert.match(body.question, /Tool \(write\): ok/)
      assert.match(body.question, /User: now what$/)
    })
  } finally {
    globalThis.fetch = nativeFetch
  }
})
