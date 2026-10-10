# LawMind 判断层 · 商用化交付计划（G0–G6）

> **状态**：计划定稿（2026-09-21）。**G0 / G1 / G2 / G3 已完成**（见 §1.1b – §1.1e）。
> **上游**：[LAWMIND-DECISION-LAYER.md](./LAWMIND-DECISION-LAYER.md)（调研与方案空间）· [LAWMIND-DECISION-LAYER-PLAN.md](./LAWMIND-DECISION-LAYER-PLAN.md)（P0 计划与实测）· [LAWMIND-LEGAL-COMPILER-ROADMAP.md](../LAWMIND-LEGAL-COMPILER-ROADMAP.md)（编译器本体）· [AGENTS.md](../../AGENTS.md) · [RELEASE-CHECKLIST.md](../../apps/lawmind-desktop/RELEASE-CHECKLIST.md)。
> **本文性质**：**交付计划**，不是调研、不是切片。目标是判断层达到「可装、可用、可交付律所、可回归、可运维、可回滚」的商用状态。
> **一句话**：把「用 LLM 判每一项」改成「**每一项都先问：这东西该由谁来判**」；判据分级、逐项可观测、按战绩解锁、编译产物自持。

---

## 0. 什么算「商用级」——完工定义（DoD）

商用不是形容词，是一张可核对的单子。**下表任一项不满足，不得对外宣称判断层已达商用**。

| #   | 维度                | 完工定义                                                                       | 校验方式                                                                                                                                                                                                              |
| --- | ------------------- | ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | **功能完整**        | 全部 150 个检查单项都有明确判定主体；无「未分类」、无「暂时按 judge 兜底」     | 分级表全覆盖断言（§3.4）✅ G0 已达标                                                                                                                                                                                  |
| D2  | **机械项真机械**    | 每个 machine 项由代码判，**不进提示词**；验证器不可用一律 fail-closed          | 单测 + cassette 断言「下一个请求体」                                                                                                                                                                                  |
| D3  | **可观测**          | 每项的支持率 / 逃逸率 / 冲突率 / 升级率可查，可按项、族、edition 分维          | `decision-samples` 报告 + doctor 面板                                                                                                                                                                                 |
| D4  | **按战绩解锁**      | 任何项从 advisory 升 blocking，必须有达标序列 + 对照序列 + 未过期证书          | `isJudgmentItemUnlockable` 单测 + 审计记录                                                                                                                                                                            |
| D5  | **可回滚**          | 任何 blocking 行为可在**不停机、不改数据**下退回 advisory；回滚不重建规则包    | 回滚演练一次并留记录                                                                                                                                                                                                  |
| D6  | **三 edition 可用** | solo / firm / private_deploy 各有明确的默认姿态与端到端测试                    | 三 edition 姿态单测 ✅ + **三档真机 e2e ✅**（2026-09-22 补：同一种子 × solo/firm/private_deploy，断言界面姿态随档位变化；另加「策略文件覆盖」一条 —— 它是唯一能区分「policy 显式」那一档接线与否的用例，变异验证过） |
| D7  | **出所可用**        | 换一家所（不同 pole、不同族）不因过拟合失效；解锁粒度含 edition                | 跨族/跨所抽审                                                                                                                                                                                                         |
| D8  | **可出网合规**      | 运行期判定零出网；任何外部通道默认 `off` 且 `offline` 时结构性不可用           | 策略单测 + 端到端断言                                                                                                                                                                                                 |
| D9  | **测试齐**          | 新函数全单测；每个失效路径一条；门禁/编排改动带 cassette；关键路径 e2e         | CI 矩阵全绿                                                                                                                                                                                                           |
| D10 | **可发布**          | 过 `pnpm lawmind:release-readiness`；过 `RELEASE-CHECKLIST` 的判断层条目       | 发布门禁                                                                                                                                                                                                              |
| D11 | **可运维**          | 每个新告警有 runbook；证书过期 / 棘轮回锁 / 验证器不可用三类事件在 doctor 可见 | runbook 审阅 + 演练                                                                                                                                                                                                   |
| D12 | **文案合规**        | 律师可见面无工程师语言、无概率数字、无模型名；过 `lawmind:ui-copy-lint`        | 文案 lint                                                                                                                                                                                                             |
| D13 | **法律验收**        | 每条新规则 / 每条从 advisory 升 blocking 的项，有法律顾问签收记录入审计        | §11 的验收工件                                                                                                                                                                                                        |
| D14 | **性能预算**        | guardian 段 P95 不上升；转 `on` 后下降；提示词字节数下降 ≥25%                  | §9 的 SLO 面板                                                                                                                                                                                                        |

---

## 1. 现状（逐行核实，2026-09-21）

### 1.1 已落地

| 项                                                | 落点                                                                                                                      | 状态                                                                                                                                         |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| P0-1 决策语料导出器 + P0-3 体检报告               | `src/lawmind/metrics/decision-samples.ts`                                                                                 | 已落地                                                                                                                                       |
| P0-2 逃逸读取端（4 个 reader）                    | `src/lawmind/metrics/lint-escape-candidates.ts`                                                                           | 已落地                                                                                                                                       |
| P0-4a `facts_grounded` 按实测否决「升为 blocker」 | `src/lawmind/deliverables/reasoning-validator.ts`                                                                         | 已落地                                                                                                                                       |
| P0-4b 权威冲突改「同主题 × 不同权威」             | `src/lawmind/reasoning/legal-graph.ts`                                                                                    | 已落地                                                                                                                                       |
| P0-4c 特权提示改结构化评估                        | `src/lawmind/policy/privilege-sentinel.ts`                                                                                | 已落地                                                                                                                                       |
| P0-4d 条款类型三份漂移副本合并                    | `src/lawmind/clause/clause-type-keywords.ts`                                                                              | 已落地                                                                                                                                       |
| P2.1 严格 JSON Schema + 端点能力回落              | `src/lawmind/llm/json-schema-capability.ts` · `llm/openai-json.ts`                                                        | 已落地                                                                                                                                       |
| P2.2 逐项判定 → 代码聚合                          | `src/lawmind/guardian/legal-guardian.ts`（`aggregateGuardianItems` / `parseGuardianVerdict` / `guardianExpectedItemIds`） | 已落地                                                                                                                                       |
| P2.3 三路径分歧 shadow · P2.4 升级描述符          | `src/lawmind/router/route-divergence.ts` · `router/model-route.ts`                                                        | 已落地（默认 shadow；分歧触发时路由管线**已**返回 `requiresConfirmation`——但真实分歧记录目前为 **0**，这条升级路径尚未在真实数据上被触发过） |
| **G0 判据分级全套**                               | `guardian/judgment-tier.ts` · `item-judgments.ts` · `machine-verifiers.ts` · `policy/judgment-tiering.ts`                 | **已落地（本计划 G0）**                                                                                                                      |

> P0–P2 已于 2026-09-21 由并行会话提交（`b37e87664` / `6eabfc290`）。G0 在其之上落地，
> 未修改任何既有判定口径——**`aggregateGuardianItems` 不传 machine 时行为逐字不变**，
> 由 `machine-aggregate.test.ts` 的"向后兼容"用例锁住。
>
> **⚠️ 提交状态更正**：本文件写作时 G0–G3 的代码与测试**一直躺在工作区、从未提交**
> （`git status` 里全是 `??` / `M`）。此前任何「已合入 main」的说法**都不成立**；
> 它们由本轮收口（同一 `main` 分支）的提交一并入库。

### 1.1b G0 交付清单（本次已完成）

| 交付物                               | 落点                                    | 说明                                                                                               |
| ------------------------------------ | --------------------------------------- | -------------------------------------------------------------------------------------------------- |
| 判据分级模型 + 三条 fail-closed 纪律 | `guardian/judgment-tier.ts`             | 未声明→judge；缺 verifier→降 judge；lawyer 项不得被验证器认领                                      |
| **150 项完整分级表**                 | `guardian/item-judgments.ts`            | machine 21 / lawyer 17 / judge 112，每项带 rationale                                               |
| **11 个机器验证器 + 注册表**         | `guardian/machine-verifiers.ts`         | 全是既有 lint 规则 / 门禁字段 / 图谱字段的薄适配层，零新依赖                                       |
| 三态门控 + 验证器停用（自动回滚）    | `policy/judgment-tiering.ts`            | 默认 `shadow`；停用后其项**降回 judge**（不是失效放行）                                            |
| 聚合层 machine 规则                  | `guardian/legal-guardian.ts`            | 新增 `machine_unavailable` / `machine_not_covered` / `tier_conflict` / `machine_duplicate_verdict` |
| 三段运行顺序接线                     | `guardian/run.ts`                       | machine 判 → judge 问模型 → lawyer 升级；`on` 时机械项**不进提示词**                               |
| `lens` 判据补齐（修复缺口三）        | `guardian/types.ts` · `guardian/run.ts` | `GuardianChecklistItem.lens`，模型终于能看到该项的法条                                             |
| 测试                                 | 4 个测试文件                            | 43 条验证器 + 33 条分级/聚合 + 128 条 guardian 全绿                                                |

### 1.1e G3 交付清单（本次已完成）

| 交付物                  | 落点                                                                           | 说明                                                                         |
| ----------------------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| **论证结构五条**        | `deliverables/reasoning-validator.ts`                                          | 争点有依据 / 论证可追溯 / 权威在正文被引 / IRAC 三级齐 / 无未决问题          |
| 覆盖不完整可自述        | `deliverables/types.ts`                                                        | `ReasoningReport.skippedChecks`——拿不到正文引用时**记 skipped，不判通过**    |
| 升级卡构造器            | `platform/requires-action.ts`                                                  | `buildJudgmentEscalationAction` + 新 kind `judgment_escalation`              |
| 升级通道读取            | `platform/judgment-escalation.ts`                                              | 从 Guardian sidecar 读待定夺项；`formatJudgmentCoverageNote` 覆盖自述        |
| 三 edition 姿态         | `policy/judgment-tiering.ts`                                                   | `resolveEscalationPosture`：solo → advisory；firm / private_deploy → block   |
| 决策头覆盖行            | `delivery/decision-header.ts` + `types.ts`                                     | `judgmentCoverage` + `formatJudgmentCoverage`；全零时不显示                  |
| 标签派生                | `delivery/judgment-labels.ts`                                                  | **从既有检查单派生**，不手写 150 条（防漂移，P0-4d 的同类教训）              |
| API 四条路由            | `server/lawmind-server-route-judgment.ts`                                      | `/api/judgment/{summary,task,escalations,tiering}`；**待定夺项剥掉内部 id**  |
| UI 两个组件             | `renderer/LawmindJudgmentEscalationCard.tsx` · `LawmindJudgmentItemsPanel.tsx` | 加载/空/错误三态齐；**读失败不说"暂无事项"**                                 |
| **收尾接线**            | `agent/turn-orchestrator-finalize.ts`                                          | 通道开 + 姿态 `block` 时把卡片并进 `requiresAction`；**`advisory` 时不打断** |
| **真实回合 cassette**   | `agent/judgment-escalation-cassette.test.ts`                                   | 断言回合结束后 `requiresAction` 里**真的有**这张卡（4 例）                   |
| 测试台补 `linkedTaskId` | `agent/testkit/test-lawmind.ts`                                                | 不补则「卡有没有被并进去」**无法被准入测试覆盖**——等于没测                   |
| 决策头组件扩展          | `renderer/LawmindDecisionHeader.tsx`                                           | 显示覆盖自述行                                                               |

**G3 修掉的两个自造缺陷**（都是实现时被测试/复核抓出来的）：

1. **`lawyer` 项排除未按 mode 收口**：升级通道一开就会在 `off` / `shadow` 期
   把主观项从提示词里偷走——那是**静默的行为改变**，正是 shadow 要防的。
   已补 `mode === "on"` 前置，并加 **off / shadow 两条回归**。
2. **`store.stripRaw` 是白名单式的**：`escalationItems` 不加进去就会**静默丢失**，
   升级卡永远读不到东西。已补 + 一条专门回归。

**测试基线**（2026-09-21 复核，命令与口径一起写在这里，便于复算）：

| 命令                                                         | 结果                                                     |
| ------------------------------------------------------------ | -------------------------------------------------------- |
| `npx vitest run src/lawmind`                                 | **584 文件 / 3777 例通过，0 失败**（1 文件 / 3 例 skip） |
| `pnpm test`（engine + desktop 全量）                         | **843 文件 / 4965 例通过，0 失败**（1 文件 / 3 例 skip） |
| `pnpm typecheck` · `pnpm --filter lawmind-desktop typecheck` | 干净                                                     |
| `pnpm lawmind:ui-copy-lint`                                  | 386 文件，未豁免命中 0（豁免 5）                         |
| `pnpm lawmind:check:renderer-node`                           | 321 模块，无 node 内建                                   |

> **注意**：本文件旧版把不同范围的数字并列（如「574 文件 / 3519 例」与「583 文件 / 3701 例」
> 其实是不同时刻、不同范围的两次跑），容易被误读成同一次回归。**引用测试数字时请连命令一起写。**

**G3 原有的两处欠账——已于 2026-09-21 补齐（详见下方 §1.1f）**：

1. **真机 Electron e2e**：已补 `e2e/judgment-escalation-electron.spec.ts`，跑在
   `playwright.electron.config.ts`（= `pnpm lawmind:desktop:e2e:electron`）。
2. **`advisory` 下的可见性**：已补「旁路展示」——待定夺卡挂在**改稿台**（审核台元信息列），
   没有待定夺项时整块不出现，读不到时照样出声。文案随姿态变（`advisory` 不打断 /
   `block` 已停下），姿态由服务端 `escalationPosture` 给出。

> 补齐过程中另外发现一处**比原记录更严重**的问题：那张卡在应用里**根本没有挂载点**
> （只在单测里被渲染过）。也就是说第 2 条不只是「solo 看不到」，而是**谁都看不到**。
> 这正是本仓反复批评的「实现了但没接线」，已一并修掉，并补了变异验证
> （把挂载点注释掉，真机用例确实失败）。

### 1.1f G3 欠账补齐（2026-09-21，第二十期收口）

| 交付物                   | 落点                                                                                                             | 说明                                                                                                                                   |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| 待定夺卡**旁路展示**     | `renderer/LawmindJudgmentEscalationCard.tsx`（`variant="inline"`）                                               | 没有待定夺项时**整块不出现**；**读不到时照样出声**（故障不得冒充「没有」）                                                             |
| 挂载点（**原本不存在**） | `review/ReviewWorkbenchMetaColumn.tsx`                                                                           | 挂在决策头之后。改稿台正是律师要签批、要看见「还有哪几处没定」的地方                                                                   |
| 姿态口径由服务端给       | `server/lawmind-server-route-judgment.ts`                                                                        | `/api/judgment/task` · `/api/judgment/escalations` 新增 `escalationChannel` / `escalationPosture`，与引擎同源；取值写坏时按 `block` 说 |
| 文案随姿态变             | 同上                                                                                                             | `advisory`：签批前确认（**不打断当前流程**）；`block`：已停下等确认                                                                    |
| **真机 Electron e2e**    | `e2e/judgment-escalation-electron.spec.ts`                                                                       | 写**真实形状**的 Guardian sidecar → 真实本地服务 → 真实路由 → 界面。引擎→路由→界面整条链的准入测试                                     |
| PR 套件 e2e              | `e2e/judgment-escalation.spec.ts`（已进 `lawmind:desktop:e2e:pr`）                                               | 四态：advisory / block / 空 / 读不到                                                                                                   |
| 单测（12 例）            | `LawmindJudgmentPanel.test.tsx` · `ReviewWorkbenchMetaColumn.test.tsx` · `lawmind-server-route-judgment.test.ts` | 含「审核台**真的挂了**这张卡」三例——防的正是「组件写好了、没人挂」                                                                     |

**变异验证**：把挂载点注释掉后，真机用例确实失败（`toBeVisible` 超时）——证明它测的是接线，
不是组件自身的渲染能力。

> `judgment-escalation-electron.spec.ts` 不计入默认（浏览器）套件：它需要先
> `lawmind:bundle:desktop-server` + `build:renderer`，属 electron 作业
> （`playwright.config.ts` 的 `testIgnore` 已注明）。

### 1.1c G1 / G2 交付清单（本次已完成）

| 交付物                 | 落点                                           | 说明                                                                                           |
| ---------------------- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| 分级 cassette（12 例） | `guardian/tiering-prompt.test.ts`              | 断言**哪些项进提示词**：off/shadow 下 machine 项在、`on` 下不在、停用后回来                    |
| 截断顺序修复           | `guardian/run.ts` `buildMachineStage`          | 先摘机械项**再**截断，名额回填给 judge 项（修覆盖率漏洞）                                      |
| lawyer 项丢失闸门      | `policy/judgment-tiering.ts`                   | `isLawyerEscalationAvailable()` 默认 **false**；升级卡（G3）未接通前 lawyer 项**继续由模型判** |
| 逐项结果落盘（20 例）  | `guardian/item-outcome.ts`                     | `guardian-item-outcomes.jsonl` + 容错读 + 按任务聚合 + 报告                                    |
| **棘轮缺陷修复**       | `guardian/item-outcome.ts` `deriveFiredByTask` | `cleanDelivery` **必须外生**；信号缺失整条不产出（详见 §4.1b）                                 |
| 信号缺失可见性         | `countTasksAwaitingExternalSignal()`           | 让「通路没接通」不被误读成「规则质量不够」                                                     |

### 1.1d G2 收口：外生验收信号（已解锁棘轮）

| 交付物                          | 落点                              | 说明                                                                                            |
| ------------------------------- | --------------------------------- | ----------------------------------------------------------------------------------------------- |
| 交付事件两个新字段              | `metrics/runtime-events.ts`       | `interruptionReason`（SEAL 观察面）+ `humanAcceptance`（外生信号，**三态**）                    |
| 判定函数（纯函数，可单测）      | `metrics/runtime-events.ts`       | `resolveDeliverSignals()`：自动交付（`system:`）**不算验收**                                    |
| 交付点接线                      | `engine/rendering.ts`             | 喂事实，不猜结论                                                                                |
| 外生信号读取与组装（20 条测试） | `metrics/unescalated-delivery.ts` | `deriveCleanDeliveryByTask` / `summarizeExternalSignalCoverage` / `collectJudgementSeriesInput` |

**棘轮现在真的会转了**（端到端测试锁定）：

- 缺外生信号 → `series` 为空（**正确**：不给假数据）；
- 信号接通 + 误报率超上限 → `false_positive_rate_above_cap`，**不升**（回归那个缺陷）；
- 信号接通 + 样本足够 + 顾问已验收 + 零误报 → `promotable: true`（真的能产出）。

**三处刻意收窄**（都是为了"不猜"）：`humanAcceptance` 用三态而非布尔；
自动交付不算外生验收；**删掉初稿的 `judgmentSummary` / `itemSnapshot`**——
在交付点拿不到、别处又有更细的真相源，**留一个填不上的字段就是本仓自己批评的"哑字段"**。

### 1.2 判断层的真实缺口

**缺口一：检查单项没有「判定主体」这一栏。**

`src/lawmind/guardian/types.ts`：

```typescript
// src/lawmind/guardian/types.ts:55-60
export type GuardianChecklistItem = {
  id: string;
  look: string;
  edit?: string;
  stop: string;
};
```

后果：**一个「有没有同时约定管辖与仲裁」的形式判断，和一个「这版措辞妥不妥」的裁量判断，走同一条最贵的路径。**

**缺口二：判断面规模未被量化。** 实测今天的分类面（2026-09-21 逐项统计）：

| 来源                                                  | 项数    |
| ----------------------------------------------------- | ------- |
| `platform/word-revision-packs.ts`（9 个合同族）       | **125** |
| `deliverables/verification-checklist.ts`（6 个 spec） | **25**  |
| **合计**                                              | **150** |

⚠️ **两处实测修正**（初稿写的是 10 / 135，已核正）：

1. verification checklist 是 **25** 项而非 10 项（初稿的正则计数漏掉了多行条目）。
2. **`citations` 与 `sources` 在不同 spec 里重复出现**（`citations` 见 contract-review-v1 /
   learning-brief-v1 / general-v1；`sources` 见 compliance-dossier-v1 / training-ppt-v1）。
   故判定表**不能用裸 itemId 作键**，verification 类必须用 `<specId>/<itemId>`
   （见 `guardian/judgment-tier.ts` 的 `verificationKey`）。

**缺口二之补充（G0 实测，比预想重要）：清单的机械化空间远小于预期。**
初稿假设 machine 项能占 30%。**实测只 21 项 / 150 项 = 14%**，原因是清单的性质：
125 个 word-revision 条项是「看/改/停」**实质审查提示**（如"对赌：现金补偿或回购；
义务主体是股东还是目标公司"），天然需要语义判断；而仓库里真正机械化的部分在 `lint/`，
**它本来就在独立运行**。

想让比例上升，唯一正当路径是**在 G4 写新规则并通过法律顾问验收**，不是改分级
（改分级会把主观项误标成 machine —— 见风险 D8）。

**缺口三：`lens`（法条依据）被丢弃。** `WordRevisionChecklistItem` 有 `lens` 字段（写的是规范依据），但 `guardian/run.ts` 构造 `GuardianChecklistItem` 时**没有带上**——模型判「诚信」类项时看不到该项对应的法条，判据被削弱。**G0 已修复**（`GuardianChecklistItem.lens` + `checklistForDraft` 带上）。

**缺口四：逐项结论不出 sidecar。** `itemVerdicts` 只进 `drafts/<taskId>.guardian.json`，不进指标，因此**棘轮学不到"哪一项最容易漏"**。

**缺口五：外生验收信号缺失。** `approvals.jsonl` 只覆盖**走到拍板**的动作；被静默放行的动作不产生标签。于是「machine 判过 → 未升级 → 律师后来默默改掉」这条逃逸**永远不被记录**。

### 1.3 依赖数据的两档（诚实标注）

P0 实测（见 PLAN §3.5）：`escape-*.jsonl` 在真实工作区**产出为零**；`approvals.jsonl` 只有 **1 条且 pending**。因此：

- **P1 飞轮接线**（G4）依赖真实办件语料；
- **P3 校准**（G5）依赖数百样本。

这两档的**代码可写、可测、可 shadow**，但**不能宣布"已越用越准"**。G0–G3 与 G6 **不依赖任何历史数据**，是本计划的主干。

---

## 2. 架构主张与商用不变量

### 2.1 主张

商用化的核心动作**不是换更强的模型**，而是给每个判断项定级：

```text
machine  → 确定性代码判（零模型调用、零方差、零延迟、可 diff）
judge    → 模型逐项判（结论仍由代码聚合）
lawyer   → 不判，聚合为「需您定夺」升级卡
```

这一步同时改善 **成本 / 方差 / 延迟 / 可审计 / 可回归** 五个指标，方向一致。工程上罕见，是因为它减少的不是"模型的工作量"，而是**模型判断面本身**。

### 2.2 十四条不变量

任何工作包违反其中一条，即使指标更好也**不合并**。

| #   | 不变量                                                                                    | 校验                                                    |
| --- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| I1  | **fail-closed**：判定器不可用 / 缺答 / 编造项 id / 冲突未决，一律判不过                   | 每条失效路径一条单测                                    |
| I2  | 判定器**不生成正文**；大模型**不出门禁结论**                                              | 代码审查 + cassette                                     |
| I3  | **主观项永不编译**，只升级                                                                | `LAWYER_ONLY_ITEM_IDS` 编译期防呆                       |
| I4  | 判定结果与规则**不进 `matters/*.json` 真值位**（概率不是事实）                            | 存储层断言                                              |
| I5  | **审计 hash-chain 仍恰好六字段**；新字段只进 `detail` 或 sidecar                          | `audit/hash-chain.ts` 哈希回归                          |
| I6  | 改**门禁 / 编排 / 升级通道**必须加 cassette                                               | `turn-orchestrator-cassettes.test.ts`（AGENTS.md 契约） |
| I7  | 规则必须有 `effectiveFrom` + `source` + **法律顾问验收**；缺一不得升 blocking             | `lint/statute-params.ts` 口径 + §11 验收工件            |
| I8  | **任何 edition 读任何 workspace**；edition 只决定显隐，不改数据结构                       | 跨 edition 读测试                                       |
| I9  | 外部判定通道默认 **`off`**，且 `egressMode: offline` 时**结构性不可用**（不靠配置记得关） | 策略单测 + 端到端                                       |
| I10 | 判定器开关必须是**自己的字段**，不搭 `egressMode` 的车                                    | 策略单测                                                |
| I11 | 新判断默认 **shadow / advisory**，只记录不改行为                                          | 三态门控单测                                            |
| I12 | 报告**自述覆盖**（"本次机械核对 N 项"），不得把覆盖率说成法律正确性                       | 文案 + 报告断言                                         |
| I13 | 不静默落盘规则——一律走 `memory/adoption-service.ts` 待确认队列                            | 代码审查 + 队列测试                                     |
| I14 | 不因「更快更便宜」降级任何既有确定性门禁                                                  | 代码审查（违规即回退）                                  |

---

## 3. WP1 · 检查单项判据分级（核心交付）

### 3.1 交付物

**一张 150 行的分级表 + 一套强制机制**，不是抽样示范。**G0 已交付**：`src/lawmind/guardian/item-judgments.ts`。

```ts
// src/lawmind/guardian/judgment-tier.ts（新增）

/** 判定主体。顺序即严格程度。 */
export type JudgmentTier = "machine" | "judge" | "lawyer";

export type ChecklistItemJudgment = {
  itemId: string;
  tier: JudgmentTier;
  /** tier=machine 必填：machine registry 的验证器 id。 */
  verifier?: string;
  /** tier=lawyer 必填：为什么必须由人判（**律师可见面文案**，见 §8.3）。 */
  lawyerReason?: string;
  /** 判定该级别的依据（写给人看：为什么它不是模型判的）。 */
  rationale: string;
};
```

### 3.2 判定主体怎么定——决策程序（可复用于新项）

每一项按顺序过下面四问，**第一问命中即定级**：

```text
Q1 答案是否完全由「正文 + 检索快照 + 门禁事实」确定性推出？
   （金额一致性、引用闭合、日期顺序、存在性、形式合规）
   → yes → machine
Q2 是否涉及法律判断，但其判据可逐条枚举、且能在证据包里找到支撑或不支撑的痕迹？
   → yes → judge
Q3 是否需要商业取舍 / 价值权衡 / 案件策略，即「不同律师会给出不同答案」？
   → yes → lawyer（永不编译，只升级）
Q4 不确定 → judge（**保守方向**：宁可多问模型，不可少判）
```

**两个硬约束**：

1. `lawyer` 项**不得**出现在 machine registry（I3，编译期断言）。
2. tier 声明缺失 / 验证器不存在 → 降回 `judge` 并记 warning，**不得静默跳过**（I1）。

### 3.3 机器验证器目录（G0 实交付 11 个）

```ts
// src/lawmind/guardian/machine-verifiers.ts（新增）

export type MachineVerdict = {
  itemId: string;
  supported: boolean;
  /** 律师可读的判定依据（禁止工程师语言）。 */
  reason: string;
  /** 可追溯引用：确定性 finding / gates 字段。 */
  evidenceRef?: string;
  /** 判定器自身可用性。unavailable 必须 fail-closed（I1）。 */
  status: "ok" | "unavailable";
};

export type MachineVerifier = {
  id: string;
  /** 显式列举服务的检查单项。**禁止通配表达式**——分级必须逐项可审计。 */
  itemIds: readonly string[];
  /** 纯函数：只读证据包；不写盘、不出网、不调模型、不读时钟（除审计需要）。 */
  run: (pack: GuardianEvidencePack) => MachineVerdict[];
};
```

| #   | verifier id                  | 判什么                                                    | 复用哪个既有实现                                            | 失效模式               |
| --- | ---------------------------- | --------------------------------------------------------- | ----------------------------------------------------------- | ---------------------- |
| 1   | `citations.subset`           | 正文引用 ID 是否全在检索快照内                            | `gates.citationIntegrityOk` / `citationMissingIds`          | 快照缺失 → unavailable |
| 2   | `citations.used`             | 快照中的来源是否至少被一处引用（防装饰性引用）            | `pack.citations[].usedInHeadings`                           | —                      |
| 3   | `hunks.nonempty`             | 带修订轨交卷是否有非空 hunk                               | `gates.hunkCount` / `allowEmptyRedline`                     | —                      |
| 4   | `hunks.anchored`             | 每个 hunk 是否有可定位锚句                                | `GuardianHunkEvidence.anchor`                               | 正文缺失 → unavailable |
| 5   | `stop.mentioned`             | 「停」项是否在正文出现（存在性，非正确性）                | `clause/clause-type-keywords.ts` 的 `clauseTypeMentionedIn` | —                      |
| 6   | `look.mentioned`             | 「看」项关注点是否在正文被触及                            | 同上（`includeForumMentions` 口径）                         | —                      |
| 7   | `deferred.reasoned`          | 写者声明的缓办项是否都带理由                              | `writerDeferredClaims` 字段检查                             | —                      |
| 8   | `amounts.case_consistent`    | 金额大小写是否一致                                        | `lint/chinese-numeral.ts`                                   | 解析失败 → unavailable |
| 9   | `terms.defined_closed`       | 定义词「定义未用 / 用未定义」                             | `clause/lint.ts`                                            | —                      |
| 10  | `crossref.resolved`          | 交叉引用（第 X 条 / 附件 N）是否可解析                    | `clause/lint.ts`                                            | —                      |
| 11  | `numbers.sequential`         | 条款编号是否连续                                          | `clause/lint.ts`                                            | —                      |
| 12  | `dates.ordered`              | 日期逻辑顺序与期间自洽                                    | `reasoning/cn-date.ts`                                      | 无法解析 → unavailable |
| 13  | `statute.cap`                | 法定上限类（定金 20% 等）是否越界                         | `lint/statute-params.ts` + `lint/rules.ts`                  | 参数缺失 → unavailable |
| 14  | `statute.effective`          | 引用条文的现行有效性（无网时降级 warning）                | `lint/citation-validity.ts`                                 | 无网 → warning 非 fail |
| 15  | `forum.form_valid`           | 管辖/仲裁是否**同时**约定（形式无效的常见成因）           | 复用 `form.or_arbitrate_or_sue` 规则                        | —                      |
| 16  | `checklist.required_present` | `VerificationChecklistItemSpec.required` 项是否有正文痕迹 | 证据包 sections                                             | —                      |
| 17  | `graph.authority_used`       | 每个 `authorityIds` 至少被一个争点引用                    | `LegalReasoningGraph`                                       | 图缺失 → unavailable   |
| 18  | `graph.open_questions`       | `openQuestions` 非空时不得判收敛                          | `LegalReasoningGraph`                                       | —                      |

> **G0 实测修正**：初稿列了 18 个「候选」验证器，但**逐个核对后发现只有 11 个能诚实落地**
> ——初稿把不少项当成了"本来就有规则"，实际没有。已注册的 11 个（全部是既有规则的薄适配层）：
>
> | 验证器                    | 规则来源                                                |
> | ------------------------- | ------------------------------------------------------- |
> | `citations.subset`        | `gates.citationIntegrityOk` / `citationMissingIds`      |
> | `citations.used`          | `pack.citations[].usedInHeadings`                       |
> | `graph.authority_used`    | `ReasoningSnapshot.issueTree`                           |
> | `parties.consistent`      | `consistency.party_pair`                                |
> | `amounts.case_consistent` | `consistency.amount_case`                               |
> | `dates.ordered`           | `consistency.date_order`                                |
> | `placeholders.closed`     | `placeholder.open`                                      |
> | `statute.deposit_cap`     | `statutory.deposit_cap`（民法典第586条）                |
> | `statute.lpr_multiple`    | `statutory.lpr_multiple` / `lpr_legacy_rate`            |
> | `guarantee.form_valid`    | `form.guarantee_form_default` / `form.guarantee_period` |
> | `forum.form_valid`        | `form.jurisdiction` / `form.or_arbitrate_or_sue`        |
>
> 服务 **21 个检查单项**（14%）。初稿列的 `hunks.*` / `stop.mentioned` / `look.mentioned` /
> `deferred.reasoned` / `checklist.required_present` 等**没有对应的检查单项**可服务，
> 属自造需求；`terms.defined_closed` / `crossref.resolved` / `numbers.sequential` 同理。
> **不为了凑数登记没有条项可服务的验证器**——那是死代码。
>
> ⚠️ **一条实测发现（已避开，2026-09-21 复核并更正归因）**：`clause.dispute_missing`
> **不能**接进 `forum.form_valid`。但原因**不是**「没注入 patterns 导致识别不出」——
> 不传 patterns 时 `extractClauses` 走的就是 `defaultClausePatterns()`（与显式传入等价）。
> 真正的根因在 `clause/dsl.ts` + `clause/extract.ts` 的 `classifyClause`：
> ① `obligations()` 的触发词含单字**「应」**，而中文合同的争议解决条款几乎必然写成
> 「双方**应**提交…仲裁」；② `classifyClause` 按 patterns 顺序取**第一个**命中，而
> `dispute()` 排在 `obligations()` **之后**。于是该条款被认成义务条款，`dispute` 类缺失 →
> 报「未识别到争议解决条款」。真实 fixture
> （`fixtures/lawmind-round/purchase-contract.md`）与内联写法的短合同都能复现；
> 写法带小标题（「第二条 争议解决」）时才不误报。
> 可复现证据已固化为 `clause/lint.test.ts` 的「已知误报（供机器验证器决策引用）」用例——
> 修触发词/顺序需法律顾问复核，修好后那条用例会红，即「可以重新评估是否接入」的信号。
>
> **纪律**：每个验证器必须带 ①正向（未命中 → 通过）②反向（命中 → 未覆盖）
> ③**依赖规则失败 / 输入畸形 → `unavailable` 而非通过** 三条测试。第 ③ 条是 I1 的落地形态，
> 也是本工作包最容易被漏掉的测试。G0 共 **43 条**验证器测试（11 × 3 + 顶层 2 + fail-closed 8；
> 口径见 `guardian/machine-verifiers.test.ts` 的实际用例数）。

### 3.4 分级覆盖率断言（I3 + D1 的机械保障）

**G0 已落地**（`src/lawmind/guardian/item-judgments.test.ts`），四条断言：

```ts
// 1) 清单规模与登记的期望值一致——改了清单必须显式改期望值
expect(wordRevision).toBe(EXPECTED_WORD_REVISION_ITEMS); // 125
expect(verification).toBe(EXPECTED_VERIFICATION_ITEMS); // 25
expect(wordRevision + verification).toBe(EXPECTED_TOTAL_ITEMS); // 150

// 2) 清单里每一项都在判定表里分级了（未分级 => 测试红）
const missing = allChecklistKeys().filter((key) => !(key in ITEM_JUDGMENTS));
expect(missing).toEqual([]);

// 3) 判定表里没有已不存在的项（清单删项后要同步删表）
const orphans = Object.keys(ITEM_JUDGMENTS).filter((key) => !known.has(key));
expect(orphans).toEqual([]);

// 4) 判定表与验证器声明的 itemIds **双向一致**
expect([...v.itemIds].toSorted()).toEqual((byVerifier.get(v.id) ?? []).toSorted());
```

**用硬数字而不是"覆盖率百分比"**：新增检查单项时测试会红，逼作者同时给出分级。
这是把「分级不是可选项」变成机械约束的唯一办法。

**另外三条**（同样在 G0 落地）：

- 每个 machine 项必须有 verifier，且 verifier 必须在注册表里；
- 每个 lawyer 项必须有 `lawyerReason`，且**不得**被任何验证器认领（I3 编译期防呆）；
- machine 项数必须落在 `[18, 30]` 区间——下界防覆盖率悄悄归零，**上界防有人为了"看起来机械化"把主观项标成 machine**（风险 D8）。

### 3.5 运行顺序改造（`guardian/run.ts`）

```text
① machine 段  → machineVerifiers 跑；产出 MachineVerdict[]；**不进提示词**
② judge 段    → 只把 judge 项的 id/look/edit/stop/**lens** 放进证据包与提示词
③ lawyer 段   → 不判，直接产出「需您定夺」条目（WP4）
        ↓
aggregateGuardianItems 合并；expectedItemIds **只含 judge 项**
```

**顺带修复 §1.2 缺口三**：`GuardianChecklistItem` 增加 `lens?: string`，`checklistForDraft` 带上 `it.lens`——判据被补齐，且改动极小。

**收益**：judge 项数下降 → 证据包与提示词变短 → 模型在剩余项上更准（`context rot` 的实测结论）；机械项零成本、零方差、零延迟。

### 3.6 聚合规则（在既有 `aggregateGuardianItems` 上扩展）

| #   | 规则                                                                          | 类别     |
| --- | ----------------------------------------------------------------------------- | -------- |
| 1   | machine 项 `status: "unavailable"` → gap，fail                                | **新增** |
| 2   | machine 项 `supported: false` → gap，fail                                     | **新增** |
| 3   | machine 与 judge 对同一项双判且结论相反 → fail + 分歧记录（**仅 shadow 期**） | **新增** |
| 4   | judge 项未回答 → gap，fail                                                    | 既有     |
| 5   | 模型给出证据包里不存在的 item id → fail                                       | 既有     |
| 6   | lawyer 项**不参与 verdict**，只产出升级卡条目                                 | **新增** |
| 7   | `summaryGaps` 非空 → fail                                                     | 既有     |

> 第 3 条只在 `mode=shadow` 生效（用于测量一致率）；转 `on` 后同一项只由 machine 判，不再双跑。

### 3.7 三态门控

```ts
// src/lawmind/policy/judgment-tiering.ts（新增，沿用既有 posture 解析形状）
export function resolveJudgmentTieringMode(opts?: {
  policy?: { judgmentTiering?: string } | null;
  env?: NodeJS.ProcessEnv;
}): "off" | "shadow" | "on";
```

| mode     | 行为                                                                            |
| -------- | ------------------------------------------------------------------------------- |
| `off`    | 全部项按 `judge` 走。**不是**回退到模型下 verdict——那个口径已废弃               |
| `shadow` | machine 与 judge **双跑**，只记录一致率，verdict 仍按 judge（行为不变，零风险） |
| `on`     | machine 项由代码判、不进提示词；judge 项照旧                                    |

**默认 `shadow`。** 转 `on` 的门槛见 §3.8。

### 3.8 WP1（G0）验收

| 指标                     | 门槛                                                          | G0 实测                                                                                     |
| ------------------------ | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| 分级覆盖率               | **100%**，且 150 项硬断言                                     | ✅ 150/150                                                                                  |
| machine 项占比           | **按实测登记**，不设百分比目标（见 §1.2 的实测修正）          | 21/150 = **14%**                                                                            |
| **machine↔judge 一致率** | **≥95% 才允许该项转 `on`；<90% 的项禁止转**，转入 §6 或改判据 | ⏳ 需真实 shadow 数据                                                                       |
| 验证器测试               | 每个验证器 3 条（正 / 反 / 不可用）                           | ✅ 43 条（11 个验证器的 33 条 + 顶层 2 + fail-closed 8）                                    |
| 分级表测试               | 4 条覆盖率断言 + 9 条 tier 解析 + 12 条聚合                   | ✅ 33 条（`item-judgments` 12 + `judgment-tier` 9 + `machine-aggregate` 12）                |
| 提示词缩减               | judge 项数下降（转 `on` 后）                                  | ⏳ 待 `on` 后测                                                                             |
| 延迟                     | guardian P95 **不上升**；转 `on` 后应下降                     | ⏳ 待 `on` 后测                                                                             |
| cassette                 | 「哪些项进了提示词、哪些没进」各有断言                        | ⏳ G1                                                                                       |
| 回归                     | `pnpm test` + `test:full` 全绿                                | ✅ `npx vitest run src/lawmind` → 584 文件 / 3777 例通过，0 失败（另有 1 文件 / 3 例 skip） |

> **`≥30%` 这个门槛已被删除，这是有意的。** 百分比目标会激励误分类（把主观项标成
> machine 去凑数）——那正是风险 D8。正确的目标不是"machine 占多少"，而是
> **"所有真正可机械判定的项都被识别出来了"**。G0 的实测答案是 14%，
> 剩下的空间要靠 G4 写规则，不靠改分级。
>
> **提示词缩减目标也相应下调**：21/150 的机械项意味着 judge 项数下降约 14%，
> 不是 25%。要拿到更大的缩减，同样要走 G4。

---

## 4. WP2 · 逐项可观测性 + 外生验收信号 + 棘轮扩域

### 4.1 逐项结论落盘

**G2 已落地**：`src/lawmind/guardian/item-outcome.ts`。

```ts
export type GuardianItemOutcome = {
  ts: string;
  taskId: string;
  matterId?: string;
  deliverableType?: string;
  familyId?: string;
  /** **判定表键**（word-revision 为条项 id；verification 为 `<specId>/<itemId>`）。 */
  itemKey: string;
  tier: JudgmentTier;
  decidedBy: "machine" | "model" | "lawyer";
  /** `null` 表示该项本次**没有结论**（lawyer 项、或未回答）。不要用 `false` 冒充。 */
  supported: boolean | null;
  conflict?: boolean;
  unavailable?: boolean;
};
```

落 `workspace/lawmind/decision/guardian-item-outcomes.jsonl`（已在 `.gitignore`），
在 `runLegalGuardian` 的三条出口（machine-only / 模型成功 / machine 兜底）都写入。
容错读取：坏行跳过并计数，永不抛。

#### 4.1b ⚠️ 落盘时发现的**严重缺陷**（已修，必须记下来）

上一版 `deriveFiredByTask` 把 `cleanDelivery` 定义成「**本任务没有任何项报项**」。
这是**错的**，而且错得很危险：

`deriveJudgementItemSeries` 只在「本任务**恰好一项**报项 **且** `cleanDelivery`」时
才计入 `firedClean`。而那时该任务必然有项报项，于是 `cleanDelivery` **恒为 false** →
`firedClean` **恒为 0** → `falsePositiveRate` **恒为 0**。

后果：`isJudgementItemPromotable` 的误报率上限**永远拦不住任何东西**——
只要样本量够、法律顾问已验收，**每一项都会被判「可升 blocking」**。
这正是 §16 第 4 条警告的失败模式：把「从未观测到误报」当成「没有误报」。

**修正**：`cleanDelivery` **必须来自外生信号**，本模块**绝不自己推导**。
`deriveFiredByTask(ws, { cleanDeliveryByTask })` 只在调用方给出该任务的干净交付信号时
才产出记录；信号缺失的任务**整条不产出**——**宁可让棘轮没有数据（= 不升级），
也不要给它假数据（= 乱升级）**。

**由此得出一个必答问题：外生信号从哪来？** 就是下面 §4.2 的 `UnescalatedDeliveryEvent`。
它现在**仍然是缺的**，所以：

> `deriveFiredByTask(ws)` 在没有 `cleanDeliveryByTask` 时返回 `[]`。
> **这是正确行为，不是缺陷。** 为了让这个区别不被误读，新增
> `countTasksAwaitingExternalSignal(ws)` —— 它数的是「报了项、但缺外生信号」的任务数。
> Doctor 必须显示这个数字：否则「棘轮没有可升级项」会被误读成「规则质量还不够好」，
> 而真相是**信号通路根本没接通**。

这也把 §4.2 的优先级**从「重要」提到「阻塞」**：没有它，P4 棘轮虽然建好了，
但**永远不会产出任何可升级项**。

> 与 `decision-samples.jsonl` 的合并（`signal: "item_outcome"`）**尚未做**——
> 它需要同时改 `metrics/decision-samples.ts` 的信号枚举与来源报告，属独立切片。

### 4.2 外生验收信号 ✅ 已落地

[SEAL](https://arxiv.org/abs/2607.24300) 的结论：可靠自改进**需要一个 agent 无法控制、无法观察的接受/拒绝信号**。LawMind 有 `isAutonomyUnlocked` 双序列、有 cassette「耗尽必须 400」——原理已对，但存在真实盲区（§1.2 缺口五）。

**落地形态**（比初稿更收敛，理由见下）：

交付事件（`metrics/runtime-events.ts` 的 `recordDeliverEvent`）新增两个字段，
由 `engine/rendering.ts` 在**交付点**计算（`resolveDeliverSignals()`）：

| 字段                 | 取值                                                                    | 作用                                                |
| -------------------- | ----------------------------------------------------------------------- | --------------------------------------------------- |
| `interruptionReason` | `all_gates_green` / `advisory_only` / `escalation_disabled` / `unknown` | SEAL 的观察面：系统凭什么自己放行                   |
| `humanAcceptance`    | `accepted_clean` / `accepted_with_change` / `unknown`                   | **外生验收信号**（棘轮的 `cleanDelivery` 唯一来源） |

**三处刻意收窄（都为了"不猜"）**：

1. **`humanAcceptance` 是三态，不是布尔。** `unknown` 必须存在——律师还没审核时
   "他会不会改"是未知的。当成「不干净」会让每项被记成真报项（误报率虚低 → 乱升级）；
   当成「干净」则相反。**信号未到的任务整条不产出。**
2. **自动交付不算验收。** `reviewedBy` 以 `system:` 开头（`system:auto_deliver`）时
   `humanAcceptance` 一律 `unknown`——那是**判定器给自己判卷**，正是 SEAL 要防的。
3. **删掉了初稿的 `judgmentSummary` / `itemSnapshot`。** 它们在交付点拿不到、
   在别处又有更细的真相源（`guardian-item-outcomes.jsonl`）。
   **留一个填不上的字段就是本仓自己批评的"哑字段"**（`LAWMIND-DECISION-LAYER.md` §2.4）。

**新模块**：`metrics/unescalated-delivery.ts`

```ts
export function deriveCleanDeliveryByTask(workspaceDir: string): Map<string, boolean>;
export function summarizeExternalSignalCoverage(workspaceDir: string): ExternalSignalCoverage;
export function collectJudgementSeriesInput(workspaceDir, input): { series; coverage };
export function collectPromotableJudgementItems(workspaceDir, input): { ...promotable; coverage };
```

`collectJudgementSeriesInput` 是**唯一推荐的喂法**——它把 `cleanDeliveryByTask` 与
`deriveFiredByTask` 绑在一起，**避免调用方漏传外生信号**（那正是 §4.1b 缺陷的成因）。

**覆盖体检**回答一个在 Doctor 上看起来一样、处置却完全不同的问题：
**「棘轮没有可升级项，是规则质量不够，还是信号通路没接通？」**
`unknownReasons` 直接指出卡在哪一环（`0 ≠ null`：`decidedRatio` 为 `0` 是有交付但全不可判，
为 `null` 是连交付都没有）。

<details>
<summary>初稿设计（保留作对照）</summary>

```ts
export type UnescalatedDeliveryEvent = {
  taskId: string;
  matterId?: string;
  deliverableType?: string;
  reason: "all_gates_green" | "advisory_only" | "escalation_disabled" | "no_judge_items";
  itemSnapshot?: Array<{
    itemId: string;
    tier: JudgmentTier;
    decidedBy: string;
    supported: boolean | null;
  }>;
};
```

**要求**：每条 `deliver` 都必须能回答「这次为什么没打断律师」。这是**事实记录，不是标签**，不违反 I4。

</details>

### 4.3 棘轮扩域

`delivery/progressive-autonomy.ts:11` 的 `isAutonomyUnlocked` 已实现「测量换信任」，且刻意防「橡皮图章一次通过」。扩域**不新建机制**，只新增一层按项解锁：

```ts
// src/lawmind/delivery/judgment-autonomy.ts（新增，复用既有阈值解析）
export type JudgmentItemSeries = {
  itemId: string;
  tier: JudgmentTier;
  escapeRate: number | null;
  escapeSamples: number | null;
  escalatedRate: number | null;
  escalatedSamples: number | null;
  certificateValidUntil?: string | null;
};

export function isJudgmentItemUnlockable(input: {
  series: JudgmentItemSeries;
  thresholds: JudgmentAutonomyThresholds;
  now?: Date;
}): { unlocked: boolean; reason: string };
```

**解锁条件（缺一不可）**：

1. 逃逸率序列达标，且**样本量达标**（沿用 `DEFAULT_PROGRESSIVE_AUTONOMY.minSamples` 口径）；
2. 有**对照序列**（单靠"一次通过"不够——承接既有注释原话）；
3. 证书未过期（§9）；**无证书的项只能停在 advisory**；
4. 粒度是 **「文书族 × 判断项 × edition」**，不是全局（D3 过拟合对策）；
5. **退化自动回锁**：连续 N 次逃逸回锁，回锁后必须重新攒样本。

### 4.4 WP2 验收

- 四项解锁条件 + 回锁路径各一条端到端；
- `isAutonomyUnlocked` 既有 9 条单测**全部保持**（不破坏交付侧棘轮）；
- 每条 `deliver` 事件都有 `reason`（可测断言）；
- Settings Doctor 可见：已解锁项 / 依据 / 回锁历史。

---

## 5. WP3 · 论证结构保证 ✅ 已落地

对应 [Closing the Loop](https://arxiv.org/abs/2606.23913v1) 的分层：**计算性部分给可证明正确性，open-textured 部分给结构保证**。LawMind 不需要 λlaw / Z3：全部是 `LegalReasoningGraph` 上的集合与可达性运算，落 `deliverables/reasoning-validator.ts` 的 `checks` 数组。

| #   | 检查                                            | 为什么                     | 现状                       |
| --- | ----------------------------------------------- | -------------------------- | -------------------------- |
| 1   | 每个争点至少有 `facts` 或 `evidence`            | 空争点 = 论证骨架缺一级    | 不检查（只看合计 `facts`） |
| 2   | 每个 `authorityIds` 至少被一个争点引用          | 孤立权威 = 装饰性引用      | 不检查                     |
| 3   | 争点引用的 authority 是否出现在正文 citations   | 图 ↔ 正文一致性            | 不检查                     |
| 4   | `issue → elements → fact/evidence` 三级是否都在 | 缺级 = 结构缺口            | 不检查                     |
| 5   | `openQuestions` 非空时不得判收敛                | 图里有字段，**无门禁消费** | 不检查                     |

**与 P0-4a 的关系**：第 1 条是 `facts_grounded` 那个哑字段的**正解路径**。IRAC 来源映射（`IRAC_SOURCE_KIND_COVERAGE`）已落地，第 1 条让检查从"合计 `facts` 数"改成"每争点可达性"——升级前提**结构上成立**。

**severity 纪律**：

- 新增检查**一律先 `warning`**（advisory 先行）；
- 只有过真实数据 precision 抽审，才允许升 blocker；
- 升级必须**同时补端到端断言**（真实 bundle → 检查通过 → 双门禁绿）——沿用 P0-4a 留下的方法论。

**验收**：五条检查各带正反单测；`reasoning-validator.test.ts` 既有 6 条（含三条 P0-4a 回归）保持全绿；对既有工作区抽样零崩溃。

---

## 6. WP4 · 升级通道产品化（引擎 + API + UI 三层）✅ 已落地

### 6.1 三 edition 分档

沿用判定分级同一解析顺序（**避免两处口径漂移**）：policy 显式 → env 显式 → edition 缺省。**未知取值按所在 edition 缺省处理**，不把写错的配置当成硬墙或免检。

| edition          | 升级姿态                             | 理由                                       |
| ---------------- | ------------------------------------ | ------------------------------------------ |
| `solo`           | **advisory**（卡片可见，不阻断导出） | 单人执业打断成本高；先让他看见系统的不一致 |
| `firm`           | **block**（口径不一致必须确认）      | 多律师协作，「按哪条路继续」是所内口径问题 |
| `private_deploy` | **block**，且可被 policy 覆盖        | 大所自有流程                               |

### 6.2 引擎接线

| 位置                          | 动作                                                                                         |
| ----------------------------- | -------------------------------------------------------------------------------------------- |
| `platform/requires-action.ts` | 新增 `buildJudgmentEscalationAction`（照 `buildWorkflowBlockedAction` 形状）                 |
| `delivery/decision-header.ts` | 决策头带「本次机器核对 N 项 · 独立审稿判断 M 项 · 待您定夺 K 项」                            |
| `router/route-divergence.ts`  | 把 `resolveRouteDivergencePosture` 的 `escalate` **真正接到** `buildRequiresActionsFromTurn` |
| `agent/turn-orchestrator-*`   | **必须加 cassette**（I6）：分歧 → 升级 → 律师选择 → **下一轮请求体**                         |

### 6.3 本地 API 接线

| 需求                   | 落点                                                                                                        |
| ---------------------- | ----------------------------------------------------------------------------------------------------------- |
| 升级卡读取             | `server/lawmind-server-route-action-summary.ts` 扩展（既有聚合路由）                                        |
| 判定项明细（律师可读） | 新增 `server/lawmind-server-route-judgment-items.ts` + `lawmind-api-schemas.ts` 加 schema                   |
| 判定层健康自述         | `server/lawmind-health-payload.ts` + 已有 `lawmind-health-judgment-controls.ts` 扩展                        |
| 错误信封 / 鉴权 / 限流 | 复用 `lawmind-api-error.ts` · `lawmind-local-api-auth.ts` · `lawmind-local-rate-limit.ts`（**不新增机制**） |

**契约测试**：每个新路由一条 `*.test.ts`（与既有 40+ 路由测试同构）。

### 6.4 桌面 UI 接线

| 交付物               | 落点                                                                | 要点                                                                        |
| -------------------- | ------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| 升级卡组件           | 新增 `LawmindJudgmentEscalationCard.tsx`                            | 照 `LawmindMailContractFastLaneCard.tsx` 的形状；**空/加载/错误三态都要有** |
| 判定项明细面板       | 新增 `LawmindJudgmentItemsPanel.tsx`                                | 逐项显示：谁判的、依据是什么、可否一键定夺                                  |
| 决策头扩展           | `LawmindDecisionHeader.tsx`（已有）                                 | 加三项计数；不得暴露内部 id                                                 |
| Settings Doctor 扩展 | `LawmindSettingsDoctor.tsx`（已有，已 import `isAutonomyUnlocked`） | 分级覆盖率 / 已解锁项 / 证书有效期 / 回锁历史                               |
| 文案                 | 全量过 `pnpm lawmind:ui-copy-lint`                                  | 禁词见 §8.3                                                                 |

### 6.5 律师可见面文案纪律（I12 + D12）

升级卡必须说清三件事，且**不替律师决定**：

1. **分歧是什么**（哪条路径说什么，可读）；
2. **为什么值得确认**（不同口径 ⇒ 不同核对清单与拍板姿态）；
3. **在此之前系统做了什么**（不替你选，也不静默继续）。

**禁止出现**：模型名、概率数字、"置信度 0.73"、`divergenceKey` 之类内部 id、工程师术语。

### 6.6 WP4 验收

- 三 edition 策略单测各一条；三条升级路径各一条 cassette；
- e2e：`first-matter-journey` + `delivery-redline` 在三个 edition 下的升级行为；
- `lawmind:ui-copy-lint` 通过；`lawmind:check:renderer-node` 通过（renderer 不得引入 `node:fs`）。

---

## 7. WP5 · 编译期飞轮接线（P1）+ 规则治理

> **前置**：真实办件数据（G4）。P0 实测 `escape-*.jsonl` 产出为零——飞轮不是转得慢，是**从未产生过任何一条记录**。下面的代码与测试**现在就能写完并 shadow**，但不能提前宣布"已越用越准"。

### 7.1 链路

```text
escape-candidates.jsonl（该命中没命中）
escape-corpus.jsonl（漏网正文）
escape-stance.jsonl（立场候选）
        ↓  reader（已落地）
decision-samples.jsonl
        ↓  compile/rule-candidate.ts（新增，离线跑）
候选 DSL 片段（人类可读，不是模型原文）
        ↓  memory/adoption-service.ts 的 pending → adopted / dismissed（既有队列，不静默落盘）
法律顾问验收（§11，约 0.5 人天/所）
        ↓
lint/families/*.ts 或 clause/dsl.ts 的新 ClausePattern
        ↓  evaluation/replay-fixtures.ts（**反向用例 ≥ 正向用例**）
规则包（`effectiveFrom` + `source` + 版本链）
```

### 7.2 与 `clause/pattern.ts` 的关系

```typescript
// src/lawmind/clause/pattern.ts:33
export type ClauseExtractor = (text: string, ctx: ExtractCtx) => Partial<Clause> | null;
```

`ClauseExtractor` 是**已经留好的可注入接口**。LLM 产出的提取器从这里落，**编译期跑、结果缓存成模式**。三条要求：

- 编译期产物必须是**可读、可 diff、可回归**的声明（DSL 片段 / 参数行），不是模型输出原文；
- 提取器必须能**脱网重放**——同一输入两次运行结果一致，否则不能进回归语料；
- 每个提取器带正反语料，进 `evaluation/replay-fixtures.ts`。

### 7.3 规则治理（I7 完整落地）

| 要求                   | 机制                                                                     |
| ---------------------- | ------------------------------------------------------------------------ |
| 每条规则有出处与生效日 | `effectiveFrom` + `source` 必填；缺一不得合并                            |
| 参数与规则分离         | 法条常量独立成行（LPR 历史值 / 时效 / 上限比例）                         |
| 三分类强制             | 客观可枚举 / 半客观一致 → 可编译；主观裁量 → **永不编译**（路线图 §2.3） |
| 法律顾问验收           | §11 的验收工件；**无验收不得升 blocking**                                |
| 版本链与回滚           | 规则包版本化，可回滚；升版后旧案可解释                                   |
| 分族                   | 条文族 + 参数族，避免过拟合本所历史                                      |
| 误报纪律               | **precision 优先于 recall**；severity 分层；一键驳回并回流               |

### 7.4 规则包的分发与升级（易漏项）

规则包有两个来源，必须明确优先级与升级语义——仓库已有先例 `WORD_REVISION_PACK_VERSION`：**内置包升级时，工作区 overlay 只补不覆盖缺失项**。

| 来源             | 位置                                            | 优先级                                       |
| ---------------- | ----------------------------------------------- | -------------------------------------------- |
| 内置包（随应用） | `src/lawmind/platform/word-revision-packs.ts`   | 基线                                         |
| 工作区 overlay   | `workspace/playbooks/word-revision/<family>.md` | 覆盖同名项；**版本低于内置时合并内置新增项** |

**要求**：

1. 每个规则包有 `packVersion`；内置包升版时，旧 overlay **不得静默丢弃内置新增项**（既有测试已覆盖，新增包沿用同一契约）；
2. 规则包升版走**发布流程**：recompile → 在留出集上评估 → **不优于现岗者不发**（DSPy 的 build-gate 纪律）；
3. 回滚规则包**不需要改工作区数据**（D5）。

---

## 8. WP6 · firm-specific 校准 + 覆盖证书（P3）

> **前置**：数百样本（G5）。当前 workspace 的 `approvals.jsonl` 只有 1 条且 pending。

### 8.1 两层结构

| 层       | 回答                                           | 产物                                 |
| -------- | ---------------------------------------------- | ------------------------------------ |
| 校准器   | 「这次律师会不会动手」                         | 单调映射（温度缩放 / Platt scaling） |
| 覆盖证书 | 「在漏检预算 \(\alpha\) 内，被升级的样本最少」 | 可复算阈值 + 有效期                  |

### 8.2 校准器

| 项       | 设计                                                                                                                    |
| -------- | ----------------------------------------------------------------------------------------------------------------------- |
| 特征     | 现成便宜信号：`deliverableType`、diff 长度、hunk 数、章节标题、条款族命中、citation 数、`rewriteAmplitude`、stance 命中 |
| 标签     | `approvals.jsonl` 批准/驳回、`ReviewLabel` 14 类、`firstPassOk/Fail`、§4.2 的外生事件                                   |
| 目标函数 | **不是「法律正确性」，是「这位律师会不会动手」**——纯行为学，可测、可校准                                                |
| 方法     | 温度缩放 / Platt scaling（单调映射），几百样本即可起步                                                                  |
| 冷启动   | 样本不足诚实返回 `insufficient`，**不产出校准器**（承接 `north-star.ts` 的 _Missing samples stay null_）                |
| 偏置声明 | `approvals.jsonl` 只覆盖走到拍板的动作；盲区写在文档**与 UI**                                                           |

### 8.3 覆盖证书（conformal）

split conformal：小 calibration set → 经验分位数 \(\hat q\) → 预测集合

$$C(x_{n+1}) = \{y : s(x_{n+1}, y) \le \hat q\}, \qquad P(y_{n+1} \in C(x_{n+1})) \ge 1-\alpha$$

**模型可纯黑箱、不需重训**——对"不动权重"的部署形态是决定性的。2026 前沿已从边际保证推进到条件保证（[group-conditional](https://arxiv.org/html/2602.01285v1) / [prompt-adaptive](https://arxiv.org/html/2604.13991v1) / [双轴](https://arxiv.org/html/2607.08456v1)）。

**为什么对 LawMind 关键**：它把 R7 的「主观项永不编译、只升级」从**口号**变成**可优化目标**——给定漏检预算 \(\alpha\)，最小化升级量。同时**绕开** I4 的反对：conformal 的产物**不是概率断言**，是**可复算阈值 + 可回归验证的覆盖性质**。

**必须写进设计的三个诚实边界**：

1. exchangeability 对自然语言只是**数学近似**，案件并非 i.i.d.；
2. **配置漂移会打掉覆盖保证** ⇒ 证书必须带**有效期 + 漂移监控**；
3. 小分组样本少 ⇒ 阈值更保守、保留率更低（MACI 实测），必须如实告知。

### 8.4 落地形态

```ts
// src/lawmind/models/judgment-calibration.ts（新增）
export type CalibrationArtifact = {
  schemaVersion: 1;
  itemId: string;
  familyId?: string;
  edition?: LawMindEdition;
  method: "platt" | "temperature";
  coefficients: { a: number; b: number };
  trainedSamples: number;
  trainedAt: string;
  validUntil: string;
  labelBalance: { positive: number; negative: number };
  certificate?: {
    alpha: number;
    threshold: number;
    empiricalCoverage: number; // 观测值，不是承诺
    calibrationSamples: number;
    validUntil: string;
  };
};
```

**验收**：冷启动返回 `insufficient`；证书过期**自动退 advisory**；偏置声明 UI 可读；漂移告警可用。

---

## 9. WP7 · 可观测性、SLO 与成本预算

### 9.1 指标面

| 面                            | 内容                                                                 | 落点                                 |
| ----------------------------- | -------------------------------------------------------------------- | ------------------------------------ |
| `metrics/lawyer-dashboard.ts` | 判断项：`machineRatio` / `escalatedRatio` / `conflictRate`，按文书族 | 扩展（已有 `MatterHealthMetrics`）   |
| `metrics/north-star.ts`       | 既有 `firstPassRate` / `lintEscapeRate` **不动**；判断层**单独一组** | 扩展（不混进北极星，否则口径不可比） |
| `metrics/decision-samples.ts` | `byItemTier` / `byItemOutcome` / `conflictByItem`                    | 扩展报告（不新建管道）               |
| Settings Doctor               | 分级覆盖率 / 已解锁项 / 证书有效期 / 回锁历史                        | `LawmindSettingsDoctor.tsx`          |

### 9.2 SLO（每条都要有告警）

| SLO                        | 目标                                         | 测量点                         |
| -------------------------- | -------------------------------------------- | ------------------------------ |
| guardian 段 P95 延迟       | **不高于改造前基线**；`on` 后应下降          | 端到端计时（`runtime-events`） |
| 证据包字节数               | judge 项缩减后下降 ≥25%                      | 证据包 JSON 长度               |
| 判定层每件成本             | `on` 后 ≤ 基线（机械项零调用应体现为下降）   | 调用次数统计                   |
| 升级率（`escalatedRatio`） | solo ≤5%；firm ≤8%（超阈说明判据不成熟）     | item-outcome 聚合              |
| machine 不可用率           | <0.5%；超阈告警（验证器 bug 或数据形态变化） | `unavailable` 计数             |
| 证书过期                   | 0 个已过期仍在 blocking                      | doctor 断言                    |

### 9.3 性能与测试预算

承接 `docs/lawmind/LAWMIND-ITERATION-SPEED-AND-GUARDRAILS.md` 的护栏：本地 `pnpm test` wall time 不得因本计划回退；CI 与 `pnpm lawmind:verify` 的 `test:full` 口径不变。

---

## 10. WP8 · 灰度发布与回滚

### 10.1 三阶段推进

| 阶段       | 范围                                                      | 通过条件                                        |
| ---------- | --------------------------------------------------------- | ----------------------------------------------- |
| **shadow** | 全部工作区；machine 与 judge 双跑，**verdict 仍按 judge** | 一致率有数；每项 ≥95% 才进 canary；无回归       |
| **canary** | 按 edition 分批：先 `private_deploy` → `firm` → `solo`    | 一致率不掉；P95 不升；升级率在 SLO 内；无新告警 |
| **GA**     | 默认 `on`                                                 | DoD 全绿（§0）                                  |

> **为什么这个顺序**：`private_deploy` 客户对变更最宽容、且本就有显式动作档位；`solo` 用户对打断最敏感，放最后。

### 10.2 自动回滚触发条件（任一命中即回滚，不等人工）

| 触发                                 | 动作                                   |
| ------------------------------------ | -------------------------------------- |
| machine 不可用率 >2%                 | 该验证器**全局停用**，其项降回 `judge` |
| 升级率超 SLO 2 倍                    | 升级姿态退回 advisory                  |
| guardian P95 上升 >30%               | 退回 `shadow`                          |
| 诉讼/意见类交付出现新的 blocker 误报 | 该规则降 advisory + 告警               |

### 10.3 开关总表

解析顺序一律是 **policy 显式 → env 显式 → 缺省**。「policy 显式」指的是工作区根目录的
`lawmind.policy.json`（`readWorkspacePolicyFile`），**不是** `LAWMIND_*` 的另一半写法。

| 开关                                                                       | 形态                    | 默认                  |
| -------------------------------------------------------------------------- | ----------------------- | --------------------- |
| `LAWMIND_JUDGMENT_TIERING` / policy `judgmentTiering`                      | `off\|shadow\|on`       | `shadow`              |
| `LAWMIND_JUDGMENT_DISABLED_VERIFIERS` / policy `judgmentDisabledVerifiers` | 逗号分隔的验证器 id     | 空                    |
| `LAWMIND_JUDGMENT_ESCALATION` / policy `judgmentEscalation`                | `off\|on`               | `off`                 |
| `LAWMIND_JUDGMENT_ESCALATION_POSTURE` / policy `judgmentEscalationPosture` | `advisory\|block`       | 按 edition            |
| `LAWMIND_ROUTE_DIVERGENCE`（主开关）/ policy `routeDivergenceShadow`       | `0\|1`                  | 开（仅记录）          |
| `LAWMIND_ROUTE_DIVERGENCE_POSTURE` / policy `routeDivergencePosture`       | `off\|shadow\|escalate` | `shadow`              |
| `LAWMIND_DECISION_MODEL_MODE` / policy `decisionModelMode`                 | `off\|shadow\|on`       | `off`（离线一票否决） |

> **2026-09-21 更正**：上表里 judgment 族的四个键此前**只有 env 生效**——三个调用点
> （`guardian/run.ts`、`agent/turn-orchestrator-finalize.ts`、
> `server/lawmind-server-route-judgment.ts`）都无参调用解析器，`lawmind.policy.json` 里写的
> 键全部被丢掉；本页还曾把键名写成 `LAWMIND_JUDGMENT_ESCALATE` / `judgmentEscalate`
> （真名是 `…_ESCALATION` / `judgmentEscalation`，取值是 `off|on`，不是 `off|advisory|block`）。
> 现在三处都按工作区策略文件解析，并各有一条准入测试：
> `agent/judgment-escalation-cassette.test.ts`（卡片上不上）、
> `guardian/tiering-prompt.test.ts`（项摘不摘）、
> `server/lawmind-server-route-judgment.test.ts`（界面怎么说）。
> 两侧决定的是同一件事的两半：收尾侧决定**卡片上不上**、Guardian 侧决定**项摘不摘**，
> 所以必须读同一份输入。

**回滚纪律（D5）**：任何 blocking 行为必须能**不停机、不改数据**退回 advisory；不重建规则包、不清缓存。

---

## 11. 法律顾问验收（流程工件，不是口号）

I7 与 D13 要求"规则错了比没有规则更糟"真正落地。因此验收必须**产出工件**，否则它只是会议。

### 11.1 验收工件 schema

```ts
// src/lawmind/lint/rule-acceptance.ts（新增）
export type RuleAcceptanceRecord = {
  ruleId: string;
  verifierId?: string; // machine 项的验证器
  decision: "accepted" | "rejected" | "needs_change";
  /** 法律顾问身份（审计需要，不进律师可见面）。 */
  reviewerId: string;
  reviewedAt: string;
  /** 依据：法条 / 司法解释 / 所内口径，必填。 */
  basis: string;
  source: string; // 条文出处
  effectiveFrom: string; // 生效日
  /** 正反语料抽样结果。 */
  precisionSample: { total: number; falsePositives: number };
  note?: string;
};
```

落 `workspace/lawmind/lint/acceptance.jsonl`，并入审计（`audit` 六字段不变，进 `detail`，I5）。

### 11.2 流程与 SLA

| 阶段        | 谁           | 工件                              | SLA           |
| ----------- | ------------ | --------------------------------- | ------------- |
| 候选生成    | 工程（离线） | 规则候选 + 正反语料               | —             |
| 待确认队列  | 系统         | `memory/adoption-service` pending | —             |
| 法律复核    | 法律顾问     | `RuleAcceptanceRecord`            | 3 个工作日/批 |
| 落包        | 工程         | 规则包 + `effectiveFrom`          | 1 工作日      |
| 升 blocking | 工程         | 棘轮记录 + 审计                   | 需 ⑶ 的证书   |

**无 `RuleAcceptanceRecord` 的规则**：可以落包，但**只能 advisory**（机械强制，见 I7）。

---

## 12. 测试与发布门禁矩阵

| 层                | 要求                                                     | 命令                                                                         |
| ----------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------- |
| 单元              | 新函数全单测；每个失效路径一条；18 验证器 × 3 条         | `pnpm exec vitest run src/lawmind/guardian src/lawmind/deliverables`         |
| cassette          | 改门禁 / 编排 / 升级通道**必须**加；断言「下一个请求体」 | `pnpm exec vitest run src/lawmind/agent/turn-orchestrator-cassettes.test.ts` |
| 回归语料          | 新规则**反向用例 ≥ 正向用例**                            | `pnpm test:replay`                                                           |
| e2e（Playwright） | 三 edition ×（合同改稿 / 意见书）+ 升级卡路径            | `pnpm lawmind:desktop:e2e:pr`                                                |
| Electron e2e      | 关键路径在真实 Electron 下                               | `pnpm lawmind:desktop:e2e:electron`                                          |
| 渲染层纪律        | 不得引入 `node:fs`；文案 lint                            | `pnpm lawmind:check:renderer-node` · `pnpm lawmind:ui-copy-lint`             |
| 类型              | engine + desktop                                         | `pnpm typecheck` · `pnpm --filter lawmind-desktop typecheck`                 |
| 全量              | CI 口径不变                                              | `pnpm test:full`                                                             |
| 发布就绪          | 判断层条目无挂账                                         | `pnpm lawmind:release-readiness`                                             |

---

## 13. 分期与 Gate（数字门槛）

| Gate      | 内容                                                        | 出口条件（**全部满足**）                                                                                                                                                                                                                                                                                                | 人天                                   |
| --------- | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| **G0** ✅ | 分级数据模型 + 150 项分级表 + 11 个验证器 + shadow 三态门控 | ✅ 覆盖率 150/150；✅ 43 条验证器 + 33 条分级/聚合测试；✅ 全量回归绿（`npx vitest run src/lawmind` → 584 文件 / 3777 例）；⏳ shadow 一致率待真实数据                                                                                                                                                                  | **已完成**                             |
| **G1** ✅ | 聚合规则扩展 + 三态门控 + cassette                          | ✅ 聚合 12 条；✅ **12 条 cassette 断言「哪些项进提示词」**（`tiering-prompt.test.ts`）；✅ 修掉两处静默漏洞（截断顺序 / lawyer 项丢失）                                                                                                                                                                                | **已完成**                             |
| **G2** ✅ | 逐项落盘 + 外生验收信号 + 棘轮接线                          | ✅ `item-outcome.ts`（20 条）；✅ `unescalated-delivery.ts`（20 条）；✅ **修掉棘轮 `firedClean` 恒 0 的严重缺陷**；✅ 端到端测试证明**信号接通后可升级项真的产出**                                                                                                                                                     | **已完成**                             |
| **G3** ✅ | 论证结构五条 + 升级通道（引擎/API/UI 三层，三 edition）     | ✅ 结构检查 21 条单测；✅ 升级通道引擎 12 条 + 3 edition 姿态 9 条；✅ API 8 条；✅ UI 9 条；✅ **真实回合 cassette 4 例**；✅ `ui-copy-lint` / `renderer-node` 通过；✅ **真机 Electron e2e**（引擎 → 路由 → 界面）；✅ PR 套件 e2e 四态（advisory / block / 空 / 读不到）；✅ **旁路展示**（`advisory` 下改稿台可见） | **已完成**（两处欠账见 §1.1f，已补齐） |
| **G4**    | 飞轮接线 + 规则治理 + 规则包分发（**需真实数据**）          | 至少 1 条规则走完全链路；反向 ≥ 正向；`packVersion` 契约测试；顾问验收工件落盘                                                                                                                                                                                                                                          | 26                                     |
| **G5**    | 校准 + 覆盖证书（**需数百样本**）                           | 冷启动 `insufficient`；证书过期自动退 advisory；偏置声明 UI 可读；漂移告警可用                                                                                                                                                                                                                                          | 24                                     |
| **G6**    | 外部判定器评估（**仅当异质第三票**）                        | I9/I10 端到端断言；默认 off；出网走 `jsonProxy`；审计齐；`offline` 时结构性不可用                                                                                                                                                                                                                                       | 12                                     |

**开工顺序**：`G0 → G1 → G2 → G3`（**不依赖历史数据**，共 **90 人天**）→ `G4/G5`（等数据）→ `G6`（等前三步结论）。

### 13.1 人力与日历

按 **1.5 FTE 工程 + 0.5 FTE 法律顾问 + 0.3 FTE QA** 估算：

| 阶段  | 人天 | 日历（近似）       |
| ----- | ---- | ------------------ |
| G0    | 22   | 第 1–3 周          |
| G1    | 14   | 第 3–4 周          |
| G2    | 20   | 第 5–7 周          |
| G3    | 34   | 第 7–11 周         |
| G4/G5 | 50   | 数据到位后 +6–8 周 |
| G6    | 12   | G4/G5 结论后       |

**关键路径是 G3**（三层接线 + 三 edition + e2e），建议提前冻结 UI 文案，否则 `ui-copy-lint` 会反复返工。

---

## 14. 风险登记

| #       | 风险                                  | 等级   | 对策                                                                                           |
| ------- | ------------------------------------- | ------ | ---------------------------------------------------------------------------------------------- |
| D1      | 逃逸语料太少 / 正负失衡，编译不出规则 | 高     | P0-3 体检报告先量；**不够就诚实说不够**                                                        |
| D2      | snippet 400 字截断导致规则过拟合      | 中     | `snippetStats` 量化；必要时提上限                                                              |
| D3      | 规则过拟合本所历史，换所失效          | 中     | 分族 + 参数与规则分离；解锁粒度限定「族 × 项 × edition」                                       |
| D4      | 编译器覆盖率天花板                    | 高     | 主观项**永不编译**、只升级；报告自述覆盖                                                       |
| D5      | 规则错误责任                          | 高     | §11 验收工件 + `effectiveFrom` + `source` + 版本化 + 回滚                                      |
| D6      | 校准器学到行为偏置而非质量            | 中     | 目标函数明说；偏置声明进 UI；不当质量模型                                                      |
| D7      | 迁移期双轨不一致                      | 中     | 默认 shadow / advisory，只记录不改行为                                                         |
| **D8**  | **把主观项误判为机械项**              | **高** | `LAWYER_ONLY_ITEM_IDS` 编译期防呆；一致率 <90% **禁止转 `on`**；升级只能朝更严方向             |
| **D9**  | **验证器失效被当成「通过」**          | **高** | `status:"unavailable"` 强制 fail-closed；43 条验证器测试含畸形/规则失败输入；不可用率 SLO 告警 |
| **D10** | **提示词缩短反而让 judge 项判得更松** | 中     | shadow 逐项对比；judge 项一致率纳入 G1 出口                                                    |
| **D11** | **证书过期无人发现**                  | 中     | `validUntil` + 过期自动退 advisory + doctor 告警                                               |
| **D12** | **并行会话写同一工作树**              | **高** | §18 纪律                                                                                       |
| **D13** | **UI 文案返工拖住关键路径**           | 中     | G0 期即冻结文案；`ui-copy-lint` 进 pre-commit                                                  |
| **D14** | **三 edition 行为分叉未被测到**       | 中     | G3 起 e2e 矩阵含三 edition；策略单测覆盖未知取值                                               |

---

## 15. 与既有文档的缝

- **`LAWMIND-DECISION-LAYER.md` §11 推荐路线** 与 **`LAWMIND-DECISION-LAYER-PLAN.md` §2 阶段总览** 是本文上游；本文落地后由其 §13 取代排期部分（两处口径应同步修改）。
- **第十四期 R7** 由本文 §3（分级缩小 LLM 判定面）与 §8.3（覆盖证书把"永不编译"变成可优化目标）承接。
- **`evaluation/README.md` 的三层证据口径** 不变：编排类改动仍以 `turn-orchestrator-cassettes.test.ts` 为准入证。
- **`LAWMIND-EGRESS-POLICY.md` §4** 的「模型 API 仍会出网」是 §2.2 I10 的直接依据。
- **`LAWMIND-ITERATION-SPEED-AND-GUARDRAILS.md`** 的护栏适用于本文全部新增测试与 §9.3。
- **`RELEASE-CHECKLIST.md`** 增加判断层条目（分级覆盖率自述、证书有效性、棘轮状态）。

---

## 16. 明确不要做

1. **不要现在引入外部判定器**（Jev 或同类）——运行期判定器，与 I2 方向相反；只在 G6、且仅当异质第三票。
2. **不要先上 conformal 完整实现**——缺 calibration set；先把**口径**写进规格。
3. **不要扩大 LLM 判定面**——把机械项留在模型手里是退步，不是保守。
4. **不要现在引入 Catala / λlaw / ASP 级形式化**——那是「表达力天花板」的正解（默认逻辑 + 例外），触发条件是**规则数已多到互相打架**且 P1 有真实语料。现在连一条逃逸行都没有。
5. **不要在缺外生验收信号时把新编译产物从 advisory 升 blocking**——棘轮不许无对照扩域。
6. **不要让判定器自己给自己判卷**——需要外部无法控制、无法观察的接受/拒绝信号（SEAL 原理）。
7. **不要把「再训一个验证器」或「难题多想一会儿」当覆盖率解药**——验证器质量本身受问题难度限制（[Variation in Verification](https://arxiv.org/html/2509.17995v2)：更强生成器产生更细微错误，弱/强验证器在难题上收益同时趋零）；thinking 超约 8–12K 开始翻错（[Overthinking](https://www.arxiv.org/pdf/2604.10739)）。
8. **不要为凑指标降低 benchmark 门槛**（路线图 §6 既有口径）。
9. **不要把「全部项都判 judge」当安全选择**——它是**最贵且方差最大**的选择，且让 §9 的成本 SLO 永远不可能达标。

---

## 17. 验收命令矩阵

```bash
# G0 / G1
pnpm exec vitest run src/lawmind/guardian src/lawmind/deliverables src/lawmind/policy
pnpm --filter lawmind-desktop typecheck

# G2
pnpm exec vitest run src/lawmind/metrics src/lawmind/delivery
pnpm lawmind:decision-samples -- --dry-run    # 空工作区必须诚实报缺，不报 0

# G3
pnpm exec vitest run src/lawmind/reasoning src/lawmind/router src/lawmind/platform
pnpm exec vitest run src/lawmind/agent/turn-orchestrator-cassettes.test.ts
pnpm lawmind:desktop:e2e:pr
pnpm lawmind:ui-copy-lint
pnpm lawmind:check:renderer-node

# G4 / G5
pnpm test:replay
pnpm test:full

# 发布
pnpm lawmind:release-readiness
pnpm lawmind:desktop:e2e:electron
```

---

## 18. 开工前置：并行会话纪律（必须先做）

本文写作时逐项核实：**工作区已有另一会话在改本计划涉及的同一批文件**——`src/lawmind/guardian/*`、`deliverables/reasoning-validator.ts`、`reasoning/legal-graph.ts`、`llm/openai-json.ts`、`router/model-route.ts`，以及新增的 `router/route-divergence.ts`、`llm/json-schema-capability.ts`、`clause/clause-type-keywords.ts`（共 24 个已改文件 + 6 个新文件，约 1400 行改动）。

`AGENTS.md` 已写明：**同一克隆同一时刻只允许一个会话写工作区**。因此开工前必须：

1. **先让在飞改动落定**（提交并明确归属），**不要在混合态上叠新工作**；
2. 需要并行一律 `git worktree add`，**不共用同一份工作树**（可把 `node_modules` 软链进去）；
3. **禁止 `git stash`**——不带 pathspec 会收走**别人**的未提交改动；
4. **禁止 `git add -A` / `add .` / `commit -a`**——`workspace/` 混有运行时产物；只显式列举本轮文件；
5. 提交前看 `git status`：出现不属于本轮的文件 = 有并行写入者，**不要一起提交**，也不要 `git checkout -- .` / `git clean -fd`；
6. 同一文件被两会话改过时，以**跑通测试的合并态**为准，逐个核对两侧意图都还在；
7. 收口时不要把 `workspace/` 运行时产物一起提交（真相源在 `src/lawmind/skills/builtin/*.md` 与协作模板）。

---

_最后更新：2026-09-21（计划定稿。P0-1…P0-4 与 P2.1…P2.3 已在工作区落地；本文为 G0–G6 的完整交付计划，含 DoD、分级表、验证器目录、API/UI/发布/验收/运维修口。）_
