// WPS 灵犀 (Lingxi) Provider Plugin for Magpie / OpenCode
// 借鉴 Magpie 成熟插件体系（Trae / WorkBuddy / OfficeAce）
// 核心能力：动态同步灵犀网页模型、展示可用智点额度、每日自动签到与全功能 SSE 反代网关

import { createServer } from "node:http"
import { createHash } from "node:crypto"
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { exec, spawn } from "node:child_process"

const PROVIDER = "wps-lingxi"
// 两条平面（别混）：
//   · 老平面（会话 / cowork）：/api/aigc/v3/assistant/sessions/... 只有 user_input.text，
//     没有 tools 槽位 —— 只适合纯文本；
//   · agent-runtime 直连平面：/api/public/v1/agent-runtime/chat/completions，OpenAI 形状，
//     tools / tool_calls 真可用（2026-10-28 一手实测，见 Agent2Providers feat/lingxi-provider）。
// 任务 / 余额 / 目录仍在 kdocs.cn；agent-runtime 在 wps.cn 上，先试它、不行再回落老域名。
const LINGXI_BASE = "https://lingxi.kdocs.cn"
const AGENT_BASE = "https://lingxi.wps.cn"
const AGENT_SESSIONS_PATH = "/api/aioffice/v1/cowork/sessions"
const AGENT_RUNS_PATH = "/api/public/v1/credits/runs"
const AGENT_CHAT_PATH = "/api/public/v1/agent-runtime/chat/completions"
const CLIENT_TYPE = "lingxi_claw"
const APPSERVER_VERSION = "68"
const RUN_TTL_MS = 60 * 60 * 1000
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

function configModels() {
  return Object.fromEntries(
    DEFAULT_MODELS.map((m) => [
      m.id,
      {
        name: `${m.name} (${m.multiplier})`,
        limit: { context: m.context, output: 65536 },
        tool_call: true,
        ...(m.reasoning ? { reasoning: true, variants: ["low", "high", "max"] } : {}),
      },
    ])
  )
}

function modelOf(provider, m) {
  const isReasoning = !!(m.reasoning || (m.reasoning_efforts && m.reasoning_efforts.length > 0))
  const multiplierText = m.multiplier ? ` [${m.multiplier}]` : ""
  return {
    id: m.id || m.key,
    providerID: provider.id,
    name: `${m.name}${multiplierText}`,
    api: { id: m.id || m.key, url: `${LINGXI_BASE}/api`, npm: NPM },
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
    variants: isReasoning ? ["low", "high", "max"] : [],
  }
}

function getTodayString() {
  const d = new Date()
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

// ── 登录：只留 wps_sid ────────────────────────────────────────────────
// 云端两条平面都只认 `Cookie: wps_sid=…`；用户常把整段 Cookie 粘进来，
// 这里负责从中取出 wps_sid，其余键（kso_sid / uid / rtk…）丢弃。

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

const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => (
  { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]
))

function resolveCookie(auth) {
  if (!auth) return ""
  const fromMeta = typeof auth.metadata?.sid === "string" ? auth.metadata.sid.trim() : ""
  if (fromMeta) return `wps_sid=${fromMeta}`
  for (const raw of [auth.cookie, auth.metadata?.cookie, auth.key, auth.access]) {
    const sid = extractSid(raw)
    if (sid) return `wps_sid=${sid}`
  }
  return ""
}

function normalizeCredential(raw) {
  const text = String(raw ?? "").trim()
  if (!text) return { error: "请输入 wps_sid 或整段 Cookie" }
  const sid = extractSid(text)
  if (!sid) return { error: "没有在输入里找到 wps_sid（可粘贴整段 Cookie 或 wps_sid 的值）" }
  if (sid.length < 16) return { error: "wps_sid 太短，像是不完整的粘贴" }
  const uid = extractUid(text)
  const identity = identityOf(sid)
  return {
    sid,
    uid,
    identity,
    cookie: `wps_sid=${sid}`,
    accountId: `灵犀·${identity.slice(0, 8)}`,
    tail: cookieTail(sid),
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

function basicHeaders(cookie, base = LINGXI_BASE) {
  return { Cookie: cookie, "User-Agent": UA, Referer: `${base}/`, Accept: "application/json" }
}

function resolveBase(auth) {
  const host = typeof auth?.metadata?.host === "string" ? auth.metadata.host.trim() : ""
  return host || LINGXI_BASE
}

// 登录后探测哪个域名接受这把 Cookie（wps.cn / kdocs.cn 是同一账号的两套站）。
async function probeBase(cookie) {
  for (const base of [AGENT_BASE, LINGXI_BASE]) {
    try {
      const response = await fetch(`${base}/api/public/v1/credits/balance`, { headers: basicHeaders(cookie, base) })
      if (response.ok) return base
    } catch {}
  }
  return AGENT_BASE
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

function findBrowser() {
  const candidates = []
  if (process.platform === "darwin") {
    candidates.push(
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
      "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
    )
  } else if (process.platform === "win32") {
    const roots = [process.env.PROGRAMFILES, process.env["PROGRAMFILES(X86)"], process.env.LOCALAPPDATA].filter(Boolean)
    for (const root of roots) {
      candidates.push(
        join(root, "Google", "Chrome", "Application", "chrome.exe"),
        join(root, "Microsoft", "Edge", "Application", "msedge.exe"),
      )
    }
  } else {
    for (const name of ["google-chrome", "chromium", "chromium-browser", "microsoft-edge"]) {
      const found = which(name)
      if (found) candidates.push(found)
    }
  }
  return candidates.find((file) => existsSync(file)) || ""
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
  throw new Error("没有找到 Chrome / Edge / Chromium；Safari 的自动化窗口不允许手动输入，请用下方手动粘贴 Cookie，或安装 Chrome/Edge")
}

function agentHeaders(cookie, base, extra = {}) {
  return {
    Cookie: cookie,
    "Content-Type": "application/json",
    "x-client-type": CLIENT_TYPE,
    "x-lingxi-appserver-version": APPSERVER_VERSION,
    Referer: `${base}/`,
    "User-Agent": UA,
    ...extra,
  }
}

function wireModel(value) {
  let model = String(value ?? "").trim()
  model = model.replace(/^wps-lingxi\//, "").replace(/^lingxi[/-]/, "")
  return !model || model === "default" ? "deepseek-v4.1-flash" : model
}

function filterTools(value) {
  const items = Array.isArray(value) ? value : []
  const kept = []
  let dropped = 0
  for (const item of items) {
    const name = item?.function?.name
    if (item?.type === "function" && typeof name === "string" && name.trim()) kept.push(item)
    else dropped += 1
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

async function createCoworkSession(base, cookie, signal) {
  const payload = await postJson(`${base}${AGENT_SESSIONS_PATH}`, cookie, base, {
    session_type: "cowork_client",
    agent_version: 2,
    env: { device_id: "magpie-lingxi", device_name: "Magpie", work_space_dir: "/tmp" },
  }, signal)
  const id = String(payload?.data?.session_id ?? "").trim()
  if (!id) throw new Error("灵犀未返回 session_id")
  return id
}

async function createCreditsRun(base, cookie, sessionId, model, title, signal) {
  const payload = await postJson(`${base}${AGENT_RUNS_PATH}`, cookie, base, {
    client_request_id: String(Date.now()),
    session_id: sessionId,
    model_provider: "lingxi",
    model_id: model,
    agent_input: {
      text: title,
      files: [],
      file_ids: [],
      expect_model: model,
      refs: [],
      permission_mode: "default",
      current_mode: "agent",
      browser_plugin_enabled: false,
    },
  }, signal)
  const id = String(payload?.data?.run_id ?? "").trim()
  if (!id) throw new Error("灵犀未返回 run_id")
  return id
}

async function ensureRun(cookie, key, model, title, signal) {
  const hit = runs.get(key)
  if (hit && Date.now() - hit.at < RUN_TTL_MS) return hit
  let lastError
  // 先试 wps.cn（reference 实测的平面），404/401 再回落登录用的 kdocs 域名。
  for (const base of [AGENT_BASE, LINGXI_BASE]) {
    try {
      const sessionId = await createCoworkSession(base, cookie, signal)
      const runId = await createCreditsRun(base, cookie, sessionId, model, title, signal)
      const run = { base, sessionId, runId, at: Date.now() }
      runs.set(key, run)
      return run
    } catch (error) {
      lastError = error
    }
  }
  throw lastError ?? new Error("WPS 灵犀未能建立会话")
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
  return out
}

// 上游帧：data:{"code":"Success","usage":{…},"choices":[{"text","reasoning_content","tool_calls","finish_reason"}]}
// 没有 [DONE]，靠 finish_reason 收尾；正文在 choices[].text（不是 delta.content）。
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
    if (frame?.usage && typeof frame.usage === "object" && Number(frame.usage.total_tokens) > 0) {
      this.usage = frame.usage
    }
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
    if (value?.usage) usage = value.usage
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

async function requestAgent(cookie, run, payload, signal) {
  const response = await fetch(`${run.base}${AGENT_CHAT_PATH}`, {
    method: "POST",
    headers: agentHeaders(cookie, run.base, { "x-cc-session-id": run.sessionId, "x-cc-run-id": run.runId }),
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

async function agentChat({ cookie, body, stream, requestedModel, signal, errorResponse }) {
  const key = `${identityOf(cookie)}|${requestedModel}`
  const payload = buildAgentBody(body, requestedModel)
  let run = await ensureRun(cookie, key, requestedModel, lastUserText(body), signal)
  let response
  try {
    response = await requestAgent(cookie, run, payload, signal)
  } catch (error) {
    if (!looksLikeStaleRun(error.message)) throw error
    runs.delete(key)
    run = await ensureRun(cookie, key, requestedModel, lastUserText(body), signal)
    response = await requestAgent(cookie, run, payload, signal)
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

async function balanceTotal(cookie, base = LINGXI_BASE) {
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
function claimDate(daily) {
  const days = daily?.extra?.check_in_days
  if (Array.isArray(days)) {
    const available = days.find((day) => day?.status === "available" && typeof day?.date === "string")
    if (available) return available.date
  }
  return getTodayString()
}

// 动态拉取网页端可用模型
async function fetchLiveModels(cookie, base = LINGXI_BASE) {
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
          support_multimodal: p.support_multimodal,
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

export async function WPSLingxiAuthPlugin(input = {}, options = {}) {
  const { client } = input

  return {
    config: async (config) => {
      config.provider ??= {}
      config.provider[PROVIDER] ??= {}
      const p = config.provider[PROVIDER]
      p.name ??= "WPS 灵犀"
      p.npm ??= NPM
      p.api ??= `${LINGXI_BASE}/api`
      p.models = { ...configModels(), ...(p.models ?? {}) }
    },

    provider: {
      id: PROVIDER,
      // 登录后动态同步官方最新模型列表
      async models(provider, { auth } = {}) {
        const cookie = resolveCookie(auth)
        if (cookie) {
          const live = await fetchLiveModels(cookie, resolveBase(auth))
          if (live.length) {
            return Object.fromEntries(live.map((m) => [m.id, modelOf(provider, m)]))
          }
        }
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

          // 一次性任务：只领上游自己标成 claimable 的（动作没做的 claim 必被拒）。
          let bonus = 0
          const keys = []
          for (const task of tasks) {
            if (task?.type !== "one_time" || task?.status !== "claimable" || !task?.task_key) continue
            try {
              const claim = await claimTask(cookie, base, task.task_key)
              const got = Number(claim?.data?.reward_amount ?? task.reward_amount ?? 0)
              if (Number.isFinite(got) && got > 0) bonus += got
              keys.push(task.task_key)
            } catch {}
          }
          if (bonus > 0) {
            outcome.credit = Number(outcome.credit || 0) + bonus
            outcome.outcome = "claimed"
            outcome.message = `一次性任务 ${keys.join("/")} +${bonus} 智点`
          }
          return outcome
        } catch (error) {
          if (error?.status === 401 || error?.status === 403) {
            return { outcome: "failed", message: "WPS 登录态已失效，请重新登录", signIn: "expired" }
          }
          return { outcome: "failed", message: `签到异常: ${error.message}` }
        }
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

          let earliestExpire = ""
          const bonuses = data.bonus_credits || data.bonus_summary?.items || []
          for (const item of bonuses) {
            if (item.balance > 0 && item.expire_time) {
              if (!earliestExpire || item.expire_time < earliestExpire) {
                earliestExpire = item.expire_time
              }
            }
          }

          // 路由页和额度面板要的是“窗口”（总额/剩余/已用/重置时间），
          // 只给 balance 字符串会被当成“剩余额度未知”。
          const windows = []
          {
            const usedPct = totalValue > 0 && totalConsumed !== null ? Math.max(0, Math.min(100, (totalConsumed / totalValue) * 100)) : null
            windows.push({
              name: "智点",
              ...(usedPct !== null ? { used: usedPct } : {}),
              remaining: totalBalance,
              amount: totalBalance,
              ...(totalValue > 0 ? { limit: totalValue } : {}),
              display: totalValue > 0 ? `${totalBalance.toLocaleString()} / ${totalValue.toLocaleString()} 智点` : `${totalBalance.toLocaleString()} 智点`,
              unit: "智点",
              // Credit expiry is not a replenishment or total-balance exhaustion time.
            })
          }

          return {
            plan: "WPS 灵犀",
            user: auth.accountId || "WPS 账户",
            balance: `${totalBalance.toLocaleString()} 智点`,
            windows,
            until: earliestExpire,
            signIn: "kept",
          }
        } catch (e) {
          return { error: e.message, signIn: "kept" }
        }
      },

      // 3. 反代网关拦截器：自动维护会话并转发到官方 SSE Completions 接口
      async loader(getAuth) {

        return {
          baseURL: `${LINGXI_BASE}/api`,
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

            // 两条平面：带 tools 的任务走 agent-runtime（工具真可用）；纯文本仍走老会话平面。
            // options.plane = "agent" | "legacy" 可强制，默认 auto（有 tools 就用 agent）。
            const toolsSeen = filterTools(body.tools)
            const hasTools = toolsSeen.tools.length > 0
            const plane = options?.plane === "legacy" ? "legacy" : options?.plane === "agent" ? "agent" : (hasTools ? "agent" : "legacy")
            if (plane === "legacy" && hasTools) {
              return errorResponse("legacy 平面不支持 tools（请把 plane 设为 agent）", 400, "tools_unsupported")
            }
            if (plane === "agent") {
              try {
                return await agentChat({ cookie, body, stream, requestedModel, signal, errorResponse })
              } catch (error) {
                signal?.throwIfAborted()
                const absent = error?.status === 404 || error?.status === 405 || /not found|未找到/i.test(String(error?.message))
                if (hasTools || !absent) return errorResponse(error?.message || String(error), error?.status || 502)
                // 没有工具的任务：agent-runtime 不可用时继续走下面的老路径
              }
            }

            // 提取提问内容，支持多轮对话上下文整合
            let question = ""
            if (messages.length === 1) {
              question = typeof messages[0].content === "string" ? messages[0].content : JSON.stringify(messages[0].content)
            } else if (messages.length > 1) {
              const lastUser = [...messages].reverse().find((m) => m.role === "user")
              const currentQ = typeof lastUser?.content === "string" ? lastUser.content : JSON.stringify(lastUser?.content || "")

              const history = []
              for (const m of messages) {
                if (m === lastUser) break
                const c = typeof m.content === "string" ? m.content : JSON.stringify(m.content)
                if (m.role === "system") {
                  history.push(`[System: ${c}]`)
                } else if (m.role === "user") {
                  history.push(`User: ${c}`)
                } else if (m.role === "assistant") {
                  history.push(`Assistant: ${c}`)
                }
              }

              if (history.length) {
                question = `${history.join("\n\n")}\n\nUser: ${currentQ}`
              } else {
                question = currentQ
              }
            }

            if (!question) {
              question = "你好"
            }

            // Normalize named client variants to the upstream 0/1/2 protocol.
            const effort = body.reasoning_effort ?? body.reasoningEffort ?? body.thinking_level
            const effortMap = { low: "0", high: "1", max: "2", "0": "0", "1": "1", "2": "2" }
            const normalizedEffort = effort == null || effort === "" || !Object.hasOwn(effortMap, String(effort))
              ? undefined : effortMap[String(effort)]
            if (effort != null && effort !== "" && normalizedEffort === undefined) {
              return errorResponse("Unsupported reasoning effort", 400, "invalid_reasoning_effort")
            }

            // 获取或创建 session_id
            async function createSession() {
              const sessRes = await fetch(`${base}/api/aigc/v3/assistant/sessions`, {
                method: "POST",
                signal,
                headers: {
                  Cookie: cookie,
                  "Content-Type": "application/json",
                  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                  Referer: `${base}/`,
                },
                body: "{}",
              })
              if (!sessRes.ok) {
                const error = new Error(`Session creation failed: HTTP ${sessRes.status}`)
                error.status = sessRes.status
                throw error
              }
              const sessData = await sessRes.json()
              const id = sessData?.data?.session_id
              if (typeof id !== "string" || !id.trim()) throw new Error("Session creation returned no session ID")
              return id
            }

            // 灵犀同一 session 并发会返回 event:error：每个请求各建一个会话
            let activeSessionId
            try { activeSessionId = await createSession() }
            catch (error) {
              signal?.throwIfAborted()
              return errorResponse(error.message, error.status || 502)
            }

            // 发起请求到官方 completions 端点
            async function sendCompletions(sessId) {
              const payload = {
                question,
                model: requestedModel,
                user_input: { text: question },
              }
              if (normalizedEffort !== undefined) payload.reasoning_effort = normalizedEffort

              return fetch(`${base}/api/aigc/v3/assistant/sessions/${sessId}/completions`, {
                method: "POST",
                signal,
                headers: {
                  Cookie: cookie,
                  "Content-Type": "application/json",
                  "X-Cc-Version": "1",
                  "X-Client-Type": "lingxi-web",
                  "X-Cc-Entrance": "default",
                  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                  Referer: `${base}/`,
                },
                body: JSON.stringify(payload),
              })
            }

            let upstreamRes
            try { upstreamRes = await sendCompletions(activeSessionId) }
            catch (error) {
              signal?.throwIfAborted()
              return errorResponse("Unable to read WPS Lingxi upstream response")
            }


            if (!upstreamRes.ok) {
              const errText = await upstreamRes.text().catch(() => "")
              return new Response(
                JSON.stringify({
                  error: {
                    message: `WPS 灵犀上游响应异常: HTTP ${upstreamRes.status} ${errText}`,
                    type: "upstream_error",
                    code: upstreamRes.status,
                  },
                }),
                {
                  status: upstreamRes.status,
                  headers: { "Content-Type": "application/json" },
                }
              )
            }
            if (!upstreamRes.body) return errorResponse("WPS Lingxi upstream returned no response body")

            // Parse SSE frames independently of network and UTF-8 chunk boundaries.
            const decoder = new TextDecoder()
            const encoder = new TextEncoder()
            const completionId = `chatcmpl-${Date.now()}`
            let lineBuffer = "", eventName = "", dataLines = []
            let sawError = false, ended = false
            let upstreamError = { message: "Upstream stream ended without a completion marker", type: "upstream_error", code: "incomplete_stream" }
            function emit(controller, value) {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(value)}\n\n`))
            }
            function fail(controller, detail) {
              if (sawError) return
              sawError = true
              upstreamError = { message: String(detail?.message || detail?.hint || "WPS Lingxi upstream error"),
                type: "upstream_error", code: detail?.code || "upstream_error" }
              emit(controller, { error: upstreamError })
            }
            function dispatch(controller) {
              const raw = dataLines.join("\n")
              const name = eventName
              eventName = ""; dataLines = []
              if (sawError) return
              let item
              try { item = raw ? JSON.parse(raw) : null } catch {
                fail(controller, { message: "Malformed upstream SSE data", code: "invalid_sse" }); return
              }
              if (name === "error") { fail(controller, item?.error || item); return }
              if (!item) return
              if (item.type === "error") { fail(controller, item.error || item.data || item); return }
              if (ended) return
              let delta
              if (item.type === "reasoning" || item.type === "text") {
                const value = typeof item.data === "object" ? item.data?.text || "" : String(item.data ?? "")
                delta = item.type === "text" ? { content: value } : { reasoning_content: value }
              } else if (item.type === "end" || item.type === "text_end") {
                ended = true; delta = {}
              } else return
              emit(controller, { id: completionId, object: "chat.completion.chunk",
                created: Math.floor(Date.now() / 1000), model: requestedModel,
                choices: [{ delta, index: 0, finish_reason: ended ? "stop" : null }] })
            }
            function parse(text, controller, final = false) {
              lineBuffer += text
              // CRLF, LF and CR are all legal SSE line endings.
              while (true) {
                const match = /[\r\n]/.exec(lineBuffer)
                if (!match || (!final && match[0] === "\r" && match.index === lineBuffer.length - 1)) break
                const line = lineBuffer.slice(0, match.index)
                const width = lineBuffer.slice(match.index, match.index + 2) === "\r\n" ? 2 : 1
                lineBuffer = lineBuffer.slice(match.index + width)
                if (!line) dispatch(controller)
                else if (line.startsWith("event:")) eventName = line.slice(6).trim()
                else if (line.startsWith("data:")) dataLines.push(line.slice(5).replace(/^ /, ""))
              }
              if (final) {
                if (lineBuffer.startsWith("data:")) dataLines.push(lineBuffer.slice(5).replace(/^ /, ""))
                else if (lineBuffer.startsWith("event:")) eventName = lineBuffer.slice(6).trim()
                if (eventName || dataLines.length) dispatch(controller)
              }
            }
            const streamTransform = new TransformStream({
              transform(chunk, controller) { parse(decoder.decode(chunk, { stream: true }), controller) },
              flush(controller) {
                parse(decoder.decode(), controller, true)
                if (!ended && !sawError) fail(controller, upstreamError)
                if (!sawError) controller.enqueue(encoder.encode("data: [DONE]\n\n"))
              },
            })

            // 非流式聚合成一次性返回
            if (!stream) {
              const reader = upstreamRes.body.pipeThrough(streamTransform).getReader()
              let fullContent = ""
              try {
              while (true) {
                const { done, value } = await reader.read()
                if (done) break
                const rawChunk = new TextDecoder().decode(value)
                for (const l of rawChunk.split("\n")) {
                  if (l.startsWith("data: ") && !l.includes("[DONE]")) {
                    try {
                      const p = JSON.parse(l.slice(6))
                      fullContent += p.choices?.[0]?.delta?.content || ""
                    } catch {}
                  }
                }
              }
              } catch (error) {
                signal?.throwIfAborted()
                return errorResponse("WPS Lingxi upstream stream interrupted", 502, "incomplete_stream")
              } finally {
                reader.releaseLock()
              }

              if (sawError) return errorResponse(upstreamError.message, 502, upstreamError.code)
              const openAiResponse = {
                id: `chatcmpl-${Date.now()}`,
                object: "chat.completion",
                created: Math.floor(Date.now() / 1000),
                model: requestedModel,
                choices: [
                  {
                    index: 0,
                    message: { role: "assistant", content: fullContent },
                    finish_reason: "stop",
                  },
                ],
              }
              return new Response(JSON.stringify(openAiResponse), {
                headers: { "Content-Type": "application/json" },
              })
            }

            return new Response(upstreamRes.body.pipeThrough(streamTransform), {
              headers: {
                "Content-Type": "text/event-stream; charset=utf-8",
                "Cache-Control": "no-cache",
                Connection: "keep-alive",
              },
            })
          },
        }
      },

      // 4. 登录认证方式 (支持 网页拉起 或 弹窗粘贴)
      methods: [
        {
          type: "oauth",
          label: "浏览器登录 (自动抓取 Cookie)",
          async authorize() {
            let settle
            const done = new Promise((resolve) => {
              settle = resolve
            })
            let settled = false
            const controller = new AbortController()
            let state = { status: "waiting", message: "", accountId: "" }
            let server

            const finish = (result) => {
              if (settled) return
              settled = true
              settle(result)
              try { controller.abort() } catch {}
              setTimeout(() => { try { server?.close() } catch {} }, 2000)
            }

            // 归一输入 + 选一个真正接受这把 Cookie 的域名，然后结算。
            const succeed = async (raw) => {
              const cred = normalizeCredential(raw)
              if (cred.error) return { error: cred.error }
              const host = await probeBase(cred.cookie)
              state = { status: "success", message: "", accountId: cred.accountId }
              finish({
                type: "success",
                access: cred.sid,
                refresh: "",
                // Cookie 约一年有效，且没有刷新接口；真正的判据是上游 401。
                expires: Date.now() + 360 * 24 * 3600 * 1000,
                cookie: cred.cookie,
                accountId: cred.accountId,
                metadata: { sid: cred.sid, uid: cred.uid, cookieTail: cred.tail, accountId: cred.accountId, host },
              })
              return {}
            }

            server = createServer(async (req, res) => {
              const url = new URL(req.url, `http://${req.headers.host || "127.0.0.1"}`)
              if (url.pathname === "/status") {
                res.writeHead(200, { "Content-Type": "application/json" })
                res.end(JSON.stringify(state))
                return
              }
              if (url.pathname === "/callback") {
                const raw = url.searchParams.get("sid")?.trim() || url.searchParams.get("cookie")?.trim() || ""
                const result = await succeed(raw)
                if (result.error) {
                  res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" })
                  res.end(
                    '<!DOCTYPE html><html><head><meta charset="utf-8"><title>凭据无效</title></head>' +
                    '<body style="font-family:-apple-system,sans-serif;text-align:center;padding-top:60px">' +
                    '<h2 style="color:#c42b1c">凭据无效</h2>' +
                    '<p style="font-size:16px;color:#555">' + escapeHtml(result.error) + '</p>' +
                    '<p><a href="/" style="color:#0078d4">返回重试</a></p></body></html>'
                  )
                  return
                }
                res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
                res.end(
                  '<!DOCTYPE html><html><head><meta charset="utf-8"><title>授权成功</title></head>' +
                  '<body style="font-family:-apple-system,sans-serif;text-align:center;padding-top:60px">' +
                  '<h2 style="color:#107c41">✅ 授权成功</h2>' +
                  '<p style="font-size:16px;color:#555">已保存 ' + escapeHtml(state.accountId) + '，可以关闭此页</p></body></html>'
                )
                return
              }
              res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
              res.end(
                '<!DOCTYPE html><html><head><meta charset="utf-8"><title>WPS 灵犀授权</title></head>' +
                '<body style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;padding:40px;max-width:640px;margin:0 auto;color:#333;line-height:1.6">' +
                '<h2 style="color:#0078d4">WPS 灵犀授权</h2>' +
                '<p id="state">正在打开登录窗口…</p>' +
                '<ol><li>在弹出的浏览器窗口里登录 WPS（<a href="https://lingxi.wps.cn" target="_blank" style="color:#0078d4">lingxi.wps.cn</a>）；</li>' +
                '<li>登录完成后本页会自动显示成功，不需要复制任何东西。</li></ol>' +
                '<details><summary style="cursor:pointer;color:#666">浏览器没有弹出 / 自动登录失败？手动粘贴</summary>' +
                '<form action="/callback" method="GET" style="margin-top:16px">' +
                '<input name="sid" style="width:100%;box-sizing:border-box;padding:12px;font-size:14px;border:1px solid #ccc;border-radius:6px" placeholder="粘贴 wps_sid 或整段 Cookie" required />' +
                '<button type="submit" style="margin-top:12px;padding:12px 28px;font-size:15px;background:#0078d4;color:#fff;border:none;border-radius:6px;cursor:pointer">确认提交</button>' +
                '</form></details>' +
                '<script>setInterval(async function(){try{var r=await fetch("/status");var j=await r.json();var el=document.getElementById("state");if(j.status==="success"){el.textContent="已登录："+j.accountId+"，可以关闭此页";el.style.color="#107c41";}else if(j.status==="manual"){el.textContent="自动登录不可用："+j.message+"（可展开下方手动粘贴）";el.style.color="#c42b1c";}}catch(e){}},1500);</script>' +
                '</body></html>'
              )
            })

            await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
            const port = server.address().port
            const authUrl = `http://127.0.0.1:${port}/`

            exec(process.platform === "win32" ? `start ${authUrl}` : `open ${authUrl}`)

            // 后台打开独立配置的 Chrome/Edge；用户在网页里登录后自动读 wps_sid。
            void (async () => {
              try {
                const { sid, uid } = await browserLogin({ url: `${AGENT_BASE}/`, timeoutMs: 5 * 60 * 1000, signal: controller.signal })
                await succeed(`wps_sid=${sid}${uid ? `; uid=${uid}` : ""}`)
              } catch (error) {
                if (settled) return
                state = { status: "manual", message: error?.message || String(error), accountId: "" }
              }
            })()

            return {
              url: authUrl,
              instructions: "已打开浏览器登录窗口，登录后自动完成；也可以在本页手动粘贴 Cookie",
              method: "auto",
              callback: () => done,
            }
          },
        },
        {
          type: "api",
          label: "直接粘贴 Cookie (在 Magpie 弹窗中输入)",
          prompts: [
            {
              key: "sid",
              label: "wps_sid 或整段 Cookie",
              type: "password",
              placeholder: "粘贴 wps_sid 的值，或整段 Cookie（含 wps_sid=…）",
            },
          ],
          async authorize(inputs) {
            const cred = normalizeCredential(inputs?.sid)
            if (cred.error) return { type: "failed", error: cred.error }
            return {
              type: "success",
              key: cred.sid,
              cookie: cred.cookie,
              accountId: cred.accountId,
              metadata: {
                sid: cred.sid,
                uid: cred.uid,
                cookieTail: cred.tail,
                cookie: cred.cookie,
                accountId: cred.accountId,
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
  extractSid,
  extractUid,
  identityOf,
  normalizeCredential,
  resolveCookie,
  resolveBase,
  findBrowser,
  browserLogin,
  safariLogin,
  chromiumLogin,
}
