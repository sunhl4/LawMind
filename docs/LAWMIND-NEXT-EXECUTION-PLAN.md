# LawMind 下一步执行计划（产品化收敛 Sprint）

> **目标**：把「能试点」收成「律师打开就能稳定交件、越用越像自己人」。  
> **原则**：少堆功能面；收束 Solo 默认体验；证明一条黄金旅程；记忆可管可核。  
> **创建**：2026-07-15  
> **关联**：全面 review（对话结论）、`LAWMIND-OPTIMIZATION-BACKLOG.md`、`LAWMIND-VISION.md`

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

### 验收

- [x] 无端点不产生 claims，有明确缺源文案。
- [x] 有端点时 claims 均带 sourceIds。

### 后续（非本计划阻塞）

真实北大法宝 / Lexis 等语料对接、鉴权与配额。

---

## 执行记录

| 日期       | 项                     | 状态 |
| ---------- | ---------------------- | ---- |
| 2026-07-15 | 本计划落盘             | ✅   |
| 2026-07-15 | P0-1 … P0-5            | ✅   |
| 2026-07-15 | P1-1 加权召回          | ✅   |
| 2026-07-15 | P1-2 双写巡检          | ✅   |
| 2026-07-15 | P1-3 Orchestrator 硬化 | ✅   |
| 2026-07-15 | P2-1 权威检索适配层    | ✅   |

**本文件所列 P0 / P1 / P2 项已全部完成。**
