// WPS 灵犀 (Lingxi) Provider Plugin for Magpie / OpenCode
// 桌面客户端专用：cowork 会话 → credits/run → agent-runtime（安装包 1.3.31 取证）。
// 同时提供每日签到、智点额度与客户端模型目录；不再使用网页端通路。

import { createServer } from "node:http"
import { createDecipheriv, createHash } from "node:crypto"
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { homedir, tmpdir, userInfo } from "node:os"
import { exec, execFileSync, spawn } from "node:child_process"

const PROVIDER = "wps-lingxi"
// 只走桌面端（灵犀 1.3.31 安装包）的那一条通路，不再有网页平面：
//   建会话 POST /api/aioffice/v1/cowork/sessions
//   领 run POST /api/public/v1/credits/runs
//   对话   POST /api/public/v1/agent-runtime/chat/completions   (SSE，原生 messages/tools)
// origin 默认 lingxi.wps.cn（客户端默认域）；kdocs 账号登录后由 probeBase 切到 lingxi.kdocs.cn。
const BASE = "https://lingxi.wps.cn"
const KDOCS_BASE = "https://lingxi.kdocs.cn"
const AGENT_SESSIONS_PATH = "/api/aioffice/v1/cowork/sessions"
const AGENT_RUNS_PATH = "/api/public/v1/credits/runs"
const AGENT_CHAT_PATH = "/api/public/v1/agent-runtime/chat/completions"
const CLIENT_TYPE = "lingxi_claw"
const CLIENT_LANG = "zh-CN"
const RUN_TTL_MS = 60 * 60 * 1000

// 上游按 token 限量：实测上限约 150K token（中文填充 ~175 token/KB，混合内容 ~255 token/KB）。
// 超了不会告诉你「太长」，而是 400「AI服务异常」，整轮失败。320KB 是保守值，留约一半余量。
const MAX_PROMPT_KB = Math.max(32, Number(process.env.MAGPIE_LINGXI_MAX_PROMPT_KB || 320))
const MAX_PROMPT_BYTES = MAX_PROMPT_KB * 1024
// 单条消息超限时掐头去尾，而不是把整条丢掉：一次 533KB 的粘贴会让「整条丢」直接跳空，
// 把其余历史一起牺牲掉。
const MAX_MESSAGE_KB = Math.max(4, Number(process.env.MAGPIE_LINGXI_MAX_MESSAGE_KB || 48))
const MAX_MESSAGE_BYTES = MAX_MESSAGE_KB * 1024
// 客户端 main 进程会给所有 *.wps.cn 请求的 Cookie 追加 x-kso-* 设备头
// （x-kso-app-name=win-lingxi-desktop 等）。服务端判断"是不是桌面客户端"很可能看它，
// 我们照拼（不带需要 plussvr RSA 的 signature，先验证是否必需）。
const DEVICE_ID = createHash("sha256").update("magpie-lingxi-device").digest("hex")
const KSO_COOKIE_PARTS = [
  "x-kso-app-name=win-lingxi-desktop",
  "x-kso-app-version=1.3.31",
  `x-kso-device-id=${DEVICE_ID}`,
]
function clientCookie(cookie) {
  if (process.env.MAGPIE_LINGXI_NO_KSO === "1") return cookie || ""
  return cookie ? `${cookie}; ${KSO_COOKIE_PARTS.join("; ")}` : KSO_COOKIE_PARTS.join("; ")
}
// 15 天内到期 = 临时积分（与 jet 插件同一判据）；可用 MAGPIE_LINGXI_TEMP_DAYS 调整。
const TEMP_CREDIT_WINDOW_MS =
  (Number(process.env.MAGPIE_LINGXI_TEMP_DAYS) > 0 ? Number(process.env.MAGPIE_LINGXI_TEMP_DAYS) : 15) * 24 * 60 * 60 * 1000
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
const LINGXI_ICON = "data:image/png;base64,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"
const NPM = "@ai-sdk/openai-compatible"

// 灵犀官方模型表（与网页端 1:1 保持一致）
const DEFAULT_MODELS = [
  { id: "auto", name: "自动推荐 (Auto)", context: 1048576, multiplier: "1.0x", reasoning: true, vision: false },
  { id: "deepseek-v4.1-flash", name: "DeepSeek V4.1 Flash", context: 1048576, multiplier: "0.12x", reasoning: true, vision: true },
  { id: "deepseek-v4-flash-0731", name: "DeepSeek V4 Flash", context: 1048576, multiplier: "0.09x", reasoning: true, vision: false },
  { id: "deepseek-v4-pro-0813", name: "DeepSeek V4 Pro", context: 1048576, multiplier: "0.40x", reasoning: true, vision: false },
  { id: "kimi-k3", name: "Kimi-K3", context: 1048576, multiplier: "1.60x", reasoning: true, vision: true },
  { id: "GLM-5.3", name: "GLM-5.3", context: 1048576, multiplier: "0.75x", reasoning: true, vision: false },
  { id: "GLM-5.3-Flash", name: "GLM-5.3-Flash", context: 1048576, multiplier: "0.11x", reasoning: true, vision: true },
  { id: "qwen3.8_max", name: "Qwen3.8-Max", context: 1048576, multiplier: "0.80x", reasoning: true, vision: true },
  { id: "qwen3.8_flash", name: "Qwen3.8-Flash", context: 1048576, multiplier: "0.08x", reasoning: true, vision: true },
  { id: "minimax_m3", name: "MiniMax-M3", context: 1048576, multiplier: "0.20x", reasoning: false, vision: true },
  { id: "doubao_seed_2_1_pro_260628", name: "Doubao-Seed-2.1 Pro", context: 262144, multiplier: "0.50x", reasoning: true, vision: true },
  { id: "mimo-v2.6-pro", name: "Xiaomi MiMo-V2.6 Pro", context: 1048576, multiplier: "0.10x", reasoning: false, vision: true },
  { id: "plan_pro", name: "Pro 模式 (深度推理)", context: 1048576, multiplier: "1.0x", reasoning: true, vision: false },
  { id: "plan_max", name: "Max 模式 (复杂任务)", context: 1048576, multiplier: "1.0x", reasoning: true, vision: false },
]

// variantsOf is a model's variants as OpenCode and magpie read them: an object
// with one key per level, not an array. magpie's plugin host takes
// Object.keys(variants), and an array's keys are its indexes — which is how
// ["low","high","max"] came to be read as the levels "0", "1", "2".
function variantsOf(reasoningOrEfforts) {
  if (Array.isArray(reasoningOrEfforts)) {
    const levels = [...new Set(reasoningOrEfforts
      .map((level) => String(level ?? "").trim().toLowerCase())
      .filter((level) => ["low", "medium", "high", "max"].includes(level)))]
    if (levels.length) return Object.fromEntries(levels.map((level) => [level, {}]))
  }
  return reasoningOrEfforts ? { low: {}, high: {}, max: {} } : {}
}

// magpie 的倍率是独立字段 rate（数字），不要拼进 name：
// 拼进去会让筛选框把倍率当模型名匹配，胶囊样式也不对。
function rateOf(multiplier) {
  const text = String(multiplier ?? "").replace(/[~≈～〜∼]/g, "").replace(/\s+/g, "").toLowerCase()
  const match = /^x?([0-9]*\.?[0-9]+)x?$/.exec(text)
  const value = match ? Number(match[1]) : NaN
  return Number.isFinite(value) && value > 0 ? value : undefined
}

function configModels() {
  return Object.fromEntries(
    DEFAULT_MODELS.map((m) => [
      m.id,
      {
        name: m.name,
        ...(rateOf(m.multiplier) ? { rate: rateOf(m.multiplier) } : {}),
        limit: { context: m.context, output: 65536 },
        tool_call: true,
        ...(m.reasoning ? { reasoning: true, variants: variantsOf(m.reasoning_efforts) } : {}),
      },
    ])
  )
}

function modelOf(provider, m) {
  const isReasoning = !!(m.reasoning || (m.reasoning_efforts && m.reasoning_efforts.length > 0))
  const rate = rateOf(m.multiplier)
  return {
    id: m.id || m.key,
    providerID: provider.id,
    name: m.name,
    ...(rate ? { rate } : {}),
    api: { id: m.id || m.key, url: `${BASE}/api`, npm: NPM },
    status: "active",
    headers: {},
    options: {},
    cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
    limit: { context: m.max_context_tokens || m.context || 1048576, output: m.max_new_tokens || 65536 },
    capabilities: {
      temperature: true,
      reasoning: isReasoning,
      attachment: !!(m.support_multimodal ?? m.vision),
      toolcall: true,
      input: { text: true, image: !!(m.support_multimodal ?? m.vision), audio: false, video: false, pdf: false },
      output: { text: true, image: false, audio: false, video: false, pdf: false },
      interleaved: false,
    },
    release_date: "",
    variants: variantsOf(m.reasoning_efforts ?? isReasoning),
  }
}

// 上游时间是 "YYYY-MM-DD HH:mm:ss"（北京时区）；magpie 只认严格 ISO。
function toIso(value) {
  const text = String(value ?? "").trim()
  if (!text) return ""
  if (/^\d{4}-\d{2}-\d{2}T/.test(text)) return text
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)$/.exec(text)
  return m ? `${m[1]}T${m[2]}${m[2].length === 5 ? ":00" : ""}+08:00` : text
}

// 汇总「临时积分」：只算未过期、且在窗口内的赠送批次。
// 纯函数，便于对边界（正好 15 天、已过期、坏时间）做单测。
function summarizeExpiring(items, nowMs = Date.now(), windowMs = TEMP_CREDIT_WINDOW_MS) {
  const out = { balance: 0, value: 0, consumed: 0, earliest: "" }
  for (const item of Array.isArray(items) ? items : []) {
    const expireMs = Date.parse(item?.expire_time ?? "")
    if (!Number.isFinite(expireMs) || expireMs <= nowMs) continue
    if (windowMs > 0 && expireMs - nowMs > windowMs) continue
    const balance = Number(item.balance ?? 0)
    const value = Number(item.value ?? 0)
    const consumed = Number(item.consumed ?? Math.max(0, value - balance))
    if (![balance, value, consumed].every(Number.isFinite)) continue
    out.balance += balance
    out.value += value
    out.consumed += consumed
    if (!out.earliest || expireMs < Date.parse(out.earliest)) out.earliest = String(item.expire_time)
  }
  return out
}

// "2026-11-30T07:06:59+08:00" -> "11-30"
function creditDateLabel(value) {
  const text = String(value ?? "")
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(text)
  return match ? `${match[2]}-${match[3]}` : text
}

function getTodayString() {
  const d = new Date()
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

// 登录凭据解析：用户粘贴的可能是裸 wps_sid、`wps_sid=…`、整段
// `Cookie: wps_sid=…; uid=…`，或 DevTools 里复制的一整行。统一归一成
// `wps_sid=…; uid=…`，并按 uid（没有就按 sid 尾部）区分账号 —— 固定
// accountId 会让第二个账号覆盖第一个。
function parseCookieInput(raw) {
  let text = String(raw ?? "").trim()
  if (!text) return null
  text = text.replace(/^cookie:\s*/i, "").replace(/^["']|["']$/g, "").trim()

  const pairs = new Map()
  for (const part of text.split(";")) {
    const eq = part.indexOf("=")
    if (eq <= 0) continue
    const name = part.slice(0, eq).trim()
    const value = part.slice(eq + 1).trim()
    if (name) pairs.set(name, value)
  }

  let sid = pairs.get("wps_sid") || ""
  // 裸值（没有 `=`）就是 wps_sid 本身
  if (!sid && !text.includes("=")) sid = text
  if (!sid) return null

  const uid = pairs.get("uid") || ""
  // 灰度 region：客户端从 cookie copilot_server_branch 读，随请求发 X-Cc-Region。
  const region = pairs.get("copilot_server_branch") || ""
  const cookie = `wps_sid=${sid}${uid ? `; uid=${uid}` : ""}${region ? `; copilot_server_branch=${region}` : ""}`
  const accountId = uid ? `wps-${uid}` : `wps-${sid.slice(-8)}`
  return { sid, uid, region, cookie, accountId }
}


// 客户端两条平面都只认 `Cookie: wps_sid=…`；下面两个辅助从任意粘贴文本里
// 取出 wps_sid / uid，供 agent 平面和账号标识使用。
function extractSid(value) {
  const text = String(value ?? "").trim()
  if (!text) return ""
  if (text.includes("=") || text.includes(";")) {
    for (const part of text.split(";")) {
      const item = part.trim()
      if (!item.toLowerCase().startsWith("wps_sid=")) continue
      const sid = item.slice(8).trim().replace(/^"|"$/g, "")
      if (sid) return sid
    }
    return ""
  }
  // 裸值：长度像会话 Cookie 才收（太短的多半是误粘的别的令牌）
  return text.length >= 16 ? text : ""
}

function extractUid(value) {
  for (const part of String(value ?? "").split(";")) {
    const item = part.trim()
    if (item.startsWith("uid=")) return item.slice(4).trim().replace(/^"|"$/g, "")
  }
  return ""
}

// sid 的 sha256 前 16 位：同一 Cookie 恒定、不同账号不同，且不泄露 Cookie。
function identityOf(text) {
  return createHash("sha256").update(String(text)).digest("hex").slice(0, 16)
}

const cookieTail = (sid) => String(sid).slice(-4)

// 账号的会话凭据统一从 parseCookieInput 归一：保留 wps_sid 与 uid（多账号靠 uid 区分），
// 其余键（kso_sid / rtk / lang…）不需要，也不该发给上游。
function resolveCookie(auth) {
  if (!auth) return ""
  const cred = parseCookieInput(
    auth.metadata?.cookie || auth.cookie || auth.key || auth.access || auth.metadata?.sid || ""
  )
  return cred ? cred.cookie : ""
}

function normalizeCredential(raw) {
  const cred = parseCookieInput(raw)
  if (!cred) return { error: "没有在输入里找到 wps_sid（可粘贴整段 Cookie 或 wps_sid 的值）" }
  if (cred.sid.length < 16) return { error: "wps_sid 太短，像是不完整的粘贴" }
  return {
    sid: cred.sid,
    uid: cred.uid,
    region: cred.region || "",
    identity: identityOf(cred.sid),
    cookie: cred.cookie,
    accountId: cred.accountId,
    tail: cookieTail(cred.sid),
  }
}

// ── 上游信封与请求头 ──────────────────────────────────────────────────

function textOfPayload(payload) {
  const value = payload?.hint ?? payload?.msg ?? payload?.message ?? payload?.error?.message ?? payload?.error
  return typeof value === "string" ? value.trim() : ""
}

function envelopeError(payload) {
  if (!payload || typeof payload !== "object") return ""
  if (typeof payload.result === "string" && payload.result.toLowerCase() !== "ok") {
    return textOfPayload(payload) || `result=${payload.result}`
  }
  if (typeof payload.code === "string" && payload.code.toLowerCase() !== "success") {
    return textOfPayload(payload) || `code=${payload.code}`
  }
  return ""
}

function basicHeaders(cookie, base = BASE) {
  return { Cookie: clientCookie(cookie), "User-Agent": UA, Referer: `${base}/`, Accept: "application/json" }
}

function resolveBase(auth) {
  const host = typeof auth?.metadata?.host === "string" ? auth.metadata.host.trim() : ""
  return host || BASE
}

// 手填 Cookie 登录的校验：profile 接口能读出账号信息才算这把 Cookie 真的可用。
// 只认 200 + 不是 UserUnauthorized；两个域名并发试（同一把 Cookie 在两套站上都可能有效），
// 都认才取 wps.cn。并发的好处：总耗时不超过 timeoutMs，也不会因为一个域名挂住
// 就把另一个域名上的有效 Cookie 判死。
async function verifyHost(cookie, base, timeoutMs) {
  try {
    const response = await fetch(`${base}/api/public/v1/account/profile`, {
      headers: basicHeaders(cookie, base),
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!response.ok) return { base, ok: false, note: `HTTP ${response.status}` }
    const json = await response.json().catch(() => ({}))
    if (json?.result === "UserUnauthorized") return { base, ok: false, note: "HTTP 200 UserUnauthorized" }
    return { base, ok: true, note: `HTTP ${response.status}`, name: String(json?.data?.name ?? "").trim() }
  } catch (error) {
    return { base, ok: false, note: String(error?.message || error).slice(0, 60) }
  }
}

async function verifyCookie(cookie, { timeoutMs = 20000 } = {}) {
  const results = await Promise.all([BASE, KDOCS_BASE].map((base) => verifyHost(cookie, base, timeoutMs)))
  const winner = results.find((item) => item.ok)
  if (winner) return { ok: true, host: winner.base, name: winner.name }
  return { ok: false, tried: results.map((item) => `${item.base} → ${item.note}`) }
}

// 登录后探测哪个域名接受这把 Cookie —— 就是 verifyCookie 的 host 部分，
// 别为同一件事留第二套判据（旧版只认 response.ok，会把 200+UserUnauthorized 当成功）。
async function probeBase(cookie) {
  const result = await verifyCookie(cookie)
  return result.host || BASE
}

// ── 浏览器自动登录（Chrome/Edge CDP 抓 wps_sid）────────────────────────
// 打开一个独立的浏览器配置目录，让用户在正常网页里登录，登录后从
// DevTools 协议读 Cookie —— 不需要手动复制；找不到浏览器时回落到粘贴。

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function which(name) {
  for (const dir of String(process.env.PATH || "").split(":")) {
    if (!dir) continue
    const file = join(dir, name)
    if (existsSync(file)) return file
  }
  return ""
}

// 任意 Chromium 内核浏览器都能用（CDP 读 Cookie），不止 Chrome/Edge。
// 国内常见的 360/QQ/搜狗 也走这条路；360 安全浏览器可能吞掉调试参数，失败时给明确提示。
// Windows 的浏览器候选顺序照搬 magicrew 插件的实测结论：
// Chrome / Chromium 优先 → 国产 Chromium 系 → Edge 最后（策略最多、最容易被拦）。
// ⚠ 两个真实文件名很容易写错：
//   · 360 安全浏览器是 360se.exe（不是 360se6.exe）；
//   · 360 极速浏览器 X 是 360ChromeX.exe（不在 360Chrome 目录下）。
const WIN_REGISTRY_BROWSERS = [
  "chrome.exe",
  "360ChromeX.exe",
  "360chrome.exe",
  "360se.exe",
  "QQBrowser.exe",
  "brave.exe",
  "vivaldi.exe",
  "opera.exe",
  "SogouExplorer.exe",
  "2345Explorer.exe",
  "liebao.exe",
  "Maxthon.exe",
  "UCBrowser.exe",
  "Quark.exe",
  "msedge.exe",
]

function winBrowserPaths(env) {
  const local = env.LOCALAPPDATA || ""
  const roaming = env.APPDATA || ""
  const home = env.USERPROFILE || env.HOME || ""
  const pf = env.PROGRAMFILES || "C:" + String.fromCharCode(92) + "Program Files"
  const pf86 = env["PROGRAMFILES(X86)"] || env["ProgramFiles(x86)"] || "C:" + String.fromCharCode(92) + "Program Files (x86)"
  const under = (root, parts) => (root ? join(root, ...parts) : "")
  return [
    under(pf, ["Google", "Chrome", "Application", "chrome.exe"]),
    under(pf86, ["Google", "Chrome", "Application", "chrome.exe"]),
    under(local, ["Google", "Chrome", "Application", "chrome.exe"]),
    under(home, ["scoop", "apps", "chromium", "current", "chrome.exe"]),
    under(local, ["Chromium", "Application", "chrome.exe"]),
    under(pf, ["Chromium", "Application", "chrome.exe"]),
    under(pf86, ["Chromium", "Application", "chrome.exe"]),
    under(home, ["Chromium", "chrome.exe"]),
    under(pf, ["BraveSoftware", "Brave-Browser", "Application", "brave.exe"]),
    under(pf86, ["BraveSoftware", "Brave-Browser", "Application", "brave.exe"]),
    under(local, ["BraveSoftware", "Brave-Browser", "Application", "brave.exe"]),
    under(local, ["Vivaldi", "Application", "vivaldi.exe"]),
    under(pf, ["Vivaldi", "Application", "vivaldi.exe"]),
    under(local, ["Programs", "Opera", "opera.exe"]),
    under(roaming, ["Opera Software", "Opera Stable", "opera.exe"]),
    under(local, ["360ChromeX", "Chrome", "Application", "360ChromeX.exe"]),
    under(local, ["360Chrome", "Chrome", "Application", "360chrome.exe"]),
    under(local, ["360Chrome", "Chrome", "Application", "360Chrome.exe"]),
    under(pf, ["360Chrome", "Chrome", "Application", "360chrome.exe"]),
    under(pf86, ["360Chrome", "Chrome", "Application", "360chrome.exe"]),
    under(roaming, ["secoresdk", "360se6", "Application", "360se.exe"]),
    under(local, ["360se", "Application", "360se.exe"]),
    under(local, ["Tencent", "QQBrowser", "Application", "QQBrowser.exe"]),
    under(pf, ["Tencent", "QQBrowser", "QQBrowser.exe"]),
    under(local, ["SogouExplorer", "SogouExplorer.exe"]),
    under(pf, ["SogouExplorer", "SogouExplorer.exe"]),
    under(local, ["2345Explorer", "2345Explorer.exe"]),
    under(local, ["liebao", "liebao.exe"]),
    under(roaming, ["Maxthon3", "Bin", "Maxthon.exe"]),
    under(local, ["UCBrowser", "Application", "UCBrowser.exe"]),
    under(local, ["Quark", "Quark.exe"]),
    under(pf86, ["Microsoft", "Edge", "Application", "Microsoft Edge.exe"]),
    under(pf, ["Microsoft", "Edge", "Application", "Microsoft Edge.exe"]),
    under(pf86, ["Microsoft", "Edge", "Application", "msedge.exe"]),
    under(pf, ["Microsoft", "Edge", "Application", "msedge.exe"]),
  ].filter(Boolean)
}

function registryAppPath(exe) {
  const roots = ["HKCU", "HKLM"]
  const tails = [
    `SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\${exe}`,
    `SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\App Paths\${exe}`,
  ]
  for (const root of roots) {
    for (const tail of tails) {
      try {
        const out = execFileSync("reg", ["query", root + "\\" + tail, "/ve"], {
          encoding: "utf8",
          timeout: 3000,
          windowsHide: true,
          stdio: ["ignore", "pipe", "ignore"],
        })
        const match = /REG_SZ\s+(.+?)\s*$/m.exec(out)
        const file = match?.[1]?.trim().replace(/^"|"$/g, "")
        if (file && existsSync(file)) return file
      } catch {}
    }
  }
  return ""
}

// 纯函数方便单测：环境变量优先，其次注册表，最后常见安装目录。
function browserCandidates(platform = process.platform, env = process.env, lookup = registryAppPath) {
  const candidates = []
  const override = String(env.MAGPIE_LINGXI_BROWSER || "").trim()
  if (override) candidates.push(override)

  if (platform === "darwin") {
    candidates.push(
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
      "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
      "/Applications/Vivaldi.app/Contents/MacOS/Vivaldi",
      "/Applications/QQ浏览器.app/Contents/MacOS/QQBrowser",
    )
  } else if (platform === "win32") {
    candidates.push(...winBrowserPaths(env))
    for (const exe of WIN_REGISTRY_BROWSERS) {
      const found = lookup(exe)
      if (found) candidates.push(found)
    }
  } else {
    for (const name of ["google-chrome", "chromium", "chromium-browser", "microsoft-edge", "brave-browser", "vivaldi"]) {
      const found = which(name)
      if (found) candidates.push(found)
    }
  }
  return [...new Set(candidates)]
}

function findBrowser() {
  // 常见安装路径先查（快）；一个都没有才去翻注册表（最多 60 次 reg，慢）。
  const plain = browserCandidates(process.platform, process.env, () => "")
  const hit = plain.find((file) => existsSync(file))
  if (hit) return hit
  if (process.platform === "win32") {
    for (const exe of WIN_REGISTRY_BROWSERS) {
      const found = registryAppPath(exe)
      if (found) return found
    }
  }
  return ""
}

async function waitForFile(file, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (existsSync(file)) return true
    await sleep(200)
  }
  return false
}

function cdpConnect(url) {
  return new Promise((resolve, reject) => {
    if (typeof WebSocket !== "function") {
      reject(new Error("当前运行时不支持浏览器自动登录"))
      return
    }
    const socket = new WebSocket(url)
    const pending = new Map()
    let next = 1
    socket.onopen = () => resolve({
      send(method, params) {
        const id = next++
        return new Promise((res, rej) => {
          pending.set(id, { res, rej })
          socket.send(JSON.stringify({ id, method, params: params ?? {} }))
        })
      },
      close() { try { socket.close() } catch {} },
    })
    socket.onmessage = (event) => {
      let message
      try { message = JSON.parse(typeof event.data === "string" ? event.data : String(event.data)) } catch { return }
      const waiter = message?.id ? pending.get(message.id) : null
      if (!waiter) return
      pending.delete(message.id)
      if (message.error) waiter.rej(new Error(message.error.message || "CDP 错误"))
      else waiter.res(message.result)
    }
    socket.onerror = () => reject(new Error("连不上浏览器的调试端口"))
  })
}

async function cookiesOf(port) {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`)
  if (!response.ok) return []
  const targets = await response.json()
  const page = Array.isArray(targets) ? targets.find((target) => target.type === "page") : null
  if (!page?.webSocketDebuggerUrl) return []
  const client = await cdpConnect(page.webSocketDebuggerUrl)
  try {
    await client.send("Network.enable")
    const result = await client.send("Network.getAllCookies")
    return Array.isArray(result?.cookies) ? result.cookies : []
  } finally {
    client.close()
  }
}

async function chromiumLogin({ browser, url, timeoutMs = 5 * 60 * 1000, signal }) {
  const profile = mkdtempSync(join(tmpdir(), "magpie-lingxi-"))
  const child = spawn(browser, [
    `--user-data-dir=${profile}`,
    "--remote-debugging-port=0",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-features=Translate",
    url,
  ], { stdio: "ignore" })
  try {
    const portFile = join(profile, "DevToolsActivePort")
    if (!(await waitForFile(portFile, 15000))) throw new Error("浏览器没有打开调试端口")
    const port = Number(readFileSync(portFile, "utf8").split(/\r?\n/)[0])
    if (!Number.isFinite(port) || port <= 0) throw new Error("浏览器调试端口无效")
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      signal?.throwIfAborted()
      let cookies = []
      try { cookies = await cookiesOf(port) } catch {}
      const sid = cookies.find((cookie) => cookie?.name === "wps_sid" && String(cookie.value || "").trim())
      if (sid) {
        const uid = cookies.find((cookie) => cookie?.name === "uid")?.value || ""
        return { sid: String(sid.value).trim(), uid: String(uid || "").trim() }
      }
      await sleep(1500)
    }
    throw new Error("等待登录超时")
  } finally {
    try { child.kill("SIGTERM") } catch {}
    setTimeout(() => { try { rmSync(profile, { recursive: true, force: true }) } catch {} }, 1500)
  }
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.on("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port
      server.close(() => resolve(port))
    })
  })
}

// 读当前会话所有窗口的 Cookie（登录可能开弹窗/换 tab，只看当前窗口会漏）。
async function sessionCookies(base, id) {
  const seen = new Map()
  const handlesResponse = await fetch(`${base}/session/${id}/window/handles`).catch(() => null)
  const handlesPayload = handlesResponse ? await handlesResponse.json().catch(() => ({})) : {}
  const handles = Array.isArray(handlesPayload?.value) ? handlesPayload.value : []
  const currentResponse = await fetch(`${base}/session/${id}/window`).catch(() => null)
  const current = currentResponse ? (await currentResponse.json().catch(() => ({})))?.value : undefined
  const read = async () => {
    const response = await fetch(`${base}/session/${id}/cookie`).catch(() => null)
    const payload = response ? await response.json().catch(() => ({})) : {}
    for (const cookie of Array.isArray(payload?.value) ? payload.value : []) {
      seen.set(`${cookie.name}|${cookie.domain}`, cookie)
    }
  }
  if (handles.length === 0) {
    await read()
    return [...seen.values()]
  }
  for (const handle of handles) {
    if (handle !== current) {
      await fetch(`${base}/session/${id}/window`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ handle }),
      }).catch(() => {})
    }
    await read()
  }
  if (current) {
    await fetch(`${base}/session/${id}/window`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ handle: current }),
    }).catch(() => {})
  }
  return [...seen.values()]
}

// Safari 没有 CDP；用系统自带的 safaridriver（W3C WebDriver）读 Cookie。
// 需要一次性开启：Safari 设置 → 高级 → 显示网页开发者功能，然后
// 开发 → 允许远程自动化（或 sudo safaridriver --enable）。
async function safariLogin({ url, timeoutMs = 5 * 60 * 1000, signal }) {
  const driver = "/usr/bin/safaridriver"
  if (!existsSync(driver)) throw new Error("没有找到 safaridriver")
  const port = await freePort()
  const child = spawn(driver, ["-p", String(port)], { stdio: "ignore" })
  const base = `http://127.0.0.1:${port}`
  let sessionId = ""
  try {
    const deadline = Date.now() + 20000
    let ready = false
    while (Date.now() < deadline) {
      try {
        const response = await fetch(`${base}/status`)
        if (response.ok) { ready = true; break }
      } catch {}
      await sleep(300)
    }
    if (!ready) throw new Error("safaridriver 没有启动")

    const created = await fetch(`${base}/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ capabilities: { alwaysMatch: { browserName: "safari" } } }),
    })
    const createdBody = await created.json().catch(() => ({}))
    if (!created.ok) {
      const message = createdBody?.value?.message || `HTTP ${created.status}`
      throw new Error(`Safari 自动化未开启：${message}（Safari 设置 → 高级 → 显示网页开发者功能，然后 开发 → 允许远程自动化；或 sudo safaridriver --enable）`)
    }
    sessionId = createdBody?.value?.sessionId || createdBody?.sessionId || ""
    if (!sessionId) throw new Error("Safari 没有返回 sessionId")

    await fetch(`${base}/session/${sessionId}/url`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    })

    const end = Date.now() + timeoutMs
    while (Date.now() < end) {
      signal?.throwIfAborted()
      const cookies = await sessionCookies(base, sessionId).catch(() => [])
      const sid = cookies.find((cookie) => cookie?.name === "wps_sid" && String(cookie.value || "").trim())
      if (sid) {
        const uid = cookies.find((cookie) => cookie?.name === "uid")?.value || ""
        return { sid: String(sid.value).trim(), uid: String(uid || "").trim() }
      }
      await sleep(1500)
    }
    throw new Error("等待登录超时")
  } finally {
    if (sessionId) {
      try { await fetch(`${base}/session/${sessionId}`, { method: "DELETE" }) } catch {}
    }
    try { child.kill("SIGTERM") } catch {}
  }
}

async function browserLogin({ url, timeoutMs = 5 * 60 * 1000, signal }) {
  const chromium = findBrowser()
  if (chromium) return chromiumLogin({ browser: chromium, url, timeoutMs, signal })
  // Safari 的 WebDriver 窗口在自动化期间会锁住键盘，用户没法手动输入；
  // 而且它用的是临时配置，读不到现有登录态 —— 自动登录这条路对 Safari 不成立。
  // 需要自动登录请装 Chrome / Edge；否则用页面的手动粘贴。
  throw new Error(
    "没有找到 Chromium 内核浏览器（Chrome / Edge / 360极速 / QQ / Brave 等）。" +
    "任一都可：装一个，或用 MAGPIE_LINGXI_BROWSER 指向它的 exe；也可以直接在下方粘贴 Cookie。" +
    "360 安全浏览器可能不支持调试端口，建议 360极速或 Chrome/Edge"
  )
}

// 与客户端 app-server 发出的请求头一致（安装包 1.3.31 取证）：
// X-Client-Type / X-Client-Lang / X-Cc-Agent-Type + 每个 run 的 X-Cc-Session-ID / X-Cc-Run-ID。
// X-Cc-Region 只在账号登录时从 Cookie 里带了 copilot_server_branch 才加。
function requestId() {
  try {
    return globalThis.crypto.randomUUID()
  } catch {
    return `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`
  }
}

function agentHeaders(cookie, base, extra = {}) {
  const region = cookieRegion(cookie)
  return {
    Cookie: clientCookie(cookie),
    "Content-Type": "application/json",
    "X-Client-Type": CLIENT_TYPE,
    "X-Client-Lang": CLIENT_LANG,
    "X-Cc-Agent-Type": CLIENT_TYPE,
    "X-Request-Id": requestId(),
    ...(region ? { "X-Cc-Region": region } : {}),
    Referer: `${base}/`,
    "User-Agent": UA,
    ...extra,
  }
}

// 灰度区域：客户端从 cookie `copilot_server_branch` 读取，跟着 query/头一起发。
function cookieRegion(cookie) {
  for (const part of String(cookie ?? "").split(";")) {
    const item = part.trim()
    if (item.startsWith("copilot_server_branch=")) return item.slice("copilot_server_branch=".length)
  }
  return ""
}

function wireModel(value) {
  let model = String(value ?? "").trim()
  model = model.replace(/^wps-lingxi\//, "").replace(/^lingxi[/-]/, "")
  return !model || model === "default" ? "deepseek-v4.1-flash" : model
}

// 上游的 schema 转换器只认最朴素的 JSON Schema（实测逐条验证）：
// anyOf / oneOf / allOf / not / const / $ref 会让 chat 直接回 AIError（AI服务异常），
// type 用数组则回 400 InvalidArgument —— ZCode 的 MCP 工具（documents/pdf 的 report_view）就带 anyOf，
// 整条请求因此必挂。这里把这些压平成上游认的形状：宁可参数变宽，也别让对话失败。

function resolveSchemaRef(ref, root, seen) {
  const pointer = String(ref ?? "")
  if (!pointer.startsWith("#/") || seen.has(pointer)) return {}
  const target = pointer.slice(2).split("/").reduce(
    (node, key) => node?.[key.replace(/~1/g, "/").replace(/~0/g, "~")],
    root,
  )
  if (!target || typeof target !== "object") return {}
  seen.add(pointer)
  const resolved = sanitizeSchema(target, root, seen)
  seen.delete(pointer)
  return resolved
}

function sanitizeSchema(node, root = node, seen = new Set()) {
  if (Array.isArray(node)) return node.map((item) => sanitizeSchema(item, root, seen))
  if (!node || typeof node !== "object") return node

  const out = {}
  const anyOf = []
  const allOf = []
  for (const [key, value] of Object.entries(node)) {
    if (key === "anyOf" || key === "oneOf") {
      if (Array.isArray(value)) anyOf.push(...value)
      continue
    }
    if (key === "allOf") {
      if (Array.isArray(value)) allOf.push(...value)
      continue
    }
    if (key === "not" || key === "$defs" || key === "definitions") continue
    if (key === "const") { out.enum = [value]; continue }
    if (key === "$ref") { Object.assign(out, resolveSchemaRef(value, root, seen)); continue }
    // properties/patternProperties 是「名字到 schema」的表，本身不是 schema，别给它补 type。
    if ((key === "properties" || key === "patternProperties") && value && typeof value === "object") {
      out[key] = Object.fromEntries(
        Object.entries(value).map(([name, schema]) => [name, sanitizeSchema(schema, root, seen)]),
      )
      continue
    }
    out[key] = sanitizeSchema(value, root, seen)
  }

  // allOf 全都要满足，合并；anyOf/oneOf 只能留一支，取信息量最大的，节点自身的键最优先。
  const both = allOf.length ? Object.assign({}, ...allOf.map((branch) => sanitizeSchema(branch, root, seen))) : {}
  const picked = anyOf
    .map((branch) => sanitizeSchema(branch, root, seen))
    .filter((branch) => branch && branch.type !== "null")
    .reduce((best, branch) => (!best || schemaRank(branch) > schemaRank(best) ? branch : best), null)
  const merged = { ...both, ...picked, ...out }

  if (Array.isArray(merged.type)) {
    const type = merged.type.find((item) => item !== "null")
    if (type) merged.type = type
    else delete merged.type
  }
  if (merged.type === "null") delete merged.type
  // 上游要求每个 schema 都带 type：空的、只有 description 的、只有 enum 的都会回 AIError。
  if (!merged.type) merged.type = inferSchemaType(merged)
  return merged
}

// anyOf/oneOf 里可能有两个都非 null 的分支（如 string | object）。上游只认单一 type，
// 只能留一支：选信息量最大的那个——对象分支通常带 properties，丢了模型就不知道字段名，
// 比退化成字符串更难用。
function schemaRank(node) {
  if (node.type === "object" || node.properties) return 3
  if (node.type === "array" || node.items) return 2
  return 1
}

function inferSchemaType(node) {
  if (node.properties || node.required || node.additionalProperties) return "object"
  if (node.items) return "array"
  const sample = Array.isArray(node.enum) ? node.enum[0] : undefined
  if (typeof sample === "number") return "number"
  if (typeof sample === "boolean") return "boolean"
  return "string"
}

function filterTools(value) {
  const items = Array.isArray(value) ? value : []
  const kept = []
  let dropped = 0
  for (const item of items) {
    const name = item?.function?.name
    if (item?.type !== "function" || typeof name !== "string" || !name.trim()) { dropped += 1; continue }
    const parameters = item.function.parameters
    kept.push(parameters && typeof parameters === "object"
      ? { ...item, function: { ...item.function, parameters: sanitizeSchema(parameters) } }
      : item)
  }
  return { tools: kept, dropped }
}

function lastUserText(body) {
  const messages = Array.isArray(body?.messages) ? body.messages : []
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i]
    if (message?.role !== "user") continue
    const content = message.content
    const text = typeof content === "string"
      ? content
      : Array.isArray(content)
        ? content.map((part) => (typeof part?.text === "string" ? part.text : "")).join(" ")
        : ""
    const trimmed = text.trim()
    if (trimmed) return trimmed.slice(0, 60)
  }
  return "灵犀会话"
}

// ── agent-runtime 直连平面（会话 + run + chat/completions）──────────────
// 计费按 run：一个 run 内多次调用只扣一次智点，所以按「账号 × 模型」
// 缓存 session/run，TTL 一小时；上游报 SQLNoRows / 会话不存在时重建一次。

const runs = new Map()

function looksLikeStaleRun(message) {
  const text = String(message ?? "").toLowerCase()
  return text.includes("sqlnorows") || text.includes("no rows") ||
    String(message).includes("会话不存在") || String(message).includes("数据不存在") ||
    (text.includes("session") && text.includes("not found"))
}

async function postJson(url, cookie, base, body, signal, extra = {}) {
  const response = await fetch(url, {
    method: "POST",
    headers: agentHeaders(cookie, base, extra),
    body: JSON.stringify(body ?? {}),
    signal,
  })
  const text = await response.text().catch(() => "")
  let payload = {}
  try { payload = text ? JSON.parse(text) : {} } catch { payload = {} }
  if (!response.ok) {
    const detail = envelopeError(payload) || textOfPayload(payload) || text.slice(0, 200)
    const hint = response.status === 401 || response.status === 403 ? "（WPS 登录态可能已失效，请重新粘贴 Cookie）" : ""
    const error = new Error(`WPS 灵犀上游返回 ${response.status}${hint}${detail ? `：${detail}` : ""}`)
    error.status = response.status
    throw error
  }
  const envelope = envelopeError(payload)
  if (envelope) {
    const error = new Error(`WPS 灵犀上游返回错误：${envelope}`)
    error.status = response.status
    throw error
  }
  return payload
}

async function createCoworkSession(base, cookie, signal, extra = {}) {
  const payload = await postJson(`${base}${AGENT_SESSIONS_PATH}`, cookie, base, {
    session_type: "cowork_client",
    agent_version: 2,
    ...extra,
    env: {
      device_id: DEVICE_ID,
      device_name: userInfo().username || "magpie",
      work_space_dir: tmpdir(),
    },
  }, signal)
  const id = String(payload?.data?.session_id ?? "").trim()
  if (!id) throw new Error("灵犀未返回 session_id")
  return id
}

async function createCreditsRun(base, cookie, sessionId, model, title, signal, { currentMode, clientType } = {}) {
  const payload = await postJson(`${base}${AGENT_RUNS_PATH}`, cookie, base, {
    client_request_id: String(Date.now()),
    session_id: sessionId,
    model_provider: "lingxi",
    model_id: model,
    ...(clientType ? { client_type: clientType } : {}),
    agent_input: {
      text: title,
      files: [],
      file_ids: [],
      expect_model: model,
      refs: [],
      permission_mode: "default",
      current_mode: currentMode || "agent",
      browser_plugin_enabled: false,
    },
  }, signal)
  const id = String(payload?.data?.run_id ?? "").trim()
  if (!id) throw new Error("灵犀未返回 run_id")
  return { runId: id, groupId: String(payload?.data?.group_id ?? id) }
}

async function ensureRun(cookie, key, model, title, signal, extra = {}, runExtra = {}) {
  const hit = runs.get(key)
  if (hit && Date.now() - hit.at < RUN_TTL_MS) return hit
  let lastError
  // 先试 wps.cn（reference 实测的平面），404/401 再回落登录用的 kdocs 域名。
  for (const base of [BASE, KDOCS_BASE]) {
    try {
      const sessionId = await createCoworkSession(base, cookie, signal, extra)
      const { runId, groupId } = await createCreditsRun(base, cookie, sessionId, model, title, signal, runExtra)
      const run = { base, sessionId, runId, groupId, at: Date.now() }
      runs.set(key, run)
      return run
    } catch (error) {
      lastError = error
    }
  }
  throw lastError ?? new Error("WPS 灵犀未能建立会话")
}

const byteLength = (text) => Buffer.byteLength(String(text ?? ""), "utf8")

// 按字节切，不能按字符切：中文一个字 3 字节，按字符切会超限 3 倍。
function sliceBytes(text, maxBytes, fromEnd = false) {
  if (maxBytes <= 0) return ""
  let lo = 0
  let hi = text.length
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)
    const piece = fromEnd ? text.slice(text.length - mid) : text.slice(0, mid)
    if (byteLength(piece) <= maxBytes) lo = mid
    else hi = mid - 1
  }
  return fromEnd ? text.slice(text.length - lo) : text.slice(0, lo)
}

function headTailBytes(text, limit) {
  const headBytes = Math.floor(limit * 0.6)
  const tailBytes = limit - headBytes
  return `${sliceBytes(text, headBytes)}\n…[本条消息过长，已截断（原 ${byteLength(text)} 字节）]…\n${sliceBytes(text, tailBytes, true)}`
}

function elideMessage(message) {
  const content = message?.content
  if (typeof content === "string") {
    return byteLength(content) > MAX_MESSAGE_BYTES
      ? { ...message, content: headTailBytes(content, MAX_MESSAGE_BYTES) }
      : message
  }
  if (Array.isArray(content)) {
    let changed = false
    const parts = content.map((part) => {
      if (part && typeof part.text === "string" && byteLength(part.text) > MAX_MESSAGE_BYTES) {
        changed = true
        return { ...part, text: headTailBytes(part.text, MAX_MESSAGE_BYTES) }
      }
      return part
    })
    return changed ? { ...message, content: parts } : message
  }
  return message
}

// 上游按 token 限量，超了整轮 400。这里按字节保守裁剪：
//   1. 先掐长条（单条超 MAX_MESSAGE_KB 的掐头去尾）；
//   2. 还超就从最老的一端整条丢，但开头的 system 消息一律保留（工具协议和 agent 指令在里面）；
//   3. 丢完如果头一条是 tool 结果，继续丢 —— tool_calls 和它的结果必须成对，孤儿结果会被上游拒。
function fitAgentBody(body) {
  if (!Array.isArray(body.messages) || body.messages.length <= 1) return { dropped: 0, elided: 0 }
  const fixed = byteLength(JSON.stringify({ ...body, messages: [] }))
  const sizeOf = (list) => fixed + list.reduce((sum, m) => sum + byteLength(JSON.stringify(m)), 0)

  let elided = 0
  if (sizeOf(body.messages) > MAX_PROMPT_BYTES) {
    const next = body.messages.map((m) => elideMessage(m))
    elided = next.reduce((n, m, i) => n + (m === body.messages[i] ? 0 : 1), 0)
    if (elided) body.messages = next
  }
  if (sizeOf(body.messages) <= MAX_PROMPT_BYTES) return { dropped: 0, elided }

  const sizes = body.messages.map((m) => byteLength(JSON.stringify(m)))
  let total = fixed + sizes.reduce((a, b) => a + b, 0)
  let head = 0
  while (head < body.messages.length - 1 && body.messages[head]?.role === "system") head++
  let start = head
  while (total > MAX_PROMPT_BYTES && start < body.messages.length - 1) {
    total -= sizes[start]
    start++
  }
  while (start < body.messages.length - 1 && body.messages[start]?.role === "tool") {
    total -= sizes[start]
    start++
  }

  // 标记本身也占字节，得算进去；不够就再多丢一条，直到真的装得下。
  const note = (count) => ({
    role: "system",
    content: `[历史已压缩：更早的 ${count} 条消息被省略（上游单次请求长度上限 ${MAX_PROMPT_KB}KB）]`,
  })
  const fits = (list) => fixed + list.reduce((sum, m) => sum + byteLength(JSON.stringify(m)), 0) <= MAX_PROMPT_BYTES

  while (start - head > 0) {
    const candidate = [...body.messages.slice(0, head), note(start - head), ...body.messages.slice(start)]
    if (fits(candidate)) {
      body.messages = candidate
      return { dropped: start - head, elided }
    }
    if (start >= body.messages.length - 1) break
    start++
    while (start < body.messages.length - 1 && body.messages[start]?.role === "tool") start++
  }
  return { dropped: 0, elided }
}

function buildAgentBody(body, model) {
  const { tools } = filterTools(body.tools)
  const out = { stream: true, model, messages: Array.isArray(body.messages) ? body.messages : [] }
  if (tools.length) {
    out.tools = tools
    if (body.tool_choice != null) out.tool_choice = body.tool_choice
  }
  if (typeof body.temperature === "number") out.temperature = body.temperature
  if (Number.isInteger(body.max_tokens) && body.max_tokens > 0) out.base_llm_arguments = { max_tokens: body.max_tokens }
  const effort = typeof body.reasoning_effort === "string" ? body.reasoning_effort.trim() : ""
  if (effort) {
    out.reasoning_effort = effort
    out.llm_arguments = { reasoning_effort: effort }
  }
  const fitted = fitAgentBody(out)
  if (fitted.dropped || fitted.elided) {
    console.warn(
      `[magpie-wps-lingxi] 提示词超过 ${MAX_PROMPT_KB}KB，已省略 ${fitted.dropped} 条历史、截断 ${fitted.elided} 条长消息`
    )
  }
  return out
}

// 上游帧：data:{"code":"Success","usage":{…},"choices":[{"text","reasoning_content","tool_calls","finish_reason"}]}
// 没有 [DONE]，靠 finish_reason 收尾；正文在 choices[].text（不是 delta.content）。
// 上游 usage 的缓存/推理字段名和 OpenAI 不完全一致（cached_tokens / prompt_tokens_details），
// 这里统一成 magpie 认的形状，别把缓存命中丢掉。
function normalizeUsage(usage) {
  if (!usage || typeof usage !== "object") return null
  const prompt = Number(usage.prompt_tokens ?? 0) || 0
  const completion = Number(usage.completion_tokens ?? 0) || 0
  const out = {
    prompt_tokens: prompt,
    completion_tokens: completion,
    // 上游的 total_tokens 不是本轮用量，而是「当前上下文大小」
    // （实测 42240 cache + 1097 prompt + 226 completion = 43563）：原样透传会让客户端
    // 拿它当每轮用量累加，会话总量虚高几十倍、TPS 算出两万多 tok/s。
    // 和 magpie 其它插件一致：自己按 prompt + completion 算。
    total_tokens: prompt + completion,
  }
  const cached = Number(usage.cached_tokens ?? usage.prompt_tokens_details?.cached_tokens ?? 0)
  if (cached > 0) out.prompt_tokens_details = { cached_tokens: cached }
  const reasoning = Number(usage.reasoning_tokens ?? usage.completion_tokens_details?.reasoning_tokens ?? 0)
  if (reasoning > 0) out.completion_tokens_details = { reasoning_tokens: reasoning }
  return out
}

class LingxiTranslator {
  constructor(model) {
    this.model = model
    this.created = Math.floor(Date.now() / 1000)
    this.id = `chatcmpl-lingxi-${this.created}`
    this.buffer = ""
    this.started = false
    this.sawFinish = false
    this.finished = false
    this.finishReason = ""
    this.usage = null
  }
  frame(value) { return `data: ${JSON.stringify(value)}\n\n` }
  delta(delta) {
    return this.frame({
      id: this.id, object: "chat.completion.chunk", created: this.created, model: this.model,
      choices: [{ index: 0, delta, finish_reason: null }],
    })
  }
  usageFrame() {
    return this.frame({ id: this.id, object: "chat.completion.chunk", created: this.created, model: this.model, choices: [], usage: this.usage })
  }
  start(out) {
    if (this.started) return
    this.started = true
    out.push(this.delta({ role: "assistant", content: "" }))
  }
  push(text) {
    const out = []
    this.buffer += text
    let index
    while ((index = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, index).replace(/\r$/, "")
      this.buffer = this.buffer.slice(index + 1)
      this.consume(line, out)
      if (this.finished) break
    }
    return out
  }
  finish() {
    if (this.finished) return []
    const out = []
    if (this.buffer.trim()) {
      this.consume(this.buffer.replace(/\r$/, ""), out)
      this.buffer = ""
    }
    if (this.finished) return out
    this.finished = true
    if (!this.sawFinish) throw new Error("灵犀上游流在完成事件之前结束（响应被截断）")
    if (this.usage) out.push(this.usageFrame())
    out.push("data: [DONE]\n\n")
    return out
  }
  consume(raw, out) {
    if (this.finished) return
    const line = String(raw).trim()
    if (!line || line.startsWith(":") || line.startsWith("event:")) return
    const payload = line.startsWith("data:") ? line.slice(5).trim() : line
    if (!payload) return
    if (payload === "[DONE]") { this.sawFinish = true; return }
    let frame
    try { frame = JSON.parse(payload) } catch { return }
    this.consumeFrame(frame, out)
  }
  consumeFrame(frame, out) {
    const code = typeof frame?.code === "string" ? frame.code : ""
    if (code && code.toLowerCase() !== "success") {
      this.finished = true
      throw new Error(`灵犀上游返回 ${code}：${textOfPayload(frame) || "上游错误"}`)
    }
    const usage = normalizeUsage(frame?.usage)
    if (usage) this.usage = usage
    const choices = Array.isArray(frame?.choices) ? frame.choices : []
    for (const choice of choices) {
      const text = typeof choice?.text === "string" ? choice.text : ""
      const reasoning = typeof choice?.reasoning_content === "string" ? choice.reasoning_content : ""
      const calls = Array.isArray(choice?.tool_calls) ? choice.tool_calls : []
      if (text || reasoning || calls.length) {
        this.start(out)
        const delta = {}
        if (text) delta.content = text
        if (reasoning) delta.reasoning_content = reasoning
        if (calls.length) {
          delta.tool_calls = calls.map((call, index) => {
            const item = { index: Number.isInteger(call?.index) ? call.index : index }
            if (typeof call?.id === "string" && call.id) { item.id = call.id; item.type = "function" }
            const fn = {}
            if (typeof call?.function?.name === "string" && call.function.name) fn.name = call.function.name
            if (typeof call?.function?.arguments === "string" && call.function.arguments) fn.arguments = call.function.arguments
            item.function = fn
            return item
          })
        }
        out.push(this.delta(delta))
      }
      const reason = typeof choice?.finish_reason === "string" ? choice.finish_reason.trim() : ""
      if (reason) { this.sawFinish = true; this.finishReason = reason }
    }
    if (this.sawFinish && !this.finished) {
      this.finished = true
      out.push(this.frame({
        id: this.id, object: "chat.completion.chunk", created: this.created, model: this.model,
        choices: [{ index: 0, delta: {}, finish_reason: this.finishReason || "stop" }],
      }))
      if (this.usage) out.push(this.usageFrame())
      out.push("data: [DONE]\n\n")
    }
  }
}

function foldFrames(frames) {
  let content = ""
  let reasoning = ""
  let finish = "stop"
  let usage = null
  const calls = new Map()
  for (const raw of frames) {
    const text = String(raw).replace(/^data:\s*/, "").trim()
    if (!text || text === "[DONE]") continue
    let value
    try { value = JSON.parse(text) } catch { continue }
    if (value?.error) throw new Error(value.error.message || "灵犀上游错误")
    const normalized = normalizeUsage(value?.usage)
    if (normalized) usage = normalized
    const choice = value?.choices?.[0]
    if (!choice) continue
    const delta = choice.delta || {}
    if (typeof delta.content === "string") content += delta.content
    if (typeof delta.reasoning_content === "string") reasoning += delta.reasoning_content
    for (const call of Array.isArray(delta.tool_calls) ? delta.tool_calls : []) {
      const index = Number.isInteger(call.index) ? call.index : 0
      const current = calls.get(index) || { id: "", type: "function", function: { name: "", arguments: "" } }
      if (call.id) current.id = call.id
      if (call.function?.name) current.function.name = call.function.name
      if (call.function?.arguments) current.function.arguments += call.function.arguments
      calls.set(index, current)
    }
    if (choice.finish_reason) finish = choice.finish_reason
  }
  const message = { role: "assistant", content }
  if (reasoning) message.reasoning_content = reasoning
  if (calls.size) message.tool_calls = [...calls.entries()].sort((a, b) => a[0] - b[0]).map(([, call]) => call)
  const result = {
    id: `chatcmpl-lingxi-${Date.now()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: "",
    choices: [{ index: 0, message, finish_reason: finish }],
  }
  if (usage) result.usage = usage
  return result
}

async function requestAgent(cookie, run, payload, signal, clientType) {
  const response = await fetch(`${run.base}${AGENT_CHAT_PATH}`, {
    method: "POST",
    headers: agentHeaders(cookie, run.base, {
      "x-cc-session-id": run.sessionId,
      "x-cc-run-id": run.runId,
      ...(clientType ? { "X-Client-Type": clientType } : {}),
    }),
    body: JSON.stringify(payload),
    signal,
  })
  if (!response.ok) {
    const text = await response.text().catch(() => "")
    const error = new Error(`WPS 灵犀上游返回 ${response.status}${text ? `：${text.slice(0, 200)}` : ""}`)
    error.status = response.status
    throw error
  }
  if (!response.body) throw new Error("WPS 灵犀上游没有返回响应体")
  return response
}

// magpie 用状态码区分「模型级错误」和「登录失效」：模型/参数问题必须是 404，
// 只有明确的鉴权失败才给 401（否则会把账号标成未登录、从路由里摘掉）。
function chatErrorStatus(error) {
  const status = Number(error?.status) || 0
  const text = String(error?.message || "")
  if (status === 401 || status === 403) {
    return /unauthor|登录|凭据|credential|cookie|sid/i.test(text) ? 401 : 404
  }
  if (status === 400 || status === 404 || status === 422) return 404
  return status >= 500 ? status : 502
}

async function agentChat({ cookie, body, stream, requestedModel, signal, errorResponse, clientType, sessionMode }) {
  const key = `${identityOf(cookie)}|${requestedModel}|${clientType || ""}|${sessionMode || ""}`
  const payload = buildAgentBody(body, requestedModel)
  const sessionExtra = {
    ...(clientType ? { client_type: clientType } : {}),
    ...(sessionMode ? { session_mode: sessionMode } : {}),
  }
  const runExtra = {
    ...(clientType ? { clientType } : {}),
    ...(sessionMode === "expert" ? { currentMode: "expert" } : {}),
  }
  let run = await ensureRun(cookie, key, requestedModel, lastUserText(body), signal, sessionExtra, runExtra)
  let response
  try {
    response = await requestAgent(cookie, run, payload, signal, clientType)
  } catch (error) {
    if (!looksLikeStaleRun(error.message)) throw error
    runs.delete(key)
    run = await ensureRun(cookie, key, requestedModel, lastUserText(body), signal, sessionExtra, runExtra)
    response = await requestAgent(cookie, run, payload, signal, clientType)
  }

  const translator = new LingxiTranslator(requestedModel)

  if (!stream) {
    const frames = []
    try {
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        frames.push(...translator.push(decoder.decode(value, { stream: true })))
      }
      frames.push(...translator.push(decoder.decode()))
      frames.push(...translator.finish())
      const folded = foldFrames(frames)
      folded.model = requestedModel
      return new Response(JSON.stringify(folded), { headers: { "Content-Type": "application/json" } })
    } catch (error) {
      signal?.throwIfAborted()
      return errorResponse(error.message, 502)
    }
  }

  const decoder = new TextDecoder()
  const encoder = new TextEncoder()
  let sawError = false
  const fail = (controller, message) => {
    if (sawError) return
    sawError = true
    controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: { message, type: "upstream_error", code: "upstream_error" } })}\n\n`))
  }
  const transform = new TransformStream({
    transform(chunk, controller) {
      try {
        for (const frame of translator.push(decoder.decode(chunk, { stream: true }))) controller.enqueue(encoder.encode(frame))
      } catch (error) {
        fail(controller, error.message)
      }
    },
    flush(controller) {
      try {
        for (const frame of translator.push(decoder.decode())) controller.enqueue(encoder.encode(frame))
        if (!translator.finished) for (const frame of translator.finish()) controller.enqueue(encoder.encode(frame))
      } catch (error) {
        fail(controller, error.message)
      }
    },
  })
  return new Response(response.body.pipeThrough(transform), {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  })
}

// ── 余额与任务领取（签到用）────────────────────────────────────────────

async function balanceTotal(cookie, base = BASE) {
  try {
    const response = await fetch(`${base}/api/public/v1/credits/balance`, { headers: basicHeaders(cookie, base) })
    if (!response.ok) return null
    const payload = await response.json()
    const value = Number(payload?.data?.total_balance ?? payload?.data?.balance)
    return Number.isFinite(value) ? value : null
  } catch {
    return null
  }
}

async function claimTask(cookie, base, key, date) {
  const suffix = date ? `?date=${encodeURIComponent(date)}` : ""
  const response = await fetch(`${base}/api/public/v1/tasks/${encodeURIComponent(key)}/claim${suffix}`, {
    method: "POST",
    headers: { ...basicHeaders(cookie, base), "Content-Type": "application/json" },
    body: "{}",
  })
  if (response.status === 401 || response.status === 403) {
    const error = new Error("WPS 登录态已失效，请重新登录")
    error.status = response.status
    throw error
  }
  const text = await response.text().catch(() => "")
  let payload = {}
  try { payload = text ? JSON.parse(text) : {} } catch { payload = {} }
  if (!response.ok) {
    const error = new Error(textOfPayload(payload) || `HTTP ${response.status}`)
    error.status = response.status
    throw error
  }
  return payload
}

// 领取日期优先取任务里「今天可领」那一档（+08 口径由上游给，别自己算）。
// ── 灵犀任务中心：一次性任务 ──────────────────────────────────────────
//
// 任务中心除每日签到外还有三个一次性任务：
//   try_expert_mode    「完整体验一次灵犀专家模式」  200 智点
//   try_group_chat     「体验一次群聊功能」            400 智点
//   use_lingxi_client  「使用灵犀客户端」              800 智点
//
// 本插件只走 HTTP：上游已判 claimable 的直接领；群聊任务用官方 imchat 接口
// 建群再解散；「专家模式 / 使用客户端」需要一次真实客户端对话（服务端按
// AI Gateway 的会话判定），纯 HTTP 做不到 —— 保持 incomplete，不假装修好了。
// 建群要求会话已完成（execution_status/terminal_status = completed），
// 没有已完成会话时这个任务做不了 —— 返回空串让调用方如实报告。
async function pickGroupChatSession(cookie, base) {
  try {
    // session_list 直接给 status（"finished" = 已完成），不用逐个查详情；
    // 详情接口的字段名与它不同（session_status 数字），别混用。
    const response = await fetch(
      `${base}/api/public/v1/session_list?limit=30&exclude_agent=false&session_types=cowork_client&session_types=cowork_web&session_types=chat`,
      { headers: basicHeaders(cookie, base), signal: AbortSignal.timeout(20000) },
    )
    if (!response.ok) return ""
    const payload = await response.json().catch(() => ({}))
    const list = Array.isArray(payload?.data?.list) ? payload.data.list : []
    for (const session of list) {
      const id = String(session?.session_id ?? "")
      const status = String(session?.status ?? "")
      if (id && (status === "finished" || status === "completed")) return id
    }
    return ""
  } catch {
    return ""
  }
}

async function createGroupChatWith(cookie, base, sessionId) {
  try {
    const response = await fetch(`${base}/api/imchat/v1/channels`, {
      method: "POST",
      headers: { ...basicHeaders(cookie, base), "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: sessionId, expect_model: "plan_pro" }),
      signal: AbortSignal.timeout(20000),
    })
    const text = await response.text().catch(() => "")
    if (!response.ok) return { ok: false, error: `建群 HTTP ${response.status}` }
    let payload = {}
    try { payload = JSON.parse(text) } catch {}
    const channelId = String(payload?.data?.channel_id ?? "")
    return channelId ? { ok: true, channelId } : { ok: false, error: "无 channel_id" }
  } catch (e) {
    return { ok: false, error: String(e?.message || e).slice(0, 80) }
  }
}

/** 解散刚建的群，避免留垃圾群 */
async function deleteGroupChat(cookie, base, channelId) {
  if (!channelId) return
  try {
    await fetch(`${base}/api/imchat/v1/channels/${channelId}`, {
      method: "DELETE",
      headers: basicHeaders(cookie, base),
      signal: AbortSignal.timeout(15000),
    })
  } catch {}
}

/**
 * 把「做不出来」的一次性任务做出来：
 *   一次 app-server 对话 → 同时带出「专家模式」+「客户端」两个任务
 *   复用该会话建群 → 解散 → 重拉任务 → 领取所有 claimable
 * 余额为 0 时不做任何消耗性动作。
 * 返回 { bonus, message }。
 */
// 为了让「专家模式 / 使用客户端」两个任务有机会被服务端判定，发一次最小对话：
//   · 客户端任务：请求头与会话都标成 365wps-lingxi-client
//   · 专家任务：会话参数带 session_mode=expert，agent_input.current_mode=expert
// 纯 HTTP 只能做到这些；是否算完成由服务端决定，所以调用方必须重拉任务看状态，
// 不能假设成功（更不会伪造 claimed）。
// 专家模式走网页端同款 aigc 平面：session_mode:"expert" 建会话 + with_expert:true 发对话。
// 这是渲染层 `createSession(..., {session_mode:"expert"})` 的原样复刻，纯 HTTP。
async function runExpertConversationViaAigc(cookie, base, text = TASK_TEXT) {
  const headers = {
    Cookie: clientCookie(cookie),
    "Content-Type": "application/json",
    "X-Cc-Version": "1",
    "X-Client-Type": "lingxi-web",
    "X-Cc-Entrance": "default",
    "User-Agent": UA,
    Referer: `${base}/`,
  }
  const session = await fetch(`${base}/api/aigc/v3/assistant/sessions`, {
    method: "POST",
    headers,
    body: JSON.stringify({ session_mode: "expert" }),
    signal: AbortSignal.timeout(30000),
  })
  if (!session.ok) return { ok: false, detail: `aigc 会话 HTTP ${session.status}` }
  const sj = await session.json().catch(() => ({}))
  const id = String(sj?.data?.session_id ?? "")
  if (!id) return { ok: false, detail: "aigc 会话未返回 session_id" }

  const payload = {
    question: text,
    expect_model: "plan_pro",
    user_input: { text },
    thinking: "auto",
    with_mcp: false,
    with_expert: true,
  }
  const res = await fetch(`${base}/api/aigc/v3/assistant/sessions/${id}/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(120000),
  })
  const body = await res.text().catch(() => "")
  if (!res.ok) return { ok: false, detail: `aigc 对话 HTTP ${res.status} ${body.slice(0, 120)}` }
  return { ok: true, detail: "aigc 专家对话完成" }
}

// client_type 只能取白名单值（lingxi_claw / pc_web / …）；
// "365wps-lingxi-client" 是服务端从 lingxi_claw 映射出的网关 Product-Name，
// 直接当 client_type 发会话会被上游走到异常路径（实测 AuditFailed）。
// 文案也不能用 "hi" 这类裸词——cowork 平面的风控会拒（实测 AuditFailed）。
const TASK_TEXT = "请用两三句话介绍一下你自己，包括你擅长的任务类型"

async function pickTaskModel(cookie, base) {
  try {
    const skip = new Set(["auto", "plan_pro", "plan_max"])
    const list = await fetchModelPlans(cookie, base)
    const found = Array.isArray(list) ? list.find((m) => m?.id && !skip.has(m.id)) : null
    if (found?.id) return found.id
  } catch {}
  return "deepseek-v4.1-flash"
}

// 会话执行状态是客户端自己上报的（真实内核抓包）：
//   run 创建后 PUT {group_id, status:"running", run_token:group_id, lease_seconds:90}
//   对话完成后 PUT {status:"completed", terminal_reason:"completed"}
// 不上报的话服务端永远不知道会话结束 —— 会话不到 completed，
// 建群 400、任务翻转、会话列表状态全都会卡住。
async function putExecutionStatus(cookie, base, run, status) {
  const body = { group_id: run.groupId, status, run_token: run.groupId }
  if (status === "running") body.lease_seconds = 90
  if (status === "completed") body.terminal_reason = "completed"
  try {
    await fetch(`${base}/api/public/v1/sessions/${run.sessionId}/execution_status`, {
      method: "PUT",
      headers: { Cookie: clientCookie(cookie), "Content-Type": "application/json", "User-Agent": UA },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    })
  } catch {}
}

async function runTaskConversation(cookie, base, { clientType, sessionMode, currentMode, text } = {}) {
  const model = await pickTaskModel(cookie, base)
  const body = {
    stream: false,
    model,
    messages: [{ role: "user", content: text || TASK_TEXT }],
    // 上游按用量扣智点（整数余额）；回答太短可能凑不够 1 智点而不产生计费记录，
    // 给到正常对话的规模（实测真实客户端一句"你好"扣 1 智点）。
    max_tokens: 4096,
  }
  const errorResponse = (message, status = 502, code = "upstream_error") => new Response(
    JSON.stringify({ error: { message, code } }),
    { status, headers: { "Content-Type": "application/json" } },
  )
  try {
    const key = `${identityOf(cookie)}|${model}|${clientType || ""}|${sessionMode || ""}`
    const sessionExtra = {
      ...(clientType ? { client_type: clientType } : {}),
      ...(sessionMode ? { session_mode: sessionMode } : {}),
    }
    const runExtra = {
      ...(clientType ? { clientType } : {}),
      ...(currentMode ? { currentMode } : {}),
    }
    const signal = AbortSignal.timeout(120000)
    let run = await ensureRun(cookie, key, model, text || TASK_TEXT, signal, sessionExtra, runExtra)
    await putExecutionStatus(cookie, base, run, "running")
    let response
    try {
      response = await requestAgent(cookie, run, buildAgentBody(body, model), signal, clientType)
    } catch (error) {
      if (!looksLikeStaleRun(error.message)) throw error
      runs.delete(key)
      run = await ensureRun(cookie, key, model, text || TASK_TEXT, signal, sessionExtra, runExtra)
      response = await requestAgent(cookie, run, buildAgentBody(body, model), signal, clientType)
    }
    const text2 = await response.text().catch(() => "")
    await putExecutionStatus(cookie, base, run, "completed")
    if (!response.ok) return { ok: false, sessionId: run.sessionId, detail: `HTTP ${response.status} ${text2.slice(0, 120)}` }
    return { ok: true, sessionId: run.sessionId, detail: "对话完成" }
  } catch (error) {
    return { ok: false, sessionId: "", detail: String(error?.message || error).slice(0, 140) }
  }
}

// 轮询会话直到服务端把它标成 completed（建群的前置条件）
async function waitSessionCompleted(cookie, base, sessionId, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      // 列表接口的 status（"finished"）是实测可靠字段；详情接口只有数字 session_status。
      const d = await fetch(
        `${base}/api/public/v1/session_list?limit=30&exclude_agent=false&session_types=cowork_client&session_types=cowork_web&session_types=chat`,
        { headers: basicHeaders(cookie, base) },
      )
      if (d.ok) {
        const j = await d.json().catch(() => ({}))
        const list = Array.isArray(j?.data?.list) ? j.data.list : []
        const hit = list.find((x) => String(x?.session_id ?? "") === sessionId)
        const status = String(hit?.status ?? "")
        if (status === "finished" || status === "completed") return true
      }
    } catch {}
    await sleep(3000)
  }
  return false
}

// 昵称：GET /api/public/v1/account/profile → { data:{ id, name, corp_id } }。
// 只有这一个端点回昵称（issue #3 实测：user/info 等全是 404），没有手机号。
const profileCache = new Map()

async function fetchProfile(cookie, base = BASE) {
  const sid = extractSid(cookie)
  const hit = profileCache.get(sid)
  if (hit && Date.now() - hit.at < 60 * 60 * 1000) return hit.value
  try {
    const res = await fetch(`${base}/api/public/v1/account/profile`, { headers: basicHeaders(cookie, base) })
    if (!res.ok) return {}
    const json = await res.json().catch(() => ({}))
    const value = {
      id: String(json?.data?.id ?? ""),
      name: String(json?.data?.name ?? "").trim(),
    }
    profileCache.set(sid, { at: Date.now(), value })
    return value
  } catch {
    return {}
  }
}

// 群聊任务全流程（网页端建群的原样复刻，纯 HTTP/WS）：
//   1. 建 cowork_web 会话
//   2. WSS completions/ws 发一次 user.input（服务端据此把会话标记为真实使用）
//   3. 等 run.end
//   4. POST channels 建群 → 解散（任务判定"创建或加入任意一个群聊"）
// 测试可注入 FakeWS；生产环境用全局 WebSocket（Node 22+ / Bun 均内置）
let groupWSFactory = null

async function runGroupTaskConversation(cookie, base, { text } = {}) {
  const headers = {
    Cookie: clientCookie(cookie),
    "Content-Type": "application/json",
    Accept: "application/json, text/plain, */*",
    "User-Agent": UA,
    Origin: base,
    Referer: `${base}/advanced/chat`,
  }
  let sessionId = ""
  try {
    const s = await fetch(`${base}/api/aioffice/v1/cowork/sessions`, {
      method: "POST", headers, body: JSON.stringify({ session_type: "cowork_web" }),
      signal: AbortSignal.timeout(30000),
    })
    sessionId = String((await s.json().catch(() => ({})))?.data?.session_id ?? "")
    if (!sessionId) return { ok: false, detail: `cowork_web 会话 HTTP ${s.status}` }
  } catch (error) {
    return { ok: false, detail: String(error?.message || error).slice(0, 120) }
  }

  const wsUrl = `${base.replace(/^http/, "ws")}/api/aioffice/v1/sessions/${sessionId}/completions/ws`
  const model = "plan_pro" // 群聊频道固定用 plan_pro（网页端一致）
  const opened = await new Promise((resolve) => {
    const ws = (groupWSFactory || ((u, o) => new WebSocket(u, o)))(wsUrl, { headers: { Cookie: clientCookie(cookie), "User-Agent": UA, Origin: base } })
    const timer = setTimeout(() => { try { ws.close() } catch {} }, 60000)
    ws.onopen = () => {
      ws.send(JSON.stringify({
        event: "user.input",
        data: {
          agent_input: {
            text: text || TASK_TEXT, files: [], refs: [],
            expect_model: model, reasoning_effort: "low",
            permission_mode: "default", current_mode: "agent",
            browser_plugin_enabled: false,
          },
          headers: { client_type: "lingxi_claw", open_position: "clawapp" },
        },
      }))
    }
    ws.onmessage = (ev) => {
      try {
        const j = JSON.parse(ev.data)
        if (j.event === "run.end" || j.event === "stream.end" || j.event === "done") {
          clearTimeout(timer)
          try { ws.close() } catch {}
          resolve(true)
        }
        if (j.event === "error" || j.event === "force.stop") {
          clearTimeout(timer)
          try { ws.close() } catch {}
          resolve(false)
        }
      } catch {}
    }
    ws.onerror = () => { clearTimeout(timer); resolve(false) }
  })
  if (!opened) return { ok: false, detail: "WS 对话未完成" }

  // 建群 → 解散（判定"创建或加入任意一个群聊"）
  const group = await createGroupChatWith(cookie, base, sessionId)
  if (!group.ok) return { ok: false, detail: group.error || "建群失败" }
  await deleteGroupChat(cookie, base, group.channelId)
  return { ok: true, detail: "建群 ✓" }
}

async function completeOneTimeTasks(cookie, base, tasks) {
  const msg = []
  let bonus = 0

  const claimNow = []
  let needGroup = false
  let needExpert = false
  let needClient = false
  for (const task of tasks || []) {
    if (task?.type !== "one_time" || !task?.task_key) continue
    if (task.status === "claimable") claimNow.push(task.task_key)
    else if (task.status === "incomplete") {
      if (task.action === "group_chat") needGroup = true
      else if (task.action === "expert_mode") needExpert = true
      else if (task.action === "download_client") needClient = true
    }
  }

  const bal = await balanceTotal(cookie, base)
  const poor = bal !== null && bal <= 0
  if (poor && (needGroup || needExpert || needClient)) msg.push("余额不足，跳过需要消耗的任务")

  // 一次对话同时命中两个任务：客户端身份（use_lingxi_client）+ 专家模式（try_expert_mode）。
  let convSessionId = ""
  if ((needClient || needExpert) && !poor) {
    const r = await runTaskConversation(cookie, base, {
      clientType: "lingxi_claw",
      sessionMode: needExpert ? "expert" : undefined,
      currentMode: needExpert ? "expert" : undefined,
      text: TASK_TEXT,
    })
    convSessionId = r.sessionId || ""
    if (r.ok) msg.push(needExpert ? "客户端+专家对话 ✓" : "客户端对话 ✓")
    else {
      msg.push(`客户端${needExpert ? "+专家" : ""}对话失败(${r.detail || "?"})`)
      // 兜底：cowork 失败时，专家任务退到网页端同款 aigc 平面再试一次
      if (needExpert) {
        const a = await runExpertConversationViaAigc(cookie, base)
        msg.push(a.ok ? "aigc 专家对话 ✓" : `aigc 专家对话失败(${a.detail || "?"})`)
      }
    }
  }

  // 群聊任务：服务端要求会话先在 WS completions 通道上收到过一次 user.input
  //（真实使用信号，网页端建群前的固定动作），然后才能 POST channels。
  if (needGroup && !poor) {
    const g = await runGroupTaskConversation(cookie, base, { text: TASK_TEXT })
    msg.push(g.ok ? `建群 ✓(${g.detail})` : `建群失败(${g.detail || "?"})`)
  }

  // 重拉任务，领取所有 claimable（含刚被动作带出来的）
  const after = await listTasks(cookie, base)
  const toClaim = after
    ? after.filter((t) => t?.type === "one_time" && t?.task_key && t.status === "claimable").map((t) => t.task_key)
    : claimNow
  const got = []
  for (const key of toClaim) {
    try {
      const claim = await claimTask(cookie, base, key)
      const value = Number(claim?.data?.reward_amount ?? 0)
      if (value > 0) {
        bonus += value
        got.push(key)
      }
    } catch {}
  }
  if (bonus > 0) msg.unshift(`一次性任务 ${got.join("/")} +${bonus} 智点`)
  return { bonus, message: msg.join("；") }
}

/** 查询任务列表（用于领取前重拉状态） */
async function listTasks(cookie, base) {
  try {
    const response = await fetch(`${base}/api/public/v1/tasks`, {
      headers: basicHeaders(cookie, base),
      signal: AbortSignal.timeout(20000),
    })
    if (!response.ok) return null
    const payload = await response.json().catch(() => ({}))
    return Array.isArray(payload?.data?.tasks) ? payload.data.tasks : null
  } catch {
    return null
  }
}

function claimDate(daily) {
  const today = getTodayString()
  const days = daily?.extra?.check_in_days
  if (Array.isArray(days)) {
    // 上游实际只会给 claimed / locked 两种状态，没有 "available"，
    // 所以先按**今天**去匹配那一档；匹配不到再看有没有显式 available 的。
    const hit = days.find((day) => day?.date === today && typeof day?.date === "string")
    if (hit) return hit.date
    const available = days.find((day) => day?.status === "available" && typeof day?.date === "string")
    if (available) return available.date
  }
  return today
}

// 动态拉取网页端可用模型
async function fetchModelPlans(cookie, base = BASE) {
  try {
    const res = await fetch(`${base}/api/aioffice/v1/sessions/plans`, { headers: basicHeaders(cookie, base) })
    if (!res.ok) return []
    const json = await res.json()
    const data = json?.data || {}
    const list = []

    if (data.plans && Array.isArray(data.plans)) {
      for (const p of data.plans) {
        list.push({
          id: p.key,
          name: p.name,
          desc: p.desc,
          multiplier: "模式",
          context: p.max_context_tokens || 1048576,
          max_new_tokens: p.max_new_tokens,
          support_multimodal: p.support_multimodal,
          reasoning_efforts: p.reasoning_efforts || [],
          reasoning: true,
        })
      }
    }

    if (data.models && Array.isArray(data.models)) {
      for (const m of data.models) {
        list.push({
          id: m.key,
          name: m.name,
          desc: m.desc || m.intro || "",
          multiplier: m.multiplier || "",
          context: m.max_context_tokens || 1048576,
          max_new_tokens: m.max_new_tokens,
          support_multimodal: m.support_multimodal,
          reasoning_efforts: m.reasoning_efforts || [],
          reasoning: !!(m.reasoning_efforts && m.reasoning_efforts.length),
        })
      }
    }

    return list
  } catch {
    return []
  }
}

// ── 导入本机灵犀客户端账号 ───────────────────────────────────────────
// 客户端把会话 Cookie 放在 Electron 的 persist 分区里：
//   %APPDATA%\WPS 灵犀\Partitions\<分区>\Network\Cookies
// 值是 Chromium OSCrypt v10（AES-256-GCM），key 由 DPAPI 包在 Local State；
// 2026-10 实测明文前 32 字节是 host 哈希，真正的值从第 33 字节开始。

const DESKTOP_APP_NAME = "WPS 灵犀"

// 自动找客户端数据目录（不同版本/渠道的目录名不一样），不需要用户填路径。
function desktopDataDirs(explicit) {
  if (explicit && String(explicit).trim()) return [String(explicit).trim()]
  const names = [DESKTOP_APP_NAME, "Lingxi", "lingxi", "lingxi-desktop"]
  const roots = []
  if (process.platform === "win32") {
    roots.push(process.env.APPDATA || join(homedir(), "AppData", "Roaming"))
  } else if (process.platform === "darwin") {
    roots.push(join(homedir(), "Library", "Application Support"))
  } else {
    roots.push(join(homedir(), ".config"))
  }
  return roots.flatMap((root) => names.map((name) => join(root, name)))
}

// 一个数据目录下所有可能装着 Cookie 的库（Windows 与 macOS 两种布局都收）：
//   Windows: <dir>/Network/Cookies 与 <dir>/Partitions/<n>/Network/Cookies
//   macOS:   <dir>/Partitions/<n>/Cookies（没有 Network/ 子目录）
function clientCookieDbs(dir) {
  const dbs = []
  const add = (file) => { if (existsSync(file)) dbs.push(file) }
  add(join(dir, "Network", "Cookies"))
  add(join(dir, "Cookies"))
  try {
    for (const name of readdirSync(join(dir, "Partitions"))) {
      add(join(dir, "Partitions", name, "Network", "Cookies"))
      add(join(dir, "Partitions", name, "Cookies"))
    }
  } catch {}
  return dbs
}

// 数据目录判据：Windows 用 Local State 存加密 key，macOS 上没有 —— 判据放宽为
// 「像 Electron profile」：根 Cookies 库、Local State、Partitions 任一。
function looksLikeDataDir(dir) {
  return existsSync(join(dir, "Local State")) || existsSync(join(dir, "Cookies")) || existsSync(join(dir, "Partitions"))
}

// DPAPI(CurrentUser) —— 借 PowerShell 一次，不引入原生依赖。
function dpapiDecrypt(cipher) {
  if (process.platform !== "win32") throw new Error("DPAPI 只在 Windows 上可用（macOS 的客户端 Cookie 是明文存储，不需要解密）")
  const b64 = Buffer.from(cipher).toString("base64")
  const script =
    "Add-Type -AssemblyName System.Security; " +
    "[Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Unprotect(" +
    `[Convert]::FromBase64String('${b64}'), $null, 'CurrentUser'))`
  const out = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
    encoding: "utf8",
    timeout: 20000,
  })
  return Buffer.from(out.trim(), "base64")
}

function chromiumKey(dataDir) {
  const state = JSON.parse(readFileSync(join(dataDir, "Local State"), "utf8"))
  const wrapped = Buffer.from(state?.os_crypt?.encrypted_key ?? "", "base64")
  if (wrapped.subarray(0, 5).toString() !== "DPAPI") throw new Error("Local State 里没有 DPAPI 包装的 key")
  const key = dpapiDecrypt(wrapped.subarray(5))
  if (key.length !== 32) throw new Error(`AES key 长度异常：${key.length}`)
  return key
}

function decryptCookieValue(key, blob) {
  const version = blob.subarray(0, 3).toString()
  if (version !== "v10" && version !== "v11") throw new Error(`不支持的 Cookie 加密版本：${version}`)
  const nonce = blob.subarray(3, 15)
  const body = blob.subarray(15)
  const tag = body.subarray(body.length - 16)
  const decipher = createDecipheriv("aes-256-gcm", key, nonce)
  decipher.setAuthTag(tag)
  const plain = Buffer.concat([decipher.update(body.subarray(0, body.length - 16)), decipher.final()])
  // Chromium 的 host 绑定：前 32 字节是 SHA256(host_key)，后面才是值
  let value = plain
  if (value.length > 32) {
    const head = value.subarray(0, 32)
    const hashed = head.some((byte) => byte < 9 || (byte > 13 && byte < 32) || byte > 126)
    if (hashed) value = value.subarray(32)
  }
  return value.toString("utf8")
}

// node:sqlite 要 Node 22+；Bun 用 bun:sqlite。都没有就明确报错。
async function sqliteAll(file, sql) {
  try {
    const { DatabaseSync } = await import("node:sqlite")
    const db = new DatabaseSync(file, { readOnly: true })
    try { return db.prepare(sql).all() } finally { db.close() }
  } catch (error) {
    try {
      const { Database } = await import("bun:sqlite")
      const db = new Database(file, { readonly: true })
      try { return db.query(sql).all() } finally { db.close() }
    } catch {
      throw new Error(`读取客户端 Cookie 需要 Node 22+（node:sqlite）：${error?.message || error}`)
    }
  }
}

async function importLocalAccount(explicitDir) {
  const explicit = explicitDir && String(explicitDir).trim()
  const dirs = desktopDataDirs(explicitDir)
  // 目录判据放宽为「像 Electron profile」：Windows 靠 Local State，macOS 没有 ——
  // 根 Cookies 库、Local State、Partitions 任一即命中；空目录不算数，
  // 否则「目录不存在」和「目录在但没登录」两个错误会混成一条。
  let dataDir = dirs.find((dir) => looksLikeDataDir(dir))
  if (!dataDir) dataDir = dirs.find((dir) => clientCookieDbs(dir).length > 0)
  if (!dataDir) {
    // 用户显式指定的目录即使空着也按「没登录」报：路径是他给的，不该说「没找到」；
    // 但路径根本不存在时仍是「没找到」（多半拼错了）。
    if (explicit && explicit === dirs[0] && existsSync(dirs[0])) {
      return { error: "这个目录里没有已登录的 wps_sid —— 先在灵犀客户端登录一次，或改用浏览器登录" }
    }
    return { error: `没有找到灵犀客户端数据目录（找过：${dirs.join("、")}）。装了客户端并登录过一次后再试，或用 MAGPIE_LINGXI_HOME 指定目录` }
  }
  // 只有 Windows（或目录里有 Local State）才需要解密 key；macOS 的 Chromium
  // 不启用 OSCrypt，Cookie 值明文在 value 列，encrypted_value 分支在无 key 时跳过。
  let key = null
  // 解密仅当 Local State 存在（Windows OSCrypt）；macOS 明文布局没有它，直接读明文列
  if (existsSync(join(dataDir, "Local State"))) {
    try { key = chromiumKey(dataDir) } catch (error) { return { error: `读取客户端密钥失败：${error.message}` } }
  }

  const dbs = clientCookieDbs(dataDir)

  for (const file of dbs) {
    let rows
    try {
      rows = await sqliteAll(file, "select host_key,name,value,encrypted_value from cookies where name in ('wps_sid','uid')")
    } catch { continue }
    const found = {}
    for (const row of rows) {
      const host = String(row.host_key || "")
      const name = String(row.name || "")
      let value = row.value ? String(row.value) : ""
      if (!value && row.encrypted_value) {
        if (!key) continue
        try { value = decryptCookieValue(key, Buffer.from(row.encrypted_value)) } catch { continue }
      }
      if (!/^[\x21-\x7e]+$/.test(value)) continue
      if (!found[name] || host.endsWith("wps.cn")) found[name] = value
    }
    const sid = found.wps_sid || ""
    if (sid.length < 16) continue
    const uid = found.uid || ""
    const cookie = `wps_sid=${sid}${uid ? `; uid=${uid}` : ""}`
    return {
      sid,
      uid,
      cookie,
      host: await probeBase(cookie),
      accountId: uid ? `wps-${uid}` : `wps-${sid.slice(-8)}`,
      tail: cookieTail(sid),
    }
  }
  return { error: "客户端里没有已登录的 wps_sid —— 先在灵犀客户端登录一次，或改用浏览器登录" }
}

export async function WPSLingxiAuthPlugin(input = {}, options = {}) {
  const { client } = input

  return {
    config: async (config) => {
      config.provider ??= {}
      config.provider[PROVIDER] ??= {}
      const p = config.provider[PROVIDER]
      p.name ??= "WPS 灵犀"
      p.npm ??= NPM
      p.api ??= `${BASE}/api`
      // 网关等待耐心：kimi-k3.1-pro 等慢思考模型对大提示词的首字延迟可超 110s，
      // magpie 默认 60s 就把"上游失联"判成 502（fallback.go lastRetries=2 + 60s patience）。
      // 240s 是 magpie 的 PatienceLongest 上限；用户显式设置过则不覆盖。
      p.patience ??= 240
      // the variants are this plugin's own, not those a host stored from an
      // earlier release (an array, whose keys it read as "0", "1", "2"); a
      // model this plugin doesn't define is left without them, which a host
      // reads as one that thinks with no levels to pick, not as one that has
      // none. The default row stays under a stored one, so a stored row that
      // says less keeps what it doesn't say.
      const defaults = configModels()
      const stored = p.models ?? {}
      p.models = Object.fromEntries(
        Object.keys({ ...defaults, ...stored }).map((id) => {
          const base = defaults[id] ?? {}
          const m = { ...base, ...(stored[id] ?? {}) }
          if (base.variants) m.variants = base.variants
          else delete m.variants
          return [id, m]
        })
      )
    },

    provider: {
      id: PROVIDER,
      // 模型目录只取客户端自己用的 /api/aioffice/v1/sessions/plans（plans + models）。
      async models(provider, { auth } = {}) {
        const cookie = resolveCookie(auth)
        if (cookie) {
          const live = await fetchModelPlans(cookie, resolveBase(auth))
          if (live.length) {
            return Object.fromEntries(live.map((m) => [m.id, modelOf(provider, m)]))
          }
        }
        // 未登录（或目录暂时不可达）时给一份客户端目录的快照，不假装是实时数据。
        return Object.fromEntries(DEFAULT_MODELS.map((m) => [m.id, modelOf(provider, m)]))
      },
    },

    auth: {
      provider: PROVIDER,
      icon: LINGXI_ICON,

      // 1. 每日自动签到：领前领后读余额（上游重复领取是「幂等假成功」），
      //    顺手把上游已判 claimable 的一次性任务领回（incomplete 的不碰）。
      async checkin(getAuth) {
        const auth = await getAuth()
        const cookie = resolveCookie(auth)
        if (!cookie) return { outcome: "failed", message: "未配置 WPS Cookie，无法签到", signIn: "expired" }

        try {
          const base = resolveBase(auth)
          const tasksRes = await fetch(`${base}/api/public/v1/tasks`, { headers: basicHeaders(cookie, base) })
          if (tasksRes.status === 401 || tasksRes.status === 403) {
            return { outcome: "failed", message: "WPS 登录态已失效，请重新登录", signIn: "expired" }
          }
          if (!tasksRes.ok) return { outcome: "failed", message: `任务中心响应 HTTP ${tasksRes.status}` }

          const taskJson = await tasksRes.json()
          if (taskJson?.result === "UserUnauthorized") {
            return { outcome: "failed", message: "WPS 登录凭据失效，请重新登录", signIn: "expired" }
          }

          const tasks = taskJson?.data?.tasks || []
          const daily = tasks.find((task) => task.task_key === "daily_check_in")
          if (!daily) return { outcome: "failed", message: "上游任务中心里没有每日签到" }
          const streak = Number(daily?.extra?.consecutive_days) || undefined

          const before = await balanceTotal(cookie, base)
          let outcome
          if (daily.status === "claimed") {
            outcome = { outcome: "done", message: "今日已签到", ...(streak ? { streak } : {}) }
          } else {
            const claim = await claimTask(cookie, base, "daily_check_in", claimDate(daily))
            if (claim?.result && claim.result !== "ok") {
              return { outcome: "failed", message: claim.hint || `签到失败：${claim.result}` }
            }
            const after = await balanceTotal(cookie, base)
            const delta = before != null && after != null
              ? after - before
              : Number(claim?.data?.extra?.today_reward ?? daily.reward_amount ?? 0)
            outcome = delta > 0
              ? { outcome: "claimed", credit: delta, ...(streak ? { streak: streak + 1 } : {}) }
              : { outcome: "done", message: "今日已签到（上游幂等，余额未变化）", ...(streak ? { streak } : {}) }
          }

          // 一次性任务：先把「做不出来」的做出来（专家模式 / 群聊 / 客户端），
          // 再把上游所有 claimable 的一次性任务领回。
          const auto = await completeOneTimeTasks(cookie, base, tasks)
          if (auto.bonus > 0) {
            outcome.credit = Number(outcome.credit || 0) + auto.bonus
            outcome.outcome = "claimed"
          }
          if (auto.message) {
            outcome.message = outcome.message ? `${outcome.message}；${auto.message}` : auto.message
          }
          return outcome
        } catch (error) {
          if (error?.status === 401 || error?.status === 403) {
            return { outcome: "failed", message: "WPS 登录态已失效，请重新登录", signIn: "expired" }
          }
          return { outcome: "failed", message: `签到异常: ${error.message}` }
        }
      },

      // 1.5 账号迁移：0.3.7 之前建的账号 accountId 是固定串「WPS 灵犀账户」，
      // refresh 的返回值会合并进账号记录，这里借它把旧记录改成 wps-<uid> 并补上昵称。
      async refresh(auth) {
        const cookie = resolveCookie(auth)
        if (!cookie) return {}
        const base = resolveBase(auth)
        const sid = extractSid(cookie)
        const profile = await fetchProfile(cookie, base).catch(() => ({}))
        const uid = auth.metadata?.uid || extractUid(cookie) || profile.id || ""
        const accountId = uid ? `wps-${uid}` : sid ? `wps-${sid.slice(-8)}` : undefined
        const metadata = { ...(auth.metadata || {}) }
        if (sid) metadata.sid = metadata.sid || sid
        if (uid) metadata.uid = uid
        if (profile.name) metadata.name = profile.name
        if (accountId) metadata.accountId = accountId
        const out = { metadata }
        if (accountId && auth.accountId !== accountId) out.accountId = accountId
        return out
      },

      // 2. 用量与智点额度查询 (对齐 Magpie 的 balance 和 until 规范)
      async usage(getAuth) {
        const auth = await getAuth()
        const cookie = resolveCookie(auth)
        if (!cookie) {
          return { error: "未检测到有效 WPS 登录凭证", signIn: "expired" }
        }

        try {
          const base = resolveBase(auth)
          const profile = await fetchProfile(cookie, base).catch(() => ({}))
          const res = await fetch(`${base}/api/public/v1/credits/balance`, { headers: basicHeaders(cookie, base) })

          if (res.status === 401 || res.status === 403) {
            return { error: "登录态失效，请重新登录", signIn: "expired" }
          }

          if (!res.ok) throw new Error(`Credit query failed: HTTP ${res.status}`)
          const creditResult = await res.json()
          if (!creditResult.data) throw new Error("Missing upstream credit data")
          const data = creditResult.data
          const totalBalance = Number(data.total_balance ?? data.balance ?? 0)
          const summary = data.bonus_summary || {}
          const totalValue = Number(summary.total_value ?? 0)
          const totalConsumed = summary.total_consumed == null ? null : Number(summary.total_consumed)
          if (![totalBalance, totalValue].every(Number.isFinite) || totalBalance < 0 || totalValue < 0 ||
              (totalConsumed !== null && (!Number.isFinite(totalConsumed) || totalConsumed < 0))) {
            throw new Error("Invalid upstream credit values")
          }

          const nowMs = Date.now()
          let earliestExpire = ""
          const bonusItems = data.bonus_credits || data.bonus_summary?.items || []
          for (const item of bonusItems) {
            if (!(item.balance > 0) || !item.expire_time) continue
            const expireMs = Date.parse(item.expire_time)
            if (!Number.isFinite(expireMs) || expireMs <= nowMs) continue
            if (!earliestExpire || expireMs < Date.parse(earliestExpire)) earliestExpire = item.expire_time
          }

          // 路由页和额度面板要的是“窗口”（总额/剩余/已用/重置时间），
          // 只给 balance 字符串会被当成“剩余额度未知”。
          // used 必须是有限数字：有总额/已用时给百分比，钱包型（没有总额）给 0。
          const hasQuota = totalValue > 0 && totalConsumed !== null
          const usedPct = hasQuota ? Math.max(0, Math.min(100, (totalConsumed / totalValue) * 100)) : 0

          // 临时积分：15 天内到期的赠送批次（与 jet 插件同一判据）。
          // 上游 bonus_credits 每个批次都带 balance / value / consumed / expire_time。
          const expiring = summarizeExpiring(bonusItems, nowMs)

          const windows = []
          if (expiring.balance > 0) {
            windows.push({
              name: "临时积分",
              used: expiring.value > 0 ? Math.max(0, Math.min(100, (expiring.consumed / expiring.value) * 100)) : 0,
              remaining: expiring.balance,
              ...(expiring.value > 0 ? { amount: expiring.consumed, limit: expiring.value } : {}),
              display: `${expiring.balance.toLocaleString()} 智点 · ${creditDateLabel(expiring.earliest)} 到期`,
              unit: "智点",
              resetsAt: expiring.earliest,
            })
          }
          windows.push({
            name: "智点",
            used: usedPct,
            remaining: totalBalance,
            ...(hasQuota ? { amount: totalConsumed, limit: totalValue } : {}),
            display: hasQuota
              ? `${totalBalance.toLocaleString()} / ${totalValue.toLocaleString()} 智点`
              : `${totalBalance.toLocaleString()} 智点`,
            unit: "智点",
            // 到期时间不是“补充时间”，这里不放进 resetsAt，只作为 until 展示。
          })

          return {
            plan: "WPS 灵犀",
            user: profile?.name || auth.accountId || "WPS 账户",
            balance: `${totalBalance.toLocaleString()} 智点`,
            windows,
            until: toIso(earliestExpire),
            signIn: "kept",
          }
        } catch (e) {
          return { error: e.message, signIn: "kept" }
        }
      },

      // 3. 反代网关拦截器：自动维护会话并转发到官方 SSE Completions 接口
      async loader(getAuth) {

        return {
          baseURL: `${BASE}/api`,
          apiKey: "placeholder",
          async fetch(input, init = {}) {
            const auth = await getAuth()
            const cookie = resolveCookie(auth)
            const signal = init.signal ?? (input instanceof Request ? input.signal : undefined)
            signal?.throwIfAborted()
            const errorResponse = (message, status = 502, code = "upstream_error") => new Response(
              JSON.stringify({ error: { message, type: "upstream_error", code } }),
              { status, headers: { "Content-Type": "application/json" } }
            )

            if (!cookie) {
              return errorResponse("WPS 灵犀未登录：请重新粘贴 Cookie", 401, "sign_in_required")
            }
            const base = resolveBase(auth)

            let body = {}
            try {
              let rawBody = init?.body
              if (rawBody === undefined && input instanceof Request) {
                rawBody = await input.clone().text()
              }
              if (typeof rawBody === "string") {
                body = JSON.parse(rawBody)
              } else if (rawBody) {
                body = JSON.parse(new TextDecoder().decode(rawBody))
              }
            } catch {}

            const messages = body.messages || []
            const stream = body.stream !== false
            let requestedModel = (body.model || "deepseek-v4.1-flash")
              .replace(/^wps-lingxi\//, "")
              .replace(/^lingxi-/, "")

            if (!requestedModel || requestedModel === "default") {
              requestedModel = "deepseek-v4.1-flash"
            }

            // 桌面客户端只有一条通路：cowork 会话 → credits/run → agent-runtime。
            // 网页平面（/api/aigc/v3/assistant/* 的 question 压平与正文工具桥）已移除。
            try {
              return await agentChat({ cookie, body, stream, requestedModel, signal, errorResponse })
            } catch (error) {
              signal?.throwIfAborted()
              return errorResponse(error?.message || String(error), chatErrorStatus(error), "upstream_error")
            }
          },
        }
      },

      // 4. 登录认证方式 (支持 网页拉起 或 弹窗粘贴)
      methods: [
        {
          // 直接打开 Chromium 的登录页，用户在浏览器里登录，插件用 CDP 读会话。
          // 没有本地 HTML、不粘 Cookie、不需要用户复制任何东西。
          type: "oauth",
          label: "浏览器登录（打开 WPS 登录页）",
          async authorize() {
            const browser = findBrowser()
            if (!browser) {
              throw new Error(
                "没有找到 Chromium 内核浏览器（Chrome / Edge / 360极速 / QQ / Brave 等）。" +
                "装一个，或用 MAGPIE_LINGXI_BROWSER 指向它的 exe。360 安全浏览器可能不支持调试端口，建议 360极速或 Chrome/Edge",
              )
            }
            const controller = new AbortController()
            const done = new Promise((resolve, reject) => {
              void (async () => {
                try {
                  const { sid, uid } = await chromiumLogin({
                    browser,
                    url: `${BASE}/`,
                    timeoutMs: 5 * 60 * 1000,
                    signal: controller.signal,
                  })
                  const cred = normalizeCredential(`wps_sid=${sid}${uid ? `; uid=${uid}` : ""}`)
                  if (cred.error) throw new Error(cred.error)
                  const host = await probeBase(cred.cookie)
                  resolve({
                    type: "success",
                    access: cred.sid,
                    refresh: "",
                    // Cookie 约一年有效；没有刷新接口，真正的判据是上游 401。
                    expires: Date.now() + 360 * 24 * 3600 * 1000,
                    cookie: cred.cookie,
                    accountId: cred.accountId,
                    metadata: { sid: cred.sid, uid: cred.uid, cookieTail: cred.tail, accountId: cred.accountId, host },
                  })
                } catch (error) {
                  reject(error)
                }
              })()
            })
            return {
              url: `${BASE}/`,
              instructions: "已在浏览器打开 WPS 登录页，登录成功后自动完成，不需要复制 Cookie",
              method: "auto",
              opened: true,
              callback: () => done,
            }
          },
        },
        {
          // 客户端已经登录过时最省事：直接读它的 Cookie 库，不弹浏览器、不重登。
          // 用 oauth + opened:true 而不是 api：api 类型在 magpie 里就是「输入一个 key」，
          // 即使没有 prompts 也会渲染输入框。这个方法是「点一下直接读本机客户端」。
          type: "oauth",
          label: "导入本机灵犀客户端账号",
          async authorize() {
            const cred = await importLocalAccount(process.env.MAGPIE_LINGXI_HOME)
            if (cred?.error) throw new Error(cred.error)
            return {
              url: `${BASE}/`,
              instructions: "已读取本机灵犀客户端登录态，无需输入任何内容",
              method: "auto",
              opened: true,
              callback: async () => ({
                type: "success",
                access: cred.sid,
                refresh: "",
                // Cookie 约一年有效；没有刷新接口，真正的判据是上游 401。
                expires: Date.now() + 360 * 24 * 3600 * 1000,
                cookie: cred.cookie,
                accountId: cred.accountId,
                metadata: {
                  sid: cred.sid,
                  uid: cred.uid,
                  cookieTail: cred.tail,
                  cookie: cred.cookie,
                  accountId: cred.accountId,
                  host: cred.host,
                },
              }),
            }
          },
        },
        {
          // 兜底的手填方式：浏览器登录、客户端导入都走不通时（没装客户端、浏览器不支持
          // 调试端口、或在别人的机器上临时用），用户从浏览器 DevTools 里复制 wps_sid
          // （或整段 Cookie）直接粘进来。纯 HTTP 校验，不拉浏览器、不开页面。
          type: "oauth",
          label: "粘贴 Cookie 登录（wps_sid）",
          prompts: [
            {
              type: "text",
              key: "cookie",
              message: "WPS 的 wps_sid（也可粘整段 Cookie：wps_sid=…; uid=…）",
              placeholder: "wps_sid=…; uid=…",
              // 只在本地做格式校验，不发网络请求；返回字符串即错误信息，undefined 为通过。
              validate: (value) => normalizeCredential(value)?.error,
            },
          ],
          async authorize(inputs) {
            const raw = String(inputs?.cookie ?? inputs?.key ?? "")
            const cred = normalizeCredential(raw)
            // authorize 里失败只能抛异常：return { type: "failed" } 会被 magpie 当成
            // 登录流程对象去调 .callback()，崩在 "callback is not a function"。
            if (cred?.error) throw new Error(cred.error)

            // 立刻返回，网络校验放 callback（在 authorize 里死等会和 magpie 互锁）。
            const probe = verifyCookie(cred.cookie)

            return {
              url: `${BASE}/`,
              instructions: "正在校验这把 Cookie…",
              method: "auto",
              // 全程纯 HTTP，没开任何页面；opened:true 让 magpie 别再拉浏览器。
              opened: true,
              async callback() {
                let result
                try {
                  result = await probe
                } catch (error) {
                  return { type: "failed", error: String(error?.message || error) }
                }
                if (!result.ok) {
                  const detail = result.tried?.length ? `（${result.tried.join("；")}）` : ""
                  return { type: "failed", error: `Cookie 无效或已过期${detail}` }
                }
                return {
                  type: "success",
                  access: cred.sid,
                  refresh: "",
                  // Cookie 约一年有效；没有刷新接口，真正的判据是上游 401。
                  expires: Date.now() + 360 * 24 * 3600 * 1000,
                  cookie: cred.cookie,
                  accountId: cred.accountId,
                  metadata: {
                    sid: cred.sid,
                    uid: cred.uid,
                    cookieTail: cred.tail,
                    cookie: cred.cookie,
                    accountId: cred.accountId,
                    host: result.host,
                  },
                }
              },
            }
          },
        },
      ],
    },
  }
}

export default WPSLingxiAuthPlugin

// 内部工具（单测/排障用；magpie 只读 default 与命名导出，不受影响）。
export const _internal = {
  parseCookieInput,
  importLocalAccount,
  extractSid,
  extractUid,
  identityOf,
  normalizeCredential,
  verifyCookie,
  resolveCookie,
  resolveBase,
  findBrowser,
  browserCandidates,
  summarizeExpiring,
  runExpertConversationViaAigc,
  runTaskConversation,
  setGroupWSFactory(fn) { groupWSFactory = fn },
  desktopDataDirs,
  looksLikeDataDir,
  clientCookieDbs,
  sqliteAll,
  decryptCookieValue,
  chromiumKey,
  dpapiDecrypt,
  createGroupChatWith,
  deleteGroupChat,
  agentChat,
  sanitizeSchema,
  normalizeUsage,
  filterTools,
  buildAgentBody,
  fitAgentBody,
  byteLength,
  maxPromptKb: () => MAX_PROMPT_KB,
  browserLogin,
  safariLogin,
  chromiumLogin,
}
