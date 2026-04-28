# LawMind Deliverable-First Architecture（DFA）

> 本文档是 **LawMind 商业化路线的架构记忆**。  
> 与 [LawMind 2.0 战略](/LAWMIND-2.0-STRATEGY) 互补：2.0 战略回答 “LawMind 想成为什么”；本文档回答 **“怎么把它变成律师真的会付钱的产品”**。  
> 与 [LawMind 架构文档](/LAWMIND-ARCHITECTURE) 第十一/十四章呼应。

---

## 1. 北极星

LawMind 的卖点不是「功能多」，而是 **「能交件」**。

> 律师付钱购买的不是一份漂亮的检索整理，  
> 而是一份**可签署、可外发、可承担责任**的成品。

Deliverable-First Architecture（以下简称 **DFA**）是把这一句产品判断翻译成代码契约的方法。

---

## 2. 五大商业化主张（按 ROI 排序）

| #                    | 主张                                                                  | 商业价值                              | 实施位置                                                   |
| -------------------- | --------------------------------------------------------------------- | ------------------------------------- | ---------------------------------------------------------- |
| **P1. 交付物本位**   | `DeliverableType` 是一等公民；每类有 spec、必要章节、占位符规则、追问 | 决定输出可信度                        | `src/lawmind/deliverables/` + `router/deliverable-meta.ts` |
| **P2. 验收门禁**     | Render 前 `validateDraftAgainstSpec()` 给出 ✅✗ 清单                  | 律师/律所/合规要的「我敢用」护栏      | `src/lawmind/deliverables/validator.ts`                    |
| **P3. 来源锚点**     | 每段引用 → hover 看原文 → 点击跳转                                    | 顶级信任壁垒（对标 Harvey/Spellbook） | desktop `/api/sources/:id/preview` + UI                    |
| **P4. 三档版本封装** | `LAWMIND_EDITION` = solo/firm/private 控制特性显隐                    | 直接定价依据                          | `policy/edition.ts` + 设置面板                             |
| **P5. 30 秒首跑**    | 首次启动 → 选角色 → 出第一份合同                                      | 试用→付费转化                         | onboarding 重做                                            |

---

## 3. 当前已落地（与文档时间同步）

| 主张                | 状态        | 关键文件                                                                                                                                                                                                                                                        |
| ------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1 交付物本位       | ✅ 起点完成 | `src/lawmind/types.ts`（`DeliverableType` / `acceptanceCriteria` / `clarificationQuestions`）、`src/lawmind/router/deliverable-meta.ts`、`src/lawmind/deliverables/registry.ts`（**本轮**）                                                                     |
| P1 起草端           | ✅ 进行中   | `src/lawmind/reasoning/keyword-draft.ts`（按 deliverableType 生成结构化完整正文）                                                                                                                                                                               |
| P1 Agent 端         | ✅ 进行中   | `src/lawmind/agent/tools/engine-tools.ts`（`draft_document` 透传交付物字段；`render_document` 支持 `approve=true`）                                                                                                                                             |
| P1 桌面端           | ✅ 进行中   | `apps/lawmind-desktop/src/renderer/lawmind-chat-shell.tsx`（待补充信息卡）、`lawmind-chat.ts`（解析 status / clarificationQuestions）                                                                                                                           |
| P2 验收门禁         | ✅ 已通线   | `src/lawmind/deliverables/validator.ts`、`apps/lawmind-desktop/server/lawmind-server-route-review.ts`（HTTP 422 strict）、`src/lawmind/agent/tools/engine-tools.ts`（render_document 内置 gate）、`apps/lawmind-desktop/src/renderer/LawmindAcceptanceGate.tsx` |
| P3 来源锚点         | ✅ 本轮新增 | `apps/lawmind-desktop/server/lawmind-server-route-sources.ts`（`GET /api/sources/:id/preview`）+ `LawmindSourcePreview.tsx`（hover popover）+ Citation Banner / 草稿正文接入                                                                                    |
| P4 三档版本         | ✅ 已落地   | `src/lawmind/policy/edition.ts` + `apps/lawmind-desktop/src/renderer/use-edition.ts`                                                                                                                                                                            |
| P4.1 自定义 spec    | ✅ 已落地   | `src/lawmind/deliverables/workspace-loader.ts`（事务所 `lawmind/deliverables/*.json`）                                                                                                                                                                          |
| P4.2 验收交付包     | ✅ 已落地   | `src/lawmind/delivery/draft-acceptance-pack.ts` + `GET /api/drafts/:taskId/acceptance-pack`                                                                                                                                                                     |
| P4.3 桌面版本检视器 | ✅ 已落地   | `apps/lawmind-desktop/src/renderer/LawmindSettingsEdition.tsx`（设置 → 版本与交付物配置）+ 顶栏 `lm-edition-badge`                                                                                                                                              |
| P4.4 审核台一键导出 | ✅ 已落地   | `apps/lawmind-desktop/src/renderer/ReviewWorkbench.tsx`（受 `features.acceptancePackExport` 控制的「下载验收交付包」按钮）                                                                                                                                      |
| P4.5 案件验收聚合   | ✅ 本轮新增 | `apps/lawmind-desktop/server/lawmind-server-route-acceptance.ts`（`GET /api/acceptance-summary?matterId=`）+ MatterWorkbench 草稿行徽标 + 「去审核」直跳                                                                                                        |
| P5 30 秒首跑        | ✅ 本轮新增 | `apps/lawmind-desktop/src/renderer/LawmindFirstRunDialog.tsx`（角色 → 模板 → 创建案件 + seed prompt 一气呵成；首次启动自动触发）                                                                                                                                |

---

## 4. DFA 的代码契约

### 4.1 一等公民

```ts
type DeliverableType =
  | "contract.review" // 合同审查意见
  | "contract.rental" // 房屋租赁合同
  | "contract.general" // 通用合同/协议
  | "letter.demand" // 律师函/催告函
  | "document.general" // 通用法律文书
  | (string & {}); // 工作区自定义类型（事务所私有合同等）
```

> 自 2026-04 起，`DeliverableType` 同时支持工作区扩展类型。
> 事务所只需在 `<workspace>/lawmind/deliverables/*.json` 中放置规范文件，
> engine 启动时自动读取（详见 §6.2）。

### 4.2 spec 注册表（`src/lawmind/deliverables/registry.ts`）

每条 `DeliverableSpec` 描述：

- `requiredSections`：必要章节（按律师工作惯例），分 `blocker` / `warning`
- `acceptanceCriteria`：验收标准（律师"我敢交"清单）
- `placeholderRule`：是否允许带 `【待补充：xxx】` 占位符发布
- `defaultClarificationQuestions`：信息不足时的追问
- `defaultTemplateId` / `defaultOutput` / `defaultRiskLevel`

### 4.3 Acceptance Gate（`src/lawmind/deliverables/validator.ts`）

```ts
const report = validateDraftAgainstSpec(draft);
//  → AcceptanceReport {
//      ready: boolean,           // 所有 blocker 通过即 true
//      checks: AcceptanceCheck[],// 单项验收清单（passed / hint / severity）
//      blockerCount, warningCount,
//      placeholderCount, placeholderSamples
//    }

if (!isDraftReadyForRender(draft)) {
  // 桌面 UI 显示清单，禁止"导出最终文书"按钮
}
```

### 4.4 数据流

```text
用户指令
  ↓ Router (route + enrichIntentWithDeliverableMeta)
TaskIntent { deliverableType, acceptanceCriteria, clarificationQuestions }
  ↓ Engine.research()
ResearchBundle
  ↓ Engine.draft() / Agent.draft_document
ArtifactDraft { deliverableType, clarificationQuestions, acceptanceCriteria }
  ↓ validateDraftAgainstSpec()  ←─── DFA 验收门禁
AcceptanceReport { ready, checks, placeholderCount }
  ↓ Engine.render() (可选地强制 ready=true)
最终交付物 .docx / .pptx
```

---

## 5. 桌面端接入现状

| 接入点                                                                                      | 状态 | 文件                                                                                                                                                |
| ------------------------------------------------------------------------------------------- | ---- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| 审核台 `<LawmindAcceptanceGate report />` 子组件 + 「渲染交付物」按钮按 `report.ready` 置灰 | ✅   | `apps/lawmind-desktop/src/renderer/ReviewWorkbench.tsx` + `LawmindAcceptanceGate.tsx`                                                               |
| 审核台「下载验收交付包」按钮（`features.acceptancePackExport` 控制显隐）                    | ✅   | `apps/lawmind-desktop/src/renderer/ReviewWorkbench.tsx`                                                                                             |
| `/api/drafts/:taskId` 响应新增 `acceptance: AcceptanceReport`                               | ✅   | `apps/lawmind-desktop/server/lawmind-server-route-review.ts`                                                                                        |
| `/api/drafts/:taskId/render` strict mode 422 + report                                       | ✅   | `apps/lawmind-desktop/server/lawmind-server-route-review.ts`                                                                                        |
| Agent `render_document` 工具调用前跑 validator                                              | ✅   | `src/lawmind/agent/tools/engine-tools.ts`                                                                                                           |
| 顶栏版本徽章（Solo / Firm / Private Deploy）                                                | ✅   | `apps/lawmind-desktop/src/renderer/App.tsx`（`useEdition` + `lm-edition-badge`）                                                                    |
| 设置 → 「版本与交付物配置」面板（功能开关、内置 + 工作区 spec 列表）                        | ✅   | `apps/lawmind-desktop/src/renderer/LawmindSettingsEdition.tsx`                                                                                      |
| `/api/deliverables/specs` 标注 `source` 为 `builtin` 或 `workspace`                         | ✅   | `apps/lawmind-desktop/server/lawmind-server-route-acceptance.ts`                                                                                    |
| MatterWorkbench 每份草稿 DFA 徽标（验收 ✓/✗ + 占位符计数 + 「去审核」直跳）                 | ✅   | `apps/lawmind-desktop/src/renderer/MatterWorkbench.tsx`（`DraftAcceptanceBadge`）+ `GET /api/acceptance-summary`                                    |
| 引用 hover popover：`s-001` → 法条/案号/链接 + 支撑结论 + 引用章节                          | ✅   | `apps/lawmind-desktop/src/renderer/LawmindSourcePreview.tsx`（接入审核台 + 详情对话）                                                               |
| 30 秒首跑向导（首次启动 → 选角色 → 选模板 → 自动建案 + seed prompt）                        | ✅   | `apps/lawmind-desktop/src/renderer/LawmindFirstRunDialog.tsx`                                                                                       |
| 跨案件验收看板（P4.6，`crossMatterAcceptanceDashboard`）                                    | ✅   | `MatterWorkbench` 顶部「工作区交付就绪概览」+ `GET /api/acceptance-summary`（无 `matterId`）                                                        |
| 来源锚点：系统浏览器打开（P3.1 轻量）                                                       | ✅   | `LawmindSourcePreview.tsx` popover 内按钮，走 `openExternal` / `window.open`                                                                        |
| 首跑漏斗审计（P5.1）                                                                        | ✅   | `ui.firstrun_wizard_completed` + `ui.firstrun_acceptance_ready`；`POST /api/onboarding/firstrun-wizard`；`src/lawmind/onboarding/firstrun-state.ts` |

**后续可选增强（未承诺排期）**

- **P3.2**：PDF 内嵌阅读器或 URL 片段锚点定位（当前以外链为主）。
- **P4.7**：全所就绪率图表化（趋势、按 matter 聚合）；在现有 summary API 之上扩展。

---

## 6. 商业化拓展（与三档版本的对应）

### 6.1 三档对照表（与 `EDITION_FEATURES` 一致）

| 特性                          | Solo | Firm | Private Deploy |
| ----------------------------- | ---- | ---- | -------------- |
| 内置 5 类 spec                | ✅   | ✅   | ✅             |
| 自定义 spec（事务所私有合同） | ⬜   | ✅   | ✅             |
| 验收门禁 strict 模式          | ⬜   | ✅   | ✅             |
| 跨案件验收质量看板            | ⬜   | ✅   | ✅             |
| 验收交付包导出（per-draft）   | ⬜   | ✅   | ✅             |
| 合规审计导出                  | ⬜   | ⬜   | ✅             |
| Quality dashboard JSON        | ⬜   | ✅   | ✅             |
| 协作汇总                      | ⬜   | ✅   | ✅             |
| Security SBOM panel           | ⬜   | ⬜   | ✅             |

> 「跨案件验收质量看板」对应 `EDITION_FEATURES.crossMatterAcceptanceDashboard`。真实开关定义见 `src/lawmind/policy/edition.ts` 中的 `EDITION_FEATURES`。
> 桌面端通过 `useEdition()` 钩子读取后做面板显隐。

### 6.2 自定义 DeliverableSpec — 事务所如何添加私有合同

> 受 `customDeliverableSpec` feature 控制；UI 入口仅对 Firm / Private Deploy 显示。

**步骤：**

1. 在工作区下创建目录 `<workspace>/lawmind/deliverables/`。
2. 为每个新交付物类型放一份 JSON 文件，例如 `contract-employment.json`：

```json
{
  "type": "contract.employment",
  "displayName": "劳动合同",
  "description": "全职劳动合同正本，含薪酬、岗位、保密、竞业限制。",
  "defaultTemplateId": "contract-employment-firm",
  "defaultOutput": "docx",
  "defaultRiskLevel": "medium",
  "requiredSections": [
    {
      "headingKeywords": ["主体", "用人单位", "劳动者"],
      "purpose": "签约主体",
      "severity": "blocker"
    },
    { "headingKeywords": ["岗位", "职责"], "purpose": "工作内容", "severity": "blocker" },
    { "headingKeywords": ["薪酬", "工资", "福利"], "purpose": "薪酬福利", "severity": "blocker" },
    { "headingKeywords": ["保密", "竞业"], "purpose": "保密与竞业限制", "severity": "warning" },
    { "headingKeywords": ["签署", "落款"], "purpose": "签署页", "severity": "blocker" }
  ],
  "acceptanceCriteria": ["输出可直接签署的劳动合同正本", "薪酬条款必须含基本工资、绩效与发放周期"],
  "placeholderPattern": "【待补充[:：][^】]*】",
  "placeholderMustResolveBeforeRender": false,
  "defaultClarificationQuestions": [
    { "key": "salary", "question": "请补充薪酬构成与发放周期。", "reason": "劳动合同核心条款。" }
  ]
}
```

3. 重启 engine（或等下一次 `createLawMindEngine()`）；`loadWorkspaceDeliverableSpecs()` 会扫描并注册。
4. 解析失败的文件以 `audit/<date>.jsonl` 中 `kind: "deliverable.spec.invalid"` 记录，并由 desktop 通知律师 — 不会阻断 engine 启动。

**保护规则：**

- 默认禁止覆盖内置 5 类。如果需要事务所版本的 `contract.general`，在 JSON 顶层加 `"overrideBuiltin": true`。
- 同 `type` 在多文件中重复声明时，文件名靠前的胜出，后续文件以 warning 跳过。
- 内置 `parseDeliverableSpec()` 已暴露给桌面端做上传前预校验（避免坏文件落盘）。

### 6.3 验收交付包（per-draft Acceptance Pack）

> 受 `acceptancePackExport` feature 控制；Solo 调用 `/acceptance-pack` 端点会得到 403。

每份草稿都可生成一份"放心交付包"Markdown，建议随 `.docx` 一同发给客户：

```bash
# 命令行（事务所运维 / CI）
pnpm lawmind:gate -- --workspace ./workspace --pack <taskId> > pack.md

# HTTP（桌面 UI）
GET /api/drafts/<taskId>/acceptance-pack            # text/markdown 直接下载
GET /api/drafts/<taskId>/acceptance-pack?format=json # { ok, markdown }
```

包内容：

1. 验收门禁结论与单项检查清单（含占位符样例）
2. 引用完整性核查（基于 `resolveDraftCitationIntegrity`）
3. 草稿章节速览（标题 + 字数，不含正文，避免与 `.docx` 重复）
4. 与本任务相关的审计事件（来自 audit log，按时间排序）
5. 律师签收清单（4 项 checkbox）

设计取舍详见 `src/lawmind/delivery/draft-acceptance-pack.ts` 文件头注释。

### 6.4 spec 的三个来源层级

1. **Built-in**（本仓库 `registry.ts`）：通用、跨律所，体量保持小而精。
2. **Firm pack**（事务所打包文件）：按律所惯例、品牌、模板沉淀。
3. **Workspace override**（工作区 JSON）：按律师/案件的特殊偏好覆盖。

---

## 7. 与现有模块的关系

| 模块                         | 关系                                                                                                                   |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `router/deliverable-meta.ts` | **运行期检测器**：把指令翻译成 `deliverableType` 与默认追问。spec registry 是它的真相源。                              |
| `reasoning/keyword-draft.ts` | **草稿生成器**：按 spec 的 `requiredSections` 生成完整章节（不止"摘要"）。                                             |
| `evaluation/metrics.ts`      | **质量指标**：DFA 验收报告可作为 `firstPassApproved` / `acceptance.ready` 等新指标的输入。                             |
| `policy/index.ts`            | **门禁策略**：未来可在 `lawmind.policy.json` 中加 `deliverableGate.strict=true`，让 render 强制 acceptance gate 通过。 |
| `desktop ReviewWorkbench`    | **审核 UI**：未来挂 `<AcceptanceGate />` 子组件直接消费报告。                                                          |

---

## 8. 当前不做（路线护栏）

- 不引入第三方法律 schema（CLM/CLOC 等）：保持轻量、可演进。
- 不做基于 LLM 的语义验收：先做结构验收，避免 false positive；语义留给后续 `evaluation/`。
- 不在 spec 中绑定法条：法条引用归 `retrieval` + `LegalReasoningGraph`，spec 只描述结构。

---

## 9. 会话恢复与记忆

下次开发若涉及交付物 / 验收门禁 / 商业化分层，请按以下顺序读取：

1. 本文件
2. `docs/LAWMIND-2.0-STRATEGY.md`
3. `src/lawmind/deliverables/`（registry + validator + tests 是行为边界）
4. `src/lawmind/router/deliverable-meta.ts`
5. `src/lawmind/reasoning/keyword-draft.ts`
6. `apps/lawmind-desktop/src/renderer/lawmind-chat-shell.tsx`（前端追问 UI）

---

## 相关

- [LawMind 2.0 战略](/LAWMIND-2.0-STRATEGY)
- [LawMind 架构文档](/LAWMIND-ARCHITECTURE)
- [LawMind 工程记忆](/LAWMIND-PROJECT-MEMORY)
- [LawMind 用户手册](/LAWMIND-USER-MANUAL)
