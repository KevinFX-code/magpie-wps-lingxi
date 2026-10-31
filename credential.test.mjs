// 登录凭据归一化：裸 wps_sid、整段 Cookie、DevTools 复制行都要能认出来，
// 并且按 uid / sid 尾部区分账号（固定 accountId 会让第二个账号覆盖第一个）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { WPSLingxiAuthPlugin, parseCookieInput } from './index.mjs'

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

test('the paste method returns the normalized credential', async () => {
  const plugin = await WPSLingxiAuthPlugin()
  const paste = plugin.auth.methods.find((m) => m.type === 'api')
  const empty = await paste.authorize({ sid: '' })
  assert.equal(empty.type, 'failed')
  const ok = await paste.authorize({ sid: 'Cookie: wps_sid=V02Spaste; uid=9' })
  assert.equal(ok.type, 'success')
  assert.equal(ok.key, 'V02Spaste')
  assert.equal(ok.metadata.cookie, 'wps_sid=V02Spaste; uid=9')
  assert.equal(ok.metadata.accountId, 'wps-9')
})
