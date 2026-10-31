// 登录凭据归一化：裸 wps_sid、整段 Cookie、DevTools 复制行都要能认出来，
// 并且按 uid / sid 尾部区分账号（固定 accountId 会让第二个账号覆盖第一个）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { WPSLingxiAuthPlugin, _internal } from '../index.mjs'
const { parseCookieInput } = _internal

test('a bare wps_sid is accepted and keyed by its tail', () => {
  const cred = parseCookieInput('V02Sabcdefgh1234')
  assert.equal(cred.sid, 'V02Sabcdefgh1234')
  assert.equal(cred.uid, '')
  assert.equal(cred.cookie, 'wps_sid=V02Sabcdefgh1234')
  assert.equal(cred.accountId, 'wps-efgh1234')
})

test('wps_sid=… and uid=… are kept together', () => {
  const cred = parseCookieInput('wps_sid=V02Sabc; uid=1001')
  assert.deepEqual(
    { sid: cred.sid, uid: cred.uid, cookie: cred.cookie, accountId: cred.accountId },
    { sid: 'V02Sabc', uid: '1001', cookie: 'wps_sid=V02Sabc; uid=1001', accountId: 'wps-1001' },
  )
})

test('a whole Cookie header is parsed, extra cookies dropped', () => {
  const cred = parseCookieInput('Cookie: wps_sid=V02Sxyz; uid=42; lang=zh; other=1')
  assert.equal(cred.sid, 'V02Sxyz')
  assert.equal(cred.uid, '42')
  assert.equal(cred.cookie, 'wps_sid=V02Sxyz; uid=42')
})

test('quoted pastes are tolerated', () => {
  assert.equal(parseCookieInput('"wps_sid=V02Sq; uid=7"').cookie, 'wps_sid=V02Sq; uid=7')
})

test('two accounts get different ids', () => {
  const a = parseCookieInput('wps_sid=V02A; uid=1')
  const b = parseCookieInput('wps_sid=V02B; uid=2')
  assert.notEqual(a.accountId, b.accountId)
})

test('input without a wps_sid is refused', () => {
  assert.equal(parseCookieInput(''), null)
  assert.equal(parseCookieInput('foo=bar'), null)
  assert.equal(parseCookieInput('Cookie: lang=zh'), null)
})

test('normalization keeps wps_sid and uid for the account slot', () => {
  const cred = _internal.normalizeCredential('Cookie: wps_sid=V02Spaste000000000000; uid=9')
  assert.equal(cred.sid, 'V02Spaste000000000000')
  assert.equal(cred.cookie, 'wps_sid=V02Spaste000000000000; uid=9')
  assert.equal(cred.accountId, 'wps-9')
  assert.ok(_internal.normalizeCredential('').error)
})

test('refresh migrates legacy accounts and attaches the profile name', async () => {
  const plugin = await WPSLingxiAuthPlugin()
  const original = globalThis.fetch
  globalThis.fetch = async (url) => {
    if (String(url).includes('/api/public/v1/account/profile')) {
      return Response.json({ data: { id: '289160871', name: 'Forsaken', corp_id: '0' } })
    }
    return new Response('not found', { status: 404 })
  }
  try {
    const sid = 'S' + 'i'.repeat(40)
    const merged = await plugin.auth.refresh({
      cookie: `wps_sid=${sid}`,
      accountId: 'WPS 灵犀账户',
      metadata: {},
    })
    assert.equal(merged.accountId, 'wps-289160871')
    assert.equal(merged.metadata.uid, '289160871')
    assert.equal(merged.metadata.name, 'Forsaken')
    assert.equal(merged.metadata.sid, sid)
  } finally {
    globalThis.fetch = original
  }
})
