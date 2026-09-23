# 第 28 章 数据结构详解

这一章列出核心数据结构的字段定义。排查数据问题、写集成、或者想理解「为什么界面这一栏是空的」时，用它对照。

字段名以代码为准（`src/lawmind/adapters/matter-storage/schema.ts`、`core/contracts.ts`、`agent/types.ts`）。

## 28.1 案件（`MatterRecord`）

存 `matters/<id>/matter.json`。

| 字段                      | 类型           | 说明                                                |
| ------------------------- | -------------- | --------------------------------------------------- |
| `matterId`                | string         | 案件 id（`^[\p{L}\p{N}][\p{L}\p{N}._\- ]{1,127}$`） |
| `clientId`                | string?        | 客户 id                                             |
| `title`                   | string         | 案件名                                              |
| `status`                  | enum           | 见下                                                |
| `sensitivity`             | enum           | `normal` / `high` / `restricted`                    |
| `ownerLawyerId`           | string?        | 承办律师                                            |
| `primaryAssistantRoleId`  | string?        | 主责岗位                                            |
| `strategyStatus`          | enum           | `missing` / `draft` / `approved` / `stale`          |
| `openQuestionIds`         | string[]       | 未决问题 id                                         |
| `nextActions`             | string[]       | 下一步                                              |
| `deadlineIds`             | string[]       | 关联期限                                            |
| `deliverableIds`          | string[]       | 关联交付物                                          |
| `queueItemIds`            | string[]       | 关联待办                                            |
| `matterKind`              | enum?          | `contract` / `litigation` / `general`               |
| `practiceTags`            | string[]?      | 业务标签（**≤12 由 API 层限**，见下）               |
| `causeOfAction`           | string?        | 案由（≤200）                                        |
| `counterparty`            | string?        | 对方当事人（≤200）                                  |
| `parties`                 | MatterParty[]? | 当事人（≤32）                                       |
| `docket`                  | MatterDocket?  | 案号法院等                                          |
| `createdAt` / `updatedAt` | string?        | 时间戳                                              |

**`status` 七态**：`intake`（收案）、`active`（进行中）、`waiting_on_client`（等客户）、`waiting_on_firm`（等所内）、`under_review`（审核中）、`delivered`（已交付）、`closed`（已结案）。

**重要**：`core/contracts.ts` 里的 `Matter` 类型**没有** `causeOfAction` / `counterparty` / `parties` 三个字段，而 `MatterRecord` 有。也就是说这三个字段是后来加的，只在 storage 那一层。读代码时注意别以为它们不存在。

**还有一处分层要看清**：`practiceTags` 的「≤12」**不在 storage schema 里**——`schemas.ts` 与 `schema.ts` 都只写了 `z.array(z.string()).optional()`，没设上限。真正的 12 来自 API 边界（`platform/local-api-schemas.ts`：每条 `max(40)`、数组 `max(12)`）。所以**绕过 API 直接写 `matter.json` 可以塞进去超过 12 个标签**，storage 层不拦。这类「约束在哪个层」的差别，正是本章开头说的两套 schema 不一致的延伸。

## 28.2 当事人与案号

### `MatterParty`

| 字段             | 说明                                                      |
| ---------------- | --------------------------------------------------------- |
| `partyId`        | 1–64 字符                                                 |
| `name`           | 1–120                                                     |
| `role`           | `client` / `counterparty` / `agent` / `counsel` / `other` |
| `standing`       | 诉讼地位（≤40），比如「原告」「被告」                     |
| `serviceAddress` | 送达地址（≤200）                                          |
| `serviceMethod`  | `mail` / `electronic` / `in_person` / `unknown`           |

上限 32 人（第 7 章讲过为什么从 8 改到 32）。

### `MatterDocket`

| 字段          | 说明                     |
| ------------- | ------------------------ |
| `caseNo`      | 案号                     |
| `court`       | 法院                     |
| `instance`    | 审级                     |
| `standing`    | 诉讼地位                 |
| `hearingAt`   | 开庭时间                 |
| `claimAmount` | 标的额（自由文本，≤120） |

`claimAmount` 是**文本**不是数字——因为标的额经常写成「约 200 万元」这种形式。

## 28.3 交付物（`DeliverableRecord`）

存 `matters/<id>/deliverables/<id>.json`。

| 字段                                                          | 说明                                                                                                                                  |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `deliverableId`                                               | id                                                                                                                                    |
| `matterId`                                                    | 所属案件                                                                                                                              |
| `taskId`                                                      | 关联任务                                                                                                                              |
| `kind`                                                        | `legal-memo` / `contract-review` / `demand-letter` / `litigation-outline` / `client-brief` / `evidence-timeline` / `general-document` |
| `audience`                                                    | `internal` / `client` / `counterparty` / `court` / `unknown`                                                                          |
| `status`                                                      | 八态生命周期                                                                                                                          |
| `templateId`                                                  | 模板                                                                                                                                  |
| `currentDraftTaskId`                                          | 当前草稿                                                                                                                              |
| `currentReviewStatus`                                         | `pending` / `approved` / `rejected` / `modified` / `redacted`                                                                         |
| `ownerLawyerId` / `reviewerId` / `approvedBy` / `deliveredBy` | 各环节责任人                                                                                                                          |
| `deliveredAt`                                                 | 交付时间                                                                                                                              |
| `blockingReasons`                                             | 阻塞原因数组                                                                                                                          |
| `createdAt` / `updatedAt`                                     | —                                                                                                                                     |

**两个 schema 有细微差异**：`schema.ts` 的 `currentReviewStatus` 允许 `redacted`，而 `schemas.ts` 的不允许。这是历史遗留的不一致，读代码时以用了哪个 schema 为准。

`blockingReasons` 的三种取值（`buildDeliverableFromDraft` 里给）：`awaiting_review`（等审核）、`rejected_by_reviewer`（被驳回）、`changes_requested`（要求修改）。

## 28.4 审批（`ApprovalRecord`）

存 `approvals.jsonl`（追加 + 条件重写）。

| 字段                        | 说明                                                  |
| --------------------------- | ----------------------------------------------------- |
| `approvalId`                | id                                                    |
| `matterId`                  | 案件                                                  |
| `deliverableId`             | 关联交付物                                            |
| `requestedBy`               | 请求者                                                |
| `requestedRole`             | 请求者岗位                                            |
| `targetRole`                | **目标角色**（第八期起加，「明确委派的目标角色」）    |
| `requestedAt`               | 请求时间                                              |
| `reason`                    | 理由                                                  |
| `riskLevel`                 | low / medium / high                                   |
| `status`                    | `pending` / `approved` / `rejected` / `needs_changes` |
| `resolvedBy` / `resolvedAt` | 处理人与时间                                          |

**`targetRole` 让审批可以指定「由谁批」**，而不只是「谁来批都行」。

审批的**统一视图**（`UnifiedApprovalItem`，`GET /api/approvals` 返回）字段不同：`{id, kind, title, summary, matterId?, sessionId?, toolName?, toolArgs?, riskLevel, createdAt, expiresAt, decisions}`，其中 `kind` 是 `tool_approval` / `matter_approval`，有效期 24 小时。

## 28.5 待办队列（`QueueItemRecord`）

存 `queue.jsonl`。

| 字段                                     | 说明                                                |
| ---------------------------------------- | --------------------------------------------------- |
| `queueItemId` / `matterId`               | id                                                  |
| `kind`                                   | 九种（见下）                                        |
| `status`                                 | `open` / `in_progress` / `resolved` / `dismissed`   |
| `priority`                               | `low` / `normal` / `high` / `critical`              |
| `title` / `detail`                       | 内容                                                |
| `relatedTaskId` / `relatedDeliverableId` | 关联                                                |
| `dependsOn`                              | 前置待办 id 数组                                    |
| `blockedBy`                              | **schema 里有，但没有写入者**                       |
| `blockedReason`                          | 被挡原因（`dependsOn` 未完成时自动算）              |
| `phase`                                  | `plan` / `research` / `draft` / `review` / `render` |
| `createdAt` / `updatedAt`                | —                                                   |

**九种 `kind`**：`need_client_input`、`need_evidence`、`need_conflict_check`、`need_lawyer_review`、`need_partner_approval`、`ready_to_draft`、`ready_to_render`、`blocked_by_deadline`、`blocked_by_missing_strategy`。

## 28.6 期限（`DeadlineRecord`）

存 `deadlines.jsonl`。

| 字段                      | 说明                                                                               |
| ------------------------- | ---------------------------------------------------------------------------------- |
| `deadlineId` / `matterId` | id                                                                                 |
| `title`                   | 名称                                                                               |
| `dueAt`                   | 到期时间（ISO）                                                                    |
| `severity`                | `soft` / `hard` / `critical`（开庭默认 `hard`）                                    |
| `source`                  | `manual` / `case_memory` / `project_file` / `calendar_import` / `document_extract` |
| `status`                  | `open` / `snoozed` / `completed` / `missed`                                        |
| `notes`                   | 备注                                                                               |
| `eventKind`               | `hearing` / `filing` / `limitation` / `reply` / `preservation` / `custom`          |
| `remindBeforeHours`       | 提前提醒小时数（0–720）                                                            |
| `icsUid`                  | 导出的 UID                                                                         |
| `remindedAt`              | 已提醒时间戳                                                                       |
| `dependsOnDeadlineId`     | 前置期限（只有一个）                                                               |

**注意 `source` 是五态**，而界面上的标签是另外一套（律师手记 / 本案档案 / 卷宗文件 / 日历导入 / 传票抽取）。

## 28.7 会话（`AgentSession`）

存 `sessions/<id>.json`。

| 字段                                     | 说明                   |
| ---------------------------------------- | ---------------------- |
| `sessionId`                              | id                     |
| `title`                                  | 标题                   |
| `matterId`                               | 关联案件               |
| `actorId`                                | 操作者                 |
| `assistantId`                            | 助手                   |
| `turns`                                  | 回合数组               |
| `conversationHistory`                    | 消息历史               |
| `pendingClarificationKeys`               | 待澄清的键             |
| `pendingRequiresAction`                  | 待办动作               |
| `alreadySurfacedMemoryPaths`             | 已提示过的记忆路径     |
| `collaborationDelegationId`              | 关联委派               |
| `lastSessionSummaryTurnCount`            | 上次摘要时的回合数     |
| `needsCompactReinjection`                | 需要重注红线           |
| `disclosedToolNames`                     | 本会话已披露的工具     |
| `lastCompactBoundary`                    | 最近压缩边界           |
| `planHandoff`                            | 计划交接               |
| `turnPlan`                               | 当前计划               |
| `worldStateBaseline` / `worldStateEpoch` | 世界状态基线           |
| `legacyUpdateDraftBodyWarning`           | 历史遗留警告           |
| `lastConfirmedAnswers`                   | 上次已确认的答案       |
| `samplingPromptTail`                     | 采样提示尾             |
| `lastBoundCapabilityId`                  | 上次绑定的能力         |
| `forkedTo` / `carriedOverFrom`           | 分叉关系（含 `nonce`） |

**几个字段的用途**：

- `disclosedToolNames` 是「渐进披露」的持久化（第 3 章）。
- `worldStateEpoch` 每次中途钉选递增，用来判断缓存是否有效。
- `forkedTo.nonce` 让承前分叉幂等（同一 `clientNonce` 不重复分叉）。
- `needsCompactReinjection` 是压缩后要重注红线的标记。

## 28.8 回合（`AgentTurn`）

| 字段                        | 说明               |
| --------------------------- | ------------------ |
| `turnId` / `sessionId`      | id                 |
| `instruction`               | 指令               |
| `messages`                  | 消息               |
| `toolCallsExecuted`         | 已执行的工具调用数 |
| `toolNameCallCounts`        | 各工具调用次数     |
| `status`                    | 见下               |
| `clarificationQuestions`    | 待澄清问题         |
| `executionState`            | 执行状态           |
| `gateDecisions`             | 门禁决定           |
| `sameTurnVerify`            | 同回合验证         |
| `contextDeferralBounces`    | 上下文让渡次数     |
| `requiresAction`            | 需要律师动作       |
| `pendingToolApproval`       | 待审批的工具       |
| `result`                    | 结果               |
| `error`                     | 错误               |
| `modelUsage`                | 模型用量           |
| `startedAt` / `completedAt` | —                  |

**`status` 七态**：`running`、`completed`、`awaiting_approval`、`awaiting_clarification`、`paused`、`interrupted`、`error`。

注意 `interrupted` 是**读取时的视图**，不是落盘的原始状态——它表示「这是一个孤儿占位轮次」（进程崩了留下的）。

## 28.9 消息（`AgentMessage`）

| 字段                | 说明                                     |
| ------------------- | ---------------------------------------- |
| `role`              | `system` / `user` / `assistant` / `tool` |
| `content`           | 内容                                     |
| `toolCalls`         | 工具调用                                 |
| `toolCallResponses` | 工具结果                                 |
| `timestamp`         | 时间                                     |
| `hiddenFromLawyer`  | 是否对律师隐藏                           |
| `liveTrace`         | 实时轨迹                                 |
| `executionState`    | 执行状态                                 |
| `turnPlan`          | 计划                                     |

**`hiddenFromLawyer` 是「隐藏消息」的标记**——比如上下文让渡的回弹、同回合验证的说明都带这个标记，回合结束时会被清理掉。

有个辅助函数 `isLawyerVisibleChatMessage` 专门判断一条消息该不该给律师看。

## 28.10 工具定义（`ToolDefinition`）

| 字段                | 说明                                                                              |
| ------------------- | --------------------------------------------------------------------------------- |
| `name`              | 名字                                                                              |
| `description`       | 说明                                                                              |
| `category`          | `search` / `analyze` / `draft` / `matter` / `review` / `system` / `collaboration` |
| `parameters`        | 参数 schema                                                                       |
| `requiresApproval`  | 是否要审批                                                                        |
| `riskLevel`         | low / medium / high                                                               |
| `isConcurrencySafe` | 能否并发                                                                          |
| `approvalTemplate`  | 审批卡模板                                                                        |

参数 schema（`ToolParameterSchema`）：`{type, description, required?, enum?, items?}`。

工具结果（`ToolCallResult`）：`{ok, data?, error?, approvalRequest?, sandboxed?, aborted?, timedOut?}`。

## 28.11 检索（`ResearchBundle`）

| 字段               | 说明                           |
| ------------------ | ------------------------------ |
| `taskId` / `query` | —                              |
| `sources`          | 来源数组                       |
| `claims`           | 结论数组（每条带 `sourceIds`） |
| `riskFlags`        | 风险标记（不得省略）           |
| `missingItems`     | 缺失项                         |
| `requiresReview`   | 是否需要审核                   |
| `completedAt`      | —                              |

来源（`ResearchSource`）：`{id, title, kind, citation?, url?, date?, court?, caseNumber?, demo?, provider?, corpusId?, licenseNote?}`。

`kind` 八种：`statute`、`regulation`、`case`、`memo`、`contract`、`web`、`workspace`、`unknown`。

结论（`ResearchClaim`）：`{text, sourceIds, confidence, model, demo?}`，`model` 是 `general` / `legal`。

## 28.12 记忆采纳（`MemoryAdoptionRecord`）

存 `memory-adoption/suggestions.jsonl`。

| 字段           | 说明                                                                   |
| -------------- | ---------------------------------------------------------------------- |
| `id`           | id                                                                     |
| `createdAt`    | 创建时间                                                               |
| `state`        | `pending` / `adopted` / `auto_adopted` / `dismissed` / `recorded_noop` |
| `scope`        | 八个作用域之一                                                         |
| `kind`         | 16 种之一                                                              |
| `targetId`     | 目标对象 id                                                            |
| `payload`      | 内容                                                                   |
| `sourceTaskId` | 来源任务                                                               |
| `origin`       | `engine` / `lawyer` / `agent` / `migration` / `external`               |
| `note`         | 备注                                                                   |
| `noopReason`   | 没落盘的原因                                                           |
| `resolvedAt`   | 处理时间                                                               |

**八个 `scope`**：`firm`、`lawyer`、`client`、`matter`、`playbook`、`opponent`、`project`、`assistant`。

**16 种 `kind`**：`case.core_issue`、`case.risk_note`、`case.task_goal`、`case.progress`、`case.artifact`、`playbook.clause_learning`、`lawyer.profile_learning`、`assistant.profile_section`、`firm.preference`、`client.profile_note`、`opponent.note`、`project.note`、`historical.knowledge`、`lawyer.habit_pattern`、`review_label`、`source.annotation`。

## 28.13 立场（`StanceItem`）

存 `lawmind/stance/items.json`。

| 字段                         | 说明                                                   |
| ---------------------------- | ------------------------------------------------------ |
| `id`                         | `st_<uuid>`                                            |
| `clauseType`                 | 七种条款类型之一                                       |
| `family`                     | `sale` / `loan` / `general`                            |
| `position`                   | 一句话立场（`preferredLanguage` 前 80 字）             |
| `preferredLanguage`          | 偏好措辞（≤240）                                       |
| `rationale` / `statuteBasis` | 理由与法条依据                                         |
| `source`                     | `redline` / `habit_adopt` / `manual` / `revision_pack` |
| `confidence`                 | 置信度                                                 |
| `occurrences`                | 出现次数                                               |
| `evidence`                   | 证据账本（≤50 条）                                     |
| `createdAt` / `updatedAt`    | —                                                      |
| `supersededBy`               | 被谁取代                                               |

**七种条款类型**：`管辖`、`违约金`、`保密`、`赔偿`、`定金`、`知识产权`、`其他`。

**证据条目**（`StanceEvidenceEntry`）：`{source, at, matterId?}`。

## 28.14 委派（`DelegationRecord`）

存 `delegations/<id>.json`。

| 字段                                        | 说明                                 |
| ------------------------------------------- | ------------------------------------ |
| `delegationId`                              | id                                   |
| `fromAssistantId` / `toAssistantId`         | 从谁到谁                             |
| `task`                                      | 任务                                 |
| `matterId`                                  | 案件                                 |
| `parentSessionId`                           | 父会话                               |
| `priority`                                  | `normal` / `high` / `low`            |
| `status`                                    | 七态（含 `completed_after_timeout`） |
| `targetSessionId`                           | 目标会话                             |
| `result` / `resultPath` / `resultTruncated` | 结果                                 |
| `error`                                     | 错误                                 |
| `depth`                                     | 深度                                 |
| `startedAt` / `completedAt`                 | —                                    |

## 28.15 工作流（`CollaborationWorkflow`）

| 字段                                  | 说明                                                       |
| ------------------------------------- | ---------------------------------------------------------- |
| `workflowId` / `name` / `description` | —                                                          |
| `matterId`                            | 案件                                                       |
| `steps`                               | 步骤数组                                                   |
| `status`                              | `draft` / `running` / `completed` / `failed` / `cancelled` |
| `createdBy`                           | 创建者                                                     |
| `preApproveToolNames`                 | 预批准工具                                                 |
| 时间戳                                | —                                                          |

步骤（`WorkflowStep`）：`{stepId, assignee, assigneeRoleId?, task, dependsOn[], reviewBy?, autoApprove, status, delegationId?, result?, error?, startedAt?, completedAt?}`。

步骤状态五态：`pending` / `running` / `completed` / `failed` / `skipped`。

## 28.16 后台任务（`WorkflowJobRecord`）

存 `lawmind/jobs/<jobId>.json`。

| 字段                           | 说明                                                                      |
| ------------------------------ | ------------------------------------------------------------------------- |
| `jobId`                        | id（安全单段）                                                            |
| `kind`                         | 固定 `workflow_run`                                                       |
| `status`                       | `scheduled` / `queued` / `running` / `completed` / `failed` / `cancelled` |
| `workflowId` / `matterId`      | —                                                                         |
| `workspaceDir`                 | **不出现在对外视图里**                                                    |
| `idempotencyKey`               | **不出现在对外视图里**                                                    |
| `scheduledTrigger`             | `{runAt, source: "local_schedule"}`                                       |
| `workflowSnapshot`             | 流程快照（执行前删除）                                                    |
| `templateId` / `workflowVars`  | 模板与变量                                                                |
| `createdByAssistantId`         | 创建者                                                                    |
| `memoryBundleSnapshot`         | 记忆快照（第 16 章）                                                      |
| `progress` / `cancelRequested` | 进度与取消标记                                                            |
| `result` / `error`             | 结果与错误                                                                |

对外视图（`PublicWorkflowJob`）**去掉三个字段**：`workspaceDir`、`idempotencyKey`、`workflowSnapshot`。这是刻意的信息收窄。

## 28.17 自动办件（`LawyerAutomation`）

存 `lawmind/automations/<id>.json`。字段见第 17 章。

关键字段回顾：`presetId`、`schedule`（四种）、`expectedResult`、`approvalBoundary`、`missingDataPolicy`（三态）、`notifyPolicy`（三态）、`allowSendEmailAfterApproval`、`notifyEmail`。

## 28.18 三个「状态机」速查

| 对象          | 状态                                                                                                          |
| ------------- | ------------------------------------------------------------------------------------------------------------- |
| 交付物        | `planned` → `drafting` → `pending_review` → `approved` → `rendered` → `delivered` → `learned`，加 `blocked`   |
| 审批          | `pending` → `approved` / `rejected` / `needs_changes`                                                         |
| 待办          | `open` / `in_progress` / `resolved` / `dismissed`                                                             |
| 期限          | `open` / `snoozed` / `completed` / `missed`                                                                   |
| 回合          | `running` / `completed` / `awaiting_approval` / `awaiting_clarification` / `paused` / `interrupted` / `error` |
| 后台任务      | `scheduled` / `queued` / `running` / `completed` / `failed` / `cancelled`                                     |
| 委派          | `pending` / `running` / `completed` / `failed` / `timeout` / `cancelled` / `completed_after_timeout`          |
| 记忆采纳      | `pending` / `adopted` / `auto_adopted` / `dismissed` / `recorded_noop`                                        |
| 工作流步骤    | `pending` / `running` / `completed` / `failed` / `skipped`                                                    |
| Word 插件请求 | `queued` / `running` / `ready` / `failed` / `stale` / `superseded` / `needs_matter`（旧）                     |
| 类案就绪      | `sample-ready` / `configured` / `unset` / `invalid` / `unimplemented`                                         |
| 伦理墙        | `clear` / `hold` / `disclosed`                                                                                |

## 28.19 已知坑（本章相关）

- **两套 schema 有细微不一致**（`schema.ts` vs `schemas.ts`），`currentReviewStatus` 的 `redacted` 就是一例。
- **`MatterRecord` 比 `Matter` 类型多了三个字段**（`causeOfAction` / `counterparty` / `parties`）。
- **`QueueItemRecord.blockedBy` 没有写入者。** 读取时会看它，但没人写。
- **`AgentTurn.status` 的 `interrupted` 是读取时的视图。**
- **`hiddenFromLawyer` 的消息是内部用的**，回合结束会清理。
- **`PublicWorkflowJob` 刻意去掉了三个字段。** 写导出功能时注意。
- **委派结果太大会溢出到文件。** 读的是 `result` + `resultPath` 两处。
- **`stance.confidence` 不是直接存的**——它是从证据按 `1 − Π(1−w)` 算出来的。
- **`matter.json` 的 `claimAmount` 是文本不是数字。**
