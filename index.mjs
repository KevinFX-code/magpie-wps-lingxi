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
const NPM = "@ai-sdk/openai-compatible"

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

function resolveCookie(auth) {
  if (!auth) return ""
  if (auth.cookie) return auth.cookie
  if (auth.metadata?.cookie) return auth.metadata.cookie
  if (auth.key) {
    return auth.key.startsWith("wps_sid=") ? auth.key : `wps_sid=${auth.key}`
  }
  if (auth.access) {
    return auth.access.startsWith("wps_sid=") ? auth.access : `wps_sid=${auth.access}`
  }
  return ""
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
          const live = await fetchLiveModels(cookie)
          if (live.length) {
            return Object.fromEntries(live.map((m) => [m.id, modelOf(provider, m)]))
          }
        }
        return Object.fromEntries(DEFAULT_MODELS.map((m) => [m.id, modelOf(provider, m)]))
      },
    },

    auth: {
      provider: PROVIDER,

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

          const data = (await res.json())?.data || {}
          const totalBalance = data.total_balance ?? data.balance ?? 0

          let earliestExpire = ""
          const bonuses = data.bonus_credits || data.bonus_summary?.items || []
          for (const item of bonuses) {
            if (item.balance > 0 && item.expire_time) {
              if (!earliestExpire || item.expire_time < earliestExpire) {
                earliestExpire = item.expire_time
              }
            }
          }

          return {
            plan: "WPS 灵犀",
            user: auth.accountId || "WPS 账户",
            balance: `${totalBalance.toLocaleString()} 智点`,
            until: earliestExpire,
            signIn: "kept",
          }
        } catch (e) {
          return { error: e.message, signIn: "kept" }
        }
      },

      // 3. 反代网关拦截器：自动维护会话并转发到官方 SSE Completions 接口
      async loader(getAuth) {
        let activeSessionId = ""

        return async function customFetch(url, init = {}) {
          const auth = await getAuth()
          const cookie = resolveCookie(auth)

          if (url.includes("/chat/completions")) {
            let body = {}
            try {
              body = JSON.parse(init.body || "{}")
            } catch {}

            const messages = body.messages || []
            const stream = body.stream !== false
            const requestedModel = (body.model || "deepseek-v4.1-flash").replace(/^wps-lingxi\//, "")

            const lastUserMsg = [...messages].reverse().find((m) => m.role === "user")
            const question = typeof lastUserMsg?.content === "string" ? lastUserMsg.content : JSON.stringify(lastUserMsg?.content || "")

            // 自动确保有可用 session_id
            if (!activeSessionId) {
              try {
                const sessRes = await fetch(`${LINGXI_BASE}/api/aigc/v3/assistant/sessions`, {
                  method: "POST",
                  headers: {
                    Cookie: cookie,
                    "Content-Type": "application/json",
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                    Referer: "https://lingxi.kdocs.cn/",
                  },
                  body: "{}",
                })
                const sessData = await sessRes.json()
                activeSessionId = sessData?.data?.session_id || ""
              } catch {}
            }

            const payload = {
              question,
              model: requestedModel,
              user_input: { text: question },
            }

            const completionsUrl = `${LINGXI_BASE}/api/aigc/v3/assistant/sessions/${activeSessionId}/completions`
            const upstreamRes = await fetch(completionsUrl, {
              method: "POST",
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

            let lineBuffer = ""
            const streamTransform = new TransformStream({
              transform(chunk, controller) {
                lineBuffer += new TextDecoder().decode(chunk)
                const lines = lineBuffer.split("\n")
                lineBuffer = lines.pop() || ""

                for (const line of lines) {
                  if (line.startsWith("data:")) {
                    const raw = line.slice(5).trim()
                    if (!raw) continue
                    try {
                      const item = JSON.parse(raw)
                      // 思考过程 (Reasoning / Thinking)
                      if (item.type === "reasoning" && item.data) {
                        const reasoningText = typeof item.data === "object" ? item.data.text || "" : String(item.data)
                        const sseEvent = {
                          id: `chatcmpl-${Date.now()}`,
                          object: "chat.completion.chunk",
                          created: Math.floor(Date.now() / 1000),
                          model: requestedModel,
                          choices: [
                            {
                              delta: { reasoning_content: reasoningText },
                              index: 0,
                              finish_reason: null,
                            },
                          ],
                        }
                        controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(sseEvent)}\n\n`))
                      }
                      // 正文内容增量 (Text content)
                      else if (item.type === "text" && item.data) {
                        const contentText = typeof item.data === "object" ? item.data.text || "" : String(item.data)
                        const sseEvent = {
                          id: `chatcmpl-${Date.now()}`,
                          object: "chat.completion.chunk",
                          created: Math.floor(Date.now() / 1000),
                          model: requestedModel,
                          choices: [
                            {
                              delta: { content: contentText },
                              index: 0,
                              finish_reason: null,
                            },
                          ],
                        }
                        controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(sseEvent)}\n\n`))
                      }
                      // 结束标记
                      else if (item.type === "text_end" || item.type === "end") {
                        const sseEvent = {
                          id: `chatcmpl-${Date.now()}`,
                          object: "chat.completion.chunk",
                          created: Math.floor(Date.now() / 1000),
                          model: requestedModel,
                          choices: [{ delta: {}, index: 0, finish_reason: "stop" }],
                        }
                        controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(sseEvent)}\n\n`))
                      }
                    } catch {}
                  }
                }
              },
              flush(controller) {
                controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"))
              },
            })

            // 非流式聚合成一次性返回
            if (!stream) {
              const reader = upstreamRes.body.pipeThrough(streamTransform).getReader()
              let fullContent = ""
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
          }

          return fetch(url, init)
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
                const sid = url.searchParams.get("sid")?.trim() || ""
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
                  access: sid,
                  refresh: "",
                  expires: Date.now() + 30 * 24 * 3600 * 1000,
                  cookie: sid.startsWith("wps_sid=") ? sid : `wps_sid=${sid}`,
                  accountId: "WPS 灵犀账户",
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
            const sid = String(inputs?.sid ?? "").trim()
            if (!sid) return { type: "failed", error: "请输入有效的 wps_sid" }
            return {
              type: "success",
              key: sid,
              metadata: {
                cookie: sid.startsWith("wps_sid=") ? sid : `wps_sid=${sid}`,
                accountId: "WPS 灵犀账户",
              },
            }
          },
        },
      ],
    },
  }
}

export default WPSLingxiAuthPlugin
