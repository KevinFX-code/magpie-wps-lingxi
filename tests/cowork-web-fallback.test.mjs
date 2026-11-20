import { test } from 'node:test'
import assert from 'node:assert/strict'
import { WebSocketServer } from 'ws'
import { WPSLingxiAuthPlugin, _internal } from '../index.mjs'

const SID = 'SID' + 'w'.repeat(29)
const COOKIE = `wps_sid=${SID}`
const sessionPath = '/api/aioffice/v1/cowork/sessions'
const runPath = '/api/public/v1/credits/runs'
const chatPath = '/api/public/v1/agent-runtime/chat/completions'

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

async function exercise({ stream = false, plane = 'auto', tools = false, denyAt = 'chat' } = {}) {
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
  _internal.setCoworkWSFactory((url, options) => {
    const ws = new FakeWebSocket(url, options)
    queueMicrotask(() => {
      ws.open()
      ws.complete('回退成功')
    })
    return ws
  })
  const previousPlane = process.env.MAGPIE_LINGXI_PLANE
  if (plane === 'cowork_web') process.env.MAGPIE_LINGXI_PLANE = 'cowork_web'
  else delete process.env.MAGPIE_LINGXI_PLANE
  try {
    const response = await loader.fetch('https://mock/chat/completions', {
      body: JSON.stringify({
        model: `fallback-${stream}-${plane}-${Math.random()}`,
        stream,
        messages: [
          { role: 'system', content: '保持简洁' },
          { role: 'user', content: '请确认可用' },
        ],
        ...(tools ? { tools: [{ type: 'function', function: { name: 'exec', parameters: { type: 'object' } } }] } : {}),
      }),
    })
    const text = await response.text()
    return { response, text, calls, sockets: FakeWebSocket.instances }
  } finally {
    globalThis.fetch = originalFetch
    _internal.setCoworkWSFactory(null)
    if (previousPlane === undefined) delete process.env.MAGPIE_LINGXI_PLANE
    else process.env.MAGPIE_LINGXI_PLANE = previousPlane
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

test('tool requests fall back to cowork_web with tools serialized as text', async () => {
  const { response, text, calls, sockets } = await exercise({ tools: true })
  assert.equal(response.status, 200)
  assert.equal(calls.filter((call) => call.path === chatPath).length, 1)
  assert.equal(sockets.length, 1)
  // tools 定义应注入 prompt
  assert.match(sockets[0].sent[0].data.agent_input.text, /工具名：exec/)
  assert.match(sockets[0].sent[0].data.agent_input.text, /tool_call/)
})

test('PermissionDenied while creating agent session also falls back without a login hint', async () => {
  const { response, text, calls, sockets } = await exercise({ denyAt: 'session' })
  assert.equal(response.status, 200, text)
  assert.equal(calls.filter((call) => call.path === sessionPath).length, 2)
  assert.equal(calls.filter((call) => call.path === runPath).length, 0)
  assert.equal(calls.filter((call) => call.path === chatPath).length, 0)
  assert.equal(sockets.length, 1)
})

test('forced cowork_web mode accepts tools and refuses only multimodal content', async () => {
  const tools = await exercise({ plane: 'cowork_web', tools: true })
  assert.equal(tools.response.status, 200)
  assert.equal(tools.sockets.length, 1)
  assert.match(tools.sockets[0].sent[0].data.agent_input.text, /工具名：exec/)
  assert.match(_internal.coworkWebUnsupportedReason({ messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,AA==' } }] }] }), /纯文本/)
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
    // deny 请求带 tools，PermissionDenied 后走 cowork_web（WebSocket mock 未设置，返回 502）
    assert.equal((await request('thread-b', 'deny')).status, 502)
    assert.equal((await request('thread-a', 'second')).status, 200)
    assert.equal(calls.filter((call) => call.path === sessionPath).length, 3)
    assert.equal(calls.filter((call) => call.path === runPath).length, 2)
    assert.equal(calls.filter((call) => call.path === chatPath).length, 3)
  } finally {
    globalThis.fetch = originalFetch
  }
})
