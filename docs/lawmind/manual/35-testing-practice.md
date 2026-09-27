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

`pnpm test` 的收录范围在 `vitest.config.ts`：`src/lawmind/**/*.test.ts`（含 `integration/`）、桌面 `server/`、`src/**/*.test.ts(x)`、`electron/**/*.test.ts`。Playwright 的 `e2e/*.spec.ts` **不在**这条命令里，另走 `pnpm lawmind:desktop:e2e:pr`（分层与八个真机规格见第 18 章）。

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

跑一组（按路径模式），或只跑标题里带某句的用例：

```bash
pnpm exec vitest run src/lawmind/drafts src/lawmind/memory
pnpm exec vitest run src/lawmind/agent/turn-orchestrator-cassettes.test.ts -t "review-table"
```

**性能提示**：全量 `pnpm test` 很慢（几千个测试）。日常改动用单文件或单目录。要对齐 CI 时再跑 `pnpm test:coverage`（只跑一遍，并写出棘轮要读的报告）。`test:watch` 是 `vitest` 不带 `run`，会停在监视模式。

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

| 测试                                          | 覆盖什么                               |
| --------------------------------------------- | -------------------------------------- |
| `deliverables/registry.test.ts`               | **规格 type 的显式顺序**（现为 27 个） |
| `deliverables/validator.test.ts`              | 验收检查                               |
| `deliverables/reasoning-validator.test.ts`    | 推理门                                 |
| `deliverables/reasoning-structure.test.ts`    | 五条结构检查                           |
| `deliverables/verification-checklist.test.ts` | 必核清单                               |
| `delivery/resolve-delivery-tier.test.ts`      | 交付档位                               |
| `delivery/progressive-autonomy.test.ts`       | 自主解锁                               |
| `delivery/judgement-ratchet.test.ts`          | 判断项棘轮（含三条不变量）             |

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
| `runtime/tool-pipeline.test.ts`            | 中间件组合                     |
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

`test/lawmind-setup.ts` 在每个 Vitest 进程里先做这几件事（`vitest.config.ts` 的 `setupFiles`）：

| 它实际做的                             | 影响                                                                                  |
| -------------------------------------- | ------------------------------------------------------------------------------------- |
| `VITEST=true`                          | 工具沙箱走 inline（`resolveSandboxExecutionMode`）；DNS 查询被 stub 成 `203.0.113.10` |
| 未设置时写入 `LAWMIND_KEY_DIR`         | 审计 HMAC / 邮件凭证密钥进临时目录，不碰开发者的 `~/.lawmind/keys`                    |
| 未设置时 `LAWMIND_ROUTER_MODE=keyword` | 壳里有 API key 也不会在单测里打真实分类器                                             |
| 每个用例结束后                         | 排空案件投影，并 `unstubAllGlobals` / `restoreAllMocks`                               |

它**不会**设置 `LAWMIND_SKIP_API_AUTH`。路由单测是直接调 `handleXxxRoutes`，不经过本地 API 鉴权。

| 变量                               | 谁在用、影响什么                                                                         |
| ---------------------------------- | ---------------------------------------------------------------------------------------- |
| `LAWMIND_TOOL_SANDBOX_INLINE=1`    | 即使不在 Vitest 里，也强制 inline 沙箱                                                   |
| `LAWMIND_TOOL_SANDBOX=1`           | 打开沙箱策略。Vitest 下执行模式仍是 inline；子进程 runner 缺失才会 `SANDBOX_UNAVAILABLE` |
| `LAWMIND_SKIP_API_AUTH=1`          | 开发态 HTTP 跳过 bearer。打包态（`LAWMIND_PACKAGED=1`）忽略它。路由单测不靠它            |
| `LAWMIND_ENABLE_E2E_TEST_ROUTES=1` | 打开 `/api/e2e/*`。Playwright / Electron 夹具会设；平时单测默认关着                      |
| `LAWMIND_E2E=1`                    | 且 `dist/index.html` 存在时，壳加载打包后的渲染层                                        |

测 DNS 钉扎或 SSRF 时，记住 lookup 已被 stub 成 `203.0.113.10`。要测真实解析，在该用例里自己注入 `lookup`，不要依赖进程去打网。

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

`pnpm test:coverage:ratchet` → `scripts/pre-commit/check-coverage-ratchet.mjs`。它读 `coverage/coverage-summary.json` 的**全局**四项（statements / branches / functions / lines），对照 `scripts/pre-commit/coverage-baseline.json` 里的地板。

实际规则：

- 低于 `地板 − tolerancePct` 才算下跌失败。当前容差是 **1.5** 个百分点，用来吸收测量抖动和 macOS 地板 / Ubuntu CI 的差异。掉在容差里不会红。
- 高于 `地板 + maxHeadroomPct` 也失败（现为 **3** 个百分点）。这是「地板远低于实测」的闸：覆盖率涨了却不收紧，之后可以无声跌回旧地板。3 大于 1.5，避免合法的跨环境上浮被当成地板过低。
- 报告比任一被统计源文件旧，直接失败（陈旧绿等于没查）。确要在旧报告上比对才加 `--allow-stale` 或 `LAWMIND_ALLOW_STALE_COVERAGE=1`。这两条只跳过新鲜度，不跳过地板比较。
- 接受一次新测量：`node scripts/pre-commit/check-coverage-ratchet.mjs --update`。它把**当前百分比写成新地板**，升高或降低都会写进去，并保留 `tolerancePct` / `maxHeadroomPct`。JSON 里没有「理由」字段；理由写在提交说明里。
- Vitest 自己不再设 `coverage.thresholds`。门槛只有这一处，避免两个数字。
- 统计范围是 `src/lawmind/**/*.ts`、桌面 `server/**/*.ts`、渲染层 `*.ts(x)`。不含 `electron/`、测试文件、`index.ts`、`types.ts`。

这和文件大小棘轮不是同一套（大小棘轮有 NEW / STALE / GROWN，见第 18.6 节）。覆盖率的第二道闸是抬头：实测高出地板超过 `maxHeadroomPct` 就红，逼你在 diff 里 `--update`。判断本身在 `evaluateCoverageRatchet`，由 `scripts/pre-commit/check-coverage-ratchet.test.ts` 锁住。

脚本放在 `scripts/pre-commit/`，但 **git pre-commit 钩子不跑它**。它在 `pnpm lawmind:verify` 和 PR 的 `verify` 作业里，且必须紧跟刚生成的 `pnpm test:coverage`。

## 35.7 测试失败时怎么办

按这个顺序看：

### 先看是不是环境问题

| 症状                         | 可能原因                                                                         |
| ---------------------------- | -------------------------------------------------------------------------------- |
| DNS / 钉扎断言对不上固定地址 | 用例在打真网，或忘了 `VITEST=true` 会把 lookup stub 成 `203.0.113.10`            |
| `SANDBOX_UNAVAILABLE`        | 走了子进程沙箱且 runner 不在。Vitest 默认 inline；查是不是绕开了 `VITEST`        |
| HTTP 401/403                 | 打的是真本地服务，不是路由单测。开发态才认 `LAWMIND_SKIP_API_AUTH=1`；打包态忽略 |
| 路由单测 401                 | 多半不是鉴权：这些测试直接调 handler。先看状态码是 handler 自己返回的            |
| 时间相关失败                 | 时区或日期边界（注入 `now` 的测试不会这样）                                      |
| 覆盖率棘轮报「报告已陈旧」   | 源文件比 `coverage/coverage-summary.json` 新。先重跑 `pnpm test:coverage`        |

### 再看是不是你的改动

跑一下**相关目录**的测试，通常能定位：

```bash
pnpm exec vitest run <你改的目录>
```

### 特别注意「锁住顺序」的测试

这些测试失败往往意味着你动了不该动的东西：

| 测试                                    | 锁什么                                             |
| --------------------------------------- | -------------------------------------------------- |
| `deliverables/registry.test.ts`         | 内置 spec 的 type 序列（现为 27 个，写死在断言里） |
| `guardian/item-judgments.test.ts`       | 150 项判定表「一处不漏」                           |
| `turn-orchestrator-cassettes.test.ts`   | 编排行为                                           |
| `lawmind-server-cors-structure.test.ts` | 手写 writeHead 的 CORS                             |
| `check-file-size.mjs`                   | 文件大小棘轮                                       |
| `check-coverage-ratchet.mjs`            | 覆盖率棘轮                                         |

**这些测试红了通常不是测试的问题，是你的改动碰到了约束。** 想清楚是「该改测试」还是「该改代码」。

## 35.8 各脚本门禁

第 12、18 章列过命令。这里按「什么时候跑」归类：

| 时机                       | 跑什么                                                                |
| -------------------------- | --------------------------------------------------------------------- |
| 改完一块                   | `pnpm exec vitest run <相关目录>`                                     |
| 每次 `git commit`          | 钩子只跑暂存文件的 oxlint + oxfmt。不跑测试、不跑覆盖率、不跑文件大小 |
| 要对齐 PR 的 `verify` 作业 | `pnpm lawmind:verify`（慢；与 CI 同一条链，测试只跑一遍）             |
| 发版质量证据               | `pnpm lawmind:verify:release`（scripted benchmark，不过阈值就失败）   |
| 交付验收                   | `pnpm lawmind:acceptance`                                             |
| 只看交付质量               | `pnpm lawmind:gate --all --strict`                                    |
| 只看发布就绪报告           | `pnpm lawmind:release-readiness`                                      |
| 桌面点击路径               | `pnpm lawmind:desktop:e2e:pr`（不在 `pnpm test` 里）                  |

类型检查不在钩子里。改了跨文件类型时另跑 `pnpm typecheck`、`pnpm --filter lawmind-desktop typecheck`（只覆盖渲染进程）和 `pnpm typecheck:desktop-node`（`server/` 与 `electron/*.ts`）。

`pnpm lawmind:verify` 与 `.github/workflows/lawmind-ci.yml` 的 `verify` 作业是同一条链：

```text
test:coverage → coverage ratchet → skills golden --compare
→ typecheck → bundle:desktop-server → 桌面 typecheck → desktop-node typecheck
→ renderer CSS → renderer CSS sync → renderer 禁止 node 导入 → UI 文案
→ 平台契约 → desktop http-smoke → release-readiness
```

文件大小棘轮是旁边的 `file-size-check` 作业（`node scripts/pre-commit/check-file-size.mjs`），不在这条链里，钩子也不跑。

mock benchmark 不在 `verify` 里。`release-readiness` 若读到一份 `modelMode` 不是 scripted/real 的 benchmark JSON，退出码是 1。缺文件（ENOENT）在非 `--strict` 时记已知风险、退出码 0。

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

- **`VITEST=true` 会 stub DNS，并强制 inline 沙箱。** 它不跳过 API 鉴权，也不替你设 `LAWMIND_SKIP_API_AUTH`。
- **全量 `pnpm test` 很慢。** 日常用单目录。对齐 CI 用 `pnpm lawmind:verify`，不要在同一次检查里把全量测试跑两遍。
- **提交钩子不跑测试。** 红的测试不会被钩子拦住。
- **引擎测试不许 `vi.stubGlobal("fetch")`。** 出口代理在没有 `fetchImpl` 时走 `node:http`（DNS 钉扎），全局 mock 会被绕过，假端点变成真网络。改用 `127.0.0.1` cassette，或给工厂传入 `fetchImpl`。`pnpm lawmind:check:no-global-fetch-stub` 守着，已接进 `lawmind:verify` 和 CI。
- **锁顺序的测试红了通常是你的改动碰到了约束。**
- **cassette 用完必须 400。** 不许编收尾消息。这条没有 git 钩子，漏加不会在提交时红。
- **装配器单测只断言三样**（章节 id、缓存边界哈希、动态值）。
- **覆盖率地板有 1.5 个百分点下跌容差，抬头超过 3 个百分点会失败。** 只在 CI / `lawmind:verify` 里查。涨了用 `--update` 收紧。
- **诚实性测试要保留。** 它们守的是产品不撒谎那条线。
- **mock 模式的 benchmark 不再必然满分，也不能交给发布就绪。**
