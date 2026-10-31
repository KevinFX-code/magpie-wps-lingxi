// 专家模式（aigc 平面）/ 使用客户端（cowork + client_type）：
// 纯协议能做的就是带对标志发一次对话，然后重拉任务看服务端是否翻转。
// 这里锁住“标志确实发出去了”与“Cookie 带 x-kso-* 客户端标识”。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { WPSLingxiAuthPlugin, _internal } from '../index.mjs'

const SID = 'SID' + 'a'.repeat(29)
const COOKIE = `wps_sid=${SID}`

function installFetch(handler) {
  const calls = []
  const original = globalThis.fetch
  globalThis.fetch = async (url, init = {}) => {
    let body
    try { body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined } catch {}
    const call = { url: String(url), method: init.method || 'GET', headers: init.headers || {}, body }
    calls.push(call)
    return handler(call)
  }
  return { calls, restore() { globalThis.fetch = original } }
}

test('expert (aigc) and client (cowork) attempts send the right flags; cookies carry x-kso-*', async () => {
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
  let taskReads = 0
  const net = installFetch((call) => {
    if (call.url.endsWith('/api/public/v1/tasks')) {
      taskReads += 1
      const done = taskReads > 1
      return Response.json({
        result: 'ok',
        data: {
          tasks: [
            { task_key: 'daily_check_in', type: 'daily', status: 'claimed', reward_amount: 100, extra: { consecutive_days: 1 } },
            { task_key: 'try_expert_mode', type: 'one_time', status: done ? 'claimable' : 'incomplete', action: 'expert_mode', reward_amount: 200 },
            { task_key: 'try_group_chat', type: 'one_time', status: done ? 'claimable' : 'incomplete', action: 'group_chat', reward_amount: 400 },
            { task_key: 'use_lingxi_client', type: 'one_time', status: done ? 'claimable' : 'incomplete', action: 'download_client', reward_amount: 800 },
          ],
        },
      })
    }
    if (call.url.includes('/api/public/v1/credits/balance')) return Response.json({ data: { total_balance: 500 } })
    if (call.url.endsWith('/api/aioffice/v1/cowork/sessions')) return Response.json({ data: { session_id: 's' + net.calls.filter((c) => c.url.endsWith('/api/aioffice/v1/cowork/sessions')).length } })
    if (call.url.endsWith('/api/public/v1/credits/runs')) return Response.json({ data: { run_id: 'r1', group_id: 'g1' } })
    if (call.url.endsWith('/api/public/v1/agent-runtime/chat/completions')) {
      return new Response('data: {"code":"Success","choices":[{"text":"ok","finish_reason":"stop"}]}\n\n', {
        headers: { 'content-type': 'text/event-stream' },
      })
    }
    if (call.url.endsWith('/api/aigc/v3/assistant/sessions')) {
      return Response.json({ data: { session_id: 'aigc-1' } })
    }
    if (call.url.includes('/api/aigc/v3/assistant/sessions/') && call.url.endsWith('/completions')) {
      return new Response('data: {"type":"text","data":"hi"}\n\ndata: {"type":"end"}\n\n', {
        headers: { 'content-type': 'text/event-stream' },
      })
    }
    if (call.url.endsWith('/api/imchat/v1/channels') && call.method === 'POST') {
      return Response.json({ code: 'Success', data: { channel_id: 'ch-1' } })
    }
    if (call.url.endsWith('/api/imchat/v1/channels/ch-1') && call.method === 'DELETE') {
      return Response.json({ code: 'Success', data: {} })
    }
    if (call.url.includes('/claim')) {
      const rewards = { try_expert_mode: 200, try_group_chat: 400, use_lingxi_client: 800 }
      const key = Object.keys(rewards).find((k) => call.url.includes(k)) || ''
      return Response.json({ result: 'ok', data: { reward_amount: rewards[key] || 0 } })
    }
    return new Response('not found', { status: 404 })
  })
  try {
    const result = await plugin.auth.checkin(async () => ({ cookie: COOKIE }))

    // 一次对话吃两个任务：客户端身份 + 专家模式（session/run 双标志）
    const sessions = net.calls.filter((c) => c.url.endsWith('/api/aioffice/v1/cowork/sessions'))
    assert.equal(sessions.length, 2)
    assert.equal(sessions[0].body.client_type, 'lingxi_claw')
    assert.equal(sessions[0].body.session_mode, 'expert')
    assert.equal(sessions[1].body.session_type, 'cowork_web')
    const runs = net.calls.filter((c) => c.url.endsWith('/api/public/v1/credits/runs'))
    assert.equal(runs.length, 1)
    assert.equal(runs[0].body.client_type, 'lingxi_claw')
    assert.equal(runs[0].body.agent_input.current_mode, 'expert')
    const chats = net.calls.filter((c) => c.url.endsWith('/api/public/v1/agent-runtime/chat/completions'))
    assert.equal(chats.length, 1)
    assert.equal(chats[0].headers['X-Client-Type'], 'lingxi_claw')
    assert.ok(!JSON.stringify(net.calls.map((c) => c.body)).includes('365wps-lingxi-client'), 'Product-Name 不该出现在请求体里')

    // aigc 平面只是兜底：cowork 成功就不该出现
    assert.equal(net.calls.filter((c) => c.url.includes('/api/aigc/v3/')).length, 0)

    // 会话执行状态生命周期：对话前 running、对话后 completed（真实内核抓包）
    const execPuts = net.calls.filter((c) => c.url.endsWith('/execution_status') && c.method === 'PUT')
    assert.equal(execPuts.length, 2)
    assert.equal(execPuts[0].body.status, 'running')
    assert.equal(execPuts[0].body.run_token, 'g1')
    assert.equal(execPuts[1].body.status, 'completed')
    assert.equal(execPuts[1].body.terminal_reason, 'completed')

    // 群聊：cowork_web 会话 + WS user.input + 建群/解散
    const channels = net.calls.filter((c) => c.url.endsWith('/api/imchat/v1/channels') && c.method === 'POST')
    assert.equal(channels.length, 1)
    assert.equal(channels[0].body.session_id, 's2')
    const gwws = FakeWS.last
    assert.ok(gwws.url.includes('/completions/ws') && gwws.url.includes('s2'), 'WS 要连群会话的 completions/ws')
    assert.ok(gwws.sent.some((d) => d.includes('user.input')), 'WS 要发 user.input')
    assert.ok(net.calls.some((c) => c.url.endsWith('/api/imchat/v1/channels/ch-1') && c.method === 'DELETE'))
    assert.ok(!net.calls.some((c) => c.url.includes('/api/public/v1/session_list')), '建群成功就不该去扫历史会话')

    // 所有请求的 Cookie 都带客户端标识
    for (const c of net.calls) {
      const cookie = c.headers.Cookie || ''
      assert.ok(cookie.includes('x-kso-app-name=win-lingxi-desktop'), `missing x-kso cookie: ${c.url}`)
    }

    assert.equal(result.outcome, 'claimed')
    assert.equal(result.credit, 1400)
  } finally {
    net.restore()
  }
})
