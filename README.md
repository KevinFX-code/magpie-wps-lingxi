# Magpie WPS 灵犀插件 (WPS Lingxi Provider Plugin)

借鉴成熟社区插件（`@magpie-community/opencode-trae-auth`、`workbuddy` 等）规范开发，为 Magpie 和 OpenCode 体系提供 **WPS 灵犀（Lingxi / Lingxi Claw）** 的每日自动签到、用量额度监控与通用 OpenAI 格式反代。

---

## 核心特性

1. **每日自动签到 (`auth.checkin`)**
   - 托管由 Magpie 自动每日定时调度执行。
   - 调用 `lingxi.kdocs.cn` 官方任务中心，自动领取每日 200 点灵犀算力。
   - 记录每日签到状态与连续签到天数。

2. **用量与额度查询 (`auth.usage`)**
   - 实时查询灵犀算力余额（Credits Balance）与超级会员/特权状态。
   - 直观显示在 Magpie 客户端的配额面板中。

3. **OpenAI 兼容反代 (`auth.loader`)**
   - 拦截并转换标准 `/v1/chat/completions` 请求。
   - 支持 SSE 流式打字机输出，完美对接 Claude Code、Codex、Cursor 等 Agent。

4. **开箱即用鉴权 (`auth.methods`)**
   - 支持自动读取本地 WPS 安装凭证。
   - 内置轻量 Web 授权页面，支持一键填入或更新 Cookie。

---

## 快速测试（无需启动 Magpie）

在终端中直接运行独立测试脚本：

```bash
# 传入 wps_sid 进行功能自检
node test_lingxi.mjs "你的wps_sid"
```

自检内容包括：
- 模型目录查询
- 实时算力余额查询
- 每日签到并返回点数收益
- 对话接口连通性测试

---

## 接入 Magpie 运行步骤

### 方式一：本地符号链接接入（推荐）

1. 将当前插件目录链接到 Magpie 的插件节点目录中：
   ```bash
   cd C:\Users\FANXIANG\.config\magpie\plugins
   npm install "D:\Pi\magpie-wps-lingxi"
   ```

2. 打开 `C:\Users\FANXIANG\.config\magpie\plugins.json`，在 `plugins` 列表中加入本插件：
   ```json
   {
     "plugins": [
       { "spec": "magpie-wps-lingxi" },
       ...
     ]
   }
   ```

3. 重启 Magpie，在 Magpie 的 Provider 管理界面中即可看到 **WPS 灵犀**。
4. 点击登录，输入或获取您的灵犀凭证后，Magpie 每日会自动执行签到并更新点数。
