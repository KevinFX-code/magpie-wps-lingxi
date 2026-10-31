#!/usr/bin/env node
// 任务信号实测：对当前账号跑「专家模式（aigc）」与「客户端（cowork+client_type）」
// 两个最小对话，报告每一步结果与余额变化。**不用于已领完任务的脸**——那种账号只能
// 验证请求形状与扣费，翻转验证需要未领任务的账号。
//
//   node tests/test_signals.mjs [--sid "..."]        # 缺省用本机灵犀客户端导入
//   node tests/test_signals.mjs --from-magpie        # 用 magpie 里已登录的 wps-lingxi 账号
//                                                    #（没装客户端就走这条；不打印 sid）
//
// 输出不包含完整 sid。

const args = process.argv.slice(2)
const argOf = (name) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : ""
}

const { WPSLingxiAuthPlugin, _internal } = await import("../index.mjs")
const { importLocalAccount, runExpertConversationViaAigc, runTaskConversation, resolveBase } = _internal

const mask = (sid) => (sid ? `…${sid.slice(-4)}` : "(无)")

async function main() {
  let cred
  const raw = argOf("sid") || process.env.WPS_SID || ""
  if (raw) {
    cred = _internal.parseCookieInput(raw)
    if (!cred) { console.error("没有在 --sid 里找到 wps_sid"); process.exit(2) }
  } else if (args.includes("--from-magpie")) {
    const { readMagpieCookie } = await import("./magpie-cred.mjs")
    const found = readMagpieCookie()
    if (found.error) { console.error("从 magpie 取凭据失败：", found.error); process.exit(2) }
    cred = _internal.parseCookieInput(found.cookie)
    if (!cred) { console.error("magpie 账号槽里的凭据没有 wps_sid"); process.exit(2) }
  } else {
    cred = await importLocalAccount()
    if (cred?.error) { console.error("导入失败：", cred.error); process.exit(2) }
  }
  const cookie = cred.cookie
  const base = resolveBase({ metadata: { host: cred.host } })
  console.log(`账号 uid=${cred.uid || "(无)"} sid ${mask(cred.sid)}  base=${base}`)

  const balance = async () => {
    const r = await fetch(`${base}/api/public/v1/credits/balance`, {
      headers: { Cookie: cookie, "User-Agent": "Mozilla/5.0", Accept: "application/json" },
    })
    const j = await r.json().catch(() => ({}))
    return j?.data?.total_balance ?? null
  }

  const tasks = async () => {
    const r = await fetch(`${base}/api/public/v1/tasks`, { headers: { Cookie: cookie, "User-Agent": "Mozilla/5.0" } })
    const j = await r.json().catch(() => ({}))
    return (j?.data?.tasks || []).filter((t) => t?.type === "one_time")
  }

  const before = { balance: await balance(), tasks: await tasks() }
  console.log("\n== 前 ==")
  console.log("余额:", before.balance)
  for (const t of before.tasks) console.log(`  ${t.task_key} ${t.status} (${t.reward_amount ?? "?"})`)

  console.log("\n== 专家任务：aigc 平面（session_mode=expert + with_expert=true）==")
  const expert = await runExpertConversationViaAigc(cookie, base)
  console.log("结果:", expert.ok ? "✓ " + expert.detail : "✗ " + expert.detail)

  console.log("\n== 客户端任务：cowork + client_type=365wps-lingxi-client（含 x-kso Cookie）==")
  const client = await runTaskConversation(cookie, base, { clientType: "lingxi_claw" })
  console.log("结果:", client.ok ? "✓ " + client.detail : "✗ " + client.detail)

  const after = { balance: await balance(), tasks: await tasks() }
  console.log("\n== 后 ==")
  console.log("余额:", after.balance, before.balance != null && after.balance != null ? `(消耗 ${before.balance - after.balance})` : "")
  for (const t of after.tasks) console.log(`  ${t.task_key} ${t.status} (${t.reward_amount ?? "?"})`)

  const flipped = after.tasks.some((t, i) => before.tasks[i] && t.status !== before.tasks[i].status)
  console.log("\n结论：", flipped ? "有任务状态变化！" : "任务状态无变化（账号已领完属正常；未领账号若也无变化则信号未命中）")
}

main().catch((e) => { console.error("实测失败：", e?.message || e); process.exit(1) })
