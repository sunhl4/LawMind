# 第 45 章 实现精读：案件与工作台

这一章讲 `desk/`、`cases/`、`application/` 三个目录。它们合起来构成「案件的数据与日常工作面」。

## 45.1 `desk/`（20 个文件）

`desk/` 是工作台这一面的实现：今日一屏、计划、期限、谈话、材料、当事人、相似案件。

### 今日与计划

**`today-work.ts`** —— 只导出 `buildTodayWorkSnapshot` 与四个类型（`TodayWorkItemKind`、`TodayWorkItem`、`TodayWorkSnapshot`）。

它是「今日一屏」的唯一入口，四块拼装（律师计划 + 待回邮件 + 期限 + 待审批）。**纯读，不写文件、不扫审计**。

**`daily-plan.ts`** —— 导出最多的一批：

| 类别     | 导出                                                                             |
| -------- | -------------------------------------------------------------------------------- |
| 常量     | `DAILY_PLAN_REL`、`CARRY_LOOKBACK_DAYS = 14`、`CARRY_SNAPSHOT_CAP = 8`           |
| 日期工具 | `localDateKey`、`isLocalDateKey`、`shiftLocalDateKey`                            |
| 读写     | `dailyPlanPath`、`loadDailyPlan`、`saveDailyPlan`、`appendDailyPlanItems`        |
| 结转     | `listOpenLawyerPlanItemsBefore`、`findDailyPlanItemDate`、`CarriedDailyPlanItem` |
| 完成     | `setDailyPlanItemDone`、`markDailyPlanSourceDone`                                |
| 类型     | `DailyPlanItemSource`、`DailyPlanItem`、`DailyPlan`                              |

**`markDailyPlanSourceDone`**：它处理「由来源反向勾完成」——期限办完了，把计划里对应那条也勾掉。来源三种：`mail` / `deadline` / `approval`。

### 期限（4 个文件）

**`deadline-chain.ts`** —— 期限链与律师可见的来源标签：

`DEADLINE_SOURCE_LABELS`、`deadlineSourceLabel`、`isAppealLimitation`、`wouldCreateDeadlineCycle`、`sanitizeDeadlineDependsOn`、`isDeadlineReleased`、`deadlineWaitingOnTitle`、`suggestDependsOnDeadlineId`、`annotateDeskDeadline(s)`、类型 `DeadlineChainFields` / `DeskDeadlineView`。

| 函数                        | 作用                                                                        |
| --------------------------- | --------------------------------------------------------------------------- |
| `isAppealLimitation`        | 判是不是上诉/再审这类不可变期间（正则含「上诉\|再审\|不变期间\|法定期间」） |
| `wouldCreateDeadlineCycle`  | 加依赖前查环                                                                |
| `sanitizeDeadlineDependsOn` | 清理非法依赖（自依赖、跨案件等）                                            |
| `isDeadlineReleased`        | 前置完成没                                                                  |
| `annotateDeskDeadline`      | 把记录变成界面用的 view（加 `sourceLabel`、`released`、`waitingOnTitle`）   |

**`deadline-remind.ts`** —— 只导出 `processDueDeadlineReminders`。它是定时 tick 的一环，把提醒写进收件箱并打 `remindedAt`。

**`deadline-ics.ts`** —— `deadlineIcsUid`、`formatDeadlinesIcs`。

**`legal-event-extract.ts`** —— `extractLegalEvents`、`defaultRemindBeforeHours`、`LEGAL_EVENT_KINDS`、`LEGAL_EVENT_KIND_LABELS`、类型。

### 谈话与写穿（3 个文件）

**`intake-brief.ts`** —— 结构化摘要：`parseIntakeBrief`、`loadIntakeBrief`、`saveIntakeBrief`、`confirmIntakeBrief`、`compileIntakeBrief`、类型 `IntakeBrief`。

**`intake-promote.ts`** —— 写穿：`extractPartyCandidates`、`planIntakePromotion`、`isKnownPartyRole`、类型 `IntakePartyCandidate` / `PromoteIntakeResult`。

**`desk-apply.ts`** —— **「对话写穿」的统一实现**：

| 导出                        | 作用                  |
| --------------------------- | --------------------- |
| `applyLegalEvents`          | 落期限                |
| `applyIntakeBrief`          | 落谈话摘要并写穿      |
| `compileAndSaveIntakeBrief` | 整理 + 保存           |
| `applyMatterProfile`        | 改卷宗字段            |
| `createMatterFromIntake`    | 从谈话建案            |
| `revertDeskWrite`           | 撤销一次写入          |
| `eventsFromExtracted`       | 抽取结果 → 可落盘事件 |

**为什么它重要**（注释原文的意思）：**HTTP 确认与 agent 工具调用的是同一批函数**。这是「对话补档案」能和工作台保持一致的原因。

**`desk-write-journal.ts`** —— 撤销的底座：`appendDeskWrite`、`loadDeskWrite`、`listDeskWrites`、`newDeskWriteId`、`DESK_WRITE_KINDS`、类型。

六种写入类型：`legal_events`、`intake_brief`、`matter_profile`、`create_matter`、`organize_files`、`file_ops`。

### 材料与当事人

**`matter-materials.ts`** —— `listMatterMaterialFiles`、`matterMaterialsDir`、`MATTER_MATERIALS_LIST_CAP = 80`、`MATTER_MATERIALS_WALK_CEILING = 4000`、`MATTER_MATERIALS_MAX_FILE_BYTES`。

**`matter-parties.ts`** —— 导出最多的一处：

`MATTER_PARTIES_CAP = 32`、`MATTER_PARTY_ROLES`、`MATTER_PARTY_SERVICE_METHODS`、`MATTER_PARTY_ROLE_ZH`、`MATTER_PARTY_SERVICE_ZH`、`normalizeMatterParties`、`hydrateMatterParties`、`deriveMatterIdentity`、`syncLegacyIdentityIntoParties`、`matterPartyEditorDrafts`、`formatPartyServiceLine`、`matterPartyIdentityNames`。

**`hydrateMatterParties` 与 `syncLegacyIdentityIntoParties`** 处理「老数据只有 `counterparty` 单字段、新数据有 `parties` 数组」的兼容。

**`desk-material-text.ts`** —— 只导出 `readDeskMaterialText`：读 PDF/图片/文本（走 OCR 或视觉兜底）。

### 案件门类与驾舱

**`matter-kind.ts`** —— `MATTER_KINDS`、`MATTER_KIND_LABELS`、`inferMatterKind`、`parseMatterKind`、`parseMatterDocket`、`parsePracticeTags`、类型。

**`matter-pulse.ts`** —— 驾舱数据：`buildMatterPulse`、`assembleMatterTimeline`、`hearingCountdownLabel`、`MATTER_STATUS_LABELS`、`MATTER_TIMELINE_CAP = 24`、`daysUntilIso`、类型。

**`similar-cases.ts`** —— 只导出 `listSimilarCasesForDesk` 与类型。注意它的结果带 `displayWarning`（「旧案事实不得写入本案」）。

### 其他

**`mail-triage.ts`** —— 邮件分诊：`classifyMailMessage`、`MAIL_TRIAGE_LABELS`、`MAIL_TRIAGE_LABEL_ZH`、类型。

**`cause-lexicon.ts`** —— 案由词表：`loadCauseLexicon`、`saveCauseLexicon`、`suggestCauseCandidates`、`CAUSE_LEXICON_REL`、`DEFAULT_CAUSE_LEXICON`、类型。

**`seed-sample-desk.ts`** —— 演示数据：`seedSampleDesk`、三个 `SAMPLE_*_MATTER_ID`、`localStamp`。

## 45.2 `cases/`（10 个文件）

`cases/` 负责**聚合读**：把 CASE.md、任务、草稿、审计拼成索引与总览。

### `index.ts`

只导出六个：`buildMatterIndex`、`listMatterIds`、`buildMatterOverview`、`buildMatterOverviewLite`、`listMatterOverviews`、`summarizeMatterIndex`、`searchMatterIndex`。

**两个「build」的分工**：

| 函数                      | 扫什么                                                        |
| ------------------------- | ------------------------------------------------------------- |
| `buildMatterIndex`        | CASE.md + 任务 + 草稿 + **审计（最近 120 天、最多 8000 条）** |
| `buildMatterOverviewLite` | 只读 CASE + 任务，**不扫审计**                                |

「Lite」是为了「打开要快」——列表页用它。

`listMatterIds` 是**三个来源的并集**：storage ids + `cases/` 目录名 + 任务的 `matterId`，再减去临时会议那个假 id。

### 其余文件

| 文件                     | 导出                                                                                                                                                                                                              |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `matter-create.ts`       | `createMatterIfAbsent`、`CreateMatterResult`（幂等；委托给 `ensureMatterWithProjection`）                                                                                                                         |
| `matter-id.ts`           | `MATTER_ID_PATTERN`、`isValidMatterId`、`parseOptionalMatterId`                                                                                                                                                   |
| `matter-label.ts`        | `isMatterDisplayPlaceholder`、`suggestMatterIdForImport`、`displayNameFromImportBasename`、`parseMatterDisplayNameFromCase`、`resolveMatterSidebarLabel`、`resolveMatterHeadline`、`formatTaskLineForNextActions` |
| `matter-profile.ts`      | `parseMatterCaseProfileFields`、`buildMatterProfileView`、类型                                                                                                                                                    |
| `task-display.ts`        | `shortTaskIdForDisplay`、`taskProgressPrefix`                                                                                                                                                                     |
| `team-meeting.ts`        | 会议记录读写（第 16 章）                                                                                                                                                                                          |
| `team-meeting-ids.ts`    | `ADHOC_MEETING_MATTER_ID`、`isAdhocMeetingMatterId`、类型                                                                                                                                                         |
| `team-roster.ts`         | `readTeamRoster`、`writeTeamRoster`、`emptyTeamRoster`、`TEAM_ROSTER_VERSION`                                                                                                                                     |
| `workspace-node-role.ts` | `readCaseSubdirRole`、`writeCaseSubdirRole`、`LAWMIND_CASE_SUBDIR_ROLE_FILE`                                                                                                                                      |

**`matter-label.ts` 的几个「resolve」**处理的是展示名：没设展示名时怎么从 CASE.md 或文件名推一个体面的标签。

## 45.3 `application/`（15 个文件）

`application/` 是**写侧服务层**。核心约定（第 7 章）：service 层不直接碰 fs，全部走 storage adapter。

### 五个写服务

| 文件                               | 导出                                                                                                                                                                                                                    | 管什么                |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| `services/matter-write-service.ts` | `createMatterIfMissing`、`updateMatterProfile`、`updateMatterStatus`、`setMatterStrategy`、`attachDeliverableId`、`attachQueueItemId`、`attachDeadlineId`、`detachDeadlineIds`、`drainMatterProjections`                | `matter.json`         |
| `services/deliverable-service.ts`  | `createPlannedDeliverable`、`transitionDeliverable`、`linkDraftToDeliverable`、`applyDeliverableReviewStamp`、`syncDraftReviewStatusFromDeliverable`、`reopenDeliverableReviewStamp`、`isDeliverableReviewStampCurrent` | `deliverables/*.json` |
| `services/approval-service.ts`     | `requestApproval`、`listPendingApprovals`、`listApprovals`、`resolveApproval` + 四个结果类型                                                                                                                            | `approvals.jsonl`     |
| `services/queue-write-service.ts`  | `openQueueItem`、`transitionQueueItem`、`listQueueItemsForMatter`                                                                                                                                                       | `queue.jsonl`         |
| `services/deadline-service.ts`     | `recordDeadline`、`recordConfirmedExtractEvents`、`snoozeDeadline`、`completeDeadline`、`removeDeadlines`、`patchDeadline`、`listDeadlinesForMatter`、`listDeskDeadlines`                                               | `deadlines.jsonl`     |

**`deliverable-service` 那三个「stamp」函数值得单独理解**（注释里都写了理由）：

| 函数                                   | 为什么存在                                                                  |
| -------------------------------------- | --------------------------------------------------------------------------- |
| `applyDeliverableReviewStamp`          | 终态审核印记（approved/rejected）不能被后续漂移的 `draft.reviewStatus` 覆盖 |
| `syncDraftReviewStatusFromDeliverable` | 交付物状态变化时同步回草稿                                                  |
| `reopenDeliverableReviewStamp`         | 「重开审核的对称写口」——签批过的稿子可以退回重审                            |

**`isDeliverableReviewStampCurrent`** 用来判断印记是不是还对应得上当前审核状态。

**`drainMatterProjections`** 处理「投影失败后的重试/补齐」。

### 两个读服务

| 文件                         | 导出                                                                                                  |
| ---------------------------- | ----------------------------------------------------------------------------------------------------- |
| `services/matter-service.ts` | `getMatterReadModel`、`listMatterReadModels`、`listMatterCockpitOverviews`、`getMatterCockpitSummary` |
| `services/queue-service.ts`  | `listApprovalRequests`、`listWorkQueueItems`                                                          |

**读顺序**（注释）：① JSON 真相源 → ② MatterIndex 派生回落。所以老工作区（没有 JSON 真相源）也能用。

### 投影与一致性

| 文件                        | 导出                                                                                                                          | 作用                       |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| `matter-projection.ts`      | `projectMatterToCaseMd`、`upsertMatterCaseProfileBullets`、`matterStatusLabel`、`CASE_CLEARED_PLACEHOLDER`                    | JSON → CASE.md §1          |
| `matter-dual-write.ts`      | `ensureMatterWithProjection`                                                                                                  | 双写入口（建 JSON 再投影） |
| `matter-consistency.ts`     | `checkMatterConsistency`、`checkMatterCaseConsistency`、`repairMatterProjections`、`formatMatterConsistencyReport` + 两个类型 | 查漂移与修                 |
| `task-draft-consistency.ts` | `checkTaskDraftConsistency`、`formatTaskDraftConsistencyReport` + 类型                                                        | 任务↔草稿↔交付物一致性     |
| `domain-state.ts`           | `domainStateModuleMarker`                                                                                                     | 一个标记模块，文档用       |

**`matter-dual-write.ts` 只有一个导出**，因为它的职责单一：确保「建案件时 JSON 与投影都做了」。注释说它存在是为了**避免循环 import**。

**`domain-state.ts` 只有一个导出标记**，它是一份**模块级文档**（说明「域状态」与「Agent 运行时状态」的划分：`tasks/`、`drafts/`、`cases/`、`audit/` 是域状态；`sessions/` 是运行时状态）。

## 45.4 一条完整的数据流（把上面串起来）

以「在对话里说『这个案子案号是 XX』」为例：

```text
① 模型调 update_matter_profile
② 工具实现调 applyMatterProfile（desk/desk-apply.ts）
③ applyMatterProfile 调 updateMatterProfile（application/services/matter-write-service.ts）
④ matter-write-service：
   - 加锁读 matter.json
   - zod 校验
   - 原子写回
   - 异步投影到 CASE.md（失败记 matter.projection_failed）
   - 追加 desk-writes.jsonl（给撤销用）
⑤ 读侧下次打开工作台：
   - listMatterOverviews → buildMatterOverviewLite（快）
   - 打开详情 → getMatterReadModel（含交付物/审批/队列）
```

**每一层都有明确的职责边界**：工具层只管参数与调用、应用层管事务与锁、存储层管 IO。

## 45.5 已知坑（本章相关）

- **`buildMatterIndex` 会扫审计（8000 条上限），`buildMatterOverviewLite` 不扫。** 别在列表页用前者。
- **`listMatterIds` 是三个来源的并集。** 所以「磁盘上没有 `matters/<id>/` 但有 `cases/<id>/`」的案件也会出现。
- **`matter-dual-write.ts` 只有一个函数**，别指望它做更多。
- **`domain-state.ts` 没有运行时逻辑**，只是文档标记。
- **交付物的审核印记不许被覆盖**（`applyDeliverableReviewStamp`）。改交付物服务时注意这条。
- **`drainMatterProjections` 是投影失败的补救路径**，不是主路径。
- **`matter-ops/storage.ts` 绕过这套服务层**（第 7 章那个已知问题）。
- **`desk-apply.ts` 是「对话 = 工作台」的关键**：两边调同一批函数。想加新的写穿能力，加在这里。
