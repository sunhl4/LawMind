# 第 43 章 实现精读：`agent/`

这一章逐文件讲 `src/lawmind/agent/` 里的模块。导出符号清单是机械提取的，所以名字准确；语义说明结合了源码注释与调用方。

`agent/` 有 307 个实现文件，其中约 50 个在根目录（其余在 `tools/`、`collaboration/`、`orchestrator/` 子目录，分别在第 23、16 章讲）。

## 43.1 入口与工厂

### `agent-factory.ts`

导出 `createLawMindAgent`、类型 `LawMindAgent`。

**要点**：每次 `chat()` 调用都会**新建一个 `ToolRegistry`**（通过 `createLegalToolRegistry`），然后调 `runTurn`。所以工具表是**每回合重建**的，不是全局单例。

代理对象提供 `newSession` / `getSession` / `listSessions` / `getTurns` / `listTools` / `getConfig` / `getRegistry` / `listDelegations` / `getCollaborationEvents`。

### `index.ts` / `runtime.ts`

两个 barrel。

**`runtime.ts` 不是实现**——它只是重新导出：`runTurn` 来自 `turn-orchestrator.ts`，模型调用与 SSE 解析来自 `runtime-model-call.ts`，参数校验来自 `runtime-tool-validation.ts`。文件头注释说明了这样做的原因：**模型调用与 SSE 只有一份实现，避免漂移**。

读代码时注意：`runtime.ts` 里看到的东西，实现在别处。

### `turn-orchestrator.ts`

只导出 `runTurn`（其余都是内部函数）。

这是全书最重要的一处。读法见第 34.3 节。**注意它的导出面只有一个函数**——意味着所有阶段都是内部实现，不能从外部单独调。

## 43.2 回合的六块配套

### `turn-orchestrator-model-loop.ts`

导出：

| 符号                                                  | 作用                                                                              |
| ----------------------------------------------------- | --------------------------------------------------------------------------------- |
| `resolveStrictUpstreamToolStreaming(hasOnEvent, env)` | 是否开启严格工具流式（`LAWMIND_STRICT_TOOL_STREAM=1`）                            |
| `shouldWarnToolBudget(used, max)`                     | 是否该提示工具预算（≥80%）                                                        |
| `ModelToolLoopResult`                                 | 循环结果（`finalReply`、`pendingClarificationQuestions`、`turnUsage`、`aborted`） |
| `runModelToolLoop(opts)`                              | 主循环                                                                            |

### `turn-orchestrator-tool-round.ts`

导出 `executeToolBatches`、`getRunToolPipeline`、`extractGateDecisionFromToolResult`、`shouldPreApproveSandboxWorkflowStep`、类型 `ToolRoundPolicyHints` / `ExecuteToolBatchesParams` / `ExecuteToolBatchesResult`。

**`extractGateDecisionFromToolResult`** 是从工具结果里把门禁决定抠出来——因为门禁是**工具执行层**产生的，要通过结果往上传递。

**`shouldPreApproveSandboxWorkflowStep`** 处理「沙箱工作流步骤要不要自动批准」（对应策略里的 `autoApproveSandboxWorkflowSteps`）。

### `turn-orchestrator-finalize.ts`

导出 `finishShortCircuitTurn`、`finalizeAgentTurn`、`cleanupFailedTurn`、类型 `TurnFinalizeShared`。

三个出口各对应一种结束方式：短路（提前结束）、正常结束、失败清理。**「清理」是独立的一条路径**，因为失败回合也要把占位轮次处理好。

### `turn-orchestrator-shortcuts.ts`

导出五个：

| 符号                                 | 作用                           |
| ------------------------------------ | ------------------------------ |
| `tryIntakeClarificationShortcut`     | Intake 澄清捷径                |
| `wouldIntakeClarify`                 | 只判断、不执行（用于提前决定） |
| `tryPublicWebFactShortcut`           | 公开网络事实捷径               |
| `formatPublicWebFactReply`           | 上一条的回复文案               |
| `tryAutoDeliverableWorkflowShortcut` | 自动交付物工作流捷径           |
| `TurnRunResult`                      | 类型                           |

**为什么要「捷径」**：有几种请求不需要跑整个循环就能满足（问模型是谁、查个娱乐事实、走一条完全确定的交付物管线）。短路能省掉大量 token。

### `turn-orchestrator-prompt.ts`

导出 `resolveAssistantTooling`、`prepareTurnPromptContext`、类型 `AssistantTooling`。

**`resolveAssistantTooling` 是工具表那条 7 级链的第一级**（角色白名单 → 岗位预设回落）。

### `turn-orchestrator-events.ts`

导出 `extractClarificationQuestions`、`extractToolErrorMessage`、`buildClarificationReply`、`buildTurnReplyFallback`、`collectRecentToolNamesFromSession`、`safeParse`、类型 `RunTurnEvent`。

**`RunTurnEvent` 是前后端共享的事件契约**（第 3.9 节列了全部成员）。

`buildTurnReplyFallback` 是「没有散文回复时」的兜底文案。

## 43.3 会话与持久化（12 个文件）

### `session.ts`（最重的一个）

导出分四组：

**常量与标题**

`DEFAULT_CHAT_SESSION_TITLE`、`AUTO_CHAT_TITLE_MAX_LENGTH`、`displayChatSessionTitle`、`extractFirstSentenceFromUserMessageParagraph`、`deriveAutoChatTitleFromFirstUserMessage`、`maybeUpdateSessionTitleFromInstruction`。

**生命周期**

`createSession`、`loadSession`、`saveSession`、`deleteSession`、`renameSession`、`upsertSessionTurn`、`appendTurn`、`loadTurns`、`listSessions`、`compactHistory`。

**工具批次（fail-closed）**

`beginSessionToolBatch`、`isSessionToolBatchOpen`、`commitSessionToolBatch`。

这三个是「一批工具的执行要原子提交」的实现。**为什么要 fail-closed**：如果一批工具跑了一半就落盘，会话历史里会留下不完整的批次。

**消息派生**

`sessionHistoryToSimpleMessages`、`appendSyntheticAssistantReply`、`deriveModelMessages`、`toModelMessages`、`deriveModelMessagesForSampling`、`ModelChatMessage`。

**`deriveModelMessagesForSampling(session, budget)`** 是「按预算裁剪后发给模型的消息」——历史裁剪、工具结果压缩、配对保护的入口。

### `session-persist.ts`

`persistOrThrow`、`SessionPersistError`、`isSessionPersistError`。

**为什么要包一层**：会话落盘失败要能被识别出来（第 3.5 节说「会话落盘错误会返回错误回合而不是抛出」）。

### `session-event-log.ts`

`appendSessionEvent`、`readSessionEvents`、`sessionEventsPath`、`shouldPersistSessionEvent`、`replayLiveTurnFromEventRecords`、`getLiveTurnProgressOrReplay`。

**事件日志是「实时进度的持久化底座」**：`replayLiveTurnFromEventRecords` 能从事件记录重建实时进度——这样进程重启后进度不丢。

### `session-turn-gate.ts`（回合门）

导出 `withSessionTurnGate`、`sessionTurnGateKey`、`turnGateLeasePath`、`TURN_GATE_STALE_MS`、`SessionTurnInProgressError`、`isSessionTurnInProgressError`、`isPidAlive`、`shouldStealTurnGateLease`、`isSessionTurnLeaseLive`、`writeTurnGateLeaseForTest`。

**两层锁**：进程内队列 + 跨进程租约文件（`sessions/<id>.turn-gate.json`）。`shouldStealTurnGateLease` 处理「上一个持有者已经死了」的情况。

### `session-tool-call-pairing.ts`（最多导出的一个）

`repairToolCallPairing`、`findUnpairedToolCallIds`、`findOrphanToolResultIds`、`normalizeToolResultMessages`、`sanitizeWireMessages`、`sliceKeepingToolGroups`、`alignCutIndexToToolGroups`、`TOOL_CALL_PAIRING_PLACEHOLDER_ERROR`、`TOOL_GROUP_CUT_LOOKBACK`、`WireChatMessage`、`SanitizedWireMessages`、`isToolPairingRejectText` 等。

**这个文件是「工具调用必须成对」这条约束的实现**：找不配对的、修复、按组切分、清洗待发消息。

**为什么这么多函数**：因为「成对」这条约束在四个地方都要维护（裁剪历史、压缩、修复、发送前清洗）。

### `session-tool-result-prune.ts`

`pruneToolResultsInHistory`、`pruneSessionToolResults`、`isContextOverflowError`。

**`isContextOverflowError` 是「上下文溢出」的识别**——用来决定要不要裁剪后重试。

### `session-context-steer.ts` / `session-context-inject.ts` / `session-context-followup.ts`

三个「侧车注入通道」，结构几乎一样：

| 文件                          | 排什么队     | 侧车文件                         |
| ----------------------------- | ------------ | -------------------------------- |
| `session-context-steer.ts`    | 律师中途指示 | `<id>.pending-steer.json`        |
| `session-context-inject.ts`   | 中途钉选     | `<id>.pending-context-pins.json` |
| `session-context-followup.ts` | 跟进备注     | `<id>.pending-followup.json`     |

每个都导出四个函数：`queue*`（入队）、`claim*`（取走）、`peek*`（只看）、`applyClaimed*ToHistory`（并入历史）。

**为什么要侧车文件**：因为它必须在 `saveSession` 之后仍然存在（第 3.9 节）。

### `session-message-mutate.ts`

`listUiHistoryMap`、`truncateSessionFromUiIndex`、`deleteSessionMessagePairAtUiIndex`、`UiHistoryMapEntry`。

**「UI 索引」和「实际历史索引」是两个坐标系**——因为有些消息对律师隐藏。这个文件负责映射与按 UI 位置删除。

### `session-history-alignment.ts`

`inspectSessionHistoryAlignment`、`inspectPersistedSessionHistoryAlignment`、`SessionHistoryAlignmentIssue`。

只管**检查**（不改）。

### `session-delete-cascade.ts`

`deleteSessionWithCascade`。

删会话要连侧车一起清（第 3.12 节那条已知坑）。

### `session-inbox.ts`

`SESSION_INBOX_KINDS`、`classifySessionInbox`、`isSessionInboxKind`、`SessionInboxKind`、`SessionInboxChannel`。

用来把会话相关的东西归类（是「需要我处理的」还是「只是通知」）。

## 43.4 停顿与中断（3 个）

### `turn-abort.ts`

`bindTurnAbortSignal`、`getTurnAbortSignal`、`requestTurnAbort`、`clearTurnAbort`、`isTurnAbortRequested`、`resetTurnAbortStore`。

**它是「中断信号」的注册表**——按回合 id 存 abort 控制器。

### `turn-interrupt.ts`

导出很多：`INTERRUPTED_ACTION_PREFIX`、`INTERRUPTED_TURN_GRACE_MS`、`isSessionTurnLive`、`isInterruptedTurnView`、`interruptedTurnExecutionState`、`formatInterruptedTurnNote`、`buildInterruptedTurnAction`、`viewTurnsForLawyer`、`lastInterruptedTurnView`、`resolveInterruptedActionForResume`、`interruptedTurnForAction`、`applyDerivedInterruptedAction`。

**这是「孤儿轮次」那套逻辑**：把进程崩溃留下的 `running` 占位轮次**在读取时**呈现成 `interrupted`，并提供「恢复」动作。

**关键点**：`interrupted` 不是落盘状态，是**视图**（第 28 章也提过）。

### `turn-lifecycle-hooks.ts`

`registerTurnLifecycleHook`、`emitTurnLifecycle`、`clearTurnLifecycleHooks`、类型 `TurnLifecyclePhase` / `TurnLifecycleEvent` / `TurnLifecycleHook`。

**钩子系统**：某个模块可以注册「回合到某阶段时通知我」，而不用改编排器。这是给测试与可观测性留的口子。

## 43.5 上下文管理（6 个）

### `context-budget.ts`

导出：`estimateTokenBudget`、`estimateTokenBudgetBreakdown`、`estimateTextTokens`、`estimateMessageTokens`、`resolveContextPolicy`、`TOKEN_BUDGET_WARN_RATIO`、`DEFAULT_MID_TURN_COMPACT_TRIGGER_RATIO`、`SMALL_WINDOW_RESERVE_RATIO`、`TOKEN_BUDGET_BUCKET_ORDER`、类型若干。

**两个估算函数**：`estimateTokenBudget` 给总量与水位；`estimateTokenBudgetBreakdown` 给按桶分解（界面上的用量表用它）。

### `compact.ts`（压缩的主力）

导出：`autoCompactSessionHistory`（主入口）、`buildDroppedSpanDigest`、`writeCompactDigestFile`、`compactDigestPath`、`collectDroppedCitationAnchors`、`resolveCompactDigestCharCap`、`adjustIndexToPreserveToolPairs`、`readSessionSummary`、`sessionSummaryPath`、`buildPostCompactSystemNote`、`collectCompactAttachmentNotes`、`CompactResult`。

**`collectDroppedCitationAnchors` 值得单独看**：它保证被压缩掉的段落里的**引用锚点**不会丢。这是「压缩后引用还在不在」那条 cassette 断言针对的能力。

### `compact-llm-digest.ts`

`isCompactLlmDigestEnabled`、`enhanceCompactDigestWithLlm`、`replaceDroppedDigestInMessages`。

LLM 增强是可选的（抽取式摘要打底，LLM 只做升级）。

### `compact-reinjection.ts` / `compact-insert.ts` / `compact-distill.ts`

| 文件                     | 作用                                                                                                                                                                                |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `compact-reinjection.ts` | 压缩后重注红线（`formatCompactReinjectionBlock`、`applyCompactReinjectionToSession`）                                                                                               |
| `compact-insert.ts`      | 合成消息的标记与插入位置（`COMPACT_REINJECTION_MARKER`、`COMPACT_SYNTHETIC_USER_MARKERS`、`isCompactSyntheticUserMessage`、`findLastRealUserIndex`、`insertBeforeLastUserMessage`） |
| `compact-distill.ts`     | 压缩后蒸馏成**待确认**记忆建议（`distillCompactIntoMemorySuggestions`）                                                                                                             |

**`findLastRealUserIndex` 解决一个问题**：注入位置要「最后一条真实用户消息之前」，而不是「最后一条消息之前」（因为后面可能已经插了合成消息）。

### `mid-turn-compact.ts`

`shouldCompactMidTurn`、`applyMidTurnCompact`、`midTurnBudgetOverTrigger`、`MID_TURN_COMPACT_MAX`、类型 `MidTurnCompactPrune` / `MidTurnCompactOutcome`。

**回合内压缩**：先试便宜的工具结果裁剪，不够再全压，不减少就拒绝。

### `context-deferral.ts`

`isContextBudgetDeferralReply`、`formatContextDeferralBounce`、`isContextDeferralBounceMessage`、`dropContextDeferralBounces`、`CONTEXT_DEFERRAL_BOUNCE_MARKER`、`CONTEXT_DEFERRAL_BOUNCE_MAX`。

判定「模型是不是在让渡窗口」用的是**双正则**（水位线 + 交回），不是单条。

## 43.6 提示组装（3 个）

### `system-prompt.ts`

导出：`buildSystemPrompt`、`buildSystemPromptParts`、`buildSystemPromptWithMeta`、`splitSystemPromptAtBoundary`、`joinSystemPromptParts`、`applySystemPromptToHistory`、`listSystemPromptSectionCatalog`、`describeAssembledPromptSections`、`SYSTEM_PROMPT_SECTION_CATALOG`、`LAWMIND_PROMPT_DYNAMIC_BOUNDARY`、`LAWMIND_AGENT_BEHAVIOR_EPOCH`、类型。

**`SYSTEM_PROMPT_SECTION_CATALOG` 是章节的单一真相源**（第 3.17 节那张表的来源）。每个章节带 `always` 与 `cache` 两个元数据。

**`applySystemPromptToHistory`** 把组装好的系统提示应用到历史（而不是每次都拼在消息里）。

### `prompt-fragments.ts`

导出：`createPromptFragment`、`packPromptFragments`、`capFragmentBody`、`renderPackedFragments`、`partitionPackedFragments`、`scaleFragmentCapTokens`、`formatOverflowPointer`、`FRAGMENT_CAPS`、`FRAGMENT_SESSION_TAIL_BUDGET_TOKENS`、`formatTurnContextUserMessage`、`withEphemeralTurnContext`、`withEphemeralBudgetNote`、类型。

**这是「片段化提示」的实现**：每种片段（环境、策略、案件索引、记忆命中、交付物、协议、预算……）有独立的字符上限与优先级，按预算打包。

**`capFragmentBody` 必须带溢出指针**（`formatOverflowPointer`）——这是「禁止静默截断」那条要求的实现。

### `material-blocks.ts` + `matter-context-fragment.ts`

`composeMaterialsBlock`（把材料清单组织成提示块）、`recordMaterialBlockEvent`、`summarizeMaterialBlockHealth`、`describeMaterialBlockHealth`、`MATERIAL_HEALTH_MIN_SAMPLES_PER_CHANNEL`。

`buildMatterContextFragmentBody`（案件上下文的提示片段）。

**`material-blocks` 里的健康统计**值得注意：它统计材料块在各渠道的命中情况，样本不足就不给结论——又是「诚实 null」那条纪律。

## 43.7 工具表与披露（5 个）

| 文件                       | 关键导出                                                                                                                                        |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `tool-name-sets.ts`        | `MATTER_SCOPE_REQUIRED`、`WRITE_TOOLS`、`IDEMPOTENT_READ_TOOLS`、`BACKGROUND_JOB_TOOLS`、`DESK_WRITE_TOOL_NAMES`                                |
| `permission-mode.ts`       | `parsePermissionMode`、`filterToolsForPermissionMode`、`READONLY_AGENT_TOOL_NAMES`、`RESEARCH_AGENT_TOOL_NAMES`                                 |
| `child-gates.ts`           | `restrictPermissionMode`、`intersectAllowedToolNames`、`inheritChildGates`、`resolveChildToolCallBudget`、`parentGatesFromContext`              |
| `tool-disclosure-delta.ts` | `diffToolNames`、`formatToolDisclosureDeltaNote`、`applyToolDisclosureDelta`                                                                    |
| `tool-budget.ts`           | `resolveToolCallBudgets`、`shouldHardStopToolBudget`、`shouldCheckpointToolBudget`、`DEFAULT_SOFT_TOOL_CALLS`、`DEFAULT_HARD_TOOL_CALL_CEILING` |

**`child-gates.ts` 是「子助手只能比父更严」的实现**：`intersectAllowedToolNames` 只收窄不放大。

## 43.8 工具结果处理（3 个）

| 文件                     | 作用                                                                                                                                                   |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `tool-result-history.ts` | 决定工具结果进历史时的长度（`resolveToolResultHistoryTokens`、`summarizeToolResultForHistory`、`clipTextToTokensMiddle`、`slimDuplicateVerifyFields`） |
| `tool-result-spill.ts`   | 结果太大时溢出到文件（`shouldSpillToolResult`、`writeToolResultSpill`、`toolResultSpillRelPath`）                                                      |
| `tool-lawyer-card.ts`    | 工具结果的律师视角呈现（`presentLawyerToolCall`、`presentLawyerToolResult`、`lawyerFacingToolFailureDetail`）                                          |

**`clipTextToTokensMiddle` 的名字说明策略**：从中间截（保留头尾）——因为头尾信息密度高（第 37 章讲的相似案件召回也是这个思路）。

## 43.9 其他（简列）

| 文件                                                           | 作用                                          |
| -------------------------------------------------------------- | --------------------------------------------- |
| `no-task-turn.ts`                                              | 「无任务回合」的提示与拒绝文案                |
| `dangerous-tool-policy.ts`                                     | 沙箱名单与「要不要显式审批」                  |
| `approval-cache-key.ts`                                        | 审批缓存键（含参数绑定工具）                  |
| `confirmed-answers.ts`                                         | 合并已确认的澄清答案                          |
| `document-read-budget.ts`                                      | 文档读取预算（按上下文伸缩）                  |
| `text-elide.ts`                                                | 中段省略                                      |
| `live-turn-progress.ts`                                        | 实时进度（含从事件重建）                      |
| `embed-turn-events.ts`                                         | SSE 事件名映射与历史别名                      |
| `model-error-message.ts`                                       | 模型错误的人话翻译                            |
| `model-identity-reply.ts` / `model-connectivity-check.ts`      | 两个短路（问模型是谁、连通性自检）            |
| `deliverable-pipeline.ts`                                      | 自动交付物工作流（要不要跑、怎么跑）          |
| `draft-worker.ts` / `draft-worker-loop.ts`                     | 并行写稿（含只读 worker 循环）                |
| `explore-folder-worker.ts`                                     | 文件夹探查 worker                             |
| `readonly-worker-loop.ts`                                      | 只读 worker 循环（给子任务用）                |
| `runtime-model-call.ts`                                        | 模型调用（含 SSE 解析、重试、配对拒绝自愈）   |
| `runtime-resume.ts`                                            | 续跑（`resumeTurn` / `resumePausedTurn`）     |
| `runtime-tool-arg-normalize.ts` / `runtime-tool-validation.ts` | 参数归一化与校验                              |
| `assistant-presets.ts` / `agent-presets.ts`                    | 岗位预设（内置 + 工作区）                     |
| `assistant-text.ts`                                            | 助手文本提取与截断判断                        |
| `prompt-protocol-gate.ts`                                      | 协议门（哪些工具允许走研究协议/最短改动协议） |
| `conversation-search.ts` / `conversation-search-query.ts`      | 跨对话检索（含相对时间解析）                  |
| `matter-context-fragment.ts`                                   | 案件上下文片段                                |

## 43.10 读 `agent/` 的四个提示

1. **`turn-orchestrator.ts` 只导出 `runTurn`**，所以理解它必须读实现，不能靠导出面。
2. **三处「侧车注入」结构一样**（steer / inject / followup），读通一个就够。
3. **`session-tool-call-pairing.ts` 的函数最多**——因为它维护的约束（工具调用成对）在四个地方都要照顾。
4. **`turn-lifecycle-hooks.ts` 是给测试与可观测性留的口子**，改编排器时可以用它挂钩子而不是改代码。

## 43.11 已知坑（本章相关）

- **`runtime.ts` 只是 barrel。** 别在它里面找实现。
- **`RunTurnEvent` 的成员各只声明一次**；服务端里同一事件出现两次（`case` + `sseWriteEvent`）是分发逻辑，别当成重复成员。
- **`shouldCheckpointToolBudget` 恒为 false。**
- **`interrupted` 是视图不是落盘状态。**
- **中途注入只在轮次开始 claim 生效。**
- **一批工具是 fail-closed 提交的。** 半批落盘会让历史不完整。
- **`capFragmentBody` 必须带溢出指针。** 静默截断是被禁止的。
- **子助手的工具表只能收窄。**
- **删会话要级联清侧车。**
