# 第 59 章 实现精读：其余模块与全局契约

前面各章讲完了大模块。这一章收尾：讲那些「不大但到处被用」的模块，以及几个**全局契约文件**。

## 59.1 领域对象与生命周期（`core/`）

`core/` 只有五个文件，但它是**所有域对象的定义处**。

### `contracts.ts`：七个域对象

它声明（或重导出）七个类型：

| 类型              | 是什么                   |
| ----------------- | ------------------------ |
| `Matter`          | 案件                     |
| `Deliverable`     | 交付物                   |
| `ApprovalRequest` | 审批                     |
| `Deadline`        | 期限                     |
| `WorkQueueItem`   | 待办                     |
| `MemoryNode`      | 记忆节点                 |
| `MatterReadModel` | 案件的读模型（组合视图） |

外加两个枚举：`MatterStatus`、`DeliverableKind`、`MatterKind`、`QueueKind`。

`core/contracts.ts` 的 `Matter` 已有 `causeOfAction`、`counterparty`、`parties`。落盘形状以 `schema.ts` 的 `MatterRecordSchema` 为准。

### 五个 builder 与它们的 id 格式

`core/contracts.ts` 还导出五个「从 `MatterIndex` 造对象」的函数。它们的 **id 格式是约定**：

| 函数                                   | id 格式                                                                                             |
| -------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `buildApprovalRequestsFromMatterIndex` | `<taskId>:task-confirmation`、`<taskId>:draft-review`                                               |
| `buildQueueItemsFromMatterIndex`       | `<taskId>:confirm`、`:review`、`:revise`、`:render`；`<matterId>:evidence:N`、`<matterId>:strategy` |

**这些带冒号的 id 是「派生 id」**——第 9.6 节讲过它们的触发条件。而且审批那边有一个细节：**派生的审批 id 会被过滤掉**（服务端把它和真实审批合并时会剔除）。

`MatterReadModel` 里有 `latestActivity`，**上限 10 条**。

### `deliverable-lifecycle.ts`：十二种转移

这个文件的转移表是全仓最完整的状态机之一。**八态、十二种合法转移**：

| 从               | 到               | 说明                         |
| ---------------- | ---------------- | ---------------------------- |
| `planned`        | `drafting`       | Start drafting               |
| `drafting`       | `pending_review` | Submit for lawyer review     |
| `pending_review` | `approved`       | Approve draft                |
| `approved`       | `rendered`       | Render deliverable           |
| `rendered`       | `delivered`      | Mark delivered to audience   |
| `delivered`      | `learned`        | Capture post-review learning |
| `drafting`       | `blocked`        | Block draft                  |
| `pending_review` | `blocked`        | Request changes              |
| `blocked`        | `drafting`       | Resume drafting              |
| `approved`       | `pending_review` | **Reopen review**            |
| `blocked`        | `pending_review` | **Reopen review**            |
| `rendered`       | `pending_review` | **Reopen review**            |

**最后三条最关键**，源码里专门有一行注释：

```text
// 重开审核（reopenDraftReview）：律师把已签批/已阻塞/已渲染的交付物退回待审核。
```

也就是说：**`approved` 和 `rendered` 都不是终态**——律师可以退回。这把「签批」从「不可逆」变成了「可撤」。

**没有 `delivered → ?` 和 `learned → ?` 的转移**——那两个是终点（`delivered` 只能到 `learned`，`learned` 无处可去）。

### 四个函数

| 函数                           | 行为                                                                |
| ------------------------------ | ------------------------------------------------------------------- |
| `isDeliverableLifecycleStatus` | 类型守卫                                                            |
| `canTransitionDeliverable`     | 判「能不能转」，**自身到自身允许**                                  |
| `nextDeliverableStatuses`      | 给「下一步能去哪」                                                  |
| `deliverableStatusLabel`       | 中文标签（已规划/起草中/待审核/已批准/已渲染/已交付/已沉淀/已阻塞） |

**`canTransitionDeliverable` 允许自身到自身**（identity）——这是幂等写入的基础（重复写同一个状态不算错）。

### `derive.ts`：从文本推属性

`derive.ts` 是「不用模型、纯靠文本推」的那一层。十个函数：

| 函数                      | 推什么             |
| ------------------------- | ------------------ |
| `classifyDeliverableKind` | 交付物类型（七种） |
| `classifyAudience`        | 受众               |
| `deriveDeliverableStatus` | 交付物状态         |
| `deriveMatterStatus`      | 案件状态           |
| `deriveStrategyStatus`    | 策略状态           |
| `deriveMatterTitle`       | 案件标题           |
| `deriveMatterSensitivity` | 敏感级             |
| `deriveNextActions`       | 下一步             |
| `queuePriorityFromRisk`   | 待办优先级         |

`classifyDeliverableKind` 的判据是**一串 `includes`**（不是正则）：

```text
"contract"                     → contract-review
"demand" / "律师函"            → demand-letter
"litigation" / "诉讼"          → litigation-outline
"brief" / output === "pptx"    → client-brief
"timeline" / "时间线"          → evidence-timeline
"memo" / "意见"                → legal-memo
兜底                            → general-document
```

**`deriveMatterSensitivity` 的规则很简单**：风险笔记 ≥3 条就是 `high`，否则 `normal`。

**`queuePriorityFromRisk`**：高风险 → `critical`，中 → `high`，其他 → `normal`。

**`needsEvidenceFollowup`** 用一条正则：

```text
/(待补充|待确认|缺失|补充|核对|证据)/.test(text)
```

**这七个词是「这份材料里还有坑」的信号**。

**注意 `derive.ts` 和 `engine/role-helpers.ts` 是两套分类**（第 53.10 节提过）：一套吃文本，一套吃 `TaskIntent`，逻辑几乎一样。**改一处要看另一处。**

### `practice-personas.ts`：七个业务领域

它把「界面上选的业务领域」映射到「助手岗位预设」与「推荐工作流」：

| id              | 标签       | 岗位预设              | 推荐工作流                                                               |
| --------------- | ---------- | --------------------- | ------------------------------------------------------------------------ |
| `litigation`    | 诉讼与争议 | `general_litigation`  | demand-letter / matter-chronology / evidence-index                       |
| `commercial`    | 商事合同   | `contract_review`     | contract-review / nda-triage / vendor-agreement-review / renewal-monitor |
| `compliance`    | 合规研究   | `compliance_research` | compliance-research-memo / office-research-report / training-ppt         |
| `client`        | 客户沟通   | `client_memo`         | （见源码）                                                               |
| `due_diligence` | 尽职调查   | `due_diligence`       | —                                                                        |
| `ip`            | 知识产权   | `contract_review`     | —                                                                        |
| `tax`           | 税务       | `compliance_research` | —                                                                        |

**注意 `ip` 映射到 `contract_review`**，而 `tax` 映射到 `compliance_research`——**没有独立的 IP 与税务岗位**，所以借用了最近的。

`suggestedWorkflowIds` 那列是「选了这个领域之后，界面上推荐哪几个工作流模板」。所以它是**界面引导数据**，不是运行时判定。

### `role.ts`：六个岗位

第 16.1 节详细讲过。这里补一个实现细节：

```ts
const BUILT_IN_ROLES = ASSISTANT_PRESETS.map(presetToRole);
```

**角色不是硬编码的六个对象，而是从岗位预设映射出来的**。所以改岗位预设会连带改角色。

## 59.2 任务、检查点与执行计划（`tasks/`）

### `TaskRecord` 与那个上限

`tasks/index.ts` 导出九个函数，其中一个常量：

```ts
MAX_AGENT_INSTRUCTION_SUMMARY_CHARS = 4000;
```

**为什么单独一个常量**：因为指令可能很长（粘一大段材料），而任务记录里只该存摘要。4000 字是一个「够表达但不能当材料仓库」的量。

九个函数里有两个是「派生 id」相关的：

| 函数                          | 作用               |
| ----------------------------- | ------------------ |
| `deriveInstructionTitle`      | 从指令推标题       |
| `persistAgentInstructionTask` | 把一次指令落成任务 |

还有 `syncDraftToTaskRecord`——**草稿状态同步回任务**（第 53.6 节第 ⑨ 步用它）。

### 检查点是「派生」的

`tasks/checkpoints.ts` 只导出 `listTaskCheckpoints`，注释说明了一个设计选择：**检查点不额外存储，而是从任务与草稿推导出来**。

也就是：**没有 `checkpoints.json`**。这样不会出现「任务状态和检查点列表不一致」。

### 执行计划：业务语义的步骤

`tasks/execution-plan.ts` 导出三个：

| 导出                                  | 作用             |
| ------------------------------------- | ---------------- |
| `buildInitialExecutionPlan`           | 从意图建初始计划 |
| `buildInitialExecutionPlanFromRecord` | 从任务记录建     |
| `deriveExecutionPlanSteps`            | 推导步骤         |

**「business-semantic execution steps」**（第 7 章提过）：它不是技术步骤（「调用工具 A」），而是业务步骤（「检索依据」「起草」「审核」）。所以它能在界面上显示给律师看。

### 状态标签单独一个文件

`status-label.ts` 两个函数（`resolveTaskStatusLabel`、`taskRecordStatusLabel`）——**因为状态到中文的映射要被多处用**，而且它受文案 lint 管（第 32 章）。

## 59.3 工作记录：一个「旁挂」的模型（`work/`）

`work/` 是第五期加的东西，它的定位在类型注释里写得很清楚：

```text
LawyerWork — sidecar work-record model next to sessions/tasks
(does not replace session.json), with goals and lexical search.
```

**「does not replace session.json」**——它是一个**覆盖层**，不是替代。

### 六种状态

```ts
LawyerWorkStatus = "open" | "running" | "needs_signoff" | "needs_lawyer" | "done" | "rejected";
```

其中 `needs_lawyer` 有一条专门的注释：

```text
/** 门禁把本件停下（如独立审稿轮次用尽）：等律师处置后才继续。 */
```

**这个状态对应第 17.1 节那次真实事故**（门禁停下但律师看不到）。加这个状态就是为了让「等律师处置」这件事在「在办」里可见。

### 五种来源

```ts
LawyerWorkSource = "chat" | "mail" | "file" | "compare" | "automation";
```

**五个来源对应五个入口**：对话、邮件、文件页、对比、自动办件。

### 十个字段

`LawyerWork` 的字段：`workId`、`title`、`goal`、`status`、`sessionId?`、`taskId?`、`draftId?`、`matterId?`、`capabilityId?`、`source`、`createdAt`、`updatedAt`。

**`capabilityId` 的注释**：

```text
/** 办件流程锁，供「存成自动办件」复用同一能力。 */
```

也就是说：**从一件活变成自动办件时，能力 id 会跟过去**——所以「以后每周这样来一次」会用同一个能力定义。

### `goal.ts`：一个「排队等应用」的目标

`goal.ts` 导出十个函数，都是围绕「律师说了一句目标，但当前回合不该改流程」这件事：

```text
pendingWorkGoalPath → queueWorkGoal → claimPendingWorkGoal → applyClaimedWorkGoalToHistory
```

**和第 43 章那三个侧车注入通道（steer / inject / followup）是同一个模式**：排队 → claim → 并入历史。

而 `ensureLawyerWorkForTurn` 是回合开始时调的那个（第 3.5 节第 ⑤ 步）。

### `store.ts`：十三个函数

`store.ts` 是这一层的主体。它的函数可以分为四组：

| 组   | 函数                                                                                         |
| ---- | -------------------------------------------------------------------------------------------- |
| 路径 | `worksDir`、`workRecordPath`、`workEventsPath`                                               |
| 读写 | `readLawyerWork`、`listLawyerWorks`、`findLawyerWork`、`writeLawyerWork`、`createLawyerWork` |
| 更新 | `mergeWorkStatus`、`markWorkNeedsLawyer`、`upsertLawyerWork`、`upsertLawyerWorkFromPersist`  |
| 事件 | `appendWorkEvent`                                                                            |

**`mergeWorkStatus` 单独存在**说明状态合并有规则（不是直接覆盖）——否则一个「已完成」的活不该被后来的「running」冲掉。

**`markWorkNeedsLawyer`** 就是设 `needs_lawyer` 那个状态的入口。

### `search.ts`：词法搜索，不扫审计

`searchLawyerWorks` 是**词法搜索**。注释（来自文件头）说明了它的边界：**does not scan audit logs**。

**为什么**：工作记录是「一件事的索引」，审计是「发生过什么」。用审计来做搜索会慢且不准。

## 59.4 洞察链：从行为到路线图（`insights/`）

`insights/` 是第五期那套「产品内省仪器」。四个纯函数构成一条链：

```text
computeBehaviorSummary        ← 律师动作 → 案件层面的行为特征
   ↓
computeConvergenceHints       ← 行为特征 → 「下一步该去哪」的建议
   ↓
computeProductExperiments     ← 改造方向 → 可验证的实验项
   ↓
computeRoadmapCards           ← 跨案件积累 → 路线图决策卡
```

**四个都是纯函数**（第 7 章提过：桌面 `MatterWorkbench` 里原来有这套逻辑，后来抽出来）。纯函数意味着它们可以在渲染层直接跑，不需要 fs。

### 数据从哪来

入口是 `InteractionEvent`（`insights/types.ts`）：桌面把关键动作通过 `POST /api/matters/interaction` 上报，走**已有审计体系**（事件类型 `ui.matter_action`）。

**「复用审计而不另建埋点」**是第 7 章讲过的设计意图：一件事既可用于产品观察，也可进案件时间线。

### 版本门禁

`edition.features.crossMatterRoadmap` 在 solo、firm、private_deploy 都是开的。

**所以 solo 版看不到这些卡**——不是漏了，是功能门禁。

### 三个「会话级」诊断

`insights/` 里还有三个跟洞察链无关的东西：

| 文件                           | 作用                                                                     |
| ------------------------------ | ------------------------------------------------------------------------ |
| `session-health.ts`            | `buildWorkspaceSessionHealth` → 会话健康信号报告                         |
| `session-timeline.ts`          | `buildMatterSessionTimeline` / `buildMatterUnifiedTimeline` → 案件时间线 |
| `session-history-integrity.ts` | `scanSessionHistoryIntegrity` + `repairSessionHistoryIntegrity`          |

**第三个是 `pnpm lawmind:doctor --fix` 的实现**（第 31.6 节讲过）。它有一个扫描上限常量 `SESSION_INTEGRITY_SCAN_LIMIT`——**扫描是有限的**，不会遍历所有历史会话。

## 59.5 黄金旅程（`product/`）

`product/golden-journeys.ts` 只有三个旅程（`LawMindGoldenJourneyId`）：

```text
matter-production-flow        案件生产流
contract-review-trust-flow    合同审查信任流
role-delegation-memory-flow   角色委派记忆流
```

**它们是「冻结的验收旅程」**（第十一期的产物）：把三条最关键的路径写成固定步骤。

`buildGoldenJourneysMarkdown` 能把它们渲染成 Markdown——**所以它们是可导出的验收文档**，不是只存在于代码里的枚举。

**这个设计的价值**：新功能加进来时，先看它有没有破坏这三条旅程。

## 59.6 引用显示（`sources/`）

`sources/` 只有两个文件，但它是「引用怎么给律师看」的唯一实现。

### 六个函数

| 函数                                                     | 作用                        |
| -------------------------------------------------------- | --------------------------- |
| `formatLawyerFacingCitation`                             | 把来源格式化成律师看的引用  |
| `looksLikeOpaqueSourceId`                                | 判「这看起来是不是内部 id」 |
| `sourceKindLabelZh`                                      | 来源类型的中文标签          |
| `citationFootnoteMarker`                                 | 脚注标记                    |
| `formatSectionSeeAlsoParts` / `formatSectionSeeAlsoLine` | 「参见」行                  |

**`looksLikeOpaqueSourceId` 是个很实用的守卫**：`src-1`、`url-3-abc123` 这类内部 id 不该出现在律师面前。所以有一个专门的函数来识别它们——**识别出来才能替换掉**。

`CitationDisplaySource` 是这套函数吃的输入类型（第 57.6 节讲过 Word 渲染会用它把引用渲染成「参见」）。

### 来源批注

`source-annotation.ts` 管「律师对某条来源的批注」：

```text
SOURCE_ANNOTATION_KINDS → 批注种类
createSourceAnnotation / listSourceAnnotations
```

**它是「律师对来源的旁注」**，和记忆采纳里的 `source.annotation` 是同一个东西（第 6 章那个 kind）。

## 59.7 行差异（`text/`）

`text/line-diff.ts` 只有三个导出：`diffLines`、`DiffHunk`、`LineDiffResult`。

**头部注释没写，但类型名 `DiffHunkType` 说明它是行级的 diff。**

**它的用途**（从调用方推）：记忆预览、审计预览里的「改了什么」展示。**不依赖第三方 diff 库**——所以是一个自己实现的小工具。

**为什么要自己写**：这类 diff 只服务「给人看的变化展示」，不需要精确的算法（不需要最小编辑距离）。**一个简单的 LCS 就够**，还省一个依赖。

## 59.8 首跑状态（`onboarding/`）

`onboarding/firstrun-state.ts` 管工作区里两份首跑标记。写入都是先写临时文件再改名。

```text
<workspace>/.lawmind/firstrun-acceptance-pending.json   { matterId }
<workspace>/.lawmind/firstrun-dismissed.json            { dismissedAt }
```

| 函数                               | 作用                                                                            |
| ---------------------------------- | ------------------------------------------------------------------------------- |
| `firstrunAcceptancePendingPath`    | 待验收标记路径                                                                  |
| `readFirstrunAcceptancePending`    | 读（坏 JSON 返回 null）                                                         |
| `setFirstrunAcceptancePending`     | 原子写                                                                          |
| `clearFirstrunAcceptancePending`   | 删（文件不存在也算成功）                                                        |
| `firstrunDismissedPath`            | 「不再自动打开」路径                                                            |
| `readFirstrunDismissed`            | 读关闭标记（坏 JSON 返回 null）                                                 |
| `setFirstrunDismissed`             | 原子写关闭标记                                                                  |
| `recordFirstrunWizardCompleted`    | 先原子写待验收标记，再记审计 `ui.firstrun_wizard_completed`。审计失败时标记仍在 |
| `maybeEmitFirstrunAcceptanceReady` | 记审计 `ui.firstrun_acceptance_ready`                                           |

**两个审计事件**分别对应「向导走完了」和「验收就绪了」——所以首跑漏斗有两段可测。

**「未完成的标记」是个文件而不是内存状态**：这样进程重启后还能知道「这个人首跑还没验收」。

## 59.9 多任务可观测（`ops/`）

`ops/multitask-observability.ts` 只导出两个函数加两个类型，但它产出的报告有七项指标：

| 指标                              | 说明                 |
| --------------------------------- | -------------------- |
| `leadTimeP50Ms` / `leadTimeP90Ms` | 交付时长中位数与 P90 |
| `retryRate`                       | 重试率               |
| `cancelRate`                      | 取消率               |
| `failureRate`                     | 失败率               |
| `conflictRate`                    | 冲突率               |
| `firstPassRate`                   | 一次通过率           |

报告里还带 `sample` 段：`jobsTotal`、`jobsInWindow`、`collaborationEvents`、`malformedEventLines`。

**`malformedEventLines` 单独统计**——因为协作事件是 JSONL 追加的（第 57.3 节讲过坏行会被跳过），**能坏多少行是个健康信号**。

它还会读 `validationDistDir` 下的验证报告（`report-*.json`），判据是：

```text
summary.requiredFailed === 0 && summary.releaseReady === true
```

**报告的类型标识是 `reportType: "multitask-observability"`**——所以多种报告能混在一个目录里而不混淆。

## 59.10 CLI 审核门（`review/`）

`review/cli.ts` 是 `src/lawmind/review/` 里**唯一**的文件（第 1.17 节提过这个「单文件目录」）。它的头部注释说明了目的：

```text
第一版目标：在终端里人工确认草稿是否通过，阻断未审核直接渲染。
```

`reviewDraftInCli` 的返回是二选一：

```ts
{ ok: true, draft } | { ok: false, reason: "rejected" | "aborted" }
```

**两种失败原因是分开的**：「被驳回」和「用户取消」不是一回事。

它问两个问题：

```text
是否通过该草稿？(y/n):
审核人标识(默认 lawyer:cli):
```

**默认审核人是 `lawyer:cli`**，并写到 `draft.reviewedBy` / `draft.reviewedAt`。

还有一条注释说明了它的边界：

```text
CLI 只回传「通过 + 审核人」意图，不直接改写 reviewStatus——由调用方走 engine.review 落戳。
```

**「不改写状态，只回传意图」**：这样权限与状态写入仍然集中在 `engine/reviewing.ts`（第 53.6 节）那一处。

## 59.11 审查专案组：角色与权重

第 9.7 节讲过机制。这里补实现细节。

### 五角色与权重

`STANDARD_CONTRACT_REVIEW`（id `standard-contract-review`）：

| 角色 id               | 标签       | 权重    | 超时   | 工具白名单                        |
| --------------------- | ---------- | ------- | ------ | --------------------------------- |
| `clause`              | 条款结构   | 0.2     | 120000 | `draft_document`、`update_draft`  |
| `risk`                | 风险与责任 | **0.3** | 120000 | `draft_document`、`research_task` |
| `compliance`          | 合规       | 0.15    | 90000  | `research_task`                   |
| `obligation_timeline` | 义务时间线 | 0.15    | 90000  | `draft_document`                  |
| `citation_check`      | 引用核验   | 0.2     | 90000  | `research_task`                   |

**权重和是 1.0**（0.2+0.3+0.15+0.15+0.2）。`risk` 占 0.3 最高——**风险与责任是这个专案组最看重的一环**。

只有 `clause` 的工具白名单里有 `update_draft`。`risk` 是 `draft_document` 加 `research_task`。其余角色只检索或起草。

### 角色到工作区岗位的映射

`PLAYBOOK_ROLE_TO_WORKSPACE_ROLE`：

| 专案组角色            | 工作区岗位            |
| --------------------- | --------------------- |
| `clause`              | `contract_review`     |
| `risk`                | `contract_review`     |
| `compliance`          | `compliance_research` |
| `obligation_timeline` | `contract_review`     |
| `citation_check`      | `general_default`     |

**三个角色共用 `contract_review`**——所以绑定助手时会拿到同一个人（`candidates[0]`）。

### 三个存储位置

```text
workspace/matters/<matterId>/campaigns/<campaignId>.json      ← 案件内
workspace/lawmind/campaigns/<campaignId>.json                 ← 无案件
workspace/lawmind/fleet-playbooks/*.json                      ← 自定义模板
```

`campaignId` 格式是 `campaign_<16位hex>`（去掉连字符的 uuid）。

**`sourceText` 截到 20 万字符**——这是「专案组能吃多长的合同」的上限。

### 审查口径会随稿带走

`review-brief.ts` 处理「律师已经说过的口径，别再问一遍」。它抽三种：

| 字段                 | 正则                                                        |
| -------------------- | ----------------------------------------------------------- |
| `focus`（审查重点）  | `/…[-\s]*审查重点[:：]\s*(.+)/`，其中省略号是「行首或换行」 |
| `stance`（己方立场） | `/…[-\s]*己方立场[:：]\s*(.+)/`                             |
| `depth`（审查深度）  | `/…[-\s]*审查深度[:：]\s*(.+)/`                             |

还有一条「打包形式」的正则：

```text
/【审查口径】立场[:：]([^；\n]+)(?:；重点[:：]([^；\n]+))?(?:；深度[:：]([^\n]+))?/
```

深度只认三种前缀：`快速` / `标准` / `深度`。

**`mergeSourceTextWithBrief`** 把口径拼进源文本，**`appendCampaignUpgradeInstruction`** 在「升专案组」时追加一句：

```text
【律师指示】请按完整合同审查专案组（标准五角色）执行，勿走轻量路径。
```

**「勿走轻量路径」**——这是从轻量审查升到专案组时的显式指令。

## 59.12 案件审查矩阵（`matter/`）

第 9.8 节讲过机制。这里补两个实现细节。

### 七个默认问题与关键词

| id            | 问题           | 关键词数                   |
| ------------- | -------------- | -------------------------- |
| `q-parties`   | 当事人与主体   | 9                          |
| `q-term`      | 核心商业条款   | 7                          |
| `q-risk`      | 风险与责任     | 6                          |
| `q-ip`        | 知识产权       | 5                          |
| `q-terminate` | 解除与终止     | 4                          |
| `q-governing` | 争议解决       | 5                          |
| `q-misc`      | 其他需律师确认 | **0**（无关键词 → 永远空） |

**`q-misc` 没有关键词是刻意的**：它是「请直接批注」那一列，不该由系统填。

### 对比函数的三条判据

`compareMatrixExcerpts(before, after)` 返回 `{ changed, danger, summary }`：

| 情况                                 | summary                      |
| ------------------------------------ | ---------------------------- |
| 完全一样                             | `无变化`                     |
| `after` 里出现危险词而 `before` 没有 | `危险变更：出现高风险表述`   |
| 其他变化                             | `条款内容有变化，请人工核对` |

危险词只有六个：

```text
无限责任|全部损失|放弃|不可撤销|单方解除|自动续期
```

**这六个词都是「一旦出现就该看」的条款类型**。数量少但选得准——**多了会天天报警，报多了就没人看**。

## 59.13 Matter Ops：三份文件（`matter-ops/`）

`matter-ops/` 只有三个文件，存四个文件在 `matters/<id>/ops/`：

| 文件               | 内容                |
| ------------------ | ------------------- |
| `scope.json`       | 范围基线 + 变更记录 |
| `plan.json`        | 阶段 + 里程碑       |
| `raid.jsonl`       | 风险/假设/问题/决策 |
| `theory-lite.json` | 争点/依据/待决      |

### 类型里的两个上限

| 项           | 上限                      |
| ------------ | ------------------------- |
| 范围变更记录 | **最近 20 条**            |
| RAID 读取    | 最近 40 条 → 倒序取 12 条 |

而 `MatterOpsSummary` 里有一个便利字段：

```text
nextMilestone: { id, title, dueAt? } | null
```

**「下一个里程碑」是算出来的**——界面不用自己找。

### `matterTheoryBlocksStrictExport`

这个函数的语义（从名字与调用点）：

```text
理论没锚定 → 严格模式下阻止导出
```

**它就是第 53.7 节第 ③ 步那个门禁的实现**，拦下时 detail 是 `theory_anchor_missing`。

### 那个已知问题

`matter-ops/storage.ts` 用 `withExclusiveFileLock` 加 `writeJsonAtomic`，写入前做 zod `parse`。它不是裸 `writeFileSync`。

## 59.14 助手档案（`assistants/`）

`assistants/` 六个文件。第 6.12 节讲过机制，这里补几处实现。

### `AssistantProfile` 的字段

```text
assistantId  displayName  introduction  jobBrief?
presetKey?   roleId?      customRoleTitle?  customRoleInstructions?
orgRole?     reportsToAssistantId?  peerReviewDefaultAssistantId?
createdAt    updatedAt
```

**七个「可选」字段**说明这个对象是渐进长出来的。

### 五段岗位说明书

`jobBrief` 的五段有固定顺序与标签（`ASSISTANT_JOB_BRIEF_FIELDS` / `ASSISTANT_JOB_BRIEF_LABELS`）：

| 字段             | 标签               |
| ---------------- | ------------------ |
| `responsibility` | 长期负责           |
| `sources`        | 材料从哪来         |
| `deliverables`   | 交付什么算办完     |
| `prohibitions`   | 绝对不做/必须先问  |
| `escalation`     | 什么情况停下来问我 |

**这五个标签本身就是一份「怎么写岗位说明」的模板**：负责什么、材料从哪来、什么算完成、什么绝对不做、什么情况上报。

缺省行为：**全空时 `normalizeAssistantJobBrief` 返回 `undefined`**（不存一个空对象）。

### 三道组织校验

`validateAssistantOrgLinks` 检查三条，错误文案是中文：

```text
汇报对象不能是当前智能体自己
汇报对象智能体不存在，请先创建或刷新列表
互审默认对象不能是当前智能体自己
互审默认对象智能体不存在
```

**注意文案里用的是「智能体」**——这是个术语表禁词（第 32 章）。这几句是给**开发者/界面校验**看的错误串，不是给律师的最终文案。**如果它直接显示到界面上，就是一处文案遗留。**

### 三个组织角色

```ts
AssistantOrgRole = "lead" | "member" | "intern";
```

中文标签：`lead → 主办`、`member → 协办`、`intern → 实习/辅助`。

### 复制助手不复制什么

`duplicateAssistant` 的注释写明了：

```text
copies role/org but not memory/stats
```

**拷贝角色与组织关系，但不拷记忆与统计**。理由（第 6.12 节）：复制性格可以，复制经历没意义。

### 名字去重与删除保护

`uniqueAssistantDisplayName`：基名后加空格与序号（基名 2、基名 3……），最多到 999。

`deleteAssistant` **拒绝删 `default`**（`DEFAULT_ASSISTANT_ID`）。

### 工作量统计

`loadAssistantStats` / `saveAssistantStats` / `bumpAssistantStats` 管 `assistant-stats.json`。

**「bump」这个动词说明它是累积计数器**（不是覆盖）。所以它能回答「这个助手一共干过多少活」。

### 三层档案路径

```text
resolveLawMindRoot(workspaceDir, envFile?) = dirname(envFile) || <workspace>/..
assistants.json / assistant-stats.json    ← 在应用根
assistants/<id>/PROFILE.md                ← 在应用根下的子目录
```

**助手档案在应用根，不在工作区**——所以它跨工作区共享（第 2.3 节提过）。

`assistantProfilePath` 对非法 id 会抛 `"invalid assistant id"`（判据是 id 含 `.`、`/`、`\`）。

## 59.15 离线许可（`license/`）

第 15.7 节详细讲过机制。这里补一点实现观察：

`license/` 的文件分工是：

| 文件        | 管什么                                |
| ----------- | ------------------------------------- |
| `keys.ts`   | 公钥常量                              |
| `verify.ts` | 激活码验签                            |
| `store.ts`  | 状态读写（`~/.lawmind/license.json`） |
| `types.ts`  | 类型                                  |
| `index.ts`  | barrel                                |

**`keys.ts` 里那个公钥是唯一的信任根**，而且是硬编码的（注释说明发版前要换）。**所以「换发行方」意味着改这个常量并重新发版。**

## 59.16 免责声明（`legal/`）

`legal/` 只有一个文件 `attorney-disclaimer.ts`，导出两个常量：

```text
LAWMIND_ATTORNEY_DISCLAIMER_SHORT              ← 界面用
LAWMIND_ATTORNEY_DISCLAIMER_EXPORT_FOOTER      ← 导出文件用
```

**两个常量而不是一个**，因为「界面上的一句话」和「导出文件的脚注」长度要求不同。

## 59.17 案件云服务（`matter-cloud/`）

第 16.9 节讲过机制。这里补端点与能力的对照表（这是「谁能干什么」的权威）。

| 端点                                 | 方法 | 需要的能力                                            |
| ------------------------------------ | ---- | ----------------------------------------------------- |
| `/v1/health`                         | GET  | **无**（唯一免鉴权的）                                |
| `/v1/enroll`                         | POST | **无**（注册账号、领令牌；入云第一步）                |
| `/v1/invites/join`                   | POST | **无**（凭邀请码换自己的令牌并加入案子）              |
| `/v1/me`                             | GET  | 已认证                                                |
| `/v1/invites/redeem`                 | POST | 已认证                                                |
| `/v1/matters/:id/membership`         | GET  | 成员（`external` 除外）                               |
| `/v1/matters/:id/membership`         | PUT  | `manage_members`                                      |
| `/v1/matters/:id/invites`            | POST | `invite`                                              |
| `/v1/matters/:id/invites/revoke`     | POST | `invite`                                              |
| `/v1/matters/:id/ops`                | GET  | 成员                                                  |
| `/v1/matters/:id/ops`                | PUT  | `edit_matter_records`                                 |
| `/v1/matters/:id/materials/manifest` | GET  | 成员                                                  |
| `/v1/matters/:id/materials/manifest` | PUT  | `upload_materials`（**墓碑还要 `delete_materials`**） |
| `/v1/matters/:id/blobs/:sha256`      | GET  | 成员                                                  |
| `/v1/matters/:id/blobs/:sha256`      | PUT  | `upload_materials`                                    |

**两处细节**：

1. **`membership` 的 GET 排除 `external`**——外协看不到完整名册。
2. **删材料的墓碑需要单独的能力**（`delete_materials`）——**删比传更敏感**。

### 三个实现常量

| 常量             | 值                         |
| ---------------- | -------------------------- |
| `MAX_JSON_BYTES` | 16 MiB                     |
| `MAX_BLOB_BYTES` | 64 MiB                     |
| `SAFE_ID`        | `/^[a-zA-Z0-9_-]{1,128}$/` |

**blob 上限（64MB）比 JSON 上限（16MB）大**——材料文件本来就大。

### 服务端的哈希分流

第 16.9 节讲过那条注释。这里补实现：上传 blob 时

```text
是封套（sealed envelope）→ 不重算哈希
不是封套 → 重算并比对，不符 400
```

**「按是否封套分流」**——这是 E2EE 与完整性校验的必然折中。

### 十四个错误码

服务端的错误码我列一下，因为它们是排查的关键：

```text
not_a_matter_member  role_cannot_read  role_lacks_capability  unauthorized
no_membership  members_required  op_matter_mismatch  blob_hash_mismatch
blob_too_large  bad_blob_path  blob_not_found  method_not_allowed
invalid_json  not_found
```

**`op_matter_mismatch` 这条很实用**：上传的操作里带的 matterId 和路径上的不一致时拒——防串案。

### 桌面侧的两个文件

| 文件                | 干什么                                                                                                                                                                                          |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cloud-link.ts`     | 本机云连接存根：`lawmind/cloud-link.json`（权限 0600），只存 endpoint + token。策略文件拒收这两样（`matterReplica.cloudToken` / `endpoint` / `cloudDataDir` 写进 `lawmind.policy.json` 会被拒） |
| `desktop-bridge.ts` | 桌面与云之间的桥：配了云之后邀请以云为权威（桌面不再自造邀请码）；`redeemInvite` 成功后写本地名册 + 记 `invite.accept` op + 发布成员公钥                                                        |

## 59.18 三个全局契约文件

这三个文件很小，但它们是全仓的「开关」与「常量」。

### `build-channel.ts`：商业版隔离

```text
LAWMIND_BUILD_CHANNEL = oss | commercial（默认 oss）
```

三个函数：`getBuildChannel`、`isCommercialBuild`、`isPlatformAuthorityProxyEnabled`。

第三条的逻辑是**两级门**：

```text
必须先是 commercial，然后 LAWMIND_PLATFORM_AUTHORITY_PROXY 是 1/true/yes
```

注释写明了默认行为的意图：

```text
Default: oss — commercial BFF / platform proxy must not activate.
```

**「开源构建里商业代理绝不能激活」**——这是隔离的硬要求。

**它和 Edition 的区别**（第 1.14 节）：Edition 是运行期功能表。build-channel 在模块加载时从 `LAWMIND_BUILD_CHANNEL` 盖章；进程起来之后改环境变量，或在 `lawmind.policy.json` 里写 `buildChannel`，都不会把 oss 进程切到商业代理。未知值和 Edition 的 id 都按 oss。

### `engine-actor.ts`：默认操作者

只有四行代码，但解决一个「审计归属」问题：

```text
LAWMIND_ENGINE_ACTOR_ID → LAWMIND_DESKTOP_ACTOR_ID → "lawyer:system"
```

**注释说明了它的用途**：

```text
Default human actor id for M1 engine paths when callers omit `actorId`
(CLI, scripts, tests). Aligns with desktop when LAWMIND_DESKTOP_ACTOR_ID is set.
```

也就是：**CLI 跑的时候没有「律师身份」，所以给一个默认值**。而有桌面环境变量时跟随它——这样审计里能对上同一个人。

### `review-labels.ts`：十四个标签与历史兼容

十四个审核标签（顺序即 UI 展示顺序）：

```text
语气过强  语气过弱  引用不完整  引用有误
争点遗漏  争点过度论证  事实顺序不当  事实不准确
风险偏高  风险偏低  风险未标注  受众定位不当
模板不匹配  质量范例
```

**分组看很清楚**：语气 2、引用 2、争点 2、事实 2、风险 3、受众 1、模板 1、范例 1。

而且它有一张**历史兼容表** `REVIEW_LABEL_LEGACY_ENGLISH`，把旧版英文标识映射到中文：

```text
tone.too_strong     → 语气过强
tone.too_weak       → 语气过弱
citation.incomplete → 引用不完整
citation.incorrect  → 引用有误
issue.missing       → 争点遗漏
issue.over_argued   → 争点过度论证
```

注释说明了原因：

```text
旧版英文标识 → 当前中文枚举（解析请求体时兼容历史数据与脚本）
```

**所以「中文化」这件事没有粗暴地破坏兼容**——老的请求体、老的脚本仍然能用。

## 59.19 `index.ts` 与 `types.ts`：两个 barrel 的分工

### `src/lawmind/index.ts`

它是引擎的**总导出面**（约 360 行）。我按类别列一下它导出什么，因为它就是「引擎对外承诺了什么」的清单：

| 类别         | 代表导出                                                                               |
| ------------ | -------------------------------------------------------------------------------------- |
| 引擎工厂     | `createLawMindEngine`、`LawMindEngine`、`LawMindEngineConfig`                          |
| 核心域类型   | `ArtifactDraft`、`MatterIndex`、`MatterOverview`、`LegalReasoningGraph`                |
| 路由         | `route`、`routeAsync`                                                                  |
| 案件         | `buildMatterIndex`、`createMatterIfAbsent`、`listMatterOverviews`、`searchMatterIndex` |
| 记忆         | `loadMemoryContext`、`ensureCaseWorkspace`、`appendLawyerProfileLearning`              |
| 检索         | `createWorkspaceAdapter`、`createAuthorityAdapterFromEnv`、`createLegalModelAdapter`   |
| 审计         | `readAllAuditLogs`、`buildAuditExportMarkdown`、`buildComplianceAuditMarkdown`         |
| 任务         | `listTaskRecords`、`persistAgentInstructionTask`、`deriveExecutionPlanSteps`           |
| 草稿         | `listDrafts`、`readDraft`、`resolveDraftCitationIntegrity`                             |
| 模板         | `listBuiltInTemplates`、`registerUploadedTemplate`、`resolveTemplateForDraft`          |
| 技能包       | `parseLawMindBundleManifest`、`verifyLawMindBundleManifest`                            |
| Agent        | `createLawMindAgent`、`LawMindAgent`                                                   |
| 推理         | `buildDraft`、`buildDraftAsync`、`buildLegalReasoningGraph`                            |
| 评测         | `runBenchmarks`、`BUILTIN_BENCHMARK_TASKS`、`release-readiness` 相关                   |
| 策略与版本   | `EDITION_FEATURES`、`isFeatureEnabled`、`resolveEdition`                               |
| 交付与学习   | `buildAcceptancePackMarkdown`、`finalizeContractRevisionPack`                          |
| 读模型与队列 | `getMatterReadModel`、`listApprovalRequests`、`listWorkQueueItems`                     |
| 交付物规格   | `BUILT_IN_DELIVERABLE_SPECS`、`getDeliverableSpec`、`validateDraftAgainstSpec`         |

**这是一份很长的清单**——它也是「这个 barrel 为什么这么长」的原因：向后兼容。

**关键提醒**（第 34.11 节讲过）：**它不等于引擎的全部能力**。很多能力（桌面端新功能、`reasoning/` 里那些不在 barrel 的文件、`host-access/` 全部）都不从这里出。找功能要看目录树。

### `src/lawmind/types.ts`

它放**跨模块共用的域类型**，比如 `ArtifactDraft`、`TaskIntent`、`MatterIndex`、`ResearchBundle`、`LegalReasoningGraph`（第 54.4 节讲的四张图）。

**它和 `core/contracts.ts` 的分工**：

| 文件                | 放什么                                               |
| ------------------- | ---------------------------------------------------- |
| `types.ts`          | 引擎内部流转的中间对象（草稿、意图、检索包、推理图） |
| `core/contracts.ts` | 面向业务的域对象（案件、交付物、审批、期限、待办）   |

**两者有重叠的地方**（比如都在定义交付物相关类型），这也是历史演进留下的。**改类型之前先确认它定义在哪一个。**

## 59.20 已知坑（本章相关）

- **`Matter` 已含案由、对方当事人和当事人列表。** 落盘仍以 `MatterRecordSchema` 为准。
- **交付物的 `approved` 与 `rendered` 不是终态**（可以重开审核）。这三条转移不能删。
- **`derive.ts` 和 `engine/role-helpers.ts` 是两套分类。**
- **`deriveMatterSensitivity` 的规则是「风险笔记 ≥3 条就是高度敏感」。**
- **`ip` 与 `tax` 没有独立岗位**，借用了合同与合规。
- **角色是从岗位预设映射出来的**，不是硬编码。
- **`MAX_AGENT_INSTRUCTION_SUMMARY_CHARS = 4000`。**
- **检查点是派生的，没有单独存储。**
- **执行计划是业务语义的**（「检索依据」而不是「调用工具」）。
- **`LawyerWork` 是覆盖层，不替代 `session.json`。**
- **`needs_lawyer` 状态是为那次门禁事故加的。**
- **工作记录搜索不扫审计。**
- **洞察链四个函数都是纯函数。** `crossMatterRoadmap` 在 solo 也开着。
- **会话完整性扫描有上限**（`SESSION_INTEGRITY_SCAN_LIMIT`）。
- **`looksLikeOpaqueSourceId` 是「内部 id 不许给律师看」的守卫。**
- **首跑状态是文件不是内存**（进程重启后仍有效）。
- **`malformedEventLines` 是通信健康信号，不是噪音。**
- **CLI 审核只回传意图，不写状态。**
- **专案组只有 `clause` 能 `update_draft`。** `risk` 不能。
- **审查口径随稿带走，深度只认三种前缀。**
- **矩阵的 `q-misc` 永远空**（它是「请直接批注」那一列）。
- **`matter-ops/storage.ts` 走文件锁、原子写和 zod。**
- **助手档案在应用根，跨工作区共享。**
- **`deleteAssistant` 拒绝删 `default`；复制助手不拷记忆与统计。**
- **组织校验的错误文案里有「智能体」（术语表禁词）**，别直接当界面文案用。
- **许可公钥硬编码在 `keys.ts`**，换发行方要改它并重新发版。
- **案件云的「删」比「传」多一道能力。**
- **`build-channel` 在进程启动时盖章，Edition 是运行期功能表。** 见 §1.14。
- **`index.ts` 不等于全部能力**；`types.ts` 与 `core/contracts.ts` 有重叠。
