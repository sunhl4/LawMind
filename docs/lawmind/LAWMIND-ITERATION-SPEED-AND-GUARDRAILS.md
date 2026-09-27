# LawMind 迭代速度与防误改

> **状态**：诊断已完成（2026-09-20，实测数据见 §1），改造方案待落地。
> **用途**：回答两个长期痛点——「改一个小地方要很久」和「模型可能给我改坏」——给出**实测归因**与**按投入产出比排序的落地方案**。
> **不是**：不是「仓库太大所以要重写/拆仓」的论证；实测数据显示瓶颈与仓库规模基本无关。
> **交叉引用**：[DEVELOPER-WORKFLOW.md](./DEVELOPER-WORKFLOW.md) · [LAWMIND-ARCHITECTURE.md](../LAWMIND-ARCHITECTURE.md) · [LAWMIND-REPO-LAYOUT.md](../LAWMIND-REPO-LAYOUT.md) · [AGENTS.md](../../AGENTS.md)

---

## 0. 一句话

`pnpm test` 的 167 秒里，**813 个测试文件中 800 个跑完不到 0.5 秒**；整条关键路径由 3 个文件（162s / 141s / 40s）决定，其中**单个 `it` 就占 111 秒**。同时基线是**红的且 flaky**——这才是「模型改坏了我不知道」的真正放大器。

两处配置改动能把本地循环从 **167.4s 压到 48.6s（3.4×）且零失败**（已实测，见 §1.7），不需要引入任何新依赖。

---

## 1. 实测基线

**方法**：2026-09-20，10 核 macOS，工作区为当前未提交状态（dirty tree），连跑 3 次采集。

### 1.1 总量

| 项目                                              | 数值                                           |
| ------------------------------------------------- | ---------------------------------------------- |
| 仓库规模                                          | 2591 个 tracked 文件                           |
| TS/TSX 文件                                       | 2084 个（809 个 `*.test.ts` + 29 个 e2e spec） |
| 产品代码行数（excl. tests）                       | 236,663 行                                     |
| 测试代码行数                                      | 101,085 行                                     |
| `pnpm typecheck`（engine，`tsc --noEmit`）        | **3.89s**                                      |
| `pnpm test`（`vitest run`，813 文件 / 4367 用例） | **167.4s**                                     |

**类型检查不是瓶颈。** 3.89 秒的 engine typecheck 已经很快，不需要 TypeScript 7 native / `tsgo`（那是 8–12× 提速，但对你 3.89s 的基数没意义）。

### 1.2 `pnpm test` 耗时分解

```text
Duration 166.58s
  transform     25.81s
  setup        115.73s   ← 每个测试文件重复执行 test/lawmind-setup.ts
  import       133.94s   ← 每个 worker 重复冷加载模块图
  tests        413.39s   ← 跨 worker 的累计 CPU 时间
  environment   45.42s
```

`setup` + `import` 合计约 250 秒，是 813 次「重复做同一件事」的成本，不是真实计算。

### 1.3 耗时分布 —— 决定性证据

```text
813 个测试文件
  < 0.5s  ████████████████████████████████████████  800 个
  0.5-1s                                            3 个
  1-5s                                              4 个
  5-30s                                             3 个
  > 30s                                             3 个
```

3 个 `>30s` 的文件：

| #   | 文件                                                  | 耗时       |
| --- | ----------------------------------------------------- | ---------- |
| 1   | `src/lawmind/agent/tools/engine-tools.test.ts`        | **162.0s** |
| 2   | `src/lawmind/evaluation/shadow-engine-replay.test.ts` | **141.4s** |
| 3   | `src/lawmind/agent/tools/legal/search-tools.test.ts`  | 40.3s      |

最慢的**单个** `it`（111.2s）：

> `engine shadow replay (engine-scripted-model) runs every builtin fixture through the real runTurn pipeline`

**注意 `engine-tools.test.ts` 一个文件 162.0s ≈ 整轮 167.4s。** 这两个文件本身就是关键路径。

### 1.4 可疑指纹：整数秒耗时

大量 `it` 的耗时精确落在 **10.0s / 10.1s / 20.0s / 20.1s**。这种整秒聚集是**固定等待或超时兜底**的典型特征，不是真实计算量。候选（`render_document`、`execute_workflow`、`draft_document`、`search_statute` 等）需要逐一确认是否存在 `vi.waitFor` / 轮询超时 / 真实网络尝试后退化。

全仓仅 `src/lawmind/evaluation/shadow-engine-replay.test.ts:133` 有显式 `120_000` 超时；其余需要看默认超时与轮询逻辑。

### 1.5 反面证据：test selection 对你几乎无效

```bash
npx vitest related src/lawmind/runtime/tool-pipeline.ts --run
→ 选中 96 / 813 个文件，耗时 165.1s
```

**只跑 1/8 的文件，耗时几乎没变（167.4s → 165.1s）。**

原因：`tool-pipeline.ts` 是 hub 模块，反向依赖面很宽（96 个文件）；而真正的长尾在 fixture 全量回放，**与文件数量无关**。业界最常推的 test impact analysis 在你的形态下收益接近于零。

> **结论：先做关键路径手术，再考虑 test selection。顺序反了会白折腾。**

### 1.6 基线是红的，而且 flaky

3 次运行失败的是**不同的测试**：

| 运行             | 失败文件                                                | 失败用例数 |
| ---------------- | ------------------------------------------------------- | ---------- |
| 全量 #1          | `src/lawmind/agent/runtime-resume.test.ts`              | 2          |
| 全量 #2（json）  | `src/lawmind/agent/turn-orchestrator-cassettes.test.ts` | 1          |
| `vitest related` | `src/lawmind/agent/turn-orchestrator-cassettes.test.ts` | 1          |

同一份代码，两次全量跑出**两组不同的失败** ⇒ 两者**都是 flaky 的**。

> 这是本次诊断里最需要先处理的问题：**基线红 + flaky ⇒ 你拿到一个 fail 无法区分「模型改坏了」还是「本来就抖」**。信任信号塌掉之后，唯一剩下的策略就是全量重跑 + 人工复核，于是「改一个小地方也很久」。§6 的所有护栏措施，在噪声修好之前收益都会被淹没。

### 1.7 配置实验矩阵（已验证）

在 §1.5 的结论之后，直接实测了几种 Vitest 配置（均为 CLI 覆盖，未改动仓库文件）：

| 配置                                         | wall      | setup  | import | tests  | 失败             |
| -------------------------------------------- | --------- | ------ | ------ | ------ | ---------------- |
| 现状（全量 / `forks` / `isolate`）           | 167.4s    | 115.7s | 133.9s | 413.4s | flaky（见 1.6）  |
| 排除 2 个回放文件                            | 83.8s     | 119.0s | 187.4s | 131.2s | 0                |
| 排除回放 + `--pool=threads`                  | **48.6s** | 77.9s  | 95.9s  | 104.5s | **0**            |
| 排除回放 + `--pool=threads` + `--no-isolate` | 41.8s     | 11.2s  | 34.3s  | 106.9s | **3 个文件失败** |

复现：

```bash
/usr/bin/time -p npx vitest run \
  --exclude '**/engine-tools.test.ts' \
  --exclude '**/shadow-engine-replay.test.ts' \
  --pool=threads
```

**两条结论：**

1. **`pool: 'threads'` 是免费的大胜**：83.8s → 48.6s（setup 119s→78s，import 187s→96s），全绿，零失败。
2. **`isolate: false` 收益小、代价大，应推迟。** 它进一步把 setup 从 77.9s 砍到 11.2s（证明那 78 秒几乎全是「每文件重建环境」），但 wall 只从 48.6s 降到 41.8s（-14%），代价是**有测试依赖跨文件干净状态**：

   ```text
   src/lawmind/agent/draft-worker.test.ts            10 个用例
   src/lawmind/agent/orchestrator/executor.test.ts    3 个用例
   src/lawmind/platform/build-agent-fleet.test.ts     1 个用例
   ```

   而且两次运行失败数不一致（6 vs 14）——**`isolate: false` 会引入新的不确定性**，正是 §1.6 已经诊断出的那类噪声。除非先修好这 3 个文件，否则不要全局开启。

---

## 2. 诊断结论

三个根因，都不是「仓库大」：

| #   | 根因                                             | 证据                                |
| --- | ------------------------------------------------ | ----------------------------------- |
| 1   | **两个 fixture 全量回放测试独占关键路径**        | 162s + 141s ≈ 整轮 167s；单 it 111s |
| 2   | **813 次重复的模块图冷加载 + per-file setup**    | setup 115.7s + import 133.9s        |
| 3   | **基线红 + flaky，破坏「改坏了没有」的判定能力** | 1.6 节三次运行两个不同失败          |

次级放大器（未实测，但结构性可疑）：

- `pnpm lawmind:verify` 当时串的是 test → typecheck → benchmark → release-readiness → bundle → desktop typecheck → http-smoke。2026-09 起这条链已改成与 PR `verify` 作业一致（覆盖率只跑一遍，不含 mock benchmark），见第 18 章。
- `pnpm lawmind:desktop:e2e:pr` 为 19 个 Playwright spec 且 `--workers=1` 串行。

---

## 3. 方案 A：给测试分层（第一优先）

把「秒级反馈」和「分钟级验证」分开。业界共识是先跑得更少，再谈跑得更快。

```jsonc
// package.json（提案）
"test":         "vitest run --exclude '**/engine-tools.test.ts' --exclude '**/shadow-engine-replay.test.ts'",
"test:replay":  "vitest run src/lawmind/agent/tools/engine-tools.test.ts src/lawmind/evaluation/shadow-engine-replay.test.ts",
"test:full":    "vitest run"
```

- 本地默认走 `pnpm test` ⇒ **实测 48.6s**（该数字同时包含 §4.1 的 `pool: 'threads'`；新的长尾是 `search-tools.test.ts` 40.3s）。
- 仅排除回放文件、不改 pool 时为 **83.8s**——所以 §4.1 是必需项，不是可选项。
- `pnpm test:replay` 在改动 `turn-orchestrator*` / engine 工具 / 交付路径时按需跑。
- **CI 与 `pnpm lawmind:verify` 保持 `test:full` 不变**，覆盖率棘轮与门槛不受影响。

**验收**：本地 `pnpm test` wall time ≤ 55s；`pnpm test:full` 仍为全绿（在 §5 修好 flaky 之后）。

**为何不直接把回放改成更少 fixture**：`engine-tools.test.ts` 的回放是 engine 契约回归的主要防线（见 `AGENTS.md` 的 cassette 契约），不应用降低覆盖来换速度——只应改变**它在哪个循环里跑**。

---

## 4. 方案 B：配置层调优（第一优先，零代码改动）

### 4.1 `pool: 'threads'`——已实测，直接采用

`vitest.config.ts` 当前为 `pool: "forks"`。改为 `"threads"` 后（配合 §3 的排除）：

```text
83.8s → 48.6s   （setup 119.0s→77.9s，import 187.4s→95.9s，tests 131.2s→104.5s，全绿）
```

Vitest 官方 [Improving Performance](https://vitest.dev/guide/improving-performance.html) 明确说明 `forks` 兼容性更好但在大项目里更慢。你的测试不依赖进程级 API（`process.chdir()` 等）——810 个文件全绿验证了这一判断。

> 需在 CI 上复核一次。`forks` 的价值是隔离崩溃（segfault / 挂起），切到 `threads` 后若出现难复现的挂起，可回退。

### 4.2 `isolate: false`——收益小、代价大，**建议推迟**

它是唯一能把 setup 从 78s 砍到 11s 的开关（证明那 78 秒几乎全是「每文件重建环境」），但 wall 只再降 14%（48.6s → 41.8s），且会让 3 个依赖跨文件干净状态的测试失败：

```text
src/lawmind/agent/draft-worker.test.ts            10 个用例
src/lawmind/agent/orchestrator/executor.test.ts    3 个用例
src/lawmind/platform/build-agent-fleet.test.ts     1 个用例
```

更严重的是失败数在两次运行间不一致（6 vs 14）——**它会引入 §1.6 已诊断出的那类不确定性**。

**顺序**：先修好这 3 个文件（它们大概率依赖模块级单例 / 计数器的隐式重置），再评估是否开启。不要为了 7 秒买新噪声。

同类先例可参考 [NangoHQ PR #6571](https://github.com/NangoHQ/nango/pull/6571)：vitest 3→4 时 `singleFork` 语义变化导致 import 从 36s 涨到 1278s，那是一个**必须**用 `isolate: false` 才能修的量级问题；你的量级不同，所以结论也不同。

### 4.3 `test/lawmind-setup.ts` 变轻（补充手段）

当前 `test/lawmind-setup.ts` 顶部是静态 import：

```typescript
import { drainMatterProjections } from "../src/lawmind/application/services/matter-write-service.js";
```

`matter-write-service.ts`（376 行）会进一步拉入 `node:worker_threads`、`audit`、`matter-storage`（schemas / io）、`matter-projection`。这让**每个**测试文件（含完全不碰 matter 的 renderer 测试）都要冷加载这一整块 engine——正是 §1.7 里那 77.9s 的 setup 成本。

`drainMatterProjections` 本身是 `async`，可以干净地惰性化：

```typescript
afterEach(async () => {
  const { drainMatterProjections } =
    await import("../src/lawmind/application/services/matter-write-service.js");
  await drainMatterProjections();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
```

更彻底的做法是只在真正排过 matter 投影时才加载（用一个轻量模块暴露 pending 计数）。模块实例在 worker 内是缓存共享的，惰性加载不改变 `pendingMatterProjections` 的语义。

> 注意：单纯把 `import` 挪进 `afterEach` 仍会在**每个** worker 首次调用时加载一次——但那是 ≤8 次而非 813 次，仍是净收益。真正的零成本需要「按需」判断。

### 4.4 高核机器可加 sharding

```bash
vitest run --reporter=blob --shard=1/4 &
VITEST_MAX_WORKERS=7 vitest run --reporter=blob --shard=2/4 &
wait
```

Vite 主线程在高并发下会成为瓶颈（813 文件的模块请求集中在单一 Vite server）。这条对 CI 多 runner 更有用。

---

## 5. 方案 C：修 flaky（与 A 同等优先）

**这是恢复可信信号的前提，不是可选项。**

1. 把 `runtime-resume.test.ts` 与 `turn-orchestrator-cassettes.test.ts` 的失败定位到具体断言（应可复现：见 §1.6 的失败用例名）。
2. 若短期无法定性，**quarantine**（单独 tag / 单独 job）并留 issue，而不是让它继续随机红——随机红比明确红危害更大。
3. 引入 flaky 检测：本地/CI 对受影响文件跑 N 次（`--retry` 只用于诊断，不要用 `retry` 掩盖）。
4. 记录一个 **green baseline 清单**：哪些测试已知 flaky、哪些已知红。改动前先确认基线，再归因。

---

## 6. 方案 D：防误改——机制化护栏

### 6.1 核心原则

arXiv 2604.11088《[Guardrails Beat Guidance](https://arxiv.org/html/2604.11088v2)》（大规模实证）：

> 约束 agent **不该做什么**（negative constraints）比规定它「应该怎么做」（positive directives）更有效；善意的正面指导（「遵循代码风格」「处理边界情况」）反而可能引入测试看不见的回归。

配套共识（[CLAUDE.md drift 维护](https://mcp.directory/blog/claude-md-agents-md-maintenance-2026)、[配置层分析](https://tianpan.co/blog/2026/02/25/claude-md-agents-md-ai-coding-agent-instruction-files)）：

> **只要一条规则能被机械检查，它就应该从散文搬进 lint / hook / 类型 / CI。**

现状是健康的：`AGENTS.md` 仅 71 行，`CLAUDE.md` 是 5 行指向它的 stub（跨工具桥接的正确做法）。**不要把它写长**（社区上限约 200–300 行；超限会导致模型忽略真实指令）。

### 6.2 architecture fitness function：`dependency-cruiser`

把 `docs/LAWMIND-ARCHITECTURE.md` 的分层变成可执行规则，并**增量采用**：

```bash
depcruise-baseline src                          # 生成存量违规快照
npx depcruise src --ignore-known                # CI：只拦新增越界
```

违规信息应写成**给 agent 的行动指引**（「这个 import 不允许，请改用 X」），而不是单纯的 fail——agent 对可读反馈的自愈能力很强。

**为何不用 `eslint-plugin-boundaries`**：本仓 lint 是 oxlint，实测 `npx oxlint --rules` 中**不存在**任何 restricted-import / boundaries / no-cycle 规则，该插件无法挂入。dependency-cruiser 是独立工具，可接入现有 `scripts/pre-commit/` + `git-hooks/pre-commit` 生态。

### 6.3 分离「写」与「判」：fresh-context evaluator

参考 [anthropics/cwc-long-running-agents](https://github.com/anthropics/cwc-long-running-agents) 与 [Effective harnesses](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)：

- 每个验收条件默认 `false`，**写代码的 agent 不能给自己的活打勾**。
- 判定由**没有写权限、且从未看过构建过程**的新上下文 agent 完成，只回 `PASS` / `NEEDS_WORK`。
- 本仓已有 `bugbot` 与 `security-review` subagent，可直接接成该循环。

### 6.4 跨文件特性：spec-driven

[github/spec-kit](https://github.com/github/spec-kit/)：Spec → Plan → Tasks → Implement → Converge，每阶段产出 Markdown 交给下一阶段。对「改一行」是过度设计；对「模型改坏」高发的跨文件特性值得使用。

---

## 7. 方案 E：收敛模型上下文

- **repo map 原理**（[aider](https://aider.chat/docs/repomap.html)）：tree-sitter 抽符号 → 文件依赖图 → PageRank 排序 → 塞进 token 预算。落地工具 [yamadashy/repomix](https://github.com/yamadashy/repomix) 的 `--compress`（tree-sitter 压缩，省约 70% token）。
- **per-package `AGENTS.md`**：新增 `src/lawmind/AGENTS.md` 与 `apps/lawmind-desktop/AGENTS.md`。改 desktop 时不必读 engine 规则。OpenAI 自仓库有 88 个此类文件。

---

## 8. 参考：test selection 工具（第二/第三优先）

在 §3 落地之后再评估：

| 工具                                                                 | 机制                                  | 备注                                              |
| -------------------------------------------------------------------- | ------------------------------------- | ------------------------------------------------- |
| `vitest --changed origin/main` / `vitest related <files>`（内置）    | 静态 import 图，浅层                  | 会漏传递依赖（vitest#4933）                       |
| [vitest-affected](https://github.com/craigvandotcom/vitest-affected) | 运行时 import 图 + 持久化反向图，~5ms | README 明确面向「agent 每次改完都要跑测试」场景   |
| [testpick](https://github.com/TwistTheoryGames/testpick)             | 运行时覆盖率驱动                      | 能抓静态图看不到的耦合                            |
| Nx affected / Turborepo `--affected`                                 | package 级任务图                      | **对本仓不适用**（仅 2 个 package，粒度等于没有） |

---

## 9. 执行顺序与验收

| #   | 动作                                                          | 预期收益              | 风险                          | 验收                                    |
| --- | ------------------------------------------------------------- | --------------------- | ----------------------------- | --------------------------------------- |
| 1   | 拆分 `test` / `test:replay` / `test:full`（§3）               | 167.4s → **83.8s**    | 低（CI 不变）                 | 本地 `pnpm test` ≤95s；`test:full` 全绿 |
| 2   | `vitest.config.ts` 改 `pool: 'threads'`（§4.1）               | 83.8s → **48.6s**     | 低（已实测全绿；CI 复核一次） | 全量绿；wall ≤55s                       |
| 3   | 定位并修/quarantine 2 个 flaky 测试（§5）                     | **恢复可信信号**      | 低                            | 连续 3 次全量跑，失败集合一致           |
| 4   | `test/lawmind-setup.ts` 惰性加载（§4.3）                      | setup 成本下降        | 低                            | 全量绿；setup 时间下降                  |
| 5   | 排查 10s/20s 整数秒等待（§1.4）                               | 剩余长尾下降          | 中                            | 无整秒聚集                              |
| 6   | 修 3 个依赖 isolation 的文件，再评估 `isolate: false`（§4.2） | 48.6s → 41.8s（-14%） | **中高（会引入新噪声）**      | 全量重复运行结果一致                    |
| 7   | 接入 dependency-cruiser（baseline 模式）+ pre-commit（§6.2）  | 架构越界成为即时反馈  | 低（不要求先修存量）          | CI 只拦新增违规                         |
| 8   | evaluator 循环 + per-package AGENTS.md + repomix（§6.3 / §7） | 防误改                | 低                            | —                                       |

> **第 3 步是其它所有步骤的前提。** 在 flaky 修好之前，护栏给出的信号同样不可信。
>
> 第 1+2 步加起来是 **3.4× 提速、零失败、零新增依赖**，且只动了 1 个配置文件 + `package.json` 的两个 script 名。这是本次诊断中性价比最高的动作。

---

## 10. 附：复现命令

```bash
# 总量与时序
/usr/bin/time -p pnpm typecheck
/usr/bin/time -p pnpm test

# 每文件耗时分布
npx vitest run --reporter=json --outputFile=/tmp/lm-vitest-report.json
node -e 'const r=JSON.parse(require("fs").readFileSync("/tmp/lm-vitest-report.json","utf8"));
r.testResults.map(f=>({f:f.name,d:(f.endTime-f.startTime)/1000}))
 .sort((a,b)=>b.d-a.d).slice(0,10).forEach(x=>console.log(x.d.toFixed(1)+"s",x.f))'

# test selection 收益验证
/usr/bin/time -p npx vitest related src/lawmind/runtime/tool-pipeline.ts --run

# Vitest 配置体检
npx vitest doctor
```

---

## 11. 参考链接

- [Vitest — Improving Performance](https://vitest.dev/guide/improving-performance.html) · [pool](https://vitest.dev/config/pool) · [isolate](https://vitest.dev/config/isolate) · [CLI（`--changed` / `related` / sharding）](https://vitest.dev/guide/cli)
- [sverweij/dependency-cruiser](https://github.com/sverweij/dependency-cruiser/) · [baseline 用法](https://github.com/sverweij/dependency-cruiser/blob/main/doc/cli.md)
- [craigvandotcom/vitest-affected](https://github.com/craigvandotcom/vitest-affected) · [TwistTheoryGames/testpick](https://github.com/TwistTheoryGames/testpick)
- [Guardrails Beat Guidance (arXiv 2604.11088)](https://arxiv.org/html/2604.11088v2)
- [Anthropic — Effective harnesses for long-running agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents) · [anthropics/cwc-long-running-agents](https://github.com/anthropics/cwc-long-running-agents)
- [github/spec-kit](https://github.com/github/spec-kit/) · [Sourcegraph — Best Monorepo Build Tools 2026](https://sourcegraph.com/blog/monorepo-build-tools)
- [aider repo map](https://aider.chat/docs/repomap.html) · [yamadashy/repomix](https://github.com/yamadashy/repomix)
