# 第 3 章 对话与 Agent 循环

「对话」是 LawMind 的主入口，也是整套 Agent 循环的对外形态。本章讲两件事：律师在对话里看到和能做什么；以及一个「回合（turn）」在代码里是怎么跑完的。

> 三处更细的实现在别处：**回合编排器逐文件**在第 43 章；**HTTP 侧怎么接这个回合**在第 64.1 节（十九步 + 十三个错误码）；**意图怎么判**在第 4 章与第 70.1–70.9 节。

## 3.1 定位：一句话交办，一轮办到交付

对话面板即交办面板。律师说一句话或丢一份材料，系统在一个回合内自行选择工具、执行到产出草稿为止，中间步骤（列目录、检索、分析）不向律师提问「要不要继续」。这条设计的代码落点是 `runTurn`（`src/lawmind/agent/turn-orchestrator.ts`）：回合开始到结束是一条完整链路，产出的交付物落到工作区，而不是只留一段聊天摘要。

### 3.1.1 对话里的子工：何时派、怎么做、和正式落稿的区别

律师在对话框提交需求的那一轮，模型自己决定要不要派子工、要不要并行。工具是 `draft_worker`（对话里的真实任务才会广告；空话、改原件、邮件短路径、函件核对不广告）。不另做一套分类器，也不改律师原话。互不依赖、而且各自都要连读连查的长任务，在同一次回复里并行调用，`section` 必须不同；拆不开的长任务只派一支；一两步能做完的留在本对话。`role` 决定这一支怎么做：`review` 交结论和依据，`draft` 写条款片段，`explore` 只读探查目录（与 `explore_folder` 同一只读循环，只把摘要交回）。子工看不到本对话，任务书必须自包含。交回的 `result` 给父会话汇总。中途指示进入正在跑的那一支的下一轮；要改已交回的一支，用返回的 `workerId` 作为 `resume_id`，再写 `follow_up`。

**和 Cursor / Codex 的区别（有意保留）：** 子工只读，不能改原件，不能导出，不能外发。正式落稿仍由父会话调用 `draft_document`（再经验收和律师签批）。这是法律交付必须停在父会话拍板，不是派工没接上。细节和参数见第 23.7 节。

## 3.2 怎么用：输入、钉选与会话管理

- **直接说事**：不需要先选办件。意图由编译器判定，状态条只显示一行「本轮按××处理」。
- **钉选上下文**：可以用 `@` 钉文件、把文件拖进输入框、或把截图粘贴进对话框（粘贴即钉选）。钉选内容通过 `contextPins` 进入本轮，并可在回合中途补钉（见 3.9 的 `pendingContextPins`）。中途补钉最多 16 份，满了保留最新钉上的，较早的会被取代并提示。
- **开会话**：会话标签页（`LawmindChatSessionTabs.tsx`）、全局侧栏历史（`LawmindSideChatSessions.tsx`）、对话主区里的会话历史（`LawmindSessionHistorySidebar.tsx`）。当前这条对话里查找是 `LawmindChatHistorySearch.tsx`（`⌘F`）；换一条会话可以在输入框打 `/chats`。跨对话检索由 `search_conversations` / `read_conversation` 工具完成，命中以 `lm-session:` 链接触达那条对话。
- **回复里的链接**（`lawyer-chat-link.ts`，渲染在 `lawmind-chat-markdown.tsx`）：点一下就打开，不把地址留给律师复制。
  - `[文书标题](lm-draft:任务编号)` 打开这份稿。
  - `[标题](lm-session:会话)` 打开另一段对话。
  - `[短标题](https://…)`，或句子里直接写出的公网地址，用系统浏览器打开。内网、localhost、带账号密码的地址只留文字。
  - `[短标题](工作区相对路径)`，或句子里的相对路径，在中间栏打开，对话保持开着。后缀包括 docx、pdf、xlsx、md、txt、图片，以及 `.canvas.tsx`（画布）。路径末尾的 `:行` 或 `:行:列` 会在文本或画布源码里选中那一行。磁盘绝对路径、`..` 和 `file:` 不打开。回复里提到画布不会自己跳开，要点链接。费用对照、时间轴、多份合同比较可以出画布；不要用画布代替法条。法条依据写在对话正文里，可点开查原文；不要另开中间栏核对纸。
- **看过程**：思考面板（`LawmindChatThoughtPanel.tsx`）与执行轨迹（`LawmindChatExecutionTrace.tsx`）折叠展示工具调用与中间结论；正式的进度在「在办」，对话线程不堆过程芯片、短路径按钮或步骤拍板卡。
- **切换模型 / 权限 / 检索**：输入框工具栏（`lawmind-chat-compose-toolbar.tsx`）提供模型选择、权限模式与检索开关。对话还短时不显示用量；变长或已经整理过，才出现「这场对话」（`LawmindComposeContextUsage.tsx`），让律师整理或另开一段。模型窗口和用量桶不进律师面。
- **对话长度三档**：同一工具栏里的档位选择（`LawmindSettingsConversationLength.tsx`，testid `lm-compose-context-length`）：200K / 500K / 1M，默认 200K。这是本轮硬天花板 = min(模型自己的窗口, 所选档)。历史整理、蒸馏帽和写进历史的单条工具回包另按 200K 质量带封顶（`historyNominalTokens`），不随 500K / 1M 把整理推迟。写 `PATCH /api/policy/workspace` 的 `conversationLength`；旧策略值 `daily` / `dossier` 读出时自动迁移成 200K / 1M（`src/lawmind/agent/context-preset.ts`）。
- **中途指示（steer）**：回合进行中继续输入会作为「律师中途指示」排队，在下一次模型采样前并入历史，文案形如 `【律师中途指示】…`。正在跑的子工也会在它的下一轮采样前看到同一条指示，但不从收件箱取走；父会话仍在自己的下一轮领取。换行会保留。队列最多 8 条，满了留下最新的，并在输入框上方说明较早的已被取代；单条超过 2000 字会截断并标明。送进本轮后立刻显示「已带入本轮」。
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
6. **回合分类**：`wordRevisionTurn`（Word 改稿）、`deliveryIntent`、`mailContractTurn`（邮件合同短路径），合并 `confirmedAnswers`，判定 `noTaskTurn`。（原 Solo「5 分钟合同审查」固定快车道已移除；合同审查走对话引用 + 自然语言交办。）
7. **构造 `AgentContext`**：本轮运行环境（工作区、案件、助手、权限、钉选、授权预批准、沙箱开关、abort signal、模型等）。
8. **算出本轮工具表**（唯一真相源，见 3.7）。
9. **组装系统提示**：`prepareTurnPromptContext` + `buildSystemPrompt`，按 `LAWMIND_PROMPT_DYNAMIC_BOUNDARY` 切静态前缀与会话 / 回合后缀。
10. **写入用户消息**：原样入历史，不做二次改写；据此生成 `openAITools`。
11. **冻结回合上下文**：`freezeTurnContext` 产出 `TurnContext`；创建 `status:"running"` 的 `AgentTurn`，并**立即落盘占位轮次**（`upsertSessionTurn` + `saveSession`），避免出现「有历史但没有回合」的会话。
12. **接中断信号**：`bindTurnAbortSignal`。组装期间（MCP、材料预读、提示组装）已经点过停止的，信号一绑上就是已中止，**不会把这次停止清掉**；本轮在压缩和模型采样之前结束，用户那句不进历史，占位轮次直接落成 `aborted_by_user`。之后每 200ms 把外部 `shouldAbort` 镜像到 abort signal。`beginLiveTurnProgress` 开启实时进度。
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

**模型调用**：对同一回合内重复的验证结果做历史折叠（`applySameTurnVerifyHistoryCollapse`）。采样一律用律师选的主模型 `config.model`：选工具、读结果、写回复都是判断，不改走更快模型。配了 `workerModel` 时，它只做回合内摘要和审稿。`callModelRound` = 估算预算 → `deriveModelMessagesForSampling` → `callModelWithRetry`。若模型返回的工具调用无法与结果配对，`onToolPairingReject` 会自愈：归一化 + 修复配对 + 重存会话 + 重新派生消息。供应商这一轮没有 `choices[0]` 时，同一回合重试一次再失败。

**失败处理**：用户中断 → 中断结果；上下文溢出（`isContextOverflowError`）→ 裁剪工具结果一次后重试；其他 → `closeOnModelFailure` 发 `model_error` 并落助手错误气泡。

**同一调用连着重复**：工具批次的签名（工具名 + 参数，忽略键顺序）连续相同 3 次，插入一条律师看不见的 `【重复调用】` 提醒，让模型换做法或直接写回复。提醒之后仍原样再调一次，就停住并说明已有结果都还在，不向律师提问要不要继续。签名一变，计数清零。

**模型没调工具**的四种分支：

- 有待澄清问题 → `awaiting_clarification`。
- 同一回合验证未过 → 转 `paused`，或插入一条对律师隐藏的回弹说明后 `continue`。
- 命中上下文预算让渡（deferral）→ 强制一次 `compactMidTurn`，插入隐藏回弹，发 `context_deferral_bounce` 后 `continue`（最多 2 次）。
- 以上都不是 → 回合 `completed`，以该段文本作为回复。

**模型调了工具**：`beginSessionToolBatch` → `executeToolBatches`（`turn-orchestrator-tool-round.ts`）→ `commitSessionToolBatch`（fail-closed；提交抛错时用嵌套 try 保住原始错误）。之后合并待澄清问题与回复文本、应用补丁、再次 `rebuildStepContext`、检查工具预算，若进入待审批则跳出循环。

退出前 `collapseHistoryForEnd()` 会清掉本回合合成的隐藏消息（验证回弹、预算让渡）。`【重复调用】` 留下，下一轮采样还能看见。没有散文回复时用 `buildTurnReplyFallback(turn)` 兜底。

## 3.7 实现：工具表是怎么算出来的

同一回合里，模型能看到的工具是下面这条**单链**的产物（顺序不可交换）。前几步收窄允许集；第 6 步在允许集里**加回**本轮该看见的能力；第 7 步才是最终广告集。不是单调收窄。

| #   | 做什么                                                                                                         | 代码位置                         |
| --- | -------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| 1   | `resolveAssistantTooling`：助手的 `Role.allowedToolNames`，缺失时回落到岗位预设                                | `agent/turn-orchestrator.ts`     |
| 2   | `resolvePlaybookToolLock`：流程锁只做否决（deny-list）                                                         | `platform/playbook-tool-lock.ts` |
| 3   | `intersectAllowedToolNames`：子助手继承父回合的允许集，只收窄不放大                                            | `agent/turn-orchestrator.ts`     |
| 4   | `withUpdatePlanControlTool`：确保计划控制工具可用                                                              | `agent/turn-orchestrator.ts`     |
| 5   | `hiddenPolicyToolNames`：策略隐藏项                                                                            | `policy/analysis-scripts.ts`     |
| 6   | `session.disclosedToolNames = mergeTurnDisclosedToolNames(...)`：本轮披露集（含 `list_more_tools` 启用的能力） | `agent/turn-orchestrator.ts`     |
| 7   | `resolveModelToolNames({ registeredNames, allowNames, permissionMode, disclosedNames, denyNames })`            | `agent/turn-step-context.ts`     |

**调试「模型为什么看不到某个工具」时，按这张表从上往下查**：第 1、2 步管「助手/流程允不允许」，第 5 步管「策略藏了什么」，第 6 步管「披露了没有」，第 7 步才是最终合并。`rebuildStepContext`（`turn-step-context.ts`）每轮都会重跑这条链。

补充规则：

- 流程锁只禁有安全或明确相反交付的名字：邮件短路径禁误发和用模板重建原件；Word 改稿同样禁误发和重建原件；「帮我看看」只禁外发，改稿留在表里，先读再改靠提示和审批；函件核对禁另起一封函和改稿。提到「文件夹」或钉了一个目录**不**拿掉改稿工具，同一回合可以先读再改。
- `noTaskTurn`（不需要动文件的闲谈）把工具表权限模式强制成 `readonly`。
- 系统提示里的「可用工具」段与这里**同源**，都由 `availableToolNames` 派生，避免提示与实际工具表漂移。回合中途新钉材料会重算披露集，并继续套用本回合冻结的策略隐藏项（离线时 `run_compute` 不会被钉选加回来）。
- 未绑定的能力以目录形式渐进披露（8k 上限，不含邮件短路径）；已绑定只注入 1 份 Skill 正文（第 4 章）。

## 3.8 实现：上下文预算与压缩

**预算估算**（`src/lawmind/agent/context-budget.ts`）：`estimateTextTokens` 对中日韩字符按 1 字符 ≈ 1 token，其他按字符数 ÷ 4；`effectiveLimit = contextTokens − min(summaryOutputTokenReserve + autoCompactBufferTokens, floor(contextTokens × SMALL_WINDOW_RESERVE_RATIO))`，默认预留 `13000 / 20000`、`SMALL_WINDOW_RESERVE_RATIO = 0.25`（小窗口按比例封顶预留：写死 20k+13k 时 32k 窗口只剩 8k 可用，回合内压缩会腾不出空间）。水位：`TOKEN_BUDGET_WARN_RATIO = 0.85`、`DEFAULT_MID_TURN_COMPACT_TRIGGER_RATIO = 0.9`。`resolveContextPolicy` 读 `lawmind.policy.json` 的 `context` 覆盖。模型调用的硬天花板由对话长度档给出（`context-preset.ts` 的 `contextTokensForConversation`：min(模型目录窗口, 所选档上限)）。历史水位不用这扇天花板的全长：`historyNominalTokens` 再收进 200K 质量带，小窗口仍以模型为准。`estimateTokenBudgetBreakdown` 按 `TOKEN_BUDGET_BUCKET_ORDER`（律师 / 助手 / 工具结果 / 摘要 / 回合上下文 / 钉选 / 计划 / 稿面 / 工作区 / 强制规则 / 工具清单 / 系统说明）拆解用量，读取系统消息里的 `<!--lm-ws:id-->` 片段和若干 `## ` 标题，各桶之和严格等于 `used`。

**回合间压缩**（`compact.ts`）：`autoCompactSessionHistory` 在 `level === "compact"` 或历史条数超上限时触发。保留首条系统消息。切点由 `cutIndexForTokenTail` 从最新消息往前装，装到「有效窗口 − 即将写入的摘要字符帽」用尽；一组工具调用整组进或整组出。至少留下当前尾部（`context.midTurn.elideKeepTail`，默认 2 条，超预算也留），条数上限仍是 `maxHistoryMessages`。对被丢弃的区段生成提取式摘要（`buildDroppedSpanDigest`，字符上限由 `resolveCompactDigestCharCap` 决定，并跟历史质量带走）。原文落到 `sessions/<id>.drops/`，整理稿里只留相对路径；上一轮整理稿不再嵌进下一轮。`compact-digest.md` 仍给人读。案件档案、案件会话摘要和草稿只给路径，不把正文贴进提示。这些路径说明是合成用户消息（`【案件材料路径】`），插在**最后一条真实用户消息之前**。回合开始和回合内的自动整理不调用模型摘要。手动整理和承前分叉可以调用 `enhanceCompactDigestWithLlm`，摘要接在提取式原文之后，超限先截摘要。压缩后：

- 记忆蒸馏 `distillCompactIntoMemorySuggestions` 只产出**待确认**建议，绝不静默写入。
- 红线重注 `applyCompactReinjectionToSession`（`compact-reinjection.ts`），确保规则、交付物要求与稿面红线在压缩后仍在。

**回合内压缩**（`mid-turn-compact.ts`）：上限 `MID_TURN_COMPACT_MAX = 3`。先尝试廉价的 `pruneSessionToolResults`，够用就停；否则做完整压缩；若压缩不会真正减少内容则拒绝（`no_reduction`），单条巨型正文则就地中间省略（`elided`）。未整理时的原因按短路顺序区分：`cap`（本回合次数到顶）→ `round_start`（第一次采样前不重复压）→ `below_trigger`（没越线）。次数到顶不得记成 `below_trigger`。

**事实台账**（`compact-fact-pin.ts`）：压缩前从律师原话整句钉住期限、硬约束、引用、金额，写入重注块，不随摘要衰减。单条放不进帽（默认 320 字）就整句不钉，不在字数处切开；总帽仍是 12 条 / 1200 字。指导案例号可以整句进台账。期限除「时效/期限 + 时间量」外，也钉**日历截止日**（`2026年9月30日前`、`2026-09-30` 再加起诉/提交/届满等动作）。没有截止动作的签订日期不钉。任务锚点只钉交办句，贴进来的合同正文不进系统段。

**上下文让渡**（`context-deferral.ts`）：当模型回复同时命中「水位线」与「交回」两类特征时，判定为让渡，插入对律师隐藏的回弹（`【上下文预算】`），最多 `CONTEXT_DEFERRAL_BOUNCE_MAX = 2` 次，回合结束时删除。「分两次」必须带着处理/交办等交回动词才算交回；合同里的「价款分两次支付」即使旁边写了「内容较多」也不算让渡。

**承前分叉**（`session-carryover.ts`）：`forkSessionWithCarryover` 用 `clientNonce` 幂等（对应源会话的 `forkedTo.nonce`）。以下情况会**拒绝**分叉：源会话不存在、回合仍在跑、存在未决授权（`tool_approval` / `matter_approval` / `judgment_escalation` / `workflow_blocked` / `continue_tools`）。成功时构造 `CarryoverDraft`，摘要字符上限 `CARRYOVER_SEED_CHAR_RATIO = 0.1`（clamp 在 8k–32k），消息以 `【前序对话续接】` 标记开头；迁移门禁状态（待澄清键、已确认答案、回合计划、上次能力、已披露工具、案件），并在两端写 `forkedTo` / `carriedOverFrom`，发审计 `session.forked_with_carryover`。桌面入口：用量面板「另起新对话（带上文）」+ 对话内一次性建议卡（`lastCompact.midTurn || compactCount >= 2`，同一会话只提示一次）+ 律师在输入框里直接要求另起 / 重开 / 新开这场对话并带上文（`fork-continue-request.ts`：送给模型之前执行同一条 fork；回合还在跑就改排到结束后，不走 steer）；源会话在侧栏标「→ 由此续接」（`GET /api/sessions` 的 `forkedToSessionId`），新会话顶部渲染「续接来源」卡（`carriedOverFrom`，可展开摘要预览）。

## 3.9 实现：事件流与持久化

`RunTurnEvent` 联合类型（`turn-orchestrator-events.ts`）是前后端共同的事件契约，成员包括：`round_start`、`tool_call_start`、`tool_call_end`、`tool_progress`、`delta`、`clarification`、`final`、`token_budget`、`tool_budget`、`compact_boundary`、`overflow_prune`、`context_deferral_bounce`、`model_error`、`tool_delta`、`requires_action`、`approval_request`、`plan_update`、`intent`。

消费方有三条：

- 会话事件日志：`appendSessionEvent` → 落盘。进程若在写到一半时退出，文件末尾会留下半行 JSON；下次追加会先截回最后一个完整换行，避免新事件粘在半行上、两行一起读不出来。重启后的进度回放只读日志尾部（`SESSION_EVENT_REPLAY_TAIL_BYTES`，256KB）；尾部没有 `turn_begin` 才回退读全文件。全量读取仍留给压缩计数和历史对齐。
- 实时进度：`applyLiveTurnEvent`，对应 `GET /api/sessions/:id/live-turn` 的轮询。
- 桌面：`opts.onEvent` → `/api/chat` 的 SSE 流。

会话持久化以 `sessions/<id>.json` 为真相源（`session.ts`）。会话结构里几个关键字段：`disclosedToolNames`（已披露工具）、`lastCompactBoundary`（最近压缩边界）、`worldStateBaseline` / `worldStateEpoch`（世界状态基线）、`lastConfirmedAnswers`、`forkedTo` / `carriedOverFrom`、`planHandoff`、`turnPlan`。

两条回合中途的注入通道都走**侧车文件**，因为它们必须在 `saveSession` 之后仍然存在：

- 中途指示：`sessions/<id>.pending-steer.json`，上限 8 条 / 2000 字符（`session-context-steer.ts`）。超出条数时丢掉最早的，并在响应里带回 `dropped`；超出字数时保留换行并在末尾标明截断（`truncated`）。
- 中途钉选：`sessions/<id>.pending-pins.json`（`pendingContextPinsPath`，`session-context-inject.ts`），上限 16 份。超出时丢掉最早的钉选（`dropped`），刚补上的材料留在队列里。

两者都只在**模型轮次开始时**被 claim 并并入历史，保证「本轮说的」不会插到已经发出的采样中间。claim 先把侧车改名为同路径的 `.inflight`，等这条内容已经出现在会话历史里再删掉。进程在 `saveSession` 之前退出时，下一轮会把同一批重新交进历史，而不是丢掉律师刚补的话或材料。

事件日志追加在独占锁里完成，并 `fsync`。半行修复和下一行写入不会被另一次追加截断。

## 3.10 实现：会话级并发门与中断

同一会话不允许两个回合同时跑：

- 进程内：一个尾部队列串行化。
- 跨进程：租约文件 `sessions/<id>.turn-gate.json`，超时 `TURN_GATE_STALE_MS = 3h`；冲突时抛 `SessionTurnInProgressError`。租约带 `hostname`。本机用进程是否还活着判断能不能抢；另一台电脑的租约不能靠本机进程号判断（进程号会撞车，对方的进程在这边也看起来像「已退出」），没过 3 小时就拒绝开新回合。

中断与恢复：

- 中断信号绑定 `bindTurnAbortSignal`。绑定**保留**组装期间已经到达的停止（不清掉重来）；200ms 镜像外部 `shouldAbort`。组装期停止不进模型，用户那句不留在历史上。
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
- 中途指示、中途钉选、跟进队列和回合租约（`sessions/<id>.turn-gate.json`）不在会话 JSON 里。claim 后的 `.inflight` 也要一起删。`deleteSession` 会删这些文件；留下租约时，三小时内同 id 开不了新回合。
- 承前分叉在存在未决授权时**必须**拒绝，否则新会话会带着一个无法回应的悬空授权。

## 3.13 消息历史是怎么组织的

会话里送给模型的内容分四类。排查「模型为什么没看到某条信息」时先对这张表：

| 类型           | 存在哪                                                  | 会不会发给模型                 |
| -------------- | ------------------------------------------------------- | ------------------------------ |
| 真实对话       | `session.conversationHistory`                           | 会                             |
| 合成的隐藏消息 | 同上，但带 `hiddenFromLawyer`                           | 会（模型看得到，律师看不到）   |
| 系统提示       | 历史第 0 条 `role:"system"`，每回合按世界状态重写后落盘 | 会                             |
| 采样期注记     | 不落盘：`samplingPromptTail`、窗口剩余 token 注记       | 只附在当次采样末尾，不写回历史 |

系统提示落在历史里，是为了世界状态哈希和提示缓存前缀稳定；变的是回合后缀，不是另存一份「只在内存里的系统提示」。采样期注记若写进历史，会把当次窗口数字和案件尾段变成下一轮的假用户发言。

**第二类容易被误解**：它确实进了模型上下文，只是不在界面上显示。压缩后的摘要、上下文让渡的回弹、同回合验证的说明、连续重复工具调用的提醒，都属于这一类。回合结束时会清理让渡和验证回弹（`collapseHistoryForEnd`）；重复调用提醒留下，下一轮还能看见。

**派生消息的生成**：裁历史、压工具结果是压缩（`compact.ts` / `mid-turn-compact.ts`）的事，不是 `deriveModelMessagesForSampling` 的事。派生做三件送出前的事：修好工具配对并写回会话、把同一条 tool 消息里的多个结果展开成每个 `tool_call_id` 一条 wire 消息（落盘仍是一行）、在水位偏高时于末尾附一条不落盘的剩余 token 注记。不能出现「有调用没结果」，否则模型 API 会拒。

## 3.14 工具结果怎么进历史

一次工具调用的完整往返是两条消息：

```text
assistant 消息（带 toolCalls）
tool 消息（带 toolCallResponses）
```

两者必须成对。有几处专门处理配对：

| 场景                   | 处理                                                            |
| ---------------------- | --------------------------------------------------------------- |
| 模型返回的调用没法配对 | `onToolPairingReject` 自愈：归一化 + 修复配对 + 重存会话        |
| 上下文溢出             | `pruneSessionToolResults` 用更紧预算裁旧回包，最近 2 条保持原样 |
| 压缩时切分历史         | `cutIndexForTokenTail` 按剩余 token 从尾部装，工具组整组保留    |
| 结果太大               | `tool-result-spill.ts` 溢出到文件，历史里留指针                 |

「结果太大就溢出到文件」这条很实用：一份大材料的内容不会整段进历史，历史里只留头尾预览和一句「全文在 `sessions/<id>.spills/<callId>.json`」。那是 JSON，不是文书原件。模型要细节时用 `analyze_document` 按 `offset` / `limit` 分页读这个路径，不能把预览当成全文。

溢出抢救不能再用写入时的那档预算（窗口的 1/8，至少 4k tokens）。回包落盘前已经按那档截过，同预算再剪一次等于没剪，模型请求会直接失败。抢救改为约 1200 tokens，并且留住最近 2 条工具回包。回合中段的预压缩更松一些（约 2000 tokens，留住最近 4 条），避免一越线就把刚读到的材料削掉。

## 3.15 几种「回合没正常结束」的情况

| 现象                             | 落盘状态                    | 律师看到               | 怎么恢复                               |
| -------------------------------- | --------------------------- | ---------------------- | -------------------------------------- |
| 律师点了停止（有进度）           | `paused`                    | 检查点回复 + 待办      | `POST /api/sessions/:id/resume-paused` |
| 律师点了停止（无进度，含组装期） | `error` + `aborted_by_user` | 「已停止生成。」       | 重新发指令                             |
| 进程崩了                         | 占位轮次留在 `running`      | 读出来是 `interrupted` | 恢复或清理                             |
| 模型失败                         | `error`                     | 助手错误气泡           | 修模型配置后重试                       |
| 等审批                           | `awaiting_approval`         | 待我拍板里有条目       | 批准后自动接着跑                       |
| 等澄清                           | `awaiting_clarification`    | 澄清卡片               | 答完自动接着跑                         |

**`interrupted` 不是落盘的原始状态**，它是读的时候给孤儿轮次的一个视图（第 28 章也提过）。

## 3.16 会话的三种「续」入口

名字都带 resume，做的事不是一件。弄混就会以为「点了恢复」已经把卡住的回合跑完了。

| 入口       | 端点                                   | 做什么                                                                             | 不做什么               |
| ---------- | -------------------------------------- | ---------------------------------------------------------------------------------- | ---------------------- |
| 重载历史   | `POST /api/sessions/:id/resume`        | 用转录链修好 `conversationHistory`，带回消息和未决审批计数。侧栏「恢复」走的是这条 | 不开新回合，不放行工具 |
| 暂停后续跑 | `POST /api/sessions/:id/resume-paused` | 律师主动停止且已有进度（`paused`）之后，带着原指令接着办                           | 不处理拍板或澄清       |
| 待办后续跑 | `POST /api/chat/resume`                | 拍板、澄清答复、「继续本件」、记下缺口。服务端按卡片种类分支                       | 不修转录链             |

`/api/chat/resume` 里四种决定：

| 卡片                             | 批准 / 答复                                                                                                             | 拒绝               |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------ |
| 工具审批                         | 新开一轮采样，用 `preApproveToolName` / `preApproveToolArgs` 放行下一次同名调用，参数整组换成律师确认过的，并带回原交办 | 记一条取消，不执行 |
| 澄清                             | 把律师的回答写成下一条指令，附上原交办，清掉硬澄清键                                                                    | —                  |
| 继续本件（崩溃或中断留下的占位） | 带回原指令，从已有工具结果接着办                                                                                        | 弃办，占位轮次收口 |
| 流程缺口                         | 只记账，不再跑                                                                                                          | 按现状封存         |

审批续跑和「重跑整段指令」的差别：历史还在，批准的是**那一次调用**。模型重发时不能改参数，续跑指令里还有原交办，避免只记住工具名。案件作用域以开卡时为准，不跟律师后来切换的案件走。

## 3.17 一次回合里模型能看到什么

按系统提示的组装顺序（第 3.7 节讲了工具表，这里讲提示）。缓存层级以 `SYSTEM_PROMPT_SECTION_CATALOG` 为准。

| 段                      | 内容                         | 缓存层级 |
| ----------------------- | ---------------------------- | -------- |
| 身份与原则              | 「你是 LawMind」+ 核心原则   | static   |
| 自主工作流程 / 审核闭环 | 怎么把指令办到交付           | static   |
| 回答风格 / 安全边界     | 话术和硬边界                 | static   |
| 运行模型                | 当前模型信息                 | session  |
| 强制规则                | 工作区级 + 案件级            | session  |
| 交付物管线              | 本条指令要求什么交付物       | session  |
| 上下文计划              | 分层描述要带哪些上下文       | session  |
| 岗位职责 / 组织         | 助手角色与汇报关系           | session  |
| 法源                    | 权威语料与公开来源           | session  |
| 联网                    | 开/关对应的说明              | session  |
| 律师偏好 / 客户档案     | 过滤后的档案和客户背景       | session  |
| 案件上下文 / 今日日志   | CASE 片段和当天记录          | session  |
| 能力索引                | 未加载、但可以按需打开的能力 | session  |
| 可用工具                | **本轮**工具清单             | session  |

**为什么工具清单不是 static**：静态前缀一旦发出就被冻住（`applySystemPromptToHistory`），好让供应商提示缓存命中。工具表会随披露、权限、联网变。若冻在前缀里，后一轮模型看到的目录和真正能调的工具会对不上。身份、流程、安全边界留在边界之前；工具清单和案件材料留在边界之后，每轮重写。

**两张表的结构**：静态前缀和动态后缀之间有一个分隔标记（`LAWMIND_PROMPT_DYNAMIC_BOUNDARY`），组装时按它切开。`samplingPromptTail` 是另一段，只在采样时附在消息尾部，不写进系统提示前缀。

## 3.18 上下文用量的十二个桶

`estimateTokenBudgetBreakdown` 把用量按桶拆开，供引擎和排查用。桶的顺序与名称来自 `TOKEN_BUDGET_BUCKET_ORDER`（`context-budget.ts`），**共十二个**。律师界面不展示这些桶，也不展示模型窗口数字。

| 桶         | 界面           | 装什么                                        | 律师能做什么                     |
| ---------- | -------------- | --------------------------------------------- | -------------------------------- |
| 律师       | 律师发言       | 律师发的消息                                  | 另起对话                         |
| 助手       | 助手回复       | 助手回复                                      | 整理上下文                       |
| 工具结果   | 工具回包       | 工具返回的内容                                | 通常是变大的主因；整理会先裁这里 |
| 摘要       | 压缩摘要       | 压缩产生的摘要                                | 看摘要是否还够用                 |
| 回合上下文 | 本轮上下文     | 采样尾部，以及系统提示里的当前案件 / 今日记录 | 换案或减少钉进本案的材料         |
| 钉选       | 钉选材料       | 钉的文件内容                                  | 取消钉选                         |
| 计划       | 本轮清单       | 回合计划                                      | 清单完成会变短                   |
| 稿面       | 改稿手艺       | 稿面红线                                      | 一般不动                         |
| 工作区     | 交付与案件设置 | 世界状态里的交付、权限、策略                  | 改当轮交付要求                   |
| 规则       | 强制规则       | 工作区规则和本案规则                          | 改规则文件                       |
| 工具清单   | 工具清单       | 「可用工具」「可按需启用」                    | 解释披露变多之后为什么涨一截     |
| 系统说明   | 系统说明       | 身份、流程、安全边界等固定文字                | 改不了；不要把它当成规则去删     |

世界状态段仍按 `<!--lm-ws:id-->` 归桶。强制规则、工具清单、案件标题按行首 `## ` 切开。切剩的正文归「系统说明」，不再整段叫「规则」。

**排查「为什么很快就被压缩」时看这张表**：先看「工具回包」和「钉选材料」。若「工具清单」突然变大，是本轮披露的工具变多，不是规则文件变长。
