// WPS 灵犀 (Lingxi) Provider Plugin for Magpie / OpenCode
// 借鉴 Magpie 成熟插件体系（Trae / WorkBuddy / OfficeAce）
// 核心能力：动态同步灵犀网页模型、展示可用智点额度、每日自动签到与全功能 SSE 反代网关

import { createServer } from "node:http"
import { readFileSync, existsSync } from "node:fs"
import { join } from "node:path"
import { homedir } from "node:os"
import { exec } from "node:child_process"

const PROVIDER = "wps-lingxi"
const LINGXI_BASE = "https://lingxi.kdocs.cn"
const LINGXI_ICON = "data:image/png;base64,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"
const NPM = "@ai-sdk/openai-compatible"

// 灵犀上游是「聊天应用」而不是函数调用 API：模型把工具调用写在正文里，
// 用 <|FunctionCallBegin|>[{"name":...,"parameters":{...}}]<|FunctionCallEnd|> 包裹。
// 网关必须把它翻译成标准 OpenAI tool_calls，否则客户端只会看到一段原文，
// 并把这一轮当成「没有工具调用 → 正常结束」。
const TOOL_CALL_BEGIN = "<|FunctionCallBegin|>"
const TOOL_CALL_END = "<|FunctionCallEnd|>"
const TOOL_CALL_MAX_BUFFER = 1 << 20
const TOOL_BRIDGE_ENABLED = process.env.MAGPIE_LINGXI_TOOL_BRIDGE !== "0"

// 对齐灵犀网页端的原生请求字段（从线上 bundle 里还原）：
//   question / expect_model / thinking / with_mcp / with_expert / user_input
// thinking 的原生取值是 "auto" | "disabled"；reasoning_effort 才是 0/1/2。
const THINKING_OVERRIDE = process.env.MAGPIE_LINGXI_THINKING || ""
const WITH_MCP = process.env.MAGPIE_LINGXI_WITH_MCP === "1"

function thinkingModeFor(effort) {
  if (THINKING_OVERRIDE === "auto" || THINKING_OVERRIDE === "disabled") return THINKING_OVERRIDE
  return effort === "0" ? "disabled" : "auto"
}

function contentToText(content) {
  if (typeof content === "string") return content
  if (Array.isArray(content)) {
    return content.map((part) => {
      if (typeof part === "string") return part
      // 上游 completions 只收文本，图片不能静默丢掉，至少留一个可解释的占位
      if (part?.type === "image" || part?.type === "image_url" || part?.type === "input_image") return "[image]"
      return part?.text ?? ""
    }).join("")
  }
  if (content == null) return ""
  return JSON.stringify(content)
}

// 客户端下发的 tools（OpenAI 格式）→ 紧凑工具表
function normalizeTools(raw) {
  if (!Array.isArray(raw)) return []
  const out = []
  for (const item of raw) {
    const fn = item?.type === "function" ? item.function : (item?.function ?? item)
    if (!fn || typeof fn.name !== "string" || !fn.name.trim()) continue
    const description = typeof fn.description === "string" ? fn.description : ""
    out.push({
      name: fn.name,
      // 工具清单要随每轮提示词重复下发，描述过长只会白白吃掉上下文
      description: description.length > 240 ? `${description.slice(0, 240)}…` : description,
      parameters: fn.parameters ?? { type: "object", properties: {} },
    })
  }
  return out
}

// 上游只有 question 一个入口，工具清单必须写进提示词，模型才知道该调什么
function toolProtocolPrompt(tools) {
  return [
    "[工具协议 · 内部约定，不要向用户复述]",
    "你可以调用下列工具。需要调用时，只输出一个标记块，格式严格如下：",
    `${TOOL_CALL_BEGIN}[{"name":"<工具名>","parameters":{...}}]${TOOL_CALL_END}`,
    "规则：工具名与参数名必须与下面的 schema 完全一致；parameters 必须是 JSON 对象；",
    "一次可以调用多个工具（数组里放多个对象）；标记块之后不要再输出解释，等待工具结果。",
    "可用工具：",
    JSON.stringify(tools.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters }))),
  ].join("\n")
}

// 把历史里的 assistant tool_calls 还原成上游认识的信封，供多轮工具循环使用
function nativeCallBlock(toolCalls) {
  if (!Array.isArray(toolCalls) || !toolCalls.length) return ""
  const entries = []
  for (const call of toolCalls) {
    const fn = call?.function ?? call ?? {}
    let parameters = {}
    if (typeof fn.arguments === "string") {
      try { parameters = JSON.parse(fn.arguments) } catch { parameters = { raw: fn.arguments } }
    } else if (fn.arguments && typeof fn.arguments === "object") {
      parameters = fn.arguments
    }
    if (fn.name) entries.push({ name: fn.name, parameters })
  }
  if (!entries.length) return ""
  return `${TOOL_CALL_BEGIN}${JSON.stringify(entries)}${TOOL_CALL_END}`
}

// 只接受「结构合法 + 工具名在本次请求清单内」的载荷，避免模型讨论这个格式时被误触发
function parseNativeToolCalls(payload, allowed) {
  let parsed
  try { parsed = JSON.parse(payload) } catch { return null }
  const list = Array.isArray(parsed) ? parsed : [parsed]
  if (!list.length || !allowed.size) return null
  const calls = []
  for (const entry of list) {
    if (!entry || typeof entry !== "object") return null
    const name = entry.name ?? entry.tool ?? entry.function?.name
    const params = entry.parameters ?? entry.arguments ?? entry.function?.arguments
    if (typeof name !== "string" || !allowed.has(name)) return null
    let args
    if (typeof params === "string") {
      try { JSON.parse(params) } catch { return null }
      args = params
    } else if (params && typeof params === "object" && !Array.isArray(params)) {
      args = JSON.stringify(params)
    } else {
      return null
    }
    calls.push({ name, arguments: args })
  }
  return calls
}

// 最长「可能是标记前缀」的后缀长度，流式时先扣住不吐，避免标记被切断后漏到正文
function partialMarkerLength(text, marker) {
  const max = Math.min(text.length, marker.length - 1)
  for (let n = max; n > 0; n--) {
    if (text.endsWith(marker.slice(0, n))) return n
  }
  return 0
}

function createToolCallParser(allowedNames) {
  const allowed = allowedNames instanceof Set ? allowedNames : new Set(allowedNames || [])
  let buffer = ""
  let inCall = false

  function drain(out, final) {
    for (;;) {
      if (!inCall) {
        const at = buffer.indexOf(TOOL_CALL_BEGIN)
        if (at >= 0) {
          if (at > 0) out.push({ type: "text", value: buffer.slice(0, at) })
          buffer = buffer.slice(at + TOOL_CALL_BEGIN.length)
          inCall = true
          continue
        }
        const hold = final ? 0 : partialMarkerLength(buffer, TOOL_CALL_BEGIN)
        const cut = buffer.length - hold
        if (cut > 0) {
          out.push({ type: "text", value: buffer.slice(0, cut) })
          buffer = buffer.slice(cut)
        }
        return
      }
      const at = buffer.indexOf(TOOL_CALL_END)
      if (at >= 0) {
        const payload = buffer.slice(0, at)
        buffer = buffer.slice(at + TOOL_CALL_END.length)
        inCall = false
        const calls = parseNativeToolCalls(payload, allowed)
        if (calls) out.push({ type: "calls", calls })
        else if (payload) out.push({ type: "text", value: TOOL_CALL_BEGIN + payload + TOOL_CALL_END })
        continue
      }
      if (buffer.length > TOOL_CALL_MAX_BUFFER) {
        out.push({ type: "text", value: TOOL_CALL_BEGIN + buffer })
        buffer = ""
        inCall = false
        return
      }
      return
    }
  }

  return {
    push(chunk) {
      const out = []
      buffer += chunk
      drain(out, false)
      return out
    },
    flush() {
      const out = []
      drain(out, true)
      if (inCall) {
        const calls = parseNativeToolCalls(buffer, allowed)
        if (calls) out.push({ type: "calls", calls })
        else if (buffer) out.push({ type: "text", value: TOOL_CALL_BEGIN + buffer })
      } else if (buffer) {
        out.push({ type: "text", value: buffer })
      }
      buffer = ""
      inCall = false
      return out
    },
  }
}

// 灵犀官方模型表（与网页端 1:1 保持一致）
const DEFAULT_MODELS = [
  { id: "auto", name: "自动推荐 (Auto)", context: 1048576, multiplier: "1.0x", reasoning: true },
  { id: "deepseek-v4.1-flash", name: "DeepSeek V4.1 Flash", context: 1048576, multiplier: "0.12x", reasoning: true },
  { id: "deepseek-v4-flash-0731", name: "DeepSeek V4 Flash", context: 1048576, multiplier: "0.09x", reasoning: true },
  { id: "deepseek-v4-pro-0813", name: "DeepSeek V4 Pro", context: 1048576, multiplier: "0.40x", reasoning: true },
  { id: "kimi-k3", name: "Kimi-K3", context: 1048576, multiplier: "1.60x", reasoning: true },
  { id: "GLM-5.3", name: "GLM-5.3", context: 1048576, multiplier: "0.75x", reasoning: true },
  { id: "GLM-5.3-Flash", name: "GLM-5.3-Flash", context: 1048576, multiplier: "0.11x", reasoning: true },
  { id: "qwen3.8_max", name: "Qwen3.8-Max", context: 1048576, multiplier: "0.80x", reasoning: true },
  { id: "qwen3.8_flash", name: "Qwen3.8-Flash", context: 1048576, multiplier: "0.08x", reasoning: true },
  { id: "minimax_m3", name: "MiniMax-M3", context: 1048576, multiplier: "0.20x", reasoning: false },
  { id: "doubao_seed_2_1_pro_260628", name: "Doubao-Seed-2.1 Pro", context: 262144, multiplier: "0.50x", reasoning: true },
  { id: "mimo-v2.6-pro", name: "Xiaomi MiMo-V2.6 Pro", context: 1048576, multiplier: "0.10x", reasoning: false },
  { id: "plan_pro", name: "Pro 模式 (深度推理)", context: 1048576, multiplier: "1.0x", reasoning: true },
  { id: "plan_max", name: "Max 模式 (复杂任务)", context: 1048576, multiplier: "1.0x", reasoning: true },
]

// ── 原生 Agent Runtime（灵犀桌面端同款通路）────────────────────────────────
// 网页聊天接口只收一个 question 字符串；桌面客户端用的是 cowork 的 Agent Runtime：
// 收原生 messages / tools，吐原生 tool_calls / reasoning_content / usage。
// 这里按「原生优先、网页兜底」路由：模型在原生目录里就走原生，否则回落到 0.1.x 的网页通路。
const NATIVE_BASE = "https://cowork.wps.cn"
const NATIVE_MODE = (process.env.MAGPIE_LINGXI_MODE || "auto").toLowerCase() // auto | native | legacy

/** 原生模型目录：key -> { key, name, desc }；由 provider.models() 或 loader 懒加载填充 */
const nativeCatalog = new Map()

/** 网页聊天目录：key -> 模型描述；用来判定「这个 key 走哪条路」，也给模型表兜底 */
const webCatalog = new Map()

// plan_* 是「模式」不是模型：原生计费 run 不认它们（实测 HTTP 400 InvalidArgument），
// 但网页通路认。所以它们必须固定走网页通路，不能因为出现在原生目录里就路由到原生。
const PLAN_KEYS = new Set(["plan_pro", "plan_max"])

const warned = new Set()
function warnOnce(message) {
  if (warned.has(message)) return
  warned.add(message)
  console.warn(`[magpie-wps-lingxi] ${message}`)
}

// ── 单次请求的提示词预算 ────────────────────────────────────────────────
// 上游对单次请求有硬性 token 上限。越线时网页通路返回
//   event:error  {"result":"PromptTokenExceedLimit","msg":"场景token超过限制"}
// 原生通路返回 400 {"code":"AIError","message":"AI服务异常"}。
// 压平后的历史只增不减，一旦越线，之后每一轮都会失败，整个会话就废了
// （实测：原生 800KB≈139K token 正常，603KB 的混合内容直接 400）。
// 所以这里在客户端设预算，超了从最老的历史开始丢。
const MAX_PROMPT_KB = Math.max(32, Number(process.env.MAGPIE_LINGXI_MAX_PROMPT_KB || 320))
const MAX_PROMPT_BYTES = MAX_PROMPT_KB * 1024

function byteLength(text) {
  const s = typeof text === "string" ? text : String(text ?? "")
  if (typeof Buffer !== "undefined") return Buffer.byteLength(s, "utf8")
  return new TextEncoder().encode(s).length
}

// 单条历史消息的上限。实测一次 533KB 的粘贴就足以让「整条整条丢」的裁剪
// 直接跳空：丢掉那一条等于把其余全部历史一起牺牲。所以先把过长的那条
// 掐头去尾留中段标记，再去按预算丢整条。
const MAX_HISTORY_LINE_KB = Math.max(4, Number(process.env.MAGPIE_LINGXI_MAX_HISTORY_LINE_KB || 32))
const MAX_HISTORY_LINE_BYTES = MAX_HISTORY_LINE_KB * 1024

function headBytes(text, maxBytes) {
  if (typeof Buffer === "undefined") return text.slice(0, maxBytes)
  const buf = Buffer.from(text, "utf8")
  if (buf.length <= maxBytes) return text
  let end = maxBytes
  while (end > 0 && (buf[end] & 0xc0) === 0x80) end -= 1
  return buf.subarray(0, end).toString("utf8")
}

function tailBytes(text, maxBytes) {
  if (typeof Buffer === "undefined") return text.slice(-maxBytes)
  const buf = Buffer.from(text, "utf8")
  if (buf.length <= maxBytes) return text
  let start = buf.length - maxBytes
  while (start < buf.length && (buf[start] & 0xc0) === 0x80) start += 1
  return buf.subarray(start).toString("utf8")
}

function elideLongLine(line) {
  const size = byteLength(line)
  if (size <= MAX_HISTORY_LINE_BYTES) return line
  const headBudget = Math.floor(MAX_HISTORY_LINE_BYTES * 0.6)
  const tailBudget = MAX_HISTORY_LINE_BYTES - headBudget
  return `${headBytes(line, headBudget)}\n…[本条历史过长已截断：原 ${(size / 1024).toFixed(0)}KB]…\n${tailBytes(line, tailBudget)}`
}

// 这些错误重试没有意义，Magpie 默认会重试 7 次（每次白等 7 秒再报 502）
const NON_RETRYABLE_CODES = new Set([
  "PromptTokenExceedLimit",
  "prompt_token_exceed_limit",
  "ContentFilter",
  "invalid_reasoning_effort",
])

function statusForCode(code, fallback = 502) {
  return NON_RETRYABLE_CODES.has(String(code ?? "")) ? 400 : fallback
}

/**
 * 被原生计费接口拒绝过的 key。cowork 目录里列了 6 个模型，但实测只有
 * deepseek-v4-* / kimi-k2.6 能领到 run_id；GLM-5.1、GLM-5-Turbo、plan_*
 * 一律 400 InvalidArgument。它们在网页通路上都能正常跑，所以首次被拒后
 * 记住并降级，而不是把这个 key 变成「一点就报错」。
 */
const nativeRejected = new Set()

/**
 * 单模型路由判定：原生优先，plan_* 例外，目录里没有的 key 走网页兜底。
 * 两条通路的 usage / tool_calls / reasoning 语义完全不同，路由必须是可解释的。
 */
function routeFor(modelKey) {
  if (NATIVE_MODE === "legacy") return "legacy"
  if (PLAN_KEYS.has(modelKey)) return "legacy"
  if (nativeRejected.has(modelKey)) return "legacy"
  if (nativeCatalog.has(modelKey)) return "native"
  if (NATIVE_MODE === "native" && nativeCatalog.size) return "native"
  return "legacy"
}

function routeHeaders(route, modelKey) {
  return { "X-Lingxi-Route": route, "X-Lingxi-Model": modelKey }
}

function withRoute(res, route, modelKey) {
  try {
    const headers = new Headers(res.headers)
    for (const [k, v] of Object.entries(routeHeaders(route, modelKey))) headers.set(k, v)
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers })
  } catch {
    return res
  }
}

let catalogWarm = null
/** models() 没跑过（或跑失败）时，loader 自己把原生目录预热一次 */
function warmNativeCatalog(cookie, signal) {
  if (nativeCatalog.size) return Promise.resolve()
  if (!catalogWarm) {
    catalogWarm = fetchNativeCatalog(cookie, signal)
      .catch((error) => {
        warnOnce(`原生模型目录不可用，本次按网页通路处理：${error.message}`)
      })
      .finally(() => {
        catalogWarm = null
      })
  }
  return catalogWarm
}

function nativeHeaders(cookie, extra = {}) {
  return {
    Cookie: cookie,
    "Content-Type": "application/json",
    "X-Client-Type": "wps_separate",
    "X-Cc-Agent-Type": "lingxi_claw",
    ...extra,
  }
}

async function fetchNativeCatalog(cookie, signal) {
  const res = await fetch(`${NATIVE_BASE}/api/aioffice/v1/sessions/plans`, {
    headers: { Cookie: cookie, "X-Client-Type": "wps_separate" },
    signal,
  })
  if (!res.ok) throw new Error(`native catalog: HTTP ${res.status}`)
  const json = await res.json()
  const data = json?.data || {}
  const list = []
  for (const m of data.models || []) {
    if (m?.key) list.push({ key: m.key, name: m.name || m.key, desc: m.desc || "" })
  }
  for (const p of data.plans || []) {
    if (p?.key) list.push({ key: p.key, name: p.name || p.key, desc: p.desc || "" })
  }
  if (!list.length) throw new Error("native catalog is empty")
  nativeCatalog.clear()
  for (const m of list) nativeCatalog.set(m.key, m)
  return list
}

// 原生接口的推理档位是 low/high/max；网页通路是 0/1/2，两边都要认
const NATIVE_EFFORT = { low: "low", high: "high", max: "max", "0": "low", "1": "high", "2": "max" }

function splitSystemMessages(messages) {
  const system = []
  const rest = []
  for (const m of messages) {
    const role = m?.role
    if (role === "system" || role === "developer") {
      const text = contentToText(m.content).trim()
      if (text && !system.includes(text)) system.push(text)
      continue
    }
    rest.push(m)
  }
  return { context: system.join("\n\n"), messages: rest }
}

function toNativeMessages(messages) {
  const out = []
  for (const m of messages) {
    const role = m?.role
    if (role === "assistant") {
      const entry = { role: "assistant", content: contentToText(m.content) }
      if (Array.isArray(m.tool_calls) && m.tool_calls.length) entry.tool_calls = m.tool_calls
      if (typeof m.reasoning_content === "string" && m.reasoning_content) entry.reasoning_content = m.reasoning_content
      out.push(entry)
    } else if (role === "tool" || role === "function") {
      out.push({ role: "tool", tool_call_id: m.tool_call_id || m.id || "", content: contentToText(m.content) })
    } else if (role === "user") {
      out.push({ role: "user", content: contentToText(m.content) })
    }
  }
  return out
}

function nativePayload(body, modelKey) {
  const { context, messages } = splitSystemMessages(body.messages || [])
  const args = {}
  if (Number.isFinite(body.max_tokens)) args.max_tokens = body.max_tokens
  if (Number.isFinite(body.temperature)) args.temperature = body.temperature
  if (Number.isFinite(body.top_p)) args.top_p = body.top_p
  if (Array.isArray(body.stop)) args.stop = body.stop

  const payload = {
    stream: body.stream !== false,
    model: modelKey,
    messages: toNativeMessages(messages),
    base_llm_arguments: args,
    sec_text: { from: "AI_WPS_SMARTASSISTANT", scene: "soul_claw" },
  }
  if (context) payload.context = context
  if (Array.isArray(body.tools) && body.tools.length) payload.tools = body.tools
  if (body.tool_choice) payload.tool_choice = body.tool_choice
  const effort = NATIVE_EFFORT[String(body.reasoning_effort ?? body.reasoningEffort ?? "").toLowerCase()]
  if (effort) payload.reasoning_effort = effort
  return payload
}

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } })
}

/**
 * 原生通路同样要控预算：实测 603KB 的 messages 会被上游直接 400 AIError。
 * 从最老的消息开始丢，但永远保留最后一条（当前请求）。
 */
function fitNativePayload(payload) {
  const sizeOf = (m) => byteLength(m.content) + (Array.isArray(m.tool_calls) ? byteLength(JSON.stringify(m.tool_calls)) : 0)
  let total = byteLength(payload.context || "")
  if (Array.isArray(payload.tools)) total += byteLength(JSON.stringify(payload.tools))
  const sizes = payload.messages.map(sizeOf)
  total += sizes.reduce((a, b) => a + b, 0)
  if (total <= MAX_PROMPT_BYTES) return { dropped: 0, overflow: false }

  let start = 0
  while (total > MAX_PROMPT_BYTES && payload.messages.length - start > 1) {
    total -= sizes[start]
    start += 1
  }
  payload.messages = payload.messages.slice(start)
  return { dropped: start, overflow: total > MAX_PROMPT_BYTES }
}

// 原生通路：① credits/runs 领 run_id → ② agent-runtime/chat/completions → ③ 转成 OpenAI 形状
async function nativeCompletion({ body, cookie, signal, modelKey }) {
  const stream = body.stream !== false
  const payload = nativePayload(body, modelKey)
  const fit = fitNativePayload(payload)
  if (fit.overflow) {
    return jsonResponse({
      error: {
        message: `本轮请求本身超过上游长度上限（预算 ${MAX_PROMPT_KB}KB）：SYSTEM/工具清单/当前消息太大。` +
          `可调大 MAGPIE_LINGXI_MAX_PROMPT_KB。`,
        type: "upstream_error",
        code: "prompt_token_exceed_limit",
      },
    }, 400)
  }
  if (fit.dropped > 0) warnOnce(`原生通路历史超出 ${MAX_PROMPT_KB}KB 预算，已丢弃更早的消息`)
  // 每请求一个独立 session：实测同 session 并发 8 路也正常（无互斥、无串扰），
  // 独立 session 只是为了不依赖任何服务端会话状态，代价为零。
  const sessionId = String(Date.now()) + String(Math.floor(Math.random() * 100)).padStart(2, "0")

  let runRes
  try {
    runRes = await fetch(`${NATIVE_BASE}/api/public/v1/credits/runs`, {
      method: "POST",
      signal,
      headers: nativeHeaders(cookie, { "X-Cc-Session-ID": sessionId }),
      body: JSON.stringify({
        client_type: "wps_separate",
        client_request_id: String(Date.now()),
        session_id: sessionId,
        model_provider: "lingxi",
        model_id: modelKey,
      }),
    })
  } catch (error) {
    signal?.throwIfAborted()
    return jsonResponse({ error: { message: `WPS 灵犀计费 run 请求失败: ${error.message}`, type: "upstream_error" } }, 502)
  }
  if (!runRes.ok) {
    const text = await runRes.text().catch(() => "")
    return jsonResponse({
      error: { message: `WPS 灵犀计费 run 被拒: HTTP ${runRes.status} ${text.slice(0, 200)}`, type: "upstream_error" },
    }, runRes.status)
  }
  const runJson = await runRes.json().catch(() => ({}))
  const runId = runJson?.data?.run_id
  if (!runId) {
    return jsonResponse({ error: { message: "WPS 灵犀未返回 run_id", type: "upstream_error" } }, 502)
  }

  let chatRes
  try {
    chatRes = await fetch(`${NATIVE_BASE}/api/public/v1/agent-runtime/chat/completions`, {
      method: "POST",
      signal,
      headers: nativeHeaders(cookie, {
        Accept: "text/event-stream",
        "X-Cc-Session-ID": sessionId,
        "X-Cc-Run-ID": String(runId),
        "AI-Gateway-Product-Name": "wps-public-pc",
        "AI-Gateway-Intention-Code": "wps_public_home_agentconversation",
        "X-Client-Lang": "zh-CN",
        "X-Request-Id": cryptoRandomId(),
      }),
      body: JSON.stringify(payload),
    })
  } catch (error) {
    signal?.throwIfAborted()
    return jsonResponse({ error: { message: `WPS 灵犀原生接口不可达: ${error.message}`, type: "upstream_error" } }, 502)
  }
  if (!chatRes.ok) {
    const text = await chatRes.text().catch(() => "")
    return jsonResponse({
      error: { message: `WPS 灵犀原生接口异常: HTTP ${chatRes.status} ${text.slice(0, 200)}`, type: "upstream_error" },
    }, chatRes.status)
  }

  if (!stream) {
    const json = await chatRes.json().catch(() => null)
    const choice = json?.choices?.[0] || {}
    const message = { role: "assistant", content: choice.text || null }
    if (choice.reasoning_content) message.reasoning_content = choice.reasoning_content
    if (Array.isArray(choice.tool_calls) && choice.tool_calls.length) message.tool_calls = choice.tool_calls
    return jsonResponse({
      id: `chatcmpl-${Date.now()}`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: modelKey,
      choices: [{ index: 0, message, finish_reason: choice.finish_reason || "stop" }],
      ...(json?.usage ? { usage: normalizeUsage(json.usage) } : {}),
    })
  }

  const encoder = new TextEncoder()
  const decoder = new TextDecoder()
  const completionId = `chatcmpl-${Date.now()}`
  let buffer = ""
  let done = false

  const emit = (controller, delta, finishReason = null, usage) => {
    const value = {
      id: completionId,
      object: "chat.completion.chunk",
      created: Math.floor(Date.now() / 1000),
      model: modelKey,
      choices: [{ delta, index: 0, finish_reason: finishReason }],
    }
    if (usage) value.usage = usage
    controller.enqueue(encoder.encode(`data: ${JSON.stringify(value)}\n\n`))
  }

  const handle = (controller, line) => {
    if (!line.startsWith("data:")) return
    const raw = line.slice(5).trim()
    if (!raw || raw === "[DONE]") return
    let item
    try { item = JSON.parse(raw) } catch { return }
    if (item.code && item.code !== "Success") {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: { message: item.message || item.code, type: "upstream_error", code: item.code } })}\n\n`))
      done = true
      return
    }
    const choice = item.choices?.[0] || {}
    if (choice.reasoning_content) emit(controller, { reasoning_content: choice.reasoning_content })
    if (choice.text) emit(controller, { content: choice.text })
    if (Array.isArray(choice.tool_calls) && choice.tool_calls.length) {
      emit(controller, { tool_calls: choice.tool_calls })
    }
    if (choice.finish_reason) {
      done = true
      emit(controller, {}, choice.finish_reason, item.usage ? normalizeUsage(item.usage) : undefined)
    }
  }

  const transform = new TransformStream({
    transform(chunk, controller) {
      buffer += decoder.decode(chunk, { stream: true })
      let index
      while ((index = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, index).replace(/\r$/, "")
        buffer = buffer.slice(index + 1)
        if (line.trim()) handle(controller, line)
      }
    },
    flush(controller) {
      const tail = (buffer + decoder.decode()).trim()
      if (tail) handle(controller, tail)
      if (!done) emit(controller, {}, "stop")
      controller.enqueue(encoder.encode("data: [DONE]\n\n"))
    },
  })

  return new Response(chatRes.body.pipeThrough(transform), {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  })
}

function normalizeUsage(usage) {
  return {
    prompt_tokens: Number(usage.prompt_tokens || 0),
    completion_tokens: Number(usage.completion_tokens || 0),
    total_tokens: Number(usage.total_tokens || 0),
    ...(usage.cached_tokens ? { prompt_tokens_details: { cached_tokens: Number(usage.cached_tokens) } } : {}),
  }
}

function cryptoRandomId() {
  try {
    return globalThis.crypto.randomUUID()
  } catch {
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`
  }
}

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

function modelOf(provider, m, opts = {}) {
  const route = opts.route === "native" ? "native" : "legacy"
  // 网页通路实测不吐 reasoning 流（4 个模型 × 2 档位全为 0 帧），只有原生通路
  // 才有真实 reasoning_content —— 所以推理档位只在原生通路上暴露，避免假装支持。
  const isReasoning = route === "native" && !!(m.reasoning || (m.reasoning_efforts && m.reasoning_efforts.length > 0))
  const multiplierText = m.multiplier ? ` [${m.multiplier}]` : ""
  const routeText = route === "native" ? " · 原生" : " · 网页"
  return {
    id: m.id || m.key,
    providerID: provider.id,
    name: `${m.name}${multiplierText}${routeText}`,
    api: { id: m.id || m.key, url: `${LINGXI_BASE}/api`, npm: NPM },
    status: "active",
    headers: {},
    options: {},
    cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
    limit: { context: m.max_context_tokens || m.context || 1048576, output: m.max_new_tokens || 65536 },
    capabilities: {
      temperature: true,
      reasoning: isReasoning,
      attachment: !!m.support_multimodal,
      toolcall: true,
      input: { text: true, image: !!m.support_multimodal, audio: false, video: false, pdf: false },
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

// 登录凭据解析：用户粘贴的可能是裸 wps_sid、`wps_sid=…`、整段
// `Cookie: wps_sid=…; uid=…`，或 DevTools 里复制的一整行。统一归一成
// `wps_sid=…; uid=…`，并按 uid（没有就按 sid 尾部）区分账号 —— 固定
// accountId 会让第二个账号覆盖第一个。
export function parseCookieInput(raw) {
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
  const cookie = `wps_sid=${sid}${uid ? `; uid=${uid}` : ""}`
  const accountId = uid ? `wps-${uid}` : `wps-${sid.slice(-8)}`
  return { sid, uid, cookie, accountId }
}

function resolveCookie(auth) {
  if (!auth) return ""
  const cred = parseCookieInput(auth.cookie || auth.metadata?.cookie || auth.key || auth.access || "")
  return cred ? cred.cookie : ""
}

// 动态拉取网页端可用模型
async function fetchLiveModels(cookie) {
  try {
    const res = await fetch(`${LINGXI_BASE}/api/aioffice/v1/sessions/plans`, {
      headers: {
        Cookie: cookie,
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        Referer: "https://lingxi.kdocs.cn/",
      },
    })
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

    if (list.length) {
      webCatalog.clear()
      for (const m of list) webCatalog.set(m.id, m)
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
      // 原生通路用 cowork 的模型目录（key/name/desc），网页通路用灵犀网页的模型表
      // 模型表是「原生 ∪ 网页」的并集：原生目录质量高但只有 6 个模型，
      // 网页目录有 11 个（Kimi K3.1 Pro、Qwen3.8、MiMo…只在网页里）。
      // 两个都列出来，名字后缀标明走哪条通路，路由由 routeFor() 决定。
      async models(provider, { auth } = {}) {
        const cookie = resolveCookie(auth)
        const out = {}

        if (cookie && NATIVE_MODE !== "legacy") {
          try {
            const list = await fetchNativeCatalog(cookie)
            for (const m of list) {
              out[m.key] = modelOf(provider, {
                id: m.key,
                name: m.name,
                desc: m.desc,
                context: 1048576,
                reasoning: true,
              }, { route: routeFor(m.key) })
            }
          } catch (error) {
            // 原生目录挂了不能把整张表清空：网页目录仍然可用，loader 也会回落
            warnOnce(`原生模型目录不可用，本次只列出网页通路模型：${error.message}`)
          }
        }

        if (cookie) {
          const live = await fetchLiveModels(cookie)
          for (const m of live) {
            if (out[m.id]) continue // 原生目录已覆盖，保留原生路由
            out[m.id] = modelOf(provider, m, { route: routeFor(m.id) })
          }
        }

        if (Object.keys(out).length) return out
        return Object.fromEntries(DEFAULT_MODELS.map((m) => [m.id, modelOf(provider, m, { route: "legacy" })]))
      },
    },

    auth: {
      provider: PROVIDER,
      icon: LINGXI_ICON,

      // 1. 每日自动签到 (每日签到获取智点)
      async checkin(getAuth) {
        const auth = await getAuth()
        const cookie = resolveCookie(auth)
        if (!cookie) {
          return { outcome: "failed", message: "未配置 WPS Cookie，无法签到" }
        }

        try {
          const taskRes = await fetch(`${LINGXI_BASE}/api/public/v1/tasks`, {
            headers: {
              Cookie: cookie,
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
              Referer: "https://lingxi.kdocs.cn/",
            },
          })

          if (!taskRes.ok) {
            return { outcome: "failed", message: `任务中心响应 HTTP ${taskRes.status}` }
          }

          const taskJson = await taskRes.json()
          if (taskJson.result === "UserUnauthorized") {
            return { outcome: "failed", message: "WPS 登录凭据失效，请重新登录" }
          }

          const tasks = taskJson?.data?.tasks || []
          const dailyTask = tasks.find((t) => t.task_key === "daily_check_in")
          const totalCredits = taskJson?.data?.total_claimed_credits || 0

          if (!dailyTask) {
            return { outcome: "failed", message: "未找到每日签到任务" }
          }

          const extra = dailyTask.extra || {}
          const streak = extra.consecutive_days || 1

          if (dailyTask.status === "claimed") {
            return {
              outcome: "claimed",
              credit: 0,
              streak,
              message: `今日已完成签到 (累计积分: ${totalCredits} 智点，已连续签到 ${streak} 天)`,
            }
          }

          const dateStr = getTodayString()
          const claimRes = await fetch(`${LINGXI_BASE}/api/public/v1/tasks/daily_check_in/claim?date=${dateStr}`, {
            method: "POST",
            headers: {
              Cookie: cookie,
              "Content-Type": "application/json",
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
              Referer: "https://lingxi.kdocs.cn/",
            },
          })

          const claimJson = await claimRes.json()
          if (claimJson.result === "ok") {
            const reward = claimJson?.data?.extra?.today_reward || dailyTask.reward_amount || 100
            const currentTotal = claimJson?.data?.total_claimed_credits || totalCredits + reward
            return {
              outcome: "claimed",
              credit: reward,
              streak: streak + 1,
              message: `签到成功！获得 +${reward} 智点 (总计: ${currentTotal} 智点)`,
            }
          }

          return { outcome: "failed", message: claimJson.hint || "签到失败" }
        } catch (e) {
          return { outcome: "failed", message: `签到异常: ${e.message}` }
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
          const res = await fetch(`${LINGXI_BASE}/api/public/v1/credits/balance`, {
            headers: {
              Cookie: cookie,
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
              Referer: "https://lingxi.kdocs.cn/",
            },
          })

          if (res.status === 401) {
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

            // 原生通路优先，但路由表可能还没预热（models() 没跑过或跑失败过）。
            // 不懒加载的话，所有模型都会静默落到网页通路 —— 而两条通路的
            // usage / tool_calls / reasoning 语义完全不同，静默降级无法排查。
            if (NATIVE_MODE !== "legacy" && cookie && !nativeCatalog.size) {
              await warmNativeCatalog(cookie, signal)
            }

            const route = routeFor(requestedModel)
            if (route === "native") {
              let nativeRes
              try {
                nativeRes = await nativeCompletion({ body, cookie, signal, modelKey: requestedModel })
              } catch (error) {
                signal?.throwIfAborted()
                return errorResponse(`WPS 灵犀原生接口异常: ${error.message}`)
              }
              // credits/runs 对「目录里有、但网关没给这个账号开通」的 key 统一回
              // 400 InvalidArgument。这类 key 在网页通路上是能跑的，所以降级重试一次，
              // 并记住它，后续直接走网页通路 —— 而不是让用户每次点都吃 400。
              if (nativeRes.status === 400) {
                const detail = await nativeRes.clone().text().catch(() => "")
                if (detail.includes("InvalidArgument")) {
                  nativeRejected.add(requestedModel)
                  warnOnce(`模型 ${requestedModel} 被原生计费接口拒绝（InvalidArgument），本次改走网页通路`)
                } else {
                  return withRoute(nativeRes, "native", requestedModel)
                }
              } else {
                return withRoute(nativeRes, "native", requestedModel)
              }
            }

            if (!nativeCatalog.has(requestedModel) && !webCatalog.has(requestedModel) && !PLAN_KEYS.has(requestedModel)) {
              warnOnce(`模型 ${requestedModel} 不在任何目录里，按网页通路处理`)
            }

            const tools = TOOL_BRIDGE_ENABLED ? normalizeTools(body.tools) : []
            const toolNames = new Set(tools.map((t) => t.name))

            // 上游只接受一个 question 文本，结构化对话必须压平；但压平不等于抹平：
            // system 单独成段放最前、工具清单独立成段、历史与当前请求分开，
            // 模型才不会把系统指令当成“引用的历史文本”，也不会把工具表当成闲聊内容。
            function renderMessage(m) {
              const text = contentToText(m?.content)
              if (m?.role === "assistant") {
                const body = [text, nativeCallBlock(m.tool_calls)].filter(Boolean).join("\n")
                return body ? `Assistant: ${body}` : ""
              }
              if (m?.role === "tool" || m?.role === "function") {
                return `Tool (${m?.name || m?.tool_call_id || "tool"}): ${text}`
              }
              return `User: ${text}`
            }

            // 同一段 system 在多轮里会重复下发，去重后只保留一份
            const systemTexts = []
            for (const m of messages) {
              if (m?.role !== "system" && m?.role !== "developer") continue
              const text = contentToText(m.content).trim()
              if (text && !systemTexts.includes(text)) systemTexts.push(text)
            }

            // 最后一条是用户消息 → 它才是本次请求；否则（工具结果回灌等）整段按时间顺序保留，
            // 补一句“继续”，避免把 assistant/tool 消息排到请求前面去。
            const trailing = messages.length ? messages[messages.length - 1] : null
            const endsWithUser = trailing?.role === "user"
            let request
            let historyMessages = messages
            if (endsWithUser) {
              request = contentToText(trailing.content)
              historyMessages = messages.slice(0, -1)
            } else if (!messages.length) {
              request = "你好"
            } else if (trailing?.role === "tool" || trailing?.role === "function") {
              request = "（工具已返回结果，请据此继续，不要重复调用同一个工具。）"
            } else {
              request = "（请继续。）"
            }

            // 从最老的一端整条整条地丢，保留一段「最新的连续历史」。
            // 不能挑着丢：assistant 的 tool_calls 和紧跟其后的 tool 结果必须成对，
            // 中间挖洞会让上游直接拒绝。过长的那一条先掐头去尾，避免「丢一条等于丢全部」。
            const history = []
            let elided = 0
            for (const m of historyMessages) {
              const role = m?.role
              if (role === "system" || role === "developer") continue
              const line = renderMessage(m)
              if (!line) continue
              if (byteLength(line) > MAX_HISTORY_LINE_BYTES) {
                elided += 1
                history.push(elideLongLine(line))
              } else {
                history.push(line)
              }
            }

            const systemSection = systemTexts.length ? `SYSTEM:\n${systemTexts.join("\n\n")}` : ""
            const toolsSection = tools.length ? `TOOLS:\n${toolProtocolPrompt(tools)}` : ""
            const requestSection = `User: ${request}`

            // 先算「不可省略」的部分：SYSTEM + TOOLS + 本次请求。
            const fixedBytes = byteLength([systemSection, toolsSection, requestSection].filter(Boolean).join("\n\n"))
            if (fixedBytes > MAX_PROMPT_BYTES) {
              return errorResponse(
                `本轮请求本身就超过上游长度上限（${(fixedBytes / 1024).toFixed(0)}KB > ${MAX_PROMPT_KB}KB）：` +
                `SYSTEM/工具清单/当前消息太大。可调大 MAGPIE_LINGXI_MAX_PROMPT_KB，或换用原生通路的模型。`,
                400,
                "prompt_token_exceed_limit",
              )
            }

            // 从最老的一端整条整条地丢，保留一段「最新的连续历史」。
            // 不能挑着丢：assistant 的 tool_calls 和紧跟其后的 tool 结果必须成对，
            // 中间挖洞会让上游直接拒绝。
            const renderedHistory = history.join("\n\n")
            let totalBytes = fixedBytes + (history.length ? byteLength(renderedHistory) + 2 : 0)
            let start = 0
            while (totalBytes > MAX_PROMPT_BYTES && start < history.length) {
              totalBytes -= byteLength(history[start]) + 2
              start += 1
            }
            const keptHistory = history.slice(start)
            const dropped = start

            const sections = []
            if (systemSection) sections.push(systemSection)
            if (toolsSection) sections.push(toolsSection)
            if (dropped > 0 || elided > 0) {
              const notes = []
              if (dropped > 0) notes.push(`更早的 ${dropped} 条消息被省略`)
              if (elided > 0) notes.push(`${elided} 条过长消息被截断`)
              sections.push(`[历史已压缩：${notes.join("，")}（上游单次请求长度上限 ${MAX_PROMPT_KB}KB）]`)
              warnOnce(`网页通路历史超出 ${MAX_PROMPT_KB}KB 预算，已压缩历史（省略 ${dropped} 条 / 截断 ${elided} 条）`)
            }
            if (keptHistory.length) sections.push(keptHistory.join("\n\n"))
            sections.push(requestSection)
            const question = sections.join("\n\n")

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
              const sessRes = await fetch(`${LINGXI_BASE}/api/aigc/v3/assistant/sessions`, {
                method: "POST",
                signal,
                headers: {
                  Cookie: cookie,
                  "Content-Type": "application/json",
                  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                  Referer: "https://lingxi.kdocs.cn/",
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
                // 网页端用 expect_model 指定模型；model 只是兼容旧行为的别名
                expect_model: requestedModel,
                model: requestedModel,
                thinking: thinkingModeFor(normalizedEffort),
                with_mcp: WITH_MCP,
                with_expert: false,
              }
              // 以前这里还有 user_input: { text: question } —— 和 question 完全相同，
              // 等于把整段压平后的提示发了两遍。实测上游只认 question、user_input 可省略
              // （question 说 A、user_input.text 说 B 时模型回答 A；整个字段删掉也正常）。
              if (normalizedEffort !== undefined) payload.reasoning_effort = normalizedEffort

              return fetch(`${LINGXI_BASE}/api/aigc/v3/assistant/sessions/${sessId}/completions`, {
                method: "POST",
                signal,
                headers: {
                  Cookie: cookie,
                  "Content-Type": "application/json",
                  "X-Cc-Version": "1",
                  "X-Client-Type": "lingxi-web",
                  "X-Cc-Entrance": "default",
                  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                  Referer: "https://lingxi.kdocs.cn/",
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
            const toolParser = createToolCallParser(toolNames)
            let toolCallCount = 0
            function emit(controller, value) {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(value)}\n\n`))
            }
            function chunk(delta, finishReason = null) {
              return {
                id: completionId, object: "chat.completion.chunk",
                created: Math.floor(Date.now() / 1000), model: requestedModel,
                choices: [{ delta, index: 0, finish_reason: finishReason }],
              }
            }
            function emitEvents(controller, events) {
              for (const event of events) {
                if (event.type === "text") {
                  if (event.value) emit(controller, chunk({ content: event.value }))
                  continue
                }
                for (const call of event.calls) {
                  const index = toolCallCount++
                  emit(controller, chunk({
                    tool_calls: [{
                      index,
                      id: `call_${completionId.slice(-13)}_${index}`,
                      type: "function",
                      function: { name: call.name, arguments: call.arguments },
                    }],
                  }))
                }
              }
            }
            function emitText(controller, text) {
              emitEvents(controller, toolParser.push(text))
            }
            function flushText(controller) {
              emitEvents(controller, toolParser.flush())
            }
            function fail(controller, detail) {
              if (sawError) return
              sawError = true
              // 灵犀的错误帧用的是 { result, msg }，不是 { code, message }：
              //   event:error  data:{"result":"PromptTokenExceedLimit","msg":"场景token超过限制"}
              // 之前只读 message/hint，整条信息被吞成一句 "WPS Lingxi upstream error"，
              // 客户端只能看到 502 并反复重试，完全查不出原因。
              const code = detail?.code || detail?.result || "upstream_error"
              const message = detail?.message || detail?.msg || detail?.hint || detail?.result || "WPS Lingxi upstream error"
              upstreamError = { message: String(message), type: "upstream_error", code: String(code) }
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
              if (item.type === "reasoning" || item.type === "text") {
                const value = typeof item.data === "object" ? item.data?.text || "" : String(item.data ?? "")
                if (item.type === "text") emitText(controller, value)
                else emit(controller, chunk({ reasoning_content: value }))
                return
              }
              if (item.type === "end" || item.type === "text_end") {
                ended = true
                flushText(controller)
                emit(controller, chunk({}, toolCallCount ? "tool_calls" : "stop"))
              }
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
              const toolCalls = []
              try {
              while (true) {
                const { done, value } = await reader.read()
                if (done) break
                const rawChunk = new TextDecoder().decode(value)
                for (const l of rawChunk.split("\n")) {
                  if (l.startsWith("data: ") && !l.includes("[DONE]")) {
                    try {
                      const p = JSON.parse(l.slice(6))
                      const delta = p.choices?.[0]?.delta
                      fullContent += delta?.content || ""
                      for (const call of delta?.tool_calls || []) {
                        const slot = (toolCalls[call.index] ??= {
                          id: call.id, type: "function", function: { name: "", arguments: "" },
                        })
                        if (call.id) slot.id = call.id
                        if (call.function?.name) slot.function.name += call.function.name
                        if (call.function?.arguments) slot.function.arguments += call.function.arguments
                      }
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

              // 提示词超限这类错误重试没有意义，回 400 让上层别白跑 7 次
              if (sawError) return errorResponse(upstreamError.message, statusForCode(upstreamError.code), upstreamError.code)
              const hasToolCalls = toolCalls.length > 0
              const openAiResponse = {
                id: `chatcmpl-${Date.now()}`,
                object: "chat.completion",
                created: Math.floor(Date.now() / 1000),
                model: requestedModel,
                choices: [
                  {
                    index: 0,
                    message: {
                      role: "assistant",
                      content: hasToolCalls ? (fullContent || null) : fullContent,
                      ...(hasToolCalls ? { tool_calls: toolCalls } : {}),
                    },
                    finish_reason: hasToolCalls ? "tool_calls" : "stop",
                  },
                ],
              }
              return new Response(JSON.stringify(openAiResponse), {
                headers: { "Content-Type": "application/json", ...routeHeaders("legacy", requestedModel) },
              })
            }

            return new Response(upstreamRes.body.pipeThrough(streamTransform), {
              headers: {
                "Content-Type": "text/event-stream; charset=utf-8",
                "Cache-Control": "no-cache",
                Connection: "keep-alive",
                ...routeHeaders("legacy", requestedModel),
              },
            })
          },
        }
      },

      // 4. 登录认证方式 (支持 网页拉起 或 弹窗粘贴)
      methods: [
        {
          type: "oauth",
          label: "网页授权 (自动拉起浏览器配置页)",
          async authorize() {
            let settle
            const done = new Promise((resolve) => {
              settle = resolve
            })

            const server = createServer((req, res) => {
              const url = new URL(req.url, `http://${req.headers.host}`)
              if (url.pathname === "/callback") {
                const cred = parseCookieInput(url.searchParams.get("sid")?.trim() || "")
                if (!cred) {
                  res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" })
                  res.end(`
                  <!DOCTYPE html>
                  <html>
                  <head><meta charset="utf-8"><title>凭据无效</title></head>
                  <body style="font-family: -apple-system, sans-serif; text-align: center; padding-top: 60px;">
                    <h2 style="color: #c42b1c">凭据无效</h2>
                    <p style="font-size: 16px; color: #555">没有找到 wps_sid，请复制 Cookie 里的 wps_sid 值后重试。</p>
                  </body>
                  </html>
                `)
                  return
                }
                res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
                res.end(`
                  <!DOCTYPE html>
                  <html>
                  <head><meta charset="utf-8"><title>授权成功</title></head>
                  <body style="font-family: -apple-system, sans-serif; text-align: center; padding-top: 60px;">
                    <h2 style="color: #107c41;">✅ 授权成功！</h2>
                    <p style="font-size: 16px; color: #555;">已成功保存 WPS 灵犀凭据，您可以关闭此网页返回 Magpie。</p>
                  </body>
                  </html>
                `)
                setTimeout(() => server.close(), 1500)
                settle({
                  type: "success",
                  access: cred.sid,
                  refresh: "",
                  // 没有刷新接口；Cookie 实测约一年有效，旧的 30 天会在仍可用时被当成过期。
                  expires: Date.now() + 360 * 24 * 3600 * 1000,
                  cookie: cred.cookie,
                  accountId: cred.accountId,
                  metadata: { sid: cred.sid, uid: cred.uid, accountId: cred.accountId },
                })
              } else {
                res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
                res.end(`
                  <!DOCTYPE html>
                  <html>
                  <head><meta charset="utf-8"><title>WPS 灵犀授权 - Magpie</title></head>
                  <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 40px; max-width: 600px; margin: 0 auto; color: #333; line-height: 1.6;">
                    <h2 style="color: #0078d4;">WPS 灵犀授权向导</h2>
                    <p>请按以下步骤获取凭证：</p>
                    <ol>
                      <li>在浏览器新标签页中打开并登录 <a href="https://lingxi.kdocs.cn" target="_blank" style="color: #0078d4; font-weight: 600;">lingxi.kdocs.cn</a>；</li>
                      <li>按 <code>F12</code> 打开开发者工具，切换到【应用 / Application】->【Cookie】；</li>
                      <li>找到 <code>wps_sid</code> 项，复制其值并粘贴到下方输入框：</li>
                    </ol>
                    <form action="/callback" method="GET" style="margin-top: 24px;">
                      <input name="sid" style="width: 100%; box-sizing: border-box; padding: 12px; font-size: 14px; border: 1px solid #ccc; border-radius: 6px;" placeholder="粘贴 wps_sid 或完整 Cookie" required autofocus />
                      <button type="submit" style="margin-top: 16px; padding: 12px 28px; font-size: 15px; background: #0078d4; color: #fff; border: none; border-radius: 6px; cursor: pointer; font-weight: 500;">确认提交授权</button>
                    </form>
                  </body>
                  </html>
                `)
              }
            })

            await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
            const port = server.address().port
            const authUrl = `http://127.0.0.1:${port}/`

            exec(process.platform === "win32" ? `start ${authUrl}` : `open ${authUrl}`)

            return {
              url: authUrl,
              instructions: "请在打开的网页中输入并确认 WPS 灵犀凭据",
              method: "auto",
              callback: () => done,
            }
          },
        },
        {
          type: "api",
          label: "直接粘贴凭据 (在 Magpie 弹窗中输入)",
          prompts: [
            {
              key: "sid",
              label: "WPS Cookie / wps_sid",
              type: "password",
              placeholder: "粘贴 wps_sid 或 Cookie: wps_sid=V02...",
            },
          ],
          async authorize(inputs) {
            const cred = parseCookieInput(inputs?.sid)
            if (!cred) return { type: "failed", error: "请输入有效的 wps_sid（或整段 Cookie）" }
            return {
              type: "success",
              key: cred.sid,
              metadata: {
                cookie: cred.cookie,
                accountId: cred.accountId,
                sid: cred.sid,
                uid: cred.uid,
              },
            }
          },
        },
      ],
    },
  }
}

export default WPSLingxiAuthPlugin
