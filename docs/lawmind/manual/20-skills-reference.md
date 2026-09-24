# 第 20 章 内置技能详解

第 11 章讲的是技能机制。这一章把 37 份内置技能逐个说清楚：**它管什么、什么时候会被用上、它建议用哪些工具、有没有明确的「不要用于」边界。**

## 20.1 怎么读这一章

每条包含固定几项：

- **说明**：技能文件里 `description` 字段的原文（这是模型看到的）。
- **工具**：frontmatter 里 `tools` 声明的工具（有就列，没有就是靠通用工具）。
- **主推于**：它被列为哪几个能力的主阶段技能（决定模型默认能不能看到它的正文）。
- **边界**：说明里明确写的「不要用于」或「不要改成」。

第三项很重要：**没被列为主阶段技能的技能，模型不会默认看到正文。** 它只在索引里，需要时用 `read_skill` 取。所以「这份技能存在」和「这份技能会起作用」是两件事。

## 20.2 合同类（4 份）

### `contract-review-layers` 合同分层审查

- **说明**：宏观交易结构、中观文本形式、微观条款；风险带推荐措辞；缺事实仍出已完成部分。
- **主推于**：`contract.review`、`mail.contract`。
- **边界**：「缺事实仍出已完成部分」是关键——它不许因为资料不全就交白卷。这和第 12 章「缺项标注但仍出稿」的口径一致。

**为什么分三层**：一份合同的「问题」有三个层级——交易结构不对（宏观）、文本形式不规范（中观）、某个条款表述有漏洞（微观）。混在一起说，律师读起来累，而且容易漏掉结构性风险。分层之后，每层的问题不会被另一层的噪音淹没。

### `contract-redline-craft` 合同审阅改稿手艺

- **说明**：合同 tracked 改稿：最短锚定硬门禁（字/词级），条数不限；数字以 `surgical-span-gate` 为准。
- **主推于**：`contract.review`（配合 `contract-review-layers` 一起）。
- **特别处理**：这份技能的正文在读取时**会被代码里的常量版本替换**（`CONTRACT_REDLINE_CRAFT_SKILL`），不读文件。

**为什么会被替换**：这份技能的内容和引擎实现强绑定（最短改动的具体门槛比如「含句读的 find ≤ 12 字」）。如果从 Markdown 文件读，改引擎不改文件就会出现「技能说的和引擎做的不一致」。从代码常量取，两者天然同步。

### `contract-playbook-review` 合同 Playbook 审查

- **说明**：标准/可接受回退/永不接受三档；己方纸与对方纸分开；偏离必须落到具体条款与改法。
- **主推于**：不默认注入（它在索引里）。
- **来源**：这是从 Anthropic 的 playbook 实践消化来的三份之一（Apache-2.0）。

**三档是什么意思**：审合同时每条条款有三种处置——「符合本所标准」「可以接受但有回退空间」「绝不接受」。这个分法比「有风险/无风险」有用得多，因为它直接告诉你**要做什么**。

**己方纸 vs 对方纸**：如果对方给的是他们的格式合同，你的谈判空间和用自己格式时完全不同。分开处理避免「拿己方标准去要求对方格式」这种不现实的建议。

### `contract-drafting-route` 合同起草路由

- **说明**：封闭类型路由卡、条款骨架、待补事实写在稿里。
- **主推于**：`contract.draft`。
- **边界**：它管「从零起草」，已有合同要改走审查那条路。

**「封闭类型」指的是**：合同类型是一个有限集合（买卖、租赁、借款、劳动合同等），每种有自己的必备条款。路由卡的作用是先定类型，再套对应骨架。这比让模型自由发挥要稳。

## 20.3 诉讼与争议类（10 份）

### `litigation-stage-route` 诉讼阶段路由

- **说明**：按材料推断阶段再写文书；上诉、执行、立案清单不套起诉状。
- **主推于**：`litigation.draft`（默认分支）。
- **边界**：明确「上诉、执行、立案清单不套起诉状」。

**为什么这条边界重要**：起诉状、上诉状、执行申请书的格式和「诉讼请求」写法完全不同。拿起诉状模板套上诉状，会写出形式上就不对的东西。这是本仓库反复强调的「致命误绑」之一。

### `complaint-elements-fill` 要素式起诉状母版

- **说明**：按固定栏目填起诉状；线性段落，不用会打烂的表格；缺项标待补充仍出稿。
- **主推于**：`litigation.draft`（起诉状分支）。
- **边界**：「不用会打烂的表格」——这条是排版约束。要素式起诉状在 Word 里是线性段落，用 markdown 表格会在渲染后变形。

### `evidence-argument-chain` 证据论证链

- **说明**：主张→要件→待证事实→证据→证明力；缺证写待补不停工。
- **主推于**：知产争议、刑事等分支（和对应路由技能并列）。**家事分支是例外**——`family.matter` 只配 `family-matter-route` + `legal-element-extraction`，没有它（`skill-prompt-budget.ts:28`）。

**这条链的价值**：它把「我觉得应该赢」变成「哪个要件缺证据」。五步走完，缺哪一环一眼可见。

### `litigation-stage-route` 的兄弟：四个专项路由

| 技能                     | 说明                                                          | 什么时候用           |
| ------------------------ | ------------------------------------------------------------- | -------------------- |
| `criminal-stage-route`   | 按侦查/审查起诉/一审/二审写刑事文书，不套民事起诉状           | 指令里有刑事阶段信号 |
| `bankruptcy-stage-route` | 按申请受理、债权申报、重整/清算写材料，不混用民事起诉模板     | 指令里有破产信号     |
| `family-matter-route`    | 离婚、抚养、继承按家事程序写；子女利益与财产分栏              | 指令里有家事信号     |
| `ip-dispute-route`       | 按专利/商标/著作权/反不正当竞争写知产材料，不套普通民事起诉状 | 指令里有知产信号     |

四份都有同一个句式：「不套 X」。这四类案子的程序法和文书格式差异很大，通用模板套上去就是错的。

### `client-talk-intake` 谈话整理

- **说明**：把客户谈话整理成需求、核心事实、候选案由和证据缺口；对话写穿档案。
- **工具**：`compile_intake_brief`、`apply_intake_brief`、`update_matter_profile`。
- **主推于**：`litigation.talk`。

**注意「对话写穿档案」**：这份技能明确要求把整理结果写进案件档案，而不只是留在对话里。这是第 7 章那个「写了等于没写」故障的正面要求。

### `chronology-from-materials` 时间轴整理

- **说明**：从材料抽日期事件、去重；立场只着色不改时间线。
- **主推于**：`chronology.timeline`。
- **边界**：「立场只着色不改时间线」——把「对我方有利/不利」标出来，但不许为了好看而调整事件顺序或时间。

### `chronology-two-stage` 诉讼时间轴（预览 → 确认 → 成图）

- **说明**：先出可改的时间轴草案并逐条确认事实与日期，确认后才出正式图/表；不把推测日期写成事实。
- **主推于**：不默认注入（索引里）。
- **来源**：消化自外部的三份之一。

**两阶段的意义**：时间轴是很多文书的骨架。骨架错了后面全错。所以先给草案让你改，改完再出正式件。「不把推测日期写成事实」这条同样重要——很多材料里日期是模糊的（「大约在去年三月」），写成确定日期就是编造。

## 20.4 合同与交易辅助（3 份）

### `ma-diligence-route` 并购尽调提纲

- **说明**：股权/资产收购尽调提纲与交割清单；缺口标清，不编未看到的文件。

**「不编未看到的文件」**：尽调清单最容易被「补全」——模型知道标准清单长什么样，于是把没看到的文件也列上。这样清单看着很完整，但分不清「有」和「应该有」。所以必须标清缺口。

### `capital-markets-route` 资本市场文件核对

- **说明**：发行/信息披露核对清单；数字只用来源页；不是股权融资 Word 改稿。
- **版本**：3（改过几次）。
- **边界**：明确「不是股权融资 Word 改稿」——这条防的是和 `equity` 那一族 Word 改稿清单混淆。

### `governance-route` 公司治理路由

- **说明**：决议和治理备忘按公司法程序写；不是章程 Word 改稿。
- **边界**：同样是划清和 Word 改稿的界限。

## 20.5 劳动与期限（3 份）

### `labor-compensation-calc` 劳动补偿计算

- **说明**：N/N+1/2N、加班、双倍工资按规则算并写出公式；必须调用 `calculate`，口算不算完成。
- **工具**：`calculate`。
- **主推于**：`labor.calc`。

**「口算不算完成」**是这份技能最硬的一条。劳动补偿的计算涉及「工作年限折算月数」「月工资上限三倍」「十二年封顶」这些规则，口算很容易错。强制走 `calculate` 意味着：

- 计算过程在引擎里跑（`src/lawmind/labor/economic-compensation.ts`）。
- 结果带公式，可复核。

### `legal-period-calc` 程序期限计算

- **说明**：上诉、答辩、仲裁申请、再审、执行期间用规则引擎算届满日；不要口算。
- **工具**：`calculate`。
- **主推于**：`period.calc`。

**为什么期限必须算**：期间计算涉及「起算日是否计入」「节假日顺延」「期间最后一日是节假日怎么办」这些规则。算错一天可能就丧失权利。

### `matter-budget-lite` 事项范围与预算

- **说明**：从材料抽出工作范围、关键期限和粗预算；不挡建档。
- **主推于**：`matter.intake`。

**「不挡建档」**这条很实际：预算没算清不该阻止把案子建起来。

## 20.6 合规与专项（4 份）

### `data-compliance-route` 数据合规备忘

- **说明**：个保法/数据安全法/网安法栏目；新闻不当现行法；缺口标【待核实】。
- **主推于**：`compliance.data`。

**「新闻不当现行法」**是很具体的一条纪律。数据合规领域新闻多、解读多，但新闻不是法律依据。这条技能明确要求区分。

### `ads-compliance-route` 广告与产品合规

- **说明**：广告用语和标签核对；绝对化用语标出；给出可替换措辞。
- **主推于**：`compliance.ads`。

**「给出可替换措辞」**是实用要求：光说「『最』字违规」没用，得给出能用的替代说法。

### `norm-validity` 规范现行有效

- **说明**：引用前核是否现行有效；写明效力层级；废止法不得当有效依据。
- **主推于**：`compliance.data`、`compliance.ads`、`corp.governance`（作为第二技能）。

**这条是最基础的引用纪律**：法的效力层级（法律 > 行政法规 > 部门规章 > 地方性法规）和时效（是否废止、是否被修订）都要核。废止的法不能当有效依据。

### `research-query-matrix` 检索命题矩阵

- **说明**：先命题再检索；每争点正反各一；现行法条与正反类案写入备忘正文。
- **工具**：`search_case_law`。
- **主推于**：`research.memo`。

**「正反各一」**是关键。只检索支持自己观点的案例，是律师最容易犯的方法论错误。强制正反两路检索，能把「对方会怎么说」提前暴露出来。

## 20.7 材料与表格（5 份）

### `matter-from-materials` 从材料建事项

- **说明**：扫描已给材料，抽出当事人案由并归位；对话写穿卷宗与期限。
- **工具**：一长串（`explore_folder`、`read_folder_documents`、`import_host_file`、`update_matter_profile`、`extract_legal_events`、`apply_legal_events`、`compile_intake_brief`、`apply_intake_brief`、`add_case_note`）。
- **版本**：4（迭代最多的一份之一）。
- **主推于**：`matter.intake`。

**这份技能的工具声明最多**，说明它是一条完整的流水线：探查目录 → 批量读 → 收进本案 → 更新卷宗 → 抽事件 → 落期限 → 整理摘要 → 写笔记。

### `legal-event-extract` 法律事件抽取

- **说明**：从传票、法院短信、举证通知抽出开庭和期限，对话写穿工作台；工作台手工仍确认。
- **工具**：`calculate`、`extract_legal_events`、`apply_legal_events`、`update_matter_profile`。
- **主推于**：`ops.court_sms`。
- **注意**：这份技能在 `builtin/` 里但**不在种子清单里**（第 11 章讲的漂移）。

### `court-sms-intake` 法院短信识别

- **说明**：从法院/12368 短信抽出案号、开庭时间和待办，对话写入期限与卷宗。
- **工具**：同上四个。
- **主推于**：`ops.court_sms`。

它和 `legal-event-extract` 是一对：一个偏「短信」场景，一个偏「通用事件抽取」。两份都主推给同一个能力。

### `invoice-organizer` 发票整理

- **说明**：把发票或费用表归类并列出可入卷清单；数字带来源，不口算。
- **工具**：`calculate`、`analyze_spreadsheet`。
- **主推于**：`ops.invoice`。

### `spreadsheet-analysis` 表格分析

- **说明**：先分析表格，再计算/出图/落表；数字必须带来源列。
- **工具**：`analyze_spreadsheet`、`write_spreadsheet`、`render_chart`、`calculate`、`run_compute`。
- **版本**：3。
- **主推于**：不默认注入（索引里）。

**「数字必须带来源列」**：表格里出现的每个数字都要能指回原始数据的列或文件。这条防止「算出来的数不知道从哪来的」。

## 20.8 办案管理（3 份）

### `matter-status-report` 办案周报

- **说明**：进度不是活动；范围/RAID/置信；本地顾问/人力/沟通/签发清单/协作建议走同一办件。
- **版本**：4。
- **主推于**：`matter.status`。

**「进度不是活动」**是这份技能的核心判断。周报最容易写成「这周开了三次会、读了两份材料」这种活动流水账，而律师和客户要的是「现在到哪一步了、下一步是什么、有什么风险」。

### `matter-status-scope-budget` 办案状态：范围变更与预算

- **说明**：在周报骨架上补范围变更登记与预算/工时对照；范围变更必须挂到具体委托事项，不替代周报。
- **来源**：消化自外部的三份之一。
- **主推于**：不默认注入（索引里）。

**「范围变更必须挂到具体委托事项」**：范围蔓延是律师费争议的主要来源。记录变更时必须写清「原来是什么、现在要加什么」，而不是笼统说「工作量增加了」。

### `intake-required-inputs` 交办 Intake（Soft Ask）

- **说明**：材料齐备时不冻写；高风险空跑才硬澄清；Required Inputs 原则。
- **主推于**：不默认注入（索引里，但系统会在高风险空跑时注入）。

**这份技能定义了 clarify 的度**。「材料齐备时不冻写」意味着**不许没事找事问律师**；「高风险空跑才硬澄清」意味着**明显要动手但缺输入时才问**。这条界线（第 1 章讲的引导原则）就是靠这份技能的表达来落地的。

## 20.9 起草与交付通用（4 份）

### `legal-element-extraction` 法律要素提取

- **说明**：生活叙事先变成要件事实再分析；评价性用语还原为客观事实。
- **主推于**：多个能力的第二技能（`letter.draft`、`materials.draft`、`analysis.quick`、`litigation.talk`、`ip.dispute`、`deal.ma`、`family.matter`）。

**「评价性用语还原为客观事实」**是一条很实用的纪律。客户说的「他太不要脸了」「这明显是骗人」要还原成「未按约定期限付款 30 天」这种可举证的事实表述。

它是**被复用最广的一份技能**——七个能力把它列为第二主阶段技能。原因是：不管办什么案子，第一步都是把生活语言变成法律语言。

### `citation-grounding` 引用锚定

- **说明**：能检索则先检索再断言；路径已钉选时勿翻案卷找附件；勿编条号。
- **版本**：2。
- **主推于**：`research.memo`、`mail.contract`。

**「路径已钉选时勿翻案卷找附件」**是一条效率约束：附件路径已经在指令里了，别再花检索时间去案卷里找同一份东西。这条直接对应邮件短路径和 Word 改稿那两条钉住的路径。

### `delivery-language` 交付用语

- **说明**：待审核稿不得写成可对外签发；对内底稿可留策略，对外删除。
- **主推于**：`letter.draft`、`materials.draft`。

**这条是「内稿/外稿」的语言纪律**：待审的稿子如果在措辞上像已经生效的法律意见，容易误发。对内底稿可以写「我们的底线是 X」，对外必须删掉。

### `practice-defaults` 开箱默认执业口径

- **说明**：无自定义也能审完；工作区可改口径，只影响之后任务；默认不挡干活。
- **主推于**：`contract.draft`。

**「无自定义也能审完」**是开箱可用性的保障。`playbooks/` 下的自定义口径可以覆盖它，但**没配的时候不能卡住**。

## 20.10 客户与谈判（1 份）

### `quick-legal-triage` 法律快问

- **说明**：一句话法律问题直接答；要素提取后给结论、依据、缺口；不要改成表单。
- **主推于**：`analysis.quick`。

**「不要改成表单」**针对的是一种常见退化：律师就问一句「这样违法吗」，系统却弹出一堆「请补充以下信息」的字段。快问就该快答，缺的地方在答案里标出来。

## 20.11 一份技能的完整生命周期

把前面这些串起来看，一份技能在系统里的路径是：

```text
① 写在 src/lawmind/skills/builtin/<id>.md（带 frontmatter）
② 启动时经 ensureBuiltinSkillSeeds 播种到 <工作区>/lawmind/skills/<id>/
   （带 HMAC 签名 SKILL.sig）
③ 只有 enabled && signatureOk 才会被读到
④ 如果它被列在 PRIMARY_BY_CAPABILITY 里 → 绑定对应能力时注入正文（最多 2 份）
   否则 → 只出现在技能索引里
⑤ 模型需要时用 read_skill 按需取（单份上限 12000 字）
⑥ 同一会话里重复用到时，read_skill 可以反复调（幂等只读工具）
```

**第 ③ 步是最容易出问题的一步**（签名失败是静默的），**第 ④ 步是最影响效果的一步**（决定模型默认看到什么）。

## 20.12 按能力反查技能

如果你想知道「某个能力会看到哪两份技能」，这张表就是第 11 章那张映射表的反查：

| 能力                  | 主阶段技能                                         |
| --------------------- | -------------------------------------------------- |
| `contract.review`     | `contract-review-layers`、`contract-redline-craft` |
| `contract.draft`      | `contract-drafting-route`、`practice-defaults`     |
| `mail.contract`       | `contract-review-layers`、`citation-grounding`     |
| `letter.draft`        | `delivery-language`、`legal-element-extraction`    |
| `research.memo`       | `research-query-matrix`、`citation-grounding`      |
| `materials.draft`     | `delivery-language`、`legal-element-extraction`    |
| `analysis.quick`      | `quick-legal-triage`、`legal-element-extraction`   |
| `labor.calc`          | `labor-compensation-calc`                          |
| `period.calc`         | `legal-period-calc`                                |
| `chronology.timeline` | `chronology-from-materials`                        |
| `matter.intake`       | `matter-from-materials`、`matter-budget-lite`      |
| `ops.invoice`         | `invoice-organizer`                                |
| `ops.court_sms`       | `court-sms-intake`、`legal-event-extract`          |
| `litigation.talk`     | `client-talk-intake`、`legal-element-extraction`   |
| `ip.dispute`          | `ip-dispute-route`、`evidence-argument-chain`      |
| `deal.ma`             | `ma-diligence-route`、`legal-element-extraction`   |
| `compliance.data`     | `data-compliance-route`、`norm-validity`           |
| `compliance.ads`      | `ads-compliance-route`、`norm-validity`            |
| `matter.status`       | `matter-status-report`                             |
| `family.matter`       | `family-matter-route`、`legal-element-extraction`  |
| `capital.markets`     | `capital-markets-route`、`citation-grounding`      |
| `corp.governance`     | `governance-route`、`norm-validity`                |
| `litigation.draft`    | 按细分场景（见第 11 章）                           |

## 20.13 哪些技能没被主推

有几份技能**不在任何能力的 `PRIMARY_BY_CAPABILITY` 里**，也就是说它们永远只在索引里：

`contract-playbook-review`、`chronology-two-stage`、`matter-status-scope-budget`、`spreadsheet-analysis`、`intake-required-inputs`（除了高风险空跑时）。

这不是疏忽。这几份是**消化来的深度能力**（三份消化技能都在其中），它们的定位是「需要时按需读」而不是「每次都注入」——因为正文长，全注入会挤占上下文。

这也意味着一个使用技巧：**如果你希望某份技能每次都被看到，需要把它加进 `PRIMARY_BY_CAPABILITY`**，而不是指望它自己生效。

## 20.14 已知坑（本章相关）

- **技能存在 ≠ 技能生效。** 没被主推就得靠 `read_skill`，而且 `read_skill` 要模型自己想到去调。
- **`contract-redline-craft` 的正文来自代码常量。** 改 `builtin/contract-redline-craft.md` 不会生效。
- **`client-talk-intake` 和 `legal-event-extract` 不在种子清单里。** 它们不会出现在工作区。
- **`legal-element-extraction` 是最被复用的技能**（七个能力把它列为第二技能）。改它影响面很大。
- **改 `builtin/*.md` 会改变下一轮模型行为。** 这些 md 是运行时说明书，不是文档。
