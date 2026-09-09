# LawMind 规范法律 Skill 库（去重后）

> 截止：2026-09-08  
> 输入：`docs/LAWMIND-EXTERNAL-LEGAL-CAPABILITY-CATALOG.md` 的普查结果  
> 用途：律师高频需求分析，以及按这些 Skill 的约束、规范和实现方式开发 LawMind。  
> 独立复审（内在逻辑、提示词、可开发需求）见 [docs/LAWMIND-SKILL-LOGIC-REQUIREMENTS.md](docs/LAWMIND-SKILL-LOGIC-REQUIREMENTS.md)。  
> 按开箱、质量和稳态重排后的开发顺序见 [docs/LAWMIND-SKILL-THREE-LAWS-REVIEW.md](docs/LAWMIND-SKILL-THREE-LAWS-REVIEW.md)。  
> 本文件保留的是**设计语料**，不是把第三方正文原样装进发行包。许可证不允许时只借鉴方法并独立实现。

## 一、去重结论

公开仓库里的 Skill 数量不能当能力数量。

| 来源                                |        标称规模 | 结构事实                                                                                | 处理                                                             |
| ----------------------------------- | --------------: | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `ThomasMoreAI/legal-skills-open`    |           3,571 | 3,537 项只有 2 个文件；≥5 个文件的仅 18 项                                              | 整体降权。只保留那 18 项厚包                                     |
| `CSlawyer1985/legal-skillhub`       |           2,049 | 1,337 项无 scripts 也无 references；`contract-review` 同名 9 份；精确内容哈希几乎无重复 | 当发现索引，不当规范源                                           |
| `sboghossian/mini-claude-for-legal` |             982 | 与 ThomasMore / SkillHub 高度同构的 SKILL.md 工厂                                       | 不进规范库                                                       |
| `vivy-yi/Greater-China-Legal`       | 574 个 SKILL.md | 真正完整的是 36 个场景 `CLAUDE.md` + 25 个推理原子，不是 574 份薄指令                   | 保留场景操作系统，不保留全部原子副本                             |
| `zhou210712/claude-for-legal-ZH`    |             150 | Anthropic 中国移植                                                                      | 以 Anthropic 为上游，中国化以 Greater-China / HoriZon / 潘睿为准 |
| `lawve-ai/awesome-legal-skills`     |             263 | 策展副本，厚包已出现在上游                                                              | 用它核对有无漏收，不重复保留                                     |
| `anthropics/claude-for-legal`       |             151 | 单个 SKILL.md 也偏薄，但插件 OS（cold-start、playbook、角色、升级）完整                 | 作为**工作台架构**规范源                                         |

**规范库规模：约 70 个可执行单元**（插件 OS、场景操作系统、带脚本的工作流、法律运营包），而不是数千条提示词。

筛选标准（同时满足越多越好）：

1. 有工作流，不只是“你是一名律师”。
2. 有输出契约：字段、风险等级、能否签、缺口清单。
3. 有硬闸门：缺立场、未读材料、未核法条、未过出稿检查则停止。
4. 有脚本或模板，能产出 DOCX / 红线 / 计算 / 图表，而不是只聊天。
5. 许可证可研究；MIT / Apache 可直接吸收方法；NC / 未声明只借鉴结构。

## 二、规范库（去重后保留）

### A. 工作台操作系统（先学架构，再抄任务）

这些决定 LawMind 怎么组织能力，比再写一个合同提示词更重要。

| 单元             | 来源                                                       | 许可证               | 为什么留                                                                          |
| ---------------- | ---------------------------------------------------------- | -------------------- | --------------------------------------------------------------------------------- |
| 商业合同插件 OS  | `anthropics/claude-for-legal` `commercial-legal/CLAUDE.md` | Apache-2.0           | cold-start、公司画像、销售/采购双边 playbook、集成失败回退、升级矩阵              |
| `/review` 路由器 | 同上 `skills/review/SKILL.md`                              | Apache-2.0           | 先读标题再路由 NDA/MSA/SaaS；默认向律师确认路由                                   |
| 法律工作总控     | `pa1nrui1/legal-skills`                                    | MIT                  | 中国律师工作台：事项隔离、完整读取、法规核验、正式交付分类、出稿闭环              |
| 合同审查场景 OS  | `vivy-yi/Greater-China-Legal` 场景 `CLAUDE.md`             | Apache-2.0（README） | 角色 5 档、对内/对外文档分流、可签/需改/不可签决策树、双源验证                    |
| 宏志争议解决簇   | `FAYANHUIYING/claude-for-legal-HoriZon`                    | Apache-2.0           | 把 Anthropic 插件模型落到中国诉讼：接案、要件、时间轴、起诉状、上诉、期限         |
| 法律项目管理     | `legalopsconsulting/lpm-skills` 16 项                      | Apache-2.0           | 接案、范围、预算、期限、状态报告、范围变更；这是律师高频但 LawMind 几乎空白的一层 |

不保留：Anthropic 其余法域插件的逐条 SKILL.md（与场景 OS 重复）、Greater-China 574 个原子 Skill 的全文、HoriZon 各插件里重复的 `cold-start-interview` / `customize` / `matter-workspace`。

### B. 合同审查与红线（保留 4 套，删掉 9 份同名薄包）

| 单元                                     | 来源                                                                   | 许可证       | 消化方式                                                                                               |
| ---------------------------------------- | ---------------------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------ |
| 分层四步 + `review-plan.json` + 原生修订 | `cat-xierluo/legal-skills` `contract-copilot`                          | **CC-BY-NC** | **只借鉴结构，独立实现**。阻塞项：立场 / 目的 / 口径。宏观–中观–微观。P0/P1/P2。缺关键事实不得出“可签” |
| 合同审查 + `redline-plan.json` + QA      | `pa1nrui1/legal-skills` `合同审查`                                     | MIT          | 直接吸收：计划 → `apply_redline_plan.py` → `qa_redline.py` 查 `w:ins`/`w:del`                          |
| 官方 playbook 审查                       | Anthropic `nda-review` / `vendor-agreement-review` / `saas-msa-review` | Apache-2.0   | 吸收：标准 / 可接受回退 / 永不接受；按己方纸还是对方纸选 playbook                                      |
| 中美规则包 + DOCX 红线脚本               | `code-lawyer/Legal-Agent-Skills`                                       | MIT          | 吸收条款库与辖区规则卡，补 LawMind 现有 `apply_surgical_edits`                                         |
| 中国合同审核方法论                       | `CSlawyer1985/contract-review-pro`                                     | 未声明       | 只读方法，不 vendoring                                                                                 |

已删：SkillHub 中 `contract-review`、`contract-review-2/3`、`contract-reviewer-wudi`（GPL）、各类 1–2 文件“合同审核助手”。LawMind 已有 `contract-redline-craft`（最短锚定），应与“计划 JSON + 原生修订 QA”合并，而不是再写第三套提示词。

### C. 法律检索与引用

| 单元            | 来源                                                  | 许可证      | 关键约束                                                                                     |
| --------------- | ----------------------------------------------------- | ----------- | -------------------------------------------------------------------------------------------- |
| 中国法源检索    | `Golden2002/legal-research-skill`                     | MIT         | 立法法效力层级；一般规定 vs 特别规定；身份分流（普通人/律师/法务）只改报告形态，不改法源纪律 |
| 法规案例检索    | `pa1nrui1` `法规案例检索`                             | MIT         | 与总控的北大法宝核验协议绑定                                                                 |
| 元典检索中间层  | `cat-xierluo` `yuandian-law-search`                   | MIT         | 先命题和查询矩阵，再调 MCP，再核对位度                                                       |
| 检答网集萃      | SkillHub `jiandawang-jicui-consultation`              | MIT         | 内置批次全文检索；禁止编造批次号                                                             |
| 北大法宝 / DOCX | `NEU-ZHA/legal-ai-skills`                             | MIT         | 检索 + 引用 + 文书工作流                                                                     |
| 权威来源分诊    | ThomasMore 厚包 `swiss-legal-source-authority-triage` | 随库 Apache | 官方源优先级，可移植到中国官源                                                               |

不保留：只说“调用 CourtListener”但无查询矩阵、无时效核验、无来源边界的检索提示词。

### D. 诉讼、证据、期限、可视化

| 单元             | 来源                                                                              | 许可证   | 关键能力                                  |
| ---------------- | --------------------------------------------------------------------------------- | -------- | ----------------------------------------- |
| 民事一审全流程   | `pa1nrui1` 民事一审 / 立案 / 文书 / 证据 / 庭前 / 庭审 / 调解 / 归档              | MIT      | 程序阶段路由，不把所有诉讼写成一个 prompt |
| 要素式起诉状克隆 | `cat-xierluo` `elements-complaint-generator`                                      | 见单项   | 母版克隆，不破坏表格和页码                |
| 诉讼分析         | `cat-xierluo` `litigation-analysis`                                               | CC-BY-NC | 借鉴三层输出（内部/研究/客户），独立实现  |
| 诉讼可视化       | `MiaoQichuan/new-litigation-visualization` 及 `legal-diagram`                     | MIT      | 时间轴、关系图、争点图；先预览再正式图    |
| 期限管理         | `SimbaCD/legal-period-manager-skills` + ThomasMore `litigation-deadline-calendar` | MIT      | 诉讼/执行/仲裁期间计算                    |
| 备忘录流水线     | `gregmos/memoforge`                                                               | MIT      | intake → research → review → DOCX         |

### E. 中国专项实务（潘睿包为完整度最高的一套）

`pa1nrui1/legal-skills` 按真实办案阶段拆 Skill，而不是按法域堆形容词。规范库整包保留下列簇，内部再去重“总调度 vs 阶段 Skill”：

- 刑事：总调度、侦查、审查起诉、一审、二审、未成年、死刑、特殊程序
- 劳动：仲裁程序、证据体系、劳动关系与经济补偿计算、用人单位合规
- 破产：申请受理、债权申报、债权人会议、重整、清算、和解、管理人
- 产品与监管：产品法务、广告合规、食品标签、监管监测
- 交付：出稿前审查、模板与导出、案件材料生成专业文档

Greater-China 的并购、资本市场、数据合规、知识产权、家事等场景 OS 作为**补缺**，不与潘睿民事/刑事/劳动重复建设。

### F. 事务与律所运营（高频、常被做成“法律 AI”时漏掉）

| 单元                           | 来源                                                                 | 许可证                 |
| ------------------------------ | -------------------------------------------------------------------- | ---------------------- |
| 新建案件目录 / 看板 / 工时期限 | `cat-xierluo` `new-case`                                             | CC-BY-NC（商业需授权） |
| 法院短信识别与文书下载         | `court-sms`                                                          | MIT                    |
| 发票整理                       | `invoice-organizer`                                                  | MIT                    |
| 法律 OCR                       | `legal-ocr`                                                          | MIT                    |
| 会议转写                       | `funasr-transcribe` / `dingtalk-minutes`                             | MIT                    |
| 外部顾问账单审查               | ThomasMore / SkillHub `outside-counsel-billing-performance-reviewer` | Apache-2.0             |
| Clio / Lawmatics MCP           | `oktopeak/clio-mcp` 等                                               | MIT                    |

### G. 明确不进入规范库

- 未声明许可证的厚包正文（可做对照，不进产品）。
- AGPL / GPL 合同包（如 `contract-reviewer-wudi`）。
- 法律翻译 199 文件双包：对律师日常主路径不是最高频，且体积主要是语料不是工作流。
- 法学生 / 法考 / QCM / 模拟庭审教学包。
- “你是 AI 律师”空壳、作业仓库、Clio 空 fork、宣传站。

## 三、跨 Skill 约束语法（应写进 LawMind 规则，而不是再写长提示）

下列规则在 Anthropic、潘睿总控、contract-copilot、Greater-China 场景 OS 中反复出现。这就是“根据这些 Skill 的约束规范开发 LawMind”的核心。

### 1. 先配置，后干活

没有 playbook / 立场 / 事项档案时，停止实质审查。Anthropic 要求 cold-start；copilot 把立场、目的、口径列为同一张阻塞清单；GCL 要求行业、合同类型、对方、金额。LawMind 现有 `intake-required-inputs` 偏软，合同审查主路径应升级为**可配置的硬阻塞**，但只阻塞会改变结论的项。

### 2. 先读材料，再下结论

禁止用摘要或模型记忆代替完整读取。读取失败必须写 `读取复查摘要`：文件名、读取方式、关键数据、存疑项、完整性。用户说“材料太多别看”必须拒绝。

### 3. 先核法条，再引用

法条要做名称、编号、内容和现行有效核验。输出 `法规校验摘要`。查不到就标缺口，不编条款号。潘睿绑定北大法宝 MCP；GCL 要求重要法条双源。LawMind `citation-grounding` 已有“先检索再断言”，缺的是**强制检索工具 + 时效字段**，而不是更多文案。

### 4. 先分类交付物，再写正文

工作草稿 / 内部报告 / 给客户或法院的正式材料 / 红线稿 / 图片 / Word 必须先分类。正式 `.docx` 不得 `pandoc` 直接交差。红线必须：原件只读、另存、`trackRevisions`、计划命中检查、渲染检查。

### 5. 先路由，再审查

合同按标题和附件路由，不靠正文里出现“保密”就当 NDA。诉讼按阶段路由，不把侦查和二审塞进同一个 Skill。路由默认向律师确认，信任建立后可关掉。

### 6. 缺事实不得出签署结论

可签 / 有条件可签 / 不建议签 是正式结论。验收、付款、附件、授权等缺口未补齐时，只能“结论待定”，风险点仍分级但标待确认。

### 7. 对内底稿 ≠ 对外稿

内部可保留策略、假设、升级理由。对外删除内部策略和攻击性语言。角色档位决定能否看到完整底稿（GCL 业务部门、对方律师）。

### 8. 计划文件驱动执行，模型不直接改 Word

审查产出 `review-plan.json` / `redline-plan.json`，脚本落 `w:ins`/`w:del` 和批注，再用 QA 脚本检查。这与 LawMind `apply_surgical_edits` 同构：模型出补丁，运行时执行并拒绝违规跨度。

### 9. 事项隔离

默认禁止跨客户、跨事项读取。正式产出必须落在当前事项业务区；缓存不得冒充事项目录。静默写飞书、日历、台账视为错误。

### 10. 失败要可继续，不要只拦截

出稿检查失败必须带 `next_owner` / `next_action`：退回业务 Skill、问用户、或回到读取/核验。禁止“未通过”后结束。

## 四、实现技巧（应对齐的产品机制）

| Skill 技巧                              | 应变成的 LawMind 机制                                                              |
| --------------------------------------- | ---------------------------------------------------------------------------------- |
| cold-start interview + 独立 config 路径 | 律师/律所 playbook：立场、管辖偏好、责任上限、永不接受条款；更新插件不覆盖用户配置 |
| 双边 playbook（销售 vs 采购）           | 合同审查先问己方纸还是对方纸；两套标准/回退/禁区                                   |
| `confirm_routing`                       | 办件前展示将运行的能力链，可确认或改路由                                           |
| `redline-plan.json` + apply + QA        | 在现有 surgical edit 上增加计划清单、命中报告、修订 XML 体检                       |
| 正式交付分类 + health_check             | 导出前：草稿/正式、红线/清洁、图片预览/正式；失败返回补正步骤                      |
| 事项工作区协议                          | 每个 matter 固定业务区与系统记录区；当前事项指针                                   |
| 来源边界记录                            | 已核验 / 未核验 / 缺口 三栏出现在审查意见和备忘录，不当作卖点，当作防编造          |
| LPM 源置信分层                          | Confirmed / 从材料推断 / 从一般知识推断 / Unknown；冲突不自动消解                  |
| 身份只改报告形态                        | 检索 Skill 按律师/法务/客户改详略，不改法源纪律                                    |
| MCP 是数据层                            | 元典/法信/法宝/工商/CourtListener 是工具；Skill 提供查询矩阵和核对                 |

## 五、从 Skill 密度反推的律师高频需求

按“被重复实现且结构完整”排序，而不是按 Star。

1. **合同审查与修订稿** — 同名重复最多，厚包也最多。需求是：立场、分层风险、可执行改法、Word 红线、意见书，不是聊天摘要。
2. **法律检索与法条核验** — 所有完整包都把它做成闸门，而不是可选搜索框。
3. **诉讼程序与文书** — 中国包按阶段拆；英文包按 intake / 期限 / 备忘录拆。高频是起诉状、证据目录、时间轴、期限，不是“AI 出庭”。
4. **劳动** — 中国 HQ 包里劳动领域占比最高之一；补偿计算、仲裁前置、证据倒置是刚需。
5. **公司治理、并购、数据合规、知产** — Greater-China 场景 Skill 数量仅次于诉讼和合同。
6. **接案与事项管理** — LPM + `new-case` + 法院短信 + 发票。律师每天大量时间在整理，不在“生成法律意见”。
7. **刑事与破产** — 完整工作流几乎只出现在中国执业律师维护的包里；通用英文库很薄。
8. **可视化与 OCR** — 完整包把它当交付物，不是美化。

LawMind 当前产品化能力只有：合同审查、函件、检索备忘、诉讼文书、写材料、邮件合同。对照上面第 4–7 项，缺口最大的是**劳动计算、事项运营、期限、检索强制核验、红线计划 QA、接案整理**。

## 六、对 LawMind 的消化队列

### 直接兼容（P0）

- 导入 Anthropic / 潘睿 / LPM 的 `SKILL.md` frontmatter 与 `references/` 渐进披露。
- 事项工作区：当前事项、业务区、系统记录区。
- 检索核验协议接到已有权威检索工具，缺核验不得称正式意见。

### 适配封装（P0–P1）

- 把 `redline-plan` 执行器接到现有 `apply_surgical_edits` + `render_tracked_draft`；增加 XML QA。
- 办件路由确认（`confirm_routing`）。
- 交付物类型闸门：草稿 / 正式 / 红线，失败返回下一步。
- Playbook：销售/采购或甲/乙/中立。

### 方法借鉴后独立实现（P1）

- contract-copilot 的三层四步、12 类合同路由、缺事实不出签署结论（因其 NC，不复制文案和脚本）。
- GCL 角色档位与对内/对外稿。
- 劳动 N/N+1/2N 计算引擎（潘睿有完整规则文件）。
- 诉讼可视化预览 → 确认 → 正式图。

### 暂不采用

- 数千条薄 SKILL.md 预装。
- 把“可审计/哈希链”做成律师可见卖点。
- 未核许可证的厚包原文。
- 远程技能市场作为唯一运行路径。

## 七、建议的下一步工程（仍先复用）

1. 把本规范库做成 LawMind 内部 `capability` 表：每个高频任务对应一个上游 Skill、一套闸门、一种交付物。
2. 用真实合同和起诉状对 **潘睿红线**、**LawMind surgical edit**、**copilot 计划脚本** 做三方对照，只保留胜出路径。
3. 不要把 574 或 3,571 装进桌面；律师默认只看到：审查合同、检索、诉讼文书、劳动计算、接案整理、期限、出稿。
