# 第 21 章 交付物规格详解

第 12 章讲了规格机制。这一章把 27 种规格逐个列清：**必要章节、验收标准、有没有推理门。**

## 21.1 怎么读这一章

每条包含：

- **输出**：`docx` 还是 `pptx`。
- **风险**：`low` / `medium` / `high`。高风险影响交付档位（高风险 → `full_review`）。
- **必要章节**：规格里仍标 `blocker` / `warning`，表示律师惯例上哪一节更不能缺。验收时缺节一律是提醒，**不把 `ready` 打成 false**。挡导出的只有空交付：未填占位符、骨架过密、未登记类型。
- **验收标准**：spec 里写的验收口径原文。能机械核对的（公式、证明目的、空行、表格冒充要素）另有提醒；其余仍是给模型和律师看的口径，不是第二套硬门。
- **推理门**：规格是否要求推理图。争点不够只提醒，不挡导出。

**章节怎么识别**：先对标题。标题里已经有本规格任一关键词时，这一节就定下来了，节首正文不能再去充别的节。标题没有关键词时（「合同当事人」「一、」），才看正文前 80 字。关键词归一化后短于两个字符的（以前 ESG 里的 `e ` / `s ` / `g `）直接忽略。证明目的也认「证明对象」「证明内容」。无命中要标在同一节里。内部备忘只在落款/签署节同时出现「此致」和「律师事务所」时提醒，正文里引用一封函不算。

## 21.2 合同类（4 种）

### `contract.rental` 房屋租赁合同

- 输出 `docx`，风险 medium，模板 `contract-rental-default`。
- **必要章节（6 个 blocker）**：合同双方信息、租赁标的描述、租赁期限、价款与支付安排、违约责任与解除、签署页。另有两个 warning：维修与费用承担、争议解决。
- **验收标准**：输出完整合同正文，而不是摘要或审查意见；至少包含主体、房屋信息、租期、租金押金、维修费用、违约责任、解除续租、争议解决和签署页；缺失关键变量必须以显式占位符标记，不得静默编造。
- **占位符**：必须在外发前解决。

### `contract.general` 通用商务合同

- 输出 `docx`，风险 medium，模板 `contract-general-default`。
- **必要章节（5 个 blocker）**：签约主体、合同标的、价款/对价、违约责任、签署条款。两个 warning：履行方式、争议解决。
- **验收标准**：输出完整合同草案正文，而不是检索摘要；包含主体、标的、价款、履行方式、违约责任、争议解决和签署条款；缺失关键变量使用显式占位符。

### `contract.nda` 保密协议

- 输出 `docx`，风险 medium，模板 `contract-general-default`。
- **必要章节**：主体、保密范围、期限（三个 blocker）；违约（warning）。
- **验收标准**：须有主体、保密范围与期限。
- **占位符**：必须在外发前解决。

### `contract.review` 合同审查意见

- 输出 `docx`，风险 medium，模板 `review-contract-default`。
- **必要章节（3 个 blocker）**：审查结论、主要风险、修改建议。一个 warning：待确认事项。
- **验收标准**：四条——输出正式审查意见而非检索点罗列；至少包含四节；**每条主要风险应附带条款引用或合同位置**；**每个风险点应有推荐措辞或明确写仅意见**。
- **推理门**：需要（高风险组）。
- **专属检查**：`contract.review.clause_anchor`、`contract.review.recommended_wording`，严重度都是 warning。

后两条是提醒：风险尽量落到条款，建议尽量落到措辞。对不上只警告，不把 `ready` 打成 false，也不挡导出。不要把「没写第×条」改成导出失败。

## 21.3 函件类（3 种）

### `letter.demand` 律师函 / 催告函

- 输出 `docx`，风险 **high**，模板 `letter-demand-default`。
- **必要章节（5 个 blocker）**：收件方、事实背景、法律主张、履行期限、落款与签发。一个 warning：法律后果与权利保留。
- **验收标准**：输出完整律师函/通知函正文；必须包含事实背景、主张、履行期限、法律后果和落款；**口吻克制、表达专业，不掺杂内部分析**。
- **推理门**：需要（`REASONING_GATE_HIGH_RISK`）。争点不够只提醒。
- **占位符**：必须在外发前解决。

催告多一节「法律后果」。对外正文不要写「我方的弱点在于……」。出现这类句子是提醒，不挡导出。

### `letter.counsel` 律师函

- 输出 `docx`，风险 high，模板 `letter-demand-default`。
- **必要章节（5 个全 blocker）**：收件方、事实背景、请求、期限、落款。
- **验收标准**：输出完整律师函正文；须有收件人、请求、期限与落款。
- **推理门**：需要（`LETTER_SHARED`）。
- **占位符**：必须在外发前解决。

### `letter.reply` 回函稿

- 输出 `docx`，风险 high。
- **必要章节**：来函要点、答复要点（blocker），落款（blocker）；期限或下一步（warning）。
- **验收标准**：输出完整回函正文；须回应来函要点并写明我方立场。
- **推理门**：需要。
- **占位符**：必须在外发前解决。

`letter.counsel` 和 `letter.reply` 共享 `LETTER_SHARED`：至少 2 个争点、权威冲突要处理、至少 2 条事实。这些不够时只提醒。

## 21.4 诉讼类（5 种）

### `litigation.outline` 诉讼策略提纲 / 起诉状骨架

- 输出 `docx`，风险 **high**，模板 `litigation-outline-default`。
- **必要章节（4 个 blocker）**：案件事实、核心争点（IRAC）、请求权基础、证据清单。两个 warning：对方抗辩与我方反驳、下一步策略。
- **验收标准**：输出完整诉讼策略提纲；至少包含四节；**每个争点都明确法条依据与待补强证据**。
- **推理门**：需要（高风险组）。

### `litigation.complaint` 起诉状

- 输出 `docx`，风险 high。
- **必要章节（4 个 blocker）**：当事人、诉讼请求、事实与理由、证据对照。一个 warning：落款。
- **验收标准**：须有当事人、诉讼请求、要件式事实与证据对照；**用线性栏目，不要 markdown 表冒充要素表**。

最后那句约束和第 12 章讲的排版问题对应：要素式起诉状在 Word 里是线性段落。

### `litigation.answer` 答辩状

- 输出 `docx`，风险 high。
- **必要章节（3 个 blocker）**：当事人、答辩要点、事实与理由。
- **验收标准**：须有答辩要点与事实陈述章节。

### `litigation.brief` 代理词

- 输出 `docx`，风险 high。
- **必要章节**：争点、代理意见（blocker）；依据（warning）。
- **验收标准**：须有争点与代理意见章节。

### `matter.exhibit_list` 证据目录

- 输出 `docx`，风险 medium，模板 `document-general-default`。
- **必要章节**：证据目录（blocker）。
- **验收标准**：**每条证据须有名称与证明目的**。

「证明目的」不能省。只有名称的清单在庭上没用。

## 21.5 意见与备忘（4 种）

### `memo.opinion` 法律意见书

- 输出 `docx`，风险 **high**，模板 `word/legal-memo-default`。
- **必要章节（4 个，全部 blocker）**：争点、结论、引用、保留意见。
- **验收标准**：争点、结论、引用、保留意见均为必要章节。
- **占位符**：必须在外发前解决。
- **推理门**：不需要。四节已经是意见书的结构，不再另加推理图。缺节只提醒。

### `memo.research` 检索研究备忘

- 输出 `docx`，风险 medium。
- **必要章节（6 个 blocker）**：事项、命题矩阵、现行法条、正向类案、反向类案、结论。
- **验收标准**：须含命题、现行法条、正反类案与结论；**无命中也保留栏目并标待核实**。
- **推理门**：**不需要**（它没有 `reasoningGate`；六个 blocker 章节已把方法论固化住）。

六节里「命题矩阵」和「正反类案」是它的特色——它们把方法论固化进了结构。

### `memo.internal` 内部备忘

- 输出 `docx`，风险 medium。
- **必要章节**：事项、结论（blocker）；待办（warning）。
- **验收标准**：须有事项与结论；**不得写成可对外签发件**。

### `report.learning` 学习型调研简报

- 输出 `docx`，风险 low。
- **必要章节**：制度要点（blocker）；背景概述、比较与实务启示、结论与建议、来源（warning）。
- **验收标准**：输出适合律师学习/内部分享的调研简报；**制度要点须区分效力层级；新闻不得写成现行法**。

## 21.6 报告类（3 种）

### `report.compliance` 涉外合规卷宗备忘录

- 输出 `docx`，风险 medium，模板 `word/legal-memo-default`。
- **必要章节（5 个 blocker）**：问题陈述、简要结论、管辖区效力矩阵、风险域发现、来源附录。一个 warning：行动建议。
- **验收标准**：输出可复核合规备忘录，而非网页摘要堆砌；必须包含五节；**不确定处显式标 `[VERIFY]`；新闻不得写成现行法**；外发前须解决关键占位符，来源要能回溯。
- **占位符**：显式 TODO 类，必须在外发前解决。

「新闻不得写成现行法」和 `data-compliance-route` 技能是同一条纪律：写不实的现行法是空交付，不是靠标题关键词拦稿。

### `report.general` 研究报告 / 专项报告

- 输出 `docx`，风险 low。
- **必要章节**：三节全是 warning（背景与概述、主体分析、结论与建议）。
- **验收标准**：输出完整报告正文，结构清晰、可直接编辑；**若信息不足，先给出带占位符的正式框架**。

三节都是 warning，和现在所有类型的章节检查一样：缺了只提示，不挡导出。低风险类型连规格里都不标 blocker。

### `report.esg` ESG / 可持续发展报告

- 输出 `docx`，风险 medium。
- **必要章节**：六节全是 warning（报告概述、环境 E、社会 S、治理 G、关键指标与披露、结论与展望）。
- **验收标准**：输出可直接对外使用的报告正文，而非工作备忘录；ESG 三维度宜有对应章节，框架差异大时以律师终稿为准；数据与指标宜标注来源或统计口径，缺失处使用显式占位符。

ESG 没有唯一标准框架。章节对不上只提醒，以律师终稿为准。资本市场核对没有独立规格，走 `report.general`（能力见第 22 章 `capital.markets`）。

## 21.7 计算类（3 种）

### `labor.calc` 劳动补偿计算

- 输出 `docx`，风险 medium。
- **必要章节（3 个 blocker）**：定性、计算、结论。
- **验收标准**：**金额必须带来源公式；缺流水标缺口，不得口算假数**。

### `period.calc` 程序期限计算

- 输出 `docx`，风险 medium。
- **必要章节（2 个 blocker）**：起算、届满日。
- **验收标准**：**届满日必须有公式；中断顺延标缺口**。

### `analysis.table` 核算对照

- 输出 `docx`，风险 medium。
- **必要章节（3 个 blocker）**：结论、对照、来源。
- **验收标准**：须有结论、对照表路径或预览、来源列/文件；**数字不得无出处**；**法定金额与期限不得口算，须走 calculate**。

## 21.8 表格类（1 种）

### `review.table` 审查表

- 输出 `docx`，风险 medium。
- **必要章节**：结论与说明、审查表（blocker）。
- **验收标准**：**表格行不得为空；每行须有来源**；正文须有结论与说明；**表格本体以 sidecar 为准**。

三条验收标准里，第一条是 `reviewTableAcceptanceProblems` 的口径（第 9 章），最后一条提示了数据在哪。

## 21.9 其他（4 种）

### `matter.timeline` 案件时间线

- 输出 `docx`，风险 low。
- **必要章节**：时间线表（blocker）。
- **验收标准**：输出日期—事实对照表，**空行不得充数**。

### `meeting.minutes` 会议纪要

- 输出 `docx`，风险 low。
- **必要章节**：决议、待办（blocker）；出席（warning）。
- **验收标准**：须有决议与待办；**不升为独立产品页**。

最后半句是个产品决策的残留说明：会议纪要不要单独做成一个产品面。

### `document.general` 通用法律文书

- 输出 `docx`，风险 low。
- **必要章节**：三节全 warning。
- **验收标准**：优先输出可直接交付的正式正文；若信息不足，先给出可编辑正式草稿并明确待补充项。

它是兜底类型。判断不出具体类型时走这里，缺节不挡导出。

### `ppt.training` 培训课件

- 输出 **`pptx`**，风险 low，模板 `ppt/training-cle-default`。
- **必要章节**：规则要点（blocker）；议程、行动/红旗清单（warning）。
- **验收标准**：输出可讲解的培训课件结构，而非长文粘贴；**使用案件材料前须完成脱敏或声明已脱敏**。

唯一的 `pptx` 类型。脱敏要求对应第 10 章讲的 `desensitize-matter.ts`（手机号和身份证是 blocker）。

## 21.10 一张总表

按「风险」和「是否要推理门」分类：

| 风险       | 类型                                                                                                                                                                                                                                | 要不要推理门              |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| **high**   | `letter.demand`、`letter.counsel`、`letter.reply`、`litigation.outline`、`litigation.complaint`、`litigation.answer`、`litigation.brief`、`memo.opinion`                                                                            | 前四个要；后四个不要      |
| **medium** | `contract.rental`、`contract.general`、`contract.nda`、`contract.review`、`report.compliance`、`matter.exhibit_list`、`memo.research`、`memo.internal`、`labor.calc`、`period.calc`、`analysis.table`、`review.table`、`report.esg` | 只有 `contract.review` 要 |
| **low**    | `report.general`、`report.learning`、`ppt.training`、`matter.timeline`、`meeting.minutes`、`document.general`                                                                                                                       | 都不要                    |

推理门**一共两组常量、覆盖 5 种类型**：`LETTER_SHARED`（`letter.counsel`、`letter.reply`）与 `REASONING_GATE_HIGH_RISK`（`letter.demand`、`contract.review`、`litigation.outline`）。其余 **22 种都不写 `reasoningGate`**。

这五份的推理检查严重度是 warning。争点、事实或权威冲突不够时，`validateReasoningAgainstSpec` 的 `ready` 仍为 true，`readyToExport` 不会因此被推理挡住。不要把这些 warning 改成 blocker 来冒充质量。

**别把「高风险」和「要过推理门」划等号**：`litigation.complaint`、`litigation.answer`、`litigation.brief`、`memo.opinion` 同属 high 风险，但都不带 `reasoningGate`（`registry.ts` 里只有那三处 `REASONING_GATE_HIGH_RISK`）。`memo.opinion` 的四节已经把意见书结构写进规格，不再另加一张推理图硬门。

## 21.11 必核清单对照

除了自动验收，还有律师手动的核对清单（第 12 章）。两者按交付物类型挂钩：

| 清单                    | 适用类型 | 项数                                            |
| ----------------------- | -------- | ----------------------------------------------- |
| `contract-review-v1`    | 合同审查 | 7（当事人、责任、知产、终止、引用、协商、客户） |
| `demand-letter-v1`      | 律师函   | 4（事实、主张、期限、口吻）                     |
| `compliance-dossier-v1` | 合规备忘 | 4（管辖区、核实、来源、行动）                   |
| `learning-brief-v1`     | 学习简报 | 3（效力层级、引用、实务）                       |
| `training-ppt-v1`       | 培训课件 | 3（脱敏、可讲、来源）                           |
| `general-v1`            | 兜底     | 4（范围、占位符、引用、风险）                   |

自动验收看空交付。必核清单是律师签批前自己勾的判断，不是第二套关键词门。清单没勾完不能签批；这是明确授权，不是模型硬控。

## 21.12 想加一种新交付物

步骤（第 18 章也提过）：

1. 在 `lawyer-work-specs.ts` 或 `registry.ts` 加 spec。
2. 加进 `BUILT_IN_DELIVERABLE_SPECS`（**顺序被 `registry.test.ts` 锁住**）。
3. 想清楚三件事：
   - 必要章节关键词选什么（选太泛会误判，太窄会漏判）。
   - 占位符要不要在外发前解决。
   - 要不要推理门。
4. 考虑是否加必核清单档。
5. 加测试。

关键词只服务于「缺了哪一节」的提醒。选太泛会误报，太窄会漏报；两种都不许升级成导出失败。

## 21.13 已知坑（本章相关）

- **必要章节识别靠标题关键词，不是语义理解。** `criteria.coverage` 看的是规格里标了 `blocker` 的节在不在，缺了出提醒，不挡导出。它以前读的是检查项自己的严重度；检查项又被统一改成 warning，于是这条提醒永远通过。现在按规格上的 `severity` 算。
- **`ready = false` 只来自空交付和未登记类型。** 缺章节、缺公式、缺证明目的、推理图不够，都不是 `ready` 的分母。
- **`memo.opinion` 四节在规格里全是 blocker，但不要求推理门。** 别按「高风险就要推理门」去推断。
- **占位符规则分两类**（显式 TODO 和骨架字段），要求填掉的类型有八个：`contract.rental`、`contract.general`、`letter.demand`、`letter.counsel`、`letter.reply`、`memo.opinion`、`contract.nda`、`report.compliance`。
- **`ppt.training` 是唯一 `pptx`。**
- **`review.table` 的数据在侧车。** 行是否有出处由 `reviewTableAcceptanceProblems` 看 sidecar，不在这份正文关键词里再判一次。
- **加 spec 要动被测试锁住的数组顺序。**
- **`letter.demand` 与 `letter.counsel` 都叫律师函。** 催告走 `letter.demand`（多「法律后果」一节，并提醒内部分析）；其余律师函走 `letter.counsel`。不要合成一种类型：路由和必核清单已经分开。

## 21.14 实现：一次验收实际跑什么

`validateDraftAgainstSpec`（`src/lawmind/deliverables/validator.ts`）的顺序：

1. 没有登记类型 → `spec.not_found`，blocker，`ready = false`。
2. 每条 `requiredSections` 出一条 `section.*`，严重度固定 warning。标题已含本规格关键词就只对标题；否则看节首 80 字。
3. `placeholders.resolved`：`mustResolveBeforeRender` 的类型有未填项就是 blocker。
4. `criteria.coverage`：规格里的 blocker 节是否都有标题命中。缺了 warning，并在 hint 里点名用途（「还缺：租赁标的描述」）。
5. 未关闭追问、正文占位密度、合同审查的条款锚点与推荐措辞、骨架密度。骨架过密才升 blocker。
6. `buildObjectiveContentChecks`（`content-checks.ts`）按类型追加可核对的提醒，不过就不出现这条检查：

| key                          | 类型                                          | 什么时候提醒                                                     |
| ---------------------------- | --------------------------------------------- | ---------------------------------------------------------------- |
| `calc.formula_source`        | `labor.calc`、`period.calc`、`analysis.table` | 出现金额（期限类还包括日期）但没有公式、等号、乘除或 `calculate` |
| `exhibit.purpose`            | `matter.exhibit_list`                         | 全文没有「证明目的 / 证明对象 / 证明内容」                       |
| `complaint.linear_columns`   | `litigation.complaint`                        | 正文里有 Markdown 表                                             |
| `timeline.empty_row`         | `matter.timeline`                             | 有整行空白的表                                                   |
| `letter.internal_analysis`   | `letter.demand`                               | 出现「我方弱点」「内部分析」等对外不该写的句子                   |
| `research.keep_column`       | `memo.research`                               | 同一节写了无命中，这一节却没有「待核实」                         |
| `memo.internal.not_outbound` | `memo.internal`                               | 落款或签署节里同时有「此致」和「律师事务所」                     |

律师看到的句子在 `acceptance-lawyer-copy.ts`。关键词只出现在给模型的补稿行里。

## 21.15 对照：Cursor、Codex、Harvey

Cursor 和 Codex 不靠标题关键词决定一份稿能不能交。它们把结构要求写进说明，把能判定的缺陷交给检查器（类型、测试、空输出）。Harvey 的审查表把出处放在格子上，Playbook 写的是立场（标准 / 回退 / 绝不接受），不是「标题里必须有某个字」。

LawMind 保留 27 份规格，是因为律师交的是文书，不是仓库。规格告诉模型和验收「这一类长什么样」。硬拦只留空交付：没填的【】、密密麻麻的骨架、根本没登记的类型。这是铁律 5。把「标题没出现『风险』」做成导出失败，会把写对了内容、标题不同的稿挡掉，也会逼模型去凑关键词。

这一轮删掉的是会误判的关键词（ESG 的单字母）。标题里已经有本规格的关键词时，节首不能再充别的节；标题没关键词时仍看节首 80 字，所以「合同当事人」不会被判成缺主体。补上的提醒是：没公式的金额、没有证明目的（也认证明对象、证明内容）、空时间线、起诉状里的表、催告函里的内部分析。同一节写了无命中才要求标待核实。内部备忘只在落款节写成可外发函时提醒。这些都不挡导出。

没有把 `letter.demand` 并进 `letter.counsel`。催告多一节法律后果，必核清单也是函件那一档；合成一种会让路由丢「催告」和「一般律师函」的差别。也没有给 `memo.opinion` 补推理门：四节 blocker 已经是意见书的结构，再要求侧车图会在图还没写好时把可用意见书标成未完成。
