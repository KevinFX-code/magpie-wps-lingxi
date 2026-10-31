// 导入本机灵犀客户端账号：macOS 明文布局（1.3.27 / 1.3.31 实测）。
// fixture 是临时目录里的真 SQLite 库；probeBase 的网络全部打桩。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createCipheriv, createHash, randomBytes } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { WPSLingxiAuthPlugin, _internal } from '../index.mjs'

const SID = 'V02S' + 'a'.repeat(46)
const UID = '736187588'

// Chromium Cookies 表的最小 schema（够 select host_key,name,value,encrypted_value）。
function cookieDb(file, rows) {
  const db = new DatabaseSync(file)
  db.exec(`CREATE TABLE cookies (
    host_key TEXT NOT NULL,
    name TEXT NOT NULL,
    value TEXT NOT NULL,
    encrypted_value BLOB NOT NULL DEFAULT x''
  )`)
  for (const row of rows) {
    db.prepare('insert into cookies (host_key, name, value, encrypted_value) values (?, ?, ?, ?)')
      .run(row.host_key, row.name, row.value ?? '', row.encrypted_value ? Buffer.from(row.encrypted_value) : Buffer.alloc(0))
  }
  db.close()
}

// macOS 布局：Partitions/<name>/Cookies，值明文在 value 列，目录里没有 Local State。
function macFixture(sid = SID) {
  const dir = mkdtempSync(join(tmpdir(), 'lingxi-mac-'))
  mkdirSync(join(dir, 'Partitions', 'lingxi-business-v2-deadbeef'), { recursive: true })
  cookieDb(join(dir, 'Partitions', 'lingxi-business-v2-deadbeef', 'Cookies'), [
    { host_key: '.wps.cn', name: 'wps_sid', value: sid },
    { host_key: '.wps.cn', name: 'uid', value: UID },
  ])
  return dir
}

function installFetch(handler) {
  const original = globalThis.fetch
  globalThis.fetch = async (url, init = {}) => handler({ url: String(url), method: init.method || 'GET' })
  return { restore() { globalThis.fetch = original } }
}

test('imports a logged-in client from the macOS plaintext layout', async () => {
  const dir = macFixture()
  const net = installFetch((call) => {
    assert.ok(call.url.startsWith('https://lingxi.'), `probeBase should hit lingxi, got ${call.url}`)
    return Response.json({ result: 'ok' })
  })
  try {
    const cred = await _internal.importLocalAccount(dir)
    assert.equal(cred.error, undefined)
    assert.equal(cred.sid, SID)
    assert.equal(cred.uid, UID)
    assert.equal(cred.cookie, `wps_sid=${SID}; uid=${UID}`)
    assert.match(cred.host, /^https:\/\/lingxi\./)
    assert.equal(cred.accountId, `wps-${UID}`)
  } finally {
    net.restore()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('prefers .wps.cn rows and skips non-printable values', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'lingxi-pref-'))
  mkdirSync(join(dir, 'Partitions', 'in-app-browser-42'), { recursive: true })
  cookieDb(join(dir, 'Partitions', 'in-app-browser-42', 'Cookies'), [
    { host_key: '.kdocs.cn', name: 'wps_sid', value: 'V02S' + 'k'.repeat(46) },
    { host_key: '.wps.cn', name: 'wps_sid', value: SID },
    { host_key: '.wps.cn', name: 'uid', value: 'bad\u0007value' },
  ])
  const net = installFetch(() => Response.json({ result: 'ok' }))
  try {
    const cred = await _internal.importLocalAccount(dir)
    assert.equal(cred.sid, SID, 'the .wps.cn row wins over .kdocs.cn')
    assert.equal(cred.uid, '', 'a non-printable uid is dropped, not sent upstream')
    assert.equal(cred.accountId, `wps-${SID.slice(-8)}`)
  } finally {
    net.restore()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('an empty explicit directory reports no-login, a missing one reports not-found', async () => {
  const empty = mkdtempSync(join(tmpdir(), 'lingxi-empty-'))
  try {
    const cred = await _internal.importLocalAccount(empty)
    assert.match(cred.error, /没有已登录的 wps_sid/)

    const missing = join(empty, 'nope')
    const cred2 = await _internal.importLocalAccount(missing)
    assert.match(cred2.error, /没有找到灵犀客户端数据目录/)
    assert.match(cred2.error, /MAGPIE_LINGXI_HOME/)
  } finally {
    rmSync(empty, { recursive: true, force: true })
  }
})

test('the import method sits in auth.methods and signs in with zero input', async () => {
  const dir = macFixture()
  const net = installFetch(() => Response.json({ result: 'ok' }))
  process.env.MAGPIE_LINGXI_HOME = dir
  try {
    const plugin = await WPSLingxiAuthPlugin()
    const method = plugin.auth.methods.find((item) => /导入/.test(item.label))
    assert.ok(method, 'a local-client import method must exist')
    assert.equal(method.type, 'oauth')
    assert.equal(method.prompts, undefined, 'the panel must not ask for anything')

    const page = await method.authorize()
    assert.equal(page.opened, true)
    assert.equal(page.method, 'auto')
    const done = await page.callback()
    assert.equal(done.type, 'success')
    assert.equal(done.access, SID)
    assert.equal(done.cookie, `wps_sid=${SID}; uid=${UID}`)
    assert.equal(done.accountId, `wps-${UID}`)
    assert.match(done.metadata.host, /^https:\/\/lingxi\./)
  } finally {
    delete process.env.MAGPIE_LINGXI_HOME
    net.restore()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('decryptCookieValue unwraps Chromium v10 blobs with the host-hash prefix', async () => {
  const key = randomBytes(32)
  const host = '.wps.cn'
  const hostHash = createHash('sha256').update(host).digest()
  const nonce = randomBytes(12)
  const secret = 'V02' + 'z'.repeat(47)
  const cipher = createCipheriv('aes-256-gcm', key, nonce)
  const plain = Buffer.concat([hostHash, Buffer.from(secret, 'utf8')])
  const encrypted = Buffer.concat([Buffer.from('v10'), nonce, cipher.update(plain), cipher.final(), cipher.getAuthTag()])

  assert.equal(_internal.decryptCookieValue(key, encrypted), secret)
  assert.throws(() => _internal.decryptCookieValue(key, Buffer.from('v99xyz')), /加密版本/)
})
