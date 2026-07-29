# LawMind 下一步执行计划（产品化收敛 Sprint + 工程水位）

> **目标**：把「能试点」收成「律师打开就能稳定交件、越用越像自己人」。  
> **原则**：少堆功能面；收束 Solo 默认体验；证明一条黄金旅程；记忆可管可核。  
> **创建**：2026-07-15  
> **现行冲刺（2026-07-28 晚）**：[§ 工程水位 → 可合并 9.0 + 产品信任](#工程水位--可合并-90--产品信任-2026-07-28)（独立复评 eng **≈8.7** / product **≈8.2**；旧「工程 9.5」自评作废）  
> **历史冲刺（已完结）**：[§ 工程水位 → 9.5](#工程水位--95-2026-07-25)（Track A DoD 代码项仍有效，分数以最新独立复评为准）  
> **关联**：[`LAWMIND-ENGINEERING-REVIEW.md`](LAWMIND-ENGINEERING-REVIEW.md)、`LAWMIND-OPTIMIZATION-BACKLOG.md`、`LAWMIND-FUTURE-ISSUES.md`、`LAWMIND-EXTERNAL-INTEGRATIONS.md`、`LAWMIND-VISION.md`

---

## 0. 优先级总览

| 批次   | ID   | 主题                    | 验收一句话                               | 预估   | 状态 |
| ------ | ---- | ----------------------- | ---------------------------------------- | ------ | ---- |
| **P0** | P0-1 | 冷启动一条线 + 用语统一 | 配完模型后自然进首跑；用户只见「文书台」 | 0.5–1d | ✅   |
| **P0** | P0-2 | Solo IA 收束            | 顶栏默认：对话 / 在办 /（进阶）协作      | 0.5d   | ✅   |
| **P0** | P0-3 | 黄金旅程 e2e            | 填表→澄清→文书台→验收可见可测            | 1d     | ✅   |
| **P0** | P0-4 | 偏好可管 + 本轮可核     | 交办卡可清除习惯；回复可解析已应用 id    | 1d     | ✅   |
| **P0** | P0-5 | 统一记忆采纳            | Inspector / 学习队列同一真相源           | 1d     | ✅   |
| **P1** | P1-1 | 检索升级（FTS/加权）    | 跨案/Golden 命中率可测提升               | 2–3d   | ✅   |
| **P1** | P1-2 | 双写一致性巡检          | matter JSON ↔ CASE 无 silent drift       | 1–2d   | ✅   |
| **P1** | P1-3 | Orchestrator 硬化       | 工具轮次拆分 + 并发审批无竞态            | 2d     | ✅   |
| **P2** | P2-1 | 权威检索适配层          | 无源显式缺源，不编造法条                 | 专项   | ✅   |

---

## P0（已完成）

详见历史任务拆解：用语统一、Solo 协作隐藏、黄金旅程 e2e、偏好清除、统一采纳队列。验收项均已勾选。

---

## P1-1 检索升级（加权召回）

### 目标

跨案 CASE / Golden 样例召回可测提升；优先「争点/风险」段落与正文命中。

### 已落地

1. `src/lawmind/memory/similar-case-recall.ts`：章节加权（核心争点 > 风险 > …）+ 短语加分；`recallAtK` 评测辅助。
2. `src/lawmind/evaluation/golden-recall.ts`：正文权重 > 标题；交付类型匹配加分。
3. 单测：争点信号案 Recall@1；Golden 正文命中优先于标题噪声。

### 验收

- [x] 加权后「争点命中」优于进度噪声（单测）。
- [x] Golden 正文匹配优先于标题-only。

---

## P1-2 双写一致性巡检

### 目标

matter.json（真相）↔ CASE.md §1 投影无 silent drift；Doctor 可修。

### 已落地

1. `checkMatterConsistency` 新增 `status_drift`（当前阶段 vs `matterStatusLabel`）。
2. 别名 `checkMatterCaseConsistency`。
3. `scheduleMatterProjection` 失败写审计 `matter.projection_failed`。
4. 单测覆盖 status_drift；既有 Doctor「从 JSON 重建 CASE.md」可修复。

### 验收

- [x] status / title drift 可检出。
- [x] 投影失败有审计信号。

---

## P1-3 Orchestrator 硬化

### 目标

工具轮次可维护；并发批 pendingApproval 不丢、不覆盖。

### 已落地

1. 抽出 `src/lawmind/agent/turn-orchestrator-tool-round.ts`（`executeToolBatches`）。
2. `requiresApproval` 工具强制非并发安全。
3. 并发批 **first-wins** 写入 `pendingToolApproval`。
4. 单测：两工具同时 pending → 保留先完成者。

### 验收

- [x] 工具批逻辑独立模块。
- [x] 并发审批竞态有测试覆盖。

---

## P2-1 权威检索适配层

### 目标

无权威库时显式缺源；有端点时映射为 ResearchSource/Claim（claims 必须带 sourceIds）。

### 已落地

1. `src/lawmind/retrieval/authority-adapter.ts`：`createAuthorityAdapterFromEnv`。
2. 未配置 `LAWMIND_AUTHORITY_ENDPOINT`：`research.legal` / `hybrid` 等 → `missingItems` 含「不得编造」。
3. 配置后：`GET {endpoint}?q=` → hits → sources + claims。
4. 接入 `buildAdaptersFromEnv`；导出 `createAuthorityAdapterFromEnv`。
5. `authority-health.ts`：URL 校验（http/https、禁 URL 内凭证）、Doctor/health 同步摘要、`probeAuthorityEndpoint`；无效端点 fail-closed 不外呼。
6. Doctor / 设置页 live 展示未配置 · 配置无效 · 已配置（host）。

### 验收

- [x] 无端点不产生 claims，有明确缺源文案。
- [x] 有端点时 claims 均带 sourceIds。
- [x] 非法 URL 不发起 fetch，并进入缺源/拒答路径。

### 后续（非本计划阻塞）

真实北大法宝 / Lexis 等语料对接、鉴权与配额（配置合法 `LAWMIND_AUTHORITY_ENDPOINT` 即可接线；仓库内不伪造公共法条语料）。→ 见下文 **Track B**。

---

## 执行记录（产品化收敛 Sprint · 已完结）

| 日期       | 项                     | 状态 |
| ---------- | ---------------------- | ---- |
| 2026-07-15 | 本计划落盘             | ✅   |
| 2026-07-15 | P0-1 … P0-5            | ✅   |
| 2026-07-15 | P1-1 加权召回          | ✅   |
| 2026-07-15 | P1-2 双写巡检          | ✅   |
| 2026-07-15 | P1-3 Orchestrator 硬化 | ✅   |
| 2026-07-15 | P2-1 权威检索适配层    | ✅   |

**上表所列产品化收敛 P0 / P1 / P2 项已全部完成。** 下文为 **2026-07-25** 起的工程水位冲刺（独立复评基线）。

---

## 工程水位 → 9.5（2026-07-25）

> **主键入口**（避免与 ENGINEERING-REVIEW 双源细节）：本文件写冲刺；评分基线与 backlog ID 权威表在 [`LAWMIND-ENGINEERING-REVIEW.md`](LAWMIND-ENGINEERING-REVIEW.md)。  
> **基线（独立复评）**：综合 ≈**7.9/10**；工程可合并 ≈**8.2–8.4/10**。此前自评 ≈9.5 **作废**。  
> **原则**：不平行开产品方向；对齐 OPTIMIZATION / FUTURE；Track B（外接权威）不阻塞 Track A 宣称工程 9.5。

### Track 分离

| Track | 目标 | 是否阻塞「工程 9.5」宣称 |
| ----- | ---- | ------------------------ |
| **A** | 仓库内工程/评审可合并质量 → **9.5/10** | 是（本计划） |
| **B** | 产品信任 + 外接权威语料（北大法宝/Lexis 等） | **否**；gated by 凭证/合同/配额（OPTIMIZATION **P0-1 残余**）；闭源执行计划见 [`LAWMIND-EXTERNAL-INTEGRATIONS.md`](LAWMIND-EXTERNAL-INTEGRATIONS.md) |

### Track A · Definition of Done（宣称 9.5 前必须全部 ✅）

| # | 验收标准 | ID / 证据 |
| - | -------- | --------- |
| A1 | `POST /api/approvals/resolve`：CAS 输家返回 **HTTP 409** + `ok:false` + 稳定 error code（如 `approval_conflict`）；赢家 200 | **R-P0-6** · `lawmind-server-route-action-summary.ts` |
| A2 | `resolveApproval` API 可区分「本请求写入」vs「已是终态输家」（勿再对输家静默返回同记录当成功） | **R-P0-6** · `approval-service.ts` |
| A3 | **真并发**测：至少 2 个并行 resolve（`Promise.all` / worker 持锁竞争），断言唯一状态翻转；**删除或改写**串行 `map` 伪并发测 | **R-P0-6** · `approval-service.test.ts` + route 测 |
| A4 | ENGINEERING-REVIEW §0 分数与独立复评一致，且无「已达 9.5」措辞直至本 DoD 全绿 | **R-P0-7** · 已于 2026-07-25 校正基线 |
| A5 | `rewriteJsonl`：temp 文件写完 + `rename`（或等价 atomic replace）；崩溃/半写不留下撕档 JSONL；有单测 | **R-P1-9** · `adapters/matter-storage/io.ts` |
| A6 | `MatterTeamMeetingPanel.tsx` **≤800 行**（逻辑外提到已有 Materials/session-storage 模式） | **R-P1-10** |
| A7 | `LawmindSettingsModelRetrieval` 权威 live（未配置 / 无效 / 已配置）有组件测，覆盖面对齐 Doctor | **R-P1-11** |
| A8 | 覆盖率 ratchet：`statements` 地板 **≥48.0**（自 44.87 起至少 +3pt；branches/functions/lines 同步合理上调） | **R-P2-2** · `scripts/pre-commit/coverage-baseline.json` |
| A9 | 双真相：**至少一条高风险写路径单口写入**（优先 deliverable review stamp 或 approvals JSONL），Doctor 检出码仍绿；禁止「只检不收敛」宣称完成 | **R-P2-7** |
| A10 | 神模块门禁：**Electron `main.mjs` ≤1200**（完整 ≤800 可留残余）**或** 已拆出 ≥3 个职责模块且 main 仅组装；`FileWorkbenchView.tsx` **≤700** | **R-P2-6** / **R-P2-4** |
| A11 | 独立复评或同等严格复评：工程可合并 **≥9.5**；文档分数同步上调（禁止自评抢跑） | 复评记录写入 ENGINEERING-REVIEW 附录 |

**明确不在 Track A DoD**：真实厂商权威语料、鉴权、配额、法条命中率（→ Track B）。

### Gap 矩阵（相对 9.5）

| Gap | 当前证据 | 目标态 | 为何挡 9.5 | 工作量 | 风险 | 表面 |
| --- | -------- | ------ | ---------- | ------ | ---- | ---- |
| CAS HTTP 仍 200 | `resolveApproval` 输家返回已有记录；route 一律 `sendJson(..., 200, { ok: true })` | 输家 409 + 路由/服务测 | 客户端误判签批成功；信任缝 | **S** | 低（契约变更需 UI 处理 409） | engine + desktop server |
| 伪并发测 | `approval-service.test.ts`「concurrent」为串行 `map` | 真并行竞争 + 单翻转 | 测试谎言抬高分数 | **S** | 低 | engine |
| 评分诚实 | 附录曾写 ≈9.5；独立 ≈7.9/8.2–8.4 | 基线已校正；达线后再改分 | 文档双真相 | **S** | 无 | docs · **R-P0-7 ✅** |
| 非原子 JSONL 重写 | `rewriteJsonl` → `writeFileSync` | temp+rename + 测 | 崩溃撕 approvals/queue | **S–M** | 中（全平台 rename 语义） | engine · R-P1-9 · FUTURE §1 |
| Meeting 1182 | `MatterTeamMeetingPanel.tsx` | 主文件 ≤800 | 可维护性天花板 | **M** | 中（回归 e2e meeting） | desktop · R-P1-10 |
| ModelRetrieval 无权威组件测 | 仅 `LawmindSettingsDoctor.test.tsx` | ModelRetrieval 同构测 | 设置页回归盲区 | **S** | 低 | desktop · R-P1-11 |
| 覆盖率 ~48% | floors statements **48.0** | ≥48.0 ratchet | — | **M** | 低 | engine/desktop · R-P2-2 · **✅ 2026-07-26** |
| 双真相：检≠写 | `matter-consistency` / `task-draft-consistency` 只读 | 高风险字段单写口 | 「守卫完备」名不副实 | **M–L** | 高（写路径面广） | engine · R-P2-7 |
| Electron 1778 | `electron/main.mjs` | ≤1200（理想 ≤800） | 神模块 | **L** | 中（打包/IPC） | electron · R-P2-6 |
| FileWorkbench 仍重 | View ~890 / Impl ~833 | View ≤700 | 可维护性 | **M** | 中 | desktop · R-P2-4 |
| Fleet 家庭 ~2k | Panel 754 + Detail/Aside/… | 主面板保持 ≤800；家庭不再回涨；非 Track A 硬门 | 结构债 INFO | — | — | desktop（守成） |
| 外接权威语料 | 适配层+health 齐；无厂商语料 | 真源命中或明确合同缺口 | **不挡 Track A** | 专项 | 高（商务/合规） | Track B · OPTIMIZATION P0-1 |

### 阶段计划（严格顺序）

#### Phase 0 — Honesty + Correctness（先做完才能宣称「在冲 9.5」）

| 项 | ID | 依赖 |
| -- | -- | ---- |
| 文档基线校正 | R-P0-7 | 无 · **已完成 2026-07-25** |
| 审批 CAS → 409 + 服务层输家语义 | R-P0-6 | R-P0-7（避免边改边吹） |
| 真并发 + route 测 | R-P0-6 | 上条 API 形状稳定 |

**Exit criteria**

- [x] A1–A3 全绿
- [x] `pnpm exec vitest run src/lawmind/application/services/approval-service.test.ts apps/lawmind-desktop/server/lawmind-server-route-action-summary.test.ts`
- [x] 渲染层对 409 有明确处理或既有 toast/错误路径（无静默当成功）

**Stop**：若 UI 大量假设 `ok:true` 即成功且改不动 → 停在契约设计，勿只改服务层。

#### Phase 1 — Maintainability（神模块与持久化安全）

| 项 | ID | 依赖 |
| -- | -- | ---- |
| atomic `rewriteJsonl` | R-P1-9 | Phase 0（审批写路径测已稳，便于回归） |
| Meeting ≤800 | R-P1-10 | 无强依赖；勿与 Electron 大拆并行同一人 |
| ModelRetrieval 权威组件测 | R-P1-11 | 无 |

**Exit criteria**

- [x] A5–A7
- [x] `pnpm exec vitest run src/lawmind/adapters/matter-storage/`
- [x] `pnpm exec vitest run apps/lawmind-desktop/src/renderer/LawmindSettingsModelRetrieval.test.tsx`（新建）
- [x] Meeting 相关：`pnpm --filter lawmind-desktop typecheck`；触及 UI 时跑既有 meeting/e2e 子集
- [x] `wc -l apps/lawmind-desktop/src/renderer/MatterTeamMeetingPanel.tsx` → ≤800

**Stop**：Meeting 拆分导致行为分叉（双状态源）→ 回退提取，先补 session-storage 单测再拆。

#### Phase 2 — Consistency / Coverage（分数抬升的硬证据）

| 项 | ID | 依赖 |
| -- | -- | ---- |
| 覆盖率 +3pt | R-P2-2 | Phase 0–1 新测计入 |
| 双真相写路径收敛（高风险一条） | R-P2-7 | R-P1-9（JSONL 原子） |
| Electron main ≤1200 **或** 等价模块化 | R-P2-6 | 勿阻塞 R-P2-7；可并行另一人 |
| FileWorkbench View ≤700 | R-P2-4 | 可与 R-P2-6 二选一先做；**A10 要求两者门槛都碰到** |

**Exit criteria**

- [x] A8–A10（A8 覆盖率 statements **48.00%** ≥ 48.0 地板；A9/A10 ✅）
- [x] `pnpm test`（或至少 `pnpm exec vitest run src/lawmind/application/` + desktop 相关）
- [x] coverage ratchet 通过（floor statements **48.0**；实测 statements **48.00%** / branches **38.57%** / functions **44.89%** / lines **48.16%**）
- [x] `wc -l apps/lawmind-desktop/electron/main.mjs` / `FileWorkbenchView.tsx` 满足 A10

**Stop**：R-P2-7 若要「一次收敛全部双真相」→ **禁止**；只收敛一条高风险写口，其余留 FUTURE / 下轮。

#### Phase A11 — 独立复评（Track A 收官）

**Exit criteria**

- [ ] A11：独立/adversarial 复评；逐条打开 A1–A10 证据（非文档自评）；工程可合并 **≥9.0/10**（≥9.5 须独立复评书面认可，禁止自评抢跑）
- [x] `docs/LAWMIND-ENGINEERING-REVIEW.md` §0 + 附录 A11 记录同步
- [x] 本文件执行记录 A11 ✅（代码 DoD 全绿；分数以最新独立复评 ≈8.9 为准，**未达 9.5**）

#### Phase 3 — Authority-ready（Track B 准备，不阻塞 Track A）

| 项 | 关联 | 说明 |
| -- | ---- | ---- |
| 外接端点合同/鉴权/配额设计 | OPTIMIZATION **P0-1 残余** | 仓库内不伪造公共法条语料 |
| 契约探测已具备 | `authority-health` / `probeAuthorityEndpoint` | Doctor + 设置页「探测权威端点」按钮已接线（`POST /api/authority/probe`） |
| 验收 | 已知法条查询 → 真命中或显式合同缺口 | **不**写入 Track A DoD |

**Exit criteria（Track B only）**：厂商联调记录 + 律师向缺源/命中文案；ENGINEERING-REVIEW「产品信任」轴单独改分。

### 验证命令（按阶段复用）

```bash
# Phase 0
pnpm exec vitest run src/lawmind/application/services/approval-service.test.ts \
  apps/lawmind-desktop/server/lawmind-server-route-action-summary.test.ts

# Phase 1
pnpm exec vitest run src/lawmind/adapters/matter-storage/ \
  apps/lawmind-desktop/src/renderer/LawmindSettingsDoctor.test.tsx \
  apps/lawmind-desktop/src/renderer/LawmindSettingsModelRetrieval.test.tsx
pnpm --filter lawmind-desktop typecheck

# Phase 2
pnpm test
pnpm --filter lawmind-desktop typecheck
# 覆盖率地板（以仓库 scripts 为准）
node scripts/pre-commit/check-coverage-ratchet.mjs

# 宣称 9.5 前
# 1) Track A DoD A1–A11 全勾
# 2) 更新 ENGINEERING-REVIEW §0（仅在独立复评后）
```

### 停止条件（全局）

1. 为抬分而写「假并发 / 假覆盖」——立即停，删测。
2. 文档分数先于 DoD 勾选上调——违反 R-P0-7，回滚文档。
3. Track B 厂商工作挤占 Phase 0–1——降级为旁路，不占冲刺主线。
4. 单 PR 同时大拆 Meeting + Electron + 双真相——拆单，防不可审。

### 执行记录（工程 9.5）

| 日期       | 项                         | 状态 |
| ---------- | -------------------------- | ---- |
| 2026-07-25 | 独立复评基线写入 + R-P0-7  | ✅   |
| 2026-07-25 | 本冲刺章节落盘             | ✅   |
| 2026-07-26 | Phase 0 R-P0-6（A1–A3）    | ✅   |
| 2026-07-26 | Phase 1 R-P1-9/10/11（A5–A7） | ✅   |
| 2026-07-26 | Phase 2 R-P2-4/6/7（A9–A10） | ✅   |
| 2026-07-26 | Phase 2 R-P2-2（A8）       | ✅ statements **48.00%**；`coverage-baseline.json` 地板 44.87→48.0 |
| 2026-07-26 | Phase 3 Track B（接线就绪） | ◐ `LAWMIND_AUTHORITY_API_KEY` Bearer + probe/retrieve；厂商语料仍 gated |
| 2026-07-26 | A11 独立/adversarial 复评  | ✅ Track A **代码** DoD 全绿；分数曾写 9.5 → **2026-07-28 晚校正 ≈8.7** |
| 2026-07-26 | post-A11：linkDraft 不覆盖 stamp | ✅ `deliverable-service` stampLocked 合并 |
| 2026-07-28 | WARN 闭环（SSRF DNS / 水印 / 拒起草） | ✅ 代码+单测；**不**自动等于合并分 9.5 |
| 2026-07-28 晚 | 独立复评 + 新冲刺落盘 | ✅ eng **≈8.7** / product **≈8.2**；见下节 |

---

## 工程水位 → 可合并 9.0 + 产品信任（2026-07-28）

> **主键**：本文件写冲刺；评分权威在 [`LAWMIND-ENGINEERING-REVIEW.md`](LAWMIND-ENGINEERING-REVIEW.md) §0（**2026-07-28 晚**独立复评）。  
> **基线**：工程可合并 **≈8.9/10**；产品信任 **≈8.5/10**（2026-07-29 优化落地轮；上轮 07-28 晚 ≈8.7/≈8.2 已被附录三/四收敛超越）。此前文档「工程 9.5」**作废**（代码闸门成立 ≠ 干净可合并 9.5）。  
> **原则**：先整理合并面与复验证据，再抬工程分；产品信任升到 9.0+ **必须** Track B 真源或等价可核对语料——**不得**用工程抛光冒充。  
> **诚实边界**：开源 open-law ≠ 法宝；sample / 演示 CORPUS 不得声称「已核实法条」。

### 1. Current baseline（现实一段话）

仓库内权威路径（`provider=open`）、SSRF（hostname + DNS→私网）、演示语料结果级水印、高风险拒起草、验收包水印、审批 CAS 409、review stamp SSOT 等 **代码与 focused 单测已到位**。Solo IA / Doctor 权威 live 可用。当前真正挡「干净可合并」的是：**巨型未整理工作树**、**全量 Vitest / coverage / e2e 未在本轮复验**、覆盖率地板裕度薄、Markdown↔JSON 其余双写、DNS rebinding 未 pin。挡「产品信任 9.0+」的是：**无厂商真源 / 无经许可的大 CORPUS / 无自建 caseopen 盘**（USER-gated），不是再写一层 Banner。

### 2. Goals（1–2 sprint）

| 轴 | 目标 | 非目标 |
| -- | ---- | ------ |
| **工程可合并** | **≥9.0/10**（独立复评）；理想冲 **9.2** 若全量绿+PR 面干净 | 不为抬分写假测；不宣称 9.5 除非复评书面认可 |
| **产品信任** | 开源诚实水位守住 **≥8.2**；有 USER CORPUS/NPC 试点后冲 **8.6–8.8**；**9.0+ 仅当 Track B 真源联调** | 不做法宝 parity 叙事；不把 sample 当完整法库 |

### 3. Tracks

#### Track A — Engineer-only（无 USER 密钥）

| Pri | ID | 项 | Owner | Why | DoD | Deps |
| --- | -- | -- | ----- | --- | --- | ---- |
| **P0** | N-A0 | **合并面整理**：按主题拆可审变更集（authority / desktop IA / docs），去掉无关噪声进 PR | Engineer | 脏树是合并就绪主扣分 | `git status` 可按 PR 叙述；每 PR ≤合理文件数；CI 相关路径有测试绿 | 无 |
| **P0** | N-A1 | **全量回归证据包** | Engineer | 分数必须挂证据 | `pnpm test` 全绿；`pnpm --filter lawmind-desktop typecheck`；`pnpm test:coverage` + ratchet；e2e 子集至少 `authority-mock` + `golden-path`（或 `e2e:pr`）绿；结果写入 ENGINEERING-REVIEW 附录日期 | N-A0 至少开权威/引擎 PR 后 |
| **P0** | N-A2 | **覆盖率裕度** statements 实测 ≥ **48.5**（或地板提到 48.3 且实测 ≥地板+0.5） | Engineer | 地板 48.0 + tol 0.5 易抖 | ratchet 绿 + 附录记录 statements/branches | N-A1 |
| **P1** | N-A3 | **中风险 demo 策略收紧或显式产品确认** | Engineer | 仅 `high` 拒起草；medium 可带水印出稿 | 二选一 DoD：(a) `medium` 也拒自动起草；或 (b) UI/验收包强制二次确认文案 + 单测锁定现状为「有意」 | 无强依赖 |
| **P1** | N-A4 | **外部 CORPUS 默认偏保守** | Engineer | 未标 `demo` 的 CORPUS 可当非演示进高风险起草 | 默认：无 `licenseNote`/许可字段时打「许可未确认」riskFlag；或要求 `LAWMIND_OPEN_LAW_CORPUS_DEMO=0` 显式确认；Doctor 文案对齐；单测 | open-law README |
| **P1** | N-A5 | **双写再收敛一条** | Engineer | `client_drift` 只检不写 | 再选一条高风险写口单源（如 task↔deliverable 或 CASE title 投影失败审计已有则选 write）；Doctor 码仍绿；禁止「一次全收」 | R-P2-7 模式 |
| **P1** | N-A6 | **chat-shell / Fleet 家庭守成** | Engineer | ~791 / ~2k 可维护性 INFO | 主文件不回涨；若改 IA 则顺手抽 1 个 seam + 单测；非硬门 | 勿与 N-A0 大拆并行 |
| **P2** | N-A7 | DNS rebinding **连接层 pin**（可选） | Engineer | 解析后改指仍 INFO | 设计短文 + 或 fetch 前二次 resolve / undici connector；有测；**不**阻塞 9.0 | SSRF 已有 hostname+DNS |
| **P2** | N-A8 | 文档分数纪律 | Engineer | 防再抢跑 | 任何 ≥9.0 上调必须附独立复评段落 + 命令证据；CI/脚本不写死「9.5」营销句 | N-A1 |

#### Track B — USER-gated（密钥 / 合同 / 大语料 / 自建盘）

| Pri | ID | 项 | Owner | Why | DoD | Deps |
| --- | -- | -- | ----- | --- | --- | ---- |
| **P0** | N-B0 | **试点 CORPUS**：用户自备经许可 JSONL + `LAWMIND_OPEN_LAW_CORPUS` | USER | 抬产品信任最便宜的真源路径 | Doctor=`configured`；已知条文命中；高风险可起草且**无**演示水印；律师抽查官库一致 | convert 脚本已有 |
| **P0** | N-B1 | **NPC 直播试点** `LAWMIND_OPEN_LAW_NPC=1` | USER | 官方公开检索 | 限流可接受；命中可引用；失败 fail-closed；记录联调笔记 | 网络；遵守站点规则 |
| **P1** | N-B2 | **caseopen 自建**索引盘 + `CASEOPEN=1` | USER | 类案路径 | loopback 检索绿；磁盘/许可自担；不把公网 demo 当 CI | 本机/内网主机 |
| **P1** | N-B3 | **法宝 C0 合同 + Token**（或威科） | USER | 产品信任 **9.0+** 主路径 | 见 [`LAWMIND-EXTERNAL-INTEGRATIONS.md`](LAWMIND-EXTERNAL-INTEGRATIONS.md) Phase C0–C1；联调记录；**无** parity 宣传 | 商务 |
| **P2** | N-B4 | 商业 BFF 真部署 | USER | 平台额度 | stub→真 session/search；密钥不进桌面；OSS 构建仍不依赖 | `apps/lawmind-commercial-bff/` |

#### Track C — Deferred / won't without new info

| 项 | 原因 |
| -- | ---- |
| 法宝 / Lexis **功能 parity** 宣传 | 无合同与完整 API 面；违反诚实边界 |
| 自动下载无 LICENSE 的 GitHub/HF 大包进默认树 | 许可风险；仅 manual convert |
| 一次收敛全部 Markdown↔JSON 双写 | 面过大；按条写口收敛 |
| DNS rebinding 完美 soft-pin（若成本过高） | 可留 INFO；不挡 9.0 |
| Firm DMS / 企查 / SSO | 非本 sprint；见 EXTERNAL-INTEGRATIONS P2 |
| 为抬分并行大拆 Meeting+Electron+双真相 | 已有停止条件；禁止 |

### 4. 什么抬产品信任 → 9.0+ vs 只抛光工程分

| 动作 | 主要抬哪轴 |
| ---- | ---------- |
| N-B0/B1/B3 真源命中 + 律师可核对 | **产品信任**（唯一到 9.0+ 的主路） |
| N-A3/A4 更保守的 demo/CORPUS 默认 | 产品信任小幅（8.2→~8.4）+ 工程 |
| N-A0/A1/A2 整理+全量证据 | **仅工程**（8.7→9.0+） |
| N-A5/A6/A7 双写 / 体积 / rebinding | **仅工程**（可维护/安全抛光） |
| 再写 Banner / Doctor 文案而不接真源 | **不**抬产品信任到 9.0 |

### 5. Suggested sequence

```
Week 1 — Merge surface + evidence
  N-A0 拆 PR → N-A1 全量+typecheck+coverage+e2e 子集 → N-A2 裕度
  并行文档：ENGINEERING-REVIEW 只记证据，不抢分

Week 2 — Trust defaults (engineer) + USER 试点启动
  N-A3 + N-A4（CORPUS/中风险策略）
  USER 启动 N-B0（CORPUS）和/或 N-B1（NPC）
  可选 N-A5 一条双写

Week 3 — Independent re-score
  工程目标 ≥9.0（有全量证据）
  产品：若 B0/B1 成功 → 冲 8.6–8.8；若 B3 法宝联调 → 再谈 9.0+
  N-A6/A7 仅在有余力

Stop：文档先写 ≥9.5；或 Track B 宣传「已接法宝」而无联调记录。
```

### 6. 验证命令（本冲刺复用）

```bash
# 权威 / 开源路径（每次权威 PR）
pnpm exec vitest run src/lawmind/retrieval/authority-url-guard.test.ts \
  src/lawmind/retrieval/authority-health.test.ts \
  src/lawmind/retrieval/authority-gap.test.ts \
  src/lawmind/retrieval/providers/open-law/ \
  src/lawmind/agent/tools/engine-tools.test.ts \
  src/lawmind/agent/tools/engine/engine-tool-shared.test.ts

# 合并宣称前
pnpm test
pnpm --filter lawmind-desktop typecheck
pnpm test:coverage   # + ratchet
# e2e：authority-mock + golden-path 或 lawmind:desktop:e2e:pr
```

### 执行记录（本冲刺）

| 日期 | 项 | 状态 |
| ---- | -- | ---- |
| 2026-07-28 晚 | 独立复评校正 eng≈8.7 / product≈8.2；本计划落盘 | ✅ |
| — | N-A0 … N-A2 | 待办 |
| — | Track B N-B0/B1 | 待 USER |
