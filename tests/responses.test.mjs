import { test } from 'node:test'
import assert from 'node:assert/strict'
import { WPSLingxiAuthPlugin, _internal } from '../index.mjs'

const sessionPath = '/api/aioffice/v1/cowork/sessions'
const runPath = '/api/public/v1/credits/runs'
const chatPath = '/api/public/v1/agent-runtime/chat/completions'
const COOKIE = `wps_sid=SID${'r'.repeat(29)}`
let sequence = 0

function okSse(text = 'ok') {
  return new Response(`data: ${JSON.stringify({ code: 'Success', choices: [{ text, finish_reason: 'stop' }] })}\n\n`, {
    headers: { 'content-type': 'text/event-stream' },
  })
}

async function requestBatch(requests) {
  const plugin = await WPSLingxiAuthPlugin()
  const loader = await plugin.auth.loader(async () => ({ cookie: COOKIE }))
  const originalFetch = globalThis.fetch
  const calls = []
  let sessionNo = 0
  let runNo = 0
  globalThis.fetch = async (url, init = {}) => {
    const path = new URL(url).pathname
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined
    calls.push({ path, body, headers: init.headers })
    if (path === sessionPath) return Response.json({ code: 'Success', data: { session_id: `s-${++sessionNo}` } })
    if (path === runPath) return Response.json({ code: 'Success', data: { run_id: `r-${++runNo}` } })
    if (path === chatPath) return okSse()
    throw new Error(`unexpected upstream call: ${url}`)
  }
  try {
    const responses = []
    for (const body of requests) {
      const response = await loader.fetch('https://mock/v1/responses', { body: JSON.stringify({ stream: false, model: 'deepseek-v4.1-flash', ...body }) })
      responses.push({ status: response.status, body: await response.json() })
    }
    return { responses, calls }
  } finally {
    globalThis.fetch = originalFetch
  }
}

test('Responses input and function tools become agent-runtime chat format', async () => {
  const payload = {
    instructions: 'top-level system instruction',
    input: [
      { type: 'message', id: 'm1', role: 'developer', content: [{ type: 'input_text', text: 'developer note' }] },
      { type: 'message', id: 'm2', role: 'user', content: [{ type: 'input_text', text: 'user question' }] },
      { type: 'function_call', id: 'fc1', call_id: 'call-1', name: 'exec_command', arguments: '{"cmd":"pwd"}' },
      { type: 'function_call_output', call_id: 'call-1', output: 'C:/work' },
    ],
    tools: [{ type: 'function', name: 'exec_command', description: 'run a command', parameters: { type: 'object', properties: { cmd: { type: 'string' } } }, strict: true }],
    tool_choice: { type: 'function', name: 'exec_command' },
    parallel_tool_calls: true,
    reasoning: { effort: 'high', summary: 'detailed' },
    max_output_tokens: 512,
    client_metadata: { thread_id: 'thread-response-shape' },
  }
  const { responses, calls } = await requestBatch([payload])
  assert.equal(responses[0].status, 200)
  const sent = calls.find((call) => call.path === chatPath).body
  assert.deepEqual(sent.messages.slice(0, 3), [
    { role: 'system', content: 'top-level system instruction' },
    { role: 'developer', content: [{ type: 'text', text: 'developer note' }] },
    { role: 'user', content: [{ type: 'text', text: 'user question' }] },
  ])
  assert.deepEqual(sent.messages[3].tool_calls, [{
    id: 'call-1', type: 'function', function: { name: 'exec_command', arguments: '{"cmd":"pwd"}' },
  }])
  assert.deepEqual(sent.messages[4], { role: 'tool', tool_call_id: 'call-1', content: 'C:/work' })
  assert.equal(sent.tools[0].function.name, 'exec_command')
  assert.equal(sent.tools[0].function.strict, true)
  assert.deepEqual(sent.tool_choice, { type: 'function', function: { name: 'exec_command' } })
  assert.equal(sent.parallel_tool_calls, true)
  assert.equal(sent.reasoning_effort, 'high')
  assert.equal(sent.base_llm_arguments.max_tokens, 512)
  assert.equal('input' in sent, false)
  assert.equal('client_metadata' in sent, false)
})

test('Responses string input and input_image are converted without dropping content', () => {
  const text = _internal.normalizeResponsesRequest({ input: 'hello' })
  assert.deepEqual(text.messages, [{ role: 'user', content: 'hello' }])
  const image = _internal.normalizeResponsesRequest({ input: [{
    type: 'message', role: 'user', content: [
      { type: 'input_text', text: 'describe this' },
      { type: 'input_image', image_url: 'data:image/png;base64,AA==', detail: 'low' },
    ],
  }] })
  assert.deepEqual(image.messages[0].content[1], {
    type: 'image_url', image_url: { url: 'data:image/png;base64,AA==', detail: 'low' },
  })
})

test('unknown Responses input and content types fail as 400 before upstream calls', async () => {
  for (const input of [
    [{ type: 'unknown_item' }],
    [{ type: 'message', role: 'user', content: [{ type: 'input_audio', data: '...' }] }],
  ]) {
    let error
    try { _internal.normalizeResponsesRequest({ input }) } catch (caught) { error = caught }
    assert.ok(error)
    assert.equal(error.status, 400)
    assert.equal(error.code, 'invalid_request')
  }
  const { responses, calls } = await requestBatch([{ input: [{ type: 'unknown_item' }] }])
  assert.equal(responses[0].status, 400)
  assert.equal(responses[0].body.error.code, 'invalid_request')
  assert.equal(calls.length, 0)
})

test('chat run cache separates conversation IDs and does not cache requests without one', async () => {
  const threadA = `conversation-${Date.now()}-${++sequence}`
  const threadB = `${threadA}-other`
  const { responses, calls } = await requestBatch([
    { messages: [{ role: 'user', content: 'A turn 1' }], client_metadata: { thread_id: threadA } },
    { messages: [{ role: 'user', content: 'A turn 2' }], client_metadata: { thread_id: threadA } },
    { messages: [{ role: 'user', content: 'B turn 1' }], client_metadata: { thread_id: threadB } },
    { messages: [{ role: 'user', content: 'no ID turn 1' }] },
    { messages: [{ role: 'user', content: 'no ID turn 2' }] },
  ])
  assert.ok(responses.every((response) => response.status === 200))
  assert.equal(calls.filter((call) => call.path === sessionPath).length, 4)
  assert.equal(calls.filter((call) => call.path === runPath).length, 4)
  assert.equal(calls.filter((call) => call.path === chatPath).length, 5)
})

test('only stable thread metadata is used as a cache namespace', () => {
  const a = _internal.chatRunKey(COOKIE, 'm', 'client', '', { client_metadata: { thread_id: 'A' } })
  const b = _internal.chatRunKey(COOKIE, 'm', 'client', '', { client_metadata: { thread_id: 'B' } })
  const none = _internal.chatRunKey(COOKIE, 'm', 'client', '', {})
  assert.equal(a.cache, true)
  assert.equal(b.cache, true)
  assert.notEqual(a.key, b.key)
  assert.equal(none.cache, false)
  assert.doesNotMatch(a.key, /thread:A/)
})
