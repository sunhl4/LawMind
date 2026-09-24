# 第 54 章 实现精读：从检索结果到草稿

`src/lawmind/reasoning/` 回答一个问题：**`ResearchBundle` 怎么变成 `ArtifactDraft`？**

这是「系统会写」升级为「系统会推理」的那一层。它有两个模式：默认**规则驱动**（不调模型就能出稿），可选**模型增强**（env 或桌面配置开了才用）。

18 个实现文件，加 `compile/` 的 4 个，本章逐个讲。

## 54.1 入口与两种模式

`reasoning/index.ts` 是一个**纯 barrel**（它自己不定义任何东西），头部注释三行讲清了分工：

```text
将 ResearchBundle 整理为 ArtifactDraft。
- 默认：keyword-draft 规则驱动
- 可选：LAWMIND_REASONING_MODE=model + LLM 凭据，使用 buildDraftAsync()
```

### `buildDraft`（规则驱动）

`keyword-draft.ts` 的签名是：

```ts
buildDraft(params: BuildDraftParams): ArtifactDraft
```

`BuildDraftParams` 有六个字段：`intent`、`bundle`、`title?`、`templateId?`、`lawMindRoot?`、`workspaceDir?`。

**它是纯函数**（除了读模板与挂出处）。给定同样的 `intent` + `bundle`，产出同样的草稿。

### `buildDraftAsync`（可能用模型）

`model-draft.ts` 的六步：

```text
① params.lawMindRoot 有 → resolveDraftReasoningLlmConfig（读桌面 models.json）
   否则 isModelReasoningEnabled() → reasoningLlmConfigFromEnv（读环境变量）
② 没有配置 → 直接 return buildDraft(params)
③ 有配置 → await buildDraftWithModel(params, cfg)
④ 成功 → 返回增强稿
⑤ 失败 → 拿规则稿；若已有 fallback 备注就直接返回
⑥ 否则在备注里加 MODEL_DRAFT_FALLBACK_NOTE
```

`MODEL_DRAFT_FALLBACK_NOTE` 的文案是：

```text
骨架稿：模型未成稿，已用结构骨架。不能当作成稿外发，请补全或重试。
```

**这句文案是本章最重要的一处设计**：模型失败时产出的不是「看起来像成稿的东西」，而是一份**明确标着「不能外发」的骨架稿**。

### 两种模式各在什么时候用

| 场景                                             | 用哪个               |
| ------------------------------------------------ | -------------------- |
| CLI / 引擎测试                                   | `buildDraft`（默认） |
| 桌面（配了模型）                                 | `buildDraftAsync`    |
| `LAWMIND_REASONING_MODE=keyword`                 | 强制规则             |
| `LAWMIND_REASONING_MODE=model`（或不设）+ 有凭据 | 倾向模型             |

`isModelReasoningEnabled` 的判定（注释原文）：

> E6：MODE 未设或为 model 时，有凭据即启用；keyword/off 关闭。

三个**拒绝用模型扩写**的情况（`buildDraftWithModel` 里的三步检查）：

| 情况                                         | 为什么拒               |
| -------------------------------------------- | ---------------------- |
| 标题含「大纲待确认」                         | 大纲还没确认，不许扩写 |
| 某节标题含「待确认 — 确认前不扩写」          | 同上                   |
| `isOutlineGatedDeliverable(deliverableType)` | 大纲先行的三类交付物   |

第三条对应的三类是 `report.compliance`、`report.learning`、`ppt.training`（第 54.5 节讲）。

## 54.2 规则草稿：一份稿子怎么搭起来

`keyword-draft.ts` 的做法是「按 `deliverableType` 分发」。它内部有一张**标题表**（我数了 27 条），把类型映射成中文标题：

| 类型                   | 标题                                   |
| ---------------------- | -------------------------------------- |
| `contract.rental`      | 房屋租赁合同                           |
| `contract.review`      | 合同审查意见书                         |
| `contract.general`     | 合同草案                               |
| `contract.nda`         | 保密协议                               |
| `letter.demand`        | 催告函 / 律师函                        |
| `letter.reply`         | 回函稿                                 |
| `litigation.complaint` | 民事起诉状                             |
| `litigation.answer`    | 民事答辩状                             |
| `litigation.brief`     | 代理词                                 |
| `memo.opinion`         | 法律意见书                             |
| `memo.research`        | 检索研究备忘                           |
| `memo.internal`        | 内部备忘                               |
| `labor.calc`           | 劳动补偿计算                           |
| `period.calc`          | 程序期限计算                           |
| `analysis.table`       | 核算对照                               |
| `matter.timeline`      | 案件时间线                             |
| `matter.exhibit_list`  | 证据目录                               |
| `meeting.minutes`      | 会议纪要                               |
| `report.compliance`    | 广告与产品合规备忘（另有合规卷宗路径） |
| `report.general`       | 专项研究报告                           |
| `ppt.training`         | （走模板变体）                         |
| 兜底                   | LawMind 法律文书草稿                   |

### 三个细节

**第一：`summary` 的长度守卫**。摘要超过 80 字就截——因为它是给律师扫一眼的。

**第二：负向结论的识别**。有一个正则：

```text
/(不|未|无|不得|不能|禁止|否|not|no|cannot|must not)/i
```

命中的结论会被标成负向。**为什么要分正负**：检索里既有「支持我方的」也有「不利的」（第 10 章的命题矩阵就是正反两路）。不分的话，写进备忘里会看不出立场。

**第三：`reviewStatus: "pending"`**。规则稿永远落成待审——**它不给自己批**。

### 只对特定类型产出交付物骨架

有一个白名单（`isDeliverableDraftIntent`）：

```text
memo.research / memo.internal / labor.calc / period.calc / analysis.table
（外加 intent.kind === "draft.word"）
```

**白名单外的类型不走「交付物骨架」那条路**。这是「不是所有意图都要产出一份正式文书」的落地。

## 54.3 派生事实：把该算的算好

`derived-facts.ts` 是这一章最值得细读的文件。它的头部注释讲了它解决什么问题：

```text
派生事实（derived facts）——把该算的算好，作为素材喂给模型。
```

而且写明了一条**模块纪律**：

```text
本模块的产出没有任何拦停权，只作为 prompt 素材（与改稿范例、黄金范例同类）。
因此：任何异常一律吞掉；算不出就是空数组；永不抛。
```

**「没有拦停权」是理解这个模块的关键**：它算错了不会挡住交付，算不出也不报错。所以它敢做「猜」，因为猜错的代价只是模型多看到一条没用的素材。

### 九种事实与它们的算式

| kind                        | 算式                                                                     | 守卫                                                  |
| --------------------------- | ------------------------------------------------------------------------ | ----------------------------------------------------- |
| `deliverable_scope`         | 查表（不是算术）：交付物类型 → 文书体裁                                  | 类型能解析                                            |
| `deposit_cap_ratio`         | `定金 ÷ 总价 = 比例 → 百分比`；`总价 × 20% = 上限`；`定金 − 上限 = 超额` | 有「定金」标记 + 标注的总价                           |
| `payment_sum`               | `sum(各期) = 合计`；`合计 − 总价 = 差额`                                 | 去重后 ≥2 项；比例项排除                              |
| `unit_price_times_quantity` | `单价 × 数量 = 计算值`；有差则 `计算值 − 总价 = 差`                      | 数量与单价必须在同一句                                |
| `total_inconsistent`        | `各值用 ≠ 连接 → N 个不同值`                                             | ≥2 处标注总价且有 ≥2 个不同值                         |
| `payment_ratio_sum`         | `各百分比相加 = 合计`；`合计 − 100 = 差`                                 | 0 < pct ≤ 100；排除违约金/公差句；要有支付语境；≥2 项 |
| `limitation_deadline`       | `起算日 + 3 年 = 届满日`                                                 | 需「诉讼时效」字样 + 明确日期                         |
| `deadline`                  | `锚点日 + N 单位 = 到期日`                                               | 跳过工作日（注：工作日不折算）                        |
| `penalty_asymmetry`         | 同基数：`最大率 ÷ 最小率 = 倍数`；不同基数：`基数集合 X ≠ Y → 不可比`    | ≥2 处逾期违约金                                       |

**`limitation_deadline` 用的 3 年来自参数表**（`lint/statute-params.ts` 的 `DEFAULT_LIMITATION`，依据民法典第 188 条），而不是写死在推理层。这条链路：**参数集中在 lint 的 statute-params，推理层引用它**。

### 三个上限

| 常量                          | 值                         |
| ----------------------------- | -------------------------- |
| `MAX_FACTS_BLOCK_CHARS`       | 720                        |
| `DERIVED_FACTS_CAP_TOKENS`    | 470                        |
| `DERIVED_FACTS_MAX_FILES`     | 8                          |
| `DERIVED_FACTS_MAX_CHARS`     | 200000                     |
| `DEFAULT_DERIVED_FACTS_LIMIT` | `Number.POSITIVE_INFINITY` |

**注意最后一个是不限**（`Infinity`）——但真正的限制在字符上限与 block cap 上。

### 两个「诚实」的设计

**第一：丢整条不截半条。**

`formatDerivedFactsPromptBlock` 超预算时**丢掉整条事实**（不是截断），并追加一句：

```text
（另有 N 条算好的事实未展开——本章只保留最关键的几条。）
```

**第二：算不出来时明说。**

一条事实都没有时，提示块里写的不是空白，而是：

```text
派生事实：本材料上无可证明的计算（不是「没有问题」，是「算不出来就不说」）。
```

**这句话是全仓最典型的「诚实措辞」之一**：它主动区分了「没算出来」和「没问题」。

### 提示块的标题

```text
## 已算好的事实（代码计算，可复核）
```

「代码计算，可复核」这六个字是关键——它告诉模型（和律师）：**这些数不是模型算的，是代码算的，你可以去核。**

### 计算器的优先级

`COMPUTERS` 数组的顺序就是优先级：

```text
deliverable_scope → deposit_cap_ratio → payment_sum → unit_price_times_quantity
→ total_inconsistent → payment_ratio_sum → limitation_deadline → deadline
→ penalty_asymmetry
```

**`deliverable_scope` 永远先算**（它不受文本长度门槛约束），其余八个只在 `body.trim().length >= 20` 时才算。

## 54.4 推理图：IRAC 那套结构

`legal-graph.ts` 的头部注释说明了它的定位：

```text
在检索（ResearchBundle）和起草（ArtifactDraft）之间插入显式推理层。
把"模型会写"升级为"系统会推理"，沉淀：
  - 争点树（issue tree）
  - 论证矩阵（argument matrix）
  - 权威冲突列表（authority conflicts）
  - 交付风险标记（delivery risks）
```

### 四个数据结构的字段

**争点**（`LegalIssueNode`）：`issue`、`elements[]`（IRAC 要件）、`facts[]`、`evidence[]`、`authorityIds[]`、`openQuestions[]`、`confidence`。

**论证位**（`ArgumentPosition`）：`position`、`supportIds[]`、`likelyCounterarguments[]`、`rebuttals[]`、`evidenceBacked`。

**权威冲突**（`AuthorityConflict`）：`authorityIds[]`、`conflict`、`resolutionNote?`、`resolved`。

**整图**（`LegalReasoningGraph`）：`taskId`、`matterId?`、`issueTree[]`、`argumentMatrix[]`、`authorityConflicts[]`、`deliveryRisks[]`、`overallConfidence`、`builtAt`。

### 规则构建的四个动作

`buildLegalReasoningGraph` 的做法：

1. **按争点建 issue tree**：每个 claim 变一个争点，`issue = claim.text.slice(0, 80)`。
2. **填要件**：从来源分类推——`AUTHORITY_SOURCE_KINDS = {statute, regulation}` 进 `authorityIds`，`EVIDENCE_SOURCE_KINDS = {case}` 进 `evidence`，`FACT_SOURCE_KINDS = {contract, memo, workspace}` 进 `facts`。
3. **标交付风险**：`confidence < 0.5` 的结论标「置信度 < 50%」；要素缺失也标一条。
4. **找权威冲突**：两条 `statute`/`regulation` 的置信度差超过 `AUTHORITY_CONFLICT_CONFIDENCE_GAP = 0.3` 就算冲突，`resolved: false`，`resolutionNote` 是：

```text
建议律师人工判断以哪条结论为主
```

**「建议律师人工判断」就是不自作裁决**——它把冲突摆出来，不替律师选。

### `overallConfidence` 的算法

**是无权重的算术平均**：

```text
issueTree.reduce((sum, n) => sum + n.confidence, 0) / issueTree.length
```

注释里写的是「各争点置信度的加权均值」，但代码是无权重平均。**这是一个注释与实现不一致的地方**——按代码为准。

### 一个「实测为空」的字段

`buildIssueTree` 的注释说明了一件事：`facts` 在实践中**总是空的**。原因是只有 `createWorkspaceAdapter` 会产出 `memo`/`workspace` 类来源，而它的 `claims: []`（工作区适配器只产出来源，不产出结论）。

这解释了第 12 章那条实测结论：`facts_grounded` 检查永远是 0（因为 `factsTotal` 恒为 0）。

### 十个法律主题

`detectLegalTopic` 用十组正则识别主题：违约金、定金、利率、管辖、时效、保密、赔偿责任、知识产权、合同解除、保证。

**它的用途**：给争点打标签，让「同类问题」能被归到一起。

## 54.5 大纲先行：三类的 HITL 门

`research-draft-gates.ts` 只服务三类交付物：

```ts
OUTLINE_GATED_DELIVERABLES = new Set(["report.compliance", "report.learning", "ppt.training"]);
```

**为什么是这三类**：它们是「研究型产出」，结构错了整份就废了。所以要求**先出大纲、律师确认、再扩写**。

### 五步判定

`resolveOutlineForDraft` 的顺序：

```text
① 读已存大纲（没存就现建）
② 从指令里抽律师答复（extractOutlineAnswerFromResume）
     答了 → 落盘 + approve + 返回 approved: true
③ 明确「不同意大纲」→ 重建 + 状态 pending + 备注
     备注文案：「律师不同意上一版大纲，已按当前检索结果重建，请再次确认。」
④ 「不清楚」→ pending + approved: false
⑤ 指令里像是批准 → 标 approved
```

### 未确认时的骨架长什么样

`buildOutlineOnlySections` 产出的标题是：

```text
研究大纲（待确认 — 确认前不扩写正文）
```

正文三条，**是对律师的操作指引**：

```text
1) 回复「大纲已确认」；或
2) 粘贴修订后的 ## 章节 与 - 要点 后确认；或
3) 回复「不同意大纲」以要求重做。
```

**这就是 HITL（人在环内）在文书里的样子**：不是弹个框，而是**把「怎么批准」写进稿子本身**。

### 脱敏门

三类交付物里只有 `ppt.training` 需要脱敏（用案件材料做课件）。`trainingDesenseGateOrThrow` 抛错时：

```text
err.code = "training_desense_gate"
err.scan = gate.scan     ← 扫描结果一起带出来
```

**把扫描结果挂在错误对象上**，是为了让调用方能显示「具体是哪几处敏感信息」——而不是只报「脱敏没过」。

## 54.6 条款图与第二意见

这一对（`clause-graph.ts` + `draft-critic.ts`）解决的是「谁来挑毛病」。

### 先拆条款

`buildClauseGraphFromDraft` 用一条正则切：

```text
ARTICLE_SPLIT = /(?=第[一二三四五六七八九十百千0-9]+条)/g
```

切完之后逐条标三类问题（`missing`）：

| 判据                                | 标注                     |
| ----------------------------------- | ------------------------ |
| 正文为空                            | `条款正文为空`           |
| 命中骨架占位                        | `仍有骨架占位`           |
| 「应当/必须」但无「否则/违约/责任」 | `有义务表述，但未写后果` |

第三条最实用：「说了要做什么，但没说做不到怎么办」——这是合同里最常见的实质缺陷，而且是**纯规则可判的**。

`RISK_HINTS` 有八个词（违约、赔偿、解除、管辖、仲裁、不可抗力、保密、违约金），命中的条款算「有风险」。

### 再上第二意见

`draft-critic.ts` 的头部注释两句讲清了边界：

```text
稿件 critic：第二意见。只追加复核备注，不改写模型正文。
有凭据时按条款 map、再全文 reduce；keyword/off 只走规则。
```

**「不改写正文」是硬约束**。它只往 `reviewNotes` 里加东西。

三条**纯规则**备注（不调模型就能出）：

| 触发                                   | 备注                                         |
| -------------------------------------- | -------------------------------------------- |
| 是合同类但全文无「争议解决/管辖/仲裁」 | `全文未见争议解决或管辖约定，外发前请补上。` |
| 是律师函但无期限表述                   | `律师函未见履行期限，对方难以按期响应。`     |
| 草稿没有正文                           | `草稿没有正文，不能当作成稿。`               |

**这三条都是「结构性遗漏」**，纯规则能判，不需要模型。

### 第二意见的三个上限

| 常量                     | 值    | 含义                          |
| ------------------------ | ----- | ----------------------------- |
| `CLAUSE_MAP_CAP`         | 8     | 条款级 critic 最多看 8 条     |
| `LONG_DRAFT_SECTION_CAP` | 24    | 长稿的节数阈值                |
| `LONG_DRAFT_CHAR_CAP`    | 28800 | 长稿的字符阈值（= 24 × 1200） |

判定「是不是长稿」（`isLongDraftForCritic`）用三个条件任一：条款 >8、节数 >24、正文 >28800 字符。是长稿就走「只审被标记的条款」那条路（最多 12 条）。

### 备注的合并与上限

```text
unique([...ruleNotes, ...modelNotes]).slice(0, 16)
```

去重后最多 16 条，每条正文截 240 字。

### 模型 prompt 的两句话

```text
你是执业律师的第二审阅人。…不要改写正文，不要输出【标签】。
每条不超过 80 字
```

要求「不要输出【标签】」是因为**标注类的词容易污染正文**。

## 54.7 编译期填充：`compile/`

`compile/` 的定位（`compile-fill.ts` 头部注释）：

```text
Shared compile-stage fill IR: extract slots from the instruction, run engines,
leave gaps as 待补. Adapters wrap existing labor/period/complaint/letter fills.
Mail short path and Word tracked lock do not use this.
```

**最后半句划了边界**：邮件短路径和 Word 改稿锁定**不用这套**。那两条路有自己的冻结提示。

### 三个类型

```ts
CompileFillKind = "labor.calc" | "period.calc" | "litigation.complaint"
                | "letter.address" | "liability.cap" | "legal.elements"
CompileFillSlot = { key, label, value?, gap? }
CompileFillIR   = { kind, slots, gaps, computed? }
```

`CompileFillSlot.gap` 的注释是：

> When set, slot is incomplete; never invent a value.

**「never invent a value」是这套 IR 的全部意义**：能算的算进 `computed`，算不出的留成 `gap`，中间没有「猜一个」。

### 两个格式化函数

```text
collectGaps(slots)      → 收集所有 gap（或缺失值的 label）
formatSlotsAsLines(slots) → "label：value" 或 "label：【待补充】（gap）"
```

**注意 `【待补充】` 是固定字面量**——所以「缺什么」在最终文书里是可检索、可统计的。

### 四个 adapter

| 文件                              | 产出 kind              | 槽位                                                                         |
| --------------------------------- | ---------------------- | ---------------------------------------------------------------------------- |
| `labor-period-adapters.ts`        | `labor.calc`           | 补偿种类 / 工龄（年）/ 月工资 / 已算清金额                                   |
| 同上                              | `period.calc`          | 期间种类 / 起算日 / 届满日                                                   |
| `complaint-liability-adapters.ts` | `litigation.complaint` | 受诉法院 / 原告 / 被告 / 诉讼请求                                            |
| 同上                              | `liability.cap`        | 直接损失上限 / 间接可得利益 / carve-out / 基数定义 / 破局条款 / 永不接受命中 |
| `letter-fill.ts`                  | `letter.address`       | 收函对象 / 委托人名称                                                        |

**`liability.cap` 的 adapter 是唯一 `gaps: []` 的**——因为它的每个槽位都有默认文案（第 58.5 节的 `extractLiabilityCapFill` 会给全套默认值）。

### `letter-fill.ts` 的纪律

它的头部注释只有一句：

```text
Letter address slots from the instruction. Never invent 收函/委托人.
```

两条抽取正则：

| 目标     | 正则                                                                          |
| -------- | ----------------------------------------------------------------------------- |
| 收函对象 | `/致[：:]\s*([^\n，。;；]{1,40})/` 或 `/发给\s*(…)(?:的)?(?:催告函\|律师函)/` |
| 委托人   | `/(?:委托人\|我方当事人)[：:]\s*([^\n，。;；]{1,40})/`                        |

抓不到就留 `【收函对象】` / `【委托人名称】`。

**为什么不猜**：函件的收件人和委托人写错，是发错对象的低级错误。所以**宁可留占位符，也不猜一个**。

### `legal.elements` 是个「声明了但没实现」的 kind

`CompileFillKind` 里有 `legal.elements`，但 `compile/` 目录里**没有 adapter 产出它**（`reasoning/legal-elements.ts` 返回的是 `ExtractedLegalElements`，不是 `CompileFillIR`）。

**这是一个「类型先行、实现未跟上」的痕迹**。看到它别去找实现——按第 59 章的说法，要素提取的产出走的是另一条路。

## 54.8 场景骨架：九个 `build*Sections`

`scene-draft.ts` 导出九个 builder，外加十一个正则常量。它们的模式完全一样：

```text
buildFamilyMatterSections(supplement) → ArtifactSection[]
buildCapitalMarketsSections(supplement)
buildGovernanceSections(supplement)
buildCriminalMatterSections(supplement)
buildBankruptcyMatterSections(supplement)
buildAdsComplianceSections(supplement)
buildAppealSections(supplement, instruction)
buildEnforcementObjectionSections(supplement, instruction)
buildFilingPackSections(supplement)
```

**它们在做什么**：给特定场景铺一套固定的章节骨架。比如「上诉」这一类，骨架来自 `formatLitigationStageLine` + `formatEvidenceChainBlock`。

**十一个正则常量全是别名**——它们指向 `skills/capability-patterns.ts`（第 4 章讲过那个共享叶子模块）。所以场景判定和意图编译用的是**同一批正则**，不会漂。

### 时间轴与证据链：两个「线性、不用表格」

| 文件                    | 头部注释要点                                                               |
| ----------------------- | -------------------------------------------------------------------------- |
| `chronology-extract.ts` | 「Linear list (not markdown tables). Do not invent dates.」                |
| `evidence-chain.ts`     | 「Missing evidence is 待补; never invent files. Does not stop the draft.」 |

两者都强调三件事：**线性（不用表格）、不编、不停工**。

时间轴的行格式是：

```text
1. 2024-03-15 —— <事件> —— 来源：交办
```

`cn-date.ts` 处理日期解析，它的纪律写在注释里：

```text
Never invent a day; incomplete 年/月 without 日 is skipped for period math.
```

**「缺日就不参与期间计算」**是条很实际的规则：合同里常写「2024 年 3 月」，这种不能拿来算「30 日内」。

日期合法性检查：年份 1990–2100、月 1–12、日 1–31。

证据链的十条命名证据（节选）：

| 命中                     | 名称           | 证明力 |
| ------------------------ | -------------- | ------ |
| `判决书` / `裁定书`      | 裁判文书       | **强** |
| `工资流水` / `银行流水`  | 工资或银行流水 | 中     |
| `劳动合同`（不带「法」） | 劳动合同       | 中     |
| `聊天记录` / `微信记录`  | 聊天记录       | 中     |
| `考勤记录` / `打卡记录`  | 考勤记录       | 中     |
| `发票`                   | 发票           | 中     |
| `录音`                   | 录音           | 中     |

**只有裁判文书是「强」**——这个评级选择是保守的（其他证据都要结合其他证据才能定案）。

行格式：

```text
1. <证据>——主张/要件：<X>——待证事实：<Y>——证明力：<Z>
```

标题句是：

```text
按论证链列，不要只有文件名。一项证据可挂多个要件。缺证写待补，不停工。
```

**「不要只有文件名」**针对的是那种「证据目录只有清单」的退化。

## 54.9 三个「不该做不可逆动作」的分诊

`quick-triage.ts` 很小，但它体现了一条产品判断。它只有三个档：

| 档                  | 触发正则                                                                                                                 | 横幅文案                                                            |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| `hold_irreversible` | `/现在就(起诉\|报警\|发媒体\|发微博\|公开曝光)\|网上曝光\|先把对方捅出去/`                                               | 分诊：先别做不可逆动作（起诉/公开）。**分析仍给出，不要空白暂停。** |
| `work`              | `/(经济补偿\|赔偿金\|违法解除\|加班费\|双倍工资\|拖欠工资\|写起诉状\|审查.{0,6}合同\|起草.{0,4}(函\|合同)\|计算上诉期)/` | 分诊：要干活（计算、审查或文书）。本回合仍先给结论和缺口。          |
| `answer`            | 兜底                                                                                                                     | 分诊：可先答。能检索则检索；缺材料标【待核实】。                    |

头部注释那两句话是重点：

```text
快问分诊档：可先答 / 要干活 / 先别做不可逆动作.
Always still answers. Never a confirm page or STOP.
```

**「Never a confirm page or STOP」**——三档都只是**横幅**，不是拦截。哪怕律师说「我现在就去起诉」，系统的回应也是「先别急，但我还是给你分析」，而不是弹个确认框或者拒绝回答。

## 54.10 规范效力：废止法不许当依据

`norm-validity.ts` 只有五条规则，但每条都很重要。它识别的旧法名与替代：

| 旧名       | 应改为           |
| ---------- | ---------------- |
| 合同法     | 民法典合同编     |
| 民法通则   | 民法典           |
| 物权法     | 民法典物权编     |
| 担保法     | 民法典担保制度   |
| 侵权责任法 | 民法典侵权责任编 |

**「合同法」那条正则有个负向先行断言**：

```text
/(?<!劳动)(?:《(?:中华人民共和国)?合同法》|合同法(?!编))/g
```

**`(?<!劳动)` 和 `(?!编)` 这两处是关键**：

- `(?<!劳动)` 防的是把「**劳动**合同法」误判成已废止的「合同法」——劳动合同法**是现行有效的**。
- `(?!编)` 防的是把「民法典合同**编**」误判。

头部注释专门点了这件事：

```text
Independent of GCL copy. 劳动合同法 is in force and must not match 合同法.
```

**这是一条典型的「正则误报」防御**，而且防的是会产生严重后果的那一类误报（说一部现行法已废止）。

另外两条固定文案：

```text
法律 > 行政法规 > 地方性法规 / 规章。特别规定优于一般规定。地方规则写明适用范围。
查不到现行文本标【待核实】，其余分析继续。禁止编条号。
```

干净的稿子给一句：

```text
- 本稿未检出已废止的合同法/民法通则/物权/担保/侵权责任法旧名。
```

**报「没检出」而不是沉默**，这一点值得学：律师看得到「系统查过这一项」。

## 53.11（接续）要素提取：把生活语言变成法律语言

`legal-elements.ts` 做一件很关键的事：**口语 → 九类结构化事实**。

九个槽位（`LegalElementSlot`）与中文标签：

| slot        | 标签 |
| ----------- | ---- |
| `subject`   | 主体 |
| `act`       | 行为 |
| `time`      | 时间 |
| `place`     | 地点 |
| `object`    | 对象 |
| `result`    | 结果 |
| `cause`     | 因果 |
| `mensRea`   | 主观 |
| `procedure` | 程序 |

### 七条口语转换

它的核心是一张「口语 → 法律表述」的转换表：

| 律师/客户原话                      | 还原成                             |
| ---------------------------------- | ---------------------------------- |
| 「一直拖着不还」                   | 履行期限届满后未返还或支付         |
| 「拖欠货款/工程款/租金」           | 对方未按约支付到期款项             |
| 「拖欠工资」                       | 用人单位未及时足额支付劳动报酬     |
| 「被开除 / 被辞退 / 解除劳动合同」 | 用人单位单方解除劳动合同           |
| 「不让上班 / 停工停职」            | 用人单位未提供劳动条件或停工       |
| 「口头答应 / 说好了」              | 存在口头约定，书面条款待核         |
| 「希望能起诉/要回/赔偿」           | 委托人表示希望通过法律途径主张权利 |

**注意每条都做了两件事**：把口语变成客观表述，**并且保留不确定性**（「书面条款待核」）。

### 一个「洗掉情绪」的正则

```text
STRIP_EVAL = /(不讲信用|肯定违法|太坑了|黑心|诈骗犯)/g
```

这些带评价的词会被剥掉。对应第 20 章那份技能里的纪律：「评价性用语还原为客观事实」。

**为什么要剥**：文书的正文里不能出现「对方太坑了」这种话，但当事人说的原话里全是这类词。剥掉之后才能写进正式文书。

### 缺就写缺

抓不到的位置写 `【待补充】`，**不停工**（头部注释：`Never blocks; missing slots stay 待补充.`）。

## 54.12 三个报告体裁的章节构造

### 合规备忘与学习简报（`compliance-learning-draft.ts`）

`buildComplianceReportSections` 会产出一张**管辖区效力矩阵**（`buildJurisdictionMatrixMarkdown`），它做四件事：

1. 把来源按**风险域**分桶：`data`（数据隐私）、`trade`（出口管制）、`market`（市场广告）、`labor`（劳动用工）。
2. 按**主机名**判管辖区：

| 主机特征                                                | 管辖区              |
| ------------------------------------------------------- | ------------------- |
| `.gov.cn` / npc.gov / court.gov / samr.gov / cac.gov    | 中国内地            |
| `.europa.eu` / `.eu` / GDPR 字样                        | 欧盟                |
| `.gov` / `.gov.uk` / whitehouse / sec.gov / justice.gov | 美国/英国（请核验） |
| hk / hongkong / `.gov.hk`                               | 中国香港            |

**注意「美国/英国（请核验）」这个括号**——它对不确定的判定主动标了「请核验」。

3. 按来源类型标**效力层级**：`statute` → 「法律/制定法」、`regulation` → 「行政法规/规章」、`case` → 「裁判/执法案例」、`web` → 「**网页（须核验效力）**」。
4. 上限：矩阵最多 12 行，许可说明截 40 字。

还有一行固定要求：

```text
请按效力层级整理（法律 > 行政法规 > 规章 > 指南 > 新闻评论）：
```

**「新闻评论」被明确排在最后**——对应第 20 章那条纪律「新闻不当现行法」。

**大纲未确认时**只会给固定骨架 + `研究大纲（请确认）` 标题；**确认后**才用 `expandApprovedOutlineToSections` 展开，并加来源附录。

### ESG 报告（`esg-report-draft.ts`）

**这个文件没有头部注释**（直接从 import 开始）——是一处遗漏。

它的八节结构固定：执行摘要、报告背景与范围、监管与合规框架、环境（E）、社会（S）、治理（G）、关键指标与披露建议、结论与下一步行动。

标题会按地域与行业定制，四种组合：欧盟 × 新能源汽车 → 「欧盟新能源汽车行业 ESG 合规与披露报告」；只欧盟 → 「欧盟 ESG 合规与披露报告」；只新能源汽车 → 「新能源汽车 ESG 可持续发展报告」；都不是 → 「ESG 可持续发展报告」。

**结论按四条正则分桶**：监管框架、环境、社会、治理。不够的用 `remainder` 补。

### 培训课件（`training-ppt-draft.ts`）

四种变体与模板 id：

| 变体                  | 触发                       | 模板                             |
| --------------------- | -------------------------- | -------------------------------- |
| `caseClinic`          | 诊所 / 案件带教 / 脱敏案例 | `ppt/case-clinic-default`        |
| `crossborderMatrix`   | 跨境 / 涉外 / 比较法       | `ppt/crossborder-matrix-default` |
| `internalKnowledge`   | 所内 / 内部 / 合伙人会     | `ppt/internal-knowledge-default` |
| `trainingCle`（默认） | 其他                       | `ppt/training-cle-default`       |

**议程是写死的两句**：

```text
跨境：1. 范围 / 2. 管辖矩阵 / 3. 冲突点 / 4. 执法趋势 / 5. 客户影响 / 6. 下一步
默认：1. 为什么重要 / 2. 规则要点 / 3. 案例 / 4. 红旗清单 / 5. 行动清单 / 6. Q&A
```

还有一句 IRAC 提示：

```text
Issue → Rule → Application → Conclusion（口播，勿贴全文）
```

**脱敏状态会写进课件**，三种文案：

| 情况                 | 文案                                               |
| -------------------- | -------------------------------------------------- |
| 自动扫描通过但有警告 | `自动扫描通过（仍有 N 项警告，请律师终审）。`      |
| 无阻断级             | `未检出阻断级敏感信息（自动扫描，不能替代人工）。` |
| 未通过               | `脱敏门禁未通过（不应到达此分支）。`               |

以及一句固定声明：

```text
本课件材料已经或应当完成当事人/金额/未公开事实脱敏；禁止外传未公开案情。
```

**「不能替代人工」这半句每次都带**——自动扫描的结论不许被当成人工确认。

## 54.13 已知坑（本章相关）

- **`reasoning/index.ts` 是纯 barrel。** 找实现去各文件。
- **`index.ts` 不导出全部**：`norm-validity`、`legal-elements`、`scene-draft`、`quick-triage`、`chronology-extract`、`evidence-chain`、三个 draft 文件、`research-draft-gates`、`cn-date` 都不在 barrel 里。
- **`lawyer-work-draft.test.ts` 没有对应实现文件。** 残留测试。
- **派生事实「没有拦停权」**，算不出就空数组，永不抛。
- **派生事实丢整条不截半条。**
- **`overallConfidence` 注释说「加权平均」，代码是无权重算术平均。** 按代码为准。
- **`legal-graph` 的 `facts` 实测恒为空**（工作区适配器不产 claims）。
- **模型失败时产出的是「不能外发」的骨架稿**，不是成稿。
- **大纲未确认的三类交付物不许被模型扩写。**
- **`buildOutlineOnlySections` 把「怎么批准」写进稿子**，不是弹框。
- **第二意见只加备注，不改正文。**
- **`CompileFillIR` 的 `legal.elements` 没有实现。**
- **函件的收件人/委托人宁可留占位符也不猜。**
- **`contract-redline-craft` 那份技能正文来自代码常量**（第 20 章讲过），因为要和引擎门槛同步。
- **`norm-validity` 的两处负向断言（`(?<!劳动)` / `(?!编)`）不能删。** 删了会说劳动合同法已废止。
- **`quick-triage` 三档都只是横幅。** 不改「必须回答」这条底线。
