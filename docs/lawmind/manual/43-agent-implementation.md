# 第 43 章 实现精读：`agent/`

这一章逐文件讲 `src/lawmind/agent/` 里的模块。导出符号清单是机械提取的，所以名字准确；语义说明结合了源码注释与调用方。

`agent/` 有 207 个非测试实现文件（`.ts` 共 389 个，含测试），其中 112 个在根目录；其余在 `tools/`（70）、`collaboration/`（15）、`orchestrator/`（4）、`testkit/`（6）四个子目录——`tools/` 的机制见第 49 章、`tools/legal/` 逐个工具见第 61 章、`collaboration/` + `orchestrator/` + `tools/coordination/` 见第 60 章、`testkit/` 见第 35 章。本章逐文件讲根目录这 112 个。

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

函数只导出 `runTurn`（另有一行 `RunTurnEvent` 类型再导出；其余都是内部函数）。

这是全书最重要的一处。读法见第 34.3 节。**注意它的导出面只有一个函数**——意味着所有阶段都是内部实现，不能从外部单独调。

`runTurn` 本体是 **19 段**，顺序与硬编码目录 B1.2 一致。intake 澄清捷径不在其中。

1. 已有 `sessionId` 且未 `skipSessionTurnGate` 时，`withSessionTurnGate` 排队并写租约，然后带 `skipSessionTurnGate` 再进一次。
2. `attachEnabledMcpServers` 把 `mcp__*` 挂进同一张表；失败不拆核心工具。
3. `resolveToolCallBudgets`。缺省软上限与硬天花板都是 80；软上限 `< 8` 时硬上限跟软上限走（委派分片）。服务端 `resolveAgentMaxToolCallsPerTurn` 把策略与环境变量夹到 ≤80。
4. 加载或创建 session，显式 `matterId` 覆盖旧案件，已删且目录不在的编号摘掉，并 `resetIsolationBudget`。
5. `resolveContextTuning`，本回合复用。
6. `ensureLawyerWorkForTurn`，失败忽略。
7. 意图标志：Word 改稿、交付意图、邮件合同短路径、已确认答案、无任务回合。
8. 任务钉子与事实台账。无任务回合不动钉子。
9. 构造 `AgentContext`。`clarificationBlockingHeavyTools` **写死 `false`**：跨轮硬键只进提示词，不拦截起草、工作流、渲染。
10. 工具表决议的外壳：Role / preset、playbook deny、钉选预读，然后才是 allow 交集、披露名、无任务改 `readonly`、`resolveModelToolNames`、去掉隐藏名。
11. `compileIntent` 夹在第 10 段中间（预读之后、`resolveModelToolNames` 之前）。链上至少两步且会话还没有清单时写入自动 `turnPlan`。`CompiledIntent.softAsk` 若存在会在第 15 段的 `intent` 事件上原样转发；`compileIntent` **从不写入该字段**，所以这条字段目前不会出现。
12. `prepareTurnPromptContext`。
13. 用户原话入史，`freezeTurnContext`，纠正语回滚已写改动，回合开始就落盘 `running` 占位。组装期间已停止则不落这句。
14. `bindTurnAbortSignal`，每 200ms 把 `shouldAbort` 镜像到 abort，并 `beginLiveTurnProgress`。
15. 进模型之前：若已中止，弹出本句 user（尚无 assistant），`status=error`，`error=aborted_by_user`，回复「已停止生成。」否则写 `turn_begin`、发 `intent`，再发 `token_budget` 并做回合开始的 `autoCompactSessionHistory`（压过则重注）。
16. 短路链，命中即返回：模型身份答复 → 连通性自检 → 公开网页事实 → 自动交付物工作流 → iCloud 下载确认。最后一环要律师确认时，回合置 `awaiting_clarification`，不进模型循环。
17. `runModelToolLoop`。循环若中止，已有工具或消息则 `paused`，否则 `error` / `aborted_by_user`。
18. 仅 `turn.status === "completed"` 时补 Word 自动交件，并附上打开 Word 的标记。澄清、只读、暂停不绕过管线落盘。
19. `finalizeAgentTurn`。`finally` 清隔离预算、停 abort 镜像、`clearTurnAbort`、关 MCP。

## 43.2 回合的六块配套

### `turn-orchestrator-model-loop.ts`

导出：

| 符号                                                                                    | 作用                                                                                                                                   |
| --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `resolveStrictUpstreamToolStreaming(hasOnEvent, env)`                                   | 是否开启严格工具流式（`LAWMIND_STRICT_TOOL_STREAM=1`）                                                                                 |
| `shouldWarnToolBudget(used, max)`                                                       | 是否该提示工具预算（≥80%）                                                                                                             |
| `toolCallBatchSignature` / `advanceIdenticalToolStreak` / `identicalToolRepeatDecision` | 同一工具批次连着重复：第三次提醒，提醒后再重复则停。Word 改稿里已经读完的同一份文书（`hasMore=false`）多给一次采样改去落改，下一次仍停 |
| `ModelToolLoopResult`                                                                   | 循环结果（`finalReply`、`pendingClarificationQuestions`、`turnUsage`、`aborted`）                                                      |
| `runModelToolLoop(opts)`                                                                | 主循环                                                                                                                                 |

循环内部两条行为不在导出表里，但撞排查时会遇到：

- **空 `choices` 重试一次**：`response.choices[0]` 为空时用 `emptyChoiceRetryUsed` 标记再要一轮；仍为空才按「Empty response from model」收口，不静默编一条收尾消息。
- **`workerModel` 不接管工具轮**：它只有一处接线——独立审稿（`reviewModel: config.workerModel ?? config.model`，`turn-orchestrator.ts`）。对话循环里选工具、改稿仍走主模型。自动压缩（回合开始与回合内）只留提取式原文，不在回合里跑模型摘要——`turn-orchestrator-model-loop.ts` 里有注释钉死这条边界；`enhanceCompactDigestWithLlm` 只被桌面「手动整理」与「承前分叉」路由调用，用的是会话主模型，不是 `workerModel`。

### `turn-orchestrator-tool-round.ts`

导出 `executeToolBatches`、`getRunToolPipeline`、`extractGateDecisionFromToolResult`、`shouldPreApproveSandboxWorkflowStep`、类型 `ToolRoundPolicyHints` / `ExecuteToolBatchesParams` / `ExecuteToolBatchesResult`。

**`extractGateDecisionFromToolResult`** 是从工具结果里把门禁决定抠出来——因为门禁是**工具执行层**产生的，要通过结果往上传递。

**`shouldPreApproveSandboxWorkflowStep`** 处理「沙箱工作流步骤要不要自动批准」（对应策略里的 `autoApproveSandboxWorkflowSteps`）。

### `turn-orchestrator-finalize.ts`

导出 `finishShortCircuitTurn`、`finalizeAgentTurn`、`cleanupFailedTurn`、类型 `TurnFinalizeShared`。

三个出口各对应一种结束方式：短路（提前结束）、正常结束、失败清理。**「清理」是独立的一条路径**，因为失败回合也要把占位轮次处理好。

### `turn-orchestrator-shortcuts.ts`

导出四个：

| 符号                                 | 作用                 |
| ------------------------------------ | -------------------- |
| `tryPublicWebFactShortcut`           | 公开网络事实捷径     |
| `formatPublicWebFactReply`           | 上一条的回复文案     |
| `tryAutoDeliverableWorkflowShortcut` | 自动交付物工作流捷径 |
| `TurnRunResult`                      | 类型                 |

（intake 澄清捷径 `tryIntakeClarificationShortcut` / `wouldIntakeClarify` 已退役，不在短路链上。`router/intake-gate.ts` 头注仍把高风险空跑写成 Soft Ask：问题注入提示词，模型按假设起草并标【待核实】，**不**把回合写成 `awaiting_clarification`。类型上的 `softAsk` 只被转发，生产编译器不产生它，见 43.1 第 11 段。）

**为什么要「捷径」**：有几种请求不需要跑整个循环就能满足（问模型是谁、查个娱乐事实、走一条完全确定的交付物管线）。短路能省掉大量 token。

短路链上还有三个成员不在这个文件里：问模型身份与连通性自检在 `model-identity-reply.ts` / `model-connectivity-check.ts`（见 43.9）；iCloud 下载确认（`runApprovedIcloudDownloads`，实现在 `runtime/icloud-materialize.ts`）由编排器本体在进模型循环前调用——需要律师确认时回合直接置 `awaiting_clarification`，不进模型循环。

### `turn-orchestrator-prompt.ts`

导出 `resolveAssistantTooling`、`prepareTurnPromptContext`、类型 `AssistantTooling`。

**`resolveAssistantTooling` 是工具表那条 7 级链的第一级**（角色白名单 → 岗位预设回落）。

### `turn-orchestrator-events.ts`

导出 `extractClarificationQuestions`、`extractToolErrorMessage`、`buildClarificationReply`、`buildTurnReplyFallback`、`collectRecentToolNamesFromSession`、`safeParse`、类型 `RunTurnEvent`。

**`RunTurnEvent` 是前后端共享的事件契约**（第 3.9 节列了全部成员）。联合类型里有 `turn_wait` / `turn_wait_end`（模型空位排队）和 `verify_gap`（同回合验收缺口）。`intent` 事件带可选 `softAsk`，与 43.1 第 11 段同一字段：类型在，编译器不填。会话日志另有 `turn_begin`，由 `appendSessionEvent` 写入，不在这条律师流联合类型里单列。

`buildTurnReplyFallback` 是「没有散文回复时」的兜底文案。

## 43.3 会话与持久化（16 个文件）

### `session.ts`（最重的一个）

导出分四组：

**常量与标题**

`DEFAULT_CHAT_SESSION_TITLE`、`AUTO_CHAT_TITLE_MAX_LENGTH`、`displayChatSessionTitle`、`extractFirstSentenceFromUserMessageParagraph`、`deriveAutoChatTitleFromFirstUserMessage`、`maybeUpdateSessionTitleFromInstruction`。

**生命周期**

`createSession`、`loadSession`、`saveSession`、`deleteSession`、`renameSession`、`upsertSessionTurn`、`appendTurn`、`loadTurns`、`listSessions`、`listSessionsForDesk`（在办瘦身列表）、`compactHistory`、`setSessionPlanHandoff` / `clearSessionPlanHandoff`。

**工具批次（fail-closed）**

`beginSessionToolBatch`、`isSessionToolBatchOpen`、`commitSessionToolBatch`。

这三个是「一批工具的执行要原子提交」的实现。**为什么要 fail-closed**：如果一批工具跑了一半就落盘，会话历史里会留下不完整的批次。

**消息派生**

`sessionHistoryToSimpleMessages`、`appendSyntheticAssistantReply`、`deriveModelMessages`、`toModelMessages`、`deriveModelMessagesForSampling`、`ModelChatMessage`。

**`deriveModelMessagesForSampling(session, budget)`** 是送出投影，不裁历史。配对修复写回会话；一条 tool 消息里的多个结果展开成每个 `tool_call_id` 一条 wire 消息；预算只决定要不要在末尾附一条不落盘的剩余 token 注记。裁历史在 `compact.ts`。

### `session-persist.ts`

`persistOrThrow`、`SessionPersistError`、`isSessionPersistError`。

**为什么要包一层**：会话落盘失败要能被识别出来（第 3.5 节说「会话落盘错误会返回错误回合而不是抛出」）。

### `session-event-log.ts`

`appendSessionEvent`、`readSessionEvents`、`readSessionEventsForReplay`、`repairTornJsonlTail`、`sessionEventsPath`、`shouldPersistSessionEvent`、`replayLiveTurnFromEventRecords`、`getLiveTurnProgressOrReplay`。

**事件日志是「实时进度的持久化底座」**：`replayLiveTurnFromEventRecords` 能从事件记录重建实时进度——这样进程重启后进度不丢。追加前会截掉崩溃留下的半行（`repairTornJsonlTail`）。回放走 `readSessionEventsForReplay`，大文件只读尾部。

### `session-turn-gate.ts`（回合门）

导出 `withSessionTurnGate`、`sessionTurnGateKey`、`turnGateLeasePath`、`TURN_GATE_STALE_MS`、`SessionTurnInProgressError`、`isSessionTurnInProgressError`、`isPidAlive`、`shouldStealTurnGateLease`、`isSessionTurnLeaseLive`、`writeTurnGateLeaseForTest`。

**两层锁**：进程内队列 + 跨进程租约文件（`sessions/<id>.turn-gate.json`）。`shouldStealTurnGateLease` 处理「上一个持有者已经死了」的情况。另一台机器的租约（`hostname` 不同）只在超过 `TURN_GATE_STALE_MS` 后才抢，不用本机进程表。

### `session-tool-call-pairing.ts`（最多导出的一个）

`repairToolCallPairing`、`findUnpairedToolCallIds`、`findOrphanToolResultIds`、`normalizeToolResultMessages`、`sanitizeWireMessages`、`sliceKeepingToolGroups`、`alignCutIndexToToolGroups`、`TOOL_CALL_PAIRING_PLACEHOLDER_ERROR`、`TOOL_GROUP_CUT_LOOKBACK`、`WireChatMessage`、`SanitizedWireMessages`、`isToolPairingRejectText` 等。

**这个文件是「工具调用必须成对」这条约束的实现**：找不配对的、修复、按组切分、清洗待发消息。

**为什么这么多函数**：因为「成对」这条约束在四个地方都要维护（裁剪历史、压缩、修复、发送前清洗）。

### `session-tool-result-prune.ts`

`pruneToolResultsInHistory`、`pruneSessionToolResults`、`isContextOverflowError`。

**`isContextOverflowError` 是「上下文溢出」的识别**——用来决定要不要裁剪后重试。

### `session-context-steer.ts` / `session-context-inject.ts` / `session-context-followup.ts`

三个「侧车注入通道」，结构几乎一样：

| 文件                          | 排什么队     | 侧车文件                     |
| ----------------------------- | ------------ | ---------------------------- |
| `session-context-steer.ts`    | 律师中途指示 | `<id>.pending-steer.json`    |
| `session-context-inject.ts`   | 中途钉选     | `<id>.pending-pins.json`     |
| `session-context-followup.ts` | 跟进备注     | `<id>.pending-followup.json` |

导出形状按通道分两类：steer / inject 要并进**当前**历史，所以各有 `queue*`（入队）、`claim*`（取走）、`applyClaimed*ToHistory`（并入历史），steer 另有 `peek*`（只看）和一体的 `claimAndApplyPendingSteer`；followup **不并当前历史**——它等活回合结束后开新回合，所以只有 `queuePendingFollowup` / `claimPendingFollowup` / `peekPendingFollowup`，没有「并入历史」那一个。

**为什么要侧车文件**：因为它必须在 `saveSession` 之后仍然存在（第 3.9 节）。中途指示和中途钉选的 claim 会先改名为 `.inflight`，历史里已经有这条内容才删除；没落盘就退出时下一轮重新交进历史。这套「先改名、落盘后才删」的持久 claim 是三通道共用的实现，就在 `session-sidecar-claim.ts`（见下）。

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

把三条入口通道（chat / steer / inject）归类成三种 inbox 种类：`followup` 开新回合、`steer` 进下一轮采样、`inject` 进下一轮钉选——正好对应上面三个侧车文件。它没有自己的落盘文件，只做分类。

### `session-carryover.ts`（另起新对话带上文）

`forkSessionWithCarryover`、`buildCarryoverDraft`、`composeCarryoverMessages`、`blockingActionsForFork`、`forkTitle`、`CARRYOVER_SEED_MARKER`、类型 `CarryoverDraft` / `ForkWithCarryoverResult`。

**承前分叉**：不另造档案格式——新会话仍是 `sessions/<newId>.json`，开场一条合成 user（`【前序对话续接】`，`hiddenFromLawyer`），种子 = 状态头 + 蒸馏 + 重读指针，指回源会话路径。源会话写 `forkedTo`、新会话写 `carriedOverFrom`，带相同 `clientNonce` 重试幂等。活回合、待批准、待授权不搬（`source_not_found` / `turn_live` / `pending_authorization`）。入口三条：用量面板、对话变长后的建议卡、律师原话（`fork-continue-request.ts`，见 43.9）。

### `session-desk-snapshot.ts`

`slimSessionForDesk`、`writeSessionDeskSnapshot`。

在办目录用的会话瘦索引 `<id>.desk.json`：只丢掉对话历史，标题、回合和待拍板留着，`saveSession` 里 best-effort 写——避免打开在办时把每段对话都读进内存。

### `session-sidecar-claim.ts`（侧车持久 claim）

`claimSidecarBatch`、`sidecarInflightPath`。

三个侧车通道共用的「耐用取件」：rename `pending → *.inflight`，调用方确认这批已经进会话历史后才删 inflight；`saveSession` 前崩溃则下一轮重投，不掉律师的留言。

## 43.4 停顿与中断（4 个）

### `turn-abort.ts`

`bindTurnAbortSignal`、`getTurnAbortSignal`、`requestTurnAbort`、`clearTurnAbort`、`isTurnAbortRequested`、`resetTurnAbortStore`。

**它是「中断信号」的注册表**——按会话 id 存 abort 控制器。`bindTurnAbortSignal` 若发现停止已经记下，新信号直接是已中止，不把这次停止清掉。这样律师在材料预读或提示组装时点停止，回合不会再进模型。

### `turn-interrupt.ts`

导出很多：`INTERRUPTED_ACTION_PREFIX`、`INTERRUPTED_TURN_GRACE_MS`、`isSessionTurnLive`、`isInterruptedTurnView`、`interruptedTurnExecutionState`、`formatInterruptedTurnNote`、`buildInterruptedTurnAction`、`viewTurnsForLawyer`、`lastInterruptedTurnView`、`resolveInterruptedActionForResume`、`interruptedTurnForAction`、`applyDerivedInterruptedAction`。

**这是「孤儿轮次」那套逻辑**：把进程崩溃留下的 `running` 占位轮次**在读取时**呈现成 `interrupted`，并提供「恢复」动作。

**关键点**：`interrupted` 不是落盘状态，是**视图**（第 28 章也提过）。

### `turn-lifecycle-hooks.ts`

`registerTurnLifecycleHook`、`emitTurnLifecycle`、`clearTurnLifecycleHooks`、类型 `TurnLifecyclePhase` / `TurnLifecycleEvent` / `TurnLifecycleHook`。

**钩子系统**：某个模块可以注册「回合到某阶段时通知我」，而不用改编排器。这是给测试与可观测性留的口子。

### `assistant-turn-gate.ts`（存在，但聊天回合不用）

`AssistantTurnInProgressError`、`normalizeAssistantGateId`、`assistantTurnGateKey`、`assistantTurnGateLeasePath`、`isAssistantTurnLeaseLive`、`withAssistantTurnGate`（已标 `@deprecated`）、`writeAssistantTurnGateLeaseForTest`。

**助手级租约**（`sessions/assistant-<id>.turn-gate.json`），与 `session-turn-gate.ts` 同型、同一个过期阈值——但**聊天回合不拿它**：文件头注明确写聊天与 resume 不得用本锁包住 `runTurn`，同一场对话的互斥走会话租约。非法或空 id 落成 `DEFAULT_ASSISTANT_ID`。

## 43.5 上下文管理（13 个）

### `context-budget.ts`

导出：`estimateTokenBudget`、`estimateTokenBudgetBreakdown`、`estimateTextTokens`、`estimateMessageTokens`、`TOKEN_BUDGET_BUCKET_ORDER`、`HISTORY_QUALITY_CONTEXT_TOKENS`、类型若干。`resolveContextPolicy`、`TOKEN_BUDGET_WARN_RATIO`、`SMALL_WINDOW_RESERVE_RATIO` 是从 `context-tuning.ts` 再导出的兼容名——**常量的真相源已经挪走**，这里只做窗口与水位的计算。

**两个估算函数**：`estimateTokenBudget` 给总量与水位；`estimateTokenBudgetBreakdown` 给按桶分解（界面上的用量表用它）。历史水位与蒸馏帽按 `min(模型窗口, HISTORY_QUALITY_CONTEXT_TOKENS=200000)` 封顶，不随 500K/1M 档放大。

### `context-tuning.ts`（单一调参入口）

导出：`DEFAULT_CONTEXT_TUNING`、`resolveContextTuning`、`resolveContextPolicy`，以及一批旧名常量再导出（`TOKEN_BUDGET_WARN_RATIO`、`DEFAULT_MID_TURN_COMPACT_TRIGGER_RATIO`、`MID_TURN_COMPACT_MAX`、`CONTEXT_DEFERRAL_BOUNCE_MAX`、`TASK_PIN_CHAR_CAP`、`CARRYOVER_SEED_CHAR_RATIO` 等）。

**调参只进这一扇门**：`DEFAULT_CONTEXT_TUNING` 分五组（`budget` / `midTurn` / `digest` / `pins` / `carryover`，全表见第 30 章与硬编码目录 B.2），`resolveContextTuning` 读工作区 policy 的 `context.*` 覆盖——类型不对回落默认、越界夹取、不抛错；跨字段不变量（如 `warnRatio <= midTurnCompactTriggerRatio`）也在这里修。

### `context-preset.ts`（对话窗口三档）

`CONVERSATION_LENGTH_PRESETS`（200K / 500K / 1M）、`DEFAULT_CONVERSATION_LENGTH = "200k"`、`normalizeConversationLength`、`contextTokensForConversation`。

**三档是硬编码的产品选项**：实际窗口 = `min(模型自己的窗口, 所选档)`，模型更短时不会假装能记住整档。旧值 `daily` → 200K、`dossier` → 1M。桌面会话路由用它决定传给压缩的 `contextTokens`，`runTurn` 内部不读这档。

### `context-isolation-budget.ts`

`ISOLATION_PARENT_BUDGET_CHARS = 3200`、`isolationKey`、`resetIsolationBudget`、`takeIsolationBudget`、`isolationBudgetUsed`。

**并行子注入共用一份父上下文预算**：委派与写稿 sidecar 各自保自己的转录，注入父回合时只从同一个 3200 字池子里切；每回合开始 `resetIsolationBudget` 复位。

### `compact.ts`（压缩的主力）

导出：`autoCompactSessionHistory`（主入口）、`buildDroppedSpanDigest`、`writeCompactDigestFile`、`compactDigestPath`、`collectDroppedCitationAnchors`、`resolveCompactDigestCharCap`、`cutIndexForTokenTail`、`readSessionSummary`、`sessionSummaryPath`、`buildPostCompactSystemNote`、`collectCompactAttachmentNotes`、`CompactResult`。

切点按剩余 token 从尾部往前装（`cutIndexForTokenTail`），不按固定条数。工具调用整组保留；`elideKeepTail` 是最少留下的条数，`maxHistoryMessages` 是条数上限。

**`collectDroppedCitationAnchors` 值得单独看**：它保证被压缩掉的段落里的**引用锚点**不会丢。这是「压缩后引用还在不在」那条 cassette 断言针对的能力。`estimatedDroppedTokens` 与预算共用 `estimateTextTokens`（中日韩 1 字 ≈ 1 token）。日历截止日（没有「期限」二字的「2026年9月30日前提起仲裁」）由 `compact-fact-pin.ts` 整句钉进重注块，不进摘要衰减。

### `compact-llm-digest.ts`

`isCompactLlmDigestEnabled`、`enhanceCompactDigestWithLlm`、`replaceDroppedDigestInMessages`。

LLM 增强是可选的（抽取式摘要打底，LLM 只做升级），且**不在 `runTurn` / 模型循环里跑**——只有桌面「手动整理」与「承前分叉」路由调用它（见 43.2 模型循环那条边界），短于 `llmMinSummaryChars`（40 字）的模型摘要丢弃。

### `compact-reinjection.ts` / `compact-insert.ts` / `compact-distill.ts`

| 文件                     | 作用                                                                                                                                                                                |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `compact-reinjection.ts` | 压缩后重注红线（`formatCompactReinjectionBlock`、`applyCompactReinjectionToSession`）                                                                                               |
| `compact-insert.ts`      | 合成消息的标记与插入位置（`COMPACT_REINJECTION_MARKER`、`COMPACT_SYNTHETIC_USER_MARKERS`、`isCompactSyntheticUserMessage`、`findLastRealUserIndex`、`insertBeforeLastUserMessage`） |
| `compact-distill.ts`     | 压缩后蒸馏成**待确认**记忆建议（`distillCompactIntoMemorySuggestions`）；同样只被桌面整理路由调用，不在自动回合压缩里跑                                                             |

**`findLastRealUserIndex` 解决一个问题**：注入位置要「最后一条真实用户消息之前」，而不是「最后一条消息之前」（因为后面可能已经插了合成消息）。

### `compact-drop-archive.ts` + `compact-fact-pin.ts`

| 文件                      | 作用                                                                                                                                                                                    |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `compact-drop-archive.ts` | 压缩丢掉的原话按会话落盘 `sessions/<id>.drops/<boundary>.json`（`writeCompactDropArchive`）；整理稿里只留相对路径，正文不注入提示。写法对齐工具回包 spill                               |
| `compact-fact-pin.ts`     | **事实台账**：把律师原话里的期限 / 硬约束 / 引用 / 金额抽出来钉住（`extractFactPinItems`、`accumulateFactPin`），跨任意次压缩原样存活。回合开始累积，压缩时再兜底；上限在 `pins` 调参组 |

### `mid-turn-compact.ts`

`shouldCompactMidTurn`、`applyMidTurnCompact`、`midTurnBudgetOverTrigger`、`elideOversizedMessages`、`MID_TURN_COMPACT_MAX`（从 `context-tuning.ts` 再导出）、类型 `MidTurnCompactPrune` / `MidTurnCompactOutcome`。

**回合内压缩**：先试便宜的工具结果裁剪，不够再全压，不减少就拒绝。单条巨型消息压不动时，就地对非尾部 user/assistant 做中间省略（`reason: "elided"`），不动 tool 消息。次数到顶记 `cap`，与「没越线」（`below_trigger`）分开。

### `context-deferral.ts`

`isContextBudgetDeferralReply`、`formatContextDeferralBounce`、`isContextDeferralBounceMessage`、`dropContextDeferralBounces`、`CONTEXT_DEFERRAL_BOUNCE_MARKER`、`CONTEXT_DEFERRAL_BOUNCE_MAX`。

判定「模型是不是在让渡窗口」用的是**双正则**（水位线 + 交回），不是单条。

## 43.6 提示组装（5 个）

### `system-prompt.ts`

导出：`buildSystemPrompt`、`buildSystemPromptParts`、`buildSystemPromptWithMeta`、`splitSystemPromptAtBoundary`、`joinSystemPromptParts`、`applySystemPromptToHistory`、`listSystemPromptSectionCatalog`、`describeAssembledPromptSections`、`SYSTEM_PROMPT_SECTION_CATALOG`、`LAWMIND_PROMPT_DYNAMIC_BOUNDARY`、`LAWMIND_AGENT_BEHAVIOR_EPOCH`、类型。

**`SYSTEM_PROMPT_SECTION_CATALOG` 是章节的单一真相源**（第 3.17 节那张表的来源）。每个章节带 `always` 与 `cache` 两个元数据。

**`applySystemPromptToHistory`** 保留已经发出的静态前缀，只替换边界之后的会话段。可用工具清单在边界之后，本轮工具表变了会写进后缀，不会冻在首轮目录里。

### `prompt-fragments.ts`

导出：`createPromptFragment`、`packPromptFragments`、`capFragmentBody`、`renderPackedFragments`、`partitionPackedFragments`、`scaleFragmentCapTokens`、`formatOverflowPointer`、`FRAGMENT_CAPS`、`FRAGMENT_SESSION_TAIL_BUDGET_TOKENS`、`formatTurnContextUserMessage`、`withEphemeralTurnContext`、`withEphemeralBudgetNote`、类型。

**这是「片段化提示」的实现**：每种片段（环境、策略、案件索引、记忆命中、交付物、协议、预算……）有独立的字符上限与优先级，按预算打包。

**`capFragmentBody` 必须带溢出指针**（`formatOverflowPointer`）——这是「禁止静默截断」那条要求的实现。

### `material-blocks.ts` + `matter-context-fragment.ts`

`composeMaterialsBlock`（把材料清单组织成提示块）、`recordMaterialBlockEvent`、`summarizeMaterialBlockHealth`、`describeMaterialBlockHealth`、`MATERIAL_HEALTH_MIN_SAMPLES_PER_CHANNEL`。

`buildMatterContextFragmentBody`（案件上下文的提示片段）。

**`material-blocks` 里的健康统计**：它统计材料块在各渠道的命中情况，样本不足就不给结论——又是「诚实 null」那条纪律。

### `world-state.ts`

`WORLD_STATE_SECTION_IDS`、`wrapWorldStateSection`、`extractWorldStateSection`、`upsertWorldStateSection`、`hashWorldStateBody`、`collectWorldStateHashes`、`stabilizeUnchangedWorldState`、`formatPermissionWorldState`、类型 `WorldStateSectionId` / `WorldStateBaseline`。

**命名世界状态段**：新会话 / 压缩后全量注入，之后每回合只补丁改动段（按段体哈希比对），保住静态 system 前缀的稳定——前缀缓存命中靠的就是「没变的段一个字不动」。

## 43.7 工具表与披露（6 个）

| 文件                       | 关键导出                                                                                                                                                                                                                                                                             |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `tool-name-sets.ts`        | `MATTER_SCOPE_REQUIRED`、`WRITE_TOOLS`、`IDEMPOTENT_READ_TOOLS`、`BACKGROUND_JOB_TOOLS`、`DESK_WRITE_TOOL_NAMES`                                                                                                                                                                     |
| `permission-mode.ts`       | `parsePermissionMode`、`filterToolsForPermissionMode`、`READONLY_AGENT_TOOL_NAMES`、`RESEARCH_AGENT_TOOL_NAMES`                                                                                                                                                                      |
| `child-gates.ts`           | `restrictPermissionMode`、`intersectAllowedToolNames`、`inheritChildGates`、`resolveChildToolCallBudget`、`parentGatesFromContext`                                                                                                                                                   |
| `tool-disclosure-delta.ts` | `diffToolNames`、`formatToolDisclosureDeltaNote`、`applyToolDisclosureDelta`                                                                                                                                                                                                         |
| `tool-budget.ts`           | `resolveToolCallBudgets`、`shouldHardStopToolBudget`、`shouldCheckpointToolBudget`（恒 `false`）、`DEFAULT_SOFT_TOOL_CALLS`、`DEFAULT_HARD_TOOL_CALL_CEILING`（二者默认都是 80；服务端再夹到 ≤80，见 43.1 第 3 段）。检索/列表与本机读的次数帽在 `runtime/tool-pipeline.ts`，见 49.2 |
| `turn-step-context.ts`     | `TurnContext` 整回合冻结（`freezeTurnContext`）；`StepContext` 每轮采样前重建（`rebuildStepContext`：按冻结的 allow/deny/权限重跑 `resolveModelToolNames`，丢掉已打满发现配额的工具，写稿缺口仍在时收锁检索）                                                                        |

**`child-gates.ts` 是「子助手只能比父更严」的实现**：`intersectAllowedToolNames` 只收窄不放大。

## 43.8 工具结果处理（3 个）

| 文件                     | 作用                                                                                                                                                   |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `tool-result-history.ts` | 决定工具结果进历史时的长度（`resolveToolResultHistoryTokens`、`summarizeToolResultForHistory`、`clipTextToTokensMiddle`、`slimDuplicateVerifyFields`） |
| `tool-result-spill.ts`   | 结果太大时溢出到文件（`shouldSpillToolResult`、`writeToolResultSpill`、`toolResultSpillRelPath`）                                                      |
| `tool-lawyer-card.ts`    | 工具结果的律师视角呈现（`presentLawyerToolCall`、`presentLawyerToolResult`、`lawyerFacingToolFailureDetail`）                                          |

**`clipTextToTokensMiddle` 的名字说明策略**：从中间截（保留头尾）——因为头尾信息密度高（第 37 章讲的相似案件召回也是这个思路）。

## 43.9 其他（简列）

| 文件                                                                                              | 作用                                                                                                     |
| ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `types.ts`                                                                                        | 核心类型（`AgentTool` / `AgentContext` / `AgentMessage` / `AgentTurn` / `AgentSession` / `AgentConfig`） |
| `no-task-turn.ts`                                                                                 | 「无任务回合」的提示与拒绝文案                                                                           |
| `dangerous-tool-policy.ts`                                                                        | 子进程沙箱名单；`toolRequiresExplicitApproval` 因 `toolRequiresLawyerPause` 恒为 false 而直接返回 false  |
| `approval-cache-key.ts`                                                                           | 审批缓存键（含参数绑定工具）                                                                             |
| `confirmed-answers.ts`                                                                            | 合并已确认的澄清答案                                                                                     |
| `document-read-budget.ts`                                                                         | 文档读取预算（按上下文伸缩）                                                                             |
| `text-elide.ts`                                                                                   | 中段省略                                                                                                 |
| `live-turn-progress.ts`                                                                           | 实时进度（含从事件重建）                                                                                 |
| `embed-turn-events.ts`                                                                            | SSE 事件名映射与历史别名                                                                                 |
| `model-error-message.ts`                                                                          | 模型错误的人话翻译                                                                                       |
| `model-identity-reply.ts` / `model-connectivity-check.ts`                                         | 两个短路（问模型是谁、连通性自检）                                                                       |
| `chat-folder.ts`                                                                                  | 对话挂本机文件夹（`normalizeChatFolderRel` / `normalizeChatWorkDir` / `chatFolderGroupKey`）             |
| `fork-continue-request.ts`                                                                        | 识别律师原话里的「另起新对话并带上文」，由桌面执行 fork，不把这句话交给模型                              |
| `deliverable-pipeline.ts`                                                                         | 自动交付物工作流（要不要跑、怎么跑）                                                                     |
| `deliverable-shape.ts`                                                                            | 诉状 / 追问清单 / 备忘录的形态检查（缺节、清单条数）；只查形状，词仍由模型写                             |
| `deliverable-chat-links.ts`                                                                       | 回合写出办公交付件后，把可点的 lm-wps 链接补进给律师的回复                                               |
| `named-deliverable.ts`                                                                            | 从指令里识别点名交付文件；没落盘就隐藏 nudge 一次                                                        |
| `issue-ledger.ts`                                                                                 | 审查类备忘录必须带的台账块（冲突、材料缺口、一处具体修改）                                               |
| `write-synthesis.ts`                                                                              | 写前合成：检索够了 nudge 去写点名文件；仍缺则收锁检索（`withholdSearchTools`）、点名调用拒签             |
| `review-board-export-deferral.ts`                                                                 | 「须审核台放行」推诿的隐藏反弹（同一回合最多 1 次，交办即终稿）                                          |
| `mail-contract-fast-path.ts`                                                                      | 邮件合同改稿短路径的提示词与 deny 名单再导出                                                             |
| `word-revision-auto-deliver.ts`                                                                   | Word 改稿回合完成后自动落 tracked 稿；澄清 / 暂停 / 只读不绕过管线落盘                                   |
| `draft-worker.ts` / `draft-worker-loop.ts`                                                        | 并行写稿（含只读 worker 循环）                                                                           |
| `draft-worker-batch.ts`                                                                           | 同轮多个 `draft_worker` 的分片冲突拒绝与合并索引                                                         |
| `worker-brief.ts`                                                                                 | 隔离 worker 的自含任务书（子工看不到父对话，任务书必须写全）                                             |
| `sidecar-resume.ts`                                                                               | 只读 sidecar 的续跑记录（父历史不存这份转录，只留 resume 指针）                                          |
| `explore-folder-worker.ts`                                                                        | 文件夹探查 worker                                                                                        |
| `readonly-worker-loop.ts`                                                                         | 只读 worker 循环（给子任务用）                                                                           |
| `material-pile-digest.ts`                                                                         | `digest_materials`：一堆文件一次读出短卡（≤32 份，抽取并发 4）                                           |
| `turn-plan.ts` / `turn-plan-model.ts`                                                             | `update_plan` 回合清单（2–8 步写进世界状态）；model 那份不含 Node 内置模块，渲染进程可安全引用           |
| `tool-decision-sampling.ts`                                                                       | 工具轮的输出预算（`TOOL_DECISION_MAX_TOKENS = 4096`）与「被截断才抬预算」判定                            |
| `lawyer-chat-projection.ts`                                                                       | 律师面气泡投影：合成 user 不上屏，最后一轮工具之后的正文合成一个气泡                                     |
| `lawyer-close.ts` / `lawyer-close-anchors.ts`                                                     | 给律师的收口：删掉核对黑话所在行，把工具已返回的法条锚点嵌进模型写好的句子                               |
| `resolve-transcript-cut.ts`                                                                       | 桌面气泡索引映射到持久气泡（编辑 / 删除跟 utterance 走，不按陈旧索引）                                   |
| `runtime-model-call.ts`                                                                           | 模型调用（含 SSE 解析、重试、配对拒绝自愈）                                                              |
| `runtime-resume.ts`                                                                               | 续跑（`resumeTurn` / `resumePausedTurn`）                                                                |
| `runtime-tool-arg-normalize.ts` / `runtime-tool-validation.ts`                                    | 参数归一化与校验                                                                                         |
| `assistant-presets.ts` / `agent-presets.ts`                                                       | 岗位预设（内置 6 个 + 工作区 `lawmind/agents/*.md`）                                                     |
| `assistant-text.ts`                                                                               | 助手文本提取与截断判断                                                                                   |
| `prompt-protocol-gate.ts`                                                                         | 协议门（哪些工具允许走研究协议/最短改动协议）                                                            |
| `conversation-search.ts` / `conversation-search-query.ts`                                         | 跨对话检索（含相对时间解析）                                                                             |
| `factor-state.ts` / `factor-conformal.ts`                                                         | 回合因子状态：引擎持有锚点与稳定子，模型只采样；conformal 门要求预测集大小为 1 才许写确定句              |
| `skeleton-tree.ts` / `ooxml-skeleton.ts`                                                          | 草稿骨架：标题森林（模型可改的起点）与从 docx / 内置模板抽标题                                           |
| `cuad-official-clauses.ts` / `factor-state-legal-industry-fixtures.ts` / `legal-bench-metrics.ts` | 评测夹具与打分函数（只被测试引用，不进生产链）                                                           |

## 43.10 读 `agent/` 的四个提示

1. **`turn-orchestrator.ts` 只导出 `runTurn`**，所以理解它必须读实现，不能靠导出面。
2. **三处「侧车注入」结构一样**（steer / inject / followup），读通一个就够。
3. **`session-tool-call-pairing.ts` 的函数最多**——因为它维护的约束（工具调用成对）在四个地方都要照顾。
4. **`turn-lifecycle-hooks.ts` 是给测试与可观测性留的口子**，改编排器时可以用它挂钩子而不是改代码。

## 43.11 已知坑（本章相关）

- **`runtime.ts` 只是 barrel。** 别在它里面找实现。
- **`RunTurnEvent` 的成员各只声明一次**；服务端里同一事件出现两次（`case` + `sseWriteEvent`）是分发逻辑，别当成重复成员。
- **`shouldCheckpointToolBudget` 恒为 false。** 新回合不在软上限停下来问律师。硬停是 `used >= hard`。
- **自 2026-10-01 起没有工具会暂停回合。** `toolRequiresLawyerPause` 恒为 false。`send_email` / `prepare_outbound_mail` 是 `inbox_signoff`（写入待发信，律师点「批准发送」）；`delete_matter` / `render_document` 是 `deny_at_source`。
- **`softAsk` 有类型、会转发、不被产生。** 提示词里的「假设起草」文案不是这条字段。
- **`interrupted` 是视图不是落盘状态。**
- **中途注入只在轮次开始 claim 生效。**
- **一批工具是 fail-closed 提交的。** 半批落盘会让历史不完整。
- **`capFragmentBody` 必须带溢出指针。** 静默截断是被禁止的。
- **子助手的工具表只能收窄。**
- **删会话要级联清侧车。**
