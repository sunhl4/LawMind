# 第 65 章 实现精读：其余路由（五十四文件）

第 64 章讲了主链路的十个文件（101 条路由）。这一章讲**其余 54 个文件**。

这些文件的特点是「一个文件管一个功能面」。所以这一章按**功能集群**分组，每个集群先说它解决什么问题，再列路由，再挑值得记的判定逻辑。

先给一张总表，看每个集群有多少条路由：

| 集群             | 文件                                                                                                                                                              | 大致路由数 |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| A 健康与诊断     | health / daemon / metrics / support                                                                                                                               | 12         |
| B 本机与文件     | host-access / fs                                                                                                                                                  | 6          |
| C Word 插件      | word-addin                                                                                                                                                        | 9          |
| D 自动办件与邮件 | automations / mail                                                                                                                                                | 20         |
| E 协作与专案组   | collaboration / agent-fleet / review-campaign / routing                                                                                                           | 20         |
| F 案件副本与云   | matter-replica / matter-cloud                                                                                                                                     | 19 + 通配  |
| G 学习与记忆     | learning-contract / contract-review / memory-adoption / memory-preview / memory-templates / historical-scan / redline                                             | 20         |
| H 判定与审计     | judgment / audit-event / audit-export                                                                                                                             | 7          |
| I 审批与设置     | approvals / action-summary / desk-settings / integrations / e2e / jobs / assistants / templates                                                                   | 27         |
| J 其余单点       | registry / types / tools-registry / platform / license / models / mcp / onboarding / practice-playbook / roles / search / skills / sources / sse / triage / works | 45         |

## 65.1 A 集群：健康与诊断

### `route-health.ts`：一个巨大快照 + 一个探测

| 方法 | 路径                   | 说明     |
| ---- | ---------------------- | -------- |
| GET  | `/api/health`          | 全量体检 |
| POST | `/api/authority/probe` | 法源探测 |

**它没有头注释**——直接从 import 开始。这在服务端文件里是少数（多数有头注释）。

而**没有 `/api/doctor` 也没有 `/api/repair`**：doctor 数据是 `/api/health` 里的一个 `doctor` 字段（由 `lawmind-health-payload.ts` 组装）。

法源探测的五种结果：

| 情况     | 码                            | 文案                                                             |
| -------- | ----------------------------- | ---------------------------------------------------------------- |
| 开源语料 | `authority_open_corpus_unset` | `开源语料未就绪。`                                               |
| 同上成功 | —                             | `开源语料本地探测通过（非厂商付费库）。`                         |
| 未实现   | 501                           | `权威适配器尚未实现（status=unimplemented）；探测 fail-closed。` |
| 未配置   | `authority_endpoint_unset`    | `未配置 LAWMIND_AUTHORITY_ENDPOINT，无法探测。`                  |
| 配置无效 | `authority_endpoint_invalid`  | `权威端点配置无效（fail-closed）。`                              |

**两条都写了 `fail-closed`**——探测失败就是「不通过」，不会因为「拿不到结果」而放行。

而那句 `非厂商付费库` 是在**主动划清能力边界**：开源语料不等于付费库。

### `route-daemon.ts`：三件事与一句提醒

```text
GET  /api/daemon/log    ?lines= 夹在 [1, 500]，默认 200
GET  /api/daemon        状态
POST /api/daemon        四个动作：enable / disable / start / stop
```

**「spawn 留在桌面服务进程内」**是它的设计约束（注释：`Spawn stays in-process of the desktop server.`）。

而那句提醒很好：

```text
桌面开着时由本窗口办件。关掉 LawMind 后才会在这台电脑上继续。
```

**它解释了「为什么现在不跑」**——律师点「启用后台」可能期待立刻跑，但桌面开着时是窗口自己在跑。

### `route-metrics.ts`：六个仪表盘

```text
GET  /api/metrics/north-star          无干预 / 一次通过 / lint 逃逸
GET  /api/metrics/north-star-trend
GET  /api/metrics/context-pressure    整理 / 退让 / 承前分叉
GET  /api/metrics/team-growth         内测指标表
POST /api/metrics/team-growth/baseline 冻结当前窗口为基线
GET  /api/metrics/lawyer-dashboard
```

窗口参数统一：默认 30 天，夹在 `[1, 365]`。而基线那条的 `note` 上限 500 字。

**`context-pressure` 里那句「缺来源 → present:false」**（在头注释里）是个诚实设计：**没有数据就不假装有数据**（第 12 章那条诚实 null）。

### `route-support.ts`：诊断包的三条自我约束

它的头注释把自我约束写清了：

```text
导出前律师须确认（前端按钮走确认对话框）；本路由本身只做脱敏与打包，
不读取案件正文，不读取 `.env*`，不读取许可激活码。
```

**三条「不读」**：案件正文、env 文件、激活码。

而预览的提示（原文）：

```text
本包已脱敏：不含 API Key、邮件密钥、许可激活码与案件正文。下载请加 ?download=1。
```

**它把「不含什么」列出来**——这比「已脱敏」有信息量得多。

两条路由：`GET /api/support/bundle`（预览）与 `?download=1`（下载）。**同一个路径用查询参数区分**——所以预览不需要单独的路径。

## 65.2 B 集群：本机与文件

### `route-host-access.ts`：四条路由，都跟「策略」有关

| 方法 | 路径                               | 说明                                       |
| ---- | ---------------------------------- | ------------------------------------------ |
| GET  | `/api/host-access`                 | 策略 + 挂载列表（`sessionId: "settings"`） |
| GET  | `/api/host-access/log`             | 访问日志（limit 夹在 [1, 200]，默认 50）   |
| POST | `/api/host-access/index/rebuild`   | 重建本机索引                               |
| POST | `/api/host-access/session-command` | 允许本会话命令（`?sessionId=`）            |

**注意它没有授权端点、没有搜索/读取/收进端点。**

第 61.4 节讲的那套「授权舞步」（`grant_duration`、三种时长、`hit_id`）**服务于模型工具**，实现全在引擎的 `host-access/access-broker.ts`。界面这边只有「看策略、看日志、重建索引、允许命令」四件事。

**`sessionId: "settings"` 那个字面量**说明这条路由是给设置页用的——所以它不需要真会话 id。

### `route-fs.ts`：四条路由与五条路径围栏

| 方法 | 路径            | 围栏                                     |
| ---- | --------------- | ---------------------------------------- |
| GET  | `/api/artifact` | `safeArtifactPath`（只放 artifacts）     |
| GET  | `/api/fs/tree`  | `resolveFsPath(..., { access: "read" })` |
| GET  | `/api/fs/read`  | 同上 + `MAX_TEXT_READ_BYTES`             |
| POST | `/api/fs/write` | `access: "write"` + 三道路径检查         |

**七条拒绝**：

```text
404 not found                          路径不存在
400 path is not directory              树期望目录
400 path is not file                   读期望文件
413 file too large                     >1 MB
415 binary file is not supported       二进制
403 root_not_writable                  根不可写
403 protected_workspace_path           治理路径
409 file was modified externally       外部改动（带 mtimeMs）
```

**最后那条 409 是并发保护**：带上 `mtimeMs` 让客户端能判断「我读的时候是什么版本」。

而不可写的两种文案：

```text
本机文件夹默认不能改写。请使用「收进本案」复制到案件目录。   ← MOUNT_WRITE_REFUSAL
不可写的根：<rootKey>                                     ← 其他
```

治理路径的错码与文案（原文）：

```text
code:  "protected_workspace_path"
error: "该路径属于 LawMind 治理/审计数据（策略、MCP 配置、审计、会话、任务、案件真相源），
       不能通过写文书或文件接口修改；请使用对应的设置入口。"
```

而受保护名单是三个集合：

```text
EXACT_PROTECTED_RELS  = [lawmind.policy.json, .env, .env.lawmind]
PROTECTED_REL_PREFIXES = [lawmind/, audit/, sessions/, tasks/, matters/]
PROTECTED_BASENAMES    = [.lawmind-dms.json, RULES.md, ethics-wall.json]
```

**三类：精确路径、前缀、文件名**。最后一类（`RULES.md`、`ethics-wall.json`）是「不管在哪个目录都不许改」的那种。

### 唯一的写操作会发 SSE

```text
type: "fs:change", data: { root, rel, mtimeMs, size }
```

**所以文件被改后，其他界面能立刻知道**（文件工作台与对话的钉选都订阅它）。

## 65.3 C 集群：Word 插件

`route-word-addin.ts` 的头注释是一份完整的端点清单：

```text
- GET  /word-addin/manifest.xml          侧载清单（{{BASE}} 按本次请求的实际回环地址替换）
- GET  /word-addin/taskpane.html|.js|.css 任务窗格静态资源
- GET  /word-addin/icon-32.png           清单图标
- GET  /api/word-addin/reviews           就地审查请求列表（?state=&since=）
- POST /api/word-addin/reviews           { path, matterId?, instruction? } 建请求（审这份）
- GET  /api/word-addin/reviews/:id       单条状态（插件轮询）
- POST /api/word-addin/reviews/:id/result  桌面端回填：{ task_id } 或 { outputPath, hunks, ... }
- POST /api/word-addin/reviews/:id/export  导出：返回产物路径与存在性
```

**三条自我说明值得单独记**：

```text
静态资源不带 bearer（Word 取页面时还没有令牌），但仍在回环 Host 校验之后；
令牌只注入到发给回环地址的页面里。所有数据面都在 /api/word-addin/*，走统一鉴权。
```

**「静态资源免 bearer，但数据面走统一鉴权」**——这是第 63.2 节第 ⑥ 步那个豁免的完整理由。

而 `{{BASE}}` 那个替换是**按本次请求的实际回环地址**——所以同一份 manifest 模板在 `127.0.0.1` 与 `localhost` 下都能用。

### 七个审查状态

```text
queued  running  ready  failed  needs_matter  stale  superseded
```

**四个是非常规状态**（`needs_matter` / `stale` / `superseded` / `failed`），它们各自对应一个真实场景：

| 状态           | 含义                                    |
| -------------- | --------------------------------------- |
| `needs_matter` | 案件对不唯一（第 63.16 节那条「不猜」） |
| `stale`        | 文件已改动（指纹对不上）                |
| `superseded`   | 被同源的新请求取代                      |
| `failed`       | 失败                                    |

**「七个状态里有四个是异常态」**说明这个功能把「出错时怎么办」当作主要设计内容。

### 六条拒绝

```text
405 method_not_allowed
503 word_addin_assets_missing  + hint：未找到 Word 插件资源目录（<相对路径>）。
                                   开发态请确认仓库完整；打包版请确认 extraResources 已含 word-addin。
400 asset_not_found / unsupported_asset_type / invalid_json / unknown_matter
404 not_found
409 not_awaiting_matter:<当前状态>
400 redline_proposal_not_found
```

**`not_awaiting_matter:<状态>` 这个格式很有用**——把当前状态拼在错误码里，所以界面能显示「当前是 running，不能再选案件」。

而 `503` 那条的 hint **分了开发态与打包版两种情况**——因为「资源目录找不到」在这两种情况下的原因完全不同。

### 导出时的两条提示

```text
桌面端登记的产物路径当前不存在（可能被移动或重命名）。
桌面端尚未产出修订稿；请先在桌面端完成这次审查。
```

**第一条是「文件没了」，第二条是「还没生成」**——两种不同情况给不同提示。

### 静态资源的两个头

```text
cache-control: "no-store"      ← 全部静态资源
内容类型：image/png、text/javascript; charset=utf-8
```

**`no-store`**：因为插件在开发期会反复更新，缓存会导致「改了没生效」。

## 65.4 D 集群：自动办件与邮件

### `route-automations.ts`：二十条路由与六个确认项

```text
GET    /api/automations/presets
GET    /api/automations/:id/runs      limit 夹在 [1, 100]，默认保留数
GET    /api/automations
POST   /api/automations               201
POST   /api/automations/from-instruction
POST   /api/automations/mail/seed     仅 LAWMIND_MAIL_SEED=1
GET    /api/automations/:id
PATCH  /api/automations/:id            ?runNow → nextRunAt = 1970-01-01
DELETE /api/automations/:id
POST   /api/automations/inbox/:id/action
```

**那一处 `?runNow` 的实现很有意思**：它把 `nextRunAt` 设成 `new Date(0).toISOString()`（1970 年）。**所以「立刻跑」不是特殊路径，而是「把下次时间设到很久以前」**——tick 一跑就认为是过期的。这是一个很省事的技巧。

### 五个预设与三组策略

```text
presetId: renewal-monitor / client-weekly-update / mail-inbox-digest
        / mail-contract-review / custom
```

三组策略枚举：

| 字段                | 值                                               |
| ------------------- | ------------------------------------------------ |
| `missingDataPolicy` | `report_failure` / `report_partial` / `skip_run` |
| `notifyPolicy`      | `always` / `on_problem` / `never`                |
| `schedule.kind`     | `daily` / `weekly` / `once` / `interval`         |

**`missingDataPolicy` 的三个值就是第 17.1 节讲的「缺资料策略」**：报失败 / 报部分 / 跳过不跑。

`interval` 的频率下限是 5 分钟，上限是 7×24×60（一周的分钟数）。

### 那六个确认项的门

```text
automation_confirmations_missing + { missing }
```

**「仅显式创建时」才检查**（注释说得很明确）。所以从指令推导出来时（`/from-instruction`）不拦——因为那时律师还没走到确认那一步。

### 邮件播种的默认值

```text
from: "对方 <counterparty@example.com>"
to:   "lawyer@example.com"
id:   seed-<时间戳>
```

**注意 `from` 是「对方」**——所以播进来的是一封「来信」，不是「发信」。这才符合「收件箱」的语义。

### 收件箱动作的四个结果状态

```text
sent_remote         远程发送成功
approved_local_only 本地归档，远程没成功
dismissed           忽略
acknowledged        已知悉
```

**`approved_local_only` 这个状态是为一个很实际的情况准备的**——律师点了「批准发送」，但远程发信失败了。所以不能简单报「失败」，那样律师会以为白批了。

两句提示把这件事说清了：

```text
已批准并通过 <方式> 发送（归档 sent/<id>）。
已批准并写入本地 sent/<id>；远程发信未成功：<原因>。请检查「交办 → 邮箱配置」。
```

**第二条指明了去哪查**。

### `route-mail.ts`：邮件配置与伦理墙

```text
GET  /api/ethics-wall               ?matterId=
POST /api/ethics-wall/acknowledge   { matterId }
GET  /api/mail/providers
GET  /api/mail/matters/:matterId/attachments
GET  /api/mail/accounts
POST /api/mail/accounts
DELETE /api/mail/accounts/:id
POST /api/mail/accounts/:id/test
POST /api/mail/accounts/:id/sync
```

**六个邮箱服务商**：

```text
gmail  outlook  microsoft365  qq  163  imap
```

**三种登录方式**：

```text
password  应用密码（中文界面叫「应用密码」）
graph_client  Graph 客户端
```

**四条按错误类型的 hint**（很实用的一张表）：

| 错误                           | hint                                    |
| ------------------------------ | --------------------------------------- |
| `invalid_email`                | `请填写有效邮箱地址。`                  |
| `unsupported_auth_kind`        | `该邮箱类型不支持所选登录方式。`        |
| `imap_host_required`           | `自定义 IMAP 需填写主机。`              |
| `graph_tenant_client_required` | `Graph 方式需填写租户 ID 与客户端 ID。` |

**四个错误四种动作**——不是一句「配置无效」。

别的上限：`watchContacts` 最多 40 个、`syncSchema.limit` 1..50、端口 1..65535、`closingStyle` 五种（`none`/`formal`/`business`/`reply`/`custom`）。

**测试失败返回 200**（不是 4xx）：

```text
{ ok: false, error, hint, account }
```

**理由**：测试失败是「预期内的业务结果」，不是「请求有问题」。而且 HTTP 200 能让界面统一处理响应体。

## 65.5 E 集群：协作与专案组

### `route-collaboration.ts`：十一条路由 + 异步分支

```text
GET  /api/collaboration/summary
GET  /api/delegations/follow-up
GET  /api/delegations/session-progress
POST /api/delegations
GET  /api/delegations
GET  /api/delegations/:id
DELETE /api/delegations/:id         同时 requestTurnAbort
GET  /api/collaboration/workflow-templates
POST /api/collaboration/workflow-run  同步或异步
GET  /api/collaboration-events
```

**异步分支在同一文件里**：

```text
body.async === true → enqueueWorkflowRun(...) → 202 { ok, jobId, async: true, gateHint? }
```

**202 是「已接受但还没做完」的标准码**——用得对。

### 几处裁剪

| 端点                     | 裁剪                            |
| ------------------------ | ------------------------------- |
| `/collaboration/summary` | 事件 -40 条、委派 -20 条        |
| `/delegations/follow-up` | 结果 24000 字符、任务 500 字符  |
| `/delegations`           | 最多 100 条；任务 200、结果 300 |
| `/collaboration-events`  | -200 条                         |

**「结果 24000 字符」与「结果 300 字符」是同一个字段的两种裁剪**——详情页给长版，列表给短版。

### 两条「不猜」的提示

```text
本流程完成后需律师验收：对外发出前请在文书台审稿通过。
本工作流建议绑定来源：<来源列表>。
```

**第二条是「建议绑定来源」**——来自模板的 `requiredSources`（第 60.3 节）。所以启动工作流时会提醒「这个流程需要哪些材料」。

### 协作关着时的两条文案

```text
多助手协作已关闭，无法创建委派。                                 ← 503
多助手协作已关闭（LAWMIND_ENABLE_COLLABORATION=false），无法运行团队工作流。  ← 503
```

**第二条把环境变量名也写进文案**——因为这是给配置的人看的。

而 summary 的两条提示说明了当前状态：

```text
协作已开启：委派与事件会写入内存注册表与 workspace 审计（若存在）。
协作已关闭（LAWMIND_ENABLE_COLLABORATION=false）：不会注册多助手委派。
```

**「（若存在）」这个限定词**——因为审计文件可能还没建。

### `route-agent-fleet.ts`：在办的四条

```text
GET /api/agent-fleet                ?matterId=&windowDays=（作业最多 40）
GET /api/assistants/growth          ?windowDays=
GET /api/agent-presets
GET /api/sessions/:id/fleet-transcript  消息 -24 条，每条 2000 字符
```

**`fleet-transcript` 是「在办里看了一眼某个会话的最近 24 条」**——所以不用跳去对话页也能看到上下文。

### `route-review-campaign.ts`：专案组八条

```text
GET  /api/fleet-playbooks
GET  /api/fleet-playbooks/:id
GET  /api/review-campaigns            需要 ?taskId=
POST /api/review-campaigns
GET  /api/review-campaigns/:id
POST /api/review-campaigns/:id/cancel
POST /api/review-campaigns/:id/roles/:role/rerun
GET  /api/review-campaigns/:id/report   Markdown
```

**报告是 Markdown 直接返回**——所以界面能直接渲染或下载。

两条审计：`review_campaign.created`、`review_campaign.role_rerun`。一条产品指标：

```text
kind: "first_pass", detail: `campaign:<playbookId>:<评分>`
```

**「一次通过」指标把专案组也算进去了**——所以专案组的产出也进那个核心指标。

### `route-routing.ts`：三条

```text
GET /api/routing/defaults
PUT /api/routing/defaults
POST /api/routing/resolve
```

**写入形状很精简**：

```text
version: 1
assigneeRef: { roleId?, assistantId? }     ← 二选一
forcePeerReview: boolean | null
```

**`forcePeerReview` 可以是 null**——所以有三个值（强制/不强制/未指定）。**null 与 false 不是一回事**。

## 65.6 F 集群：案件副本与云

### `route-matter-replica.ts`：十九条 + 一道版本门

头注释一句：

```text
Matter Replica HTTP routes — Firm-gated multi-lawyer matter collaboration.
```

**「Firm-gated」**是这个集群的核心：**独立律师版默认关闭**。

四个端点**不需要**过版本门（因为要看状态就得能问）：

```text
/status  /identity  /audit-report  /scheduler
```

其余十五条都要 `gate.enabled`，否则：

```text
403 案件成员协作未开启（独立律师版默认关闭；律所协作版可用）
+ { reason: gate.reason }
```

**`reason` 是分开给的**——所以界面能解释为什么关着（不只是「没开」）。

### 三条路径常量

```text
ops:      /v1/matters/:matterId/ops
manifest: /v1/matters/:matterId/materials/manifest
blobs:    /v1/matters/:matterId/blobs/:sha256
```

**`blobs/:sha256` 说明材料是内容寻址的**——同一份文件只存一次。

### 六种角色

```text
owner  lead  associate  paralegal  readonly  external
```

**`external` 是个独立角色**——外部协作方（第 16.9 节那个伦理墙场景）。

### 邀请码的形状与分享文案

```text
邀请码：LMC-<...>
分享文案：邀请你加入 LawMind 案件「<案件名>」。打开 LawMind → 案件 → 成员协作，粘贴邀请码：<码>
```

**分享文案给了完整的三步路径**——所以收到码的人知道去哪粘。

### 两处「失败但要报」的地方

```text
警告：成员已移除，但密钥轮换失败：<原因>
```

**「已移除但轮换失败」是一个危险状态**——因为那个成员理论上还能解密。所以它单独报警告而不是静默。

而 `keyRotated` / `rotationSkipped` / `wrappedFor` 三个响应字段就是为这件事准备的。

### 一条调度器未运行的 409

```text
自动同步调度器未运行
```

**这条只在 `/scheduler/tick` 上**——手动触发时需要调度器在场。

### `route-matter-cloud.ts`：一条通配 + 一道门

```text
匹配任何 pathname.startsWith("/v1/matters") → 交给引擎的 handleMatterCloudRequest
门关着 → 403 { ok: false, error: "matter cloud disabled" }
```

**「路径归引擎所有」**（注释原文）——所以这个文件只做挂载与门禁，具体端点不在这里。

而存储位置有三层回落：

```text
gate.sharedRelayDir → gate.cloudDataDir → defaultMatterCloudDataDir(workspaceDir)
```

## 65.7 G 集群：学习与记忆

### `route-memory-adoption.ts`：六个端点，一个前缀

头注释把「稍后再说」的性质又写了一遍：

```text
「稍后再说」仅前端会话内搁置，不写库。
```

**服务端也记着这件事**——所以这条路是明确不存在的。

| 方法 | 路径                                    | 说明                       |
| ---- | --------------------------------------- | -------------------------- |
| GET  | `/api/memory/adoption/:id/preview-diff` | 差异预览                   |
| GET  | `/api/memory/adoption`                  | 列表（多种筛选）           |
| POST | `/api/memory/adoption/suggest`          | 提交建议                   |
| POST | `/api/memory/adoption/adopt`            | 采纳（`{ id, note? }`）    |
| POST | `/api/memory/adoption/adopt-batch`      | 批量（`dryRun` 默认 true） |
| POST | `/api/memory/adoption/dismiss`          | 忽略                       |

**八种作用域**：`firm` / `lawyer` / `client` / `matter` / `playbook` / `opponent` / `project` / `assistant`。

**五种状态**：`pending` / `adopted` / `auto_adopted` / `dismissed` / `recorded_noop`。

### 那个 `learning:` 前缀

```text
LEARNING_ID_PREFIX = "learning:"
adopt 时：id 以 learning: 开头 → 走 adoptLearningSuggestion
dismiss 时同理
```

**两类建议（记忆建议 + 学习建议）共用一个端点**，靠 id 前缀分派。所以界面只调一个接口。

### 那个 `note` 的双重含义

```text
adopt 的 note：改写后写入时的落盘正文覆盖
但代码里：note: rewritten ? "rewritten" : body.note
```

**「改写」这个动作会把 note 变成字面量 `"rewritten"`**——这是一个标记，不是内容。所以「改写过的」在数据里能认出来。

### `route-memory-preview.ts`：一条只读 + 四个码

```text
GET /api/memory/source-text?path=MEMORY.md&maxChars=2000
maxChars 夹在 [200, 16000]，默认 4000
```

四个拒绝：`path_required` / `invalid_path` / `not_a_file` / `read_failed`。

**路径围栏是 `safeRelativePath`**——拒 `..` 开头与绝对路径。

### `route-memory-templates.ts`：三条，两个上限

```text
GET /api/templates/built-in
GET /api/memory/sources
GET /api/memory/adoptions     最多 40 条
```

而「认知升级建议」的过滤是：

```text
字符串 "认知升级建议：" + 正则 /^-\s+\[([^\]]+)\]\s+\[source:[^\]]+\]\s+(.+)$/
```

**它是从 `LAWYER_PROFILE.md` 的文本里解析出来的**——所以那些条目是**文本行**，不是结构化数据。这个正则定义了它们的格式。

### `route-historical-scan.ts`：四条，四个上限

```text
GET  /api/historical-scan
POST /api/historical-scan/roots           absPath ≤1024、label ≤120
POST /api/historical-scan/roots/remove    rootId ≤80
POST /api/historical-scan/run             rootIds 最多 3 个
```

**`rootIds` 最多 3 个**——一次最多扫三个根目录。而 `incremental` 布尔控制是增量还是全量。

### `route-redline.ts`：五条

```text
POST /api/drafts/:taskId/redline/resolve-all
POST /api/drafts/:taskId/redline/hunks/:hunkId/resolve
POST /api/drafts/:taskId/redline/baseline
POST /api/drafts/:taskId/redline/generate
GET  /api/drafts/:taskId/redline
```

**两条不需要请求体**（baseline 与 generate）——因为参数全在路径里。

错误映射：

```text
invalid_task_id / invalid_decision  → 400
redline_not_found / hunk_not_found  → 404
其他                                → 409
```

**「404 是找不到，409 是状态不对」**——这个分法很清晰。

而 `resolve` 接受时有一个副作用：`captureStanceAfterAccept`——**接受一处修订会捕获取向**（第 6.10 节的立场库）。

### `route-learning-contract.ts` 与 `route-contract-review.ts`

这两个文件是一对，管「合同修订积累」。

```text
GET  /api/learning/contract-revisions            最近修订包（limit 夹在 [1, 200]，默认 50）
POST /api/learning/contract-revision/finalize    落盘初始稿 + 定稿 + 关键修改点

GET  /api/learning/contract-review/drafts        待验收草稿（最多 40）
POST /api/learning/contract-review/drafts        存草稿
POST /api/learning/contract-review/drafts/accept 验收落库
```

**两条路径必需**（`initialPath` + `finalPath`），否则：

```text
请提供 initialPath 与 finalPath（相对工作区或工作区下的绝对路径）。
```

而验收失败时的码有分工：

```text
path_outside_workspace → 403
initial_not_found / final_not_found / invalid_matter_id / finalize_failed → 400
```

**路径越界是 403（不许），文件找不到是 400（请求有问题）**。

一条兜底文案值得记：

```text
（由验收草稿转入，未单独列要点）
```

**它明说了「这份没有要点，是从草稿转来的」**——而不是留空。

## 65.8 H 集群：判定与审计

### `route-judgment.ts`：四条与一条输出纪律

头注释是一段输出纪律：

```text
律师可见面只出现「什么项目、由谁判的、为什么需要您定夺」——
**`itemKey`/判定表键是内部 id，不出现在 API 的律师面字段里**（见 `ui-copy-lint` 禁词表）。
需要 id 的地方只在工程侧（`items[].key`，供后续 POST 回填），且客户端不得直接渲染。
```

**「内部 id 不出现在律师面字段里」**——而这条规则有 lint 脚本（`ui-copy-lint`）在管（第 18 章那六类机器门禁之一）。

**但工程侧仍要 id**（`items[].key`），所以它存在但「不得直接渲染」。**这条边界划分得很细。**

四条路由：

```text
GET /api/judgment/summary       全工作区汇总
GET /api/judgment/task          ?taskId= 单份
GET /api/judgment/escalations   待定夺列表（草稿最多 200）
GET /api/judgment/tiering       分档统计
```

而 `task` 的载荷里有几个字段值得记：

```text
escalationChannel: "off" | "on"
escalationPosture: "advisory" | "block"
counts: { total, machine, judged, decidedByLawyer, notCovered, unavailable }
coverageNote
```

**`counts` 的六个数把每一项都归了类**——机器判 / 已判 / 律师判过 / 未覆盖 / 不可用。**没有「正确率」**（第 68.15 节那条口径）。

而 `notCovered` / `unavailable` 是**两个独立数组**——所以「没覆盖到」与「数据没有」不混在一起。

### `route-audit-event.ts`：一条，五种枚举

```text
POST /api/audit/event
kind:  只允许 "outbound_http"
actor: 只允许 "system" | "lawyer" | "model"
taskId ≤128、actorId ≤256、detail ≤4000
```

**`kind` 只允许一个值**——因为这个端点存在的唯一目的是「渲染层的代理层把出网请求转成审计」。

而它的头注释说明了调用方：

```text
由 renderer 统一 API 客户端代理层在每次 fetch 后调用，
将 `outbound_http` 等事件转发给引擎侧审计接口（src/lawmind/audit）。
```

**「每次 fetch 后调用」**——所以所有出网请求都有审计（第 15.2 节那个统一出口的落点）。

### `route-audit-export.ts`：三条与一个签名开关

```text
GET  /api/audit/export            ?matterId=&taskId=&since=&until=&compliance=&integrity=&replay=
GET  /api/audit/export-summary    ?format=text|txt（否则 JSON）
POST /api/audit/verify-external   { externalAnchorUrl }
```

**六个查询参数**——所以导出能按案件/任务/时间窗过滤，还能切 compliance / integrity / replay 三种模式。

一条 403：

```text
audit_integrity_export_disabled
```

**「带完整性校验的导出」默认关**——因为它会把校验材料也导出去。

而 `export-summary` 支持 `text` 与 `txt` 两种写法（同一个意思）。

## 65.9 I 集群：审批与设置

### `route-approvals.ts`：两条与一个 24 小时

```text
GET  /api/approvals                   ?matterId=
POST /api/approvals/:id/(approve|reject)
```

**那一小时数是 `APPROVAL_TTL_MS = 24 × 60 × 60 × 1000`**——`expiresAt = createdAt + 24h`。

**24 小时的过期**意味着：**昨天的待批准项今天不该再点**（因为上下文已经变了）。

### 两种审批的合成 id

```text
<sessionId>:draft-review
<taskId>:task-confirmation
```

**两个后缀区分两种「派生审批」**——它们没有独立的审批记录，是从草稿状态与任务状态推出来的。

### 风险映射（服务端也做了一遍）

```text
send_email / prepare_outbound_mail               → high
apply_surgical_edits / write_document / update_draft / execute_workflow → medium
其他                                            → low
```

**五个工具的名字在服务端硬编码了**——所以「界面显示的风险等级」与「服务端算的风险等级」有两份实现（第 5.6 节讲过这个风险）。

### 那个 409 的文案

```text
409 approval_already_resolved
该审批已被处理，当前状态未变更。
```

**「当前状态未变更」**这句是必要的——它告诉调用方「你的动作没生效，但也没搞坏什么」。

而 `route-action-summary.ts` 里**同一个码同一个文案也出现了一次**（在 `POST /api/approvals/resolve`）——**两处实现**。

### `route-action-summary.ts`：那个「汇总」的十四个键

响应里有一大串计数（原文的键名）：

```text
total  pendingApprovals  openQueueItems  activeJobs  requiresDecisionTotal
pendingReviewCount  chatRequiresActionCount  pendingToolApprovals
pendingAutomationCount  recentReviewCompleted  recentDelegationCompleted
recentCollabCompleted
```

加五组列表：`approvals` / `queueItems` / `jobs` / `pendingReviewDrafts` / `toolApprovals` / `chatRequiresActions` / `automationInbox` / `wordAddinReviews`。

**十四个计数 + 八组列表**——一次调用装齐「侧栏那个红点该显示几」。

几处裁剪：

```text
approvals 20、queueItems 20、jobs 10、toolApprovals 20
chatRequiresActions 30、wordAddinReviews 20
协作完成窗口 COLLAB_COMPLETION_WINDOW_MS = 48 小时
```

**「协作完成 48 小时窗口」**——所以「最近完成的协作」是两天内的。

而一个面向律师的队列过滤：

```text
LAWYER_FACING_QUEUE_KINDS = new Set(["need_client_input"])
```

**只有「等客户提供材料」这一类才进律师可见队列**——其他几类是内部状态。

### `route-jobs.ts`：四条 + 一条手写 SSE

```text
GET  /api/jobs/:id/stream    手写 SSE
POST /api/jobs/:id/cancel
GET  /api/jobs               默认 limit 20
GET  /api/jobs/:id
```

**它的头注释在澄清一个容易搞混的事**：

```text
Job/automation SSE is `{ ok, job }` snapshots — not a second RunTurnEvent dialect.
Chat / resume / live-turn speak embed-turn-events.ts.
```

**「不是第二套回合事件方言」**——作业流发的是**快照**，对话流发的是**回合事件**。**两套协议，别混。**

而它的帧格式是 `data: {json}\n\n`（**没有 `event:` 行**），心跳 `: ping\n\n` 每 25000ms。**所以它和 SSE 总线是两套实现**（总线用 `id/event/data` 三行）。

### 七个作业状态短语

服务端把作业状态翻成执行态（`executionState`）：

```text
phase plan    + detail：已预约执行：<时间> / 已预约本地定时执行。/ 任务已入队，等待后台执行。
phase research + "工作流执行中。"
phase complete + "工作流已完成。"
phase error    + "工作流已取消。"
其他           + error ?? "工作流执行失败。"
```

**注意 `phase` 只有四个值，但 `detail` 有六种**——因为 `plan` 阶段有三种细节（预约了/排期了/入队了）。

而取消请求的 gate decision：

```text
reason: "已请求取消，等待当前步骤可中断点。"
```

**这句与第 63.6 节那个 `queued_abort` 是同一件事的两种表述**（一个给界面，一个给审计）。

### `route-assistants.ts`：七条

```text
GET    /api/assistant-presets
GET    /api/assistants
GET    /api/assistants/:id/profile-sections
POST   /api/assistants
POST   /api/assistants/:id/duplicate
PATCH  /api/assistants/:id
DELETE /api/assistants/:id
```

**一条特殊拒绝**：

```text
cannot delete default or unknown assistant
```

**「默认助手不能删」**——因为它是兜底（`DEFAULT_ASSISTANT_ID`）。

### `route-templates.ts`：七条与一条 id 格式

```text
GET    /api/templates              { builtIn, uploaded }
POST   /api/templates/scan         扫 .docx 占位符
POST   /api/templates/register
POST   /api/templates/enabled
DELETE /api/templates/uploaded     ?id=
GET    /api/templates/built-in
GET    /api/templates/uploaded
```

**上传模板的 id 必须匹配**：

```text
/^upload\/[a-z0-9][a-z0-9._-]{1,63}$/
错误：id must be like upload/firm-brief
```

**「id must be like upload/firm-brief」这句直接把一个合法例子给了**——比说「格式不对」有用。

九条拒绝里两条值得记：

```text
only .docx scan supported        扫描只支持 docx
format must be docx or pptx      登记支持两种
```

**「扫占位符只支持 docx，但登记支持 docx 与 pptx」**——这个不对称是因为「扫占位符」要解析 docx 内部结构，而「登记」只是存个记录。

### `route-integrations.ts`：两条只读

```text
GET /api/integrations
GET /api/integrations/:connectorId/documents?matterId=
```

**只接受 GET**（注释：`Only GET accepted.`）。

而错误到状态的映射很完整：

```text
matter_id_required / invalid_matter_id  → 400
matter_not_found                        → 404
connector_disabled / connector_unconfigured → 503
其他                                    → 400
```

**`503` 用于「连接器没配或没启用」**——那是服务端状态问题，不是请求问题。

### `route-e2e.ts`：两条，打包版一定关

```text
POST /api/e2e/create-draft
POST /api/e2e/crash                 审计一行后 50ms 退出进程
```

**门禁算法**（注释：`仅未打包进程且显式打开时启用。打包态忽略该环境变量。`）：

```text
areE2eTestRoutesEnabled():
  isLawmindPackagedRuntime() → false       ← 打包版一律 false
  否则 LAWMIND_ENABLE_E2E_TEST_ROUTES === "1"
```

而且门禁在**模块加载时算一次**（`E2E_ENABLED = areE2eTestRoutesEnabled()`）——所以运行时改环境变量不生效。

`crash` 那条会**真的 `process.exit(1)`**——它是给「监督层重启」这类测试用的。

而它造的草稿形状是固定的（`E2E 测试草稿` / `E2E 测试摘要` / 章节「审查结论」+「E2E 测试结论：风险可控，建议签署。」）——**所以 e2e 断言能依赖这些字面量**。

### `route-desk-settings.ts`：两条

```text
GET  /api/workspace/desk-settings
POST /api/workspace/desk-settings
```

只有两个字段：`contractBatchRelativeDir`（批量合同目录）与 `auditExternalAnchorUrl`。

**错误码只有两种**：`invalid_path`（当消息是 `invalid_contract_batch_dir`）与 `save_failed`。

### 两条空的拒绝：`route-practice-playbook.ts` 与 `route-roles.ts`

```text
GET/POST /api/workspace/practice-playbook   四个字段：stanceDefault / disputeForum / neverAccept / notes
GET /api/roles  +  GET /api/roles/:roleId   内置角色列表与详情
```

**执业口径那条的注释说明了默认**：`optional 执业口径 (defaults if missing)`——所以文件不存在时给默认值，不是报错。

## 65.10 J 集群：其余单点

这一组文件大多只有一两条路由，但它们各自有一个值得记的点。

### `route-models.ts`：八条与一段很长的提示

```text
GET    /api/models
POST   /api/models/test
PATCH  /api/models/default
PATCH  /api/models/worker
PATCH  /api/models/retrieval
PATCH  /api/models/draft-with-model
POST   /api/models/custom
DELETE /api/models/custom/:id
```

**那条最长的错误提示**（原文）：

```text
<探测错误>
提示：自定义模型的「模型 ID」必须是该 Base URL 真正支持的名称（不是 custom:xxx）。
请确认你填的模型名在该服务商/端点的模型列表中存在，且 Key 有权限。
```

**它点名了一个很常见的误用**：「把 `custom:xxx` 这种 LawMind 内部 id 填进模型名」。而另一条错误把这条规则写成了校验：

```text
custom_model_invalid_model_name
模型 ID 不能使用 LawMind 内部 ID（custom: / builtin: 等），请填写该端点实际的模型名称（如 gpt-4o、qwen-plus）。
```

**「如 gpt-4o、qwen-plus」给了两个具体例子。**

### `route-mcp.ts`：三条与一条 stdio 安全提示

```text
GET/PUT /api/mcp/servers
POST    /api/mcp/servers/:id/test
```

**那条安全提示是常量**（原文）：

```text
stdio 类型 MCP 服务器会以本机权限启动其 command/args（等同本机命令执行）；
仅配置可信来源的服务器。
```

而写 stdio 类型的服务器**必须显式确认**：

```text
confirm_command_execution_required
<安全提示> 确认风险后请在请求体中带 confirmCommandExecution: true 再提交。
```

**「必须带一个显式布尔」**——这是一道防手滑的门。而高安全模式下直接 403：

```text
高安全模式下不可配置 MCP 客户端。
```

### `route-platform.ts`：三条与一条「不强制」

```text
GET/PATCH /api/policy/workspace
POST      /api/policy/workspace/recommended-allowlist
GET       /api/platform/gate-history    默认 60 条
```

**那条注解说清了合并推荐名单的边界**：

```text
已合并推荐法律检索主机；未强制开启联网或 networkAllowlistEnforced。
```

**「只加名单，不改两个开关」**——所以合并推荐名单不会悄悄把网络打开。

### `route-license.ts`：四条与一句「一律拒绝写入」

```text
GET  /api/license
GET  /api/license/fingerprint
POST /api/license/activate   { code }
POST /api/license/clear
```

**头注释里那句是硬承诺**：

```text
无网络调用；激活码校验失败一律拒绝写入。
```

**「无网络调用」**——离线许可的意义就在这里。

### `route-search.ts`：两条与一个重建开关

```text
POST /api/search/workspace/rebuild
GET  /api/search/workspace?q=&matterId=&source=&limit=
```

**重建需要显式开关**：

```text
403 index_rebuild_disabled
设置 LAWMIND_ALLOW_INDEX_REBUILD=1 后可在本机重建全文索引。
```

三个来源：`audit` / `session` / `knowledge`（`all` 是全三个）。默认 limit 30。

### `route-skills.ts`、`route-triage.ts`、`route-sources.ts`、`route-works.ts`、`route-tools-registry.ts`

**`route-skills.ts`**：`GET /api/skills` + `POST /api/skills/enabled`。它的 pack 路径是写死的：

```text
<工作区>/lawmind/packs/cn-legal-pack.json
```

**`route-triage.ts`**：四条。`POST /api/triage` 支持自动确认：

```text
skipGreenConfirm && tier === "green" → 自动确认
```

而缺澄清项时是 **422**：

```text
missing_clarification + { key }
```

**「422 而非 400」**：请求本身没问题，是业务上还缺东西。

**`route-sources.ts`**：三条。它的头注释是全部文件里最长的一段（讲「来源锚点」的意义），里面有一句值得记：

```text
This is the trust moat that closes the gap with Harvey / Spellbook style verifiable provenance.
```

**「可信来源才是护城河」**——这是产品定位的直接表述。

而 `query` 参数的行为分两种：

```text
有 taskId → 在这份草稿的研究快照里找，并报告哪些章节引用了它
没 taskId → 扫全工作区所有快照，返回第一个命中（罕见，主要用于开发/对话引用）
```

**「（罕见，主要用于开发）」**——诚实标注了那条分支的使用频率。

**`route-works.ts`**：五条。`source` 只有五个值：

```text
chat  mail  file  compare  automation
```

而一条业务门：

```text
work_missing_matter + "先指定案件，才能存成自动办件。"
```

**「先指定案件」**——因为自动办件要按案件跑。

**`route-tools-registry.ts`**：一条。但它的默认值值得记：

```text
allowDangerousToolsWithoutApproval: false
strictDangerousToolApproval: true
```

**「默认严格」**——所以这条只读接口在不传配置时给的是最保守的口径。

### `route-sse.ts`：一条

```text
GET /api/events
参数：types（可多个）、clientId、lastEventId
头：x-lawmind-sse-types、x-lawmind-sse-client-id、last-event-id
```

**查询参数与请求头两套都能传**——所以浏览器（用头）与脚本（用查询串）都能用。

总线没起来时 `503 sse_bus_unavailable`。

### `route-onboarding.ts`：一条

```text
POST /api/onboarding/firstrun-wizard
```

而它的案件目录围栏有两条：

```text
cases/<matterId> 必须存在且是目录
否则：invalid matterId / matter not found in workspace
```

**「先有目录，才记首跑向导完成」**——所以完成标记与案件绑定。

### `route-registry.ts` 与 `route-types.ts`

这两个是第 63 章讲过的（51 个 handler 的有序数组、两个上下文类型）。

**这里只补一条**：`route-types.ts` 里 `clientId` 的注释列了五种身份：`desktop` / `renderer` / `word-addin` / `cli` / `shared`。**而 `LOCAL_API_CLIENTS` 只有四个**（没有 `shared`）——因为 `shared` 是那个开发跳过的身份。

## 65.11 十一个跨文件的环境变量

把这一章的 54 个文件扫一遍，只出现十一个 `LAWMIND_*`：

| 变量                             | 文件          | 作用                  |
| -------------------------------- | ------------- | --------------------- |
| `LAWMIND_MAIL_SEED`              | automations   | `=1` 才允许播演示邮件 |
| `LAWMIND_ENABLE_COLLABORATION`   | collaboration | `=false` 关协作       |
| `LAWMIND_AUTHORITY_ENDPOINT`     | health        | 法源端点              |
| `LAWMIND_REPO_ROOT`              | health        | 仓库根                |
| `LAWMIND_REASONING_MODE`         | health        | 推理模式              |
| `LAWMIND_PROJECT_DIR`            | host-access   | 项目目录              |
| `LAWMIND_ALLOW_INDEX_REBUILD`    | search        | `=1` 允许重建索引     |
| `LAWMIND_ENABLE_E2E_TEST_ROUTES` | e2e           | `=1` 开测试路由       |
| `LAWMIND_DAEMON`                 | daemon        | `=1` 是守护模式       |

**只有九个**（另两个是常量的名字，不是环境变量）。

**这个数字说明一件事**：**这一层的配置入口是「设置界面」而不是环境变量**。九成的功能开关走 `/api/workspace/*`、`/api/policy/*`、`/api/desk-settings` 这些端点，写进工作区文件。

## 65.12 已知坑（本章相关）

- **没有 `/api/doctor` 或 `/api/repair`**——doctor 数据在 `/api/health` 里。
- **`/api/host-access` 没有授权端点**——授权舞步全在模型工具那侧。
- **`/api/fs/write` 用 409 + `mtimeMs` 做并发保护。**
- **`protected_workspace_path` 的文案里点名了「请使用对应的设置入口」。**
- **Word 插件七个状态里四个是异常态。**
- **`not_awaiting_matter:<状态>` 把状态拼进错误码。**
- **`?runNow` 的实现是把下次时间设成 1970 年。**
- **`approved_local_only` 是「批了但没发出去」的专门状态。**
- **邮件测试失败返回 HTTP 200**（业务结果 vs 请求错误的区分）。
- **删委派会同时请求中止会话。**
- **工作流异步分支返回 202。**
- **`matter-replica` 有四个端点不过版本门**（否则没法问「为什么关着」）。
- **密钥轮换失败会单独报警告**（成员已移除但仍能解密的危险状态）。
- **`learning:` 前缀让两类建议共用一个端点。**
- **「稍后再说」在服务端也是明确不存在的路。**
- **`adopt` 的 note 在改写时变成字面量 `"rewritten"`。**
- **「认知升级建议」是从律师档案的文本行里正则解析的。**
- **判定项的 id（`itemKey`）不得出现在律师面字段**，有 `ui-copy-lint` 管着。
- **`/api/audit/event` 的 `kind` 只允许 `outbound_http` 一个值。**
- **审批的过期是 24 小时。**
- **风险映射在服务端也硬编码了五个工具名**（与界面两份实现）。
- **`approval_already_resolved` 的文案强调「当前状态未变更」。**
- **作业流是手写 SSE（`data:` 单行 + `: ping`）**，与 SSE 总线的三行帧不同。
- **`cannot delete default or unknown assistant`。**
- **上传模板 id 必须像 `upload/firm-brief`。**
- **「扫占位符只支持 docx，登记支持 docx 与 pptx」。**
- **e2e 门禁在模块加载时算一次**，运行时改环境变量不生效。
- **e2e 在打包版一律关**（忽略环境变量）。
- **`crash` 端点会真的退出进程。**
- **自定义模型的模型名不能用 LawMind 内部 id**（`custom:` / `builtin:`）。
- **配 stdio MCP 必须带 `confirmCommandExecution: true`。**
- **合并推荐名单不会打开联网开关。**
- **许可激活无网络调用，校验失败一律拒绝写入。**
- **重建索引需要 `LAWMIND_ALLOW_INDEX_REBUILD=1`。**
- **`route-sources` 里「没 taskId 就扫全工作区」那条分支是罕见路径**（自己标注了）。
- **`route-tools-registry` 的默认口径是最保守的**（危险工具要批准 + 严格审批）。
- **这一层的功能开关九成走工作区文件，只有九个环境变量。**
