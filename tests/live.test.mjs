// 真打 WPS 灵犀上游的集成测试 —— 只验证「插件翻译层」能否被上游接受，
// 不验证回答质量。
//
// 默认跳过：本地没有 WPS_LINGXI_COOKIE 就不跑。CI 里由仓库 secret 提供
// （GitHub Actions 的 secret 不会出现在日志里，也不给 fork PR）。
//
// 为什么需要它：单元测试全打桩，桩永远比真上游宽容。历史上「工具 schema 被
// 上游拒」这类问题（AIError：AI服务异常）在单测里全是绿的，只有真打才现形。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { WPSLingxiAuthPlugin } from '../index.mjs'

const COOKIE = String(process.env.WPS_LINGXI_COOKIE || '').trim()
const skip = COOKIE ? false : '没有 WPS_LINGXI_COOKIE，跳过真上游测试'
const model = process.env.WPS_LINGXI_MODEL || 'deepseek-v4.1-flash'

async function client() {
  const plugin = await WPSLingxiAuthPlugin()
  const getAuth = async () => ({ type: 'oauth', access: COOKIE, cookie: COOKIE, accountId: 'ci' })
  const { fetch } = await plugin.auth.loader(getAuth)
  return (body) => fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

async function collect(res) {
  const raw = await res.text()
  let finish = null
  let text = ''
  const calls = new Map()
  for (const line of raw.split('\n')) {
    if (!line.startsWith('data: ')) continue
    const payload = line.slice(6).trim()
    if (payload === '[DONE]') continue
    let value
    try { value = JSON.parse(payload) } catch { continue }
    if (value?.error) throw new Error(value.error.message || '上游错误帧')
    const choice = value?.choices?.[0]
    if (!choice) continue
    if (choice.finish_reason) finish = choice.finish_reason
    if (typeof choice.delta?.content === 'string') text += choice.delta.content
    for (const call of choice.delta?.tool_calls || []) {
      const index = Number.isInteger(call.index) ? call.index : 0
      const current = calls.get(index) || { name: '', args: '' }
      if (call.function?.name) current.name = call.function.name
      if (call.function?.arguments) current.args += call.function.arguments
      calls.set(index, current)
    }
  }
  return { status: res.status, finish, text, calls: [...calls.values()] }
}

test('上游接受压平后的工具 schema（anyOf/oneOf/$ref/allOf/not/const/type 数组）', { skip, timeout: 120000 }, async () => {
  const send = await client()
  const { status, finish } = await collect(await send({
    model,
    stream: true,
    messages: [{ role: 'user', content: '只回复 OK' }],
    tools: [{
      type: 'function',
      function: {
        name: 'probe',
        description: '回归探针：把上游会拒的 schema 写法全带上',
        parameters: {
          type: 'object',
          properties: {
            a: { anyOf: [{ type: 'string' }, { type: 'null' }] },
            b: { oneOf: [{ type: 'string' }, { type: 'number' }] },
            c: { allOf: [{ type: 'string' }, { maxLength: 10 }] },
            d: { not: { type: 'number' } },
            e: { const: 'x' },
            f: { type: ['string', 'null'] },
            g: { $ref: '#/$defs/name' },
          },
          $defs: { name: { type: 'string' } },
          required: ['a'],
        },
      },
    }],
  }))
  // 上游拒这些写法时是 HTTP 200 + 错误帧，所以只看状态码不够，collect() 会抛。
  assert.equal(status, 200)
  assert.ok(finish, '必须收到 finish_reason，否则说明流被截断')
})

test('工具调用能完整回到客户端', { skip, timeout: 120000 }, async () => {
  const send = await client()
  const { status, calls } = await collect(await send({
    model,
    stream: true,
    messages: [{ role: 'user', content: '请调用 read_file 读取 /tmp/a.txt，只调用这一个工具。' }],
    tools: [{
      type: 'function',
      function: {
        name: 'read_file',
        description: '读一个文件',
        parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
      },
    }],
  }))
  assert.equal(status, 200)
  assert.ok(calls.length >= 1, '必须至少返回一条工具调用')
  for (const call of calls) {
    assert.equal(call.name, 'read_file')
    assert.doesNotThrow(() => JSON.parse(call.args), `工具参数不是合法 JSON：${call.args.slice(0, 120)}`)
  }
})
