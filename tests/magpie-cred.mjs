// 从 magpie 已经登录好的 wps-lingxi 账号槽里读凭据。
//
// 为什么需要它：测试者照着 TESTER-GUIDE 跑，机器上有 magpie 且插件已浏览器登录，
// 但没装灵犀客户端 —— 这时 importLocalAccount() 找不到客户端数据目录，脚本直接退出，
// 而文档又要求「全程不需要复制任何 Cookie」。这条路把 magpie 的登录态直接用起来。
//
// 只读，不改 magpie 的任何文件；返回值里的 cookie 不会被打印。

import { readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

export function magpieAuthPath() {
  return process.env.MAGPIE_AUTH_FILE || join(homedir(), ".config", "magpie", "plugin-auth.json")
}

// provider 缺省 wps-lingxi；返回 { cookie, accountId } 或 { error }
export function readMagpieCookie({ provider = "wps-lingxi" } = {}) {
  const file = magpieAuthPath()
  let text
  try {
    text = readFileSync(file, "utf8")
  } catch {
    return { error: `读不到 magpie 凭据：${file}（先用 magpie 登录 ${provider}，或指 MAGPIE_AUTH_FILE）` }
  }

  let auth
  try {
    auth = JSON.parse(text)
  } catch {
    return { error: `magpie 凭据不是合法 JSON：${file}` }
  }

  const keys = Object.keys(auth || {}).filter((k) => k === provider || k.startsWith(`${provider}#`))
  if (!keys.length) {
    return { error: `magpie 里没有 ${provider} 账号（${file}）` }
  }

  for (const key of keys) {
    const cookie = auth[key]?.cookie || ""
    if (cookie.includes("wps_sid")) {
      return { cookie, accountId: auth[key]?.accountId || key }
    }
  }
  return { error: `${provider} 的账号槽里没有 wps_sid（${file}）` }
}
