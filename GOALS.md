# LawMind 目标文件（文档即记忆）

本文档是 **LawMind** 的目标与进度单一入口：方向、里程碑与勾选清单集中在此，便于对齐与回溯。  
与 [`VISION.md`](VISION.md) 的关系：`VISION.md` 是简短的工程入口；**叙事与原则以 [docs/LAWMIND-VISION.md](docs/LAWMIND-VISION.md) 为准**。

---

## 一、仓库定位

- 本仓库为 **LawMind 单体代码库**：引擎 **`src/lawmind`**、桌面 **`apps/lawmind-desktop`**、文档站 **`apps/lawmind-docs`**。
- 引擎模块与架构五层（Router / Memory / Retrieval / **Reasoning** / Artifact）及 Agent、Matter 写侧等扩展，见 **[docs/LAWMIND-ARCHITECTURE.md](docs/LAWMIND-ARCHITECTURE.md)** §二。
- 不再包含 OpenClaw 网关、extensions 渠道树或移动/桌面伴侣应用目录。

---

## 二、愿景与原则（摘要）

### 律师产品三条铁律（最高优先级 · 必须贯穿）

面向**执业律师**的一切产品与工程取舍，必须同时满足下列三条；冲突时**不得**用功能面、炫技或「像聊天」牺牲其中任一条：

| #   | 铁律                 | 律师侧含义                                   | 否决标准（一例）                                |
| --- | -------------------- | -------------------------------------------- | ----------------------------------------------- |
| 1   | **上手简单**         | 少配置、少迷路；默认路径就能交办与跟进       | 让 Day-1 / Solo 主路径变难 → 不做或收到次要入口 |
| 2   | **交付结果质量高**   | 交件可审、可用、可担责；来源与验收可核       | 不能提高可验收交付质量 → 不做主路径             |
| 3   | **交付结果稳定性高** | 同样交办结果不飘、流程不偶发翻车；失败可解释 | 同任务结果更飘 / 更偶发 → 先修稳态再扩面        |

细则与当前改动清单见 **[docs/LAWMIND-SIMPLE-RELIABLE-PLAN.md](docs/LAWMIND-SIMPLE-RELIABLE-PLAN.md)** §0；叙事见 [愿景 · 三条铁律](docs/LAWMIND-VISION.md#律师产品三条铁律)。

#### Agent 引导第四铁律（Cursor / Claude 级 · 贯穿工程）

面向模型编排与工具门禁时，在三条铁律之下增加一条**工程铁律**——冲突时不得用「禁止清单 / 字数配额 / 关键词硬拒」冒充质量或稳定：

| #   | 铁律                         | 含义                                                                                                  | 否决标准（一例）                                                           |
| --- | ---------------------------- | ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| 4   | **高级引导优先于判断类硬控** | 用 Skill、原则、自评量规、软教练、提案–接受发挥模型判断；硬拦截只留给安全、空交付、律师权威与滥用护栏 | 用句号/条数/Δ字符静默拒掉专业改稿，或靠「禁止…」spam 代替量规 → 不做主路径 |

- **学什么**：Cursor（Rules / Skills / 提案式改稿 / @钉源 / 检查点）、Claude（Skill 工作流 + 交付前自检）、Codex（原则化系统提示 + 可续跑）。
- **不学什么**：把产品做成通用 coding IDE；用机械硬控替代律师可审的专业判断。
- **对照与债表**：**[docs/LAWMIND-CURSOR-CLAUDE-CRAFT-REVIEW.md](docs/LAWMIND-CURSOR-CLAUDE-CRAFT-REVIEW.md)**（全工程审查）；落地样板：`src/lawmind/drafts/contract-redline-craft.ts`。
- Cursor L1–L5 与 Claude 工程波次已落地（见第十期 / 第十三期勾选）。法律一致性编译器 500 人天计划见第十四期与 [docs/LAWMIND-LEGAL-COMPILER-ROADMAP.md](docs/LAWMIND-LEGAL-COMPILER-ROADMAP.md)。

- **产品定位（现阶段）**：优先面向**个人律师**的工作台——可审计、可追溯、责任边界清晰；北极星是**任务级可验收交付**。律所 / Firm / 协作等为延伸能力，默认体验按个人工作室设计。
- **错位竞争**：把**律师日常可交办事项**纳入同一套任务闭环（检索整理、多类文书、材料组织、交付质检与审计等）；合同是高价值子集，不是产品边界。
- **任务北极星**：LawMind **不是**以对话轮次为目标的聊天产品，而是**按指令执行直至可交付成果**的任务型系统；若对范围或事实存在实质不确定，应先与律师对齐再执行（见 [LawMind 愿景 §6.2b–6.2c](docs/LAWMIND-VISION.md) 与 `src/lawmind/agent/system-prompt.ts`）。上述任务北极星从属于**三条铁律**（尤其质量与稳定性），并由**第四铁律**约束实现方式。
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
- [x] **7.2 桌面完成通知**：Electron `Notification` + `lawmind:show-notification` IPC / preload；「在办 · 按流程办」/设置协作区「运行所选模板」**优先 EventSource、失败回退轮询**，终态时一次系统通知；**近期任务**对非当前 `queued`/`running` 任务**有限并发 SSE（默认 2 路）**刷新列表（`LawmindSettingsCollaboration.tsx`）
- [x] **7.3 Edition 收紧危险工具**：`EDITION_FEATURES.strictDangerousToolApproval`（Firm / Private 开启）；`buildAgentConfig` 注入；`toolRequiresExplicitApproval` + `execute_workflow` 扩展清单；`LAWMIND_ALLOW_DANGEROUS_TOOLS_WITHOUT_APPROVAL` 在严格版下不绕过（`src/lawmind/agent/dangerous-tool-policy.ts`、`runtime.ts`）
- [x] **7.4 进度脚注**：`LAWMIND-VISION.md` Phase 7 工程注
- [x] **7.5 异步 Job 加固**：`workspace/lawmind/jobs/*.json` 持久化与进程重启时将非终态 job 标为 `interrupted_by_restart`；`POST /api/jobs/:id/cancel`（队列内立即取消，运行中在步骤批次间协作式中止，不中断单次 `sendAndWait`）；`idempotencyKey` 防重复提交；`executeWorkflow` 可选 `shouldAbort`；通知点击聚焦并滚动至设置协作区；协作面板取消按钮与通知不可用提示
- [x] **7.6 合同修订积累主路径与文档同步**：审核通过后按草稿 `contractRevisionCapture` 写入 `learning/contract-revisions/`（`contract-revision-on-review-approved.ts`）；桌面不增加批量合同目录设置 UI（`desk-settings` 仍 API/手工 JSON + 启动时加载供可选对话前缀）；[LAWMIND-CONTRACT-REVISION-ACCUMULATION.md](docs/LAWMIND-CONTRACT-REVISION-ACCUMULATION.md)、[LAWMIND-DESKTOP-FILES-AND-CONTEXT.md](docs/LAWMIND-DESKTOP-FILES-AND-CONTEXT.md)、[LAWMIND-ARCHITECTURE.md](docs/LAWMIND-ARCHITECTURE.md)、使用手册 §12 与 `GOALS` 本条对齐

### 第八期 — Matter-centered 写侧 + Role 编制 + Reasoning Gate（2026-Q3）

> 本期把 LawMind 从「派生只读 Matter」推进到「matter-centered 写侧 + 岗位化 +
> 推理门禁 + 显式记忆采纳 + UI 收敛」。架构见 [LAWMIND-ARCHITECTURE.md](docs/LAWMIND-ARCHITECTURE.md) §二。

- [x] **8.1 Engine + ToolPolicy pipeline 重构**：`src/lawmind/index.ts` 拆为
      `engine/{factory,planning,researching,drafting,reviewing,rendering,queries,
context,types,shared}.ts`；`runtime/tool-pipeline.ts` 八段中间件
      （budget / roleAllowlist / approval / clarificationGate / argSchema / timeout /
      audit / execute）替换 `runTurn` 内联逻辑（W1+W2）
- [x] **8.2 Matter 写侧 + JSON 真相源**：`application/services/{matter-write,
deliverable,approval,queue-write,deadline}-service.ts` + `adapters/matter-storage/`
      落 `workspace/matters/<id>/{matter.json,deliverables/*.json,approvals.jsonl,
queue.jsonl,deadlines.jsonl}`；engine hot path 全程双写；`/api/matters` /
      `/api/approvals` / `/api/queues` 优先读 JSON，缺失回退 `MatterIndex`；agent
      新增 `open_work_queue_item / request_approval / record_deadline`（W3+W4）
- [x] **8.3 Memory Adoption Service + Inspector**：`memory/adoption-service.ts`
      统一所有 Markdown 写入（pending / adopted / auto_adopted / dismissed 四态，
      覆盖 firm / lawyer / client / matter / playbook / opponent / project /
      assistant 八个 scope）；`MemoryInspector.tsx` + `/api/memory/adoption{,/suggest,
/adopt,/dismiss}`；案件认知页消费 service（W5+W6）
- [x] **8.4 Role 一等对象 + delegate_to_role + targetRole**：`core/role.ts`
      把 6 个 preset 升级为 Role；ToolPolicy 与 `engine/drafting.ts` 强约束工具与
      deliverable 类型；`/api/roles` + `LawmindSettingsRoles.tsx`；orchestrator
      支持 `assigneeRoleId`，新增 `delegate_to_role` 工具与
      `ApprovalRequest.targetRole` 入库 + 过滤；`collaboration-tools.ts` 拆到
      `tools/coordination/{delegate,handoff,meeting,utils}.ts`（W7+W8）
- [x] **8.5 Reasoning Gate**：`DeliverableSpec.reasoningGate` 字段 +
      `deliverables/reasoning-validator.ts`；strict 模式下与 acceptance gate 并联
      把守 render；高风险内置 spec（demand letter / contract review / general
      contract / litigation outline）默认开启；桌面 `LawmindAcceptanceGate` 同列
      展示 reasoning 报告（W9）
- [x] **8.6 Insights 解耦 + ux.matter_action 双写**：`src/lawmind/insights/` 4
      个 compute-\* 纯函数 + 单测；事件双写 `ui.matter_action` + `ux.matter_action`，
      policy `productInsightsCollection` 控制采集；UI 抽到
      `apps/lawmind-desktop/src/renderer/insights/`（W10）
- [x] **8.7 MatterWorkbench 拆分 seam**：在
      `apps/lawmind-desktop/src/renderer/matter/` 落地多视图 + insights barrel + Timeline/ListPane；
      `apps/lawmind-desktop/e2e/matter-cockpit.spec.ts` 锁定黄金路径；主文件 `MatterWorkbench.tsx` 约 2000 行（第十二期 W2 继续迁入 `matter/*`）
- [x] **8.8 季末验收 + 文档冻结**：`pnpm lawmind:acceptance` 接入
      `pnpm lawmind:quarterly-demo`（`scripts/lawmind/lawmind-quarterly-demo.ts`）跑
      matter → planned deliverable → 高风险 approval → 状态推进 → reasoning gate →
      memory adoption → JSON 真相源回读 全链路；新增
      `src/lawmind/integration/quarterly-acceptance.test.ts`；同步本节与
      `LAWMIND-ARCHITECTURE.md` 二、新增段

### 第九期 UX 硬化（2026-05，90 天体验计划）

- [x] **W1 就绪态**：`LawmindReadinessStrip` + `MODEL_NOT_CONFIGURED_USER_HINT` 文案统一 + 发送/向导一致
- [x] **W2 首跑/向导**：首跑 bootstrap 可见错误；API 向导检索策略 `details` 折叠；律师向种子 prompt
- [x] **W3 可读性**：`.lm-meta` 13px 基线；核心控件 `title`；设置「界面字号」`localStorage`
- [x] **W4 E2E**：smoke 就绪条；`matter-cockpit` + `pnpm lawmind:desktop:e2e`；本节骨架
- [x] **W5–6 审核/对话**：渲染门禁摘要；自检置顶；`LawmindChatDraftStatusBar` + 启发式单测
- [x] **W7 Matter**：概览默认三卡 +「更多洞察」折叠；Plan 模式 `title` 路线图
- [x] **W8 协作/模型**：协作文案瘦身；`byAssistantId` 模型记忆；委派 toast；工作流模型标签
- [x] **W9–10 工作 IA**：`lm.ui.workTab.v1` 实验开关；工作子 Tab（对话/审核）+ 深链兼容
- [x] **W11 状态收敛**：`matter/MatterOverviewExtras`；`statusLabel` + `GET /api/tasks/:id`
- [x] **W12 黄金路径**：`e2e/golden-path.spec.ts`；律所版灰显；全量回归入口 `pnpm test`

### 平台级 Big-Bang 重构（已完成）

- [x] 冻结平台统一契约：`docs/lawmind/LAWMIND-PLATFORM-CONTRACTS.md` + `src/lawmind/platform/contracts.ts`
- [x] Ingest Orchestration 收敛：`src/lawmind/platform/ingest-helpers.ts` + `analyze_document` / `read_project_file` 统一错误码
- [x] Task Execution 状态机收敛：`src/lawmind/platform/execution-state.ts` + chat/jobs 响应 `executionState`
- [x] Desktop API/UI 状态字段收敛：`getPendingClarificationState` 优先 `executionState`/`gateDecisions`；`GET /api/bootstrap`
- [x] Strict 门禁升级：CI 接入 `lawmind:multitask:validate` + `pnpm lawmind:verify`（含 HTTP smoke）
- [x] 切换与回退预案：`LAWMIND_PLATFORM_CONTRACTS_V1` + [LAWMIND-BIGBANG-CUTOVER-ROLLBACK.md](docs/lawmind/LAWMIND-BIGBANG-CUTOVER-ROLLBACK.md)

---

## 五、非目标与边界（简要）

以下为当前阶段**暂不纳入**的方向，作为路线图护栏：

- 将 LawMind 收窄为单一文书类型（例如「只做合同」）或纯聊天产品。
- 默认依赖**远程技能市场**或不可审计的黑箱链路作为核心交付路径（本地签名的包与模板除外；见 [LAWMIND-BUNDLES](docs/LAWMIND-BUNDLES.md)）。
- 在未通过律师审核（`reviewStatus` / 验收门禁）时**对外宣称终稿已生效**或自动绕行渲染/导出。
- 为「功能演示」弱化审计、归因或工作区隔离等合规默认值。
- 引入与 **127.0.0.1 本地桌面 API** 安全模型不匹配的隐式远程控制面（除非单独设计并文档化）。
- 用**判断类硬控**（改点配额、句号即拒、关键词长度冻结写路径、禁止名单 spam）冒充交付质量或稳定性——应走 Skill/量规（见第四铁律与 [CURSOR-CLAUDE-CRAFT-REVIEW](docs/LAWMIND-CURSOR-CLAUDE-CRAFT-REVIEW.md)）。安全/空交付/律师权威硬门禁不在此列。

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
- **长期回看项**：[docs/LAWMIND-FUTURE-ISSUES.md](docs/LAWMIND-FUTURE-ISSUES.md)
- **Cursor / Claude 高级引导 vs 硬控（债表）**：[docs/LAWMIND-CURSOR-CLAUDE-CRAFT-REVIEW.md](docs/LAWMIND-CURSOR-CLAUDE-CRAFT-REVIEW.md)
- **Deliverable-First**：[docs/LAWMIND-DELIVERABLE-FIRST.md](docs/LAWMIND-DELIVERABLE-FIRST.md)
- **商业化与合规索引**：[docs/LAWMIND-DELIVERY.md](docs/LAWMIND-DELIVERY.md)、[docs/LAWMIND-SECURITY-CHECKLIST.md](docs/LAWMIND-SECURITY-CHECKLIST.md)、[docs/LAWMIND-CUSTOMER-OVERVIEW.md](docs/LAWMIND-CUSTOMER-OVERVIEW.md)
- **模型适配**：[docs/LAWMIND-MODEL-ADAPTERS.md](docs/LAWMIND-MODEL-ADAPTERS.md)
- 仓库说明：[README.md](README.md) · 贡献：[CONTRIBUTING.md](CONTRIBUTING.md) · 安全：[SECURITY.md](SECURITY.md)

### 参考项目 P0 落地（2026-05）

> 依据 [docs/LAWMIND-REFERENCE-PROJECT-LESSONS.md](docs/LAWMIND-REFERENCE-PROJECT-LESSONS.md) 实施计划。

- [x] **统一待处理动作**：`requiresAction` + `POST /api/chat/resume` + [LAWMIND-INTERRUPT-RESUME.md](docs/LAWMIND-INTERRUPT-RESUME.md)
- [x] **待我拍板**：侧栏入口 + `GET /api/action-summary`、`POST /api/approvals/resolve`、聊天内 `LawmindRequiresActionCard`（不再挂 compose「待你处理」条）
- [x] **工作流库**：`workspace/lawmind/workflows/` 种子模板；桌面主路径为「在办 · 按流程办」与 compose 模板画廊（原独立 `LawmindWorkflowLibrary` 组件已收敛）
- [x] **任务看板**：`MatterTaskBoard` 聚合 tasks / queue / approvals / drafts
- [x] **系统体检**：`buildWorkspaceStandardReport` + `LawmindSettingsDoctor` + [LAWMIND-WORKSPACE-STANDARD.md](docs/LAWMIND-WORKSPACE-STANDARD.md)
- [x] **P1 信任**：`matterScopeMiddleware`、`buildWorkspaceSessionHealth`、MCP 路线图 [LAWMIND-INTEGRATIONS.md](docs/LAWMIND-INTEGRATIONS.md)

### 参考项目 P1 落地（2026-05）

> 第二期：体验收口 + 信任硬化 + 只读 MCP（见借鉴清单 P1）。

- [x] **来源锚点**：`GET /api/sources/:id/preview` 段落 `anchorId` / `excerpt`；审核台与 `LawmindSourcePreview` 跳转高亮
- [x] **律师责任声明**：`lawmind-attorney-disclaimer` 统一审核条、验收包导出、首跑文案
- [x] **任务看板 Jobs**：`GET /api/jobs?matterId=` + `MatterTaskBoard` kind=`job`
- [x] **工具批准编辑续跑**：`decision: edit` + `editedArgs`；`LawmindRequiresActionCard` JSON 编辑；E2E golden-path
- [x] **工具治理页**：`GET /api/tools/registry` + `LawmindSettingsTools`
- [x] **网络 allowlist**：`lawmind.policy.json` `networkAllowlist`；Brave 联网工具策略校验
- [x] **审计 hash-chain**：`emit(..., integrityChain)` + `GET /api/audit/export?integrity=true`（Firm+）
- [x] **工作流 schema**：`acceptancePackRequired` / `requiredSources`；库卡片标签；`gateHint` 轻提示
- [x] **会话时间线**：`buildMatterSessionTimeline` + `GET /api/matters/session-timeline`
- [x] **只读 MCP POC**：`pnpm lawmind:mcp:readonly` + [LAWMIND-INTEGRATIONS.md](docs/LAWMIND-INTEGRATIONS.md) 配置示例
- [x] **首跑高级入口**：`LawmindFirstRunDialog` → 系统体检；用户手册「从工作流库启动任务」

### 参考项目 P1+ 产品化（2026-05）

> ProWorkBench / Ralph / AgentActa / Claude for Legal 借鉴清单续做。

- [x] **集中批准队列**：`LawmindApprovalQueue` + `listPendingToolApprovals` + `GET /api/action-summary` 的 `toolApprovals`
- [x] **高安全模式体检**：Doctor 展示 allowlist / 危险工具 / 审计 hash-chain 三项
- [x] **审计链默认写入**：Firm/Private 下 `emit()` 默认 `integrityChain`（可 `integrityChain: false` 关闭）
- [x] **队列 phase**：`WorkQueueItem.phase` + 任务看板 subtitle
- [x] **会话健康增强**：工具待批准、活跃 jobs、队列阻塞信号
- [x] **执行轨迹时间线**：`LawmindChatExecutionTrace` `mode=timeline`
- [x] **连接器目录**：`docs/LAWMIND-INTEGRATIONS.md` connector catalog 表

### 参考项目 P2 波次（2026-05，可借鉴 MVP）

- [x] **审查矩阵**：`buildMatterReviewMatrix` + `GET /api/matters/review-matrix`；案件工作台「审查矩阵」标签
- [x] **记忆真相源**：`LawmindMemoryTruthSources` 按 scope 分组 + `GET /api/memory/source-text` 只读预览；`MemoryInspector` 中文 scope 标签
- [x] **来源标注**：`SourceAnnotation` + `GET/POST /api/sources/:id/annotations`；来源预览弹层 + 可选 `source.annotation` 记忆建议
- [x] **Token 统计**：`model-usage` 本地账本 + `runTurn` 累计 `modelUsage`；`GET /api/health` `usageSummary`；设置页「本地使用统计」
- [x] **Jobs 本地定时**：`scheduled` 状态 + `scheduleRunAt` + `processDueScheduledJobs` 30s tick；任务看板展示预约任务
- [x] **桌面 UI 构建修复**：`requires-action` 改用 `crypto.randomUUID()`，避免 Vite 打包 `node:crypto` 导致白屏
- [x] **MCP 扩展**：`list_source_annotations`、`get_review_matrix`、`get_draft_acceptance_pack`（`src/lawmind/mcp/readonly-tools.ts`）
- [x] **业务领域岗位**：`practice-personas.ts`；工作流库筛选 + 设置页领域标签

### 参考项目 P3 收口（2026-05，计划项全部落地）

- [x] **内置命名工作流**：9 个种子模板（NDA、律师函、尽调审查表、客户邮件摘要等）+ `namedAgent` 字段
- [x] **工作流自动播种**：`ensureBuiltinWorkflowSeeds`；桌面服务启动时写入缺失 JSON
- [x] **DMS / PM 三阶段路线图**：`docs/LAWMIND-INTEGRATIONS.md` 扩展（M1–M3、产品矩阵、IT 检查清单）
- [x] **用户手册**：内置工作流一览表 + `namedAgent` schema 说明

### 参考项目 P4（2026-05，M2 连接器 POC + 定时工作流）

- [x] **M2 只读连接器**：`src/lawmind/integrations/` + `GET /api/integrations` + `GET /api/integrations/:id/documents?matterId=`
- [x] **filesystem 案件目录索引**：`cases/<matterId>/` 文件元数据；`lawmind/integrations.json` 配置样例
- [x] **Doctor 集成状态**：`doctor.integrations` + `LawmindSettingsDoctor` 外部集成（M2）分组
- [x] **案件本地文档索引 UI**：`MatterLocalDocIndex`（概览 Tab）
- [x] **renewal-monitor 工作流**：内置模板 + `schedulable` + 工作流库「可预约执行」标签
- [x] **单测稳定性**：`matter-write-service.test.ts` 临时目录 `rm` 重试

### P1–P3 体验收口（2026-05，桌面可点可用）

- [x] **对话草稿状态条**：`LawmindChatDraftStatusBar` 使用 `GET /api/drafts/:taskId`（非 `/review`）
- [x] **记忆 Inspector**：案件工作台「认知」Tab 挂载 `MatterMemoryInspector`
- [x] **Redline 基准稿**：`POST /api/drafts/:taskId/redline/baseline` + 审核台双按钮与空状态引导
- [x] **FTS 冷启动提示**：案件搜索 `indexMissing` + 体检重建说明 + `.env.example` 注明 `LAWMIND_ALLOW_INDEX_REBUILD`
- [x] **E2E 导航**：`e2e-helpers` 兼容默认顶栏与工作子导航
- [x] **侧栏增强**：`project-only` 保留；cockpit 时案件快捷列表 + 有待决时底栏「待我拍板」
- [x] **W11 子面板**：`MatterReasoningBoard` / `MatterQualityCockpit` / `MatterRoleBoard` 挂载 + draft `reasoningReport`
- [x] **整洁与文档**：删除孤儿 `LawmindChatActivityFeed`；DMS fixture 说明；用户手册「日流程自检」

### 参考项目 P5 待启动（选型建议，未实施）

> 验收 Phase 4 后择一开工；建议优先级（改动面 / 价值平衡）：

1. [x] **MemoryInspector diff** — `buildAdoptionPreviewDiff` + `GET /api/memory/adoption/:id/preview-diff` + Inspector「预览变更」
2. [x] **审计 replay JSON** — `buildAuditReplayExport` + `GET /api/audit/export?replay=true`
3. [x] **SQLite FTS 只读索引** — `src/lawmind/indexing/` + `GET /api/search/workspace` + Doctor 重建
4. [x] **Redline / tracked changes** — `redline-proposal` + 审核台 Accept/Reject（段落级 MVP，无 Word TC）
5. [x] **真实 DMS OAuth** — iManage/SharePoint env 桩 + fixture + `cases/<matterId>/.lawmind-dms.json`

### 第十期 — Claude Code 工程借鉴（P0–P2，2026-05）

- [x] **P0 消息预处理**：`lawmind-message-preprocess.ts`、Brief 模式、工具组折叠、虚拟列表（>100 条）
- [x] **P0 Compose**：发送队列、`permissionMode`、待批准徽章、stash、`/⌘K` 命令面板
- [x] **P0 任务/批准 UI**：`LawmindTaskDrawer`；工具批准为聊天内 `LawmindRequiresActionCard` 一点 resume（二次 Dialog 已拆除）
- [x] **P1 执行契约**：扩展 `RunTurnEvent`（`token_budget` / `compact_boundary`）
- [x] **P1 Memory 召回**：`memory/relevant-recall.ts` + `runtime` 注入
- [x] **P1 Compact**：`agent/compact.ts`、`context-budget.ts` + `GET/POST /api/sessions/:id/context-budget|compact`
- [x] **P1 会话 Transcript**：`adapters/session-transcript/` + `POST /api/sessions/:id/resume`
- [x] **P1 工具元数据/权限**：`permission-mode.ts`、`ToolDefinition.isConcurrencySafe`；`tool-concurrency.ts` + 单测
- [x] **CLI**：`pnpm lawmind:doctor -- --json`
- [x] **P2 子进程工具沙箱**：`tool-sandbox.ts`、`subprocessSandboxMiddleware`；`doctor.p2.toolSandbox`；设置页 Doctor P2 区块
- [x] **P2 workflow snapshot**：`lawmind-server-jobs.ts` `workflowSnapshot` 入队/预约；`missing_workflow_snapshot` 兜底
- [x] **P2 Team Memory 同步脚手架**：`team-memory-sync.ts`（Firm + opt-in + 密钥扫描；默认关闭）

### 第十一期 — 卓越产品平台化（2026-05）

- [x] **Q1 黄金旅程冻结**：`src/lawmind/product/golden-journeys.ts` 固化 matter production、contract review trust、role delegation memory 三条旅程，供发布报告复用。
- [x] **工具治理元数据**：`src/lawmind/agent/tools/governance.ts` 为工具补齐风险、matter scope、运行模式、幂等性、重试性、审计和 sandbox 建议；`GET /api/tools/registry` 返回 governance。
- [x] **ContextPlan**：`src/lawmind/runtime/context-plan.ts` 将 matter state、MATTER_STRATEGY、pending actions、transcript、memory recall、source anchors、role context 分层描述。
- [x] **Deliverable lifecycle**：`src/lawmind/core/deliverable-lifecycle.ts` 固化 planned → drafting → pending_review → approved → rendered → delivered → learned，写侧 service 阻止跳过审核的 shortcut。
- [x] **Workflow playbook 摘要**：`src/lawmind/agent/collaboration/playbook-summary.ts` 将 workflow 模板转成含来源要求、审批点、风险和验收包要求的 playbook 视图。
- [x] **质量飞轮发布报告**：`src/lawmind/evaluation/replay-fixtures.ts` 内置 12 个真实任务回放样本；`release-report.ts` + `pnpm lawmind:release-readiness` 生成发布准备报告；`pnpm lawmind:verify` 接入报告输出。
- [x] **路线文档**：`docs/LAWMIND-EXCELLENCE-ROADMAP.md` 记录本期落地口径与验收命令。

### 第十二期 — 六维能力 ≥4.5（2026-Q2–Q3）

> 目标：工程 review 六维（架构、法律贴合、可维护性、测试/发布证据、Harvey/Word 对标、开源借鉴）全部 **≥4.5**。  
> 详细达标线与排期见 [LAWMIND-EXCELLENCE-ROADMAP.md](docs/LAWMIND-EXCELLENCE-ROADMAP.md) §六维能力 ≥4.5 升级计划。

#### W1 — 测试/发布证据 + 法律场景可证（3.0 → 4.5）

- [x] **Benchmark CLI**：`pnpm lawmind:benchmark` 跑 `BUILTIN_BENCHMARK_TASKS`；`lawmind:release-readiness` 默认并入结果；`LAWMIND_BENCHMARK_STRICT=1` 时 gate 失败 exit 1
- [x] **Quality 灌数**：smoke/quarterly-demo 后写入 `workspace/quality/*.quality.json`；发布报告 Dashboard 非空
- [x] **黄金旅程实证**：三条 `golden-journeys` 各 1 条 E2E 或 integration（matter-production / contract-review-trust / role-delegation-memory）
- [x] **E2E 扩展**：`contract-review-trust.spec.ts` 纳入 `lawmind:desktop:e2e:pr`
- [x] **Replay 结构测**：12 fixtures 中 ≥8 个非 LLM 结构断言单测

#### W2 — 工程可维护性（3.5 → 4.5）

- [x] **MatterWorkbench 拆分 seam**：`MatterTimelinePanel`、`MatterWorkbenchListPane`、`useMatterSessionTimeline`（主文件仍 >800 行，后续 PR 继续迁入 `matter/*`）
- [x] **App.tsx** ≤1000 行（`lawmind-app-root.tsx` + `lawmind-app-utils.ts`）；**FileWorkbench** 拆 `file/*`，单文件 ≤1000 行
- [x] **legal-tools** 拆 `tools/legal/*`，单文件 ≤600 行（`engine-tools` 拆分可单列 PR）
- [x] **runtime.ts** 外提 `turn-orchestrator.ts` / `runtime-model-call.ts`（公开 API 仍自 `runtime.ts` 导出）
- [x] **贡献约定**：单文件软上限写入 `CONTRIBUTING.md`

#### W3 — 对标 Harvey/Word（3.0 → 4.5）

- [x] **docx tracked changes**：`render-docx-tracked.ts` + `POST /api/drafts/:id/render-tracked`（officecli，失败回退 plain docx）
- [x] **真 DMS OAuth**：SharePoint Graph（`sharepoint-graph.ts`）；iManage 保持 fixture
- [x] **Matter 时间线**：一级 Tab「时间线」；`buildMatterSessionTimeline` 聚合 audit/approval/job
- [x] **集成差距表**：`LAWMIND-INTEGRATIONS.md` Harvey/Spellbook 对照

#### W4 — 架构守住 + 开源借鉴收口（≥4.5）

- [x] **契约 CI**：`lawmind-platform-contracts-check.ts` 纳入 `lawmind:multitask:validate`
- [x] **ContextPlan 集成测**：`context-plan.integration.test.ts`；`runtime.ts` 注入 ContextPlan markdown
- [x] **REFERENCE 状态表**：`LAWMIND-REFERENCE-PROJECT-LESSONS.md` §落地状态矩阵
- [x] **Queue dependsOn**：`queue-write-service` + 任务看板 subtitle
- [x] **架构目录对齐**：`LAWMIND-ARCHITECTURE.md` §二

#### 第十二期合并验收

```bash
pnpm lawmind:verify
LAWMIND_BENCHMARK_STRICT=1 pnpm lawmind:release-readiness -- --out dist/lawmind-release-readiness.md
pnpm lawmind:desktop:e2e:pr
pnpm lawmind:quarterly-demo
```

- [x] 发布报告：`Benchmark gate: pass`（mock 对齐模式）+ Quality Dashboard 可灌数
- [x] `pnpm lawmind:verify` + `LAWMIND_BENCHMARK_STRICT=1 pnpm lawmind:release-readiness` + `pnpm lawmind:desktop:e2e:pr`（38 过 / 2 跳 / 0 败）+ `pnpm lawmind:quarterly-demo`

### 第十三期 — Cursor / Claude / Codex 式高级引导（判断力优先 · 不改通路 · 2026-Q3）

> 把「高级引导优先于判断类硬控」写入全产品目标；硬门禁只保留安全 / 空交付 / 律师权威。  
> 硬控债表：[docs/LAWMIND-CURSOR-CLAUDE-CRAFT-REVIEW.md](docs/LAWMIND-CURSOR-CLAUDE-CRAFT-REVIEW.md)。

- [x] **13.0 入宪 + 全通路计划**：第四铁律；Craft 样板；A–L 通路对照与 W0–W4 分期（已落地，见债表）
- [x] **13.1 / W1.1 改稿双轨合一**：`update_draft` amplitude 硬拒 → soft 或大改走 Redline 提案（通路仍为 `update_draft`）
- [x] **13.2 / W1.2–W1.3 Intake 软化**：关键词·长度冻结 → Soft Ask + Intake Skill；钉源/邮件齐备不假澄清（交办表单保留）
- [x] **13.3 / W1.4 意见书与自动化禁语**：opinion 路径 `## 禁止` → 原则 + Opinion Craft（automations 入口不变）
- [x] **13.4 / W2 系统提示分层 + Citation Skill**：禁止名单瘦身；research/render 教练
- [x] **13.5 / W2 内置 Skill 面**：Intake、Citation、交付用语与合同 Craft 可发现可签名
- [x] **13.6 / W3 工具预算检查点 + Compact 重注红线**：软预算续跑；压缩后 RULES/deliverable 仍在
- [x] **13.7 / W4 可观测收口 + 回归**：gate-history 区分 safety/judgment；空修订/未批准/危险工具仍硬拒
- [x] **13.8 律师版 Cursor 默认姿势（2026-08-19）**：有凭据时模型路由默认开启；系统提示勿等律师先选通道；办件降为可选快捷。不新增入口、不削弱末端硬门禁。
- [x] **13.9 产品化能力（2026-08-19）**：高频办件（合同审查 / 函件 / 检索 / 诉讼 / 写材料 / 邮件合同）收成 Skill + 流水线，本轮自动绑定；禁止把正式交付交给模型自由发挥。
- [x] **13.10 办件选流程（2026-08-19）**：律师先附材料，再在「办件」列表选流程；指令写能力锁，不必记激活词。

```bash
pnpm exec vitest run src/lawmind/drafts/contract-redline-craft.test.ts \
  src/lawmind/drafts/apply-surgical-edits.test.ts \
  src/lawmind/agent/mail-contract-fast-path.test.ts
```

### 第十四期 — 法律一致性编译器奠基（历史扫描 + lint + 北极星 · 2026-Q3）

> 计划全文：[docs/LAWMIND-LEGAL-COMPILER-ROADMAP.md](docs/LAWMIND-LEGAL-COMPILER-ROADMAP.md)（500 人天 / 12 个月）。  
> Phase 0 + Wave 2 工程切片已落地；**人/数据债见 14.10，不是 500 人天全部完成**。lint 通过 ≠ 法律正确。外发仍须签批。

- [x] **14.0 计划入宪**：WS0–WS6 重校准（扫描 90 / lint 120 / 自修订 50 / 分级交付 55 / 立场 60 / benchmark 55 / 北极星 25 / 横切 45）；决策头延后
- [x] **14.1 历史扫描**：最多 3 根；整理夹建议建案、杂烩不自动建案；设置 + 首跑入口；`GET/POST /api/historical-scan*`
- [x] **14.2 习惯阈值**：红线 accept ≥5 入待确认；冲突取最新 mtime；不静默写 profile
- [x] **14.3 lint 内核**：10 条机械规则 + 参数库骨架（定金 20% / 时效 3 年 / 4×LPR 倍数）；起草/改稿 advisory；改稿台「机械核对」一行
- [x] **14.4 北极星基线**：`north-star.json` + Doctor「交付北极星」（空样本为「尚无」）
- [x] **14.5 增量扫描**：cursor + 二次扫描跳过未变文件；指纹不变不重复入队知识（WS0）
- [x] **14.6 自修订闭环**：≤3 轮；目前仅自动改超法定上限定金比例；或裁或诉进残留（WS2）
- [x] **14.7 买卖+借款族包 + 引用有效性骨架**：规则合计 ≥20；离线废止/无法核验（WS1）
- [x] **14.8 分级交付 + 渐进自主函数 + 决策头 + 升级建议**：外发永不自动；缺逃逸序列不解锁（WS3）
- [x] **14.9 结构化立场库 + 合成影子 benchmark**：红线 accept 入库；审阅时长 / lint 逃逸写侧（WS4–WS6）
- [ ] **14.10 人/数据债（500 人天未完成部分）**：法律顾问抽审族包、真实已结案影子、LLM 评审校准、法宝联调、M4 生产指标、其余族包、approve 路径真正 auto_deliver

```bash
pnpm exec vitest run src/lawmind/lint src/lawmind/historical-scan src/lawmind/metrics/north-star.test.ts \
  apps/lawmind-desktop/server/lawmind-server-route-historical-scan.test.ts \
  apps/lawmind-desktop/server/lawmind-server-route-metrics.test.ts
pnpm --filter lawmind-desktop typecheck
```

---

_最后更新：2026-08-30（第十四期 Wave 2：增量扫描 / 族包 / 自修订 / 分级交付 / 立场库 / 影子与北极星写侧。500 人天的人与数据债见 14.10）。_
