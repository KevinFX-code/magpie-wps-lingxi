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
- 🔄 **动态同步网页模型 (`provider.models`)**  
  启动或登录后自动与 WPS 灵犀网页端 1:1 动态对齐最新模型列表（13+ 个主流模型），精准标注官方消耗倍率与 1M（1,048,576 tokens）超长上下文。
- ⚡ **OpenAI 兼容 SSE 反代 (`auth.loader`)**  
  将通用的 `/v1/chat/completions` 请求转接至金山灵犀官方后端，自动维护会话会话生命周期，支持正文流式打字机与深度思考（`reasoning_content`）流式回传。
- 🔑 **开箱即用鉴权 (`auth.methods`)**  
  支持粘贴 `wps_sid` 或整段 Cookie；装了 Chrome / Edge 时可自动打开浏览器登录并抓取 Cookie（Safari 的自动化窗口不能手动输入，不支持自动登录）。

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
或直接在 **Magpie 桌面客户端** 的 Provider 管理面板中找到 **WPS 灵犀** 点击 **Login**，有两种方式：

1. **浏览器登录（推荐，自动抓 Cookie）**：插件会打开一个独立的浏览器窗口，你在里面正常登录 WPS；登录完成后 `wps_sid` 会自动读取并保存，**不需要复制任何东西**。
   - macOS 上用 Chrome / Edge / Chromium / Brave（CDP 读 Cookie）。
   - Safari 的自动化窗口在会话期间会锁住键盘，没法手动登录，而且它用临时配置读不到 Safari 现有的登录态 —— 所以 Safari 不支持自动登录；请装 Chrome/Edge，或用手动粘贴。
   - 没有 Chromium 系浏览器时，页面会提示原因，并保留下面的手动粘贴方式。
2. **手动粘贴（兜底）**：打开 [lingxi.wps.cn](https://lingxi.wps.cn/) 登录，按 `F12` → 【Application / 应用】→【Cookies】，复制 `wps_sid` 的值，或者直接粘整段 Cookie —— 插件只取其中的 `wps_sid`。

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

## 📋 官方动态同步模型列表

插件与灵犀网页端保持 1:1 动态实时同步，默认支持的模型包括：

| 模型标识 (Model ID) | 模型名称 | 上下文长度 | 智点倍率 | 深度思考 (Reasoning) |
| :--- | :--- | :--- | :--- | :---: |
| `wps-lingxi/deepseek-v4.1-flash` | DeepSeek V4.1 Flash | 1M (1,048,576) | ~0.12x | ✅ 支持 |
| `wps-lingxi/deepseek-v4-flash-0731` | DeepSeek V4 Flash | 1M (1,048,576) | 0.09x | ✅ 支持 |
| `wps-lingxi/deepseek-v4-pro-0813` | DeepSeek V4 Pro | 1M (1,048,576) | 0.40x | ✅ 支持 |
| `wps-lingxi/kimi-k3` | Kimi-K3 | 1M (1,048,576) | 1.60x | ✅ 支持 |
| `wps-lingxi/GLM-5.3` | GLM-5.3 | 1M (1,048,576) | ~0.75x | ✅ 支持 |
| `wps-lingxi/GLM-5.3-Flash` | GLM-5.3-Flash | 1M (1,048,576) | ~0.11x | ✅ 支持 |
| `wps-lingxi/qwen3.8_max` | Qwen3.8-Max | 1M (1,048,576) | ~0.80x | ✅ 支持 |
| `wps-lingxi/qwen3.8_flash` | Qwen3.8-Flash | 1M (1,048,576) | ~0.08x | ✅ 支持 |
| `wps-lingxi/minimax_m3` | MiniMax-M3 | 1M (1,048,576) | 0.20x | ❌ |
| `wps-lingxi/doubao_seed_2_1_pro_260628`| Doubao-Seed-2.1 Pro | 256K (262,144) | ~0.50x | ✅ 支持 |
| `wps-lingxi/mimo-v2.6-pro` | Xiaomi MiMo-V2.6 Pro | 1M (1,048,576) | 0.10x | ❌ |
| `wps-lingxi/plan_pro` | Pro 模式 (深度推理模式) | 1M (1,048,576) | 模式自适应 | ✅ 支持 |
| `wps-lingxi/plan_max` | Max 模式 (复杂任务模式) | 1M (1,048,576) | 模式自适应 | ✅ 支持 |
| `wps-lingxi/auto` | 自动智能调度模式 | 1M (1,048,576) | 1.0x | ✅ 支持 |

---

## 🔌 两条对话平面（2026-10-28）

| 平面 | 端点 | 能力 | 什么时候用 |
|---|---|---|---|
| 老会话平面 | `/api/aigc/v3/assistant/sessions/{id}/completions` | 只有一段 `user_input.text`，**没有 tools 槽位** | 纯文本补全 |
| agent-runtime 直连 | `/api/public/v1/agent-runtime/chat/completions` | OpenAI 形状，`tools` / `tool_calls` **真可用**，`stream:false` 也通 | 带工具的 agent 客户端 |

- 默认 `auto`：请求里带 `tools` 就走 agent-runtime，否则走老平面；`legacy` 平面收到 tools 会明确报错，不会静默丢弃。
- agent-runtime 三步链：建 cowork session → 建 credits run → 调 chat/completions（头带 `x-cc-session-id` / `x-cc-run-id`）。run 按「账号 × 模型」缓存 1 小时；上游报 `SQLNoRows` / 会话不存在时自动重建一次。计费按 run，一个 run 内多次调用只扣一次智点。
- 强制某一平面：`magpie plugin options @kevinfx/magpie-wps-lingxi '{"plane":"agent"}'`（或 `"legacy"`）。
- 登录只认 `wps_sid`：可粘贴裸值、`wps_sid=…` 或整段 Cookie（自动取出 `wps_sid`，其余键丢弃）；账号按 sid 的 hash 区分，界面只显示尾号 4 位。上游 401 会把账号标成需重新登录。

## 🛠 独立测试

项目内置了脱离 Magpie 运行的免安装自测脚本：
```bash
node test_lingxi.mjs "你的wps_sid"
```

---

## 📄 开源许可证

本项目基于 [MIT 许可证](LICENSE) 开源发布。
