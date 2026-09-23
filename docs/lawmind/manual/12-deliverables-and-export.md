# 第 12 章 交付物、验收与质量指标

这一章讲「稿子能不能出」这件事的判定体系，以及 LawMind 用来衡量自己的那套指标——**包括它明确拒绝用的那些指标**。

## 12.1 交付物规格：先定标准，再出稿

问题很直接：一份「法律意见书」要写到什么程度才算能交？「合同审查意见」和「内部备忘」的区别在哪？

如果不定标准，模型会按自己的理解交一份东西，然后你花时间挑毛病。所以 LawMind 给 27 种交付物各写了一份**规格**（spec），规定：

- 必须有哪些章节（缺少算 blocker）。
- 章节靠关键词识别。
- 有些占位符必须在外发前解决。
- 某些类型还要过推理门。

规格存在 `src/lawmind/deliverables/lawyer-work-specs.ts` 和 `registry.ts`，注册表里列了全部 27 个。

## 12.2 27 种交付物

按注册表顺序（顺序被测试锁住）：

| #   | id                     | 名称                 | 输出     | 风险 | 强制章节数（blocker） |
| --- | ---------------------- | -------------------- | -------- | ---- | --------------------- |
| 1   | `contract.rental`      | 房屋租赁合同         | docx     | 中   | 6                     |
| 2   | `contract.general`     | 通用商务合同         | docx     | 中   | 5                     |
| 3   | `letter.demand`        | 律师函 / 催告函      | docx     | 高   | 5                     |
| 4   | `contract.review`      | 合同审查意见         | docx     | 中   | 3                     |
| 5   | `litigation.outline`   | 诉讼策略提纲         | docx     | 高   | 4                     |
| 6   | `report.esg`           | ESG / 可持续发展报告 | docx     | 中   | 0（全是 warning）     |
| 7   | `report.general`       | 研究报告             | docx     | 低   | 0（全是 warning）     |
| 8   | `report.compliance`    | 涉外合规卷宗备忘录   | docx     | 中   | 5                     |
| 9   | `report.learning`      | 学习型调研简报       | docx     | 低   | 1                     |
| 10  | `ppt.training`         | 培训课件             | **pptx** | 低   | 1                     |
| 11  | `letter.counsel`       | 律师函               | docx     | 高   | 5                     |
| 12  | `letter.reply`         | 回函稿               | docx     | 高   | 3                     |
| 13  | `litigation.complaint` | 起诉状               | docx     | 高   | 4                     |
| 14  | `litigation.answer`    | 答辩状               | docx     | 高   | 3                     |
| 15  | `litigation.brief`     | 代理词               | docx     | 高   | 2                     |
| 16  | `memo.opinion`         | 法律意见书           | docx     | 高   | **4（全部 blocker）** |
| 17  | `memo.internal`        | 内部备忘             | docx     | 中   | 2                     |
| 18  | `matter.timeline`      | 案件时间线           | docx     | 低   | 1                     |
| 19  | `matter.exhibit_list`  | 证据目录             | docx     | 中   | 1                     |
| 20  | `meeting.minutes`      | 会议纪要             | docx     | 低   | 2                     |
| 21  | `contract.nda`         | 保密协议             | docx     | 中   | 3                     |
| 22  | `memo.research`        | 检索研究备忘         | docx     | 中   | 6                     |
| 23  | `labor.calc`           | 劳动补偿计算         | docx     | 中   | 3                     |
| 24  | `period.calc`          | 程序期限计算         | docx     | 中   | 2                     |
| 25  | `analysis.table`       | 核算对照             | docx     | 中   | 3                     |
| 26  | `review.table`         | 审查表               | docx     | 中   | 2                     |
| 27  | `document.general`     | 通用法律文书         | docx     | 低   | 0（全是 warning）     |

`memo.opinion`（法律意见书）是要求最严的：争点、结论、引用、保留意见，四个章节全是 blocker。少一个都不算能交。

几个值得注意的：

- **`memo.research` 要六节**：事项、命题矩阵、现行法条、正向类案、反向类案、结论。它的验收标准里有一句「无命中也保留栏目并标待核实」——**栏目必须留着**，不能因为没查到就把这一节删掉。
- **`labor.calc`** 的要求是「金额必须带来源公式；缺流水标缺口，不得口算假数」。
- **`contract.review`** 有两条专属检查（下面讲）。
- **`review.table`** 要求「表格行不得为空；每行须有来源」。
- **`litigation.complaint`** 有一句很有意思：「用线性栏目，不要 markdown 表冒充要素表」。因为要素式起诉状在 Word 里是线性段落，用 markdown 表格会出现渲染后排版烂掉的问题。

## 12.3 章节识别与占位符

### 章节靠关键词匹配

判定「有没有这一节」的方式是：拿章节的 `keywords` 去匹配**标题 + 正文前 80 字**。

比如 `contract.review` 的「主要风险」这一节，关键词是「风险」「问题」。标题叫「二、主要风险」或者正文开头提到「主要风险」，都算命中。

这个方式的好处是容忍写法差异（「风险分析」「风险提示」都算）；坏处是可能误判。所以它是**结构代理**，不是语义理解——后面 12.4 会讲 `criteria.coverage` 那条检查就说明了这一点。

### 占位符规则

有些交付物在导出前必须把占位符填掉。占位符有两类模式：

| 模式                           | 匹配什么                              |
| ------------------------------ | ------------------------------------- |
| `EXPLICIT_TODO_PLACEHOLDER`    | 显式的「待补」类标记                  |
| `SCAFFOLD_PLACEHOLDER_PATTERN` | 骨架字段占位（比如「合同编号：___」） |

要求填掉的（`mustResolveBeforeRender: true`）有这些类型：`contract.rental`、`contract.general`、`letter.demand`、`letter.counsel`、`letter.reply`、`memo.opinion`、`contract.nda`、`report.compliance`。

其余类型即使有占位符也只是警告。设计逻辑是：**对外发件不能带「待补」，对内稿子可以。**

### 骨架密度

除了占位符，还有个更粗的判断：骨架密度。规则（`isHighScaffoldDensity`）：

- 骨架样本 ≥ 3 个 → 密集。
- 或者样本 ≥ 2 个且正文少于 200 字 → 密集。

密集时那条检查的严重度从 warning 升级成 **blocker**。

意思是：一份稿子里三处「待补」，那就不是「差不多能用」，而是「根本没写完」。

## 12.4 验收检查的八类

跑一次验收（`validateDraftAgainstSpec`）会产出一组检查项，每项有 key、标签、是否通过、严重度（blocker / warning）、以及一条提示。

八类检查：

| key                                        | 严重度                    | 判什么                                            |
| ------------------------------------------ | ------------------------- | ------------------------------------------------- |
| `section.<序号>.<关键词>`                  | 按规格（blocker/warning） | 必要章节在不在                                    |
| `placeholders.resolved`                    | 需要就 blocker            | 占位符清干净没                                    |
| `criteria.coverage`                        | **warning**               | 所有 blocker 章节都过了没（结构代理）             |
| `clarifications.closed`                    | **warning**               | 有没有还没答的澄清问题（有就不过）                |
| `draft.body.placeholder_density_heuristic` | **warning**               | 占位符密度启发式，正文 ≥400 字才跑，阈值 **0.38** |
| `contract.review.clause_anchor`            | **blocker**               | 只管合同审查：风险/问题章节里有没有条款锚点       |
| `contract.review.recommended_wording`      | **warning**               | 只管合同审查：建议章节里有没有推荐措辞            |
| `draft.scaffold_density`                   | 密集则 blocker            | 骨架密度                                          |

两条合同审查专属检查值得展开：

- `contract.review.clause_anchor` 要的是：风险章节里出现 `第X条`、`Article N`、或者 `〔待核实〕`/`[待核实]` 标记。也就是说——**每条风险得指向具体条款，或者明说「这条我还没核实」。** 光写「本合同存在风险」不算。
- `contract.review.recommended_wording` 要的是：建议章节里出现「推荐措辞」「建议改为」「改为…」「修订为」这类表述。**只说「建议修改」不够，得给出改成什么。**

### blocker 和 warning 的区别

这个区别贯穿整个体系：

- **blocker 没通过 → `ready = false` → 渲染被拒、导出被挡。**
- **warning 只是建议，永远不影响 `ready`。**

`AcceptanceReport` 里两个计数是分开的，界面也是分开显示的。`ready` 的判定就是一句：`blockerCount === 0`。

`criteria.coverage` 为什么只是 warning？因为它本质上是个结构代理——它只能看「结构上齐了没」，看不出「内容真的覆盖了要求」。注释也承认这一点，语义覆盖要靠 LLM 评审。用 warning 是合适的：不能因为一个不准的检查挡掉交付。

## 12.5 严格模式与渲染阻断

导出时的判定在 `engine/rendering.ts`：

```text
strict = opts?.strictGates ?? isFeatureEnabled("acceptanceGateStrict")
if (!acceptanceReport.ready || (reasoningReport.required && !reasoningReport.ready)) → 拒绝
```

拒绝时会写一条审计事件 `artifact.render_blocked`，详情记着 `acceptance.ready=…; reasoning.ready=… (required=…)`。

`acceptanceGateStrict` 在**三个版本里都是 true**（solo / firm / private_deploy）。也就是说，**严格模式默认就是开的**。

引用门是独立的一条（`citationGateStrict`），同样三档默认 true。

有一条边界要说清楚：**只有 `rejected`（已驳回）状态绝对不许渲染**（第 8 章讲过）。待审、需修改、已批准都能渲染，但出口时仍要过验收门。

## 12.6 推理门：争点、事实、权威冲突

除了「章节齐不齐」，高风险交付物还有一道**推理门**：草稿背后得有一个说得清的推理图（IRAC 那种结构）。

哪些类型要过？三组：

| 组         | 类型                                                     |
| ---------- | -------------------------------------------------------- |
| 函件类     | `letter.counsel`、`letter.reply`                         |
| 高风险类   | `letter.demand`、`contract.review`、`litigation.outline` |
| 其他 22 种 | **不需要**                                               |

推理门的配置长这样（以高风险类为例）：

```ts
{
  required: true,
  requiresReasoningGraphAtDraft: true,
  minIssues: 2,
  mustResolveAuthorityConflicts: true,
  minFacts: 2,
}
```

翻译一下：至少 2 个争点、必须解决权威冲突、至少 2 条事实。

### 六项检查

| key                            | 严重度           | 判什么                 |
| ------------------------------ | ---------------- | ---------------------- |
| `graph_present`                | 按是否 required  | 有没有推理图           |
| `min_issues`                   | 按是否 required  | 争点数够不够（默认 1） |
| `facts_grounded`               | **永远 warning** | 事实数够不够（默认 0） |
| `authority_conflicts_resolved` | 按配置           | 权威冲突解决了没       |
| `issues_have_authority`        | **永远 warning** | 每个争点有没有依据     |
| `confidence_ok`                | **永远 warning** | 整体置信度 ≥0.4        |

`facts_grounded` 为什么永远只是 warning？代码里给了一个很实在的理由，而且带着实测数据：

> `factsTotal` 恒为 0。**2026-09-22 用真实工作区实测确认**（136 份 `drafts/*.reasoning.json`）：争点数为 0 → 117（**86%**）……其中 `facts` > 0 → **0**……其中 `evidence` > 0 → **0**……也就是说：**这一层在真实使用中基本是惰性的。**

也就是说，如果他们把它设成 blocker，那么**每一次高风险交付都会被挡住**，因为那个字段在实际使用中从来不是 0。这是一次很诚实的处理：**发现某个检查项是惰性的，就把它降级成建议，并留下实测数据说明原因，而不是留着它假装有用或者直接删掉。**

### 五条结构检查

还有一组「论证结构」检查（G3），五条，全部是 warning（注释写着「advisory 先行」）：

| key                         | 判什么                                    |
| --------------------------- | ----------------------------------------- |
| `issues_grounded`           | 每个争点都有事实或证据支撑                |
| `argument_supports_traced`  | 论证矩阵的支撑依据可追溯                  |
| `authorities_cited_in_body` | 权威在正文里被引用（跨「图 ↔ 正文」检查） |
| `irac_levels_present`       | IRAC 三级都在                             |
| `no_open_questions`         | 还有未决问题就不能判收敛                  |

有一句注释划了边界：

> 全部是 `LegalReasoningGraph` 上的集合运算，不涉及法律结论——所以它们**不能**被当成质量分。

这是关键：这些检查是**结构检查**，通过的稿子不等于法律上正确。把它当质量分会误导人。

## 12.7 必核清单

除了自动验收，还有一份**律师手动核对**的清单（`verification-checklist.ts`），它的作用是：**没勾完不许签批。**

清单按交付物类型分：

| 清单 id                 | 适用类型 | 核对项                                     |
| ----------------------- | -------- | ------------------------------------------ |
| `contract-review-v1`    | 合同审查 | 当事人、责任、知产、终止、引用、协商、客户 |
| `demand-letter-v1`      | 律师函   | 事实、主张、期限、口吻                     |
| `compliance-dossier-v1` | 合规备忘 | 管辖区、核实、来源、行动                   |
| `learning-brief-v1`     | 学习简报 | 效力层级、引用、实务                       |
| `training-ppt-v1`       | 培训课件 | 脱敏、可讲、来源                           |
| `general-v1`            | 兜底     | 范围、占位符、引用、风险                   |

没勾完就签批，会抛：

```text
checklist_incomplete: missing <缺失的项 id>
```

错误码是 `checklist_incomplete`。

### 三类「谁判」

这一层还引出一个更细的设计：每个核对项标一个**判定级别**：

| 级别      | 谁判                                     |
| --------- | ---------------------------------------- |
| `machine` | 代码验证器（比如引用是不是检索结果里的） |
| `judge`   | 独立审稿模型                             |
| `lawyer`  | 律师                                     |

这张表有 150 项（其中 125 项来自 Word 改稿清单，25 项来自验收清单）。分级解析有三条 fail-closed 纪律（第 8 章讲过）：键不在表里当 `judge`；`machine` 缺验证器退成 `judge`；`lawyer` 缺理由仍保留 `lawyer`（往安全方向退）。

界面上给律师看的覆盖说明是：

```text
本次机械核对 N 项，其中 M 项由确定性规则判定，K 项需您定夺。通过核对 ≠ 法律正确。
```

## 12.8 交付档位：三档，且外发永不自动

「稿子过了验收」和「稿子可以自动发出去了」是两件事。这里有一套分档逻辑（`resolve-delivery-tier.ts`）：

| 档位              | 什么时候                           |
| ----------------- | ---------------------------------- |
| `full_review`     | 律所强制全审；或者风险等级是**高** |
| `one_tap_signoff` | **外发**；或者风险等级是**中**     |
| `auto_deliver`    | 低风险 + 非外发 + 自主度已解锁     |

注意第二条：**外发只有「点一下确认」这一档，没有任何情况能退到自动交付。**

判定顺序也是固定的：先看律所强制，再看高风险，再看外发，再看中风险，最后才是低风险 + 自主度。

### 自动交付的条件很严

`evaluateAutoDeliver` 要求：**没有 blocker，也一条 warning 都没有**（`blockerCount === 0 && warningCount === 0`）。有一条 warning 就不自动。

外发判定（`isOutboundDraft`）看两个正则：受众里出现「客户\|对方\|法院\|仲裁\|外发\|client\|court」，或者类型以 `letter.`、`email.`、`mail.` 开头。

### 渐进自主：拿数据换信任

自动交付不是一开始就给的，要满足三个条件（`isAutonomyUnlocked`）：

| 条件        | 默认门槛                      |
| ----------- | ----------------------------- |
| 一次通过率  | ≥ 0.8（`minFirstPassRate`）   |
| 样本数      | ≥ 20（`minSamples`）          |
| lint 逃逸率 | ≤ 0.15（`maxLintEscapeRate`） |

而且拒绝的条件写得比通过的条件多：

- 一次通过率是 `null` → 拒绝。
- 样本不够 → 拒绝。
- 通过率不达标 → 拒绝。
- 逃逸率样本是 `null`、逃逸率是 `null`、或者逃逸样本数是 **0** → 拒绝。
- 逃逸率超标 → 拒绝。

注意「逃逸样本数是 0 就拒绝」这条。它防的是「因为从来没测过，所以逃逸率看起来是 0」这种假通过。

## 12.9 判断项棘轮：从「整篇要审」到「只审这几项」

这是比交付档位更细一层的东西。

想法是这样：如果某一类判断项（比如「管辖条款是否唯一确定」）在历史上模型判得都很准，那这一项就可以从「必须律师看」降级到「机器判」。这就是棘轮——只往一个方向走（更自动化），但每次升级都要有数据支撑。

升级条件（`DEFAULT_JUDGEMENT_PROMOTION`）：

```ts
{ minSamples: 20, maxFalsePositiveRate: 0.1 }
```

也就是：至少 20 个样本，误报率不超过 10%。

判定结果是五种原因之一（按判定顺序）：

| 原因                            | 含义                 |
| ------------------------------- | -------------------- |
| `advisor_not_accepted`          | 这项本来就不需要采纳 |
| `insufficient_samples`          | 样本不够             |
| `escape_series_missing`         | 逃逸序列缺失         |
| `false_positive_rate_above_cap` | 误报率超上限         |
| `promotable`                    | 可以升级             |

### 这个棘轮踩过一次很严重的坑

代码注释记着一段，我必须原文引用，因为它是「假绿」最典型的样子：

> 第 2 项曾一度被我写成「本任务没有任何项报项」——那是**错的**，而且非常危险：棘轮只在「恰好一项报项 **且** cleanDelivery」时才计入误报，两个条件互斥，于是 `firedClean` 恒为 0、误报率恒为 0，**每一项都会被判可升 blocking**。

也就是说，因为判定条件写错了，误报率永远是 0，于是**所有判断项都会被自动升级到 blocking**——系统会变得越来越自动，而且看起来「数据支持」。这是最难发现的一类 bug：指标一直很好看。

修好之后，测试里专门加了不变量（`judgement-ratchet.test.ts` 的 `"P4 棘轮三条不变量（与 isAutonomyUnlocked 一致）"`）。

## 12.10 决策头：一句话告诉你这稿能不能用

`decision-header.ts` 产出一个「决策头」，四个字段：

```ts
{ changed, why, risk, ready, judgmentCoverage? }
```

`ready` 只有两个值：`usable`（能用）或者 `needs_decision`（要你拍板）。

什么时候算「要你拍板」？`blockerCount > 0`、或者有残余项、或者风险等级是高或中。**低风险且没 blocker 才算「能用」。**

判断项覆盖的格式化文案（`formatJudgmentCoverage`）也定死了，最后一句是「通过核对 ≠ 法律正确。」

## 12.11 验收包

有两层验收包：

- **工作区级**（`acceptance-pack.ts`）：把治理报告、质量报告、签收清单拼成一份 Markdown。
- **单份草稿级**（`draft-acceptance-pack.ts`）：五节——出稿检查、引用完整性、草稿章节速览、与本任务相关的审计事件（默认取 200 条）、律师签收。

草稿级验收包筛选的审计事件类型是固定的十种：`task.created`、`task.confirmed`、`task.rejected`、`research.started`、`research.completed`、`draft.created`、`draft.citation_integrity`、`draft.reviewed`、`draft.review_labeled`、`artifact.rendered`。

导出需要版本功能 `acceptancePackExport`，三档都是开的。

## 12.12 指标：只算能验证的东西

`src/lawmind/metrics/` 的定位写在 README 第一行：

> 提供**基于已落地事件的真实口径指标**，不输出无法验证的「安全分」「质量分」。

这条约束在代码里落实成一个具体规则，我称它「诚实 null 规则」：

**没有样本时，所有比率返回 `null`，绝不返回 0% 或 100%。**

几处原话：

> Missing samples stay null — do not invent a 0% story.
>
> 空样本保持 null——不编造 100% 也不编造 0%。
>
> 缺文件 **不等于** 空结果。`present: false` 表示这个来源从未产生过数据，消费方不得据此推断「逃逸率为 0」。

README 里还专门解释了为什么这条这么重要：

> 把「没有数据」显示成「没有漏网」是这类报告最危险的失败模式。

### 为什么 0 和 null 必须分开

举个具体例子。假设「lint 逃逸率」这一项：

- 显示 **0%**：意思是「我们检测了一批，一个都没漏」——这是好消息。
- 显示 **null**：意思是「这个数据源从来没产生过数据」——这是**坏消息**，说明管线没接通。

把 null 显示成 0%，就等于把「管线坏了」显示成「一切正常」。而且是永久静默的：没人会去查一个 0% 的指标。

### 三态而非布尔

同样的思路也用在人是否验收这件事上。交付事件里有个 `humanAcceptance` 字段，三个值：

- `accepted_clean`：没改就收了。
- `accepted_with_change`：改了才收。
- `unknown`：无法判定。

还有一条**外生性纪律**：

> `reviewedBy` 以 `system:` 开头（自动交付）时，`humanAcceptance` 一律 `"unknown"` —— 系统给自己签的字不算验收。

也就是说，自动交付的稿子不能算「律师验收通过」。否则系统会自己给自己刷分。

## 12.13 校准器：样本不够就拒绝拟合

`firm-calibrator.ts` 想回答一个问题：「按这个稿子的特征，这位律师有多大概率会改它？」

它用确定性逻辑回归（学习率 0.35、L2 正则 0.01、迭代 600 次）拟合，特征 7 个：引用有效率、争点覆盖率、风险召回率、审核标签数、规则命中数、片段字数、延迟日志。

冷启动门槛：

```ts
COLD_START_MIN_SAMPLES = 40;
COLD_START_MIN_PER_CLASS = 5;
```

不到 40 个样本、或者正负例任一不到 5 个，就返回 `status: "insufficient"`，并且 **`predictEditProbability` 返回 `undefined`**。

注释说得很清楚：

> 未拟合（insufficient）时返回 undefined——**不返回默认概率**。

README 补了一句为什么：

> 给一个默认概率会让调用方以为有信号，那是最危险的一种失败模式。

也就是说：**宁可回答「我不知道」，也不给一个「大概 0.5」**。因为「大概 0.5」会被下游当成一个有信息量的数字用起来。

## 12.14 评测的三层证据

`src/lawmind/evaluation/` 的 README 把评测证据分了三层，这个分层很值得学：

| 层  | 名字                    | 是什么                                                 | 能证明什么                             |
| --- | ----------------------- | ------------------------------------------------------ | -------------------------------------- |
| 一  | `fixture-static`        | 直接在夹具文本上跑 lint                                | 只能做 lint 规则回归。**不是引擎证据** |
| 二  | `engine-scripted-model` | 用脚本化的模型响应（cassette）驱动**真实的 `runTurn`** | 默认的发布门证据                       |
| 三  | `real-model`            | 真模型                                                 | 最终验收                               |

第一层的 recall 是「构造性地为 1」——因为规则和夹具是一起写好的，规则必然命中它自己种的标记。所以 README 明说：

> **Not engine evidence.** Use it for lint-rule regression only.

第二层是关键：模型字节是假的，但**引擎是真的**——真工具、真门禁、真 lint、真草稿。所以它能证明「引擎把该做的做了」，而不只是「规则能匹配字符串」。

第三层要显式开启（`LAWMIND_SHADOW_REAL_MODEL=1` 或 `--mode real`）。

对应到 benchmark 有三种模式：`mock`（不能当门禁证据）、`scripted`（可以）、`real`（需要显式开关）。

## 12.15 三道「诚实 SKIP」的门

有三个评测门在数据不足时的行为是**诚实地跳过**，而不是假装通过。

### 真稿门

`true-manuscript-gate.ts` 的头部注释：

> Missing fixtures must skip — never pretend in-repo NDA markdown is 真稿.

也就是说：仓库里那些 NDA 的 markdown 不算「真稿」。真稿得由律师自己脱敏后放进 `fixtures/lawmind-true-manuscript/`。没放就 SKIP，报告如实写 SKIP。

### 人类基准门

`human-baseline.ts` 的注释：「无夹具 / 夹具不足：诚实 SKIP 或 insufficient，绝不假绿。」

它要的是**同题双稿**（人写的和系统写的），放在 `fixtures/lawmind-human-baseline`。要求至少 10 个案例（`HUMAN_BASELINE_MIN_CASES`），并且「不低于」的比率要达到 0.8。

流程包括盲评：`buildBlindPacket` 生成盲评包，`readBlindLabel` 读回标签，然后 `compareSides` 出结论（`lawmind_above` / `tie` / `lawmind_below`）。

### 影子回放

`replay-fixtures.ts` 里有一句很重要的口径声明：

> 这些 fixture 是手工构造的合成样本，不是「真实任务回放」证据；真实已结案回放属于人/数据债。

也就是说，连评测夹具本身也不假装成真实数据。

## 12.16 发射产物与签名状态

`release-artifacts.ts` 检查安装包是不是签名公证过，四个状态：

| 状态               | 含义           |
| ------------------ | -------------- |
| `signed_notarized` | 已签名且已公证 |
| `signed_only`      | 只签名没公证   |
| `unsigned`         | 未签名         |
| `not_evaluated`    | 未评估         |

注释：「诚实口径：产物不存在就报「未评估」，不把「没跑打包」写成「已公证」。」

## 12.17 门禁脚本

| 命令                             | 干什么                                                                                 | 关键参数                                                                                                         |
| -------------------------------- | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `pnpm lawmind:gate`              | 交付验收门 CLI                                                                         | `--task`、`--all`、`--strict`、`--specs`、`--pack <taskId>`、`--json`                                            |
| `pnpm lawmind:benchmark`         | 跑 benchmark + 影子回放                                                                | `--mode`、`--threshold`（默认 0.8）、`--strict`、`--real-model`、`--shadow-engine`                               |
| `pnpm lawmind:compiler-gate`     | 离线编译器门：规则数 ≥20（`MIN_RULES`）、影子样本 ≥10（`MIN_SHADOW`）、缺陷召回必须 =1 | 无参数                                                                                                           |
| `pnpm lawmind:human-baseline`    | 人类基准盲评                                                                           | `--write-rubric`、`--write-blind`、`--workspace`                                                                 |
| `pnpm lawmind:true-manuscript`   | 真稿门                                                                                 | `--write-baseline`、`--workspace`                                                                                |
| `pnpm lawmind:decision-samples`  | 决策样本导出与数据健康报告                                                             | `--json`、`--dry-run`、`--event-window`                                                                          |
| `pnpm lawmind:north-star-trend`  | 北极星趋势（按 ISO 周分桶）                                                            | `--window`（默认 90，夹 1–365）、`--json`                                                                        |
| `pnpm lawmind:release-readiness` | 发布就绪总报告                                                                         | `--out`、`--benchmark-in`                                                                                        |
| `pnpm lawmind:acceptance`        | 八步验收链                                                                             | `--strict-env`                                                                                                   |
| `pnpm lawmind:doctor`            | 无界面体检                                                                             | `--json`、`--fix`                                                                                                |
| `pnpm lawmind:ops`               | 运维子命令                                                                             | `status` / `doctor` / `export-dashboard` / `acceptance-pack` / `matter-consistency` / `matter-repair-projection` |
| `pnpm lawmind:sbom`              | 生成 SBOM                                                                              | 无参数                                                                                                           |

几个退出码约定：`lawmind:gate` 退出 0 表示全部就绪或没有草稿，1 表示 `--strict` 下有未就绪，2 表示参数或 IO 错误。`lawmind:compiler-gate` 失败退出 1。

环境变量能把「诚实 SKIP」变成「必须通过」：`LAWMIND_REQUIRE_TRUE_MANUSCRIPT=1`（真稿门 SKIP 就非零退出）、`LAWMIND_REQUIRE_HUMAN_BASELINE=1`（人类基准非 pass 就非零退出）、`LAWMIND_BENCHMARK_STRICT=1`。

## 12.18 HTTP 端点

| 端点                                              | 方法 | 说明                                                  |
| ------------------------------------------------- | ---- | ----------------------------------------------------- |
| `/api/acceptance-summary?matterId=`               | GET  | 验收总览（可指定案件，不传就是全工作区）              |
| `/api/deliverables/specs`                         | GET  | 列交付物规格（标明是内置还是工作区注册）              |
| `/api/policy/edition`                             | GET  | 当前版本与功能开关                                    |
| `/api/drafts/:taskId/acceptance`                  | GET  | 单份草稿的验收 + 推理报告                             |
| `/api/drafts/:taskId/acceptance-pack`             | GET  | 验收包（`?format=json` 出 JSON，否则 Markdown 下载）  |
| `/api/drafts/:taskId/checklist`                   | GET  | 必核清单                                              |
| `/api/metrics/north-star`                         | GET  | 北极星快照                                            |
| `/api/metrics/north-star-trend?windowDays=`       | GET  | 北极星趋势（默认 30，夹 1–365）                       |
| `/api/metrics/team-growth?windowDays=`            | GET  | 团队成长看板                                          |
| `/api/metrics/team-growth/baseline`               | POST | 写团队成长基线                                        |
| `/api/metrics/lawyer-dashboard?matterId=&taskId=` | GET  | 案件级或工作台级指标                                  |
| `/api/support/bundle?download=1`                  | GET  | 诊断包（脱敏 zip；不含案件正文、`.env*`、许可激活码） |

验收包导出在版本功能关闭时返回：

```text
403 { ok:false, error:"feature_disabled", feature:"acceptancePackExport", edition, hint }
```

## 12.19 关键文件

| 关注点           | 文件                                                                                                                                                                                                                                         |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 规格注册表       | `src/lawmind/deliverables/registry.ts`、`lawyer-work-specs.ts`、`types.ts`                                                                                                                                                                   |
| 验收检查         | `src/lawmind/deliverables/validator.ts`                                                                                                                                                                                                      |
| 推理门           | `reasoning-validator.ts`、`reasoning-validator-workspace.ts`                                                                                                                                                                                 |
| 占位符与骨架     | `placeholder-pattern.ts`、`draft-sanity.ts`、`scaffold-status.ts`                                                                                                                                                                            |
| 必核清单         | `verification-checklist.ts`                                                                                                                                                                                                                  |
| 工作区自定义规格 | `workspace-loader.ts`                                                                                                                                                                                                                        |
| 就绪度总览       | `deliverable-readiness.ts`                                                                                                                                                                                                                   |
| 交付档位与自主   | `src/lawmind/delivery/resolve-delivery-tier.ts`、`auto-deliver.ts`、`progressive-autonomy.ts`、`judgement-ratchet.ts`                                                                                                                        |
| 决策头           | `src/lawmind/delivery/decision-header.ts`、`judgment-labels.ts`                                                                                                                                                                              |
| 验收包           | `src/lawmind/delivery/acceptance-pack.ts`、`draft-acceptance-pack.ts`                                                                                                                                                                        |
| 指标             | `src/lawmind/metrics/`（含 README）                                                                                                                                                                                                          |
| 评测             | `src/lawmind/evaluation/`（含 README）                                                                                                                                                                                                       |
| 独立审稿         | `src/lawmind/guardian/`（第 8 章）                                                                                                                                                                                                           |
| HTTP             | `apps/lawmind-desktop/server/lawmind-server-route-acceptance.ts`、`-metrics.ts`、`-support.ts`                                                                                                                                               |
| 桌面 UI          | `LawmindAcceptanceGate.tsx`、`LawmindReviewDeliveryBar.tsx`、`LawmindReviewSelfCheckSummary.tsx`、`LawmindDeskDashboardSummary.tsx`、`LawmindSettingsScorecard.tsx`、`matter/LawmindMatterHealthCard.tsx`、`matter/MatterQualityCockpit.tsx` |
| CLI              | `scripts/lawmind/lawmind-deliverable-check.ts`、`lawmind-benchmark.ts`、`lawmind-compiler-gate.ts`、`lawmind-release-readiness.ts` 等                                                                                                        |

## 12.20 已知坑

- **`criteria.coverage` 只是结构代理。** 它过了不代表内容覆盖全了，别把它当语义质量证明。
- **`facts_grounded` 永远是 warning，这是实测结论。** 真实数据里 136 份推理快照中有 117 份（86%）争点数为 0、`facts > 0` 的是 0 份。把它改成 blocker 会挡掉每一次高风险交付。要修得先修上游「为什么 facts 一直是 0」。
- **结构检查不是质量分。** `reasoning-validator` 里全是集合运算，通过不等于法律正确。
- **严格模式默认开，三档都是。** 别以为 solo 版会宽松，验收门在 solo 也是硬的。
- **只有 `rejected` 绝对不许渲染。** 待审、需修改、已批准都能出草稿，但出口时要过验收门。
- **有一条 warning 就不自动交付。** 自动交付的条件是零 blocker 且零 warning。
- **外发永远没有自动档。** 最高只能到「点一下确认」。
- **「逃逸样本数为 0」会拒绝解锁自主。** 这是防「因为没测过所以看起来是 0」。
- **比率没样本必须返回 `null`。** 看到 0% 要确认一下分母是不是真的存在。这是这套体系里最重要的一条纪律。
- **自动交付的稿子不能算「律师验收」。** `reviewedBy` 以 `system:` 开头时，人工验收一律记 `unknown`。
- **校准器样本不够时返回 `undefined`，不给默认概率。** 别在下游给 `undefined` 兜个 0.5。
- **真稿门、人类基准门在没夹具时是 SKIP。** 报告里显示 SKIP 是正常的，也是诚实的；`LAWMIND_REQUIRE_*` 才会把它变成失败。
- **验收总览的 blocker 计数曾经算错过。** 代码里有一段注释记着：早先写成 `!c.ok`，而字段其实叫 `passed`，于是**每一个 blocker 都被算成未通过**（连已通过的也计）。这个计数是律师可见的。看到类似的「计数偏高」，先确认字段名。
