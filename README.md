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
- 🎯 **一次性任务自动完成**  
  除每日签到外，任务中心还有三个一次性任务：**完整体验一次灵犀专家模式**（200 智点）、**体验一次群聊功能**（400 智点）、**使用灵犀客户端**（800 智点）。插件在每次签到时自动识别并完成它们 —— 一次客户端对话即可同时带出「专家模式」与「客户端」两项，随后复用该会话建群并自动解散，最后统一领取全部奖励。智点余额为 0 时跳过所有消耗性动作，不会白跑。
- 📊 **智点额度监控 (`auth.usage`)**  
  对齐 Magpie Quota 规范，在桌面端配额面板中实时显示剩余可用「智点」总额与最近算力到期时间。
- 🔄 **动态同步网页模型 (`provider.models`)**  
  启动或登录后自动与 WPS 灵犀网页端 1:1 动态对齐最新模型列表（13+ 个主流模型），精准标注官方消耗倍率与 1M（1,048,576 tokens）超长上下文。
- ⚡ **OpenAI 兼容 SSE 反代 (`auth.loader`)**  
  将通用的 `/v1/chat/completions` 请求转接至金山灵犀官方后端，自动维护会话会话生命周期，支持正文流式打字机与深度思考（`reasoning_content`）流式回传。
- 🧰 **工具调用桥接 (`tools` → `tool_calls`)**  
  灵犀后端是聊天应用而非函数调用 API，模型会把调用写在正文里（`<|FunctionCallBegin|>[{"name":…,"parameters":…}]<|FunctionCallEnd|>`）。插件把请求里的 `tools` 压进提示词，再把这段信封流式翻译成标准 OpenAI `tool_calls`（含 `finish_reason: "tool_calls"`），工具循环因此可以正常跑通。设置 `MAGPIE_LINGXI_TOOL_BRIDGE=0` 可关闭。
- 🔑 **开箱即用鉴权 (`auth.methods`)**  
  支持 Magpie 客户端内弹窗直接粘贴 `wps_sid`，亦支持自动拉起浏览器进行网页引导授权。

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

## 🎯 一次性任务自动完成（专家模式 / 群聊 / 客户端）

任务中心除每日签到外，还有三个一次性任务：

| 任务 | 奖励 | 说明 |
|---|---|---|
| `try_expert_mode` | 200 智点 | 完整体验一次灵犀专家模式 |
| `try_group_chat` | 400 智点 | 体验一次群聊功能（创建或加入任意一个群聊） |
| `use_lingxi_client` | 800 智点 | 使用灵犀客户端 |

插件在每次 `auth.checkin` 时自动处理：**一次客户端对话 → 同时带出「专家模式」与「客户端」两项 → 复用该会话建群（并自动解散，避免留垃圾群）→ 统一领取所有可领奖励**。已领过的任务会自然跳过，智点余额为 0 时不做任何消耗性动作。

### 关于 app-server

服务端判定「专家模式 / 客户端」两个任务的依据，是**经 AI Gateway 发出的那一次真实客户端对话**这一信号 —— 纯 HTTP 模拟（agent-runtime 平面、老平面 `aigc/v3`、各种 cowork 会话）实测均无法触发。

因此插件复用了客户端自己的内核 **app-server**，以 stdio JSON-RPC 把它拉起来发一次最小对话（`"hi"`，约 1 智点），行为与真客户端完全一致。app-server 由官方 CDN 公开分发，插件**首次需要时自动下载并校验 sha256**，无需手动操作：

```bash
npm run fetch-app-server     # 可选：手动预下载（插件也会按需自动下载）
```

下载后位于 `vendor/app-server/service/lingxi.exe`（约 68 MB，`vendor/` 已在 `.gitignore` 中，不会进仓库）。

> **前置条件**：仅 Windows（`lingxi.exe` 为 Windows 平台产物）。非 Windows 平台会自动跳过这两个任务，其余功能不受影响。

---

## 🛠 独立测试

项目内置了脱离 Magpie 运行的免安装自测脚本：
```bash
node test_lingxi.mjs "你的wps_sid"
```

---

## 📄 开源许可证

本项目基于 [MIT 许可证](LICENSE) 开源发布。
