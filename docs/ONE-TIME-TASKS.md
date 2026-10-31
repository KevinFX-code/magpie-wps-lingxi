# 一次性任务（专家模式 / 群聊 / 使用客户端）——已全部自动化 ✅

> **最终结论（2026-10-31，v0.4.0，issue #5 三轮验证）**：三个一次性任务全部可由插件
> 纯 HTTP/WS 自动完成并在同一次签到中领取（干净账号实测 +1400）。
> 根因链：① 专家/客户端 = `execution_status` 生命周期（客户端自报 running→completed）；
> ② 群聊 = 会话需先经 WS completions 通道收到一次 `user.input`；
> ③ 扣费/翻转取决于会话 `client_type=lingxi_claw`。
> 以下为验证过程存档（历史_rounds 中的 400/未翻转结论已被后续修复取代）。

---

## 1. 一句话目标

确认灵犀任务中心的三个一次性任务，**插件能不能靠纯 HTTP 协议自动完成**：

| task_key | 任务名 | 奖励 | 插件当前行为 |
|---|---|---|---|
| `try_group_chat` | 体验一次群聊 | 400 智点 | 找一个已完成会话 → 建群 → 解散 → 重拉任务 → 领取 |
| `try_expert_mode` | 完整体验一次专家模式 | 200 智点 | 带 `session_mode=expert` 跑一次最小对话 → 重拉任务 |
| `use_lingxi_client` | 使用灵犀客户端 | 800 智点 | 带 `client_type=365wps-lingxi-client`（会话 + 请求头）跑一次最小对话 → 重拉任务 |

**判定标准只有一条**：任务状态从 `incomplete` 变成 `claimable`（然后插件会自动 `claim` 成 `claimed`）。
插件不会伪造状态；没翻转就是没翻转。

---

## 2. 目前已经确认的事实（逆向自灵犀桌面端 1.3.31 / app-server 5.15.0）

### 2.1 任务接口（在渲染层，不在 app-server）
```
GET  /api/public/v1/tasks                          # 列表
POST /api/public/v1/tasks/{task_key}/claim         # 领奖（空 body，可选 ?date=YYYY-MM-DD）
```
响应：`{ result:"ok", data:{ tasks:[...], total_claimed_credits } }`
任务对象：`task_key`、`type`（`daily` / `one_time`）、`status`（`incomplete` / `claimable` / `claimed`）、`action`、`reward_amount`。

### 2.2 模型对话走 AI Gateway，需要运行时签名（决定性证据）

对 app-server 5.15.0 的完整逆向（pclntab + capstone，函数级）得到：

**client_type → 网关 Product-Name 映射表**（`core.map.init.0`，全局 map，22 条）：

| 会话 client_type | Product-Name |
|---|---|
| `lingxi_claw` / `wps_separate` | **365wps-lingxi-client** |
| `lingxi_ios` / `lingxi_android`（含 `_remote`） | 365wps-lingxi-mobile |
| `wechat_mp` | 365wps-lingxi-miniprogram |
| 其余 16 个（pc_web、pc_wps、web_copilot 等） | 365wps-lingxi-web |

**Intention-Code 由 6 字节 mode 串决定**（`BuildGatewayParameters`，三处独立实现一致）：
- `current_mode == "expert"` → `AI-Gateway-Intention-Code: 365wps_lingxi_expert`
- 其他（normal）→ `365wps_lingxi_normal`

**计费身份 = 会话的 client_type**（`BillingRunFactory.Create` → `billingClientType`，
13 个白名单值直通，否则归一化；白名单含 lingxi_claw、wps_separate 等）。

**纯 HTTP 无法复现的**：WPS2 请求签名（`httputil.NewWPS2Signer`，只对
`/api/public/v1/agent-runtime/`、`/api/logs/v1/app-server/*` 前缀生效）与
`AI-Gateway-Billing-Token`（计费流产物）。这就是明文 Cookie 打网关 403 的原因。

**客户端不存在任何「任务完成上报」端点**（渲染层与二进制均证实，`task_ids`
只是 agent 内部工具字段）。任务状态机由服务端依据**网关计费侧信号**判定。

> 结论：不跑 app-server、不打网关的纯 HTTP，无法让 `try_expert_mode` /
> `use_lingxi_client` 翻转。可行路径见 §5。
- 网关：`https://ai-gateway.wps.cn`，路径 `/api/v3/responses`、`/api/v3/chat/completions`
- 关键头：`AI-Gateway-Product-Name`（取值含 `365wps-lingxi-client`、`365wps_lingxi_expert`）、
  `AI-Gateway-Intention-Code`、`AI-Gateway-Billing-Token`、`AI-Gateway-Uid`、`Client-Request-Id`
- 二进制里有 `runtimesign.Sign`（WPS2Signer）与 `V2EncryptGatewayToken`，
  **明文 `wps_sid` 直接请求网关会 403 `Forbidden.AuthorizationFailure`**（已实测）

### 2.3 客户端身份与专家模式
- `lingxi.exe -client-type` 的说明：`Client type used to select the AI Gateway identity (default "lingxi_claw")`
- `normalizeGatewayClientType` 对未知值回落到 `lingxi_claw`
- `365wps-lingxi-client` 与 `365wps_lingxi_expert` 在二进制里是**相邻的静态字符串对**
- 专家模式在网页层是建会话时带 `session_mode:"expert"`；`expert_id` 是 JSON 字段（传 `null` 会被拒）

### 2.35 两个实测坑（0.3.10，勿踩）
1. `client_type` 只能填白名单值（`lingxi_claw` / `pc_web` / …）。
   把网关 Product-Name（`365wps-lingxi-client`）当 client_type 发会话/run，
   上游返回 AuditFailed（"我还在不断学习中"）——它不是 client_type，是映射结果。
2. cowork 平面对话文案用裸词（"hi"）会被风控拒（AuditFailed）；
   aigc 平面不受影响。用一句正常的话即可。

### 2.38 建群实测结论（0.3.11，2026-10-31）
- 纯 HTTP 的 cowork 会话跑完后，`session_list` 里 `status` 会变成 `"finished"`
  （详情接口字段是数字 `session_status`，没有 `execution_status` —— PR #5 时代的字段名已变）。
- `POST /api/imchat/v1/channels` body `{session_id, expect_model:"plan_pro"}`
  （与渲染层 `createChannel({session_id, expect_model})` 一致）在**已领完群聊任务的账号**上
  对任何会话（包括真实客户端的历史会话）都返回 400 InvalidArgument。
  主假设：任务 claimed 后服务端关闭建群通道 → **建群验证必须用未领任务账号**。

### 2.39 计费判定实测（issue #5 三轮验证，2026-10-31）
- **扣费与会话翻转取决于会话/run 的 `client_type=lingxi_claw`**，与 HTTP/WS 通道无关：
  同一账号四个入口对照（aigc 对话、cowork+client_type、网关流式×2），
  只有带 `client_type` 的那轮产生扣费（+1 智点），其余 Δ=0。
- 任务翻转路径：`execution_status` 生命周期（running→completed，客户端自报）+ 会话 `client_type`
  → 干净账号三任务全自动闭环已实测（issue #5 第三轮：+400 建群翻转）。

### 2.4 插件走的通路
```
POST /api/aioffice/v1/cowork/sessions      # 建会话（可带 client_type / session_mode）
POST /api/public/v1/credits/runs           # 领 run（agent_input）
POST /api/public/v1/agent-runtime/chat/completions   # 对话（SSE，X-Cc-Session-ID / X-Cc-Run-ID）
```

---

## 3. 需要你验证的问题（按优先级）

**Q1（最重要）**：账号任务未完成时，直接跑插件的签到，`try_group_chat` 会不会翻转？
**Q2（0.3.9 新假设）**：专家任务改走**网页端同款 aigc 平面**
  （`session_mode:"expert"` + `with_expert:true`）后会不会翻转？——这是渲染层专家模式的原样请求。
**Q3（0.3.9 新假设）**：Cookie 里带 `x-kso-app-name=win-lingxi-desktop` 等设备头后，
  `use_lingxi_client` 会不会翻转？——客户端 main 进程对所有 wps.cn 请求都这么注入。
**Q4**：Q2/Q3 若都不翻，对话是否真实产生扣费（余额变化）？没有扣费=信号没到网关层。
**Q4**（如果 Q2/Q3 失败）：抓一次**真实桌面客户端**完成该任务时的请求，看差异在哪（见 §6）。

---

## 4. 复现步骤

### 4.1 安装
```bash
magpie plugin add github:baijiu666/magpie-wps-lingxi
# 如果之前装过上游同名插件，先关掉：
magpie plugin off @magpie-community/opencode-zcode-auth   # 与灵犀无关，示例
```
> 灵犀插件与上游 `@kevinfx/magpie-wps-lingxi` 声明同一个 provider id `wps-lingxi`，不要同时启用。

### 4.2 登录（二选一，都不需要复制 Cookie）
- 面板点「浏览器登录（打开 WPS 登录页）」→ 在浏览器里登录 → 自动完成
- 本机已装灵犀客户端并登录过 → 点「导入本机灵犀客户端账号」→ 直接读本地会话

### 4.3 记录任务基线
```bash
# 只读：打印所有任务状态（不会打印 sid）
node tests/test_tasks.mjs --sid "<你的 wps_sid>"
```
> 也可以不传 `--sid`，用 `WPS_SID` 环境变量。脚本只做「读任务 → 必要时建群/领奖 → 再读任务」。

### 4.4 触发插件逻辑
```bash
magpie accounts checkin
# 或者直接调 usage 看额度是否正常
magpie quota wps-lingxi
```

### 4.5 再记录一次
再跑一次 4.3 的命令，对比状态表。

---

## 5. 回报模板（把这个表填好发回来）

```
账号：uid=__________（不要贴 sid）
灵犀客户端版本：1.3.31 / 其他 ______
是否装过桌面客户端：是 / 否

任务                     动作前        动作后        是否领到
try_group_chat           ______        ______        ______
try_expert_mode          ______        ______        ______
use_lingxi_client        ______        ______        ______
daily_check_in           ______        ______        ______

插件返回的签到 message（原样贴）：______________________
```

如果任务翻转了，请再贴一次 `magpie accounts checkin` 的输出，以及 **领取到的智点数量**。

---

## 6. 如果没翻转：抓真实客户端的请求

只抓这两个域名，别抓整个系统：

1. 打开 Charles / Fiddler / mitmproxy，只对 `lingxi.wps.cn`、`ai-gateway.wps.cn` 开启 SSL 代理
2. 在**灵犀桌面客户端**里完成一次对应任务：
   - 专家模式：进入专家模式发一句「hi」
   - 使用客户端：用桌面客户端正常发一次消息
3. 导出这两次请求的：
   - URL / method
   - 请求头（重点：`X-Client-Type`、`AI-Gateway-Product-Name`、`AI-Gateway-Intention-Code`、`AI-Gateway-Billing-Token`、`Client-Request-Id`）
   - 请求体（重点：`session_mode`、`client_type`、`expert_id`、`agent_input`）
4. **把 Cookie / Authorization 值打码**，只保留字段名和长度

---

## 7. 安全与注意

- **不要提交 `wps_sid`**；脚本不会打印它，截图/日志也请打码
- 测试脚本只读任务 + 领取 `claimable`，不会伪造完成
- 如果账号三个任务都已 `claimed`，这份验证做不了（我们就是这种情况）
- 消耗：一次最小对话约 1 智点；余额为 0 时插件会跳过消耗性动作

---

## 8. 备选方案：官方 app-server（如果 Q2/Q3 都不翻）

上游 PR #5 的做法，插件按需从官方 CDN 拉起客户端内核（约 90MB，Windows），用 stdio JSON-RPC 跑一次对话：
```
GET /api/aioffice/v1/cowork/app-server/versions   # 公开，无鉴权，返回 { download_url, hash }
下载 zip → sha256 校验 → 解压 service/lingxi.exe
lingxi.exe -stdin -auth-file <{auth_mode:"wps_sid",wps_sid:{value:<sid>}}> -client-type lingxi_claw
initialize → initialized(notify) → account/login/start → session/start → run/start("hi")
```
- app-server 自带 WPS2 签名与凭据，等价于真实客户端 → 网关信号成立
- 普通对话 → `use_lingxi_client`；`session_mode:"expert"` 的 run → `try_expert_mode`
- 之后轮询 tasks 接口（纯 HTTP 即可）领取
- 代价：90MB 下载、Windows-only、每任务约 1 智点

---

## 9. 代码位置（方便对照）

| 逻辑 | 文件 / 函数 |
|---|---|
| 任务列表 / 领取 | `index.mjs` → `listTasks()` / `claimTask()` |
| 一次性任务编排 | `index.mjs` → `completeOneTimeTasks()` |
| 任务对话（专家/客户端） | `index.mjs` → `runTaskConversation()` |
| 会话/对话通路 | `index.mjs` → `createCoworkSession()` / `ensureRun()` / `agentChat()` |
| 模型目录与倍率 | `index.mjs` → `fetchModelPlans()` / `rateOf()` / `modelOf()` |
| 额度与临时积分 | `index.mjs` → `usage()` / `summarizeExpiring()` |
| 实测脚本 | `tests/test_tasks.mjs` |
| 单元测试 | `tests/*.test.mjs`（`node --test`，30 条） |
