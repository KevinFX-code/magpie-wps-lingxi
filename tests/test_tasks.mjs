#!/usr/bin/env node
// 一次性任务实测脚本：只读 + 领取，不伪造完成。
//
//   node tests/test_tasks.mjs --sid "wps_sid=…; uid=…"
//   WPS_SID=... node tests/test_tasks.mjs
//   node tests/test_tasks.mjs --from-magpie            # 用 magpie 里已登录的 wps-lingxi 账号
//   node tests/test_tasks.mjs --from-magpie --session <id>
//                                                      # 没有「已完成会话」时，指定一个会话 id
//                                                      # 直接建群，专门采建群 400 的响应
//
// 做的事：
//   1. 列出任务中心（前后各一次，打印 status 变化）
//   2. 群聊任务 incomplete 时：找一个已完成会话 → 建群 → 解散 → 重拉
//   3. 领取所有 claimable（打印奖励）
//   4. 专家模式 / 使用客户端：只报告状态，不做任何伪装（纯 HTTP 翻不了）
//
// 需要 Node 18+（自带 fetch）。不会打印你的 sid。

const args = process.argv.slice(2)
const argOf = (name) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : ""
}

let RAW = argOf("sid") || process.env.WPS_SID || ""
if (!RAW && args.includes("--from-magpie")) {
  const { readMagpieCookie } = await import("./magpie-cred.mjs")
  const found = readMagpieCookie()
  if (found.error) {
    console.error("从 magpie 取凭据失败：", found.error)
    process.exit(2)
  }
  RAW = found.cookie
}
if (!RAW) {
  console.error("缺少凭据：用 --sid 传入 wps_sid（或整段 Cookie），或设置 WPS_SID，或加 --from-magpie。")
  process.exit(2)
}

// 只保留 wps_sid / uid，避免把别的 cookie 发出去
function parseCookie(raw) {
  const text = String(raw).trim().replace(/^cookie:\s*/i, "").replace(/^["']|["']$/g, "")
  const pairs = new Map()
  for (const part of text.split(";")) {
    const eq = part.indexOf("=")
    if (eq <= 0) continue
    pairs.set(part.slice(0, eq).trim(), part.slice(eq + 1).trim())
  }
  let sid = pairs.get("wps_sid") || ""
  if (!sid && !text.includes("=")) sid = text
  if (!sid) return null
  const uid = pairs.get("uid") || ""
  return { sid, uid, cookie: `wps_sid=${sid}${uid ? `; uid=${uid}` : ""}` }
}

const cred = parseCookie(RAW)
if (!cred) {
  console.error("没有在输入里找到 wps_sid。")
  process.exit(2)
}
const COOKIE = cred.cookie

const BASES = ["https://lingxi.wps.cn", "https://lingxi.kdocs.cn"]
const HEADERS = {
  Cookie: COOKIE,
  "Content-Type": "application/json",
  "X-Client-Type": "lingxi_claw",
  "X-Client-Lang": "zh-CN",
  "X-Cc-Agent-Type": "lingxi_claw",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
}

async function call(base, path, init = {}) {
  const res = await fetch(`${base}${path}`, { ...init, headers: { ...HEADERS, ...(init.headers || {}) } })
  const text = await res.text().catch(() => "")
  let json = {}
  try { json = text ? JSON.parse(text) : {} } catch {}
  return { ok: res.ok, status: res.status, json, text }
}

async function pickBase() {
  for (const base of BASES) {
    const r = await call(base, "/api/public/v1/credits/balance").catch(() => null)
    if (r?.ok) return base
    if (r?.status === 401 || r?.status === 403) return base // 登录失效也要停在这里，别再试别的域
  }
  return BASES[0]
}

async function taskList(base) {
  const r = await call(base, "/api/public/v1/tasks")
  if (!r.ok) return { error: `HTTP ${r.status}`, tasks: [] }
  const tasks = Array.isArray(r.json?.data?.tasks) ? r.json.data.tasks : []
  return { error: "", tasks, total: r.json?.data?.total_claimed_credits }
}

function line(t) {
  const reward = t.reward_amount != null ? ` ${t.reward_amount} 智点` : ""
  const action = t.action ? ` action=${t.action}` : ""
  return `  ${String(t.task_key).padEnd(24)} ${String(t.status).padEnd(10)}${reward}${action}`
}

function oneTime(tasks) {
  return tasks.filter((t) => t?.type === "one_time" && t?.task_key)
}

// 上游的会话完成态字段换过：老接口给 execution_status / terminal_status（"completed"），
// 现在 /api/public/v1/sessions/<id> 给 data.status = "finished"（另带 session_status: 0）。
// 只认老字段会一直判「没有已完成的会话」，建群那步永远走不到——建群 400 也就永远采不到。
const DONE_STATES = new Set(["completed", "finished", "success", "succeeded"])

async function pickCompletedSession(base) {
  const r = await call(base, "/api/public/v1/session_list?limit=30&exclude_agent=false&session_types=cowork_client&session_types=cowork_web&session_types=chat")
  if (!r.ok) return { error: `session_list HTTP ${r.status}` }
  const list = Array.isArray(r.json?.data?.list) ? r.json.data.list : []
  let scanned = 0
  for (const s of list) {
    const id = String(s?.session_id ?? "")
    if (!id) continue
    const d = await call(base, `/api/public/v1/sessions/${id}`).catch(() => null)
    if (!d?.ok) continue
    scanned++
    const data = d.json?.data || {}
    const status = String(data.status || data.execution_status || data.terminal_status || "")
    if (DONE_STATES.has(status)) return { id, status }
  }
  return { error: `没有已完成的会话（扫了 ${scanned}/${list.length} 个）` }
}

async function main() {
  const base = await pickBase()
  console.log(`base: ${base}`)
  console.log(`账号: uid=${cred.uid || "(无)"}  sid 尾号 ${cred.sid.slice(-4)}`)

  const before = await taskList(base)
  if (before.error) {
    console.error(`读取任务失败：${before.error}`)
    process.exit(1)
  }
  console.log("\n任务（前）：")
  for (const t of before.tasks) console.log(line(t))

  const group = oneTime(before.tasks).find((t) => t.action === "group_chat")
  if (group?.status === "incomplete") {
    const forced = argOf("session")
    console.log(forced ? "\n群聊任务未完成 → 用 --session 指定的会话建群…" : "\n群聊任务未完成 → 找已完成会话建群…")
    const pick = forced ? { id: String(forced) } : await pickCompletedSession(base)
    if (pick.error) {
      console.log(`  跳过：${pick.error}`)
      console.log("  提示：没有已完成会话时，用 --session <id> 指定一个，专门采建群 400 的响应。")
    } else {
      const created = await call(base, "/api/imchat/v1/channels", {
        method: "POST",
        body: JSON.stringify({ session_id: pick.id, expect_model: "plan_pro" }),
      })
      const channelId = String(created.json?.data?.channel_id ?? "")
      if (created.ok && channelId) {
        console.log(`  建群 ✓ channel=${channelId}`)
        const del = await call(base, `/api/imchat/v1/channels/${channelId}`, { method: "DELETE" })
        console.log(`  解散 ${del.ok ? "✓" : `✗ HTTP ${del.status}`}`)
      } else {
        console.log(`  建群失败：HTTP ${created.status}`)
        console.log(`  请求体：session_id=${pick.id} expect_model=plan_pro`)
        console.log(`  响应体：${created.text || "(空)"}`)
        if (created.text.length > 120) {
          console.log("  （上面是完整响应，不再截断 120 字——建群 400 的 body 是这次实测最需要的数据）")
        }
      }
    }
  }

  const mid = await taskList(base)
  console.log("\n任务（动作后）：")
  for (const t of mid.tasks) console.log(line(t))

  const claimable = oneTime(mid.tasks).filter((t) => t.status === "claimable")
  if (claimable.length) {
    console.log("\n领取 claimable…")
    for (const t of claimable) {
      const r = await call(base, `/api/public/v1/tasks/${encodeURIComponent(t.task_key)}/claim`, { method: "POST", body: "{}" })
      const reward = Number(r.json?.data?.reward_amount ?? 0)
      console.log(`  ${t.task_key}: ${r.json?.result === "ok" ? `✓ +${reward}` : `✗ ${r.json?.hint || `HTTP ${r.status}`}`}`)
    }
    const after = await taskList(base)
    console.log("\n任务（领取后）：")
    for (const t of after.tasks) console.log(line(t))
  }

  const stuck = oneTime(mid.tasks).filter((t) => t.status === "incomplete" && t.action !== "group_chat")
  if (stuck.length) {
    console.log("\n纯 HTTP 做不了（需要真实客户端对话）：")
    for (const t of stuck) console.log(`  ${t.task_key}（${t.reward_amount ?? "?"} 智点）`)
  }
}

main().catch((error) => {
  console.error("测试失败：", error?.message || error)
  process.exit(1)
})
