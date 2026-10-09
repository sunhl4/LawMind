# Harvey LAB 切片：测试与改动记录

工程复测与冲突检查手册。不是官方榜、不是真稿胜利。语料不进 git（缓存在 `tmp/official-benchmarks/harvey-slice/`，已 gitignore）。

对照：<https://github.com/harveyai/harvey-labs>；编排准入仍按 [AGENTS.md](../AGENTS.md) cassette 规则；内核分层见 [docs/LAWMIND-LEGAL-KERNEL-BENCH.md](./LAWMIND-LEGAL-KERNEL-BENCH.md)。

## 1. 口径（以后复测先认）

| 项     | 本仓库切片                                                        | 官方 LAB 榜                                     |
| ------ | ----------------------------------------------------------------- | ----------------------------------------------- |
| 任务   | employment-labor 两题（见下）                                     | 全量任务集                                      |
| 执行   | 真 `runTurn` + 生产工具表；对照直调同一模型                       | 各家 harness                                    |
| 裁判   | **deepseek-flash 单裁判**，按题面 `match_criteria` 逐条 PASS/FAIL | Claude Sonnet 4.6 + GPT-5.5 **双裁判** all-pass |
| 可声称 | 相对直调的条目通过率、交件路径是否落盘                            | 不可用本切片百分比宣称打榜                      |

官方公开对照（任务 all-pass / 条目级，非本仓库复测）：Muse Spark 约 25% 任务 / 90%+ 条目；DeepSeek V4.1 Flash 约 6.67% 任务。本切片条目分不能与之直接比。

## 2. 题目

| id         | 路径                                                                                            | 交件                                     | 条目数 |
| ---------- | ----------------------------------------------------------------------------------------------- | ---------------------------------------- | ------ |
| covenant   | `tasks/employment-labor/extract-restrictive-covenant-terms-from-executive-employment-agreement` | `restrictive-covenant-summary-memo.docx` | 68     |
| separation | `tasks/employment-labor/identify-issues-in-separation-agreement`                                | `issue-memorandum.docx`                  | 42     |

两题都是英文 US 雇佣材料：多文件冲突、期限/范围摘录、问题备忘录。材料不是中国法；检索北大法宝**不应**为凑条号改写管辖。

## 3. 怎么跑

```bash
# 需本机已配置 deepseek-flash（Desktop models.json）
pnpm exec tsx tmp/official-benchmarks/harvey-slice/run_slice.ts
# 只跑一题：
TASKS=identify-issues-in-separation-agreement pnpm exec tsx tmp/official-benchmarks/harvey-slice/run_slice.ts
```

产物：

- `tmp/official-benchmarks/harvey-slice/slice-report.json` — 汇总
- `tmp/official-benchmarks/harvey-slice/cache/...` — GitHub API 物化的 task.json + documents
- `tmp/official-benchmarks/harvey-slice/lawmind/<task>/` — 当次工作区（含交件）

浅克隆 harvey-labs 曾中止；harness 用 GitHub Contents API + 本地 cache，断网时只要 cache 齐仍可跑。

## 4. 分数时间线（单裁判 flash）

| 轮次             | covenant         | separation                           | 合计                 | 备注                                                                                                  |
| ---------------- | ---------------- | ------------------------------------ | -------------------- | ----------------------------------------------------------------------------------------------------- |
| 直调对照         | 39/68            | 26/42                                | 65/110               | 无工具、无工作区交件门                                                                                |
| 早期 LawMind     | ~55/68 量级      | 曾掉到 ~41、且缺 separation 交件文件 | —                    | 只加强「问题账本」时，模型用冲突段挤掉逐项摘录                                                        |
| **当前最佳**     | **65/68**        | **38/42**                            | **103/110 (~93.6%)** | 两题均未 all-pass；见 `slice-report.json`                                                             |
| 工具轮次（最佳） | 12 tools / ~187s | 33 tools / ~435s                     | —                    | covenant：analyze×4 + calculate/run_compute + write_document；separation：analyze 多轮 + draft/render |

未跑官方双裁判，故「任务 all-pass」未知；条目级已接近公开榜头部区间，继续抠这两题边际收益低。后续优先中文实务集（PLawBench 等），见 [docs/LAWMIND-PLAWBENCH-SLICE.md](./LAWMIND-PLAWBENCH-SLICE.md)。

## 5. 引擎改动与冲突检查

下面每条写：**为哪类失败而加**、**改了什么**、**以后改别的东西时别踩什么**。

### 5.1 命名交件路径（named deliverable）

|              |                                                                                                                                                                                                       |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 动机         | 模型把结果写到 `artifacts/analysis/`，评分找不到 `Output:` / `Write` 点名的根路径文件                                                                                                                 |
| 文件         | `src/lawmind/agent/named-deliverable.ts`（新）、`named-deliverable.test.ts`；`turn-orchestrator-model-loop.ts`（缺件 bounce）；`tools/disclosed-turn-tools.ts`（点名 docx 时披露 draft/write/render） |
| 行为         | 从指令解析 `写入                                                                                                                                                                                      | 写到 | Write | Output:`+ 文件名；缺文件则 nudge，且`artifacts/` 下同名不算；docx 提示 draft→render |
| **冲突检查** | 不要把 nudge 改成「任意路径命中即过」；不要让分析草稿路径满足命名交件。改正则时同时跑 `named-deliverable.test.ts`。与 issue-ledger 的「先交点名文件」必须同向                                         |

### 5.2 审查问题账本（issue ledger）

|              |                                                                                                                                                                                                                                                                  |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 动机         | separation 类题：冲突 / 缺口 / 可落字改法 / 效力与执行风险条目大量 FAIL；仅列正面摘录不够                                                                                                                                                                        |
| 文件         | `src/lawmind/agent/issue-ledger.ts`（新）、`issue-ledger.test.ts`；`turn-orchestrator-prompt.ts`（`instructionNeedsIssueLedger` 时注入 protocol）                                                                                                                |
| 行为         | 触发：审查/issue memo 类指令 × 合同/协议材料。块内强制：**先逐项摘录**，再并列冲突 / 缺失 / 改法，并写效力与执行风险；英文材料禁止改去检索中国法凑条号                                                                                                           |
| **冲突检查** | **禁止**删掉「第一段必须逐项摘录」——曾单独强调三类问题导致 covenant 摘录崩（约 55→41）且 separation 文件缺失。改触发正则时确认 covenant（summary memo）仍触发或明确不触发策略。与「不锁定模型表达」并存：只加结构门，不断言提示词里某句中文还在（cassette 规则） |

### 5.3 bash / sh 工作区脚本

|              |                                                                                                                                                                       |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 动机         | 能力电池与办公脚本需要 `bash script.sh`；原先整类拒绝导致无法 printf/落盘                                                                                             |
| 文件         | `src/lawmind/host-access/host-command.ts`、`platform/safe-command.ts`、对应测试；`tools/legal/host-tools.ts` 描述；手册 `docs/lawmind/manual/15-platform-security.md` |
| 行为         | 允许 `bash`/`sh` **仅**执行工作区内脚本文件；**禁止** `-c`/`-lc`；仍禁 zsh/dash/fish、sudo、curl 等                                                                   |
| **冲突检查** | 安全边界：不要为了「方便」放开 `-c`。改 allowlist 必须同步 host-command + safe-command 测试与手册。相对 cwd `.` 必须解析到工作区根，勿回到错误相对路径                |

### 5.4 calculate 与工具轮

|              |                                                                                                                                                                    |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 动机         | 金额/期限计算后模型不知道下一步；工具轮被压 token / 无思考链导致长备忘录半截                                                                                       |
| 文件         | `tools/legal/calculate-tool.ts`（next hint）；`runtime-model-call.ts` / capability-envelope / catalog（reasoning_effort、窗口）；`turn-orchestrator-model-loop.ts` |
| **冲突检查** | 工具轮不要再把 `max_tokens` 压到会截断长 memo 的档；改 envelope 时跑相关 cassette / stream 测试。相位/因子态**不得**进 `runTurn`（既有红线）                       |

### 5.5 技能与 playbook 提示

|              |                                                                                                                                                                                         |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 文件         | `skills/builtin/contract-playbook-review.md`、`contract-review-layers.md`、`skills/lawyer-capabilities.ts`、`review-campaign/playbooks.ts`、`practice/user-standards.ts` 等（本轮周边） |
| **冲突检查** | 技能文案可补「点名交件 / 冲突并列」，但**不要**用技能文案替代 named-deliverable 机械门；不要为 Harvey 英文题注入中国法检索义务                                                          |

## 6. 失败形态（改代码前先对号）

两题最佳轮仍有约 7 条 FAIL。改引擎前先看当次 judge 明细（若未落盘，重跑并落 `slice-report` 扩展字段），常见桶：

1. **摘录被挤掉**：账本三类写满，期限/百分比/产品类未写全 → 先查 issue-ledger 是否还保留 extract-first。
2. **交件路径**：根目录无点名 docx → 查 named-deliverable + disclosed tools + bounce。
3. **冲突未点名**：只列表未写「冲突/歧义/执行风险」→ 账本三类与效力段。
4. **管辖漂移**：英文材料却引中国法条 → 账本禁止句；不要「为了法宝利用率」反过来鼓励。
5. **裁判噪声**：单裁判 flash 与双裁判不一致；争议条应记「裁判不确定」，不要为一条 FAIL 大改协议。

## 7. 明确不做

- 不为这两题再堆提示词句子断言（违反 cassette / assembler 规则）。
- 不把相位、保形门、因子核定写进 `runTurn` 判题路径。
- 不粘贴 harvey-labs 合同原文进 git / docs。
- 不宣称官方双裁判胜利。

## 8. 与中文集的分工

| 集                 | 用途                                                                                                                                                          |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Harvey 本切片      | 英文多文件雇佣：交件路径、冲突账本、长 memo 回归；对照直调                                                                                                    |
| PLawBench 切片     | 中国法咨询 / 案例分析 / 起诉状答辩状；法宝 `search_statute` / `search_case_law` 是否进真循环                                                                  |
| LegalAgentBench    | 远程工具 API 形态；仅在适配器就绪后抽题，不作默认回归                                                                                                         |
| LawBench / LexEval | 模型考卷零样本；见 LEGAL-KERNEL-BENCH 文末，不是交件回合                                                                                                      |
| LawMind Bench      | 自建中国律师验收资产（**独立平级仓库** `../LawMind-Bench/`）；指针见 [LAWMIND-CHINESE-LEGAL-AGENT-BENCHMARKS.md](./LAWMIND-CHINESE-LEGAL-AGENT-BENCHMARKS.md) |

改 `issue-ledger` / `named-deliverable` / host bash 后：**先**跑本切片相关单测 +（有额度时）Harvey 两题或 PLawBench 切片，并在本文件 §4 追加一行分数，避免静默回退。
