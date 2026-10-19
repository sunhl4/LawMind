# 附录 B HTTP 端点全表

本附录列出本地桌面服务（`apps/lawmind-desktop/server/`）的全部 HTTP 端点，已按 2026-10-17 的服务端代码逐文件核对。分组跟随路由文件，顺序就是 `apps/lawmind-desktop/server/lawmind-server-route-registry.ts` 里 `LAWMIND_ROUTE_HANDLERS` 数组的注册顺序——**先返回 true 的处理器胜出**，同一路径写在多个文件里时只有最靠前的生效。

规模：**367 条可达端点**，分布在 60 个路由文件里（`lawmind-server-route-registry.ts` 与 `lawmind-server-route-types.ts` 只有分发逻辑，没有自己的路径）。367 含：发现端点 1 条、条件注册的 E2E 端点 2 条、Word 插件静态资源前缀 1 条。另有 2 条源码里写了但运行时到不了的分支，见 B.62。

计数口径：一行写 `PATCH / POST` 表示两个方法各自算一条端点。`:id`、`:taskId` 等是路径参数。

前置说明（第 14 章有完整解释）：

- 所有端点只监听回环（`127.0.0.1` 与 `::1`），`Host` 不是回环直接 400 `loopback_host_required`。
- `OPTIONS` 预检在鉴权前直接回 204，不算业务端点，也不计入 367。
- 除标注「免 bearer」的，都要 `Authorization: Bearer <派生凭据>`。凭据按 `HMAC-SHA256(secret, clientId:epoch)` 派生；客户端有 `desktop` / `renderer` / `word-addin` / `cli`，旧环境变量 `LAWMIND_LOCAL_API_TOKEN` 记为 `shared`。
- 客户端范围（默认拒绝）：`word-addin` 只能打 `/word-addin/` 与 `/api/word-addin/`，越界 403 `client_scope_forbidden`；`cli` 只能 `GET` / `HEAD` / `OPTIONS`。
- 免 bearer 的只有：`GET /.well-known/lawmind-local`、`GET /word-addin` 与 `GET /word-addin/*`（静态面）。数据面 `/api/word-addin/*` 仍要 bearer。
- 未打包且 `LAWMIND_SKIP_API_AUTH` 打开时跳过 bearer（身份记为 `shared`），此时变更请求必须带 `Content-Type: application/json`，否则 415。
- 限流：令牌桶 100/s、容量 200，超出 429。豁免：`OPTIONS`，以及 `GET`/`HEAD` 的 `/.well-known/lawmind-local` 与 `/api/bootstrap`。
- 统一错误信封是 `{ ok:false, code, message, error }`（`apps/lawmind-desktop/server/lawmind-api-error.ts`）。不少 handler 只回 `{ ok:false, error }`，没有 `code`；速查表见 B.63。

## B.1 发现端点（lawmind-server-dispatch.ts · 1 条）

分发层处理，不进路由数组。

| 方法 | 路径                         | 说明                                                                                      |
| ---- | ---------------------------- | ----------------------------------------------------------------------------------------- |
| GET  | `/.well-known/lawmind-local` | 回环坐标发现：base、instanceId、epoch、客户端名单；不含令牌。**免 bearer**，仍要回环 Host |

## B.2 E2E 测试路由（lawmind-server-route-e2e.ts · 2 条）

仅当进程未打包且 `LAWMIND_ENABLE_E2E_TEST_ROUTES=1` 才注册生效；否则处理器返回 false，这两条对外是 404。

| 方法 | 路径                    | 说明                                   |
| ---- | ----------------------- | -------------------------------------- |
| POST | `/api/e2e/create-draft` | 写入测试用草稿与任务记录               |
| POST | `/api/e2e/crash`        | 写一条审计后触发进程崩溃，供监督层测试 |

## B.3 全局 SSE（lawmind-server-route-sse.ts · 1 条）

| 方法 | 路径          | 说明                                                                                                                                         |
| ---- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| GET  | `/api/events` | 统一 SSE 总线。`types` 查询参数或头 `x-lawmind-sse-types` 筛选；`lastEventId` / `Last-Event-ID` 重放最近 64 条；15 秒 `: heartbeat` 注释心跳 |

## B.4 体检与法源探测（lawmind-server-route-health.ts · 2 条）

| 方法 | 路径                   | 说明                                               |
| ---- | ---------------------- | -------------------------------------------------- |
| GET  | `/api/health`          | 工作区体检：版本、策略、索引、许可、进程降级信号等 |
| POST | `/api/authority/probe` | 探测权威库/检索源是否可用                          |

## B.5 启动引导（lawmind-server-route-bootstrap.ts · 1 条）

| 方法 | 路径             | 说明                                                                 |
| ---- | ---------------- | -------------------------------------------------------------------- |
| GET  | `/api/bootstrap` | 桌面启动包：模型是否配好、助手名册、版本功能、运行能力标志。限流豁免 |

## B.6 文书模板（lawmind-server-route-templates.ts · 7 条）

上传体系已退役：四条写路径固定 405。`GET /api/templates/built-in` 由本文件提供；`lawmind-server-route-memory-templates.ts` 里的同名分支被遮蔽，见 B.62。

| 方法   | 路径                      | 说明                             |
| ------ | ------------------------- | -------------------------------- |
| GET    | `/api/templates`          | 内置文书模板清单；上传列表恒为空 |
| GET    | `/api/templates/built-in` | 只读内置模板                     |
| GET    | `/api/templates/uploaded` | 恒返回空数组                     |
| POST   | `/api/templates/scan`     | 已退役，固定 405                 |
| POST   | `/api/templates/register` | 已退役，固定 405                 |
| POST   | `/api/templates/enabled`  | 已退役，固定 405                 |
| DELETE | `/api/templates/uploaded` | 已退役，固定 405                 |

## B.7 对话采信纸（lawmind-server-route-acceptance-sheet.ts · 5 条）

| 方法 | 路径                                        | 说明                                      |
| ---- | ------------------------------------------- | ----------------------------------------- |
| GET  | `/api/sessions/:sessionId/acceptance-sheet` | 按会话取对话采信纸（可带 `taskId`）       |
| GET  | `/api/acceptance-sheet/locate`              | 按 `path`/`root` 定位材料在采信纸上的位置 |
| GET  | `/api/acceptance-sheet/page`                | 把材料指定页渲成 PNG                      |
| GET  | `/api/drafts/:taskId/acceptance-sheet`      | 读该草稿上的采信标记                      |
| POST | `/api/drafts/:taskId/acceptance-sheet`      | 写采信标记，或 `restoreRemoved` 恢复      |

## B.8 验收（lawmind-server-route-acceptance.ts · 6 条）

| 方法 | 路径                                  | 说明                                                                                                |
| ---- | ------------------------------------- | --------------------------------------------------------------------------------------------------- |
| GET  | `/api/deliverables/specs`             | 交付物规格清单                                                                                      |
| GET  | `/api/acceptance-summary`             | 工作区验收汇总                                                                                      |
| GET  | `/api/policy/edition`                 | 当前版本（Solo/Firm/Private）与功能开关                                                             |
| GET  | `/api/drafts/:taskId/checklist`       | 该草稿的验收清单视图                                                                                |
| GET  | `/api/drafts/:taskId/acceptance-pack` | 导出验收包 Markdown；`?format=json` 包一层 JSON。`edition.features.acceptancePackExport` 关闭时 403 |
| GET  | `/api/drafts/:taskId/acceptance`      | 该草稿的验收报告                                                                                    |

## B.9 分诊（lawmind-server-route-triage.ts · 4 条）

| 方法 | 路径                  | 说明                 |
| ---- | --------------------- | -------------------- |
| GET  | `/api/triage/rules`   | 列出分诊规则 id      |
| POST | `/api/triage`         | 创建分诊会话（预览） |
| POST | `/api/triage/confirm` | 确认分诊结果并落审计 |
| GET  | `/api/triage/:id`     | 读取一条分诊会话     |

## B.10 审稿战役（lawmind-server-route-review-campaign.ts · 8 条）

| 方法 | 路径                                            | 说明                                |
| ---- | ----------------------------------------------- | ----------------------------------- |
| GET  | `/api/fleet-playbooks`                          | 列出内置与工作区审稿剧本            |
| GET  | `/api/fleet-playbooks/:id`                      | 单个剧本                            |
| GET  | `/api/review-campaigns`                         | 列出审稿战役                        |
| POST | `/api/review-campaigns`                         | 创建战役；`runNow` 时可在请求内跑完 |
| GET  | `/api/review-campaigns/:id`                     | 战役详情                            |
| POST | `/api/review-campaigns/:id/cancel`              | 取消战役                            |
| POST | `/api/review-campaigns/:id/roles/:roleId/rerun` | 重跑战役中的一个角色                |
| GET  | `/api/review-campaigns/:id/report`              | 战役报告                            |

## B.11 作业标准（lawmind-server-route-skills.ts · 2 条）

| 方法 | 路径                  | 说明                                                |
| ---- | --------------------- | --------------------------------------------------- |
| GET  | `/api/skills`         | 列出内置作业标准（playbook）；`configurable: false` |
| POST | `/api/skills/enabled` | 固定 405：作业标准不能安装或开关                    |

## B.12 意图编译（lawmind-server-route-intent.ts · 1 条）

| 方法 | 路径                  | 说明                                   |
| ---- | --------------------- | -------------------------------------- |
| POST | `/api/intent/compile` | 与正式回合同一条意图编译，给状态栏预览 |

## B.13 MCP 服务器（lawmind-server-route-mcp.ts · 3 条）

| 方法 | 路径                        | 说明                                                    |
| ---- | --------------------------- | ------------------------------------------------------- |
| GET  | `/api/mcp/servers`          | 读 `workspace/lawmind/mcp-servers.json`（密钥只留引用） |
| PUT  | `/api/mcp/servers`          | 整表写入 MCP 服务器配置；高安全模式 403                 |
| POST | `/api/mcp/servers/:id/test` | 试通一台 MCP 服务器；高安全模式 403                     |

## B.14 来源（lawmind-server-route-sources.ts · 3 条）

| 方法 | 路径                           | 说明                                                        |
| ---- | ------------------------------ | ----------------------------------------------------------- |
| GET  | `/api/sources/:id/annotations` | 列出某来源上的批注                                          |
| POST | `/api/sources/:id/annotations` | 写入一条来源批注                                            |
| GET  | `/api/sources/:id/preview`     | 来源预览：题录、支撑主张、引用了它的草稿章节。可带 `taskId` |

## B.15 连接器（lawmind-server-route-integrations.ts · 2 条）

| 方法 | 路径                                       | 说明                              |
| ---- | ------------------------------------------ | --------------------------------- |
| GET  | `/api/integrations`                        | 只读连接器状态列表                |
| GET  | `/api/integrations/:connectorId/documents` | 某连接器下的文档；可带 `matterId` |

## B.16 工具注册表（lawmind-server-route-tools-registry.ts · 1 条）

| 方法 | 路径                  | 说明                                   |
| ---- | --------------------- | -------------------------------------- |
| GET  | `/api/tools/registry` | 法律工具名、治理元数据、是否要显式审批 |

## B.17 后台改稿（lawmind-server-route-draft-revision.ts · 1 条）

| 方法 | 路径                               | 说明                                                                                                                                                                                                                          |
| ---- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST | `/api/drafts/:taskId/revision-job` | 文书台提交改稿：立刻回 `{ queued, sessionId, statusUrl }`，代理在后台跑（后台回合，不进 `/api/jobs`）。`statusUrl` 指向 `GET /api/sessions/:sessionId/live-turn`。草稿状态非「需修改」时 400 `revision_job_requires_modified` |

## B.18 红线（lawmind-server-route-redline.ts · 5 条）

| 方法 | 路径                                                | 说明                   |
| ---- | --------------------------------------------------- | ---------------------- |
| GET  | `/api/drafts/:taskId/redline`                       | 读取红线提案与摘要     |
| POST | `/api/drafts/:taskId/redline/generate`              | 生成红线提案           |
| POST | `/api/drafts/:taskId/redline/hunks/:hunkId/resolve` | 接受或拒绝单块         |
| POST | `/api/drafts/:taskId/redline/resolve-all`           | 一次处理全部红线块     |
| POST | `/api/drafts/:taskId/redline/baseline`              | 用当前草稿重置红线基线 |

## B.19 工作区检索（lawmind-server-route-search.ts · 2 条）

| 方法 | 路径                            | 说明                                                                                                    |
| ---- | ------------------------------- | ------------------------------------------------------------------------------------------------------- |
| GET  | `/api/search/workspace`         | 检索审计、会话、个人知识；`q`、`matterId`、`source`、`limit`                                            |
| POST | `/api/search/workspace/rebuild` | 整库重建工作区全文索引。须 `LAWMIND_ALLOW_INDEX_REBUILD=1` 或 `true`，否则 403 `index_rebuild_disabled` |

## B.20 草稿与签批（lawmind-server-route-review.ts · 18 条）

签批与重开、改正文、删除会向 SSE 总线发 `review:status` 和/或 `task:update`。签批为 approved 时若必核清单没勾完回 422 `checklist_incomplete`；`LAWMIND_ALLOW_CHECKLIST_BYPASS` 可绕过，否则绕过请求 403。注意 `/api/drafts/:taskId/content` 只有 PATCH，没有 GET。

| 方法   | 路径                                          | 说明                                      |
| ------ | --------------------------------------------- | ----------------------------------------- |
| GET    | `/api/learning/suggestions`                   | 待审的学习建议                            |
| POST   | `/api/learning/suggestions/:id/adopt`         | 采纳一条学习建议                          |
| POST   | `/api/learning/suggestions/:id/dismiss`       | 忽略一条学习建议                          |
| GET    | `/api/lawyer-profile/applied-preferences`     | 已写入律师档案的偏好                      |
| DELETE | `/api/lawyer-profile/applied-preferences/:id` | 删掉一条已应用偏好                        |
| POST   | `/api/lawyer-profile/learning`                | 把审稿学习写入律师档案                    |
| POST   | `/api/assistants/profile/learning`            | 把审稿学习写入助手档案                    |
| GET    | `/api/tasks/:taskId`                          | 任务详情（含检查点）。列表在 records 文件 |
| POST   | `/api/drafts/:taskId/review`                  | 签批草稿                                  |
| POST   | `/api/drafts/:taskId/render-tracked`          | 导出带修订的 Word                         |
| POST   | `/api/drafts/:taskId/render`                  | 导出清洁稿                                |
| POST   | `/api/drafts/:taskId/reopen-review`           | 把已签批草稿打回待审                      |
| GET    | `/api/drafts/:taskId/table.xlsx`              | 下载草稿表格 xlsx                         |
| GET    | `/api/drafts/:taskId/table`                   | 读草稿表格 JSON                           |
| PATCH  | `/api/drafts/:taskId/table`                   | 改草稿表格                                |
| PATCH  | `/api/drafts/:taskId/content`                 | 改草稿正文                                |
| GET    | `/api/drafts/:taskId`                         | 读单份草稿                                |
| DELETE | `/api/drafts/:taskId`                         | 删除草稿                                  |

## B.21 模型（lawmind-server-route-models.ts · 8 条）

| 方法   | 路径                           | 说明                             |
| ------ | ------------------------------ | -------------------------------- |
| GET    | `/api/models`                  | 模型目录与当前默认/工人/检索模型 |
| POST   | `/api/models/test`             | 探测某个模型能否接通             |
| PATCH  | `/api/models/default`          | 设默认模型                       |
| PATCH  | `/api/models/worker`           | 设工人模型                       |
| PATCH  | `/api/models/retrieval`        | 设检索模型                       |
| PATCH  | `/api/models/draft-with-model` | 开关「按模型出稿」               |
| POST   | `/api/models/custom`           | 添加自定义模型                   |
| DELETE | `/api/models/custom/:id`       | 删除自定义模型                   |

## B.22 对话回合（lawmind-server-route-chat.ts · 2 条）

| 方法 | 路径               | 说明                                                                                                                                      |
| ---- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| POST | `/api/chat`        | 发起一轮对话。`Accept: text/event-stream` 时同一连接上流式事件（`round_start`、`delta`、`final`、`done` 等，25 秒 `: ping`），否则回 JSON |
| POST | `/api/chat/resume` | 对待拍板项做恢复/继续（JSON，不走聊天 SSE）                                                                                               |

## B.23 审批（lawmind-server-route-approvals.ts · 3 条）

本文件先于 matters 注册，所以 `GET /api/approvals` 由这里处理（matters 里的同名分支到不了，见 B.62）。批准/拒绝后发 SSE `approval:update`。

| 方法 | 路径                         | 说明                             |
| ---- | ---------------------------- | -------------------------------- |
| GET  | `/api/approvals`             | 合并工具审批与案卷审批的待办列表 |
| POST | `/api/approvals/:id/approve` | 批准。工具审批会恢复被卡住的回合 |
| POST | `/api/approvals/:id/reject`  | 拒绝                             |

## B.24 待办汇总（lawmind-server-route-action-summary.ts · 2 条）

| 方法 | 路径                     | 说明                                                                                              |
| ---- | ------------------------ | ------------------------------------------------------------------------------------------------- |
| GET  | `/api/action-summary`    | 律师待办汇总：审批、队列、在跑工作流、聊天待拍板、待审草稿、插件队列                              |
| POST | `/api/approvals/resolve` | 按 matterId+approvalId 把案卷审批标成 approved / rejected / needs_changes；也发 `approval:update` |

## B.25 判断项（lawmind-server-route-judgment.ts · 4 条）

| 方法 | 路径                        | 说明                           |
| ---- | --------------------------- | ------------------------------ |
| GET  | `/api/judgment/summary`     | 判断项战绩汇总；缺数据不编 0   |
| GET  | `/api/judgment/task`        | 单个任务的判断明细（`taskId`） |
| GET  | `/api/judgment/escalations` | 需要律师定夺的升级项           |
| GET  | `/api/judgment/tiering`     | 判断分层表                     |

## B.26 代理舰队（lawmind-server-route-agent-fleet.ts · 4 条）

| 方法 | 路径                                        | 说明                     |
| ---- | ------------------------------------------- | ------------------------ |
| GET  | `/api/agent-fleet`                          | 在办事项上的代理舰队摘要 |
| GET  | `/api/assistants/growth`                    | 助手成长报告             |
| GET  | `/api/agent-presets`                        | 工作区代理预设           |
| GET  | `/api/sessions/:sessionId/fleet-transcript` | 该会话的舰队转写         |

## B.27 邮箱（lawmind-server-route-mail.ts · 9 条）

同一条正则不接受 `GET /api/mail/accounts/:id`；方法对不上会落到 404。

| 方法   | 路径                                      | 说明                           |
| ------ | ----------------------------------------- | ------------------------------ |
| GET    | `/api/ethics-wall`                        | 读某案伦理墙状态（`matterId`） |
| POST   | `/api/ethics-wall/acknowledge`            | 律师确认伦理墙                 |
| GET    | `/api/mail/providers`                     | 邮箱服务商预设                 |
| GET    | `/api/mail/matters/:matterId/attachments` | 该案已同步邮件与附件路径       |
| GET    | `/api/mail/accounts`                      | 邮箱账号列表（不含密钥明文）   |
| POST   | `/api/mail/accounts`                      | 新建或更新邮箱账号             |
| DELETE | `/api/mail/accounts/:id`                  | 删除账号                       |
| POST   | `/api/mail/accounts/:id/test`             | 测试连接                       |
| POST   | `/api/mail/accounts/:id/sync`             | 把该账号同步进指定案卷         |

## B.28 律师自动化（lawmind-server-route-automations.ts · 10 条）

更具体的 `presets` / `from-instruction` / `mail/seed` / `runs` 写在 `:id` 之前，避免被 `:id` 吃掉。

| 方法   | 路径                                | 说明                                                 |
| ------ | ----------------------------------- | ---------------------------------------------------- |
| GET    | `/api/automations/presets`          | 律师自动化预设                                       |
| GET    | `/api/automations/:id/runs`         | 某条自动化的运行记录                                 |
| GET    | `/api/automations`                  | 列出自动化                                           |
| POST   | `/api/automations`                  | 创建自动化                                           |
| POST   | `/api/automations/from-instruction` | 从一句指令推断并创建                                 |
| POST   | `/api/automations/mail/seed`        | 注入演示邮件。`LAWMIND_MAIL_SEED=1` 才可用，否则 403 |
| GET    | `/api/automations/:id`              | 单条自动化                                           |
| PATCH  | `/api/automations/:id`              | 修改                                                 |
| DELETE | `/api/automations/:id`              | 删除                                                 |
| POST   | `/api/automations/inbox/:id/action` | 处理收件箱一项（含批准后发信）                       |

## B.29 助手（lawmind-server-route-assistants.ts · 9 条）

| 方法   | 路径                                   | 说明                                                                 |
| ------ | -------------------------------------- | -------------------------------------------------------------------- |
| GET    | `/api/assistant-presets`               | 内置助手预设                                                         |
| GET    | `/api/assistants`                      | 助手名册                                                             |
| GET    | `/api/assistants/roster-search`        | 按名字搜名册                                                         |
| POST   | `/api/assistants`                      | 新建助手；名册上限受 `multiAssistantRoster` 功能开关约束（超限 400） |
| GET    | `/api/assistants/:id/profile-sections` | 助手档案分节                                                         |
| POST   | `/api/assistants/:id/share-template`   | 导出可分享模板                                                       |
| POST   | `/api/assistants/:id/duplicate`        | 复制助手；同样受名册上限                                             |
| PATCH  | `/api/assistants/:id`                  | 改助手                                                               |
| DELETE | `/api/assistants/:id`                  | 删除助手                                                             |

## B.30 律师台面（lawmind-server-route-lawyer-desk.ts · 31 条）

`POST /api/desk/plan/items/:id/delete` 与 `DELETE /api/desk/plan/items/:id` 等价，供不能发 DELETE 的客户端用。

| 方法   | 路径                                           | 说明                                        |
| ------ | ---------------------------------------------- | ------------------------------------------- |
| GET    | `/api/desk/today`                              | 今日台面                                    |
| GET    | `/api/desk/replica-feed`                       | 案件副本动态；门控关闭时仍回 enabled/reason |
| GET    | `/api/desk/matters`                            | 台面用的案卷列表                            |
| POST   | `/api/desk/plan`                               | 保存今日计划                                |
| PATCH  | `/api/desk/plan/items/:id`                     | 改计划项                                    |
| DELETE | `/api/desk/plan/items/:id`                     | 删计划项                                    |
| POST   | `/api/desk/plan/items/:id/delete`              | 与 DELETE 等价的 POST 删除                  |
| POST   | `/api/desk/plan/source-done`                   | 把计划来源标完成                            |
| GET    | `/api/matters/:matterId/deadlines`             | 该案期限列表                                |
| POST   | `/api/matters/:matterId/deadlines`             | 记一条期限                                  |
| GET    | `/api/matters/:matterId/deadlines.ics`         | 导出期限日历                                |
| PATCH  | `/api/matters/:matterId/deadlines/:deadlineId` | 改期、推迟或完成                            |
| POST   | `/api/desk/events/extract`                     | 从文本抽期限/事件                           |
| POST   | `/api/desk/events/extract-file`                | 从文件抽期限/事件                           |
| POST   | `/api/desk/events/confirm`                     | 确认抽取出的事件落库                        |
| GET    | `/api/workspace/standards`                     | 工作区审查标准                              |
| POST   | `/api/workspace/standards`                     | 写入审查标准                                |
| DELETE | `/api/workspace/standards/:id`                 | 删除一条标准                                |
| POST   | `/api/desk/standards/match`                    | 按合同类型匹配标准                          |
| GET    | `/api/matters/:matterId/brief`                 | 案情简报                                    |
| POST   | `/api/desk/hotlines`                           | 记录热线/紧急联系                           |
| GET    | `/api/matters/:matterId/pulse`                 | 案卷脉搏（健康/进展条）                     |
| POST   | `/api/matters/:matterId/intake-brief/confirm`  | 确认收案简报                                |
| GET    | `/api/matters/:matterId/intake-brief`          | 读收案简报                                  |
| POST   | `/api/matters/:matterId/intake-brief`          | 写收案简报                                  |
| GET    | `/api/matters/:matterId/similar-cases`         | 相似案件                                    |
| GET    | `/api/matters/:matterId/materials/search`      | 本案材料检索                                |
| GET    | `/api/matters/:matterId/precedents`            | 先例                                        |
| POST   | `/api/matters/:matterId/cause`                 | 把案由写回案卷                              |
| GET    | `/api/workspace/cause-lexicon`                 | 案由词表                                    |
| POST   | `/api/workspace/cause-lexicon`                 | 更新案由词表                                |

## B.31 许可（lawmind-server-route-license.ts · 4 条）

| 方法 | 路径                       | 说明                         |
| ---- | -------------------------- | ---------------------------- |
| GET  | `/api/license`             | 当前许可/试用状态            |
| GET  | `/api/license/fingerprint` | 本机指纹（离线激活用）       |
| POST | `/api/license/activate`    | 校验签名并写入激活码；无网络 |
| POST | `/api/license/clear`       | 清除已存激活码               |

## B.32 诊断包（lawmind-server-route-support.ts · 1 条）

| 方法 | 路径                  | 说明                                                              |
| ---- | --------------------- | ----------------------------------------------------------------- |
| GET  | `/api/support/bundle` | 脱敏诊断包。无 `download=1` 时只预览文件名单；`download=1` 下 zip |

## B.33 案件副本（lawmind-server-route-matter-replica.ts · 21 条）

门控：`evaluateMatterReplicaGate`。排在前面的只读/身份/审计/调度状态端点在门控关闭时仍返回说明（标注「关闭时仍 200/执行」）；从 `POST .../scheduler/tick` 起的端点在关闭时统一 403。`PUT cloud`、`PUT relay` 各自在未开启时 403。

| 方法 | 路径                                    | 说明                                                                      |
| ---- | --------------------------------------- | ------------------------------------------------------------------------- |
| GET  | `/api/matter-replica/status`            | 协作是否开启、云端点、本地云路径。关闭时仍 200                            |
| GET  | `/api/matter-replica/identity`          | 本机律师身份。关闭时仍 200                                                |
| PUT  | `/api/matter-replica/identity`          | 写入显示名/邮箱。关闭时仍执行                                             |
| GET  | `/api/matter-replica/audit-report`      | 协作审计报告；`format=markdown` 或 `text` 时直接下 Markdown。关闭时仍 200 |
| GET  | `/api/matter-replica/scheduler`         | 自动同步调度器状态。关闭时仍 200                                          |
| PUT  | `/api/matter-replica/cloud`             | 设置云端点。未开启 403                                                    |
| PUT  | `/api/matter-replica/relay`             | 设置共享中继目录。未开启 403                                              |
| POST | `/api/matter-replica/scheduler/tick`    | 手动打一拍自动同步。未开启 403                                            |
| GET  | `/api/matter-replica/membership`        | 某案成员名册（`matterId`）。未开启 403                                    |
| POST | `/api/matter-replica/invites`           | 发出邀请。未开启 403                                                      |
| POST | `/api/matter-replica/invites/accept`    | 凭 token 接受邀请。未开启 403                                             |
| POST | `/api/matter-replica/invites/revoke`    | 撤销邀请。未开启 403                                                      |
| POST | `/api/matter-replica/members/revoke`    | 撤销成员。未开启 403                                                      |
| GET  | `/api/matter-replica/locks`             | 检出锁列表。未开启 403                                                    |
| POST | `/api/matter-replica/locks/acquire`     | 取得锁。未开启 403                                                        |
| POST | `/api/matter-replica/locks/release`     | 释放锁。未开启 403                                                        |
| GET  | `/api/matter-replica/ops`               | 读案卷操作日志。未开启 403                                                |
| GET  | `/api/matter-replica/feed`              | 协作动态。未开启 403                                                      |
| GET  | `/api/matter-replica/materials`         | 材料清单。未开启 403                                                      |
| POST | `/api/matter-replica/materials/publish` | 发布材料。未开启 403                                                      |
| POST | `/api/matter-replica/sync`              | 与云/中继同步一案。未开启 403                                             |

## B.34 案件云前缀（lawmind-server-route-matter-cloud.ts · 7 条）

前缀 `/v1/matters`，实现在 `src/lawmind/matter-replica/matter-cloud-http.ts`。副本门控未开启时整段 403；路径对不上正则则最终 404。`sha256` 必须是 64 位十六进制；matterId 为 1–128 位 `[A-Za-z0-9_-]`。

| 方法 | 路径                                       | 说明                          |
| ---- | ------------------------------------------ | ----------------------------- |
| GET  | `/v1/matters/:matterId`                    | 探活：确认该案云服务在        |
| GET  | `/v1/matters/:matterId/ops`                | 读操作日志；没有则 404        |
| PUT  | `/v1/matters/:matterId/ops`                | 写入操作日志                  |
| GET  | `/v1/matters/:matterId/materials/manifest` | 读材料清单                    |
| PUT  | `/v1/matters/:matterId/materials/manifest` | 写材料清单（含 removed）      |
| GET  | `/v1/matters/:matterId/blobs/:sha256`      | 取 blob（octet-stream）       |
| PUT  | `/v1/matters/:matterId/blobs/:sha256`      | 存 blob；新建 201，已存在 409 |

注意：`/v1/me`、`/v1/health`、`/v1/invites/redeem` 等不在桌面 localhost 上，它们属于独立案件云进程（`src/lawmind/matter-cloud/server.ts`）。

## B.35 案卷（lawmind-server-route-matters.ts · 31 条）

`PATCH / POST`、`PUT / POST` 写在一行的，两个方法进同一个分支。本文件还写了一条 `GET /api/approvals`，但被 B.23 的处理器遮蔽，到不了（见 B.62），不计入 31。

| 方法         | 路径                                | 说明                     |
| ------------ | ----------------------------------- | ------------------------ |
| GET          | `/api/matters/:matterId/ops`        | 读案卷工作队列操作       |
| PATCH / POST | `/api/matters/:matterId/ops`        | 打开或流转队列项         |
| GET          | `/api/matters/:matterId/theory`     | 读案件理论/争点          |
| PUT / POST   | `/api/matters/:matterId/theory`     | 写案件理论               |
| GET          | `/api/matters/team-roster`          | 团队名册                 |
| PUT          | `/api/matters/team-roster`          | 保存团队名册             |
| GET          | `/api/matters/team-meeting`         | 团队会议视图             |
| POST         | `/api/matters/case-note`            | 写办案笔记               |
| POST         | `/api/matters/interaction`          | 记一次客户/对方往来      |
| GET          | `/api/matters/overviews`            | 案卷概览列表             |
| GET          | `/api/matters/interaction-rollup`   | 往来汇总                 |
| GET          | `/api/matters/role`                 | 读本案角色               |
| POST         | `/api/matters/role`                 | 写本案角色               |
| POST         | `/api/matters/create`               | 建案                     |
| POST         | `/api/matters/profile`              | 更新案卷档案             |
| POST         | `/api/matters/display-name`         | 改显示名                 |
| POST         | `/api/matters/repair-projections`   | 修复案卷投影             |
| GET          | `/api/matters/delete-plan`          | 删除前的影响预览         |
| POST         | `/api/matters/delete`               | 删除案卷                 |
| GET          | `/api/matters/review-matrix`        | 审稿矩阵                 |
| GET          | `/api/matters/review-matrix/export` | 导出审稿矩阵             |
| GET          | `/api/matters/review-matrix/notes`  | 读矩阵批注               |
| PUT          | `/api/matters/review-matrix/notes`  | 写矩阵批注               |
| GET          | `/api/matters/session-timeline`     | 某案会话时间线           |
| GET          | `/api/matters/detail`               | 案卷详情（任务、草稿等） |
| GET          | `/api/matters/:matterId/audit-tail` | 该案审计尾部             |
| GET          | `/api/queues`                       | 工作队列                 |
| GET          | `/api/matters/search`               | 搜案卷                   |
| GET          | `/api/matters`                      | 案卷列表                 |

## B.36 首跑向导（lawmind-server-route-onboarding.ts · 3 条）

| 方法 | 路径                               | 说明                             |
| ---- | ---------------------------------- | -------------------------------- |
| GET  | `/api/onboarding/firstrun`         | 首次向导是否已完成/已关闭        |
| POST | `/api/onboarding/firstrun-dismiss` | 关闭首次向导                     |
| POST | `/api/onboarding/firstrun-wizard`  | 记录向导完成，并挂上验收漏斗待办 |

## B.37 守护进程（lawmind-server-route-daemon.ts · 3 条）

| 方法 | 路径              | 说明                                                                     |
| ---- | ----------------- | ------------------------------------------------------------------------ |
| GET  | `/api/daemon`     | 守护进程状态（是否在跑、重启次数、律师可读摘要）                         |
| POST | `/api/daemon`     | `action`：enable / disable / stop / start。start 会在本进程拉起 lawmindd |
| GET  | `/api/daemon/log` | 守护进程日志尾部；`lines` 默认 200，夹在 1–500                           |

## B.38 桌面偏好（lawmind-server-route-desk-settings.ts · 2 条）

| 方法 | 路径                           | 说明                         |
| ---- | ------------------------------ | ---------------------------- |
| GET  | `/api/workspace/desk-settings` | 读桌面偏好（如批量合同目录） |
| POST | `/api/workspace/desk-settings` | 写桌面偏好                   |

## B.39 执业口径（lawmind-server-route-practice-playbook.ts · 2 条）

| 方法 | 路径                               | 说明                                     |
| ---- | ---------------------------------- | ---------------------------------------- |
| GET  | `/api/workspace/practice-playbook` | 读执业口径；缺文件时用默认               |
| POST | `/api/workspace/practice-playbook` | 保存立场、争议解决地、绝不接受条款、备注 |

## B.40 合同修订草稿（lawmind-server-route-contract-review.ts · 3 条）

| 方法 | 路径                                          | 说明                                                                            |
| ---- | --------------------------------------------- | ------------------------------------------------------------------------------- |
| GET  | `/api/learning/contract-review/drafts`        | 列出待验收的合同修订草稿                                                        |
| POST | `/api/learning/contract-review/drafts`        | 保存或更新草稿（批注、要点、路径）；路径逃出工作区 403 `path_outside_workspace` |
| POST | `/api/learning/contract-review/drafts/accept` | 验收通过后写入合同修订积累包                                                    |

## B.41 合同修订积累（lawmind-server-route-learning-contract.ts · 2 条）

| 方法 | 路径                                       | 说明                                                                      |
| ---- | ------------------------------------------ | ------------------------------------------------------------------------- |
| GET  | `/api/learning/contract-revisions`         | 最近修订包摘要                                                            |
| POST | `/api/learning/contract-revision/finalize` | 落盘初始稿、定稿与关键修改点；路径逃出工作区 403 `path_outside_workspace` |

## B.42 会话扩展（lawmind-server-route-sessions.ts · 15 条）

这些比 records 里的 `/api/sessions` 与 `/api/sessions/:id` 更具体，且本文件先注册。`PUT / POST` 写在一行的算 2 条。

| 方法       | 路径                                           | 说明                     |
| ---------- | ---------------------------------------------- | ------------------------ |
| GET        | `/api/sessions/:sessionId/context-budget`      | 上下文预算               |
| POST       | `/api/sessions/:sessionId/fork-with-carryover` | 承前另开会话             |
| POST       | `/api/sessions/:sessionId/inject`              | 向会话注入材料/消息      |
| POST       | `/api/sessions/:sessionId/steer`               | 对进行中的回合做转向     |
| POST       | `/api/sessions/:sessionId/followup`            | 排队一条后续消息         |
| POST       | `/api/sessions/:sessionId/followup/claim`      | 领取已排队的后续消息     |
| POST       | `/api/sessions/:sessionId/abort`               | 请求中止当前回合         |
| POST       | `/api/sessions/:sessionId/messages/mutate`     | 改历史消息               |
| POST       | `/api/sessions/:sessionId/compact`             | 压缩历史并写摘要         |
| POST       | `/api/sessions/:sessionId/resume-paused`       | 恢复状态为 paused 的回合 |
| POST       | `/api/sessions/:sessionId/resume`              | 从暂停/待拍板恢复会话    |
| GET        | `/api/sessions/:sessionId/plan-handoff`        | 读计划交接               |
| PUT / POST | `/api/sessions/:sessionId/plan-handoff`        | 写入计划交接             |
| DELETE     | `/api/sessions/:sessionId/plan-handoff`        | 清除计划交接             |

## B.43 工作项（lawmind-server-route-works.ts · 5 条）

| 方法 | 路径                    | 说明                   |
| ---- | ----------------------- | ---------------------- |
| GET  | `/api/works`            | 列出律师工作项         |
| POST | `/api/works`            | 创建工作项             |
| POST | `/api/works/automation` | 把工作项变成一条自动化 |
| POST | `/api/works/:id/goal`   | 设置工作目标           |
| GET  | `/api/works/:id`        | 读单条工作项           |

## B.44 记录（lawmind-server-route-records.ts · 11 条）

| 方法   | 路径                                 | 说明                                                        |
| ------ | ------------------------------------ | ----------------------------------------------------------- |
| GET    | `/api/tasks`                         | 任务列表（可 `q`/`since`/`until`）。单条在 review 文件      |
| GET    | `/api/sessions/:sessionId/live-turn` | 进行中回合进度；没有则 `{ progress: null, status: "idle" }` |
| POST   | `/api/sessions`                      | 新建会话                                                    |
| POST   | `/api/sessions/delete`               | 删除会话（与 DELETE 等价，避免预检失败）                    |
| GET    | `/api/sessions/search`               | 搜对话                                                      |
| GET    | `/api/sessions/:sessionId`           | 读会话与可见消息                                            |
| PATCH  | `/api/sessions/:sessionId`           | 改标题                                                      |
| DELETE | `/api/sessions/:sessionId`           | 删除会话，可级联委派与未批草稿                              |
| GET    | `/api/sessions`                      | 会话列表（律师切换器用）                                    |
| GET    | `/api/drafts`                        | 草稿列表                                                    |
| GET    | `/api/history`                       | 任务与草稿混排历史                                          |

## B.45 工作流任务（lawmind-server-route-jobs.ts · 5 条）

jobId 只允许 `[A-Za-z0-9._-]`，最长 128，拒绝 `/` 与 `..`（否则 400 `invalid_job_id`）。

| 方法 | 路径                        | 说明                                                                                                                     |
| ---- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| GET  | `/api/jobs`                 | 列表。`limit`、`status`（可重复）、`since`、`matterId`                                                                   |
| GET  | `/api/jobs/:jobId`          | 单条快照                                                                                                                 |
| GET  | `/api/jobs/:jobId/stream`   | 该工作流的 SSE：`data: { ok, job }`，终态后关闭；25 秒 `: ping`。job 必须属于本工作区                                    |
| POST | `/api/jobs/:jobId/cancel`   | 取消。queued/scheduled/awaiting_lawyer 立刻 cancelled；running 只打 `cancelRequested`。已终态 409 `job_already_terminal` |
| POST | `/api/jobs/:jobId/continue` | 律师确认后从 `awaiting_lawyer` 继续；无模型配置 503                                                                      |

## B.46 协作与委派（lawmind-server-route-collaboration.ts · 10 条）

委派创建/取消发 SSE `delegation:update`。

| 方法   | 路径                                    | 说明                                                                             |
| ------ | --------------------------------------- | -------------------------------------------------------------------------------- |
| GET    | `/api/collaboration/summary`            | 协作开关、最近委派与事件；开关关闭仍 200                                         |
| GET    | `/api/delegations/follow-up`            | 某会话的委派跟进；助手与会话不符 403 `session_assistant_mismatch`                |
| GET    | `/api/delegations/session-progress`     | 某会话上仍在跑的委派；助手不符 403                                               |
| POST   | `/api/delegations`                      | 发起委派。`LAWMIND_ENABLE_COLLABORATION` 非 true 时 503 `collaboration_disabled` |
| GET    | `/api/delegations`                      | 委派列表（status、assistantId、matterId）                                        |
| GET    | `/api/delegations/:id`                  | 单条委派                                                                         |
| DELETE | `/api/delegations/:id`                  | 取消委派并中止目标会话回合                                                       |
| GET    | `/api/collaboration/workflow-templates` | 工作区工作流模板                                                                 |
| POST   | `/api/collaboration/workflow-run`       | 按模板入队工作流，立刻返回 jobId；协作关闭 503                                   |
| GET    | `/api/collaboration-events`             | 协作事件；可 `since`                                                             |

## B.47 本机访问（lawmind-server-route-host-access.ts · 4 条）

| 方法 | 路径                               | 说明                             |
| ---- | ---------------------------------- | -------------------------------- |
| GET  | `/api/host-access`                 | 本机访问运行时：策略、挂载、授权 |
| GET  | `/api/host-access/log`             | 本机访问日志                     |
| POST | `/api/host-access/index/rebuild`   | 重建本机文件索引                 |
| POST | `/api/host-access/session-command` | 允许某会话执行一条本机命令       |

## B.48 平台策略（lawmind-server-route-platform.ts · 4 条）

| 方法  | 路径                                          | 说明                                   |
| ----- | --------------------------------------------- | -------------------------------------- |
| GET   | `/api/policy/workspace`                       | 读 `lawmind.policy.json` 的生效视图    |
| PATCH | `/api/policy/workspace`                       | 合并写入工作区策略并重新应用到进程环境 |
| POST  | `/api/policy/workspace/recommended-allowlist` | 把推荐的法律网站并进网络允许名单       |
| GET   | `/api/platform/gate-history`                  | 平台门禁决策历史                       |

## B.49 审计导出（lawmind-server-route-audit-export.ts · 3 条）

三个处理函数在注册表里分三次挂上，顺序是 export-summary、verify-external、export。

| 方法 | 路径                         | 说明                                                                  |
| ---- | ---------------------------- | --------------------------------------------------------------------- |
| GET  | `/api/audit/export-summary`  | 签名后的审计摘要（可纯文本）                                          |
| POST | `/api/audit/verify-external` | 用外部锚核对审计尾                                                    |
| GET  | `/api/audit/export`          | 导出审计 Markdown / 回放 / 合规包；合规导出或完整性导出功能关闭时 403 |

## B.50 记忆来源（lawmind-server-route-memory-templates.ts · 2 条）

本文件还写了一条 `GET /api/templates/built-in`，但被 B.6 的处理器遮蔽，到不了（见 B.62），不计入 2。

| 方法 | 路径                    | 说明                                          |
| ---- | ----------------------- | --------------------------------------------- |
| GET  | `/api/memory/sources`   | 记忆分层来源报告（`matterId`、`assistantId`） |
| GET  | `/api/memory/adoptions` | 已写入律师/助手档案的认知升级                 |

## B.51 记忆正文预览（lawmind-server-route-memory-preview.ts · 1 条）

| 方法 | 路径                      | 说明                                                     |
| ---- | ------------------------- | -------------------------------------------------------- |
| GET  | `/api/memory/source-text` | 在工作区内按相对路径读记忆来源正文；拒绝 `..` 与绝对路径 |

## B.52 记忆采纳（lawmind-server-route-memory-adoption.ts · 6 条）

| 方法 | 路径                                    | 说明                                       |
| ---- | --------------------------------------- | ------------------------------------------ |
| GET  | `/api/memory/adoption/:id/preview-diff` | 采纳前的正文差异                           |
| GET  | `/api/memory/adoption`                  | 待审记忆建议；`scope`、`state`、`matterId` |
| POST | `/api/memory/adoption/suggest`          | 生成建议                                   |
| POST | `/api/memory/adoption/adopt`            | 采纳一条（可改写正文）                     |
| POST | `/api/memory/adoption/adopt-batch`      | 批量采纳                                   |
| POST | `/api/memory/adoption/dismiss`          | 忽略一条                                   |

## B.53 记忆库（lawmind-server-route-memory-library.ts · 5 条）

| 方法 | 路径                          | 说明                                                          |
| ---- | ----------------------------- | ------------------------------------------------------------- |
| GET  | `/api/memory/library`         | 记忆库。`view=habits`、`matter` 或 `revoked`，可带 `matterId` |
| POST | `/api/memory/library/confirm` | 确认待定记忆                                                  |
| POST | `/api/memory/library/revoke`  | 撤销当前记忆                                                  |
| POST | `/api/memory/library/restore` | 恢复已撤销记忆                                                |
| POST | `/api/memory/library/dismiss` | 丢掉待定记忆                                                  |

## B.54 文书预览（lawmind-server-route-word-surface.ts · 15 条）

桌面对话中间栏的 Word 预览，走默认鉴权（`word-addin` 客户端打这些路径会 403）。

| 方法   | 路径                                     | 说明                                                        |
| ------ | ---------------------------------------- | ----------------------------------------------------------- |
| GET    | `/api/word-surface`                      | 打开 docx 的预览快照（`root`、`path`、`projectDir`、mtime） |
| POST   | `/api/word-surface/tracked`              | 对一条修订做接受/拒绝                                       |
| POST   | `/api/word-surface/sync`                 | 把律师改过的段落同步回文书台草稿                            |
| POST   | `/api/word-surface/hunks`                | 按 before/after 提交一处律师修改（可带加粗/倾斜/下划线）    |
| POST   | `/api/word-surface/hunks/:hunkId/undo`   | 撤销一处                                                    |
| POST   | `/api/word-surface/hunks/:hunkId/revise` | 改某一块的替换文字                                          |
| GET    | `/api/word-surface/comments`             | 读批注                                                      |
| POST   | `/api/word-surface/comments`             | 新建批注                                                    |
| POST   | `/api/word-surface/comments/:id`         | 更新批注                                                    |
| DELETE | `/api/word-surface/comments/:id`         | 删除批注                                                    |
| POST   | `/api/word-surface/save`                 | 把段落写回打开的 docx                                       |
| POST   | `/api/word-surface/export-pdf`           | 旁路导出 PDF（有 LibreOffice 时）                           |
| POST   | `/api/word-surface/table-row`            | 在指定表后插入一行                                          |
| POST   | `/api/word-surface/compare`              | 与另一份文件比较，写出 `*_比较稿.docx`                      |
| POST   | `/api/word-surface/export`               | 复制为同目录审阅稿                                          |

## B.55 Word 插件（lawmind-server-route-word-addin.ts · 13 条）

静态面前缀算 1 条，数据面 12 条。静态面**免 bearer**、仅 GET，仍在回环 Host 门后面；身份标成 `word-addin`。已知静态文件名（同一条前缀路由，不另计）：`manifest.xml`（由 `manifest.template.xml` 填 `{{BASE}}`）、`taskpane.html`、`taskpane.js`、`taskpane.css`、`config.js`（同源注入 `window.LAWMIND_ADDIN`）、`icon-32.png`。

| 方法 | 路径                 | 说明                                                                                                                                                           |
| ---- | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET  | `/word-addin/{file}` | 任务窗格静态资源。扩展名限于 html/js/css/xml/json/svg/png；路径穿越 400，类型不在白名单 415 `unsupported_asset_type`，缺文件 404，非 GET 为 405。**免 bearer** |

数据面走默认 bearer，且 `word-addin` 客户端只能打这些路径：

| 方法 | 路径                                    | 说明                                                                    |
| ---- | --------------------------------------- | ----------------------------------------------------------------------- |
| GET  | `/api/word-addin/matters`               | 可选案卷列表                                                            |
| POST | `/api/word-addin/doc-save/:id/result`   | 回填保存作业结果                                                        |
| GET  | `/api/word-addin/matters`               | 案卷下拉：只回 id 与标题                                                |
| GET  | `/api/word-addin/reviews`               | 就地审查列表。`state`、`since`、`path`；按路径时附 `picked`             |
| POST | `/api/word-addin/reviews`               | 建「审这份」。同文件同内容同指令在途则 200 复用，否则 201；可触发工作流 |
| POST | `/api/word-addin/reviews/:id/matter`    | 补选案卷并把请求放回队首；可触发工作流                                  |
| POST | `/api/word-addin/reviews/:id/decisions` | 律师对一条建议的决定                                                    |
| POST | `/api/word-addin/reviews/:id/revise`    | 改一处替换文字                                                          |
| POST | `/api/word-addin/reviews/:id/commit`    | 按清单覆盖已写出的审阅 Word                                             |
| GET  | `/api/word-addin/reviews/:id`           | 单条状态（插件轮询）                                                    |
| POST | `/api/word-addin/reviews/:id/result`    | 桌面回填 task_id 或产物路径与 hunks                                     |
| POST | `/api/word-addin/reviews/:id/export`    | 返回产物路径与是否存在                                                  |

自动取件还受工作区策略 `isWordAddinAutoRunEnabled` 约束：开关关掉时不领新请求，但仍清理卡住的运行。

## B.56 指标（lawmind-server-route-metrics.ts · 6 条）

| 方法 | 路径                                | 说明                                            |
| ---- | ----------------------------------- | ----------------------------------------------- |
| GET  | `/api/metrics/north-star`           | 无干预 / 一次通过 / lint 逃逸                   |
| GET  | `/api/metrics/context-pressure`     | 整理、退让、承前分叉；缺来源则 `present: false` |
| GET  | `/api/metrics/north-star-trend`     | 北极星趋势                                      |
| GET  | `/api/metrics/team-growth`          | 团队成长仪表                                    |
| POST | `/api/metrics/team-growth/baseline` | 把当前窗口冻成基线                              |
| GET  | `/api/metrics/lawyer-dashboard`     | 律师台面指标                                    |

## B.57 历史扫描（lawmind-server-route-historical-scan.ts · 7 条）

这里的 scan job 是历史扫描自己的记录，不是 `WorkflowJobRecord`，没有 `/api/jobs/:id` 视图。

| 方法 | 路径                                 | 说明                                       |
| ---- | ------------------------------------ | ------------------------------------------ |
| GET  | `/api/historical-scan`               | 扫描根、最近一次扫描、计划                 |
| POST | `/api/historical-scan/roots`         | 添加扫描根                                 |
| POST | `/api/historical-scan/roots/remove`  | 去掉扫描根                                 |
| POST | `/api/historical-scan/run`           | 在请求内跑完扫描，响应里带 scan job 与计划 |
| POST | `/api/historical-scan/common-places` | 换成常见目录                               |
| POST | `/api/historical-scan/apply`         | 把扫描计划应用到案卷                       |
| POST | `/api/historical-scan/file`          | 把单个文件扫进案卷                         |

## B.58 角色（lawmind-server-route-roles.ts · 2 条）

| 方法 | 路径                 | 说明                                                  |
| ---- | -------------------- | ----------------------------------------------------- |
| GET  | `/api/roles`         | 全部内置角色                                          |
| GET  | `/api/roles/:roleId` | 单个角色。实现是 `pathname.startsWith("/api/roles/")` |

## B.59 分派（lawmind-server-route-routing.ts · 3 条）

| 方法 | 路径                    | 说明                 |
| ---- | ----------------------- | -------------------- |
| GET  | `/api/routing/defaults` | 读默认分派           |
| PUT  | `/api/routing/defaults` | 保存默认分派         |
| POST | `/api/routing/resolve`  | 按事项解析默认承办人 |

## B.60 审计事件上报（lawmind-server-route-audit-event.ts · 1 条）

| 方法 | 路径               | 说明                                  |
| ---- | ------------------ | ------------------------------------- |
| POST | `/api/audit/event` | 渲染进程上报 `outbound_http` 审计事件 |

## B.61 文件系统（lawmind-server-route-fs.ts · 13 条）

写路径只允许根 `workspace` 与 `project`（`WRITABLE_FS_ROOTS`），否则 403 `root_not_writable`；工作区受保护相对路径 403 `protected_workspace_path`。写成功发 SSE `fs:change`。

| 方法 | 路径                   | 说明                                                 |
| ---- | ---------------------- | ---------------------------------------------------- |
| GET  | `/api/artifact`        | 按工作区相对路径读产物文件                           |
| GET  | `/api/fs/tree`         | 目录树                                               |
| GET  | `/api/fs/raw`          | 原始字节，支持 Range                                 |
| GET  | `/api/fs/pdf-preview`  | 服务端 PDF 预览数据                                  |
| GET  | `/api/fs/zip-listing`  | zip 目录                                             |
| POST | `/api/fs/convert-doc`  | 旧 `.doc` 转成可预览的 docx                          |
| GET  | `/api/fs/xlsx-preview` | 表格预览                                             |
| GET  | `/api/fs/pptx-preview` | 幻灯片预览                                           |
| GET  | `/api/fs/pptx-slide`   | 单页幻灯片                                           |
| POST | `/api/fs/pptx-save`    | 保存幻灯片编辑；不可写根 403                         |
| GET  | `/api/fs/read`         | 读文本（有大小上限）                                 |
| POST | `/api/fs/xlsx-save`    | 把单元格编辑写回 xlsx；mtime 冲突 409                |
| POST | `/api/fs/write`        | 写文本文件；mtime 冲突 409，不可写根或受保护路径 403 |

## B.62 已注册但产品未调用的端点

判法：完整静态路径在 `apps/lawmind-desktop/src/renderer/` 与 `src/lawmind/` 里一次都不出现，也看不到模板字符串拼接（如 `` `/api/memory/library/${action}` ``）的调用方。这些端点**已注册、能跑、有测试**，但今天的桌面产品没有任何界面会调它们——IT 排障时别等一个永远不会来的调用。带 `:id` 的动态路径靠拼接命中，不在此列。

按域分组列出：

模板（上传体系退役后的残留面）：

- `POST /api/templates/scan`、`POST /api/templates/register`、`POST /api/templates/enabled`、`DELETE /api/templates/uploaded` — 固定 405。
- `GET /api/templates/uploaded` — 恒返回空数组。
- `GET /api/templates/built-in` — 端点本身活着，但产品只用 `GET /api/templates`；此路径只在 CHANGELOG 出现过。

采信纸与 MCP、工具注册表：

- `GET /api/acceptance-sheet/locate`、`GET /api/acceptance-sheet/page` — 会话/草稿上的采信纸端点有调用，这两个按路径查询的没有。
- `GET /api/mcp/servers`、`PUT /api/mcp/servers`、`POST /api/mcp/servers/:id/test` — 渲染端没有 MCP 设置面。
- `GET /api/tools/registry` — 只在 CHANGELOG 出现。

学习与判断项：

- `POST /api/assistants/profile/learning` — 渲染端调的是 `/api/lawyer-profile/learning`。
- `GET /api/judgment/summary` — 判断项其余三条有调用，汇总这条没有。

伦理墙、邮件种子、副本运维面：

- `GET /api/ethics-wall`、`POST /api/ethics-wall/acknowledge` — 引擎有 `src/lawmind/policy/ethics-wall.ts`，但产品不打这两条 HTTP。
- `POST /api/automations/mail/seed` — 还需 `LAWMIND_MAIL_SEED=1`。
- `GET /api/matter-replica/audit-report`、`POST /api/matter-replica/scheduler/tick`、`POST /api/matter-replica/members/revoke`、`GET /api/matter-replica/ops`、`GET /api/matter-replica/feed`、`GET /api/matter-replica/materials`、`POST /api/matter-replica/materials/publish` — 副本面里偏运维的一串，产品只调 status/identity/scheduler/locks 等子集。

队列、守护、本机访问与策略：

- `GET /api/queues` — 只在 CHANGELOG 出现。
- `GET /api/daemon/log` — `GET`/`POST /api/daemon` 有调用，日志这条没有。
- `GET /api/host-access`、`GET /api/host-access/log`、`POST /api/host-access/index/rebuild`、`POST /api/host-access/session-command` — 引擎在进程内用 host-access，不走这些 HTTP。
- `POST /api/policy/workspace/recommended-allowlist` — `GET`/`PATCH /api/policy/workspace` 有调用。

插件、指标、分派、文件与会话：

- `GET /api/word-addin/matters` — 任务窗格脚本不调它；只有路由测试。
- `GET /api/metrics/north-star-trend` — 快照有调用，趋势没有。
- `POST /api/routing/resolve` — `GET`/`PUT /api/routing/defaults` 有调用。
- `GET /api/fs/pdf-preview` — 桌面 PDF 预览是渲染进程里的 pdf.js，不是这条 API。
- `POST /api/sessions/:sessionId/resume-paused` — renderer 与 `src/lawmind` 都没有 `resume-paused` 后缀的调用。

反过来，下面几条不在那两棵树里，但仓库别处确实在用，**不算**未调用：`GET /.well-known/lawmind-local`（Electron 主进程、`scripts/lawmind/lawmind-local-token.ts`）、E2E 两条与 `GET /api/support/bundle`、`GET /api/agent-presets` 等（e2e 与 smoke 脚本）、`/word-addin/` 静态面（`apps/lawmind-desktop/resources/word-addin/` 与 Electron）。

### 源码写了但运行时到不了的分支（2 条，不计入 367）

- `GET /api/templates/built-in`（`lawmind-server-route-memory-templates.ts`）：`lawmind-server-route-templates.ts` 在注册表更靠前、先返回 true，这条分支是死代码。端点本身由 templates 文件正常提供（B.6），不是缺功能。
- `GET /api/approvals`（`lawmind-server-route-matters.ts`）：同理被 `lawmind-server-route-approvals.ts` 遮蔽，实际由 approvals 文件处理（B.23）。

## B.63 错误码速查

全局（分发层与基础设施，所有路由共用）：

| 错误码                                | 状态 | 含义                                                          |
| ------------------------------------- | ---- | ------------------------------------------------------------- |
| `loopback_host_required`              | 400  | Host 不是回环                                                 |
| `invalid_api_token`                   | 401  | 凭据认不出来                                                  |
| `client_scope_forbidden`              | 403  | 客户端越权（如 `word-addin` 打业务面）                        |
| `mutation_requires_json_content_type` | 415  | 开发态跳鉴权时变更请求缺 JSON Content-Type                    |
| `rate_limited`                        | 429  | 令牌桶空了                                                    |
| `no_route`                            | 404  | 路由不匹配                                                    |
| `body_too_large`                      | 413  | 请求体过大                                                    |
| `invalid_json`                        | 400  | 请求体不是合法 JSON                                           |
| `invalid_request_body`                | 400  | zod 校验失败                                                  |
| `method_not_allowed`                  | 405  | 方法不允许；退役端点（模板上传等）与插件静态面非 GET 也回 405 |

路由层常见的：

| 错误码                                                     | 状态      | 含义                                                            |
| ---------------------------------------------------------- | --------- | --------------------------------------------------------------- |
| `invalid_task_id` / `invalid_job_id` / `invalid_matter_id` | 400       | 路径段不合法（字符集/长度/穿越）                                |
| `invalid_request` / `invalid_body` / `invalid_fields`      | 400       | 请求字段不合法（各路由措辞略有差异）                            |
| `not_found`                                                | 404       | 通用「不存在」（会话、插件资源等）；不少 handler 用它代替专用码 |
| `session_not_found`                                        | 404       | 会话不存在                                                      |
| `unknown_matter`                                           | 400       | 插件补选的案卷不存在                                            |
| `draft_not_found`                                          | 404       | 草稿不存在                                                      |
| `draft_not_editable`                                       | 409       | 草稿状态不许编辑                                                |
| `table_not_found`                                          | 404       | 审查表不存在                                                    |
| `redline_not_found` / `hunk_not_found`                     | 404       | 修订提案 / hunk 不存在                                          |
| `revision_job_requires_modified`                           | 400       | 后台修订要求状态为「需修改」                                    |
| `checklist_incomplete`                                     | 422       | 必核清单没勾完                                                  |
| `job_not_found`                                            | 404       | 任务不存在                                                      |
| `job_already_terminal`                                     | 409       | 任务已终态，不能取消                                            |
| `conflict`                                                 | 409       | fs 写入时 mtime 冲突（文件被外部改过）                          |
| `path_outside_workspace`                                   | 403       | 路径逃出工作区                                                  |
| `root_not_writable`                                        | 403       | 不可写的根（写路径只允许 `workspace` 与 `project`）             |
| `protected_workspace_path`                                 | 403       | 治理路径禁止改写                                                |
| `session_assistant_mismatch`                               | 403       | 委派跟进时助手与会话不符                                        |
| `feature_disabled`                                         | 403       | 版本功能关闭（如验收包导出）                                    |
| `audit_integrity_export_disabled`                          | 403       | 版本没开完整性导出                                              |
| `index_rebuild_disabled`                                   | 403       | 未开 `LAWMIND_ALLOW_INDEX_REBUILD`                              |
| `collaboration_disabled`                                   | 503       | `LAWMIND_ENABLE_COLLABORATION` 非 true                          |
| `missing_api_key` / `model_not_configured`                 | 503 / 400 | 没配模型（jobs continue、sessions 用前者；模型相关路由用后者）  |
| `unsupported_asset_type`                                   | 415       | 插件静态资源类型不在白名单                                      |
| `asset_not_found`                                          | 404       | 插件静态资源缺失                                                |
| `outside_allowed_roots`                                    | —         | 不是 HTTP。Electron 文件桥 IPC                                  |
| `keychain_unavailable` / `keychain_write_failed`           | —         | 不是 HTTP。密钥保管走 IPC                                       |

## B.64 怎么核对这份清单

端点不是集中声明的路由表，而是各 `lawmind-server-route-*.ts` 里对 `pathname` 的相等比较或正则。核对顺序：

1. 看注册顺序：`apps/lawmind-desktop/server/lawmind-server-route-registry.ts` 的 `LAWMIND_ROUTE_HANDLERS` 数组。本附录 B.1–B.61 与该数组一一对应，每组标题里写了条数，可对着数。
2. 抓路径字面量粗扫：

```bash
# 抓服务端所有路由路径字面量（排除测试）
rg -o '"/api/[a-zA-Z0-9_/:.-]*"|"/word-addin/[a-zA-Z0-9_/.-]*"' \
   apps/lawmind-desktop/server --no-filename --glob '!*.test.ts' | tr -d '"' | sort -u
```

输出里会混进测试辅助路径与非路由字符串，也抓不到 `/.well-known/lawmind-local`、`/v1/…` 和用正则写的路由。要核对必须扫 `pathname ===` 与 `.exec(pathname)`，并以 `LAWMIND_ROUTE_HANDLERS` 的顺序判定谁先匹配。

3. 数总数：把 B.1–B.61 各组条数相加应为 367（`PATCH / POST` 这类合并行算 2 条）。
