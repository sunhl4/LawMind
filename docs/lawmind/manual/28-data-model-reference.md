# 第 28 章 数据结构详解

这一章列出核心数据结构的字段定义。排查数据问题、写集成、或者想理解「为什么界面这一栏是空的」时，用它对照。

字段名以代码为准（`src/lawmind/adapters/matter-storage/schema.ts`、`core/contracts.ts`、`agent/types.ts`、`src/lawmind/types.ts`、`memory/kernel/contract.ts`）。

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
| `matterKind`              | enum?          | 粗筛：`contract` / `litigation` / `general`         |
| `matterLabel`             | string?        | 模型给出的事项名称（≤80）。粗筛不代替这个名字       |
| `schemaVersion`           | 1?             | 落盘契约版本。旧文件可以没有，下次保存会写上        |
| `revision`                | number?        | 每次保存加一                                        |
| `practiceTags`            | string[]?      | 业务标签（**≤12 由 API 层限**，见下）               |
| `causeOfAction`           | string?        | 案由（≤200）                                        |
| `counterparty`            | string?        | 对方当事人（≤200）                                  |
| `parties`                 | MatterParty[]? | 当事人（≤32）                                       |
| `docket`                  | MatterDocket?  | 案号法院等                                          |
| `createdAt` / `updatedAt` | string?        | 时间戳                                              |

**`status` 七态**：`intake`（收案）、`active`（进行中）、`waiting_on_client`（等客户）、`waiting_on_firm`（等所内）、`under_review`（审核中）、`delivered`（已交付）、`closed`（已结案）。

`causeOfAction` / `counterparty` / `parties` 在 `Matter` 和 `MatterRecord` 上都有。字段只定义在 `schema.ts`，`schemas.ts` 只重新导出旧名字。

`deadlineIds` / `deliverableIds` / `queueItemIds` 在读 `matter.json` 时按子文件重算。磁盘上的那三份数组是缓存，不是真相。`openQuestionIds` 和 `nextActions` 仍由策略写入直接保存。

**还有一处分层要看清**：`practiceTags` 的「≤12」**不在 storage schema 里**——schema 只写了 `z.array(z.string()).optional()`。真正的 12 来自 API 边界（`platform/local-api-schemas.ts`：每条 `max(40)`、数组 `max(12)`）。绕过 API 直接写 `matter.json` 可以塞进超过 12 个标签。

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

上限 32 人（第 7 章讲过为什么从 8 改到 32）。保存档案时超过会拒绝，不再静默截掉后面的人。

利益冲突检索按名字对上跨案当事人：去掉空白，并把「公司 / 有限公司 / 有限责任公司 / 股份有限公司 / 集团公司」这几种末尾组织形式看成同一个名字。短名包含在长名里不算同一个人。命中只提示律师核对，不自动隔离，也不另建联系人档案。

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
| `currentDraftRevision`                                        | 这条稿被重新挂上交付物的次数                                                                                                          |
| `citedSourceIds`                                              | 章节引用过的来源 id                                                                                                                   |
| `documentId`                                                  | 对应 `documents/<id>.json` 的稳定文书号                                                                                               |
| `schemaVersion` / `revision`                                  | 与案件相同的契约版本和保存次数                                                                                                        |
| `currentReviewStatus`                                         | `pending` / `approved` / `rejected` / `modified` / `redacted`                                                                         |
| `ownerLawyerId` / `reviewerId` / `approvedBy` / `deliveredBy` | 各环节责任人                                                                                                                          |
| `deliveredAt`                                                 | 交付时间                                                                                                                              |
| `blockingReasons`                                             | 阻塞原因数组                                                                                                                          |
| `createdAt` / `updatedAt`                                     | —                                                                                                                                     |

`blockingReasons` 的三种取值（`buildDeliverableFromDraft` 里给）：`awaiting_review`（等审核）、`rejected_by_reviewer`（被驳回）、`changes_requested`（要求修改）。

挂上草稿时写入 `documents/<documentId>.json`。有 Word 基线就用那条路径做文书号；没有就用 `drafts/<taskId>.json`。`contentHash` 是标题、摘要和正文章节的 SHA-256。正文没变时版本不增加。正文仍在草稿和原文件里。

结论上的定位在 `ResearchClaim.pin`：`article` / `clause` / `page` / `quote` 至少一项。没有 pin 的结论仍然只有 `sourceIds`。

## 28.4 草稿（`ArtifactDraft`）

存 `drafts/<taskId>.json`（`src/lawmind/types.ts`）。交付物账（28.3）记的是「哪条稿、第几版」，正文在这里。

| 字段                                                        | 说明                                                                             |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `taskId` / `matterId`                                       | 任务 id / 关联案件                                                               |
| `title` / `summary` / `audience`                            | 标题、执行摘要、受众                                                             |
| `output`                                                    | `docx` / `pptx` / `markdown`                                                     |
| `templateId` / `templateVersion`                            | 模板与渲染时解析到的模板 pin                                                     |
| `deliverableType`                                           | 交付物类型（渲染与校验用）                                                       |
| `sections`                                                  | 正文章节：`{heading, body, citations?, provenance?}`                             |
| `reviewNotes`                                               | 律师审阅备注                                                                     |
| `clarificationQuestions` / `acceptanceCriteria`             | 待确认问题与验收标准                                                             |
| `reviewStatus`                                              | 四态：`pending` / `approved` / `rejected` / `modified`                           |
| `reviewedBy` / `reviewedAt` / `outputPath`                  | 审核人、审核时间、渲染产物路径                                                   |
| `hasLegalReasoningSnapshot`                                 | 是否已写推理图侧车                                                               |
| `contractEdit`                                              | 原合同改稿上下文：`{baselineRelativePath, baselineRoot?, mode?, opinionTaskId?}` |
| `contractRevisionCapture` / `contractRevisionAccumulatedId` | 签批后写合同修订积累包的上下文与防重 id                                          |
| `contractReviewEdits`                                       | 结构化「意见 → 修订」交接（find/replace/priority/mode/reason）                   |
| `pairedOpinionSections`                                     | 成套审查换基线前保留的意见稿章节                                                 |
| `rewriteAmplitude`                                          | 最近一次改写幅度质控（字符/段落 delta）                                          |
| `verificationChecklist`                                     | 签批时落盘的律师必核清单                                                         |
| `decisionHeader`                                            | 决策头（改了什么 / 为什么 / 风险 / 可否直接用）                                  |
| `createdAt`                                                 | —                                                                                |

草稿旁边还有一圈**侧车**（不进 `ArtifactDraft` 本体）：检索快照、推理图快照、条款图快照、Guardian 审稿侧车（`drafts/<taskId>.guardian.json`）。排查「导出时被引用门拦住」先看侧车在不在。

## 28.5 审批（`ApprovalRecord`）

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

审批的**统一视图**（`UnifiedApprovalItem`，`GET /api/approvals` 返回）字段不同：`{id, kind, title, summary, matterId?, sessionId?, toolName?, toolArgs?, riskLevel, createdAt, expiresAt, decisions}`，其中 `kind` 是 `tool_approval` / `matter_approval`，`decisions` 固定 `approve` / `reject` / `more_info`，有效期 24 小时。

## 28.6 待办队列（`QueueItemRecord`）

存 `queue.jsonl`。

| 字段                                     | 说明                                                          |
| ---------------------------------------- | ------------------------------------------------------------- |
| `queueItemId` / `matterId`               | id                                                            |
| `kind`                                   | 九种（见下）                                                  |
| `status`                                 | `open` / `in_progress` / `resolved` / `dismissed`             |
| `priority`                               | `low` / `normal` / `high` / `critical`                        |
| `title` / `detail`                       | 内容                                                          |
| `relatedTaskId` / `relatedDeliverableId` | 关联                                                          |
| `dependsOn`                              | 前置待办 id 数组                                              |
| `blockedBy`                              | `dependsOn` 未完成时由 `queue-write-service` 写入，完成后清掉 |
| `blockedReason`                          | 被挡原因（`dependsOn` 未完成时自动算）                        |
| `phase`                                  | `plan` / `research` / `draft` / `review` / `render`           |
| `label`                                  | 模型命名的待办（≤80）。`ready_to_draft` 等 kind 只兼容旧行    |
| `createdAt` / `updatedAt`                | —                                                             |

**九种 `kind`**：`need_client_input`、`need_evidence`、`need_conflict_check`、`need_lawyer_review`、`need_partner_approval`、`ready_to_draft`、`ready_to_render`、`blocked_by_deadline`、`blocked_by_missing_strategy`。

## 28.7 期限（`DeadlineRecord`）

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

### 义务（`ObligationRecord`）

存 `obligations.jsonl`。付款、通知、履约。没有义务就不写。不因为缺金额或读不出数字而拒绝。

| 字段                        | 说明                                     |
| --------------------------- | ---------------------------------------- |
| `obligationId` / `matterId` | id                                       |
| `title`                     | 义务是什么                               |
| `obligor`                   | 由谁履行。不知道就空着                   |
| `amountText`                | 金额原文                                 |
| `amountMinor`               | 能从原文读出的分。约数、万元不写这个字段 |
| `dueAt`                     | 履行时间。没有就空着                     |
| `deadlineId`                | 对应的期限。没有就不挂                   |
| `sourceQuote`               | 材料原句。没有就不编                     |
| `status`                    | `open` / `done` / `waived`               |

律师打开案件时，未了义务出现在本案速览里。自检不拿缺义务拦住交件。

### 审查矩阵批注（`review-matrix-notes.json`）

存 `matters/<id>/review-matrix-notes.json`（`src/lawmind/matter/review-matrix-notes-store.ts`）。案件审查矩阵的批注与「已核对」标记：`notes`（单元格键 → 批注文本）与 `verified`（单元格键 → true）两个字典。存在案件目录里，换机器仍在——不再只放浏览器 localStorage。

## 28.8 会话（`AgentSession`，引擎字段）

这一节起是回合运行时，不是律师打开案件时要维护的档案。排查「为什么这一轮重放不对」再用。

## 28.8.1 会话字段

存 `sessions/<id>.json`。

| 字段                                     | 说明                                     |
| ---------------------------------------- | ---------------------------------------- |
| `sessionId`                              | id                                       |
| `title`                                  | 标题                                     |
| `matterId`                               | 关联案件                                 |
| `folderRel` / `workDir`                  | 文件夹归组与工作区路径（只在新建时写入） |
| `actorId`                                | 操作者                                   |
| `assistantId`                            | 助手                                     |
| `turns`                                  | 回合数组                                 |
| `conversationHistory`                    | 消息历史                                 |
| `pendingClarificationKeys`               | 待澄清的键                               |
| `pendingRequiresAction`                  | 待办动作                                 |
| `alreadySurfacedMemoryPaths`             | 已提示过的记忆路径                       |
| `collaborationDelegationId`              | 关联委派                                 |
| `omitFromChatSwitcher`                   | 协作子回合，不进侧栏会话列表             |
| `lastSessionSummaryTurnCount`            | 上次摘要时的回合数                       |
| `needsCompactReinjection`                | 需要重注红线                             |
| `disclosedToolNames`                     | 本会话已披露的工具                       |
| `lastCompactBoundary`                    | 最近压缩边界                             |
| `planHandoff`                            | 计划交接                                 |
| `turnPlan`                               | 当前计划                                 |
| `worldStateBaseline` / `worldStateEpoch` | 世界状态基线                             |
| `legacyUpdateDraftBodyWarning`           | 历史遗留警告                             |
| `lastConfirmedAnswers`                   | 上次已确认的答案                         |
| `samplingPromptTail`                     | 采样提示尾                               |
| `lastBoundCapabilityId`                  | 上次绑定的能力                           |
| `taskPin`                                | 任务锚点（第一条真实任务指令原文，钉子） |
| `factPin`                                | 事实台账钉子（四类硬事实）               |
| `factorState`                            | 对角因子状态                             |
| `forkedTo` / `carriedOverFrom`           | 分叉关系（含 `nonce`）                   |
| `createdAt` / `updatedAt`                | —                                        |

**几个字段的用途**：

- `disclosedToolNames` 是「渐进披露」的持久化（第 3 章）。
- `worldStateEpoch` 每次中途钉选递增，用来判断缓存是否有效。
- `forkedTo.nonce` 让承前分叉幂等（同一 `clientNonce` 不重复分叉）。
- `needsCompactReinjection` 是压缩后要重注红线的标记。
- `taskPin` / `factPin` 必须**持久化**而不是每次从历史重推：原始发言在第一次压缩后就离开了历史，重推会抓到无关的填充发言并固化下来。钉子的价值就在于「任意次压缩后仍是同一句原文」。

## 28.9 回合（`AgentTurn`）

| 字段                        | 说明                     |
| --------------------------- | ------------------------ |
| `turnId` / `sessionId`      | id                       |
| `instruction`               | 指令                     |
| `messages`                  | 消息                     |
| `toolCallsExecuted`         | 已执行的工具调用数       |
| `toolNameCallCounts`        | 各工具调用次数           |
| `status`                    | 见下                     |
| `clarificationQuestions`    | 待澄清问题               |
| `executionState`            | 执行状态                 |
| `gateDecisions`             | 门禁决定                 |
| `sameTurnVerify`            | 同回合验证               |
| `factorState`               | 与会话同源的对角因子状态 |
| `contextDeferralBounces`    | 上下文让渡次数           |
| `requiresAction`            | 需要律师动作             |
| `pendingToolApproval`       | 待审批的工具             |
| `result`                    | 结果                     |
| `error`                     | 错误                     |
| `modelUsage`                | 模型用量                 |
| `startedAt` / `completedAt` | —                        |

**`status` 七态**：`running`、`completed`、`awaiting_approval`、`awaiting_clarification`、`paused`、`interrupted`、`error`。

注意 `interrupted` 是**读取时的视图**，不是落盘的原始状态——它表示「这是一个孤儿占位轮次」（进程崩了留下的）。

## 28.10 消息（`AgentMessage`）

| 字段                | 说明                                     |
| ------------------- | ---------------------------------------- |
| `role`              | `system` / `user` / `assistant` / `tool` |
| `content`           | 内容                                     |
| `toolCalls`         | 工具调用                                 |
| `toolCallResponses` | 工具结果                                 |
| `timestamp`         | 时间                                     |
| `hiddenFromLawyer`  | 是否对律师隐藏                           |
| `lawyerVisibleText` | 律师原话（气泡显示用，见下）             |
| `reasoningContent`  | 思考轨迹（不进气泡，不作证据）           |
| `liveTrace`         | 实时轨迹                                 |
| `executionState`    | 执行状态                                 |
| `turnPlan`          | 计划                                     |

**`hiddenFromLawyer` 是「隐藏消息」的标记**——比如上下文让渡的回弹、同回合验证的说明都带这个标记，回合结束时会被清理掉。

`lawyerVisibleText` 与 `reasoningContent` 分工：`content` 里混了文件摘录等注入上下文时，气泡只显示 `lawyerVisibleText` 里的律师原话，模型仍看完整 `content`；`reasoningContent` 是留给下一次带工具请求的思考轨迹，不进气泡，也不作证据。

有个辅助函数 `isLawyerVisibleChatMessage` 专门判断一条消息该不该给律师看。

## 28.11 工具定义（`ToolDefinition`）

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

## 28.12 检索（`ResearchBundle`）

| 字段               | 说明                                             |
| ------------------ | ------------------------------------------------ |
| `taskId` / `query` | —                                                |
| `sources`          | 来源数组                                         |
| `claims`           | 结论数组（每条带 `sourceIds`，能对上时带条或页） |
| `riskFlags`        | 风险标记（不得省略）                             |
| `missingItems`     | 缺失项                                           |
| `requiresReview`   | 是否需要审核                                     |
| `completedAt`      | —                                                |

来源（`ResearchSource`）：`{id, title, kind, citation?, excerpt?, url?, date?, court?, caseNumber?, demo?, provider?, corpusId?, licenseNote?}`。`excerpt` 是命中的原文段落，条目核对检查读它——它不是第二段引用格式。

`kind` 八种：`statute`、`regulation`、`case`、`memo`、`contract`、`web`、`workspace`、`unknown`。

结论（`ResearchClaim`）：`{text, sourceIds, confidence, pin?, model, demo?}`。`pin` 只记引用里已经写明的条、款、页或原文片段；对不上所引来源的条号会降级，不靠关键词把整条结论拒掉。`confidence` 是模型判断。`model` 是 `general` / `legal`。

## 28.13 记忆采纳（`MemoryAdoptionRecord`）

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

## 28.14 记忆内核（`MemoryRecord`）

存 `lawmind/memory-kernel.sqlite`（契约在 `src/lawmind/memory/kernel/contract.ts`）。**SQLite 是真相源**，Markdown 与立场 JSON 是给人看的投影和旧数据的导入来源。进提示词的只有：已确认、当前有效、范围匹配、且与本案当事人不冲突的记录。

| 字段                                           | 说明                                                                       |
| ---------------------------------------------- | -------------------------------------------------------------------------- |
| `id`                                           | id                                                                         |
| `kind`                                         | 五种：`habit` / `stance` / `client_note` / `matter_fact` / `playbook_note` |
| `scope` / `scopeId`                            | 四个范围之一（`lawyer` / `client` / `matter` / `firm`）与范围对象 id       |
| `key`                                          | 槽位名（不是质量黑名单，表里没有的键也能写）                               |
| `body`                                         | 正文                                                                       |
| `confirmation`                                 | `pending` / `confirmed` / `dismissed`                                      |
| `validity`                                     | `current` / `superseded` / `revoked`                                       |
| `supersededBy`                                 | 被谁取代                                                                   |
| `sourceMatterId` / `clientId` / `counterparty` | 来源案件、客户、对方当事人（冲突检查用）                                   |
| `sourceTaskId`                                 | 来源任务                                                                   |
| `origin`                                       | 七种来源（见下）                                                           |
| `confidence`                                   | 置信度                                                                     |
| `evidenceMatterIds`                            | 证据案件 id 数组                                                           |
| `createdAt` / `updatedAt` / `revokedAt`        | —                                                                          |

**七种 `origin`**：`lawyer`、`review`、`engine`、`migration`、`stance`、`firm_default`、`consolidation`。

**单槽键**：`stance.*` 与 canonical 习惯键（`habit.voice`、`habit.structure`、`habit.citation`、`habit.redline`、`habit.risk`、`habit.format`、`habit.identity`）在同一范围下只保留一条「当前有效」，新确认会取代旧的；其余键可以并存。

**默认确认态**：`matter_fact` 缺省 `confirmed`（它在记发生过的事，不在主路径上多一次确认），其余 kind 缺省 `pending`。

## 28.15 立场（`StanceItem`）

存 `lawmind/stance/items.json`。

| 字段                         | 说明                                                   |
| ---------------------------- | ------------------------------------------------------ |
| `id`                         | `st_<uuid>`                                            |
| `clauseType`                 | 条款名。常见七种只用于筛选，不是白名单                 |
| `family`                     | `sale` / `loan` / `general`                            |
| `position`                   | 一句话立场（`preferredLanguage` 前 80 字）             |
| `preferredLanguage`          | 标准措辞（≤240）                                       |
| `fallbackLanguage`           | 可接受回退。没有就不编                                 |
| `unacceptableLanguage`       | 绝不接受。没有就不编                                   |
| `rationale` / `statuteBasis` | 理由与法条依据                                         |
| `source`                     | `redline` / `habit_adopt` / `manual` / `revision_pack` |
| `evidenceScore`              | 证据公式分，只用于排序                                 |
| `modelConfidence`            | 模型或律师给出的置信度，有则优先于公式                 |
| `confidence`                 | 当前用于注入的值                                       |
| `occurrences`                | 出现次数                                               |
| `evidence`                   | 证据账本（≤50 条）                                     |
| `createdAt` / `updatedAt`    | —                                                      |
| `supersededBy`               | 被谁取代                                               |

常见条款名是 `管辖`、`违约金`、`保密`、`赔偿`、`定金`、`知识产权`、`其他`。这是筛选用的提示，不是写入白名单。条款可以叫别的名字。注入给模型的是标准、可接受回退、绝不接受；后两档没有就不写。自检只提示，不改稿，也不拦住导出。

**证据条目**（`StanceEvidenceEntry`）：`{source, at, matterId?}`。

## 28.16 委派（`DelegationRecord`）

存 `delegations/<id>.json`。

| 字段                                        | 说明                         |
| ------------------------------------------- | ---------------------------- |
| `delegationId`                              | id                           |
| `fromAssistantId` / `toAssistantId`         | 从谁到谁                     |
| `task`                                      | 任务                         |
| `matterId`                                  | 案件                         |
| `parentSessionId`                           | 父会话                       |
| `priority`                                  | `normal` / `high` / `low`    |
| `status`                                    | 八态（含 `awaiting_lawyer`） |
| `targetSessionId`                           | 目标会话                     |
| `result` / `resultPath` / `resultTruncated` | 结果                         |
| `error`                                     | 错误                         |
| `depth`                                     | 深度                         |
| `startedAt` / `completedAt`                 | —                            |

## 28.17 工作流（`CollaborationWorkflow`）

| 字段                                  | 说明         |
| ------------------------------------- | ------------ |
| `workflowId` / `name` / `description` | —            |
| `matterId`                            | 案件         |
| `steps`                               | 步骤数组     |
| `status`                              | 六态（见下） |
| `createdBy`                           | 创建者       |
| `preApproveToolNames`                 | 预批准工具   |
| 时间戳                                | —            |

**`status` 六态**：`draft` / `running` / `completed` / `failed` / `cancelled` / `awaiting_lawyer`。

步骤（`WorkflowStep`）：`{stepId, assignee, assigneeRoleId?, task, dependsOn[], reviewBy?, autoApprove, status, delegationId?, sessionId?, result?, error?, startedAt?, completedAt?, roleMissNote?, execution?, holdForLawyer?}`。`sessionId` 是子回合会话——律师稍后在「在办」里回答澄清/审批时，靠它把流程接着办完；`holdForLawyer` 是「写出结果后停住，等律师确认再跑后续步骤」。

步骤状态六态：`pending` / `running` / `completed` / `failed` / `skipped` / `awaiting_lawyer`。

## 28.18 后台任务（`WorkflowJobRecord`）

存 `lawmind/jobs/<jobId>.json`。

| 字段                           | 说明                                |
| ------------------------------ | ----------------------------------- |
| `jobId`                        | id（安全单段）                      |
| `kind`                         | 固定 `workflow_run`                 |
| `status`                       | 七态（见下）                        |
| `workflowId` / `matterId`      | —                                   |
| `workspaceDir`                 | **不出现在对外视图里**              |
| `idempotencyKey`               | **不出现在对外视图里**              |
| `scheduledTrigger`             | `{runAt, source: "local_schedule"}` |
| `workflowSnapshot`             | 流程快照（执行前删除）              |
| `templateId` / `workflowVars`  | 模板与变量                          |
| `createdByAssistantId`         | 创建者                              |
| `memoryBundleSnapshot`         | 记忆快照（第 16 章）                |
| `progress` / `cancelRequested` | 进度与取消标记                      |
| `result` / `error`             | 结果与错误                          |

**`status` 七态**：`scheduled` / `queued` / `running` / `completed` / `failed` / `cancelled` / `awaiting_lawyer`。

对外视图（`PublicWorkflowJob`）**去掉三个字段**：`workspaceDir`、`idempotencyKey`、`workflowSnapshot`。这是刻意的信息收窄。

## 28.19 自动办件（`LawyerAutomation`）

存 `lawmind/automations/<id>.json`。字段见第 17 章。

关键字段回顾：`presetId`、`schedule`（四种）、`expectedResult`、`approvalBoundary`、`missingDataPolicy`（三态）、`notifyPolicy`（三态）、`allowSendEmailAfterApproval`、`notifyEmail`。

## 28.20 「状态机」速查

| 对象          | 状态                                                                                                                     |
| ------------- | ------------------------------------------------------------------------------------------------------------------------ |
| 交付物        | `planned` → `drafting` → `pending_review` → `approved` → `rendered` → `delivered` → `learned`，加 `blocked`              |
| 审批          | `pending` → `approved` / `rejected` / `needs_changes`                                                                    |
| 待办          | `open` / `in_progress` / `resolved` / `dismissed`                                                                        |
| 期限          | `open` / `snoozed` / `completed` / `missed`                                                                              |
| 义务          | `open` / `done` / `waived`                                                                                               |
| 回合          | `running` / `completed` / `awaiting_approval` / `awaiting_clarification` / `paused` / `interrupted` / `error`            |
| 后台任务      | `scheduled` / `queued` / `running` / `completed` / `failed` / `cancelled` / `awaiting_lawyer`                            |
| 委派          | `pending` / `running` / `completed` / `failed` / `timeout` / `cancelled` / `awaiting_lawyer` / `completed_after_timeout` |
| 记忆采纳      | `pending` / `adopted` / `auto_adopted` / `dismissed` / `recorded_noop`                                                   |
| 记忆内核      | 确认：`pending` / `confirmed` / `dismissed`；有效：`current` / `superseded` / `revoked`                                  |
| 工作流        | `draft` / `running` / `completed` / `failed` / `cancelled` / `awaiting_lawyer`                                           |
| 工作流步骤    | `pending` / `running` / `completed` / `failed` / `skipped` / `awaiting_lawyer`                                           |
| Word 插件请求 | `queued` / `running` / `ready` / `failed`，加自动取件的三个如实终态 `needs_matter` / `stale` / `superseded`              |
| 类案就绪      | `sample-ready` / `configured` / `unset` / `invalid` / `unimplemented`                                                    |
| 伦理墙        | `clear` / `hold` / `disclosed`                                                                                           |

**`awaiting_lawyer` 是后来统一加的一档**：委派、工作流、工作流步骤、后台任务都有。它表示「子回合停在澄清或批准，等律师处理」——不是失败，也还没办完。终态守卫保证已判 `timeout` 的委派迟到完成时翻成 `completed_after_timeout`，不再翻回 `completed`。

## 28.21 已知坑（本章相关）

- **`deadlineIds` / `deliverableIds` / `queueItemIds` 以子文件为准。** 只改 `matter.json` 里的数组，下次读取会被盖掉。
- **`practiceTags` 的 12 条上限只在 API。** 直接写 `matter.json` 可以超过。
- **`AgentTurn.status` 的 `interrupted` 是读取时的视图。**
- **`hiddenFromLawyer` 的消息是内部用的**，回合结束会清理。
- **`PublicWorkflowJob` 刻意去掉了三个字段。** 写导出功能时注意。
- **委派结果太大会溢出到文件。** 读的是 `result` + `resultPath` 两处。
- **`stance.evidenceScore` 由证据公式算出，只用于排序。** 有 `modelConfidence` 时，注入用后者。
- **`matter.json` 的 `claimAmount` 是文本不是数字。**
- **记忆采纳队列（jsonl）和记忆内核（SQLite）是两套东西。** 前者是「待律师确认的建议」，后者是「已生效的活记忆」；别把 `memory-adoption/suggestions.jsonl` 当成记忆库界面在读的那份。
