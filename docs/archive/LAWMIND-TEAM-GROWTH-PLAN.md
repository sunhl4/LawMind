# LawMind「数字团队成长」详细工程计划

> **状态**：详细执行计划（补充 `LAWMIND-OPTIMIZATION-BACKLOG` §1 / P1）  
> **创建**：2026-07-21 · **修订**：2026-07-21（展开为可排期规格）  
> **目标**：从「多助手 + 拍板队列」升级为「律师带一支会分工、会干活、会分方向成长的数字团队」。  
> **原则**：复用现有引擎与桌面模块；学习写回默认进 **pending adoption（律师确认）**，禁止静默污染正式 profile；本地优先与审计不降级。  
> **产品定义（「像人一样学」）**：像被你带过的专员——分岗、记规矩、越改越少返工、成绩单可见；**不是**自主人格或无人值守律所。

---

## 目录

1. [成功画面与验收叙事](#0-成功画面与验收叙事)
2. [能力边界：做什么 / 不做什么](#1-能力边界做什么--不做什么)
3. [分方向成长：产品模型](#2-分方向成长产品模型)
4. [现状基线与缺口](#3-现状基线与缺口)
5. [目标架构（闭环）](#4-目标架构闭环)
6. [数据与 API 规格](#5-数据与-api-规格)
7. [四条能力线（详细工程）](#6-四条能力线详细工程)
8. [分期、排期与依赖](#7-分期排期与依赖)
9. [跨切要求](#8-跨切要求)
10. [度量与内测成功标准](#9-度量与内测成功标准)
11. [演示脚本（Demo）](#10-演示脚本demo)
12. [风险与缓解](#11-风险与缓解)
13. [与 backlog 对齐](#12-与-backlog-对齐)
14. [完成定义（DoD）](#13-完成定义dod)

---

## 0. 成功画面与验收叙事

律师用 LawMind **约三个月**后应感到：

| #   | 感受           | 可演示证据                                                           |
| --- | -------------- | -------------------------------------------------------------------- |
| 1   | **有编制**     | 合同 / 诉讼 / 质控助手职责固定；某类任务默认派给谁，不必每次开会现勾 |
| 2   | **会干活**     | 派活后半自动走「起草 → 互审 → 待我拍板」；卡点进在办，过程可审计     |
| 3   | **分方向进化** | 合同助手越审越稳，诉讼助手另有口径；各自首过↑、改写↓——**数字可见**   |
| 4   | **习惯可教**   | 改语气、补引用、纠风险口径 → 自动出「待教」→ 采纳后同类任务少返工    |
| 5   | **领导视图**   | 在办先看「谁在忙 / 谁卡补充或批准 / 谁最近成长了」，队列是下钻       |

**一句话北极星**：

> 一个超强律师 + LawMind 数字团队 ≈ 过去「超强律师 + 多名专员」；团队会分工、会交接、会按你的反馈分方向进化。

---

## 1. 能力边界：做什么 / 不做什么

### 1.1 第一版必须做好（Wave A–C）

- **按助手实例**写入与读取学习（不是全所共用一个「超级记忆」）。
- **结构化习惯**：语气、引用要求、风险口径、审批偏好等 → Markdown / executable preferences，进 prompt。
- **律师确认闸**：`suggest → adopt | dismiss`；正式 `LAWYER_PROFILE.md` / 助手 `PROFILE.md` 仅经确认写入。
- **可量化成长**：首过通过率、需改写率、近 30 日趋势；设置与在办同口径。
- **默认分工 + 互审闸（可关）**：配置进入流水线，不只是 system prompt 暗示。
- **在办「团队」主隐喻**：按人聚合；队列为滤镜/下钻。

### 1.2 明确不做（避免期望错位）

| 不做                               | 原因                              |
| ---------------------------------- | --------------------------------- |
| 黑盒「风格相似度模型」作第一版门槛 | 难审计、难调试；首过/改写更可解释 |
| 静默改正式 profile                 | 信任与合规风险                    |
| 无人值守全自动律师                 | 与「领导拍板」北极星冲突          |
| 远程 Skill 市场当核心成长路径      | 分化点是律师带教，不是插件超市    |
| 跨 matter 智能抢占负载均衡         | 可后续；第一版只展示 busy         |
| 「懂你今天心情」式隐性默契         | 非法律工作台验收标准              |

### 1.3 「像人一样学」的可交付定义

| 人类专员行为         | LawMind 对应                                | 第一版形态                    |
| -------------------- | ------------------------------------------- | ----------------------------- |
| 记住领导口头规矩     | 律师/助手 profile 条文                      | pending → adopt 后注入 prompt |
| 某类活越做越熟       | per-assistant specialization + 任务偏置路由 | 指标 + 默认派工               |
| 改稿后下次少犯同样错 | 修订 notes → adoption suggest               | 半自动，须确认                |
| 专岗不抢别人活       | roleId / defaults 路由                      | resolveDefaultAssignee        |
| 组内互审再交领导     | peerReviewDefaultAssistantId                | 强制闸（可关）                |
| 周会看谁忙、谁成长   | 在办团队视图                                | groupBy assistant + 成长条    |

---

## 2. 分方向成长：产品模型

### 2.1 三个记忆层（必须分清）

```text
┌─────────────────────────────────────────────────────────┐
│  L0 律师层（全团队共享的「你」）                         │
│  LAWYER_PROFILE / lawyer.profile_learning               │
│  例：引用必须锚定条文；争议解决先看管辖与仲裁条款          │
└───────────────────────────┬─────────────────────────────┘
                            │ 注入所有助手（或按 scope）
┌───────────────────────────▼─────────────────────────────┐
│  L1 助手层（分方向特化——成长的主战场）                   │
│  assistants/<id>/PROFILE + assistant.profile_section    │
│  例：合同助手：供应商 NDA 语气偏强硬；诉讼助手：举证清单  │
└───────────────────────────┬─────────────────────────────┘
                            │ 任务执行时叠加
┌───────────────────────────▼─────────────────────────────┐
│  L2 案件/客户/对手层（情境，不污染全局特化）             │
│  matter / client / opponent notes                       │
└─────────────────────────────────────────────────────────┘
```

**规则**：

- 律师改「所有人都该遵守」的规矩 → 优先 L0。
- 律师改「这个助手下次别这样写」→ L1，且 `targetId = assistantId`。
- 仅本案有效 → L2，禁止写进 L1。
- 不确定时：**默认 L1 pending**，文案标明「建议写入：合同助手」，律师可改 scope 再 adopt。

### 2.2 任务偏置如何产生「不同成长方向」

| 机制                                 | 作用                                                           |
| ------------------------------------ | -------------------------------------------------------------- |
| 默认路由 `kind → roleId/assistantId` | 合同类任务稳定落到合同助手 → 反馈与指标集中到该实例            |
| Role / orgRole                       | prompt 职责边界，减少抢活                                      |
| peer 互审                            | 质控助手累积「挑错」经验；起草助手累积「被改」经验（指标分开） |
| specialization 按 assistantId        | 成绩单天然分轨                                                 |
| 工作流 `assigneeRoleId`              | 多步任务每步写到对的人                                         |

**关键设计决策**：成长方向主要由 **「谁长期做哪类活」+「律师对谁反馈」** 决定，而不是单独训练一个「特化模型」。这与现有本地架构契合，且可审计。

### 2.3 学习触发源（优先级）

| 优先级 | 触发                                    | 产出                           | Wave |
| ------ | --------------------------------------- | ------------------------------ | ---- |
| P0     | 签批 `approved` / `modified` + 修订说明 | L0/L1 pending                  | A    |
| P0     | 审核标签 / 文书台学习勾选（已有）       | 镜像进 adoption                | 已有 |
| P1     | 修订完成 `keyModifications`             | 1–3 条可读建议                 | D    |
| P1     | Compose「沉淀学习」/ compact-distill    | 会话级补充                     | 已有 |
| P2     | 改写幅度 delta（辅助指标）              | quality meta，不直接写 profile | D    |

---

## 3. 现状基线与缺口

| 能力               | 主要落点                                                                                      | 现状                     | 缺口                                              |
| ------------------ | --------------------------------------------------------------------------------------------- | ------------------------ | ------------------------------------------------- |
| 律师 / 助手画像    | `memory/lawyer-profile-learning.ts`、`assistants/profile-md.ts`、`executable-preferences.ts`  | 显式 append；注入 prompt | 改稿路径未默认 suggest                            |
| 统一采纳           | `memory/adoption-service.ts`、`/api/memory/adoption`、`MemoryInspector`                       | suggest → adopt/dismiss  | 在办入口弱；防噪规则不全                          |
| 会话沉淀           | `agent/compact-distill.ts`、Compose「沉淀学习」                                               | 启发式 → pending         | 不能当唯一入口                                    |
| 审核标签           | `learning/apply-review-labels.ts`                                                             | 偏手动                   | 与「改两处即学」未统一                            |
| 特化计数           | `learning/agent-specialization.ts`、`engine/reviewing.ts`                                     | firstPass / rewrite 已有 | 缺 30 日窗口；UI 弱；签批未全打通 product-metrics |
| 产品事件           | `metrics/product-metrics.ts`                                                                  | JSONL 种类已有           | 草稿签批旁路未写全                                |
| Role / peer 元数据 | `assistants/types.ts`：`peerReviewDefaultAssistantId` 等                                      | 多为 prompt 暗示         | **未进硬流水线**                                  |
| 工作流             | `collaboration/builtin-workflow-templates.ts`、`orchestrator/executor.ts`（`assigneeRoleId`） | 可解析角色               | 种子多为单步                                      |
| 委派 / 互审工具    | `tools/coordination/delegate.ts`、`handoff.ts`                                                | 模型发起                 | 非默认路由                                        |
| 审查专案组         | `review-campaign/*`                                                                           | 角色抽象                 | ≠ 工作区助手实例绑定                              |
| 在办 / Fleet       | `platform/build-agent-fleet.ts`、`LawmindAgentFleetPanel`                                     | 队列隐喻为主             | 缺按人聚合主视图                                  |
| 协作时间线         | `LawmindCollaborationDesk`                                                                    | 次级入口                 | 未进领导摘要                                      |

**总判**：记忆与拍板底座够用；缺口是 **闭环（改→学→可见）+ 默认分工 + 团队主视图 + 分轨指标展示**。

---

## 4. 目标架构（闭环）

```text
                    ┌──────────────┐
   任务 kind        │ defaults.json│──► resolveDefaultAssignee
        │           └──────────────┘         │
        ▼                                    ▼
   ┌─────────┐    draft/run     ┌──────────────────┐
   │ Intake  │───────────────►│ 助手 A（起草）     │
   └─────────┘                 └────────┬─────────┘
                                        │ ready_for_review
                                        ▼
                               ┌──────────────────┐
                               │ 助手 B（互审闸）   │  ← peerReviewDefault
                               └────────┬─────────┘
                                        │ 交律师
                                        ▼
                               ┌──────────────────┐
                               │ 在办：待签批/补充  │
                               └────────┬─────────┘
                          approved │    │ modified + notes
                                   ▼    ▼
                    specialization++   suggestMemoryAdoption
                    product-metrics      (L0/L1 pending)
                                   │            │
                                   ▼            ▼
                            成长条 / 团队视图   Memory Inspector
                                               律师 adopt
                                                    │
                                                    ▼
                                            PROFILE 注入下次 turn
```

**信任铁律**：右侧「学」路径在 adopt 之前不得改正式 profile；左侧「指标」可自动累计（只读成绩单）。

---

## 5. 数据与 API 规格

### 5.1 特化存储（扩展，向后兼容）

现有：`workspace/quality/agent-specialization.json`

```ts
// 保持 version: 1 字段；窗口指标由 API 派生，不必立刻升 schema
type AgentSpecializationStats = {
  assistantId: string;
  roleId?: string;
  tasksReviewed: number;
  firstPassApprovals: number;
  materialRewrites: number;
  lastUpdatedAt: string;
};
```

**派生（API 层，不强制改 JSON）**：

- `windowDays=30`：扫描 `product-events.jsonl`（或并行 quality 事件）中带 `assistantId` 的 `first_pass` / `rewrite`，聚合比率。
- 若事件缺 `assistantId`：Wave A 先修写入侧，再依赖窗口 API。

### 5.2 产品指标事件（写入契约）

在 `engine/reviewing.ts` 与 `recordAgentReviewOutcome` **同路径**追加：

```ts
appendProductMetric({
  kind: firstPass ? "first_pass" : "rewrite",
  assistantId,
  roleId?,
  matterId?,
  taskId?,
  at: ISO,
});
```

**验收**：Doctor `productMetricsSummary` 与 specialization 同向变化。

### 5.3 默认路由表

新建（建议）：`workspace/lawmind/routing/defaults.json`（也可落在 firm 配置目录，与现有 workspace 惯例对齐）

```json
{
  "version": 1,
  "forcePeerReview": null,
  "byKind": {
    "contract_review": { "roleId": "contract", "assistantId": null },
    "draft_nda": { "roleId": "contract" },
    "litigation_memo": { "roleId": "litigation" }
  },
  "byDeliverableType": {
    "审查意见": { "roleId": "contract" }
  }
}
```

解析顺序：`assistantId` 显式 > `roleId` → `findAssistantsByRole` 取首选 > shell 当前助手 > 失败 audit + 回退。

API（建议）：

| Method | Path                    | 说明                                                                              |
| ------ | ----------------------- | --------------------------------------------------------------------------------- |
| GET    | `/api/routing/defaults` | 读表                                                                              |
| PUT    | `/api/routing/defaults` | 整表更新（设置页）                                                                |
| POST   | `/api/routing/resolve`  | body: `{ kind, deliverableType?, matterId? }` → `{ assistantId, roleId, source }` |

### 5.4 学习建议载荷（T2）

`suggestMemoryAdoption` 调用约定：

| 字段         | 值                                                       |
| ------------ | -------------------------------------------------------- |
| scope        | `lawyer` \| `assistant`（默认按文案判断；UI 可改）       |
| kind         | `lawyer.profile_learning` \| `assistant.profile_section` |
| targetId     | lawyerId 或 assistantId                                  |
| sourceTaskId | 任务 id                                                  |
| origin       | `lawyer`（来自签批/修订）或 `engine`                     |
| payload      | 律师可读的一条规矩（≤200 字建议）                        |
| note         | 可选：原文修订摘要                                       |

防噪：

- 同 `payload` 规范化后 7 日内不去重重复写入。
- 空 notes 且无标签标签 → **不生成**。
- 每任务最多 N=3 条 pending。

### 5.5 成长 API（T1.2）

| Method | Path                                     | 说明                                                                  |
| ------ | ---------------------------------------- | --------------------------------------------------------------------- |
| GET    | `/api/assistants/growth?windowDays=30`   | 每位助手：累计 + 窗口首过/改写率、tasksReviewed、pendingAdoptionCount |
| GET    | `/api/metrics/team-growth?windowDays=30` | 内测指标表快照（一次过/改写/学习处理/路由命中/互审覆盖 + 相对基线）   |
| POST   | `/api/metrics/team-growth/baseline`      | 冻结当前窗口为基线（`windowDays?`、`note?`）                          |

响应形状（示意）：

```json
{
  "windowDays": 30,
  "assistants": [
    {
      "assistantId": "asst_contract",
      "roleId": "contract",
      "lifetime": { "tasksReviewed": 40, "firstPassRate": 0.62, "rewriteRate": 0.38 },
      "window": { "tasksReviewed": 12, "firstPassRate": 0.75, "rewriteRate": 0.25 },
      "pendingAdoptions": 2,
      "busy": { "state": "awaiting_lawyer", "taskTitle": "…" }
    }
  ]
}
```

也可挂在现有 `GET /api/agent-fleet` 的 `specialization` 扩展上——**二选一，禁止两套口径**。优先扩展 fleet，若 payload 过大再拆 growth。

### 5.6 Matter 编制（T3.5）

`matter/<id>/team-roster.json`：

```json
{
  "version": 1,
  "participantAssistantIds": ["asst_a", "asst_b"],
  "synthesizerAssistantId": "asst_a",
  "updatedAt": "…"
}
```

MeetingView 开本案会议时默认勾选；可「仅本场」临时改，不写回除非点「记住本案编制」。

---

## 6. 四条能力线（详细工程）

### T1 — 成长可见

**产品要求**

- 每位助手：累计任务数、首过通过率、需改写率、近 30 日趋势。
- 律师层可选：本周「你改口径次数」vs「直接通过」。
- Doctor / 设置「角色」/ 在办「团队」**同一数据源**。

| ID   | 项                       | 落点                                                                                 | 实现要点                                                   | 验收                              |
| ---- | ------------------------ | ------------------------------------------------------------------------------------ | ---------------------------------------------------------- | --------------------------------- |
| T1.1 | 签批打通 product metrics | `src/lawmind/engine/reviewing.ts`、`metrics/product-metrics.ts`                      | 与 `recordAgentReviewOutcome` 同事务路径；必带 assistantId | Doctor 摘要与 specialization 同向 |
| T1.2 | 窗口化成长 API           | `platform/build-agent-fleet.ts` 或新 `learning/assistant-growth.ts` + local-api 路由 | `windowDays` 查询；单测造事件                              | 30 日比率正确                     |
| T1.3 | UI 成长条                | `LawmindSettingsRoles.tsx`、Fleet 团队行                                             | 展示「62% → 78%（30 日）」；空数据友好文案                 | 律师不看 JSON                     |
| T1.4 | 改写幅度（可选）         | revision 完成钩子 → quality meta                                                     | 字符/段落 delta；**不**进静默学习                          | 辅助指标可查                      |

**非目标**：风格相似度模型。

**测试**

- 引擎：`agent-specialization` + product metric 联测。
- 桌面：Roles / Fleet 渲染 fixture（mock growth API）。

---

### T2 — 反馈闭环

**产品要求**

- 文书台 / 在办：`modified` / 修订说明 → **自动 pending**，无需先勾「写入画像」。
- 一键采纳 / 驳回；采纳后下次 prompt 可指出来源（preview-diff 可扩）。
- 「沉淀学习」保留为会话补充。

| ID   | 项                 | 落点                                                             | 实现要点                                     | 验收                   |
| ---- | ------------------ | ---------------------------------------------------------------- | -------------------------------------------- | ---------------------- |
| T2.1 | modified → suggest | 服务端 review 路由优先；`useReviewWorkbenchActions` 仅作触发对齐 | 服务端生成，防桌面漏调；kinds 见 §5.4        | 不勾学习框也有 pending |
| T2.2 | 修订完成回流       | `draft.revision_completed` / contract-revision-pack              | 从 keyModifications + notes 抽 1–3 条        | 带 matterId/taskId     |
| T2.3 | 在办采纳入口       | `LawmindAgentFleetPanel`、决策卡                                 | 角标「待教团队 N」；深链 Memory / 行内 adopt | 拍板旁可见待教         |
| T2.4 | 防噪               | `adoption-service` 或旁路 helper                                 | 7 日去重；空 notes 跳过；N/任务              | 单测                   |

**信任**：正式 profile **仅** adopt 或现有显式 API。

**文案规范（payload）**

- 用祈使/规范句：「争议解决条款须单独列出仲裁地与适用法，不得只写『依法解决』。」
- 禁止把整篇红线贴进 profile；超长截断并附 sourceTaskId。

---

### T3 — 分工常态化

**产品要求**

- `roleId` / `peerReviewDefaultAssistantId` **进流水线**。
- 可配置：交付物类型或任务 kind → 默认角色/助手。
- 工作流种子：起草 → 互审 → 律师拍板（NDA/合同审查）。
- 会议：全局默认编制 vs 本案编制。

| ID   | 项           | 落点                                                  | 实现要点                                                                               | 验收                     |
| ---- | ------------ | ----------------------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------ |
| T3.1 | 默认路由表   | 新 `routing/*` + local-api + 设置 UI                  | §5.3；intake/create-task 调用 resolve；Roles 页可编辑 byKind/byDeliverable             | 有配置则自动 assignee    |
| T3.2 | 强制互审闸   | draft `ready_for_review` 前                           | 读作者 `peerReviewDefaultAssistantId`；建 delegation / request_review；设置可关；audit | Firm 硬路径；Solo 默认关 |
| T3.3 | 工作流种子   | `builtin-workflow-templates.ts`                       | 合同审查 draft→peer→lawyer；复用 `assigneeRoleId`                                      | Solo 串行可跑通          |
| T3.4 | 专案组绑助手 | `review-campaign` playbook role → workspace assistant | 同 roleId 优先匹配                                                                     | 报告显示助手名           |
| T3.5 | 会议编制     | `team-roster.json` + MeetingView                      | 默认载入；「记住本案」                                                                 | 换场次不丢               |

**非目标**：全自动 HR 排班；跨 matter 负载均衡。

**Edition**

| Edition | forcePeerReview 默认 | 路由表 |
| ------- | -------------------- | ------ |
| Solo    | OFF（可开）          | 可用   |
| Firm    | ON（可关）           | 可用   |

---

### T4 — 领导视图

**产品要求**

- 在办第一屏：**按助手分行**——状态（空闲/执行中/待你拍板）、近 30 日首过、当前事项。
- 队列（待签批/待补充/待批准）= **团队行的下钻 / 焦点滤镜**。
- Matter：本案团队条（编制 + 开放委派）。

| ID   | 项               | 落点                                             | 实现要点                                         | 验收                 |
| ---- | ---------------- | ------------------------------------------------ | ------------------------------------------------ | -------------------- |
| T4.1 | Fleet 按助手聚合 | `build-agent-fleet.ts`、`LawmindAgentFleetPanel` | `groupBy: "assistant"`；合并 growth + busy       | 先见人再见票         |
| T4.2 | 文案与 IA        | `agents-workbench.css`、侧栏文案                 | 弱化纯「队列」；「待我拍板」保留滤镜             | 律师能说出「谁卡了」 |
| T4.3 | Matter 团队条    | `MatterOverviewBody` 等                          | roster + open delegations                        | 一案一台见编制       |
| T4.4 | 协作事件进摘要   | action-summary                                   | `review.completed` / `delegation.completed` 角标 | 领导不漏互审完成     |

**IA 约束（与近期桌面一致）**

- 在办 / 会议室 / 文书台：无全局案件侧栏；页内自有左栏。
- 学习：suggest → adopt，永不静默。

---

## 7. 分期、排期与依赖

```text
Wave A · 地基（约 1–1.5 周）——最先有「带教感」
  T1.1 → T1.2 → T2.1 + T2.4
  指标打通 + 改写即 pending

Wave B · 分工硬起来（约 1.5–2 周）
  T3.1 → T3.2 → T3.3
  默认路由 + 互审闸 + 工作流种子
  （可与 A 尾部并行：路由表不依赖成长 API）

Wave C · 领导面（约 1–1.5 周）
  T4.1 → T4.2 → T1.3 → T2.3
  依赖 T1.2 数据；团队视图 + 成长条 + 采纳入口

Wave D · 加固（穿插 / +1 周）
  T3.4 · T3.5 · T2.2 · T1.4 · T4.3 · T4.4
```

| 依赖                               | 说明                                                 |
| ---------------------------------- | ---------------------------------------------------- |
| C → T1.2                           | 团队行成长数字                                       |
| T3.2 → 现有 delegation/handoff API | 不阻塞 A                                             |
| T2.1 优先服务端                    | 避免仅前端触发导致漏学                               |
| 文档/CHANGELOG                     | 每 Wave 结束更新本文件勾选 + `LAWMIND-DESKTOP-UI.md` |

**建议人力**：1 名引擎 + 1 名桌面可并行 A 的 T1 与 T2；B 引擎偏重；C 桌面偏重。

**建议开工顺序（若只开一个人）**：T1.1 → T2.1/T2.4 → T1.2 → T3.1 → T3.2 → T4.1 → T1.3/T2.3 → T3.3 → D。

---

## 8. 跨切要求

1. **审计**：adoption suggest/adopt/dismiss、互审闸触发、默认路由解析失败 → audit（已有 kind 则复用，缺则补 `routing.resolve_failed` 类事件）。
2. **Edition**：见 T3；Solo 不因 Firm 默认被强迫互审。
3. **测试**：每个 T\* 至少 1 条引擎单测 + 关键桌面缝测；签批路径可选 e2e 烟测。
4. **文档**：`LAWMIND-DESKTOP-UI.md`（在办隐喻）、`CHANGELOG`、本文件状态勾选。
5. **安全**：不绕过 workspace 边界写记忆；adoption payload 不进未授权路径。
6. **性能**：growth/fleet 聚合避免全量扫超大 JSONL——可按日切分或尾部 window 扫描（实现时选简单可靠方案，单测锁行为）。
7. **CSS**：改 `styles/*.css` 后必须 `pnpm lawmind:sync:renderer-css`。

---

## 9. 度量与内测成功标准

| 指标             | 定义                                           | 目标（内测 4–6 周） |
| ---------------- | ---------------------------------------------- | ------------------- |
| 主力助手首过率   | specialization / product first_pass            | 相对基线 ↑ ≥10pt    |
| 改写率           | rewrite / reviewed                             | ↓                   |
| 学习处理率       | (adopt+dismiss) / suggest（T2 路径）           | ≥40% 被处理         |
| 默认路由命中     | 有 defaults 的任务未手动改派                   | ≥60%                |
| 互审覆盖（Firm） | 配置了 peer 的草稿经互审再进律师               | ≥80%                |
| 分轨可感知       | 律师问卷：能否区分「合同助手 vs 诉讼助手」成长 | ≥70% 答「能」       |

**基线采集**：Wave A 上线后先跑 1 周只记指标、不强推互审，作为对照基线。

---

## 10. 演示脚本（Demo）

### Demo A — 带教闭环（Wave A 后）

1. 用合同助手出一份审查意见 → 律师点「需修改」，写两条：语气更克制；管辖条款必须单列。
2. 打开记忆 / 在办「待教」：见 1–2 条 pending，target=合同助手。
3. Adopt → 再跑同类任务：prompt 或 Inspector 可见已写入条文。
4. 设置角色页：该助手 tasksReviewed +1，rewrite 计数增加（首过率分子分母可解释）。

### Demo B — 默认编制 + 互审（Wave B 后）

1. 配置 `contract_review → 合同助手`，peer=质控助手；Firm 开强制互审。
2. Intake 创建合同审查：自动派合同助手，无需会议室现勾。
3. 起草完成后自动进质控互审，再进律师待签批；audit 可见闸。
4. Solo 关闭强制互审：可直达律师。

### Demo C — 领导视图（Wave C 后）

1. 打开在办：先见三人状态行（忙/待拍板/空闲）+ 30 日首过。
2. 点某人下钻到其待办票；「待我拍板」滤镜仍可用。
3. 角标显示待教 N；处理一条 adopt。

---

## 11. 风险与缓解

| 风险            | 影响                     | 缓解                                    |
| --------------- | ------------------------ | --------------------------------------- |
| 学习建议噪声大  | 律师关掉飞轮             | T2.4 防噪；默认 pending；dismiss 好     |
| 指标口径分裂    | 「到底有没有进步」不可信 | 单一 growth/fleet 数据源；禁双写 UI     |
| 互审拖慢 Solo   | 反感                     | Edition 默认 OFF                        |
| 路由表配置成本  | 无人配则退回现勾         | 出厂种子 + 设置向导文案；无配置安全回退 |
| 修订 notes 太空 | 无学习                   | 空则不生成；引导「写一句给团队的规矩」  |
| JSONL 扫描变慢  | 成长 API 卡              | 窗口尾扫 / 可选汇总缓存文件             |
| 专案组角色≠助手 | 报告署名混乱             | T3.4 绑定；过渡期 UI 标明「抽象角色」   |

---

## 12. 与 backlog 对齐

| 本计划   | backlog                                 | 说明                                 |
| -------- | --------------------------------------- | ------------------------------------ |
| T1       | P1-2 Agent 特化轨迹                     | 从「有计数」到「可见、分窗、分轨」   |
| T2       | P1-1 进化飞轮                           | 从「双队列存在」到「改稿默认半自动」 |
| T3       | §1.3 A-1/A-2；P1-3 协作协议硬化（部分） | 元数据变硬路径                       |
| T4       | P0-3 团队协作可视                       | 从队列升级为团队主视图               |
| Demo A–C | §1.5 北极星验收叙事                     | 可演示而非纯文档                     |

**不在本计划内、但支撑「敢放手」的相邻项**：P0-1/P0-2 检索与引用（研究员可信）——并行维护，不阻塞本计划 Wave A。

---

## 13. 完成定义（DoD）

### Wave A DoD

- [x] 签批路径写入 product metrics（含 assistantId）
- [x] growth/fleet 窗口 API + 单测
- [x] modified/修订说明 → pending adoption（服务端）+ 防噪单测
- [x] CHANGELOG + 本文件 Wave A 勾选

### Wave B DoD

- [x] defaults 读写/resolve API + intake 接线（`commitPlannedIntent`）
- [x] 强制互审闸（可关）+ audit + Edition 默认
- [x] 至少一条多步工作流种子可跑通（contract-review / nda-triage + seed 升级）
- [x] 设置 UI 可编辑强制互审（岗位页）；路由表 JSON / API 可用

### Wave C DoD

- [x] 在办默认「团队」聚合视图
- [x] 成长条（设置 + 在办）同口径
- [x] 「待教团队」角标/入口
- [x] `LAWMIND-DESKTOP-UI.md` 更新在办隐喻

### Wave D DoD

- [x] T3.4 专案组 playbook → 工作区助手绑定（报告 + UI 助手名）
- [x] T3.5 本案 `team-roster.json` + 会议室默认勾选 /「记住本案编制」
- [x] T2.2 修订完成 / 合同修订包 → pending adoption（审核通过积累路径亦禁静默 profile）
- [x] T1.4 改写幅度（revision 完成 → quality meta + growth/Roles/Doctor）
- [x] T4.3 Matter 概览「本案团队」条
- [x] T4.4 action-summary 协作完成角标（不计入待拍板）
- [x] CHANGELOG + 本文件 Wave D 勾选

### 全计划（A–C）产品 DoD

- [x] Demo A/B/C 可对内演示（本地路径就绪）
- [x] 内测指标表开始采集（`GET/POST /api/metrics/team-growth*` + Doctor 表 + baseline）
- [x] 律师能感知「不同助手成长方向不同」（分轨指标 + 团队行）

---

## 附录 A — 关键文件索引

| 区域         | 路径                                                                                                                  |
| ------------ | --------------------------------------------------------------------------------------------------------------------- |
| 特化         | `src/lawmind/learning/agent-specialization.ts`                                                                        |
| 采纳         | `src/lawmind/memory/adoption-service.ts`                                                                              |
| 可执行偏好   | `src/lawmind/memory/executable-preferences.ts`                                                                        |
| 签批         | `src/lawmind/engine/reviewing.ts`                                                                                     |
| 产品指标     | `src/lawmind/metrics/product-metrics.ts`                                                                              |
| 内测指标表   | `src/lawmind/metrics/team-growth-dashboard.ts` · `GET/POST /api/metrics/team-growth*` · Doctor「团队成长 · 内测指标」 |
| Fleet        | `src/lawmind/platform/build-agent-fleet.ts`                                                                           |
| 助手类型     | `src/lawmind/assistants/types.ts`                                                                                     |
| 工作流种子   | `src/lawmind/collaboration/builtin-workflow-templates.ts`                                                             |
| Orchestrator | `src/lawmind/agent/orchestrator/executor.ts`                                                                          |
| 桌面在办     | `apps/lawmind-desktop/src/renderer/LawmindAgentFleetPanel.tsx`                                                        |
| 角色设置     | `apps/lawmind-desktop/src/renderer/LawmindSettingsRoles.tsx`                                                          |
| 记忆 UI      | `apps/lawmind-desktop/src/renderer/MemoryInspector.tsx`                                                               |
| 文书台动作   | `apps/lawmind-desktop/src/renderer/review/`（useReviewWorkbenchActions 等）                                           |
| 会议室       | `apps/lawmind-desktop/src/renderer/app/MeetingView.tsx`                                                               |
| 本案编制     | `src/lawmind/cases/team-roster.ts`                                                                                    |
| 专案组绑助手 | `src/lawmind/review-campaign/bind-assistants.ts`                                                                      |
| 本案团队条   | `apps/lawmind-desktop/src/renderer/matter/MatterTeamRosterStrip.tsx`                                                  |
| 改写幅度     | `src/lawmind/learning/rewrite-amplitude.ts`                                                                           |

## 附录 B — 状态勾选（实施时维护）

| Wave | 状态   | 日期       | PR / 备注                                                                |
| ---- | ------ | ---------- | ------------------------------------------------------------------------ |
| A    | 已落地 | 2026-07-21 | reviewing + adoption suggest + growth API；设置岗位表展示窗口指标        |
| B    | 已落地 | 2026-07-21 | routing defaults + peer gate + 多步 workflow seeds；岗位页强制互审       |
| C    | 已落地 | 2026-07-22 | 团队/队列双模式；待教深链记忆；修订回流学习                              |
| D    | 已落地 | 2026-07-22 | 含 T1.4 改写幅度；专案组绑助手、会议编制、本案团队条、协作完成角标；T2.2 |
