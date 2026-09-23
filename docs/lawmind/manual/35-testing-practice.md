# 第 35 章 测试与质量实践

第 18 章讲了测试的**分层**。这一章讲**怎么用**它们：写测试、跑门禁、看覆盖率、以及各路测试实际覆盖了什么。

## 35.1 测试文件在哪

| 类型          | 位置                                 | 命名                                |
| ------------- | ------------------------------------ | ----------------------------------- |
| 引擎单测      | `src/lawmind/**`                     | `<实现名>.test.ts`（同目录）        |
| 路由测试      | `apps/lawmind-desktop/server/`       | `lawmind-server-route-<名>.test.ts` |
| 渲染层测试    | `apps/lawmind-desktop/src/renderer/` | `<组件>.test.tsx`                   |
| Electron 单测 | `apps/lawmind-desktop/electron/`     | `<模块>.test.ts`                    |
| 真机 E2E      | `apps/lawmind-desktop/e2e/`          | `<流程>.spec.ts`                    |
| 跨模块验收    | `src/lawmind/integration/`           | `<阶段>.test.ts`                    |

**规矩**：测试与实现同目录，文件名等于实现名加 `.test`。所以找某个模块的测试很容易——同目录看后缀。

## 35.2 一条命令跑什么

```bash
pnpm test                 # 全部（Vitest）
pnpm test:watch           # 监视
pnpm test:coverage        # 带覆盖率
```

跑单个文件：

```bash
pnpm exec vitest run src/lawmind/drafts/minimal-edit-script.test.ts
```

跑一组（按路径模式）：

```bash
pnpm exec vitest run src/lawmind/drafts src/lawmind/memory
```

**性能提示**：全量 `pnpm test` 很慢（几千个测试）。日常改动用单文件或单目录。

## 35.3 关键测试文件索引

按模块列一下「想知道 X 怎么用，读哪个测试」。

### 编排与回合

| 测试                                        | 覆盖什么                                   |
| ------------------------------------------- | ------------------------------------------ |
| `agent/turn-orchestrator-cassettes.test.ts` | **编排器准入**（第 35.5 节详说）           |
| `agent/tools/disclosed-turn-tools.test.ts`  | 本轮工具披露                               |
| `agent/tools/legal/list-more-tools.test.ts` | 能力目录（`list_more_tools` 与提示词同源） |
| `agent/context-budget.test.ts`              | 上下文预算                                 |
| `agent/compact.test.ts`                     | 压缩                                       |
| `agent/mid-turn-compact.test.ts`            | 回合内压缩                                 |
| `agent/context-deferral.test.ts`            | 上下文让渡                                 |
| `agent/session-carryover.test.ts`           | 承前分叉                                   |

### 意图与技能

| 测试                                            | 覆盖什么                      |
| ----------------------------------------------- | ----------------------------- |
| `intent/gold-set.test.ts`（及同目录）           | 金标集与致命误绑              |
| `skills/lawyer-capability-lock.test.ts`         | 办件锁（`$skill` / 【办件】） |
| `skills/skill-prompt-budget.test.ts`            | 注入预算（最多 2 份正文）     |
| `skills/skill-runtime.test.ts`                  | 签名与密钥来源                |
| `skills/ensure-builtin-skill-seeds.test.ts`     | 播种                          |
| `evaluation/skill-deliverable-contract.test.ts` | **技能→交付物契约**           |

### 草稿与改稿

| 测试                                      | 覆盖什么                          |
| ----------------------------------------- | --------------------------------- |
| `drafts/minimal-edit-script.test.ts`      | 最短改动算法（含 200 组随机对照） |
| `drafts/apply-surgical-edits.test.ts`     | 落改                              |
| `drafts/redline-proposal.test.ts`         | 修订提案                          |
| `drafts/tracked-render-hunk-gate.test.ts` | 空修订门                          |
| `drafts/tracked-xml-qa.test.ts`           | 成品复核（w:del/w:ins）           |
| `drafts/cross-document-edits.test.ts`     | 跨文书一致改（整批预检）          |
| `artifacts/render-docx-tracked.test.ts`   | 修订轨落盘（含多处命中安全）      |
| `integrations/word-addin/*.test.ts`       | 插件请求、自动跑、回填            |

### 交付与验收

| 测试                                          | 覆盖什么                   |
| --------------------------------------------- | -------------------------- |
| `deliverables/registry.test.ts`               | **规格表顺序被它锁住**     |
| `deliverables/validator.test.ts`              | 验收检查                   |
| `deliverables/reasoning-validator.test.ts`    | 推理门                     |
| `deliverables/reasoning-structure.test.ts`    | 五条结构检查               |
| `deliverables/verification-checklist.test.ts` | 必核清单                   |
| `delivery/resolve-delivery-tier.test.ts`      | 交付档位                   |
| `delivery/progressive-autonomy.test.ts`       | 自主解锁                   |
| `delivery/judgement-ratchet.test.ts`          | 判断项棘轮（含三条不变量） |

### 指标与评测

| 测试                                      | 覆盖什么           |
| ----------------------------------------- | ------------------ |
| `metrics/north-star.test.ts`              | 北极星口径         |
| `metrics/firm-calibrator.test.ts`         | 冷启动必须诚实拒绝 |
| `metrics/unescalated-delivery.test.ts`    | 外生信号纪律       |
| `evaluation/benchmark.test.ts`            | mock 不再必然满分  |
| `evaluation/shadow-engine-replay.test.ts` | 第二层评测证据     |
| `evaluation/true-manuscript-gate.test.ts` | 真稿门             |
| `evaluation/human-baseline.test.ts`       | 人类基准           |

### 案件与工作台

| 测试                                       | 覆盖什么                           |
| ------------------------------------------ | ---------------------------------- |
| `adapters/matter-storage/io.test.ts`       | 文件锁 stale 自愈                  |
| `adapters/matter-storage/schema.test.ts`   | schema                             |
| `application/matter-consistency.test.ts`   | 投影漂移                           |
| `cases/index.test.ts`                      | 案件索引                           |
| `desk/*.test.ts`                           | 今日、计划、期限链、传票抽取、材料 |
| `memory/adoption-service.test.ts`          | 采纳状态机                         |
| `memory/lawyer-profile-for-prompt.test.ts` | 空模板不注入                       |

### 安全与平台

| 测试                                       | 覆盖什么                       |
| ------------------------------------------ | ------------------------------ |
| `retrieval/authority-url-guard.test.ts`    | SSRF 黑名单                    |
| `retrieval/authority-pinned-fetch.test.ts` | DNS 钉扎                       |
| `platform/safe-command.test.ts`            | 命令网关                       |
| `runtime/tool-pipeline` 相关               | 中间件                         |
| `memory/team-memory-sync.test.ts`          | 团队记忆同步的密钥扫描         |
| `lawmind-server-cors-structure.test.ts`    | **手写 writeHead 必须带 CORS** |

### 协作与副本

| 测试                                                 | 覆盖什么                     |
| ---------------------------------------------------- | ---------------------------- |
| `matter-replica/security-hardening.test.ts`          | 材料完整性、密钥轮换         |
| `matter-replica/apply-ops.test.ts`                   | 操作投影（含跨机器集成）     |
| `matter-replica/cross-machine-invite-remove.test.ts` | 跨机器邀请与删除传播         |
| `matter-cloud/matter-cloud-server.test.ts`           | 认证、租户隔离、内容块完整性 |
| `agent/orchestrator/executor.test.ts`                | 工作流执行（含依赖图加固）   |
| `routing/peer-review-gate.test.ts`                   | 强制互审                     |

## 35.4 环境对测试的影响

有几件事会影响测试行为：

| 变量/环境                          | 影响                                                                         |
| ---------------------------------- | ---------------------------------------------------------------------------- |
| `VITEST=true`                      | 沙箱走 inline 模式；DNS 查询被 stub 成固定地址；`LAWMIND_SKIP_API_AUTH` 相关 |
| `LAWMIND_TOOL_SANDBOX_INLINE=1`    | 强制 inline 沙箱                                                             |
| `LAWMIND_SKIP_API_AUTH=1`          | 路由测试常设它                                                               |
| `LAWMIND_ENABLE_E2E_TEST_ROUTES=1` | 打开 E2E 专用路由（`/api/e2e/*`）                                            |
| `LAWMIND_E2E=1`                    | 渲染层走打包路径                                                             |

**注意 `VITEST=true` 会让 DNS 走 stub**（固定返回 `203.0.113.10`）——所以测 DNS 相关逻辑时要知道这一点。

## 35.5 cassette：编排器改动的准入证

这是本仓库最重要的一条测试规矩（`AGENTS.md` 里也写了）。

### 什么时候必须加

改以下任意一项：

- `turn-orchestrator*`
- 澄清门
- compact
- steer
- playbook 工具锁
- 审批管线

### cassette 的四条契约

1. **模型字节是假的**（脚本化 JSON / SSE）。
2. **`runTurn`、工具表（生产工具名）、门禁、审批、compact、steer 都是真的。**
3. **断言下一次发给模型的请求体**：
   - 某个工具被广告了没
   - 历史被改写了没
   - 引用在压缩后还在不在
   - steer 有没有落进下一次采样
4. **cassette 用完必须失败（HTTP 400）。** 不许悄悄编一条收尾消息。

### 为什么这样设计

因为**断言提示词里的中文句子是无效测试**。提示词的措辞随时会变，而且「提示词里有这句话」根本不保证「模型会照做」。

而断言「下一次请求体里有没有这个工具」是**行为契约**——它测的是引擎真的做了什么。

### 怎么写一条

入口是 `TestLawMind.builder()`（`src/lawmind/agent/testkit/`）。

基本形状：

```text
1. builder 起一个场景（工作区、工具表、初始会话）
2. 塞一段脚本化的模型响应（比如：先返回一个工具调用，再返回纯文本）
3. 跑 runTurn
4. 断言「下一次请求体」的内容
5. 脚本用完 → 必须返回 400
```

参考已有的 `review.table` 那条：

```text
it("review-table: 抽查表 intent advertises review_table_update and the table sidecar lands")
```

它同时验证了两件事：工具被广告了 + 侧车文件真的落了。

### 装配器单测的额外约束

**装配器（提示词组装）的单测只允许断言三样**：

1. 章节 id
2. 缓存边界哈希
3. 动态注入的值（律师姓名、法宝 provider）

同样不许断言「这句话还在提示词里」。

## 35.6 覆盖率棘轮

`scripts/pre-commit/check-coverage-ratchet.mjs` 的机制和文件大小棘轮一样：

- 覆盖率**不能降**。
- 降了必须在 diff 里显式抬基线（带理由）。

基线在 `scripts/pre-commit/coverage-baseline.json`。

**为什么不直接要求覆盖率 X%**：因为百分比对「已经很高的模块」没有约束力（90% 到 89% 不算问题吗？算），对「一开始就很低的模块」又太苛刻。棘轮的思路是「不许变坏」。

## 35.7 测试失败时怎么办

按这个顺序看：

### 先看是不是环境问题

| 症状              | 可能原因                                        |
| ----------------- | ----------------------------------------------- |
| 一堆 DNS 相关失败 | 有测试在真跑网络（不该有）                      |
| 沙箱相关失败      | `LAWMIND_TOOL_SANDBOX` 设了 1                   |
| 路由测试 401/403  | 没设 `LAWMIND_SKIP_API_AUTH=1`                  |
| 时间相关失败      | 时区或日期边界（用注入的 `now` 的测试不会这样） |

### 再看是不是你的改动

跑一下**相关目录**的测试，通常能定位：

```bash
pnpm exec vitest run <你改的目录>
```

### 特别注意「锁住顺序」的测试

这些测试失败往往意味着你动了不该动的东西：

| 测试                                    | 锁什么                   |
| --------------------------------------- | ------------------------ |
| `deliverables/registry.test.ts`         | 27 个 spec 的顺序        |
| `guardian/item-judgments.test.ts`       | 150 项判定表「一处不漏」 |
| `turn-orchestrator-cassettes.test.ts`   | 编排行为                 |
| `lawmind-server-cors-structure.test.ts` | 手写 writeHead 的 CORS   |
| `check-file-size.mjs`                   | 文件大小棘轮             |
| `check-coverage-ratchet.mjs`            | 覆盖率棘轮               |

**这些测试红了通常不是测试的问题，是你的改动碰到了约束。** 想清楚是「该改测试」还是「该改代码」。

## 35.8 各脚本门禁

第 12、18 章列过命令。这里按「什么时候跑」归类：

| 时机           | 跑什么                                                           |
| -------------- | ---------------------------------------------------------------- |
| 改完代码       | `pnpm exec vitest run <相关目录>`                                |
| 提交前         | `pnpm test`（或至少引擎 + 相关桌面测试）                         |
| 提交前（严格） | 加 `pnpm typecheck` 和 `pnpm --filter lawmind-desktop typecheck` |
| 发版前         | `pnpm lawmind:verify`                                            |
| 交付验收       | `pnpm lawmind:acceptance`                                        |
| 只想看交付质量 | `pnpm lawmind:gate --all --strict`                               |
| 想看发布就绪   | `pnpm lawmind:release-readiness`                                 |

`pnpm lawmind:verify` 的内容：

```text
test → typecheck → benchmark → release-readiness → bundle:desktop-server
→ 桌面端 typecheck → desktop http-smoke
```

## 35.9 写测试的几条建议

### 建议一：断言行为，不断言措辞

差的：

```text
断言系统提示里包含「最短改动」
```

好的：

```text
断言 apply_surgical_edits 把整句改动拆成了 3 段最短改动
```

### 建议二：给「不可能出现的组合」加不变量

比如棘轮那条：

```text
断言「误报率恒为 0」的情况不会出现（三条不变量）
```

这类测试防的是第 29 章案例 29.11 那种「指标一直很好看」的 bug。

### 建议三：诚实性也要测

有几类测试专门测「诚实」：

| 测什么                         | 在哪                                      |
| ------------------------------ | ----------------------------------------- |
| 没样本时返回 null 而不是 0     | `metrics/north-star.test.ts`              |
| 冷启动时校准器返回 undefined   | `metrics/firm-calibrator.test.ts`         |
| 真稿门没夹具时 SKIP            | `evaluation/true-manuscript-gate.test.ts` |
| 无落盘面的采纳记 recorded_noop | `memory/adoption-apply.test.ts`           |
| mock 模式不再必然满分          | `evaluation/benchmark.test.ts`            |

**这类测试的价值极高**，因为它们守的是「产品不撒谎」这条线。

### 建议四：只读断言要真的只读

`IDEMPOTENT_READ_TOOLS` 里的工具应该没有副作用。测这类工具时明确断言「调用前后工作区没变化」。

### 建议五：写清楚「为什么红」

测试的 failure message 和 `describe` 标题应该能让人一眼知道在守什么。看这个例子：

```text
describe("P3 冷启动必须诚实拒绝（不得产出看起来能用的校准器）")
```

标题本身就说明了设计意图。

## 35.10 一个反模式清单

| 反模式                   | 问题                           |
| ------------------------ | ------------------------------ |
| 断言提示词里有某句中文   | 措辞一变就红，且证明不了行为   |
| 断言内部函数被调用了几次 | 重构就红，没测行为             |
| 只测 happy path          | 门禁类逻辑必须测拒绝路径       |
| 用真实网络               | 慢、不稳定；有 stub 机制就用   |
| 依赖执行顺序             | Vitest 可能并行                |
| 断言 mock 满分的评测     | 第 29 章那种「看起来正常」的坑 |
| 为了过测试改测试         | 先想清是约束过时还是代码错了   |

## 35.11 已知坑（本章相关）

- **`VITEST=true` 会 stub DNS。** 测网络逻辑要注意。
- **全量 `pnpm test` 很慢。** 日常用单目录。
- **锁顺序的测试红了通常是你的改动碰到了约束。**
- **cassette 用完必须 400。** 不许编收尾消息。
- **装配器单测只断言三样**（章节 id、缓存边界哈希、动态值）。
- **覆盖率是棘轮，不是目标值。**
- **诚实性测试要保留。** 它们守的是产品不撒谎那条线。
- **mock 模式的 benchmark 不再必然满分。** 别按「mock 一定过」写断言。
