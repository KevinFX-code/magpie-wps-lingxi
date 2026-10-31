// agent-runtime 平面与登录归一的单测（网络全部打桩，不碰真上游）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { WPSLingxiAuthPlugin, _internal } from '../index.mjs'
const _internalForTests = () => _internal

const SID = 'SID' + 'a'.repeat(29)
const COOKIE = `wps_sid=${SID}`

function parseBody(init) {
  if (typeof init?.body !== 'string') return undefined
  try { return JSON.parse(init.body) } catch { return undefined }
}

function installFetch(handler) {
  const calls = []
  const original = globalThis.fetch
  globalThis.fetch = async (url, init = {}) => {
    const call = { url: String(url), method: init.method || 'GET', headers: init.headers || {}, body: parseBody(init) }
    calls.push(call)
    return handler(call)
  }
  return { calls, restore() { globalThis.fetch = original } }
}

const sse = (frames) => new Response(
  frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join(''),
  { headers: { 'content-type': 'text/event-stream' } },
)

function agentRoutes(chat) {
  return (call) => {
    if (call.url.endsWith('/api/aioffice/v1/cowork/sessions')) {
      return Response.json({ code: 'Success', data: { session_id: 's1' } })
    }
    if (call.url.endsWith('/api/public/v1/credits/runs')) {
      return Response.json({ code: 'Success', data: { run_id: 'r1' } })
    }
    if (call.url.endsWith('/api/public/v1/agent-runtime/chat/completions')) return chat(call)
    return new Response('not found', { status: 404 })
  }
}

test('credentials keep wps_sid and uid, from a bare value or a whole cookie', async () => {
  const plugin = await WPSLingxiAuthPlugin()
  const oauth = plugin.auth.methods.find((method) => method.type === 'oauth')
  const importMethod = plugin.auth.methods.find((method) => /导入/.test(method.label))
  assert.ok(oauth, 'a browser-login method must exist')
  assert.ok(importMethod, 'a local-client import method must exist')
  // 浏览器登录自己开页，magpie 不要再开一次
  assert.equal(typeof oauth.authorize, 'function')

  const { normalizeCredential } = _internalForTests()
  const whole = normalizeCredential(`kso_sid=x; wps_sid=${SID}; uid=42`)
  assert.equal(whole.sid, SID)
  assert.equal(whole.uid, '42')
  assert.equal(whole.cookie, `${COOKIE}; uid=42`)
  assert.equal(whole.tail, SID.slice(-4))
  assert.equal(whole.accountId, 'wps-42')

  assert.ok(normalizeCredential('short').error)
  assert.ok(normalizeCredential('a=b; c=d').error)
  assert.ok(normalizeCredential('').error)
})

test('a non-wps_sid token never reaches upstream', async () => {
  const plugin = await WPSLingxiAuthPlugin()
  const loader = await plugin.auth.loader(async () => ({ access: 'wpsua=V1something' }))
  const net = installFetch(() => { throw new Error('network should not run') })
  try {
    const res = await loader.fetch('https://mock', {
      body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }),
    })
    assert.equal(res.status, 401)
    assert.equal(net.calls.length, 0)
  } finally {
    net.restore()
  }
})

test('tools go through agent-runtime and come back as chat SSE', async () => {
  const plugin = await WPSLingxiAuthPlugin()
  const loader = await plugin.auth.loader(async () => ({ cookie: COOKIE }))
  const net = installFetch(agentRoutes(() => sse([
    { code: 'Success', usage: { total_tokens: 0 }, choices: [{ index: 0, text: '', reasoning_content: '想', finish_reason: '' }] },
    { code: 'Success', usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 }, choices: [{ index: 0, text: '答', reasoning_content: '', finish_reason: 'stop' }] },
  ])))
  try {
    const res = await loader.fetch('https://mock', {
      body: JSON.stringify({
        model: 'wps-lingxi/GLM-5.3',
        stream: true,
        messages: [{ role: 'user', content: 'hi' }],
        tools: [
          { type: 'function', function: { name: 'get_weather', parameters: {} } },
          { type: 'web_search' },
        ],
        tool_choice: 'auto',
        max_tokens: 512,
        reasoning_effort: 'high',
      }),
    })
    const text = await res.text()
    assert.equal(res.status, 200)
    assert.match(text, /"role":"assistant"/)
    assert.match(text, /"reasoning_content":"想"/)
    assert.match(text, /"content":"答"/)
    assert.match(text, /"finish_reason":"stop"/)
    assert.match(text, /"total_tokens":3/)
    assert.match(text, /data: \[DONE\]/)

    const chat = net.calls.find((call) => call.url.includes('/agent-runtime/chat/completions'))
    assert.ok(chat, 'agent-runtime chat was called')
    assert.equal(chat.headers['x-cc-session-id'], 's1')
    assert.equal(chat.headers['x-cc-run-id'], 'r1')
    assert.equal(chat.body.model, 'GLM-5.3')
    assert.equal(chat.body.stream, true)
    assert.equal(chat.body.messages.length, 1)
    assert.equal(chat.body.tools.length, 1, '只有标准 function 工具能上行')
    assert.equal(chat.body.tool_choice, 'auto')
    assert.deepEqual(chat.body.base_llm_arguments, { max_tokens: 512 })
    assert.deepEqual(chat.body.llm_arguments, { reasoning_effort: 'high' })
    assert.equal(net.calls.filter((call) => call.url.includes('/cowork/sessions')).length, 1)
  } finally {
    net.restore()
  }
})

test('non-stream tool calls are folded with their arguments joined', async () => {
  const plugin = await WPSLingxiAuthPlugin()
  const loader = await plugin.auth.loader(async () => ({ cookie: COOKIE }))
  const net = installFetch(agentRoutes(() => sse([
    { code: 'Success', choices: [{ index: 0, text: '', finish_reason: '', tool_calls: [{ type: 'function', id: 'call_1', index: 0, function: { name: 'get_weather', arguments: '' } }] }] },
    { code: 'Success', choices: [{ index: 0, text: '', finish_reason: 'tool_calls', tool_calls: [{ type: '', id: '', index: 0, function: { name: '', arguments: '{"city":"北京"}' } }] }] },
  ])))
  try {
    const res = await loader.fetch('https://mock', {
      body: JSON.stringify({
        model: 'GLM-5.3',
        stream: false,
        messages: [{ role: 'user', content: 'weather?' }],
        tools: [{ type: 'function', function: { name: 'get_weather' } }],
      }),
    })
    const json = await res.json()
    assert.equal(json.choices[0].finish_reason, 'tool_calls')
    const call = json.choices[0].message.tool_calls[0]
    assert.equal(call.id, 'call_1')
    assert.equal(call.function.name, 'get_weather')
    assert.equal(call.function.arguments, '{"city":"北京"}')
  } finally {
    net.restore()
  }
})

test('a stale run is rebuilt once and retried', async () => {
  const plugin = await WPSLingxiAuthPlugin()
  const loader = await plugin.auth.loader(async () => ({ cookie: COOKIE }))
  let sessions = 0
  let runs = 0
  let chats = 0
  const net = installFetch((call) => {
    if (call.url.endsWith('/api/aioffice/v1/cowork/sessions')) {
      sessions += 1
      return Response.json({ code: 'Success', data: { session_id: `s${sessions}` } })
    }
    if (call.url.endsWith('/api/public/v1/credits/runs')) {
      runs += 1
      return Response.json({ code: 'Success', data: { run_id: `r${runs}` } })
    }
    if (call.url.includes('/agent-runtime/chat/completions')) {
      chats += 1
      if (chats === 1) {
        return new Response(JSON.stringify({ message: '会话不存在' }), { status: 400, headers: { 'content-type': 'application/json' } })
      }
      return sse([{ code: 'Success', choices: [{ index: 0, text: 'ok', finish_reason: 'stop' }] }])
    }
    return new Response('not found', { status: 404 })
  })
  try {
    const res = await loader.fetch('https://mock', {
      body: JSON.stringify({
        model: 'MiniMax-M3',
        messages: [{ role: 'user', content: 'hi' }],
        tools: [{ type: 'function', function: { name: 'get_weather' } }],
      }),
    })
    assert.match(await res.text(), /"content":"ok"/)
    assert.equal(sessions, 2)
    assert.equal(runs, 2)
    assert.equal(chats, 2)
  } finally {
    net.restore()
  }
})

test('checkin claims the daily reward and only claimable one-time tasks', async () => {
  const plugin = await WPSLingxiAuthPlugin()
  let balance = 1000
  const net = installFetch((call) => {
    if (call.url.endsWith('/api/public/v1/tasks')) {
      return Response.json({
        result: 'ok',
        data: {
          tasks: [
            { task_key: 'daily_check_in', type: 'daily', status: 'incomplete', reward_amount: 100, extra: { consecutive_days: 3, check_in_days: [{ status: 'available', date: '2026-10-28' }] } },
            { task_key: 'try_group_chat', type: 'one_time', status: 'claimable', reward_amount: 400 },
            { task_key: 'use_client', type: 'one_time', status: 'incomplete', reward_amount: 800 },
          ],
        },
      })
    }
    if (call.url.includes('/api/public/v1/credits/balance')) {
      return Response.json({ data: { total_balance: balance } })
    }
    if (call.url.includes('/tasks/daily_check_in/claim')) {
      balance += 100
      return Response.json({ result: 'ok', data: { extra: { today_reward: 100 } } })
    }
    if (call.url.includes('/tasks/try_group_chat/claim')) {
      balance += 400
      return Response.json({ result: 'ok', data: { reward_amount: 400 } })
    }
    return new Response('not found', { status: 404 })
  })
  try {
    const result = await plugin.auth.checkin(async () => ({ cookie: COOKIE }))
    assert.equal(result.outcome, 'claimed')
    assert.equal(result.credit, 500)
    assert.equal(result.streak, 4)
    const claims = net.calls.filter((call) => call.url.includes('/claim'))
    assert.equal(claims.length, 2)
    assert.ok(claims.some((call) => call.url.includes('date=2026-10-28')))
    assert.ok(!net.calls.some((call) => call.url.includes('use_client')), 'incomplete 的任务不该去领')
  } finally {
    net.restore()
  }
})

test('checkin marks an expired cookie for re-login', async () => {
  const plugin = await WPSLingxiAuthPlugin()
  const net = installFetch(() => new Response('{}', { status: 401 }))
  try {
    const result = await plugin.auth.checkin(async () => ({ cookie: COOKIE }))
    assert.equal(result.outcome, 'failed')
    assert.equal(result.signIn, 'expired')
  } finally {
    net.restore()
  }
})

test('a group_chat one-time task is completed by creating and deleting a channel', async () => {
  const plugin = await WPSLingxiAuthPlugin()
  class FakeWS {
    constructor(url) { FakeWS.last = this; this.url = url; this.sent = [] }
    send(data) { this.sent.push(String(data)); queueMicrotask(() => this.onmessage?.({ data: JSON.stringify({ event: 'run.end' }) })) }
    close() {}
    set onopen(fn) { queueMicrotask(() => fn?.()) }
    set onerror(fn) {}
    set onmessage(fn) { this._m = fn }
    get onmessage() { return this._m }
  }
  _internal.setGroupWSFactory((url, opts) => new FakeWS(url, opts))
  let phase = 0
  const net = installFetch((call) => {
    if (call.url.endsWith('/api/public/v1/tasks')) {
      const daily = { task_key: 'daily_check_in', type: 'daily', status: 'claimed', reward_amount: 100, extra: { consecutive_days: 2 } }
      const group = phase === 0
        ? { task_key: 'try_group_chat', type: 'one_time', status: 'incomplete', action: 'group_chat', reward_amount: 400 }
        : { task_key: 'try_group_chat', type: 'one_time', status: 'claimable', action: 'group_chat', reward_amount: 400 }
      const tasks = [daily, group]
      return Response.json({ result: 'ok', data: { tasks } })
    }
    if (call.url.includes('/api/public/v1/credits/balance')) return Response.json({ data: { total_balance: 500 } })
    if (call.url.includes('/api/public/v1/session_list')) {
      return Response.json({ result: 'ok', data: { list: [{ session_id: 'done-1', status: 'finished' }, { session_id: 'running-1', status: 'running' }] } })
    }
    if (call.url.endsWith('/api/aioffice/v1/cowork/sessions')) {
      return Response.json({ data: { session_id: 'gw1' } })
    }
    if (call.url.endsWith('/api/public/v1/sessions/done-1')) {
      return Response.json({ data: { execution_status: 'completed' } })
    }
    if (call.url.endsWith('/api/public/v1/sessions/running-1')) {
      return Response.json({ data: { execution_status: 'running' } })
    }
    if (call.url.endsWith('/api/imchat/v1/channels') && call.method === 'POST') {
      assert.equal(call.body.session_id, 'gw1')
      return Response.json({ code: 'Success', data: { channel_id: 'ch-1' } })
    }
    if (call.url.endsWith('/api/imchat/v1/channels/ch-1') && call.method === 'DELETE') {
      phase = 1
      return Response.json({ code: 'Success', data: {} })
    }
    if (call.url.includes('/tasks/try_group_chat/claim')) {
      return Response.json({ result: 'ok', data: { reward_amount: 400 } })
    }
    return new Response('not found', { status: 404 })
  })
  try {
    const result = await plugin.auth.checkin(async () => ({ cookie: COOKIE }))
    assert.equal(result.outcome, 'claimed')
    assert.equal(result.credit, 400)
    assert.ok(net.calls.some((c) => c.url.endsWith('/api/imchat/v1/channels') && c.method === 'POST'))
    assert.ok(net.calls.some((c) => c.url.endsWith('/api/imchat/v1/channels/ch-1') && c.method === 'DELETE'))
    assert.ok(net.calls.some((c) => c.url.includes('/tasks/try_group_chat/claim')))
    const ws = FakeWS.last
    assert.ok(ws.url.includes('/completions/ws') && ws.url.includes('gw1'), 'WS 要连到会话的 completions/ws')
    assert.ok(ws.sent.some((d) => d.includes('user.input') && d.includes('plan_pro')), 'WS 要发 user.input')
    const gwSession = net.calls.find((c) => c.url.endsWith('/api/aioffice/v1/cowork/sessions') && c.body?.session_type === 'cowork_web')
    assert.ok(gwSession, '群任务要先建 cowork_web 会话')
  } finally {
    net.restore()
  }
})
