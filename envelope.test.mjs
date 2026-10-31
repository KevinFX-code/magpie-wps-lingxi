import { test } from 'node:test'
import assert from 'node:assert/strict'
import { makePlugin } from './test-helpers.mjs'

const plugin = await makePlugin()
const loader = await plugin.auth.loader(async () => ({ cookie: 'wps_sid=test' }))
const nativeFetch = globalThis.fetch

const TOOLS = [
  { type: 'function', function: { name: 'write', description: 'write a file', parameters: { type: 'object', properties: { file_path: { type: 'string' }, content: { type: 'string' } }, required: ['file_path', 'content'] } } },
  { type: 'function', function: { name: 'present', description: 'present files', parameters: { type: 'object', properties: { files: { type: 'array' } }, required: ['files'] } } },
]

function sseFromText(text, chunks = 3) {
  const size = Math.ceil(text.length / chunks)
  const frames = []
  for (let i = 0; i < text.length; i += size) {
    frames.push(`data: ${JSON.stringify({ type: 'text', data: text.slice(i, i + size) })}\n\n`)
  }
  frames.push(`data: ${JSON.stringify({ type: 'end' })}\n\n`)
  return frames.join('')
}

async function run(text, chunks = 3) {
  const calls = []
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init })
    if (String(url).includes('/sessions/plans')) return Response.json({ data: { models: [], plans: [] } })
    if (String(url).endsWith('/sessions')) return Response.json({ data: { session_id: 's1' } })
    return new Response(sseFromText(text, chunks))
  }
  try {
    const res = await loader.fetch('https://mock/v1/chat/completions', {
      body: JSON.stringify({ model: 'kimi-k3.1-pro', stream: true, tools: TOOLS, messages: [{ role: 'user', content: 'go' }] }),
    })
    const body = await res.text()
    const chunksOut = body.split('\n').filter((l) => l.startsWith('data: ') && !l.includes('[DONE]')).map((l) => JSON.parse(l.slice(6)))
    const toolCalls = chunksOut.flatMap((c) => c.choices?.[0]?.delta?.tool_calls ?? [])
    const content = chunksOut.map((c) => c.choices?.[0]?.delta?.content ?? '').join('')
    const finish = chunksOut.map((c) => c.choices?.[0]?.finish_reason).filter(Boolean)
    return { toolCalls, content, finish }
  } finally {
    globalThis.fetch = nativeFetch
  }
}

const XML_BODY = `<|FunctionCallBegin|>
<function name="write">
<parameter name="file_path" string="true">D:\\DSH\\pelican-latest.svg</parameter>
<parameter name="content" string="true"><svg><circle r="1"/></svg></parameter>
</function>
<function name="present">
<parameter name="files" string="false">[{"path":"D:\\\\DSH\\\\pelican-latest.svg","description":"latest"}]</parameter>
</function>
</seed:tool_call>`

test('tool-call envelope dialects', async (t) => {
  try {
    await t.test('JSON envelope still works', async () => {
      const { toolCalls, content, finish } = await run('<|FunctionCallBegin|>[{"name":"write","parameters":{"file_path":"a.txt","content":"hi"}}]<|FunctionCallEnd|>')
      assert.equal(toolCalls.length, 1)
      assert.equal(toolCalls[0].function.name, 'write')
      assert.equal(content, '')
      assert.deepEqual(finish, ['tool_calls'])
    })

    await t.test('XML dialect with </seed:tool_call> is parsed, not leaked as text', async () => {
      const { toolCalls, content, finish } = await run(XML_BODY)
      assert.equal(toolCalls.length, 2, 'both <function> blocks must become tool calls')
      assert.equal(toolCalls[0].function.name, 'write')
      assert.equal(toolCalls[1].function.name, 'present')
      assert.equal(content, '', 'no envelope text may leak into the reply')
      assert.deepEqual(finish, ['tool_calls'])
    })

    await t.test('string="true" stays a string, string="false" is JSON-decoded', async () => {
      const { toolCalls } = await run(XML_BODY)
      const write = JSON.parse(toolCalls[0].function.arguments)
      assert.equal(write.file_path, 'D:\\DSH\\pelican-latest.svg')
      assert.equal(write.content, '<svg><circle r="1"/></svg>')
      const present = JSON.parse(toolCalls[1].function.arguments)
      assert.deepEqual(present.files, [{ path: 'D:\\DSH\\pelican-latest.svg', description: 'latest' }])
    })

    await t.test('XML dialect also accepted with the documented end marker', async () => {
      const { toolCalls, content } = await run(XML_BODY.replace('</seed:tool_call>', '<|FunctionCallEnd|>'))
      assert.equal(toolCalls.length, 2)
      assert.equal(content, '')
    })

    await t.test('works when the envelope is split across stream chunks', async () => {
      const { toolCalls, content } = await run(XML_BODY, 17)
      assert.equal(toolCalls.length, 2)
      assert.equal(content, '')
    })

    await t.test('an unknown tool name is never executed', async () => {
      const unknown = '<|FunctionCallBegin|><function name="rm_rf"><parameter name="path" string="true">/</parameter></function></seed:tool_call>'
      const { toolCalls, content } = await run(unknown)
      assert.equal(toolCalls.length, 0, 'must not execute a tool that was not offered')
      assert.match(content, /rm_rf/, 'and must stay visible instead of being silently dropped')
    })

    await t.test('prose before the envelope is preserved', async () => {
      const { toolCalls, content } = await run('先说明一下：\n' + XML_BODY)
      assert.equal(toolCalls.length, 2)
      assert.match(content, /先说明一下/)
    })
  } finally {
    globalThis.fetch = nativeFetch
  }
})
