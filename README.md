# @kevinfx/magpie-wps-lingxi

<div align="center">

<img src="./icon.png" width="100" height="100" alt="WPS 灵犀 Logo" />

### WPS 灵犀 (Lingxi Claw) Provider Plugin for Magpie & OpenCode

[![npm version](https://img.shields.io/npm/v/@kevinfx/magpie-wps-lingxi.svg?color=blue)](https://www.npmjs.com/package/@kevinfx/magpie-wps-lingxi)
[![Release](https://img.shields.io/github/v/release/KevinFX-code/magpie-wps-lingxi?color=green)](https://github.com/KevinFX-code/magpie-wps-lingxi/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**金山办公 WPS 灵犀（Lingxi / Lingxi Claw）专用的 Magpie 插件**<br>
一网打尽：**每日自动签到赚取智点、实时算力额度监控、动态网页模型同步与标准 OpenAI 格式反代网关**。

</div>

---

## 🌟 核心特性

- 🎁 **每日自动签到 (`auth.checkin`)**  
  无缝接入 Magpie 全局定时签到任务池，每日自动调用金山官方任务中心领取每日智点奖励，记录连续签到天数并防漏签。
- 📊 **智点额度监控 (`auth.usage`)**  
  对齐 Magpie Quota 规范，在桌面端配额面板中实时显示剩余可用「智点」总额与最近算力到期时间。
- 🔄 **动态同步模型目录 (`provider.models`)**  
  **原生目录 ∪ 网页目录**一起列出（0.2.1 起）：原生 `cowork` 目录只有 6 个模型，网页目录有 11+ 个（Kimi K3.1 Pro、Qwen3.8、MiMo、Doubao…只在网页里）。模型名后缀 `· 原生` / `· 网页` 直接标明走哪条通路，不会出现「看着在列表里、其实走的是降级通路」。
- 🧬 **原生 Agent Runtime（0.2 新增，推荐）**  
  走灵犀桌面客户端同款通路 `cowork.wps.cn/api/public/v1/agent-runtime/chat/completions`：**原生 `messages` / `tools` 进，原生 `tool_calls` / `reasoning_content` / `usage` 出**。不再压平提示词、不再从正文反解工具调用，工具循环与官方客户端一致，并带回真实 token 用量。每个请求先 `POST /api/public/v1/credits/runs` 领 `run_id` 再发起。
- ⚡ **OpenAI 兼容 SSE 反代 (`auth.loader`)**  
  将通用的 `/v1/chat/completions` 请求转接至金山灵犀官方后端，支持流式打字机、深度思考（`reasoning_content`）与 `[DONE]` 收尾。
- 🧰 **网页通路兜底（legacy）**  
  模型不在原生目录里时自动回落到 0.1.x 的网页聊天通路：`tools` 压进提示词，再把正文里的 `<|FunctionCallBegin|>[{"name":…,"parameters":…}]<|FunctionCallEnd|>` 流式翻译成标准 `tool_calls`（含 `finish_reason: "tool_calls"`）。设置 `MAGPIE_LINGXI_TOOL_BRIDGE=0` 可关闭桥接。
- 🧭 **结构化提示词 (`SYSTEM` / `TOOLS` / 历史 / `User`)**  
  网页通路只收一个 `question` 字符串，插件按 `SYSTEM → TOOLS → 历史 → User` 分段压平：system 提到最前并去重、工具清单独立成段、历史严格按时间顺序（工具结果回灌时自动补“继续”），避免系统指令被当成“引用的历史文本”。
- 🧬 **对齐网页端原生调用 (`expect_model` / `thinking` / `with_mcp`)**  
  网页通路的请求体按真实字段构造：`question`、`expect_model`、`thinking`（`auto`/`disabled`，由 `reasoning_effort` 推导）、`with_mcp`、`with_expert`，并沿用 `X-Cc-Version` / `X-Client-Type` / `X-Cc-Entrance` 头。`MAGPIE_LINGXI_THINKING=auto|disabled` 可强制思考档位，`MAGPIE_LINGXI_WITH_MCP=1` 可打开服务端 MCP 工具。
  > 0.2.1 起不再发 `user_input`：它原先等于整段 `question` 的副本，等于把提示词发两遍。实测上游只认 `question`（两者冲突时按 `question` 回答），删掉该字段行为不变，请求体直接减半。
- 🔑 **开箱即用鉴权 (`auth.methods`)**  
  支持 Magpie 客户端内弹窗直接粘贴 `wps_sid`，亦支持自动拉起浏览器进行网页引导授权。

---

## 🧭 两条通路与模式开关

| 通路 | 端点 | 输入 | 输出 |
|---|---|---|---|
| **native**（优先） | `cowork.wps.cn/…/agent-runtime/chat/completions` | 原生 `messages` + `tools` | 原生 `tool_calls` / `reasoning_content` / `usage` |
| **legacy**（兜底） | `lingxi.kdocs.cn/…/assistant/sessions/{id}/completions` | 单个 `question` 文本 | 文本信封 → 插件反解 `tool_calls` |

路由规则（0.2.1）：

- 模型在 `cowork` 原生目录里 → **native**
- `plan_pro` / `plan_max` → **legacy**。它们是「模式」不是模型，原生计费接口 `credits/runs` 会直接 `HTTP 400 InvalidArgument`；网页通路则正常
- 只在网页目录里的模型（Kimi K3.1 Pro、Qwen3.8、MiMo…）→ **legacy**
- 两边目录都没有的 key → legacy，并打印一次告警
- **首次被拒自动降级**：`cowork` 目录列了 6 个模型，但实测只有 `deepseek-v4-*` / `kimi-k2.6` 能领到 `run_id`，`GLM-5.1` / `GLM-5-Turbo` 同样 400。这类 key 首次请求被拒后插件会记住它、自动改走网页通路（并打一条告警），不会让你每次点都吃 400

模式由 `MAGPIE_LINGXI_MODE` 控制：

- `auto`（默认）：按上面的规则自动判定
- `native`：强制 native（目录不可用时仍会回落，避免必然 400）
- `legacy`：强制旧网页通路（0.1.x 行为）

**怎么知道这次走的是哪条路？** 响应头带 `X-Lingxi-Route: native|legacy` 和 `X-Lingxi-Model: <key>`。

> ⚠️ **两条通路的观测能力不对等，这是硬事实，不是配置问题：**
> - `native`：有真实 `usage`，有 `reasoning_content`，工具调用是上游原生 `tool_calls`（id 形如 `call_ig65…`）
> - `legacy`：**上游不返回任何 token 用量**（SSE 里没有 usage 帧），插件也不编造，所以客户端会显示 0；`reasoning_effort` 实测对 4 个模型 × 2 个档位都没有任何 reasoning 输出；工具调用是插件用 `Date.now()` 拼的伪 id（形如 `call_1793322354555_0`）
>
> 换句话说：**需要真实用量统计、需要思考过程、需要可靠的工具循环，就用带 `· 原生` 后缀的模型。** 带 `· 网页` 后缀的模型能跑，但只有网页聊天级别的能力。

> 原生通路是客户端私有网关，非公开接口；若上游调整字段，插件会明确返回错误而不是静默降级。

---

## 🔒 单次请求长度上限（0.2.2）

灵犀对**单次请求**有硬性长度上限。越线时两条通路报的错不一样：

| 通路 | 上游的真实返回 |
|---|---|
| legacy | `event:error` → `{"result":"PromptTokenExceedLimit","msg":"场景token超过限制"}` |
| native | `HTTP 400` → `{"code":"AIError","message":"AI服务异常"}` |

实测边界：native **800KB ≈ 139K token 正常**，603KB 的混合内容直接 400；legacy 961KB 混合内容报 `PromptTokenExceedLimit`。

**为什么这件事很致命**：压平后的历史只增不减，而 legacy 通路又不上报 token 用量（见上），客户端因此永远感知不到上下文压力、也不会压缩。于是一旦越线，**之后每一轮都会失败，整个会话就废了** —— 现象就是「一直 502，连基本功能都跑不了」，而且重试毫无意义。

0.2.2 的处理：

- **预算**：`MAGPIE_LINGXI_MAX_PROMPT_KB`（默认 `320`），两条通路都生效
- **丢整条**：超预算就从最老的一端整条丢，保留一段最新的**连续**历史（不能挑着丢：`tool_calls` 和紧随其后的 `tool` 结果必须成对）
- **掐长条**：单条超过 `MAGPIE_LINGXI_MAX_HISTORY_LINE_KB`（默认 `32`）时，掐头去尾留标记。实测一次 533KB 的粘贴会让「整条丢」直接跳空，把其余历史一起牺牲
- 被压缩时在提示里插入一行 `[历史已压缩：…]`，让模型知道历史不完整
- **如实报错**：错误帧用的是 `{result, msg}`，之前插件只读 `{code, message}`，把「场景token超过限制」吞成了一句无信息的 `WPS Lingxi upstream error`
- **不再无脑重试**：提示词超限这类错误回 `400`（而非 `502`），Magpie 不会白跑 7 次重试

> 真机验证：把那个 961KB、已经打不开的会话重新发一次 —— 裁剪后 60KB → `HTTP 200`，模型正常回了工具调用。


---

## 🧩 工具信封的方言（0.2.3）

网页通路只能靠「模型在正文里输出一个标记块」来调工具，而不同模型的 chat template 习惯不一样。0.2.3 起两种方言都认：

| 方言 | 长什么样 | 谁在用 |
|---|---|---|
| **JSON**（文档写法） | `<\|FunctionCallBegin\|>[{"name":"write","parameters":{…}}]<\|FunctionCallEnd\|>` | DeepSeek 系，以及提示词引导成功时 |
| **XML**（模型自带） | `<\|FunctionCallBegin\|><function name="write"><parameter name="file_path" string="true">a.txt</parameter></function></seed:tool_call>` | Kimi / Qwen 系 |

XML 方言的解析规则：

- `string="true"` → 值按**原文字符串**处理（适合放 SVG / 代码这类内容）
- `string="false"` → 值本身是 JSON，解析成对象（如 `files` 数组）
- 结束标记除 `<|FunctionCallEnd|>` 外，也接受 `</seed:tool_call>`、`<|tool_call_end|>`
- **工具名必须在本轮请求的清单里**，否则不执行、原样留在正文（防止模型只是"讨论"这个格式时被误触发）

> 为什么需要这个：实测 `kimi-k3.1-pro` 走网页通路时，会先用 `<|FunctionCallBegin|>` 开头，然后吐自己训练里的 XML 写法、再用 `</seed:tool_call>` 收尾。0.2.2 只认 JSON，于是整块 12KB（含整份 SVG 源码）被当成正文打印出来，文件根本没写。0.2.3 认了这套方言后，同一条消息解析出 `write` + `present` 两个真实调用，正文只剩 472 字。
>
> 提示词里同时也显式禁掉了 XML 写法，双保险。


---

## 📦 安装方式

### 方式 1：通过 Magpie CLI 一键安装（推荐）

在终端中执行以下任一命令即可自动完成安装与热加载：

```bash
# 从 npm 官方中心安装
magpie plugin add @kevinfx/magpie-wps-lingxi

# 或从 GitHub 源码安装
magpie plugin add github:KevinFX-code/magpie-wps-lingxi
```

---

### 方式 2：通过配置文件声明

在 Magpie 配置目录（`~/.config/magpie/plugins.json`）中直接加入声明：

```json
{
  "plugins": [
    {
      "spec": "@kevinfx/magpie-wps-lingxi@latest"
    }
  ]
}
```

---

### 方式 3：本地开发调试

如果您下载了源码进行二次开发：

```bash
# 进入 Magpie 插件配置目录
cd ~/.config/magpie/plugins

# 链接本地项目
npm install "/path/to/magpie-wps-lingxi"
```

---

## 🚀 登录与使用指引

### 1. 登录授权
安装后在终端运行：
```bash
magpie plugin login wps-lingxi
```
或直接在 **Magpie 桌面客户端** 的 Provider 管理面板中找到 **WPS 灵犀** 点击 **Login**：
1. **直接粘贴**：打开 [lingxi.kdocs.cn](https://lingxi.kdocs.cn/)，按 `F12` -> 【Application/应用】->【Cookies】，复制 `wps_sid` 的值粘贴提交；
2. **网页授权**：点击后将自动弹出本地向导页面，按提示粘贴确认即可完成绑定。

### 2. 查看配额与签到
- 查看当前可用智点余额：
  ```bash
  magpie quota wps-lingxi
  ```
- 手动触发签到自测：
  ```bash
  magpie accounts checkin
  ```

### 3. 在 Agent 工具中使用
在 **DeepSeek Harness**、**Claude Code**、**Codex**、**Cursor** 或任何支持 OpenAI 格式的客户端中：
- **Base URL**: `http://127.0.0.1:3425/v1`
- **Model**: 直接选用下方支持的任一模型标识（如 `wps-lingxi/deepseek-v4.1-flash`）即可开始对话！

---

## 📋 模型列表

模型表是**实时拉取**的，不写死；下面是 2026-10-30 实测的快照，用来对照「哪个模型走哪条通路」。

### 原生通路（有真实 usage / reasoning / 原生 tool_calls）

| 模型标识 | 名称 | 备注 |
| :--- | :--- | :--- |
| `wps-lingxi/deepseek-v4-pro` | DeepSeek V4 Pro | 旗舰推理 |
| `wps-lingxi/GLM-5-Turbo` | GLM-5-Turbo | 智谱推理 |
| `wps-lingxi/GLM-5.1` | GLM-5.1 | 智谱推理 |
| `wps-lingxi/kimi-k2.6` | Kimi-K2.6 | 多 Agent / 长程编程 |
| `wps-lingxi/<不透明 key>` ×2 | DeepSeek V4 Flash / V4 Flash 正式版 | key 是一段不透明串，以实时目录为准 |

### 网页通路（能跑，但只有网页聊天级别的能力）

| 模型标识 | 名称 |
| :--- | :--- |
| `wps-lingxi/kimi-k3.1-pro` | Kimi-K3.1 Pro |
| `wps-lingxi/kimi-k3` | Kimi-K3 |
| `wps-lingxi/deepseek-v4.1-flash` | DeepSeek V4.1 Flash |
| `wps-lingxi/deepseek-v4-pro-0813` | DeepSeek V4 Pro |
| `wps-lingxi/GLM-5.3` / `GLM-5.3-Flash` | GLM-5.3 系列 |
| `wps-lingxi/qwen3.8_max` / `qwen3.8_flash` | Qwen3.8 系列 |
| `wps-lingxi/minimax_m3` | MiniMax-M3 |
| `wps-lingxi/doubao_seed_2_1_pro_260628` | Doubao-Seed-2.1 Pro |
| `wps-lingxi/mimo-v2.6-pro` | Xiaomi MiMo-V2.6 Pro |
| `wps-lingxi/plan_pro` / `plan_max` | Pro 模式 / Max 模式 |

> 网页通路上的模型**不提供** token 用量，也**不会**因为 `reasoning_effort` 而输出思考过程。列表里的 `· 原生` / `· 网页` 后缀是判断依据。

---

## 🛠 独立测试

项目内置了脱离 Magpie 运行的免安装自测脚本：

```bash
# 全部回归用例（74 条）
npm test

# 只连真实上游跑一遍冒烟
node test_lingxi.mjs "你的wps_sid"
```

| 用例文件 | 覆盖范围 |
| :--- | :--- |
| `review.test.mjs` | SSE 解析、错误传播、并发隔离、配额窗口 |
| `tools.test.mjs` | 工具调用信封桥接、历史压平 |
| `prompt.test.mjs` | `SYSTEM → TOOLS → 历史 → User` 分段与去重 |
| `native.test.mjs` | 网页通路请求体形状 |
| `native-mode.test.mjs` | 原生 Agent Runtime 的 run → chat、`tool_calls` / `usage` 翻译 |
| `routing.test.mjs` | 目录并集、`plan_*` 路由、懒预热、`X-Lingxi-Route` |

---

## 📄 开源许可证

本项目基于 [MIT 许可证](LICENSE) 开源发布。
