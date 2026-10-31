// 桌面端平面（cookie 归一化 + agent-runtime）的最小单测。
// 只测 index.mjs 当前真正导出的东西：删掉的网页平面辅助函数不该再出现。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { _internal } from '../index.mjs'
const { parseCookieInput } = _internal

const SID = 'V02S' + 'a'.repeat(28) // 32 字符，像真的会话 Cookie

test('a whole Cookie header keeps only wps_sid and uid', () => {
  const cred = parseCookieInput(`Cookie: wps_sid=${SID}; uid=10086; kso_sid=other; lang=zh`)
  assert.equal(cred.sid, SID)
  assert.equal(cred.uid, '10086')
  assert.equal(cred.cookie, `wps_sid=${SID}; uid=10086`)
  assert.equal(cred.accountId, 'wps-10086')
})

test('two uids get two account ids even with the same sid', () => {
  const a = parseCookieInput(`wps_sid=${SID}; uid=1001`)
  const b = parseCookieInput(`wps_sid=${SID}; uid=1002`)
  assert.notEqual(a.accountId, b.accountId)
  assert.equal(a.accountId, 'wps-1001')
  assert.equal(b.accountId, 'wps-1002')
})

test('extractSid refuses a bare value shorter than 16 chars', () => {
  const { extractSid } = _internal
  assert.equal(extractSid('short'), '')
  assert.equal(extractSid('a'.repeat(15)), '')
  assert.equal(extractSid('a'.repeat(16)), 'a'.repeat(16))
})

test('the agent plane keeps wps_sid and uid, drops the rest', () => {
  const { normalizeCredential, resolveCookie } = _internal
  // normalizeCredential 收的是 `wps_sid=…; uid=…` 这一段，不含 `Cookie:` 前缀。
  const cred = normalizeCredential(`kso_sid=other; wps_sid=${SID}; uid=7`)
  assert.equal(cred.cookie, `wps_sid=${SID}; uid=7`)
  assert.equal(cred.uid, '7')
  assert.equal(resolveCookie({ cookie: `wps_sid=${SID}; uid=7; kso_sid=x` }), `wps_sid=${SID}; uid=7`)
})

test('_internal has no web-plane helpers', () => {
  for (const name of ['toolProtocolPrompt', 'createToolCallParser', 'fetchLiveModels']) {
    assert.equal(name in _internal, false, `_internal should not export ${name}`)
  }
  for (const name of ['extractSid', 'normalizeCredential', 'resolveCookie', 'identityOf']) {
    assert.equal(typeof _internal[name], 'function', `_internal should export ${name}`)
  }
})
