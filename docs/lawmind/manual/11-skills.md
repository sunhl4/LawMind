# 第 11 章 作业标准（内置，不安装）

这一章讲律师交办时，模型按什么标准把一件事做完。这些标准写在软件里。律师不安装、不开关、不上传。

代码里的文件名仍叫 skill（`src/lawmind/skills/`、工具 `read_skill`）。产品词是**作业标准**：给模型的质量说明，加上对应的验收。它不是插件，也不是技能商店。

> 意图编译见第 4 章与第 70.1–70.9 节。37 份正文的写法见第 20 章。签名函数仍在，但不再决定回合是否读到正文，见 11.11。

## 11.1 定位：写进产品，不做成接口

一个作业标准是一份 Markdown。它告诉模型「这类活做到什么程度算做完」，不冻结本轮工具表。源码注释：

> Skills coach quality; they do not freeze the tool table into a single pipeline.

两条例子：

- `contract-review-layers`：宏观看交易结构、中观看文本形式、微观看条款；风险带推荐措辞；事实不够也把已完成的部分写完。
- `labor-compensation-calc`：N/N+1/2N、加班费、双倍工资按规则算并写出公式；必须调用 `calculate`，口算不算完成。

五条铁律在这里的取舍：

| 铁律           | 这一章怎么落                                                       |
| -------------- | ------------------------------------------------------------------ |
| 上手简单       | 没有「技能库」开关。交办一句话，标准自己跟上。                     |
| 交付质量       | 标准写清完成条件（公式、出处、缺项仍出已完成部分）。               |
| 稳定           | 正文随安装包走。工作区里改一份 `SKILL.md` 不会让下一轮变样。       |
| 先复用，后自研 | 外部技能由工程消化进 `builtin/*.md`，律师不装第三方包。            |
| 发挥模型能力   | 标准是教练。硬拦只留安全、空交付、授权和不可逆操作（第 3、5 章）。 |

Cursor 和 Codex 把 `SKILL.md` 交给**操作者**安装，因为他们的用户就是在配置 Agent 的人。Harvey 把审查、Vault、工作流做成产品功能；律所立场放在 playbook 数据里，律师界面上没有「安装一个 skill」。LawMind 的用户是律师，走 Harvey 这条，不走 Cursor 的安装面。

## 11.2 律师侧看得到什么

- **对话**：不选技能。意图编译绑定一个能力（第 4 章），状态条一行「本轮按××处理」。
- **分诊**：只显示推荐工作流和待澄清问题。不列出作业标准，也不按关键词去「匹配将启用哪一份」。哪几份正文进上下文，由本轮绑定的能力决定（11.6）。
- **设置深链**「作业标准」（`LawmindSettingsSkills.tsx`）：只读名单。侧栏里没有这一项。没有开关、没有上传、没有「中国法律包」。
- **执业口径**另走 `lawmind/practice-playbook.json` 和记忆（第 6 章）。`practice-defaults` 写明：没有律所档案时用默认跑完；改的是那份口径文件，不是替换技能正文。

## 11.3 明确删掉的面

下列事情以前存在，现在不作为产品能力：

| 以前                                                        | 现在                                                                |
| ----------------------------------------------------------- | ------------------------------------------------------------------- |
| 设置里启用 / 停用某份技能                                   | 深链只读。`POST /api/skills/enabled` 返回 405                       |
| 往 `<工作区>/lawmind/skills/<id>/SKILL.md` 丢文件来增加指令 | `readSkillPromptBodies` 忽略该目录                                  |
| 签过名的技能往工具表里加名字                                | `collectEnabledSkillToolNames` 只读 builtin 的 `tools:`             |
| `lawmind/skills/<id>/scripts/*.js` 当可执行插件             | `run_analysis` 拒绝。确认过的脚本只在 `artifacts/analysis-scripts/` |
| 设置页展示 `cn-legal-pack.json`                             | `GET /api/skills` 不再读这个包                                      |

`enabled.json`、`SKILL.sig`、`listLocalSkills` 还在，只服务「工作区里有没有那份历史副本」。它们不决定模型行为。

## 11.4 登记表就是目录

`listProductPlaybooks()`（`product-playbooks.ts`）扫描 `src/lawmind/skills/builtin/*.md`。现在是 **37** 份。没有第二份「种子 id 名单」当运行时登记表。

`BUILTIN_SKILL_SEED_IDS` 仍被播种函数使用，但测试要求它和这 37 个 id 一致（含以前漏掉的 `client-talk-intake`、`legal-event-extract`）。漏登记会在 `ensure-builtin-skill-seeds.test.ts` 失败。

23 个产品化能力在 `LAWYER_CAPABILITY_IDS`（`lawyer-capability-lock.ts`）。能力是律师事项；作业标准是该事项的质量说明。一个能力可以挂多份标准。

## 11.5 文件格式

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
```

解析正则（`skill-runtime.ts` 与 `product-playbooks.ts` 各有一份，形状相同）：

```text
/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/
```

- `id` 缺失时用文件名。
- `version` 缺失时为 `"0"`。
- `tags` / `workflows` / `tools` 按逗号或中文逗号切开。
- `tools` 是这份标准希望本轮能用到的工具名。产品路径会披露它们，并丢掉外发、改稿、委派等名字（`SKILL_DISCLOSE_DENY`）。不能靠写 `tools: send_email` 把外发塞进工具表。

## 11.6 一次回合里正文怎么进去

`readSkillPromptBodies` 的顺序是固定的：

1. `contract-redline-craft` 用代码常量 `CONTRACT_REDLINE_CRAFT_SKILL`，不读文件。最短改动的门槛和引擎绑在一起，避免正文和门禁各写一套。
2. 其他 id 只读 `builtin/<id>.md`。
3. 参数里的 `workspaceDir` 被忽略。同目录下如果放了「TAMPER」正文，测试要求它不得出现。

注入预算在 `skill-prompt-budget.ts`：绑定能力后最多注入 **2** 份主阶段正文，其余做成索引。文件头：

> Lean skill injection: dump up to 2 primary stage bodies, index the rest.

索引标题是「## 其余技能（索引，不要通读）」，末尾要求调用 `read_skill`。这是从 Codex 留下的按需加载，避免一次塞进十几份长文。

`read_skill`（`read-skill-tool.ts`）每一轮都广告，幂等只读。单次正文上限 12000 字，超出截断并标 `truncated`。不传 `skill_id` 时返回能力名、内置标准名，以及规范库索引。规范库条目没有正文。工作区技能 id 不会出现在目录里。

主阶段映射 `PRIMARY_BY_CAPABILITY`（节选）：

| 能力              | 主阶段                                             |
| ----------------- | -------------------------------------------------- |
| `contract.review` | `contract-review-layers`、`contract-redline-craft` |
| `contract.draft`  | `contract-drafting-route`、`practice-defaults`     |
| `mail.contract`   | `contract-review-layers`、`citation-grounding`     |
| `research.memo`   | `research-query-matrix`、`citation-grounding`      |
| `analysis.quick`  | `quick-legal-triage`、`legal-element-extraction`   |
| `labor.calc`      | `labor-compensation-calc`                          |
| `period.calc`     | `legal-period-calc`                                |
| `litigation.talk` | `client-talk-intake`、`legal-element-extraction`   |
| `ops.court_sms`   | `court-sms-intake`、`legal-event-extract`          |

`litigation.draft` 再按原话细分（实现：`skills/litigation-primary.ts`，Word 改稿走 `litigationRevisionSkillIds`）：离婚 / 抚养走家事；侦查 / 审查起诉走刑事；债权申报走破产；知产争议走知产。起诉状与答辩状看最后一个「写 / 起草 / 拟」后面先出现的文书：先是答辩、质证、保全申请、管辖异议、再审申请，就走 `litigation-stage-route` 加 `evidence-argument-chain`；先是起诉状，或交付类型就是起诉状，才注入要素式起诉状。其余文书同样不注入起诉状母版。

选出的 id 还必须落在该能力自己的 `skillIds` 里，然后再 `.slice(0, 2)`。

提示块由 `formatBoundCapabilityBlock` 拼出。它写明：这是产品化办件，工具按任务选用，下面是写进软件的作业标准，不是必须走完的流水线，也不能由律师安装或关闭。

## 11.7 23 个能力

每个能力 = 一组作业标准 + 验收类型。律师不必从这张表里点选；编译器绑定。完整 id：

| id                    | 名称         | 说明                               |
| --------------------- | ------------ | ---------------------------------- |
| `contract.review`     | 合同审查     | 按已附合同走审查                   |
| `letter.draft`        | 函件起草     | 按已附事实起草函件                 |
| `research.memo`       | 检索研究     | 按已附问题检索并出备忘             |
| `litigation.draft`    | 诉讼文书     | 按已附案情起草诉讼材料             |
| `litigation.talk`     | 谈话整理     | 谈话记录整理成需求、案由和证据缺口 |
| `materials.draft`     | 写材料       | 意见书 / 备忘等                    |
| `mail.contract`       | 邮件合同审阅 | 邮箱来件走审查与修订轨             |
| `analysis.quick`      | 法律快问     | 一句话问题给结论和依据             |
| `contract.draft`      | 合同起草     | 按交易类型出条款骨架和完整稿       |
| `labor.calc`          | 劳动计算     | 经济补偿、加班、双倍工资按公式算   |
| `chronology.timeline` | 时间轴       | 从材料抽出日期事件并去重           |
| `matter.intake`       | 整理案卷     | 材料归位并抽出当事人案由           |
| `period.calc`         | 期限计算     | 上诉、答辩、仲裁、执行期间算届满日 |
| `ops.invoice`         | 整理发票     | 发票归类、合计入卷                 |
| `ops.court_sms`       | 法院短信     | 抽出案号、开庭时间和待办           |
| `ip.dispute`          | 知产争议     | 权利基础、被控侵权和程序路径       |
| `deal.ma`             | 并购尽调     | 股权/资产尽调提纲和交割清单        |
| `compliance.data`     | 数据合规     | 个保法/数安法栏目，缺的标待核实    |
| `compliance.ads`      | 广告产品合规 | 广告用语和标签核对，给出可替换措辞 |
| `matter.status`       | 办案周报     | 阶段、期限、范围                   |
| `family.matter`       | 家事继承     | 离婚、抚养、继承按家事程序写       |
| `capital.markets`     | 资本市场     | 发行和信息披露核对，不编未披露数字 |
| `corp.governance`     | 公司治理     | 决议和治理备忘，不走章程 Word 改稿 |

`action` 只描述界面落点：`lock`、`research-lane`、`mail-lane`、`write-materials`。（原 `contract-lane` 已移除，合同审查走 `lock`。）

管线三类（声明在能力上，不是律师选的）：

| 管线                  | 能力                                                                   |
| --------------------- | ---------------------------------------------------------------------- |
| `research_then_draft` | `research.memo`、`analysis.quick`、`compliance.data`、`compliance.ads` |
| `tracked_redline`     | `mail.contract`                                                        |
| `execute_workflow`    | 其余                                                                   |

`tracked_redline` 只给邮件合同，因为那条路径有原 Word 基线。合同审查、诉讼文书、函件在「改这份 Word」时也会被抬成修订轨（`hydrateCompiledIntent`）。抬轨时主阶段钉在前面，原有技能目录还在，可以 `read_skill`。那是意图结果，不是技能安装。

## 11.8 37 份作业标准

| id                           | 名称               | 版本 | 管什么                                                         |
| ---------------------------- | ------------------ | ---- | -------------------------------------------------------------- |
| `ads-compliance-route`       | 广告与产品合规     | 1    | 广告用语和标签核对；绝对化用语标出；给出可替换措辞             |
| `bankruptcy-stage-route`     | 破产阶段路由       | 1    | 按申请受理、债权申报、重整/清算写材料，不混用民事起诉模板      |
| `capital-markets-route`      | 资本市场文件核对   | 3    | 发行/信息披露核对清单；数字只用来源页                          |
| `chronology-from-materials`  | 时间轴整理         | 1    | 从材料抽日期事件、去重；立场只着色不改时间线                   |
| `chronology-two-stage`       | 诉讼时间轴         | 1    | 先出可改草案；不把推测日期写成事实                             |
| `citation-grounding`         | 引用锚定           | 2    | 能检索则先检索再断言；勿编条号                                 |
| `client-talk-intake`         | 谈话整理           | 2    | 谈话整理成需求、核心事实、候选案由和证据缺口                   |
| `complaint-elements-fill`    | 要素式起诉状母版   | 1    | 按固定栏目填起诉状；缺项标待补充仍出稿                         |
| `contract-drafting-route`    | 合同起草路由       | 2    | 封闭类型路由卡、条款骨架、待补事实写在稿里                     |
| `contract-playbook-review`   | 合同 Playbook 审查 | 1    | 标准 / 可接受回退 / 永不接受；己方纸与对方纸分开               |
| `contract-redline-craft`     | 合同审阅改稿手艺   | 4    | 最短锚定（字/词级）；运行时以代码常量为准                      |
| `contract-review-layers`     | 合同分层审查       | 2    | 宏观、中观、微观；风险带推荐措辞                               |
| `court-sms-intake`           | 法院短信识别       | 2    | 抽出案号、开庭时间和待办                                       |
| `criminal-stage-route`       | 刑事阶段路由       | 1    | 按侦查/审查起诉/一审/二审写，不套民事起诉状                    |
| `data-compliance-route`      | 数据合规备忘       | 1    | 个保法/数据安全法/网安法；新闻不当现行法                       |
| `delivery-language`          | 交付用语           | 2    | 待审核稿不得写成可对外签发                                     |
| `evidence-argument-chain`    | 证据论证链         | 2    | 主张→要件→待证事实→证据→证明力                                 |
| `family-matter-route`        | 家事继承路由       | 3    | 离婚、抚养、继承按家事程序；子女利益与财产分栏                 |
| `governance-route`           | 公司治理路由       | 1    | 决议和治理备忘；不是章程 Word 改稿                             |
| `intake-required-inputs`     | 交办 Intake        | 1    | 材料齐备时不冻写；高风险空跑才硬澄清                           |
| `invoice-organizer`          | 发票整理           | 1    | 归类并列出可入卷清单；数字带来源                               |
| `ip-dispute-route`           | 知产争议路由       | 1    | 专利/商标/著作权/反不正当竞争，不套普通民事起诉状              |
| `labor-compensation-calc`    | 劳动补偿计算       | 2    | 按规则算并写出公式；必须调 `calculate`                         |
| `legal-element-extraction`   | 法律要素提取       | 1    | 生活叙事先变成要件事实                                         |
| `legal-event-extract`        | 法律事件抽取       | 2    | 从传票、法院短信、举证通知抽出开庭和期限                       |
| `legal-period-calc`          | 程序期限计算       | 1    | 用规则引擎算届满日；不要口算                                   |
| `litigation-stage-route`     | 诉讼阶段路由       | 3    | 按材料推断阶段；答辩、代理词、上诉、执行、保全、再审不套起诉状 |
| `ma-diligence-route`         | 并购尽调提纲       | 1    | 尽调提纲与交割清单；不编未看到的文件                           |
| `matter-budget-lite`         | 事项范围与预算     | 2    | 抽出范围、期限和粗预算；不挡建档                               |
| `matter-from-materials`      | 从材料建事项       | 4    | 抽出当事人案由并归位                                           |
| `matter-status-report`       | 办案周报           | 4    | 进度不是活动；范围/RAID/置信                                   |
| `matter-status-scope-budget` | 范围变更与预算     | 1    | 周报上补范围变更与预算对照                                     |
| `norm-validity`              | 规范现行有效       | 2    | 引用前核是否现行有效；废止法不得当有效依据                     |
| `practice-defaults`          | 开箱默认执业口径   | 2    | 无律所档案也能审完；口径文件只影响之后的任务                   |
| `quick-legal-triage`         | 法律快问           | 1    | 一句话直接答；不要改成表单                                     |
| `research-query-matrix`      | 检索命题矩阵       | 2    | 先命题再检索；每争点正反各一                                   |
| `spreadsheet-analysis`       | 表格分析           | 3    | 先分析表格，再计算/出图/落表；数字带来源列                     |

带 `tools:` 的有 11 份：`client-talk-intake`、`court-sms-intake`、`data-compliance-route`、`invoice-organizer`、`labor-compensation-calc`、`legal-event-extract`、`legal-period-calc`、`matter-from-materials`、`research-query-matrix`、`ads-compliance-route`、`spreadsheet-analysis`。这些名字进入本轮披露，关不掉。

三份来自外部消化（2026-09-19）：`contract-playbook-review`（Anthropic playbook，Apache-2.0）、`chronology-two-stage`、`matter-status-scope-budget`。出处在 `docs/LAWMIND-CANONICAL-LEGAL-SKILLS.md`。消化的结果是仓库里的正文，不是一个可安装包。

## 11.9 工具披露

`collectEnabledSkillToolNames` 收集全部产品作业标准的 `tools:`，再滤掉 `SKILL_DISCLOSE_DENY`（`send_email`、`apply_surgical_edits`、`render_document`、`delegate_task` 等）。工作区参数被忽略。

因此：

- 把 `spreadsheet-analysis` 在 `enabled.json` 里关掉，`analyze_spreadsheet` 仍然披露。
- 往工作区放一份 `tools: evil_only_tool, send_email` 的技能，两个名字都不会出现。

能力自己的额外工具在 `CAPABILITY_EXTRA_TOOLS`，按绑定的事项加，不按「装了哪个技能」加。计算、检索、表格该不该出现，还看指令（`extraToolsForInstruction`）。作业标准不能把工具表收成一条流水线。

## 11.10 规范库：工程消化，不装包

`census/canonical-skill-index.ts` 登记外部法律技能的元数据（许可、对应能力、何时用、何时不用）。`read_skill` 不传 id 时会列出，格式带「不执行、不装包」。

普查在 `external-skill-census.ts`：截止日期 `2026-09-07`，19 组查询，9 个枢纽仓库。

```bash
pnpm lawmind:skills:census
pnpm lawmind:skills:census --fetch
```

`--fetch` 需要 `gh`。没有就跳过，不报错。

许可分级（`classifyLicenseAbsorb`）：MIT / Apache / BSD 为 `absorb`；CC-BY、CC-BY-SA、CC-BY-NC、空许可、AGPL/GPL 不直接搬正文（AGPL/GPL 为 `skip`，其余 `structure_only`）。未声明许可不写进 builtin 正文。

「已消化」要有：builtin 正文、播种名单、能力映射、契约测试（`skill-deliverable-contract.test.ts`）、`docs/LAWMIND-CANONICAL-LEGAL-SKILLS.md` 第八节一行。索引本身不算消化。

`bundle-manifest.ts` 只做工作区内文件的 SHA-256 核对（路径不能逃出工作区）。它不下载、不安装。

## 11.11 播种与签名还留下什么

本地服务启动**不再**调用 `ensureBuiltinSkillSeeds`，也不会因为缺签名密钥打警告。工作区里已有的 `<工作区>/lawmind/skills/<id>/` 是旧副本，回合不读。

`ensureBuiltinSkillSeeds` 函数还在，供需要对照副本的测试调用。它的升级规则：已有文件须带 `source: lawmind-builtin`，正文有变化或签名缺失，且新版本号不低于旧版本号。非内置来源的同名文件不覆盖。

密钥三种来源仍在 `resolveSkillSigningSecretSource`：

| 来源      | 位置                                      | 评价       |
| --------- | ----------------------------------------- | ---------- |
| `env`     | `LAWMIND_SKILL_SIGNING_SECRET`            | 真密钥     |
| `file`    | `<工作区>/lawmind/skills/.signing-secret` | 单机便利   |
| `derived` | 工作区路径的哈希前 32 字符                | 不是信任根 |

若仍要给旧副本签名，调用方要先加载环境变量，再把 `secret` 显式传给播种函数。这只影响 `listLocalSkills` 如何标记副本，不影响交办。

`pnpm lawmind:skills:sign` 在密钥来源是 `derived` 且没有 `--allow-derived` 时拒绝执行。它签的是工作区副本，不是产品开关。

## 11.12 HTTP

| 端点                  | 方法 | 行为                                                                           |
| --------------------- | ---- | ------------------------------------------------------------------------------ |
| `/api/skills`         | GET  | `{ configurable: false, skills: [...] }`。名单来自 builtin，不播种、不读中国包 |
| `/api/skills/enabled` | POST | 405，`作业标准随软件内置，不能安装或开关。`                                    |

## 11.13 关键文件

| 关注点                 | 文件                                                                   |
| ---------------------- | ---------------------------------------------------------------------- |
| 产品登记               | `src/lawmind/skills/product-playbooks.ts`                              |
| 正文读取与能力绑定     | `src/lawmind/skills/lawyer-capabilities.ts`                            |
| 注入预算               | `src/lawmind/skills/skill-prompt-budget.ts`                            |
| 能力 id                | `src/lawmind/skills/lawyer-capability-lock.ts`                         |
| 工作区副本（不进回合） | `src/lawmind/skills/skill-runtime.ts`、`ensure-builtin-skill-seeds.ts` |
| 按需读取               | `src/lawmind/agent/tools/legal/read-skill-tool.ts`                     |
| 工具披露               | `src/lawmind/agent/tools/disclosed-turn-tools.ts`                      |
| 分析脚本拒绝技能目录   | `src/lawmind/agent/tools/legal/run-analysis-tool.ts`                   |
| 只读设置页             | `apps/lawmind-desktop/src/renderer/LawmindSettingsSkills.tsx`          |
| HTTP                   | `apps/lawmind-desktop/server/lawmind-server-route-skills.ts`           |
| 改稿手艺常量           | `src/lawmind/drafts/contract-redline-craft.ts`                         |
| 规范库与普查           | `src/lawmind/skills/census/`                                           |
| 契约测试               | `src/lawmind/evaluation/skill-deliverable-contract.test.ts`            |

## 11.14 边界

- 改效果要改 `builtin/*.md` 或 `CONTRACT_REDLINE_CRAFT_SKILL`。改工作区副本无效。
- 一次最多注入 2 份正文。想让某份成为主阶段，改 `PRIMARY_BY_CAPABILITY`，不是把文件写得更长。
- 作业标准不能硬拦。硬拦用工具治理和门禁。
- 规范库不执行第三方正文。
- 未声明许可不搬进 builtin。
- 分析脚本不从技能目录运行。
- 启动不往工作区复制作业标准。旧副本留着也不进入回合。
