import { test } from 'node:test'
import assert from 'node:assert/strict'
import { WPSLingxiAuthPlugin } from '../index.mjs'

const COOKIE = `wps_sid=SID${'r'.repeat(29)}`

async function withFetch(fetchImpl, fn) {
  const originalFetch = globalThis.fetch
  globalThis.fetch = fetchImpl
  try {
    await fn()
  } finally {
    globalThis.fetch = originalFetch
  }
}

test('cookie auth disables background keepalive', async () => {
  const plugin = await WPSLingxiAuthPlugin()
  assert.equal(plugin.auth.keepAlive, false)
})

test('refresh validates the profile and advances the local lease', async () => {
  const plugin = await WPSLingxiAuthPlugin()
  const before = Date.now()
  await withFetch(async (url) => {
    assert.match(String(url), /\/api\/public\/v1\/account\/profile$/)
    return Response.json({ code: 'Success', data: { id: 'user-42', name: 'Test User' } })
  }, async () => {
    const result = await plugin.auth.refresh({ cookie: COOKIE, expires: 1, metadata: {} })
    assert.ok(result.expires > before)
    assert.equal(result.metadata.uid, 'user-42')
    assert.equal(result.metadata.name, 'Test User')
    assert.equal(result.accountId, 'wps-user-42')
    assert.equal(result.signIn, undefined)
  })
})

for (const status of [401, 403]) {
  test(`refresh marks an HTTP ${status} profile response as expired`, async () => {
    const plugin = await WPSLingxiAuthPlugin()
    await withFetch(async () => Response.json({ message: 'unauthorized' }, { status }), async () => {
      const result = await plugin.auth.refresh({ cookie: COOKIE, expires: 1, metadata: {} })
      assert.equal(result.signIn, 'expired')
      assert.equal(result.expires, undefined)
    })
  })
}

test('refresh marks a successful HTTP response with UserUnauthorized as expired', async () => {
  const plugin = await WPSLingxiAuthPlugin()
  await withFetch(async () => Response.json({ result: 'UserUnauthorized' }), async () => {
    const result = await plugin.auth.refresh({ cookie: COOKIE, expires: 1, metadata: {} })
    assert.equal(result.signIn, 'expired')
    assert.equal(result.expires, undefined)
  })
})

test('refresh throws transient profile failures so Magpie can back off', async () => {
  const plugin = await WPSLingxiAuthPlugin()
  await withFetch(async () => Response.json({ message: 'temporary outage' }, { status: 503 }), async () => {
    await assert.rejects(
      () => plugin.auth.refresh({ cookie: COOKIE, expires: 1, metadata: {} }),
      /HTTP 503/
    )
  })
})

test('refresh marks missing cookies as expired', async () => {
  const plugin = await WPSLingxiAuthPlugin()
  const result = await plugin.auth.refresh({ expires: 1, metadata: {} })
  assert.equal(result.signIn, 'expired')
})
