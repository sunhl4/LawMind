# 第 11 章 技能库

这一章讲 LawMind 的「技能」——它是什么、有多少、怎么被模型看到、怎么保证不被篡改，以及那套「从外面学东西」的流程。

> 逐文件的实现精读在**第 70.10–70.15 节**：签名密钥的三种来源（以及为什么 `derived` 那个兜底值「不是秘密」）、注入预算的 22 条主技能映射、播种的四条升级规则、那个「三处不能漂移」的共享正则表、技能匹配的三个权重。

## 11.1 技能是什么

一个技能就是一份 Markdown 文件，里面写着「做这类活的时候要注意什么」。它不是代码，是**给模型看的作业指导书**。

举两个真实例子感受一下：

- `contract-review-layers`（合同分层审查）告诉模型：宏观看交易结构、中观看文本形式、微观看具体条款；风险要带推荐措辞；事实缺失也要把已完成的部分写完。
- `labor-compensation-calc`（劳动补偿计算）告诉模型：N/N+1/2N、加班费、双倍工资按规则算并**写出公式**；必须调用 `calculate`，口算不算完成。

技能的定位有个说法很准确：**技能是教练，不是枷锁。** 源码注释原话：

> Skills coach quality; they do not freeze the tool table into a single pipeline.

也就是说，技能告诉模型「这件事做好的标准是什么」，但不会把模型锁死在一条固定管线上。本轮有哪些工具可用，是工具表决定的（第 3、5 章）。

## 11.2 有多少技能、几份清单

这里要分清三个概念，否则会被数字绕晕：

| 是什么                           | 数量     | 位置                                                                      |
| -------------------------------- | -------- | ------------------------------------------------------------------------- |
| **内置技能的正文文件**           | 37 份    | `src/lawmind/skills/builtin/*.md`                                         |
| **会被种子清单写进工作区的技能** | 35 个 id | `src/lawmind/skills/ensure-builtin-skill-seeds.ts` 的 `BUILTIN_IDS`       |
| **产品化能力（办件）**           | 23 个 id | `src/lawmind/skills/lawyer-capability-lock.ts` 的 `LAWYER_CAPABILITY_IDS` |

三个数字不一样，而且**第一个比第二个多两个**。我核对过：内置目录有 37 个 `.md`，种子清单里列了 35 个 id，缺的两个是 `client-talk-intake`（谈话整理）和 `legal-event-extract`（法律事件抽取）。

后果是：这两份技能正文写在仓库里，但**启动时不会被写进工作区**，所以 `listLocalSkills` 看不到它们（除非别的地方写了）。这是一个真实的漂移，测试里也没有断言这两份清单一致。我在 11.10 的已知坑里会再提一次。

**但功能上它们是正常的**：读取内置正文的那个函数（`readBuiltinSkillMarkdown`）从**仓库目录**读，不是从工作区读，而这两份技能被 `litigation.talk` 与 `ops.court_sms` 两个能力引用着，所以正文照样会被注入。**受影响的只是「改不了、设置页看不见」**（没有工作区副本）。实现细节与两条读取路径的差别见第 70 章。

## 11.3 模型的两种技能来源

技能可以来自两个地方：

**第一：内置技能。** 随包分发。首次启动时（或打开设置页时）由 `ensureBuiltinSkillSeeds` 写进工作区：

```text
<工作区>/lawmind/skills/<skill-id>/SKILL.md
<工作区>/lawmind/skills/<skill-id>/SKILL.sig
```

幂等，写过了会跳过。升级的判定条件挺细：已存在的文件必须**还带着** `source: lawmind-builtin` 标记、正文有变化或签名缺失、而且**新版本号 ≥ 旧版本号**。第三条是为了防止降级覆盖——你自己的改动不会被旧内置版冲掉。

开关记录在 `<工作区>/lawmind/skills/enabled.json`。

**第二：本地技能。** 你自己放在 `<工作区>/lawmind/skills/<id>/SKILL.md`，符合格式就会被发现。

## 11.4 技能文件的格式

文件是「YAML 前置信息 + 正文」：

```text
---
id: contract-review-layers
name: 合同分层审查
version: "2"
description: 宏观交易结构、中观文本形式、微观条款；风险带推荐措辞；缺事实仍出已完成部分
source: lawmind-builtin
tags: contract, review, quality
workflows: contract-review
---

（正文：给模型的作业指导）
```

解析用的正则（`skill-runtime.ts`）容忍换行风格差异：

```text
/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/
```

几个字段的规则：

- `id` 缺失时用目录名兜底。
- `version` 缺失默认 `"0"`。
- `tags` 按逗号或中文逗号切。
- `workflows` 和 `tools` 是可选字段，用来声明「这个技能对应哪些工作流」「它建议用哪些工具」。

解析出来的结构（`SkillMeta`）带着几个状态字段：`enabled`、`dir`、`signatureOk`、`signatureError`。

## 11.5 签名：技能正文是能改模型行为的东西

这里有个容易被忽视的风险：技能正文会作为**指令**进入模型上下文。谁能改技能正文，谁就能改模型的行为。

所以有一套 HMAC 签名机制（`docs/lawmind/LAWMIND-SKILLS-SIGNING.md`）：

```text
SKILL.sig = HMAC-SHA256(SKILL.md 正文, 签名密钥)
```

唯一的校验点是 `verifySkillSignature`，两种失败：`missing_signature`（没签名文件）和 `signature_mismatch`（对不上）。

**只有同时满足「已启用」和「签名通过」的技能才会被读到。** 这一点在四个消费点都成立：`readSkillPromptBodies`、`matchSkillsForTriage`、`collectEnabledSkillToolNames`、`read_skill` 的本地列表。

### 密钥三种来源

| 来源      | 位置                                               | 评价                     |
| --------- | -------------------------------------------------- | ------------------------ |
| `env`     | `LAWMIND_SKILL_SIGNING_SECRET`                     | 推荐，密钥在工作区之外   |
| `file`    | `<工作区>/lawmind/skills/.signing-secret`          | 可用                     |
| `derived` | `sha256("lawmind-skill:" + 工作区路径)` 前 32 字符 | **不是密钥，不是信任根** |

第三种是兜底：它只是让签名机制「有东西可算」，不提供任何防篡改能力——因为攻击者知道工作区路径就能算出同一个值。文档里明说了「derived is not a trust anchor」，签名 CLI 在没有 `--allow-derived` 的情况下会**拒绝**用 derived 密钥签名。

### 一个硬约束：顺序不能改

文档里有一段标着「硬约束，别改回去」的顺序要求：

```text
bootstrapLawMindDesktopEnv(...)      ← 先把 .env.lawmind 灌进 process.env
  ↓
resolveSkillSigningSecretSource(...) ← 此刻解析出的才是真密钥
  ↓
ensureBuiltinSkillSeeds(dir, { secret })  ← 显式传入，别让它自己猜
```

为什么？因为如果先解析密钥再加载环境变量，解析到的是错的值，结果是**所有内置技能签名都失效**，而失效是静默的（技能变成 `enabled: false`，不报错）。

代码里的防呆：密钥由调用方**显式传入**（`opts.secret`），不依赖「函数自己读到的环境恰好对」。另外缺密钥时会打一行启动警告，让「静默失效」至少变得可见。

## 11.6 一次回合里技能怎么进上下文

这是本章最该理解的一段。

一个回合里，技能正文有两个入口：

**入口一：绑定能力时注入。** 如果这一轮绑定到了某个能力（第 4 章讲的意图编译结果），系统会挑出这个能力的主阶段技能，注入正文。

但**最多只注 2 份**（`skill-prompt-budget.ts` 里 `.slice(0, 2)`），其余只给索引。这个规则写在文件头部：

> Lean skill injection: dump up to 2 primary stage bodies, index the rest.

为什么限 2 份？因为技能正文很长（有的几千字），全塞进去会把上下文预算吃光，而且模型也读不完。给 2 份「这次最该看的」，剩下的列成索引。

索引块的标题是「## 其余技能（索引，不要通读）」，末尾一句「需要某份时调用 `read_skill`。」——明确告诉模型：别通读索引，需要就单个取。

**入口二：`read_skill` 工具按需取。** 头部注释：

> Codex-style on-demand Skill load. Bound turns inject 1–2 bodies; the rest stay as an index until the model calls this tool.

单次正文上限 12000 字（`MAX_BODY_CHARS`），超了截断并标记 `truncated`。`read_skill` **每一轮都广告**（不需要 `list_more_tools` 打开），而且它在幂等只读工具清单里，所以可以放心重复调用。

不传 `skill_id` 时，它返回目录：能力清单（最多 40 条）+ 本机已启用技能 + 规范库索引。

### 每个能力主推哪几份技能

这张映射表（`PRIMARY_BY_CAPABILITY`）决定了模型默认看到什么，影响很大。挑几个列一下：

| 能力               | 主阶段技能                                         |
| ------------------ | -------------------------------------------------- |
| `contract.review`  | `contract-review-layers`、`contract-redline-craft` |
| `contract.draft`   | `contract-drafting-route`、`practice-defaults`     |
| `mail.contract`    | `contract-review-layers`、`citation-grounding`     |
| `research.memo`    | `research-query-matrix`、`citation-grounding`      |
| `analysis.quick`   | `quick-legal-triage`、`legal-element-extraction`   |
| `labor.calc`       | `labor-compensation-calc`                          |
| `period.calc`      | `legal-period-calc`                                |
| `compliance.data`  | `data-compliance-route`、`norm-validity`           |
| `litigation.draft` | 见下（按细分场景分）                               |

`litigation.draft` 是特例，它按指令内容再细分：

| 指令里出现                       | 主推技能                                             |
| -------------------------------- | ---------------------------------------------------- |
| 离婚 / 抚养                      | `family-matter-route`、`legal-element-extraction`    |
| 侦查阶段 / 审查起诉              | `criminal-stage-route`、`evidence-argument-chain`    |
| 债权申报 / 破产重整              | `bankruptcy-stage-route`、`legal-period-calc`        |
| 知产争议 / 专利侵权              | `ip-dispute-route`、`evidence-argument-chain`        |
| 起诉状 / `litigation.complaint`  | `complaint-elements-fill`、`evidence-argument-chain` |
| 上诉状 / 执行异议 / 立案材料清单 | `litigation-stage-route`、`evidence-argument-chain`  |
| 其他                             | `litigation-stage-route`、`complaint-elements-fill`  |

这个细分很实用：同样是「诉讼文书」，离婚案和刑事案的注意事项完全不同，靠一份通用技能覆盖不了。

还有一个小细节：`contract-redline-craft` 这份技能在读的时候**总会被替换**成代码里的常量版本（`CONTRACT_REDLINE_CRAFT_SKILL`），不读文件。原因应该是这份技能的正文跟引擎实现（最短改动的具体门槛）强绑定，从代码里取能保证不漂。

## 11.7 23 个产品化能力

这些是「律师日常高频事项」的产品化封装，每个 = 技能 + 验收。完整清单（id / 名称 / 说明）：

| id                    | 名称         | 说明                                     |
| --------------------- | ------------ | ---------------------------------------- |
| `contract.review`     | 合同审查     | 按已附合同走审查流水线                   |
| `letter.draft`        | 函件起草     | 按已附事实起草函件                       |
| `research.memo`       | 检索研究     | 按已附问题检索并出备忘                   |
| `litigation.draft`    | 诉讼文书     | 按已附案情起草诉讼材料                   |
| `litigation.talk`     | 谈话整理     | 谈话记录整理成需求、案由和证据缺口       |
| `materials.draft`     | 写材料       | 意见书 / 备忘等，可填表锁结构            |
| `mail.contract`       | 邮件合同审阅 | 邮箱来件走同一套审查门禁                 |
| `analysis.quick`      | 法律快问     | 一句话问题直接给结论和依据               |
| `contract.draft`      | 合同起草     | 按交易类型出条款骨架和完整稿             |
| `labor.calc`          | 劳动计算     | 经济补偿、加班、双倍工资按公式算         |
| `chronology.timeline` | 时间轴       | 从材料抽出日期事件并去重                 |
| `matter.intake`       | 整理案卷     | 把已附材料归位并抽出当事人案由           |
| `period.calc`         | 期限计算     | 上诉、答辩、仲裁、执行期间按规则算届满日 |
| `ops.invoice`         | 整理发票     | 发票归类、合计入卷                       |
| `ops.court_sms`       | 法院短信     | 抽出案号、开庭时间和待办                 |
| `ip.dispute`          | 知产争议     | 权利基础、被控侵权和程序路径             |
| `deal.ma`             | 并购尽调     | 股权/资产尽调提纲和交割清单              |
| `compliance.data`     | 数据合规     | 个保法/数安法栏目，缺的标待核实          |
| `compliance.ads`      | 广告产品合规 | 广告用语和标签核对，给出可替换措辞       |
| `matter.status`       | 办案周报     | 阶段、期限、范围；本地顾问和人力也走这里 |
| `family.matter`       | 家事继承     | 离婚、抚养、继承按家事程序写             |
| `capital.markets`     | 资本市场     | 发行和信息披露核对，不编未披露数字       |
| `corp.governance`     | 公司治理     | 决议和治理备忘，不走章程 Word 改稿       |

每个能力还带一个 `action` 字段，说明它在界面上怎么落地：`lock`（锁进办件）、`contract-lane`（走合同快车道）、`research-lane`（走研究快车道）、`mail-lane`（走邮件快车道）、`write-materials`（写材料）。

### 管线分三类

能力走哪种执行管线也是声明好的：

| 管线                  | 能力                                                                   |
| --------------------- | ---------------------------------------------------------------------- |
| `research_then_draft` | `research.memo`、`analysis.quick`、`compliance.data`、`compliance.ads` |
| `tracked_redline`     | `mail.contract`                                                        |
| `execute_workflow`    | 其余全部                                                               |

`tracked_redline`（修订轨）只给了邮件合同一条，因为只有那条路径有原 Word 基线可用。

## 11.8 37 份内置技能逐条清单

这是全章最有用的一张表。id / 名称 / 版本 / 它管什么：

| id                           | 名称                             | 版本 | 管什么                                                                       |
| ---------------------------- | -------------------------------- | ---- | ---------------------------------------------------------------------------- |
| `ads-compliance-route`       | 广告与产品合规                   | 1    | 广告用语和标签核对；绝对化用语标出；给出可替换措辞                           |
| `bankruptcy-stage-route`     | 破产阶段路由                     | 1    | 按申请受理、债权申报、重整/清算写材料，不混用民事起诉模板                    |
| `capital-markets-route`      | 资本市场文件核对                 | 3    | 发行/信息披露核对清单；数字只用来源页；不是股权融资 Word 改稿                |
| `chronology-from-materials`  | 时间轴整理                       | 1    | 从材料抽日期事件、去重；立场只着色不改时间线                                 |
| `chronology-two-stage`       | 诉讼时间轴（预览 → 确认 → 成图） | 1    | 先出可改的时间轴草案并逐条确认，确认后才出正式件；不把推测日期写成事实       |
| `citation-grounding`         | 引用锚定                         | 2    | 能检索则先检索再断言；路径已钉选时勿翻案卷找附件；勿编条号                   |
| `client-talk-intake`         | 谈话整理                         | 2    | 把客户谈话整理成需求、核心事实、候选案由和证据缺口；对话写穿档案             |
| `complaint-elements-fill`    | 要素式起诉状母版                 | 1    | 按固定栏目填起诉状；线性段落，不用会打烂的表格；缺项标待补充仍出稿           |
| `contract-drafting-route`    | 合同起草路由                     | 2    | 封闭类型路由卡、条款骨架、待补事实写在稿里                                   |
| `contract-playbook-review`   | 合同 Playbook 审查               | 1    | 标准/可接受回退/永不接受三档；己方纸与对方纸分开；偏离必须落到具体条款与改法 |
| `contract-redline-craft`     | 合同审阅改稿手艺                 | 4    | 合同 tracked 改稿：最短锚定硬门禁（字/词级），条数不限                       |
| `contract-review-layers`     | 合同分层审查                     | 2    | 宏观交易结构、中观文本形式、微观条款；风险带推荐措辞                         |
| `court-sms-intake`           | 法院短信识别                     | 2    | 从法院/12368 短信抽出案号、开庭时间和待办，对话写入期限与卷宗                |
| `criminal-stage-route`       | 刑事阶段路由                     | 1    | 按侦查/审查起诉/一审/二审写刑事文书，不套民事起诉状                          |
| `data-compliance-route`      | 数据合规备忘                     | 1    | 个保法/数据安全法/网安法栏目；新闻不当现行法；缺口标【待核实】               |
| `delivery-language`          | 交付用语                         | 2    | 待审核稿不得写成可对外签发；对内底稿可留策略，对外删除                       |
| `evidence-argument-chain`    | 证据论证链                       | 2    | 主张→要件→待证事实→证据→证明力；缺证写待补不停工                             |
| `family-matter-route`        | 家事继承路由                     | 3    | 离婚、抚养、继承按家事程序写；子女利益与财产分栏                             |
| `governance-route`           | 公司治理路由                     | 1    | 决议和治理备忘按公司法程序写；不是章程 Word 改稿                             |
| `intake-required-inputs`     | 交办 Intake（Soft Ask）          | 1    | 材料齐备时不冻写；高风险空跑才硬澄清                                         |
| `invoice-organizer`          | 发票整理                         | 1    | 把发票或费用表归类并列出可入卷清单；数字带来源，不口算                       |
| `ip-dispute-route`           | 知产争议路由                     | 1    | 按专利/商标/著作权/反不正当竞争写知产材料，不套普通民事起诉状                |
| `labor-compensation-calc`    | 劳动补偿计算                     | 2    | N/N+1/2N、加班、双倍工资按规则算并写出公式；必须调 `calculate`               |
| `legal-element-extraction`   | 法律要素提取                     | 1    | 生活叙事先变成要件事实再分析；评价性用语还原为客观事实                       |
| `legal-event-extract`        | 法律事件抽取                     | 2    | 从传票、法院短信、举证通知抽出开庭和期限，对话写穿工作台                     |
| `legal-period-calc`          | 程序期限计算                     | 1    | 上诉、答辩、仲裁申请、再审、执行期间用规则引擎算届满日；不要口算             |
| `litigation-stage-route`     | 诉讼阶段路由                     | 2    | 按材料推断阶段再写文书；上诉、执行、立案清单不套起诉状                       |
| `ma-diligence-route`         | 并购尽调提纲                     | 1    | 股权/资产收购尽调提纲与交割清单；缺口标清，不编未看到的文件                  |
| `matter-budget-lite`         | 事项范围与预算                   | 2    | 从材料抽出工作范围、关键期限和粗预算；不挡建档                               |
| `matter-from-materials`      | 从材料建事项                     | 4    | 扫描已给材料，抽出当事人案由并归位；对话写穿卷宗与期限                       |
| `matter-status-report`       | 办案周报                         | 4    | 进度不是活动；范围/RAID/置信；本地顾问/人力/沟通/签发清单走同一办件          |
| `matter-status-scope-budget` | 办案状态：范围变更与预算         | 1    | 在周报骨架上补范围变更登记与预算/工时对照                                    |
| `norm-validity`              | 规范现行有效                     | 2    | 引用前核是否现行有效；写明效力层级；废止法不得当有效依据                     |
| `practice-defaults`          | 开箱默认执业口径                 | 2    | 无自定义也能审完；工作区可改口径，只影响之后任务；默认不挡干活               |
| `quick-legal-triage`         | 法律快问                         | 1    | 一句话法律问题直接答；要素提取后给结论、依据、缺口；不要改成表单             |
| `research-query-matrix`      | 检索命题矩阵                     | 2    | 先命题再检索；每争点正反各一；现行法条与正反类案写入备忘正文                 |
| `spreadsheet-analysis`       | 表格分析                         | 3    | 先分析表格，再计算/出图/落表；数字必须带来源列                               |

### 三份技能是「外部消化来的」

有三份技能在文档里有消化记录（2026-09-19 那期）：`contract-playbook-review`、`chronology-two-stage`、`matter-status-scope-budget`。

它们不是凭空写的，是从外部开源能力消化来的，各自带着出处、许可和验证方式。这件事的意义在于「先复用，后自研」这条铁律真的落地了。

其中 `contract-playbook-review` 来自 Anthropic 的 playbook 实践（Apache-2.0）。它的三档处理很有用：标准做法、可接受回退、永不接受。

### 有 `tools` 声明的技能

11 份技能在 frontmatter 里声明了 `tools`，相当于「这份技能需要这些工具配合」：`client-talk-intake`、`court-sms-intake`、`data-compliance-route`、`invoice-organizer`、`labor-compensation-calc`、`legal-event-extract`、`legal-period-calc`、`matter-from-materials`、`research-query-matrix`、`ads-compliance-route`、`spreadsheet-analysis`。

比如 `labor-compensation-calc` 声明了 `calculate`，`matter-from-materials` 声明了一长串（`explore_folder`、`read_folder_documents`、`import_host_file`、`update_matter_profile`、`extract_legal_events`、`apply_legal_events`、`compile_intake_brief`、`apply_intake_brief`、`add_case_note`）。

这个声明会让这些工具在对应场景下进入本轮工具表。

## 11.9 规范库索引：只登记、不装包

除了内置技能，还有一份**规范库索引**（`census/canonical-skill-index.ts`），15 条，记录的是外部那些「值得学的」法律技能包的元数据。

注意：**只有元数据，没有第三方正文。**

| id                              | 来源仓库 | 消化方式 |
| ------------------------------- | -------- | -------- |
| `anthropic-commercial-legal-os` | —        | —        |
| `anthropic-review-router`       | —        | —        |
| `panrui-legal-workbench`        | —        | —        |
| `panrui-contract-redline`       | —        | —        |
| `greater-china-contract-os`     | —        | —        |
| `horizon-dispute-cluster`       | —        | —        |
| `lpm-skills`                    | —        | —        |
| `contract-copilot-layers`       | —        | —        |
| `legal-research-cn`             | —        | —        |
| `yuandian-search-middleware`    | —        | —        |
| `pkulaw-docx-workflow`          | —        | —        |
| `civil-litigation-pipeline`     | —        | —        |
| `period-manager`                | —        | —        |
| `second-review-agent`           | —        | —        |
| `merger-acquisition-cn`         | —        | —        |

每条带四个字段：`licenseAbsorb`（`absorb` 直接采用 / `structure_only` 只借鉴结构 / `skip` 不采用）、`mapsToCapabilityId`（对应哪个能力）、`when`（什么时候用）、`notWhen`（什么时候别用）。

`read_skill` 不传参数时会把这份索引列出来（最多 40 条），格式是：

```text
<id>（规范库·<消化方式>·<来源仓库>）— <名称>；不执行、不装包
```

「不执行、不装包」这半句是硬边界：**LawMind 不会下载并运行外部技能包。** 这份索引只是给人看的学习清单。

## 11.10 消化流水线：怎么从外面学东西

这是第 1 章「先复用，后自研」那条铁律的工程实现。

### 扫描

`external-skill-census.ts` 定义了一次可复现的「外部技能普查」：

- **截止日期**：`CENSUS_CUTOFF_ISO = "2026-09-07"`
- **19 组查询**（`CENSUS_QUERIES`），分四个轴：载体（skill-md / claude-plugin / cursor-rules / codex-skill / mcp-server）、中文任务（合同审查 / 诉讼 / 刑事 / 检索 / 中文 MCP）、英文任务（litigation / research / lpm / diligence）、数据源（CourtListener / EUR-Lex / 法宝 / 元典）
- **9 个枢纽仓库**（`CENSUS_HUB_REPOS`）

跑法：

```bash
pnpm lawmind:skills:census          # 离线包（读本地目录，打印 JSON）
pnpm lawmind:skills:census --fetch  # 加 --fetch 用 gh 搜 GitHub 增量
```

`--fetch` 需要 `gh` 可用，没有就打印「gh 不可用，跳过 --fetch。离线包已打印。」不报错。

### 许可分级

扫到仓库之后，按许可决定怎么用（`classifyLicenseAbsorb`）：

| 许可                          | 处理                           |
| ----------------------------- | ------------------------------ |
| MIT / Apache / BSD-2 / BSD-3  | `absorb`（可直接采用）         |
| CC-BY / CC-BY-SA              | `structure_only`（只借鉴结构） |
| CC-BY-NC                      | `structure_only`               |
| AGPL / GPL                    | `skip`（不用）                 |
| 空 / other / none / unlicense | `structure_only`               |
| 其他未识别                    | `structure_only`（保守默认）   |

未声明许可一律 `structure_only`，就是「只写方法借鉴，不搬代码/正文」。

### 记账

消化记录写在 `docs/LAWMIND-CANONICAL-LEGAL-SKILLS.md` 的第八节，两个小节：

- `## 八、消化记录（每期新增一行）`
- `### 待消化（下一期候选）`

规则也写在这一节里：

> 索引 ≠ 消化。任务能力要有 builtin 正文、能力映射、契约测试与出处记录，才算「已消化」。

新发现的仓库先进「待消化」表登记（候选 / 来源 / 许可证 / 为什么排前面），消化完再移进「消化记录」。

### 「已消化」的完整要求

期次模板里把要求列全了（`GOALS.md`）：

```text
本期消化 3 个外部能力：____ / ____ / ____
（要求：builtin 正文 + BUILTIN_SKILL_SEED_IDS 注册 + 能力映射 + 契约测试 +
第八节「消化记录」一行；NC/未声明只写方法借鉴）
```

五件事缺一不可：正文、注册、映射、契约测试、记录。契约测试是 `src/lawmind/evaluation/skill-deliverable-contract.test.ts`，它会验证「这个技能真的能产出对应的交付物类型」。

这就是为什么第 11.2 节那个「37 vs 35」的漂移值得关注——**注册（进 `BUILTIN_SKILL_SEED_IDS`）是「已消化」五项要求之一**，漏了两份说明注册这一步可以被漏掉，而没有任何测试拦。

## 11.11 包清单校验

除了技能签名，还有一层「包清单」机制（`bundle-manifest.ts`）用来校验一批文件的完整性。

清单结构：

```ts
{
  schemaVersion: 1,
  bundleId, version, generatedAt,
  entries: [{ path, sha256, role: "template" | "skill" | "doc" }]
}
```

存放在工作区里，比如 `workspace/lawmind/bundles/my-firm.json`。

校验（`verifyLawMindBundleManifest`）四步：

1. 路径安全：不能为空、不能含 `..`、不能是绝对路径。
2. 不能逃出工作区（解析后必须是工作区内路径）。
3. 文件必须存在且是普通文件。
4. sha256 必须对得上。

四种错误：`unsafe path:`、`escapes workspace:`、`missing file:`、`sha256 mismatch: <路径> (expected <x>, got <y>)`。

**本地信任根，不执行远程市场下载。** 这句话写在文件头部注释里。清单校验只保证「文件没被换过」，不提供任何下载或安装能力。

## 11.12 HTTP 与 CLI

| 端点                  | 方法 | 说明                                                                                                      |
| --------------------- | ---- | --------------------------------------------------------------------------------------------------------- |
| `/api/skills`         | GET  | 列工作区技能（会先幂等跑一次种子），另返回 `cnPack`（若存在 `<工作区>/lawmind/packs/cn-legal-pack.json`） |
| `/api/skills/enabled` | POST | 开/关某个技能（body `{ skillId, enabled }`）                                                              |

设置页的「技能库」分区已经从侧栏退役（现在是深链可达、不在导航里）——因为**开箱技能自动启用，不需要律师在这里开关**。这话就写在退役条目的说明里。

CLI：

| 命令                         | 作用                     | 主要参数                                                                |
| ---------------------------- | ------------------------ | ----------------------------------------------------------------------- |
| `pnpm lawmind:skills:sign`   | 给工作区技能签名         | `--workspace`、`--check`（只校验）、`--allow-derived`（允许用派生密钥） |
| `pnpm lawmind:skills:census` | 外部技能普查             | `--fetch`                                                               |
| `pnpm lawmind:skills:golden` | 黄金样本冒烟（不调模型） | —                                                                       |

`lawmind:skills:sign` 在密钥来源是 `derived` 且没加 `--allow-derived` 时会**拒绝执行**并退出码 1。退出码 1 也用于「有技能校验失败」。

## 11.13 关键文件

| 关注点         | 文件                                                                                               |
| -------------- | -------------------------------------------------------------------------------------------------- |
| 技能发现与签名 | `src/lawmind/skills/skill-runtime.ts`                                                              |
| 种子           | `src/lawmind/skills/ensure-builtin-skill-seeds.ts`                                                 |
| 包清单         | `src/lawmind/skills/bundle-manifest.ts`                                                            |
| 能力定义       | `src/lawmind/skills/lawyer-capabilities.ts`、`lawyer-capability-lock.ts`、`capability-patterns.ts` |
| 技能匹配       | `src/lawmind/skills/skill-match.ts`                                                                |
| 注入预算       | `src/lawmind/skills/skill-prompt-budget.ts`                                                        |
| 内置正文       | `src/lawmind/skills/builtin/*.md`（37 份）                                                         |
| 规范库索引     | `src/lawmind/skills/census/canonical-skill-index.ts`                                               |
| 普查           | `src/lawmind/skills/census/external-skill-census.ts`                                               |
| 按需读取工具   | `src/lawmind/agent/tools/legal/read-skill-tool.ts`                                                 |
| 文档           | `docs/lawmind/LAWMIND-SKILLS-SIGNING.md`、`docs/LAWMIND-CANONICAL-LEGAL-SKILLS.md`                 |
| CLI            | `scripts/lawmind/lawmind-skills-sign.ts`、`lawmind-skill-census.ts`、`lawmind-skills-golden.ts`    |
| 契约测试       | `src/lawmind/evaluation/skill-deliverable-contract.test.ts`                                        |

## 11.14 已知坑

- **内置正文 37 份，种子清单 35 个，差 `client-talk-intake` 和 `legal-event-extract`。** 这两份写了但不会被种进工作区，也没有测试保证两份清单一致。要修就补 id 并加一条一致性断言。
- **签名失败是静默的。** 技能会变成 `enabled: false`，界面上不报错，模型也不再读它。排查「技能好像没生效」，先看签名状态和密钥来源。
- **`derived` 密钥不是安全机制。** 它只是让签名算得出来。生产环境应该用 `LAWMIND_SKILL_SIGNING_SECRET`。
- **初始化顺序不能改。** 先加载环境变量、再解析密钥、再显式传给种子函数。改了会导致内置技能全部静默失效。
- **一次最多注 2 份技能正文。** 想让某个技能成为主推，要改 `PRIMARY_BY_CAPABILITY`，不是把技能写得更长。
- **技能是教练，不是门禁。** 想硬拦某类行为，要用工具表和门禁，别指望技能正文。
- **规范库索引不含正文，也不会装包。** 「不执行、不装包」是硬边界。
- **未声明许可一律只借鉴结构。** 不要把 NC/未声明许可的东西直接写进 builtin 正文。
- **「已消化」要五件事齐全**（正文 + 注册 + 映射 + 契约测试 + 消化记录一行）。少一件就还是「索引」。
- **改 builtin 正文会改变下一轮模型行为。** 这些 md 是运行时说明书，不是文档。改了要跑契约测试。
