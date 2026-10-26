# LawMind Prompt Budget Baseline（P0 → P3 · 2026-10-26）

> 这份文档的上半部分是 **P0 结论与 P1 / P2 / P3 处理结果**，下半部分由 `pnpm lawmind:prompt-budget` 生成。
> 重新生成时，把本文件从「生成明细」那一行标题起的整段（含标题）替换为命令输出，不要覆盖上半部分。

## 为什么先做这一步

2026-10-25 的技能注入改动把「本阶段技能正文」的帽抬到了实测量，修掉了 Playbook 被从句子中间切断的问题，但同时让技能块可以长大。计划里担心的是：打包器软预算只有 12,000 token，技能块变大后会先把 `protocol`（优先级 55）挤掉。这个担心是否成立，不能靠读代码判断，要先量出来。

P0 的验收是：固定合同审查、研究备忘录、诉状、Word 改稿四个任务；每个任务跑默认窗口、较大窗口、最多钉选材料三档；记录完整 fragment 清单与 token 水位；不允许半篇 Skill；不允许关键协议静默消失；不以模型打分为证据。

| 验收项                | 本文件的证据                                                                                        |
| --------------------- | --------------------------------------------------------------------------------------------------- |
| 4 个固定任务          | 「完整片段清单」中 `contract.review` / `research.memo` / `litigation.draft` / `word.redline` 各三档 |
| 3 个压力档位          | 默认 128k、较大 512k、最多钉选材料；命令与测试共用 `PROMPT_BUDGET_BASELINE_SCENARIOS`               |
| 完整清单与 token 水位 | 汇总表 + 每场景逐片段 `[kept]/[DROP]/[dedup]` 与 token/cap                                          |
| 无半篇 Skill          | 12 个场景 `truncatedKinds` 均不含 `skill_index`；测试断言无 `read_skill` 截断指针                   |
| 无关键协议静默消失    | 12 个场景均无 `protocol` 预算丢弃；命令在协议缺失/被丢时非零退出                                    |
| 不以模型打分为证      | 只读请求体与打包器报告，不调用模型、不解析模型输出                                                  |

## 方法与代码落点

- 观测：`src/lawmind/agent/prompt-budget-report.ts`。每回合记录每个片段的 kind、优先级、cap、token、保留/丢弃/去重、是否带截断指针；不记录正文。
- 接线：`prepareTurnPromptContext` 在 `packPromptFragments` 之后生成 `promptBudget` 并返回；同一份摘要写入产品指标 `prompt_budget`（只写 kind 名、结构标题与数字，不写律师内容）。落盘位置：`workspace/lawmind/metrics/product-events.jsonl`，`kind=prompt_budget`，`outcome` 为 `complete` 或 `degraded`。
- 基线夹具：`src/lawmind/agent/prompt-budget-baseline.ts`。命令与测试共用同一份任务、钉选和种子工作区，避免「文档测的回合」和「测试锁的回合」漂移。
- 基线测试：`src/lawmind/agent/prompt-budget-baseline.test.ts`（4 任务 × 3 档位，真实装配；另含「同一句 + 三种钉选」的合同绑定回归断言）。
- 健康摘要（P1-b / P1-c）：`src/lawmind/agent/prompt-budget-health.ts`。按回合汇总 `kind=prompt_budget` 事件，给出水位均值/峰值、丢弃与截断回合数、按 kind 的丢弃频次；告警线为「有片段被预算丢弃」「技能/协议正文被截断」「水位峰值 ≥ 85%」三者之一。只读，不改任何打包规则。
- 暴露位置：`pnpm lawmind:doctor` 与 `pnpm lawmind:ops doctor` 的巡检行（`snapshot.promptBudget` 也在 `--json` 里）；桌面设置 → 体检只在告警时显示一行「对话上下文」，健康时保持安静。
- 命令：`pnpm lawmind:prompt-budget`（Markdown）或 `pnpm --silent lawmind:prompt-budget -- --json`（机器可读；`--silent` 是必要的，否则 pnpm 的启动横幅会把 JSON 弄脏）。命令在出现半篇 Skill、关键协议缺失、协议被预算丢弃、片段计数不自洽，或合同绑定退化（source/confidence/技能 token/检索协议任一项不达标）时以非零退出。

**指标口径。** `outcome=degraded` 只在两种真实损失下写：片段因预算被丢，或 `skill_index` / `protocol` 正文被截断。`pins` 的可见截断（带溢出指针）与重复会话 `craft` 的去重记为 `complete`，事实仍保留在 `meta.collapsedCount`、`meta.collapsedKinds` 和 `meta.truncatedKinds` 里。否则每次重钉选都会把健康指标打成红色，告警线就失去意义。

## 结论

### 1. 在这四个任务上，12,000 的软预算没有压力

最重的是合同审查 + 最多钉选材料：**6,310 / 12,000（53%）**。默认合同审查 **4,552（38%）**；512k 窗口下同一任务 **4,552 / 48,000（9%）**。三档合计 12 个场景，**没有任何片段被预算丢弃**，也没有片段被去重，所有 `protocol` 都保留。

这意味着：**P1 不适合先做「按 kind 整体固定保留 protocol」或「required / budgeted 二分」的重构**。当前证据不支持那个复杂度。更合适的顺序是：

1. 先修下面第 2 条（钉选材料改变意图绑定），它比预算更早、更容易让本阶段技能消失；
2. 让 `prompt_budget` 指标进入日常观测，设一个明确告警线（例如 `keptTokens / budgetTokens ≥ 85%` 或 `droppedCount > 0`）；
3. 等真实工作区出现越线样本，再决定哪些协议必须 required、哪些可以按预算裁决。

### 2. 真正会「挤掉」本阶段技能的不是预算，是钉选材料的种类分布（P1-a / P1-e 已修）

同一句「请审查这份采购合同的违约责任与付款条款」，P0 测得：

- 只钉一份 `采购合同.docx`：`source=joint`、`confidence=high`，注入本阶段技能正文 **2,417 token** 和 `## 检索协议`，共 18 个片段、4,552 token。
- 再钉一份合同和 10 份无关 PDF（合计 2 份合同 + 10 份无关附件）：`dominantGenre` 变成 `unknown`，`compileIntent` 从 `joint/high` 退到 `keyword/medium`，同一回合只剩 **982 token 的能力目录索引**，`## 检索协议` 不再入队；总片段从 18 降到 12，打包总量从 4,552 降到 **2,270**。

这不是 10 月 25 日技能注入改动造成的，它发生在绑定阶段、进入打包器之前；影响比预算挤占更直接：**律师钉的材料越多、越杂，明确说「审查合同」的回合反而越可能拿不到本阶段技能。**

**P1-a 修法（已落地）。** 根因在 `dominantDocumentGenre`：`unknown` 表示「看不出类型」（扫描件、无意义文件名），它不是一种类型，却参与了多数票。现在改成：**当所有有类型的附件一致时，未分类附件不能靠数量翻盘**；有类型附件彼此不一致时，保留原来的计数规则，`contract ↔ pleading` 这条致命误绑对的现有行为完全不变。

**P1-e 修法（已落地）。** P1-a 之后仍有一层更严重的问题：**有类型的附件堆会压过原话里的明确对象**。`jointRoute` 先看 `dominantGenre` 再看文本，所以同一句「请审查这份采购合同的违约责任」配上 5 份证据清单会绑成 `litigation.draft`、5 份传票绑成 `ops.court_sms`、5 份表格绑成 `materials.draft`——都是 `joint/high`，绑错能力，不只是少注入正文。诉状侧一样：「根据这些材料写一份答辩状」配 5 份传票绑成 `ops.court_sms`。

修法是在 `jointRoute` 的 genre 分支之前加一条窄规则 `explicitObjectRoute`：**原话点名了对象（合同 / 起诉状）且带工作动词（审查 / 起草 / 改稿），钉选里也确实有该类材料时，以原话为准**。`contract ↔ pleading` 致命误绑对由更早的 `mixedPaper` 分支裁决（合同侧仍是 medium），这条规则不升级它；原话没点名对象（「帮我看看」+ 传票、「整理一下」+ 发票）仍按材料类型走。

同一条原则也补进了 Word 改稿分支 `wordRevisionCapability`：**「修改这份起诉状」+ 开庭传票**以前会按 `dominantGenre = court_notice` 落到 `contract.review`（改稿管线于是给诉状装合同技能），现在原话点名的起诉状 / 律师函 / 合同优先；没点名时仍按材料类型。函件是「点名的交付物」而不是材料类型，所以 `explicitObjectRoute` 也接住了它：**「写一份催款函」+ 增值税发票**以前绑成 `ops.invoice`、「写一封律师函」+ 传票绑成 `ops.court_sms`，现在都是 `letter.draft`，催款语义仍写 `letter.demand`。

**检索备忘录（P3 已覆盖）。**「就违约金条款写一份检索备忘录」+ 证据清单曾绑成 `litigation.draft`（材料形态优先于 research 兜底）。P3 只认**点名的交件名**：原话出现「检索备忘录 / 检索报告 / 研究备忘录 / 法律检索报告 / 调研报告」时才以 `research.memo` 为准；「查一下这份合同的问题」「检索一下这份合同的风险」这类没有交件名的说法仍留在合同审查。见结论 7。

修后同一句在三种钉选下完全一致（见下方「合同绑定回归」一节的生成表）：

| 场景                     | 绑定       | Skill token | 检索协议 |  片段 |
| ------------------------ | ---------- | ----------: | -------- | ----: |
| 只钉 1 份采购合同        | joint/high |       2,417 | 有       | 18/18 |
| 2 份合同 + 10 份无关 PDF | joint/high |       2,417 | 有       | 18/18 |
| 2 份合同 + 10 份证据清单 | joint/high |       2,417 | 有       | 18/18 |

回归放在三层：`src/lawmind/intent/document-genre.test.ts` 与 `compile-intent.test.ts` 锁绑定（含「有类型附件不一致时不翻盘」的反例、证据/传票/表格/发票四种附件堆都回到 `contract.review`、「原话没点名对象时仍按材料类型」的反例，以及改稿回合里诉状 / 律师函不被传票带偏、催款函不被发票堆带偏），`prompt-budget-baseline.test.ts` + `checkMixedGenreBinding` 锁请求体（技能正文 ≥ 2,000 token、`## 检索协议` 在场、无预算丢弃），CLI 同一检查不过就非零退出。

### 3. Skill 正文完整，没有半篇

四个任务的关键技能 token：合同审查 **2,417**、Word 改稿 **2,138**、诉讼文书 **1,692**、检索备忘录 **1,263**。所有场景 `truncatedKinds` 都不包含 `skill_index`，请求体里没有 `read_skill` 截断指针。`capTokens = max(基准帽, 实测量)` 的不切半篇保证成立。

### 4. 钉选内容会截断，但截断是可见的

最多钉选材料时，合同审查与检索备忘录的 `pins` 片段达到 **1,200 / 1,200**，带 `…[截断，完整内容见工作区文件]` 指针；其余片段继续保留。没有出现静默 slice。截断只写在 `truncatedKinds`，不把该回合标成 `degraded`。

### 5. 当前测量的是工作区，不是 main

工作区里的技能收窄改动（P0 开始前已有的未提交文件）已经把三篇跨能力 Skill 收回索引。`main` 仍是「每轮灌检查表」的版本。这份基线说明：收窄后的工作区版本在四类任务上完整、无丢弃；**不能把它当成 main 已验证**。

### 6. 诉讼改稿技能顺序：P2 验证中修掉两处

P2 的两项验证是案情结论教练（`deliverable-shape.ts` 的 `case_conclusion`）与诉讼改稿的技能顺序（`litigationRevisionSkillIds`）。

- **结论教练**：cassette 仍按真实回合走——【结论】第一段只写胜算/风险时，下一请求出现 `【结论口径】`，且同轮只推一次；改成「依题设……不应支持」后不再推。`deliverable-shape.test.ts` 覆盖「风险句在前 / 规范结论在前」两种文本。P0 的技能收窄没碰这条链路：教练由 `turn-profile` 的 frame 判定，不看注入了哪几篇技能。
- **技能顺序**：验证发现两处真问题，已修。
  1. `litigationRevisionSkillIds` 用「最后一个改/写/起草/拟之后的句子」判断目标，却把**整句**传给 `litigationPrimary`；`pleadingScope` 的词表没有「改」，于是「根据起诉状改答辩状」让作为**来源**的起诉状赢了，给答辩状改稿灌了起诉状母版。改为传目标句后：答辩状/上诉状回到 `litigation-stage-route`，起诉状仍用 `complaint-elements-fill`，刑辩仍是 `criminal-stage-route`。
  2. 「帮我改一下」+ `民事起诉状.docx` + `开庭传票.pdf`：`dominantGenre` 是 `court_notice`，改稿落成 `contract.review`。现在改稿只看 **Word 基线**的类型，传票 PDF 不再参与。
  3. 家事路由漏了「离婚起诉状 / 离婚答辩状」：`litigationPrimary` 的家事正则只认「离婚诉讼」，于是写离婚起诉状会拿到通用起诉状母版（`complaint-elements-fill`）而不是 `family-matter-route`。正则补齐后，起草与改稿都走家事路由，「离婚协议」不受影响。

回归分三层：新增 `src/lawmind/skills/litigation-primary.test.ts`（起草/改稿两套目标选择、来源 vs 目标、专业路由优先级）；`compile-intent.test.ts` 加「模糊改稿按 Word 基线」；`turn-orchestrator-cassettes.test.ts` 加真实回合——改起诉状时请求体先注入 `complaint-elements-fill` 再 `evidence-argument-chain`，不含 `contract-review-layers`，`apply_surgical_edits` / `render_tracked_draft` 在工具表。

### 7. 时间线、收进案件、检索备忘录：P3 补齐「点名交付物」

P3 顺着 P1-e 的原则做第二遍：**原话点名的交付物或操作，压过材料类型**。三处实测缺陷，修前/修后都用 `compileIntent` 复现：

| 说法                         | 钉选             | 修前                                                              | 修后                                                    |
| ---------------------------- | ---------------- | ----------------------------------------------------------------- | ------------------------------------------------------- |
| 把这些证据做成时间线         | 证据清单 + 借条  | `litigation.draft` / joint/high                                   | `chronology.timeline` / joint/high（`matter.timeline`） |
| 把这份判决书整理成时间线     | `民事判决书.pdf` | `chronology.timeline` / keyword/medium（材料一杂就被 joint 抢走） | `chronology.timeline` / joint/high                      |
| 把这些材料收进案件           | `采购合同.docx`  | `contract.review` / joint/high                                    | `matter.intake` / specialized/high                      |
| 就违约金条款写一份检索备忘录 | `证据清单.pdf`   | `litigation.draft` / joint/high                                   | `research.memo` / joint/high                            |

修法：

- 时间线判定放进 `explicitObjectRoute` 末尾：合同/诉状/函件这类**对象**先判，时间线作为兜底交付物；「写起诉状，附时间线」仍绑诉状。诉状分支去掉了「工作动词」门槛——「写起诉状」在文本特征里是 `vague`，但点名的诉状应当赢过旁边的材料类型。
- `MATTER_INTAKE_RE` 补上「收进案件 / 收进本案 / 归入本案」：这三句是本仓提示词自己教模型的写法（`understand-first` 的「把文件或文件夹收进案件」），以前却会落到材料类型，让「收进案件」变成合同审查。
- 检索备忘录只认点名的交件名，避免「查一下这份合同的问题」被当成检索。

回归：`compile-intent.test.ts` 五条（两张时间线、诉状优先于时间线、收进案件、检索备忘录与「无交件名」反例），`capability-patterns.test.ts` 一条锁正则与绑定一致。

## 对 P1 的具体建议（按证据调整后的执行结果）

| 顺序 | 事项                                                     | 状态                           | 依据 / 结果                                                                                                                              |
| ---- | -------------------------------------------------------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| P1-a | 修「无关附件让合同审查退化成目录」的绑定问题             | ✅ 已完成                      | `dominantDocumentGenre` 不让 `unknown` 靠数量翻盘；混合附件从 `keyword/medium` + 982 token 回到 `joint/high` + 2,417 token，检索协议在场 |
| P1-b | 暴露 `prompt_budget` 健康摘要（保留/丢弃/截断/水位）     | ✅ 已完成                      | `prompt-budget-health.ts` 汇总最近窗口；`pnpm lawmind:doctor` / `lawmind:ops doctor` 出一行，桌面设置 → 体检只在告警时显示               |
| P1-c | 设告警线，不动打包策略                                   | ✅ 已完成                      | 告警线：有预算丢弃、技能/协议截断、水位峰值 ≥ 85%，三者之一即 warn。P0 实测 38%–53%，健康工作区保持安静                                  |
| P1-d | 只有出现真实越线样本，才做 required/budgeted 协议分类    | ⏸ 按原计划待触发（条件已核对） | 12 个基线场景最高 53%、零丢弃；2026-10-26 再核对本机工作区：`kind=prompt_budget` 事件 0 条，`status=empty`。没有越线样本，触发条件不成立 |
| P2   | 验证案情结论教练与诉讼改稿技能顺序                       | ✅ 已完成                      | 结论教练 cassette 复跑通过；改稿验证修掉两处缺陷（来源起诉状抢走答辩状模板、传票带偏改稿绑定），见结论 6                                 |
| P1-e | 有类型附件堆压过原话（证据/传票/表格 → 高置信绑错能力）  | ✅ 已完成                      | `explicitObjectRoute`：原话点名对象且有该类材料时以原话为准；改稿与函件分支同步；致命误绑对仍由 `mixedPaper` 以 medium 裁决              |
| P3   | 点名交付物压过材料类型（时间线 / 收进案件 / 检索备忘录） | ✅ 已完成                      | 见结论 7：三处修前/修后实测；`MATTER_INTAKE_RE` 补本仓提示词自己的写法                                                                   |

## 复现

```bash
pnpm lawmind:prompt-budget
pnpm --silent lawmind:prompt-budget -- --json
pnpm vitest run src/lawmind/agent/prompt-budget-baseline.test.ts src/lawmind/agent/prompt-budget-report.test.ts src/lawmind/agent/prompt-budget-health.test.ts
pnpm vitest run src/lawmind/intent/document-genre.test.ts src/lawmind/intent/compile-intent.test.ts
pnpm vitest run src/lawmind/skills/litigation-primary.test.ts
```

---

---

## 生成明细

由 `pnpm lawmind:prompt-budget` 生成：四个固定任务 × 三个压力档位，
全部经由真实 `prepareTurnPromptContext` 装配；每个片段记录
kind、优先级、token、保留/丢弃/去重与截断状态。

> 口径：CJK 约 1 字 ≈ 1 token（`estimateTextTokens`）。打包器软预算默认 12,000，
> 512k 窗口按 4× 放大到 48,000。Skill 正文不得按字符切半；关键协议不得静默消失；
> 重复的会话 `craft` 片段是「去重」而非预算丢弃，不计入丢弃数。

## 汇总

| 任务             | 场景          |   打包预算 |  片段 | 丢弃 | 去重 | Skill | Protocol | Pins | 其它 | 截断 |
| ---------------- | ------------- | ---------: | ----: | ---: | ---: | ----: | -------: | ---: | ---: | ---- |
| contract.review  | 默认窗口 128k | 4552/12000 | 18/18 |    0 |    0 |  2417 |     1504 |   93 |  538 | —    |
| research.memo    | 默认窗口 128k | 2607/12000 | 13/13 |    0 |    0 |  1263 |     1064 |   40 |  240 | —    |
| litigation.draft | 默认窗口 128k | 2915/12000 | 13/13 |    0 |    0 |  1692 |      874 |    0 |  349 | —    |
| word.redline     | 默认窗口 128k | 4139/12000 | 13/13 |    0 |    0 |  2138 |      812 |   56 | 1133 | —    |
| contract.review  | 较大窗口 512k | 4552/48000 | 18/18 |    0 |    0 |  2417 |     1504 |   93 |  538 | —    |
| research.memo    | 较大窗口 512k | 2607/48000 | 13/13 |    0 |    0 |  1263 |     1064 |   40 |  240 | —    |
| litigation.draft | 较大窗口 512k | 2915/48000 | 13/13 |    0 |    0 |  1692 |      874 |    0 |  349 | —    |
| word.redline     | 较大窗口 512k | 4139/48000 | 13/13 |    0 |    0 |  2138 |      812 |   56 | 1133 | —    |
| contract.review  | 最多钉选材料  | 6310/12000 | 18/18 |    0 |    0 |  2417 |     1567 | 1788 |  538 | pins |
| research.memo    | 最多钉选材料  | 3831/12000 | 13/13 |    0 |    0 |  1271 |     1120 | 1200 |  240 | pins |
| litigation.draft | 最多钉选材料  | 3034/12000 | 14/14 |    0 |    0 |  1692 |      946 |   47 |  349 | —    |
| word.redline     | 最多钉选材料  | 4784/12000 | 14/14 |    0 |    0 |  2136 |      880 |  635 | 1133 | —    |

## 合同绑定回归（P1-a / P1-e）

同一句「请审查这份采购合同的违约责任与付款条款」，只改变钉选材料：

| 场景                     | 绑定       | Skill token | 检索协议 |  片段 |
| ------------------------ | ---------- | ----------: | -------- | ----: |
| 只钉 1 份采购合同        | joint/high |        2417 | 有       | 18/18 |
| 2 份合同 + 10 份无关 PDF | joint/high |        2417 | 有       | 18/18 |
| 2 份合同 + 10 份证据清单 | joint/high |        2417 | 有       | 18/18 |

P1-a / P1-e 之后三行必须一致：附件只增加钉选片段，不把本阶段技能正文换成目录，不丢检索协议，也不把绑定改成别的能力。
命令在任一行退化（source 不是 joint / confidence 不是 high / 技能 < 2000 token / 缺检索协议）时以非零退出。

## 检查结果

全部场景通过：没有半篇 Skill、没有关键协议缺失、没有静默丢弃；混合附件绑定与干净回合一致。

## 完整片段清单

### contract.review · 默认窗口 128k

```text
prompt budget: 4552/12000 tokens (38%) · 18/18 fragments kept
  [kept] matter_index p88 76/1600 — 当前案件 [m-baseline]
  [kept] memory_hit p40 97/2500 — 相关记忆（按本轮指令检索；零分不注入）
  [kept] protocol p55 65/1800 — 上下文计划（ContextPlan）
  [kept] pins p90 40/1200 — 律师钉选真源（本回合）
  [kept] pins p90 53/1200 — 已钉选的 Word 基线
  [kept] matter_index p88 6/1600 — (no heading)
  [kept] environment p100 61/200 — <environment>
  [kept] protocol p55 230/1800 — 本轮理解
  [kept] protocol p55 167/1800 — 本轮工作任务书
  [kept] skill_index p70 2417/2417 — 本轮 LawMind 能力：合同审查
  [kept] protocol p55 155/1800 — 执业口径
  [kept] preference_fingerprint p72 298/400 — 已套用审查标准
  [kept] protocol p55 88/1800 — 封闭合同类型
  [kept] protocol p55 41/1800 — 交件对象
  [kept] protocol p55 173/1800 — 改稿计划
  [kept] protocol p55 122/1800 — 检索协议
  [kept] protocol p55 185/1800 — 纸侧与交易角色
  [kept] protocol p55 278/1800 — <!--lm-issue-ledger-->
```

### research.memo · 默认窗口 128k

```text
prompt budget: 2607/12000 tokens (22%) · 13/13 fragments kept
  [kept] matter_index p88 76/1600 — 当前案件 [m-baseline]
  [kept] memory_hit p40 97/2500 — 相关记忆（按本轮指令检索；零分不注入）
  [kept] protocol p55 56/1800 — 上下文计划（ContextPlan）
  [kept] pins p90 40/1200 — 律师钉选真源（本回合）
  [kept] matter_index p88 6/1600 — (no heading)
  [kept] environment p100 61/200 — <environment>
  [kept] protocol p55 230/1800 — 本轮理解
  [kept] protocol p55 182/1800 — 本轮工作任务书
  [kept] skill_index p70 1263/2000 — 本轮 LawMind 能力：检索研究
  [kept] protocol p55 155/1800 — 执业口径
  [kept] protocol p55 41/1800 — 交件对象
  [kept] protocol p55 122/1800 — 检索协议
  [kept] protocol p55 278/1800 — <!--lm-issue-ledger-->
```

### litigation.draft · 默认窗口 128k

```text
prompt budget: 2915/12000 tokens (24%) · 13/13 fragments kept
  [kept] matter_index p88 76/1600 — 当前案件 [m-baseline]
  [kept] memory_hit p40 97/2500 — 相关记忆（按本轮指令检索；零分不注入）
  [kept] protocol p55 40/1800 — 上下文计划（ContextPlan）
  [kept] matter_index p88 6/1600 — (no heading)
  [kept] environment p100 61/200 — <environment>
  [kept] protocol p55 230/1800 — 本轮理解
  [kept] protocol p55 202/1800 — 本轮工作任务书
  [kept] skill_index p70 1692/2000 — 本轮 LawMind 能力：诉讼文书
  [kept] protocol p55 155/1800 — 执业口径
  [kept] preference_fingerprint p72 109/400 — 已套用审查标准
  [kept] protocol p55 46/1800 — 交件对象
  [kept] protocol p55 122/1800 — 检索协议
  [kept] protocol p55 79/1800 — (no heading)
```

### word.redline · 默认窗口 128k

```text
prompt budget: 4139/12000 tokens (34%) · 13/13 fragments kept
  [kept] matter_index p88 76/1600 — 当前案件 [m-baseline]
  [kept] memory_hit p40 97/2500 — 相关记忆（按本轮指令检索；零分不注入）
  [kept] protocol p55 58/1800 — 上下文计划（ContextPlan）
  [kept] pins p90 56/1200 — 已钉选的 Word 基线
  [kept] matter_index p88 6/1600 — (no heading)
  [kept] environment p100 61/200 — <environment>
  [kept] craft p80 893/1500 — Word 改稿 · 原文件审阅痕迹
  [kept] protocol p55 67/1800 — 改稿要点
  [kept] protocol p55 230/1800 — 本轮理解
  [kept] protocol p55 162/1800 — 本轮工作任务书
  [kept] skill_index p70 2138/2138 — 本轮 LawMind 能力：合同审查
  [kept] protocol p55 173/1800 — 改稿计划
  [kept] protocol p55 122/1800 — 检索协议
```

### contract.review · 较大窗口 512k

```text
prompt budget: 4552/48000 tokens (9%) · 18/18 fragments kept
  [kept] matter_index p88 76/6400 — 当前案件 [m-baseline]
  [kept] memory_hit p40 97/10000 — 相关记忆（按本轮指令检索；零分不注入）
  [kept] protocol p55 65/7200 — 上下文计划（ContextPlan）
  [kept] pins p90 40/4800 — 律师钉选真源（本回合）
  [kept] pins p90 53/4800 — 已钉选的 Word 基线
  [kept] matter_index p88 6/6400 — (no heading)
  [kept] environment p100 61/200 — <environment>
  [kept] protocol p55 230/7200 — 本轮理解
  [kept] protocol p55 167/7200 — 本轮工作任务书
  [kept] skill_index p70 2417/2417 — 本轮 LawMind 能力：合同审查
  [kept] protocol p55 155/7200 — 执业口径
  [kept] preference_fingerprint p72 298/1600 — 已套用审查标准
  [kept] protocol p55 88/7200 — 封闭合同类型
  [kept] protocol p55 41/7200 — 交件对象
  [kept] protocol p55 173/7200 — 改稿计划
  [kept] protocol p55 122/7200 — 检索协议
  [kept] protocol p55 185/7200 — 纸侧与交易角色
  [kept] protocol p55 278/7200 — <!--lm-issue-ledger-->
```

### research.memo · 较大窗口 512k

```text
prompt budget: 2607/48000 tokens (5%) · 13/13 fragments kept
  [kept] matter_index p88 76/6400 — 当前案件 [m-baseline]
  [kept] memory_hit p40 97/10000 — 相关记忆（按本轮指令检索；零分不注入）
  [kept] protocol p55 56/7200 — 上下文计划（ContextPlan）
  [kept] pins p90 40/4800 — 律师钉选真源（本回合）
  [kept] matter_index p88 6/6400 — (no heading)
  [kept] environment p100 61/200 — <environment>
  [kept] protocol p55 230/7200 — 本轮理解
  [kept] protocol p55 182/7200 — 本轮工作任务书
  [kept] skill_index p70 1263/2000 — 本轮 LawMind 能力：检索研究
  [kept] protocol p55 155/7200 — 执业口径
  [kept] protocol p55 41/7200 — 交件对象
  [kept] protocol p55 122/7200 — 检索协议
  [kept] protocol p55 278/7200 — <!--lm-issue-ledger-->
```

### litigation.draft · 较大窗口 512k

```text
prompt budget: 2915/48000 tokens (6%) · 13/13 fragments kept
  [kept] matter_index p88 76/6400 — 当前案件 [m-baseline]
  [kept] memory_hit p40 97/10000 — 相关记忆（按本轮指令检索；零分不注入）
  [kept] protocol p55 40/7200 — 上下文计划（ContextPlan）
  [kept] matter_index p88 6/6400 — (no heading)
  [kept] environment p100 61/200 — <environment>
  [kept] protocol p55 230/7200 — 本轮理解
  [kept] protocol p55 202/7200 — 本轮工作任务书
  [kept] skill_index p70 1692/2000 — 本轮 LawMind 能力：诉讼文书
  [kept] protocol p55 155/7200 — 执业口径
  [kept] preference_fingerprint p72 109/1600 — 已套用审查标准
  [kept] protocol p55 46/7200 — 交件对象
  [kept] protocol p55 122/7200 — 检索协议
  [kept] protocol p55 79/7200 — (no heading)
```

### word.redline · 较大窗口 512k

```text
prompt budget: 4139/48000 tokens (9%) · 13/13 fragments kept
  [kept] matter_index p88 76/6400 — 当前案件 [m-baseline]
  [kept] memory_hit p40 97/10000 — 相关记忆（按本轮指令检索；零分不注入）
  [kept] protocol p55 58/7200 — 上下文计划（ContextPlan）
  [kept] pins p90 56/4800 — 已钉选的 Word 基线
  [kept] matter_index p88 6/6400 — (no heading)
  [kept] environment p100 61/200 — <environment>
  [kept] craft p80 893/6000 — Word 改稿 · 原文件审阅痕迹
  [kept] protocol p55 67/7200 — 改稿要点
  [kept] protocol p55 230/7200 — 本轮理解
  [kept] protocol p55 162/7200 — 本轮工作任务书
  [kept] skill_index p70 2138/2138 — 本轮 LawMind 能力：合同审查
  [kept] protocol p55 173/7200 — 改稿计划
  [kept] protocol p55 122/7200 — 检索协议
```

### contract.review · 最多钉选材料

```text
prompt budget: 6310/12000 tokens (53%) · 18/18 fragments kept · truncated: pins
  [kept] matter_index p88 76/1600 — 当前案件 [m-baseline]
  [kept] memory_hit p40 97/2500 — 相关记忆（按本轮指令检索；零分不注入）
  [kept] protocol p55 95/1800 — 上下文计划（ContextPlan）
  [kept] pins p90 1200/1200 trunc — 律师钉选真源（本回合）
  [kept] pins p90 588/1200 — 已钉选的 Word 基线
  [kept] matter_index p88 6/1600 — (no heading)
  [kept] environment p100 61/200 — <environment>
  [kept] protocol p55 230/1800 — 本轮理解
  [kept] protocol p55 200/1800 — 本轮工作任务书
  [kept] skill_index p70 2417/2417 — 本轮 LawMind 能力：合同审查
  [kept] protocol p55 155/1800 — 执业口径
  [kept] preference_fingerprint p72 298/400 — 已套用审查标准
  [kept] protocol p55 88/1800 — 封闭合同类型
  [kept] protocol p55 41/1800 — 交件对象
  [kept] protocol p55 173/1800 — 改稿计划
  [kept] protocol p55 122/1800 — 检索协议
  [kept] protocol p55 185/1800 — 纸侧与交易角色
  [kept] protocol p55 278/1800 — <!--lm-issue-ledger-->
```

### research.memo · 最多钉选材料

```text
prompt budget: 3831/12000 tokens (32%) · 13/13 fragments kept · truncated: pins
  [kept] matter_index p88 76/1600 — 当前案件 [m-baseline]
  [kept] memory_hit p40 97/2500 — 相关记忆（按本轮指令检索；零分不注入）
  [kept] protocol p55 91/1800 — 上下文计划（ContextPlan）
  [kept] pins p90 1200/1200 trunc — 律师钉选真源（本回合）
  [kept] matter_index p88 6/1600 — (no heading)
  [kept] environment p100 61/200 — <environment>
  [kept] protocol p55 230/1800 — 本轮理解
  [kept] protocol p55 203/1800 — 本轮工作任务书
  [kept] skill_index p70 1271/2000 — 本轮 LawMind 能力：检索研究
  [kept] protocol p55 155/1800 — 执业口径
  [kept] protocol p55 41/1800 — 交件对象
  [kept] protocol p55 122/1800 — 检索协议
  [kept] protocol p55 278/1800 — <!--lm-issue-ledger-->
```

### litigation.draft · 最多钉选材料

```text
prompt budget: 3034/12000 tokens (25%) · 14/14 fragments kept
  [kept] matter_index p88 76/1600 — 当前案件 [m-baseline]
  [kept] memory_hit p40 97/2500 — 相关记忆（按本轮指令检索；零分不注入）
  [kept] protocol p55 91/1800 — 上下文计划（ContextPlan）
  [kept] pins p90 47/1200 — 律师钉选真源（本回合）
  [kept] matter_index p88 6/1600 — (no heading)
  [kept] environment p100 61/200 — <environment>
  [kept] protocol p55 230/1800 — 本轮理解
  [kept] protocol p55 223/1800 — 本轮工作任务书
  [kept] skill_index p70 1692/2000 — 本轮 LawMind 能力：诉讼文书
  [kept] protocol p55 155/1800 — 执业口径
  [kept] preference_fingerprint p72 109/400 — 已套用审查标准
  [kept] protocol p55 46/1800 — 交件对象
  [kept] protocol p55 122/1800 — 检索协议
  [kept] protocol p55 79/1800 — (no heading)
```

### word.redline · 最多钉选材料

```text
prompt budget: 4784/12000 tokens (40%) · 14/14 fragments kept
  [kept] matter_index p88 76/1600 — 当前案件 [m-baseline]
  [kept] memory_hit p40 97/2500 — 相关记忆（按本轮指令检索；零分不注入）
  [kept] protocol p55 95/1800 — 上下文计划（ContextPlan）
  [kept] pins p90 47/1200 — 律师钉选真源（本回合）
  [kept] pins p90 588/1200 — 已钉选的 Word 基线
  [kept] matter_index p88 6/1600 — (no heading)
  [kept] environment p100 61/200 — <environment>
  [kept] craft p80 893/1500 — Word 改稿 · 原文件审阅痕迹
  [kept] protocol p55 67/1800 — 改稿要点
  [kept] protocol p55 230/1800 — 本轮理解
  [kept] protocol p55 193/1800 — 本轮工作任务书
  [kept] skill_index p70 2136/2136 — 本轮 LawMind 能力：合同审查
  [kept] protocol p55 173/1800 — 改稿计划
  [kept] protocol p55 122/1800 — 检索协议
```
