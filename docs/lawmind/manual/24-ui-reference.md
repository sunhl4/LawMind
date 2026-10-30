# 第 24 章 界面逐屏详解

第 2 章给过界面导览。这一章把每一屏的元素逐个说清楚：**它在哪、长什么样、点了会发生什么、背后的数据从哪来。**

## 24.1 主窗口骨架

主窗口的层次（`LawmindAppRootView.tsx`）：

```text
跳转链接（无障碍用）
模态宿主（弹窗挂在这里）
├── 侧栏（整理资料、设置整页打开时不挂；收起时宽度为 0）
├── 顶栏
└── 主体
    ├── 设置面板（打开设置时整页替换主区）
    └── 当前工作面
文件工作台宿主
```

全局错误弹窗挂在最外层（`main.tsx` 的 `LawmindUnexpectedErrorHost`）：渲染层未捕获错误（事件回调与 rejected promise；渲染崩溃由 `LawmindErrorBoundary` 管）弹出 `LawmindErrorReportDialog`，详情只带错误本身（类型 / 说明 / 堆栈，不含案件内容与密钥），可复制（`lm-error-report-copy`）后发给帮你看的人。

### 侧栏（`LawmindAppSidebar.tsx`）

从上到下：

| 元素                                       | 干什么                                                                   |
| ------------------------------------------ | ------------------------------------------------------------------------ |
| 品牌标                                     | 产品标识（设置齿轮在底部账号行）                                         |
| 新建对话（`lm-side-new-chat`）             | 在默认工作区开新对话                                                     |
| 本机目录树（`lm-side-explorer-work`）      | 文件系统桥可用时直接挂文件树；点文件在中栏打开，树宽可拖                 |
| 会话列表（`LawmindSideChatSessions.tsx`）  | 按文件夹分组的历史列表（对话 / 工作台中栏 / 在办）；有它时不再叠案件列表 |
| 案件列表（`LawmindMatterSidebarList.tsx`） | 仅在没有会话列表的窄情况出现；点选打开该案卷宗中栏，可新建案件           |
| 底部账号行（`lm-side-account-footer`）     | 头像 + LawMind + 金色「更新」药丸（有更新时）+ 设置齿轮                  |

侧栏只在**整理资料**（`mainView === "archive"`）和**设置整页**打开时不挂载（`showAppSidebar = mainView !== "review" && mainView !== "archive"`，`lawmind-app-root.tsx`；设置打开时再叠一道 `!settingsOpen`）。工作台不是独立主视图——点「工作台」后 `mainView` 仍是 `workspace`，只是中栏换成案卷；`review` 又会被根壳立即拨回 `workspace`（见 24.6）。所以工作台和改稿上侧栏都在。侧栏可以收起：节点还在，宽度为 0。

**「待我拍板」徽标按钮已整体下线。** 侧栏和顶栏都不再渲染它：`LawmindAppSidebar` / `LawmindAppHeader` 的 props 里还留着 `actionSummaryTotal` / `needsDecisionTotal` / `onOpenNeedsDecision`，但没有任何按钮消费，`lm-header-needs-decision` 已不存在。待决策现在在这两个地方办：对话里的待拍板卡（`LawmindRequiresActionCard`，见 24.11），以及工作台「今日提醒」里审批条目的「去『在办』拍板」——点它打开工作台本案卷宗，不是单独一页收件箱。计数仍用 `lawyerFacingDecisionTotal`：默认只算澄清、批准和待发信；外观里打开「签批审阅」后才把待审稿加进去。

### 顶栏（`LawmindAppHeader.tsx`）

| 元素           | 干什么                                                                                                                                             |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| 一级工作面切换 | **两个**：对话 / 工作台（`lm-tab-workspace` / `lm-tab-desk`）。「工作台」标题注明「在中栏打开案卷，对话留在右侧」。没有「在办」                    |
| 次级工作面 tab | 只有**整理资料**，且只在当前就停在整理资料时出现（`lm-tab-archive`，类名 `lm-tab-secondary`）。没有改稿 tab：`review` 设上后立刻被拨回对话（24.6） |
| 当前案件芯片   | `lm-open-matter-cockpit`：案卷中栏未开且有当前案件时出现；点它在工作台中栏打开本案卷宗，不是单独的案件详情面板                                     |
| 版面开关       | 隐藏/显示侧栏、中栏编辑区、对话列；`agents` 上只剩侧栏开关（`lm-agents-toggle-sidebar`）                                                           |
| 助手切换       | Firm 且助手多于一个时才出现（带在线点 `lm-assistant-presence`）；Solo 不显示                                                                       |
| 设置齿轮       | 平时在侧栏底部账号行；侧栏收起或在整理资料上时才移到顶栏                                                                                           |
| 待发出         | 不在顶栏。在工作台该案的「现在」里批准发送                                                                                                         |

当前模型在对话输入栏的 `LawmindModelPicker`，不在顶栏。

**顶栏一级 tab 只有对话和工作台**（第 2.4 节）。待发出跟案件走，在工作台该案的「现在」里。交出去的活和按流程办在设置 → 协作。类型里的 `meeting` 没有 tab，也没有「+」入口。未全部就绪时顶栏下有 `LawmindReadinessStrip`（模型、本地服务、工作区）。`⌘K` / `Ctrl+K` 开关全局搜索（`LawmindGlobalSearch`）。

版面开关有一个保护：**聊天栏和编辑栏不能同时隐藏**——都隐藏时会弹一个恢复提示（`LawmindWorkspacePaneRecovery`，`workspace-layout.spec.ts` 测的就是这个）。

### 面板拖出为独立窗口（多屏）

对话列和中栏的**左缘**各有一个竖向抓手（`LawmindPaneDetachGrip`，类名 `lm-pane-detach-grip`）；中栏顶部的**文件标签本身**也可以直接拖出（PDF / Word / 文本 / 表格等，等同 Cursor 的 editor tab）：

| 操作                       | 结果                                                              |
| -------------------------- | ----------------------------------------------------------------- |
| 按住抓手拖出 ≥ 48px 后松开 | 把整块 pane 拆到独立 `BrowserWindow`；主窗口对应 pane 先让位      |
| 拖动中栏文件标签后松开     | 只把这个文件移到独立窗口；主窗口标签关闭，新窗口成为它的编辑器    |
| 直接点抓手（或键盘 Enter） | 同样开独立窗口；拖不动时的等价入口                                |
| 独立窗口右上「收回主窗口」 | 关窗；主窗口收到 `lawmind:aux-window-closed` 后把 pane 收回       |
| 顶栏版面开关操作           | 解除「已拆出」状态；主窗口按开关的显隐显示该 pane（独立窗仍开着） |

有未保存修改的文本标签不会拖出（新窗口只能从磁盘读到旧内容），先保存再拖；PDF/Word 等无未保存缓冲的标签可直接拖。

路由走 hash `#lm-popout=workspace-pane&pane=chat|middle&...`，和交付预览的 `review-preview` 共用 `lawmind:open-aux-window`。窗口按内容带上下文：

- 对话窗按 `sessionId` 区分，多个会话可以各开一窗。
- 中栏窗按当前显示的内容区分（案卷 > 草稿台 > 文件）：`middleView=matter|draft|file`，并带对应的 `matterId` / `draftTaskId` / `relPath`+`root`。新窗口首帧会把主窗口正在看的案卷、草稿台或文件重新打开。
- 主窗口的对话/中栏在拆出期间只是隐藏，**不会卸载**；收起独立窗后恢复原状态。两边来回发过消息时，空闲状态下按服务端消息指纹对齐（独立对话窗约 2.5s 一轮；有回合在跑就改成跟 `live-turn` 轮询）。
- 中栏跟着对话的修改走：Word 预览自带 4s 快照轮询；文本标签（md/txt 等）先 `fsStat` 比对 mtime，变了才重读，**有未保存修改时不覆盖**。草稿台（`ReviewWorkbench`）没有轮询，要用它自己的「刷新」重取。
- 两个窗口共用同一个本地服务和 workspace。**同一会话不要在两窗同时发消息，也不要在两窗同时改同一份文件**：编辑中的瞬时状态（光标、未保存正文、流式半句）不跨窗同步，以服务端或最后保存者为准。

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

`LawmindAssistantDesk.tsx`（助手席）已退役：没有任何生产文件引用它。

### 输入区

| 组件                                | 作用                                                                                                               |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `lawmind-chat-compose-toolbar.tsx`  | 工具栏：模型、权限模式、检索开关；对话变长才出现整理入口                                                           |
| `LawmindComposeContextPicker.tsx`   | 钉选（`@` 文件、拖拽、粘贴）                                                                                       |
| `LawmindComposeContextUsage.tsx`    | 上下文用量触发钮（`lm-compose-token-bar`）：点开是整理面板——压缩、蒸馏、另起并带上文；模型窗口与额度数字不上律师面 |
| `LawmindComposeAttachments.tsx`     | 附件条                                                                                                             |
| `LawmindComposeTemplateGallery.tsx` | 模板画廊（填表交办）                                                                                               |
| `LawmindJobIntakeForm.tsx`          | 表单式交办：填完生成一条【交办】提示                                                                               |

`LawmindJobIntakeForm` 是可选填法。默认仍是输入框里的一句话。不想手打的人填完，系统把表拼成一条交办，不把填表变成 Day-1 必经步骤。

### 会话管理

| 组件                               | 作用                                                                                                                                                                           |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `LawmindSideChatSessions.tsx`      | 侧栏会话列表（对话 / 工作台中栏 / 在办）：按文件夹分组（`lawmind-chat-folder-groups.ts`）、搜索、文件夹下新建、重命名、多选删除；折叠状态存 `lawmind.chat.collapsedFolders.v1` |
| `LawmindChatSessionTabs.tsx`       | 对话主区顶部的会话标签——只在侧栏收起（会话列表不在侧栏）时出现；尾部塞 compact 历史                                                                                            |
| `LawmindSessionHistorySidebar.tsx` | 会话标签尾部的紧凑历史                                                                                                                                                         |
| `LawmindChatHistorySearch.tsx`     | 当前这条对话里查找（`⌘F`）。换会话用侧栏列表或输入 `/chats`                                                                                                                    |

### 状态与提示条

| 组件                               | 作用                                               |
| ---------------------------------- | -------------------------------------------------- |
| `LawmindIntentStatusBar.tsx`       | 「本轮按××处理」（输入区上方；不是任务类型选择器） |
| `LawmindChatDraftStatusBar.tsx`    | 草稿状态（挂在有关联 taskId 的最后一条消息行）     |
| `LawmindReadinessStrip.tsx`        | 就绪度条（顶栏下，未全部就绪时）                   |
| `LawmindClarificationForm.tsx`     | 澄清卡片                                           |
| `LawmindContextForkSuggestion.tsx` | 承前分叉建议                                       |

`LawmindCitationBanner.tsx`（引用完整性提示）不在对话消息列，它挂在改稿元信息栏与详情弹窗（见 24.6）。

### 过程展示

| 组件                            | 作用                                                               |
| ------------------------------- | ------------------------------------------------------------------ |
| `LawmindMsgToolGroup.tsx`       | 过程折叠条：一组合并显示的工具调用，默认收起——对话里真正的过程展示 |
| `LawmindTurnPlanCard.tsx`       | 回合计划卡（可勾掉步骤、改步骤字，再「开始执行」）                 |
| `LawmindChatThoughtPanel.tsx`   | **退役**：思考面板只被自身测试引用，对话不渲染                     |
| `LawmindChatExecutionTrace.tsx` | **退役**：执行轨迹同上                                             |
| `LawmindChatReviewSticky.tsx`   | **退役**：只剩类型引用（`ReviewOpenTarget`），组件不渲染           |

**为什么不堆过程芯片**：对话线程刻意不堆过程芯片、短路径按钮和步骤拍板卡（`GOALS.md` 里的「步骤多少不打断律师」）。工具过程就折在 `LawmindMsgToolGroup` 里。

### 引用与来源

| 组件                           | 作用                                                                                                  |
| ------------------------------ | ----------------------------------------------------------------------------------------------------- |
| `LawmindAnalysisChart.tsx`     | 助手正文里 chart 代码块渲染出的分析图表（`lawmind-chat-markdown.tsx`）                                |
| `LawmindSourcePreview.tsx`     | 来源 pill（按法律报告「参见」体例，不显示 `src-1` 这种内部码）：挂在改稿编辑器 / 预览与引用完整性条上 |
| `LawmindSourceAnnotations.tsx` | 来源批注（被 `LawmindSourcePreview` 引用）                                                            |
| `LawmindClauseGraph.tsx`       | 条款图：挂在改稿元信息栏（见 24.6），不在对话里                                                       |

对话里的「来源」对律师来说就是正文中的可点链接（见下「回复里可以点的链接」）。

### 记忆来源

| 组件                            | 作用                                                             |
| ------------------------------- | ---------------------------------------------------------------- |
| `LawmindMemorySourcesPanel.tsx` | 记忆档案体检面板：挂在**改稿元信息栏**（默认展开），不挂对话气泡 |

它显示每一层记忆档案是否在磁盘上、设计上能否进主说明（第 6 章那个区分）。不表示「本回答引用了哪些材料」。设置 · 记忆库里看档案用的是 `LawmindMemoryTruthSources`（见 24.9）。

### 回复里可以点的链接

助手正文里的按钮由 `renderLegalMarkdown` 认出来（`lawmind-chat-markdown.tsx`）。写法见第 3.2 节。

| 点到的东西                                 | 打开哪里                                                             |
| ------------------------------------------ | -------------------------------------------------------------------- |
| 稿（`lm-draft:`）                          | 中栏草稿台里的这份稿（见 24.6）                                      |
| 另一段对话（`lm-session:`）                | 那条会话                                                             |
| 公网网址                                   | 系统浏览器                                                           |
| 工作区里的 docx、pdf、表格、markdown、图片 | 编辑区。文本文件若带 `:行`，选中那一行                               |
| `.canvas.tsx`                              | 对话旁边的中间栏。预览标题不带 `.canvas.tsx`。要点回复里的链接才打开 |

内网地址、带账号密码的网址、磁盘绝对路径和含 `..` 的路径不会变成按钮。回复里提到画布不会自己打开。

画布预览的「导出网页」写出旁边的 `.canvas.html`，不是 Word。源码、保存、另存为在「源码」里。画布自己里面的链接也交给主窗口：网页走系统浏览器，工作区文件走中间栏。类型对不上的画布不渲染，中间栏显示 `Canvas check`（行号和说明）。从画布「接着问」会把这份画布钉进当前对话，输入框开头是可以点开的相对路径。法条与观点依据写在对话里（可点），改稿侧栏有引用完整性条；不要用中间栏另开核对纸，也不要另存 `canvas/核对-*.canvas.tsx`。

## 24.3 工作台（`desk`）

**工作台不是独立的一页。** 点顶栏「工作台」后，根壳把 `setMainView("desk")` 收成 `mainView = "workspace"` + 案卷中栏打开（`matterCockpitOpen = true`）：中栏渲染 `LawmindLawyerWorkbench`（`lm-desk-middle`），对话留在右侧。`⌘K` 全局搜索 `/agents` 则把**同一组件铺满主区**（错误边界写「在办」），那一支没有右侧对话列。组件内 `view` 为 `agenda` / `cases` / `matter` 三态（组件内状态，不是 `mainView`）。

### 主面板

`LawmindLawyerWorkbench.tsx`（`lm-lawyer-workbench`）。律师看到的是三态：

- **今日提醒（默认）**：跨案备忘录。聚合手写计划、待回复/法院来件、临近期限、待拍板入口；按逾期 / 今天 / 本周 / 备忘分区，并可按案件折叠。角标区分自动 / 手写 / 未结。点「办完」后从列表消失；手写备忘可「删除」清掉过时项，也可「新建案件并挂上」。误消项在底部「已办完」里可恢复。空日显示最近案件与「在对话里记一条」。对话绑定时可「只看本案」。
- **全部案卷**：一行一个案子，只标最热的一件事。顶上可点的跨案摘要（待发出、期限已过、未回）用来过滤。合同 / 诉讼是筛选。
- **这一卷（案件管理）**：抬头（案名、客户、对方、案号或法院，主按钮「接着办」）→ 现在（待发出、未回、最近期限；没事实则整块不出现）→ 卷（来件 / 我们写的 / 其余）→ 底（默认收起：当事人、案号、全部期限、谈话、旧案和先例）。

文件树里 `cases/<id>` 根上的右键菜单有「进入案件管理」；对话里说「打开/查看某某案」时，中栏也会跳到该案（不因只读查摘要工具误切）。待发出仍在「现在」里批准或驳回。对话仍是干活的地方。

下面这些组件**活着，但挂在别处**，不是工作台进门那一屏：

| 组件                                                                     | 作用                                                                               |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| `LawmindRequiresActionCard.tsx`                                          | 待拍板卡：挂在对话消息行（见 24.11）                                               |
| `LawmindAssignmentCommitmentCard.tsx` / `LawmindChatDraftStatusBar.tsx`  | 承诺卡与草稿状态条：挂在对话消息行                                                 |
| `LawmindTaskDrawer.tsx`                                                  | 任务抽屉：对话命令 `/tasks` 打开，拉开时订阅 SSE                                   |
| `LawmindDaemonRecap.tsx`                                                 | 「你走后发生了什么」回执：今日提醒里挂一份，设置 · 工作区也有（`lm-daemon-recap`） |
| `LawmindJudgmentEscalationCard.tsx` / `LawmindVerificationChecklist.tsx` | 升级卡与必核清单：挂在改稿元信息栏（见 24.6）                                      |

下面这些是**退役集群**（`docs/LAWMIND-CODE-AUDIT.md` 1.1），文件还在、单测还能渲染，但产品壳不挂：

| 组件                              | 原来是什么                       |
| --------------------------------- | -------------------------------- |
| `LawmindDeskDashboardSummary.tsx` | 工作台汇总条（只被自身测试引用） |
| `LawmindJudgmentItemsPanel.tsx`   | 待定夺项面板（同上）             |
| `MatterOverviewTodoCards.tsx`     | 旧案件台的待办卡                 |

### 案件驾舱（`matter/`）：旧案件台已退役

**这一节以前列的「驾舱」组件都不在当前界面上。** 旧案件工作台（`app/MatterView.tsx` + `MatterWorkbench` + `matter/` 目录约 50 个文件）整体不在渲染树里：`MatterWorkbench` 只被 `MatterView` 引用，而 `MatterView` 没有挂进主区（审计 1.1 的 104 文件退役集群，e2e `matter-cockpit.spec.ts` 自述「not the retired cockpit page」）。`MatterCockpit`、`MatterOverviewPanel`、`MatterTasksPanel`、`MatterReviewQueuePanel`、`MatterReviewMatrixPanel`、`MatterTimelinePanel`、`MatterMemoryInspector`、`MatterReasoningBoard`、`MatterQualityCockpit`、`MatterOpsBrief`、`MatterTheoryLitePanel`、`MatterLocalDocIndex`、`LawmindMatterHealthCard`、`MatterShellRecordsPanel` 等随之退役；`pickMainBodyBranchProps.ts` 里的 `pickMatterViewProps` 只剩测试在用。

现行案卷就是上面的 `LawmindLawyerWorkbench`：抬头 → 现在 → 卷 → 底，没有页签式驾舱。`matter/` 目录里**唯一还活着**的组件是 `MatterReplicaPanel`（成员协作面板，Firm 门控）：它挂在本案卷宗的「协作」折叠里（`lm-lawyer-matter-collab`）；另有 `matter/litigation-fee-view.ts` 等纯函数模块被工作台引用。旧集群的单测仍绿，不要把测试里的渲染当成产品界面写进操作步骤。

## 24.4 在办（`agents`）

顶栏**没有**「在办」一级 tab，`mainView === "agents"` 时主区渲染的是**整页 `LawmindLawyerWorkbench`**（错误边界写「在办」）——就是 24.3 那套工作台，只是没有右侧对话列。律师怎么进来：

| 入口                                         | 行为                                                                                       |
| -------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `⌘K` 全局搜索 `/agents`                      | 整页打开律师工作台                                                                         |
| 工作台「今日提醒」审批条目「去『在办』拍板」 | 带上案件打开工作台本案卷宗（`setDeskMatterFocus` + 案卷中栏），不是单独一页收件箱          |
| 对话里的待拍板卡                             | 不用进在办：消息行里的 `LawmindRequiresActionCard` 直接批准 / 改参数再批准 / 驳回 / 答澄清 |

**「待我拍板」收件箱已经收掉了。** 侧栏 / 顶栏的徽标按钮不再渲染（24.1）；`agentsNeedsDecisionFocus` 这套状态还在壳里流转，但消费它的办理列表 UI（下面的 fleet 集群）没有挂载。带案件上下文的「去『在办』拍板」落在工作台卷宗，不带案件的落回对话。

### 在办 fleet 界面：类型还在，界面不挂

下面这些文件还在仓库里，单测能渲染，产品壳不挂载（审计 1.1 的 fleet 子集群，13 个文件）。`LawmindAgentFleetPanel` 唯一导入者是 `app/AgentFleetView.tsx`，而 `AgentFleetView` 没有挂进主区；e2e `agent-fleet.spec.ts` 断言 `lm-tab-agents` 数量为 0。

| 组件                              | 作用                                                                       |
| --------------------------------- | -------------------------------------------------------------------------- |
| `app/AgentFleetView.tsx`          | 未挂载的在办视图壳（`active` / `delegations` / `workflows` 三段）          |
| `LawmindAgentFleetPanel.tsx`      | 主面板（左侧待办目录 + 右侧办理区）                                        |
| `LawmindAgentFleetListAside.tsx`  | 左栏列表                                                                   |
| `LawmindAgentFleetDetail.tsx`     | 右栏办理区（签批 / 补充 / 批准仪式 + 导出条）                              |
| `LawmindAgentFleetEmpty.tsx`      | 空态                                                                       |
| `LawmindFleetPostApproveBar.tsx`  | 批准后的动作条                                                             |
| `stores/fleet-desk-view-store.ts` | 左栏视图状态（「稍后看」持久化到 localStorage `lawmind-agents-snooze:v1`） |

委派仍然活着：`LawmindDelegateAssistDialog`（对话命令 `/delegate`，Firm 多助手时）照常弹；**交出去的活和按流程办在设置 → 协作**——那一屏是 `LawmindSettingsCollaborationBrief` + `LawmindCollaborationDesk`（含委派卡与按流程办）。以前从设置跳「去『在办』处理」的深链没有了：`onOpenCollaborationPage` 现在只打开设置 · 协作分区（`requestOpenCollaborationSettings`），不切主视图。旧「团队工作流」分区已退役。

## 24.5 会议室（`meeting`）：类型还在，界面不挂

律师走不到这一屏。依据：

- 顶栏测试断言没有 `lm-tab-meeting`（`LawmindAppHeader.test.tsx`）。
- `LawmindMainBodyContent.tsx` 只分支对话、工作台、在办、改稿、整理资料。`mainView === "meeting"` 会落到对话主面板，不渲染 `MeetingView`。
- `buildMeetingDeepLinkHandlers` 里的 `onOpenTopLevelMeeting` 把视图设成 `workspace`，不是 `meeting`。
- 现行工作台卷宗没有任何会议入口；旧案件台（已退役，见 24.3）的页签里也没有「会议」。
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

**`mainView === "review"` 在主窗口立不住**：根壳有一个 effect，一发现 `mainView` 是 `review` 就立刻拨回 `workspace`——所以 `⌘K` 全局搜索 `/review` 点下去会闪回对话，不会停在某个「改稿主视图」；主内容区对 `review` 分支直接 `return null`。

真正的改稿发生在**对话中栏的草稿台**：`LawmindMiddleDraftDesk`（`lm-middle-draft-desk`）监听 `LAWMIND_OPEN_DRAFT_DESK_EVENT`——对话里点 `lm-draft:` 链接、`requestOpenContractRevision` / `requestOpenDraftDesk`、工作台文书、自动办件「去审阅」都会走到这里。有 `taskId`、本地服务在、且案卷没占着中栏时，它渲染 `ReviewWorkbench`；条上「回到文件」（`lm-middle-draft-desk-back`）关掉草稿台。整个过程 `mainView` 一直是 `workspace`，侧栏和对话列都在。整页的 `app/ReviewView.tsx` 已退役，主区不挂它。独立预览窗是 hash popout（`#lm-popout=review-preview&taskId=` 只挂 `LawmindReviewPreviewPopout`），不是主区 tab。

三栏结构（第 8 章讲过显隐记忆；显隐持久化在 `stores/review-pane-visibility-store.ts`，`lawmind.ui.reviewPane*`）：

| 组件                                       | 作用                                                                                             |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| `LawmindMiddleDraftDesk.tsx`               | 中栏草稿台外壳：听事件开 / 关 `ReviewWorkbench`                                                  |
| `ReviewWorkbench.tsx`                      | 文书台容器                                                                                       |
| `review/ReviewWorkbenchDocumentColumn.tsx` | 文档栏（编辑区 + 预览）                                                                          |
| `review/ReviewWorkbenchMetaColumn.tsx`     | 元信息栏（验收门、独立审稿、出处、审查专案组）                                                   |
| `LawmindDraftDocumentEditor.tsx`           | 可编辑正文（Cursor 文档栏风格）                                                                  |
| `LawmindDraftDocumentPreview.tsx`          | 只读排版预览（可拖出去独立开窗）                                                                 |
| `LawmindRedlinePanel.tsx`                  | 红线面板（接受/拒绝/全部处理/重置基线）                                                          |
| `LawmindReviewTableEditor.tsx`             | 审查表编辑器                                                                                     |
| `LawmindReviewCampaignPanel.tsx`           | 审查专案组（**不展示启发式安全分**，只显示真实统计）                                             |
| `LawmindCitationBanner.tsx`                | 引用完整性提示（元信息栏；详情弹窗也挂一份）                                                     |
| `LawmindMemorySourcesPanel.tsx`            | 记忆档案体检面板（元信息栏，默认展开；见 24.2）                                                  |
| `LawmindJudgmentEscalationCard.tsx`        | 待定夺升级卡（元信息栏）                                                                         |
| `LawmindVerificationChecklist.tsx`         | 必核清单（元信息栏）                                                                             |
| `LawmindReviewDeliveryBar.tsx`             | 交付条（签批 / 验收 / 必核 / 引用是否可交付）                                                    |
| `LawmindReviewSelfCheckSummary.tsx`        | 交卷核对（机械门禁、独立审稿、引用）                                                             |
| `LawmindAcceptanceGate.tsx`                | 验收门展示                                                                                       |
| `LawmindOutboundSignoffCallout.tsx`        | 外发签批提示                                                                                     |
| `LawmindContractReviewLearningPanel.tsx`   | 合同审查学习面板                                                                                 |
| `LawmindProvenanceIndicator.tsx`           | 出处指示                                                                                         |
| `LawmindReviewPaneToggles.tsx`             | 三栏显隐开关（只被顶栏的 `review` 分支引用；该分支实际到不了，显隐状态由 visibility store 守着） |
| `LawmindReviewDraftPicker.tsx`             | 草稿选择器                                                                                       |
| `LawmindReviewPreviewPopout.tsx`           | 预览弹出窗                                                                                       |
| `LawmindSpreadsheetHintBar.tsx`            | 表格提示条（钉了 xlsx 时出现）                                                                   |
| `LawmindWordRevisionBar.tsx`               | Word 修订条（钉了 Word 时提示选「文书类型 × 立场」）                                             |

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

设置是**整页**（不是模态，打开时主区整页替换、侧栏不挂），左侧一条 8 项平铺目录 + 右侧内容区，支持搜索定位。Solo 的 8 项：**账号、模型与连接、工作区、外观、协作、自动办件、记忆库、免责声明**；Firm / `private_deploy` 在办案组末尾多一项**助手编制**。默认分区是「模型与连接」。

分区清单见第 2 章。这里补充各组件的职责：

| 组件                                                                                        | 分区                                                                                |
| ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `LawmindSettingsAccount.tsx`（内嵌 `LawmindSettingsLicense.tsx` 与应用更新检查）            | 账号（身份 / 许可 / 模型来源 / 用量）                                               |
| `LawmindSettingsModelRetrieval.tsx`（内嵌 `LawmindSettingsCustomModels.tsx`）               | 模型与连接（含自定义模型）                                                          |
| `LawmindSettingsWorkspace.tsx`（内嵌 `LawmindSettingsWorkspaceCare.tsx`）                   | 工作区（含本机文件夹；查找重建 / 案件档案整理只在需要时出现）                       |
| `LawmindSettingsPracticePlaybook.tsx` / `LawmindSettingsUserStandards.tsx`                  | 内嵌在**工作区**页（办案口径 / 自建标准），不是独立分区                             |
| `LawmindSettingsAppearance.tsx`（内嵌 `LawmindSettingsDoctorWordAddin.tsx` 的 Word 连接组） | 外观                                                                                |
| `LawmindSettingsCollaborationBrief` + `LawmindCollaborationDesk.tsx`                        | 协作（交出去的活 / 按流程办；完整表单 `LawmindSettingsCollaboration` 被协作台引用） |
| `LawmindAutomationsPanel.tsx`                                                               | 自动办件                                                                            |
| `LawmindSettingsMemory.tsx`                                                                 | 记忆库（见下「记忆库那一屏」）                                                      |
| `LawmindSettingsDisclaimer.tsx`                                                             | 免责声明                                                                            |
| `LawmindSettingsAssistants.tsx`                                                             | 助手编制（Firm 侧栏可见；Solo 只能深链）                                            |
| `LawmindSettingsSkills.tsx`                                                                 | 作业标准（退役、只读、不可安装）                                                    |
| `LawmindSettingsRoles.tsx`                                                                  | 角色说明（退役）                                                                    |
| `LawmindSettingsEdition.tsx`                                                                | 版本与授权（退役）                                                                  |

**「退役但可深链」**意味着：老的书签和上次停留的分区不会崩，但侧栏里不显示（第 2 章讲的 `SETTINGS_NAV_RETIRED_ITEMS`；`assistants` 也在其中，只是 Firm 会被 `settingsNavGroupsForEdition` 加回侧栏）。两个特例：`templates` 深链现在只渲染一段静态说明（出稿用内置模板，不能上传），独立组件已删；`doctor` 深链渲染空白——系统健康整屏已拆除，功能按去处收编：连接与运行体检收进「工作区」（`WorkspaceCare`，只在有问题时出现）与「账号」（许可 / 模型来源 / 用量），Word 连接收进「外观」，工具/沙箱开关随「本机访问默认放开」移除（第 15 章），`host` / `tools` / `app-update` 等旧分区 id 分别重定向到 工作区 / 模型与连接 / 账号。

2026-09 这轮删除的独立设置页：`LawmindSettingsDoctor.tsx`、`LawmindSettingsTools.tsx`、`LawmindSettingsTemplates.tsx`、`LawmindSettingsScorecard.tsx`、`LawmindSettingsUsageStats.tsx`、`LawmindSettingsHostAccess.tsx` 与 `settings-doctor-groups.tsx`。对话长度（200K / 500K / 1M）不是设置分区，是对话输入框工具条上的 `LawmindSettingsConversationLength.tsx`。

### 记忆库那一屏

`LawmindSettingsMemory.tsx` 的结构：顶部三个页签——**我的习惯 / 案件认知 / 已作废**（`LawmindMemoryLibrary`），待确认的建议写在「我的习惯」里，不单独占一页；下面两个折叠——**已沉淀档案**（`LawmindMemoryTruthSources`，只读）和**合同改稿学习**（`LawmindContractReviewLearningPanel`，有待签批的学习稿时才出现计数）。

也就是打开记忆库第一眼看到的是分好页签的记忆库，不堆一堆档案内容。

## 24.9 记忆库界面（设置 · 记忆库）

| 组件                                     | 作用                                                                                     |
| ---------------------------------------- | ---------------------------------------------------------------------------------------- |
| `LawmindMemoryLibrary.tsx`               | 记忆库三页签（我的习惯 / 案件认知 / 已作废）；动作走 `POST /api/memory/library/{action}` |
| `LawmindMemoryTruthSources.tsx`          | 真相源 / 已沉淀档案面板（读 `GET /api/memory/sources` + 预览，折叠只读）                 |
| `LawmindContractReviewLearningPanel.tsx` | 合同改稿学习（签批后沉淀；改稿元信息栏也挂一份）                                         |

**旧的「记忆检查器」已退役**：`MemoryInspector.tsx`（785 行的待确认建议队列页，确认 / 改写动作、简单三作用域 / 高级八作用域那套）全仓 0 生产导入，只被自身测试引用；`matter/MatterMemoryInspector.tsx` 随旧案件台一起退役。代码里散见的 `onOpenMemoryInspector` prop 现在打开的都是设置「记忆库」分区，不是那个队列页。`LawmindMemorySourcesPanel` 不在设置里，它挂在改稿元信息栏（见 24.2 / 24.6）。记忆的分层与作用域语义见第 6 章。

## 24.10 首跑与向导

| 组件                        | 作用                                                                                                                                |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `LawmindFirstRunDialog.tsx` | 单步窗口：只选身份（独立执业 / 律所协办 / 合伙人），选完即建演示案件开工。连上模型后默认不弹；从设置 → 账号重开。不写冷启动风格偏好 |
| `LawmindApiSetupWizard.tsx` | 连接向导（API Key、Base URL、模型、工作区、检索通道、推荐栈）                                                                       |
| `LawmindGlobalSearch.tsx`   | `⌘K` 全局搜索（`lm-global-search`）：命令 `/chat` `/desk` `/review` `/agents` `/new` `/config`，外加案件 / 期限 / 邮件 / 会话搜索   |
| `LawmindCommandPalette.tsx` | 对话内命令面板（`/chats` `/review` `/tasks` `/hub` `/automations` `/memory` `/delegate` `/config`；和全局搜索是两套命令表）         |
| `FileWorkbench.tsx`         | 文件工作台（侧栏树 + 中栏预览，见 24.14）                                                                                           |
| `HelpPanel.tsx`             | **退役**：帮助面板接在弹层宿主里，但 `showHelp` 恒为 `false`——全渲染树只有 `setShowHelp(false)`，没有任何入口能打开它               |

连上模型之后直接进空对话，并建「演示案件」。首跑对话框**只**收身份，选完即开工；**不**再选文书类型，**不**问行文/风险/对客习惯，也不把风格偏好写进模型提示。文书类型由对话判断，文风与口径以后走记忆库「确认后写入」。重开入口：设置 → 账号 →「开始时的偏好」→「重新填写」。不要把它写成连上模型之后的必经问卷。

## 24.11 审批相关

界面上的「审批」是两套，不要混：

| 组件                               | 作用                                                                                                       |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `LawmindRequiresActionCard.tsx`    | **回合内待办**：挂在对话消息行——批准 / 改参数再批准 / 驳回 / 回答澄清；恢复走 `POST /api/chat/resume`      |
| `LawmindApprovalRequestHost.tsx`   | **操作确认浮层**：消费全局审批状态（SSE 驱动），只处理 `/api/approvals` 里的操作确认，不是「待我拍板」队列 |
| `LawmindToolArgsEditDialog.tsx`    | 批准前改工具参数                                                                                           |
| `LawmindConfirmDialogHost.tsx`     | `confirmDialog()` 通用确认（删消息、截断重发等）                                                           |
| `stores/approval-request-store.ts` | 全局审批状态（zustand，不持久化）                                                                          |

`LawmindApprovalRequestHost` 订阅 SSE（`approval:update`），所以别的窗口产生的审批会实时出现；确认走 `confirmDialog` 再 `POST /api/approvals/{id}/approve|reject`。

**已退役**：`LawmindApprovalQueue.tsx`（集中审批队列，只被旧案件台的 `MatterTasksPanel` 引用）和 `LawmindApprovalDocReader.tsx`（只被退役的 `LawmindAgentFleetDetail` 引用）都不在当前界面。

## 24.12 状态管理的边界

渲染层用 zustand，约定写在 `stores/README.md`：

> 一个域一个文件；actions 跟 state 放一起；临时态与持久态分开；组件用 selector 订阅。

磁盘上五个 store，但**喂当前界面的只有三个**——fleet 与旧案件总览那两个随退役集群一起不挂载（24.3 / 24.4）：

| store                             | 管什么                       | 持久化                     | 现状                         |
| --------------------------------- | ---------------------------- | -------------------------- | ---------------------------- |
| `approval-request-store.ts`       | 全局审批状态                 | 否                         | 活着（操作确认浮层）         |
| `review-pane-visibility-store.ts` | 改稿三栏显隐                 | 是                         | 活着（`ReviewWorkbench`）    |
| `settings-panel-store.ts`         | 设置面板开关与当前分区       | 只有分区                   | 活着                         |
| `fleet-desk-view-store.ts`        | 在办左栏视图                 | 「稍后看」和手折分组持久化 | **退役**（fleet 界面不挂载） |
| `matter-overview-view-store.ts`   | 案件总览的筛选排序与洞察折叠 | 否                         | **退役**（旧案件台不挂载）   |

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

## 24.14 中栏文件预览（PDF 与常用格式）

侧栏的**本机目录树**（`lm-side-explorer-work`）就是文件工作台的树。点开工作区或本案里的文件后，中间一栏（中栏）按格式给出预览或编辑面。产品只有本机桌面壳；不要把 Vite 地址或浏览器页当成 LawMind。

### 怎么打开

| 做法                          | 结果             |
| ----------------------------- | ---------------- |
| 侧栏 → 本机目录树 → 点文件    | 中栏打开对应预览 |
| 对话回复里的工作区路径链接    | 中栏打开该文件   |
| 深链 / 命令面板打开工作区文件 | 同上             |

### 各格式在中栏做什么

| 格式                | 中栏能力                                 | 备注                                |
| ------------------- | ---------------------------------------- | ----------------------------------- |
| `.docx`             | Word 修订面（可改、可存、修订轨）        | 核心编辑面；见第 8 章               |
| `.pdf`              | 清晰页画 + **可选中文字**（见下）        | 不改正文；扫描件可能无字可选        |
| `.xlsx`             | 表格网格预览；可改单元格并保存、切工作表 | 无完整 Excel 功能区                 |
| `.pptx`             | 幻灯片图逐页预览 + 本页文字编辑，可保存  | `PptxFileView`（`lm-preview-pptx`） |
| `.doc`              | 说明 + 转 docx / 本机打开                | 旧二进制不直接当修订面              |
| `.eml`              | 邮件头、正文、附件清单                   | 只读                                |
| 音视频              | 本机播放控件                             | 只读                                |
| `.zip`              | 条目清单                                 | 不解压到磁盘                        |
| `.md` / `.markdown` | 默认渲染阅读面；可切「源码」编辑         | 复用对话侧 `renderLegalMarkdown`    |
| 图片 / 其它文本     | 预览或文本编辑                           | 文本可带 `:行` 定位                 |

种类判定在 `file/preview-kind.ts`（`resolvePreviewKind`）；活动预览容器的 testid 是 `lm-preview-active-{kind}`。需要系统里的 Word / WPS / 阅读器时，用预览顶栏的公共动作：「在对话中引用」「在访达中显示」「用本机应用打开」。

### PDF：像 Word 一样拖选文字

PDF 用 pdf.js 画页，并叠一层透明文字。选区由中栏自己接管（不是浏览器默认 PDF 插件），手感接近 Word：

| 操作              | 作用                                      |
| ----------------- | ----------------------------------------- |
| 左键按下并拖动    | 从落点选到指针所在处；行间空白也能跟着选  |
| 拖到窗口上下边缘  | 自动滚动，方便长选                        |
| Shift + 点击      | 从当前选区锚点延伸到新位置                |
| 双击              | 英文按词；中文按连续汉字                  |
| ⌘C / Ctrl+C       | 复制为纯文本（去掉 PDF 空字符并做正规化） |
| 顶栏 − / + / 页宽 | 缩放；缩放后会清掉当前选区                |

**边界（律师需要知道的）**

- 只读预览，不能在中栏改 PDF 正文或批注（二期另议）。
- 纯扫描件、无文字层时，页面能看，但拖选可能选不到字；请用本机 OCR 阅读器，或让助手走材料分析。
- 超长 PDF 中栏最多预览前 80 页；全文请「本机打开」。未滚到的页用占位，滚近再画，以省内存。
- 跨很多页拖选时，若中间页尚未挂载，选区可能短暂中断——再拖一下或先滚过再选即可。

实现入口：`apps/lawmind-desktop/src/renderer/file/PdfFileView.tsx`、`pdf-text-drag-select.ts`。样式在 `styles/file-workbench.css`（经 `pnpm lawmind:sync:renderer-css` 进 `styles.css`）。

## 24.15 已知坑（本章相关）

- **聊天栏和编辑栏不能同时隐藏。** 会弹恢复提示（`LawmindWorkspacePaneRecovery`）。
- **只有整理资料和设置整页没有侧栏。** 工作台是对话中栏的案卷、改稿是对话中栏的草稿台，`mainView` 都是 `workspace`，侧栏都在；`review` 会被根壳立刻拨回对话。侧栏收起时节点仍在，只是宽度为 0。
- **「待我拍板」按钮已下线。** 侧栏 / 顶栏都不渲染；待决策在对话待拍板卡里办，或从工作台「今日提醒」进本案卷宗。顶栏**没有**「在办」一级 tab；`/agents` 打开的是整页律师工作台，不是办理列表。
- **退役集群的测试仍绿，别当成产品界面。** 旧案件台（`MatterView` + `matter/`）、在办 fleet（`AgentFleetView` + `LawmindAgentFleet*`）、会议室（`MeetingView` + `MatterTeamMeeting*`）、`MemoryInspector`、`HelpPanel`、`LawmindChatThoughtPanel`、`LawmindChatExecutionTrace`、`LawmindApprovalQueue` 等共 104 个文件在仓库里但不挂载（`docs/LAWMIND-CODE-AUDIT.md` 1.1）。不要把它们写回操作步骤。
- **协作入口在设置 → 协作。** 交出去的活 / 按流程办都在那一屏；旧「团队工作流」分区退役，`onOpenCollaborationPage` 只打开设置分区，不切主视图。
- **`LawmindReviewCampaignPanel` 不显示启发式安全分。** 那是内部信号（第 9 章）。
- **界面上没有绕过验收的入口。** 导出永远走 strict 门。
- **改稿三栏全关是被禁止的。** `review-pane-visibility-store.ts` 的 `togglePane` 在全关时直接不生效（`countVisibleReviewPanes(next) === 0` 就保持原状）。
- **`MatterReplicaPanel` 在 Solo 不渲染。** 它是 `matter/` 目录里唯一还活着的组件，挂在本案卷宗的「协作」折叠里。
- **会议室不是当前界面。** 委派仍可能往 `cases/<matterId>/team-meeting.jsonl` 写系统行（第 16.7 节）。参会会话的 localStorage 键只被未挂载组件读写。不要在顶栏或输入条「+」里找「开会议室」。
- **首跑不写冷启动风格偏好。** 对话框只收身份；文书类型由对话判断，文风/风险口径走记忆库确认后写入，不要把首跑写成「习惯问卷」或文书选择器。
- **画布开在对话旁边的中间栏。** 要点回复里的链接才打开，不会因为最新一条提到路径就跳。类型检查不过时只显示 `Canvas check`，不渲染坏掉的页面。中间栏不再挂核对纸；法条依据在对话与改稿引用条里看。
- **PDF 中栏是只读预览。** 拖选文字见 24.14；改正文请本机打开或交办助手，不要指望在中栏批注 PDF。

## 24.16 和 Cursor / Harvey 对齐后收掉的重复入口

Cursor 把待处理收进一条代理收件箱；Harvey 把「待审」放在事项上，不另开一套审批中心。LawMind 收得更彻底：**单独的待决策收件箱没有了**。曾经的「待我拍板」徽标（先挂侧栏、侧栏不可用时改挂顶栏）和「在办」办理列表（fleet 界面）先后下线——按钮 props 还留在壳里但不再渲染，fleet 界面整棵进了退役集群。

现在待决策只有两种落点，都在律师手边：

- **对话里的待拍板卡**（`LawmindRequiresActionCard`）：澄清、批准、改参数再批准、驳回，当场办完。
- **工作台「今日提醒」**：跨案聚合待拍板条目，点「去『在办』拍板」带上案件打开本案卷宗。

顶栏一级只有对话和工作台。`/agents` 打开整页律师工作台，不是办理列表；交出去的活和按流程办在设置 → 协作。

对话线程继续不堆过程芯片；工具过程折在 `LawmindMsgToolGroup` 里。这和铁律 1（少迷路）以及铁律 5（步骤多少不打断）一致，不把 Cursor 的逐步确认搬进律师主路径。
