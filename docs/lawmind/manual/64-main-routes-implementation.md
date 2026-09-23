# 第 64 章 实现精读：主路由

第 63 章讲了骨架。这一章讲**主链路上的十个路由文件**：

```text
route-chat.ts            2 条路由   对话回合 + 续跑
route-sessions.ts       14 条路由   会话控制面
route-intent.ts          1 条路由   意图预览
route-review.ts         17 条路由   文书台
route-matters.ts        24 条路由   案件
route-records.ts        11 条路由   任务/会话/草稿列表
route-draft-revision.ts  1 条路由   后台改稿
route-acceptance.ts      6 条路由   验收门（只读）
route-lawyer-desk.ts    24 条路由   律师工作台
route-bootstrap.ts       1 条路由   首屏载荷
```

一共 101 条路由。这一章按「一条请求进来怎么走」的顺序讲。

## 64.1 对话：一个回合的十九步

`route-chat.ts` 只有两条路由（`POST /api/chat` 与 `POST /api/chat/resume`），但它是全服务最重的一条链。

### 十九步

```text
①  pathname 是 /api/chat/resume 且 POST → 交给子处理器
②  不是 /api/chat + POST → 返回 false（让给后面的 handler）
③  解析请求体（schema 失败 → 400 invalid_request_body）
④  message 取 trim 后结果；空 → 400 message_required
⑤  解析工作区根 + 助手档案（找不到 → 500 no_assistant_profile）
⑥  buildAgentConfig；缺 Key → 503（三种码三种文案）
⑦  组装 AgentConfig：
      role        ← buildRoleDirectiveFromProfile(profile)
      allowWebSearch ← resolveChatAllowWebSearch(body.allowWebSearch === true)
      enableCollaboration ← 请求 && 配置 都为真
      permissionMode ← parsePermissionMode(body.permissionMode)
      actorId     ← `${desktopActor}|asst:${profile.assistantId}`
      strictDangerousToolApproval ← 严格模式 或 配置里为真
      只读/仅调研模式 → 强制关协作
⑧  matterId 校验 → 400 invalid_matter_id
⑨  linkedTaskId 校验 → 400 invalid_linked_task_id
⑩  contextPins 校验 → 400 invalid_context_pins
⑪  会议室模式：没案件 → 400 meeting_matter_required；规范化发言角色
⑫  createLawMindAgent(config)；记录 hadSession
⑬  会议室模式 → 拼主题块（三种角色三种开头）+ 可选议程
⑭  看 Accept 头决定要不要流式
⑮  await agent.chat(instruction, { sessionId, matterId, assistantId, ... shouldAbort })
⑯  finally：标 turnFinished、清中止标记
⑰  bumpAssistantStats（新会话 / 回合各记一次）
⑱  记忆上下文与来源报告
⑲  payload 组装（含 edition、runtimeHints、gateDecisions…）
    流式 → SSE payload + done；否则 → sendJson 200
```

### 第 ⑦ 步里的三处「只收窄」

有三处「请求能关，不能开」：

```text
enableCollaboration = body.enableCollaboration !== false && built.config.enableCollaboration !== false
strictDangerousToolApproval = permissionMode === "strict" || built.config.strictDangerousToolApproval === true
permissionMode readonly/research → enableCollaboration 强制 false
```

**前两处都是 `&&` / `||` 方向的选择**：协作要两边都为真才能开；严格审批只要一边为真就是真。第三处是**模式降级时连带收窄能力**——只读模式不该派活给其他助手。

而 `actorId` 的格式值得一提：

```text
${desktopActor}|asst:${profile.assistantId}
```

**`|` 分隔的复合 actor id**——审计里能同时看出「哪个桌面用户」与「哪个助手」。第 59.14 节的审计归因靠它。

### 会议室模式：三种角色三种开头

按 `meetingTurnKind` 拼三段主题块：

| kind         | 主题块开头                  |
| ------------ | --------------------------- |
| `conclude`   | `【会议主持 · 请综合结论】` |
| `chair`      | `【会议主持 · 请你发言】`   |
| 其他（律师） | `【本会发言主题】`          |

后面可以拼一段议程（`【会议议程（律师备忘）】`）。

**「请综合结论」与「请你发言」是两种主持动作**——一个收口，一个点人。

### 一条很容易看错的隔离

`agent.chat` 的 `matterId` 参数不是直接传的：

```text
matterIdForChat && !isAdhocMeetingMatterId(matterIdForChat) ? matterIdForChat : undefined
```

**临时会议（adhoc）那个假案件 id 被排除在案件记忆之外**——所以临时讨论不会污染案件记忆。

### SSE 的事件名顺序

`RunTurnEvent` 翻成 SSE 事件名，可能出现的（不保证全出现）：

```text
round_start        轮开始
tool_call_start    工具调用开始
tool_call_end      工具调用结束
tool_progress      工具进度
delta              增量文本
clarification      需要澄清
final / final_reply  最终回复（两个名字都发，第二个是兼容别名）
token_budget       令牌预算
tool_budget        工具预算
compact_boundary   压缩边界
model_error        模型错误
tool_delta         工具增量
overflow_prune     溢出裁剪
context_deferral_bounce  上下文退让
plan_update        清单更新
intent             意图
payload            最终载荷
done               { ok: true }
```

**`final` 与 `final_reply` 同时发**——`LEGACY_FINAL_SSE_ALIAS` 这个名字说明后者是兼容老客户端的别名。

### 流式的生命周期

```text
Accept 头含 text/event-stream → 流式模式
  ↓
设 SSE 头 + 起 25000ms 的 ping 定时器（": ping\n\n"）
  ↓
req.on("close") → 若回合还没结束就 sseEnd()
  ↓
中止信号 = 连接关了 或 isTurnAbortRequested(abortSessionId)
  ↓
finally：turnFinished = true；clearTurnAbort(abortSessionId)
```

**「连接关了或有人请求中止」两个中止源**——所以律师关掉界面也能停下来。

ping 用的是 `25_000`（25 秒），而 SSE 总线的心跳是 15 秒。**两个数不一样**，因为这条流是「有密集输出」的（回合事件），不需要那么勤的心跳。

### 十三个错误码与它们的文案

这是全服务里错误处理最细的一个文件。

| 码                           | status | 文案                                                                            |
| ---------------------------- | ------ | ------------------------------------------------------------------------------- |
| `invalid_decision`           | 400    | `decision 须为 approve、reject、edit 或 respond。`                              |
| `resume_fields_required`     | 400    | `缺少 sessionId、actionId 或 decision。`                                        |
| `invalid_request_body`       | 400    | （zod 的 message）                                                              |
| `message_required`           | 400    | `请输入对话内容后再发送。`                                                      |
| `no_assistant_profile`       | 500    | `未找到助手配置。请在设置中创建助手或检查 LawMind 根目录下的 assistants.json。` |
| `missing_platform_api_key`   | 503    | 平台模型尚未开通或运维未注入平台 Key…                                           |
| `missing_provider_api_key`   | 503    | 当前模型所属服务商尚未配置 API Key…                                             |
| `missing_api_key`            | 503    | 未配置模型 API Key…                                                             |
| `invalid_matter_id`          | 400    | `案件 ID 格式不正确。请清空关联案件或按规则修改后再试。`                        |
| `invalid_linked_task_id`     | 400    | `关联任务 ID 格式不正确…`                                                       |
| `invalid_context_pins`       | 400    | `本回合重点（contextPins）格式不正确。请移除钉选后重试。`                       |
| `meeting_matter_required`    | 400    | `团队会议室须关联本案（matterId）。请先选中案件再发言。`                        |
| `session_not_found`          | 404    | `会话不存在或已过期。`                                                          |
| `session_turn_in_progress`   | 409    | `该会话已有一轮在执行。请等待完成或中止后再试。`                                |
| `session_assistant_mismatch` | 409    | `该会话属于其他助手，请新开对话或清空会话后重试。`                              |

**三条 503 的文案是第 63.3 节那三个缺 Key 码的展开**（`buildAgentConfig` 只给码，这里配文案）。

**两条 400 的文案都带「怎么改」**：`invalid_matter_id` 说「请清空关联案件」——**它指出了一个比修 id 更简单的出路**。

### 回合错误怎么变成响应

catch 块的四级判定（有顺序）：

```text
① isSessionTurnInProgressError(err) 或 msg 以 SESSION_TURN_IN_PROGRESS 开头 → 409
② msg === "session_assistant_mismatch" → 409
③ resolveModelCallHttpError(err) 有结果 → 用它给的 status / code / message
④ 已经在流式且头已发 → writeStreamError(500, "internal_error", msg)
⑤ 否则抛出（交给 dispatch 的 500）
```

**第 ④ 步是关键**：流式已经开始了就不能再改状态码，只能往流里写一个 `event: error` + `event: done`。

### 那个「类型声明」的教训

`handleChatResumeRoute` 上面有一段长注释：

```text
续跑澄清/拍板（`/api/chat/resume`）。

参数类型只声明它**真正用到**的四个字段：这个子处理器不读 `url` / `pathname`
（路由匹配在父处理器里做完了）。此前写成整个 `LawmindRouteContext`，
而父处理器的调用点没传这两个字段 —— 类型上不成立，运行时无害，
结果是一个**假错误**掩盖了真问题（长此以往「这条链真的没接线」也会被当成噪声）。
```

**这是第 63.17 节那条的出处。** 值得记住的是最后半句：**假错误的长期代价是「真错误也会被当噪声」**。

### `/api/chat/resume` 的六步

```text
① 解析请求体；issues 含 "decision" → invalid_decision；否则 resume_fields_required
② buildAgentConfig；有 error → 503 + "模型未配置，无法继续。"
③ createLegalToolRegistry（按 allowWebSearch / enableCollaboration 装配）
④ resumeTurn(...)，resolvedBy = 桌面 actor id
⑤ 成功：reply / sessionId / status / requiresAction / clarificationQuestions
   / taskId（= turnId）/ inboxKind
⑥ 错误映射：session_not_found→404；in-progress→409；
   action_not_found→404「待处理项不存在或已处理。」；
   unsupported_resume→400「当前待处理类型不支持该操作。」
```

**`taskId: result.turn.turnId`** 这个映射有点绕：续跑返回的 `taskId` 其实是**回合 id**。第 3 章讲过这个历史包袱。

### 请求体没有长度上限

`chatPostRequestSchema.message` 是 `z.string().optional()`——**只要求 trim 后非空，没有 max**。

所以「一条消息能有多长」这件事在服务端**不设限**。真正起作用的是上下文预算与压缩（第 3 章）。

## 64.2 会话控制面：十四条路由

`route-sessions.ts` 里的路径**全是正则**，因为它都要取 `:id`。

### 十四条

| 方法                | 路径                      | 副作用的落盘                           |
| ------------------- | ------------------------- | -------------------------------------- |
| GET                 | `.../context-budget`      | 只读                                   |
| POST                | `.../fork-with-carryover` | **新建会话**（可带 LLM 蒸馏）          |
| POST                | `.../inject`              | 写待处理钉选                           |
| POST                | `.../steer`               | 写待处理中途指示                       |
| POST                | `.../followup`            | 写待处理跟进                           |
| POST                | `.../followup/claim`      | 领取待处理跟进                         |
| POST                | `.../abort`               | 请求中止                               |
| POST                | `.../messages/mutate`     | 改历史 + **saveSession**               |
| POST                | `.../compact`             | 改历史 + **saveSession**（+ 摘要文件） |
| POST                | `.../resume-paused`       | 继续暂停的回合                         |
| POST                | `.../resume`              | 重写历史 + **saveSession**             |
| GET/PUT/POST/DELETE | `.../plan-handoff`        | 会话上的清单交接                       |

**三条路由会改历史并落盘**（mutate / compact / resume）——它们是最敏感的三条。

### 五个上限

| 参数                         | 上限      |
| ---------------------------- | --------- |
| 钉选数（inject）             | 16        |
| 中途指示文本（steer）        | 2000      |
| 跟进文本（followup）         | 8000      |
| 清单交接文本（plan-handoff） | 4000      |
| fork 标题 / clientNonce      | 200 / 120 |

**三个数（2000 / 8000 / 4000）的差别是有意的**：中途指示要短（它会插进当前回合），跟进可以长（它是下一条完整指令），清单是结构化文本。

### 那条「分母必须跟选中的模型」的注释

`context-budget` 那段有两处注释，第一处讲算法口径：

```text
// A6：分母必须跟 compose 里**选中的那个模型**（请求体同样带 modelId 发给 /api/chat），
// 而不是设置里的默认模型——两者可以不同，旧口径会让圆环显示错误的窗口与阈值。
```

**「两者可以不同」**——compose 里能临时换模型。所以用量环的分母必须是**这一轮真正会用到的那个**。

第二处讲它给什么数据：

```text
// A7：本会话压过几次、上次是什么时候——只给「已整理过」的事实，不还原摘要正文。
```

**「只给事实，不还原正文」**——用量环不显示摘要内容，只显示「压过 N 次」。

### fork 的那一步

```text
// 另起新对话并带上文：把源会话蒸馏成续接种子注入新会话（见 agent/session-carryover.ts）。
```

而它支持 `clientNonce`（120 字符）——**所以重复提交同一个 nonce 不会建两个会话**（界面双击的安全网）。

### resume 的两处写法

```text
loadTranscriptForResume → 若长度 > 0
  → session.conversationHistory = [系统消息, ...repairTranscriptChain(transcript)]
  → saveSession
applyDerivedInterruptedAction
计数待批准
```

**注意它先 `repairTranscriptChain` 再写回**——转录链可能被中途打断留下坏配对，读出来修好再存。

而两处注释说明了设计：

```text
// 中断轮次没有收尾，气泡上的「继续本件 / 弃办」靠读时派生（id 稳定 = interrupted:<turnId>）。
```

**「靠读时派生」**——所以「继续/弃办」这两个按钮不需要写状态，它们是从损坏的转录里推出来的。而 id 是稳定的（`interrupted:<turnId>`），所以同一个中断每次都得到同一个 id。

### 六条 409 与它们的文案

| 情况                 | 文案                                             |
| -------------------- | ------------------------------------------------ |
| 领取跟进时回合还在跑 | `当前回合仍在生成，请等结束后再领取 follow-up。` |
| 改消息时回合还在跑   | `当前回合仍在生成，请先停止后再修改或删除消息。` |
| 没有暂停的回合       | （码 `no_paused_turn`）                          |
| 钉选为空             | `请至少选择一份材料`（码 `empty_pins`）          |

**两条「回合还在跑」的文案不同**（一个说「等结束」，一个说「先停止」）——因为**领跟进只能等，改消息必须先停**。这不是文案不一致，是动作不同。

## 64.3 意图预览：一条 89 行的路由

`route-intent.ts` 只有一条路由，但它上面那段注释讲了一个类型契约的修复，值得完整记。

### 请求与响应

请求体字段：

```text
instruction?  matterId?  projectDir?  contextPins  previousCapabilityId?
historyText?  sessionId?(≤128)  mailFastPath?
```

解析逻辑有两处回落：

```text
sessionId 能加载 → 继承 session.lastBoundCapabilityId
historyText 为空 → 从 session.conversationHistory.slice(-8) 拼
```

**「取最近 8 条拼成历史文本」**——所以意图编译能看到一点上下文，而不是只看这一句。

响应只有两种：`200 { ok: true, compiled }` 或三种 400。

### 那段注释里的三层信息

```text
`compileTurnIntent` 的声明只要**已归一**的 pins（`ComposeContextPin[]`），
而请求体允许两种形状：带 `pinKind` 的新形状，以及**不带 `pinKind` 的旧文件 pin**
（`contextPinsRequestSchema` = 新形状 ∪ 旧文件形状）。这里补上模块里本就有的归一器。

⚠️ **这是类型契约修复，不是已证实的用户可见缺陷。**
下游（`peek-pinned-documents.ts` / `compile-intent.ts`）本来就用
`"relPath" in pin` 这类鸭子类型判断，**对旧形状也容得下**——所以行为面很可能一直是对的。
唯一可能的语义差异是 `peekPinnedDocuments` 的 `preferredRoot`（旧形状取不到 root），
且仅在「同一相对路径在 workspace 与 project 下同时存在」时才会显现。
归一失败改 400（原来是形状不对也照传）。回归锁见
`lawmind-server-route-intent.test.ts`（含上述边界说明）。
```

三层值得记：

1. **问题**：类型要求已归一形状，但请求体允许两种形状。
2. **诚实的定性**：`⚠️ 这是类型契约修复，不是已证实的用户可见缺陷。` 而且解释了为什么（下游用鸭子类型，两种形状都容得下）。
3. **唯一可能的语义差异**：`preferredRoot` 取不到，且**只在一种很窄的情况下显现**（同一相对路径在两个根下都存在）。

**这段注释的写法值得学**：它没有把「类型不一致」讲成「bug」，而是明确说清了实际影响范围。**这是「不夸大影响」的写法。**

## 64.4 文书台：十七条路由与三道门

`route-review.ts` 是最大的路由文件（1326 行）。

### 十七条

```text
GET    /api/learning/suggestions              学习建议列表
POST   /api/learning/suggestions/:id/adopt    采纳
POST   /api/learning/suggestions/:id/dismiss  忽略
GET    /api/lawyer-profile/applied-preferences   已生效偏好
DELETE /api/lawyer-profile/applied-preferences/:id  清除
POST   /api/lawyer-profile/learning           律师档案学习
POST   /api/assistants/profile/learning       助手档案学习
GET    /api/tasks/:id                         任务详情（含 checkpoints）
POST   /api/drafts/:id/review                 签批（通过/驳回/需修改）
POST   /api/drafts/:id/render-tracked         导出修订轨 Word
POST   /api/drafts/:id/render                 导出
POST   /api/drafts/:id/reopen-review          恢复待审核
GET    /api/drafts/:id/table.xlsx             审查表 xlsx
GET/PATCH /api/drafts/:id/table               审查表读写
PATCH  /api/drafts/:id/content                律师编辑正文
DELETE/GET /api/drafts/:id                    删草稿 / 读草稿
```

### 门一：严格导出（`strict` 查询参数）

`isRenderGateBypassAllowed()` 只在环境变量开了时返回真：

```text
LAWMIND_ALLOW_RENDER_GATE_BYPASS === "1" 或 "true"
```

注释把这道门讲清了：

```text
?strict=false 的 env 门：与 approve 路径 LAWMIND_ALLOW_CHECKLIST_BYPASS 同级的
显式「破窗」开关。未开启时 URL 参数一律按 strict 处理，验收门禁不被查询参数绕过。
（刻意不含 VITEST 捷径：测试须显式设 env，负向用例才能成立。）
```

**「刻意不含 VITEST 捷径」**是个很有价值的取舍：**测试环境下也必须有破窗开关，否则「不破窗」的负向用例根本测不出来**（因为如果测试环境自动放行，那个用例永远走不到拒绝分支）。

绕过时落审计：

```text
gate_decision = bypass, via = strict_query_param
```

而 `render-tracked` **连破窗开关都没有**：

```text
strictParam !== "false" && strictParam !== "0"    ← 直接判，不查环境变量
```

**修订轨导出不受任何查询参数影响。**

### 门二：律师必核清单

```text
LAWMIND_ALLOW_CHECKLIST_BYPASS === "1" / "true" / VITEST === "true" → 允许绕过
绕过但仍要求 bypassChecklist === true（显式）
绕过时仍会持久化一份「全部勾选」的清单
```

**注意这里 VITEST 是被允许的**（与上一道门相反）。而拒绝时的 403：

```text
交付可靠模式下不可跳过律师必核清单。
```

未完成时的 422：

```text
请完成律师必核清单后再通过签批。
```

**「交付可靠模式」**是个具体的版本词（第 46 章那 18 个功能键之一）。

### 门三：状态 CAS（乐观锁）

请求体带 `expectedReviewStatus`，与当前不一致就：

```text
409 review_status_conflict
草稿签批状态已变化，请刷新后再试。
```

**「请刷新后再试」**——它说清了该怎么办。这道门防的是「两个界面同时签批同一份草稿」。

### 签批的十件事

通过时 `POST /api/drafts/:id/review` 会做：

```text
① CAS 校验
② 清单门（见上）
③ engine.review(draft, { status, note, actorId, assistantId, labels?, deferMemoryWrites? })
④ 持久化 verificationChecklist（specId + checked + updatedAt）
⑤ applyContractRevisionAccumulationAfterApprovedReview（合同修订积累）
⑥ 可选档案追加（律师 / 助手）
⑦ auditReviewGateSnapshot(..., "review", ...)
⑧ SSE：review:status
⑨ SSE：task:update
⑩ 响应附带 citationIntegrity / executionState / gateDecisions
   / profileLearningSkipped / lawyerProfileLearningSkipped / matterWriteFailed
   / contractRevisionAccumulatedId / contractRevisionAccumulationWarning
```

**第 ⑩ 步那三个 `*Skipped` / `*Failed` 字段很值得注意**：签批本身成功了，但「顺手做的档案追加」可能失败。**主操作与副作用分开报告**，不让副作用失败把签批判成失败。

### 删草稿的门

```text
仅 pending / rejected / modified 可删
approved → 409
```

文案（原文）：

```text
草稿当前状态为「<状态>」，不能删除。已签批的交付稿应保留归档；
如确需删除，请先在审核台恢复为待审核。
```

**「应保留归档」+「先恢复为待审核」**——它解释了为什么，也给了一条合法出路。

### 审查表的服务端同步

`PATCH /api/drafts/:id/table` 的可编辑条件是：

```text
reviewStatus === "pending" || "modified"
```

否则 409 `draft_not_editable`。

保存后它会**同步草稿里那个「审查表」栏目**：

```text
找 heading 匹配 /审查表|明细|表格/ 的章节 → 替换正文为 markdown
找不到 → 新增一个 { heading: "审查表", body: markdown, citations: [] }
```

**所以行内编辑表格与模型调 `review_table_update` 是同一份真相源**（第 61.7 节那条）。

而 xlsx 导出是**临时文件**：

```text
写 os.tmpdir()/lawmind-review-table-<id>.xlsx → 发出去 → 删掉
```

它上面有一段注释专门讲那个 `...c` 的坑：

```text
// ⚠️ 与诊断包同一个坑：**手写 writeHead 必须带 `...c`**（CORS 头）。
// 渲染层对本服务是跨源；漏了它浏览器会直接拦掉响应（`Failed to fetch`，
// 几毫秒内失败、与超时无关），而服务端日志里一切正常。
```

**「与诊断包同一个坑」**——说明这个错犯过两次以上，所以有结构守卫测试（第 63.2 节）。

### 律师编辑正文的溯源

`PATCH /api/drafts/:id/content` 会记「改了什么」：

```text
provenance kind = lawyer_edit
diffSummary 三种：新增章节 / 编辑正文：<改了哪几部分> / （标题、正文、引用）
审计 kind = draft.content_edited
updateTaskRecord
recordRewriteAmplitude({ source: "lawyer_edit", assistantId: actorId })
```

**`changedParts` 的三项**（`标题` / `正文` / `引用`）就是 diffSummary 的构成元素。

而 `recordRewriteAmplitude` 记的是「律师改了多少」——这是第 41 章那个「改写率」指标的数据来源。**`assistantId: actorId` 这个赋值有点怪**（把它记成助手 id），但结果是「律师编辑也进同一个改写幅度账本」。

### `deriveReviewExecutionState` 的六句

给界面显示的执行态文案（原文）：

```text
等待律师签批。
草稿已标记为需修改，等待修订。
草稿已驳回，等待新指令。
草稿已通过并完成交付物渲染。
出稿检查未通过，暂不可渲染。
草稿已通过签批，可执行渲染交付。
```

**六句都是「状态 + 下一步」**，不是「状态：xxx」。

### 三条 422 的文案分工

| 场景                      | 文案                                                                       |
| ------------------------- | -------------------------------------------------------------------------- |
| `render-tracked` 未过验收 | （只给码 `acceptance_gate_blocked` + acceptance 数据）                     |
| `render` 未过验收         | `草稿未通过出稿检查，存在阻塞项；请补齐缺失章节或回答待确认问题后再导出。` |
| `render` 清单未齐         | `导出被拦截：出稿检查未齐，请在改稿页补齐后再导出。`                       |

**后两条的差别说明了「验收」与「必核清单」是两件事**：

- 验收没过 → 补章节 / 回答待确认问题
- 清单没勾完 → 去改稿页补勾

## 64.5 案件：二十四条路由与一份聚合

`route-matters.ts` 是第二大的路由文件（1094 行）。

### 三张分组

**案件对象类**：

```text
/ops            项目级操作（GET 读 / PATCH 写基线·计划·RAID / POST 追加 RAID）
/theory         理论侧车（GET/PUT）
/team-roster    团队名册（GET/PUT）
/team-meeting   会议窗口（GET）
/case-note      卷宗笔记（POST，四种小节）
/interaction    交互审计（POST）
/overviews      概览列表（GET）
/interaction-rollup  交互汇总（GET）
```

**案件生命周期类**：

```text
/role                目录角色（GET/POST）
/create              新建
/profile             更新档案
/display-name        改显示名
/repair-projections  修投影漂移
/delete              删除（fs.rm）
/review-matrix       审查矩阵（GET）
/review-matrix/export 导出 CSV
/session-timeline    会话时间线
/detail              详情聚合
/search              检索
（GET /api/matters）  列表
```

**另外两条挂在别的前缀下**：

```text
GET /api/approvals   审批列表
GET /api/queues      工作队列
```

**这两条放在案件文件里有点意外**——它们是「跨案件的」，但按「案件索引」的形状返回。所以实现上归到这里了。

### `/detail` 那一份聚合

`GET /api/matters/detail` 返回十四个字段：

```text
summary / overview / profile / caseMemory / coreIssues / taskGoals
/ riskNotes / progressEntries / artifacts / tasks / drafts
/ approvalRequests / queueItems / draftCitationIntegrity / auditEvents
```

**十五个来源拼成一次响应**——所以界面打开「案件驾舱」不需要发十几个请求。

三处截断：

| 字段                              | 上限                                   |
| --------------------------------- | -------------------------------------- |
| `caseMemory`                      | 120000 字符（超出追加 `…[truncated]`） |
| `auditEvents`                     | 最近 80 条                             |
| `queueItems` / `approvalRequests` | 由各自的列表函数管                     |

### `/search` 与 `/matters` 的上限

```text
GET /api/matters/search → hits.slice(0, 60)
GET /api/matters/session-timeline → limit 默认 40，夹在 [5, 100]
GET /api/matters/team-meeting → clamp 在 [1, CAP]
GET /api/matters/interaction-rollup → 最多 180 天、20000 事件
```

**`interaction-rollup` 那两个数（180 / 20000）是硬顶**——因为它是**全工作区扫盘**式的聚合。

### 那条「避免 N× 全量扫盘」的注释

```text
// 一次读近期 audit，再按 matter 分桶——避免 N× buildMatterIndex 全量扫盘
```

**「避免 N×」**：如果每个案件都调一次 `buildMatterIndex`，N 个案件就是 N 次全扫。改成「读一次审计再分桶」。

### W10 的两条兼容注释

```text
// W10：兼容新旧 kind；同 taskId+detail+timestamp 视为重复，仅取一条。
// W10：双写新 kind ux.matter_action（季末考虑 sunset 旧 kind）。
```

**第一条是一个去重规则**：三元组（taskId + detail + 时间戳）相同就算重复。**「仅取一条」**——避免同一动作被记两次。

**第二条是「双写过渡」**：同时写新旧两个事件类型，等一个季度再退掉旧的。**「季末考虑 sunset」**这种写法说明这个仓库保留了「过渡期」的概念（第 39 章整章讲这个）。

### 那条「闭合 12 类」的合同类型注释

`user standards` 的写入 schema 里有一处收紧了类型，注释讲得很透：

```text
必须是**闭合的 12 类合同 id**，不是任意字符串。

为什么在这里收紧（而不是继续容忍任意字符串）：
`user-standards.ts` 的 `parseBindWhen()` 会把未知 id **静默过滤掉**——那条容忍
属于**读路径**（文件可能被手工编辑），但这里是**写路径**，来自我们自己的设置面。
容忍任意字符串的后果是：律师填了个中文标签（如「买卖合同」）→ 落盘时被丢掉 →
这条标准永不命中任何案件，且**没有任何提示**。这正是本仓反复出现的
「写了但不生效」。宁可 400 说清楚，也不要存一条哑标准。
```

**这是一段教科书式的取舍说明**：

1. **读路径宽容、写路径严格**——因为读的是可能被手工编辑的文件，写的是我们自己的界面。
2. **容忍的后果是一条完整的因果链**：填中文标签 → 落盘被丢 → 永不命中 → 无任何提示。
3. **它命名了这个模式**：「写了但不生效」——而且说这是「本仓反复出现的」。
4. **结论**：「宁可 400 说清楚，也不要存一条哑标准。」

### 新建案件的两个字段与状态

```text
conflictCheckRequired = !conflictCheckConfirmed
status = conflictCheckConfirmed && engagementAccepted ? "active" : "intake"
```

**两个布尔决定初始状态**：确认了利益冲突检查且接受了委托才是 `active`，否则停在 `intake`。

而未确认利益冲突检查时，会开一条队列项：

```text
title:  "完成利益冲突检查"
detail: "在正式接受委托和处理客户材料前，确认客户及相关方不存在利益冲突。"
priority: "high"
```

**注意它在「正式接受委托前」的位置**——所以这条待办是**前置的**，不是提醒。

### 四条 `matterId` 解析的防线

注释：

```text
/** 解析 `<workspace>/cases/<matterId>` 并防止穿越 `cases` 根目录。 */
```

而 `role` 那两条路由还接受两种词：

```text
"matter" | "case"    → "matter"
"folder" | "storage" → "folder"
```

**「案件目录」与「材料目录」两种角色，各有两个词**——容忍律师/旧版的叫法。

### 常见的四类错误码

```text
invalid matter id        （十几处）
invalid ops body / invalid theory body / invalid profile body / invalid request
matter not found（404）
invalid matter path      （删除时）
displayName required / displayName too long
role must be matter or folder
matterId required
```

**`invalid matter id` 出现最多**——因为几乎所有案件路由都先过这道校验。

## 64.6 记录列表：十一条路由与一条「不要重复实现」

`route-records.ts` 管任务、会话、草稿的列表。

### 十一条

```text
GET    /api/tasks        任务列表（带筛选）
GET    /api/sessions/:id/live-turn   实时回合进度
POST   /api/sessions     建会话
POST   /api/sessions/delete  删会话
GET    /api/sessions/search  搜会话
GET    /api/sessions/:id     读会话
PATCH  /api/sessions/:id     改标题
DELETE /api/sessions/:id     删会话
GET    /api/sessions     会话列表
GET    /api/drafts       草稿列表
GET    /api/history      任务+草稿合并历史
```

**「会话 CRUD 其实在这里，不在 `route-sessions.ts`」**——这是第 63.18 节那张表里最容易找错的一条。

### 那条「不要重复实现」的注释

```text
// GET /api/tasks/:id 的权威实现在 route-review（含 checkpoints；先注册先匹配）。
// 此处不再保留重复实现，避免两版响应形状漂移。
```

**「避免两版响应形状漂移」**——所以删掉了一份重复实现，靠注册顺序（`review` 在 `records` 之前）保证正确的那份生效。

**这条值得单独记**：它是「路由表顺序有语义」的一个真实后果。**如果你把 `records` 挪到 `review` 前面，`GET /api/tasks/:id` 就会 404。**

### `GET /api/history` 的合并形状

```text
{ kind: "task" | "draft", id, label, updatedAt, createdAt?, status?, outputPath?, matterId?, taskRecordKind? }
按 updatedAt 倒序
items.slice(0, 200)
```

**上限 200**，而标签截 120 字。

### 会话筛选的一个细节

```text
sessionMatchesAssistantFilter:
  session.assistantId === assistantId
  或 !session.assistantId && assistantId === DEFAULT_ASSISTANT_ID
```

**第二条是兼容**：老会话没有 `assistantId` 字段时，视为默认助手。**「兼容」写在这里而不是在数据迁移里**——所以老会话一直能被读到。

### 删会话的三个入参

```text
DELETE 用 query：cascadeDelegations=1、cascadeUnapprovedDrafts=1
POST   用 body 布尔
```

**两个入口同一件事**（DELETE 与 POST `/api/sessions/delete`）——因为有的客户端不方便带 body。

而助手不匹配时是 **404 而不是 403**：

```text
该会话属于其他助手，无法在此删除。请切换到对应助手后再试。
```

**「无法在此删除」+「请切换助手」**——说明这不是权限问题，是「走错了地方」。

### 幂等删除

```text
{ ok: true, sessionId, alreadyDeleted: true }
```

**重复删除不报错**——返回一个「已经删过了」的标记。

## 64.7 后台改稿：一条路由与一次重试

`route-draft-revision.ts` 只有一条路由，但它的头注释说明了它为什么单独一个文件：

```text
POST /api/drafts/:taskId/revision-job — 文书台「提交改稿」后台修订
（与 handleReviewRoute 解耦，便于 dispatch 显式挂载）。
```

### 那条关于「关 strict 但不放开危险工具」的注释

```text
文书台「提交改稿」为律师显式授权的后台修订：关闭 strict 即可让
update_draft / write_document 顺畅执行（二者本就无需工具批准）。
不再放开 allowDangerousToolsWithoutApproval——send_email / render_document 等
交付/外发类危险工具在后台修订中必须仍走批准，避免静默出稿/外发。
```

**这是两条独立开关的精确用法**：

| 开关                                 | 后台改稿时的值 | 后果                   |
| ------------------------------------ | -------------- | ---------------------- |
| `strictDangerousToolApproval`        | `false`        | 改稿类工具不再要批准   |
| `allowDangerousToolsWithoutApproval` | `false`        | **危险工具仍然要批准** |

**「避免静默出稿/外发」**——如果两个都放开，模型就能在后台直接出稿甚至发邮件。所以只放开第一个。

### 提交与轮询

提交是**立即返回**：

```text
{ ok: true, queued: true, sessionId, assistantId,
  statusUrl: "/api/sessions/<id>/live-turn" }
```

**状态查询走两条路**（注释原文）：

```text
// 后台修订进度/失败均可查询：live-turn（进行中）与审计 draft.revision_*（终态）。
```

所以「进行中」看 `live-turn`，「终态」看审计事件。

### 三个上限

| 常量         | 值                      |
| ------------ | ----------------------- |
| 指令总长     | 48000                   |
| 补充说明     | 12000                   |
| 工具调用下限 | `max(配置值 ?? 16, 24)` |

**「工具调用下限 24」**——因为改稿是个多步活，默认的 16 可能不够。所以这里**抬到 24**。

**注意这是全服务里少见的一次「放宽」**——它不是收窄。理由是「这是律师显式授权的后台活」。

### 一次重试与「没落盘」的判定

```text
第一次 agent.chat 完 → 检查 draftRevisionWasPersisted(...)
没落盘 → 用 buildRevisionRetryInstruction 再跑一次
还没落盘 → finishLiveTurnProgress(..., "failed") + 抛错
```

抛错的文案（原文）：

```text
revision_not_persisted: 助手未将修订写入 drafts 文件，请查看对话后重试或手动恢复待审核。
```

**「请查看对话后重试或手动恢复待审核」**——给两条出路：看对话（诊断）或手动恢复（继续用）。

这条检查的意义在于：**模型说「改好了」不等于文件真的改了**。所以要点检落盘。

### 成功后的六件事

```text
① generateRedlineAfterWrite（生成红线）
② bumpAssistantStats
③ engine.reopenDraftReview（恢复为待审核）
④ recordRewriteAmplitude（记改写幅度）
⑤ 审计 draft.revision_completed
⑥ suggestLearningFromDraftReview（学习建议，note 截 600）
```

**第 ③ 步把草稿恢复成「待审核」**——所以后台改稿完成后，律师会看到一份新的待审核稿。

### 三个前置拒绝

```text
invalid task id                          （id 不合法）
draft_not_found + 未找到该草稿文件（workspace/drafts/<taskId>.json）。请确认工作区一致后刷新文书台再试。
revision_job_requires_modified + 请先将签批标为「需修改」，再使用「提交改稿」。
```

**第二条的文案把文件路径都写出来了**——因为「找不到草稿」最常见的真实原因是**工作区不一致**。

第三条说明流程顺序：**先标「需修改」，才能提交改稿**。这是界面上那个按钮的 disabled 条件在服务端的对应实现。

## 64.8 验收门：六条只读路由

`route-acceptance.ts` 的头注释解释了它为什么单独一个文件：

```text
这些只是**只读**端点，新增端点不修改任何现有路由文件，方便多 agent 并行开发。
注意：放在独立文件里，挂在 dispatch 中即可。
```

**「方便多 agent 并行开发」**——这是刻意为了让多个开发者不撞同一个文件。**这也解释了为什么路由要拆成 55 个文件。**

### 六条

```text
GET /api/drafts/:id/acceptance        单份验收报告
GET /api/drafts/:id/acceptance-pack   验收材料包（Markdown 或 JSON）
GET /api/drafts/:id/checklist         必核清单视图
GET /api/deliverables/specs           全部规格
GET /api/acceptance-summary           批量汇总
GET /api/policy/edition               版本与功能开关
```

### 那个「`passed` 不是 `ok`」的 bug

这个文件的注释里有一条很有价值的事故记录：

```text
// `AcceptanceCheck` 的字段是 `passed`，**不是** `ok`。...
// 此前写成 `!c.ok`：`c.ok` 永远是 undefined，`!undefined === true`，
// 于是**每一项 blocker 都被算成「未通过」**（连已通过的也计）——
// 这个计数是律师可见的，等于把接受度概览整体报高。
```

**这是一个「永远为真」的经典错误**：`!undefined === true`，所以每个检查项都被算成未通过。

而后果说得很实在：**「把接受度概览整体报高」**——因为「未通过」的计数被虚增了。

**这条值得记住的原因**：它不是逻辑复杂导致的，是**字段名猜错**导致的。而它逃过类型检查的原因大概是 `c.ok` 在某个类型里存在过（或用了 `any`）。

### 批量汇总的响应形状

```text
每份草稿：{ taskId, matterId, title, deliverableType, reviewStatus,
           ready, placeholderCount, blockerCount, warningCount,
           topBlockers(前 3), hasSpec, outputPath }
总计：   { ok, matterId, count, readyCount, blockedCount, items }
```

**`topBlockers` 只给前 3 条**——因为这是汇总视图（细节在单份的 `acceptance` 里）。

而它的设计意图（注释原文）：

```text
Bulk acceptance summary for the matter cockpit; lets MatterWorkbench paint
per-draft readiness badges without N+1 calls into /api/drafts/:taskId.
```

**「避免 N+1 次调用」**——一次拿全，而不是每个草稿发一次。

### 版本读取的桥接注释

```text
Bridge the desktop's `LawMindPolicyFile` to the engine's `LawMindWorkspacePolicy` —
the two shapes already share keys; we only forward what we know is safe to read.
```

**「只转发我们确定能安全读的键」**——五个键：`schemaVersion, allowWebSearch, retrievalMode, enableCollaboration, edition, citationMode`。

### 功能未开时的 403

```text
{ ok: false, error: "feature_disabled", feature: "acceptancePackExport", edition,
  hint: "当前版本（<版本>）未开启验收材料包导出。请检查「设置 → 版本」中的功能开关。" }
```

**`hint` 指向了具体在哪改**——「设置 → 版本」。

### 权威引用校验的跳过分支

```text
{ ok: true, skipped: true, issues: [], message: "未启用 LAWMIND_AUTHORITY_CITATION_VALIDATE。" }
```

**跳过时返回 `ok: true`**——因为「没开这项检查」不是「检查失败」。

### 一条引用提示的提取

```text
citationHints：正则 /《[^》]+》第?[零一二三四五六七八九十百千0-9]+条/g，最多 20 条
```

**它从正文里抓「《法律名》第X条」这种引用**——用来在验收报告里提示「这里引了法条」。

## 64.9 律师工作台：二十四条路由

`route-lawyer-desk.ts` 的头注释只有一行，但它的路由覆盖了工作台的全部功能。

```text
Lawyer 工作台 APIs: today, deadlines, events, standards, intake, similar cases.
```

### 五组

| 组         | 路由                                                                                                                                       |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| 今日与案件 | `/desk/today`、`/desk/replica-feed`、`/desk/matters`                                                                                       |
| 今日计划   | `POST /desk/plan`、`PATCH /desk/plan/items/:id`、`POST /desk/plan/source-done`                                                             |
| 期限       | `GET/POST /matters/:id/deadlines`、`/deadlines.ics`、`PATCH /matters/:id/deadlines/:deadlineId`                                            |
| 期限抽取   | `POST /desk/events/extract`、`/desk/events/extract-file`、`/desk/events/confirm`                                                           |
| 标准与口径 | `GET/POST /workspace/standards`、`DELETE /workspace/standards/:id`、`POST /desk/standards/match`、`GET/POST /workspace/cause-lexicon`      |
| 案件侧车   | `/matters/:id/pulse`、`/intake-brief`、`/intake-brief/confirm`、`/similar-cases`、`/materials/search`、`/precedents`、`/matters/:id/cause` |

### 期限的三处设计

**① 提醒时长的范围**：

```text
remindBeforeHours：整数 0..720（30 天）
```

**② 期限可挂前置**：

```text
dependsOnDeadlineId（≤64 字符）
```

这就是第 7.5 节讲的「等待前置待办」。

**③ 期限有四种状态**：

```text
open  snoozed  completed  missed
```

**注意有 `missed`**——所以「过期」是一个显式状态，不是靠日期算出来的。

### ICS 导出

`GET /api/matters/:id/deadlines.ics` 走 `formatDeadlinesIcs`，**手工 `writeHead` 时必须带 `...c`**（同一类坑）。

### 期限抽取的三个上限

| 参数           | 上限       |
| -------------- | ---------- |
| 文本抽取       | 20000 字符 |
| 文件抽取的路径 | 500 字符   |
| 确认时的事件数 | 1..12 条   |

**确认时最多 12 条**——所以「抽出来 30 条」得分批确认。

而文件抽取失败时的文案：

```text
文件未读出文字，请换材料或手填。
```

**「请换材料或手填」**——两条出路，其中一条是「不用 AI」。

### 标准匹配的两个键

```text
POST /desk/standards/match
  skipIds: 已经用过的标准 id
  contractType: 请求给的，或从指令里 inferClosedContractType 推的
```

**「跳过已用过的」**——避免同一个标准反复出现。

而标准的三种口气（`tone`）：

```text
check          要核对
never_accept   绝不接受
must_rewrite   必须改
```

**这三个词就是第 58.10 节讲的「执业口径三份标准」的落点。**

### 材料检索与先例检索

```text
GET .../materials/search → searchMaterials(..., { limit: 20 })
  注释：材料全文检索：materials_fts（trigram），命中带 relPath + page。

GET .../precedents → searchPersonalKnowledge(..., { limit: 8, kinds: ["precedent"] })
  citeAs：旧案 <matterId> · <section 或 path>
  排除本案
  注释：可引用先例：旧案已签批交付物摘录（跨案检索默认关，诚实回报未开启）。
```

**两处细节**：材料检索带**页码**（因为 PDF 有页）；先例的 `citeAs` 里带**旧案 id**（所以引用可追溯）。

**「诚实回报未开启」**——跨案检索关着的时候要明确说，而不是返回空。

### 计划项的接口形状

```text
POST /desk/plan       → texts 数组（1..20 条，每条 ≤500 字）+ 可选日期
PATCH /desk/plan/items/:id → done 布尔 + 可选日期
POST /desk/plan/source-done → source ∈ {mail, deadline, approval} + sourceRef
```

**第三个是「按来源标记做完」**：邮件、期限、审批三种来源各能一键标完成。

**20 条上限、每条 500 字**——所以「今日计划」是个短清单。

### 那个 `writeId` 从哪来

两个端点返回 `writeId`：

```text
POST /api/desk/events/confirm      → { ok, deadlines, writeId }
POST .../intake-brief/confirm      → { ok, brief, writeId }
```

**`writeId` 是「可撤销写入」的凭据**。但如第 63.18 节所说，**没有 HTTP 端点能撤销它**——只有模型能调 `revert_desk_write` 工具。

所以这两个响应里的 `writeId` 是**给模型看的**（它拿到后能在同一回合里撤销自己刚做的写入）。

## 64.10 首屏载荷：一条路由，一次装齐

`route-bootstrap.ts` 只有 97 行，但它是渲染层的第一个请求。

### 那条注释

```text
// 渲染层只把 /api/bootstrap 的 health 当全量 health 用（见 mapHealthState）：
// 联网检索、检索模式、起草大模型这些标志都必须在这里给出，否则设置页会一直停在默认态。
```

**「否则设置页会一直停在默认态」**——这是一条踩坑记录：如果这里漏了某个标志，设置页不会报错，只会**显示默认值**。**静默错误。**

### 载荷的四块

```text
health      模型/联网/检索/起草大模型/策略/体检/记忆真相源
edition     版本 id、标签、功能开关
assistants  助手列表（含用量统计）
presets     助手预设
records     四个计数：任务 / 草稿 / 案件 / 待审核
```

`health` 里面有二十来个字段，其中几个值得记：

```text
missingApiKey = !modelConfigured        ← 注意这是取反
modelError = built.error ?? null
modelName = built.config?.model?.model ?? null
policy = 加载了 → { loaded: true, allowWebSearch: policy.allowWebSearch ?? null }
       否则    → { loaded: false }
```

**`missingApiKey` 是 `modelConfigured` 的取反**——两个字段都发，因为界面两个地方都用（一个判断能不能用，一个显示提示）。

而 `policy` 在未加载时**只给 `{ loaded: false }`**——不编造默认值。

### 助手用量统计的默认值

```text
{ lastUsedAt: "", turnCount: 0, sessionCount: 0 }
```

**三个字段都给了初值**（不是 `undefined`）——所以界面不用做空值处理。

### `pendingReviewCount` 的定义

```text
drafts.filter(d => d.reviewStatus === "pending").length
```

**只算 `pending`**，不算 `modified`。所以「待审核」在首屏这个数字里不含「需修改」。

**这个口径与界面上「待签批」的分组（第 62.2 节 `fleetGroupLabel`）可能不同**——因为后者把 `awaiting_review` 与 `awaiting_clarification` 都算进去。**两个数字用途不同，不该期望相等。**

## 64.11 已知坑（本章相关）

- **`POST /api/chat` 的 message 没有长度上限**（只要求 trim 后非空）。
- **流式已开始后不能再改状态码**，只能往流里写 `event: error`。
- **两个 ping 间隔不一样**：对话流 25 秒，SSE 总线 15 秒。
- **会议室模式的 `matterId` 会被剔除 adhoc 假 id**（不进案件记忆）。
- **`enableCollaboration` 要两边都为真**；`strictDangerousToolApproval` 只要一边为真。
- **只读/仅调研模式会强制关协作。**
- **三条 503 缺 Key 文案由路由层配**（`buildAgentConfig` 只给码）。
- **会话 CRUD 在 `route-records.ts`，不在 `route-sessions.ts`。**
- **`GET /api/tasks/:id` 的权威实现在 `route-review.ts`**——注册顺序反了就会 404。
- **只有三条会话路由会改历史并落盘**（mutate / compact / resume）。
- **`?strict=false` 的破窗开关刻意不含 VITEST 捷径**（否则负向用例测不出来）。
- **`render-tracked` 连破窗开关都没有。**
- **必核清单的绕过开关含 VITEST 捷径**（与上一道门相反）。
- **签批的副作用失败单独报告**（`*Skipped` / `*Failed` 字段），不把签批判成失败。
- **已签批的草稿不能删**，要先去恢复为待审核。
- **审查表 xlsx 走临时文件，发完即删**——手写 `writeHead` 必须带 `...c`。
- **`recordRewriteAmplitude` 把律师编辑记成 `assistantId: actorId`**。
- **案件的 `role` 路由接受四个词**（matter/case/folder/storage）映射成两种角色。
- **新建案件会开一条高优先级「完成利益冲突检查」待办**。
- **`interaction-rollup` 有 180 天 / 20000 事件的硬顶**（它是全工作区扫）。
- **闭合 12 类合同 id 在写路径上被收紧**——容忍任意字符串的后果是「写了但不生效」且无提示。
- **`GET /api/history` 上限 200 条。**
- **删会话助手不匹配返回 404 而不是 403。**
- **后台改稿只关 `strictDangerousToolApproval`，不关 `allowDangerousToolsWithoutApproval`**（否则会静默出稿/外发）。
- **后台改稿会把工具预算抬到至少 24。**
- **后台改稿完成后必须点检「文件真的落盘了」**，没落盘要重试一次。
- **`AcceptanceCheck` 的字段是 `passed`，不是 `ok`**——写成 `!c.ok` 会让每个检查项都被算成未通过（第 64.8 节那起事故）。
- **`acceptance-summary` 的存在是为了避免 N+1 次调用。**
- **验收材料包未开时返回 403 + 「去哪开」的 hint。**
- **权威引用校验跳过时返回 `ok: true`**（不是失败）。
- **期限有四种状态，含 `missed`**（过期是显式状态）。
- **`writeId` 出现在两个响应里，但没有 HTTP 端点能撤销它**——只有模型工具能。
- **`/api/bootstrap` 漏了标志不会报错，只会让设置页停在默认态。**
- **`missingApiKey` 是 `modelConfigured` 的取反**（两个字段都发）。
- **`pendingReviewCount` 只算 `pending`**，与界面上的「待签批」分组口径不同。
