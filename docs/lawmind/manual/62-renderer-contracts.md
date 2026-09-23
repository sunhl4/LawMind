# 第 62 章 实现精读：渲染层交互契约

第 50 章讲了渲染层的**架构模式**（props hook、pick 收窄、状态三层）。这一章讲**每个面板的交互契约**：它接受什么、点下去发生什么、什么被存进了浏览器。

「契约」在这里是有意义的词——因为很多约束**被测试守着**（第 62.8 节列出所有相关测试）。

## 62.1 五个一级面板的结构

### 对话：三层拆分

对话面在渲染层是三个组件叠起来的：

| 文件                               | 导出                                           | testid                                  |
| ---------------------------------- | ---------------------------------------------- | --------------------------------------- |
| `app/LawmindWorkspaceMainPane.tsx` | `LawmindWorkspaceMainPane`                     | `lm-chat-drop-zone`                     |
| `lawmind-chat-shell.tsx`           | `LawmindChatComposeFooter`、`LawmindChatShell` | `lm-compose-drop-zone` + 三条快车道     |
| `lawmind-chat-messages-column.tsx` | `LawmindChatMessagesColumn`                    | `lm-chat-empty`、`lm-chat-messages-end` |
| `LawmindChatMessageRow.tsx`        | `LawmindChatMessageRow`                        | 九个（见下）                            |

**四个 drop zone**：

```text
lm-chat-drop-zone        ← 对话主面板
lm-compose-drop-zone     ← 输入区
lm-compose-contract-fast-lane
lm-compose-mail-fast-lane
lm-compose-research-fast-lane
```

**四条快车道**（合同/邮件/研究三条 + 输入区）——所以「丢文件进来」在不同位置会进不同的车道。

### 消息行的九个 testid

`LawmindChatMessageRow` 是交互最密的一个：

| testid                                                | 干什么                                     |
| ----------------------------------------------------- | ------------------------------------------ |
| `lm-msg-edit` / `lm-msg-edit-submit`                  | 编辑消息                                   |
| `lm-msg-delete` / `lm-msg-delete-assistant`           | 删消息（**两条，用户消息与助手消息分开**） |
| `lm-msg-gate`                                         | 门禁标记                                   |
| `lm-authority-gap-banner`                             | 权威缺口横幅                               |
| `lm-demo-corpus-banner`                               | **演示语料横幅**                           |
| `lm-research-recovery-banner` + `-doctor` + `-models` | 检索失败恢复（三条：横幅 + 两个跳转）      |
| `lm-clarify-open-desk`                                | 打开在办处理澄清                           |

**「演示语料横幅」单独一条**——第 10.5 节那条水印在界面上有专门的位置。

**「检索失败恢复」有两条跳转**（去体检 / 去模型设置）——**它不只报错，还给了两个去处**。

### 三个「空态」分支

`LawmindChatMessagesColumn` 的三条空态 testid：

```text
lm-chat-empty                  ← 通用空态
lm-chat-empty-authority-boundary  ← 权威边界说明
lm-chat-empty-create-matter    ← 建议建案
```

**空态有三个不同的版本**——而不是一句「还没有消息」。

### 工作台：一个巨型文件与一条不变量

`LawmindLawyerWorkbench.tsx` 是渲染层最大的文件（约 106 KB、2600+ 行，冻结在文件大小棘轮里）。

它的 testid 有 **27 条**，其中最能反映功能的是：

| testid                                                                                                               | 干什么                      |
| -------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| `lm-lawyer-workbench`                                                                                                | 主容器                      |
| `lm-lawyer-today-plan-input` / `lm-lawyer-today-progress`                                                            | 今日计划                    |
| `lm-lawyer-today-item-deadline` / `lm-lawyer-today-item-mail-done`                                                   | 今日条目（期限 / 邮件）     |
| `lm-desk-quick-summons` / `lm-desk-quick-talk`                                                                       | 两个快捷入口（传票 / 谈话） |
| `lm-lawyer-deadlines-drop` / `lm-lawyer-talk-drop`                                                                   | 两个拖放区                  |
| `lm-lawyer-matter-dossier` / `lm-lawyer-matter-materials` / `lm-lawyer-matter-parties` / `lm-lawyer-matter-timeline` | 卷宗四块                    |
| `lm-materials-search-input` / `lm-materials-search-run` / `lm-materials-search-hits`                                 | 材料检索三件套              |
| `lm-precedent-list`                                                                                                  | 先例列表                    |
| `lm-lawyer-pulse-bar`                                                                                                | 案件快照条                  |
| `lm-lawyer-stat-deadline` / `lm-lawyer-stat-mail`                                                                    | 两个统计                    |
| `lm-lawyer-reconnect`                                                                                                | 重连按钮                    |

**注意两个「drop」是分开的**（`deadlines-drop` 与 `talk-drop`）——**丢给谁就进哪个功能**。这是「丢材料即交办」在工作台里的落点。

### 在办：左栏 + 右栏

| 文件                             | 导出                         | 职责                                      |
| -------------------------------- | ---------------------------- | ----------------------------------------- |
| `LawmindAgentFleetPanel.tsx`     | `LawmindAgentFleetPanel`     | 面板容器（testid `lm-agent-fleet-panel`） |
| `LawmindAgentFleetListAside.tsx` | `LawmindAgentFleetListAside` | 左栏（四个 Tab 常量 + 十几个 testid）     |
| `LawmindAgentFleetDetail.tsx`    | `LawmindAgentFleetDetail`    | 右栏（**20 条 testid**）                  |
| `LawmindFleetPostApproveBar.tsx` | `LawmindFleetPostApproveBar` | 签批后的导出条（9 条 testid）             |

### 一处容易找错的地方

**「待拍板 / 交出去的活 / 按流程办」这三个标签不在 `LawmindAgentFleetPanel` 里，而在 `app/AgentFleetView.tsx`。**

它们的 tab id 定义在 `lawmind-agents-desk.ts`：

| tab id        | 标签       |
| ------------- | ---------- |
| `active`      | 待拍板     |
| `delegations` | 交出去的活 |
| `workflows`   | 按流程办   |

`AgentFleetView` 的 testid 是 `lm-agents-desk`、`lm-agents-tab-active`、`lm-agents-tab-delegations`、`lm-agents-tab-workflows`。

**三个标签的措辞都避开了术语表禁词**：没有用「待办」（禁）、「进行中」（禁），而是「待拍板」「交出去的活」「按流程办」——都是律师语言。

### 左栏的 Tab 常量是导出的

`LawmindAgentFleetListAside` 导出四个常量（`FLEET_TAB_TEAM_ID` 等），值就是 testid 字符串。**导出它们是为了让测试与 e2e 引用同一个常量**，而不是各处手抄字符串。

四个常量分两组：Tab 按钮与 Tab 面板（`role="tab"` 与 `role="tabpanel"` 配对，所以各要一个 id）。

### 那三个「空态」分支

`LawmindAgentFleetPanel` 有两种空态：

```text
allQueue 与 teamRows 都空 → <LawmindAgentFleetEmpty kind="decision">
allQueue 非空但本案队列空 → <LawmindAgentFleetEmpty kind="filter">
```

**第二种是「筛出来了但都不属于本案」**——和第 62.2 节那条「先教怎么用」提示呼应。

### 改稿：三栏 + 四个专用编辑器

| 文件                                       | 导出                            | testid 数      |
| ------------------------------------------ | ------------------------------- | -------------- |
| `ReviewWorkbench.tsx`                      | `ReviewWorkbench`               | 0（它是容器）  |
| `review/ReviewWorkbenchDocumentColumn.tsx` | `ReviewWorkbenchDocumentColumn` | 0              |
| `review/ReviewWorkbenchMetaColumn.tsx`     | `ReviewWorkbenchMetaColumn`     | **7**          |
| `LawmindDraftDocumentEditor.tsx`           | `LawmindDraftDocumentEditor`    | 0              |
| `LawmindDraftDocumentPreview.tsx`          | `LawmindDraftDocumentPreview`   | 0              |
| `LawmindRedlinePanel.tsx`                  | `LawmindRedlinePanel`           | 3              |
| `LawmindReviewTableEditor.tsx`             | `LawmindReviewTableEditor`      | 3              |
| `LawmindReviewCampaignPanel.tsx`           | `LawmindReviewCampaignPanel`    | **16**         |
| `LawmindReviewDeliveryBar.tsx`             | `LawmindReviewDeliveryBar`      | 3              |
| `LawmindAcceptanceGate.tsx`                | `LawmindAcceptanceGate`         | 0（用 DOM id） |

**注意三个组件的 testid 数是 0**（`ReviewWorkbench`、两个列组件、两个编辑器、`AcceptanceGate`）——它们靠**内部结构**而不是 testid 被测试（比如 `AcceptanceGate` 用 `lm-review-acceptance-gate` 这个 DOM `id`）。

**而 `LawmindReviewCampaignPanel` 有 16 条**——因为它的交互最多（选 playbook、快速/并行开关、跑、取消、重跑角色、下载报告、看指标、看问题）。

## 62.2 六个「有判定逻辑」的组件

这一节是这一章的核心：那些**有明确分支判断**的组件。

### 输入工具栏：四档权限与三种按钮

权限模式是四个选项（存 `lawmind.ui.permissionMode.v1`）：

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

「开始执行」的行为是**先写执行权限再切模式**：

```text
onStartExecuteFromPlan ?? onPermissionModeChange(readExecutePermissionMode())
```

也就是：**点「开始执行」不只是切模式，还把这个选择持久化了**——所以下次还是标准模式。

而「恢复标准」同理（写 `standard` 再切）。

**这两个按钮的设计意图**：计划模式下不能写，但律师看完计划要能一键进入执行。所以给一个「开始执行」，走完再给一个「恢复标准」兜底。

### 联网开关的三个状态

```text
value = allowWebSearch ? "web" : "local"
options = 仅本地 / 联网
disabled = webSearchPolicyBlocked || loading
```

**`disabled` 有两个原因**：策略拦了（`webSearchPolicyBlocked`），或者正在加载。而且**策略拦时会禁用**——律师改不了。这对应第 15.9 节那条「策略是上限」。

### 模型选择器的三处提示

`LawmindModelPicker` 的判定：

| 情况       | 行为                                          |
| ---------- | --------------------------------------------- |
| 行没配 Key | 点击 → 打开配置向导（或设置）                 |
| 同上       | 行的 title：`未填 API Key，将打开配置向导`    |
| 目录为空   | 触发按钮 title：`Loading models…`             |
| 其他不可用 | 触发按钮 title：`Model switching unavailable` |

**「点未配置的模型 → 去配置」**是很好的交互：**它把「这个不能用」变成「去把它配好」**。

### 发送与中途指示的分叉

这一处很值得单独看。输入区发送按钮的行为是：

```text
loading && 有文本 && 有 apiBase && 有 sessionId
  → POST /api/sessions/:id/steer   { text }     ← 中途指示
  并清空输入 + 清 compose stash
否则
  → onSend()                                    ← 正常发一条
```

**同一个「发送」按钮在回合进行中会变成「中途指示」**。这就是第 3.2 节那条「中途指示（steer）」的界面落点。

而且它做了一件看着小但要紧的事：**清掉 compose stash**。因为那段文本已经作为中途指示送出去了（第 62.4 节讲 stash）。

**另一个按钮是不同的**：`onEnqueueNextTurn`（`lm-compose-enqueue-next`）走的是**跟进队列**（`onSend`），不是 steer。**「排队下一条」和「中途插话」是两件事。**

### `LawmindComposeContextUsage`：十个桶与三条水位

它显示的用量分解**顺序与引擎一致**（第 3.18 节那张表）：

| 桶            | 界面标签       |
| ------------- | -------------- |
| `lawyer`      | 律师发言       |
| `assistant`   | 助手回复       |
| `toolResults` | 工具回包       |
| `digest`      | 压缩摘要       |
| `turnContext` | 本轮上下文     |
| `pins`        | 钉选材料       |
| `plan`        | 本轮清单       |
| `craft`       | 改稿手艺       |
| `workspace`   | 交付与案件设置 |
| `rules`       | 系统规则       |

**代码注释明确说了「order matches engine TOKEN_BUDGET_BUCKET_ORDER」**——所以改顺序要两边一起改。

三条水位与后缀：

| level     | 环的颜色 | 后缀                       |
| --------- | -------- | -------------------------- |
| `compact` | danger   | `· 已达自动整理线`         |
| `warn`    | warn     | `· 接近自动整理线，可整理` |
| 其他      | ok       | （无）                     |

**百分比算法**：

```text
pct = min(100, max(0, used / effectiveLimit × 100))
```

**三条值得一提的显示规则**：

1. **`effectiveLimit <= 0` 时整个组件返回 `null`** ——没有预算就不显示环。
2. **只显示 tokens > 0 的桶**（`filter`）——空桶不占位置。
3. **数字格式化三档**：≥10000 → `Nk`（整数）；≥1000 → 一位小数 `k`（去掉 `.0`）；其他 → 整数。

第 2 条很实际：十个桶里通常只有三四个有内容，全列出来是噪音。

**环的画法**（SVG）：`r = 7`、周长 `c = 2πr`、`dashoffset = c × 0.25`、`transform = rotate(-90 9 9)`——**从 12 点开始顺时针**，这是进度环的常规做法。

**确认流程**：

```text
有 onPreviewCompact → beginAction 先弹确认（带预览）
没有 → 直接调 onCompact() / onDistill()
```

**「先预览再执行」**——因为压缩不可逆（虽然原文还在磁盘，但上下文里没了）。所以给一个确认。

### `LawmindClarificationForm`：三条提交路径

它的提交分支（`desk` / `compact` 两个变体）是三级回落：

| 情况               | 提交什么                                          |
| ------------------ | ------------------------------------------------- |
| 有结构化问题       | `buildClarificationAnswerMap(questions, answers)` |
| 无问题但有自由文本 | `{ note, [附件键], [会话键] }`                    |
| 都没有             | 空 map                                            |

**第二级的两个键名来自引擎**（`CLARIFY_ATTACHMENTS_KEY` / `CLARIFY_SESSIONS_KEY`，从 `clarification-fields.ts` import）——**所以界面和引擎共用同一套键名**，而不是各写一份字符串。

提交按钮的 disabled 条件是 `loading || !complete`，而 `complete` 由 `clarificationAnswersComplete(questions, answers)` 判——**必答项没填完不能提交**。

### 大纲确认那四条的编排

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

### 宿主侧那道「null 算没完成」的门

`LawmindAgentFleetDetail` / `useLawmindFleetCeremonyActions` 里有一句：

```text
deskChecklistComplete = Boolean(view && view.spec.items.filter(i => i.required).every(i => checked[i.id]))
```

**`view` 为 null 时结果也是 false**（因为 `Boolean(null && ...)`）——这条注释写明了是刻意的：

```text
null view is treated as not complete
```

**「查不到清单」不等于「没有必核项」**。所以签批按钮会被禁用（`primaryDisabled` 里带了 `!deskChecklistComplete`）。这是一个安全方向的默认值。

而「一键勾选必核」（`lm-fleet-checklist-check-all`）的 disabled 条件有四个：

```text
busy || deskChecklistLoading || deskChecklistComplete || !deskAcceptanceReady
```

最后一个的 title 是 `验收未过，请逐项过目`——**验收没过时不许一键勾**。这是很细的一处保护：**批量勾选不能让律师跳过验收**。

### `LawmindAcceptanceGate`：五条展开判据

它的核心是一个导出的纯函数（**所以能单独测**）：

```ts
acceptanceGateShouldExpand(report, reasoning) {
  if (!report.deliverableType) return false;             // 没类型 → 不展开
  if (!report.ready) return true;                        // 没过 → 展开
  if ((report.blockerCount ?? 0) > 0) return true;       // 有阻塞 → 展开
  if ((report.placeholderCount ?? 0) > 0) return true;   // 有占位 → 展开
  if (reasoning && reasoning.required && !reasoning.ready) return true;  // 推理门没过 → 展开
  return false;
}
```

**五条都是「有问题就展开」**。所以律师不用手动点开才看到问题。

而 effect 的写法有一处细节：

```text
useEffect 里每当 shouldExpand 为真就展开，忽略 defaultCollapsed
```

**「忽略 defaultCollapsed」**——如果出了问题，即使调用方说「默认收起」也要展开。

**三个早退分支**：

| 条件                   | 渲染                                     |
| ---------------------- | ---------------------------------------- |
| 没有 `report`          | `null`                                   |
| 没有 `deliverableType` | `这不是声明交付物类型，按通用文书放行。` |
| —                      | 正常渲染                                 |

**第二个分支把「没类型」显式说成「放行」**——而不是静默不显示。

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

**`hardBlockExport` 只认 `checklist` 与 `citation` 两种 blocker**——其他 blocker（比如 `review_pending`）不会走这条硬拦。

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
导出始终走 strict 验收门禁；UI 不再提供 ?strict=false 绕过入口。
```

**界面上没有绕过验收的按钮**——第 8.14 节讲过这条，这里是它的代码出处。

### `MemoryInspector`：两种模式与四组动作

作用域有两套：

```text
SCOPES        = [matter, lawyer, playbook, client, firm, assistant, opponent, project]   ← 八个
SIMPLE_SCOPES = [lawyer, matter, firm]                                                   ← 三个
```

**简单模式只给三个**——因为「playbook / opponent / project」这些对多数律师太抽象。

### 动作分两组

**默认动作**（一直可见）：

| 按钮 | 行为                                                                  |
| ---- | --------------------------------------------------------------------- |
| 确认 | `onAdopt(item.id)`                                                    |
| 改写 | 打开 textarea，预填 `item.payload`，要求非空否则报 `改写内容不能为空` |

**「更多」里的三个**：

| 按钮                | 行为                                               |
| ------------------- | -------------------------------------------------- |
| 预览变更 / 收起预览 | 切 `loadPreviewDiff`                               |
| 稍后再说            | `onSnooze`（**只存会话内 `ReadonlySet`，零写入**） |
| 忽略                | `onDismiss(item.id, "ignored")`                    |

**「稍后再说」是纯界面状态**——注释与实现都说明了它不写盘。这是个好设计：**「我现在不想决定」不该产生副作用**。

### 差异预览的显示

预览拉 `GET /api/memory/adoption/:id/preview-diff`，显示三样：

```text
写入后约 <N> 字
<code><目标路径></code>        ← 简单模式下隐藏
<差异 hunk 列表>               ← equal / add / remove 三种，前缀分别是空格 / + / -
```

**「目标路径」在简单模式下隐藏**——因为路径对律师是噪音（第 32 章那条禁词规范）。

失败时的回落链是 `hint ?? error ?? "无法加载变更预览"`——**三级兜底文案**。

### 批量采纳的两段式

```text
① POST /api/memory/adoption/adopt-batch { mode: "low_risk_style", dryRun: true }   ← 预览
② POST 同上 { dryRun: false }                                                      ← 真的写
```

**`dryRun` 默认 true 在服务端和界面两侧都是**（第 6.5 节讲过）。

按钮文案带数量：`确认采纳 N 条`。而被跳过的会单列：

```text
N 条不在待审列表，已跳过
```

**「已跳过」要显示出来**——否则律师会以为「点了 10 条就该写 10 条」。

### 排序规则

```text
[...list].toSorted((a, b) => (a.createdAt < b.createdAt ? 1 : -1))   ← 新的在前
```

**用的是 `toSorted`（不改原数组）**——第 44.1 节也见过这个用法，这是这个仓库的偏好。

## 62.3 首跑：四步与五组偏好

### 四步流程

```text
type Step = "role" | "prefs" | "spec" | "confirm"
```

界面上的进度是 `<ol>`：

```text
1. 身份  2. 习惯  3. 文书  4. 开始
```

**回退顺序**是 `confirm → spec → prefs → role`——**完整回退链**。

### 五组选项与它们的 id

**角色**（三个）：

| id          | 标签     |
| ----------- | -------- |
| `solo`      | 独立执业 |
| `associate` | 律所协办 |
| `partner`   | 合伙人   |

**三组偏好**（各三个）：

| 组              | id                                                                 |
| --------------- | ------------------------------------------------------------------ |
| `WRITING_STYLE` | `concise` 简洁直接 / `detailed` 详尽论证 / `litigation` 偏诉讼对抗 |
| `RISK_POSTURE`  | `conservative` 偏保守 / `balanced` 平衡 / `assertive` 偏进取       |
| `CLIENT_TONE`   | `formal` 正式严谨 / `plain` 通俗易懂 / `warm` 亲和说明             |

**「跳过偏好」会预设 `concise` / `balanced` / `formal`**，按钮的说明是 `简洁 · 平衡风险 · 正式语气`。

**注意「跳过」不是「不写」**——它写的是三个默认值。这是个刻意的取舍：偏好档案里总要有个起点。

### 自动弹出的三个条件

```text
① open 已经是 true → 不重复弹
② suppressAutoOpen → 不弹
③ localStorage 有 dismissed 标记 → 不弹
否则：
  localStorage/sessionStorage 的 requestOpen 是 "1" → 弹
  否则 GET /api/matters/overviews 空 → 弹
```

**第 ③ 步与后面的两个分支是「要么被要求弹，要么没有案件就弹」**——所以首跑只在「新环境」出现。

### 起始交付物的排名规则

```text
rank(spec):
  contract.review  → 0
  source 是 workspace → 1
  其他 → 2
取前 6 个
```

**`contract.review` 恒排第一**——因为它是最高频的办件。而工作区自定义的排在前面（比内置更贴合本所）。

### 演示案件名的构造

```text
演示案件-<sanitized displayName>
```

保留的字符集是 `\p{L}\p{N}._-` 加空格；兜底 `演示案件-示例`。

而「跳过向导」那条路用的是**固定名 `演示案件`**（不拼业务名）——因为跳过时还没有业务名。

### 偏好写成什么

三条笔记写到 `POST /api/lawyer-profile/learning`：

```text
冷启动偏好：行文风格=<…>
风险口径=<…>
对客语气=<…>
```

**前缀统一是「冷启动偏好：」**——所以以后能在档案里看出「这几条是首跑时写的」，而不是律师后来自己加的。

而且提交与跳过**都会调** `applyPostFirstrunPermissionDefaults({ executable: true })`——**首跑直接给可执行权限**（第 2.2 节那条「不再弹首跑向导」的配套）。

## 62.4 存储：本节逐条列出的 33 个 localStorage 键与 4 个 sessionStorage 键

**先说清口径**：渲染层里形如 `lawmind.*` / `lm.*` 的存储键字面量，2026-09-23 静态数出约 **44 个**（非测试文件）。本节只逐条讲**有行为含义**的那些，不去凑总数——边角键（面板宽度之类）列全了没有增量信息。

下面按用途分六组。

### localStorage 按用途分六组

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

**输入区与上下文**（4 个）：

```text
lawmind.compose.stash.<matterId|_global>
lawmind.compose.recentFileContext
lawmind.ui.allowWebSearch
lawmind.ui.briefOnly.v1
```

**会话与工作流**（5 个）：

```text
lawmind.chat.activeSession.v1
lawmind.planHandoff.v1
lawmind.postApproveExport.v1.<taskId>
lawmind.ui.forkSuggestDismissed.v1
lawmind.fleet.collapsedGroups.v1
```

**审稿与出稿**（7 个）：

```text
lawmind.review.autoExportOnApprove
lawmind.review.requireSignoffReview
lawmind.ui.reviewPaneMeta
lawmind.ui.reviewPaneEditor
lawmind.ui.reviewPanePreview
lawmind.ui.reviewWorkbenchMetaWidth
lawmind.ui.reviewWorkbenchEditorWidth
```

**界面与版面**（十几个）：

```text
lawmind.ui.sidebarCollapsed / sidebarWidth
lawmind.ui.wsPaneChat / wsPaneEditor / wsChatColumnWidth
lawmind.ui.filesExplorerWidth
lawmind.ui.matterWorkbenchListWidth
lawmind.ui.chatComposeHeight.v3
lawmind.ui.meetingMaterialsCollapsed
lawmind.ui.showToolTrace.v1
lawmind.ui.test                     ← 测试专用
lm.ui.fontScale.v1 / density.v1 / reducedMotion.v1 / theme.v1
```

**分组的规律很清楚**：`lawmind.ui.*` 是界面偏好，`lawmind.<功能>.*` 是功能偏好。

### 三个 `.v1` / `.v3` 的意义

```text
lawmind.ui.permissionMode.v1
lawmind.chat.activeSession.v1
lawmind.ui.chatComposeHeight.v3          ← 第 3 版
```

**版本后缀是「换了结构就换键名」的做法**——所以旧版本的脏数据不会被误读。

`chatComposeHeight.v3` 到第 3 版说明这个值改过两次结构。

### 四个 sessionStorage 键

```text
lawmind.teamMeeting.session.<matterId>
lawmind.teamMeeting.participants.<matterId>
lawmind-lawyer-review-sig:<key>
lm.firstRun.requestOpen
```

**前两个是会议室**（第 16.7 节讲的「换机器就没了」）。

**第三个是「律师审核通知」的去重签名**——避免同一个审核重复弹通知。

### 三个「按案件/任务分键」的

```text
lawmind.compose.stash.<matterId|_global>
lawmind.postApproveExport.v1.<taskId>
lawmind.reviewMatrix.notes.v1.<matterId>
```

**分键的原因各不相同**：草稿按案件（切案时草稿该分开）、导出去重按任务、矩阵批注按案件。

### `lm.` 与 `lawmind.` 两个前缀

有两个前缀混用：

| 前缀       | 用在哪                                 |
| ---------- | -------------------------------------- |
| `lawmind.` | 大部分（较新）                         |
| `lm.`      | 外观四件套、特权提示、专案组开关、首跑 |

**这是历史演进**：早期用 `lm.`，后来统一成 `lawmind.`。改的时候要注意两边都在用。

## 62.5 四个「不算 drag-drop」的地方（一处容易误判）

我在核对时发现一个容易误判的点：**`FileWorkbench` 没有拖放导入。**

`file/` 下的树行是拖放的**来源**（`encodeLawmindFsDrag` + `LAWMID_FS_DRAG_MIME`），不是目标。整个 `FileWorkbenchView` / `FileWorkbenchTree` / `FileWorkbenchImpl` 里**没有 `onDrop` / `onDragOver`**。

**导入的入口是另一条路**：

```text
casesNodeActions.onImportMatters / canImportMatters / importMattersBusy
```

也就是**「导入案件」菜单项**，不是拖放。

而**聊天侧的拖放是有的**（第 62.1 节那四个 drop zone）。

**这个区别值得记住**：拖文件进对话 = 钉选上下文；拖文件进文件工作台 = 不行，要用菜单。

### 文件工作台的根与禁区

两个根（`RootKey`）：`workspace` / `project`。

**五个受保护路径**（删除时要求输入文件名确认）：

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

**先建目录再建案件**——所以目录结构与案件记录是一致的。

### 快速打开的打分

`scoreMatch` 五档：

```text
精确匹配        100
前缀匹配        80
包含匹配        60
路径包含        30
不匹配          0
结果最多 14 条
```

### 图片与 Office 的处理

`openFile` 的顺序：

| 情况                    | 处理                                    |
| ----------------------- | --------------------------------------- |
| Office 类（7 种扩展名） | `officeBlock`（不开 tab）               |
| 已有 tab                | 激活                                    |
| 读失败且含 `"binary"`   | `officeBlock`（mode: office 或 binary） |
| 是图片                  | `imagePreview`（data URL）              |
| 其他                    | 文本 tab                                |

**Office 类不开 tab 是个明确选择**：这些格式在这个界面里读不了（要用 `analyze_document`）。所以**拦下来而不是给个烂预览**。

保存到工作区外的提示也值得一提：

```text
已保存到工作区外：<path>（可继续在编辑器中编辑当前标签；保存仍指向原文件路径。）
```

**它解释了「为什么还能编辑但保存行为不同」**。

## 62.6 三处「组件之间」的约定

### 会议室的三条存储前缀与一个常量

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

### 记忆来源面板的 sentinel

`LawmindMemorySourcesPanel` 处理客户档案时有两个特殊值：

```text
client_profile_root
CLIENT_PROFILE.md
```

**根级客户档案不是某个客户**，所以用 sentinel 而不是 `clients/<id>/` 那种路径。

### 设置导航的四个常量

| 常量                               | 内容                                                |
| ---------------------------------- | --------------------------------------------------- |
| `LAWMIND_SETTINGS_DEFAULT_SECTION` | `"models"`                                          |
| `LAWMIND_SETTINGS_SCROLL_ANCHORS`  | `{ memoryTruth: "lawmind-settings-memory-truth" }`  |
| `SETTINGS_LAST_SECTION_KEY`        | `"lawmind.settings.lastSection"`                    |
| `DAY1_SECTION_IDS`                 | models / workspace / host / appearance / disclaimer |

而四个「退役但可深链」的分区有专门的常量：

```text
SETTINGS_NAV_LEGACY_SECTION_IDS  = ["review-prefs", "roles", "collaboration", "skills", "edition"]
RETIRED_LAST_SECTION_IDS         = { roles, collaboration, skills, edition }
```

**两组的差别**：`review-prefs` 是「旧分区名」（现在叫 `appearance`），所以它**会被重定向**；而另外四个是「退役的」，只是不出现在侧栏。

**默认分区是 `models`** 的注释写明了原因：

```text
Day-1 landing: connect models first, not a health dashboard.
```

**「先连模型，不是先看体检」**——首跑优先级的体现。

## 62.7 测试守着的那些契约

第 62.2 节讲的判定逻辑里，有几条被单测直接守着。我列一下（这一节的作用是告诉你**哪些改动会撞测试**）：

| 测试文件                                     | describe                                                       | 守什么                       |
| -------------------------------------------- | -------------------------------------------------------------- | ---------------------------- |
| `LawmindAcceptanceGate.test.tsx`             | `acceptanceGateShouldExpand`、`LawmindAcceptanceGate`          | 五条展开判据                 |
| `LawmindReviewDeliveryBar.test.tsx`          | `LawmindReviewDeliveryBar`                                     | 六分支的按钮文案             |
| `LawmindReviewPaneToggles.test.tsx`          | `LawmindReviewPaneToggles`                                     | 三栏至少留一栏               |
| `LawmindReviewSelfCheckSummary.test.tsx`     | `LawmindReviewSelfCheckSummary`                                | 交卷核对的显示               |
| `MemoryInspector.batch.test.tsx`             | `MemoryInspector · 批量采纳`                                   | **预览不写入、确认后才落盘** |
| `LawmindReviewCampaignPanel.test.tsx`        | `LawmindReviewCampaignPanel`                                   | 专案组面板                   |
| `LawmindComposeContextUsage.test.tsx`        | `LawmindComposeContextUsage`                                   | 用量环与桶                   |
| `LawmindComposeAttachments.test.tsx`         | `LawmindComposeAttachments`                                    | 附件                         |
| `LawmindChatComposeFooter.drop.test.tsx`     | `LawmindChatComposeFooter file drop`                           | 丢文件进输入区               |
| `LawmindComposeModelWarn.test.tsx`           | `LawmindChatComposeFooter model warn`                          | 模型未配时的提示             |
| `LawmindClarificationForm`（同目录）         | —                                                              | 澄清表单                     |
| `LawmindFirstRunDialog.test.tsx`             | `LawmindFirstRunDialog 演示案件名`                             | **演示案件名的构造**         |
| `LawmindLawyerWorkbench.test.tsx`            | `LawmindLawyerWorkbench`                                       | 工作台                       |
| `LawmindJudgmentPanel.test.tsx`              | 四条（含「待定夺卡 · 旁路展示」）                              | 判定项面板                   |
| `LawmindToolArgsEditDialog.test.tsx`         | `LawmindToolArgsEditDialog`                                    | 审批参数编辑                 |
| `matter/MatterWorkbenchTabs.test.tsx`        | `MatterWorkbenchTabs`                                          | 案件工作台 Tab               |
| `matter/MatterCognitionPanel.test.tsx`       | `MatterCognitionPanel density`                                 | 认知面板                     |
| `review/ReviewWorkbenchMetaColumn.test.tsx`  | **`ReviewWorkbenchMetaColumn 律师语言`**、`· 待定夺项旁路展示` | **律师语言**                 |
| `review/useReviewWorkbenchActions.test.tsx`  | `useReviewWorkbenchActions.submitReview`                       | 提交审核                     |
| `app/LawmindFileWorkbenchHost.test.tsx`      | `LawmindFileWorkbenchHost`                                     | 文件工作台挂载               |
| `app/LawmindWorkspaceBootstrapGate.test.tsx` | `LawmindWorkspaceBootstrapGate`                                | 引导门                       |
| `file/FileWorkbenchDialogs.test.tsx`         | `FileWorkbenchDialogs`                                         | 对话框                       |
| `file/FileWorkbenchContextMenu.test.tsx`     | `FileWorkbenchContextMenu`                                     | 右键菜单                     |

### 那个「律师语言」测试

`ReviewWorkbenchMetaColumn 律师语言` 这个 describe 名字很直白——**它测的是「界面上说的是不是律师语言」**。

这是第 32 章那套文案规范在测试层的落点：**除了 lint 脚本，还有断言具体措辞的测试**。

### `MemoryInspector.batch` 守的那条

第 6.5 节讲过它的两条测试：

```text
预览不发写入请求，确认后才一次落盘
没有待确认项时不提供批量入口
```

**第一条是「零写入」姿态在界面层的守卫**——它断言预览阶段**一个写入请求都没发**。这类测试（断言「什么都没发生」）比断言「发生了什么」更难写，也更有价值。

## 62.8 已知坑（本章相关）

- **「待拍板 / 交出去的活 / 按流程办」在 `AgentFleetView.tsx`，不在 `LawmindAgentFleetPanel.tsx`。**
- **`FileWorkbench` 没有拖放导入。** 树行是拖放来源；导入走「导入案件」菜单。
- **同一条「发送」按钮在回合进行中会变成「中途指示」。**
- **「排队下一条」和「中途插话」是两个按钮、两条路。**
- **用量桶的顺序必须与引擎一致**（注释里写明了）。
- **`effectiveLimit <= 0` 时用量环整个不渲染。**
- **`view` 为 null 时「必核清单」按未完成处理。**
- **验收没过时不许「一键勾选必核」。**
- **`AcceptanceGate` 的展开逻辑忽略 `defaultCollapsed`**（有问题就必须展开）。
- **界面上没有绕过验收的入口。**
- **「稍后再说」不写盘**（只存会话内）。
- **批量采纳的 `dryRun` 默认 true。**
- **首跑的「跳过偏好」会写三个默认值**，不是不写。
- **首跑偏好笔记都带「冷启动偏好：」前缀。**
- **`chatComposeHeight` 已经到 `.v3`**（换过两次结构）。
- **localStorage 有 `lm.` 与 `lawmind.` 两个前缀在混用。**
- **`cases` 与 `assistants.json` 只在根这一层受保护**（案件内的文件是普通的）。
- **Office 类文件在文件工作台不开 tab**（拦下来而不是给烂预览）。
- **会议室的打断检测靠回复文本匹配**，没有状态通道。
- **`chatComposeHeight` / 三栏显隐 / 工作区宽度这些是「记住也没关系」的**；审批状态、筛选条件不落盘。
- **改这些有测试守着的组件（第 62.7 节那张表）会撞测试。** 先想清是约束过时还是代码错了。
