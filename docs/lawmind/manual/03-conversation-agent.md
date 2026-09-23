# 第 3 章 对话与 Agent 循环

「对话」是 LawMind 的主入口，也是整套 Agent 循环的对外形态。本章讲两件事：律师在对话里看到和能做什么；以及一个「回合（turn）」在代码里是怎么跑完的。

> 三处更细的实现在别处：**回合编排器逐文件**在第 43 章；**HTTP 侧怎么接这个回合**在第 64.1 节（十九步 + 十三个错误码）；**意图怎么判**在第 4 章与第 70.1–70.9 节。

## 3.1 定位：一句话交办，一轮办到交付

对话面板即交办面板。律师说一句话或丢一份材料，系统在一个回合内自行选择工具、执行到产出草稿为止，中间步骤（列目录、检索、分析）不向律师提问「要不要继续」。这条设计的代码落点是 `runTurn`（`src/lawmind/agent/turn-orchestrator.ts`）：回合开始到结束是一条完整链路，产出的交付物落到工作区，而不是只留一段聊天摘要。

## 3.2 怎么用：输入、钉选与会话管理

- **直接说事**：不需要先选办件。意图由编译器判定，状态条只显示一行「本轮按××处理」。
- **钉选上下文**：可以用 `@` 钉文件、把文件拖进输入框、或把截图粘贴进对话框（粘贴即钉选）。钉选内容通过 `contextPins` 进入本轮，并可在回合中途补钉（见 3.9 的 `pendingContextPins`）。
- **开会话**：会话标签页（`LawmindChatSessionTabs.tsx`）、左栏会话列表（`LawmindSessionHistorySidebar.tsx`）、历史搜索（`LawmindChatHistorySearch.tsx`）；`⌘⇧O` 或 `/chats` 打开搜索。跨对话检索由 `search_conversations` / `read_conversation` 工具完成，命中以 `lm-session:` 链接触达那条对话。
- **看过程**：思考面板（`LawmindChatThoughtPanel.tsx`）与执行轨迹（`LawmindChatExecutionTrace.tsx`）折叠展示工具调用与中间结论；正式的进度在「在办」，对话线程不堆过程芯片、短路径按钮或步骤拍板卡。
- **切换模型 / 权限 / 检索**：输入框工具栏（`lawmind-chat-compose-toolbar.tsx`）提供模型选择、权限模式、检索开关与上下文用量表（`LawmindComposeContextUsage.tsx`）。
- **中途指示（steer）**：回合进行中继续输入会作为「律师中途指示」排队，在下一次模型采样前并入历史，文案形如 `【律师中途指示】…`。
- **停止**：停止生成会让回合进入「暂停」或「已停止」状态（见 3.10）。

## 3.3 怎么用：压缩、承前分叉与恢复

对话变长后系统会自动压缩（compact），这不是错误：

- 对话里会出现**压缩提示**（`LawmindMsgCompactNotice.tsx`），说明哪些内容被摘要、红线有没有重注。
- 如果律师希望从某条历史消息「另起一段但带着前文」，可以用**承前分叉**（`LawmindContextForkSuggestion.tsx`、`LawmindMsgCarryoverNotice.tsx`）：新会话会带一份前序摘要与未完成的授权状态。
- 会话可中断后续跑：`POST /api/sessions/:id/resume` 与 `/resume-paused` 分别处理不同中断态。

## 3.4 边界：什么会打断律师

只有**真授权**才进「待我拍板」：外发（`send_email`）、改原稿、以及明确的跨度硬门禁与不可逆外部操作。工具预算不足或步骤很多都**不会**打断——硬顶只防空转，对话里可以接着办。`shouldCheckpointToolBudget` 现已恒返回 `false`（历史 `continue_tools` 卡片仅用于恢复旧会话）。

## 3.5 实现：一个回合的完整生命周期

入口是 `runTurn(opts)`，核心参数包括 `config`、`registry`、`sessionId`、`instruction`、`matterId`、`onEvent`、`permissionMode`、`contextPins`、`preApproveToolName/Args/Names`、`confirmedAnswers` 等；返回 `{ turn, reply, sessionId, memoryContext }`。执行顺序：

1. **会话回合门**：若已有 `sessionId` 且未跳过，用 `withSessionTurnGate` 串行化同会话回合。
2. **挂载 MCP**：`attachEnabledMcpServers`，包在 try/catch 中（MCP 故障不允许拖垮核心工具表），结束时统一关闭。
3. **预算与模式解析**：`resolveToolCallBudgets(config.maxToolCalls)` 得到软 / 硬上限，解析 `maxHistory`、工具超时、是否允许危险工具免审批、权限模式。
4. **会话装载 / 创建**：`loadSession` / `createSession`；校验助手一致性（`session_assistant_mismatch`）；本轮显式带新案件时重绑 `matterId`；按新指示裁剪旧计划 `pruneTurnPlanForNewInstruction`。
5. **工作记录覆盖层**：`ensureLawyerWorkForTurn`（best-effort）。
6. **回合分类**：`wordRevisionTurn`（Word 改稿）、`deliveryIntent`、`mailContractTurn`（邮件合同短路径）、`contractFastLaneTurn`，合并 `confirmedAnswers`，判定 `noTaskTurn`。
7. **构造 `AgentContext`**：本轮运行环境（工作区、案件、助手、权限、钉选、授权预批准、沙箱开关、abort signal、模型等）。
8. **算出本轮工具表**（唯一真相源，见 3.7）。
9. **组装系统提示**：`prepareTurnPromptContext` + `buildSystemPrompt`，按 `LAWMIND_PROMPT_DYNAMIC_BOUNDARY` 切静态前缀与会话 / 回合后缀。
10. **写入用户消息**：原样入历史，不做二次改写；据此生成 `openAITools`。
11. **冻结回合上下文**：`freezeTurnContext` 产出 `TurnContext`；创建 `status:"running"` 的 `AgentTurn`，并**立即落盘占位轮次**（`upsertSessionTurn` + `saveSession`），避免出现「有历史但没有回合」的会话。
12. **接中断信号**：`bindTurnAbortSignal`；每 200ms 把外部 `shouldAbort` 镜像到 abort signal；`beginLiveTurnProgress` 开启实时进度。
13. **事件发射器**：`emitEvent` 同时做三件事——写会话事件日志（`appendSessionEvent`）、更新实时进度（`applyLiveTurnEvent`）、回调给消费者（`opts.onEvent`，消费者异常被吞掉）。
14. **开场事件 + 首次压缩**：`turn_begin` → `intent`（能力、说明、置信、来源、备选、链、softAsk）→ `token_budget` → `autoCompactSessionHistory`；若发生压缩则重注红线、记录 `session.lastCompactBoundary`、发 `compact_boundary`。
15. **短路链**（按序）：模型身份询问 → 模型连通性自检 → 公开网络事实捷径 → Intake 澄清捷径 → 自动交付物工作流捷径；命中即结束回合。
16. **主循环**：`runModelToolLoop`，带工具预算、策略提示、事件与中断回调。
17. **收尾**：用户中断 → `finishAbortedByUser`；正常完成 → 必要时 `autoDeliverWordRevisionIfNeeded`，再 `finalizeAgentTurn`。
18. **异常路径**：`catch` → `cleanupFailedTurn`；会话落盘错误会返回错误回合而不是抛出。`finally` 清理定时器、abort 绑定与 MCP 会话。

用户中断的分叉逻辑：有进度时落 `status:"paused"` 并给检查点回复 + `requiresAction`；无进度时落 `status:"error"`、`error:"aborted_by_user"`，并丢弃悬空的用户消息，回复「已停止生成。」。

## 3.6 实现：模型↔工具循环

`runModelToolLoop`（`src/lawmind/agent/turn-orchestrator-model-loop.ts`）的骨架是 `while (loopCount < hardCeiling + 1)`，`hardCeiling = max(maxToolCalls × 2, maxToolCalls)`。

**每轮前奏**（顺序固定）：中断检查 → `claimAndApplyPendingContextPins`（重算工具表、写 world state、`worldStateEpoch` 递增）→ 应用待处理的稿面补丁 → `noTaskTurn` 时清空计划 → 应用回合计划 → `claimAndApplyPendingSteer`（中途指示）→ 应用工作目标 → 同步权限模式与案件 → 中途压缩 `compactMidTurn`（处于待审批或有待澄清问题时跳过）。

**工具表重建**：`rebuildStepContext` 得到本步 `toolNames`，据此生成 `openAITools`，再 `applyToolDisclosureDelta` 对比上一轮并发出 `tool_delta` 事件与生命周期钩子，最后发 `round_start`。

**模型调用**：对同一回合内重复的验证结果做历史折叠（`applySameTurnVerifyHistoryCollapse`）；选模型时，**有工具要广告则优先 `config.workerModel`，否则用主模型**；`callModelRound` = 估算预算 → `deriveModelMessagesForSampling` → `callModelWithRetry`。若模型返回的工具调用无法与结果配对，`onToolPairingReject` 会自愈：归一化 + 修复配对 + 重存会话 + 重新派生消息。

**失败处理**：用户中断 → 中断结果；上下文溢出（`isContextOverflowError`）→ 裁剪工具结果一次后重试；其他 → `closeOnModelFailure` 发 `model_error` 并落助手错误气泡。

**模型没调工具**的三种分支：

- 有待澄清问题 → `awaiting_clarification`。
- 同一回合验证未过 → 转 `paused`，或插入一条对律师隐藏的回弹说明后 `continue`。
- 命中上下文预算让渡（deferral）→ 强制一次 `compactMidTurn`，插入隐藏回弹，发 `context_deferral_bounce` 后 `continue`（最多 2 次）。
- 以上都不是 → 回合 `completed`，以该段文本作为回复。

**模型调了工具**：`beginSessionToolBatch` → `executeToolBatches`（`turn-orchestrator-tool-round.ts`）→ `commitSessionToolBatch`（fail-closed；提交抛错时用嵌套 try 保住原始错误）。之后合并待澄清问题与回复文本、应用补丁、再次 `rebuildStepContext`、检查工具预算，若进入待审批则跳出循环。

退出前 `collapseHistoryForEnd()` 会清掉本回合合成的隐藏消息（验证回弹、预算让渡），没有散文回复时用 `buildTurnReplyFallback(turn)` 兜底。

## 3.7 实现：工具表是怎么算出来的

同一回合里，模型能看到的工具是下面这条**单链**的产物（顺序不可交换，只会逐级收窄）：

1. `resolveAssistantTooling`：助手的 `Role.allowedToolNames`，缺失时回落到岗位预设。
2. `resolvePlaybookToolLock`：流程锁只做否决（deny-list）。
3. `intersectAllowedToolNames`：子助手继承父回合的允许集，只收窄不放大。
4. `withUpdatePlanControlTool`：确保计划控制工具可用。
5. `hiddenPolicyToolNames`：策略隐藏项。
6. `session.disclosedToolNames = mergeTurnDisclosedToolNames(...)`：本轮披露集（含 `list_more_tools` 启用的能力）。
7. `resolveModelToolNames({ registeredNames, allowNames, permissionMode, disclosedNames, denyNames })`。

补充规则：

- `noTaskTurn`（不需要动文件的闲谈）把工具表权限模式强制成 `readonly`。
- 系统提示里的「可用工具」段与这里**同源**，都由 `availableToolNames` 派生，避免提示与实际工具表漂移。
- 未绑定的能力以目录形式渐进披露（8k 上限，不含邮件短路径）；已绑定只注入 1 份 Skill 正文（第 4 章）。

## 3.8 实现：上下文预算与压缩

**预算估算**（`src/lawmind/agent/context-budget.ts`）：`estimateTextTokens` 对中日韩字符按 1 字符 ≈ 1 token，其他按字符数 ÷ 4；`effectiveLimit = contextTokens − min(summaryOutputTokenReserve + autoCompactBufferTokens, floor(contextTokens × SMALL_WINDOW_RESERVE_RATIO))`，默认预留 `13000 / 20000`、`SMALL_WINDOW_RESERVE_RATIO = 0.25`（小窗口按比例封顶预留：写死 20k+13k 时 32k 窗口只剩 8k 可用，回合内压缩会腾不出空间）。水位：`TOKEN_BUDGET_WARN_RATIO = 0.85`、`DEFAULT_MID_TURN_COMPACT_TRIGGER_RATIO = 0.9`。`resolveContextPolicy` 读 `lawmind.policy.json` 的 `context` 覆盖。`estimateTokenBudgetBreakdown` 按 `TOKEN_BUDGET_BUCKET_ORDER`（律师 / 助手 / 工具结果 / 摘要 / 回合上下文 / 钉选 / 计划 / 稿面 / 工作区 / 规则）拆解用量，读取系统消息里的 `<!--lm-ws:id-->` 片段，各桶之和严格等于 `used`。

**回合间压缩**（`compact.ts`）：`autoCompactSessionHistory` 在 `level === "compact"` 或历史条数超上限时触发。保留首条系统消息，按工具配对约束切分历史；对被丢弃的区段生成摘要（`buildDroppedSpanDigest`，字符上限由 `resolveCompactDigestCharCap` 决定，保留引用锚点），写 `compact-digest.md`，注入「【案件会话摘要】」或 CASE 摘录与压缩后系统提示，插在**最后一条真实用户消息之前**。可选用 LLM 增强摘要（`compact-llm-digest.ts`）。压缩后：

- 记忆蒸馏 `distillCompactIntoMemorySuggestions` 只产出**待确认**建议，绝不静默写入。
- 红线重注 `applyCompactReinjectionToSession`（`compact-reinjection.ts`），确保规则、交付物要求与稿面红线在压缩后仍在。

**回合内压缩**（`mid-turn-compact.ts`）：上限 `MID_TURN_COMPACT_MAX = 3`。先尝试廉价的 `pruneSessionToolResults`，够用就停；否则做完整压缩；若压缩不会真正减少内容则拒绝（`no_reduction`）。触发原因会记录为 `below_trigger | cap | round_start | pruned_enough | no_reduction`。

**上下文让渡**（`context-deferral.ts`）：当模型回复同时命中「水位线」与「交回」两类特征时，判定为让渡，插入对律师隐藏的回弹（`【上下文预算】`），最多 `CONTEXT_DEFERRAL_BOUNCE_MAX = 2` 次，回合结束时删除。

**承前分叉**（`session-carryover.ts`）：`forkSessionWithCarryover` 用 `clientNonce` 幂等（对应源会话的 `forkedTo.nonce`）。以下情况会**拒绝**分叉：源会话不存在、回合仍在跑、存在未决授权（`tool_approval` / `matter_approval` / `judgment_escalation` / `workflow_blocked` / `continue_tools`）。成功时构造 `CarryoverDraft`，摘要字符上限 `CARRYOVER_SEED_CHAR_RATIO = 0.1`（clamp 在 8k–32k），消息以 `【前序对话续接】` 标记开头；迁移门禁状态（待澄清键、已确认答案、回合计划、上次能力、已披露工具、案件），并在两端写 `forkedTo` / `carriedOverFrom`，发审计 `session.forked_with_carryover`。桌面入口：用量面板「另起新对话（带上文）」+ 对话内一次性建议卡（`lastCompact.midTurn || compactCount >= 2`，同一会话只提示一次）；源会话在侧栏标「→ 由此续接」（`GET /api/sessions` 的 `forkedToSessionId`），新会话顶部渲染「续接来源」卡（`carriedOverFrom`，可展开摘要预览）。

## 3.9 实现：事件流与持久化

`RunTurnEvent` 联合类型（`turn-orchestrator-events.ts`）是前后端共同的事件契约，成员包括：`round_start`、`tool_call_start`、`tool_call_end`、`tool_progress`、`delta`、`clarification`、`final`、`token_budget`、`tool_budget`、`compact_boundary`、`overflow_prune`、`context_deferral_bounce`、`model_error`、`tool_delta`、`requires_action`、`approval_request`、`plan_update`、`intent`。

消费方有三条：

- 会话事件日志：`appendSessionEvent` → 落盘。
- 实时进度：`applyLiveTurnEvent`，对应 `GET /api/sessions/:id/live-turn` 的轮询。
- 桌面：`opts.onEvent` → `/api/chat` 的 SSE 流。

会话持久化以 `sessions/<id>.json` 为真相源（`session.ts`）。会话结构里有几个值得记住的字段：`disclosedToolNames`（已披露工具）、`lastCompactBoundary`（最近压缩边界）、`worldStateBaseline` / `worldStateEpoch`（世界状态基线）、`lastConfirmedAnswers`、`forkedTo` / `carriedOverFrom`、`planHandoff`、`turnPlan`。

两条回合中途的注入通道都走**侧车文件**，因为它们必须在 `saveSession` 之后仍然存在：

- 中途指示：`sessions/<id>.pending-steer.json`，上限 8 条 / 2000 字符（`session-context-steer.ts`）。
- 中途钉选：`pendingContextPinsPath`（`session-context-inject.ts`）。

两者都只在**模型轮次开始时**被 claim 并并入历史，保证「本轮说的」不会插到已经发出的采样中间。

## 3.10 实现：会话级并发门与中断

同一会话不允许两个回合同时跑：

- 进程内：一个尾部队列串行化。
- 跨进程：租约文件 `sessions/<id>.turn-gate.json`，超时 `TURN_GATE_STALE_MS = 3h`；冲突时抛 `SessionTurnInProgressError`。

中断与恢复：

- 中断信号绑定 `bindTurnAbortSignal`，200ms 镜像外部 `shouldAbort`。
- `runtime-resume.ts` 提供 `resumeTurn` / `resumePausedTurn`，并生成「被中断后接着办」的恢复指示。
- 孤儿回合（进程崩溃留下的 `running` 占位轮次）在读取时表现为 `interrupted`（`turn-interrupt.ts`），可被恢复或清理。
- 工具审批的恢复依赖审批缓存键（`approval-cache-key.ts`）：`apply_surgical_edits`、`prepare_outbound_mail` 属**参数绑定**审批（改参数即失效），其余按工具名匹配。

## 3.11 关键文件

| 关注点                   | 文件                                                                                                                                                                                                                                                             |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 回合编排                 | `src/lawmind/agent/turn-orchestrator.ts`                                                                                                                                                                                                                         |
| 模型↔工具循环            | `src/lawmind/agent/turn-orchestrator-model-loop.ts`                                                                                                                                                                                                              |
| 回合事件定义             | `src/lawmind/agent/turn-orchestrator-events.ts`                                                                                                                                                                                                                  |
| 工具轮执行               | `src/lawmind/agent/turn-orchestrator-tool-round.ts`                                                                                                                                                                                                              |
| 回合收尾 / 短路 / 提示   | `turn-orchestrator-finalize.ts`、`turn-orchestrator-shortcuts.ts`、`turn-orchestrator-prompt.ts`                                                                                                                                                                 |
| 回合上下文冻结           | `src/lawmind/agent/turn-step-context.ts`、`turn-abort.ts`、`turn-interrupt.ts`                                                                                                                                                                                   |
| 会话与持久化             | `session.ts`、`session-persist.ts`、`session-event-log.ts`、`session-turn-gate.ts`                                                                                                                                                                               |
| 上下文预算 / 压缩 / 让渡 | `context-budget.ts`、`compact.ts`、`compact-llm-digest.ts`、`compact-reinjection.ts`、`compact-insert.ts`、`mid-turn-compact.ts`、`context-deferral.ts`                                                                                                          |
| 承前分叉与中途注入       | `session-carryover.ts`、`session-context-steer.ts`、`session-context-inject.ts`                                                                                                                                                                                  |
| 工具表治理               | `src/lawmind/agent/tools/governance.ts`、`tools/disclosed-turn-tools.ts`、`tool-disclosure-delta.ts`                                                                                                                                                             |
| 提示组装                 | `src/lawmind/agent/system-prompt.ts`、`prompt-fragments.ts`                                                                                                                                                                                                      |
| 类型                     | `src/lawmind/agent/types.ts`                                                                                                                                                                                                                                     |
| 桌面 UI                  | `apps/lawmind-desktop/src/renderer/lawmind-chat-shell.tsx`、`LawmindChatThoughtPanel.tsx`、`LawmindChatExecutionTrace.tsx`、`LawmindMsgCompactNotice.tsx`、`LawmindMsgCarryoverNotice.tsx`、`LawmindContextForkSuggestion.tsx`、`LawmindComposeContextUsage.tsx` |
| HTTP 端点                | `apps/lawmind-desktop/server/lawmind-server-route-chat.ts`、`lawmind-server-route-sessions.ts`                                                                                                                                                                   |

## 3.12 已知坑

- `RunTurnEvent` 的成员在类型里各只声明一次。容易误判的是**服务端**（`lawmind-server-route-chat.ts`）里同一事件会出现两次——一次在 `case`，一次在 `sseWriteEvent`——那是分发逻辑，不是重复成员。修改该联合类型时按 `turn-orchestrator-events.ts` 数。
- 工具预算不再触发检查点（`shouldCheckpointToolBudget` 恒 `false`）；`skipToolBudgetCheckpoint` 仅为兼容旧会话保留。
- 中途指示、中途钉选走侧车文件而非会话 JSON，删除会话时要一并清理（`session-delete-cascade.ts`）。
- 承前分叉在存在未决授权时**必须**拒绝，否则新会话会带着一个无法回应的悬空授权。

## 3.13 补充：消息历史是怎么组织的

会话里的消息分三类，理解这个分类对排查「模型为什么没看到某条信息」很关键：

| 类型           | 存在哪                        | 会不会发给模型               |
| -------------- | ----------------------------- | ---------------------------- |
| 真实对话       | `session.conversationHistory` | 会（在预算内）               |
| 合成的隐藏消息 | 同上，但带 `hiddenFromLawyer` | 会（模型看得到，律师看不到） |
| 系统提示       | 组装出来的，不落盘在历史里    | 会（每次重新组装）           |

**第二类容易被误解**：它确实进了模型上下文，只是不在界面上显示。压缩后的摘要、上下文让渡的回弹、同回合验证的说明，都属于这一类。回合结束时会清理一部分（`collapseHistoryForEnd`）。

**派生消息的生成**：`deriveModelMessagesForSampling(session, budget)` 会按预算裁剪历史。裁剪时会**保护工具调用配对**——不能出现「有调用没结果」的情况，否则模型 API 会拒。

## 3.14 补充：工具结果怎么进历史

一次工具调用的完整往返是两条消息：

```text
assistant 消息（带 toolCalls）
tool 消息（带 toolCallResponses）
```

两者必须成对。有几处专门处理配对：

| 场景                   | 处理                                                     |
| ---------------------- | -------------------------------------------------------- |
| 模型返回的调用没法配对 | `onToolPairingReject` 自愈：归一化 + 修复配对 + 重存会话 |
| 上下文溢出             | `pruneSessionToolResults` 裁剪工具结果（保留配对）       |
| 压缩时切分历史         | `adjustIndexToPreserveToolPairs` 调整切点                |
| 结果太大               | `tool-result-spill.ts` 溢出到文件，历史里留指针          |

「结果太大就溢出到文件」这条很实用：一份大材料的内容不会整段进历史，历史里只留一句「完整内容在 xxx」。

## 3.15 补充：几种「回合没正常结束」的情况

| 现象                   | 落盘状态                    | 律师看到               | 怎么恢复                               |
| ---------------------- | --------------------------- | ---------------------- | -------------------------------------- |
| 律师点了停止（有进度） | `paused`                    | 检查点回复 + 待办      | `POST /api/sessions/:id/resume-paused` |
| 律师点了停止（无进度） | `error` + `aborted_by_user` | 「已停止生成。」       | 重新发指令                             |
| 进程崩了               | 占位轮次留在 `running`      | 读出来是 `interrupted` | 恢复或清理                             |
| 模型失败               | `error`                     | 助手错误气泡           | 修模型配置后重试                       |
| 等审批                 | `awaiting_approval`         | 待我拍板里有条目       | 批准后自动接着跑                       |
| 等澄清                 | `awaiting_clarification`    | 澄清卡片               | 答完自动接着跑                         |

**`interrupted` 不是落盘的原始状态**，它是读的时候给孤儿轮次的一个视图（第 28 章也提过）。

## 3.16 补充：会话的四种「续跑」入口

| 入口             | 什么时候用                   |
| ---------------- | ---------------------------- |
| `/resume`        | 一般的中断续跑               |
| `/resume-paused` | 从暂停态（律师主动停的）续跑 |
| 审批后自动续跑   | 批准工具审批时由服务端触发   |
| 澄清答完自动续跑 | 提交澄清答复时触发           |

**注意**：审批续跑不是「重新开始」，而是把卡住的那次工具调用放行，从断点继续。这是「恢复」和「重跑」的区别。

## 3.17 补充：一次回合里模型能看到什么

按系统提示的组装顺序（第 3.7 节讲了工具表，这里讲提示）：

| 段                  | 内容                       | 缓存层级 |
| ------------------- | -------------------------- | -------- |
| 身份与原则          | 「你是 LawMind」+ 核心原则 | static   |
| 运行模型            | 当前模型信息               | static   |
| 强制规则            | 工作区级 + 案件级          | session  |
| 交付物管线          | 本条指令要求什么交付物     | session  |
| 上下文计划          | 分层描述要带哪些上下文     | session  |
| 岗位职责 / 组织     | 助手角色与汇报关系         | session  |
| 法源                | 权威语料与公开来源         | session  |
| 联网                | 开/关对应的说明            | session  |
| 律师偏好            | 过滤后的档案               | session  |
| 客户档案            | 客户背景                   | session  |
| 案件上下文          | CASE 片段                  | turn     |
| 今日日志            | 今天的记录                 | turn     |
| 可用工具            | 本轮工具清单               | static   |
| 能力索引            | 未硬绑定时的能力目录       | turn     |
| 回答风格 / 安全边界 | —                          | static   |

**缓存分层的意义**：`static` 段每次都一样，可以命中提示缓存；`turn` 段每次变。这个划分直接影响调用成本。

**两张表的结构**：静态前缀和动态后缀之间有一个分隔标记（`LAWMIND_PROMPT_DYNAMIC_BOUNDARY`），组装时按它切开。

## 3.18 补充：上下文用量的四个桶

`estimateTokenBudgetBreakdown` 把用量按桶拆开（界面上的用量表就是它）：

| 桶         | 装什么                               |
| ---------- | ------------------------------------ |
| 律师       | 律师发的消息                         |
| 助手       | 助手回复                             |
| 工具结果   | 工具返回的内容                       |
| 摘要       | 压缩产生的摘要                       |
| 回合上下文 | turn 级的上下文段                    |
| 钉选       | 钉的文件内容                         |
| 计划       | 回合计划                             |
| 稿面       | 稿面相关（craft）                    |
| 工作区     | 工作区段（`<!--lm-ws:id-->` 标记的） |
| 规则       | 强制规则                             |

**排查「为什么很快就被压缩」时看这张表**：通常是「钉选」或「工具结果」桶太大。
