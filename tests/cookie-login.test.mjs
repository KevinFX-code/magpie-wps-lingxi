// 手填 Cookie 登录（第三个 auth method）：格式校验、纯 HTTP 验证、失败只抛异常。
// 网络全部打桩，不碰真上游。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { WPSLingxiAuthPlugin, _internal } from '../index.mjs'
const { verifyCookie } = _internal

const SID = 'V02S' + 'a'.repeat(28) // 32 字符，过得了「太短」那道门
const COOKIE = `wps_sid=${SID}; uid=1001`

function installFetch(handler) {
  const calls = []
  const original = globalThis.fetch
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method || 'GET', headers: init.headers || {} })
    return handler({ url: String(url), method: init.method || 'GET', headers: init.headers || {} })
  }
  return {
    calls,
    restore() {
      globalThis.fetch = original
    },
  }
}

const jsonOk = (data) =>
  new Response(JSON.stringify({ code: 'Success', result: 'ok', data }), {
    headers: { 'content-type': 'application/json' },
  })

const rejected401 = () =>
  new Response(JSON.stringify({ result: 'UserUnauthorized' }), {
    status: 401,
    headers: { 'content-type': 'application/json' },
  })

async function cookieMethod() {
  const plugin = await WPSLingxiAuthPlugin({}, {})
  return plugin.auth.methods.find((m) => String(m.label).includes('Cookie'))
}

test('cookie login 是第三个方式，带一个 cookie 输入框', async () => {
  const plugin = await WPSLingxiAuthPlugin({}, {})
  // 按 label 找，不按下标：以后再加登录路时这条不会误报。
  const index = plugin.auth.methods.findIndex((item) => String(item.label).includes('Cookie'))
  assert.equal(index, 2)
  const m = plugin.auth.methods[index]
  assert.equal(m.type, 'oauth')
  assert.match(m.label, /Cookie/)
  assert.equal(m.prompts.length, 1)
  assert.equal(m.prompts[0].key, 'cookie')
  assert.equal(m.prompts[0].type, 'text')
})

test('输入框校验：整段 Cookie 认、垃圾不认、太短不认', async () => {
  const m = await cookieMethod()
  const validate = m.prompts[0].validate
  assert.equal(validate(COOKIE), undefined)
  assert.equal(validate(`Cookie: ${COOKIE}; lang=zh`), undefined)
  assert.match(validate(''), /wps_sid/)
  assert.match(validate('foo=bar'), /wps_sid/)
  assert.match(validate('wps_sid=short'), /太短/)
})

test('粘错了只抛异常，不返回 failed 流程对象', async () => {
  const m = await cookieMethod()
  // magpie 会把返回值当登录流程去调 .callback()，所以这里必须是 throw。
  await assert.rejects(() => m.authorize({ cookie: 'foo=bar' }), /wps_sid/)
  await assert.rejects(() => m.authorize({}), /wps_sid/)
})

test('authorize 立刻返回，不在里面等网络', async () => {
  const original = globalThis.fetch
  globalThis.fetch = () => new Promise(() => {}) // 永不 resolve
  try {
    const m = await cookieMethod()
    const t0 = Date.now()
    const flow = await m.authorize({ cookie: COOKIE })
    assert.ok(Date.now() - t0 < 1000, 'authorize 必须立刻返回，否则和 magpie 互锁')
    assert.equal(flow.opened, true) // 纯 HTTP，不让 magpie 再拉浏览器
    assert.equal(flow.method, 'auto')
    assert.equal(typeof flow.callback, 'function')
    assert.match(flow.url, /^https:\/\//)
  } finally {
    globalThis.fetch = original
  }
})

test('callback 成功时交回归一后的凭据', async () => {
  const stub = installFetch(() => jsonOk({ id: '9', name: '追风少年' }))
  try {
    const m = await cookieMethod()
    // 粘整段 Cookie（带噪声键），出去的只能有 wps_sid + uid
    const flow = await m.authorize({ cookie: `Cookie: ${COOKIE}; lang=zh; other=1` })
    const cred = await flow.callback()

    assert.equal(cred.type, 'success')
    assert.equal(cred.cookie, COOKIE)
    assert.equal(cred.access, SID)
    assert.equal(cred.accountId, 'wps-1001')
    assert.equal(cred.metadata.sid, SID)
    assert.equal(cred.metadata.uid, '1001')
    assert.equal(cred.metadata.cookieTail, SID.slice(-4))
    assert.equal(cred.metadata.cookie, COOKIE)
    assert.match(cred.metadata.host, /^https:\/\/lingxi\./)
    assert.ok(cred.expires > Date.now())

    assert.equal(stub.calls.length, 2) // 两个域名并发校验
    assert.equal(stub.calls[0].url, 'https://lingxi.wps.cn/api/public/v1/account/profile')
    // 噪声 cookie 不许发出去（x-kso-* 是 basicHeaders 自己补的客户端标识，属预期）
    const sent = String(stub.calls[0].headers.Cookie)
    assert.ok(sent.startsWith(COOKIE), `Cookie 应以 ${COOKIE} 开头，实际：${sent}`)
    assert.ok(!/\blang=|\bother=/.test(sent), 'lang / other 这类噪声键不该被带出去')
  } finally {
    stub.restore()
  }
})

test('callback 失败时返回 failed 并带上试过的域名', async () => {
  const stub = installFetch(() => rejected401())
  try {
    const m = await cookieMethod()
    const flow = await m.authorize({ cookie: COOKIE })
    const cred = await flow.callback()
    assert.equal(cred.type, 'failed')
    assert.match(cred.error, /无效|过期/)
    assert.equal(stub.calls.length, 2) // wps.cn 和 kdocs.cn 都试过
    assert.match(cred.error, /HTTP 401/)
  } finally {
    stub.restore()
  }
})

test('verifyCookie 会回落到 kdocs 域名', async () => {
  const stub = installFetch((call) =>
    call.url.startsWith('https://lingxi.wps.cn') ? rejected401() : jsonOk({ name: 'kd' }),
  )
  try {
    const r = await verifyCookie(COOKIE)
    assert.equal(r.ok, true)
    assert.equal(r.host, 'https://lingxi.kdocs.cn')
    assert.equal(r.name, 'kd')
  } finally {
    stub.restore()
  }
})

test('verifyCookie 不把 200 + UserUnauthorized 当成功', async () => {
  const stub = installFetch(
    () =>
      new Response(JSON.stringify({ result: 'UserUnauthorized' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
  )
  try {
    const r = await verifyCookie(COOKIE)
    assert.equal(r.ok, false)
    assert.equal(stub.calls.length, 2)
  } finally {
    stub.restore()
  }
})

test('verifyCookie 计算失败也换域名，全挂了才 ok:false', async () => {
  const stub = installFetch(() => {
    throw new Error('ECONNRESET')
  })
  try {
    const r = await verifyCookie(COOKIE)
    assert.equal(r.ok, false)
    assert.equal(stub.calls.length, 2)
    assert.equal(r.tried.length, 2)
  } finally {
    stub.restore()
  }
})

test('两个域名并发校验：一个挂住也不耽误另一个，总耗时不超过一份预算', async () => {
  const original = globalThis.fetch
  const calls = []
  // wps.cn 永远挂住并响应 abort；kdocs.cn 直接成功。
  // 这正是一个「只在 kdocs 有效的 Cookie」：旧版顺序试会因第一个域名超时而误判无效。
  // ⚠ 桩里必须有 ref 的定时器：AbortSignal.timeout() 的定时器是 unref 的，只有这个
  // 悬着的 promise 时事件循环会提前清空，Linux CI 上整条测试被判 cancelledByParent
  // （Windows 本地恰好有别的句柄撑着，骗过人）。
  globalThis.fetch = (url, init = {}) => {
    calls.push(String(url))
    if (String(url).startsWith('https://lingxi.wps.cn')) {
      return new Promise((_, reject) => {
        const keepAlive = setTimeout(() => {}, 5000)
        init.signal?.addEventListener('abort', () => {
          clearTimeout(keepAlive)
          reject(init.signal.reason || new Error('aborted'))
        })
      })
    }
    return Promise.resolve(new Response(JSON.stringify({ data: { name: 'kd' } }), {
      headers: { 'content-type': 'application/json' },
    }))
  }
  try {
    const t0 = Date.now()
    const r = await verifyCookie(COOKIE, { timeoutMs: 80 })
    const spent = Date.now() - t0
    assert.equal(r.ok, true, 'kdocs 有效就必须判有效')
    assert.equal(r.host, 'https://lingxi.kdocs.cn')
    assert.equal(calls.length, 2, '两个域名都要试，不能跳过')
    assert.ok(spent < 1000, `并发后应在预算附近结束，实际 ${spent}ms`)
  } finally {
    globalThis.fetch = original
  }
})

test('两个域名都失败时把各自原因带回去', async () => {
  const stub = installFetch(() => rejected401())
  try {
    const r = await verifyCookie(COOKIE)
    assert.equal(r.ok, false)
    assert.equal(r.tried.length, 2)
    assert.match(r.tried[0], /wps\.cn/)
    assert.match(r.tried[1], /kdocs\.cn/)
  } finally {
    stub.restore()
  }
})
