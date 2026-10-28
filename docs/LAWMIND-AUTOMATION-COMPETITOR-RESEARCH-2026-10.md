# 全自动化法律服务：竞争实现调研与 LawMind 落地边界（2026-10）

- 日期：2026-10-22
- 分支：`feat/automation-parity`（worktree `../LawMind-automation`）
- 口径：公开材料 + GitHub；厂商数字未独立验证，不作对外准确率承诺
- 交叉：[`LAWMIND-MEWORK-COMPETITOR-REVIEW.md`](LAWMIND-MEWORK-COMPETITOR-REVIEW.md)、[`LAWMIND-ACCEPTANCE-LAYER-STRATEGY.md`](LAWMIND-ACCEPTANCE-LAYER-STRATEGY.md)、[`LAWMIND-SINGLE-PARENT-AGENT.md`](LAWMIND-SINGLE-PARENT-AGENT.md)、[`GOALS.md`](../GOALS.md)

---

## 0. 中心结论

行业没有「无人律所」意义上的全自动。最好的实现都是：

> **可验证的长时程工作流 + 人拍板闸门 + 可回指的交付物。**

竞争轴已从「谁生成得更像律师」转到「每个律师小时能产出多少份可采信交付物」。三个 2026 信号：

1. Harvey 收购 Guardrails AI——长时程 agent 的瓶颈是验证；
2. CoCounsel 下一代建在 Claude Agent SDK 上——harness 比模型更值得买；
3. LawFairy 用确定性规则引擎拿 SRA 牌照——强监管场景可解释规则胜于概率模型。

**LawMind 定位（本分支）**：中国法律工作的本地自动化执行层——可规则化环节用确定性对象与编排，判断留给人，产出可回指、可提交。目标自动化等级 **L3.5**；不做 L5 持牌主体。

**合入 main 的安全承诺**：默认路径（对话助手 / 工作台 / 单写者修订）行为不变；新能力挂显式入口与 `LAWMIND_RULE_BRANCH_WRITE`（默认关）。

---

## 1. 自动化阶梯 L0–L5

| 等级 | 定义                              | 代表                                                |
| ---- | --------------------------------- | --------------------------------------------------- |
| L0   | 检索/问答                         | 传统法律检索                                        |
| L1   | 单步生成                          | 文书起草                                            |
| L2   | 多步工作流，人逐步驱动            | Clio / Filevine、docassemble                        |
| L3   | 端到端 agent：计划→执行→自检→交付 | Harvey、Legora、CoCounsel、法宝灵境、得理、MeWork   |
| L4   | 后台常驻 / 事件驱动               | EvenUp PLAAS、Harvey 定时 Workflow、Legora Monitors |
| L5   | 持牌自动化法律服务主体            | Garfield、LawFairy、Crosby                          |

多数中国产品停在 L2–L3 却用 L5 话术。LawMind 目标：L3.5。

---

## 2. 全球玩家（摘要）

| 赛道         | 最好的实现                          | 值得学的点                                                     |
| ------------ | ----------------------------------- | -------------------------------------------------------------- |
| 通用平台     | Harvey                              | orchestrator-worker、文档分支合并、Agent Builder、LAB all-pass |
| 协作审查     | Legora                              | aOS harness、Tabular Review、evals 张量                        |
| 权威绑定     | CoCounsel / Protégé                 | 权威源 + 引用校验 + Agent SDK                                  |
| 单场景端到端 | EvenUp                              | demand package、行级引用、PLAAS 托管                           |
| AI 原生律所  | Garfield / LawFairy / Crosby        | 按件计价、持牌、保险、逐步授权 / 确定性规则                    |
| 中国工作空间 | 法宝灵境                            | 可知/可信/可控、Skills+Agents+MCP                              |
| 中国一体化   | 得理                                | 数据底座 + 案源 + 开放平台                                     |
| 律所自研     | 盛廷 / 大成 Arbiter                 | 场景纵深；Tauri 本地卷宗                                       |
| 开源         | OpenContracts / aiworkdeck / lavern | 审批单元格、三方合并、多 agent 验证                            |

细节与来源见文末 §9。MeWork 单点深评不重复，见 MeWork 文档。

---

## 3. Harvey 深挖（工程可抄部分）

### 3.1 两代架构

第一代：固定 prompt pipeline（分类瀑布 → 检索 → 摘要 → 单 clause 回红）。可预测但上下文断裂、不能跨段、规则互相矛盾。

第二代选型：

| 方案                         | 质量      | 延迟         | 复杂度   |
| ---------------------------- | --------- | ------------ | -------- |
| 规则化 LLM workflow          | Moderate  | Excellent    | Low      |
| 单 agent                     | Excellent | Unacceptable | Moderate |
| **orchestrator + subagents** | Excellent | Good         | High     |

内部结果（厂商自述）：风险分类 59%→77%；回红 rubric 53%→87%；延迟 2.6→3.8 分钟。

### 3.2 编排契约

- 分解单位 = **playbook 规则**（不是章节）；
- worker 是 agent 不是 function（会追附件）；
- 文档组件唯一 ID；
- 共享 deal context（纸别、立场、严格度、先例）；
- worker 在**独立分支**上写 tracked change，打上规则标签；
- 非冲突自动合，冲突升级 lead；
- 状态持久化，支持追问/换立场/部分重审；
- 生产六件套：phase timeout、定向重试、并发限流、prefix cache、流式结果、按任务选模型。

### 3.3 文档 agent

法律文本一等公民；模型在内存文档上迭代；`get_diff` 自检；XML/状态机在确定性代码；edit accept rate 相对 +40%（厂商自述）。

### 3.4 LAB + all-pass

500 个 in-house contracting 任务；Environment / Instruction / Output / Verification；**all-pass**（漏一个红旗即整题失败）。Rule & Reason 批评：AI 评委信息有限、换评委分数会变——分数是开发信号不是采购证据。LawMind 必须配人工抽检。

---

## 4. 中国战场（摘要）

- **法宝灵境**：任务空间 + 可知可信可控 + MCP。
- **得理**：数据 + 案源 + Skills/MCP 开放。
- **MeWork**：多模态证据核对领先；云执行面与本地闭环结构张力——见 MeWork 深评。
- **盛廷**：场景纵深，25 分钟庭前包（自述）。
- **大成 Arbiter Copilot**：Tauri 本地卷宗，「争点—事实—材料」——与 LawMind 本地优先同向。
- **法院一张网**：要素式起诉状、电子卷宗随案生成；「AI 生成 + 法官逐项确认」被接受。对厂商：做 filing-ready，勿幻想绕过法院系统。

---

## 5. 开源基线

| 仓库                         | 用途                                                |
| ---------------------------- | --------------------------------------------------- |
| OpenContracts                | 文档 agent、Fieldset 审批、citation graph           |
| aiworkdeck                   | tracked changes、evidence jump、三方合并（A3 必读） |
| lavern                       | 辩论 + 10-pass 验证模板（无公开 benchmark）         |
| docassemble                  | 确定性问卷组装                                      |
| LegalAgentBench              | 中文 300 任务 / 37 工具 / 过程进度率                |
| ThomasMore legal-skills-open | skill 数量已商品化——数量不是护城河                  |

---

## 6. 七个判断

1. 全自动 = 可验证长时程工作流，不是无人律所。
2. 竞争轴 = 有效交付 × 可审计性 × 责任承接。
3. Harness > model。
4. 验证/仿真是一等公民。
5. 确定性 + 概率性混合是强监管正解。
6. 交付物最后一公里（Word 保真、法院格式）决定续费。
7. 中国变量：法院基建、权威源、本地合规、律所自研——勿照搬 Harvey 内容护城河。

---

## 7. LawMind 映射：已有 subagent ≠ Harvey orchestrator-worker

### 7.1 已具备（勿重造）

| 能力                                       | 入口                                         |
| ------------------------------------------ | -------------------------------------------- |
| `draft_worker`（review/draft/explore）     | `agent/tools/legal/draft-worker-tool.ts`     |
| review 子工产出 patch（find/replace/span） | `agent/draft-worker.ts`                      |
| 同回并行（`isConcurrencySafe`）            | 工具定义                                     |
| anchor / binds 认知层融合                  | `agent/factor-state.ts`                      |
| 委派深度/并发限流                          | `collaboration/delegation-registry.ts`       |
| 最短改动硬不变量                           | `drafts/minimal-edit-script.ts`              |
| 修订保真指纹                               | `drafts/word-revision/preservation.ts`       |
| 人类基准 rubric                            | `evaluation/human-baseline.ts`               |
| 单父助手产品决策                           | `docs/LAWMIND-SINGLE-PARENT-AGENT.md`        |
| 合同三档散文                               | `skills/builtin/contract-playbook-review.md` |

### 7.2 四处结构性差距

| Harvey            | LawMind 现状      | 本分支补什么                                          |
| ----------------- | ----------------- | ----------------------------------------------------- |
| 规则级分解        | 分解靠模型/anchor | **A2** `ReviewRule` + `planRuleReview`（引擎派 N 支） |
| worker 文档分支写 | worker 严格只读   | **A4** flag `LAWMIND_RULE_BRANCH_WRITE` 默认关        |
| 编辑层冲突合并    | 只有认知层融合    | **A3** `mergeBranches`                                |
| 覆盖由引擎保证    | 派几支由模型定    | **A2** `missingRuleIds`                               |

一句话：有 orchestrator-，缺规则对象；有 -worker，缺写分支；有融合，缺合并。

### 7.3 合 main 对律师助手的影响

默认路径（对话、工作台、单写者修订）**不得变坏**。新路径仅：显式规则审查入口；或打开分支写开关。详见计划 A7 回归清单。

---

## 8. 落地计划与分支边界

- **A0** worktree `feat/automation-parity`（纪律，不进任何分支）
- **A1** 本文 + GOALS 指针（可 docs PR 到 main）
- **A2** `src/lawmind/review/` 规则对象 + 12 条 v0（branch）
- **A3** `drafts/branch.ts` 合并（branch）
- **A4** worker 分支写，flag 默认关（branch）
- **A5** all-pass 扩 `BaselineCriterion`（branch）
- **A6** phase timeout / 定向重试 / 流式 `rule_result`（branch）
- **A7** 验收报告；仅文档与报告可回 main（门槛）
- **A8** 规则级 all-pass 夹具（20 例）+ `lawmind:allpass` CLI（branch）

**A8 口径**：夹具是合成的，只校验量规与评分接线；`--arm oracle` 的 20/20 是自检通过，不是模型分数。真实模型臂未接线前，不得对外引用任何 all-pass 数字。

**不做**：审计台账对外化当卖点、Vault 军备、无人律所叙事（与 `GOALS.md` §二 冲突）。

**首场景**：合同审查（买卖合同 / NDA），规则来自 `contract-playbook-review` 底线项 × 纸别。

---

## 9. 来源与不确定性

### 9.1 主要来源

- Harvey 工程博客：Playbook multi-agent（2026-09）、docx agent（2026-03）、Agent Builder、LAB contracting（2026-06）、Guardrails 收购（2026-09）
- ZenML LLMOps 拆解；Rule & Reason Evidence & methods（2026-09）
- Legora aOS / Agent / evals 工程文
- EvenUp PLAAS；Garfield / LawFairy / Crosby / Lawhive
- 法宝灵境发布；得理品牌升级；盛廷 / 大成公开材料
- 最高法在线运行规则；广东全域数字化办案通报
- GitHub：OpenContracts、aiworkdeck、lavern、LegalAgentBench、docassemble

### 9.2 不确定性

- 厂商准确率与规模数字未独立验证；
- Harvey 合并算法 / 模型路由 / 单次成本未公开；
- 中国产品数据多来自 PR；
- 市场按月变化，建议每季度复核 §1–§2。

---

## 10. 维护

本分支推进时更新 §8 勾选状态。合 main 前必须：开关默认关 + cassette 绿 + Word preservation 绿 + 日常助手 5 分钟手工回归。
