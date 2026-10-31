# 测试者自测指引（一站式）

> 给愿意帮忙验证的同学：从安装到回报，这一篇走完即可。全程**不需要复制任何 Cookie**。

---

## 1. 安装

```bash
# 方式 A：从 GitHub 直接装（推荐）
magpie plugin add github:baijiu666/magpie-wps-lingxi

# 方式 B：本地目录
magpie plugin add D:\path\to\magpie-wps-lingxi
```

⚠ 如果之前装过上游 `@kevinfx/magpie-wps-lingxi`，先关掉它（两者同一个 provider id `wps-lingxi`）：
```bash
magpie plugin off @kevinfx/magpie-wps-lingxi
```

装好后确认：
```bash
magpie plugin list
# 应看到：wps-lingxi (WPS 灵犀, 13 models)  on
```

## 2. 登录（二选一，都不需要粘贴 Cookie）

1. **浏览器登录**：面板点「浏览器登录（打开 WPS 登录页）」→ 在弹出的浏览器里登录 WPS → 自动完成。
   支持 Chrome / Edge / Brave / Vivaldi / 360极速 / 360安全 / QQ / 搜狗等 Chromium 内核浏览器。
2. **导入本机客户端账号**：本机已装灵犀客户端并登录过 → 点「导入本机灵犀客户端账号」→ 一键完成。

## 3. 三级自测

### L0 · 健康检查（不需要账号，1 分钟）
```bash
git clone https://github.com/baijiu666/magpie-wps-lingxi.git && cd magpie-wps-lingxi
node --test          # 应 31+ 条全过
npm run check        # 应 30 通过 / 0 警告 / 0 失败
```

### L1 · 日常自测（需要账号，5 分钟）
```bash
magpie quota wps-lingxi        # 额度面板：智点余额 + 临时积分（如有 15 天内到期的批次）
magpie accounts checkin        # 签到：每日智点 + 三个一次性任务全自动完成并领取
# 在 magpie 对话框里随便聊一句（选任意模型），确认流式输出正常
```

### L2 · 任务翻转验证（核心，需要「三个一次性任务都没领过」的账号；v0.4.0 起一次签到全自动完成三任务）

```bash
# 信号实测：两条信号链 + 余额变化 + 任务状态前后对比（不打印 sid）
node tests/test_signals.mjs
node tests/test_tasks.mjs

# 没装灵犀客户端（脚本默认要从客户端数据目录导入账号）时，改走 magpie 已登录的账号：
node tests/test_signals.mjs --from-magpie
node tests/test_tasks.mjs --from-magpie

# 账号里没有「已完成会话」时，建群那步会被跳过；想采建群 400 的响应就指定会话 id：
node tests/test_tasks.mjs --from-magpie --session <session_id>
```
然后在 Magpie 里点一次签到（`magpie accounts checkin`），再跑一遍上面两条命令对比。

**判定标准**：任务状态 `incomplete → claimable` = 信号命中（插件会自动领取成 `claimed`）；
没有变化 = 信号未命中（如实回报即可，这正是我们要的数据）。

---

## 4. 环境变量（都有默认值，一般不用动）

| 变量 | 作用 | 默认 |
|---|---|---|
| `MAGPIE_LINGXI_BROWSER` | 指定登录用的浏览器 exe | 自动检测 |
| `MAGPIE_LINGXI_HOME` | 灵犀客户端数据目录 | 自动扫描 |
| `MAGPIE_LINGXI_TEMP_DAYS` | 临时积分窗口天数 | 15 |
| `MAGPIE_LINGXI_NO_KSO` | 置 `1` 关闭客户端 Cookie 标识注入 | 不关闭 |

---

## 5. 常见问题

- **浏览器登录报「没有找到 Chromium 内核浏览器」**：设置 `MAGPIE_LINGXI_BROWSER` 指向任意
  Chromium 内核浏览器 exe；360 安全浏览器可能不支持调试端口，建议 360极速 或 Chrome/Edge。
- **对话出现 AuditFailed「我还在不断学习中」**：上游内容风控，换一句正常表述重试。
- **额度面板「临时积分」没显示**：账号当前没有 15 天内到期的批次（正常；可用
  `MAGPIE_LINGXI_TEMP_DAYS=60` 临时调大窗口观察）。
- **建群 400**：v0.4.0 已修（根因 = 会话缺 WS `user.input` 真实使用信号）。若复现请回报账号状态。

---

## 6. 回报模板

```
系统：Windows 10/11  浏览器：______
灵犀客户端：已装/未装  版本：______
插件版本：0.3.x（magpie plugin list 可见）

L0：node --test ____ 全过 / 失败____
L1：额度 ____ 智点；签到 ____________；聊天输出 正常/异常____
L2（未领任务账号）：
  test_signals.mjs  输出：____________
  test_tasks.mjs    前后对比：
    try_expert_mode   ____ → ____
    try_group_chat    ____ → ____
    use_lingxi_client ____ → ____
  checkin message：____________
```

⚠ 任何日志/截图**不要包含 wps_sid**（脚本已保证不打印）。
