import { test } from 'node:test'
import assert from 'node:assert/strict'
import { WebSocketServer } from 'ws'
import { WPSLingxiAuthPlugin, _internal } from '../index.mjs'

const SID = 'SID' + 'w'.repeat(29)
const COOKIE = `wps_sid=${SID}`
const sessionPath = '/api/aioffice/v1/cowork/sessions'
const runPath = '/api/public/v1/credits/runs'
const chatPath = '/api/public/v1/agent-runtime/chat/completions'
const TOOL_CALL_OPEN = '<tool_call>'
const TOOL_CALL_CLOSE = '</tool_call>'
const TIME_TOOL = {
  type: 'function',
  function: {
    name: 'get_time',
    parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
  },
}
const EXEC_TOOL = {
  type: 'function',
  function: {
    name: 'exec',
    parameters: {
      type: 'object',
      properties: { cmd: { type: 'string' } },
      required: ['cmd'],
      additionalProperties: false,
    },
  },
}

class FakeWebSocket {
  static instances = []
  constructor(url, options) {
    this.url = url
    this.options = options
    this.sent = []
    FakeWebSocket.instances.push(this)
  }
  emit(name, event) { this[`on${name}`]?.(event) }
  open() { this.emit('open') }
  message(frame) { this.emit('message', { data: JSON.stringify(frame) }) }
  complete(text) {
    this.message({ event: 'component.content', data: { type: 'c_text', delta: text } })
    this.message({ event: 'component.end', data: { type: 'c_token_usage', full_content: { usage: { input_tokens: 7, output_tokens: 3 } } } })
    this.message({ event: 'run.end' })
    this.emit('close', { code: 1000 })
  }
  send(data) { this.sent.push(JSON.parse(data)) }
  close() {}
}

async function exercise({ stream = false, plane = 'auto', tools = false, denyAt = 'chat', responseTexts = [], messages, toolChoice, experimentalTools = false, closeEarly = false } = {}) {
  const plugin = await WPSLingxiAuthPlugin()
  const loader = await plugin.auth.loader(async () => ({ cookie: COOKIE }))
  const originalFetch = globalThis.fetch
  const calls = []
  let sessionNo = 0
  let runNo = 0
  globalThis.fetch = async (url, init = {}) => {
    const path = new URL(url).pathname
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined
    calls.push({ path, body })
    if (path === sessionPath) {
      if (denyAt === 'session' && body.session_type !== 'cowork_web') return Response.json({ code: 'PermissionDenied', message: '无权限' }, { status: 403 })
      return Response.json({ code: 'Success', data: { session_id: `s-web-${++sessionNo}` } })
    }
    if (path === runPath) {
      if (denyAt === 'run') return Response.json({ code: 'PermissionDenied', message: '无权限' }, { status: 403 })
      return Response.json({ code: 'Success', data: { run_id: `r-${++runNo}` } })
    }
    if (path === chatPath) {
      if (denyAt === 'chat') return Response.json({ code: 'PermissionDenied', message: '无权限' }, { status: 403 })
      return new Response(`data: ${JSON.stringify({ code: 'Success', choices: [{ text: 'ok', finish_reason: 'stop' }] })}\n\n`, { headers: { 'content-type': 'text/event-stream' } })
    }
    throw new Error(`unexpected upstream call: ${url}`)
  }
  FakeWebSocket.instances = []
  const replies = [...responseTexts]
  _internal.setCoworkWSFactory((url, options) => {
    const ws = new FakeWebSocket(url, options)
    queueMicrotask(() => {
      ws.open()
      if (closeEarly) ws.emit('close', { code: 1006 })
      else ws.complete(replies.shift() ?? '回退成功')
    })
    return ws
  })
  const previousPlane = process.env.MAGPIE_LINGXI_PLANE
  const previousExperimentalTools = process.env.MAGPIE_LINGXI_EXPERIMENTAL_TOOL_CALLS
  if (plane === 'cowork_web') process.env.MAGPIE_LINGXI_PLANE = 'cowork_web'
  else delete process.env.MAGPIE_LINGXI_PLANE
  if (experimentalTools) process.env.MAGPIE_LINGXI_EXPERIMENTAL_TOOL_CALLS = '1'
  else delete process.env.MAGPIE_LINGXI_EXPERIMENTAL_TOOL_CALLS
  try {
    const response = await loader.fetch('https://mock/chat/completions', {
      body: JSON.stringify({
        model: `fallback-${stream}-${plane}-${Math.random()}`,
        stream,
        messages: messages ?? [
          { role: 'system', content: '保持简洁' },
          { role: 'user', content: '请确认可用' },
        ],
        ...(tools === true ? { tools: [EXEC_TOOL] } : Array.isArray(tools) ? { tools } : {}),
        ...(toolChoice === undefined ? {} : { tool_choice: toolChoice }),
      }),
    })
    const text = await response.text()
    return { response, text, calls, sockets: FakeWebSocket.instances }
  } finally {
    globalThis.fetch = originalFetch
    _internal.setCoworkWSFactory(null)
    if (previousPlane === undefined) delete process.env.MAGPIE_LINGXI_PLANE
    else process.env.MAGPIE_LINGXI_PLANE = previousPlane
    if (previousExperimentalTools === undefined) delete process.env.MAGPIE_LINGXI_EXPERIMENTAL_TOOL_CALLS
    else process.env.MAGPIE_LINGXI_EXPERIMENTAL_TOOL_CALLS = previousExperimentalTools
  }
}

for (const stream of [false, true]) {
  test(`explicit PermissionDenied uses text-only cowork_web fallback, stream=${stream}`, async () => {
    const { response, text, calls, sockets } = await exercise({ stream })
    assert.equal(response.status, 200)
    assert.match(text, /回退成功/)
    assert.equal(calls.filter((call) => call.path === chatPath).length, 1)
    assert.equal(calls.filter((call) => call.path === runPath).length, 1)
    assert.equal(sockets.length, 1)
    assert.match(sockets[0].url, /\/api\/aioffice\/v1\/cowork\/sessions\/s-web-2\/sandbox\/completions\/ws$/)
    assert.match(sockets[0].options.headers.Cookie, /^wps_sid=SIDw{29}; x-kso-app-name=/)
    assert.equal(sockets[0].sent[0].event, 'user.input')
    assert.match(sockets[0].sent[0].data.agent_input.text, /system: 保持简洁/)
    assert.match(sockets[0].sent[0].data.agent_input.text, /user: 请确认可用/)
    if (stream) assert.match(text, /data: \[DONE\]/)
    else assert.equal(JSON.parse(text).choices[0].message.content, '回退成功')
  })
}

for (const stream of [false, true]) {
  test(`cowork_web early WebSocket close is an error, stream=${stream}`, async () => {
    const { response, text } = await exercise({ stream, closeEarly: true })
    if (stream) {
      assert.equal(response.status, 200)
      assert.match(text, /"code":"upstream_error"/)
      assert.doesNotMatch(text, /data: \[DONE\]/)
    } else {
      assert.equal(response.status, 502)
      assert.equal(JSON.parse(text).error.code, 'upstream_error')
    }
  })
}

test('tool requests retain PermissionDenied by default without starting a text-only fallback', async () => {
  const { response, text, calls, sockets } = await exercise({ tools: true })
  assert.equal(response.status, 403)
  assert.equal(JSON.parse(text).error.code, 'PermissionDenied')
  assert.equal(calls.filter((call) => call.path === sessionPath).length, 1)
  assert.equal(calls.filter((call) => call.path === runPath).length, 1)
  assert.equal(calls.filter((call) => call.path === chatPath).length, 1)
  assert.equal(sockets.length, 0)
})

test('tool history retains PermissionDenied by default even when tools are not repeated', async () => {
  const { response, text, calls, sockets } = await exercise({
    messages: [
      { role: 'assistant', content: null, tool_calls: [{ id: 'call-old', type: 'function', function: { name: 'exec', arguments: '{}' } }] },
      { role: 'tool', tool_call_id: 'call-old', name: 'exec', content: 'done' },
      { role: 'user', content: 'continue' },
    ],
  })
  assert.equal(response.status, 403)
  assert.equal(JSON.parse(text).error.code, 'PermissionDenied')
  assert.equal(calls.filter((call) => call.path === sessionPath).length, 1)
  assert.equal(sockets.length, 0)
})

test('experimental tool mode parses a declared tool call from cowork_web text', async () => {
  const marker = `${TOOL_CALL_OPEN}${JSON.stringify({ name: 'exec', arguments: { cmd: 'echo ok' } })}${TOOL_CALL_CLOSE}`
  const { response, text, calls, sockets } = await exercise({ tools: [EXEC_TOOL], experimentalTools: true, responseTexts: [marker] })
  assert.equal(response.status, 200)
  assert.equal(calls.filter((call) => call.path === chatPath).length, 1)
  assert.equal(sockets.length, 1)
  assert.match(sockets[0].sent[0].data.agent_input.text, /工具名：exec/)
  assert.match(sockets[0].sent[0].data.agent_input.text, /tool_call/)
  const body = JSON.parse(text)
  assert.equal(body.choices[0].finish_reason, 'tool_calls')
  assert.equal(body.choices[0].message.tool_calls[0].function.name, 'exec')
  assert.deepEqual(JSON.parse(body.choices[0].message.tool_calls[0].function.arguments), { cmd: 'echo ok' })
})

test('PermissionDenied while creating agent session also falls back without a login hint', async () => {
  const { response, text, calls, sockets } = await exercise({ denyAt: 'session' })
  assert.equal(response.status, 200, text)
  assert.equal(calls.filter((call) => call.path === sessionPath).length, 2)
  assert.equal(calls.filter((call) => call.path === runPath).length, 0)
  assert.equal(calls.filter((call) => call.path === chatPath).length, 0)
  assert.equal(sockets.length, 1)
})

test('forced cowork_web mode refuses tool calls unless experimental mode is enabled', async () => {
  const tools = await exercise({ plane: 'cowork_web', tools: true })
  assert.equal(tools.response.status, 400)
  assert.equal(JSON.parse(tools.text).error.code, 'unsupported_request')
  assert.equal(tools.sockets.length, 0)
  assert.match(_internal.coworkWebUnsupportedReason({ messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,AA==' } }] }] }), /纯文本/)
})

test('tool-call parser accepts only declared tools with schema-valid object arguments', () => {
  const validMarker = `${TOOL_CALL_OPEN}${JSON.stringify({ name: 'exec', arguments: { cmd: 'echo ok' } })}${TOOL_CALL_CLOSE}`
  const parsed = _internal.parseToolCalls(`before ${validMarker} after`, [EXEC_TOOL])
  assert.equal(parsed.calls.length, 1)
  assert.equal(parsed.calls[0].function.name, 'exec')
  assert.deepEqual(JSON.parse(parsed.calls[0].function.arguments), { cmd: 'echo ok' })
  assert.match(parsed.text, /before/)
  assert.match(parsed.text, /after/)
  assert.doesNotMatch(parsed.text, /<tool_call>/)

  const invalidMarkers = [
    `${TOOL_CALL_OPEN}${JSON.stringify({ name: 'unlisted_tool', arguments: { cmd: 'echo ok' } })}${TOOL_CALL_CLOSE}`,
    `${TOOL_CALL_OPEN}${JSON.stringify({ name: 'exec', arguments: {} })}${TOOL_CALL_CLOSE}`,
    `${TOOL_CALL_OPEN}${JSON.stringify({ name: 'exec', arguments: { cmd: 123 } })}${TOOL_CALL_CLOSE}`,
    `${TOOL_CALL_OPEN}${JSON.stringify({ name: 'exec', arguments: { cmd: 'echo ok', extra: true } })}${TOOL_CALL_CLOSE}`,
    `${TOOL_CALL_OPEN}{"name":"exec","arguments":"not-json"}${TOOL_CALL_CLOSE}`,
    `${TOOL_CALL_OPEN}{broken json${TOOL_CALL_CLOSE}`,
  ]
  for (const marker of invalidMarkers) {
    const rejected = _internal.parseToolCalls(marker, [EXEC_TOOL])
    assert.deepEqual(rejected.calls, [], marker)
    assert.equal(rejected.text, marker, 'rejected markers remain ordinary assistant text')
  }
})

test('tool_choice none prevents text markers from becoming executable tool calls', async () => {
  const marker = `${TOOL_CALL_OPEN}${JSON.stringify({ name: 'exec', arguments: { cmd: 'echo ok' } })}${TOOL_CALL_CLOSE}`
  const { response, text } = await exercise({ tools: [EXEC_TOOL], toolChoice: 'none', responseTexts: [marker] })
  assert.equal(response.status, 200)
  const body = JSON.parse(text)
  assert.equal(body.choices[0].finish_reason, 'stop')
  assert.equal(body.choices[0].message.tool_calls, undefined)
  assert.equal(body.choices[0].message.content, marker)
})

test('tool_choice required fails clearly when cowork_web returns no valid tool call', async () => {
  const { response, text } = await exercise({ tools: [EXEC_TOOL], toolChoice: 'required', experimentalTools: true, responseTexts: ['I cannot call a tool'] })
  assert.equal(response.status, 502)
  assert.equal(JSON.parse(text).error.code, 'tool_call_protocol_error')
})

test('non-stream tool call and result round-trip preserve tool_call_id and output', async () => {
  const marker = `${TOOL_CALL_OPEN}${JSON.stringify({ name: 'get_time', arguments: {} })}${TOOL_CALL_CLOSE}`
  const first = await exercise({ tools: [TIME_TOOL], experimentalTools: true, responseTexts: [marker] })
  assert.equal(first.response.status, 200)
  const firstBody = JSON.parse(first.text)
  assert.equal(firstBody.choices[0].finish_reason, 'tool_calls')
  const call = firstBody.choices[0].message.tool_calls[0]
  assert.equal(call.function.name, 'get_time')
  assert.deepEqual(JSON.parse(call.function.arguments), {})

  const result = JSON.stringify({ timestamp: '2026-11-21T10:00:00Z', nonce: 'after-call-7f3a' })
  const second = await exercise({
    tools: [TIME_TOOL],
    experimentalTools: true,
    responseTexts: ['The time is 2026-11-21T10:00:00Z and nonce is after-call-7f3a.'],
    messages: [
      { role: 'user', content: '请调用 get_time 并报告结果' },
      { role: 'assistant', content: null, tool_calls: [call] },
      { role: 'tool', tool_call_id: call.id, name: 'get_time', content: result },
    ],
  })
  assert.equal(second.response.status, 200)
  assert.match(second.text, /after-call-7f3a/)
  const prompt = second.sockets[0].sent[0].data.agent_input.text
  assert.match(prompt, new RegExp(call.id))
  assert.match(prompt, /"name":"get_time"/)
  assert.match(prompt, /"tool_call_id":"[^"]+"/)
  assert.match(prompt, /2026-11-21T10:00:00Z/)
  assert.match(prompt, /after-call-7f3a/)
})

test('streaming tool calls withhold protocol tags and emit clean content plus tool_calls', async () => {
  const marker = `${TOOL_CALL_OPEN}${JSON.stringify({ name: 'exec', arguments: { cmd: 'echo ok' } })}${TOOL_CALL_CLOSE}`
  const { response, text } = await exercise({
    stream: true,
    tools: [EXEC_TOOL],
    experimentalTools: true,
    responseTexts: [`Preparing the call. ${marker}`],
  })
  assert.equal(response.status, 200)
  assert.doesNotMatch(text, /<tool_call>/)
  assert.match(text, /Preparing the call\./)
  const events = text.split(/\r?\n/)
    .filter((line) => line.startsWith('data: ') && line !== 'data: [DONE]')
    .map((line) => JSON.parse(line.slice(6)))
  const toolDelta = events.flatMap((event) => event.choices ?? [])
    .flatMap((choice) => choice.delta?.tool_calls ?? [])
  assert.equal(toolDelta.length, 1)
  assert.equal(toolDelta[0].function.name, 'exec')
  assert.deepEqual(JSON.parse(toolDelta[0].function.arguments), { cmd: 'echo ok' })
  assert.ok(events.some((event) => event.choices?.[0]?.finish_reason === 'tool_calls'))
  assert.match(text, /data: \[DONE\]/)
})

test('tool result protocol retains the matching call ID for multiple tool outputs', async () => {
  const messages = [
    { role: 'assistant', content: null, tool_calls: [
      { id: 'call-a', type: 'function', function: { name: 'get_time', arguments: '{}' } },
      { id: 'call-b', type: 'function', function: { name: 'get_time', arguments: '{}' } },
    ] },
    { role: 'tool', tool_call_id: 'call-a', name: 'get_time', content: 'result A' },
    { role: 'tool', tool_call_id: 'call-b', name: 'get_time', content: 'result B' },
  ]
  const { response, sockets } = await exercise({ tools: [TIME_TOOL], experimentalTools: true, messages })
  assert.equal(response.status, 200)
  const prompt = sockets[0].sent[0].data.agent_input.text
  assert.match(prompt, /"tool_call_id":"call-a","name":"get_time","content":"result A"/)
  assert.match(prompt, /"tool_call_id":"call-b","name":"get_time","content":"result B"/)
})

test('production WebSocket client sends the WPS Cookie header', async () => {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 })
  await new Promise((resolve, reject) => {
    server.once('listening', resolve)
    server.once('error', reject)
  })
  let cookie = ''
  server.on('connection', (socket, request) => {
    cookie = request.headers.cookie || ''
    socket.send('connected')
  })
  const port = server.address().port
  const client = _internal.openCoworkSocket(`ws://127.0.0.1:${port}/test`, {
    headers: { Cookie: 'wps_sid=test-cookie', Origin: 'https://lingxi.wps.cn' },
  })
  try {
    const message = await new Promise((resolve, reject) => {
      client.once('message', (data) => resolve(data.toString()))
      client.once('error', reject)
    })
    assert.equal(message, 'connected')
    assert.equal(cookie, 'wps_sid=test-cookie')
  } finally {
    client.close()
    await new Promise((resolve) => server.close(resolve))
  }
})

test('PermissionDenied in one thread does not invalidate another thread run', async () => {
  const plugin = await WPSLingxiAuthPlugin()
  const loader = await plugin.auth.loader(async () => ({ cookie: COOKIE }))
  const originalFetch = globalThis.fetch
  const calls = []
  let sequence = 0
  globalThis.fetch = async (url, init = {}) => {
    const path = new URL(url).pathname
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined
    calls.push({ path, body, session: init.headers?.['x-cc-session-id'] })
    if (path === sessionPath) return Response.json({ code: 'Success', data: { session_id: `s-${++sequence}` } })
    if (path === runPath) return Response.json({ code: 'Success', data: { run_id: `r-${sequence}` } })
    if (path === chatPath && body.messages?.[0]?.content === 'deny') {
      return Response.json({ code: 'PermissionDenied', message: '无权限' }, { status: 403 })
    }
    if (path === chatPath) return new Response(`data: ${JSON.stringify({ code: 'Success', choices: [{ text: 'ok', finish_reason: 'stop' }] })}\n\n`, {
      headers: { 'content-type': 'text/event-stream' },
    })
    throw new Error(`unexpected upstream call: ${url}`)
  }
  try {
    const request = async (thread, text) => loader.fetch('https://mock/chat/completions', {
      body: JSON.stringify({
        model: 'isolation-test', stream: false, client_metadata: { thread_id: thread },
        messages: [{ role: 'user', content: text }],
        ...(text === 'deny' ? { tools: [{ type: 'function', function: { name: 'exec', parameters: { type: 'object' } } }] } : {}),
      }),
    })
    assert.equal((await request('thread-a', 'first')).status, 200)
    // deny 请求带 tools；默认保留 403，不创建 cowork_web 会话
    assert.equal((await request('thread-b', 'deny')).status, 403)
    assert.equal((await request('thread-a', 'second')).status, 200)
    assert.equal(calls.filter((call) => call.path === sessionPath).length, 2)
    assert.equal(calls.filter((call) => call.path === runPath).length, 2)
    assert.equal(calls.filter((call) => call.path === chatPath).length, 3)
  } finally {
    globalThis.fetch = originalFetch
  }
})
