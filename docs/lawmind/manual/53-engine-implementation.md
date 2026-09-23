# 第 53 章 实现精读：经典五阶段流水线

第 1 章讲过引擎有**两个入口**：经典流水线（`engine/`）和 Agent 循环（`agent/`）。第 43 章讲了后者。这一章讲前者——它是 CLI、评测和引擎级测试用的那条路。

**为什么要读它**：它是「不用模型也能出一份稿」的那条路（`plan → research → draft → review → render`）。理解了它，你会更清楚 Agent 循环里哪些能力是「本来就有的」，哪些是 Agent 加的。

## 53.1 它和 Agent 循环的分工

|              | 经典流水线                                  | Agent 循环                       |
| ------------ | ------------------------------------------- | -------------------------------- |
| 入口函数     | `createLawMindEngine`                       | `createLawMindAgent` + `runTurn` |
| 谁决定下一步 | **代码**（五段固定顺序）                    | **模型**（回合内自己选工具）     |
| 每段之间     | 可以停下来等律师（确认、审核）              | 回合内不停                       |
| 主要用户     | CLI、评测、门禁脚本、引擎级测试             | 桌面产品主路径                   |
| 模型参与度   | `planAsync` / `draftAsync` 可选；默认纯规则 | 每轮都调模型                     |

**关键差异**：经典流水线的每一段都是**可以被单独调用、单独断言**的。所以它更适合测试与回归。而 Agent 循环的行为要靠 cassette 才测得清（第 18.3 节）。

## 53.2 工厂：`createLawMindEngine`

`engine/factory.ts` 只导出一个函数，它的做法是「装配」：

```text
① buildEngineContext(config)              ← 算路径（workspaceDir / outputDir / auditDir）
② loadWorkspaceDeliverableSpecs(workspace) ← 注册工作区自定义交付物规格
   有 warnings → emitWorkspaceSpecWarnings（best-effort）
③ 挂五段：plan/planAsync/confirm → research → draft/draftAsync
        → review/reopenDraftReview/recordQuality → render
④ 挂六个只读查询：getTaskState / getDraft / getMatterIndex
        / listMatterOverviews / getMatterSummary / searchMatter
```

### 配置面只有五个字段

`LawMindEngineConfig`：

| 字段           | 说明                                                       |
| -------------- | ---------------------------------------------------------- |
| `workspaceDir` | 必填。里面有 `MEMORY.md` / `LAWYER_PROFILE.md` / `memory/` |
| `outputDir?`   | 显式输出目录                                               |
| `projectDir?`  | 关联项目目录                                               |
| `adapters`     | 必填。检索适配器数组                                       |
| `assistantId?` | 助手 id                                                    |

**注意 `adapters` 是必填的**：经典流水线不自己决定去哪检索，由调用方给适配器。这是「引擎只编排，不绑定数据源」的体现。

### 一处刻意的容错

第 ② 步读工作区自定义规格时，注释写了一句话：

> 一个坏 JSON 不应让事务所离线

所以：**读失败的规格只记警告（审计 `deliverable.spec.invalid`），不让工厂抛错**。坏一个文件的代价，不该是整个引擎起不来。

### `EngineContext` 的六个字段

`engine/context.ts` 把原来闭包里的东西抽成了显式参数（注释说明这是为了「把五段拆到各自文件里独立测试」）：

| 字段                | 说明                                    |
| ------------------- | --------------------------------------- |
| `workspaceDir`      | 工作区                                  |
| `outputDir`         | 兜底输出目录（`<workspace>/artifacts`） |
| `outputDirExplicit` | **调用方是否显式传了 `outputDir`**      |
| `projectDir?`       | 项目目录                                |
| `auditDir`          | 审计目录（`<workspace>/audit`）         |
| `adapters`          | 检索适配器                              |
| `assistantId?`      | 助手                                    |

**`outputDirExplicit` 这个布尔字段单独存在是有原因的**：第 8 章讲的输出位置那一串优先级里，「显式指定」和「兜底」的待遇不同。光看 `outputDir` 的值分不清它是「用户指定了 artifacts」还是「默认落到 artifacts」——所以要单独记一个标记。

## 53.3 阶段一：plan

`engine/planning.ts` 导出三个：

| 导出                                    | 干什么                                              |
| --------------------------------------- | --------------------------------------------------- |
| `planSync(ctx, instruction, opts)`      | 走**关键词路由**（`route`），同步、纯函数           |
| `planAsyncImpl(ctx, instruction, opts)` | 走 `routeAsync`（有凭据就模型分类，否则回落关键词） |
| `confirmTask(ctx, taskId, opts)`        | 把任务标成 `confirmed`                              |

### plan 的输出是 `TaskIntent`

三个函数最后都会调 `commitPlannedIntent(ctx, intent)`（在 `engine/shared.ts`），它做四件事：

1. `resolveDefaultAssignee` —— 按 kind / deliverableType 解析默认承办人（第 16.5 节的 `routing/defaults.json`）。
2. `ensureTaskRecord` —— 建任务记录；如果新建了，发审计 `task.created`。
3. 有案件时建交付物（`createPlannedDeliverable`，`deliverableId = taskId`）。
4. 写今日日志（`## 任务计划`），并 upsert 一条工作记录（状态 `running`）。

**注意 `deliverableId = taskId`**：在经典流水线里，一个任务对应一个交付物，所以直接拿 taskId 当 deliverableId。Agent 路径里不一定是一比一。

### confirmTask 的两条硬约束

```text
任务不存在 → 抛 `任务不存在，无法确认：<taskId>`
```

而且它会写一条 `## 任务确认` 日志 + 追加案件进展。**确认不是改个状态就完了**，它在档案里留痕。

### 与 Agent 路径的关系

Agent 路径**没有**这个显式的 `confirm` 步骤。原因：对话里律师说完就相当于确认了。所以「确认门」是经典流水线（尤其是 CLI）特有的——它防的是「模型猜到了任务类型就一路跑到底」。

## 53.4 阶段二：research

`engine/researching.ts` 只导出 `researchTask`，但它的九步顺序很有讲究：

```text
① 有 matterId → ensureCaseWorkspace + 追加案件任务目标
② ensureTaskRecord
③ 【确认门】intent.requiresConfirmation 且状态不是 confirmed → 抛错
④ 状态 → researching，发审计 research.started
⑤ 加载记忆上下文（loadMemoryContext）
⑥ 调 retrieve({intent, memory, adapters})  ← 这里是真正的检索
⑦ 发审计 research.completed（详情记 sources / claims / riskFlags 的数量）
⑧ 状态 → researched
⑨ 写今日日志 + 案件进展 + 前 5 条结论进「核心争点」+ 每条风险与缺失进「风险」
```

**第 ③ 步是这条流水线的核心门禁**，报错文案是：

```text
任务 <taskId> 需要先确认后再执行检索。
```

**第 ⑨ 步的写法值得注意**：它把结论**前 5 条**写进案件档案的核心争点，**每条**风险标记与缺失项写进风险节。所以跑过一次检索，案件档案里就有了东西——这是「检索结果不只活在内存里」的体现。

## 53.5 阶段三：draft

`engine/drafting.ts` 的两个入口：

| 导出             | 特点                                           |
| ---------------- | ---------------------------------------------- |
| `draftSync`      | 走规则式草稿（`buildDraft`）                   |
| `draftAsyncImpl` | 走 `buildDraftAsync`（可能用模型）+ 记四段耗时 |

### 四段耗时

`draftAsyncImpl` 接受 `phaseTiming` 参数，会记四段：

```text
draft_model             ← 模型成稿
draft_contract_baseline ← 挂合同基线
draft_critic            ← 第二意见
draft_persist           ← 落盘（含推理图、lint、门禁、队列）
```

**为什么要单独记四段**：因为这四段里哪一段慢，说明的问题完全不同——模型慢是供应商的事，落盘慢是本地的问题。

### 角色门禁：`DraftCreationError`

`ensureRoleAllowsDraft` 检查「这个岗位允不允许出这类交付物」：

```text
roleAllowsDeliverable(role, classifyDeliverableKindFromIntent(intent))
```

不允许时抛 `DraftCreationError`，错误码 `draft_role_not_allowed`。

**但有一个例外**（注释写明）：

> W7：若 EngineContext 关联到一个 Role 且 Role.allowedDeliverableTypes 不允许当前 deliverable kind，则拒绝（throw DraftCreationError）。**Solo edition 仅 warn。**

也就是说：**律所版硬拦，单人版只警告**。理由是单人版没有「岗位分工」这个约束的现实基础——律师自己就是所有岗位。

### 角色是怎么找到的

`resolveRoleForContext` 的顺序：

```text
resolveLawMindRoot(workspaceDir) → 读助手档案 → getAssistantById
  → getRoleById(profile.roleId ?? profile.presetKey)
```

所以角色来自**助手档案**，而不是引擎配置。这是「岗位」概念的落点。

## 53.6 阶段四：review

`engine/reviewing.ts` 导出五个，其中 `reviewDraft` 是全仓最长的函数之一（十二步）。它的顺序值得逐步看：

```text
① 定状态（默认 approved），写 reviewedBy / reviewedAt，追加备注
② 引用完整性：resolveDraftCitationIntegrity → 不通过就发 draft.citation_integrity
③ 发 draft.reviewed；有标签再发 draft.review_labeled
④ 律师改动指标：算 rewriteAmplitudeDelta，非零或非 approved 时跑 lint
     → recordLintRunEvent + 产品指标 lint_escape + distributeLintEscape
⑤ 记律师编辑事件（recordLawyerEditEvent）
⑥ 一次通过判定：approved 且无备注且改动为零 → 产品指标 first_pass，否则 rewrite
⑦ 有审核时长 → 产品指标 review_duration
⑧ 【权威写侧】交付物 JSON 的状态映射 + applyDeliverableReviewStamp
⑨ 落盘草稿 + 同步任务记录
⑩ 学习门（learningGateOk）+ 审核标签写多处 + 拒绝棘轮
⑪ 「质量范例」标签 → 提升黄金样本
⑫ 日志 + 案件进展 + 闭环队列项与待审批
```

### 第 ⑧ 步那条注释很重要

```text
// reviewStatus is set from deliverable JSON authority (R-P2-7), not draft-first.
```

状态映射：

| 审核结果   | 交付物状态 |
| ---------- | ---------- |
| `approved` | `approved` |
| `rejected` | `blocked`  |
| 其他       | `drafting` |

**为什么是「交付物先行」**：因为交付物是「要交出去的东西」，草稿是「过程中的东西」。审核这件事的权威状态应该落在交付物上，草稿跟着走。

而且如果交付物写失败（`matterWriteFailed`），**学习写入会被门禁挡住**（`learningGateOk = !matterWriteFailed`）。这是个很细的保护：状态没落盘就不要写学习，否则学的是错的东西。

### `reopenDraftReviewImpl`：对称的那个写口

它做反向的事：`reviewStatus → pending`、清空 `reviewedBy` / `reviewedAt`、发 `draft.review_reopened`、调 `reopenDeliverableReviewStamp`（**对称写口**），并在没有队列项时重新开一条。

注释里把它叫「SSOT 对称写口」——**有正向就必须有反向**，否则「已批准」会变成不可逆状态。

### `recordQualityImpl`：三个比率

它从任务、草稿、检索快照、推理图里算三个比率：

| 比率                   | 数据源   |
| ---------------------- | -------- |
| `citationValidityRate` | 检索快照 |
| `riskRecallRate`       | 检索快照 |
| `issueCoverageRate`    | 推理图   |

`firstPassApproved` 的判据是三条同时成立：`reviewStatus === "approved"`、无审核备注、改动为零。

然后 `persistQualityRecord` + 发审计 `quality.snapshot` + 写看板 JSON。

### `recordLintEscape`：一个只在特定情况记的指标

```text
lintHits <= 0 && !lawyerEdited → 直接返回 false（不记）
否则：outcome = lintHits > 0 ? "lint_findings" : "lawyer_edit"
```

**它的语义要看清**：`lawyer_edit` 意思是「机械 lint 没发现问题，但律师还是改了」——这**不等于**「lint 漏了实体缺陷」（第 12 章的 `metrics/README.md` 专门解释了这一点）。

## 53.7 阶段五：render

`engine/rendering.ts` 只导出 `renderDraft`，但它是最长的一道门禁链。九步：

```text
① rejected → 直接拒（文案：文书已驳回（rejected），不能渲染。）
② 严格门禁：验收报告 + 推理报告，任一 blocker 未过就拒（审计 artifact.render_blocked）
③ 引用门禁：citationMode / citationGateStrict 两条路
     + 高风险类型还要过 matterTheoryBlocksStrictExport（requireAnchor）
④ 导出 lint 门（deliverableNeedsExportLint）+ 在线引用核验
⑤ 模板：override → resolveTemplateForDraft → preferComplaintMasterTemplate → 记录 pin
⑥ 位置：docx/pptx 扩展名 → resolveDefaultDeliverableLocation
⑦ 渲染：renderPptxWithOptions / renderDocxWithOptions，不支持的格式报错
⑧ 成功：lint + firstPass + recordDeliverEvent + 每节追加出处事件
     + 落盘 + 审计 artifact.rendered + 同步任务 + 案件产物 + 交付物状态 → rendered
⑨ 失败：审计 artifact.render_failed
```

### 第 ② 步的完整判据

```text
strict = opts?.strictGates ?? isFeatureEnabled("acceptanceGateStrict")
blocked = !acceptanceReport.ready || (reasoningReport.required && !reasoningReport.ready)
```

**注意 `reasoningReport.required` 这个前提**：只有需要推理门的类型（第 12.6 节那几组）才检查推理报告。不需要的类型即使推理报告不 ready 也不拦。

### 第 ③ 步有两条路

| 情况                | 判据                                                        |
| ------------------- | ----------------------------------------------------------- |
| 显式 `citationMode` | `citationModeBlocksRender(citationMode, integrity)`         |
| 否则看版本功能      | `citationGateStrict && citationGateBlocksRender(integrity)` |

而 `citationGateBlocksRender` 的实现只有三行：

```text
!view.checked → false（没检查过就不拦）
否则 !view.ok || view.unanchoredSections.length > 0 → 拦
```

**「没检查过就不拦」这条很关键**：没有检索快照时不存在「引用对不上」这回事，所以不该拦。

### 第 ③ 步还有一条「理论锚定」

高风险类型（`contract.*`、`letter.demand`、`letter.counsel`、`letter.reply`、`litigation.*`）在 `citationMode === "grounded"` 且有案件时，还要过：

```text
matterTheoryBlocksStrictExport(..., { requireAnchor: true })
```

拦下时的 detail 是 `theory_anchor_missing`。这对应第 7 章那句「理论没锚定，严格模式下不许导出」。

### 第 ⑦ 步的失败文案

```text
当前不支持渲染格式：...（仅支持 docx / pptx）。
```

### 第 ⑧ 步的一个细节

成功后会做两件事容易被忽略：

1. `recordDeliverEvent({...resolveDeliverSignals(...)})` —— 记交付事件，用 `resolveDeliverSignals` 算出「这次交付是自动还是人签」。
2. `createProvenanceEvent("export","system",...)` 追加到**每一节** —— 所以导出之后，每节的出处链末尾都多一条「已导出」。

## 53.8 `engine/shared.ts`：真正的重活

这个文件只导出三个函数，但 `persistDraftPipeline` 是全流水线最重的一段。它做完稿之后的**十二件事**：

```text
① 写今日日志「## 草稿生成」
② 发审计 draft.created
③ 落检索快照
④ 读规格；如果需要推理门就建并落推理图（缺则补）
⑤ 没 critic 备注就跑 critic + 落条款快照
⑥ 需要推理门但没 ready → 发 draft.reasoning_graph_missing
⑦ 自修订（applySelfReviseToDraft）+ 立场自查（stanceSelfCheck）
⑧ 跑 lint + 记 lint 运行事件
⑨ 建决策头（buildDecisionHeader）
⑩ 自动交付判定（evaluateAutoDeliver）→ 满足就标 approved + 记 unattended
⑪ 落盘草稿 + 同步任务 + 工作记录状态
⑫ 案件进展 + 关联交付物 + 强制互审 + 开队列项
```

### 第 ⑩ 步：自动交付的条件

```text
shouldAutoDeliver && decisionHeader?.ready === "usable"
```

两个条件同时成立才自动批。批了之后：

| 字段           | 值                        |
| -------------- | ------------------------- |
| `reviewStatus` | `approved`                |
| `reviewedBy`   | **`system:auto_deliver`** |
| 审计           | `draft.auto_delivered`    |

审计详情那句话值得抄下来：

```text
内部低风险且渐进自主已解锁，机械核对无硬伤。外发仍须签批。
```

**最后半句是必须的**——它把「自动交付」和「可以外发」明确分开。

### 第 ⑦ 步的自修订

`applySelfReviseToDraft` + `stanceSelfCheck` 会产出一句摘要：

```text
已做格式规范化 N 处；M 处需你定夺
```

**这条摘要会进决策头**，所以律师看到的不是「改了 12 处」这种笼统数字，而是「规范化 N 处 + 需定夺 M 处」的分工。

### `commitPlannedIntent` 的两个「埋点」

它除了建任务和交付物，还做两件容易被忽略的事：

1. `appendTodayLog(ctx, "## 任务计划", ...)` —— 计划进今日日志。
2. `upsertLawyerWorkFromPersist({status: "running", source: "chat"})` —— 建工作记录（第 56 章讲 `work/`）。

**注意 `source: "chat"`**：即使是 CLI 跑的，工作记录的来源也标成 `chat`。这个字段的含义是「来自一次交办对话」，不是「来自桌面聊天」——从第 59 章的 `LawyerWorkSource` 取值看，它是一个偏产品语义的枚举。

## 53.9 只读查询：`engine/queries.ts`

六个函数，全部是**直通**（注释写明「当前直接代理到 `cases/index.ts` 与 `drafts/index.ts`；未来可改为 application services 路径」）：

| 导出                        | 转发到                                      |
| --------------------------- | ------------------------------------------- |
| `getTaskState`              | `readTaskRecord`                            |
| `getDraft`                  | `readDraft`                                 |
| `getMatterIndex`            | `buildMatterIndex`                          |
| `listEngineMatterOverviews` | `listMatterOverviews`                       |
| `getEngineMatterSummary`    | `buildMatterIndex` + `summarizeMatterIndex` |
| `searchEngineMatter`        | `buildMatterIndex` + `searchMatterIndex`    |

**它们存在的意义是「让引擎的对外面完整」**：调用方拿一个 `LawMindEngine` 就能读能写，不用再 import 一堆模块。

「未来可改为 application services 路径」这句注释说明一件事：**这条流水线的读侧还没迁到 `application/` 那套服务**（第 45 章讲的）。两条路并存。

## 53.10 两个 helper

### `engine/role-helpers.ts`

只导出两个分类函数：

| 函数                                | 输入         | 输出              |
| ----------------------------------- | ------------ | ----------------- |
| `classifyDeliverableKindFromIntent` | `TaskIntent` | `DeliverableKind` |
| `classifyAudienceFromIntent`        | `TaskIntent` | 受众              |

注释说明了它为什么单独成文件：

> 抽出来避免 `shared.ts` 与 `drafting.ts` 重复实现。

**它的交付物分类靠关键词**（部分）：

| 关键词                        | kind                 |
| ----------------------------- | -------------------- |
| `contract` / `合同`           | `contract-review`    |
| `demand` / `律师函`           | `demand-letter`      |
| `litigation` / `诉讼`         | `litigation-outline` |
| `brief` / `output === "pptx"` | `client-brief`       |
| `timeline` / `时间线`         | `evidence-timeline`  |
| `memo` / `意见`               | `legal-memo`         |
| 兜底                          | `general-document`   |

受众的判定类似（`客户` → `client`、`法院` → `court`、`对方` → `counterparty`、`内部`/`律师` → `internal`、兜底 `unknown`）。

**注意这里和 `core/derive.ts` 的 `classifyDeliverableKind` 是两套**（第 59 章会讲）。一套吃 `TaskIntent`，一套吃文本。这是历史演进留下的双份——`role-helpers.ts` 的注释也承认了「避免重复实现」这个动机。

## 53.11 已知坑（本章相关）

- **`adapters` 是必填的。** 引擎不自己决定检索来源。
- **`outputDirExplicit` 是单独的字段。** 别用 `outputDir` 的值去猜是不是显式的。
- **读坏的交付物规格只警告不抛错。** 「一个坏 JSON 不应让事务所离线」。
- **`confirm` 只在经典流水线存在。** Agent 路径没有这一步。
- **角色门禁在 Solo 版只警告。** 不是漏了。
- **`deliverableId = taskId`**（经典流水线里一比一）。
- **自动交付需要两个条件同时成立**（`shouldAutoDeliver` + 决策头 `usable`）。
- **自动交付的审计里必须保留「外发仍须签批」。**
- **交付物写失败会挡住学习写入**（`learningGateOk`）。
- **`citationGateBlocksRender` 对「没检查过」返回不拦。**
- **推理门只在 `reasoningReport.required` 时拦。**
- **`queries.ts` 是直通，还没走 `application/` 服务。**
- **`role-helpers.ts` 的交付物分类和 `core/derive.ts` 是两套。** 改的时候别只改一边。
