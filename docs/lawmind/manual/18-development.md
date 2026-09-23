# 第 18 章 开发与测试

这一章给要改这个仓库的人看：测试怎么分层、加东西要动哪些地方、有哪些机器守着的规矩。

## 18.1 环境与命令

Node 22+（`.nvmrc` 是 `22`），pnpm 10.23.0（`package.json` 的 `packageManager`）。

| 命令                                      | 干什么                             |
| ----------------------------------------- | ---------------------------------- |
| `pnpm test`                               | Vitest：`src/lawmind` 与桌面端单测 |
| `pnpm test:watch`                         | 监视模式                           |
| `pnpm test:coverage`                      | 带覆盖率                           |
| `pnpm typecheck`                          | 引擎类型检查                       |
| `pnpm --filter lawmind-desktop typecheck` | 桌面端类型检查                     |
| `pnpm typecheck:desktop-node`             | 桌面 Node 侧类型检查               |
| `pnpm lawmind:bundle:desktop-server`      | 打包本地服务为 CJS                 |
| `pnpm lawmind:verify`                     | 全量门禁（见下）                   |

`pnpm lawmind:verify` 串的是：

```text
test → typecheck → benchmark → release-readiness → bundle:desktop-server
→ 桌面端 typecheck → desktop http-smoke
```

这是提交前想要一条命令过全部门禁时用的。它比较慢，适合 CI 或发版前，不适合每次改动都跑。

## 18.2 测试怎么分层

这个仓库的测试有清晰的四层，混用会出问题。

### 第一层：单元测试（`*.test.ts` 与实现同目录）

绝大多数测试是这种。规矩是**与实现同目录**，文件名 `<实现名>.test.ts`。

命名风格是「测试文件路径 = 实现文件路径 + `.test`」，比如 `src/lawmind/memory/adoption-service.test.ts`。

### 第二层：HTTP 路由测试

在 `apps/lawmind-desktop/server/lawmind-server-route-*.test.ts`，一个路由文件配一个测试文件。

`describe` 的命名基本就是路由名（比如 `describe("lawmind-server-route-redline")`），个别用函数名（比如 `handleLawyerDeskRoutes`）。

### 第三层：渲染层测试（`*.test.tsx`）

在 `apps/lawmind-desktop/src/renderer/`，用 Testing Library 测组件行为。

### 第四层：真机端到端（Playwright + Electron）

在 `apps/lawmind-desktop/e2e/`。这一层有**两套互斥的配置**——浏览器 mock 和真机 Electron 不能混跑，有一条测试专门守着这个分区（`e2e-spec-partition.test.ts`）。

真机 Electron 套件的清单在 `e2e/electron-specs.ts` 的 `ELECTRON_SPEC_FILES` 里，八个：

```text
app-driver
bundle-download-electron
daemon-supervision
electron-golden-path
electron-file-deeplink
first-matter-journey
judgment-escalation-electron
server-crash-recovery
```

跑法：

```bash
pnpm --filter lawmind-desktop test:e2e:install   # 一次性装 Chromium
pnpm lawmind:desktop:e2e
pnpm lawmind:desktop:e2e:pr                      # PR 用的那套，--workers=1
pnpm lawmind:desktop:e2e:electron                # 打包服务 + 构建渲染层 + 真机
```

有一条重要提醒（写在 `apps/lawmind-desktop/README.md`）：Playwright 会注入 Electron preload 的替身，**那是测试替身，不是可以发布的网页版工作台**。

## 18.3 改编排器必须加 cassette

这是本仓库最特别的一条工程规矩，写在 `AGENTS.md` 里。

触发条件：改动 `turn-orchestrator*`、澄清门、compact、steer、playbook 工具锁、审批管线中的任何一个。

要求：**在 `src/lawmind/agent/turn-orchestrator-cassettes.test.ts` 里加一条 cassette。**

cassette 的做法（借自 Codex 的 `test_codex`）：

1. 模型字节是假的（脚本化的 JSON / SSE）。
2. `runTurn`、工具表（用生产工具名）、门禁、审批、compact、steer **全是真的**。
3. 断言**下一次发给模型的请求体**：某个工具被广告了没、历史被改写了没、引用在压缩后还在不在、steer 有没有进下一次采样。
4. cassette 用完了必须失败（HTTP 400）。不许悄悄编一条「助手收尾消息」出来。

页面上那句话概括了为什么要这样：

> 不要断言中文句子还在不在系统提示词里。

也就是说：**别测「提示词里有没有这句话」，要测「引擎做出了什么行为」。** 前者改一个字就红，而且证明不了任何事；后者是真的行为契约。

配套的一条约束：**装配器的单测只允许断言三样东西**——章节 id、缓存边界哈希、动态注入的值（律师姓名、法宝 provider）。同样不许断言「这句话还在提示词里」。

### 影子回放不是入场券

`src/lawmind/evaluation/shadow-engine-replay.ts` 仍然用于**交付物 / lint 召回**的回归，但它**不是**编排器改动的准入证明。准入证明是 cassette。

## 18.4 评测的三层证据模型

`src/lawmind/evaluation/README.md` 把评测证据分成三层（第 12 章从产品角度讲过，这里从工程角度再讲一次）：

| 层  | 名字                    | 跑什么                                                          | 能证明什么                             |
| --- | ----------------------- | --------------------------------------------------------------- | -------------------------------------- |
| 一  | `fixture-static`        | 直接在夹具文本上跑 `runLegalLint`                               | 只能做 lint 规则回归。**不是引擎证据** |
| 二  | `engine-scripted-model` | 夹具里的 `modelScript`（VCR 式 cassette）驱动**真实 `runTurn`** | 默认发布门证据                         |
| 三  | `real-model`            | 真模型（`LAWMIND_SHADOW_REAL_MODEL=1` 或 `--mode real`）        | 最终验收                               |

第一层的召回率是「构造性地等于 1」——因为规则和夹具是一起写的，规则必然命中它自己种的标记。这就是为什么文档明说它不是引擎证据。

对应 benchmark 的三种模式：`mock`（不能当门禁证据）、`scripted`（可以）、`real`（要显式开关）。

## 18.5 加东西要动哪些地方

这一节是本章最实用的部分。

### 加一个工具

要动的地方：

1. **实现**：新建 `src/lawmind/agent/tools/legal/<名字>.ts`（或 `tools/engine/`），导出一个 `AgentTool`。
2. **注册**：在 `tools/legal-tools.ts` 的 `createLegalToolRegistry` 里注册，或者在 `tools/engine-tools.ts` 的数组里加。
3. **名字集合**：判断它属不属于那几个集合（`tool-name-sets.ts`）：
   - 会改状态的 → 加进 `WRITE_TOOLS`。
   - 只读幂等的 → 加进 `IDEMPOTENT_READ_TOOLS`。
   - 需要绑案件 → 加进 `MATTER_SCOPE_REQUIRED`。
4. **披露清单**：如果它不该开局就广告给模型，在 `governance.ts` 的 `DISCLOSED_TOOL_HINTS` 里加一条（名字 + 中文说明），这样 `list_more_tools` 能启用它。
5. **保留名**：如果它是核心工具、外部不许顶替，加进 `tools/reserved-tool-names.ts`。
6. **沙箱**：如果它会跑重活或写文件，考虑加进 `dangerous-tool-policy.ts` 的 `SUBPROCESS_SANDBOX_TOOL_NAMES`。
7. **测试**：同目录放 `<名字>.test.ts`。
8. **cassette**：如果它参与编排行为（被广告、被门禁拦），加一条 cassette 断言。

### 加一个技能

要求写在期次模板里，五件事：

1. `src/lawmind/skills/builtin/<id>.md` 正文（带 frontmatter）。
2. 在 `ensure-builtin-skill-seeds.ts` 的 `BUILTIN_IDS` 里注册。
3. 在 `lawyer-capabilities.ts` 里做能力映射。
4. 加契约测试（参考 `evaluation/skill-deliverable-contract.test.ts`）。
5. 在 `docs/LAWMIND-CANONICAL-LEGAL-SKILLS.md` 第八节「消化记录」里写一行。

如果这个技能对应某个能力的主阶段，还要在 `skill-prompt-budget.ts` 的 `PRIMARY_BY_CAPABILITY` 里加映射（第 11 章）。

### 加一个 HTTP 路由

1. 新建 `apps/lawmind-desktop/server/lawmind-server-route-<名字>.ts`，导出 `handleXxxRoutes(args): Promise<boolean>`。
2. 在 `lawmind-server-route-registry.ts` 的 `LAWMIND_ROUTE_HANDLERS` 数组里插到合适位置（**顺序有意义**）。
3. 在 `apps/lawmind-desktop/src/renderer/lawmind-api-routes.ts` 里加客户端常量。
4. 请求体 schema 放 `src/lawmind/platform/local-api-schemas.ts`（共享 zod）。
5. 如果手写 `res.writeHead`，**必须带 CORS 头**（第 14 章那个坑）。
6. 加 `<名字>.test.ts`。

### 加一个交付物规格

1. 在 `deliverables/lawyer-work-specs.ts` 或 `registry.ts` 里加 spec（必要章节、关键词、占位符规则、默认输出、风险、模板 id）。
2. 加进 `BUILT_IN_DELIVERABLE_SPECS`（顺序被 `registry.test.ts` 锁着，加在合适位置）。
3. 如果它需要推理门，配 `reasoningGate` 并考虑在 `item-judgments.ts` 的判定表里给对应项。
4. 考虑必核清单（`verification-checklist.ts`）要不要加一档。
5. 加测试。

### 加一个版本功能开关

1. 在 `policy/edition.ts` 的 `EDITION_FEATURES` 加一行（三档都要给值）。
2. 消费侧用 `isFeatureEnabled(key, { policy })`。
3. 如果它影响界面显隐，渲染层也要读一次。

## 18.6 那些机器守着的规矩

仓库里有一批 pre-commit / CI 门禁。它们存在的意义是「防止人类忘记」。

### 文件大小棘轮

`scripts/pre-commit/check-file-size.mjs` 有两个软上限：

| 区域                                                  | 上限   |
| ----------------------------------------------------- | ------ |
| `apps/lawmind-desktop/src/renderer`（`.ts` / `.tsx`） | 800 行 |
| `src/lawmind/agent/tools`（`.ts`）                    | 600 行 |

它的机制值得说一下，因为是个聪明的设计：**允许存量超标文件冻结在基线里，但不允许它们继续长大**。

三种失败：

| 情况  | 含义                                            |
| ----- | ----------------------------------------------- |
| NEW   | 新文件超标且未登记 → 先拆                       |
| STALE | 已登记但现在不超标了 → 删条目（文件已经拆小了） |
| GROWN | 已登记但超过冻结上限 + 容差（10 行）→ 先拆      |

为什么要 STALE 这条？注释解释得很清楚：

> 只查「新超标」的清单会腐烂：文件拆小了条目还留着，清单越看越像「这些都是必须大的」，实际早已失真。

为什么要 GROWN 这条：

> 只警告不冻结，等于对最需要关注的大文件毫无约束：2542 行的文件可以一路长到 5000 行而 CI 全绿。

所以现在的规矩是：**存量可以有，但任何增长都必须在 diff 里显式出现**（要么拆，要么明确抬上限）。

更新基线用 `--update`。

### 覆盖率棘轮

`scripts/pre-commit/check-coverage-ratchet.mjs`，机制和文件大小类似：覆盖率不能降，降低必须在 diff 里显式。

### 渲染层不许值导入 node 模块

`scripts/lawmind/check-renderer-node-imports.mjs`（`pnpm lawmind:check:renderer-node`）。

原因很实际：渲染层跑在浏览器环境里，值导入 `node:fs` 之类会直接**白屏**。

这条约束在代码里也有体现：`deliverables/index.ts` 刻意不 re-export `workspace-loader.ts` 和 `reasoning-validator-workspace.ts`，注释说这是 Node-only 的，会打烂 Vite 渲染层。

### 渲染层 CSS 同步

`styles.css` 是模块拼起来的，有一套同步机制和检查（`lawmind:check:renderer-css`、`lawmind:sync:renderer-css`）。

约定文档是 `docs/LAWMIND-DESKTOP-UI-CONTROLS.md`：滚动条和输入框必须用 token + `styles/controls.css`，不许自己写。

### UI 文案 lint

`pnpm lawmind:ui-copy-lint`（`scripts/lawmind/lawmind-ui-copy-lint.mjs`）。

它机械拦截「工程师语言回潮」——路径、英文枚举、门禁术语不许出现在律师可见面。禁词清单的口径来源是 `docs/LAWMIND-TERMINOLOGY.md`，脚本里的 `BANNED_PATTERNS` 是它 14 条模式的实现（6 条路径类 + 8 条术语类）。

存量合法用例登记在 `scripts/lawmind/ui-copy-lint-allowlist.json`，要写理由。

维护规矩是「表 → 脚本」单向：**先改术语表，再同步脚本**。

### CORS 结构守卫

`apps/lawmind-desktop/server/lawmind-server-cors-structure.test.ts` 是正则扫源码的测试：所有手写 `res.writeHead(...)` 必须带 CORS 载体。

它长这样是为了防第 14 章那个 bug 复发——**光在注释里写「不要漏」没有用**。

### 平台契约检查

`scripts/lawmind/lawmind-platform-contracts-check.ts` 断言 `src/lawmind/platform/contracts.ts` 和对应文档里必须有那些必需的符号和字段。防的是「契约漂了但没人发现」。

### 文档 lint

`markdownlint-cli2`，配置在 `.markdownlint-cli2.jsonc`。扫的范围是 `docs/**/*.md`、`docs/**/*.mdx`、`README.md`。

值得注意的是它关掉了不少规则（MD013 行长度、MD025 多一级标题、MD029 有序列表前缀、MD036、MD040、MD041、MD046），所以**行长度不是约束**——中文文档不需要卡 80 列。

开着并且容易踩的几条：MD028（引用块里不能有空行）、MD033（内联 HTML 白名单）、MD024（重复标题）、MD050（加粗风格统一用星号）、MD060（表格管道风格）。

我写这本手册时就踩过 `MD028`（两个引用块中间空一行）、`MD033`（`<id>` 这种尖括号被当成 HTML 标签）、`MD050`（`___` 被当成下划线加粗）。

### 提交信息钩子

`git-hooks/commit-msg` 存在，`package.json` 的 `prepare` 脚本会设置 `core.hooksPath git-hooks`。

## 18.7 代码规范

- **TypeScript ESM，严格模式。** 尽量避免 `any`。
- **跟着你改的那个文件的写法走。** 不要顺手重构别处。
- **测试与实现同目录**，命名 `<实现名>.test.ts`。
- **注释里引用律师可见概念时用术语表的中文词**，减少两套语言漂移。代码标识符保持英文。
- **安全规则注释可以用中文**，理由是「便于律所 IT 审阅」（`safe-command.ts` 头部原话）。

### 关于注释里的「踩坑史」

这个仓库有个很好的习惯：**在出过事的地方留下长注释，写清症状、根因、修法**。举几个例子：

- 端口漂移那次故障（第 13 章）。
- CORS 那个「前端 Failed to fetch、后端全绿」的坑（第 14 章）。
- 监督进程先抢锁导致 `lawmindd` 从不 tick（第 14 章）。
- 误报率恒为 0 导致所有判断项自动升级（第 12 章）。
- 明文穿透让加密信封可被降级（第 16 章）。
- 自动化反复重派同一份材料（第 17 章）。
- 编辑样例注入被截断导致「为什么改」被挤掉（第 6 章）。

改代码时看到这类注释，先读完再动手——**它们记录的往往是「看起来很合理但其实错了」的那种改法**。

## 18.8 多会话并行时的规矩

`AGENTS.md` 里有一段专门讲这个，因为实际踩过。

**同一个克隆，同一时刻只允许一个会话写工作区。** 要在同一仓库并行，用 `git worktree`：

```bash
git worktree add --detach <路径> HEAD
```

五条禁令：

1. **禁止在共享工作区跑 `git stash`。** 不带 pathspec 的 `git stash push` 会把**别人**未提交的改动一起收走，`pop` 时冲突，而且很难判断谁丢了什么。
2. **禁止 `git add -A` / `git add .` / `git commit -a`。** `workspace/` 下混着运行时产物，全量 add 会把它们卷进提交。只用显式路径列举本轮文件。
3. **提交前先看 `git status`。** 出现不属于本轮的文件说明有并行写入者，不要一起提交，也不要 `git checkout -- .` 或 `git clean -fd`。
4. **同一文件被两个会话改过时，以跑通测试的合并态为准**，并逐个核对两侧意图都还在。
5. **收口时不要把 `workspace/` 里的运行时产物提交。** 它的真相源在 `src/lawmind/skills/builtin/*.md` 和 `src/lawmind/agent/collaboration/*-templates.ts`。

最后一条特别值得记：**工作区里的技能文件是播种产物，真正的源头在仓库里**。改了工作区里的技能不会进入版本控制，改仓库里的才会。

## 18.9 文档站

`apps/lawmind-docs/` 是 VitePress 站。构建前会跑 `sync-docs.mjs` 把根目录的文档同步进去。

> 逐文件的实现精读见**第 71 章**：七条同步映射、导航与侧栏结构、CI 的三条断言，以及「现行 9 篇」这个**口径**与「顶层 `LAWMIND-*.md` 全部同步」这个**机制**为什么会不一致。

同步规则（`apps/lawmind-docs/scripts/sync-docs.mjs`）：

| 源                                         | 目标                              |
| ------------------------------------------ | --------------------------------- |
| `docs/LAWMIND-*.md`                        | `apps/lawmind-docs/docs/` 根      |
| `docs/lawmind/`（整个目录）                | `apps/lawmind-docs/docs/lawmind/` |
| `docs/archive/`                            | `apps/lawmind-docs/docs/archive/` |
| `docs/assets/`                             | `apps/lawmind-docs/docs/assets/`  |
| `docs/CNAME`                               | `docs/public/CNAME`               |
| `apps/lawmind-desktop/download/index.html` | `docs/public/download/index.html` |

要注意两点：

- **根目录 `docs/` 是唯一事实源。** 不要长期改 `apps/lawmind-docs/docs/` 里的同步副本——下次 sync 会被覆盖。
- `docs/lawmind/` 是**整目录同步**，所以往这个目录加子目录（比如本手册的 `docs/lawmind/manual/`）会自动发布，不需要改同步脚本。

命令：`pnpm lawmind:docs:dev` / `pnpm lawmind:docs:build` / `pnpm lawmind:docs:preview`。

## 18.10 打包与发版

发版清单在 `apps/lawmind-desktop/RELEASE-CHECKLIST.md`，四块：

1. **构建与产物**：改 `apps/lawmind-desktop/package.json` 的版本号，在三个平台分别跑 `pnpm lawmind:desktop:dist`，确认产物名带版本+OS+架构，并在干净虚拟机上装一遍（走一遍向导、发一条消息）。
2. **质量证明**：真稿门要 RUN 且全过（`LAWMIND_REQUIRE_TRUE_MANUSCRIPT=1 pnpm lawmind:true-manuscript`），发布就绪报告里真稿门是 RUN、产物是「已签名且公证」。
3. **交付闸门**：tag `lawmind-desktop-v*` 的工作流强制 `LAWMIND_REQUIRE_NOTARIZED=1`；没有 `latest*.yml` 拒绝发布。
4. **安全与信任**：macOS Developer ID + notarytool + staple，Windows Authenticode，SBOM 与 CVE 说明。

还有第五块「法务与文档」和第六块「支持」。

`pnpm lawmind:sbom` 从锁文件生成一份 JSON SBOM；`pnpm lawmind:sbom:cyclonedx` 生成 CycloneDX 格式（针对桌面应用）。

## 18.11 关键文件

| 关注点          | 文件                                                                                                                                           |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 贡献者规范      | `AGENTS.md`、`CONTRIBUTING.md`、`.cursor/rules/local-desktop-ui.mdc`                                                                           |
| 目标与进度      | `GOALS.md`、`CHANGELOG.md`                                                                                                                     |
| 编排器准入      | `src/lawmind/agent/turn-orchestrator-cassettes.test.ts`、`src/lawmind/agent/testkit/`                                                          |
| 评测口径        | `src/lawmind/evaluation/README.md`                                                                                                             |
| 影子回放        | `src/lawmind/evaluation/shadow-engine-replay.ts`、`shadow-replay.ts`、`replay-fixtures.ts`                                                     |
| 契约测试        | `src/lawmind/evaluation/skill-deliverable-contract.test.ts`                                                                                    |
| pre-commit 门禁 | `scripts/pre-commit/check-file-size.mjs`、`check-coverage-ratchet.mjs`、`filter-staged-files.mjs`                                              |
| CI 门禁脚本     | `scripts/lawmind/check-renderer-css.mjs`、`check-renderer-node-imports.mjs`、`lawmind-ui-copy-lint.mjs`、`lawmind-platform-contracts-check.ts` |
| CORS 结构测试   | `apps/lawmind-desktop/server/lawmind-server-cors-structure.test.ts`                                                                            |
| E2E 分区        | `apps/lawmind-desktop/e2e/electron-specs.ts`、`e2e-spec-partition.test.ts`                                                                     |
| 文档站同步      | `apps/lawmind-docs/scripts/sync-docs.mjs`                                                                                                      |
| 发版清单        | `apps/lawmind-desktop/RELEASE-CHECKLIST.md`                                                                                                    |
| 文档规范        | `.markdownlint-cli2.jsonc`、`docs/LAWMIND-TERMINOLOGY.md`、`docs/LAWMIND-DESKTOP-UI-CONTROLS.md`                                               |

## 18.12 已知坑

- **不要断言「提示词里这句话还在」。** 装配器单测只允许断言章节 id、缓存边界哈希、动态注入值。
- **改编排器一定要加 cassette。** 而且 cassette 用完必须失败（400），不许编收尾消息。
- **影子回放不是编排器改动的入场券。** 它管交付物与 lint 召回。
- **`fixture-static` 的召回率恒为 1。** 它只能做 lint 规则回归，不是引擎证据。
- **渲染层不许值导入 node 模块。** 会白屏，有门禁守着。
- **手写 `writeHead` 必须带 CORS 头。** 有结构测试守着。
- **文件大小和覆盖率都是棘轮。** 涨了必须在 diff 里显式处理（拆或抬上限）。
- **UI 文案禁词表是「表 → 脚本」单向。** 先改表再改脚本。
- **`docs/` 是文档唯一事实源。** 别长期改同步副本。
- **`docs/lawmind/` 是整目录同步。** 加子目录会自动发布。
- **工作区里的技能文件是播种产物。** 改技能要改 `src/lawmind/skills/builtin/`。
- **共享工作区别跑 `git stash`、别 `git add -A`。** 会收到别人的改动或运行时产物。
- **同一克隆同时只允许一个会话写工作区。** 并行要用 `git worktree`。
- **Playwright 的 Electron preload 是替身。** 不是可以发布的网页版工作台。
- **留意注释里的「踩坑史」。** 它们记录的往往是「看起来很合理但其实错了」的改法。
