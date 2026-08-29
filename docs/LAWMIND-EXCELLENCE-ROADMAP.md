# LawMind 卓越产品迭代落地说明

本文把“向 Claude Code 学习伟大产品工程能力”落实为 LawMind 自己的工程口径。目标不是复刻 Claude Code，而是把成熟 agent harness、工具治理、上下文管理、质量飞轮和发布纪律转译为法律工作生产系统。

## Q1 黄金旅程

机器可读定义位于 `src/lawmind/product/golden-journeys.ts`，当前冻结三条旅程：

- `matter-production-flow`：新建 matter → workflow/playbook → deliverable → review gate → render。
- `contract-review-trust-flow`：合同材料 → source anchors → review matrix → acceptance pack。
- `role-delegation-memory-flow`：role delegation → approval queue → memory adoption。

这些定义被发布报告复用，避免路线图只停留在文档层。

## 平台化落点

- Runtime harness：`src/lawmind/agent/tools/governance.ts` 为每个工具补齐风险、matter scope、运行模式、幂等性、重试性和审计元数据。
- ContextPlan：`src/lawmind/runtime/context-plan.ts` 将 matter state、strategy、pending actions、transcript、memory recall、source anchors 和 role context 分层描述。
- Deliverable lifecycle：`src/lawmind/core/deliverable-lifecycle.ts` 固化 planned → drafting → pending_review → approved → rendered → delivered → learned，并阻止跳过 review 的 shortcut。
- Workflow playbook：`src/lawmind/agent/collaboration/playbook-summary.ts` 把 workflow 模板转为律师可读的 playbook 摘要。

## 质量飞轮

- 真实任务回放 fixtures：`src/lawmind/evaluation/replay-fixtures.ts` 内置 12 个法律任务样本，覆盖合同审查、律师函、客户更新、证据目录、案件时间线和法律 memo。
- 发布报告：`src/lawmind/evaluation/release-report.ts` 汇总黄金旅程、回放样本、benchmark、quality dashboard 和验证命令。
- CLI：`pnpm lawmind:release-readiness -- --out dist/lawmind-release-readiness.md` 生成发布准备报告。

## 验收命令

```bash
pnpm test -- src/lawmind/product src/lawmind/runtime src/lawmind/agent/tools src/lawmind/core src/lawmind/evaluation
pnpm typecheck
pnpm lawmind:release-readiness -- --out dist/lawmind-release-readiness.md
```

## 迭代原则

- Matter-first：业务状态以 matter/deliverable/approval/queue/deadline 为真相源。
- Review-first：高风险交付物不能绕过律师审核和 reasoning gate。
- Context-plan-first：上下文加载要可解释，而不是无限堆长上下文。
- Quality-first：新能力必须能被 benchmark、replay fixture、audit 或 E2E 证明。

---

## 六维能力 ≥4.5 升级计划（第十二期）

目标：把工程 review 中的六维评分全部稳定在 **≥4.5**（5 分制）。每项下列「4.5 达标线」= 可勾选验收；未达标不得标完成。

| 维度             | 基线 | 目标               | 主瓶颈                      |
| ---------------- | ---- | ------------------ | --------------------------- |
| 架构清晰度       | 5.0  | ≥4.5（守住）       | 契约与实现漂移              |
| 法律场景贴合     | 4.5  | ≥4.5（守住并可证） | 旅程有定义、缺 E2E/门禁实证 |
| 工程可维护性     | 3.5  | ≥4.5               | 巨型 TSX / 工具单文件       |
| 测试/发布证据    | 3.0  | ≥4.5               | benchmark 与 quality 未灌数 |
| 对标 Harvey/Word | 3.0  | ≥4.5               | Word TC、真 DMS OAuth       |
| 开源借鉴执行力   | 4.5  | ≥4.5（守住）       | REFERENCE 清单尾部 P1/P2    |

### 1. 架构清晰度（守住 ≥4.5）

**4.5 达标线**

- [x] `docs/lawmind/LAWMIND-PLATFORM-CONTRACTS.md` 与 `src/lawmind/platform/contracts.ts` 字段 diff 纳入 `pnpm lawmind:multitask:validate`（或等价脚本），CI 失败即阻断。
- [x] `ContextPlan` 与 `runtime` 注入：新增 `src/lawmind/runtime/context-plan.integration.test.ts`（或 golden snapshot），覆盖 matter + recall + pending actions 至少 3 层。
- [x] 架构图/模块表（`LAWMIND-ARCHITECTURE.md` §二）与 `src/lawmind/` 顶层目录季度对齐一次。

**不做**：为 5 分再拆 repo 或引入 LangGraph 全量迁移。

### 2. 法律场景贴合（≥4.5，可证）

**4.5 达标线**

- [x] 三条黄金旅程（`golden-journeys.ts`）各有一条 **E2E 或 integration** 用例：`matter-production`、`contract-review-trust`、`role-delegation-memory`。
- [x] 内置 9 个工作流 JSON 全部具备 `deliverableType` + `acceptancePackRequired`（或文档化例外）；`LawmindWorkflowLibrary` 卡片展示 playbook 摘要字段。
- [x] `BUILTIN_BENCHMARK_TASKS` 覆盖合同审查 / 律师函 / memo 三类，且 `expectsReviewGate` / `expectedKeywords` 与 DFA spec 一致。
- [x] 发布报告 `Benchmark gate: pass`（平均分 ≥80%）在**有模型配置**的 CI/夜间任务中至少跑通一次并归档 `dist/`（见 `lawmind-nightly.yml`）。

### 3. 工程可维护性（3.5 → ≥4.5）

**4.5 达标线**

- [x] **Renderer**：`MatterWorkbench.tsx` ≤800 行（逻辑迁入 `matter/*`）；`App.tsx` ≤1000 行；`FileWorkbench.tsx` 拆出 `file/` 目录，单文件 ≤1000 行。
- [x] **Agent 工具**：`legal-tools.ts` / `engine-tools.ts` 拆为 `tools/legal/*.ts`、`tools/engine/*.ts` + `registry` 聚合，单文件 ≤600 行。
- [x] **Runtime**：`runtime.ts` 仅保留 loop + 编排，compact/recall/进度 ≥3 块已外提并有单测。
- [x] 贡献约定：`CONTRIBUTING.md` 或 `CLAUDE.md` 写明「单文件软上限 800 行（工具/registry 600）」；Oxlint 或 PR 模板提醒。
- [x] `pnpm test` 与 typecheck 在拆分 PR 序列中全程绿（允许 3–5 个递进 PR）。

### 4. 测试/发布证据（3.0 → ≥4.5）

**4.5 达标线**

- [x] 新增 `pnpm lawmind:benchmark`（或 `lawmind:ops benchmark`）：对 `BUILTIN_BENCHMARK_TASKS` 跑分，输出 JSON + Markdown；`lawmind:release-readiness` **默认读入** benchmark 结果（无结果则 WARN，strict 模式 exit 1）。
- [x] `pnpm lawmind:verify` 在 release 分支可选 `--strict-benchmark` 或环境变量 `LAWMIND_BENCHMARK_STRICT=1`。
- [x] CI/夜间：`quarterly-demo` 或 smoke 后写 `workspace/quality/*.quality.json`，`release-readiness` 中 Quality Dashboard **非空**。
- [x] E2E：`e2e/golden-path` + `matter-cockpit` + **新增** `contract-review-trust.spec.ts`（来源预览 / 审查矩阵 / 验收条至少 1 断言）；`lawmind:desktop:e2e:pr` 纳入新 spec。
- [x] 12 个 `replay-fixtures` 中 ≥8 个有 **非 LLM** 的结构断言单测（router/deliverable/gate 层）。

### 5. 对标 Harvey/Word（3.0 → ≥4.5）

**4.5 达标线**（不要求 Harvey 级企业栈，要求「律师可感知对标」）

- [x] **来源信任**：审查矩阵 + source preview + acceptance pack 在同 matter E2E 可点通；用户手册一节「与 Harvey 式引用对照」。
- [x] **Word**：段落 redline 之外，增加 **docx 导出 tracked changes** MVP（`officecli` 或 `docx` 修订轨二选一，文档写明限制）；审核台「导出带修订 Word」按钮。
- [x] **DMS**：至少 **1 个** 真 OAuth 只读连接器（SharePoint **或** iManage 择一）脱离纯 fixture；`GET /api/integrations/:id/documents` E2E 或 integration 绿。
- [x] **可观测**：Matter 工作台默认或一级 Tab 展示 **会话时间线**（已有 API 收口 UI）；`insights` health 分在 Doctor 或 Matter 概览可见。
- [x] 集成路线图 `LAWMIND-INTEGRATIONS.md` 标注 M2 完成项与 Harvey/Spellbook 差距表（1 页）。

### 6. 开源借鉴执行力（守住 ≥4.5）

**4.5 达标线**

- [x] `LAWMIND-REFERENCE-PROJECT-LESSONS.md` 文末增加 **落地状态表**（P0/P1/P2 × 已落地/进行中/刻意不做），与 `GOALS` 第十二期勾选同步。
- [x] Ralph 借鉴：`queue.jsonl` 支持 `dependsOn` + `blockedReason`；任务看板展示阻塞原因。
- [x] AgentActa 借鉴：Matter 级 **统一时间线**（audit + jobs + approvals + turns 聚合），非仅 chat trace。
- [x] ProWorkBench 借鉴：工具治理页展示 `governance` 全字段 + Firm 锁定说明。
- [x] 刻意不做项文档化：WASM 全量沙箱、LangGraph 迁移、远程技能市场 — 避免 scope creep。

---

## 建议排期（约 10–12 周）

| 波次   | 周    | 主攻维度                 | 交付物                                                              |
| ------ | ----- | ------------------------ | ------------------------------------------------------------------- |
| **W1** | 1–3   | 测试/发布证据 + 法律可证 | `lawmind:benchmark`、release-readiness 灌数、3 旅程 E2E/integration |
| **W2** | 4–6   | 工程可维护性             | MatterWorkbench / App / tools 拆分 PR 序列                          |
| **W3** | 7–9   | Harvey/Word              | docx TC MVP + 单 DMS OAuth + Matter 时间线 Tab                      |
| **W4** | 10–12 | 架构守住 + 借鉴收口      | 契约 CI、REFERENCE 状态表、queue dependsOn、文档对齐                |

**合并门禁**（第十二期整体验收）：

```bash
pnpm lawmind:verify
LAWMIND_BENCHMARK_STRICT=1 pnpm lawmind:release-readiness -- --out dist/lawmind-release-readiness.md
pnpm lawmind:desktop:e2e:pr
pnpm lawmind:quarterly-demo
```

发布报告须同时满足：`Benchmark gate: pass`、Quality Dashboard 非「暂无」、黄金旅程 Required commands 全部在 verify 链中。
