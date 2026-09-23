# 附录 B HTTP 端点全表

本附录列出本地服务的全部端点。路径来源是从 `apps/lawmind-desktop/server/` 里机械提取的路由字面量（`rg` 抓 `/api/` 与 `/word-addin/` 开头的字符串）。

前置说明（第 14 章有完整解释）：

- 所有端点都只监听回环，且必须过**回环 Host 门**。
- 除下面标注「免 bearer」的，都要 `Authorization: Bearer <派生凭据>`。
- 客户端有范围限制：`word-addin` 只能碰 `/word-addin/` 和 `/api/word-addin/`；`cli` 只能 `GET`/`HEAD`/`OPTIONS`。
- 错误信封统一是 `{ ok:false, code, message, error }`。

## B.1 健康、引导与版本

| 端点                                          | 方法        | 说明                                                                     |
| --------------------------------------------- | ----------- | ------------------------------------------------------------------------ |
| `/.well-known/lawmind-local`                  | GET         | **免 bearer**。发现端点，返回 base、instanceId、epoch、clients，不含密钥 |
| `/api/health`                                 | GET         | 体检大包（含 `doctor`、法源、索引、策略、进程信号等）                    |
| `/api/bootstrap`                              | GET         | 启动引导数据                                                             |
| `/api/daemon`                                 | GET         | 守护状态                                                                 |
| `/api/daemon/log`                             | GET         | 守护日志尾部                                                             |
| `/api/policy/edition`                         | GET         | 当前版本与功能开关                                                       |
| `/api/policy/workspace`                       | GET / PATCH | 工作区策略文件                                                           |
| `/api/policy/workspace/recommended-allowlist` | GET         | 推荐网络白名单                                                           |
| `/api/platform/gate-history`                  | GET         | 门禁历史                                                                 |
| `/api/support/bundle`                         | GET         | 诊断包（`?download=1` 出 zip）                                           |
| `/api/license`                                | GET         | 许可状态                                                                 |
| `/api/license/fingerprint`                    | GET         | 机器指纹                                                                 |
| `/api/license/activate`                       | POST        | 激活                                                                     |
| `/api/license/clear`                          | POST        | 清除激活                                                                 |
| `/api/authority/probe`                        | POST        | 探测法源端点                                                             |
| `/api/e2e/crash`                              | POST        | **仅测试**（需 `LAWMIND_ENABLE_E2E_TEST_ROUTES=1`）                      |
| `/api/e2e/create-draft`                       | POST        | **仅测试**                                                               |

## B.2 对话与会话

| 端点                                        | 方法               | 说明                                              |
| ------------------------------------------- | ------------------ | ------------------------------------------------- |
| `/api/chat`                                 | POST               | 跑一个回合，SSE 流式返回事件                      |
| `/api/chat/resume`                          | POST               | 恢复（审批后、澄清答复后）                        |
| `/api/sessions`                             | GET / POST         | 列表 / 新建                                       |
| `/api/sessions/delete`                      | POST               | 删会话（级联清侧车）                              |
| `/api/sessions/search`                      | GET                | 会话搜索                                          |
| `/api/sessions/:id`                         | GET / PATCH        | 读 / 改标题等                                     |
| `/api/sessions/:id/live-turn`               | GET                | 当前回合实时进度                                  |
| `/api/sessions/:id/context-budget`          | GET                | 上下文预算                                        |
| `/api/sessions/:id/fork-with-carryover`     | POST               | 承前分叉                                          |
| `/api/sessions/:id/inject`                  | POST               | 中途注入                                          |
| `/api/sessions/:id/steer`                   | POST               | 中途指示                                          |
| `/api/sessions/:id/followup`                | POST /（`/claim`） | 跟进队列                                          |
| `/api/sessions/:id/abort`                   | POST               | 中断                                              |
| `/api/sessions/:id/messages/mutate`         | POST               | 改消息                                            |
| `/api/sessions/:id/compact`                 | POST               | 手动压缩                                          |
| `/api/sessions/:id/resume`                  | POST               | 恢复                                              |
| `/api/sessions/:id/resume-paused`           | POST               | 恢复暂停态                                        |
| `/api/sessions/:id/plan-handoff`            | GET / PUT / DELETE | 计划交接                                          |
| `/api/sessions/:sessionId/fleet-transcript` | GET                | 在办用的会话转录                                  |
| `/api/events`                               | GET                | **全局 SSE**（15 秒心跳，支持 `task:*` 通配订阅） |

## B.3 意图、技能与工具

| 端点                        | 方法 | 说明                               |
| --------------------------- | ---- | ---------------------------------- |
| `/api/intent/compile`       | POST | 编译意图（与回合内同源）           |
| `/api/skills`               | GET  | 列工作区技能（会幂等跑一次种子）   |
| `/api/skills/enabled`       | POST | 开关技能（`{ skillId, enabled }`） |
| `/api/tools/registry`       | GET  | 工具注册表 + 治理元数据            |
| `/api/mcp/servers`          | GET  | MCP 服务器列表                     |
| `/api/mcp/servers/:id/test` | POST | 测 MCP 连接                        |
| `/api/triage`               | POST | 分诊                               |
| `/api/triage/confirm`       | POST | 确认分诊                           |
| `/api/triage/rules`         | GET  | 分诊规则                           |

## B.4 案件

| 端点                                          | 方法        | 说明                                 |
| --------------------------------------------- | ----------- | ------------------------------------ |
| `/api/matters`                                | GET         | 列案件 id                            |
| `/api/matters/create`                         | POST        | 建案件（可带冲突检查与委托确认）     |
| `/api/matters/detail`                         | GET         | 案件详情大包                         |
| `/api/matters/overviews`                      | GET         | 全部案件总览                         |
| `/api/matters/search`                         | GET         | 案件内搜索                           |
| `/api/matters/profile`                        | POST        | 改卷宗字段                           |
| `/api/matters/display-name`                   | POST        | 改展示名                             |
| `/api/matters/role`                           | GET / POST  | 案件/文件夹角色                      |
| `/api/matters/delete`                         | POST        | 删案件目录                           |
| `/api/matters/case-note`                      | POST        | 写给 CASE.md 某节                    |
| `/api/matters/interaction`                    | POST        | 记律师动作（进审计）                 |
| `/api/matters/interaction-rollup`             | GET         | 跨案件动作汇总                       |
| `/api/matters/repair-projections`             | POST        | 修 JSON↔CASE.md 漂移                 |
| `/api/matters/review-matrix`                  | GET         | 案件审查矩阵                         |
| `/api/matters/review-matrix/export`           | GET         | 导出矩阵 CSV                         |
| `/api/matters/session-timeline`               | GET         | 会话时间线（`limit` 5–100）          |
| `/api/matters/team-roster`                    | GET / PUT   | 团队名单                             |
| `/api/matters/team-meeting`                   | GET         | 会议记录（`limit` / `skipFromEnd`）  |
| `/api/matters/:matterId/ops`                  | GET / PATCH | Matter Ops（范围/计划/RAID）         |
| `/api/matters/:matterId/theory`               | GET / PUT   | 案件理论                             |
| `/api/matters/:matterId/pulse`                | GET         | 案件快照                             |
| `/api/matters/:matterId/materials/search`     | GET         | 材料全文检索（带页码）               |
| `/api/matters/:matterId/precedents`           | GET         | 先例库（未开启返回 `enabled:false`） |
| `/api/matters/:matterId/similar-cases`        | GET         | 相似案件                             |
| `/api/matters/:matterId/cause`                | POST        | 写案由                               |
| `/api/matters/:matterId/intake-brief`         | GET / POST  | 读 / 整理谈话摘要                    |
| `/api/matters/:matterId/intake-brief/confirm` | POST        | 确认摘要并写穿                       |
| `/api/queues`                                 | GET         | 工作队列                             |
| `/api/approvals`                              | GET         | 审批（可按 `status` / `targetRole`） |
| `/api/approvals/resolve`                      | POST        | 处理审批                             |
| `/api/action-summary`                         | GET         | 待我拍板计数                         |

## B.5 工作台

| 端点                                           | 方法       | 说明                           |
| ---------------------------------------------- | ---------- | ------------------------------ |
| `/api/desk/today`                              | GET        | 今日一屏                       |
| `/api/desk/matters`                            | GET        | 按门类列案件                   |
| `/api/desk/plan`                               | POST       | 加计划项                       |
| `/api/desk/plan/items/:itemId`                 | PATCH      | 勾完成                         |
| `/api/desk/plan/source-done`                   | POST       | 由来源反向勾完成               |
| `/api/desk/events/extract`                     | POST       | 从文本抽法律事件               |
| `/api/desk/events/extract-file`                | POST       | 从文件抽                       |
| `/api/desk/events/confirm`                     | POST       | 确认写入期限（一次最多 12 条） |
| `/api/desk/standards/match`                    | POST       | 匹配办案标准                   |
| `/api/desk/replica-feed`                       | GET        | 副本动态（Firm 门控）          |
| `/api/matters/:matterId/deadlines`             | GET / POST | 期限                           |
| `/api/matters/:matterId/deadlines.ics`         | GET        | 导出日历                       |
| `/api/matters/:matterId/deadlines/:deadlineId` | PATCH      | 改期限（完成/稍后）            |
| `/api/workspace/standards`                     | GET / POST | 办案标准                       |
| `/api/workspace/standards/:id`                 | DELETE     | 删标准                         |
| `/api/workspace/cause-lexicon`                 | GET / POST | 案由词表                       |
| `/api/workspace/desk-settings`                 | GET / POST | 工作台设置                     |
| `/api/workspace/practice-playbook`             | GET / POST | 执业口径                       |
| `/api/mail/providers`                          | GET        | 邮箱服务商预设                 |
| `/api/mail/accounts`                           | GET / POST | 邮箱账号                       |
| `/api/mail/matters/:matterId/attachments`      | GET        | 某案件的邮件附件               |
| `/api/ethics-wall`                             | GET        | 伦理墙状态                     |
| `/api/ethics-wall/acknowledge`                 | POST       | 律师确认（模型不许调）         |

## B.6 草稿、改稿与交付

| 端点                                                | 方法        | 说明                           |
| --------------------------------------------------- | ----------- | ------------------------------ |
| `/api/drafts`                                       | GET         | 草稿列表                       |
| `/api/drafts/:taskId`                               | GET         | 单份草稿                       |
| `/api/drafts/:taskId/content`                       | GET / PATCH | 正文读写                       |
| `/api/drafts/:taskId/review`                        | POST        | 审核签批                       |
| `/api/drafts/:taskId/reopen-review`                 | POST        | 重开审核                       |
| `/api/drafts/:taskId/render`                        | POST        | 渲染（须过验收门）             |
| `/api/drafts/:taskId/render-tracked`                | POST        | 渲染修订轨                     |
| `/api/drafts/:taskId/table`                         | GET / PATCH | 审查表侧车                     |
| `/api/drafts/:taskId/table.xlsx`                    | GET         | 导出 xlsx                      |
| `/api/drafts/:taskId/acceptance`                    | GET         | 验收与推理报告                 |
| `/api/drafts/:taskId/acceptance-pack`               | GET         | 验收包（`?format=json`）       |
| `/api/drafts/:taskId/checklist`                     | GET         | 必核清单                       |
| `/api/drafts/:taskId/redline`                       | GET         | 读修订提案                     |
| `/api/drafts/:taskId/redline/generate`              | POST        | 生成提案                       |
| `/api/drafts/:taskId/redline/hunks/:hunkId/resolve` | POST        | 处理单个 hunk                  |
| `/api/drafts/:taskId/redline/resolve-all`           | POST        | 全部处理                       |
| `/api/drafts/:taskId/redline/baseline`              | POST        | 重置基线                       |
| `/api/drafts/:taskId/revision-job`                  | POST        | 后台修订（须状态为「需修改」） |
| `/api/drafts/:taskId/revision-job` 的 `statusUrl`   | GET         | `/api/sessions/:id/live-turn`  |
| `/api/tasks`                                        | GET         | 任务列表                       |
| `/api/tasks/:id`                                    | GET         | 任务详情（含检查点）           |
| `/api/history`                                      | GET         | 历史与交付记录                 |
| `/api/artifact`                                     | GET         | 产物下载                       |
| `/api/deliverables/specs`                           | GET         | 交付物规格表                   |
| `/api/acceptance-summary`                           | GET         | 验收总览                       |
| `/api/review-campaigns`                             | GET / POST  | 审查专案组                     |
| `/api/review-campaigns/:id`                         | GET         | 读一个                         |
| `/api/review-campaigns/:id/cancel`                  | POST        | 取消                           |
| `/api/review-campaigns/:id/roles/:role/rerun`       | POST        | 重跑某角色                     |
| `/api/review-campaigns/:id/report`                  | GET         | 出 Markdown 报告               |
| `/api/fleet-playbooks`                              | GET         | 专案组模板列表                 |
| `/api/fleet-playbooks/:id`                          | GET         | 读一个模板                     |

## B.7 记忆与学习

| 端点                                          | 方法       | 说明                                                 |
| --------------------------------------------- | ---------- | ---------------------------------------------------- |
| `/api/memory/adoption`                        | GET        | 列建议（`scope` / `state` / `matterId` / `unified`） |
| `/api/memory/adoption/:id/preview-diff`       | GET        | 采纳前差异                                           |
| `/api/memory/adoption/suggest`                | POST       | 提交建议                                             |
| `/api/memory/adoption/adopt`                  | POST       | 采纳单条                                             |
| `/api/memory/adoption/adopt-batch`            | POST       | 批量（默认 dryRun）                                  |
| `/api/memory/adoption/dismiss`                | POST       | 忽略                                                 |
| `/api/memory/sources`                         | GET        | 记忆来源分层（含是否进提示词）                       |
| `/api/memory/source-text`                     | GET        | 只读看记忆文件片段                                   |
| `/api/memory/adoptions`                       | GET        | 已落盘的认知升级行                                   |
| `/api/learning/suggestions`                   | GET        | 学习队列                                             |
| `/api/learning/suggestions/:id/adopt`         | POST       | 采纳                                                 |
| `/api/learning/suggestions/:id/dismiss`       | POST       | 忽略                                                 |
| `/api/learning/contract-review/drafts`        | GET / POST | 合同审查草稿                                         |
| `/api/learning/contract-review/drafts/accept` | POST       | 接受                                                 |
| `/api/learning/contract-revisions`            | GET        | 合同修订积累包                                       |
| `/api/learning/contract-revision/finalize`    | POST       | 定稿积累包                                           |
| `/api/lawyer-profile/learning`                | POST       | 写律师偏好学习                                       |
| `/api/lawyer-profile/applied-preferences`     | GET        | 已生效的偏好                                         |
| `/api/lawyer-profile/applied-preferences/:id` | DELETE     | 清一条                                               |
| `/api/assistants/profile/learning`            | POST       | 写助手档案                                           |
| `/api/assistants/growth`                      | GET        | 助手成长报告                                         |
| `/api/historical-scan`                        | GET        | 历史扫描状态                                         |
| `/api/historical-scan/roots`                  | POST       | 加扫描根                                             |
| `/api/historical-scan/roots/remove`           | POST       | 移除扫描根                                           |
| `/api/historical-scan/run`                    | POST       | 跑扫描                                               |

## B.8 检索与来源

| 端点                                       | 方法       | 说明                                                     |
| ------------------------------------------ | ---------- | -------------------------------------------------------- |
| `/api/search/workspace`                    | GET        | 工作区检索（`source=all\|audit\|session\|knowledge`）    |
| `/api/search/workspace/rebuild`            | POST       | 重建索引（需 `LAWMIND_ALLOW_INDEX_REBUILD=1`，否则 403） |
| `/api/sources/:id/preview`                 | GET        | 来源预览（含支撑了哪些结论、被哪些章节引用）             |
| `/api/sources/:id/annotations`             | GET / POST | 来源批注                                                 |
| `/api/integrations`                        | GET        | 集成连接器状态                                           |
| `/api/integrations/:connectorId/documents` | GET        | 连接器文档列表                                           |

## B.9 模型与配置

| 端点                              | 方法        | 说明           |
| --------------------------------- | ----------- | -------------- |
| `/api/models`                     | GET         | 模型列表       |
| `/api/models/custom`              | GET / POST  | 自定义模型     |
| `/api/models/default`             | GET / PATCH | 默认模型       |
| `/api/models/worker`              | GET / PATCH | worker 模型    |
| `/api/models/retrieval`           | GET / PATCH | 检索通道       |
| `/api/models/draft-with-model`    | PATCH       | 起草用模型     |
| `/api/models/test`                | POST        | 连通性测试     |
| `/api/templates`                  | GET         | 模板列表       |
| `/api/templates/built-in`         | GET         | 内置模板       |
| `/api/templates/uploaded`         | GET         | 上传的模板     |
| `/api/templates/enabled`          | POST        | 开关模板       |
| `/api/templates/register`         | POST        | 注册模板       |
| `/api/templates/scan`             | POST        | 扫描模板目录   |
| `/api/onboarding/firstrun-wizard` | POST        | 首跑向导       |
| `/api/bootstrap`                  | GET         | 同上（见 B.1） |

## B.10 协作与在办

| 端点                                    | 方法           | 说明                                      |
| --------------------------------------- | -------------- | ----------------------------------------- |
| `/api/collaboration/summary`            | GET            | 协作摘要                                  |
| `/api/collaboration/workflow-templates` | GET            | 工作流模板                                |
| `/api/collaboration/workflow-run`       | POST           | 跑工作流（`async:true` 返回 202 + jobId） |
| `/api/collaboration-events`             | GET            | 协作事件（可带 `since`）                  |
| `/api/delegations`                      | GET / POST     | 委派列表 / 发起                           |
| `/api/delegations/:id`                  | GET / DELETE   | 读 / 删                                   |
| `/api/delegations/follow-up`            | GET            | 跟进                                      |
| `/api/delegations/session-progress`     | GET            | 会话进度                                  |
| `/api/assistants`                       | GET / POST     | 助手列表 / 新建                           |
| `/api/assistants/:id`                   | PATCH / DELETE | 改 / 删                                   |
| `/api/assistants/:id/duplicate`         | POST           | 复制（**不含记忆与统计**）                |
| `/api/assistants/:id/profile-sections`  | GET            | 档案小节                                  |
| `/api/assistant-presets`                | GET            | 岗位预设                                  |
| `/api/agent-presets`                    | GET            | 同上的别名                                |
| `/api/agent-fleet`                      | GET            | 在办数据                                  |
| `/api/roles` / `/api/roles/:roleId`     | GET            | 角色                                      |
| `/api/routing/defaults`                 | GET / PUT      | 默认承办人                                |
| `/api/routing/resolve`                  | POST           | 解析承办人                                |
| `/api/works`                            | GET            | 工作记录                                  |
| `/api/works/automation`                 | POST           | 从工作记录建自动化                        |

## B.11 自动办件与任务队列

| 端点                                | 方法                        | 说明                                                             |
| ----------------------------------- | --------------------------- | ---------------------------------------------------------------- |
| `/api/automations`                  | GET / POST / PATCH / DELETE | 自动办件 CRUD                                                    |
| `/api/automations/presets`          | GET                         | 预设                                                             |
| `/api/automations/from-instruction` | POST                        | 从指令推断                                                       |
| `/api/automations/mail/seed`        | POST                        | **仅开发**（`LAWMIND_MAIL_SEED=1`）                              |
| `/api/automations/inbox/:id/action` | POST                        | 收件箱处置（`inbox` 数据本身在 `GET /api/automations` 的响应里） |
| `/api/automations/:id/runs`         | GET                         | 运行历史                                                         |
| `/api/jobs`                         | GET                         | 任务队列（`limit` / `status` / `since` / `matterId`）            |
| `/api/jobs/:id`                     | GET                         | 任务详情                                                         |
| `/api/jobs/:id/stream`              | GET                         | 任务进度 SSE（25 秒心跳）                                        |
| `/api/jobs/:id/cancel`              | POST                        | 取消                                                             |

## B.12 审批与判断项

| 端点                        | 方法 | 说明                         |
| --------------------------- | ---- | ---------------------------- |
| `/api/approvals`            | GET  | 待办（含工具审批与案件审批） |
| `/api/approvals/resolve`    | POST | 处理                         |
| `/api/judgment/summary`     | GET  | 判断项摘要                   |
| `/api/judgment/tiering`     | GET  | 分级模式                     |
| `/api/judgment/task`        | GET  | 某任务的判断项               |
| `/api/judgment/escalations` | GET  | 待定夺项                     |

## B.13 指标与审计

| 端点                                | 方法 | 说明                                                                                      |
| ----------------------------------- | ---- | ----------------------------------------------------------------------------------------- |
| `/api/metrics/lawyer-dashboard`     | GET  | 案件级或工作台级指标                                                                      |
| `/api/metrics/north-star`           | GET  | 北极星快照                                                                                |
| `/api/metrics/north-star-trend`     | GET  | 趋势（`windowDays` 默认 30）                                                              |
| `/api/metrics/team-growth`          | GET  | 团队成长                                                                                  |
| `/api/metrics/team-growth/baseline` | POST | 写基线                                                                                    |
| `/api/audit/event`                  | POST | 写审计事件                                                                                |
| `/api/audit/export`                 | GET  | 导出（`matterId` / `taskId` / `since` / `until` / `compliance` / `integrity` / `replay`） |
| `/api/audit/export-summary`         | GET  | 导出摘要（`?format=text`）                                                                |
| `/api/audit/verify-external`        | POST | 验外锚                                                                                    |

## B.14 本机访问与文件

| 端点                               | 方法 | 说明                             |
| ---------------------------------- | ---- | -------------------------------- |
| `/api/fs/tree`                     | GET  | 文件树                           |
| `/api/fs/read`                     | GET  | 读文件                           |
| `/api/fs/write`                    | POST | 写文件（受可写根与治理路径限制） |
| `/api/host-access`                 | GET  | 本机访问状态                     |
| `/api/host-access/index/rebuild`   | POST | 重建本机索引                     |
| `/api/host-access/log`             | GET  | 本机访问日志                     |
| `/api/host-access/session-command` | POST | 会话内本机命令                   |
| `/api/artifact`                    | GET  | 产物下载（见 B.6）               |

## B.15 案件副本与案件云

| 端点                                            | 方法      | 说明             |
| ----------------------------------------------- | --------- | ---------------- |
| `/api/matter-replica`                           | GET       | 总状态           |
| `/api/matter-replica/status`                    | GET       | 状态             |
| `/api/matter-replica/identity`                  | GET / PUT | 律师身份         |
| `/api/matter-replica/membership`                | GET       | 成员名册         |
| `/api/matter-replica/invites`                   | POST      | 建邀请           |
| `/api/matter-replica/invites/accept`            | POST      | 接受邀请         |
| `/api/matter-replica/invites/revoke`            | POST      | 撤销邀请         |
| `/api/matter-replica/members/revoke`            | POST      | 移除成员         |
| `/api/matter-replica/locks`                     | GET       | 签出锁列表       |
| `/api/matter-replica/locks/acquire` / `release` | POST      | 签出 / 归还      |
| `/api/matter-replica/ops`                       | GET       | 操作日志         |
| `/api/matter-replica/feed`                      | GET       | 信息流           |
| `/api/matter-replica/materials`                 | GET       | 材料索引         |
| `/api/matter-replica/materials/publish`         | POST      | 发布材料         |
| `/api/matter-replica/sync`                      | POST      | 立刻同步         |
| `/api/matter-replica/scheduler`                 | GET       | 调度器状态       |
| `/api/matter-replica/scheduler/tick`            | POST      | 手动 tick        |
| `/api/matter-replica/audit-report`              | GET       | 审计报告         |
| `/v1/matters/:id/ops`                           | GET / PUT | 案件云：操作同步 |
| `/v1/matters/:id/materials/manifest`            | GET / PUT | 案件云：材料清单 |
| `/v1/matters/:id/blobs/:sha256`                 | GET / PUT | 案件云：内容块   |
| `/v1/matters/:id/membership`                    | GET / PUT | 案件云：名册     |
| `/v1/matters/:id/invites` / `invites/revoke`    | POST      | 案件云：邀请     |
| `/v1/invites/redeem`                            | POST      | 案件云：兑换邀请 |
| `/v1/me`                                        | GET       | 案件云：当前账号 |
| `/v1/health`                                    | GET       | 案件云：健康     |

## B.16 Word 插件

静态面（**免 bearer**，仅 `GET`，仍在回环 Host 门后面）：

| 端点                        | 说明                       |
| --------------------------- | -------------------------- |
| `/word-addin/manifest.xml`  | 侧载清单（模板变量被替换） |
| `/word-addin/taskpane.html` | 任务窗格页面               |
| `/word-addin/taskpane.js`   | 窗格逻辑                   |
| `/word-addin/taskpane.css`  | 窗格样式                   |
| `/word-addin/config.js`     | 同源配置与凭据（生成）     |
| `/word-addin/icon-32.png`   | 图标（生成）               |

数据面（需 bearer，`word-addin` 客户端）：

| 端点                                 | 方法       | 说明                             |
| ------------------------------------ | ---------- | -------------------------------- |
| `/api/word-addin/reviews`            | GET / POST | 列 / 建审查请求                  |
| `/api/word-addin/reviews/:id`        | GET        | 读一个                           |
| `/api/word-addin/reviews/:id/result` | POST       | 回填结果                         |
| `/api/word-addin/reviews/:id/matter` | POST       | 指定案卷（旧 `needs_matter` 用） |
| `/api/word-addin/reviews/:id/export` | POST       | 取导出路径                       |
| `/api/word-addin/matters`            | GET        | 可选案卷                         |

注意静态面的路径有守卫：`/word-addin/../package.json` 这类会被拒（`asset_outside_addin_dir`）。

## B.17 常见错误码速查

| 错误码                                | 状态 | 含义                                       |
| ------------------------------------- | ---- | ------------------------------------------ |
| `loopback_host_required`              | 400  | Host 不是回环                              |
| `invalid_api_token`                   | 401  | 凭据认不出来                               |
| `client_scope_forbidden`              | 403  | 客户端越权                                 |
| `mutation_requires_json_content_type` | 415  | 开发态跳鉴权时变更请求缺 JSON Content-Type |
| `rate_limited`                        | 429  | 令牌桶空了                                 |
| `no_route`                            | 404  | 路由不匹配（提示重新打包本地服务）         |
| `body_too_large`                      | 413  | 请求体过大                                 |
| `invalid_json`                        | 400  | 请求体不是合法 JSON                        |
| `invalid_request_body`                | 400  | zod 校验失败                               |
| `invalid_job_id`                      | 400  | job id 不安全                              |
| `job_not_found`                       | 404  | 任务不存在                                 |
| `job_already_terminal`                | 409  | 任务已终态，不能取消                       |
| `index_rebuild_disabled`              | 403  | 未开 `LAWMIND_ALLOW_INDEX_REBUILD`         |
| `audit_integrity_export_disabled`     | 403  | 版本没开完整性导出                         |
| `feature_disabled`                    | 403  | 版本功能关闭（如验收包导出）               |
| `collaboration_disabled`              | 503  | `LAWMIND_ENABLE_COLLABORATION=false`       |
| `root_not_writable`                   | —    | 不可写的根（如本机文件夹）                 |
| `protected_workspace_path`            | —    | 治理路径禁止改写                           |
| `outside_allowed_roots`               | —    | 路径在允许根之外                           |
| `invalid_matter_id`                   | 400  | 案件 id 不合法                             |
| `draft_not_found`                     | 404  | 草稿不存在                                 |
| `draft_not_editable`                  | 409  | 草稿状态不许编辑                           |
| `table_not_found`                     | 404  | 审查表不存在                               |
| `redline_not_found`                   | 404  | 修订提案不存在                             |
| `hunk_not_found`                      | 404  | hunk 不存在                                |
| `revision_job_requires_modified`      | 400  | 后台修订要求状态为「需修改」               |
| `missing_api_key`                     | 503  | 没配模型                                   |
| `keychain_unavailable`                | —    | 系统密钥链不可用                           |
| `checklist_incomplete`                | —    | 必核清单没勾完                             |
| `keychain_write_failed`               | —    | 密钥链写入失败                             |

## B.18 怎么核对这份清单

```bash
# 抓服务端所有路由路径字面量
rg -o '"/api/[a-zA-Z0-9_/:.-]*"|"/word-addin/[a-zA-Z0-9_/.-]*"' \
   apps/lawmind-desktop/server --no-filename | tr -d '"' | sort -u
```

输出里会混进测试用的假路径（比如 `/api/other`、`/api/test`、`/api/drafts/strict-bypass-task/render`），那些不是真实端点。判断方法是看它出现在 `handleXxxRoutes` 的分支里，还是只出现在 `.test.ts` 里。
