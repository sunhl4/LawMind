# 第 22 章 能力（办件）详解

第 11 章列过 23 个能力。这一章讲它们在代码里怎么分成三份名单、一次交办怎么绑上、Word 改稿怎么选主阶段，以及和 Cursor、Codex、Harvey 比，哪些该留、哪些不该锁死。

技能正文怎么写在第 20 章。意图编译的十七步在第 70 章。这里只讲能力这一层。

## 22.1 定位：办件是质量说明，不是权限，也不是流水线

一个能力回答三件事：这一轮注入哪两份技能正文、给模型哪句流程提示、默认按哪套交付物规格验收。

它不回答：能调哪些工具、能改哪些文件、要不要审批。那三件分别在第 3 章的工具表、可写根、审批门。

律师主路径不用从这 23 项里点选。编译器看原话和钉上的文件。点选只在律师要覆盖误绑时出现，写成 `【办件】能力：<id>`。

## 22.2 三份名单，不要合成一张表

以前容易把界面字段和运行时字段看成同一个对象。代码里是三份：

| 名单     | 文件                                                                             | 装什么                                                    | 不装什么                                           |
| -------- | -------------------------------------------------------------------------------- | --------------------------------------------------------- | -------------------------------------------------- |
| 能力目录 | `src/lawmind/skills/lawyer-capabilities.ts` 的 `LAWYER_CAPABILITIES`             | `id`、`label`、`skillIds`、`pipeline`、`pipelineHint`     | 没有 `deliverableType`，没有 `hint`，没有 `action` |
| 办事清单 | `src/lawmind/skills/lawyer-capability-lock.ts` 的 `LAWYER_CAPABILITY_DESK_ITEMS` | 界面 `hint`、`action`、`testId`、`defaultDeliverableType` | 不决定注入哪份正文                                 |
| 主阶段表 | `src/lawmind/skills/skill-prompt-budget.ts` 的 `PRIMARY_BY_CAPABILITY`           | 最多两份要进提示的正文                                    | 诉讼文书不走这张表，走 `litigationPrimary`         |

`skillIds` 是该能力**可以**用的作业标准全集。真正写进系统提示的只有两份。其余变成索引行，模型用 `read_skill` 自取。这是 Cursor / Codex 的技能目录做法：说明先短，正文按需打开。差别是律师不能安装或关掉这些文件（第 11 章）。

`action` 只有五种，描述界面落点，不改变工具表：

| action            | 落点                               |
| ----------------- | ---------------------------------- |
| `lock`            | 写入办件锁，走通用交办             |
| `contract-lane`   | 合同快车道。只有 `contract.review` |
| `research-lane`   | 研究快车道。只有 `research.memo`   |
| `mail-lane`       | 邮件快车道。只有 `mail.contract`   |
| `write-materials` | 写材料。只有 `materials.draft`     |

合同审查的界面说明是「按已附合同出审查意见；要改原文时再出修订稿」。不要写成「走审查流水线」——那句话会让律师和模型都以为切了能力就锁死步骤。

## 22.3 绑定：硬钉子先于猜测

`bindLawyerCapability` 就是 `hydrateCompiledIntent(compileIntent(...))`。编译器是单一真相源。顺序（第 70 章有全表）：

1. 办件锁或 `$skill`。律师点名时不再猜。
2. 邮件合同短路径标记。只有指令里已经带了短路径，才绑 `mail.contract`。对话里说「审合同」不会抢这条。
3. Word 改稿（钉了 Word，并且原话是在改这份文件）。管线改成 `tracked_redline`，并钉上主阶段。
4. 公开网页事实、问候、纯确认、纠正上轮：不绑法律办件。
5. 专用说法（劳动金额、期限、发票、传票、家事、知产……）。
6. 文件类型和动词一起看。合同和诉状混在一起时静默选一个，不追问律师。
7. 关键词、上一轮续作、材料类型默认、案件门类打破平局。
8. 对不上就 `unbound`。未绑定不是失败，是留给模型按目录自己选。

硬绑定（锁、邮件短路径、Word 改稿、高置信专用或联合）才把技能正文灌进提示。其余只给「本轮初步判断」，正文等 `read_skill`。这是铁律 5：关键词猜中的能力不能把模型关进一份说明书。

## 22.4 Word 改稿：钉主阶段，目录留下

`mail.contract` 是能力表里唯一把 `pipeline` 写成 `tracked_redline` 的。其余能力在「改这份 Word」时由 `pipelineOverride` 临时抬上去。交付物类型跟着变：合同审查抬成 `contract.general`（验收对着修订后的合同正文，不强迫再交一套审查意见的章节）；诉讼文书抬成 `document.general`；函件仍是 `letter.counsel`。

抬轨时 `skillIdsOverride` 只表示**这一轮的主阶段**，不是新的技能目录。`hydrateCompiledIntent` 把这几份放在 `skillIds` 最前面，再并上该能力原来的列表。索引还在。

| 能力               | 钉在最前的主阶段                                   | 目录里仍留着                                                                                             |
| ------------------ | -------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `contract.review`  | `contract-review-layers`、`contract-redline-craft` | 含 `contract-playbook-review`。流程提示点名去 `read_skill`。己方纸或对方纸没写就标【待定】，不先停下来问 |
| `letter.draft`     | `delivery-language`、`legal-element-extraction`    | 交办 intake、引用锚定                                                                                    |
| `litigation.draft` | 见下                                               | 家事、刑事、破产、知产、起诉状母版都还在索引里                                                           |

诉讼的主阶段不按「凡是诉状就用起诉状母版」：

1. 原话在最后一个「改 / 写 / 起草 / 拟」之后点了文书种类，跟第 20 章那张表。
2. 原话只是「帮我改一下」，跟文件名。`民事起诉状.docx` 用起诉状母版加证据链；`民事答辩状.docx`、`辩护词.docx` 用对应路由，不用起诉状母版。
3. 文件名也认不出时，用诉讼阶段路由加证据链。

以前 Word 改稿把 `skillIds` **整表换成** `complaint-elements-fill`。答辩状、辩护词都会被唯一一份起诉状母版拉走，Playbook 也从合同改稿的索引里消失。Harvey 的审查立场是数据，改稿时还在；Cursor 改一个文件不会把别的 Skill 从目录里删掉。并集就是按这个改的。

## 22.5 主阶段怎么选

`primarySkillIdsForBound` 在能力已经绑好之后再选，最多两份：

1. `mail.contract` 固定分层审查加引用锚定。最短改动由邮件短路径另注入，不占这两个名额。
2. 诉讼文书且已经是修订轨：取 `skillIds` 最前两份（22.4 钉上的那对）。不再用「帮我改一下」去跑诉讼分流，否则文件名选中的起诉状会被默认路由盖掉。
3. 其他诉讼文书：`litigationPrimary(原话)`。
4. 其余能力：`PRIMARY_BY_CAPABILITY`，再滤到该能力自己的 `skillIds` 里。

`planLeanSkillPrompt` 把没选中的做成「其余技能（索引，不要通读）」。

## 22.6 管线提示不锁工具

`pipeline` 三个值只影响提示，不冻结工具表（第 5 章）：

| pipeline              | 谁在用                                                                 | 提示在说什么                                                               |
| --------------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `execute_workflow`    | 上表以外的能力                                                         | 工具都可用。`execute_workflow` 是可选，不是唯一路径                        |
| `research_then_draft` | `research.memo`、`analysis.quick`、`compliance.data`、`compliance.ads` | 主张法条前先试检。快问也走这条，是为了不凭记忆编条号，不是先出大纲等人确认 |
| `tracked_redline`     | 常态只有 `mail.contract`；Word 改稿临时加上                            | 拷贝原 Word，最短改动，禁止 `render_document` 重建，不要准备外发           |

`resolveCapabilityPipelineHint` 还有一层：律师要的是意见书时，改用意见书提示（改稿工具仍可用）。不要把「只要意见」做成工具冻结。

未锁时的共用一句是：已配置工具都可用，按任务选用，不要为走管线丢掉判断。

`formatBoundCapabilityBlock` 拼进系统提示的顺序：能力名和 id、交付物类型、流程提示、「以本轮原话为准」、组合（若有）、两份正文、索引。里面写明：这是作业标准，不是必须走完的流水线，也不能由律师安装或关闭。

律师从界面锁定时，`formatCapabilityDispatchPrompt` 写的是「这是办件类型，不是锁死的流水线；工具按任务选用。」

## 22.7 一条原话里的两件活

`compileIntent` 的 `chain` 在高置信、且来源是锁、短路径、改稿、专用或联合时，可以多于一个 id。例如「审查这份合同并写催告函」是合同审查再加函件起草。提示里写成：

```text
组合（可调整顺序）：合同审查 → 函件起草。
```

用办事清单上的中文名，不用裸 id。顺序可以调。关键词和案件门类猜出来的绑定不播种这串步骤，避免把猜测写成必须完成的清单（铁律 5）。`compiledIntentPlanItems` 同样只在这条高置信链上给律师看步骤名。

## 22.8 额外工具和软绑定目录

硬绑定之后，`CAPABILITY_EXTRA_TOOLS`（`disclosed-turn-tools.ts`）按能力**加**工具，不按「装了哪个技能」加，也不拿掉别的工具。计算、检索、表格是否出现还看原话。两份以上文件钉选会加上 `compare_documents`。

没硬绑定、但看起来像法律工作时，注入 `formatCapabilityCatalogIndex`：每条能力一行 id、中文名、何时用、何时不用，上限 8000 字。`mail.contract` 不出现在这份隐式目录里。这是 Codex 的 name + description 目录；LawMind 不让律师自己写 description。

## 22.9 二十三个能力

交付物类型来自办事清单的 `defaultDeliverableType`，编译器可以按原话改掉（例如对照表变成 `analysis.table`，催款函变成 `letter.demand`）。

| id                    | 名称         | 管线                  | 默认交付物           | 主阶段                 | 入口       |
| --------------------- | ------------ | --------------------- | -------------------- | ---------------------- | ---------- |
| `contract.review`     | 合同审查     | `execute_workflow`    | `contract.review`    | 分层审查、最短改动     | 合同快车道 |
| `contract.draft`      | 合同起草     | `execute_workflow`    | `contract.general`   | 起草路由、开箱口径     | 办件锁     |
| `mail.contract`       | 邮件合同审阅 | `tracked_redline`     | `contract.review`    | 分层审查、引用锚定     | 邮件快车道 |
| `letter.draft`        | 函件起草     | `execute_workflow`    | `letter.counsel`     | 交付用语、要素提取     | 办件锁     |
| `research.memo`       | 检索研究     | `research_then_draft` | `memo.research`      | 命题矩阵、引用锚定     | 研究快车道 |
| `analysis.quick`      | 法律快问     | `research_then_draft` | `memo.internal`      | 快问、要素提取         | 办件锁     |
| `litigation.draft`    | 诉讼文书     | `execute_workflow`    | `litigation.outline` | 按原话，见 22.4        | 办件锁     |
| `litigation.talk`     | 谈话整理     | `execute_workflow`    | `memo.internal`      | 谈话整理、要素提取     | 办件锁     |
| `materials.draft`     | 写材料       | `execute_workflow`    | `document.general`   | 交付用语、要素提取     | 写材料     |
| `labor.calc`          | 劳动计算     | `execute_workflow`    | `labor.calc`         | 劳动补偿计算           | 办件锁     |
| `period.calc`         | 期限计算     | `execute_workflow`    | `period.calc`        | 程序期限               | 办件锁     |
| `chronology.timeline` | 时间轴       | `execute_workflow`    | `matter.timeline`    | 两阶段、从材料抽       | 办件锁     |
| `matter.intake`       | 整理案卷     | `execute_workflow`    | `document.general`   | 从材料建事项、范围预算 | 办件锁     |
| `ops.invoice`         | 整理发票     | `execute_workflow`    | `document.general`   | 发票整理               | 办件锁     |
| `ops.court_sms`       | 法院短信     | `execute_workflow`    | `matter.timeline`    | 短信识别、事件抽取     | 办件锁     |
| `ip.dispute`          | 知产争议     | `execute_workflow`    | `litigation.outline` | 知产路由、证据链       | 办件锁     |
| `deal.ma`             | 并购尽调     | `execute_workflow`    | `report.general`     | 尽调提纲、要素提取     | 办件锁     |
| `compliance.data`     | 数据合规     | `research_then_draft` | `report.compliance`  | 数据合规、规范现行     | 办件锁     |
| `compliance.ads`      | 广告产品合规 | `research_then_draft` | `report.general`     | 广告合规、规范现行     | 办件锁     |
| `matter.status`       | 办案周报     | `execute_workflow`    | `memo.internal`      | 周报、范围与预算       | 办件锁     |
| `family.matter`       | 家事继承     | `execute_workflow`    | `litigation.outline` | 家事路由、要素提取     | 办件锁     |
| `capital.markets`     | 资本市场     | `execute_workflow`    | `report.general`     | 资本市场、引用锚定     | 办件锁     |
| `corp.governance`     | 公司治理     | `execute_workflow`    | `memo.internal`      | 治理路由、规范现行     | 办件锁     |

几条容易看错的：

- **合同审查和合同起草**：已有合同要改，走审查。从零写骨架，走起草。审查在钉了 Word 且律师要改原文时才抬修订轨；「只要意见、不要改原稿」不抬。
- **邮件合同**：和审查共用门禁，但附件路径已经在指令里，不许发信，不许用模板重建原件。它不参加隐式目录。
- **法律快问**：管线名是 `research_then_draft`，提示是直接给结论、依据和缺口。能检索就先试检，不要编法条原文，也不要改成表单。这不是研究备忘的六节结构。
- **谈话整理**：交付物是内部备忘。律师点用前不要写入本案事实。
- **时间轴**：两份主阶段一起注入。同一轮交出正式时间轴，缺口标【待核实】，不先问要不要出正式件。
- **劳动计算和期限计算**：金额和届满日必须调 `calculate`。缺流水仍交付已经能确定的段。
- **办案周报**：本地顾问、人力、沟通计划走同一能力。范围变更和预算对照是第二份主阶段。
- **家事**：证据链在索引里，主阶段仍是家事路由加要素提取。不要套借贷起诉状。
- **公司治理**：决议和治理备忘。不要改成章程 Word 红线。
- **写材料**：对不上别的能力时的通用入口。待审核稿只称初稿。

## 22.10 对照：Cursor、Codex、Harvey

Cursor 和 Codex 的 Skill 是操作者安装的 `SKILL.md`，模型按 description 决定要不要读。LawMind 的用户是律师，安装面已删。对应物是上面那份 8000 字目录加 `read_skill`，主阶段最多两份正文。

Harvey 的 Playbook 是审查数据（标准 / 可接受回退 / 绝不接受），改稿时还在，不把长文塞进每一轮。合同 Word 改稿因此保留 `contract-playbook-review` 在索引里，并在流程提示里点名去读。不把 Playbook 正文升成第三份主阶段。

Harvey 的 Workflow 容易做成律师必须走完的步骤。LawMind 的 `pipeline` 和组合链都写成可调整的提示。工具表仍按第 3 章那条单链。硬拦截只留空修订不得导出、禁止重建原件、禁止误发。

没有为「走对能力」再加一轮模型分类。分流是确定性的，只决定哪两份说明进上下文。分错了，律师用 `【办件】` 或 `$skill` 覆盖，不用先回答一张任务类型表（铁律 1）。

刻意不做的：

- 不把 23 个能力做成对话里的模式开关。Day-1 仍是一句话交办。
- 不按能力冻结工具表。计算、检索、改稿该不该出现，看原话和安全边界。
- 不把快问改成必须先出研究大纲。试检法条是质量，停下来问要不要检索是打断。
- 不把 Word 改稿的技能目录收成一份母版。
- 不把时间轴收成「先预览、确认后再出正式件」。日期对错靠出处和缺口，不靠中间停顿。

## 22.11 已知坑

- **能力不冻结工具表。** 在某个能力下看到别的工具是正常的。
- **`litigation.draft` 的技能按原话和文件名分。** 改 `PRIMARY_BY_CAPABILITY` 不影响它。Word 改稿看 `litigationRevisionSkillIds`。
- **改稿覆盖是并集，不是替换。** 想让某份在改稿时成为主阶段，改 `wordRevisionSkillIds` 返回的前两份。想让它只在索引里出现，放进能力的 `skillIds` 即可。
- **`analysis.quick` 的管线名容易误导。** 它要求试检，不要求研究备忘的章节。
- **`matter.status` 的交付物是内部备忘。** 本地顾问和人力也在这里，不是对外报告。
- **办事清单的 `hint` 是律师能看见的字。** 不要写「流水线」「管线」「技能」。运行时说法在 `pipelineHint`。

## 22.12 关键文件

| 关注点                     | 文件                                              |
| -------------------------- | ------------------------------------------------- |
| 能力目录与提示块           | `src/lawmind/skills/lawyer-capabilities.ts`       |
| 办事清单、办件锁、`$skill` | `src/lawmind/skills/lawyer-capability-lock.ts`    |
| 主阶段与索引               | `src/lawmind/skills/skill-prompt-budget.ts`       |
| 诉讼主阶段、改稿跟文件名   | `src/lawmind/skills/litigation-primary.ts`        |
| 绑定顺序                   | `src/lawmind/intent/compile-intent.ts`            |
| 硬绑定还是假设             | `src/lawmind/intent/understand-first.ts`          |
| 软绑定目录                 | `src/lawmind/intent/catalog.ts`                   |
| 按能力加工具               | `src/lawmind/agent/tools/disclosed-turn-tools.ts` |
| 提示里的插入点             | `src/lawmind/agent/turn-orchestrator-prompt.ts`   |
