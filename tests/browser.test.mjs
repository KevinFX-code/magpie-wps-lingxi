// 浏览器发现：文件名/顺序错了就会像 issue #1 那样永远找不到 360。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { _internal } from '../index.mjs'

const env = {
  LOCALAPPDATA: 'C:/tmp/appdata/Local',
  APPDATA: 'C:/tmp/appdata/Roaming',
  USERPROFILE: 'C:/tmp/home',
  PROGRAMFILES: 'C:/Program Files',
  'PROGRAMFILES(X86)': 'C:/Program Files (x86)',
  MAGPIE_LINGXI_BROWSER: 'D:/tools/chrome.exe',
}

const candidates = _internal.browserCandidates('win32', env, () => '')

test('MAGPIE_LINGXI_BROWSER wins', () => {
  assert.equal(candidates[0], 'D:/tools/chrome.exe')
})

test('360 极速 X and 360se.exe are real candidates', () => {
  assert.ok(candidates.some((p) => p.includes('360ChromeX') && p.endsWith('360ChromeX.exe')))
  assert.ok(candidates.some((p) => p.includes('secoresdk') && p.endsWith('360se.exe')))
  assert.ok(!candidates.some((p) => p.endsWith('360se6.exe')), '360se6.exe 不是真实文件名')
})

test('Chrome is tried before Edge', () => {
  const chrome = candidates.findIndex((p) => p.includes('Google') && p.endsWith('chrome.exe'))
  const edge = candidates.findIndex((p) => p.includes('Microsoft') && p.includes('Edge'))
  assert.ok(chrome >= 0 && edge >= 0)
  assert.ok(chrome < edge)
})
