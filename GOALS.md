# LawMind 目标文件（文档即记忆）

本文档是 **LawMind** 的目标与进度单一入口：方向、里程碑与勾选清单集中在此，便于对齐与回溯。  
与 [`VISION.md`](VISION.md) 的关系：`VISION.md` 是简短的工程入口；**叙事与原则以 [docs/LAWMIND-VISION.md](docs/LAWMIND-VISION.md) 为准**。

---

## 一、仓库定位

- 本仓库为 **LawMind 单体代码库**：引擎 **`src/lawmind`**、桌面 **`apps/lawmind-desktop`**、文档站 **`apps/lawmind-docs`**。
- 不再包含 OpenClaw 网关、extensions 渠道树或移动/桌面伴侣应用目录。若需对照历史经验，见 **[docs/LAWMIND-OPENCLAW-LESSONS.md](docs/LAWMIND-OPENCLAW-LESSONS.md)**。

---

## 二、愿景与原则（摘要）

- **产品定位（现阶段）**：优先面向**个人律师**的工作台——可审计、可追溯、责任边界清晰；北极星是**任务级可验收交付**。律所 / Firm / 协作等为延伸能力，默认体验按个人工作室设计。
- **错位竞争**：把**律师日常可交办事项**纳入同一套任务闭环（检索整理、多类文书、材料组织、交付质检与审计等）；合同是高价值子集，不是产品边界。
- **北极星**：LawMind **不是**以对话轮次为目标的聊天产品，而是**按指令执行直至可交付成果**的任务型系统；若对范围或事实存在实质不确定，应先与律师对齐再执行（见 [LawMind 愿景 §6.2b–6.2c](docs/LAWMIND-VISION.md) 与 `src/lawmind/agent/system-prompt.ts`）。
- 详细叙事见 **[docs/LAWMIND-VISION.md](docs/LAWMIND-VISION.md)**、**[docs/LAWMIND-DECISION.md](docs/LAWMIND-DECISION.md)**、**[docs/LAWMIND-ARCHITECTURE.md](docs/LAWMIND-ARCHITECTURE.md)**。

---

## 三、路线图与里程碑清单

### 第一期（当前阶段）— 最小闭环

- [x] 建立双记忆模板：`workspace/MEMORY.md` / `workspace/LAWYER_PROFILE.md`
- [x] 核心数据结构：`TaskIntent` / `ResearchBundle` / `ArtifactDraft` / `AuditEvent`
- [x] 代码骨架：`src/lawmind/` 五大模块（Router / Memory / Retrieval / Artifacts / Audit）
- [x] 接入通用大模型（Retrieval adapter，OpenAI-compatible + 环境变量预设）
- [x] 接入法律专用模型（Retrieval adapter，同上）
- [x] Word 模板文件（`workspace/templates/word/`）
- [x] 人工审核 UI / CLI 交互（CLI + LawMind 桌面「审核」页：草稿列表、签批、渲染交付物）
- [x] 完整端到端测试（smoke 脚本 + Router/Reasoning/Engine 正式测试用例）

### LawMind Phase A（可审计交付底座，与顶尖产品路线对齐）

- [x] 引擎黄金路径单测：`matter` → 草稿 → `review` → `render(docx)` → 审计含 `draft.reviewed` / `artifact.rendered`（`src/lawmind/integration/phase-a-golden-engine.test.ts`）
- [x] 审计 Markdown 导出：`buildAuditExportMarkdown` + 按 `matterId` / `taskId` / 时间筛选（`src/lawmind/audit/index.ts`，桌面 `GET /api/audit/export`）
- [x] PROFILE 分段解析：`listAssistantProfileSections` + `GET /api/assistants/<id>/profile-sections`
- [x] 体检字段扩展：`GET /api/health` 含 `lawMindRoot`、`doctor.*`（`apps/lawmind-desktop/server/lawmind-health-payload.ts`）

### 第二期 — 扩展与深化

- [x] PPT 渲染（`render-pptx.ts`，引擎按 `draft.output === "pptx"` 分发）
- [x] 案件级记忆：`workspace/cases/<matter-id>/CASE.md`（`loadMemoryContext` / `ensureCaseWorkspace` / 引擎与 Agent 工具；见 `src/lawmind/memory/index.test.ts`）
- [x] 律师偏好显式学习：`appendLawyerProfileLearning`、`buildLawyerProfileReviewLearningLine`、审核台勾选写入「八、个人积累」、`POST /api/lawyer-profile/learning`
- [x] 文书模板分类：`BuiltInTemplateCategory` + `GET /api/templates/built-in`（contracts / litigation / client / internal）

### 第三期 — 商业化与合规

- [x] 多律师协作支持（委派注册表 + `collaboration-audit.jsonl` + `GET /api/collaboration/summary`）
- [x] 私有化部署方案（检查清单：[LawMind 私有化部署](/LAWMIND-PRIVATE-DEPLOY)）
- [x] 合规报表与审计链增强（`buildComplianceAuditMarkdown`、`GET /api/audit/export?compliance=true`）
- [x] 法律模板/技能包本地签名校验（`verifyLawMindBundleManifest`，[LawMind 包清单](/LAWMIND-BUNDLES)；非远程市场）

### 第四期 — Deliverable-First Architecture（DFA / 商业化关键里程碑）

> 本期把 LawMind 从「会写漂亮汇报」推进到「能交件」——参见 [LawMind DFA](/LAWMIND-DELIVERABLE-FIRST)。

- [x] **P1 交付物本位（基础）**：`DeliverableType` 一等公民、`router/deliverable-meta.ts` 检测、`keyword-draft.ts` 按交付物生成完整正文
- [x] **P2 验收门禁（核心）**：`src/lawmind/deliverables/` 注册表 + `validateDraftAgainstSpec()` + 6 类内置 spec（rental/general 合同、demand letter、合同审查、通用文书）
- [x] **P2.1 桌面/HTTP/Agent 接入**：`ReviewWorkbench` 挂 `<AcceptanceGate>`；`GET /api/drafts/:taskId` 携带 `acceptance`；`POST /render` 默认 strict 返回 422；agent `render_document` 内置 gate（可 `bypass_acceptance_gate=true` 越权）
- [x] **P3 来源锚点**：`GET /api/sources/:id/preview?taskId=` 返回原文 + 支撑结论 + 引用章节；桌面 `LawmindSourcePreview.tsx` 在审核台正文 / Citation Banner / 详情对话内提供 hover popover（对标 Harvey/Spellbook）
- [x] **P4 三档版本封装**：`src/lawmind/policy/edition.ts`（Solo / Firm / Private Deploy 8 项 feature 开关）+ 桌面 `useEdition()` 钩子 + `GET /api/policy/edition`
- [x] **P4.1 工作区私有 spec 加载**：`<workspace>/lawmind/deliverables/*.json` 自动注册（`workspace-loader.ts`），事务所私有合同（如 `contract.employment`）零代码扩展
- [x] **P4.2 验收交付包导出**：`src/lawmind/delivery/draft-acceptance-pack.ts` + `GET /api/drafts/:taskId/acceptance-pack` + `pnpm lawmind:gate -- --pack <taskId>`（受 `acceptancePackExport` 控制）
- [x] **P4.5 案件验收聚合**：`GET /api/acceptance-summary?matterId=` 一次性返回所有草稿的 ready / placeholder / blocker 计数；MatterWorkbench 草稿行渲染 `DraftAcceptanceBadge` + 「去审核」直跳
- [x] **P5 30 秒首跑**：`LawmindFirstRunDialog` 角色 → 模板 → 自动建案 + seed prompt；首次启动（无 matter）自动触发，可永久关闭

### 第五期 — 信任与可解释性硬化（5.1–5.5）

- [x] **5.1 Clarify–Execute**：`awaiting_clarification` 时工具层拒绝 `execute_workflow` / `draft_document` 等重流程；`pendingClarificationKeys` 会话持久化；单测 + 架构/工程记忆说明
- [x] **5.2 红线进 Prompt**：`lawmind.policy.json` 的 `agentMandatoryRules` / `agentMandatoryRulesPath` 注入 `buildSystemPrompt`；体检 `agentMandatoryRulesActive`（不泄露全文）
- [x] **5.3 子任务可见**：`TaskRecord.executionPlan`、任务创建默认步骤、`GET` 任务详情与桌面详情 UI；与 checkpoints 并存
- [x] **5.4 学习去重**：`appendLawyerProfileLearning` / 助手 profile append 同任务重复跳过；审计与审核台提示
- [x] **5.5 路由可见**：`GET /api/health` 暴露 router / reasoning / edition；可选 `runtimeHints`（Firm/Private 或 `includeTurnDiagnostics`）

### 第六期 — 自主执行与助理团队

- [x] **6.1 工作流续跑与引导**：`execute_workflow` 支持 `existing_task_id` + `restart_from: "research"`；检索失败返回 `recoverable` 提示；system prompt 强化交付优先与续跑说明；`taskIntentFromRecordOnly` + 单测
- [x] **6.2 团队工作流模板**：`workspace/lawmind/workflows/*.json`；`GET /api/collaboration/workflow-templates`、`POST /api/collaboration/workflow-run`；设置 → 协作内列出模板并试运行；架构文档协调 Clarify–Execute
- [x] **6.3 审核首屏自检**：`LawmindReviewSelfCheckSummary` 聚合验收 / 引用 / 交付类型并跳转详情
- [x] **6.4 工具预算可观测**：`lawmind.policy.json` 可选 `agentMaxToolCallsPerTurn`；`LAWMIND_AGENT_MAX_TOOL_CALLS`；`GET /api/health` 字段 `lawmindAgentMaxToolCalls`
- [x] **6.5 愿景/架构脚注**：`LAWMIND-VISION.md` Phase 6 进度注、`LAWMIND-ARCHITECTURE.md` 多助手流说明

### 第七期 — 异步任务、系统通知与 Edition 危险工具收紧

- [x] **7.1 团队工作流异步任务**：`POST /api/collaboration/workflow-run` 支持 `async: true` → `202` + `jobId`；`GET /api/jobs/:id`、`GET /api/jobs?limit=&status=&since=`；**`GET /api/jobs/:id/stream`**（SSE + `onProgress` 推送 + 心跳）；`executeWorkflow` 可选 `onProgress` 写 job `progress`（`lawmind-server-jobs.ts`、路由接入 `lawmind-server-dispatch.ts`）
- [x] **7.2 桌面完成通知**：Electron `Notification` + `lawmind:show-notification` IPC / preload；设置 → 协作「运行所选模板」**优先 EventSource、失败回退轮询**，终态时一次系统通知；**近期任务**对非当前 `queued`/`running` 任务**有限并发 SSE（默认 2 路）**刷新列表（`LawmindSettingsCollaboration.tsx`）
- [x] **7.3 Edition 收紧危险工具**：`EDITION_FEATURES.strictDangerousToolApproval`（Firm / Private 开启）；`buildAgentConfig` 注入；`toolRequiresExplicitApproval` + `execute_workflow` 扩展清单；`LAWMIND_ALLOW_DANGEROUS_TOOLS_WITHOUT_APPROVAL` 在严格版下不绕过（`src/lawmind/agent/dangerous-tool-policy.ts`、`runtime.ts`）
- [x] **7.4 进度脚注**：`LAWMIND-VISION.md` Phase 7 工程注
- [x] **7.5 异步 Job 加固**：`workspace/lawmind/jobs/*.json` 持久化与进程重启时将非终态 job 标为 `interrupted_by_restart`；`POST /api/jobs/:id/cancel`（队列内立即取消，运行中在步骤批次间协作式中止，不中断单次 `sendAndWait`）；`idempotencyKey` 防重复提交；`executeWorkflow` 可选 `shouldAbort`；通知点击聚焦并滚动至设置协作区；协作面板取消按钮与通知不可用提示

---

## 五、非目标与边界（简要）

以下为当前阶段**暂不纳入**的方向，作为路线图护栏：

- 将 LawMind 收窄为单一文书类型（例如「只做合同」）或纯聊天产品。
- 默认依赖**远程技能市场**或不可审计的黑箱链路作为核心交付路径（本地签名的包与模板除外；见 [LAWMIND-BUNDLES](docs/LAWMIND-BUNDLES.md)）。
- 在未通过律师审核（`reviewStatus` / 验收门禁）时**对外宣称终稿已生效**或自动绕行渲染/导出。
- 为「功能演示」弱化审计、归因或工作区隔离等合规默认值。
- 引入与 **127.0.0.1 本地桌面 API** 安全模型不匹配的隐式远程控制面（除非单独设计并文档化）。

有强用户需求或明确合规背书时，可再评审调整。

---

## 六、参考

- 工程愿景入口：[VISION.md](VISION.md)
- **LawMind 愿景（文档即记忆）**：[docs/LAWMIND-VISION.md](docs/LAWMIND-VISION.md)
- **LawMind 决策文档**：[docs/LAWMIND-DECISION.md](docs/LAWMIND-DECISION.md)
- **LawMind 架构文档**：[docs/LAWMIND-ARCHITECTURE.md](docs/LAWMIND-ARCHITECTURE.md)
- **LawMind 文档站（VitePress）**：[apps/lawmind-docs/README.md](apps/lawmind-docs/README.md)（`pnpm lawmind:docs:dev` / `lawmind:docs:build`）
- **LawMind 使用手册**：[docs/LAWMIND-USER-MANUAL.md](docs/LAWMIND-USER-MANUAL.md)
- **LawMind 桌面端 UI 约定**：[docs/LAWMIND-DESKTOP-UI.md](docs/LAWMIND-DESKTOP-UI.md)
- **LawMind 工程记忆**：[docs/LAWMIND-PROJECT-MEMORY.md](docs/LAWMIND-PROJECT-MEMORY.md)
- **与 OpenClaw 取长补短的工程约定**：[docs/LAWMIND-OPENCLAW-LESSONS.md](docs/LAWMIND-OPENCLAW-LESSONS.md)
- **Deliverable-First**：[docs/LAWMIND-DELIVERABLE-FIRST.md](docs/LAWMIND-DELIVERABLE-FIRST.md)
- **商业化与合规索引**：[docs/LAWMIND-DELIVERY.md](docs/LAWMIND-DELIVERY.md)、[docs/LAWMIND-SECURITY-CHECKLIST.md](docs/LAWMIND-SECURITY-CHECKLIST.md)、[docs/LAWMIND-CUSTOMER-OVERVIEW.md](docs/LAWMIND-CUSTOMER-OVERVIEW.md)
- **模型适配**：[docs/LAWMIND-MODEL-ADAPTERS.md](docs/LAWMIND-MODEL-ADAPTERS.md)
- 仓库说明：[README.md](README.md) · 贡献：[CONTRIBUTING.md](CONTRIBUTING.md) · 安全：[SECURITY.md](SECURITY.md)

---

_最后更新：可在此记录日期或由维护者按需更新。_
