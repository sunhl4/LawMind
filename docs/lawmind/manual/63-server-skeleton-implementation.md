# 第 63 章 实现精读：本地服务端骨架

第 14 章从外面讲了本地 API：启动 19 步、请求六道关、59 个路由 handler。但那是**从协议看**。这一章讲**实现**：`apps/lawmind-desktop/server/` 里那些非路由文件怎么把这件事做出来的。**同一段启动流程在代码里是 24 步**——19 与 24 的差别只是合并粒度（第 14 章把「读环境 + 判定模式 + 校验」并成了两步），不是两套流程。

这一层有 79 个非测试文件、约 1.9 万行（37,045 是整个目录含测试的行数）。其中 59 个是 `lawmind-server-route-*.ts`（第 64、65 章），剩下 20 个是骨架：

```text
lawmind-local-server.ts          进程入口 + 启动编排
lawmind-server-dispatch.ts       请求六道关 + 路由分派
lawmind-server-helpers.ts        HTTP/JSON/路径/模型配置共享助手
lawmind-server-jobs.ts           工作流作业注册表
lawmind-local-api-auth.ts        两道鉴权门
lawmind-local-rate-limit.ts      令牌桶
lawmind-api-error.ts             统一错误体
lawmind-api-parse.ts             zod 解析
lawmind-api-schemas.ts           schema 总出口
lawmind-policy.ts                工作区策略文件
lawmind-process-policy.ts        进程崩溃策略
lawmind-desktop-env-bootstrap.ts 环境装载
lawmind-daemon-supervisor.ts     后台进程监督
lawmind-health-payload.ts        体检载荷
lawmind-sse-bus.ts               SSE 总线
lawmind-server-word-addin-runner.ts  Word 插件取件
lawmind-server-matter-replica-scheduler.ts 调度器句柄
lawmind-server-route-registry.ts 路由注册表
lawmind-server-route-types.ts    路由上下文类型
safe-task-id.ts / safe-assistant-id.ts  两个路径段校验
lawmind-source-anchor.ts         引用锚点
```

## 63.1 为什么绑两个协议族

`lawmind-local-server.ts` 的头注释把这件事说得很清楚：

```text
LawMind local HTTP API for desktop shell (loopback only: 127.0.0.1 + ::1, never LAN).

为什么是两个协议族：`localhost` 在 macOS 上同时解析到 `::1` 与 `127.0.0.1`，
WebKit / Word 任务窗格多半先试 `::1`。只绑 IPv4 会让 `http://localhost:<port>` 直接连不上。
```

**这是一条踩过坑的记录**：只绑 IPv4 会让 `localhost` 连不上。因为 `localhost` 在 macOS 上先解析成 `::1`，而 IPv6 上没有监听。

所以最后是 `createServer` 两次（IPv4 + IPv6），共用同一个 `handleRequest`。

### 头注释里那份环境变量清单

```text
- LAWMIND_WORKSPACE_DIR (required)
- LAWMIND_DESKTOP_PORT (required)
- LAWMIND_ENV_FILE (optional path to .env.lawmind)
- LAWMIND_DESKTOP_ACTOR_ID (optional; default `lawyer:desktop`)
- LAWMIND_ENABLE_COLLABORATION (optional; default enabled)
```

**两个必填、三个可选。** 而且头注释给了运行方式（`node --import tsx ...`）和策略文件的位置。

### 一件值得单独说的事：端口只走环境变量

这份代码里**没有端口列表、没有端口递增、没有握手文件**。

端口来源只有一个：`LAWMIND_DESKTOP_PORT`。校验是：

```text
- 不是数字 / 非有限 / <1 / >65535 → 报 Invalid LAWMIND_DESKTOP_PORT，退出码 1
- 缺 workspaceDir 或（非 headless 且缺 port）→ 报 required，退出码 1
```

**换句话说：端口冲突不会被自动规避，也不会写文件告诉别人。** 第 14.11 节讲的「端口漂移」故障，解决方式是 Electron 侧选一个空闲端口再把它传进来——服务端只负责「按给定端口绑」。

### 两个监听器的错误处理不对称

IPv4 那个**没有** `on("error")` 监听：

```text
server   （IPv4）：无 error 监听 → EADDRINUSE 变成未捕获的 'error' 事件
        → 被底部的 uncaughtException 处理器接住 → 打印 + 退出码 1
serverV6 （IPv6）：有 error 监听 → 只打印一行，进程继续
```

IPv6 那行文案写明了它是尽力而为：

```text
[lawmind-local-server] IPv6 回环监听失败（主服务不受影响）: <原因>
```

**这个不对称是有道理的**：IPv4 是主服务，绑不上就没有服务可提供（必须失败）；IPv6 只是为了让 `localhost` 也能连上（失败还能用 `127.0.0.1`）。

### 启动编排的 24 步（第 14 章那 19 步是把其中几步合并后的说法）

`main()` 的顺序（按代码）：

```text
① 读环境：DAEMON?  SUPERVISOR?  WORKSPACE_DIR  DESKTOP_PORT  ENV_FILE
② headlessMode = daemonMode || supervisorMode
③ 校验必填 → 缺就报错退出          （headless 模式不要求 port）
④ 校验 port 合法性
⑤ mkdirSync(workspaceDir, { recursive: true })
⑥ supervisorMode → runDaemonSupervisor(...) 然后 return（监督进程不跑业务）
⑦ 非 daemonMode → stopDaemonProcess（注释：desktop owns ticks while the window is open）
⑧ daemonMode → acquireDaemonLock；拿不到锁就「让位」退出码 0
⑨ daemonMode → markDaemonStarted / clearDaemonSupervisionGiveUp
⑩ 装 SIGTERM/SIGINT
⑪ bootstrapLawMindDesktopEnv（装载 .env.lawmind）
⑫ ensureBuiltinWorkflowSeeds
⑬ resolveSkillSigningSecretSource → 派生密钥要打警告
⑭ ensureBuiltinSkillSeeds
⑮ LAWMIND_STRICT_TOOL_STREAM 默认 "0"
⑯ loadAndApplyLawMindPolicy
⑰ restoreDelegationsFromDisk + loadJobsFromDiskOnStartup
⑱ setWorkflowJobSchedulerContext
⑲ 定义 tickScheduled → 跑一次 + setInterval
⑳ startMatterReplicaAutoSync
㉑ 有 LAWMIND_AUDIT_EXTERNAL_ANCHOR_URL → 开始外锚同步
㉒ 索引不存在 → 后台重建
㉓ daemonMode → 打印一行就 return（不起 HTTP）
㉔ 初始化回环令牌与客户端凭据；建 TokenBucket；两个 createServer + listen
```

### 第 ⑦ 步与第 ⑧ 步是两种「谁来跑 tick」

这两步是一对：

| 场景                      | 行为                                    |
| ------------------------- | --------------------------------------- |
| 桌面窗口开着（非 daemon） | **先停掉后台守护进程**——窗口自己跑 tick |
| daemon 模式               | 拿单实例锁；拿不到就退出（让位）        |

注释写明了理由：

```text
/* desktop owns ticks while the window is open */
```

而让位时的日志有两行（中英各一条）：

```text
[lawmindd] 已在运行，本进程让位（pid=<pid>）
[lawmindd] already running (pid=<pid>)
```

**「让位」的退出码是 0**——不是错误，是正常结果。

### tick 里跑四件事 + 可选两件

```text
processDueScheduledJobs      排期作业
processDueLawyerAutomations  律师自动办件
processDueDeadlineReminders  期限提醒
tickWordAddin                Word 插件取件
autoRebuildSearchIndexIfStale  （可选）索引陈旧就重建
markDaemonTick               （daemon 模式）心跳
```

**间隔是共用一个 `setInterval`**。而 `scheduleTimer.unref?.()` 只在非 daemon 模式加——**桌面模式下定时器不阻止进程退出**（窗口关了就该退）。

### 技能签名密钥的那个警告

当密钥来源是「按工作区路径派生」时，会打一条长警告（原文）：

```text
[lawmind-local-server] 警告：未配置 Skill 签名密钥，正在用「按工作区路径派生」的兜底值。
它不是秘密，任何知道该路径的人都能伪造 SKILL.md + SKILL.sig；打包部署请设
LAWMIND_SKILL_SIGNING_SECRET（见 docs/lawmind/LAWMIND-SKILLS-SIGNING.md）。
```

**「它不是秘密」**——把兜底值的安全性质直接说穿了，并给出正式做法。

### 这个文件不导出任何东西

它只做一件事：`void main();`。所有函数都是文件内私有的。

**所以它不能被 import 测试**——只能整个进程跑。这解释了为什么它的覆盖主要靠 e2e。

### 退出路径的边界

值得单独记一句：**这个文件没有 `dispose`，也没有 `server.close()`**。

信号处理器（SIGTERM/SIGINT）只在 `daemonMode` 分支里装了。桌面模式下：

```text
定时器 unref 了，但两个 HTTP server 会一直让事件循环活着
→ 退出靠 Electron 侧终止进程，不是靠服务端自己收尾
```

**这不是漏写，是分工**：桌面模式下进程生命周期归 Electron 管（第 13 章）。

## 63.2 请求的十三步

`lawmind-server-dispatch.ts` 只有一个导出（`lawmindHandleHttpRequest`），但它是整个 API 的大门。

### 逐步展开

| #   | 检查                                         | 失败响应                                                             |
| --- | -------------------------------------------- | -------------------------------------------------------------------- |
| ①   | 算 origin 与 CORS 头                         | —                                                                    |
| ②   | Host 必须是回环                              | `400 invalid_host` / `loopback_host_required`                        |
| ③   | OPTIONS                                      | `204` + 空体                                                         |
| ④   | 解析 URL                                     | —                                                                    |
| ⑤   | 发现端点（GET `/.well-known/lawmind-local`） | `200` 载荷（免 bearer）                                              |
| ⑥   | Word 静态资源（GET `/word-addin*`）          | 免 bearer                                                            |
| ⑦   | 开发跳过开关                                 | 当 `shared` 客户端                                                   |
| ⑧   | 解析客户端凭据                               | `401 unauthorized` / `invalid_api_token`                             |
| ⑨   | 客户端-路径范围                              | `403 forbidden` / `client_scope_forbidden`                           |
| ⑩   | 变更请求必须 JSON content-type               | `415 unsupported_media_type` / `mutation_requires_json_content_type` |
| ⑪   | 路由分派                                     | 命中就返回                                                           |
| ⑫   | 404                                          | `404 not found` / `no_route` + hint                                  |
| ⑬   | 异常                                         | LawMindHttpError → 它的 status/code；否则 `500 internal_error`       |

**第 ② 步才是反 DNS rebinding 的关键**——第 63.4 节细讲。

### 第 ⑫ 步那条 hint 值得抄下来

```text
本机路由未匹配。若刚升级 LawMind，请在工作区根执行 pnpm lawmind:bundle:desktop-server
（或 pnpm --filter lawmind-desktop bundle:server）后重启桌面端，或重启当前开发用的本地服务进程。
```

**「未匹配」最常见的真实原因不是路由写错，是服务端代码是旧的。** 所以 404 里直接给了那两条命令。这是一条很具体的经验：**路由文件改了但没重新 bundle**。

### 发现端点：为什么要有它

它是全文件里唯一一段长注释，值得整段读：

```text
发现端点载荷（RFC 9728 Protected Resource Metadata 的**形状**，但只回非秘密字段）。

为什么要有它：客户端必须在「启动时」和「收到 401 时」能自己重新发现坐标，否则
一旦坐标变化（换端口 / 轮换代次）客户端只能人工重载 —— 这正是本机 API 改造前的病根。
它**不含任何秘密**（没有令牌、没有安装密钥），所以可以免 bearer；仍受回环 Host 校验，
且 `corsHeaders` 只对回环来源放行，浏览器侧读不到响应内容。
```

三条要点：

1. **形状参考 RFC 9728**，但只回非秘密字段。
2. **「客户端要能自己重新发现坐标」**——这是它存在的唯一理由。
3. **「不含任何秘密」**——所以可以免 bearer。但仍过回环 Host 校验。

载荷内容：

```text
{ ok, base, instanceId, epoch, clients, credentialModel: "derived-hmac-sha256" }
```

**`credentialModel` 这个字段很实用**：它告诉客户端「凭据是派生式的 HMAC」，而不是「一个固定令牌」。所以客户端知道换代次意味着凭据会变。

### 路由表是「有序数组，先匹配先赢」

注册表在 `lawmind-server-route-registry.ts`：

```text
/** Ordered route handlers; first match wins (same semantics as the legacy if-chain). */
```

**「先匹配先赢」是显式声明的语义**——它和老的 if 链一致。所以注册顺序**是有意义的**，不是随便排的。

**59 个 handler 的顺序**（与第 14.5 节那份一致；这里标出关键位置）：

```text
e2e → sse → health → bootstrap → templates → acceptance → triage → review-campaign
→ skills → intent → mcp → sources → integrations → tools-registry → draft-revision
→ redline → search → review → models → chat → approvals → action-summary → judgment
→ agent-fleet → mail → automations → assistants → lawyer-desk → license → support
→ matter-replica → matter-cloud → matters → onboarding → daemon → desk-settings
→ practice-playbook → contract-review → learning-contract → sessions-extended
→ works → records → jobs → collaboration → host-access → platform
→ audit-export-summary → audit-verify-external → audit-export → memory-templates
→ memory-preview → memory-adoption → word-addin → metrics → historical-scan
→ roles → routing → audit-event → fs
```

**三处顺序有实际后果**：

| 位置                              | 后果                                                         |
| --------------------------------- | ------------------------------------------------------------ |
| `e2e` 最前                        | 测试路由优先于一切                                           |
| `draft-revision` 在 `review` 之前 | 修订任务端点不被文书台抢走                                   |
| `review` 在 `records` 之前        | `GET /api/tasks/:id` 的权威实现在 `review`（带 checkpoints） |

最后那条有明确注释（第 64 章会展开）：**`records` 里刻意不再实现 `GET /api/tasks/:id`**，避免两版响应形状漂移。

### CORS 的四个放行来源

`corsHeaders` 的放行清单：

```text
"null"
http://localhost:*
http://127.0.0.1:*
file://*
兜底回落：http://127.0.0.1:5174
```

**`"null"` 与 `file://*` 是给 Electron 渲染层与 Word 任务窗格用的**（它们的 origin 不是 http 站点）。

而三个头：

```text
access-control-allow-methods: GET, POST, PUT, PATCH, DELETE, OPTIONS
access-control-allow-headers: Content-Type, Authorization
```

### 有一个专门的守卫测试看着 CORS

`lawmind-server-cors-structure.test.ts` 的结构很特别——它**扫源码**：

```text
describe("服务端 CORS 结构守卫")
  it("每个手写 res.writeHead 都必须带上 CORS 载体（`...c` 等）")
  it("守卫本身有效：漏写 `...c` 的样本必须被判为不合规（且注释里的 `...c` 不能算数）")
```

第二条尤其关键：**它验证「守卫本身有效」**——用一个故意漏写的样本确认守卫会报警。而且「注释里的 `...c` 不能算数」，所以要剥掉注释再匹配。

失败消息把后果说清了：

```text
这些手写 writeHead 没带 CORS 头：渲染层跨源 fetch 会被浏览器直接拦掉
（界面报「无法连接本地服务」，而服务端其实已经 200）。加上 `...c` 即可。
```

**「服务端其实已经 200」**——这个症状很容易误诊成「服务没起来」。所以有一条机器守卫盯着它。

## 63.3 共享助手：那些上限与围栏

`lawmind-server-helpers.ts` 是全局共用层。

### 四个常量

| 常量                    | 值                         |
| ----------------------- | -------------------------- |
| `LAWMIND_LOCAL_HOST`    | `"127.0.0.1"`              |
| `LAWMIND_LOCAL_HOST_V6` | `"::1"`                    |
| `MAX_TEXT_READ_BYTES`   | 1000000（1 MB）            |
| `MAX_JSON_BODY_BYTES`   | 256000（256 KB）           |
| `WRITABLE_FS_ROOTS`     | `{"workspace", "project"}` |

**请求体上限 256 KB** 是个关键数字——第 63.7 节会看到路由层还有各自的 schema 上限。

### `readJsonBody` 的三条分支

```text
字节累计 > 256000 → 抛 body_too_large (413) + req.destroy()
空 / 全空白       → resolve {}
JSON.parse 失败   → 抛 invalid_json (400)
```

**超限时先 `destroy()` 再抛**——不然客户端还在往里灌数据。

### 路径围栏：五条错误

`resolveFsPath` 的错误清单：

```text
internal: resolveFsPath requires access: read|write   ← 调用方漏传 access
invalid root                                          ← 根键不认识
root not available                                    ← 根不存在
path traversal is not allowed                         ← 有 ..
path escapes root                                     ← realpath 后出界
symlink escapes root                                  ← 软链指向外面
```

**第五条是独立的**：`path escapes root` 是「字面上出界」，`symlink escapes root` 是「字面明明在里面但软链指到外面」。**两种都要查，不能只查一条。**

而不可写根的拒绝分两种：

```text
本机文件夹默认不能改写。请使用「收进本案」复制到案件目录。      ← MOUNT_WRITE_REFUSAL
不可写的根：<rootKey>                                        ← 其他不可写根
```

**第一种是给律师看的（带建议），第二种更像内部错误**（根键直接透出来）。这个不对称说明第一条才是常见的那个。

### `safeArtifactPath`：只放两个位置

它只允许两种相对路径：

```text
artifacts/...
cases/<案>/artifacts/...
```

而且第二种要求**至少 3 段**。`".."` 与 `\0` 直接拒。

**这就是第 57.10 节「输出位置六级」在服务端的执行点**：交付物只能落在这些地方。

### 模型错误的映射：504 与 502 的区分

`resolveModelCallHttpError` 把模型错误翻成 HTTP：

| 判据                                                                          | status | code                  |
| ----------------------------------------------------------------------------- | ------ | --------------------- |
| 含 `AbortError` / `aborted` / `timed out` / 以 `Model request timed out` 开头 | 504    | `model_unavailable`   |
| 以 `Model network error` 开头 或 含 `fetch failed`                            | 502    | `model_network_error` |
| 其他                                                                          | 502    | `model_unavailable`   |

**504 是「超时」，502 是「网络与上游」**。这个区分让渲染层能给出不同的提示（超时→可重试；网络→查配置）。

而 `message` 一律走 `friendlyModelErrorMessage(msg)`——**不把原始错误直接给律师**。

### `buildAgentConfig` 的三条缺 Key 错误

```text
missing_platform_api_key   平台模型尚未开通或运维未注入平台 Key
missing_provider_api_key   当前模型所属服务商尚未配置 API Key
missing_api_key            未配置模型 API Key
```

**三条是不一样的情况**，所以分了三个码。这个拆分在 `route-chat` 里被直接用作 503 响应。

而 `buildAgentConfig` 里有一个「配置清洗」：

```text
maxTokens 缺失 或 <= 4096 → 覆盖
temperature === 0.3       → 视为未设置，改用 resolveTemperatureForTask("chat")
```

**`0.3` 被当作「没填」是一个反直觉但对的行为**：因为 0.3 是历史默认值，如果真按 0.3 用，就会覆盖按任务调的推荐温度。

## 63.4 两道鉴权门的顺序

`lawmind-local-api-auth.ts` 的头注释直接写了「顺序不可换」：

```text
## 两道门（顺序不可换）

1. **Host 必须是回环**（`validateLoopbackHttpHost`）：浏览器无法伪造 `Host`，
   所以这一道才是反 DNS rebinding 的关键（CORS 只挡读取、不挡执行）。
2. **凭据**：`Authorization: Bearer`，比对沿用**常量时间**比较。
```

**「CORS 只挡读取、不挡执行」**——这一句是整段的核心。所以 Host 检查必须在凭据之前。

### 凭据是怎么派生的

真相源在 `apps/lawmind-desktop/electron/local-api-credentials.mjs`：

```text
credential(clientId, epoch) = HMAC-SHA256(installationSecret, `${clientId}:${epoch}`)
                            → 十六进制摘要
```

四个客户端 id：

```text
["desktop", "renderer", "word-addin", "cli"]
```

还有一个旧的共享身份：

```text
LEGACY_SHARED_CLIENT = "shared"
```

**派生凭据的三个好处**（这是相比固定令牌的改进）：

1. **每个客户端一个凭据**——所以能按客户端收权（第 63.5 节的 revoked 列表）。
2. **换代次就全换**——`epoch` 一变，所有派生凭据同时失效。
3. **不需要把凭据存下来**——服务端只要有 installation secret 就能算出来。

### 三个「代次」相关的常量

```text
LOCAL_API_EPOCH_GRACE = 1        ← 允许上一个代次
LOCAL_API_DISCOVERY_PATH = "/.well-known/lawmind-local"
LOOPBACK_HOSTNAMES = {"127.0.0.1", "localhost", "::1"}
```

**「允许上一个代次」是换代的过渡期**：服务端换代时，客户端手里可能还是旧代次的凭据。给一代宽限，避免换代瞬间所有客户端掉线。

### 吊销列表与代次都是环境变量

```text
LAWMIND_LOCAL_API_EPOCH              整数 > 0
LAWMIND_LOCAL_API_REVOKED_CLIENTS    逗号分隔
LAWMIND_LOCAL_API_INSTALLATION_SECRET
LAWMIND_LOCAL_API_INSTANCE_ID
```

**所以「吊销某个客户端」不需要改代码**——运维加一个环境变量就行。

### 那个开发开关打包版不认

```text
LAWMIND_SKIP_API_AUTH = "1" 时才跳过鉴权
但 isLawmindPackagedRuntime()（LAWMIND_PACKAGED === "1"）为真时一律返回 false
```

注释写明了：

```text
LAWMIND_SKIP_API_AUTH=1 本身是高风险 dev 开关，打包版忽略它
```

**「打包版忽略它」是一条硬性保护**：避免开发期的方便开关泄漏到用户机器上。

而另一个细微处：**缺 Host 头只在非打包版被允许**。

### 变更请求必须带 JSON content-type

```text
MUTATION_METHODS = {POST, PUT, PATCH, DELETE}
要求 content-type 小写后以 "application/json" 开头
```

**这是一道 CSRF 防线**。理由：跨站表单只能发 `application/x-www-form-urlencoded`、`multipart/form-data`、`text/plain`——**发不出 `application/json`**（除非用 fetch + 预检，那就被 CORS 与 Host 检查拦了）。

## 63.5 令牌桶：一个全局桶

`lawmind-local-rate-limit.ts` 很小，但有一个设计决定值得说。

```text
实例化在 local-server：new TokenBucket({ rate: 100, capacity: 200 })
注册用 registerRateLimitBucket(rateBucket)
```

**「注册」而不是「传参」意味着它是进程级的单例桶**——两个监听器、所有客户端共用一个。

而拒绝响应：

```text
429 + { ok: false, error: "rate_limited" }
```

**注意它没有 `code` 字段**，与第 63.2 节那六道关的响应形状不一致（那些都有 `code`）。这是一处小的不一致。

**100 请求/秒、突发 200** 的量级说明它的定位是「防失控客户端」，不是「防攻击」——因为回环服务本来就只有本机进程能访问。

## 63.6 工作流作业：六态与三条守卫

`lawmind-server-jobs.ts` 没有头注释，但它有 823 行。

### 六个状态

```text
scheduled  queued  running  completed  failed  cancelled
```

而终态是三个：`completed` / `failed` / `cancelled`。

**`scheduled` 是「已预约」**——它和 `queued` 的区别是「要不要等时间」。第 63.7 节的 restart 恢复里有一条注释专门说这件事。

### 记录字段与公开字段的差

```text
PublicWorkflowJob = Omit<WorkflowJobRecord,
  "workspaceDir" | "idempotencyKey" | "workflowSnapshot">
```

**三个字段只在服务端保留**：

| 字段               | 为什么不给客户端                   |
| ------------------ | ---------------------------------- |
| `workspaceDir`     | 绝对路径（第 56.8 节那条路径脱敏） |
| `idempotencyKey`   | 是幂等键，泄漏会影响重放语义       |
| `workflowSnapshot` | 完整工作流快照，界面不需要         |

**这是一个「白名单式公开」的实现**：用 `Omit` 而不是「挑选字段」。所以新增字段时默认**不外露**——安全方向的默认值。

### 三个上限

| 常量                      | 值  |
| ------------------------- | --- |
| `MAX_JOBS`                | 200 |
| `MAX_IDEMPOTENCY_KEY_LEN` | 128 |
| `MAX_WORKFLOW_JOB_ID_LEN` | 128 |

而列表查询的上限：`min(max(limit, 1), 100)`。

**注册表裁剪到 200 条时会同时删磁盘文件**（`lawmind/jobs/<id>.json`）——所以「内存里没有的」就是「磁盘上也没有的」。

### 幂等键的语义

```text
非字符串 → null
否则 trim 后截 128 位
空 → null
```

而 `enqueueWorkflowRun` 里：**若该键对应的作业还在非终态，直接返回那个 jobId**（不新建）。

释放时机：作业到终态、被取消、或被裁剪。

**「非终态才复用」这条很重要**：作业跑完了，同一个幂等键可以再提交一次（那是一次新的请求，不是重复）。

### 重启恢复：两种状态两种处理

`loadJobsFromDiskOnStartup` 的规则：

```text
status === "queued" || status === "running"
  → 改写为 failed，error = "interrupted_by_restart"，
    补 completedAt，删掉 progress 与 cancelRequested
其他状态 → 原样加载
```

注释解释了为什么 `scheduled` 不改：

```text
// scheduled jobs survive restart; tick will pick them up
```

**「预约的作业能跨重启」**——因为它本来就还没到该跑的时间。而正在跑的被标成失败，因为进程已经死了，那个作业不可能继续。

**`error = "interrupted_by_restart"` 这个字符串是个稳定契约**——Word 插件的 `humanizeWordAddinJobError` 会把它翻成中文（第 65.5 节）。

### 事件通知：一个 EventEmitter 按 jobId 分频道

```text
jobWatchEmitter = new EventEmitter()
jobWatchEmitter.setMaxListeners(256)
频道名 = `job:${jobId}`
subscribeWorkflowJobUpdates(jobId, listener) → () => void
```

**256 个监听者上限**——因为一个 job 可能被多个界面订阅（对话、在办、任务抽屉）。

### 不在这个文件里的两件事

| 事项     | 实际在哪                                                              |
| -------- | --------------------------------------------------------------------- |
| 并发上限 | **没有常量**。每个作业用 `setImmediate` 起，取消靠 `shouldAbort` 轮询 |
| SSE 缓冲 | `sse-bus.ts` 的 `SSE_REPLAY_LIMIT = 64`                               |

**「没有并发上限」**：这里的作业**不是串行**的。串行只在 Word 插件取件那一条链上（第 63.16 节）。

### 十一个审计细节字符串

作业的每一处状态变化都往审计写一行，格式统一：

```text
workflow_job=<id> scheduled|enqueued workflowId=<id>
workflow_job=<id> running
workflow_job=<id> status=<状态> workflowId=<id>
workflow_job=<id> status=failed error=<错误>
workflow_job=<id> cancel_requested
workflow_job=<id> status=cancelled queued_abort
```

**「`status=cancelled queued_abort`」那句是「还没真的停，只是标了取消」**——因为取消要等可中断点。终态时的 `status=cancelled` 才是真停了。

### 一个细节：作业也发协作事件

取消/完成时会发一条 `kind: "notify.sent"`，`fromAssistantId: "system"`、`toAssistantId: "lawyer"`。

**也就是：作业状态变化会在会议室的协作事件流里留痕**——用「系统通知律师」这个形状。

## 63.7 统一错误体：一个 `error` 字段是兼容别名

`lawmind-api-error.ts` 定义了错误体的形状：

```text
{ ok: false, code: string, message: string, error: string, [key: string]: unknown }
```

**`error` 是 `message` 的兼容别名**——两个字段值一样。

**为什么留两个**：早期响应只有 `error`，后来加了 `code` + `message`。为了不破坏老客户端，`error` 保留但不再是主字段。

### 错误码不是枚举，是字面量

这个文件里**没有错误码枚举**——码是各调用点的字符串字面量。

我把它扫了一遍，骨架层出现的码有：

```text
loopback_host_required     invalid_api_token       client_scope_forbidden
mutation_requires_json_content_type               no_route
internal_error             body_too_large          invalid_json
invalid_request_body       model_unavailable       model_network_error
```

而作为 `error` 字段（非 `code`）发的还有：`rate_limited`、`invalid_host`、`unauthorized`、`forbidden`、`unsupported_media_type`、`not found`。

**这处不一致**：六道关的响应里 `error` 和 `code` 都会填，但填的值有时一样（`invalid_host`）有时不一样（`not found` vs `no_route`）。**客户端应该只依赖 `code`。**

## 63.8 一处值得单独讲的边界：zod 的 path 里有 symbol

`lawmind-api-parse.ts` 很短，但那一段注释是全骨架里最有价值的一条：

```text
把 zod 的 issue 压成一行行可读文本。

参数类型刻意写成 `readonly PropertyKey[]`：zod（v4）的 `issue.path` 是
`PropertyKey[]`，可能含 **symbol**。而 `Array#join` 会抛
`TypeError: Cannot convert a Symbol value to a string`——
所以这里逐个元素用 `String()` 安全转换，而不是直接把整段 path 交给 join。
之前声明的 `(string | number)[]` 比现实窄，正好把这条边界掩盖了。
```

**三层信息**：

1. **现象**：`Array#join` 遇到 symbol 会抛 `TypeError`。
2. **根因**：`issue.path` 的真实类型是 `PropertyKey[]`（含 symbol），而声明写窄了。
3. **那条元观察**：「声明比现实窄，正好把边界掩盖了」——**类型写错不会报错，只会让运行时炸在别处**。

而格式化的结果是「`路径: 消息`」用分号连接；path 为空时用 `"body"` 兜底。

错误类型是结构化的：

```text
LawmindRequestParseError = Error & {
  code: "invalid_request_body"; status: 400; issues: string[]
}
```

**带 `issues` 数组**——所以路由层能把具体哪几个字段不对告诉界面。

## 63.9 工作区策略文件

`lawmind-policy.ts` 的头注释说明了执行时机：

```text
Optional workspace policy file: `lawmind.policy.json` next to workspace root.
Applied after `.env.lawmind` so IT can enforce guardrails without editing secrets.
```

**「在 .env.lawmind 之后应用」**——所以策略文件能覆盖环境变量，而它不需要放密钥。这是给律所 IT 的入口。

### 八个字段与它们的副作用

| 字段                                                                                                         | 副作用                                   |
| ------------------------------------------------------------------------------------------------------------ | ---------------------------------------- |
| `schemaVersion`                                                                                              | 必须 ≥1，否则整个文件不生效              |
| `egressMode`                                                                                                 | `offline` → 设强制禁网                   |
| `highSecurityMode`                                                                                           | **已废弃**，等同 `egressMode: "offline"` |
| `allowWebSearch`                                                                                             | `false` → 设强制禁网                     |
| `retrievalMode`                                                                                              | `single`/`dual` → 设检索模式变量         |
| `enableCollaboration`                                                                                        | `false` → 关协作                         |
| `edition`                                                                                                    | 值在 `listEditions()` 里 → 设版本变量    |
| `agentMaxToolCallsPerTurn` / `agentMandatoryRules` / `agentMandatoryRulesPath` / `productInsightsCollection` | 读出但副作用不在这个文件                 |

而返回的 `applied[]` 会报告哪些键被应用了——**所以界面/日志能看出策略生效了没**。

### `resolveChatAllowWebSearch` 的语义

```text
策略强制关 → 一律返回 false（无视请求）
策略没强制 → 返回请求的值
```

注释补了一句：

```text
Compose「联网」is independent of 权限 mode.
```

**「联网开关独立于权限模式」**——两个维度不要混（5.4 的工具清单里那几个联网工具就是它的作用面）。

## 63.10 进程崩溃策略：两种崩溃两种态度

`lawmind-process-policy.ts` 的头注释是一段取舍说明，值得完整读：

```text
取舍说明（二选一的明确化）：
- uncaughtException：同步执行栈状态可能已损坏，带病继续风险不可控 —— 记录后干净退出，
  由 Electron 监督层指数退避重启（electron/local-server.mjs）；daemon 模式无监督层，
  残留 pid 由 isDaemonPidAlive 探测，下次桌面会话自愈。
- unhandledRejection：本服务存在大量 best-effort 后台任务（索引重建、自动化 tick、
  外部模型/邮件请求），孤立 rejection 多为单任务失败而非进程级损坏 —— 可用性优先，
  记录并计入健康信号（/api/health → doctor.process.degraded），不退出进程。
```

**两种崩溃的态度完全相反，而且各有理由**：

| 崩溃类型             | 态度             | 理由                             |
| -------------------- | ---------------- | -------------------------------- |
| `uncaughtException`  | **干净退出**     | 同步栈可能已损坏，带病继续不可控 |
| `unhandledRejection` | **不退，只记录** | 多为单任务失败，可用性优先       |

**第二条的理由很具体**：「本服务存在大量 best-effort 后台任务」——索引重建、自动化 tick、模型与邮件请求。这些都可能在没 catch 的地方拒绝，但它们失败不影响主链路。**如果每个都退出进程，服务会一直重启。**

而两者的补救路径也不同：

- 进程退了 → Electron 监督层指数退避重启；daemon 模式靠 pid 探测自愈。
- 不退 → 计入健康信号，`/api/health` 的 `doctor.process.degraded` 会亮。

三个字段：

```text
{ uncaughtExceptions, unhandledRejections, degraded }
degraded = uncaughtExceptions > 0 || unhandledRejections > 0
```

**注意 `degraded` 只要有一个计数 >0 就是真**——所以那个「吞掉超时 promise 拒绝」的动作（第 60.1 节）不是可选的。

## 63.11 环境装载：用户文件优先，仓库文件只补缺

`lawmind-desktop-env-bootstrap.ts` 的头注释把两种信任阶段说清了：

```text
Load desktop model/API env: user `.env.lawmind` wins; repo `.env.lawmind` fills gaps only.

Trust phases (Claude Code–style):
- Phase A (pre–first-run trust): user env only; no repo fill until workspace trust confirmed.
- Phase B (post–first-run): optional repo `.env.lawmind` gap-fill via `bootstrapLawMindDesktopEnv`.
```

**「Phase A / Phase B」是两个信任阶段**：首跑之前只信用户自己的文件，首跑之后才允许用仓库文件补缺。**「Claude Code–style」这个标注说明它借鉴了同类的信任模型。**

### 四步装载

```text
① workspaceDir 解析成绝对路径
② userEnvPath = 显式 envFile，否则 <工作区父目录>/.env.lawmind
③ 用户文件存在 → loadLawMindEnv(..., { override: true })     ← 覆盖
④ 有 repoRoot 且仓库文件存在 → loadLawMindEnv(..., { override: false })  ← 不覆盖
```

**两个 `override` 值就是「优先」与「补缺」的实现**。而返回 `{ userEnvPath, userEnvLoaded, repoEnvLoaded }` 让调用方能报告实际装载了什么。

**用户 env 放在「工作区的父目录」**是个细节：工作区是 `~/LawMind/工作区`，那用户文件是 `~/LawMind/.env.lawmind`——**在工作区之外**，所以不会被打包/同步。

## 63.12 后台守护进程：为什么是两层

`lawmind-daemon-supervisor.ts` 的头注释解释了整个结构：

```text
背景：桌面关窗后，`lawmindd` 是唯一还在替律师办件的进程。它此前是一发即弃的
（spawn 时 `stdio: "ignore"` + `unref()`），崩了没人拉起，也没人知道。

结构：**监督进程持有 pid 文件与单实例锁，子进程跑 tick 循环。**
之所以要两层的代价，是为了拿到「子进程怎么死都能重启」——包括 SIGKILL / OOM
这种进程自己没机会反应的死法。若把重启逻辑写在 tick 进程内，它自己被杀就一起没了。
```

**这是一段很清楚的「为什么要多一层」的推理**：

- 问题：守护进程崩了没人拉起。
- 朴素方案（在 tick 进程内写重启逻辑）：**它自己被 SIGKILL 就一起没了**。
- 所以：多一个持有锁与 pid 的监督层。

**「包括 SIGKILL / OOM 这种进程自己没机会反应的死法」**——这句是重点。**只有外部进程才能观察到这种死。**

### 重启策略的四个数

常量在引擎侧（`src/lawmind/platform/lawmind-daemon-supervision.ts`）：

```text
baseDelayMs: 500     factor: 2     maxDelayMs: 30000     maxAttempts: 5
```

退避公式：`delay = min(30000, 500 × 2^(attempt-1))`。所以是 500ms → 1s → 2s → 4s → 8s。

超过 5 次就放弃，原因字符串是：

```text
restart_limit_reached:<已尝试次数>
```

而放弃时的日志写明了后果：

```text
连续失败 5 次后停止重试：这段时间的自动办件没有运行。
```

**「这段时间的自动办件没有运行」**——它把技术状态翻成业务后果。

### 四种退出分类

```text
clean       干净退出
crashed     崩溃
killed      被信号杀
stopped     主动停止
```

对应四种原因：`intentional_stop`、`clean_exit`、`killed_by_signal`、`crashed`。

### 子进程环境要剥掉七样东西

`buildSupervisorChildEnv` 先构造环境，然后**强制设 `LAWMIND_DAEMON=1` 并删掉 `LAWMIND_DAEMON_SUPERVISOR`**（避免子进程又去当监督者）。

而 `DAEMON_ENV_DENY` 剥掉七项：

```text
LAWMIND_LOCAL_API_TOKEN
LAWMIND_SKIP_API_AUTH
LAWMIND_DESKTOP_PORT
LAWMIND_LOCAL_API_INSTALLATION_SECRET
LAWMIND_LOCAL_API_EPOCH
LAWMIND_LOCAL_API_REVOKED_CLIENTS
LAWMIND_LOCAL_API_INSTANCE_ID
```

**七项全是「凭据与监听坐标」**。理由：daemon 模式**不起 HTTP 服务**（第 63.1 节第 ㉓ 步直接 return），所以它不需要令牌，也不该拿到。**这是最小权限的落点。**

而保留的是 `HOST_ENV_KEYS` / `LAWMIND_*` / `BRAVE_*`。

### 心跳陈旧线

守护进程存活探测在引擎侧（`src/lawmind/platform/lawmind-daemon.ts`）：

```text
isPidAlive(pid)      → process.kill(pid, 0)
DAEMON_HEARTBEAT_STALE_MS = DAEMON_TICK_INTERVAL_MS × 3 = 90000（90 秒）
```

**三倍容差**——允许连续两次 tick 丢失。而且 `isHeartbeatStale` 在「没有心跳记录」时返回**不陈旧**（初次启动不该被判死）。

## 63.13 体检载荷：十几个纯函数

`lawmind-health-payload.ts` 的头注释说明了它的性质：

```text
Doctor / health 扩展字段（纯函数，便于单测；由 lawmind-local-server 组装进 /api/health）。
```

**「纯函数，便于单测」**——所以这个文件全是 `build*` 函数，不碰网络、不读环境以外的东西。

### 它导出什么

| 函数                                                                                      | 干什么                                                     |
| ----------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `buildRuntimeCapabilityFlags`                                                             | 能力开关（检索模式、起草大模型启用/生效）                  |
| `buildAuthorityCorpusHealthSummary`                                                       | 法源语料就绪度                                             |
| `buildCompanyRegistryHealthSummary`                                                       | 工商源配置（`envKey` 固定 `LAWMIND_COMPANY_REGISTRY_URL`） |
| `buildReasoningGraphCoverage`                                                             | 推理图覆盖                                                 |
| `buildJudgmentHardControlsReport`                                                         | 判定硬控制                                                 |
| `buildDoctorStats`                                                                        | 主统计块                                                   |
| `buildMemoryTruthSourceFlags`                                                             | 记忆真相源文件存在性                                       |
| `buildWorkspaceStandardReport`                                                            | 工作区规范检查                                             |
| `buildP2DoctorReport`                                                                     | P2 期体检项                                                |
| `buildMatterConsistencySummary`                                                           | 案件一致性                                                 |
| `buildTaskDraftConsistencySummary`                                                        | 任务-草稿一致性                                            |
| `buildMultitaskObservabilitySummary`                                                      | 多任务可观测                                               |
| `countAuditJsonlFiles` / `countResearchSnapshots` / `countClientProfileFilesUnderClients` | 三个计数器                                                 |

### 三个关键数字与细节

**① `MATTER_CONSISTENCY_HEALTH_LIMIT = 12`**——案件一致性问题的列表只报前 12 条。**体检不是完整报告，是信号。**

**② `buildMultitaskObservabilitySummary(workspaceDir, windowDays = 14)`**，且 `notes.slice(0, 4)`。**默认两周窗口、最多四条结论。**

**③ 那条会话完整性的提示写得很好**（原文）：

```text
<N> 个会话的工具调用配对损坏（<M> 条孤立结果 / <K> 个悬空调用）；下一轮会自动修复，
也可运行 pnpm lawmind:doctor --fix。
```

**三段结构**：现象（几个坏）、影响（孤立结果/悬空调用各几条）、**两条出路**（自动修复 / 手动命令）。

### 那份「工作区规范检查」的文案

四条建议语（原文）：

```text
已就绪
建议保留通用记忆文件作为长期规则。
可在首跑向导中生成律师偏好文件。
可选：添加工作区策略文件。
建议添加 lawmind/workflows/*.json（仓库已含示例）。
建议准备 templates/word/ 以便渲染 docx。
```

**注意「已就绪」与「建议…」是同一组的两种结果**。而每条建议都指向**一个具体动作**（生成偏好文件 / 加策略文件 / 加工作流 / 准备模板）——不是「缺少某项配置」这种无信息的话。

### 策略文件的探测有两条路

```text
先探 lawmind/policy.json，再探 lawmind.policy.json
```

**两个路径都认**——因为历史上有过两个位置。

## 63.14 SSE 总线：15 秒心跳与 64 条重放

`lawmind-sse-bus.ts` 的头注释列了四条约束：

```text
设计约束：
- 单连接广播，客户端通过 query/header 声明订阅的事件类型（支持 `task:*` 通配）。
- 原生 `res.writeHead` + `text/event-stream` 实现，不依赖第三方库。
- 心跳 15 秒，写失败时自动关闭并清理。
- 测试可注入自定义 EventEmitter 作为事件源。
```

**「不依赖第三方库」**——这是这个仓库的一贯偏好（第 57 章也见过）。

### 帧格式与三个头

```text
id: <eventId>
event: <type>
data: <json>

```

心跳帧是注释行：`: heartbeat\n\n`。三个头：

```text
content-type: text/event-stream; charset=utf-8
cache-control: no-cache, no-transform
connection: keep-alive
```

### 两个常量与一个上限

| 常量                       | 值    |
| -------------------------- | ----- |
| `LAWMIND_SSE_HEARTBEAT_MS` | 15000 |
| `SSE_REPLAY_LIMIT`         | 64    |

**重放 64 条**——配合 `Last-Event-ID` 机制（第 63.14 节），断线重连时能补上最近的事件。

### 通配符的实现

```text
订阅默认 ["*"]
支持 `task:*`，也支持 `task:*:update`
实现：把 * 换成 [^:]* 再做正则匹配
```

**注意 `[^:]*` 而不是 `.*`**——所以 `task:*` 只能匹配一层（`task:update`），跨冒号的用 `task:*:update`。**这个细节决定了通配的粒度。**

### 客户端 id

```text
lm-<8 字节随机 hex>
```

前缀 `lm-` 便于在日志里认出来。

## 63.15 两个路径段校验

这两个文件都很小，但它们是**所有带 `:id` 的路由的第一道关**。

### `safe-task-id.ts`

```text
- 非空
- 长度 ≤ 200
- 不含 ".." / "/" / "\"
- 必须匹配 /^[a-zA-Z0-9._-]+$/
```

**四条规则一起用**。注释写明了它的用途：`Validates a single path segment used as task id in /api/tasks/:id and /api/drafts/:id.`

**为什么要有它**：因为 `taskId` 会被拼进文件路径（`drafts/<taskId>.json`）。所以它必须是一个**安全的单段路径**。

### `safe-assistant-id.ts`

只有一条：

```text
INVALID_ASSISTANT_ID = /[./\\]/
→ 合法当且仅当 trim 后非空且不含 . / \
```

**它比 task id 更严**（禁掉了 `.`）。因为助手 id 会出现在多个文件路径里。

**注意它允许空格之类的字符**（只禁三个）——而 task id 是白名单式的。两个文件的严格程度不同，这是有意的取舍。

## 63.16 Word 插件取件：四条安全线

`lawmind-server-word-addin-runner.ts` 的头注释列了四条：

```text
四条安全线：
- 只跑 `autoRunEnabled`（edition `wordAddinAutoRun` / policy）开启时；关闭即退回原人工档，行为逐字不变。
- 串行：一次只领一条，避免两条请求争同一个 draft。
- 过期不跑：取件时比对内容指纹，文件已改动就转 `stale`，不用旧基线出稿。
- 案卷不猜：对不唯一就转 `needs_matter`，让律师在 Word 窗格里选。
```

**四条各防一件具体的事**：

| 线       | 防什么                                   |
| -------- | ---------------------------------------- |
| 开关     | 未开启时行为**逐字不变**（不是"差不多"） |
| 串行     | 两条请求争同一个 draft                   |
| 指纹     | 用旧基线出稿                             |
| 不猜案卷 | 猜错案件（比不办更糟）                   |

### 孤儿线：30 分钟

```text
WORD_ADDIN_RUN_ORPHAN_MS = 30 * 60 * 1000
```

`reconcileStalledWordAddinRuns` 会把卡住的运行收尾，四种原因：

```text
run_interrupted        运行被打断
job_record_missing     找不到作业记录
completed_without_result  完了但没有结果
job_<状态>             作业处于某个状态
```

而给律师的文案是**能照做的**（三条原文）：

```text
桌面端在启动这次审查时中断了（可能重启过）。请重新点「审这份」。
找不到这次的审查任务记录（可能已被清理）。请重新点「审这份」。
桌面端这一轮结束了，但没有可回填的 Word 修订轨。常见原因：模型调用失败（如 API Key 失效）、
降级导出、或本轮没有需要落改的锚点。请到桌面端看这次审查的结果。
```

**第三条列了三种常见原因**——因为「没有可回填的修订轨」这个结果有多个可能的原因，律师需要知道去看什么。

### `humanizeWordAddinJobError` 的六个映射

```text
interrupted_by_restart     → 桌面端中途重启过，这次审查被中断
cancelled_by_user          → 你取消了这次审查
workflow_cancelled         → 这次审查被取消
missing_workflow_snapshot  → 任务记录不完整（缺少流程定义），请重试
source_file_missing        → 源文件已被移动或删除
enqueue_unavailable        → 桌面端尚未就绪（模型或工作流入队不可用）
```

**这张表就是第 60 章那些机器码与第 63.6 节那个 `interrupted_by_restart` 的中文对照**——它就是给人看的那一层。

### 取件的十一二步

```text
① reconcileStalledWordAddinRuns
② 开关关着 → 只返回 reconcile 结果
③ 挑最旧的 queued（排除已被取代的）
④ 源文件不在 → failed / source_file_missing
⑤ 解析案件；不唯一就准备候选
⑥ 算文件指纹
⑦ 需要本机目录授权就给（needsHostDirGrant）
⑧ claimWordAddinReviewForRun
⑨ 取代同源的其他请求（supersedeSibling...）
⑩ 建工作流 / 指令
⑪ enqueue → jobId
⑫ 把 jobId 写回请求记录
```

**第 ⑨ 步「取代同源的其他请求」**：同一个 Word 文件被点了两次「审这份」，后一次会取代前一次。**避免两条请求对同一份文件各出一稿。**

## 63.17 主路由注册表与两个上下文类型

`lawmind-server-route-types.ts` 只有两个类型，但它们是全部路由的签名基础：

```ts
LawmindDispatchContext = {
  workspaceDir, envFile, userEnvPath, policy, sseBus?
}

LawmindRouteContext = {
  ctx, req, res, url, pathname, c, clientId?
}
```

**`c` 就是 CORS 头**——那个必须展开进去的东西（`...c`）。所以每条路由都拿着它。

`clientId` 的注释列了五种身份：`desktop` / `renderer` / `word-addin` / `cli` / `shared`。

### 那个「只声明真正用到的字段」的教训

`route-chat.ts` 里有一段注释（第 64 章会再引），讲的是类型声明的一个坑：

```text
参数类型只声明它**真正用到**的四个字段：这个子处理器不读 `url` / `pathname`
（路由匹配在父处理器里做完了）。此前写成整个 `LawmindRouteContext`，
而父处理器的调用点没传这两个字段 —— 类型上不成立，运行时无害，
结果是一个**假错误**掩盖了真问题（长此以往「这条链真的没接线」也会被当成噪声）。
```

**「假错误掩盖真问题」**——这是一个教训：**类型声明过宽会制造假错误，而假错误会让真错误淹没在噪声里。**

## 63.18 那张「被引用但不在骨架里」的表

骨架层有不少东西是**声明了但实现不在这个文件**的。列出来省得找错地方：

| 你可能会找的                                 | 实际在哪                                                                   |
| -------------------------------------------- | -------------------------------------------------------------------------- |
| `HealthPayload` 类型                         | `apps/lawmind-desktop/src/renderer/lawmind-app-data.ts`（渲染层）          |
| 端口列表 / 握手文件                          | **不存在**；端口只走 `LAWMIND_DESKTOP_PORT`                                |
| `/api/doctor` 或 `/api/repair`               | **不存在**；doctor 数据在 `GET /api/health` 里                             |
| `sendError` / `withWorkspace` / `parseQuery` | **不存在**；分别是 `sendJsonError`、`parseQueryTimeMs`、`normalizeRelPath` |
| 作业并发上限常量                             | **不存在**                                                                 |
| 会话 CRUD                                    | `route-records.ts`（不是 `route-sessions.ts`）                             |
| 红线（baseline/generate/resolve）            | `route-redline.ts`（不是 `route-review.ts`）                               |
| 审查专案组                                   | `route-review-campaign.ts`                                                 |
| 本机授权端点                                 | **不在** `route-host-access.ts`（它在引擎的 access-broker）                |
| 工作台 rever 端点                            | **没有 HTTP 路由**（`revertDeskWrite` 未被任何路由调用）                   |

**最后一条要特别记住**：`revert_desk_write` 是**模型能调的工具**（第 61.2 节），但它**没有对应的 HTTP 端点**——界面上没有「撤销刚才那次写入」的按钮。`writeId` 会出现在两个端点的响应里（`/api/desk/events/confirm` 与 `.../intake-brief/confirm`），所以模型能拿到它并调工具撤销。

## 63.19 已知坑（本章相关）

- **端口只走环境变量**：没有端口列表、没有递增、没有握手文件。
- **IPv4 监听没有 error 监听**（EADDRINUSE 会走到 uncaughtException）；IPv6 有，且失败不致命。
- **桌面模式没有 dispose / close**：进程生命周期归 Electron。
- **路由表「先匹配先赢」**，顺序有语义，不要随便调。
- **六道关的响应里 `error` 与 `code` 有时不同**；客户端只该依赖 `code`。
- **429 那个响应没有 `code` 字段**（与其他六道关不一致）。
- **`...c` 漏写会导致「界面报连不上、服务端其实 200」**——有结构守卫测试盯着。
- **发现端点免 bearer，因为它不含秘密**；但仍过回环 Host 校验。
- **`LAWMIND_SKIP_API_AUTH` 在打包版被忽略**。
- **空 Host 头只在非打包版被允许。**
- **令牌桶是全局单例**，不按客户端也不按 IP。
- **公开作业字段用 `Omit` 白名单**——新增字段默认不外露。
- **作业幂等键只在非终态复用。**
- **重启后 `queued`/`running` 标成 `interrupted_by_restart`；`scheduled` 保留。**
- **作业没有并发上限**（串行只在 Word 插件那条链）。
- **`uncaughtException` 退出、`unhandledRejection` 不退出**，但两者都进 `degraded`。
- **所以超时 promise 的拒绝必须被吞掉**（否则 `degraded` 会亮）。
- **用户 `.env.lawmind` 在工作区的父目录**（不在工作区内）。
- **守护进程子进程被剥掉七项凭据类环境变量**（daemon 不起 HTTP，不需要）。
- **心跳陈旧线是 tick 间隔的三倍（90 秒）。**
- **SSE 通配 `*` 只匹配一层**（`[^:]*`），跨层要写 `task:*:update`。
- **`taskId` 是白名单校验（四个字符类），`assistantId` 是黑名单（只禁三个字符）**——严格程度不同。
- **zod 的 `issue.path` 可能含 symbol**，`join` 会抛；必须逐个 `String()`。
- **那个「声明比现实窄，正好掩盖边界」的观察**：类型写错不报错，只会让运行时炸在别处。
- **`revertDeskWrite` 没有 HTTP 端点**——只有模型工具能撤销写入。
- **`maxTokens <= 4096` 与 `temperature === 0.3` 会被当作「没填」。**
- **体检里的问题列表只报前 12 条**（`MATTER_CONSISTENCY_HEALTH_LIMIT`）。
