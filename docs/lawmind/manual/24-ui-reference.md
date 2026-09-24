# 第 24 章 界面逐屏详解

第 2 章给过界面导览。这一章把每一屏的元素逐个说清楚：**它在哪、长什么样、点了会发生什么、背后的数据从哪来。**

## 24.1 主窗口骨架

主窗口的层次（`LawmindAppRootView.tsx`）：

```text
跳转链接（无障碍用）
模态宿主（弹窗挂在这里）
├── 侧栏（打开设置时隐藏）
├── 顶栏
└── 主体
    ├── 设置面板（打开设置时）
    └── 当前工作面
文件工作台宿主
```

### 侧栏（`LawmindAppSidebar.tsx`）

从上到下：

| 元素                                            | 干什么                 |
| ----------------------------------------------- | ---------------------- |
| 品牌标 + 设置齿轮                               | 打开设置面板           |
| 材料 / 资源管理器入口                           | 打开文件工作台         |
| 案件列表（`LawmindMatterSidebarList.tsx`）      | 切换案件；右键有菜单   |
| 会话列表（`LawmindSessionHistorySidebar.tsx`）  | Cursor 风格的历史列表  |
| 「待我拍板」徽标按钮（`LawmindAppSidebar.tsx`） | 进「在办」并聚焦待决策 |

「待我拍板」的徽标数字来自 `GET /api/approvals` 的条目数（第 5 章）。它是**唯一入口**——没有第二个地方能进待决策。

### 顶栏（`LawmindAppHeader.tsx`）

| 元素           | 干什么                                                                         |
| -------------- | ------------------------------------------------------------------------------ |
| 一级工作面切换 | **三个**：对话 / 工作台 / 在办（`lm-tab-workspace` / `-desk` / `-agents`）     |
| 次级工作面 tab | 会议室、改稿——**只在已经打开过时才出现**（`lm-tab-meeting` / `lm-tab-review`） |
| 案件驾舱开关   | 打开案件详情面板                                                               |
| 版面开关       | 隐藏/显示侧栏、对话栏等                                                        |
| 助手切换       | 换当前助手                                                                     |
| 模型选择入口   | 打开模型选择器                                                                 |

**「五个工作面」是导航模型的说法（第 2.4 节），顶栏一级 tab 只有三个。** 会议室和改稿不占一级对等位置——代码注释写明了这一点，它们以 `lm-tab-secondary` 的形式在打开后出现。找「会议室在哪」时别在一级 tab 里找。

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

### 输入区

| 组件                                | 作用                                         |
| ----------------------------------- | -------------------------------------------- |
| `lawmind-chat-compose-toolbar.tsx`  | 工具栏：模型、权限模式、检索开关、上下文用量 |
| `LawmindComposeContextPicker.tsx`   | 钉选（`@` 文件、拖拽、粘贴）                 |
| `LawmindComposeContextUsage.tsx`    | 上下文用量表（对应预算分解）                 |
| `LawmindComposeAttachments.tsx`     | 附件条                                       |
| `LawmindComposeTemplateGallery.tsx` | 模板画廊（填表交办）                         |
| `LawmindJobIntakeForm.tsx`          | 表单式交办：填完生成一条【交办】提示         |

`LawmindJobIntakeForm` 的设计意图是「表单优先」：不想手打指令的律师可以填表，系统把表拼成标准交办文本。

### 会话管理

| 组件                           | 作用                          |
| ------------------------------ | ----------------------------- |
| `LawmindChatSessionTabs.tsx`   | 顶部会话标签                  |
| `LawmindSideChatSessions.tsx`  | 侧边会话列表                  |
| `LawmindChatHistorySearch.tsx` | 历史搜索（`⌘⇧O` 或 `/chats`） |

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

| 组件                            | 作用                             |
| ------------------------------- | -------------------------------- |
| `LawmindMemorySourcesPanel.tsx` | 记忆来源面板（对话和审核台共用） |

它显示每一层记忆的字符数和**是否进了提示词**（第 6 章那个区分）。

## 24.3 工作台（`desk`）

### 主面板

`LawmindLawyerWorkbench.tsx`（全仓最大的渲染层文件，超过 2600 行）。结构是「今日一屏」：

| 组件                                  | 作用                                                                            |
| ------------------------------------- | ------------------------------------------------------------------------------- |
| `LawmindDeskDashboardSummary.tsx`     | 汇总条：待拍板总数、今日活动数、本周一次通过数                                  |
| `LawmindRequiresActionCard.tsx`       | 需要我处理的卡                                                                  |
| `LawmindJudgmentItemsPanel.tsx`       | 待定夺项面板                                                                    |
| `LawmindJudgmentEscalationCard.tsx`   | 待定夺升级卡                                                                    |
| `LawmindTaskDrawer.tsx`               | 任务抽屉                                                                        |
| `LawmindTaskCheckpoints.tsx`          | 任务检查点                                                                      |
| `LawmindVerificationChecklist.tsx`    | 必核清单                                                                        |
| `LawmindAssignmentCommitmentCard.tsx` | 承诺卡（第 16 章的 assignment commitment）                                      |
| `MatterOverviewTodoCards.tsx` 等      | 各种待办卡（另有 `LawmindApprovalQueue.tsx`、`LawmindApprovalRequestHost.tsx`） |

### 案件驾舱（`matter/`）

58 个文件，主要的（**这一节只列 `matter/` 下的**；名字带 `Matter` 但目录在 `renderer/` 根的，见对应工作面那节，比如会议室那四个 `MatterTeamMeeting*`）：

| 组件                                                 | 作用                                                   |
| ---------------------------------------------------- | ------------------------------------------------------ |
| `MatterCockpit.tsx`                                  | 驾舱容器                                               |
| `MatterOverviewPanel.tsx` / `MatterOverviewBody.tsx` | 案件总览（工作队列、KPI 条、洞察折叠）                 |
| `MatterOverviewTodoCards.tsx`                        | 待办卡                                                 |
| `MatterProfileCard.tsx`                              | 卷宗资料卡                                             |
| `MatterCasePanel.tsx`                                | CASE 档案                                              |
| `MatterTasksPanel.tsx`                               | 任务（里面挂着审批队列）                               |
| `MatterTaskBoard.tsx`                                | 任务看板                                               |
| `MatterReviewQueuePanel.tsx`                         | 队列 + 待审批（只渲染传入的 view model，不自己 fetch） |
| `MatterReviewMatrixPanel.tsx`                        | 案件审查矩阵（第 7、9 章）                             |
| `MatterTimelinePanel.tsx`                            | 时间线                                                 |
| `MatterMemoryInspector.tsx`                          | 认知/记忆（复用 `MemoryInspector`）                    |
| `MatterReasoningBoard.tsx`                           | 推理板（IRAC）                                         |
| `MatterQualityCockpit.tsx`                           | 质量驾舱（**仅 Firm / Private 显示**）                 |
| `MatterRoleBoard.tsx`                                | 角色分配可视化                                         |
| `MatterOpsBrief.tsx`                                 | Matter Ops（KPI + RAID + 计划 + 基线）                 |
| `MatterTheoryLitePanel.tsx`                          | 案件理论                                               |
| `MatterTeamRosterStrip.tsx`                          | 本案团队条                                             |
| `MatterReplicaPanel.tsx`                             | 成员协作面板（Firm 门控）                              |
| `MatterLocalDocIndex.tsx`                            | 本机文档索引                                           |
| `LawmindMatterHealthCard.tsx`                        | 健康卡（「无安全分」那张）                             |
| `MatterShellRecordsPanel.tsx`                        | 台帐 / 交付记录                                        |

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

左栏的视图状态在 `stores/fleet-desk-view-store.ts`：团队/队列模式、案件与成员筛选、分组展开、「稍后看」。其中「稍后看」和手折分组持久化到 localStorage。

**注意 `LawmindCollaborationDesk.tsx` 挂在设置里的「团队工作流」分区**（退役但可深链），日常入口是顶栏「在办」。

## 24.5 会议室（`meeting`）

| 组件                                    | 作用               |
| --------------------------------------- | ------------------ |
| `app/MeetingView.tsx`                   | 会议室视图         |
| `MatterTeamMeetingPanel.tsx`            | 案件内会议面板     |
| `MatterTeamMeetingSetupSection.tsx`     | 设置段（选参会人） |
| `MatterTeamMeetingMaterialsSection.tsx` | 材料段             |
| `MatterTeamMeetingThreadSection.tsx`    | 时间线段           |
| `useMatterTeamMeetingDeliberation.ts`   | 发言编排的 hook    |

**注意这几个组件都在 `renderer/` 根目录，不在 `renderer/matter/` 下**——只有名字带 `Matter`，路径不带。

界面上的测试 id 有 `lm-meeting-view`、`lm-meeting-group-adhoc`、`lm-meeting-group-matter`、`lm-meeting-scope-matter-<案件id>`——可以看出它按「临时 / 案件」两种范围分组。

交互：开始讨论 → 参会者依次发言进时间线 → 可以打断（显示「已终止当前发言」）→ 暂停 → 继续 → 结束。

**数据存在哪，要分三样看**（这里容易记混）：

| 什么                                   | 存哪                                                                                                        | 换机器还在吗 |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------ |
| 发言记录（时间线本体）                 | **文件**：`cases/<matterId>/team-meeting.jsonl`；临时讨论落 `meetings/adhoc/team-meeting.jsonl`             | 在           |
| 参会人名册                             | **服务端**：`/api/matters/team-roster`（GET 读 / PUT 写）                                                   | 在           |
| 参会会话映射（每个参会者对应哪个会话） | **sessionStorage**：`lawmind.teamMeeting.session.<matterId>`、`lawmind.teamMeeting.participants.<matterId>` | **不在**     |

所以「换机器就没了」只对第三样成立——别把它当成「会议记录不持久」。发言记录是落盘的。

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

## 24.7 设置（整页）

设置是**整页**（不是模态），左侧分组导航 + 右侧内容区，支持搜索定位。

分区清单见第 2 章。这里补充各组件的职责：

| 组件                                                        | 分区                   |
| ----------------------------------------------------------- | ---------------------- |
| `LawmindSettingsModelRetrieval.tsx`                         | 模型与连接             |
| `LawmindSettingsCustomModels.tsx`                           | 自定义模型             |
| `LawmindSettingsWorkspace.tsx`                              | 工作区                 |
| `LawmindSettingsPracticePlaybook.tsx`                       | 执业口径               |
| `LawmindSettingsUserStandards.tsx`                          | 律师标准               |
| `LawmindSettingsHostAccess.tsx`                             | 本机能力               |
| `LawmindSettingsAppearance.tsx`                             | 外观                   |
| `LawmindAutomationsPanel.tsx`                               | 自动办件               |
| `LawmindSettingsTemplates.tsx`                              | 文书模板               |
| `LawmindSettingsMemory.tsx`                                 | 记忆库                 |
| `LawmindSettingsAssistants.tsx`                             | 助手编制               |
| `LawmindSettingsDisclaimer.tsx`                             | 免责声明               |
| `LawmindSettingsDoctor.tsx`                                 | 系统健康               |
| `LawmindSettingsTools.tsx`                                  | 安全（工具/沙箱）      |
| `LawmindSettingsSkills.tsx`                                 | 技能库（退役但可深链） |
| `LawmindSettingsMcp.tsx`                                    | MCP                    |
| `LawmindSettingsAppUpdate.tsx`                              | 应用更新               |
| `LawmindSettingsRoles.tsx`                                  | 角色说明（退役）       |
| `LawmindSettingsCollaboration.tsx`                          | 团队工作流（退役）     |
| `LawmindSettingsEdition.tsx` / `LawmindSettingsLicense.tsx` | 版本与授权（退役）     |

**「退役但可深链」**意味着：老的书签和上次停留的分区不会崩，但侧栏里不显示（第 2 章讲的 `SETTINGS_NAV_RETIRED_ITEMS`）。

### 记忆库那一屏

`LawmindSettingsMemory.tsx` 的头部注释说明了首屏策略：

> 首屏只处理「待确认」；档案与合同学习收进折叠。

也就是打开记忆库第一眼只看到**待你确认的建议**，不堆一堆档案内容。

### 系统健康那一屏

| 组件                                 | 作用                                      |
| ------------------------------------ | ----------------------------------------- |
| `LawmindSettingsDoctor.tsx`          | 主体（连接、核对、运行体检）              |
| `settings-doctor-groups.tsx`         | 分组渲染                                  |
| `LawmindSettingsDoctorWordAddin.tsx` | Word 插件诊断组（含「重新侧载清单」）     |
| `LawmindSettingsScorecard.tsx`       | 交办成绩单 + 诊断包（导出前二次点击确认） |
| `LawmindSettingsUsageStats.tsx`      | token 用量                                |

## 24.8 记忆库（`MemoryInspector`）

| 组件                               | 作用                                              |
| ---------------------------------- | ------------------------------------------------- |
| `MemoryInspector.tsx`              | 待确认建议队列（默认动作：确认 / 改写）           |
| `matter/MatterMemoryInspector.tsx` | 案件范围复用同一组件                              |
| `LawmindMemoryTruthSources.tsx`    | 真相源面板（读 `GET /api/memory/sources` + 预览） |
| `LawmindMemorySourcesPanel.tsx`    | 来源面板                                          |

`MemoryInspector` 的作用域：简单模式三个（律师 / 案件 / 律所），高级里八个全展开（第 6 章）。

## 24.9 首跑与向导

| 组件                        | 作用                                                               |
| --------------------------- | ------------------------------------------------------------------ |
| `LawmindFirstRunDialog.tsx` | 30 秒首跑（角色 → 偏好 → 起始交付物 → 建案件 + 种子交办 + 写偏好） |
| `LawmindApiSetupWizard.tsx` | 连接向导（API Key、Base URL、模型、工作区、检索通道、推荐栈）      |
| `HelpPanel.tsx`             | 帮助面板                                                           |
| `LawmindCommandPalette.tsx` | 命令面板                                                           |
| `FileWorkbench.tsx`         | 文件工作台                                                         |

首跑对话框的偏好选项（第 2 章列过）：角色三选（独立执业 / 律所协办 / 合伙人）、写作风格三选、风险取向三选、客户口吻三选。

## 24.10 审批相关

| 组件                               | 作用                              |
| ---------------------------------- | --------------------------------- |
| `LawmindApprovalQueue.tsx`         | 集中审批队列（案件内 + 工具审批） |
| `LawmindApprovalRequestHost.tsx`   | 消费全局审批状态（SSE 驱动）      |
| `LawmindApprovalDocReader.tsx`     | 审批时读文档                      |
| `stores/approval-request-store.ts` | 全局审批状态（zustand）           |

`LawmindApprovalRequestHost` 订阅 SSE，所以别的窗口产生的审批会实时出现。

## 24.11 状态管理的边界

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

## 24.12 界面与文案的约束

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

## 24.13 已知坑（本章相关）

- **聊天栏和编辑栏不能同时隐藏。** 会弹恢复提示。
- **「团队工作流」分区已退役。** 日常入口在顶栏「在办」。
- **`MatterReviewQueuePanel` 不自己 fetch。** 它只渲染传入的 view model，改数据流时注意这一点。
- **`LawmindReviewCampaignPanel` 不显示启发式安全分。** 那是内部信号（第 9 章）。
- **界面上没有绕过验收的入口。** 导出永远走 strict 门。
- **改稿三栏全关是被禁止的。** store 里有 `hasVisibleReviewPaneAfter` 保护。
- **`MatterQualityCockpit` 只在 Firm / Private 渲染。** Solo 看不到，不是 bug。
- **`MatterReplicaPanel` 在 Solo 不渲染。**
- **会议发言记录是落盘的**（`cases/<matterId>/team-meeting.jsonl`），参会人名册走服务端 `/api/matters/team-roster`。**只有「参会会话映射」在 sessionStorage 里**（换机器就没了）——别把整场会议当临时数据。
- **首跑偏好会写进记忆。** 那不是「随便选选」的表单，它会变成之后的默认口径。
