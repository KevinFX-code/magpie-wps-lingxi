// PermissionDenied 时从 agent-runtime 回退到 cowork_web WebSocket 的回归测试。
// 网络与 WebSocket 全部打桩，不碰真账号、不消耗智点。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { WPSLingxiAuthPlugin, _internal } from '../index.mjs'

const SID = 'SID' + 'a'.repeat(29)
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
    this.readyState = 0
    FakeWebSocket.instances.push(this)
  }
  emit(event, data) { this[`on${event}`]?.(data) }
  open() { this.readyState = 1; this.emit('open') }
  message(frame) { this.emit('message', { data: JSON.stringify(frame) }) }
  complete(text) {
    this.message({ event: 'run.start', data: { group_id: 'g1' } })
    this.message({ event: 'component.content', data: { type: 'c_text', delta: text } })
    this.message({ event: 'component.end', data: { type: 'c_token_usage', full_content: { usage: { input_tokens: 7, output_tokens: 3 } } } })
    this.message({ event: 'run.end', data: { group_id: 'g1' } })
    this.emit('close', { code: 1000, reason: '' })
  }
  send(data) { this.sent.push(JSON.parse(data)) }
  close() { this.readyState = 3 }
}

async function exercise({ stream = false, plane = 'auto' } = {}) {
  const plugin = await WPSLingxiAuthPlugin()
  const loader = await plugin.auth.loader(async () => ({ cookie: COOKIE }))
  const originalFetch = globalThis.fetch
  const calls = []
  globalThis.fetch = async (url, init = {}) => {
    const path = new URL(url).pathname
    calls.push({ path, body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined })
    if (path === sessionPath) return Response.json({ code: 'Success', data: { session_id: 's-web' } })
    if (path === runPath) return Response.json({ code: 'Success', data: { run_id: 'r1' } })
    if (path === chatPath) return Response.json({ code: 'PermissionDenied', message: '无权限' }, { status: 403 })
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
  test(`PermissionDenied falls back to cowork_web, stream=${stream}`, async () => {
    const { response, text, calls, sockets } = await exercise({ stream })
    assert.equal(response.status, 200)
    assert.match(text, /回退成功/)
    assert.equal(calls.filter((c) => c.path === chatPath).length, 1)
    assert.equal(calls.filter((c) => c.path === runPath).length, 1, 'agent-runtime 探测仍会先创建一次 run')
    assert.equal(sockets.length, 1)
    assert.match(sockets[0].url, /\/api\/aioffice\/v1\/cowork\/sessions\/s-web\/sandbox\/completions\/ws$/)
    assert.equal(sockets[0].sent[0].event, 'user.input')
    assert.equal(sockets[0].sent[0].data.agent_input.expect_model.startsWith('fallback-'), true)
    assert.match(sockets[0].sent[0].data.agent_input.text, /system: 保持简洁/)
    assert.match(sockets[0].sent[0].data.agent_input.text, /user: 请确认可用/)
    if (stream) assert.match(text, /data: \[DONE\]/)
    else assert.equal(JSON.parse(text).choices[0].message.content, '回退成功')
  })
}

test('MAGPIE_LINGXI_PLANE=cowork_web skips agent-runtime entirely', async () => {
  const { response, text, calls, sockets } = await exercise({ plane: 'cowork_web' })
  assert.equal(response.status, 200)
  assert.match(text, /回退成功/)
  assert.equal(calls.filter((c) => c.path === chatPath).length, 0)
  assert.equal(calls.filter((c) => c.path === runPath).length, 0)
  assert.equal(sockets.length, 1)
})

test('webPromptFromMessages joins roles and keeps tool_calls visible', () => {
  const text = _internal.webPromptFromMessages([
    { role: 'system', content: 'S' },
    { role: 'assistant', content: '', tool_calls: [{ id: '1', function: { name: 'x', arguments: '{}' } }] },
    { role: 'tool', content: 'R' },
    { role: 'user', content: [{ type: 'text', text: 'U' }] },
  ])
  assert.match(text, /system: S/)
  assert.match(text, /assistant: \[tool_calls=/)
  assert.match(text, /tool: R/)
  assert.match(text, /user: U/)
})

test('isAgentPlaneDenied only matches the exact upstream gate', () => {
  assert.equal(_internal.isAgentPlaneDenied({ status: 403, message: 'HTTP 403: {"code":"PermissionDenied","message":"无权限"}' }), true)
  assert.equal(_internal.isAgentPlaneDenied({ status: 403, message: 'forbidden' }), false)
  assert.equal(_internal.isAgentPlaneDenied({ status: 404, message: 'PermissionDenied 无权限' }), false)
})
