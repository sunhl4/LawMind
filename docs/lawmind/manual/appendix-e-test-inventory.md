# 附录 E 测试清单与分布

本附录的**数量统计是机械生成的**（`rg --files -g '*.test.ts' ...`）；「关键测试说明」是人工挑选的。**数字是 2026-09-25 的快照，会随提交漂移**。

## E.1 总量

```text
测试文件总数：940
```

这个数字远超「一个产品」的常规规模——它反映的是这个仓库对**门禁类、诚实类、边界类**逻辑的测试密度。

核对方法：

```bash
rg --files -g '*.test.ts' -g '*.test.tsx' -g '*.spec.ts' -g '!**/node_modules/**' | wc -l
```

**注意口径**：这条命令是「测试入口文件数」，不是「用例数」（一个文件里常有几十个 `it`）。E.2 的表按**目录递归**计数，所以父目录的数字包含子目录（`src/lawmind/agent/` 的 141 里含 `agent/tools/legal/` 那 29 个）。「根目录零散文件」实际在 `src/lawmind/` 根，不在仓库根。

## E.2 按目录分布

| 目录                                                                                                                                                  | 测试文件数                   |
| ----------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| `apps/lawmind-desktop/src/renderer/`                                                                                                                  | 191                          |
| `src/lawmind/agent/`                                                                                                                                  | 141                          |
| `apps/lawmind-desktop/server/`                                                                                                                        | 70                           |
| `src/lawmind/platform/`                                                                                                                               | 35                           |
| `apps/lawmind-desktop/e2e/`                                                                                                                           | 33                           |
| `src/lawmind/drafts/`                                                                                                                                 | 32                           |
| `src/lawmind/retrieval/`                                                                                                                              | 27                           |
| `apps/lawmind-desktop/electron/`                                                                                                                      | 22                           |
| `src/lawmind/evaluation/`                                                                                                                             | 20                           |
| `src/lawmind/memory/`                                                                                                                                 | 19                           |
| `src/lawmind/desk/`                                                                                                                                   | 17                           |
| `src/lawmind/reasoning/`                                                                                                                              | 16                           |
| `src/lawmind/runtime/`                                                                                                                                | 16                           |
| `src/lawmind/deliverables/`                                                                                                                           | 14                           |
| `src/lawmind/models/`                                                                                                                                 | 13                           |
| `src/lawmind/learning/`                                                                                                                               | 12                           |
| `src/lawmind/research/`                                                                                                                               | 12                           |
| `src/lawmind/audit/`                                                                                                                                  | 11                           |
| `src/lawmind/lint/`                                                                                                                                   | 12                           |
| `src/lawmind/mail/`                                                                                                                                   | 11                           |
| `src/lawmind/metrics/`                                                                                                                                | 12                           |
| `src/lawmind/policy/`                                                                                                                                 | 11                           |
| `src/lawmind/skills/`                                                                                                                                 | 12                           |
| `src/lawmind/application/`                                                                                                                            | 11                           |
| `src/lawmind/artifacts/`                                                                                                                              | 9                            |
| `src/lawmind/guardian/`                                                                                                                               | 9                            |
| `src/lawmind/cases/`                                                                                                                                  | 8                            |
| `src/lawmind/integrations/`                                                                                                                           | 8                            |
| `src/lawmind/intent/`                                                                                                                                 | 8                            |
| `src/lawmind/matter-replica/`                                                                                                                         | 8                            |
| `src/lawmind/delivery/`                                                                                                                               | 7                            |
| `src/lawmind/clause/`                                                                                                                                 | 6                            |
| `src/lawmind/engine/`                                                                                                                                 | 7                            |
| `src/lawmind/historical-scan/`                                                                                                                        | 6                            |
| `src/lawmind/adapters/`                                                                                                                               | 5                            |
| `src/lawmind/core/`                                                                                                                                   | 5                            |
| `src/lawmind/host-access/`                                                                                                                            | 5                            |
| `src/lawmind/indexing/`                                                                                                                               | 5                            |
| `src/lawmind/labor/`                                                                                                                                  | 5                            |
| `src/lawmind/litigation/`                                                                                                                             | 5                            |
| `src/lawmind/practice/`                                                                                                                               | 5                            |
| `src/lawmind/review-campaign/`                                                                                                                        | 5                            |
| `src/lawmind/tasks/`                                                                                                                                  | 5                            |
| `src/lawmind/router/`                                                                                                                                 | 4                            |
| `src/lawmind/assistants/`                                                                                                                             | 3                            |
| `src/lawmind/insights/`                                                                                                                               | 3                            |
| `src/lawmind/integration/`                                                                                                                            | 3 （只有测试，无运行时代码） |
| `src/lawmind/mcp/`                                                                                                                                    | 3                            |
| `src/lawmind/work/`                                                                                                                                   | 3                            |
| `src/lawmind/llm/`                                                                                                                                    | 2                            |
| `src/lawmind/matter/`                                                                                                                                 | 3                            |
| `src/lawmind/matter-cloud/`                                                                                                                           | 2                            |
| `src/lawmind/routing/`                                                                                                                                | 2                            |
| `src/lawmind/sources/`                                                                                                                                | 2                            |
| `src/lawmind/templates/`                                                                                                                              | 2                            |
| 其他单文件目录（`license/`、`onboarding/`、`ops/`、`stance/`、`triage/`、`text/`、`product/`、`compile/`、`contracts/`、`ingest/`、`matter-ops/` 等） | 各 1                         |
| `scripts/`                                                                                                                                            | 2                            |
| 根目录零散文件（`build-channel.test.ts`、`engine-actor.test.ts`、`index.test.ts`、`review-labels.test.ts`）                                           | 各 1                         |

## E.3 三个密度最高的地方说明什么

### `renderer/`（191 个）

渲染层测试最多，因为**组件多**（几百个组件文件）而且**文案与交互都要测**。比如 `MemoryInspector.batch.test.tsx` 测的是「预览不写入、确认后才落盘」这种交互契约。

### `agent/`（141 个）

这是引擎最复杂的一块（174 个非测试实现文件）。测试集中在：工具行为、回合编排、压缩、会话、协作、委派。

**其中最特别的是** `turn-orchestrator-cassettes.test.ts`（编排器准入，第 35 章详解）。

### `server/`（70 个）

`lawmind-server-route-*.ts` 非测试实现仍是 59 个，同名测试约 52 个。不是一路由文件必有一个同名测试。70 个测试里还含辅助模块。

## E.4 值得单独知道的测试

### 门禁与诚实类（守「产品不撒谎」）

| 测试                                      | 守什么                                                                                           |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `metrics/north-star.test.ts`              | 没样本返回 null，不报 0%                                                                         |
| `metrics/firm-calibrator.test.ts`         | 冷启动必须诚实拒绝                                                                               |
| `evaluation/true-manuscript-gate.test.ts` | 没夹具就 SKIP                                                                                    |
| `evaluation/human-baseline.test.ts`       | 同上                                                                                             |
| `evaluation/benchmark.test.ts`            | mock 模式不再必然满分                                                                            |
| `memory/adoption-apply.test.ts`           | 无落盘面时 writer 记 `noopReason` / `written: []`。`recorded_noop` 在 `adoption-service.test.ts` |
| `delivery/judgement-ratchet.test.ts`      | 三条不变量（防空转）                                                                             |
| `metrics/unescalated-delivery.test.ts`    | 外生信号纪律                                                                                     |
| `desk/matter-pulse.test.ts`               | 快照口径                                                                                         |

### 安全类

| 测试                                                                | 守什么                                     |
| ------------------------------------------------------------------- | ------------------------------------------ |
| `apps/lawmind-desktop/electron/fs-bridge.test.ts`                   | 「与引擎常量镜像」一致性                   |
| `apps/lawmind-desktop/electron/fs-bridge-access.test.ts`            | 可写根门禁                                 |
| `apps/lawmind-desktop/server/lawmind-server-cors-structure.test.ts` | 手写 writeHead 必须带 CORS                 |
| `apps/lawmind-desktop/electron/local-api-credentials.test.ts`       | 凭据派生、常量时间比较、最小权限、默认拒绝 |
| `retrieval/authority-url-guard.test.ts`                             | SSRF 黑名单                                |
| `retrieval/authority-pinned-fetch.test.ts`                          | DNS 重绑定防护                             |
| `platform/safe-command.test.ts`                                     | 命令网关（含 env 过滤）                    |
| `matter-replica/security-hardening.test.ts`                         | 材料完整性、密钥轮换                       |
| `matter-cloud/matter-cloud-server.test.ts`                          | 认证、租户隔离、内容块完整性               |

### 改稿类（最核心的算法）

| 测试                                              | 守什么                                                            |
| ------------------------------------------------- | ----------------------------------------------------------------- |
| `drafts/minimal-edit-script.test.ts`              | 最短改动算法 + 200 组随机对照                                     |
| `drafts/apply-surgical-edits.test.ts`             | 落改与收窄                                                        |
| `drafts/tracked-xml-qa.test.ts`                   | 成品复核（整句删增检测）                                          |
| `drafts/cross-document-edits.test.ts`             | 整批预检                                                          |
| `artifacts/render-docx-tracked.test.ts`           | 多处命中与回滚工作副本。原件只读和从右到左排序没有直接断言        |
| `integrations/word-addin/review-requests.test.ts` | 最短锚点。同路径第二次创建测的是优先 ready，没有锁「折叠 queued」 |

### 编排类

| 测试                                        | 守什么                 |
| ------------------------------------------- | ---------------------- |
| `agent/turn-orchestrator-cassettes.test.ts` | 编排器准入（第 35 章） |
| `agent/tools/disclosed-turn-tools.test.ts`  | 披露集合               |
| `agent/tools/legal/list-more-tools.test.ts` | 菜单与提示词同源       |
| `agent/context-budget.test.ts`              | 预算与桶               |
| `agent/compact.test.ts`                     | 压缩                   |
| `agent/session-carryover.test.ts`           | 承载分叉               |

### 顺序被锁住的（红了通常是你动了约束）

| 测试                                                                | 锁什么                   |
| ------------------------------------------------------------------- | ------------------------ |
| `deliverables/registry.test.ts`                                     | 27 个 spec 的顺序        |
| `guardian/item-judgments.test.ts`                                   | 150 项判定表「一处不漏」 |
| `platform/lawmind-daemon.test.ts`                                   | 守护状态四件套           |
| `apps/lawmind-desktop/electron/e2e-spec-partition.test.ts`          | 两套 E2E 互斥            |
| `apps/lawmind-desktop/server/lawmind-server-cors-structure.test.ts` | CORS 载体                |

## E.5 真机端到端（33 个）

真机套件的清单在 `apps/lawmind-desktop/e2e/electron-specs.ts`（`ELECTRON_SPEC_FILES`），八个：`app-driver`、`bundle-download-electron`、`daemon-supervision`、`electron-golden-path`、`electron-file-deeplink`、`first-matter-journey`、`judgment-escalation-electron`、`server-crash-recovery`。

按「测什么」分类：

| 类别           | 例子                                                                           |
| -------------- | ------------------------------------------------------------------------------ |
| 首跑与全旅程   | `first-matter-journey`（首跑 → 建案 → 交办 → 草稿 → 签批 → 导出）              |
| 生命周期与自愈 | `daemon-supervision`、`server-crash-recovery`                                  |
| 门禁与决策     | `judgment-escalation-electron`、`review-entry`、`delivery-redline`             |
| 工作台与协作   | `agent-fleet`、`meeting-flow`、`matter-cockpit`、`review-campaign`             |
| 交办入口       | `job-intake`、`solo-research-fast-lane`（原 `solo-contract-fast-lane` 已移除） |
| 信任与安全     | `skills-trust`、`contract-review-trust`、`approval-queue`                      |
| 设置与对话框   | `settings`、`dialogs`、`smoke`、`authority-mock`、`triage-nda`                 |
| 布局与文件     | `workspace-layout`、`workspace-chat`、`electron-file-deeplink`                 |

**注意两套配置互斥**（浏览器 mock vs 真机 Electron），有测试专门守这个分区。

## E.6 跨模块验收（`src/lawmind/integration/`）

三个文件，都只有测试无运行时代码：

| 文件                            | 覆盖                                                                                                                    |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `golden-journeys.test.ts`       | Q1 三条黄金旅程                                                                                                         |
| `phase-a-golden-engine.test.ts` | 引擎黄金路径                                                                                                            |
| `quarterly-acceptance.test.ts`  | 季末验收回归。`pnpm lawmind:acceptance` 的第一步会跑整个 `src/lawmind`，从而跑到它；另有独立的 `lawmind:quarterly-demo` |

**为什么放在 `integration/`**：它们跨了多个模块，不属于任何单模块的职责。

## E.7 怎么用这份清单

三种用法：

1. **想学某个模块怎么用** → 找到它的目录，读那一条测试的标题和内容。测试标题往往比注释更能说明行为。
2. **改了代码想知道该跑什么** → 跑同目录的测试：`pnpm exec vitest run <目录>`。
3. **想知道某条约束在哪守着** → 在这张清单里搜关键词（比如「顺序」「拒绝」「诚实」）。

## E.8 已知坑（本附录相关）

- **940 是 2026-09-25 的快照，会变。** 用 E.1 的命令核对当前值。
- **`renderer/` 测试多不等于渲染层最重要**，只是组件多。
- **`integration/` 只有测试。** 别以为那里有运行时代码。
- **`scripts/` 有 2 个测试**（`lawmind-benchmark.test.ts` 与 `check-coverage-ratchet.test.ts`）——CLI 脚本的测试覆盖仍然薄。
- **顺序被锁住的测试红了，先想是不是动了约束**，别直接改测试。
- **真机 E2E 有两套互斥配置**，混跑会失败。
