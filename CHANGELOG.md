# Changelog

## 0.3.1 — 2026-10-31

- 与 0.3.0 代码完全相同，只是 npm 补发：0.3.0 那次 `npm publish` 的包体没上传成功
  （registry 有元数据、tarball 404），而 0.3.0 这个版本号已经占住、granular token 又不允许
  `unpublish`，只能发一个 0.3.1 覆盖 `latest`。**请装 0.3.1，别装 0.3.0。**

## 0.3.0 — 2026-10-31

- **改用桌面端通路作为新基线**：代码取自 baijiu666/magpie-wps-lingxi 0.4.11，其中已合入
  PR #3（agent-runtime 平面 + Cookie 归一化）、#4（variants 形状）、#8（粘贴 Cookie 登录）、
  #7 与 #5（任务中心一次性任务）。0.1.x–0.2.x 的网页端实现保留在 git 历史与 `v0.2.3` 标签里。
- **新增客户端侧提示词预算**（0.4.11 没有）：上游按 token 限量、超了只回 `400 AI服务异常` 且不说原因。
  现在发请求前按字节裁剪 —— 单条超 `MAGPIE_LINGXI_MAX_MESSAGE_KB`（默认 48KB）掐头去尾；
  仍超则从最老的一端整条丢（保留 system、保持 tool_calls 与结果成对），并插一行
  `[历史已压缩…]` 标记；总预算 `MAGPIE_LINGXI_MAX_PROMPT_KB`（默认 320KB）。
  触发时在 stderr 打一行日志，不静默。
- 新增 `tests/budget.test.mjs`（5 条）；回归 68 通过 + 2 条真上游跳过。

## 0.4.11 — 2026-10-31

- **修 token 统计虚高（会话面板 TPS 两万多 tok/s）**：上游的 `total_tokens` 不是本轮
  用量，而是**当前上下文大小** —— 实测一条 `cached 42240 + prompt 1097 + completion 226
  = 43563` 完全对上。插件原样透传后，客户端把每轮的「上下文大小」累加，70 步的会话
  显示 13.8M tokens（实际仅 471K 输入 + 187K 输出），TPS 被算成 21074 tok/s。
  现在按 magpie 其它插件的约定自己算：`total_tokens = prompt_tokens + completion_tokens`，
  两轮实测 `128 = 37+91`、`249 = 42+207`，不再随会话增长。
- 新增 1 条回归断言；测试 63 通过（真上游 2 条在有 cookie 时跑）。

## 0.4.10 — 2026-10-31

- **CI 增加真上游集成测试**（`tests/live.test.mjs` + workflow 里的 `live` job）。
  单测全打桩，桩永远比真上游宽容 —— 历史上「工具 schema 被上游拒」就是这么漏的。
  现在每次 push、每个同仓库 PR、以及每天定时跑两条真请求：
  ① 把 anyOf/oneOf/$ref/allOf/not/const/type 数组全塞进一个工具 schema，断言不出现
  错误帧且收到 `finish_reason`；② 断言工具调用能完整回来、参数是合法 JSON。
  本地没有 `WPS_LINGXI_COOKIE` 时自动跳过（`skipped 2`），CI 由仓库 secret 注入，
  fork PR 拿不到 secret 也只会跳过。
- 测试 62 通过 + 2 条真上游（有 cookie 时）。

## 0.4.9 — 2026-10-31

- **schema 压平：多分支时保留信息量最大的那一支**。`anyOf: [string, object]` 这类
  真联合以前固定取第一个非 null 分支，会退化成只能传字符串、丢掉对象字段名；
  现在按 object > array > 标量排序取，同档位保持原顺序（新增 3 条断言）。
  注意 `report_view` 里的 `anyOf` 都是 `[真类型, null]`，行为不变。
- **修 CI 红**：`cookie-login.test.mjs` 里「一个域名挂住」的桩只挂了一个悬着的
  promise，而 `AbortSignal.timeout()` 的定时器是 unref 的 —— 事件循环提前清空，
  Linux 上整条测试被判 `cancelledByParent`（Windows 本地有别的句柄撑着，看不出来）。
  桩里加一个 ref 的 keep-alive 定时器，abort 时清掉。
- 测试 62 条全绿。

## 0.4.8 — 2026-10-31

- **修 0.4.7 引入的误判**：共用一份超时预算后，若 `wps.cn` 挂满 20s，`kdocs.cn`
  会被直接跳过，只在 kdocs 站有效的 Cookie 就被判「无效」。改成**两个域名并发**
  校验（`Promise.all`）：总耗时仍是一份预算，但两边都会真试到，取 `wps.cn` 优先。
  新增测试覆盖「wps.cn 挂住 + kdocs 有效」这条路径。
- **`probeBase` 收敛到 `verifyCookie`**：旧实现只认 `response.ok`，会把
  `200 + UserUnauthorized` 当成功，且与 `verifyCookie` 是同一件事的两套判据；
  现在直接复用（客户端导入、浏览器登录两处调用行为一致，且多了超时保护）。
- 测试 61 条全绿。

## 0.4.7 — 2026-10-31

- **`verifyCookie` 的总超时改成两个域名共用一份**：原来是每个域名各等 20s，
  粘错 Cookie 时最坏 40s 才报错；现在共用 20s 预算，第二个域名没预算就跳过，
  跳过原因也写进 `tried` 给用户看（新增一条测试覆盖）。
- **测试去掉硬编码下标**：`cookie-login.test.mjs` 原来断言 `methods.length === 3`
  且直接取 `methods[2]`，再加登录路就会误报；改成按 label 查找（仍校验兜底项排在最后）。
- 测试 60 条全绿。

## 0.4.6 — 2026-10-31

- **粘贴 Cookie 登录（第三条登录路，PR #8 by 411304344）**：`auth.methods` 末尾新增
  「粘贴 Cookie 登录（wps_sid）」，补上浏览器登录、客户端导入都走不通的场景（没装客户端、
  浏览器不支持调试端口、别人的机器上临时用）。输入框只做本地格式校验；`authorize()`
  立刻返回，网络校验放 `callback()`（避免与 magpie 互锁）；校验走
  `GET /api/public/v1/account/profile`，只认 200 且不是 `UserUnauthorized`，
  `wps.cn` 不通自动回落 `kdocs.cn`，失败信息带上两个域名各自的 HTTP 结果。
  凭据仍只保留 `wps_sid` + `uid`，与另两条路识别成同一个账号。
- 测试 59 条全绿（新增 9 条）。

## 0.4.5 — 2026-10-31

- **工具 schema 压平（修 `AIError：AI服务异常`）**：上游 agent-runtime 的 schema
  转换器只认朴素 JSON Schema，实测逐条验证——工具参数里出现 `anyOf` / `oneOf` /
  `allOf` / `not` / `const` / `$ref`，或 `type` 写成数组，整条对话必挂：
  前六者回 `AIError：AI服务异常`（HTTP 200 + 错误帧，<1s），`type` 数组回
  400 `InvalidArgument`。ZCode 的 MCP 工具（documents/pdf 的 `report_view` 等）
  就带 `anyOf`，所以任何模型（ds4.1f、kimi…）在 ZCode 里都必失败，而脚本直连
  不开工具却能通——这正是「ds4.1f 也报这个错」的根因。
  插件现在发送前压平工具 schema：组合关键字取首个非 null 分支 / 合并，`const`
  转 `enum`，`$ref` 从 `$defs` 解析（递归安全），`type` 数组取单值，缺 `type`
  的节点按 properties/items/enum 补出可用类型（上游要求每个节点都有 type）。
- 实测：8 种被拒写法 + 真实 `report_view` schema 全部 200；新增 12 条单测，
  全套 50 条全绿。

## 0.4.4 — 2026-10-31

- **网关等待耐心（patience=240）**：慢思考模型（kimi-k3.1-pro 等）对大提示词的
  首字延迟可超 110s，magpie 默认 60s 会把"上游失联"判成 502 并重试到尽
  （实测 10 次/37 秒失败）。插件现于 config 钩子声明 `patience: 240`
  （magpie 的 PatienceLongest），用户零配置；显式设置过 `patience` 的不被覆盖。
- 复测提示：若 magpie 里已装旧版本，升级后需重载插件使 config 钩子生效。
- 测试 38 条全绿（新增 patience 两断言）。

## 0.4.3 — 2026-10-31

- **macOS 客户端导入**（移植 PR #6，shadyrispy 真机验证）：目录判据放宽为
  「像 Electron profile」，Cookie 库收集覆盖 `Partitions/<n>/Cookies`（mac 无
  Network/ 子目录），mac 的 Chromium 不启用 OSCrypt、Cookie 明文直接读，
  仅 Windows/有 Local State 时才走 DPAPI+AES-GCM；错误区分「没找到目录」
  与「目录在但没登录」。新增 5 条 mac 导入测试（36 条全绿）。
- 合并 PR #7（MYCF711）：README 登录一节补「旧账号卡片名不会自迁移」说明
  （迁移在 `auth.refresh`，magpie 仅在 `expires` 前 5 分钟调用）。

## 0.4.2 — 2026-10-31

- 文档全面更新到最终状态：README 特性/对齐清单/脚本说明、TESTER-GUIDE 三级自测、
  ONE-TIME-TASKS 顶部加最终结论（三任务全自动 + 根因链），移除全部过时的
  「纯协议尝试 / 服务端门控 / 不会假装修好」表述。

## 0.4.1 — 2026-10-31

- 文档：补计费判定实测结论（扣费取决于会话 `client_type=lingxi_claw`，与 HTTP/WS 通道无关，
  来自 issue #5 第三轮四入口对照实验）；群任务定性更新。
- 社区验证汇总：issue #2（MYCF711 独立复跑两任务翻转）、#5（三轮：未命中→两任务翻转→三任务闭环）、
  #3（refresh 迁移触发时机分析，旧账号建议删后用「导入本机客户端」重登）。

## 0.4.0 — 2026-10-31

**三个一次性任务全部自动化完成（群聊任务攻破）**：

- 抓包定位群聊 400 的真实根因：服务端要求会话先在 **WS completions 通道**
  收到一次 `user.input`（网页端建群前的固定动作），空会话直接建群必 400。
- 插件群聊任务改为完整复刻网页端流程：建 `cowork_web` 会话 →
  WSS `completions/ws` 发 `user.input`（`expect_model: plan_pro`）→
  等 `run.end` → `POST channels` 建群 → 解散。
- 真账号实测建群成功（channel 771556124918503 创建+解散）。
- 至此三个一次性任务（专家模式 200 / 群聊 400 / 使用客户端 800）全部可由插件自动完成。
- 测试 31 条全绿（群流程断言：cowork_web 会话、WS user.input、建群/解散）。

## 0.3.17 — 2026-10-31

- 合并测试者 PR #4（`--from-magpie` 取凭据、会话完成态字段修正、`--session` 采 400、完整错误体）。
- **任务翻转实测通过**：未领账号复跑确认 `try_expert_mode` + `use_lingxi_client`
  双双翻转并自动领取 +1000（0.3.15 的 `execution_status` 生命周期是真根因修复）。
- `try_group_chat` 定性：建群 API 受服务端按账号门控（任务领取后通道关闭），
  插件侧不可修，README/FAQ 已注明。
- issue #2/#3/#5 已关闭（附验证数据总结）。

## 0.3.16 — 2026-10-31

- 任务对话规模对齐真实使用：max_tokens 提到 4096、提问改为正常两三句的表述。
  背景：干净账号实测信号对话"完成但扣费 0"，而真实客户端一句"你好"扣 1 智点 ——
  上游按用量整数扣智点，回答太短可能凑不出 1 智点、不产生计费记录。
  请测试者用 v0.3.16 复跑 L2（方法见 TESTER-GUIDE）。

## 0.3.15 — 2026-10-31

**找到任务不翻转的根因并补齐生命周期**（真实内核抓包，本地日志反代接管 `runtime_api.base_url`）：

- 真实内核的会话生命周期：run 创建后 `PUT /sessions/{id}/execution_status`
  上报 `running`（`run_token=group_id`，租约 90s），对话完成再上报 `completed`。
  **完成状态是客户端自己上报的** —— 纯 HTTP 对话从不调它，会话永远到不了 completed，
  这同时解释了建群 400 与会话列表状态卡住。
- 插件任务对话已挂上完整生命周期（running → 对话 → completed），
  真账号实测：会话状态成功到达 `finished`。
- 建群 400 最终定性：与请求体无关（9 组变体 + 真实客户端历史会话全部 400）；
  客户端里建群入口在任务领取后**消失**，服务端按账号关闭通道。
  结论：群聊任务的 API 通道受服务端门控，插件侧无解；任务翻转移需服务端判定信号，
  纯 HTTP 会话已与真实客户端逐字段等价，仍不翻转的判定维度在网关计费侧
  （仅真实内核直连网关时产生）。
- 测试 31 条全绿。

## 0.3.14 — 2026-10-31

- 修复 CI：`.github/workflows/regression.yml` 里残留着 PR #5 合并时的冲突标记，
  导致 GitHub Actions 每次推送都 "No jobs were run" 并发失败邮件；
  现在改为跑 `node --test`（tests/ 下全部 31 条）。

## 0.3.13 — 2026-10-31

- 新增 `docs/TESTER-GUIDE.md`：测试者一站式指引（安装 → 三级自测 → 回报模板）。
- README 补充环境变量表（BROWSER / HOME / TEMP_DAYS / NO_KSO）。

## 0.3.12 — 2026-10-31

- 流式与任务信号全面实测（真账号）：
  - agent-runtime 流式单轮/带 system/tools/max_tokens/reasoning_effort 全部完整收流到 [DONE]；
  - **服务端会话记录逐字段对比：纯 HTTP 的会话与真实客户端会话零差异** ——
    信号层面插件已与客户端等价，任务翻转只差未领任务账号的最终验证。
- `x-kso` Cookie 注入加逃生开关 `MAGPIE_LINGXI_NO_KSO=1`（默认仍注入）。
- 内部函数导出（agentChat 等）便于联调；测试 31 条全绿。

## 0.3.11 — 2026-10-31

三任务一条龙（真账号实测到建群这一步）：

- **一次对话吃两任务**：`client_type=lingxi_claw` + `session_mode/current_mode=expert`
  的 cowork 对话同时命中「使用灵犀客户端」和「完整体验专家模式」；
  cowork 失败时专家任务退到 aigc 平面兜底。
- **建群直接复用这次对话的会话**（不再先扫历史）：失败则轮询会话状态 30s 再试，
  最后才扫历史会话。轮询字段修正为 session_list 的 `status:"finished"`
  （详情接口只有数字 `session_status`，之前参照 PR #5 的 `execution_status` 已不存在）。
- 真账号全链路实测：对话 ✓ → 建群 400。
  建群 400 与会话状态无关（真实客户端的历史会话同样 400），
  当前主假设：`try_group_chat` 已 claimed 的账号被服务端关闭建群通道
  （渲染层即有 `groupChatEnabled` 门控），需未领任务账号验证。
- 会话状态字段修正：`session_list` 直接返回 `status:"finished"`，不再逐个查详情。

## 0.3.10 — 2026-10-31

真账号实测修正（两条信号链现已端到端跑通）：

- **修正 client_type 语义**：`client_type` 只能取白名单值（`lingxi_claw` / `pc_web` / …）。
  0.3.9 把网关 Product-Name `365wps-lingxi-client` 当 client_type 发会话，
  上游直接 AuditFailed。服务端自己把 `lingxi_claw` 映射成 365wps-lingxi-client。
- **对话文案不能用裸词**：`"hi"` 在 cowork 平面会被风控拒（AuditFailed），改用真实句子。
- **模型从账号目录动态挑**（跳过 plan_pro/plan_max/auto），不再写死。
- 实测：aigc 专家对话 ✓、cowork 客户端对话 ✓（x-kso Cookie 全程在发）。
- `tests/test_signals.mjs`：对当前账号实测两条信号链的脚本。

## 0.3.9 — 2026-10-31

继续死磕纯协议的任务完成（不引入 app-server）：

- **Cookie 客户端化**：所有 `*.wps.cn` 请求的 Cookie 追加 `x-kso-app-name=win-lingxi-desktop`、
  `x-kso-app-version`、`x-kso-device-id`（照抄客户端 main 进程的注入行为；
  需 plussvr RSA 的 device-signature 暂不带）。
- **专家任务改走网页端同款 aigc 平面**：`POST /api/aigc/v3/assistant/sessions` 带
  `session_mode:"expert"` → `…/completions` 带 `with_expert:true`（渲染层原样复刻；
  之前只在 cowork 平面带 session_mode，可能根本不是服务端看的信号）。
- 客户端任务保持 cowork 三处 `client_type`；对话模型改用账号必有的 `plan_pro`，
  `max_tokens` 提到 256（真实完成一轮，产生计费信号）。
- 失败可观察：签到 message 会带上每个任务对话失败的具体原因。
- 真实账号冒烟通过（已领完的任务走 done 路径不受影响）。

## 0.3.8 — 2026-10-31

- 修 #2：专家任务的 `credits/runs` 现在带 `agent_input.current_mode=expert`
  （之前写死 `"agent"`，与注释不符）；客户端任务的 run 体也带
  `client_type=365wps-lingxi-client`。测试锁住 run 体。
- 修 #3：新增 `auth.refresh` 钩子做账号迁移 —— 0.3.7 之前建的旧账号
  （accountId 是固定串「WPS 灵犀账户」）会在下次刷新时改成 `wps-<uid>`
  并补上 `metadata.uid/name`；额度面板的账号名优先显示昵称
  （`GET /api/public/v1/account/profile`，1 小时缓存）。
  没有手机号可拿（上游不回），`accountId` 保持 `wps-<uid>` 作稳定键。
- 31 条测试全绿。

## 0.3.7 — 2026-10-31

- 审计修复：
  - `findBrowser()` 不再每次调用都跑最多 60 次 `reg query`：常见路径优先，全 miss 才查注册表。
  - 一次性任务重拉后只领取 `type=one_time`，不再可能重复领每日签到。
  - Cookie 归一保留 `copilot_server_branch`，`X-Cc-Region`（灰度路由）不再永远为空。
  - `usage.until` 过滤已过期批次；修复 `nowMs` 的 TDZ（额度查询会直接报错）。
- 新增测试：浏览器发现、任务标志、积分边界（共 30 条，`node --test` 全绿）。
- 新增 `docs/ONE-TIME-TASKS.md`：交给有未完成任务账号的同学验证「专家/群聊/客户端」三个任务。

## 0.3.6 — 2026-10-31

- 「导入本机灵犀客户端账号」从 api 类型改成 oauth（`opened: true`）：
  api 方法在 magpie 里天然带一个 key 输入框（就是那个 `enter the key`），
  改成 oauth 后点一下直接读客户端登录态，不再出现任何输入框。
- 自动检测客户端目录（WPS 灵犀 / Lingxi / lingxi / lingxi-desktop），
  失败才提示 `MAGPIE_LINGXI_HOME`。

## 0.3.5 — 2026-10-31

- 浏览器发现按 magicrew 插件的实测列表重写（修 issue #1）：补上 360 极速浏览器 X
  （`360ChromeX.exe`）、360 安全浏览器（真实文件名是 `360se.exe`）、QQ/搜狗/Brave/
  Vivaldi/Opera/2345/猎豹/傲游/UC/夸克，以及 Edge 的两种落盘名；路径优先、注册表兜底。
- 一次性任务「专家模式 / 使用客户端」改为纯协议尝试：分别带
  `session_mode=expert` 与 `client_type=365wps-lingxi-client`（含请求头）各跑一次
  最小对话，然后重拉任务；**是否完成由服务端判定**，插件只如实回报状态，不伪造。
- 新增测试锁住这两条标志确实发出去了。

## 0.3.4 — 2026-10-31

- 模型面板对齐 magpie 的字段约定：`name` 只放模型名，倍率改用数字 `rate`
  （不再拼成 `DeepSeek V4.1 Flash [～0.12x]` 这种脏名字；倍率胶囊由宿主渲染）。
- 修复上游倍率使用全角波浪号 `～0.12x` 导致解析失败、部分模型没有倍率的问题。
- 透传 `max_new_tokens` 作为模型的输出上限（Kimi 1M、MiniMax 524K 等按上游给的值）。
- 额度面板新增「临时积分」窗口：15 天内到期的赠送批次单独列出，
  显示余额与到期日（判据与 jet 插件一致；`MAGPIE_LINGXI_TEMP_DAYS` 可调整天数）。

## 0.3.3 — 2026-10-31

- 「导入本机灵犀客户端账号」不再让用户填目录：点一下自动扫描
  `%APPDATA%\WPS 灵犀`、`Lingxi`、`lingxi`、`lingxi-desktop` 等候选目录，找到已登录的
  Cookie 库就直接导入；确实找不到时才提示可用 `MAGPIE_LINGXI_HOME` 指定。
- 修复注册表查询的转义错误（`\${tail}` 不插值），360/QQ/搜狗等浏览器现在能被发现；
  `reg` 的“找不到项”不再刷屏。

## 0.3.2 — 2026-10-31

- 登录重做：去掉本地 HTML 授权向导与 Cookie 粘贴框，点登录直接打开 WPS 登录页，
  登录成功后用 CDP 自行读取会话，用户不需要复制任何东西。
- 浏览器发现扩展：除 Chrome/Edge 外支持 Brave / Vivaldi / Chromium / 360极速 / 360安全 /
  QQ / 搜狗，并支持 `MAGPIE_LINGXI_BROWSER` 指定路径（修 issue #1：360 下找不到浏览器）。
- 新增「导入本机灵犀客户端账号」：读客户端 `Partitions/*/Network/Cookies`，
  DPAPI 解 key、AES-GCM 解值，并处理 Chromium 明文前的 32 字节 host 哈希。
- 账号仍按 `uid` 区分，导入/浏览器登录两条路都走同一套归一化。

## 0.3.1 — 2026-10-30

- 思考档位按模型下发：`variants` 从目录里的 `reasoning_efforts` 生成，不再所有模型都
  固定成 `low/high/max`；宿主选档后原样作为 `reasoning_effort` 发给 agent-runtime。
- 用量归一：`usage` 不再因 `total_tokens=0` 被丢弃；`cached_tokens` /
  `reasoning_tokens` 转成 `prompt_tokens_details` / `completion_tokens_details`。
- 每个请求带 `X-Request-Id`；建会话的 `env` 用真实设备名、临时工作目录和稳定
  device_id，不再写死 `Magpie` / `/tmp`。
- 修复：`pickGroupChatSession` 在删 app-server 时被误删，导致「体验群聊」任务在运行期
  抛 ReferenceError；已恢复并补了端到端测试（建群 → 解散 → 重拉 → 领取）。
- 修复：会话/run 的域名回落丢了 kdocs，恢复为 `lingxi.wps.cn` → `lingxi.kdocs.cn`。
- 新增 `tests/test_tasks.mjs`：只读 + 领取的任务实测脚本，打印每一步前后的 status；
  专家模式 / 使用客户端只上报 `incomplete`，不伪造完成。

## 0.3.0 — 2026-10-30

- 只保留桌面客户端通路：建会话 `POST /api/aioffice/v1/cowork/sessions` → 领 run
  `POST /api/public/v1/credits/runs` → 对话
  `POST /api/public/v1/agent-runtime/chat/completions`（SSE，原生 `messages` / `tools`）。
- 删除网页平面：不再调用 `/api/aigc/v3/...` 的 completions，也不再做 question 压平；
  `<|FunctionCallBegin|>` 正文工具桥一并移除，工具调用改由 agent-runtime 原生承担。
- 请求头对齐灵犀客户端：`X-Client-Type: lingxi_claw`、`X-Client-Lang: zh-CN`、
  `X-Cc-Agent-Type`、`X-Cc-Session-ID`、`X-Cc-Run-ID`，会话按 TTL 复用、失效自动重建一次。
- 模型目录改从 `/api/aioffice/v1/sessions/plans` 读取（失败时回退到内置模型表），
  模型的 reasoning / vision / 上下文窗口与实际可用性保持一致。
- Cookie 归一化：支持裸 `wps_sid`、`wps_sid=…`、整段 `Cookie:` 与 DevTools 复制行，
  丢弃 `kso_sid` 等无关项；账号按 uid 区分（无 uid 时按 sid 尾部），避免多账号互相覆盖。
- `variants` 改为对象（`{ low, high, max }`），修正此前数组被 magpie 读成 `"0" / "1" / "2"` 的问题。
- 保留每日签到（含一次性任务）与智点余额查询；签到、用量查询均走 `credits` 接口。
