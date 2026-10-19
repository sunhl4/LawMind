# 第 62 章 实现精读：渲染层交互契约

第 50 章讲了渲染层的**架构模式**（props hook、pick 收窄、状态三层）。这一章讲**每个面板的交互契约**：它接受什么、点下去发生什么、什么被存进了浏览器。

「契约」在这里是有意义的词——因为很多约束**被测试守着**（第 62.7 节列出相关测试）。

**本章口径**：2026-10 对照 `apps/lawmind-desktop/src/renderer/` 当前源码逐条核过。与旧版最大的差别：在办（fleet）、会议室、旧案件工作台、独立改稿页这一整簇组件**已不在主区挂载**（`docs/LAWMIND-CODE-AUDIT.md` 第 1.1 节，104 文件退役集群），本章不再把它们的契约当活契约写，只在第 62.1 节末尾与第 62.7 节如实标注。

## 62.1 律师能打开的工作面

`LawmindMainView` 类型里有六个值（`lawmind-main-view.ts`）：`workspace` / `desk` / `agents` / `meeting` / `review` / `archive`。但**类型里有 ≠ 进得去**。实际能进入的工作面是这些：

| 工作面                    | 入口                                                                        | 实际渲染                                                                                                                                                                                                                     |
| ------------------------- | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 对话（`workspace`，默认） | 顶栏 Tab `lm-tab-workspace`                                                 | `LawmindWorkspaceMainPane`（中栏 + 右侧对话列）                                                                                                                                                                              |
| 工作台（`desk`）          | 顶栏 Tab `lm-tab-desk`                                                      | **不是另一页**：根壳把它收成「对话 + 中栏案卷」（`lawmind-app-root.tsx` 里 `setMainView("desk")` 实际置 `matterCockpitOpen`，中栏换成 `LawmindLawyerWorkbench`，testid `lm-desk-middle`）                                    |
| 在办（`agents`）          | 全局搜索 `/agents`（`lawmind-app-root.tsx`）；**顶栏没有 Tab**              | 整页 `LawmindLawyerWorkbench`（错误边界文案「在办」）——和工作台中栏是**同一个组件**                                                                                                                                          |
| 改稿                      | 对话命令 `/review`、工作台文书、自动办件「去审阅」                          | `LawmindMiddleDraftDesk`（`lm-middle-draft-desk`）叠在对话中栏，里面挂 `ReviewWorkbench`。`mainView` 仍是 `workspace`；`mainView === "review"` 会被根壳 effect 立刻拨回对话，`LawmindMainBodyContent` 对它直接 `return null` |
| 整理资料（`archive`）     | 设置 → 工作区「整理电脑上的资料」（入口 testid `lm-archive-organize-open`） | 整页 `LawmindArchiveOrganizePage`；仅当已经在这个值上，顶栏才出现次级 Tab `lm-tab-archive`                                                                                                                                   |
| 设置                      | 侧栏/顶栏齿轮                                                               | 整页替换主区，侧栏整段不渲染；Esc 或「← 返回」退出                                                                                                                                                                           |

类型里的 `meeting` 没有可达路径：生产代码没有任何 `setMainView("meeting")`，深链处理器名为开会、实际落到对话。`LawmindMainBodyContent` 的 `meeting` 分支会落到对话主面板。

### 对话：三层拆分

对话面在渲染层是三个组件叠起来的：

| 文件                               | 导出                                           | testid                                      |
| ---------------------------------- | ---------------------------------------------- | ------------------------------------------- |
| `app/LawmindWorkspaceMainPane.tsx` | `LawmindWorkspaceMainPane`                     | `lm-workspace-unified`、`lm-chat-drop-zone` |
| `lawmind-chat-shell.tsx`           | `LawmindChatComposeFooter`、`LawmindChatShell` | `lm-compose-drop-zone` + 两条快车道         |
| `lawmind-chat-messages-column.tsx` | `LawmindChatMessagesColumn`                    | `lm-chat-empty`、`lm-chat-messages-end`     |
| `LawmindChatMessageRow.tsx`        | `LawmindChatMessageRow`                        | 十个（见下）                                |

**两个 drop zone + 两条快车道**：

```text
lm-chat-drop-zone            ← 对话主面板（松手进本回合上下文）
lm-compose-drop-zone         ← 输入区
lm-compose-mail-fast-lane    ← 邮件/合同快车道（同一张卡 LawmindMailContractFastLaneCard）
lm-compose-research-fast-lane ← 研究快车道
```

丢文件进对话列走 `POST /api/sessions/{id}/inject`（body 带 `contextPins`，仅本轮还在跑且已有会话时）。

### 消息行的十个 testid

`LawmindChatMessageRow` 是交互最密的一个。当前源码里恰好十个（`rg 'data-testid' LawmindChatMessageRow.tsx` 可复数）：

| testid                                      | 干什么                                            |
| ------------------------------------------- | ------------------------------------------------- |
| `lm-msg-edit` / `lm-msg-edit-submit`        | 编辑消息（入口与编辑框共用一个 id，确认单独一条） |
| `lm-msg-delete` / `lm-msg-delete-assistant` | 删消息（**两条，用户消息与助手消息分开**）        |
| `lm-msg-gate`                               | 门禁标记                                          |
| `lm-chat-working`                           | 回合进行中的「正在办理…」                         |
| `lm-authority-gap-banner`                   | 权威缺口横幅                                      |
| `lm-demo-corpus-banner`                     | **演示语料横幅**                                  |
| `lm-research-recovery-banner` + `-models`   | 检索失败恢复（两条：横幅 + 跳转）                 |

**「演示语料横幅」单独一条**——第 10.5 节那条水印在界面上有专门的位置。

**「检索失败恢复」有一条跳转**（去模型与连接；`open_settings_models` / `enable_web_search` / `open_settings_doctor` 三个动作都落到同一个按钮）——**它不只报错，还给了去处**。

旧版本章还列过 `lm-clarify-open-desk`——**这个 testid 已不存在**，澄清卡现在是 `LawmindRequiresActionCard` / `LawmindClarificationForm` 直接画在消息行里。

### 三个「空态」分支

`LawmindChatMessagesColumn` 的三条空态 testid：

```text
lm-chat-empty                     ← 通用空态
lm-chat-empty-authority-boundary  ← 权威边界说明
lm-chat-empty-create-matter       ← 建议建案
```

**空态有三个不同的版本**——而不是一句「还没有消息」。另有 `lm-chat-empty-examples` 与 `lm-chat-empty-example-<id>` 挂着可点的示例句。

### 工作台：一个巨型文件与一条不变量

`LawmindLawyerWorkbench.tsx` 是渲染层最大的文件（约 2400 行），内部 `view` 为 `agenda | cases | matter`（组件内状态，不是 `mainView`）。它同时是**工作台中栏**与**整页在办**的渲染体。

它的 testid 约 30 条，其中最能反映功能的是：

| testid                                                                               | 干什么                             |
| ------------------------------------------------------------------------------------ | ---------------------------------- |
| `lm-lawyer-workbench`                                                                | 主容器                             |
| `lm-desk-urgency-strip` / `lm-desk-replica-feed`                                     | 跨案紧急条 / 副本动态              |
| `lm-matter-row` / `lm-matter-hotline` / `lm-matter-hot-reason`                       | 案件行与热线                       |
| `lm-lawyer-matter-dossier` / `lm-matter-now`                                         | 卷宗容器与「现在」块               |
| `lm-lawyer-matter-materials` + `lm-materials-search-input` / `-run` / `-hits`        | 卷内材料与检索三件套               |
| `lm-lawyer-matter-parties` / `lm-lawyer-matter-timeline` / `lm-lawyer-matter-collab` | 档案折叠块（当事人 / 进展 / 协作） |
| `lm-lawyer-deadlines-drop` / `lm-lawyer-talk-drop`                                   | 两个拖放区（期限 / 谈话）          |
| `lm-precedent-list`                                                                  | 先例列表                           |
| `lm-lawyer-reconnect`                                                                | 重连按钮                           |

**注意两个「drop」是分开的**（`deadlines-drop` 与 `talk-drop`）——**丢给谁就进哪个功能**。这是「丢材料即交办」在工作台里的落点。

今日提醒那块拆在 `LawmindDeskAgenda.tsx`：`lm-lawyer-today-plan-input`（今日计划输入）与 `lm-lawyer-today-item-<kind>`（按条目类型动态）在那里，不在主文件里。旧版本章列的 `lm-lawyer-today-progress`、`lm-desk-quick-summons`、`lm-desk-quick-talk`、`lm-lawyer-pulse-bar`、`lm-lawyer-stat-deadline/mail` **都已不存在**。

### 改稿：中栏草稿台 + 三栏

| 文件                                       | 导出                            | testid 数                                  |
| ------------------------------------------ | ------------------------------- | ------------------------------------------ |
| `LawmindMiddleDraftDesk.tsx`               | `LawmindMiddleDraftDesk`        | 2（`lm-middle-draft-desk` + `-back`）      |
| `ReviewWorkbench.tsx`                      | `ReviewWorkbench`               | 0（它是容器）                              |
| `review/ReviewWorkbenchDocumentColumn.tsx` | `ReviewWorkbenchDocumentColumn` | 1（`lm-review-export-msg`）                |
| `review/ReviewWorkbenchMetaColumn.tsx`     | `ReviewWorkbenchMetaColumn`     | 7                                          |
| `LawmindDraftDocumentEditor.tsx`           | `LawmindDraftDocumentEditor`    | 0                                          |
| `LawmindDraftDocumentPreview.tsx`          | `LawmindDraftDocumentPreview`   | 0                                          |
| `LawmindRedlinePanel.tsx`                  | `LawmindRedlinePanel`           | 3                                          |
| `LawmindReviewTableEditor.tsx`             | `LawmindReviewTableEditor`      | 3                                          |
| `LawmindReviewCampaignPanel.tsx`           | `LawmindReviewCampaignPanel`    | **16**                                     |
| `LawmindReviewDeliveryBar.tsx`             | `LawmindReviewDeliveryBar`      | 3                                          |
| `LawmindAcceptanceGate.tsx`                | `LawmindAcceptanceGate`         | 0（用 DOM id `lm-review-acceptance-gate`） |

**注意几个组件的 testid 数是 0**——它们靠**内部结构**而不是 testid 被测试。

**而 `LawmindReviewCampaignPanel` 有 16 条**——因为它的交互最多（选 playbook、快速/并行开关、跑、取消、重跑角色、下载报告、看指标、看问题）。

### 整理资料：三步页

`LawmindArchiveOrganizePage.tsx`：指定范围 → 查看分类 → 勾选确认，确认后才复制（注释写明不改原文件、不把正文发给模型）。

| testid                                              | 干什么                                       |
| --------------------------------------------------- | -------------------------------------------- |
| `lm-archive-organize` / `-back`                     | 页面容器 / 返回                              |
| `lm-archive-organize-roots` / `-remove` / `-pick`   | 范围列表 / 移除 / 添加文件夹                 |
| `lm-archive-organize-run` / `-common`               | 跑扫描 / 看常见位置                          |
| `lm-archive-organize-result`                        | 分类结果区                                   |
| `lm-archive-organize-create` / `-into` / `-library` | 三类去向：新建案件 / 归入已有案件 / 一般资料 |
| `lm-archive-organize-file`                          | 勾选确认后执行复制                           |

数据走 `GET /api/historical-scan` 与 `POST /api/historical-scan/{roots,run,apply,common-places,roots/remove}`。

### 守护回执与全局错误弹窗

| 组件                                                              | 挂点                                                    | testid                                                    | 读什么                                                                                                            |
| ----------------------------------------------------------------- | ------------------------------------------------------- | --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `LawmindDaemonRecap.tsx`                                          | 工作台（`LawmindDeskAgenda`、`LawmindLawyerWorkbench`） | `lm-fleet-daemon-recap`                                   | `GET /api/daemon` 的 `recap`（「你走后发生了什么」）；设置 → 工作区里同一份回执是另一个元素，用 `lm-daemon-recap` |
| `LawmindErrorReportDialog.tsx` + `LawmindUnexpectedErrorHost.tsx` | 全局（`main.tsx`）                                      | `lm-error-report-dialog` / `-body` / `-copy` / `-dismiss` | 渲染层未捕获错误的说明弹窗，详情只带错误本身（类型 / 说明 / 堆栈，不含案件内容与密钥），可复制后发出去            |

旧版本章这里的第三行「助手席 `LawmindAssistantDesk`」**已经整个删掉**——组件文件不存在，`lm-assistant-desk` 这个 testid 全仓为 0。

### 类型里还在、主区进不去的面板（退役集群）

下面这些组件**文件还在树里，但没有任何生产路径把它们挂进主区**（`docs/LAWMIND-CODE-AUDIT.md` 第 1.1 节）。本章不再写它们的交互契约；第 62.7 节标注了还在断言它们的测试。

| 组件                                                                                                                                   | 情况                                                                                                                                                                          |
| -------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `app/AgentFleetView.tsx` + `LawmindAgentFleet*.tsx`（在办队列、签批条 `LawmindFleetPostApproveBar`、`useLawmindFleetCeremonyActions`） | 「待拍板 / 交出去的活 / 按流程办」三个 Tab（`lawmind-agents-desk.ts`）随整个视图退役；`/agents` 现在打开整页律师工作台。协作桌活在设置「协作」里的 `LawmindCollaborationDesk` |
| `app/MeetingView.tsx` + `MatterTeamMeeting*.tsx`                                                                                       | 会议室不出现；`mainView: "meeting"` 没有生产赋值                                                                                                                              |
| `app/MatterView.tsx` + `matter/MatterWorkbench*`                                                                                       | 旧案件工作台；现行案卷是 `LawmindLawyerWorkbench`                                                                                                                             |
| `app/ReviewView.tsx`                                                                                                                   | 独立改稿页；改稿改走中栏 `LawmindMiddleDraftDesk`                                                                                                                             |
| `HelpPanel.tsx`                                                                                                                        | 接在 `LawmindAppOverlays` 里但 `showHelp` 初值 false 且**全树没有人把它设成 true**——没有入口                                                                                  |
| `MemoryInspector.tsx`                                                                                                                  | 只被自己的批量采纳测试 import；设置「记忆库」用的是 `LawmindMemoryLibrary`                                                                                                    |
| `LawmindChatThoughtPanel.tsx` / `LawmindChatExecutionTrace.tsx`                                                                        | 思考面板与执行轨迹都只被自身测试 import；对话里的过程条是 `LawmindMsgToolGroup`（`lm-msg-tool-group`）                                                                        |

## 62.2 有判定逻辑的组件

这一节是这一章的核心：那些**有明确分支判断**、且**今天真的挂在渲染树里**的组件。退役组件里的判定逻辑挪到本节末尾单独标注。

### 输入工具栏：四档权限与两种按钮

权限模式是四个选项（存 `lawmind.ui.permissionMode.v1`，`lawmind-chat-compose-toolbar.tsx`）：

```text
readonly   计划模式
research   仅调研
standard   标准
strict     严格审批
```

**两种模式会改变按钮**：

| 模式       | 特殊按钮                                          |
| ---------- | ------------------------------------------------- |
| `readonly` | 显示「开始执行」（`lm-compose-start-execute`）    |
| `strict`   | 显示「恢复标准」（`lm-compose-restore-standard`） |

「开始执行」的行为是**优先走计划注入，否则切回记住的执行权限**：

```text
onStartExecuteFromPlan ? 调它（注入计划确认）
                       : onPermissionModeChange(readExecutePermissionMode())
```

而「恢复标准」是**先写 `standard` 再切**（`writeExecutePermissionMode("standard"); onPermissionModeChange("standard")`）——所以下次还是标准模式。

**这两个按钮的设计意图**：计划模式下不能写，但律师看完计划要能一键进入执行。所以给一个「开始执行」，走完再给一个「恢复标准」兜底。

### 联网开关：禁用只看策略

```text
value    = allowWebSearch ? "web" : "local"
options  = 仅本地 / 联网
disabled = Boolean(webSearchPolicyBlocked)
```

**`disabled` 只有一个原因：策略拦了**（`webSearchPolicyBlocked`）。回合进行中（`loading`）**不禁用**，只改 title 提示「本轮联网不变；改选从下一句或新对话起生效」。策略拦时律师改不了——这对应第 15.9 节那条「策略是上限」。

### 模型选择器的三处提示

`LawmindModelPicker` 的判定：

| 情况       | 行为                                          |
| ---------- | --------------------------------------------- |
| 行没配 Key | 点击 → 打开配置向导（或设置）                 |
| 同上       | 行的 title：`还没填密钥，将打开连接向导`      |
| 目录为空   | 触发按钮 title：`Loading models…`             |
| 其他不可用 | 触发按钮 title：`Model switching unavailable` |

**「点未配置的模型 → 去配置」**是很好的交互：**它把「这个不能用」变成「去把它配好」**。

### 回合进行中的三个按钮：改这一轮 / 发送 / 停止

这一处旧版本章写错了，值得单独看。回合进行中且输入框有字时，输入区右侧是**三个并存的按钮**，不是「发送变成中途指示」：

| 按钮                                   | 条件                        | 行为                                                                                                                                                                                                               |
| -------------------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 改这一轮（`lm-compose-steer-current`） | 提供了 `onSteerCurrentTurn` | `turnInbox.post("steer", { text })` → `POST /api/sessions/:id/steer`，**并清空输入 + 清 compose stash**（那段文本已经作为 steer 送出去了）。`parseForkContinueRequest` 命中或缺 apiBase/sessionId 时回落成普通发送 |
| 发送（title「这一轮结束后接着办」）    | 总是                        | 走 `onSend`；`useLawmindChatSend` 里回合在跑时排成 **followup**（注释写明：Inbox followup 是下一轮，**不发 /steer**）                                                                                              |
| 停止                                   | 回合进行中                  | `onAbortChat`，若已关联指派任务尽量一并取消                                                                                                                                                                        |

「+」输入选项面板里还有第四个：**下一轮再发**（`lm-compose-enqueue-next`，`loading && 有文本 && onEnqueueNextTurn` 时出现）——它与发送同走 `onSend`，title 写明「和回车、发送是同一件事」。

**「中途插话」（steer）和「排队下一条」（followup）是两条路**，界面、注释、发送目标都分开了。

### `LawmindChatMessageRow`：无铬不画与横幅分支

消息行的判定（`LawmindChatMessageRow.tsx`）：

| 条件                                                                                               | 渲染                                                                                                            |
| -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| 助手消息没有任何可见铬（无正文、无计划、无澄清、无缺源/演示/研究恢复、不在进行中、无关联任务状态） | **整行 `return null`**                                                                                          |
| 用户消息是门禁句                                                                                   | `parseLawyerGateMessage` 改画 `lm-msg-gate`                                                                     |
| `msg.turnPlan`                                                                                     | `LawmindTurnPlanCard`（`lm-turn-plan`；可编辑时能勾掉步骤、改步骤字、「开始执行」`lm-turn-plan-start-execute`） |
| 最后一条助手 + 本轮在跑 + 非模型失败                                                               | 只显示「正在办理…」`lm-chat-working`，正文先藏                                                                  |
| `authorityGapNotice` / `demoCorpusNotice` / `researchNextActions`                                  | 三条横幅（testid 见第 62.1 节）                                                                                 |
| 最后一条助手且 `chatThreadDecisionActions` 非空                                                    | `LawmindRequiresActionCard` 待拍板卡                                                                            |
| `awaiting_clarification` 或带 `clarificationQuestions`，且无 `requiresAction`                      | 澄清卡：阻塞且非短确认 → `LawmindClarificationForm`；短确认用 compact 表单                                      |

助手正文走 `LawmindMsgAssistant`（markdown、失败态、Word 检查菜单 `lm-word-check-*`）。头像字：用户「我」，助手「助」。

### `LawmindComposeContextUsage`：对话长度，不是十二个桶

短对话不显示这个入口。`effectiveLimit <= 0` 时也不显示（`!budget || budget.effectiveLimit <= 0` 直接 `return null`）。水位到 `warn` / `compact`，或已经整理过（`compactCount > 0`）才出现，文案是「对话较长」「对话已很长」「已整理过」。打开后可以「整理这场对话」（`lm-compose-compact`）、蒸馏（`lm-compose-distill`）或另开一段并带上文（`lm-compose-fork-carryover`）。

**确认流程**：

```text
有 onPreviewCompact → beginAction 先弹确认（带预览）
没有 → 直接调 onCompact() / onDistill()
```

**「先预览再执行」**——因为压缩不可逆（虽然原文还在磁盘，但上下文里没了）。所以给一个确认。

### `LawmindSettingsConversationLength`：对话长度三档

对话输入栏工具条里的档位选择（`LawmindSettingsConversationLength.tsx`，**不是设置页**）：200K / 500K / 1M（`src/lawmind/agent/context-preset.ts`）。testid 是 `lm-compose-context-length` 与 `lm-compose-context-length-select`。

- 改写走 `PATCH /api/policy/workspace`（键 `conversationLength`），读取走 `GET /api/policy/workspace`。
- 硬天花板 = min(模型自己的窗口, 所选档)（`contextTokensForConversation`）。历史整理不随 500K / 1M 推迟——三档的 detail 都写明「较早的来回仍会整理」。
- 旧策略值 `daily` / `dossier` 读出时自动迁移成 200K / 1M（`normalizeConversationLength`）。
- 它和上面的用量按钮是两件事：档位定本轮硬天花板，用量按钮仍只在「变长或整理过」时才出现。

### `LawmindClarificationForm`：三条提交路径

它的提交分支（`desk` / `compact` 等变体）是三级回落：

| 情况               | 提交什么                                          |
| ------------------ | ------------------------------------------------- |
| 有结构化问题       | `buildClarificationAnswerMap(questions, answers)` |
| 无问题但有自由文本 | `{ note, [附件键], [会话键] }`                    |
| 都没有             | 空 map                                            |

**第二级的两个键名来自引擎**（`CLARIFY_ATTACHMENTS_KEY` / `CLARIFY_SESSIONS_KEY`，从 `clarification-fields.ts` import）——**所以界面和引擎共用同一套键名**，而不是各写一份字符串。

提交按钮的 disabled 条件是 `loading || !complete`，而 `complete` 由 `clarificationAnswersComplete(questions, answers)` 判——**必答项没填完不能提交**。

### 大纲确认那四条的编排

这张卡只在律师要求先看大纲时出现（`lawyerWantsOutlineHold`）。默认交办不会弹出它。

`OUTLINE_CONFIRM_KEY = "research_outline_confirm"` 是一个特殊字段，它有**三个动作**（三个按钮）：

| 按钮                         | 提交什么                |
| ---------------------------- | ----------------------- |
| 批准（`lm-outline-approve`） | `大纲已确认`            |
| 驳回（`lm-outline-reject`）  | `不同意大纲`            |
| 修订（`lm-outline-revise`）  | 正文 + `\n\n大纲已确认` |

**「修订」是「改完再批准」**——所以提交的是「修改后的正文」加一句确认。这与第 54.5 节那三步操作指引完全对应：

```text
1) 回复「大纲已确认」；或
2) 粘贴修订后的 ## 章节 与 - 要点 后确认；或
3) 回复「不同意大纲」以要求重做。
```

**界面上的三个按钮 = 稿子里的三条指引。**

而按钮上还会显示 `outlineAnswerDecision()` 判出来的状态徽标（`approved` / `revise` / `rejected` / 空）。

### `LawmindVerificationChecklist`：四条算式

它的判定逻辑可以完整列出来：

```text
requiredDone   = items.filter(i => i.required && checked[i.id]).length
requiredTotal  = view.requiredTotal ?? items.filter(i => i.required).length
complete       = requiredDone >= requiredTotal
pct            = requiredTotal > 0 ? round(requiredDone / requiredTotal × 100) : 100
```

**四条都只算 required 项**——选填项勾不勾不影响能不能签批。

而界面上两个标记：

| 标记                  | 条件                      |
| --------------------- | ------------------------- |
| `（选填）`            | `item.required === false` |
| `*` 加 `title="必核"` | required                  |

**`data-complete` 属性**（`"true"` / `"false"`）会写进 DOM——所以测试与样式都能据此判断。

未完成时的提示是 `完成必核后方可签批`，带 `role="status"`（**无障碍上是个状态区**，读屏会播报）。

### 签批门禁在宿主侧怎么算（活着的版本）

清单组件如今挂在 `review/ReviewWorkbenchMetaColumn.tsx`（高级 · 签批折叠区），门禁在 `ReviewWorkbench.tsx` 里算：

```text
checklistBlocksApprove =
  有 checklistView 且 reviewStatus === "pending"
  且 required 里存在未勾项
```

它同时喂给清单的 `disableApproveHint` 与交付条的 `approveDisabled`。**注意这里的默认值方向**：`checklistView` 为 null 时 `checklistBlocksApprove` 是 **false**（不拦）——与退役 fleet 代码里「null 算没完成」那道门**正好相反**。两条路都是刻意写的，但含义不同，别再引用旧那一版。

### `LawmindAcceptanceGate`：展开判据

它的核心是一个导出的纯函数（**所以能单独测**）：

```ts
acceptanceGateShouldExpand(report, reasoning) {
  if (!report.deliverableType && report.ready) return false;  // 没类型但已通过 → 不展开（渲染成一句提示）
  if (!report.ready) return true;                             // 没过 → 展开
  if ((report.blockerCount ?? 0) > 0) return true;            // 有阻塞 → 展开
  if ((report.placeholderCount ?? 0) > 0) return true;        // 有占位 → 展开
  if (reasoning && reasoning.required && !reasoning.ready) return true;  // 推理门没过 → 展开
  return false;
}
```

**除第一条外都是「有问题就展开」**——律师不用手动点开才看到问题。注意第一条与旧版不同：**没类型且未通过现在会展开**（落到正常出稿清单），旧版是没类型一律不展开。

而 effect 的写法有一处细节：

```text
useEffect 里每当 shouldExpand 为真就展开，忽略 defaultCollapsed
```

**「忽略 defaultCollapsed」**——如果出了问题，即使调用方说「默认收起」也要展开。

**两个早退分支**：

| 条件                                       | 渲染                                                             |
| ------------------------------------------ | ---------------------------------------------------------------- |
| 没有 `report`                              | `null`                                                           |
| 没有 `deliverableType` 且 `ready === true` | 一句提示：`未标明文书类型。导出前会再按已登记的文书规范核一次。` |
| 其他（含没类型且未通过）                   | 正常出稿清单                                                     |

**摘要行**：

```text
ready → 已通过
否则  → 未通过 · 阻塞 N · 提醒 M
```

而后面的 hint 分两种：

```text
forceExpand → （请先处理阻塞项）
否则       → （点击展开清单）
```

**「（请先处理阻塞项）」**——它把「已经展开了」这件事变成一句行动指引。

### `LawmindReviewDeliveryBar`：三条门的六分支

这个组件的分支最多。三条门：

```text
gateBlocked     = acceptance 有类型 && !acceptance.ready
step2Done       = status !== "pending"
step3Ready      = !gateBlocked && readiness?.readyToExport !== false
hardBlockExport = !writing && approved && readiness && !readyToExport
                  && blockers 里有 checklist 或 citation
```

**`hardBlockExport` 只认 `checklist` 与 `citation` 两种 blocker**——其他 blocker 不会走这条硬拦。

**六个分支的按钮文案**（有顺序）：

| #   | 条件             | 文案                         |
| --- | ---------------- | ---------------------------- |
| ①   | 改稿中 且 门禁拦 | `不可导出`                   |
| ②   | 改稿中           | `导出中…` / `导出审查意见书` |
| ③   | 非改稿 且 未批准 | `导出`（禁用）               |
| ④   | 硬拦             | `不可导出`                   |
| ⑤   | 门禁拦           | `不可导出`                   |
| ⑥   | 其他             | `导出中…` / `导出审查意见书` |

**`不可导出` 出现了三次**（①④⑤）——三个不同的原因给同一个按钮文案，但各自的补充说明不同。

**状态行**是三段拼接：

```text
<状态标签> + (step3Ready ? " · 可导出" : step2Done ? " · 待导出" : writing ? " · 改稿" : "")
```

**跟单里有一条明确的注释**：

```text
验收门禁是核心卖点：UI 不提供绕过入口，阻塞时禁导出并提示补齐。
```

**界面上没有绕过验收的按钮**——第 8.14 节讲过这条，这里是它的代码出处。

### 退役组件里的判定逻辑（只被测试引用）

以下逻辑**代码还在、测试还跑，但组件不进渲染树**。写出来是为了如实，不是契约：

- `MemoryInspector` 的两段式批量采纳（先 `dryRun: true` 预览、确认后才落盘）仍被 `MemoryInspector.batch.test.tsx` 守着；设置「记忆库」的现行组件是 `LawmindMemoryLibrary`。
- 退役 fleet 宿主的「`view` 为 null 时必核清单按未完成处理」（`LawmindAgentFleetDetail` / `useLawmindFleetCeremonyActions`）与「待拍板」分组标签（`fleetGroupLabel`）随在办集群一起不在主区渲染；它与上面活着的 `checklistBlocksApprove` 默认方向相反，引用时别搞混。

## 62.3 首跑：单步（只选身份）

### 单步流程

首跑窗口没有进度条，也没有 `Step` 状态：屏幕上只有身份卡。点任意一张身份卡即完成——

```text
选身份 → POST /api/matters/create { matterId: "演示案件" }
       → POST /api/onboarding/firstrun-wizard（审计，失败不阻断）
       → applyPostFirstrunPermissionDefaults({ executable: true })
       → onSeedReady({ matterId, seedPrompt: 按身份拼的默认交办 })
       → 关窗并 dismissForever
```

首跑**不再**收集文书类型，也**不**收集行文风格 / 风险口径 / 对客语气，更**不**向 `POST /api/lawyer-profile/learning` 写「冷启动偏好：…」。写作习惯改由记忆库（确认后写入）与改稿/对话沉淀；避免无证据的风格标签静默偏置模型。

### 角色选项

**角色**（三个）：

| id          | 标签     |
| ----------- | -------- |
| `solo`      | 独立执业 |
| `associate` | 律所协办 |
| `partner`   | 合伙人   |

角色只影响第一句 seed prompt（`DEFAULT_SEED_PROMPT_BY_ROLE`：solo 默认起草初稿、associate 标合伙人留白、partner 全要素审核），不写入可执行偏好。

### 自动弹出的判定链

```text
① open 已经是 true → 不重复弹
② suppressAutoOpen → 不弹
③ 本会话已关过（dismissedThisSessionRef）→ 不弹
否则：
  sessionStorage 或 localStorage 的 lm.firstRun.requestOpen 是 "1" → 弹（读后即清）
  否则 GET /api/onboarding/firstrun 说已关闭 → 不弹
    （服务端读不到时回落：localStorage 有 lm.firstRun.dismissed 标记 → 不弹）
  否则 GET /api/matters/overviews 空 → 弹
```

**已关闭的真源在服务端**（按工作区记），浏览器里那份只是网络失败时的兜底——关掉时先 `POST /api/onboarding/firstrun-dismiss`，写成才清浏览器副本，写不成才补写浏览器副本。所以换工作区首跑会回来，换浏览器不会丢记录。

### 起始交付物没有选择步骤

文书类型不进首跑：渲染层不再拉 `/api/deliverables/specs`，也没有 spec 卡片与排名逻辑（曾经的 `contract.review` 恒排第一那条规则随文书步骤一起删除）。要办什么文书，由对话判断。

### 演示案件名

两条路（选身份、直接开始）都用**固定名 `演示案件`**（`FIRST_RUN_DEMO_MATTER_ID`，不拼业务名）。选身份那条路会往输入框放一句按身份拼的默认交办；「直接开始」（跳过向导，`lm-firstrun-skip-wizard`）不放说明（`seedPrompt: ""`）。示例句在空对话里点选后才填入。

### 首跑仍写什么（与模型风格无关）

提交与跳过**都会调** `applyPostFirstrunPermissionDefaults({ executable: true })`——**首跑直接给可执行权限**。这是 UI 权限默认，不是风格/风险口径提示，不进入「已按你的习惯」块。

对话框自身的 testid：`lm-firstrun-authority-boundary`、`lm-firstrun-skip-wizard`。曾经的 `lm-firstrun-skip-spec`（先不选文书）与 `lm-firstrun-create-matter`（顺手建案勾选）随文书步骤一起删除。

## 62.4 存储：活着的 46 个 localStorage 键族与 3 个 sessionStorage 键

**先说清口径**：下面按 2026-10 的源码逐个数。动态后缀（按案件/任务分键）算一个**键族**。旧版标题里的「33 + 2」与正文里的「约 44 个」都不准；而且旧版把 `lawmind.postApproveExport.v1.<taskId>` 错记成 localStorage——**它其实是 sessionStorage**，且只属于退役的 fleet 集群。

### localStorage：活着的 46 个键族

**开发与连接**（2 个）：

```text
lawmind.dev.apiBase
lawmind.dev.apiAuthToken
```

**模型与权限**（4 个）：

```text
lawmind.selectedModelId
lawmind.selectedModelId.byAssistant
lawmind.ui.permissionMode.v1
lawmind.ui.executePermissionMode.v1
```

**注意 `byAssistant` 那个**——**模型可以按助手分别记**。所以「合同助手用贵模型、通用助手用便宜模型」是支持的。

**输入区与上下文**（5 个）：

```text
lawmind.compose.stash.<matterId|_global>
lawmind.compose.recentFileContext
lawmind.ui.allowWebSearch
lawmind.ui.briefOnly.v1
lawmind.includeTurnDiagnostics
```

**会话**（4 个）：

```text
lawmind.chat.activeSession.v1
lawmind.chat.listScope.v1
lawmind.chat.collapsedFolders.v1
lawmind.chat.homeDir.v1
```

**工作流**（2 个）：

```text
lawmind.planHandoff.v1
lawmind.ui.forkSuggestDismissed.v1
```

**审稿与出稿**（9 个）：

```text
lawmind.review.autoExportOnApprove
lawmind.review.requireSignoffReview
lawmind.ui.reviewPaneMeta
lawmind.ui.reviewPaneEditor
lawmind.ui.reviewPanePreview
lawmind.ui.reviewWorkbenchMetaWidth
lawmind.ui.reviewWorkbenchEditorWidth
lm.campaignPreferFast
lm.campaignPreferParallel
```

**界面与版面**（14 个）：

```text
lawmind.ui.sidebarCollapsed
lawmind.ui.sidebarWidth
lawmind.ui.wsPaneChat
lawmind.ui.wsPaneEditor
lawmind.ui.wsChatColumnWidth
lawmind.ui.filesExplorerWidth
lawmind.ui.wordSurfaceRailWidth
lawmind.ui.chatComposeHeight.v3
lawmind.settings.lastSection
lm.ui.fontScale.v1 / density.v1 / reducedMotion.v1 / theme.v1
lm.privilegeSentinel
```

**案件缓存**（2 个）：

```text
lawmind.matterBrief.<matterId>
lawmind.hotline.<matterId>.<hot>.<yyyy-mm-dd>
```

**画布**（2 个）：

```text
lawmind.canvas.file.<root>:<path>
lawmind.canvas.state.<key>
```

**首跑**（2 个）：

```text
lm.firstRun.dismissed          ← 服务端写不成时的兜底副本
lm.firstRun.requestOpen        ← 向导配完后请求再弹一次（两个存储都查）
```

**分组的规律很清楚**：`lawmind.ui.*` 是界面偏好，`lawmind.<功能>.*` 是功能偏好。

### 退役/垂死的 localStorage 键（代码还在，组件不进主区）

```text
lawmind.teamMeeting.session.<matterId>        ← 会议室（退役）
lawmind.teamMeeting.participants.<matterId>   ← 会议室（退役）
lawmind.ui.matterWorkbenchListWidth           ← 旧案件工作台（退役）
lawmind.reviewMatrix.notes.v1.<matterId>      ← 旧案件工作台审阅矩阵（退役）
lawmind-agents-snooze:v1                      ← 在办 fleet「稍后看」（退役）
lawmind.ui.meetingMaterialsCollapsed          ← 只出现在「重置布局」的删除清单里，没有活写入方
```

### 三个 `.v1` / `.v3` 的意义

```text
lawmind.ui.permissionMode.v1
lawmind.chat.activeSession.v1
lawmind.ui.chatComposeHeight.v3          ← 第 3 版
```

**版本后缀是「换了结构就换键名」的做法**——所以旧版本的脏数据不会被误读。

`chatComposeHeight.v3` 到第 3 版说明这个值改过两次结构。

### 三个 sessionStorage 键（活着）

```text
lm.firstRun.requestOpen                ← 也查 localStorage 同键
lawmind-lawyer-review-sig:<key>        ← 审阅桌面通知去重
lawmind-daemon-incident-sig:<key>      ← 后台掉线通知去重
```

**两条 `*-sig:` 都是「桌面通知」的去重签名**——避免同一个事件重复弹通知；会话级，关掉应用就清。

另有一个退役的：`lawmind.postApproveExport.v1.<taskId>`（签批后导出条状态），**它是 sessionStorage**——旧版本章记成 localStorage 是错的；它的唯一读写方是退役的 fleet 签批条。会议室旧键也曾在 sessionStorage，现在的模块只是「读到就迁到 localStorage」。

### 三个「按案件/任务分键」的

```text
lawmind.compose.stash.<matterId|_global>
lawmind.matterBrief.<matterId>
lawmind.hotline.<matterId>.<hot>.<yyyy-mm-dd>
```

**分键的原因各不相同**：草稿按案件（切案时草稿该分开）、摘要与热线按案件缓存。

### `lm.` 与 `lawmind.` 两个前缀

有两个前缀混用：

| 前缀       | 用在哪                                 |
| ---------- | -------------------------------------- |
| `lawmind.` | 大部分（较新）                         |
| `lm.`      | 外观四件套、专案组偏好、特权提示、首跑 |

**这是历史演进**：早期用 `lm.`，后来统一成 `lawmind.`。改的时候要注意两边都在用。

## 62.5 FileWorkbench：没有拖放导入（一处容易误判）

核对时发现一个容易误判的点：**`FileWorkbench` 没有拖放导入。**

`file/` 下的树行是拖放的**来源**（`encodeLawmindFsDrag` + `LAWMID_FS_DRAG_MIME`——常量名里的 `LAWMID` 少个 N，是源码原样），不是目标。整个 `FileWorkbenchView` / `FileWorkbenchTree` / `FileWorkbenchImpl` 里**没有 `onDrop` / `onDragOver`**。

**导入的入口是另一条路**：

```text
casesNodeActions.onImportMatters / canImportMatters / importMattersBusy
```

也就是**「导入案件」菜单项**，不是拖放。

而**聊天侧的拖放是有的**（第 62.1 节那两个 drop zone）。

**这个区别**：拖文件进对话 = 钉选上下文；拖文件进文件工作台 = 不行，要用菜单。

### 文件工作台的根与禁区

两个根（`RootKey`）：`workspace` / `project`。

**五个受保护路径**（删除时要求输入文件名确认，`file/file-workbench-fs.tsx` 的 `PROTECTED_WORKSPACE`）：

| 路径              | 保护理由（文案）                            |
| ----------------- | ------------------------------------------- |
| `assistants.json` | 助手配置文件 — 删除后所有助手定义将永久丢失 |
| `sessions`        | 会话记录目录 — 删除后所有对话历史将永久丢失 |
| `cases`           | 案件数据目录 — 删除后所有案件资料将永久丢失 |
| `memory`          | 记忆数据库目录 — 删除后助手长期记忆将清空   |
| `delegations`     | 协作委派记录目录 — 删除后协作历史将丢失     |

**五条都说明了「删了会丢什么」**——这是删除确认该有的样子。

而 `isProtectedWorkspacePath` 有三条细致的判定：

1. 只有 `root === "workspace"` 才判（项目目录不适用）。
2. `cases` **只在根这一层**受保护（`norm === "cases"`）——所以 `cases/<案件>/...` 里的文件是普通文件。
3. `assistants.json` 同理（只在根）。

**第 2、3 条很重要**：不然案件里的文件都删不了。

**危险删除要求输入文件名**（`dangerInput`），普通删除只弹一次确认。文案也是分开的：

```text
确认删除文件夹 "…" 及其所有内容？此操作不可撤销。
确认删除文件 "…"？…
```

### 三条别的拒绝

```text
只能粘贴到同一根目录（工作区与项目之间不能混贴）。
案件名至少 2 个字，且不能含路径字符（/ \ ..）。
案件编号格式无效，请检查输入。
```

**第一条防的是跨根粘贴**（工作区与项目是两个独立的根）。

### 新建案件是一条两步动作

输案件名 → 校验 `isValidMatterId` → 建 `cases/<名>/` → **再调 `POST /api/matters/create`**。

**先建目录再建案件**——所以目录结构与案件记录是一致的。目录建成而登记失败时错误文案会明说「文件夹已创建，但案件登记失败」。

### 快速打开的打分

`scoreMatch` 五档（`file/file-workbench-fs.tsx`）：

```text
精确匹配        100
前缀匹配        80
包含匹配        60
路径包含        30
不匹配          0
结果最多 14 条
```

### 打开文件：按预览种类分派，不再是「Office 一律拦下」

旧版本章说「Office 类不开 tab，拦下来而不是给烂预览」——**这已经过时**。现在 `openFile` 先问 `resolvePreviewKind`（`file/preview-kind.ts`），十一个种类各有面板：

| 扩展                          | kind       | 面板                                                           |
| ----------------------------- | ---------- | -------------------------------------------------------------- |
| `.docx`                       | `word`     | Word 修订面（`LawmindWordRevisionSurface`，`lm-word-surface`） |
| `.pdf`                        | `pdf`      | `PdfFileView`（pdf.js，视口附近才挂页）                        |
| `.xlsx`                       | `xlsx`     | `XlsxFileView`（网格编辑 + 保存）                              |
| `.pptx`                       | `pptx`     | `PptxFileView`（幻灯片图 + 本页文字编辑）                      |
| 音频/视频 10 种               | `media`    | `MediaFileView`                                                |
| `.eml`                        | `eml`      | `EmlFileView`                                                  |
| `.zip`                        | `zip`      | `ZipFileView`（只列条目不解压）                                |
| `.doc`                        | `doc`      | `DocFileView`（让 Word/WPS 存成同名 docx 再打开）              |
| 图片 8 种                     | `image`    | `ImagePreviewPanel`（data URL）                                |
| `.xls` / `.ppt` 等其他 Office | `fallback` | `FallbackPreviewPanel`（版式预览不支持的说明）                 |
| 其他                          | `text`     | textarea（`.md` 可切预览；`.canvas.tsx` 走 `CanvasFileView`）  |

**顺序**：已有 tab → 激活；二进制种类（`kind !== "text"`，图片除外）→ **不读文本直接开 tab**；读失败且错误含 `binary` → fallback tab；是图片 → data URL；其余 → 文本 tab。活动预览容器的 testid 是 `lm-preview-active-<kind>`。

保存到工作区外的提示也值得一提：

```text
已保存到工作区外：<path>（可继续在编辑器中编辑当前标签；保存仍指向原文件路径。）
```

**它解释了「为什么还能编辑但保存行为不同」**。

## 62.6 三处「组件之间」的约定

### 会议室存储键（组件已退役）

这些键只被退役的会议室组件读写。律师界面没有入口。

```text
MEETING_SESSION_STORAGE_PREFIX = "lawmind.teamMeeting.session."
MEETING_PARTICIPANTS_STORAGE_PREFIX = "lawmind.teamMeeting.participants."
MEETING_INTERRUPT_WAIT_MS = 12000
```

**第三个是「等打断生效」的时间**（第 16.7 节讲过）：点终止之后要等最多 12 秒。

而打断检测靠**回复文本**：

```text
isAbortedMeetingReply → 匹配 "已停止生成。"
```

**用文本匹配而不是状态字段**——因为 `/api/chat` 返回的是一段回复，没有单独的状态通道。

会话 scope 的两个 sentinel：

```text
ADHOC_MEETING_MATTER_ID        ← 临时会议的假案件 id
type MeetingGroupId = "adhoc" | "matter"
```

而注释说明了它为什么要有个假 id：

```text
Ad-hoc meetings keep the API sentinel id but store under workspace/meetings/adhoc/.
```

**「API 用 sentinel、磁盘用独立目录」**——两套表示，一处转换。

### 设置导航的三个常量

| 常量                               | 内容                                               |
| ---------------------------------- | -------------------------------------------------- |
| `LAWMIND_SETTINGS_DEFAULT_SECTION` | `"models"`                                         |
| `LAWMIND_SETTINGS_SCROLL_ANCHORS`  | `{ memoryTruth: "lawmind-settings-memory-truth" }` |
| `SETTINGS_LAST_SECTION_KEY`        | `"lawmind.settings.lastSection"`                   |

侧栏是一条平铺目录（源码里分三组只是书写顺序，UI 拍平）：**账号 / 模型与连接 / 工作区 / 外观 / 协作 / 自动办件 / 记忆库 / 免责声明**，共 8 项，没有「更多设置」折叠桶。Firm / `private_deploy` 且多助手编制开启时，「办案」组末尾再挂一项**助手编制**；Solo 侧栏没有这项。旧版本章把「协作」漏掉、把「助手编制」当常驻项——两个都错了。

退役但可深链的分区有专门的常量：

```text
SETTINGS_NAV_LEGACY_SECTION_IDS  = ["review-prefs", "host", "assistants", "roles", "skills",
                                    "edition", "doctor", "tools", "templates", "app-update"]
RETIRED_LAST_SECTION_IDS         = { roles, skills, edition, doctor, tools, templates }
```

**两组的差别**：`review-prefs` / `host` / `doctor` / `tools` / `app-update` 是「旧分区名」，存进 lastSection 时**会被重定向**（分别到外观、工作区、工作区、模型与连接、账号）；`RETIRED_LAST_SECTION_IDS` 里的六个只深链只读，lastSection 存了会回落到默认分区 `models`。`assistants` 在 LEGACY 里但不在 RETIRED 里——它是 firm 深链用的活分区。

**默认分区是 `models`** 的注释写明了原因：

```text
Day-1 landing: connect models first, not a health dashboard.
```

**「先连模型，不是先看体检」**——首跑优先级的体现。

设置页新组件的 testid：

| 组件                               | testid                                                                                                                                                                                              | 说明                                                       |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `LawmindSettingsAccount.tsx`       | `lm-settings-account`、`lm-account-name` / `-plan` / `-subscription` / `-license` / `-model-source` / `-model-name` / `-included-models` / `-usage`、`lm-account-open-models`、`lm-reopen-firstrun` | 账号页：登录身份、订阅、许可、模型来源与用量               |
| `LawmindSettingsWorkspaceCare.tsx` | `lm-workspace-search` / `lm-workspace-rebuild-search` / `lm-workspace-matter-repair`                                                                                                                | 工作区页里的「查找重建」与「案件档案整理」，只在需要时渲染 |

### 记忆来源面板（sentinel 已移除）

旧版本章写过 `LawmindMemorySourcesPanel` 处理「根级客户档案」的两个 sentinel（`client_profile_root` / `CLIENT_PROFILE.md`）——**这对字符串已不在渲染层**，全仓为 0。面板本身还活着（`ReviewWorkbenchMetaColumn` 在用，退役的旧案件认知面板也用），但不再有这条特殊分支。

## 62.7 测试守着的那些契约

第 62.2 节讲的判定逻辑里，有几条被单测直接守着。我列一下（这一节的作用是告诉你**哪些改动会撞测试**）。

**活组件的测试**：

| 测试文件                                                                                               | 守什么                                                     |
| ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------- |
| `LawmindAcceptanceGate.test.tsx`                                                                       | 展开判据                                                   |
| `LawmindReviewDeliveryBar.test.tsx`                                                                    | 六分支的按钮文案                                           |
| `LawmindReviewPaneToggles.test.tsx`                                                                    | 改稿三栏显隐（至少留一栏）                                 |
| `LawmindReviewSelfCheckSummary.test.tsx`                                                               | 交卷核对的显示                                             |
| `LawmindReviewCampaignPanel.test.tsx`                                                                  | 专案组面板                                                 |
| `LawmindComposeContextUsage.test.tsx`                                                                  | 用量入口的出现条件                                         |
| `LawmindComposeAttachments.test.tsx`                                                                   | 附件                                                       |
| `LawmindChatComposeFooter.drop.test.tsx`                                                               | 丢文件进输入区                                             |
| `LawmindComposeModelWarn.test.tsx`                                                                     | 模型未配时的提示                                           |
| `lawmind-chat-compose-toolbar.test.tsx`                                                                | 权限档与工具栏按钮                                         |
| `LawmindClarificationForm.test.tsx`                                                                    | 澄清表单                                                   |
| `LawmindFirstRunDialog.test.tsx`                                                                       | **演示案件名的构造**等首跑逻辑                             |
| `LawmindLawyerWorkbench.test.tsx`                                                                      | 工作台                                                     |
| `LawmindMiddleDraftDesk.test.tsx`                                                                      | 中栏草稿台挂载条件                                         |
| `LawmindTurnPlanCard.test.tsx`                                                                         | 计划卡                                                     |
| `LawmindMsgAssistant.test.tsx`                                                                         | 助手正文                                                   |
| `LawmindModelPicker.test.tsx` + `lawmind-model-picker-utils.test.ts`                                   | 模型选择器                                                 |
| `LawmindSettingsConversationLength.test.tsx`                                                           | 对话长度档                                                 |
| `LawmindToolArgsEditDialog.test.tsx`                                                                   | 审批参数编辑                                               |
| `review/ReviewWorkbenchMetaColumn.test.tsx`                                                            | **`ReviewWorkbenchMetaColumn 律师语言`**、待定夺项旁路展示 |
| `review/useReviewWorkbenchActions.test.tsx`                                                            | 提交审核                                                   |
| `app/LawmindMainBodyContent.test.tsx`                                                                  | 主区分支（哪个 view 渲染什么）                             |
| `app/LawmindFileWorkbenchHost.test.tsx`                                                                | 文件工作台挂载                                             |
| `app/LawmindWorkspaceBootstrapGate.test.tsx`                                                           | 引导门                                                     |
| `file/FileWorkbenchDialogs.test.tsx`                                                                   | 对话框                                                     |
| `file/FileWorkbenchContextMenu.test.tsx`                                                               | 右键菜单                                                   |
| `file/PptxFileView.test.tsx`、`file/XlsxFileView.test.tsx`、`file/LawmindWordRevisionSurface.test.tsx` | 预览面板                                                   |

**还在断言退役组件的测试**（如实标注：这些测试是绿的，但它们守的组件不进渲染树；按 `docs/LAWMIND-CODE-AUDIT.md` 第 1.1 节删除集群时它们要同批处理）：

| 测试文件                                                                                                                                                                                                                        | 情况                                                                                                                                                            |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MemoryInspector.batch.test.tsx`                                                                                                                                                                                                | `MemoryInspector` 只被这个测试 import；「预览不写入、确认后才落盘」的断言还在跑，但守的是死组件                                                                 |
| `LawmindChatThoughtPanel.test.tsx`                                                                                                                                                                                              | 思考面板只被测试 import                                                                                                                                         |
| `LawmindAgentFleetDetail.test.tsx`、`LawmindAgentFleetListAside.test.tsx`、`lawmind-fleet-*.test.ts`、`lawmind-post-approve-export.test.ts`                                                                                     | 在办 fleet 集群                                                                                                                                                 |
| `app/MeetingView.test.tsx`、`lawmind-meeting-*.test.ts`                                                                                                                                                                         | 会议室集群                                                                                                                                                      |
| `matter/MatterWorkbenchTabs.test.tsx`、`matter/MatterCognitionPanel.test.tsx`、`matter/MatterOverviewBody.test.tsx` 等                                                                                                          | 旧案件工作台集群                                                                                                                                                |
| `LawmindJudgmentPanel.test.tsx`                                                                                                                                                                                                 | **混合**：`LawmindDecisionHeader` / `LawmindJudgmentEscalationCard` 是活的（挂在 `ReviewWorkbenchMetaColumn`），`LawmindJudgmentItemsPanel` 只被这个测试 import |
| `LawmindDeskDashboardSummary.test.tsx`、`lawmind-chat-thought-view.test.ts`、`lawmind-chat-trace.test.ts`、`lawmind-execution-state-label.test.ts`、`lawmind-model-service-status.test.ts`、`lawmind-lawyer-vocabulary.test.ts` | 退役散件                                                                                                                                                        |

### 那个「律师语言」测试

`ReviewWorkbenchMetaColumn 律师语言` 这个 describe 名字很直白——**它测的是「界面上说的是不是律师语言」**。

这是第 32 章那套文案规范在测试层的落点：**除了 lint 脚本，还有断言具体措辞的测试**。

### `MemoryInspector.batch` 守的那条

第 6.5 节讲过它的两条测试：

```text
预览不发写入请求，确认后才一次落盘
没有待确认项时不提供批量入口
```

**第一条是「零写入」姿态在界面层的守卫**——它断言预览阶段**一个写入请求都没发**。这类测试（断言「什么都没发生」）比断言「发生了什么」更难写，也更有价值。只是要知道：它守的组件今天不在渲染树里（见上表）。

## 62.8 已知坑（本章相关）

- **「工作台」不是另一页**：`setMainView("desk")` 被根壳收成「对话 + 中栏案卷」；整页「在办」（`/agents`）与工作台中栏是同一个 `LawmindLawyerWorkbench`。
- **改稿不在 `mainView`**：`review` 会被拨回对话；真正的入口是中栏 `LawmindMiddleDraftDesk`。
- **在办 fleet、会议室、旧案件工作台、独立改稿页整簇退役**（第 62.1 节末尾那张表）——别给它们写新契约；它们的测试还是绿的，删集群时要同批删。
- **`FileWorkbench` 没有拖放导入。** 树行是拖放来源；导入走「导入案件」菜单。
- **回合进行中是三个按钮**：「改这一轮」（steer）、「发送」（排成下一轮 followup）、「停止」——发送不再变身成 steer。
- **联网下拉的禁用只看策略**，loading 只改 title。
- **对话长度入口在变长或已整理过后才出现。** 界面不再列十二个用量桶。
- **`effectiveLimit <= 0` 时用量环整个不渲染。**
- **活着的签批门禁：查不到清单（null）不拦签批**；退役 fleet 那版是「null 算没完成」——两版方向相反，别引用错。
- **`AcceptanceGate` 的展开逻辑忽略 `defaultCollapsed`**（有问题就必须展开）；没类型但未通过现在会展开。
- **界面上没有绕过验收的入口。**
- **首跑不再写冷启动风格偏好**（无习惯问卷、无「冷启动偏好：」笔记）；已关闭标记的真源在服务端。
- **`chatComposeHeight` 已经到 `.v3`**（换过两次结构）。
- **`lawmind.postApproveExport.v1.<taskId>` 是 sessionStorage**，且属退役集群——旧版本章两处都记错了。
- **localStorage 有 `lm.` 与 `lawmind.` 两个前缀在混用。**
- **`cases` 与 `assistants.json` 只在根这一层受保护**（案件内的文件是普通的）。
- **Office 文件现在按预览种类开面板**（word/pdf/xlsx/pptx/media/eml/zip/doc），只剩 `.xls`/`.ppt` 等落 fallback——「Office 一律拦下」已是旧闻。
- **会议室的打断检测靠回复文本匹配**，没有状态通道（组件已退役）。
- **一批测试还在断言退役组件**（第 62.7 节第二张表）——绿 ≠ 活。
- **改这些有测试守着的组件（第 62.7 节第一张表）会撞测试。** 先想清是约束过时还是代码错了。
