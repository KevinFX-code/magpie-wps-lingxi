#!/usr/bin/env node
// WPS 灵犀独立测试与验证工具
// 支持：测试登录凭证有效性、查询灵犀额度、执行每日签到、测试模型对话

import { WPSLingxiAuthPlugin } from "./index.mjs"

const sid = process.env.WPS_SID || process.argv[2]

if (!sid) {
  console.log(`
使用方法:
  node test_lingxi.mjs <wps_sid>
或者:
  WPS_SID="你的wps_sid" node test_lingxi.mjs

示例:
  node test_lingxi.mjs V02...
`)
  process.exit(1)
}

const plugin = await WPSLingxiAuthPlugin()
const fakeGetAuth = async () => ({
  type: "oauth",
  access: sid,
  cookie: sid.startsWith("wps_sid=") ? sid : `wps_sid=${sid}`,
  accountId: "测试账户",
})

async function run() {
  console.log("=== 1. 查询可用模型 ===")
  const models = await plugin.provider.models(plugin.provider, { auth: await fakeGetAuth() })
  const list = Object.values(models)
  console.log(`共支持 ${list.length} 个模型:`)
  for (const m of list) {
    console.log(`  - ${m.id} (${m.name}) [上下文: ${m.limit?.context || 0}]`)
  }

  console.log("\n=== 2. 测试灵犀算力用量查询 (Usage) ===")
  const usage = await plugin.auth.usage(fakeGetAuth)
  console.log("用量信息:", JSON.stringify(usage, null, 2))

  console.log("\n=== 3. 测试每日自动签到 (Daily Check-in) ===")
  const checkinResult = await plugin.auth.checkin(fakeGetAuth)
  console.log("签到结果:", JSON.stringify(checkinResult, null, 2))

  console.log("\n=== 4. 测试反代对话 (Chat Completion) ===")
  const loaderOpts = await plugin.auth.loader(fakeGetAuth)
  const customFetch = loaderOpts.fetch
  try {
    const res = await customFetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "deepseek-v4.1-flash",
        messages: [{ role: "user", content: "请用一句话介绍你自己" }],
        stream: false,
      }),
    })
    console.log("HTTP 状态码:", res.status)
    const json = await res.json()
    console.log("模型回复:", JSON.stringify(json, null, 2))
  } catch (e) {
    console.log("对话测试异常:", e.message)
  }
}

run()
