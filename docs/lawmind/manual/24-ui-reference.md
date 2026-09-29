# 第 24 章 界面逐屏详解

第 2 章给过界面导览。这一章把每一屏的元素逐个说清楚：**它在哪、长什么样、点了会发生什么、背后的数据从哪来。**

## 24.1 主窗口骨架

主窗口的层次（`LawmindAppRootView.tsx`）：

```text
跳转链接（无障碍用）
模态宿主（弹窗挂在这里）
├── 侧栏（设置、工作台、改稿、整理资料时隐藏；收起时宽度为 0）
├── 顶栏
└── 主体
    ├── 设置面板（打开设置时）
    └── 当前工作面
文件工作台宿主
```

全局错误弹窗挂在最外层（`main.tsx` 的 `LawmindUnexpectedErrorHost`）：渲染层未捕获错误（事件回调与 rejected promise；渲染崩溃由 `LawmindErrorBoundary` 管）弹出 `LawmindErrorReportDialog`，详情只带错误本身（类型 / 说明 / 堆栈，不含案件内容与密钥），可复制（`lm-error-report-copy`）后发给帮你看的人。

### 侧栏（`LawmindAppSidebar.tsx`）

从上到下：

| 元素                                            | 干什么                                 |
| ----------------------------------------------- | -------------------------------------- |
| 品牌标 + 设置齿轮                               | 打开设置面板                           |
| 材料 / 资源管理器入口                           | 打开文件工作台                         |
| 案件列表（`LawmindMatterSidebarList.tsx`）      | 切换案件；右键有菜单                   |
| 会话列表（`LawmindSideChatSessions.tsx`）       | 对话和在办时的历史列表                 |
| 「待我拍板」徽标按钮（`LawmindAppSidebar.tsx`） | 有待决策时出现；进「在办」并聚焦待决策 |

侧栏在**工作台、改稿、整理资料**上不挂载（`showAppSidebar = mainView !== "review" && mainView !== "desk" && mainView !== "archive"`，`lawmind-app-root.tsx`）。对话和在办上侧栏可以收起：节点还在，宽度为 0，按钮点不到。侧栏点不到且还有待决策时，同一枚按钮改挂顶栏（`data-testid="lm-header-needs-decision"`）。侧栏和顶栏走同一套动作：清掉上次深链的那一行，`setAgentsNeedsDecisionFocus(true)`，再切到「在办」。数字用 `lawyerFacingDecisionTotal`：默认只算澄清、批准和待发信；外观里打开「签批审阅」后才把待审稿加进去。没有待决策时侧栏和顶栏都不放这个按钮。

工作台不再另放一颗「待我拍板」。那一颗以前用的是「今日待拍板」条数，和全工作区收件箱不是同一个数。本案脉搏条上的「待拍板」仍是本案计数，大于 0 才带上当前案件进同一队列。案件总览和「要我处理」卡片底下不再单独放同名按钮。

### 顶栏（`LawmindAppHeader.tsx`）

| 元素           | 干什么                                                                                                         |
| -------------- | -------------------------------------------------------------------------------------------------------------- |
| 一级工作面切换 | **三个**：对话 / 工作台 / 在办（`lm-tab-workspace` / `-desk` / `-agents`）                                     |
| 次级工作面 tab | 改稿、整理资料——**只在当前就停在该面时出现**（`lm-tab-secondary`）。没有会议室 tab。离开后顶栏恢复三个一级 tab |
| 案件驾舱开关   | 打开案件详情面板                                                                                               |
| 版面开关       | 隐藏/显示侧栏、对话栏等                                                                                        |
| 助手切换       | 助手多于一个时才出现                                                                                           |
| 「待我拍板」   | 只在侧栏点不到且有待决策时出现（工作台、改稿、整理资料、侧栏收起）                                             |

当前模型在对话输入栏的 `LawmindModelPicker`，不在顶栏。

**律师能打开五个工作面，顶栏一级 tab 只有三个**（第 2.4 节）。改稿和整理资料不占一级位置；当前停在该面时，顶栏才多出一个 `lm-tab-secondary`。整理资料从设置 → 工作区进。类型里的 `meeting` 没有 tab，也没有「+」入口。

版面开关有一个保护：**聊天栏和编辑栏不能同时隐藏**——都隐藏时会弹一个恢复提示（`workspace-layout.spec.ts` 测的就是这个）。

## 24.2 对话（`workspace`）

### 消息列表

| 组件                                 | 作用                                               |
| ------------------------------------ | -------------------------------------------------- |
| `lawmind-chat-messages-column.tsx`   | 消息列容器                                         |
| `LawmindChatMessagesVirtualList.tsx` | 虚拟列表（长会话性能）                             |
| `LawmindChatMessageRow.tsx`          | 单条消息（含每条的操作：复制、编辑、删除、决策卡） |
| `LawmindMsgAssistant.tsx`            | 助手消息外壳                                       |
| `LawmindMsgToolGroup.tsx`            | 一组合并显示的工具调用                             |
| `LawmindReasoningCollapsible.tsx`    | 可折叠的推理展示                                   |
| `LawmindMsgCompactNotice.tsx`        | 压缩提示（第 3 章）                                |
| `LawmindMsgCarryoverNotice.tsx`      | 承前分叉提示                                       |
| `LawmindMsgWorkflowApproval.tsx`     | 会话内的工作流批准卡                               |
| `LawmindAssistantDesk.tsx`           | 助手席：当前助手在场状态与职责                     |

### 输入区

| 组件                                | 作用                                                     |
| ----------------------------------- | -------------------------------------------------------- |
| `lawmind-chat-compose-toolbar.tsx`  | 工具栏：模型、权限模式、检索开关；对话变长才出现整理入口 |
| `LawmindComposeContextPicker.tsx`   | 钉选（`@` 文件、拖拽、粘贴）                             |
| `LawmindComposeContextUsage.tsx`    | 对话变长时的整理入口（不展示用量桶）                     |
| `LawmindComposeAttachments.tsx`     | 附件条                                                   |
| `LawmindComposeTemplateGallery.tsx` | 模板画廊（填表交办）                                     |
| `LawmindJobIntakeForm.tsx`          | 表单式交办：填完生成一条【交办】提示                     |

`LawmindJobIntakeForm` 是可选填法。默认仍是输入框里的一句话。不想手打的人填完，系统把表拼成一条交办，不把填表变成 Day-1 必经步骤。

### 会话管理

| 组件                               | 作用                                                        |
| ---------------------------------- | ----------------------------------------------------------- |
| `LawmindChatSessionTabs.tsx`       | 对话主区顶部的会话标签                                      |
| `LawmindSideChatSessions.tsx`      | 全局侧栏里的历史列表（对话、在办）                          |
| `LawmindSessionHistorySidebar.tsx` | 对话主区里的会话历史，不是全局侧栏                          |
| `LawmindChatHistorySearch.tsx`     | 当前这条对话里查找（`⌘F`）。换会话用侧栏列表或输入 `/chats` |

### 状态与提示条

| 组件                               | 作用             |
| ---------------------------------- | ---------------- |
| `LawmindIntentStatusBar.tsx`       | 「本轮按××处理」 |
| `LawmindChatDraftStatusBar.tsx`    | 草稿状态         |
| `LawmindReadinessStrip.tsx`        | 就绪度条         |
| `LawmindClarificationForm.tsx`     | 澄清卡片         |
| `LawmindCitationBanner.tsx`        | 引用完整性提示   |
| `LawmindContextForkSuggestion.tsx` | 承前分叉建议     |

### 过程展示

| 组件                            | 作用             |
| ------------------------------- | ---------------- |
| `LawmindChatThoughtPanel.tsx`   | 思考面板         |
| `LawmindChatExecutionTrace.tsx` | 执行轨迹         |
| `LawmindTurnPlanCard.tsx`       | 回合计划卡       |
| `LawmindChatReviewSticky.tsx`   | 审核相关的吸顶条 |

**为什么不堆过程芯片**：对话线程刻意不堆过程芯片、短路径按钮和步骤拍板卡（`GOALS.md` 里的「步骤多少不打断律师」）。过程在「在办」看。

### 引用与来源

| 组件                           | 作用                                                          |
| ------------------------------ | ------------------------------------------------------------- |
| `LawmindSourcePreview.tsx`     | 来源预览（按法律报告「参见」体例，不显示 `src-1` 这种内部码） |
| `LawmindSourceAnnotations.tsx` | 来源批注                                                      |
| `LawmindClauseGraph.tsx`       | 条款图                                                        |
| `LawmindAnalysisChart.tsx`     | 分析图表                                                      |

### 记忆来源

| 组件                            | 作用                                                |
| ------------------------------- | --------------------------------------------------- |
| `LawmindMemorySourcesPanel.tsx` | 记忆档案体检面板（审核台 / 案件认知；不挂对话气泡） |

它显示每一层记忆档案是否在磁盘上、设计上能否进主说明（第 6 章那个区分）。不表示「本回答引用了哪些材料」。

### 回复里可以点的链接

助手正文里的按钮由 `renderLegalMarkdown` 认出来（`lawmind-chat-markdown.tsx`）。写法见第 3.2 节。

| 点到的东西                                 | 打开哪里                                                             |
| ------------------------------------------ | -------------------------------------------------------------------- |
| 稿（`lm-draft:`）                          | 这份稿的修订栏                                                       |
| 另一段对话（`lm-session:`）                | 那条会话                                                             |
| 公网网址                                   | 系统浏览器                                                           |
| 工作区里的 docx、pdf、表格、markdown、图片 | 编辑区。文本文件若带 `:行`，选中那一行                               |
| `.canvas.tsx`                              | 对话旁边的中间栏。预览标题不带 `.canvas.tsx`。要点回复里的链接才打开 |

内网地址、带账号密码的网址、磁盘绝对路径和含 `..` 的路径不会变成按钮。回复里提到画布不会自己打开。

画布预览的「导出网页」写出旁边的 `.canvas.html`，不是 Word。源码、保存、另存为在「源码」里。画布自己里面的链接也交给主窗口：网页走系统浏览器，工作区文件走中间栏。类型对不上的画布不渲染，中间栏显示 `Canvas check`（行号和说明）。从画布「接着问」会把这份画布钉进当前对话，输入框开头是可以点开的相对路径。法条与观点依据写在对话里（可点），改稿侧栏有引用完整性条；不要用中间栏另开核对纸，也不要另存 `canvas/核对-*.canvas.tsx`。

## 24.3 工作台（`desk`）

### 主面板

`LawmindLawyerWorkbench.tsx`（全仓最大的渲染层文件，约 2400 行）。结构是「今日一屏」：

| 组件                                  | 作用                                                                              |
| ------------------------------------- | --------------------------------------------------------------------------------- |
| `LawmindDeskDashboardSummary.tsx`     | 汇总条：待拍板总数、今日活动数、本周一次通过数                                    |
| `LawmindRequiresActionCard.tsx`       | 需要我处理的卡                                                                    |
| `LawmindJudgmentItemsPanel.tsx`       | 待定夺项面板                                                                      |
| `LawmindJudgmentEscalationCard.tsx`   | 待定夺升级卡                                                                      |
| `LawmindTaskDrawer.tsx`               | 任务抽屉                                                                          |
| `LawmindTaskCheckpoints.tsx`          | 任务检查点                                                                        |
| `LawmindVerificationChecklist.tsx`    | 必核清单                                                                          |
| `LawmindAssignmentCommitmentCard.tsx` | 承诺卡（第 16 章的 assignment commitment）                                        |
| `MatterOverviewTodoCards.tsx` 等      | 要处理的卡片（另有 `LawmindApprovalQueue.tsx`、`LawmindApprovalRequestHost.tsx`） |
| `LawmindDaemonRecap.tsx`              | 「你走后发生了什么」回执（读 `GET /api/daemon` 的 `recap`；在办也挂一份）         |

### 案件驾舱（`matter/`）

58 个文件，主要的（**这一节只列 `matter/` 下的**；名字带 `Matter` 但目录在 `renderer/` 根的，见对应工作面那节，比如会议室那四个 `MatterTeamMeeting*`）：

| 组件                                                 | 作用                                                              |
| ---------------------------------------------------- | ----------------------------------------------------------------- |
| `MatterCockpit.tsx`                                  | 驾舱容器                                                          |
| `MatterOverviewPanel.tsx` / `MatterOverviewBody.tsx` | 案件总览（工作队列、汇总条、洞察折叠）                            |
| `MatterOverviewTodoCards.tsx`                        | 待办卡                                                            |
| `MatterProfileCard.tsx`                              | 卷宗资料卡                                                        |
| `MatterCasePanel.tsx`                                | CASE 档案                                                         |
| `MatterTasksPanel.tsx`                               | 任务（里面挂着审批队列）                                          |
| `MatterTaskBoard.tsx`                                | 任务看板                                                          |
| `MatterReviewQueuePanel.tsx`                         | 队列 + 待审批（只渲染传入的 view model，不自己 fetch）            |
| `MatterReviewMatrixPanel.tsx`                        | 案件审查矩阵（第 7、9 章）                                        |
| `MatterTimelinePanel.tsx`                            | 时间线                                                            |
| `MatterMemoryInspector.tsx`                          | 认知/记忆（复用 `MemoryInspector`）                               |
| `MatterReasoningBoard.tsx`                           | 推理板（IRAC）                                                    |
| `MatterQualityCockpit.tsx`                           | 质量驾舱（受 `crossMatterAcceptanceDashboard` 门控；Solo 默认开） |
| `MatterRoleBoard.tsx`                                | 角色分配可视化                                                    |
| `MatterOpsBrief.tsx`                                 | Matter Ops（KPI + RAID + 计划 + 基线）                            |
| `MatterTheoryLitePanel.tsx`                          | 案件理论                                                          |
| `MatterTeamRosterStrip.tsx`                          | 本案团队条                                                        |
| `MatterReplicaPanel.tsx`                             | 成员协作面板（Firm 门控）                                         |
| `MatterLocalDocIndex.tsx`                            | 本机文档索引                                                      |
| `LawmindMatterHealthCard.tsx`                        | 健康卡（「无安全分」那张）                                        |
| `MatterShellRecordsPanel.tsx`                        | 台帐 / 交付记录                                                   |

还有一批纯函数模块（`matter-*.ts`）负责把数据算成 view model，让组件保持薄。

## 24.4 在办（`agents`）

| 组件                                       | 作用                                          |
| ------------------------------------------ | --------------------------------------------- |
| `app/AgentFleetView.tsx`                   | 在办视图壳                                    |
| `LawmindAgentFleetPanel.tsx`               | 主面板（左侧待办目录 + 右侧办理区）           |
| `LawmindAgentFleetListAside.tsx`           | 左栏列表（含「记忆库」入口）                  |
| `LawmindAgentFleetDetail.tsx`              | 右栏办理区（签批 / 补充 / 批准仪式 + 导出条） |
| `LawmindAgentFleetEmpty.tsx`               | 空态                                          |
| `LawmindFleetPostApproveBar.tsx`           | 批准后的动作条                                |
| `LawmindDelegateAssistDialog.tsx`          | 委派对话框                                    |
| `LawmindCollaborationDesk.tsx`             | 协作台（含委派卡与事件流）                    |
| `LawmindCollabDelegationCards.tsx`         | 委派卡                                        |
| `LawmindCollaborationComposeModelRail.tsx` | 协作输入区的模型栏                            |

左栏的视图状态在 `stores/fleet-desk-view-store.ts`：默认按事项（`queue`），第二页签按助手；另有案件与成员筛选、分组展开、「稍后看」。其中「稍后看」和手折分组持久化到 localStorage。列表模式是会话态，重新进入仍回到按事项。

`LawmindCollaborationDesk.tsx` 嵌在「在办」里，只在这一页顶部「更多」里的「交出去的活 / 按流程办」时出现，不是进门第一眼，也不在窗口顶栏。设置里的「团队工作流」已退役；深链只渲染一段简述，按钮是「去『在办』处理」（`onOpenCollaborationPage` 关掉设置，切到在办的办理列表，不打开会议室，也不自动套上「待我拍板」筛选）。

## 24.5 会议室（`meeting`）：类型还在，界面不挂

律师走不到这一屏。依据：

- 顶栏测试断言没有 `lm-tab-meeting`（`LawmindAppHeader.test.tsx`）。
- `LawmindMainBodyContent.tsx` 只分支对话、工作台、在办、改稿、整理资料。`mainView === "meeting"` 会落到对话主面板，不渲染 `MeetingView`。
- `buildMeetingDeepLinkHandlers` 里的 `onOpenTopLevelMeeting` 把视图设成 `workspace`，不是 `meeting`。
- 案件卷宗页签没有「会议」（`MatterWorkbenchTabs.tsx` 的日常页签是概览 / 档案 / 任务 / 时间线 / 审查矩阵 / 经验）。
- `e2e/meeting-flow.spec.ts` 的标题是「会议室已退出主路径」：输入选项里没有 `lm-compose-open-meeting`，也没有「开始讨论」。

下面这些文件还在仓库里，单测能渲染，产品壳不挂载。不要把它们写回操作步骤，也不要为了「手册对上组件」把 tab 装回去。

| 组件                                    | 作用                           |
| --------------------------------------- | ------------------------------ |
| `app/MeetingView.tsx`                   | 未挂载的会议室视图             |
| `MatterTeamMeetingPanel.tsx`            | 只被 `MeetingView` 引用        |
| `MatterTeamMeetingSetupSection.tsx`     | 设置段（选参会人）             |
| `MatterTeamMeetingMaterialsSection.tsx` | 材料段                         |
| `MatterTeamMeetingThreadSection.tsx`    | 时间线段                       |
| `useMatterTeamMeetingDeliberation.ts`   | 发言编排的 hook                |
| `pickMeetingViewProps`                  | 只被自身单测调用，主内容区不用 |

组件在 `renderer/` 根目录，不在 `renderer/matter/` 下。未挂载界面上的测试 id 有 `lm-meeting-view`、`lm-meeting-group-adhoc`、`lm-meeting-group-matter`。那些「开始讨论 / 终止发言」按钮律师点不到。

**数据存在哪，要分三样看**（这里容易记混）：

| 什么                                   | 存哪                                                                                                           | 换机器还在吗       |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------ |
| 发言记录（时间线本体）                 | **文件**：`cases/<matterId>/team-meeting.jsonl`；临时讨论落 `meetings/adhoc/team-meeting.jsonl`                | 在                 |
| 参会人名册                             | **服务端**：`/api/matters/team-roster`（GET 读 / PUT 写）                                                      | 在                 |
| 参会会话映射（每个参会者对应哪个会话） | **本机 localStorage**：`lawmind.teamMeeting.session.<matterId>`、`lawmind.teamMeeting.participants.<matterId>` | 本机在，换机器不在 |

发言记录由委派留痕写在工作区文件里，换机器还在。参会会话映射只会被未挂载组件写进本机 localStorage；当前界面没有写入入口。

## 24.6 改稿（`review`）

三栏结构（第 8 章讲过显隐记忆）：

| 组件                                       | 作用                                                 |
| ------------------------------------------ | ---------------------------------------------------- |
| `ReviewWorkbench.tsx`                      | 文书台容器                                           |
| `review/ReviewWorkbenchDocumentColumn.tsx` | 文档栏（编辑区 + 预览）                              |
| `review/ReviewWorkbenchMetaColumn.tsx`     | 元信息栏（验收门、独立审稿、出处、审查专案组）       |
| `LawmindDraftDocumentEditor.tsx`           | 可编辑正文（Cursor 文档栏风格）                      |
| `LawmindDraftDocumentPreview.tsx`          | 只读排版预览（可拖出去独立开窗）                     |
| `LawmindRedlinePanel.tsx`                  | 红线面板（接受/拒绝/全部处理/重置基线）              |
| `LawmindReviewTableEditor.tsx`             | 审查表编辑器                                         |
| `LawmindReviewCampaignPanel.tsx`           | 审查专案组（**不展示启发式安全分**，只显示真实统计） |
| `LawmindReviewDeliveryBar.tsx`             | 交付条（签批 / 验收 / 必核 / 引用是否可交付）        |
| `LawmindReviewSelfCheckSummary.tsx`        | 交卷核对（机械门禁、独立审稿、引用）                 |
| `LawmindAcceptanceGate.tsx`                | 验收门展示                                           |
| `LawmindOutboundSignoffCallout.tsx`        | 外发签批提示                                         |
| `LawmindContractReviewLearningPanel.tsx`   | 合同审查学习面板                                     |
| `LawmindProvenanceIndicator.tsx`           | 出处指示                                             |
| `LawmindReviewPaneToggles.tsx`             | 三栏显隐开关                                         |
| `LawmindReviewDraftPicker.tsx`             | 草稿选择器                                           |
| `LawmindReviewPreviewPopout.tsx`           | 预览弹出窗                                           |
| `LawmindSpreadsheetHintBar.tsx`            | 表格提示条（钉了 xlsx 时出现）                       |
| `LawmindWordRevisionBar.tsx`               | Word 修订条（钉了 Word 时提示选「文书类型 × 立场」） |

`LawmindReviewDeliveryBar` 有一个明确约束（props 注释）：

> 导出始终走 strict 验收门禁；UI 不再提供 `?strict=false` 绕过入口。

也就是说**界面上没有「绕过验收」这个按钮**。

## 24.7 整理资料（`archive`）

`LawmindArchiveOrganizePage.tsx`：整理指定范围里的文件——该建案就建案，该归进已有案件就归进去，一般资料按类型收好。**确认后才复制，不改原文件，不把正文发给模型。**

三步（服务端在 `route-historical-scan.ts`，第 65 章）：

| 步         | 界面                                                                                                | 端点                                                                 |
| ---------- | --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| ① 指定范围 | 加文件夹（一次最多三个；`lm-archive-organize-pick` / `-roots` / `-remove`），或「常见位置」一键代入 | `POST /api/historical-scan/roots`、`/roots/remove`、`/common-places` |
| ② 查看分类 | 跑扫描后按「新建案件 / 归入已有案件 / 一般资料」三组看计划（`lm-archive-organize-result`）          | `POST /api/historical-scan/run`                                      |
| ③ 勾选确认 | 勾选后执行（`lm-archive-organize-create` / `-into` / `-library` / `-file`）                         | `POST /api/historical-scan/apply`、`/file`                           |

入口在设置 → 工作区「整理电脑上的资料」（`lm-archive-organize-open`），打开后顶栏多出次级 tab `lm-tab-archive`；页面顶部的返回（`lm-archive-organize-back`）回到来处。顺序由服务端守着：没先查看就 apply 会 400「请先查看这些文件夹。」，没先整理就 file 会 400「请先整理一次，再收进案件。」。

## 24.8 设置（整页）

设置是**整页**（不是模态），左侧一条 8 项平铺目录 + 右侧内容区，支持搜索定位。

分区清单见第 2 章。这里补充各组件的职责：

| 组件                                                                                        | 分区                                                          |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `LawmindSettingsAccount.tsx`（内嵌 `LawmindSettingsLicense.tsx` 与应用更新检查）            | 账号（身份 / 许可 / 模型来源 / 用量）                         |
| `LawmindSettingsModelRetrieval.tsx`                                                         | 模型与连接                                                    |
| `LawmindSettingsCustomModels.tsx`                                                           | 自定义模型（模型与连接内）                                    |
| `LawmindSettingsWorkspace.tsx`（内嵌 `LawmindSettingsWorkspaceCare.tsx`）                   | 工作区（含本机文件夹；查找重建 / 案件档案整理只在需要时出现） |
| `LawmindSettingsPracticePlaybook.tsx`                                                       | 执业口径                                                      |
| `LawmindSettingsUserStandards.tsx`                                                          | 律师标准                                                      |
| `LawmindSettingsAppearance.tsx`（内嵌 `LawmindSettingsDoctorWordAddin.tsx` 的 Word 连接组） | 外观                                                          |
| `LawmindAutomationsPanel.tsx`                                                               | 自动办件                                                      |
| `LawmindSettingsMemory.tsx`                                                                 | 记忆库                                                        |
| `LawmindSettingsAssistants.tsx`                                                             | 助手编制                                                      |
| `LawmindSettingsDisclaimer.tsx`                                                             | 免责声明                                                      |
| `LawmindSettingsSkills.tsx`                                                                 | 作业标准（退役、只读、不可安装）                              |
| `LawmindSettingsRoles.tsx`                                                                  | 角色说明（退役）                                              |
| `LawmindSettingsCollaboration.tsx`                                                          | 团队工作流（退役简述）                                        |
| `LawmindSettingsEdition.tsx`                                                                | 版本与授权（退役）                                            |

**「退役但可深链」**意味着：老的书签和上次停留的分区不会崩，但侧栏里不显示（第 2 章讲的 `SETTINGS_NAV_RETIRED_ITEMS`）。两个特例：`templates` 深链现在只渲染一段静态说明（出稿用内置模板，不能上传），独立组件已删；`doctor` 深链渲染空白——系统健康整屏已拆除，功能按去处收编：连接与运行体检收进「工作区」（`WorkspaceCare`，只在有问题时出现）与「账号」（许可 / 模型来源 / 用量），Word 连接收进「外观」，工具/沙箱开关随「本机访问默认放开」移除（第 15 章），`host` / `tools` / `app-update` 等旧分区 id 分别重定向到 工作区 / 模型与连接 / 账号。

2026-09 这轮删除的独立设置页：`LawmindSettingsDoctor.tsx`、`LawmindSettingsTools.tsx`、`LawmindSettingsTemplates.tsx`、`LawmindSettingsScorecard.tsx`、`LawmindSettingsUsageStats.tsx`、`LawmindSettingsHostAccess.tsx` 与 `settings-doctor-groups.tsx`。对话长度（200K / 500K / 1M）不是设置分区，是对话输入框工具条上的 `LawmindSettingsConversationLength.tsx`。

### 记忆库那一屏

`LawmindSettingsMemory.tsx` 的头部注释说明了首屏策略：

> 首屏只处理「待确认」；档案与合同学习收进折叠。

也就是打开记忆库第一眼只看到**待你确认的建议**，不堆一堆档案内容。

## 24.9 记忆库（`MemoryInspector`）

| 组件                               | 作用                                              |
| ---------------------------------- | ------------------------------------------------- |
| `MemoryInspector.tsx`              | 待确认建议队列（默认动作：确认 / 改写）           |
| `matter/MatterMemoryInspector.tsx` | 案件范围复用同一组件                              |
| `LawmindMemoryTruthSources.tsx`    | 真相源面板（读 `GET /api/memory/sources` + 预览） |
| `LawmindMemorySourcesPanel.tsx`    | 档案体检面板（审核台 / 认知；不挂对话）           |

`MemoryInspector` 的作用域：简单模式三个（律师 / 案件 / 律所），高级里八个全展开（第 6 章）。

## 24.10 首跑与向导

| 组件                        | 作用                                                          |
| --------------------------- | ------------------------------------------------------------- |
| `LawmindFirstRunDialog.tsx` | 可选的身份与习惯。连上模型后默认不弹；从设置重开才记偏好      |
| `LawmindApiSetupWizard.tsx` | 连接向导（API Key、Base URL、模型、工作区、检索通道、推荐栈） |
| `HelpPanel.tsx`             | 帮助面板                                                      |
| `LawmindCommandPalette.tsx` | 命令面板                                                      |
| `FileWorkbench.tsx`         | 文件工作台                                                    |

连上模型之后直接进空对话，并建「演示案件」。身份、文风、风险口径和客户口吻留在这份对话框里，从设置重开才写进偏好。不要把它写成连上模型之后的必经问卷。

## 24.11 审批相关

| 组件                               | 作用                              |
| ---------------------------------- | --------------------------------- |
| `LawmindApprovalQueue.tsx`         | 集中审批队列（案件内 + 工具审批） |
| `LawmindApprovalRequestHost.tsx`   | 消费全局审批状态（SSE 驱动）      |
| `LawmindApprovalDocReader.tsx`     | 审批时读文档                      |
| `stores/approval-request-store.ts` | 全局审批状态（zustand）           |

`LawmindApprovalRequestHost` 订阅 SSE，所以别的窗口产生的审批会实时出现。

## 24.12 状态管理的边界

渲染层用 zustand，约定写在 `stores/README.md`：

> 一个域一个文件；actions 跟 state 放一起；临时态与持久态分开；组件用 selector 订阅。

五个 store：

| store                             | 管什么                       | 持久化                     |
| --------------------------------- | ---------------------------- | -------------------------- |
| `approval-request-store.ts`       | 全局审批状态                 | 否                         |
| `fleet-desk-view-store.ts`        | 在办左栏视图                 | 「稍后看」和手折分组持久化 |
| `matter-overview-view-store.ts`   | 案件总览的筛选排序与洞察折叠 | 否                         |
| `review-pane-visibility-store.ts` | 改稿三栏显隐                 | 是                         |
| `settings-panel-store.ts`         | 设置面板开关与当前分区       | 只有分区                   |

**其余状态不放在 store 里**：服务端数据走 TanStack Query（`lawmind-query-hooks.ts`），局部 UI 状态留在组件里。

## 24.13 界面与文案的约束

第 18 章讲过 `lawmind:ui-copy-lint`：律师可见面不许出现文件路径、英文枚举、门禁术语。

实践中你会看到的表现：

| 不许出现             | 界面上的说法       |
| -------------------- | ------------------ |
| `cases/<id>/CASE.md` | 案件档案           |
| `LAWYER_PROFILE.md`  | 律师偏好           |
| `pending_review`     | 待审核             |
| `strict`             | 严格               |
| gate / bypass        | 核对 / 必核 / 确认 |

`LawmindSourcePreview` 的注释也体现了这条：「律师可见文案按法律报告『参见』体例，不展示 `src-1` 等内部码。」

也就是说，**来源在界面上是按「参见《民法典》第X条」这种形式显示的**，不是内部 id。

## 24.14 已知坑（本章相关）

- **聊天栏和编辑栏不能同时隐藏。** 会弹恢复提示。
- **工作台、改稿、整理资料没有侧栏。** 「待我拍板」改挂顶栏，而且只在有待决策时出现。点「在办」一级 tab 会清掉待决策筛选，看到的是全部在办，不是收件箱。侧栏收起时按钮也改挂顶栏；侧栏节点仍在，只是宽度为 0。
- **「团队工作流」分区已退役。** 日常入口在顶栏「在办」。
- **`MatterReviewQueuePanel` 不自己 fetch。** 它只渲染传入的 view model，改数据流时注意这一点。
- **`LawmindReviewCampaignPanel` 不显示启发式安全分。** 那是内部信号（第 9 章）。
- **界面上没有绕过验收的入口。** 导出永远走 strict 门。
- **改稿三栏全关是被禁止的。** store 里有 `hasVisibleReviewPaneAfter` 保护。
- **`MatterQualityCockpit` 跟 `crossMatterAcceptanceDashboard`。** Solo 默认开；关掉该功能键才不渲染。
- **`MatterReplicaPanel` 在 Solo 不渲染。**
- **会议室不是当前界面。** 委派仍可能往 `cases/<matterId>/team-meeting.jsonl` 写系统行（第 16.7 节）。参会会话的 localStorage 键只被未挂载组件读写。不要在顶栏或输入条「+」里找「开会议室」。
- **首跑偏好会写进记忆。** 那不是「随便选选」的表单，它会变成之后的默认口径。
- **画布开在对话旁边的中间栏。** 要点回复里的链接才打开，不会因为最新一条提到路径就跳。类型检查不过时只显示 `Canvas check`，不渲染坏掉的页面。中间栏不再挂核对纸；法条依据在对话与改稿引用条里看。

## 24.15 和 Cursor / Harvey 对齐后收掉的重复入口

Cursor 把待处理收进一条代理收件箱，侧栏看不见时角标仍在。Harvey 把「待审」放在事项上，不另开一套审批中心。LawMind 原来写成「侧栏是唯一入口」，但工作台和改稿根本不渲染侧栏，改稿上待决策会消失；工作台则在没有待办时仍放一颗空的「待我拍板」，本案总览再放一颗同名按钮。

这一轮收成一条队列、两处挂载，而且两处点下去做的是同一件事（清掉上次深链，再聚焦待决策）：

- 侧栏能看见时，按钮只在侧栏，有数字才出现。
- 侧栏点不到时（工作台、改稿、整理资料、侧栏收起），同一按钮改到顶栏。工作台不再用「今日待拍板」另画一颗，避免和全工作区数字打架。
- 本案脉搏条「待拍板」大于 0 才带上当前案件跳过去。总数为 0 时它只是计数，不打开空队列。

顶栏「在办」仍是全部在办。它会清掉待决策筛选。要进收件箱，点「待我拍板」，不要点「在办」。

对话线程继续不堆过程芯片。过程在「在办」看。这和铁律 1（少迷路）以及铁律 5（步骤多少不打断）一致，不把 Cursor 的逐步确认搬进律师主路径。
