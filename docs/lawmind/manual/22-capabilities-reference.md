# 第 22 章 能力（办件）详解

第 11 章列过 23 个能力的清单。这一章逐个说清楚：**它对应什么活、走哪条管线、默认交什么、界面上的入口叫什麼。**

## 22.1 三个字段各管什么

每个能力（`LawyerCapability`）有三个字段决定它的行为：

| 字段              | 作用                                                                             |
| ----------------- | -------------------------------------------------------------------------------- |
| `skillIds`        | 这个能力对应哪些技能（决定注入哪几份正文）                                       |
| `pipeline`        | 走哪条执行管线（`execute_workflow` / `research_then_draft` / `tracked_redline`） |
| `deliverableType` | 默认交付物类型（决定验收按哪套规格）                                             |

另外每个能力还有界面用的三个字段：`label`（中文名）、`hint`（一句话说明）、`action`（界面动作类型）。

`action` 有五种：

| action            | 含义                     |
| ----------------- | ------------------------ |
| `lock`            | 锁进办件（走通用办件流） |
| `contract-lane`   | 走合同快车道             |
| `research-lane`   | 走研究快车道             |
| `mail-lane`       | 走邮件快车道             |
| `write-materials` | 写材料                   |

## 22.2 五个能力的管线是特殊的

大部分能力走 `execute_workflow`（确定性办案管线）。**五个例外**（`lawyer-capabilities.ts` 里的 `pipeline` 字段）：

| 能力              | 管线                  | 为什么特殊                   |
| ----------------- | --------------------- | ---------------------------- |
| `research.memo`   | `research_then_draft` | 要先出大纲、人确认，再写正文 |
| `analysis.quick`  | `research_then_draft` | 快问也要先检索再答           |
| `compliance.data` | `research_then_draft` | 合规结论必须挂在规范层级上   |
| `compliance.ads`  | `research_then_draft` | 同上                         |
| `mail.contract`   | `tracked_redline`     | 唯一有原 Word 基线可用的路径 |

按第 11 章那张表的完整映射：`research_then_draft` 是 `research.memo`、`analysis.quick`、`compliance.data`、`compliance.ads` 四个；`tracked_redline` 只有 `mail.contract`；其余全部 `execute_workflow`。

**但「能力表里只有 `mail.contract`」不等于「只有它走修订轨」**：Word 改稿回合（钉选了 Word 文件且要改）会在编译时对**任意**能力下发 `pipelineOverride: "tracked_redline"`，同时换上修订技能集（`compile-intent.ts:570`、`lawyer-capabilities.ts:374`）。所以合同审查、律师函这些能力在「改这份 Word」场景下也会走修订轨——**这条路不用改能力表**。

## 22.3 合同与交易（4 个）

### `contract.review` 合同审查

- **界面说明**：按已附合同走审查流水线。
- **技能**：`contract-review-layers`、`contract-redline-craft`。
- **交付物**：`contract.review`。
- **入口**：合同快车道（`contract-lane`）。

**这是最复杂的能力**：它同时产出「审查意见」和「修订轨」两样东西。意见是主交付物，修订轨是附加。如果律师说「只出意见」，交付意图里会去掉「必须红线才算完成」的默认（第 4 章的 P4 交件约束）。

### `contract.draft` 合同起草

- **界面说明**：按交易类型出条款骨架和完整稿。
- **技能**：`contract-drafting-route`、`practice-defaults`。
- **交付物**：`contract.general`。

它和 `contract.review` 的区别是「从零起草」vs「改已有的」。第 4 章的意图编译里明确要求：「已有合同要改时用合同审查」。

### `mail.contract` 邮件合同审阅

- **界面说明**：邮箱来件走同一套审查门禁。
- **技能**：`contract-review-layers`、`citation-grounding`。
- **管线**：`tracked_redline`（唯一）。
- **交付物**：`contract.review`。
- **入口**：邮件快车道（`mail-lane`）。

它和 `contract.review` **走同一套审查门禁**（这是说明里「走同一套」的意思），但多了两条约束：附件路径已在指令里（不用翻案卷）、不许直接发信。

### `deal.ma` 并购尽调

- **界面说明**：股权/资产尽调提纲和交割清单。
- **技能**：`ma-diligence-route`、`legal-element-extraction`。
- **交付物**：`report.general`。

## 22.4 诉讼与争议（3 个）

### `litigation.draft` 诉讼文书

- **界面说明**：按已附案情起草诉讼材料。
- **技能**：**不固定**——按细分场景分（见第 11 章那张表）。
- **交付物**：`litigation.outline`。

这是唯一一个「技能按内容再分」的能力。同样是诉讼文书，离婚案、刑事案、破产案、知产案的注意事项完全不同，靠一份通用技能覆盖不了。

### `litigation.talk` 谈话整理

- **界面说明**：谈话记录整理成需求、案由和证据缺口。
- **技能**：`client-talk-intake`、`legal-element-extraction`。
- **交付物**：`memo.internal`。

**注意它的交付物是内部备忘**，不是对外文书。谈话整理的产物是给自己看的。

### `ip.dispute` 知产争议

- **界面说明**：权利基础、被控侵权和程序路径。
- **技能**：`ip-dispute-route`、`evidence-argument-chain`。
- **交付物**：`litigation.outline`。

## 22.5 检索与研究（2 个）

### `research.memo` 检索研究

- **界面说明**：按已附问题检索并出备忘。
- **技能**：`research-query-matrix`、`citation-grounding`。
- **管线**：`research_then_draft`。
- **交付物**：`memo.research`。
- **入口**：研究快车道（`research-lane`）。

**它的交付物要求六节**（事项、命题矩阵、现行法条、正向类案、反向类案、结论），是要求章节最多的类型之一。

### `analysis.quick` 法律快问

- **界面说明**：一句话问题直接给结论和依据。
- **技能**：`quick-legal-triage`、`legal-element-extraction`。
- **管线**：`research_then_draft`。
- **交付物**：`memo.internal`。

**注意它也走 `research_then_draft`**——也就是说快问也要先检索。这是为了防「凭记忆答法条」。

## 22.6 材料与时间（3 个）

### `matter.intake` 整理案卷

- **界面说明**：把已附材料归位并抽出当事人案由。
- **技能**：`matter-from-materials`、`matter-budget-lite`。
- **交付物**：`document.general`。

### `chronology.timeline` 时间轴

- **界面说明**：从材料抽出日期事件并去重。
- **技能**：`chronology-from-materials`。
- **交付物**：`matter.timeline`。

**注意它和 `chronology-two-stage` 是两件事**：这条能力走的是「抽日期」，而 `chronology-two-stage`（预览→确认→成图）那份技能只在索引里，需要时按需读。

### `ops.invoice` 整理发票

- **界面说明**：发票归类、合计入卷。
- **技能**：`invoice-organizer`。
- **交付物**：`document.general`。

## 22.7 期限与事件（2 个）

### `period.calc` 期限计算

- **界面说明**：上诉、答辩、仲裁、执行期间按规则算届满日。
- **技能**：`legal-period-calc`。
- **交付物**：`period.calc`。

### `ops.court_sms` 法院短信

- **界面说明**：抽出案号、开庭时间和待办。
- **技能**：`court-sms-intake`、`legal-event-extract`。
- **交付物**：`matter.timeline`。

## 22.8 合规（2 个）

### `compliance.data` 数据合规

- **界面说明**：个保法/数安法栏目，缺的标待核实。
- **技能**：`data-compliance-route`、`norm-validity`。
- **管线**：`research_then_draft`。
- **交付物**：`report.compliance`。

**它配的交付物要求五节 blocker**（问题陈述、简要结论、管辖区效力矩阵、风险域发现、来源附录）。**注意它不过推理门**——`report.compliance` 没有 `reasoningGate`，别被「合规」二字误导。

### `compliance.ads` 广告产品合规

- **界面说明**：广告用语和标签核对，给出可替换措辞。
- **技能**：`ads-compliance-route`、`norm-validity`。
- **管线**：`research_then_draft`。
- **交付物**：`report.general`。

## 22.9 函件与材料（2 个）

### `letter.draft` 函件起草

- **界面说明**：按已附事实起草函件。
- **技能**：`delivery-language`、`legal-element-extraction`。
- **交付物**：`letter.counsel`。

**交付物风险是 high**，而且要求过推理门。

### `materials.draft` 写材料

- **界面说明**：意见书 / 备忘等，可填表锁结构。
- **技能**：`delivery-language`、`legal-element-extraction`。
- **交付物**：`document.general`。
- **入口**：写材料（`write-materials`）。

它是「不确定属于哪类」时的通用入口。

## 22.10 其他专项（5 个）

### `family.matter` 家事继承

- **界面说明**：离婚、抚养、继承按家事程序写。
- **技能**：`family-matter-route`、`legal-element-extraction`。
- **交付物**：`litigation.outline`。

### `labor.calc` 劳动计算

- **界面说明**：经济补偿、加班、双倍工资按公式算。
- **技能**：`labor-compensation-calc`。
- **交付物**：`labor.calc`。

### `capital.markets` 资本市场

- **界面说明**：发行和信息披露核对，不编未披露数字。
- **技能**：`capital-markets-route`、`citation-grounding`。
- **交付物**：`report.general`。

### `corp.governance` 公司治理

- **界面说明**：决议和治理备忘，不走章程 Word 改稿。
- **技能**：`governance-route`、`norm-validity`。
- **交付物**：`memo.internal`。

「不走章程 Word 改稿」这条边界很具体：审公司章程和写治理决议是两回事。

### `matter.status` 办案周报

- **界面说明**：阶段、期限、范围；本地顾问和人力也走这里。
- **技能**：`matter-status-report`。
- **交付物**：`memo.internal`。

## 22.11 一个能力被绑定时发生了什么

这是第 3、4 章内容的汇总，这里按能力的视角再走一遍：

1. **判定**：意图编译给出能力 id（含 `$skill` 覆盖和办件锁）。
2. **水合**：`hydrateCompiledIntent` 把能力变成 `BoundLawyerCapability`，补上默认交付物类型。
3. **技能**：`planLeanSkillPrompt` 挑出最多 2 份主阶段技能，其余列索引。
4. **提示块**：`formatBoundCapabilityBlock` 生成一段，包含「本轮 LawMind 能力：<名称>」「能力 ID」「交付物类型」「流程提示」和技能正文。
5. **工具表**：能力的 `pipeline` 会影响流程提示，但**不再冻结工具表**（第 5 章）。
6. **管线提示**：`resolveCapabilityPipelineHint` 按管线给不同的行动建议——`tracked_redline` 给修订流程，意见书类给意见书流程，其余给通用提示。

第 4 步那段提示块里有一句话：

```text
工具按任务选用，不是只能走一条管线。
```

这是第 1 章引导原则的直接体现：**告知流程，但不锁死工具。**

## 22.12 能力的边界在哪

能力**不是**权限。它不决定：

- 能用哪些工具（那是工具表 + 权限模式决定的）。
- 能改哪些文件（那是可写根和治理路径决定的）。
- 要不要审批（那是审批门决定的）。

能力只决定三件事：**注入哪几份技能正文、给什么流程提示、默认按哪套验收规格检查。**

理解这一点很重要，否则会误以为「切了能力就切了权限」。

## 22.13 已知坑（本章相关）

- **`litigation.draft` 的技能是按内容分的。** 想让它用某份技能，得让指令里有对应的场景信号（比如「离婚」「侦查阶段」）。
- **`mail.contract` 是能力表里唯一写死 `tracked_redline` 的**，但 Word 改稿回合会用 `pipelineOverride` 给任意能力临时套上修订轨（见 22.2 末）。所以「想给别的能力加修订轨」通常**不需要**改 `LAWYER_CAPABILITIES`——先想清楚是要「常态走修订轨」还是「这次改了 Word」。
- **能力不冻结工具表。** 你在某个能力下看到别的能力的工具是正常的。
- **`analysis.quick` 也走 `research_then_draft`。** 快问不是「不检索只凭记忆」。
- **`matter.status` 的交付物是内部备忘。** 它不是对外报告。
- **能力与技能的对应关系改动会影响模型的默认视野。** 改 `PRIMARY_BY_CAPABILITY` 比改能力本身影响更直接。
