// 上游按 token 限量，超了不给原因、直接 400「AI服务异常」，整轮失败。
// 这里验证客户端侧的保守裁剪：先掐长条，再从最老的一端整条丢，system 和 tool 配对都不许拆。
process.env.MAGPIE_LINGXI_MAX_PROMPT_KB = '32'
process.env.MAGPIE_LINGXI_MAX_MESSAGE_KB = '8'

const { _internal } = await import('../index.mjs')
const { buildAgentBody, byteLength } = _internal
const { test } = await import('node:test')
const assert = await import('node:assert/strict')

const LIMIT = 32 * 1024
const size = (body) => byteLength(JSON.stringify(body))
const filler = (n, ch = '好') => ch.repeat(n)

test('小请求原样透传', () => {
  const body = { messages: [{ role: 'system', content: 'sys' }, { role: 'user', content: 'hi' }] }
  const out = buildAgentBody(body, 'kimi-k3.1-pro')
  assert.equal(out.messages.length, 2)
  assert.equal(out.messages[1].content, 'hi')
})

test('历史超限时从最老的一端丢，并留一行标记', () => {
  const messages = [{ role: 'system', content: 'sys' }]
  for (let i = 0; i < 120; i++) messages.push({ role: 'user', content: `${i}:${filler(300)}` })
  const out = buildAgentBody({ messages }, 'kimi-k3.1-pro')

  assert.ok(size(out) <= LIMIT, `裁剪后仍超限：${size(out)}`)
  assert.equal(out.messages[0].role, 'system', 'system 消息必须保留')
  assert.equal(out.messages[0].content, 'sys')
  assert.equal(out.messages[1].role, 'system')
  assert.match(out.messages[1].content, /历史已压缩/)
  assert.ok(out.messages.length < messages.length + 1, '应该丢掉了一部分历史')
  assert.match(out.messages.at(-1).content, /^119:/, '最新一条必须留下')
})

test('单条超长消息掐头去尾，而不是整条丢掉', () => {
  const huge = `HEAD-${filler(200000)}-TAIL`
  const out = buildAgentBody(
    { messages: [{ role: 'system', content: 'sys' }, { role: 'user', content: huge }] },
    'kimi-k3.1-pro',
  )
  const kept = out.messages.at(-1).content
  assert.ok(kept.length < huge.length)
  assert.match(kept, /^HEAD-/, '开头要留下')
  assert.match(kept, /-TAIL$/, '结尾要留下')
  assert.match(kept, /本条消息过长，已截断/)
  assert.ok(byteLength(kept) <= 8 * 1024 + 200, `截断后仍有 ${byteLength(kept)} 字节`)
  assert.ok(size(out) <= LIMIT)
})

test('裁剪不会留下孤儿 tool 结果', () => {
  const messages = [{ role: 'system', content: 'sys' }]
  for (let i = 0; i < 80; i++) {
    messages.push({ role: 'user', content: `${i}:${filler(200)}` })
    messages.push({ role: 'assistant', content: '', tool_calls: [{ id: `c${i}`, type: 'function', function: { name: 'write', arguments: '{}' } }] })
    messages.push({ role: 'tool', tool_call_id: `c${i}`, content: filler(200) })
  }
  const out = buildAgentBody({ messages }, 'kimi-k3.1-pro')
  assert.ok(size(out) <= LIMIT)
  const afterSystem = out.messages.findIndex((m) => m.role !== 'system')
  assert.notEqual(out.messages[afterSystem].role, 'tool', '第一条非 system 消息不能是 tool 结果')
})

test('固定开销本身就超限时也不崩，至少留一条', () => {
  const bigTools = [{
    type: 'function',
    function: {
      name: 'huge',
      description: filler(40000, 'x'),
      parameters: { type: 'object', properties: { a: { type: 'string', description: filler(40000, 'y') } } },
    },
  }]
  const messages = [{ role: 'system', content: 'sys' }]
  for (let i = 0; i < 10; i++) messages.push({ role: 'user', content: `${i}:${filler(100)}` })
  const out = buildAgentBody({ messages, tools: bigTools }, 'kimi-k3.1-pro')
  assert.ok(out.messages.length >= 1)
  assert.equal(out.messages[0].role, 'system')
})
