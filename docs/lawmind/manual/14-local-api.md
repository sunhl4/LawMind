# 第 14 章 本地 HTTP API

这一章讲本地服务：它怎么起来、请求进来要过几道、事件怎么推给界面、后台任务怎么跑。

> 这一章是**从协议看**（有哪些端点、过哪些关、发什么事件）。逐文件的实现精读在第 63–65 章：第 63 章讲骨架（启动编排、请求十三步、鉴权两道门、作业注册表、SSE 总线），第 64 章讲 101 条主路由（对话、会话、文书台、案件、工作台、首屏），第 65 章讲其余 49 个路由文件。

## 14.1 定位：它是唯一的写侧

界面上所有「改状态」的动作，最后都落到本地 HTTP API 上：

- 对话（`POST /api/chat`）
- 会话操作（fork、steer、compact、resume）
- 稿件审核与导出
- 案件、期限、谈话、材料
- 记忆采纳
- 审批
- 后台任务

引擎不直接暴露给界面。界面 → 本地 API → 引擎，这是唯一的链路。

服务只监听**回环**：`127.0.0.1` 和 `::1` 两个协议族同时监听，绝不对局域网暴露。

## 14.2 为什么要绑两个协议族

这件事值得单独讲，因为它踩过一次。

`localhost` 在 macOS 上会**同时**解析到 `::1`（IPv6）和 `127.0.0.1`（IPv4），而 WebKit（Word 任务窗格用的就是它）**通常先试 `::1`**。

如果服务只绑了 IPv4，那么用 `http://localhost:<端口>` 打开的客户端就连不上。在 Word 里的表现是这句：

```text
很抱歉，无法加载该加载项。请确保您具有网络和/或 Internet 连接。
```

这个报错完全没有指向真正的原因。所以服务要两个协议族都听——仍然是回环，不对局域网暴露。

## 14.3 启动顺序

入口是 `apps/lawmind-desktop/server/lawmind-local-server.ts`，模块底部的 `void main()` 启动。

环境变量契约：

| 变量                           | 说明                            |
| ------------------------------ | ------------------------------- |
| `LAWMIND_WORKSPACE_DIR`        | 必填                            |
| `LAWMIND_DESKTOP_PORT`         | 非 headless 时必填              |
| `LAWMIND_ENV_FILE`             | 可选                            |
| `LAWMIND_DAEMON`               | `1` 表示守护（tick）模式        |
| `LAWMIND_DAEMON_SUPERVISOR`    | `1` 表示监督模式                |
| `LAWMIND_DESKTOP_ACTOR_ID`     | 审计归属，默认 `lawyer:desktop` |
| `LAWMIND_ENABLE_COLLABORATION` | `false` 关闭协作                |
| `LAWMIND_REPO_ROOT`            | 仓库根（开发态用）              |

启动顺序（简化版但保持顺序）：

1. 判定模式（普通 / 守护 / 监督）。
2. 校验工作区与端口，非法就退出（守护/监督模式不需要端口）。
3. **监督模式先分支**：`runDaemonSupervisor` 然后直接返回（不能在前面做重活）。
4. 非守护模式：先 `stopDaemonProcess`（窗口开着时由桌面端负责 tick）。
5. 守护模式：抢守护锁（抢不到就打印「已在运行，本进程让位」并退出 0），记 pid，装退出记账。
6. **加载环境变量**（`bootstrapLawMindDesktopEnv`）。注释说明这是硬顺序：「env must load before any key consumer」。
7. 播种内置工作流模板。
8. 解析技能签名密钥；如果是 `derived` 来源就打警告（提示用 `LAWMIND_SKILL_SIGNING_SECRET`）。
9. 用这个密钥播种内置技能。
10. **加载并应用策略文件**（`lawmind.policy.json`）。注释解释了为什么在环境变量之后：「applied after `.env.lawmind` so IT can enforce guardrails without editing secrets」。
11. 恢复磁盘上的委派记录。
12. 从磁盘加载后台任务。
13. 定义定时 tick：到期的定时任务 → 到期的自动办件 → 期限提醒 → Word 插件取件。
14. 自动重建索引（只在策略允许且索引陈旧时）。
15. 启动案件副本自动同步。
16. 如果配了审计外锚地址，启动外锚同步。
17. 如果索引不存在，后台重建一次。
18. 守护模式在这里返回（不起 HTTP 服务）。
19. 初始化凭据，建限流桶，起两个 `http.createServer`（IPv4 + IPv6）。

### 进程级错误策略

两个 handler 行为**不同**，这是有意的：

| 事件                 | 行为                                | 理由                                       |
| -------------------- | ----------------------------------- | ------------------------------------------ |
| `uncaughtException`  | 打日志 → 记信号 → `process.exit(1)` | 同步栈可能已经坏了，干净退出让监督进程重启 |
| `unhandledRejection` | 打日志 → 记信号 → **不退出**        | 可用性优先，降级成健康信号                 |

不退出那个会体现在 `/api/health` 的 `doctor.process.degraded` 上。也就是说，未处理的 Promise 拒绝不会把服务搞死，但会让你在体检页看到「降级」。

### 一次真实的启动顺序 bug

代码里有一段注释记着一个只有端到端测试才能发现的 bug：

> 踩过的坑（真机 E2E `daemon-supervision.spec.ts` 抓到，单测抓不到）：最初让监督进程先抢锁再 fork，而子进程也抢同一把锁——子进程必然失败并「让位」，于是走生产路径（关窗 → 监督进程）时 `lawmindd` 从来不 tick，「关窗后继续办件」实际是坏的。**两个函数各自单测都对，拼起来才错。**

这段注释值得反复看。它说明了两件事：单测覆盖不到「两个模块拼起来」的错；以及为什么这类行为必须有真机 E2E。

### 另一条关于定时器的注释

> daemon 模式下这个定时器是唯一的存活句柄：unref 掉之后事件循环随即空掉……日志里 `[lawmindd] 启动` 之后紧跟 `退出 clean exit_code=0`

也就是说，守护进程的 tick 定时器**不能 unref**，否则进程会立刻「正常退出」。非守护模式才 unref（不阻塞应用退出）。

## 14.4 请求要过的六道关

请求处理在 `lawmind-server-dispatch.ts` 的 `lawmindHandleHttpRequest`，顺序固定：

**第一道：CORS 头。** 允许的来源：`null`、`http://localhost:*`、`http://127.0.0.1:*`、`file://`；其他一律回落成 `http://127.0.0.1:5174`。允许的方法 `GET, POST, PUT, PATCH, DELETE, OPTIONS`，允许的头 `Content-Type, Authorization`。

**第二道：回环 Host 门。** 校验 `Host` 头是不是 `127.0.0.1` / `localhost` / `::1`。失败返回：

```text
400 { ok:false, error:"invalid_host", code:"loopback_host_required" }
```

这一道防的是 **DNS 重绑定**。浏览器没法伪造 `Host` 头，所以这个检查能把「浏览器里的恶意页面指向本机端口」挡住。打包态缺 `Host` 头也拒绝；非打包态允许缺失（方便测试）。

**第三道：OPTIONS 直接 204。**

**第四道：发现端点豁免。** `GET /.well-known/lawmind-local` 不要鉴权（还在 Host 门后面），返回：

```json
{
  "ok": true,
  "base": "...",
  "instanceId": "...",
  "epoch": 1,
  "clients": ["desktop", "renderer", "word-addin", "cli"],
  "credentialModel": "derived-hmac-sha256"
}
```

**不含任何密钥**。它的用途是让客户端判断「这个端口上跑的是不是 LawMind 自己」。

**第五道：鉴权与最小权限。** 正常路径：

1. 取 `Authorization: Bearer <凭据>`。
2. 按固定客户端顺序逐个试（跳过已吊销的），支持当前代次和上一代次。
3. 认出来是哪个客户端 → 再查 `isClientAllowedForRequest(clientId, method, pathname)`。
4. 失败分别返回 401 或 403。

| 结果           | 响应                                                                 |
| -------------- | -------------------------------------------------------------------- |
| 认不出凭据     | `401 { error:"unauthorized", code:"invalid_api_token" }`             |
| 认出来了但越权 | `403 { error:"forbidden", code:"client_scope_forbidden", clientId }` |

豁免有两种：`/word-addin/*` 的静态页（`GET` 免 bearer，因为页面要从同源 `config.js` 自己取凭据），以及开发态的 `LAWMIND_SKIP_API_AUTH=1`（打包态强制忽略）。

**第六道：开发态 CSRF 缓释。** 只有在跳过鉴权时才生效：变更类方法（POST/PUT/PATCH/DELETE）必须带 `Content-Type: application/json`，否则：

```text
415 { error:"unsupported_media_type", code:"mutation_requires_json_content_type" }
```

注释说明了它的定位：

> dev skip-auth 模式的 CSRF 缓释：认证全关时，变更类方法必须携带 `Content-Type: application/json`…（Discord/Zoom 本地服务同型 CVE 的收口）。注意：这只是缓释——`LAWMIND_SKIP_API_AUTH=1` 本身是高风险 dev 开关，打包版忽略它。

「只是缓释」这句很重要。这个开关不是安全机制，是开发便利；真正的安全边界是打包态不认它。

### 限流

在分发之前还有一个令牌桶：速率 100/秒、容量 200。**所有路径共用这一个桶**，包括发现端点、静态页、SSE。

超了返回：

```text
429 { ok: false, error: "rate_limited" }
```

限流状态会进 `/api/health`（`doctor.rateLimit`）。

### 404 与错误

路由都不匹配时返回 404，而且给了一句很有用的提示：

```text
本机路由未匹配。若刚升级 LawMind，请在工作区根执行 pnpm lawmind:bundle:desktop-server
（或 pnpm --filter lawmind-desktop bundle:server）后重启桌面端，或重启当前开发用的本地服务进程。
```

这条 hint 针对的是真实场景：升级后忘了重新打包本地服务，新路由不存在。

其他错误走统一信封：`{ ok:false, code, message, error, ...extra }`。已知错误码还有 `body_too_large`（413）、`invalid_json`（400）、`invalid_request_body`（400）。

## 14.5 路由注册表：59 个 handler

`lawmind-server-route-registry.ts` 里是一个**有序数组**，第一个匹配的赢。顺序本身有讲究，比如 e2e 测试路由放最前面（只在开关打开时生效），SSE 和健康检查放很前面。

完整顺序（按代码里的次序）：

```text
e2e → sse → health → bootstrap → templates → acceptance → triage →
review-campaign → skills → intent → mcp → sources → integrations →
tools-registry → draft-revision → redline → search → review → models →
chat → approvals → action-summary → judgment → agent-fleet → mail →
automations → assistants → lawyer-desk → license → support →
matter-replica → matter-cloud → matters → onboarding → daemon →
desk-settings → practice-playbook → contract-review → learning-contract →
sessions → works → records → jobs → collaboration → host-access →
platform → audit-export-summary → audit-verify-external → audit-export →
memory-templates → memory-preview → memory-adoption → word-addin →
metrics → historical-scan → roles → routing → audit-event → fs
```

每个 handler 的签名是 `(args) => boolean | Promise<boolean>`：返回真表示「我处理了」，分发停止。

## 14.6 事件总线：SSE

`lawmind-sse-bus.ts` 提供 `GET /api/events` 这条事件流。

参数：

| 参数          | 说明             |
| ------------- | ---------------- |
| `clientId`    | 可选，客户端标识 |
| `types`       | 订阅类型，多个   |
| `lastEventId` | 断线重连的游标   |

几个实现细节：

- **心跳 15 秒**（`LAWMIND_SSE_HEARTBEAT_MS`），发的是注释行 `: heartbeat`，不占事件名额。
- **重放缓冲 64 条**。断线重连带 `lastEventId` 时会补发之后的；找不到游标就发整个缓冲。
- **订阅模式**支持三种：精确匹配、`*` 通配、以及带冒号的前缀匹配（`task:*` 能匹配 `task:abc:update`；`task:*:update` 会被转成正则 `[^:]*`）。
- 首帧是 `type: "connected"`，带 `{ clientId, subscriptions }`。
- 写失败或背压会关掉这个客户端，不影响其他人。

帧格式是标准 SSE：

```text
id: <eventId>
event: <type>
data: <json>

```

除 `/api/events` 之外，`/api/chat` 也走 SSE 流式返回回合事件，`/api/jobs/:id/stream` 走 job 进度（心跳 25 秒）。

## 14.7 后台任务：job 模型

`lawmind-server-jobs.ts` 管的是「工作流跑一次」这件事的持久化。

### 状态

```text
scheduled → queued → running → completed | failed | cancelled
```

`scheduled` 是已排期未到点；`queued` 是可以跑了；终态有三个。

### 存哪

```text
<工作区>/lawmind/jobs/<jobId>.json
```

上限 200 个（`MAX_JOBS`），超了按创建时间淘汰最旧的，并把文件删掉。

job id 有安全校验：长度 ≤128、不含 `/`、`\`、`..`，必须匹配 `/^[a-zA-Z0-9._-]+$/`。不合法直接 400 `invalid_job_id`——这是防路径拼接。

### 重启后怎么处理

`loadJobsFromDiskOnStartup` 的行为值得记：

- 上次进程留下的**非终态**任务（`queued` / `running`）会被标成 `failed`，错误是 `interrupted_by_restart`，并写明完成时间。
- `scheduled` 的任务**保留**（排期还有效）。

也就是说：跑到一半的任务不会假装还在跑，也不会自动续跑，而是如实告诉你「进程重启过，这次中断了」。

### 幂等键

`idempotencyKey` 是进程内去重：同一个键，如果还有非终态的任务，直接返回**已有的 jobId**，不新建。

键会在任务进终态时释放，任务被淘汰时也释放。

### 排期

`scheduleRunAt` 传一个未来的时间，任务状态就是 `scheduled`，带 `scheduledTrigger: { runAt, source: "local_schedule" }`。到点了由 tick 把它从 `scheduled` 翻成 `queued`（这一步用文件锁做原子翻转）。

### 取消

| 当时状态               | 行为                                                         |
| ---------------------- | ------------------------------------------------------------ |
| `scheduled` / `queued` | 立即转 `cancelled`，错误写 `cancelled_by_user`               |
| `running`              | 只置 `cancelRequested = true`，等执行器的 `shouldAbort` 检查 |
| 已终态                 | 409 `job_already_terminal`                                   |
| 找不到                 | 404 `job_not_found`                                          |

**注意「running 只能请求取消」这件事。** 注释也说了当前实现不中止已经发出的单次调用——它只在步骤批次之间检查。

### 查询

```text
GET /api/jobs?limit=20&status=&since=&matterId=
GET /api/jobs/:id
GET /api/jobs/:id/stream
POST /api/jobs/:id/cancel
```

`limit` 默认 20，夹在 1–100。`status` 可重复传，非法值会被丢掉（不报错）。`since` 是 ISO 时间下界。

## 14.8 守护进程与监督进程

这是一对容易混的概念，分清楚：

|              | 监督进程                        | 守护进程（tick 子进程）    |
| ------------ | ------------------------------- | -------------------------- |
| 环境变量     | `LAWMIND_DAEMON_SUPERVISOR=1`   | `LAWMIND_DAEMON=1`         |
| 谁拉起来     | 桌面端关窗时                    | 监督进程 fork              |
| 持有锁与 pid | **否**（故意不清）              | **是**（唯一互斥权威）     |
| 干什么       | fork 子进程、看退出码、决定重启 | 每 30 秒 tick 一次定时任务 |
| 崩了怎么办   | 自己重启子进程                  | —                          |

注释专门说明了「监督进程故意不清 pid 和锁」这一点。

重启策略是**指数退避**：基 500ms、系数 2、上限 30 秒、最多 5 次。超了就放弃，并把放弃信息写进状态（`supervisionGaveUpAt` / `supervisionGaveUpReason`）。

有一条细节处理得很好：**只有非正常退出才记账**。因为子进程被 `SIGKILL` 时 `process.on("exit")` 根本不会运行，所以要由监督进程来记。注释说这是真机 E2E 抓到的：

> 真机 E2E 抓到：自愈成功后 `lastExitClass` 仍是 `undefined`

### 给律师看的守护状态

`summarizeDaemonForLawyer` 会把守护状态翻译成人话，三种标题：

- 「后台办件已停止重试」
- 「后台办件可能卡住了」
- 「后台办件中断过，已自动恢复」

心跳的判定是：超过 3 个 tick 周期（90 秒）没心跳就算陈旧。

## 14.9 给界面看的状态：`/api/health`

`/api/health` 是体检页的数据源，字段非常多。挑重要的分组说：

**模型与连接**：`modelConfigured`、`modelVerified`、`missingApiKey`、`defaultModelId`、`modelBaseUrl`、`modelProviders`、`webSearchReady`、`retrievalMode`、`dualLegalConfigured`。

**版本与能力**：`edition`（含 `features`）、`capabilityEnvelope`（上下文窗口、最大输出、温度、每轮工具数、历史条数上限）、`lawmindAgentMaxToolCalls`、`citationMode`、`triageRuleCount`、`fleetPlaybookCount`。

**工作区体检**（`doctor` 里）：审计文件数、检索快照数、任务数、草稿数、推理图覆盖率、损坏会话数、悬空工具调用数、孤儿工具结果数、记忆真相源状态、工作区标准检查、会话健康、索引状态（含 `stale` 与 `staleReason`）、案件一致性、任务草稿一致性、法源状态、公司登记源、法源用量、许可、成绩单行、embedding 索引、各类集成状态、限流状态、进程信号。

**策略**：`policy` 里带 `loaded`、`path`、`applied`（哪些键真的生效了）、`egressMode`、`allowWebSearch`、`networkAllowlist`、`networkAllowlistEnforced`。

`applied` 这个字段挺实用：配了策略但没生效时，看一眼这个数组就知道是哪几项被应用了。

## 14.10 环境变量与策略文件的加载顺序

这是配置排障的核心，记顺序：

```text
① 用户环境文件（<应用数据根>/.env.lawmind）—— override: true（覆盖 process.env）
② 仓库环境文件（<仓库根>/.env.lawmind）—— override: false（只补空缺）
③ lawmind.policy.json —— 加载后把若干策略键写进 process.env
```

三点说明：

- **用户文件优先。** 仓库里那份只在开发态补空缺，不会覆盖用户设置。
- **信任分两阶段。** 首跑之前（Phase A）只认用户环境文件；首跑之后（Phase B）才允许仓库文件补缺。
- **策略文件在最后应用**，而且它的用途是「下硬约束」而不是存密钥。注释：「applied after `.env.lawmind` so IT can enforce guardrails without editing secrets」。

策略文件能覆盖的环境变量有四个方向：`egressOffline` / `forceNoWebSearch` → 设 `LAWMIND_POLICY_FORCE_NO_WEB_SEARCH=1`；`retrievalMode` → `LAWMIND_RETRIEVAL_MODE`；`enableCollaboration: false` → `LAWMIND_ENABLE_COLLABORATION=false`；`edition` → `LAWMIND_EDITION`。

`lawmind.policy.json` **必须有 `schemaVersion` 且 ≥1**，否则整份文件被忽略（这是最常踩的坑）。

### 一个关于「偏好」和「上限」的设计

策略里有 `egressMode`（`open` / `allowlisted` / `offline`）和 `allowWebSearch` 两个东西，它们的关系是**上限 vs 偏好**。

有一段注释专门记了一个历史 bug：

> 只写「总模式」，绝不静默改写 `allowWebSearch` / `allowAnalysisScripts` / `productInsightsCollection` —— 那些一律在读取时按 `egressMode` 推导，否则**退出离线模式后律师的原偏好已被抹掉**（历史 bug）。

也就是说：离线模式应该**临时压住**联网偏好，而不是把偏好改成 false。否则律师想恢复联网时，发现偏好已经被写死了。

对应的接口注释也提了一条：`PATCH /api/policy/workspace` 曾经静默写 `false`，现在是只读不写。

## 14.11 Word 插件的取件循环

上一章讲了插件的玩法，这里讲服务端的 tick。

每 30 秒（或插件 POST 后立刻被唤醒）跑一次：

1. **先对账孤儿**（这一步不管开关开没开都跑）：`running` 状态但没有 jobId → 记 `run_interrupted`；job 记录不见了且超过 30 分钟 → `job_record_missing`；job 完成但没结果 → `completed_without_result`；其他终态 → `job_<状态>`。
2. 如果自动跑没开，对账完就返回。
3. 挑最老的一条 `queued`。
4. 源文件不存在 → 记 `source_file_missing`。
5. 解析案件（对不到就 ad-hoc 直跑，不再拦人）。
6. 算文件指纹；需要时授予源目录。
7. 抢占这条请求（这一步会写 `stale` 或写入授权留痕）。
8. 折叠同文件的兄弟请求。
9. 入队跑工作流，键是 `word-addin:<requestId>`。
10. 入队失败分别记 `enqueue_failed` 或 `enqueue_unavailable`。

有一个模块级的串行闸：已经在跑就直接返回 `{ picked: 0, outcomes: [] }`，不并发。

关于第 5 步，注释记了一条真机观察：

> 真机上 `cases/demo-matter-001/` 这类只有文件夹、没有 `matters/<id>/matter.json` 的案卷很常见，只读存储会让它既推断不出、又在下拉里选不到 → 律师彻底卡住。

所以现在改成 ad-hoc 直跑，不再用「请你先选案卷」拦人。

## 14.12 CORS 那个坑

这一节专门讲一个 bug，因为它太容易复现也太容易误判。

症状：**界面上报「无法连接本地服务」，但服务端日志一切正常——甚至已经 200 并把文件写完了。**

具体到下载诊断包：审计里能看到 `status: "error"` 且 `durationMs` 只有 4–8ms（**不是超时**）。

原因：**渲染进程对本服务是跨源**（开发态跑在 `127.0.0.1:5174`，打包后是 `file://`）。如果某条路由**手写 `res.writeHead(...)` 时忘了带 CORS 头**，浏览器会在几毫秒内直接拦掉响应，前端拿到的是 `TypeError: Failed to fetch`。

而走 `sendJson(res, ..., c)` 的路由不会有这个问题——因为工具函数自动带了头。

代码里的注释：

> ⚠️ 必须带上 CORS 头（`c`）……手写 `writeHead` 时不要漏 `...c`。

而且专门加了一个**结构守卫测试**（`lawmind-server-cors-structure.test.ts`），用正则扫服务端所有手写 `writeHead`，要求必须带 CORS 载体。测试注释还自嘲了一句：

> `support.ts` 的注释写着「手写 `writeHead` 时不要漏 `...c`」，于是漏写 `...c`…

也就是说，**光写注释没用，得有机器的检查**。这是这条 bug 最有价值的地方。

## 14.13 关键文件

| 关注点           | 文件                                                                                                  |
| ---------------- | ----------------------------------------------------------------------------------------------------- |
| 服务入口与启动   | `apps/lawmind-desktop/server/lawmind-local-server.ts`                                                 |
| 分发管线         | `lawmind-server-dispatch.ts`                                                                          |
| 路由注册表       | `lawmind-server-route-registry.ts`                                                                    |
| 鉴权             | `lawmind-local-api-auth.ts`（+ `electron/local-api-credentials.mjs`）                                 |
| 限流             | `lawmind-local-rate-limit.ts`                                                                         |
| 事件总线         | `lawmind-sse-bus.ts`                                                                                  |
| HTTP 工具与 CORS | `lawmind-server-helpers.ts`                                                                           |
| 错误信封与解析   | `lawmind-api-error.ts`、`lawmind-api-parse.ts`、`lawmind-api-schemas.ts`                              |
| 任务队列         | `lawmind-server-jobs.ts`                                                                              |
| 守护与监督       | `lawmind-daemon-supervisor.ts`、`lawmind-process-policy.ts`、`src/lawmind/platform/lawmind-daemon.ts` |
| Word 插件取件    | `lawmind-server-word-addin-runner.ts`                                                                 |
| 环境与策略加载   | `lawmind-desktop-env-bootstrap.ts`、`lawmind-policy.ts`                                               |
| 体检载荷         | `lawmind-health-payload.ts`                                                                           |
| 各路由文件       | `lawmind-server-route-*.ts`（59 个 handler）                                                          |

## 14.14 已知坑

- **必须绑 IPv4 和 IPv6 两个协议族。** 只绑 IPv4 时，Word 窗格（WebKit）走 `localhost` → `::1` 会连不上，报的错还是「请检查网络连接」。
- **回环 Host 门不能去掉。** 它是防 DNS 重绑定的唯一手段，浏览器伪造不了 `Host`。
- **打包态忽略 `LAWMIND_SKIP_API_AUTH`。** 别指望在生产上用它省事。
- **开发态跳鉴权时变更请求必须带 JSON Content-Type。** 这层是为了缓释 CSRF，别当普通校验删掉。
- **限流是全路径共用一个桶。** 包括 SSE 和静态页。压测时注意这一点。
- **守护定时器在守护模式不能 unref。** unref 了进程会立刻「正常退出」，日志里看起来像启动成功然后干净退出。
- **监督进程故意不清 pid 和锁。** 那是 tick 子进程的职责，对调就重现那个启动 bug。
- **`running` 的 job 取消只是「请求取消」。** 已发出的单次调用不会被中止，只在步骤批次之间生效。
- **重启后非终态的 job 会标成 `interrupted_by_restart`。** 不会自动续跑，这是有意的。
- **策略文件缺 `schemaVersion` 会被整份忽略。** 配了没生效先看这一条。
- **不要用策略去改写律师的联网偏好。** 离线模式是「上限」，不是「把偏好改成 false」。
- **手写 `writeHead` 必须带 CORS 头。** 症状是前端 `Failed to fetch`（几毫秒内失败）而后端日志全绿。有结构测试守着，别绕过它。
- **404 的 hint 指向重新打包本地服务。** 升级后碰到大量 404，先跑 `pnpm lawmind:bundle:desktop-server`。
